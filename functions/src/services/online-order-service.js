'use strict';
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {assertWritable,validId}=require('./workspace-reset-policy');
const {computeAccess}=require('./subscription-service');
const {prepareReservation}=require('./online-stock-reservation');
const Model=require('../shared/online-store'),Orders=require('../shared/online-order');
const {Timestamp,serialize}=require('../shared/online-time');
const {RESERVATION_MS,prepareExpiry}=require('./online-order-expiry');
const {writeOnlineSignal}=require('../shared/online-order-signal');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex'),fail=(code,message)=>{throw new HttpsError(code,message)},text=(v,max)=>String(v||'').trim().slice(0,max);
const phone=v=>{const digits=String(v||'').replace(/\D/g,'');return digits.startsWith('55')&&digits.length>=12?digits:`55${digits}`;};
const publicOrder=o=>serialize({id:o.id,spaceId:o.spaceId,spaceName:o.spaceName,source:o.source,orderStatus:o.orderStatus,publicOrderNumber:o.publicOrderNumber,items:o.items,total:o.total,customerName:o.customerName,customerPhone:o.customerPhone,customerLocation:o.customerLocation,note:o.note,serviceModeType:o.serviceModeType,serviceModeLabel:o.serviceModeLabel,paymentPreference:o.paymentPreference,createdAt:o.createdAt,updatedAt:o.updatedAt,statusHistory:(o.statusHistory||[]).map(e=>({status:e.status,at:e.at})),finalizationStatus:o.finalizationStatus,reservationStatus:o.reservationStatus,reservationExpiresAt:o.reservationExpiresAt,expiredAt:o.expiredAt,expirationReason:o.expirationReason,expiryEligibility:o.expiryEligibility});
function onlineOrderService(db,{clock=()=>Date.now()}={}){
  async function catalogContext(tx,data){
    if(!/^[A-Za-z0-9_-]{20,128}$/.test(data.catalogToken||''))fail('invalid-argument','Loja inválida.');
    const catalogRef=db.doc(`publicCatalogs/${data.catalogToken}`),catalog=(await tx.get(catalogRef)).data(),binding=(await tx.get(db.doc(`catalogStoreBindings/${data.catalogToken}`))).data();
    if(!catalog||catalog.schemaVersion<6||!binding||binding.businessId!==catalog.businessId||binding.spaceId!==catalog.spaceId)fail('failed-precondition','Loja indisponível.');
    const root=db.doc(`businesses/${binding.businessId}`),business=(await tx.get(root)).data(),store=(await tx.get(root.collection('onlineStores').doc(binding.storeId))).data(),space=(await tx.get(db.doc(`financialSpaces/${binding.spaceId}`))).data();
    if(!business?.active||!store||store.publicToken!==data.catalogToken||!space||space.active===false||space.capabilities?.sales!==true||(space.businessId||space.linkedBusinessId)!==root.id||space.businessId&&space.linkedBusinessId&&space.businessId!==space.linkedBusinessId)fail('permission-denied','Loja ou espaço indisponível.');
    return {root,business,store,space,catalog,catalogRef,binding};
  }
  async function submit(request){
    const data=request.data||{},id=text(data.id,100),accessToken=String(data.orderAccessToken||'');
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(id)||!/^[a-f0-9]{32,128}$/.test(accessToken))fail('invalid-argument','Identificador de pedido inválido.');
    const customerName=text(data.customerName,120),customerPhone=phone(data.customerPhone),customerLocation=text(data.customerLocation,300),note=text(data.note,1000),serviceMode=String(data.serviceModeId||'pickup'),paymentPreference=String(data.paymentPreference||'entrega');
    if(customerName.length<2||!/^55\d{10,11}$/.test(customerPhone))fail('invalid-argument','Informe nome e telefone com DDD.');
    if(!Array.isArray(data.items)||!data.items.length||data.items.length>40)fail('invalid-argument','Itens inválidos.');
    const inputItems=data.items.map(i=>({catalogItemId:String(i.catalogItemId||''),quantity:Number(i.quantity)})).sort((a,b)=>a.catalogItemId.localeCompare(b.catalogItemId));
    if(new Set(inputItems.map(i=>i.catalogItemId)).size!==inputItems.length)fail('invalid-argument','Itens duplicados.');
    const fingerprint=hash([data.catalogToken,customerName,customerPhone,customerLocation,note,serviceMode,paymentPreference,inputItems,hash(accessToken)]);
    return db.runTransaction(async tx=>{
      const c=await catalogContext(tx,data),ref=c.root.collection('catalogOrders').doc(id),prior=await tx.get(ref);
      if(prior.exists){if(prior.data().requestFingerprint!==fingerprint)fail('already-exists','Esta tentativa já existe com dados diferentes. Verifique o pedido anterior.');const expiry=await prepareExpiry(tx,c.root,c.business,prior.data(),{now:clock()});if(expiry)expiry.commit();return {order:publicOrder(expiry?.order||prior.data()),idempotent:true};}
      assertWritable(c.business,data.workspaceGeneration??0);const access=computeAccess(c.business.subscription||{});
      if(!access.canMutate||!access.unlimited&&!access.features?.onlineOrders||c.store.v2Enabled!==true||!c.store.published||!c.store.checkoutEnabled||!c.catalog.acceptingOrders)fail('failed-precondition','A loja não está recebendo pedidos.');
      if(!['pickup','delivery'].includes(serviceMode)||serviceMode==='pickup'&&c.store.catalogSettings.pickupEnabled===false||serviceMode==='delivery'&&!c.store.catalogSettings.deliveryEnabled)fail('invalid-argument','Entrega ou retirada não disponível.');
      if(serviceMode==='delivery'&&customerLocation.length<8)fail('invalid-argument','Informe o endereço completo para entrega.');
      if(!(c.store.catalogSettings.paymentMethods||[]).includes(paymentPreference))fail('invalid-argument','Forma de pagamento não disponível.');
      const items=[];
      for(const raw of inputItems){
        const split=raw.catalogItemId.lastIndexOf('::'),baseId=split>0?raw.catalogItemId.slice(0,split):raw.catalogItemId,variantId=split>0?raw.catalogItemId.slice(split+2):null,published=(c.catalog.items||[]).find(i=>i.id===baseId);
        if(!published||published.active===false||!Number.isInteger(raw.quantity)||raw.quantity<1||raw.quantity>999)fail('invalid-argument','Produto indisponível ou quantidade inválida.');
        validId(published.productId,'Produto');const product=(await tx.get(c.root.collection('products').doc(published.productId))).data();
        if(!Model.allows(product,c.store.spaceId)||!c.store.selectedProductIds.includes(published.productId))fail('permission-denied','Produto não pertence à loja deste espaço.');
        let variant=null;if(variantId){validId(variantId,'Variação');variant=(await tx.get(c.root.collection('productVariants').doc(variantId))).data();if(!Model.active(variant)||variant.parentProductId!==published.productId||variant.catalogVisible===false)fail('invalid-argument','Variação indisponível.');}
        if(product.productType==='variable'&&!variant||variant&&product.productType!=='variable')fail('invalid-argument','Selecione uma variação válida.');
        if(product.productType==='recurring')fail('failed-precondition','Este item recorrente exige atendimento específico. Solicite pelo WhatsApp da loja.');
        const price=Number(variant?variant.price:c.store.presentation?.products?.[published.productId]?.price??product.preco),cents=Math.round(price*100);
        if(!Number.isFinite(price)||cents<=0)fail('failed-precondition','Produto sem preço válido.');
        items.push({productId:published.productId,variantId,catalogItemId:raw.catalogItemId,name:variant?`${published.productName} — ${variant.displayName}`:published.productName,productNameSnapshot:published.productName,variantNameSnapshot:variant?.displayName||null,attributesSnapshot:variant?.attributeValues||{},quantity:raw.quantity,unitPrice:cents/100,subtotal:cents*raw.quantity/100,itemKind:product.itemKind||'product',productType:product.productType||'simple'});
      }
      const totalCents=items.reduce((sum,i)=>sum+Math.round(i.subtotal*100),0);if(totalCents<1||totalCents>1000000)fail('invalid-argument','Total inválido.');
      if(data.expectedTotal!=null&&Math.round(Number(data.expectedTotal)*100)!==totalCents)fail('failed-precondition','O preço mudou. Atualize o catálogo e revise o resumo antes de confirmar.');
      const reservation=await prepareReservation(tx,c.root,c.store,items),createdAt=Timestamp.fromMillis(clock()),operationId=`catalog-order:${id}`,order={id,businessId:c.root.id,spaceId:c.store.spaceId,spaceName:c.space.name||c.space.nome||'Espaço',storeId:c.store.id,catalogToken:data.catalogToken,source:'online_store',schemaVersion:2,workspaceGeneration:data.workspaceGeneration??0,requestFingerprint:fingerprint,accessTokenHash:hash(accessToken),orderStatus:'recebido',publicOrderNumber:`VC-${id.slice(0,8).toUpperCase()}`,customerName,customerPhone,customerLocation,note,serviceModeType:serviceMode,serviceModeId:serviceMode,serviceModeLabel:serviceMode==='delivery'?'Entrega':'Retirada',paymentPreference,paymentStatus:'pendente',items,subtotal:totalCents/100,total:totalCents/100,fee:0,discount:0,operationId,reservationStatus:'reserved',expiryEligibility:'automatic',reservationExpiresAt:Timestamp.fromMillis(createdAt.toMillis()+RESERVATION_MS),finalizationStatus:'none',createdAt,updatedAt:createdAt,statusHistory:[{status:'recebido',at:createdAt,actorUid:null}],revision:1};
      reservation.commit(tx,order.workspaceGeneration);tx.create(c.root.collection('onlineOrderReservations').doc(id),{businessId:c.root.id,spaceId:order.spaceId,storeId:order.storeId,operationId,workspaceGeneration:order.workspaceGeneration,status:'reserved',items:reservation.changes.map(r=>r.row),createdAt});tx.create(ref,order);writeOnlineSignal(tx,c.root,createdAt,{stock:true});
      return {order:publicOrder(order),idempotent:false};
    });
  }
  async function status(request){const data=request.data||{};validId(data.id,'Pedido');if(!/^[A-Za-z0-9_-]{20,128}$/.test(data.catalogToken||''))fail('invalid-argument','Loja inválida.');return db.runTransaction(async tx=>{const catalog=(await tx.get(db.doc(`publicCatalogs/${data.catalogToken}`))).data();if(catalog&&catalog.schemaVersion<6){const legacy=await require('./online-legacy-order-status').legacyOrderStatus(tx,db,data,catalog);return {order:publicOrder(legacy)};}const c=await catalogContext(tx,data),order=(await tx.get(c.root.collection('catalogOrders').doc(data.id))).data();if(!order||order.catalogToken!==data.catalogToken||order.accessTokenHash!==hash(String(data.orderAccessToken||'')))fail('not-found','Pedido não encontrado.');const expiry=await prepareExpiry(tx,c.root,c.business,order,{now:clock()});if(expiry)expiry.commit();return {order:publicOrder(expiry?.order||order)};});}
  async function actorContext(tx,request){
    const data=request.data||{},uid=request.auth?.uid;if(!uid)fail('unauthenticated','Entre na sua conta.');validId(data.businessId,'Empresa');validId(data.id,'Pedido');
    const root=db.doc(`businesses/${data.businessId}`),business=(await tx.get(root)).data(),member=(await tx.get(root.collection('members').doc(uid))).data(),profile=(await tx.get(db.doc(`users/${uid}`))).data(),orderRef=root.collection('catalogOrders').doc(data.id),order=(await tx.get(orderRef)).data();
    const role=member?.role||(!business?.legacyAccessDisabled&&profile?.businessId===root.id&&profile.active!==false?profile.role:null),active=member?member.status==='active':!!role;
    if(!business?.active||!active||!Orders.isV2(order)||order.businessId!==root.id||!order.spaceId)fail('permission-denied','Pedido não autorizado.');
    if(role!=='owner'&&(!member?.permissions?.['sales.create']||!member.permissions['sales.viewAll']||member.spaceAccess!=='all'&&!(member.allowedSpaceIds||[]).includes(order.spaceId)))fail('permission-denied','Sem permissão para este pedido ou espaço.');
    assertWritable(business,data.workspaceGeneration??0);if(order.workspaceGeneration!==(data.workspaceGeneration??0))fail('failed-precondition','Pedido de uma geração antiga.');
    const access=computeAccess(business.subscription||{});if(!access.canMutate||!access.unlimited&&!access.features?.onlineOrders)fail('permission-denied','Plano sem acesso aos pedidos online.');
    const space=(await tx.get(db.doc(`financialSpaces/${order.spaceId}`))).data();if(!space||space.active===false||(space.businessId||space.linkedBusinessId)!==root.id||space.businessId&&space.linkedBusinessId&&space.businessId!==space.linkedBusinessId||space.capabilities?.sales!==true)fail('permission-denied','Espaço indisponível.');
    return {root,business,orderRef,order,uid,role,member,actorName:profile?.name||profile?.nome||'Operador',data};
  }
  async function change(request){return db.runTransaction(async tx=>{
    const c=await actorContext(tx,request),target=c.data.status;
    const expiry=await prepareExpiry(tx,c.root,c.business,c.order,{now:clock()});if(expiry){expiry.commit();return {order:serialize(expiry.order),expired:!expiry.review,review:!!expiry.review};}
    if(target==='cancelado'&&(c.order.paymentIntentId||c.order.paymentIntentIds?.length))fail('failed-precondition','Verifique o pagamento integrado antes de liberar a reserva.');
    if(target==='cancelado'&&c.role!=='owner'&&!c.member?.permissions?.['sales.cancel'])fail('permission-denied','Sem permissão para cancelar pedidos.');
    if(target===c.order.orderStatus)return {order:serialize(c.order),idempotent:true};
    if(c.order.finalizationStatus==='pending')fail('failed-precondition','A conclusão já começou. Retome-a antes de outra ação.');
    if(target==='entregue')fail('failed-precondition','Conclua pela venda canônica.');
    if(Number(c.data.revision)!==c.order.revision)fail('aborted','O pedido mudou em outro aparelho. Atualize antes de agir.');
    try{Orders.assertTransition(c.order.orderStatus,target,c.order.serviceModeType);}catch(e){fail('failed-precondition',e.message);}
    let release=null,marker=null;if(target==='cancelado'){marker=c.root.collection('onlineOrderReservations').doc(c.order.id);const held=(await tx.get(marker)).data();if(held?.status!=='reserved')fail('failed-precondition','Reserva inconsistente; nenhuma baixa foi feita.');if(held.items.length)release=await prepareReservation(tx,c.root,{spaceId:c.order.spaceId},held.items,{release:true});}
    const at=Timestamp.fromMillis(clock()),order={...c.order,orderStatus:target,revision:c.order.revision+1,updatedAt:at,statusHistory:[...c.order.statusHistory,{status:target,at,actorUid:c.uid}]};
    if(release)release.commit(tx,order.workspaceGeneration);if(marker){order.reservationStatus='released';tx.update(marker,{status:'released',releasedAt:at});}tx.set(c.orderRef,order);writeOnlineSignal(tx,c.root,at,{stock:target==='cancelado'});return {order:serialize(order),idempotent:false};
  });}
  async function claim(request){return db.runTransaction(async tx=>{
    const c=await actorContext(tx,request),order=c.order;
    if(order.orderStatus==='entregue')return {order:serialize(order),completed:true};
    if(!['separando','deslocamento'].includes(order.orderStatus))fail('failed-precondition','Marque o pedido como Pronto antes de concluir.');
    if(order.finalizationStatus==='pending')return {order:serialize(order),replayed:true};
    if(Number(c.data.revision)!==order.revision)fail('aborted','O pedido mudou. Atualize antes de concluir.');
    const saleStatus=c.data.saleStatus,method=String(c.data.paymentMethod||'');if(!['pago','fiado'].includes(saleStatus)||saleStatus==='pago'&&!['dinheiro','pix','cartao','pago'].includes(method))fail('invalid-argument','Confirme a forma de recebimento.');
    const clientId=c.data.clientId||null;if(saleStatus==='fiado'&&!clientId)fail('failed-precondition','Selecione um cliente para fiado.');
    if(clientId){validId(clientId,'Cliente');const client=(await tx.get(c.root.collection('clients').doc(clientId))).data();if(!Model.active(client)||client.businessId&&client.businessId!==c.root.id)fail('permission-denied','Cliente não autorizado.');}
    const marker=(await tx.get(c.root.collection('onlineOrderReservations').doc(order.id))).data();if(marker?.status!=='reserved')fail('failed-precondition','Reserva não disponível.');
    const at=Timestamp.fromMillis(clock()),next={...order,saleItems:Orders.saleItems(order.items),finalizationStatus:'pending',saleId:`online_${order.id}`,finalizationOperationId:`online-sale:${order.id}`,finalizationActorUid:c.uid,finalizationActorName:c.actorName,saleStatus,paymentMethod:saleStatus==='fiado'?'fiado':method,clientId,reservedQuantities:Object.fromEntries(marker.items.map(i=>[i.variantId?`v_${i.variantId}`:`p_${i.productId}`,i.quantity])),revision:order.revision+1,updatedAt:at,finalizationStartedAt:at};
    tx.set(c.orderRef,next);writeOnlineSignal(tx,c.root,at);return {order:serialize(next),replayed:false};
  });}
  async function acknowledge(request){return db.runTransaction(async tx=>{
    const c=await actorContext(tx,request),order=c.order;if(order.orderStatus==='entregue')return {order:serialize(order),idempotent:true};
    if(order.finalizationStatus!=='pending')fail('failed-precondition','A conclusão não foi iniciada.');
    const sale=(await tx.get(c.root.collection('sales').doc(order.saleId))).data(),processed=(await tx.get(c.root.collection('processedOperations').doc(order.finalizationOperationId))).data();
    if(!sale||!processed||sale.onlineOrderId!==order.id||sale.operationId!==order.finalizationOperationId||sale.spaceId!==order.spaceId||sale.actorUid!==order.finalizationActorUid||Math.round(sale.valorFinal*100)!==Math.round(order.total*100)||sale.status!==order.saleStatus||sale.formaPagamento!==order.paymentMethod||sale.clienteId!==order.clientId||sale.status==='fiado'&&!sale.financialAppliedAt)fail('failed-precondition','Venda ainda sem confirmação na nuvem. Retome a mesma conclusão, sem gerar outra venda.');
    if(sale.itens?.length!==order.items.length||order.items.some((i,n)=>{const s=sale.itens[n];return s.produtoId!==i.productId||(s.variantId||null)!==i.variantId||Number(s.quantidade)!==i.quantity||Math.round(s.precoFinalUnitario*100)!==Math.round(i.unitPrice*100);}))fail('failed-precondition','Venda diferente do pedido. Revisão necessária.');
    const marker=c.root.collection('onlineOrderReservations').doc(order.id),held=(await tx.get(marker)).data();if(held?.status!=='reserved')fail('failed-precondition','Reserva inconsistente.');
    if(held.items.length){
      // The canonical sale operation must include its stock receipts before a held unit is released.
      const receipts=(await tx.get(c.root.collection('stockMovements').where('operationId','==',order.finalizationOperationId).limit(41))).docs.map(s=>s.data());
      if(receipts.length!==held.items.length||held.items.some(i=>{const matches=receipts.filter(m=>m.vendaId===order.saleId&&m.produtoId===i.productId&&(m.variantId||null)===i.variantId&&m.tipo==='saida_venda');return matches.length!==1||Number(matches[0].quantidade)!==-i.quantity||Number(matches[0].estoqueAnterior)-Number(matches[0].estoqueNovo)!==i.quantity;}))fail('failed-precondition','Movimentação de estoque ainda sem confirmação. Retome a mesma conclusão; a reserva foi preservada.');
    }
    const release=held.items.length?await prepareReservation(tx,c.root,{spaceId:order.spaceId},held.items,{release:true}):null,at=Timestamp.fromMillis(clock()),next={...order,orderStatus:'entregue',convertedSaleId:order.saleId,finalizationStatus:'completed',reservationStatus:'consumed',paymentStatus:order.saleStatus==='fiado'?'fiado':'pago',deliveredAt:at,updatedAt:at,revision:order.revision+1,statusHistory:[...order.statusHistory,{status:'entregue',at,actorUid:c.uid}]};
    if(release)release.commit(tx,order.workspaceGeneration);tx.update(marker,{status:'consumed',saleId:order.saleId,consumedAt:at});tx.set(c.orderRef,next);writeOnlineSignal(tx,c.root,at,{stock:true});return {order:serialize(next),idempotent:false};
  });}
  return {submit,status,change,claim,acknowledge};
}
module.exports={onlineOrderService,publicOrder};
