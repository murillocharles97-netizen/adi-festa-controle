'use strict';

const {getPlan}=require('./plan-service');

const MP_STATUS={authorized:'active',pending:'pending',paused:'paused',cancelled:'cancelled',canceled:'cancelled',expired:'expired'};
const ACTIVE_STATUSES=new Set(['trial','active','grace_period']);

function parseDate(value){if(!value)return null;const date=new Date(value);return Number.isNaN(date.getTime())?null:date}
function mapProviderStatus(value){return MP_STATUS[String(value||'').toLowerCase()]||'pending'}
function isTrialActive(subscription,now=new Date()){const end=parseDate(subscription?.trialEndsAt);return subscription?.status==='trial'&&Boolean(end)&&end>now}
function computeAccess(subscription={},now=new Date()){
  const status=String(subscription.status||'expired'),plan=getPlan(subscription.planId),trial=isTrialActive(subscription,now),internal=subscription.planId==='internal'&&status==='active',active=internal||status==='active'||status==='grace_period'||trial;
  return{status,planId:subscription.planId||'',active,canAccessApp:active,trial,features:internal?{}:plan?.features||{},limits:internal?{}:plan?.limits||{}};
}
function providerPatch(provider,{planId,now,existing={}}={}){
  const status=mapProviderStatus(provider.status),plan=getPlan(planId||existing.planId),lastPaymentDate=provider.summarized?.last_charged_date||existing.lastPaymentDate||null;
  return{
    ...existing,
    status,
    planId:plan?.id||planId||existing.planId||'',
    provider:'mercado_pago',
    startedAt:provider.date_created||existing.startedAt||now,
    expiresAt:provider.auto_recurring?.end_date||existing.expiresAt||null,
    nextBillingDate:provider.next_payment_date||existing.nextBillingDate||null,
    lastPaymentDate,
    currentPeriodEnd:provider.next_payment_date||existing.currentPeriodEnd||null,
    cancelAtPeriodEnd:false,
    updatedAt:now,
    mercadoPago:{
      ...(existing.mercadoPago||{}),
      subscriptionId:String(provider.id||existing.mercadoPago?.subscriptionId||''),
      preapprovalId:String(provider.id||existing.mercadoPago?.preapprovalId||''),
      customerId:provider.payer_id==null?(existing.mercadoPago?.customerId||null):String(provider.payer_id),
      providerStatus:String(provider.status||''),
      lastWebhook:now
    }
  };
}
function pendingSubscription({existing={},plan,provider,now}){
  const preserveTrial=isTrialActive(existing,new Date(now));
  return{
    ...existing,
    status:preserveTrial?'trial':'pending',
    planId:preserveTrial?(existing.planId||'trial'):plan.id,
    pendingPlanId:plan.id,
    provider:'mercado_pago',
    updatedAt:now,
    mercadoPago:{...(existing.mercadoPago||{}),subscriptionId:String(provider.id),preapprovalId:String(provider.id),customerId:provider.payer_id==null?null:String(provider.payer_id),providerStatus:String(provider.status||'pending'),checkoutCreatedAt:now,lastWebhook:existing.mercadoPago?.lastWebhook||null}
  };
}
function sanitize(subscription={}){
  const copy=JSON.parse(JSON.stringify(subscription));
  if(copy.mercadoPago)delete copy.mercadoPago.checkoutUrl;
  return copy;
}

module.exports={ACTIVE_STATUSES,mapProviderStatus,isTrialActive,computeAccess,providerPatch,pendingSubscription,sanitize,parseDate};
