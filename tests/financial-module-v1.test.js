const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const read = (file) => fs.readFileSync(file, "utf8"), service = read("js/firebase/financial-space-service.js"), app = read("js/app.js"), html = read("index.html"), sw = read("service-worker.js");

test("Financeiro está no router, shell e usa um único renderer responsivo", () => {
  assert.match(read("js/router.js"), /'financeiro'/);
  assert.match(html, /data-route="financeiro"/);
  assert.match(app, /financeiro:\s*\(\) => FinanceiroUI\.render\(\)/);
  assert.doesNotMatch(app, /FinanceiroDesktop|FinanceiroMobile/);
  assert.ok(html.indexOf("financial-space-service.js?v=115") < html.indexOf("auth.js?v=115"));
  assert.match(read("js/financial-ui.js"), /financial-service-ready/);
});

test("persistência usa espaços isolados, centavos e consultas mensais limitadas", () => {
  assert.match(service, /financialSpaces/);
  assert.match(service, /where\("periodKey", "==", selectedPeriod\)/);
  assert.match(service, /MAX_MONTH_ENTRIES = 500/);
  assert.match(service, /amountCents/);
  assert.doesNotMatch(service, /onSnapshot/);
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

test("release 115 publica módulo e cache atômico", () => {
  assert.match(read("js/build-info.js"), /release: "115"/);
  assert.match(sw, /adi-festa-v115-financial-spaces/);
  for (const asset of ["css/financial.css", "js/financial-engine.js", "js/financial-ui.js", "js/firebase/financial-space-service.js"])
    assert.match(sw, new RegExp(asset.replaceAll("/", "\\/")));
});
