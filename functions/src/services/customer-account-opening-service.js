'use strict';
// Etapa 4 — abertura da conta por Espaço para qualquer empresa e Espaço.
// O proprietário confirma o saldo de cada Espaço do cliente. Daí em diante a conta segue só
// os lançamentos novos, e o histórico anterior fica registrado como evidência, fora dela.
// É a mesma abertura do corte de 12/11 (shared/fiado-opening-balance), sem política fixa:
// os Espaços são os de vendas desta empresa ligados ao cliente ou presentes no histórico,
// validados pelo servidor. Aceita saldo zero, para recomeçar um cliente sem dívida cujo
// histórico antigo não se comprova. A conta por Espaço sai montada e comprovada na mesma
// transação, como na migração.
//   customer_account_opening_preview  somente leitura; mostra os Espaços, o saldo sugerido e o código da revisão
//   customer_account_opening          grava; exige a revisão vigente, confirmação e a conferência das filas
const {FieldValue} = require('firebase-admin/firestore');
const {HttpsError} = require('firebase-functions/v2/https');
const Account = require('../shared/customer-account');
const Backfill = require('../shared/customer-account-backfill');
const History = require('../shared/fiado-history-account');
const Opening = require('../shared/fiado-opening-balance');
const Plan = require('../shared/installment-plan');
const {readHistoryInput} = require('./fiado-history-service');
const {receiptFacts} = require('./fiado-receipt-route');
const Ledger = require('../shared/customer-account-ledger');
const {evidenceDigest} = require('./fiado-history-regularization');
const {operationalCommitService} = require('./operational-commit-service');
const {validId} = require('./workspace-reset-policy');
const {operationalId} = require('../shared/operational-id');

const WRITES_ENABLED = true; // false pauses new openings; previews stay available.
const MAX_SPACES = 10;
const fail = (code, message) => { throw new HttpsError(code, message); };
const saldo = proposal => proposal.confirmedCents === 0 ? 0 : -proposal.confirmedCents / 100;
const salesSpace = space => space && space.status !== 'archived' && (space.capabilities?.sales === undefined
  ? ['business', 'unit', 'operation'].includes(space.legacyFinancialType || space.financialType || space.type) : space.capabilities.sales === true);

