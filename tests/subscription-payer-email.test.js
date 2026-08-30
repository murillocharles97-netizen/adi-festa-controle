"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (file) => fs.readFileSync(file, "utf8");

test("checkout de cartão coleta e envia billingPayerEmail editável", () => {
  const plans = read("js/plans.js"),
    context = read("js/firebase/business-context.js");
  assert.match(plans, /E-mail do pagador/);
  assert.match(plans, /data-billing-payer-email/);
  assert.match(plans, /type="email"/);
  assert.match(plans, /Ele pode ser diferente do e-mail da sua empresa/);
  assert.match(plans, /billingPayerEmail/);
  assert.match(context, /billingPayerEmail:paymentMethodType==='card'\?billingPayerEmail:null/);
});

test("Pix não recebe identidade de pagador do cartão", () => {
  const context = read("js/firebase/business-context.js"),
    backend = read("functions/src/index.js");
  assert.match(context, /paymentMethodType==='card'\?billingPayerEmail:null/);
  assert.match(backend, /createPixOrder\(\{businessId,email:context\.email/);
  assert.match(backend, /paymentMethod\.id==='card'\?normalizeBillingPayerEmail/);
});

test("tentativa inclui pagador no hash e checkout antigo não é reutilizado", () => {
  const backend = read("functions/src/index.js");
  assert.match(backend, /requestHash=sha\(JSON\.stringify\(\{[^}]*billingPayerEmail/);
  assert.match(backend, /String\(intentData\.billingPayerEmail\|\|''\)===billingPayerEmail/);
  assert.match(backend, /supersedePendingCardCheckout/);
  assert.match(backend, /cancelSubscription\(subscriptionId\)/);
  assert.match(backend, /status:'superseded'/);
});

test("cupom é revalidado na nova tentativa e não vira autorização", () => {
  const backend = read("functions/src/index.js");
  assert.match(backend, /effectiveCouponCode=couponCode\|\|cardReplacement\?\.couponCode/);
  assert.match(backend, /reserveCheckoutCoupon\(\{quoteId,couponCode:effectiveCouponCode/);
  assert.doesNotMatch(backend, /findBusinessByEmail/);
});

test("webhook resolve empresa pelo índice e só salva e-mail após ativação", () => {
  const providerStore = read(
    "functions/src/services/firestore-subscription-service.js",
  );
  assert.match(providerStore, /subscriptionIndex\/\$\{subscriptionId\}/);
  assert.match(providerStore, /index\.businessId/);
  assert.match(
    providerStore,
    /if \(active && index\.billingPayerEmail\)[\s\S]*billingProfile\.billingPayerEmail/,
  );
  assert.doesNotMatch(providerStore, /payer_email[^\n]*business/i);
});

test("erro do provedor oferece alteração do e-mail sem expor erro técnico", () => {
  const backend = read("functions/src/index.js"),
    plans = read("js/plans.js");
  assert.match(backend, /billing_payer_email_mismatch/);
  assert.match(backend, /change_billing_payer_email/);
  assert.match(
    plans,
    /O e-mail usado no Mercado Pago é diferente do e-mail informado para cobrança/,
  );
  assert.match(plans, /Alterar e-mail do pagador/);
  assert.match(plans, /consumePayerMismatchReturn/);
  assert.match(plans, /subscription\[-_ \]invalid\[-_ \]user/);
});
