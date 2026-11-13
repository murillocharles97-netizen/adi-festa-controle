// Device clock zone must not change "vence hoje": run this file in UTC on purpose.
process.env.TZ = "UTC";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");

const REFERENCE = "2026-08-14T12:00:00.000Z"; // 09:00 in São Paulo
const plain = (value) => JSON.parse(JSON.stringify(value));

function boot({ subscriptions = [], clients = [], sync = null, space = null, restricted = false, online = true, canSend = true, canSell = true, history = [] } = {}) {
  const dom = new JSDOM(`<!doctype html><body><div id="toasts"></div><div id="modal"></div><main id="app" data-page-instance="1"></main></body>`, { runScripts: "outside-only", url: "https://veconi.test/#/renovacoes" });
  const { window } = dom;
  const data = { customerSubscriptions: subscriptions, customerSubscriptionEvents: [], produtos: [{ id: "plano", nome: "Plano Pilates" }], clientes: clients };
  const calls = { center: [], toasts: [], route: [], renew: [], profile: [], remind: [] };
  Object.defineProperty(window.navigator, "onLine", { configurable: true, get: () => online });
  Object.assign(window, {
    DB: { carregar: () => data, alterar: (mutator) => mutator(data), getBusinessId: () => "business-a" },
    Utils: {
      escapar: (value) => String(value ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])),
      dinheiro: (value) => `R$ ${Number(value || 0).toFixed(2)}`, somenteNumeros: (value) => String(value || "").replace(/\D/g, ""),
      toast: (text) => calls.toasts.push(text), uuid: () => "id",
    },
    Clientes: { obter: (id) => clients.find((item) => item.id === id) || null },
    Produtos: { obter: (id) => data.produtos.find((item) => item.id === id) || null },
    ProductVariations: { get: () => null, displayName: () => "" },
    TeamAccess: { canRoute: (route) => route === "vender" ? canSell : true },
    Mensagens: { canSend: () => canSend, history: () => history },
    MobileMessages: { openCenter: (options) => calls.center.push(plain(options)) },
    Router: { ir: (route) => calls.route.push(route) },
    Checkout: { prepareRenewal: (id) => { calls.renew.push({ id, active: window.SpaceContext?.activeId?.() || null }); return true; } },
    CRMClienteUI: { open: (id) => calls.profile.push({ id, active: window.SpaceContext?.activeId?.() || null }), renewalWhatsApp: (item) => calls.remind.push({ id: item.id, active: window.SpaceContext?.activeId?.() || null }) },
    OperationalReadPolicy: { restricted: () => restricted },
    SyncFirebase: sync,
    SpaceContext: space,
  });
  // Freeze the page clock at REFERENCE inside the window realm.
  window.eval(`(() => { const Real = Date; class Fixed extends Real { constructor(...args) { super(...(args.length ? args : ["${REFERENCE}"])); } static now() { return new Real("${REFERENCE}").getTime(); } } window.Date = Fixed; })()`);
  window.eval(fs.readFileSync("js/customer-subscriptions.js", "utf8"));
  window.eval(fs.readFileSync("js/renewal-messages.js", "utf8"));
  window.eval(fs.readFileSync("js/renovacoes.js", "utf8"));
  window.document.querySelector("#app").innerHTML = window.RenovacoesUI.render();
  return { window, data, calls, $: (selector) => window.document.querySelector(selector), $$: (selector) => [...window.document.querySelectorAll(selector)] };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
async function mounted(options) {
  const app = boot(options);
  app.window.RenovacoesUI.bind();
  for (let i = 0; i < 5; i += 1) await settle();
  return app;
}
const sub = (id, clientId, expiresAt, extra = {}) => ({ id, clientId, productId: "plano", label: `Plano ${id}`, status: "active", expiresAt, contractedPrice: 100, durationValue: 1, durationUnit: "months", ...extra });
const kpi = (app, key) => app.$(`[data-renewals-filter="${key}"] b`)?.textContent;

