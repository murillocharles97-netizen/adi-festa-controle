const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (path) => fs.readFileSync(path, "utf8");

test("publica painel, rota e cache dos cupons", () => {
  const html = read("index.html"),
    router = read("js/router.js"),
    worker = read("service-worker.js");
  assert.match(html, /coupons-admin\.js/);
  assert.match(html, /coupons\.css/);
  assert.match(router, /'cupons'/);
  assert.match(worker, /adi-festa-v71-subscription-coupons/);
  assert.match(worker, /coupons-admin\.js/);
});

test("tela de planos valida apenas ao aplicar e envia somente quote segura", () => {
  const plans = read("js/plans.js"),
    context = read("js/firebase/business-context.js");
  assert.match(plans, /data-apply-coupon/);
  assert.match(plans, /validateCoupon/);
  assert.match(context, /quoteId/);
  assert.doesNotMatch(context, /discountValue|discountedPrice|originalPrice/);
  assert.doesNotMatch(plans, /onSnapshot|setInterval/);
});

test("admin usa Functions protegidas e não acessa Firestore diretamente", () => {
  const admin = read("js/coupons-admin.js");
  for (const callable of [
    "listAdminCoupons",
    "saveAdminCoupon",
    "actionAdminCoupon",
    "duplicateAdminCoupon",
  ])
    assert.match(admin, new RegExp(callable));
  assert.doesNotMatch(admin, /getDocs|setDoc|onSnapshot|collection\(/);
  assert.match(admin, /businessId:\s*["']adi-festa["']/);
});

test("backend ignora preço do navegador e usa catálogo oficial", () => {
  const backend = read("functions/src/index.js");
  assert.match(backend, /planBilling\(plan,billingCycle\)/);
  assert.match(backend, /reserveQuote/);
  assert.doesNotMatch(backend, /request\.data\?\.(price|amount|discountValue)/);
});
