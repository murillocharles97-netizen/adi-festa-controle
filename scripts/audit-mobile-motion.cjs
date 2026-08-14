const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd(),
  VIEWPORTS = [
    { width: 320, height: 720 },
    { width: 360, height: 800 },
    { width: 375, height: 812 },
    { width: 390, height: 844 },
    { width: 412, height: 915 },
    { width: 430, height: 932 },
  ],
  mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".webp": "image/webp" },
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
function chromePath() {
  const candidates = [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe", "/usr/bin/google-chrome", "/usr/bin/chromium"].filter(Boolean);
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) throw Error("Chrome não encontrado. Defina CHROME_PATH.");
  return found;
}
function server() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname),
      target = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return response.writeHead(404).end("Not found");
    response.setHeader("Content-Type", `${mime[path.extname(target)] || "application/octet-stream"}; charset=utf-8`);
    fs.createReadStream(target).pipe(response);
  });
}
async function waitFile(file, timeout = 8000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (fs.existsSync(file)) return;
    await sleep(40);
  }
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
  const value = await cdp.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (value.exceptionDetails) throw Error(value.exceptionDetails.exception?.description || value.exceptionDetails.text || "Falha no browser");
  return value.result.value;
}
async function ready(cdp) {
  for (let tries = 0; tries < 100; tries++) {
    if (await evaluate(cdp, "Boolean(window.__mobileMotionFixture)")) return;
    await sleep(30);
  }
  throw Error("Fixture mobile não iniciou.");
}
async function screenshot(cdp, name) {
  const result = await cdp.send("Page.captureScreenshot", { format: "png", captureBeyondViewport: false });
  const directory = path.join(ROOT, "artifacts", "mobile-motion-polish");
  fs.mkdirSync(directory, { recursive: true });
  const file = path.join(directory, name);
  fs.writeFileSync(file, Buffer.from(result.data, "base64"));
  return file;
}
function assert(condition, message) { if (!condition) throw Error(message); }

