'use strict';

const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {test,after}=require('node:test');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,getDoc,updateDoc}=require('firebase/firestore');
const {createRequire}=require('node:module');
const adminRequire=createRequire(require.resolve('../../functions/package.json'));
const {initializeApp,deleteApp}=adminRequire('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp}=adminRequire('firebase-admin/firestore');
const {onboardingService}=require('../../functions/src/services/onboarding-service');
const {teamAccessService}=require('../../functions/src/services/team-access-service');
const Policy=require('../../functions/src/shared/permission-policy');

const projectId='demo-veconi-v228-impl';
const address=process.env.FIRESTORE_EMULATOR_HOST;
if(!/^127\.0\.0\.1:\d+$/.test(address||''))throw Error('Local Firestore Emulator required.');
const [host,port]=address.split(':');
const app=initializeApp({projectId});
const db=getFirestore(app);
const deps={FieldValue,Timestamp};
const onboarding=onboardingService(db,{...deps,professionalLimits:{users:8,products:50,clients:50,monthlySales:500}});
const team=teamAccessService(db,{...deps,appUrl:'http://localhost'});
const rules=initializeTestEnvironment({projectId,firestore:{host,port:Number(port)}});
after(async()=>{await (await rules).cleanup();await db.terminate();await deleteApp(app);});
const request=(uid,data={})=>({auth:{uid,token:{email:uid+'@example.invalid'}},data});
const grants={'sales.create':true,'customers.view':true,'products.view':true,'inventory.view':true,'performance.daily':true,'performance.history':false};

async function company({existing=false}={}){
  const uid='owner-'+randomUUID(),bid='biz_'+uid,ref=db.doc('businesses/'+bid);
  const open=()=>onboarding.complete({uid,email:uid+'@example.invalid',input:{ownerName:'QA',businessName:'QA',city:'São Paulo',state:'SP'}});
  await open();
  await ref.update({subscription:{planId:'premium',catalogVersion:2,status:'active'},...(existing?{operationalReadPolicyVersion:FieldValue.delete()}:{})});
  const seller='seller-'+randomUUID();
  const data={businessId:bid,role:'seller',name:'QA',email:seller+'@example.invalid',spaceAccess:'all',permissionsVersion:3,permissions:grants};
  const invite=(overrides={})=>team.createInvite(request(uid,{...data,...overrides}));
  return {uid,bid,ref,open,seller,data,invite};
}

test('new Pro business invites and accepts a restricted seller without releasing management access',async()=>{
  const c=await company();
  assert.equal((await c.ref.get()).data().operationalReadPolicyVersion,1);
  await c.open();
  const result=await c.invite();
  const token=new URL(result.inviteUrl).searchParams.get('teamInvite');
  await assert.rejects(team.acceptInvite(request(c.uid,{token})),{code:'permission-denied'});
  const accepted=await team.acceptInvite(request(c.seller,{token}));
  assert.equal(accepted.businessId,c.bid);
  const member=(await c.ref.collection('members').doc(c.seller).get()).data();
  assert.equal(Policy.has(member,'sales.create'),true);
  for(const key of ['performance.history','billing.manage','team.manage','settings.manage','financial.view','reports.view']){
    assert.equal(Policy.has(member,key),false,key);
  }
  await assert.rejects(team.createInvite(request(c.seller,{...c.data,email:'other@example.invalid'})),{code:'permission-denied'});
  const sale=c.ref.collection('sales').doc('old-sale');
  const charge=c.ref.collection('billingCheckoutAttempts').doc('hidden-attempt');
  await sale.set({businessId:c.bid,spaceId:'qa-space',data:'2020-01-01',valorFinal:10});
  await charge.set({businessId:c.bid});
  const env=await rules;
  const employee=env.authenticatedContext(c.seller).firestore();
  const owner=env.authenticatedContext(c.uid).firestore();
  await assertSucceeds(getDoc(doc(owner,sale.path)));
  await assertFails(getDoc(doc(employee,sale.path)));
  await assertFails(getDoc(doc(employee,charge.path)));
  await assertFails(updateDoc(doc(employee,c.ref.path),{operationalReadPolicyVersion:0}));
});

test('existing business provisions once, atomically, only with owner confirmation',async()=>{
  const c=await company({existing:true});
  await assert.rejects(c.invite(),{code:'failed-precondition'});
  assert.equal((await c.ref.get()).data().operationalReadPolicyVersion,undefined);
  const token=randomUUID();
  await db.doc('publicCatalogs/'+token).set({businessId:c.bid,schemaVersion:6});
  await db.doc('catalogStoreBindings/'+token).set({businessId:c.bid});
  await c.invite({confirmReadPolicyTransition:true});
  await assert.rejects(c.invite(),{code:'already-exists'});
  await c.invite({email:'second@example.invalid'});
  const record=(await c.ref.get()).data();
  assert.equal(record.operationalReadPolicyVersion,1);
  assert.deepEqual(record.subscription,{planId:'premium',catalogVersion:2,status:'active'});
  const logs=await c.ref.collection('auditLogs').where('type','==','operational_read_policy_enabled').get();
  assert.equal(logs.size,1);
  assert.equal((await c.ref.collection('teamInvites').get()).size,2);
});

test('legacy public portal and cross-business requests do not change policy or create invites',async()=>{
  const c=await company({existing:true}),other=await company();
  await db.doc('publicCatalogs/'+randomUUID()).set({businessId:c.bid,active:true});
  await assert.rejects(c.invite({confirmReadPolicyTransition:true}),e=>e.code==='failed-precondition'&&/portal antigo/.test(e.message));
  await assert.rejects(team.createInvite(request(other.uid,{...c.data,confirmReadPolicyTransition:true})),{code:'permission-denied'});
  assert.equal((await c.ref.get()).data().operationalReadPolicyVersion,undefined);
  assert.equal((await c.ref.collection('teamInvites').get()).size,0);
});
