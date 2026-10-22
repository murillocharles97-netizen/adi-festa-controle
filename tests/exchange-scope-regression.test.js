const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Fake identities and read-only callable responses only. No Firebase SDK, network,
// persistent storage, commercial operation, or production account is used here.
const space=(id,sales=true,extra={})=>({id,businessId:'biz',status:'active',active:true,capabilities:{sales},...extra});
const adjustment=(id,spaceId='a',extra={})=>({id,businessId:'biz',spaceId,workspaceGeneration:0,originalSaleId:'original',status:'completed',returnCents:5000,newCents:8000,differenceCents:3000,createdAt:'2026-10-22T12:00:00Z',...extra});
const copy=value=>JSON.parse(JSON.stringify(value));
function runtime({role='owner',permissions,spaces=[space('a'),space('finance-only',false)],allowedSpaceIds=['a'],entitled=true}={}){
  let user=role,selection='all_spaces',entitlement=entitled,loaded=true;
  let context={businessId:'biz',role,permissions:permissions||[role==='owner'?'*':'sales.create'],permissionSignature:'initial',spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds,business:{id:'biz',ownerId:'owner',workspaceGeneration:0},member:{status:'active'},userProfile:{uid:role,businessId:'biz',active:true},access:{canAccessApp:true,canMutate:entitled,features:{basicSales:entitled,sales:entitled,'sales.create':entitled},entitlementsVersion:1},loading:false};
  let records=copy(spaces),handler=async input=>({data:{businessId:input.businessId,workspaceGeneration:0,items:[],nextCursor:null}});
  const calls=[],events=[],listeners=new Map();
  const has=permission=>context.role==='owner'||context.permissions.includes('*')||context.permissions.includes(permission);
  const sandbox={window:null,console,Date,JSON,Promise,Array,Object,Map,Set,Number,String,Math,navigator:{onLine:true},
    FirebaseSession:{get user(){return user?{uid:user}:null}},DB:{getBusinessId:()=>context.businessId},
    BusinessContext:{get:()=>copy(context),canAccessSpace:id=>context.spaceAccess==='all'||context.allowedSpaceIds.includes(id),hasPermission:has},
    TeamAccess:{has,canReadOperationalSales:()=>has('sales.create')||has('sales.viewAll')},
    PlanLimitService:{canUseFeature:()=>({ok:entitlement}),canUseAction:()=>({ok:entitlement})},
    SubscriptionService:{getAccess:()=>({...context.access,features:{basicSales:entitlement,sales:entitlement,'sales.create':entitlement}})},
    SpaceContext:{ALL_SPACES:'all_spaces',list:()=>copy(records),homeId:()=>selection,salesId:()=>selection,snapshot:()=>({homeId:selection,salesId:selection,loaded}),
      salesSpaces:()=>copy(records.filter(row=>row.businessId===context.businessId&&row.status==='active'&&row.active!==false&&row.capabilities?.sales===true&&(context.spaceAccess==='all'||context.allowedSpaceIds.includes(row.id))))},
    CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail}},
    addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(callback)},
    dispatchEvent(event){events.push(event.type);for(const listener of listeners.get(event.type)||[])listener(event)},
    FirebaseCallable:async(name,input)=>{assert.equal(name,'listSaleExchangeAdjustments');calls.push(copy(input));return handler(copy(input))}};
  sandbox.window=sandbox;vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync('js/exchange-economics.js','utf8'),sandbox);
  return {api:sandbox.ExchangeEconomics,s:sandbox,calls,events,
    setHandler:value=>{handler=value},setSpaces:value=>{records=copy(value)},
    setContext:value=>{context={...context,...copy(value)}},setUser:value=>{user=value},
    setEntitled:value=>{entitlement=value;context.access={...context.access,canMutate:value,features:{basicSales:value,sales:value,'sales.create':value}}},
    setSelection:value=>{selection=value},setLoaded:value=>{loaded=value},emit:(type,detail={})=>sandbox.dispatchEvent(new sandbox.CustomEvent(type,{detail}))};
}

