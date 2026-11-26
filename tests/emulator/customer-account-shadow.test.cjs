'use strict';
// Conta por Espaço, Fase 1 (modo sombra), no Emulator: operações reais do servidor
// (regularizações, recebimento verificado, ajuste antigo, crédito) e a entrega de cada
// evento do razão ao projetor, como o gatilho faria, inclusive repetida e fora de ordem.
// A conta deve conferir com o saldo cadastral e com a reconstrução do histórico.
// Dados fictícios; somente Emulator em loopback.
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const fs = require('node:fs'), vm = require('node:vm');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required');
const {initializeApp, deleteApp} = require('firebase-admin/app'), {getFirestore} = require('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
const {customerAccountService} = require('../../functions/src/services/customer-account-service');
const {harness, bridge} = require('../helpers/fiado-cancellation-harness.cjs');

// Etapa 5: this file exercises the trigger path, which remains the fallback when an operation
// cannot update the account in its own transaction; transactional updates are off here.
require('../../functions/src/services/customer-account-ledger-service').prepare = async () => null;
let app, db, seq = 0;
test.before(() => { app = initializeApp({projectId: 'demo-veconi-customer-account'}, 'customer-account'); db = getFirestore(app); });
test.after(async () => { await db.terminate(); await deleteApp(app); });

function metered(base) {
  const stats = {docs: 0, queries: 0};
  const wrap = tx => new Proxy(tx, {get(target, key) {
    if (key === 'get') return async ref => { const r = await target.get(ref); if (r && Array.isArray(r.docs)) { stats.queries++; stats.docs += r.size; } else stats.docs++; return r; };
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  }});
  return {db: new Proxy(base, {get(target, key) {
    if (key === 'runTransaction') return (fn, options) => target.runTransaction(tx => fn(wrap(tx)), options);
    const value = target[key]; return typeof value === 'function' ? value.bind(target) : value;
  }}), take() { const out = {...stats}; stats.docs = 0; stats.queries = 0; return out; }};
}

async function setup() {
  const bid = 'account-' + crypto.randomUUID(), owner = 'owner-' + (++seq), space = 'space-a-' + bid, other = 'space-b-' + bid, clientId = 'qa-client', root = db.doc('businesses/' + bid);
  await root.set({businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: {planId: 'internal', status: 'active'}});
  await db.doc('users/' + owner).set({uid: owner, businessId: bid, active: true, role: 'owner'});
  await root.collection('members').doc(owner).set({uid: owner, role: 'owner', status: 'active', spaceAccess: 'all', permissionsVersion: 2,
    permissions: {'customers.view': true, 'customers.adjustBalance': true, 'customers.receiveDebt': true, 'sales.create': true}});
  for (const id of [space, other]) await db.doc('financialSpaces/' + id).set({id, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner, capabilities: {sales: true, finance: true}});
  await root.collection('clients').doc(clientId).set({id: clientId, businessId: bid, nome: 'Pessoa QA', saldo: 0, financialVersion: 0, workspaceGeneration: 0, active: true, ativo: true, customerSpaceIds: [space, other]});
  const svc = operationalCommitService(db), meter = metered(db);
  const shadow = customerAccountService(meter.db), quiet = customerAccountService(meter.db, {verify: false});
  const req = (kind, input = {}) => ({auth: {uid: owner}, data: {businessId: bid, workspaceGeneration: 0, spaceId: space, clientId, kind, ...input}});
  const apply = async (total, extra = {}) => {
    const q = await svc.receipt(req('fiado_space_regularization_preview', extra));
    return svc.commit(req('fiado_space_regularization', {...extra, operationId: crypto.randomUUID(), quoteHash: q.quoteHash, financialVersion: q.financialVersion, targetDebtCents: total,
      purpose: 'historical_debt', reason: 'Ajuste conferido em anotação fictícia de QA', confirmed: true, localQueueChecked: true}));
  };
  const read = async (col, id) => (await root.collection(col).doc(id).get()).data();
  const events = async () => (await root.collection('balanceEvents').get()).docs.map(d => ({id: d.id, data: d.data()})).sort((a, b) => String(a.data.appliedAt).localeCompare(String(b.data.appliedAt)) || a.id.localeCompare(b.id));
  const delivered = new Set();
  // What the trigger does: one call per new event, in the order given.
  const deliver = async ({reverse = false, again = false, service = shadow} = {}) => {
    const pending = (await events()).filter(e => again || !delivered.has(e.id));
    const out = [];
    for (const e of reverse ? pending.reverse() : pending) { out.push(await service.applyEvent(bid, e.id, e.data)); delivered.add(e.id); }
    return out;
  };
  const account = () => read('customerAccounts', clientId);
  const legacyAdjust = async newBalance => {
    const h = harness({businessId: bid, spaceId: space, uid: owner});
    h.data().clientes = [await read('clients', clientId)]; h.c.PhoneUtils = {normalizeBrazilianPhone: v => v}; h.c.addEventListener = () => {};
    vm.runInContext(fs.readFileSync('js/clientes.js', 'utf8'), h.c);
    const before = bridge(h.data()), adjustment = h.c.Clientes.ajustarSaldo(clientId, newBalance, 'Ajuste antigo fictício de QA');
    return svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: adjustment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
      payload: {eventKind: 'balance_adjustment', fiadoHistoryVersion: 1, writes: [...bridge(h.c.diffWrites(before, h.data())), {entityType: 'balanceAdjustments', entityId: adjustment.id, operation: 'create', data: bridge(adjustment)}]}}}});
  };
  const receive = async amount => {
    const route = await svc.receipt(req('fiado_receipt_route', {scopedReceiptVersion: 1}));
    const h = require('../helpers/owner-receipt-v219.cjs').harness({businessId: bid, spaceId: space, uid: owner});
    try {
      Object.assign(h.rows(), {clientes: [await read('clients', clientId)], vendas: [], pagamentos: [], alocacoesPagamento: []});
      h.w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
      const payment = h.w.Fiados.receber(clientId, amount, 'Pix fictício de QA', {spaceId: space, paymentMethod: 'pix', receiptRoute: route, fiadoAccount: route.scopedAccount});
      await svc.commit({auth: {uid: owner}, data: {businessId: bid, clientRelease: 238, item: {operationId: payment.operationId, businessId: bid, userId: owner, workspaceGeneration: 0, payloadVersion: 4,
        payload: {eventKind: 'payment', fiadoHistoryVersion: 1, fiadoReceiptRoute: {version: 1, mode: route.mode, spaceId: space, quoteHash: route.quoteHash, scopedReceiptVersion: 1}, writes: h.writes()}}}});
    } finally { h.close(); }
  };
  return {bid, owner, space, other, clientId, root, svc, shadow, quiet, meter, apply, read, events, deliver, account, legacyAdjust, receive};
}
const statuses = results => results.map(r => r.status);

