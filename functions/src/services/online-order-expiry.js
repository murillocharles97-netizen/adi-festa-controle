'use strict';
const {assertWritable}=require('./workspace-reset-policy');
const {prepareReservation}=require('./online-stock-reservation');
const {isV2}=require('../shared/online-order');
const {Timestamp,millis}=require('../shared/online-time');
const {writeOnlineSignal}=require('../shared/online-order-signal');
const {HttpsError}=require('firebase-functions/v2/https');
const RESERVATION_MS=30*60*1000;
// All reads precede writes. Confirmation and expiry contend on the same order.
async function prepareExpiry(tx,root,business,order,{now=Date.now()}={}){
  if(!isV2(order)||order.orderStatus!=='recebido'||order.expiryEligibility==='review_required'||!order.reservationExpiresAt||millis(order.reservationExpiresAt)>now)return null;
  assertWritable(business,order.workspaceGeneration??0);
  // Never free a unit tied to a sale, claim or uncertain/real integrated payment.
  if(order.finalizationStatus!=='none'||order.saleId||order.convertedSaleId||order.paymentIntentId||order.paymentIntentIds?.length||order.paymentStatus!=='pendente'){
    const at=Timestamp.fromMillis(now),next={...order,expiryEligibility:'review_required',expiryReviewRequiredAt:at,expiryReviewReason:'payment_or_finalization_pending',updatedAt:at,revision:order.revision+1};
    return {review:true,order:next,commit(){tx.set(root.collection('catalogOrders').doc(order.id),next);writeOnlineSignal(tx,root,at);}};
  }
  const marker=root.collection('onlineOrderReservations').doc(order.id),held=(await tx.get(marker)).data();
  if(order.reservationStatus!=='reserved'||held?.status!=='reserved'||held.workspaceGeneration!==(order.workspaceGeneration??0)||held.spaceId!==order.spaceId)throw new HttpsError('failed-precondition','Reserva inconsistente; expiração não aplicada.');
  const release=held.items.length?await prepareReservation(tx,root,{spaceId:order.spaceId},held.items,{release:true}):null;
  const at=Timestamp.fromMillis(now),operationId=`online-expire:${order.id}`,next={...order,orderStatus:'expirado',expiryEligibility:'expired',reservationStatus:'released',expiredAt:at,expirationReason:'reservation_timeout',expirationOperationId:operationId,updatedAt:at,revision:order.revision+1,statusHistory:[...(order.statusHistory||[]),{status:'expirado',at,actorUid:null,reason:'reservation_timeout',operationId}]};
  return {order:next,commit(){if(release)release.commit(tx,order.workspaceGeneration);tx.update(marker,{status:'released',releasedAt:at,releaseReason:'reservation_timeout',expirationOperationId:operationId});tx.set(root.collection('catalogOrders').doc(order.id),next);writeOnlineSignal(tx,root,at,{stock:true});}};
}
function onlineOrderExpiry(db,{clock=()=>Date.now()}={}){
  async function expire(businessId,id){const result=await db.runTransaction(async tx=>{const root=db.doc(`businesses/${businessId}`),business=(await tx.get(root)).data(),order=(await tx.get(root.collection('catalogOrders').doc(id))).data();if(!business?.active||!order||order.businessId!==businessId)return {expired:false};const pending=await prepareExpiry(tx,root,business,order,{now:clock()});if(!pending)return {expired:false,status:order.orderStatus};pending.commit();return {expired:!pending.review,review:!!pending.review,status:pending.order.orderStatus,operationId:pending.order.expirationOperationId||null,spaceId:order.spaceId};});if(result.expired||result.review)require('firebase-functions').logger.info('[ONLINE_V2]',{event:result.expired?'RESERVATION_EXPIRED':'RESERVATION_REVIEW',businessId,orderId:id,spaceId:result.spaceId,status:result.status,operationId:result.operationId,reservationStatus:result.expired?'released':'reserved',timestamp:new Date().toISOString()});return result;}
  async function sweep(){
    const base=db.collectionGroup('catalogOrders').where('orderStatus','==','recebido').where('expiryEligibility','==','automatic').where('reservationExpiresAt','<=',Timestamp.fromMillis(clock())).orderBy('reservationExpiresAt').limit(100);
    const result={checked:0,expired:0,review:0,failed:0,pages:0};let cursor=null;
    do{
      const rows=await (cursor?base.startAfter(cursor):base).get();result.pages++;
      for(const row of rows.docs){const parts=row.ref.path.split('/');if(parts.length!==4||parts[0]!=='businesses')continue;result.checked++;try{const r=await expire(parts[1],row.id);if(r.expired)result.expired++;if(r.review)result.review++;}catch(error){result.failed++;console.error('[ONLINE_ORDER_EXPIRY]',{businessId:parts[1],orderId:row.id,code:error.code||'expiry-failed'});}}
      cursor=rows.size===100?rows.docs.at(-1):null;
    }while(cursor&&result.pages<5);
    result.more=!!cursor;
    return result;
  }
  return {expire,sweep};
}
module.exports={RESERVATION_MS,prepareExpiry,onlineOrderExpiry};
