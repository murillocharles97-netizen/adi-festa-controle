'use strict';
// Fictitious reproduction of a closed legacy Fiado on one device: the server no
// longer lists the old records, one service sale is permanently blocked and the
// client of that sale was regularized on the server. No real data.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'),
  cp = require('node:child_process'), crypto = require('node:crypto'), {JSDOM} = require('jsdom');
const audit = require('../js/integrity');
const PUBLISHED = 'e45a93486eb1ec81c476a7441c87b5c6d0da2953';
const source = fs.readFileSync('js/firebase/sync.js', 'utf8'), ui = fs.readFileSync('js/firebase/firebase-ui.js', 'utf8');
const published = () => cp.execFileSync('git', ['show', PUBLISHED + ':js/firebase/sync.js'], {encoding: 'utf8', maxBuffer: 4e6});
const section = (text, start, end) => {
  const a = text.indexOf(start); if (a < 0) throw Error('missing ' + start);
  const b = text.indexOf(end, a); if (b < 0) throw Error('missing ' + end);
  return text.slice(a, b);
};

const CUTOFF = '2026-01-10T12:00:00.000Z', opening = {version: 1, hash: 'qa-opening-hash'};
function fixture() {
  const legacySales = Array.from({length: 5}, (_, n) => ({id: 'qa-legacy-sale-' + n, operationId: 'qa-legacy-op-' + n, clienteId: 'qa-client-legacy',
    formaPagamento: 'fiado', status: 'fiado', valorFinal: 10, createdAt: `2026-01-0${n + 1}T10:00:00.000Z`}));
  const currentSales = [
    {id: 'qa-current-sale-1', operationId: 'qa-current-op-1', clienteId: 'qa-client-current', formaPagamento: 'fiado', status: 'fiado', valorFinal: 40, createdAt: '2026-02-01T10:00:00.000Z'},
    {id: 'qa-current-sale-2', operationId: 'qa-current-op-2', clienteId: 'qa-client-current', formaPagamento: 'pix', status: 'pago', valorFinal: 15, createdAt: '2026-02-02T10:00:00.000Z'},
  ];
  const heldSale = {id: 'qa-held-sale', operationId: 'qa-held-op', clienteId: 'qa-client-held', formaPagamento: 'pix', status: 'pago', valorFinal: 25, createdAt: '2026-02-03T10:00:00.000Z'};
  const legacyPayments = Array.from({length: 3}, (_, n) => ({id: 'qa-legacy-pay-' + n, operationId: 'qa-legacy-pay-' + n, clienteId: 'qa-client-legacy', valor: 5, createdAt: '2026-01-05T10:00:00.000Z'}));
  const currentPayment = {id: 'qa-current-pay', operationId: 'qa-current-pay', clienteId: 'qa-client-current', valor: 5, createdAt: '2026-02-02T11:00:00.000Z'};
  const local = {
    clientes: [
      {id: 'qa-client-legacy', nome: 'Cliente fictício A', saldo: -120, fiadoOpeningBalance: opening},
      {id: 'qa-client-current', nome: 'Cliente fictício B', saldo: -40, fiadoOpeningBalance: opening},
      {id: 'qa-client-held', nome: 'Cliente fictício C', saldo: -50},
    ],
    produtos: [], vendas: [...legacySales, ...currentSales, heldSale], pagamentos: [...legacyPayments, currentPayment], movimentacoes: [],
  };
  // The server: legacy records were removed by the closure, the blocked sale never
  // arrived and the held client received a confirmed regularization (+30 debt).
  const cloud = {
    clients: [
      {id: 'qa-client-legacy', saldo: -120, fiadoOpeningBalance: opening},
      {id: 'qa-client-current', saldo: -40, fiadoOpeningBalance: opening},
      {id: 'qa-client-held', saldo: -80, fiadoHistoryActivation: {spaceRegularization: {version: 1, operationId: 'qa-regularization'}}},
    ],
    sales: structuredClone(currentSales), payments: [structuredClone(currentPayment)],
  };
  const queue = [{operationId: 'qa-held-op', status: 'error', lastErrorCode: 'failed-precondition', createdAt: '2026-02-03T10:00:00.000Z',
    payload: {eventKind: 'sale', writes: [
      {entityType: 'clients', entityId: 'qa-client-held', operation: 'update', data: {ultimaCompra: '2026-02-03T10:00:00.000Z'}},
      {entityType: 'sales', entityId: 'qa-held-sale', operation: 'create', data: heldSale},
    ]}}];
  return {local, cloud, queue};
}
function syncHarness({implementation = source, data = fixture()} = {}) {
  const {local, cloud, queue} = data, emits = [];
  const ctx = {businessId: 'adi-festa', role: 'owner', business: {fiadoLegacyClosed: {version: 1, state: 'complete', openingsAt: CUTOFF}}};
  const s = {console, Date, Map, Set, Math, Number, String, Boolean, Array, Object, JSON, Error, structuredClone,
    BusinessContext: {get: () => ctx}, IntegrityAudit: audit, DB: {carregar: () => local, flush: async () => {}},
    currentUser: {uid: 'qa-owner'}, activeBusinessId: () => 'adi-festa', namespace: () => 'qa-scope', now: () => '2026-02-10T12:00:00.000Z',
    readQueue: () => queue, readRecoveryResolution: () => null, readPaymentRecoveryReceipt: () => null,
    isHistoricalProjectionBatch: () => false, queueQuarantineReason: () => '', favoriteWriteWasRejected: () => false,
    classifyQueueOperation: item => item.status === 'error' ? {category: 'error', sendable: false} : {category: 'pending', sendable: true},
    normalizeFirestoreData: item => ({...item}), rememberCustomerPresence() {}, roundedMoney: value => Math.round(Number(value || 0) * 100) / 100,
    canPullSource: () => true, queueCounts: () => ({active: queue.length, pending: 0, errors: queue.length}),
    emit: patch => { emits.push(patch); Object.assign(s.state, patch); },
  };
  s.window = s; vm.createContext(s);
  for (const [a, b] of [['const SOURCES = {', 'const QUEUE_ENTITY_ALIASES'], ['const canonicalClientSnapshotKey =', 'async function readCheckoutCustomerDirect('],
    ['function rememberCanonicalClients(', 'function recentCanonicalClientSnapshot('], ['const sourceItems =', 'const stableComparable ='],
    ['function archivedFiadoRecord(', 'async function assertFiadoReceiptWriter('], ['function pendingIds(', 'function markLocalCreditSaleConfirmed('],
    ['function cleanCloudItem(', 'function mergeCloudCollectionIntoData('], ['async function compareLocalAndCloud(', 'function describeSyncResult(']])
    vm.runInContext(section(implementation, a, b), s);
  vm.runInContext('var canonicalClientSnapshots = new Map(); this.lastFullPullForAudit = null;', s);
  // What a full manual pull leaves behind: server counts, debt summary, snapshots and documents.
  s.state = {cloudCounts: {clients: cloud.clients.length, products: 0, sales: cloud.sales.length, payments: cloud.payments.length},
    cloudFinancial: vm.runInContext('cloudDebtSummary', s)(cloud.clients), cloudNewest: {}};
  vm.runInContext('rememberCanonicalClients', s)(cloud.clients, {source: 'server', readAt: '2026-02-10T12:00:00.000Z'});
  s.lastFullPullForAudit = {businessId: 'adi-festa', sessionScope: 'qa-scope', entries: Object.entries(cloud).map(([name, documents]) => ({name, documents}))};
  return {s, local, cloud, queue, emits, run: code => vm.runInContext(code, s)};
}

