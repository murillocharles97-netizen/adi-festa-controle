'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {normalizePlanId,requirePlan}=require('../src/services/plan-service');
const {mapProviderStatus,isTrialActive,providerPatch,pendingSubscription,computeAccess}=require('../src/services/subscription-service');
const {signatureManifest,verifyWebhookSignature,eventId}=require('../src/services/webhook-service');
const {mercadoPagoService}=require('../src/services/mercado-pago-service');
const {requirePaymentMethod,providerPaymentResult}=require('../src/services/billing-payment-method-service');
const {validateProviderSubscription}=require('../src/services/firestore-subscription-service');

test('normaliza aliases sem permitir plano arbitrário',()=>{
  assert.equal(normalizePlanId('starter'),'essential');assert.equal(normalizePlanId('pro'),'professional');assert.equal(normalizePlanId('premium'),'premium');assert.throws(()=>requirePlan('internal'));
});

test('mapeia estados oficiais do provedor',()=>{
  assert.equal(mapProviderStatus('authorized'),'active');assert.equal(mapProviderStatus('pending'),'pending');assert.equal(mapProviderStatus('paused'),'paused');assert.equal(mapProviderStatus('canceled'),'cancelled');assert.equal(mapProviderStatus('expired'),'expired');
});

test('preserva trial enquanto checkout aguarda pagamento',()=>{
  const now='2026-07-25T12:00:00.000Z',existing={status:'trial',planId:'trial',trialEndsAt:'2026-07-30T12:00:00.000Z'},plan=requirePlan('professional'),provider={id:'sub_1',status:'pending'};
  assert.equal(isTrialActive(existing,new Date(now)),true);const pending=pendingSubscription({existing,plan,provider,now});assert.equal(pending.status,'trialing');assert.equal(pending.pendingPlanId,'professional');assert.equal(pending.mercadoPago.subscriptionId,'sub_1');
});

test('webhook autorizado ativa plano e datas',()=>{
  const patch=providerPatch({id:'sub_1',status:'authorized',payer_id:123,date_created:'2026-07-25T10:00:00Z',next_payment_date:'2026-08-25T10:00:00Z',summarized:{last_charged_date:'2026-07-25T10:01:00Z'}},{planId:'professional',now:'2026-07-25T10:02:00Z',existing:{status:'pending'}});
  assert.equal(patch.status,'active');assert.equal(patch.planId,'professional');assert.equal(patch.lastPaymentDate,'2026-07-25T10:01:00Z');assert.equal(patch.mercadoPago.customerId,'123');assert.equal(computeAccess(patch).canAccessApp,true);
});

