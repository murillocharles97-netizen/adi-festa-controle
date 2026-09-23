const test = require("node:test");
const fs = require("node:fs");
const assert = require("node:assert/strict");
const { initializeTestEnvironment, assertSucceeds, assertFails } = require("@firebase/rules-unit-testing");
const { collection, doc, getDoc, getDocs, query, setDoc, updateDoc, where } = require("firebase/firestore");

const projectId = "adi-festa-variations-test";
const businessId = "team-access-v150";
const foreignBusinessId = "team-access-foreign";
const spaceA = "team-space-a";
const spaceB = "team-space-b";
let env;

const permissions = (...enabled) => Object.fromEntries(enabled.map((key) => [key, true]));
const member = (uid, role, permissionMap, allowedSpaceIds = [spaceA], status = "active") => ({
  uid, name: uid, email: `${uid}@example.test`, role, status,
  spaceAccess: role === "owner" ? "all" : "selected",
  allowedSpaceIds: role === "owner" ? [] : allowedSpaceIds,
  permissions: permissionMap,
});

test.before(async () => {
  env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync("firestore.rules", "utf8") } });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    const subscription = { planId: "internal", status: "active" };
    await setDoc(doc(db, "businesses", businessId), { id: businessId, ownerId: "owner-team", active: true, subscription });
    await setDoc(doc(db, "businesses", foreignBusinessId), { id: foreignBusinessId, ownerId: "owner-foreign", active: true, subscription });
    for (const [uid, role] of [["owner-team", "owner"], ["manager-team", "manager"], ["seller-team", "seller"], ["stock-team", "stock"], ["disabled-team", "seller"], ["owner-foreign", "owner"]])
      await setDoc(doc(db, "users", uid), { uid, businessId: uid === "owner-foreign" ? foreignBusinessId : businessId, role, active: true });
    const ownerPermissions = permissions("sales.create", "sales.cancel", "sales.viewAll", "customers.view", "customers.edit", "customers.receiveDebt", "customers.adjustBalance", "products.view", "products.edit", "inventory.view", "inventory.adjust", "financial.view", "reports.view", "profit.view", "cost.view", "team.view", "team.manage", "settings.manage", "billing.manage", "spaces.manage");
    await setDoc(doc(db, "businesses", businessId, "members", "owner-team"), member("owner-team", "owner", ownerPermissions, []));
    await setDoc(doc(db, "businesses", businessId, "members", "manager-team"), member("manager-team", "manager", permissions("sales.create", "sales.cancel", "sales.viewAll", "customers.view", "customers.edit", "products.view", "products.edit", "inventory.view", "inventory.adjust", "reports.view", "team.view"), [spaceA, spaceB]));
    await setDoc(doc(db, "businesses", businessId, "members", "seller-team"), member("seller-team", "seller", permissions("sales.create", "customers.view", "products.view", "inventory.view")));
    await setDoc(doc(db, "businesses", businessId, "members", "stock-team"), member("stock-team", "stock", permissions("products.view", "inventory.view", "inventory.adjust")));
    await setDoc(doc(db, "businesses", businessId, "members", "disabled-team"), member("disabled-team", "seller", permissions("sales.create", "customers.view", "products.view"), [spaceA], "disabled"));
    await setDoc(doc(db, "businesses", foreignBusinessId, "members", "owner-foreign"), member("owner-foreign", "owner", ownerPermissions, []));
    for (const id of [spaceA, spaceB])
      await setDoc(doc(db, "financialSpaces", id), { id, name: id, type: "business", linkedBusinessId: businessId, businessId, ownerUid: "owner-team", active: true, status: "active", capabilities: { finance: true, sales: true, products: true, inventory: true, goals: true } });
    await setDoc(doc(db, "businesses", businessId, "products", "operational-product"), { id: "operational-product", businessId, nome: "Produto", preco: 25, estoqueAtual: 10, active: true });
    await setDoc(doc(db, "businesses", businessId, "productFinancials", "operational-product"), { id: "operational-product", productId: "operational-product", businessId, custo: 9 });
    await setDoc(doc(db, "financialSpaces", spaceA, "entries", "private-entry"), { id: "private-entry", financialSpaceId: spaceA, ownerUid: "owner-team", amountCents: 2500 });
    await setDoc(doc(db, "businesses", businessId, "sales", "owner-sale"), { id: "owner-sale", businessId, spaceId: spaceA, actorUid: "owner-team", valorFinal: 40 });
  });
});

test.after(async () => env?.cleanup());

