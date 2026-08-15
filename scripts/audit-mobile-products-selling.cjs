const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const VIEWPORTS = [[320,568],[360,800],[375,812],[390,844],[412,915],[430,932]];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromePath() {
  return [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","/usr/bin/google-chrome","/usr/bin/chromium"].filter(Boolean).find(fs.existsSync) || (() => { throw Error("Chrome não encontrado."); })();
}

function server() {
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
  while (Date.now() - started < timeout) { if (fs.existsSync(file)) return; await sleep(50); }
  throw Error(`Timeout aguardando ${file}`);
}

class Cdp {
  constructor(url) { this.id = 0; this.pending = new Map(); this.socket = new WebSocket(url); }
  async open() {
    await new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); });
    this.socket.addEventListener("message", (event) => { const message = JSON.parse(event.data), pending = this.pending.get(message.id); if (!pending) return; this.pending.delete(message.id); message.error ? pending.reject(Error(message.error.message)) : pending.resolve(message.result); });
  }
  send(method, params = {}) { const id = ++this.id; this.socket.send(JSON.stringify({ id, method, params })); return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject })); }
  close() { this.socket.close(); }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw Error(result.exceptionDetails.text || "Falha ao avaliar a página.");
  return result.result.value;
}

async function navigate(cdp, url) {
  await cdp.send("Page.navigate", { url });
  const started = Date.now();
  while (Date.now() - started < 5000) { if (await evaluate(cdp, "document.readyState==='complete'")) { await sleep(320); return; } await sleep(40); }
  throw Error(`Página não carregou: ${url}`);
}

async function screenshot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true });
  fs.mkdirSync(path.join(ROOT, "artifacts", "mobile-products-selling-fixes"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "artifacts", "mobile-products-selling-fixes", name), Buffer.from(data, "base64"));
}

async function main() {
  const staticServer = server();
  await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const port = staticServer.address().port, profile = fs.mkdtempSync(path.join(os.tmpdir(), "adi-mobile-cdp-"));
  const chrome = spawn(chromePath(), ["--headless=new","--disable-gpu","--no-first-run","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"], { stdio: "ignore" });
  let cdp;
  try {
    const portFile = path.join(profile, "DevToolsActivePort"); await waitForFile(portFile);
    const [debugPort] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/);
    const target = await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((response) => response.json());
    cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.open(); await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
    const report = [];
    for (const [width,height] of VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height });
      await navigate(cdp, `http://127.0.0.1:${port}/tests/mobile-product-form-fixes.fixture.html?view=form`);
      const form = await evaluate(cdp, "window.__mobileProductAudit");
      if (!form.canScroll || !form.footerVisible || !form.lastReachable || form.horizontalOverflow) throw Error(`${width}x${height}: formulário inacessível ${JSON.stringify(form)}`);
      await navigate(cdp, `http://127.0.0.1:${port}/tests/mobile-product-form-fixes.fixture.html`);
      const products = await evaluate(cdp, "window.__mobileProductAudit");
      if (products.hasStockTrack || products.horizontalOverflow || /-22|Esgotado/i.test(products.iptvText) || !/30 dias/.test(products.iptvText) || products.bottomBorders.some((value) => parseFloat(value) > 1.1)) throw Error(`${width}x${height}: cards inválidos ${JSON.stringify(products)}`);
      await navigate(cdp, `http://127.0.0.1:${port}/tests/mobile-selling-renewals.fixture.html`);
      const selling = await evaluate(cdp, `(()=>{const card=document.querySelector('.pos-product'),photo=card.querySelector('.sale-product-photo').getBoundingClientRect(),fav=card.querySelector('.mobile-sale-favorite').getBoundingClientRect();return{overflow:document.documentElement.scrollWidth>innerWidth+1,verTodos:document.body.textContent.includes('Ver todos'),favoriteInImage:fav.top>=photo.top&&fav.right<=photo.right+1&&fav.bottom<=photo.bottom+1,cardOverflow:[...document.querySelectorAll('.pos-product')].some(item=>item.scrollWidth>item.clientWidth+1)}})()`);
      if (selling.overflow || selling.verTodos || !selling.favoriteInImage || selling.cardOverflow) throw Error(`${width}x${height}: Vender inválido ${JSON.stringify(selling)}`);
      report.push({ viewport: `${width}x${height}`, form, products, selling });
      if (width === 390) {
        await screenshot(cdp, "vender-390x844.png");
        await navigate(cdp, `http://127.0.0.1:${port}/tests/mobile-product-form-fixes.fixture.html`); await screenshot(cdp, "produtos-390x844.png");
        await navigate(cdp, `http://127.0.0.1:${port}/tests/mobile-product-form-fixes.fixture.html?view=form`); await screenshot(cdp, "formulario-recorrente-390x844.png");
      }
    }
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 420, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
    await navigate(cdp, `http://127.0.0.1:${port}/tests/mobile-product-form-fixes.fixture.html?view=form`);
    const keyboard = await evaluate(cdp, "window.__mobileProductAudit");
    if (!keyboard.canScroll || !keyboard.footerVisible || !keyboard.lastReachable) throw Error(`Teclado reduzido: formulário inacessível ${JSON.stringify(keyboard)}`);
    console.log(JSON.stringify({ ok: true, report, keyboard, screenshots: "artifacts/mobile-products-selling-fixes" }, null, 2));
  } finally {
    cdp?.close(); chrome.kill(); staticServer.close(); await sleep(150);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