test("métricas existentes contam o dia civil de São Paulo mesmo com o aparelho em UTC", async () => {
  const { window } = boot({ subscriptions: [
    sub("late", "c1", "2026-08-15T02:30:00.000Z"),        // 23:30 SP on the 14th: today
    sub("week", "c2", "2026-08-22T02:30:00.000Z"),        // 23:30 SP on the 21st: day 7
    sub("eight", "c3", "2026-08-22T03:30:00.000Z"),       // 00:30 SP on the 22nd: day 8
  ] });
  const metrics = window.CustomerSubscriptions.metrics(REFERENCE);
  assert.equal(metrics.dueToday, 1);
  assert.equal(metrics.due7, 1);
  assert.equal(window.CustomerSubscriptions.civilDayEnd(REFERENCE, 0), "2026-08-15T02:59:59.999Z");
  assert.equal(window.CustomerSubscriptions.civilDayEnd(REFERENCE, 7), "2026-08-22T02:59:59.999Z");
  const home = await window.CustomerSubscriptions.loadHomeMetrics(REFERENCE);
  assert.equal(home.dueToday, 1);
  assert.equal(home.due7, 1);
  assert.equal(home.limited, false);
});

test("métricas lidas com limite de 50 são marcadas como parciais", async () => {
  const many = Array.from({ length: 50 }, (_, index) => sub(`s${index}`, `c${index}`, "2026-08-17T15:00:00.000Z"));
  const asked = [];
  const { window } = boot({ sync: { queryCustomerSubscriptions: async (options) => { asked.push(options); return options.status === "active" && options.from ? many : []; } } });
  const home = await window.CustomerSubscriptions.loadHomeMetrics(REFERENCE);
  assert.equal(home.limited, true);
  assert.equal(asked[0].to, "2026-08-22T02:59:59.999Z", "a janela termina no fim do 7º dia civil de São Paulo");
  const dashboard = await window.CustomerSubscriptions.loadDashboardMetrics(REFERENCE);
  assert.equal(dashboard.limited, true);
});

test("tela pagina a nuvem por cursor até o fim e só declara total quando lê tudo", async () => {
  const pages = { "active:asc": [[sub("a1", "c1", "2026-08-14T20:00:00.000Z"), sub("a2", "c2", "2026-08-16T20:00:00.000Z")], [sub("a3", "c3", "2026-09-10T20:00:00.000Z")]], "active:desc": [[sub("old", "c5", "2026-08-02T20:00:00.000Z")]], "expired:desc": [[sub("e1", "c4", "2026-08-01T20:00:00.000Z", { status: "expired" })]], "paused:asc": [[]] };
  const requests = [];
  const sync = { queryCustomerSubscriptions: async (options) => {
    requests.push(plain(options));
    const list = pages[`${options.status}:${options.direction}`], index = options.cursor ? Number(options.cursor) : 0;
    return { items: list[index], cursor: String(index + 1), hasMore: index + 1 < list.length };
  } };
  const loaded = await boot({ sync }).window.CustomerSubscriptions.view.loadBoardRows();
  assert.equal(loaded.source, "cloud");
  assert.equal(loaded.complete, true);
  assert.deepEqual([...loaded.rows.map((item) => item.id)].sort(), ["a1", "a2", "a3", "e1", "old"]);
  assert.ok(requests.every((item) => item.page === true && item.limit === 50 && item.spaceView === true));
  assert.equal(requests.filter((item) => item.status === "active" && item.direction === "asc").length, 2, "segue o cursor");
  assert.equal(requests.find((item) => item.direction === "asc" && item.status === "active").from, REFERENCE, "ativas começam pelo vencimento mais próximo");
  assert.equal(requests.find((item) => item.direction === "desc" && item.status === "active").to, REFERENCE, "vencidas ainda marcadas como ativas vêm das mais recentes");

  const endless = { queryCustomerSubscriptions: async (options) => ({ items: [sub(`${options.status}-${options.cursor || 0}`, "c1", "2026-09-01T00:00:00.000Z")], cursor: String(Number(options.cursor || 0) + 1), hasMore: true }) };
  const capped = await boot({ sync: endless }).window.CustomerSubscriptions.view.loadBoardRows({ maxPages: 2 });
  assert.equal(capped.complete, false);
  assert.equal(capped.limitReached, true);
  assert.equal(capped.limit, 100);
  assert.equal(capped.exact.dueToday, true, "último item lido vence após 7 dias: hoje e semana são exatos");
  assert.equal(capped.exact.active, false);
  assert.equal(capped.exact.expired, false);
  const shortCap = { queryCustomerSubscriptions: async (options) => ({ items: [sub(`${options.status}-${options.direction}-${options.cursor || 0}`, "c1", "2026-08-16T00:00:00.000Z")], cursor: String(Number(options.cursor || 0) + 1), hasMore: true }) };
  const near = await boot({ sync: shortCap }).window.CustomerSubscriptions.view.loadBoardRows({ maxPages: 1 });
  assert.equal(near.exact.next7, false, "corte dentro da semana não pode afirmar total");
  const ui = await mounted({ sync: endless });
  assert.match(kpi(ui, "active"), /^\d+\+$/, "leitura cortada mostra mínimo");
  assert.match(ui.$("[data-renewals-notice]").textContent, /mais de 500 vigências/);
});

