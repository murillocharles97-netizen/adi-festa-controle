const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const read = file => fs.readFileSync(path.join(root, file), 'utf8');

const sync = read('js/firebase/sync.js');
const repository = read('js/firebase/firestore-repository.js');
const bridge = read('js/firebase/catalog-bridge.js');
const publicCatalog = read('js/catalogo-publico.js');
const worker = read('service-worker.js');
const rules = read('firestore.rules');

assert.match(sync, /REALTIME_NAMES=new Set\(\['clients','products','sales','payments','settings'\]\)/);
assert.match(sync, /PULL_TTL_MS=300000/);
assert.match(sync, /listChangedSince\(since,500\)/);
assert.match(sync, /listAllPaged\(200\)/);
assert.doesNotMatch(sync, /connection-test/);

assert.match(repository, /CACHE_TTL_MS=60000/);
assert.match(repository, /async listAllPaged\(max=200\)/);
assert.match(repository, /listenerClosed\(collectionName\)/);

assert.match(bridge, /\.slice\(0,3\)/);
assert.match(bridge, /function stopAllSubscriptions\(\)/);
assert.match(bridge, /firebase-sync-status/);

assert.match(publicCatalog, /getDoc\(reference\)/);
assert.doesNotMatch(publicCatalog, /getDocs\(collection\(/);
assert.match(publicCatalog, /subscribedOrderIds\.size>=5/);
assert.match(publicCatalog, /addEventListener\('pagehide'/);

assert.match(worker, /adi-festa-v45-mobile-settings/);
assert.match(worker, /const copy=response\.clone\(\);await caches\.open\(CACHE\)/);
assert.doesNotMatch(worker, /cache\.put\(event\.request,response\)\.then\(\(\)=>response\.clone/);

assert.match(rules, /match \/businesses\/\{businessId\}/);
assert.match(rules, /currentBusinessId\(\) == businessId/);
assert.match(rules, /match \/publicCatalogs\/\{visitToken\} \{[\s\S]*allow get: if true;[\s\S]*allow list: if false;/);

console.log('hardening.test.js: OK');
