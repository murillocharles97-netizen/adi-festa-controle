'use strict';
// Conta por Espaço — Fase 2: carga auditada das contas a partir do histórico atual.
//   customer_account_backfill_preview  só lê: classifica uma página de clientes e
//                                      devolve o resultado; não grava nada.
//   customer_account_backfill_apply    grava a conta de cada cliente da página e um item
//                                      do relatório (com a versão anterior, se havia).
// Somente o proprietário. Nenhum documento existente fora de customerAccounts e do
// relatório é alterado: cliente, vendas, pagamentos, ajustes e eventos ficam intactos.
const {createHash} = require('node:crypto');
const {FieldPath, FieldValue} = require('firebase-admin/firestore');
const {HttpsError} = require('firebase-functions/v2/https');
const Backfill = require('../shared/customer-account-backfill');
const Account = require('../shared/customer-account');
const History = require('../shared/fiado-history-account');
const Plan = require('../shared/installment-plan');
const {readHistoryInput} = require('./fiado-history-service');
const {receiptFacts} = require('./fiado-receipt-route');
const Ledger = require('../shared/customer-account-ledger');
const {operationalCommitService} = require('./operational-commit-service');
const {validId} = require('./workspace-reset-policy');
const {operationalId} = require('../shared/operational-id');
const WRITES_ENABLED = true; // Containment: false keeps the preview and pauses new writes.
const PAGE_MAX = 50;
const fail = (code, message) => { throw new HttpsError(code, message); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cursorId = value => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 700 || value.includes('/') || value === '.' || value === '..') fail('invalid-argument', 'Posição da carga inválida.');
  return value;
};

// One customer: reads the history exactly as the account proof does and classifies it.
// Exported so a read-only preview over exported data runs this same code.
async function planCustomer({tx, ref, businessId, generation, clientId, client, rules = [], fallbackSpaceId = null, now = () => new Date()}) {
  const at = now().toISOString();
  const server = {bid: businessId, business: {workspaceGeneration: generation}, owner: true, has: () => true, space: async () => ({})};
  let input;
  // A history that cannot be read safely (size limits, invalid audit) is reported for
  // review; it never stops the other customers of the page.
  try { input = await readHistoryInput({tx, c: server, ref, clientId, client, checkRowAccess: false}); }
  catch (error) {
    return {status: Backfill.STATUS.NEEDS_REVIEW, rules: [], reason: 'historico-ilegivel', split: 'none', at, unprovableReason: String(error.message || error).slice(0, 200),
      account: {...Account.empty({businessId, generation, clientId}), debtCents: null, unattributedCents: null}};
  }
  const scoped = Boolean(client.fiadoOpeningBalance || client.fiadoHistoryActivation?.spaceRegularization?.version === 1);
  let projection = null, unprovableReason = null;
  try { projection = History.project(input, Plan.today(now()), {scoped}); }
  catch (error) { unprovableReason = String(error.message || error).slice(0, 200); }
  const events = input.collections.balanceEvents;
  const base = projection
    ? Account.fromProjection(projection, {businessId, generation, clientId, events, at})
    : Account.fromEvents(events, {businessId, generation, clientId, client, at, reason: unprovableReason});
  const split = projection ? (scoped ? 'scoped' : 'history_fifo') : 'events';
  const planned = {...Backfill.classify({account: base, client, split, rules, fallbackSpaceId}), split, unprovableReason, at};
  // Fase 4c: the same verification the shadow trigger records, so a receipt may rely on the
  // account right after the load, while the client's financial version holds.
  if (projection) planned.verification = {...Account.compare(planned.account, {client, projection, scoped}), at, financialVersion: Number(client.financialVersion || 0),
    scoped, unprovableReason: null, source: 'backfill', ...receiptFacts(input, projection, Plan.today(now()))};
  planned.ledger = projection && scoped && planned.verification?.status === 'match' ? Ledger.fromProjection(projection, input) : null;
  planned.clientFinancialVersion = Number(client.financialVersion || 0);
  return planned;
}