test("espaço só é completo após a leitura paginada do espaço; offline usa o aparelho e avisa", async () => {
  const space = { activeId: () => "space-1", scopesCustomers: () => true, viewScope: () => "space-1", showsRenewal: (item) => item.spaceId === "space-1", showsUnassignedRenewal: () => false };
  const rows = [sub("mine", "c1", "2026-08-16T15:00:00.000Z", { spaceId: "space-1" }), sub("other", "c2", "2026-08-16T15:00:00.000Z", { spaceId: "space-2" })];
  const ok = await boot({ subscriptions: rows, space, sync: { queryRenewalsForSpace: async () => [], queryCustomerSubscriptions: async () => [] } }).window.CustomerSubscriptions.view.loadBoardRows();
  assert.equal(ok.source, "space");
  assert.equal(ok.complete, true);
  assert.deepEqual([...ok.rows.map((item) => item.id)], ["mine"]);
  const failed = await boot({ subscriptions: rows, space, sync: { queryRenewalsForSpace: async () => { throw Object.assign(Error("x"), { code: "unavailable" }); }, queryCustomerSubscriptions: async () => [] } }).window.CustomerSubscriptions.view.loadBoardRows();
  assert.equal(failed.source, "device");
  assert.equal(failed.complete, false);
  const offline = await mounted({ subscriptions: rows, online: false });
  assert.match(offline.$("[data-renewals-notice]").textContent, /salvo neste aparelho/);
  assert.equal(kpi(offline, "active"), "2+", "número do aparelho é mínimo, não total");
});

