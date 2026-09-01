'use strict';

const {FieldValue}=require('firebase-admin/firestore');
const {getPlan}=require('./plan-service');
const {counterId}=require('./coupon-firestore-service');

const TERMINAL_STATUSES=new Set(['canceled','cancelled','expired','failed','refunded','charged_back']);

function asNumber(value){const number=Number(value);return Number.isFinite(number)?number:null}
function firstOrderPayment(order={}){return order?.transactions?.payments?.[0]||{}}
function firstPixPayment(order={}){return order?.transactions?.payments?.find?.(payment=>String(payment?.payment_method?.id||'').toLowerCase()==='pix')||firstOrderPayment(order)}
function orderState(order={}){
  const status=String(order.status||'').toLowerCase(),detail=String(order.status_detail||'').toLowerCase();
  if(status==='processed'&&detail==='accredited')return'approved';
  if(status==='action_required'&&detail==='pending_challenge')return'challenge';
  if(TERMINAL_STATUSES.has(status))return status==='cancelled'?'canceled':status;
  if(status==='failed')return'failed';
  return'pending';
}
function absoluteExpiration(value){
  if(!value)return null;
  const date=new Date(String(value));
  return Number.isNaN(date.getTime())?null:date.toISOString();
}
function orderDetails(order={},paymentMethodType='pix_monthly'){
  const payment=paymentMethodType==='pix_monthly'?firstPixPayment(order):firstOrderPayment(order),method=payment.payment_method||{},state=orderState(order),security=method.transaction_security||{};
  return{
    orderId:String(order.id||''),
    paymentId:payment.id==null?null:String(payment.id),
    status:state,
    providerStatus:String(order.status||''),
    statusDetail:String(order.status_detail||''),
    amount:asNumber(payment.amount??order.total_amount),
    qrCode:state==='pending'?String(method.qr_code||''):null,
    qrCodeBase64:state==='pending'?String(method.qr_code_base64||''):null,
    ticketUrl:state==='pending'?String(method.ticket_url||''):null,
    expiresAt:absoluteExpiration(payment.expiration_time||order.expiration_time),
    challengeUrl:state==='challenge'?String(security.url||''):null,
    transactionSecurityStatus:String(security.status||'')||null,
    paymentMethodId:String(method.id||'')||null,
    paymentMethodType:String(method.type||'')||null
  };
}
const pixDetails=order=>orderDetails(order,'pix_monthly');
function validateOrder(order,index={}){
  const paymentMethodType=String(index.paymentMethodType||'pix_monthly'),payment=paymentMethodType==='pix_monthly'?firstPixPayment(order):firstOrderPayment(order),details=orderDetails(order,paymentMethodType),expected=asNumber(index.chargedPrice),actual=details.amount,reference=String(order.external_reference||''),expectedReference=String(index.expectedExternalReference||''),currency=String(order.currency||order.currency_id||payment?.currency_id||'BRL').toUpperCase(),method=payment?.payment_method||{};
  if(!details.orderId||details.orderId!==String(index.providerOrderId||details.orderId))throw Object.assign(Error('Order do provedor diverge da tentativa segura.'),{code:'provider-order-mismatch'});
  if(reference!==expectedReference)throw Object.assign(Error('Referência externa diverge da tentativa segura.'),{code:'provider-reference-mismatch'});
  if(expected==null||actual==null||Math.abs(expected-actual)>0.009)throw Object.assign(Error('Valor diverge da cotação segura.'),{code:'provider-price-mismatch'});
  if(currency!=='BRL')throw Object.assign(Error('Moeda diverge da cotação segura.'),{code:'provider-currency-mismatch'});
  if(paymentMethodType==='pix_monthly'&&(String(method.id||'').toLowerCase()!=='pix'||String(method.type||'').toLowerCase()!=='bank_transfer'))throw Object.assign(Error('Meio de pagamento do provedor não é Pix.'),{code:'provider-payment-method-mismatch'});
  if(paymentMethodType==='card_monthly'&&(String(method.type||'').toLowerCase()!=='credit_card'||String(method.id||'')!==String(index.paymentMethodId||method.id||'')))throw Object.assign(Error('Meio de pagamento do provedor não corresponde ao cartão tokenizado.'),{code:'provider-payment-method-mismatch'});
  return details;
}
const validatePixOrder=validateOrder;
function addBillingPeriod(start,billingCycle){
  const date=new Date(start);if(Number.isNaN(date.getTime()))throw Error('Data inicial de cobrança inválida.');
  const day=date.getUTCDate(),target=new Date(date);target.setUTCDate(1);
  if(billingCycle==='yearly')target.setUTCFullYear(target.getUTCFullYear()+1);else target.setUTCMonth(target.getUTCMonth()+1);
  const endOfTarget=new Date(Date.UTC(target.getUTCFullYear(),target.getUTCMonth()+1,0)).getUTCDate();target.setUTCDate(Math.min(day,endOfTarget));
  return target.toISOString();
}
function pendingManualSubscription(existing={},data={},now=new Date().toISOString()){
  const activeEnd=new Date(existing.currentPeriodEnd||existing.expiresAt||0),trialEnd=new Date(existing.trialEndsAt||0),active=String(existing.status||'').toLowerCase()==='active'&&activeEnd>new Date(now),trial=['trial','trialing'].includes(String(existing.status||'').toLowerCase())&&trialEnd>new Date(now);
  return{
    ...existing,
    status:active?'active':trial?'trialing':'payment_pending',
    subscriptionStatus:active?'active':trial?'trialing':'payment_pending',
    planId:active||trial?(existing.planId||'trial'):(existing.planId||data.planId),
    pendingPlanId:data.planId,
    pendingBillingCycle:data.billingCycle,
    pendingPaymentMethodType:data.paymentMethodType||'pix_monthly',
    pendingCheckoutAttemptId:data.operationId,
    ...(data.discount?{pendingDiscount:{...data.discount}}:{}),
    provider:'mercado_pago',
    billingStrategy:active?existing.billingStrategy||null:(data.paymentMethodType==='card_monthly'?'manual_card':'guest_pix_manual'),
    updatedAt:now,
    mercadoPago:{...(existing.mercadoPago||{}),pendingOrderId:data.providerOrderId,pendingPaymentId:data.providerPaymentId||null,providerStatus:data.providerStatus||'action_required',checkoutCreatedAt:now}
  };
}
const pendingPixSubscription=(existing,data,now)=>pendingManualSubscription(existing,{...data,paymentMethodType:'pix_monthly'},now);
function publicAttempt(data={}){
  const text=value=>typeof value==='string'&&value?value:null;
  return{
    id:String(data.operationId||data.id||''),planId:String(data.planId||''),billingCycle:String(data.billingCycle||'monthly'),paymentMethodType:String(data.paymentMethodType||'pix_monthly'),status:String(data.status||'payment_pending'),providerStatus:String(data.providerStatus||''),statusDetail:String(data.statusDetail||''),orderId:String(data.providerOrderId||''),paymentId:data.providerPaymentId==null?null:String(data.providerPaymentId),originalAmount:asNumber(data.originalAmount??data.officialPrice),discountAmount:asNumber(data.discountAmount)??0,finalAmount:asNumber(data.finalAmount??data.chargedPrice),couponSnapshot:data.couponSnapshot||null,qrCode:text(data.qrCode),qrCodeBase64:text(data.qrCodeBase64),ticketUrl:text(data.ticketUrl),expiresAt:text(data.expiresAt),approvedAt:text(data.approvedAt),replacesOperationId:text(data.replacesOperationId),replacementOperationId:text(data.replacementOperationId),reviewReason:text(data.reviewReason),challengeUrl:text(data.challengeUrl),transactionSecurityStatus:text(data.transactionSecurityStatus),paymentMethodId:text(data.paymentMethodId)
  };
}

