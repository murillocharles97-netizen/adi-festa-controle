'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{randomUUID}=require('node:crypto');
if(!/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Emulator required');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore');

test('financial routing and canonical stock: QA, two spaces, concurrent retry, cancellation, history and shared account',async()=>{
  const {main}=require('../../functions/test/financial-income-emulator');
  const report=await main();assert.equal(report.ok,true);assert.equal(report.scenarios.length,9);
  console.log(JSON.stringify(report));
});

test('Rules pin receipt origin, enforce member space access and forbid client projection receipts',async()=>{
  const suffix=randomUUID().slice(0,8),bid='routing-rules-'+suffix,uid='owner-'+suffix,seller='seller-'+suffix,a='routing-a-'+suffix,b='routing-b-'+suffix;
  const env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}}),app=initializeApp({projectId:'adi-festa-variations-test'},bid),db=getFirestore(app);
  try{
    await db.doc('businesses/'+bid).set({active:true,ownerId:uid,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}});
    for(const [id,role,access]of [[uid,'owner','all'],[seller,'seller','selected']]){
      await db.doc('users/'+id).set({active:true,businessId:bid,role});
      await db.doc('businesses/'+bid+'/members/'+id).set({role,status:'active',spaceAccess:access,allowedSpaceIds:[a],permissions:{'customers.receiveDebt':true,'customers.view':true}});
    }
    for(const id of [a,b])await db.doc('financialSpaces/'+id).set({id,type:'business',linkedBusinessId:bid,businessId:bid,ownerUid:uid,active:true,capabilities:{sales:true,finance:true}});
    const ownerDb=env.authenticatedContext(uid).firestore(),sellerDb=env.authenticatedContext(seller).firestore();
    const value={id:'receipt',businessId:bid,spaceId:a,financialSpaceId:a,workspaceGeneration:0,ownerId:uid,status:'pending_sync',valor:10};
    const doc=(client,id)=>sdk.doc(client,'businesses',bid,'payments',id);
    await assertSucceeds(sdk.setDoc(doc(sellerDb,'receipt'),value));
    await assertFails(sdk.setDoc(doc(sellerDb,'cross-space'),{...value,id:'cross-space',spaceId:b,financialSpaceId:b}));
    await assertFails(sdk.updateDoc(doc(ownerDb,'receipt'),{spaceId:b,financialSpaceId:b}));
    await assertFails(sdk.updateDoc(doc(ownerDb,'receipt'),{financialSpaceId:b}));
    await assertSucceeds(sdk.updateDoc(doc(ownerDb,'receipt'),{observacao:'Allowed metadata'}));
    await assertFails(sdk.setDoc(sdk.doc(ownerDb,'businesses',bid,'financialIncomeRoutes','forged'),{businessId:bid,financialSpaceId:b}));
    // Old unscoped payments stay compatible, but cannot be silently relabelled.
    await db.doc('businesses/'+bid+'/payments/legacy').set({businessId:bid,ownerId:uid,status:'applied',workspaceGeneration:0});
    await assertSucceeds(sdk.updateDoc(doc(ownerDb,'legacy'),{observacao:'Preserved historical receipt'}));
    await assertFails(sdk.updateDoc(doc(ownerDb,'legacy'),{spaceId:a,financialSpaceId:a}));
  }finally{
    await db.recursiveDelete(db.doc('businesses/'+bid));for(const id of [a,b])await db.recursiveDelete(db.doc('financialSpaces/'+id));
    for(const id of [uid,seller])await db.doc('users/'+id).delete();await env.cleanup();await deleteApp(app);
  }
});
