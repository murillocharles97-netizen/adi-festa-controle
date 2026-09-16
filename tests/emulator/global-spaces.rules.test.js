const test = require("node:test");
const fs = require("node:fs");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocs,
  query,
  setDoc,
  updateDoc,
  where,
} = require("firebase/firestore");

const projectId = "adi-festa-variations-test";
const businessA = "spaces-business-a", businessB = "spaces-business-b";
let env;

const capabilities = (overrides = {}) => ({
  finance: true,
  sales: true,
  products: true,
  inventory: true,
  goals: true,
  ...overrides,
});
const globalSpace = (id, businessId, overrides = {}) => ({
  id,
  name: id,
  type: "business",
  linkedBusinessId: businessId,
  businessId,
  operationalType: "unit",
  status: "active",
  capabilities: capabilities(),
  isDefault: false,
  globalSpaceSchemaVersion: 1,
  ownerUid: businessId === businessA ? "owner-a" : "owner-b",
  createdBy: businessId === businessA ? "owner-a" : "owner-b",
  active: true,
  ...overrides,
});
const sale = (id, spaceId, overrides = {}) => ({
  id,
  operationId: id,
  businessId: businessA,
  ownerId: "owner-a",
  spaceId,
  financialSpaceId: spaceId,
  status: "pago",
  valorFinal: 20,
  valorTotal: 20,
  itens: [],
  data: new Date(),
  schemaVersion: 14,
  ...overrides,
});

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    for (const [id, ownerId] of [[businessA, "owner-a"], [businessB, "owner-b"]]) {
      await setDoc(doc(db, "businesses", id), { id, ownerId, active: true, subscription: { planId: "internal", status: "active" } });
    }
    for (const user of [
      { uid: "owner-a", businessId: businessA, role: "owner" },
      { uid: "cashier-a", businessId: businessA, role: "cashier" },
      { uid: "owner-b", businessId: businessB, role: "owner" },
    ]) await setDoc(doc(db, "users", user.uid), { ...user, active: true });
    await setDoc(doc(db, "financialSpaces", "adi"), globalSpace("adi", businessA, { isDefault: true }));
    await setDoc(doc(db, "financialSpaces", "iptv"), globalSpace("iptv", businessA, { operationalType: "operation", capabilities: capabilities({ inventory: false }) }));
    await setDoc(doc(db, "financialSpaces", "casa"), globalSpace("casa", businessA, {
      type: "personal", linkedBusinessId: null, businessId: null, operationalType: "personal",
      capabilities: capabilities({ sales: false, products: false, inventory: false, goals: false }),
    }));
    await setDoc(doc(db, "financialSpaces", "foreign"), globalSpace("foreign", businessB));
    await setDoc(doc(db, "financialSpaces", "no-sales"), globalSpace("no-sales", businessA, {
      capabilities: capabilities({ sales: false }),
    }));
    await setDoc(doc(db, "financialSpaces", "archived"), globalSpace("archived", businessA, {
      active: false, status: "archived",
    }));
    await setDoc(doc(db, "financialSpaces", "legacy-business"), {
      id: "legacy-business", name: "Legado", type: "business", linkedBusinessId: businessA,
      ownerUid: "owner-a", createdBy: "owner-a", active: true,
    });
    await setDoc(doc(db, "financialSpaces", "legacy-conflict"), {
      id: "legacy-conflict", name: "Conflito legado", type: "business", linkedBusinessId: businessB,
      businessId: businessA, ownerUid: "owner-b", createdBy: "owner-b", active: true,
    });
    await setDoc(doc(db, "businesses", businessA, "sales", "legacy-sale"), {
      id: "legacy-sale", operationId: "legacy-sale", businessId: businessA, ownerId: "owner-a",
      status: "pago", valorFinal: 10, valorTotal: 10, itens: [], data: new Date(), schemaVersion: 13,
    });
  });
});
test.after(async () => env?.cleanup());

test("owner cria e atualiza Space global sem alterar identidade financeira", async () => {
  const db = env.authenticatedContext("owner-a").firestore();
  const created = globalSpace("loja-centro", businessA, { operationalType: "operation" });
  await assertSucceeds(setDoc(doc(db, "financialSpaces", created.id), created));
  await assertSucceeds(updateDoc(doc(db, "financialSpaces", created.id), {
    name: "Loja Centro 2", capabilities: capabilities({ inventory: false }),
  }));
  await assertFails(updateDoc(doc(db, "financialSpaces", created.id), { type: "personal" }));
  await assertFails(updateDoc(doc(db, "financialSpaces", created.id), { linkedBusinessId: businessB }));
  await assertFails(updateDoc(doc(db, "financialSpaces", created.id), { globalSpaceSchemaVersion: deleteField() }));
  await assertFails(updateDoc(doc(db, "financialSpaces", created.id), { status: "archived", active: true }));
});

