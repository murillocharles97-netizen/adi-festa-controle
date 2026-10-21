'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),{webcrypto}=require('node:crypto');
const storageSource=fs.readFileSync('js/storage.js','utf8'),checkoutSource=fs.readFileSync('js/checkout.js','utf8'),syncSource=fs.readFileSync('js/firebase/sync.js','utf8');
const section=(source,start,end)=>{const from=source.indexOf(start),to=source.indexOf(end,from);assert.ok(from>=0&&to>from);return source.slice(from,to);};
const clone=value=>JSON.parse(JSON.stringify(value));
const permissions=['sales.create','sales.cancel','customers.view','products.view','inventory.view'];
const seed=()=>({config:{nome:'QA business',recentClientIds:['shared-preference-must-not-be-inherited']},clientes:[{id:'qa-client-a',nome:'Cliente QA',telefone:'11999990000'}],produtos:[],vendas:[]});

function runtime(shared={values:new Map(),records:new Map()}){
  let origin={businessId:'qa-business',workspaceGeneration:0},staged=0,failPreferenceWrites=false,changes=0;
  let markup='',pickerDom=null,nextTimer=0;
  const timers=new Map(),modal={get innerHTML(){return markup;},set innerHTML(value){markup=value;pickerDom=value.includes('client-picker')?{search:{value:''},results:{innerHTML:''},more:{textContent:''},close:{onclick:null}}:null;},onclick:null},select={value:'',dispatchEvent(){changes++;}};
  const c={console,structuredClone,crypto:webcrypto,Date,Map,Set,Math,Number,String,Boolean,Array,Object,JSON,Error,Promise,
    localStorage:{getItem:key=>shared.values.get(key)??null,setItem:(key,value)=>{if(failPreferenceWrites&&key.includes(':localPreferences:'))throw Error('QA blocked preference storage');shared.values.set(key,String(value));},removeItem:key=>shared.values.delete(key)},
    Utils:{uuid:()=>webcrypto.randomUUID(),escapar:String,dinheiro:String,somenteNumeros:value=>String(value||'').replace(/\D/g,''),toast(){}},PhoneUtils:{normalizeBrazilianPhone:value=>value},
    WorkspaceRuntime:{capture:()=>origin},BusinessContext:{hasPermission:permission=>permissions.includes(permission)},FirebaseSession:null,
    CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},Event:class{constructor(type){this.type=type;}},addEventListener(){},dispatchEvent(){},
    setTimeout:callback=>{const id=++nextTimer;timers.set(id,callback);return id;},clearTimeout:id=>timers.delete(id),
    document:{querySelector:selector=>({'#modal':modal,'#sale-client':select,'#client-picker-search':pickerDom?.search,'#client-result-list':pickerDom?.results,'#client-result-more':pickerDom?.more}[selector]),querySelectorAll:selector=>selector==='#modal .close'&&pickerDom?[pickerDom.close]:[]},
    clients:()=>({list:()=>c.DB.carregar().clientes,getById:id=>c.DB.carregar().clientes.find(client=>client.id===id)}),refresh(){},quickClient(){throw Error('Unexpected new-client action');},escapar:String,balance:()=>'',norm:String,
  };c.window=c;vm.createContext(c);vm.runInContext(storageSource,c);
  c.DB.businessCache={open:async key=>structuredClone(shared.records.get(key)||seed()),stage:(data,key)=>{staged++;shared.records.set(key,structuredClone(data));},release:async()=>{}};
  c.DB.flush=async()=>{};
  const open=async(uid='seller-a',businessId='qa-business',signature='permissions-a',generation=0)=>{
    origin={businessId,workspaceGeneration:generation};c.FirebaseSession={user:{uid},businessId,profile:{businessId,role:'seller'}};
    await c.DB.useBusiness(businessId,{uid,permissionSignature:signature,workspaceGeneration:generation});
  };
  return{c,shared,open,modal,select,dom:()=>pickerDom,timerCallbacks:()=>[...timers.values()],staged:()=>staged,changes:()=>changes,changeWorkspace:next=>{origin=next;},failPreferenceWrites:()=>{failPreferenceWrites=true;},choose:id=>{vm.runInContext(section(checkoutSource,'  const row =','  const dateLabel =')+'\nthis.openPicker=picker;',c);c.openPicker();modal.onclick({target:{closest:selector=>selector==='[data-choose-client]'?{dataset:{chooseClient:id}}:null}});}};
}

