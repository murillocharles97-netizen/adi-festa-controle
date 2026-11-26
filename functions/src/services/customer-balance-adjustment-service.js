'use strict';
// Fase 3 — comando único de ajuste manual de saldo, por Espaço.
//   customer_balance_adjustment_preview  só lê: resultado do ajuste e o código da prévia
//   customer_balance_adjustment_history  só lê: ajustes do cliente (para corrigir um deles)
//   customer_balance_adjustment          grava o ajuste
// Tipos: increase (aumentar a dívida), decrease (reduzir), set (definir o total do
// Espaço; zerar = 0), reverse (estornar um ajuste anterior), credit (conceder crédito).
// Parte da conta por Espaço (Fases 1 e 2), confere com o saldo cadastral e grava, numa
// transação, o ajuste, o evento do razão, o marcador, o cliente e a conta. Não cria venda,
// pagamento, caixa ou estoque e não muda o regime do cliente.
// Enquanto telas e recebimentos ainda dependem da prova do histórico (até a Fase 4), um
// cliente desse regime também passa por ela antes e depois do ajuste, e crédito só vale
// para contas simples, que a prova não cobre.
const {createHash} = require('node:crypto');
const {FieldValue} = require('firebase-admin/firestore');
const {HttpsError} = require('firebase-functions/v2/https');
const Account = require('../shared/customer-account');
const History = require('../shared/fiado-history-account');
const Plan = require('../shared/installment-plan');
const {readHistoryInput} = require('./fiado-history-service');
const {receiptFacts} = require('./fiado-receipt-route');
const Ledger = require('../shared/customer-account-ledger');
const {operationalCommitService} = require('./operational-commit-service');
const {validId} = require('./workspace-reset-policy');
const {operationalId} = require('../shared/operational-id');
const WRITES_ENABLED = true; // Containment: false keeps previews and pauses new adjustments.
const PROOF_COMPATIBILITY = true; // Retired when screens and receipts read the account (Fase 4/5).
const MODES = ['increase', 'decrease', 'set', 'reverse', 'credit'];
const READY = ['ready', 'ready_by_rule'];
const fail = (code, message) => { throw new HttpsError(code, message); };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const cents = Account.cents;
const proofRegime = client => Boolean(client.fiadoHistoryVersion === 1 || client.fiadoOpeningBalance || client.fiadoHistoryActivation?.spaceRegularization?.version === 1 || client.hasInstallmentFiado);
const scopedRegime = client => Boolean(client.fiadoOpeningBalance || client.fiadoHistoryActivation?.spaceRegularization?.version === 1);
const bySpace = account => { const out = {}; for (const e of account.entries || []) if (e.spaceId) out[e.spaceId] = (out[e.spaceId] || 0) + e.remainingCents; return out; };
const money = value => { if (!Number.isSafeInteger(value) || value <= 0 || value > 100000000) fail('invalid-argument', 'Informe um valor em centavos maior que zero.'); return value; };
// Debt change of an adjustment in cents (positive = the customer owes more).
const debtDelta = a => Number.isSafeInteger(a?.deltaDebtCents) ? a.deltaDebtCents : -(cents(a?.saldoNovo) - cents(a?.saldoAnterior));

