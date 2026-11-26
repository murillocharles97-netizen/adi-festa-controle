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
const {receiptFacts, pendingRows} = require('./fiado-receipt-route');
const Ledger = require('../shared/customer-account-ledger');
const {operationalCommitService} = require('./operational-commit-service');
const {validId, belongsToWorkspace} = require('./workspace-reset-policy');
const {operationalId} = require('../shared/operational-id');
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
  const reference = now(), at = reference.toISOString(), day = Plan.today(reference);
  const server = {bid: businessId, business: {workspaceGeneration: generation}, owner: true, has: () => true, space: async () => ({})};
  let input;
  // A history that cannot be read safely (size limits, invalid audit) is reported for
  // review; it never stops the other customers of the page.
  try { input = await readHistoryInput({tx, c: server, ref, clientId, client, checkRowAccess: false}); }
  catch (error) {
    if ([4, 8, 10, 13, 14, 'deadline-exceeded', 'resource-exhausted', 'aborted', 'internal', 'unavailable'].includes(error.code)) throw error;
    return {status: Backfill.STATUS.NEEDS_REVIEW, rules: [], reason: 'historico-ilegivel', split: 'none', at, unprovableReason: String(error.message || error).slice(0, 200),
      account: {...Account.empty({businessId, generation, clientId}), debtCents: null, unattributedCents: null}};
  }
  const scoped = Boolean(client.fiadoOpeningBalance || client.fiadoHistoryActivation?.spaceRegularization?.version === 1);
  let projection = null, unprovableReason = null;
  try { projection = History.project(input, day, {scoped}); }
  catch (error) {
    if ([4, 8, 10, 13, 14, 'deadline-exceeded', 'resource-exhausted', 'aborted', 'internal', 'unavailable'].includes(error.code)) throw error; unprovableReason = String(error.message || error).slice(0, 200); }
  const events = input.collections.balanceEvents;
  const base = projection
    ? Account.fromProjection(projection, {businessId, generation, clientId, events, at})
    : Account.fromEvents(events, {businessId, generation, clientId, client, at, reason: unprovableReason});
  const split = projection ? (scoped ? 'scoped' : 'history_fifo') : 'events';
  const planned = {...Backfill.classify({account: base, client, split, rules, fallbackSpaceId}), split, unprovableReason, at};
  // Fase 4c: the same verification the shadow trigger records, so a receipt may rely on the
  // account right after the load, while the client's financial version holds.
  if (projection) planned.verification = {...Account.compare(planned.account, {client, projection, scoped}), at, financialVersion: Number(client.financialVersion || 0),
    scoped, unprovableReason: null, source: 'backfill', ...receiptFacts(input, projection, day)};
  if (projection) planned.verification.saleParity = saleParity(input.collections.sales, planned.verification.items);
  planned.ledger = projection && scoped && planned.verification?.status === 'match' ? Ledger.fromProjection(projection, input) : null;
  planned.clientFinancialVersion = Number(client.financialVersion || 0);
  return planned;
}


function saleParity(rows, items) {
  const open = new Map();
  for (const item of items) if (item.saleId) open.set(item.saleId, (open.get(item.saleId) || 0) + item.remainingCents);
  return rows.every(sale => {
    if (sale.active === false || sale.ativo === false || sale.deletedAt || sale.cancelledAt || sale.desfeita ||
        (sale.formaPagamento !== 'fiado' && sale.status !== 'fiado')) return true;
    const actual = open.get(sale.id) || 0;
    if (sale.status === 'pago' || sale.creditSettled === true) return actual === 0;
    if (sale.creditRemainingAmount != null) return Number.isFinite(Number(sale.creditRemainingAmount)) && Account.cents(sale.creditRemainingAmount) === actual;
    return actual > 0 || Boolean(sale.installmentPlan) || Number(sale.valorFinal ?? sale.valorTotal ?? 0) === 0;
  });
}

