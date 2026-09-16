const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "artifacts", "release-142-qa");
const FIXTURE = "/tests/desktop-shell-content.fixture.html";
const VIEWPORTS = [[320, 700], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function chromePath() {
  return [process.env.CHROME_PATH, "C:/Program Files/Google/Chrome/Application/chrome.exe", "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe"].filter(Boolean).find(fs.existsSync) || (() => { throw Error("Chrome não encontrado"); })();
}
function server() {
  const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    const target = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`);
    if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return response.writeHead(404).end("Not found");
    response.setHeader("Content-Type", `${mime[path.extname(target)] || "application/octet-stream"}; charset=utf-8`);
    fs.createReadStream(target).pipe(response);
  });
}
async function waitFile(file, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (fs.existsSync(file)) return; await sleep(40); }
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
  if (result.exceptionDetails) throw Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
  return result.result.value;
}
async function waitFor(cdp, expression, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) { if (await evaluate(cdp, `Boolean(${expression})`)) return; await sleep(60); }
  throw Error(`Timeout: ${expression}`);
}
async function open(cdp, base, route) {
  await cdp.send("Page.navigate", { url: `${base}${FIXTURE}?visual=${route}&v142=1#/${route}` });
  await waitFor(cdp, `document.body?.dataset.visualReady==='${route}'`);
  await sleep(180);
}
async function shot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, name), Buffer.from(data, "base64"));
}
async function mobileMetrics(cdp) {
  return evaluate(cdp, `(() => {
    const home=document.querySelector('.mobile-home-dashboard'), grid=document.querySelector('#pos-grid'), bag=document.querySelector('#open-sale-summary'), sheet=document.querySelector('#pos-summary'), nav=document.querySelector('.bottom-nav');
    const rect=node=>{const r=node?.getBoundingClientRect();return r?{left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height}:null};
    return {route:Router.atual(),overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),home:Boolean(home),greeting:/Bom dia|Boa tarde|Boa noite/.test(home?.textContent||''),space:Boolean(home?.querySelector('[data-space-select="home"]')),goal:Boolean(home?.querySelector('.home-goal-card')),mainMetrics:home?.querySelectorAll('.home-main-metrics article').length||0,secondary:home?.querySelectorAll('.home-secondary-scroller article').length||0,attention:Boolean(home?.querySelector('.home-attention')),columns:grid?getComputedStyle(grid).gridTemplateColumns.split(' ').length:0,bag:rect(bag),bagCount:bag?.dataset.count||'',sheet:rect(sheet),nav:rect(nav),errors:window.__desktopAuditErrors};
  })()`);
}
async function add(cdp, id, times = 1) {
  await evaluate(cdp, `(()=>{for(let i=0;i<${times};i++)document.querySelector('[data-add="${id}"]').click();return Checkout.cartCount()})()`);
  await sleep(80);
}
async function openCart(cdp) {
  await evaluate(cdp, `document.querySelector('#open-sale-summary').click()`);
  await waitFor(cdp, `document.querySelector('#pos-summary').classList.contains('mobile-open')&&!document.querySelector('#pos-summary').hidden`);
}
async function finish(cdp) {
  await evaluate(cdp, `document.querySelector('#finish-sale').click()`);
  await sleep(120);
}

