const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (file) => fs.readFileSync(file, "utf8");
const ui = read("js/campanhas-ui.js");
const css = read("css/campanhas-mobile.css");
const sharedCss = read("css/campanhas.css");
const navigation = read("js/barcode.js");

test("tela principal mobile usa carrossel largo com snap sem alterar a grade desktop", () => {
  assert.match(css, /@media \(max-width: 767px\)[\s\S]*?\.campaign-v2-page \.campaign-metrics/);
  assert.match(css, /flex:\s*0 0 clamp\(238px, 74vw, 292px\)/);
  assert.match(css, /scroll-snap-type:\s*x mandatory/);
  assert.match(css, /scroll-snap-align:\s*start/);
  assert.match(css, /scrollbar-width:\s*none/);
  assert.match(sharedCss, /\.campaign-metrics\{display:grid;grid-template-columns:repeat\(5,minmax\(0,1fr\)\)/);
});

test("cabeçalho duplicado e FAB extra ficam removidos apenas na tela principal mobile", () => {
  assert.match(css, /\.campaign-v2-page > \.campaign-page-head\s*\{\s*display:\s*none/);
  assert.match(css, /\.campaign-v2-page \.campaign-fab\s*\{\s*display:\s*none !important/);
  assert.match(sharedCss, /\.campaign-page-head\{margin:0\}/);
});

test("busca, filtros e chips permanecem compactos e horizontais", () => {
  assert.match(ui, /class="campaign-search-row"/);
  assert.match(ui, /data-campaign-filter-shortcut/);
  assert.match(css, /grid-template-columns:\s*minmax\(0, 1fr\) auto/);
  assert.match(css, /\.campaign-v2-page \.campaign-filter-chips[\s\S]*?flex-wrap:\s*nowrap/);
  assert.match(css, /\.campaign-v2-page \.campaign-filter-chips[\s\S]*?overflow-x:\s*auto/);
});

test("cards mobile exibem somente dados compactos e mantêm menu e abertura de detalhes", () => {
  assert.match(ui, /campaign-card-meta[\s\S]*?icon\("users"\)[\s\S]*?icon\("calendar-days"\)/);
  assert.match(ui, /data-campaign-card/);
  assert.match(ui, /data-campaign-menu/);
  assert.match(css, /\.campaign-v2-page \.campaign-card-meta span:nth-child\(n \+ 3\)\s*\{\s*display:\s*none/);
  assert.match(ui, /data-mobile-label="\$\{status\.class === "scheduled" \? "Programada"/);
});

test("item central da navegação vira Campanhas com sinal de mais e abre o wizard", () => {
  assert.match(navigation, /campanhas:\s*\{\s*icon:\s*"plus",\s*label:\s*"Campanhas",\s*action:\s*"new-campaign"/);
  assert.match(ui, /function bindMobilePrimaryAction\(\)/);
  assert.match(ui, /button\.dataset\.primaryAction !== "new-campaign"/);
  assert.match(css, /mobile-client-fab\[data-primary-action="new-campaign"\]/);
});

test("somente trilhos intencionais têm rolagem horizontal", () => {
  assert.match(css, /\.campaign-v2-page\s*\{[\s\S]*?overflow-x:\s*clip/);
  assert.equal((css.match(/\.campaign-v2-page \.campaign-metrics/g) || []).length > 0, true);
  assert.equal((css.match(/\.campaign-v2-page \.campaign-filter-chips/g) || []).length > 0, true);
});
