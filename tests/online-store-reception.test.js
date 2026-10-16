'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function fixture(handler){
  const context={console,structuredClone,navigator:{onLine:true},document:{querySelector:()=>null},
    BusinessContext:{getCurrentBusinessId:()=> 'business-qa'},FirebaseSession:{user:{uid:'qa-owner'}},
    SpaceContext:{salesSpaces:()=>[{id:'space-qa',name:'VECONI QA'},{id:'space-other',name:'QA isolamento'}]},
    WorkspaceRuntime:{capture:()=>({workspaceGeneration:0})},FirebaseCallable:handler};
  context.window=context;vm.createContext(context);
  vm.runInContext(fs.readFileSync('js/online-store-ui.js','utf8').replace('window.OnlineStoreUI={render,bind:()=>load()};','window.OnlineStoreUI={render,bind:()=>load()};window.testReception={state,receptionPanel,changeReception};'),context);
  const api=context.testReception;Object.assign(api.state,{spaceId:'space-qa',sequence:1,receptionConfirm:true,
    data:{owner:true,store:{revision:2,published:true,checkoutEnabled:false},orderReception:{enabled:false,canEnable:true,reason:'paused'}},
    draft:{checkoutEnabled:false,publicName:'UNSAVED BRAND',productIds:[]}});
  return {context,...api};
}
test('paused/receiving status comes from persisted live state, never unsaved checkbox',()=>{
  const f=fixture();f.state.draft.checkoutEnabled=true;
  assert.match(f.receptionPanel(),/Pedidos pausados/);assert.match(f.receptionPanel(),/>Ativar pedidos<\/button>/);
  f.state.data.orderReception.enabled=true;assert.match(f.receptionPanel(),/Recebendo pedidos/);assert.match(f.receptionPanel(),/>Pausar pedidos<\/button>/);
});
test('confirmation names exact space; non-owner and unready publication cannot activate',()=>{
  const f=fixture();assert.match(f.receptionPanel(),/Ativar pedidos em “VECONI QA”/);
  f.state.data.owner=false;assert.match(f.receptionPanel(),/data-reception disabled/);
  f.state.data.owner=true;f.state.receptionConfirm=null;f.state.data.orderReception={enabled:false,canEnable:false,reason:'not_published'};
  assert.match(f.receptionPanel(),/Publique esta loja/);assert.match(f.receptionPanel(),/data-reception disabled/);
});
test('double click sends one scoped request and no draft/product/stock payload',async()=>{
  let resolve,calls=[];const f=fixture((name,data)=>{calls.push({name,data});return new Promise(r=>{resolve=r;});});
  const one=f.changeReception();await f.changeReception();assert.equal(calls.length,1);
  assert.deepEqual(JSON.parse(JSON.stringify(calls[0])),{name:'saveOnlineStore',data:{businessId:'business-qa',spaceId:'space-qa',workspaceGeneration:0,action:'set_order_reception',enabled:true,confirmed:true,revision:2}});
  resolve({data:{store:{revision:3,checkoutEnabled:true},orderReception:{enabled:true,canEnable:true}}});await one;
  assert.equal(f.state.data.orderReception.enabled,true);assert.equal(f.state.draft.publicName,'UNSAVED BRAND');assert.equal(f.state.draft.productIds.length,0);
  assert.equal(f.state.receptionConfirm,null);assert.equal(f.state.busy,false);
});
test('offline/network error never claims activated state and keeps draft',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;throw Error('Network error');});
  f.context.navigator.onLine=false;await f.changeReception();assert.equal(calls,0);assert.equal(f.state.data.orderReception.enabled,false);
  f.context.navigator.onLine=true;await f.changeReception();assert.equal(calls,1);assert.match(f.state.receptionMessage,/Não foi possível confirmar/);
  assert.equal(f.state.data.orderReception.enabled,false);assert.equal(f.state.draft.publicName,'UNSAVED BRAND');
});
test('wrong/missing backend confirmation never shows success',async()=>{
  const f=fixture(async()=>({data:{store:{checkoutEnabled:true},orderReception:{enabled:false}}}));await f.changeReception();
  assert.equal(f.state.data.orderReception.enabled,false);assert.match(f.state.receptionMessage,/Recarregue/);
});
test('non-owner cannot call backend even if handler is invoked directly',async()=>{
  let calls=0;const f=fixture(async()=>{calls++;});f.state.data.owner=false;await f.changeReception();assert.equal(calls,0);
});
test('old response cannot activate UI of another space',async()=>{
  let resolve;const f=fixture(()=>new Promise(r=>{resolve=r;})),pending=f.changeReception();
  f.state.sequence++;f.state.spaceId='space-other';f.state.data={owner:true,store:{revision:1},orderReception:{enabled:false}};
  resolve({data:{store:{checkoutEnabled:true},orderReception:{enabled:true}}});await pending;
  assert.equal(f.state.data.orderReception.enabled,false);
});
