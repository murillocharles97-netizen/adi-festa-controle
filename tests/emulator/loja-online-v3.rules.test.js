'use strict';
// Loja Online V3 contra o backend REAL (onlineStoreService) e as Firestore Rules no emulador.
// Usa exatamente os payloads que o painel V3 envia (StoreKit.savePayload + OnlineStoreModel.settings).
// Dados 100% fictícios. Opcional: LOJA_V3_EXPORT=<arquivo> grava o documento público para a QA do navegador.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
if (!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Only local emulator allowed');
const { initializeTestEnvironment, assertFails, assertSucceeds } = require('@firebase/rules-unit-testing'), sdk = require('firebase/firestore');
const req = require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const { initializeApp, deleteApp } = req('firebase-admin/app'), { getFirestore } = req('firebase-admin/firestore');
const { onlineStoreService, storeId } = require('../../functions/src/services/online-store-service');
const Model = require('../../functions/src/shared/online-store'), K = require('../../js/loja/store-kit');
const suffix = Date.now().toString(36), projectId = 'adi-festa-variations-test';
const bid = `loja-v3-${suffix}`, other = `loja-v3-outra-${suffix}`, owner = `owner-${suffix}`, manager = `manager-${suffix}`, foreignOwner = `foreign-${suffix}`;
const a = `space-a-${suffix}`, b = `space-b-${suffix}`, f = `space-f-${suffix}`, slug = `doceria-v3-${suffix}`;
let env, app, db, service;
const request = (data = {}, who = owner, businessId = bid) => ({ auth: { uid: who }, data: { businessId, spaceId: a, workspaceGeneration: 0, ...data } });
// Mesmo caminho do painel: rascunho local -> savePayload -> settings saneadas.
function uiPayload(store, ops, extra = {}) {
  const d = K.applyOps(K.draftFromStore(store, 'Espaço A'), ops), p = K.savePayload(d);
  return { ...p, settings: Model.settings({ ...d.settings, checkoutEnabled: store?.checkoutEnabled === true }), revision: store?.revision || 0, ...extra };
}
const ids = n => Array.from({ length: n }, (_, i) => `qa-${suffix}-${i}`);

test.before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync('firestore.rules', 'utf8') } });
  app = initializeApp({ projectId }, `loja-v3-${suffix}`); db = getFirestore(app); service = onlineStoreService(db);
  for (const [business, who] of [[bid, owner], [other, foreignOwner]]) await db.doc(`businesses/${business}`).set({ ownerId: who, active: true, workspaceGeneration: 0, subscription: { planId: 'internal', status: 'active' }, legacyAccessDisabled: true });
  for (const [id, role, business, access] of [[owner, 'owner', bid, 'all'], [manager, 'manager', bid, 'selected'], [foreignOwner, 'owner', other, 'all']]) {
    await db.doc(`users/${id}`).set({ active: true, businessId: business, role });
    await db.doc(`businesses/${business}/members/${id}`).set({ status: 'active', role, spaceAccess: access, allowedSpaceIds: [a], permissions: { 'products.edit': true, 'products.view': true, 'sales.viewAll': true } });
  }
  for (const [id, business] of [[a, bid], [b, bid], [f, other]]) await db.doc(`financialSpaces/${id}`).set({ businessId: business, linkedBusinessId: business, active: true, capabilities: { products: true, sales: true } });
  const names = ['Brigadeiro gourmet', 'Bolo de pote', 'Torta de limão', 'Cookie com gotas', 'Café gelado'];
  for (const [i, id] of ids(5).entries()) await db.doc(`businesses/${bid}/products/${id}`).set({ businessId: bid, nome: names[i], preco: 5 + i, custo: 2, categoria: i < 2 ? 'Doces' : 'Outros', estoqueAtual: 4, spaceAccessMode: 'all_spaces', ativo: true, imageUrl: `https://qa-images.veconi.test/Doces/${i}.svg`, fornecedor: 'Fornecedor interno QA', margemLucro: 60 });
  await db.doc(`businesses/${bid}/products/${ids(5)[1]}`).update({ productType: 'variable' });
  for (const [i, [label, price, stock]] of [['Chocolate', 14, 6], ['Ninho', 16, 3]].entries()) await db.doc(`businesses/${bid}/productVariants/var-${suffix}-${i}`).set({ businessId: bid, parentProductId: ids(5)[1], displayName: label, attributeValues: { Sabor: label }, price, cost: 5, stock, active: true, catalogVisible: true });
  await db.doc(`businesses/${bid}/products/only-b-${suffix}`).set({ businessId: bid, nome: 'Exclusivo do espaço B', preco: 9, spaceAccessMode: 'single_space', allowedSpaceIds: [b], ativo: true });
  await db.doc(`businesses/${other}/products/foreign-${suffix}`).set({ businessId: other, nome: 'Produto de outra empresa', preco: 1, spaceAccessMode: 'all_spaces', ativo: true });
});
test.after(async () => { await env?.cleanup(); if (app) await deleteApp(app); });

