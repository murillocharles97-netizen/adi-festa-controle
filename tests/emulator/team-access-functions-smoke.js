const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const adminSdk = require("../../functions/node_modules/firebase-admin");
const { initializeApp } = require("firebase/app");
const {
  getAuth,
  connectAuthEmulator,
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut,
} = require("firebase/auth");
const { getFunctions, connectFunctionsEmulator, httpsCallable } = require("firebase/functions");
const { getFirestore, connectFirestoreEmulator, doc, getDoc, setDoc, serverTimestamp } = require("firebase/firestore");

const projectId = "adi-festa-variations-test";
const password = "Secure123!";
const suffix = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
const businessId = `team-functions-${suffix}`;
const spaceId = `team-space-${suffix}`;
const ownerEmail = `team-owner-${suffix}@example.test`;
const sellerEmail = `team-seller-${suffix}@example.test`;

adminSdk.initializeApp({ projectId });
const admin = adminSdk.firestore();
const clientApp = initializeApp({ apiKey: "emulator-key", projectId }, `team-functions-${suffix}`);
const auth = getAuth(clientApp);
const functions = getFunctions(clientApp, "southamerica-east1");
const clientDb = getFirestore(clientApp);
connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
connectFunctionsEmulator(functions, "127.0.0.1", 5001);
connectFirestoreEmulator(clientDb, "127.0.0.1", 8080);

const call = (name, data = {}) => httpsCallable(functions, name)(data);
const enabled = (...keys) => Object.fromEntries(keys.map((key) => [key, true]));
const ownerPermissions = enabled(
  "sales.create", "sales.cancel", "sales.viewAll", "customers.view", "customers.edit",
  "customers.receiveDebt", "customers.adjustBalance", "products.view", "products.edit",
  "inventory.view", "inventory.adjust", "financial.view", "reports.view", "profit.view",
  "cost.view", "team.view", "team.manage", "settings.manage", "billing.manage", "spaces.manage",
);

