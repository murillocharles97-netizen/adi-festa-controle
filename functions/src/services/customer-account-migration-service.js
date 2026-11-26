'use strict';
// Etapa 2 — migração de um cliente do regime simples para a conta por Espaço.
// Nada financeiro muda: saldo, vendas, recebimentos e alocações ficam como estão. O cliente
// passa ao mesmo regime de uma regularização (fiadoHistoryActivation.spaceRegularization),
// e a conta por Espaço é montada da reconstrução, já comprovada, na mesma transação.
// Só migra quando a reconstrução por Espaço comprova o mesmo saldo e o mesmo restante em
// cada venda que o histórico de vendas mostra hoje; senão, informa o motivo e não grava.
//   customer_account_migration_preview  somente leitura; um cliente (clientId) ou a lista paginada
//   customer_account_migration          grava; exige a prévia vigente, confirmação e um identificador
const {createHash} = require('node:crypto');
const {FieldValue, FieldPath} = require('firebase-admin/firestore');
const {HttpsError} = require('firebase-functions/v2/https');
const Account = require('../shared/customer-account');
const Backfill = require('../shared/customer-account-backfill');
const History = require('../shared/fiado-history-account');
const Plan = require('../shared/installment-plan');
const {readHistoryInput} = require('./fiado-history-service');
const {receiptFacts, pendingRows} = require('./fiado-receipt-route');
const Ledger = require('../shared/customer-account-ledger');
const {operationalCommitService} = require('./operational-commit-service');
const {validId} = require('./workspace-reset-policy');
const {operationalId} = require('../shared/operational-id');

const WRITES_ENABLED = true; // false pauses migrations; previews stay available.
const MIGRATIONS = 'customerAccountMigrations', PAGE_MAX = 50;
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail = (code, message, details) => { throw new HttpsError(code, message, details); };
const cents = v => Math.round(Number(v || 0) * 100);
const activeSale = s => s.active !== false && !s.deletedAt && !s.cancelledAt && !s.desfeita;
const scopedRegime = c => Boolean(c.fiadoOpeningBalance || c.fiadoHistoryActivation?.spaceRegularization?.version === 1);
const MESSAGES = {
  not_found: 'Cliente não encontrado nesta empresa.',
  archived: 'Cliente arquivado. Reative o cadastro antes de migrar.',
  installments: 'Cliente com parcelamento: a migração das parcelas chega na próxima etapa.',
  history_unreadable: 'O histórico deste cliente precisa de conferência antes de migrar.',
  credit: 'Cliente com crédito: confira o saldo antes de migrar.',
  cross_space_allocation: 'Um recebimento antigo foi alocado a venda de outro Espaço. Revise antes de migrar.',
  payments_exceed: 'Os recebimentos antigos passam das vendas comprovadas. Revise antes de migrar.',
  future_obligation: 'Há obrigação com data futura sem parcelamento. Revise antes de migrar.',
  history_unproven: 'O histórico não comprova o saldo por Espaço. Revise antes de migrar.',
  history_review: 'O histórico precisa de revisão antes de migrar.',
  origin_unknown: 'Há dívida sem Espaço. Atribua o Espaço antes de migrar.',
  balance_mismatch: 'O saldo cadastral não confere com o histórico. Revise antes de migrar.',
  sale_history_mismatch: 'O restante de alguma venda mudaria com a migração. Revise antes de migrar.',
  pending: 'Há recebimento ou venda pendente. Confira a operação original antes de migrar.',
};
const reasonOf = message => /entre espaços/i.test(message) ? 'cross_space_allocation' : /excede/i.test(message) ? 'payments_exceed' :
  /futura/i.test(message) ? 'future_obligation' : /prova suficiente/i.test(message) ? 'history_unproven' : 'history_review';