test("tela mostra indicadores sobrepostos sem soma enganosa, filtra, busca e reaproveita ações existentes", async () => {
  const clients = [{ id: "c1", nome: "Joana Conceição", telefone: "(11) 98888-1234" }, { id: "c2", nome: "Márcio Dias", telefone: "" }, { id: "c3", nome: "Bia", telefone: "(21) 97777-0000" }];
  const sync = { queryCustomerSubscriptions: async (options) => ({ items: { active: [sub("today", "c1", "2026-08-15T02:30:00.000Z"), sub("soon", "c3", "2026-08-17T15:00:00.000Z"), sub("later", "c2", "2026-09-30T15:00:00.000Z", { lastRenewedAt: "2026-08-10T15:00:00.000Z" })], expired: [sub("late", "c2", "2026-08-01T15:00:00.000Z", { status: "expired" })], paused: [] }[options.status], cursor: null, hasMore: false }) };
  const app = await mounted({ clients, sync });
  assert.equal(kpi(app, "dueToday"), "1");
  assert.equal(kpi(app, "next7"), "1");
  assert.equal(kpi(app, "active"), "3");
  assert.equal(kpi(app, "expired"), "1");
  assert.equal(kpi(app, "renewedRecently"), "1");
  assert.match(app.$('[data-renewals-filter="dueToday"] em').textContent, /Inclusas em Ativas/);
  assert.match(app.$(".renewals-overlap").textContent, /não se somam/);
  assert.equal(app.$('[data-renewals-filter="dueToday"]').getAttribute("aria-pressed"), "true", "abre no grupo mais urgente");
  app.$('[data-renewals-renew="today"]').click();
  app.$('[data-renewals-remind="today"]').click();
  app.$('[data-renewals-profile="today"]').click();
  assert.deepEqual(plain(app.calls.renew.map((call) => call.id)), ["today"], "Renovar usa Checkout.prepareRenewal existente");
  assert.deepEqual(plain(app.calls.remind.map((call) => call.id)), ["today"], "Lembrar usa o WhatsApp existente do perfil");
  assert.deepEqual(plain(app.calls.profile.map((call) => call.id)), ["c1"], "Perfil usa CRMClienteUI.open");
  assert.match(app.$(".renewal-due").textContent, /Vence hoje/);

  app.$('[data-renewals-filter="expired"]').click();
  assert.match(app.$(".renewal-due").textContent, /Venceu há 13 d/);
  assert.ok(app.$('.renewal-actions [disabled]'), "cliente sem WhatsApp não abre link");

  app.$('[data-renewals-filter="active"]').click();
  const search = app.$("[data-renewals-search]");
  search.value = "conceicao"; search.dispatchEvent(new app.window.Event("input"));
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(app.$$(".renewal-row").length, 1);
  search.value = "7777"; search.dispatchEvent(new app.window.Event("input"));
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(app.$(".renewal-who b").textContent, "Bia");
  search.value = "ninguém"; search.dispatchEvent(new app.window.Event("input"));
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.match(app.$("[data-renewals-list]").textContent, /Nenhum resultado para “ninguém” em Ativas/);
});