test('published V242.8 reproduces the incident: raw totals mismatch although nothing was lost', async () => {
  const h = syncHarness({implementation: published()}), result = await h.run('compareLocalAndCloud()');
  assert.equal(result.local.vendas, 8); assert.equal(result.remote.sales, 2);
  assert.equal(result.local.pagamentos, 4); assert.equal(result.remote.payments, 1);
  assert.equal(result.countsMatch, false, 'old screen showed Aparelho 8 / Nuvem 2');
  assert.equal(result.basis, undefined);
  assert.equal(result.local.fiado, 210); assert.equal(result.remote.fiado, 240);
});

test('comparable counts apply the closed-Fiado rule to both sides and set queued records aside', async () => {
  const h = syncHarness(), result = await h.run('compareLocalAndCloud()');
  assert.deepEqual({...result.basis.sales}, {total: 8, archivedLegacyFiado: 5, heldByQueue: 1, comparable: 2, remoteTotal: 2, remoteArchivedLegacyFiado: 0, remoteComparable: 2});
  assert.deepEqual({...result.basis.payments}, {total: 4, archivedLegacyFiado: 3, heldByQueue: 0, comparable: 1, remoteTotal: 1, remoteArchivedLegacyFiado: 0, remoteComparable: 1});
  assert.equal(result.countsMatch, true);
  assert.equal(result.ok, false, 'an active blocked operation still prevents a complete result');
  assert.equal(result.local.vendas, 8, 'raw totals stay available for audit');
});

