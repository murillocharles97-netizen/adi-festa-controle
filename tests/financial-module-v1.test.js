const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (file) => fs.readFileSync(file, "utf8"), service = read("js/firebase/financial-space-service.js"), app = read("js/app.js"), html = read("index.html"), sw = read("service-worker.js");

test("Financeiro está no router, shell e usa um único renderer responsivo", () => {
  assert.match(read("js/router.js"), /'financeiro'/);
  assert.match(html, /data-route="financeiro"/);
  assert.match(app, /financeiro:\s*\(\) => FinanceiroUI\.render\(\)/);
  assert.doesNotMatch(app, /FinanceiroDesktop|FinanceiroMobile/);
  assert.ok(html.indexOf("financial-space-service.js?v=118") < html.indexOf("auth.js?v=115"));
  assert.match(read("js/financial-ui.js"), /financial-service-ready/);
});

test("persistência usa espaços isolados, centavos e consultas mensais limitadas", () => {
  assert.match(service, /financialSpaces/);
  assert.match(service, /where\("periodKey", "==", selectedPeriod\)/);
  assert.match(service, /MAX_MONTH_ENTRIES = 500/);
  assert.match(service, /amountCents/);
  assert.doesNotMatch(service, /onSnapshot/);
});

test("listagem inicial satisfaz as Rules sem depender de filtro implícito", () => {
  assert.match(service, /where\("ownerUid", "==", currentUid\)[\s\S]*where\("type", "==", "personal"\)[\s\S]*where\("active", "==", true\)/);
  assert.match(service, /where\("ownerUid", "==", currentUid\)[\s\S]*where\("type", "==", "other"\)[\s\S]*where\("active", "==", true\)/);
  assert.match(service, /where\("linkedBusinessId", "==", currentBusinessId\)[\s\S]*where\("type", "==", "business"\)[\s\S]*where\("active", "==", true\)/);
  assert.match(read("js/financial-ui.js"), /Não foi possível acessar este espaço financeiro\./);
  assert.doesNotMatch(read("js/financial-ui.js"), /state\.error = error\.message/);
});

test("venda, fiado e cancelamento alimentam a projeção sem legado retroativo", () => {
  assert.match(read("js/vendas.js"), /recordSale\?\.\(criada\)/);
  assert.match(read("js/vendas.js"), /reverseSale\?\.\(removida\)/);
  assert.match(read("js/fiados.js"), /recordCreditPayment\?\.\(pagamento\)/);
  assert.match(service, /autoEntryFromSalesSince/);
  assert.match(service, /matchedAllocations/);
  assert.match(service, /childRef\(space\.id, "entries", `sale_\$\{allocation\.saleId\}`\)/);
  assert.doesNotMatch(service, /payment\.effectiveAmount \?\? payment\.valor/);
});

test("operações automáticas e transferências têm IDs determinísticos", () => {
  assert.match(service, /runTransaction/);
  assert.match(service, /existing\.exists\(\)/);
  assert.match(service, /`sale_\$\{sale\.id\}`/);
  assert.match(service, /`credit_payment_\$\{payment\.id\}`/);
  assert.match(service, /`reversal_\$\{entry\.id\}`/);
  assert.match(service, /`\$\{transferId\}_out`/);
  assert.match(service, /`\$\{transferId\}_in`/);
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

test("release 118 publica hierarquia financeira e cache atômico", () => {
  assert.match(read("js/build-info.js"), /release: "118"/);
  assert.match(sw, /adi-festa-v118-financial-category-hierarchy/);
  for (const asset of ["css/financial.css", "js/financial-engine.js", "js/financial-ui.js", "js/firebase/financial-space-service.js"])
    assert.match(sw, new RegExp(asset.replaceAll("/", "\\/")));
});
