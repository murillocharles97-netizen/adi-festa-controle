const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd();
const FIXTURE = "/tests/financial-module.fixture.html";
const ARTIFACTS = path.join(ROOT, "artifacts", "global-financial-resources-v134");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const MOBILE_VIEWPORTS = [[320, 720], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
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
  const browser = await puppeteer.launch({ headless: true }), page = await browser.newPage(), runtimeErrors = [];
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
  const openAdd = async () => {
    await click('[data-financial-view="institutions"]');
    await click("[data-financial-add-product]");
  };
  const openKind = async (kind, width = 390, height = 844) => {
    await reset(width, height);
    await openAdd();
    await click(`[data-financial-add-kind="${kind}"]`);
    await page.waitForSelector("[data-financial-account-create]", { visible: true });
    const state = await page.evaluate(() => ({
      spacePicker: Boolean(document.querySelector("[data-creation-space]")),
      accessMode: document.querySelector("[data-account-access].active")?.dataset.accountAccess || "",
      type: document.querySelector('[data-financial-account-create] [name="type"]')?.value || "",
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
    }));
    assert(!state.spacePicker, `${kind} abriu seletor obrigatório de espaço.`);
    assert(state.accessMode === "all_spaces", `${kind} não iniciou em all_spaces: ${JSON.stringify(state)}`);
    assert(state.overflow <= 1, `${kind} tem overflow horizontal: ${state.overflow}px`);
    return state;
  };
  const chooseSpace = async (spaceId) => {
    await click("[data-financial-open-spaces]");
    await click(`[data-financial-select-view="space:${spaceId}"]`);
    await page.waitForSelector('[data-financial-view="accounts"]');
  };

  await reset();
  await openAdd();
  const addMenu = await page.evaluate(() => ({ count: document.querySelectorAll("[data-financial-add-kind]").length, text: document.querySelector(".financial-add-product-list")?.innerText || "" }));
  assert(addMenu.count === 5, `Menu deveria ter cinco opções: ${JSON.stringify(addMenu)}`);
  await shot("01-o-que-deseja-adicionar.png");

  const bank = await openKind("bank_account");
  assert(bank.type === "bank_account", `Tipo de conta incorreto: ${JSON.stringify(bank)}`);
  await shot("02-conta-bancaria-sem-espaco-obrigatorio.png", true);

  const combined = await openKind("account_card");
  assert(combined.type === "bank_account", `Conta + cartão não iniciou pela conta: ${JSON.stringify(combined)}`);
  await shot("03-conta-e-cartao-sem-espaco-obrigatorio.png", true);

  const wallet = await openKind("digital_wallet");
  assert(wallet.type === "digital_wallet", `Carteira não abriu no tipo correto: ${JSON.stringify(wallet)}`);
  await shot("04-carteira-sem-espaco-obrigatorio.png", true);

  const investment = await openKind("investment_account");
  assert(investment.type === "investment_account", `Investimento não abriu no tipo correto: ${JSON.stringify(investment)}`);
  await shot("05-investimento-sem-espaco-obrigatorio.png", true);

  await openKind("bank_account");
  await shot("06-disponibilidade-todos-os-espacos.png", true);
  await click('[data-account-access="selected_spaces"]');
  await click('[data-account-space="personal"]');
  await click('[data-account-space="car"]');
  const selected = await page.evaluate(() => ({ selected: document.querySelectorAll("[data-account-space].active").length, mode: document.querySelector("[data-account-access].active")?.dataset.accountAccess }));
  assert(selected.mode === "selected_spaces" && selected.selected === 2, `Alguns espaços inválido: ${JSON.stringify(selected)}`);
  await shot("07-disponibilidade-alguns-espacos.png", true);

  await reset();
  await chooseSpace("car");
  await click('[data-financial-view="accounts"]');
  const car = await page.evaluate(() => ({ inter: document.querySelectorAll('[data-financial-account-id="account-inter"]').length, text: document.body.innerText }));
  assert(car.inter === 1 && /Inter/.test(car.text), "A conta global Inter não apareceu no Carro.");
  await shot("08-mesma-conta-no-carro.png", true);

  await reset();
  await chooseSpace("iptv");
  await click('[data-financial-view="accounts"]');
  const iptv = await page.evaluate(() => ({ inter: document.querySelectorAll('[data-financial-account-id="account-inter"]').length, text: document.body.innerText }));
  assert(iptv.inter === 1 && /Inter/.test(iptv.text), "A mesma conta global Inter não apareceu no IPTV.");
  await shot("09-mesma-conta-no-iptv.png", true);

  await reset();
  const consolidated = await page.evaluate(() => ({
    interInstitutions: [...document.querySelectorAll(".financial-institution-card")].filter((item) => /Banco Inter/i.test(item.innerText)).length,
    available: document.querySelector(".financial-home-summary strong")?.textContent || "",
  }));
  assert(consolidated.interInstitutions === 1, `Inter foi duplicado no consolidado: ${JSON.stringify(consolidated)}`);
  await shot("10-home-consolidada-sem-duplicacao.png", true);

  const responsive = [];
  for (const [width, height] of MOBILE_VIEWPORTS) responsive.push({ viewport: `${width}x${height}`, ...(await openKind("bank_account", width, height)) });
  await openKind("bank_account", 1366, 900);
  const desktopOverflow = await page.evaluate(() => Math.max(0, document.documentElement.scrollWidth - innerWidth));
  assert(desktopOverflow <= 1, `Desktop tem overflow horizontal: ${desktopOverflow}px`);
  assert(runtimeErrors.length === 0, `Erros de runtime: ${runtimeErrors.join(" | ")}`);

  await browser.close();
  server.close();
  console.log(JSON.stringify({ ok: true, addMenu: addMenu.count, bank, combined, wallet, investment, selected, car: car.inter, iptv: iptv.inter, consolidated, responsive, desktopOverflow, screenshots: 10, artifacts: ARTIFACTS }, null, 2));
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
