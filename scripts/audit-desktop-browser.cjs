const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const VIEWPORTS = [390, 767, 768, 900, 1024, 1280, 1366, 1440, 1920];
const DESKTOP_ROUTES = new Set([1024, 1366, 1920]);
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw new Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
}

function staticServer() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const target = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) {
      response.writeHead(404).end("Not found");
      return;
    }
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
  constructor(url) {
    this.id = 0;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }
  async open() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(event.data);
      if (!message.id) return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }));
  }
  close() {
    this.socket.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Falha no Runtime.evaluate");
  return result.result.value;
}

async function waitForAudit(cdp, expectedWidth, timeout = 5000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const text = await evaluate(cdp, "document.querySelector('#desktop-browser-audit')?.textContent || ''");
    if (text) {
      const audit = JSON.parse(text);
      if (audit.results?.[0]?.width === expectedWidth) return audit;
    }
    await sleep(50);
  }
  throw new Error("Fixture não concluiu o diagnóstico no prazo.");
}

function validate(width, audit, fullRoutes) {
  if (audit.errors.length) throw new Error(`${width}px apresentou erro: ${audit.errors[0].message}`);
  const expectedRoutes = fullRoutes ? ["inicio", "clientes", "produtos", "crm", "configuracoes", "inicio"] : ["inicio"];
  if (audit.results.length !== expectedRoutes.length) throw new Error(`${width}px não percorreu todas as rotas.`);
  audit.results.forEach((result, index) => {
    if (result.route !== expectedRoutes[index] || result.actualRoute !== expectedRoutes[index]) throw new Error(`${width}px montou rota divergente: ${result.route}/${result.actualRoute}`);
    if (!result.appChildren || !result.appHtmlLength || result.recovery) throw new Error(`${width}px deixou ${result.route} sem conteúdo válido.`);
    if (result.appDisplay === "none" || result.appVisibility !== "visible" || result.appOpacity === "0" || result.appPointerEvents === "none") throw new Error(`${width}px ocultou ou bloqueou ${result.route}.`);
  });
  const home = audit.results[0];
  if (width >= 768 && (!home.dashboard || home.dashboardDisplay === "none")) throw new Error(`${width}px não exibiu o dashboard desktop.`);
  if (width < 768 && home.dashboard) throw new Error(`${width}px ativou o dashboard desktop indevidamente.`);
}

async function main() {
  const server = staticServer();
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const serverPort = server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "adi-desktop-cdp-"));
  const chrome = spawn(chromePath(), ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let cdp;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    await waitForFile(portFile);
    const [port] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
    const target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((response) => response.json());
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    const report = [];
    for (const width of VIEWPORTS) {
      const fullRoutes = DESKTOP_ROUTES.has(width);
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height: width === 1366 ? 768 : width === 1920 ? 1080 : 900, deviceScaleFactor: 1, mobile: false });
      const query = fullRoutes ? `?w=${width}` : `?single=1&w=${width}`;
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/tests/desktop-shell-content.fixture.html${query}#/inicio` });
      const audit = await waitForAudit(cdp, width);
      validate(width, audit, fullRoutes);
      report.push({ width, routes: audit.results.map((item) => item.route), dashboard: audit.results[0].dashboard, children: audit.results.map((item) => item.appChildren), errors: audit.errors.length });
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${serverPort}/tests/desktop-shell-content.fixture.html?single=1&w=resize#/inicio` });
    await waitForAudit(cdp, 390);
    const loadCount = await evaluate(cdp, "window.__fixtureLoadCount");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 1280, height: 900, deviceScaleFactor: 1, mobile: false });
    await sleep(180);
    const desktopResize = await evaluate(cdp, "({width:innerWidth,desktop:Boolean(document.querySelector('[data-desktop-dashboard]')),children:document.querySelector('#app').children.length,loads:window.__fixtureLoadCount})");
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: false });
    await sleep(180);
    const mobileResize = await evaluate(cdp, "({width:innerWidth,mobile:Boolean(document.querySelector('.mobile-home-dashboard')),children:document.querySelector('#app').children.length,loads:window.__fixtureLoadCount})");
    if (!desktopResize.desktop || !desktopResize.children || desktopResize.loads !== loadCount) throw new Error("Resize 390→1280 reiniciou a página ou não montou o dashboard desktop.");
    if (!mobileResize.mobile || !mobileResize.children || mobileResize.loads !== loadCount) throw new Error("Resize 1280→390 reiniciou a página ou não restaurou a Home mobile.");
    console.log(JSON.stringify({ ok: true, chrome: chromePath(), report, resize: { loadCount, desktop: desktopResize, mobile: mobileResize } }, null, 2));
  } finally {
    cdp?.close();
    chrome.kill();
    server.close();
    await sleep(150);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      // O Chrome no Windows pode manter o arquivo de perfil aberto por alguns
      // instantes depois de encerrar; isso não invalida o resultado do teste.
    }
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
