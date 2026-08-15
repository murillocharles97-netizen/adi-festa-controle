const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "artifacts", "desktop-design-system-v1");
const VIEWPORTS = [{ width: 1366, height: 768 }, { width: 1536, height: 864 }];
const BREAKPOINTS = [
  { width: 1024, height: 768 },
  { width: 1280, height: 720 },
  { width: 1366, height: 768 },
  { width: 1440, height: 900 },
  { width: 1536, height: 864 },
  { width: 1920, height: 1080 },
];
const ROUTES = ["produtos", "clientes", "crm", "catalogo", "pedidos"];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png", ".webp": "image/webp" };

function chromePath() {
  const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
}

function staticServer() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const target = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return response.writeHead(404).end("Not found");
    response.setHeader("Content-Type", `${mime[path.extname(target)] || "application/octet-stream"}; charset=utf-8`);
    fs.createReadStream(target).pipe(response);
  });
}

async function waitForFile(file, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fs.existsSync(file)) return;
    await sleep(50);
  }
  throw new Error(`Timeout aguardando ${file}`);
}

class Cdp {
  constructor(url) { this.id = 0; this.pending = new Map(); this.socket = new WebSocket(url); }
  async open() {
    await new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data), pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket.close(); }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Falha no navegador");
  return result.result.value;
}

async function waitFor(cdp, expression, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await sleep(70);
  }
  throw new Error(`Timeout: ${expression}`);
}

async function navigate(cdp, url, readyExpression) {
  await cdp.send("Page.navigate", { url });
  await waitFor(cdp, readyExpression);
  await sleep(140);
}

async function screenshot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, name), Buffer.from(data, "base64"));
}

async function assertLayout(cdp, label, selector = "#app") {
  const state = await evaluate(cdp, `(() => {
    const root=document.querySelector(${JSON.stringify(selector)}), modal=document.querySelector('.af-wizard'), footer=document.querySelector('.af-wizard__footer');
    const rect=root?.getBoundingClientRect(), style=root?getComputedStyle(root):null;
    return {exists:Boolean(root),children:root?.children.length||0,width:rect?.width||0,height:rect?.height||0,display:style?.display||'',visibility:style?.visibility||'',opacity:style?.opacity||'',overflowX:document.documentElement.scrollWidth-innerWidth,modalOverflow:modal?modal.scrollWidth-modal.clientWidth:0,footerVisible:footer?footer.getBoundingClientRect().bottom<=innerHeight+1:true};
  })()`);
  if (!state.exists || !state.children || state.display === "none" || state.visibility === "hidden" || state.opacity === "0") throw new Error(`${label}: conteúdo ausente ou oculto.`);
  if (state.overflowX > 1 || state.modalOverflow > 1) throw new Error(`${label}: overflow horizontal (${state.overflowX}/${state.modalOverflow}).`);
  if (!state.footerVisible) throw new Error(`${label}: footer do wizard fora da viewport.`);
  return state;
}

async function campaignScreens(cdp, base, suffix) {
  await navigate(cdp, `${base}/tests/campaign-v2-visual.fixture.html`, "document.querySelectorAll('[data-campaign-card]').length >= 5");
  await assertLayout(cdp, `campanhas-lista-${suffix}`);
  await screenshot(cdp, `campanhas-lista-${suffix}.png`);
  await evaluate(cdp, "document.querySelector('[data-new-campaign]').click()");
  await waitFor(cdp, "document.querySelector('[data-wizard-pane=\"objective\"]')");
  await evaluate(cdp, `(() => { document.querySelector('[data-wizard-type="points"]').click(); })()`);
  await waitFor(cdp, "document.querySelector('[data-wizard-pane=\"objective\"]')");
  await evaluate(cdp, `(() => { const f=document.querySelector('#campaign-wizard-form');f.elements.name.value='Programa de pontos da loja';f.elements.description.value='Transforme compras em pontos e recompensas.'; })()`);
  await assertLayout(cdp, `wizard-objetivo-${suffix}`, ".af-wizard");
  await screenshot(cdp, `wizard-objetivo-${suffix}.png`);
  await evaluate(cdp, "document.querySelector('#campaign-wizard-form').requestSubmit()");
  await waitFor(cdp, "document.querySelector('[data-wizard-pane=\"rule\"]')");
  await assertLayout(cdp, `wizard-regra-${suffix}`, ".af-wizard");
  await screenshot(cdp, `wizard-regra-${suffix}.png`);
  await evaluate(cdp, "document.querySelector('#campaign-wizard-form').requestSubmit()");
  await waitFor(cdp, "document.querySelector('[data-wizard-pane=\"reward\"]')");
  await evaluate(cdp, `(() => { const select=document.querySelector('[name="rewardType"]');select.value='product';select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await waitFor(cdp, "document.querySelector('[name=\"rewardProductId\"]')");
  await evaluate(cdp, `(() => { const select=document.querySelector('[name="rewardProductId"]');select.value='monster';select.dispatchEvent(new Event('change',{bubbles:true})); })()`);
  await waitFor(cdp, "document.querySelector('[name=\"rewardProductId\"]')?.value === 'monster'");
  await assertLayout(cdp, `wizard-premio-${suffix}`, ".af-wizard");
  await screenshot(cdp, `wizard-premio-${suffix}.png`);
  await evaluate(cdp, "document.querySelector('#campaign-wizard-form').requestSubmit()");
  await waitFor(cdp, "document.querySelector('[data-wizard-pane=\"audience\"]')");
  await assertLayout(cdp, `wizard-publico-${suffix}`, ".af-wizard");
  await screenshot(cdp, `wizard-publico-${suffix}.png`);
  await evaluate(cdp, "document.querySelector('#campaign-wizard-form').requestSubmit()");
  await waitFor(cdp, "document.querySelector('[data-wizard-pane=\"review\"]')");
  await assertLayout(cdp, `wizard-revisao-${suffix}`, ".af-wizard");
  await screenshot(cdp, `wizard-revisao-${suffix}.png`);
  return evaluate(cdp, `(() => ({steps:[...document.querySelectorAll('.af-wizard__steps span')].map(x=>x.className),controls:[...document.querySelectorAll('.af-wizard input,.af-wizard select,.af-wizard textarea')].every(x=>getComputedStyle(x).minHeight!=='0px'),footer:Boolean(document.querySelector('.af-wizard__footer'))}))()`);
}

async function routeScreens(cdp, base, suffix) {
  const report = {};
  for (const route of ROUTES) {
    await navigate(cdp, `${base}/tests/desktop-shell-content.fixture.html?visual=${route}#/${route}`, `document.body?.dataset.visualReady === ${JSON.stringify(route)}`);
    report[route] = await assertLayout(cdp, `${route}-${suffix}`);
    await screenshot(cdp, `${route}-${suffix}.png`);
  }
  return report;
}

