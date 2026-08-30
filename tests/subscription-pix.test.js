const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=file=>fs.readFileSync(file,'utf8');

test('seletor oferece cartão e Pix mensal sem prometer Pix Automático',()=>{
  const plans=read('js/plans.js');
  assert.match(plans,/Como deseja pagar\?/);
  assert.match(plans,/Cartão de crédito/);
  assert.match(plans,/Pix mensal/);
  assert.match(plans,/Pagamento manual a cada renovação/);
  assert.match(plans,/uma nova cobrança pode exigir confirmação a cada mês/i);
  assert.doesNotMatch(plans,/Autorize uma vez no seu banco/);
  assert.match(plans,/data-payment-option="pix_monthly"/);
});

test('frontend envia somente identificadores e backend calcula o valor',()=>{
  const context=read('js/firebase/business-context.js'),backend=read('functions/src/index.js');
  assert.match(context,/paymentMethodType/);
  assert.match(context,/operationId:checkoutOperationId/);
  assert.doesNotMatch(context,/transaction_amount|chargedPrice/);
  assert.match(backend,/planBilling\(plan,billingCycle\)/);
  assert.match(backend,/requirePaymentMethod\(request\.data\?\.paymentMethodType\)/);
  assert.doesNotMatch(backend,/request\.data\?\.(?:amount|price|transaction_amount)/);
});

test('Pix mensal usa Orders API guest e webhook continua como fonte da verdade',()=>{
  const backend=read('functions/src/index.js'),provider=read('functions/src/services/mercado-pago-service.js'),pix=read('functions/src/services/pix-billing-service.js');
  assert.match(provider,/request\('\/v1\/orders'/);
  assert.match(provider,/payment_method:\{id:'pix',type:'bank_transfer'\}/);
  assert.doesNotMatch(provider,/payment_method:\{id:'pix',type:'bank_transfer'\},expiration_time/);
  assert.match(provider,/billing_\$\{digest\}/);
  assert.match(provider,/X-Idempotency-Key/);
  assert.match(backend,/billingOrderIndex/);
  assert.match(backend,/\['order','orders'\]\.includes\(event\.type\)/);
  assert.match(backend,/resolvePaymentOrder\(payment\)/);
  assert.match(provider,/notification_url/);
  assert.match(pix,/validatePixOrder/);
  assert.match(pix,/payment_approved/);
  assert.doesNotMatch(backend,/success=true.*status:'active'/s);
});

test('fallback verifica o provider e atualiza o contexto sem logout ou reload',()=>{
  const plans=read('js/plans.js'),context=read('js/firebase/business-context.js'),pix=read('functions/src/services/pix-billing-service.js');
  assert.match(plans,/data-verify-pix-payment/);
  assert.match(plans,/verifyPendingPix/);
  assert.match(context,/response\.data\?\.pix\?\.status==='payment_approved'/);
  assert.match(context,/await refreshBusinessContext\(\)/);
  assert.match(pix,/subscriptionStatus:'active'/);
  assert.match(pix,/markerSnapshot\.exists/);
});

test('clique repetido possui lease e tentativa lógica idempotente',()=>{
  const backend=read('functions/src/index.js');
  assert.match(backend,/billingCheckoutAttempts/);
  assert.match(backend,/CHECKOUT_LEASE_MS/);
  assert.match(backend,/requestHash/);
  assert.match(backend,/status==='pending_payment'/);
  assert.match(backend,/status==='payment_pending'/);
});

test('interface exibe QR, copia e cola e estados sem exigir conta Mercado Pago',()=>{
  const plans=read('js/plans.js'),styles=read('css/plans.css');
  assert.match(plans,/Pagar com Pix/);assert.match(plans,/Copiar código Pix/);assert.match(plans,/Você não precisa ter uma conta Mercado Pago/);assert.match(plans,/Pagamento confirmado/);assert.match(plans,/Pix expirado/);
  assert.match(plans,/watchPixCheckout/);assert.match(styles,/plan-pix-qr/);
});

test('novo Pix usa nova tentativa e revalida o mesmo cupom sem chamar cartão',()=>{
  const plans=read('js/plans.js'),context=read('js/firebase/business-context.js'),backend=read('functions/src/index.js'),coupons=read('functions/src/services/coupon-firestore-service.js');
  assert.match(plans,/previousCheckoutAttemptId:current\.id/);
  assert.match(plans,/couponSnapshot\?\.couponCodeSnapshot/);
  assert.match(context,/previousCheckoutAttemptId/);assert.match(context,/couponCode/);
  assert.match(backend,/reserveCheckoutCoupon/);assert.match(backend,/replacementOperationId/);assert.match(backend,/supersededByOperationId/);
  assert.match(coupons,/quoteRefreshed:\s*true/);
});

test('pending não vira expirado pelo relógio local e falha de criação tem mensagem própria',()=>{
  const plans=read('js/plans.js'),pix=read('functions/src/services/pix-billing-service.js');
  assert.match(plans,/expired=status===["']expired["']/);
  assert.match(plans,/Não foi possível gerar o Pix/);
  assert.match(pix,/absoluteExpiration/);
  assert.doesNotMatch(plans,/Date\.now\(\)\s*[<>]=?\s*[^;]*expiresAt|expiresAt\s*[<>]=?\s*Date\.now\(\)/);
});

test('falha Pix registra somente diagnóstico público no navegador',()=>{
  const plans=read('js/plans.js'),provider=read('functions/src/services/mercado-pago-service.js'),backend=read('functions/src/index.js');
  assert.match(plans,/\[BILLING_PIX_ERROR\]/);assert.match(plans,/billingCode/);
  assert.match(provider,/providerErrorDiagnostics/);assert.match(provider,/mercado-pago-invalid-response/);assert.match(provider,/RETRYABLE_HTTP_STATUSES/);
  assert.match(backend,/\[BILLING_PIX_ERROR\]/);assert.doesNotMatch(backend,/accessToken.*logger|logger.*accessToken/i);
});

test('Pix com cupom grava resgate no mesmo batch e nunca exige subscriptionId',()=>{
  const backend=read('functions/src/index.js'),coupons=read('functions/src/services/coupon-firestore-service.js');
  assert.match(backend,/markCheckout\(\{redemptionId:redemption\.id,internalSubscriptionId:opId,providerOrderId:details\.orderId,providerPaymentId:details\.paymentId,writer:batch\}\);\s*await batch\.commit\(\)/);
  assert.match(coupons,/mercadoPagoSubscriptionId:\s*subscriptionId\s*\|\|\s*null/);
  assert.match(coupons,/internalSubscriptionId:\s*internalSubscriptionId\s*\|\|\s*null/);
});
