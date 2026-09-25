const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadTeamAccess(context) {
  const listeners = new Map();
  const sandbox = {
    window: null,
    document: { querySelectorAll: () => [], documentElement: { dataset: {} } },
    addEventListener: (name, callback) => listeners.set(name, callback),
    queueMicrotask,
    console,
    ...context,
  };
  sandbox.window = sandbox;
  vm.runInNewContext(fs.readFileSync("js/team-access.js", "utf8"), sandbox);
  return sandbox;
}

test("V150 respeita false explícito nos presets e bloqueia rotas sensíveis do seller", () => {
  const sandbox = loadTeamAccess({
    BusinessContext: { get: () => ({ role: "seller", permissions: ["sales.create", "customers.view", "products.view", "inventory.view"] }) },
  });
  const customized = sandbox.TeamAccess.permissionsFor("manager", { "sales.create": false, "financial.view": true });
  assert.equal(customized["sales.create"], false);
  assert.equal(customized["financial.view"], true);
  assert.equal(sandbox.TeamAccess.canRoute("vender"), true);
  assert.equal(sandbox.TeamAccess.canRoute("financeiro"), false);
  assert.equal(sandbox.TeamAccess.canRoute("equipe"), false);
  assert.equal(sandbox.TeamAccess.canRoute("planos"), false);
});

test("cache privado remove custo e lucro de forma independente", () => {
  let permissions = ["profit.view"];
  const sandbox = loadTeamAccess({ BusinessContext: { get: () => ({ role: "manager", permissions }) } });
  const data = {
    produtos: [{ id: "p1", custo: 4 }],
    vendas: [{ id: "s1", custoTotal: 4, lucro: 6, itens: [{ custoUnitario: 4, lucro: 6 }] }],
  };
  sandbox.TeamAccess.sanitizePrivateCache(data);
  assert.equal("custo" in data.produtos[0], false);
  assert.equal("custoTotal" in data.vendas[0], false);
  assert.equal(data.vendas[0].lucro, 6);
  permissions = ["cost.view"];
  sandbox.TeamAccess.sanitizePrivateCache(data);
  assert.equal("lucro" in data.vendas[0], false);
});

test("integração V150 contém ator, isolamento de cache e coleções financeiras protegidas", () => {
  const sync = fs.readFileSync("js/firebase/sync.js", "utf8");
  const storage = fs.readFileSync("js/storage.js", "utf8");
  const rules = fs.readFileSync("firestore.rules", "utf8");
  const html = fs.readFileSync("index.html", "utf8");
  assert.match(sync, /actorUid/);
  assert.match(storage, /permissionSignature/);
  assert.match(rules, /match \/saleFinancials\/\{saleId\}/);
  assert.match(rules, /match \/members\/\{memberUid\}/);
  assert.match(html, /data-route="equipe"/);
  assert.match(fs.readFileSync("js/build-info.js", "utf8"), /release:\s*"153"/);
});
