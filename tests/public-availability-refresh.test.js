'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('js/catalogo-publico.js','utf8'),start=source.indexOf('let availabilityRefresh=null;'),end=source.indexOf('// Refresh ONLY',start);
function harness(extra={}){
  const state={reads:0,renders:0,cached:[],errors:[],cart:{'catalog-qa':1},catalog:{businessId:'qa-business',spaceId:'qa-space',workspaceGeneration:0,items:[{availableQuantity:3}]},view:'catalog',navigator:{onLine:true},v2:()=>true,prepareCatalogIdentity(){},console:{warn(){}},
    publicCatalogError:(code,message)=>Object.assign(Error(message),{code}),normalizedCatalogErrorCode:e=>e.code||'network',...extra};
  state.loadPublicCatalog=extra.loadPublicCatalog||async function(){state.reads++;return {...state.catalog,items:[{availableQuantity:2}]};};
  state.render=()=>state.renders++;state.showCatalogError=code=>state.errors.push(code);
  state.DB={localRecords:{transaction:async(_,fn)=>fn({put:record=>state.cached.push(record)},()=>{})}};state.visitToken='qa-token';
  vm.createContext(state);vm.runInContext(source.slice(start,end),state);return state;
}
test('public refresh uses a single current-store read, updates IndexedDB and keeps cart',async()=>{
  const s=harness();await Promise.all([s.refreshPublicAvailability(),s.refreshPublicAvailability()]);
  assert.equal(s.reads,1);assert.equal(s.catalog.items[0].availableQuantity,2);assert.equal(s.cached[0].scope,'public-catalog:qa-token');assert.equal(s.cart['catalog-qa'],1);
});
test('offline/checkout refresh performs no read and cannot erase form inputs',async()=>{
  for(const extra of [{view:'checkout'},{navigator:{onLine:false}}]){const s=harness(extra);assert.equal(await s.refreshPublicAvailability(),false);assert.equal(s.reads,0);assert.equal(s.renders,0);}
});
test('changed business/space/generation never replaces catalog or authorizes checkout',async()=>{
  for(const change of [{businessId:'other'},{spaceId:'other'},{workspaceGeneration:1}]){
    const s=harness({loadPublicCatalog:async()=>({businessId:'qa-business',spaceId:'qa-space',workspaceGeneration:0,...change})});
    assert.equal(await s.refreshPublicAvailability(),false);assert.equal(s.catalog.active,false);assert.equal(s.errors[0],'inactive');assert.equal(s.cart['catalog-qa'],1);assert.equal(s.cached.length,0);
  }
});
test('failed reconstructable cache write does not undo successful public refresh',async()=>{
  const s=harness();s.DB.localRecords.transaction=async()=>{throw Error('quota');};assert.equal(await s.refreshPublicAvailability(),true);assert.equal(s.catalog.items[0].availableQuantity,2);assert.equal(s.errors.length,0);
});
test('catalog return refresh is registered AFTER navigation, without a premature microtask',()=>{
  const navigation=source.indexOf("root.addEventListener('click',event=>{const add="),refresh=source.indexOf("root.addEventListener('click',event=>{if(event.target.closest('[data-view=\"catalog\"]'))refreshPublicAvailability();});");
  assert.ok(navigation>0&&refresh>navigation);assert.equal(source.includes('queueMicrotask(()=>refreshPublicAvailability())'),false);
});
