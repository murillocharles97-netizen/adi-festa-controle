const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd();
const ARTIFACTS = path.join(ROOT, "artifacts", "veconi-pwa-branding-v133");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml; charset=utf-8",
  ".png": "image/png",
  ".ico": "image/x-icon",
};

function staticServer() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const file = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return response.writeHead(404).end("Not found");
    response.setHeader("Content-Type", MIME[path.extname(file)] || "application/octet-stream");
    response.setHeader("Cache-Control", "no-store");
    fs.createReadStream(file).pipe(response);
  });
}

async function main() {
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const localBase = `http://127.0.0.1:${server.address().port}`;
  const base = String(process.env.PWA_AUDIT_URL || localBase).replace(/\/$/, "");
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
  const failedRequests = [];
  page.on("requestfailed", (request) => failedRequests.push(`${request.url()} :: ${request.failure()?.errorText || "falhou"}`));

  try {
    const response = await page.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!response?.ok()) throw new Error(`App retornou HTTP ${response?.status()}`);
    if (base === localBase) {
      await page.evaluate(async () => {
        const registration = await navigator.serviceWorker.register("./service-worker.js");
        await navigator.serviceWorker.ready;
        await registration.update();
      });
    }
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForFunction(() => document.title === "VECONI" && document.querySelector('[data-veconi-logo="horizontal"] img'), { timeout: 30000 });
    await new Promise((resolve) => setTimeout(resolve, 1200));
    await page.screenshot({ path: path.join(ARTIFACTS, "06-app-aberto-veconi.png"), fullPage: false });

    let offlineReloadPassed = false;
    await page.setOfflineMode(true);
    try {
      await page.reload({ waitUntil: "domcontentloaded", timeout: 30000 });
      await page.waitForFunction(() => document.title === "VECONI" && document.querySelector('[data-veconi-logo="horizontal"] img'), { timeout: 30000 });
      offlineReloadPassed = true;
    } finally {
      await page.setOfflineMode(false);
    }

    const client = await page.target().createCDPSession();
    const manifest = await client.send("Page.getAppManifest");
    if (!manifest?.data) throw new Error("Chrome não reconheceu o manifest do app.");
    const parsedManifest = JSON.parse(manifest.data);
    if (parsedManifest.name !== "VECONI" || parsedManifest.short_name !== "VECONI") throw new Error("Nome instalável divergente de VECONI.");

    let installabilityErrors = [];
    try {
      ({ installabilityErrors = [] } = await client.send("Page.getInstallabilityErrors"));
    } catch (error) {
      installabilityErrors = [{ errorId: "cdp-method-unavailable", errorArguments: [{ name: "message", value: error.message }] }];
    }

    const iconUrls = [
      ...parsedManifest.icons.map((icon) => new URL(icon.src, `${base}/`).href),
      new URL("assets/veconi-apple-touch-icon-180-v133.png", `${base}/`).href,
      new URL("assets/veconi-favicon-v133.ico", `${base}/`).href,
    ];
    const checks = [];
    for (const url of iconUrls) {
      const result = await fetch(url, { cache: "no-store" });
      checks.push({ url, status: result.status, contentType: result.headers.get("content-type"), bytes: (await result.arrayBuffer()).byteLength });
    }
    if (checks.some((item) => item.status !== 200 || item.bytes < 500)) throw new Error(`Asset inválido: ${JSON.stringify(checks)}`);

    fs.copyFileSync(path.join(ROOT, "assets", "veconi-icon-192-v133.png"), path.join(ARTIFACTS, "02-icone-192.png"));
    fs.copyFileSync(path.join(ROOT, "assets", "veconi-icon-512-v133.png"), path.join(ARTIFACTS, "03-icone-512.png"));
    fs.copyFileSync(path.join(ROOT, "assets", "veconi-favicon-48-v133.png"), path.join(ARTIFACTS, "05-favicon-48.png"));

    const evidence = await browser.newPage();
    await evidence.setViewport({ width: 1040, height: 760, deviceScaleFactor: 1 });
    await evidence.setContent(`<!doctype html><meta charset="utf-8"><style>*{box-sizing:border-box}body{margin:0;padding:34px;background:#eef4f6;color:#102037;font:16px Inter,system-ui}.card{padding:28px;border:1px solid #d9e4e8;border-radius:24px;background:#fff;box-shadow:0 18px 60px #0b23301c}h1{margin:0 0 8px}p{color:#5d6b7c}.grid{display:grid;grid-template-columns:repeat(3,1fr);gap:24px;margin-top:24px}.sample{padding:20px;border:1px solid #dfe7ea;border-radius:20px;text-align:center}.sample img{width:210px;height:210px}.circle img{border-radius:50%}.squircle img{border-radius:27%}pre{overflow:auto;padding:20px;border-radius:16px;background:#07141b;color:#d8fffa;white-space:pre-wrap}</style><section class="card"><h1>VECONI · PWA V133</h1><p>Prévia de recorte maskable e manifesto final.</p><div class="grid"><div class="sample"><img src="${base}/assets/veconi-maskable-512-v133.png"><b>Original</b></div><div class="sample circle"><img src="${base}/assets/veconi-maskable-512-v133.png"><b>Recorte circular</b></div><div class="sample squircle"><img src="${base}/assets/veconi-maskable-512-v133.png"><b>Recorte Samsung</b></div></div></section>`, { waitUntil: "networkidle0" });
    await evidence.screenshot({ path: path.join(ARTIFACTS, "04-maskable-safe-zone.png"), fullPage: true });
    await evidence.setContent(`<!doctype html><meta charset="utf-8"><style>body{margin:0;padding:34px;background:#eef4f6;color:#102037;font:16px ui-monospace,monospace}section{padding:28px;border-radius:24px;background:#fff;box-shadow:0 18px 60px #0b23301c}h1{font-family:Inter,system-ui}pre{padding:24px;border-radius:16px;background:#07141b;color:#d8fffa;white-space:pre-wrap}</style><section><h1>Manifest final · VECONI</h1><pre>${JSON.stringify(parsedManifest, null, 2).replaceAll("&", "&amp;").replaceAll("<", "&lt;")}</pre></section>`);
    await evidence.screenshot({ path: path.join(ARTIFACTS, "01-manifest-final.png"), fullPage: true });
    await evidence.close();

    const audit = {
      auditedAt: new Date().toISOString(),
      base,
      manifest: parsedManifest,
      assets: checks,
      serviceWorkerControlled: await page.evaluate(() => Boolean(navigator.serviceWorker?.controller)),
      offlineReloadPassed,
      installabilityErrors,
      failedRequests: failedRequests.filter((item) => item.startsWith(base)),
    };
    fs.writeFileSync(path.join(ARTIFACTS, "audit.json"), `${JSON.stringify(audit, null, 2)}\n`);
    if (audit.failedRequests.length) throw new Error(`Falhas de rede locais: ${audit.failedRequests.join(" | ")}`);
    process.stdout.write(`PWA V133 auditado em ${base}: ${checks.length} assets HTTP 200; manifest VECONI; SW control=${audit.serviceWorkerControlled}.\n`);
  } finally {
    await browser.close();
    await new Promise((resolve) => server.close(resolve));
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
