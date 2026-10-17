'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const client=require('../js/sale-recovery-client'),f=require('./fixtures/retained-sale-recovery.cjs');
const identity={uid:f.seller,businessId:f.bid,workspaceGeneration:0};
test('permission signature change: empty active cache does not hide four prior originals',async()=>{
 const records=Array.from({length:4},(_,n)=>f.sample(n)),source={packets:records.map(x=>x.packet),local:{vendas:records.map(x=>x.sale),movimentacoesEstoque:records.flatMap(x=>x.movements)}},snapshot={identity,sources:[{packets:[],local:{}},source]},before=client.canonical(snapshot),sent=[];
 const sender=client.create({snapshot:()=>snapshot,cryptoApi:crypto.webcrypto,call:async(_,data)=>{const x=JSON.parse(data.originalJson);sent.push(x);return{status:'awaiting_review',operationId:x.packet.operationId,contentHash:data.contentHash};}});
 assert.equal(client.entries(snapshot).length,4);await sender.send();assert.equal(sent.length,4);assert.equal(sent.flatMap(x=>x.localMovements).length,11);assert.equal(client.canonical(snapshot),before);assert.deepEqual(sent.map(x=>x.packet.operationId),records.map(x=>x.packet.operationId));
});
test('identical preserved copies deduplicate by original operation, retaining the complete snapshot',()=>{
 const x=f.sample(),full={packets:[x.packet],local:{vendas:[x.sale],movimentacoesEstoque:x.movements}},minimal={packets:[structuredClone(x.packet)],local:{}};
 const before=client.canonical([minimal,full]),result=client.entries({identity,sources:[minimal,full]});assert.equal(result.length,1);assert.equal(result[0].local.vendas.length,1);assert.equal(result[0].local.movimentacoesEstoque.length,1);assert.equal(client.canonical([minimal,full]),before);
});
test('conflicting namespaces are not silently deduplicated and no upload starts',async()=>{
 const x=f.sample(),altered=structuredClone(x.packet);altered.payload.writes[0].data.valorFinal=200;let calls=0;
 const snapshot={identity,sources:[{packets:[x.packet],local:{}},{packets:[altered],local:{}}]};
 const sender=client.create({snapshot:()=>snapshot,call:()=>{calls++;},cryptoApi:crypto.webcrypto});await assert.rejects(sender.send(),/cópias diferentes/);assert.equal(calls,0);
});
test('prior cache evidence never admits another actor, tenant or workspace generation',()=>{
 const x=f.sample(),packets=[x.packet,...[{userId:'other'},{businessId:'other'},{workspaceGeneration:1}].map(v=>({...x.packet,...v}))];assert.equal(client.entries({identity,sources:[{packets,local:{}}]}).length,1);
});
function operationHarness(source,allowed){
 let writes=0,overlays=0;const handlers={},data={config:{},clientes:[],produtos:[],vendas:[]};
 const box={window:null,DB:{getBusinessId:()=>f.bid,carregar:()=>data,alterar:fn=>{writes++;fn(data);}},FirebaseSession:{user:{uid:f.seller},profile:{role:'seller'}},BusinessContext:{hasPermission:()=>allowed},document:{querySelector:()=>null,createElement:()=>({querySelectorAll:()=>[],querySelector:()=>({addEventListener(){}})}),body:{append:()=>{overlays++;}}},Utils:{},addEventListener:(k,fn)=>handlers[k]=fn,dispatchEvent:()=>{},CustomEvent:class{},Date,Boolean,Object,Array,String};box.window=box;vm.createContext(box);vm.runInContext(source,box);return{box,handlers,counts:()=>({writes,overlays})};
}
test('seller with empty new cache cannot be trapped in settings onboarding or mutate it',()=>{
 const source=fs.readFileSync('js/operation-mode.js','utf8'),h=operationHarness(source,false);h.handlers['operation-settings-loaded']();h.box.OperationMode.openEditor({onboarding:true});assert.deepEqual(h.counts(),{writes:0,overlays:0});
});
test('staff operation settings load uses remote, never queues unauthorized bootstrap/retry writes',async()=>{
 const handlers={},local={updatedAt:'2099-01-01T00:00:00.000Z'},remote={updatedAt:'2026-10-01T00:00:00.000Z',operationOnboardingCompleted:true};let writes=0,applied=null;
 const box={window:null,db:{},doc:(...x)=>x,getDoc:async()=>({exists:()=>true,data:()=>remote}),setDoc:async()=>{writes++;},serverTimestamp:()=>null,localStorage:{getItem:()=>null,setItem(){}},BusinessContext:{getCurrentBusinessId:()=>f.bid,hasPermission:()=>false},FirebaseSession:{profile:{businessId:f.bid},user:{uid:f.seller}},OperationMode:{get:()=>local,applyRemote:v=>{applied=v;},ensure:()=>local},addEventListener:(k,fn)=>handlers[k]=fn,dispatchEvent(){},CustomEvent:class{},Date,console};box.window=box;vm.createContext(box);vm.runInContext(fs.readFileSync('js/firebase/operation-settings.js','utf8').replace(/^import .*;\r?\n/gm,'').replace(/if\(window.FirebaseSession\?\.user\)load\(\);/,''),box);
 await handlers['firebase-auth-ready']();await handlers['operation-settings-changed']({detail:{reason:'migration',operation:local}});handlers.online();assert.equal(writes,0);assert.equal(applied,remote);
});
test('recovery UI is independent of commercial queue/readiness, routes and plan; membership gates remain',()=>{
 const ui=fs.readFileSync('js/sale-recovery-ui.js','utf8');assert.doesNotMatch(ui,/getRetainedSaleRecoveryCount|recoverySnapshot|hasPermission|sales\.create|financial\.view|processSyncQueue/);assert.match(ui,/app\.before\(bar\)/);assert.match(ui,/member\?\.status!=='active'/);assert.match(ui,/userProfile\?\.uid!==uid/);assert.match(ui,/WorkspaceRuntime\?\.isBlocked/);assert.match(ui,/business-context-changed/);
});
test('cache evidence reader has readonly transactions and cannot flush, migrate, stage or execute queues',()=>{
 const s=fs.readFileSync('js/business-cache.js','utf8'),part=s.slice(s.indexOf('  async function recoverySources'),s.indexOf('  DB.businessCache ='));
 assert.match(part,/transaction\('readonly'/);assert.doesNotMatch(part,/transaction\('readwrite'|\.put\(|\.delete\(|setItem\(|removeItem\(|await flush\(|await migrate\(|stage\(/);assert.match(part,/FirebaseSession\?\.user\?\.uid!==uid/);assert.match(part,/workspace-generation-mismatch/);
});
test('actual cache reader finds prior signature in readonly IDB; excludes foreign scopes/fields/epochs',async()=>{
 const prefix=`business-cache:v156:adiFestaDB_v1:${f.bid}:${f.seller}:`,rows=[],readKeys=[];
 function putArray(scope,area,field,values,json=false){
  rows.push({key:JSON.stringify([scope,area,field]),scope,area,field,kind:'array',json});
  values.forEach((value,position)=>rows.push({key:JSON.stringify([scope,area,field,String(position),0]),scope,area,field,kind:'item',position,value}));
 }
 const samples=Array.from({length:4},(_,n)=>f.sample(n)),old=prefix+'oldsignature',fresh=prefix+'newsignature';
 putArray(old,'sync',`adiFesta:${f.bid}:${f.seller}:oldsignature:syncQueue`,samples.map(x=>x.packet),true);
 putArray(old,'data','vendas',samples.map(x=>x.sale));putArray(old,'data','movimentacoesEstoque',samples.flatMap(x=>x.movements));putArray(fresh,'sync',`adiFesta:${f.bid}:${f.seller}:newsignature:syncQueue`,[],true);
 putArray(old,'data','financialEntries',[{private:true}]);putArray(old,'data','clientes',[{private:true}]);
 for(const scope of [prefix+'signature:generation:1',`business-cache:v156:adiFestaDB_v1:${f.bid}:foreign:signature`,prefix+'signature:unexpected'])putArray(scope,'data','vendas',[f.sample().sale]);
 const before=client.canonical(rows);let epoch=null;
 const box={window:null,DB:{localRecords:{read:async()=>epoch,transaction:async(mode,action)=>{
  assert.equal(mode,'readonly');return new Promise((resolve,reject)=>action({index:()=>({openKeyCursor:range=>{
   const request={},selected=rows.filter(r=>r.scope>=range[0]&&r.scope<=range[1]);let n=0;
   const step=()=>{request.result=n<selected.length?{key:selected[n].scope,primaryKey:selected[n].key,continue(){n++;queueMicrotask(step);}}:null;request.onsuccess();};queueMicrotask(step);return request;
  }}),get:key=>{readKeys.push(key);const request={};queueMicrotask(()=>{request.result=rows.find(r=>r.key===key);request.onsuccess();});return request;}},resolve,reject));
 }}},FirebaseSession:{user:{uid:f.seller}},BusinessContext:{get:()=>({businessId:f.bid,userProfile:{uid:f.seller},business:{workspaceGeneration:0}})},IDBKeyRange:{bound:(a,b)=>[a,b]},localStorage:{length:0},structuredClone,queueMicrotask,addEventListener(){},Map,Set,JSON,Number,String,Object,Array,Error};box.window=box;vm.createContext(box);vm.runInContext(fs.readFileSync('js/business-cache.js','utf8'),box);
 const sources=await box.DB.businessCache.recoverySources(identity),entries=client.entries({identity,sources});assert.equal(entries.length,4);assert.equal(entries.flatMap(x=>x.local.movimentacoesEstoque).length,11);assert.equal(client.canonical(rows),before);assert.ok(readKeys.every(k=>!k.includes('financialEntries')&&!k.includes('clientes')&&!k.includes('generation:1')&&!k.includes('unexpected')));
 box.FirebaseSession.user.uid='other';await assert.rejects(box.DB.businessCache.recoverySources(identity),{code:'recovery-context-invalid'});box.FirebaseSession.user.uid=f.seller;epoch={workspaceGeneration:1};await assert.rejects(box.DB.businessCache.recoverySources(identity),{code:'workspace-generation-mismatch'});assert.equal(client.canonical(rows),before);
});
