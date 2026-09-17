const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "docs", "screenshots", "global-spaces-v143", "390-financeiro-nome-canonico.png");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };

function server() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const target = path.resolve(ROOT, `.${pathname}`);
    if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      response.writeHead(404).end("Not found");
      return;
    }
    response.setHeader("Content-Type", `${mime[path.extname(target)] || "application/octet-stream"}; charset=utf-8`);
    response.setHeader("Cache-Control", "no-store");
    fs.createReadStream(target).pipe(response);
  });
}

async function main() {
  const staticServer = server();
  await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${staticServer.address().port}`;
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });

  try {
    await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true });
    await page.goto(`${base}/tests/financial-module.fixture.html`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => window.__financialReady === true);
    const click = async (selector) => {
      await page.waitForSelector(selector);
      await page.$eval(selector, (element) => element.click());
      await new Promise((resolve) => setTimeout(resolve, 120));
    };

    await click("[data-financial-open-spaces]");
    await click('[data-financial-select-view="space:car"]');
    await click('[data-financial-view="cards"]');
    await click('[data-financial-card-action="invoice"][data-invoice-id="card-c6_2026-09"]');
    await click('[data-invoice-tab="purchases"]');

    const result = await page.evaluate(() => ({
      title: document.querySelector(".financial-compact-context [data-financial-open-spaces] span, .financial-context-button b")?.textContent || "",
      purchases: document.querySelector('[data-invoice-panel="purchases"]')?.innerText || "",
    }));
    if (result.title !== "Táxi" || !result.purchases.includes("Táxi") || result.purchases.includes("Carro")) {
      throw new Error(`Nome canônico não propagado: ${JSON.stringify(result)}`);
    }
    if (errors.length) throw new Error(`Erros no browser: ${errors.join(" | ")}`);

    fs.mkdirSync(path.dirname(OUTPUT), { recursive: true });
    await page.screenshot({ path: OUTPUT, fullPage: false });
    console.log(JSON.stringify({ ok: true, canonicalName: result.title, staleSnapshotHidden: true, screenshot: path.relative(ROOT, OUTPUT) }, null, 2));
  } finally {
    await browser.close();
    await new Promise((resolve) => staticServer.close(resolve));
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