(async () => {
  const ownerCredential = await createUserWithEmailAndPassword(auth, ownerEmail, password);
  const ownerUid = ownerCredential.user.uid;
  await Promise.all([
    admin.doc(`businesses/${businessId}`).set({
      id: businessId, ownerId: ownerUid, name: "Equipe Smoke", active: true, maxTeamMembers: null,
      subscription: { planId: "internal", status: "active" },
    }),
    admin.doc(`users/${ownerUid}`).set({ uid: ownerUid, name: "Proprietário Smoke", email: ownerEmail, businessId, role: "owner", active: true }),
    admin.doc(`businesses/${businessId}/members/${ownerUid}`).set({
      uid: ownerUid, name: "Proprietário Smoke", email: ownerEmail, role: "owner", status: "active",
      spaceAccess: "all", allowedSpaceIds: [], permissions: ownerPermissions,
    }),
    admin.doc(`financialSpaces/${spaceId}`).set({
      id: spaceId, name: "Loja Smoke", type: "business", businessId, linkedBusinessId: businessId,
      ownerUid, active: true, status: "active",
    }),
    admin.doc(`businesses/${businessId}/products/operational-product`).set({
      id: "operational-product", businessId, nome: "Produto operacional", preco: 25, estoqueAtual: 10, active: true,
    }),
    admin.doc(`businesses/${businessId}/productFinancials/operational-product`).set({
      id: "operational-product", businessId, productId: "operational-product", custo: 9,
    }),
  ]);

  const inviteResult = await call("createTeamInvite", {
    businessId,
    name: "Vendedora Smoke",
    email: sellerEmail,
    role: "seller",
    spaceAccess: "selected",
    allowedSpaceIds: [spaceId],
    permissions: enabled("sales.create", "customers.view", "products.view", "inventory.view"),
  });
  const inviteUrl = new URL(inviteResult.data.inviteUrl);
  const token = inviteUrl.searchParams.get("teamInvite");
  const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
  assert.ok(token && token.length >= 32);
  assert.equal(inviteResult.data.invite.email, sellerEmail);

  await signOut(auth);
  const preview = await call("getTeamInvitePreview", { token });
  assert.equal(preview.data.businessName, "Equipe Smoke");
  assert.equal(preview.data.email, sellerEmail);
  assert.equal(preview.data.status, "pending");

  const sellerCredential = await createUserWithEmailAndPassword(auth, sellerEmail, password);
  const sellerUid = sellerCredential.user.uid;
  const accepted = await call("acceptTeamInvite", { token });
  assert.equal(accepted.data.businessId, businessId);
  assert.equal(accepted.data.member.uid, sellerUid);
  assert.equal(accepted.data.member.role, "seller");

  const [sellerMember, sellerProfile, usedToken] = await Promise.all([
    admin.doc(`businesses/${businessId}/members/${sellerUid}`).get(),
    admin.doc(`users/${sellerUid}`).get(),
    admin.doc(`teamInviteTokens/${tokenHash}`).get(),
  ]);
  assert.equal(sellerMember.data().status, "active");
  assert.equal(sellerMember.data().allowedSpaceIds[0], spaceId);
  assert.equal(sellerProfile.data().businessId, businessId);
  assert.equal(sellerProfile.data().role, "seller");
  assert.equal(usedToken.exists, false);
  assert.equal((await getDoc(doc(clientDb, "businesses", businessId, "products", "operational-product"))).data().preco, 25);
  await assert.rejects(
    getDoc(doc(clientDb, "businesses", businessId, "productFinancials", "operational-product")),
    (error) => String(error.code).includes("permission-denied"),
  );
  const sellerSaleId = `seller-sale-${suffix}`;
  await setDoc(doc(clientDb, "businesses", businessId, "sales", sellerSaleId), {
    id: sellerSaleId, operationId: sellerSaleId, idempotencyKey: sellerSaleId, businessId,
    ownerId: sellerUid, spaceId, financialSpaceId: spaceId, actorUid: sellerUid,
    actorNameSnapshot: "Vendedora Smoke", actorRoleSnapshot: "seller", valorFinal: 25,
    valorTotal: 25, status: "pago", itens: [{ produtoId: "operational-product", productId: "operational-product", quantidade: 1, quantity: 1, precoFinalUnitario: 25, subtotalFinal: 25 }],
    createdAt: serverTimestamp(), updatedAt: serverTimestamp(), schemaVersion: 3,
  });
  assert.equal((await getDoc(doc(clientDb, "businesses", businessId, "sales", sellerSaleId))).data().actorUid, sellerUid);
  const activityRef = admin.doc(`businesses/${businessId}/activityEvents/sale:${sellerSaleId}`);
  let activity;
  for (let attempt = 0; attempt < 150; attempt++) {
    activity = await activityRef.get();
    if (activity.exists) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(activity?.data()?.actorNameSnapshot, "Vendedora Smoke");
  const saleFinancialRef = admin.doc(`businesses/${businessId}/saleFinancials/${sellerSaleId}`);
  let saleFinancial;
  for (let attempt = 0; attempt < 150; attempt++) {
    saleFinancial = await saleFinancialRef.get();
    if (saleFinancial.exists) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.equal(saleFinancial?.data()?.custoTotal, 9);
  assert.equal(saleFinancial?.data()?.lucro, 16);
  await assert.rejects(
    getDoc(doc(clientDb, "businesses", businessId, "saleFinancials", sellerSaleId)),
    (error) => String(error.code).includes("permission-denied"),
  );
  await assert.rejects(
    call("createTeamInvite", { businessId, name: "Sem acesso", email: `blocked-${suffix}@example.test`, role: "seller", spaceAccess: "selected", allowedSpaceIds: [spaceId] }),
    (error) => String(error.code).includes("permission-denied"),
  );

  await signOut(auth);
  await signInWithEmailAndPassword(auth, ownerEmail, password);
  assert.equal((await getDoc(doc(clientDb, "businesses", businessId, "sales", sellerSaleId))).data().valorFinal, 25);
  assert.equal((await getDoc(doc(clientDb, "businesses", businessId, "activityEvents", `sale:${sellerSaleId}`))).data().actorUid, sellerUid);
  assert.equal((await getDoc(doc(clientDb, "businesses", businessId, "saleFinancials", sellerSaleId))).data().lucro, 16);
  await call("updateTeamMember", { businessId, uid: sellerUid, status: "disabled" });
  assert.equal((await admin.doc(`businesses/${businessId}/members/${sellerUid}`).get()).data().status, "disabled");
  assert.equal((await admin.doc(`users/${sellerUid}`).get()).data().active, false);
  await call("updateTeamMember", {
    businessId, uid: sellerUid, status: "active", role: "seller", name: "Vendedora Reativada",
    spaceAccess: "selected", allowedSpaceIds: [spaceId],
    permissions: enabled("sales.create", "customers.view", "products.view", "inventory.view"),
  });
  assert.equal((await admin.doc(`businesses/${businessId}/members/${sellerUid}`).get()).data().name, "Vendedora Reativada");
  await assert.rejects(
    call("updateTeamMember", { businessId, uid: ownerUid, status: "disabled" }),
    (error) => String(error.code).includes("failed-precondition"),
  );

  await Promise.all([
    admin.doc(`businesses/${businessId}/products/product-cost`).set({ id: "product-cost", businessId, nome: "Produto", custo: 7, cost: 7 }),
    admin.doc(`businesses/${businessId}/sales/sale-cost`).set({
      id: "sale-cost", businessId, actorUid: ownerUid, valorFinal: 20, custoTotal: 7, lucro: 13,
      itens: [{ produtoId: "product-cost", quantidade: 1, custoUnitario: 7, custoTotal: 7, lucro: 13 }],
    }),
  ]);
  const migration = await call("migrateSensitiveTeamData", { businessId });
  assert.equal(migration.data.alreadyApplied, false);
  assert.equal(migration.data.products, 1);
  assert.equal(migration.data.sales, 1);
  const [product, productFinancial, sale, migratedSaleFinancial] = await Promise.all([
    admin.doc(`businesses/${businessId}/products/product-cost`).get(),
    admin.doc(`businesses/${businessId}/productFinancials/product-cost`).get(),
    admin.doc(`businesses/${businessId}/sales/sale-cost`).get(),
    admin.doc(`businesses/${businessId}/saleFinancials/sale-cost`).get(),
  ]);
  assert.equal("custo" in product.data(), false);
  assert.equal(productFinancial.data().custo, 7);
  assert.equal("custoTotal" in sale.data(), false);
  assert.equal("custoUnitario" in sale.data().itens[0], false);
  assert.equal(migratedSaleFinancial.data().lucro, 13);
  assert.equal((await call("migrateSensitiveTeamData", { businessId })).data.alreadyApplied, true);

  console.log("Team Access Functions V150: convite, aceite, escopo, desativação, último owner e migração sensível validados.");
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