test('regularizações em dois Espaços: a conta acompanha cada evento e confere com o histórico', async () => {
  const c = await setup();
  for (const [total, extra] of [[15000, {}], [7000, {spaceId: 'B'}], [4000, {}], [0, {}]]) {
    await c.apply(total, extra.spaceId ? {spaceId: c.other} : {});
    const [result] = await c.deliver();
    assert.equal(result.verification.status, 'match', JSON.stringify(result.verification.differences));
  }
  const a = await c.account();
  assert.deepEqual(a.spaces, {[c.other]: 7000});
  assert.equal(a.debtCents, 7000); assert.equal(a.eventCount, 4); assert.equal(a.baseline.source, 'history_projection');
  assert.equal(a.verification.scoped, true);
});

test('entrega repetida e fora de ordem não muda a conta', async () => {
  const c = await setup(); await c.apply(15000); await c.deliver();
  for (const total of [18000, 9000, 12000]) await c.apply(total);
  assert.deepEqual(statuses(await c.deliver({reverse: true})), ['applied', 'applied', 'applied']);
  assert.deepEqual(statuses(await c.deliver({again: true})), ['duplicate', 'duplicate', 'duplicate', 'duplicate']);
  const a = await c.account();
  assert.equal(a.debtCents, 12000); assert.equal(a.eventCount, 4); assert.deepEqual(a.spaces, {[c.space]: 12000});
  assert.equal(a.verification.status, 'match');
});

test('conta criada no meio do histórico: a base vem da projeção e os eventos antigos não contam duas vezes', async () => {
  const c = await setup();
  for (const total of [10000, 15000, 8000, 11000, 9000]) await c.apply(total);
  const all = await c.events(), last = all.at(-1);
  const first = await c.shadow.applyEvent(c.bid, last.id, last.data);
  assert.equal(first.status, 'baseline'); assert.equal(first.verification.status, 'match');
  assert.deepEqual(statuses(await c.deliver()), ['in_baseline', 'in_baseline', 'in_baseline', 'in_baseline', 'duplicate']);
  await c.apply(13000); await c.deliver();
  const a = await c.account();
  assert.equal(a.debtCents, 13000); assert.equal(a.baseline.eventCount, 5); assert.equal(a.eventCount, 6); assert.equal(a.verification.status, 'match');
});

