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

test("templates pessoais usam categorias macro e subcategorias opcionais", () => {
  const tree = engine.defaultCategoryTree("personal"), categories = tree.filter((item) => item.type === "category");
  assert.deepEqual(Array.from(categories, (item) => item.name), [
    "Casa", "Alimentação", "Transporte", "Carro", "Saúde", "Educação", "Lazer",
    "Assinaturas", "Compras", "Dívidas", "Impostos", "Pets", "Família", "Outros",
  ]);
  const home = categories.find((item) => item.name === "Casa");
  assert.deepEqual(Array.from(engine.subcategoriesFor(tree, home.id), (item) => item.name), [
    "Aluguel", "Condomínio", "Energia", "Água", "Internet", "Gás", "Manutenção", "Móveis", "Outros",
  ]);
  assert.equal(home.financialSpaceId, null);
  assert.equal(home.isDefault, true);
});

test("templates de negócio cobrem estoque, marketing, equipe e equipamentos", () => {
  const tree = engine.defaultCategoryTree("business"), categories = tree.filter((item) => item.type === "category");
  assert.deepEqual(Array.from(categories, (item) => item.name), [
    "Estrutura", "Estoque e mercadorias", "Fornecedores", "Equipe", "Marketing", "Transporte",
    "Sistemas e assinaturas", "Impostos e taxas", "Manutenção", "Equipamentos", "Serviços",
    "Retiradas", "Financeiro", "Outros",
  ]);
  const inventory = categories.find((item) => item.name === "Estoque e mercadorias"),
    equipment = categories.find((item) => item.name === "Equipamentos");
  assert.ok(engine.subcategoriesFor(tree, inventory.id).some((item) => item.name === "Insumos"));
  assert.ok(engine.subcategoriesFor(tree, equipment.id).some((item) => item.name === "Impressora"));
});

test("resumo agrega por categoria macro sem fragmentar pelas subcategorias", () => {
  const items = [
    entry({ id: "rent", amountCents: 150000, categoryId: "default_personal_home", categoryName: "Casa", subcategoryId: "default_personal_home_rent", subcategoryName: "Aluguel" }),
    entry({ id: "energy", amountCents: 34000, categoryId: "default_personal_home", categoryName: "Casa", subcategoryId: "default_personal_home_energy", subcategoryName: "Energia" }),
    entry({ id: "netflix", amountCents: 5000, categoryId: "default_personal_subscriptions", categoryName: "Assinaturas", subcategoryId: "default_personal_subscriptions_streaming", subcategoryName: "Streaming" }),
  ];
  const summary = engine.summarize(items);
  assert.equal(summary.categories.length, 2);
  assert.equal(summary.categories.find((item) => item.categoryName === "Casa").amountCents, 184000);
});

test("migra apenas categorias legadas claramente reconhecíveis", () => {
  assert.deepEqual(
    JSON.parse(JSON.stringify(engine.legacyCategoryUpgrade({ categoryId: "default_rent", categoryName: "Aluguel" }, "personal"))),
    {
      categoryId: "default_personal_home",
      categoryName: "Casa",
      categoryIcon: "house",
      subcategoryId: "default_personal_home_rent",
      subcategoryName: "Aluguel",
      categorySchemaVersion: 2,
      categoryMigrationStatus: "migrated",
    },
  );
  assert.equal(engine.legacyCategoryUpgrade({ categoryId: "custom-unknown", categoryName: "Impressão 3D" }, "business"), null);
  assert.equal(engine.legacyCategoryUpgrade({ categoryId: "default_fees", categoryName: "Taxas" }, "business"), null);
});

test("lançamentos preservam categoria macro, detalhe e tipo independentes", () => {
  const examples = [
    entry({ description: "Aluguel + condomínio", categoryId: "default_personal_home", categoryName: "Casa", subcategoryId: "default_personal_home_rent", subcategoryName: "Aluguel", entryType: "expense" }),
    entry({ description: "Conta CPFL", categoryId: "default_personal_home", categoryName: "Casa", subcategoryId: "default_personal_home_energy", subcategoryName: "Energia", entryType: "expense" }),
    entry({ description: "Filamento PLA", categoryId: "default_business_inventory", categoryName: "Estoque e mercadorias", subcategoryId: "default_business_inventory_supplies", subcategoryName: "Insumos", entryType: "expense" }),
    entry({ description: "Notebook", categoryId: "default_business_equipment", categoryName: "Equipamentos", subcategoryId: "default_business_equipment_computer", subcategoryName: "Computador", entryType: "investment", frequency: "none" }),
  ];
  assert.deepEqual(Array.from(examples, (item) => [item.categoryName, item.subcategoryName]), [["Casa", "Aluguel"], ["Casa", "Energia"], ["Estoque e mercadorias", "Insumos"], ["Equipamentos", "Computador"]]);
  assert.equal(examples[3].entryType, "investment");
  assert.equal(examples[3].frequency, "none");
});

test("período mensal usa limites locais e nunca mistura setembro com outubro", () => {
  const september = entry({ id: "sep", status: "pending", dueAt: "2026-09-10T12:00:00.000Z", amountCents: 150000 }),
    october = entry({ id: "oct", status: "pending", dueAt: "2026-10-10T12:00:00.000Z", amountCents: 150000 });
  assert.equal(engine.belongsToPeriod(september, "2026-09"), true);
  assert.equal(engine.belongsToPeriod(october, "2026-09"), false);
  assert.equal(engine.belongsToPeriod(october, "2026-10"), true);
  assert.equal(engine.summarize([september]).pendingPayablesCents, 150000);
});

test("exceções e fim de série impedem recriar uma ocorrência removida", () => {
  const recurrence = {
    active: true,
    seriesStartAt: "2026-09-10T12:00:00.000Z",
    seriesEndAt: null,
    skippedOccurrenceKeys: ["2026-10-10"],
    overrideOccurrenceKeys: ["2026-11-10"],
  };
  assert.equal(engine.shouldGenerateOccurrence(recurrence, "2026-09-10T12:00:00.000Z"), true);
  assert.equal(engine.shouldGenerateOccurrence(recurrence, "2026-10-10T12:00:00.000Z"), false);
  assert.equal(engine.shouldGenerateOccurrence(recurrence, "2026-11-10T12:00:00.000Z"), false);
  assert.equal(engine.shouldGenerateOccurrence({ ...recurrence, skippedOccurrenceKeys: [], seriesEndAt: "2026-10-10T12:00:00.000Z" }, "2026-10-10T12:00:00.000Z"), false);
});

test("editar esta e as próximas preserva a sequência mesmo com exceção intermediária", () => {
  const september = { recurrenceSequence: 1, dueAt: "2026-09-10T12:00:00.000Z" },
    november = { recurrenceSequence: 3, dueAt: "2026-11-10T12:00:00.000Z" },
    changed = engine.rescheduleRecurringInstances([september, november], september, "2026-09-12T12:00:00.000Z", "monthly");
  assert.equal(engine.localIsoDate(changed[0].dueAt), "2026-09-12");
  assert.equal(engine.localIsoDate(changed[1].dueAt), "2026-11-12");
});
