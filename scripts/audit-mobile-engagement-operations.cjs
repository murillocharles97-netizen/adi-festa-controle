const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const VIEWPORTS = [[360, 800], [390, 844], [430, 932]];
const SCREENS = {
  crm: { selector: ".crm-opportunity-grid", count: [".crm-opportunity-grid>button", 6] },
  campaign: { selector: ".campaign-operational-overview", count: [".campaign-tabs span", 4] },
  catalog: { selector: ".catalog-status-card", count: [".catalog-product-mini article", 3] },
  orders: { selector: ".online-orders-list", count: [".online-order-compact", 4] },
};
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

async function navigate(cdp, url, selector) {
  await cdp.send("Page.navigate", { url });
  const started = Date.now();
  while (Date.now() - started < 5000) {
    if (await evaluate(cdp, `document.readyState==='complete'&&Boolean(document.querySelector(${JSON.stringify(selector)}))`)) { await sleep(120); return; }
    await sleep(40);
  }
  throw Error(`Página não carregou: ${url}`);
}

async function main() {
  const staticServer = server();
  await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const port = staticServer.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "adi-engagement-"));
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
      for (const [screen, expected] of Object.entries(SCREENS)) {
        await navigate(cdp, `http://127.0.0.1:${port}/tests/mobile-engagement-operations.fixture.html?screen=${screen}`, expected.selector);
        const audit = await evaluate(cdp, `(()=>({overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth+1,count:document.querySelectorAll(${JSON.stringify(expected.count[0])}).length,visible:Boolean(document.querySelector(${JSON.stringify(expected.selector)})?.getBoundingClientRect().height)}))()`);
        if (audit.overflow || audit.count !== expected.count[1] || !audit.visible) throw Error(`${width}x${height} ${screen}: ${JSON.stringify(audit)}`);
        report.push({ viewport: `${width}x${height}`, screen, ...audit });
      }
    }
    console.log(JSON.stringify({ ok: true, report }, null, 2));
  } finally {
    cdp?.close();
    chrome.kill();
    staticServer.close();
    await sleep(150);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
