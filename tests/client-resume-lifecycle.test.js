const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const pagerSource = fs.readFileSync("js/client-cloud-pagination.js", "utf8");
const mobileSource = fs.readFileSync("js/clientes-mobile.js", "utf8");
const syncSource = fs.readFileSync("js/firebase/sync.js", "utf8");
const appSource = fs.readFileSync("js/app.js", "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function pageFixture() {
  const list = {
    innerHTML: "",
    querySelectorAll: () => [],
    insertAdjacentElement() {},
  };
  const page = {
    dataset: {},
    classList: { toggle() {} },
    setAttribute() {},
    querySelector: (selector) => selector === "#mobile-client-list" ? list : null,
    querySelectorAll: () => [],
  };
  return { page, list };
}

function environment() {
  const state = { query: "kaique", filter: "todos", sort: "nomeAsc" };
  let active = pageFixture();
  const pending = [];
  const context = {
    window: null,
    document: {
      querySelector: (selector) => selector === "#app" ? {} : selector === "#app .clients-page" ? active.page : null,
      contains: (node) => node === active.page,
      createElement: () => ({ dataset: {}, set type(_) {}, className: "", textContent: "" }),
    },
    navigator: { onLine: true },
    matchMedia: () => ({ matches: true }),
    MutationObserver: class { observe() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    addEventListener() {},
    queueMicrotask,
    setTimeout,
    clearTimeout,
    console,
    Map,
    JSON,
    Date,
  };
  context.window = context;
  context.ClientesMobile = {
    getState: () => ({ ...state }),
    restoreActiveState: () => ({ ...state }),
    renderCard: (client) => `<article data-mobile-card="${client.id}">${client.nome}:${client.saldo}</article>`,
    bindCard() {},
  };
  context.SyncFirebase = {
    queryClientsPage: (options) => new Promise((resolve) => pending.push({ options, resolve })),
  };
  vm.createContext(context);
  vm.runInContext(pagerSource, context);
  return {
    context,
    state,
    pending,
    active: () => active,
    replacePage: () => { active = pageFixture(); return active; },
  };
}

test("retomada preserva busca e refaz somente a query ativa", async () => {
  const env = environment();
  await tick();
  assert.equal(env.pending.length, 1);
  env.pending[0].resolve({ items: [{ id: "k", nome: "Kaique", saldo: -10 }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  assert.match(env.active().list.innerHTML, /Kaique:-10/);

  env.context.ClientCloudPagination.resume("visibilitychange");
  await tick();
  await tick();
  assert.equal(env.pending.length, 2);
  assert.equal(env.pending[1].options.search, "kaique");
  assert.equal(env.pending[1].options.filter, "todos");
  env.pending[1].resolve({ items: [{ id: "k", nome: "Kaique", saldo: 0 }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  assert.match(env.active().list.innerHTML, /Kaique:0/);
});

test("troca do DOM durante busca agenda uma nova consulta em vez de ficar vazia", async () => {
  const env = environment();
  await tick();
  const replaced = env.replacePage();
  env.pending[0].resolve({ items: [{ id: "k", nome: "Kaique", saldo: 0 }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  await tick();
  await tick();
  assert.equal(env.pending.length, 2);
  env.pending[1].resolve({ items: [{ id: "k", nome: "Kaique", saldo: 0 }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  assert.match(replaced.list.innerHTML, /Kaique:0/);
});

test("estado, filtros e eventos de retorno permanecem centralizados", () => {
  assert.match(appSource, /ClientesMobile\?\.setSearchTerm\?\.\(value\)/);
  assert.match(mobileSource, /setSearchTerm\(query\)/);
  assert.match(mobileSource, /restoreActiveState/);
  assert.match(mobileSource, /state\.filter==='todos'/);
  assert.match(mobileSource, /state\.filter==='debito'&&Number\(c\.saldo\)<0/);
  assert.match(syncSource, /ClientCloudPagination\?\.resume\?\.\("visibilitychange"\)/);
  assert.match(pagerSource, /event\.persisted/);
  assert.match(pagerSource, /pageshow-bfcache/);
  assert.match(syncSource, /notify: false/);
});
