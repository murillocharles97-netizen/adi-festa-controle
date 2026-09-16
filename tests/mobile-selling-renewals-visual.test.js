const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

test("fixture de Vender mantém grade em duas colunas, imagens no topo e sacola evidente", () => {
  const html = fs.readFileSync("tests/mobile-selling-renewals.fixture.html", "utf8");
  const css = fs.readFileSync("css/checkout-mobile.css", "utf8");
  const fixes = fs.readFileSync("css/mobile-fixes.css", "utf8");
  assert.match(html, /data-visual-ready="true"/);
  assert.match(html, /mobile-recent-products/);
  assert.doesNotMatch(html, /Ver todos/);
  assert.match(html, /data-open-renewal/);
  assert.match(css, /grid-template-columns:repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /aspect-ratio:1\.55\/1/);
  assert.match(css, /\.mobile-sale-page \.pos-bag\{left:12px;right:12px/);
  assert.match(fixes, /width:auto;height:auto;min-height:64px/);
  assert.doesNotMatch(css, /fly-to|mobileBagBump|bag-bump/);
});

test("fluxo visual de renovação apresenta cliente, período, valor, pagamento e novo vencimento", () => {
  const html = fs.readFileSync("tests/mobile-selling-renewals.fixture.html", "utf8");
  for (const text of ["Venda com renovação", "Renovar existente", "Período", "Valor", "Pagamento", "Renovado até"])
    assert.match(html, new RegExp(text));
});
