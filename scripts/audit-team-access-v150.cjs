const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const root = process.cwd();
const output = path.join(root, "artifacts", "team-access-v155");
const mobileSizes = [[320, 760], [360, 800], [375, 812], [390, 844], [412, 915], [430, 932]];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
const server = http.createServer((request, response) => {
  const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  const file = path.resolve(root, `.${pathname === "/" ? "/tests/team-access-v150.fixture.html" : pathname}`);
  if (!file.startsWith(`${root}${path.sep}`) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return response.writeHead(404).end("Not found");
  response.writeHead(200, { "Content-Type": mime[path.extname(file)] || "application/octet-stream" });
  fs.createReadStream(file).pipe(response);
});

async function layout(page, mode, viewport) {
  return page.evaluate(({ mode, viewport }) => {
    const visible = (element) => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 1 && rect.height > 1;
    };
    const offenders = [...document.body.querySelectorAll("*")].filter((element) => {
      if (!visible(element)) return false;
      if (element.closest(".fixture-nav")) return false;
      const rect = element.getBoundingClientRect();
      return rect.left < -1 || rect.right > innerWidth + 1;
    }).map((element) => ({ tag: element.tagName, className: String(element.className || "").slice(0, 80) })).slice(0, 20);
    const routes = Object.fromEntries([...document.querySelectorAll("[data-route]")].map((node) => [node.dataset.route, visible(node)]));
    const modal = document.querySelector(".team-modal"), modalRect = modal?.getBoundingClientRect();
    const result = {
      mode, viewport, width: innerWidth, horizontalOverflow: document.documentElement.scrollWidth - innerWidth,
      offenders, routes, cards: document.querySelectorAll(".team-member-card").length,
      addVisible: Boolean(document.querySelector("[data-team-add]") && visible(document.querySelector("[data-team-add]"))),
      sellerWorkspace: Boolean(document.querySelector("[data-seller-workspace]")),
      privateCostVisible: Boolean(document.querySelector("[data-private-cost]") && visible(document.querySelector("[data-private-cost]"))),
      modal: modalRect ? { left: modalRect.left, right: modalRect.right, top: modalRect.top, bottom: modalRect.bottom, height: modalRect.height } : null,
    };
    const problems = [];
    if (result.horizontalOverflow > 1 || offenders.length) problems.push("overflow horizontal");
    if (mode === "owner" && (result.cards !== 4 || !result.addVisible || !routes.equipe)) problems.push("conteúdo do proprietário incompleto");
    if (mode === "seller" && (!result.sellerWorkspace || result.privateCostVisible || routes.equipe || routes.financeiro || routes.configuracoes || routes.planos || !routes.vender || !routes.produtos)) problems.push("isolamento visual do vendedor");
    if (modalRect && (modalRect.left < -1 || modalRect.right > innerWidth + 1 || modalRect.top < -1 || modalRect.bottom > innerHeight + 1)) problems.push("modal fora da viewport");
    return { ...result, problems };
  }, { mode, viewport });
}

