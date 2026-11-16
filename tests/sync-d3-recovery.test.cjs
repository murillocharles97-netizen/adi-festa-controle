'use strict';
// D3 — recuperação automática segura após falhas temporárias de comunicação.
// Runs the REAL queue code of js/firebase/sync.js against an idempotent fake server.
const test = require('node:test'), assert = require('node:assert/strict');
const { queueRuntime, fakeServer, packet, hash } = require('./helpers/sync-queue-runtime.cjs');

const dispatches = (h, id) => h.calls.filter((c) => c.name === 'commitOperationalSync' && (!id || c.request.item.operationId === id));
const receipts = (h) => h.calls.filter((c) => c.name === 'getOperationalSyncReceipt');
const single = (server, id) => server.effects.filter((e) => e.endsWith(':' + id)).length;
const store = (...rows) => new Map([['qa-owner:qa-shop', JSON.stringify(rows)]]);

test('classificação: só um erro sem resposta tipada é "resultado desconhecido"', () => {
  const h = queueRuntime(store(), { server: fakeServer() }), u = h.context.__d3.unknownSyncOutcome;
  for (const code of ['internal', 'unknown', 'unavailable', 'deadline-exceeded', 'aborted', 'network-request-failed'])
    assert.equal(u({ code: `functions/${code}` }), true, code);
  assert.equal(u({ code: 'functions/internal', details: { reason: 'stock_delta_mismatch', category: 'stock_conflict' } }), false, 'internal tipado é resposta do servidor');
  for (const code of ['permission-denied', 'failed-precondition', 'invalid-argument', 'already-exists', 'unauthenticated'])
    assert.equal(u({ code: `functions/${code}` }), false, code);
  assert.equal(u(new TypeError('bug local')), false, 'erro de código local não vira "conexão"');
});

test('internet instável: a venda fica pendente (não "erro"), confere o recibo e é aplicada uma única vez', async () => {
  const server = fakeServer(), sale = packet('sale-1'), h = queueRuntime(store(sale), { server });
  server.network = 'internal';
  await h.run();
  const [waiting] = h.queue();
  assert.equal(waiting.status, 'pending');
  assert.equal(waiting.syncConfirmationPending, true);
  assert.equal(waiting.lastErrorOutcome, 'unknown');
  assert.equal(h.context.classifyQueueOperation(waiting).activeError, false, 'não conta como erro ativo');
  assert.deepEqual(waiting.payload, sale.payload);
  server.network = 'up';
  await h.advance();
  assert.deepEqual(h.calls.map((c) => c.name), ['commitOperationalSync', 'getOperationalSyncReceipt', 'commitOperationalSync']);
  assert.equal(receipts(h)[0].request.payloadHash, hash(sale.payload));
  for (const call of dispatches(h)) { assert.equal(call.request.item.operationId, 'sale-1'); assert.deepEqual(call.request.item.payload, sale.payload); }
  assert.deepEqual(h.queue(), []);
  assert.equal(single(server, 'sale-1'), 1);
});

test('Wi-Fi sem internet: esperas crescentes até 5 min, sem gastar o limite de envios, e retomada sozinha', async () => {
  const server = fakeServer(), h = queueRuntime(store(packet('sale-1'), packet('sale-2')), { server });
  server.network = 'internal';
  await h.run();
  assert.equal(dispatches(h).length, 2, 'primeira passagem: cada operação tenta uma vez');
  const delays = [];
  for (let i = 0; i < 24 && !delays.filter((d) => d === 300000).length; i++) {
    const before = h.clock(); await h.advance(); delays.push(h.clock() - before);
  }
  for (let i = 0; i < 4; i++) { const before = h.clock(); await h.advance(); delays.push(h.clock() - before); }
  assert.equal(dispatches(h).length, 2, 'nenhum reenvio às cegas enquanto o recibo não responde');
  const [first, second] = h.queue();
  assert.equal(first.attempts, 1, 'o limite de 6 envios não é consumido sem servidor');
  assert.ok(first.connectionWaits >= 5);
  assert.equal(second.attempts, 1, 'cada operação mantém sua própria espera, sem gastar envios');
  const waits = delays.filter((d) => d > 1000);
  assert.ok(Math.max(...delays) <= 300000 && waits.slice(-2).every((d) => d === 300000), `esperas ${delays}`);
  assert.ok(waits.slice(0, 5).every((d, i, all) => !i || d > all[i - 1]), `esperas crescentes ${waits}`);
  assert.ok(h.emitted.some((e) => /Sem resposta do servidor\. As operações estão salvas/.test(e.message)));
  server.network = 'up';
  await h.advance();
  if (h.queue().length) await h.advance();
  assert.deepEqual(h.queue(), []);
  assert.equal(single(server, 'sale-1'), 1); assert.equal(single(server, 'sale-2'), 1);
});