test('criar loja, salvar rascunho e publicar com os payloads do painel V3', async () => {
  const empty = await service.load(request());
  assert.equal(empty.store, null);
  assert.ok(!empty.products.some(p => p.productId === `only-b-${suffix}`), 'produto exclusivo do espaço B não aparece no espaço A');
  const created = await service.save(request({ action: 'save', ...uiPayload(null, [{ t: 'slug', value: slug }, { t: 'settings', values: { publicName: 'Doceria V3 QA', contactPhone: K.formatPhone('11912345678'), pickupEnabled: true, deliveryEnabled: true, pickupAddress: 'Rua Fictícia, 1', primaryColor: '#c23b6a', secondaryColor: '#fbe7ee' } }]) }));
  assert.equal(created.store.published, false); assert.equal(created.store.slug, slug);
  const selected = await service.save(request({ action: 'save', ...uiPayload(created.store, [{ t: 'selectMany', ids: ids(4), on: true }, { t: 'feature', id: ids(5)[0], on: true }, { t: 'categoryOrder', names: ['Outros', 'Doces'] }, { t: 'categoryName', name: 'Doces', value: 'Docinhos' }]) }));
  assert.deepEqual(selected.store.selectedProductIds, ids(4));
  assert.equal((await db.doc(`publicCatalogs/${selected.store.publicToken}`).get()).exists, false, 'rascunho não cria a loja pública');
  const published = await service.save(request({ action: 'publish', confirmed: true, published: true, ...uiPayload(selected.store, []) }));
  assert.equal(published.store.published, true);
  const live = (await db.doc(`publicCatalogs/${published.store.publicToken}`).get()).data();
  assert.equal(live.active, true); assert.equal(live.acceptingOrders, false, 'publicar não liga pedidos registrados');
  assert.equal(live.publicName, 'Doceria V3 QA'); assert.equal(K.validPhone(live.contactPhone), true);
  assert.deepEqual(live.items.map(i => i.productId).sort(), ids(4).sort());
  assert.equal(live.items.find(i => i.productId === ids(5)[0]).featured, true);
  assert.deepEqual(live.categories.find(c => c.internalName === 'Doces'), { internalName: 'Doces', publicName: 'Docinhos', active: true, order: 1, imageUrl: '', imageThumbUrl: '' });
  const variable = live.items.find(i => i.productId === ids(5)[1]);
  assert.deepEqual(variable.variants.map(v => v.displayName), ['Chocolate', 'Ninho']);
  const text = JSON.stringify(live);
  for (const secret of ['custo', '"cost"', 'fornecedor', 'margemLucro', 'Fornecedor interno', owner, manager, 'customerPhone']) assert.ok(!text.includes(secret), `documento público sem ${secret}`);
  if (process.env.LOJA_V3_EXPORT) fs.writeFileSync(process.env.LOJA_V3_EXPORT, JSON.stringify({ slug, doc: live }, null, 1));
});

test('rascunho salvo depois de publicar não muda a loja pública até publicar de novo', async () => {
  const store = (await service.load(request())).store, before = (await db.doc(`publicCatalogs/${store.publicToken}`).get()).data();
  const saved = await service.save(request({ action: 'save', ...uiPayload(store, [{ t: 'select', id: ids(5)[4], on: true }, { t: 'setting', key: 'publicName', value: 'Nome ainda não publicado' }]) }));
  const after = (await db.doc(`publicCatalogs/${store.publicToken}`).get()).data();
  assert.deepEqual(after, before);
  assert.ok(K.publishedDiff(K.draftFromStore(saved.store), after).includes('nome'));
});

