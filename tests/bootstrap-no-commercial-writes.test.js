const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const sync=fs.readFileSync('js/firebase/sync.js','utf8');
function harness(role='seller'){
 const events={},persisted=[],queue=[{operationId:'legitimate-pending',status:'error',payload:{original:true}}];
 const c={structuredClone,crypto:require('node:crypto').webcrypto,localStorage:{getItem:()=>null,setItem:()=>{}},Utils:{uuid:()=>crypto.randomUUID()},PhoneUtils:{normalizeBrazilianPhone:x=>x},CustomEvent:function(type,o){this.type=type;this.detail=o?.detail},dispatchEvent:()=>{},addEventListener:(n,f)=>events[n]=f,SOURCES:{products:'produtos',productVariants:'variacoesProdutos',sales:'vendas'},sourceItems:(d,n)=>d[{products:'produtos',productVariants:'variacoesProdutos',sales:'vendas'}[n]]||[],activeBusinessId:()=> 'adi-festa',now:()=>new Date().toISOString(),applyingCloud:false,currentUser:{uid:'qa'},originalAlter:null,current:()=>({role:c.role}),has:()=>c.role==='owner',role};
 c.window=c;vm.createContext(c);
 const team=fs.readFileSync('js/team-access.js','utf8');
 vm.runInContext(team.slice(team.indexOf('  function sanitizePrivateCache('),team.indexOf('  window.TeamAccess =')),c);
 c.TeamAccess={sanitizePrivateCache:c.sanitizePrivateCache};
 vm.runInContext(fs.readFileSync('js/storage.js','utf8'),c);
 c.DB.businessCache={stage:d=>persisted.push(structuredClone(d))};
 c.DB.salvar({config:{},produtos:Array.from({length:4},(_,i)=>({id:'p'+i,estoque:6,custo:2})),variacoesProdutos:Array.from({length:2},(_,i)=>({id:'v'+i,stock:6,cost:2})),vendas:Array.from({length:122},(_,i)=>({id:'s'+i,valorTotal:10,status:'pago',itens:[],custoTotal:2,lucro:8}))});
 c.queueWrites=(writes,id,eventKind)=>{if(writes.length)queue.push({id,eventKind,writes});return writes.length};
 vm.runInContext(sync.slice(sync.indexOf('function changedFields('),sync.indexOf('async function validateUser()')),c);
 vm.runInContext('installOfflineFirstStorage()',c);
 vm.runInContext(fs.readFileSync('js/operation-mode.js','utf8'),c);
 return{c,queue,persisted,events};
}
for(const role of ['seller','owner'])test(`${role} bootstrap/reload hydration does not create operations or touch pending payloads`,()=>{
 const {c,queue}=harness(role),before=JSON.stringify(queue);
 for(let i=0;i<5;i++){c.OperationMode.applyRemote({operationMode:'external_sales',creditMode:'enabled'});c.DB.prepare(structuredClone(c.DB.carregar()));}
 assert.equal(JSON.stringify(queue),before);assert.equal(c.DB.carregar().vendas.length,122);
});
test('seller normalization and no-op mutation cannot resurrect private fields or create phantom patches',()=>{
 const {c,queue,persisted}=harness();
 c.DB.alterar(()=>{});assert.equal(queue.length,1);
 for(const d of [c.DB.carregar(),...persisted]){
  assert.ok(d.produtos.every(p=>!('custo'in p)&&!('cost'in p)));
  assert.ok(d.variacoesProdutos.every(p=>!('cost'in p)));
  assert.ok(d.vendas.every(s=>!('custoTotal'in s)&&!('lucro'in s)));
 }
});
test('explicit legitimate sale continues captured once and original pending operation remains byte-identical',()=>{
 const {c,queue}=harness(),pending=JSON.stringify(queue[0]);
 c.DB.alterar(d=>d.vendas.push({id:'new-sale',operationId:'new-op',valorTotal:25,status:'pago',itens:[]}));
 assert.equal(queue.length,2);assert.equal(queue[1].id,'new-op');assert.equal(queue[1].eventKind,'sale');
 assert.equal(queue[1].writes.length,1);assert.equal(queue[1].writes[0].operation,'create');assert.equal(JSON.stringify(queue[0]),pending);
 c.OperationMode.applyRemote({});assert.equal(queue.length,2);
});
test('diagnostic simple update is not mislabeled credit_sale; real sale event remains sale',()=>{
 const c={};vm.createContext(c);vm.runInContext(sync.slice(sync.indexOf('const queueSubtype ='),sync.indexOf('const roundedMoney ='))+'\nthis.classify=queueSubtype;',c);
 assert.equal(c.classify({payload:{eventKind:'simple',writes:[{entityType:'sales'}]}}),'simple');
 assert.equal(c.classify({payload:{eventKind:'sale',writes:[{entityType:'sales'}]}}),'sale');
});
test('configuration response from old account cannot hydrate the new account; user-only persistence',async()=>{
 const listeners={},requests=[],applied=[],writes=[];let scope='seller';
 const c={console,Date,JSON,localStorage:{getItem:()=>null,setItem:()=>{}},db:{},doc:(...a)=>a,getDoc:()=>new Promise(resolve=>requests.push(resolve)),setDoc:async(...a)=>writes.push(a),serverTimestamp:()=>0,CustomEvent:function(){},dispatchEvent:()=>{},addEventListener:(n,f)=>listeners[n]=f};c.window=c;
 c.BusinessContext={getCurrentBusinessId:()=> 'qa',hasPermission:()=>true};c.FirebaseSession={user:{uid:'seller'}};c.DB={getPrincipal:()=>scope,getWorkspaceGeneration:()=>0};c.OperationMode={get:()=>({}),applyRemote:d=>applied.push(d)};
 vm.createContext(c);vm.runInContext(fs.readFileSync('js/firebase/operation-settings.js','utf8').replace(/^import .*;\r?\n/gm,''),c);
 listeners['firebase-session-cleared']();scope='owner';c.FirebaseSession.user.uid='owner';const load=listeners['firebase-auth-ready']();
 requests[0]({exists:()=>true,data:()=>({old:true})});await new Promise(r=>setImmediate(r));assert.equal(applied.length,0);
 requests[1]({exists:()=>true,data:()=>({owner:true})});await load;assert.deepEqual(applied,[{owner:true}]);assert.equal(writes.length,0);
 await listeners['operation-settings-changed']({detail:{reason:'migration',operation:{}}});assert.equal(writes.length,0);
 await listeners['operation-settings-changed']({detail:{reason:'user',operation:{}}});assert.equal(writes.length,1);
});