function customerAccountBackfillService(db, {now = () => new Date()} = {}) {
  const authorize = operationalCommitService(db).authorize;
  const ref = (bid, col, id) => db.doc(`businesses/${bid}/${col}/${id}`);
  const plan = (tx, businessId, generation, clientId, client, options) =>
    planCustomer({tx, ref, businessId, generation, clientId, client, rules: options.rules, fallbackSpaceId: options.fallbackSpaceId, now});
  async function handle(request) {
    const d = request.data || {}, kind = d.kind;
    if (!['customer_account_backfill_preview', 'customer_account_backfill_apply'].includes(kind)) fail('invalid-argument', 'Operação de carga desconhecida.');
    const write = kind === 'customer_account_backfill_apply', businessId = validId(d.businessId, 'Empresa'), generationIn = d.workspaceGeneration ?? 0;
    const rules = d.rules ?? [];
    if (!Backfill.validRules(rules)) fail('invalid-argument', 'Regras de atribuição inválidas.');
    const fallbackSpaceId = rules.includes(Backfill.RULES.FALLBACK_SPACE) ? validId(d.fallbackSpaceId, 'Espaço') : null;
    const limit = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(d.limit) || 20))), cursor = cursorId(d.cursor);
    let runId = null, requestHash = null;
    if (write) {
      if (!WRITES_ENABLED) fail('failed-precondition', 'A carga das contas está pausada. A prévia continua disponível.');
      runId = operationalId(d.runId, 'Carga');
      if (d.confirmed !== true || d.backupConfirmed !== true) fail('invalid-argument', 'Confirme a carga e a cópia de segurança antes de gravar.');
      requestHash = hash({businessId, workspaceGeneration: generationIn, rules, fallbackSpaceId});
    }
    const session = await db.runTransaction(async tx => {
      const c = await authorize(tx, request, {businessId, userId: request.auth?.uid, workspaceGeneration: generationIn}, {readOnly: !write});
      if (!c.owner || c.business.ownerId !== c.uid) fail('permission-denied', 'Somente o proprietário da empresa pode montar as contas por Espaço.');
      if (fallbackSpaceId) await c.space(fallbackSpaceId);
      if (write) {
        const run = (await tx.get(ref(businessId, 'customerAccountBackfills', runId))).data();
        if (run && (run.requestHash !== requestHash || run.actorUid !== c.uid)) fail('already-exists', 'Este identificador pertence a outra carga. Nada foi gravado.');
      }
      return {uid: c.uid, generation: c.business.workspaceGeneration ?? 0};
    });
    // One extra id tells whether another page exists, so the last page ends the run.
    let query = db.collection(`businesses/${businessId}/clients`).orderBy(FieldPath.documentId()).select().limit(limit + 1);
    if (cursor) query = query.startAfter(cursor);
    const listed = await query.get(), page = listed.docs.slice(0, limit), items = [];
    for (const snap of page) {
      items.push(await db.runTransaction(async tx => {
        const client = (await tx.get(snap.ref)).data(), clientId = snap.id;
        if (!client || client.businessId && client.businessId !== businessId || (client.workspaceGeneration ?? 0) !== session.generation)
          return {clientId, status: 'skipped', reason: 'outra-empresa-ou-geracao'};
        const planned = await plan(tx, businessId, session.generation, clientId, client, {rules, fallbackSpaceId});
        const account = {...planned.account, status: planned.status, backfill: {runId, rules: planned.rules, split: planned.split, at: planned.at},
          ...(planned.verification ? {verification: planned.verification} : {}),
          ledger: planned.ledger || null, ledgerVersion: planned.ledger ? Ledger.LEDGER_VERSION : null, clientFinancialVersion: planned.clientFinancialVersion};
        const row = {clientId, status: planned.status, rules: planned.rules, split: planned.split, reason: planned.reason, unprovableReason: planned.unprovableReason,
          debtCents: account.debtCents, spaces: account.spaces, unattributedCents: account.unattributedCents, unexplainedCents: account.baseline?.unexplainedCents || 0,
          bookCents: -Account.cents(client.saldo || 0),
          archived: client.active === false || client.ativo === false || Boolean(client.deletedAt)};
        if (!write) return row;
        const accountRef = ref(businessId, 'customerAccounts', clientId), existing = (await tx.get(accountRef)).data();
        if (Backfill.sameAccount(existing, account)) {
          row.change = 'unchanged';
          if (planned.verification) tx.update(accountRef, {verification: planned.verification, ledger: planned.ledger || null,
            ledgerVersion: planned.ledger ? Ledger.LEDGER_VERSION : null, clientFinancialVersion: planned.clientFinancialVersion});
        }
        else {
          row.change = existing ? 'replaced' : 'created';
          if (existing) row.previous = {debtCents: existing.debtCents, spaces: existing.spaces, unattributedCents: existing.unattributedCents, status: existing.status || null,
            baseline: existing.baseline || null, verification: existing.verification?.status || null};
          tx.set(accountRef, {...account, updatedAt: planned.at});
          Account.writeSpaceDocs(tx, ref, businessId, existing, account, planned.at);
        }
        tx.set(ref(businessId, 'customerAccountBackfills', runId).collection('items').doc(clientId), {...row, runId, at: planned.at});
        return row;
      }));
    }
    const nextCursor = listed.size > limit ? page.at(-1).id : null;
    const counts = items.reduce((m, i) => ({...m, [i.status]: (m[i.status] || 0) + 1}), {});
    if (write) await ref(businessId, 'customerAccountBackfills', runId).set({runId, businessId, workspaceGeneration: session.generation, actorUid: session.uid, requestHash,
      rules, fallbackSpaceId, lastCursor: nextCursor, pages: FieldValue.increment(1), updatedAt: now().toISOString(), ...(nextCursor ? {} : {finishedAt: now().toISOString()})}, {merge: true});
    return {mode: write ? 'apply' : 'preview', runId, rules, fallbackSpaceId, items, counts, nextCursor};
  }
  return {handle};
}
module.exports = {customerAccountBackfillService, planCustomer};
