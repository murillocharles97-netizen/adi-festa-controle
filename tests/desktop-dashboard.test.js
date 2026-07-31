const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

const source=fs.readFileSync('js/desktop-dashboard.js','utf8');
const app=fs.readFileSync('js/app.js','utf8');
const css=fs.readFileSync('css/desktop-dashboard.css','utf8');

test('dashboard desktop usa uma leitura local e nenhuma consulta Firebase',()=>{
  let reads=0;
  const now=new Date().toISOString();
  const db={vendas:[{id:'v1',data:now,valorFinal:25,lucro:10,status:'pago',clienteNome:'Cliente',itens:[{produtoId:'p1',nome:'Cone',quantidade:2,subtotalFinal:25}]}],pagamentos:[{id:'pg1',data:now,valor:25}],clientes:[{id:'c1',nome:'Cliente',ativo:true,totalComprado:25,quantidadeVendas:1,saldo:0,ultimaCompra:now,criadoEm:now}],produtos:[{id:'p1',nome:'Cone',ativo:true,estoqueAtual:5}],campanhas:[],progressosCampanha:[],recompensas:[],catalogOrders:[]};
  const sandbox={window:null,DB:{carregar:()=>{reads++;return db}},Utils:{hoje:()=>true,dinheiro:value=>`R$ ${Number(value).toFixed(2)}`,escapar:value=>String(value)},OperationMode:{enabled:()=>false},Campanhas:{metricas:()=>({active:0,participants:0,redemptions:0,conversion:0}),status:()=>''},getProductStockStatus:()=> 'disponivel',Date,Map,Set,Math,Number,String,Array,Object,JSON};
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(source,sandbox);
  const html=sandbox.DesktopDashboard.render();
  assert.equal(reads,1);
  assert.equal((html.match(/class="desktop-kpi(?: |")/g)||[]).length,6);
  assert.match(html,/Desempenho de vendas/);
  assert.match(html,/Alertas inteligentes/);
  assert.doesNotMatch(source,/getDocs|onSnapshot|collection\(/);
});

test('mobile continua usando MobileHome e estilos desktop começam em 768px',()=>{
  assert.match(app,/window\.MobileHome\?\.isMobile\(\)[\s\S]*MobileHome\.render\(\)/);
  assert.match(css,/@media\s*\(min-width:\s*768px\)/);
  assert.doesNotMatch(css,/@media\s*\(max-width:\s*767px\)/);
});
