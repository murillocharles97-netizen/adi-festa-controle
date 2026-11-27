'use strict';
// Fase 4 — loja do saldo por cliente e Espaço publicado pelo servidor. Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');

function load() {
  const storage = new Map(), events = [];
  const c = {console, JSON, Map, Set, Number, String, Object, Array, CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    localStorage: {getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v)}};
  c.window = c; c.dispatchEvent = e => events.push(e);
  vm.createContext(c); vm.runInContext(fs.readFileSync('js/customer-space-accounts.js', 'utf8'), c);
  return {store: c.CustomerSpaceAccounts, storage, events, c};
}
const row = (clientId, spaceId, debtCents, extra = {}) => ({type: 'added', id: `${clientId}__${spaceId || 'sem-espaco'}`,
  data: {businessId: 'fx-shop', workspaceGeneration: 0, clientId, spaceId, debtCents, financialVersion: 8, status: 'ready', ...extra}});
const scope = {uid: 'fx-owner', businessId: 'fx-shop', generation: 0, complete: true};

test('soma por Espaço, crédito e parte sem Espaço; vazio antes do escopo', () => {
  const {store} = load();
  assert.equal(store.forClient('fx-a', 8), null);
  store.reset(scope);
  store.apply('fx-shop', [row('fx-a', 'A', 15000), row('fx-a', 'B', 7000), row('fx-a', null, 1000), row('fx-b', 'A', -3000)]);
  assert.deepEqual(JSON.parse(JSON.stringify(store.forClient('fx-a', 8))), {spaces: {A: 15000, B: 7000}, unattributedCents: 1000, totalCents: 23000, complete: true, live: true});
  assert.equal(store.forClient('fx-b', 8).totalCents, -3000);
  assert.equal(store.ready(), true);
});

test('Espaço zerado sai da soma; documento removido some; outra empresa ou geração é ignorada', () => {
  const {store} = load(); store.reset(scope);
  store.apply('fx-shop', [row('fx-a', 'A', 15000), row('fx-a', 'B', 7000)]);
  store.apply('fx-shop', [{...row('fx-a', 'A', 0), type: 'modified'}]);
  assert.deepEqual(JSON.parse(JSON.stringify(store.forClient('fx-a', 8).spaces)), {A: 0, B: 7000});
  store.apply('fx-shop', [{type: 'removed', id: 'fx-a__B', data: {clientId: 'fx-a'}}]);
  assert.equal(store.forClient('fx-a', 8).totalCents, 0);
  store.apply('fx-shop', [row('fx-c', 'A', 100, {businessId: 'fx-other'}), row('fx-d', 'A', 100, {workspaceGeneration: 1}), row('fx-e', 'A', 1.5)]);
  for (const id of ['fx-c', 'fx-d', 'fx-e']) assert.equal(store.forClient(id, 8), null, id);
  store.apply('fx-other', [row('fx-f', 'A', 100)]);
  assert.equal(store.forClient('fx-f', 8), null);
});

test('cópia local do mesmo escopo aparece como não atualizada até chegar o servidor; outro escopo começa vazio', () => {
  const first = load(); first.store.reset(scope); first.store.apply('fx-shop', [row('fx-a', 'A', 15000)]);
  const second = load();
  for (const [k, v] of first.storage) second.storage.set(k, v);
  second.store.reset(scope);
  assert.equal(second.store.forClient('fx-a', 8), null); assert.equal(second.store.ready(), false);
  second.store.apply('fx-shop', []);
  assert.equal(second.store.ready(), true);
  second.store.reset({...scope, uid: 'fx-other-user'});
  assert.equal(second.store.forClient('fx-a', 8), null, 'outro usuário não herda a cópia');
  second.store.reset(null);
  assert.equal(second.store.forClient('fx-a', 8), null); assert.equal(second.store.ready(), false);
});

test('só usa documentos da mesma versão, inclusive quando o total não muda', () => {
  const {store} = load();
  store.reset({...scope, complete: false, spaces: ['A', 'B']});
  store.apply('fx-shop', [row('fx-a','A',200), row('fx-a','B',400,{financialVersion:7})]);
  assert.equal(store.forClient('fx-a', 8), null);
  store.apply('fx-shop', [row('fx-a','B',400)]);
  assert.equal(store.forClient('fx-a', 8).totalCents, 600);
  assert.equal(store.forClient('fx-a', 9), null);
  store.apply('fx-shop', [row('fx-a','B',400,{financialVersion:null})]);
  assert.equal(store.forClient('fx-a', 8), null);
});

test('avisa as telas com os clientes alterados', () => {
  const {store, events} = load(); store.reset(scope); events.length = 0;
  store.apply('fx-shop', [row('fx-a', 'A', 100), row('fx-b', 'B', 200)]);
  assert.deepEqual(JSON.parse(JSON.stringify(events.at(-1).detail.clientIds)).sort(), ['fx-a', 'fx-b']);
  assert.equal(events.at(-1).type, 'customer-accounts-updated');
});

test('reduzir os Espaços ou o perfil da mesma identidade deixa a cópia anterior inacessível', () => {
  const {store} = load();
  store.reset({...scope, grants: 'owner'});
  store.apply('fx-shop', [row('fx-a', 'A', 15000), row('fx-b', 'B', 7000), row('fx-c', null, 1000)]);
  store.reset({...scope, complete: false, grants: 'receive', spaces: ['A']});
  assert.equal(store.forClient('fx-b', 8), null);
  assert.equal(store.forClient('fx-c', 8), null);
  store.apply('fx-shop', [row('fx-a', 'A', 15000), row('fx-b', 'B', 7000), row('fx-c', null, 1000)]);
  assert.equal(store.forClient('fx-a', 8).totalCents, 15000);
  assert.equal(store.forClient('fx-b', 8), null);
  assert.equal(store.forClient('fx-c', 8), null);
});

