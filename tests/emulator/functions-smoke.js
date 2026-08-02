const assert = require("node:assert/strict");
const adminSdk = require("../../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} = require("firebase/auth");
const {
  getFunctions,
  connectFunctionsEmulator,
  httpsCallable,
} = require("firebase/functions");

(async () => {
  const response = await fetch(
    "http://127.0.0.1:5001/adi-festa-variations-test/southamerica-east1/submitCatalogOrder",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ data: {} }),
    },
  );
  assert.ok(
    [400, 401, 403, 500].includes(response.status),
    `status inesperado: ${response.status}`,
  );
  console.log(
    `Functions emulator respondeu com bloqueio seguro (${response.status}).`,
  );
  for (const functionName of [
    "validateCoupon",
    "listAdminCoupons",
    "saveAdminCoupon",
  ]) {
    const protectedResponse = await fetch(
      `http://127.0.0.1:5001/adi-festa-variations-test/southamerica-east1/${functionName}`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          data: {
            businessId: "adi-festa",
            couponCode: "TESTE",
            planId: "professional",
            billingCycle: "monthly",
          },
        }),
      },
    );
    assert.ok(
      [400, 401, 403, 500].includes(protectedResponse.status),
      `${functionName} aceitou chamada sem autenticação (${protectedResponse.status})`,
    );
  }
  console.log("Functions de cupom bloquearam chamadas sem autenticação.");
  adminSdk.initializeApp({ projectId: "adi-festa-variations-test" });
  const business = "crm-function-test",
    saleId = "sale-1",
    clientId = "client-1",
    admin = adminSdk.firestore();
  await admin.doc(`businesses/${business}/sales/${saleId}`).set({
    clienteId: clientId,
    valorFinal: 42.5,
    data: "2026-07-27T12:00:00.000Z",
    itens: [{ quantidade: 2 }],
  });
  let metric = null;
  for (let attempt = 0; attempt < 20 && !metric; attempt++) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const result = await admin
      .doc(`businesses/${business}/customerMetrics/${clientId}`)
      .get();
    if (result.exists) metric = result.data();
  }
  assert.ok(metric, "agregado do cliente não foi criado");
  assert.equal(Number(metric.totalSpent), 42.5);
  assert.equal(Number(metric.purchaseCount), 1);
  console.log("Agregação CRM idempotente validada no emulador.");
  const clientApp = initializeApp(
      { apiKey: "emulator-key", projectId: "adi-festa-variations-test" },
      "coupon-functions-test",
    ),
    auth = getAuth(clientApp),
    functions = getFunctions(clientApp, "southamerica-east1");
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFunctionsEmulator(functions, "127.0.0.1", 5001);
  const internalCredential = await createUserWithEmailAndPassword(
      auth,
      "internal-coupon@example.test",
      "Secure123!",
    ),
    internalUid = internalCredential.user.uid;
  await admin
    .doc("businesses/adi-festa")
    .set(
      {
        id: "adi-festa",
        ownerId: internalUid,
        active: true,
        subscription: { planId: "internal", status: "active" },
      },
      { merge: true },
    );
  await admin
    .doc(`users/${internalUid}`)
    .set({
      uid: internalUid,
      businessId: "adi-festa",
      email: "internal-coupon@example.test",
      role: "owner",
      active: true,
    });
  const saveCoupon = httpsCallable(functions, "saveAdminCoupon"),
    listCoupons = httpsCallable(functions, "listAdminCoupons"),
    validateCoupon = httpsCallable(functions, "validateCoupon");
  const promotional = {
    name: "Promo emulador",
    code: "EMU40",
    category: "promotional",
    description: "Teste local",
    discountType: "percentage",
    discountValue: 40,
    durationType: "billing_cycles",
    billingCycles: 3,
    allowedPlanIds: ["professional"],
    allowedBillingCycles: ["monthly"],
    validFrom: "2026-01-01T00:00:00.000Z",
    validUntil: "2027-01-01T00:00:00.000Z",
    maxRedemptions: 5,
    maxUsesPerBusiness: 1,
    maxUsesPerUser: 1,
    newSubscribersOnly: false,
    allowUpgrade: true,
    allowDowngrade: false,
    firstPaidSubscriptionOnly: false,
    status: "active",
  };
  assert.equal(
    (await saveCoupon({ businessId: "adi-festa", coupon: promotional })).data
      .coupon.code,
    "EMU40",
  );
  assert.equal(
    (await listCoupons({ businessId: "adi-festa", limit: 10 })).data.items.some(
      (item) => item.code === "EMU40",
    ),
    true,
  );
  await signOut(auth);
  const customerCredential = await createUserWithEmailAndPassword(
      auth,
      "allowed-coupon@example.test",
      "Secure123!",
    ),
    customerUid = customerCredential.user.uid,
    customerBusiness = "coupon-company-a";
  await admin
    .doc(`businesses/${customerBusiness}`)
    .set(
      {
        id: customerBusiness,
        ownerId: customerUid,
        active: true,
        createdAt: "2026-08-01T00:00:00.000Z",
        subscription: { planId: "trial", status: "trial" },
      },
      { merge: true },
    );
  await admin
    .doc(`users/${customerUid}`)
    .set({
      uid: customerUid,
      businessId: customerBusiness,
      email: "allowed-coupon@example.test",
      role: "owner",
      active: true,
    });
  const quote = (
    await validateCoupon({
      businessId: customerBusiness,
      couponCode: "emu40",
      planId: "professional",
      billingCycle: "monthly",
    })
  ).data;
  assert.equal(quote.valid, true);
  assert.equal(quote.discountedPrice, 29.94);
  await assert.rejects(
    () => saveCoupon({ businessId: "adi-festa", coupon: promotional }),
    (error) =>
      ["functions/permission-denied", "functions/not-found"].includes(
        error.code,
      ),
  );
  await signOut(auth);
  await signInWithEmailAndPassword(
    auth,
    "internal-coupon@example.test",
    "Secure123!",
  );
  await saveCoupon({
    businessId: "adi-festa",
    coupon: {
      ...promotional,
      name: "Privado emulador",
      code: "PRIVATEEMU",
      category: "private",
      validUntil: null,
      authorizedEmails: ["allowed-coupon@example.test"],
    },
  });
  await signOut(auth);
  await signInWithEmailAndPassword(
    auth,
    "allowed-coupon@example.test",
    "Secure123!",
  );
  assert.equal(
    (
      await validateCoupon({
        businessId: customerBusiness,
        couponCode: "PRIVATEEMU",
        planId: "professional",
        billingCycle: "monthly",
      })
    ).data.valid,
    true,
  );
  await signOut(auth);
  const deniedCredential = await createUserWithEmailAndPassword(
      auth,
      "denied-coupon@example.test",
      "Secure123!",
    ),
    deniedUid = deniedCredential.user.uid,
    deniedBusiness = "coupon-company-b";
  await admin
    .doc(`businesses/${deniedBusiness}`)
    .set(
      {
        id: deniedBusiness,
        ownerId: deniedUid,
        active: true,
        createdAt: "2026-08-01T00:00:00.000Z",
        subscription: { planId: "trial", status: "trial" },
      },
      { merge: true },
    );
  await admin
    .doc(`users/${deniedUid}`)
    .set({
      uid: deniedUid,
      businessId: deniedBusiness,
      email: "denied-coupon@example.test",
      role: "owner",
      active: true,
    });
  await assert.rejects(
    () =>
      validateCoupon({
        businessId: deniedBusiness,
        couponCode: "PRIVATEEMU",
        planId: "professional",
        billingCycle: "monthly",
      }),
    (error) =>
      error.code === "functions/failed-precondition" &&
      !String(error.message).includes("allowed-coupon"),
  );
  console.log(
    "Cupons promocional e privado validados com autenticação, isolamento e resposta segura no emulador.",
  );
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
