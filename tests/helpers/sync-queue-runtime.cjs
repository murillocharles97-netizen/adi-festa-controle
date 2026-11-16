'use strict';
// Real queue code from js/firebase/sync.js (classification, receipts, retry budget,
// processSyncQueue and the retry timer) with a controllable clock, network and server.
// The queue is stored per uid + business, like the app's adiFesta:<namespace>:syncQueue.
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const vm = require('node:vm');
const { canonical } = require('../../js/sale-recovery-client');

const source = fs.readFileSync('js/firebase/sync.js', 'utf8');
const section = (start, end) => {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert.ok(a >= 0 && b > a, `section ${start}`);
  return source.slice(a, b);
};
const hash = (value) => createHash('sha256').update(canonical(value)).digest('hex');

function queueRuntime(stores, { uid = 'qa-owner', businessId = 'qa-shop', version = 1, server, start = Date.parse('2026-11-16T12:00:00Z') } = {}) {
  let clock = start, serial = 0;
  const timers = new Map(), calls = [], marked = [], errors = [], emitted = [];
  const key = () => `${context.currentUser.uid}:${context.activeBusinessId()}`;
  const queue = () => JSON.parse(stores.get(key()) || '[]');
  const context = vm.createContext({
    Date: class extends Date { static now() { return clock; } }, navigator: { onLine: true }, JSON, Math, Number, String, Set, Map, Object, Array, Promise, Error,
    now: () => new Date(++clock).toISOString(), currentUser: { uid }, auth: { currentUser: { uid } },
    syncSessionGeneration: 1, readOnlyMode: false, cloudPaused: false, currentPath: '',
    processingPromise: null, manualSyncPromise: null, automaticSyncPromise: null,
    queueRetryTimer: null, queueRetryWakes: new Map(), state: { userProfile: { businessId }, operationalProtocol: { queueRecoveryVersion: version } },
    business: businessId, activeBusinessId: () => context.business, DB: { getWorkspaceGeneration: () => 0, flush: async () => {} },
    readQueue: queue, readQueueStrict: queue, saveQueue: (rows) => { stores.set(key(), JSON.stringify(rows)); },
    queueCounts: () => ({ pending: queue().filter((x) => x.status === 'pending').length, errors: queue().filter((x) => x.status === 'error').length }),
    setTimeout(fn, delay) { timers.set(++serial, { fn, at: clock + delay }); return serial; },
    clearTimeout: (id) => timers.delete(id),
    queueQuarantineReason: () => '', paymentQueueRequiresReview: () => false, paymentQueueDependsOnReview: () => false,
    readPaymentRecoveryReceipt: () => null, readRecoveryResolution: () => null, readQueueArchive: () => null,
    recoveryResolutionKey: (item) => 'qa-resolution:' + item.operationId,
    checksumValue: hash, localStorage: { getItem: () => null, setItem: () => {} },
    canWriteSharedSettings: () => true, saleQueueRequiresReview: () => false, queuePreflight: () => ({ ok: true }),
    queueErrorBreakdown: () => ({}), validateUser: async () => {}, refreshRecoveryResolutions: async () => {},
    preserveQueueQuarantine: () => {}, retireSettingsPermissionFailure: () => {},
    emit: (event) => emitted.push(event), reportError: (err) => errors.push(err.code || String(err.message || err).slice(0, 80)), updateQueueState: () => {}, traceSync: () => {},
    errorCode: (err) => String(err?.code || '').replace(/^(?:functions|firestore)\//, ''),
    paymentHash: async (v) => hash(v), stableLegacyOperationId: (item) => item.operationId,
    CLOUD_NAMES: ['sales', 'payments', 'products', 'clients', 'stockMovements'], QUEUE_ENTITY_ALIASES: {},
    verifySaleQueueCommit: async () => {}, markLocalSaleConfirmed: (item) => marked.push(item.operationId),
    markLocalPaymentConfirmed: (item) => { if (item.payload?.writes?.some((w) => w.entityType === 'payments')) marked.push(item.operationId); },
    automaticSync: () => context.processSyncQueue(),
  });
  context.captureCloudReadScope = () => `${context.currentUser.uid}:${context.activeBusinessId()}:${context.syncSessionGeneration}`;
  context.assertCloudReadScope = (scope) => {
    if (scope !== context.captureCloudReadScope()) throw Object.assign(Error('Session retired'), { code: 'sync-session-retired' });
  };
  context.window = { WorkspaceRuntime: { capture() {} }, FirebaseCallable: async (name, request) => {
    calls.push({ name, uid: context.currentUser.uid, business: context.activeBusinessId(), request: structuredClone(request) });
    return server(name, request, context);
  } };
  vm.runInContext([
    section('function classifyQueueOperation(', 'async function assertCancellationQueueClear('),
    section('const retryDelay =', 'function paymentQueueRequiresReview('),
    section('function queueManualReviewReason(', 'function preserveQueueQuarantine('),
    section('function readRecoveryResolution(', 'async function refreshRecoveryResolutions('),
    section('const queuedReceiptReview =', 'async function verifySaleQueueCommit('),
    section('async function processSyncQueue(', 'function pendingIds('),
    'this.__d3={unknownSyncOutcome,queueRetryDelay,setRestored:at=>{connectionRestoredAt=at;}};',
  ].join('\n'), context);
  const advance = async () => {
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    assert.ok(next, 'expected an automatic timer');
    timers.delete(next[0]);
    clock = next[1].at;
    await next[1].fn();
    if (context.processingPromise) await context.processingPromise;
    return next[1].at;
  };
  return { context, queue, calls, marked, errors, emitted, timers, advance, run: () => context.processSyncQueue(),
    tick: (ms) => { clock += ms; }, clock: () => clock };
}

// A fake commitOperationalSync + getOperationalSyncReceipt with real idempotency:
// effects are applied once per operationId, whatever the transport does.
function fakeServer() {
  const applied = new Map(), effects = [];
  let network = 'up', failNextResponse = 0, rejectNext = null, serverException = 0;
  const transport = (code = 'internal', message = 'internal') => Object.assign(Error(message), { code: `functions/${code}` });
  const handler = async (name, request, context) => {
    if (network === 'internal') throw transport('internal');
    if (network === 'unavailable') throw transport('unavailable', 'Service Unavailable');
    if (network === 'timeout') throw transport('deadline-exceeded', 'deadline-exceeded');
    if (name === 'getOperationalSyncReceipt') {
      assert.equal(request.kind, 'queued_operation_status');
      const status = applied.has(request.operationId) ? 'applied' : 'absent';
      return { data: { version: 1, businessId: request.businessId, operationId: request.operationId, workspaceGeneration: 0, status } };
    }
    assert.equal(name, 'commitOperationalSync');
    const item = request.item;
    // The server re-validates identity on every request.
    assert.equal(item.userId, context.currentUser.uid);
    assert.equal(request.businessId, context.activeBusinessId());
    if (rejectNext) { const error = rejectNext; rejectNext = null; throw error; }
    if (serverException) { serverException--; throw transport('internal', 'INTERNAL'); }
    if (!applied.has(item.operationId)) {
      applied.set(item.operationId, hash(item.payload));
      for (const write of item.payload.writes) effects.push(`${write.entityType}:${write.entityId}:${item.operationId}`);
    }
    if (failNextResponse) { failNextResponse--; throw transport('internal'); } // applied, response lost
    return { data: { operationId: item.operationId, replayed: false } };
  };
  Object.defineProperty(handler, 'network', { get: () => network, set: (value) => { network = value; } });
  return Object.assign(handler, {
    applied, effects,
    loseNextResponses(n = 1) { failNextResponse = n; },
    reject(code, message, details) { rejectNext = Object.assign(Error(message), { code: `functions/${code}`, ...(details ? { details } : {}) }); },
    throwServerException(n) { serverException = n; },
  });
}

const packet = (id, { entityType = 'sales', entityId = id, uid = 'qa-owner', businessId = 'qa-shop', extra = {} } = {}) => ({
  queueId: id, operationId: id, businessId, userId: uid, workspaceGeneration: 0, syncProtocolVersion: 1, payloadVersion: 4,
  status: 'pending', ...extra,
  payload: { eventKind: entityType === 'payments' ? 'payment' : entityType === 'sales' ? 'sale' : 'simple', writes: [
    { entityType, entityId, operation: entityType === 'products' ? 'update' : 'create', data: { operationId: id, produtoId: 'qa-product', active: true } },
  ] },
});

module.exports = { queueRuntime, fakeServer, packet, section, hash };
