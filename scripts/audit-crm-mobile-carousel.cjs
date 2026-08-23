const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const FIXTURE = "/tests/crm-mobile-carousel.fixture.html";
const MOBILE = [[320, 760], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
const DESKTOP = [[1024, 768], [1366, 768]];
const SHOTS = path.join(ROOT, "docs", "screenshots", "crm-v2");
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chromePath = () => [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean).find(fs.existsSync) || (() => { throw Error("Chrome não encontrado."); })();
const staticServer = () => http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const target = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`);
  if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return response.writeHead(404).end("Not found");
  response.setHeader("Content-Type", `${MIME[path.extname(target)] || "application/octet-stream"}; charset=utf-8`);
  fs.createReadStream(target).pipe(response);
});

async function waitForFile(file, timeout = 8000) { const started = Date.now(); while (Date.now() - started < timeout) { if (fs.existsSync(file)) return; await sleep(50); } throw Error(`Timeout aguardando ${file}`); }
class Cdp {
  constructor(url) { this.id = 0; this.pending = new Map(); this.events = []; this.socket = new WebSocket(url); }
  async open() { await new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); }); this.socket.addEventListener("message", (event) => { const message = JSON.parse(event.data), pending = this.pending.get(message.id); if (!pending) return this.events.push(message); this.pending.delete(message.id); message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result); }); }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket.close(); }
}
async function evaluate(cdp, expression) { const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true }); if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Falha na página"); return result.result.value; }
async function navigate(cdp, url) { await cdp.send("Page.navigate", { url }); const started = Date.now(); while (Date.now() - started < 8000) { if (await evaluate(cdp, "document.readyState==='complete'&&Boolean(document.querySelector('.crm-dashboard-page'))")) { await sleep(180); return; } await sleep(50); } throw Error(`Página não carregou: ${url}`); }
async function setViewport(cdp, width, height, mobile) { await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height }); await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] }); }
async function shot(cdp, name) { const { data } = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false, fromSurface: true }); fs.writeFileSync(path.join(SHOTS, name), Buffer.from(data, "base64")); }
const click = (cdp, selector) => evaluate(cdp, `(()=>{const el=document.querySelector(${JSON.stringify(selector)});if(!el)throw Error('Elemento ausente: '+${JSON.stringify(selector)});el.click();return true})()`);
const assert = (value, message) => { if (!value) throw Error(message); };
async function fresh(cdp, base) { await navigate(cdp, `${base}${FIXTURE}?t=${Date.now()}`); }

async function validateMobile(cdp, base, width, height) {
  await setViewport(cdp, width, height, true); await fresh(cdp, base);
  const page = await evaluate(cdp, `(()=>({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,mobile:matchMedia('(max-width:767px)').matches,grid:Boolean(document.querySelector('.crm-opportunity-grid')),reads:__crmAudit.reads}))()`);
  assert(!page.overflow && page.mobile && page.grid && page.reads === 0, `${width}x${height} página: ${JSON.stringify(page)}`);
  await click(cdp, "[data-crm-custom-filter]"); await sleep(80);
  const builder = await evaluate(cdp, `(()=>{const box=document.querySelector('.crm-segment-builder'),row=document.querySelector('.crm-segment-condition'),fields=document.querySelector('.crm-condition-fields'),foot=box?.querySelector('.modal-foot');const r=row?.getBoundingClientRect(),f=fields?getComputedStyle(fields):null;return{exists:Boolean(box),overflow:box?.scrollWidth>box?.clientWidth+1,bodyOverflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,rowWidth:r?.width,columns:f?.gridTemplateColumns,footer:Boolean(foot),reads:__crmAudit.reads}})()`);
  assert(builder.exists && !builder.overflow && !builder.bodyOverflow && builder.footer && builder.reads === 0, `${width}x${height} builder: ${JSON.stringify(builder)}`);
  await click(cdp, "[data-builder-refresh]"); await sleep(40);
  const preview = await evaluate(cdp, `({text:document.querySelector('[data-builder-preview]')?.textContent,reads:__crmAudit.reads})`);
  assert(/cliente\(s\) encontrado\(s\)/.test(preview.text) && preview.reads === 0, `${width}x${height} prévia: ${JSON.stringify(preview)}`);
  return { viewport: `${width}x${height}`, page, builder, preview };
}

async function configureThreeConditions(cdp) {
  await click(cdp, "[data-builder-add]"); await click(cdp, "[data-builder-add]");
  await evaluate(cdp, `(()=>{const rows=[...document.querySelectorAll('[data-segment-condition]')];const set=(row,selector,value)=>{const input=row.querySelector(selector);input.value=value;input.dispatchEvent(new Event('change',{bubbles:true}))};set(rows[0],'[data-segment-field]','productUnits');const first=[...document.querySelectorAll('[data-segment-condition]')][0];set(first,'[data-segment-operator]','gte');set(first,'[data-segment-subject]','brownie');set(first,'[data-segment-value]','3');set(first,'[data-segment-period]','60d');const current=[...document.querySelectorAll('[data-segment-condition]')];set(current[1],'[data-segment-field]','totalSpent');const second=[...document.querySelectorAll('[data-segment-condition]')][1];set(second,'[data-segment-operator]','gt');set(second,'[data-segment-value]','300');set(second,'[data-segment-period]','90d');set(current[2],'[data-segment-field]','lastPurchaseDays');const third=[...document.querySelectorAll('[data-segment-condition]')][2];set(third,'[data-segment-operator]','gte');set(third,'[data-segment-value]','20')})()`);
}

async function captureMobileFlow(cdp, base) {
  await setViewport(cdp, 390, 844, true); await fresh(cdp, base); await shot(cdp, "01-crm-main-mobile.png");
  await click(cdp, "[data-crm-custom-filter]"); await shot(cdp, "02-filter-one-condition-mobile.png");
  await configureThreeConditions(cdp); await shot(cdp, "03-filter-three-conditions-mobile.png"); await shot(cdp, "04-filter-product-period-mobile.png");
  await click(cdp, "[data-builder-refresh]"); await sleep(50); await shot(cdp, "05-filter-preview-mobile.png");
  await click(cdp, "[data-builder-apply]"); await sleep(160); await shot(cdp, "06-filter-result-mobile.png");
  await click(cdp, "[data-crm-saved]"); await shot(cdp, "07-saved-segments-mobile.png"); await shot(cdp, "08-segment-actions-mobile.png");
  await click(cdp, "[data-builder-close]");
  await evaluate(cdp, `CRMDashboard.openCampaignActionChooser({clientIds:['ana','bruno'],count:2,segmentId:'saved-value',segmentName:'Clientes bons que sumiram',conditions:[{field:'totalSpent',operator:'gt',value:300,period:{key:'all'}},{field:'lastPurchaseDays',operator:'gte',value:30}],matchMode:'all',period:'all',query:'',summaries:['Gastou mais de R$ 300','30+ dias sem comprar']})`);
  const chooser = await evaluate(cdp, `({actions:document.querySelectorAll('[data-crm-action-type]').length,count:document.querySelector('.crm-selected-audience em')?.textContent})`);
  assert(chooser.actions === 6 && /2/.test(chooser.count), `ações CRM: ${JSON.stringify(chooser)}`); await shot(cdp, "09-create-action-mobile.png");
  await click(cdp, "[data-crm-action-type='points']"); await sleep(100);
  const wizard = await evaluate(cdp, `({exists:Boolean(document.querySelector('.campaign-wizard-v2')),type:document.querySelector('.campaign-wizard-v2 input[name=type]')?.value,audience:document.querySelector('.campaign-audience-source')?.textContent})`);
  assert(wizard.exists && wizard.type === "points" && /2 cliente/.test(wizard.audience), `wizard: ${JSON.stringify(wizard)}`); await shot(cdp, "10-campaign-wizard-audience-mobile.png");
  return { chooser, wizard };
}

async function captureDesktopFlow(cdp, base) {
  await setViewport(cdp, 1366, 768, false); await fresh(cdp, base); await shot(cdp, "11-crm-main-desktop.png");
  await click(cdp, "[data-crm-open-filters]"); await configureThreeConditions(cdp); await shot(cdp, "12-filter-builder-desktop.png");
  const layout = await evaluate(cdp, `(()=>{const fields=document.querySelector('.crm-condition-fields');return{mobile:matchMedia('(max-width:767px)').matches,columns:getComputedStyle(fields).gridTemplateColumns,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,reads:__crmAudit.reads}})()`);
  assert(!layout.mobile && !layout.overflow && layout.reads === 0, `desktop builder: ${JSON.stringify(layout)}`);
  await click(cdp, "[data-builder-close]"); await click(cdp, "[data-crm-saved]"); await shot(cdp, "13-saved-segment-desktop.png"); await click(cdp, "[data-builder-close]");
  await evaluate(cdp, `CRMDashboard.openCampaignActionChooser({clientIds:['ana','bruno'],count:2,segmentId:'saved-value',segmentName:'Clientes bons que sumiram',conditions:[{field:'totalSpent',operator:'gt',value:300}],matchMode:'all',summaries:['Gastou mais de R$ 300']})`); await shot(cdp, "14-campaign-audience-desktop.png");
  return layout;
}

async function main() {
  fs.mkdirSync(SHOTS, { recursive: true });
  const server = staticServer(); await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve)); const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "adi-crm-v2-")); const chrome = spawn(chromePath(), ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" }); let cdp;
  try {
    const portFile = path.join(profile, "DevToolsActivePort"); await waitForFile(portFile); const [debugPort] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/); const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((response) => response.json()); cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.open(); await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
    const mobile = []; for (const [width, height] of MOBILE) mobile.push(await validateMobile(cdp, base, width, height));
    const mobileFlow = await captureMobileFlow(cdp, base); const desktopFlow = await captureDesktopFlow(cdp, base);
    for (const [width, height] of DESKTOP) { await setViewport(cdp, width, height, false); await fresh(cdp, base); const state = await evaluate(cdp, `({content:Boolean(document.querySelector('.crm-dashboard-page')),overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,reads:__crmAudit.reads})`); assert(state.content && !state.overflow && state.reads === 0, `${width}x${height}: ${JSON.stringify(state)}`); }
    const exceptions = cdp.events.filter((event) => event.method === "Runtime.exceptionThrown"); assert(exceptions.length === 0, `Exceções no browser: ${exceptions.length}`);
    console.log(JSON.stringify({ ok: true, mobileViewports: mobile.length, desktopViewports: DESKTOP.length, screenshots: fs.readdirSync(SHOTS).length, mobileFlow, desktopFlow }, null, 2));
  } finally { cdp?.close(); chrome.kill(); server.close(); await sleep(150); try { fs.rmSync(profile, { recursive: true, force: true }); } catch {} }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
