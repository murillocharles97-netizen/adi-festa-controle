const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

// Integration across the real scope, permission, exchange and dashboard models.
// Browser surfaces, storage and the read callable are in-memory fakes; there is
// no Firebase SDK, network, real identity, persistent cache, or commercial write.
async function integration({role='owner',selection='all_spaces'}={}){
  const now=new Date().toISOString(),permissions=role==='owner'?['*']:['sales.create','customers.view','products.view','inventory.view'];
  const context={businessId:'qa-biz',role,permissions,permissionSignature:permissions.join('|'),spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:role==='owner'?[]:['a'],business:{id:'qa-biz',name:'Fictitious QA',ownerId:'owner',workspaceGeneration:0},member:{status:'active'},userProfile:{uid:role,businessId:'qa-biz',active:true},access:{canAccessApp:true,canMutate:true,features:{basicSales:true}},loading:false};
  const sale=(id,spaceId,value)=>({id,businessId:'qa-biz',spaceId,workspaceGeneration:0,status:'pago',data:now,valorFinal:value,custoTotal:20,lucro:value-20,formaPagamento:'dinheiro',itens:[{produtoId:`product-${spaceId}`,nome:`Fictitious ${spaceId}`,quantidade:1,precoUnitario:value,custoUnitario:20,custoTotal:20}]});
  const data={businessId:'qa-biz',workspaceGeneration:0,config:{nome:'Fictitious QA',dashboard:{dailySalesGoal:1000,dailySalesGoalsBySpaceId:{a:1000,b:1000}}},vendas:[sale('sale-a','a',80),sale('sale-b','b',100)],produtos:[],clientes:[],pagamentos:[]};
  const adjustment=(id,spaceId,returned,next)=>({id,businessId:'qa-biz',spaceId,workspaceGeneration:0,originalSaleId:`sale-${spaceId}`,status:'completed',createdAt:now,returnCents:returned,newCents:next,differenceCents:next-returned});
  const exchanges={a:adjustment('exchange-a','a',8000,5000),b:adjustment('exchange-b','b',10000,11000)},calls=[],listeners=new Map(),storage=new Map();let writes=0;
  const sandbox={window:null,console,Date,JSON,Promise,Array,Object,Map,Set,Number,String,Math,Intl,structuredClone,navigator:{onLine:true},
    FirebaseSession:{user:{uid:role},profile:{role},businessId:'qa-biz'},BusinessContext:{get:()=>structuredClone(context),canAccessSpace:id=>context.spaceAccess==='all'||context.allowedSpaceIds.includes(id)},
    DB:{carregar:()=>data,getBusinessId:()=> 'qa-biz',alterar(){writes++;throw Error('reporting must not write DB')}},
    localStorage:{getItem:key=>storage.get(key)||null,setItem:(key,value)=>storage.set(key,String(value))},
    CustomEvent:class{constructor(type,options={}){this.type=type;this.detail=options.detail}},
    addEventListener(type,callback){if(!listeners.has(type))listeners.set(type,[]);listeners.get(type).push(callback)},
    dispatchEvent(event){for(const listener of listeners.get(event.type)||[])listener(event)},
    FirebaseCallable:async(name,input)=>{assert.equal(name,'listSaleExchangeAdjustments');assert.ok(['a','b'].includes(input.spaceId),'finance-only space must not be queried');calls.push(structuredClone(input));return{data:{businessId:'qa-biz',workspaceGeneration:0,items:[exchanges[input.spaceId]],nextCursor:null}}},
    Utils:{hoje:value=>new Date(value).toDateString()===new Date().toDateString(),dinheiro:value=>String(value),escapar:String},
    OperationMode:{enabled:()=>false},document:{querySelector:()=>null,querySelectorAll:()=>[],documentElement:{dataset:{}}},
    Router:{atual:()=> 'fixture'},matchMedia:()=>({matches:true,addEventListener(){}}),MutationObserver:class{observe(){}},getProductStockStatus:()=>'',queueMicrotask(){}};
  sandbox.window=sandbox;vm.createContext(sandbox);
  const load=file=>vm.runInContext(fs.readFileSync(file,'utf8'),sandbox,{filename:file});
  load('js/team-access.js');if(role!=='owner')sandbox.TeamAccess.sanitizePrivateCache(data);
  load('js/spaces.js');sandbox.SpaceContext.setSpaces([
    {id:'a',businessId:'qa-biz',name:'QA A',type:'unit',active:true,capabilities:{sales:true,finance:false}},
    {id:'b',businessId:'qa-biz',name:'QA B',type:'unit',active:true,capabilities:{sales:true,finance:false}},
    {id:'finance-only',businessId:'qa-biz',name:'QA finance only',type:'personal',active:true,capabilities:{sales:false,finance:true}},
  ]);
  sandbox.SpaceContext.selectHome(selection);
  const configBefore=JSON.stringify(data.config);
  load('js/exchange-economics.js');await sandbox.ExchangeEconomics.refresh();
  load('js/performance-model.js');load('js/home-mobile.js');load('js/desktop-dashboard.js');
  const mobile=sandbox.MobileHome.model(),desktop=sandbox.DesktopDashboard.aggregate(data,'today'),scoped=sandbox.SpaceContext.contextualData(data,'home');
  const performance=sandbox.PerformanceModel.build({sales:scoped.vendas,exchanges:sandbox.ExchangeEconomics.forData(scoped),exchangeAdjustmentsReady:sandbox.ExchangeEconomics.state().ready,businessId:'qa-biz',workspaceGeneration:0,spaceId:selection==='all_spaces'?'all':selection,allowedSpaceIds:role==='owner'?null:['a'],range:sandbox.PerformanceModel.range('today'),canCost:sandbox.TeamAccess.has('cost.view'),canProfit:sandbox.TeamAccess.has('profit.view'),spaces:sandbox.SpaceContext.homeSpaces()});
  return{sandbox,data,mobile,desktop,performance,calls,configBefore,writes:()=>writes};
}

