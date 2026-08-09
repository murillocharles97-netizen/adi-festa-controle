const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const pagerSource = fs.readFileSync("js/client-cloud-pagination.js", "utf8");
const lifecycleSource = fs.readFileSync("js/lifecycle-manager.js", "utf8");
const filterRulesSource = fs.readFileSync("js/client-filter-rules.js", "utf8");
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
  let localClients = [];
  const pending = [];
  const listeners = new Map();
  const listen = (name, callback) => {
    if (!listeners.has(name)) listeners.set(name, []);
    listeners.get(name).push(callback);
  };
  const context = {
    window: null,
    document: {
      querySelector: (selector) => selector === "#app" ? {} : selector === "#app .clients-page" ? active.page : null,
      contains: (node) => node === active.page,
      createElement: () => ({ dataset: {}, set type(_) {}, className: "", textContent: "" }),
      visibilityState: "visible",
      addEventListener: listen,
    },
    navigator: { onLine: true },
    matchMedia: () => ({ matches: true }),
    MutationObserver: class { observe() {} },
    IntersectionObserver: class { observe() {} disconnect() {} },
    addEventListener: listen,
    dispatchEvent(event) {
      for (const callback of listeners.get(event.type) || []) callback(event);
    },
    CustomEvent: class {
      constructor(type, options = {}) { this.type = type; this.detail = options.detail; }
    },
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
  context.Clientes = { listar: () => localClients };
  context.SyncFirebase = {
    queryClientsPage: (options) => new Promise((resolve) => pending.push({ options, resolve })),
  };
  vm.createContext(context);
  vm.runInContext(filterRulesSource, context);
  vm.runInContext(lifecycleSource, context);
  vm.runInContext(pagerSource, context);
  return {
    context,
    state,
    pending,
    active: () => active,
    setLocalClients: (items) => { localClients = items; },
    replacePage: () => { active = pageFixture(); return active; },
    async emit(name, detail = {}) {
      const event = { type: name, detail, persisted: Boolean(detail.persisted) };
      const results = [];
      for (const callback of listeners.get(name) || []) results.push(callback(event));
      await Promise.allSettled(results.filter(Boolean));
      await tick();
    },
  };
}

test("Todos preserva cliente local zerado ausente do índice cloud legado", async () => {
  const env = environment();
  env.setLocalClients([{ id: "j", nome: "Jessica Arezzo", saldo: 0, ativo: true }]);
  env.state.query = "Jessic";
  await tick();
  env.pending[0].resolve({ items: [], cursor: null, hasMore: false, documentsRead: 0 });
  await tick();
  assert.match(env.active().list.innerHTML, /Jessica Arezzo:0/);
});

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

test("resposta válida é entregue ao DOM atual sem criar segunda consulta", async () => {
  const env = environment();
  await tick();
  const replaced = env.replacePage();
  env.pending[0].resolve({ items: [{ id: "k", nome: "Kaique", saldo: 0 }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  assert.equal(env.pending.length, 1);
  assert.match(replaced.list.innerHTML, /Kaique:0/);
});

test("depois do resume a segunda e a terceira busca continuam utilizáveis", async () => {
  const env = environment();
  await tick();
  env.pending[0].resolve({ items: [{ id: "k", nome: "Kaique", saldo: 0 }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  const resumed = env.context.ClientCloudPagination.resume("visibilitychange");
  await tick();
  env.pending[1].resolve({ items: [{ id: "k", nome: "Kaique", saldo: 0 }], cursor: null, hasMore: false, documentsRead: 1 });
  await resumed;
  await tick();

  env.state.query = "jessica";
  env.context.ClientCloudPagination.cancel();
  env.context.ClientCloudPagination.activate(true, { fresh: true, reason: "input" });
  await tick();
  env.pending[2].resolve({ items: [{ id: "j", nome: "Jessica", saldo: -20 }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  assert.match(env.active().list.innerHTML, /Jessica:-20/);

  env.state.query = "maria";
  env.context.ClientCloudPagination.cancel();
  env.context.ClientCloudPagination.activate(true, { fresh: true, reason: "input" });
  await tick();
  env.pending[3].resolve({ items: [{ id: "m", nome: "Maria", saldo: 0 }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  assert.match(env.active().list.innerHTML, /Maria:0/);
});

test("pagamento + sync + background não corrompem buscas seguintes", async () => {
  const env = environment();
  await tick();
  env.pending[0].resolve({ items: [{ id: "k", nome: "Kaique", saldo: -10 }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();

  // O pagamento atualiza clientes e o app sai para o WhatsApp antes do
  // debounce do evento de nuvem terminar.
  await env.emit("cloud-data-updated", { collection: "clients", source: "payment" });
  env.context.document.visibilityState = "hidden";
  await env.emit("visibilitychange");
  env.context.document.visibilityState = "visible";
  const resumed = env.emit("visibilitychange");
  await new Promise((resolve) => setTimeout(resolve, 150));
  for (const request of env.pending.slice(1))
    request.resolve({ items: [{ id: "k", nome: "Kaique", saldo: 0 }], cursor: null, hasMore: false, documentsRead: 1 });
  await resumed;
  await tick();
  assert.match(env.active().list.innerHTML, /Kaique:0/);

  env.state.query = "jessica";
  env.context.ClientCloudPagination.cancel();
  env.context.ClientCloudPagination.activate(true, { fresh: true, reason: "input" });
  await tick();
  env.pending.at(-1).resolve({ items: [{ id: "j", nome: "Jessica", saldo: -20 }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  assert.match(env.active().list.innerHTML, /Jessica:-20/);

  env.state.query = "maria";
  env.context.ClientCloudPagination.cancel();
  env.context.ClientCloudPagination.activate(true, { fresh: true, reason: "input" });
  await tick();
  env.pending.at(-1).resolve({ items: [{ id: "m", nome: "Maria", saldo: 0 }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  assert.match(env.active().list.innerHTML, /Maria:0/);
});

test("estado, filtros e eventos de retorno permanecem centralizados", () => {
  assert.match(appSource, /ClientesMobile\?\.setSearchTerm\?\.\(value\)/);
  assert.match(mobileSource, /setSearchTerm\(query\)/);
  assert.match(mobileSource, /restoreActiveState/);
  assert.match(mobileSource, /ClientFilterRules\.filter/);
  assert.match(syncSource, /AppLifecycle\?\.onResume/);
  assert.match(pagerSource, /AppLifecycle\?\.onResume/);
  assert.doesNotMatch(syncSource, /document\.addEventListener\("visibilitychange"/);
  assert.match(syncSource, /notify: false/);
});
