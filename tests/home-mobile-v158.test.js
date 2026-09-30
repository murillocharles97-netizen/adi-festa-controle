const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/home-mobile.js','utf8');
function runtime(allowed=true){
 const today=new Date().toISOString(),data={config:{dailySalesGoal:650},clientes:[],produtos:[],vendas:[{id:'sale',data:today,status:'pago',valorFinal:42,custoTotal:24,itens:[{quantidade:3}]}]};
 const c={window:null,Date,Set,Map,Number,String,Math,console,DB:{carregar:()=>data},TeamAccess:{has:()=>allowed,canRoute:()=>allowed},matchMedia:()=>({matches:true,addEventListener(){}}),document:{querySelector:()=>({})},MutationObserver:class{observe(){}},getProductStockStatus:()=>'',SpaceContext:{contextualData:d=>({...d,unassignedLegacySales:300}),ALL_SPACES:'all_spaces'}};c.window=c;vm.createContext(c);vm.runInContext(source,c);return{home:c.MobileHome,data};
}
test('legacy space counts never become operational priorities or goal-editor links',()=>{
 const {home,data}=runtime(),before=JSON.stringify(data),model=home.model();
 assert.equal(model.unassignedLegacySales,300);assert.equal(home.attentionItems(model).length,0);
 const html=home.render();assert.doesNotMatch(html,/Vendas antigas sem espaço|data-home-target="goal"/);assert.match(html,/Prioridades de hoje/);assert.match(html,/Resumo rápido/);
 assert.equal(model.sold,42);assert.equal(model.profit,18);assert.equal(JSON.stringify(data),before);
});
test('every priority has a supported useful destination, with separate low/out stock',()=>{
 const {home}=runtime(),m={...home.model(),out:[{}],low:[{}],renewals:{dueToday:1,due7:1,forecastValue:10},pendingOrders:[{}],debtors:[{}],debt:30};
 const targets=Array.from(home.attentionItems(m),x=>x.target);
 assert.deepEqual(targets,['products-out','clients-renewals','orders','products-low','clients-debt']);
 for(const target of targets)assert.ok(source.includes(`'${target}'`));
 assert.equal(runtime(false).home.attentionItems(m).length,0,'no priority leading to unauthorized route');
});
test('summary uses actual day/7-day model, no invented weekly goal or decorative chart data',()=>{
 const {home,data}=runtime();assert.match(home.render(),/Ticket médio do dia/);assert.match(home.render(),/Últimos 7 dias/);
 assert.doesNotMatch(home.render(),/Meta semanal/);data.vendas=[];assert.match(home.render(),/<strong>—<\/strong>/);
 assert.doesNotMatch(source,/onSnapshot|fetch\(|setInterval\(/);
});
