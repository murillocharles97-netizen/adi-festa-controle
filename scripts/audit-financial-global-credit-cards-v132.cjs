const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd();
const FIXTURE = "/tests/financial-module.fixture.html";
const ARTIFACTS = path.join(ROOT, "artifacts", "financial-global-credit-cards-v132");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const pause = (milliseconds = 180) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function staticServer() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(ROOT, `.${pathname === "/" ? FIXTURE : pathname}`);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return response.writeHead(404).end("Not found");
    response.setHeader("Content-Type", `${MIME[path.extname(file)] || "application/octet-stream"}; charset=utf-8`);
    response.setHeader("Cache-Control", "no-store");
    fs.createReadStream(file).pipe(response);
  });
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage(), runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("favicon")) runtimeErrors.push(message.text()); });
  const url = `http://127.0.0.1:${server.address().port}${FIXTURE}`;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const click = async (selector) => { await page.waitForSelector(selector, { visible: true }); await page.$eval(selector, (element) => element.click()); await pause(); };
  const shot = async (name, fullPage = false) => page.screenshot({ path: path.join(ARTIFACTS, name), fullPage });
  const reset = async (width = 390, height = 844) => {
    await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 780 });
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(".financial-home-summary strong");
    await pause();
  };
  const chooseSpace = async (spaceId) => {
    await click("[data-financial-open-spaces]");
    await click(`[data-financial-select-view="space:${spaceId}"]`);
    await page.waitForSelector("[data-financial-view=cards]");
  };
  const chooseConsolidated = async () => {
    await click("[data-financial-open-spaces]");
    await click('[data-financial-select-view="all_spaces"]');
    await page.waitForSelector(".financial-consolidated-home");
  };
  const openNewCard = async () => {
    await click('[data-financial-view="institutions"]');
    await click("[data-financial-add-product]");
    await shot("01-adicionar-cartao.png");
    await click('[data-financial-add-kind="credit_card"]');
    await page.waitForSelector("[data-credit-card-wizard]");
  };

  await reset();
  await openNewCard();
  const initial = await page.evaluate(() => ({
    step: document.querySelector("[data-credit-card-wizard]")?.innerText || "",
    creationSpacePicker: Boolean(document.querySelector("[data-creation-space]")),
  }));
  assert(!initial.creationSpacePicker && /Passo 1 de 4/.test(initial.step) && /Nome\/apelido/.test(initial.step), `Fluxo inicial incorreto: ${JSON.stringify(initial)}`);
  await shot("02-cadastro-direto-do-cartao.png");
  await page.$eval('[name="name"]', (field) => { field.value = "Nubank"; field.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval('[name="institution"]', (field) => { field.value = "Nubank"; field.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval('[name="last4"]', (field) => { field.value = "1234"; field.dispatchEvent(new Event("input", { bubbles: true })); });
  await click("[data-card-next]");
  await page.$eval('[name="limit"]', (field) => { field.value = "5000,00"; field.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval('[name="closingDay"]', (field) => { field.value = "15"; field.dispatchEvent(new Event("input", { bubbles: true })); });
  await page.$eval('[name="dueDay"]', (field) => { field.value = "22"; field.dispatchEvent(new Event("input", { bubbles: true })); });
  await click("[data-card-next]");
  const allSpaces = await page.evaluate(() => ({
    active: document.querySelector('[data-card-access="all_spaces"]')?.classList.contains("active"),
    text: document.querySelector("[data-credit-card-wizard]")?.innerText || "",
  }));
  assert(allSpaces.active && /novos espaços/i.test(allSpaces.text), `Todos os espaços não é o padrão: ${JSON.stringify(allSpaces)}`);
  await shot("03-disponibilidade-todos-os-espacos.png");
  await click('[data-card-access="selected_spaces"]');
  await click('[data-card-space="personal"]');
  await click('[data-card-space="car"]');
  const selected = await page.evaluate(() => ({ active: document.querySelectorAll("[data-card-space].active").length, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth) }));
  assert(selected.active === 2 && selected.overflow <= 1, `Seleção de espaços inválida: ${JSON.stringify(selected)}`);
  await shot("04-disponibilidade-alguns-espacos.png");

  await reset();
  await chooseSpace("car");
  await click('[data-financial-view="cards"]');
  const car = await page.evaluate(() => ({ cards: document.querySelectorAll('[data-financial-card-id="card-c6"]').length, text: document.querySelector(".financial-credit-grid")?.innerText || "" }));
  assert(car.cards === 1 && /C6 Carbon/.test(car.text) && /Todos os espaços/.test(car.text), `C6 no Carro inválido: ${JSON.stringify(car)}`);
  await shot("05-c6-no-espaco-carro.png");

  await reset();
  await chooseSpace("personal");
  await click('[data-financial-view="cards"]');
  const house = await page.evaluate(() => ({ cards: document.querySelectorAll('[data-financial-card-id="card-c6"]').length, text: document.querySelector(".financial-credit-grid")?.innerText || "" }));
  assert(house.cards === 1 && /C6 Carbon/.test(house.text), `C6 na Casa inválido: ${JSON.stringify(house)}`);
  await shot("06-mesmo-c6-no-espaco-casa.png");

  await reset();
  await chooseConsolidated();
  const consolidated = await page.evaluate(() => ({
    c6Institutions: [...document.querySelectorAll(".financial-institution-card")].filter((item) => /C6 Bank/i.test(item.innerText)).length,
    c6Invoices: document.querySelectorAll('[data-financial-invoice-id="card-c6_2026-09"]').length,
  }));
  assert(consolidated.c6Institutions === 1 && consolidated.c6Invoices === 1, `Cartão/fatura duplicados na visão consolidada: ${JSON.stringify(consolidated)}`);
  await shot("07-fatura-unica-consolidada.png");
  await reset();
  await chooseSpace("personal");
  await click('[data-financial-view="cards"]');
  await click('[data-financial-card-id="card-c6"] [data-financial-card-action="invoice"]');
  await page.waitForSelector(".financial-invoice-sheet", { visible: true });
  const purchasesText = await page.$eval('[data-invoice-panel="purchases"]', (element) => element.innerText);
  assert(/Mercado/.test(purchasesText) && /Combustível/.test(purchasesText), `Compras não foram consolidadas na mesma fatura: ${purchasesText}`);
  const invoice = await page.evaluate(() => ({
    spaces: document.querySelectorAll(".financial-breakdown-list").length,
    text: document.querySelector('[data-invoice-panel="spaces"]')?.innerText || "",
    overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  }));
  assert(/Casa/.test(invoice.text) && /Carro/.test(invoice.text), `Detalhe da fatura sem distribuição: ${JSON.stringify(invoice)}`);
  assert(invoice.overflow <= 1, `Detalhe da fatura tem overflow: ${invoice.overflow}px`);
  await shot("08-distribuicao-da-fatura-por-espaco.png", true);

  await reset();
  await chooseSpace("personal");
  await click('[data-financial-view="cards"]');
  await click('[data-financial-edit-card="card-c6"]');
  await click("[data-card-next]");
  await click("[data-card-next]");
  await click("[data-card-next]");
  const detail = await page.evaluate(() => document.querySelector("[data-credit-card-wizard]")?.innerText || "");
  assert(/Conferir cartão/.test(detail) && /Todos os meus espaços/.test(detail) && /Remover cartão/.test(detail), "Detalhe/configuração do cartão incompleto.");
  await shot("09-detalhe-e-configuracao-do-cartao.png");

  await reset(360, 800);
  await openNewCard();
  const mobile = await page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), width: innerWidth }));
  assert(mobile.overflow <= 1, `Wizard mobile 360 tem overflow: ${JSON.stringify(mobile)}`);
  await shot("10-mobile-360-cadastro-cartao.png");

  assert(runtimeErrors.length === 0, `Erros de runtime: ${runtimeErrors.join(" | ")}`);
  await browser.close();
  server.close();
  console.log(JSON.stringify({ ok: true, initial, allSpaces, selected, car, house, consolidated, invoice: { spaces: invoice.spaces }, mobile, screenshots: 10, artifacts: ARTIFACTS }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
