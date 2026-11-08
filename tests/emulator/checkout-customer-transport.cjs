'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { readFileSync } = require('node:fs');
const vm = require('node:vm');
const { initializeApp, deleteApp } = require('firebase/app');
const { getAuth, connectAuthEmulator, signInAnonymously } = require('firebase/auth');
const full = require('firebase/firestore');
const lite = require('firebase/firestore/lite');
const admin = require('node:module').createRequire(require('node:path').resolve('functions/package.json'));

const projectId = 'demo-veconi-owner-v219';
assert.equal(process.env.GCLOUD_PROJECT, projectId);
for (const key of ['FIREBASE_AUTH_EMULATOR_HOST', 'FIRESTORE_EMULATOR_HOST'])
  assert.match(process.env[key] || '', /^127\.0\.0\.1:\d+$/);

const source = readFileSync('js/firebase/sync.js', 'utf8');
const cut = (from, to) => source.slice(source.indexOf(from), source.indexOf(to));
const checkout = cut('function paymentQueueRequiresReview(', 'function saleQueueRequiresReview(')
  + cut('// Presence evidence', 'function rememberCanonicalClients(');

test('authenticated checkout confirms through Lite when full Firestore is offline, with Rules and debt guards intact', async t => {
  const name = randomUUID();
  const app = initializeApp({ projectId, apiKey: 'demo-only' }, name);
  const adminApp = admin('firebase-admin/app').initializeApp({ projectId }, name);
  try {
    const auth = getAuth(app);
    connectAuthEmulator(auth, 'http://' + process.env.FIREBASE_AUTH_EMULATOR_HOST, { disableWarnings: true });
    const { user } = await signInAnonymously(auth);
    const [host, port] = process.env.FIRESTORE_EMULATOR_HOST.split(':');
    const db = full.getFirestore(app);
    const direct = lite.getFirestore(app);
    full.connectFirestoreEmulator(db, host, Number(port));
    lite.connectFirestoreEmulator(direct, host, Number(port));

    const businessId = 'qa-biz-' + name, id = 'qa-customer';
    const firestore = admin('firebase-admin/firestore').getFirestore(adminApp);
    const root = firestore.collection('businesses').doc(businessId);
    const client = { id, businessId, ativo: true, saldo: 0, financialVersion: 0, workspaceGeneration: 0 };
    await firestore.doc('users/' + user.uid).set({ uid: user.uid, businessId, active: true, role: 'owner' });
    await root.set({ id: businessId, ownerId: user.uid, active: true, workspaceGeneration: 0,
      subscription: { planId: 'internal', status: 'active' } });
    await root.collection('members').doc(user.uid).set({ uid: user.uid, role: 'owner', status: 'active',
      permissionsVersion: 2, permissions: {}, spaceAccess: 'all' });
    await root.collection('clients').doc(id).set(client);
    const queue = [{ businessId, userId: user.uid, operationId: 'original-qa', status: 'error',
      lastErrorCode: 'permission-denied', payload: { writes: [
        { entityType: 'payments', operation: 'create', entityId: 'original-qa', data: { clienteId: id } },
      ] } }];
    const before = JSON.stringify(queue), store = new Map(), diagnostics = [];
    let directAttempts = 0, sdkAttempts = 0, failDirect = false, scope = 'session';
    const sandbox = {
      console: { warn: (...args) => diagnostics.push(args) }, setTimeout, clearTimeout, db, doc: full.doc,
      auth, currentUser: user, navigator: { onLine: true }, SpaceContext: { salesId: () => 'qa-space' },
      canPullSource: () => true, activeBusinessId: () => businessId,
      DB: { carregar: () => ({ clientes: [client] }), getWorkspaceGeneration: () => 0 },
      captureCloudReadScope: () => scope, assertCloudReadScope: value => assert.equal(value, scope),
      readQueue: () => queue, readRecoveryResolution: () => null, readPaymentRecoveryReceipt: () => null,
      saleQueueRequiresReview: () => false, now: () => new Date().toISOString(),
      localStorage: { getItem: key => store.get(key), setItem: (key, value) => store.set(key, value) },
      getDocFromServer: reference => { sdkAttempts++; return full.getDocFromServer(reference); },
      readCheckoutCustomerDirect: (reference, checkScope) => {
        checkScope();
        directAttempts++;
        assert.equal(reference.firestore.app, app);
        assert.equal(reference.path, root.path + '/clients/' + id);
        if (failDirect) throw Object.assign(Error('Rede de teste indisponível'), { code: 'unavailable' });
        return lite.getDoc(lite.doc(direct, reference.path));
      },
    };
    sandbox.window = sandbox;
    vm.createContext(sandbox);
    vm.runInContext(checkout, sandbox);
    const prepare = (paymentMethod, affectsDebt = false) => sandbox.prepareSaleCustomer(id, { paymentMethod, affectsDebt });
    const reference = full.doc(db, root.path, 'clients', id);
    await full.disableNetwork(db);
    await assert.rejects(full.getDocFromServer(reference), {
      code: 'unavailable', message: 'Failed to get document because the client is offline.',
    });
    await full.enableNetwork(db);
    assert.equal((await full.getDocFromServer(reference)).data().saldo, 0);
    await full.disableNetwork(db);
    // A warm SDK cache still cannot satisfy a server-only read.
    await assert.rejects(full.getDocFromServer(reference), { code: 'unavailable' });
    for (const method of ['pix', 'dinheiro', 'cartao']) assert.equal((await prepare(method)).source, 'server');
    assert.equal(directAttempts, 3);
    for (const method of ['fiado', 'crediario']) await assert.rejects(prepare(method, true), { code: 'payment-review-required' });
    assert.equal(sdkAttempts, 3);

    const readFromServer = sandbox.getDocFromServer;
    const beforeFailures = directAttempts;
    for (const code of ['deadline-exceeded', 'network-request-failed', 'operational-read-offline']) {
      await t.test(code + ' leaves checkout pending without a Lite read', async () => {
        sandbox.getDocFromServer = async () => { throw Object.assign(Error('Falha de teste'), { code }); };
        await assert.rejects(prepare('pix'), {
          code: 'checkout-customer-unavailable',
          message: /Tentar novamente.*carrinho foi preservado/,
        });
        assert.equal(directAttempts, beforeFailures);
        assert.equal(JSON.stringify(queue), before);
      });
    }
    await t.test('the five-second timeout and a late unavailable do not start Lite', async () => {
      let rejectLate;
      sandbox.getDocFromServer = () => new Promise((_, reject) => { rejectLate = reject; });
      await assert.rejects(prepare('cartao'), { code: 'checkout-customer-unavailable' });
      rejectLate(Object.assign(Error('Falha tardia'), { code: 'unavailable' }));
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(directAttempts, beforeFailures);
      assert.equal(JSON.stringify(queue), before);
    });
    sandbox.getDocFromServer = readFromServer;

    // Even with a previous presence marker, both channels unavailable must block.
    failDirect = true;
    await assert.rejects(prepare('pix'), { code: 'checkout-customer-unavailable' });
    assert.equal(directAttempts, beforeFailures + 1);
    assert.equal(diagnostics.at(-1)[1].path, 'businesses/{empresa}/clients/{cliente}');
    assert.equal(JSON.stringify(queue), before);
    assert.equal((await root.collection('sales').get()).size, 0);
    assert.equal((await root.collection('stockMovements').get()).size, 0);
    assert.equal((await root.collection('payments').get()).size, 0);

    failDirect = false;
    await root.collection('clients').doc(id).update({ ativo: false });
    await assert.rejects(prepare('pix'), { code: 'customer-unconfirmed' });
    await root.collection('clients').doc(id).update({ ativo: true });
    await root.update({ ownerId: 'another-owner' });
    await root.collection('members').doc(user.uid).update({ role: 'seller', status: 'inactive' });
    await firestore.doc('users/' + user.uid).update({ active: false, role: 'seller' });
    await assert.rejects(prepare('pix'), { code: 'permission-denied' });
    await firestore.doc('users/' + user.uid).update({ active: true, role: 'owner' });
    await root.collection('members').doc(user.uid).update({ role: 'owner', status: 'active' });
    await root.update({ ownerId: user.uid });

    const beforeReconnect = directAttempts;
    await full.enableNetwork(db);
    assert.equal((await prepare('pix')).source, 'server');
    assert.equal(directAttempts, beforeReconnect);
    assert.equal(JSON.stringify(queue), before);
  } finally {
    await Promise.all([deleteApp(app), admin('firebase-admin/app').deleteApp(adminApp)]);
  }
});
