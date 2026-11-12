'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing');
const firestore = require('firebase/firestore');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^127\.0\.0\.1:\d+$/);
const writerRoot = path.resolve(process.env.VECONI_QA_PRODUCT_WRITER || 'functions');
const { operationalCommitService } = require(path.join(writerRoot, 'src/services/operational-commit-service'));

test('legacy product becomes queryable only in the selected space after its owner saves availability', async () => {
  const projectId = 'demo-veconi-product-scope';
  const env = await initializeTestEnvironment({
    projectId, firestore: { rules: fs.readFileSync(process.env.VECONI_QA_RULES || 'firestore.rules', 'utf8') },
  });
  const app = initializeApp({ projectId }, 'legacy-product-scope');
  const admin = getFirestore(app), writer = operationalCommitService(admin);
  const bid = 'shop-' + randomUUID(), foreign = 'other-' + randomUUID(), a = bid + '-a', b = bid + '-b';
  const users = { owner: 'owner-' + bid, sellerA: 'seller-a-' + bid, sellerB: 'seller-b-' + bid, outsider: 'owner-' + foreign };
  const old = { id: 'legacy-product', businessId: bid, nome: 'Produto antigo', preco: 10, estoqueAtual: 3, active: true };
  const business = (id, ownerId) => ({ id, active: true, ownerId, workspaceGeneration: 0, sensitiveDataVersion: 1, subscription: { planId: 'internal', status: 'active' } });
  const productRef = admin.doc(`businesses/${bid}/products/${old.id}`);
  const { doc, collection, getDoc, getDocs, query, where, or, and } = firestore;
  const sdk = uid => env.authenticatedContext(uid).firestore();
  const read = (uid, name, id = old.id) => getDoc(doc(sdk(uid), 'businesses', bid, name, id));
  const scopedQuery = (uid, space) => getDocs(query(collection(sdk(uid), 'businesses', bid, 'products'),
    and(where('businessId', '==', bid), or(
      where('spaceAccessMode', '==', 'all_spaces'),
      and(where('spaceAccessMode', 'in', ['selected_spaces', 'single_space']), where('allowedSpaceIds', 'array-contains-any', [space])),
    ))));

  async function submit(uid, ids, product = old) {
    const operationId = randomUUID();
    const data = { spaceAccessMode: ids.length === 1 ? 'single_space' : 'selected_spaces', allowedSpaceIds: ids, defaultSpaceId: ids[0], spaceScopeVersion: 1 };
    const item = { operationId, businessId: bid, userId: uid, workspaceGeneration: 0, status: 'pending',
      payload: { eventKind: 'simple', writes: [{ entityType: 'products', entityId: product.id, operation: 'update', before: product, data }] } };
    return writer.commit({ auth: { uid }, data: { businessId: bid, syncProtocolVersion: 1, clientRelease: 231, item } });
  }
  try {
    const batch = admin.batch();
    batch.set(admin.doc('businesses/' + bid), business(bid, users.owner));
    batch.set(admin.doc('businesses/' + foreign), business(foreign, users.outsider));
    for (const [uid, businessId, role, allowedSpaceIds] of [
      [users.owner, bid, 'owner', []], [users.sellerA, bid, 'seller', [a]],
      [users.sellerB, bid, 'seller', [b]], [users.outsider, foreign, 'owner', []],
    ]) {
      batch.set(admin.doc('users/' + uid), { uid, businessId, role, active: true });
      batch.set(admin.doc(`businesses/${businessId}/members/${uid}`), {
        uid, role, status: 'active', spaceAccess: role === 'owner' ? 'all' : 'selected',
        allowedSpaceIds, permissions: { 'products.view': true }, permissionsVersion: 2,
      });
    }
    for (const id of [a, b, foreign + '-space']) {
      const belongs = id === foreign + '-space' ? foreign : bid;
      batch.set(admin.doc('financialSpaces/' + id), { id, type: 'business', businessId: belongs, linkedBusinessId: belongs, active: true,
        capabilities: { sales: true, products: true, inventory: true } });
    }
    batch.set(productRef, old);
    batch.set(admin.doc(`businesses/${bid}/productFinancials/${old.id}`), { productId: old.id, businessId: bid, custo: 5 });
    const variantId = 'legacy-variant';
    batch.set(admin.doc(`businesses/${bid}/productVariants/${variantId}`), { id: variantId, businessId: bid, parentProductId: old.id, displayName: 'QA', price: 10, stock: 3, active: true });
    await batch.commit();

    await assertFails(read(users.sellerA, 'products'));
    assert.equal((await assertSucceeds(scopedQuery(users.sellerA, a))).size, 0);
    await assert.rejects(submit(users.sellerA, [a]));
    await assert.rejects(submit(users.outsider, [a]));
    await assert.rejects(submit(users.owner, [foreign + '-space']));
    await submit(users.owner, [a]);
    const updated = (await assertSucceeds(read(users.sellerA, 'products'))).data();
    assert.equal(updated.estoqueAtual, old.estoqueAtual);
    assert.equal(updated.preco, old.preco);
    assert.equal(Object.hasOwn(updated, 'custo'), false);
    assert.deepEqual((await assertSucceeds(scopedQuery(users.sellerA, a))).docs.map(row => row.id), [old.id]);
    assert.equal((await assertSucceeds(scopedQuery(users.sellerB, b))).size, 0);
    await assertSucceeds(read(users.sellerA, 'productVariants', variantId));
    await assertFails(read(users.sellerB, 'products'));
    await assertFails(read(users.sellerB, 'productVariants', variantId));
    await assertFails(read(users.outsider, 'products'));
    await assertFails(read(users.sellerA, 'productFinancials'));
    assert.equal((await admin.doc(`businesses/${bid}/productFinancials/${old.id}`).get()).data().custo, 5);
    assert.equal((await admin.collection(`businesses/${bid}/stockMovements`).get()).size, 0);

    const inline = { ...old, id: 'inline-cost', custo: 7 };
    await admin.doc(`businesses/${bid}/products/${inline.id}`).set(inline);
    await assertFails(read(users.sellerA, 'products', inline.id));
    await assertFails(read(users.sellerA, 'productFinancials', inline.id));
    assert.equal((await admin.doc(`businesses/${bid}/products/${inline.id}`).get()).data().custo, 7);
  } finally {
    await env.cleanup();
    await deleteApp(app);
  }
});
