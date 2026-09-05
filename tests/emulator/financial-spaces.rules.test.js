const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const {
  collection,
  doc,
  getDoc,
  getDocs,
  deleteDoc,
  limit,
  orderBy,
  query,
  runTransaction,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} = require("firebase/firestore");

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

test("categoria e subcategoria customizadas ficam isoladas no espaço", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), other = env.authenticatedContext("owner-b").firestore();
  for (const id of ["category-space-a", "category-space-b"])
    await assertSucceeds(setDoc(doc(db, "financialSpaces", id), { id, name: id, type: "personal", linkedBusinessId: null, ownerUid: "owner-a", createdBy: "owner-a", active: true }));
  const macro = {
    id: "custom-printing", financialSpaceId: "category-space-a", ownerUid: "owner-a", createdBy: "owner-a",
    operationId: "category:macro", name: "Impressão 3D", type: "category", parentCategoryId: null,
    isDefault: false, active: true,
  };
  const subcategory = {
    id: "custom-filament", financialSpaceId: "category-space-a", ownerUid: "owner-a", createdBy: "owner-a",
    operationId: "category:sub", name: "Filamentos", type: "subcategory", parentCategoryId: "custom-printing",
    isDefault: false, active: true,
  };
  await assertSucceeds(setDoc(doc(db, "financialSpaces", "category-space-a", "categories", macro.id), macro));
  await assertSucceeds(setDoc(doc(db, "financialSpaces", "category-space-a", "categories", subcategory.id), subcategory));
  assert.equal((await getDocs(collection(db, "financialSpaces", "category-space-a", "categories"))).size, 2);
  assert.equal((await getDocs(collection(db, "financialSpaces", "category-space-b", "categories"))).size, 0);
  await assertFails(getDoc(doc(other, "financialSpaces", "category-space-a", "categories", macro.id)));
  await assertFails(setDoc(doc(other, "financialSpaces", "category-space-a", "categories", "intruder"), { ...macro, id: "intruder", createdBy: "owner-b" }));
});

test("Rules rejeitam hierarquia de categoria malformada", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), base = {
    financialSpaceId: "category-space-a", ownerUid: "owner-a", createdBy: "owner-a",
    operationId: "category:invalid", name: "Inválida", isDefault: false, active: true,
  };
  await assertFails(setDoc(doc(db, "financialSpaces", "category-space-a", "categories", "invalid-type"), { ...base, id: "invalid-type", type: "expense", parentCategoryId: null }));
  await assertFails(setDoc(doc(db, "financialSpaces", "category-space-a", "categories", "invalid-parent"), { ...base, id: "invalid-parent", type: "subcategory", parentCategoryId: null }));
  await assertFails(setDoc(doc(db, "financialSpaces", "category-space-a", "categories", "missing-parent"), { ...base, id: "missing-parent", type: "subcategory", parentCategoryId: "custom-does-not-exist" }));
  await assertSucceeds(setDoc(doc(db, "financialSpaces", "category-space-a", "categories", "default-child"), { ...base, id: "default-child", type: "subcategory", parentCategoryId: "default_personal_home" }));
});

test("query real da tela lista espaços próprios", async () => {
  const db = env.authenticatedContext("owner-a").firestore();
  await assertSucceeds(getDocs(query(
    collection(db, "financialSpaces"),
    where("ownerUid", "==", "owner-a"),
    where("type", "==", "personal"),
    where("active", "==", true),
    limit(100),
  )));
  await assertSucceeds(getDocs(query(
    collection(db, "financialSpaces"),
    where("ownerUid", "==", "owner-a"),
    where("type", "==", "other"),
    where("active", "==", true),
    limit(100),
  )));
});

test("query real da tela lista espaços da empresa", async () => {
  const db = env.authenticatedContext("owner-a").firestore();
  await assertSucceeds(getDocs(query(
    collection(db, "financialSpaces"),
    where("linkedBusinessId", "==", businessA),
    where("type", "==", "business"),
    where("active", "==", true),
    limit(20),
  )));
});

test("consulta mensal de contas usa dueAt e não traz outubro em setembro", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), entries = collection(db, "financialSpaces", "space-a", "entries");
  await assertSucceeds(setDoc(doc(entries, "rent-september"), { ...entry, id: "rent-september", operationId: "rent-september", sourceId: "rent-september", dueAt: "2026-09-10T12:00:00.000Z", periodKey: "2026-09" }));
  await assertSucceeds(setDoc(doc(entries, "rent-october"), { ...entry, id: "rent-october", operationId: "rent-october", sourceId: "rent-october", dueAt: "2026-10-10T12:00:00.000Z", periodKey: "2026-10" }));
  const snapshot = await assertSucceeds(getDocs(query(
    entries,
    where("dueAt", ">=", "2026-09-01T03:00:00.000Z"),
    where("dueAt", "<", "2026-10-01T03:00:00.000Z"),
    orderBy("dueAt", "asc"),
    limit(500),
  )));
  assert.deepEqual(snapshot.docs.map((item) => item.id), ["rent-september"]);
});

