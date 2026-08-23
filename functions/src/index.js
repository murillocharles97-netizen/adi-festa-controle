'use strict';

const crypto=require('node:crypto');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
const {onCall,onRequest,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {onDocumentCreated,onDocumentWritten}=require('firebase-functions/v2/firestore');
const {defineSecret,defineString}=require('firebase-functions/params');
const {logger}=require('firebase-functions');
const {mercadoPagoService}=require('./services/mercado-pago-service');
const {permissionService}=require('./services/permission-service');
const {requirePlan,getPlan,planBilling}=require('./services/plan-service');
const {pendingSubscription,sanitize,computeAccess}=require('./services/subscription-service');
const {firestoreSubscriptionService}=require('./services/firestore-subscription-service');
const {verifyWebhookSignature,eventId,eventData}=require('./services/webhook-service');
const {CouponError}=require('./services/coupon-service');
const {couponFirestoreService}=require('./services/coupon-firestore-service');
const {onboardingService}=require('./services/onboarding-service');
const {requirePaymentMethod,providerPaymentResult}=require('./services/billing-payment-method-service');

initializeApp();
const db=getFirestore(),REGION='southamerica-east1';
const MP_TOKEN=defineSecret('MERCADO_PAGO_ACCESS_TOKEN');
const MP_TEST_TOKEN=defineSecret('MERCADO_PAGO_ACCESS_TOKEN_TEST');
const MP_WEBHOOK_SECRET=defineSecret('MERCADO_PAGO_WEBHOOK_SECRET');
const MP_ENV=defineString('MERCADO_PAGO_ENV',{default:'production'});
const APP_URL=defineString('ADI_FESTA_APP_URL',{default:'https://murillocharles97-netizen.github.io/adi-festa-controle/'});
const FUNCTION_OPTIONS={region:REGION,memory:'256MiB',timeoutSeconds:30,maxInstances:20,secrets:[MP_TOKEN,MP_TEST_TOKEN]};
const CATALOG_OPTIONS={region:REGION,memory:'256MiB',timeoutSeconds:20,maxInstances:30};
const ONBOARDING_OPTIONS={region:REGION,memory:'256MiB',timeoutSeconds:20,maxInstances:20};
const validCatalogToken=value=>/^[A-Za-z0-9_-]{20,128}$/.test(String(value||''));
const normalizePhone=value=>{let digits=String(value||'').replace(/\D/g,'');digits=digits.replace(/^0+/,'');if(digits.length===10||digits.length===11)digits=`55${digits}`;return digits};
const validPhone=value=>/^55\d{10,11}$/.test(value);
const sha=value=>crypto.createHash('sha256').update(String(value||'')).digest('hex');
async function requireBusinessFeature(businessId,feature,featureKey){const snapshot=await db.doc(`businesses/${businessId}`).get(),business=snapshot.data()||{},access=computeAccess(business.subscription||{}),plan=getPlan(access.planId);if(!snapshot.exists||business.active===false||!access.canMutate||(!access.unlimited&&plan?.features?.[feature]!==true))throw new HttpsError('failed-precondition','Uma assinatura ativa é necessária para concluir esta ação.',{code:'subscription_feature_required',feature:featureKey,requiredPlan:'professional'});return{business,access}}
const maskPublicPhone=value=>{const phone=normalizePhone(value),tail=phone.slice(-5);return tail?`•••••-${tail}`:''};
const maskPublicName=value=>{const parts=String(value||'Cliente').trim().split(/\s+/);return parts.length>1?`${parts[0]} ${parts.at(-1).slice(0,1)}.`:parts[0]};
const INVALID_CRM_SALE_STATUSES=new Set(['cancelado','cancelada','cancelled','canceled','desfeito','desfeita','venda_desfeita','estornado','estornada','refunded']);
const effectiveSale=snapshot=>{
  if(!snapshot?.exists)return null;
  const sale=snapshot.data()||{},clientId=String(sale.clienteId||sale.clientId||sale.customerId||''),status=String(sale.status||sale.saleStatus||sale.tipo||'').trim().toLowerCase(),rawDate=sale.data||sale.createdAt||sale.criadoEm,date=typeof rawDate?.toDate==='function'?rawDate.toDate().toISOString():String(rawDate||'');
  if(sale.deletedAt||sale.active===false||sale.ativo===false||INVALID_CRM_SALE_STATUSES.has(status)||!clientId||!date)return null;
  return{clientId,value:Number(sale.valorFinal??sale.valorTotal??sale.total??sale.amount??0),items:(sale.itens||sale.items||[]).reduce((sum,item)=>sum+Number(item.quantidade??item.quantity??0),0),date};
};
async function enforcePublicRateLimit(request,catalogToken,action,limit){const ip=String(request.rawRequest?.ip||request.rawRequest?.headers?.['x-forwarded-for']||'unknown').split(',')[0].trim(),bucket=Math.floor(Date.now()/(15*60*1000)),ref=db.doc(`publicRateLimits/${sha(`${action}:${catalogToken}:${ip}:${bucket}`)}`);await db.runTransaction(async transaction=>{const snapshot=await transaction.get(ref),count=Number(snapshot.data()?.count||0);if(count>=limit)throw new HttpsError('resource-exhausted','Muitas tentativas. Aguarde alguns minutos.');transaction.set(ref,{action,catalogHash:sha(catalogToken).slice(0,16),count:count+1,expiresAt:Timestamp.fromMillis(Date.now()+30*60*1000),updatedAt:FieldValue.serverTimestamp()},{merge:true})})}
async function publicCatalog(request){const catalogToken=String(request.data?.catalogToken||'').trim();if(!validCatalogToken(catalogToken))throw new HttpsError('invalid-argument','Catálogo inválido.');const ref=db.doc(`publicCatalogs/${catalogToken}`),snapshot=await ref.get();if(!snapshot.exists)throw new HttpsError('not-found','Catálogo não encontrado.');const catalog=snapshot.data()||{};if(catalog.legacyRedirect&&validCatalogToken(catalog.universalCatalogToken)){const redirectRef=db.doc(`publicCatalogs/${catalog.universalCatalogToken}`),redirect=await redirectRef.get();if(!redirect.exists)throw new HttpsError('not-found','Catálogo não encontrado.');return{catalogToken:catalog.universalCatalogToken,ref:redirectRef,catalog:redirect.data()}}if(catalog.active!==true||catalog.catalogVisible===false)throw new HttpsError('failed-precondition','Catálogo indisponível.');return{catalogToken,ref,catalog}}
function withinCatalogHours(catalog,date=new Date()){if(catalog.acceptOutsideHours||catalog.scheduleMode!=='weekly')return true;const timezone=catalog.timezone||'America/Sao_Paulo',parts=new Intl.DateTimeFormat('en-US',{timeZone:timezone,weekday:'short',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(date),part=type=>parts.find(item=>item.type===type)?.value||'',day=part('weekday').toLowerCase(),entry=catalog.weeklyHours?.[day];if(!entry||entry.closed===true||!entry.open||!entry.close)return false;const current=`${part('hour')}:${part('minute')}`;return current>=entry.open&&current<=entry.close}

const token=()=>MP_ENV.value()==='test'?MP_TEST_TOKEN.value():MP_TOKEN.value();
const mp=()=>mercadoPagoService({accessToken:token()});
const permissions=()=>permissionService(db);
const providerStore=()=>firestoreSubscriptionService(db);
const coupons=()=>couponFirestoreService(db);
const iso=()=>new Date().toISOString();
const operationId=(raw,businessId,planId,uid)=>{
  const supplied=String(raw||'').trim();
  if(/^[a-zA-Z0-9_-]{16,100}$/.test(supplied))return supplied;
  const minute=Math.floor(Date.now()/60000);
  return crypto.createHash('sha256').update(`${businessId}:${planId}:${uid}:${minute}`).digest('hex');
};
const CHECKOUT_LEASE_MS=60000;
async function acquireCheckoutAttempt({businessId,operationId,requestHash,context,planId,billingCycle,paymentMethodType,quoteId}){
  const ref=db.doc(`businesses/${businessId}/billingCheckoutAttempts/${operationId}`),now=Date.now();
  const result=await db.runTransaction(async transaction=>{
    const snapshot=await transaction.get(ref),data=snapshot.data()||{};
    if(snapshot.exists&&data.requestHash!==requestHash)throw new HttpsError('failed-precondition','Esta tentativa de checkout não corresponde à solicitação atual.');
    if(snapshot.exists&&data.status==='completed'&&data.checkoutUrl)return{reused:true,checkoutUrl:String(data.checkoutUrl)};
    if(snapshot.exists&&data.status==='processing'&&data.leaseUntil?.toMillis?.()>now)throw new HttpsError('already-exists','O checkout já está sendo preparado. Aguarde alguns instantes.');
    transaction.set(ref,{businessId,requestedBy:context.uid,operationId,requestHash,planId,billingCycle,paymentMethodType,quoteId:quoteId||null,status:'processing',leaseUntil:Timestamp.fromMillis(now+CHECKOUT_LEASE_MS),attemptCount:FieldValue.increment(1),createdAt:data.createdAt||FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
    return{reused:false,ref};
  });
  return{...result,ref};
}
async function finishCheckoutAttempt(ref,patch){await ref.set({...patch,status:'completed',leaseUntil:FieldValue.delete(),completedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true})}
async function failCheckoutAttempt(ref,error){if(!ref)return;await ref.set({status:'failed',errorCode:String(error?.code||'unknown').slice(0,80),leaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()},{merge:true}).catch(()=>{})}
function callableError(error){
  if(error instanceof HttpsError)return error;
  if(error instanceof CouponError){const code=error.code==='permission_denied'?'permission-denied':error.code==='duplicate_code'?'already-exists':'failed-precondition';return new HttpsError(code,error.message,{couponCode:error.publicCode})}
  logger.error('[Subscriptions]',{code:error?.code||'unknown',status:error?.status||null,message:String(error?.message||error).slice(0,240)});
  if(error?.code==='invalid-plan')return new HttpsError('invalid-argument','Plano inválido.');
  if(error?.code==='invalid-billing-cycle')return new HttpsError('invalid-argument','Periodicidade inválida.');
  if(error?.code==='invalid-payment-method')return new HttpsError('invalid-argument','Forma de pagamento inválida.');
  if(error?.code==='mercado-pago-error')return new HttpsError('unavailable','O Mercado Pago não respondeu como esperado. Tente novamente em instantes.');
  return new HttpsError('internal','Não foi possível concluir a operação de assinatura.');
}
function requestedBusinessId(request){return String(request.data?.companyId||request.data?.businessId||'').trim()}

exports.completeBusinessOnboarding=onCall(ONBOARDING_OPTIONS,async request=>{
  const uid=request.auth?.uid,email=String(request.auth?.token?.email||'').trim().toLowerCase();
  if(!uid)throw new HttpsError('unauthenticated','Entre na sua conta para concluir o cadastro.');
  try{
    const result=await onboardingService(db,{Timestamp,FieldValue,professionalLimits:getPlan('professional').limits}).complete({uid,email,input:request.data||{}});
    logger.info('[Onboarding] completed',{uidHash:sha(uid).slice(0,12),businessId:result.businessId,created:result.created,trialPreserved:result.trial.preserved});
    return result;
  }catch(error){
    logger.warn('[Onboarding] failed',{uidHash:sha(uid).slice(0,12),code:error?.code||'unknown'});
    if(error instanceof HttpsError)throw error;
    throw new HttpsError('internal','Não foi possível concluir a empresa agora. Seus dados foram preservados.');
  }
});

async function internalCouponContext(request){const businessId=requestedBusinessId(request)||'adi-festa',context=await permissions().authenticatedContext(request,businessId);coupons().assertInternal(context);return context}

exports.validateCoupon=onCall(FUNCTION_OPTIONS,async request=>{
  try{const businessId=requestedBusinessId(request),context=await permissions().authenticatedContext(request,businessId),result=await coupons().validateAndQuote({context,code:request.data?.couponCode,planId:request.data?.planId,billingCycle:String(request.data?.billingCycle||'monthly')});logger.info('[Coupons] quote created',{businessId,planId:result.planId,billingCycle:result.billingCycle});return result}catch(error){throw callableError(error)}
});

exports.listAdminCoupons=onCall(FUNCTION_OPTIONS,async request=>{try{const context=await internalCouponContext(request);return await coupons().listCoupons({context,limit:request.data?.limit,cursor:request.data?.cursor})}catch(error){throw callableError(error)}});
exports.getAdminCoupon=onCall(FUNCTION_OPTIONS,async request=>{try{const context=await internalCouponContext(request);return await coupons().couponDetails({context,couponId:String(request.data?.couponId||'')})}catch(error){throw callableError(error)}});
exports.saveAdminCoupon=onCall(FUNCTION_OPTIONS,async request=>{try{const context=await internalCouponContext(request),coupon=await coupons().saveCoupon({context,input:request.data?.coupon||{},couponId:String(request.data?.couponId||'')||null});logger.info('[Coupons] saved',{couponId:coupon.id,actorUid:context.uid,version:coupon.version});return{coupon}}catch(error){throw callableError(error)}});
exports.actionAdminCoupon=onCall(FUNCTION_OPTIONS,async request=>{try{const context=await internalCouponContext(request),coupon=await coupons().actionCoupon({context,couponId:String(request.data?.couponId||''),action:String(request.data?.action||'')});logger.info('[Coupons] status changed',{couponId:coupon.id,action:request.data?.action});return{coupon}}catch(error){throw callableError(error)}});
exports.duplicateAdminCoupon=onCall(FUNCTION_OPTIONS,async request=>{try{const context=await internalCouponContext(request),coupon=await coupons().duplicateCoupon({context,couponId:String(request.data?.couponId||''),code:request.data?.code});return{coupon}}catch(error){throw callableError(error)}});

exports.createSubscription=onCall(FUNCTION_OPTIONS,async request=>{
  let attemptRef=null,redemption=null,providerPlan=null,checkoutPersisted=false;
  try{
    const businessId=requestedBusinessId(request),plan=requirePlan(request.data?.planId),billingCycle=String(request.data?.billingCycle||'monthly'),officialBilling=planBilling(plan,billingCycle),paymentMethod=requirePaymentMethod(request.data?.paymentMethodType),context=await permissions().authenticatedContext(request,businessId);
    if(request.data?.userId&&request.data.userId!==context.uid)throw new HttpsError('permission-denied','Usuário divergente.');
    if(!context.email)throw new HttpsError('failed-precondition','A conta precisa possuir um e-mail válido.');
    if(context.business.subscription?.planId==='internal')throw new HttpsError('failed-precondition','A conta interna não utiliza cobrança.');
    const quoteId=String(request.data?.quoteId||''),pendingProviderId=context.business.subscription?.mercadoPago?.subscriptionId||context.business.subscription?.mercadoPago?.providerPlanId;
    if(pendingProviderId&&context.business.subscription?.pendingPlanId===plan.id){
      const intent=await db.doc(`businesses/${businessId}/subscriptionIntents/${pendingProviderId}`).get(),intentData=intent.data()||{},sameCheckout=String(intentData.billingCycle||'monthly')===billingCycle&&String(intentData.quoteId||'')===quoteId&&String(intentData.paymentMethodType||'card')===paymentMethod.id,checkoutUrl=sameCheckout?intentData.checkoutUrl:null;
      if(checkoutUrl)return{checkoutUrl,paymentMethodType:paymentMethod.id,reused:true};
    }
    const opId=operationId(request.data?.operationId,businessId,plan.id,context.uid),requestHash=sha(JSON.stringify({businessId,uid:context.uid,planId:plan.id,billingCycle,quoteId,paymentMethodType:paymentMethod.id}));
    logger.info('[Billing] checkout_started',{businessId,planId:plan.id,billingCycle,operationIdHash:sha(opId).slice(0,12)});
    logger.info('[Billing] payment_method_selected',{businessId,paymentMethodType:paymentMethod.id,operationIdHash:sha(opId).slice(0,12)});
    const attempt=await acquireCheckoutAttempt({businessId,operationId:opId,requestHash,context,planId:plan.id,billingCycle,paymentMethodType:paymentMethod.id,quoteId});
    attemptRef=attempt.ref;
    if(attempt.reused)return{checkoutUrl:attempt.checkoutUrl,paymentMethodType:paymentMethod.id,reused:true};
    redemption=quoteId?await coupons().reserveQuote({quoteId,context,planId:plan.id,billingCycle}):null;
    if(redemption)logger.info('[Billing] coupon_applied',{businessId,planId:plan.id,couponId:redemption.couponId,redemptionId:redemption.id});
    const billing={...officialBilling,amount:redemption?Number(redemption.discountedPrice):officialBilling.amount},coupon=redemption?{couponId:redemption.couponId,redemptionId:redemption.id,quoteId}:null,backUrl=`${APP_URL.value()}#/planos`;
    let provider,providerPlanId=null;
    if(paymentMethod.id==='pix_monthly'){
      logger.info('[Billing] pix_authorization_started',{businessId,planId:plan.id,billingCycle,operationIdHash:sha(opId).slice(0,12)});
      providerPlan=await mp().createSubscriptionPlan({businessId,plan,billing,backUrl,operationId:`${opId}-plan`});
      if(!providerPlan?.id||!providerPlan?.init_point)throw new HttpsError('unavailable','O checkout via Pix não foi criado pelo Mercado Pago.');
      providerPlanId=String(providerPlan.id);
      provider={id:providerPlanId,status:'pending',init_point:providerPlan.init_point,payer_id:null};
      await attemptRef.set({providerPlanId,checkoutUrl:String(providerPlan.init_point),stage:'provider_plan_created',updatedAt:FieldValue.serverTimestamp()},{merge:true});
    }else{
      provider=await mp().createSubscription({businessId,userId:context.uid,email:context.email,plan,billing,backUrl,operationId:opId,coupon,paymentMethodType:paymentMethod.id});
    }
    if(!provider?.id||!provider?.init_point)throw new HttpsError('unavailable','O checkout não foi criado pelo Mercado Pago.');
    const expectedExternalReference=providerPlanId?`${businessId}:${opId}-plan`:businessId,now=iso(),subscription=pendingSubscription({existing:context.business.subscription||{},plan,provider,now,billingCycle,discount:redemption?.discountSnapshot||null,paymentMethodType:paymentMethod.id,providerPlanId}),batch=db.batch(),intentRef=db.doc(`businesses/${businessId}/subscriptionIntents/${provider.id}`),baseIndex={businessId,ownerId:context.uid,planId:plan.id,billingCycle,paymentMethodType:paymentMethod.id,officialPrice:officialBilling.amount,chargedPrice:billing.amount,expectedExternalReference,quoteId:quoteId||null,couponRedemptionId:redemption?.id||null,discountSnapshot:redemption?.discountSnapshot||null,internalSubscriptionId:opId,status:'pending',createdAt:now,updatedAt:now};
    batch.update(context.businessRef,{subscription,updatedAt:FieldValue.serverTimestamp()});
    batch.set(intentRef,{...baseIndex,requestedBy:context.uid,operationId:opId,providerStatus:String(provider.status||'pending'),subscriptionId:providerPlanId?null:String(provider.id),providerPlanId,customerId:provider.payer_id==null?null:String(provider.payer_id),checkoutUrl:String(provider.init_point)});
    if(providerPlanId)batch.set(db.doc(`subscriptionPlanIndex/${providerPlanId}`),{...baseIndex,providerPlanId,checkoutUrl:String(provider.init_point)});
    else batch.set(db.doc(`subscriptionIndex/${provider.id}`),{...baseIndex,subscriptionId:String(provider.id)});
    await batch.commit();
    checkoutPersisted=true;
    if(redemption)await coupons().markCheckout({redemptionId:redemption.id,subscriptionId:providerPlanId?null:String(provider.id),internalSubscriptionId:opId,providerPlanId});
    await finishCheckoutAttempt(attemptRef,{checkoutUrl:String(provider.init_point),providerPlanId,subscriptionId:providerPlanId?null:String(provider.id),paymentMethodType:paymentMethod.id});
    logger.info('[Subscriptions] checkout created',{businessId,planId:plan.id,billingCycle,paymentMethodType:paymentMethod.id,coupon:Boolean(redemption),environment:MP_ENV.value()});
    logger.info('[Billing] subscription_created',{businessId,planId:plan.id,paymentMethodType:paymentMethod.id,providerPlanId:providerPlanId||null,subscriptionId:providerPlanId?null:String(provider.id)});
    return{checkoutUrl:String(provider.init_point),paymentMethodType:paymentMethod.id,reused:false};
  }catch(error){
    logger.error('[Billing] billing_error',{stage:'create_subscription',code:error?.code||'unknown',status:error?.status||null});
    if(!checkoutPersisted&&redemption&&!redemption.idempotent)await coupons().releaseReservation(redemption.id,'provider_checkout_failed').catch(()=>{});
    if(!checkoutPersisted&&providerPlan?.id)await mp().cancelSubscriptionPlan(providerPlan.id).catch(cancelError=>logger.warn('[Subscriptions] provider plan cleanup failed',{providerPlanId:String(providerPlan.id),code:cancelError?.code||'unknown'}));
    await failCheckoutAttempt(attemptRef,error);
    throw callableError(error);
  }
});

exports.cancelSubscription=onCall(FUNCTION_OPTIONS,async request=>{
  try{
    const businessId=requestedBusinessId(request),context=await permissions().authenticatedContext(request,businessId),subscriptionId=context.business.subscription?.mercadoPago?.subscriptionId;
    if(!subscriptionId)throw new HttpsError('failed-precondition','Esta empresa não possui assinatura recorrente.');
    const provider=await mp().cancelSubscription(subscriptionId),result=await providerStore().applyProviderSubscription(provider,{source:'cancel_callable'});
    logger.info('[Subscriptions] cancellation requested',{businessId,status:result.subscription.status});return{status:result.subscription.status};
  }catch(error){throw callableError(error)}
});

exports.syncSubscription=onCall(FUNCTION_OPTIONS,async request=>{
  try{
    const businessId=requestedBusinessId(request),reconcileProvider=request.data?.reconcileProvider===true,context=await permissions().authenticatedContext(request,businessId,{ownerOnly:reconcileProvider});
    if(!reconcileProvider)return{subscription:sanitize(context.business.subscription||{}),source:'firestore'};
    const subscriptionId=context.business.subscription?.mercadoPago?.subscriptionId;if(!subscriptionId)throw new HttpsError('failed-precondition','Assinatura do Mercado Pago não encontrada.');
    const lastSync=new Date(context.business.subscription?.mercadoPago?.lastManualSyncAt||0).getTime();if(lastSync&&Date.now()-lastSync<15*60*1000)throw new HttpsError('resource-exhausted','A reconciliação manual pode ser feita a cada 15 minutos.');
    const provider=await mp().getSubscription(subscriptionId),result=await providerStore().applyProviderSubscription(provider,{source:'manual_reconciliation'}),now=iso();await context.businessRef.update({'subscription.mercadoPago.lastManualSyncAt':now,updatedAt:FieldValue.serverTimestamp()});
    logger.info('[Subscriptions] manual reconciliation',{businessId,status:result.subscription.status});return{subscription:sanitize(result.subscription),source:'mercado_pago'};
  }catch(error){throw callableError(error)}
});

exports.receiveWebhook=onRequest({region:REGION,memory:'256MiB',timeoutSeconds:30,maxInstances:30,secrets:[MP_TOKEN,MP_TEST_TOKEN,MP_WEBHOOK_SECRET]},async(req,res)=>{
  if(req.method!=='POST'){res.status(405).send('method-not-allowed');return}
  const event=eventData(req);
  if(!verifyWebhookSignature({secret:MP_WEBHOOK_SECRET.value(),xSignature:event.xSignature,xRequestId:event.requestId,dataId:event.dataId})){logger.warn('[Webhook] invalid signature',{type:event.type,hasDataId:Boolean(event.dataId)});res.status(401).send('invalid-signature');return}
  const id=eventId(event),eventRef=db.doc(`webhookEvents/${id}`);
  const acquired=await db.runTransaction(async transaction=>{
    const existing=await transaction.get(eventRef),data=existing.data()||{};
    if(data.status==='processed'||data.status==='ignored')return false;
    if(data.status==='processing'&&data.leaseUntil?.toMillis?.()>Date.now())return false;
    transaction.set(eventRef,{id,type:event.type,action:event.action,dataId:event.dataId,status:'processing',receivedAt:data.receivedAt||FieldValue.serverTimestamp(),leaseUntil:Timestamp.fromMillis(Date.now()+60000),updatedAt:FieldValue.serverTimestamp()},{merge:true});
    return true;
  });
  if(!acquired){res.status(200).send('already-processing-or-processed');return}
  try{
    if(event.type==='subscription_preapproval_plan'){await eventRef.update({status:'ignored',reason:'provider-plan-event',updatedAt:FieldValue.serverTimestamp()});res.status(200).send('ignored');return}
    let subscriptionId=event.dataId,paymentResult=null;
    if(event.type==='subscription_authorized_payment'){const payment=await mp().getAuthorizedPayment(event.dataId);subscriptionId=String(payment.preapproval_id||payment.subscription_id||'');paymentResult=providerPaymentResult(event.type,payment)}
    if(event.type==='payment'){const payment=await mp().getPayment(event.dataId);subscriptionId=String(payment.metadata?.preapproval_id||payment.subscription_id||'');paymentResult=providerPaymentResult(event.type,payment)}
    if(!subscriptionId){await eventRef.update({status:'ignored',reason:'subscription-id-missing',updatedAt:FieldValue.serverTimestamp()});res.status(200).send('ignored');return}
    const provider=await mp().getSubscription(subscriptionId),store=providerStore(),result=await store.applyProviderSubscription(provider,{source:'webhook',eventId:id});
    if(paymentResult){
      await store.recordPaymentEvent(subscriptionId,id,paymentResult);
      if(paymentResult.successful){logger.info('[Billing] payment_approved',{businessId:result.businessId,subscriptionId,paymentId:paymentResult.paymentId||null});const cycle=await store.recordDiscountPayment(subscriptionId,id);if(cycle.restoreAmount){await mp().updateSubscriptionAmount(subscriptionId,cycle.restoreAmount);await store.completeDiscountRestoration(subscriptionId,id)}}
    }
    if(result.subscription.status==='active')logger.info('[Billing] subscription_activated',{businessId:result.businessId,subscriptionId,paymentMethodType:result.subscription.paymentMethodType||'card'});
    if(['cancelled','canceled','expired'].includes(result.subscription.status))logger.info('[Billing] checkout_cancelled',{businessId:result.businessId,subscriptionId,status:result.subscription.status});
    await eventRef.update({status:'processed',businessId:result.businessId,subscriptionStatus:result.subscription.status,paymentStatus:paymentResult?.status||null,paymentSuccessful:paymentResult?.successful??null,processedAt:FieldValue.serverTimestamp(),leaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()});
    logger.info('[Webhook] processed',{type:event.type,businessId:result.businessId,status:result.subscription.status});res.status(200).send('ok');
  }catch(error){logger.error('[Webhook] failed',{eventId:id,type:event.type,code:error?.code||'unknown',message:String(error?.message||error).slice(0,240)});logger.error('[Billing] billing_error',{stage:'webhook',eventId:id,type:event.type,code:error?.code||'unknown'});await eventRef.set({status:'failed',errorCode:error?.code||'unknown',updatedAt:FieldValue.serverTimestamp()},{merge:true});res.status(500).send('retry')}
});

exports.expireSubscriptionsDaily=onSchedule({region:REGION,schedule:'15 3 * * *',timeZone:'America/Sao_Paulo',memory:'256MiB',timeoutSeconds:300,maxInstances:1},async()=>{
  const now=Timestamp.now(),queries=[db.collection('businesses').where('subscription.status','==','trial').where('subscription.trialEndsAt','<=',now).limit(450),db.collection('businesses').where('subscription.status','in',['active','grace_period']).where('subscription.expiresAt','<=',now.toDate().toISOString()).limit(450)];
  let changed=0;for(const query of queries){const snapshot=await query.get();if(snapshot.empty)continue;const batch=db.batch();snapshot.docs.forEach(doc=>{batch.update(doc.ref,{'subscription.status':'expired','subscription.expiredAt':now,updatedAt:now});changed++});await batch.commit()}
  let discountsRestored=0;const discounts=await db.collection('businesses').where('subscription.discount.restoreDueAt','<=',now.toDate().toISOString()).limit(100).get();for(const business of discounts.docs){const subscription=business.data().subscription||{},subscriptionId=subscription.mercadoPago?.subscriptionId,discount=subscription.discount||{};if(subscription.status!=='active'||discount.durationType!=='until_date'||!subscriptionId)continue;try{await mp().updateSubscriptionAmount(subscriptionId,Number(discount.originalPrice));await providerStore().completeDiscountRestoration(subscriptionId,`coupon-expiry:${business.id}:${discount.endsAt}`);discountsRestored++}catch(error){logger.error('[Subscriptions] coupon restoration failed',{businessId:business.id,code:error?.code||'unknown'})}}
  logger.info('[Subscriptions] daily expiration completed',{changed,discountsRestored});
});

exports.initializeBusinessTrial=onDocumentCreated({document:'businesses/{businessId}',region:REGION},async event=>{
  const snapshot=event.data;if(!snapshot)return;const business=snapshot.data();if(business.subscription)return;
  const now=Timestamp.now(),trialEndsAt=Timestamp.fromMillis(now.toMillis()+7*24*60*60*1000);await snapshot.ref.update({subscription:{status:'trialing',subscriptionStatus:'trialing',planId:'trial',trialStartedAt:now,trialEndsAt,startedAt:now,expiresAt:trialEndsAt,nextBillingDate:null,lastPaymentDate:null,mercadoPago:{subscriptionId:null,customerId:null,preapprovalId:null,lastWebhook:null}},updatedAt:now});
  logger.info('[Subscriptions] trial initialized',{businessId:event.params.businessId});
});

// Um evento de venda atualiza apenas o cliente e o mês afetados. O marcador do
// eventId torna reentregas do Firestore idempotentes e evita contagem duplicada.
exports.aggregateCustomerSaleMetrics=onDocumentWritten({document:'businesses/{businessId}/sales/{saleId}',region:REGION,memory:'256MiB',timeoutSeconds:20,maxInstances:20},async event=>{
  const before=effectiveSale(event.data?.before),after=effectiveSale(event.data?.after),businessId=event.params.businessId,eventId=event.id;
  if(!before&&!after)return;
  const targets=new Map();for(const [sale,sign] of [[before,-1],[after,1]])if(sale){const month=sale.date.slice(0,7),key=`${sale.clientId}:${month}`,row=targets.get(key)||{clientId:sale.clientId,month,spent:0,purchases:0,items:0,lastPurchaseAt:null};row.spent+=sign*sale.value;row.purchases+=sign;row.items+=sign*sale.items;if(sign>0)row.lastPurchaseAt=sale.date;targets.set(key,row)}
  await db.runTransaction(async transaction=>{
    const marker=db.doc(`businesses/${businessId}/metricEvents/${eventId}`),seen=await transaction.get(marker);if(seen.exists)return;
    for(const row of targets.values()){
      const metric=db.doc(`businesses/${businessId}/customerMetrics/${row.clientId}`),monthly=db.doc(`businesses/${businessId}/customerMonthlyMetrics/${row.clientId}__${row.month}`),metricData={id:row.clientId,businessId,totalSpent:FieldValue.increment(row.spent),purchaseCount:FieldValue.increment(row.purchases),updatedAt:FieldValue.serverTimestamp(),schemaVersion:2},monthlyData={id:`${row.clientId}__${row.month}`,businessId,clientId:row.clientId,month:row.month,spent:FieldValue.increment(row.spent),purchaseCount:FieldValue.increment(row.purchases),itemsCount:FieldValue.increment(row.items),updatedAt:FieldValue.serverTimestamp(),schemaVersion:2};
      if(row.lastPurchaseAt){metricData.lastPurchaseAt=row.lastPurchaseAt;metricData.lastPurchaseAtNeedsRebuild=false;monthlyData.lastPurchaseAt=row.lastPurchaseAt;monthlyData.lastPurchaseAtNeedsRebuild=false}else if(row.purchases<0){metricData.lastPurchaseAtNeedsRebuild=true;monthlyData.lastPurchaseAtNeedsRebuild=true}
      transaction.set(metric,metricData,{merge:true});transaction.set(monthly,monthlyData,{merge:true});
    }
    transaction.create(marker,{businessId,eventId,type:'sale_metrics_v2',createdAt:FieldValue.serverTimestamp()});
  });
});

exports.identifyCatalogCustomer=onCall(CATALOG_OPTIONS,async request=>{
  const started=Date.now();
  try{
    const context=await publicCatalog(request),phone=normalizePhone(request.data?.phone);
    if(!validPhone(phone))throw new HttpsError('invalid-argument','Informe um telefone com DDD.');
    await enforcePublicRateLimit(request,context.catalogToken,'identify',12);
    const clients=await db.collection(`businesses/${context.catalog.businessId}/clients`).where('normalizedPhone','==',phone).limit(2).get();
    if(clients.size!==1){await new Promise(resolve=>setTimeout(resolve,Math.max(0,350-(Date.now()-started))));return{found:false,conflict:clients.size>1}}
    const clientDoc=clients.docs[0],client=clientDoc.data();if(client.active===false||client.ativo===false)return{found:false};
    let clientRefToken=String(client.portalRefToken||'');if(!/^[A-Za-z0-9_-]{20,128}$/.test(clientRefToken)){clientRefToken=crypto.randomBytes(24).toString('hex');await clientDoc.ref.set({portalRefToken:clientRefToken,updatedAt:FieldValue.serverTimestamp()},{merge:true})}
    const sessionToken=crypto.randomBytes(32).toString('hex'),sessionHash=sha(sessionToken),expiresAt=new Date(Date.now()+30*864e5).toISOString(),profileRef=context.ref.collection('portalProfiles').doc(clientRefToken),profileSnapshot=await profileRef.get(),existing=profileSnapshot.data()||{},firstName=String(existing.displayName||client.name||client.nome||'Cliente').trim().split(/\s+/)[0],profile={displayName:firstName,maskedPhone:maskPublicPhone(phone),campaigns:Array.isArray(existing.campaigns)?existing.campaigns:[],orders:Array.isArray(existing.orders)?existing.orders:[],active:true};
    await context.ref.collection('portalSessions').doc(sessionHash).set({clientRefToken,businessId:context.catalog.businessId,visitId:context.catalog.visitId||'catalog-universal',active:true,permissions:['view_campaign_progress','view_rewards','view_public_orders'],createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),lastAccessAt:FieldValue.serverTimestamp(),expiresAt});
    await new Promise(resolve=>setTimeout(resolve,Math.max(0,350-(Date.now()-started))));
    return{found:true,maskedName:maskPublicName(profile.displayName),maskedPhone:profile.maskedPhone,clientRefToken,sessionToken,sessionHash,expiresAt,profile};
  }catch(error){if(error instanceof HttpsError)throw error;logger.error('[Catalog identify]',{code:error?.code||'unknown'});throw new HttpsError('unavailable','Não foi possível identificar o cliente agora.')}
});

exports.submitCatalogOrder=onCall(CATALOG_OPTIONS,async request=>{
  try{
    const context=await publicCatalog(request),data=request.data||{};
    await requireBusinessFeature(context.catalog.businessId,'onlineOrders','orders.receive');
    await enforcePublicRateLimit(request,context.catalogToken,'order',24);
    const canReceive=(context.catalog.acceptingOrders===true&&withinCatalogHours(context.catalog))||context.catalog.closedBehavior==='accept_for_later';if(!canReceive)throw new HttpsError('failed-precondition','Este catálogo não está recebendo pedidos.');
    const orderId=String(data.id||'');if(!/^[A-Za-z0-9_-]{16,100}$/.test(orderId))throw new HttpsError('invalid-argument','Identificador de pedido inválido.');
    const customerName=String(data.customerName||'').trim(),customerPhone=normalizePhone(data.customerPhone),customerLocation=String(data.customerLocation||'').trim().slice(0,160),note=String(data.note||'').trim().slice(0,1000);if(customerName.length<2||customerName.length>120||!validPhone(customerPhone))throw new HttpsError('invalid-argument','Dados do cliente inválidos.');
    const requested=Array.isArray(data.items)?data.items:[];if(!requested.length||requested.length>40)throw new HttpsError('invalid-argument','Itens inválidos.');
    const catalogItems=new Map((context.catalog.items||[]).map(item=>[String(item.id),item])),items=[];
    for(const raw of requested){
      const requestedId=String(raw.catalogItemId||''),separator=requestedId.lastIndexOf('::'),parentId=separator>0?requestedId.slice(0,separator):requestedId,requestedVariantId=separator>0?requestedId.slice(separator+2):String(raw.variantId||''),parent=catalogItems.get(parentId),variant=requestedVariantId?(parent?.variants||[]).find(entry=>String(entry.id||entry.variantId)===requestedVariantId):null,item=variant?{...parent,...variant,id:requestedId,variantId:requestedVariantId,productName:`${parent.productName} — ${variant.displayName}`,productImage:variant.imageUrl||parent.productImage}:parent,quantity=Number(raw.quantity);
      if(!item||item.active===false||item.catalogVisible===false||!Number.isInteger(quantity)||quantity<1||quantity>999)throw new HttpsError('invalid-argument','Um produto do pedido não está disponível.');
      if(parent?.productType==='variable'&&!variant)throw new HttpsError('invalid-argument','Selecione uma variação válida.');
      const stock=Number(item.availableQuantity??0)-Number(item.reservedStock??0),tracks=item.controlaEstoque!==false;
      if(tracks&&!item.allowNegativeStock&&context.catalog.stockBehavior!=='allow_negative'&&context.catalog.stockBehavior!=='preorder'&&quantity>Math.max(0,stock))throw new HttpsError('failed-precondition',`${item.productName} não possui estoque suficiente.`);
      const unitPrice=Number(Number(item.salePrice||0).toFixed(2)),subtotal=Number((unitPrice*quantity).toFixed(2));if(!(unitPrice>0))throw new HttpsError('failed-precondition','Produto sem preço válido.');
      items.push({productId:String(item.productId||''),variantId:variant?requestedVariantId:null,catalogItemId:requestedId,name:String(item.productName||'Produto').slice(0,160),productNameSnapshot:String(parent?.productName||item.productName||'Produto').slice(0,160),variantNameSnapshot:variant?.displayName||null,attributesSnapshot:variant?.attributeValues||null,sku:variant?.sku||'',barcode:variant?.barcode||'',image:String(item.productImage||''),quantity,unitPrice,subtotal})
    }
    const total=Number(items.reduce((sum,item)=>sum+item.subtotal,0).toFixed(2));if(!(total>0&&total<=10000))throw new HttpsError('invalid-argument','Total do pedido inválido.');
    const paymentPreference=String(data.paymentPreference||'entrega');if(!['entrega','pix','dinheiro','cartao','fiado'].includes(paymentPreference)||(paymentPreference==='fiado'&&!context.catalog.allowCredit))throw new HttpsError('invalid-argument','Forma de pagamento inválida.');
    let clientRefToken=null,portalSessionHash=null;const rawSession=String(data.customerSessionToken||'');if(rawSession){portalSessionHash=sha(rawSession);const session=await context.ref.collection('portalSessions').doc(portalSessionHash).get(),sessionData=session.data()||{};if(session.exists&&sessionData.active===true&&sessionData.businessId===context.catalog.businessId&&new Date(sessionData.expiresAt)>new Date())clientRefToken=sessionData.clientRefToken}
    const orderRef=context.ref.collection('orders').doc(orderId),existing=await orderRef.get();if(existing.exists){const prior=existing.data();if(prior.operationId===`catalog-order:${orderId}`)return{order:{...prior,createdAt:prior.createdAt?.toDate?.().toISOString?.()||prior.createdAt,updatedAt:prior.updatedAt?.toDate?.().toISOString?.()||prior.updatedAt},idempotent:true};throw new HttpsError('already-exists','Este pedido já existe.');}
    const createdAt=new Date().toISOString(),publicOrderNumber=`AF${Date.now().toString().slice(-6)}`,order={id:orderId,businessId:context.catalog.businessId,catalogToken:context.catalogToken,source:'online_catalog',orderStatus:'recebido',customerName,customerPhone,customerLocation,items,subtotal:total,discount:0,fee:0,total,paymentPreference,orderAccessToken:String(data.orderAccessToken||crypto.randomBytes(24).toString('hex')).slice(0,128),operationId:`catalog-order:${orderId}`,publicOrderNumber,visitId:context.catalog.visitId||'catalog-universal',clientRefToken,portalSessionHash,paymentStatus:'pendente',note,createdAt,updatedAt:createdAt};
    await orderRef.create(order);logger.info('[Catalog order]',{businessId:context.catalog.businessId,orderId,itemCount:items.length,total});return{order};
  }catch(error){if(error instanceof HttpsError)throw error;logger.error('[Catalog order]',{code:error?.code||'unknown'});throw new HttpsError('unavailable','Não foi possível registrar o pedido agora.')}
});