function pixBillingService(db){
  async function resolveIndex(orderId){const snapshot=await db.doc(`billingOrderIndex/${orderId}`).get();return snapshot.exists?snapshot.data():null}
  async function resolvePaymentOrder(payment={}){
    const externalReference=String(payment.external_reference||'').trim();
    if(!/^billing_[a-f0-9]{56}$/.test(externalReference))return null;
    const matches=await db.collection('billingOrderIndex').where('expectedExternalReference','==',externalReference).limit(2).get();
    if(matches.empty)return null;
    if(matches.size!==1)throw Object.assign(Error('Referência Pix associada a mais de uma Order.'),{code:'billing-payment-reference-ambiguous'});
    const doc=matches.docs[0],index=doc.data()||{},orderId=String(index.providerOrderId||doc.id||'');
    if(!orderId||!index.businessId)throw Object.assign(Error('Índice Pix incompleto para o Payment.'),{code:'billing-order-index-invalid'});
    return{orderId,index};
  }
  async function applyOrder(order,{source='webhook',eventId=null}={}){
    const orderId=String(order?.id||'');if(!orderId)throw Object.assign(Error('Order sem identificador.'),{code:'billing-order-id-missing'});
    const indexRef=db.doc(`billingOrderIndex/${orderId}`),indexSnapshot=await indexRef.get(),index=indexSnapshot.data()||{};
    if(!indexSnapshot.exists||!index.businessId)throw Object.assign(Error('Order sem empresa vinculada.'),{code:'billing-order-index-not-found'});
    const details=validateOrder(order,index),paymentMethodType=String(index.paymentMethodType||'pix_monthly'),businessRef=db.doc(`businesses/${index.businessId}`),attemptRef=businessRef.collection('billingCheckoutAttempts').doc(index.operationId),markerRef=db.doc(`billingPaymentEvents/${paymentMethodType==='pix_monthly'?'pix':'card'}_${orderId}`),now=new Date().toISOString();
    return db.runTransaction(async transaction=>{
      const [businessSnapshot,attemptSnapshot,markerSnapshot]=await Promise.all([transaction.get(businessRef),transaction.get(attemptRef),transaction.get(markerRef)]);
      if(!businessSnapshot.exists||!attemptSnapshot.exists)throw Object.assign(Error('Tentativa de pagamento não encontrada.'),{code:'billing-attempt-not-found'});
      const business=businessSnapshot.data()||{},attempt=attemptSnapshot.data()||{};
      if(attempt.businessId!==index.businessId||attempt.providerOrderId!==orderId)throw Object.assign(Error('Tentativa Pix diverge do índice seguro.'),{code:'billing-attempt-mismatch'});
      const terminal=!['pending','challenge','approved'].includes(details.status),attemptPatch={providerStatus:details.providerStatus,statusDetail:details.statusDetail,providerPaymentId:details.paymentId||attempt.providerPaymentId||null,challengeUrl:details.challengeUrl||FieldValue.delete(),transactionSecurityStatus:details.transactionSecurityStatus||null,lastProviderSource:source,lastProviderEventId:eventId||null,lastProviderCheckAt:now,updatedAt:FieldValue.serverTimestamp()};
      if(['pending','challenge'].includes(details.status)){attemptPatch.status=details.status==='challenge'?'payment_challenge':'payment_pending';transaction.set(attemptRef,attemptPatch,{merge:true});transaction.set(indexRef,{status:attemptPatch.status,providerStatus:details.providerStatus,statusDetail:details.statusDetail,providerPaymentId:details.paymentId||null,updatedAt:now},{merge:true});return{businessId:index.businessId,status:attemptPatch.status,subscription:business.subscription||{},attempt:publicAttempt({...attempt,...attemptPatch})}}
      attemptPatch.qrCode=FieldValue.delete();attemptPatch.qrCodeBase64=FieldValue.delete();attemptPatch.ticketUrl=FieldValue.delete();
      const redemptionRef=index.couponRedemptionId?db.doc(`couponRedemptions/${index.couponRedemptionId}`):null,redemptionSnapshot=redemptionRef?await transaction.get(redemptionRef):null,redemption=redemptionSnapshot?.data()||null;
      if(terminal){
        attemptPatch.status=details.status;attemptPatch.terminalAt=now;transaction.set(attemptRef,attemptPatch,{merge:true});transaction.set(indexRef,{status:details.status,providerStatus:details.providerStatus,statusDetail:details.statusDetail,updatedAt:now},{merge:true});
        if(redemption&&['reserved','pending_payment'].includes(redemption.status))changeCouponReservation(transaction,redemptionRef,redemption,'release');
        const subscription=business.subscription||{};if(subscription.pendingCheckoutAttemptId===index.operationId)transaction.update(businessRef,{'subscription.pendingPlanId':FieldValue.delete(),'subscription.pendingBillingCycle':FieldValue.delete(),'subscription.pendingPaymentMethodType':FieldValue.delete(),'subscription.pendingCheckoutAttemptId':FieldValue.delete(),'subscription.pendingDiscount':FieldValue.delete(),'subscription.mercadoPago.pendingOrderId':FieldValue.delete(),'subscription.mercadoPago.pendingPaymentId':FieldValue.delete(),'subscription.mercadoPago.providerStatus':details.providerStatus,'subscription.updatedAt':now,updatedAt:FieldValue.serverTimestamp()});
        return{businessId:index.businessId,status:details.status,subscription,attempt:publicAttempt({...attempt,...attemptPatch})};
      }
      if(markerSnapshot.exists){
        attemptPatch.status='payment_approved';attemptPatch.approvedAt=attempt.approvedAt||markerSnapshot.data()?.approvedAt||now;transaction.set(attemptRef,attemptPatch,{merge:true});
        let subscription=business.subscription||{};
        if(String(subscription.status||'').toLowerCase()==='active'&&String(subscription.subscriptionStatus||'').toLowerCase()!=='active'){
          subscription={...subscription,subscriptionStatus:'active',updatedAt:now};
          transaction.update(businessRef,{'subscription.subscriptionStatus':'active','subscription.updatedAt':now,updatedAt:FieldValue.serverTimestamp()});
        }
        return{businessId:index.businessId,status:'payment_approved',subscription,attempt:publicAttempt({...attempt,...attemptPatch}),idempotent:true};
      }
      if(index.supersededByOperationId){
        attemptPatch.status='payment_review_required';attemptPatch.reviewReason='superseded_order_approved';attemptPatch.approvedAt=order.date_last_updated||order.date_created||now;
        transaction.set(attemptRef,attemptPatch,{merge:true});transaction.set(indexRef,{status:'payment_review_required',providerStatus:details.providerStatus,statusDetail:details.statusDetail,providerPaymentId:details.paymentId,reviewReason:'superseded_order_approved',updatedAt:now},{merge:true});
        return{businessId:index.businessId,status:'payment_review_required',subscription:business.subscription||{},attempt:publicAttempt({...attempt,...attemptPatch}),requiresReview:true};
      }
      const existing=business.subscription||{},currentEnd=new Date(existing.currentPeriodEnd||existing.expiresAt||0),paidAt=new Date(order.date_last_updated||order.date_created||now),periodStart=currentEnd>paidAt?currentEnd:paidAt,periodStartIso=periodStart.toISOString(),periodEnd=addBillingPeriod(periodStartIso,index.billingCycle),plan=getPlan(index.planId);
      const subscription={...existing,status:'active',subscriptionStatus:'active',planId:index.planId,billingCycle:index.billingCycle,paymentMethodType,billingStrategy:paymentMethodType==='card_monthly'?'manual_card':'guest_pix_manual',provider:'mercado_pago',pendingPlanId:null,pendingBillingCycle:null,pendingPaymentMethodType:null,pendingCheckoutAttemptId:null,hasPaidSubscription:true,startedAt:existing.startedAt||periodStartIso,currentPeriodStart:periodStartIso,currentPeriodEnd:periodEnd,expiresAt:periodEnd,nextBillingDate:periodEnd,lastPaymentDate:periodStartIso,lastPaymentStatus:'approved',lastPaymentProviderId:details.paymentId,lastPaymentEventId:eventId||`order:${orderId}`,cancelAtPeriodEnd:false,updatedAt:now,mercadoPago:{...(existing.mercadoPago||{}),pendingOrderId:null,pendingPaymentId:null,lastOrderId:orderId,lastPaymentId:details.paymentId,providerStatus:details.providerStatus,lastWebhook:eventId?now:existing.mercadoPago?.lastWebhook||null},latestPayment:{provider:'mercado_pago',paymentMethod:paymentMethodType==='card_monthly'?'card':'pix',orderId,paymentId:details.paymentId,amount:details.amount,currency:'BRL',paidAt:periodStartIso,couponSnapshot:index.discountSnapshot||null}};
      if(redemption&&redemption.status!=='active'){changeCouponReservation(transaction,redemptionRef,redemption,'confirm');subscription.discount={...(redemption.discountSnapshot||index.discountSnapshot||{})};delete subscription.pendingDiscount}else if(index.discountSnapshot){subscription.discount={...index.discountSnapshot};delete subscription.pendingDiscount}
      transaction.update(businessRef,{subscription,limits:plan?.limits||business.limits||{},updatedAt:FieldValue.serverTimestamp()});
      attemptPatch.status='payment_approved';attemptPatch.approvedAt=periodStartIso;transaction.set(attemptRef,attemptPatch,{merge:true});transaction.set(indexRef,{status:'payment_approved',providerStatus:details.providerStatus,statusDetail:details.statusDetail,providerPaymentId:details.paymentId,approvedAt:periodStartIso,updatedAt:now},{merge:true});transaction.create(markerRef,{id:markerRef.id,businessId:index.businessId,operationId:index.operationId,providerOrderId:orderId,providerPaymentId:details.paymentId,amount:details.amount,currency:'BRL',status:'approved',source,eventId:eventId||null,approvedAt:periodStartIso,createdAt:FieldValue.serverTimestamp()});
      return{businessId:index.businessId,status:'payment_approved',subscription,attempt:publicAttempt({...attempt,...attemptPatch})};
    });
  }
  function changeCouponReservation(transaction,redemptionRef,redemption,mode){
    const couponRef=db.doc(`adminCoupons/${redemption.couponId}`),businessCounter=db.doc(`couponUsageCounters/${counterId(redemption.couponId,`business:${redemption.businessId}`)}`),userCounter=db.doc(`couponUsageCounters/${counterId(redemption.couponId,`user:${redemption.userId}`)}`);
    if(mode==='confirm'){
      const discountGranted=Math.max(0,Number(redemption.originalPrice||0)-Number(redemption.discountedPrice||0));transaction.update(couponRef,{reservedCount:FieldValue.increment(-1),redemptionCount:FieldValue.increment(1),activeSubscriptions:FieldValue.increment(1),discountGrantedTotal:FieldValue.increment(discountGranted),updatedAt:FieldValue.serverTimestamp()});transaction.set(businessCounter,{reserved:FieldValue.increment(-1),confirmed:FieldValue.increment(1),updatedAt:FieldValue.serverTimestamp()},{merge:true});transaction.set(userCounter,{reserved:FieldValue.increment(-1),confirmed:FieldValue.increment(1),updatedAt:FieldValue.serverTimestamp()},{merge:true});transaction.update(redemptionRef,{status:'active',redeemedAt:FieldValue.serverTimestamp(),discountGranted,updatedAt:FieldValue.serverTimestamp()});return;
    }
    transaction.update(couponRef,{reservedCount:FieldValue.increment(-1),updatedAt:FieldValue.serverTimestamp()});transaction.set(businessCounter,{reserved:FieldValue.increment(-1),updatedAt:FieldValue.serverTimestamp()},{merge:true});transaction.set(userCounter,{reserved:FieldValue.increment(-1),updatedAt:FieldValue.serverTimestamp()},{merge:true});transaction.update(redemptionRef,{status:'failed',failureReason:'payment_terminal',canceledAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
  }
  return{resolveIndex,resolvePaymentOrder,applyOrder};
}

module.exports={TERMINAL_STATUSES,firstOrderPayment,firstPixPayment,orderState,absoluteExpiration,orderDetails,pixDetails,validateOrder,validatePixOrder,addBillingPeriod,pendingManualSubscription,pendingPixSubscription,publicAttempt,pixBillingService};
