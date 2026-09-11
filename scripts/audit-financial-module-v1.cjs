const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const puppeteer = require("puppeteer");

const ROOT = process.cwd(), OUTPUT = path.join(ROOT, "artifacts", "financial-module-v1-final");
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".png": "image/png" };
function server() { return http.createServer((request, response) => { const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname), target = path.resolve(ROOT, `.${pathname === "/" ? "/tests/financial-module.fixture.html" : pathname}`); if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return response.writeHead(404).end("Not found"); response.setHeader("Content-Type", `${mime[path.extname(target)] || "application/octet-stream"}; charset=utf-8`); response.setHeader("Cache-Control", "no-store"); fs.createReadStream(target).pipe(response); }); }
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const normalizeText = (value) => String(value || "").replace(/\s+/g, " ").trim();

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
    if (!result.visible || result.summaryValues !== 3 || result.quickActions !== 4 || result.overflow > 1 || result.rawFileInputsVisible || clippedSummary) throw Error(`Layout inválido ${JSON.stringify({ ...result, clippedSummary })}`);
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
  const septemberPeriod = await page.evaluate(() => ({ total: document.querySelector('[data-financial-entry-id="rent"] .financial-row-main small')?.textContent || "", rows: [...document.querySelectorAll("[data-financial-entry-id]")].map((item) => item.innerText) }));
  if (!septemberPeriod.total.includes("1.500,00") || septemberPeriod.rows.some((text) => text.includes("10/10")) || !septemberPeriod.rows.some((text) => text.includes("10/09"))) throw Error(`Filtro de setembro inválido ${JSON.stringify(septemberPeriod)}`);
  await click('[data-financial-entry-id="rent"]');
  const accountDetail = await page.evaluate(() => document.querySelector(".financial-sheet")?.innerText || "");
  if (!["Detalhes da conta", "Estrutura", "Aluguel", "10/09/2026", "Despesa recorrente", "Gerenciar recorrência"].every((text) => accountDetail.includes(text))) throw Error(`Detalhe incompleto: ${accountDetail}`);
  await shot("08-mobile-detalhes-conta.png"); await click("[data-financial-account-edit]"); await shot("09-mobile-editar-escopo-recorrencia.png");
  await reset(390,844); await click('[data-financial-entry-id="rent"]'); await click("[data-financial-account-cancel]"); await shot("10-mobile-excluir-escopo-recorrencia.png");
  await reset(390,844); await click('[data-financial-entry-id="rent"]'); await click("[data-financial-manage-recurrence]"); await shot("11-mobile-gerenciar-recorrencia.png");
  await reset(390,844); await click("[data-financial-open-period]"); await page.$eval('[name="period"]', (input) => input.value = "2026-10"); await click('[data-financial-period-form] [type="submit"]');
  const octoberPeriod = await page.evaluate(() => ({ total: document.querySelector('[data-financial-entry-id="rent-october"] .financial-row-main small')?.textContent || "", rows: [...document.querySelectorAll("[data-financial-entry-id]")].map((item) => item.innerText), period: document.querySelector(".financial-context-button.is-period b")?.textContent || "" }));
  if (!octoberPeriod.total.includes("1.500,00") || octoberPeriod.rows.some((text) => text.includes("10/09")) || !octoberPeriod.rows.some((text) => text.includes("10/10")) || !octoberPeriod.period.includes("Outubro")) throw Error(`Filtro de outubro inválido ${JSON.stringify(octoberPeriod)}`);
  await shot("12-mobile-outubro-isolado.png");
  await reset(390,844); await click('[data-financial-view="accounts"]'); await shot("13-mobile-conta-a-pagar.png");
  await reset(390,844); await click('[data-financial-register-payment]');
  let paymentWizardText = normalizeText(await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || ''));
  if (!["Passo 1 de 4", "Qual conta você vai pagar?", "Aluguel + condomínio", "R$ 1.500,00"].every((text) => paymentWizardText.includes(text))) throw Error(`Etapa 1 do pagamento incompleta: ${paymentWizardText}`);
  await shot("14-mobile-registrar-pagamento.png"); await click('[data-payment-next]');
  paymentWizardText = normalizeText(await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || ''));
  if (!["Passo 2 de 4", "Como você pagou?", "Cartão de débito", "Cartão de crédito", "Vai para uma fatura"].every((text) => paymentWizardText.includes(text))) throw Error(`Etapa 2 do pagamento incompleta: ${paymentWizardText}`);
  await shot("14b-mobile-forma-pagamento-conta.png"); await click('[data-payment-method="credit_card"]'); await click('[data-payment-next]');
  paymentWizardText = normalizeText(await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || ''));
  if (!["Passo 3 de 4", "Qual cartão?", "C6 Carbon", "•••• 6357", "Adicionar taxa/encargo real"].every((text) => paymentWizardText.includes(text))) throw Error(`Etapa 3 do pagamento incompleta: ${paymentWizardText}`);
  await click('[data-payment-card="card-c6"]'); await click('[name="feeEnabled"]'); await page.type('[name="fee"]', '18,00');
  await shot("14c-mobile-cartao-e-taxa-explicita.png"); await click('[data-payment-next]');
  paymentWizardText = normalizeText(await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || ''));
  if (!["Passo 4 de 4", "Prévia da fatura", "Taxa financeira", "R$ 18,00", "Total no cartão", "R$ 1.518,00", "Saída do caixa agora", "R$ 0,00", "Sem despesa duplicada"].every((text) => paymentWizardText.includes(text))) throw Error(`Prévia do pagamento incompleta: ${paymentWizardText}`);
  await shot("14d-mobile-previa-fatura-sem-duplicidade.png"); await close();
  const paymentAudits = [];
  for (const [width,height] of [[320,720],[360,800],[375,812],[390,844],[412,915],[430,932]]) {
    await reset(width,height); await click('[data-financial-register-payment]'); await click('[data-payment-next]'); await click('[data-payment-method="credit_card"]'); await click('[data-payment-next]');
    const layout = await page.evaluate(() => { const sheet = document.querySelector('.financial-sheet'), footer = document.querySelector('.financial-sheet .modal-foot'); return { viewport:`${innerWidth}x${innerHeight}`, documentOverflow:Math.max(0,document.documentElement.scrollWidth-innerWidth), sheetOverflow:Math.max(0,sheet.scrollWidth-sheet.clientWidth), footerWidth:footer.getBoundingClientRect().width, sheetWidth:sheet.getBoundingClientRect().width }; });
    if (layout.documentOverflow > 1 || layout.sheetOverflow > 1 || layout.footerWidth > layout.sheetWidth + 1) throw Error(`Wizard de pagamento com overflow: ${JSON.stringify(layout)}`);
    paymentAudits.push(layout);
    if (width === 320) await shot("14e-mobile-320-cartao-sem-overflow.png");
    if (width === 430) await shot("14f-mobile-430-cartao-sem-overflow.png");
    await close();
  }
  await reset(390,844); await click('[data-financial-entry-id="rent-paid"]');
  const undoDetail = normalizeText(await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || ''));
  if (!undoDetail.includes("Desfazer pagamento") || undoDetail.includes("Reverter lançamento")) throw Error(`Ação de correção ambígua: ${undoDetail}`);
  await shot("14g-mobile-detalhe-desfazer-pagamento.png"); await click('[data-financial-account-undo]');
  const undoConfirmation = normalizeText(await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || ''));
  if (!["Desfazer pagamento?", "voltará a ficar pendente", "não representa dinheiro recebido"].every((text) => undoConfirmation.toLocaleLowerCase('pt-BR').includes(text.toLocaleLowerCase('pt-BR')))) throw Error(`Confirmação de correção incompleta: ${undoConfirmation}`);
  await shot("14h-mobile-confirmar-correcao-sem-receita.png"); await close();
  await reset(430,932); await click('[data-financial-view="cashflow"]'); await shot("15-mobile-fluxo-caixa.png");
  await reset(430,932); await click('[data-financial-view="categories"]');
  const categoryReport = await page.evaluate(() => ({ subtitle: document.querySelector(".financial-subpage-head p")?.textContent || "", labels: [...document.querySelectorAll(".financial-category-list b")].map((item) => item.textContent) }));
  if (categoryReport.subtitle.includes("${") || !categoryReport.subtitle.includes("Setembro de 2026") || categoryReport.labels.includes("Aluguel") || !categoryReport.labels.includes("Estrutura")) throw Error(`Relatório macro inválido ${JSON.stringify(categoryReport)}`);
  await shot("16-mobile-categorias-macro.png");
  await reset(430,932); await click('[data-financial-view="entries"]'); await shot("17-mobile-ultimos-lancamentos.png");
  await reset(390,844); await click("[data-financial-open-spaces]"); await click('[data-financial-select-space="car"]'); await click('[data-financial-view="cards"]');
  const cardsView = (await page.evaluate(() => document.querySelector('.financial-page')?.innerText || '')).replace(/\s+/g, ' ');
  if (!["Cartões", "C6 Carbon", "•••• 6357", "Todos os espaços", "Total da fatura", "R$ 488,00", "neste espaço R$ 250,00", "Próximas faturas", "Ajustar fatura"].every((text) => cardsView.includes(text))) throw Error(`Visão de cartões compartilhados incompleta: ${cardsView}`);
  await shot("18-mobile-cartoes-v2.png"); await click('[data-financial-card-invoice="card-c6_2026-09"]');
  const invoiceDetail = (await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || '')).replace(/\s+/g, ' ');
  if (!["Fatura C6 Carbon", "Total da fatura", "R$ 488,00", "R$ 250,00 deste espaço", "Compras", "Espaços", "Categorias", "Parcelas", "Pagar total", "Ajustar valor"].every((text) => invoiceDetail.includes(text))) throw Error(`Fatura consolidada incompleta: ${invoiceDetail}`);
  await click('[data-invoice-tab="spaces"]');
  const spacesBreakdown = await page.evaluate(() => document.querySelector('[data-invoice-panel="spaces"]')?.innerText || '');
  if (!["Casa", "238,00", "Carro", "250,00"].every((text) => spacesBreakdown.includes(text))) throw Error(`Breakdown por espaço incompleto: ${spacesBreakdown}`);
  await shot("19-mobile-fatura-c6.png"); await click('[data-invoice-tab="purchases"]');
  const purchaseDetail = await page.evaluate(() => document.querySelector('[data-invoice-panel="purchases"]')?.innerText || '');
  if (!["Mercado", "Casa", "Combustível", "Carro"].every((text) => purchaseDetail.includes(text))) throw Error(`Compras multi-espaço incompletas: ${purchaseDetail}`);
  await shot("19b-mobile-fatura-compras-por-espaco.png"); await close();
  await click('[data-financial-edit-card="card-c6"]'); await click('[data-card-next]'); await click('[data-card-next]');
  const cardAccess = await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || '');
  if (!["Onde este cartão pode ser usado?", "Todos os meus espaços", "Espaços selecionados", "Somente este espaço"].every((text) => cardAccess.includes(text))) throw Error(`Escopo do cartão incompleto: ${cardAccess}`);
  await shot("19c-mobile-editar-disponibilidade-cartao.png"); await close();
  await reset(390,844); await click("[data-financial-open-spaces]"); await click('[data-financial-select-space="car"]'); await click('[data-financial-new="expense"]'); await page.type('[name="description"]','Combustível'); await page.type('[name="amount"]','250,00'); await page.$eval('[data-wizard-category]', (button) => button.click()); await click('[data-wizard-next]'); await click('[data-wizard-payment="credit_card"]'); await shot("20-mobile-pagamento-credito.png"); await click('[data-wizard-next]');
  const creditStep = await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || '');
  if (!["Qual cartão?", "C6 Carbon", "•••• 6357", "Todos os espaços", "Fatura Setembro de 2026", "vence 20/09"].every((text) => creditStep.includes(text))) throw Error(`Etapa de cartão compartilhado incompleta: ${creditStep}`);
  await shot("21-mobile-cartao-e-fatura-automatica.png"); await close();
  await reset(1366,768); await click('[data-financial-view="cards"]'); await shot("22-desktop-cartoes-v2.png");
  await reset(390,844); await click("[data-financial-open-spaces]"); await click('[data-financial-select-space="personal"]'); await shot("23-mobile-espaco-pessoal.png");
  await reset(430,932); await click("[data-financial-open-spaces]"); await click("[data-financial-open-consolidated]"); await page.$$eval('[name="spaceId"]', items => items.slice(0,2).forEach(item => item.checked=true)); await click('[data-financial-consolidated-form] [type="submit"]'); await shot("24-mobile-consolidado.png");

  await reset(1366,768); await shot("25-desktop-dashboard-financeiro.png"); await click('[data-financial-entry-id="beatriz"]'); await shot("26-desktop-lancamento-automatico.png");
  await reset(1366,768); await click('[data-financial-entry-id="rent"]'); await shot("27-desktop-detalhes-conta.png");
  await reset(1366,768); await click("[data-financial-open-spaces]"); await shot("28-desktop-seletor-espacos.png");
  await reset(1366,768); await click('[data-financial-view="accounts"]'); await shot("29-desktop-contas-a-pagar.png");

  // Evidências dedicadas da reformulação V3 aprovada.
  await reset(390,844); await shot("v3-01-mobile-visao-geral.png");
  await click('[data-financial-new="income"]'); await page.type('[name="description"]', 'Corridas do dia'); await page.type('[name="amount"]', '320,00'); await page.$eval('[data-wizard-category]', (button) => button.click()); await click('[data-wizard-next]'); await click('[data-wizard-payment="pix"]'); await click('[data-wizard-next]');
  const incomeDestination = await page.evaluate(() => document.querySelector('[name="financialAccountId"]')?.value || '');
  if (!incomeDestination) throw Error("Nova entrada não oferece conta/carteira de destino.");
  await shot("v3-02-mobile-nova-entrada.png");
  await reset(390,844); await click('[data-financial-new="expense"]'); await shot("v3-03-mobile-nova-despesa.png");
  await reset(390,844); await click("[data-financial-open-spaces]"); await click('[data-financial-select-space="car"]'); await click('[data-financial-view="cards"]'); await shot("v3-04-mobile-cartoes.png");
  await click('[data-financial-card-invoice="card-c6_2026-09"]'); await shot("v3-05-mobile-c6-carbon-fatura.png");
  await shot("v3-06-mobile-fatura-compras.png"); await click('[data-invoice-tab="categories"]'); await shot("v3-07-mobile-fatura-categorias.png");
  const donutVisible = await page.evaluate(() => Boolean(document.querySelector('.financial-donut')));
  if (!donutVisible) throw Error("Gráfico de categorias não foi renderizado.");
  await click('[data-invoice-tab="spaces"]'); await shot("v3-08-mobile-fatura-espacos.png");
  await click('[data-financial-adjust-invoice]');
  const adjustmentText = await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || '');
  if (!["Valor calculado pela VECONI", "Valor real da fatura", "Diferença a conciliar"].every((text) => adjustmentText.includes(text))) throw Error(`Ajuste de fatura incompleto: ${adjustmentText}`);
  await shot("v3-09-mobile-ajustar-fatura.png");
  await reset(390,844); await click("[data-financial-open-spaces]"); await click('[data-financial-select-space="car"]'); await click('[data-financial-view="cards"]'); await click('[data-financial-ongoing-installment]');
  const ongoingText = await page.evaluate(() => document.querySelector('.financial-sheet')?.innerText || '');
  if (!["Parcelamento em andamento", "Parcela atual", "Total de parcelas", "Parcelas anteriores não serão recriadas"].every((text) => ongoingText.includes(text))) throw Error(`Parcelamento em andamento incompleto: ${ongoingText}`);
  await shot("v3-10-mobile-parcelamento-em-andamento.png");
  await reset(390,844); await click('[data-financial-view="cashflow"]'); await shot("v3-11-mobile-fluxo.png");
  await reset(1366,768); await shot("v3-12-desktop-visao-geral.png"); await click('[data-financial-view="cards"]'); await shot("v3-13-desktop-cartoes.png");
  await click('[data-financial-card-invoice="card-c6_2026-09"]'); await shot("v3-14-desktop-fatura.png");

  await page.setViewport({ width:390, height:844, deviceScaleFactor:1, isMobile:true });
  await page.goto(`${base}/tests/financial-loading.fixture.html`, { waitUntil:"networkidle0" });
  await page.waitForSelector(".financial-summary-values strong", { timeout:2_000 });
  const progressive = await page.evaluate(() => ({
    summaryValues:document.querySelectorAll(".financial-summary-values strong").length,
    loadingVisible:Boolean(document.querySelector(".financial-loading-card")),
    title:document.querySelector(".financial-context-button b")?.textContent || "",
  }));
  if (progressive.summaryValues !== 3 || progressive.loadingVisible || progressive.title !== "Carro") throw Error(`Core bloqueado por cartões: ${JSON.stringify(progressive)}`);
  await shot("30-mobile-core-carregado-com-cartoes-pendentes.png");

  if (pageErrors.length) throw Error(`Erros no browser: ${pageErrors.join(" | ")}`);
  console.log(JSON.stringify({ ok: true, audits, paymentAudits, screenshots: fs.readdirSync(OUTPUT).sort() }, null, 2));
  await browser.close();
  await new Promise((resolve) => staticServer.close(resolve));
}
main().catch((error) => { console.error(error.stack || error.message); process.exit(1); });
