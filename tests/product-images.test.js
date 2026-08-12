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

test("presentation usa defaults seguros e normaliza cover contain posição e zoom", () => {
  const { ProductImages } = runtime();
  assert.deepEqual(
    JSON.parse(JSON.stringify(ProductImages.normalizePresentation())),
    { fit: "cover", positionX: 50, positionY: 50, zoom: 1 },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        ProductImages.normalizePresentation({
          fit: "contain",
          positionX: 12,
          positionY: 88,
          zoom: 2.35,
        }),
      ),
    ),
    { fit: "contain", positionX: 12, positionY: 88, zoom: 2.35 },
  );
  assert.deepEqual(
    JSON.parse(
      JSON.stringify(
        ProductImages.normalizePresentation({
          fit: "stretch",
          positionX: -20,
          positionY: 999,
          zoom: 99,
        }),
      ),
    ),
    { fit: "cover", positionX: 0, positionY: 100, zoom: 3 },
  );
});

test("renderer aplica presentation própria e herdada sem duplicar fallback", () => {
  const { ProductImages } = runtime(),
    product = {
      nome: "Monsters",
      image: {
        thumbnailUrl: "https://cdn.test/monsters.webp",
        presentation: { fit: "contain", positionX: 34, positionY: 61, zoom: 1.2 },
      },
    },
    inherited = ProductImages.getProductDisplayImage(product, {
      displayName: "Mango",
      imageMode: "inherit",
    }),
    html = ProductImages.markup(product);
  assert.equal(inherited.inherited, true);
  assert.deepEqual(JSON.parse(JSON.stringify(inherited.presentation)), {
    fit: "contain",
    positionX: 34,
    positionY: 61,
    zoom: 1.2,
  });
  assert.match(html, /data-image-fit="contain"/);
  assert.match(html, /--product-image-position-x:34%/);
  assert.equal((html.match(/<img/g) || []).length, 1);
  assert.match(html, /product-photo-fallback[^>]*hidden/);
});

test("variação com foto própria usa presentation própria e herança não duplica metadata", () => {
  const { ProductImages } = runtime(),
    product = {
      nome: "Cone",
      image: {
        thumbnailUrl: "https://cdn.test/cone.webp",
        presentation: { fit: "cover", positionX: 40, positionY: 50, zoom: 1.1 },
      },
    },
    ownVariant = {
      displayName: "Nutella",
      imageMode: "own",
      image: {
        thumbnailUrl: "https://cdn.test/nutella.webp",
        presentation: { fit: "contain", positionX: 68, positionY: 33, zoom: 1.45 },
      },
    },
    inheritedVariant = { displayName: "Ferrero", imageMode: "inherit" },
    own = ProductImages.getProductDisplayImage(product, ownVariant),
    inherited = ProductImages.getProductDisplayImage(product, inheritedVariant);
  assert.match(own.url, /nutella\.webp/);
  assert.deepEqual(JSON.parse(JSON.stringify(own.presentation)), {
    fit: "contain",
    positionX: 68,
    positionY: 33,
    zoom: 1.45,
  });
  assert.match(inherited.url, /cone\.webp/);
  assert.deepEqual(JSON.parse(JSON.stringify(inherited.presentation)), {
    fit: "cover",
    positionX: 40,
    positionY: 50,
    zoom: 1.1,
  });
  assert.equal(Object.hasOwn(inheritedVariant, "imagePresentation"), false);
});

test("draft reabre enquadramento salvo e reset oficial retorna aos defaults", () => {
  const { ProductImages } = runtime(),
    draft = ProductImages.createDraft({
      image: {
        url: "https://cdn.test/produto.webp",
        presentation: { fit: "contain", positionX: 17, positionY: 72, zoom: 1.8 },
      },
    });
  assert.deepEqual(JSON.parse(JSON.stringify(draft.presentation)), {
    fit: "contain",
    positionX: 17,
    positionY: 72,
    zoom: 1.8,
  });
  assert.deepEqual(JSON.parse(JSON.stringify(ProductImages.DEFAULT_PRESENTATION)), {
    fit: "cover",
    positionX: 50,
    positionY: 50,
    zoom: 1,
  });
});

