const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const { spawnSync } = require("node:child_process");

const read = (file) => fs.readFileSync(file, "utf8"), service = read("js/firebase/financial-space-service.js"), backend = read("functions/src/services/financial-income-service.js"), functionsIndex = read("functions/src/index.js"), app = read("js/app.js"), html = read("index.html"), sw = read("service-worker.js");

test("Financeiro está no router, shell e usa um único renderer responsivo", () => {
  assert.match(read("js/router.js"), /'financeiro'/);
  assert.match(html, /data-route="financeiro"/);
  assert.match(app, /financeiro:\s*\(\) => FinanceiroUI\.render\(\)/);
  assert.doesNotMatch(app, /FinanceiroDesktop|FinanceiroMobile/);
  assert.ok(html.indexOf("financial-space-service.js?v=125") < html.indexOf("auth.js?v=123"));
  assert.match(read("js/financial-ui.js"), /financial-service-ready/);
});

test("persistência usa espaços isolados, centavos e consultas mensais limitadas", () => {
  assert.match(service, /financialSpaces/);
  assert.match(service, /where\("periodKey", "==", selectedPeriod\)/);
  assert.match(service, /MAX_MONTH_ENTRIES = 500/);
  assert.match(service, /amountCents/);
  assert.doesNotMatch(service, /onSnapshot/);
});

test("dashboard separa competência realizada de vencimentos do período", () => {
  assert.match(service, /where\("periodKey", "==", selectedPeriod\)/);
  assert.match(service, /where\("dueAt", ">=", start\.toISOString\(\)\)/);
  assert.match(service, /where\("dueAt", "<", endExclusive\.toISOString\(\)\)/);
  assert.doesNotMatch(service, /async function pendingEntries/);
  assert.match(read("js/financial-ui.js"), /data\.accounts/);
});

test("contas abrem detalhes e diferenciam ocorrência, série e estorno", () => {
  const ui = read("js/financial-ui.js");
  assert.match(ui, /Detalhes da conta/);
  assert.match(ui, /Somente esta conta/);
  assert.match(ui, /Esta e as próximas/);
  assert.match(ui, /Gerenciar recorrência/);
  assert.match(ui, /Reverter lançamento/);
  assert.match(service, /overrideOccurrenceKeys: arrayUnion/);
  assert.match(service, /skippedOccurrenceKeys: arrayUnion/);
  assert.match(service, /async function updateRecurrenceFrom/);
  assert.match(service, /async function cancelRecurrenceFrom/);
});

test("listagem inicial satisfaz as Rules sem depender de filtro implícito", () => {
  assert.match(service, /where\("ownerUid", "==", currentUid\)[\s\S]*where\("type", "==", "personal"\)[\s\S]*where\("active", "==", true\)/);
  assert.match(service, /where\("ownerUid", "==", currentUid\)[\s\S]*where\("type", "==", "other"\)[\s\S]*where\("active", "==", true\)/);
  assert.match(service, /where\("linkedBusinessId", "==", currentBusinessId\)[\s\S]*where\("type", "==", "business"\)[\s\S]*where\("active", "==", true\)/);
  assert.match(read("js/financial-ui.js"), /Não foi possível acessar este espaço financeiro\./);
  assert.doesNotMatch(read("js/financial-ui.js"), /state\.error = error\.message/);
});

test("venda, pagamento e estorno usam projeção server-side sem dupla fonte", () => {
  assert.doesNotMatch(read("js/vendas.js"), /recordSale\?\.\(criada\)/);
  assert.doesNotMatch(read("js/fiados.js"), /recordCreditPayment\?\.\(pagamento\)/);
  assert.match(functionsIndex, /projectSaleFinancialIncome/);
  assert.match(functionsIndex, /projectCustomerPaymentFinancialIncome/);
  assert.match(backend, /credit-sale-not-realized/);
  assert.match(backend, /payment\.effectiveAmount\?\?payment\.valor/);
  assert.match(backend, /legacyAmount/);
  assert.match(backend, /automatic_income_reversed/);
});

