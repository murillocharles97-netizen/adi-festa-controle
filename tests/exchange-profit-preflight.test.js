const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../js/performance-model');
const at='2026-10-22T15:00:00Z';
const sale=(id,date=at)=>({id,businessId:'biz',spaceId:'a',status:'pago',data:date,valorFinal:80,custoTotal:20,lucro:60,itens:[]});
const exchange=date=>({id:'exchange',businessId:'biz',spaceId:'a',status:'completed',originalSaleId:'original',createdAt:date,returnCents:8000,newCents:5000,differenceCents:-3000});

test('unconfirmed exchange projection suppresses all cost/profit/margin periods and comparison, not operational totals',()=>{
  const v=M.build({sales:[sale('now'),sale('old','2026-10-21T15:00:00Z')],exchangeAdjustmentsReady:false,businessId:'biz',canCost:true,canProfit:true,range:M.range('today',new Date(at))});
  assert.equal(v.current.revenue,80);assert.equal(v.current.count,1);
  for(const row of [v.current,v.previous,...v.points,...v.spaces]){
    assert.equal(row.profit,null);assert.equal(row.margin,null);assert.equal(row.exchangeProjectionPending,true);
    if('cost' in row)assert.equal(row.cost,null);
  }
  assert.equal(v.comparison.profit,null);
});

test('previous-period exchange suppresses previous profit and growth without suppressing confirmed unaffected current profit',()=>{
  const v=M.build({sales:[sale('now'),sale('old','2026-10-21T15:00:00Z')],exchanges:[exchange('2026-10-21T15:00:00Z')],exchangeAdjustmentsReady:true,businessId:'biz',canCost:true,canProfit:true,range:M.range('today',new Date(at))});
  assert.equal(v.current.profit,60);assert.equal(v.current.cost,20);
  assert.equal(v.previous.profit,null);assert.equal(v.previous.cost,null);assert.equal(v.previous.margin,null);assert.equal(v.comparison.profit,null);
});

test('unconfirmed projection does not introduce private model fields for denied profiles',()=>{
  const v=M.build({sales:[sale('now')],exchangeAdjustmentsReady:false,businessId:'biz',range:M.range('today',new Date(at))});
  for(const row of [v.current,v.previous,...v.points,...v.spaces])for(const field of ['profit','cost','margin'])assert.equal(field in row,false);
});

function dashboardHarness({ready=false,error='',rows=[]}={}){
  const now=new Date().toISOString(),data={businessId:'biz',spaceSelectionId:'a',config:{},vendas:[sale('now',now)],produtos:[],clientes:[],pagamentos:[]};
  const sandbox={window:null,console,Date,Map,Set,Number,String,Math,JSON,Promise,Array,Object,PerformanceModel:M,
    navigator:{onLine:true},FirebaseSession:{user:{uid:'owner'}},BusinessContext:{get:()=>({businessId:'biz',role:'owner',spaceAccess:'all',business:{workspaceGeneration:0}})},
    DB:{carregar:()=>data,getBusinessId:()=> 'biz'},
    Utils:{hoje:value=>new Date(value).toDateString()===new Date().toDateString(),dinheiro:value=>`BRL ${value}`,escapar:String},
    TeamAccess:{has:key=>['cost.view','profit.view','reports.view'].includes(key)},SpaceContext:{contextualData:d=>d,ALL_SPACES:'all_spaces',list:()=>[{id:'a',businessId:'biz',name:'A'}]},
    ExchangeEconomics:{state:()=>({ready,error}),forData:()=>rows,total:()=>0,statusMessage:()=>ready?'Confirmado':'Ajustes não confirmados'},
    OperationMode:{enabled:()=>false},document:{querySelector:()=>({})},matchMedia:()=>({matches:true,addEventListener(){}}),
    MutationObserver:class{observe(){}},getProductStockStatus:()=>'',queueMicrotask(){},addEventListener(){},setTimeout,clearTimeout};
  sandbox.window=sandbox;vm.createContext(sandbox);
  for(const file of ['js/home-mobile.js','js/desktop-dashboard.js','js/performance-dashboard.js'])vm.runInContext(fs.readFileSync(file,'utf8'),sandbox);
  const app=fs.readFileSync('js/app.js','utf8'),start=app.indexOf('  function resumoFechamento() {'),end=app.indexOf('  function resumoEstoque()',start);
  vm.runInContext(`const dinheiro=Utils.dinheiro;${app.slice(start,end)};globalThis.closing=resumoFechamento;`,sandbox);
  return {s:sandbox,data};
}

for(const [name,state] of [['loading',{ready:false}],['failed',{ready:false,error:'offline'}]])test(`${name} exchange projection keeps mobile, desktop, closing and analytical profit in review`,()=>{
  const {s}=dashboardHarness(state),mobile=s.MobileHome.model(),desktop=s.DesktopDashboard.aggregate(s.DB.carregar(),'today');
  assert.equal(mobile.profit,null);assert.equal(mobile.cost,null);assert.equal(mobile.margin,null);assert.equal(mobile.profitYesterday,null);
  assert.equal(desktop.todayProfit,null);assert.equal(s.closing().lucro,null);
  assert.match(s.MobileHome.render(),/Em revisão/);assert.match(s.MobileHome.render(),/ajustes de troca não confirmados/);
  assert.match(s.DesktopDashboard.render(),/Lucro estimado[\s\S]*?Em revisão/);
  const html=s.PerformanceDashboard.render();assert.match(html,/Custos e lucro em revisão/);assert.equal(s.PerformanceDashboard.state.last.current.profit,null);
  assert.equal(s.PerformanceDashboard.state.last.previous.profit,null);assert.equal(s.PerformanceDashboard.state.last.comparison.profit,null);
});

test('confirmed projection without exchanges preserves existing complete cost/profit metrics',()=>{
  const {s}=dashboardHarness({ready:true}),mobile=s.MobileHome.model(),desktop=s.DesktopDashboard.aggregate(s.DB.carregar(),'today');
  assert.equal(mobile.cost,20);assert.equal(mobile.profit,60);assert.equal(mobile.margin,75);assert.equal(desktop.todayProfit,60);assert.equal(s.closing().lucro,60);
  s.PerformanceDashboard.render();assert.equal(s.PerformanceDashboard.state.last.current.profit,60);
});

test('confirmed exchange keeps all affected cost/profit surfaces unavailable and explicitly labelled',()=>{
  const {s}=dashboardHarness({ready:true,rows:[exchange(new Date().toISOString())]});
  assert.equal(s.MobileHome.model().profit,null);assert.equal(s.MobileHome.model().cost,null);assert.equal(s.DesktopDashboard.aggregate(s.DB.carregar(),'today').todayProfit,null);assert.equal(s.closing().lucro,null);
  assert.match(s.PerformanceDashboard.render(),/Custos e lucro das trocas em revisão/);
});

test('confirmed previous-day exchange never leaves yesterday profit available for a misleading comparison',()=>{
  const date=new Date();date.setDate(date.getDate()-1);const {s,data}=dashboardHarness({ready:true,rows:[exchange(date.toISOString())]});data.vendas.push(sale('old',date.toISOString()));
  assert.equal(s.MobileHome.model().profitYesterday,null);assert.equal(s.MobileHome.model().profit,60);
});
