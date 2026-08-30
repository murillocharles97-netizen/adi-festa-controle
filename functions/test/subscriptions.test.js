'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {normalizePlanId,requirePlan}=require('../src/services/plan-service');
const {mapProviderStatus,isTrialActive,providerPatch,pendingSubscription,computeAccess}=require('../src/services/subscription-service');
const {signatureManifest,verifyWebhookSignature,eventId}=require('../src/services/webhook-service');
const {mercadoPagoService,billingExternalReference,pixExternalReference,providerErrorDiagnostics}=require('../src/services/mercado-pago-service');
const {normalizeBillingPayerEmail,providerIndicatesPayerEmailMismatch}=require('../src/services/billing-payer-service');
const {requirePaymentMethod,providerPaymentResult}=require('../src/services/billing-payment-method-service');
const {validateProviderSubscription}=require('../src/services/firestore-subscription-service');
const {absoluteExpiration,pixDetails,validatePixOrder,addBillingPeriod,pendingPixSubscription}=require('../src/services/pix-billing-service');

test('normaliza aliases sem permitir plano arbitrário',()=>{
  assert.equal(normalizePlanId('starter'),'essential');assert.equal(normalizePlanId('pro'),'professional');assert.equal(normalizePlanId('premium'),'premium');assert.throws(()=>requirePlan('internal'));
});

test('mapeia estados oficiais do provedor',()=>{
  assert.equal(mapProviderStatus('authorized'),'active');assert.equal(mapProviderStatus('pending'),'pending');assert.equal(mapProviderStatus('paused'),'paused');assert.equal(mapProviderStatus('canceled'),'cancelled');assert.equal(mapProviderStatus('expired'),'expired');
});

