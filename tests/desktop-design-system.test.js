const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.resolve(__dirname, "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

test("Desktop UI System centraliza os tokens oficiais", () => {
  const css = read("css/design-system/tokens.css");
  for (const token of [
    "--af-color-primary", "--af-color-navy", "--af-color-text",
    "--af-color-success", "--af-color-warning", "--af-color-danger",
    "--af-radius-md", "--af-shadow-md", "--af-space-4",
    "--af-font-page", "--af-control-height-md", "--af-page-max",
  ]) assert.match(css, new RegExp(token));
});

test("componentes oficiais permanecem limitados ao desktop", () => {
  const css = read("css/design-system/desktop.css");
  assert.match(css, /@media \(min-width: 768px\)/);
  for (const component of [
    ".af-page-header", ".af-grid-2", ".af-card", ".af-button",
    ".af-field", ".af-form-section", ".af-modal", ".af-wizard",
    ".af-tabs", ".af-chip", ".af-badge", ".af-empty", ".af-table",
    ".af-menu", ".af-skeleton", "[data-tooltip]",
  ]) assert.ok(css.includes(component), `Componente ausente: ${component}`);
  assert.doesNotMatch(css, /onSnapshot|firebase|firestore|getDocs|addEventListener/);
});

test("index carrega tokens antes dos módulos e o desktop system por último", () => {
  const html = read("index.html");
  const tokens = html.indexOf("css/design-system/tokens.css?v=94");
  const campaigns = html.indexOf("css/campanhas.css?v=94");
  const desktop = html.indexOf("css/design-system/desktop.css?v=94");
  assert.ok(tokens > 0 && tokens < campaigns);
  assert.ok(desktop > campaigns);
  assert.match(html, /desktop-nav-section[^>]*>Gestão</);
  assert.match(html, /desktop-nav-section[^>]*>Vendas online</);
  assert.match(html, /desktop-nav-section[^>]*>Análises</);
  assert.match(html, /desktop-nav-section[^>]*>Sistema</);
});

test("Campaign Wizard V2 usa os componentes oficiais nas cinco etapas", () => {
  const js = read("js/campanhas-ui.js");
  for (const pane of ["objective", "rule", "reward", "audience", "review"])
    assert.ok(js.includes(`data-wizard-pane="${pane}"`), `Etapa ausente: ${pane}`);
  for (const component of ["af-wizard", "af-wizard__steps", "af-wizard__content", "af-wizard__footer", "af-option-card", "af-form-section", "af-field", "af-switch"])
    assert.ok(js.includes(component), `Wizard não usa ${component}`);
  assert.match(js, /wizard\.step > index \+ 1 \? "completed" : "future"/);
  assert.match(js, /campaign-review-summary/);
  assert.match(js, /campaign-review-sections/);
});

test("a cascata antiga não bloqueia o novo wizard desktop", () => {
  const css = read("css/campanhas.css");
  const desktopRule = css.match(/\.campaign-type-choice\{position:relative;[^\n]+/)?.[0] || "";
  assert.ok(desktopRule);
  assert.doesNotMatch(desktopRule, /!important/);
  assert.match(css, /@media\(max-width:767px\)[\s\S]*\.campaign-type-choice\{[^}]*!important/);
});

test("documentação e galeria cobrem a fundação oficial", () => {
  const docs = read("DESIGN_SYSTEM_DESKTOP.md");
  const fixture = read("tests/desktop-design-system.fixture.html");
  assert.match(docs, /novo componente desktop deve primeiro verificar/i);
  for (const word of ["Tokens", "Botões", "Formulários", "Modal", "Wizard", "Breakpoints", "Acessibilidade"])
    assert.match(docs, new RegExp(word));
  for (const component of ["af-button", "af-field", "af-switch", "af-card", "af-badge", "af-modal", "af-tabs", "af-wizard", "af-empty"])
    assert.ok(fixture.includes(component), `Galeria sem ${component}`);
});
