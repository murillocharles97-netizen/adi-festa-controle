const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "artifacts", "mobile-structural-qa");
const VIEWPORTS = [[320, 760], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".jpg": "image/jpeg", ".svg": "image/svg+xml" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chromePath = () => [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(fs.existsSync) || (() => { throw Error("Chrome não encontrado."); })();
const staticServer = () => http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const target = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return response.writeHead(404).end("Not found");
  response.setHeader("Content-Type", `${mime[path.extname(target)] || "application/octet-stream"}; charset=utf-8`);
  fs.createReadStream(target).pipe(response);
});

async function waitForFile(file, timeout = 10000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fs.existsSync(file)) return;
    await sleep(50);
  }
  throw Error(`Timeout aguardando ${file}`);
}

class Cdp {
  constructor(url) { this.id = 0; this.pending = new Map(); this.socket = new WebSocket(url); }
  async open() {
    await new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data), pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket.close(); }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Falha na página");
  return result.result.value;
}

async function navigate(cdp, url, ready) {
  await cdp.send("Page.navigate", { url });
  const started = Date.now();
  while (Date.now() - started < 8000) {
    if (await evaluate(cdp, `document.readyState==='complete'&&Boolean(${ready})`)) { await sleep(180); return; }
    await sleep(50);
  }
  throw Error(`Página não carregou: ${url}`);
}

async function screenshot(cdp, filename) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, filename), Buffer.from(data, "base64"));
}

const auditExpression = `(()=>{
  const rails='.crm-opportunity-grid,.crm-mobile-chips,.crm-mobile-filter-entry,.campaign-metrics,.campaign-filter-chips,.campaign-detail-tabs,.campaign-participant-filters,.catalog-admin-tabs,.catalog-category-panel .catalog-editor-list,.online-order-chips,.mobile-chips,.mobile-tabs,.campaign-wizard-steps,.home-secondary-scroller,.home-quick,.mobile-client-kpis,.mobile-filter-scroller,.mobile-sale-filters,.mobile-recent-products>div,.fixture-tabs';
  const visible=element=>{const style=getComputedStyle(element),rect=element.getBoundingClientRect();return style.display!=='none'&&style.visibility!=='hidden'&&Number(style.opacity)!==0&&rect.width>1&&rect.height>1};
  const offenders=[...document.body.querySelectorAll('*')].filter(element=>{if(!visible(element)||element.closest(rails))return false;const rect=element.getBoundingClientRect();return rect.left < -1 || rect.right > innerWidth + 1}).slice(0,20).map(element=>{const rect=element.getBoundingClientRect();return{tag:element.tagName.toLowerCase(),class:String(element.className||'').slice(0,100),left:Math.round(rect.left*10)/10,right:Math.round(rect.right*10)/10,width:Math.round(rect.width*10)/10}});
  const modal=document.querySelector('#modal .modal-box:not([hidden])'),modalRect=modal?.getBoundingClientRect();
  const rawFileInputs=[...document.querySelectorAll('input[type=file]')].filter(visible).length;
  const rawCheckboxes=[...document.querySelectorAll('input[type=checkbox]')].filter(element=>visible(element)&&getComputedStyle(element).appearance!=='none').length;
  return{clientWidth:document.documentElement.clientWidth,scrollWidth:document.documentElement.scrollWidth,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,offenders,modal:modalRect?{left:modalRect.left,right:modalRect.right,top:modalRect.top,bottom:modalRect.bottom,width:modalRect.width,height:modalRect.height}:null,rawFileInputs,rawCheckboxes};
})()`;

function validate(name, viewport, audit) {
  if (audit.overflow || audit.offenders.length) throw Error(`${viewport} ${name}: overflow ${JSON.stringify(audit)}`);
  if (audit.modal && (audit.modal.left < -1 || audit.modal.right > audit.clientWidth + 1 || audit.modal.top < -1 || audit.modal.bottom > Number(viewport.split("x")[1]) + 1)) throw Error(`${viewport} ${name}: modal fora da viewport ${JSON.stringify(audit.modal)}`);
  if (audit.rawFileInputs) throw Error(`${viewport} ${name}: file input nativo visível`);
}

async function collect(cdp, report, viewport, name) {
  const audit = await evaluate(cdp, auditExpression);
  validate(name, viewport, audit);
  report.push({ viewport, state: name, ...audit });
  return audit;
}