test('status canônico ativo prevalece sobre alias legado divergente',()=>{
  assert.equal(computeAccess({planId:'professional',status:'active',subscriptionStatus:'trialing'}).status,'active');
  assert.equal(computeAccess({planId:'professional',status:'active',subscriptionStatus:'trialing'}).canMutate,true);
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

test('e-mail de cobrança é validado e independente do login Adi Festa',()=>{
  assert.equal(normalizeBillingPayerEmail('  PAGADOR.Pessoal@Gmail.com '),'pagador.pessoal@gmail.com');
  assert.throws(()=>normalizeBillingPayerEmail('sem-arroba'),error=>error.code==='invalid-billing-payer-email');
  assert.throws(()=>normalizeBillingPayerEmail(`a@${'x'.repeat(252)}.com`),error=>error.code==='invalid-billing-payer-email');
});

test('erro subscription-invalid-user oferece troca do e-mail do pagador',()=>{
  assert.equal(providerIndicatesPayerEmailMismatch({providerErrorCode:'subscription-invalid-user'}),true);
  assert.equal(providerIndicatesPayerEmailMismatch({providerMessage:'payer email is different'}),true);
  assert.equal(providerIndicatesPayerEmailMismatch({providerMessage:'temporary unavailable'}),false);
});

test('cliente Mercado Pago envia pagador informado e referência interna opaca',async()=>{
  let captured;const fetchImpl=async(url,options)=>{captured={url,options};return{ok:true,status:201,text:async()=>JSON.stringify({id:'sub_1',init_point:'https://checkout.example'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl}),plan=requirePlan('essential');await service.createSubscription({businessId:'biz_1',userId:'uid_adi_festa',billingPayerEmail:'payer.personal@example.com',plan,backUrl:'https://app.example',operationId:'operation_123456789'});
  assert.equal(captured.url,'https://api.mercadopago.com/preapproval');assert.equal(captured.options.headers.Authorization,'Bearer secret-token');assert.equal(captured.options.headers['X-Idempotency-Key'],'operation_123456789');const body=JSON.parse(captured.options.body);assert.equal(body.payer_email,'payer.personal@example.com');assert.equal(body.metadata.user_id,'uid_adi_festa');assert.equal(body.metadata.business_id,'biz_1');assert.equal(body.external_reference,billingExternalReference('biz_1','operation_123456789'));assert.match(body.external_reference,/^billing_[a-f0-9]{56}$/);assert.notEqual(body.external_reference,'payer.personal@example.com');assert.equal(body.auto_recurring.transaction_amount,29.9);assert.equal('notification_url' in body,false);
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

test('Pix mensal guest usa Orders API e retorna QR sem redirecionamento',async()=>{
  let captured;const fetchImpl=async(url,options)=>{captured={url,options};return{ok:true,status:201,text:async()=>JSON.stringify({id:'order_pix_1',status:'action_required'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl}),plan=requirePlan('professional');
  await service.createPixOrder({businessId:'biz_1',email:'buyer@example.com',plan,billing:{billingCycle:'monthly',amount:39.9},operationId:'op_1234567890123456',notificationUrl:'https://southamerica-east1-example.cloudfunctions.net/receiveWebhook?source_news=webhooks'});
  assert.equal(captured.url,'https://api.mercadopago.com/v1/orders');
  assert.equal(captured.options.headers['X-Idempotency-Key'],'op_1234567890123456');
  const body=JSON.parse(captured.options.body);
  assert.equal(body.total_amount,'39.90');assert.equal(body.transactions.payments[0].amount,'39.90');
  assert.deepEqual(body.transactions.payments[0].payment_method,{id:'pix',type:'bank_transfer'});
  assert.equal(body.external_reference,pixExternalReference('biz_1','op_1234567890123456'));assert.match(body.external_reference,/^billing_[a-f0-9]{56}$/);assert.equal(body.external_reference.length,64);assert.equal(body.payer.email,'buyer@example.com');assert.equal('init_point' in body,false);
  assert.equal(body.notification_url,'https://southamerica-east1-example.cloudfunctions.net/receiveWebhook?source_news=webhooks');
  assert.equal('expiration_time' in body.transactions.payments[0],false,'Orders API deve aplicar a validade padrão de 24 horas');
});

test('Orders API ignora notification_url insegura em vez de enviar callback HTTP',async()=>{
  let captured;const fetchImpl=async(url,options)=>{captured={url,options};return{ok:true,status:201,text:async()=>JSON.stringify({id:'order_pix_2'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl});
  await service.createPixOrder({businessId:'biz_1',email:'buyer@example.com',plan:requirePlan('professional'),billing:{amount:19.96},operationId:'op_1234567890123457',notificationUrl:'http://localhost/webhook'});
  assert.equal('notification_url' in JSON.parse(captured.options.body),false);
});

test('cliente Mercado Pago preserva erro HTTP sanitizado sem expor token',async()=>{
  const fetchImpl=async()=>({ok:false,status:400,headers:{get:name=>name==='x-request-id'?'request-safe-1':null},text:async()=>JSON.stringify({code:'invalid_request',message:'payer.email is invalid',cause:[{code:'bad_field',description:'Invalid payer email'}]})});
  const service=mercadoPagoService({accessToken:'never-log-this-token',fetchImpl});
  await assert.rejects(()=>service.createPixOrder({businessId:'biz_1',email:'bad',plan:requirePlan('professional'),billing:{amount:19.96},operationId:'op_1234567890123456'}),error=>{
    const diagnostic=providerErrorDiagnostics(error);
    assert.equal(error.code,'mercado-pago-error');assert.equal(diagnostic.httpStatus,400);assert.equal(diagnostic.providerErrorCode,'invalid_request');assert.equal(diagnostic.providerCauses[0].code,'bad_field');assert.equal(diagnostic.requestId,'request-safe-1');assert.doesNotMatch(JSON.stringify(diagnostic),/never-log-this-token/);return true;
  });
});

test('resposta não JSON do Orders API é recuperada por retry idempotente',async()=>{
  let calls=0;const fetchImpl=async()=>{calls+=1;return calls===1?{ok:true,status:201,headers:{get:()=>null},text:async()=>'<html>upstream reset</html>'}:{ok:true,status:201,headers:{get:()=>null},text:async()=>JSON.stringify({id:'order_retry',status:'action_required'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl}),order=await service.createPixOrder({businessId:'biz_1',email:'buyer@example.com',plan:requirePlan('professional'),billing:{amount:19.96},operationId:'op_1234567890123456'});
  assert.equal(calls,2);assert.equal(order.id,'order_retry');
});

test('erro 503 é repetido com a mesma chave de idempotência',async()=>{
  const seen=[];let calls=0;const fetchImpl=async(url,options)=>{seen.push(options.headers['X-Idempotency-Key']);calls+=1;return calls===1?{ok:false,status:503,headers:{get:()=>null},text:async()=>JSON.stringify({message:'temporary unavailable'})}:{ok:true,status:201,headers:{get:()=>null},text:async()=>JSON.stringify({id:'order_after_retry'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl}),order=await service.createPixOrder({businessId:'biz_1',email:'buyer@example.com',plan:requirePlan('professional'),billing:{amount:19.96},operationId:'op_1234567890123456'});
  assert.equal(order.id,'order_after_retry');assert.deepEqual(seen,['op_1234567890123456','op_1234567890123456']);
});

test('formas de pagamento aceitas são enum fechado e cartão permanece padrão',()=>{
  assert.equal(requirePaymentMethod().id,'card');
  assert.equal(requirePaymentMethod('pix_monthly').providerMode,'guest_pix_order');
  assert.throws(()=>requirePaymentMethod('pix'));
  assert.throws(()=>requirePaymentMethod('bank_transfer'));
});

test('order Pix é validada por valor, referência, moeda e método antes de ativar',()=>{
  const order={id:'order_1',status:'processed',status_detail:'accredited',external_reference:'billing:biz_1:op_1',total_amount:'39.90',transactions:{payments:[{id:'pay_1',amount:'39.90',currency_id:'BRL',payment_method:{id:'pix',type:'bank_transfer',qr_code:'code'}}]}};
  const index={providerOrderId:'order_1',chargedPrice:39.9,expectedExternalReference:'billing:biz_1:op_1'};
  assert.equal(validatePixOrder(order,index).status,'approved');
  assert.throws(()=>validatePixOrder({...order,external_reference:'billing:biz_2:op_1'},index),error=>error.code==='provider-reference-mismatch');
  assert.throws(()=>validatePixOrder({...order,total_amount:'40.90',transactions:{payments:[{...order.transactions.payments[0],amount:'40.90'}]}},index),error=>error.code==='provider-price-mismatch');
  assert.throws(()=>validatePixOrder({...order,transactions:{payments:[{...order.transactions.payments[0],payment_method:{id:'visa',type:'credit_card'}}]}},index),error=>error.code==='provider-payment-method-mismatch');
});

test('QR pendente é transitório e período mensal respeita fim de mês',()=>{
  const order={id:'order_1',status:'action_required',status_detail:'waiting_transfer',transactions:{payments:[{id:'pay_1',amount:'29.90',expiration_time:'2026-08-26T12:00:00Z',payment_method:{id:'pix',type:'bank_transfer',qr_code:'copy-paste',qr_code_base64:'base64',ticket_url:'https://ticket'}}]}};
  const details=pixDetails(order);assert.equal(details.status,'pending');assert.equal(details.qrCode,'copy-paste');assert.equal(details.qrCodeBase64,'base64');
  assert.equal(addBillingPeriod('2026-01-31T12:00:00.000Z','monthly'),'2026-02-28T12:00:00.000Z');
  const pending=pendingPixSubscription({status:'trialing',planId:'trial',trialEndsAt:'2026-09-01T00:00:00Z'},{planId:'professional',billingCycle:'monthly',operationId:'op',providerOrderId:'order_1'},'2026-08-25T00:00:00Z');assert.equal(pending.status,'trialing');assert.equal(pending.pendingPlanId,'professional');assert.equal(pending.billingStrategy,'guest_pix_manual');
});

test('duração ISO do provedor nunca é tratada como data absoluta no navegador',()=>{
  assert.equal(absoluteExpiration('PT24H'),null);
  assert.equal(absoluteExpiration('2026-08-29T18:00:00.000Z'),'2026-08-29T18:00:00.000Z');
  const details=pixDetails({id:'order_1',status:'action_required',transactions:{payments:[{expiration_time:'PT24H',payment_method:{id:'pix',type:'bank_transfer',qr_code:'copy'}}]}});
  assert.equal(details.status,'pending');assert.equal(details.expiresAt,null);
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

test('webhook associa por índice da empresa e não pelo e-mail do pagador',()=>{
  const reference=billingExternalReference('biz_empresa_a','operation_123456789'),index={businessId:'biz_empresa_a',chargedPrice:39.9,expectedExternalReference:reference,billingPayerEmail:'pagador-b@example.com'};
  const provider={id:'sub_1',status:'authorized',external_reference:reference,payer_id:'payer_b',payer_email:'pagador-b@example.com',metadata:{business_id:'biz_empresa_a'},auto_recurring:{transaction_amount:39.9}};
  const validation=validateProviderSubscription(provider,index,{subscription:{mercadoPago:{customerId:null}}});
  assert.equal(validation.active,true);
  assert.throws(()=>validateProviderSubscription({...provider,metadata:{business_id:'biz_empresa_b'}},index,{}),error=>error.code==='provider-business-mismatch');
});
