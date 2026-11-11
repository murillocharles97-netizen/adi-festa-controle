const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");

// Renders the real mobile checkout (checkout.js + checkout-mobile.js) in jsdom
// with synthetic data, so the Vender layout is checked by behavior.
// Let deferred enhancement timers run before the window goes away.
const settle = async h => { await new Promise(resolve => setTimeout(resolve, 30)); h.dom.window.close(); };

function mobileSale({ owner = true } = {}) {
  const dom = new JSDOM('<main id="app"></main><div id="modal"></div><div id="toasts"></div>', { runScripts: "outside-only", pretendToBeVisual: true, url: "http://localhost/" });
  const w = dom.window, toasts = [], added = [], opened = [];
  const products = [
    { id: "cone", nome: "Cone recheado", categoria: "Doces", preco: 12, estoqueAtual: 18, estoqueMinimo: 2, favorito: true, ativo: true },
    { id: "iptv", nome: "IPTV", categoria: "Serviços", preco: 25.9, productType: "recurring", durationValue: 30, durationUnit: "days", semControleEstoque: true, controlaEstoque: false, ativo: true },
    { id: "coca", nome: "Coca zero 220ml", categoria: "Bebidas", preco: 2.8, estoqueAtual: 2, estoqueMinimo: 5, ativo: true },
    { id: "poty", nome: "Poty 220ml", categoria: "Bebidas", preco: 2.5, estoqueAtual: 0, ativo: true },
  ];
  const sale = (id, produtoId, minutes) => ({ id, spaceId: "space-a", status: "pago", data: new Date(Date.now() - minutes * 60000).toISOString(), itens: [{ produtoId, quantidade: 1 }] });
  const data = { produtos: products, clientes: [], vendas: [sale("s1", "coca", 3), sale("s2", "iptv", 2)], pagamentos: [], variacoesProdutos: [], customerSubscriptions: [] };
  const byId = id => products.find(item => item.id === id);
  let route = "vender";
  Object.assign(w, {
    structuredClone,
    matchMedia: query => ({ matches: /max-width:\s*767px/.test(query), media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} }),
    Utils: { escapar: value => String(value ?? "").replace(/[&<>"']/g, char => `&#${char.charCodeAt(0)};`), dinheiro: value => `R$ ${Number(value || 0).toFixed(2).replace(".", ",")}`, somenteNumeros: value => String(value || "").replace(/\D/g, ""), uuid: () => "draft-id", toast: message => toasts.push(message) },
    DB: { carregar: () => data, alterar(mutator) { mutator(data); return data; }, getBusinessId: () => "business-a" },
    Router: { atual: () => route, ir: next => { route = next; } },
    SpaceContext: { salesId: () => "space-a", viewScope: () => "space-a", list: () => [{ id: "space-a" }], renderBar: () => '<section class="space-context-bar" data-space-context="sales"><label><span>Espaço ativo</span><select data-space-select="sales"><option>Adi festa</option></select></label><button type="button" data-space-manage>Gerenciar</button></section>' },
    Repositories: {
      productRepository: () => ({ list: () => products, getById: byId }),
      clientRepository: () => ({ list: () => [], getById: () => null }),
      saleRepository: () => ({ list: () => data.vendas }),
    },
    Produtos: { obter: byId, mobileFavoriteValue: item => Boolean(item.favorito), toggleMobileFavorite() {} },
    ProductVariations: { isVariable: () => false, list: () => [], saleItem: (item, choice, quantidade) => ({ produtoId: item.id, nome: item.nome, quantidade }) },
    getProductStockStatus: item => (item.semControleEstoque ? "sem-controle" : item.estoqueAtual <= 0 ? "esgotado" : item.estoqueAtual <= Number(item.estoqueMinimo || 0) ? "baixo" : "normal"),
    getProductRenewalPeriod: item => `${item.durationValue} dias`,
    PriorSales: owner ? { actionMarkup: () => '<button type="button" class="btn btn-light prior-sale-trigger" data-prior-start>Registrar venda anterior</button>', active: () => false, locked: () => false, mount() {} } : undefined,
    BarcodeWorkflows: { sale: () => opened.push("scan") },
    ProdutosMobile: { productForm: () => opened.push("product") },
    TeamAccess: { has: permission => owner || permission !== "products.edit" },
  });
  for (const file of ["js/checkout.js", "js/checkout-mobile.js"]) w.eval(fs.readFileSync(file, "utf8"));
  w.addEventListener("sale-item-added", event => added.push(event.detail?.item));
  const app = w.document.querySelector("#app");
  app.innerHTML = w.Checkout.view();
  w.Checkout.enhance();
  w.CheckoutMobile.enhance();
  const names = () => [...app.querySelectorAll("#pos-grid .pos-product")].filter(card => !card.hidden)
    .sort((a, b) => Number(a.style.order || 0) - Number(b.style.order || 0))
    .map(card => card.querySelector("strong").textContent.trim());
  const click = selector => app.querySelector(selector).dispatchEvent(new w.MouseEvent("click", { bubbles: true }));
  return { w, dom, app, names, click, toasts, added, opened };
}

test("Vender mobile mostra o período de renovação no card do produto recorrente", async () => {
  const h = mobileSale();
  try {
    const card = h.app.querySelector('.pos-product[data-add="iptv"]');
    assert.ok(card.classList.contains("is-recurring"));
    const badge = card.querySelector(".mobile-card-stock > .pos-renewal-badge");
    assert.ok(badge, "o card recorrente precisa exibir o selo de renovação");
    assert.equal(badge.textContent.trim(), "30 dias");
    // Visual-only overrides must keep the renewal badge as a badge (not plain stock text).
    const css = fs.readFileSync("css/checkout-mobile.css", "utf8");
    assert.match(css, /\.mobile-card-stock > :is\(em, small\):not\(\.pos-renewal-badge\)/);
    assert.doesNotMatch(css, /pos-renewal-badge\s*\{[^}]*display:\s*none/);
  } finally { await settle(h); }
});

test("Vender mobile troca a faixa Últimos vendidos por um filtro que preserva renovações", async () => {
  const h = mobileSale();
  try {
    assert.equal(h.app.querySelector(".mobile-recent-products"), null, "a faixa separada foi removida");
    const chips = [...h.app.querySelectorAll("button[data-sale-filter]")].map(button => button.dataset.saleFilter);
    assert.deepEqual(chips, ["quick", "favorites", "sold", "recent", "low"]);
    const all = h.names();
    h.click('button[data-sale-filter="recent"]');
    assert.deepEqual(h.names(), ["IPTV", "Coca zero 220ml"], "mais recente primeiro, incluindo o recorrente");
    assert.equal(h.app.querySelector('.pos-product[data-add="iptv"] .pos-renewal-badge').textContent.trim(), "30 dias");
    // The page keeps its own state attribute separate from the chip selector.
    assert.equal(h.app.querySelector(".pos-page").dataset.saleView, "recent");
    assert.equal(h.app.querySelector(".pos-page").hasAttribute("data-sale-filter"), false);
    h.click('button[data-sale-filter="quick"]');
    assert.deepEqual(h.names().sort(), all.slice().sort());
    assert.equal([...h.app.querySelectorAll("#pos-grid .pos-product")].some(card => card.style.order), false);
  } finally { await settle(h); }
});

test("Ações reúne atalhos existentes e respeita permissões", async () => {
  const owner = mobileSale();
  try {
    owner.click("[data-sale-actions-toggle]");
    const menu = [...owner.w.document.querySelectorAll("#modal [data-sale-action]")].map(button => button.dataset.saleAction);
    assert.deepEqual(menu, ["scan", "prior", "product", "spaces"]);
    owner.w.document.querySelector('#modal [data-sale-action="product"]').click();
    assert.deepEqual(owner.opened, ["product"]);
    assert.equal(owner.w.document.querySelector("#modal").innerHTML, "");
  } finally { await settle(owner); }
  const seller = mobileSale({ owner: false });
  try {
    seller.click("[data-sale-actions-toggle]");
    const menu = [...seller.w.document.querySelectorAll("#modal [data-sale-action]")].map(button => button.dataset.saleAction);
    assert.ok(!menu.includes("prior"), "venda anterior só para o proprietário");
    assert.ok(!menu.includes("product"), "novo produto exige products.edit");
  } finally { await settle(seller); }
});
