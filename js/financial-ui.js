window.FinanceiroUI = (() => {
  const Engine = window.FinancialEngine;
  const state = {
    view: "dashboard",
    period: Engine.periodKey(),
    loading: false,
    error: "",
    dashboard: null,
    consolidated: false,
    selectedSpaceId: "",
    accountFilter: "all",
    requestVersion: 0,
  };
  const root = () => document.querySelector("#app .financial-page");
  const modal = () => document.querySelector("#modal");
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const money = (value) => Engine.formatMoney(Number(value || 0));
  const monthLabel = (key) => {
    const { start } = Engine.monthRange(key);
    return start.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }).replace(/^./, (letter) => letter.toUpperCase());
  };
  const dateLabel = (value) => {
    const date = Engine.localDate(value);
    return date ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" }) : "—";
  };
  const fullDateLabel = (value) => {
    const date = Engine.localDate(value);
    return date ? date.toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—";
  };
  const paymentLabel = {
    cash: "Dinheiro",
    pix: "Pix",
    credit_card: "Cartão",
    debit_card: "Débito",
    automatic_debit: "Débito automático",
    transfer: "Transferência",
    other: "Outro",
  };
  const statusLabel = (entry) => ({
    pending: "Pendente",
    overdue: "Vencida",
    paid: "Pago",
    cancelled: "Cancelado",
    reversed: "Estornado",
  })[Engine.effectiveStatus(entry)] || "Pendente";
  const statusClass = (entry) => `is-${Engine.effectiveStatus(entry)}`;
  const spaces = () => window.FinancialSpaceService?.listCachedSpaces?.() || [];
  const selectedSpace = () => spaces().find((item) => item.id === state.selectedSpaceId) || null;
  const automation = (space) => window.FinancialSpaceService?.automationState?.(space) || { enabled: false, autoIncome: {} };
  const automationLabel = (space) => space?.type === "business" && automation(space).enabled ? "Automático" : "Manual";
  const invoiceStatusLabel = { open: "Aberta", closed: "Fechada", paid: "Paga", overdue: "Vencida", cancelled: "Cancelada" };

  function render() {
    return `<section class="financial-page" aria-live="polite">
      <div class="financial-loading-card">${icon("loader-circle")}<b>Carregando seu financeiro…</b><span>Somente o período selecionado será consultado.</span></div>
    </section>`;
  }

  const selectorMarkup = () => {
    const space = selectedSpace();
    return `<div class="financial-context-selectors">
      <button class="financial-context-button" type="button" data-financial-open-spaces aria-label="Escolher espaço financeiro">
        <span>${icon(space?.icon || "wallet-cards")}<small>Espaço financeiro${state.consolidated ? "" : ` · ${automationLabel(space)}`}</small><b>${esc(state.consolidated ? "Visão consolidada" : space?.name || "Escolher espaço")}</b></span>${icon("chevron-down")}
      </button>
      <button class="financial-context-button is-period" type="button" data-financial-open-period aria-label="Escolher período">
        <span>${icon("calendar-days")}<small>Período</small><b>${esc(monthLabel(state.period))}</b></span>${icon("chevron-down")}
      </button>
    </div>`;
  };

  function metricMarkup(summary) {
    const resultClass = summary.resultCents < 0 ? "is-negative" : "is-positive";
    return `<section class="financial-summary-card">
      ${selectorMarkup()}
      <div class="financial-summary-values">
        <article><small>Entradas</small><strong class="is-income">${money(summary.totalInCents)}</strong></article>
        <article><small>Saídas</small><strong class="is-expense">${money(summary.totalOutCents)}</strong></article>
        <article><small>Resultado</small><strong class="${resultClass}">${summary.resultCents >= 0 ? "+ " : "− "}${money(Math.abs(summary.resultCents))}</strong></article>
      </div>
    </section>`;
  }

  function payablesMarkup(entries = [], compact = true) {
    if (!entries.length) return `<div class="financial-empty-inline">${icon("calendar-check")}<div><b>Nenhuma conta pendente</b><span>As próximas contas aparecerão aqui.</span></div></div>`;
    return `<div class="financial-list ${compact ? "is-compact" : ""}">${entries.map((entry) => `
      <article class="financial-list-row" ${entry.entityType === "credit_card_invoice" ? `data-financial-invoice-id="${esc(entry.creditCardInvoiceId)}" data-financial-invoice-home="${esc(entry.cardHomeSpaceId || state.selectedSpaceId)}"` : `data-financial-entry-id="${esc(entry.id)}"`}>
        <span class="financial-row-icon">${icon(entry.categoryIcon || "receipt-text")}</span>
        <span class="financial-row-main"><b>${esc(entry.description)}</b><small>${money(entry.amountCents)}</small></span>
        <span class="financial-row-date">${Engine.effectiveStatus(entry) === "overdue" ? "venceu" : "vence"} ${dateLabel(entry.dueAt)}</span>
        <span class="financial-status ${statusClass(entry)}">${entry.entityType === "credit_card_invoice" ? esc(invoiceStatusLabel[entry.invoiceStatus] || "Fatura") : statusLabel(entry)}</span>
        ${compact || entry.status === "paid" ? "" : entry.entityType === "credit_card_invoice" ? `<button class="financial-row-action" type="button" data-financial-open-invoice="${esc(entry.creditCardInvoiceId)}" data-financial-invoice-home="${esc(entry.cardHomeSpaceId || state.selectedSpaceId)}">${icon("receipt-text")}<span>Ver fatura</span></button>` : `<button class="financial-row-action" type="button" data-financial-pay="${esc(entry.id)}">${icon("circle-check-big")}<span>Pagar</span></button>`}
      </article>`).join("")}</div>`;
  }

  function latestMarkup(entries = [], full = false) {
    if (!entries.length) return `<div class="financial-empty-inline">${icon("arrow-left-right")}<div><b>Nenhum lançamento realizado</b><span>Entradas e pagamentos aparecerão aqui.</span></div></div>`;
    return `<div class="financial-list ${full ? "" : "is-compact"}">${entries.map((entry) => `
      <article class="financial-list-row financial-entry-row" data-financial-entry-id="${esc(entry.id)}">
        <span class="financial-row-icon ${entry.direction === "in" ? "is-income" : "is-expense"}">${icon(entry.direction === "in" ? "arrow-up" : "arrow-down")}</span>
        <span class="financial-row-main"><b>${esc(entry.description)}</b><small>${esc(entry.categoryName || "Outros")}${entry.subcategoryName ? ` · ${esc(entry.subcategoryName)}` : ""} · ${dateLabel(entry.occurredAt)}${entry.paymentMethod ? ` · ${esc(paymentLabel[entry.paymentMethod] || entry.paymentMethod)}` : ""}</small>${entry.autoGenerated ? '<em class="financial-origin-badge is-automatic">Automático</em>' : '<em class="financial-origin-badge">Manual</em>'}</span>
        <span class="financial-status ${entry.direction === "in" ? "is-paid" : entry.cashFlowEffect === false ? "is-pending" : "is-overdue"}">${entry.direction === "in" ? entry.cashFlowEffect === false ? "Ajuste" : "Entrada" : entry.cashFlowEffect === false ? "Gasto no crédito" : "Saída"}</span>
        <strong class="financial-row-amount ${entry.direction === "in" ? "is-income" : "is-expense"}">${entry.direction === "in" ? entry.cashFlowEffect === false ? "− " : "+ " : "− "}${money(entry.amountCents)}</strong>
      </article>`).join("")}</div>`;
  }

  function categoriesMarkup(categories = [], expensesTotalCents = 0) {
    if (!categories.length || !expensesTotalCents) return `<div class="financial-empty-inline">${icon("chart-no-axes-column-increasing")}<div><b>Sem gastos no período</b><span>Compras à vista e no crédito aparecerão por categoria.</span></div></div>`;
    return `<div class="financial-category-list">${categories.slice(0, 5).map((category, index) => `
      <article>
        <span class="financial-category-icon">${icon(["house", "shopping-bag", "megaphone", "zap", "shapes"][index] || "shapes")}</span>
        <b>${esc(category.categoryName)}</b>
        <span class="financial-category-bar"><i style="width:${Math.max(4, category.percentage)}%"></i></span>
        <strong>${category.percentage}%</strong>
        <em>${money(category.amountCents)}</em>
      </article>`).join("")}</div>`;
  }

  const internalNav = () => `<nav class="financial-module-tabs" aria-label="Seções do Financeiro">
    <button type="button" data-financial-view="dashboard" class="${state.view === "dashboard" ? "active" : ""}">Visão geral</button>
    <button type="button" data-financial-view="wallets" class="${state.view === "wallets" ? "active" : ""}">Contas</button>
    <button type="button" data-financial-view="cards" class="${state.view === "cards" ? "active" : ""}">Cartões</button>
    <button type="button" data-financial-view="cashflow" class="${state.view === "cashflow" ? "active" : ""}">Fluxo</button>
  </nav>`;

  const cardScopeLabel = (card) => {
    const normalized = Engine.normalizeCreditCardAccess(card, card.cardHomeSpaceId || card.financialSpaceId), names = new Map(spaces().map((space) => [space.id, space.name]));
    if (normalized.accessMode === "all_spaces") return "Todos os espaços";
    if (normalized.accessMode === "selected_spaces") return `${normalized.allowedFinancialSpaceIds.length} espaços`;
    return `Somente ${names.get(normalized.defaultFinancialSpaceId) || "este espaço"}`;
  };

  const creditCardMarkup = (card) => {
    const invoice = card.currentInvoice, status = invoice ? invoiceStatusLabel[invoice.status] || "Aberta" : "Sem fatura";
    const invoiceDisabled = !invoice || state.consolidated;
    const shared = card.accessMode !== "single_space", currentSpaceAmount = invoice?.currentSpaceAmountCents ?? invoice?.spaceAmountCents ?? invoice?.remainingCents ?? 0;
    return `<article class="financial-credit-card" data-financial-card-id="${esc(card.id)}" data-financial-card-home="${esc(card.cardHomeSpaceId || card.financialSpaceId)}">
      <header><span>${icon("credit-card")}</span><div><h3>${esc(card.name)}</h3><small>•••• ${esc(card.last4)}</small></div><em>${esc(status)}</em>${!state.consolidated && card.canEditScope ? `<button class="financial-card-manage" type="button" data-financial-edit-card="${esc(card.id)}" data-financial-card-home="${esc(card.cardHomeSpaceId || card.financialSpaceId)}" aria-label="Gerenciar ${esc(card.name)}">${icon("settings-2")}</button>` : ""}</header>
      <span class="financial-card-scope">${icon(shared ? "share-2" : "lock-keyhole")} ${esc(cardScopeLabel(card))}</span>
      <div class="financial-credit-card-total"><small>${shared ? "Deste espaço" : "Fatura atual"}</small><strong>${money(currentSpaceAmount)}</strong><span>${invoice ? `${shared ? `Fatura consolidada ${money(invoice.remainingCents)} · ` : ""}Vence ${dateLabel(invoice.dueDate)}` : "Nenhuma compra lançada"}</span></div>
      <dl><div><dt>Limite</dt><dd>${money(card.limitCents || 0)}</dd></div><div><dt>Disponível</dt><dd>${money(card.availableCents || 0)}</dd></div></dl>
      <button type="button" data-financial-card-invoice="${esc(invoice?.id || "")}" data-financial-invoice-home="${esc(invoice?.cardHomeSpaceId || card.cardHomeSpaceId || card.financialSpaceId)}" ${invoiceDisabled ? "disabled" : ""}>${state.consolidated ? "Somente leitura" : "Ver fatura"} ${icon("chevron-right")}</button>
    </article>`;
  };

  function walletsMarkup(data) {
    const accounts = data.financialAccounts || [];
    return `${subpageHeader("Contas e carteiras", "De onde o dinheiro entra ou sai", state.consolidated ? "" : `<button class="btn btn-primary" type="button" data-financial-new-account>${icon("plus")} Nova conta</button>`)}${internalNav()}
      <section class="financial-section financial-subpage-card"><div class="financial-wallet-list">${accounts.length ? accounts.map((account) => `<article><span>${icon(account.type === "cash" ? "banknote" : "landmark")}</span><div><b>${esc(account.name)}</b><small>${esc(account.institution || (account.type === "cash" ? "Dinheiro" : "Conta manual"))}</small></div><strong>${money(account.initialBalanceCents || 0)}</strong><em>Saldo inicial</em></article>`).join("") : `<div class="financial-empty-inline">${icon("wallet")}<div><b>Nenhuma conta cadastrada</b><span>Cadastre banco, dinheiro ou carteira para pagar faturas.</span></div></div>`}</div><p class="financial-data-note">${icon("info")} O saldo bancário não é inventado: por enquanto ele parte do saldo inicial e dos movimentos registrados.</p></section>`;
  }

  function cardsMarkup(data) {
    const cards = data.creditCards || [], future = data.futureInvoices || [];
    return `${subpageHeader("Cartões", "Um cartão pode ser usado em vários espaços sem duplicar a fatura", state.consolidated ? "" : `<button class="btn btn-primary" type="button" data-financial-new-card>${icon("plus")} Novo cartão</button>`)}${internalNav()}
      <section class="financial-credit-overview"><article><small>Compras deste espaço</small><strong>${money(data.creditCommittedCents || 0)}</strong><span>Parte atribuída ao espaço selecionado.</span></article><article><small>Cartões disponíveis</small><strong>${cards.length}</strong><span>Próprios ou compartilhados com este espaço.</span></article></section>
      <section class="financial-section financial-subpage-card"><header><h2>Meus cartões</h2></header>${cards.length ? `<div class="financial-credit-grid">${cards.map(creditCardMarkup).join("")}</div>` : `<div class="financial-empty-inline">${icon("credit-card")}<div><b>Nenhum cartão cadastrado</b><span>Cadastre um cartão para o vencimento ser calculado automaticamente.</span></div></div>`}</section>
      <section class="financial-section financial-subpage-card"><header><h2>Próximas faturas</h2></header>${future.length ? `<div class="financial-invoice-list">${future.slice(0, 12).map((invoice) => `<button type="button" data-financial-open-invoice="${esc(invoice.id)}" data-financial-invoice-home="${esc(invoice.cardHomeSpaceId)}" ${state.consolidated ? "disabled" : ""}><span>${icon("receipt-text")}<b>${esc(invoice.cardName || "Cartão")}</b><small>${monthLabel(invoice.referenceKey)} · vence ${dateLabel(invoice.dueDate)}${invoice.spaceAmountCents !== invoice.remainingCents ? ` · ${money(invoice.spaceAmountCents)} deste espaço` : ""}</small></span><strong>${money(invoice.remainingCents)}</strong><em class="financial-status is-${invoice.status === "overdue" ? "overdue" : invoice.status === "paid" ? "paid" : "pending"}">${esc(invoiceStatusLabel[invoice.status] || invoice.status)}</em>${icon("chevron-right")}</button>`).join("")}</div>` : `<div class="financial-empty-inline">${icon("calendar-check")}<div><b>Sem faturas futuras</b><span>As parcelas e compras aparecerão aqui.</span></div></div>`}</section>`;
  }

  function dashboardMarkup(data) {
    const summary = data.summary || {};
    return `${metricMarkup(summary)}${internalNav()}
      <section class="financial-kpis">
        <button type="button" data-financial-view="accounts"><span>${icon("wallet-cards")}</span><small>Contas a pagar</small><b>${money(summary.pendingPayablesCents)}</b></button>
        <button type="button" data-financial-view="accounts"><span>${icon("calendar-clock")}</span><small>Vencem em 7 dias</small><b>${summary.dueSoonCount || 0} conta${summary.dueSoonCount === 1 ? "" : "s"}</b></button>
        <button type="button" data-financial-view="categories"><span>${icon("chart-pie")}</span><small>Gastos do mês</small><b>${money(summary.expensesTotalCents || 0)}</b></button>
      </section>
      <section class="financial-section"><header><h2>Próximas contas</h2><button type="button" data-financial-view="accounts">Ver todas</button></header>${payablesMarkup((data.payables || []).slice(0, 3))}</section>
      <section class="financial-section"><header><h2>Ações rápidas</h2></header><div class="financial-quick-actions">
        <button type="button" data-financial-new="expense"><span>${icon("plus")}</span><b>Nova despesa</b></button>
        <button type="button" data-financial-register-payment><span>${icon("credit-card")}</span><b>Registrar pagamento</b></button>
        <button type="button" data-financial-view="cashflow"><span>${icon("chart-no-axes-column-increasing")}</span><b>Ver fluxo de caixa</b></button>
      </div></section>
      ${(data.creditCards || []).length ? `<section class="financial-section"><header><h2>Cartões</h2><button type="button" data-financial-view="cards">Ver todos</button></header><div class="financial-card-strip">${data.creditCards.slice(0, 3).map(creditCardMarkup).join("")}</div></section>` : ""}
      <section class="financial-section"><header><h2>Categorias do mês</h2><button type="button" data-financial-view="categories">Ver relatório</button></header>${categoriesMarkup(summary.categories, summary.expensesTotalCents)}</section>
      <section class="financial-section"><header><h2>Últimos lançamentos</h2><button type="button" data-financial-view="entries">Ver todos</button></header>${latestMarkup((data.latest || []).slice(0, 5))}</section>`;
  }

  function subpageHeader(title, subtitle, action = "") {
    return `<header class="financial-subpage-head"><button type="button" data-financial-view="dashboard" aria-label="Voltar">${icon("arrow-left")}</button><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>${action}</header>${selectorMarkup()}`;
  }

  function accountsMarkup(data) {
    const byId = new Map(), filter = state.accountFilter;
    for (const entry of [...(data.accounts || []), ...(data.payables || [])]) if (entry.direction === "out") byId.set(entry.id, entry);
    const accounts = [...byId.values()].filter((entry) => filter === "all" || (filter === "paid" ? entry.status === "paid" : Engine.effectiveStatus(entry) === filter));
    return `${subpageHeader("Contas a pagar", `Contas com vencimento em ${monthLabel(state.period)}`, `<button class="btn btn-primary" type="button" data-financial-new="expense">${icon("plus")} Nova conta</button>`)}
      <section class="financial-section financial-subpage-card"><div class="financial-filter-chips"><button data-financial-account-filter="all" class="${filter === "all" ? "active" : ""}">Todas</button><button data-financial-account-filter="pending" class="${filter === "pending" ? "active" : ""}">Pendentes</button><button data-financial-account-filter="overdue" class="${filter === "overdue" ? "active" : ""}">Vencidas</button><button data-financial-account-filter="paid" class="${filter === "paid" ? "active" : ""}">Pagas</button></div>${payablesMarkup(accounts, false)}</section>`;
  }

  function cashflowMarkup(data) {
    const summary = data.summary || {}, pendingIn = (data.entries || []).filter((entry) => entry.direction === "in" && entry.status === "pending").reduce((sum, entry) => sum + Number(entry.remainingCents ?? entry.amountCents), 0), pendingOut = (data.payables || []).reduce((sum, entry) => sum + Number(entry.amountCents || 0), 0);
    return `${subpageHeader("Fluxo de caixa", "Realizado e previsto sem misturar os números", `<button class="btn btn-primary" type="button" data-financial-transfer>${icon("arrow-left-right")} Transferir</button>`)}${internalNav()}
      <section class="financial-flow-grid"><article><span>${icon("circle-check-big")}</span><h3>Realizado</h3><p>Dinheiro que efetivamente entrou ou saiu.</p><dl><div><dt>Entradas</dt><dd class="is-income">${money(summary.totalInCents)}</dd></div><div><dt>Saídas</dt><dd class="is-expense">${money(summary.totalOutCents)}</dd></div><div><dt>Saldo</dt><dd>${money(summary.resultCents)}</dd></div></dl></article>
      <article><span>${icon("calendar-range")}</span><h3>Previsto</h3><p>Contas e recebimentos que ainda não foram realizados.</p><dl><div><dt>Entradas</dt><dd class="is-income">${money(pendingIn)}</dd></div><div><dt>Saídas</dt><dd class="is-expense">${money(pendingOut)}</dd></div><div><dt>Projeção</dt><dd>${money(summary.resultCents + pendingIn - pendingOut)}</dd></div></dl></article></section>
      <section class="financial-section financial-subpage-card"><header><h2>Lançamentos do período</h2><button type="button" data-financial-new="income">Nova entrada</button></header>${latestMarkup(data.entries || [], true)}</section>`;
  }

  function categoriesPageMarkup(data) {
    return `${subpageHeader("Categorias", `Gastos assumidos em ${monthLabel(state.period)}`, `<button class="btn btn-primary" type="button" data-financial-new-category>${icon("plus")} Categoria</button>`)}
      <section class="financial-section financial-subpage-card">${categoriesMarkup(data.summary?.categories || [], data.summary?.expensesTotalCents || 0)}</section>`;
  }

  function entriesPageMarkup(data) {
    return `${subpageHeader("Últimos lançamentos", "Histórico realizado do espaço atual", `<button class="btn btn-primary" type="button" data-financial-new="income">${icon("plus")} Entrada</button>`)}
      <section class="financial-section financial-subpage-card">${latestMarkup(data.entries || [], true)}</section>`;
  }

  function emptyMarkup() {
    return `<section class="financial-onboarding"><span>${icon("wallet-cards")}</span><h2>Seu financeiro começa aqui.</h2><p>Registre uma despesa, uma entrada ou vincule as vendas da sua empresa.</p><div><button class="btn btn-primary" type="button" data-financial-onboard-business>${icon("store")} Usar empresa atual</button><button class="btn btn-light" type="button" data-financial-create-space="personal">${icon("home")} Criar espaço pessoal</button></div></section>`;
  }

  async function refresh(options = {}) {
    const service = window.FinancialSpaceService, page = root();
    if (!service || !page) return;
    const version = ++state.requestVersion;
    state.loading = true;
    state.error = "";
    if (!options.silent) page.classList.add("is-loading");
    try {
      const available = await service.listSpaces();
      if (version !== state.requestVersion || !root()) return;
      if (!available.length) {
        state.dashboard = null;
        root().innerHTML = emptyMarkup();
        bindPage();
        return;
      }
      state.selectedSpaceId = service.selectedSpaceId() || available[0].id;
      if (!service.listCachedSpaces().some((item) => item.id === state.selectedSpaceId)) state.selectedSpaceId = available[0].id;
      service.selectSpace(state.selectedSpaceId);
      if (!state.consolidated) await service.reconcileBusinessIncome?.(state.selectedSpaceId);
      const data = state.consolidated
        ? await service.loadConsolidated(service.selectedConsolidatedIds(), state.period)
        : await service.loadDashboard(state.selectedSpaceId, state.period);
      if (version !== state.requestVersion || !root()) return;
      state.dashboard = data;
      paint();
    } catch (error) {
      console.error("[FinanceiroUI] refresh failed", {
        code: error.code,
        operation: error.financialContext?.operation || "load",
        path: error.financialContext?.path || "financialSpaces",
      });
      state.error = error.code === "permission-denied"
        ? "Não foi possível acessar este espaço financeiro."
        : "Não foi possível carregar seus dados financeiros agora.";
      root().innerHTML = `<section class="financial-error">${icon("triangle-alert")}<h2>Não foi possível carregar o Financeiro</h2><p>${esc(state.error)}</p><button class="btn btn-primary" type="button" data-financial-retry>Tentar novamente</button></section>`;
      bindPage();
    } finally {
      state.loading = false;
      root()?.classList.remove("is-loading");
      window.lucide?.createIcons();
    }
  }

  function paint() {
    const page = root();
    if (!page || !state.dashboard) return;
    const views = {
      dashboard: dashboardMarkup,
      accounts: accountsMarkup,
      wallets: walletsMarkup,
      cards: cardsMarkup,
      cashflow: cashflowMarkup,
      categories: categoriesPageMarkup,
      entries: entriesPageMarkup,
    };
    page.innerHTML = (views[state.view] || dashboardMarkup)(state.dashboard);
    page.dataset.financialView = state.view;
    bindPage();
    window.lucide?.createIcons();
  }

  function closeModal() {
    if (modal()) modal().innerHTML = "";
  }
  function sheet(content, className = "") {
    modal().innerHTML = `<div class="modal-bg financial-modal-bg"><section class="modal-box financial-sheet ${className}" role="dialog" aria-modal="true">${content}</section></div>`;
    modal().querySelector(".financial-modal-bg").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeModal(); });
    modal().querySelectorAll("[data-financial-close]").forEach((button) => button.onclick = closeModal);
    window.lucide?.createIcons();
  }
  const sheetHeader = (title, subtitle = "") => `<header class="modal-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button class="icon-btn" type="button" data-financial-close aria-label="Fechar">${icon("x")}</button></header>`;

  function openSpaces() {
    const items = spaces();
    sheet(`${sheetHeader("Escolher espaço financeiro", "Cada espaço mantém valores e contas separados.")}
      <div class="modal-body"><div class="financial-space-list">${items.map((space) => `<article class="financial-space-option ${!state.consolidated && space.id === state.selectedSpaceId ? "active" : ""}"><button type="button" data-financial-select-space="${esc(space.id)}"><span>${icon(space.icon || "wallet")}</span><b>${esc(space.name)}</b><small>${space.type === "business" ? "Negócio" : space.type === "personal" ? "Pessoal" : "Outro"} · ${automationLabel(space)}</small>${icon("chevron-right")}</button><button type="button" class="financial-space-manage" data-financial-manage-space="${esc(space.id)}" aria-label="Gerenciar ${esc(space.name)}">${icon("settings-2")}</button></article>`).join("")}
      <button type="button" data-financial-open-consolidated class="${state.consolidated ? "active" : ""}"><span>${icon("layout-dashboard")}</span><b>Visão consolidada</b><small>Somente leitura</small>${icon("chevron-right")}</button></div></div>
      <footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-create-space="personal">${icon("plus")} Criar novo espaço</button></footer>`);
    modal().querySelectorAll("[data-financial-select-space]").forEach((button) => button.onclick = async () => {
      state.consolidated = false;
      state.selectedSpaceId = button.dataset.financialSelectSpace;
      window.FinancialSpaceService.selectSpace(state.selectedSpaceId);
      closeModal();
      await refresh();
    });
    modal().querySelector("[data-financial-open-consolidated]").onclick = openConsolidated;
    modal().querySelector("[data-financial-create-space]").onclick = () => openCreateSpace("personal");
    modal().querySelectorAll("[data-financial-manage-space]").forEach((button) => button.onclick = () => openManageSpace(button.dataset.financialManageSpace));
  }

  function openManageSpace(spaceId) {
    const space = spaces().find((item) => item.id === spaceId);
    if (!space) return;
    const current = automation(space), businessLinked = space.type === "business" && Boolean(space.linkedBusinessId),
      activated = current.activatedAt ? fullDateLabel(current.activatedAt) : "Ao ativar";
    sheet(`${sheetHeader("Gerenciar espaço financeiro", space.name)}
      <form data-financial-automation-form><div class="modal-body"><section class="financial-automation-card"><header><span>${icon(businessLinked ? "cloud-cog" : "pencil-line")}</span><div><h4>Automação financeira</h4><p>${businessLinked ? `Negócio vinculado: ${esc(space.name)}` : "Este espaço recebe lançamentos manuais."}</p></div><b class="financial-origin-badge ${current.enabled ? "is-automatic" : ""}">${current.enabled ? "Ativa" : "Manual"}</b></header>${businessLinked ? `<label class="financial-automation-option"><span><b>Automação ativa</b><small>Receitas confirmadas entram sem lançamento manual.</small></span><input type="checkbox" name="enabled" ${current.enabled ? "checked" : ""}></label><label class="financial-automation-option"><span><b>Vendas pagas</b><small>PIX, dinheiro e cartão já confirmados.</small></span><input type="checkbox" name="sales" ${current.autoIncome.sales ? "checked" : ""}></label><label class="financial-automation-option"><span><b>Pagamentos de clientes</b><small>Inclui recebimentos parciais de fiado e saldo legado.</small></span><input type="checkbox" name="customerPayments" ${current.autoIncome.customerPayments ? "checked" : ""}></label><label class="financial-automation-option"><span><b>Pedidos online pagos</b><small>Somente quando convertidos em uma venda paga confirmada.</small></span><input type="checkbox" name="onlineOrders" ${current.autoIncome.onlineOrders ? "checked" : ""}></label><p class="financial-activation-note">${icon("calendar-check")} Início da automação: <b>${esc(activated)}</b>. Movimentos anteriores não são importados.</p>` : `<div class="financial-wizard-info">${icon("info")} Casa, Carro e outros espaços permanecem manuais por padrão.</div>`}</section></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Voltar</button>${businessLinked ? '<button class="btn btn-primary" type="submit">Salvar automação</button>' : ""}</footer></form>`);
    const form = modal().querySelector("[data-financial-automation-form]");
    if (businessLinked) form.onsubmit = async (event) => {
      event.preventDefault();
      const values = new FormData(form), submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      try {
        await window.FinancialSpaceService.updateAutomation(space.id, {
          enabled: values.get("enabled") === "on",
          sales: values.get("sales") === "on",
          customerPayments: values.get("customerPayments") === "on",
          onlineOrders: values.get("onlineOrders") === "on",
        });
        await window.FinancialSpaceService.reconcileBusinessIncome(space.id, { force: true });
        closeModal();
        Utils.toast("Automação financeira atualizada.");
        await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  function openConsolidated() {
    const selected = new Set(window.FinancialSpaceService.selectedConsolidatedIds());
    sheet(`${sheetHeader("Visão consolidada", "Escolha explicitamente quais espaços deseja somar.")}
      <form data-financial-consolidated-form><div class="modal-body financial-check-list">${spaces().map((space) => `<label><input type="checkbox" name="spaceId" value="${esc(space.id)}" ${selected.has(space.id) ? "checked" : ""}><span>${icon(space.icon || "wallet")}<b>${esc(space.name)}</b><small>${space.type === "business" ? "Negócio" : space.type === "personal" ? "Pessoal" : "Outro"}</small></span></label>`).join("")}</div>
      <footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Aplicar visão</button></footer></form>`);
    modal().querySelector("[data-financial-consolidated-form]").onsubmit = async (event) => {
      event.preventDefault();
      const ids = [...new FormData(event.currentTarget).getAll("spaceId")];
      if (!ids.length) return Utils.toast("Escolha pelo menos um espaço.", true);
      window.FinancialSpaceService.setConsolidatedIds(ids);
      state.consolidated = true;
      closeModal();
      await refresh();
    };
  }

  function openPeriod() {
    sheet(`${sheetHeader("Escolher período", "O resultado usa apenas lançamentos realizados no mês.")}
      <form data-financial-period-form><div class="modal-body"><label class="financial-field"><span>Mês</span><input type="month" name="period" value="${esc(state.period)}" required></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Aplicar período</button></footer></form>`);
    modal().querySelector("[data-financial-period-form]").onsubmit = async (event) => {
      event.preventDefault();
      const period = String(new FormData(event.currentTarget).get("period") || "");
      Engine.monthRange(period);
      state.period = period;
      closeModal();
      await refresh();
    };
  }

  function openCreateSpace(initialType = "personal") {
    const business = window.BusinessContext?.get?.().business;
    sheet(`${sheetHeader("Criar espaço financeiro", "Negócio, pessoal ou outro projeto.")}
      <form data-financial-space-form><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Nome *</span><input name="name" maxlength="80" placeholder="Ex.: Casa" required></label><label class="financial-field"><span>Tipo *</span><select name="type"><option value="business" ${initialType === "business" ? "selected" : ""}>Negócio</option><option value="personal" ${initialType === "personal" ? "selected" : ""}>Pessoal</option><option value="other" ${initialType === "other" ? "selected" : ""}>Outro</option></select></label><label class="financial-field" data-linked-business><span>Empresa vinculada</span><select name="linkedBusinessId"><option value="${esc(business?.id || "")}">${esc(business?.name || "Empresa atual")}</option></select></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Criar espaço</button></footer></form>`);
    const form = modal().querySelector("[data-financial-space-form]"), toggle = () => modal().querySelector("[data-linked-business]").hidden = form.type.value !== "business";
    form.type.onchange = toggle; toggle();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector("[type=submit]"), values = Object.fromEntries(new FormData(form));
      submit.disabled = true;
      try {
        const space = await window.FinancialSpaceService.createSpace({ name: values.name, type: values.type, linkedBusinessId: values.type === "business" ? values.linkedBusinessId : null });
        state.consolidated = false;
        state.selectedSpaceId = space.id;
        closeModal();
        await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  function openCreateFinancialAccount(onCreated = null) {
    if (state.consolidated) return Utils.toast("Escolha um espaço para cadastrar a conta.", true);
    sheet(`${sheetHeader("Nova conta ou carteira", "Use somente contas deste espaço financeiro.")}<form data-financial-account-create><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Nome *</span><input name="name" maxlength="80" placeholder="Ex.: C6 Bank" required></label><label class="financial-field"><span>Tipo *</span><select name="type"><option value="checking">Conta bancária</option><option value="cash">Dinheiro</option><option value="wallet">Carteira digital</option><option value="savings">Poupança</option><option value="other">Outra</option></select></label><label class="financial-field"><span>Instituição</span><input name="institution" maxlength="80" placeholder="Ex.: C6 Bank"></label><label class="financial-field full"><span>Saldo inicial</span><input name="initialBalance" inputmode="decimal" value="0,00"><small>Opcional e manual; não consultamos seu banco.</small></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Criar conta</button></footer></form>`);
    const form = modal().querySelector("[data-financial-account-create]");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form)), submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      try {
        const initialBalanceText = String(values.initialBalance || "").trim(),
          initialBalanceCents = !initialBalanceText || /^0+(?:[.,]0+)?$/.test(initialBalanceText) ? 0 : Engine.moneyInputToCents(initialBalanceText),
          account = await window.FinancialSpaceService.createFinancialAccount(state.selectedSpaceId, { ...values, initialBalanceCents });
        closeModal();
        Utils.toast("Conta criada.");
        if (onCreated) await onCreated(account); else await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  async function openCreateCreditCard(onCreated = null, existing = null) {
    if (state.consolidated) return Utils.toast("Escolha um espaço para cadastrar o cartão.", true);
    const service = window.FinancialSpaceService, homeSpaceId = existing?.cardHomeSpaceId || state.selectedSpaceId,
      homeSpace = spaces().find((space) => space.id === homeSpaceId) || selectedSpace(), accounts = await service.listFinancialAccounts(homeSpaceId),
      canShare = service.canShareCreditCards(homeSpaceId), availableSpaces = spaces().filter((space) => space.ownerUid === homeSpace?.ownerUid),
      normalized = Engine.normalizeCreditCardAccess(existing || {}, homeSpaceId), draft = {
        step: 1,
        name: existing?.name || "",
        institution: existing?.institution || existing?.issuer || "",
        last4: existing?.last4 || "",
        limit: existing ? (Number(existing.limitCents || 0) / 100).toFixed(2).replace(".", ",") : "",
        closingDay: existing?.closingDay || "",
        dueDay: existing?.dueDay || "",
        paymentAccountId: existing?.paymentAccountId || "",
        accessMode: existing ? normalized.accessMode : "",
        allowedFinancialSpaceIds: existing ? [...normalized.allowedFinancialSpaceIds] : [],
        defaultFinancialSpaceId: existing ? normalized.defaultFinancialSpaceId : state.selectedSpaceId,
      };
    sheet(`<div data-credit-card-wizard></div>`, "financial-card-wizard");
    const host = modal().querySelector("[data-credit-card-wizard]"), sync = () => {
      host.querySelectorAll("input,select").forEach((field) => { draft[field.name] = field.value; });
    }, renderCardWizard = () => {
      const accessLabel = draft.accessMode === "all_spaces" ? "Todos os meus espaços" : draft.accessMode === "selected_spaces"
        ? `${draft.allowedFinancialSpaceIds.length} espaços selecionados` : `Somente ${spaces().find((space) => space.id === draft.defaultFinancialSpaceId)?.name || "este espaço"}`;
      const steps = [
        `<div class="modal-body financial-wizard-body"><h3>Qual é o cartão?</h3><p>Esses dados ajudam a identificar a fatura.</p><div class="financial-form-grid"><label class="financial-field full"><span>Nome do cartão *</span><input name="name" maxlength="80" value="${esc(draft.name)}" placeholder="Ex.: C6 Carbon"></label><label class="financial-field"><span>Banco/instituição</span><input name="institution" maxlength="80" value="${esc(draft.institution)}" placeholder="Ex.: C6 Bank"></label><label class="financial-field"><span>Final do cartão *</span><input name="last4" inputmode="numeric" maxlength="4" value="${esc(draft.last4)}" placeholder="2429"></label></div></div>`,
        `<div class="modal-body financial-wizard-body"><h3>Como funciona a fatura?</h3><p>A VECONI usará estes dias para escolher a fatura automaticamente.</p><div class="financial-form-grid"><label class="financial-field full"><span>Limite total *</span><input name="limit" inputmode="decimal" value="${esc(draft.limit)}" placeholder="R$ 8.000,00"></label><label class="financial-field"><span>Fecha no dia *</span><input name="closingDay" type="number" min="1" max="31" value="${esc(draft.closingDay)}" placeholder="12"></label><label class="financial-field"><span>Vence no dia *</span><input name="dueDay" type="number" min="1" max="31" value="${esc(draft.dueDay)}" placeholder="20"></label></div><div class="financial-wizard-info">${icon("calendar-check")} Dias 29, 30 e 31 usam o último dia válido nos meses menores.</div></div>`,
        `<div class="modal-body financial-wizard-body"><h3>Onde este cartão pode ser usado?</h3><p>O cartão continua único; cada compra pertence ao espaço escolhido.</p><div class="financial-card-access-picker">${canShare ? `<button type="button" data-card-access="all_spaces" class="${draft.accessMode === "all_spaces" ? "active" : ""}">${icon("layers-3")}<span><b>Todos os meus espaços</b><small>Disponível nos seus espaços financeiros.</small></span>${draft.accessMode === "all_spaces" ? icon("circle-check") : ""}</button><button type="button" data-card-access="selected_spaces" class="${draft.accessMode === "selected_spaces" ? "active" : ""}">${icon("list-checks")}<span><b>Espaços selecionados</b><small>Escolha exatamente onde ele aparece.</small></span>${draft.accessMode === "selected_spaces" ? icon("circle-check") : ""}</button>` : ""}<button type="button" data-card-access="single_space" class="${draft.accessMode === "single_space" ? "active" : ""}">${icon("lock-keyhole")}<span><b>Somente este espaço</b><small>Uso exclusivo em ${esc(selectedSpace()?.name || "este espaço")}.</small></span>${draft.accessMode === "single_space" ? icon("circle-check") : ""}</button></div>${draft.accessMode === "selected_spaces" ? `<section class="financial-space-checks"><b>Escolha os espaços</b>${availableSpaces.map((space) => `<button type="button" data-card-space="${esc(space.id)}" class="${draft.allowedFinancialSpaceIds.includes(space.id) ? "active" : ""}">${icon(draft.allowedFinancialSpaceIds.includes(space.id) ? "square-check-big" : "square")}<span>${esc(space.name)}<small>${space.type === "business" ? "Negócio" : space.type === "personal" ? "Pessoal" : "Outro"}</small></span></button>`).join("")}</section>` : ""}<div class="financial-wizard-info">${icon("shield-check")} Compartilhar um cartão não transfere acesso nem expõe outros espaços.</div></div>`,
        `<div class="modal-body financial-wizard-body"><h3>Conferir cartão</h3><p>Compras de espaços diferentes irão para a mesma fatura real.</p><article class="financial-wizard-review"><header><span>${icon("credit-card")}</span><div><b>${esc(draft.name || "Cartão")}</b><strong>•••• ${esc(draft.last4 || "0000")}</strong></div></header><dl><div><dt>Instituição</dt><dd>${esc(draft.institution || "Não informada")}</dd></div><div><dt>Limite</dt><dd>${draft.limit ? money(Engine.moneyInputToCents(draft.limit)) : "—"}</dd></div><div><dt>Fechamento</dt><dd>Dia ${esc(draft.closingDay)}</dd></div><div><dt>Vencimento</dt><dd>Dia ${esc(draft.dueDay)}</dd></div><div><dt>Disponibilidade</dt><dd>${esc(accessLabel)}</dd></div><div><dt>Conta para pagamento</dt><dd>${esc(accounts.find((item) => item.id === draft.paymentAccountId)?.name || "Escolher ao pagar")}</dd></div></dl></article><label class="financial-field"><span>Conta padrão para pagar <small>(opcional)</small></span><select name="paymentAccountId"><option value="">Escolher ao pagar</option>${accounts.map((account) => `<option value="${esc(account.id)}" ${account.id === draft.paymentAccountId ? "selected" : ""}>${esc(account.name)}</option>`).join("")}</select></label></div>`,
      ];
      host.innerHTML = `<header class="modal-head financial-wizard-head"><div><small>Passo ${draft.step} de 4</small><div class="financial-wizard-progress">${[1, 2, 3, 4].map((step) => `<i class="${step <= draft.step ? "active" : ""}"></i>`).join("")}</div></div><button class="icon-btn" type="button" data-financial-close>${icon("x")}</button></header>${steps[draft.step - 1]}<footer class="modal-foot"><button class="btn btn-light" type="button" data-card-back>${draft.step === 1 ? "Cancelar" : "Voltar"}</button><button class="btn btn-primary" type="button" data-card-next>${draft.step === 4 ? existing ? "Salvar cartão" : "Criar cartão" : "Continuar"}</button></footer>`;
      host.querySelector("[data-financial-close]").onclick = closeModal;
      host.querySelector("[data-card-back]").onclick = () => { sync(); if (draft.step === 1) closeModal(); else { draft.step--; renderCardWizard(); } };
      host.querySelectorAll("[data-card-access]").forEach((button) => button.onclick = () => { sync(); draft.accessMode = button.dataset.cardAccess; if (draft.accessMode === "single_space") { draft.defaultFinancialSpaceId = state.selectedSpaceId; draft.allowedFinancialSpaceIds = [state.selectedSpaceId]; } renderCardWizard(); });
      host.querySelectorAll("[data-card-space]").forEach((button) => button.onclick = () => { sync(); const id = button.dataset.cardSpace; draft.allowedFinancialSpaceIds = draft.allowedFinancialSpaceIds.includes(id) ? draft.allowedFinancialSpaceIds.filter((value) => value !== id) : [...draft.allowedFinancialSpaceIds, id]; renderCardWizard(); });
      host.querySelector("[data-card-next]").onclick = async (event) => {
        sync();
        try {
          if (draft.step === 1 && (!draft.name.trim() || !/^\d{4}$/.test(draft.last4))) throw new Error("Informe o nome e os 4 últimos dígitos.");
          if (draft.step === 2) { Engine.moneyInputToCents(draft.limit); if (!(Number(draft.closingDay) >= 1 && Number(draft.closingDay) <= 31 && Number(draft.dueDay) >= 1 && Number(draft.dueDay) <= 31)) throw new Error("Revise fechamento e vencimento."); }
          if (draft.step === 3 && (!draft.accessMode || (draft.accessMode === "selected_spaces" && !draft.allowedFinancialSpaceIds.length))) throw new Error("Escolha onde o cartão poderá ser usado.");
          if (draft.step < 4) { draft.step++; renderCardWizard(); return; }
          event.currentTarget.disabled = true;
          const payload = { ...draft, limitCents: Engine.moneyInputToCents(draft.limit) }, card = existing
            ? await service.updateCreditCard(homeSpaceId, existing.id, payload)
            : await service.createCreditCard(state.selectedSpaceId, payload);
          closeModal();
          Utils.toast(existing ? "Cartão atualizado." : "Cartão criado.");
          if (onCreated) await onCreated(card); else await refresh();
        } catch (error) { Utils.toast(error.message, true); event.currentTarget.disabled = false; }
      };
      window.lucide?.createIcons();
    };
    renderCardWizard();
  }

  async function openCreditCardInvoice(invoiceId, cardHomeSpaceId = "") {
    if (!invoiceId) return;
    try {
      const details = await window.FinancialSpaceService.getCreditCardInvoiceDetails(state.selectedSpaceId, invoiceId, { cardHomeSpaceId }), invoice = details.invoice,
        currentSpaceAmount = details.spaceBreakdown.find((item) => item.id === state.selectedSpaceId)?.amountCents || 0,
        breakdown = (items, empty) => items.length ? `<div class="financial-breakdown-list">${items.map((item) => `<article><div><b>${esc(item.name)}</b><small>${item.percentage}%</small></div><span><i style="width:${Math.max(4, item.percentage)}%"></i></span><strong>${money(item.amountCents)}</strong></article>`).join("")}</div>` : `<p>${esc(empty)}</p>`;
      sheet(`${sheetHeader(`Fatura ${invoice.cardName || "Cartão"}`, `${monthLabel(invoice.referenceKey)} · vence ${fullDateLabel(invoice.dueDate)}`)}<div class="modal-body"><article class="financial-invoice-summary"><div><small>Total consolidado</small><strong>${money(invoice.amountDueCents)}</strong></div><div><small>Deste espaço</small><strong>${money(currentSpaceAmount)}</strong></div><div><small>Restante</small><strong>${money(invoice.remainingCents)}</strong></div><em class="financial-status is-${invoice.status === "paid" ? "paid" : invoice.status === "overdue" ? "overdue" : "pending"}">${esc(invoiceStatusLabel[invoice.status] || invoice.status)}</em></article><nav class="financial-invoice-tabs" aria-label="Detalhes da fatura"><button type="button" class="active" data-invoice-tab="summary">Resumo</button><button type="button" data-invoice-tab="categories">Categorias</button><button type="button" data-invoice-tab="spaces">Espaços</button><button type="button" data-invoice-tab="purchases">Compras</button></nav><section data-invoice-panel="summary"><div class="financial-account-details"><span>${icon("layers-3")} Espaços usados <b>${details.spaceBreakdown.length}</b></span><span>${icon("receipt-text")} Compras <b>${details.purchases.length}</b></span><span>${icon("circle-check-big")} Pago <b>${money(invoice.paidTotalCents)}</b></span></div>${details.payments.length ? `<section class="financial-invoice-purchases"><h4>Pagamentos</h4>${details.payments.map((payment) => `<article><span><b>${esc(paymentLabel[payment.paymentMethod] || "Pagamento")}</b><small>${fullDateLabel(payment.paidAt)}</small></span><strong>${money(payment.amountCents)}</strong></article>`).join("")}</section>` : ""}</section><section data-invoice-panel="categories" hidden><h4>Categorias</h4>${breakdown(details.categoryBreakdown, "Nenhuma categoria nesta fatura.")}</section><section data-invoice-panel="spaces" hidden><h4>Espaços</h4>${breakdown(details.spaceBreakdown, "Nenhum espaço nesta fatura.")}</section><section data-invoice-panel="purchases" hidden class="financial-invoice-purchases"><h4>Compras</h4>${details.purchases.length ? details.purchases.map((purchase) => `<article><span><b>${esc(purchase.description)}</b><small>${dateLabel(purchase.purchaseDate)} · ${esc(purchase.financialSpaceName || "Espaço")} · ${esc(purchase.categoryName || "Outros")}${purchase.installmentCount > 1 ? ` · ${purchase.installmentNumber}/${purchase.installmentCount}` : ""}</small></span><strong>${money(purchase.amountCents)}</strong></article>`).join("") : `<p>Nenhuma compra nesta fatura.</p>`}</section></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Fechar</button>${invoice.remainingCents > 0 ? `<button class="btn btn-primary" type="button" data-financial-pay-invoice="${esc(invoice.id)}">Pagar fatura</button>` : ""}</footer>`, "financial-invoice-sheet");
      modal().querySelectorAll("[data-invoice-tab]").forEach((button) => button.onclick = () => {
        modal().querySelectorAll("[data-invoice-tab]").forEach((item) => item.classList.toggle("active", item === button));
        modal().querySelectorAll("[data-invoice-panel]").forEach((panel) => { panel.hidden = panel.dataset.invoicePanel !== button.dataset.invoiceTab; });
      });
      modal().querySelector("[data-financial-pay-invoice]")?.addEventListener("click", () => openCreditCardInvoicePayment(invoice));
    } catch (error) { Utils.toast(error.message, true); }
  }

  async function openCreditCardInvoicePayment(invoice) {
    const accounts = await window.FinancialSpaceService.listFinancialAccounts(state.selectedSpaceId);
    if (!accounts.length) return openCreateFinancialAccount(() => openCreditCardInvoicePayment(invoice));
    const operationId = crypto.randomUUID();
    sheet(`${sheetHeader("Pagar fatura", "O pagamento será saída de caixa, sem repetir as despesas.")}<form data-financial-invoice-payment><div class="modal-body financial-form-grid"><article class="financial-payment-balance full"><small>Saldo da fatura</small><strong>${money(invoice.remainingCents)}</strong></article><label class="financial-field full"><span>Conta de origem *</span><select name="financialAccountId">${accounts.map((account) => `<option value="${esc(account.id)}">${esc(account.name)}</option>`).join("")}</select></label><label class="financial-field"><span>Valor *</span><input name="amount" inputmode="decimal" value="${(invoice.remainingCents / 100).toFixed(2).replace(".", ",")}" required></label><label class="financial-field"><span>Data *</span><input type="date" name="paidAt" value="${Engine.localIsoDate()}" required></label><label class="financial-field full"><span>Forma *</span><select name="paymentMethod"><option value="pix">Pix</option><option value="automatic_debit">Débito automático</option><option value="transfer">Transferência</option><option value="cash">Dinheiro</option><option value="debit_card">Débito</option><option value="other">Outro</option></select></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Confirmar pagamento</button></footer></form>`);
    const form = modal().querySelector("[data-financial-invoice-payment]");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form)), amountCents = Engine.moneyInputToCents(values.amount), submit = form.querySelector("[type=submit]");
      if (amountCents > invoice.remainingCents) return Utils.toast("O pagamento não pode ser maior que o saldo da fatura.", true);
      submit.disabled = true;
      try {
        await window.FinancialSpaceService.payCreditCardInvoice(state.selectedSpaceId, invoice.id, { ...values, cardHomeSpaceId: invoice.cardHomeSpaceId, operationId, amountCents, paidAt: new Date(`${values.paidAt}T12:00:00`).toISOString() });
        closeModal();
        Utils.toast(amountCents === invoice.remainingCents ? "Fatura paga." : "Pagamento parcial registrado.");
        await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  async function openEntryForm(direction = "out") {
    if (state.consolidated) return Utils.toast("Escolha um espaço antes de lançar uma movimentação.", true);
    const service = window.FinancialSpaceService, categoryItems = await service.listCategories(state.selectedSpaceId), isExpense = direction === "out",
      cards = isExpense ? (state.dashboard?.creditCards?.length ? structuredClone(state.dashboard.creditCards) : await service.listCreditCards(state.selectedSpaceId)) : [], categories = categoryItems.filter((item) => item.type === "category"), draft = {
        step: 1,
        description: "",
        amount: "",
        categoryId: "",
        subcategoryId: "",
        customCategoryName: "",
        customSubcategoryName: "",
        entryType: isExpense ? "expense" : "manual_income",
        scheduleMode: "once",
        frequency: "monthly",
        installmentCount: 1,
        dueAt: Engine.localIsoDate(),
        paymentChoice: isExpense ? "pending" : "pix",
        creditCardId: cards[0]?.id || "",
        cardHomeSpaceId: cards[0]?.cardHomeSpaceId || "",
        purchaseDate: Engine.localIsoDate(),
        paidNow: !isExpense,
        paymentMethod: "pix",
        paidAt: Engine.localIsoDate(),
        notes: "",
        attachment: null,
        showAllCategories: false,
        showAllSubcategories: false,
        categorySearch: "",
        operationId: `financial_entry_${crypto.randomUUID()}`,
    };
    sheet(`<div data-financial-entry-wizard></div>`, "financial-entry-wizard");
    let host = modal().querySelector("[data-financial-entry-wizard]");
    const selectedCategory = () => categories.find((item) => item.id === draft.categoryId) || null;
    const selectedSubcategory = () => categoryItems.find((item) => item.id === draft.subcategoryId) || null;
    const subcategories = () => draft.categoryId ? Engine.subcategoriesFor(categoryItems, draft.categoryId) : [];
    const scheduleLabel = () => draft.scheduleMode === "recurring"
      ? ({ weekly: "Toda semana", biweekly: "A cada 15 dias", monthly: "Todo mês", yearly: "Todo ano" })[draft.frequency]
      : draft.scheduleMode === "installments" ? `${draft.installmentCount} parcelas` : "Uma vez";
    const syncVisibleFields = () => {
      const read = (name) => host.querySelector(`[name="${name}"]`)?.value;
      for (const name of ["description", "amount", "customCategoryName", "customSubcategoryName", "frequency", "dueAt", "paymentMethod", "paidAt", "purchaseDate", "creditCardId", "notes", "categorySearch"])
        if (read(name) !== undefined) draft[name] = read(name);
      const count = read("installmentCount");
      if (count !== undefined) draft.installmentCount = Math.min(60, Math.max(1, Number(count || 1)));
      const attachment = host.querySelector('[name="attachment"]')?.files?.[0];
      if (attachment) draft.attachment = attachment;
    };
    const progress = () => `<div class="financial-wizard-progress" aria-label="Passo ${draft.step} de 4">${[1, 2, 3, 4].map((step) => `<i class="${step <= draft.step ? "active" : ""}"></i>`).join("")}</div>`;
    const categoryCards = () => {
      const normalize = (value) => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR"), query = normalize(draft.categorySearch),
        filtered = query ? categories.filter((item) => normalize(item.name).includes(query)) : categories,
        visible = draft.showAllCategories ? filtered : categories.slice(0, 6);
      return `${draft.showAllCategories ? `<label class="financial-category-search">${icon("search")}<input name="categorySearch" value="${esc(draft.categorySearch)}" placeholder="Buscar categoria"></label>` : ""}<div class="financial-category-picker">${visible.map((category) => `<button type="button" data-wizard-category="${esc(category.id)}" data-category-label="${esc(normalize(category.name))}" class="${draft.categoryId === category.id && !draft.customCategoryName ? "active" : ""}">${icon(category.icon || "shapes")}<span>${esc(category.name)}</span></button>`).join("")}${visible.length ? "" : `<p class="financial-picker-empty">Nenhuma categoria encontrada.</p>`}<button type="button" data-wizard-custom-category class="is-create ${draft.customCategoryName ? "active" : ""}">${icon("plus")}<span>Criar categoria</span></button></div>${categories.length > 6 ? `<button type="button" class="financial-picker-more" data-wizard-more-categories>${draft.showAllCategories ? "Mostrar principais" : "Ver mais categorias"}</button>` : ""}`;
    };
    const subcategoryPicker = () => {
      if (!draft.categoryId && !draft.customCategoryName) return "";
      const items = subcategories(), visible = draft.showAllSubcategories ? items : items.slice(0, 6);
      return `<section class="financial-wizard-subcategory"><header><b>Subcategoria <small>(opcional)</small></b><span>Detalhe somente se fizer sentido.</span></header><div class="financial-subcategory-picker"><button type="button" data-wizard-subcategory="" class="${!draft.subcategoryId && !draft.customSubcategoryName ? "active" : ""}">Sem detalhar</button>${visible.map((item) => `<button type="button" data-wizard-subcategory="${esc(item.id)}" class="${draft.subcategoryId === item.id && !draft.customSubcategoryName ? "active" : ""}">${esc(item.name)}</button>`).join("")}<button type="button" data-wizard-custom-subcategory class="is-create ${draft.customSubcategoryName ? "active" : ""}">${icon("plus")} Criar subcategoria</button></div>${items.length > 6 ? `<button type="button" class="financial-picker-more" data-wizard-more-subcategories>${draft.showAllSubcategories ? "Mostrar principais" : "Ver mais"}</button>` : ""}${draft.customSubcategoryName !== "" ? `<label class="financial-field"><span>Nome da subcategoria</span><input name="customSubcategoryName" maxlength="60" value="${esc(draft.customSubcategoryName)}" placeholder="Ex.: Aluguel"></label>` : ""}</section>`;
    };
    const stepOne = () => `<div class="modal-body financial-wizard-body"><h3>O que você vai registrar?</h3><p>Informe o que exatamente está pagando e a qual área pertence.</p><div class="financial-form-grid"><label class="financial-field full"><span>${isExpense ? "Nome da despesa" : "Nome da entrada"} *</span><input name="description" maxlength="160" value="${esc(draft.description)}" placeholder="Ex.: Aluguel + condomínio" required></label><label class="financial-field full"><span>Valor *</span><input name="amount" inputmode="decimal" value="${esc(draft.amount)}" placeholder="R$ 0,00" required></label></div><section class="financial-wizard-category"><header><b>Categoria *</b><span>A área ampla desta ${isExpense ? "despesa" : "entrada"}.</span></header>${categoryCards()}${draft.customCategoryName !== "" ? `<label class="financial-field"><span>Nome da nova categoria</span><input name="customCategoryName" maxlength="60" value="${esc(draft.customCategoryName)}" placeholder="Ex.: Impressão 3D"></label>` : ""}</section>${subcategoryPicker()}${isExpense ? `<section class="financial-wizard-type"><b>Tipo *</b><div><button type="button" data-wizard-entry-type="expense" class="${draft.entryType === "expense" ? "active" : ""}">${icon("minus")}<span><strong>Despesa</strong><small>Sai do seu dinheiro</small></span></button><button type="button" data-wizard-entry-type="investment" class="${draft.entryType === "investment" ? "active" : ""}">${icon("chart-no-axes-column-increasing")}<span><strong>Investimento</strong><small>Gera valor no futuro</small></span></button></div></section>` : ""}</div>`;
    const paymentChoices = () => {
      const choices = isExpense ? [
        ["pix", "scan-line", "PIX / Transferência", "Pago agora"], ["cash", "banknote", "Dinheiro", "Pago agora"], ["debit_card", "credit-card", "Cartão de débito", "Pago agora"], ["credit_card", "calendar-range", "Cartão de crédito", "Vai para uma fatura"], ["pending", "clock-3", "Ainda vou pagar", "Conta a pagar"],
      ] : [["pix", "scan-line", "PIX / Transferência", "Recebido agora"], ["cash", "banknote", "Dinheiro", "Recebido agora"], ["pending", "clock-3", "Ainda vou receber", "Conta a receber"]];
      return choices.map(([id, iconName, title, helper]) => `<button type="button" data-wizard-payment="${id}" class="${draft.paymentChoice === id ? "active" : ""}">${icon(iconName)}<span><b>${title}</b><small>${helper}</small></span>${draft.paymentChoice === id ? icon("circle-check") : ""}</button>`).join("");
    };
    const stepTwo = () => `<div class="modal-body financial-wizard-body"><h3>Como você ${isExpense ? "pagou ou vai pagar" : "recebeu ou vai receber"}?</h3><p>Escolha o meio correto para separar gasto, caixa e fatura.</p><div class="financial-payment-method-cards">${paymentChoices()}</div>${draft.paymentChoice === "credit_card" ? `<div class="financial-wizard-info">${icon("info")} A compra vira gasto hoje. A saída de caixa acontecerá somente quando a fatura for paga.</div>` : ""}</div>`;
    const stepThree = () => {
      if (draft.paymentChoice === "credit_card") {
        const selected = cards.find((item) => item.id === draft.creditCardId && item.cardHomeSpaceId === draft.cardHomeSpaceId), preview = selected ? Engine.resolveCreditCardInvoiceForPurchase({ purchaseDate: `${draft.purchaseDate}T12:00:00`, closingDay: selected.closingDay, dueDay: selected.dueDay }) : null;
        return `<div class="modal-body financial-wizard-body"><h3>Qual cartão?</h3><p>Cartões compartilhados autorizados também aparecem aqui.</p>${cards.length ? `<div class="financial-card-choice">${cards.map((card) => `<button type="button" data-wizard-credit-card="${esc(card.id)}" data-card-home="${esc(card.cardHomeSpaceId)}" class="${draft.creditCardId === card.id && draft.cardHomeSpaceId === card.cardHomeSpaceId ? "active" : ""}">${icon("credit-card")}<span><b>${esc(card.name)} · •••• ${esc(card.last4)}</b><small>${esc(cardScopeLabel(card))} · ${card.currentInvoice ? `${money(card.currentInvoice.currentSpaceAmountCents || 0)} deste espaço` : `fecha dia ${card.closingDay}`}</small></span>${draft.creditCardId === card.id && draft.cardHomeSpaceId === card.cardHomeSpaceId ? icon("circle-check") : ""}</button>`).join("")}</div>` : `<div class="financial-empty-inline">${icon("credit-card")}<div><b>Nenhum cartão disponível</b><span>Cadastre um sem perder os dados já preenchidos.</span></div></div>`}<button type="button" class="btn btn-light financial-inline-create" data-wizard-create-card>${icon("plus")} Cadastrar cartão</button><div class="financial-form-grid"><label class="financial-field"><span>Data da compra *</span><input type="date" name="purchaseDate" value="${esc(draft.purchaseDate)}" required></label><label class="financial-field"><span>Parcelas *</span><input type="number" name="installmentCount" min="1" max="60" value="${draft.installmentCount}"></label></div>${preview ? `<article class="financial-invoice-preview">${icon("calendar-check")}<span><b>Fatura ${monthLabel(preview.referenceKey)}</b><small>Fecha ${dateLabel(preview.closingDate)} · vence ${dateLabel(preview.dueDate)}</small></span><strong>${money(Engine.moneyInputToCents(draft.amount))}</strong></article>` : ""}<label class="financial-field"><span>Observação <small>(opcional)</small></span><textarea name="notes" maxlength="500">${esc(draft.notes)}</textarea></label></div>`;
      }
      if (draft.paymentChoice === "pending") return `<div class="modal-body financial-wizard-body"><h3>Quando e como essa conta funciona?</h3><p>Vencimento só é pedido porque o dinheiro ainda não saiu.</p><div class="financial-schedule-picker"><button type="button" data-wizard-schedule="once" class="${draft.scheduleMode === "once" ? "active" : ""}">${icon("calendar")}<span><b>Uma vez</b><small>Uma única conta.</small></span></button><button type="button" data-wizard-schedule="recurring" class="${draft.scheduleMode === "recurring" ? "active" : ""}">${icon("refresh-cw")}<span><b>Recorrente</b><small>Repete até cancelar.</small></span></button><button type="button" data-wizard-schedule="installments" class="${draft.scheduleMode === "installments" ? "active" : ""}">${icon("list-ordered")}<span><b>Parcelada</b><small>Várias contas mensais.</small></span></button></div><div class="financial-form-grid"><label class="financial-field full"><span>Primeiro vencimento *</span><input type="date" name="dueAt" value="${esc(draft.dueAt)}" required></label>${draft.scheduleMode === "recurring" ? `<label class="financial-field full"><span>Repete *</span><select name="frequency"><option value="weekly" ${draft.frequency === "weekly" ? "selected" : ""}>Semanalmente</option><option value="biweekly" ${draft.frequency === "biweekly" ? "selected" : ""}>Quinzenalmente</option><option value="monthly" ${draft.frequency === "monthly" ? "selected" : ""}>Mensalmente</option><option value="yearly" ${draft.frequency === "yearly" ? "selected" : ""}>Anualmente</option></select></label>` : ""}${draft.scheduleMode === "installments" ? `<label class="financial-field full"><span>Quantidade de parcelas *</span><input type="number" name="installmentCount" min="2" max="60" value="${Math.max(2, draft.installmentCount)}"></label>` : ""}</div><label class="financial-field"><span>Observação <small>(opcional)</small></span><textarea name="notes" maxlength="500">${esc(draft.notes)}</textarea></label></div>`;
      return `<div class="modal-body financial-wizard-body"><h3>${isExpense ? "Quando você pagou?" : "Quando você recebeu?"}</h3><p>Pagamento imediato entra no fluxo de caixa realizado.</p><div class="financial-form-grid">${draft.paymentChoice === "pix" ? `<label class="financial-field full"><span>Forma *</span><select name="paymentMethod"><option value="pix" ${draft.paymentMethod === "pix" ? "selected" : ""}>PIX</option><option value="transfer" ${draft.paymentMethod === "transfer" ? "selected" : ""}>Transferência</option></select></label>` : ""}<label class="financial-field full"><span>Data *</span><input type="date" name="paidAt" value="${esc(draft.paidAt)}" required></label></div><label class="financial-field"><span>Observação <small>(opcional)</small></span><textarea name="notes" maxlength="500">${esc(draft.notes)}</textarea></label><label class="financial-file"><input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf"><span>${icon("paperclip")}<b>${draft.attachment ? esc(draft.attachment.name) : "Anexar comprovante"}</b><small>JPG, PNG, WebP ou PDF · até 10 MB</small></span></label></div>`;
    };
    const stepFour = () => {
      const category = selectedCategory(), subcategory = selectedSubcategory(), categoryName = draft.customCategoryName || category?.name || "—", subcategoryName = draft.customSubcategoryName || subcategory?.name || "Sem detalhar",
        card = cards.find((item) => item.id === draft.creditCardId && item.cardHomeSpaceId === draft.cardHomeSpaceId), paymentDescription = draft.paymentChoice === "credit_card" ? `${card?.name || "Cartão"} · ${draft.installmentCount}x` : draft.paymentChoice === "pending" ? `Pendente · ${scheduleLabel()}` : paymentLabel[draft.paymentMethod] || "Pagamento imediato",
        dateDescription = draft.paymentChoice === "credit_card" ? `Compra em ${dateLabel(`${draft.purchaseDate}T12:00:00`)}` : draft.paymentChoice === "pending" ? `Vence ${dateLabel(`${draft.dueAt}T12:00:00`)}` : `Realizado em ${dateLabel(`${draft.paidAt}T12:00:00`)}`;
      return `<div class="modal-body financial-wizard-body"><h3>Conferir e salvar</h3><p>Revise as informações antes de criar.</p><article class="financial-wizard-review"><header><span>${icon(category?.icon || "receipt-text")}</span><div><b>${esc(draft.description)}</b><strong>${money(Engine.moneyInputToCents(draft.amount))}</strong></div></header><dl><div><dt>Categoria</dt><dd>${esc(categoryName)}</dd></div><div><dt>Subcategoria</dt><dd>${esc(subcategoryName)}</dd></div><div><dt>Tipo</dt><dd>${isExpense ? draft.entryType === "investment" ? "Investimento" : "Despesa" : "Entrada"}</dd></div><div><dt>Pagamento</dt><dd>${esc(paymentDescription)}</dd></div><div><dt>Data</dt><dd>${esc(dateDescription)}</dd></div><div><dt>Efeito no caixa</dt><dd>${draft.paymentChoice === "credit_card" || draft.paymentChoice === "pending" ? "Ainda não" : "Imediato"}</dd></div></dl></article>${draft.paymentChoice === "credit_card" ? `<div class="financial-wizard-success-note">${icon("shield-check")}<span><b>Sem despesa duplicada</b><small>A compra entra nos gastos; o pagamento da fatura entrará somente no caixa.</small></span></div>` : `<div class="financial-wizard-success-note">${icon("circle-check")}<span><b>${isExpense ? "Despesa" : "Entrada"} pronta para ser criada</b><small>Categoria, recorrência e tipo continuarão independentes.</small></span></div>`}</div>`;
    };
    const validateStep = () => {
      syncVisibleFields();
      if (draft.step === 1) {
        if (!draft.description.trim()) throw new Error(`Informe o nome da ${isExpense ? "despesa" : "entrada"}.`);
        Engine.moneyInputToCents(draft.amount);
        if (!draft.categoryId && !draft.customCategoryName.trim()) throw new Error("Escolha ou crie uma categoria.");
        if (draft.customCategoryName !== "" && !draft.customCategoryName.trim()) throw new Error("Informe o nome da nova categoria.");
        if (draft.customSubcategoryName !== "" && !draft.customSubcategoryName.trim()) throw new Error("Informe o nome da nova subcategoria.");
      }
      if (draft.step === 2 && !draft.paymentChoice) throw new Error("Escolha como o pagamento acontece.");
      if (draft.step === 3) {
        if (draft.paymentChoice === "credit_card" && (!draft.creditCardId || !draft.cardHomeSpaceId || !draft.purchaseDate)) throw new Error("Escolha o cartão e a data da compra.");
        if (draft.paymentChoice === "pending" && !draft.dueAt) throw new Error("Informe o primeiro vencimento.");
        if (!["credit_card", "pending"].includes(draft.paymentChoice) && !draft.paidAt) throw new Error("Informe a data do pagamento.");
      }
    };
    const renderWizard = () => {
      host.innerHTML = `<header class="modal-head financial-wizard-head"><div><small>Passo ${draft.step} de 4</small>${progress()}</div><button class="icon-btn" type="button" data-financial-close aria-label="Fechar">${icon("x")}</button></header>${[stepOne, stepTwo, stepThree, stepFour][draft.step - 1]()}<footer class="modal-foot"><button class="btn btn-light" type="button" data-wizard-back>${draft.step === 1 ? "Cancelar" : "Voltar"}</button><button class="btn btn-primary" type="button" data-wizard-next>${draft.step === 4 ? `Criar ${isExpense ? "despesa" : "entrada"}` : "Continuar"}</button></footer>`;
      host.querySelector("[data-financial-close]").onclick = closeModal;
      host.querySelector("[data-wizard-back]").onclick = () => { syncVisibleFields(); if (draft.step === 1) closeModal(); else { draft.step -= 1; renderWizard(); } };
      host.querySelectorAll("[data-wizard-category]").forEach((button) => button.onclick = () => { syncVisibleFields(); draft.categoryId = button.dataset.wizardCategory; draft.subcategoryId = ""; draft.customCategoryName = ""; draft.customSubcategoryName = ""; renderWizard(); });
      host.querySelector("[data-wizard-custom-category]")?.addEventListener("click", () => { syncVisibleFields(); draft.categoryId = ""; draft.subcategoryId = ""; draft.customCategoryName = draft.customCategoryName || " "; draft.customSubcategoryName = ""; renderWizard(); host.querySelector('[name="customCategoryName"]')?.focus(); });
      host.querySelectorAll("[data-wizard-subcategory]").forEach((button) => button.onclick = () => { syncVisibleFields(); draft.subcategoryId = button.dataset.wizardSubcategory; draft.customSubcategoryName = ""; renderWizard(); });
      host.querySelector("[data-wizard-custom-subcategory]")?.addEventListener("click", () => { syncVisibleFields(); draft.subcategoryId = ""; draft.customSubcategoryName = draft.customSubcategoryName || " "; renderWizard(); host.querySelector('[name="customSubcategoryName"]')?.focus(); });
      host.querySelector("[data-wizard-more-categories]")?.addEventListener("click", () => { syncVisibleFields(); draft.showAllCategories = !draft.showAllCategories; renderWizard(); });
      host.querySelector("[data-wizard-more-subcategories]")?.addEventListener("click", () => { syncVisibleFields(); draft.showAllSubcategories = !draft.showAllSubcategories; renderWizard(); });
      host.querySelectorAll("[data-wizard-entry-type]").forEach((button) => button.onclick = () => { draft.entryType = button.dataset.wizardEntryType; renderWizard(); });
      host.querySelectorAll("[data-wizard-schedule]").forEach((button) => button.onclick = () => { syncVisibleFields(); draft.scheduleMode = button.dataset.wizardSchedule; renderWizard(); });
      host.querySelectorAll("[data-wizard-payment]").forEach((button) => button.onclick = () => { syncVisibleFields(); draft.paymentChoice = button.dataset.wizardPayment; draft.paidNow = !["pending", "credit_card"].includes(draft.paymentChoice); draft.paymentMethod = draft.paymentChoice === "pix" ? (draft.paymentMethod === "transfer" ? "transfer" : "pix") : draft.paymentChoice; renderWizard(); });
      host.querySelectorAll("[data-wizard-credit-card]").forEach((button) => button.onclick = () => { syncVisibleFields(); draft.creditCardId = button.dataset.wizardCreditCard; draft.cardHomeSpaceId = button.dataset.cardHome; renderWizard(); });
      host.querySelector("[data-wizard-create-card]")?.addEventListener("click", () => { syncVisibleFields(); openCreateCreditCard(async (card) => { cards.push(card); draft.creditCardId = card.id; draft.cardHomeSpaceId = card.cardHomeSpaceId; sheet(`<div data-financial-entry-wizard></div>`, "financial-entry-wizard"); host = modal().querySelector("[data-financial-entry-wizard]"); renderWizard(); }); });
      host.querySelector('[name="categorySearch"]')?.addEventListener("input", (event) => {
        draft.categorySearch = event.currentTarget.value;
        const query = draft.categorySearch.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR");
        host.querySelectorAll("[data-wizard-category]").forEach((button) => button.hidden = !button.dataset.categoryLabel.includes(query));
      });
      host.querySelector("[data-wizard-next]").onclick = async (event) => {
        try {
          validateStep();
          if (draft.step < 4) { draft.step += 1; renderWizard(); return; }
          const submit = event.currentTarget;
          submit.disabled = true;
          let category = selectedCategory();
          if (draft.customCategoryName.trim()) category = await service.createCategory(state.selectedSpaceId, { name: draft.customCategoryName.trim() });
          let subcategory = selectedSubcategory();
          if (draft.customSubcategoryName.trim()) subcategory = await service.createCategory(state.selectedSpaceId, { name: draft.customSubcategoryName.trim(), parentCategoryId: category.id });
          const amountCents = Engine.moneyInputToCents(draft.amount), common = {
            direction, description: draft.description, entryType: draft.entryType,
            categoryId: category.id, categoryName: category.name, categoryIcon: category.icon,
            subcategoryId: subcategory?.id || null, subcategoryName: subcategory?.name || null,
            amountCents, notes: draft.notes,
          };
          let created, attachmentEntryId;
          if (draft.paymentChoice === "credit_card") {
            created = await service.createCreditCardPurchase(state.selectedSpaceId, {
              ...common,
              operationId: draft.operationId,
              creditCardId: draft.creditCardId,
              cardHomeSpaceId: draft.cardHomeSpaceId,
              purchaseDate: new Date(`${draft.purchaseDate}T12:00:00`).toISOString(),
              installmentCount: draft.installmentCount,
            });
            attachmentEntryId = created.entry.id;
          } else {
            const pending = draft.paymentChoice === "pending",
              occurredAt = new Date(`${pending ? draft.dueAt : draft.paidAt}T12:00:00`).toISOString();
            created = await service.createEntry(state.selectedSpaceId, {
              ...common,
              operationId: draft.operationId,
              dueAt: occurredAt,
              paidAt: occurredAt,
              occurredAt,
              paidNow: !pending,
              paymentMethod: pending ? null : draft.paymentMethod,
              frequency: pending && draft.scheduleMode === "recurring" ? draft.frequency : "none",
              installmentCount: pending && draft.scheduleMode === "installments" ? draft.installmentCount : 1,
            });
            attachmentEntryId = created[0].id;
          }
          if (draft.attachment && attachmentEntryId) await service.uploadAttachment(state.selectedSpaceId, attachmentEntryId, draft.attachment);
          closeModal();
          Utils.toast(`${isExpense ? "Despesa" : "Entrada"} salva com sucesso.`);
          await refresh();
        } catch (error) { Utils.toast(error.message, true); event.currentTarget.disabled = false; }
      };
      window.lucide?.createIcons();
    };
    renderWizard();
  }

  function openRegisterPayment(selectedEntry = null) {
    if (state.consolidated) return Utils.toast("Escolha um espaço para registrar o pagamento.", true);
    const entries = (state.dashboard?.payables || []).filter((entry) => entry.entityType !== "credit_card_invoice");
    if (!entries.length) return Utils.toast("Não existem contas pendentes neste espaço.");
    sheet(`${sheetHeader("Registrar pagamento", "Escolha a conta e confirme os dados reais do pagamento.")}
      <form data-financial-payment-form><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Conta *</span><select name="entryId">${entries.map((entry) => `<option value="${esc(entry.id)}"${selectedEntry?.id === entry.id ? " selected" : ""}>${esc(entry.description)} · ${money(entry.amountCents)}</option>`).join("")}</select></label><label class="financial-field"><span>Data *</span><input type="date" name="paidAt" value="${Engine.localIsoDate()}" required></label><label class="financial-field"><span>Forma *</span><select name="paymentMethod">${Object.entries(paymentLabel).map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select></label><label class="financial-field full"><span>Observação</span><textarea name="notes" maxlength="500"></textarea></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Confirmar pagamento</button></footer></form>`);
    const form = modal().querySelector("[data-financial-payment-form]");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form)), entry = entries.find((item) => item.id === values.entryId), submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      try {
        await window.FinancialSpaceService.markPaid(state.selectedSpaceId, entry, { paidAt: new Date(`${values.paidAt}T12:00:00`).toISOString(), paymentMethod: values.paymentMethod, notes: values.notes });
        closeModal(); Utils.toast("Pagamento registrado sem duplicar a saída."); await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  const frequencyLabel = (frequency) => ({ weekly: "Toda semana", biweekly: "A cada 15 dias", monthly: "Todo mês", yearly: "Todo ano" })[frequency] || "Sem recorrência";
  const entryOriginLabel = (entry) => entry.recurrenceId
    ? "Despesa recorrente"
    : entry.installmentGroupId ? "Despesa parcelada" : ({ sale: "Venda", sale_receipt: "Venda recebida", customer_payment: "Pagamento de cliente", customer_payment_reversal: "Estorno de pagamento", sale_reversal: "Estorno de venda", transfer: "Transferência", reversal: "Estorno", manual_income: "Entrada manual", investment: "Investimento" })[entry.sourceType] || "Despesa avulsa";

  async function openAccount(entry) {
    if (!entry) return;
    const systemControlled = entry.autoGenerated === true, editable = !systemControlled && entry.status === "pending", reversible = !systemControlled && entry.status === "paid" && !entry.reversedByEntryId && entry.sourceType !== "reversal";
    sheet(`${sheetHeader(systemControlled ? "Detalhes do lançamento" : "Detalhes da conta", `${money(entry.amountCents)} · ${statusLabel(entry)}`)}<div class="modal-body"><article class="financial-account-summary"><span>${icon(entry.categoryIcon || "receipt-text")}</span><div><h3>${esc(entry.description)}</h3><strong>${money(entry.amountCents)}</strong></div></article><div class="financial-account-details"><span>${icon("tag")} Categoria <b>${esc(entry.categoryName || "Outros")}</b></span><span>${icon("tags")} Subcategoria <b>${esc(entry.subcategoryName || "Sem detalhar")}</b></span><span>${icon("circle-dot")} Status <b>${statusLabel(entry)}</b></span><span>${icon("calendar-days")} ${entry.direction === "in" ? "Recebido em" : "Vencimento"} <b>${fullDateLabel(entry.occurredAt || entry.dueAt)}</b></span>${entry.paymentMethod ? `<span>${icon("wallet-cards")} Forma de pagamento <b>${esc(paymentLabel[entry.paymentMethod] || entry.paymentMethod)}</b></span>` : ""}<span>${icon("repeat")} Recorrência <b>${entry.recurrenceId ? frequencyLabel(entry.frequency) : "Não"}</b></span><span>${icon("file-clock")} Origem <b>${entryOriginLabel(entry)}</b></span></div>${systemControlled ? `<div class="financial-automation-note">${icon("shield-check")}<span><b>Lançamento automático</b><small>Para corrigir ou estornar, altere a venda ou o pagamento de origem. O Financeiro preservará o histórico.</small></span></div>` : ""}<div class="financial-account-actions">${editable ? `<button class="btn btn-primary" type="button" data-financial-account-pay>${icon("circle-check-big")} Marcar como paga</button><button class="btn btn-light" type="button" data-financial-account-edit>${icon("pencil")} Editar</button><button class="btn btn-light financial-danger-action" type="button" data-financial-account-cancel>${icon("trash-2")} Excluir</button>` : ""}${reversible ? `<button class="btn btn-light financial-danger-action" type="button" data-financial-account-reverse>${icon("undo-2")} Reverter lançamento</button>` : ""}${entry.recurrenceId ? `<button class="btn btn-light" type="button" data-financial-manage-recurrence>${icon("calendar-cog")} Gerenciar recorrência</button>` : ""}${systemControlled ? "" : `<label class="btn btn-light financial-attachment-action">${icon("paperclip")} Anexar comprovante<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden></label>`}</div></div>`);
    modal().querySelector("[data-financial-account-pay]")?.addEventListener("click", () => { closeModal(); openRegisterPayment(entry); });
    modal().querySelector("[data-financial-account-edit]")?.addEventListener("click", () => entry.recurrenceId ? openEditChoice(entry) : openEditAccount(entry, "occurrence"));
    modal().querySelector("[data-financial-account-cancel]")?.addEventListener("click", () => entry.recurrenceId ? openDeleteChoice(entry) : confirmOccurrenceCancellation(entry));
    modal().querySelector("[data-financial-account-reverse]")?.addEventListener("click", () => confirmPaidReversal(entry));
    modal().querySelector("[data-financial-manage-recurrence]")?.addEventListener("click", () => openManageRecurrence(entry));
    const fileInput = modal().querySelector(".financial-attachment-action input");
    if (fileInput) fileInput.onchange = async () => { const file = fileInput.files[0]; if (!file) return; try { await window.FinancialSpaceService.uploadAttachment(state.selectedSpaceId, entry.id, file); closeModal(); Utils.toast("Comprovante anexado."); await refresh(); } catch (error) { Utils.toast(error.message, true); } };
  }

  function openEditChoice(entry) {
    sheet(`${sheetHeader("O que deseja editar?", "Escolha o alcance da alteração na recorrência.")}<div class="modal-body financial-scope-actions"><button type="button" data-financial-edit-scope="occurrence">${icon("calendar-days")}<span><b>Somente esta conta</b><small>As demais ocorrências continuam iguais.</small></span></button><button type="button" data-financial-edit-scope="series">${icon("calendar-range")}<span><b>Esta e as próximas</b><small>O histórico anterior será preservado.</small></span></button></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Voltar</button></footer>`);
    modal().querySelector('[data-financial-edit-scope="occurrence"]').onclick = () => openEditAccount(entry, "occurrence");
    modal().querySelector('[data-financial-edit-scope="series"]').onclick = () => openEditAccount(entry, "series");
  }

  function openDeleteChoice(entry) {
    sheet(`${sheetHeader("O que deseja excluir?", "Nenhum lançamento pago será apagado.")}<div class="modal-body financial-scope-actions"><button type="button" data-financial-delete-scope="occurrence">${icon("calendar-minus")}<span><b>Somente esta conta</b><small>Esta ocorrência será ignorada pela recorrência.</small></span></button><button type="button" data-financial-delete-scope="series">${icon("calendar-x")}<span><b>Esta e as próximas</b><small>Encerra a série a partir deste vencimento.</small></span></button></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Voltar</button></footer>`);
    modal().querySelector('[data-financial-delete-scope="occurrence"]').onclick = () => confirmOccurrenceCancellation(entry);
    modal().querySelector('[data-financial-delete-scope="series"]').onclick = () => confirmSeriesCancellation(entry, false);
  }

  function confirmOccurrenceCancellation(entry) {
    sheet(`${sheetHeader("Excluir esta conta?", "A exclusão será registrada no histórico.")}<div class="modal-body financial-confirm-copy">${icon("triangle-alert")}<p><b>${esc(entry.description)}</b><span>${money(entry.amountCents)} · vencimento ${fullDateLabel(entry.dueAt)}</span></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Voltar</button><button class="btn btn-light financial-danger-action" type="button" data-financial-confirm-occurrence>Excluir conta</button></footer>`);
    modal().querySelector("[data-financial-confirm-occurrence]").onclick = async (event) => { event.currentTarget.disabled = true; try { await window.FinancialSpaceService.cancelPendingEntry(state.selectedSpaceId, entry, "Conta removida pelo usuário"); closeModal(); Utils.toast("Conta removida."); await refresh(); } catch (error) { Utils.toast(error.message, true); event.currentTarget.disabled = false; } };
  }

  function confirmSeriesCancellation(entry, fromStart) {
    const title = fromStart ? "Cancelar recorrência?" : "Excluir esta e as próximas?";
    sheet(`${sheetHeader(title, "O histórico pago continuará intacto.")}<div class="modal-body financial-confirm-copy">${icon("triangle-alert")}<p><b>${esc(entry.description)}</b><span>${fromStart ? "Todas as ocorrências pendentes serão canceladas." : `A série será encerrada a partir de ${fullDateLabel(entry.dueAt)}.`}</span></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Voltar</button><button class="btn btn-light financial-danger-action" type="button" data-financial-confirm-series>Confirmar cancelamento</button></footer>`);
    modal().querySelector("[data-financial-confirm-series]").onclick = async (event) => { event.currentTarget.disabled = true; try { await window.FinancialSpaceService.cancelRecurrenceFrom(state.selectedSpaceId, entry, { fromStart }); closeModal(); Utils.toast("Recorrência cancelada."); await refresh(); } catch (error) { Utils.toast(error.message, true); event.currentTarget.disabled = false; } };
  }

  function confirmPaidReversal(entry) {
    sheet(`${sheetHeader("Reverter lançamento pago?", "O original continuará no histórico.")}<div class="modal-body financial-confirm-copy">${icon("rotate-ccw")}<p><b>${esc(entry.description)}</b><span>Será criado um contralançamento de ${money(entry.amountCents)}.</span></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Voltar</button><button class="btn btn-light financial-danger-action" type="button" data-financial-confirm-reversal>Reverter</button></footer>`);
    modal().querySelector("[data-financial-confirm-reversal]").onclick = async (event) => { event.currentTarget.disabled = true; try { await window.FinancialSpaceService.reversePaidEntry(state.selectedSpaceId, entry, "Revertido pelo usuário"); closeModal(); Utils.toast("Lançamento revertido com histórico preservado."); await refresh(); } catch (error) { Utils.toast(error.message, true); event.currentTarget.disabled = false; } };
  }

  async function openManageRecurrence(entry) {
    try {
      const recurrence = await window.FinancialSpaceService.recurrenceDetails(state.selectedSpaceId, entry.recurrenceId);
      if (!recurrence) throw new Error("Recorrência não encontrada.");
      sheet(`${sheetHeader("Gerenciar recorrência", "Edite a regra ou encerre as próximas ocorrências.")}<div class="modal-body"><article class="financial-account-summary"><span>${icon("repeat")}</span><div><h3>${esc(recurrence.description || entry.description)}</h3><strong>${money(recurrence.amountCents || entry.amountCents)}</strong></div></article><div class="financial-account-details"><span>${icon("calendar-sync")} Frequência <b>${frequencyLabel(recurrence.frequency)}</b></span><span>${icon("calendar-plus")} Início <b>${fullDateLabel(recurrence.seriesStartAt || entry.dueAt)}</b></span><span>${icon("calendar-off")} Fim <b>${recurrence.seriesEndAt ? fullDateLabel(recurrence.seriesEndAt) : "Até eu cancelar"}</b></span><span>${icon("circle-dot")} Status <b>${recurrence.active === false ? "Cancelada" : "Ativa"}</b></span></div><div class="financial-account-actions">${recurrence.active === false ? "" : `<button class="btn btn-primary" type="button" data-financial-edit-recurrence>${icon("pencil")} Editar recorrência</button><button class="btn btn-light financial-danger-action" type="button" data-financial-cancel-recurrence>${icon("calendar-x")} Cancelar recorrência</button>`}</div></div>`);
      modal().querySelector("[data-financial-edit-recurrence]")?.addEventListener("click", () => openEditAccount(entry, "series", recurrence));
      modal().querySelector("[data-financial-cancel-recurrence]")?.addEventListener("click", () => confirmSeriesCancellation(entry, true));
    } catch (error) { Utils.toast(error.message, true); }
  }

  async function openEditAccount(entry, scope = "occurrence", recurrenceInput = null) {
    const allCategories = await window.FinancialSpaceService.listCategories(state.selectedSpaceId), categories = allCategories.filter((item) => item.type === "category"), recurrence = recurrenceInput || (scope === "series" ? await window.FinancialSpaceService.recurrenceDetails(state.selectedSpaceId, entry.recurrenceId) : null);
    let selectedSubcategoryId = entry.subcategoryId || "";
    sheet(`${sheetHeader(scope === "series" ? "Editar esta e as próximas" : "Editar conta pendente", scope === "series" ? "O histórico anterior será preservado." : "Somente esta ocorrência será alterada.")}<form data-financial-edit-form><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Descrição *</span><input name="description" maxlength="160" value="${esc(entry.description)}" required></label><label class="financial-field"><span>Valor *</span><input name="amount" inputmode="decimal" value="${(Number(entry.amountCents) / 100).toFixed(2).replace(".", ",")}" required></label><label class="financial-field"><span>${scope === "series" ? "Próximo vencimento" : "Vencimento"} *</span><input type="date" name="dueAt" value="${Engine.localIsoDate(entry.dueAt)}" required></label>${scope === "series" ? `<label class="financial-field"><span>Recorrência *</span><select name="frequency"><option value="weekly" ${(recurrence?.frequency || entry.frequency) === "weekly" ? "selected" : ""}>Semanal</option><option value="biweekly" ${(recurrence?.frequency || entry.frequency) === "biweekly" ? "selected" : ""}>Quinzenal</option><option value="monthly" ${(recurrence?.frequency || entry.frequency) === "monthly" ? "selected" : ""}>Mensal</option><option value="yearly" ${(recurrence?.frequency || entry.frequency) === "yearly" ? "selected" : ""}>Anual</option></select></label>` : ""}<label class="financial-field"><span>Categoria</span><select name="categoryId">${categories.map((category) => `<option value="${esc(category.id)}" data-name="${esc(category.name)}" data-icon="${esc(category.icon || "shapes")}"${category.id === entry.categoryId ? " selected" : ""}>${esc(category.name)}</option>`).join("")}</select></label><label class="financial-field"><span>Subcategoria (opcional)</span><select name="subcategoryId"></select></label><label class="financial-field full"><span>Observação</span><textarea name="notes" maxlength="500">${esc(entry.notes || "")}</textarea></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Salvar alterações</button></footer></form>`);
    const form = modal().querySelector("[data-financial-edit-form]");
    const refreshSubcategories = () => { const items = Engine.subcategoriesFor(allCategories, form.categoryId.value); form.subcategoryId.innerHTML = `<option value="">Sem detalhar</option>${items.map((item) => `<option value="${esc(item.id)}" data-name="${esc(item.name)}"${item.id === selectedSubcategoryId ? " selected" : ""}>${esc(item.name)}</option>`).join("")}`; };
    form.categoryId.onchange = () => { selectedSubcategoryId = ""; refreshSubcategories(); };
    refreshSubcategories();
    form.onsubmit = async (event) => { event.preventDefault(); const data = new FormData(form), option = form.categoryId.selectedOptions[0], subcategory = form.subcategoryId.selectedOptions[0], submit = form.querySelector("[type=submit]"), patch = { description: data.get("description"), amountCents: Engine.moneyInputToCents(data.get("amount")), dueAt: new Date(`${data.get("dueAt")}T12:00:00`).toISOString(), frequency: data.get("frequency") || undefined, categoryId: data.get("categoryId"), categoryName: option?.dataset.name, categoryIcon: option?.dataset.icon, subcategoryId: data.get("subcategoryId") || null, subcategoryName: data.get("subcategoryId") ? subcategory?.dataset.name : null, notes: data.get("notes") }; submit.disabled = true; try { if (scope === "series") await window.FinancialSpaceService.updateRecurrenceFrom(state.selectedSpaceId, entry, patch); else await window.FinancialSpaceService.updatePendingEntry(state.selectedSpaceId, entry, patch); closeModal(); Utils.toast("Conta atualizada."); await refresh(); } catch (error) { Utils.toast(error.message, true); submit.disabled = false; } };
  }

  async function openNewCategory() {
    if (state.consolidated) return Utils.toast("Escolha um espaço para criar a categoria.", true);
    const categories = (await window.FinancialSpaceService.listCategories(state.selectedSpaceId)).filter((item) => item.type === "category");
    sheet(`${sheetHeader("Nova categoria", "Ela ficará disponível somente neste espaço.")}<form data-financial-category-form><div class="modal-body financial-form-grid"><label class="financial-field"><span>Tipo *</span><select name="nodeType"><option value="category">Categoria principal</option><option value="subcategory">Subcategoria</option></select></label><label class="financial-field" data-financial-parent hidden><span>Categoria principal *</span><select name="parentCategoryId">${categories.map((category) => `<option value="${esc(category.id)}">${esc(category.name)}</option>`).join("")}</select></label><label class="financial-field full"><span>Nome *</span><input name="name" maxlength="60" placeholder="Ex.: Impressão 3D" required></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Criar</button></footer></form>`);
    const form = modal().querySelector("[data-financial-category-form]");
    const toggleParent = () => modal().querySelector("[data-financial-parent]").hidden = form.nodeType.value !== "subcategory";
    form.nodeType.onchange = toggleParent; toggleParent();
    form.onsubmit = async (event) => { event.preventDefault(); const submit = form.querySelector("[type=submit]"), values = new FormData(form); submit.disabled = true; try { await window.FinancialSpaceService.createCategory(state.selectedSpaceId, { name: values.get("name"), parentCategoryId: values.get("nodeType") === "subcategory" ? values.get("parentCategoryId") : null }); closeModal(); Utils.toast(values.get("nodeType") === "subcategory" ? "Subcategoria criada." : "Categoria criada."); await refresh(); } catch (error) { Utils.toast(error.message, true); submit.disabled = false; } };
  }

  function openTransfer() {
    if (state.consolidated) return Utils.toast("Escolha o espaço de origem antes de transferir.", true);
    const targets = spaces().filter((space) => space.id !== state.selectedSpaceId);
    if (!targets.length) return Utils.toast("Crie outro espaço antes de fazer uma transferência.");
    sheet(`${sheetHeader("Transferir entre espaços", "A origem e o destino serão registrados juntos.")}<form data-financial-transfer-form><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Destino *</span><select name="toSpaceId">${targets.map((space) => `<option value="${esc(space.id)}">${esc(space.name)}</option>`).join("")}</select></label><label class="financial-field"><span>Valor *</span><input name="amount" inputmode="decimal" placeholder="R$ 0,00" required></label><label class="financial-field"><span>Data *</span><input type="date" name="occurredAt" value="${Engine.localIsoDate()}" required></label><label class="financial-field full"><span>Descrição</span><input name="description" maxlength="160" placeholder="Ex.: Aporte do proprietário"></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Transferir</button></footer></form>`);
    const form = modal().querySelector("[data-financial-transfer-form]");
    form.onsubmit = async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)), submit = form.querySelector("[type=submit]"); submit.disabled = true; try { await window.FinancialSpaceService.createTransfer(state.selectedSpaceId, values.toSpaceId, { amountCents: Engine.moneyInputToCents(values.amount), occurredAt: new Date(`${values.occurredAt}T12:00:00`).toISOString(), description: values.description }); closeModal(); Utils.toast("Transferência registrada nos dois espaços."); await refresh(); } catch (error) { Utils.toast(error.message, true); submit.disabled = false; } };
  }

  function bindPage() {
    const page = root();
    if (!page) return;
    page.querySelector("[data-financial-retry]")?.addEventListener("click", () => refresh());
    page.querySelectorAll("[data-financial-open-spaces]").forEach((button) => button.onclick = openSpaces);
    page.querySelectorAll("[data-financial-open-period]").forEach((button) => button.onclick = openPeriod);
    page.querySelectorAll("[data-financial-view]").forEach((button) => button.onclick = () => { state.view = button.dataset.financialView; paint(); });
    page.querySelectorAll("[data-financial-account-filter]").forEach((button) => button.onclick = () => { state.accountFilter = button.dataset.financialAccountFilter; paint(); });
    page.querySelectorAll("[data-financial-new]").forEach((button) => button.onclick = () => openEntryForm(button.dataset.financialNew === "income" ? "in" : "out"));
    page.querySelectorAll("[data-financial-new-account]").forEach((button) => button.onclick = () => openCreateFinancialAccount());
    page.querySelectorAll("[data-financial-new-card]").forEach((button) => button.onclick = () => openCreateCreditCard());
    page.querySelectorAll("[data-financial-open-invoice]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); openCreditCardInvoice(button.dataset.financialOpenInvoice, button.dataset.financialInvoiceHome); });
    page.querySelectorAll("[data-financial-card-invoice]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); openCreditCardInvoice(button.dataset.financialCardInvoice, button.dataset.financialInvoiceHome); });
    page.querySelectorAll("[data-financial-invoice-id]").forEach((row) => row.onclick = () => openCreditCardInvoice(row.dataset.financialInvoiceId, row.dataset.financialInvoiceHome));
    page.querySelectorAll("[data-financial-edit-card]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); const card = state.dashboard?.creditCards?.find((item) => item.id === button.dataset.financialEditCard && item.cardHomeSpaceId === button.dataset.financialCardHome); if (card) openCreateCreditCard(null, card); });
    page.querySelectorAll("[data-financial-register-payment]").forEach((button) => button.onclick = openRegisterPayment);
    page.querySelectorAll("[data-financial-pay]").forEach((button) => button.onclick = () => { const entry = state.dashboard?.payables?.find((item) => item.id === button.dataset.financialPay); if (entry) openRegisterPayment(entry); });
    page.querySelectorAll("[data-financial-entry-id]").forEach((row) => row.onclick = (event) => {
      if (event.target.closest("button")) return;
      const entries = [...(state.dashboard?.accounts || []), ...(state.dashboard?.payables || []), ...(state.dashboard?.entries || []), ...(state.dashboard?.latest || [])], entry = entries.find((item) => item.id === row.dataset.financialEntryId);
      openAccount(entry);
    });
    page.querySelectorAll("[data-financial-new-category]").forEach((button) => button.onclick = openNewCategory);
    page.querySelectorAll("[data-financial-transfer]").forEach((button) => button.onclick = openTransfer);
    page.querySelectorAll("[data-financial-onboard-business]").forEach((button) => button.onclick = async () => { const context = window.BusinessContext?.get?.() || {}, name = context.business?.name || DB.carregar().config?.nome || "Minha empresa"; try { const space = await window.FinancialSpaceService.createSpace({ name, type: "business", linkedBusinessId: context.businessId }); state.selectedSpaceId = space.id; await refresh(); } catch (error) { Utils.toast(error.message, true); } });
    page.querySelectorAll("[data-financial-create-space]").forEach((button) => button.onclick = () => openCreateSpace(button.dataset.financialCreateSpace));
  }

  function bind() {
    bindPage();
    refresh();
  }
  function destroy() { state.requestVersion += 1; closeModal(); }
  function resume() { if (root()) refresh({ silent: true }); }

  addEventListener("financial-data-changed", () => { if (root() && !state.loading) refresh({ silent: true }); });
  addEventListener("financial-service-ready", () => { if (root() && !state.loading) refresh(); });
  addEventListener("app-resumed", () => { if (window.Router?.atual?.() === "financeiro") resume(); });
  return { render, bind, refresh, destroy, resume, state: () => structuredClone(state), openEntryForm, openSpaces };
})();