const ACTIVE_PAGE_MAX = 10;
const digestPattern = /^[a-f0-9]{64}$/;
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const scoped = (scope, businessId, generation) => typeof scope === 'string' && scope === businessId + ':' + generation;
const activeClient = (client, businessId, generation) => Boolean(client &&
  (!client.businessId || client.businessId === businessId) && (client.workspaceGeneration ?? 0) === generation &&
  client.active !== false && client.ativo !== false && !client.deletedAt);
const accountRefFor = (db, bid, col, id) => db.doc('businesses/' + bid + '/' + col + '/' + id);

async function selectiveProof({tx, ref, businessId, generation, clientId, client, now}) {
  if (!activeClient(client, businessId, generation)) return {reason: 'cliente-fora-do-escopo'};
  const planned = await planCustomer({tx, ref, businessId, generation, clientId, client, now});
  const plan = planned.account, proof = planned.verification, version = client.financialVersion ?? 0;
  if (!Number.isSafeInteger(version) || version < 0 || planned.status !== Backfill.STATUS.READY || !planned.ledger ||
      proof?.status !== 'match' || proof.scoped !== true || proof.receiptRisk !== null ||
      proof.saleParity !== true || plan.unattributedCents !== 0 || plan.debtCents !== -Account.cents(client.saldo || 0)) {
    return {planned, reason: 'historico-sem-paridade'};
  }
  if (await pendingRows(tx, {bid: businessId}, ref, clientId)) return {planned, reason: 'operacao-pendente'};
  // A confirmed opening can hide older sales from the current history slice.
  // Review their visible remainder too, without allowing legacy rows to set the balance.
  if (client.fiadoOpeningBalance) {
    const sales = new Map();
    for (const field of ['clienteId', 'clientId', 'customerId']) {
      const batch = await tx.get(ref(businessId, 'sales', 'audit').parent.where(field, '==', clientId).limit(351));
      if (batch.size > 350) return {planned, reason: 'historico-excede-limite'};
      for (const doc of batch.docs) {
        const sale = doc.data();
        if ((!sale.businessId || sale.businessId === businessId) && (sale.workspaceGeneration ?? 0) === generation)
          sales.set(doc.id, {...sale, id: doc.id});
      }
    }
    if (sales.size > 350 || !saleParity([...sales.values()], proof.items)) return {planned, reason: 'historico-sem-paridade'};
  }
  const spaceIds = [...new Set([...Object.keys(plan.spaces), ...proof.items.map(item => item.spaceId)])].sort();
  const spaces = spaceIds.length ? await tx.getAll(...spaceIds.map(id => ref(null, 'financialSpaces', validId(id, 'Espaço')))) : [];
  if (spaces.some(snap => !snap.exists || !belongsToWorkspace(snap.data(), businessId) || snap.data().active === false || snap.data().status === 'archived'))
    return {planned, reason: 'espaco-fora-do-escopo'};
  const approval = {clientId, financialVersion: version, proofHash: hash(canonical({
    businessId, generation, clientId, version, day: proof.receiptCheckedOn, balance: plan.debtCents, spaces: plan.spaces,
    items: proof.items, ledger: planned.ledger, baseline: plan.baseline.cut
  }))};
  return {planned, approval};
}

function projectedAccount(proof, backfill) {
  const {planned, approval} = proof;
  return {...planned.account, status: planned.status, backfill, verification: planned.verification,
    ledger: planned.ledger, ledgerVersion: Ledger.LEDGER_VERSION, clientFinancialVersion: approval.financialVersion,
    selectiveProofHash: approval.proofHash, updatedAt: planned.at};
}