test('a legacy record still present on the server is excluded on both sides, never only on the device', async () => {
  const data = fixture(); data.cloud.sales.push(structuredClone(data.local.vendas[0]));
  const result = await syncHarness({data}).run('compareLocalAndCloud()');
  assert.equal(result.basis.sales.remoteArchivedLegacyFiado, 1);
  assert.equal(result.basis.sales.comparable, result.basis.sales.remoteComparable);
  assert.equal(result.countsMatch, true);
});

test('a genuinely missing current sale is still reported as a difference', async () => {
  const data = fixture(); data.cloud.sales = data.cloud.sales.slice(1);
  const result = await syncHarness({data}).run('compareLocalAndCloud()');
  assert.equal(result.basis.sales.comparable, 2); assert.equal(result.basis.sales.remoteComparable, 1);
  assert.equal(result.countsMatch, false);
});

test('a blocked operation freezes its client: the pull skips the server balance, and the comparison explains the Fiado gap', async () => {
  const h = syncHarness(), stale = h.local.clientes.map(client => client.id === 'qa-client-current' ? {...client, saldo: -30} : client);
  const merged = h.run('reconcileLocalAndCloud')('clients', stale, h.cloud.clients, h.run('pendingIds("clients")'), true);
  assert.equal(merged.find(client => client.id === 'qa-client-current').saldo, -40, 'a client without queued writes takes the server value');
  assert.equal(merged.find(client => client.id === 'qa-client-held').saldo, -50, 'the held client keeps the old device value');
  const rows = h.run('retainedClientBalances()');
  assert.equal(rows.length, 1);
  assert.deepEqual({...rows[0], operations: undefined}, {clientId: 'qa-client-held', clientName: 'Cliente fictício C', localBalance: -50, cloudBalance: -80,
    cloudReadAt: '2026-02-10T12:00:00.000Z', difference: 30, blockedOnly: true, operations: undefined});
  assert.equal(rows[0].operations[0].operationId, 'qa-held-op'); assert.equal(rows[0].operations[0].sendable, false);
  const result = await h.run('compareLocalAndCloud()');
  assert.equal(result.retainedDebtDifference, -30);
  assert.equal(Math.round((result.local.fiado - result.remote.fiado) * 100) / 100, result.retainedDebtDifference);
  assert.equal(JSON.stringify(h.queue).includes('resolved'), false, 'the queue is never rewritten');
});

test('a failure while explaining counts falls back to raw totals and never fails Sync', async () => {
  const h = syncHarness();
  h.s.readQueue = () => { throw Error('queue read failed in QA'); };
  const result = await h.run('compareLocalAndCloud()');
  assert.equal(result.basis, null); assert.equal(result.retainedBalances.length, 0);
  assert.equal(result.countsMatch, false, 'raw totals are compared as before');
  assert.match(result.explanationErrors.join(' '), /queue read failed in QA/);
});

