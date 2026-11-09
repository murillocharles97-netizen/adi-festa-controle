'use strict';

const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {test,after}=require('node:test');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,getDoc,getDocs,collection,query,where,limit,updateDoc}=require('firebase/firestore');
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
const rules=initializeTestEnvironment({projectId,firestore:{host,port:Number(port),rules:readFileSync('firestore.v228.rules','utf8')}});
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

test('all-space sellers list current and future spaces without access to financial history or another business',async()=>{
  const c=await company(),other=await company(),env=await rules;
  const base={type:'business',linkedBusinessId:c.bid,businessId:c.bid,active:true,status:'active',ownerUid:c.uid,globalSpaceSchemaVersion:1,capabilities:{sales:true,products:true,inventory:true}};
  const first='space-'+randomUUID(),second='space-'+randomUUID(),future='space-'+randomUUID();
  await db.doc('financialSpaces/'+first).set({...base,id:first,name:'Primeiro'});
  const allInvite=await c.invite();
  await team.acceptInvite(request(c.seller,{token:new URL(allInvite.inviteUrl).searchParams.get('teamInvite')}));
  const selectedUid='selected-'+randomUUID();
  const selectedInvite=await c.invite({email:selectedUid+'@example.invalid',spaceAccess:'selected',allowedSpaceIds:[first]});
  await team.acceptInvite(request(selectedUid,{token:new URL(selectedInvite.inviteUrl).searchParams.get('teamInvite')}));
  const all=env.authenticatedContext(c.seller).firestore(),selected=env.authenticatedContext(selectedUid).firestore();
  const listing=client=>getDocs(query(collection(client,'financialSpaces'),where('linkedBusinessId','==',c.bid),where('type','==','business'),where('active','==',true),limit(150)));
  assert.equal((await assertSucceeds(listing(all))).size,1);
  await assertSucceeds(getDoc(doc(selected,'financialSpaces',first)));
  await db.doc('financialSpaces/'+second).set({...base,id:second,name:'Segundo'});
  assert.equal((await assertSucceeds(listing(all))).size,2);
  await assertFails(getDoc(doc(selected,'financialSpaces',second)));
  await assertFails(listing(selected));
  await db.doc('financialSpaces/'+future).set({...base,id:future,name:'Futuro'});
  assert.equal((await assertSucceeds(listing(all))).size,3);
  await assertFails(getDoc(doc(selected,'financialSpaces',future)));
  await assertFails(listing(env.unauthenticatedContext().firestore()));
  const loggedAgain=env.authenticatedContext(c.seller).firestore();
  assert.equal((await assertSucceeds(listing(loggedAgain))).size,3);
  const foreign='space-'+randomUUID();
  await db.doc('financialSpaces/'+foreign).set({...base,id:foreign,businessId:other.bid,linkedBusinessId:other.bid,ownerUid:other.uid});
  await assertFails(getDoc(doc(all,'financialSpaces',foreign)));
  await assertFails(getDocs(query(collection(all,'financialSpaces'),where('linkedBusinessId','==',other.bid),where('type','==','business'),where('active','==',true))));
  await assertFails(getDocs(collection(all,'financialSpaces')));
  const entry=db.doc('financialSpaces/'+first+'/financialAccounts/old');
  await entry.set({businessId:c.bid,valor:100});
  await assertFails(getDoc(doc(all,entry.path)));
  await assertFails(updateDoc(doc(all,'financialSpaces',first),{name:'Não permitido'}));
  await c.ref.collection('members').doc(c.seller).update({status:'disabled'});
  await assertFails(listing(all));
});

test('V228 Rules only add the business space metadata listing already authorized by direct reads',()=>{
  const prior=readFileSync('firestore.v227.rules','utf8').replaceAll('\r\n','\n');
  const candidate=readFileSync('firestore.v228.rules','utf8').replaceAll('\r\n','\n');
  const addition=`            // All-space members may list business space metadata. A list cannot
            // prove the wildcard ID checks required by canAccessSpace.
            || (activeMember(resource.data.linkedBusinessId)
              && activeBusiness(resource.data.linkedBusinessId)
              && teamMember(resource.data.linkedBusinessId).get('spaceAccess','selected') == 'all')
`;
  assert.ok(candidate.includes(addition));
  assert.equal(candidate.replace(addition,''),prior);
});