async function refreshLoadedAccount({tx, db, businessId, generation, clientId, now, eventId}) {
  const ref = (bid, col, id) => bid === null ? db.doc(col + '/' + id) : accountRefFor(db, bid, col, id);
  const accountRef = ref(businessId, 'customerAccounts', clientId);
  const markerRef = eventId ? accountRef.collection('appliedEvents').doc(eventId) : null;
  const [saved, clientSnap] = await tx.getAll(accountRef, ref(businessId, 'clients', clientId));
  const existing = saved.data();
  if (!existing?.backfill?.selective || existing.workspaceGeneration !== generation ||
      existing.businessId !== businessId || existing.clientId !== clientId) return {status: 'outside-cohort'};
  const proof = await selectiveProof({tx, ref, businessId, generation, clientId, client: clientSnap.data(), now});
  if (!proof.approval) {
    if (Account.PUBLISHED.has(existing.status) || existing.verification?.reason !== proof.reason) {
      const at = now().toISOString();
      const held = {...existing, status: Backfill.STATUS.NEEDS_REVIEW, ledger: null, ledgerVersion: null,
        selectiveProofHash: null, verification: {status: 'needs_review', reason: proof.reason, at}, updatedAt: at};
      tx.set(accountRef, held);
      Account.writeSpaceDocs(tx, ref, businessId, existing, held, at);
    }
    return {status: 'needs_review', reason: proof.reason};
  }
  const marker = markerRef ? await tx.get(markerRef) : null;
  if (existing.selectiveProofHash !== proof.approval.proofHash || !Account.PUBLISHED.has(existing.status)) {
    const account = projectedAccount(proof, existing.backfill);
    tx.set(accountRef, account);
    Account.writeSpaceDocs(tx, ref, businessId, existing, account, account.updatedAt);
  }
  if (markerRef && !marker.exists) tx.create(markerRef, {eventId, source: 'selective-rebuild', inBaseline: true});
  return {status: 'current', financialVersion: proof.approval.financialVersion};
}


async function applyLoadedEvent(db, businessId, eventId, {now = () => new Date(),
  projectionScope = process.env.VECONI_ACCOUNT_PROJECTION_SCOPE} = {}) {
  if (typeof projectionScope !== 'string' || !projectionScope.startsWith(businessId + ':')) return {status: 'disabled'};
  return db.runTransaction(async tx => {
    const business = (await tx.get(db.doc('businesses/' + businessId))).data();
    const generation = business?.workspaceGeneration ?? 0;
    if (business?.active !== true || !scoped(projectionScope, businessId, generation)) return {status: 'disabled'};
    // Read the canonical event, rather than trusting a delivery that may outlive its generation.
    const eventRef = accountRefFor(db, businessId, 'balanceEvents', eventId);
    const event = (await tx.get(eventRef)).data();
    if (!Account.applicable(event, {businessId, generation})) return {status: 'ignored'};
    return refreshLoadedAccount({tx, db, businessId, generation, clientId: Account.clientOf(event), now, eventId});
  });
}

