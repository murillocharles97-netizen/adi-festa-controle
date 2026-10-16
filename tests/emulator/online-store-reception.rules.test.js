'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
if(!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Local Emulator required');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json')),
  {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore');
const {onlineStoreService}=require('../../functions/src/services/online-store-service'),
  {onlineOrderService}=require('../../functions/src/services/online-order-service');
const stamp=Date.now().toString(36),bid='reception-'+stamp,owner='owner-'+stamp,manager='manager-'+stamp,
  a='qa-a-'+stamp,b='qa-b-'+stamp,other='other-'+stamp;
let env,app,db,stores,orders,sequence=0;
const root=()=>db.doc('businesses/'+bid),request=(data={},uid=owner)=>({auth:{uid},data:{businessId:bid,spaceId:a,workspaceGeneration:0,...data}});
async function fixture(){
  const space='test-'+stamp+'-'+(++sequence),id='product-'+space,variant='variant-'+space;
  await db.doc('financialSpaces/'+space).set({businessId:bid,active:true,capabilities:{products:true,sales:true}});
  await root().collection('products').doc(id).set({id,businessId:bid,nome:'QA Recebimento',preco:25,estoqueAtual:2,ativo:true,spaceAccessMode:'single_space',allowedSpaceIds:[space]});
  await root().collection('productVariants').doc(variant).set({id:variant,parentProductId:id,stock:2,price:25,active:true,catalogVisible:true});
  const draft=await stores.save(request({spaceId:space,slug:space,settings:{publicName:'QA '+space,pickupEnabled:true,paymentMethods:['dinheiro']},productIds:[id]}));
  const published=await stores.save(request({spaceId:space,action:'publish',confirmed:true,revision:draft.store.revision,published:true}));
  return {space,id,variant,store:published.store,catalogRef:db.doc('publicCatalogs/'+published.store.publicToken),storeRef:root().collection('onlineStores').doc(published.store.id)};
}
const toggle=(f,enabled,extra={},uid=owner)=>stores.save(request({spaceId:f.space,action:'set_order_reception',enabled,confirmed:true,revision:f.store.revision,...extra},uid));
function payload(f,id=crypto.randomUUID()){return {id,catalogToken:f.store.publicToken,orderAccessToken:crypto.randomBytes(24).toString('hex'),workspaceGeneration:0,customerName:'QA Recebimento',customerPhone:'11999999999',serviceModeId:'pickup',paymentPreference:'dinheiro',expectedTotal:25,items:[{catalogItemId:'catalog-'+f.id,quantity:1}]};}
test.before(async()=>{
  env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
  app=initializeApp({projectId:'adi-festa-variations-test'},bid);db=getFirestore(app);stores=onlineStoreService(db);orders=onlineOrderService(db);
  await root().set({ownerId:owner,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
  for(const [uid,role] of [[owner,'owner'],[manager,'manager']]){
    await db.doc('users/'+uid).set({businessId:bid,active:true,role});
    await root().collection('members').doc(uid).set({status:'active',role,spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[a],permissions:{'products.edit':true,'sales.viewAll':true}});
  }
  for(const space of [a,b])await db.doc('financialSpaces/'+space).set({businessId:bid,active:true,capabilities:{products:true,sales:true}});
  await db.doc('financialSpaces/'+other).set({businessId:'another-business',active:true,capabilities:{products:true,sales:true}});
});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
test('publication is separate from reception and paused checkout is rejected without stock changes',async()=>{
  const f=await fixture(),loaded=await stores.load(request({spaceId:f.space}));
  assert.equal(loaded.store.published,true);assert.equal(loaded.orderReception.enabled,false);assert.equal(loaded.orderReception.canEnable,true);
  await assert.rejects(orders.submit({data:payload(f)}),{code:'failed-precondition'});
  assert.equal((await root().collection('products').doc(f.id).get()).data().estoqueAtual,2);
  assert.equal((await root().collection('products').doc(f.id).get()).data().onlineReservedStock,undefined);
});
test('activation updates only reception flags atomically; live draft, stock and other space are preserved',async()=>{
  const f=await fixture(),second=await fixture(),publicBefore=(await f.catalogRef.get()).data(),productBefore=(await root().collection('products').doc(f.id).get()).data(),otherBefore=(await second.catalogRef.get()).data();
  const draft=await stores.save(request({spaceId:f.space,revision:f.store.revision,settings:{...f.store.catalogSettings,publicName:'DRAFT NOT PUBLISHED'},productIds:[f.id]}));f.store=draft.store;
  const changed=await toggle(f,true),live=(await f.catalogRef.get()).data();
  assert.equal(changed.orderReception.enabled,true);assert.equal(live.acceptingOrders,true);assert.equal(live.publicSettings.checkoutEnabled,true);
  assert.equal(live.publicName,publicBefore.publicName);assert.deepEqual(live.items,publicBefore.items);
  assert.deepEqual((await root().collection('products').doc(f.id).get()).data(),productBefore);
  assert.deepEqual((await second.catalogRef.get()).data(),otherBefore);
  assert.equal(changed.store.checkoutUpdatedByUid,owner);
});
test('owner, explicit confirmation, boolean value, business and space are mandatory',async()=>{
  const f=await fixture();
  await assert.rejects(toggle(f,true,{},manager),{code:'permission-denied'});
  await assert.rejects(toggle(f,true,{},'outsider'),{code:'permission-denied'});
  await assert.rejects(toggle(f,true,{confirmed:false}),{code:'failed-precondition'});
  await assert.rejects(toggle(f,'true'),{code:'failed-precondition'});
  await assert.rejects(toggle(f,true,{spaceId:other}),{code:'permission-denied'});
  await assert.rejects(toggle(f,true,{businessId:'another-business'}),{code:'permission-denied'});
  assert.equal((await f.catalogRef.get()).data().acceptingOrders,false);
});
test('duplicate activation and lost-response retry do not duplicate writes; stale activation cannot undo later pause',async()=>{
  const f=await fixture(),results=await Promise.all([toggle(f,true),toggle(f,true)]);
  assert.equal(results.filter(x=>!x.replayed).length,1);assert.equal((await f.storeRef.get()).data().revision,f.store.revision+1);
  assert.equal((await toggle(f,true)).replayed,true);
  const enabled=results.find(x=>!x.replayed);await toggle({...f,store:enabled.store},false);
  await assert.rejects(toggle(f,true),{code:'aborted'});
  assert.equal((await f.catalogRef.get()).data().acceptingOrders,false);
});
test('pause preserves pending order/reservation, rejects new orders, but permits exact retry of accepted order',async()=>{
  const f=await fixture(),enabled=await toggle(f,true),p=payload(f),accepted=await orders.submit({data:p});
  assert.equal(accepted.order.spaceId,f.space);
  const before=(await root().collection('catalogOrders').doc(p.id).get()).data();
  await toggle({...f,store:enabled.store},false);
  assert.deepEqual((await root().collection('catalogOrders').doc(p.id).get()).data(),before);
  assert.equal((await root().collection('products').doc(f.id).get()).data().onlineReservedStock,1);
  assert.equal((await orders.submit({data:p})).idempotent,true);
  await assert.rejects(orders.submit({data:payload(f)}),{code:'failed-precondition'});
  const cancelled=await orders.change(request({spaceId:f.space,id:p.id,status:'cancelado',revision:before.revision}));
  assert.equal(cancelled.order.reservationStatus,'released');
  assert.equal((await root().collection('products').doc(f.id).get()).data().onlineReservedStock,0);
  assert.equal((await root().collection('products').doc(f.id).get()).data().estoqueAtual,2);
});
test('legacy save cannot leave store enabled while published catalog remains paused',async()=>{
  const f=await fixture();await assert.rejects(stores.save(request({spaceId:f.space,revision:f.store.revision,settings:{...f.store.catalogSettings,checkoutEnabled:true}})),{code:'failed-precondition'});
  assert.equal((await f.storeRef.get()).data().checkoutEnabled,false);assert.equal((await f.catalogRef.get()).data().acceptingOrders,false);
});
test('activation requires published matching V2 catalog, valid service mode and sales capability',async()=>{
  for(const fault of ['unpublished','wrong-public-space','wrong-binding','no-service','no-sales','no-payment']){
    const f=await fixture();
    if(fault==='unpublished')await f.storeRef.update({published:false});
    if(fault==='wrong-public-space')await f.catalogRef.update({spaceId:b});
    if(fault==='wrong-binding')await db.doc('catalogStoreBindings/'+f.store.publicToken).update({spaceId:b});
    if(fault==='no-service')await f.storeRef.update({'catalogSettings.pickupEnabled':false,'catalogSettings.deliveryEnabled':false});
    if(fault==='no-sales')await db.doc('financialSpaces/'+f.space).update({'capabilities.sales':false});
    if(fault==='no-payment')await f.storeRef.update({'catalogSettings.paymentMethods':[]});
    await assert.rejects(toggle(f,true),{code:'failed-precondition'});
    assert.equal((await f.catalogRef.get()).data().acceptingOrders,false);
  }
});
test('stale workspace generation cannot activate a store',async()=>{
  const f=await fixture();await assert.rejects(toggle(f,true,{workspaceGeneration:99}),{code:'failed-precondition'});
  assert.equal((await f.catalogRef.get()).data().acceptingOrders,false);
});
test('direct frontend writes remain denied, including owner; no Rules relaxation',async()=>{
  const f=await fixture();for(const uid of [owner,manager]){
    const client=env.authenticatedContext(uid).firestore();
    await assertFails(sdk.updateDoc(sdk.doc(client,'businesses',bid,'onlineStores',f.store.id),{checkoutEnabled:true}));
    await assertFails(sdk.updateDoc(sdk.doc(client,'publicCatalogs',f.store.publicToken),{acceptingOrders:true}));
  }
});
