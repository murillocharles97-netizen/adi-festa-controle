const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const activitySource = fs.readFileSync("js/activity-center.js", "utf8");
const plansSource = fs.readFileSync("js/plans.js", "utf8");

function escape(value) {
  return String(value ?? "").replace(
    /[&<>"']/g,
    (char) =>
      ({
        "&": "&amp;",
        "<": "&lt;",
        ">": "&gt;",
        '"': "&quot;",
        "'": "&#39;",
      })[char],
  );
}

function activitySandbox(data) {
  const sandbox = {
    console,
    structuredClone,
    setTimeout,
    clearTimeout,
    document: { querySelector: () => null, querySelectorAll: () => [] },
    DB: { carregar: () => data },
    Utils: { escapar: escape },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(activitySource, sandbox, { filename: "activity-center.js" });
  return sandbox;
}

test("centro de atividades combina somente fontes reais e evita duplicar saída de venda", () => {
  const date = new Date().toISOString();
  const sandbox = activitySandbox({
    clientes: [{ id: "c1", nome: "Maria" }],
    produtos: [{ id: "p1", nome: "Painel" }],
    campanhas: [{ id: "cp1", nome: "Fidelidade" }],
    movimentacoes: [
      {
        id: "m1",
        tipo: "venda",
        vendaId: "v1",
        clienteId: "c1",
        clienteNome: "Maria",
        valor: 50,
        status: "pago",
        data: date,
      },
      { id: "m2", tipo: "desconto", vendaId: "v1", valor: 5, data: date },
      {
        id: "m3",
        tipo: "pagamento",
        clienteId: "c1",
        clienteNome: "Maria",
        valor: 20,
        data: date,
      },
    ],
    movimentacoesEstoque: [
      {
        id: "s1",
        tipo: "saida_venda",
        vendaId: "v1",
        produtoId: "p1",
        quantidade: -1,
        data: date,
      },
      { id: "s2", tipo: "entrada", produtoId: "p1", quantidade: 3, data: date },
    ],
    eventosCampanha: [
      {
        id: "e1",
        campaignId: "cp1",
        clientId: "c1",
        transition: "redeemed",
        createdAt: date,
      },
    ],
    customerSubscriptionEvents: [
      {
        id: "r1",
        clientId: "c1",
        productId: "p1",
        transition: "renewal",
        createdAt: date,
      },
    ],
    catalogOrders: [
      {
        id: "o1",
        publicOrderNumber: "9",
        customerName: "Maria",
        orderStatus: "recebido",
        total: 40,
        createdAt: date,
      },
    ],
  });
  const events = sandbox.ActivityCenter.events();
  assert.deepEqual([...new Set(events.map((item) => item.type))].sort(), [
    "campaign",
    "order",
    "payment",
    "renewal",
    "sale",
    "stock",
  ]);
  assert.equal(events.filter((item) => item.type === "sale").length, 1);
  assert.equal(
    events.some((item) => item.raw.tipo === "desconto"),
    false,
  );
  assert.equal(
    events.some((item) => item.raw.tipo === "saida_venda"),
    false,
  );
});

test("histórico limita renderização inicial a 20 cards e não adiciona leitura Firebase", () => {
  const movements = Array.from({ length: 35 }, (_, index) => ({
    id: `m${index}`,
    tipo: "pagamento",
    clienteNome: `Cliente ${index}`,
    valor: index + 1,
    data: new Date(Date.now() - index * 1000).toISOString(),
  }));
  const sandbox = activitySandbox({
    clientes: [],
    produtos: [],
    campanhas: [],
    movimentacoes: movements,
    movimentacoesEstoque: [],
    eventosCampanha: [],
    customerSubscriptionEvents: [],
    catalogOrders: [],
  });
  const html = sandbox.ActivityCenter.render();
  assert.equal((html.match(/data-activity-id=/g) || []).length, 20);
  assert.match(html, /Carregar mais 15 ações/);
  assert.doesNotMatch(
    activitySource,
    /FirebaseCallable|queryCustomer|collection\s*\(/,
  );
});

function plansSandbox(context) {
  const plans = [
    {
      id: "essential",
      name: "Essencial",
      summary: "Básico",
      monthlyPrice: 29.9,
      yearlyPrice: 299,
      features: { products: true, clients: true },
      limits: { users: 1, products: 300, clients: 500, monthlySales: 1500 },
    },
    {
      id: "professional",
      name: "Profissional",
      summary: "Crescimento",
      monthlyPrice: 49.9,
      yearlyPrice: 499,
      recommended: true,
      features: { products: true, clients: true, campaigns: true, crm: true },
      limits: { users: 3, products: 2000, clients: 5000, monthlySales: 10000 },
    },
  ];
  const sandbox = {
    console,
    structuredClone,
    setTimeout,
    clearTimeout,
    document: {
      querySelector: () => null,
      querySelectorAll: () => [],
      addEventListener: () => {},
    },
    addEventListener: () => {},
    location: { assign: () => {} },
    DB: { carregar: () => ({ produtos: [], clientes: [], vendas: [] }) },
    Utils: { escapar: escape },
    BusinessContext: { get: () => context },
    SubscriptionService: { getPlans: () => plans },
    PlanLimitService: { canUseFeature: () => ({ ok: true }) },
  };
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(plansSource, sandbox, { filename: "plans.js" });
  return sandbox;
}

test("Planos renderiza trial, pago, expirado e interno a partir do status real", () => {
  const base = { business: { id: "demo" }, subscription: {}, access: {} };
  const now = Date.now(), day = 86400000;
  const trial = plansSandbox({
    ...base,
    subscription: {
      planId: "trial",
      status: "trialing",
      trialStartedAt: new Date(now - 4 * day).toISOString(),
      trialEndsAt: new Date(now + 3 * day).toISOString(),
    },
    access: { daysRemaining: 3, limits: {} },
  }).PlansUI.render();
  assert.match(trial, /Teste grátis ativo/);
  const paid = plansSandbox({
    ...base,
    subscription: {
      planId: "professional",
      status: "active",
      currentPeriodEnd: "2026-09-20",
    },
    access: { limits: {} },
  }).PlansUI.render();
  assert.match(paid, /Assinatura ativa/);
  const expired = plansSandbox({
    ...base,
    subscription: { planId: "trial", status: "expired" },
    access: { readOnly: true, limits: {} },
  }).PlansUI.render();
  assert.match(expired, /modo leitura/);
  const internal = plansSandbox({
    business: { id: "adi-festa" },
    subscription: { planId: "internal", status: "internal" },
    access: { internal: true, limits: {} },
  }).PlansUI.render();
  assert.match(internal, /Conta isenta de cobrança/);
  assert.doesNotMatch(internal, /data-plan-cta=/);
});

test("cupons permanecem globais, protegidos, paginados e sem diálogos nativos", () => {
  const admin = fs.readFileSync("js/coupons-admin.js", "utf8");
  const service = fs.readFileSync(
    "functions/src/services/coupon-firestore-service.js",
    "utf8",
  );
  assert.match(admin, /business\.id === "adi-festa"/);
  assert.match(admin, /profile\.role === "owner"/);
  assert.match(admin, /businessId: "adi-festa"/);
  assert.match(admin, /limit: 50/);
  assert.doesNotMatch(admin, /\bprompt\s*\(/);
  assert.doesNotMatch(admin, /\bconfirm\s*\(/);
  assert.match(
    service,
    /collection\("couponRedemptions"\)[\s\S]*?\.limit\(50\)/,
  );
});

test("Configurações não oferece backup automático fictício", () => {
  const settings = fs.readFileSync("js/configuracoes-mobile.js", "utf8");
  assert.doesNotMatch(settings, /Backup automático|Sincronização automática/);
  assert.match(settings, /SyncFirebase\.synchronizeNow/);
  assert.match(settings, /FirebaseAuthActions\.updateBusiness/);
});
