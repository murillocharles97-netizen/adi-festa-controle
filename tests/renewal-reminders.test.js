// Lembretes de renovação: Renovações → Central (motor real) → pré-visualização → WhatsApp → confirmação.
process.env.TZ = "UTC";
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { JSDOM } = require("jsdom");

const REFERENCE = "2026-08-14T12:00:00.000Z"; // 09:00 em São Paulo
const plain = (value) => JSON.parse(JSON.stringify(value));
const wait = (ms = 0) => new Promise((resolve) => setTimeout(resolve, ms));
async function until(check, label, tries = 200) {
  for (let i = 0; i < tries; i += 1) { if (check()) return; await wait(5); }
  assert.fail(`timeout: ${label} | ${globalThis.__lastToasts ? JSON.stringify(globalThis.__lastToasts()) : ""}`);
}
// In-memory stand-in for DB.localRecords (IndexedDB) with the same request/transaction shape.
function localRecords() {
  const map = new Map(), copy = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const request = (fn) => { const r = {}; queueMicrotask(() => { r.result = fn(); r.onsuccess?.(); }); return r; };
  const store = { get: (key) => request(() => copy(map.get(key))), put: (value) => map.set(value.key, copy(value)),
    index: () => ({ openCursor: () => request(() => null) }) };
  return { map, transaction: (_mode, fn) => new Promise((resolve, reject) => fn(store, resolve, reject)),
    read: async (key) => copy(map.get(key)), list: async (scope) => [...map.values()].filter((item) => item.scope === scope).map(copy) };
}
const sub = (id, spaceId, label, price, expiresAt, extra = {}) => ({ id, clientId: "c1", businessId: "biz", spaceId, productId: "p", label, status: "active",
  expiresAt, contractedPrice: price, durationValue: 1, durationUnit: "months", lastSaleId: `sale-${id}`, reminders: [7, 1, 0], ...extra });