async function componentAudit(cdp, base) {
  await navigate(cdp, `${base}/tests/desktop-design-system.fixture.html`, "document.querySelector('[data-design-system-gallery]')");
  const state = await evaluate(cdp, `(() => {
    const input=document.querySelector('.af-field input'), select=document.querySelector('select'), primary=document.querySelector('.af-button--primary:not(.af-button--sm):not(.af-button--lg)'), secondary=document.querySelector('.af-button--secondary');
    const height=(node)=>Math.round(node?.getBoundingClientRect().height||0);
    return {input:height(input),select:height(select),primary:height(primary),secondary:height(secondary),checkbox:Boolean(document.querySelector('.af-check input')),radio:Boolean(document.querySelector('.af-radio input')),switchControl:Boolean(document.querySelector('.af-switch input')),overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth)};
  })()`);
  if (!state.input || state.input !== state.select) throw new Error(`Galeria: input/select desalinhados (${state.input}/${state.select}).`);
  if (!state.primary || state.primary !== state.secondary) throw new Error(`Galeria: botões desalinhados (${state.primary}/${state.secondary}).`);
  if (!state.checkbox || !state.radio || !state.switchControl || state.overflow > 1) throw new Error(`Galeria: controles oficiais ausentes ou com overflow (${JSON.stringify(state)}).`);
  await screenshot(cdp, "componentes-oficiais-1366x768.png");
  return state;
}

async function breakpointAudit(cdp, base) {
  const report = {};
  for (const viewport of BREAKPOINTS) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
    const suffix = `${viewport.width}x${viewport.height}`;
    await navigate(cdp, `${base}/tests/campaign-v2-visual.fixture.html`, "document.querySelectorAll('[data-campaign-card]').length >= 5");
    const list = await assertLayout(cdp, `breakpoint-campanhas-${suffix}`);
    await evaluate(cdp, "document.querySelector('[data-new-campaign]').click()");
    await waitFor(cdp, "document.querySelector('[data-wizard-pane=\"objective\"]')");
    const wizard = await assertLayout(cdp, `breakpoint-wizard-${suffix}`, ".af-wizard");
    report[suffix] = { list, wizard };
  }
  return report;
}

async function mobileIsolation(cdp, base) {
  await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate(cdp, `${base}/tests/desktop-design-system.fixture.html`, "document.querySelector('[data-design-system-gallery]')");
  const active = await evaluate(cdp, `(() => {
    const sheet=[...document.styleSheets].find(s=>String(s.href||'').includes('/design-system/desktop.css'));
    const rules=[...(sheet?.cssRules||[])];
    return {width:innerWidth,mediaMatches:rules.filter(r=>r.type===CSSRule.MEDIA_RULE).map(r=>({condition:r.conditionText,matches:matchMedia(r.conditionText).matches})),bodyOverflow:document.documentElement.scrollWidth-innerWidth};
  })()`);
  if (active.mediaMatches.some((item) => item.condition.includes("min-width: 768px") && item.matches)) throw new Error("Design System desktop ativou em 390 px.");
  if (active.bodyOverflow > 1) throw new Error("Galeria causou overflow mobile.");
  await screenshot(cdp, "isolamento-mobile-390x844.png");
  await navigate(cdp, `${base}/tests/campaign-v2-visual.fixture.html`, "document.querySelectorAll('[data-campaign-card]').length >= 5");
  await assertLayout(cdp, "campanhas-mobile-390x844");
  await screenshot(cdp, "campanhas-mobile-390x844.png");
  return active;
}

async function main() {
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "adi-ds-cdp-"));
  const chrome = spawn(chromePath(), ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let cdp;
  try {
    await waitForFile(path.join(profile, "DevToolsActivePort"));
    const [port] = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").trim().split(/\r?\n/);
    const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((response) => response.json());
    cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.open(); await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
    const report = {};
    for (const viewport of VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: false });
      const suffix = `${viewport.width}x${viewport.height}`;
      report[suffix] = { campaigns: await campaignScreens(cdp, base, suffix), routes: await routeScreens(cdp, base, suffix) };
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1366, height: 768, deviceScaleFactor: 1, mobile: false });
    report.components = await componentAudit(cdp, base);
    report.breakpoints = await breakpointAudit(cdp, base);
    report.mobileIsolation = await mobileIsolation(cdp, base);
    console.log(JSON.stringify({ ok: true, chrome: chromePath(), output: path.relative(ROOT, OUTPUT), report }, null, 2));
  } finally {
    cdp?.close(); chrome.kill(); server.close(); await sleep(150);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch { /* Windows pode liberar o perfil depois. */ }
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