test('owner mixed-space dashboard queries only same-business active sales spaces',async()=>{
  const r=runtime({spaces:[space('a'),space('finance-only',false),space('b'),space('foreign',true,{businessId:'other'}),space('archived',true,{status:'archived',active:false}),space('unowned',true,{businessId:null})]});
  r.setHandler(async input=>{assert.ok(['a','b'].includes(input.spaceId),'ineligible space must not reach backend');return{data:{businessId:'biz',workspaceGeneration:0,items:[adjustment(`ex-${input.spaceId}`,input.spaceId)],nextCursor:null}}});
  await r.api.refresh();assert.deepEqual(r.calls.map(call=>call.spaceId).sort(),['a','b']);
  assert.equal(r.api.state().ready,true);assert.equal(r.api.state().error,'');assert.equal(r.api.total({businessId:'biz'}),60);
});

test('seller operational read never requests unassigned spaces or finance-only spaces',async()=>{
  const r=runtime({role:'seller',spaces:[space('a'),space('b'),space('finance-only',false)],allowedSpaceIds:['a','finance-only']});
  await r.api.refresh();assert.deepEqual(r.calls.map(call=>call.spaceId),['a']);assert.equal(r.api.state().ready,true);
});

test('canonical sales-space source cannot grant access through contradictory business links',async()=>{
  const r=runtime({spaces:[space('a'),space('conflicting',true,{linkedBusinessId:'other'})]});
  await r.api.refresh();assert.deepEqual(r.calls.map(call=>call.spaceId),['a']);assert.equal(r.api.state().ready,true);
});

test('unknown sales capability waits for authoritative scope rather than confirming empty financial data',async()=>{
  const r=runtime({spaces:[space('a'),space('unknown',true,{capabilities:{}})]});
  await r.api.refresh();assert.equal(r.calls.length,0);assert.equal(r.api.state().ready,false);assert.equal(r.api.state().error,'');
});

test('without TeamAccess the effective permission object allows only explicit operational read grants',async()=>{
  const r=runtime({role:'seller',spaces:[space('a')]});delete r.s.TeamAccess;
  r.setContext({permissions:{'sales.viewAll':true,'financial.view':false,'sales.create':false}});
  await r.api.refresh();assert.deepEqual(r.calls.map(call=>call.spaceId),['a']);assert.equal(r.api.state().ready,true);
  r.setContext({permissions:{'sales.viewAll':false,'financial.view':true},permissionSignature:'revoked'});
  await r.api.refresh();assert.equal(r.calls.length,1);assert.equal(r.api.state().ready,false);
});

test('sales.viewAll read-only profile can load only its authorized sales projection',async()=>{
  const r=runtime({role:'seller',permissions:['sales.viewAll'],spaces:[space('a')]});
  await r.api.refresh();assert.deepEqual(r.calls.map(call=>call.spaceId),['a']);assert.equal(r.api.state().ready,true);
});

test('profile without operational sales permission does not call the adjustments endpoint',async()=>{
  const r=runtime({role:'seller',permissions:['products.view'],spaces:[space('a')]});
  await r.api.refresh();assert.equal(r.calls.length,0);assert.equal(r.api.state().error,'');
});

test('disabled effective sales entitlement does not send a forbidden call even for owner',async()=>{
  const r=runtime({entitled:false,spaces:[space('a')]});
  await r.api.refresh();assert.equal(r.calls.length,0);assert.equal(r.api.state().error,'');
});

test('read-only subscription with basicSales retains read permission without requiring mutation entitlement',async()=>{
  const r=runtime({spaces:[space('a')]});r.setContext({access:{canAccessApp:true,canMutate:false,readOnly:true,features:{basicSales:true,sales:true,'sales.create':true}}});
  r.s.PlanLimitService.canUseFeature=()=>({ok:false,reason:'subscription_inactive'});
  await r.api.refresh();assert.deepEqual(r.calls.map(call=>call.spaceId),['a']);assert.equal(r.api.state().ready,true);
});

test('no eligible sales space is confirmed empty, not a spurious provisional financial error',async()=>{
  const r=runtime({spaces:[space('finance-only',false)]});
  await r.api.refresh();assert.equal(r.calls.length,0);assert.equal(r.api.state().ready,true);
  assert.equal(r.api.state().error,'');assert.equal(r.api.total({businessId:'biz'}),0);assert.doesNotMatch(r.api.statusMessage(),/provisórios|não confirmados/);
});

