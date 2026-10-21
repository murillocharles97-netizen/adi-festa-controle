'use strict';
// Fictional tenant only. The settings guard must not be widened to clear a queue.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { randomUUID } = require('node:crypto');
const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
const sdk = require('firebase/firestore');

if (!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw Error('Local Firestore Emulator required');
}
const suffix = randomUUID();
const businessId = 'qa-settings-sync-' + suffix;
const spaceId = 'qa-settings-space-' + suffix;
const owner = 'qa-settings-owner-' + suffix;
const seller = 'qa-settings-seller-' + suffix;
const noMarkerAccess = 'qa-settings-no-marker-' + suffix;
const grants = {
  'sales.create': true, 'sales.cancel': true, 'customers.view': true,
  'products.view': true, 'inventory.view': true, 'settings.manage': false,
  'financial.view': false, 'cost.view': false, 'profit.view': false,
  'customers.receiveDebt': false, 'customers.adjustBalance': false,
};
const docPath = (collection, id) => ['businesses', businessId, collection, id];
const markerData = (operationId, uid) => ({
  id: operationId, idempotencyKey: operationId, businessId, ownerId: uid,
  status: 'processed', eventKind: 'simple', processedAt: sdk.serverTimestamp(),
  createdAtLocal: '2026-10-20T12:00:00Z', schemaVersion: 3,
});
let env;
let sanitizer;
const syncSource = fs.readFileSync('js/firebase/sync.js', 'utf8');
const syncSection = (start, end) => {
  const from = syncSource.indexOf(start), to = syncSource.indexOf(end, from);
  assert.ok(from >= 0 && to > from, `Missing Sync section: ${start} -> ${end}`);
  return syncSource.slice(from, to);
};
const bridge = value => value instanceof Date ? value : Array.isArray(value) ? Array.from(value, bridge) :
  value && Object.prototype.toString.call(value) === '[object Object]' && !value._methodName && typeof value.toDate !== 'function'
    ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, bridge(item)])) : value;
const adminRead = async (collection, id) => {
  let snapshot;
  await env.withSecurityRulesDisabled(async context => {
    snapshot = await sdk.getDoc(sdk.doc(context.firestore(), ...docPath(collection, id)));
  });
  return snapshot;
};

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-v191-settings-regression',
    firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') },
  });
  sanitizer = (await import('data:text/javascript,' + encodeURIComponent(fs.readFileSync('js/firebase/firestore-utils.js', 'utf8')))).sanitizeForFirestore;
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore();
    await sdk.setDoc(sdk.doc(db, 'businesses', businessId), {
      ownerId: owner, active: true, legacyAccessDisabled: true,
      subscription: { planId: 'premium', status: 'active', catalogVersion: 2 },
    });
    for (const [uid, role] of [[owner, 'owner'], [seller, 'seller'], [noMarkerAccess, 'seller']]) {
      await sdk.setDoc(sdk.doc(db, 'users', uid), { uid, role, businessId, active: true });
      await sdk.setDoc(sdk.doc(db, ...docPath('members', uid)), {
        uid, role, status: 'active', permissions: uid === noMarkerAccess ? { ...grants, 'sales.create': false, 'sales.cancel': false } : grants,
        spaceAccess: role === 'owner' ? 'all' : 'selected',
        allowedSpaceIds: role === 'owner' ? [] : [spaceId],
      });
    }
    await sdk.setDoc(sdk.doc(db, 'financialSpaces', spaceId), {
      id: spaceId, businessId, linkedBusinessId: businessId, ownerUid: owner,
      type: 'business', active: true,
      capabilities: { finance: true, sales: true, products: true, inventory: true },
    });
    await sdk.setDoc(sdk.doc(db, ...docPath('settings', 'default')), {
      id: 'default', businessId, qaSetting: 'original', schemaVersion: 3,
    });
  });
});
test.after(async () => env?.cleanup());

async function commitSettings(db, uid, operationId, value) {
  const marker = sdk.doc(db, ...docPath('processedOperations', operationId));
  return sdk.runTransaction(db, async transaction => {
    const processed = await transaction.get(marker);
    if (processed.exists()) return;
    transaction.set(sdk.doc(db, ...docPath('settings', 'default')),
      { businessId, qaSetting: value }, { merge: true });
    transaction.set(marker, markerData(operationId, uid));
  });
}

