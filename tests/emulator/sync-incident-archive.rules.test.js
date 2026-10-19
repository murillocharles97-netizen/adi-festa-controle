'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
if(!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Local Emulator required');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore,FieldValue}=req('firebase-admin/firestore');
const {syncIncidentService,payloadChecksum}=require('../../functions/src/services/sync-incident-service');
const bid='qa-incident-archive',space=bid+'-space',owner='qa-incident-owner',seller='qa-incident-seller',other='qa-incident-other';
let env,app,db,service;
const ref=(name,id)=>db.doc(`businesses/${bid}/${name}/${id}`);
const packet=(id='qa-incident-main')=>({queueId:id+'-queue',operationId:id,userId:seller,businessId:bid,workspaceGeneration:0,status:'pending',attempts:2,retryCount:2,lastAttemptAt:'2026-10-19T10:21:54.255Z',createdAtLocal:'2026-10-18T17:00:00Z',payload:{eventKind:'simple',writes:[{entityType:'products',entityId:'qa-product',operation:'update',before:{spaceId:space,estoqueAtual:6},data:{custo:0}},{entityType:'sales',entityId:'qa-historical-sale',operation:'update',before:{spaceId:space,valorFinal:10},data:{custoTotal:0,lucro:10}}]}});
const request=(p=packet(),uid=seller)=>{const originalPacketJson=JSON.stringify(p);return{auth:{uid},data:{businessId:bid,workspaceGeneration:0,originalPacketJson,contentHash:crypto.createHash('sha256').update(originalPacketJson).digest('hex'),payloadChecksum:payloadChecksum(p.payload)}};};
const get=(operationId='qa-incident-main',uid=seller,businessId=bid)=>service.get({auth:{uid},data:{businessId,workspaceGeneration:0,operationId}});
async function commercial(){const result={};for(const name of ['sales','products','productVariants','stockMovements','clients','payments','balanceEvents','balanceAdjustments','saleFinancials','financialIncomeRoutes','activityEvents','settings']){const snap=await db.collection(`businesses/${bid}/${name}`).get();result[name]=snap.docs.map(d=>({id:d.id,data:d.data(),updateTime:d.updateTime.toMillis()}));}return result;}
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 app=initializeApp({projectId:'adi-festa-variations-test'},'sync-incident-archive-test');db=getFirestore(app);service=syncIncidentService(db,{FieldValue});
 await db.doc(`businesses/${bid}`).set({ownerId:owner,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
 for(const [uid,role]of [[owner,'owner'],[seller,'seller'],[other,'seller']]){
  await db.doc(`users/${uid}`).set({uid,role,businessId:bid,active:true});
  await ref('members',uid).set({uid,role,status:'active',spaceAccess:uid===owner?'all':'selected',allowedSpaceIds:[uid===other?'qa-other-space':space],permissions:{'sales.create':false,'products.view':true,'inventory.view':true,'financial.view':false,'cost.view':false,'profit.view':false,'team.manage':false,'settings.manage':false}});
 }
 await db.doc(`financialSpaces/${space}`).set({id:space,businessId:bid,linkedBusinessId:bid,ownerUid:owner,type:'business',active:true,capabilities:{finance:false,sales:true,products:true,inventory:true}});
 await ref('products','qa-product').set({id:'qa-product',businessId:bid,spaceAccessMode:'selected_spaces',allowedSpaceIds:[space],defaultSpaceId:space,spaceScopeVersion:1,estoqueAtual:6,estoque:6,totalStock:6});
 await ref('sales','qa-historical-sale').set({id:'qa-historical-sale',businessId:bid,spaceId:space,actorUid:owner,status:'pago',valorFinal:10,updatedAt:'2026-10-18T00:00:00Z'});
 await ref('clients','qa-client').set({businessId:bid,saldo:-10});
 await ref('saleFinancials','preserved-history').set({amount:25});
});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
test('authenticated archival creates only evidence + immutable fence, with zero commercial writes and no sales/finance permission',async()=>{
 const before=await commercial(),r=request(),result=await service.archive(r);
 assert.equal(result.status,'archived');assert.equal(result.archivedBy,seller);assert.equal(result.commercialEffectsApplied,false);
 assert.deepEqual(await commercial(),before);
 const raw=await ref('syncIncidentArchives',r.data.operationId||'qa-incident-main').collection('original').doc('packet').get();assert.equal(raw.data().originalPacketJson,r.data.originalPacketJson);
 const marker=(await ref('processedOperations','qa-incident-main').get()).data();assert.equal(marker.status,'archived_without_effects');assert.equal(marker.contentHash,r.data.contentHash);
 assert.equal((await get()).payloadChecksum,r.data.payloadChecksum);
});
test('duplicate, two concurrent submissions and lost-response retry return one original receipt without rewriting timestamps',async()=>{
 const p=packet('qa-incident-concurrent'),r=request(p),before=await commercial();
 const values=await Promise.all([service.archive(r),service.archive(r),service.archive(r)]);assert.deepEqual(values[0],values[1]);assert.deepEqual(values[1],values[2]);
 const first=await ref('syncIncidentArchives',p.operationId).get();assert.deepEqual(await service.archive(r),values[0]);const again=await ref('syncIncidentArchives',p.operationId).get();assert.equal(again.updateTime.toMillis(),first.updateTime.toMillis());assert.deepEqual(await commercial(),before);
});
test('changed packet/checksum rejects conflict and original immutable evidence remains byte-identical',async()=>{
 const original=(await ref('syncIncidentArchives','qa-incident-main').collection('original').doc('packet').get()).data();
 const p=packet();p.payload.writes[0].data.custo=123;await assert.rejects(service.archive(request(p)),{code:'already-exists'});
 const bad=request(packet('qa-invalid-checksum'));bad.data.payloadChecksum='fnv1a:00000000';await assert.rejects(service.archive(bad),{code:'invalid-argument'});
 assert.deepEqual((await ref('syncIncidentArchives','qa-incident-main').collection('original').doc('packet').get()).data(),original);
});
test('auth, tenant, actor, active membership, generation and space remain mandatory',async()=>{
 const r=request(packet('qa-denied'));await assert.rejects(service.archive({...r,auth:null}),{code:'unauthenticated'});
 await assert.rejects(service.archive({...r,auth:{uid:owner}}),{code:'permission-denied'});
 await assert.rejects(service.archive({...r,data:{...r.data,businessId:'qa-foreign'}}),{code:'invalid-argument'});
 await assert.rejects(service.archive({...r,data:{...r.data,workspaceGeneration:9}}));
 const p=packet('qa-foreign-space');p.payload.writes[0].before.spaceId='qa-other-space';await assert.rejects(service.archive(request(p)),{code:'permission-denied'});
 await ref('members',seller).update({status:'inactive'});try{await assert.rejects(service.archive(r),{code:'permission-denied'});}finally{await ref('members',seller).update({status:'active'});}
 assert.equal((await ref('processedOperations','qa-denied').get()).exists,false);
});
test('ordinary pending or genuine denied sales cannot be silently classified or archived',async()=>{
 const p=packet('qa-legitimate');p.payload={eventKind:'sale',writes:[{entityType:'sales',entityId:'qa-real-new',operation:'create',data:{businessId:bid,spaceId:space,actorUid:seller,valorFinal:10}}]};p.status='error';p.lastErrorCode='permission-denied';
 await assert.rejects(service.archive(request(p)),{code:'failed-precondition'});assert.equal((await ref('syncIncidentArchives',p.operationId).get()).exists,false);
});
test('existing processed marker or orphan remote effect stops archival; no evidence falsely says without effects',async()=>{
 const p=packet('qa-already-processed');await ref('processedOperations',p.operationId).set({status:'processed'});await assert.rejects(service.archive(request(p)),{code:'failed-precondition'});
 const partial=packet('qa-partial-effect');await ref('stockMovements','qa-existing-movement').set({operationId:partial.operationId,businessId:bid,spaceId:space,quantidade:-1});await assert.rejects(service.archive(request(partial)),{code:'failed-precondition'});
 assert.equal((await ref('syncIncidentArchives',partial.operationId).get()).exists,false);
});
test('explicit future quarantine is supported but existing commercial create refuses archival',async()=>{
 const p=packet('qa-explicit');p.status='quarantined';p.payload={eventKind:'sale',writes:[{entityType:'sales',entityId:'qa-never-created',operation:'create',data:{operationId:p.operationId,businessId:bid,spaceId:space,actorUid:seller,valorFinal:10}}]};const before=await commercial();assert.equal((await service.archive(request(p))).status,'archived');assert.deepEqual(await commercial(),before);
 const conflict=packet('qa-explicit-conflict');conflict.status='quarantined';conflict.payload={eventKind:'sale',writes:[{entityType:'sales',entityId:'qa-historical-sale',operation:'create',data:{businessId:bid,spaceId:space,actorUid:seller}}]};await assert.rejects(service.archive(request(conflict)),{code:'failed-precondition'});
});
test('archive/raw are inaccessible and immutable to direct clients, including owner; scoped callable returns receipt only',async()=>{
 for(const uid of [seller,owner,other]){const client=env.authenticatedContext(uid).firestore(),r=sdk.doc(client,'businesses',bid,'syncIncidentArchives','qa-incident-main');await assertFails(sdk.getDoc(r));await assertFails(sdk.setDoc(r,{status:'archived'}));await assertFails(sdk.deleteDoc(r));await assertFails(sdk.getDoc(sdk.doc(r,'original','packet')));}
 const own=await get('qa-incident-main',owner);assert.equal(own.actorUid,seller);assert.equal('originalPacketJson' in own,false);assert.equal('payload' in own,false);
 await assert.rejects(get('qa-incident-main',other),{code:'permission-denied'});await assert.rejects(get('qa-incident-main',seller,'qa-foreign'),{code:'permission-denied'});
});
test('persistent fence rejects old/manual direct replay, even owner; legitimate different operation still permitted',async()=>{
 const client=env.authenticatedContext(owner).firestore(),base={id:'qa-blocked-replay',businessId:bid,spaceId:space,actorUid:owner,formaPagamento:'dinheiro',status:'pago',valorFinal:10,operationId:'qa-incident-main'};
 await assertFails(sdk.setDoc(sdk.doc(client,'businesses',bid,'sales',base.id),base));
 const marker=sdk.doc(client,'businesses',bid,'processedOperations','qa-incident-main');await assertFails(sdk.deleteDoc(marker));await assertFails(sdk.updateDoc(marker,{status:'processed'}));
 await sdk.setDoc(sdk.doc(client,'businesses',bid,'sales','qa-legitimate-new'),{...base,id:'qa-legitimate-new',operationId:'qa-legitimate-new-op'});
 assert.equal((await ref('products','qa-product').get()).data().estoqueAtual,6);
});
test('new collections have no commercial trigger, and originals/markers have no client deletion path',()=>{
 const src=fs.readFileSync('functions/src/index.js','utf8');for(const match of src.matchAll(/document:\s*['"]([^'"]+)['"]/g))assert.doesNotMatch(match[1],/syncIncidentArchives|processedOperations/);
 assert.doesNotMatch(fs.readFileSync('functions/src/services/sync-incident-service.js','utf8'),/require\(['"].*(?:financial-income|sale-recovery-decision|online-order-service)/);
});
