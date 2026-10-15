const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const portal = fs.readFileSync("js/catalogo-publico.js", "utf8");
const css = fs.readFileSync("css/catalogo.css", "utf8");
const admin = fs.readFileSync("functions/src/shared/online-store.js", "utf8");
const orders = fs.readFileSync("functions/src/services/online-order-service.js", "utf8");
const functions = fs.readFileSync("functions/src/index.js", "utf8");
const html = fs.readFileSync("catalogo.html", "utf8");

test("long store names can shrink without squeezing or clipping cart/back controls",()=>{
 const v2Css=fs.readFileSync("css/online-store-public.css","utf8");
 assert.match(v2Css,/\.catalog-header \.catalog-brand\{min-width:0;overflow:hidden;text-overflow:ellipsis;flex-shrink:1\}/);
 assert.match(v2Css,/\.catalog-header \.cart-button,\.catalog-header \.back-button\{flex-shrink:0\}/);
});

test("desktop usa catálogo e pedido em duas áreas sem converter o mobile", () => {
  assert.match(portal, /desktop-catalog-layout/);
  assert.match(portal, /catalog-desktop-sidebar/);
  assert.match(portal, /desktopCartPanel/);
  assert.match(css, /@media\(min-width:900px\)/);
  assert.match(css, /grid-template-columns:minmax\(0,1fr\) minmax\(280px,320px\)/);
  assert.match(css, /@media\(min-width:1450px\).*repeat\(4,minmax\(0,1fr\)\)/s);
  assert.match(css, /\.catalog-desktop-sidebar\{display:none\}/);
  assert.match(css, /\.catalog-bottom,.floating-cart\{display:none\}/);
});

test("busca, categoria, filtros e carrinho continuam locais", () => {
  assert.match(portal, /function filteredCatalogItems\(\)/);
  assert.match(portal, /data-quick-filter/);
  assert.match(portal, /data-load-more/);
  assert.match(portal, /safeStorage\(cartKey/);
  assert.doesNotMatch(portal, /#catalog-search[^\n]*getDoc/);
  assert.doesNotMatch(portal, /data-quick-filter[^\n]*getDoc/);
});

test("cards não adicionam produto ao clicar no conteúdo", () => {
  assert.match(portal, /data-product-details/);
  assert.match(portal, /productDetailsId=details\.dataset\.productDetails/);
  assert.doesNotMatch(portal, /const card=.*product-card[\s\S]{0,220}changeCart\(card\.dataset/);
  assert.match(portal, /data-action="add-to-cart"/);
});

test("modal e seletor de variação são centrais no desktop", () => {
  assert.match(portal, /product-details-dialog/);
  assert.match(portal, /catalog-variant-sheet/);
  assert.match(css, /\.catalog-variant-sheet\{left:50%;top:50%;bottom:auto/);
  assert.match(css, /\.product-details-dialog\{left:50%;top:50%;bottom:auto/);
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

test("SEO básico e cache bust do catálogo estão versionados", () => {
  assert.match(html, /meta name="description"/);
  assert.match(html, /catalogo\.css\?v=123/);
  assert.match(html, /catalogo-publico\.js\?v=171/);
  assert.match(portal, /document\.title=`\$\{brand\} — Catálogo online`/);
});