test("owner lê equipe, custo, financeiro e todas as vendas", async () => {
  const db = env.authenticatedContext("owner-team").firestore();
  await assertSucceeds(getDocs(collection(db, "businesses", businessId, "members")));
  await assertSucceeds(getDoc(doc(db, "businesses", businessId, "productFinancials", "operational-product")));
  await assertSucceeds(getDoc(doc(db, "financialSpaces", spaceA, "entries", "private-entry")));
  await assertSucceeds(getDoc(doc(db, "businesses", businessId, "sales", "owner-sale")));
});

test("seller vê somente o espaço permitido e dados operacionais sem custo ou Financeiro", async () => {
  const db = env.authenticatedContext("seller-team").firestore();
  await assertSucceeds(getDoc(doc(db, "financialSpaces", spaceA)));
  await assertFails(getDoc(doc(db, "financialSpaces", spaceB)));
  await assertSucceeds(getDoc(doc(db, "businesses", businessId, "products", "operational-product")));
  await assertFails(getDoc(doc(db, "businesses", businessId, "productFinancials", "operational-product")));
  await assertFails(getDoc(doc(db, "financialSpaces", spaceA, "entries", "private-entry")));
  await assertFails(getDocs(collection(db, "businesses", businessId, "members")));
  await assertFails(getDoc(doc(db, "businesses", businessId, "sales", "owner-sale")));
});

test("seller cria venda com ator próprio, consulta só as próprias e não atravessa space", async () => {
  const db = env.authenticatedContext("seller-team").firestore();
  const ownSale = { id: "seller-sale", operationId: "seller-operation", businessId, ownerId: "seller-team", spaceId: spaceA, financialSpaceId: spaceA, actorUid: "seller-team", valorFinal: 25, status: "pago" };
  await assertSucceeds(setDoc(doc(db, "businesses", businessId, "sales", ownSale.id), ownSale));
  await assertFails(setDoc(doc(db, "businesses", businessId, "sales", "forged-actor"), { ...ownSale, id: "forged-actor", actorUid: "owner-team" }));
  await assertFails(setDoc(doc(db, "businesses", businessId, "sales", "forged-space"), { ...ownSale, id: "forged-space", actorUid: "seller-team", spaceId: spaceB, financialSpaceId: spaceB }));
  await assertFails(updateDoc(doc(db, "businesses", businessId, "sales", "owner-sale"), { status: "cancelado", actorUid: "seller-team" }));
  await assertFails(updateDoc(doc(db, "businesses", businessId, "sales", ownSale.id), { status: "cancelado" }));
  const own = await assertSucceeds(getDocs(query(collection(db, "businesses", businessId, "sales"), where("actorUid", "==", "seller-team"))));
  assert.equal(own.docs.some((snapshot) => snapshot.id === ownSale.id), true);
  await assertFails(getDocs(collection(db, "businesses", businessId, "sales")));
});

test("seller baixa estoque sem editar o cadastro do produto", async () => {
  const db = env.authenticatedContext("seller-team").firestore();
  const productRef = doc(db, "businesses", businessId, "products", "operational-product");
  await assertSucceeds(updateDoc(productRef, { estoqueAtual: 9, updatedByUid: "seller-team" }));
  await assertFails(updateDoc(productRef, { nome: "Produto adulterado", updatedByUid: "seller-team" }));
  await assertFails(setDoc(doc(db, "businesses", businessId, "products", "forged-product"), {
    id: "forged-product", businessId, nome: "Produto indevido", preco: 1,
    estoqueAtual: 1, active: true,
  }));
});

test("manager sem financeiro e stock seguem apenas as permissões concedidas", async () => {
  const managerDb = env.authenticatedContext("manager-team").firestore();
  await assertSucceeds(getDocs(collection(managerDb, "businesses", businessId, "members")));
  await assertFails(getDoc(doc(managerDb, "financialSpaces", spaceA, "entries", "private-entry")));
  const stockDb = env.authenticatedContext("stock-team").firestore();
  await assertSucceeds(getDoc(doc(stockDb, "businesses", businessId, "products", "operational-product")));
  await assertFails(setDoc(doc(stockDb, "businesses", businessId, "sales", "stock-sale"), { id: "stock-sale", businessId, spaceId: spaceA, actorUid: "stock-team", valorFinal: 10 }));
});

test("membro desativado e usuário externo não acessam o business", async () => {
  for (const uid of ["disabled-team", "owner-foreign"]) {
    const db = env.authenticatedContext(uid).firestore();
    await assertFails(getDoc(doc(db, "businesses", businessId, "products", "operational-product")));
    await assertFails(getDoc(doc(db, "financialSpaces", spaceA)));
  }
});
