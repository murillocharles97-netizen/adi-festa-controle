const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../js/performance-model');
function render(perms,{access='all',allowed=null,complete=false,payments=null,spaces=null}={}){
  const now=new Date().toISOString(),data={vendas:[{id:'s1',businessId:'biz',spaceId:'a',status:'pago',formaPagamento:'pix',data:now,valorFinal:300,itens:[]},{id:'s2',businessId:'biz',spaceId:'b',status:'fiado',formaPagamento:'fiado',data:now,valorFinal:100,itens:[]}],
    pagamentos:payments||[{id:'p1',businessId:'biz',spaceId:'b',tipo:'pagamento',valor:40,data:now}],clientes:[]};
  const sb={console,Date,Map,Set,Number,String,Math,JSON,Promise,Array,Object,Intl,PerformanceModel:M,navigator:{onLine:false},
    BusinessContext:{get:()=>({businessId:'biz',role:access==='all'?'owner':'seller',spaceAccess:access,allowedSpaceIds:allowed,business:{workspaceGeneration:0}})},DB:{carregar:()=>data},
    TeamAccess:{has:k=>perms.includes(k)},SpaceContext:{list:()=>spaces||[{id:'a',businessId:'biz',name:'Táxi'},{id:'b',businessId:'biz',name:'Doces'}]},
    addEventListener(){},setTimeout,clearTimeout,innerWidth:390};
  sb.window=sb;vm.createContext(sb);vm.runInContext(fs.readFileSync('js/performance-dashboard.js','utf8'),sb);
  const D=sb.PerformanceDashboard;D.state.period='today';let html=D.render();if(complete){D.state.complete=true;D.state.asOf=now;html=D.render();}return html;
}
test('consolidated view shows each space contribution, Ontem filter and received cash apart from revenue',()=>{
  const html=render(['reports.view','performance.history','financial.view']);
  assert.match(html,/value="yesterday"[^>]*>Ontem/);
  assert.match(html,/Contribuição por espaço/);assert.match(html,/data-analytics-space="a"[\s\S]*Táxi[\s\S]*75%/);assert.match(html,/Doces[\s\S]*25%/);
  assert.match(html,/Recebido no período/);assert.match(html,/data-cash-state="partial"/);
  assert.match(html,/nunca some as duas/);
});
test('received cash stays hidden without financial permission',()=>{
  const html=render(['reports.view','performance.history']);
  assert.doesNotMatch(html,/Recebido no período|Recebido R\$/);assert.match(html,/Contribuição por espaço/);
});
test('received remains partial even after cloud sales complete because payment coverage is unproved',()=>{
  const partial=render(['reports.view','performance.history','financial.view']);
  assert.match(partial,/Parcial/);assert.match(partial,/Recebido na base consultada \(parcial\)<\/span><strong>R\$\s?340,00/);assert.match(partial,/não use como total definitivo/);
  const done=render(['reports.view','performance.history','financial.view'],{complete:true});
  assert.match(done,/data-cash-state="partial"/);assert.match(done,/Recebido na base consultada \(parcial\)/);assert.doesNotMatch(done,/Total recebido<\/span>/);assert.doesNotMatch(done,/≥/);
});
test('empty, short and old payment caches never prove full received coverage',()=>{
  for(const count of [0,1,199,200]){
    const payments=Array.from({length:count},(_,i)=>({id:'p'+i,businessId:'biz',spaceId:'b',tipo:'pagamento',valor:1,data:i===0?'2000-01-01T12:00:00Z':new Date().toISOString()}));
    const html=render(['reports.view','performance.history','financial.view'],{complete:true,payments});
    assert.match(html,/data-cash-state="partial"/);assert.doesNotMatch(html,/Total recebido<\/span>|≥/);
  }
});
test('local cap of 200 receipts without older coverage marks received partial even after cloud sales complete',()=>{
  const now=Date.now(),payments=Array.from({length:200},(_,i)=>({id:'p'+i,businessId:'biz',spaceId:'b',tipo:'pagamento',valor:1,data:new Date(now-i*1000).toISOString()}));
  const html=render(['reports.view','performance.history','financial.view'],{complete:true,payments});
  assert.match(html,/data-cash-state="partial"/);assert.match(html,/não comprova todos os pagamentos/);
});
test('all spaces never lists another company space and restricted members see only allowed spaces',()=>{
  const spaces=[{id:'a',businessId:'biz',name:'Táxi'},{id:'b',businessId:'biz',name:'Doces'},{id:'x',businessId:'outra-empresa',name:'Empresa independente'}];
  assert.doesNotMatch(render(['reports.view','performance.history','financial.view'],{spaces}),/Empresa independente/);
  const seller=render(['reports.view','performance.history','financial.view'],{access:'restricted',allowed:['a'],spaces});
  assert.doesNotMatch(seller,/Doces|Empresa independente/);assert.doesNotMatch(seller,/Contribuição por espaço/);
});