test("ocorrência e série recorrente podem ser canceladas sem apagar histórico pago", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), recurrenceRef = doc(db, "financialSpaces", "space-a", "recurrences", "rent-series"),
    septemberRef = doc(db, "financialSpaces", "space-a", "entries", "series-september"), octoberRef = doc(db, "financialSpaces", "space-a", "entries", "series-october"),
    novemberRef = doc(db, "financialSpaces", "space-a", "entries", "series-november");
  await assertSucceeds(setDoc(recurrenceRef, { id: "rent-series", financialSpaceId: "space-a", ownerUid: "owner-a", createdBy: "owner-a", operationId: "rent-series", active: true, frequency: "monthly", seriesStartAt: "2026-09-10T12:00:00.000Z", seriesEndAt: null }));
  await assertSucceeds(setDoc(septemberRef, { ...entry, id: "series-september", operationId: "series-september", sourceId: "series-september", amountCents: 150000, status: "paid", dueAt: "2026-09-10T12:00:00.000Z", recurrenceId: "rent-series" }));
  await assertSucceeds(setDoc(octoberRef, { ...entry, id: "series-october", operationId: "series-october", sourceId: "series-october", amountCents: 150000, dueAt: "2026-10-10T12:00:00.000Z", recurrenceId: "rent-series" }));
  await assertSucceeds(setDoc(novemberRef, { ...entry, id: "series-november", operationId: "series-november", sourceId: "series-november", amountCents: 150000, dueAt: "2026-11-10T12:00:00.000Z", recurrenceId: "rent-series" }));
  await assertSucceeds(updateDoc(octoberRef, { amountCents: 165000 }));
  await assertSucceeds(updateDoc(recurrenceRef, { overrideOccurrenceKeys: ["2026-10-10"] }));
  assert.equal((await getDoc(septemberRef)).data().amountCents, 150000);
  assert.equal((await getDoc(octoberRef)).data().amountCents, 165000);
  assert.equal((await getDoc(novemberRef)).data().amountCents, 150000);
  const seriesEdit = writeBatch(db);
  seriesEdit.update(octoberRef, { amountCents: 170000 });
  seriesEdit.update(novemberRef, { amountCents: 170000 });
  seriesEdit.update(recurrenceRef, { amountCents: 170000, effectiveFrom: "2026-10-10T12:00:00.000Z" });
  await assertSucceeds(seriesEdit.commit());
  assert.equal((await getDoc(septemberRef)).data().amountCents, 150000);
  assert.equal((await getDoc(octoberRef)).data().amountCents, 170000);
  assert.equal((await getDoc(novemberRef)).data().amountCents, 170000);
  const batch = writeBatch(db);
  batch.update(octoberRef, { status: "cancelled", cancellationScope: "this_and_future" });
  batch.update(novemberRef, { status: "cancelled", cancellationScope: "this_and_future" });
  batch.update(recurrenceRef, { active: false, seriesEndAt: "2026-10-10T12:00:00.000Z" });
  await assertSucceeds(batch.commit());
  assert.equal((await getDoc(septemberRef)).data().status, "paid");
  assert.equal((await getDoc(octoberRef)).data().status, "cancelled");
  assert.equal((await getDoc(novemberRef)).data().status, "cancelled");
  await assertFails(deleteDoc(septemberRef));
});

test("lançamento pago não pode ser apagado nem ter valor reescrito", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), ref = doc(db, "financialSpaces", "space-a", "entries", "entry-a");
  await assertFails(deleteDoc(ref));
  await assertFails(updateDoc(ref, { amountCents: 1 }));
});

test("migração conservadora pode classificar sem alterar o valor financeiro", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), other = env.authenticatedContext("owner-b").firestore(), ref = doc(db, "financialSpaces", "space-a", "entries", "entry-a");
  await assertSucceeds(updateDoc(ref, {
    categoryId: "default_business_structure", categoryName: "Estrutura", categoryIcon: "store",
    subcategoryId: "default_business_structure_rent", subcategoryName: "Aluguel",
    categorySchemaVersion: 2, categoryMigrationStatus: "migrated",
  }));
  assert.equal((await getDoc(ref)).data().amountCents, 1000);
  await assertFails(updateDoc(doc(other, "financialSpaces", "space-a", "entries", "entry-a"), { categoryName: "Outro negócio" }));
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
