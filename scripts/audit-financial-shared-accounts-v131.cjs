const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd();
const FIXTURE = "/tests/financial-module.fixture.html";
const ARTIFACTS = path.join(ROOT, "artifacts", "financial-shared-accounts-v131");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const pause = (milliseconds = 160) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  const page = await browser.newPage(), errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error" && !message.text().includes("favicon")) errors.push(message.text()); });
  const url = `http://127.0.0.1:${server.address().port}${FIXTURE}`;
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const click = async (selector) => { await page.waitForSelector(selector, { visible: true }); await page.$eval(selector, (element) => element.click()); await pause(); };
  const shot = async (name) => page.screenshot({ path: path.join(ARTIFACTS, name), fullPage: true });
  const reset = async () => {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.waitForSelector(".financial-home-summary strong");
    await pause();
  };
  const chooseSpace = async (id) => {
    await click("[data-financial-open-spaces]");
    await click(`[data-financial-select-view="space:${id}"]`);
    await page.waitForSelector("[data-financial-new=income]");
  };
  const openIncomeDestination = async () => {
    await click("[data-financial-new=income]");
    await page.waitForSelector("[data-financial-entry-wizard]");
    await page.$eval('[name="description"]', (input) => { input.value = "Corrida"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await page.$eval('[name="amount"]', (input) => { input.value = "70,00"; input.dispatchEvent(new Event("input", { bubbles: true })); });
    await click("[data-wizard-category]");
    await click("[data-wizard-next]");
    await click("[data-wizard-next]");
    await page.waitForSelector('[name="financialAccountKey"]');
    return page.evaluate(() => ({
      label: document.querySelector('[name="financialAccountKey"]')?.closest("label")?.innerText || "",
      options: [...document.querySelector('[name="financialAccountKey"]')?.options || []].map((option) => option.textContent.trim()),
      value: document.querySelector('[name="financialAccountKey"]')?.value || "",
    }));
  };

  await reset();
  const home = await page.evaluate(() => ({
    interAccounts: [...document.querySelectorAll(".financial-institution-card")].filter((card) => /Banco Inter/i.test(card.innerText)).length,
    available: document.querySelector(".financial-home-summary strong")?.textContent || "",
    overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
  }));
  assert(home.interAccounts === 1, `Banco Inter foi duplicado na Home: ${JSON.stringify(home)}`);
  assert(home.overflow <= 1, `Home tem overflow horizontal: ${home.overflow}px`);
  await shot("05-home-consolidada-sem-duplicacao.png");

  await click('[data-financial-institution="inter"]');
  const detail = await page.evaluate(() => ({
    accounts: document.querySelectorAll(".financial-institution-account").length,
    cards: document.querySelectorAll(".financial-credit-card").length,
    text: document.querySelector(".financial-page")?.innerText || "",
  }));
  assert(detail.accounts === 1 && detail.cards === 1 && /Inter/.test(detail.text) && /0937/.test(detail.text), `Detalhe Banco Inter inválido: ${JSON.stringify(detail)}`);
  await shot("01-banco-inter-detalhe.png");

  await reset();
  await click('[data-financial-view="institutions"]');
  const listing = await page.evaluate(() => [...document.querySelectorAll(".financial-institution-card")].filter((card) => /Banco Inter/i.test(card.innerText)).length);
  assert(listing === 1, `Contas e cartões exibiu ${listing} instituições Banco Inter.`);
  await shot("02-contas-e-carteiras-inter-unica.png");

  await reset();
  await chooseSpace("car");
  const car = await openIncomeDestination();
  assert(/Onde você recebeu/.test(car.label) && car.options.filter((item) => /^Inter\b/.test(item)).length === 1 && /iptv::account-inter/.test(car.value), `Destino Carro inválido: ${JSON.stringify(car)}`);
  await shot("03-carro-nova-entrada-inter.png");

  await reset();
  await chooseSpace("iptv");
  const iptv = await openIncomeDestination();
  assert(/Onde você recebeu/.test(iptv.label) && iptv.options.filter((item) => /^Inter\b/.test(item)).length === 1 && iptv.value === car.value, `Destino IPTV não reutilizou a mesma conta: ${JSON.stringify({ car, iptv })}`);
  await shot("04-iptv-nova-entrada-mesma-inter.png");

  assert(errors.length === 0, `Erros de runtime: ${errors.join(" | ")}`);
  await browser.close();
  server.close();
  console.log(JSON.stringify({ ok: true, home, detail: { accounts: detail.accounts, cards: detail.cards }, car, iptv, screenshots: 5, artifacts: ARTIFACTS }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