async function main() {
  const staticServer = server();
  await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "adi-mobile-motion-")),
    chrome = spawn(chromePath(), ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let cdp;
  try {
    const portFile = path.join(profile, "DevToolsActivePort");
    await waitFile(portFile);
    const [port] = fs.readFileSync(portFile, "utf8").trim().split(/\r?\n/),
      target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((response) => response.json());
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    const report = [];
    for (const viewport of VIEWPORTS) {
      await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "no-preference" }] });
      await cdp.send("Emulation.setDeviceMetricsOverride", { ...viewport, deviceScaleFactor: 1, mobile: true, screenWidth: viewport.width, screenHeight: viewport.height });
      await cdp.send("Page.navigate", { url: `http://127.0.0.1:${staticServer.address().port}/tests/mobile-motion-polish.fixture.html?w=${viewport.width}` });
      await ready(cdp);
      const skeleton = await evaluate(cdp, "({loading:document.querySelectorAll('.product-photo-shell.is-loading').length,animation:getComputedStyle(document.querySelector('.product-photo-shell.is-loading'),'::before').animationName})");
      assert(skeleton.loading > 0 && skeleton.animation !== "none", `${viewport.width}px não exibiu skeleton animado.`);
      await sleep(520);
      if (viewport.width === 390) await screenshot(cdp, "produtos-grade-390x844.png");
      const listMotion = await evaluate(cdp, "(async()=>{document.querySelector('[data-layout=list]').click();await new Promise(requestAnimationFrame);const list=document.querySelector('#fixture-products');return {mode:list.classList.contains('list'),animations:list.getAnimations({subtree:true}).length,active:list.dataset.motionActive}})()");
      assert(listMotion.mode && listMotion.animations > 0 && listMotion.active === "layout", `${viewport.width}px não executou FLIP Grade→Lista.`);
      await sleep(280);
      if (viewport.width === 390) await screenshot(cdp, "produtos-lista-390x844.png");
      const gridMotion = await evaluate(cdp, "(async()=>{document.querySelector('[data-layout=grid]').click();await new Promise(requestAnimationFrame);return document.querySelector('#fixture-products').getAnimations({subtree:true}).length})()");
      assert(gridMotion > 0, `${viewport.width}px não executou FLIP Lista→Grade.`);
      const favorite = await evaluate(cdp, "(()=>{document.querySelector('.favorite').click();return document.querySelector('.favorite').getAnimations().length})()");
      assert(favorite > 0, `${viewport.width}px não animou favorito.`);
      const filter = await evaluate(cdp, "(()=>{document.querySelector('[data-filter]').click();return document.querySelector('#fixture-products').getAnimations({subtree:true}).length})()");
      assert(filter > 0, `${viewport.width}px não animou filtro.`);
      const stock = await evaluate(cdp, "(async()=>{const bar=document.querySelector('.stock i');getComputedStyle(bar).width;bar.style.width='92%';await new Promise(requestAnimationFrame);return {animations:bar.getAnimations().length,duration:getComputedStyle(bar).transitionDuration}})()");
      assert(stock.animations > 0 && stock.duration !== "0s", `${viewport.width}px não animou estoque.`);
      const press = await evaluate(cdp, "(()=>{MobileMotion.press(document.querySelector('.demo-card'));return document.querySelector('.demo-card').getAnimations().length})()");
      assert(press > 0, `${viewport.width}px não aplicou press feedback.`);
      await evaluate(cdp, "document.querySelector('[data-screen=sale]').click()");
      if (viewport.width === 390) await screenshot(cdp, "vender-390x844.png");
      const firstAdd = await evaluate(cdp, "(()=>{document.querySelector('.sale-card:not([data-variable=true])').click();const flight=document.querySelector('.cart-flight');return {flight:Boolean(flight),animations:flight?.getAnimations().length||0,count:document.querySelector('.sale-card .count').textContent}})()");
      assert(firstAdd.flight && firstAdd.animations > 0, `${viewport.width}px não criou fly-to-cart real.`);
      await sleep(390);
      const afterFlight = await evaluate(cdp, "({flight:Boolean(document.querySelector('.cart-flight')),count:document.querySelector('.sale-card .count').textContent})");
      assert(!afterFlight.flight && afterFlight.count === "1", `${viewport.width}px não concluiu primeiro fly/contador.`);
      const secondAdd = await evaluate(cdp, "(()=>{document.querySelector('.sale-card:not([data-variable=true])').click();return {flight:Boolean(document.querySelector('.cart-flight')),countAnimations:document.querySelector('.sale-card .count').getAnimations({subtree:true}).length}})()");
      assert(!secondAdd.flight && secondAdd.countAnimations > 0, `${viewport.width}px repetiu fly ou não animou contador 1→2.`);
      await sleep(230);
      const secondCount = await evaluate(cdp, "document.querySelector('.sale-card .count').textContent");
      assert(secondCount === "2", `${viewport.width}px não terminou contador em 2.`);
      const sheet = await evaluate(cdp, "(()=>{document.querySelector('.sale-card[data-variable=true]').click();const sheet=document.querySelector('.sheet');return {exists:Boolean(sheet),animations:sheet?.getAnimations().length||0}})()");
      assert(sheet.exists && sheet.animations > 0, `${viewport.width}px não abriu bottom sheet animado.`);
      const snap = await evaluate(cdp, "getComputedStyle(document.querySelector('.recent')).scrollSnapType");
      assert(String(snap).startsWith("x"), `${viewport.width}px não habilitou scroll-snap nos recentes.`);
      const longTasks = await evaluate(cdp, "window.__mobileMotionLongTasks||[]");
      assert(longTasks.length === 0, `${viewport.width}px gerou long task durante as microinterações: ${longTasks.join(', ')}`);
      report.push({ ...viewport, skeleton: true, flip: true, favorite: true, filter: true, stock: true, counter: true, flight: true, sheet: true, snap, longTasks: 0 });
    }
    await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] });
    await cdp.send("Page.navigate", { url: `http://127.0.0.1:${staticServer.address().port}/tests/mobile-motion-polish.fixture.html?reduced=1` });
    await ready(cdp);
    const reduced = await evaluate(cdp, "(()=>{const card=document.querySelector('.demo-card'),bag=document.querySelector('#fixture-bag');return {reduced:MobileMotion.reduced(),flight:MobileMotion.fly(card,bag),animations:MobileMotion.press(card)}})()");
    assert(reduced.reduced && reduced.flight === null && reduced.animations === null, "prefers-reduced-motion não removeu movimentos principais.");
    console.log(JSON.stringify({ ok: true, chrome: chromePath(), viewports: report, reducedMotion: true, screenshots: path.join(ROOT, "artifacts", "mobile-motion-polish") }, null, 2));
  } finally {
    cdp?.close(); chrome.kill(); staticServer.close(); await sleep(120);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
