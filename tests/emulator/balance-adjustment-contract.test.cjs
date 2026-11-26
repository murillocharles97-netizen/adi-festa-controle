'use strict';
// Fase 0 — contrato do ajuste manual de saldo (caracterização, sem mudar comportamento).
// Cada teste afirma o que o código ATUAL faz em uma operação obrigatória e registra se
// ela atende, atende com restrições ou falta (lacuna). Também mede, no servidor, os
// documentos lidos por ajuste, por consulta da conta e por recebimento, conforme o
// tamanho do histórico. Dados fictícios; somente Emulator em loopback.
// Relatório: VECONI_CONTRACT_REPORT=<arquivo.json> (opcional).
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const fs = require('node:fs'), vm = require('node:vm');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {readHistoryInput} = require('../../functions/src/services/fiado-history-service');
const History = require('../../functions/src/shared/fiado-history-account');
const {harness, bridge} = require('../helpers/fiado-cancellation-harness.cjs');

const results = [], measures = [];
const record = (id, operation, status, observed) => { results.push({id, operation, status, observed}); };
let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-adjustment-contract'}, 'adjustment-contract'); db = getFirestore(app); });
test.after(async () => {
  if (process.env.VECONI_CONTRACT_REPORT) fs.writeFileSync(process.env.VECONI_CONTRACT_REPORT, JSON.stringify({generatedAt: new Date().toISOString(), results, measures}, null, 2));
  for (const r of results) console.log(`[contrato] ${r.id} ${r.status.padEnd(16)} ${r.operation} — ${r.observed}`);
  for (const m of measures) console.log(`[leituras] ${m.flow.padEnd(26)} histórico ${String(m.history).padStart(3)} eventos: ${m.docs} documentos em ${m.queries} consultas`);
  await db.terminate(); await deleteApp(app);
});

// Counts what the server reads inside its transactions (documents and queries).
function metered(base) {
  const stats = {docs: 0, queries: 0};
  const wrap = tx => new Proxy(tx, {get(target, key) {
    if (key === 'get') return async ref => { const r = await target.get(ref); if (r && Array.isArray(r.docs)) { stats.queries++; stats.docs += r.size; } else stats.docs++; return r; };
    if (key === 'getAll') return async (...refs) => { const r = await target.getAll(...refs); stats.docs += r.length; return r; };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  }});
  const db = new Proxy(base, {get(target, key) {
    if (key === 'runTransaction') return (fn, options) => target.runTransaction(tx => fn(wrap(tx)), options);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  }});
  return {db, take() { const out = {...stats}; stats.docs = 0; stats.queries = 0; return out; }};
}