async function main() {
  const staticServer = server();
  await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${staticServer.address().port}`,
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "veconi-v142-cdp-")),
    chrome = spawn(chromePath(), ["--headless=new", "--disable-gpu", "--no-first-run", "--remote-debugging-port=0", `--user-data-dir=${profile}`, "about:blank"], { stdio: "ignore" });
  let cdp;
  try {
    await waitFile(path.join(profile, "DevToolsActivePort"));
    const [port] = fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").trim().split(/\r?\n/),
      target = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" }).then((response) => response.json());
    cdp = new Cdp(target.webSocketDebuggerUrl); await cdp.open(); await cdp.send("Page.enable"); await cdp.send("Runtime.enable");
    const viewports = {};
    for (const [width, height] of VIEWPORTS) {
      await cdp.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true, screenWidth: width, screenHeight: height });
      await open(cdp, base, "inicio");
      const home = await mobileMetrics(cdp);
      if (!home.home || home.greeting || !home.space || !home.goal || home.mainMetrics !== 2 || home.secondary !== 3 || !home.attention || home.overflow > 1 || home.errors.length) throw Error(`${width}x${height}: Home inválida ${JSON.stringify(home)}`);
      await open(cdp, base, "vender");
      const sell = await mobileMetrics(cdp);
      if (sell.columns !== 2 || !sell.bag || sell.bag.width > 70 || sell.bag.width < 52 || sell.bag.bottom > sell.nav.top - 6 || sell.overflow > 1 || sell.errors.length) throw Error(`${width}x${height}: Vender inválida ${JSON.stringify(sell)}`);
      viewports[`${width}x${height}`] = { home, sell };
    }

    await cdp.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true, screenWidth: 390, screenHeight: 844 });
    await open(cdp, base, "inicio"); await shot(cdp, "A-home-nova-390x844.png");
    await open(cdp, base, "vender"); await shot(cdp, "B-vender-vazio-390x844.png");
    await add(cdp, "p1", 10);
    const badge = await evaluate(cdp, `({count:document.querySelector('#open-sale-summary').dataset.count,label:document.querySelector('#open-sale-summary').getAttribute('aria-label')})`);
    if (badge.count !== "10" || !badge.label.includes("10 itens")) throw Error(`Badge 10+ incorreto: ${JSON.stringify(badge)}`);
    await shot(cdp, "C-vender-sacola-badge-10-390x844.png");
    await openCart(cdp);
    await evaluate(cdp, `(()=>{const qty=document.querySelector('[data-item-qty="p1"]');qty.value='1';qty.dispatchEvent(new Event('change',{bubbles:true}));return true})()`);
    await evaluate(cdp, `document.querySelector('#close-sale-summary').click()`); await waitFor(cdp, `document.querySelector('#pos-summary').hidden`);
    await add(cdp, "p3"); await add(cdp, "p6"); await openCart(cdp);
    await evaluate(cdp, `document.querySelector('#open-client-picker').click()`); await waitFor(cdp, `document.querySelector('[data-choose-client="c1"]')`); await evaluate(cdp, `document.querySelector('[data-choose-client="c1"]').click()`);
    await evaluate(cdp, `(()=>{document.querySelector('[data-payment="dinheiro"]').click();const discount=document.querySelector('#discount-value');discount.value='2';discount.dispatchEvent(new Event('change',{bubbles:true}));const note=document.querySelector('#sale-note');note.value='Venda QA v142';note.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);
    await shot(cdp, "D-carrinho-bottom-sheet-390x844.png");

    await cdp.send("Page.reload", { ignoreCache: true });
    await waitFor(cdp, `document.body?.dataset.visualReady==='vender'`); await waitFor(cdp, `Checkout.cartCount()===3`); await openCart(cdp);
    const restored = await evaluate(cdp, `({items:Checkout.cartCount(),client:document.querySelector('#sale-client').value,payment:document.querySelector('#sale-payment-method').value,note:document.querySelector('#sale-note').value,discount:document.querySelector('#discount-value').value})`);
    if (restored.items !== 3 || restored.client !== "c1" || restored.payment !== "dinheiro" || restored.note !== "Venda QA v142" || restored.discount !== "2") throw Error(`Rascunho não restaurado: ${JSON.stringify(restored)}`);

    await evaluate(cdp, `(()=>{window.__realSaleRepository=Repositories.saleRepository;Repositories.saleRepository=()=>({list:()=>Vendas.listar(),create:()=>{throw Object.assign(new Error('Falha simulada de gravação.'),{code:'qa/write-failed'})}});return true})()`);
    await finish(cdp);
    const failed = await evaluate(cdp, `({state:document.querySelector('#finish-sale').dataset.saleState,feedback:document.querySelector('#sale-submit-feedback').textContent,items:Checkout.cartCount(),client:document.querySelector('#sale-client').value,payment:document.querySelector('#sale-payment-method').value,note:document.querySelector('#sale-note').value,sales:DB.carregar().vendas.length})`);
    if (failed.state !== "error" || failed.items !== 3 || failed.client !== "c1" || failed.payment !== "dinheiro" || failed.note !== "Venda QA v142" || failed.sales !== 1) throw Error(`Falha não preservou carrinho: ${JSON.stringify(failed)}`);
    await shot(cdp, "F-erro-carrinho-preservado-390x844.png");

    await evaluate(cdp, `(()=>{Repositories.saleRepository=window.__realSaleRepository;document.querySelector('#toasts').innerHTML='';const b=document.querySelector('#finish-sale');b.click();b.click();return true})()`);
    await waitFor(cdp, `DB.carregar().vendas.length===2&&document.querySelector('.mobile-sale-completion')`);
    const first = await evaluate(cdp, `(()=>{const sale=DB.carregar().vendas.at(-1);return{sales:DB.carregar().vendas.length,spaceId:sale.spaceId,businessId:sale.businessId,operationId:sale.operationId,items:Checkout.cartCount(),finishing:Checkout.state().finishing}})()`);
    if (first.sales !== 2 || first.spaceId !== "fixture-space" || first.businessId !== "desktop-shell-fixture" || !first.operationId || first.items !== 0 || first.finishing) throw Error(`Venda concluída inválida: ${JSON.stringify(first)}`);
    await sleep(220); await shot(cdp, "E-venda-concluida-390x844.png");

    for (let run = 0; run < 2; run++) {
      await evaluate(cdp, `document.querySelector('[data-sale-next="new"]').click()`);
      await waitFor(cdp, `Router.atual()==='vender'&&document.querySelector('[data-add="p1"]')`);
      await add(cdp, "p1", 3); await openCart(cdp);
      const before = await evaluate(cdp, `DB.carregar().vendas.length`);
      await evaluate(cdp, `(()=>{const b=document.querySelector('#finish-sale');b.click();b.click();return true})()`);
      await waitFor(cdp, `DB.carregar().vendas.length===${before + 1}&&document.querySelector('.mobile-sale-completion')`);
      const after = await evaluate(cdp, `({sales:DB.carregar().vendas.length,finishing:Checkout.state().finishing,items:Checkout.cartCount(),spaceId:DB.carregar().vendas.at(-1).spaceId})`);
      if (after.sales !== before + 1 || after.finishing || after.items || after.spaceId !== "fixture-space") throw Error(`Execução consecutiva ${run + 2} inválida: ${JSON.stringify(after)}`);
    }
    const report = { ok: true, viewports, badge, restored, failed, first, repeatedSales: 3, screenshots: path.relative(ROOT, OUTPUT) };
    fs.mkdirSync(OUTPUT, { recursive: true }); fs.writeFileSync(path.join(OUTPUT, "report.json"), JSON.stringify(report, null, 2));
    console.log(JSON.stringify(report, null, 2));
  } finally {
    cdp?.close(); chrome.kill(); staticServer.close(); await sleep(120);
    try { fs.rmSync(profile, { recursive: true, force: true }); } catch {}
  }
}
main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
