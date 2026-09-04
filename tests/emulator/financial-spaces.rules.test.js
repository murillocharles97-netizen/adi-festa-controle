const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { doc, setDoc, getDoc, deleteDoc, updateDoc, runTransaction, writeBatch } = require("firebase/firestore");

let env;
const projectId = "adi-festa-variations-test", businessA = "financial-a", businessB = "financial-b";

test.before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [id, ownerId] of [[businessA, "owner-a"], [businessB, "owner-b"]])
      await setDoc(doc(db, "businesses", id), { id, ownerId, active: true, subscription: { planId: "internal", status: "active" } });
    for (const user of [
      { uid: "owner-a", businessId: businessA, role: "owner" },
      { uid: "manager-a", businessId: businessA, role: "manager" },
      { uid: "cashier-a", businessId: businessA, role: "cashier" },
      { uid: "owner-b", businessId: businessB, role: "owner" },
    ]) await setDoc(doc(db, "users", user.uid), { ...user, active: true });
  });
});
test.after(async () => env?.cleanup());

const businessSpace = { id: "space-a", name: "Empresa A", type: "business", linkedBusinessId: businessA, ownerUid: "owner-a", createdBy: "owner-a", active: true };
const entry = { id: "entry-a", financialSpaceId: "space-a", ownerUid: "owner-a", createdBy: "owner-a", operationId: "entry-a", amountCents: 1000, currency: "BRL", direction: "out", status: "pending", sourceType: "expense", sourceId: "entry-a" };

test("proprietário cria espaço empresarial e lançamento canônico", async () => {
  const db = env.authenticatedContext("owner-a").firestore();
  await assertSucceeds(setDoc(doc(db, "financialSpaces", "space-a"), businessSpace));
  await assertSucceeds(setDoc(doc(db, "financialSpaces", "space-a", "entries", "entry-a"), entry));
});

test("gestor da mesma empresa lê e paga, caixa não altera", async () => {
  const manager = env.authenticatedContext("manager-a").firestore(), cashier = env.authenticatedContext("cashier-a").firestore();
  await assertSucceeds(getDoc(doc(manager, "financialSpaces", "space-a", "entries", "entry-a")));
  await assertSucceeds(updateDoc(doc(manager, "financialSpaces", "space-a", "entries", "entry-a"), { status: "paid" }));
  await assertFails(updateDoc(doc(cashier, "financialSpaces", "space-a", "entries", "entry-a"), { status: "cancelled" }));
});

test("empresa diferente não lê nem escreve", async () => {
  const other = env.authenticatedContext("owner-b").firestore();
  await assertFails(getDoc(doc(other, "financialSpaces", "space-a")));
  await assertFails(getDoc(doc(other, "financialSpaces", "space-a", "entries", "entry-a")));
});

test("espaço pessoal é privado mesmo para colega da empresa", async () => {
  const owner = env.authenticatedContext("owner-a").firestore(), manager = env.authenticatedContext("manager-a").firestore();
  await assertSucceeds(setDoc(doc(owner, "financialSpaces", "personal-a"), { id: "personal-a", name: "Pessoal", type: "personal", linkedBusinessId: null, ownerUid: "owner-a", createdBy: "owner-a", active: true }));
  await assertFails(getDoc(doc(manager, "financialSpaces", "personal-a")));
});

test("lançamento pago não pode ser apagado nem ter valor reescrito", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), ref = doc(db, "financialSpaces", "space-a", "entries", "entry-a");
  await assertFails(deleteDoc(ref));
  await assertFails(updateDoc(ref, { amountCents: 1 }));
});

test("pagamento transacional é idempotente e preserva um único evento", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), entryRef = doc(db, "financialSpaces", "space-a", "entries", "retry-account"),
    eventRef = doc(db, "financialSpaces", "space-a", "events", "payment_retry-account");
  await assertSucceeds(setDoc(entryRef, { ...entry, id: "retry-account", operationId: "retry-account", sourceId: "retry-account" }));
  const pay = () => runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(entryRef);
    if (snapshot.data().status === "paid") return;
    transaction.update(entryRef, { status: "paid", paidAt: "2026-09-04T12:00:00.000Z" });
    transaction.set(eventRef, { id: "payment_retry-account", operationId: "payment_retry-account", financialSpaceId: "space-a", ownerUid: "owner-a", createdBy: "owner-a", entryId: "retry-account", eventKind: "account_payment", transition: "paid", status: "applied", amountCents: 1000 });
  });
  await assertSucceeds(pay());
  await assertSucceeds(pay());
  assert.equal((await getDoc(entryRef)).data().status, "paid");
  assert.equal((await getDoc(eventRef)).data().eventKind, "account_payment");
});

test("transferência grava os dois lados atomicamente e não pode ser alterada", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), transferId = "transfer-a", personalId = "personal-transfer";
  await assertSucceeds(setDoc(doc(db, "financialSpaces", personalId), { id: personalId, name: "Pessoal", type: "personal", linkedBusinessId: null, ownerUid: "owner-a", createdBy: "owner-a", active: true }));
  const batch = writeBatch(db), transferRef = doc(db, "financialTransfers", transferId);
  batch.set(transferRef, { id: transferId, operationId: transferId, fromSpaceId: personalId, toSpaceId: "space-a", amountCents: 50000, createdBy: "owner-a" });
  batch.set(doc(db, "financialSpaces", personalId, "entries", `${transferId}_out`), { id: `${transferId}_out`, financialSpaceId: personalId, ownerUid: "owner-a", createdBy: "owner-a", operationId: `${transferId}:out`, amountCents: 50000, currency: "BRL", direction: "out", status: "paid", sourceType: "transfer", sourceId: transferId });
  batch.set(doc(db, "financialSpaces", "space-a", "entries", `${transferId}_in`), { id: `${transferId}_in`, financialSpaceId: "space-a", ownerUid: "owner-a", createdBy: "owner-a", operationId: `${transferId}:in`, amountCents: 50000, currency: "BRL", direction: "in", status: "paid", sourceType: "transfer", sourceId: transferId });
  await assertSucceeds(batch.commit());
  await assertFails(updateDoc(transferRef, { amountCents: 1 }));
  await assertFails(getDoc(doc(env.authenticatedContext("owner-b").firestore(), "financialTransfers", transferId)));
});