test("Space não pode habilitar operação sem empresa nem atravessar tenant", async () => {
  const db = env.authenticatedContext("owner-a").firestore();
  await assertFails(setDoc(doc(db, "financialSpaces", "orphan-sale"), globalSpace("orphan-sale", businessA, {
    type: "personal", linkedBusinessId: null, businessId: null, operationalType: "personal",
  })));
  await assertFails(setDoc(doc(db, "financialSpaces", "forged-space"), globalSpace("forged-space", businessB, {
    ownerUid: "owner-a", createdBy: "owner-a",
  })));
  await assertFails(setDoc(doc(db, "financialSpaces", "all"), globalSpace("all", businessA)));
  await assertFails(setDoc(doc(db, "financialSpaces", "all_spaces"), globalSpace("all_spaces", businessA)));
  await assertFails(getDoc(doc(db, "financialSpaces", "foreign")));
  const cashier = env.authenticatedContext("cashier-a").firestore();
  await assertFails(setDoc(doc(cashier, "financialSpaces", "shadow-pos"), globalSpace("shadow-pos", businessA, {
    type: "personal", linkedBusinessId: null, ownerUid: "cashier-a", createdBy: "cashier-a",
  })));
});

test("nova venda exige espaço real, ativo, de vendas e da própria empresa", async () => {
  const owner = env.authenticatedContext("owner-a").firestore();
  await assertSucceeds(setDoc(doc(owner, "businesses", businessA, "sales", "sale-adi"), sale("sale-adi", "adi")));
  await assertSucceeds(setDoc(doc(owner, "businesses", businessA, "sales", "sale-iptv"), sale("sale-iptv", "iptv")));
  await assertSucceeds(setDoc(doc(owner, "businesses", businessA, "sales", "sale-legacy-space"), sale("sale-legacy-space", "legacy-business")));
  const saleWithoutSpace = sale("sale-none", "adi");
  delete saleWithoutSpace.spaceId;
  delete saleWithoutSpace.financialSpaceId;
  await assertFails(setDoc(doc(owner, "businesses", businessA, "sales", "sale-none"), saleWithoutSpace));
  await assertFails(setDoc(doc(owner, "businesses", businessA, "sales", "sale-all"), sale("sale-all", "all_spaces")));
  await assertFails(setDoc(doc(owner, "businesses", businessA, "sales", "sale-all-short"), sale("sale-all-short", "all")));
  await assertFails(setDoc(doc(owner, "businesses", businessA, "sales", "sale-unknown"), sale("sale-unknown", "missing-space")));
  await assertFails(setDoc(doc(owner, "businesses", businessA, "sales", "sale-home"), sale("sale-home", "casa")));
  await assertFails(setDoc(doc(owner, "businesses", businessA, "sales", "sale-disabled"), sale("sale-disabled", "no-sales")));
  await assertFails(setDoc(doc(owner, "businesses", businessA, "sales", "sale-archived"), sale("sale-archived", "archived")));
  await assertFails(setDoc(doc(owner, "businesses", businessA, "sales", "sale-foreign"), sale("sale-foreign", "foreign")));
  await assertFails(setDoc(doc(owner, "businesses", businessA, "sales", "sale-conflict"), sale("sale-conflict", "legacy-conflict")));
  await assertFails(setDoc(doc(owner, "businesses", businessA, "sales", "sale-mismatch"), sale("sale-mismatch", "adi", { financialSpaceId: "iptv" })));
});

test("cashier pode vender no espaço autorizado, sem ganhar acesso a outro business", async () => {
  const cashier = env.authenticatedContext("cashier-a").firestore();
  await assertSucceeds(setDoc(doc(cashier, "businesses", businessA, "sales", "cashier-sale"), sale("cashier-sale", "adi", { ownerId: "cashier-a" })));
  await assertFails(setDoc(doc(cashier, "businesses", businessB, "sales", "cashier-foreign"), sale("cashier-foreign", "foreign", { businessId: businessB, ownerId: "cashier-a" })));
});

test("venda legada permanece atualizável e só recebe atribuição válida e imutável", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), ref = doc(db, "businesses", businessA, "sales", "legacy-sale");
  await assertSucceeds(updateDoc(ref, { observacao: "histórico preservado" }));
  await assertFails(updateDoc(ref, { spaceId: "casa", financialSpaceId: "casa" }));
  await assertSucceeds(updateDoc(ref, { spaceId: "adi", financialSpaceId: "adi" }));
  await assertFails(updateDoc(ref, { spaceId: "iptv", financialSpaceId: "iptv" }));
});

