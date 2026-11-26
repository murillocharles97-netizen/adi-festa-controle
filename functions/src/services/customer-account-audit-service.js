'use strict';
// Etapa 6 — o motor antigo (a reconstrução completa do histórico) como ferramenta de auditoria
// e reconciliação, fora do caminho de cada operação.
//   customer_account_audit      o proprietário audita um cliente (clientId) ou uma página de clientes:
//                               reconstrói, compara a conta e os itens em aberto e grava o resultado
//   customer_account_reconcile  o proprietário refaz a conta de um cliente a partir do histórico
//                               comprovado; sem prova, indica a abertura por Espaço (Etapa 4)
const {createHash} = require('node:crypto');
const {FieldValue, FieldPath} = require('firebase-admin/firestore');
const {HttpsError} = require('firebase-functions/v2/https');
const Account = require('../shared/customer-account');
const Backfill = require('../shared/customer-account-backfill');
const Ledger = require('../shared/customer-account-ledger');
const {customerAccountService, AUDITS} = require('./customer-account-service');
const {planCustomer} = require('./customer-account-backfill-service');
const {customerAccountMigrationService} = require('./customer-account-migration-service');
const {operationalCommitService} = require('./operational-commit-service');
const {validId} = require('./workspace-reset-policy');
const {operationalId} = require('../shared/operational-id');

const PAGE_MAX = 25;
const hash = v => createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail = (code, message, details) => { throw new HttpsError(code, message, details); };
const scopedRegime = c => Boolean(c?.fiadoOpeningBalance || c?.fiadoHistoryActivation?.spaceRegularization?.version === 1);

