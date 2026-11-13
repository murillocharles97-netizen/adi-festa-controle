'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const {initializeTestEnvironment, assertSucceeds, assertFails} = require('@firebase/rules-unit-testing');
const sdk = require('firebase/firestore');
const {collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, startAfter, updateDoc, where} = sdk;

assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(localhost|127\.0\.0\.1):\d+$/);
const bid = 'renewal-shop', foreign = 'foreign-shop', a = 'shop-a', b = 'shop-b', c = 'shop-c';
const members = [
  ['owner', 'owner', 'selected', [a]],
  ['foreign-owner', 'owner', 'all', []],
  ['manager-all', 'manager', 'all', []],
  ['manager-selected', 'manager', 'selected', [a, b]],
  ['seller-all', 'seller', 'all', []],
  ['seller-selected', 'seller', 'selected', [a]],
  ['seller-restricted', 'seller', 'selected', [a], 3],
  ['seller-inactive', 'seller', 'all', [], 2, 'inactive'],
];
let env;
test.before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-veconi-renewal-scope',
    firestore: {rules: fs.readFileSync(process.env.VECONI_QA_RULES || 'firestore.rules', 'utf8')},
  });
  await env.withSecurityRulesDisabled(async ctx => {
    const db = ctx.firestore();
    const put = (path, data) => setDoc(doc(db, path), data);
    for (const [id, ownerId] of [[bid, 'owner'], [foreign, 'foreign-owner']])
      await put(`businesses/${id}`, {active:true, ownerId, legacyAccessDisabled:true, subscription:{planId:'premium', status:'active'}});
    for (const [uid, role, spaceAccess, allowedSpaceIds, permissionsVersion = 2, status = 'active'] of members) {
      const tenant=uid==='foreign-owner'?foreign:bid;
      await put(`users/${uid}`, {uid, active:true, businessId:tenant, role});
      await put(`businesses/${tenant}/members/${uid}`, {uid, role, status, spaceAccess, allowedSpaceIds, permissionsVersion, permissions:{'sales.create':true}});
    }
    for (const [id, linkedBusinessId, active] of [[a,bid,true], [b,bid,true], [c,bid,true], ['archived',bid,false], ['foreign-space',foreign,true]])
      await put(`financialSpaces/${id}`, {id, linkedBusinessId, type:'business', ownerUid:linkedBusinessId===bid?'owner':'foreign-owner', active,capabilities:{sales:true}});
    for (const [tenant,id,scope,expiresAt] of [
      [bid,'a1',{spaceId:a},'2026-11-20'], [bid,'a2',{spaceId:a},'2026-11-20'],
      [bid,'b1',{spaceId:b},'2026-11-21'], [bid,'c1',{spaceId:c},'2026-11-22'],
      [bid,'legacy',{},'2026-11-23'], [bid,'alias',{financialSpaceId:a},'2026-11-24'],
      [bid,'null-space',{spaceId:null},'2026-11-25'], [bid,'pseudo',{spaceId:'all'},'2026-11-26'],
      [bid,'wrong-binding',{spaceId:'foreign-space'},'2026-11-27'],
      [foreign,'foreign',{spaceId:'foreign-space'},'2026-11-20'],
    ]) {
      const row={businessId:tenant,clientId:'client',productId:'product',status:'active',expiresAt,createdAt:expiresAt,...scope};
      await put(`businesses/${tenant}/customerSubscriptions/${id}`,row);
      await put(`businesses/${tenant}/customerSubscriptionEvents/${id}`,{...row,next:row});
    }
    await put(`businesses/${bid}/clients/client`,{businessId:bid,spaceId:a,active:true});
    await put(`businesses/${bid}/settings/default`,{});
    await put(`businesses/${bid}/members/seller-restricted`,{
      role:'seller',status:'active',spaceAccess:'selected',allowedSpaceIds:[a],permissionsVersion:3,
      permissions:{'sales.create':true,'customers.view':true}
    });
    await put(`financialSpaces/${a}/entries/private`,{ownerUid:'owner'});
  });
});
test.after(async () => env?.cleanup());
const dbFor = uid => env.authenticatedContext(uid).firestore();
const spaceQuery = (db, company) => query(collection(db,'financialSpaces'),
  where('linkedBusinessId','==',company), where('type','==','business'), where('active','==',true), limit(100));