test("operações automáticas e transferências têm IDs determinísticos", () => {
  assert.match(backend, /runTransaction/);
  assert.match(backend, /existing\.exists/);
  assert.match(backend, /`sale_\$\{saleId\}`/);
  assert.match(backend, /`credit_payment_\$\{paymentId\}`/);
  assert.match(service, /`reversal_\$\{entry\.id\}`/);
  assert.match(service, /`\$\{transferId\}_out`/);
  assert.match(service, /`\$\{transferId\}_in`/);
});

test("automação é explícita por espaço e reconciliação é limitada", () => {
  assert.match(service, /automationState/);
  assert.match(service, /reconcileBusinessFinancialIncome/);
  assert.match(service, /limit: 100/);
  assert.match(backend, /where\('data','>=',activationIso\)/);
  assert.match(backend, /\.limit\(capped\)/);
  assert.match(read("js/financial-ui.js"), /Automação financeira/);
  assert.match(read("js/financial-ui.js"), /Automático/);
});

test("comprovantes aceitam somente imagens/PDF e ficam no lançamento", () => {
  assert.match(service, /image\/jpeg/);
  assert.match(service, /application\/pdf/);
  assert.match(service, /10 \* 1024 \* 1024/);
  assert.match(service, /financialSpaces\/\$\{space\.id\}\/entries\/\$\{entryId\}/);
});

test("categorias V2 separam macro, subcategoria e customização por espaço", () => {
  const engine = read("js/financial-engine.js"), ui = read("js/financial-ui.js");
  assert.match(engine, /defaultCategoryTree/);
  assert.match(engine, /parentCategoryId/);
  assert.match(engine, /categorySchemaVersion/);
  assert.match(service, /childRef\(spaceId, "categories", id\)/);
  assert.match(service, /parentCategoryId/);
  assert.match(service, /migrateLegacyCategories/);
  assert.match(ui, /Passo \$\{draft\.step\} de 4/);
  assert.match(ui, /Subcategoria <small>\(opcional\)<\/small>/);
  assert.match(ui, /Criar categoria/);
  assert.match(ui, /Criar subcategoria/);
  assert.doesNotMatch(ui, /data-financial-entry-form/);
});

test("release 125 publica a correção de inicialização no novo cache VECONI", () => {
  assert.match(read("js/build-info.js"), /release: "125"/);
  assert.match(sw, /veconi-v125-finance-loading-fix/);
  for (const asset of ["css/financial.css", "css/financial-credit-v2.css", "js/financial-engine.js", "js/financial-ui.js", "js/firebase/financial-space-service.js"])
    assert.match(sw, new RegExp(asset.replaceAll("/", "\\/")));
});

test("serviço financeiro é sintaticamente válido como módulo ESM", () => {
  const parsed = spawnSync(process.execPath, ["--input-type=module", "--check"], { input: service, encoding: "utf8" });
  assert.equal(parsed.status, 0, parsed.stderr);
  assert.equal((service.match(/const ownedSpaces/g) || []).length, 1);
  assert.equal((service.match(/const normalizeCreditCard/g) || []).length, 1);
  assert.equal((service.match(/const cardCanBeUsedInSpace/g) || []).length, 1);
});

test("inicialização progressiva nunca prende o dashboard ao módulo de cartões", () => {
  const ui = read("js/financial-ui.js");
  assert.match(ui, /waitForFinancialService/);
  assert.match(ui, /FINANCE_INIT_TIMEOUT_MS = 12_000/);
  assert.match(ui, /onCore: \(core\)/);
  assert.match(service, /Promise\.race\(\[/);
  assert.match(service, /FINANCE_CREDIT_ERROR/);
  assert.match(ui, /Não foi possível carregar cartões\./);
  assert.match(ui, /FINANCE_INIT_DONE/);
  assert.match(ui, /FINANCE_INIT_ERROR/);
  assert.doesNotMatch(ui, /await service\.reconcileBusinessIncome/);
});