function common(r,{revenue,count,goal,spaces}){
  assert.equal(r.sandbox.ExchangeEconomics.state().ready,true);
  assert.deepEqual(r.calls.map(call=>call.spaceId),spaces);
  assert.equal(r.mobile.sold,revenue);assert.equal(r.desktop.todayRevenue,revenue);assert.equal(r.performance.current.revenue,revenue);
  assert.equal(r.mobile.today.length,count);assert.equal(r.desktop.today.length,count);assert.equal(r.performance.current.count,count);
  assert.equal(r.mobile.goalPercent,goal);assert.equal(r.desktop.goalPercent,goal);
  assert.equal(r.mobile.week.at(-1).value,revenue);assert.equal(r.desktop.daily.reduce((sum,row)=>sum+row.value,0),revenue);
  assert.equal(r.mobile.profit,null);assert.equal(r.desktop.todayProfit,null);
  assert.equal(JSON.stringify(r.data.config),r.configBefore,'reading goals must not create or migrate configuration');assert.equal(r.writes(),0);
}

test('real owner aggregate consumers agree on two sales-space adjustments and ignore finance-only queries',async()=>{
  const r=await integration({role:'owner',selection:'all_spaces'});common(r,{revenue:160,count:2,goal:16,spaces:['a','b']});
  assert.equal(r.performance.current.cost,null);assert.equal(r.performance.current.profit,null);assert.equal(r.performance.current.margin,null);
  assert.match(r.sandbox.MobileHome.render(),/Em revisão/);assert.match(r.sandbox.MobileHome.render(),/Custos da troca em revisão/);
  assert.match(r.sandbox.DesktopDashboard.render(),/Lucro estimado[\s\S]*?Em revisão/);assert.match(r.sandbox.DesktopDashboard.render(),/Custos das trocas em revisão/);
});

test('real owner selected-space consumers agree on net turnover, store goal and unchanged sale count',async()=>{
  const r=await integration({role:'owner',selection:'a'});common(r,{revenue:50,count:1,goal:5,spaces:['a','b']});
  assert.equal(r.performance.current.exchangeAdjustment,-30);assert.equal(r.performance.current.cost,null);assert.equal(r.performance.current.profit,null);
  assert.equal(r.sandbox.ExchangeEconomics.total({businessId:'qa-biz',spaceSelectionId:'finance-only'}),0);
});

test('real restricted seller receives the same operational A totals without financial or private fields',async()=>{
  const r=await integration({role:'seller',selection:'a'});common(r,{revenue:50,count:1,goal:5,spaces:['a']});
  for(const permission of ['financial.view','cost.view','profit.view','team.manage','settings.manage'])assert.equal(r.sandbox.TeamAccess.has(permission),false);
  for(const row of [r.performance.current,...r.performance.points,...r.performance.spaces])for(const field of ['cost','profit','margin'])assert.equal(field in row,false);
  for(const sale of r.data.vendas){assert.equal('custoTotal' in sale,false);assert.equal('lucro' in sale,false);for(const item of sale.itens){assert.equal('custoUnitario' in item,false);assert.equal('custoTotal' in item,false);}}
  assert.doesNotMatch(r.sandbox.MobileHome.render(),/Lucro hoje/);assert.doesNotMatch(r.sandbox.DesktopDashboard.render(),/Painel financeiro|Lucro estimado|Recebido hoje/);
});
