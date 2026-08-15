const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const home = fs.readFileSync("js/home-mobile.js", "utf8");
const clients = fs.readFileSync("js/clientes-mobile.js", "utf8");
const styles = `${fs.readFileSync("css/home-mobile.css", "utf8")}\n${fs.readFileSync("css/clientes-mobile.css", "utf8")}`;
const app = fs.readFileSync("js/app.js", "utf8");

test("Home mobile possui meta responsiva e uma única seção operacional condicional", () => {
  assert.match(home, /goal-footer/);
  assert.match(home, /Meta atingida!/);
  assert.match(home, /function attentionItems/);
  assert.match(home, /Clientes devendo/);
  assert.match(home, /Renovações/);
  assert.match(home, /Pedidos online/);
  assert.match(home, /Tudo em dia por aqui/);
  assert.match(styles, /font-size:clamp\(1\.7rem,8\.4vw,2\.15rem\)/);
  assert.doesNotMatch(app, /MobileHome\.render\(\).*CampanhasUI\?\.dashboard/s);
});

test("Home consulta renovações por uma única query limitada e indexável", async () => {
  const calls = [];
  const context = {
    window: null, console, Date, Math, Number, String, Set, Map, Array, Object,
    DB: { carregar: () => ({ customerSubscriptions: [], customerSubscriptionEvents: [] }), getBusinessId: () => "business-a" },
    Utils: { uuid: () => "id" },
    SyncFirebase: {
      async queryCustomerSubscriptions(options) {
        calls.push(options);
        return [
          { id: "today", clientId: "c1", status: "active", expiresAt: "2026-08-15T20:00:00.000Z", contractedPrice: 25.9 },
          { id: "soon", clientId: "c2", status: "active", expiresAt: "2026-08-18T20:00:00.000Z", contractedPrice: 40 },
        ];
      },
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/customer-subscriptions.js", "utf8"), context);
  const result = await context.CustomerSubscriptions.loadHomeMetrics("2026-08-15T12:00:00.000Z");
  assert.equal(calls.length, 1);
  assert.equal(calls[0].status, "active");
  assert.equal(calls[0].limit, 50);
  assert.match(calls[0].from, /^2026-08-15/);
  assert.ok(new Date(calls[0].to) - new Date(calls[0].from) >= 7 * 86400000);
  assert.ok(new Date(calls[0].to) - new Date(calls[0].from) < 8 * 86400000);
  assert.deepEqual(JSON.parse(JSON.stringify(result)), { dueToday: 1, due7: 1, forecastValue: 65.9, clientIds: ["c1", "c2"] });
});

test("Clientes preserva paginação, busca robusta e contexto condicional de renovação", () => {
  assert.match(clients, /limit:20/);
  assert.match(clients, /setTimeout\(\(\)=>searchClients\(state\.query\),300\)/);
  assert.match(clients, /mobile-search-clear/);
  assert.match(clients, /mobile-client-searching/);
  assert.match(clients, /applyRenewalAttention/);
  assert.match(clients, /days>=0&&days<=7/);
  assert.match(clients, /renovações .*próximas/);
  assert.match(clients, /state\.scrollPosition=scrollY/);
  assert.match(clients, /AppLifecycle\?\.onBackground/);
  assert.match(styles, /mobile-client-kpis\{grid-template-columns:repeat\(3,minmax\(154px,1fr\)\)/);
});

test("layout não adiciona leituras por scroll, carrossel ou troca visual de chip", () => {
  assert.doesNotMatch(home, /onSnapshot|addEventListener\(['"]scroll/);
  assert.doesNotMatch(clients, /onSnapshot|addEventListener\(['"]scroll/);
  assert.doesNotMatch(styles, /firestore|firebase/i);
});
