const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const puppeteer = require("puppeteer");

const ROOT = path.resolve(process.env.APP_ROOT || process.cwd());
const BASELINE = process.env.BASELINE === "1";
const INITIAL_ONLY = process.env.INITIAL_ONLY === "1";
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".png": "image/png", ".ico": "image/x-icon" };
const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
const fileSize = (pathname) => fs.statSync(path.join(ROOT, pathname)).size;
const declaredPaths = [...html.matchAll(/<script\b[^>]*\bsrc="([^"]+)"/g), ...html.matchAll(/<link\b[^>]*\bhref="([^"]+\.css(?:\?[^"]*)?)"/g)]
  .map((match) => match[1].split("?")[0].replace(/^\.\//, ""))
  .filter((item) => fs.existsSync(path.join(ROOT, item)));
const declared = {
  files: declaredPaths.length,
  jsFiles: declaredPaths.filter((item) => item.endsWith(".js")).length,
  cssFiles: declaredPaths.filter((item) => item.endsWith(".css")).length,
  jsBytes: declaredPaths.filter((item) => item.endsWith(".js")).reduce((sum, item) => sum + fileSize(item), 0),
  cssBytes: declaredPaths.filter((item) => item.endsWith(".css")).reduce((sum, item) => sum + fileSize(item), 0),
};
declared.totalBytes = declared.jsBytes + declared.cssBytes;
const tracked = execFileSync("git", ["-C", ROOT, "ls-files", "-z"], { encoding: "utf8" }).split("\0").filter(Boolean);
const appAssets = tracked.filter((item) => /^(?:js|css|assets)\//.test(item) && /\.(?:js|css|png|svg|ico)$/.test(item) || /^(?:index|catalogo|404)\.html$|^(?:service-worker\.js|manifest\.json)$/.test(item));
const totalAssets = { files: appAssets.length, bytes: appAssets.reduce((sum, item) => sum + fileSize(item), 0) };
const precachePaths = [...new Set([...fs.readFileSync(path.join(ROOT, "service-worker.js"), "utf8").matchAll(/['"]\.\/([^'"]+)['"]/g)].map((match) => match[1]))]
  .filter((item) => fs.existsSync(path.join(ROOT, item)));
const precache = { files: precachePaths.length, bytes: precachePaths.reduce((sum, item) => sum + fileSize(item), 0) };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!file.startsWith(`${ROOT}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end("Not found");
  response.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
  response.setHeader("Cache-Control", "no-store");
  fs.createReadStream(file).pipe(response);
});

async function main() {
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await puppeteer.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setBypassServiceWorker(true);
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(`http://127.0.0.1:${server.address().port}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForSelector(".auth-entry-card", { timeout: 30000 });
    const initial = await page.evaluate(() => {
      const entries = performance.getEntriesByType("resource").filter((item) => item.name.startsWith(location.origin));
      const files = entries.map((item) => new URL(item.name).pathname);
      return {
        domContentLoadedMs: Math.round(performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd),
        loginReadyMs: Math.round(performance.now()),
        files: files.length,
        financialScripts: files.filter((item) => /financial-(engine|ui|space-service)\.js/.test(item)),
        activeListeners: window.FirebaseUsageMonitor?.snapshot?.().activeListeners ?? null,
      };
    });
    const initialPaths = await page.evaluate(() => performance.getEntriesByType("resource").filter((item) => item.name.startsWith(location.origin)).map((item) => new URL(item.name).pathname));
    const initialFiles = [...new Set(initialPaths)].map((pathname) => path.resolve(ROOT, `.${pathname}`)).filter((file) => file.startsWith(`${ROOT}${path.sep}`) && fs.existsSync(file));
    initial.localBytes = initialFiles.reduce((sum, file) => sum + fs.statSync(file).size, 0);
    initial.jsBytes = initialFiles.filter((file) => file.endsWith(".js")).reduce((sum, file) => sum + fs.statSync(file).size, 0);
    initial.cssBytes = initialFiles.filter((file) => file.endsWith(".css")).reduce((sum, file) => sum + fs.statSync(file).size, 0);
    if (BASELINE) { console.log(JSON.stringify({ declared, totalAssets, precache, initial, errors }, null, 2)); return; }
    if (initial.financialScripts.length) throw Error(`Financeiro carregou antes de abrir a rota: ${initial.financialScripts}`);
    if (INITIAL_ONLY) { console.log(JSON.stringify({ declared, totalAssets, precache, initial, errors }, null, 2)); return; }
    await page.evaluate(() => {
      window.FirebaseSession = { user: { uid: "audit" }, profile: { uid: "audit", businessId: "audit" }, businessId: "audit" };
      window.PlansUI.guardRoute = () => true;
      dispatchEvent(new CustomEvent("firebase-auth-ready"));
      window.Router.ir("financeiro");
    });
    await page.waitForFunction(() => Boolean(window.FinanceiroUI && window.FinancialSpaceService), { timeout: 30000 });
    const finance = await page.evaluate(() => ({
      route: window.Router.atual(),
      moduleReady: Boolean(window.FinanceiroUI && window.FinancialSpaceService),
      scripts: performance.getEntriesByType("resource").filter((item) => /financial-(engine|ui|space-service)\.js/.test(item.name)).map((item) => new URL(item.name).pathname),
    }));
    if (finance.route !== "financeiro" || finance.scripts.length !== 3) throw Error(`Lazy load incompleto: ${JSON.stringify(finance)}`);
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/universal-catalog.fixture.html`, { waitUntil: "load" });
    const qrInitiallyLoaded = await page.evaluate(() => Boolean(window.qrcode));
    if (qrInitiallyLoaded) throw Error("Gerador de QR carregou antes de abrir o QR Code.");
    await page.waitForSelector("[data-catalog-qr]", { timeout: 10000 }).catch(async (error) => {
      throw Error(`${error.message}; page errors: ${errors.join(" | ")}`);
    });
    await page.click("[data-catalog-qr]");
    await page.waitForSelector("#catalog-qr img", { timeout: 10000 });
    const qr = await page.evaluate(() => ({ generated: Boolean(document.querySelector("#catalog-qr img")), scripts: performance.getEntriesByType("resource").filter((item) => item.name.includes("qrcode.min.js")).length }));
    if (!qr.generated || qr.scripts !== 1) throw Error(`QR Code não carregou sob demanda: ${JSON.stringify(qr)}`);
    console.log(JSON.stringify({ declared, totalAssets, precache, initial, finance, qr, syntheticAuthErrors: errors }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