test('seller can read settings and read/create the operation marker without settings.manage', async () => {
  const db = env.authenticatedContext(seller).firestore();
  const operationId = 'qa-marker-' + randomUUID();
  const marker = sdk.doc(db, ...docPath('processedOperations', operationId));
  assert.equal((await sdk.getDoc(marker)).exists(), false);
  assert.equal((await sdk.getDoc(sdk.doc(db, ...docPath('settings', 'default')))).data().qaSetting, 'original');
  await sdk.setDoc(marker, markerData(operationId, seller));
  assert.equal((await sdk.getDoc(marker)).exists(), true);
});

test('seller settings update remains denied and a composite commit creates no processed marker', async () => {
  const db = env.authenticatedContext(seller).firestore();
  const operationId = 'qa-blocked-settings-' + randomUUID();
  const before = JSON.stringify((await adminRead('settings', 'default')).data());
  await assertFails(sdk.updateDoc(sdk.doc(db, ...docPath('settings', 'default')), { qaSetting: 'denied-direct' }));
  await assertFails(commitSettings(db, seller, operationId, 'denied-transaction'));
  assert.equal(JSON.stringify((await adminRead('settings', 'default')).data()), before);
  assert.equal((await adminRead('processedOperations', operationId)).exists(), false);
});

test('owner commits the same settings change and marker atomically and replay is idempotent', async () => {
  const db = env.authenticatedContext(owner).firestore();
  const operationId = 'qa-owner-settings-' + randomUUID();
  await commitSettings(db, owner, operationId, 'owner-change');
  assert.equal((await adminRead('settings', 'default')).data().qaSetting, 'owner-change');
  assert.equal((await adminRead('processedOperations', operationId)).data().status, 'processed');
  await commitSettings(db, owner, operationId, 'must-not-replace');
  assert.equal((await adminRead('settings', 'default')).data().qaSetting, 'owner-change');
});