async function main() {
  fs.mkdirSync(output, { recursive: true });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const browser = await puppeteer.launch({ headless: true });
  const report = [];
  try {
    const page = await browser.newPage(), errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    for (const [width, height] of mobileSizes) {
      await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
      const base = `http://127.0.0.1:${server.address().port}/tests/team-access-v150.fixture.html`;
      await page.goto(`${base}?mode=owner`, { waitUntil: "networkidle0" });
      await page.waitForFunction(() => document.querySelectorAll(".team-member-card").length === 4);
      let data = await layout(page, "owner", `${width}x${height}`);
      if (data.problems.length) throw Error(JSON.stringify(data));
      report.push(data);
      if(width===390){
        await page.screenshot({path:path.join(output,'equipe-mobile.png'),fullPage:true});
        const reads=await page.evaluate(()=>window.__teamCalls.members);
        await page.click('[data-team-filter="pending"]');
        await page.waitForFunction(()=>document.querySelectorAll('.team-member-card').length===1);
        await page.screenshot({path:path.join(output,'convite-pendente.png'),fullPage:true});
        await page.click('[data-team-filter="active"]');
        await page.waitForFunction(()=>document.querySelectorAll('.team-member-card').length===2);
        await page.screenshot({path:path.join(output,'funcionario-ativo.png'),fullPage:true});
        await page.click('[data-team-filter="all"]');
        if(await page.evaluate(()=>window.__teamCalls.members)!==reads)throw Error('Filtros causaram novas leituras');
        if(await page.$('.team-page [data-cloud-status],.team-page #cloud-panel-sync'))throw Error('Sync incluído na Equipe');
        await page.click('[data-team-edit="owner-qa"]');
        await page.click('[data-team-menu-edit="name"]');
        if(!await page.$eval('[name="role"]',node=>node.disabled)||!await page.$eval('[name="status"]',node=>node.disabled))throw Error('Owner atual pode desativar o próprio acesso');
        await page.click('.modal-foot [data-team-close]');
      }
      await page.click("[data-team-add]");
      await page.waitForSelector(".team-modal");
      data = await layout(page, "owner-modal", `${width}x${height}`);
      if (data.problems.length) throw Error(JSON.stringify(data));
      report.push(data);
      if (width === 390) {
        await page.click('[name="allowedSpaceIds"][value="loja"]');
        await page.screenshot({ path: path.join(output, "modal-adicionar-funcionario.png"), fullPage: false });
        await page.type('[name="name"]','Funcionário QA');
        await page.type('[name="email"]','employee@example.test');
        await page.click('[data-team-submit]',{clickCount:2});
        await page.waitForSelector('[data-team-invite-url]');
        const calls=await page.evaluate(()=>window.__teamCalls);
        if(calls.create!==1||calls.inputs[0].role!=='seller'||calls.inputs[0].allowedSpaceIds.join(',')!=='loja')throw Error('Convite duplicado ou fora do escopo');
        if(calls.inputs[0].permissions['financial.view'])throw Error('Seller recebeu Financeiro');
        await page.click('[data-team-close]');
        await page.click('[data-team-add]');
        await page.click('.modal-foot [data-team-close]');
        await page.click('[data-team-add]');
        if(await page.$eval('[name="name"]',node=>node.value)!=='')throw Error('Formulário novo preservou dados antigos');
        await page.select('[name="role"]','stock');
        const stock=await page.$eval('[name="permission:sales.create"]',node=>node.checked);
        if(stock)throw Error('Preset de estoque ganhou vendas');
        await page.select('[name="role"]','seller');
        await page.click('[data-team-quick="customers.view"]');
        if(await page.$eval('[name="permission:customers.view"]',node=>node.checked))throw Error('Permissão rápida não alterou campo granular');
        await page.setViewport({width:390,height:450,isMobile:true,hasTouch:true});
        const keyboard=await layout(page,'owner-modal-keyboard','390x450');
        if(keyboard.problems.length)throw Error(JSON.stringify(keyboard));
        report.push(keyboard);
      }
      await page.goto(`${base}?mode=seller`, { waitUntil: "networkidle0" });
      data = await layout(page, "seller", `${width}x${height}`);
      if (data.problems.length) throw Error(JSON.stringify(data));
      report.push(data);
      if (width === 390) await page.screenshot({ path: path.join(output, "390-seller.png"), fullPage: true });
    }
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await page.goto(`http://127.0.0.1:${server.address().port}/tests/team-access-v150.fixture.html?mode=owner`, { waitUntil: "networkidle0" });
    await page.waitForFunction(() => document.querySelectorAll(".team-member-card").length === 4);
    const desktop = await layout(page, "owner", "1440x900");
    if (desktop.problems.length) throw Error(JSON.stringify(desktop));
    report.push(desktop);
    await page.screenshot({ path: path.join(output, "1440-owner.png"), fullPage: true });
    if (errors.length) throw Error(`Erros de página: ${errors.join(" | ")}`);
    const result = { ok: true, checks: report.length, mobileViewports: mobileSizes.map(([width, height]) => `${width}x${height}`), desktop: "1440x900", report };
    fs.writeFileSync(path.join(output, "browser-results.json"), JSON.stringify(result, null, 2));
    console.log(JSON.stringify({ ok: true, checks: report.length, mobileViewports: result.mobileViewports, desktop: result.desktop, artifacts: output }, null, 2));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((error) => { console.error(error.stack || error.message); process.exitCode = 1; });