function customerAccountAuditService(db, {now = () => new Date()} = {}) {
  const authorize = operationalCommitService(db).authorize, shadow = customerAccountService(db, {now});
  const ref = (bid, col, id) => db.doc(`businesses/${bid}/${col}/${id}`);
  async function owner(request, businessId, generation, readOnly = true) {
    return db.runTransaction(async tx => {
      const c = await authorize(tx, request, {businessId, userId: request.auth?.uid, workspaceGeneration: generation ?? 0}, {readOnly});
      if (!c.owner || c.business.ownerId !== c.uid) fail('permission-denied', 'Somente o proprietário da empresa pode auditar e reconciliar as contas.');
      return {uid: c.uid, generation: c.business.workspaceGeneration ?? 0, canMutate: c.access.canMutate};
    }, readOnly ? {readOnly: true} : undefined);
  }
  const outcome = async (businessId, clientId) => {
    const verification = await shadow.verifyClient(businessId, clientId), audit = (await ref(businessId, AUDITS, clientId).get()).data() || null;
    return {clientId, status: audit?.status || verification.status, totals: verification.status, itemsCheck: verification.itemsCheck ?? null,
      financialVersion: verification.financialVersion ?? null, differences: (verification.differences || []).slice(0, 10), lastFinding: audit?.lastFinding || null};
  };
  async function audit(request) {
    const d = request.data || {}, businessId = validId(d.businessId, 'Empresa'), session = await owner(request, businessId, d.workspaceGeneration);
    if (d.clientId !== undefined) return outcome(businessId, validId(d.clientId, 'Cliente'));
    const limit = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(d.limit) || 10)));
    let query = db.collection(`businesses/${businessId}/customerAccounts`).orderBy(FieldPath.documentId()).select().limit(limit + 1);
    if (d.cursor !== undefined && d.cursor !== null) query = query.startAfter(validId(d.cursor, 'Cursor'));
    const listed = await query.get(), page = listed.docs.slice(0, limit), items = [];
    for (const snap of page) items.push(await outcome(businessId, snap.id));
    const summary = items.reduce((m, i) => { m[i.status] = (m[i.status] || 0) + 1; return m; }, {});
    return {businessId, workspaceGeneration: session.generation, items, summary, nextCursor: listed.size > limit ? page.at(-1).id : null};
  }
  async function reconcile(request) {
    const d = request.data || {}, businessId = validId(d.businessId, 'Empresa'), clientId = validId(d.clientId, 'Cliente'), operationId = operationalId(d.operationId, 'Operação');
    if (d.confirmed !== true) fail('invalid-argument', 'Confirme a reconciliação.');
    const requestHash = hash({businessId, clientId});
    return db.runTransaction(async tx => {
      const c = await authorize(tx, request, {businessId, userId: request.auth?.uid, workspaceGeneration: d.workspaceGeneration ?? 0}, {readOnly: false});
      if (!c.owner || c.business.ownerId !== c.uid) fail('permission-denied', 'Somente o proprietário da empresa pode auditar e reconciliar as contas.');
      if (!c.access.canMutate) fail('permission-denied', 'A conta não possui acesso de escrita.');
      const generation = c.business.workspaceGeneration ?? 0, markerRef = ref(businessId, 'processedOperations', operationId), marker = (await tx.get(markerRef)).data();
      if (marker) {
        if (marker.eventKind !== 'customer_account_reconcile' || marker.requestHash !== requestHash || marker.actorUid !== c.uid) fail('already-exists', 'Este identificador pertence a outra operação. Nada foi alterado.');
        return {...marker.result, replayed: true};
      }
      const client = (await tx.get(ref(businessId, 'clients', clientId))).data();
      if (!client || client.businessId && client.businessId !== businessId || (client.workspaceGeneration ?? 0) !== generation) fail('permission-denied', 'Cliente não encontrado nesta empresa.');
      if (!scopedRegime(client)) fail('failed-precondition', 'O cliente ainda não está na conta por Espaço. Use a migração ou a abertura.', {reason: 'not_space_account'});
      const accountRef = ref(businessId, 'customerAccounts', clientId), existing = (await tx.get(accountRef)).data(), at = now().toISOString();
      const planned = await planCustomer({tx, ref, businessId, generation, clientId, client, now});
      if (planned.status !== Backfill.STATUS.READY || planned.verification?.status !== 'match' || !planned.ledger)
        fail('failed-precondition', 'O histórico não comprova a conta. Use a abertura por Espaço para recomeçar com o saldo confirmado.', {reason: planned.status, unprovableReason: planned.unprovableReason || null});
      const account = {...planned.account, status: planned.status, verification: planned.verification, ledger: planned.ledger, ledgerVersion: Ledger.LEDGER_VERSION,
        clientFinancialVersion: planned.clientFinancialVersion, reconciliation: {operationId, at}, updatedAt: at};
      const result = {status: 'reconciled', clientId, operationId, debtCents: account.debtCents, spaces: account.spaces, financialVersion: planned.clientFinancialVersion, reconciledAt: at,
        previous: existing ? {debtCents: existing.debtCents ?? null, spaces: existing.spaces || null, ledger: Boolean(existing.ledger)} : null};
      // All reads end before the first write.
      tx.set(accountRef, account);
      Account.writeSpaceDocs(tx, ref, businessId, existing, account, at);
      tx.set(ref(businessId, AUDITS, clientId), {schemaVersion: 1, businessId, workspaceGeneration: generation, clientId, at, financialVersion: planned.clientFinancialVersion,
        status: 'match', totals: 'match', itemsCheck: 'match', lastReconciliation: {operationId, at, actorUid: c.uid, previous: result.previous}}, {merge: true});
      tx.create(markerRef, {id: operationId, businessId, workspaceGeneration: generation, actorUid: c.uid, eventKind: 'customer_account_reconcile', status: 'processed', requestHash, result, processedAt: at});
      return result;
    });
  }
  // Etapa 7: how far each customer is from the single engine, and whether the old proof can leave
  // the device (Fase 5): every active customer with history on an account kept by the transactions,
  // with no open audit finding. Read only.
  async function readiness(request) {
    const d = request.data || {}, businessId = validId(d.businessId, 'Empresa'), session = await owner(request, businessId, d.workspaceGeneration);
    const migration = customerAccountMigrationService(db, {now}), limit = Math.min(PAGE_MAX * 2, Math.max(1, Math.floor(Number(d.limit) || 50)));
    let query = db.collection(`businesses/${businessId}/clients`).orderBy(FieldPath.documentId()).select().limit(limit + 1);
    if (d.cursor !== undefined && d.cursor !== null) query = query.startAfter(validId(d.cursor, 'Cursor'));
    const listed = await query.get(), page = listed.docs.slice(0, limit), items = [];
    for (const snap of page) items.push(await db.runTransaction(async tx => {
      const c = await authorize(tx, request, {businessId, userId: request.auth?.uid, workspaceGeneration: session.generation}, {readOnly: true});
      const client = (await tx.get(ref(businessId, 'clients', snap.id))).data(), clientId = snap.id;
      if (!client || client.active === false || client.ativo === false || client.deletedAt) return {clientId, state: 'archived'};
      if (!scopedRegime(client)) {
        const p = await migration.plan(tx, c, clientId);
        return {clientId, state: p.status === 'eligible' ? 'needs_migration' : p.status === 'nothing_to_migrate' ? 'no_history' : 'needs_opening', reason: p.reason || null};
      }
      const [account, audit] = (await Promise.all([tx.get(ref(businessId, 'customerAccounts', clientId)), tx.get(ref(businessId, AUDITS, clientId))])).map(s => s.data());
      const version = Number(client.financialVersion || 0);
      if (['items_divergent', 'account_mismatch'].includes(audit?.status) && audit.financialVersion === version) return {clientId, state: 'finding', reason: audit.status};
      if (account?.ledgerVersion === Ledger.LEDGER_VERSION && account.ledger && account.clientFinancialVersion === version && Account.PUBLISHED.has(account.status)) return {clientId, state: 'ledger_current'};
      if (account?.verification?.status === 'match' && account.verification.financialVersion === version) return {clientId, state: 'verified_only'};
      return {clientId, state: account ? 'stale' : 'no_account'};
    }, {readOnly: true}));
    const summary = items.reduce((m, i) => { m[i.state] = (m[i.state] || 0) + 1; return m; }, {});
    const blocking = items.filter(i => !['ledger_current', 'no_history', 'archived'].includes(i.state));
    return {businessId, workspaceGeneration: session.generation, items, summary, readyForPhase5: !blocking.length, blocking: blocking.length, nextCursor: listed.size > limit ? page.at(-1).id : null};
  }
  return {audit, reconcile, readiness};
}
module.exports = {customerAccountAuditService};