test("lembretes: seleção por assinatura, atalhos hoje/amanhã/7 dias/vencidas/7-1-0 e retrato por cliente para a Central", async () => {
  const clients = [{ id: "c1", nome: "Ana", telefone: "11988887777" }, { id: "c2", nome: "Beto", telefone: "11977776666" }];
  const rows = [
    sub("x1", "c1", "2026-08-15T02:30:00.000Z", { reminders: [7, 1, 0] }), // hoje (23:30 SP)
    sub("x2", "c1", "2026-08-15T15:00:00.000Z", { reminders: [7, 1, 0] }), // amanhã
    sub("x3", "c2", "2026-08-21T15:00:00.000Z", { reminders: [7, 1, 0] }), // em 7 dias
    sub("x4", "c2", "2026-08-10T15:00:00.000Z", { status: "expired" }),    // vencida
  ];
  const sync = { queryCustomerSubscriptions: async (options) => ({ items: rows.filter((row) => options.status === "expired" ? row.status === "expired" : row.status === "active" && (options.direction === "asc")), cursor: null, hasMore: false }) };
  const history = [{ type: "renewal", status: "sent_confirmed", sentAt: "2026-08-14T11:00:00.000Z", subscriptionIds: ["x3"] }];
  const app = await mounted({ clients, sync, history });
  assert.equal(app.calls.center.length, 0);
  assert.equal(app.$("[data-renewals-center]"), null, "nada selecionado, nada abre");
  const chip = (key) => app.$(`[data-renewals-quick="${key}"] b`)?.textContent;
  assert.deepEqual([chip("today"), chip("tomorrow"), chip("week"), chip("expired"), chip("schedule")], ["1", "1", "1", "1", "2"], "x3 já lembrada hoje fica fora dos atalhos");
  app.$('[data-renewals-filter="next7"]').click();
  assert.match(app.$("[data-renewals-list]").textContent, /Lembrado hoje/);
  app.$('[data-renewals-quick="today"]').click();
  app.$('[data-renewals-quick="tomorrow"]').click();
  assert.match(app.$(".renewals-bulk-copy b").textContent, /2 assinaturas · 1 cliente/);
  assert.match(app.$(".renewals-bulk-copy small").textContent, /sem saldo de Fiado\. Envio manual, um cliente por vez/);
  app.$('[data-renewals-quick="schedule"]').click();
  assert.ok(app.calls.toasts.some((text) => /1 já foi lembrada hoje e ficou de fora/.test(text)));
  const box = app.$('[data-renewals-select="x3"]');
  box.checked = true; box.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  assert.match(app.$(".renewals-bulk-copy b").textContent, /3 assinaturas · 2 clientes/, "repetir é escolha individual consciente");
  app.$("[data-renewals-center]").click();
  const call = app.calls.center[0];
  assert.equal(call.type, "renewal");
  assert.equal(call.returnRoute, "renovacoes");
  assert.deepEqual(call.clientIds, ["c1", "c2"]);
  assert.deepEqual(call.renewal.items.c1.map((item) => item.id), ["x1", "x2"], "cada cliente leva só as assinaturas marcadas, por vencimento");
  assert.deepEqual(call.renewal.items.c2.map((item) => item.id), ["x3"]);
  assert.ok(call.renewal.items.c1[0].fingerprint, "retrato com impressão da vigência para revalidar antes do envio");
  app.$("[data-renewals-clear]").click();
  assert.ok(app.$("[data-renewals-bulk]").hidden, "limpar esconde a barra");
});

test("acesso restrito, sem venda, sem Central, lista longa e conta vazia têm estados claros", async () => {
  const restricted = await mounted({ restricted: true, sync: { queryCustomerSubscriptions: async () => [] } });
  assert.match(restricted.$("[data-renewals-notice]").textContent, /perfil de cada cliente/);
  assert.ok(restricted.$("[data-renewals-bulk]").hidden);

  const many = Array.from({ length: 95 }, (_, index) => sub(`m${index}`, `c${index}`, "2026-09-20T15:00:00.000Z"));
  const sync = { queryCustomerSubscriptions: async (options) => ({ items: options.status === "active" ? many : [], cursor: null, hasMore: false }) };
  const long = await mounted({ sync, canSell: false, canSend: false });
  assert.equal(kpi(long, "active"), "95");
  assert.equal(long.$$(".renewal-row").length, 40);
  assert.equal(long.$$("[data-renewals-renew]").length, 0, "sem permissão de venda não oferece Renovar");
  assert.equal(long.$$("[data-renewals-select]").length, 0, "sem Central não há seleção");
  long.$("[data-renewals-more]").click();
  assert.equal(long.$$(".renewal-row").length, 80);
  assert.match(long.$("[data-renewals-more]").textContent, /Mostrar mais 15 de 15/);

  const empty = await mounted({ sync: { queryCustomerSubscriptions: async () => ({ items: [], cursor: null, hasMore: false }) } });
  assert.match(empty.$("[data-renewals-list]").textContent, /Nenhuma assinatura ainda/);
  empty.$("[data-go-route]").click();
  assert.deepEqual(empty.calls.route, ["produtos"]);
});

