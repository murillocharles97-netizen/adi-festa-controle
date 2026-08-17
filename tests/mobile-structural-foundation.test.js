const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const read = (file) => fs.readFileSync(path.join(__dirname, "..", file), "utf8");

test("fundação mobile oficial cobre componentes, modal, safe area e seis viewports", () => {
  const css = read("css/mobile-components.css");
  const script = read("scripts/audit-mobile-structural.cjs");
  assert.match(css, /\.mobile-card/);
  assert.match(css, /\.mobile-button/);
  assert.match(css, /\.mobile-icon-button/);
  assert.match(css, /\.mobile-search/);
  assert.match(css, /\.mobile-chips/);
  assert.match(css, /\.mobile-tabs/);
  assert.match(css, /\.mobile-empty-state/);
  assert.match(css, /\.mobile-file-picker/);
  assert.match(css, /width:\s*calc\(100vw - 24px\)/);
  assert.match(css, /100dvh/);
  assert.match(css, /safe-area-inset-bottom/);
  for (const width of [320, 360, 375, 390, 412, 430]) assert.match(script, new RegExp(`\\[${width},`));
  assert.match(script, /getBoundingClientRect/);
  assert.match(script, /scrollWidth/);
});

test("CRM, Campanhas, Catálogo e Pedidos usam a mesma camada sem novas leituras Firebase", () => {
  const index = read("index.html");
  const modules = ["js/crm-mobile.js", "js/campanhas-ui.js", "js/catalogo-admin.js", "js/visitas.js"].map(read).join("\n");
  assert.ok(index.indexOf("engagement-operations.css") < index.indexOf("mobile-components.css"));
  assert.match(modules, /mobile-page/);
  assert.match(modules, /mobile-modal/);
  assert.match(modules, /mobile-file-picker/);
  assert.match(modules, /Progresso da campanha/);
  assert.match(modules, /Gerencie os pedidos online/);
  assert.doesNotMatch(modules, /\b(?:getDocs|getDoc|onSnapshot|collection|query)\s*\(/);
});

test("editores do catálogo não expõem file input ou checkbox nativo no visual", () => {
  const catalog = read("js/catalogo-admin.js");
  assert.match(catalog, /mobile-file-picker-button/);
  assert.match(catalog, /mobile-check-mark/);
  assert.doesNotMatch(catalog, /<label>Imagem(?: própria)?<input type="file"/);
  assert.match(catalog, /Editar categoria/);
  assert.match(catalog, /Editar produto/);
});