test('Firebase indisponível (unavailable) e timeout (deadline-exceeded) seguem o mesmo caminho seguro', async () => {
  for (const mode of ['unavailable', 'timeout']) {
    const server = fakeServer(), h = queueRuntime(store(packet('sale-1')), { server });
    server.network = mode;
    await h.run(); await h.advance(); await h.advance();
    assert.equal(h.queue()[0].status, 'pending', mode);
    assert.equal(dispatches(h).length, 1, mode);
    server.network = 'up';
    await h.advance();
    assert.deepEqual(h.queue(), [], mode);
    assert.equal(single(server, 'sale-1'), 1, mode);
  }
});

test('servidor aplica a venda e a resposta não chega: o recibo confirma e não há segundo envio', async () => {
  const server = fakeServer(), h = queueRuntime(store(packet('sale-1')), { server });
  server.loseNextResponses(1);
  await h.run();
  assert.equal(h.queue()[0].status, 'pending');
  await h.advance();
  assert.deepEqual(h.calls.map((c) => c.name), ['commitOperationalSync', 'getOperationalSyncReceipt']);
  assert.deepEqual(h.queue(), []);
  assert.deepEqual(h.marked, ['sale-1']);
  assert.equal(single(server, 'sale-1'), 1);
});

test('fechar e reabrir: a fila persistida retoma pelo recibo; pacotes marcados como erro pelo D3 são requalificados', async () => {
  const server = fakeServer(), stores = store(packet('sale-1'));
  const first = queueRuntime(stores, { server });
  server.network = 'internal';
  await first.run(); await first.advance();
  // App closed. A packet saved by an older build as a permanent error (the D3 defect):
  const legacy = packet('sale-old', { extra: { status: 'error', attempts: 1, lastAttemptAt: '2026-11-16T11:00:00Z',
    lastErrorCode: 'internal', lastErrorMessage: 'internal', lastErrorStage: 'server_operational_commit' } });
  stores.set('qa-owner:qa-shop', JSON.stringify([...JSON.parse(stores.get('qa-owner:qa-shop')), legacy]));
  server.network = 'up';
  const reopened = queueRuntime(stores, { server, start: first.clock() + 60000 });
  reopened.context.__d3.setRestored(reopened.clock()); // AppLifecycle.onResume
  reopened.tick(5000);
  await reopened.run();
  assert.deepEqual(reopened.calls.map((c) => `${c.name}:${c.request.operationId || c.request.item.operationId}`),
    ['getOperationalSyncReceipt:sale-1', 'commitOperationalSync:sale-1', 'getOperationalSyncReceipt:sale-old', 'commitOperationalSync:sale-old'],
    'sempre recibo antes do reenvio, inclusive para o pacote antigo');
  assert.deepEqual(reopened.queue(), []);
  assert.equal(single(server, 'sale-1'), 1); assert.equal(single(server, 'sale-old'), 1);
});

test('pacote antigo em erro D3 já aplicado no servidor é confirmado sem reenvio', async () => {
  const server = fakeServer();
  const legacy = packet('sale-old', { extra: { status: 'error', attempts: 1, lastAttemptAt: '2026-11-16T11:00:00Z',
    lastErrorCode: 'internal', lastErrorMessage: 'internal', lastErrorStage: 'server_operational_commit' } });
  server.applied.set('sale-old', hash(legacy.payload)); server.effects.push('sales:sale-old:sale-old');
  const h = queueRuntime(store(legacy), { server });
  await h.run();
  assert.deepEqual(h.calls.map((c) => c.name), ['getOperationalSyncReceipt']);
  assert.deepEqual(h.queue(), []); assert.deepEqual(h.marked, ['sale-old']);
  assert.equal(single(server, 'sale-old'), 1);
});

