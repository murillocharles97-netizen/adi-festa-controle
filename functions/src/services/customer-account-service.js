'use strict';
// Conta por Espaço — Fase 1, modo sombra (ver functions/src/shared/customer-account.js).
// Disparado pela criação de cada evento do razão. Nenhum caminho financeiro existente
// muda: a conta é gravada à parte, em businesses/{id}/customerAccounts/{cliente}, que
// as Rules deixam inacessível aos aparelhos nesta fase.
//   applyEvent  2 leituras por evento (conta e marcador do evento), além da empresa;
//               a primeira vez de cada cliente monta a base a partir do histórico.
//   verifyClient reconstrói o histórico e compara (caro; só no modo sombra).
const Account = require('../shared/customer-account');
const Backfill = require('../shared/customer-account-backfill');
const History = require('../shared/fiado-history-account');
const Plan = require('../shared/installment-plan');
const Ledger = require('../shared/customer-account-ledger');
const {readHistoryInput} = require('./fiado-history-service');
const {receiptFacts} = require('./fiado-receipt-route');
// Containment: false stops new projections and verifications; nothing else depends on them.
const SHADOW_ENABLED = true;
// Events the trigger applies itself (no transactional update) are always verified, which also
// rebuilds the open items. Events already applied in their transaction (Etapa 5) are audited
// by sample (Etapa 6): one in AUDIT_EVERY, or when the last audit is older than AUDIT_MAX_AGE_MS.
const VERIFY_EVERY_EVENT = true;
const AUDIT_EVERY = 20, AUDIT_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000, AUDITS = 'customerAccountAudits';
const sampled = (eventId, every) => every > 0 && [...String(eventId)].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) >>> 0, 7) % every === 0;