async function setup({spaces = 2} = {}) {
  const bid = 'contract-' + crypto.randomUUID(), owner = 'owner-' + (++seq), seller = 'seller-' + seq, manager = 'manager-' + seq;
  const space = 'space-a-' + bid, other = 'space-b-' + bid, clientId = 'qa-client', root = db.doc('businesses/' + bid);
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  for (const [uid, role] of [[owner, 'owner'], [seller, 'seller'], [manager, 'manager']]) {
    await db.doc('users/' + uid).set({uid, businessId: bid, active: true, role});
    await root.collection('members').doc(uid).set({uid, role, status: 'active', spaceAccess: 'all', permissionsVersion: 2,
      permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true}});
  }
  for (const id of [space, other].slice(0, spaces)) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true}});
  await root.collection('clients').doc(clientId).set({id: clientId, businessId: bid, nome: 'Pessoa QA', saldo: 0, financialVersion: 0, workspaceGeneration: 0, active: true, ativo: true,
    customerSpaceIds: [space, other].slice(0, spaces)});
  const meter = metered(db), svc = operationalCommitService(meter.db);
  const req = (kind, input = {}, uid = owner) => ({auth: {uid}, data: {businessId: bid, workspaceGeneration: 0, spaceId: space, clientId, kind, ...input}});
  const preview = (extra = {}, uid = owner) => svc.receipt(req('fiado_space_regularization_preview', extra, uid));
  const intent = async (total, extra = {}, uid = owner) => {
    const q = await preview(extra, uid);
    return req('fiado_space_regularization', {...extra, operationId: crypto.randomUUID(), quoteHash: q.quoteHash, financialVersion: q.financialVersion, targetDebtCents: total,
      purpose: extra.purpose || 'historical_debt', reason: extra.reason || 'Ajuste conferido em anotação fictícia de QA', confirmed: true, localQueueChecked: true}, uid);
  };
  const apply = async (total, extra = {}) => svc.commit(await intent(total, extra));
  const read = async (col, id) => (await root.collection(col).doc(id).get()).data();
  const size = async col => (await root.collection(col).get()).size;
  const account = async () => db.runTransaction(async tx => {
    const client = await read('clients', clientId);
    return History.project(await readHistoryInput({tx, c: {bid, business: {workspaceGeneration: 0}, owner: true, has: () => true, space: async () => ({})},
      ref: (b, col, id) => db.doc(`businesses/${b}/${col}/${id}`), clientId, client, checkRowAccess: false}), require('../../functions/src/shared/installment-plan').today(), {scoped: true});
  });
  const spaceDebt = (a, id) => a.entries.filter(e => e.spaceId === id).reduce((n, e) => n + e.remainingCents, 0);
  // Old free adjustment (Clientes.ajustarSaldo), packaged like the existing regularization suite.
  const legacyAdjust = async (newBalance, reason = 'Ajuste antigo fictício de QA') => {
    const h = harness({businessId: bid, spaceId: space, uid: owner});
    h.data().clientes = [await read('clients', clientId)]; h.c.PhoneUtils = {normalizeBrazilianPhone: v => v}; h.c.addEventListener = () => {};
    vm.runInContext(fs.readFileSync('js/clientes.js', 'utf8'), h.c);
    const before = bridge(h.data()), adjustment = h.c.Clientes.ajustarSaldo(clientId, newBalance, reason);
    // The server derives the balance event itself and refuses one supplied by the device.
    const writes = [...bridge(h.c.diffWrites(before, h.data())), {entityType: 'balanceAdjustments', entityId: adjustment.id, operation: 'create', data: bridge(adjustment)}];
    return svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: adjustment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
      payload: {eventKind: 'balance_adjustment', fiadoHistoryVersion: 1, writes}}}});
  };
  const noSideEffects = async () => {
    for (const col of ['sales', 'payments', 'stockMovements', 'paymentAllocations']) assert.equal(await size(col), 0, col);
    for (const id of [space, other]) assert.equal((await db.collection(`financialSpaces/${id}/entries`).get()).size, 0, 'caixa ' + id);
  };
  return {bid, owner, seller, manager, space, other, clientId, root, svc, req, preview, intent, apply, read, size, account, spaceDebt, legacyAdjust, noSideEffects, meter};
}

test('1. aumentar a dívida sem venda', async () => {
  const c = await setup(); await c.apply(15000);
  assert.equal((await c.read('clients', c.clientId)).saldo, -150);
  await c.noSideEffects();
  record('1', 'Aumentar a dívida sem venda', 'com restrições', 'Regularizar saldo de 0 para 150,00 no Espaço: proprietário, Espaço ativo, online e conta comprovável.');
});

test('2. diminuir a dívida sem recebimento fictício', async () => {
  const c = await setup(); await c.apply(15000); const r = await c.apply(10000);
  assert.equal(r.deltaDebtCents, -5000); assert.equal((await c.read('clients', c.clientId)).saldo, -100);
  await c.noSideEffects();
  record('2', 'Diminuir a dívida sem recebimento fictício', 'com restrições', 'Mesmo caminho, total menor; nenhum pagamento criado.');
});

test('3. zerar a dívida mediante ajuste', async () => {
  const c = await setup(); await c.apply(15000); await c.apply(0);
  assert.equal((await c.read('clients', c.clientId)).saldo, 0); assert.equal((await c.account()).totalCents, 0);
  record('3', 'Zerar a dívida mediante ajuste', 'com restrições', 'Total 0 aceito quando não há parcelas no Espaço.');
});

test('4. conceder crédito', async () => {
  const c = await setup(); const r = await c.intent(0);
  await assert.rejects(c.svc.commit({...r, data: {...r.data, targetDebtCents: -5000}}), e => e.code === 'invalid-argument');
  const simple = await setup(); await simple.legacyAdjust(50);
  assert.equal((await simple.read('clients', simple.clientId)).saldo, 50);
  record('4', 'Conceder crédito', 'lacuna', 'Regularizar recusa total negativo. O ajuste antigo ainda cria crédito em cliente simples no servidor, mas nenhuma tela o oferece.');
});

