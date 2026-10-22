const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const E=require('../js/exchange-economics'),M=require('../js/performance-model');
const at='2026-10-21T15:00:00.000Z';
const exchange=(id,returned,next,extra={})=>({id,businessId:'biz',spaceId:'a',workspaceGeneration:0,status:'completed',originalSaleId:'original',createdAt:at,returnCents:returned,newCents:next,differenceCents:next-returned,...extra});
const sale=(id,total,extra={})=>({id,businessId:'biz',spaceId:'a',status:'pago',data:at,valorFinal:total,itens:[],...extra});
const build=(sales,exchanges,extra={})=>M.build({sales,exchanges,businessId:'biz',workspaceGeneration:0,range:M.range('today',new Date(at)),...extra});
test('only completed coherent adjustments of the selected business, generation and allowed space enter reporting',()=>{
 const rows=[exchange('good',8000,5000),exchange('good',8000,5000),exchange('other-biz',0,900,{businessId:'other'}),exchange('other-space',0,900,{spaceId:'b'}),exchange('old-generation',0,900,{workspaceGeneration:1}),exchange('pending',0,900,{status:'pending'}),exchange('bad-cents',100,90,{differenceCents:90}),exchange('bad-date',0,900,{createdAt:null})];
 assert.deepEqual(E.select(rows,{businessId:'biz',workspaceGeneration:0,allowedSpaceIds:['a']}).map(r=>r.id),['good']);
 assert.deepEqual(E.select(rows,{businessId:'biz',allowedSpaceIds:[]}),[]);assert.deepEqual(E.select(rows,{}),[]);
});
test('credit issuance followed by credit-funded purchase does not inflate turnover or sale count',()=>{
 const original=sale('original',80),next=sale('next',30,{exchangeCreditUsedCents:3000,receivedCents:0}),before=JSON.stringify([original,next]);
 const v=build([original,next],[exchange('ex',8000,5000)]);
 assert.equal(v.current.revenue,80);assert.equal(v.current.count,2);assert.equal(v.current.exchangeAdjustment,-30);
 for(const key of ['points','categories','products','payments','spaces'])assert.equal(v[key].reduce((n,r)=>n+r.revenue,0),80,key);
 assert.equal(JSON.stringify([original,next]),before);
});
test('positive and equal exchanges add only the economic difference and never add a sale',()=>{
 const v=build([sale('original',50)],[exchange('higher',5000,8000),exchange('same',2000,2000)]);
 assert.equal(v.current.revenue,80);assert.equal(v.current.count,1);assert.equal(v.current.exchangeCount,2);
});
test('a cancelled credit-funded sale leaves the original sale and exchange adjustment intact',()=>{
 const v=build([sale('original',80),sale('new',30,{status:'cancelado',exchangeCreditUsedCents:3000})],[exchange('ex',8000,5000)]);
 assert.equal(v.current.revenue,50);assert.equal(v.current.count,1);
});
test('exchange belongs to the day it occurred, without rewriting the original sale date',()=>{
 const v=build([sale('original',80,{data:'2026-10-20T15:00:00Z'})],[exchange('ex',8000,5000)]);
 assert.equal(v.current.revenue,-30);assert.equal(v.current.count,0);assert.equal(v.previous.revenue,80);
});
test('exchange reporting never fabricates profit from historical costs or exposes denied fields',()=>{
 const v=build([sale('original',80,{custoTotal:20,lucro:60})],[exchange('ex',8000,5000)],{canCost:true,canProfit:true});
 assert.equal(v.current.missingCost,1);assert.equal(v.comparison.profit,null);
 const denied=build([sale('original',80,{custoTotal:20,lucro:60})],[exchange('ex',8000,5000)]);
 for(const row of [denied.current,...denied.points,...denied.spaces])for(const field of ['profit','cost','margin'])assert.equal(field in row,false);
});
function runtime(){
 let user='owner',calls=0,handler=async input=>({data:{businessId:input.businessId,workspaceGeneration:0,items:[],nextCursor:null}});
 const listeners=new Map(),sandbox={window:null,console,Date,Map,Set,Number,String,Math,JSON,Promise,Array,Object,DB:{getBusinessId:()=> 'biz'},navigator:{onLine:true},FirebaseSession:{get user(){return{uid:user}}},BusinessContext:{get:()=>({businessId:'biz',role:user==='owner'?'owner':'seller',permissions:[user==='owner'?'*':'sales.create'],access:{features:{basicSales:true}},spaceAccess:user==='owner'?'all':'selected',allowedSpaceIds:['a'],business:{workspaceGeneration:0},permissionSignature:user})},SpaceContext:{list:()=>[{id:'a',businessId:'biz',capabilities:{sales:true}}]},CustomEvent:class{constructor(type){this.type=type}},addEventListener(type,cb){listeners.set(type,cb)},dispatchEvent(){},FirebaseCallable:async(name,input)=>{assert.equal(name,'listSaleExchangeAdjustments');calls++;return handler(input)}};
 sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(fs.readFileSync('js/exchange-economics.js','utf8'),sandbox);
 return {s:sandbox,api:sandbox.ExchangeEconomics,setUser:v=>{user=v},setHandler:v=>{handler=v},calls:()=>calls,listeners};
}
test('authenticated pages hydrate a separate memory cache; repeated refresh respects TTL and never writes DB',async()=>{
 const r=runtime();r.setHandler(async input=>({data:{businessId:'biz',workspaceGeneration:0,items:[exchange(input.cursor?'second':'first',5000,4000)],nextCursor:input.cursor?null:'first'}}));
 await r.api.refresh();assert.equal(r.api.state().ready,true);assert.equal(r.calls(),2);assert.equal(r.api.total({},{}),-20);
 await r.api.refresh();assert.equal(r.calls(),2);assert.match(r.api.statusMessage(),/incluem os ajustes/);
});
test('stale owner callback cannot populate the seller cache after a login change',async()=>{
 const r=runtime();let release;
 r.setHandler(()=>new Promise(resolve=>{release=resolve}));const old=r.api.refresh();
 r.setUser('seller');r.api.invalidate();r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[exchange('seller',1000,1000)],nextCursor:null}}));
 await r.api.refresh();release({data:{businessId:'biz',workspaceGeneration:0,items:[exchange('owner-private',1000,9000)],nextCursor:null}});await old;
 assert.equal(r.api.forData({}).length,1);assert.equal(r.api.forData({})[0].id,'seller');assert.equal(r.api.total({}),0);
});
test('forced refresh retires financial certainty immediately and notifies before the new response',async()=>{
 const r=runtime();await r.api.refresh();assert.equal(r.api.state().ready,true);
 let release;const readiness=[];r.s.dispatchEvent=()=>readiness.push(r.api.state().ready);
 r.setHandler(()=>new Promise(resolve=>{release=resolve}));const waiting=r.api.refresh({force:true});
 assert.equal(r.api.state().ready,false);assert.equal(r.api.state().busy,true);assert.deepEqual(readiness,[false]);
 release({data:{businessId:'biz',workspaceGeneration:0,items:[],nextCursor:null}});await waiting;
 assert.equal(r.api.state().ready,true);assert.deepEqual(readiness,[false,true]);
 r.s.navigator.onLine=false;assert.equal(r.api.state().ready,false);
});
test('failed or mismatched cloud projection stays provisional and cannot show a confirmed total',async()=>{
 const r=runtime();r.setHandler(async()=>({data:{businessId:'other',workspaceGeneration:0,items:[],nextCursor:null}}));
 await r.api.refresh();assert.equal(r.api.state().ready,false);assert.match(r.api.statusMessage(),/não confirmados/);
 await r.api.refresh();assert.equal(r.calls(),1,'failed reads have cooldown');
 r.setHandler(async()=>{throw Error('offline')});await r.api.refresh({force:true});assert.equal(r.api.state().ready,false);assert.equal(r.api.forData({}).length,0);
});
test('mobile and desktop goals share net turnover, preserve sale count and exclude other-space adjustments',async()=>{
 const r=runtime(),now=new Date().toISOString(),data={businessId:'biz',spaceSelectionId:'a',config:{dailySalesGoal:100},vendas:[sale('original',80,{data:now}),sale('next',30,{data:now,exchangeCreditUsedCents:3000})],saleExchangeAdjustments:[exchange('ex',8000,5000,{createdAt:now}),exchange('other-space',0,100000,{createdAt:now,spaceId:'b'})],clientes:[],produtos:[],pagamentos:[]};
 Object.assign(r.s,{DB:{carregar:()=>data,getBusinessId:()=> 'biz'},TeamAccess:{has:()=>true},Utils:{hoje:value=>new Date(value).toDateString()===new Date().toDateString(),dinheiro:value=>String(value),escapar:String},SpaceContext:{...r.s.SpaceContext,contextualData:d=>d,ALL_SPACES:'all_spaces'},OperationMode:{enabled:()=>false},document:{querySelector:()=>({})},matchMedia:()=>({matches:true,addEventListener(){}}),MutationObserver:class{observe(){}},getProductStockStatus:()=>'',queueMicrotask(){}});
 r.setHandler(async()=>({data:{businessId:'biz',workspaceGeneration:0,items:[data.saleExchangeAdjustments[0]],nextCursor:null}}));await r.api.refresh();
 vm.runInContext(fs.readFileSync('js/home-mobile.js','utf8'),r.s);vm.runInContext(fs.readFileSync('js/desktop-dashboard.js','utf8'),r.s);
 const mobile=r.s.MobileHome.model(),desktop=r.s.DesktopDashboard.aggregate(data,'today');
 assert.equal(mobile.sold,80);assert.equal(desktop.todayRevenue,80);assert.equal(mobile.goalPercent,80);assert.equal(desktop.goalPercent,80);
 assert.equal(mobile.today.length,2);assert.equal(desktop.today.length,2);assert.equal(mobile.profit,null);assert.equal(desktop.todayProfit,null);
 assert.equal(desktop.daily.reduce((n,row)=>n+row.value,0),80);assert.equal(mobile.week.at(-1).value,80);
 assert.match(r.s.MobileHome.render(),/Custos da troca em revisão/);
});
