'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {createRequire}=require('node:module');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {seedReview,ledgers}=require('../helpers/fiado-central-review-fixture.cjs');
const {fiadoRegularizationReviewService}=require('../../functions/src/services/fiado-regularization-review');
const project='demo-veconi-fiado-central';
assert.equal(process.env.GCLOUD_PROJECT,project);
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^127\.0\.0\.1:\d+$/);
const dep=createRequire(path.resolve('functions/package.json'));
const {initializeApp,deleteApp}=dep('firebase-admin/app'),{getFirestore}=dep('firebase-admin/firestore');
const app=initializeApp({projectId:project},'central-'+randomUUID()),db=getFirestore(app);
test.after(()=>deleteApp(app));

const adjustment=id=>'balanceAdjustments:'+id+'-qa-source-1';
const otherAdjustment=id=>'balanceAdjustments:'+id+'-qa-source-2';
const payment=id=>'payments:'+id+'-qa-source-3';
const sale=id=>'sales:'+id+'-qa-source-0';

async function snapshot(root){
 const names=[...ledgers,'clients','auditLogs','syncMetadata','fiadoHistoryRegularizations'];
 const collections=await Promise.all(names.map(name=>root.collection(name).get()));
 return collections.map(result=>result.docs.map(doc=>[doc.id,doc.updateTime.toMillis(),doc.data()]));
}
async function stage(q,id,mode,items){
 const account=await q.api.account(q.request(id));
 const draft={mode,items,revision:account.revision};
 const prepared=await q.api.prepare(q.request(id,draft));
 return {...draft,confirmed:true,requestId:randomUUID(),reviewHash:prepared.reviewHash};
}
async function confirmOrigin(q,id,recordId,spaceId=q.adiSpaceId){
 return q.api.confirm(q.request(id,await stage(q,id,'individual',[{recordId,spaceId}])));
}

test('owner only, exact tenant, workspace generation, no access for future subscribers and no writes from the reader',async()=>{
 const q=await seedReview(db),other=await seedReview(db);
 const before=await snapshot(q.root);
 await assert.rejects(q.api.list(q.request('qa-main',{},q.manager)),{code:'permission-denied'});
 await assert.rejects(q.api.account(q.request('qa-main',{},null)),{code:'permission-denied'});
 await assert.rejects(q.api.list(other.request()),{code:'permission-denied'});
 await assert.rejects(q.api.account(q.request('qa-main',{workspaceGeneration:1})),{code:'failed-precondition'});
 await assert.rejects(q.api.account(q.request('missing-qa')), {code:'permission-denied'});
 const disabled=fiadoRegularizationReviewService(db,{access:{...q.access,enabled:false}});
 await assert.rejects(disabled.list(q.request()),{code:'permission-denied'});
 const first=await q.api.list(q.request('qa-main',{limit:1}));
 assert.equal(first.accounts.length,1);
 assert.ok(first.nextCursor);
 const next=await q.api.list(q.request('qa-main',{limit:2,cursor:first.nextCursor}));
 assert.equal(new Set([...first.accounts,...next.accounts].map(row=>row.clientId)).size,3);
 assert.equal(next.nextCursor,null);
 assert.throws(()=>fiadoRegularizationReviewService(db,{access:{...q.access,approvedLotSha256:'a'.repeat(64)}}),/SHA-256/);
 const lot=await q.api.list(q.request('qa-main',{lotOnly:true}));
 assert.deepEqual(lot.accounts.map(row=>row.clientId),['qa-main']);
 const detail=await q.api.account(q.request());
 assert.equal(detail.state,'origin_pending');
 assert.equal(detail.records.length,4);
 assert.equal(detail.records.filter(row=>row.fromInitialLot).length,3);
 assert.equal(detail.records.find(row=>row.id===sale('qa-main')).classification,'known');
 assert.equal(detail.records.find(row=>row.id===payment('qa-main')).knownOrigin,q.adiSpaceId);
 assert.equal(detail.records.find(row=>row.id===payment('qa-main')).batchEligible,false);
 assert.equal((await q.root.collection('fiadoOriginReviews').get()).size,0);
 assert.deepEqual(await snapshot(q.root),before);
});

