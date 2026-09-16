const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (file) => fs.readFileSync(file, "utf8");

test("tela principal do PDV mantém checkout oculto e carrinho acionável", () => {
  const checkout = read("js/checkout.js"),
    desktop = read("js/desktop-sales.js");

  assert.match(
    checkout,
    /class="pos-summary" id="pos-summary" role="dialog"[^>]*aria-hidden="true" hidden/,
  );
  assert.match(checkout, /data-sale-cart-overlay hidden/);
  assert.match(
    checkout,
    /class="pos-bag" id="open-sale-summary"[^>]*aria-expanded="false"/,
  );
  assert.match(
    desktop,
    /class="desktop-sales-cart sale-summary" id="pos-summary"[^>]*aria-hidden="true" hidden/,
  );
  assert.match(desktop, /class="desktop-cart-fab pos-bag" id="open-sale-summary"/);
  assert.doesNotMatch(desktop, /id="open-sale-summary" hidden/);
});

test("checkout completo permanece dentro da superfície do carrinho", () => {
  const checkout = read("js/checkout.js"),
    desktop = read("js/desktop-sales.js"),
    mobileCart = checkout.slice(
      checkout.indexOf('<section class="pos-summary"'),
      checkout.indexOf('<button class="pos-bag"'),
    ),
    desktopCart = desktop.slice(
      desktop.indexOf('<aside class="desktop-sales-cart'),
      desktop.indexOf('<button type="button" class="desktop-cart-fab'),
    );

  for (const id of [
    "cart",
    "discount-value",
    "discount-percent",
    "sale-client",
    "sale-payment-method",
    "sale-note",
    "finish-sale",
  ]) {
    assert.match(mobileCart, new RegExp(`id="${id}"`));
    assert.match(desktopCart, new RegExp(`id="${id}"`));
  }
  assert.match(checkout, /Custo total/);
  assert.match(checkout, /Lucro estimado/);
  assert.match(desktop, /data-cart-step="-1"/);
  assert.match(desktop, /data-cart-step="1"/);
  assert.match(desktop, /data-remove=/);
});

test("carrinho abre como sheet no mobile e drawer no desktop sem formulário inline", () => {
  const mobile = read("js/checkout-mobile.js"),
    checkoutCss = read("css/checkout-mobile.css"),
    mobileFixes = read("css/mobile-fixes.css"),
    desktopCss = read("css/desktop-sales.css");

  assert.match(mobile, /summary\.hidden=false/);
  assert.match(mobile, /summary\.classList\.add\('mobile-open'\)/);
  assert.match(mobile, /summary\.setAttribute\('aria-hidden','false'\)/);
  assert.match(mobile, /event\.key==='Escape'/);
  assert.match(checkoutCss, /\.mobile-sale-page \.pos-summary\[hidden\]:not\(\.mobile-open\)\{display:none!important\}/);
  assert.match(checkoutCss, /\.mobile-sale-page \.pos-grid\{grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.doesNotMatch(checkoutCss, /width:58px;height:58px/);
  assert.match(mobileFixes, /\.mobile-sale-page \.pos-bag\{[\s\S]*width:auto;height:auto;min-height:64px/);
  assert.doesNotMatch(mobileFixes, /\.mobile-sale-page \.pos-bag\{[\s\S]{0,260}border-radius:50%/);
  assert.match(desktopCss, /\.desktop-sales-cart-overlay\.is-open/);
  assert.match(desktopCss, /\.desktop-sales-cart\.is-open/);
  assert.match(desktopCss, /\.desktop-sales \.desktop-cart-fab/);
});

test("venda e catálogo continuam vinculados ao espaço selecionado", () => {
  const checkout = read("js/checkout.js"),
    spaces = read("js/spaces.js");

  assert.match(checkout, /SpaceContext\?\.salesId/);
  assert.match(checkout, /productAvailableHere/);
  assert.match(checkout, /SpaceEngine\.productAllowsSpace/);
  assert.match(checkout, /SpaceContext\?\.requireSalesSpace/);
  assert.match(checkout, /spaceId,\s*financialSpaceId: spaceId/);
  assert.match(spaces, /Checkout\?\.resetSession/);
  assert.match(spaces, /Trocar o espaço limpará a venda atual/);
});

test("rota Vender possui um único renderizador e um único binding canônico", () => {
  const app = read("js/app.js"),
    checkout = read("js/checkout.js"),
    index = read("index.html"),
    vender = app.slice(app.indexOf("function vender()"), app.indexOf("function fiadoCard")),
    venderBinding = app.slice(
      app.indexOf('if (route === "vender")'),
      app.indexOf('if (route === "fiados")'),
    );

  assert.match(vender, /return window\.Checkout\?\.view\?\.\(\) \|\| ""/);
  assert.doesNotMatch(vender, /sale-layout|product-picker|Edite quantidades/);
  assert.match(venderBinding, /window\.Checkout\?\.bind\?\.\(\)/);
  assert.doesNotMatch(venderBinding, /bindVenda\(\)/);
  assert.match(checkout, /bind: standalone/);
  assert.doesNotMatch(index, /Checkout\.mount\(\)/);
  const compatibilityMount = checkout.slice(
    checkout.indexOf("function mount()"),
    checkout.indexOf('addEventListener("firebase-session-cleared"'),
  );
  assert.match(compatibilityMount, /AppPageRuntime\?\.mount/);
  assert.doesNotMatch(compatibilityMount, /innerHTML|hashchange|setTimeout/);
});

test("atualizações assíncronas da venda preservam o componente e renovam só seus dados", () => {
  const app = read("js/app.js"),
    checkout = read("js/checkout.js");

  assert.match(app, /addEventListener\("veconi-spaces-ready"[\s\S]*mountRoute\(route\)/);
  assert.match(app, /window\.Checkout\?\.refreshProducts\?\.\(\)/);
  assert.match(app, /window\.Checkout\?\.refreshClients\?\.\(\)/);
  assert.match(checkout, /function refreshProducts\(\)[\s\S]*grid\.innerHTML/);
  assert.match(checkout, /function refreshClients\(\)[\s\S]*select\.innerHTML/);
});
