'use strict';

const {getPlan}=require('./plan-service');

const MP_STATUS={authorized:'active',pending:'pending',paused:'paused',cancelled:'cancelled',canceled:'cancelled',expired:'expired'};
const ACTIVE_STATUSES=new Set(['trial','active','grace_period']);

function parseDate(value){if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:date}
function mapProviderStatus(value){return MP_STATUS[String(value||'').toLowerCase()]||'pending'}
function normalizedStatus(subscription={}){const raw=String(subscription.status||subscription.subscriptionStatus||'inactive').toLowerCase();return raw==='trial'?'trialing':raw==='cancelled'?'canceled':raw}
function isTrialActive(subscription,now=new Date()){const end=parseDate(subscription?.trialEndsAt);return normalizedStatus(subscription)==='trialing'&&Boolean(end)&&end>now}
function computeAccess(subscription={},now=new Date()){
  const status=normalizedStatus(subscription),plan=getPlan(subscription.planId),trial=isTrialActive(subscription,now),internal=subscription.planId==='internal'&&(subscription.isInternal===true||['active','internal'].includes(status)),active=internal||status==='active'||status==='grace_period'||trial;
  return{status,planId:subscription.planId||'',active,canAccessApp:true,canMutate:active,readOnly:!active,trial,features:internal?null:plan?.features||{},limits:internal?null:plan?.limits||{},unlimited:internal};
}
function providerPatch(provider,{planId,now,existing={},billingCycle,discount,paymentMethodType,providerPlanId}={}){
  const status=mapProviderStatus(provider.status),plan=getPlan(planId||existing.planId),lastPaymentDate=provider.summarized?.last_charged_date||existing.lastPaymentDate||null;
  return{
    ...existing,
    status,
    subscriptionStatus:status,
    planId:plan?.id||planId||existing.planId||'',
    pendingPlanId:null,
    pendingBillingCycle:null,
    pendingPaymentMethodType:null,
    pendingBillingPayerEmail:null,
    billingCycle:billingCycle||existing.billingCycle||'monthly',
    paymentMethodType:paymentMethodType||existing.paymentMethodType||existing.pendingPaymentMethodType||'card',
    provider:'mercado_pago',
    startedAt:provider.date_created||existing.startedAt||now,
    expiresAt:provider.auto_recurring?.end_date||existing.expiresAt||null,
    nextBillingDate:provider.next_payment_date||existing.nextBillingDate||null,
    lastPaymentDate,
    currentPeriodEnd:provider.next_payment_date||existing.currentPeriodEnd||null,
    cancelAtPeriodEnd:false,
    updatedAt:now,
    ...(discount?{discount:{...discount}}:{}),
    mercadoPago:{
      ...(existing.mercadoPago||{}),
      subscriptionId:String(provider.id||existing.mercadoPago?.subscriptionId||''),
      preapprovalId:String(provider.id||existing.mercadoPago?.preapprovalId||''),
      providerPlanId:String(provider.preapproval_plan_id||providerPlanId||existing.mercadoPago?.providerPlanId||''),
      customerId:provider.payer_id==null?(existing.mercadoPago?.customerId||null):String(provider.payer_id),
      providerStatus:String(provider.status||''),
      lastWebhook:now
    }
  };
}
function pendingSubscription({existing={},plan,provider,now,billingCycle='monthly',discount=null,paymentMethodType='card',providerPlanId=null,billingPayerEmail=null}){
  const preserveTrial=isTrialActive(existing,new Date(now));
  return{
    ...existing,
    status:preserveTrial?'trialing':'pending',
    subscriptionStatus:preserveTrial?'trialing':'pending',
    planId:preserveTrial?(existing.planId||'trial'):plan.id,
    pendingPlanId:plan.id,
    pendingBillingCycle:billingCycle,
    pendingPaymentMethodType:paymentMethodType,
    pendingBillingPayerEmail:billingPayerEmail||null,
    ...(discount?{pendingDiscount:{...discount}}:{}),
    provider:'mercado_pago',
    updatedAt:now,
    mercadoPago:{...(existing.mercadoPago||{}),subscriptionId:providerPlanId?null:String(provider.id),preapprovalId:providerPlanId?null:String(provider.id),providerPlanId:providerPlanId?String(providerPlanId):String(existing.mercadoPago?.providerPlanId||''),customerId:provider.payer_id==null?null:String(provider.payer_id),providerStatus:String(provider.status||'pending'),checkoutCreatedAt:now,lastWebhook:existing.mercadoPago?.lastWebhook||null}
  };
}
function sanitize(subscription={}){
  const copy=JSON.parse(JSON.stringify(subscription));
  if(copy.mercadoPago)delete copy.mercadoPago.checkoutUrl;
  return copy;
}

module.exports={ACTIVE_STATUSES,mapProviderStatus,isTrialActive,computeAccess,providerPatch,pendingSubscription,sanitize,parseDate,normalizedStatus};