test('real checkout picker remembers a client without DB.alterar, business persistence or changing a retained queue',async()=>{
  const h=runtime();await h.open();const before=JSON.stringify(h.c.DB.carregar()),staged=h.staged(),queue=[{operationId:'qa-retained',status:'error',attempts:11}],beforeQueue=JSON.stringify(queue);
  h.c.DB.alterar=()=>{throw Error('Client selection must not mutate business data');};h.c.DB.salvar=()=>{throw Error('Client selection must not persist business data');};
  assert.equal(h.c.BusinessContext.hasPermission('settings.manage'),false);h.choose('qa-client-a');
  assert.equal(h.select.value,'qa-client-a');assert.equal(h.changes(),1);assert.deepEqual(clone(h.c.DB.getRecentClientIds()),['qa-client-a']);
  assert.equal(JSON.stringify(h.c.DB.carregar()),before);assert.equal(h.staged(),staged);assert.equal(JSON.stringify(queue),beforeQueue);
});

for(const [label,uid,businessId,generation]of [
  ['account','seller-b','qa-business',0],
  ['business','seller-a','qa-other-business',0],
  ['workspace generation','seller-a','qa-business',1],
])test(`stale picker cannot select or remember an old client after changing ${label}`,async()=>{
  const h=runtime();await h.open();let callbacks=0;
  vm.runInContext(section(checkoutSource,'  const row =','  const dateLabel =')+'\nthis.openPicker=picker;',h.c);
  h.c.openPicker(()=>{callbacks++;});const oldHandler=h.modal.onclick;
  await h.open(uid,businessId,'permissions-a',generation);
  const data=JSON.stringify(h.c.DB.carregar()),staged=h.staged(),preferences=JSON.stringify([...h.shared.values]);
  h.c.DB.alterar=()=>{throw Error('Stale picker must not mutate business data');};
  oldHandler({target:{closest:selector=>selector==='[data-choose-client]'?{dataset:{chooseClient:'client-from-old-account'}}:null}});
  assert.equal(h.select.value,'');assert.equal(h.changes(),0);assert.equal(callbacks,0);assert.deepEqual(clone(h.c.DB.getRecentClientIds()),[]);
  assert.equal(JSON.stringify(h.c.DB.carregar()),data);assert.equal(h.staged(),staged);assert.equal(JSON.stringify([...h.shared.values]),preferences);
});

test('late search from account A cannot render its clients into or select from account B picker',async()=>{
  const h=runtime();await h.open();h.c.DB.salvar({...h.c.DB.carregar(),clientes:[{id:'old-client-a',nome:'OLD ACCOUNT A',telefone:'11999990000'}]});
  vm.runInContext(section(checkoutSource,'  const row =','  const dateLabel =')+'\nthis.openPicker=picker;',h.c);
  h.c.openPicker();const oldDom=h.dom(),oldClick=h.modal.onclick;oldDom.search.value='OLD';oldDom.search.oninput();
  const [lateSearch]=h.timerCallbacks();assert.equal(typeof lateSearch,'function');
  await h.open('seller-b');h.c.openPicker();const nextDom=h.dom();nextDom.results.innerHTML='CURRENT ACCOUNT B';
  const markup=h.modal.innerHTML,data=JSON.stringify(h.c.DB.carregar()),staged=h.staged(),preferences=JSON.stringify([...h.shared.values]);
  lateSearch();oldClick({target:{closest:selector=>selector==='[data-choose-client]'?{dataset:{chooseClient:'old-client-a'}}:null}});
  assert.equal(nextDom.results.innerHTML,'CURRENT ACCOUNT B');assert.equal(nextDom.more.textContent,'');assert.equal(h.modal.innerHTML,markup);assert.doesNotMatch(h.modal.innerHTML,/OLD ACCOUNT A/);
  assert.equal(h.select.value,'');assert.equal(h.changes(),0);assert.deepEqual(clone(h.c.DB.getRecentClientIds()),[]);
  assert.equal(JSON.stringify(h.c.DB.carregar()),data);assert.equal(h.staged(),staged);assert.equal(JSON.stringify([...h.shared.values]),preferences);
});