test('5. corrigir valor lançado incorretamente', async () => {
  const c = await setup(); await c.apply(15000); await c.apply(12000, {purpose: 'correction', reason: 'Correção fictícia do valor lançado em QA'});
  const adjustments = (await c.root.collection('balanceAdjustments').get()).docs.map(d => d.data());
  assert.equal(adjustments.length, 2); assert.ok(adjustments.every(a => !a.reversesOperationId && !a.correctsOperationId), 'nenhum vínculo com o lançamento corrigido');
  record('5', 'Corrigir valor lançado incorretamente', 'indireto', 'Só redefinindo o total (finalidade "correção"); não há estorno ligado ao ajuste errado.');
});

test('6. ajustes consecutivos', async () => {
  const c = await setup(); const stale = await c.intent(9000);
  for (const total of [15000, 18000, 16000]) await c.apply(total);
  await assert.rejects(c.svc.commit(stale), e => e.code === 'aborted');
  const client = await c.read('clients', c.clientId);
  assert.equal(client.financialVersion, 3); assert.equal(await c.size('balanceEvents'), 3);
  record('6', 'Ajustes consecutivos', 'com restrições', 'Funcionam em sequência, cada um com prévia nova; prévia anterior é recusada (versão).');
});

test('7. receber depois o valor ajustado', async () => {
  const c = await setup(); await c.apply(15000);
  const route = await c.svc.receipt(c.req('fiado_receipt_route', {scopedReceiptVersion: 1}));
  assert.equal(route.mode, 'space'); assert.equal(route.dueCents, 15000);
  record('7', 'Receber depois o valor ajustado', 'atende', 'Rota verificada do Espaço com o exigível do ajuste.');
});

test('8. histórico completo das alterações', async () => {
  const c = await setup(); await c.apply(15000); await c.apply(9000);
  const adjustments = (await c.root.collection('balanceAdjustments').get()).docs.map(d => d.data());
  for (const a of adjustments) for (const key of ['motivo', 'actorUid', 'saldoAnterior', 'saldoNovo', 'deltaDebtCents', 'spaceId', 'createdAt']) assert.ok(a[key] !== undefined, key);
  assert.equal(await c.size('balanceEvents'), adjustments.length);
  record('8', 'Histórico completo das alterações', 'parcial', 'O servidor guarda motivo, autor, antes e depois de cada ajuste; a interface mistura essa fonte com o histórico local.');
});

test('9. sincronizar entre dispositivos', async () => {
  const c = await setup(); const r = await c.apply(15000);
  const signal = (await c.root.collection('syncMetadata').doc('last-sync').get()).data();
  for (const name of ['clients', 'balanceAdjustments', 'balanceEvents']) assert.equal(signal.collectionVersions[name], 'server:' + r.operationId);
  record('9', 'Sincronizar entre dispositivos', 'com restrições', 'Sinal de sincronização marca clientes, ajustes e eventos; outro aparelho com operação do cliente na fila mantém o saldo retido.');
});

test('10. isolamento entre Espaços', async () => {
  const c = await setup(); await c.apply(7000, {spaceId: c.other}); await c.apply(15000); await c.apply(4000);
  const a = await c.account();
  assert.equal(c.spaceDebt(a, c.other), 7000); assert.equal(c.spaceDebt(a, c.space), 4000);
  record('10', 'Isolamento entre Espaços', 'atende', 'Ajustes em um Espaço não mudam o outro.');
});

test('11. sem faturamento, caixa ou estoque', async () => {
  const c = await setup(); await c.apply(15000); await c.apply(0); await c.noSideEffects();
  record('11', 'Sem faturamento, caixa ou estoque', 'atende', 'Nenhuma venda, pagamento, alocação, estoque ou lançamento de caixa.');
});

test('12. outros perfis e visão da empresa', async () => {
  const c = await setup();
  for (const uid of [c.seller, c.manager]) await assert.rejects(c.preview({}, uid), e => e.code === 'permission-denied');
  await assert.rejects(c.svc.receipt(c.req('fiado_space_regularization_preview', {spaceId: undefined})), e => ['invalid-argument', 'failed-precondition'].includes(e.code));
  record('12', 'Outros perfis e visão da empresa', 'lacuna', 'Vendedor e gerente com permissão de ajuste são recusados; sem Espaço não há ajuste.');
});

test('13. conta sem histórico comprovável não pode ser corrigida', async () => {
  const c = await setup(); await c.root.collection('clients').doc(c.clientId).update({saldo: -190});
  await assert.rejects(c.preview(), /comprovação|conferência/);
  record('13', 'Corrigir conta sem histórico comprovável', 'lacuna', 'Regularizar exige a prova que a própria correção deveria estabelecer.');
});

