'use strict';
// Fase 1 on the local Emulator: the REAL operationalCommitService rejects real
// packets and the callable error carries a stable reason/category, while code and
// message stay exactly as before (old PWAs unchanged).
// Optional: VECONI_LIVE_FUNCTIONS_DIR=<deployed package>/functions runs the same
// packets against the deployed (older) source and proves the NEW client still
// classifies its reason-less errors through the legacy fallback.
const test = require('node:test'), assert = require('node:assert/strict'), path = require('node:path'), fs = require('node:fs');
const vm = require('node:vm');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator required, never production');
const Rejection = require('../../functions/src/shared/sync-rejection.js');

function loadServer(functionsDir, projectId) {
  const req = require('node:module').createRequire(path.resolve(functionsDir, 'package.json'));
  const { initializeApp } = req('firebase-admin/app'), { getFirestore } = req('firebase-admin/firestore');
  const app = initializeApp({ projectId }, `app-${projectId}-${Math.random()}`), db = getFirestore(app);
  const { operationalCommitService } = req(path.resolve(functionsDir, 'src/services/operational-commit-service.js'));
  return { db, service: operationalCommitService(db), app, deleteApp: req('firebase-admin/app').deleteApp };
}

// The client helpers exactly as shipped (shared module used by js/firebase/sync.js).
function clientHelpers() {
  return { rejectionFields: (input) => Rejection.queueFields(input), rejectedFor: (item, reason, legacy) => Rejection.isReason(item, reason, legacy) };
}

let seq = 0;
async function seed(db, { sellerPermissions = {} } = {}) {
  const bid = 'reasons-' + (++seq) + '-' + Date.now(), owner = 'owner-' + bid, seller = 'seller-' + bid, space = 'space-' + bid, root = db.doc('businesses/' + bid);
  await root.set({ businessId: bid, ownerId: owner, active: true, workspaceGeneration: 0, legacyAccessDisabled: true, subscription: { planId: 'internal', status: 'active' } });
  for (const uid of [owner, seller]) {
    await db.doc('users/' + uid).set({ uid, businessId: bid, active: true, role: uid === owner ? 'owner' : 'cashier' });
    await root.collection('members').doc(uid).set({ uid, status: 'active', role: uid === owner ? 'owner' : 'seller', spaceAccess: 'all', permissionsVersion: 2,
      permissions: uid === owner ? {} : { 'sales.create': true, 'products.view': true, ...sellerPermissions } });
  }
  await db.doc('financialSpaces/' + space).set({ id: space, businessId: bid, linkedBusinessId: bid, active: true, type: 'business', ownerUid: owner,
    capabilities: { sales: true, inventory: true, products: true, finance: true } });
  const product = { id: 'p1', businessId: bid, nome: 'Produto fictício', preco: 10, custo: 0, ativo: true, active: true, itemKind: 'product', productType: 'simple',
    estoqueAtual: 10, estoque: 10, semControleEstoque: false, controlaEstoque: true, spaceAccessMode: 'all_spaces', allowedSpaceIds: [], workspaceGeneration: 0 };
  await root.collection('products').doc('p1').set(product);
  return { bid, owner, seller, product };
}
const item = (s, uid, writes) => ({ operationId: require('node:crypto').randomUUID(), businessId: s.bid, userId: uid, workspaceGeneration: 0,
  payloadVersion: 4, syncProtocolVersion: 1, clientRelease: 202, status: 'pending', payload: { writes } });
