const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const read=file=>fs.readFileSync(file,'utf8');

test('seletor oferece cartão e Pix mensal sem prometer Pix Automático',()=>{
  const plans=read('js/plans.js');
  assert.match(plans,/Como deseja pagar\?/);
  assert.match(plans,/Cartão de crédito/);
  assert.match(plans,/Pix mensal/);
  assert.match(plans,/Uma nova cobrança pode exigir confirmação a cada mês/);
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

test('Pix mensal usa índice de plano e webhook continua como fonte da verdade',()=>{
  const backend=read('functions/src/index.js'),provider=read('functions/src/services/mercado-pago-service.js'),store=read('functions/src/services/firestore-subscription-service.js');
  assert.match(provider,/payment_methods_allowed/);
  assert.match(provider,/payment_types:\[\{id:'bank_transfer'\}\]/);
  assert.match(provider,/payment_methods:\[\{id:'pix'\}\]/);
  assert.match(backend,/subscriptionPlanIndex/);
  assert.match(store,/bindSubscriptionFromPlan/);
  assert.match(backend,/paymentResult\.successful/);
  assert.doesNotMatch(backend,/success=true.*status:'active'/s);
});

test('clique repetido possui lease e tentativa lógica idempotente',()=>{
  const backend=read('functions/src/index.js');
  assert.match(backend,/billingCheckoutAttempts/);
  assert.match(backend,/CHECKOUT_LEASE_MS/);
  assert.match(backend,/requestHash/);
  assert.match(backend,/status==='completed'/);
});
