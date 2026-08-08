const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/client-cloud-pagination.js", "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

test("resultado atrasado do modo default não sobrescreve busca paginada", async () => {
  const state = { query: "", filter: "todos", sort: "nomeAsc" };
  const pending = new Map();
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
  const app = {};
  const context = {
    window: null,
    document: {
      querySelector: (selector) => selector === "#app" ? app : selector === "#app .clients-page" ? page : null,
      contains: () => true,
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
  };
  context.window = context;
  context.ClientesMobile = {
    getState: () => ({ ...state }),
    renderCard: (client) => `<article>${client.nome}</article>`,
    bindCard() {},
  };
  context.SyncFirebase = {
    queryClientsPage: (options) => new Promise((resolve) => pending.set(options.search || "default", resolve)),
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  await tick();
  assert.ok(pending.has("default"));

  state.query = "ana";
  context.ClientCloudPagination.refresh();
  await tick();
  assert.ok(pending.has("ana"));
  pending.get("ana")({ items: [{ id: "ana", nome: "Ana" }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  assert.match(list.innerHTML, /Ana/);

  pending.get("default")({ items: [{ id: "bruno", nome: "Bruno" }], cursor: null, hasMore: false, documentsRead: 1 });
  await tick();
  assert.match(list.innerHTML, /Ana/);
  assert.doesNotMatch(list.innerHTML, /Bruno/);
  assert.equal(page.dataset.clientCloudMode, "search");
});