test("arquivar um espaço não bloqueia manutenção de históricos com atribuição imutável", async () => {
  const db = env.authenticatedContext("owner-a").firestore();
  const spaceRef = doc(db, "financialSpaces", "historical-space");
  const saleRef = doc(db, "businesses", businessA, "sales", "historical-sale");
  const productRef = doc(db, "businesses", businessA, "products", "historical-product");
  const product = {
    businessId: businessA,
    ownerId: "owner-a",
    id: "historical-product",
    nome: "Item histórico",
    preco: 10,
    ativo: true,
    updatedAt: new Date(),
    schemaVersion: 14,
    itemKind: "product",
    spaceAccessMode: "single_space",
    allowedSpaceIds: ["historical-space"],
    defaultSpaceId: "historical-space",
    spaceScopeVersion: 1,
  };

  await assertSucceeds(setDoc(spaceRef, globalSpace("historical-space", businessA)));
  await assertSucceeds(setDoc(saleRef, sale("historical-sale", "historical-space")));
  await assertSucceeds(setDoc(productRef, product));
  await assertSucceeds(updateDoc(spaceRef, { capabilities: capabilities({ sales: false }) }));
  await assertSucceeds(updateDoc(saleRef, { observacao: "histórico sem novas vendas" }));
  await assertSucceeds(updateDoc(productRef, { nome: "Item histórico sem novas vendas" }));
  await assertSucceeds(updateDoc(spaceRef, { status: "archived", active: false }));

  await assertSucceeds(updateDoc(saleRef, { observacao: "histórico mantido" }));
  await assertFails(updateDoc(saleRef, { spaceId: "adi", financialSpaceId: "adi" }));
  await assertSucceeds(updateDoc(productRef, { nome: "Item histórico revisado" }));
  await assertSucceeds(updateDoc(productRef, {
    spaceAccessMode: "all_spaces",
    allowedSpaceIds: [],
    defaultSpaceId: null,
  }));
});

test("produto legado e os três escopos permanecem compatíveis sem duplicar ID", async () => {
  const db = env.authenticatedContext("owner-a").firestore(), base = {
    businessId: businessA, ownerId: "owner-a", nome: "Item", preco: 10, ativo: true, updatedAt: new Date(), schemaVersion: 14,
  };
  await assertSucceeds(setDoc(doc(db, "businesses", businessA, "products", "legacy-product"), { ...base, id: "legacy-product" }));
  await assertSucceeds(setDoc(doc(db, "businesses", businessA, "products", "all-product"), {
    ...base, id: "all-product", itemKind: "product", spaceAccessMode: "all_spaces", allowedSpaceIds: [], defaultSpaceId: null, spaceScopeVersion: 1,
  }));
  const scopedRef = doc(db, "businesses", businessA, "products", "scoped-product");
  await assertSucceeds(setDoc(scopedRef, {
    ...base, id: "scoped-product", itemKind: "service", spaceAccessMode: "selected_spaces", allowedSpaceIds: ["adi", "iptv"], defaultSpaceId: "adi", spaceScopeVersion: 1,
  }));
  await assertSucceeds(updateDoc(scopedRef, { spaceAccessMode: "single_space", allowedSpaceIds: ["iptv"], defaultSpaceId: "iptv" }));
  await assertFails(updateDoc(scopedRef, { spaceAccessMode: "single_space", allowedSpaceIds: ["foreign"], defaultSpaceId: "foreign" }));
  await assertFails(updateDoc(scopedRef, { spaceAccessMode: "selected_spaces", allowedSpaceIds: ["adi", "all"], defaultSpaceId: "adi" }));
  await assertFails(updateDoc(scopedRef, { spaceAccessMode: "selected_spaces", allowedSpaceIds: ["adi", "all_spaces"], defaultSpaceId: "adi" }));
  await assertFails(updateDoc(scopedRef, { spaceAccessMode: "all_spaces", allowedSpaceIds: ["adi"], defaultSpaceId: null }));
  await assertFails(updateDoc(scopedRef, { itemKind: "unknown" }));
  await assertSucceeds(getDoc(scopedRef));
});

test("consultas de Spaces precisam provar tipo e tenant, sem transformar Rules em filtro", async () => {
  const db = env.authenticatedContext("owner-a").firestore();
  const ownBusiness = query(
    collection(db, "financialSpaces"),
    where("linkedBusinessId", "==", businessA),
    where("type", "==", "business"),
    where("active", "==", true),
  );
  const ownPersonal = query(
    collection(db, "financialSpaces"),
    where("ownerUid", "==", "owner-a"),
    where("type", "in", ["personal", "other"]),
    where("active", "==", true),
  );
  await assertSucceeds(getDocs(ownBusiness));
  await assertSucceeds(getDocs(ownPersonal));
  await assertFails(getDocs(query(
    collection(db, "financialSpaces"),
    where("linkedBusinessId", "==", businessB),
    where("type", "==", "business"),
    where("active", "==", true),
  )));
});
