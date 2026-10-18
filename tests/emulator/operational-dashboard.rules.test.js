'use strict';
// Fictional tenants only. Actual repository + SDK + Rules; no production calls.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Emulator required');
const bid='qa-operational-dashboard',foreign='qa-operational-foreign',a='qa-operational-a',b='qa-operational-b',owner='qa-operational-owner',seller='qa-operational-seller',cashier='qa-operational-cashier',stock='qa-operational-stock';
let env,normalize;const date='2026-10-18T13:00:00.000Z';
const permissions={'sales.create':true,'sales.viewAll':false,'customers.view':true,'products.view':true,'inventory.view':true,'cost.view':false,'profit.view':false,'financial.view':false,'team.view':false,'settings.manage':false};
const values=[25,30,40,45,50,55,60,96.6];
const paths=(collection,id)=>['businesses',bid,collection,id];
const total=rows=>Number(rows.filter(r=>r.spaceId===a&&String(r.data).startsWith('2026-10-18')&&!r.deletedAt).reduce((sum,r)=>sum+Number(r.valorFinal||0),0).toFixed(2));
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 normalize=(await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('js/firebase/firestore-utils.js','utf8')))).normalizeFirestoreData;
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore(),subscription={planId:'internal',status:'active'};
  for(const [id,ownerId]of [[bid,owner],[foreign,'qa-foreign-owner']])await sdk.setDoc(sdk.doc(db,'businesses',id),{id,ownerId,active:true,workspaceGeneration:0,subscription});
  for(const [uid,role]of [[owner,'owner'],[seller,'seller'],[cashier,'cashier'],[stock,'stock'],['qa-operational-disabled','seller']]){
   await sdk.setDoc(sdk.doc(db,'users',uid),{uid,businessId:bid,role,active:true});
   await sdk.setDoc(sdk.doc(db,...paths('members',uid)),{uid,role,status:uid.endsWith('disabled')?'disabled':'active',spaceAccess:uid===owner?'all':'selected',allowedSpaceIds:[a],permissions:uid===stock?{'products.view':true,'inventory.view':true}:permissions});
  }
  for(const id of [a,b])await sdk.setDoc(sdk.doc(db,'financialSpaces',id),{id,businessId:bid,linkedBusinessId:bid,ownerUid:owner,type:'business',active:true,capabilities:{finance:true,sales:true,products:true,inventory:true,goals:true}});
  for(const [n,value]of values.entries())await sdk.setDoc(sdk.doc(db,...paths('sales','sale-'+n)),{id:'sale-'+n,businessId:bid,spaceId:a,financialSpaceId:a,actorUid:owner,valorFinal:value,status:'pago',data:date,createdAt:new Date(date),updatedAt:new Date(date),schemaVersion:3});
  await sdk.setDoc(sdk.doc(db,...paths('sales','prior')), {id:'prior',businessId:bid,spaceId:a,actorUid:seller,valorFinal:59.9,status:'pago',data:'2026-10-17T17:27:13.452Z',createdAt:new Date(date),updatedAt:new Date(date)});
  await sdk.setDoc(sdk.doc(db,...paths('sales','other-space')), {id:'other-space',businessId:bid,spaceId:b,actorUid:owner,valorFinal:999,status:'pago',data:date,createdAt:new Date(date),updatedAt:new Date(date)});
  for(let n=0;n<37;n++)await sdk.setDoc(sdk.doc(db,...paths('clients','client-'+n)),{id:'client-'+n,businessId:bid,nome:'QA cliente '+n,active:true,ativo:true});
  await sdk.setDoc(sdk.doc(db,...paths('products','product')), {id:'product',businessId:bid,preco:10,nome:'QA produto',estoqueAtual:10,estoque:10,active:true,spaceAccessMode:'single_space',allowedSpaceIds:[a],defaultSpaceId:a,spaceScopeVersion:1});
  await sdk.setDoc(sdk.doc(db,...paths('settings','default')),{businessId:bid,dashboard:{dailySalesGoal:1000,dailySalesGoalsBySpaceId:{[a]:1000}}});
  for(const [collection,id,data]of [['productFinancials','product',{productId:'product',custo:99}],['saleFinancials','sale-0',{saleId:'sale-0',custoTotal:99,lucro:5}],['variantFinancials','variant',{parentProductId:'product',cost:99}]])await sdk.setDoc(sdk.doc(db,...paths(collection,id)),{businessId:bid,...data});
  await sdk.setDoc(sdk.doc(db,'financialSpaces',a,'entries','private-entry'),{financialSpaceId:a,linkedBusinessId:bid,ownerUid:owner,amountCents:9999});
  for(const [id,type,actorUid,spaceId]of [['sale:owner','sale',owner,a],['sale:other','sale',owner,b],['payment:owner','payment',owner,a],['balance:owner','balance',owner,a],['sale:self','sale',seller,a]])await sdk.setDoc(sdk.doc(db,...paths('activityEvents',id)),{id,eventId:id,businessId:bid,type,actorUid,spaceId,entityId:id,createdAt:new Date(date),summary:{amount:10}});
 });
});
test.after(async()=>env?.cleanup());
function repository(uid){
 const role=uid===owner?'owner':uid===cashier?'cashier':'seller',context={businessId:bid,userProfile:{uid,businessId:bid},role,permissions:uid===owner?['*']:Object.keys(permissions).filter(k=>permissions[k]),permissionSignature:uid,spaceAccess:uid===owner?'all':'selected',allowedSpaceIds:[a]};
 const db=env.authenticatedContext(uid).firestore(),s={...sdk,console,Date,structuredClone,performance,auth:{currentUser:{uid}},db,firebaseQuery:sdk.query,normalizeFirestoreData:normalize,
  BusinessContext:{get:()=>context,getCurrentBusinessId:()=>bid},FirebaseSession:{profile:{businessId:bid},user:{uid}},document:{querySelectorAll:()=>[],documentElement:{dataset:{}}},addEventListener(){},queueMicrotask(){},recordFirestoreOperation(){},listenerOpened(){},listenerClosed(){}};
 s.window=s;vm.createContext(s);vm.runInContext(fs.readFileSync('js/team-access.js','utf8'),s);
 vm.runInContext(fs.readFileSync('js/firebase/firestore-repository.js','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\r?\n/gm,'').replaceAll('export ','')+'\nwindow.repo=createFirestoreRepository;',s);
 return{db,s,sales:s.repo('sales'),clients:s.repo('clients')};
}
test('owner and two staff identities read the same operational space ledger/customers/goal, not just their own sales; reload uses the same query',async()=>{
 for(const uid of [owner,seller,cashier,seller,owner]){
  const r=repository(uid),rows=await r.sales.listAllPaged(3);assert.equal(total(rows),401.6);assert.equal(rows.filter(r=>r.spaceId===a).length,9);assert.equal((await r.clients.listAllPaged(10)).length,37);
  const settings=await assertSucceeds(sdk.getDoc(sdk.doc(r.db,...paths('settings','default'))));assert.equal(settings.data().dashboard.dailySalesGoalsBySpaceId[a],1000);
  if(uid!==owner)assert.equal(rows.some(r=>r.spaceId===b),false);
 }
});
test('owner -> seller -> second seller committed sales update all live operational readers with one stock change per sale',async()=>{
 const readers=[owner,seller,cashier].map(repository),latest=new Map(),pending=new Set(),stops=[];
 const waitFor=expected=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{pending.delete(check);reject(Error('Missing shared update '+expected+': '+JSON.stringify([...latest])));},8000);
  const check=()=>{if(readers.every((_,i)=>latest.get(i)===expected)){clearTimeout(timer);pending.delete(check);resolve();}};pending.add(check);check();
 });
 try{
  readers.forEach((r,index)=>stops.push(r.sales.subscribeRecent(rows=>{latest.set(index,total(rows));for(const check of pending)check();},error=>{throw error;},100)));
  await waitFor(401.6);let expected=401.6,onHand=10;
  for(const [n,uid]of [owner,seller,cashier].entries()){
   const r=readers[n],id='live-sale-'+n,operationId='live-operation-'+n,value=10*(n+1),at=new Date(date),batch=sdk.writeBatch(r.db);
   batch.set(sdk.doc(r.db,...paths('sales',id)),{id,operationId,businessId:bid,spaceId:a,financialSpaceId:a,actorUid:uid,status:'pago',formaPagamento:'dinheiro',valorFinal:value,data:date,createdAt:at,updatedAt:sdk.serverTimestamp(),itens:[{produtoId:'product',quantidade:1,precoFinalUnitario:value}]});
   batch.update(sdk.doc(r.db,...paths('products','product')),{estoqueAtual:onHand-1,estoque:onHand-1,updatedByUid:uid,updatedAt:sdk.serverTimestamp()});
   batch.set(sdk.doc(r.db,...paths('stockMovements','live-movement-'+n)),{id:'live-movement-'+n,businessId:bid,spaceId:a,actorUid:uid,operationId,vendaId:id,produtoId:'product',tipo:'saida_venda',quantidade:-1,estoqueAnterior:onHand,estoqueNovo:onHand-1,data:date,createdAt:at,updatedAt:sdk.serverTimestamp()});
   await assertSucceeds(batch.commit());onHand--;expected+=value;await waitFor(expected);
  }
  assert.equal((await sdk.getDoc(sdk.doc(readers[0].db,...paths('products','product')))).data().estoqueAtual,7);
 }finally{stops.forEach(stop=>stop());}
});
test('staff can read other-actor sale history events only; financial events and all private projections remain denied',async()=>{
 const r=repository(seller),history=await r.s.repo('activityEvents').listAllPaged(5);
 assert.deepEqual(Array.from(history,e=>e.id).sort(),['sale:owner','sale:self']);
 for(const [collection,id]of [['productFinancials','product'],['saleFinancials','sale-0'],['variantFinancials','variant'],['members',owner]])await assertFails(sdk.getDoc(sdk.doc(r.db,...paths(collection,id))));
 await assertFails(sdk.getDoc(sdk.doc(r.db,'financialSpaces',a,'entries','private-entry')));
 await assertFails(sdk.getDoc(sdk.doc(r.db,...paths('activityEvents','payment:owner'))));await assertFails(sdk.getDoc(sdk.doc(r.db,...paths('activityEvents','balance:owner'))));
 await assertFails(sdk.updateDoc(sdk.doc(r.db,...paths('settings','default')),{dashboard:{dailySalesGoal:1}}));
});
test('cross-space, cross-company, revoked membership and inventory-only access remain denied; authored/admin writes are not expanded',async()=>{
 const r=repository(seller);await assertFails(sdk.getDoc(sdk.doc(r.db,...paths('sales','other-space'))));
 await assertFails(sdk.getDocs(sdk.collection(r.db,'businesses',foreign,'sales')));await assertFails(sdk.getDocs(sdk.collection(r.db,'businesses',bid,'sales')));
 for(const uid of [stock,'qa-operational-disabled'])await assertFails(sdk.getDocs(sdk.query(sdk.collection(env.authenticatedContext(uid).firestore(),'businesses',bid,'sales'),sdk.where('spaceId','==',a))));
 await assertFails(sdk.updateDoc(sdk.doc(r.db,...paths('sales','sale-0')),{status:'cancelado'}));
 await assertFails(sdk.setDoc(sdk.doc(r.db,...paths('sales','forged')),{businessId:bid,spaceId:a,actorUid:owner,valorFinal:5}));
});
test('legacy inline cost/profit never becomes readable merely because operational store sales are shared',async()=>{
 await env.withSecurityRulesDisabled(async context=>{
  const db=context.firestore();await sdk.setDoc(sdk.doc(db,...paths('sales','legacy-private')),{businessId:bid,spaceId:a,actorUid:owner,valorFinal:10,custoTotal:7,lucro:3});
 });
 const r=repository(seller);await assertFails(sdk.getDoc(sdk.doc(r.db,...paths('sales','legacy-private'))));
 await assertSucceeds(sdk.getDoc(sdk.doc(repository(owner).db,...paths('sales','legacy-private'))));
});