test('closing cancels picker search and replaced DOM ignores late callbacks even in the same account',async()=>{
  const h=runtime();await h.open();vm.runInContext(section(checkoutSource,'  const row =','  const dateLabel =')+'\nthis.openPicker=picker;',h.c);
  h.c.openPicker();const closedDom=h.dom();closedDom.search.value='QA';closedDom.search.oninput();const [afterClose]=h.timerCallbacks();
  closedDom.close.onclick();assert.equal(h.timerCallbacks().length,0);assert.equal(h.modal.innerHTML,'');afterClose();assert.equal(h.modal.innerHTML,'');assert.equal(closedDom.results.innerHTML,'');
  h.c.openPicker();const replacedDom=h.dom();replacedDom.search.value='QA';replacedDom.search.oninput();const [afterReplacement]=h.timerCallbacks();
  h.c.openPicker();const currentDom=h.dom(),currentMarkup=h.modal.innerHTML;currentDom.results.innerHTML='CURRENT PICKER';afterReplacement();
  assert.equal(currentDom.results.innerHTML,'CURRENT PICKER');assert.equal(h.modal.innerHTML,currentMarkup);assert.equal(replacedDom.results.innerHTML,'');
});

test('recent clients persist after a fresh runtime and are isolated by UID, business and workspace generation',async()=>{
  const h=runtime();await h.open();assert.deepEqual(clone(h.c.DB.getRecentClientIds()),[]);h.c.DB.rememberRecentClient('qa-client-a');
  await h.open('seller-b');assert.deepEqual(clone(h.c.DB.getRecentClientIds()),[]);h.c.DB.rememberRecentClient('qa-client-b');
  await h.open('seller-a','qa-other-business');assert.deepEqual(clone(h.c.DB.getRecentClientIds()),[]);
  await h.open('seller-a','qa-business','changed-permissions');assert.deepEqual(clone(h.c.DB.getRecentClientIds()),['qa-client-a']);
  await h.open('seller-a','qa-business','changed-permissions',1);assert.deepEqual(clone(h.c.DB.getRecentClientIds()),[]);
  const reloaded=runtime(h.shared);await reloaded.open();assert.deepEqual(clone(reloaded.c.DB.getRecentClientIds()),['qa-client-a']);
  await reloaded.c.DB.releaseBusiness();assert.deepEqual(clone(reloaded.c.DB.getRecentClientIds()),[]);reloaded.c.DB.rememberRecentClient('signed-out-id');
  await reloaded.open('seller-b');assert.deepEqual(clone(reloaded.c.DB.getRecentClientIds()),['qa-client-b']);
});

test('local preference limits are deterministic and unavailable storage never blocks client selection',async()=>{
  const h=runtime();await h.open();h.failPreferenceWrites();
  for(const id of ['a','b','c','d','e','f','c'])h.c.DB.rememberRecentClient(id);
  assert.deepEqual(clone(h.c.DB.getRecentClientIds()),['c','f','e','d','b']);
  const returned=h.c.DB.getRecentClientIds();returned.push('not-persisted');assert.deepEqual(clone(h.c.DB.getRecentClientIds()),['c','f','e','d','b']);
  h.choose('qa-client-a');assert.equal(h.select.value,'qa-client-a');assert.equal(h.c.DB.getRecentClientIds()[0],'qa-client-a');
});

