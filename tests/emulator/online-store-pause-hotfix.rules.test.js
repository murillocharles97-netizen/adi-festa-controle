'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const {FieldValue} = require('firebase-admin/firestore');
const {lab,shop} = require('../helpers/online-shop-hotfix.cjs');

let v;
test.before(async()=>{v=await lab('pause-hotfix');});
test.after(async()=>v?.close());
const publicContent = ({active,catalogVisible,acceptingOrders,revision,updatedAt,...content})=>content;
const draftContent = ({published,revision,updatedAt,actorUid,...content})=>content;

test('pause and resume keep the last publication and the distinct saved draft', async()=>{
  const s=await shop(v);
  await s.item('public-item');
  await s.item('draft-item');
  const initial=await s.draft({productIds:['public-item']});
  const published=await s.publish(initial,{settings:{...s.settings,checkoutEnabled:true}});
  const original=await v.publicCatalog(published);
  assert.equal(original.acceptingOrders,true);

  const edited=await s.change(published,{
    productIds:['draft-item'],
    settings:{...published.catalogSettings,publicName:'Nome inédito',contactPhone:'11900000000'},
    presentation:{products:{'draft-item':{featured:true}},categories:[{internalName:'Doces',publicName:'Privada'}]},
  });
  assert.deepEqual(await v.publicCatalog(edited),original);
  // Existing V242.3 and V3 payloads include draft data even for availability changes.
  const body={settings:edited.catalogSettings,productIds:edited.selectedProductIds,presentation:edited.presentation};
  const unusedSlug=s.slug+'-pause-only';
  const paused=await s.pause(edited,{...body,slug:unusedSlug});
  const pausedPublic=await v.publicCatalog(paused);
  assert.equal(paused.published,false);
  assert.equal(pausedPublic.active,false);
  assert.equal(pausedPublic.catalogVisible,false);
  assert.equal(pausedPublic.acceptingOrders,false);
  assert.deepEqual(publicContent(pausedPublic),publicContent(original));
  assert.deepEqual(draftContent(paused),draftContent(edited));
  assert.equal((await v.db.doc('publicCatalogSlugs/'+unusedSlug).get()).exists,false);

  const editedWhilePaused=await s.change(paused,{settings:{...edited.catalogSettings,publicName:'Ainda inédito'}});
  const resumed=await s.publish(editedWhilePaused,{settings:editedWhilePaused.catalogSettings,
    productIds:editedWhilePaused.selectedProductIds,presentation:editedWhilePaused.presentation,slug:s.slug});
  const resumedPublic=await v.publicCatalog(resumed);
  assert.equal(resumedPublic.active,true);
  assert.equal(resumedPublic.catalogVisible,true);
  assert.equal(resumedPublic.acceptingOrders,true);
  assert.equal(resumedPublic.revision,resumed.revision);
  assert.deepEqual(publicContent(resumedPublic),publicContent(original));
  assert.deepEqual(draftContent(resumed),draftContent(editedWhilePaused));
  assert.equal((await v.db.doc('publicCatalogSlugs/'+s.slug).get()).data().catalogToken,published.publicToken);

  const explicitlyPublished=await s.publish(resumed);
  const updated=await v.publicCatalog(explicitlyPublished);
  assert.equal(updated.publicName,'Ainda inédito');
  assert.deepEqual(updated.items.map(x=>x.productId),['draft-item']);
  assert.equal(updated.categories[0].publicName,'Privada');
});

test('a draft cannot be paused into a publication and a misbound snapshot cannot be resumed',async()=>{
  const a=await shop(v), b=await shop(v);
  const draft=await a.draft();
  await assert.rejects(a.pause(draft),{code:'failed-precondition'});
  assert.equal(await v.publicCatalog(draft),undefined);
  const published=await a.publish(draft), paused=await a.pause(published);
  await assert.rejects(v.stores.save(a.request({revision:paused.revision,action:'publish',confirmed:true,published:true},b.uid)),{code:'permission-denied'});
  await v.db.doc('catalogStoreBindings/'+paused.publicToken).update({spaceId:b.spaceId});
  await assert.rejects(a.publish(paused),{code:'failed-precondition'});
  assert.equal((await v.publicCatalog(paused)).active,false);
});

test('a stale concurrent publish or pause cannot change the winning revision',async()=>{
  const s=await shop(v);
  await s.item('original');
  await s.item('new');
  const published=await s.publish(await s.draft({productIds:['original']}));
  const edited=await s.change(published,{productIds:['new'],settings:{...s.settings,publicName:'Outra revisão'}});
  const [pause,publish]=await Promise.allSettled([s.pause(edited),s.publish(edited)]);
  assert.equal([pause,publish].filter(r=>r.status==='fulfilled').length,1);
  const now=await v.publicCatalog(edited);
  assert.equal(now.revision,edited.revision+1);
  if(pause.status==='fulfilled'){
    assert.equal(publish.reason.code,'aborted');
    assert.equal(now.active,false);
    assert.deepEqual(now.items.map(x=>x.productId),['original']);
  }else{
    assert.equal(pause.reason.code,'aborted');
    assert.equal(now.active,true);
    assert.deepEqual(now.items.map(x=>x.productId),['new']);
  }
});

test('a previously bound store with a missing snapshot cannot publish its draft as a resume',async()=>{
  const s=await shop(v);
  await s.item('original');
  const live=await s.publish(await s.draft({productIds:['original']}));
  const paused=await s.pause(live);
  await v.catalogRef(paused).delete();
  await s.doc.collection('onlineStores').doc(paused.id).update({publishedProductIds:FieldValue.delete()});
  await assert.rejects(s.publish(paused),{code:'failed-precondition'});
  assert.equal(await v.publicCatalog(paused),undefined);
});
