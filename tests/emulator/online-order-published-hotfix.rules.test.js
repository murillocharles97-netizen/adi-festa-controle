'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {lab,shop} = require('../helpers/online-shop-hotfix.cjs');

let v;
test.before(async()=>{v=await lab('order-published-hotfix');});
test.after(async()=>v?.close());
const checkout=(id,quantity=1)=>[{catalogItemId:'catalog-'+id,quantity}];
const submit=data=>v.orders.submit({data});
const status=data=>v.orders.status({data});
const publishForOrders=async(s,ids)=>{
  const draft=await s.draft({productIds:ids});
  return s.publish(draft,{settings:{...s.settings,checkoutEnabled:true}});
};

test('published items and delivery/payment settings survive a saved draft until explicit publication',async()=>{
  const s=await shop(v);
  const item=await s.item('public');
  await s.item('private');
  const published=await publishForOrders(s,['public']);
  const previous=await v.publicCatalog(published);
  const edited=await s.change(published,{productIds:['private'],settings:{...published.catalogSettings,
    pickupEnabled:false,deliveryEnabled:true,paymentMethods:['dinheiro']}});
  assert.deepEqual(await v.publicCatalog(edited),previous);

  // Same order identity and expectedTotal fields sent by the V242.3 and V3 clients.
  const payload=s.payload(edited,checkout('public'),{businessId:s.businessId,expectedTotal:10});
  const duplicate=await Promise.all([submit(payload),submit(payload)]);
  assert.equal(duplicate[0].order.id,duplicate[1].order.id);
  assert.equal(duplicate.filter(result=>result.idempotent).length,1);
  assert.equal((await item.get()).data().onlineReservedStock,1);
  assert.equal((await s.doc.collection('onlineOrderReservations').get()).size,1);
  await assert.rejects(submit(s.payload(edited,checkout('private'))),{code:'invalid-argument'});
  await assert.rejects(submit(s.payload(edited,checkout('public'),{paymentPreference:'dinheiro'})),{code:'invalid-argument'});
  await assert.rejects(submit(s.payload(edited,checkout('public'),{serviceModeId:'delivery',customerLocation:'Rua Fictícia 10'})),{code:'invalid-argument'});

  const paused=await s.pause(edited);
  await assert.rejects(submit(s.payload(paused,checkout('public'))),{code:'failed-precondition'});
  assert.equal((await status(payload)).order.id,payload.id);
  assert.equal((await submit(payload)).idempotent,true);
  const resumed=await s.publish(paused);
  const confirmed=await s.publish(resumed);
  await assert.rejects(submit(s.payload(confirmed,checkout('public'),{
    serviceModeId:'delivery',paymentPreference:'dinheiro',customerLocation:'Rua Fictícia 10',
  })),{code:'invalid-argument'});
  const received=await submit(s.payload(confirmed,checkout('private'),{
    serviceModeId:'delivery',paymentPreference:'dinheiro',customerLocation:'Rua Fictícia 10',
  }));
  assert.equal(received.order.items[0].productId,'private');
  assert.equal((await status(payload)).order.id,payload.id);
  assert.equal((await s.doc.collection('sales').get()).size,0);
});

test('current authoritative price and stock apply, and unlisted variants stay unavailable',async()=>{
  const s=await shop(v);
  const product=await s.item('simple');
  await s.item('variable',{productType:'variable'});
  const variant=await s.variant('public-variant','variable',{stock:1});
  const published=await publishForOrders(s,['simple','variable']);
  await s.variant('new-unpublished-variant','variable');
  await product.update({preco:12});
  await variant.update({price:16});
  await assert.rejects(submit(s.payload(published,checkout('variable::new-unpublished-variant'))),{code:'invalid-argument'});
  await assert.rejects(submit(s.payload(published,checkout('simple'),{expectedTotal:10})),/O preço mudou/);
  await assert.rejects(submit(s.payload(published,checkout('variable::public-variant'),{expectedTotal:15})),/O preço mudou/);
  assert.equal((await s.doc.collection('onlineOrderReservations').get()).size,0);
  const request=s.payload(published,checkout('variable::public-variant'),{expectedTotal:16});
  assert.equal((await submit(request)).order.total,16);
  assert.equal((await submit(request)).idempotent,true);
  await assert.rejects(submit(s.payload(published,checkout('variable::public-variant'),{expectedTotal:16})),/Estoque insuficiente/);
  assert.equal((await variant.get()).data().stock,1);
  assert.equal((await variant.get()).data().onlineReservedStock,1);
  assert.equal((await product.get()).data().onlineReservedStock,undefined);
});

