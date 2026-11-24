'use strict';
// Força-tarefa V242.10: cenários de prevenção que ainda não tinham teste próprio,
// com o código real da fila (js/firebase/sync.js) e um servidor fictício idempotente.
// Os demais cenários (internet instável, Wi-Fi sem internet, resposta perdida,
// fechar e reabrir, troca de usuário/empresa, permissão revogada, conflito de
// estoque, exceção repetida do servidor) estão em tests/sync-d3-recovery.test.cjs.
const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {queueRuntime, fakeServer, packet, section} = require('./helpers/sync-queue-runtime.cjs');

const sale = (id, spaceId) => {
  const p = packet(id);
  p.payload.writes[0].data = {...p.payload.writes[0].data, spaceId, valorFinal: 30};
  return p;
};
const effectsFor = (server, id) => server.effects.filter(e => e.endsWith(`:${id}`)).length;

test('atualização de versão no meio do envio: o recibo confirma a operação em voo e as pendentes saem uma vez', async () => {
  const stores = new Map(), server = fakeServer();
  const before = queueRuntime(stores, {server});
  const inFlight = {...sale('fx-v1', 'fx-space'), status: 'syncing', syncConfirmationPending: true, attempts: 1, lastAttemptAt: '2026-11-16T11:59:00.000Z'};
  before.context.saveQueue([inFlight, sale('fx-v2', 'fx-space'), sale('fx-v3', 'fx-space')]);
  // The server applied fx-v1, then the app was closed for the update before the answer.
  await server('commitOperationalSync', {businessId: 'qa-shop', item: inFlight}, before.context);
  assert.equal(server.applied.size, 1);
  // New version, same persisted queue. Login runs the real startup normalisation
  // (migrateScopedQueueCompatibility): an interrupted "syncing" packet becomes pending
  // and must prove its receipt before any resend.
  const after = queueRuntime(stores, {server});
  after.context.queueKey ||= () => 'qa-queue';
  Object.assign(after.context, {structuredClone, crypto: require('node:crypto').webcrypto, deviceId: () => 'fx-device', queueSubtype: () => 'sale',
    sanitizeForFirestore: (value) => JSON.parse(JSON.stringify(value)), PAYLOAD_VERSION: 4});
  const constant = section('const IDEMPOTENT_EVENT_NAMES =', ']);') + ']);';
  vm.runInContext(constant.replace('const IDEMPOTENT_EVENT_NAMES', 'this.IDEMPOTENT_EVENT_NAMES'), after.context);
  vm.runInContext(section('function migrateScopedQueueCompatibility(', 'function queueWrites('), after.context);
  assert.deepEqual(JSON.parse(JSON.stringify(after.context.migrateScopedQueueCompatibility())), {migrated: 1, blocked: 0});
  assert.equal(after.queue()[0].syncConfirmationPending, true);
  for (let i = 0; i < 6 && after.queue().length; i++) { after.tick(10 * 60 * 1000); await after.run(); }
  assert.equal(after.queue().length, 0, 'nothing left behind');
  for (const id of ['fx-v1', 'fx-v2', 'fx-v3']) assert.equal(effectsFor(server, id), 1, `${id} applied exactly once`);
  const resent = after.calls.filter(c => c.name === 'commitOperationalSync' && c.request.item.operationId === 'fx-v1').length;
  assert.equal(resent, 0, 'the in-flight operation is confirmed by its receipt, not sent again');
});

test('troca de Espaço com operações pendentes: cada operação sai com o Espaço em que foi feita', async () => {
  const stores = new Map(), server = fakeServer();
  const runtime = queueRuntime(stores, {server});
  runtime.context.saveQueue([sale('fx-a', 'fx-space-a'), sale('fx-b', 'fx-space-b')]);
  runtime.context.window.SpaceContext = {homeId: () => 'fx-space-c', salesId: () => 'fx-space-c', viewScope: () => 'fx-space-c'};
  await runtime.run();
  const sent = runtime.calls.filter(c => c.name === 'commitOperationalSync').map(c => [c.request.item.operationId, c.request.item.payload.writes[0].data.spaceId]);
  assert.deepEqual(JSON.parse(JSON.stringify(sent)), [['fx-a', 'fx-space-a'], ['fx-b', 'fx-space-b']]);
  assert.equal(runtime.queue().length, 0);
});

test('mesma operação em dois aparelhos (backup restaurado): um único efeito no servidor', async () => {
  const server = fakeServer();
  const phone = queueRuntime(new Map(), {server}), desktop = queueRuntime(new Map(), {server});
  phone.context.saveQueue([sale('fx-shared', 'fx-space')]);
  desktop.context.saveQueue([sale('fx-shared', 'fx-space'), sale('fx-desktop-only', 'fx-space')]);
  await Promise.all([phone.run(), desktop.run()]);
  for (const runtime of [phone, desktop]) {
    for (let i = 0; i < 6 && runtime.queue().length; i++) { runtime.tick(10 * 60 * 1000); await runtime.run(); }
    assert.equal(runtime.queue().length, 0);
  }
  assert.equal(effectsFor(server, 'fx-shared'), 1);
  assert.equal(effectsFor(server, 'fx-desktop-only'), 1);
});

test('sem conexão nada é enviado nem marcado como sincronizado; ao voltar, cada venda sai uma vez', async () => {
  const stores = new Map(), server = fakeServer();
  const runtime = queueRuntime(stores, {server});
  runtime.context.saveQueue([sale('fx-off-1', 'fx-space'), sale('fx-off-2', 'fx-space')]);
  runtime.context.navigator.onLine = false;
  server.network = 'unavailable';
  await runtime.run().catch(() => null);
  assert.equal(server.applied.size, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(runtime.marked)), [], 'nothing confirmed without the server');
  assert.equal(runtime.queue().length, 2, 'both stay saved on the device');
  runtime.context.navigator.onLine = true; server.network = 'up';
  for (let i = 0; i < 6 && runtime.queue().length; i++) { runtime.tick(10 * 60 * 1000); await runtime.run(); }
  assert.equal(runtime.queue().length, 0);
  assert.equal(effectsFor(server, 'fx-off-1') + effectsFor(server, 'fx-off-2'), 2);
});
