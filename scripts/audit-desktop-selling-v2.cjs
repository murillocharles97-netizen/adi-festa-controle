const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const OUTPUT = path.join(ROOT, "artifacts", "desktop-selling-v2");
const FIXTURE = "/tests/desktop-shell-content.fixture.html";
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const viewports = [
  [1024, 768],
  [1280, 720],
  [1366, 768],
  [1440, 900],
  [1536, 864],
  [1920, 1080],
];
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webp": "image/webp",
};

function chromePath() {
  const candidates = [
    process.env.CHROME_PATH,
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  ].filter(Boolean);
  const found = candidates.find(fs.existsSync);
  if (!found) throw Error("Chrome não encontrado");
  return found;
}

function server() {
  return http.createServer((request, response) => {
    const pathname = decodeURIComponent(
      new URL(request.url, "http://localhost").pathname,
    );
    const target = path.resolve(ROOT, `.${pathname}`);
    if (!target.startsWith(ROOT) || !fs.existsSync(target))
      return response.writeHead(404).end("Not found");
    response.setHeader(
      "Content-Type",
      `${mime[path.extname(target)] || "application/octet-stream"}; charset=utf-8`,
    );
    fs.createReadStream(target).pipe(response);
  });
}

async function waitFile(file, timeout = 8000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (fs.existsSync(file)) return;
    await sleep(50);
  }
  throw Error(`Timeout aguardando ${file}`);
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
      const message = JSON.parse(event.data),
        pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error
        ? pending.reject(Error(message.error.message))
        : pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) =>
      this.pending.set(id, { resolve, reject }),
    );
  }
  close() {
    this.socket.close();
  }
}

async function evaluate(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (result.exceptionDetails)
    throw Error(
      result.exceptionDetails.exception?.description ||
        result.exceptionDetails.text,
    );
  return result.result.value;
}

async function waitFor(cdp, expression, timeout = 7000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    if (await evaluate(cdp, `Boolean(${expression})`)) return;
    await sleep(70);
  }
  throw Error(`Timeout: ${expression}`);
}

async function openFixture(cdp, base) {
  await cdp.send("Page.navigate", {
    url: `${base}${FIXTURE}?visual=vender#/vender`,
  });
  await waitFor(cdp, "document.querySelector('[data-desktop-sales]')");
  await sleep(180);
}