test('conflito de revisão, limite de 400 e produtos de outro espaço ou empresa são recusados', async () => {
  const store = (await service.load(request())).store;
  await assert.rejects(service.save(request({ action: 'save', ...uiPayload(store, []), revision: store.revision - 1 })), { code: 'aborted' });
  await assert.rejects(service.save(request({ action: 'save', ...uiPayload(store, [{ t: 'selectMany', ids: Array.from({ length: 401 }, (_, i) => `x-${i}`), on: true }]) })), { code: 'invalid-argument' });
  await assert.rejects(service.save(request({ action: 'save', ...uiPayload(store, [{ t: 'select', id: `only-b-${suffix}`, on: true }]) })), { code: 'failed-precondition' });
  await assert.rejects(service.save(request({ action: 'save', ...uiPayload(store, [{ t: 'select', id: `foreign-${suffix}`, on: true }]) })), { code: 'failed-precondition' });
});

test('isolamento: gerente não altera, outra empresa não usa o link nem a loja, espaço B é outra loja', async () => {
  const store = (await service.load(request())).store;
  await assert.rejects(service.save(request({ action: 'save', ...uiPayload(store, []) }, manager)), { code: 'permission-denied' });
  await assert.rejects(service.load(request({}, foreignOwner)), { code: 'permission-denied' });
  await assert.rejects(service.save(request({ spaceId: f, action: 'save', ...uiPayload(null, [{ t: 'slug', value: slug }, { t: 'settings', values: { publicName: 'Outra empresa' } }]) }, foreignOwner, other)), { code: 'already-exists' });
  await assert.rejects(service.load(request({ spaceId: f }, owner)), { code: 'permission-denied' });
  const spaceB = await service.load(request({ spaceId: b }));
  assert.equal(spaceB.store, null); assert.ok(spaceB.products.some(p => p.productId === `only-b-${suffix}`));
  assert.notEqual(storeId(a), storeId(b));
});

test('Rules: visitante lê só o documento público; rascunho e escrita direta são bloqueados', async () => {
  const store = (await service.load(request())).store, guest = env.unauthenticatedContext().firestore(), rival = env.authenticatedContext(foreignOwner).firestore(), mgr = env.authenticatedContext(manager).firestore();
  await assertSucceeds(sdk.getDoc(sdk.doc(guest, 'publicCatalogs', store.publicToken)));
  await assertSucceeds(sdk.getDoc(sdk.doc(guest, 'publicCatalogSlugs', slug)));
  await assertFails(sdk.getDocs(sdk.collection(guest, 'publicCatalogs')));
  await assertFails(sdk.getDoc(sdk.doc(guest, 'businesses', bid, 'onlineStores', storeId(a))));
  await assertFails(sdk.getDoc(sdk.doc(rival, 'businesses', bid, 'onlineStores', storeId(a))));
  for (const ctx of [guest, rival, mgr]) {
    await assertFails(sdk.setDoc(sdk.doc(ctx, 'publicCatalogs', store.publicToken), { active: true, items: [] }, { merge: true }));
    await assertFails(sdk.setDoc(sdk.doc(ctx, 'publicCatalogSlugs', `sequestro-${suffix}`), { catalogToken: store.publicToken }));
    await assertFails(sdk.setDoc(sdk.doc(ctx, 'businesses', bid, 'onlineStores', storeId(a)), { published: true }, { merge: true }));
  }
});

test('pausar mantém o link mas desliga a loja pública', async () => {
  const store = (await service.load(request())).store;
  const paused = await service.save(request({ action: 'publish', confirmed: true, published: false, ...uiPayload(store, []) }));
  assert.equal(paused.store.published, false); assert.equal(K.status(paused.store), 'paused');
  const live = (await db.doc(`publicCatalogs/${store.publicToken}`).get()).data();
  assert.equal(live.active, false); assert.equal(live.catalogVisible, false); assert.equal(live.acceptingOrders, false);
  assert.equal((await db.doc(`publicCatalogSlugs/${slug}`).get()).data().catalogToken, store.publicToken);
  await service.save(request({ action: 'publish', confirmed: true, published: true, ...uiPayload(paused.store, []) }));
});