test('reception availability reads published service and payment options',async()=>{
  const s=await shop(v);
  await s.item('pickup-only');
  const live=await s.publish(await s.draft({productIds:['pickup-only']}));
  const pending=await s.change(live,{settings:{...s.settings,pickupEnabled:false,deliveryEnabled:false,paymentMethods:[]}});
  const before=(await v.stores.load(s.request())).orderReception;
  assert.deepEqual(before,{enabled:false,canEnable:true,reason:'paused'});
  const result=await v.stores.save(s.request({action:'set_order_reception',confirmed:true,enabled:true,revision:pending.revision}));
  const liveCatalog=await v.publicCatalog(result.store);
  assert.equal(liveCatalog.acceptingOrders,true);
  assert.equal(liveCatalog.publicSettings.pickupEnabled,true);
  assert.deepEqual(liveCatalog.publicSettings.paymentMethods,['pix']);
  assert.equal(result.store.catalogSettings.pickupEnabled,false);
  assert.deepEqual(result.store.catalogSettings.paymentMethods,[]);
  assert.equal((await submit(s.payload(result.store,checkout('pickup-only')))).order.total,10);
});

test('a legacy store price used in its publication keeps precedence over the current base price',async()=>{
  const s=await shop(v);
  const product=await s.item('legacy-price');
  const draft=await s.draft({productIds:['legacy-price']});
  const storeRef=s.doc.collection('onlineStores').doc(draft.id);
  await storeRef.update({'presentation.products.legacy-price.price':9});
  const published=await s.publish(draft,{settings:{...s.settings,checkoutEnabled:true}});
  await product.update({preco:11});
  assert.equal((await v.publicCatalog(published)).items[0].salePrice,9);
  assert.equal((await submit(s.payload(published,checkout('legacy-price'),{expectedTotal:9}))).order.total,9);
  await storeRef.update({'presentation.products.legacy-price.price':8});
  await assert.rejects(submit(s.payload(published,checkout('legacy-price'),{expectedTotal:8})),/O preço mudou/);
});

test('catalog token scopes the company and space; a visible brand is no substitute for a published item',async()=>{
  const a=await shop(v), b=await shop(v,{tenant:a}), other=await shop(v);
  await a.item('space-a');
  const bItem=await b.item('space-b');
  const otherItem=await other.item('company-b');
  const aPublic=await publishForOrders(a,['space-a']);
  const bPublic=await publishForOrders(b,['space-b']);
  await publishForOrders(other,['company-b']);
  await assert.rejects(submit(a.payload(aPublic,checkout('space-b'))),{code:'invalid-argument'});
  await assert.rejects(submit(a.payload(aPublic,checkout('company-b'))),{code:'invalid-argument'});
  await assert.rejects(submit(a.payload(aPublic,checkout('space-a'),{spaceId:b.spaceId})),{code:'permission-denied'});
  await assert.rejects(submit(a.payload(aPublic,checkout('space-a'),{businessId:other.businessId})),{code:'permission-denied'});
  assert.equal((await bItem.get()).data().onlineReservedStock,undefined);
  assert.equal((await otherItem.get()).data().onlineReservedStock,undefined);
  const own=b.payload(bPublic,checkout('space-b'),{spaceId:b.spaceId,businessId:b.businessId});
  assert.equal((await submit(own)).order.spaceId,b.spaceId);
  await assert.rejects(status({...own,catalogToken:aPublic.publicToken}),{code:'not-found'});
});

test('publication and checkout racing serialize without an orphan reservation',async()=>{
  const s=await shop(v);
  const item=await s.item('removed-on-publish');
  await s.item('replacement');
  const published=await publishForOrders(s,['removed-on-publish']);
  const draft=await s.change(published,{productIds:['replacement']});
  const request=s.payload(draft,checkout('removed-on-publish'),{expectedTotal:10});
  const [order,edition]=await Promise.allSettled([submit(request),s.publish(draft)]);
  assert.equal(edition.status,'fulfilled');
  assert.deepEqual((await v.publicCatalog(edition.value)).items.map(x=>x.productId),['replacement']);
  const count=(await s.doc.collection('onlineOrderReservations').get()).size;
  if(order.status==='fulfilled'){
    assert.equal(count,1);
    assert.equal((await status(request)).order.id,request.id);
  }else{
    assert.equal(order.reason.code,'invalid-argument');
    assert.equal(count,0);
  }
  assert.equal((await item.get()).data().onlineReservedStock||0,count);
  await assert.rejects(submit(s.payload(edition.value,checkout('removed-on-publish'))),{code:'invalid-argument'});
});