test('reload bootstrap waits for spaces-ready rather than confirming an empty yet unknown scope',async()=>{
  const r=runtime({spaces:[space('a')]});r.setLoaded(false);
  await r.api.refresh();assert.equal(r.calls.length,0);assert.equal(r.api.state().ready,false);assert.equal(r.api.state().error,'');
  r.setLoaded(true);r.emit('veconi-spaces-ready');await r.api.refresh();
  assert.deepEqual(r.calls.map(call=>call.spaceId),['a']);assert.equal(r.api.state().ready,true);
});

test('finance-only current selection does not leak exchange rows from another space',async()=>{
  const r=runtime();r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('a')],nextCursor:null}}));
  await r.api.refresh();assert.equal(r.api.total({businessId:'biz',spaceSelectionId:'finance-only'}),0);assert.equal(r.api.total({businessId:'biz',spaceSelectionId:'a'}),30);
});

test('real 403 on an eligible authorized sales space remains visible and provisional',async()=>{
  const r=runtime({spaces:[space('a')]});r.setHandler(async()=>{throw Object.assign(Error('permission-denied: authorized sales source refused'),{code:'functions/permission-denied'})});
  await r.api.refresh();assert.equal(r.calls.length,1);assert.equal(r.api.state().ready,false);assert.match(r.api.state().error,/permission-denied/);assert.match(r.api.statusMessage(),/provisórios/);
});

test('excluding non-sales spaces never hides a real failed sales source in the same company',async()=>{
  const r=runtime({spaces:[space('finance-only',false),space('a'),space('b')]});
  r.setHandler(async input=>{assert.notEqual(input.spaceId,'finance-only');if(input.spaceId==='b')throw Error('authorized financial projection unavailable');return{data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('valid-a')],nextCursor:null}}});
  await r.api.refresh();assert.deepEqual(r.calls.map(call=>call.spaceId),['a','b']);assert.equal(r.api.state().ready,false);assert.match(r.api.state().error,/unavailable/);assert.match(r.api.statusMessage(),/provisórios/);
});

test('malformed economic delta is not hidden by scope filtering',async()=>{
  const r=runtime({spaces:[space('a')]});r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('bad','a',{differenceCents:1})],nextCursor:null}}));
  await r.api.refresh();assert.equal(r.api.state().ready,false);assert.match(r.api.state().error,/revisão/);
});

test('foreign business response is never accepted as confirmed',async()=>{
  const r=runtime({spaces:[space('a')]});r.setHandler(async()=>({data:{businessId:'other',workspaceGeneration:0,items:[],nextCursor:null}}));
  await r.api.refresh();assert.equal(r.api.state().ready,false);assert.match(r.api.state().error,/confirmar/);
});

test('changed sales capability invalidates ready cache before any new response',async()=>{
  const r=runtime({spaces:[space('a')]});r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('old')],nextCursor:null}}));
  await r.api.refresh();assert.equal(r.api.state().ready,true);
  r.setSpaces([space('a',false)]);assert.equal(r.api.state().ready,false,'cached scope no longer matches effective spaces');
  await r.api.refresh();assert.equal(r.api.state().ready,false);assert.equal(r.api.state().mode,'historical');assert.equal(r.calls.length,1);
  assert.doesNotMatch(r.api.statusMessage(),/Nenhum espaço de Vendas/);
});

test('disabling sales without any known commercial history stays not-applicable rather than an error',async()=>{
  const r=runtime({spaces:[space('a')]});await r.api.refresh();r.setSpaces([space('a',false)]);
  await r.api.refresh();assert.equal(r.api.state().ready,true);assert.equal(r.api.state().mode,'not_applicable');assert.equal(r.api.state().error,'');assert.equal(r.calls.length,1);
});

test('waiting scope event immediately notifies UI that its previously confirmed figures are no longer certain',async()=>{
  const r=runtime({spaces:[space('a')]});await r.api.refresh();assert.equal(r.api.state().ready,true);
  const observed=[],dispatch=r.s.dispatchEvent;r.s.dispatchEvent=event=>{if(event.type==='sale-exchange-metrics-updated')observed.push(r.api.state().ready);return dispatch(event)};
  r.setLoaded(false);r.emit('veconi-spaces-ready');
  assert.ok(observed.length>0,'UI must be invalidated synchronously instead of retaining its old confirmed render');assert.equal(observed[0],false);assert.equal(r.api.state().ready,false);assert.equal(r.calls.length,1);
});

