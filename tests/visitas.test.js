const assert=require('node:assert/strict');
global.window=global;global.crypto=require('node:crypto').webcrypto;global.location={href:'https://example.test/app/index.html',hash:''};global.navigator={};global.dispatchEvent=()=>{};global.Utils={uuid:()=>crypto.randomUUID(),toast:()=>{}};
let data={config:{nome:'Adi Festa'},clientes:[{id:'c1',nome:'Cliente',telefone:'17999999999',saldo:0,totalComprado:0,quantidadeVendas:0}],produtos:[{id:'p1',nome:'Cone',preco:8,custo:3,estoqueAtual:10,ativo:true}],visitas:[],catalogOrders:[],vendas:[]};
global.DB={getBusinessId:()=> 'adi-festa',carregar:()=>structuredClone(data),alterar:fn=>{fn(data);return structuredClone(data)}};
global.Vendas={registrar:sale=>{const found=data.vendas.find(v=>v.operationId===sale.operationId);if(found)return found;const made={id:crypto.randomUUID(),...sale};data.vendas.push(made);return made}};
global.SpaceContext={salesId:()=>"business_test",requireSalesSpace:()=>"business_test"};
global.SpaceEngine={productAllowsSpace:()=>true};
global.Clientes={normalizePhone:value=>{let digits=String(value||'').replace(/\D/g,'');if(digits.length===10||digits.length===11)digits=`55${digits}`;return digits},salvar:client=>{const saved={id:crypto.randomUUID(),...client};data.clientes.push(saved);return saved}};
require('../js/visitas.js');
const visit=Visitas.salvar({spaceId:'business_adi-festa',nome:'Shopping',local:'Iguatemi',data:'2026-07-21',horarioChegada:'14:00',horarioLimite:'13:30',status:'recebendo'},['p1']);
assert.equal(data.visitas.length,1);assert.equal(visit.catalogItems.length,1);assert.equal(visit.catalogItems[0].salePrice,8);assert.equal(visit.publicToken.length,36);
const publicUrl=new URL(Visitas.link(visit));assert.equal(publicUrl.pathname,'/app/catalogo.html');assert.equal(publicUrl.searchParams.get('v'),visit.publicToken);
data.catalogOrders.push({id:'o1',visitId:visit.id,publicOrderNumber:'AF001',clientId:'c1',customerPhone:'17999999999',items:[{productId:'p1',name:'Cone',quantity:2,unitPrice:8,subtotal:16}],total:16,paymentPreference:'pix',orderStatus:'separando'});
const preserved=structuredClone(data);
for(const [method,args] of [['converter',['o1','pago']],['atualizarPedido',['o1','entregue']],['vincularCliente',['o1','c1']],['criarClienteParaPedido',['o1']],['manterVisitante',['o1']],['revisarVinculo',['o1']]]){
  assert.throws(()=>Visitas[method](...args),/históricos somente para consulta/);
  assert.deepEqual(data,preserved,'archived records, clients, stock and sales remain unchanged');
}
assert.equal(Visitas.clientesCompativeis('o1').length,1);
global.OnlineOrdersUI={legacy:true,render:()=> 'V2 only',bind:()=> 'V2 bind'};
assert.equal(VisitasUI.renderOrdersPage(),'V2 only','saved legacy flag cannot restore the old UI');
assert.equal(VisitasUI.bindOrdersPage(),'V2 bind');
console.log('visitas.test.js: ok');
