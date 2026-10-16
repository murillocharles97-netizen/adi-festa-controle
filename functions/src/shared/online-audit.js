'use strict';
const {logger}=require('firebase-functions');
// Emit only after the transaction resolves. Never log request bodies, buyer data,
// access tokens, catalogue tokens, authorization headers or payment credentials.
async function auditOnline(event,request,action){
  try{
    const result=await action(),record=result.order||result.store||{};
    logger.info('[ONLINE_V2]',{event,businessId:record.businessId||request.data?.businessId||null,
      spaceId:record.spaceId||request.data?.spaceId||null,orderId:result.order?.id||null,
      storeId:result.store?.id||null,actorUid:request.auth?.uid||null,status:record.orderStatus||null,
      reservationStatus:record.reservationStatus||null,revision:record.revision||null,
      operationId:record.finalizationOperationId||record.expirationOperationId||record.operationId||null,
      saleId:record.convertedSaleId||record.saleId||null,finalizationStatus:record.finalizationStatus||null,
      replayed:!!(result.idempotent||result.replayed),v2Enabled:record.v2Enabled===true,
      ...(request.data?.action==='set_order_reception'?{action:'set_order_reception',checkoutEnabled:record.checkoutEnabled===true}:{}),
      timestamp:new Date().toISOString()});
    return result;
  }catch(error){logger.warn('[ONLINE_V2_ERROR]',{event,code:error.code||'internal',businessId:request.data?.businessId||null,spaceId:request.data?.spaceId||null,orderId:request.data?.id||null});throw error;}
}
module.exports={auditOnline};
