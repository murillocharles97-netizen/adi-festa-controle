const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd();
const FIXTURE = "/tests/financial-module.fixture.html";
const ARTIFACTS = path.join(ROOT, "artifacts", "financial-home-v129");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const MOBILE_VIEWPORTS = [[320, 720], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
const pause = (milliseconds = 120) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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
  const baseUrl = `http://127.0.0.1:${server.address().port}${FIXTURE}`;
  async function reset(width, height) {
    await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 780 });
    await page.goto(baseUrl, { waitUntil: "networkidle0" });
    await page.waitForSelector(".financial-home-summary strong");
    await pause();
  }
  async function screenshotVisibleElement(selector, filename) {
    const clip = await page.$eval(selector, (element) => {
      const box = element.getBoundingClientRect();
      return { x: box.left + scrollX, y: box.top + scrollY, width: box.width, height: box.height };
    });
    await page.screenshot({ path: path.join(ARTIFACTS, filename), clip });
  }
  async function click(selector) {
    await page.waitForSelector(selector);
    await page.$eval(selector, (element) => element.click());
    await pause(180);
  }

  const responsive = [];
  for (const [width, height] of MOBILE_VIEWPORTS) {
    await reset(width, height);
    const result = await page.evaluate(() => {
      const carousel = document.querySelector(".financial-institution-carousel"), first = carousel?.querySelector(".financial-institution-card");
      return {
        overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
        summaryValues: document.querySelectorAll(".financial-home-summary article").length,
        institutions: document.querySelectorAll(".financial-institution-card").length,
        carouselScrollable: Boolean(carousel && carousel.scrollWidth > carousel.clientWidth + 20),
        teaserVisible: Boolean(first && first.getBoundingClientRect().width < innerWidth - 20),
        quickActions: document.querySelectorAll(".financial-quick-actions button").length,
        activeViewId: FinanceiroUI.state().activeViewId,
      };
    });
    if (result.overflow > 1 || result.summaryValues !== 4 || result.institutions < 3 || !result.carouselScrollable || !result.teaserVisible || result.quickActions !== 0 || result.activeViewId !== "all_spaces") throw new Error(`Home responsiva inválida em ${width}x${height}: ${JSON.stringify(result)}`);
    responsive.push({ viewport: `${width}x${height}`, ...result });
    if ([360, 390].includes(width)) await page.screenshot({ path: path.join(ARTIFACTS, `home-${width}.png`) });
  }

  await reset(390, 844);
  await screenshotVisibleElement(".financial-institution-carousel", "carousel-first-390.png");
  await page.$eval(".financial-institution-carousel", (element) => { element.scrollLeft = element.scrollWidth; });
  await pause();
  const carouselPosition = await page.$eval(".financial-institution-carousel", (element) => ({ left: element.scrollLeft, max: element.scrollWidth - element.clientWidth }));
  if (carouselPosition.left < Math.max(1, carouselPosition.max * .75)) throw new Error(`Carrossel não alcançou o segundo estado: ${JSON.stringify(carouselPosition)}`);
  await screenshotVisibleElement(".financial-institution-carousel", "carousel-second-390.png");

  await reset(390, 844);
  await click('[data-financial-view="institutions"]');
  const allInstitutions = await page.evaluate(() => ({ count: document.querySelectorAll(".financial-institution-card.is-full").length, text: document.querySelector(".financial-page").innerText }));
  if (allInstitutions.count < 3 || !allInstitutions.text.includes("Instituições consolidadas")) throw new Error(`Lista completa inválida: ${JSON.stringify(allInstitutions)}`);
  await page.screenshot({ path: path.join(ARTIFACTS, "institutions-all-390.png") });

  await click('[data-financial-institution="inter"]');
  const inter = await page.evaluate(() => ({ accounts: document.querySelectorAll(".financial-institution-account").length, cards: document.querySelectorAll(".financial-credit-card").length, text: document.querySelector(".financial-page").innerText }));
  if (!inter.text.includes("Banco Inter") || inter.accounts !== 1 || inter.cards !== 1) throw new Error(`Detalhe Inter inválido: ${JSON.stringify(inter)}`);
  await page.screenshot({ path: path.join(ARTIFACTS, "institution-inter-390.png") });

  await reset(390, 844);
  await click('[data-financial-institution="c6"]');
  const c6 = await page.evaluate(() => ({ accounts: document.querySelectorAll(".financial-institution-account").length, cards: document.querySelectorAll(".financial-credit-card").length, text: document.querySelector(".financial-page").innerText }));
  if (!c6.text.includes("C6 Bank") || c6.accounts !== 1 || c6.cards !== 1) throw new Error(`Detalhe C6 inválido: ${JSON.stringify(c6)}`);
  await page.screenshot({ path: path.join(ARTIFACTS, "institution-c6-390.png") });
  await click(".financial-institution-account");
  const accountDetail = await page.$eval(".financial-sheet", (element) => element.innerText);
  if (!accountDetail.includes("Ajustar saldo real") || !accountDetail.toLocaleLowerCase("pt-BR").includes("não conectada")) throw new Error("Detalhe da conta não explica conciliação e ausência de open finance");

  await reset(390, 844);
  const obligations = await page.evaluate(() => ({ count: document.querySelectorAll(".financial-home-payables article").length, text: document.querySelector(".financial-home-payables")?.innerText || "", spaces: document.querySelectorAll("[data-financial-space-detail]").length }));
  if (obligations.count < 3 || !obligations.text.includes("Fatura") || obligations.spaces !== 4 || obligations.text.includes("Combustível")) throw new Error(`Obrigações/espaços inválidos: ${JSON.stringify(obligations)}`);
  await (await page.$(".financial-home-payables")).screenshot({ path: path.join(ARTIFACTS, "upcoming-390.png") });
  await (await page.$(".financial-home-spaces")).screenshot({ path: path.join(ARTIFACTS, "spaces-390.png") });

  await reset(1366, 900);
  const desktop = await page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), summaryValues: document.querySelectorAll(".financial-home-summary article").length, institutions: document.querySelectorAll(".financial-institution-card").length }));
  if (desktop.overflow > 1 || desktop.summaryValues !== 4 || desktop.institutions < 3) throw new Error(`Desktop inválido: ${JSON.stringify(desktop)}`);
  await page.screenshot({ path: path.join(ARTIFACTS, "home-desktop-1366.png"), fullPage: true });
  if (runtimeErrors.length) throw new Error(`Erros de runtime: ${runtimeErrors.join(" | ")}`);

  await browser.close();
  server.close();
  console.log(JSON.stringify({ ok: true, responsive, allInstitutions: allInstitutions.count, inter, c6, obligations, desktop, artifacts: ARTIFACTS }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
