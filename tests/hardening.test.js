const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const sync = read('js/firebase/sync.js');
const repository = read('js/firebase/firestore-repository.js');
const bridge = read('js/firebase/catalog-bridge.js');
const publicCatalog = read('js/catalogo-publico.js');
const firebaseConfig = read('js/firebase/firebase-config.js');
const auth = read('js/firebase/auth.js');
const lifecycle = read('js/firebase/session-lifecycle.js');
const worker = read('service-worker.js');
const rules = read('firestore.rules');

assert.match(sync, /REALTIME_NAMES\s*=\s*new Set\(\["clients", "products", "settings"\]\)/);
assert.match(sync, /PULL_TTL_MS\s*=\s*300000/);
assert.match(sync, /listChangedSince\(since,\s*500\)/);
assert.match(sync, /listAllPaged\(200\)/);
assert.doesNotMatch(sync, /setInterval\(automaticSync/);
assert.match(sync, /cloudPaused/);
assert.match(sync, /["']permission-denied["'][\s\S]*["']unauthenticated["'][\s\S]*["']resource-exhausted["'][\s\S]*["']failed-precondition["']/);
assert.doesNotMatch(sync, /connection-test/);
assert.match(sync, /function setUser\(user,\s*profile\s*=\s*null,\s*business\s*=\s*null\)/);
assert.match(sync, /testPassed\s*:\s*trustedBootstrap/);
assert.match(sync, /payloadVersion:\s*PAYLOAD_VERSION/);
assert.match(sync, /legacyBackup/);
assert.match(sync, /compatBackup/);
assert.match(sync, /getQueueDiagnostics/);
assert.match(sync, /describeResult:\s*describeSyncResult/);
assert.match(sync, /full:\s*true/);
assert.match(sync, /balance_adjustment/);
assert.doesNotMatch(sync, /localStorage\.clear\(/);

assert.match(repository, /CACHE_TTL_MS\s*=\s*60000/);
assert.match(repository, /async listAllPaged\(max\s*=\s*200\)/);
assert.match(repository, /listenerClosed\(collectionName\)/);

assert.match(bridge, /desired=universal\?\.publicToken\?\[universal\]:\[\]/);
assert.match(bridge, /function stopAllSubscriptions\(\)/);
assert.match(bridge, /firebase-sync-status/);

assert.match(publicCatalog, /getDoc\(reference\)/);
assert.doesNotMatch(publicCatalog, /getDocs\(collection\(/);
assert.match(publicCatalog, /subscribedOrderIds\.size>=5/);
assert.match(publicCatalog, /addEventListener\('pagehide'/);

assert.match(worker, /adi-festa-v64-sync-reconciliation/);
assert.match(worker, /const copy=response\.clone\(\);await caches\.open\(CACHE\)/);
assert.doesNotMatch(worker, /cache\.put\(event\.request,response\)\.then\(\(\)=>response\.clone/);
assert.match(worker, /then\(\(\)=>self\.skipWaiting\(\)\)/);

assert.match(firebaseConfig,/persistentLocalCache/);
assert.doesNotMatch(firebaseConfig,/enableIndexedDbPersistence/);
assert.match(auth,/cleanupCurrentSession\(\)/);
assert.match(lifecycle,/export function registerCleanup/);
assert.match(lifecycle,/export function cleanupCurrentSession/);

assert.match(rules, /match \/businesses\/\{businessId\}/);
assert.match(rules, /currentBusinessId\(\) == businessId/);
assert.match(rules, /match \/publicCatalogs\/\{visitToken\} \{[\s\S]*allow get: if true;[\s\S]*allow list: if false;/);

console.log('hardening.test.js: OK');