test('leitor só confirma após todos os grupos do servidor e substitui uma cópia incompleta', () => {
  const {store, c} = load(), listeners = [], events = new Map();
  const ids = Array.from({length: 31}, (_, i) => 'space-' + String(i).padStart(2, '0'));
  let context = {businessId: 'fx-shop', role: 'staff', spaceAccess: 'selected', allowedSpaceIds: ids, permissionSignature: 'receive'};
  Object.assign(c, {BusinessContext: {get: () => context}, FirebaseSession: {user: {uid: 'fx-user'}},
    TeamAccess: {has: () => true}, db: {}, collection: () => ({}), query: () => ({}), where: () => ({}),
    addEventListener: (event, run) => events.set(event, run),
    onSnapshot: (_, opts, resolve, reject) => { listeners.push({resolve, reject, opts}); return () => {}; }});
  store.reset({...scope, uid: 'fx-user', complete: false, grants: 'receive', spaces: ids});
  store.apply('fx-shop', [row('fx-stale', ids[0], 200)]);
  vm.runInContext(fs.readFileSync('js/firebase/customer-accounts-reader.js','utf8').replace(/^import .*$/gm, ''), c);
  const snapshot = (fromCache, docs = []) => ({
    metadata: {fromCache, hasPendingWrites: false}, docs: docs.map(e => ({id: e.id, data: () => e.data})),
    docChanges: () => [],
  });
  assert.equal(listeners.length, 2);
  assert.equal(listeners[0].opts.includeMetadataChanges, true);
  assert.equal(store.forClient('fx-stale', 8), null);
  listeners[0].resolve(snapshot(true));
  assert.equal(store.ready(), false);
  listeners[0].resolve(snapshot(false, [row('fx-new', ids[0], 100)]));
  assert.equal(store.forClient('fx-stale', 8), null, 'servidor remove o registro ausente, inclusive se veio da cópia');
  assert.equal(store.ready(), false);
  listeners[1].resolve(snapshot(false));
  assert.equal(store.ready(), true);
  listeners[1].resolve(snapshot(true));
  assert.equal(store.ready(), false);
  context = {...context, allowedSpaceIds: [ids[30]], permissionSignature: 'narrow'};
  events.get('business-context-changed')();
  assert.equal(store.forClient('fx-new', 8), null);
  listeners[0].resolve(snapshot(false, [row('fx-new', ids[0], 100)]));
  assert.equal(store.forClient('fx-new', 8), null, 'callback da sessão anterior não repõe dados');
  listeners[2].reject(Error('permission-denied'));
  assert.equal(store.scope(), null);
  context = {...context, allowedSpaceIds: ids, permissionSignature: 'receive'};
  events.get('business-context-changed')();
  listeners[0].resolve(snapshot(false, [row('fx-old-callback', ids[0], 700)]));
  assert.equal(store.forClient('fx-old-callback', 8), null);
  listeners[3].resolve(snapshot(false, [row('fx-current', ids[0], 500)]));
  listeners[4].resolve(snapshot(false));
  assert.equal(store.forClient('fx-current', 8).totalCents, 500);
  assert.equal(store.forClient('fx-old-callback', 8), null);
});


test('versão de exibição é confirmada por sessão e geração e não regride após resposta atrasada', () => {
  const source = fs.readFileSync('js/firebase/sync.js', 'utf8');
  const from = source.indexOf('function rememberCanonicalClients('), to = source.indexOf('function recentCanonicalClientSnapshot(', from);
  assert.ok(from >= 0 && to > from);
  const c = {
    navigator: {onLine: true},
    currentUser: {uid: 'qa-owner'},
    auth: {currentUser: {uid: 'qa-owner'}},
    DB: {getWorkspaceGeneration: () => 3},
    activeBusinessId: () => 'fx-shop',
    now: () => '2026-10-20T11:00:00Z',
    rememberCustomerPresence() {},
    roundedMoney: n => Math.round(n * 100) / 100,
    sameFinancialMoney: (a, b) => Math.round(a * 100) === Math.round(b * 100),
    financialVersionOf: client => client.financialVersion,
    canonicalClientSnapshots: new Map(),
    canonicalClientSnapshotKey: (bid, id) => bid + ':' + id
  };
  vm.createContext(c);
  vm.runInContext(source.slice(from, to), c);
  const client = {id: 'qa-client', businessId: 'fx-shop', workspaceGeneration: 3, saldo: -60, financialVersion: 11};
  c.rememberCanonicalClients([client], {source: 'server', fromCache: true});
  assert.equal(c.confirmedClientFinancialVersion(client), null);
  c.rememberCanonicalClients([client], {source: 'server'});
  assert.equal(c.confirmedClientFinancialVersion(client), 11);
  const earlier = {...client, financialVersion: 10};
  c.rememberCanonicalClients([earlier], {source: 'server'});
  assert.equal(c.confirmedClientFinancialVersion(earlier), null);
  assert.equal(c.confirmedClientFinancialVersion(client), 11);
  assert.equal(c.confirmedClientFinancialVersion({...client, workspaceGeneration: 2}), null);
  assert.equal(c.confirmedClientFinancialVersion({...client, customerDirectoryOnly: true}), null);
  c.navigator.onLine = false;
  assert.equal(c.confirmedClientFinancialVersion(client), null);
});
