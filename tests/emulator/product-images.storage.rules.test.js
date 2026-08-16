const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
} = require("@firebase/rules-unit-testing");
const { doc, setDoc } = require("firebase/firestore");
const {
  deleteObject,
  ref,
  uploadBytes,
  getMetadata,
} = require("firebase/storage");

let env;
const projectId = "adi-festa-variations-test",
  businessA = "empresa-imagem-a",
  businessB = "empresa-imagem-b";

test.before(async () => {
  env = await initializeTestEnvironment({
    projectId,
    firestore: { rules: fs.readFileSync("firestore.rules", "utf8") },
    storage: { rules: fs.readFileSync("storage.rules", "utf8") },
  });
  await env.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, "users", "owner-a"), {
      uid: "owner-a",
      businessId: businessA,
      role: "owner",
      active: true,
    });
    await setDoc(doc(db, "users", "owner-b"), {
      uid: "owner-b",
      businessId: businessB,
      role: "owner",
      active: true,
    });
    await setDoc(doc(db, "users", "cashier-a"), {
      uid: "cashier-a",
      businessId: businessA,
      role: "cashier",
      active: true,
    });
  });
});

test.after(async () => env?.cleanup());

const metadata = (productId, entityType = "product", variantId = "") => ({
  contentType: "image/webp",
  customMetadata: {
    businessId: businessA,
    productId,
    entityType,
    operationId: "operation-1",
    ...(variantId ? { variantId } : {}),
  },
});

const catalogMetadata = (entityId, entityType, businessId = businessA) => ({
  contentType: "image/webp",
  customMetadata: {
    businessId,
    entityId,
    entityType,
    operationId: "catalog-operation-1",
  },
});

test("owner grava e lê imagem versionada do próprio produto", async () => {
  const storage = env.authenticatedContext("owner-a").storage(),
    imageRef = ref(
      storage,
      `businesses/${businessA}/products/product-1/main-operation-1.webp`,
    );
  await assertSucceeds(
    uploadBytes(imageRef, new Uint8Array([1, 2, 3]), metadata("product-1")),
  );
  const savedMetadata = await assertSucceeds(getMetadata(imageRef));
  assert.equal(savedMetadata.customMetadata.entityType, "product");
});

test("substitui a imagem por nova versão e remove o arquivo anterior", async () => {
  const storage = env.authenticatedContext("owner-a").storage(),
    oldImage = ref(
      storage,
      `businesses/${businessA}/products/product-replace/main-operation-old.webp`,
    ),
    newImage = ref(
      storage,
      `businesses/${businessA}/products/product-replace/main-operation-new.webp`,
    );
  await assertSucceeds(
    uploadBytes(oldImage, new Uint8Array([1]), metadata("product-replace")),
  );
  await assertSucceeds(
    uploadBytes(newImage, new Uint8Array([2]), metadata("product-replace")),
  );
  await assertSucceeds(deleteObject(oldImage));
  await assert.rejects(getMetadata(oldImage), /object-not-found/);
  await assertSucceeds(getMetadata(newImage));
});

test("variação exige metadados e path correspondentes", async () => {
  const storage = env.authenticatedContext("owner-a").storage(),
    valid = ref(
      storage,
      `businesses/${businessA}/products/product-1/variants/variant-1/thumb-operation-1.webp`,
    ),
    invalid = ref(
      storage,
      `businesses/${businessA}/products/product-1/variants/variant-1/thumb-operation-2.webp`,
    );
  await assertSucceeds(
    uploadBytes(
      valid,
      new Uint8Array([1]),
      metadata("product-1", "productVariant", "variant-1"),
    ),
  );
  const savedMetadata = await assertSucceeds(getMetadata(valid));
  assert.equal(savedMetadata.customMetadata.entityType, "productVariant");
  await assertSucceeds(deleteObject(valid));
  await assert.rejects(getMetadata(valid), /object-not-found/);
  await assertFails(
    uploadBytes(
      invalid,
      new Uint8Array([1]),
      metadata("product-1", "product", "variant-1"),
    ),
  );
});

test("outra empresa, caixa, anônimo e arquivo fora do padrão são bloqueados", async () => {
  const ownPath = `businesses/${businessA}/products/product-1/main-operation-1.webp`,
    other = env.authenticatedContext("owner-b").storage(),
    cashier = env.authenticatedContext("cashier-a").storage(),
    anonymous = env.unauthenticatedContext().storage(),
    owner = env.authenticatedContext("owner-a").storage();
  await assertFails(getMetadata(ref(other, ownPath)));
  await assertFails(
    uploadBytes(
      ref(cashier, `businesses/${businessA}/products/product-2/main-x.webp`),
      new Uint8Array([1]),
      metadata("product-2"),
    ),
  );
  await assertFails(getMetadata(ref(anonymous, ownPath)));
  await assertFails(
    uploadBytes(
      ref(owner, `businesses/${businessA}/products/product-2/original.png`),
      new Uint8Array([1]),
      { ...metadata("product-2"), contentType: "image/png" },
    ),
  );
});

test("catálogo aceita banner, categoria e produto com path e metadata versionados", async () => {
  const storage = env.authenticatedContext("owner-a").storage();
  for (const [folder, entityId, entityType] of [
    ["banners", "banner-home", "catalogBanner"],
    ["categories", "bebidas", "catalogCategory"],
    ["products", "product-1", "catalogProduct"],
  ]) {
    const main = ref(storage, `businesses/${businessA}/catalog/${folder}/${entityId}/main-catalog-operation-1.webp`),
      thumb = ref(storage, `businesses/${businessA}/catalog/${folder}/${entityId}/thumb-catalog-operation-1.webp`);
    await assertSucceeds(uploadBytes(main, new Uint8Array([1]), catalogMetadata(entityId, entityType)));
    await assertSucceeds(uploadBytes(thumb, new Uint8Array([2]), catalogMetadata(entityId, entityType)));
    assert.equal((await getMetadata(main)).customMetadata.entityType, entityType);
    await assertSucceeds(deleteObject(main));
    await assertSucceeds(deleteObject(thumb));
  }
});

test("catálogo bloqueia metadata divergente, outra empresa, caixa e acesso anônimo", async () => {
  const owner = env.authenticatedContext("owner-a").storage(),
    other = env.authenticatedContext("owner-b").storage(),
    cashier = env.authenticatedContext("cashier-a").storage(),
    anonymous = env.unauthenticatedContext().storage(),
    path = `businesses/${businessA}/catalog/banners/banner-protected/main-catalog-operation-1.webp`;
  await assertFails(uploadBytes(ref(owner, path), new Uint8Array([1]), catalogMetadata("wrong-id", "catalogBanner")));
  await assertFails(uploadBytes(ref(other, path), new Uint8Array([1]), catalogMetadata("banner-protected", "catalogBanner", businessB)));
  await assertFails(uploadBytes(ref(cashier, path), new Uint8Array([1]), catalogMetadata("banner-protected", "catalogBanner")));
  await assertFails(getMetadata(ref(anonymous, path)));
});
