const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(file, "utf8");

function productRuntime() {
  const context = {
    console,
    window: null,
    DB: {},
    Utils: {},
    crypto: { randomUUID: () => "test-id" },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(read("js/produtos.js"), context);
  return context;
}

test("regra compartilhada ignora estoque legado do recorrente sem controle", () => {
  const runtime = productRuntime();
  const iptv = {
    productType: "recurring",
    controlaEstoque: false,
    semControleEstoque: true,
    estoqueAtual: -22,
    durationValue: 30,
    durationUnit: "days",
  };
  assert.equal(runtime.productControlsStock(iptv), false);
  assert.equal(runtime.getProductStockStatus(iptv), "sem-controle");
  assert.equal(runtime.getProductRenewalPeriod(iptv), "30 dias");
});

test("recorrente com controle mantém status e bloqueio de produto físico", () => {
  const runtime = productRuntime();
  const kit = {
    productType: "recurring",
    controlaEstoque: true,
    semControleEstoque: false,
    estoqueAtual: 0,
    estoqueMinimo: 2,
  };
  assert.equal(runtime.productControlsStock(kit), true);
  assert.equal(runtime.getProductStockStatus(kit), "esgotado");
});

test("Vender mobile posiciona favorito na imagem e remove Ver todos", () => {
  const source = read("js/checkout-mobile.js");
  const css = read("css/checkout-mobile.css");
  assert.doesNotMatch(source, />Ver todos</);
  assert.match(css, /\.mobile-sale-favorite\{position:absolute;z-index:4;display:grid;place-items:center;right:9px;top:9px;width:44px;height:44px/);
  assert.match(css, /\.mobile-sale-page \.pos-qty\{left:9px;right:auto/);
  assert.match(source, /getProductRenewalPeriod/);
});

test("Produtos mobile remove a barra inferior e usa período no recorrente", () => {
  const source = read("js/produtos-mobile.js");
  const css = read("css/produtos-mobile.css");
  assert.doesNotMatch(source, /product-stock-track/);
  assert.doesNotMatch(css, /\.product-stock-track/);
  assert.match(source, /Venda com renovação/);
  assert.match(source, /getProductRenewalPeriod/);
  assert.match(source, /productControlsStock/);
  assert.match(css, /\.mobile-product-swipe\.esgotado \.mobile-product-card\{border-left-color:#ef3d4f\}/);
});

test("formulário mobile possui header, conteúdo rolável e footer seguro", () => {
  const source = read("js/product-images.js");
  const css = read("css/product-images.css");
  assert.match(css, /\.product-form-modal form\{display:flex;min-height:0;flex:1 1 auto;flex-direction:column;overflow:hidden\}/);
  assert.match(css, /\.product-form-modal \.modal-body\{min-height:0;flex:1 1 auto;[^}]*overflow-y:auto/);
  assert.match(css, /\.product-form-modal \.modal-foot\{[^}]*safe-bottom/);
  assert.match(source, /window\.visualViewport/);
  assert.match(source, /Ative apenas se esta venda também consumir um item físico do seu estoque\./);
  assert.match(source, /recurring && !id && product\.controlaEstoque !== true/);
});

test("recorrente sem controle não consulta assinatura para renderizar cards", () => {
  const checkout = read("js/checkout.js");
  const mobile = read("js/checkout-mobile.js");
  const cardSection = checkout.slice(checkout.indexOf("const card ="), checkout.indexOf("const page ="));
  assert.doesNotMatch(cardSection, /customerSubscriptions/);
  assert.doesNotMatch(mobile.slice(0, mobile.indexOf("function paymentChips")), /customerSubscriptions/);
});
