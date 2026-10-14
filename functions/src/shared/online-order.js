(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OnlineOrderModel=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const labels={recebido:'Novo',confirmado:'Confirmado',preparando:'Preparando',separando:'Pronto',deslocamento:'Enviado',entregue:'Concluído',cancelado:'Cancelado',expirado:'Expirado'};
  const transitions={recebido:['confirmado','cancelado'],confirmado:['preparando','cancelado'],preparando:['separando','cancelado'],separando:['deslocamento','entregue','cancelado'],deslocamento:['entregue','cancelado'],entregue:[],cancelado:[],expirado:[]};
  function next(status,mode){return (transitions[status]||[]).filter(s=>s!=='cancelado'&&(mode!=='pickup'||s!=='deslocamento'));}
  function assertTransition(from,to,mode){if(!next(from,mode).includes(to)&&to!=='cancelado'||to==='cancelado'&&!(transitions[from]||[]).includes(to))throw Error('Mudança de status não permitida.');}
  const isV2=order=>order?.schemaVersion>=2&&order?.source==='online_store';
  // One operational item representation, shared by the claim and canonical Vendas pipeline.
  // Costs/profit remain in the existing protected financial projections, not in this snapshot.
  function saleItems(items){return items.map(i=>({produtoId:i.productId,productId:i.productId,variantId:i.variantId||null,nome:i.name,productNameSnapshot:i.productNameSnapshot||i.name,variantNameSnapshot:i.variantNameSnapshot||null,attributesSnapshot:i.attributesSnapshot||{},sku:i.sku||'',barcode:i.barcode||'',productImage:i.productImage||'',productMainImage:i.productMainImage||'',imageUpdatedAt:i.imageUpdatedAt||null,categoryId:i.categoryId||null,categoryNameSnapshot:i.categoryNameSnapshot||'Sem categoria',quantidade:i.quantity,quantity:i.quantity,precoOriginal:i.unitPrice,precoFinalUnitario:i.unitPrice,subtotalOriginal:i.subtotal,subtotalFinal:i.subtotal,precoUnitario:i.unitPrice,unitPriceSnapshot:i.unitPrice,campaignDiscounts:[],productType:i.productType||'simple',itemKind:i.itemKind||'product',recurringActivation:null}));}
  return Object.freeze({labels,transitions,next,assertTransition,isV2,saleItems});
});
