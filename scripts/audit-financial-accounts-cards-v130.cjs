const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd();
const FIXTURE = "/tests/financial-module.fixture.html";
const ARTIFACTS = path.join(ROOT, "artifacts", "financial-accounts-cards-v130");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const MOBILE_VIEWPORTS = [[320, 720], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
const pause = (milliseconds = 140) => new Promise((resolve) => setTimeout(resolve, milliseconds));

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

  async function reset(width = 390, height = 844) {
    await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 780 });
    await page.goto(baseUrl, { waitUntil: "networkidle0" });
    await page.waitForSelector(".financial-home-summary strong");
    await pause();
  }
  async function click(selector) {
    await page.waitForSelector(selector, { visible: true });
    await page.$eval(selector, (element) => element.click());
    await pause(180);
  }
  async function shot(filename, fullPage = false) {
    await page.screenshot({ path: path.join(ARTIFACTS, filename), fullPage });
  }
  async function overflowState() {
    return page.evaluate(() => ({
      document: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      body: Math.max(0, document.body.scrollWidth - innerWidth),
    }));
  }
  function assert(condition, message) {
    if (!condition) throw new Error(message);
  }

  const responsive = [];
  for (const [width, height] of MOBILE_VIEWPORTS) {
    await reset(width, height);
    const home = await page.evaluate(() => ({
      summary: document.querySelectorAll(".financial-home-summary article").length,
      context: document.querySelectorAll(".financial-home-intro .financial-compact-context > button").length,
      institutions: document.querySelectorAll(".financial-institution-card").length,
      topbarHeight: Math.round(document.querySelector(".topbar").getBoundingClientRect().height),
    }));
    const homeOverflow = await overflowState();
    assert(home.summary === 4 && home.context === 2 && home.institutions === 3, `Home inválida em ${width}: ${JSON.stringify(home)}`);
    assert(home.topbarHeight <= 66, `Header mobile não ficou compacto em ${width}: ${home.topbarHeight}px`);
    assert(homeOverflow.document <= 1 && homeOverflow.body <= 1, `Overflow da Home em ${width}: ${JSON.stringify(homeOverflow)}`);
    await click('[data-financial-view="institutions"]');
    const institutions = await page.evaluate(() => ({
      context: document.querySelectorAll(".financial-accounts-cards-page > .financial-compact-context > button").length,
      summary: document.querySelectorAll(".financial-institution-summary article").length,
      cards: document.querySelectorAll(".financial-institution-card.is-full").length,
      add: Boolean(document.querySelector("[data-financial-add-product]")),
    }));
    const listOverflow = await overflowState();
    assert(institutions.context === 2 && institutions.summary === 2 && institutions.cards === 3 && institutions.add, `Contas e cartões inválida em ${width}: ${JSON.stringify(institutions)}`);
    assert(listOverflow.document <= 1 && listOverflow.body <= 1, `Overflow de Contas e cartões em ${width}: ${JSON.stringify(listOverflow)}`);
    responsive.push({ viewport: `${width}x${height}`, home, homeOverflow, institutions, listOverflow });
  }

  await reset(360, 800);
  await shot("01-home-360.png");
  await reset(390, 844);
  await shot("02-home-390.png");

  await click('[data-financial-view="institutions"]');
  await shot("03-contas-cartoes-390.png");
  await click("[data-financial-add-product]");
  const addMenu = await page.evaluate(() => ({
    count: document.querySelectorAll("[data-financial-add-kind]").length,
    text: document.querySelector(".financial-add-product-list")?.innerText || "",
  }));
  assert(addMenu.count === 5 && addMenu.text.includes("Conta + cartão") && addMenu.text.includes("Investimento"), `Menu Adicionar inválido: ${JSON.stringify(addMenu)}`);
  await shot("04-menu-adicionar-390.png");

  await click('[data-financial-add-kind="bank_account"]');
  await click('[data-creation-space="business"]');
  assert(await page.$("[data-financial-account-create]"), "Formulário de conta não abriu");
  await shot("05-nova-conta-390.png");

  await reset(390, 844);
  await click('[data-financial-view="institutions"]');
  await click("[data-financial-add-product]");
  await click('[data-financial-add-kind="credit_card"]');
  assert(await page.$("[data-credit-card-wizard]"), "Wizard de cartão não abriu");
  await shot("06-novo-cartao-390.png");

  await reset(390, 844);
  await click('[data-financial-view="institutions"]');
  await click('[data-financial-institution-actions="inter"]');
  const actions = await page.evaluate(() => ({
    count: document.querySelectorAll("[data-institution-action]").length,
    text: document.querySelector(".financial-institution-action-list")?.innerText || "",
  }));
  for (const label of ["Atualizar saldo", "Adicionar cartão", "Ajustar fatura", "Ajustar limite", "Pagar fatura", "Remover instituição"]) assert(actions.text.includes(label), `Ação ausente: ${label}`);
  await shot("07-acoes-banco-inter-390.png");
  await click('[data-institution-action="balance"]');
  assert(await page.$("[data-financial-account-adjust]"), "Conciliação de saldo não abriu");
  await shot("08-atualizar-saldo-390.png");

  await reset(390, 844);
  await click('[data-financial-view="institutions"]');
  await click('[data-financial-institution="inter"]');
  const detail = await page.evaluate(() => ({ accounts: document.querySelectorAll(".financial-institution-account").length, cards: document.querySelectorAll(".financial-credit-card").length, manage: Boolean(document.querySelector(".financial-institution-manage-cta")) }));
  assert(detail.accounts === 1 && detail.cards === 1 && detail.manage, `Detalhe da instituição inválido: ${JSON.stringify(detail)}`);
  await shot("09-instituicao-banco-inter-390.png");

  await reset(390, 844);
  await click('[data-financial-view="institutions"]');
  await click('[data-financial-institution-actions="inter"]');
  await click('[data-institution-action="invoice-adjust"]');
  assert(await page.$("[data-financial-invoice-adjustment]"), "Ajuste da fatura individual não abriu");
  await shot("10-ajustar-fatura-390.png");

  await reset(390, 844);
  await click('[data-financial-view="institutions"]');
  await click('[data-financial-institution-actions="inter"]');
  await click('[data-institution-action="limit"]');
  assert(await page.$("[data-financial-card-limit]"), "Ajuste de limite individual não abriu");
  await shot("11-ajustar-limite-390.png");

  await reset(1366, 900);
  const desktopHome = await overflowState();
  assert(desktopHome.document <= 1 && desktopHome.body <= 1, `Overflow desktop: ${JSON.stringify(desktopHome)}`);
  await shot("12-home-desktop-1366.png", true);
  await click('[data-financial-view="institutions"]');
  await shot("13-contas-cartoes-desktop-1366.png", true);

  assert(runtimeErrors.length === 0, `Erros de runtime: ${runtimeErrors.join(" | ")}`);
  await browser.close();
  server.close();
  console.log(JSON.stringify({ ok: true, responsive, addMenu, actions: actions.count, detail, screenshots: 13, artifacts: ARTIFACTS }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exit(1); });
