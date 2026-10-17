'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const Orders=require('../functions/src/shared/online-order'),Store=require('../functions/src/shared/online-store');
const current='2026-10-17T12:00:00Z';
class FixedDate extends Date{constructor(...args){super(...(args.length?args:[current]));}static now(){return new Date(current).getTime();}}
function ordersFixture(){
  const sample=(id,status,extra={})=>({id,publicOrderNumber:'VC-'+id,businessId:'qa',spaceId:'a',source:'online_store',schemaVersion:2,orderStatus:status,customerName:'QA '+id,customerPhone:'0000',serviceModeLabel:'Retirada',items:[{quantity:2}],total:25,createdAt:current,statusHistory:[],...extra});
  const data={catalogOrders:[sample('NEW','recebido'),sample('PREP','preparando'),sample('DONE','entregue',{deliveredAt:current}),sample('OLD','entregue',{deliveredAt:'2026-10-15T12:00:00Z'}),sample('UNKNOWN-DATE','entregue'),sample('CANCEL','cancelado'),sample('OTHER-SPACE','recebido',{spaceId:'b'}),sample('OTHER-BUSINESS','recebido',{businessId:'other'}),sample('LEGACY','recebido',{source:'online_catalog',schemaVersion:1}),sample('FORBIDDEN','recebido')]};
  const c={Date:FixedDate,OnlineOrderModel:Orders,OnlineOrderFinalization:{create:()=>()=>{throw Error('No sale in rendering');}},BusinessContext:{getCurrentBusinessId:()=> 'qa'},SpaceContext:{salesSpaces:()=>[{id:'a',name:'QA A'},{id:'b',name:'QA B'}],salesId:()=> 'a'},DB:{carregar:()=>data},Visitas:{canReadOrder:o=>o.id!=='FORBIDDEN'},document:{querySelector:()=>null},addEventListener(){}};c.window=c;vm.createContext(c);
  vm.runInContext(fs.readFileSync('js/online-orders-ui.js','utf8').replace('window.OnlineOrdersUI={render,bind,history};','window.OnlineOrdersUI={render,bind,history};window.inspectUI={summary,card,list,completedToday,setFilter:v=>filter=v,setQuery:v=>query=v,setSpace:v=>selectedSpace=v};'),c);
  c.OnlineOrdersUI.render();return {c,data,api:c.inspectUI};
}
test('summary and cards only include authorized V2 orders in current business/space',()=>{
  const {c,data,api}=ordersFixture(),before=JSON.stringify(data),html=c.OnlineOrdersUI.render();
  assert.equal(api.list().length,6);assert.doesNotMatch(html,/VC-OTHER-SPACE|VC-OTHER-BUSINESS|VC-FORBIDDEN|VC-LEGACY/);
  assert.match(html,/data-orders-filter="recebido"[^]*?<b>1<\/b>/);assert.match(html,/data-orders-filter="ongoing"[^]*?<b>1<\/b>/);assert.match(html,/data-orders-filter="today"[^]*?<b>1<\/b>/);
  assert.equal(JSON.stringify(data),before);api.setSpace('b');assert.equal(api.list().length,1);assert.equal(api.list()[0].id,'OTHER-SPACE');
});
test('today uses actual completion timestamp, never creation date or missing timestamp',()=>{
  const {api}=ordersFixture();api.setFilter('today');assert.deepEqual(Array.from(api.list(),o=>o.id),['DONE']);
  assert.equal(api.completedToday({orderStatus:'entregue',createdAt:current}),false);
  assert.equal(api.completedToday({orderStatus:'entregue',statusHistory:[{status:'entregue',at:current}]}),true);
  assert.equal(api.completedToday({orderStatus:'cancelado',deliveredAt:current}),false);
});
test('summary filters reuse canonical statuses; search remains case-insensitive without mutations',()=>{
  const {api,data}=ordersFixture(),before=JSON.stringify(data);api.setFilter('ongoing');assert.deepEqual(Array.from(api.list(),o=>o.id),['PREP']);
  api.setFilter('all');api.setQuery('qa new');assert.deepEqual(Array.from(api.list(),o=>o.id),['NEW']);api.setQuery('NO MATCH');assert.equal(api.list().length,0);assert.equal(JSON.stringify(data),before);
});
test('cards escape content, show quantities/status/total, and keep operations inside canonical details',()=>{
  const {api}=ordersFixture(),html=api.card({id:'safe',publicOrderNumber:'<img>',customerName:'<script>',customerPhone:'0000',items:[{quantity:2},{quantity:3}],total:25,orderStatus:'recebido',createdAt:current,spaceId:'a'});
  assert.match(html,/&lt;script&gt;/);assert.match(html,/5 itens/);assert.match(html,/Atender pedido/);assert.match(html,/data-order="safe"/);assert.match(html,/data-status="recebido"/);
  assert.doesNotMatch(html,/data-order-status|data-finalize-order|<script>/);
  assert.match(api.card({id:'done',items:[],orderStatus:'entregue',createdAt:current}),/Ver detalhes/);
  assert.match(api.card({id:'pending',items:[],orderStatus:'separando',finalizationStatus:'pending',createdAt:current}),/Retomar conclusão/);
});
function storeFixture(){
  const root={innerHTML:''},c={structuredClone,OnlineStoreModel:Store,document:{querySelector:()=>root},SpaceContext:{salesSpaces:()=>[{id:'a',name:'QA A'}]},BusinessContext:{getCurrentBusinessId:()=> 'qa'}};c.window=c;vm.createContext(c);
  vm.runInContext(fs.readFileSync('js/online-store-ui.js','utf8').replace('bindContent(root);window.lucide?.createIcons?.();','window.lucide?.createIcons?.();').replace('window.OnlineStoreUI={render,bind:()=>load()};','window.OnlineStoreUI={render,bind:()=>load()};window.inspectStore={state,draw};'),c);
  Object.assign(c.inspectStore.state,{spaceId:'a',data:{owner:true,store:{published:true,slug:'qa-store'},orders:[],products:[{productId:'p',productName:'<Produto QA>',salePrice:15,productImage:'https://example.invalid/qa.png'}]},draft:{...Store.settings({publicName:'QA A'}),productIds:['p'],presentation:{products:{}}}});return {c,root};
}
test('catalog preserves all six tabs/footer/preview and adds real selected images without quick actions',()=>{
  const {c,root}=storeFixture();c.inspectStore.draw();
  for(const text of ['Visão geral','Tema e marca','Catálogo','Entrega e retirada','Pagamentos','Link e QR Code','Salvar alterações','Desativar loja','Prévia da loja','Ver minha loja','Ainda não medido'])assert.ok(root.innerHTML.includes(text),text);
  assert.match(root.innerHTML,/store-catalog-strip[^]*?img src="https:\/\/example.invalid\/qa.png"/);assert.match(root.innerHTML,/&lt;Produto QA&gt;/);assert.doesNotMatch(root.innerHTML,/Ações rápidas|data-migrate/);
});
test('unpublished store stays in preparation; no public store action or auto activation added',()=>{
  const {c,root}=storeFixture();c.inspectStore.state.data.store.published=false;c.inspectStore.draw();assert.match(root.innerHTML,/Em preparação/);assert.match(root.innerHTML,/Publicar loja/);assert.doesNotMatch(root.innerHTML,/Ver minha loja/);
});
test('CSS confines horizontal scrolling to tabs and retains mobile touch targets/reduced motion',()=>{
  const styles=fs.readFileSync('css/online-store.css','utf8'),orders=fs.readFileSync('css/online-orders.css','utf8');
  assert.match(styles,/\.store-tabs\{flex-wrap:nowrap;overflow-x:auto/);assert.match(styles,/min-height:44px/);assert.match(styles,/prefers-reduced-motion:reduce/);assert.match(orders,/prefers-reduced-motion:reduce/);assert.match(orders,/\.online-v2-grid\{grid-template-columns:minmax\(0,1fr\)/);
});
