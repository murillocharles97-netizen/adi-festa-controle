'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const crypto = require('node:crypto');

const source = fs.readFileSync('js/firebase/sync.js', 'utf8');
const section = (start, end) => {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing Sync section: ${start} -> ${end}`);
  return source.slice(from, to);
};
const checksum = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const operational = ['sales.create', 'sales.cancel', 'customers.view', 'products.view', 'inventory.view'];
const settingsPacket = (overrides = {}) => ({
  queueId: 'qa-settings-queue', operationId: 'qa-settings-operation', businessId: 'qa-settings-business',
  userId: 'qa-seller', entityType: 'settings', entityId: 'default', action: 'update', subtype: 'simple',
  payloadVersion: 4, status: 'error', attempts: 11, retryCount: 11,
  createdAtLocal: '2026-10-17T18:00:00Z', lastAttemptAt: '2026-10-20T12:00:00Z',
  lastErrorCode: 'permission-denied', lastErrorMessage: 'Missing or insufficient permissions.',
  lastErrorPath: 'businesses/qa-settings-business/processedOperations/qa-settings-operation',
  payload: { eventKind: 'simple', writes: [{ entityType: 'settings', entityId: 'default',
    operation: 'update', before: { locale: 'pt-BR' }, data: { nome: 'Loja QA' } }] },
  ...overrides,
});
const salePacket = (overrides = {}) => ({
  queueId: 'qa-sale-queue', operationId: 'qa-sale-operation', businessId: 'qa-settings-business',
  userId: 'qa-seller', entityType: 'sales', entityId: 'qa-sale', action: 'create',
  payloadVersion: 4, status: 'pending', attempts: 0,
  payload: { eventKind: 'sale', writes: [{ entityType: 'sales', entityId: 'qa-sale', operation: 'create',
    data: { id: 'qa-sale', operationId: 'qa-sale-operation', businessId: 'qa-settings-business',
      spaceId: 'qa-space', actorUid: 'qa-seller', status: 'pago', valorFinal: 25,
      idempotencyKey: 'qa-sale-operation', entityType: 'sales', action: 'create',
      createdAt: '2026-10-20T13:00:00Z', schemaVersion: 3 } }] },
  ...overrides,
});

function harness(initial = [], options = {}) {
  const values = new Map(options.persisted || []), commits = [], scheduled = [], calls = [];
  let uid = options.uid || 'qa-seller', role = options.role || 'seller';
  let grants = options.permissions || operational;
  const names = { products: 'produtos', productVariants: 'variacoesProdutos', clients: 'clientes',
    sales: 'vendas', stockMovements: 'movimentacoesEstoque' };
  const origin = () => ({ businessId: 'qa-settings-business', uid, workspaceGeneration: 0 });
  const c = {
    console, Date, Map, Set, Math, Number, String, Boolean, Array, Object, JSON, Error, Promise,
    structuredClone, encodeURIComponent, TextEncoder, Uint8Array, crypto: crypto.webcrypto,
    now: () => '2026-10-20T13:00:00Z', activeBusinessId: () => 'qa-settings-business',
    queueKey: () => `adiFesta:qa-settings-business:${uid}:qa-permissions:syncQueue`,
    localStorage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, String(value)) },
    checksumValue: checksum, updateQueueState() {}, stableLegacyOperationId: item => item.operationId,
    deviceId: () => 'qa-settings-device', PAYLOAD_VERSION: 4, MAX_WRITES: 350,
    QUEUE_ENTITY_ALIASES: {}, IDEMPOTENT_EVENT_NAMES: new Set(['sales', 'stockMovements']),
    sanitizeForFirestore: value => structuredClone(value),
    CLOUD_NAMES: [...Object.keys(names), 'settings'], SOURCES: Object.fromEntries(Object.entries(names).map(([name, key]) => [name, { key }])),
    sourceItems: (data, name) => data[names[name]] || [],
    state: { userProfile: { businessId: 'qa-settings-business', uid, role } },
    currentUser: { uid }, auth: { currentUser: { uid } }, syncSessionGeneration: 1,
    DB: { flush: async () => {}, getWorkspaceGeneration: () => 0,
      prepare: options.prepare || (data => structuredClone(data)), carregar: () => ({ config: {}, vendas: [], pagamentos: [] }) },
    WorkspaceRuntime: { capture: origin },
    TeamAccess: { has: permission => role === 'owner' || grants.includes(permission) },
    BusinessContext: { get: () => ({ businessId: 'qa-settings-business', role, permissions: grants,
      loading: false, error: null, userProfile: { uid, businessId: 'qa-settings-business', active: true }, member: { status: 'active' },
      spaceAccess: role === 'owner' ? 'all' : 'selected', allowedSpaceIds: ['qa-space'] }) },
    processingPromise: null, readOnlyMode: false, cloudPaused: false, applyingCloud: false,
    navigator: { onLine: true }, validateUser: async () => {}, emit() {},
    commitQueueItem: async item => { commits.push(structuredClone(item)); return {}; },
    verifySaleQueueCommit: async () => {}, markLocalSaleConfirmed() {}, markLocalPaymentConfirmed() {},
    scheduleImmediate: () => scheduled.push('scheduled'), matchMedia: () => ({ matches: false }),
    errorCode: error => String(error.code || '').replace(/^firestore\//, ''),
    friendlyError: error => error.message, reportError() {}, currentPath: '',
    FirebaseCallable: async (...args) => { calls.push(args); throw Error('No callable expected in a settings permission hold'); },
  };
  c.window = c;
  vm.createContext(c);
  vm.runInContext(section('const queueSubtype =', 'const roundedMoney'), c);
  vm.runInContext(section('const readQueue =', 'const knownOrphanKey'), c);
  vm.runInContext(section('const queueErrorBreakdown =', 'const retryDelay ='), c);
  vm.runInContext(section('const retryDelay =', 'const readPullState'), c);
  vm.runInContext(section('function changedFields(', 'function installOfflineFirstStorage('), c);
  vm.runInContext(section('function migrateScopedQueueCompatibility(', 'function migrateOwnerBusinessQueue('), c);
  vm.runInContext(section('async function processSyncQueue(', 'function pendingIds('), c);
  vm.runInContext(section('function pendingIds(', 'function markLocalCreditSaleConfirmed('), c);
  c.normalizeFirestoreData = value => structuredClone(value);
  vm.runInContext(section('function cleanCloudItem(', 'function applyProtectedMetadata('), c);
  if (!values.has(c.queueKey())) values.set(c.queueKey(), JSON.stringify(initial));
  return {
    c, values, commits, scheduled, calls,
    queue: () => JSON.parse(values.get(c.queueKey())), raw: () => values.get(c.queueKey()),
    counts: () => vm.runInContext('queueCounts()', c),
    diagnostics: () => vm.runInContext('queueDiagnostics()', c),
    canAttempt: (item, force = false, manualRetry = false) => vm.runInContext('canAttempt', c)(item, force, manualRetry),
    migrate: () => c.migrateScopedQueueCompatibility(), run: (force = false, manualRetry = false) => c.processSyncQueue({ force, manualRetry }),
    save: queue => vm.runInContext('saveQueue', c)(queue),
    setPermissions: permissions => { grants = permissions; },
    switchTo: (nextUid, nextRole, permissions) => {
      uid = nextUid; role = nextRole; grants = permissions;
      c.currentUser = { uid }; c.auth.currentUser = { uid }; c.state.userProfile = { businessId: 'qa-settings-business', uid, role };
      c.syncSessionGeneration++;
      if (!values.has(c.queueKey())) values.set(c.queueKey(), '[]');
    },
  };
}

test('seller config mutations do not enqueue shared settings, including a hydration-only capture', () => {
  const h = harness([], { prepare: data => ({ ...data, config: { audioEnabled: true, ...data.config } }) });
  const before = { config: { locale: 'pt-BR' }, vendas: [] };
  const after = { config: { locale: 'pt-BR', audioEnabled: true, nome: 'QA local', recentClientIds: ['qa-client'], appSchemaVersion: 3 }, vendas: [] };
  const bytes = JSON.stringify({ before, after });
  assert.equal(h.c.diffWrites(before, after).some(write => write.entityType === 'settings'), false);
  assert.equal(h.c.captureChanges(before, after), 0);
  assert.deepEqual(h.queue(), []); assert.equal(h.scheduled.length, 0);
  assert.equal(JSON.stringify({ before, after }), bytes);
});

test('owner and explicit settings.manage can enqueue intentional shared settings while local metadata stays local', () => {
  for (const options of [{ uid: 'qa-owner', role: 'owner', permissions: ['*'] }, { permissions: [...operational, 'settings.manage'] }]) {
    const h = harness([], options);
    const before = { config: { locale: 'pt-BR', operation: { id: 'qa-a' }, recentClientIds: ['old'], appSchemaVersion: 2 } };
    const after = { config: { locale: 'pt-BR', operation: { id: 'qa-b' }, recentClientIds: ['new'], appSchemaVersion: 3, nome: 'Shared QA' } };
    assert.equal(h.c.captureChanges(before, after), 1);
    const write = h.queue()[0].payload.writes[0];
    assert.equal(write.entityType, 'settings'); assert.equal(write.entityId, 'default');
    assert.deepEqual(Object.keys(write.data), ['nome']); assert.equal(write.data.nome, 'Shared QA');
    assert.equal(h.scheduled.length, 1);
  }
});

test('capture normalizes both config snapshots and avoids owner hydration queues', () => {
  const h = harness([], { uid: 'qa-owner', role: 'owner', permissions: ['*'],
    prepare: data => ({ ...data, config: { audioEnabled: true, ...data.config } }) });
  const before = { config: { locale: 'pt-BR' } }, after = { config: { locale: 'pt-BR', audioEnabled: true } };
  assert.equal(h.c.captureChanges(before, after), 0);
  assert.deepEqual(h.queue(), []);
});

test('queueWrites fails closed for unauthorized settings before appending or scheduling anything', () => {
  const h = harness([salePacket()]), bytes = h.raw();
  assert.throws(() => h.c.queueWrites(settingsPacket().payload.writes, 'qa-new-settings', 'simple'), { code: 'settings-permission-required' });
  assert.equal(h.raw(), bytes); assert.equal(h.scheduled.length, 0);
  h.c.TeamAccess = null;
  assert.throws(() => h.c.queueWrites(settingsPacket().payload.writes, 'qa-unresolved-settings', 'simple'), { code: 'settings-permission-required' });
  assert.equal(h.raw(), bytes);
});

for (const status of ['error', 'pending', 'syncing']) test(`existing settings-only ${status} is preserved byte-for-byte across automatic/manual Sync and reload`, async () => {
  const packet = settingsPacket({ status }), h = harness([packet]), bytes = h.raw(), payloadHash = checksum(packet.payload);
  h.migrate();
  const [evidenceKey, evidenceJson] = [...h.values.entries()].find(([key]) => key.includes(':manualReview:')) || [];
  assert.ok(evidenceKey); const evidence = JSON.parse(evidenceJson);
  assert.equal(evidence.status, 'quarantined'); assert.equal(evidence.reason, 'settings_permission_required');
  assert.equal(evidence.originalPacketJson, JSON.stringify(packet));
  for (const [force, manualRetry] of [[false, false], [true, false], [true, true]]) {
    assert.equal(h.canAttempt(h.queue()[0], force, manualRetry), false);
    const result = await h.run(force, manualRetry);
    assert.equal(result.sent, 0); assert.equal(result.reviewHeld, 1);
    assert.equal(h.raw(), bytes); assert.equal(checksum(h.queue()[0].payload), payloadHash);
  }
  const reloaded = harness([], { persisted: [...h.values.entries()] });
  reloaded.migrate(); await reloaded.run(true, true);
  assert.equal(reloaded.raw(), bytes); assert.equal(reloaded.values.get(evidenceKey), evidenceJson);
  assert.equal(reloaded.queue()[0].attempts, packet.attempts); assert.equal(reloaded.queue()[0].lastAttemptAt, packet.lastAttemptAt);
  assert.equal(h.commits.length + reloaded.commits.length, 0);
  assert.equal(reloaded.counts().pending, 0); assert.equal(reloaded.counts().errors, 0);
  assert.equal(reloaded.counts().quarantined, 1); assert.equal(reloaded.counts().active, 0);
});

test('a stored settings permission quarantine remains immutable after a later grant and cannot use the archive callable', async () => {
  const h = harness([settingsPacket()]); h.migrate(); const bytes = h.raw();
  const evidence = [...h.values.entries()].find(([key]) => key.includes(':manualReview:'));
  h.setPermissions([...operational, 'settings.manage']);
  h.migrate(); await h.run(true, true);
  assert.equal(h.raw(), bytes); assert.equal(h.values.get(evidence[0]), evidence[1]); assert.equal(h.commits.length, 0);
  assert.throws(() => h.save([]), { code: 'queue-quarantined-immutable' });
  const modified = h.queue(); modified[0].payload.writes[0].data.nome = 'Must not replace evidence';
  assert.throws(() => h.save(modified), { code: 'queue-quarantined-immutable' });
  await assert.rejects(h.c.archiveQuarantinedOperation('qa-settings-operation'));
  assert.equal(h.calls.length, 0); assert.equal(h.raw(), bytes);
});

test('a settings incident does not block or modify an independent legitimate sale', async () => {
  const incident = settingsPacket(), sale = salePacket(), h = harness([incident, sale]);
  const incidentBytes = JSON.stringify(incident), salePayload = JSON.stringify(sale.payload);
  h.migrate(); const result = await h.run(true, true);
  assert.equal(result.sent, 1); assert.equal(result.reviewHeld, 1);
  assert.deepEqual(h.commits.map(item => item.operationId), ['qa-sale-operation']);
  assert.equal(JSON.stringify(h.commits[0].payload), salePayload);
  assert.equal(h.queue().length, 1); assert.equal(JSON.stringify(h.queue()[0]), incidentBytes);
  await h.run(false); assert.equal(h.commits.length, 1);
});

test('seller sale capture retains its original commercial IDs while omitting unrelated config changes', () => {
  const h = harness(), sale = salePacket().payload.writes[0].data;
  const before = { config: { nome: 'Before' }, vendas: [] }, after = { config: { nome: 'After' }, vendas: [sale] };
  assert.equal(h.c.captureChanges(before, after), 1);
  const packet = h.queue()[0]; assert.equal(packet.operationId, sale.operationId);
  assert.deepEqual(packet.payload.writes.map(write => write.entityType), ['sales']);
  assert.equal(JSON.stringify(packet.payload.writes[0].data), JSON.stringify(sale));
});

test('settings hold is narrow: mixed commercial packets, foreign origin and other settings documents are not relabeled', () => {
  const h = harness(), mixed = settingsPacket(); mixed.payload.writes.push(salePacket().payload.writes[0]);
  for (const packet of [mixed, settingsPacket({ businessId: 'another-business' }), settingsPacket({ userId: 'another-user' }),
    settingsPacket({ payload: { eventKind: 'sale', writes: settingsPacket().payload.writes } }),
    settingsPacket({ payload: { eventKind: 'simple', writes: [{ entityType: 'settings', entityId: 'operation', operation: 'update', data: {} }] } }),
    settingsPacket({ payload: { eventKind: 'simple', writes: [] } })]) {
    const bytes = JSON.stringify(packet);
    assert.equal(h.c.settingsQueueRequiresPermission(packet), false);
    assert.equal(JSON.stringify(packet), bytes);
  }
});

test('an unresolved permission or unknown principal never reclassifies an existing settings packet', () => {
  for (const change of [c => { c.TeamAccess = null; }, c => { c.TeamAccess.has = () => undefined; },
    c => { c.currentUser = null; }, c => { c.auth.currentUser = { uid: 'another-user' }; },
    c => { c.state.userProfile.businessId = 'another-business'; }, c => { c.DB.getWorkspaceGeneration = () => 3; }]) {
    const packet = settingsPacket(), h = harness([packet]), before = h.raw(); change(h.c);
    assert.equal(h.c.settingsQueueRequiresPermission(packet), false);
    assert.equal(h.c.queueSettingsDiagnostic(packet), null);
    assert.equal(h.raw(), before);
    assert.equal([...h.values.keys()].some(key => key.includes(':manualReview:')), false);
  }
});

test('stale, loading or cleared business contexts do not quarantine settings for a different or unresolved identity', () => {
  const changes = [context => ({ ...context, loading: true }), context => ({ ...context, loading: undefined }),
    context => ({ ...context, error: 'bootstrap-failed' }), context => ({ ...context, role: '' }),
    context => ({ ...context, role: 'unknown-role' }), context => ({ ...context, permissions: undefined }),
    context => ({ ...context, permissions: { 'sales.create': true } }),
    context => ({ ...context, businessId: 'previous-business' }),
    context => ({ ...context, userProfile: { uid: 'previous-user', businessId: 'qa-settings-business', active: true } }),
    context => ({ ...context, userProfile: { uid: 'qa-seller', businessId: 'previous-business', active: true } }),
    context => ({ ...context, userProfile: { uid: 'qa-seller', businessId: 'qa-settings-business', active: false } }),
    context => ({ ...context, member: { status: 'disabled' } }), () => ({})];
  for (const change of changes) {
    const packet = settingsPacket(), h = harness([packet]), before = h.raw();
    const context = change(h.c.BusinessContext.get()); h.c.BusinessContext.get = () => context;
    assert.equal(h.c.settingsQueueRequiresPermission(packet), false, JSON.stringify(context));
    h.migrate(); assert.equal(h.raw(), before);
    assert.equal([...h.values.keys()].some(key => key.includes(':manualReview:')), false);
  }
});

test('an unresolved settings permission blocks automatic and manual sending without rewriting or quarantining the packet', async () => {
  for (const permissionResolver of [null, { has: () => undefined }]) {
    const packet = settingsPacket({ status: 'pending', lastErrorCode: null }), h = harness([packet]);
    h.c.TeamAccess = permissionResolver; const before = h.raw();
    h.migrate();
    for (const [force, manualRetry] of [[false, false], [true, false], [true, true]]) {
      assert.equal(h.canAttempt(packet, force, manualRetry), false);
      assert.equal((await h.run(force, manualRetry)).sent, 0);
      assert.equal(h.raw(), before); assert.equal(h.queue()[0].attempts, packet.attempts);
    }
    assert.equal(h.commits.length, 0);
    assert.equal([...h.values.keys()].some(key => key.includes(':manualReview:')), false);
  }
});

test('a stale true settings grant cannot enqueue or send before the business context is current and complete', async () => {
  for (const change of [context => ({ ...context, loading: true }), () => ({}),
    context => ({ ...context, businessId: 'previous-business' }),
    context => ({ ...context, userProfile: { ...context.userProfile, uid: 'previous-user' } }),
    context => ({ ...context, role: 'unknown-role' })]) {
    const packet = settingsPacket({ status: 'pending', lastErrorCode: null });
    const h = harness([packet], { permissions: [...operational, 'settings.manage'] }), before = h.raw();
    const context = change(h.c.BusinessContext.get()); h.c.BusinessContext.get = () => context;
    assert.equal(h.c.TeamAccess.has('settings.manage'), true);
    assert.equal(h.c.settingsQueueRequiresPermission(packet), false);
    h.migrate();
    for (const [force, manualRetry] of [[false, false], [true, true]]) {
      assert.equal(h.canAttempt(packet, force, manualRetry), false);
      assert.equal((await h.run(force, manualRetry)).sent, 0); assert.equal(h.raw(), before);
    }
    assert.throws(() => h.c.queueWrites(packet.payload.writes, 'qa-stale-grant-settings', 'simple'), { code: 'settings-permission-required' });
    assert.equal(h.raw(), before); assert.equal(h.commits.length, 0);
    assert.equal([...h.values.keys()].some(key => key.includes(':manualReview:')), false);
  }
});

test('a permanently failed malformed writes object survives compatibility without a TypeError or evidence rewrite', () => {
  const packet = settingsPacket({ lastErrorCode: 'invalid-argument', payload: { eventKind: 'simple', writes: {} } });
  const h = harness([packet]), before = h.raw();
  assert.doesNotThrow(() => h.migrate());
  assert.equal(h.raw(), before); assert.equal(h.queue()[0].attempts, packet.attempts);
  assert.equal(h.canAttempt(packet), false); assert.equal(h.canAttempt(packet, true), false);
  assert.equal(h.c.settingsQueueRequiresPermission(packet), false);
  assert.equal([...h.values.keys()].some(key => key.includes(':manualReview:')), false);
});

test('a mixed settings and sale packet is neither quarantined as settings-only nor silently retried without permission', async () => {
  const packet = settingsPacket({ status: 'pending', lastErrorCode: null });
  packet.payload.writes.push(salePacket().payload.writes[0]);
  const h = harness([packet]), before = h.raw(); h.migrate();
  assert.equal(h.c.settingsQueueRequiresPermission(packet), false);
  for (const [force, manualRetry] of [[false, false], [true, true]]) {
    assert.equal(h.canAttempt(packet, force, manualRetry), false);
    assert.equal((await h.run(force, manualRetry)).sent, 0);
    assert.equal(h.raw(), before);
  }
  assert.equal(h.commits.length, 0);
  assert.equal([...h.values.keys()].some(key => key.includes(':manualReview:')), false);
});

test('a preserved standalone settings incident allows current remote settings to hydrate without changing queue evidence', () => {
  const packet = settingsPacket(), h = harness([packet, salePacket()]); h.migrate();
  const before = h.raw(), payloadHash = checksum(packet.payload);
  const evidence = [...h.values.entries()].filter(([key]) => key.includes(':manualReview:'));
  const data = { config: { nome: 'Stale local configuration', recentClientIds: ['qa-local-client'] }, vendas: [] };
  assert.deepEqual(Array.from(h.c.pendingIds('settings')), []);
  assert.deepEqual(Array.from(h.c.pendingIds('sales')), ['qa-sale']);
  const changed = h.c.mergeCloudCollectionIntoData(data, 'settings', [{ id: 'default', businessId: packet.businessId,
    nome: 'Current remote configuration', locale: 'pt-BR', updatedAt: '2026-10-20T14:00:00Z' }], { authoritative: true });
  assert.equal(changed, 1); assert.equal(data.config.nome, 'Current remote configuration');
  assert.deepEqual(data.config.recentClientIds, ['qa-local-client']);
  assert.equal(h.raw(), before); assert.equal(checksum(h.queue()[0].payload), payloadHash);
  for (const [key, value] of evidence) assert.equal(h.values.get(key), value);
});

test('a mixed commercial packet still protects both its pending settings and its sale from remote hydration', () => {
  const packet = settingsPacket({ status: 'pending', lastErrorCode: null }); packet.payload.writes.push(salePacket().payload.writes[0]);
  const h = harness([packet]), before = h.raw();
  const data = { config: { nome: 'Pending mixed configuration' }, vendas: [salePacket().payload.writes[0].data] };
  const dataBefore = JSON.stringify(data);
  assert.deepEqual(Array.from(h.c.pendingIds('settings')), ['default']);
  assert.deepEqual(Array.from(h.c.pendingIds('sales')), ['qa-sale']);
  assert.equal(h.c.mergeCloudCollectionIntoData(data, 'settings', [{ id: 'default', businessId: packet.businessId,
    nome: 'Remote must not replace this pending mixed packet' }], { authoritative: true }), 0);
  assert.equal(JSON.stringify(data), dataBefore); assert.equal(h.raw(), before);
  assert.equal([...h.values.keys()].some(key => key.includes(':manualReview:')), false);
});

test('only the exact settings permission failure is retired; historical evidence and unrelated failures remain', () => {
  const packet = settingsPacket(), h = harness([packet]); h.migrate();
  const failure = { stage: 'Queue operation', code: 'permission-denied', operationId: packet.operationId,
    businessId: packet.businessId, actorUid: packet.userId, path: packet.lastErrorPath };
  h.c.state.syncFailureHistory = [structuredClone(failure), { stage: 'listener', code: 'permission-denied', path: 'qa-listener' }];
  const history = JSON.stringify(h.c.state.syncFailureHistory), before = h.raw();
  h.c.state.syncFailure = structuredClone(failure); h.c.retireSettingsPermissionFailure(packet);
  assert.equal(h.c.state.syncFailure, null);
  for (const patch of [{ operationId: 'another-operation' }, { operationId: undefined, stage: 'listener' },
    { businessId: 'another-business' }, { actorUid: 'another-user' }, { code: 'unavailable' }]) {
    const unrelated = { ...failure, ...patch }; h.c.state.syncFailure = unrelated;
    h.c.retireSettingsPermissionFailure(packet);
    assert.equal(h.c.state.syncFailure, unrelated);
  }
  const mixed = settingsPacket(); mixed.payload.writes.push(salePacket().payload.writes[0]);
  const mixedHarness = harness([mixed]); mixedHarness.c.state.syncFailure = structuredClone(failure);
  mixedHarness.c.retireSettingsPermissionFailure(mixed);
  assert.equal(mixedHarness.c.state.syncFailure.operationId, failure.operationId);
  assert.equal(JSON.stringify(h.c.state.syncFailureHistory), history); assert.equal(h.raw(), before);
});

test('settings diagnostics expose the actual destination and preserve the original misleading marker path as evidence', () => {
  const packet = settingsPacket(), h = harness([packet]), bytes = h.raw(); h.migrate();
  const row = h.diagnostics()[0];
  assert.equal(row.firestorePath, 'businesses/qa-settings-business/settings/default');
  assert.equal(row.reviewReason, 'settings_permission_required'); assert.equal(row.canArchive, false);
  assert.equal(row.originalErrorPath, packet.lastErrorPath);
  assert.equal(row.diagnostic.originalErrorPath, packet.lastErrorPath);
  assert.equal(row.diagnostic.collection, 'settings');
  assert.equal(row.payloadChecksum, checksum(packet.payload));
  assert.equal(h.raw(), bytes);
});

test('an authorized owner settings failure remains actionable and records the precise supplied diagnostic path', async () => {
  const packet = settingsPacket({ userId: 'qa-owner', status: 'pending', lastErrorCode: null });
  const h = harness([packet], { uid: 'qa-owner', role: 'owner', permissions: ['*'] });
  const path = 'businesses/qa-settings-business/settings/default';
  h.c.currentPath = packet.lastErrorPath;
  h.c.commitQueueItem = async () => { throw Object.assign(Error('Rules denied this authorized attempt'), {
    code: 'permission-denied', syncDetail: { stage: 'shared_settings_commit', collection: 'settings', path,
      transactionPaths: [path, packet.lastErrorPath], request: 'atomic_commit' },
  }); };
  const result = await h.run(true);
  assert.equal(result.sent, 0); assert.equal(h.counts().errors, 1); assert.equal(h.counts().quarantined, 0);
  const failed = h.queue()[0]; assert.equal(failed.lastErrorPath, path);
  assert.equal(failed.lastErrorStage, 'shared_settings_commit');
  assert.equal(JSON.stringify(failed.payload), JSON.stringify(packet.payload));
  assert.equal([...h.values.keys()].some(key => key.includes(':manualReview:')), false);
});

test('owner and seller namespaces retain their own evidence without copying settings incidents between identities', async () => {
  const h = harness([settingsPacket()]); h.migrate(); const sellerBytes = h.raw();
  const sellerEvidence = [...h.values.entries()].filter(([key]) => key.includes(':manualReview:'));
  h.switchTo('qa-owner', 'owner', ['*']); await h.run(true, true);
  assert.deepEqual(h.queue(), []); assert.equal(h.counts().quarantined, 0);
  assert.equal([...h.values.keys()].some(key => key.includes(':qa-owner:') && key.includes(':manualReview:')), false);
  h.switchTo('qa-seller', 'seller', operational); await h.run(true, true);
  assert.equal(h.raw(), sellerBytes); assert.equal(h.commits.length, 0);
  for (const [key, value] of sellerEvidence) assert.equal(h.values.get(key), value);
});
