const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

// Loja pública V3: mesmos invariantes da V2 (busca local, cartão que não compra sozinho,
// diálogos centrais no desktop, modalidade validada no servidor, enquadramento de foto e SEO).
const portal = fs.readFileSync("js/catalogo-publico.js", "utf8");
const css = fs.readFileSync("css/catalogo.css", "utf8");
const admin = fs.readFileSync("functions/src/shared/online-store.js", "utf8");
const orders = fs.readFileSync("functions/src/services/online-order-service.js", "utf8");
const html = fs.readFileSync("catalogo.html", "utf8");
const between = (from, to) => portal.slice(portal.indexOf(from), portal.indexOf(to, portal.indexOf(from)));

test("nomes longos encolhem sem espremer o botão do pedido", () => {
  assert.match(css, /\.sf-brand \{[^}]*min-width: 0/);
  assert.match(css, /\.sf-brand-copy \{[^}]*min-width: 0/);
  assert.match(css, /\.sf-brand h1 \{[^}]*overflow-wrap: anywhere/);
  assert.match(css, /\.sf-top-copy small \{[^}]*text-overflow: ellipsis/);
  assert.match(css, /\.sf-cart-btn \{[^}]*width: 48px/);
});

test("desktop usa vitrine e pedido em duas áreas sem converter o mobile", () => {
  assert.match(portal, /class="sf-layout"/);
  assert.match(portal, /class="sf-aside"/);
  assert.match(portal, /function asideCart\(\)/);
  assert.match(css, /@media \(min-width: 1024px\)/);
  assert.match(css, /\.sf-layout \{ grid-template-columns: minmax\(0, 1fr\) 340px;/);
  assert.match(css, /\.sf-aside \{ display: none; \}/);
  assert.match(css, /@media \(min-width: 1024px\) \{[\s\S]*\.sf-cartbar \{ display: none; \}/);
  assert.match(css, /\.sf-grid \{ display: grid; grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/);
});

test("busca, categorias e carrinho continuam locais", () => {
  assert.match(portal, /function searchResults\(\)/);
  assert.match(portal, /data-cat=/);
  assert.match(portal, /safeStorage\(cartKey/);
  for (const block of [between("function searchResults()", "\n"), between("function paintMain()", "\n"), between("function sections()", "\nfunction searchResults")])
    assert.doesNotMatch(block, /getDoc|callable\(|firebase\(\)/);
});

test("cartões não adicionam produto ao tocar no conteúdo", () => {
  assert.match(portal, /class="sf-card-open" data-open=/);
  assert.match(portal, /class="sf-add \$\{qty\?'has-qty':''\}" data-add=/);
  const click = between("root.addEventListener('click',event=>{", "root.addEventListener('input'");
  assert.ok(click.indexOf("closest('[data-add]')") < click.indexOf("closest('[data-open]')"), "o botão + é tratado antes de abrir o detalhe");
  assert.match(click, /const open=t\.closest\('\[data-open\]'\);if\(open\)\{openSheet\(/);
});

test("detalhe e variação abrem em diálogo central no desktop e em folha no celular", () => {
  assert.match(portal, /class="sf-sheet sf-product" role="dialog" aria-modal="true"/);
  assert.match(portal, /function groupsOf\(item\)/);
  assert.match(css, /\.sf-sheet \{ position: fixed; z-index: 51; left: 0; right: 0; bottom: 0;/);
  assert.match(css, /\.sf-sheet \{ left: 50%; top: 50%; right: auto; bottom: auto;[^}]*transform: translate\(-50%, -50%\)/);
});

test("modalidade escolhida é validada e persistida pelo engine atual", () => {
  assert.match(portal, /serviceModeId:data\.serviceModeId\|\|null/);
  assert.match(orders, /serviceMode/);
  assert.match(orders, /Entrega ou retirada não disponível/);
  assert.match(orders, /serviceModeId:serviceMode/);
  assert.match(orders, /serviceModeType:serviceMode/);
  assert.match(orders, /serviceModeLabel:/);
});

test("apresentação pública preserva enquadramento sem leituras de metadata", () => {
  assert.match(admin, /productImage:image/);
  assert.match(admin, /productMainImage:image/);
  assert.match(portal, /function imageStyle\(item\)/);
  assert.match(css, /--catalog-image-fit/);
  assert.doesNotMatch(portal, /getMetadata|listAll|firebase-storage/);
});

test("SEO básico e cache bust da loja estão versionados", () => {
  assert.match(html, /meta name="description"/);
  assert.match(html, /catalogo\.css\?v=2425/);
  assert.match(html, /catalogo-publico\.js\?v=2425/);
  assert.match(html, /loja\/store-kit\.js\?v=2425/);
  assert.match(portal, /document\.title=`\$\{brand\} — Catálogo online`/);
});
