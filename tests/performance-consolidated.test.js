const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../js/performance-model');
function render(perms){
  const now=new Date().toISOString(),data={vendas:[{id:'s1',businessId:'biz',spaceId:'a',status:'pago',formaPagamento:'pix',data:now,valorFinal:300,itens:[]},{id:'s2',businessId:'biz',spaceId:'b',status:'fiado',formaPagamento:'fiado',data:now,valorFinal:100,itens:[]}],
    pagamentos:[{id:'p1',businessId:'biz',spaceId:'b',tipo:'pagamento',valor:40,data:now}],clientes:[]};
  const sb={console,Date,Map,Set,Number,String,Math,JSON,Promise,Array,Object,Intl,PerformanceModel:M,navigator:{onLine:false},
    BusinessContext:{get:()=>({businessId:'biz',role:'owner',spaceAccess:'all',business:{workspaceGeneration:0}})},DB:{carregar:()=>data},
    TeamAccess:{has:k=>perms.includes(k)},SpaceContext:{list:()=>[{id:'a',businessId:'biz',name:'Táxi'},{id:'b',businessId:'biz',name:'Doces'}]},
    addEventListener(){},setTimeout,clearTimeout,innerWidth:390};
  sb.window=sb;vm.createContext(sb);vm.runInContext(fs.readFileSync('js/performance-dashboard.js','utf8'),sb);
  sb.PerformanceDashboard.state.period='today';return sb.PerformanceDashboard.render();
}
test('consolidated view shows each space contribution, Ontem filter and received cash apart from revenue',()=>{
  const html=render(['reports.view','performance.history','financial.view']);
  assert.match(html,/value="yesterday"[^>]*>Ontem/);
  assert.match(html,/Contribuição por espaço/);assert.match(html,/data-analytics-space="a"[\s\S]*Táxi[\s\S]*75%/);assert.match(html,/Doces[\s\S]*25%/);
  assert.match(html,/Recebido no período/);assert.match(html,/Total recebido<\/span><strong>R\$\s?340,00/);
  assert.match(html,/nunca some as duas/);
});
test('received cash stays hidden without financial permission',()=>{
  const html=render(['reports.view','performance.history']);
  assert.doesNotMatch(html,/Recebido no período|Recebido R\$/);assert.match(html,/Contribuição por espaço/);
});
