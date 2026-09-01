'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const crypto=require('node:crypto');
const {normalizePlanId,requirePlan}=require('../src/services/plan-service');
const {mapProviderStatus,isTrialActive,providerPatch,pendingSubscription,computeAccess}=require('../src/services/subscription-service');
const {signatureManifest,verifyWebhookSignature,eventId}=require('../src/services/webhook-service');
const {mercadoPagoService,billingExternalReference,pixExternalReference,normalizeDeviceSessionId,providerErrorDiagnostics}=require('../src/services/mercado-pago-service');
const {normalizeBillingPayerEmail,providerIndicatesPayerEmailMismatch}=require('../src/services/billing-payer-service');
const {requirePaymentMethod,providerPaymentResult}=require('../src/services/billing-payment-method-service');
const {validateProviderSubscription}=require('../src/services/firestore-subscription-service');
const {absoluteExpiration,orderDetails,pixDetails,validateOrder,validatePixOrder,addBillingPeriod,pendingManualSubscription,pendingPixSubscription}=require('../src/services/pix-billing-service');
const {normalizeManualCardPayment}=require('../src/services/manual-card-service');
const {paymentDeclineMessage,publicCardPaymentDiagnostic}=require('../src/services/card-payment-diagnostic-service');
const {canonicalAttemptStatus,transitionAttempt,attemptStatePatch,isTerminalAttempt,getCurrentBillingAttempt}=require('../src/services/billing-attempt-state-service');

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