test('known commercial adjustment never becomes a confirmed zero after its space is archived',async()=>{
  const r=runtime({spaces:[space('a')]});r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('confirmed')],nextCursor:null}}));
  await r.api.refresh();assert.equal(r.api.total({businessId:'biz'}),30);
  r.setSpaces([space('a',true,{active:false,status:'archived'})]);r.emit('veconi-space-data-changed');await r.api.refresh();
  assert.equal(r.calls.length,1);assert.equal(r.api.state().ready,false);assert.equal(r.api.state().mode,'historical');assert.match(r.api.statusMessage(),/histórico|provisórios|revisão/i);
});

test('reload with a known local commercial sale in a disabled sales space waits for historical review without querying it',async()=>{
  const r=runtime({spaces:[space('finance-only',false)]});let reads=0,writes=0;
  r.s.DB.carregar=()=>{reads++;return{businessId:'biz',vendas:[{id:'historical-sale',businessId:'biz',spaceId:'finance-only',workspaceGeneration:0,status:'pago',ativo:true,valorFinal:80,data:'2026-10-22T12:00:00Z'}]}};
  r.s.DB.alterar=()=>{writes++;throw Error('historical detection must not write')};
  await r.api.refresh();assert.ok(reads>0);assert.equal(writes,0);assert.equal(r.calls.length,0);assert.equal(r.api.state().ready,false);assert.equal(r.api.state().mode,'historical');assert.match(r.api.statusMessage(),/histórico|provisórios|revisão/i);
});

test('in-memory historical hint is isolated by UID and business rather than contaminating another session',async()=>{
  for(const change of ['uid','business']){
    const r=runtime({spaces:[space('a')]});r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('owner-history')],nextCursor:null}}));await r.api.refresh();
    r.setSpaces([space('a',false)]);await r.api.refresh();assert.equal(r.api.state().mode,'historical');
    if(change==='uid'){
      r.setUser('seller');r.setContext({role:'seller',permissions:['sales.create'],permissionSignature:'seller',spaceAccess:'selected',allowedSpaceIds:['a'],userProfile:{uid:'seller',businessId:'biz',active:true}});
    }else{
      r.setContext({businessId:'other',business:{id:'other',ownerId:'owner',workspaceGeneration:0},userProfile:{uid:'owner',businessId:'other',active:true}});r.setSpaces([space('a',false,{businessId:'other'})]);
    }
    r.s.DB.carregar=()=>({businessId:change==='business'?'other':'biz',vendas:[]});await r.api.refresh();
    assert.equal(r.api.state().ready,true,`${change}: another namespace has no historical evidence`);assert.equal(r.api.state().mode,'not_applicable');assert.equal(r.calls.length,1);
  }
});

test('space-list expansion invalidates ready cache and retires it during fresh hydration',async()=>{
  const r=runtime({spaces:[space('a')]});await r.api.refresh();r.setSpaces([space('a'),space('b')]);
  assert.equal(r.api.state().ready,false);await r.api.refresh();assert.equal(r.api.state().ready,true);
  assert.deepEqual(r.calls.map(call=>call.spaceId),['a','a','b']);
});

test('effective entitlement change invalidates pending response without accepting its rows',async()=>{
  const r=runtime({spaces:[space('a')]});let release;r.setHandler(()=>new Promise(resolve=>{release=resolve}));const old=r.api.refresh();
  r.setEntitled(false);assert.equal(r.api.state().ready,false);const current=r.api.refresh();
  release({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('obsolete')],nextCursor:null}});await Promise.all([old,current]);
  assert.equal(r.calls.length,1);assert.equal(r.api.forData({businessId:'biz'}).length,0);
});

test('permitted space removal rejects an old callback and cannot restore unauthorized rows',async()=>{
  const r=runtime({role:'seller',spaces:[space('a'),space('b')],allowedSpaceIds:['a']});let release;r.setHandler(()=>new Promise(resolve=>{release=resolve}));const old=r.api.refresh();
  r.setContext({allowedSpaceIds:['b'],permissionSignature:'changed'});r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('new','b')],nextCursor:null}}));await r.api.refresh();
  release({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('obsolete','a')],nextCursor:null}});await old;
  assert.deepEqual(Array.from(r.api.forData({businessId:'biz'}),row=>row.id),['new']);
});

