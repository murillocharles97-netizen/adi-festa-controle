const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function harness({ allowed = true } = {}) {
  let sequence = 0;
  const data = {
    config: { nome: "VECONI Teste" },
    clientes: [{ id: "nat", nome: "Nat Stanley", telefone: "(17) 99999-1234", saldo: -351.84 }],
    cobrancas: [], movimentacoes: [], messageHistory: [], messageTemplates: [], messageSequences: [],
  };
  const assigned = [];
  const context = {
    console, structuredClone, Date, JSON, Map, Set, Promise,
    navigator: { onLine: false },
    location: { assign: (url) => assigned.push(url) },
    matchMedia: () => ({ matches: false }),
    crypto: { randomUUID: () => `uuid-${++sequence}` },
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init?.detail; } },
    addEventListener() {}, dispatchEvent() {},
    DB: {
      carregar: () => data,
      alterar: (mutator) => { mutator(data); return data; },
      getBusinessId: () => "adi-festa",
    },
    Utils: {
      uuid: () => `uuid-${++sequence}`,
      dinheiro: (value) => `R$ ${Number(value).toFixed(2)}`,
      telefoneWhatsApp: (value) => `55${String(value || "").replace(/\D/g, "").replace(/^55/, "")}`,
    },
    Clientes: { obter: (id) => data.clientes.find((item) => item.id === id) },
    TeamAccess: {
      has: () => allowed,
      actor: () => ({ actorUid: "owner-uid", actorNameSnapshot: "Owner", actorRoleSnapshot: "owner" }),
    },
    BusinessContext: { get: () => ({ businessId: "adi-festa", role: "owner" }) },
    SpaceContext: { homeId: () => "all_spaces" },
    open: () => ({ opener: {} }),
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/phone.js", "utf8"), context);
  vm.runInContext(fs.readFileSync("js/mensagens.js", "utf8"), context);
  return { context, data, assigned };
}

test("normaliza telefone brasileiro e rejeita quantidade inválida de dígitos", () => {
  const { context } = harness();
  assert.equal(context.PhoneUtils.normalizeBrazilianPhone("(17) 99999-1234"), "5517999991234");
  assert.equal(context.PhoneUtils.normalizeBrazilianPhone("(55) 9999-1234"), "555599991234");
  assert.equal(context.PhoneUtils.isValidBrazilianPhone("(17) 99999-1234"), true);
  assert.equal(context.PhoneUtils.isValidBrazilianPhone("(55) 9999-1234"), true);
  assert.equal(context.PhoneUtils.isValidBrazilianPhone("17 123"), false);
  assert.equal(context.PhoneUtils.isValidBrazilianPhone("55 17 99999 12345"), false);
});

test("registro de abertura é auditável, usa saldo atual e é idempotente", () => {
  const { context, data } = harness();
  const input = { clientId: "nat", type: "charge", source: "individual", finalMessage: "Saldo R$ 351,84", operationId: "charge:nat:1" };
  const first = context.Mensagens.registerOpened(input);
  const second = context.Mensagens.registerOpened(input);
  assert.equal(first.id, second.id);
  assert.equal(data.messageHistory.length, 1);
  assert.equal(data.cobrancas.length, 1);
  assert.equal(data.messageHistory[0].businessId, "adi-festa");
  assert.equal(data.messageHistory[0].customerId, "nat");
  assert.equal(data.messageHistory[0].actorUid, "owner-uid");
  assert.equal(data.messageHistory[0].actorRoleSnapshot, "owner");
  assert.equal(data.messageHistory[0].channel, "whatsapp");
  assert.equal(data.messageHistory[0].amountAtSend, 351.84);
  assert.equal(data.clientes[0].saldo, -351.84, "cobrança não altera saldo financeiro");
});

test("marcar como não enviado desfaz o indicador sem alterar saldo", () => {
  const { context, data } = harness();
  const record = context.Mensagens.registerOpened({ clientId: "nat", finalMessage: "Teste", operationId: "charge:nat:2" });
  context.Mensagens.markNotSent(record.id);
  assert.equal(data.messageHistory[0].status, "not_sent");
  assert.equal(data.cobrancas.length, 0);
  assert.equal(data.movimentacoes[0].status, "not_sent");
  assert.equal(data.clientes[0].lastChargeAt, null);
  assert.equal(data.clientes[0].saldo, -351.84);
});

test("permissão negada interrompe o registro, mas owner passa pelo mesmo contrato", () => {
  const denied = harness({ allowed: false });
  assert.throws(() => denied.context.Mensagens.registerOpened({ clientId: "nat", finalMessage: "Teste" }), /acesso não permite/i);
  assert.equal(denied.data.messageHistory.length, 0);
  const owner = harness({ allowed: true });
  assert.doesNotThrow(() => owner.context.Mensagens.registerOpened({ clientId: "nat", finalMessage: "Teste" }));
});

test("popup bloqueado no desktop não é tratado como cobrança aberta", () => {
  const { context } = harness();
  context.open = () => null;
  const result = context.Mensagens.openWhatsApp("https://wa.me/5517999991234?text=Oi", { mobile: false });
  assert.deepEqual({ ...result }, { opened: false, method: "blocked" });
});

test("UI instrumenta os dois fluxos e não usa confirm nativo", () => {
  const mobile = fs.readFileSync("js/mensagens-mobile.js", "utf8");
  const actions = fs.readFileSync("js/client-actions.js", "utf8");
  for (const event of ["action clicked", "customer validated", "phone validated", "message generated", "charge confirmation accepted", "start clicked", "selected customers", "current index", "customer prepared", "whatsapp opened", "waiting for next"])
    assert.match(mobile, new RegExp(event));
  assert.doesNotMatch(mobile, /\bconfirm\s*\(/);
  assert.match(mobile, /Continuar para WhatsApp/);
  assert.match(actions, /matchMedia\("\(max-width: 767px\)"\)\.matches/);
});
