const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');

const storageSource=read('js/storage.js');
const memory=new Map();
const localStorage={
  getItem:key=>memory.has(key)?memory.get(key):null,
  setItem:(key,value)=>memory.set(key,String(value)),
  removeItem:key=>memory.delete(key)
};
const context={
  console,
  structuredClone,
  crypto:require('node:crypto').webcrypto,
  localStorage,
  Utils:{uuid:()=>crypto.randomUUID()},
  PhoneUtils:{normalizeBrazilianPhone:value=>String(value||'').replace(/\D/g,'')},
  window:null
};
context.window=context;
vm.createContext(context);
vm.runInContext(storageSource,context,{filename:'storage.js'});

context.DB.useBusiness('biz_empresa_a');
context.DB.alterar(data=>{
  data.config.nome='Empresa A';
  data.clientes.push({id:'cliente-a',nome:'Somente A',saldo:0});
});
context.DB.useBusiness('biz_empresa_b');
assert.equal(context.DB.carregar().clientes.length,0);
assert.notEqual(context.DB.carregar().config.nome,'Empresa A');
context.DB.alterar(data=>data.produtos.push({id:'produto-b',nome:'Somente B'}));
context.DB.useBusiness('biz_empresa_a');
assert.equal(context.DB.carregar().clientes[0].id,'cliente-a');
assert.equal(context.DB.carregar().produtos.length,0);
assert.ok(memory.has('adiFestaDB_v1:biz_empresa_a'));
assert.ok(memory.has('adiFestaDB_v1:biz_empresa_b'));

const sync=read('js/firebase/sync.js');
assert.match(sync,/adiFesta:\$\{namespace\(\)\}:syncQueue/);
assert.match(sync,/item\.businessId&&item\.businessId!==businessId\|\|item\.userId&&item\.userId!==currentUser\.uid/);
assert.match(sync,/businessId:activeBusinessId\(\)/);
assert.doesNotMatch(sync,/profile\?\.businessId\|\|'adi-festa'/);

const repository=read('js/firebase/firestore-repository.js');
assert.match(repository,/BusinessContext\?\.getCurrentBusinessId/);
assert.doesNotMatch(repository,/\|\|'adi-festa'/);

const auth=read('js/firebase/auth.js');
assert.match(auth,/businessIdFor=user=>`biz_\$\{user\.uid\}`/);
assert.match(auth,/planId:'trial',status:'trial'/);
assert.match(auth,/profile\.businessId!==LEGACY_BUSINESS_ID/);
assert.match(auth,/planId:'internal',status:'active'/);
assert.match(auth,/DB\.useBusiness\(profile\.businessId/);

const rules=read('firestore.rules');
assert.match(rules,/currentBusinessId\(\) == businessId/);
assert.match(rules,/request\.resource\.data\.subscription == resource\.data\.subscription/);
assert.match(rules,/request\.resource\.data\.limits == resource\.data\.limits/);
assert.match(rules,/businessId == selfOnboardingBusinessId\(\)/);
assert.match(rules,/request\.resource\.data\.businessId == catalog\(\)\.businessId/);
assert.match(rules,/allow list: if false/);

const catalogBridge=read('js/firebase/catalog-bridge.js');
const publicCatalog=read('js/catalogo-publico.js');
assert.match(catalogBridge,/businessSlug:business\.slug/);
assert.match(catalogBridge,/businessName:business\.name/);
assert.match(catalogBridge,/publicSettings:/);
assert.match(publicCatalog,/businessId:catalog\.businessId/);

const backup=read('js/backup.js');
assert.match(backup,/declared&&declared!==currentBusinessId/);

const businessModule=read('js/firebase/business-context.js').replace(/^export /gm,'')+'\n;globalThis.__businessTest={getSubscriptionAccess,PLANS};';
const businessSandbox={window:null,structuredClone,dispatchEvent:()=>{},CustomEvent:function(){},console};
businessSandbox.window=businessSandbox;
vm.createContext(businessSandbox);
vm.runInContext(businessModule,businessSandbox,{filename:'business-context.js'});
const {getSubscriptionAccess,PLANS}=businessSandbox.__businessTest;
const base=new Date('2026-07-23T12:00:00Z');
const activeTrial=getSubscriptionAccess({status:'trial',trialEndsAt:'2026-07-29T12:00:00Z'},{catalogEnabled:true,campaignsEnabled:true},base);
assert.equal(activeTrial.canAccessApp,true);
assert.equal(activeTrial.daysRemaining,6);
const endingTrial=getSubscriptionAccess({status:'trial',trialEndsAt:'2026-07-25T12:00:00Z'},{},base);
assert.equal(endingTrial.showBillingWarning,true);
const expiredTrial=getSubscriptionAccess({status:'trial',trialEndsAt:'2026-07-22T12:00:00Z'},{},base);
assert.equal(expiredTrial.canCreateData,false);
assert.equal(expiredTrial.reason,'trial_expired');
assert.equal(PLANS.internal.limits.clients,999999);

console.log('multitenant.test.js: OK');
