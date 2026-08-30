const assert = require("node:assert/strict");
const adminSdk = require("../../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signOut,
} = require("firebase/auth");
const {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} = require("firebase/functions");
const {
  mercadoPagoService,
  billingExternalReference,
} = require("../../functions/src/services/mercado-pago-service");
const {
  couponFirestoreService,
} = require("../../functions/src/services/coupon-firestore-service");
const {
  getPlan,
  planBilling,
} = require("../../functions/src/services/plan-service");
const {
  pendingSubscription,
} = require("../../functions/src/services/subscription-service");

const PROJECT_ID = "adi-festa-variations-test";
const BUSINESS_ID = "subscription-e2e-company";
const BUYER_EMAIL = "test_user_9018643121922567141@testuser.com";

(async () => {
  adminSdk.initializeApp({ projectId: PROJECT_ID });
  const admin = adminSdk.firestore();
  const app = initializeApp(
    { apiKey: "emulator-key", projectId: PROJECT_ID },
    "subscription-provider-e2e",
  );
  const auth = getAuth(app);
  const functions = getFunctions(app, "southamerica-east1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", {
    disableWarnings: true,
  });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);

  const internal = await createUserWithEmailAndPassword(
    auth,
    "internal-subscription-e2e@example.test",
    "Secure123!",
  );
  await admin.doc("businesses/adi-festa").set({
    id: "adi-festa",
    ownerId: internal.user.uid,
    active: true,
    subscription: { planId: "internal", status: "active" },
  });
  await admin.doc(`users/${internal.user.uid}`).set({
    uid: internal.user.uid,
    businessId: "adi-festa",
    email: "internal-subscription-e2e@example.test",
    role: "owner",
    active: true,
  });
  const saveCoupon = httpsCallable(functions, "saveAdminCoupon");
  await saveCoupon({
    businessId: "adi-festa",
    coupon: {
      name: "E2E 40 por cento",
      code: "E2E40",
      category: "promotional",
      description: "Validação isolada do provedor",
      discountType: "percentage",
      discountValue: 40,
      durationType: "billing_cycles",
      billingCycles: 3,
      allowedPlanIds: ["professional"],
      allowedBillingCycles: ["monthly"],
      validFrom: "2026-01-01T00:00:00.000Z",
      validUntil: "2027-01-01T00:00:00.000Z",
      maxRedemptions: 2,
      maxUsesPerBusiness: 1,
      maxUsesPerUser: 1,
      newSubscribersOnly: false,
      allowUpgrade: true,
      allowDowngrade: false,
      firstPaidSubscriptionOnly: false,
      status: "active",
    },
  });
  await signOut(auth);

  const customer = await createUserWithEmailAndPassword(
    auth,
    BUYER_EMAIL,
    "Secure123!",
  );
  await admin.doc(`businesses/${BUSINESS_ID}`).set({
    id: BUSINESS_ID,
    ownerId: customer.user.uid,
    active: true,
    createdAt: "2026-08-02T00:00:00.000Z",
    subscription: { planId: "trial", status: "trial" },
  });
  await admin.doc(`users/${customer.user.uid}`).set({
    uid: customer.user.uid,
    businessId: BUSINESS_ID,
    billingPayerEmail: BUYER_EMAIL,
    role: "owner",
    active: true,
  });

  const validateCoupon = httpsCallable(functions, "validateCoupon");
  const quote = (
    await validateCoupon({
      businessId: BUSINESS_ID,
      couponCode: "E2E40",
      planId: "professional",
      billingCycle: "monthly",
    })
  ).data;
  assert.equal(quote.originalPrice, 49.9);
  assert.equal(quote.discountedPrice, 29.94);

  const operationId = `e2e_${Date.now()}_subscription`;
  const coupons = couponFirestoreService(admin);
  const businessRef = admin.doc(`businesses/${BUSINESS_ID}`);
  const businessBefore = (await businessRef.get()).data();
  const context = {
    uid: customer.user.uid,
    email: BUYER_EMAIL,
    businessId: BUSINESS_ID,
    business: businessBefore,
    businessRef,
  };
  const redemption = await coupons.reserveQuote({
    quoteId: quote.quoteId,
    context,
    planId: "professional",
    billingCycle: "monthly",
  });
  const plan = getPlan("professional");
  const officialBilling = planBilling(plan, "monthly");
  const billing = { ...officialBilling, amount: redemption.discountedPrice };
  const provider = await mercadoPagoService({
    accessToken: process.env.MERCADO_PAGO_ACCESS_TOKEN_TEST,
  }).createSubscription({
    businessId: BUSINESS_ID,
    userId: customer.user.uid,
    email: BUYER_EMAIL,
    plan,
    billing,
    backUrl: "https://murillocharles97-netizen.github.io/adi-festa-controle/#/planos",
    operationId,
    coupon: {
      couponId: redemption.couponId,
      redemptionId: redemption.id,
      quoteId: quote.quoteId,
    },
  });
  assert.match(provider.init_point, /^https:\/\//);
  const now = new Date().toISOString();
  const subscription = pendingSubscription({
    existing: businessBefore.subscription || {},
    plan,
    provider,
    now,
    billingCycle: "monthly",
    discount: redemption.discountSnapshot,
    billingPayerEmail: BUYER_EMAIL,
  });
  const batch = admin.batch();
  batch.update(businessRef, {
    subscription,
    updatedAt: adminSdk.firestore.FieldValue.serverTimestamp(),
  });
  batch.set(
    admin.doc(`businesses/${BUSINESS_ID}/subscriptionIntents/${provider.id}`),
    {
      businessId: BUSINESS_ID,
      requestedBy: customer.user.uid,
      operationId,
      planId: plan.id,
      billingCycle: "monthly",
      officialPrice: officialBilling.amount,
      chargedPrice: billing.amount,
      billingPayerEmail: BUYER_EMAIL,
      expectedExternalReference: billingExternalReference(BUSINESS_ID, operationId),
      quoteId: quote.quoteId,
      couponRedemptionId: redemption.id,
      status: "pending",
      providerStatus: String(provider.status || "pending"),
      subscriptionId: String(provider.id),
      checkoutUrl: String(provider.init_point),
      createdAt: now,
      updatedAt: now,
    },
  );
  batch.set(admin.doc(`subscriptionIndex/${provider.id}`), {
    businessId: BUSINESS_ID,
    ownerId: customer.user.uid,
    planId: plan.id,
    billingCycle: "monthly",
    officialPrice: officialBilling.amount,
    chargedPrice: billing.amount,
    billingPayerEmail: BUYER_EMAIL,
    expectedExternalReference: billingExternalReference(BUSINESS_ID, operationId),
    quoteId: quote.quoteId,
    couponRedemptionId: redemption.id,
    discountSnapshot: redemption.discountSnapshot,
    internalSubscriptionId: operationId,
    subscriptionId: String(provider.id),
    status: "pending",
    createdAt: now,
    updatedAt: now,
  });
  await batch.commit();
  await coupons.markCheckout({
    redemptionId: redemption.id,
    subscriptionId: String(provider.id),
    internalSubscriptionId: operationId,
  });
  const subscriptionId = String(provider.id);
  assert.ok(subscriptionId);
  console.log(
    JSON.stringify({
      checkoutUrl: provider.init_point,
      subscriptionId,
      expectedAmount: quote.discountedPrice,
    }),
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
