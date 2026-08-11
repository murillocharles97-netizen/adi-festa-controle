const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function runtime() {
  const context = {
    console,
    URL,
    Blob,
    Date,
    String,
    Number,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Math,
    Error,
    location: { href: "https://app.exemplo.com/index.html" },
    navigator: { onLine: true },
    document: {
      documentElement: {},
      querySelector: () => null,
      createElement: () => ({
        innerHTML: "",
        firstElementChild: null,
      }),
    },
    MutationObserver: class {
      observe() {}
    },
    addEventListener() {},
    queueMicrotask() {},
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/product-images.js", "utf8"), context);
  return context;
}

test("fallback oficial escolhe variação, produto e iniciais nesta ordem", () => {
  const { ProductImages } = runtime();
  const product = {
      nome: "Cone Recheado",
      image: {
        url: "https://cdn.test/product.webp",
        thumbnailUrl: "https://cdn.test/product-thumb.webp",
        updatedAt: "2026-08-11T12:00:00.000Z",
      },
    },
    ownVariant = {
      displayName: "Nutella",
      imageMode: "own",
      image: { thumbnailUrl: "https://cdn.test/nutella.webp" },
    },
    inheritedVariant = { displayName: "Ferrero", imageMode: "inherit" };
  assert.match(
    ProductImages.getProductDisplayImage(product, ownVariant).url,
    /nutella\.webp/,
  );
  const inherited = ProductImages.getProductDisplayImage(
    product,
    inheritedVariant,
  );
  assert.match(inherited.url, /product-thumb\.webp/);
  assert.equal(inherited.inherited, true);
  const fallback = ProductImages.getProductDisplayImage(
    { nome: "Brownie Branco" },
    null,
  );
  assert.equal(fallback.url, "");
  assert.equal(fallback.initials, "BB");
});
test("markup usa thumbnail lazy e mantém fallback contra URL quebrada", () => {
  const { ProductImages } = runtime(),
    html = ProductImages.markup({
      nome: "Monster",
      imageThumbUrl: "https://cdn.test/monster.webp",
    });
  assert.match(html, /loading="lazy"/);
  assert.match(html, /decoding="async"/);
  assert.match(html, /onerror=/);
  assert.match(html, /product-photo-fallback/);
});

test("validação aceita JPG PNG WebP e recusa HEIC, tipo inválido e mais de 10 MB", () => {
  const { ProductImages } = runtime();
  for (const type of ["image/jpeg", "image/png", "image/webp"])
    assert.equal(
      ProductImages.validate({ type, size: 1000, name: `foto.${type.split("/")[1]}` }),
      true,
    );
  assert.throws(
    () => ProductImages.validate({ type: "image/heic", size: 1000, name: "foto.heic" }),
    /HEIC/,
  );
  assert.throws(
    () => ProductImages.validate({ type: "image/gif", size: 1000, name: "foto.gif" }),
    /Formato não suportado/,
  );
  assert.throws(
    () =>
      ProductImages.validate({
        type: "image/jpeg",
        size: 10 * 1024 * 1024 + 1,
        name: "grande.jpg",
      }),
    /10 MB/,
  );
});

test("infraestrutura usa arquivos versionados, thumbnail e isolamento multiempresa", () => {
  const storage = fs.readFileSync("js/firebase/product-image-storage.js", "utf8"),
    storageRules = fs.readFileSync("storage.rules", "utf8"),
    firestoreRules = fs.readFileSync("firestore.rules", "utf8"),
    sync = fs.readFileSync("js/firebase/sync.js", "utf8");
  assert.match(storage, /businesses\/\$\{tenantId\}\/products\/\$\{productId\}/);
  assert.match(storage, /variants\/\$\{variantId\}/);
  assert.match(storage, /main-\$\{operationId\}/);
  assert.match(storage, /thumb-\$\{operationId\}/);
  assert.match(storageRules, /profile\(\)\.businessId == businessId/);
  assert.match(storageRules, /entityType == 'productVariant'/);
  assert.match(storageRules, /entityType == 'product'/);
  assert.match(firestoreRules, /'image', 'imageMode', 'imageUrl'/);
  assert.match(sync, /"imageMode"/);
});

test("card desktop segue a hierarquia aprovada e não exibe mínimo como métrica", () => {
  const app = fs.readFileSync("js/app.js", "utf8"),
    start = app.indexOf("function produtoCard"),
    end = app.indexOf("function desktopProductRows", start),
    card = app.slice(start, end);
  assert.match(card, /desktop-product-card-media/);
  assert.match(card, /desktop-product-card-photo/);
  assert.match(card, /desktop-product-favorite/);
  assert.match(card, /desktop-product-metrics/);
  assert.match(card, />Preço</);
  assert.match(card, />Estoque</);
  assert.match(card, />Variações</);
  assert.doesNotMatch(card, /Estoque mínimo/);
  assert.match(card, /Adicionar entrada/);
  assert.match(card, /Histórico/);
});