async function main() {
  fs.mkdirSync(OUTPUT, { recursive: true });
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "adi-mobile-structural-"));
  const chrome = spawn(chromePath(), ["--headless=new", "--disable-gpu", "--no-first-run", "--disable-background-networking", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let cdp;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    await waitForFile(portFile);
    const [debugPort] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((response) => response.json());
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    const report = [];
    for (const [width, height] of VIEWPORTS) {
      const viewport = `${width}x${height}`;
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height });
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });

      const crmUrl = `http://127.0.0.1:${port}/tests/crm-mobile-carousel.fixture.html`;
      await navigate(cdp, crmUrl, `document.querySelector('.crm-opportunity-grid')`);
      await collect(cdp, report, viewport, "crm-top");
      if (width === 390) await screenshot(cdp, "01-crm-top-390x844.png");
      await evaluate(cdp, `document.querySelector('[data-crm-segment="inactive30"]').click()`); await sleep(250);
      await collect(cdp, report, viewport, "crm-results");
      if (width === 390) await screenshot(cdp, "02-crm-results-390x844.png");
      await navigate(cdp, crmUrl, `document.querySelector('[data-crm-custom-filter]')`);
      await evaluate(cdp, `document.querySelector('[data-crm-custom-filter]').click()`); await sleep(120);
      await collect(cdp, report, viewport, "crm-filter-modal");
      if (width === 390) await screenshot(cdp, "03-crm-filter-390x844.png");

      const campaignUrl = `http://127.0.0.1:${port}/tests/campaign-v2-visual.fixture.html`;
      await navigate(cdp, campaignUrl, `document.querySelector('.campaign-list')`);
      await collect(cdp, report, viewport, "campaign-list");
      if (width === 390) await screenshot(cdp, "04-campaign-list-390x844.png");
      await evaluate(cdp, `document.querySelector('[data-campaign-details]').click()`); await sleep(160);
      await collect(cdp, report, viewport, "campaign-detail");
      if (width === 390) await screenshot(cdp, "05-campaign-detail-390x844.png");
      await navigate(cdp, campaignUrl, `document.querySelector('[data-new-campaign]')`);
      await evaluate(cdp, `document.querySelector('[data-new-campaign]').click()`); await sleep(120);
      for (let step = 1; step <= 5; step++) {
        if (step === 1) await evaluate(cdp, `document.querySelector('[name=name]').value='Campanha QA'`);
        await collect(cdp, report, viewport, `campaign-wizard-step-${step}`);
        if (step < 5) { await evaluate(cdp, `document.querySelector('#campaign-wizard-form').requestSubmit()`); await sleep(120); }
      }

      const operationsUrl = (state) => `http://127.0.0.1:${port}/tests/mobile-catalog-orders.fixture.html?state=${state}`;
      for (const [state, selector] of [["catalog", ".catalog-status-card"], ["catalog-banner", ".catalog-editor-modal"], ["catalog-category", ".catalog-editor-modal"], ["catalog-product", ".catalog-editor-modal"], ["orders", ".online-orders-list"], ["orders-detail", ".online-order-detail"], ["orders-cancel", ".order-cancel-modal"], ["orders-status", ".conversion-actions"]]) {
        await navigate(cdp, operationsUrl(state), `window.__mobileCatalogOrdersReady&&document.querySelector(${JSON.stringify(selector)})`);
        await collect(cdp, report, viewport, state);
        if (width === 390) {
          const filenames = { catalog: "06-catalog-390x844.png", "catalog-category": "07-catalog-category-modal-390x844.png", "catalog-product": "08-catalog-product-modal-390x844.png", orders: "09-orders-390x844.png", "orders-detail": "10-order-detail-390x844.png" };
          if (filenames[state]) await screenshot(cdp, filenames[state]);
        }
      }
      const conflictUrl = `http://127.0.0.1:${port}/tests/payment-conflict.fixture.html`;
      await navigate(cdp, conflictUrl, `window.__paymentConflictFixtureReady&&document.querySelector('.financial-conflict-modal')`);
      await collect(cdp, report, viewport, "financial-payment-conflict");
      if (width === 390) await screenshot(cdp, "11-financial-payment-conflict-390x844.png");
    }

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
    const regressions = [
      ["regression-inicio-390x844.png", `http://127.0.0.1:${port}/tests/mobile-home-clients-polish.fixture.html?view=inicio`, `window.__mobileHomeClientsAudit`],
      ["regression-clientes-390x844.png", `http://127.0.0.1:${port}/tests/mobile-home-clients-polish.fixture.html?view=clientes`, `window.__mobileHomeClientsAudit`],
      ["regression-vender-390x844.png", `http://127.0.0.1:${port}/tests/mobile-selling-renewals.fixture.html`, `document.querySelector('.pos-grid')`],
      ["regression-produtos-390x844.png", `http://127.0.0.1:${port}/tests/mobile-product-form-fixes.fixture.html`, `window.__mobileProductAudit`],
    ];
    for (const [filename, url, ready] of regressions) {
      await navigate(cdp, url, ready);
      await collect(cdp, report, "390x844", filename.replace(/-390x844\.png$/, ""));
      await screenshot(cdp, filename);
    }
    const summary = { ok: true, viewports: VIEWPORTS.map(([width, height]) => `${width}x${height}`), states: [...new Set(report.map((item) => item.state))], checks: report.length, firebaseReadsAdded: 0, report };
    fs.writeFileSync(path.join(OUTPUT, "overflow-report.json"), JSON.stringify(summary, null, 2));
    console.log(JSON.stringify({ ok: true, checks: report.length, viewports: summary.viewports, screenshots: OUTPUT }, null, 2));
  } finally {
    cdp?.close();
    chrome.kill();
    server.close();
    await sleep(180);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
