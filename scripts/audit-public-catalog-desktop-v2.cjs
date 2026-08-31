const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "artifacts", "public-catalog-desktop-v2");
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
  ".json": "application/json",
};
const desktopViewports = [
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
];
const mobileViewports = [
  [320, 720],
  [360, 800],
  [375, 812],
  [390, 844],
  [412, 915],
  [430, 932],
];
const screenshotMobileWidths = new Set([360, 390, 430]);

function server() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const target = path.resolve(ROOT, `.${pathname === "/" ? "/catalogo.html" : pathname}`);
    if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory())
      return response.writeHead(404).end("Not found");
    response.setHeader("Content-Type", `${mime[path.extname(target)] || "application/octet-stream"}; charset=utf-8`);
    response.setHeader("Cache-Control", "no-store");
    fs.createReadStream(target).pipe(response);
  });
}

async function openDemo(browser, base, width, height, query = "") {
  const page = await browser.newPage();
  const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.setViewport({ width, height, deviceScaleFactor: 1 });
  await page.goto(`${base}/catalogo.html?demo=1${query}`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
  await page.waitForSelector(".product-card", { timeout: 15000 });
  if (pageErrors.length) throw Error(`${width}x${height}: ${pageErrors.join(" | ")}`);
  return page;
}

async function audit(page, width, mode) {
  const report = await page.evaluate(() => {
    const visible = (node) => {
      if (!node) return false;
      const style = getComputedStyle(node), rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0" && rect.width > 0 && rect.height > 0;
    };
    const grid = document.querySelector(".product-grid"), sidebar = document.querySelector(".catalog-desktop-sidebar"), bottom = document.querySelector(".catalog-bottom"), main = document.querySelector(".catalog-main"), order = document.querySelector(".desktop-order-card"), firstCard = document.querySelector(".product-card"), center = document.elementFromPoint(innerWidth / 2, Math.min(innerHeight - 10, 400));
    return {
      overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      sidebarVisible: visible(sidebar),
      bottomVisible: visible(bottom),
      mainVisible: visible(main),
      orderVisible: visible(order),
      cardCount: document.querySelectorAll(".product-card").length,
      columns: grid ? getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length : 0,
      cardWidth: firstCard?.getBoundingClientRect().width || 0,
      bodyPointerEvents: getComputedStyle(document.body).pointerEvents,
      centerElement: center?.className || center?.tagName || "",
      title: document.title,
      quickFilters: document.querySelectorAll("[data-quick-filter]").length,
      modes: document.querySelectorAll("[data-service-mode]").length,
    };
  });
  if (report.overflow > 1) throw Error(`${width}px: overflow horizontal ${report.overflow}px`);
  if (!report.mainVisible || report.cardCount < 8 || report.bodyPointerEvents === "none") throw Error(`${width}px: conteúdo principal inválido ${JSON.stringify(report)}`);
  if (!/Adi Festa — Catálogo online/.test(report.title)) throw Error(`${width}px: title não foi atualizado`);
  if (mode === "desktop" && (!report.sidebarVisible || !report.orderVisible || report.bottomVisible || report.columns < 2 || report.quickFilters < 3 || report.modes < 2)) throw Error(`${width}px: desktop incompleto ${JSON.stringify(report)}`);
  if (mode === "mobile" && (report.sidebarVisible || !report.bottomVisible || report.columns > 2)) throw Error(`${width}px: regressão mobile ${JSON.stringify(report)}`);
  return report;
}

async function screenshot(page, name) {
  fs.mkdirSync(OUTPUT, { recursive: true });
  await new Promise((resolve) => setTimeout(resolve, 380));
  await page.screenshot({ path: path.join(OUTPUT, name), fullPage: false });
}

async function main() {
  const staticServer = server();
  await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${staticServer.address().port}`;
  const browser = await puppeteer.launch({
    headless: true,
    executablePath: fs.existsSync("C:/Program Files/Google/Chrome/Application/chrome.exe") ? "C:/Program Files/Google/Chrome/Application/chrome.exe" : undefined,
    args: ["--no-first-run", "--disable-gpu"],
  });
  const reports = {};
  try {
    for (const [width, height] of desktopViewports) {
      const page = await openDemo(browser, base, width, height);
      reports[`${width}x${height}`] = await audit(page, width, "desktop");
      await screenshot(page, `catalog-empty-${width}x${height}.png`);
      if (width === 1366) {
        await page.click('.product-card[data-catalog-item-id="demo-0"] .add-product');
        await page.click('.product-card[data-catalog-item-id="demo-3"] .add-product');
        await screenshot(page, "catalog-cart-1366x768.png");
        await page.click('[data-service-mode="delivery"]');
        await screenshot(page, "catalog-delivery-1366x768.png");
        await page.click('.product-card[data-catalog-item-id="demo-2"] .add-product');
        await page.waitForSelector(".catalog-variant-sheet");
        await screenshot(page, "catalog-variant-1366x768.png");
        await page.evaluate(() => document.querySelector("[data-close-variants]")?.click());
        await new Promise((resolve) => setTimeout(resolve, 250));
        await page.evaluate(() => document.querySelector('.product-card[data-catalog-item-id="demo-8"]')?.click());
        await page.waitForSelector(".product-details-dialog");
        await screenshot(page, "catalog-product-modal-1366x768.png");
        await page.click("[data-close-product-details]");
        await page.click('[data-category="Bebidas"]');
        await screenshot(page, "catalog-category-1366x768.png");
        await page.click('[data-category="Todos"]');
        await page.click('[data-quick-filter="soldout"]');
        await screenshot(page, "catalog-soldout-1366x768.png");
        await page.click('[data-quick-filter="all"]');
        await page.click("[data-desktop-checkout]");
        await page.waitForSelector("#order-form");
        await screenshot(page, "catalog-checkout-1366x768.png");
      }
      await page.close();
    }
    const identified = await openDemo(browser, base, 1366, 768, "&identified=1");
    await screenshot(identified, "catalog-identified-1366x768.png");
    await identified.close();
    for (const [width, height] of mobileViewports) {
      const page = await openDemo(browser, base, width, height);
      await page.evaluate(() => localStorage.clear());
      await page.reload({ waitUntil: "networkidle2", timeout: 30000 });
      await page.waitForSelector(".product-card", { timeout: 15000 });
      reports[`${width}x${height}`] = await audit(page, width, "mobile");
      if (screenshotMobileWidths.has(width))
        await screenshot(page, `catalog-mobile-${width}x${height}.png`);
      await page.close();
    }
    fs.writeFileSync(path.join(OUTPUT, "report.json"), JSON.stringify(reports, null, 2));
    console.log(JSON.stringify({ ok: true, output: OUTPUT, reports }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => staticServer.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