test('assinatura vencida mantém acesso e bloqueia somente mutações',()=>{
  for(const status of ['past_due','canceled','expired','inactive']){
    const access=computeAccess({planId:'professional',status});
    assert.equal(access.canAccessApp,true,status);
    assert.equal(access.readOnly,true,status);
    assert.equal(access.canMutate,false,status);
  }
  const internal=computeAccess({planId:'internal',status:'internal',isInternal:true});
  assert.equal(internal.canAccessApp,true);assert.equal(internal.canMutate,true);assert.equal(internal.unlimited,true);
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

test('cliente Mercado Pago restaura valor com a moeda exigida pelo provedor',async()=>{
  let captured;const fetchImpl=async(url,options)=>{captured={url,options};return{ok:true,status:200,text:async()=>JSON.stringify({id:'sub_1',status:'authorized'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl});await service.updateSubscriptionAmount('sub_1',59.9);
  assert.equal(captured.url,'https://api.mercadopago.com/preapproval/sub_1');assert.equal(captured.options.method,'PUT');assert.deepEqual(JSON.parse(captured.options.body),{auto_recurring:{transaction_amount:59.9,currency_id:'BRL'}});
});

test('cliente Mercado Pago cancela assinatura com o estado aceito pelo provedor',async()=>{
  let captured;const fetchImpl=async(url,options)=>{captured={url,options};return{ok:true,status:200,text:async()=>JSON.stringify({id:'sub_1',status:'cancelled'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl});await service.cancelSubscription('sub_1');
  assert.equal(captured.url,'https://api.mercadopago.com/preapproval/sub_1');assert.equal(captured.options.method,'PUT');assert.deepEqual(JSON.parse(captured.options.body),{status:'cancelled'});
});

test('Pix mensal usa plano oficial limitado a bank_transfer/pix',async()=>{
  let captured;const fetchImpl=async(url,options)=>{captured={url,options};return{ok:true,status:201,text:async()=>JSON.stringify({id:'plan_pix_1',init_point:'https://checkout.example/pix'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl}),plan=requirePlan('professional');
  await service.createSubscriptionPlan({businessId:'biz_1',plan,billing:{billingCycle:'monthly',amount:39.9,frequency:1,frequencyType:'months'},backUrl:'https://app.example',operationId:'op_1-plan'});
  assert.equal(captured.url,'https://api.mercadopago.com/preapproval_plan');
  assert.equal(captured.options.headers['X-Idempotency-Key'],'op_1-plan');
  const body=JSON.parse(captured.options.body);
  assert.equal(body.auto_recurring.transaction_amount,39.9);
  assert.deepEqual(body.payment_methods_allowed,{payment_types:[{id:'bank_transfer'}],payment_methods:[{id:'pix'}]});
  assert.equal(body.external_reference,'biz_1:op_1-plan');
});

test('formas de pagamento aceitas são enum fechado e cartão permanece padrão',()=>{
  assert.equal(requirePaymentMethod().id,'card');
  assert.equal(requirePaymentMethod('pix_monthly').providerMode,'dedicated_preapproval_plan');
  assert.throws(()=>requirePaymentMethod('pix'));
  assert.throws(()=>requirePaymentMethod('bank_transfer'));
});

test('webhook só considera cobrança aprovada como sucesso',()=>{
  assert.equal(providerPaymentResult('payment',{id:1,status:'approved'}).successful,true);
  assert.equal(providerPaymentResult('payment',{id:2,status:'pending'}).successful,false);
  assert.equal(providerPaymentResult('subscription_authorized_payment',{payment:{id:3,status:'approved'}}).successful,true);
  assert.equal(providerPaymentResult('subscription_authorized_payment',{status:'processed',payment:{id:4,status:'rejected'}}).successful,false);
});

test('webhook valida valor, empresa, referência, plano e pagador antes de ativar',()=>{
  const index={businessId:'biz_1',chargedPrice:39.9,providerPlanId:'plan_1',expectedExternalReference:'biz_1:op_1-plan'};
  const business={subscription:{mercadoPago:{customerId:'payer_1'}}};
  const provider={id:'sub_1',status:'authorized',preapproval_plan_id:'plan_1',external_reference:'biz_1:op_1-plan',payer_id:'payer_1',metadata:{business_id:'biz_1'},auto_recurring:{transaction_amount:39.9}};
  assert.equal(validateProviderSubscription(provider,index,business).active,true);
  assert.throws(()=>validateProviderSubscription({...provider,auto_recurring:{transaction_amount:49.9}},index,business),error=>error.code==='provider-price-mismatch');
  assert.throws(()=>validateProviderSubscription({...provider,external_reference:'biz_2:op_1-plan'},index,business),error=>error.code==='provider-reference-mismatch');
  assert.throws(()=>validateProviderSubscription({...provider,preapproval_plan_id:'plan_2'},index,business),error=>error.code==='provider-plan-mismatch');
  assert.throws(()=>validateProviderSubscription({...provider,payer_id:'payer_2'},index,business),error=>error.code==='provider-payer-mismatch');
  assert.throws(()=>validateProviderSubscription({...provider,metadata:{business_id:'biz_2'}},index,business),error=>error.code==='provider-business-mismatch');
});
