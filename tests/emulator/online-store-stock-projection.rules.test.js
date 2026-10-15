'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
if(!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Only local emulator allowed');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore');
const {onlineStoreStockProjection}=require('../../functions/src/services/online-store-stock-projection');
const {onlineStoreService}=require('../../functions/src/services/online-store-service');
const {onlineOrderService}=require('../../functions/src/services/online-order-service');
const {onlineOrderExpiry}=require('../../functions/src/services/online-order-expiry');
const {randomUUID}=require('node:crypto');
const suffix=Date.now().toString(36),bid=`projection-${suffix}`,uid=`owner-${suffix}`,a=`space-a-${suffix}`,b=`space-b-${suffix}`,pid=`product-${suffix}`;
let app,db,projection,stores,orders,storeA,storeB;
const root=()=>db.doc(`businesses/${bid}`),publicRef=s=>db.doc(`publicCatalogs/${s.publicToken}`);
const request=data=>({auth:{uid},data:{businessId:bid,workspaceGeneration:0,...data}});
const project=(id=pid,source={workspaceGeneration:0})=>projection.project({businessId:bid,productId:id,source});
const quantity=async s=>(await publicRef(s).get()).data().items.find(i=>i.productId===pid).availableQuantity;
async function publish(space,ids){const draft=(await stores.save(request({spaceId:space,slug:`qa-${space}`,settings:{publicName:'QA stock',checkoutEnabled:true},productIds:ids}))).store;return (await stores.save(request({spaceId:space,action:'publish',confirmed:true,revision:draft.revision,productIds:ids}))).store;}
const payload=(s,id=pid)=>({id:randomUUID(),catalogToken:s.publicToken,workspaceGeneration:0,orderAccessToken:randomUUID().replace(/-/g,''),customerName:'QA Stock',customerPhone:'11999999999',serviceModeId:'pickup',paymentPreference:'dinheiro',items:[{catalogItemId:`catalog-${id}`,quantity:1}],expectedTotal:25});
const currentOrder=async o=>(await root().collection('catalogOrders').doc(o.id).get()).data();
test.before(async()=>{
  app=initializeApp({projectId:'adi-festa-variations-test'},`public-stock-${suffix}`);db=getFirestore(app);projection=onlineStoreStockProjection(db);stores=onlineStoreService(db);orders=onlineOrderService(db);
  await root().set({active:true,ownerId:uid,workspaceGeneration:0,subscription:{planId:'internal',status:'active'},legacyAccessDisabled:true});
  await root().collection('members').doc(uid).set({role:'owner',status:'active',spaceAccess:'all'});
  for(const space of [a,b])await db.doc(`financialSpaces/${space}`).set({businessId:bid,active:true,capabilities:{products:true,sales:true}});
  await root().collection('products').doc(pid).set({id:pid,businessId:bid,nome:'QA stock',preco:25,custo:10,estoqueAtual:3,workspaceGeneration:0,spaceAccessMode:'all_spaces'});
  storeA=await publish(a,[pid]);storeB=await publish(b,[pid]);
});
test.after(async()=>{if(app)await deleteApp(app);});
test('real reservation/cancel/expiry project net stock in both stores, canonical stock is untouched',async()=>{
  const original=(await root().collection('products').doc(pid).get()).data();
  const o=await currentOrder((await orders.submit({data:payload(storeA)})).order);await project();assert.equal(await quantity(storeA),2);assert.equal(await quantity(storeB),2);
  await orders.change(request({id:o.id,revision:o.revision,status:'cancelado'}));await project();assert.equal(await quantity(storeA),3);
  const expired=(await orders.submit({data:payload(storeB)})).order;await project();assert.equal(await quantity(storeB),2);
  const expiry=onlineOrderExpiry(db,{clock:()=>Date.now()+31*60*1000});await expiry.expire(bid,expired.id);await project();assert.equal(await quantity(storeA),3);
  assert.equal((await root().collection('products').doc(pid).get()).data().estoqueAtual,original.estoqueAtual);assert.equal((await root().collection('sales').get()).size,0);
});
test('duplicate/out-of-order callbacks reread CURRENT stock, preserve public presentation and avoid extra writes',async()=>{
  const p=root().collection('products').doc(pid),before=(await p.get()).data();await p.update({estoqueAtual:2});
  const event={businessId:bid,documentId:pid,kind:'product',before,after:{...before,estoqueAtual:1}};
  await Promise.all([projection.handle(event),projection.handle(event)]);assert.equal(await quantity(storeA),2);
  const publicBefore=await publicRef(storeA).get();assert.equal((await projection.handle(event)).updated,0);
  assert.ok((await publicRef(storeA).get()).updateTime.isEqual(publicBefore.updateTime));
  const item=publicBefore.data().items[0];assert.equal(item.salePrice,25);assert.equal(item.productName,'QA stock');assert.equal(item.custo,undefined);
});
test('consumption while held is conservative; final release and ordinary stock edits converge',async()=>{
  const p=root().collection('products').doc(pid);await p.update({estoqueAtual:2,onlineReservedStock:1});await project();assert.equal(await quantity(storeA),1);
  await p.update({onlineReservedStock:0});await project();assert.equal(await quantity(storeA),2);
});
test('scope removal hides product without republishing, cross-business tokens and inactive stores never modified',async()=>{
  const p=root().collection('products').doc(pid);await p.update({spaceAccessMode:'selected_spaces',allowedSpaceIds:[a]});await project();assert.equal(await quantity(storeB),0);assert.equal((await publicRef(storeB).get()).data().items[0].active,false);
  const before=await publicRef(storeB).get();await db.doc(`catalogStoreBindings/${storeB.publicToken}`).update({businessId:'other-business'});await p.update({estoqueAtual:5});await project();assert.ok((await publicRef(storeB).get()).updateTime.isEqual(before.updateTime));
  await root().collection('onlineStores').doc(storeA.id).update({published:false});const aBefore=await publicRef(storeA).get();await p.update({estoqueAtual:4});await project();assert.ok((await publicRef(storeA).get()).updateTime.isEqual(aBefore.updateTime));
  await root().collection('onlineStores').doc(storeA.id).update({published:true});
});
test('old generation/reset events cannot resurrect catalogs; missing product is disabled, never created',async()=>{
  const publicBefore=await publicRef(storeA).get();await root().update({workspaceGeneration:1});assert.equal((await project()).updated,0);assert.ok((await publicRef(storeA).get()).updateTime.isEqual(publicBefore.updateTime));
  await root().update({workspaceGeneration:0,workspaceReset:{status:'FAILED'}});assert.equal((await project()).updated,0);await root().update({workspaceReset:{status:'COMPLETED'}});
  await root().collection('products').doc(pid).delete();await project();assert.equal(await quantity(storeA),0);assert.equal((await publicRef(storeA).get()).data().items[0].active,false);assert.equal((await root().collection('products').doc(pid).get()).exists,false);
});
test('variant reservation/release is projected only to published variants and valid space',async()=>{
  const parent=`variable-${suffix}`,variant=`variant-${suffix}`;
  await root().collection('products').doc(parent).set({id:parent,nome:'QA variation',businessId:bid,workspaceGeneration:0,productType:'variable',spaceAccessMode:'selected_spaces',allowedSpaceIds:[a],estoqueAtual:2});
  await root().collection('productVariants').doc(variant).set({id:variant,businessId:bid,workspaceGeneration:0,parentProductId:parent,stock:2,price:25,displayName:'QA variant'});
  const old=(await stores.load(request({spaceId:a}))).store;storeA=(await stores.save(request({spaceId:a,action:'publish',confirmed:true,revision:old.revision,productIds:[parent]}))).store;
  const p=payload(storeA,parent);p.items[0].variantId=variant;p.items[0].catalogItemId+=`::${variant}`;const o=await currentOrder((await orders.submit({data:p})).order);
  const event={businessId:bid,documentId:variant,kind:'variant',before:{parentProductId:parent,stock:2},after:{parentProductId:parent,stock:2,onlineReservedStock:1}};
  await projection.handle(event);let item=(await publicRef(storeA).get()).data().items[0];assert.equal(item.availableQuantity,1);assert.equal(item.variants[0].availableQuantity,1);
  await orders.change(request({id:o.id,revision:o.revision,status:'cancelado'}));await projection.handle(event);item=(await publicRef(storeA).get()).data().items[0];assert.equal(item.variants[0].availableQuantity,2);assert.equal(item.availableQuantity,2);
  await root().collection('productVariants').doc(variant).delete();await projection.handle({...event,after:null});item=(await publicRef(storeA).get()).data().items[0];assert.equal(item.variants[0].availableQuantity,0);assert.equal(item.variants[0].active,false);
});
test('unpublished draft changes cannot stop LIVE stock updates or publish draft visibility',async()=>{
  const space=`draft-space-${suffix}`,id=`draft-product-${suffix}`;
  await db.doc(`financialSpaces/${space}`).set({businessId:bid,active:true,capabilities:{products:true,sales:true}});
  await root().collection('products').doc(id).set({id,nome:'QA live',preco:25,estoqueAtual:3,businessId:bid,workspaceGeneration:0,spaceAccessMode:'all_spaces'});
  const live=await publish(space,[id]);
  // Exercise compatibility for an already published pre-hotfix V2 store.
  const {FieldValue}=req('firebase-admin/firestore');await root().collection('onlineStores').doc(live.id).update({publishedProductIds:FieldValue.delete()});
  await stores.save(request({spaceId:space,revision:live.revision,action:'save',productIds:[],presentation:{products:{[id]:{published:false}}}}));
  assert.deepEqual((await root().collection('onlineStores').doc(live.id).get()).data().publishedProductIds,[id]);
  await root().collection('products').doc(id).update({onlineReservedStock:1});await project(id);
  const item=(await publicRef(live).get()).data().items[0];assert.equal(item.availableQuantity,2);assert.equal(item.active,true);assert.equal(item.ownerPublished,true);
});