test('troca de usuário: a sessão nova não envia nem confirma operações da anterior', async () => {
  const server = fakeServer(), stores = store(packet('sale-a'));
  const h = queueRuntime(stores, { server });
  server.network = 'internal';
  await h.run();
  h.context.currentUser = { uid: 'qa-seller' }; h.context.auth.currentUser = { uid: 'qa-seller' }; h.context.syncSessionGeneration++;
  server.network = 'up';
  await assert.rejects(h.advance(), { code: 'sync-session-retired' }).catch(() => {});
  await h.run();
  assert.equal(dispatches(h).length, 1, 'nada da vendedora / nada da sessão antiga');
  assert.equal(JSON.parse(stores.get('qa-owner:qa-shop'))[0].operationId, 'sale-a', 'a venda do dono continua preservada');
  h.context.currentUser = { uid: 'qa-owner' }; h.context.auth.currentUser = { uid: 'qa-owner' }; h.context.syncSessionGeneration++;
  h.tick(600000);
  await h.run();
  assert.deepEqual(h.queue(), []);
  assert.ok(h.calls.filter((c) => c.name === 'commitOperationalSync').every((c) => c.uid === c.request.item.userId));
  assert.equal(single(server, 'sale-a'), 1);
});

test('troca de empresa: operações ficam na empresa de origem e só voltam a ela', async () => {
  const server = fakeServer(), stores = store(packet('sale-shop'));
  const h = queueRuntime(stores, { server });
  server.network = 'internal';
  await h.run();
  h.context.business = 'qa-other'; h.context.syncSessionGeneration++;
  server.network = 'up';
  h.tick(600000);
  await h.run();
  assert.equal(dispatches(h).length, 1);
  assert.equal(JSON.parse(stores.get('qa-owner:qa-shop'))[0].status, 'pending');
  h.context.business = 'qa-shop'; h.context.syncSessionGeneration++;
  await h.run();
  assert.deepEqual(h.queue(), []);
  assert.ok(dispatches(h).every((c) => c.request.businessId === c.request.item.businessId));
  assert.equal(single(server, 'sale-shop'), 1);
});

test('permissão revogada com a venda pendente: recusa definitiva, preservada, sem tentativas automáticas', async () => {
  for (const details of [{ reason: 'sales_permission_required', category: 'permission', rejectionSchema: 1 }, undefined]) {
    const server = fakeServer(), sale = packet('sale-1'), h = queueRuntime(store(sale), { server });
    server.network = 'internal';
    await h.run();
    server.network = 'up';
    server.reject('permission-denied', 'Permissão de venda/cancelamento ausente.', details);
    await h.advance();
    const [held] = h.queue();
    assert.equal(held.status, 'error');
    assert.equal(held.lastErrorCode, 'permission-denied');
    assert.equal(held.lastErrorOutcome, 'rejected');
    assert.deepEqual(held.payload, sale.payload);
    assert.equal(h.timers.size, 0, 'recusa definitiva não agenda reenvio');
    await h.run();
    assert.equal(dispatches(h).length, 2, 'nenhum envio extra');
    assert.equal(single(server, 'sale-1'), 0);
  }
});

test('conflito de estoque e recusa de negócio nunca são tratados como falha de internet', async () => {
  const server = fakeServer(), h = queueRuntime(store(packet('sale-1')), { server });
  server.reject('failed-precondition', 'Estoque insuficiente ou reservado.', { reason: 'stock_insufficient', category: 'stock_conflict' });
  await h.run();
  const [held] = h.queue();
  assert.equal(held.status, 'error'); assert.equal(held.lastErrorOutcome, 'rejected');
  assert.equal(held.syncConfirmationPending, undefined);
  assert.equal(h.timers.size, 0);
});

test('exceção real e repetida do servidor (internal) não vira loop: no máximo 6 envios e revisão', async () => {
  const server = fakeServer(), h = queueRuntime(store(packet('sale-1')), { server });
  server.throwServerException(99);
  await h.run();
  for (let i = 0; i < 6 && h.timers.size; i++) await h.advance();
  assert.equal(dispatches(h).length, 6);
  assert.equal(h.queue()[0].lastErrorCode, 'sync-retry-exhausted');
  assert.equal(h.timers.size, 0);
});

test('recebimento com resultado desconhecido nunca é reenviado sem prova positiva', async () => {
  const server = fakeServer(), h = queueRuntime(store(packet('pay-1', { entityType: 'payments' })), { server });
  server.network = 'internal';
  await h.run();
  server.network = 'up';
  await h.advance();
  assert.equal(dispatches(h).length, 1);
  assert.equal(h.queue()[0].lastErrorCode, 'sync-receipt-review-required');
  assert.equal(single(server, 'pay-1'), 0);
});

