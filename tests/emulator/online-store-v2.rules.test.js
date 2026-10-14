'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
if(!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Only local emulator allowed');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore');
const {onlineStoreService,storeId}=require('../../functions/src/services/online-store-service');
const {onlineStockReservation}=require('../../functions/src/services/online-stock-reservation');
const suffix=Date.now().toString(36),bid=`store-qa-${suffix}`,uid=`owner-${suffix}`,a=`space-a-${suffix}`,b=`space-b-${suffix}`,member=`manager-${suffix}`,token=`legacytoken${suffix}0000000000`,pid=`product-${suffix}`,projectId='adi-festa-variations-test';
let env,app,db,service;
const request=(data={},who=uid)=>({auth:{uid:who},data:{businessId:bid,spaceId:a,workspaceGeneration:0,...data}});
test('legacy pause is explicit, owner-only, idempotent and preserves data',async()=>{
 const key=`pauselegacy${suffix}0000000000`,ref=db.doc(`publicCatalogs/${key}`),old={businessId:bid,publicName:'QA Legacy Pause',items:[{productId:pid,salePrice:25}],active:true,acceptingOrders:true,closedBehavior:'accept_for_later'};
 await ref.set(old);const data={action:'pause_legacy',legacyToken:key,legacyRevision:require('node:crypto').createHash('sha256').update(JSON.stringify(old)).digest('hex')};
 // Load supplies the authoritative revision (Firestore may reorder properties).
 data.legacyRevision=(await service.load(request())).legacyCatalogs.find(x=>x.token===key).revision;
 await assert.rejects(service.save(request({...data,confirmed:false})),{code:'failed-precondition'});
 await assert.rejects(service.save(request({...data,confirmed:true},member)),{code:'permission-denied'});
 await assert.rejects(service.save(request({...data,confirmed:true,legacyRevision:'stale'})),{code:'aborted'});
 const before=(await ref.get()).data();await service.save(request({...data,confirmed:true}));
 const after=(await ref.get()).data();assert.deepEqual(after.items,before.items);assert.equal(after.active,true);assert.equal(after.publicName,before.publicName);
 assert.equal(after.acceptingOrders,false);assert.equal(after.closedBehavior,'view_only');assert.equal(after.legacyPause.actorUid,uid);
 assert.equal((await db.doc(`catalogStoreBindings/${key}`).get()).exists,false);
 assert.equal((await service.save(request({...data,confirmed:true}))).replayed,true);
 await ref.delete(); // Disposable emulator-only test fixture, never production.
});
test.before(async()=>{env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});app=initializeApp({projectId},`store-${suffix}`);db=getFirestore(app);service=onlineStoreService(db);await db.doc(`businesses/${bid}`).set({ownerId:uid,active:true,workspaceGeneration:0,subscription:{planId:'internal',status:'active'},legacyAccessDisabled:true});for(const [id,role,access]of [[uid,'owner','all'],[member,'manager','selected']]){await db.doc(`users/${id}`).set({active:true,businessId:bid,role});await db.doc(`businesses/${bid}/members/${id}`).set({status:'active',role,spaceAccess:access,allowedSpaceIds:[a],permissions:{'products.edit':true,'products.view':true,'sales.viewAll':true}});}for(const id of [a,b])await db.doc(`financialSpaces/${id}`).set({businessId:bid,linkedBusinessId:bid,active:true,capabilities:{products:true,sales:true}});await db.doc(`businesses/${bid}/products/${pid}`).set({businessId:bid,nome:'QA product',preco:25,custo:8,estoqueAtual:1,spaceAccessMode:'all_spaces',ativo:true});await db.doc(`publicCatalogs/${token}`).set({businessId:bid,publicName:'Loja QA antiga',active:true,items:[{id:'catalog-'+pid,productId:pid,productName:'QA product',salePrice:25,active:true}],acceptingOrders:false});await db.doc(`publicCatalogs/${token}/orders/legacy-order`).set({businessId:bid,customerName:'QA customer',total:25,orderStatus:'recebido'});});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
test('V169 pilot activation is owner-confirmed and load creates nothing',async()=>{
 const space=`pilot-${suffix}`,ref=db.doc(`businesses/${bid}/onlineStores/${storeId(space)}`);
 await db.doc(`financialSpaces/${space}`).set({businessId:bid,linkedBusinessId:bid,active:true,capabilities:{products:true,sales:true}});
 assert.equal((await service.load(request({spaceId:space}))).store,null);
 assert.equal((await ref.get()).exists,false);
 const data={spaceId:space,slug:`pilot-${suffix}`,settings:{publicName:'QA Pilot'},productIds:[]};
 await assert.rejects(service.save(request(data)),{code:'failed-precondition'});
 await assert.rejects(service.save(request({...data,action:'activate',confirmed:false})),{code:'failed-precondition'});
 await assert.rejects(service.save(request({...data,spaceId:a,action:'activate',confirmed:true},member)),{code:'permission-denied'});
 const activated=await service.save(request({...data,action:'activate',confirmed:true}));
 assert.equal(activated.store.v2Enabled,true);assert.equal(activated.store.activation.confirmedBy,uid);
 assert.equal(activated.store.published,false);assert.equal(activated.store.checkoutEnabled,false);
});
test('stale migration review, spoofed cross-business token and explicit legacy aliases are safe',async()=>{
 const alias=`alias${token}`,foreign=`foreign${token}`;
 await db.doc(`publicCatalogs/${alias}`).set({businessId:bid,legacyRedirect:true,universalCatalogToken:token});
 await db.doc(`publicCatalogs/${foreign}`).set({businessId:'another-business',publicName:'Private scope',items:[]});
 await assert.rejects(service.save(request({action:'migrate',legacyToken:foreign,legacyRevision:'fake',confirmed:true,slug:`foreign-${suffix}`})),{code:'permission-denied'});
 await assert.rejects(service.save(request({action:'migrate',legacyToken:token,legacyRevision:'stale',confirmed:true,slug:`stale-${suffix}`})),{code:'aborted'});
 assert.equal((await db.doc(`businesses/${bid}/onlineStores/${storeId(a)}`).get()).exists,false);
 await db.doc(`publicCatalogs/${token}`).update({acceptingOrders:true});
 const activeLegacy=(await service.load(request())).legacyCatalogs.find(c=>c.token===token);
 await assert.rejects(service.save(request({action:'migrate',legacyToken:token,legacyRevision:activeLegacy.revision,confirmed:true,slug:`active-${suffix}`})),{code:'failed-precondition'});
 assert.equal((await db.doc(`catalogStoreBindings/${token}`).get()).exists,false);
 assert.equal((await db.doc(`publicCatalogs/${token}`).get()).data().acceptingOrders,true);
 await db.doc(`publicCatalogs/${token}`).update({acceptingOrders:false});
 const idleLegacy=(await service.load(request())).legacyCatalogs.find(c=>c.token===token);
 await assert.rejects(service.save(request({action:'migrate',legacyToken:token,legacyRevision:idleLegacy.revision,confirmed:true,slug:`open-order-${suffix}`})),{code:'failed-precondition'});
 assert.equal((await db.doc(`publicCatalogs/${token}/orders/legacy-order`).get()).data().orderStatus,'recebido');
 assert.equal((await db.doc(`catalogStoreBindings/${token}`).get()).exists,false);
 // Complete only the synthetic test order; migration must not complete it for the owner.
 await db.doc(`publicCatalogs/${token}/orders/legacy-order`).update({orderStatus:'entregue'});
});
test('save cannot adopt another catalog token and all-space managers cannot read unassigned orders',async()=>{
 const c=`space-c-${suffix}`;await db.doc(`financialSpaces/${c}`).set({businessId:bid,active:true,capabilities:{products:true}});
 const result=await service.save(request({action:'activate',confirmed:true,spaceId:c,legacyToken:token,slug:`qa-c-${suffix}`,settings:{publicName:'C'},productIds:[]}));assert.notEqual(result.store.publicToken,token);
 await db.doc(`businesses/${bid}/members/all-manager`).set({status:'active',role:'manager',spaceAccess:'all',permissions:{'sales.viewAll':true,'products.edit':true}});
 await db.doc(`businesses/${bid}/catalogOrders/missing-space`).set({businessId:bid,total:10});
 await db.doc(`businesses/${bid}/catalogOrders/space-a-order`).set({businessId:bid,spaceId:a,total:10});
 await db.doc(`businesses/${bid}/catalogOrders/space-b-order`).set({businessId:bid,spaceId:b,total:10});
 const mgr=env.authenticatedContext(member).firestore();
 await assertFails(sdk.getDoc(sdk.doc(env.authenticatedContext('all-manager').firestore(),'businesses',bid,'catalogOrders','missing-space')));
 await assertFails(sdk.getDoc(sdk.doc(mgr,'businesses',bid,'catalogOrders','space-b-order')));
 await assertSucceeds(sdk.getDocs(sdk.query(sdk.collection(mgr,'businesses',bid,'catalogOrders'),sdk.where('spaceId','in',[a]))));
});
test('workspace generation fence rejects stale migration before any store write',async()=>{
 await assert.rejects(service.save(request({workspaceGeneration:99,spaceId:b,slug:`stale-epoch-${suffix}`,settings:{publicName:'Never saved'},productIds:[]})),{code:'failed-precondition'});
 assert.equal((await db.doc(`businesses/${bid}/onlineStores/${storeId(b)}`).get()).exists,false);
});
test('migration requires owner confirmation, preserves original catalog/orders, and cannot copy to two spaces',async()=>{const initial=await service.load(request()),legacy=initial.legacyCatalogs.find(x=>x.token===token),data={action:'migrate',legacyToken:token,legacyRevision:legacy.revision,slug:`qa-${suffix}`,confirmed:true};await assert.rejects(service.save(request({...data,confirmed:false})),{code:'failed-precondition'});await assert.rejects(service.save(request(data,member)),{code:'permission-denied'});const before=(await db.doc(`publicCatalogs/${token}`).get()).data();const result=await service.save(request(data));assert.equal(result.store.spaceId,a);assert.equal(result.store.publicToken,token);assert.equal(result.store.migration.status,'completed');assert.deepEqual((await db.doc(`publicCatalogs/${token}`).get()).data(),before);assert.equal((await db.doc(`publicCatalogs/${token}/orders/legacy-order`).get()).data().spaceId,undefined);assert.equal((await service.save(request(data))).replayed,true);await assert.rejects(service.save(request({...data,spaceId:b})),{code:'already-exists'});const state=await service.load(request());assert.equal(state.legacyCatalogs.length,0);assert.equal(state.legacyOrders.length,1);assert.equal((await service.load(request({},member))).legacyOrders.length,0);});
test('A/B settings, slugs, unauthorized spaces and stale revisions are isolated',async()=>{await assert.rejects(service.load(request({spaceId:b},member)),{code:'permission-denied'});await assert.rejects(service.load(request({},'outsider')),{code:'permission-denied'});await assert.rejects(service.save(request({action:'activate',confirmed:true,spaceId:b,slug:`qa-${suffix}`,settings:{publicName:'B'},productIds:[pid]})),{code:'already-exists'});const created=await service.save(request({action:'activate',confirmed:true,spaceId:b,slug:`qa-b-${suffix}`,settings:{publicName:'B',primaryColor:'#ff0000'},productIds:[pid]}));assert.equal(created.store.spaceId,b);assert.notEqual((await service.load(request())).store.catalogSettings.publicName,'B');await assert.rejects(service.save(request({action:'activate',confirmed:true,spaceId:b,revision:0,slug:`qa-b-${suffix}`,settings:{publicName:'Bad'}})),{code:'aborted'});});
test('public publish is sanitized, aliases preserved, client writes fenced and legacy orders private',async()=>{const s=(await service.load(request())).store;await service.save(request({action:'publish',revision:s.revision,slug:`qa-new-${suffix}`,settings:s.catalogSettings,productIds:[pid],published:true}));const p=(await db.doc(`publicCatalogs/${token}`).get()).data();assert.equal(p.spaceId,a);assert.equal(p.acceptingOrders,false);assert.equal(p.items[0].custo,undefined);assert.equal((await db.doc(`publicCatalogSlugs/qa-${suffix}`).get()).data().catalogToken,token);const anon=env.unauthenticatedContext().firestore(),manager=env.authenticatedContext(member).firestore();await assertSucceeds(sdk.getDoc(sdk.doc(anon,'publicCatalogs',token)));await assertFails(sdk.getDoc(sdk.doc(anon,'publicCatalogs',token,'orders','legacy-order')));await assertFails(sdk.getDoc(sdk.doc(manager,'publicCatalogs',token,'orders','legacy-order')));await assertFails(sdk.getDoc(sdk.doc(manager,'businesses',bid,'onlineStores',storeId(b))));await assertFails(sdk.setDoc(sdk.doc(env.authenticatedContext(uid).firestore(),'publicCatalogs',token),{...p,schemaVersion:5}));await assertFails(sdk.setDoc(sdk.doc(manager,'businesses',bid,'onlineStores',storeId(a)),{spaceId:b}));});
test('two simultaneous orders in different stores cannot reserve the same last unit; replay is idempotent',async()=>{const reserve=onlineStockReservation(db).reserve,base={businessId:bid,workspaceGeneration:0,items:[{productId:pid,quantity:1}]};const requests=[{...base,spaceId:a,storeId:storeId(a),operationId:`reserve-a-${suffix}`},{...base,spaceId:b,storeId:storeId(b),operationId:`reserve-b-${suffix}`}];const results=await Promise.allSettled(requests.map(reserve));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);const index=results.findIndex(r=>r.status==='fulfilled');assert.equal((await reserve(requests[index])).replayed,true);await assert.rejects(reserve({...requests[index],items:[{productId:pid,quantity:2}]}),{code:'already-exists'});assert.equal((await db.doc(`businesses/${bid}/products/${pid}`).get()).data().estoqueAtual,1);assert.equal((await db.collection(`businesses/${bid}/sales`).get()).size,0);});
