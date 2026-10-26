(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.OnlineOrderFinalization=api;})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  // Orchestrates the EXISTING sale operation, never a second sale implementation.
  function create(deps){const active=new Map();return function finalize(order,choice={}){
    const key=`${order.businessId}:${order.id}`;if(active.has(key))return active.get(key);
    const work=(async()=>{
      let result=await deps.call('claimOnlineOrderFinalization',{id:order.id,businessId:order.businessId,revision:order.revision,...choice});
      order=result.order;deps.save(order);if(result.completed)return order;
      let sale=await deps.readSale(order,{flush:true});
      if(!sale){
        if(order.finalizationActorUid!==deps.actorUid())throw Error('A conclusão foi iniciada por outro operador. Retome com o mesmo operador ou solicite revisão ao proprietário.');
        await deps.refreshStock(order);
        if(order.clientId&&deps.confirmCustomer)await deps.confirmCustomer(order.clientId,order);
        if(order.saleStatus==='fiado')await deps.confirmBalance(order.clientId);
        if(order.finalizationActorUid!==deps.actorUid())throw Error('O operador ativo mudou. Retome com o operador original.');
        deps.registerSale({id:order.saleId,operationId:order.finalizationOperationId,onlineOrderId:order.id,onlineOrderItems:order.items,businessId:order.businessId,spaceId:order.spaceId,financialSpaceId:order.spaceId,clienteId:order.clientId,status:order.saleStatus,formaPagamento:order.paymentMethod,observacao:`Loja Online · ${order.publicOrderNumber}${order.note?` — ${order.note}`:''}`,itens:order.items.map(i=>({produtoId:i.productId,variantId:i.variantId,nome:i.name,productNameSnapshot:i.productNameSnapshot,variantNameSnapshot:i.variantNameSnapshot,attributesSnapshot:i.attributesSnapshot,quantidade:i.quantity,precoOriginal:i.unitPrice,precoFinalUnitario:i.unitPrice}))});
        sale=await deps.readSale(order,{flush:true});
        if(!sale)throw Error('Venda aguardando confirmação na nuvem. Use Retomar conclusão; não crie outra venda.');
      }
      result=await deps.call('acknowledgeOnlineOrderFinalization',{id:order.id,businessId:order.businessId});deps.save(result.order);
      await deps.refreshStock(result.order);return result.order;
    })().finally(()=>active.delete(key));active.set(key,work);return work;
  };}
  return Object.freeze({create});
});
