'use strict';

const crypto=require('node:crypto');
const {initializeApp}=require('firebase-admin/app');
const {getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
const {onCall,onRequest,HttpsError}=require('firebase-functions/v2/https');
const {onSchedule}=require('firebase-functions/v2/scheduler');
const {onDocumentCreated}=require('firebase-functions/v2/firestore');
const {defineSecret,defineString}=require('firebase-functions/params');
const {logger}=require('firebase-functions');
const {mercadoPagoService}=require('./services/mercado-pago-service');
const {permissionService}=require('./services/permission-service');
const {requirePlan}=require('./services/plan-service');
const {pendingSubscription,sanitize}=require('./services/subscription-service');
const {firestoreSubscriptionService}=require('./services/firestore-subscription-service');
const {verifyWebhookSignature,eventId,eventData}=require('./services/webhook-service');

initializeApp();
const db=getFirestore(),REGION='southamerica-east1';
const MP_TOKEN=defineSecret('MERCADO_PAGO_ACCESS_TOKEN');
const MP_TEST_TOKEN=defineSecret('MERCADO_PAGO_ACCESS_TOKEN_TEST');
const MP_WEBHOOK_SECRET=defineSecret('MERCADO_PAGO_WEBHOOK_SECRET');
const MP_ENV=defineString('MERCADO_PAGO_ENV',{default:'production'});
const APP_URL=defineString('ADI_FESTA_APP_URL',{default:'https://murillocharles97-netizen.github.io/adi-festa-controle/'});
const FUNCTION_OPTIONS={region:REGION,memory:'256MiB',timeoutSeconds:30,maxInstances:20,secrets:[MP_TOKEN,MP_TEST_TOKEN]};

const token=()=>MP_ENV.value()==='test'?MP_TEST_TOKEN.value():MP_TOKEN.value();
const mp=()=>mercadoPagoService({accessToken:token()});
const permissions=()=>permissionService(db);
const providerStore=()=>firestoreSubscriptionService(db);
const iso=()=>new Date().toISOString();
const operationId=(raw,businessId,planId,uid)=>{
  const supplied=String(raw||'').trim();
  if(/^[a-zA-Z0-9_-]{16,100}$/.test(supplied))return supplied;
  const minute=Math.floor(Date.now()/60000);
  return crypto.createHash('sha256').update(`${businessId}:${planId}:${uid}:${minute}`).digest('hex');
};
function callableError(error){
  if(error instanceof HttpsError)return error;
  logger.error('[Subscriptions]',{code:error?.code||'unknown',status:error?.status||null,message:String(error?.message||error).slice(0,240)});
  if(error?.code==='invalid-plan')return new HttpsError('invalid-argument','Plano inválido.');
  if(error?.code==='mercado-pago-error')return new HttpsError('unavailable','O Mercado Pago não respondeu como esperado. Tente novamente em instantes.');
  return new HttpsError('internal','Não foi possível concluir a operação de assinatura.');
}
function requestedBusinessId(request){return String(request.data?.companyId||request.data?.businessId||'').trim()}

exports.createSubscription=onCall(FUNCTION_OPTIONS,async request=>{
  try{
    const businessId=requestedBusinessId(request),plan=requirePlan(request.data?.planId),context=await permissions().authenticatedContext(request,businessId);
    if(request.data?.userId&&request.data.userId!==context.uid)throw new HttpsError('permission-denied','Usuário divergente.');
    if(!context.email)throw new HttpsError('failed-precondition','A conta precisa possuir um e-mail válido.');
    if(context.business.subscription?.planId==='internal')throw new HttpsError('failed-precondition','A conta interna não utiliza cobrança.');
    const currentId=context.business.subscription?.mercadoPago?.subscriptionId;
    if(currentId&&context.business.subscription?.pendingPlanId===plan.id){const intent=await db.doc(`businesses/${businessId}/subscriptionIntents/${currentId}`).get();const checkoutUrl=intent.data()?.checkoutUrl;if(checkoutUrl)return{checkoutUrl}}
    const opId=operationId(request.data?.operationId,businessId,plan.id,context.uid),provider=await mp().createSubscription({businessId,userId:context.uid,email:context.email,plan,backUrl:`${APP_URL.value()}#/planos`,operationId:opId});
    if(!provider?.id||!provider?.init_point)throw new HttpsError('unavailable','O checkout não foi criado pelo Mercado Pago.');
    const now=iso(),subscription=pendingSubscription({existing:context.business.subscription||{},plan,provider,now}),batch=db.batch(),intentRef=db.doc(`businesses/${businessId}/subscriptionIntents/${provider.id}`),indexRef=db.doc(`subscriptionIndex/${provider.id}`);
    batch.update(context.businessRef,{subscription,updatedAt:FieldValue.serverTimestamp()});
    batch.set(intentRef,{businessId,requestedBy:context.uid,operationId:opId,planId:plan.id,status:'pending',providerStatus:String(provider.status||'pending'),subscriptionId:String(provider.id),customerId:provider.payer_id==null?null:String(provider.payer_id),checkoutUrl:String(provider.init_point),createdAt:now,updatedAt:now});
    batch.set(indexRef,{businessId,ownerId:context.uid,planId:plan.id,subscriptionId:String(provider.id),status:'pending',createdAt:now,updatedAt:now});
    await batch.commit();logger.info('[Subscriptions] checkout created',{businessId,planId:plan.id,environment:MP_ENV.value()});
    return{checkoutUrl:String(provider.init_point)};
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
    let subscriptionId=event.dataId;
    if(event.type==='subscription_authorized_payment'){const payment=await mp().getAuthorizedPayment(event.dataId);subscriptionId=String(payment.preapproval_id||payment.subscription_id||'')}
    if(event.type==='payment'){const payment=await mp().getPayment(event.dataId);subscriptionId=String(payment.metadata?.preapproval_id||payment.subscription_id||'')}
    if(!subscriptionId){await eventRef.update({status:'ignored',reason:'subscription-id-missing',updatedAt:FieldValue.serverTimestamp()});res.status(200).send('ignored');return}
    const provider=await mp().getSubscription(subscriptionId),result=await providerStore().applyProviderSubscription(provider,{source:'webhook',eventId:id});await eventRef.update({status:'processed',businessId:result.businessId,subscriptionStatus:result.subscription.status,processedAt:FieldValue.serverTimestamp(),leaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()});
    logger.info('[Webhook] processed',{type:event.type,businessId:result.businessId,status:result.subscription.status});res.status(200).send('ok');
  }catch(error){logger.error('[Webhook] failed',{eventId:id,type:event.type,code:error?.code||'unknown',message:String(error?.message||error).slice(0,240)});await eventRef.set({status:'failed',errorCode:error?.code||'unknown',updatedAt:FieldValue.serverTimestamp()},{merge:true});res.status(500).send('retry')}
});

exports.expireSubscriptionsDaily=onSchedule({region:REGION,schedule:'15 3 * * *',timeZone:'America/Sao_Paulo',memory:'256MiB',timeoutSeconds:300,maxInstances:1},async()=>{
  const now=Timestamp.now(),queries=[db.collection('businesses').where('subscription.status','==','trial').where('subscription.trialEndsAt','<=',now).limit(450),db.collection('businesses').where('subscription.status','in',['active','grace_period']).where('subscription.expiresAt','<=',now.toDate().toISOString()).limit(450)];
  let changed=0;for(const query of queries){const snapshot=await query.get();if(snapshot.empty)continue;const batch=db.batch();snapshot.docs.forEach(doc=>{batch.update(doc.ref,{'subscription.status':'expired','subscription.expiredAt':now,updatedAt:now});changed++});await batch.commit()}
  logger.info('[Subscriptions] daily expiration completed',{changed});
});

exports.initializeBusinessTrial=onDocumentCreated({document:'businesses/{businessId}',region:REGION},async event=>{
  const snapshot=event.data;if(!snapshot)return;const business=snapshot.data();if(business.subscription)return;
  const now=Timestamp.now(),trialEndsAt=Timestamp.fromMillis(now.toMillis()+7*24*60*60*1000);await snapshot.ref.update({subscription:{status:'trial',planId:'trial',trialStartedAt:now,trialEndsAt,startedAt:now,expiresAt:trialEndsAt,nextBillingDate:null,lastPaymentDate:null,mercadoPago:{subscriptionId:null,customerId:null,preapprovalId:null,lastWebhook:null}},updatedAt:now});
  logger.info('[Subscriptions] trial initialized',{businessId:event.params.businessId});
});