test("reenquadramento sem arquivo altera somente metadata e não chama upload", async () => {
  const context = runtime(),
    subject = {
      imageUrl: "https://cdn.test/monster.webp",
      image: {
        url: "https://cdn.test/monster.webp",
        storagePath: "businesses/b/products/p/main-old.webp",
      },
    },
    draft = context.ProductImages.createDraft(subject);
  let uploads = 0;
  context.ProductImageStorage = { upload: async () => uploads++ };
  draft.presentation = { fit: "contain", positionX: 21, positionY: 65, zoom: 1.4 };
  draft.presentationDirty = true;
  const result = await context.ProductImages.commit(draft, {
    productId: "p",
    oldSubject: subject,
  });
  assert.equal(uploads, 0);
  assert.equal(result.image.storagePath, subject.image.storagePath);
  assert.deepEqual(JSON.parse(JSON.stringify(result.image.presentation)), {
    fit: "contain",
    positionX: 21,
    positionY: 65,
    zoom: 1.4,
  });
});

test("nova foto salva presentation no mesmo upload otimizado", async () => {
  const context = runtime(),
    draft = context.ProductImages.createDraft({});
  draft.processed = { mainBlob: {}, thumbBlob: {}, extension: "webp" };
  draft.presentation = { fit: "cover", positionX: 76, positionY: 24, zoom: 1.6 };
  let uploads = 0;
  context.ProductImageStorage = {
    upload: async () => {
      uploads += 1;
      return {
        image: {
          url: "https://cdn.test/main.webp",
          thumbnailUrl: "https://cdn.test/thumb.webp",
          storagePath: "businesses/b/products/p/main-op.webp",
        },
        imageUrl: "https://cdn.test/main.webp",
      };
    },
  };
  const result = await context.ProductImages.commit(draft, { productId: "p" });
  assert.equal(uploads, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(result.image.presentation)), {
    fit: "cover",
    positionX: 76,
    positionY: 24,
    zoom: 1.6,
  });
});

test("remover foto chama remoção existente e volta ao fallback", async () => {
  const context = runtime(),
    subject = {
      nome: "Brownie",
      image: {
        url: "https://cdn.test/brownie.webp",
        storagePath: "businesses/b/products/p/main.webp",
      },
    },
    draft = context.ProductImages.createDraft(subject);
  let removals = 0;
  context.ProductImageStorage = { remove: async () => (removals += 1) };
  draft.remove = true;
  const result = await context.ProductImages.commit(draft, {
    productId: "p",
    oldSubject: subject,
  });
  assert.equal(removals, 1);
  assert.equal(result.image, null);
  assert.equal(context.ProductImages.getProductDisplayImage({ nome: "Brownie" }).initials, "B");
});

test("editor expõe drag pinch slider modos centralizar redefinir e ações mobile", () => {
  const source = fs.readFileSync("js/product-images.js", "utf8"),
    css = fs.readFileSync("css/product-images.css", "utf8");
  assert.match(source, /data-adjust-fit="cover"/);
  assert.match(source, /data-adjust-fit="contain"/);
  assert.match(source, /data-adjust-zoom/);
  assert.match(source, /data-adjust-center/);
  assert.match(source, /data-adjust-reset/);
  assert.match(source, /pointerdown/);
  assert.match(source, /pointers\.size >= 2/);
  assert.match(source, /Ajustar enquadramento/);
  assert.match(css, /touch-action:none/);
  assert.match(css, /aspect-ratio:145\/205/);
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

test("cards mobile e desktop usam uma única área visual e favorito sobre a foto", () => {
  const mobile = fs.readFileSync("js/produtos-mobile.js", "utf8"),
    mobileCss = fs.readFileSync("css/produtos-mobile.css", "utf8"),
    desktopCss = fs.readFileSync("css/produtos-desktop.css", "utf8");
  assert.match(mobile, /mobile-product-avatar[^`]*ProductImages\?\.markup/);
  assert.match(mobile, /favorite-dot show/);
  assert.doesNotMatch(mobile, /function star\(product\)/);
  assert.match(mobileCss, /\.mobile-product-avatar\{position:relative/);
  assert.match(mobileCss, /\.favorite-dot\{position:absolute/);
  assert.match(desktopCss, /\.desktop-product-card-photo/);
});