// Exercise the actual Sync preflight and transaction diagnostics. A stale client
// grant is deliberate: only Rules can decide the final permission at commit.
function syncRuntime(uid, { staleSettingsGrant = false } = {}) {
  const role = uid === owner ? 'owner' : 'seller';
  const db = env.authenticatedContext(uid).firestore();
  const readPaths = [];
  const c = {
    console, Date, structuredClone, db, doc: sdk.doc, deleteField: sdk.deleteField,
    serverTimestamp: sdk.serverTimestamp, increment: sdk.increment,
    currentUser: { uid }, auth: { currentUser: { uid } }, syncSessionGeneration: 1,
    state: { userProfile: { uid, role, businessId } }, currentPath: '',
    activeBusinessId: () => businessId, stableLegacyOperationId: item => item.operationId,
    now: () => '2026-10-20T12:00:00Z', queueKey: () => 'qa-settings-emulator-only',
    localStorage: { getItem: () => null }, CLOUD_NAMES: ['settings'], SOURCES: {},
    DB: { getWorkspaceGeneration: () => 0, carregar: () => ({}) },
    BusinessContext: { get: () => ({ businessId, role, loading: false, error: null,
      userProfile: { uid, businessId, active: true }, member: { status: 'active' },
      permissions: Object.keys(grants).filter(permission => grants[permission]).concat(staleSettingsGrant ? ['settings.manage'] : []) }) },
    WorkspaceRuntime: { capture: () => ({ businessId, uid, workspaceGeneration: 0 }) },
    TeamAccess: {
      has: permission => role === 'owner' || (permission === 'settings.manage' ? staleSettingsGrant : grants[permission] === true),
      actor: () => ({ actorUid: uid, actorRoleSnapshot: role, actorNameSnapshot: 'QA' }),
    },
    IDEMPOTENT_EVENT_NAMES: new Set(['sales', 'stockMovements']),
    sanitizeForFirestore: value => sanitizer(bridge(value)),
    errorCode: error => String(error.code || '').replace(/^firestore\//, ''),
    runTransaction: (firestore, handler) => sdk.runTransaction(firestore, transaction => handler({
      get: reference => { readPaths.push(reference.path); return transaction.get(reference); },
      set: (reference, data, options) => transaction.set(reference, bridge(data), options),
      update: (reference, data) => transaction.update(reference, bridge(data)),
      delete: reference => transaction.delete(reference),
    })),
  };
  c.window = c; vm.createContext(c);
  vm.runInContext(syncSection('function saleQueueRequiresReview(', 'const readPullState'), c);
  vm.runInContext(syncSection('function changedFields(', 'function captureChanges('), c);
  vm.runInContext(syncSection('function financialEffectFromWrites(', 'const readSignalVersions'), c);
  vm.runInContext(syncSection('function enrich(', 'function archiveQueue('), c);
  vm.runInContext(fs.readFileSync('js/firebase/product-import-fence.js', 'utf8').replace('export ', ''), c);
  vm.runInContext(syncSection('async function commitQueueItem(', 'async function verifySaleQueueCommit('), c);
  const operationId = 'qa-source-settings-' + randomUUID();
  const packet = {
    queueId: 'qa-source-queue-' + randomUUID(), operationId, businessId, userId: uid, payloadVersion: 4,
    createdAtLocal: '2026-10-20T12:00:00Z', status: 'pending', attempts: 0,
    payload: { eventKind: 'simple', writes: [{ entityType: 'settings', entityId: 'default',
      operation: 'update', before: { businessId }, data: { qaSetting: 'source-attempt' } }] },
  };
  return { c, packet, readPaths, commit: () => c.commitQueueItem(packet) };
}

test('seller and unresolved permission preflights block settings before any SDK read and keep the packet unchanged', async () => {
  for (const resolver of ['current-seller', null, { has: () => undefined }]) {
    const h = syncRuntime(seller), before = JSON.stringify(h.packet);
    if (resolver !== 'current-seller') h.c.TeamAccess = resolver;
    await assert.rejects(h.commit(), error => {
      assert.equal(error.code, resolver === 'current-seller' ? 'queue-quarantined' : 'settings-permission-required');
      assert.equal(error.syncDetail.stage, 'settings_permission_preflight');
      assert.equal(error.syncDetail.path, `businesses/${businessId}/settings/default`);
      return true;
    });
    assert.deepEqual(h.readPaths, []); assert.equal(JSON.stringify(h.packet), before);
    assert.equal((await adminRead('processedOperations', h.packet.operationId)).exists(), false);
  }
  const stale = syncRuntime(seller, { staleSettingsGrant: true }), before = JSON.stringify(stale.packet);
  const current = stale.c.BusinessContext.get(); stale.c.BusinessContext.get = () => ({ ...current, loading: true });
  assert.equal(stale.c.TeamAccess.has('settings.manage'), true);
  await assert.rejects(stale.commit(), error => {
    assert.equal(error.code, 'settings-permission-required');
    assert.equal(error.syncDetail.stage, 'settings_permission_preflight');
    return true;
  });
  assert.deepEqual(stale.readPaths, []); assert.equal(JSON.stringify(stale.packet), before);
  assert.equal((await adminRead('processedOperations', stale.packet.operationId)).exists(), false);
});

test('Rules denial after a stale settings grant reports the payload destination without claiming an individual Rule result', async () => {
  const h = syncRuntime(seller, { staleSettingsGrant: true });
  const before = JSON.stringify((await adminRead('settings', 'default')).data());
  const settingsPath = `businesses/${businessId}/settings/default`;
  const markerPath = `businesses/${businessId}/processedOperations/${h.packet.operationId}`;
  await assert.rejects(h.commit(), error => {
    assert.equal(error.code, 'permission-denied');
    assert.equal(error.syncDetail.stage, 'shared_settings_commit');
    assert.equal(error.syncDetail.collection, 'settings'); assert.equal(error.syncDetail.path, settingsPath);
    assert.equal(error.syncDetail.pathAttribution, 'payload_target_not_individual_rule_result');
    assert.equal(error.syncDetail.lastObservedPath, markerPath);
    assert.deepEqual(Array.from(error.syncDetail.transactionPaths), [settingsPath, markerPath]);
    return true;
  });
  assert.equal(JSON.stringify((await adminRead('settings', 'default')).data()), before);
  assert.equal((await adminRead('processedOperations', h.packet.operationId)).exists(), false);
});

test('a genuinely denied transaction read retains its exact observed path instead of blaming settings', async () => {
  const h = syncRuntime(noMarkerAccess, { staleSettingsGrant: true });
  const markerPath = `businesses/${businessId}/processedOperations/${h.packet.operationId}`;
  await assert.rejects(h.commit(), error => {
    assert.equal(error.code, 'permission-denied'); assert.equal(error.syncDetail.stage, 'transaction_read');
    assert.equal(error.syncDetail.path, markerPath); assert.equal(error.syncDetail.pathAttribution, 'observed_operation');
    assert.deepEqual(Array.from(error.syncDetail.transactionPaths), []);
    return true;
  });
  assert.deepEqual(h.readPaths, [markerPath]);
  assert.equal((await adminRead('processedOperations', h.packet.operationId)).exists(), false);
});

test('owner source pipeline still commits the same authorized settings change', async () => {
  const h = syncRuntime(owner); await h.commit();
  assert.equal((await adminRead('settings', 'default')).data().qaSetting, 'source-attempt');
  assert.equal((await adminRead('processedOperations', h.packet.operationId)).data().status, 'processed');
});
