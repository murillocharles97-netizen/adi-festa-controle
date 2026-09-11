const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd();
const FIXTURE = "/tests/financial-module.fixture.html";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const MOBILE_VIEWPORTS = [[320, 720], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
const pause = (milliseconds = 100) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function staticServer() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(ROOT, `.${pathname === "/" ? FIXTURE : pathname}`);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.setHeader("Content-Type", `${MIME[path.extname(file)] || "application/octet-stream"}; charset=utf-8`);
    response.setHeader("Cache-Control", "no-store");
    fs.createReadStream(file).pipe(response);
  });
}

async function main() {
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const runtimeErrors = [];
  page.on("pageerror", (error) => runtimeErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" && !message.text().includes("favicon")) runtimeErrors.push(message.text());
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}${FIXTURE}`;
  async function reset(width, height) {
    await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 780 });
    await page.goto(baseUrl, { waitUntil: "networkidle0" });
    await page.waitForSelector(".financial-summary-values strong");
    await pause();
  }
  async function click(selector) {
    await page.waitForSelector(selector);
    await page.$eval(selector, (element) => element.click());
    await pause(180);
  }
  async function text(selector = "body") {
    return page.$eval(selector, (element) => element.innerText.replace(/\s+/g, " ").trim());
  }

  const responsive = [];
  for (const [width, height] of MOBILE_VIEWPORTS) {
    await reset(width, height);
    const dashboard = await page.evaluate(() => ({
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      summaryValues: document.querySelectorAll(".financial-summary-values strong").length,
      quickActions: document.querySelectorAll(".financial-quick-actions button").length,
      clippedSummary: [...document.querySelectorAll(".financial-summary-values strong")].some((item) => item.scrollWidth > item.clientWidth + 1),
    }));
    if (dashboard.overflow > 1 || dashboard.summaryValues !== 3 || dashboard.quickActions !== 4 || dashboard.clippedSummary) {
      throw new Error(`Dashboard responsivo inválido em ${width}x${height}: ${JSON.stringify(dashboard)}`);
    }
    await click('[data-financial-view="cards"]');
    const cards = await page.evaluate(() => ({
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      count: document.querySelectorAll(".financial-credit-card").length,
      whiteCards: [...document.querySelectorAll(".financial-credit-card")].every((card) => getComputedStyle(card).backgroundColor === "rgb(255, 255, 255)"),
    }));
    if (cards.overflow > 1 || cards.count !== 2 || !cards.whiteCards) {
      throw new Error(`Cartões responsivos inválidos em ${width}x${height}: ${JSON.stringify(cards)}`);
    }
    responsive.push({ viewport: `${width}x${height}`, dashboard, cards });
  }

  await reset(390, 844);
  await click("[data-financial-open-spaces]");
  const views = await text(".financial-view-sheet");
  for (const expected of ["Todos os espaços", "Pessoal", "Empresas", "Visões financeiras", "Criar visão"]) {
    if (!views.includes(expected)) throw new Error(`Seletor de visões sem ${expected}`);
  }
  await click("[data-financial-create-view]");
  const editor = await page.evaluate(() => ({
    name: Boolean(document.querySelector('[data-financial-view-form] [name="name"]')),
    spaces: document.querySelectorAll('[data-financial-view-form] [name="spaceId"]').length,
    favorite: Boolean(document.querySelector('[data-financial-view-form] [name="favorite"]')),
    defaultView: Boolean(document.querySelector('[data-financial-view-form] [name="default"]')),
  }));
  if (!editor.name || editor.spaces < 4 || !editor.favorite || !editor.defaultView) throw new Error(`Editor de visão incompleto: ${JSON.stringify(editor)}`);

  await reset(390, 844);
  await click('[data-financial-view="cards"]');
  const cardsText = await text(".financial-page");
  for (const expected of ["Meus cartões", "C6 Carbon", "Inter", "Ver fatura", "Ajustar fatura", "Ajustar limite", "Configurar"]) {
    if (!cardsText.includes(expected)) throw new Error(`Tela de cartões sem ${expected}`);
  }
  const cardAmounts = await page.$$eval(".financial-credit-card-total strong", (items) => items.map((item) => item.textContent));
  if (!cardAmounts.some((value) => value.includes("488,00")) || !cardAmounts.some((value) => value.includes("1.420,00"))) {
    throw new Error(`Valores contextuais incorretos: ${JSON.stringify(cardAmounts)}`);
  }
  await click('.financial-credit-card[data-financial-card-id="card-inter"] [data-financial-card-action="adjust"]');
  if (!(await text(".financial-sheet")).includes("R$ 1.420,00")) throw new Error("Ajuste do Inter herdou o valor de outro cartão");

  await reset(390, 844);
  await click('[data-financial-view="cards"]');
  await click('.financial-credit-card[data-financial-card-id="card-c6"] [data-financial-card-action="invoice"]');
  const invoice = await page.evaluate(() => ({
    bodyOverflow: getComputedStyle(document.body).overflow,
    heading: document.querySelector(".financial-invoice-identity")?.innerText || "",
    categories: document.querySelector('[data-invoice-panel="categories"]')?.innerText || "",
    spaces: document.querySelector('[data-invoice-panel="spaces"]')?.innerText || "",
    purchases: document.querySelector('[data-invoice-panel="purchases"]')?.innerText || "",
    hiddenTabs: getComputedStyle(document.querySelector(".financial-invoice-tabs")).display === "none",
    actions: document.querySelector(".financial-invoice-primary-actions")?.innerText || "",
  }));
  if (invoice.bodyOverflow !== "hidden" || !invoice.hiddenTabs) throw new Error(`Modal com rolagem/tabs incorretos: ${JSON.stringify(invoice)}`);
  for (const expected of ["C6 Carbon", "6357"]) if (!invoice.heading.includes(expected)) throw new Error(`Identidade da fatura sem ${expected}`);
  for (const expected of ["Alimentação", "Transporte"]) if (!invoice.categories.includes(expected)) throw new Error(`Categorias sem ${expected}`);
  for (const expected of ["Casa", "Carro"]) if (!invoice.spaces.includes(expected)) throw new Error(`Espaços sem ${expected}`);
  for (const expected of ["Mercado", "Combustível"]) if (!invoice.purchases.includes(expected)) throw new Error(`Compras sem ${expected}`);
  for (const expected of ["Ajustar esta fatura", "Registrar pagamento", "Parcelamentos"]) if (!invoice.actions.includes(expected)) throw new Error(`Ações da fatura sem ${expected}`);

  await click("[data-financial-pay-invoice]");
  const payment = await text("[data-financial-invoice-payment]");
  for (const expected of ["Conta de origem", "Valor", "Data", "Forma", "Confirmar pagamento"]) if (!payment.includes(expected)) throw new Error(`Pagamento sem ${expected}`);

  await reset(1366, 768);
  const desktop = await page.evaluate(() => ({
    overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    selectors: document.querySelectorAll(".financial-context-selectors button").length,
    summaryValues: document.querySelectorAll(".financial-summary-values strong").length,
  }));
  if (desktop.overflow > 1 || desktop.selectors < 2 || desktop.summaryValues !== 3) throw new Error(`Desktop inválido: ${JSON.stringify(desktop)}`);
  if (runtimeErrors.length) throw new Error(`Erros de runtime: ${runtimeErrors.join(" | ")}`);

  await browser.close();
  server.close();
  console.log(JSON.stringify({ ok: true, responsive, savedViews: editor, invoice: { heading: invoice.heading, actions: invoice.actions }, desktop }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exitCode = 1;
});