const ids = snapshot => snapshot.docs.map(d => d.id).sort();
const records = (db, name='customerSubscriptions', company=bid) => collection(db,'businesses',company,name);

test('space catalog lists active business metadata for owner and all-space members only', async () => {
  for (const uid of ['owner','manager-all','seller-all']) {
    const db=dbFor(uid);
    assert.deepEqual(ids(await assertSucceeds(getDocs(spaceQuery(db,bid)))),[a,b,c]);
    await assertFails(getDocs(spaceQuery(db,foreign)));
    await assertFails(getDocs(collection(db,'financialSpaces')));
  }
  for (const uid of ['manager-selected','seller-selected']) {
    const db=dbFor(uid);
    await assertSucceeds(getDoc(doc(db,'financialSpaces',a)));
    await assertFails(getDoc(doc(db,'financialSpaces',c)));
    await assertFails(getDocs(spaceQuery(db,bid)));
  }
  await assertFails(getDocs(spaceQuery(dbFor('seller-inactive'),bid)));
  await assertFails(getDoc(doc(dbFor('manager-all'),'financialSpaces',a,'entries','private')));
  const foreignOwner=dbFor('foreign-owner');
  assert.deepEqual(ids(await assertSucceeds(getDocs(spaceQuery(foreignOwner,foreign)))),['foreign-space']);
  await assertFails(getDocs(spaceQuery(foreignOwner,bid)));
});

for (const name of ['customerSubscriptions','customerSubscriptionEvents']) {
  test(`${name}: direct access matches the role, canonical space and company`, async () => {
    for (const [uid, allowed] of [
      ['owner',['a1','b1','c1','legacy','alias','null-space']],
      ['manager-all',['a1','b1','c1']], ['manager-selected',['a1','b1']],
      ['seller-all',['a1','b1','c1']], ['seller-selected',['a1']],
      ['seller-restricted',[]], ['seller-inactive',[]],
    ]) {
      const db=dbFor(uid), ref=records(db,name);
      for (const id of allowed) await assertSucceeds(getDoc(doc(ref,id)));
      for (const id of ['a1','b1','c1','legacy','alias','null-space'].filter(id=>!allowed.includes(id)))
        await assertFails(getDoc(doc(ref,id)));
      if(uid!=='owner')await assertFails(getDoc(doc(ref,'wrong-binding')));
      await assertFails(getDoc(doc(records(db,name,foreign),'foreign')));
    }
  });

  test(`${name}: scoped query pages, rejects unbounded and mixed unauthorized queries`, async () => {
    const owner=dbFor('owner');
    assert.equal((await assertSucceeds(getDocs(records(owner,name)))).size,9);
    const foreignOwner=dbFor('foreign-owner');
    assert.equal((await assertSucceeds(getDocs(records(foreignOwner,name,foreign)))).size,1);
    await assertFails(getDocs(records(foreignOwner,name)));
    for (const [uid,spaceIds,expected] of [
      ['manager-all',[a,b,c],['a1','a2','b1','c1']], ['manager-selected',[a,b],['a1','a2','b1']],
      ['seller-all',[a,b,c],['a1','a2','b1','c1']], ['seller-selected',[a],['a1','a2']],
    ]) {
      const ref=records(dbFor(uid),name), filter=where('spaceId','in',spaceIds), order=orderBy('expiresAt','asc');
      await assertFails(getDocs(query(ref,where('clientId','==','client'))));
      await assertFails(getDocs(query(ref,where('spaceId','==','all'))));
      const observed=[];
      let cursor=null;
      for (;;) {
        const snapshot=await assertSucceeds(getDocs(query(ref,filter,order,limit(1),...(cursor?[startAfter(cursor)]:[]))));
        if (snapshot.empty) break;
        cursor=snapshot.docs[0];
        observed.push(cursor.id);
      }
      assert.deepEqual(observed,expected);
    }
    await assertFails(getDocs(query(records(dbFor('seller-selected'),name),where('spaceId','in',[a,b]))));
    await assertFails(getDocs(query(records(dbFor('seller-selected'),name),where('financialSpaceId','==',a))));
  });
}