test('diversas operações acumuladas: dependência respeitada e cada uma aplicada exatamente uma vez', async () => {
  const server = fakeServer();
  const rows = ['sale-1', 'sale-2', 'sale-3'].map((id) => packet(id, { entityType: 'products', entityId: 'qa-product' }));
  rows.push(packet('client-1', { entityType: 'clients', entityId: 'qa-client' }));
  const h = queueRuntime(store(...rows), { server });
  server.network = 'internal';
  await h.run();
  for (let i = 0; i < 4; i++) await h.advance();
  server.network = 'up';
  for (let i = 0; i < 8 && h.queue().length; i++) { if (h.timers.size) await h.advance(); else { h.tick(300000); await h.run(); } }
  assert.deepEqual(h.queue(), []);
  for (const id of ['sale-1', 'sale-2', 'sale-3', 'client-1']) assert.equal(single(server, id), 1, id);
  const order = dispatches(h).map((c) => c.request.item.operationId).filter((id, i, all) => all.indexOf(id) === i);
  assert.deepEqual(order.filter((id) => id.startsWith('sale')), ['sale-1', 'sale-2', 'sale-3'], 'mesmo produto: em ordem');
});

test('retorno da conexão: o evento online antecipa a retomada em vez de esperar 5 min', async () => {
  const server = fakeServer(), h = queueRuntime(store(packet('sale-1')), { server });
  server.network = 'internal';
  await h.run();
  for (let i = 0; i < 6; i++) await h.advance();
  const waiting = h.queue()[0];
  assert.equal(h.context.__d3.queueRetryDelay(waiting), 300000);
  server.network = 'up';
  h.context.__d3.setRestored(h.clock()); // addEventListener('online')
  h.tick(5000);
  await h.run(); // scheduleImmediate → automaticSync
  assert.deepEqual(h.queue(), []);
  assert.equal(single(server, 'sale-1'), 1);
});

test('sincronização automática sem resposta no início da passagem continua tentando (máx. 5 min) enquanto houver fila', async () => {
  const { section } = require('./helpers/sync-queue-runtime.cjs');
  const vm = require('node:vm');
  const server = fakeServer(), h = queueRuntime(store(packet('sale-1')), { server }), c = h.context;
  let failures = 0;
  Object.assign(c, { quickTimer: null, syncConnectionAttempts: 0, document: { visibilityState: 'hidden' },
    syncStep: async (_stage, action) => action(), safePublishSyncSignal: async () => {},
    writeSyncTime() {}, lastAttemptKey: () => '', lastSyncKey: () => '', lastCompleteKey: () => '', preservedQueueMessage: () => '', describeSyncResult: () => '',
    testFirestoreConnection: async () => { if (++failures <= 9) throw Object.assign(Error('internal'), { code: 'functions/internal' }); c.state.testPassed = true; } });
  vm.runInContext(section('async function runAutomaticSync(', 'function startAutoSync('), c);
  await c.automaticSync();
  const delays = [];
  while (failures <= 9) { const before = h.clock(); await h.advance(); delays.push(h.clock() - before); }
  assert.equal(failures, 10, 'não desistiu após 5 tentativas porque há venda na fila');
  assert.ok(Math.max(...delays) <= 300000 + 10, `esperas ${delays}`);
  assert.deepEqual(h.errors, [], 'resultado desconhecido não é reportado como falha definitiva');
  assert.deepEqual(h.queue(), []);
  assert.equal(single(server, 'sale-1'), 1);
  assert.ok(h.emitted.some((e) => /Sem resposta confirmada do servidor/.test(e.message)));
});

test('sem fila pendente, a sincronização automática mantém o limite de 5 tentativas', async () => {
  const { section } = require('./helpers/sync-queue-runtime.cjs');
  const vm = require('node:vm');
  const h = queueRuntime(store(), { server: fakeServer() }), c = h.context;
  let failures = 0;
  Object.assign(c, { quickTimer: null, syncConnectionAttempts: 0, document: { visibilityState: 'hidden' },
    syncStep: async (_stage, action) => action(), safePublishSyncSignal: async () => {},
    writeSyncTime() {}, lastAttemptKey: () => '', lastSyncKey: () => '', lastCompleteKey: () => '', preservedQueueMessage: () => '', describeSyncResult: () => '',
    testFirestoreConnection: async () => { failures++; throw Object.assign(Error('internal'), { code: 'functions/internal' }); } });
  vm.runInContext(section('async function runAutomaticSync(', 'function startAutoSync('), c);
  await c.automaticSync();
  while (h.timers.size) await h.advance();
  assert.equal(failures, 6);
  assert.equal(h.errors.length, 1);
});