function customerAccountOpeningService(db, {now = () => new Date()} = {}) {
  const authorize = operationalCommitService(db).authorize;
  const ref = (bid, col, id) => db.doc(`businesses/${bid}/${col}/${id}`);
  const server = c => ({bid: c.bid, business: c.business, owner: true, has: () => true, member: null, space: async () => ({})});
  async function owner(tx, request, businessId, generation, readOnly) {
    const c = await authorize(tx, request, {businessId, userId: request.auth?.uid, workspaceGeneration: generation ?? 0}, {readOnly});
    if (!c.owner || c.business.ownerId !== c.uid) fail('permission-denied', 'Somente o proprietário da empresa pode abrir a conta por Espaço.');
    return c;
  }
  // The sales Spaces of THIS business that belong to the customer: linked or in the history.
  // The primary Space comes first, where the suggested balance without calendar goes.
  async function spacesOf(c, client, input) {
    const ids = [client.spaceId, ...(client.customerSpaceIds || [])];
    for (const col of ['sales', 'payments', 'balanceAdjustments']) for (const row of input.collections[col] || []) ids.push(row.spaceId || row.financialSpaceId);
    const unique = [...new Set(ids.filter(id => typeof id === 'string' && id && !id.includes('/')))];
    const valid = [];
    for (const id of unique) {
      let space = null;
      try { space = await c.space(id); } catch (error) { if (!['permission-denied', 'not-found', 'failed-precondition'].includes(error.code)) throw error; }
      if (salesSpace(space) && (space.workspaceGeneration === undefined || space.workspaceGeneration === (c.business.workspaceGeneration ?? 0))) valid.push(id);
    }
    if (!valid.length) fail('failed-precondition', 'Vincule o cliente a um Espaço de vendas desta empresa antes de abrir a conta.');
    if (valid.length > MAX_SPACES) fail('failed-precondition', 'O cliente está ligado a Espaços demais para uma abertura única.');
    const primary = valid.includes(client.spaceId) ? client.spaceId : valid.find(id => (client.customerSpaceIds || []).includes(id)) || valid[0];
    return [primary, ...valid.filter(id => id !== primary).sort()];
  }
  async function plan(tx, c, clientId, balances, reason, at) {
    const clientRef = ref(c.bid, 'clients', clientId), client = (await tx.get(clientRef)).data(), generation = c.business.workspaceGeneration ?? 0;
    if (!client || client.businessId && client.businessId !== c.bid || (client.workspaceGeneration ?? 0) !== generation) fail('permission-denied', 'Cliente não encontrado nesta empresa.');
    if (client.active === false || client.ativo === false || client.deletedAt) fail('failed-precondition', 'Cliente arquivado. Reative o cadastro antes de abrir a conta.');
    if (client.fiadoOpeningBalance) fail('failed-precondition', 'Este cliente já tem uma abertura confirmada.');
    let input;
    try { input = await readHistoryInput({tx, c: server(c), ref, clientId, client, checkRowAccess: false, useActivatedOrigins: false}); }
    catch { fail('failed-precondition', 'O histórico deste cliente excede o limite seguro para uma abertura.'); }
    const spaceIds = await spacesOf(c, client, input), day = Plan.today(at);
    let proposal;
    try {
      proposal = Opening.createPlan(input, {day, spaceIds, balances, reason, allowZero: true});
      History.project({...input, client: {...client, saldo: saldo(proposal)}, opening: {...proposal, at: at.toISOString()}}, day, {scoped: true});
    } catch (error) { fail('failed-precondition', String(error.message || error)); }
    const evidence = evidenceDigest(input);
    return {client, clientRef, input, proposal, evidence, reviewHash: Opening.digest([proposal, evidence]), spaceIds, day};
  }
  const publicPlan = p => {
    const {bookCents, confirmedCents, deltaCents, reason, parts, financialVersion} = p.proposal;
    return {reviewHash: p.reviewHash, bookCents, confirmedCents, deltaCents, reason, parts, financialVersion, spaceIds: p.spaceIds};
  };

  async function preview(request) {
    const d = request.data || {}, businessId = validId(d.businessId, 'Empresa'), clientId = validId(d.clientId, 'Cliente');
    return db.runTransaction(async tx => publicPlan(await plan(tx, await owner(tx, request, businessId, d.workspaceGeneration, true), clientId, d.balances, d.reason, now())), {readOnly: true});
  }

  async function commit(request) {
    const d = request.data || {};
    if (!WRITES_ENABLED) fail('failed-precondition', 'Novas aberturas estão pausadas. A prévia continua disponível.');
    const businessId = validId(d.businessId, 'Empresa'), clientId = validId(d.clientId, 'Cliente'), requestId = operationalId(d.operationId, 'Operação');
    if (d.confirmed !== true || d.queueChecked !== true || !Array.isArray(d.balances) || !/^[a-f0-9]{64}$/.test(d.reviewHash || ''))
      fail('invalid-argument', 'Confira as filas dos aparelhos e confirme o resumo do saldo.');
    return db.runTransaction(async tx => {
      const c = await owner(tx, request, businessId, d.workspaceGeneration, false);
      if (!c.access.canMutate) fail('permission-denied', 'A conta não possui acesso de escrita.');
      const generation = c.business.workspaceGeneration ?? 0;
      const auditRef = ref(businessId, Opening.COLLECTION, clientId), prior = (await tx.get(auditRef)).data();
      const requestHash = Opening.digest([requestId, d.reviewHash, d.balances, d.reason ?? '']);
      if (prior) {
        const client = (await tx.get(ref(businessId, 'clients', clientId))).data();
        if (prior.actorUid === c.uid && prior.workspaceGeneration === generation && prior.requestHash === requestHash && client?.fiadoOpeningBalance?.hash === prior.hash)
          return {status: 'replayed', clientId, writesApplied: 0};
        fail('failed-precondition', 'Já existe abertura confirmada para este cliente.');
      }
      const instant = now(), prepared = await plan(tx, c, clientId, d.balances, d.reason, instant);
      if (prepared.reviewHash !== d.reviewHash) fail('aborted', 'O saldo ou o histórico mudou. Revise novamente.');
      const accountRef = ref(businessId, 'customerAccounts', clientId), existing = (await tx.get(accountRef)).data();
      const at = instant.toISOString(), {proposal} = prepared;
      const details = {plan: proposal, at, actorUid: c.uid, requestId, reviewHash: prepared.reviewHash}, hash = Opening.digest(details);
      const nextClient = {...prepared.input.client, fiadoOpeningBalance: {version: 1, hash}, fiadoHistoryVersion: 1, saldo: saldo(proposal), financialVersion: proposal.financialVersion + 1};
      // The account from what the server reads after the cut: the opening and the preserved calendars.
      const calendars = new Set((proposal.calendars || []).map(row => row.saleId));
      const after = {businessId, generation, client: nextClient, complete: true, stable: true, opening: {...proposal, at, hash},
        collections: {sales: prepared.input.collections.sales.filter(s => calendars.has(s.id)), payments: [], balanceAdjustments: [], balanceEvents: [], paymentAllocations: [], processedOperations: []}};
      let projection;
      try { projection = History.project(after, prepared.day, {scoped: true}); } catch (error) { fail('failed-precondition', String(error.message || error)); }
      const base = Account.fromProjection(projection, {businessId, generation, clientId, events: [], at});
      const planned = Backfill.classify({account: base, client: nextClient, split: 'scoped'});
      const verification = {...Account.compare(planned.account, {client: nextClient, projection, scoped: true}), at, financialVersion: nextClient.financialVersion, scoped: true,
        unprovableReason: null, source: 'opening', ...receiptFacts(after, projection, prepared.day)};
      if (verification.status !== 'match' || planned.status !== Backfill.STATUS.READY) fail('failed-precondition', 'A abertura não confere com a conta por Espaço. Nada foi gravado.');
      const account = {...planned.account, status: planned.status, verification, opening: {hash, at},
        ledger: Ledger.fromProjection(projection, after), ledgerVersion: Ledger.LEDGER_VERSION, clientFinancialVersion: nextClient.financialVersion};
      // All reads and checks end before the first write.
      tx.create(auditRef, {...details, type: 'fiado_confirmed_opening', version: 1, hash, requestHash, evidenceDigest: prepared.evidence,
        clientId, businessId, workspaceGeneration: generation, source: 'customer_account_opening'});
      tx.set(prepared.clientRef, {fiadoOpeningBalance: {version: 1, hash}, fiadoHistoryVersion: 1, saldo: nextClient.saldo, financialVersion: nextClient.financialVersion,
        updatedAt: at, updatedByUid: c.uid}, {merge: true});
      tx.set(accountRef, {...account, updatedAt: at});
      Account.writeSpaceDocs(tx, ref, businessId, existing, account, at);
      const revision = 'server:customer-opening:' + clientId + ':' + proposal.financialVersion;
      tx.set(ref(businessId, 'syncMetadata', 'last-sync'), {businessId, workspaceGeneration: generation, publisher: 'operational_server', sourceSessionId: revision,
        sourceOperationId: revision, ownerId: c.uid, actorUid: c.uid, sourceUid: c.uid, sourceDeviceId: FieldValue.delete(), revision, updatedAt: FieldValue.serverTimestamp(),
        changedCollections: ['clients'], collectionVersions: {clients: revision}}, {merge: true});
      return {status: 'confirmed', clientId, financialVersion: nextClient.financialVersion, ...publicPlan(prepared)};
    });
  }
  return {preview, commit};
}
module.exports = {customerAccountOpeningService};
