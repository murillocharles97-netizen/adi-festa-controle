const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where, orderBy, limit } = require("firebase/firestore");

let env;
const projectId = "adi-festa-variations-test";
const businessA = "renewals-a", businessB = "renewals-b";

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore(), subscription = { planId: "internal", status: "active" };
    await setDoc(doc(db, "businesses", businessA), { id: businessA, ownerId: "owner-a", active: true, subscription });
    await setDoc(doc(db, "businesses", businessB), { id: businessB, ownerId: "owner-b", active: true, subscription });
    await setDoc(doc(db, "users", "owner-a"), { uid: "owner-a", businessId: businessA, role: "owner", active: true });
    await setDoc(doc(db, "users", "owner-b"), { uid: "owner-b", businessId: businessB, role: "owner", active: true });
  });
});

test.after(async () => env?.cleanup());

const renewal = (businessId, id = "renewal-1") => ({
  id, operationId: id, businessId, clientId: "client-1", productId: "iptv",
  variantId: null, label: "IPTV Casa", status: "active",
  startedAt: "2026-08-14T12:00:00.000Z", expiresAt: "2026-09-13T12:00:00.000Z",
  durationValue: 30, durationUnit: "days", contractedPrice: 25.9,
  renewalCount: 0, reminders: [7, 1, 0], createdAt: "2026-08-14T12:00:00.000Z",
  updatedAt: "2026-08-14T12:00:00.000Z", schemaVersion: 13,
});

test("proprietário grava e consulta vigência indexada somente na própria empresa", async () => {
  const db = env.authenticatedContext("owner-a").firestore();
  const ref = doc(db, "businesses", businessA, "customerSubscriptions", "renewal-1");
  await assertSucceeds(setDoc(ref, renewal(businessA)));
  assert.equal((await assertSucceeds(getDoc(ref))).data().contractedPrice, 25.9);
  const result = await assertSucceeds(getDocs(query(
    collection(db, "businesses", businessA, "customerSubscriptions"),
    where("status", "==", "active"), orderBy("expiresAt", "asc"), limit(20),
  )));
  assert.equal(result.size, 1);
  await assertFails(getDocs(query(
    collection(db, "businesses", businessB, "customerSubscriptions"),
    where("status", "==", "active"), orderBy("expiresAt", "asc"), limit(20),
  )));
});

test("ledger de renovação é imutável e isolado entre empresas", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), eventId = "renewal-1:activation:sale-1";
  const ref = doc(db, "businesses", businessA, "customerSubscriptionEvents", eventId);
  await assertSucceeds(setDoc(ref, {
    id: eventId, operationId: eventId, businessId: businessA,
    subscriptionId: "renewal-1", clientId: "client-1", productId: "iptv",
    variantId: null, transition: "activation", sourceType: "sale", sourceId: "sale-1",
    previous: null, next: renewal(businessA), note: "", createdAt: "2026-08-14T12:00:00.000Z",
    schemaVersion: 13,
  }));
  await assertFails(updateDoc(ref, { note: "alterado" }));
  await assertFails(setDoc(
    doc(db, "businesses", businessB, "customerSubscriptions", "foreign"),
    renewal(businessB, "foreign"),
  ));
  assert.equal((await getDoc(ref)).data().transition, "activation");
});