function manualSyncHarness({implementation = source, counts, syncFailure = null}) {
  const emits = [], audits = [];
  const s = {console, Date, Promise, Map, Set, JSON, Math, Number, String, Error, Object, navigator: {onLine: true},
    state: {testPassed: true, syncFailure, integrityStatus: 'not_checked'}, currentUser: {uid: 'qa-owner'},
    writeSyncTime() {}, lastAttemptKey: () => 'attempt', lastSyncKey: () => 'sync', lastCompleteKey: () => 'complete', now: () => '2026-02-10T12:00:00.000Z',
    emit: patch => { emits.push(patch); Object.assign(s.state, patch); }, validateUser: async () => {}, traceSync() {},
    BusinessContext: {get: () => ({role: 'owner'})}, activeBusinessId: () => 'adi-festa', DB: {flush: async () => {}},
    syncStep: async (stage, fn) => fn(), migrateScopedQueueCompatibility: () => ({}), validateQueueOwnership() {},
    processSyncQueue: async () => ({sent: 0, collections: []}), captureCloudReadScope: () => 'scope', assertCloudReadScope() {},
    pullCloudCollections: async () => 0, cleanupConfirmedLegacyFixtures: async () => {}, lastFullPullForAudit: {qa: true},
    compareLocalAndCloud: async () => ({ok: false, countsMatch: true}), queueCounts: () => counts, safePublishSyncSignal: async () => {},
    preservedQueueMessage: () => '', lastError: '', lastErrorCode: '',
    compareDeviceWithCloud: async options => { audits.push(options); s.state.integrityStatus = 'completed'; return {integrity: {level: 'OK', actionable: false}}; },
  };
  s.window = s; vm.createContext(s);
  vm.runInContext(section(implementation, 'function describeSyncResult(', 'function synchronizeNow(') + section(implementation, 'async function runManualSync(', 'async function runAutomaticSync('), s);
  return {s, emits, audits, run: () => s.runManualSync()};
}
const blockedOnly = {pending: 0, errors: 3, active: 3, total: 5, archived: 2, quarantined: 0, manualReview: 0, processing: 0, preparing: 0, awaitingReceipt: 0};

test('published V242.8 never compares after Sync while three blocked sales remain (integrity stays not_checked)', async () => {
  const h = manualSyncHarness({implementation: published(), counts: blockedOnly}), result = await h.run();
  assert.equal(h.audits.length, 0); assert.equal(result.dataSynced, false); assert.equal(h.s.state.integrityStatus, 'not_checked');
});

test('manual Sync runs the read-only comparison when nothing can be sent, without turning blocked errors green', async () => {
  const h = manualSyncHarness({counts: blockedOnly}), result = await h.run();
  assert.equal(h.audits.length, 1); assert.equal(h.audits[0].prefetched, h.s.lastFullPullForAudit, 'reuses this pull, no extra full read');
  assert.equal(result.integrityStatus, 'completed'); assert.equal(result.dataSynced, false); assert.equal(result.complete, false);
  assert.equal(h.s.state.status, 'error', 'blocked operations keep the error state');
  assert.equal(h.emits.some(patch => patch.status === 'success'), false);
  assert.equal(h.s.state.integrityDeferredReason, '');
});

for (const [name, counts, failure, reason] of [
  ['a sendable operation', {...blockedOnly, pending: 1}, null, 'operations_waiting_to_send'],
  ['an operation in flight', {...blockedOnly, processing: 1}, null, 'operations_waiting_to_send'],
  ['an active Sync failure', blockedOnly, {stage: 'uploading_changes', code: 'unavailable'}, 'sync_failure'],
]) test(name + ' postpones the comparison and records why', async () => {
  const h = manualSyncHarness({counts, syncFailure: failure}), result = await h.run();
  assert.equal(h.audits.length, 0); assert.equal(result.integrityStatus, 'not_checked'); assert.equal(h.s.state.integrityDeferredReason, reason);
});

