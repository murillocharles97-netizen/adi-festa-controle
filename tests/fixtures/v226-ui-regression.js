/* Synthetic, local-only fixture. No Firebase SDK, credentials or production fallback. */
(function () {
  'use strict';
  const businessId='qa-v226-ui', uid='qa-v226-owner', now=new Date().toISOString();
  const member={uid,role:'owner',status:'active',permissions:{},spaceAccess:'all',allowedSpaceIds:[]};
  let context={businessId,role:'owner',loading:false,business:{id:businessId,name:'Loja fictícia QA',ownerId:uid,workspaceGeneration:0},userProfile:{uid,businessId,active:true},member,permissions:['*'],spaceAccess:'all',allowedSpaceIds:[],access:{canMutate:true}},route='inicio';
  const data={config:{nome:'Loja fictícia QA',dashboard:{dailySalesGoal:200,dailySalesGoalsBySpaceId:{'qa-a':100,'qa-b':100}}},vendas:[
    {id:'qa-sale-a',businessId,spaceId:'qa-a',status:'pago',data:now,valorFinal:50,custoTotal:20,itens:[{produtoId:'qa-product',quantidade:1,subtotalFinal:50}]},
    {id:'qa-sale-b',businessId,spaceId:'qa-b',status:'pago',data:now,valorFinal:30,custoTotal:12,itens:[]}
  ],pagamentos:[],clientes:[{id:'qa-client',businessId,nome:'Cliente fictício',ativo:true,saldo:0}],produtos:[{id:'qa-product',businessId,nome:'Produto fictício',ativo:true,preco:50,custo:20,estoqueAtual:10,categoria:'QA',spaceAccessMode:'all_spaces'}],campanhas:[],progressosCampanha:[],recompensas:[],catalogOrders:[]};
  const spaces=['a','b'].map((id,index)=>({id:'qa-'+id,businessId,linkedBusinessId:businessId,ownerUid:uid,type:'business',active:true,name:index?'Filial QA':'Matriz QA',capabilities:{sales:true,products:true,inventory:true,goals:true,finance:true}}));
  const effects={writes:0,calls:[],messages:[]};
  const forbidden=()=>{effects.writes++;throw Error('QA: mutação comercial bloqueada');};
  window.V226UIQA={data,spaces,effects,context:()=>context,change(patch){context={...context,...patch};window.FirebaseSession={user:{uid:context.userProfile.uid},businessId:context.businessId};dispatchEvent(new CustomEvent('business-context-changed'));},route(value){route=value;},render(value=route){route=value;document.querySelector('#app').innerHTML=route==='inicio'?MobileHome.render():Checkout.view();if(route==='inicio')MobileHome.bind();else{Checkout.bind();if(window.DesktopSales?.isDesktop?.())DesktopSales.bind();else CheckoutMobile.enhance();}SpaceContext.bind();},sourceScripts:['functions/src/shared/permission-policy.js','js/team-access.js','js/spaces.js','js/performance-access.js','js/home-mobile.js','js/sale-money.js','js/product-variations.js','functions/src/shared/prior-sale-policy.js','js/prior-sales.js','js/checkout.js','js/desktop-sales.js','js/checkout-mobile.js']};
  window.BusinessContext={get:()=>context,canAccessSpace:id=>context.spaceAccess==='all'||context.allowedSpaceIds.includes(id)};
  window.FirebaseSession={user:{uid},businessId};window.AdiFestaBuild={release:'226',priorSalesPaused:false};
  window.DB={carregar:()=>data,getBusinessId:()=>context.businessId,getPrincipal:()=>context.userProfile.uid,getWorkspaceGeneration:()=>0,flush:async()=>{},alterar:forbidden};
  window.Repositories={productRepository:()=>({list:()=>data.produtos,getById:id=>data.produtos.find(p=>p.id===id)}),clientRepository:()=>({list:()=>data.clientes,getById:id=>data.clientes.find(c=>c.id===id)}),saleRepository:()=>({list:()=>data.vendas,create:forbidden})};
  window.Produtos={obter:id=>data.produtos.find(p=>p.id===id)};window.Clientes={listar:()=>data.clientes};window.Campanhas={aplicarBeneficios:x=>x,resumoCarrinho:()=>[],status:()=>'',metricas:()=>({})};window.OperationMode={enabled:()=>false};
  window.Router={atual:()=>route,ir:value=>window.V226UIQA.render(value)};window.AppPageRuntime={mount:value=>window.V226UIQA.render(value)};
  window.CustomerSubscriptions={metrics:()=>({})};window.getProductStockStatus=()=> 'disponivel';window.productControlsStock=()=>true;window.lucide={createIcons(){}};
  window.Utils={escapar:value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),dinheiro:value=>Number(value).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),somenteNumeros:value=>String(value??'').replace(/\D/g,''),hoje:value=>new Date(value).toDateString()===new Date().toDateString(),toast:message=>effects.messages.push(message)};
  window.SyncFirebase={isSalePending:()=>false,pullCloudCollections:async()=>{}};
  window.FirebaseCallable=async(name,payload)=>{effects.calls.push({name,payload});throw Error('QA visual: envio e confirmação comercial indisponíveis');};
  window.fetch=async()=>{throw Error('QA: rede bloqueada');};
})();
