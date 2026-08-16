const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const VIEWPORTS = [[320, 760], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chromePath = () => [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(fs.existsSync) || (() => { throw Error("Chrome não encontrado."); })();
const server = () => http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const target = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return response.writeHead(404).end("Not found");
  response.setHeader("Content-Type", `${mime[path.extname(target)] || "application/octet-stream"}; charset=utf-8`);
  fs.createReadStream(target).pipe(response);
});

async function waitForFile(file, timeout = 8000) {
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

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (await evaluate(cdp, "document.readyState==='complete'&&Boolean(document.querySelector('.crm-opportunity-grid'))")) { await sleep(120); return; }
    await sleep(40);
  }
  throw Error(`Página não carregou: ${url}`);
}

async function main() {
  const staticServer = server();
  await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const port = staticServer.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "adi-crm-mobile-"));
  const chrome = spawn(chromePath(), ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
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
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height });
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
      await navigate(cdp, `http://127.0.0.1:${port}/tests/crm-mobile-carousel.fixture.html`);
      const initial = await evaluate(cdp, `(()=>{const grid=document.querySelector('.crm-opportunity-grid'),card=grid.querySelector('button'),entry=document.querySelector('.crm-mobile-entry-card'),filter=document.querySelector('.crm-mobile-filter-button');const style=getComputedStyle(card),rect=card.getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,display:getComputedStyle(grid).display,cardWidth:rect.width,cardHeight:rect.height,visibleCards:grid.clientWidth/(rect.width+10),cardBorder:style.borderTopWidth,entryHeight:entry.getBoundingClientRect().height,filterExists:Boolean(filter),reads:__crmAudit.reads}})()`);
      if (initial.overflow || initial.display !== "flex" || initial.cardWidth < 157 || initial.cardWidth > 175 || initial.cardHeight !== 124 || initial.visibleCards < 1.55 || initial.visibleCards > 2.65 || initial.cardBorder === "0px" || initial.reads !== 0) throw Error(`${width}x${height} layout: ${JSON.stringify(initial)}`);
      const before = await evaluate(cdp, "({scrollY,scrolls:__crmAudit.scrollCalls.length})");
      await evaluate(cdp, `document.querySelector('[data-crm-segment="inactive30"]').click()`);
      await sleep(520);
      const inactive = await evaluate(cdp, `(()=>{const anchor=document.querySelector('#crm-results-anchor'),rect=anchor.getBoundingClientRect();return{segment:crmState.segment,label:anchor.querySelector('h3').textContent,scrollY,headerTop:rect.top,scrolls:__crmAudit.scrollCalls.length,lastScroll:__crmAudit.scrollCalls.at(-1),active:document.querySelector('[data-crm-segment="inactive30"]').classList.contains('active')}})()`);
      if (inactive.segment !== "inactive30" || inactive.label !== "Sumidos há 30 dias" || inactive.scrolls !== before.scrolls + 1 || inactive.lastScroll.id !== "crm-results-anchor" || !inactive.active || inactive.scrollY <= before.scrollY) throw Error(`${width}x${height} inactive: ${JSON.stringify(inactive)}`);
      await evaluate(cdp, `document.querySelector('[data-crm-back-overview]').click()`);
      await sleep(420);
      const backed = await evaluate(cdp, "({segment:crmState.segment,results:crmState.resultsVisible,last:__crmAudit.scrollCalls.at(-1),scrolls:__crmAudit.scrollCalls.length})");
      if (backed.segment || backed.results || backed.last.id !== "crm-segments-anchor") throw Error(`${width}x${height} back: ${JSON.stringify(backed)}`);
      await evaluate(cdp, `document.querySelector('[data-crm-segment="debt"]').click()`);
      await sleep(420);
      const debt = await evaluate(cdp, `({segment:crmState.segment,label:document.querySelector('#crm-results-anchor h3').textContent,count:document.querySelectorAll('.crm-mobile-client').length})`);
      if (debt.segment !== "debt" || debt.label !== "Devendo" || debt.count !== 2) throw Error(`${width}x${height} debt: ${JSON.stringify(debt)}`);
      const scrollCount = await evaluate(cdp, "__crmAudit.scrollCalls.length");
      await evaluate(cdp, `document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('pageshow'));window.dispatchEvent(new Event('focus'))`);
      await sleep(80);
      const resumed = await evaluate(cdp, "({segment:crmState.segment,scrolls:__crmAudit.scrollCalls.length})");
      if (resumed.segment !== "debt" || resumed.scrolls !== scrollCount) throw Error(`${width}x${height} resume: ${JSON.stringify(resumed)}`);
      report.push({ viewport: `${width}x${height}`, initial, inactive, debt, resumed });
    }

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
    await navigate(cdp, `http://127.0.0.1:${port}/tests/crm-mobile-carousel.fixture.html`);
    await evaluate(cdp, `document.querySelector('[data-crm-saved]').click();document.querySelector('[data-apply-saved]').click()`);
    await sleep(420);
    const saved = await evaluate(cdp, `({label:document.querySelector('#crm-results-anchor h3').textContent,count:document.querySelectorAll('.crm-mobile-client').length,last:__crmAudit.scrollCalls.at(-1)})`);
    if (saved.label !== "Clientes com saldo" || saved.count !== 2 || saved.last.id !== "crm-results-anchor") throw Error(`segmento salvo: ${JSON.stringify(saved)}`);

    await navigate(cdp, `http://127.0.0.1:${port}/tests/crm-mobile-carousel.fixture.html`);
    await evaluate(cdp, `document.querySelector('[data-crm-custom-filter]').click();(()=>{const field=document.querySelector('[data-condition-field]');field.value='balance';field.dispatchEvent(new Event('change'))})();(()=>{const operator=document.querySelector('[data-condition-operator]'),value=document.querySelector('[data-condition-value]');operator.value='gt';operator.dispatchEvent(new Event('change'));value.value='0';document.querySelector('[data-crm-apply-custom]').click()})()`);
    await sleep(420);
    const custom = await evaluate(cdp, `({label:document.querySelector('#crm-results-anchor h3').textContent,count:document.querySelectorAll('.crm-mobile-client').length,last:__crmAudit.scrollCalls.at(-1)})`);
    if (custom.label !== "Filtro personalizado" || custom.count !== 2 || custom.last.id !== "crm-results-anchor") throw Error(`filtro personalizado: ${JSON.stringify(custom)}`);

    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await navigate(cdp, `http://127.0.0.1:${port}/tests/crm-mobile-carousel.fixture.html`);
    await evaluate(cdp, `document.querySelector('[data-crm-segment="inactive30"]').click()`);
    await sleep(120);
    const reduced = await evaluate(cdp, "__crmAudit.scrollCalls.at(-1)");
    if (reduced.behavior !== "auto") throw Error(`reduced motion: ${JSON.stringify(reduced)}`);
    console.log(JSON.stringify({ ok: true, viewports: report.length, saved, custom, reduced, report }, null, 2));
  } finally {
    cdp?.close();
    chrome.kill();
    staticServer.close();
    await sleep(150);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