test("rota, permissão, menu e cache PWA incluem Renovações sem tocar planos da VECONI", () => {
  const router = fs.readFileSync("js/router.js", "utf8"), access = fs.readFileSync("js/team-access.js", "utf8"),
    app = fs.readFileSync("js/app.js", "utf8"), html = fs.readFileSync("index.html", "utf8"), worker = fs.readFileSync("service-worker.js", "utf8");
  assert.match(router, /'clientes','renovacoes'/);
  assert.match(access, /renovacoes: "customers\.view"/);
  assert.match(app, /renovacoes: \(\) => window\.RenovacoesUI/);
  assert.match(app, /canUseFeature\?\.\("customerSubscriptions"\)/);
  assert.equal((html.match(/href="#\/renovacoes" data-route="renovacoes" data-plan-feature="customerSubscriptions"/g) || []).length, 2);
  assert.match(html, /js\/renovacoes\.js/);
  assert.match(html, /css\/renovacoes\.css/);
  assert.match(worker, /\.\/js\/renovacoes\.js/);
  assert.doesNotMatch(fs.readFileSync("js/renovacoes.js", "utf8"), /type:\s*["']charge["']|mercadopago|wa\.me/i);
});

// Two spaces (Loja Centro / Loja Bairro) with the same client holding a different plan in each.
function twoSpaces({ active = "bairro", allowed = ["centro", "bairro"], selectFails = false } = {}) {
  const state = { active, epoch: 0 }, names = { centro: "Loja Centro", bairro: "Loja Bairro" };
  return {
    state,
    activeId: () => state.active,
    scopesCustomers: () => true,
    customerSpaces: () => allowed.map((id) => ({ id, name: names[id] })),
    recordSpace: (row) => row.spaceId && row.financialSpaceId && row.spaceId !== row.financialSpaceId ? "" : row.spaceId || "",
    showsRenewal(row) { return this.recordSpace(row) === state.active; },
    showsUnassignedRenewal: () => false,
    viewScope: () => JSON.stringify([state.epoch, state.active]),
    snapshot: () => ({ businessId: "business-a" }),
    selectActive(id) {
      if (selectFails) throw Error("Conclua ou feche o atendimento no espaço atual antes de trocar.");
      if (!allowed.includes(id)) throw Error("Escolha um espaço autorizado para operar.");
      state.active = id; state.epoch += 1;
      globalThis.__dispatch?.("veconi-space-context-changed");
      return { id };
    },
  };
}
const spaceRows = () => [
  sub("joana-centro", "c-joana", "2026-08-15T02:30:00.000Z", { spaceId: "centro", label: "Plano Pilates" }),
  sub("joana-bairro", "c-joana", "2026-08-17T15:00:00.000Z", { spaceId: "bairro", label: "Academia" }),
  sub("marcos-centro", "c-marcos", "2026-08-09T15:00:00.000Z", { spaceId: "centro", label: "Plano Pilates" }),
  sub("bia-bairro", "c-bia", "2026-08-26T15:00:00.000Z", { spaceId: "bairro", label: "Academia" }),
];
const spaceClients = [{ id: "c-joana", nome: "Joana Conceição", telefone: "11988881234" }, { id: "c-marcos", nome: "Márcio Dias", telefone: "11977772211" }, { id: "c-bia", nome: "Bia Souza", telefone: "21966661010" }];
async function spaceApp(options = {}) {
  const space = twoSpaces(options), reads = [];
  const rows = spaceRows();
  const sync = { queryCustomerSubscriptions: async () => [], queryRenewalsForSpace: async (id) => { reads.push(id ?? "active"); if (options.failSpace && options.failSpace === id) throw Object.assign(Error("x"), { code: "unavailable" }); return []; } };
  const app = boot({ subscriptions: rows, clients: spaceClients, sync, space });
  globalThis.__dispatch = (name) => app.window.dispatchEvent(new app.window.Event(name));
  app.window.RenovacoesUI.bind();
  for (let i = 0; i < 6; i += 1) await settle();
  return { ...app, space, reads };
}
const choose = async (app, value) => {
  const select = app.$("[data-renewals-space-select]");
  select.value = value;
  select.dispatchEvent(new app.window.Event("change", { bubbles: true }));
  for (let i = 0; i < 6; i += 1) await settle();
};

test("seletor de espaços: Todos os espaços soma só espaços autorizados e cada espaço filtra indicadores, busca e lista", async () => {
  const app = await spaceApp();
  assert.deepEqual([...app.$$("[data-renewals-space-select] option")].map((o) => o.textContent), ["Todos os espaços (2)", "Loja Centro", "Loja Bairro"]);
  assert.equal(app.$("[data-renewals-space-select]").value, "bairro", "abre no espaço ativo do SpaceContext");
  assert.equal(kpi(app, "active"), "2");
  assert.equal(kpi(app, "expired"), "0");
  await choose(app, "all");
  assert.deepEqual(app.reads.slice(-2).sort(), ["bairro", "centro"], "lê cada espaço autorizado por completo");
  assert.equal(kpi(app, "active"), "3");
  assert.equal(kpi(app, "expired"), "1");
  assert.equal(kpi(app, "dueToday"), "1");
  app.$('[data-renewals-filter="active"]').click();
  const search = app.$("[data-renewals-search]");
  search.value = "joana"; search.dispatchEvent(new app.window.Event("input"));
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.deepEqual(app.$$(".renewal-space-chip").map((chip) => chip.textContent), ["Loja Centro", "Loja Bairro"], "mesma cliente, plano diferente em cada espaço");
  assert.equal(app.$$("[data-renewals-select]").length, 0, "lote só por espaço");
  assert.match(app.$("[data-renewals-select-slot]").textContent, /escolha um espaço/);
  await choose(app, "centro");
  assert.equal(app.space.state.active, "centro", "escolher um espaço usa SpaceContext.selectActive");
  assert.equal(kpi(app, "active"), "1");
  assert.equal(app.$$(".renewal-space-chip").length, 0);
  assert.match(app.$("[data-renewals-count]").textContent, /1 assinatura/);
});

test("Renovar e Perfil a partir de Todos os espaços adotam o espaço de origem; Lembrar não troca espaço", async () => {
  const app = await spaceApp();
  await choose(app, "all");
  app.$('[data-renewals-filter="expired"]').click();
  app.$('[data-renewals-renew="marcos-centro"]').click();
  assert.deepEqual(plain(app.calls.renew), [{ id: "marcos-centro", active: "centro" }], "Renovar só depois de ativar o espaço de origem");
  assert.ok(app.calls.toasts.some((text) => /Loja Centro \(origem da assinatura\)/.test(text)));
  app.space.selectActive("bairro");
  for (let i = 0; i < 6; i += 1) await settle();
  app.$('[data-renewals-filter="expired"]').click();
  app.$('[data-renewals-profile="marcos-centro"]').click();
  assert.deepEqual(plain(app.calls.profile), [{ id: "c-marcos", active: "centro" }]);
  app.space.selectActive("bairro");
  for (let i = 0; i < 6; i += 1) await settle();
  app.$('[data-renewals-filter="active"]').click();
  app.$('[data-renewals-remind="joana-centro"]').click();
  assert.deepEqual(plain(app.calls.remind), [{ id: "joana-centro", active: "bairro" }]);
  assert.equal(app.$("[data-renewals-space-select]").value, "all", "a visão Todos continua após trocar o espaço ativo");
});

test("troca de espaço bloqueada (sacola aberta) não renova em outro espaço; vigência sem espaço de origem não renova", async () => {
  const blocked = await spaceApp({ selectFails: true });
  await choose(blocked, "all");
  blocked.$('[data-renewals-filter="expired"]').click();
  blocked.$('[data-renewals-renew="marcos-centro"]').click();
  assert.equal(blocked.calls.renew.length, 0);
  assert.ok(blocked.calls.toasts.some((text) => /Conclua ou feche o atendimento/.test(text)));
  const legacy = await spaceApp();
  legacy.data.customerSubscriptions.push(sub("legacy", "c-bia", "2026-08-16T15:00:00.000Z", { spaceId: "bairro", financialSpaceId: "centro" }));
  legacy.$("[data-renewals-refresh]").click();
  for (let i = 0; i < 6; i += 1) await settle();
  assert.equal(legacy.$('[data-renewals-renew="legacy"]'), null, "vigência com espaços divergentes não é listada como do espaço");
});

test("vendedor de um espaço não vê seletor, nem vigências ou leitura de outro espaço", async () => {
  const app = await spaceApp({ active: "centro", allowed: ["centro"] });
  assert.equal(app.$("[data-renewals-space-select]"), null);
  assert.match(app.$(".renewals-space.is-single").textContent, /Loja Centro/);
  const rows = await app.window.CustomerSubscriptions.view.loadBoardRows({ spaceIds: ["centro", "bairro"] });
  assert.deepEqual([...rows.rows.map((row) => row.id)].sort(), ["joana-centro", "marcos-centro"], "ids não autorizados são ignorados");
});

test("leitura de um espaço falhando em Todos não declara total; sem espaço carregado não mostra contagem", async () => {
  const app = await spaceApp({ failSpace: "centro" });
  await choose(app, "all");
  assert.match(kpi(app, "active"), /\+$/);
  assert.match(app.$("[data-renewals-notice]").textContent, /salvo neste aparelho/);
  const none = boot({ subscriptions: spaceRows(), space: { ...twoSpaces(), activeId: () => "", customerSpaces: () => [] }, sync: { queryCustomerSubscriptions: async () => ({ items: spaceRows(), cursor: null, hasMore: false }) } });
  none.window.RenovacoesUI.bind();
  for (let i = 0; i < 6; i += 1) await settle();
  assert.match(none.$("[data-renewals-notice]").textContent, /Nenhum espaço autorizado foi carregado/);
  assert.ok(none.$("[data-renewals-page]").classList.contains("is-restricted"), "indicadores ocultos");
  assert.equal(none.window.RenovacoesUI._state().loaded.rows.length, 0);
});

test("Central volta para Renovações; Perfil/Renovar após troca de espaço preserva a intenção de renovação", () => {
  const center = fs.readFileSync("js/mensagens-mobile.js", "utf8"), checkout = fs.readFileSync("js/checkout.js", "utf8"), sync = fs.readFileSync("js/firebase/sync.js", "utf8");
  assert.match(center, /RETURN_LABELS = \{renovacoes:'Renovações'\}/);
  assert.match(center, /Voltar para \$\{RETURN_LABELS\[returnRoute\]\|\|'Clientes'\}/);
  assert.match(center, /if \(back && window\.Router\?\.atual\?\.\(\) === back\)/);
  assert.doesNotMatch(checkout, /samePrincipal/, "checkout.js permanece igual à main nesta release");
  assert.match(fs.readFileSync("js/renovacoes.js", "utf8"), /window\.Checkout\?\.retireSpaceDraft\?\.\(\);\r?\n\s+if \(kind === "renew"\)/);
  assert.match(sync, /if \(spaceId && !\(context\.customerSpaces\?\.\(\) \|\| \[\]\)\.some\(space => space\.id === id\)\) return \[\];/);
});

test("todo ícone usado por Renovações e pelo lembrete existe no pacote Lucide publicado", () => {
  const vm = require("node:vm"), context = { window: {}, self: {}, document: {}, console };
  context.globalThis = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync("assets/lucide.min.js", "utf8"), context);
  const lucide = context.lucide || context.window.lucide || context.self.lucide, keys = new Set(Object.keys(lucide.icons || {}));
  const pascal = (name) => name.split("-").map((part) => part[0].toUpperCase() + part.slice(1)).join("");
  const used = new Set();
  for (const file of ["js/renovacoes.js", "js/message-sequence-ui.js", "js/mensagens-mobile.js"])
    for (const match of fs.readFileSync(file, "utf8").matchAll(/icon\("([a-z0-9-]+)"\)|icon\('([a-z0-9-]+)'\)/g)) used.add(match[1] || match[2]);
  assert.deepEqual([...used].filter((name) => !keys.has(pascal(name))), []);
});
