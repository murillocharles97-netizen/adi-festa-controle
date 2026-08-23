const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/crm-mobile.js", "utf8");
const css = fs.readFileSync("css/crm-mobile.css", "utf8");

function setup({ reduced = false } = {}) {
  const calls = [];
  const modal = { innerHTML: "sheet" };
  const targets = {
    "#crm-results-anchor": { scrollIntoView: (options) => calls.push({ target: "results", ...options }) },
    "#crm-segments-anchor": { scrollIntoView: (options) => calls.push({ target: "segments", ...options }) },
    "#modal": modal,
  };
  const state = { segment: "", query: "", limit: 20, resultsVisible: false, resultLabel: "", customConditions: [{ field: "balance" }], customMatchMode: "any" };
  const selected = [];
  let invalidations = 0;
  let refreshes = 0;
  const context = {
    window: null,
    document: { querySelector: (selector) => targets[selector] || null, querySelectorAll: () => [] },
    matchMedia: (query) => ({ matches: query.includes("max-width") || (reduced && query.includes("reduced-motion")) }),
    requestAnimationFrame: (callback) => callback(),
    setTimeout: (callback) => callback(),
    clearTimeout() {},
    Utils: { dinheiro: String, escapar: String },
    OperationMode: { enabled: () => true },
    DB: { carregar: () => ({ segmentosClientes: [] }) },
    CRMDashboard: {
      state,
      selectSegment: (id) => selected.push(id),
      applySavedSegment: (saved) => {
        state.resultLabel = saved.name;
        state.resultsVisible = true;
        state.customMatchMode = saved.matchMode;
        state.customConditions = saved.conditions.map((item) => ({ ...item }));
        invalidations++;
        refreshes++;
      },
      invalidate: () => invalidations++,
      refresh: () => refreshes++,
    },
    Date, Math, Number, String, Array, Object, Boolean, Set, Map,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, calls, state, selected, modal, counts: () => ({ invalidations, refreshes }) };
}

test("segmento explícito aplica uma vez e rola uma vez até os resultados", () => {
  const { context, calls, state, selected } = setup();
  context.CRMMobile.applyAutomaticSegment("inactive30", "Sumidos há 30 dias");
  assert.deepEqual(selected, ["inactive30"]);
  assert.equal(state.resultLabel, "Sumidos há 30 dias");
  assert.equal(state.customConditions.length, 0);
  assert.deepEqual(calls, [{ target: "results", behavior: "smooth", block: "start" }]);
});

test("reduced motion preserva o auto-scroll sem animação", () => {
  const { context, calls } = setup({ reduced: true });
  context.CRMMobile.scrollToResults();
  assert.deepEqual(calls, [{ target: "results", behavior: "auto", block: "start" }]);
});

test("segmento salvo aplica condições, fecha folha e rola aos resultados", () => {
  const { context, calls, state, modal, counts } = setup();
  context.CRMMobile.applySavedSegment({ name: "Clientes com saldo", matchMode: "all", conditions: [{ field: "balance", operator: "gt", value: "0" }] });
  assert.equal(modal.innerHTML, "");
  assert.equal(state.resultLabel, "Clientes com saldo");
  assert.equal(state.resultsVisible, true);
  assert.equal(state.customConditions[0].field, "balance");
  assert.deepEqual(counts(), { invalidations: 1, refreshes: 1 });
  assert.deepEqual(calls, [{ target: "results", behavior: "smooth", block: "start" }]);
});

test("layout mobile define carrossel compacto, cards oficiais e filtro de 50px", () => {
  assert.match(css, /\.crm-opportunity-grid\{display:flex/);
  assert.match(css, /scroll-snap-type:x proximity/);
  assert.match(css, /flex:0 0 clamp\(158px,44vw,174px\)/);
  assert.match(css, /height:124px/);
  assert.match(css, /\.crm-mobile-entry-card\{appearance:none/);
  assert.match(css, /flex:0 0 50px/);
  assert.doesNotMatch(source, /addEventListener\(["']scroll["']/);
});

test("auto-scroll fica restrito às ações explícitas e não ao lifecycle", () => {
  const builder = fs.readFileSync("js/crm-segment-builder.js", "utf8");
  assert.doesNotMatch(source, /addEventListener\(["'](?:visibilitychange|pageshow|pagehide|focus)["']/);
  assert.match(source, /applyAutomaticSegment[\s\S]*scrollToResults\(\)/);
  assert.match(source, /CRMSegmentBuilder\?\.open\?\.\(\{ onApply: scrollToResults \}\)/);
  assert.match(builder, /data-builder-apply/);
  assert.match(builder, /options\.onApply\?\.\(stored\)/);
  assert.match(source, /data-crm-back-overview[\s\S]*scrollToSegments\(\)/);
});

test("camada mobile é carregada depois do CSS compartilhado", () => {
  const html = fs.readFileSync("index.html", "utf8");
  assert.ok(html.indexOf("engagement-operations.css") < html.indexOf("crm-mobile.css"));
});