test('14. uma regularização muda o regime do cliente para sempre', async () => {
  const c = await setup(); await c.apply(15000);
  const client = await c.read('clients', c.clientId);
  assert.equal(client.fiadoHistoryVersion, 1); assert.equal(client.fiadoHistoryActivation.spaceRegularization.version, 1);
  await assert.rejects(c.legacyAdjust(-120), /Use Regularizar saldo/);
  assert.equal((await c.read('clients', c.clientId)).saldo, -150);
  record('14', 'Regime depois da primeira regularização', 'complexidade', 'Cliente fica com histórico comprovado e regularizado; o ajuste antigo passa a ser recusado (pacote bloqueado no aparelho).');
});

test('15. dois contratos de ajuste convivem', async () => {
  const c = await setup(); await c.legacyAdjust(-80);
  const client = await c.read('clients', c.clientId);
  assert.equal(client.saldo, -80); assert.equal(client.fiadoHistoryVersion, undefined);
  assert.equal(await c.size('balanceEvents'), 1);
  record('15', 'Ajuste antigo em cliente simples', 'complexidade', 'O servidor ainda aceita o contrato antigo (sem Espaço obrigatório) enquanto a tela só oferece o novo.');
});

test('leituras no servidor por ajuste, consulta da conta e recebimento, conforme o histórico', async () => {
  const c = await setup(); let events = 0;
  const measure = async (flow, fn) => { c.meter.take(); await fn(); const m = c.meter.take(); measures.push({flow, history: events, ...m}); return m; };
  const totals = [15000, 16000];
  for (const target of [0, 10, 30, 60]) {
    while (events < target) { await c.apply(totals[events % 2]); events++; }
    await measure('prévia do ajuste', () => c.preview());
    await measure('consulta da conta (fiado_account)', () => c.svc.receipt(c.req('fiado_account', {fiadoHistoryVersion: 1})));
    await measure('rota de recebimento', () => c.svc.receipt(c.req('fiado_receipt_route', {scopedReceiptVersion: 1})));
    const q = await c.intent(totals[events % 2]);
    await measure('confirmação do ajuste', () => c.svc.commit(q)); events++;
  }
  const at = flow => measures.filter(m => m.flow === flow).map(m => m.docs);
  for (const flow of ['prévia do ajuste', 'consulta da conta (fiado_account)', 'confirmação do ajuste']) {
    const docs = at(flow); assert.ok(docs.at(-1) > docs[0], flow + ' cresce com o histórico');
  }
});

test('leituras no servidor ao confirmar um recebimento depois de ajustes', async () => {
  for (const history of [10, 40]) {
    const c = await setup();
    for (let i = 0; i < history; i++) await c.apply(i % 2 ? 16000 : 15000);
    const route = await c.svc.receipt(c.req('fiado_receipt_route', {scopedReceiptVersion: 1}));
    const h = require('../helpers/owner-receipt-v219.cjs').harness({businessId: c.bid, spaceId: c.space, uid: c.owner});
    try {
      Object.assign(h.rows(), {clientes: [await c.read('clients', c.clientId)], vendas: [], pagamentos: [], alocacoesPagamento: []});
      h.w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
      const payment = h.w.Fiados.receber(c.clientId, 70, 'Pix fictício de QA', {spaceId: c.space, paymentMethod: 'pix', receiptRoute: route, fiadoAccount: route.scopedAccount});
      const request = {auth: {uid: c.owner}, data: {businessId: c.bid, clientRelease: 238, item: {operationId: payment.operationId, businessId: c.bid, userId: c.owner, workspaceGeneration: 0, payloadVersion: 4,
        payload: {eventKind: 'payment', fiadoHistoryVersion: 1, fiadoReceiptRoute: {version: 1, mode: route.mode, spaceId: c.space, quoteHash: route.quoteHash, scopedReceiptVersion: 1}, writes: h.writes()}}}};
      c.meter.take(); await c.svc.commit(request); const m = c.meter.take();
      measures.push({flow: 'confirmação do recebimento', history, ...m});
      assert.equal(await c.size('payments'), 1);
    } finally { h.close(); }
  }
  const docs = measures.filter(m => m.flow === 'confirmação do recebimento').map(m => m.docs);
  assert.ok(docs[1] > docs[0], 'cresce com o histórico');
});
