const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "docs", "screenshots", "global-spaces-v143");
const MOBILE = [[320, 640], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
const DESKTOP = [[768, 900], [1366, 768]];
const STATES = ["home-all", "home-picker", "home-adi", "home-iptv", "sales-adi", "sales-iptv", "goal-adi", "manager", "availability"];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".woff2": "font/woff2" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(ROOT, `.${pathname === "/" ? "/tests/global-spaces.fixture.html" : pathname}`);
  if (!file.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end("Not found");
  response.writeHead(200, { "Content-Type": MIME[path.extname(file)] || "application/octet-stream", "Cache-Control": "no-store" });
  fs.createReadStream(file).pipe(response);
});

function screenshotName(width, state) {
  const labels = { "home-all": "home-todos", "home-picker": "home-seletor-bottom-sheet", "home-adi": "home-adi-festa", "home-iptv": "home-iptv", "sales-adi": "vender-adi-festa", "sales-iptv": "vender-iptv", "goal-adi": "meta-adi-festa", manager: "gerenciar-espacos", availability: "disponibilidade-produto" };
  return `${width}-${labels[state]}.png`;
}
function shouldScreenshot(width, state) {
  if (width < 768) return ["home-all", "home-picker"].includes(state) || (width === 390 && !["home-all", "home-picker"].includes(state));
  if (width === 768) return ["home-all", "sales-adi", "manager"].includes(state);
  return ["home-all", "home-iptv", "sales-adi", "manager", "availability"].includes(state);
}