test('home space change while loading fences the old callback and retires readiness',async()=>{
  const r=runtime({spaces:[space('a'),space('b')]});let release;r.setHandler(()=>new Promise(resolve=>{release=resolve}));const old=r.api.refresh();
  r.setSelection('b');r.setHandler(async input=>({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment(`current-${input.spaceId}`,input.spaceId)],nextCursor:null}}));
  r.emit('veconi-space-context-changed',{kind:'home',id:'b'});assert.equal(r.api.state().ready,false);const current=r.api.refresh();
  release({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('obsolete-a','a')],nextCursor:null}});await Promise.all([old,current]);
  const rows=Array.from(r.api.forData({businessId:'biz',spaceSelectionId:'b'}),row=>row.id);
  assert.ok(rows.includes('current-b'));assert.equal(rows.includes('obsolete-a'),false);assert.equal(r.api.state().ready,true);
});

test('owner to seller transition cannot use in-flight owner data or sensitive financial permissions',async()=>{
  const r=runtime({spaces:[space('a'),space('b')]});let release;r.setHandler(()=>new Promise(resolve=>{release=resolve}));const old=r.api.refresh();
  r.setUser('seller');r.setContext({role:'seller',permissions:['sales.create'],permissionSignature:'seller-only',spaceAccess:'selected',allowedSpaceIds:['a'],userProfile:{uid:'seller',businessId:'biz',active:true}});
  r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('seller-visible')],nextCursor:null}}));await r.api.refresh();
  release({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('owner-only','b')],nextCursor:null}});await old;
  assert.deepEqual(Array.from(r.api.forData({businessId:'biz'}),row=>row.id),['seller-visible']);
  assert.equal(r.s.TeamAccess.has('financial.view'),false);assert.equal(r.s.TeamAccess.has('cost.view'),false);assert.equal(r.s.TeamAccess.has('profit.view'),false);
});

test('same-user permissions revocation discards pending adjustment response without any write',async()=>{
  const r=runtime({role:'seller',spaces:[space('a')]});let release;r.setHandler(()=>new Promise(resolve=>{release=resolve}));const old=r.api.refresh();
  r.setContext({permissions:['products.view'],permissionSignature:'no-sales'});r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[],nextCursor:null}}));await r.api.refresh();
  release({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('revoked')],nextCursor:null}});await old;
  assert.equal(r.calls.length,1);assert.equal(r.api.forData({businessId:'biz'}).length,0);
});

test('authenticated data snapshot cannot restore stale exchange rows after permission revocation',async()=>{
  const r=runtime({role:'seller',spaces:[space('a')]});r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('once-visible')],nextCursor:null}}));
  await r.api.refresh();assert.equal(r.api.total({businessId:'biz'}),30);
  r.setContext({permissions:['products.view'],permissionSignature:'revoked'});
  const stale={businessId:'biz',saleExchangeAdjustments:[adjustment('forged-fallback')]};
  assert.equal(r.api.forData(stale).length,0);await r.api.refresh();assert.equal(r.api.forData(stale).length,0);
});

test('authenticated stale local snapshot is never substituted for a failed authorized cloud query',async()=>{
  const r=runtime({spaces:[space('a')]});r.setHandler(async()=>{throw Error('real authorized query failure')});
  await r.api.refresh();const stale={businessId:'biz',saleExchangeAdjustments:[adjustment('fallback')]};
  assert.equal(r.api.forData(stale).length,0);assert.equal(r.api.state().ready,false);assert.match(r.api.state().error,/real authorized/);
});

test('old owner snapshot cannot populate reporting immediately after switching to seller',async()=>{
  const r=runtime({spaces:[space('a'),space('b')]});await r.api.refresh();
  r.setUser('seller');r.setContext({role:'seller',permissions:['sales.create'],permissionSignature:'seller',spaceAccess:'selected',allowedSpaceIds:['a'],userProfile:{uid:'seller',businessId:'biz',active:true}});
  const stale={businessId:'biz',saleExchangeAdjustments:[adjustment('owner-only','b'),adjustment('stale-but-assigned','a')]};
  assert.equal(r.api.forData(stale).length,0);await r.api.refresh();assert.equal(r.api.forData(stale).length,0);
});