function customerBalanceAdjustmentService(db, {now = () => new Date()} = {}) {
  const authorize = operationalCommitService(db).authorize;
  const ref = (bid, col, id) => db.doc(`businesses/${bid}/${col}/${id}`);
  const server = (bid, generation) => ({bid, business: {workspaceGeneration: generation}, owner: true, has: () => true, space: async () => ({})});

  async function load(tx, request, d, write) {
    const businessId = validId(d.businessId, 'Empresa'), clientId = validId(d.clientId, 'Cliente'), spaceId = validId(d.spaceId, 'Espaço');
    const c = await authorize(tx, request, {businessId, userId: request.auth?.uid, workspaceGeneration: d.workspaceGeneration ?? 0}, {readOnly: !write});
    if (!c.has('customers.adjustBalance')) fail('permission-denied', 'Seu perfil não pode ajustar saldos. Peça ao responsável.');
    const space = await c.space(spaceId);
    if (space.status === 'archived' || space.capabilities?.sales !== true) fail('failed-precondition', 'Selecione um espaço de vendas ativo.');
    const generation = c.business.workspaceGeneration ?? 0;
    const clientRef = ref(businessId, 'clients', clientId), accountRef = ref(businessId, 'customerAccounts', clientId);
    const [clientSnap, accountSnap] = await Promise.all([tx.get(clientRef), tx.get(accountRef)]);
    const client = clientSnap.data(), account = accountSnap.data();
    if (!client || client.businessId && client.businessId !== businessId || (client.workspaceGeneration ?? 0) !== generation || client.active === false || client.ativo === false || client.deletedAt)
      fail('failed-precondition', 'Cliente indisponível nesta empresa.');
    if (!account || account.workspaceGeneration !== generation || account.schemaVersion !== Account.SCHEMA_VERSION || !account.baseline || !READY.includes(account.status))
      fail('failed-precondition', 'A conta por Espaço deste cliente ainda não foi preparada. Faça a carga das contas antes de ajustar.');
    if (account.debtCents + (account.baseline.unexplainedCents || 0) !== -cents(client.saldo || 0))
      fail('failed-precondition', 'A conta por Espaço não confere com o saldo cadastral. Nada foi alterado.');
    const linked = [...(client.customerSpaceIds || []), ...(client.customerSpaceIds?.length ? [] : [client.spaceId])].filter(Boolean);
    if (!linked.includes(spaceId) && !account.spaces?.[spaceId]) fail('permission-denied', 'Vincule o cliente a este Espaço antes de ajustar.');
    return {c, businessId, clientId, spaceId, generation, client, account, clientRef, accountRef};
  }
  // Clients whose screens and receipts still read the proof: read it, check it agrees with
  // the account and find the installments of the Space, which an adjustment cannot consume.
  async function proofBefore(tx, s) {
    if (!PROOF_COMPATIBILITY || !proofRegime(s.client)) return {protectedCents: 0, input: null};
    let input, projection;
    try { input = await readHistoryInput({tx, c: server(s.businessId, s.generation), ref, clientId: s.clientId, client: s.client, checkRowAccess: false}); }
    catch { fail('failed-precondition', 'O histórico deste cliente precisa de conferência antes de um ajuste.'); }
    const scoped = scopedRegime(s.client);
    try { projection = History.project(input, Plan.today(now()), {scoped}); }
    catch { fail('failed-precondition', 'O histórico deste cliente precisa de conferência antes de um ajuste.'); }
    if (projection.totalCents !== s.account.debtCents) fail('failed-precondition', 'A conta por Espaço não confere com o histórico. Nada foi alterado.');
    if (scoped && (bySpace(projection)[s.spaceId] || 0) !== (s.account.spaces?.[s.spaceId] || 0)) fail('failed-precondition', 'O Espaço não confere com o histórico. Nada foi alterado.');
    const protectedCents = projection.entries.filter(e => Number.isInteger(e.number) && (!scoped || e.spaceId === s.spaceId)).reduce((n, e) => n + e.remainingCents, 0);
    return {protectedCents, input, projection, scoped};
  }
  async function decide(tx, s, d) {
    const mode = d.mode;
    if (!MODES.includes(mode)) fail('invalid-argument', 'Tipo de ajuste inválido.');
    const current = s.account.spaces?.[s.spaceId] || 0, simple = !proofRegime(s.client);
    let next, reversed = null;
    if (mode === 'increase') next = current + money(d.amountCents);
    else if (mode === 'decrease' || mode === 'credit') next = current - money(d.amountCents);
    else if (mode === 'set') { if (!Number.isSafeInteger(d.targetDebtCents) || d.targetDebtCents < 0 || d.targetDebtCents > 100000000) fail('invalid-argument', 'Informe o total devido em centavos.'); next = d.targetDebtCents; }
    else {
      const original = operationalId(d.reversesOperationId, 'Ajuste a estornar');
      const [adjustmentSnap, guardSnap] = await Promise.all([tx.get(ref(s.businessId, 'balanceAdjustments', original)), tx.get(ref(s.businessId, 'processedOperations', 'reversal:' + original))]);
      reversed = adjustmentSnap.data();
      if (!reversed || [reversed.clienteId, reversed.clientId, reversed.customerId].every(v => v !== s.clientId) || reversed.status && reversed.status !== 'applied') fail('failed-precondition', 'Ajuste a estornar não encontrado para este cliente.');
      if ((reversed.spaceId || reversed.financialSpaceId) !== s.spaceId) fail('failed-precondition', 'Escolha o Espaço do ajuste original para estorná-lo.');
      if (guardSnap.exists) fail('failed-precondition', 'Este ajuste já foi estornado.');
      if (!debtDelta(reversed)) fail('failed-precondition', 'Este ajuste não alterou o saldo e não tem o que estornar.');
      next = current - debtDelta(reversed);
    }
    const proof = await proofBefore(tx, s);
    if (next < 0 && !simple) fail('failed-precondition', 'Crédito para contas com histórico comprovado será liberado quando as telas lerem a conta por Espaço. Nada foi alterado.');
    if (next < 0 && mode !== 'credit' && mode !== 'reverse') fail('failed-precondition', 'O ajuste deixaria crédito. Use "Conceder crédito" para isso.');
    if (proof.protectedCents > 0 && next < proof.protectedCents) fail('failed-precondition', 'O ajuste não pode reduzir ou substituir parcelas existentes.');
    const delta = next - current;
    if (!delta) fail('failed-precondition', 'O valor informado já corresponde ao saldo do Espaço.');
    return {mode, current, next, delta, proof, reversed};
  }
  const quoteOf = (s, plan, d) => hash([s.businessId, s.generation, s.clientId, s.spaceId, plan.mode, d.amountCents ?? null, d.targetDebtCents ?? null, d.reversesOperationId ?? null,
    Number(s.client.financialVersion || 0), plan.current, Plan.today(now())]);

  async function preview(request) {
    const d = request.data || {};
    return db.runTransaction(async tx => {
      const s = await load(tx, request, d, false), plan = await decide(tx, s, d);
      return {status: 'preview', clientId: s.clientId, spaceId: s.spaceId, mode: plan.mode, currentDebtCents: plan.current, newDebtCents: plan.next, deltaDebtCents: plan.delta,
        protectedInstallmentsCents: plan.proof.protectedCents, financialVersion: Number(s.client.financialVersion || 0), quoteHash: quoteOf(s, plan, d),
        creditAllowed: !proofRegime(s.client), otherSpaces: Object.fromEntries(Object.entries(s.account.spaces || {}).filter(([id]) => id !== s.spaceId))};
    });
  }
  async function history(request) {
    const d = request.data || {};
    return db.runTransaction(async tx => {
      const s = await load(tx, request, d, false);
      const rows = new Map();
      for (const field of ['clienteId', 'clientId', 'customerId']) {
        const snap = await tx.get(ref(s.businessId, 'balanceAdjustments', '__none__').parent.where(field, '==', s.clientId).limit(351));
        if (snap.size > 350) fail('failed-precondition', 'Histórico de ajustes excede o limite seguro.');
        for (const doc of snap.docs) rows.set(doc.id, {id: doc.id, ...doc.data()});
      }
      const all = [...rows.values()], reversedIds = new Set(all.map(a => a.reversesOperationId).filter(Boolean));
      const items = all.filter(a => (a.spaceId || a.financialSpaceId) === s.spaceId && debtDelta(a)).map(a => ({operationId: a.operationId || a.id, mode: a.adjustmentMode || (a.spaceRegularizationVersion ? 'set' : 'legacy'),
        deltaDebtCents: debtDelta(a), reason: String(a.motivo || '').slice(0, 200), actorName: String(a.actorNameSnapshot || '').slice(0, 80), at: a.financialAppliedAt || a.createdAt || a.data || null,
        reversible: !reversedIds.has(a.operationId || a.id) && !a.reversesOperationId})).sort((a, b) => String(b.at).localeCompare(String(a.at))).slice(0, 50);
      return {status: 'history', clientId: s.clientId, spaceId: s.spaceId, items};
    });
  }
  async function commit(request) {
    const d = request.data || {};
    if (!WRITES_ENABLED) fail('failed-precondition', 'Novos ajustes estão temporariamente pausados. A consulta continua disponível.');
    const operationId = operationalId(d.operationId, 'Operação');
    if (d.confirmed !== true || typeof d.reason !== 'string' || d.reason.trim().length < 10 || d.reason.length > 500) fail('invalid-argument', 'Confirme o ajuste e informe um motivo de pelo menos 10 caracteres.');
    const intent = {businessId: d.businessId, workspaceGeneration: d.workspaceGeneration ?? 0, clientId: d.clientId, spaceId: d.spaceId, mode: d.mode, amountCents: d.amountCents ?? null,
      targetDebtCents: d.targetDebtCents ?? null, reversesOperationId: d.reversesOperationId ?? null, quoteHash: d.quoteHash, expectedFinancialVersion: d.expectedFinancialVersion, reason: d.reason.trim(), actor: request.auth?.uid};
    const requestHash = hash(intent);
    return db.runTransaction(async tx => {
      const s = await load(tx, request, d, true);
      if (!s.c.access.canMutate) fail('permission-denied', 'A conta não possui acesso de escrita.');
      const markerRef = ref(s.businessId, 'processedOperations', operationId), marker = (await tx.get(markerRef)).data();
      if (marker) {
        if (marker.requestHash !== requestHash || marker.actorUid !== s.c.uid || marker.businessId !== s.businessId) fail('already-exists', 'O identificador pertence a outra operação. Nenhum saldo foi alterado.');
        return {...marker.result, replayed: true};
      }
      const plan = await decide(tx, s, d), version = Number(s.client.financialVersion || 0);
      if (d.quoteHash !== quoteOf(s, plan, d) || d.expectedFinancialVersion !== version) fail('aborted', 'O saldo mudou. Consulte a prévia de novo antes de confirmar.');
      const last = Date.parse(s.account.lastEvent?.appliedAt || '') || 0;
      if (last > now().getTime() + 1000) fail('failed-precondition', 'A sequência financeira precisa de conferência de horário.');
      const at = new Date(Math.max(now().getTime(), last + 1)).toISOString(), eventId = 'balance_adjustment:' + operationId;
      const previousBalance = Number(s.client.saldo || 0), newBalance = (cents(previousBalance) - plan.delta) / 100;
      const opening = s.client.fiadoOpeningBalance?.version === 1 ? {fiadoOpeningHash: s.client.fiadoOpeningBalance.hash} : {};
      const common = {id: operationId, operationId, businessId: s.businessId, workspaceGeneration: s.generation, spaceId: s.spaceId, financialSpaceId: s.spaceId,
        clienteId: s.clientId, clientId: s.clientId, customerId: s.clientId, actorUid: s.c.uid, actorRoleSnapshot: s.c.role,
        actorNameSnapshot: String(s.c.user?.nome || s.c.user?.name || s.c.role || 'Equipe').slice(0, 120), createdAt: at, data: at, status: 'applied', applicationStatus: 'applied', adjustmentVersion: 2, ...opening};
      const adjustment = {...common, tipo: 'ajuste_saldo', adjustmentMode: plan.mode, motivo: d.reason.trim(), saldoAnterior: previousBalance, saldoNovo: newBalance,
        previousSpaceDebtCents: plan.current, newSpaceDebtCents: plan.next, deltaDebtCents: plan.delta, financialAppliedAt: at, financialOperationId: eventId,
        expectedFinancialVersion: version, financialVersionAfter: version + 1, ...(plan.reversed ? {reversesOperationId: plan.reversed.operationId || plan.reversed.id} : {})};
      const event = {...common, id: eventId, type: 'balance_adjustment', sourceCollection: 'balanceAdjustments', sourceDocumentId: operationId,
        balanceBefore: previousBalance, balanceAfter: newBalance, balanceDelta: -plan.delta / 100, appliedAt: at};
      const result = {status: 'confirmed', clientId: s.clientId, spaceId: s.spaceId, operationId, mode: plan.mode, previousDebtCents: plan.current, newDebtCents: plan.next, deltaDebtCents: plan.delta,
        financialVersion: version + 1, confirmedAt: at};
      const processed = {id: operationId, businessId: s.businessId, workspaceGeneration: s.generation, actorUid: s.c.uid, eventKind: 'balance_adjustment', status: 'processed',
        adjustmentVersion: 2, requestHash, result, processedAt: at};
      let proven = null;
      if (PROOF_COMPATIBILITY && plan.proof.input) {
        const nextClient = {...plan.proof.input.client, saldo: newBalance, financialVersion: version + 1};
        const afterInput = {...plan.proof.input, client: nextClient, collections: {...plan.proof.input.collections,
          balanceAdjustments: [...plan.proof.input.collections.balanceAdjustments, adjustment], balanceEvents: [...plan.proof.input.collections.balanceEvents, event],
          processedOperations: [...plan.proof.input.collections.processedOperations, processed]}};
        let after;
        try { after = History.project(afterInput, Plan.today(now()), {scoped: plan.proof.scoped}); }
        catch { fail('failed-precondition', 'O ajuste não preservaria a comprovação do histórico. Nada foi alterado.'); }
        const before = bySpace(plan.proof.projection), next = bySpace(after);
        if (after.totalCents !== s.account.debtCents + plan.delta || plan.proof.scoped && ((next[s.spaceId] || 0) !== plan.next ||
          [...new Set([...Object.keys(before), ...Object.keys(next)])].some(id => id !== s.spaceId && (before[id] || 0) !== (next[id] || 0))))
          fail('failed-precondition', 'O ajuste afetaria outro Espaço. Nada foi alterado.');
        proven = {afterInput, after, nextClient};
      }
      const account = Account.apply(s.account, event);
      // Fase 4c: the history after the adjustment was just proven here, so the account carries
      // a fresh verification and the next receipt may rely on it. Without a proof, the old
      // verification keeps the previous version and receipts use the full route.
      if (proven) account.verification = {...Account.compare(account, {client: proven.nextClient, projection: proven.after, scoped: plan.proof.scoped}), at,
        financialVersion: version + 1, scoped: plan.proof.scoped, unprovableReason: null, source: 'adjustment_command',
        ...receiptFacts(proven.afterInput, proven.after, Plan.today(now()))};
      // Etapa 5: the open items after the adjustment, at the new version; without a proof they are withdrawn.
      Object.assign(account, proven && plan.proof.scoped ? {ledger: Ledger.fromProjection(proven.after, proven.afterInput), ledgerVersion: Ledger.LEDGER_VERSION} : {ledger: null, ledgerVersion: null},
        {clientFinancialVersion: version + 1});
      // All reads and checks end before the first write.
      tx.create(ref(s.businessId, 'balanceAdjustments', operationId), adjustment);
      tx.create(ref(s.businessId, 'balanceEvents', eventId), event);
      tx.create(markerRef, processed);
      if (plan.reversed) tx.create(ref(s.businessId, 'processedOperations', 'reversal:' + (plan.reversed.operationId || plan.reversed.id)), {id: 'reversal:' + (plan.reversed.operationId || plan.reversed.id),
        businessId: s.businessId, workspaceGeneration: s.generation, status: 'processed', eventKind: 'balance_adjustment_reversal', reversedBy: operationId, processedAt: at});
      tx.update(s.clientRef, {saldo: newBalance, financialVersion: version + 1, atualizadoEm: at});
      tx.set(s.accountRef, {...account, updatedAt: at});
      Account.writeSpaceDocs(tx, ref, s.businessId, s.account, account, at);
      tx.set(s.accountRef.collection('appliedEvents').doc(eventId), {eventId, at, inBaseline: false, owedCents: plan.delta, spaceId: s.spaceId, source: 'adjustment_command'});
      const names = ['clients', 'balanceAdjustments', 'balanceEvents'], revision = 'server:' + operationId;
      tx.set(ref(s.businessId, 'syncMetadata', 'last-sync'), {businessId: s.businessId, workspaceGeneration: s.generation, publisher: 'operational_server', sourceSessionId: revision,
        sourceOperationId: operationId, actorUid: s.c.uid, sourceUid: s.c.uid, sourceDeviceId: FieldValue.delete(), revision, updatedAt: FieldValue.serverTimestamp(),
        changedCollections: names, collectionVersions: Object.fromEntries(names.map(n => [n, revision]))}, {merge: true});
      return result;
    });
  }
  return {preview, history, commit};
}
module.exports = {customerBalanceAdjustmentService, proofRegime};
