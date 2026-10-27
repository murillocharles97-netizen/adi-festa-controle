'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),{createRequire}=require('node:module'),path=require('node:path');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore'),req=createRequire(path.resolve('functions/package.json')),{initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore}=req('firebase-admin/firestore'),{operationalCommitService}=require('../../functions/src/services/operational-commit-service'),{serverMethods}=require('../helpers/product-action-server-v209.cjs'),create=require('../../js/product-actions');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Emulator only');
let app,db,tests,service,sequence=0;
test.before(async()=>{tests=await initializeTestEnvironment({projectId:'demo-veconi-v209',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});app=initializeApp({projectId:'demo-veconi-v209'},'v209');db=getFirestore(app);service=operationalCommitService(db);});
test.after(async()=>{await tests?.cleanup();await deleteApp(app);});
async function setup({seller=false,permission=true}={}){
 const bid='qa-v209-'+(++sequence),owner='owner-'+sequence,uid=seller?'seller-'+sequence:owner,root=db.doc('businesses/'+bid),space=bid+'-space',other=bid+'-other',archived=bid+'-archived';
 await root.set({businessId:bid,ownerId:owner,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
 for(const [id,role]of [[owner,'owner'],['seller-'+sequence,'seller']]){await db.doc('users/'+id).set({uid:id,businessId:bid,active:true,role});await root.collection('members').doc(id).set({uid:id,role,status:'active',spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[space],permissions:{'products.view':true,'products.edit':permission,'financial.view':false,'cost.view':false,'profit.view':false}});}
 for(const id of [space,other,archived])await db.doc('financialSpaces/'+id).set({id,businessId:bid,linkedBusinessId:bid,ownerUid:owner,active:id!==archived,status:id===archived?'archived':'active',type:'business',capabilities:{products:true,inventory:true}});
 const local=Array.from({length:9},(_,n)=>({id:'p'+n,nome:'Produto fictício '+n,businessId:bid,workspaceGeneration:0,spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space,active:true,ativo:true,estoqueAtual:7,estoque:7,totalStock:7}));for(const p of local)await root.collection('products').doc(p.id).set(p);
 const historic={id:'history',businessId:bid,spaceId:space,immutable:true};for(const col of ['sales','stockMovements','payments','exchangeCredits'])await root.collection(col).doc('history').set(historic);
 const browser=tests.authenticatedContext(uid).firestore(),values=new Map(),queue=[],writes=[],spaceReads=[],origin={uid,businessId:bid,workspaceGeneration:0};let inFlight=Promise.resolve();
 const repo=serverMethods({sdk,db:browser,root:root.path,timed:(type,label,fn)=>{if(label==='products:action-space')spaceReads.push(label);return fn();}});
 const env={navigator:{onLine:true},Utils:{uuid:crypto.randomUUID},setTimeout:fn=>setTimeout(fn,1),FirebaseSession:{user:{uid}},BusinessContext:{get:()=>({businessId:bid,role:seller?'seller':'owner',spaceAccess:seller?'selected':'all',allowedSpaceIds:[space],access:{canMutate:true}})},TeamAccess:{has:()=>permission,operationalReadScopeKey:()=> 'qa'},SpaceContext:{homeId:()=>other,homeSpaces:()=>[]},WorkspaceRuntime:{capture:()=>origin},Produtos:{obter:id=>local.find(p=>p.id===id)},FirestoreRepositories:{products:repo},SyncFirebase:{getQueueDiagnostics:()=>queue}};
 env.DB={__firebaseSyncWrapped:true,getBusinessId:()=>bid,getPrincipal:()=>uid,getWorkspaceGeneration:()=>0,businessCache:{keyValue:{getItem:k=>values.get(k),setItem:(k,v)=>values.set(k,v)}},alterar:fn=>{const before=structuredClone(local);fn({produtos:local});for(const p of local)if(JSON.stringify(p)!==JSON.stringify(before.find(x=>x.id===p.id))){const old=before.find(x=>x.id===p.id),data=Object.fromEntries(Object.entries(p).filter(([k,v])=>JSON.stringify(v)!==JSON.stringify(old[k]))),packet={businessId:bid,userId:uid,workspaceGeneration:0,operationId:p.operationId,syncProtocolVersion:1,clientRelease:209,payload:{eventKind:'simple',writes:[{entityType:'products',entityId:p.id,operation:'update',before:old,data}]}};writes.push(packet);queue.push({operationId:packet.operationId,status:'pending',paths:[root.path+'/products/'+p.id]});inFlight=inFlight.then(()=>service.commit({auth:{uid},data:{businessId:bid,item:packet}}));}},flush:()=>inFlight};
 return{api:create(env),env,root,bid,uid,space,other,archived,local,writes,queue,browser,repo,spaceReads,async set(id,patch){Object.assign(local.find(p=>p.id===id),patch);await root.collection('products').doc(id).set(patch,{merge:true});},async count(col){return(await root.collection(col).get()).size;}};
}
test('owner: nine products in another Home space, real authenticated preflight and logical batch; stock/history/finance preserved',async()=>{
 const c=await setup(),ids=c.local.map(p=>p.id),plan=await c.api.preflight(ids);assert.equal(plan.eligibleIds.length,9);assert.equal(await c.count('processedOperations'),0);assert.equal(c.writes.length,0);
 const result=await c.api.batch(ids,'delete');assert.equal(result.filter(r=>r.status==='confirmed').length,9);assert.equal(c.writes.length,9);assert.equal(await c.count('processedOperations'),9);assert.equal(await c.count('products'),9);
 for(const p of (await c.root.collection('products').get()).docs){assert.equal(p.data().estoqueAtual,7);assert.equal(p.data().active,false);assert.ok(p.data().catalogAction.operationId);}
 for(const col of ['sales','stockMovements','payments','exchangeCredits'])assert.equal(await c.count(col),1);
 for(const packet of c.writes)assert.equal((await service.commit({auth:{uid:c.uid},data:{businessId:c.bid,item:packet}})).replayed,true);assert.equal(await c.count('processedOperations'),9);
});
test('owner active legacy allowed; unreadable archived, missing, conflicting and unscoped legacy require regularization',async()=>{
 const c=await setup();await c.set('p0',{spaceAccessMode:null,spaceId:c.archived});await c.set('p1',{allowedSpaceIds:['missing'],defaultSpaceId:'missing'});await c.set('p2',{spaceId:'conflict'});await c.set('p3',{spaceAccessMode:null});
 await c.set('p4',{spaceAccessMode:null,spaceId:c.space});
 const plan=await c.api.preflight(['p0','p1','p2','p3','p4']);assert.deepEqual(Array.from(plan.items,r=>r.status),['regularization','regularization','regularization','regularization','ready']);assert.equal(c.writes.length,0);assert.equal((await c.api.perform('p4','archive')).status,'confirmed');assert.equal(await c.count('processedOperations'),1);
});
test('seller restricted: shared catalog allowed only via own authorized space, no Financeiro and no cross-space write',async()=>{
 const c=await setup({seller:true});await c.set('p0',{spaceAccessMode:'selected_spaces',allowedSpaceIds:[c.space,c.other]});await c.set('p1',{allowedSpaceIds:[c.other],defaultSpaceId:c.other});
 const plan=await c.api.preflight(['p0','p1']);assert.deepEqual(Array.from(plan.items,r=>r.status),['ready','forbidden']);assert.equal((await c.api.perform('p0','archive')).status,'confirmed');assert.equal(await c.count('processedOperations'),1);
 await assertFails(sdk.getDocs(sdk.collection(c.browser,c.root.path+'/payments')));await assertFails(sdk.getDocs(sdk.collection(c.browser,c.root.path+'/productFinancials')));assert.equal((await c.root.collection('products').doc('p1').get()).data().active,true);
});
test('permission and generation failures do not stage an operation or change canonical records',async()=>{
 const c=await setup({seller:true,permission:false});await assert.rejects(c.api.preflight(['p0']),{code:'permission-denied'});assert.equal(c.writes.length,0);
 const b=await setup();await b.set('p0',{workspaceGeneration:1});assert.equal((await b.api.preflight(['p0'])).items[0].status,'forbidden');assert.equal(await b.count('processedOperations'),0);
});