test('cliente Mercado Pago envia pagador, referência interna e webhook seguro',async()=>{
  let captured;const fetchImpl=async(url,options)=>{captured={url,options};return{ok:true,status:201,text:async()=>JSON.stringify({id:'sub_1',init_point:'https://checkout.example'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl}),plan=requirePlan('essential');await service.createSubscription({businessId:'biz_1',userId:'uid_adi_festa',billingPayerEmail:'payer.personal@example.com',plan,backUrl:'https://app.example',operationId:'operation_123456789',notificationUrl:'https://southamerica-east1-example.cloudfunctions.net/receiveWebhook?source_news=webhooks'});
  assert.equal(captured.url,'https://api.mercadopago.com/preapproval');assert.equal(captured.options.headers.Authorization,'Bearer secret-token');assert.equal(captured.options.headers['X-Idempotency-Key'],'operation_123456789');const body=JSON.parse(captured.options.body);assert.equal(body.payer_email,'payer.personal@example.com');assert.equal(body.metadata.user_id,'uid_adi_festa');assert.equal(body.metadata.business_id,'biz_1');assert.equal(body.external_reference,billingExternalReference('biz_1','operation_123456789'));assert.match(body.external_reference,/^billing_[a-f0-9]{56}$/);assert.notEqual(body.external_reference,'payer.personal@example.com');assert.equal(body.auto_recurring.transaction_amount,29.9);assert.equal(body.notification_url,'https://southamerica-east1-example.cloudfunctions.net/receiveWebhook?source_news=webhooks');
});

test('assinatura recorrente envia Device ID somente no header oficial',async()=>{
  let captured;const fetchImpl=async(url,options)=>{captured={url,options};return{ok:true,status:201,text:async()=>JSON.stringify({id:'sub_device',init_point:'https://checkout.example'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl});await service.createSubscription({businessId:'biz_1',userId:'uid_1',billingPayerEmail:'payer@example.com',plan:requirePlan('professional'),backUrl:'https://app.example',operationId:'operation_device_1234',deviceSessionId:'device-session_123456789'});
  assert.equal(captured.options.headers['X-meli-session-id'],'device-session_123456789');assert.doesNotMatch(captured.options.body,/device-session_123456789/);assert.equal(normalizeDeviceSessionId(''),null);assert.throws(()=>normalizeDeviceSessionId('bad id'));
});

test('recusa não inventa período pago nem data de renovação',()=>{
  const patch=providerPatch({id:'sub_rejected',status:'cancelled',date_created:'2026-08-29T22:00:00Z',next_payment_date:'2026-09-29T22:00:00Z'},{planId:'premium',now:'2026-08-30T02:00:00Z',existing:{status:'pending',hasPaidSubscription:false,currentPeriodEnd:null}});
  assert.equal(patch.status,'cancelled');assert.equal(patch.currentPeriodEnd,null);assert.equal(patch.nextBillingDate,null);assert.equal(patch.hasPaidSubscription,false);
});

test('máquina de estados fecha recusa e impede regressão terminal',()=>{
  assert.deepEqual(canonicalAttemptStatus({providerStatus:'cancelled',paymentStatus:'rejected',statusDetail:'cc_rejected_high_risk'}),{status:'rejected',reason:'cc_rejected_high_risk'});
  assert.equal(attemptStatePatch({currentStatus:'pending_payment',providerStatus:'cancelled',paymentStatus:'rejected',statusDetail:'cc_rejected_high_risk',now:'2026-08-30T03:00:00.000Z'}).status,'rejected');
  assert.equal(isTerminalAttempt('rejected'),true);
  assert.deepEqual(transitionAttempt('rejected','pending_payment'),{allowed:false,status:'rejected',reason:'terminal_state_is_immutable'});
  assert.equal(attemptStatePatch({currentStatus:'approved',providerStatus:'pending',now:'2026-08-30T04:00:00.000Z'}).status,'approved');
});

test('checkout atual ignora terminais e completed legado',()=>{
  const current=getCurrentBillingAttempt([{id:'old',status:'completed',checkoutUrl:'https://old',updatedAt:'2026-08-29T10:00:00Z'},{id:'rejected',status:'rejected',checkoutUrl:'https://rejected',updatedAt:'2026-08-29T12:00:00Z'},{id:'valid',status:'pending_payment',checkoutUrl:'https://valid',updatedAt:'2026-08-29T11:00:00Z'}]);
  assert.equal(current.id,'valid');assert.equal(getCurrentBillingAttempt([{status:'cancelled',checkoutUrl:'x'}]),null);
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

test('consulta faturas da preapproval sem expor credencial',async()=>{
  let captured;const fetchImpl=async(url,options)=>{captured={url,options};return{ok:true,status:200,text:async()=>JSON.stringify({paging:{total:1},results:[{id:10,payment:{id:20,status:'rejected',status_detail:'cc_rejected_high_risk'}}]})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl}),result=await service.searchAuthorizedPayments('sub_1',{limit:50});
  assert.equal(captured.url,'https://api.mercadopago.com/authorized_payments/search?preapproval_id=sub_1&limit=10&offset=0');assert.equal(captured.options.method,'GET');assert.equal(result.results[0].payment.id,20);
});

test('recusa de cartão preserva status_detail e mensagem segura',()=>{
  const diagnostic=publicCardPaymentDiagnostic({id:175359087983,status:'rejected',status_detail:'cc_rejected_high_risk',payment_method_id:'visa',payment_type_id:'credit_card',issuer_id:'25',transaction_amount:51.94,date_created:'2026-08-29T22:00:33-03:00'},{id:7031380329,preapproval_id:'sub_1'});
  assert.equal(diagnostic.paymentId,'175359087983');assert.equal(diagnostic.authorizedPaymentId,'7031380329');assert.equal(diagnostic.statusDetail,'cc_rejected_high_risk');assert.equal(diagnostic.rejected,true);assert.match(diagnostic.message,/análise de segurança/i);assert.equal('card' in diagnostic,false);assert.match(paymentDeclineMessage('cc_rejected_insufficient_amount'),/limite disponível/i);assert.match(paymentDeclineMessage('cc_rejected_call_for_authorize'),/banco emissor/i);
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

test('cartão mensal usa Orders API, tokenização, Device ID e 3DS on fraud risk',async()=>{
  let captured;const fetchImpl=async(url,options)=>{captured={url,options};return{ok:true,status:201,text:async()=>JSON.stringify({id:'order_card_1',status:'action_required',status_detail:'pending_challenge'})}};
  const service=mercadoPagoService({accessToken:'secret-token',fetchImpl}),payment=normalizeManualCardPayment({token:'token_card_1234567890',payment_method_id:'visa',issuer_id:'25',installments:1,payer:{identification:{type:'CPF',number:'123.456.789-09'}}});
  await service.createCardOrder({businessId:'biz_1',email:'payer@example.com',plan:requirePlan('premium'),billing:{amount:50.34},operationId:'op_card_123456789012',payment,notificationUrl:'https://southamerica-east1-example.cloudfunctions.net/receiveWebhook?source_news=webhooks',deviceSessionId:'device-session_123456789'});
  const body=JSON.parse(captured.options.body),method=body.transactions.payments[0].payment_method;
  assert.equal(captured.url,'https://api.mercadopago.com/v1/orders');assert.equal(captured.options.headers['X-meli-session-id'],'device-session_123456789');assert.equal(captured.options.headers['X-Idempotency-Key'],'op_card_123456789012');assert.equal(body.total_amount,'50.34');assert.equal(body.external_reference,billingExternalReference('biz_1','op_card_123456789012'));assert.deepEqual(body.config.online.transaction_security,{validation:'on_fraud_risk',liability_shift:'required'});assert.deepEqual(method,{id:'visa',type:'credit_card',token:'token_card_1234567890',installments:1,issuer_id:'25'});assert.deepEqual(body.payer,{email:'payer@example.com',identification:{type:'CPF',number:'12345678909'}});assert.equal('transaction_amount' in body,false);
});

test('cartão mensal valida challenge, aprovação e divergências sem confiar no frontend',()=>{
  const base={id:'order_card_1',status:'action_required',status_detail:'pending_challenge',external_reference:'billing_ref',total_amount:'50.34',currency:'BRL',transactions:{payments:[{id:'pay_card_1',amount:'50.34',payment_method:{id:'visa',type:'credit_card',transaction_security:{url:'https://www.mercadopago.com/auth/challenge',status:'pending'}}}]}};
  const index={providerOrderId:'order_card_1',paymentMethodType:'card_monthly',paymentMethodId:'visa',chargedPrice:50.34,expectedExternalReference:'billing_ref'};
  const challenge=validateOrder(base,index);assert.equal(challenge.status,'challenge');assert.equal(challenge.challengeUrl,'https://www.mercadopago.com/auth/challenge');
  const approved={...base,status:'processed',status_detail:'accredited'};assert.equal(validateOrder(approved,index).status,'approved');
  assert.throws(()=>validateOrder({...base,external_reference:'other'},index),error=>error.code==='provider-reference-mismatch');assert.throws(()=>validateOrder({...base,transactions:{payments:[{...base.transactions.payments[0],payment_method:{id:'master',type:'credit_card'}}]}},index),error=>error.code==='provider-payment-method-mismatch');
  const pending=pendingManualSubscription({status:'inactive',planId:'essential'},{planId:'premium',billingCycle:'monthly',paymentMethodType:'card_monthly',operationId:'op',providerOrderId:'order_card_1'},'2026-08-31T00:00:00Z');assert.equal(pending.pendingPaymentMethodType,'card_monthly');assert.equal(pending.billingStrategy,'manual_card');assert.equal(orderDetails(base,'card_monthly').transactionSecurityStatus,'pending');
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
  assert.equal(requirePaymentMethod('card_monthly').providerMode,'card_order_3ds');
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
  assert.doesNotThrow(()=>validateProviderSubscription({...provider,status:'cancelled',payer_id:'payer_antigo'},index,business),'checkout antigo terminal pode ser fechado sem assumir a identidade do pagador atual');
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