test('a clean queue keeps the existing complete Sync and green status after the comparison', async () => {
  const clean = {...blockedOnly, errors: 0, active: 0}, h = manualSyncHarness({counts: clean}), result = await h.run();
  assert.equal(result.complete, true); assert.equal(h.audits.length, 1); assert.equal(h.s.state.status, 'success');
});

function uiContext(retained = []) {
  const c = {window: {SyncFirebase: {retainedClientBalances: () => retained}}, navigator: {onLine: true}, Date, Number, String, Object, Array, Math};
  vm.createContext(c);
  vm.runInContext(section(ui, 'const escape=', 'const notify=') + section(ui, 'const money=', 'function fiadoScopeHtml(') +
    section(ui, 'const SERVICE_COST_FIX_PUBLISHED_AT', 'window.VeconiSyncPanelView = syncPanelView;') +
    section(ui, '// Sync overview: the screen opens', 'function openQueueDetails('), c);
  return c;
}
const historical = n => Array.from({length: n}, (_, i) => ({operationId: 'qa-hist-' + i, category: 'error', status: 'error', activeError: true, replayBlocked: true, canRetry: false,
  reviewReason: 'service_configuration_missing', createdAt: '2026-11-19T11:00:00.000Z'}));
const retainedRow = {clientId: 'qa-client-held', clientName: 'Cliente fictício C', localBalance: -50, cloudBalance: -80, difference: 30, blockedOnly: true,
  operations: [{operationId: 'qa-held-op', sendable: false, createdAt: '2026-11-19T11:00:00.000Z'}]};
const overview = (c, state, items = []) => c.syncOverview(state, items, c.syncPanelView(state, items));

test('overview: the incident shows differences and blocked history, never "Tudo confirmado"', () => {
  const c = uiContext([retainedRow]), o = overview(c, {status: 'error', errors: 3, pending: 0, integrityStatus: 'not_checked'}, historical(3));
  assert.equal(o.key, 'differences'); assert.equal(o.review, 3); assert.equal(o.retained.length, 1);
  assert.notEqual(o.title, 'Tudo confirmado');
  const html = c.syncOverviewHtml(o);
  assert.match(html, /3 bloqueadas para revisão/); assert.match(html, /1 cliente com saldo retido/); assert.match(html, /Ainda não feita nesta sessão/);
  assert.match(html, /data-open-blocked/); assert.match(html, /data-compare-cloud/); assert.match(html, /data-recovery-export-slot/);
  const retainedHtml = c.retainedBalancesHtml(o.retained);
  assert.match(retainedHtml, /Neste aparelho: R\$\s*50,00 em aberto\. Na nuvem: R\$\s*80,00 em aberto/);
  assert.match(retainedHtml, /Não registre outro ajuste para compensar/);
});

test('overview states: blocked only, not compared, pending, updating, differences and confirmed', () => {
  const c = uiContext([]), audited = {integrity: {level: 'OK', actionable: false}, generatedAt: '2026-11-24T18:30:00.000Z', collections: {sales: {onlyLocal: [], onlyRemote: [], divergent: []}}};
  assert.equal(overview(c, {status: 'error', errors: 3, integrityStatus: 'not_checked'}, historical(3)).key, 'review');
  const notCompared = overview(c, {status: 'success', integrityStatus: 'not_checked'});
  assert.equal(notCompared.key, 'unconfirmed'); assert.match(notCompared.text, /ainda não foi feita nesta sessão/);
  assert.equal(overview(c, {status: 'success', integrityStatus: 'failed'}).key, 'unconfirmed');
  const pending = overview(c, {status: 'waiting', pending: 2, integrityStatus: 'completed', dataAudit: audited});
  assert.equal(pending.key, 'unconfirmed'); assert.match(pending.text, /2 alterações deste aparelho/);
  assert.equal(overview(c, {status: 'syncing', integrityStatus: 'not_checked'}).key, 'updating');
  assert.equal(overview(c, {status: 'success', integrityStatus: 'checking'}).key, 'updating');
  const differences = {...audited, collections: {sales: {onlyLocal: [{classification: 'B', category: 'local_only'}, {classification: 'A', category: 'local_only'}], onlyRemote: [], divergent: []}}};
  const found = overview(c, {status: 'success', integrityStatus: 'completed', dataAudit: differences});
  assert.equal(found.key, 'differences'); assert.equal(found.differences, 1, 'a queued (A) record is not a persistence difference');
  const confirmed = overview(c, {status: 'success', integrityStatus: 'completed', dataAudit: audited});
  assert.equal(confirmed.key, 'confirmed'); assert.equal(confirmed.title, 'Tudo confirmado');
});