test('Sync manual and auto status events never create commercial operations',async()=>{
  const r=runtime({spaces:[space('a')]});let writes=0;r.s.DB.alterar=()=>{writes++;throw Error('read-only reporting must not write')};
  r.s.SyncFirebase={enqueueOperation:()=>{writes++;throw Error('must not enqueue')}};
  r.emit('firebase-sync-status',{status:'synced'});await r.api.refresh();r.emit('firebase-sync-status',{status:'idle'});await r.api.refresh({force:true});
  assert.equal(writes,0);assert.equal(r.api.state().ready,true);assert.ok(r.calls.every(call=>call.businessId==='biz'&&call.spaceId==='a'));
});

test('account switch waits for the matching profile instead of querying with the previous owner context',async()=>{
  const r=runtime({spaces:[space('a')]});await r.api.refresh();const before=r.calls.length;
  r.setUser('seller');await r.api.refresh();assert.equal(r.calls.length,before);assert.equal(r.api.state().ready,false);
  r.setContext({role:'seller',permissions:['sales.create'],permissionSignature:'seller',spaceAccess:'selected',allowedSpaceIds:['a'],userProfile:{uid:'seller',businessId:'biz',active:true}});
  await r.api.refresh();assert.equal(r.calls.length,before+1);assert.equal(r.api.state().ready,true);
});

test('failed local history inspection cannot turn an excluded space into a confirmed financial zero',async()=>{
  const r=runtime({spaces:[space('finance-only',false)]});
  r.s.DB.carregar=()=>{throw Error('local-cache-conflict')};
  await r.api.refresh();assert.equal(r.calls.length,0);assert.equal(r.api.state().ready,false);assert.match(r.api.state().error,/histórico local/);
  r.s.DB.carregar=()=>({businessId:'biz',vendas:[]});await r.api.refresh();assert.equal(r.api.state().ready,true);assert.equal(r.api.state().mode,'not_applicable');
});

test('profile mismatch cannot import historical hints from the previous account namespace',async()=>{
  const r=runtime({spaces:[space('finance-only',false)]});let reads=0;
  r.setUser('seller');r.s.DB.carregar=()=>{reads++;return{businessId:'biz',vendas:[{spaceId:'finance-only'}]}};
  await r.api.refresh();assert.equal(reads,0);assert.equal(r.api.state().ready,false);
  r.setContext({role:'seller',permissions:['sales.create'],spaceAccess:'selected',allowedSpaceIds:['finance-only'],userProfile:{uid:'seller',businessId:'biz',active:true}});
  r.s.DB.carregar=()=>({businessId:'biz',vendas:[]});await r.api.refresh();assert.equal(r.api.state().mode,'not_applicable');assert.equal(r.api.state().ready,true);
});

test('effective plan change retires an in-flight read even when basic sales remain available',async()=>{
  const r=runtime({spaces:[space('a')]});let release;r.setHandler(()=>new Promise(resolve=>{release=resolve}));const old=r.api.refresh();
  r.setContext({access:{canAccessApp:true,features:{basicSales:true,advancedReports:false},planId:'essential',effectivePlanId:'essential',entitlementsVersion:2}});
  r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('current-plan')],nextCursor:null}}));await r.api.refresh();
  release({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('old-plan')],nextCursor:null}});await old;
  assert.deepEqual(Array.from(r.api.forData({}),row=>row.id),['current-plan']);
});

test('forced reporting refresh fences the older pending response instead of confirming pre-event totals',async()=>{
  const r=runtime({spaces:[space('a')]});let release;r.setHandler(()=>new Promise(resolve=>{release=resolve}));const old=r.api.refresh();
  r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('after-event')],nextCursor:null}}));await r.api.refresh({force:true});
  release({data:{businessId:'biz',workspaceGeneration:0,items:[adjustment('before-event')],nextCursor:null}});await old;
  assert.equal(r.calls.length,2);assert.deepEqual(Array.from(r.api.forData({}),row=>row.id),['after-event']);
});