async function inspect(page, expectedState, expectedWidth) {
  return page.evaluate(({ state, width }) => {
    const visible = element => Boolean(element && !element.hidden && element.getClientRects().length && getComputedStyle(element).display !== "none" && getComputedStyle(element).visibility !== "hidden");
    const bounds = element => {
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return { left: Math.round(rect.left * 10) / 10, right: Math.round(rect.right * 10) / 10, top: Math.round(rect.top * 10) / 10, bottom: Math.round(rect.bottom * 10) / 10, width: Math.round(rect.width * 10) / 10, height: Math.round(rect.height * 10) / 10 };
    };
    const intersects = (left, right) => {
      if (!left || !right) return false;
      const a = left.getBoundingClientRect(), b = right.getBoundingClientRect();
      return a.left < b.right - 0.5 && a.right > b.left + 0.5 && a.top < b.bottom - 0.5 && a.bottom > b.top + 0.5;
    };
    const pairOverlaps = elements => elements.some((element, index) => elements.slice(index + 1).some(other => intersects(element, other)));
    const pageRoot = document.querySelector("[data-qa-page]"), context = document.querySelector(".space-context-bar"), dialog = document.querySelector("#modal .modal-box"), footerButtons = [...document.querySelectorAll("#modal .modal-foot button")].filter(visible);
    const contextControls = [...document.querySelectorAll(".space-context-bar select,.space-context-bar>button")].filter(visible);
    const modalControls = [...document.querySelectorAll("#modal button,#modal input:not([type=radio]):not([type=checkbox]),#modal select")].filter(visible);
    const touchControls = width < 768 ? [...contextControls, ...modalControls] : [];
    const undersized = touchControls.map(element => ({ label: (element.getAttribute("aria-label") || element.textContent || element.value || element.name || element.tagName).trim().replace(/\s+/g, " ").slice(0, 42), tag: element.tagName.toLowerCase(), height: bounds(element).height, width: bounds(element).width })).filter(item => item.height < 43.5 || (item.tag === "button" && item.width < 43.5));
    const modeLabels = [...document.querySelectorAll("#modal .product-space-availability>label:not(.product-space-single)")].filter(visible).map(bounds);
    const managerRows = [...document.querySelectorAll("#modal .space-manager-list article")].map(bounds);
    const clippedValues = [...document.querySelectorAll(".qa-kpi strong,.qa-product small")].filter(visible).filter(element => element.scrollWidth > element.clientWidth + 1).map(element => element.textContent.trim());
    const select = context?.querySelector("select"), picker = context?.querySelector('[data-space-picker="home"]'), manage = context?.querySelector(":scope>button:last-child"), main = document.querySelector(".qa-main"), mainRect = bounds(main), dialogRect = bounds(dialog);
    const problems = [];
    if (document.documentElement.scrollWidth > innerWidth + 1 || document.body.scrollWidth > innerWidth + 1) problems.push("overflow horizontal");
    if (!pageRoot || !visible(pageRoot)) problems.push("conteúdo principal ausente");
    if (mainRect && (mainRect.left < -1 || mainRect.right > width + 1)) problems.push("conteúdo fora da viewport");
    if (context && select && manage && intersects(select, manage)) problems.push("seletor sobreposto ao gerenciamento");
    if (pairOverlaps(footerButtons)) problems.push("ações do modal sobrepostas");
    if (undersized.length) problems.push("controle touch menor que 44px");
    if (modeLabels.some(rect => rect.height < 43.5 || rect.left < -1 || rect.right > width + 1)) problems.push("opção de disponibilidade sem área touch");
    if (managerRows.some(rect => rect.left < -1 || rect.right > width + 1 || rect.height < 43.5)) problems.push("linha de espaço fora da viewport");
    if (dialog && (dialogRect.left < -1 || dialogRect.right > width + 1 || dialogRect.top < -1 || dialogRect.bottom > innerHeight + 1)) problems.push("modal fora da viewport");
    if (dialog && dialog.scrollWidth > dialog.clientWidth + 1) problems.push("modal com overflow horizontal interno");
    if (clippedValues.length) problems.push("valor essencial truncado");
    const expectedSelection = { "sales-adi": "business_adi-festa", "sales-iptv": "76dea1f8-22de-472f-9b53-0fd608c5cd54" }[state],
      expectedHomeLabel = { "home-all": "Todos os espaços", "home-picker": "Todos os espaços", "home-adi": "Adi Festa", "home-iptv": "IPTV" }[state];
    if (expectedSelection && select?.value !== expectedSelection) problems.push("seleção visual incorreta");
    if (expectedHomeLabel && !picker?.textContent.includes(expectedHomeLabel)) problems.push("seleção Home incorreta");
    if (state !== "availability" && !context) problems.push("barra de espaço ausente");
    if (state.startsWith("sales") && [...(select?.options || [])].some(option => option.value === "all_spaces")) problems.push("Vender oferece Todos os espaços");
    const productCount = document.querySelectorAll(".qa-product").length;
    if (state.startsWith("sales") && productCount !== 2) problems.push("catálogo não filtrado por espaço");
    if (state === "home-all" && (!picker || context.querySelector('select[data-space-select="home"]') || !/3 vendas antigas sem espaço/.test(pageRoot.textContent))) problems.push("seletor customizado ou fallback legado ausente");
    if (state === "home-picker") {
      const options = [...document.querySelectorAll(".space-picker-option")], selectedOptions = options.filter(option => option.getAttribute("aria-checked") === "true");
      if (!dialog?.classList.contains("space-picker-modal") || options.length !== 5 || selectedOptions.length !== 1 || !/Todos os espaços/.test(selectedOptions[0]?.textContent || "") || !dialog.querySelector("[data-space-picker-manage]")) problems.push("bottom sheet de espaços incompleto");
    }
    if (state === "home-adi" && (!/Adi Festa/.test(pageRoot.textContent) || !/R\$\s*445,00/.test(pageRoot.textContent))) problems.push("Home Adi Festa inconsistente");
    if (state === "home-iptv" && (!/IPTV/.test(pageRoot.textContent) || !/R\$\s*120,00/.test(pageRoot.textContent))) problems.push("Home IPTV inconsistente");
    if (state === "goal-adi" && (!/Meta diária · Adi Festa/.test(dialog?.textContent || "") || !/somente para o espaço/i.test(dialog?.textContent || "") || dialog?.querySelector('input[name="goal"]')?.value !== "450")) problems.push("meta específica incorreta");
    if (state === "manager" && (managerRows.length !== 4 || !/Espaço financeiro legado/.test(dialog?.textContent || "") || !/Criar espaço/.test(dialog?.textContent || ""))) problems.push("gerenciamento incompleto");
    const availability = state === "availability" ? { radios: document.querySelectorAll('#modal input[name="spaceAccessMode"]').length, spaces: document.querySelectorAll('#modal input[name="allowedSpaceIds"]').length, checked: document.querySelectorAll('#modal input[name="allowedSpaceIds"]:checked').length, checksVisible: visible(document.querySelector('#modal [data-product-space-checks]')), singleVisible: visible(document.querySelector('#modal [data-product-space-single]')) } : null;
    if (availability && (availability.radios !== 3 || availability.spaces !== 3 || availability.checked !== 2 || !availability.checksVisible || availability.singleVisible)) problems.push("disponibilidade por espaço incorreta");
    const nav = document.querySelector(".qa-bottom-nav"), navHeight = visible(nav) ? bounds(nav).height : 0, mainBottomPadding = parseFloat(getComputedStyle(main).paddingBottom) || 0;
    if (width < 768 && (!visible(nav) || mainBottomPadding + 1 < navHeight)) problems.push("navegação móvel pode cobrir conteúdo");
    return { state, width: innerWidth, viewportHeight: innerHeight, horizontalOverflow: Math.max(document.documentElement.scrollWidth, document.body.scrollWidth) - innerWidth, context: bounds(context), contextValue: select?.value || picker?.textContent.trim().replace(/\s+/g, " ") || null, contextControls: contextControls.map(bounds), main: mainRect, dialog: dialogRect, dialogScroll: dialog ? { clientHeight: dialog.clientHeight, scrollHeight: dialog.scrollHeight, clientWidth: dialog.clientWidth, scrollWidth: dialog.scrollWidth } : null, footerButtons: footerButtons.map(bounds), undersized, clippedValues, modeLabels, managerRows: managerRows.length, productCount, availability, navHeight, mainBottomPadding, problems };
  }, { state: expectedState, width: expectedWidth });
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage(), pageErrors = [], results = [], screenshots = [];
    page.on("pageerror", error => pageErrors.push(error.message));
    await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    for (const [width, height] of [...MOBILE, ...DESKTOP]) {
      await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width < 768, hasTouch: width < 768 });
      for (const state of STATES) {
        await page.goto(`http://127.0.0.1:${server.address().port}/tests/global-spaces.fixture.html?state=${state}`, { waitUntil: "domcontentloaded", timeout: 30000 });
        await page.waitForFunction(expected => document.body.dataset.fixtureReady === "true" && window.__globalSpacesFixture?.state === expected, { timeout: 10000 }, state);
        if (["home-picker", "goal-adi", "manager", "availability"].includes(state)) await new Promise(resolve => setTimeout(resolve, 240));
        const result = await inspect(page, state, width);
        if (result.problems.length) throw Error(`${width}x${height} ${state}: ${JSON.stringify(result)}`);
        results.push(result);
        if (shouldScreenshot(width, state)) {
          const file = screenshotName(width, state);
          await page.screenshot({ path: path.join(OUTPUT, file), fullPage: width >= 768 && !result.dialog });
          screenshots.push(file);
        }
      }
    }
    if (pageErrors.length) throw Error(`Erros de página: ${JSON.stringify(pageErrors)}`);
    const report = { ok: true, release: 143, mobileWidths: MOBILE.map(([width]) => width), desktopWidths: DESKTOP.map(([width]) => width), states: STATES, checks: results.length, screenshots, pageErrors, results };
    fs.writeFileSync(path.join(OUTPUT, "browser-results.json"), `${JSON.stringify(report, null, 2)}\n`);
    console.log(JSON.stringify({ ok: report.ok, release: report.release, checks: report.checks, mobileWidths: report.mobileWidths, desktopWidths: report.desktopWidths, screenshots: report.screenshots.length, pageErrors: report.pageErrors, output: OUTPUT }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}
main().catch(error => { console.error(error.stack || error.message); process.exitCode = 1; });