test('actions appear only when they can run', () => {
  const c = uiContext([]);
  c.navigator.onLine = false;
  const offline = c.syncOverviewHtml(overview(c, {status: 'offline', integrityStatus: 'not_checked'}));
  assert.doesNotMatch(offline, /data-compare-cloud/); assert.doesNotMatch(offline, /data-open-blocked/); assert.match(offline, /data-export-diagnostic/);
  assert.doesNotMatch(c.recoveryExportActionHtml(0), /<button/); assert.match(c.recoveryExportActionHtml(0), /Indisponível[\s\S]*não é uma cópia geral/);
  assert.match(c.recoveryExportActionHtml(2), /data-export-recovery[\s\S]*2 vendas originais retidas/);
  assert.match(c.recoveryExportActionHtml(null), /data-export-recovery/);
});

test('count comparison names each universe instead of raw device and cloud totals', () => {
  const c = uiContext([]), html = c.countComparisonHtml({local: {clientes: 3, produtos: 0, vendas: 8, pagamentos: 4, fiado: 210}, remote: {clients: 3, products: 0, sales: 2, payments: 1, fiado: 240},
    basis: {sales: {total: 8, archivedLegacyFiado: 5, heldByQueue: 1, comparable: 2, remoteComparable: 2, remoteArchivedLegacyFiado: 0},
      payments: {total: 4, archivedLegacyFiado: 3, heldByQueue: 0, comparable: 1, remoteComparable: 1, remoteArchivedLegacyFiado: 0}},
    retainedDebtDifference: -30, scope: {collections: ['clients', 'products', 'sales', 'payments'], financialAudited: true}}, null);
  assert.match(html, /Guardadas neste aparelho: 8\. Ficam fora da comparação 5 do Fiado antigo encerrado e 1 retida na fila deste aparelho/);
  assert.match(html, /Comparáveis: 2 no aparelho e 2 na nuvem\. Iguais\./);
  assert.match(html, /R\$\s*30,00 dessa diferença vem de saldo de cliente retido/);
  assert.doesNotMatch(html, /Clientes/, 'equal clients are not listed');
});

test('Sync details render the overview first and keep compare, diagnostic and recovery out of the footer', () => {
  const {harness} = require('./helpers/sync-status-v223.cjs'), h = harness(), d = h.dom();
  try {
    d.details();
    const doc = d.w.document, body = doc.querySelector('#modal .modal-body');
    assert.equal(body.firstElementChild.classList.contains('sync-overview'), true);
    assert.ok(body.querySelector('details.sync-technical-summary .firebase-sync-grid'));
    for (const selector of ['[data-compare-cloud]', '[data-export-diagnostic]', '[data-recovery-export-slot]'])
      assert.ok(body.querySelector(selector), selector), assert.equal(doc.querySelector('.modal-foot ' + selector), null, selector);
    assert.equal(doc.querySelector('.modal-foot [data-export-recovery]'), null);
    assert.ok(doc.querySelector('[data-retry-all]'));
    assert.doesNotMatch(doc.querySelector('#modal').textContent, /Tudo confirmado/);
  } finally { d.close(); }
});

