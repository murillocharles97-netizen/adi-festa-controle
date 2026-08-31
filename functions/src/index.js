'use strict';

const crypto=require('node:crypto');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
const {onCall,onRequest,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {onDocumentCreated,onDocumentWritten}=require('firebase-functions/v2/firestore');
const {defineSecret,defineString}=require('firebase-functions/params');
const {logger}=require('firebase-functions');
const {mercadoPagoService,billingExternalReference,pixExternalReference,providerErrorDiagnostics}=require('./services/mercado-pago-service');
const {normalizeBillingPayerEmail,providerIndicatesPayerEmailMismatch}=require('./services/billing-payer-service');
const {permissionService}=require('./services/permission-service');
const {requirePlan,getPlan,planBilling}=require('./services/plan-service');
const {pendingSubscription,sanitize,computeAccess}=require('./services/subscription-service');
const {firestoreSubscriptionService}=require('./services/firestore-subscription-service');
const {verifyWebhookSignature,eventId,eventData}=require('./services/webhook-service');
const {CouponError}=require('./services/coupon-service');
const {couponFirestoreService}=require('./services/coupon-firestore-service');
const {onboardingService}=require('./services/onboarding-service');
const {requirePaymentMethod,providerPaymentResult}=require('./services/billing-payment-method-service');
const {pixBillingService,pixDetails,pendingPixSubscription,publicAttempt}=require('./services/pix-billing-service');
const {publicCardPaymentDiagnostic}=require('./services/card-payment-diagnostic-service');
const {attemptStatePatch,isTerminalAttempt}=require('./services/billing-attempt-state-service');

initializeApp();
const db=getFirestore(),REGION='southamerica-east1';
const MP_TOKEN=defineSecret('MERCADO_PAGO_ACCESS_TOKEN');
const MP_TEST_TOKEN=defineSecret('MERCADO_PAGO_ACCESS_TOKEN_TEST');
const MP_WEBHOOK_SECRET=defineSecret('MERCADO_PAGO_WEBHOOK_SECRET');
const MP_ENV=defineString('MERCADO_PAGO_ENV',{default:'production'});
const APP_URL=defineString('ADI_FESTA_APP_URL',{default:'https://murillocharles97-netizen.github.io/adi-festa-controle/'});
const MP_WEBHOOK_URL=defineString('MERCADO_PAGO_WEBHOOK_URL',{default:'https://southamerica-east1-adi-festa-controle.cloudfunctions.net/receiveWebhook?source_news=webhooks'});
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
const pixBilling=()=>pixBillingService(db);
const iso=()=>new Date().toISOString();
async function latestCardPaymentDiagnostic(subscriptionId){
  const search=await mp().searchAuthorizedPayments(subscriptionId,{limit:10}),rows=Array.isArray(search?.results)?search.results:[];
  if(!rows.length)return null;
  const authorized=[...rows].sort((a,b)=>new Date(b.last_modified||b.date_created||0)-new Date(a.last_modified||a.date_created||0))[0],paymentId=String(authorized?.payment?.id||'').trim();
  const payment=paymentId?await mp().getPayment(paymentId):{};
  return publicCardPaymentDiagnostic(payment,authorized);
}
function terminalCardCheckoutDiagnostic(provider){
  const status=String(provider?.status||'').trim().toLowerCase();
  if(!['cancelled','canceled','expired'].includes(status))return null;
  return{paymentId:null,authorizedPaymentId:null,status:'not_created',statusDetail:null,paymentMethodId:null,paymentTypeId:null,issuerId:null,transactionAmount:Number(provider?.auto_recurring?.transaction_amount)||null,dateCreated:provider?.date_created||null,dateLastUpdated:provider?.last_modified||null,rejected:true,message:'O checkout foi encerrado antes da aprovação. Tente outro cartão ou pague por Pix.'};
}
async function reconcileCardBillingAttempt({subscriptionId,source='provider_reconciliation',expectedBusinessId=null,cancelIfAbandoned=false}){
  const store=providerStore(),index=await store.resolveIndex(subscriptionId);
  if(!index?.businessId)throw Object.assign(Error('Assinatura sem índice interno.'),{code:'subscription-index-not-found'});
  if(expectedBusinessId&&index.businessId!==expectedBusinessId)throw Object.assign(Error('Empresa divergente na reconciliação.'),{code:'subscription-business-mismatch'});
  let provider;
  try{provider=await mp().getSubscription(subscriptionId)}catch(error){
    if(error?.status!==404)throw error;
    const now=iso(),attemptId=String(index.internalSubscriptionId||''),patch=attemptStatePatch({currentStatus:index.status,providerStatus:'not_found',paymentStatus:null,statusDetail:null,now,source});patch.status='provider_not_found';patch.closedAt=now;patch.closeReason='provider_not_found';
    const batch=db.batch();batch.set(db.doc(`subscriptionIndex/${subscriptionId}`),patch,{merge:true});batch.set(db.doc(`businesses/${index.businessId}/subscriptionIntents/${subscriptionId}`),patch,{merge:true});if(/^[a-zA-Z0-9_-]{16,100}$/.test(attemptId))batch.set(db.doc(`businesses/${index.businessId}/billingCheckoutAttempts/${attemptId}`),patch,{merge:true});await batch.commit();
    logger.warn('[BILLING_ATTEMPT_CLOSED]',{businessId:index.businessId,subscriptionId,attemptId,reason:'provider_not_found',source});return{index,provider:null,payment:null,attempt:patch,providerNotFound:true};
  }
  let payment=null;try{payment=await latestCardPaymentDiagnostic(subscriptionId)}catch(error){logger.warn('[BILLING_PROVIDER_STATUS]',{businessId:index.businessId,subscriptionId,source,status:String(provider?.status||''),diagnosticUnavailable:true,code:error?.code||'unknown'})}
  payment=payment||terminalCardCheckoutDiagnostic(provider);
  const providerStatus=String(provider?.status||'').toLowerCase();
  if(cancelIfAbandoned&&providerStatus==='pending'&&!payment){provider=await mp().cancelSubscription(subscriptionId);}
  const result=await store.applyProviderSubscription(provider,{source}),now=iso(),attemptId=String(index.internalSubscriptionId||''),attemptRef=/^[a-zA-Z0-9_-]{16,100}$/.test(attemptId)?db.doc(`businesses/${index.businessId}/billingCheckoutAttempts/${attemptId}`):null,attemptSnapshot=attemptRef?await attemptRef.get():null,currentStatus=attemptSnapshot?.data()?.status||index.status,patch=attemptStatePatch({currentStatus,providerStatus:String(provider?.status||''),paymentStatus:payment?.status,statusDetail:payment?.statusDetail,now,source});
  if(cancelIfAbandoned&&patch.status==='cancelled'){patch.status='abandoned';patch.closeReason='checkout_abandoned_after_24h';}
  if(payment?.paymentId)await store.recordPaymentEvent(subscriptionId,`reconcile_${payment.paymentId}`,{...payment,successful:payment.status==='approved'});
  const shared={...patch,lastPaymentProviderId:payment?.paymentId||null,lastAuthorizedPaymentId:payment?.authorizedPaymentId||null},batch=db.batch();batch.set(db.doc(`subscriptionIndex/${subscriptionId}`),shared,{merge:true});batch.set(db.doc(`businesses/${index.businessId}/subscriptionIntents/${subscriptionId}`),shared,{merge:true});if(attemptRef)batch.set(attemptRef,shared,{merge:true});await batch.commit();
  logger.info('[BILLING_PROVIDER_STATUS]',{businessId:index.businessId,subscriptionId,attemptId,source,status:String(provider?.status||''),paymentStatus:payment?.status||null,statusDetail:payment?.statusDetail||null});
  logger.info('[BILLING_ATTEMPT_RECONCILED]',{businessId:index.businessId,subscriptionId,attemptId,source,status:patch.status});
  if(payment?.rejected)logger.warn('[BILLING_PAYMENT_REJECTED]',{businessId:index.businessId,subscriptionId,attemptId,paymentId:payment.paymentId||null,statusDetail:payment.statusDetail||null});
  if(result.couponReleased)logger.info('[BILLING_COUPON_RELEASED]',{businessId:index.businessId,subscriptionId,attemptId,redemptionId:result.redemptionId||null,reason:patch.closeReason||patch.status});
  if(isTerminalAttempt(patch.status))logger.info('[BILLING_ATTEMPT_CLOSED]',{businessId:index.businessId,subscriptionId,attemptId,status:patch.status,reason:patch.closeReason||null,source});
  if(patch.status==='approved')logger.info('[BILLING_ENTITLEMENT_ACTIVATED]',{businessId:index.businessId,subscriptionId,attemptId,planId:index.planId||null,source});
  return{index,provider,payment,attempt:patch,result};
}
const operationId=(raw,businessId,planId,uid)=>{
  const supplied=String(raw||'').trim();
  if(/^[a-zA-Z0-9_-]{16,100}$/.test(supplied))return supplied;
  const minute=Math.floor(Date.now()/60000);
  return crypto.createHash('sha256').update(`${businessId}:${planId}:${uid}:${minute}`).digest('hex');
};
const CHECKOUT_LEASE_MS=60000;
async function acquireCheckoutAttempt({businessId,operationId,requestHash,context,planId,billingCycle,paymentMethodType,quoteId,billingPayerEmail=null}){
  const ref=db.doc(`businesses/${businessId}/billingCheckoutAttempts/${operationId}`),now=Date.now();
  const result=await db.runTransaction(async transaction=>{
    const snapshot=await transaction.get(ref),data=snapshot.data()||{};
    if(snapshot.exists&&data.requestHash!==requestHash)throw new HttpsError('failed-precondition','Esta tentativa de checkout não corresponde à solicitação atual.');
    if(snapshot.exists&&data.status==='pending_payment'&&data.checkoutUrl)return{reused:true,checkoutUrl:String(data.checkoutUrl)};
    if(snapshot.exists&&data.paymentMethodType==='pix_monthly'&&['payment_pending','payment_approved','expired','canceled','failed'].includes(data.status))return{reused:true,pix:publicAttempt(data)};
    if(snapshot.exists&&data.status==='processing'&&data.leaseUntil?.toMillis?.()>now)throw new HttpsError('already-exists','O checkout já está sendo preparado. Aguarde alguns instantes.');
    transaction.set(ref,{businessId,requestedBy:context.uid,operationId,requestHash,planId,billingCycle,paymentMethodType,quoteId:quoteId||null,billingPayerEmail:billingPayerEmail||null,status:'processing',leaseUntil:Timestamp.fromMillis(now+CHECKOUT_LEASE_MS),attemptCount:FieldValue.increment(1),createdAt:data.createdAt||FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
    return{reused:false,ref};
  });
  return{...result,ref};
}
async function finishCheckoutAttempt(ref,patch){await ref.set({...patch,status:'pending_payment',leaseUntil:FieldValue.delete(),providerRedirectedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true})}
async function failCheckoutAttempt(ref,error){if(!ref)return;await ref.set({status:'failed',errorCode:String(error?.code||'unknown').slice(0,80),leaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()},{merge:true}).catch(()=>{})}
async function supersedePendingCardCheckout({businessId,context,subscriptionId,newOperationId}){
  const intentRef=db.doc(`businesses/${businessId}/subscriptionIntents/${subscriptionId}`),indexRef=db.doc(`subscriptionIndex/${subscriptionId}`),intentSnapshot=await intentRef.get(),intent=intentSnapshot.data()||{};
  if(!intentSnapshot.exists||intent.businessId!==businessId)throw new HttpsError('failed-precondition','A tentativa anterior não pôde ser validada com segurança.');
  let provider=await mp().getSubscription(subscriptionId),status=String(provider?.status||'').toLowerCase();
  if(status==='pending'){provider=await mp().cancelSubscription(subscriptionId);status=String(provider?.status||'').toLowerCase()}
  if(!['cancelled','canceled','expired'].includes(status))throw new HttpsError('failed-precondition','A assinatura anterior já avançou e não pode ser substituída automaticamente. Atualize o status antes de tentar novamente.');
  await providerStore().applyProviderSubscription(provider,{source:'payer_email_replacement'});
  const now=iso(),batch=db.batch(),oldOperationId=String(intent.internalSubscriptionId||intent.operationId||'');
  batch.set(intentRef,{status:'superseded',providerStatus:status,supersededByOperationId:newOperationId,supersededAt:now,updatedAt:now},{merge:true});
  batch.set(indexRef,{status:'superseded',providerStatus:status,supersededByOperationId:newOperationId,supersededAt:now,updatedAt:now},{merge:true});
  if(/^[a-zA-Z0-9_-]{16,100}$/.test(oldOperationId)&&oldOperationId!==newOperationId)batch.set(context.businessRef.collection('billingCheckoutAttempts').doc(oldOperationId),{status:'superseded',replacementOperationId:newOperationId,supersededAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
  await batch.commit();
  return{couponCode:String(intent.discountSnapshot?.couponCodeSnapshot||'').trim().toUpperCase()||null,subscriptionId};
}
function callableError(error){
  if(error instanceof HttpsError)return error;
  if(error instanceof CouponError){const code=error.code==='permission_denied'?'permission-denied':error.code==='duplicate_code'?'already-exists':'failed-precondition';return new HttpsError(code,error.message,{couponCode:error.publicCode})}
  logger.error('[Subscriptions]',{code:error?.code||'unknown',status:error?.status||null,message:String(error?.message||error).slice(0,240)});
  if(error?.code==='invalid-plan')return new HttpsError('invalid-argument','Plano inválido.');
  if(error?.code==='invalid-billing-cycle')return new HttpsError('invalid-argument','Periodicidade inválida.');
  if(error?.code==='invalid-payment-method')return new HttpsError('invalid-argument','Forma de pagamento inválida.');
  if(error?.code==='invalid-billing-payer-email')return new HttpsError('invalid-argument',error.message,{billingCode:'invalid_billing_payer_email'});
  if(['mercado-pago-error','mercado-pago-network-error','mercado-pago-invalid-response'].includes(error?.code)){
    const diagnostic=providerErrorDiagnostics(error),text=`${diagnostic.providerErrorCode||''} ${diagnostic.providerMessage||''} ${diagnostic.providerCauses.map(item=>item.message||'').join(' ')}`.toLowerCase();
    if(providerIndicatesPayerEmailMismatch(diagnostic))return new HttpsError('failed-precondition','O e-mail usado no Mercado Pago é diferente do e-mail informado para cobrança.',{billingCode:'billing_payer_email_mismatch',action:'change_billing_payer_email'});
    if(/pix/.test(text)&&/(?:not available|not enabled|not configured|chave|indispon)/.test(text))return new HttpsError('failed-precondition','O recebimento por Pix ainda não está disponível na conta Mercado Pago vinculada.',{billingCode:'pix_not_available'});
    if(error?.code!=='mercado-pago-error'||diagnostic.httpStatus>=500||[408,425,429].includes(diagnostic.httpStatus))return new HttpsError('unavailable','O Mercado Pago está temporariamente indisponível. Tente novamente em instantes.',{billingCode:'provider_unavailable'});
    return new HttpsError('failed-precondition','O Mercado Pago recusou a criação deste Pix. Tente novamente ou confira os dados da conta.',{billingCode:'provider_rejected'});
  }
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
  let attemptRef=null,redemption=null,checkoutPersisted=false,billingLog={paymentMethodType:null,businessId:null,operationIdHash:null};
  try{
    const businessId=requestedBusinessId(request),plan=requirePlan(request.data?.planId),billingCycle=String(request.data?.billingCycle||'monthly'),officialBilling=planBilling(plan,billingCycle),paymentMethod=requirePaymentMethod(request.data?.paymentMethodType),context=await permissions().authenticatedContext(request,businessId);billingLog={...billingLog,paymentMethodType:paymentMethod.id,businessId};
    if(request.data?.userId&&request.data.userId!==context.uid)throw new HttpsError('permission-denied','Usuário divergente.');
    if(!context.email)throw new HttpsError('failed-precondition','A conta precisa possuir um e-mail válido.');
    if(context.business.subscription?.planId==='internal')throw new HttpsError('failed-precondition','A conta interna não utiliza cobrança.');
    const quoteId=String(request.data?.quoteId||''),couponCode=String(request.data?.couponCode||'').trim().toUpperCase(),previousAttemptId=String(request.data?.previousCheckoutAttemptId||'').trim(),billingPayerEmail=paymentMethod.id==='card'?normalizeBillingPayerEmail(request.data?.billingPayerEmail):null,pendingProviderId=context.business.subscription?.pendingPaymentMethodType==='card'&&context.business.subscription?.pendingPlanId?context.business.subscription?.mercadoPago?.subscriptionId:null;
    if(paymentMethod.id==='card'&&pendingProviderId&&context.business.subscription?.pendingPlanId===plan.id){
      const intent=await db.doc(`businesses/${businessId}/subscriptionIntents/${pendingProviderId}`).get(),intentData=intent.data()||{},sameCheckout=String(intentData.status||'pending')!=='superseded'&&String(intentData.billingCycle||'monthly')===billingCycle&&String(intentData.quoteId||'')===quoteId&&String(intentData.paymentMethodType||'card')===paymentMethod.id&&String(intentData.billingPayerEmail||'')===billingPayerEmail,checkoutUrl=sameCheckout?intentData.checkoutUrl:null;
      if(checkoutUrl){const provider=await mp().getSubscription(String(pendingProviderId)),providerStatus=String(provider?.status||'').toLowerCase();if(providerStatus==='pending')return{checkoutUrl,paymentMethodType:paymentMethod.id,reused:true};if(providerStatus==='authorized'){await providerStore().applyProviderSubscription(provider,{source:'checkout_retry_guard'});throw new HttpsError('failed-precondition','Este pagamento já foi confirmado. Atualize a tela de planos.')}}
    }
    const opId=operationId(request.data?.operationId,businessId,plan.id,context.uid),requestHash=sha(JSON.stringify({businessId,uid:context.uid,planId:plan.id,billingCycle,quoteId,couponCode,paymentMethodType:paymentMethod.id,billingPayerEmail}));billingLog.operationIdHash=sha(opId).slice(0,12);
    logger.info('[BILLING_ATTEMPT_CREATED]',{businessId,planId:plan.id,billingCycle,paymentMethodType:paymentMethod.id,attemptId:opId,operationIdHash:sha(opId).slice(0,12)});
    logger.info('[Billing] payment_method_selected',{businessId,paymentMethodType:paymentMethod.id,operationIdHash:sha(opId).slice(0,12)});
    const attempt=await acquireCheckoutAttempt({businessId,operationId:opId,requestHash,context,planId:plan.id,billingCycle,paymentMethodType:paymentMethod.id,quoteId,billingPayerEmail});
    attemptRef=attempt.ref;
    if(attempt.reused)return attempt.pix?{paymentMethodType:'pix_monthly',pix:attempt.pix,reused:true}:{checkoutUrl:attempt.checkoutUrl,paymentMethodType:paymentMethod.id,reused:true};
    let replacement=null;
    if(paymentMethod.id==='pix_monthly'&&previousAttemptId){
      if(!/^[a-zA-Z0-9_-]{16,100}$/.test(previousAttemptId)||previousAttemptId===opId)throw new HttpsError('invalid-argument','Tentativa Pix anterior inválida.');
      const previousRef=context.businessRef.collection('billingCheckoutAttempts').doc(previousAttemptId),previousSnapshot=await previousRef.get(),previous=previousSnapshot.data()||{};
      if(!previousSnapshot.exists||previous.requestedBy!==context.uid||previous.paymentMethodType!=='pix_monthly'||!['expired','canceled','failed'].includes(String(previous.status||'')))throw new HttpsError('failed-precondition','O Pix anterior ainda não pode ser substituído.');
      replacement={ref:previousRef,data:previous};
    }
    const cardReplacement=pendingProviderId?await supersedePendingCardCheckout({businessId,context,subscriptionId:String(pendingProviderId),newOperationId:opId}):null,effectiveCouponCode=couponCode||cardReplacement?.couponCode||'';
    redemption=(quoteId||effectiveCouponCode)?await coupons().reserveCheckoutCoupon({quoteId,couponCode:effectiveCouponCode,context,planId:plan.id,billingCycle}):null;
    if(redemption)logger.info('[Billing] coupon_applied',{businessId,planId:plan.id,couponId:redemption.couponId,redemptionId:redemption.id});
    const effectiveQuoteId=redemption?.quoteId||quoteId||null,billing={...officialBilling,amount:redemption?Number(redemption.discountedPrice):officialBilling.amount},coupon=redemption?{couponId:redemption.couponId,redemptionId:redemption.id,quoteId:effectiveQuoteId}:null,backUrl=`${APP_URL.value()}#/planos`,now=iso();
    if(paymentMethod.id==='pix_monthly'){
      logger.info('[Billing] pix_order_started',{businessId,planId:plan.id,billingCycle,operationIdHash:sha(opId).slice(0,12)});
      const order=await mp().createPixOrder({businessId,email:context.email,plan,billing,operationId:opId,notificationUrl:MP_WEBHOOK_URL.value()}),details=pixDetails(order),expectedExternalReference=pixExternalReference(businessId,opId);
      if(!details.orderId||!details.qrCode||!details.qrCodeBase64)throw new HttpsError('unavailable','O Mercado Pago não devolveu o QR Code do Pix.');
      const discountSnapshot=redemption?.discountSnapshot||null,attemptData={businessId,requestedBy:context.uid,operationId:opId,requestHash,planId:plan.id,billingCycle,paymentMethodType:'pix_monthly',provider:'mercado_pago',providerOrderId:details.orderId,providerPaymentId:details.paymentId,status:'payment_pending',providerStatus:details.providerStatus,statusDetail:details.statusDetail,officialPrice:officialBilling.amount,originalAmount:officialBilling.amount,discountAmount:Number((officialBilling.amount-billing.amount).toFixed(2)),chargedPrice:billing.amount,finalAmount:billing.amount,expectedExternalReference,quoteId:effectiveQuoteId,couponRedemptionId:redemption?.id||null,couponSnapshot:discountSnapshot,qrCode:details.qrCode,qrCodeBase64:details.qrCodeBase64,ticketUrl:details.ticketUrl,expiresAt:details.expiresAt,replacesOperationId:replacement?previousAttemptId:null,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),leaseUntil:FieldValue.delete()},index={businessId,ownerId:context.uid,operationId:opId,planId:plan.id,billingCycle,paymentMethodType:'pix_monthly',providerOrderId:details.orderId,providerPaymentId:details.paymentId,officialPrice:officialBilling.amount,chargedPrice:billing.amount,expectedExternalReference,quoteId:effectiveQuoteId,couponRedemptionId:redemption?.id||null,discountSnapshot,internalSubscriptionId:opId,replacesOperationId:replacement?previousAttemptId:null,status:'payment_pending',createdAt:now,updatedAt:now},subscription=pendingPixSubscription(context.business.subscription||{},{planId:plan.id,billingCycle,operationId:opId,providerOrderId:details.orderId,providerPaymentId:details.paymentId,providerStatus:details.providerStatus,discount:discountSnapshot},now),batch=db.batch();
      batch.update(context.businessRef,{subscription,updatedAt:FieldValue.serverTimestamp()});
      batch.set(attemptRef,attemptData,{merge:true});
      batch.set(db.doc(`billingOrderIndex/${details.orderId}`),index);
      if(replacement){
        batch.set(replacement.ref,{replacementOperationId:opId,replacedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
        if(replacement.data.providerOrderId)batch.set(db.doc(`billingOrderIndex/${replacement.data.providerOrderId}`),{supersededByOperationId:opId,supersededAt:now,updatedAt:now},{merge:true});
      }
      if(redemption)await coupons().markCheckout({redemptionId:redemption.id,internalSubscriptionId:opId,providerOrderId:details.orderId,providerPaymentId:details.paymentId,writer:batch});
      await batch.commit();checkoutPersisted=true;
      logger.info('[Billing] pix_waiting_payment',{businessId,planId:plan.id,orderId:details.orderId,hasCoupon:Boolean(redemption),couponQuoteRefreshed:redemption?.quoteRefreshed===true,replacesOperationId:replacement?previousAttemptId:null,environment:MP_ENV.value()});
      return{paymentMethodType:'pix_monthly',pix:publicAttempt(attemptData),reused:false};
    }
    const provider=await mp().createSubscription({businessId,userId:context.uid,billingPayerEmail,plan,billing,backUrl,operationId:opId,coupon,paymentMethodType:paymentMethod.id,notificationUrl:MP_WEBHOOK_URL.value()});
    if(!provider?.id||!provider?.init_point)throw new HttpsError('unavailable','O checkout não foi criado pelo Mercado Pago.');
    const expectedExternalReference=billingExternalReference(businessId,opId),subscription=pendingSubscription({existing:context.business.subscription||{},plan,provider,now,billingCycle,discount:redemption?.discountSnapshot||null,paymentMethodType:paymentMethod.id,billingPayerEmail}),batch=db.batch(),intentRef=db.doc(`businesses/${businessId}/subscriptionIntents/${provider.id}`),baseIndex={businessId,ownerId:context.uid,planId:plan.id,billingCycle,paymentMethodType:paymentMethod.id,billingPayerEmail,officialPrice:officialBilling.amount,chargedPrice:billing.amount,expectedExternalReference,quoteId:effectiveQuoteId,couponRedemptionId:redemption?.id||null,discountSnapshot:redemption?.discountSnapshot||null,internalSubscriptionId:opId,replacesSubscriptionId:cardReplacement?.subscriptionId||null,reconciliationVersion:2,status:'pending_payment',createdAt:now,updatedAt:now};
    batch.update(context.businessRef,{subscription,updatedAt:FieldValue.serverTimestamp()});
    batch.set(intentRef,{...baseIndex,requestedBy:context.uid,operationId:opId,providerStatus:String(provider.status||'pending'),subscriptionId:String(provider.id),providerPlanId:null,customerId:provider.payer_id==null?null:String(provider.payer_id),checkoutUrl:String(provider.init_point)});
    batch.set(db.doc(`subscriptionIndex/${provider.id}`),{...baseIndex,subscriptionId:String(provider.id)});
    if(redemption)await coupons().markCheckout({redemptionId:redemption.id,subscriptionId:String(provider.id),internalSubscriptionId:opId,writer:batch});
    await batch.commit();
    checkoutPersisted=true;
    await finishCheckoutAttempt(attemptRef,{checkoutUrl:String(provider.init_point),providerPlanId:null,subscriptionId:String(provider.id),paymentMethodType:paymentMethod.id});
    logger.info('[BILLING_PROVIDER_REDIRECT]',{businessId,planId:plan.id,subscriptionId:String(provider.id),attemptId:opId,providerStatus:String(provider.status||'pending')});
    logger.info('[Subscriptions] checkout created',{businessId,planId:plan.id,billingCycle,paymentMethodType:paymentMethod.id,coupon:Boolean(redemption),environment:MP_ENV.value()});
    logger.info('[Billing] subscription_created',{businessId,planId:plan.id,paymentMethodType:paymentMethod.id,subscriptionId:String(provider.id)});
    return{checkoutUrl:String(provider.init_point),paymentMethodType:paymentMethod.id,reused:false};
  }catch(error){
    logger.error('[Billing] billing_error',{stage:'create_subscription',code:error?.code||'unknown',status:error?.status||null});
    if(billingLog.paymentMethodType==='pix_monthly')logger.error('[BILLING_PIX_ERROR]',{...billingLog,...providerErrorDiagnostics(error)});
    if(!checkoutPersisted&&redemption&&!redemption.idempotent)await coupons().releaseReservation(redemption.id,'provider_checkout_failed').catch(()=>{});
    await failCheckoutAttempt(attemptRef,error);
    throw callableError(error);
  }
});

exports.getPixCheckoutStatus=onCall(FUNCTION_OPTIONS,async request=>{
  try{
    const businessId=requestedBusinessId(request),operationIdValue=String(request.data?.operationId||'').trim(),reconcileProvider=request.data?.reconcileProvider===true,context=await permissions().authenticatedContext(request,businessId);
    if(!/^[a-zA-Z0-9_-]{16,100}$/.test(operationIdValue))throw new HttpsError('invalid-argument','Tentativa Pix inválida.');
    const ref=context.businessRef.collection('billingCheckoutAttempts').doc(operationIdValue),snapshot=await ref.get();
    if(!snapshot.exists||snapshot.data()?.requestedBy!==context.uid||snapshot.data()?.paymentMethodType!=='pix_monthly')throw new HttpsError('not-found','Tentativa Pix não encontrada.');
    let data=snapshot.data();
    if(reconcileProvider&&data.providerOrderId&&data.status==='payment_pending'){
      const lastCheck=data.lastManualProviderCheckAt?.toMillis?.()||0;if(lastCheck&&Date.now()-lastCheck<60000)throw new HttpsError('resource-exhausted','A conferência manual pode ser feita uma vez por minuto.');
      await ref.set({lastManualProviderCheckAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
      const order=await mp().getOrder(data.providerOrderId),result=await pixBilling().applyOrder(order,{source:'manual_reconciliation'});data=result.attempt;
    }
    return{pix:publicAttempt(data),source:reconcileProvider?'mercado_pago':'firestore'};
  }catch(error){throw callableError(error)}
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
    const subscription=context.business.subscription||{},pixOrderId=subscription.mercadoPago?.pendingOrderId,checkoutReturn=request.data?.checkoutReturn===true;
    const lastSync=new Date(context.business.subscription?.mercadoPago?.lastManualSyncAt||0).getTime(),minimumInterval=checkoutReturn?30000:15*60*1000;if(lastSync&&Date.now()-lastSync<minimumInterval)throw new HttpsError('resource-exhausted',checkoutReturn?'A cobrança acabou de ser conferida. Aguarde alguns segundos.':'A reconciliação manual pode ser feita a cada 15 minutos.');
    if(pixOrderId&&subscription.pendingPaymentMethodType==='pix_monthly'){
      const order=await mp().getOrder(pixOrderId),result=await pixBilling().applyOrder(order,{source:'manual_reconciliation'}),now=iso();await context.businessRef.update({'subscription.mercadoPago.lastManualSyncAt':now,updatedAt:FieldValue.serverTimestamp()});
      logger.info('[Subscriptions] Pix manual reconciliation',{businessId,status:result.status});return{subscription:sanitize(result.subscription),pix:result.attempt,source:'mercado_pago'};
    }
    const subscriptionId=subscription.mercadoPago?.subscriptionId;if(!subscriptionId)throw new HttpsError('failed-precondition','Cobrança do Mercado Pago não encontrada.');
    logger.info('[BILLING_RETURN_RECEIVED]',{businessId,subscriptionId,checkoutReturn});
    const reconciliation=await reconcileCardBillingAttempt({subscriptionId,source:checkoutReturn?'checkout_return':'manual_reconciliation',expectedBusinessId:businessId}),index=reconciliation.index,payment=reconciliation.payment,result=reconciliation.result,now=iso(),attemptId=String(index?.internalSubscriptionId||'');
    await context.businessRef.update({'subscription.mercadoPago.lastManualSyncAt':now,updatedAt:FieldValue.serverTimestamp()});
    const retryContext={planId:index?.planId||subscription.pendingPlanId||subscription.planId||null,billingCycle:index?.billingCycle||subscription.pendingBillingCycle||subscription.billingCycle||'monthly',billingPayerEmail:index?.billingPayerEmail||subscription.pendingBillingPayerEmail||null,couponCode:index?.discountSnapshot?.couponCodeSnapshot||null,officialPrice:index?.officialPrice??null,chargedPrice:index?.chargedPrice??null,previousCheckoutAttemptId:attemptId||null};
    logger.info('[Subscriptions] card reconciliation',{businessId,status:result.subscription.status,paymentStatus:payment?.status||null,statusDetail:payment?.statusDetail||null});return{subscription:sanitize(result.subscription),payment,retryContext,source:'mercado_pago'};
  }catch(error){throw callableError(error)}
});

exports.receiveWebhook=onRequest({region:REGION,memory:'256MiB',timeoutSeconds:30,maxInstances:30,secrets:[MP_TOKEN,MP_TEST_TOKEN,MP_WEBHOOK_SECRET]},async(req,res)=>{
  if(req.method!=='POST'){res.status(405).send('method-not-allowed');return}
  const event=eventData(req);
  if(!verifyWebhookSignature({secret:MP_WEBHOOK_SECRET.value(),xSignature:event.xSignature,xRequestId:event.requestId,dataId:event.dataId})){logger.warn('[Webhook] invalid signature',{type:event.type,hasDataId:Boolean(event.dataId)});res.status(401).send('invalid-signature');return}
  logger.info('[BILLING_WEBHOOK_RECEIVED]',{eventType:event.type,action:event.action,providerResourceId:event.dataId||null});
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
    const applyPixOrder=async(order,{providerPaymentId=null}={})=>{
      const details=pixDetails(order);
      logger.info('[BILLING_PROVIDER_VERIFIED]',{eventType:event.type,orderId:details.orderId,paymentId:providerPaymentId||details.paymentId||null,externalReference:String(order.external_reference||'').slice(0,80)||null,status:details.providerStatus,statusDetail:details.statusDetail,amount:details.amount});
      const result=await pixBilling().applyOrder(order,{source:'webhook',eventId:id});
      if(result.status==='payment_approved')logger.info('[BILLING_ENTITLEMENT_ACTIVATED]',{businessId:result.businessId,planId:result.subscription?.planId||null,periodEnd:result.subscription?.currentPeriodEnd||null,idempotent:result.idempotent===true});
      await eventRef.update({status:'processed',businessId:result.businessId,subscriptionStatus:result.subscription?.status||null,paymentStatus:result.status,providerOrderId:details.orderId,providerPaymentId:providerPaymentId||details.paymentId||null,processedAt:FieldValue.serverTimestamp(),leaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()});
      return result;
    };
    if(event.type==='subscription_preapproval_plan'){logger.info('[BILLING_WEBHOOK_SKIPPED]',{eventType:event.type,reason:'provider-plan-event'});await eventRef.update({status:'ignored',reason:'provider-plan-event',updatedAt:FieldValue.serverTimestamp()});res.status(200).send('ignored');return}
    if(['order','orders'].includes(event.type)){
      const order=await mp().getOrder(event.dataId),result=await applyPixOrder(order);
      logger.info('[Webhook] Pix order processed',{businessId:result.businessId,status:result.status});res.status(200).send('ok');return;
    }
    let subscriptionId=event.dataId,paymentResult=null;
    if(event.type==='subscription_authorized_payment'){const payment=await mp().getAuthorizedPayment(event.dataId);subscriptionId=String(payment.preapproval_id||payment.subscription_id||'');paymentResult=providerPaymentResult(event.type,payment)}
    if(event.type==='payment'){
      const payment=await mp().getPayment(event.dataId),pixOrder=await pixBilling().resolvePaymentOrder(payment);
      if(pixOrder){const order=await mp().getOrder(pixOrder.orderId),result=await applyPixOrder(order,{providerPaymentId:String(payment.id||event.dataId)});logger.info('[Webhook] Pix payment normalized to order',{businessId:result.businessId,status:result.status});res.status(200).send('ok');return}
      subscriptionId=String(payment.metadata?.preapproval_id||payment.subscription_id||'');paymentResult=providerPaymentResult(event.type,payment);
    }
    if(!subscriptionId){logger.info('[BILLING_WEBHOOK_SKIPPED]',{eventType:event.type,reason:'subscription-id-missing'});await eventRef.update({status:'ignored',reason:'subscription-id-missing',updatedAt:FieldValue.serverTimestamp()});res.status(200).send('ignored');return}
    const reconciliation=await reconcileCardBillingAttempt({subscriptionId,source:'webhook'}),store=providerStore(),result=reconciliation.result;
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

const billingTime=value=>typeof value?.toMillis==='function'?value.toMillis():new Date(value||0).getTime();
exports.reconcileStaleBillingAttempts=onSchedule({region:REGION,schedule:'every 6 hours',timeZone:'America/Sao_Paulo',memory:'256MiB',timeoutSeconds:300,maxInstances:1},async()=>{
  const snapshot=await db.collection('subscriptionIndex').where('status','==','pending_payment').limit(100).get(),now=Date.now(),reconcileAfter=30*60*1000,abandonAfter=24*60*60*1000;let checked=0,closed=0,failed=0;
  for(const row of snapshot.docs){const index=row.data()||{};if(index.reconciliationVersion!==2)continue;const age=now-billingTime(index.createdAt||index.updatedAt);if(!Number.isFinite(age)||age<reconcileAfter)continue;try{const result=await reconcileCardBillingAttempt({subscriptionId:row.id,source:'stale_reconciliation',cancelIfAbandoned:age>=abandonAfter});checked++;if(isTerminalAttempt(result.attempt?.status))closed++}catch(error){failed++;logger.error('[BILLING_STALE_RECONCILIATION_FAILED]',{subscriptionId:row.id,businessId:index.businessId||null,code:error?.code||'unknown'})}}
  logger.info('[BILLING_STALE_RECONCILIATION_FINISHED]',{candidates:snapshot.size,checked,closed,failed,reconcileAfterMinutes:30,abandonAfterHours:24});
});

exports.cancelPendingBillingAttempt=onCall(FUNCTION_OPTIONS,async request=>{
  try{const businessId=requestedBusinessId(request),context=await permissions().authenticatedContext(request,businessId,{ownerOnly:true}),subscription=context.business.subscription||{},subscriptionId=String(subscription.mercadoPago?.subscriptionId||'');if(!subscriptionId||subscription.pendingPaymentMethodType!=='card')throw new HttpsError('failed-precondition','Não há checkout de cartão pendente para cancelar.');const provider=await mp().getSubscription(subscriptionId),status=String(provider?.status||'').toLowerCase();if(status==='authorized')throw new HttpsError('failed-precondition','O pagamento já foi autorizado. Atualize o plano.');if(status==='pending')await mp().cancelSubscription(subscriptionId);const result=await reconcileCardBillingAttempt({subscriptionId,source:'owner_cancel_pending',expectedBusinessId:businessId});return{status:result.attempt.status,subscription:sanitize(result.result?.subscription||subscription)}}catch(error){throw callableError(error)}
});

exports.reconcileBillingRequest=onDocumentCreated({document:'billingReconciliationRequests/{requestId}',region:REGION,memory:'256MiB',timeoutSeconds:120,maxInstances:1,secrets:[MP_TOKEN,MP_TEST_TOKEN]},async event=>{
  const snapshot=event.data;if(!snapshot)return;const request=snapshot.data()||{},businessId=String(request.businessId||''),subscriptionId=String(request.subscriptionId||''),action=String(request.action||'reconcile');
  if(!/^biz_[A-Za-z0-9_-]{10,100}$/.test(businessId)||!/^[A-Za-z0-9_-]{16,100}$/.test(subscriptionId)||!['reconcile','cancel_abandoned'].includes(action)){await snapshot.ref.set({status:'failed',errorCode:'invalid_request',finishedAt:FieldValue.serverTimestamp()},{merge:true});return}
  const acquired=await db.runTransaction(async transaction=>{const current=await transaction.get(snapshot.ref),data=current.data()||{};if(['processing','completed'].includes(data.status))return false;transaction.set(snapshot.ref,{status:'processing',startedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});return true});if(!acquired)return;
  try{const result=await reconcileCardBillingAttempt({subscriptionId,source:'admin_reconciliation_request',expectedBusinessId:businessId,cancelIfAbandoned:action==='cancel_abandoned'});await snapshot.ref.set({status:'completed',resultStatus:result.attempt?.status||null,providerStatus:String(result.provider?.status||'')||null,paymentStatus:result.payment?.status||null,finishedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true})}catch(error){logger.error('[BILLING_ADMIN_RECONCILIATION_FAILED]',{requestId:event.params.requestId,businessId,subscriptionId,code:error?.code||'unknown'});await snapshot.ref.set({status:'failed',errorCode:String(error?.code||'unknown').slice(0,80),finishedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});throw error}
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
    const configuredServiceModes=Array.isArray(context.catalog.serviceModes)?context.catalog.serviceModes.filter(mode=>mode&&mode.active!==false):[],requestedServiceModeId=String(data.serviceModeId||''),selectedServiceMode=configuredServiceModes.find(mode=>String(mode.id||mode.type)===requestedServiceModeId)||(!requestedServiceModeId?configuredServiceModes[0]:null);if(configuredServiceModes.length&&!selectedServiceMode)throw new HttpsError('invalid-argument','Tipo de pedido inválido.');
    let clientRefToken=null,portalSessionHash=null;const rawSession=String(data.customerSessionToken||'');if(rawSession){portalSessionHash=sha(rawSession);const session=await context.ref.collection('portalSessions').doc(portalSessionHash).get(),sessionData=session.data()||{};if(session.exists&&sessionData.active===true&&sessionData.businessId===context.catalog.businessId&&new Date(sessionData.expiresAt)>new Date())clientRefToken=sessionData.clientRefToken}
    const orderRef=context.ref.collection('orders').doc(orderId),existing=await orderRef.get();if(existing.exists){const prior=existing.data();if(prior.operationId===`catalog-order:${orderId}`)return{order:{...prior,createdAt:prior.createdAt?.toDate?.().toISOString?.()||prior.createdAt,updatedAt:prior.updatedAt?.toDate?.().toISOString?.()||prior.updatedAt},idempotent:true};throw new HttpsError('already-exists','Este pedido já existe.');}
    const createdAt=new Date().toISOString(),publicOrderNumber=`AF${Date.now().toString().slice(-6)}`,order={id:orderId,businessId:context.catalog.businessId,catalogToken:context.catalogToken,source:'online_catalog',orderStatus:'recebido',customerName,customerPhone,customerLocation,items,subtotal:total,discount:0,fee:0,total,paymentPreference,serviceModeId:selectedServiceMode?String(selectedServiceMode.id||selectedServiceMode.type):null,serviceModeType:selectedServiceMode?String(selectedServiceMode.type||selectedServiceMode.id):null,serviceModeLabel:selectedServiceMode?String(selectedServiceMode.label||selectedServiceMode.type||selectedServiceMode.id).slice(0,80):null,orderAccessToken:String(data.orderAccessToken||crypto.randomBytes(24).toString('hex')).slice(0,128),operationId:`catalog-order:${orderId}`,publicOrderNumber,visitId:context.catalog.visitId||'catalog-universal',clientRefToken,portalSessionHash,paymentStatus:'pendente',note,createdAt,updatedAt:createdAt};
    await orderRef.create(order);logger.info('[Catalog order]',{businessId:context.catalog.businessId,orderId,itemCount:items.length,total});return{order};
  }catch(error){if(error instanceof HttpsError)throw error;logger.error('[Catalog order]',{code:error?.code||'unknown'});throw new HttpsError('unavailable','Não foi possível registrar o pedido agora.')}
});