test('recebimento verificado reduz o Espaço de origem, sem tocar o outro', async () => {
  const c = await setup(); await c.apply(15000); await c.apply(7000, {spaceId: c.other}); await c.deliver();
  await c.receive(70); const results = await c.deliver();
  assert.equal(results.at(-1).verification.status, 'match', JSON.stringify(results.at(-1).verification.differences));
  const a = await c.account();
  assert.deepEqual(a.spaces, {[c.space]: 8000, [c.other]: 7000}); assert.equal(a.debtCents, 15000);
});

test('ajuste antigo sem Espaço e crédito: a conta separa o não atribuído e confere o saldo cadastral', async () => {
  const c = await setup(); await c.legacyAdjust(-80);
  const [first] = await c.deliver();
  assert.ok(['match', 'balance_only'].includes(first.verification.status), JSON.stringify(first.verification));
  let a = await c.account();
  assert.equal(a.unattributedCents, 8000); assert.equal(a.debtCents, 8000);
  await c.legacyAdjust(50); const [second] = await c.deliver();
  a = await c.account();
  assert.equal(a.debtCents, -5000, 'crédito é dívida negativa');
  assert.ok(['match', 'balance_only'].includes(second.verification.status), JSON.stringify(second.verification));
  assert.ok(!second.verification.differences.some(d => d.kind === 'balance'), 'saldo cadastral confere');
});

test('saldo antigo sem eventos aparece como não explicado, sem inventar origem', async () => {
  const c = await setup(); await c.root.collection('clients').doc(c.clientId).update({saldo: -190});
  await c.legacyAdjust(-200); const [result] = await c.deliver();
  const a = await c.account();
  assert.equal(a.baseline.source, 'event_sum'); assert.equal(a.debtCents, 1000); assert.equal(a.baseline.unexplainedCents, 19000);
  assert.equal(result.verification.status, 'balance_only'); assert.ok(result.verification.unprovableReason);
});

test('eventos não confirmados, de outra empresa ou com o projetor desligado não gravam nada', async () => {
  const c = await setup();
  const fake = {type: 'balance_adjustment', customerId: c.clientId, businessId: c.bid, workspaceGeneration: 0, balanceDelta: -10, appliedAt: new Date().toISOString(), spaceId: c.space};
  assert.equal((await c.shadow.applyEvent(c.bid, 'x1', {...fake, status: 'pending'})).status, 'ignored');
  assert.equal((await c.shadow.applyEvent(c.bid, 'x2', {...fake, status: 'applied', businessId: 'foreign'})).status, 'ignored');
  assert.equal((await c.shadow.applyEvent(c.bid, 'x3', {...fake, status: 'applied', workspaceGeneration: 1})).status, 'ignored');
  assert.equal((await customerAccountService(db, {enabled: false}).applyEvent(c.bid, 'x4', {...fake, status: 'applied'})).status, 'disabled');
  assert.equal(await c.account(), undefined);
});

test('leituras do projetor: poucas por evento, independentemente do histórico', async () => {
  const c = await setup(), rows = [];
  let current = 0, count = 0;
  // Each regularization must change the total, or the server refuses it as a no-op.
  const step = async total => { await c.apply(total); current = total; count++; };
  for (const total of [10000, 15000]) await step(total);
  c.meter.take(); await c.deliver({service: c.quiet}); const baseline = c.meter.take();
  for (const size of [10, 40]) {
    while (count < size) { await step(current === 15000 ? 16000 : 15000); await c.deliver({service: c.quiet}); }
    await step(current === 14000 ? 13000 : 14000); c.meter.take(); const [applied] = await c.deliver({service: c.quiet}); const apply = c.meter.take();
    assert.equal(applied.status, 'applied');
    c.meter.take(); const v = await c.shadow.verifyClient(c.bid, c.clientId); const verify = c.meter.take();
    assert.equal(v.status, 'match');
    rows.push({history: size + 1, apply: apply.docs, verify: verify.docs});
  }
  console.log('[projetor] base (2 eventos):', baseline.docs, 'documentos;', rows.map(r => `histórico ${r.history}: aplicar ${r.apply}, verificar ${r.verify}`).join(' | '));
  assert.ok(rows.every(r => r.apply <= 3), 'aplicar um evento lê no máximo 3 documentos');
  assert.ok(rows[1].verify > rows[0].verify, 'a verificação reconstrói o histórico e cresce com ele');
});
