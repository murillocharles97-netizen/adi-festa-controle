'use strict';
// Real SDK/Auth/callable/repository. Refuses to run outside loopback demo Emulators.
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict'),crypto=require('node:crypto'),path=require('node:path'),{createRequire}=require('node:module');
const root=path.resolve(__dirname,'../..'),req=createRequire(root+'/package.json'),adminReq=createRequire(root+'/functions/package.json');
const pid='demo-veconi-v202-authenticated',bid='qa-v204-read-hydration',sid='qa-v204-space',other='qa-v204-other';
assert.equal(process.env.FIRESTORE_EMULATOR_HOST,'127.0.0.1:8198');
assert.equal(process.env.FIREBASE_AUTH_EMULATOR_HOST,'127.0.0.1:9098');
assert.equal(process.env.GCLOUD_PROJECT,pid);
const appSdk=req('firebase/app'),authSdk=req('firebase/auth'),fnSdk=req('firebase/functions'),sdk=req('firebase/firestore');sdk.setLogLevel('silent');
const {initializeApp,deleteApp}=adminReq('firebase-admin/app'),{getFirestore}=adminReq('firebase-admin/firestore');
const admin=initializeApp({projectId:pid},'read-v204'),db=getFirestore(admin),actors=[],results=[];
const source=fs.readFileSync(root+'/js/firebase/sync.js','utf8'),bridge=source.slice(source.indexOf('let verifiedProtocolSession='),source.indexOf('async function verifySaleQueueCommit('));
const {harness}=req('./tests/helpers/fiado-cancellation-harness.cjs'),{receiver}=req('./tests/helpers/read-hydration-v204.cjs');
const minimal={'sales.create':true,'customers.view':true,'products.view':true,'inventory.view':true,'financial.view':false,'cost.view':false,'profit.view':false,'settings.manage':false};
const plain=x=>JSON.parse(JSON.stringify(x)),child=(col,id)=>db.doc(`businesses/${bid}/${col}/${id}`),read=async(col,id)=>(await child(col,id).get()).data();
async function result(name,fn){await fn();results.push({scenario:name,result:'APPROVED'});console.log('APPROVED '+name);}
async function actor(role){
 const app=appSdk.initializeApp({apiKey:'emulator-key',projectId:pid},'v204-'+role),auth=authSdk.getAuth(app),f=fnSdk.getFunctions(app,'southamerica-east1'),clientDb=sdk.getFirestore(app);
 authSdk.connectAuthEmulator(auth,'http://127.0.0.1:9098',{disableWarnings:true});fnSdk.connectFunctionsEmulator(f,'127.0.0.1',5098);sdk.connectFirestoreEmulator(clientDb,'127.0.0.1',8198);
 const password=crypto.randomBytes(20).toString('hex')+'!a2Z',email=`v204-${role}@example.test`,credential=await authSdk.createUserWithEmailAndPassword(auth,email,password),uid=credential.user.uid;
 const call=(name,data)=>fnSdk.httpsCallable(f,name)(plain(data)),c={window:{AdiFestaBuild:{release:'204'},WorkspaceRuntime:{capture:()=>({uid,businessId:bid,workspaceGeneration:0})},FirebaseCallable:call},state:{},currentUser:credential.user,auth,syncSessionGeneration:1,activeBusinessId:()=>bid,DB:{getWorkspaceGeneration:()=>0},now:()=>new Date().toISOString(),queuePreflight:()=>({ok:true}),canWriteSharedSettings:()=>false,stableLegacyOperationId:x=>x.operationId,errorCode:e=>String(e.code||'').replace(/^functions\//,''),Error,Number,JSON};
 vm.createContext(c);vm.runInContext(bridge,c);const a={app,auth,clientDb,call,c,role,uid,email,password};actors.push(a);return a;
}
async function fixture(a,kind){
 const h=harness({businessId:bid,spaceId:sid,uid:a.uid}),suffix=a.role+'-'+kind,productId='qa-product-'+suffix,clientId='qa-client-'+suffix;
 h.data().produtos[0].id=productId;h.data().clientes[0].id=clientId;
 await child('products',productId).set(plain(h.data().produtos[0]));await child('clients',clientId).set(plain(h.data().clientes[0]));
 const before=structuredClone(h.data()),sale=h.c.Vendas.registrar({id:'qa-sale-'+suffix,operationId:crypto.randomUUID(),businessId:bid,spaceId:sid,clienteId:clientId,status:kind==='fiado'?'fiado':'pago',formaPagamento:kind==='fiado'?'fiado':'dinheiro',itens:[{produtoId:productId,nome:'Produto fictício QA',quantidade:1,precoOriginal:14,precoFinalUnitario:14}]}),packet={operationId:sale.operationId,businessId:bid,userId:a.uid,workspaceGeneration:0,syncProtocolVersion:1,clientRelease:204,status:'pending',attempts:0,payloadVersion:4,payload:plain({eventKind:'sale',writes:h.c.diffWrites(before,h.data())})};
 packet.checksum=crypto.createHash('sha256').update(JSON.stringify(packet.payload)).digest('hex');return{packet,sale,productId,clientId};
}
async function repo(a){
 const normalize=(await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync(root+'/js/firebase/firestore-utils.js','utf8')))).normalizeFirestoreData;
 const context={businessId:bid,role:a.role,userProfile:{uid:a.uid,businessId:bid},permissionSignature:a.role,permissions:a.role==='owner'?['*']:Object.keys(minimal).filter(k=>minimal[k]),spaceAccess:a.role==='owner'?'all':'selected',allowedSpaceIds:[sid]};
 const s={...sdk,console,Date,structuredClone,performance,auth:a.auth,db:a.clientDb,firebaseQuery:sdk.query,normalizeFirestoreData:normalize,BusinessContext:{get:()=>context,getCurrentBusinessId:()=>bid},FirebaseSession:{profile:{businessId:bid},user:{uid:a.uid}},document:{querySelectorAll:()=>[],documentElement:{dataset:{}}},addEventListener(){},queueMicrotask(){},recordFirestoreOperation(){},listenerOpened(){},listenerClosed(){}};
 s.window=s;vm.createContext(s);vm.runInContext(fs.readFileSync(root+'/js/team-access.js','utf8'),s);
 vm.runInContext(fs.readFileSync(root+'/js/firebase/firestore-repository.js','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\r?\n/gm,'').replaceAll('export ','')+'\nwindow.repo=createFirestoreRepository;',s);return s.repo('sales');
}
async function main(){
 const owner=await actor('owner'),seller=await actor('seller');
 await db.doc('businesses/'+bid).set({active:true,ownerId:owner.uid,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
 for(const a of actors){await db.doc('users/'+a.uid).set({uid:a.uid,businessId:bid,role:a.role,active:true});await child('members',a.uid).set({uid:a.uid,role:a.role,status:'active',permissions:a.role==='seller'?minimal:{},spaceAccess:a.role==='seller'?'selected':'all',allowedSpaceIds:a.role==='seller'?[sid]:[]});}
 for(const id of [sid,other])await db.doc('financialSpaces/'+id).set({id,businessId:bid,linkedBusinessId:bid,ownerUid:owner.uid,active:true,type:'business',capabilities:{sales:true,products:true,inventory:true,finance:false}});
 for(const a of actors)await result(a.role+' authenticated protocol 1, read-only handshake',async()=>{assert.equal((await a.call('getOperationalSyncReceipt',{businessId:bid,workspaceGeneration:0,kind:'sync_protocol'})).data.protocolVersion,1);});
 for(const a of actors)for(const kind of ['pago','fiado']){
  const f=await fixture(a,kind),original=JSON.stringify(f.packet);
  // Exactly the stale merge that caused the production invalidation bug.
  await child('syncMetadata','last-sync').set({businessId:bid,sourceSessionId:'qa-owner-session',sourceDeviceId:'qa-old-device',ownerId:owner.uid},{merge:true});
  await result(`${a.role}/${kind}: server origin, lost reply, retry and concurrent duplicate have one effect`,async()=>{
   let lost=true;a.c.window.FirebaseCallable=async(name,data)=>{const r=await a.call(name,data);if(name==='commitOperationalSync'&&lost){lost=false;throw Object.assign(Error('QA lost reply after commit'),{code:'functions/unavailable'});}return r;};
   await assert.rejects(a.c.commitQueueItem(f.packet),{code:'unavailable'});
   const signal=await read('syncMetadata','last-sync');assert.equal(signal.publisher,'operational_server');assert.equal(signal.revision,'server:'+f.packet.operationId);assert.equal(signal.sourceSessionId,'server:'+f.packet.operationId);assert.equal(signal.sourceOperationId,f.packet.operationId);assert.equal(signal.ownerId,a.uid);assert.equal(signal.actorUid,a.uid);assert.equal(signal.sourceUid,a.uid);assert.equal(signal.sourceDeviceId,undefined);
   const h=receiver({role:'owner',businessId:bid});h.receive(signal);await h.run();assert.equal(h.pulls.length,1);
   a.c.window.FirebaseCallable=a.call;await Promise.all([a.c.commitQueueItem(f.packet),a.c.commitQueueItem(f.packet)]);
   assert.equal(JSON.stringify(f.packet),original);assert.equal((await read('products',f.productId)).estoqueAtual,2);assert.equal((await read('clients',f.clientId)).saldo,kind==='fiado'?-26:-12);
   assert.equal((await child('stockMovements','unused').get()).exists,false);assert.equal((await db.collection(`businesses/${bid}/stockMovements`).where('operationId','==',f.packet.operationId).get()).size,1);
   assert.equal((await read('processedOperations',f.packet.operationId)).authorizationVersion,1);
   const visible=await sdk.getDoc(sdk.doc(owner.clientDb,`businesses/${bid}/sales/${f.sale.id}`));assert.equal(visible.data().operationId,f.packet.operationId);
  });
 }
 await result('owner/seller current repository sees identical store sales and total after reload',async()=>{for(const a of [owner,seller,seller,owner]){const rows=await(await repo(a)).listChangedSince('2026-10-25T00:00:00Z',2);assert.equal(rows.length,4);assert.equal(rows.reduce((sum,s)=>sum+s.valorFinal,0),56);}});
 await result('seller financial/cost/profit reads and foreign-space sale remain denied',async()=>{
  for(const col of ['payments','balanceEvents','productFinancials','saleFinancials']){await child(col,'qa-private').set({businessId:bid,spaceId:sid,amount:14,custo:7,lucro:7});await assert.rejects(sdk.getDoc(sdk.doc(seller.clientDb,`businesses/${bid}/${col}/qa-private`)),{code:'permission-denied'});}
  await child('sales','qa-foreign').set({businessId:bid,spaceId:other,actorUid:owner.uid,status:'pago',valorFinal:1,updatedAt:new Date()});await assert.rejects(sdk.getDoc(sdk.doc(seller.clientDb,`businesses/${bid}/sales/qa-foreign`)),{code:'permission-denied'});
 });
 await result('authorized receipt and held original cannot be replayed after seller relogin',async()=>{
  await authSdk.signOut(seller.auth);await authSdk.signInWithEmailAndPassword(seller.auth,seller.email,seller.password);seller.c.currentUser=seller.auth.currentUser;seller.c.syncSessionGeneration++;
  const f=await fixture(seller,'held'),p={...f.packet,status:'quarantined'};
  await assert.rejects(seller.call('commitOperationalSync',{businessId:bid,syncProtocolVersion:1,clientRelease:204,item:p}),e=>e.code==='functions/failed-precondition');assert.equal((await child('processedOperations',p.operationId).get()).exists,false);
  assert.equal((await db.collection(`businesses/${bid}/processedOperations`).get()).size,4);assert.equal((await db.collection(`businesses/${bid}/stockMovements`).get()).size,4);
 });
 const tied=new Date('2026-10-25T23:59:00Z');
 for(let n=0;n<1001;n+=500){const batch=db.batch();for(let i=n;i<Math.min(n+500,1001);i++)batch.set(child('sales','qa-tie-'+String(i).padStart(4,'0')),{businessId:bid,spaceId:sid,actorUid:owner.uid,status:'pago',valorFinal:1,updatedAt:tied,createdAt:tied});await batch.commit();}
 for(const a of actors)await result(a.role+' real SDK DocumentSnapshot cursor reads all 1001 identical timestamps, no omissions/duplicates',async()=>{const rows=await(await repo(a)).listChangedSince(tied.toISOString(),500);assert.equal(rows.length,1001);assert.equal(new Set(rows.map(s=>s.id)).size,1001);});
 const report={at:new Date().toISOString(),environment:'loopback_auth_functions_firestore_emulators',results,passed:results.length,commercialSales:4,stockMovements:4,processedReceipts:4,pagingOnlyFixtures:1001,duplicates:0,productionWrites:0};
 if(process.env.V204_QA_REPORT)fs.writeFileSync(process.env.V204_QA_REPORT,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 console.log(JSON.stringify(report));
}
main().catch(e=>{console.error(JSON.stringify({failed:true,message:e.message,code:e.code}));process.exitCode=1;}).finally(async()=>{await Promise.all(actors.map(async a=>{await sdk.terminate(a.clientDb);await appSdk.deleteApp(a.app);}));await deleteApp(admin);});
