const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const adminSdk = require("../../functions/node_modules/firebase-admin");
const {
  mercadoPagoService,
} = require("../../functions/src/services/mercado-pago-service");
const {
  firestoreSubscriptionService,
} = require("../../functions/src/services/firestore-subscription-service");
const {
  verifyWebhookSignature,
} = require("../../functions/src/services/webhook-service");

const PROJECT_ID = "adi-festa-variations-test";
const BUSINESS_ID = "subscription-e2e-company";
const WEBHOOK_SECRET = "local-e2e-webhook-secret";

function signature(dataId, requestId, timestamp) {
  const manifest = `id:${dataId.toLowerCase()};request-id:${requestId};ts:${timestamp};`;
  return crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(manifest)
    .digest("hex");
}

(async () => {
  adminSdk.initializeApp({ projectId: PROJECT_ID });
  const admin = adminSdk.firestore();
  const businessRef = admin.doc(`businesses/${BUSINESS_ID}`);
  const before = (await businessRef.get()).data();
  const subscriptionId = before?.subscription?.mercadoPago?.subscriptionId;
  assert.ok(subscriptionId, "assinatura pendente não encontrada no emulador");

  const requestId = `e2e-${Date.now()}`;
  const timestamp = Math.floor(Date.now() / 1000);
  const xSignature = `ts=${timestamp},v1=${signature(subscriptionId, requestId, timestamp)}`;
  assert.equal(
    verifyWebhookSignature({
      secret: WEBHOOK_SECRET,
      xSignature,
      xRequestId: requestId,
      dataId: subscriptionId,
    }),
    true,
  );
  const provider = await mercadoPagoService({
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN_TEST,
  }).getSubscription(subscriptionId);
  assert.equal(provider.status, "authorized");
  const store = firestoreSubscriptionService(admin);
  await store.applyProviderSubscription(provider, {
    source: "webhook-e2e",
    eventId: requestId,
  });
  await store.applyProviderSubscription(provider, {
    source: "webhook-e2e-retry",
    eventId: requestId,
  });

  const business = (await businessRef.get()).data();
  assert.equal(business.subscription.status, "active");
  assert.equal(business.subscription.planId, "professional");
  assert.equal(business.subscription.discount.couponCodeSnapshot, "E2E40");
  assert.equal(business.subscription.discount.discountedPrice, 29.94);

  const index = (
    await admin.doc(`subscriptionIndex/${subscriptionId}`).get()
  ).data();
  const redemption = (
    await admin.doc(`couponRedemptions/${index.couponRedemptionId}`).get()
  ).data();
  const coupon = (await admin.doc(`adminCoupons/${redemption.couponId}`).get()).data();
  assert.equal(redemption.status, "active");
  assert.equal(coupon.redemptionCount, 1);
  assert.equal(coupon.reservedCount, 0);

  const canceledProvider = await mercadoPagoService({
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN_TEST,
  }).cancelSubscription(subscriptionId);
  const canceled = await store.applyProviderSubscription(canceledProvider, {
    source: "cancel-e2e",
    eventId: `${requestId}-cancel`,
  });
  assert.equal(canceled.subscription.status, "cancelled");
  const canceledRedemption = (
    await admin.doc(`couponRedemptions/${index.couponRedemptionId}`).get()
  ).data();
  const canceledCoupon = (
    await admin.doc(`adminCoupons/${redemption.couponId}`).get()
  ).data();
  assert.equal(canceledRedemption.status, "canceled");
  assert.equal(canceledCoupon.activeSubscriptions, 0);

  console.log(
    JSON.stringify({
      webhookSignature: "valid",
      duplicateWebhook: "idempotent",
      subscriptionStatus: business.subscription.status,
      planId: business.subscription.planId,
      chargedPrice: business.subscription.discount.discountedPrice,
      couponRedemptions: coupon.redemptionCount,
      cancellationStatus: canceled.subscription.status,
      activeDiscountsAfterCancellation: canceledCoupon.activeSubscriptions,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