test('batch requires a review, permits exclusions, confirms only evidence and returns scoped readiness from the real executor',async()=>{
 const q=await seedReview(db),id='qa-main',before=await snapshot(q.root);
 const both=[adjustment(id),otherAdjustment(id)].map(recordId=>({recordId,spaceId:q.adiSpaceId}));
 const original=await stage(q,id,'batch',both);
 const reduced=await stage(q,id,'batch',[both[0]]);
 assert.notEqual(original.reviewHash,reduced.reviewHash);
 await assert.rejects(q.api.confirm(q.request(id,{...reduced,reviewHash:original.reviewHash})),
  error=>error.details?.reason==='fiado-review-stale');
 await assert.rejects(q.api.confirm(q.request(id,{...reduced,confirmed:false})),
  error=>error.details?.reason==='fiado-review-confirmation-required');
 const audit=q.root.collection('fiadoOriginReviews').doc(id);
 assert.equal((await audit.get()).exists,false);
 const attempts=await Promise.all([q.api.confirm(q.request(id,reduced)),q.api.confirm(q.request(id,reduced))]);
 assert.deepEqual(attempts.map(result=>result.status).sort(),['replayed','saved']);
 assert.equal((await audit.collection('events').get()).size,1);
 let detail=await q.api.account(q.request(id));
 assert.equal(detail.state,'origin_pending');
 assert.equal(detail.records.find(row=>row.id===both[1].recordId).decision,null);
 await assert.rejects(q.api.prepare(q.request(id,{revision:detail.revision,mode:'batch',items:[{recordId:payment(id),spaceId:q.adiSpaceId}]})),
  error=>error.details?.reason==='fiado-review-origin-conflict');
 await confirmOrigin(q,id,otherAdjustment(id));
 await confirmOrigin(q,id,payment(id));
 detail=await q.api.account(q.request(id));
 assert.equal(detail.state,'balance_to_validate');
 const reviewed=await q.api.review(q.request(id));
 assert.equal(reviewed.state,'ready');
 assert.match(reviewed.executorReviewHash,/^[a-f0-9]{64}$/);
 const bySpace=Object.fromEntries(reviewed.routing.map(row=>[row.spaceId,row.after]));
 assert.equal(bySpace[q.adiSpaceId].dueCents,24700);
 assert.equal(bySpace[q.cardSpaceId].dueCents,28000);
 assert.equal(bySpace[q.cardSpaceId].futureCents,252000);
 const lot=await q.api.reviewLot(q.request());
 assert.equal(lot.accounts.length,1);
 assert.equal(lot.accounts[0].state,'ready');
 assert.equal(lot.accounts[0].confirmedOrigins,3);
 assert.equal(q.api.apply,undefined);
 assert.deepEqual(await snapshot(q.root),before);
 assert.equal((await db.doc('financialSpaces/'+q.adiSpaceId+'/entries/credit_payment_qa-main-qa-source-3').get()).data().amountCents,30900);
});

test('known and conflicting origins stay protected, stale source invalidates review and missing cash blocks readiness',async()=>{
 const q=await seedReview(db),id='qa-conflict';
 const first=await q.api.account(q.request(id));
 assert.equal(first.records.find(row=>row.id===otherAdjustment(id)).classification,'conflict');
 await assert.rejects(stage(q,id,'individual',[{recordId:otherAdjustment(id),spaceId:q.adiSpaceId}]));
 await assert.rejects(stage(q,id,'individual',[{recordId:sale(id),spaceId:q.adiSpaceId}]));
 await confirmOrigin(q,id,otherAdjustment(id),null);
 await confirmOrigin(q,id,adjustment(id),null);
 assert.equal((await q.api.account(q.request(id))).records.find(row=>row.id===adjustment(id)).batchEligible,false);
 assert.equal((await q.api.review(q.request(id))).state,'origin_pending');
 const stale=await stage(q,'qa-main','individual',[{recordId:adjustment('qa-main'),spaceId:q.adiSpaceId}]);
 await q.root.collection('balanceAdjustments').doc('qa-main-qa-source-1').update({saldoNovo:-3101});
 await assert.rejects(q.api.confirm(q.request('qa-main',stale)),error=>error.details?.reason==='fiado-review-stale');
 const missing='qa-no-cash';
 for(const recordId of [adjustment(missing),otherAdjustment(missing),payment(missing)])await confirmOrigin(q,missing,recordId);
 const result=await q.api.review(q.request(missing));
 assert.equal(result.state,'balance_to_validate');
 assert.equal(result.reason,'fiado-regularization-origin-cash');
 assert.equal((await q.root.collection('fiadoHistoryRegularizations').get()).size,0);
});

test('browser owner and manager cannot read or forge server review evidence directly',async()=>{
 const fs=require('node:fs');
 const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
 const firestore=require('firebase/firestore');
 const env=await initializeTestEnvironment({projectId:project,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 try{
  const q=await seedReview(db),review=q.root.collection('fiadoOriginReviews').doc('qa-main');
  const opening=q.root.collection('fiadoOpeningBalances').doc('qa-main');
  await review.set({businessId:q.businessId,clientId:'qa-main',workspaceGeneration:0,decisions:[]});
  await review.collection('events').doc('qa-event').set({actorUid:q.owner.uid});
  await opening.set({businessId:q.businessId,clientId:'qa-main',workspaceGeneration:0});
  for(const {uid} of [q.owner,q.manager]){
   const direct=env.authenticatedContext(uid).firestore();
   await assertFails(firestore.getDoc(firestore.doc(direct,review.path)));
   await assertFails(firestore.getDoc(firestore.doc(direct,review.path+'/events/qa-event')));
   await assertFails(firestore.setDoc(firestore.doc(direct,review.path+'/events/forged-event'),{actorUid:uid}));
   await assertFails(firestore.getDoc(firestore.doc(direct,opening.path)));
   await assertFails(firestore.setDoc(firestore.doc(direct,opening.path),{actorUid:uid}));
   await assertFails(firestore.updateDoc(firestore.doc(direct,q.root.path+'/clients/qa-main'),{
    fiadoOpeningBalance:{version:1,hash:'forged'},fiadoHistoryVersion:1
   }));
  }
 }finally{await env.cleanup();}
});
