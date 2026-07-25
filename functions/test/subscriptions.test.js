'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {normalizePlanId,requirePlan}=require('../src/services/plan-service');
const {mapProviderStatus,isTrialActive,providerPatch,pendingSubscription,computeAccess}=require('../src/services/subscription-service');
const {signatureManifest,verifyWebhookSignature,eventId}=require('../src/services/webhook-service');
const {mercadoPagoService}=require('../src/services/mercado-pago-service');

test('normaliza aliases sem permitir plano arbitrário',()=>{
  assert.equal(normalizePlanId('starter'),'essential');assert.equal(normalizePlanId('pro'),'professional');assert.equal(normalizePlanId('premium'),'premium');assert.throws(()=>requirePlan('internal'));
});

test('mapeia estados oficiais do provedor',()=>{
  assert.equal(mapProviderStatus('authorized'),'active');assert.equal(mapProviderStatus('pending'),'pending');assert.equal(mapProviderStatus('paused'),'paused');assert.equal(mapProviderStatus('canceled'),'cancelled');assert.equal(mapProviderStatus('expired'),'expired');
});

test('preserva trial enquanto checkout aguarda pagamento',()=>{
  const now='2026-07-25T12:00:00.000Z',existing={status:'trial',planId:'trial',trialEndsAt:'2026-07-30T12:00:00.000Z'},plan=requirePlan('professional'),provider={id:'sub_1',status:'pending'};
  assert.equal(isTrialActive(existing,new Date(now)),true);const pending=pendingSubscription({existing,plan,provider,now});assert.equal(pending.status,'trial');assert.equal(pending.pendingPlanId,'professional');assert.equal(pending.mercadoPago.subscriptionId,'sub_1');
});

test('webhook autorizado ativa plano e datas',()=>{
  const patch=providerPatch({id:'sub_1',status:'authorized',payer_id:123,date_created:'2026-07-25T10:00:00Z',next_payment_date:'2026-08-25T10:00:00Z',summarized:{last_charged_date:'2026-07-25T10:01:00Z'}},{planId:'professional',now:'2026-07-25T10:02:00Z',existing:{status:'pending'}});
  assert.equal(patch.status,'active');assert.equal(patch.planId,'professional');assert.equal(patch.lastPaymentDate,'2026-07-25T10:01:00Z');assert.equal(patch.mercadoPago.customerId,'123');assert.equal(computeAccess(patch).canAccessApp,true);
});

test('valida HMAC do Mercado Pago com proteção de replay',()=>{
  const secret='webhook-secret',dataId='ABC123',requestId='req-1',ts=Math.floor(Date.now()/1000),manifest=signatureManifest({dataId,requestId,timestamp:ts}),v1=crypto.createHmac('sha256',secret).update(manifest).digest('hex'),xSignature=`ts=${ts},v1=${v1}`;
  assert.equal(verifyWebhookSignature({secret,xSignature,xRequestId:requestId,dataId}),true);assert.equal(verifyWebhookSignature({secret,xSignature,xRequestId:'other',dataId}),false);assert.equal(verifyWebhookSignature({secret,xSignature,xRequestId:requestId,dataId,now:(ts+600)*1000}),false);assert.equal(eventId({type:'subscription_preapproval',action:'updated',dataId,requestId}),eventId({type:'subscription_preapproval',action:'updated',dataId,requestId}));
});

test('cliente Mercado Pago envia token somente no backend e chave idempotente',async()=>{
  let captured;const fetchImpl=async(url,options)=>{captured={url,options};return{ok:true,status:201,text:async()=>JSON.stringify({id:'sub_1',init_point:'https://checkout.example'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl}),plan=requirePlan('essential');await service.createSubscription({businessId:'biz_1',userId:'uid_1',email:'owner@example.com',plan,backUrl:'https://app.example',operationId:'op_1'});
  assert.equal(captured.url,'https://api.mercadopago.com/preapproval');assert.equal(captured.options.headers.Authorization,'Bearer secret-token');assert.equal(captured.options.headers['X-Idempotency-Key'],'op_1');const body=JSON.parse(captured.options.body);assert.equal(body.external_reference,'biz_1');assert.equal(body.auto_recurring.transaction_amount,29.9);assert.equal('notification_url' in body,false);
});
