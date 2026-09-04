const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function loadEngine() {
  const context = { window: null, console, Date, Intl, Math, Number, String, Set, Map, Object, Array, structuredClone };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/financial-engine.js", "utf8"), context);
  return context.FinancialEngine;
}

const engine = loadEngine();
const entry = (overrides = {}) => engine.normalizeEntry({
  id: "entry", operationId: "operation", description: "Teste", amountCents: 1000,
  direction: "out", status: "paid", occurredAt: "2026-09-04T12:00:00.000Z",
  dueAt: "2026-09-04T12:00:00.000Z", categoryId: "supplies", categoryName: "Compras",
  ...overrides,
});

test("valores monetários são normalizados em centavos", () => {
  assert.equal(engine.moneyInputToCents("R$ 1.234,56"), 123456);
  assert.equal(engine.moneyInputToCents("10,01"), 1001);
  assert.throws(() => engine.moneyInputToCents("0"));
});

test("resumo mensal separa entradas, saídas, resultado e pendências", () => {
  const items = [
    entry({ id: "sale", direction: "in", amountCents: 842000 }),
    entry({ id: "rent", amountCents: 120000 }),
    entry({ id: "pending", status: "pending", amountCents: 34000, dueAt: "2026-09-06T12:00:00.000Z" }),
  ];
  const summary = engine.summarize(items, { now: "2026-09-04T12:00:00.000Z" });
  assert.equal(summary.totalInCents, 842000);
  assert.equal(summary.totalOutCents, 120000);
  assert.equal(summary.resultCents, 722000);
  assert.equal(summary.pendingPayablesCents, 34000);
  assert.equal(summary.dueSoonCount, 1);
});

test("parcelamento conserva o total exato em centavos", () => {
  const installments = engine.buildInstallments(entry({ amountCents: 10000, status: "pending" , installmentCount: 3 }));
  assert.equal(installments.length, 3);
  assert.equal(installments.reduce((sum, item) => sum + item.amountCents, 0), 10000);
  assert.deepEqual(Array.from(installments, (item) => item.amountCents), [3334, 3333, 3333]);
});

test("recorrência mensal trata o último dia do mês e gera janela controlada", () => {
  const values = engine.buildRecurringInstances(entry({ status: "pending", dueAt: "2026-01-31T12:00:00.000Z", frequency: "monthly" }), 2);
  assert.equal(values.length, 2);
  assert.equal(engine.localIsoDate(values[1].dueAt), "2026-02-28");
});

test("estorno compensa o original no razão e vencidos vêm primeiro", () => {
  const paid = entry({ id: "paid", amountCents: 5000, direction: "out", reversedByEntryId: "reversal" }), reversal = entry({ id: "reversal", amountCents: 5000, direction: "in", entryType: "reversal" });
  assert.equal(engine.summarize([paid, reversal]).resultCents, 0);
  const sorted = engine.sortPayables([
    entry({ id: "future", status: "pending", dueAt: "2026-09-10T12:00:00.000Z" }),
    entry({ id: "late", status: "pending", dueAt: "2026-09-01T12:00:00.000Z" }),
  ], { now: "2026-09-04T12:00:00.000Z" });
  assert.equal(sorted[0].id, "late");
});

test("consolidado soma espaços sem misturar suas identidades", () => {
  const result = engine.consolidate([
    { space: { id: "business" }, entries: [entry({ id: "a", direction: "in", amountCents: 10000 })] },
    { space: { id: "personal" }, entries: [entry({ id: "b", amountCents: 2500 })] },
  ]);
  assert.equal(result.summary.resultCents, 7500);
  assert.equal(result.entries.length, 2);
});