function customerAccountService(db, {now = () => new Date(), enabled = SHADOW_ENABLED, verify = VERIFY_EVERY_EVENT, auditEvery = AUDIT_EVERY, auditMaxAgeMs = AUDIT_MAX_AGE_MS} = {}) {
  const ref = (bid, col, id) => db.doc(`businesses/${bid}/${col}/${id}`);
  const server = (bid, generation) => ({bid, business: {workspaceGeneration: generation}, owner: true, has: () => true, space: async () => ({})});
  // A history that cannot be read safely (size limits, invalid audit) is not retried
  // forever by the trigger: the account is marked for review and events are only recorded.
  async function history(tx, bid, generation, clientId, client) {
    let input;
    try { input = await readHistoryInput({tx, c: server(bid, generation), ref, clientId, client, checkRowAccess: false}); }
    catch (error) {
      if ([4, 8, 10, 13, 14, 'deadline-exceeded', 'resource-exhausted', 'aborted', 'internal', 'unavailable'].includes(error.code)) throw error;
      return {unreadable: true, reason: String(error.message || error).slice(0, 200)};
    }
    const scoped = Boolean(client.fiadoOpeningBalance || client.fiadoHistoryActivation?.spaceRegularization?.version === 1);
    try { return {input, scoped, projection: History.project(input, Plan.today(now()), {scoped}), reason: null}; }
    catch (error) { return {input, scoped, projection: null, reason: String(error.message || error).slice(0, 200)}; }
  }
  async function applyEvent(businessId, eventId, data) {
    if (!enabled) return {status: 'disabled'};
    const event = {...data, id: eventId}, clientId = Account.clientOf(event);
    if (!clientId) return {status: 'ignored', reason: 'evento-sem-cliente'};
    const outcome = await db.runTransaction(async tx => {
      const business = (await tx.get(db.doc(`businesses/${businessId}`))).data(), generation = business?.workspaceGeneration ?? 0;
      if (!business || !Account.applicable(event, {businessId, generation})) return {status: 'ignored', reason: 'evento-nao-confirmado'};
      const accountRef = ref(businessId, 'customerAccounts', clientId), markerRef = accountRef.collection('appliedEvents').doc(eventId);
      const [accountSnap, markerSnap] = await Promise.all([tx.get(accountRef), tx.get(markerRef)]);
      if (markerSnap.exists) {
        const transactional = markerSnap.data()?.source === 'transactional', last = Date.parse(accountSnap.data()?.verification?.at || '');
        return {status: 'duplicate', audit: verify && (markerSnap.data()?.verificationPending === true || transactional && (sampled(eventId, auditEvery) || !Number.isFinite(last) || now().getTime() - last > auditMaxAgeMs))};
      }
      const at = now().toISOString(), stored = accountSnap.data();
      if (!stored || stored.workspaceGeneration !== generation || stored.schemaVersion !== Account.SCHEMA_VERSION) {
        const client = (await tx.get(ref(businessId, 'clients', clientId))).data();
        if (!client) return {status: 'ignored', reason: 'cliente-ausente'};
        const h = await history(tx, businessId, generation, clientId, client);
        if (h.unreadable) {
          tx.set(accountRef, {...Account.empty({businessId, generation, clientId}), debtCents: null, unattributedCents: null, status: 'needs_review', reviewReason: h.reason, updatedAt: at});
          tx.set(markerRef, {eventId, at, inBaseline: false, recordedOnly: true});
          return {status: 'needs_review'};
        }
        const events = h.input.collections.balanceEvents;
        const base = h.projection
          ? Account.fromProjection(h.projection, {businessId, generation, clientId, events, at})
          : Account.fromEvents(events, {businessId, generation, clientId, client, at, reason: h.reason});
        // Same classification as the load, without attribution rules: only a ready account is published.
        const planned = Backfill.classify({account: base, client, split: h.projection ? (h.scoped ? 'scoped' : 'history_fifo') : 'events'});
        const ledger = h.projection && h.scoped ? Ledger.fromProjection(h.projection, h.input) : null;
        const account = {...planned.account, status: planned.status, ledger, ledgerVersion: ledger ? Ledger.LEDGER_VERSION : null, clientFinancialVersion: Number(client.financialVersion || 0)};
        // The triggering event was committed before this read, so the base already holds it.
        tx.set(accountRef, {...account, updatedAt: at});
        Account.writeSpaceDocs(tx, ref, businessId, stored, account, at);
        tx.set(markerRef, {eventId, at, inBaseline: true, verificationPending: verify});
        return {status: 'baseline', account};
      }
      if (!stored.baseline) { tx.set(markerRef, {eventId, at, inBaseline: false, recordedOnly: true}); return {status: 'needs_review'}; }
      if (Account.includedInBaseline(stored, event)) { tx.set(markerRef, {eventId, at, inBaseline: true}); return {status: 'in_baseline'}; }
      const account = Account.apply(stored, event);
      tx.set(accountRef, {...account, updatedAt: at});
      Account.writeSpaceDocs(tx, ref, businessId, stored, account, at);
      tx.set(markerRef, {eventId, at, inBaseline: false, owedCents: -Account.cents(event.balanceDelta), spaceId: Account.spaceOf(event), verificationPending: verify});
      return {status: 'applied', account};
    });
    if (verify && ['baseline', 'applied'].includes(outcome.status) || outcome.audit) outcome.verification = await verifyClient(businessId, clientId, eventId);
    return outcome;
  }
  async function verifyClient(businessId, clientId, eventId = null) {
    return db.runTransaction(async tx => {
      const business = (await tx.get(db.doc(`businesses/${businessId}`))).data(), generation = business?.workspaceGeneration ?? 0;
      const accountRef = ref(businessId, 'customerAccounts', clientId), account = (await tx.get(accountRef)).data();
      const client = (await tx.get(ref(businessId, 'clients', clientId))).data();
      if (!account || !client) return {status: 'missing'};
      const h = await history(tx, businessId, generation, clientId, client);
      if (eventId) tx.update(accountRef.collection('appliedEvents').doc(eventId), {verificationPending: false});
      if (h.unreadable || !account.baseline) {
        const verification = {status: 'needs_review', at: now().toISOString(), reason: h.reason || 'sem-base'};
        tx.update(accountRef, {verification});
        return verification;
      }
      const result = Account.compare(account, {client, projection: h.projection, scoped: h.scoped});
      // Fase 4c: the receipt facts let a receipt rely on this account while the version holds.
      const verification = {...result, at: now().toISOString(), financialVersion: Number(client.financialVersion || 0), scoped: h.scoped, unprovableReason: h.reason,
        ...(h.projection ? receiptFacts(h.input, h.projection, Plan.today(now())) : {})};
      // Etapa 5: a proven verification refreshes the open items; a mismatch withdraws them.
      const proven = verification.status === 'match' && h.scoped && h.projection, version = Number(client.financialVersion || 0);
      // Etapa 6: the open items kept by the transactions must equal the proven ones, item by item.
      const kept = account.ledgerVersion === Ledger.LEDGER_VERSION && account.ledger && account.clientFinancialVersion === version ? Ledger.entries(account.ledger, Plan.today(now())) : null;
      verification.itemsCheck = proven && kept ? (Ledger.same(kept, h.projection.entries) ? 'match' : 'divergent') : null;
      const finding = verification.status === 'mismatch' ? 'account_mismatch' : verification.itemsCheck === 'divergent' ? 'items_divergent' : null;
      tx.update(accountRef, {verification, ledger: proven ? Ledger.fromProjection(h.projection, h.input) : null, ledgerVersion: proven ? Ledger.LEDGER_VERSION : null,
        clientFinancialVersion: version});
      // Every audit leaves its result; a divergence is kept for review with what differed. Open
      // items that diverged are replaced by the proven ones; a totals mismatch withdraws them,
      // and receipts use the full route until the owner reconciles (customer_account_reconcile).
      const summary = rows => rows.map(e => ({spaceId: e.spaceId || null, saleId: e.saleId || null, number: e.number ?? null, historyEventId: e.historyEventId || null, remainingCents: e.remainingCents})).slice(0, 50);
      tx.set(ref(businessId, AUDITS, clientId), {schemaVersion: 1, businessId, workspaceGeneration: generation, clientId, at: verification.at, financialVersion: version,
        status: finding || verification.status, itemsCheck: verification.itemsCheck, totals: verification.status, differences: (verification.differences || []).slice(0, 20),
        ...(finding ? {lastFinding: {kind: finding, at: verification.at, financialVersion: version, kept: kept ? summary(kept) : null, proven: h.projection ? summary(h.projection.entries) : null,
          action: finding === 'items_divergent' ? 'items_replaced_by_proof' : 'ledger_withdrawn'}} : {})}, {merge: true});
      return verification;
    });
  }
  return {applyEvent, verifyClient};
}
module.exports = {customerAccountService, SHADOW_ENABLED, AUDIT_EVERY, AUDITS};