function customerAccountBackfillService(db, {now = () => new Date(), loadScope = process.env.VECONI_ACCOUNT_LOAD_SCOPE,
  projectionScope = process.env.VECONI_ACCOUNT_PROJECTION_SCOPE} = {}) {
  const authorize = operationalCommitService(db).authorize;
  const ref = (bid, col, id) => bid === null ? db.doc(col + '/' + id) : accountRefFor(db, bid, col, id);
  async function owner(tx, request, businessId, generation, readOnly) {
    const c = await authorize(tx, request, {businessId, userId: request.auth?.uid, workspaceGeneration: generation}, {readOnly});
    if (!c.owner || c.business.ownerId !== c.uid) fail('permission-denied', 'Somente o proprietário da empresa pode montar as contas por Espaço.');
    return c;
  }

  async function preview(request, d, businessId, generation) {
    const rules = d.rules ?? [];
    if (!Backfill.validRules(rules)) fail('invalid-argument', 'Regras de atribuição inválidas.');
    const fallbackSpaceId = rules.includes(Backfill.RULES.FALLBACK_SPACE) ? validId(d.fallbackSpaceId, 'Espaço') : null;
    const limit = Math.min(PAGE_MAX, Math.max(1, Math.floor(Number(d.limit) || 20))), cursor = cursorId(d.cursor);
    await db.runTransaction(tx => owner(tx, request, businessId, generation, true));
    let query = db.collection('businesses/' + businessId + '/clients').orderBy(FieldPath.documentId()).select().limit(limit + 1);
    if (cursor) query = query.startAfter(cursor);
    const listed = await query.get(), page = listed.docs.slice(0, limit), items = [];
    for (const snap of page) {
      items.push(await db.runTransaction(async tx => {
        const c = await owner(tx, request, businessId, generation, true);
        if (fallbackSpaceId) await c.space(fallbackSpaceId);
        const client = (await tx.get(snap.ref)).data(), clientId = snap.id;
        if (!activeClient(client, businessId, generation)) return {clientId, status: 'skipped', reason: 'cliente-fora-do-escopo'};
        const check = rules.length === 0 ? await selectiveProof({tx, ref, businessId, generation, clientId, client, now}) : {};
        const planned = check.planned || await planCustomer({tx, ref, businessId, generation, clientId, client, rules, fallbackSpaceId, now});
        const account = planned.account;
        return {clientId, status: planned.status, rules: planned.rules, split: planned.split, reason: planned.reason,
          debtCents: account.debtCents, spaces: account.spaces, unattributedCents: account.unattributedCents,
          unprovableReason: planned.unprovableReason ?? null, unexplainedCents: account.baseline?.unexplainedCents || 0, bookCents: -Account.cents(client.saldo || 0),
          ...(check.approval ? {approval: check.approval} : {approval: null, approvalReason: check.reason || 'regra-de-atribuicao'})};
      }));
    }
    return {mode: 'preview', items, counts: countStatuses(items), nextCursor: listed.size > limit ? page.at(-1).id : null};
  }

  async function apply(request, d, businessId, generation) {
    if (!scoped(loadScope, businessId, generation)) fail('failed-precondition', 'A carga das contas está pausada nesta empresa e geração.');
    const runId = operationalId(d.runId, 'Carga'), pageId = operationalId(d.pageId, 'Página');
    if (d.confirmed !== true || d.backupConfirmed !== true || (d.rules !== undefined && (!Array.isArray(d.rules) || d.rules.length !== 0)))
      fail('invalid-argument', 'Confirme a carga seletiva e a cópia de segurança.');
    if (!Array.isArray(d.items) || !d.items.length || d.items.length > ACTIVE_PAGE_MAX)
      fail('invalid-argument', 'Informe entre 1 e 10 clientes aprovados.');
    const approvals = d.items.map(item => {
      const clientId = validId(item?.clientId, 'Cliente'), {financialVersion, proofHash} = item;
      if (!Number.isSafeInteger(financialVersion) || financialVersion < 0 || typeof proofHash !== 'string' || !digestPattern.test(proofHash))
        fail('invalid-argument', 'A versão e a prova da prévia são obrigatórias.');
      return {clientId, financialVersion, proofHash};
    }).sort((a, b) => a.clientId.localeCompare(b.clientId));
    if (new Set(approvals.map(a => a.clientId)).size !== approvals.length) fail('invalid-argument', 'Cliente repetido na página.');
    const requestHash = hash(canonical(approvals));
    const runRef = ref(businessId, 'customerAccountBackfills', runId), pageRef = runRef.collection('pages').doc(pageId);
    const itemsRef = runRef.collection('items');
    function assertRun(run, uid) {
      if (run.actorUid !== uid || run.workspaceGeneration !== generation || run.mode !== 'selective')
        fail('already-exists', 'Este identificador pertence a outra carga.');
    }

    const replay = await db.runTransaction(async tx => {
      const c = await owner(tx, request, businessId, generation, false);
      const [run, page, ...claims] = await tx.getAll(runRef, pageRef, ...approvals.map(a => itemsRef.doc(a.clientId)));
      if (run.exists) assertRun(run.data(), c.uid);
      if (page.exists) {
        if (page.data().requestHash !== requestHash) fail('already-exists', 'A página foi reservada com outra lista.');
        return page.data().result || null;
      }
      if (claims.some(claim => claim.exists)) fail('already-exists', 'Algum cliente já pertence a outra página da carga.');
      if (!run.exists) tx.create(runRef, {runId, businessId, workspaceGeneration: generation, actorUid: c.uid,
        mode: 'selective', pages: 0, applied: 0, needsReview: 0, createdAt: now().toISOString()});
      tx.create(pageRef, {pageId, requestHash, status: 'pending'});
      for (const a of approvals) tx.create(itemsRef.doc(a.clientId), {pageId, approval: a, status: 'pending'});
      return null;
    });
    if (replay) return replay;

    const items = [];
    for (const approval of approvals) {
      items.push(await db.runTransaction(async tx => {
        await owner(tx, request, businessId, generation, false);
        const {clientId, financialVersion, proofHash} = approval;
        const itemRef = itemsRef.doc(clientId), clientRef = ref(businessId, 'clients', clientId);
        const accountRef = ref(businessId, 'customerAccounts', clientId);
        const [item, client, existing] = await tx.getAll(itemRef, clientRef, accountRef);
        if (item.data().result) return item.data().result;
        const proof = await selectiveProof({tx, ref, businessId, generation, clientId, client: client.data(), now});
        const sameProof = proof.approval?.financialVersion === financialVersion && proof.approval?.proofHash === proofHash;
        const row = sameProof ? {clientId, status: 'applied', financialVersion, proofHash}
          : {clientId, status: 'needs_review', reason: proof.reason || 'previa-alterada'};
        if (sameProof) {
          const prior = existing.data();
          if (prior) row.previous = {debtCents: prior.debtCents ?? null, spaces: prior.spaces || {}, financialVersion: prior.clientFinancialVersion ?? null};
          const account = projectedAccount(proof, {selective: true, runId, pageId, at: proof.planned.at});
          if (prior?.selectiveProofHash !== approval.proofHash || prior?.status !== account.status) {
            tx.set(accountRef, account);
            Account.writeSpaceDocs(tx, ref, businessId, prior, account, account.updatedAt);
          }
        }
        tx.update(itemRef, {status: row.status, result: row});
        return row;
      }));
    }
    return db.runTransaction(async tx => {
      await owner(tx, request, businessId, generation, false);
      const page = (await tx.get(pageRef)).data();
      if (page.result) return page.result;
      const counts = countStatuses(items), result = {mode: 'apply', runId, pageId, items, counts};
      tx.update(pageRef, {status: 'complete', result, completedAt: now().toISOString()});
      tx.update(runRef, {pages: FieldValue.increment(1), applied: FieldValue.increment(counts.applied || 0),
        needsReview: FieldValue.increment(counts.needs_review || 0)});
      return result;
    });
  }

  async function catchup(request, d, businessId, generation) {
    if (!scoped(projectionScope, businessId, generation)) fail('failed-precondition', 'A projeção ainda está pausada.');
    if (!Array.isArray(d.clientIds) || !d.clientIds.length || d.clientIds.length > ACTIVE_PAGE_MAX)
      fail('invalid-argument', 'Informe entre 1 e 10 clientes já carregados.');
    const ids = new Set(d.clientIds.map(id => validId(id, 'Cliente')));
    const items = [];
    for (const clientId of ids) {
      items.push(await db.runTransaction(async tx => {
        await owner(tx, request, businessId, generation, false);
        return {clientId, ...await refreshLoadedAccount({tx, db, businessId, generation, clientId, now})};
      }));
    }
    return {mode: 'catchup', items, counts: countStatuses(items)};
  }

  async function handle(request) {
    const d = request.data || {}, businessId = validId(d.businessId, 'Empresa'), generation = d.workspaceGeneration ?? 0;
    if (!Number.isSafeInteger(generation) || generation < 0) fail('invalid-argument', 'Geração inválida.');
    switch (d.kind) {
      case 'customer_account_backfill_preview': return preview(request, d, businessId, generation);
      case 'customer_account_backfill_apply': return apply(request, d, businessId, generation);
      case 'customer_account_backfill_catchup': return catchup(request, d, businessId, generation);
      default: return fail('invalid-argument', 'Operação de carga desconhecida.');
    }
  }
  return {handle};
}

function countStatuses(rows) {
  return rows.reduce((counts, row) => ({...counts, [row.status]: (counts[row.status] || 0) + 1}), {});
}

module.exports = {customerAccountBackfillService, planCustomer, selectiveProof, applyLoadedEvent};
