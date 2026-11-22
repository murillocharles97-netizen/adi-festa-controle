'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback only');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const sdk = require('firebase/firestore');
const projectId = 'demo-veconi-loja-audit';
const bases = process.argv.slice(2).map(x => path.resolve(x));
assert.equal(bases.length, 2);

async function scenario(base, label, env) {
  const uid = 'owner-' + randomUUID(), businessId = 'qa-' + randomUUID(), spaceId = 'space-' + randomUUID();
  const app = initializeApp({projectId}, label), db = getFirestore(app);
  const {onlineStoreService} = require(path.join(base, 'functions/src/services/online-store-service'));
  const {onlineOrderService} = require(path.join(base, 'functions/src/services/online-order-service'));
  const store = onlineStoreService(db), order = onlineOrderService(db);
  const tenant = db.doc('businesses/' + businessId), products = tenant.collection('products');
  const request = data => ({auth:{uid},data:{businessId,spaceId,workspaceGeneration:0,...data}});
  const slug = 'doceria-' + label, first = 'item-published', second = 'item-draft';
  const settings = {publicName:'Vitrine QA',contactPhone:'(11) 90000-0000',pickupEnabled:true,paymentMethods:['pix']};
  const item = (nome, visible=true) => ({nome, preco:10, custo:3, ativo:true, estoqueAtual:20,
    spaceAccessMode:'single_space', allowedSpaceIds:[visible?spaceId:'other-space']});
  try {
    await Promise.all([
      tenant.set({active:true, ownerId:uid, legacyAccessDisabled:true,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}}),
      tenant.collection('members').doc(uid).set({status:'active',role:'owner',spaceAccess:'all'}),
      db.doc('financialSpaces/' + spaceId).set({businessId,active:true,capabilities:{products:true,sales:true}}),
      products.doc(first).set(item('Produto publicado')), products.doc(second).set(item('Produto ainda inédito')),
    ]);
    let draft = (await store.save(request({slug, settings, productIds:[first]}))).store;
    draft = (await store.save(request({action:'publish',confirmed:true,published:true,revision:draft.revision,settings:{...settings,checkoutEnabled:true}}))).store;
    const token = draft.publicToken;
    const doc = sdk.doc(env.unauthenticatedContext().firestore(),'publicCatalogs',token);
    const before = (await sdk.getDoc(doc)).data();
    assert.equal(before.active,true);
    draft = (await store.save(request({action:'save',revision:draft.revision,productIds:[second],settings:{...settings,checkoutEnabled:true,publicName:'Nome ainda inédito'}}))).store;
    assert.deepEqual((await sdk.getDoc(doc)).data(), before);
    await assert.rejects(order.submit({data:{
      id:'qa-'+randomUUID(),orderAccessToken:'a'.repeat(32),catalogToken:token,
      customerName:'Comprador fictício',customerPhone:'11900000000',paymentPreference:'pix',
      serviceModeId:'pickup',items:[{catalogItemId:before.items[0].id,quantity:1}], expectedTotal:10,
    }}),{code:'permission-denied'});
    draft = (await store.save(request({action:'publish',confirmed:true,published:false,revision:draft.revision}))).store;
    const paused = (await sdk.getDoc(doc)).data();
    assert.equal(paused.active,false);
    assert.equal(paused.publicName,'Nome ainda inédito');
    assert.deepEqual(paused.items.map(x=>x.productId),[second]);
    assert.equal((await tenant.collection('catalogOrders').get()).size,0);
    assert.equal((await products.doc(first).get()).data().onlineReservedStock,undefined);
    const categories=Array.from({length:101},(_,i)=>({internalName:'Categoria '+i, publicName:'Vitrine '+i, order:i}));
    draft=(await store.save(request({action:'save',revision:draft.revision,presentation:{categories}}))).store;
    assert.equal(draft.presentation.categories.length,100);
    await assert.rejects(store.save(request({revision:draft.revision,productIds:Array.from({length:401},(_,i)=>'p-'+i)})),{code:'invalid-argument'});
    for(let from=0;from<998;from+=400){
      const batch=db.batch();
      for(let i=from;i<Math.min(from+400,998);i++)batch.set(products.doc('filler-'+i),item('Fictício '+i,false));
      await batch.commit();
    }
    assert.equal((await store.load(request({}))).products.length,2);
    await products.doc('filler-threshold').set(item('Fora do espaço',false));
    await assert.rejects(store.load(request({})),{code:'resource-exhausted'});
    const batch=db.batch();
    batch.delete(products.doc('filler-threshold'));
    for(let i=0;i<101;i++)batch.set(tenant.collection('catalogOrders').doc('qa-'+i),{spaceId,source:'online_store'});
    await batch.commit();
    await assert.rejects(store.load(request({})),{code:'resource-exhausted',message:/paginação de pedidos/i});
    console.log(JSON.stringify({label,publicOrderRejectedBeforePublish:true,draftVisibleOnPause:true,
      ordersCreated:0,stockReserved:0,categoryEntriesAccepted:100,productSelection401Rejected:true,
      origin1000Accepted:true,origin1001RejectedEvenWithTwoInSpace:true,orderCount101Rejected:true}));
  } finally { await deleteApp(app); }
}

async function main() {
  const env = await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync(path.join(bases[0],'firestore.rules'),'utf8')}});
  try {
    await scenario(bases[0],'main',env);
    await scenario(bases[1],'v3',env);
  } finally { await env.cleanup(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