async function shot(cdp, name) {
  const { data } = await cdp.send("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  fs.mkdirSync(OUTPUT, { recursive: true });
  fs.writeFileSync(path.join(OUTPUT, name), Buffer.from(data, "base64"));
}

async function audit(cdp, label) {
  const report = await evaluate(
    cdp,
    `(() => {
      const root=document.querySelector('[data-desktop-sales]'), layout=root?.querySelector('.desktop-sales-layout'), products=root?.querySelector('.desktop-sales-products'), cart=root?.querySelector('.desktop-sales-cart'), cartList=root?.querySelector('.desktop-cart-list'), cta=root?.querySelector('.desktop-continue-sale'), productCards=[...root?.querySelectorAll('.desktop-sale-product')||[]], style=cart&&getComputedStyle(cart), rect=node=>{const r=node?.getBoundingClientRect();return r?{x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom}:null};
      return {exists:Boolean(root),errors:window.__desktopAuditErrors,viewportHeight:innerHeight,overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),cartOverflow:cartList?Math.max(0,cartList.scrollWidth-cartList.clientWidth):0,root:rect(root),layout:rect(layout),products:rect(products),cart:rect(cart),cta:rect(cta),sticky:style?.position,maxHeight:style?.maxHeight,productCards:productCards.length,visibleCards:productCards.filter(card=>!card.hidden).length,images:root?.querySelectorAll('.desktop-sale-product-image').length||0,recurring:Boolean(root?.querySelector('[data-add="p4"] .renewal')),outDisabled:Boolean(root?.querySelector('[data-add="p5"] .desktop-sale-add:disabled')),search:Boolean(root?.querySelector('#product-search')),scanner:Boolean(root?.querySelector('[data-scan-sale]')),client:Boolean(root?.querySelector('#open-client-picker')),cartItems:root?.querySelectorAll('.desktop-cart-item').length||0};
    })()`,
  );
  if (!report.exists || report.errors.length)
    throw Error(`${label}: renderer ausente/erro ${JSON.stringify(report)}`);
  if (report.overflow > 1)
    throw Error(`${label}: overflow horizontal ${report.overflow}px`);
  if (report.cartOverflow > 1)
    throw Error(`${label}: overflow horizontal no carrinho ${report.cartOverflow}px`);
  if (report.cta && report.cta.bottom > report.viewportHeight + 1)
    throw Error(`${label}: CTA fora do viewport (${report.cta.bottom}px) ${JSON.stringify(report)}`);
  if (report.cta && report.cart && report.cta.bottom > report.cart.bottom + 1)
    throw Error(`${label}: CTA recortado pelo painel ${JSON.stringify(report)}`);
  if (!report.productCards || !report.search || !report.scanner || !report.client)
    throw Error(`${label}: controles essenciais ausentes`);
  if (!report.recurring || !report.outDisabled)
    throw Error(`${label}: estados recurring/esgotado inválidos`);
  if (report.layout.width >= 1150) {
    const ratio = report.products.width / report.layout.width;
    if (ratio < 0.57 || ratio > 0.72)
      throw Error(`${label}: divisão produtos/carrinho inválida ${ratio}`);
  }
  return report;
}

async function main() {
  const staticServer = server();
  await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${staticServer.address().port}`,
    profile = fs.mkdtempSync(path.join(os.tmpdir(), "adi-selling-cdp-")),
    chrome = spawn(
      chromePath(),
      [
        "--headless=new",
        "--disable-gpu",
        "--no-first-run",
        "--remote-debugging-port=0",
        `--user-data-dir=${profile}`,
        "about:blank",
      ],
      { stdio: "ignore" },
    );
  let cdp;
  try {
    await waitFile(path.join(profile, "DevToolsActivePort"));
    const [port] = fs
        .readFileSync(path.join(profile, "DevToolsActivePort"), "utf8")
        .trim()
        .split(/\r?\n/),
      target = await fetch(
        `http://127.0.0.1:${port}/json/new?${encodeURIComponent("about:blank")}`,
        { method: "PUT" },
      ).then((response) => response.json());
    cdp = new Cdp(target.webSocketDebuggerUrl);
    await cdp.open();
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    const report = {};
    for (const [width, height] of viewports) {
      await cdp.send("Emulation.setDeviceMetricsOverride", {
        width,
        height,
        deviceScaleFactor: 1,
        mobile: false,
      });
      await openFixture(cdp, base);
      report[`${width}x${height}`] = await audit(
        cdp,
        `${width}x${height}`,
      );
      if ([1366, 1440, 1920].includes(width))
        await shot(cdp, `vender-${width}x${height}-vazio.png`);
    }

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 1366,
      height: 768,
      deviceScaleFactor: 1,
      mobile: false,
    });
    await openFixture(cdp, base);
    await evaluate(cdp, `document.querySelector('[data-add="p1"]').click()`);
    await waitFor(cdp, "document.querySelectorAll('.desktop-cart-item').length===1");
    await evaluate(cdp, `document.querySelector('[data-cart-step="1"]').click()`);
    await waitFor(cdp, "document.querySelector('[data-item-qty]').value==='2'");
    await shot(cdp, "vender-1366x768-carrinho.png");

    await evaluate(cdp, `document.querySelector('#open-client-picker').click()`);
    await waitFor(cdp, `document.querySelector('[data-choose-client="c1"]')`);
    await evaluate(cdp, `document.querySelector('[data-choose-client="c1"]').click()`);
    await waitFor(cdp, "document.querySelector('#sale-client').value==='c1'");
    const duplicateClientButton = await evaluate(cdp, `getComputedStyle(document.querySelector('.desktop-client-select')).display`);
    if (duplicateClientButton !== "none")
      throw Error("Cliente selecionado foi exibido duas vezes no painel");
    await shot(cdp, "vender-1366x768-cliente.png");

    await evaluate(cdp, `document.querySelector('#desktop-discount-trigger').click()`);
    await waitFor(cdp, "!document.querySelector('#desktop-discount-fields').hidden");
    await evaluate(cdp, `(() => { const input=document.querySelector('#discount-value'); input.value='2'; input.dispatchEvent(new Event('change',{bubbles:true})); })()`);
    await shot(cdp, "vender-1366x768-desconto.png");

    await evaluate(cdp, `document.querySelector('[data-add="p2"]').click()`);
    await waitFor(cdp, "document.querySelector('.variation-picker')");
    const variationLayout = await evaluate(cdp, `(() => {
      const picker=document.querySelector('.variation-picker'), row=picker?.querySelector('.variation-picker-row'), photo=row?.querySelector('.variation-picker-photo');
      const rect=node=>{const box=node?.getBoundingClientRect();return box?{width:box.width,height:box.height}:null};
      return {picker:rect(picker),row:rect(row),photo:rect(photo),overflow:picker?Math.max(0,picker.scrollWidth-picker.clientWidth):0};
    })()`);
    if (!variationLayout.photo || variationLayout.photo.width > 80 || variationLayout.photo.height > 80 || variationLayout.overflow > 1)
      throw Error(`Seletor de variações deformado: ${JSON.stringify(variationLayout)}`);
    await shot(cdp, "vender-1366x768-seletor-variacao.png");
    await evaluate(cdp, `document.querySelector('[data-variant-inc="v1"]').click()`);
    await evaluate(cdp, `document.querySelector('[data-add-variants]').click()`);
    await waitFor(cdp, "document.querySelectorAll('.desktop-cart-item').length===2");
    await audit(cdp, "carrinho com variação e desconto");
    await shot(cdp, "vender-1366x768-variacao-no-carrinho.png");

    await evaluate(cdp, `document.querySelector('#desktop-continue-sale').click()`);
    await waitFor(cdp, "!document.querySelector('#desktop-checkout-fields').hidden");
    const checkoutLayout = await evaluate(cdp, `(() => {
      const panel=document.querySelector('.desktop-sales-cart'), fields=document.querySelector('#desktop-checkout-fields'), finish=document.querySelector('#finish-sale');
      const rect=node=>{const box=node?.getBoundingClientRect();return box?{top:box.top,bottom:box.bottom,height:box.height}:null};
      return {panel:rect(panel),fields:rect(fields),finish:rect(finish),hidden:fields.hidden};
    })()`);
    if (checkoutLayout.hidden || !checkoutLayout.finish || checkoutLayout.finish.bottom > checkoutLayout.panel.bottom + 1 || checkoutLayout.finish.bottom > 769)
      throw Error(`Etapa de pagamento recortada: ${JSON.stringify(checkoutLayout)}`);
    await shot(cdp, "vender-1366x768-pagamento.png");
    await evaluate(cdp, `document.querySelector('#desktop-back-to-cart').click()`);
    await waitFor(cdp, "document.querySelector('#desktop-checkout-fields').hidden && !document.querySelector('#desktop-continue-sale').hidden");

    await evaluate(cdp, `(() => { const input=document.querySelector('#product-search'); input.value='IPTV'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await sleep(180);
    await shot(cdp, "vender-1366x768-recurring.png");
    await evaluate(cdp, `(() => { const input=document.querySelector('#product-search'); input.value='Poty'; input.dispatchEvent(new Event('input',{bubbles:true})); })()`);
    await sleep(180);
    await shot(cdp, "vender-1366x768-esgotado.png");

    const finalState = await audit(cdp, "interações finais");
    if (finalState.cartItems !== 2)
      throw Error(`Carrinho perdeu itens: ${finalState.cartItems}`);

    await cdp.send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 1,
      mobile: true,
      screenWidth: 390,
      screenHeight: 844,
    });
    await cdp.send("Page.navigate", {
      url: `${base}${FIXTURE}?visual=vender&mobile-regression=1#/vender`,
    });
    await waitFor(cdp, "document.body?.dataset.visualReady==='vender'");
    const mobile = await evaluate(
      cdp,
      `({width:innerWidth,desktop:Boolean(document.querySelector('[data-desktop-sales]')),mobile:Boolean(document.querySelector('.pos-page')),appClass:document.querySelector('#app')?.firstElementChild?.className||'',html:document.querySelector('#app')?.innerHTML.slice(0,120)||'',overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth),errors:window.__desktopAuditErrors})`,
    );
    if (mobile.desktop || !mobile.mobile || mobile.overflow > 1 || mobile.errors.length)
      throw Error(`Regressão mobile: ${JSON.stringify(mobile)}`);
    await shot(cdp, "vender-mobile-390x844-regressao.png");
    console.log(
      JSON.stringify(
        {
          ok: true,
          chrome: chromePath(),
          output: path.relative(ROOT, OUTPUT),
          report,
          interactions: {
            cart: true,
            quantity: true,
            client: true,
            discount: true,
            variation: true,
            recurring: true,
            outOfStock: true,
          },
          mobile,
        },
        null,
        2,
      ),
    );
  } finally {
    cdp?.close();
    chrome.kill();
    staticServer.close();
    await sleep(150);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {}
  }
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