function recoverySetup({eligible = true} = {}) {
  const f = require('./helpers/customer-recovery-v205.cjs'), client = require('../js/sale-recovery-client');
  const dom = new JSDOM('<main><div id="app"></div></main><div id="modal"></div>', {url: 'https://qa.invalid/#/clientes', runScripts: 'outside-only'}), w = dom.window;
  const samples = [0, 1].map(n => f.sample(n)), sources = [{packets: eligible ? samples.flatMap(s => [s.original.packet, s.packet]) : [], local: {vendas: [], movimentacoesEstoque: []}}];
  const ctx = {uid: f.seller, role: 'seller', businessId: f.bid, business: {active: true, workspaceGeneration: 0}, member: {status: 'active', spaceAccess: 'selected', allowedSpaceIds: [f.spaceId]}, userProfile: {uid: f.seller, active: false}};
  Object.assign(w, {MutationObserver: class { observe() {} }, BusinessContext: {get: () => ctx}, FirebaseSession: {user: {uid: f.seller}}, SpaceContext: {homeId: () => f.spaceId},
    DB: {businessCache: {recoverySources: async () => sources}}, TextEncoder, TextDecoder, SyncFirebase: {downloadJsonFile() {}}, FirebaseCallable: () => { throw Error('Network forbidden'); }});
  Object.defineProperty(w, 'crypto', {value: crypto.webcrypto});
  w.eval(fs.readFileSync('js/sale-recovery-client.js', 'utf8'));
  w.eval(fs.readFileSync('js/sale-recovery-ui.js', 'utf8') + '\nwindow.QA={openRecoveryExport};refresh=async()=>{};');
  ctx.userProfile.active = true;
  void client;
  return {w, close: () => w.close()};
}
test('recovery export: no eligible original keeps Preparar arquivo disabled and says what the file is for', async () => {
  const h = recoverySetup({eligible: false});
  try {
    assert.equal(await h.w.SaleRecoveryExport.candidateCount(), 0);
    await h.w.QA.openRecoveryExport();
    const doc = h.w.document, list = doc.querySelector('[data-export-list]').textContent;
    assert.match(list, /Nenhuma venda original retida/); assert.match(list, /só para vendas originais que a nuvem recusou por falta de permissão/);
    assert.match(list, /não é uma cópia geral dos dados/); assert.match(list, /Consultar operações bloqueadas/);
    const consent = doc.querySelector('[data-export-consent]'); consent.checked = true; consent.onchange();
    assert.equal(doc.querySelector('[data-export-prepare]').disabled, true, 'consent alone never enables an empty export');
  } finally { h.close(); }
});
test('recovery export count matches the selectable originals of this session', async () => {
  const h = recoverySetup({eligible: true});
  try {
    assert.equal(await h.w.SaleRecoveryExport.candidateCount(), 2);
    await h.w.QA.openRecoveryExport();
    assert.equal(h.w.document.querySelectorAll('[data-export-operation]').length, 2);
  } finally { h.close(); }
});