const call = (server, s, uid, packet) => server.service.commit({ auth: { uid }, data: { businessId: s.bid, workspaceGeneration: 0, syncProtocolVersion: 1, clientRelease: 231, item: packet } });
async function rejection(server, s, uid, packet) {
  try { await call(server, s, uid, packet); } catch (error) { return error; }
  assert.fail('expected a rejection');
}
const scenarios = [
  { name: 'estoque alterado sem movimento', code: 'permission-denied', message: 'Estoque sem movimento autorizado.', reason: 'stock_without_movement', category: 'stock_conflict',
    run: (server, s) => rejection(server, s, s.owner, item(s, s.owner, [{ entityType: 'products', entityId: 'p1', operation: 'update', data: { ...s.product, estoqueAtual: 7, estoque: 7 }, before: s.product }])) },
  { name: 'vendedor sem products.edit', code: 'permission-denied', message: 'Sem permissão para editar produto.', reason: 'products_edit_required', category: 'permission',
    run: (server, s) => rejection(server, s, s.seller, item(s, s.seller, [{ entityType: 'products', entityId: 'p1', operation: 'update', data: { ...s.product, nome: 'Outro nome' }, before: s.product }])) },
  { name: 'envelope vazio', code: 'invalid-argument', message: 'Envelope de operação inválido.', reason: 'operation_envelope_invalid', category: 'malformed',
    run: (server, s) => rejection(server, s, s.owner, item(s, s.owner, [])) },
  { name: 'pacote em revisão', code: 'failed-precondition', message: 'Operação preservada para revisão; replay bloqueado.', reason: 'operation_review_hold', category: 'review_required',
    run: (server, s) => rejection(server, s, s.owner, { ...item(s, s.owner, [{ entityType: 'products', entityId: 'p1', operation: 'update', data: s.product }]), status: 'quarantined' }) },
];

const servers = [];
test.after(async () => { for (const s of servers) await s.deleteApp(s.app).catch(() => {}); });

for (const [label, dir] of [['repositório', 'functions'], ['candidato sobre o publicado', process.env.VECONI_CANDIDATE_FUNCTIONS_DIR]].filter(([, d]) => d))
test(`servidor (${label}): mesmo código e mesma mensagem, com motivo e categoria estáveis`, async () => {
  const server = loadServer(dir, `demo-veconi-sync-reasons-${label.length}`); servers.push(server);
  const client = clientHelpers();
  for (const scenario of scenarios) {
    const s = await seed(server.db), error = await scenario.run(server, s);
    assert.equal(error.code, scenario.code, scenario.name);
    assert.equal(error.message, scenario.message, scenario.name);
    assert.deepEqual({ reason: error.details?.reason, category: error.details?.category, rejectionSchema: error.details?.rejectionSchema },
      { reason: scenario.reason, category: scenario.category, rejectionSchema: 1 }, scenario.name);
    // What the HTTP callable protocol actually sends to the PWA.
    assert.equal(error.toJSON().details.reason, scenario.reason, scenario.name);
    // The PWA stores the typed reason.
    const fields = client.rejectionFields({ code: error.code, message: error.message, details: error.toJSON().details });
    assert.equal(fields.lastErrorReason, scenario.reason); assert.equal(fields.lastErrorCategory, scenario.category);
    assert.equal(fields.lastErrorReasonSource, 'server');
  }
  // Nothing was written by any rejection.
  const s = await seed(server.db); await scenarios[0].run(server, s);
  assert.equal((await server.db.doc(`businesses/${s.bid}/products/p1`).get()).data().estoqueAtual, 10);
});

test('Function publicada (sem motivos): o app novo cai no texto legado e decide igual', { skip: !process.env.VECONI_LIVE_FUNCTIONS_DIR && 'defina VECONI_LIVE_FUNCTIONS_DIR para comparar com o pacote publicado' }, async () => {
  const server = loadServer(process.env.VECONI_LIVE_FUNCTIONS_DIR, 'demo-veconi-sync-reasons-live'); servers.push(server);
  const client = clientHelpers();
  for (const scenario of scenarios) {
    const s = await seed(server.db), error = await scenario.run(server, s);
    assert.equal(error.code, scenario.code, scenario.name); assert.equal(error.message, scenario.message, scenario.name);
    assert.equal(error.details, undefined, 'a Function publicada ainda não envia motivos');
    const fields = client.rejectionFields({ code: error.code, message: error.message, details: error.toJSON().details });
    assert.equal(fields.lastErrorReason, scenario.reason); assert.equal(fields.lastErrorReasonSource, 'legacy_message');
    const stored = { lastErrorCode: error.code, lastErrorMessage: error.message, ...fields };
    assert.equal(client.rejectedFor(stored, 'stock_without_movement', 'Estoque sem movimento autorizado.'), scenario.reason === 'stock_without_movement');
  }
});