test('staff cannot move a foreign subscription into their space to read it',async()=>{
  const ref=records(dbFor('seller-selected'));
  await assertFails(updateDoc(doc(ref,'b1'),{spaceId:a}));
  await assertFails(updateDoc(doc(ref,'legacy'),{spaceId:a}));
  await assertFails(setDoc(doc(ref,'new-foreign'),{businessId:bid,spaceId:b,clientId:'client'}));
});

test('existing authorized subscription writes keep the same policy as the selected Rules base',async()=>{
  const ref=records(dbFor('seller-selected')), mode=process.env.VECONI_QA_RULES?.endsWith('firestore.renewal-space.rules');
  const result=updateDoc(doc(ref,'a1'),{status:'paused'});
  if(mode)await assertSucceeds(result);
  else await assertFails(result);
});

test('the published checkout reader contract returns only canonical renewals for restricted staff',async()=>{
  const {initializeApp,deleteApp}=require('firebase-admin/app');
  const {getFirestore}=require('firebase-admin/firestore');
  const {operationalReadService}=require('../../functions/src/services/operational-read-service');
  const app=initializeApp({projectId:'demo-veconi-renewal-scope'},'renewal-checkout');
  try {
    const service=operationalReadService(getFirestore(app));
    const result=await service.read({auth:{uid:'seller-restricted'},data:{
      businessId:bid,spaceId:a,mode:'customer_context',customerId:'client',purpose:'checkout'
    }});
    assert.deepEqual(result.customerSubscriptions.map(row=>row.id).sort(),['a1','a2']);
    assert.equal(result.client.id,'client');
  } finally {await deleteApp(app);}
});

test('frontend repository pages real Firestore snapshots across groups without losing tied rows',async()=>{
  const vm=require('node:vm'), db=dbFor('manager-all');
  const extraIds=['extra-a','extra-b','extra-c'];
  await env.withSecurityRulesDisabled(async ctx=>{
    const admin=ctx.firestore();
    for(const id of extraIds){
      await setDoc(doc(admin,'financialSpaces',id),{id,linkedBusinessId:bid,type:'business',active:true});
      await setDoc(doc(records(admin),'renewal-'+id),{spaceId:id,businessId:bid,clientId:'client',createdAt:'2026-11-20'});
    }
  });
  const spaceIds=[a,b,c,...extraIds];
  const repository=fs.readFileSync('js/firebase/firestore-repository.js','utf8')
    .replace(/^import\b[\s\S]*?;\r?\n/gm,'').replace(/^export /gm,'');
  const context={...sdk,firebaseQuery:sdk.query,where:(field,op,value)=>sdk.where(field,op,structuredClone(value)),
    db,auth:{currentUser:{uid:'manager-all'}},performance,structuredClone,
    normalizeFirestoreData:x=>x,recordFirestoreOperation:()=>{},
    BusinessContext:{get:()=>({businessId:bid,role:'manager',spaceAccess:'all'}),getCurrentBusinessId:()=>bid},
    SpaceContext:{homeSpaces:()=>[...spaceIds.map(id=>({id,businessId:bid})),{id:'foreign-space',businessId:foreign}]}};
  context.window=context;
  vm.createContext(context);
  vm.runInContext(repository,context);
  const reader=context.createFirestoreRepository('customerSubscriptions'), observed=[];
  let cursor=null;
  do {
    const page=await reader.listPage(cursor,2);
    observed.push(...page.items.map(row=>row.id));
    cursor=page.hasMore?page.cursor:null;
  } while(cursor);
  assert.deepEqual(observed,['c1','b1','renewal-extra-c','renewal-extra-b','renewal-extra-a','a2','a1']);
});
