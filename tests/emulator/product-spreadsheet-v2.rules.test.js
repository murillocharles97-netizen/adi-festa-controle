'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
if(!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Only local Firestore emulator is allowed.');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const backendRequire=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=backendRequire('firebase-admin/app');
const {getFirestore,FieldValue}=backendRequire('firebase-admin/firestore');
const {productSpreadsheetService}=require('../../functions/src/services/product-spreadsheet-service');
const {classifyCollection}=require('../../functions/src/services/workspace-reset-policy');
const projectId='adi-festa-variations-test',suffix=Date.now().toString(36),bid='sheet-v2-'+suffix,uid='owner-'+suffix,space='store-'+suffix;
let env,app,db,service;
const request=(rows,patch={})=>({auth:{uid},data:{businessId:bid,spaceId:space,workspaceGeneration:0,rows:rows.map((data,i)=>({line:i+2,data})),...patch}});
test.before(async()=>{
 env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 app=initializeApp({projectId},'sheet-v2-'+suffix);db=getFirestore(app);service=productSpreadsheetService(db,{FieldValue});
 await db.doc(`businesses/${bid}`).set({ownerId:uid,active:true,subscription:{planId:'internal',status:'active'},sensitiveDataVersion:1});
 await db.doc(`users/${uid}`).set({active:true,businessId:bid,role:'owner'});
 await db.doc(`businesses/${bid}/members/${uid}`).set({status:'active',role:'owner',spaceAccess:'all'});
 await db.doc(`financialSpaces/${space}`).set({type:'business',businessId:bid,linkedBusinessId:bid,active:true,capabilities:{products:true,sales:true}});
});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
test('create canonical product, protected cost and initial stock atomically; replay and double click only once',async()=>{
 const input={nome:'Novo',codigo:'001',barcode:'0001234567890',custo:8.5,preco:19.9,estoqueAtual:4};
 const reports=await Promise.all([service.createProducts(request([input])),service.createProducts(request([input]))]);
 assert.equal(reports.flatMap(r=>r.results).filter(r=>r.ok&&!r.replayed).length,1);
 assert.equal(reports.flatMap(r=>r.results).filter(r=>r.replayed).length,1);
 const id=reports[0].results[0].id,p=(await db.doc(`businesses/${bid}/products/${id}`).get()).data();
 assert.equal(p.custo,undefined);assert.equal(p.preco,19.9);assert.equal(p.estoqueAtual,4);assert.equal(p.estoque,4);assert.equal(p.actorUid,uid);assert.equal(p.productType,'simple');assert.deepEqual(p.allowedSpaceIds,[space]);assert.equal(p.defaultSpaceId,space);
 assert.equal((await db.doc(`businesses/${bid}/productFinancials/${id}`).get()).data().custo,8.5);
 assert.equal((await db.collection(`businesses/${bid}/stockMovements`).where('produtoId','==',id).get()).size,1);
 const replay=await service.createProducts(request([input]));assert.equal(replay.results[0].replayed,true);
 assert.equal((await db.collection(`businesses/${bid}/products`).where('codigo','==','001').get()).size,1);
});
test('conflicting concurrent attempts with same SKU but different contents never create two',async()=>{
 const reports=await Promise.all(['A','B'].map(nome=>service.createProducts(request([{nome,codigo:'CONCURRENT'}]))));
 assert.equal(reports.flatMap(r=>r.results).filter(r=>r.ok).length,1);
 assert.equal((await db.collection(`businesses/${bid}/products`).where('codigo','==','CONCURRENT').get()).size,1);
});
test('product added after preview and variant collisions rejected, unrelated space remains isolated',async()=>{
 await db.doc(`businesses/${bid}/products/manual`).set({nome:'Manual',codigo:'AFTER',barcode:'456',ativo:true,spaceAccessMode:'single_space',allowedSpaceIds:[space]});
 for(const data of [{nome:'A',codigo:'AFTER'},{nome:'B',barcode:'456'}])assert.equal((await service.createProducts(request([data]))).results[0].ok,false);
 await db.doc(`businesses/${bid}/productVariants/variant`).set({parentProductId:'manual',sku:'VAR',barcode:'789',active:true});
 assert.equal((await service.createProducts(request([{nome:'Var duplicate',barcode:'789'}]))).results[0].ok,false);
 await db.doc(`businesses/${bid}/products/other`).set({nome:'Other',codigo:'OTHER',ativo:true,spaceAccessMode:'single_space',allowedSpaceIds:['elsewhere']});
 assert.equal((await service.createProducts(request([{nome:'New here',codigo:'OTHER'}]))).results[0].ok,true);
 assert.equal((await db.doc(`businesses/${bid}/products/other`).get()).data().nome,'Other');
 await db.doc(`businesses/${bid}/products/manual`).update({ativo:false});
 assert.equal((await service.createProducts(request([{nome:'Inactive duplicate',codigo:'AFTER'}]))).results[0].ok,false);
});
test('server validates input, ambiguity, credentials, entitlements, member/space and reset epoch',async()=>{
 for(const data of [{nome:''},{nome:'X',estoqueAtual:-1},{nome:'X',codigo:42},{nome:'X',id:'hijack'}]){
  try{const result=await service.createProducts(request([data]));assert.equal(result.results[0].ok,false);}catch(e){assert.ok(['invalid-argument'].includes(e.code),e.message);}
 }
 const duplicated=await service.createProducts(request([{nome:'A',codigo:'DUP'},{nome:'B',codigo:'DUP'}]));assert.equal(duplicated.results.filter(r=>r.ok).length,0);
 await assert.rejects(service.createProducts({...request([{nome:'X'}]),auth:null}),e=>e.code==='unauthenticated');
 await assert.rejects(service.createProducts({...request([{nome:'X'}]),auth:{uid:'outsider'}}),e=>e.code==='permission-denied');
 await assert.rejects(service.createProducts(request([{nome:'X'}],{spaceId:'another-business-space'})),e=>e.code==='permission-denied');
 await assert.rejects(service.createProducts(request([{nome:'X'}],{workspaceGeneration:2})),e=>e.code==='failed-precondition');
 await db.doc(`businesses/${bid}`).update({subscription:{planId:'essential',status:'active',catalogVersion:2}});
 await assert.rejects(service.createProducts(request([{nome:'X'}])),e=>e.code==='permission-denied');
 await db.doc(`businesses/${bid}`).update({subscription:{planId:'internal',status:'active'}});
});
test('restricted authorized employee may create only in their space without cost or initial stock',async()=>{
 const staff='staff-'+suffix;
 await db.doc(`users/${staff}`).set({active:true,businessId:bid});
 await db.doc(`businesses/${bid}/members/${staff}`).set({status:'active',role:'seller',spaceAccess:'selected',allowedSpaceIds:[space],permissions:{'products.view':true,'products.edit':true}});
 const req=request([{nome:'Staff default',codigo:'STAFF'}]);req.auth.uid=staff;
 const result=await service.createProducts(req);assert.equal(result.results[0].ok,true);
 assert.equal((await db.doc(`businesses/${bid}/productFinancials/${result.results[0].id}`).get()).exists,false);
 for(const data of [{nome:'Cost',custo:1},{nome:'Stock',estoqueAtual:1}]){req.data.rows=[{line:2,data}];assert.equal((await service.createProducts(req)).results[0].ok,false);}
 await db.doc(`businesses/${bid}/members/${staff}`).update({allowedSpaceIds:['elsewhere']});
 await assert.rejects(service.createProducts(req),e=>e.code==='permission-denied');
});
test('receipts cannot be forged by client; spreadsheet create cannot bypass backend; reset owns receipts',async()=>{
 const client=env.authenticatedContext(uid).firestore();
 await assertFails(sdk.setDoc(sdk.doc(client,`businesses/${bid}/productImportOperations/forged`),{businessId:bid}));
 await assertFails(sdk.getDoc(sdk.doc(client,`businesses/${bid}/productImportOperations/catalog-lock`)));
 await assertFails(sdk.setDoc(sdk.doc(client,`businesses/${bid}/products/forged`),{businessId:bid,spreadsheetImportOperationId:'forged',nome:'Forged',itemKind:'product',spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space,spaceScopeVersion:1}));
 assert.equal(classifyCollection('productImportOperations'),'delete-operational');
 assert.equal(classifyCollection('productImportIdentifiers'),'delete-operational');
});
test('manual offline queue cannot race a new import using the same identifier',async()=>{
 const {prepareProductImportFence}=await import('data:text/javascript;base64,'+Buffer.from(fs.readFileSync('js/firebase/product-import-fence.js','utf8')).toString('base64'));
 const client=env.authenticatedContext(uid).firestore();
 let announce,release;const ready=new Promise(r=>announce=r),proceed=new Promise(r=>release=r);
 const data={id:'manual-race',businessId:bid,nome:'Queued manual',codigo:'RACE',itemKind:'product',spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space,spaceScopeVersion:1,ativo:true};
 let attempt=0;
 const queued=sdk.runTransaction(client,async transaction=>{
  const commit=await prepareProductImportFence({transaction,db:client,businessId:bid,writes:[{entityType:'products',entityId:'manual-race',operation:'create',data}],doc:sdk.doc,serverTimestamp:sdk.serverTimestamp});
  if(++attempt===1){announce();await proceed;}
  commit();transaction.set(sdk.doc(client,`businesses/${bid}/products/manual-race`),data);
 });
 // Attach rejection handler immediately so a racing failure is not unhandled.
 const outcome=queued.then(()=>null,error=>error);
 await ready;
 const imported=await service.createProducts(request([{nome:'Import wins',codigo:'RACE'}]));assert.equal(imported.results[0].ok,true);
 release();const error=await outcome;assert.equal(error?.code,'product-identifier-conflict');
 assert.equal((await db.collection(`businesses/${bid}/products`).where('codigo','==','RACE').get()).size,1);
});
test('no-code retry is idempotent, independent of row position; failed batch never partially commits',async()=>{
 const input={nome:'No code retry'};
 const first=await service.createProducts(request([input]));assert.equal(first.results[0].ok,true);
 const replay=request([input]);replay.data.rows[0].line=146;
 assert.equal((await service.createProducts(replay)).results[0].replayed,true);
 const explicit=request([{...input,custo:0,preco:0,estoqueAtual:0}]);assert.equal((await service.createProducts(explicit)).results[0].replayed,true);
 const count=(await db.collection(`businesses/${bid}/products`).get()).size;
 const failDb={doc:p=>db.doc(p),runTransaction:callback=>db.runTransaction(tx=>callback(new Proxy(tx,{get(target,key){
  if(key==='create')return(ref,data)=>{if(ref.path.includes('/productFinancials/'))throw Error('QA injected failure');return target.create(ref,data);};
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }})))};
 await assert.rejects(productSpreadsheetService(failDb,{FieldValue}).createProducts(request([{nome:'Atomic failure',codigo:'ATOMIC',custo:2,estoqueAtual:3}])),/QA injected failure/);
 assert.equal((await db.collection(`businesses/${bid}/products`).get()).size,count);
 assert.equal((await service.createProducts(request([{nome:'Atomic failure',codigo:'ATOMIC',custo:2,estoqueAtual:3}]))).results[0].ok,true);
});
test('old client identity writes rejected after imports; stock updates remain available',async()=>{
 const client=env.authenticatedContext(uid).firestore(),p={businessId:bid,nome:'Old client',codigo:'STALE',itemKind:'product',spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space,spaceScopeVersion:1,ativo:true};
 await assertFails(sdk.setDoc(sdk.doc(client,`businesses/${bid}/products/old-client`),p));
 const imported=await service.createProducts(request([{nome:'Existing stock',codigo:'STOCK'}]));
 const ref=sdk.doc(client,`businesses/${bid}/products/${imported.results[0].id}`);
 await sdk.updateDoc(ref,{estoque:5,estoqueAtual:5});
 assert.equal((await sdk.getDoc(ref)).data().estoqueAtual,5);
 await assertFails(sdk.updateDoc(ref,{codigo:'STALE-CODE'}));
});

test('full 25-row creation batch and retry preserve one stock movement per product',async()=>{
 const rows=Array.from({length:25},(_,i)=>({nome:'Batch '+i,codigo:'BATCH-'+i,preco:10,estoqueAtual:2}));
 const result=await service.createProducts(request(rows));assert.equal(result.results.filter(r=>r.ok&&!r.replayed).length,25);
 const replay=await service.createProducts(request(rows));assert.equal(replay.results.filter(r=>r.replayed).length,25);
 for(const {id} of result.results)assert.equal((await db.collection(`businesses/${bid}/stockMovements`).where('produtoId','==',id).get()).size,1);
 await assert.rejects(service.createProducts(request([...rows,{nome:'Too many'}])),e=>e.code==='invalid-argument');
});
