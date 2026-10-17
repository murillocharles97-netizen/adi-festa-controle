'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const functionsRequire=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=functionsRequire('firebase-admin/app'),{getFirestore,FieldValue}=functionsRequire('firebase-admin/firestore');
const {saleRecoveryService}=require('../../functions/src/services/sale-recovery-service'),f=require('../fixtures/retained-sale-recovery.cjs');
let env,app,db,service;
const emulator=Boolean(process.env.FIRESTORE_EMULATOR_HOST),t=(name,fn)=>test(name,{skip:!emulator},fn);
const doc=(name,id)=>db.doc(`businesses/${f.bid}/${name}/${id}`);
async function businessSnapshot(){
 const paths=['products','productVariants','stockMovements','sales','saleFinancials','financialIncomeRoutes','clients','payments','balanceEvents','activityEvents','settings','campaignProgress','processedOperations'];
 const result={};for(const name of paths){const rows=await db.collection(`businesses/${f.bid}/${name}`).get();result[name]=rows.docs.map(d=>({id:d.id,data:d.data(),updateTime:d.updateTime.toMillis()}));}
 const space=await db.doc(`financialSpaces/${f.spaceId}`).get();result.space={data:space.data(),updateTime:space.updateTime.toMillis()};return result;
}
test.before(async()=>{
 if(!emulator)return;
 env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 app=initializeApp({projectId:'adi-festa-variations-test'},'sale-recovery-test');db=getFirestore(app);service=saleRecoveryService(db,{FieldValue});
 await db.doc(`businesses/${f.bid}`).set({id:f.bid,ownerId:f.owner,active:true,workspaceGeneration:0});
 for(const [uid,role]of [[f.seller,'seller'],[f.owner,'owner'],['recovery-seller-b','seller'],['recovery-manager','manager']]){
  await db.doc(`users/${uid}`).set({uid,businessId:f.bid,active:true,role});await doc('members',uid).set({uid,name:uid,role,status:'active',spaceAccess:uid===f.owner?'all':'selected',allowedSpaceIds:[uid==='recovery-seller-b'?f.otherSpace:f.spaceId],permissions:{'sales.create':true,'financial.view':false}});
 }
 for(const id of [f.spaceId,f.otherSpace])await db.doc(`financialSpaces/${id}`).set({id,name:id,businessId:f.bid,linkedBusinessId:f.bid,ownerUid:f.owner,active:true,capabilities:{finance:false},goalDaily:200});
 await doc('products','shared-product').set({id:'shared-product',businessId:f.bid,estoqueAtual:0,spaceId:f.spaceId});
 await doc('settings','goals').set({daily:200,monthly:6000});await doc('saleFinancials','historical').set({amount:25});
 const x=f.sample();await doc('sales','owner-replacement').set({...x.sale,id:'owner-replacement',actorUid:f.owner,data:'2026-10-17T18:59:26.000Z'});
});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
t('four retained originals including zero-stock A: three review-only documents each, zero commercial changes',async()=>{
 const before=await businessSnapshot(),packets=Array.from({length:4},(_,n)=>f.sample(n).original),copy=JSON.stringify(packets);
 for(const original of packets){const receipt=await service.submit(f.request(f.envelope(original)));assert.equal(receipt.status,'awaiting_review');assert.equal(receipt.duplicate,false);}
 assert.equal(JSON.stringify(packets),copy);assert.deepEqual(await businessSnapshot(),before);
 const reviews=await db.collection(`businesses/${f.bid}/saleRecoveryReviews`).get();assert.equal(reviews.size,4);
 for(const d of reviews.docs){assert.equal(d.data().commercialEffectsApplied,false);assert.equal(d.data().status,'awaiting_review');assert.equal((await d.ref.collection('original').get()).size,1);}
});
t('lost response / double submission returns same receipt and immutable original, including concurrent requests',async()=>{
 const data=f.envelope(f.sample().original),before=await businessSnapshot(),raw=doc('saleRecoveryReviews','retained-sale-0').collection('original').doc('payload'),original=await raw.get();
 const results=await Promise.all(Array.from({length:3},()=>service.submit(f.request(data))));assert.ok(results.every(r=>r.duplicate));assert.equal((await raw.get()).updateTime.toMillis(),original.updateTime.toMillis());assert.deepEqual(await businessSnapshot(),before);
});
t('conflicting content is rejected, privately preserved, never overwrites the accepted packet',async()=>{
 const original=f.sample().original;original.packet.lastErrorMessage='conflicting error evidence';const data=f.envelope(original),before=await businessSnapshot(),ref=doc('saleRecoveryReviews','retained-sale-0'),raw=await ref.collection('original').doc('payload').get();
 const receipt=await service.submit(f.request(data));assert.equal(receipt.status,'content_conflict');assert.equal((await ref.collection('original').doc('payload').get()).data().originalJson,raw.data().originalJson);const evidence=await ref.collection('conflicts').get();assert.equal(evidence.size,1);assert.equal(evidence.docs[0].data().originalJson,data.originalJson);assert.deepEqual(await businessSnapshot(),before);
 await service.submit(f.request(data));assert.equal((await ref.collection('conflicts').get()).size,1);
});
t('seller sees only own records; owner sees company records and hints, not business effects',async()=>{
 await service.submit(f.request(f.envelope(f.sample(4,'recovery-seller-b',f.otherSpace).original),'recovery-seller-b'));
 const seller=await service.list(f.request({businessId:f.bid,spaceId:f.spaceId,workspaceGeneration:0}));assert.equal(seller.items.length,4);assert.ok(seller.items.every(i=>i.actorUid===f.seller));assert.ok(seller.items.every(i=>!('originalJson'in i)&&!('custoUnitario'in i.items[0])));
 const owner=await service.list(f.request({businessId:f.bid,workspaceGeneration:0},f.owner));assert.equal(owner.items.length,5);assert.equal(owner.items.find(i=>i.saleId==='retained-sale-0').possibleMatches[0].saleId,'owner-replacement');
 await assert.rejects(service.original(f.request({businessId:f.bid,saleId:'retained-sale-0'})),{code:'permission-denied'});const raw=await service.original(f.request({businessId:f.bid,saleId:'retained-sale-0'},f.owner));assert.equal(raw.originalJson,f.envelope(f.sample().original).originalJson);
});
t('auth, foreign company/space, inactive membership, forged actor and old generation rejected',async()=>{
 const x=f.sample(6),input=f.envelope(x.original);await assert.rejects(service.submit(f.request(input,null)),{code:'unauthenticated'});
 await assert.rejects(service.submit(f.request({...input,businessId:'foreign-company'})),{code:'permission-denied'});
 await assert.rejects(service.submit(f.request(f.envelope(f.sample(7,f.seller,f.otherSpace).original))),{code:'permission-denied'});
 await assert.rejects(service.submit(f.request({...input,workspaceGeneration:1})),{code:'failed-precondition'});
 const forged=structuredClone(x.original);forged.packet.payload.writes[0].data.actorUid=f.owner;await assert.rejects(service.submit(f.request(f.envelope(forged))),{code:'permission-denied'});
 await doc('members',f.seller).update({status:'disabled'});await assert.rejects(service.submit(f.request(input)),{code:'permission-denied'});await doc('members',f.seller).update({status:'active'});
 await assert.rejects(service.list(f.request({businessId:f.bid,spaceId:f.otherSpace})),{code:'permission-denied'});
 const manager=await service.list(f.request({businessId:f.bid,spaceId:f.spaceId},'recovery-manager'));assert.equal(manager.items.length,0);
});
t('existing commercial evidence does not prevent preservation and does not execute/reverse anything',async()=>{
 const x=f.sample(8);await doc('sales',x.sale.id).set(x.sale);await doc('stockMovements',x.movements[0].id).set(x.movements[0]);const before=await businessSnapshot();await service.submit(f.request(f.envelope(x.original)));assert.deepEqual(await businessSnapshot(),before);const saved=await doc('saleRecoveryReviews',x.sale.id).get();assert.equal(saved.data().remoteEvidence.saleExists,true);assert.deepEqual(saved.data().remoteEvidence.movementIdsPresent,[x.movements[0].id]);
});
t('Rules prohibit all direct client access to reviews/originals/conflicts/operation index, even owner',async()=>{
 for(const uid of [f.seller,f.owner,'recovery-seller-b']){
  const client=env.authenticatedContext(uid).firestore();
  for(const path of [['saleRecoveryReviews','retained-sale-0'],['saleRecoveryReviews','retained-sale-0','original','payload'],['saleRecoveryReviews','retained-sale-0','conflicts','any-conflict'],['saleRecoveryOperations','retained-operation-0']]){
   const ref=sdk.doc(client,'businesses',f.bid,...path);await assertFails(sdk.getDoc(ref));await assertFails(sdk.setDoc(ref,{businessId:f.bid,status:'completed'}));await assertFails(sdk.deleteDoc(ref));
  }
 }
});
t('concurrent first intake creates exactly one review and one immutable packet, without effects',async()=>{
 const data=f.envelope(f.sample(6).original),before=await businessSnapshot();
 const results=await Promise.all([service.submit(f.request(data)),service.submit(f.request(data))]);assert.equal(results.filter(r=>!r.duplicate).length,1);assert.equal(results.filter(r=>r.duplicate).length,1);assert.equal((await doc('saleRecoveryReviews','retained-sale-6').collection('original').get()).size,1);assert.deepEqual(await businessSnapshot(),before);
});
t('cashier can preserve own packet without financial access; cannot fetch another seller original',async()=>{
 const uid='recovery-cashier';await db.doc(`users/${uid}`).set({uid,businessId:f.bid,active:true,role:'cashier'});await doc('members',uid).set({uid,role:'cashier',status:'active',spaceAccess:'selected',allowedSpaceIds:[f.spaceId],permissions:{'sales.create':true,'financial.view':false}});
 const original=f.sample(9,uid).original;original.packet.payload.writes[0].data.actorRoleSnapshot='cashier';const before=await businessSnapshot();assert.equal((await service.submit(f.request(f.envelope(original),uid))).status,'awaiting_review');assert.deepEqual(await businessSnapshot(),before);
 const rows=await service.list(f.request({businessId:f.bid,spaceId:f.spaceId},uid));assert.equal(rows.items.length,1);assert.equal(rows.items[0].actorUid,uid);await assert.rejects(service.original(f.request({businessId:f.bid,saleId:'retained-sale-0'},uid)),{code:'permission-denied'});
});
