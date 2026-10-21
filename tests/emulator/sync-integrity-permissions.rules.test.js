'use strict';
// Real SDK/repository/Rules, fictional tenant; no production credentials or calls.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const {harness,operational}=require('../helpers/sync-integrity-scope-harness.cjs');
if(!/^(127\.0\.0\.1|localhost):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Local Firestore Emulator required');
const bid='qa-integrity-permissions',space='qa-integrity-space',owner='qa-integrity-owner',seller='qa-integrity-seller';
const rows={products:[{id:'p',nome:'QA produto',preco:10,estoque:3,estoqueAtual:3,spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space,spaceScopeVersion:1}],
 productVariants:[{id:'v',parentProductId:'p',stock:2}],clients:[{id:'c',nome:'QA cliente',saldo:0}],
 sales:[{id:'s',operationId:'qa-sale',spaceId:space,actorUid:owner,status:'pago',valorFinal:10}],
 payments:[{id:'pay',clienteId:'c',operationId:'qa-payment',valor:5,saldoAnterior:-5,saldoNovo:0,data:'2026-10-19T10:00:00Z'}],
 balanceAdjustments:[],balanceEvents:[],productFinancials:[],variantFinancials:[],saleFinancials:[]};
let env,normalize,baseline;
const docPath=(name,id)=>['businesses',bid,name,id];
const bridge=value=>Array.isArray(value)?Array.from(value,bridge):value;
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 normalize=(await import('data:text/javascript,'+encodeURIComponent(fs.readFileSync('js/firebase/firestore-utils.js','utf8')))).normalizeFirestoreData;
 await env.withSecurityRulesDisabled(async ctx=>{
  const db=ctx.firestore();
  await sdk.setDoc(sdk.doc(db,'businesses',bid),{id:bid,ownerId:owner,active:true,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}});
  for(const [uid,role]of [[owner,'owner'],[seller,'seller']]){
   await sdk.setDoc(sdk.doc(db,'users',uid),{uid,businessId:bid,role,active:true});
   await sdk.setDoc(sdk.doc(db,...docPath('members',uid)),{uid,role,status:'active',spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[space],permissions:Object.fromEntries(operational.map(p=>[p,true]))});
  }
  await sdk.setDoc(sdk.doc(db,'financialSpaces',space),{id:space,businessId:bid,linkedBusinessId:bid,ownerUid:owner,type:'business',active:true,capabilities:{finance:true,sales:true,products:true,inventory:true}});
  for(const [name,items]of Object.entries(rows))for(const row of items){row.businessId=bid;await sdk.setDoc(sdk.doc(db,...docPath(name,row.id)),row);}
 });
 baseline=await snapshot();
});
test.after(async()=>env?.cleanup());
async function snapshot(){let snapshotJson;await env.withSecurityRulesDisabled(async ctx=>{
 const result={};for(const name of Object.keys(rows)){const docs=await sdk.getDocs(sdk.collection(ctx.firestore(),'businesses',bid,name));result[name]=docs.docs.map(doc=>({id:doc.id,...doc.data()})).sort((a,b)=>a.id.localeCompare(b.id));}snapshotJson=JSON.stringify(result);
});return snapshotJson;}
function runtime(role){
 const uid=role==='owner'?owner:seller,context={businessId:bid,role,permissions:role==='owner'?['*']:operational,spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[space],permissionSignature:uid,userProfile:{uid,businessId:bid}},
  db=env.authenticatedContext(uid).firestore(),s={...sdk,where:(field,operator,value)=>sdk.where(field,operator,bridge(value)),console,Date,performance,structuredClone,firebaseQuery:sdk.query,auth:{currentUser:{uid}},db,normalizeFirestoreData:normalize,
   BusinessContext:{get:()=>context,getCurrentBusinessId:()=>bid},FirebaseSession:{profile:{businessId:bid},user:{uid}},document:{querySelectorAll:()=>[],documentElement:{dataset:{}}},addEventListener(){},queueMicrotask(){},recordFirestoreOperation(){},listenerOpened(){},listenerClosed(){}};
 s.window=s;vm.createContext(s);vm.runInContext(fs.readFileSync('js/team-access.js','utf8'),s);
 vm.runInContext(fs.readFileSync('js/firebase/firestore-repository.js','utf8').replace(/^import[\s\S]*?from\s+["'][^"']+["'];\r?\n/gm,'').replaceAll('export ','')+'\nwindow.repo=createFirestoreRepository;',s);
 const h=harness({role,permissions:context.permissions,documents:rows,read:name=>s.repo(name).listAllPaged(20)});h.context.businessId=bid;
 return {h,db};
}
test('owner audits full ledger with current unchanged Rules',async()=>{
 const {h}=runtime('owner'),report=await h.compare();
 assert.equal(report.financial.status,'audited');assert.equal(report.financial.remote,2);
 for(const name of ['payments','balanceAdjustments','balanceEvents'])assert.equal(h.reads.includes(name),true);
 assert.equal(h.s.state.integrityStatus,'completed');
});
test('seller audit finishes without querying financial collections, whose Rules remain denied',async()=>{
 const {h,db}=runtime('seller'),report=await h.compare();
 assert.deepEqual(h.reads,['products','productVariants','clients','sales']);
 assert.equal(report.financial.status,'not_audited');assert.equal(h.s.state.integrityFailure,null);
 for(const name of ['payments','balanceAdjustments','balanceEvents','productFinancials','variantFinancials','saleFinancials'])
  await assertFails(sdk.getDocs(sdk.collection(db,'businesses',bid,name)));
});
test('reload, account switch and manual Sync all retain permission scope and immutable queue',async()=>{
 for(const role of ['seller','seller','owner','owner','seller']){
  const {h}=runtime(role),result=await h.manualSync();
  assert.equal(result.complete,true);assert.equal(result.integrityStatus,'completed');assert.equal(result.sent,0);
  assert.equal(h.reads.includes('payments'),role==='owner');assert.equal(JSON.stringify(h.queue),h.beforeQueue);
 }
});
test('audit and manual Sync produce zero commercial writes or repairs',async()=>{
 assert.equal(await snapshot(),baseline);
});