function customerAccountMigrationService(db, {now = () => new Date()} = {}) {
  const authorize = operationalCommitService(db).authorize;
  const ref = (bid, col, id) => db.doc(`businesses/${bid}/${col}/${id}`);
  const server = (bid, business) => ({bid, business, owner: true, has: () => true, member: null, space: async () => ({})});
  async function owner(tx, request, businessId, generation, readOnly) {
    const c = await authorize(tx, request, {businessId, userId: request.auth?.uid, workspaceGeneration: generation ?? 0}, {readOnly});
    if (!c.owner || c.business.ownerId !== c.uid) fail('permission-denied', 'Somente o proprietário da empresa pode migrar clientes para a conta por Espaço.');
    return c;
  }

  // One customer, inside the caller's transaction. Never writes.
  async function plan(tx, c, clientId, {operationId = null, at = null} = {}) {
    const bid = c.bid, generation = c.business.workspaceGeneration ?? 0, base = {clientId, status: 'blocked'};
    const clientRef = ref(bid, 'clients', clientId), client = (await tx.get(clientRef)).data();
    if (!client || client.businessId && client.businessId !== bid || (client.workspaceGeneration ?? 0) !== generation) return {...base, reason: 'not_found'};
    if (client.active === false || client.ativo === false || client.deletedAt) return {...base, reason: 'archived'};
    if (scopedRegime(client)) return {clientId, status: 'already_space'};
    let input;
    try { input = await readHistoryInput({tx, c: server(bid, c.business), ref, clientId, client, checkRowAccess: false}); }
    catch { return {...base, reason: 'history_unreadable'}; }
    if (input.opening) return {clientId, status: 'already_space'};
    const fiado = input.collections.sales.filter(s => activeSale(s) && (s.formaPagamento === 'fiado' || s.status === 'fiado'));
    if (client.hasInstallmentFiado === true && !fiado.some(s => s.installmentPlan)) return {...base, reason: 'history_review'};
    const book = -cents(client.saldo);
    const touched = book !== 0 || fiado.length || ['payments', 'balanceAdjustments', 'balanceEvents', 'paymentAllocations'].some(k => input.collections[k].length);
    // Untouched customers need nothing: their first Fiado sale opens the account (Etapa 1).
    if (!touched) return {clientId, status: 'nothing_to_migrate'};
    if (book < 0) return {...base, reason: 'credit'};
    const day = Plan.today(now()), activation = {version: 1, operationId, at, origin: 'migration'};
    const nextClient = {...input.client, fiadoHistoryVersion: 1, fiadoHistoryActivation: {...(client.fiadoHistoryActivation || {}), spaceRegularization: activation}};
    const after = {...input, client: nextClient};
    let projection;
    try { projection = History.project(after, day, {scoped: true}); } catch (error) { return {...base, reason: reasonOf(String(error.message || error))}; }
    if (projection.entries.some(e => !e.spaceId)) return {...base, reason: 'origin_unknown'};
    if (projection.totalCents !== book || projection.creditCents) return {...base, reason: 'balance_mismatch'};
    // The sale history must read the same after the migration: what each sale still owes,
    // the sum of its installments for an installment sale (Etapa 3).
    const open = new Map();
    for (const e of projection.entries) if (e.saleId) open.set(e.saleId, (open.get(e.saleId) || 0) + e.remainingCents);
    const differs = fiado.filter(s => cents(s.creditRemainingAmount ?? s.valorFinal ?? s.valorTotal) !== (open.get(s.id) || 0));
    if (differs.length) return {...base, reason: 'sale_history_mismatch', sales: differs.length};
    const facts = receiptFacts(after, projection, day);
    if (facts.receiptRisk) return {...base, reason: facts.receiptRisk === 'pending_payment' ? 'pending' : 'history_review'};
    if (await pendingRows(tx, c, ref, clientId)) return {...base, reason: 'pending'};
    const spaces = {};
    for (const e of projection.entries) spaces[e.spaceId] = (spaces[e.spaceId] || 0) + e.remainingCents;
    const version = client.financialVersion ?? 0;
    const quoteHash = hash([bid, generation, clientId, c.uid, version, client.saldo, projection.entries.map(e => [e.spaceId, e.saleId, e.historyEventId, e.remainingCents])]);
    return {clientId, status: 'eligible', bookCents: book, spaces, sales: fiado.length, openItems: projection.entries.length, financialVersion: version, quoteHash,
      internal: {client, clientRef, after, projection, facts, nextClient, fiado}};
  }
  const visible = p => { const {internal, ...rest} = p; return rest; };

  async function preview(request) {
    const d = request.data || {}, businessId = validId(d.businessId, 'Empresa');
    if (d.clientId !== undefined) {
      const clientId = validId(d.clientId, 'Cliente');
      return db.runTransaction(async tx => visible(await plan(tx, await owner(tx, request, businessId, d.workspaceGeneration, true), clientId)), {readOnly: true});
    }
    const session = await db.runTransaction(async tx => { const c = await owner(tx, request, businessId, d.workspaceGeneration, true); return {generation: c.business.workspaceGeneration ?? 0}; }, {readOnly: true});
    const limit = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(d.limit) || 20)));
    let query = db.collection(`businesses/${businessId}/clients`).orderBy(FieldPath.documentId()).select().limit(limit + 1);
    if (d.cursor !== undefined && d.cursor !== null) query = query.startAfter(validId(d.cursor, 'Cursor'));
    const listed = await query.get(), page = listed.docs.slice(0, limit), items = [];
    for (const snap of page) items.push(await db.runTransaction(async tx => visible(await plan(tx, await owner(tx, request, businessId, session.generation, true), snap.id)), {readOnly: true}));
    const summary = items.reduce((m, i) => { const k = i.status === 'blocked' ? 'blocked:' + i.reason : i.status; m[k] = (m[k] || 0) + 1; return m; }, {});
    return {businessId, workspaceGeneration: session.generation, items, summary, nextCursor: listed.size > limit ? page.at(-1).id : null};
  }

  async function commit(request) {
    const d = request.data || {};
    if (!WRITES_ENABLED) fail('failed-precondition', 'A migração está pausada. A prévia continua disponível.');
    const businessId = validId(d.businessId, 'Empresa'), clientId = validId(d.clientId, 'Cliente'), operationId = operationalId(d.operationId, 'Operação');
    if (d.confirmed !== true || !/^[a-f0-9]{64}$/.test(d.quoteHash || '')) fail('invalid-argument', 'Confirme a migração a partir da prévia atual.');
    const requestHash = hash({businessId, clientId, quoteHash: d.quoteHash});
    return db.runTransaction(async tx => {
      const c = await owner(tx, request, businessId, d.workspaceGeneration, false);
      if (!c.access.canMutate) fail('permission-denied', 'A conta não possui acesso de escrita.');
      const generation = c.business.workspaceGeneration ?? 0;
      const markerRef = ref(businessId, 'processedOperations', operationId), marker = (await tx.get(markerRef)).data();
      if (marker) {
        if (marker.eventKind !== 'customer_account_migration' || marker.requestHash !== requestHash || marker.actorUid !== c.uid)
          fail('already-exists', 'Este identificador pertence a outra operação. Nada foi alterado.');
        return {...marker.result, replayed: true};
      }
      const at = now().toISOString(), p = await plan(tx, c, clientId, {operationId, at});
      if (p.status !== 'eligible') fail('failed-precondition', p.status === 'already_space' ? 'O cliente já está na conta por Espaço.' :
        p.status === 'nothing_to_migrate' ? 'O cliente ainda não tem movimento: a primeira venda Fiado abre a conta.' : MESSAGES[p.reason] || MESSAGES.history_review, {reason: p.reason || p.status});
      if (p.quoteHash !== d.quoteHash) fail('aborted', 'O cliente mudou desde a prévia. Consulte de novo antes de migrar.');
      const accountRef = ref(businessId, 'customerAccounts', clientId), existing = (await tx.get(accountRef)).data();
      const {clientRef, after, projection, facts, nextClient, fiado} = p.internal;
      const base = Account.fromProjection(projection, {businessId, generation, clientId, events: after.collections.balanceEvents, at});
      const planned = Backfill.classify({account: base, client: nextClient, split: 'scoped'});
      const verification = {...Account.compare(planned.account, {client: nextClient, projection, scoped: true}), at, financialVersion: p.financialVersion, scoped: true,
        unprovableReason: null, source: 'migration', ...facts};
      if (verification.status !== 'match' || planned.status !== Backfill.STATUS.READY) fail('failed-precondition', MESSAGES.history_review, {reason: 'verification'});
      const account = {...planned.account, status: planned.status, verification, migration: {operationId, at},
        ledger: Ledger.fromProjection(projection, after), ledgerVersion: Ledger.LEDGER_VERSION, clientFinancialVersion: p.financialVersion};
      const result = {status: 'migrated', clientId, operationId, bookCents: p.bookCents, spaces: p.spaces, financialVersion: p.financialVersion, migratedAt: at};
      // All reads and checks end before the first write.
      tx.update(clientRef, {fiadoHistoryVersion: 1, fiadoHistoryActivation: nextClient.fiadoHistoryActivation, atualizadoEm: at});
      tx.set(accountRef, {...account, updatedAt: at});
      Account.writeSpaceDocs(tx, ref, businessId, existing, account, at);
      tx.set(ref(businessId, MIGRATIONS, clientId), {schemaVersion: 1, businessId, workspaceGeneration: generation, clientId, operationId, actorUid: c.uid, at,
        before: {regime: 'simples', bookCents: p.bookCents, financialVersion: p.financialVersion,
          sales: fiado.map(s => ({saleId: s.id, spaceId: s.spaceId || s.financialSpaceId || null, remainingCents: cents(s.creditRemainingAmount ?? s.valorFinal ?? s.valorTotal), paidCents: cents(s.creditPaidAmount)}))},
        after: {regime: 'conta_por_espaco', spaces: p.spaces, items: verification.items}});
      tx.create(markerRef, {id: operationId, businessId, workspaceGeneration: generation, actorUid: c.uid, eventKind: 'customer_account_migration', status: 'processed',
        requestHash, result, processedAt: at});
      const names = ['clients'], revision = 'server:' + operationId;
      tx.set(ref(businessId, 'syncMetadata', 'last-sync'), {businessId, workspaceGeneration: generation, publisher: 'operational_server', sourceSessionId: revision,
        sourceOperationId: operationId, actorUid: c.uid, sourceUid: c.uid, sourceDeviceId: FieldValue.delete(), revision, updatedAt: FieldValue.serverTimestamp(),
        changedCollections: names, collectionVersions: Object.fromEntries(names.map(n => [n, revision]))}, {merge: true});
      return result;
    });
  }
  return {preview, commit, plan};
}
module.exports = {customerAccountMigrationService, MIGRATIONS};