function boot({ active = "centro", online = true, history = [] } = {}) {
  const dom = new JSDOM(`<!doctype html><body><div id="toasts"></div><div id="modal"></div><main id="app" data-page-instance="1"></main></body>`, { runScripts: "outside-only", url: "https://veconi.test/#/renovacoes" });
  const w = dom.window, calls = { opened: [], toasts: [], routes: [] };
  const cloud = new Map([
    ["s-pilates", sub("s-pilates", "centro", "Plano Pilates", 180, "2026-08-15T02:00:00.000Z")],      // 23:00 SP: vence hoje
    ["s-academia", sub("s-academia", "centro", "Academia 3x", 99.9, "2026-08-17T15:00:00.000Z")],     // em 3 dias
    ["s-outro", sub("s-outro", "bairro", "Plano do Bairro", 250, "2026-08-16T15:00:00.000Z")],       // outro espaço
  ]);
  const data = { config: { nome: "Studio QA", pix: "" }, clientes: [{ id: "c1", nome: "Joana Conceição", telefone: "11988881234", saldo: -550 }],
    customerSubscriptions: [...cloud.values()].map((item) => ({ ...item })), customerSubscriptionEvents: [], produtos: [{ id: "p", nome: "Plano" }],
    messageHistory: history, messageTemplates: [], messageSequences: [] };
  const space = { active };
  Object.defineProperty(w.navigator, "onLine", { configurable: true, get: () => online });
  Object.assign(w, {
    structuredClone, matchMedia: () => ({ matches: true, addEventListener() {}, removeEventListener() {} }),
    Utils: { escapar: (v) => String(v ?? "").replace(/[&<>'"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" }[c])),
      dinheiro: (v) => `R$ ${Number(v || 0).toFixed(2).replace(".", ",")}`, somenteNumeros: (v) => String(v || "").replace(/\D/g, ""),
      telefoneWhatsApp: (v) => { const n = String(v).replace(/\D/g, ""); return n.startsWith("55") ? n : `55${n}`; }, uuid: () => `id-${Math.random().toString(36).slice(2)}`, toast: (t) => calls.toasts.push(t) },
    DB: { carregar: () => data, alterar: (fn) => fn(data), getBusinessId: () => "biz", localRecords: localRecords() },
    FirebaseSession: { user: { uid: "owner" } },
    TeamAccess: { actor: () => ({ actorUid: "owner", actorNameSnapshot: "Dona", actorRoleSnapshot: "owner" }), has: () => true, canRoute: () => true },
    Clientes: { obter: (id) => data.clientes.find((c) => c.id === id) || null },
    Produtos: { obter: () => null }, ProductVariations: { get: () => null },
    SpaceContext: { scopesCustomers: () => true, activeId: () => space.active, homeId: () => space.active,
      customerSpaces: () => [{ id: "centro", name: "Loja Centro" }, { id: "bairro", name: "Loja Bairro" }],
      showsRenewal: (row) => row.spaceId === space.active, viewScope: () => space.active },
    SyncFirebase: { queryCustomerSubscriptions: async ({ subscriptionId, clientId }) => {
      const row = cloud.get(subscriptionId);
      return row && row.clientId === clientId && row.spaceId === space.active ? [{ ...row }] : [];
    } },
    Router: { atual: () => "renovacoes", ir: (r) => calls.routes.push(r) },
    AppPageRuntime: { mount: (r) => calls.routes.push(`mount:${r}`) },
    MobileMessages: { openCenter: async () => calls.routes.push("center") },
  });
  w.eval(`(() => { const Real = Date; class Fixed extends Real { constructor(...a) { super(...(a.length ? a : ["${REFERENCE}"])); } static now() { return new Real("${REFERENCE}").getTime(); } } window.Date = Fixed; })()`);
  for (const file of ["js/customer-subscriptions.js", "js/mensagens.js", "js/renewal-messages.js", "js/message-sequence.js", "js/message-sequence-ui.js"])
    w.eval(fs.readFileSync(file, "utf8"));
  w.Mensagens.openWhatsApp = (url) => { calls.opened.push(url); return { opened: true }; };
  const $ = (s) => w.document.querySelector(s);
  globalThis.__lastToasts = () => ({ toasts: calls.toasts, modal: w.document.querySelector("#modal").textContent.slice(0, 300) });
  return { w, data, cloud, calls, space, $, modal: () => w.document.querySelector("#modal") };
}
const context = (h, ids = ["s-pilates", "s-academia"]) => h.w.RenewalMessages.buildContext(ids.map((id) => h.data.customerSubscriptions.find((s) => s.id === id)), { spaceId: "centro", spaceName: "Loja Centro" });
async function startReminder(h, ids) {
  const renewal = context(h, ids), template = h.w.MessageSequenceUI.defaultTemplate("renewal");
  await h.w.MessageSequenceUI.start({ type: "renewal", clientIds: Object.keys(renewal.items), templateId: template.id, baseMessage: template.content, renewal });
  // The composer renders only after the subscriptions were re-checked.
  await until(() => h.$("#sequence-preview") && h.$("[data-renewal-plan-count]"), "composer");
}

test("variáveis: plano, valor e vencimento juntos por linha; nada de Fiado; outro espaço nunca entra", async () => {
  const h = boot();
  await startReminder(h);
  const preview = h.$("#sequence-preview").textContent;
  assert.match(preview, /Olá, Joana! Passando para lembrar da sua renovação na Studio QA:/);
  assert.match(preview, /• Plano Pilates — R\$ 180,00 \/ 1 mês — vence hoje \(14\/08\/2026\)/);
  assert.match(preview, /• Academia 3x — R\$ 99,90 \/ 1 mês — vence em 3 dias \(17\/08\/2026\)/);
  assert.doesNotMatch(preview, /Bairro|250|550/, "sem plano de outro espaço e sem saldo de Fiado");
  assert.equal(h.$("[data-renewal-plan-count]").firstChild.textContent, "2");
  assert.deepEqual([...h.w.document.querySelectorAll("[data-sequence-variable]")].map((b) => b.dataset.sequenceVariable).includes("saldo"), false);
  const text = h.$("#sequence-text");
  text.value = "Oi {{primeiro_nome}}, seu {{plano}} vence {{vencimento}}"; text.dispatchEvent(new h.w.Event("input"));
  assert.match(h.$("[data-renewal-problems]").textContent, /tem 2 planos\. Use \{\{renovacoes\}\}/);
  assert.equal(h.$("#sequence-send").disabled, true, "lista separada não é enviada para quem tem 2 planos");
  text.value = "Seu saldo é {{saldo}} {{renovacoes}}"; text.dispatchEvent(new h.w.Event("input"));
  assert.match(h.$("[data-renewal-problems]").textContent, /não incluem saldo/);
  assert.doesNotMatch(h.$("#sequence-preview").textContent, /550/);
  assert.equal(h.$("#sequence-send").disabled, true);
});

test("um plano: {{plano}} {{valor}} {{vencimento}} {{situacao}} {{espaco}} resolvidos do retrato conferido", async () => {
  const h = boot();
  await startReminder(h, ["s-academia"]);
  const text = h.$("#sequence-text");
  text.value = "{{plano}} | {{valor}} | {{vencimento}} | {{situacao}} | {{espaco}}"; text.dispatchEvent(new h.w.Event("input"));
  assert.equal(h.$("#sequence-preview").textContent, "Academia 3x | R$ 99,90 | 17/08/2026 | vence em 3 dias | Loja Centro");
  assert.equal(h.$("#sequence-send").disabled, false);
});

test("fluxo completo: preparada → WhatsApp aberto → confirmada pelo operador, com assinaturas e espaço no histórico", async () => {
  const h = boot();
  await startReminder(h);
  h.$("#sequence-send").click();
  await until(() => h.$("[data-renewal-final]"), "prepared");
  assert.match(h.$("[data-renewal-final]").textContent, /Plano Pilates[\s\S]*Academia 3x/);
  assert.match(h.$("[data-message-states]").textContent, /Mensagem preparada[\s\S]*WhatsApp ainda não aberto[\s\S]*o WhatsApp não informa a entrega/);
  assert.equal(h.calls.opened.length, 0, "preparar não abre nem registra envio");
  assert.equal(h.w.MessageSequence.history().length, 0);
  h.$("[data-sequence-open]").click();
  assert.equal(h.calls.opened.length, 1);
  assert.match(decodeURIComponent(h.calls.opened[0]), /Plano Pilates — R\$ 180,00/);
  await until(() => /WhatsApp aberto ·/.test(h.$("[data-message-states]")?.textContent || ""), "opened state");
  assert.equal(h.w.MessageSequence.history().length, 0, "abrir o WhatsApp não é envio confirmado");
  h.$("[data-sequence-confirm]").click();
  await until(() => h.w.MessageSequence.history().length === 1, "confirmed event");
  const event = plain(h.w.MessageSequence.history()[0]);
  assert.equal(event.type, "renewal");
  assert.equal(event.status, "sent_confirmed");
  assert.equal(event.confirmation, "operator");
  assert.equal(event.deliveryVerified, false);
  assert.ok(event.preparedAt && event.whatsappOpenedAt);
  assert.deepEqual(event.subscriptionIds, ["s-pilates", "s-academia"]);
  assert.equal(event.renewalSpaceId, "centro");
  assert.equal(event.spaceId, "centro");
  assert.equal(event.amountAtSend, null, "sem valor de cobrança");
  await until(() => h.modal().textContent.includes("Lembretes concluídos"), "finished");
  assert.match(h.modal().textContent, /1 confirmado por você[\s\S]*O WhatsApp não informa a entrega/);
  h.$("[data-finish-done]").click();
  await until(() => h.calls.routes.includes("mount:renovacoes"), "back to Renovações");
  assert.deepEqual([...h.w.RenewalMessages.remindedToday().keys()].sort(), ["s-academia", "s-pilates"]);
});

test("revalidação: renovada depois da seleção sai da mensagem com aviso; nada desatualizado é enviado", async () => {
  const h = boot();
  await startReminder(h);
  h.cloud.set("s-academia", { ...h.cloud.get("s-academia"), expiresAt: "2026-09-17T15:00:00.000Z", lastSaleId: "sale-new" });
  h.$("#sequence-send").click();
  await until(() => h.calls.toasts.some((t) => /mudaram desde a pré-visualização/.test(t)), "changed toast");
  await until(() => h.$("[data-renewal-dropped]"), "dropped alert");
  assert.match(h.$("[data-renewal-dropped]").textContent, /Academia 3x: a assinatura foi renovada ou alterada depois da seleção/);
  assert.doesNotMatch(h.$("#sequence-preview").textContent, /Academia/);
  assert.equal(h.calls.opened.length, 0);
  h.cloud.set("s-pilates", { ...h.cloud.get("s-pilates"), status: "cancelled" });
  h.$("#sequence-send").click();
  await until(() => /cancelada/.test(h.$("[data-renewal-dropped]")?.textContent || ""), "cancelled alert");
  assert.equal(h.$("#sequence-send").disabled, true, "sem assinatura conferida, não envia");
});

test("espaço ativo trocado, offline ou leitura falha: não confere, não envia", async () => {
  const moved = boot();
  await startReminder(moved);
  moved.space.active = "bairro";
  moved.$("#sequence-send").click();
  await until(() => /espaço ativo não é o espaço/.test(moved.$("[data-renewal-dropped]")?.textContent || ""), "space alert");
  assert.equal(moved.$("#sequence-send").disabled, true);
  const offline = boot({ online: false });
  await startReminder(offline);
  assert.match(offline.$("[data-renewal-dropped]").textContent, /não foi possível conferir/);
  assert.equal(offline.$("#sequence-send").disabled, true);
  const failing = boot();
  failing.w.SyncFirebase.queryCustomerSubscriptions = async () => { throw Object.assign(Error("x"), { code: "unavailable" }); };
  await startReminder(failing);
  assert.equal(failing.$("#sequence-send").disabled, true);
});

test("lembrete já confirmado hoje exige ação consciente; ontem não bloqueia", async () => {
  const today = [{ id: "e1", operationId: "e1", type: "renewal", status: "sent_confirmed", clientId: "c1", sentAt: "2026-08-14T11:00:00.000Z", subscriptionIds: ["s-pilates"] }];
  const h = boot({ history: today });
  await startReminder(h);
  assert.match(h.$("[data-renewal-repeat]").textContent, /Lembrete já registrado hoje[\s\S]*Plano Pilates · confirmado às 08:00/);
  assert.equal(h.$("#sequence-send").disabled, true);
  h.$("[data-renewal-repeat-ok]").checked = true;
  h.$("[data-renewal-repeat-ok]").dispatchEvent(new h.w.Event("change"));
  assert.equal(h.$("#sequence-send").disabled, false, "nova ação manual consciente é permitida");
  const yesterday = boot({ history: [{ ...today[0], sentAt: "2026-08-13T12:00:00.000Z" }] });
  await startReminder(yesterday);
  assert.equal(yesterday.$("[data-renewal-repeat]"), null);
  const opened = boot({ history: [{ ...today[0], status: "opened_whatsapp" }] });
  assert.equal(opened.w.RenewalMessages.remindedToday().size, 0, "WhatsApp aberto não conta como lembrete enviado");
});

test("contexto: um espaço por lote; a Central só leva clientes e assinaturas selecionados", () => {
  const h = boot();
  const rows = h.data.customerSubscriptions;
  assert.throws(() => h.w.RenewalMessages.buildContext(rows, { spaceId: "centro" }), /único espaço/);
  const ctx = h.w.RenewalMessages.buildContext(rows.filter((r) => r.spaceId === "centro"), { spaceId: "centro", spaceName: "Loja Centro" });
  assert.deepEqual(Object.keys(ctx.items), ["c1"]);
  assert.deepEqual([...ctx.items.c1.map((i) => i.id)], ["s-pilates", "s-academia"], "ordenado por vencimento");
  assert.equal(h.w.RenewalMessages.sanitize(ctx, ["outro"]), null);
  const forged = { ...ctx, items: { c1: [...ctx.items.c1, { ...ctx.items.c1[0], id: "x", spaceId: "bairro" }] } };
  assert.deepEqual([...h.w.RenewalMessages.sanitize(forged, ["c1"]).items.c1.map((i) => i.id)], ["s-pilates", "s-academia"]);
});

test("motor: renovação exige contexto; WhatsApp aberto não muda a revisão; evento publica só messageHistory", async () => {
  const h = boot();
  await assert.rejects(h.w.MessageSequence.start({ type: "renewal", clientIds: ["c1"] }), /a partir da tela Renovações/);
  const engine = fs.readFileSync("js/message-sequence.js", "utf8");
  assert.match(engine, /keepRevision: true/);
  assert.match(engine, /confirmation: 'operator', deliveryVerified: false/);
  const sync = fs.readFileSync("js/firebase/sync.js", "utf8");
  assert.match(sync, /const clientSnapshot = event\.type === "charge" \? await transaction\.get\(clientRef\) : null;/, "lembrete não toca cliente nem cobranças");
});

test("Central e Renovações: tipo renovação só com retrato; volta para Renovações; sem Mercado Pago", () => {
  const center = fs.readFileSync("js/mensagens-mobile.js", "utf8"), page = fs.readFileSync("js/renovacoes.js", "utf8"), module = fs.readFileSync("js/renewal-messages.js", "utf8");
  assert.match(center, /const renewalMode=\(\)=>center\.type==='renewal'&&Boolean\(center\.renewal\?\.items\)/);
  assert.match(center, /reminder\.has\(String\(item\.id\)\)/, "a lista da Central fica restrita aos clientes do lembrete");
  assert.match(page, /type: "renewal", clientIds: Object\.keys\(renewal\.items\), renewal, returnRoute: "renovacoes"/);
  for (const source of [center, page, module]) assert.doesNotMatch(source, /mercadopago|mercado_pago|webhook/i);
});

test("lembrete confirmado em outro aparelho (só na nuvem) também é sinalizado antes do envio", async () => {
  const h = boot();
  const asked = [];
  h.w.SyncFirebase.queryMessageHistorySince = async (since) => {
    asked.push(since);
    h.data.messageHistory.push({ id: "remote", operationId: "remote", type: "renewal", status: "sent_confirmed", clientId: "c1", sentAt: "2026-08-14T10:30:00.000Z", subscriptionIds: ["s-academia"] });
    return [];
  };
  await startReminder(h);
  assert.equal(asked[0], "2026-08-14T03:00:00.000Z", "lê desde a meia-noite de São Paulo");
  assert.match(h.$("[data-renewal-repeat]").textContent, /Academia 3x · confirmado às 07:30/);
  assert.equal(h.$("#sequence-send").disabled, true);
});

test("normalização local preserva o tipo renovação no histórico e nos modelos (senão vira 'custom')", () => {
  const storage = fs.readFileSync("js/storage.js", "utf8");
  assert.equal((storage.match(/\['charge','campaign','notice','custom','renewal'\]\.includes\((m|t)\.type\)/g) || []).length, 2);
});
