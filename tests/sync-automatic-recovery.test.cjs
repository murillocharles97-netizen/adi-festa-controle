'use strict';
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const fs = require('node:fs');
const test = require('node:test');
const vm = require('node:vm');
const { canonical } = require('../js/sale-recovery-client');

const source = fs.readFileSync('js/firebase/sync.js', 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
const businessId = 'qa-shop';
const uid = 'qa-owner';
const transient = () => Object.assign(Error('Lost connection'), { code: 'functions/unavailable' });
const packet = (id, entityType = 'products', entityId = 'qa-product') => ({
  queueId: id, operationId: id, businessId, userId: uid, workspaceGeneration: 0, syncProtocolVersion: 1,
  status: 'pending', payload: { eventKind: entityType === 'payments' ? 'payment' : 'simple', writes: [
    { entityType, entityId, operation: entityType === 'payments' ? 'create' : 'update', data: { active: true } },
  ] },
});

function runtime(packets, { onCommit, onReceipt, version = 1 } = {}) {
  let stored = JSON.stringify(packets), clock = Date.parse('2026-11-15T12:00:00Z'), serial = 0;
  const timers = new Map(), receipts = new Map(), resolutions = new Map(), calls = [], marked = [], errors = [];
  const queue = () => JSON.parse(stored);
  const context = vm.createContext({
    Date: class extends Date { static now() { return clock; } }, navigator: { onLine: true },
    now: () => new Date(++clock).toISOString(), currentUser: { uid }, auth: { currentUser: { uid } },
    syncSessionGeneration: 1, readOnlyMode: false, cloudPaused: false, currentPath: '',
    processingPromise: null, manualSyncPromise: null, automaticSyncPromise: null,
    queueRetryTimer: null, queueRetryWakes: new Map(), state: { userProfile: { businessId }, operationalProtocol: { queueRecoveryVersion: version } },
    activeBusinessId: () => businessId, DB: { getWorkspaceGeneration: () => 0, flush: async () => {} },
    readQueue: queue, readQueueStrict: queue, saveQueue: rows => { stored = JSON.stringify(rows); },
    queueCounts: () => ({ pending: queue().filter(x => x.status === 'pending').length, errors: queue().filter(x => x.status === 'error').length }),
    setTimeout(fn, delay) { timers.set(++serial, { fn, at: clock + delay }); return serial; },
    clearTimeout: id => timers.delete(id),
    queueQuarantineReason: () => '', paymentQueueRequiresReview: () => false, paymentQueueDependsOnReview: () => false,
    readPaymentRecoveryReceipt: () => null, readRecoveryResolution: () => null, readQueueArchive: () => null,
    recoveryResolutionKey: item => 'qa-resolution:'+item.operationId,
    checksumValue: v => createHash('sha256').update(canonical(v)).digest('hex'),
    localStorage: { getItem: key => resolutions.get(key)||null, setItem: (key,value) => resolutions.set(key,value) },
    canWriteSharedSettings: () => true, saleQueueRequiresReview: () => false, queuePreflight: () => ({ ok: true }),
    queueErrorBreakdown: () => ({}), validateUser: async () => {}, refreshRecoveryResolutions: async () => {},
    preserveQueueQuarantine: () => {}, retireSettingsPermissionFailure: () => {},
    emit: () => {}, reportError: err => errors.push(err.code), updateQueueState: () => {}, traceSync: () => {},
    errorCode: err => String(err.code || '').replace(/^functions\//, ''),
    paymentHash: async v => createHash('sha256').update(canonical(v)).digest('hex'),
    stableLegacyOperationId: item => item.operationId,
    CLOUD_NAMES: ['sales', 'payments', 'products', 'clients'], QUEUE_ENTITY_ALIASES: {},
    verifySaleQueueCommit: async () => {}, markLocalSaleConfirmed: () => {},
    markLocalPaymentConfirmed: item => marked.push(item.operationId),
    automaticSync: () => context.processSyncQueue(),
  });
  context.captureCloudReadScope = () => `${context.currentUser.uid}:${context.syncSessionGeneration}`;
  context.assertCloudReadScope = scope => {
    if (scope !== context.captureCloudReadScope()) throw Object.assign(Error('Session retired'), { code: 'sync-session-retired' });
  };
  context.window = { WorkspaceRuntime: { capture() {} }, FirebaseCallable: async (name, request) => {
    const item = request.item;
    calls.push({ name, request: structuredClone(request) });
    if (name === 'getOperationalSyncReceipt') {
      assert.equal(request.kind, 'queued_operation_status');
      const status = onReceipt ? await onReceipt(request, receipts) : receipts.get(request.operationId) || 'absent';
      return { data: { version: 1, businessId, operationId: request.operationId, workspaceGeneration: 0, status } };
    }
    assert.equal(name, 'commitOperationalSync');
    if (onCommit) await onCommit(item, receipts);
    receipts.set(item.operationId, 'applied');
    return { data: { operationId: item.operationId, replayed: false } };
  } };
  vm.runInContext([
    section('function classifyQueueOperation(', 'async function assertCancellationQueueClear('),
    section('const retryDelay =', 'function paymentQueueRequiresReview('),
    section('function queueManualReviewReason(', 'function preserveQueueQuarantine('),
    section('function readRecoveryResolution(', 'async function refreshRecoveryResolutions('),
    section('const queuedReceiptReview =', 'async function verifySaleQueueCommit('),
    section('async function processSyncQueue(', 'function pendingIds('),
  ].join('\n'), context);
  const advance = async () => {
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    assert.ok(next, 'expected an automatic timer');
    timers.delete(next[0]);
    clock = next[1].at;
    await next[1].fn();
    if (context.processingPromise) await context.processingPromise;
  };
  return { context, queue, calls, receipts, marked, errors, timers, advance, run: () => context.processSyncQueue() };
}

test('a stock-held sale with proof is acknowledged without replay and an absent or partial proof leaves it in review',async()=>{
  const old=packet('qa-old-stock');
  Object.assign(old,{status:'error',lastErrorCode:'permission-denied',lastErrorStage:'server_operational_commit',lastErrorMessage:'Estoque sem movimento autorizado.'});
  const held=packet('qa-held-sale','sales','qa-sale');
  Object.assign(held,{source:'sale-write-ahead',status:'pending',syncConfirmationPending:true,lastAttemptAt:'2026-11-15T11:59:00Z'});
  held.payload={eventKind:'sale',writes:[{entityType:'sales',entityId:'qa-sale',operation:'create',data:{
    operationId:held.operationId,spaceId:'qa-space',itens:[{produtoId:'qa-product'}]}}]};
  for(const proof of ['absent','applied','missing-sale']){
    const h=runtime([old,held],{onReceipt:()=>proof==='absent'?'absent':'applied'}),confirmed=[];
    h.context.markLocalSaleConfirmed=item=>confirmed.push(item.operationId);
    if(proof==='missing-sale')h.context.verifySaleQueueCommit=async()=>{throw Error('missing sale');};
    await h.run();
    assert.deepEqual(h.calls.map(call=>call.name),['getOperationalSyncReceipt']);
    assert.deepEqual(h.queue(),[old,held]);
    assert.equal(h.context.classifyQueueOperation(held).category,proof==='applied'?'resolved':'manual_review');
    assert.deepEqual(confirmed,proof==='applied'?[held.operationId]:[]);
  }
});

test('a timer reconciles lost responses without a second commit and preserves the payload hash', async () => {
  const original = packet('qa-original');
  const h = runtime([original], { onCommit(item, receipts) { receipts.set(item.operationId, 'applied'); throw transient(); } });
  await h.run();
  assert.deepEqual(h.queue()[0].payload, original.payload);
  assert.equal(h.errors.length, 0);
  assert.equal(h.timers.size, 1);
  await h.advance();
  assert.deepEqual(h.calls.map(x => x.name), ['commitOperationalSync', 'getOperationalSyncReceipt']);
  assert.equal(h.calls[1].request.payloadHash, createHash('sha256').update(canonical(original.payload)).digest('hex'));
  assert.deepEqual(h.queue(), []);
  assert.deepEqual(h.marked, ['qa-original']);
});

test('remote absence allows the same ordinary operation with the original payload, but not a second receipt', async () => {
  let attempts = 0;
  const original = packet('qa-original');
  const h = runtime([original], { onCommit() { if (++attempts === 1) throw transient(); } });
  await h.run();
  await h.advance();
  assert.equal(h.calls[1].name, 'getOperationalSyncReceipt');
  assert.equal(h.calls[2].request.queueRecoveryVersion, 1);
  for (const i of [0, 2]) {
    assert.equal(h.calls[i].request.item.operationId, original.operationId);
    assert.deepEqual(h.calls[i].request.item.payload, original.payload);
  }
  assert.deepEqual(h.queue(), []);
});

test('payment requires positive proof; a missing or divergent receipt remains blocked', async () => {
  for (const proof of ['applied', 'absent', 'review']) {
    const h = runtime([packet('qa-payment', 'payments')], { onCommit() { throw transient(); }, onReceipt: () => proof });
    await h.run(); await h.advance();
    assert.equal(h.calls.filter(x => x.name === 'commitOperationalSync').length, 1);
    if (proof === 'applied') assert.equal(h.queue().length, 0);
    else {
      const [blocked] = h.queue();
      assert.equal(blocked.lastErrorCode, 'sync-receipt-review-required');
      assert.equal(h.context.classifyQueueOperation(blocked).canRetry, false);
      assert.deepEqual(h.marked, []);
    }
  }
});

test('offline or a retired session cannot execute a scheduled attempt', async () => {
  for (const retire of [h => { h.context.navigator.onLine = false; }, h => { h.context.syncSessionGeneration++; }]) {
    const h = runtime([packet('qa-original')], { onCommit() { throw transient(); } });
    await h.run(); retire(h); await h.advance();
    assert.equal(h.calls.length, 1);
    assert.equal(h.queue()[0].operationId, 'qa-original');
  }
});

test('a pending acknowledgement received after the session changes cannot retire the original', async () => {
  let started, respond;
  const reading = new Promise(resolve => { started = resolve; });
  const proof = new Promise(resolve => { respond = resolve; });
  const h = runtime([packet('qa-original')], { onCommit() { throw transient(); }, onReceipt() { started(); return proof; } });
  await h.run();
  const running=h.advance();
  await reading;
  h.context.syncSessionGeneration++;
  respond('applied');
  await assert.rejects(running, {code:'sync-session-retired'});
  assert.equal(h.queue()[0].operationId,'qa-original');
  assert.deepEqual(h.marked,[]);
});

test('an expired budget permits one final read and never permits a seventh dispatch', async () => {
  const h = runtime([packet('qa-original')], { onCommit() { throw transient(); } });
  await h.run();
  for(let attempt=0;attempt<6;attempt++)await h.advance();
  assert.equal(h.calls.filter(x=>x.name==='commitOperationalSync').length,6);
  assert.equal(h.calls.filter(x=>x.name==='getOperationalSyncReceipt').length,6);
  assert.equal(h.queue()[0].lastErrorCode,'sync-retry-exhausted');
  assert.equal(h.timers.size,0);
});

test('quota backoff does not send a different item early and resumes after the cooldown', async () => {
  let rejected=false;
  const h=runtime([packet('qa-first'),packet('qa-second','clients','qa-client')],{onCommit(){
    if(!rejected){rejected=true;throw Object.assign(Error('Quota'),{code:'functions/resource-exhausted'});}
  }});
  assert.equal((await h.run()).quotaBackoff,true);
  assert.equal((await h.run()).quotaBackoff,true);
  assert.equal(h.calls.length,1);
  await h.advance();
  assert.deepEqual(h.calls.map(x=>x.name),['commitOperationalSync','getOperationalSyncReceipt','commitOperationalSync','commitOperationalSync']);
  assert.deepEqual(h.queue(),[]);
});

test('an older server with no receipt capability cannot resend an uncertain envelope', async () => {
  const original={...packet('qa-old'),attempts:2,lastAttemptAt:'2026-11-14T00:00:00Z',lastErrorCode:'unavailable'};
  const h=runtime([original],{version:0});
  await h.run();
  assert.deepEqual(h.queue(),[original]);
  assert.equal(h.calls.length,0);
  assert.equal(h.timers.size,0);
});

test('a transient failure before the first upload automatically reconnects without editing any envelope',async()=>{
  const original=packet('qa-first'),h=runtime([original]),c=h.context;
  let attempts=0;
  Object.assign(c,{quickTimer:null,syncConnectionAttempts:0,document:{visibilityState:'hidden'},
    syncStep:async(_stage,action)=>action(),safePublishSyncSignal:async()=>{},
    writeSyncTime(){},lastAttemptKey:()=>'',lastSyncKey:()=>'',lastCompleteKey:()=>'',preservedQueueMessage:()=>'',
    testFirestoreConnection:async()=>{if(++attempts===1)throw transient();c.state.testPassed=true;}});
  vm.runInContext(section('async function runAutomaticSync(', 'function startAutoSync('),c);
  await c.automaticSync();
  assert.deepEqual(h.queue(),[original]);assert.equal(h.calls.length,0);assert.equal(h.timers.size,1);
  await h.advance();
  assert.equal(attempts,2);assert.deepEqual(h.queue(),[]);assert.equal(h.calls[0].request.item.operationId,original.operationId);
});

test('a permanent stock rejection stays intact, holds the dependent product and leaves independent work runnable', async () => {
  const rejected = { ...packet('qa-rejected'), status: 'error', lastErrorCode: 'permission-denied',
    lastErrorStage: 'server_operational_commit', lastErrorMessage: 'Estoque sem movimento autorizado.' };
  const dependent = packet('qa-dependent'), independent = packet('qa-independent', 'products', 'qa-other-product');
  const h = runtime([rejected, dependent, independent]);
  await h.run();
  assert.deepEqual(h.calls.map(x => x.request.item.operationId), ['qa-independent']);
  assert.deepEqual(h.queue(), [rejected, dependent]);
  assert.equal(h.context.classifyQueueOperation(dependent).reviewReason, 'product_stock_dependency');
  assert.equal(h.timers.size, 0);
});

test('a later write to the same product waits until the earlier uncertain write is confirmed',async()=>{
  const first=packet('qa-first'),later=packet('qa-later'),other=packet('qa-other','products','other');
  const h=runtime([first,later,other],{onCommit(item,receipts){
    if(item.operationId===first.operationId){receipts.set(item.operationId,'applied');throw transient();}
  }});
  await h.run();
  assert.deepEqual(h.calls.map(x=>x.request.item.operationId),['qa-first','qa-other']);
  await h.advance();
  assert.deepEqual(h.calls.map(x=>x.request.operationId||x.request.item.operationId),['qa-first','qa-other','qa-first','qa-later']);
  assert.deepEqual(h.queue(),[]);
});