test('preference reads and clean reload/operation hydration do not synthesize shared settings differences',async()=>{
  const h=runtime();await h.open();const normalized=clone(h.c.DB.carregar());delete normalized.config.recentClientIds;h.c.DB.salvar(normalized);
  h.c.SOURCES={clients:{key:'clientes'},products:{key:'produtos'},sales:{key:'vendas'}};h.c.sourceItems=(data,name)=>data[h.c.SOURCES[name].key]||[];
  h.c.activeBusinessId=()=>h.c.DB.getBusinessId();h.c.now=()=>new Date().toISOString();
  vm.runInContext(section(syncSource,'function changedFields(','function captureChanges('),h.c);
  vm.runInContext(fs.readFileSync('js/operation-mode.js','utf8'),h.c);
  const before=clone(h.c.DB.carregar());
  for(let n=0;n<5;n++){h.c.DB.getRecentClientIds();h.c.OperationMode.applyRemote({operationMode:'physical_store',creditMode:'disabled'});h.c.DB.prepare(structuredClone(h.c.DB.carregar()));}
  h.c.DB.alterar(()=>{});assert.equal('recentClientIds'in h.c.DB.carregar().config,false);assert.deepEqual(clone(h.c.diffWrites(before,h.c.DB.carregar())),[]);
});

for(const role of ['seller','owner'])test(`${role}: business bootstrap hydrates normalized config without capturing a settings edit`,async()=>{
  const h=runtime();await h.open(role);h.c.FirebaseSession.profile.role=role;
  h.c.SOURCES={clients:{key:'clientes'},products:{key:'produtos'},sales:{key:'vendas'}};h.c.sourceItems=(data,name)=>data[h.c.SOURCES[name].key]||[];
  h.c.activeBusinessId=()=>h.c.DB.getBusinessId();h.c.now=()=>new Date().toISOString();h.c.currentUser={uid:role};h.c.originalAlter=null;h.c.applyingCloud=false;
  const queue=[{operationId:'qa-original',status:'error',attempts:11}],originalQueue=JSON.stringify(queue);
  h.c.queueWrites=(writes,id,eventKind)=>{if(writes.length)queue.push({writes,id,eventKind});return writes.length;};
  vm.runInContext(section(syncSource,'function changedFields(','async function validateUser()'),h.c);h.c.installOfflineFirstStorage();
  const clients=JSON.stringify(h.c.DB.carregar().clientes),business={name:'Hydrated QA business',phone:'11999990000'},profile={businessId:'qa-business'};
  h.c.DB.salvar({...h.c.DB.carregar(),config:{nome:'Adi Festa',untouched:'preserve'}});
  const auth=fs.readFileSync('js/firebase/auth.js','utf8');
  const hydration=section(auth,"  if(profile.businessId!==INTERNAL_BUSINESS_ID){","  bootstrapLog('local environment loaded');");
  Object.assign(h.c,{profile,business,INTERNAL_BUSINESS_ID:'adi-festa'});vm.runInContext(hydration,h.c);
  assert.equal(h.c.DB.carregar().config.nome,business.name);assert.equal(h.c.DB.carregar().config.telefone,business.phone);assert.equal(h.c.DB.carregar().config.untouched,'preserve');
  assert.equal(h.c.DB.carregar().config.appSchemaVersion,14);assert.equal(JSON.stringify(h.c.DB.carregar().clientes),clients);assert.equal(JSON.stringify(queue),originalQueue);
  h.changeWorkspace({businessId:'qa-other-business',workspaceGeneration:0});assert.throws(()=>h.c.DB.hydrateConfig({nome:'must-not-apply'}),{code:'workspace-generation-mismatch'});
  assert.equal(h.c.DB.carregar().config.nome,business.name);assert.equal(JSON.stringify(queue),originalQueue);
});
