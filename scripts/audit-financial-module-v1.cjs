const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd(), OUTPUT = path.join(ROOT, "artifacts", "financial-module-v1-final");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
function server() { return http.createServer((request, response) => { const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname), target = path.resolve(ROOT, `.${pathname === "/" ? "/tests/financial-module.fixture.html" : pathname}`); if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return response.writeHead(404).end("Not found"); response.setHeader("Content-Type", `${mime[path.extname(target)] || "application/octet-stream"}; charset=utf-8`); response.setHeader("Cache-Control", "no-store"); fs.createReadStream(target).pipe(response); }); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  fs.rmSync(OUTPUT, { recursive: true, force: true });
  fs.mkdirSync(OUTPUT, { recursive: true });
  const staticServer = server(); await new Promise((resolve) => staticServer.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${staticServer.address().port}`, browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage(), pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") pageErrors.push(message.text()); });

  async function reset(width, height) {
    await page.setViewport({ width, height, deviceScaleFactor: 1, isMobile: width <= 780 });
    await page.goto(`${base}/tests/financial-module.fixture.html`, { waitUntil: "networkidle0" });
    await page.waitForSelector(".financial-summary-values strong");
    await sleep(80);
  }
  async function shot(name) { await page.screenshot({ path: path.join(OUTPUT, name), fullPage: false }); }
  async function click(selector) { await page.waitForSelector(selector); await page.$eval(selector, (element) => element.click()); await sleep(160); }
  async function close() { const button = await page.$("[data-financial-close]"); if (button) { await button.click(); await sleep(60); } }
  async function audit(width, height) {
    await reset(width, height);
    const result = await page.evaluate(() => { const main = document.querySelector(".financial-page"), rect = main.getBoundingClientRect(), center = document.elementFromPoint(innerWidth / 2, Math.min(innerHeight - 90, 420)); return { viewport: `${innerWidth}x${innerHeight}`, visible: rect.width > 0 && rect.height > 0 && getComputedStyle(main).display !== "none", summaryValues: document.querySelectorAll(".financial-summary-values strong").length, quickActions: document.querySelectorAll(".financial-quick-actions button").length, overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), topElement: center?.className || center?.tagName, rawFileInputsVisible: [...document.querySelectorAll('input[type=file]')].some((input) => { const r=input.getBoundingClientRect(); return r.width>2&&r.height>2; }) }; });
    const clippedSummary = await page.$$eval(".financial-summary-values strong", (items) => items.some((item) => item.scrollWidth > item.clientWidth + 1));
    if (!result.visible || result.summaryValues !== 3 || result.quickActions !== 3 || result.overflow > 1 || result.rawFileInputsVisible || clippedSummary) throw Error(`Layout inválido ${JSON.stringify({ ...result, clippedSummary })}`);
    return result;
  }

  const audits = [];
  for (const viewport of [[320,720],[360,800],[375,812],[390,844],[412,915],[430,932],[1024,768],[1366,768],[1920,1080]]) audits.push(await audit(...viewport));

  await reset(390,844);
  const automaticIncome = await page.evaluate(() => ({ context: document.querySelector(".financial-context-button small")?.textContent || "", row: document.querySelector('[data-financial-entry-id="beatriz"]')?.innerText || "", total: document.querySelector(".financial-summary-values .is-income")?.textContent || "" }));
  if (!automaticIncome.context.includes("Automático") || !["Beatriz Maze", "63,50", "Pix", "Automático"].every((text) => automaticIncome.row.includes(text)) || !automaticIncome.total.includes("8.483,50")) throw Error(`Receita automática inválida ${JSON.stringify(automaticIncome)}`);
  await shot("01-mobile-financeiro-adi-festa.png");
  await click("[data-financial-open-spaces]"); await click('[data-financial-select-space="primeline"]'); await shot("02-mobile-financeiro-primeline.png");
  await reset(390,844); await click("[data-financial-open-spaces]");
  const spaceModes = await page.evaluate(() => [...document.querySelectorAll(".financial-space-option small")].map((item) => item.textContent));
  if (!spaceModes.includes("Negócio · Automático") || spaceModes.filter((text) => text.endsWith("· Manual")).length < 2) throw Error(`Modos dos espaços inválidos ${JSON.stringify(spaceModes)}`);
  await shot("03-mobile-seletor-espacos.png");
  await click('[data-financial-manage-space="business"]');
  const automationPanel = await page.evaluate(() => document.querySelector(".financial-sheet")?.innerText || "");
  if (!["Automação financeira", "Ativa", "Vendas pagas", "Pagamentos de clientes", "Pedidos online pagos", "01/09/2026"].every((text) => automationPanel.includes(text))) throw Error(`Painel de automação incompleto: ${automationPanel}`);
  await shot("03b-mobile-automacao-negocio.png");
  await reset(390,844); await click('[data-financial-entry-id="beatriz"]');
  const automaticDetail = await page.evaluate(() => ({ text: document.querySelector(".financial-sheet")?.innerText || "", editable: Boolean(document.querySelector("[data-financial-account-edit],[data-financial-account-reverse],[data-financial-account-cancel]")) }));
  if (automaticDetail.editable || !["Lançamento automático", "Pagamento de cliente", "PIX"].every((text) => automaticDetail.text.toLocaleUpperCase("pt-BR").includes(text.toLocaleUpperCase("pt-BR")))) throw Error(`Detalhe automático inválido ${JSON.stringify(automaticDetail)}`);
  await shot("03c-mobile-lancamento-automatico.png");
  await reset(390,844); await click('[data-financial-new="expense"]'); await page.waitForSelector('[data-financial-entry-wizard]');
  const wizard = await page.evaluate(() => ({
    step: document.querySelector(".financial-wizard-head small")?.textContent,
    title: document.querySelector(".financial-wizard-body h3")?.textContent,
    macroLabels: [...document.querySelectorAll("[data-wizard-category] span")].slice(0, 6).map((item) => item.textContent),
    hasLegacyForm: Boolean(document.querySelector("[data-financial-entry-form]")),
  }));
  if (wizard.step !== "Passo 1 de 4" || wizard.title !== "O que você vai registrar?" || wizard.hasLegacyForm || !wizard.macroLabels.includes("Estrutura")) throw Error(`Wizard inválido ${JSON.stringify(wizard)}`);
  await page.type('[name="description"]', 'Aluguel + condomínio'); await page.type('[name="amount"]', '1500,00');
  await click('[data-wizard-category="default_business_structure"]'); await click('[data-wizard-subcategory="default_business_structure_rent"]');
  await shot("04-mobile-nova-despesa-passo-1.png");
  await click('[data-wizard-next]'); await shot("05-mobile-forma-pagamento.png");
  await click('[data-wizard-payment="pending"]'); await click('[data-wizard-next]'); await click('[data-wizard-schedule="recurring"]'); await shot("06-mobile-recorrencia.png");
  await click('[data-wizard-next]');
  const review = await page.evaluate(() => document.querySelector(".financial-wizard-review")?.innerText || "");
  if (!review.includes("Casa") && (!review.includes("Estrutura") || !review.includes("Aluguel"))) throw Error(`Revisão sem hierarquia: ${review}`);
  await shot("07-mobile-nova-despesa-passo-4.png"); await close();
  await reset(390,844); await click('[data-financial-new="expense"]'); await click('[data-wizard-custom-category]'); await page.type('[name="customCategoryName"]', 'Impressão 3D'); await click('[data-wizard-custom-subcategory]'); await page.type('[name="customSubcategoryName"]', 'Filamentos');
  const customPicker = await page.evaluate(() => ({ category: document.querySelector('[name="customCategoryName"]')?.value.trim(), subcategory: document.querySelector('[name="customSubcategoryName"]')?.value.trim() }));
  if (customPicker.category !== "Impressão 3D" || customPicker.subcategory !== "Filamentos") throw Error(`Categoria custom inválida ${JSON.stringify(customPicker)}`);
  await close();
  await reset(390,844);
  const septemberPeriod = await page.evaluate(() => ({ total: document.querySelector(".financial-kpis b")?.textContent || "", rows: [...document.querySelectorAll("[data-financial-entry-id]")].map((item) => item.innerText) }));
  if (!septemberPeriod.total.includes("1.738,00") || septemberPeriod.rows.some((text) => text.includes("10/10")) || !septemberPeriod.rows.some((text) => text.includes("10/09"))) throw Error(`Filtro de setembro inválido ${JSON.stringify(septemberPeriod)}`);
  await click('[data-financial-entry-id="rent"]');
  const accountDetail = await page.evaluate(() => document.querySelector(".financial-sheet")?.innerText || "");
  if (!["Detalhes da conta", "Estrutura", "Aluguel", "10/09/2026", "Despesa recorrente", "Gerenciar recorrência"].every((text) => accountDetail.includes(text))) throw Error(`Detalhe incompleto: ${accountDetail}`);
  await shot("08-mobile-detalhes-conta.png"); await click("[data-financial-account-edit]"); await shot("09-mobile-editar-escopo-recorrencia.png");
  await reset(390,844); await click('[data-financial-entry-id="rent"]'); await click("[data-financial-account-cancel]"); await shot("10-mobile-excluir-escopo-recorrencia.png");
  await reset(390,844); await click('[data-financial-entry-id="rent"]'); await click("[data-financial-manage-recurrence]"); await shot("11-mobile-gerenciar-recorrencia.png");
  await reset(390,844); await click("[data-financial-open-period]"); await page.$eval('[name="period"]', (input) => input.value = "2026-10"); await click('[data-financial-period-form] [type="submit"]');
  const octoberPeriod = await page.evaluate(() => ({ total: document.querySelector(".financial-kpis b")?.textContent || "", rows: [...document.querySelectorAll("[data-financial-entry-id]")].map((item) => item.innerText), period: document.querySelector(".financial-context-button.is-period b")?.textContent || "" }));
  if (!octoberPeriod.total.includes("1.500,00") || octoberPeriod.rows.some((text) => text.includes("10/09")) || !octoberPeriod.rows.some((text) => text.includes("10/10")) || !octoberPeriod.period.includes("Outubro")) throw Error(`Filtro de outubro inválido ${JSON.stringify(octoberPeriod)}`);
  await shot("12-mobile-outubro-isolado.png");
  await reset(390,844); await click('[data-financial-view="accounts"]'); await shot("13-mobile-conta-a-pagar.png");
  await reset(390,844); await click('[data-financial-register-payment]'); await shot("14-mobile-registrar-pagamento.png");
  await reset(430,932); await click('[data-financial-view="cashflow"]'); await shot("15-mobile-fluxo-caixa.png");
  await reset(430,932); await click('[data-financial-view="categories"]');
  const categoryReport = await page.evaluate(() => ({ subtitle: document.querySelector(".financial-subpage-head p")?.textContent || "", labels: [...document.querySelectorAll(".financial-category-list b")].map((item) => item.textContent) }));
  if (categoryReport.subtitle.includes("${") || !categoryReport.subtitle.includes("Setembro de 2026") || categoryReport.labels.includes("Aluguel") || !categoryReport.labels.includes("Estrutura")) throw Error(`Relatório macro inválido ${JSON.stringify(categoryReport)}`);
  await shot("16-mobile-categorias-macro.png");
  await reset(430,932); await click('[data-financial-view="entries"]'); await shot("17-mobile-ultimos-lancamentos.png");
  await reset(390,844); await click('[data-financial-view="cards"]');
  const cardsView = (await page.evaluate(() => document.querySelector('.financial-page')?.innerText || '')).replace(/\s+/g, ' ');
  if (!["Cartões", "C6 Carbon", "•••• 2429", "Total comprometido", "R$ 238,00", "Próximas faturas"].every((text) => cardsView.includes(text))) throw Error(`Visão de cartões incompleta: ${cardsView}`);
  await shot("18-mobile-cartoes-v2.png"); await click('[data-financial-card-invoice="card-c6_2026-09"]');
  const invoiceDetail = (await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || '')).replace(/\s+/g, ' ');
  if (!["Fatura C6 Carbon", "Mercado", "R$ 238,00", "Pagar fatura"].every((text) => invoiceDetail.includes(text))) throw Error(`Fatura incompleta: ${invoiceDetail}`);
  await shot("19-mobile-fatura-c6.png"); await close();
  await reset(390,844); await click('[data-financial-new="expense"]'); await page.type('[name="description"]','Mercado'); await page.type('[name="amount"]','238,00'); await click('[data-wizard-category="default_business_structure"]'); await click('[data-wizard-next]'); await click('[data-wizard-payment="credit_card"]'); await shot("20-mobile-pagamento-credito.png"); await click('[data-wizard-next]');
  const creditStep = await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || '');
  if (!["Qual cartão?", "C6 Carbon", "Fatura Setembro de 2026", "vence 20/09"].every((text) => creditStep.includes(text))) throw Error(`Etapa de cartão incompleta: ${creditStep}`);
  await shot("21-mobile-cartao-e-fatura-automatica.png"); await close();
  await reset(1366,768); await click('[data-financial-view="cards"]'); await shot("22-desktop-cartoes-v2.png");
  await reset(390,844); await click("[data-financial-open-spaces]"); await click('[data-financial-select-space="personal"]'); await shot("23-mobile-espaco-pessoal.png");
  await reset(430,932); await click("[data-financial-open-spaces]"); await click("[data-financial-open-consolidated]"); await page.$$eval('[name="spaceId"]', items => items.slice(0,2).forEach(item => item.checked=true)); await click('[data-financial-consolidated-form] [type="submit"]'); await shot("24-mobile-consolidado.png");

  await reset(1366,768); await shot("25-desktop-dashboard-financeiro.png"); await click('[data-financial-entry-id="beatriz"]'); await shot("26-desktop-lancamento-automatico.png");
  await reset(1366,768); await click('[data-financial-entry-id="rent"]'); await shot("27-desktop-detalhes-conta.png");
  await reset(1366,768); await click("[data-financial-open-spaces]"); await shot("28-desktop-seletor-espacos.png");
  await reset(1366,768); await click('[data-financial-view="accounts"]'); await shot("29-desktop-contas-a-pagar.png");

  if (pageErrors.length) throw Error(`Erros no browser: ${pageErrors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, audits, screenshots: fs.readdirSync(OUTPUT).sort() }, null, 2));
  await browser.close();
  await new Promise((resolve) => staticServer.close(resolve));
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
