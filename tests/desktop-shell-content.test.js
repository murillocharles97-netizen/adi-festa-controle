const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/client-actions.js", "utf8");
const fixture = fs.readFileSync("tests/desktop-shell-content.fixture.html", "utf8");
const mobileHome = fs.readFileSync("js/home-mobile.js", "utf8");

function createHarness() {
  let observerCallback = null;
  let menu = null;
  let iconRenders = 0;
  const app = {};
  const document = {
    addEventListener() {},
    querySelector(selector) {
      if (selector === "#app") return app;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === ".client-more-menu:not([data-shared-actions])")
        return menu && menu.dataset.sharedActions !== "true" ? [menu] : [];
      return [];
    },
  };
  class MutationObserver {
    constructor(callback) {
      observerCallback = callback;
    }
    observe() {}
  }
  const sandbox = {
    window: null,
    document,
    MutationObserver,
    matchMedia: () => ({ matches: false }),
    queueMicrotask,
    Clientes: { obter: () => ({ id: "c1", nome: "Ana", telefone: "17999999999", saldo: 0 }) },
    Utils: { escapar: String, dinheiro: String, telefoneWhatsApp: String },
    OperationMode: { enabled: () => true },
    console,
  };
  sandbox.window = sandbox;
  sandbox.lucide = { createIcons: () => iconRenders++ };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox);
  return {
    mutation: () => observerCallback?.([]),
    addMenu() {
      menu = { dataset: { menuFor: "c1" }, innerHTML: "" };
      return menu;
    },
    iconRenders: () => iconRenders,
  };
}

const flushMicrotasks = () => new Promise((resolve) => setImmediate(resolve));

test("mutações do dashboard desktop não iniciam um ciclo de renderização de ícones", async () => {
  const harness = createHarness();
  await flushMicrotasks();
  assert.equal(harness.iconRenders(), 0);
  harness.mutation();
  harness.mutation();
  await flushMicrotasks();
  assert.equal(harness.iconRenders(), 0);
});

test("menu novo é aprimorado uma vez e mutações do Lucide não repetem o trabalho", async () => {
  const harness = createHarness();
  await flushMicrotasks();
  const menu = harness.addMenu();
  harness.mutation();
  await flushMicrotasks();
  assert.equal(menu.dataset.sharedActions, "true");
  assert.equal(harness.iconRenders(), 1);
  harness.mutation();
  await flushMicrotasks();
  assert.equal(harness.iconRenders(), 1);
});

test("fixture de browser cobre shell, conteúdo e rotas desktop reais", () => {
  assert.match(fixture, /desktop-dashboard\.js/);
  assert.match(fixture, /app\.js/);
  assert.match(fixture, /firebase-auth-ready/);
  for (const route of ["inicio", "clientes", "produtos", "crm", "configuracoes"])
    assert.match(fixture, new RegExp(`(?:\\[|\")${route}(?:\"|\\])`));
  assert.match(fixture, /appChildren/);
  assert.match(fixture, /elementFromPoint/);
  assert.match(fixture, /__desktopAuditErrors/);
});

test("mudança de breakpoint troca somente o renderer da Home", () => {
  assert.match(mobileHome, /AppPageRuntime\?\.mount\?\.\('inicio'\)/);
  assert.doesNotMatch(mobileHome, /location\.reload\(\)/);
});
