const test = require("node:test");
const fs = require("node:fs");
const {
  initializeTestEnvironment,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
} = require("firebase/firestore");

let env;
const projectId = "adi-festa-variations-test";
const protectedCollections = [
  "adminCoupons",
  "adminCouponCodes",
  "couponQuotes",
  "couponRedemptions",
  "couponUsageCounters",
  "couponAuditLogs",
  "couponBillingEvents",
];

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "adminCoupons", "private-coupon"), {
      code: "PRIVATE40",
      status: "active",
    });
    await setDoc(doc(db, "couponRedemptions", "redemption-a"), {
      couponId: "private-coupon",
      businessId: "empresa-a",
      status: "active",
    });
  });
});

test.after(async () => env?.cleanup());

for (const actor of [
  ["anônimo", () => env.unauthenticatedContext().firestore()],
  ["empresa comum", () => env.authenticatedContext("owner-common").firestore()],
  [
    "conta interna no cliente",
    () => env.authenticatedContext("internal-owner").firestore(),
  ],
]) {
  test(`${actor[0]} não acessa diretamente a estrutura administrativa`, async () => {
    const db = actor[1]();
    for (const name of protectedCollections) {
      await assertFails(
        getDoc(
          doc(db, name, name === "adminCoupons" ? "private-coupon" : "item"),
        ),
      );
      await assertFails(getDocs(collection(db, name)));
      await assertFails(setDoc(doc(db, name, "attempt"), { tampered: true }));
    }
  });
}

test("empresa A não lê resgate da empresa B nem mesmo pelo identificador exato", async () => {
  const db = env.authenticatedContext("owner-a").firestore();
  await assertFails(getDoc(doc(db, "couponRedemptions", "redemption-a")));
});

test("somente o Admin SDK do backend atravessa as regras protegidas", async () => {
  await env.withSecurityRulesDisabled(async (context) => {
    const snapshot = await getDoc(
      doc(context.firestore(), "adminCoupons", "private-coupon"),
    );
    if (!snapshot.exists())
      throw new Error("Cupom administrativo não foi encontrado pelo backend.");
  });
});