test('diagnostic export carries comparable counts, retained balances without names and financial flags', async () => {
  const h = syncHarness();
  h.run(section(source, 'const AUDIT_NAMES = [', 'const repositories =') + section(source, 'const recordTimestamp =', 'const financialKey =') +
    section(source, 'async function exportLocalDiagnostic(', 'function downloadJsonFile('));
  Object.assign(h.s, {validateUser: async () => {}, PROJECT_ID: 'qa-project', deviceId: () => 'qa-device', indexedDbInventory: async () => [], checksumValue: () => 'qa-checksum',
    queueSubtype: () => 'sale', containsInvalidFirestoreValue: () => false, queueOperationDiagnostic: () => ({lastErrorMessage: ''}),
    saleIntegrityDiagnostics: () => ({count: 0}), paymentIntegrityDiagnostics: () => ({count: 0})});
  h.s.state = {...h.s.state, syncFailureHistory: [], sessionTrace: [], syncTrace: [], integrityStatus: 'not_checked', integrityDeferredReason: 'operations_waiting_to_send', userProfile: {role: 'owner'}};
  h.s.state.comparison = await h.run('compareLocalAndCloud()');
  const report = await h.run('exportLocalDiagnostic()');
  assert.equal(report.integrityDeferredReason, 'operations_waiting_to_send');
  assert.equal(report.countComparison.basis.sales.comparable, 2); assert.equal(report.countComparison.local.sales, 8);
  assert.equal(report.retainedClientBalances[0].clientId, 'qa-client-held'); assert.equal('clientName' in report.retainedClientBalances[0], false);
  assert.equal(JSON.stringify(report).includes('Cliente fictício'), false, 'no client names in the export');
  const sale = report.entities.sales.find(row => row.documentId === 'qa-legacy-sale-0'), held = report.entities.sales.find(row => row.documentId === 'qa-held-sale');
  assert.equal(sale.archivedLegacyFiado, true); assert.equal(sale.heldByQueue, false); assert.equal(held.heldByQueue, true); assert.equal(held.clientId, 'qa-client-held');
  assert.equal(report.entities.clients[0].archivedLegacyFiado, undefined, 'non-financial records keep the previous shape');
});

test('regularization confirmed on the server but held on this device warns against a second adjustment', async () => {
  const {harness} = require('./helpers/owner-receipt-v219.cjs'), h = harness(), w = h.w;
  try {
    w.Utils.escapar = String; w.Utils.dinheiro = n => 'R$ ' + n.toFixed(2); w.AdiFestaBuild = {release: 242};
    Object.defineProperty(w.crypto, 'randomUUID', {value: crypto.randomUUID});
    w.SpaceContext.activeId = () => 'qa-space'; w.SpaceContext.homeSpaces = () => [{id: 'qa-space', name: 'Espaço fictício'}];
    w.Clientes = {obter: () => ({id: 'qa-client', nome: 'Pessoa fictícia'}), prepareList() {}};
    w.SyncFirebase.assertFiadoReceiptQueueClear = () => true;
    w.SyncFirebase.readCanonicalClient = async () => { throw Object.assign(Error('O cliente possui uma alteração local aguardando sincronização.'), {code: 'pending-client-write'}); };
    w.InstallmentCredit.refresh = async () => { throw Error('must not refresh a held client'); };
    let writes = 0;
    w.FirebaseCallable = async name => name === 'commitOperationalSync'
      ? (writes++, {data: {status: 'confirmed', clientId: 'qa-client', spaceId: 'qa-space', newDebtCents: 15000}})
      : {data: {currentDebtCents: 12000, financialVersion: 3, quoteHash: 'a'.repeat(64)}};
    w.eval(fs.readFileSync('js/fiado-space-regularization.js', 'utf8'));
    await w.FiadoSpaceRegularization.open('qa-client');
    const form = w.document.querySelector('[data-reg-form]');
    form.elements.total.value = '150'; form.elements.reason.value = 'Dívida anterior fictícia conferida'; form.elements.confirmed.checked = true;
    await form.onsubmit(new w.Event('submit', {cancelable: true}));
    const status = w.document.querySelector('[data-reg-status]').textContent;
    assert.equal(writes, 1);
    assert.match(status, /Saldo confirmado: R\$ 150\.00/); assert.match(status, /pendente ou bloqueada na fila/); assert.match(status, /não registre outro ajuste para compensar/);
  } finally { h.close(); }
});

test('mobile label only says "Sincronizado" after a clean comparison in this session', () => {
  const nav = fs.readFileSync('js/mobile-navigation.js', 'utf8');
  assert.match(nav, /state\.status === "success" \? \(state\.integrityStatus === "completed" && state\.dataAudit && !state\.dataAudit\.integrity\?\.actionable \? "Sincronizado" : "Envio confirmado"\)/);
  assert.doesNotMatch(source, /"Todos os dados estão sincronizados\."\s*:\s*describeSyncResult\(\{\s*sent: push\.sent/);
});
