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
    activeViewId: "",
    activeSpaceIds: [],
    institutionKey: "",
    viewProfile: null,
    viewInitialized: false,
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
    credit_card: "Cartão de crédito",
    debit_card: "Cartão de débito",
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
  const financialViews = () => {
    const profileViews = state.viewProfile?.views || [], favorites = new Set(state.viewProfile?.favoriteViewIds || []), defaultId = state.viewProfile?.defaultViewId || "";
    return [...profileViews, ...spaces().map((space) => ({
      id: `space:${space.id}`,
      name: space.name,
      mode: "space",
      financialSpaceIds: [space.id],
      isSystem: true,
      isFavorite: favorites.has(`space:${space.id}`),
      isDefault: defaultId === `space:${space.id}`,
      space,
    }))].sort((left, right) => Number(right.isFavorite) - Number(left.isFavorite) || Number(right.isDefault) - Number(left.isDefault));
  };
  const activeFinancialView = () => financialViews().find((view) => view.id === state.activeViewId) || null;
  const spaceName = (spaceId) => spaces().find((space) => space.id === spaceId)?.name || "Espaço";
  const accountHomeSpaceId = (account = {}, fallback = state.selectedSpaceId) => String(account.accountHomeSpaceId || account.financialSpaceId || fallback || "");
  const accountChoiceValue = (account = {}) => `${accountHomeSpaceId(account)}::${String(account.id || "")}`;
  const accountFromChoice = (accounts = [], value = "") => accounts.find((account) => accountChoiceValue(account) === value)
    || accounts.find((account) => account.id === value) || null;
  const accountScopeLabel = (account = {}) => {
    const normalized = Engine.normalizeFinancialAccountAccess(account, accountHomeSpaceId(account));
    if (normalized.accessMode === "all_spaces") return "Todos os espaços";
    if (normalized.accessMode === "selected_spaces") return `${normalized.allowedFinancialSpaceIds.length} espaços`;
    return `Somente ${spaceName(normalized.defaultFinancialSpaceId)}`;
  };
  const cardLast4Label = (card = {}) => String(card.last4 || "").trim() ? `•••• ${String(card.last4).trim()}` : "Final não informado";
  const cardNameLabel = (card = {}) => `${String(card.name || "Cartão")}${card.last4 ? ` · ${cardLast4Label(card)}` : ""}`;
  const automation = (space) => window.FinancialSpaceService?.automationState?.(space) || { enabled: false, autoIncome: {} };
  const automationLabel = (space) => space?.type === "business" && automation(space).enabled ? "Automático" : "Manual";
  const invoiceStatusLabel = { open: "Aberta", closed: "Fechada", paid: "Paga", overdue: "Vencida", cancelled: "Cancelada" };
  const FINANCE_INIT_TIMEOUT_MS = 12_000;
  const financeTrace = (marker, detail = {}) => console.info(`[${marker}]`, detail);

  function waitForFinancialService() {
    if (window.FinancialSpaceService) return Promise.resolve(window.FinancialSpaceService);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = (callback, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        removeEventListener("financial-service-ready", onReady);
        removeEventListener("financial-service-error", onError);
        callback(value);
      };
      const onReady = () => finish(resolve, window.FinancialSpaceService);
      const onError = (event) => finish(reject, Object.assign(new Error(event.detail?.message || "Serviço financeiro indisponível."), {
        code: event.detail?.code || "service-unavailable",
      }));
      const timer = setTimeout(() => finish(reject, Object.assign(new Error("O serviço financeiro não iniciou."), {
        code: "finance-service-timeout",
      })), FINANCE_INIT_TIMEOUT_MS);
      addEventListener("financial-service-ready", onReady);
      addEventListener("financial-service-error", onError);
    });
  }

  function render() {
    return `<section class="financial-page" aria-live="polite">
      <div class="financial-loading-card">${icon("loader-circle")}<b>Carregando seu financeiro…</b><span>Somente o período selecionado será consultado.</span></div>
    </section>`;
  }

  const selectorMarkup = () => {
    const view = activeFinancialView(), space = selectedSpace();
    return `<div class="financial-context-selectors">
      <button class="financial-context-button" type="button" data-financial-open-spaces aria-label="Escolher visão financeira">
        <span>${icon(view?.mode === "space" ? space?.icon || "wallet-cards" : "panels-top-left")}<small>${view?.isDefault ? "Visão padrão" : "Visão financeira"}</small><b>${esc(view?.name || space?.name || "Escolher visão")}</b></span>${icon("chevron-down")}
      </button>
      <button class="financial-context-button is-period" type="button" data-financial-open-period aria-label="Escolher período">
        <span>${icon("calendar-days")}<small>Período</small><b>${esc(monthLabel(state.period))}</b></span>${icon("chevron-down")}
      </button>
      <button class="financial-save-view" type="button" data-financial-save-view>${icon("bookmark")}<span>Salvar visão</span></button>
    </div>`;
  };

  const compactContextMarkup = () => `<nav class="financial-compact-context" aria-label="Contexto financeiro">
    <button type="button" data-financial-open-spaces aria-label="Escolher visão ou gerenciar espaços">${icon("layers-3")}<span>${esc(activeFinancialView()?.name || "Todos os espaços")}</span>${icon("chevron-down")}</button>
    <button type="button" data-financial-open-period aria-label="Escolher período">${icon("calendar-days")}<span>${esc(monthLabel(state.period))}</span>${icon("chevron-down")}</button>
  </nav>`;

  function metricMarkup(summary) {
    const resultClass = summary.resultCents < 0 ? "is-negative" : "is-positive";
    return `<section class="financial-summary-card">
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
      <article class="financial-list-row" ${entry.entityType === "credit_card_invoice" ? `data-financial-invoice-id="${esc(entry.creditCardInvoiceId)}" data-financial-invoice-home="${esc(entry.cardHomeSpaceId || state.selectedSpaceId)}" data-financial-target-space="${esc(entry.financialSpaceId || state.selectedSpaceId)}"` : `data-financial-entry-id="${esc(entry.id)}"`}>
        <span class="financial-row-icon">${icon(entry.categoryIcon || "receipt-text")}</span>
        <span class="financial-row-main"><b>${esc(entry.description)}</b><small>${state.activeSpaceIds.length > 1 ? `${esc(entry.financialSpaceName || spaceName(entry.financialSpaceId))} · ` : ""}${Engine.effectiveStatus(entry) === "overdue" ? "Venceu" : "Vence"} ${dateLabel(entry.dueAt)}</small></span>
        <span class="financial-row-date">${Engine.effectiveStatus(entry) === "overdue" ? "venceu" : "vence"} ${dateLabel(entry.dueAt)}</span>
        <span class="financial-status ${statusClass(entry)}">${entry.entityType === "credit_card_invoice" ? esc(invoiceStatusLabel[entry.invoiceStatus] || "Fatura") : statusLabel(entry)}</span>
        ${compact || entry.status === "paid" ? "" : entry.entityType === "credit_card_invoice" ? `<button class="financial-row-action" type="button" data-financial-open-invoice="${esc(entry.creditCardInvoiceId)}" data-financial-invoice-home="${esc(entry.cardHomeSpaceId || state.selectedSpaceId)}" data-financial-target-space="${esc(entry.financialSpaceId || state.selectedSpaceId)}">${icon("receipt-text")}<span>Ver fatura</span></button>` : `<button class="financial-row-action" type="button" data-financial-pay="${esc(entry.id)}">${icon("circle-check-big")}<span>Pagar</span></button>`}
      </article>`).join("")}</div>`;
  }

  function latestMarkup(entries = [], full = false) {
    if (!entries.length) return `<div class="financial-empty-inline">${icon("arrow-left-right")}<div><b>Nenhum lançamento realizado</b><span>Entradas e pagamentos aparecerão aqui.</span></div></div>`;
    const badge = (entry) => entry.autoGenerated ? ["Automático", "is-automatic"] : entry.sourceType === "transfer" ? ["Transferência", "is-transfer"] : entry.paymentMethod === "credit_card" ? ["Cartão", "is-card"] : entry.recurrenceId ? ["Recorrente", "is-recurring"] : ["Manual", ""];
    return `<div class="financial-list ${full ? "" : "is-compact"}">${entries.map((entry) => {
      const [badgeLabel, badgeClass] = badge(entry);
      return `
      <article class="financial-list-row financial-entry-row" data-financial-entry-id="${esc(entry.id)}">
        <span class="financial-row-icon ${entry.direction === "in" ? "is-income" : "is-expense"}">${icon(entry.direction === "in" ? "arrow-up" : "arrow-down")}</span>
        <span class="financial-row-main"><b>${esc(entry.description)}</b><small>${state.activeSpaceIds.length > 1 ? `${esc(entry.financialSpaceName || spaceName(entry.financialSpaceId))} · ` : ""}${esc(entry.categoryName || "Outros")}${entry.subcategoryName ? ` · ${esc(entry.subcategoryName)}` : ""} · ${dateLabel(entry.occurredAt)}${entry.paymentMethod ? ` · ${esc(paymentLabel[entry.paymentMethod] || entry.paymentMethod)}` : ""}</small><em class="financial-origin-badge ${badgeClass}">${badgeLabel}</em></span>
        <span class="financial-status ${entry.sourceType === "transfer" || entry.direction === "in" ? "is-paid" : entry.cashFlowEffect === false ? "is-pending" : "is-overdue"}">${entry.sourceType === "transfer" ? "Transferência" : entry.direction === "in" ? entry.cashFlowEffect === false ? "Ajuste" : "Entrada" : entry.cashFlowEffect === false ? "Gasto no crédito" : "Saída"}</span>
        <strong class="financial-row-amount ${entry.direction === "in" ? "is-income" : "is-expense"}">${entry.direction === "in" ? entry.cashFlowEffect === false ? "− " : "+ " : "− "}${money(entry.amountCents)}</strong>
      </article>`; }).join("")}</div>`;
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
    <button type="button" data-financial-view="accounts" class="${state.view === "accounts" || state.view === "wallets" ? "active" : ""}">Contas</button>
    <button type="button" data-financial-view="cards" class="${state.view === "cards" ? "active" : ""}">Cartões</button>
    <button type="button" data-financial-view="cashflow" class="${state.view === "cashflow" ? "active" : ""}">Fluxo</button>
  </nav>`;

  const cardScopeLabel = (card) => {
    const normalized = Engine.normalizeCreditCardAccess(card, card.cardHomeSpaceId || card.financialSpaceId), names = new Map(spaces().map((space) => [space.id, space.name]));
    if (normalized.accessMode === "all_spaces") return "Todos os espaços";
    if (normalized.accessMode === "selected_spaces") return `${normalized.allowedFinancialSpaceIds.length} espaços`;
    return `Somente ${names.get(normalized.defaultFinancialSpaceId) || "este espaço"}`;
  };
  const cardTargetSpaceId = (card) => state.activeSpaceIds.find((spaceId) => Engine.creditCardAllowsSpace(card, spaceId)) || card.defaultFinancialSpaceId || card.cardHomeSpaceId || state.selectedSpaceId;

  const activeCardInvoices = (data = {}) => {
    const invoices = (data.creditCards || []).map((card) => card.currentInvoice).filter((invoice) => invoice && invoice.status !== "cancelled"), seen = new Set();
    return invoices.filter((invoice) => !seen.has(`${invoice.cardHomeSpaceId || ""}:${invoice.id}`) && seen.add(`${invoice.cardHomeSpaceId || ""}:${invoice.id}`));
  };
  const daysUntil = (value) => {
    const target = Engine.localDay(value), today = Engine.localDay(new Date());
    return target && today ? Math.ceil((target.getTime() - today.getTime()) / 86_400_000) : null;
  };
  const nearestOpenInvoice = (data = {}) => activeCardInvoices(data)
    .filter((invoice) => Number(invoice.remainingCents || 0) > 0)
    .sort((left, right) => (Engine.localDate(left.dueDate)?.getTime() || Infinity) - (Engine.localDate(right.dueDate)?.getTime() || Infinity))[0] || null;

  const normalizeInstitutionKey = (value) => String(value || "")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
    .replace(/\b(banco|bank|instituicao|financeira|s\.?a\.?)\b/g, " ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "-") || "sem-instituicao";
  const accountIcon = (account = {}) => ({
    bank_account: "landmark", digital_wallet: "wallet-cards", cash_wallet: "banknote",
    investment_account: "chart-no-axes-column-increasing", other_account: "wallet",
    checking: "landmark", savings: "landmark", wallet: "wallet-cards", cash: "banknote", other: "wallet",
  })[account.type] || "landmark";
  const institutionGroups = (data = {}) => {
    const groups = new Map(), seenAccounts = new Set(), ensure = (key, label) => {
      if (!groups.has(key)) groups.set(key, { key, name: label || "Sem instituição", accounts: [], cards: [], availableBalanceCents: 0, invoiceTotalCents: 0, spaceIds: new Set(), dueAt: null });
      return groups.get(key);
    };
    for (const account of data.financialAccounts || []) {
      const accountKey = Engine.financialAccountKey(account);
      if (seenAccounts.has(accountKey)) continue;
      seenAccounts.add(accountKey);
      const label = account.institution || account.name || "Conta", key = normalizeInstitutionKey(label), group = ensure(key, label);
      group.accounts.push(account);
      if (Engine.financialAccountIsLiquid(account)) group.availableBalanceCents += Engine.financialAccountBalance(account);
      if (account.accessMode === "all_spaces") spaces().filter((space) => space.ownerUid === account.ownerUid).forEach((space) => group.spaceIds.add(space.id));
      else for (const spaceId of account.allowedFinancialSpaceIds || [account.defaultFinancialSpaceId || accountHomeSpaceId(account)]) group.spaceIds.add(spaceId);
    }
    for (const card of data.creditCards || []) {
      const label = card.institution || card.issuer || card.name || "Cartão", key = normalizeInstitutionKey(label), group = ensure(key, label), invoice = card.currentInvoice;
      group.cards.push(card);
      if (invoice && invoice.status !== "cancelled") {
        group.invoiceTotalCents += Number(invoice.amountDueCents || 0);
        const dueAt = Engine.localDate(invoice.dueDate);
        if (dueAt && (!group.dueAt || dueAt < group.dueAt)) group.dueAt = dueAt;
      }
      for (const spaceId of card.allowedFinancialSpaceIds || []) group.spaceIds.add(spaceId);
      if (card.defaultFinancialSpaceId || card.cardHomeSpaceId) group.spaceIds.add(card.defaultFinancialSpaceId || card.cardHomeSpaceId);
    }
    return [...groups.values()].sort((left, right) => Number(Boolean(right.accounts.length && right.cards.length)) - Number(Boolean(left.accounts.length && left.cards.length)) || left.name.localeCompare(right.name, "pt-BR"));
  };
  const institutionKind = (group) => {
    if (group.accounts.length && group.cards.length) return "Conta + Cartão";
    if (group.cards.length) return group.cards.length === 1 ? "Cartão" : `${group.cards.length} cartões`;
    if (group.accounts.some((account) => account.type === "investment_account")) return "Investimento";
    if (group.accounts.some((account) => account.type === "cash_wallet")) return "Carteira";
    return group.accounts.length === 1 ? "Conta" : `${group.accounts.length} contas`;
  };
  const institutionCardMarkup = (group, full = false) => `<article class="financial-institution-card ${full ? "is-full" : ""}" tabindex="0" role="button" data-financial-institution="${esc(group.key)}">
    <header><span>${esc(String(group.name || "FI").slice(0, 2).toUpperCase())}</span><div><h3>${esc(group.name)}</h3><small>${esc(institutionKind(group))}${group.spaceIds.size > 1 ? ` · ${group.spaceIds.size} espaços` : ""}</small></div><button type="button" data-financial-institution-actions="${esc(group.key)}" aria-label="Ações de ${esc(group.name)}">${icon("ellipsis-vertical")}</button></header>
    <div class="financial-institution-values">${group.accounts.length ? `<span><small>Saldo disponível</small><strong>${money(group.availableBalanceCents)}</strong></span>` : ""}${group.cards.length ? `<span><small>Fatura do cartão</small><strong>${money(group.invoiceTotalCents)}</strong>${group.dueAt ? `<em>Vence em ${dateLabel(group.dueAt)}</em>` : ""}</span>` : ""}</div>
    <span class="financial-institution-cta">Ver detalhes ${icon("arrow-right")}</span>
  </article>`;

  function consolidatedSummaryMarkup(summary = {}) {
    const resultClass = Number(summary.resultCents || 0) < 0 ? "is-negative" : "is-positive";
    return `<section class="financial-home-summary"><header><h2>Resumo do mês</h2><small>${icon("circle-dot")} Atualizado agora</small></header><div>
      <article>${icon("wallet")}<span><small>Saldo disponível</small><strong class="is-income">${money(summary.availableBalanceCents)}</strong><em>Contas e carteiras incluídas</em></span></article>
      <article>${icon("credit-card")}<span><small>Faturas do mês</small><strong class="is-expense">${money(summary.invoiceTotalCents)}</strong><em>Compras no crédito</em></span></article>
      <article>${icon("receipt-text")}<span><small>Contas a pagar</small><strong class="is-expense">${money(summary.pendingAccountsCents)}</strong><em>Sem repetir faturas</em></span></article>
      <article>${icon("chart-no-axes-column-increasing")}<span><small>Resultado do mês</small><strong class="${resultClass}">${summary.resultCents >= 0 ? "+ " : "− "}${money(Math.abs(Number(summary.resultCents || 0)))}</strong><em>Entradas menos saídas</em></span></article>
    </div></section>`;
  }

  function consolidatedPayablesMarkup(entries = []) {
    if (!entries.length) return `<div class="financial-empty-inline">${icon("calendar-check")}<div><b>Nenhuma obrigação neste mês</b><span>Contas e faturas do período aparecerão aqui.</span></div></div>`;
    return `<div class="financial-home-payables">${entries.map((entry) => {
      const due = Engine.localDate(entry.dueAt), isInvoice = entry.entityType === "credit_card_invoice", iconName = isInvoice ? "credit-card" : entry.categoryIcon || "receipt-text";
      return `<article ${isInvoice ? `data-financial-invoice-id="${esc(entry.creditCardInvoiceId)}" data-financial-invoice-home="${esc(entry.cardHomeSpaceId || entry.financialSpaceId)}" data-financial-target-space="${esc(entry.financialSpaceId)}"` : `data-financial-entry-id="${esc(entry.id)}"`}><time><b>${due ? String(due.getDate()).padStart(2, "0") : "—"}</b><small>${due ? due.toLocaleDateString("pt-BR", { month: "short" }).replace(".", "").toUpperCase() : ""}</small></time><span class="financial-row-icon">${icon(iconName)}</span><span><b>${esc(entry.description)}</b><small>${isInvoice ? "Fatura de cartão" : esc(entry.subcategoryName || entry.categoryName || "Conta")} · ${esc(entry.financialSpaceName || spaceName(entry.financialSpaceId))}</small></span><em>${money(entry.remainingCents ?? entry.amountCents)}</em>${icon("chevron-right")}</article>`;
    }).join("")}</div>`;
  }

  function consolidatedSpacesMarkup(data = {}) {
    const items = data.spaceSummaries || [];
    return `<section class="financial-section financial-home-spaces"><header><h2>Seus espaços</h2><button type="button" data-financial-open-spaces>Ver espaços ${icon("arrow-right")}</button></header><div>${items.map((item) => `<button type="button" data-financial-space-detail="${esc(item.financialSpaceId)}"><span>${icon(item.financialSpaceIcon || "wallet")}</span><b>${esc(item.financialSpaceName)}</b><small>${money(item.resultCents || 0)}</small></button>`).join("")}</div></section>`;
  }

  function consolidatedHomeMarkup(data = {}) {
    const groups = institutionGroups(data), summary = data.summary || {};
    return `<div class="financial-consolidated-home"><section class="financial-home-intro"><div><h1>Financeiro</h1><p>Visão geral da sua vida financeira.</p></div>${compactContextMarkup()}</section>
      ${consolidatedSummaryMarkup(summary)}
      <section class="financial-section financial-home-institutions"><header><h2>Contas e cartões</h2><button type="button" data-financial-view="institutions">Ver todos ${icon("arrow-right")}</button></header>${groups.length ? `<div class="financial-institution-carousel">${groups.map((group) => institutionCardMarkup(group)).join("")}</div>` : `<div class="financial-empty-inline">${icon("landmark")}<div><b>Nenhuma conta ou cartão</b><span>Cadastre dentro de um espaço para acompanhar aqui.</span></div></div>`}</section>
      ${attentionMarkup(data)}
      <section class="financial-section financial-home-upcoming"><header><h2>Próximas contas</h2><button type="button" data-financial-view="accounts">Ver todas ${icon("arrow-right")}</button></header>${consolidatedPayablesMarkup((data.payables || []).slice(0, 4))}</section>
      ${consolidatedSpacesMarkup(data)}
    </div>`;
  }

  function attentionMarkup(data = {}) {
    const dueSoon = (data.payables || []).filter((entry) => entry.entityType !== "credit_card_invoice" && ["pending", "overdue"].includes(Engine.effectiveStatus(entry)) && (daysUntil(entry.dueAt) ?? 99) <= 7),
      overdue = dueSoon.filter((entry) => Engine.effectiveStatus(entry) === "overdue"), invoice = nearestOpenInvoice(data), invoiceDays = invoice ? daysUntil(invoice.dueDate) : null,
      cards = [];
    if (overdue.length) cards.push(`<button type="button" data-financial-view="accounts" class="is-danger">${icon("triangle-alert")}<span><b>${overdue.length} conta${overdue.length === 1 ? " vencida" : "s vencidas"}</b><small>${money(overdue.reduce((sum, item) => sum + Number(item.amountCents || 0), 0))}</small></span>${icon("chevron-right")}</button>`);
    const upcoming = dueSoon.filter((entry) => Engine.effectiveStatus(entry) !== "overdue");
    if (upcoming.length) cards.push(`<button type="button" data-financial-view="accounts">${icon("bell-ring")}<span><b>${upcoming.length} conta${upcoming.length === 1 ? " vence" : "s vencem"} em 7 dias</b><small>${money(upcoming.reduce((sum, item) => sum + Number(item.amountCents || 0), 0))}</small></span>${icon("chevron-right")}</button>`);
    if (invoice && invoiceDays !== null && invoiceDays <= 7) cards.push(`<button type="button" data-financial-open-invoice="${esc(invoice.id)}" data-financial-invoice-home="${esc(invoice.cardHomeSpaceId || "")}" class="${invoiceDays < 0 ? "is-danger" : "is-invoice"}">${icon("credit-card")}<span><b>${invoiceDays < 0 ? "Fatura vencida" : `1 fatura vence em ${Math.max(0, invoiceDays)} dia${invoiceDays === 1 ? "" : "s"}`}</b><small>${money(invoice.remainingCents)}</small></span>${icon("chevron-right")}</button>`);
    return cards.length ? `<section class="financial-section financial-attention"><header><h2>Atenção agora</h2><button type="button" data-financial-view="accounts">Ver todas</button></header><div>${cards.join("")}</div></section>` : "";
  }

  function compactCardsMarkup(data = {}) {
    const invoices = activeCardInvoices(data), total = invoices.reduce((sum, invoice) => sum + Number(invoice.remainingCents || 0), 0), next = nearestOpenInvoice(data), nextDays = next ? daysUntil(next.dueDate) : null;
    if (!(data.creditCards || []).length && !data.creditLoadError) return "";
    return `<section class="financial-section financial-cards-compact"><header><h2>Cartões</h2><button type="button" data-financial-view="cards">Ver cartões</button></header><button type="button" data-financial-view="cards"><span>${icon("credit-card")}</span><div><small>Faturas abertas</small><strong>${money(total)}</strong><em>${(data.creditCards || []).length} ${(data.creditCards || []).length === 1 ? "cartão" : "cartões"}${nextDays === null ? "" : nextDays < 0 ? " · há fatura vencida" : ` · próxima vence em ${nextDays} dia${nextDays === 1 ? "" : "s"}`}</em></div>${icon("chevron-right")}</button></section>`;
  }

  const creditCardMarkup = (card) => {
    const invoice = card.currentInvoice, status = invoice ? invoiceStatusLabel[invoice.status] || "Aberta" : "Sem fatura";
    const shared = card.accessMode !== "single_space", currentSpaceAmount = invoice?.currentSpaceAmountCents ?? invoice?.spaceAmountCents ?? 0,
      invoiceTotal = invoice?.amountDueCents ?? 0, usedPercentage = card.limitCents ? Math.min(100, Math.round((Number(card.committedCents || 0) / Number(card.limitCents)) * 100)) : 0,
      home = card.cardHomeSpaceId || card.financialSpaceId, target = cardTargetSpaceId(card);
    return `<article class="financial-credit-card" data-financial-card-id="${esc(card.id)}" data-financial-card-home="${esc(card.cardHomeSpaceId || card.financialSpaceId)}">
      <header><span class="financial-card-brand">${esc(String(card.name || "CC").slice(0, 2).toUpperCase())}</span><div><h3>${esc(card.name)}</h3><small>${esc(cardLast4Label(card))}</small></div><em class="financial-status is-${invoice?.status === "paid" ? "paid" : invoice?.status === "overdue" ? "overdue" : "pending"}">${esc(status)}</em>${card.canEditScope ? `<button class="financial-card-manage" type="button" data-financial-edit-card="${esc(card.id)}" data-financial-card-home="${esc(home)}" aria-label="Gerenciar ${esc(card.name)}">${icon("ellipsis-vertical")}</button>` : ""}</header>
      <span class="financial-card-scope">${icon(shared ? "share-2" : "lock-keyhole")} ${esc(cardScopeLabel(card))}</span>
      <div class="financial-credit-card-total"><small>Total da fatura</small><strong>${money(invoiceTotal)}</strong><span>${invoice ? `Vence em ${fullDateLabel(invoice.dueDate)}${shared && state.activeSpaceIds.length === 1 ? ` · neste espaço: ${money(currentSpaceAmount)}` : ""}` : "Sem fatura neste ciclo"}</span></div>
      <div class="financial-card-limit-bar"><i style="width:${usedPercentage}%"></i></div><dl><div><dt>Limite</dt><dd>${money(card.limitCents || 0)}</dd></div><div><dt>Disponível</dt><dd>${money(card.availableCents || 0)}</dd></div></dl>
      <div class="financial-card-context-actions"><button type="button" data-financial-card-action="invoice" data-card-id="${esc(card.id)}" data-card-home="${esc(home)}" data-target-space="${esc(target)}" data-invoice-id="${esc(invoice?.id || "")}">${icon("receipt-text")}<span>Ver fatura</span></button><button type="button" data-financial-card-action="adjust" data-card-id="${esc(card.id)}" data-card-home="${esc(home)}" data-target-space="${esc(target)}" data-invoice-id="${esc(invoice?.id || "")}">${icon("sliders-horizontal")}<span>Ajustar fatura</span></button><button type="button" data-financial-card-action="limit" data-card-id="${esc(card.id)}" data-card-home="${esc(home)}">${icon("chart-no-axes-column-increasing")}<span>Ajustar limite</span></button><button type="button" data-financial-edit-card="${esc(card.id)}" data-financial-card-home="${esc(home)}">${icon("settings")}<span>Configurar</span></button></div>
    </article>`;
  };

  function walletsMarkup(data) {
    const accounts = data.financialAccounts || [];
    return `${subpageHeader("Contas e carteiras", "De onde o dinheiro entra ou sai", state.consolidated ? "" : `<button class="btn btn-primary" type="button" data-financial-new-account>${icon("plus")} Nova conta</button>`)}${internalNav()}
      <section class="financial-section financial-subpage-card"><div class="financial-wallet-list">${accounts.length ? accounts.map((account) => institutionAccountMarkup(account)).join("") : `<div class="financial-empty-inline">${icon("wallet")}<div><b>Nenhuma conta cadastrada</b><span>Cadastre banco, dinheiro ou carteira para pagar faturas.</span></div></div>`}</div><p class="financial-data-note">${icon("info")} O saldo é controlado pelo saldo inicial, movimentações e conciliações registradas na VECONI.</p></section>`;
  }

  function cardsMarkup(data) {
    const cards = data.creditCards || [], future = data.futureInvoices || [], activeInvoices = activeCardInvoices(data),
      openTotal = activeInvoices.reduce((sum, invoice) => sum + Number(invoice.amountDueCents || 0), 0),
      next = nearestOpenInvoice(data);
    return `${subpageHeader("Meus cartões", "Gerencie e acompanhe todas as suas faturas.")}${internalNav()}
      ${data.creditLoadError ? `<section class="financial-module-error">${icon("triangle-alert")}<span><b>Não foi possível carregar cartões.</b><small>O restante do Financeiro continua disponível.</small></span><button type="button" data-financial-retry-cards>Tentar novamente</button></section>` : ""}
      <section class="financial-credit-hero"><span>${icon("wallet-cards")}</span><div><small>Fatura total dos cartões</small><strong>${money(openTotal)}</strong><em>Valor consolidado real · ${cards.length} ${cards.length === 1 ? "cartão" : "cartões"}</em></div>${next ? `<aside>${icon("trending-up")}<small>Próximo vencimento</small><b>${fullDateLabel(next.dueDate)}</b></aside>` : ""}</section>
      <section class="financial-section financial-subpage-card">${cards.length ? `<div class="financial-credit-grid">${cards.map(creditCardMarkup).join("")}</div>` : `<div class="financial-empty-inline">${icon("credit-card")}<div><b>Nenhum cartão cadastrado</b><span>Cadastre um cartão para o vencimento ser calculado automaticamente.</span></div></div>`}<button class="financial-add-card" type="button" data-financial-new-card>${icon("plus")}<span><b>Adicionar cartão</b><small>Centralize seus gastos e faturas.</small></span></button></section>
      <section class="financial-section financial-subpage-card"><header><h2>Histórico de faturas</h2></header>${future.length ? `<div class="financial-invoice-list">${future.slice(0, 12).map((invoice) => `<button type="button" data-financial-open-invoice="${esc(invoice.id)}" data-financial-invoice-home="${esc(invoice.cardHomeSpaceId)}"><span>${icon("receipt-text")}<b>${esc(invoice.cardName || "Cartão")}</b><small>${monthLabel(invoice.referenceKey)} · vence ${dateLabel(invoice.dueDate)}</small></span><strong>${money(invoice.amountDueCents)}</strong><em class="financial-status is-${invoice.status === "overdue" ? "overdue" : invoice.status === "paid" ? "paid" : "pending"}">${esc(invoiceStatusLabel[invoice.status] || invoice.status)}</em>${icon("chevron-right")}</button>`).join("")}</div>` : `<div class="financial-empty-inline">${icon("calendar-check")}<div><b>Sem faturas neste período</b><span>Compras e parcelas aparecerão aqui.</span></div></div>`}</section>`;
  }

  function dashboardMarkup(data) {
    if (state.activeViewId === "all_spaces") return consolidatedHomeMarkup(data);
    const summary = data.summary || {};
    return `${selectorMarkup()}${metricMarkup(summary)}${internalNav()}
      ${data.creditLoadError ? `<section class="financial-module-error">${icon("triangle-alert")}<span><b>Cartões temporariamente indisponíveis.</b><small>Entradas, saídas e contas foram carregadas normalmente.</small></span><button type="button" data-financial-retry-cards>Tentar novamente</button></section>` : ""}
      <section class="financial-section"><header><h2>Ações rápidas</h2></header><div class="financial-quick-actions">
        <button type="button" data-financial-new="income"><span>${icon("plus")}</span><b>Nova entrada</b></button>
        <button type="button" data-financial-new="expense"><span>${icon("minus")}</span><b>Nova despesa</b></button>
        <button type="button" data-financial-register-payment><span>${icon("receipt-text")}</span><b>Pagar conta</b></button>
        <button type="button" data-financial-transfer><span>${icon("arrow-left-right")}</span><b>Transferir</b></button>
      </div></section>
      ${attentionMarkup(data)}
      <section class="financial-section"><header><h2>Próximas contas</h2><button type="button" data-financial-view="accounts">Ver todas</button></header>${payablesMarkup((data.payables || []).slice(0, 3))}</section>
      ${compactCardsMarkup(data)}
      <section class="financial-section"><header><h2>Categorias do mês</h2><button type="button" data-financial-view="categories">Ver relatório</button></header>${categoriesMarkup(summary.categories, summary.expensesTotalCents)}</section>
      <section class="financial-section"><header><h2>Últimos lançamentos</h2><button type="button" data-financial-view="entries">Ver todos</button></header>${latestMarkup((data.latest || []).slice(0, 5))}</section>`;
  }

  function institutionAccountMarkup(account) {
    const home = accountHomeSpaceId(account);
    return `<article class="financial-institution-account" tabindex="0" role="button" data-financial-account-id="${esc(account.id)}" data-financial-account-home="${esc(home)}"><span>${icon(accountIcon(account))}</span><div><b>${esc(account.name)}</b><small>${esc(account.institution || "Conta controlada")} · ${esc(accountScopeLabel(account))}</small></div><strong>${money(Engine.financialAccountBalance(account))}</strong><em>${Engine.financialAccountIsLiquid(account) ? "No saldo disponível" : "Fora do saldo disponível"}</em>${icon("chevron-right")}</article>`;
  }

  function institutionsMarkup(data) {
    const groups = institutionGroups(data), summary = data.summary || {};
    return `<div class="financial-accounts-cards-page"><header class="financial-accounts-cards-head"><button type="button" data-financial-view="dashboard" aria-label="Voltar">${icon("arrow-left")}</button><div><h2>Contas e cartões</h2><p>Instituições consolidadas sem duplicar saldos ou faturas.</p></div><button type="button" data-financial-add-product>${icon("plus")}<span>Adicionar</span></button></header>
      ${compactContextMarkup()}
      <section class="financial-institution-summary"><article>${icon("wallet")}<span><small>Saldo disponível total</small><strong>${money(summary.availableBalanceCents)}</strong></span></article><article>${icon("credit-card")}<span><small>Faturas abertas</small><strong>${money(summary.invoiceTotalCents)}</strong></span></article></section>
      <aside class="financial-institution-note">${icon("info")}<span>Uma instituição pode conter conta, cartão, carteira ou investimento. Tudo consolidado em um único lugar.</span><button type="button" data-financial-dismiss-note aria-label="Ocultar aviso">${icon("x")}</button></aside>
      <section class="financial-section financial-subpage-card financial-institutions-page">${groups.length ? `<div>${groups.map((group) => institutionCardMarkup(group, true)).join("")}</div>` : `<div class="financial-empty-inline">${icon("landmark")}<div><b>Nenhuma instituição cadastrada</b><span>Use Adicionar para cadastrar a primeira conta ou cartão.</span></div></div>`}</section></div>`;
  }

  function institutionDetailMarkup(data) {
    const group = institutionGroups(data).find((item) => item.key === state.institutionKey) || institutionGroups(data)[0];
    if (!group) return institutionsMarkup(data);
    const accountIds = new Set(group.accounts.map((account) => account.id)), cardIds = new Set(group.cards.map((card) => card.id)), movements = (data.latest || []).filter((entry) => accountIds.has(entry.financialAccountId) || cardIds.has(entry.creditCardId)).slice(0, 6);
    return `<div class="financial-subpage-shell"><header class="financial-subpage-head financial-institution-detail-head"><button type="button" data-financial-view="institutions" aria-label="Voltar">${icon("arrow-left")}</button><div><h2>${esc(group.name)}</h2><p>${esc(institutionKind(group))} · visão consolidada</p></div><button type="button" data-financial-institution-actions="${esc(group.key)}" aria-label="Gerenciar ${esc(group.name)}">${icon("ellipsis-vertical")}</button></header></div>
      <section class="financial-institution-hero"><span>${esc(String(group.name).slice(0, 2).toUpperCase())}</span><div><small>Saldo disponível</small><strong>${money(group.availableBalanceCents)}</strong></div><div><small>Faturas do mês</small><strong>${money(group.invoiceTotalCents)}</strong></div></section>
      <button class="financial-institution-manage-cta" type="button" data-financial-institution-actions="${esc(group.key)}">${icon("sliders-horizontal")}<span><b>Gerenciar esta instituição</b><small>Saldos, cartões, faturas, limites e espaços.</small></span>${icon("chevron-right")}</button>
      ${group.accounts.length ? `<section class="financial-section financial-subpage-card"><header><h2>Contas e carteiras</h2></header><div class="financial-institution-account-list">${group.accounts.map(institutionAccountMarkup).join("")}</div></section>` : ""}
      ${group.cards.length ? `<section class="financial-section financial-subpage-card"><header><h2>Cartões e faturas</h2></header><div class="financial-credit-grid">${group.cards.map(creditCardMarkup).join("")}</div></section>` : ""}
      <section class="financial-section financial-subpage-card"><header><h2>Últimas movimentações</h2><button type="button" data-financial-view="entries">Ver todas</button></header>${latestMarkup(movements)}</section>`;
  }

  function subpageHeader(title, subtitle, action = "") {
    return `<div class="financial-subpage-shell"><header class="financial-subpage-head"><button type="button" data-financial-view="dashboard" aria-label="Voltar">${icon("arrow-left")}</button><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>${action}</header>${selectorMarkup()}</div>`;
  }

  function accountsMarkup(data) {
    const byId = new Map(), filter = state.accountFilter;
    for (const entry of [...(data.accounts || []), ...(data.payables || [])]) if (entry.direction === "out") byId.set(entry.id, entry);
    const accounts = [...byId.values()].filter((entry) => {
      if (filter === "all") return true;
      if (filter === "recurring") return Boolean(entry.recurrenceId);
      if (filter === "invoices") return entry.entityType === "credit_card_invoice";
      return filter === "paid" ? entry.status === "paid" : Engine.effectiveStatus(entry) === filter;
    }), wallets = data.financialAccounts || [];
    return `${subpageHeader("Contas", `Obrigações e carteiras de ${monthLabel(state.period)}`, `<button class="btn btn-primary" type="button" data-financial-new="expense">${icon("plus")} Nova conta</button>`)}${internalNav()}
      <section class="financial-section financial-subpage-card"><header><h2>Contas a pagar e faturas</h2></header><div class="financial-filter-chips"><button data-financial-account-filter="all" class="${filter === "all" ? "active" : ""}">Todas</button><button data-financial-account-filter="pending" class="${filter === "pending" ? "active" : ""}">Pendentes</button><button data-financial-account-filter="recurring" class="${filter === "recurring" ? "active" : ""}">Recorrentes</button><button data-financial-account-filter="invoices" class="${filter === "invoices" ? "active" : ""}">Faturas</button><button data-financial-account-filter="overdue" class="${filter === "overdue" ? "active" : ""}">Vencidas</button><button data-financial-account-filter="paid" class="${filter === "paid" ? "active" : ""}">Pagas</button></div>${payablesMarkup(accounts, false)}</section>
      <section class="financial-section financial-subpage-card"><header><h2>Contas e carteiras</h2>${state.consolidated ? "" : `<button type="button" data-financial-new-account>${icon("plus")} Nova conta</button>`}</header><div class="financial-wallet-list">${wallets.length ? wallets.map((account) => institutionAccountMarkup(account)).join("") : `<div class="financial-empty-inline">${icon("wallet")}<div><b>Nenhuma conta cadastrada</b><span>Cadastre banco, dinheiro ou carteira para movimentar valores.</span></div></div>`}</div><p class="financial-data-note">${icon("info")} A VECONI mostra saldos controlados por lançamentos e conciliações; não consulta o banco.</p></section>`;
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

  function resolveActiveView(fallbackSpaceId = "") {
    const views = financialViews(), fallbackId = fallbackSpaceId ? `space:${fallbackSpaceId}` : views[0]?.id || "",
      requested = views.find((view) => view.id === state.activeViewId) || views.find((view) => view.id === fallbackId) || views[0],
      ids = [...new Set((requested?.financialSpaceIds || []).filter((id) => spaces().some((space) => space.id === id)))];
    state.activeViewId = requested?.id || fallbackId;
    state.activeSpaceIds = ids.length ? ids : fallbackSpaceId ? [fallbackSpaceId] : [];
    state.selectedSpaceId = state.activeSpaceIds[0] || fallbackSpaceId;
    state.consolidated = state.activeSpaceIds.length > 1;
    return requested;
  }

  async function selectFinancialView(viewId) {
    state.activeViewId = String(viewId || "");
    const view = resolveActiveView(window.FinancialSpaceService.selectedSpaceId() || spaces()[0]?.id || "");
    if (!view || !state.activeSpaceIds.length) return Utils.toast("Esta visão não possui espaços disponíveis.", true);
    window.FinancialSpaceService.selectSpace(state.selectedSpaceId);
    window.FinancialSpaceService.setConsolidatedIds(state.activeSpaceIds);
    closeModal();
    try {
      state.viewProfile = await window.FinancialSpaceService.rememberFinancialView(state.activeViewId);
    } catch (error) {
      console.warn("[FINANCIAL_VIEW_REMEMBER_ERROR]", { code: error?.code || "unknown" });
    }
    await refresh();
  }

  async function refresh(options = {}) {
    const page = root();
    if (!page) return;
    const version = ++state.requestVersion;
    state.loading = true;
    state.error = "";
    if (!options.silent) page.classList.add("is-loading");
    financeTrace("FINANCE_INIT_START", { version, period: state.period, consolidated: state.consolidated });
    try {
      const service = await waitForFinancialService();
      financeTrace("FINANCE_AUTH_READY", { authenticated: true });
      financeTrace("FINANCE_SPACES_START");
      const available = await service.listSpaces();
      financeTrace("FINANCE_SPACES_DONE", { count: available.length });
      if (version !== state.requestVersion || !root()) return;
      if (!available.length) {
        state.dashboard = null;
        root().innerHTML = emptyMarkup();
        bindPage();
        return;
      }
      state.viewProfile = await service.listFinancialViews();
      if (!state.viewInitialized) {
        state.activeViewId = state.viewProfile.views?.some((view) => view.id === "all_spaces")
          ? "all_spaces"
          : `space:${service.selectedSpaceId() || available[0].id}`;
        state.view = "dashboard";
        state.viewInitialized = true;
      }
      resolveActiveView(service.selectedSpaceId() || available[0].id);
      service.selectSpace(state.selectedSpaceId);
      financeTrace("FINANCE_SELECTED_SPACE", { selected: true, type: selectedSpace()?.type || "unknown" });
      const reconciliationSpaceIds = state.activeSpaceIds.filter((spaceId) => {
        const space = spaces().find((item) => item.id === spaceId);
        return space?.type === "business" && automation(space).enabled;
      });
      financeTrace("FINANCE_RECONCILIATION_START", { blocking: false, spaces: reconciliationSpaceIds.length });
      const reconciliationPromise = Promise.all(reconciliationSpaceIds.map((spaceId) => service.reconcileBusinessIncome?.(spaceId)))
        .then((results) => {
          financeTrace("FINANCE_RECONCILIATION_DONE", { blocking: false, spaces: results.length });
          return results;
        }).catch((error) => {
          console.warn("[FINANCE_RECONCILIATION_ERROR]", { code: error?.code || "unknown" });
          return [];
        });
      const data = state.consolidated
        ? await service.loadConsolidated(state.activeSpaceIds, state.period)
        : await service.loadDashboard(state.selectedSpaceId, state.period, {
          trace: financeTrace,
          onCore: (core) => {
            if (version !== state.requestVersion || !root()) return;
            state.dashboard = core;
            root().classList.remove("is-loading");
            paint();
          },
        });
      if (version !== state.requestVersion || !root()) return;
      state.dashboard = data;
      paint();
      financeTrace("FINANCE_INIT_DONE", { version, creditAvailable: !data.creditLoadError });
      reconciliationPromise.then(async (results) => {
        const created = results.reduce((total, result) => total + Number(result?.cached ? 0 : result?.created || 0), 0);
        if (!created || version !== state.requestVersion || !root()) return;
        const refreshed = state.consolidated
          ? await service.loadConsolidated(state.activeSpaceIds, state.period)
          : await service.loadDashboard(state.selectedSpaceId, state.period);
        if (version !== state.requestVersion || !root()) return;
        state.dashboard = refreshed;
        paint();
      }).catch((error) => console.warn("[FINANCE_RECONCILIATION_REFRESH_ERROR]", { code: error?.code || "unknown" }));
    } catch (error) {
      console.error("[FINANCE_INIT_ERROR]", { code: error?.code || "unknown", message: error?.message || "finance-init-failed" });
      console.error("[FinanceiroUI] refresh failed", {
        code: error.code,
        operation: error.financialContext?.operation || "load",
        path: error.financialContext?.path || "financialSpaces",
      });
      state.error = error.code === "permission-denied"
        ? "Não foi possível acessar este espaço financeiro."
        : "Não foi possível carregar seus dados financeiros agora.";
      if (root()) {
        root().innerHTML = `<section class="financial-error">${icon("triangle-alert")}<h2>Não foi possível carregar o Financeiro</h2><p>${esc(state.error)}</p><button class="btn btn-primary" type="button" data-financial-retry>Tentar novamente</button></section>`;
        bindPage();
      }
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
      institutions: institutionsMarkup,
      institution: institutionDetailMarkup,
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
    document.body.classList.remove("financial-modal-open");
  }
  function sheet(content, className = "") {
    document.body.classList.add("financial-modal-open");
    modal().innerHTML = `<div class="modal-bg financial-modal-bg"><section class="modal-box financial-sheet ${className}" role="dialog" aria-modal="true">${content}</section></div>`;
    modal().querySelector(".financial-modal-bg").addEventListener("click", (event) => { if (event.target === event.currentTarget) closeModal(); });
    modal().querySelectorAll("[data-financial-close]").forEach((button) => button.onclick = closeModal);
    window.lucide?.createIcons();
  }
  const sheetHeader = (title, subtitle = "") => `<header class="modal-head"><div><h3>${esc(title)}</h3>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><button class="icon-btn" type="button" data-financial-close aria-label="Fechar">${icon("x")}</button></header>`;

  function openActionSpacePicker(title, callback) {
    const allowed = spaces().filter((space) => state.activeSpaceIds.includes(space.id));
    sheet(`${sheetHeader(title, "A ação será registrada em um único espaço.")}<div class="modal-body financial-view-list">${allowed.map((space) => `<article class="financial-view-option"><button type="button" data-action-space="${esc(space.id)}"><span>${icon(space.icon || "wallet")}</span><b>${esc(space.name)}</b><small>${space.type === "business" ? "Negócio" : space.type === "personal" ? "Pessoal" : "Outro"}</small>${icon("chevron-right")}</button></article>`).join("")}</div>`);
    modal().querySelectorAll("[data-action-space]").forEach((button) => button.onclick = async () => {
      await selectFinancialView(`space:${button.dataset.actionSpace}`);
      await callback?.();
    });
  }

  function openCreationSpacePicker(title, callback) {
    const allowed = spaces().filter((space) => !state.activeSpaceIds.length || state.activeSpaceIds.includes(space.id));
    sheet(`${sheetHeader(title, "O cadastro ficará vinculado a este espaço, sem sair da visão consolidada.")}<div class="modal-body financial-view-list">${allowed.map((space) => `<article class="financial-view-option"><button type="button" data-creation-space="${esc(space.id)}"><span>${icon(space.icon || "wallet")}</span><b>${esc(space.name)}</b><small>${space.type === "business" ? "Negócio" : space.type === "personal" ? "Pessoal" : "Outro"}</small>${icon("chevron-right")}</button></article>`).join("")}</div>`);
    modal().querySelectorAll("[data-creation-space]").forEach((button) => button.onclick = () => callback?.(button.dataset.creationSpace));
  }

  function chooseInstitutionItem(items, title, description, callback, iconName = "wallet") {
    if (!items.length) return Utils.toast("Nenhum item disponível para esta ação.", true);
    if (items.length === 1) return callback(items[0]);
    sheet(`${sheetHeader(title, description)}<div class="modal-body financial-view-list">${items.map((item, index) => `<article class="financial-view-option"><button type="button" data-institution-choice="${index}"><span>${icon(iconName)}</span><b>${esc(item.name || item.cardName || "Item financeiro")}</b><small>${item.last4 ? `•••• ${esc(item.last4)}` : esc(item.institution || spaceName(item.financialSpaceId))}</small>${icon("chevron-right")}</button></article>`).join("")}</div>`);
    modal().querySelectorAll("[data-institution-choice]").forEach((button) => button.onclick = () => callback(items[Number(button.dataset.institutionChoice)]));
  }

  function openAddFinancialProduct(group = null) {
    const defaults = group ? { name: group.name, institution: group.name, spaceId: group.accounts[0]?.financialSpaceId || group.cards[0]?.cardHomeSpaceId || "" } : {};
    const choices = [
      ["bank_account", "landmark", "Conta bancária", "Saldo, entradas e pagamentos."],
      ["credit_card", "credit-card", "Cartão de crédito", "Limite, compras e faturas."],
      ["account_card", "wallet-cards", "Conta + cartão", "Cadastre os dois na mesma instituição."],
      ["digital_wallet", "wallet", "Carteira / dinheiro físico", "Carteira digital ou dinheiro em mãos."],
      ["investment_account", "chart-no-axes-column-increasing", "Investimento", "Acompanhe sem somar à liquidez por padrão."],
    ];
    sheet(`${sheetHeader("O que deseja adicionar?", group ? `Adicionar em ${group.name}.` : "Centralize tudo em Contas e cartões.")}<div class="modal-body financial-add-product-list">${choices.map(([kind, iconName, label, helper]) => `<button type="button" data-financial-add-kind="${kind}">${icon(iconName)}<span><b>${label}</b><small>${helper}</small></span>${icon("chevron-right")}</button>`).join("")}</div>`);
    modal().querySelectorAll("[data-financial-add-kind]").forEach((button) => button.onclick = () => {
      const kind = button.dataset.financialAddKind;
      if (kind === "credit_card") return openCreateCreditCard(null, null, defaults);
      if (kind === "account_card") return openCreateFinancialAccount((account) => openCreateCreditCard(() => refresh(), null, {
        spaceId: account.financialSpaceId,
        name: `${account.institution || account.name} Cartão`,
        institution: account.institution || account.name,
      }), { ...defaults, type: "bank_account", title: "Nova conta da instituição" });
      if (kind === "digital_wallet") return openCreateFinancialAccount(null, { ...defaults, type: "digital_wallet", title: "Nova carteira ou dinheiro físico" });
      if (kind === "investment_account") return openCreateFinancialAccount(null, { ...defaults, type: "investment_account", includeInAvailableBalance: false, title: "Novo investimento" });
      return openCreateFinancialAccount(null, { ...defaults, type: "bank_account" });
    });
  }

  function openEditFinancialInstitution(group) {
    sheet(`${sheetHeader("Editar instituição", "O nome será atualizado nas contas e cartões deste agrupamento.")}<form data-financial-institution-edit><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Nome da instituição *</span><input name="name" maxlength="80" value="${esc(group.name)}" required></label><article class="financial-wizard-info full">${icon("info")} Saldos, faturas, limites, compras e identificadores não serão alterados.</article></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Salvar</button></footer></form>`);
    const form = modal().querySelector("[data-financial-institution-edit]");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector("[type=submit]"); submit.disabled = true;
      try {
        const result = await window.FinancialSpaceService.updateFinancialInstitution({
          name: form.name.value,
          accounts: group.accounts.map((account) => ({ id: account.id, financialSpaceId: account.financialSpaceId })),
          cards: group.cards.map((card) => ({ id: card.id, cardHomeSpaceId: card.cardHomeSpaceId || card.financialSpaceId })),
        });
        state.institutionKey = normalizeInstitutionKey(result.name);
        closeModal(); Utils.toast("Instituição atualizada."); await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  function openArchiveFinancialInstitution(group) {
    sheet(`${sheetHeader("Remover instituição?", "A remoção segura arquiva os cadastros sem apagar o histórico.")}<div class="modal-body financial-confirm-copy">${icon("archive")}<p><b>${esc(group.name)}</b><span>Para arquivar, contas precisam estar zeradas e cartões não podem ter fatura em aberto.</span></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-light financial-danger-action" type="button" data-financial-confirm-archive>Arquivar instituição</button></footer>`);
    modal().querySelector("[data-financial-confirm-archive]").onclick = async (event) => {
      event.currentTarget.disabled = true;
      try {
        await window.FinancialSpaceService.archiveFinancialInstitution({
          accounts: group.accounts.map((account) => ({ id: account.id, financialSpaceId: account.financialSpaceId })),
          cards: group.cards.map((card) => ({ id: card.id, cardHomeSpaceId: card.cardHomeSpaceId || card.financialSpaceId })),
        });
        state.view = "institutions"; state.institutionKey = "";
        closeModal(); Utils.toast("Instituição arquivada; histórico preservado."); await refresh();
      } catch (error) { Utils.toast(error.message, true); event.currentTarget.disabled = false; }
    };
  }

  function openInstitutionActions(institutionKey) {
    const group = institutionGroups(state.dashboard).find((item) => item.key === institutionKey);
    if (!group) return Utils.toast("Instituição não encontrada.", true);
    const invoiceCards = group.cards.filter((card) => card.currentInvoice), payableCards = invoiceCards.filter((card) => Number(card.currentInvoice?.remainingCents || 0) > 0),
      canAddCard = group.cards.length || group.accounts.some((account) => ["bank_account", "digital_wallet", "other_account", "checking", "savings", "wallet", "other"].includes(account.type)),
      action = (id, iconName, label, helper, danger = false) => `<button type="button" data-institution-action="${id}" class="${danger ? "is-danger" : ""}">${icon(iconName)}<span><b>${label}</b><small>${helper}</small></span>${icon("chevron-right")}</button>`;
    sheet(`<span class="financial-sheet-handle"></span>${sheetHeader(group.name, `${institutionKind(group)}${group.spaceIds.size > 1 ? ` · ${group.spaceIds.size} espaços` : ""}`)}<div class="modal-body"><section class="financial-institution-action-summary"><span>${esc(String(group.name).slice(0, 2).toUpperCase())}</span>${group.accounts.length ? `<div><small>Saldo atual</small><strong>${money(group.availableBalanceCents)}</strong></div>` : ""}${group.cards.length ? `<div><small>Fatura atual</small><strong>${money(group.invoiceTotalCents)}</strong>${group.dueAt ? `<em>Vence em ${dateLabel(group.dueAt)}</em>` : ""}</div>` : ""}</section><div class="financial-institution-action-list">
      ${action("details", "layout-dashboard", "Ver detalhes", "Contas, cartões, faturas e movimentações.")}
      ${group.accounts.length ? action("balance", "refresh-cw", "Atualizar saldo", "Concilie com o valor real sem criar receita.") : ""}
      ${canAddCard ? action("add-card", "credit-card", "Adicionar cartão", `Vincule um novo cartão a ${group.name}.`) : ""}
      ${action("add-account", "plus", "Adicionar conta, carteira ou investimento", "Inclua outro produto desta instituição.")}
      ${invoiceCards.length ? action("invoice-adjust", "sliders-horizontal", "Ajustar fatura", "Conciliação individual por cartão e ciclo.") : ""}
      ${group.cards.length ? action("limit", "chart-no-axes-column-increasing", "Ajustar limite", "Altere somente o cartão selecionado.") : ""}
      ${payableCards.length ? action("pay", "circle-check-big", "Pagar fatura", "Escolha a conta de origem do pagamento.") : ""}
      ${action("movements", "arrow-left-right", "Movimentações", "Veja lançamentos, receitas e despesas.")}
      ${action("edit", "settings", "Editar instituição", "Nome e organização do agrupamento.")}
      ${group.cards.length ? action("spaces", "layers-3", "Gerenciar espaços", "Disponibilidade dos cartões sem duplicação.") : ""}
      ${action("archive", "trash-2", "Remover instituição", "Arquive com segurança e preserve o histórico.", true)}
    </div></div>`, "financial-institution-action-sheet");
    const chooseAccount = (callback) => chooseInstitutionItem(group.accounts, "Escolher conta", "Selecione a conta ou carteira.", callback, "wallet");
    const chooseCard = (items, title, callback) => chooseInstitutionItem(items, title, "A ação afetará somente o cartão escolhido.", callback, "credit-card");
    const handlers = {
      details: () => { closeModal(); state.institutionKey = group.key; state.view = "institution"; paint(); },
      balance: () => chooseAccount((account) => openAdjustFinancialAccount(account, account.financialSpaceId)),
      "add-card": () => openCreateCreditCard(null, null, { institution: group.name, name: `${group.name} Cartão`, spaceId: group.accounts[0]?.financialSpaceId || group.cards[0]?.cardHomeSpaceId }),
      "add-account": () => openAddFinancialProduct(group),
      "invoice-adjust": () => chooseCard(invoiceCards, "Escolher fatura", (card) => openCreditCardInvoiceAdjustment({ ...card.currentInvoice, interactionSpaceId: cardTargetSpaceId(card) })),
      limit: () => chooseCard(group.cards, "Escolher cartão", openCreditCardLimitAdjustment),
      pay: () => chooseCard(payableCards, "Escolher fatura", (card) => openCreditCardInvoicePayment({ ...card.currentInvoice, interactionSpaceId: cardTargetSpaceId(card) })),
      movements: () => { closeModal(); state.view = "entries"; paint(); },
      edit: () => openEditFinancialInstitution(group),
      spaces: () => chooseCard(group.cards, "Escolher cartão", (card) => openCreateCreditCard(null, card)),
      archive: () => openArchiveFinancialInstitution(group),
    };
    modal().querySelectorAll("[data-institution-action]").forEach((button) => button.onclick = () => handlers[button.dataset.institutionAction]?.());
  }

  function openSpaces() {
    const views = financialViews(), quick = views.filter((view) => view.mode !== "space"), spaceViews = views.filter((view) => view.mode === "space"), row = (view) => `<article class="financial-view-option ${view.id === state.activeViewId ? "active" : ""}">
      <button type="button" data-financial-select-view="${esc(view.id)}"><span>${icon(view.mode === "all_spaces" ? "panels-top-left" : view.mode === "personal" ? "house" : view.mode === "business" ? "briefcase-business" : view.space?.icon || "bookmark")}</span><b>${esc(view.name)}</b><small>${view.financialSpaceIds.length} espaço${view.financialSpaceIds.length === 1 ? "" : "s"}${view.isDefault ? " · Padrão" : ""}</small>${icon("chevron-right")}</button>
      <div><button type="button" data-financial-favorite-view="${esc(view.id)}" aria-label="${view.isFavorite ? "Remover dos favoritos" : "Favoritar"}">${icon("star")}</button><button type="button" data-financial-default-view="${esc(view.id)}" aria-label="Definir como padrão">${icon(view.isDefault ? "bookmark-check" : "bookmark")}</button>${view.mode === "space" ? `<button type="button" data-financial-manage-space="${esc(view.space.id)}" aria-label="Gerenciar espaço">${icon("settings")}</button>` : ""}${view.mode === "custom" ? `<button type="button" data-financial-delete-view="${esc(view.id)}" aria-label="Excluir visão">${icon("trash-2")}</button>` : ""}</div>
    </article>`;
    sheet(`${sheetHeader("Visões financeiras", "Escolha o que deseja analisar sem duplicar dados.")}
      <div class="modal-body financial-view-picker"><h4>Visões rápidas</h4><div class="financial-view-list">${quick.map(row).join("")}</div><h4>Espaços</h4><div class="financial-view-list">${spaceViews.map(row).join("")}</div></div>
      <footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-create-space="personal">${icon("plus")} Espaço</button><button class="btn btn-primary" type="button" data-financial-create-view>${icon("bookmark-plus")} Criar visão</button></footer>`, "financial-view-sheet");
    modal().querySelectorAll("[data-financial-select-view]").forEach((button) => button.onclick = () => selectFinancialView(button.dataset.financialSelectView));
    modal().querySelector("[data-financial-create-view]").onclick = () => openSaveView();
    modal().querySelector("[data-financial-create-space]").onclick = () => openCreateSpace("personal");
    modal().querySelectorAll("[data-financial-favorite-view]").forEach((button) => button.onclick = async () => { state.viewProfile = await window.FinancialSpaceService.toggleFavoriteFinancialView(button.dataset.financialFavoriteView); openSpaces(); });
    modal().querySelectorAll("[data-financial-default-view]").forEach((button) => button.onclick = async () => { state.viewProfile = await window.FinancialSpaceService.setDefaultFinancialView(button.dataset.financialDefaultView); openSpaces(); });
    modal().querySelectorAll("[data-financial-manage-space]").forEach((button) => button.onclick = () => openManageSpace(button.dataset.financialManageSpace));
    modal().querySelectorAll("[data-financial-delete-view]").forEach((button) => button.onclick = async () => {
      if (!confirm("Excluir esta visão salva? Os espaços e lançamentos não serão alterados.")) return;
      state.viewProfile = await window.FinancialSpaceService.deleteFinancialView(button.dataset.financialDeleteView);
      if (!financialViews().some((view) => view.id === state.activeViewId)) state.activeViewId = state.viewProfile.defaultViewId || state.viewProfile.lastViewId;
      openSpaces();
    });
  }

  function openSaveView() {
    const current = activeFinancialView(), editing = current?.mode === "custom" ? current : null, selected = new Set(editing?.financialSpaceIds || state.activeSpaceIds);
    sheet(`${sheetHeader(editing ? "Editar visão" : "Criar visão", "Uma visão é apenas uma consulta dos espaços selecionados.")}
      <form data-financial-view-form><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Nome da visão *</span><input name="name" maxlength="60" value="${esc(editing?.name || "")}" placeholder="Ex.: Casa e Carro" required></label><fieldset class="financial-view-spaces full"><legend>Espaços incluídos</legend>${spaces().map((space) => `<label><input type="checkbox" name="spaceId" value="${esc(space.id)}" ${selected.has(space.id) ? "checked" : ""}><span>${icon(space.icon || "wallet")}<b>${esc(space.name)}</b><small>${space.type === "business" ? "Negócio" : space.type === "personal" ? "Pessoal" : "Outro"}</small></span></label>`).join("")}</fieldset><label class="financial-toggle full"><input type="checkbox" name="favorite" ${editing?.isFavorite ? "checked" : ""}><span></span><b>Adicionar aos favoritos</b></label><label class="financial-toggle full"><input type="checkbox" name="default" ${editing?.isDefault ? "checked" : ""}><span></span><b>Usar como visão padrão</b></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Salvar visão</button></footer></form>`, "financial-view-edit-sheet");
    modal().querySelector("[data-financial-view-form]").onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget, values = new FormData(form), submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      try {
        const profile = await window.FinancialSpaceService.saveFinancialView({ id: editing?.id, name: values.get("name"), financialSpaceIds: values.getAll("spaceId"), isFavorite: values.get("favorite") === "on", isDefault: values.get("default") === "on" });
        state.viewProfile = profile;
        state.activeViewId = profile.lastViewId;
        resolveActiveView();
        closeModal();
        Utils.toast("Visão salva.");
        await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  async function openManageSpace(spaceId) {
    const space = spaces().find((item) => item.id === spaceId);
    if (!space) return;
    const current = automation(space), businessLinked = space.type === "business" && Boolean(space.linkedBusinessId),
      activated = current.activatedAt ? fullDateLabel(current.activatedAt) : "Ao ativar",
      accounts = businessLinked ? await window.FinancialSpaceService.listFinancialAccounts(space.id) : [],
      currentAccountValue = current.defaultIncomeFinancialAccountId
        ? `${current.defaultIncomeFinancialAccountHomeSpaceId || space.id}::${current.defaultIncomeFinancialAccountId}` : "";
    sheet(`${sheetHeader("Gerenciar espaço financeiro", space.name)}
      <form data-financial-automation-form><div class="modal-body"><section class="financial-automation-card"><header><span>${icon(businessLinked ? "cloud-cog" : "pencil-line")}</span><div><h4>Automação financeira</h4><p>${businessLinked ? `Negócio vinculado: ${esc(space.name)}` : "Este espaço recebe lançamentos manuais."}</p></div><b class="financial-origin-badge ${current.enabled ? "is-automatic" : ""}">${current.enabled ? "Ativa" : "Manual"}</b></header>${businessLinked ? `<label class="financial-field"><span>Conta padrão para recebimentos</span><select name="defaultIncomeFinancialAccountKey"><option value="">Não alocar automaticamente</option>${accounts.map((account) => `<option value="${esc(accountChoiceValue(account))}" ${accountChoiceValue(account) === currentAccountValue ? "selected" : ""}>${esc(account.name)} · ${esc(accountScopeLabel(account))}</option>`).join("")}</select><small>Somente novos recebimentos serão destinados automaticamente.</small></label><label class="financial-automation-option"><span><b>Automação ativa</b><small>Receitas confirmadas entram sem lançamento manual.</small></span><input type="checkbox" name="enabled" ${current.enabled ? "checked" : ""}></label><label class="financial-automation-option"><span><b>Vendas pagas</b><small>PIX, dinheiro e cartão já confirmados.</small></span><input type="checkbox" name="sales" ${current.autoIncome.sales ? "checked" : ""}></label><label class="financial-automation-option"><span><b>Pagamentos de clientes</b><small>Inclui recebimentos parciais de fiado e saldo legado.</small></span><input type="checkbox" name="customerPayments" ${current.autoIncome.customerPayments ? "checked" : ""}></label><label class="financial-automation-option"><span><b>Pedidos online pagos</b><small>Somente quando convertidos em uma venda paga confirmada.</small></span><input type="checkbox" name="onlineOrders" ${current.autoIncome.onlineOrders ? "checked" : ""}></label><p class="financial-activation-note">${icon("calendar-check")} Início da automação: <b>${esc(activated)}</b>. Movimentos anteriores não são importados.</p>` : `<div class="financial-wizard-info">${icon("info")} Casa, Carro e outros espaços permanecem manuais por padrão.</div>`}</section></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Voltar</button>${businessLinked ? '<button class="btn btn-primary" type="submit">Salvar automação</button>' : ""}</footer></form>`);
    const form = modal().querySelector("[data-financial-automation-form]");
    if (businessLinked) form.onsubmit = async (event) => {
      event.preventDefault();
      const values = new FormData(form), submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      try {
        const selectedAccount = accountFromChoice(accounts, values.get("defaultIncomeFinancialAccountKey"));
        await window.FinancialSpaceService.updateAutomation(space.id, {
          enabled: values.get("enabled") === "on",
          sales: values.get("sales") === "on",
          customerPayments: values.get("customerPayments") === "on",
          onlineOrders: values.get("onlineOrders") === "on",
          defaultIncomeFinancialAccountId: selectedAccount?.id || null,
          defaultIncomeFinancialAccountHomeSpaceId: selectedAccount ? accountHomeSpaceId(selectedAccount) : null,
        });
        await window.FinancialSpaceService.reconcileBusinessIncome(space.id, { force: true });
        closeModal();
        Utils.toast("Automação financeira atualizada.");
        await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
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
        state.activeViewId = `space:${space.id}`;
        state.activeSpaceIds = [space.id];
        closeModal();
        await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  function openCreateFinancialAccount(onCreated = null, defaults = {}) {
    if (state.consolidated && !defaults.spaceId) return openCreationSpacePicker("Em qual espaço criar a conta?", (spaceId) => openCreateFinancialAccount(onCreated, { ...defaults, spaceId }));
    const service = window.FinancialSpaceService, targetSpaceId = defaults.spaceId || state.selectedSpaceId,
      targetSpace = spaces().find((space) => space.id === targetSpaceId), canShare = service.canShareFinancialAccounts(targetSpaceId),
      availableSpaces = spaces().filter((space) => space.ownerUid === targetSpace?.ownerUid),
      initialType = Engine.normalizeFinancialAccountType(defaults.type || "bank_account"), included = defaults.includeInAvailableBalance !== false && initialType !== "investment_account";
    sheet(`${sheetHeader(defaults.title || "Nova conta ou carteira", "A conta fica única e pode ser usada nos espaços autorizados.")}<form data-financial-account-create><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Nome *</span><input name="name" maxlength="80" value="${esc(defaults.name || "")}" placeholder="Ex.: Inter" required></label><label class="financial-field"><span>Tipo *</span><select name="type"><option value="bank_account" ${initialType === "bank_account" ? "selected" : ""}>Conta bancária</option><option value="digital_wallet" ${initialType === "digital_wallet" ? "selected" : ""}>Carteira digital</option><option value="cash_wallet" ${initialType === "cash_wallet" ? "selected" : ""}>Dinheiro físico</option><option value="investment_account" ${initialType === "investment_account" ? "selected" : ""}>Investimentos</option><option value="other_account" ${initialType === "other_account" ? "selected" : ""}>Outra conta</option></select></label><label class="financial-field"><span>Instituição</span><input name="institution" maxlength="80" value="${esc(defaults.institution || "")}" placeholder="Ex.: Banco Inter"></label><label class="financial-field"><span>Final da conta <small>(opcional)</small></span><input name="last4" inputmode="numeric" maxlength="4" value="${esc(defaults.last4 || "")}" placeholder="6357"></label><fieldset class="financial-account-access full"><legend>Onde esta conta pode ser usada?</legend><div class="financial-card-access-picker">${canShare ? `<button type="button" data-account-access="all_spaces">${icon("layers-3")}<span><b>Todos os meus espaços</b><small>Uma conta, sem duplicar o saldo.</small></span></button><button type="button" data-account-access="selected_spaces">${icon("list-checks")}<span><b>Espaços selecionados</b><small>Escolha exatamente onde ela aparece.</small></span></button>` : ""}<button type="button" data-account-access="single_space" class="active">${icon("lock-keyhole")}<span><b>Somente este espaço</b><small>Uso exclusivo em ${esc(targetSpace?.name || "este espaço")}.</small></span>${icon("circle-check")}</button></div><section class="financial-space-checks" data-account-space-list hidden>${availableSpaces.map((space) => `<button type="button" data-account-space="${esc(space.id)}"><i data-lucide="square"></i><span>${esc(space.name)}<small>${space.type === "business" ? "Negócio" : space.type === "personal" ? "Pessoal" : "Outro"}</small></span></button>`).join("")}</section></fieldset><label class="financial-field full"><span>Saldo real hoje</span><input name="initialBalance" inputmode="decimal" value="${esc(defaults.initialBalance || "0,00")}"><small>Saldo físico da conta; não soma lançamentos antigos e não entra como receita.</small></label><label class="financial-toggle full"><input type="checkbox" name="includeInAvailableBalance" ${included ? "checked" : ""}><span></span><b>Incluir no saldo disponível</b></label><div class="financial-wizard-info full">${icon("shield-check")} Compartilhar não transfere acesso e não expõe a conta a outros usuários.</div></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Criar conta</button></footer></form>`);
    const form = modal().querySelector("[data-financial-account-create]"), selectedSpaces = new Set(), accessList = form.querySelector("[data-account-space-list]");
    let accessMode = "single_space";
    const renderAccess = () => {
      form.querySelectorAll("[data-account-access]").forEach((button) => {
        const active = button.dataset.accountAccess === accessMode;
        button.classList.toggle("active", active);
        button.querySelector("svg:last-child")?.remove();
        if (active) button.insertAdjacentHTML("beforeend", icon("circle-check"));
      });
      accessList.hidden = accessMode !== "selected_spaces";
      form.querySelectorAll("[data-account-space]").forEach((button) => {
        const active = selectedSpaces.has(button.dataset.accountSpace);
        button.classList.toggle("active", active);
        button.querySelector("i,svg")?.setAttribute("data-lucide", active ? "square-check-big" : "square");
      });
      window.lucide?.createIcons();
    };
    form.querySelectorAll("[data-account-access]").forEach((button) => button.onclick = () => { accessMode = button.dataset.accountAccess; renderAccess(); });
    form.querySelectorAll("[data-account-space]").forEach((button) => button.onclick = () => { const id = button.dataset.accountSpace; selectedSpaces.has(id) ? selectedSpaces.delete(id) : selectedSpaces.add(id); renderAccess(); });
    form.elements.type.addEventListener("change", () => {
      if (form.elements.type.value === "investment_account") form.elements.includeInAvailableBalance.checked = false;
      else if (!form.elements.includeInAvailableBalance.checked) form.elements.includeInAvailableBalance.checked = true;
    });
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form)), submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      try {
        const initialBalanceCents = Engine.balanceInputToCents(values.initialBalance),
          payload = { ...values, initialBalanceCents, includeInAvailableBalance: new FormData(form).get("includeInAvailableBalance") === "on", accessMode, allowedFinancialSpaceIds: accessMode === "selected_spaces" ? [...selectedSpaces] : [], defaultFinancialSpaceId: targetSpaceId },
          account = await service.createFinancialAccount(targetSpaceId, payload);
        closeModal();
        Utils.toast("Conta criada.");
        if (onCreated) await onCreated(account); else await refresh();
      } catch (error) {
        if (error.code !== "financial-account-possible-duplicate" || !error.matches?.length) { Utils.toast(error.message, true); submit.disabled = false; return; }
        const payload = { ...values, initialBalanceCents: Engine.balanceInputToCents(values.initialBalance), includeInAvailableBalance: new FormData(form).get("includeInAvailableBalance") === "on", accessMode, allowedFinancialSpaceIds: accessMode === "selected_spaces" ? [...selectedSpaces] : [], defaultFinancialSpaceId: targetSpaceId };
        sheet(`${sheetHeader("Conta parecida encontrada", "Evite repetir a mesma instituição e duplicar o saldo.")}<div class="modal-body"><div class="financial-account-duplicate-list">${error.matches.map((account) => `<article><span>${icon("landmark")}</span><div><b>${esc(account.name)}</b><small>${esc(account.institution || "Conta financeira")} · ${money(Engine.financialAccountBalance(account))} · ${esc(accountScopeLabel(account))}</small></div><button class="btn btn-primary" type="button" data-use-account="${esc(account.id)}" data-account-home="${esc(accountHomeSpaceId(account))}">Usar conta existente</button></article>`).join("")}</div><div class="financial-wizard-info">${icon("info")} Se for outra conta real da mesma instituição, você ainda pode cadastrá-la.</div></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-light" type="button" data-create-similar-account>Criar outra conta</button></footer>`);
        modal().querySelectorAll("[data-use-account]").forEach((button) => button.onclick = async () => { button.disabled = true; try { const account = await service.useExistingFinancialAccount(button.dataset.accountHome, button.dataset.useAccount, targetSpaceId); closeModal(); Utils.toast("Conta existente disponibilizada neste espaço."); if (onCreated) await onCreated(account); else await refresh(); } catch (useError) { Utils.toast(useError.message, true); button.disabled = false; } });
        modal().querySelector("[data-create-similar-account]").onclick = async (createButton) => { createButton.currentTarget.disabled = true; try { const account = await service.createFinancialAccount(targetSpaceId, { ...payload, allowSimilarAccount: true }); closeModal(); Utils.toast("Nova conta criada após confirmação."); if (onCreated) await onCreated(account); else await refresh(); } catch (createError) { Utils.toast(createError.message, true); createButton.currentTarget.disabled = false; } };
        window.lucide?.createIcons();
      }
    };
  }

  function openFinancialAccount(account, spaceId) {
    const currentBalanceCents = Engine.financialAccountBalance(account), included = Engine.financialAccountIsLiquid(account);
    sheet(`${sheetHeader(account.name, account.institution || "Conta financeira")}<div class="modal-body"><article class="financial-account-balance-detail"><span>${icon(accountIcon(account))}</span><div><small>Saldo controlado pela VECONI</small><strong>${money(currentBalanceCents)}</strong><em>${included ? "Incluído no saldo disponível" : "Fora do saldo disponível"}</em></div></article><div class="financial-account-details"><span>${icon("layers-3")} Disponibilidade <b>${esc(accountScopeLabel(account))}</b></span><span>${icon("home")} Espaço de cadastro <b>${esc(spaceName(accountHomeSpaceId(account, spaceId)))}</b></span><span>${icon("database")} Origem <b>Saldo inicial + movimentações</b></span><span>${icon("shield-check")} Integração bancária <b>Não conectada</b></span></div><div class="financial-account-actions"><button class="btn btn-primary" type="button" data-financial-adjust-account>${icon("scale")} Ajustar saldo real</button><button class="btn btn-light" type="button" data-financial-edit-account>${icon("pencil")} Editar</button><button class="btn btn-light financial-danger-action" type="button" data-financial-archive-account>${icon("archive")} Arquivar / excluir</button></div><div class="financial-wizard-info">${icon("info")} Ajustar saldo cria um registro de conciliação sem virar receita ou despesa.</div></div>`);
    modal().querySelector("[data-financial-adjust-account]").onclick = () => openAdjustFinancialAccount(account, spaceId);
    modal().querySelector("[data-financial-edit-account]").onclick = () => openEditFinancialAccount(account, spaceId);
    modal().querySelector("[data-financial-archive-account]").onclick = () => confirmArchiveFinancialAccount(account, spaceId);
  }

  function openEditFinancialAccount(account, spaceId) {
    const service = window.FinancialSpaceService, homeSpaceId = accountHomeSpaceId(account, spaceId), normalized = Engine.normalizeFinancialAccountAccess(account, homeSpaceId),
      availableSpaces = spaces().filter((space) => space.ownerUid === account.ownerUid), canShare = service.canShareFinancialAccounts(homeSpaceId);
    sheet(`${sheetHeader("Editar conta", account.name)}<form data-financial-account-edit><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Nome *</span><input name="name" maxlength="80" value="${esc(account.name)}" required></label><label class="financial-field"><span>Instituição</span><input name="institution" maxlength="80" value="${esc(account.institution || "")}"></label><label class="financial-field"><span>Final da conta</span><input name="last4" inputmode="numeric" maxlength="4" value="${esc(account.last4 || "")}"></label><label class="financial-field full"><span>Disponibilidade</span><select name="accessMode">${canShare ? `<option value="all_spaces" ${normalized.accessMode === "all_spaces" ? "selected" : ""}>Todos os meus espaços</option><option value="selected_spaces" ${normalized.accessMode === "selected_spaces" ? "selected" : ""}>Espaços selecionados</option>` : ""}<option value="single_space" ${normalized.accessMode === "single_space" ? "selected" : ""}>Somente ${esc(spaceName(normalized.defaultFinancialSpaceId || homeSpaceId))}</option></select></label><fieldset class="financial-view-spaces full" data-account-edit-spaces><legend>Espaços autorizados</legend>${availableSpaces.map((space) => `<label><input type="checkbox" name="allowedFinancialSpaceIds" value="${esc(space.id)}" ${normalized.allowedFinancialSpaceIds.includes(space.id) ? "checked" : ""}><span>${icon(space.icon || "wallet")}<b>${esc(space.name)}</b><small>${space.type === "business" ? "Negócio" : space.type === "personal" ? "Pessoal" : "Outro"}</small></span></label>`).join("")}</fieldset><label class="financial-toggle full"><input type="checkbox" name="includeInAvailableBalance" ${Engine.financialAccountIsLiquid(account) ? "checked" : ""}><span></span><b>Incluir no saldo disponível</b></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Salvar conta</button></footer></form>`);
    const form = modal().querySelector("[data-financial-account-edit]"), spaceList = form.querySelector("[data-account-edit-spaces]"), toggle = () => { spaceList.hidden = form.accessMode.value !== "selected_spaces"; };
    form.accessMode.onchange = toggle; toggle();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = new FormData(form), submit = form.querySelector("[type=submit]"); submit.disabled = true;
      try {
        await service.updateFinancialAccount(homeSpaceId, account.id, { name: values.get("name"), institution: values.get("institution"), last4: values.get("last4"), accessMode: values.get("accessMode"), allowedFinancialSpaceIds: values.getAll("allowedFinancialSpaceIds"), defaultFinancialSpaceId: normalized.defaultFinancialSpaceId || homeSpaceId, includeInAvailableBalance: values.get("includeInAvailableBalance") === "on" });
        closeModal(); Utils.toast("Conta atualizada."); await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  function confirmArchiveFinancialAccount(account, spaceId) {
    const homeSpaceId = accountHomeSpaceId(account, spaceId);
    sheet(`${sheetHeader("Remover conta?", "O histórico financeiro nunca será apagado.")}<div class="modal-body financial-confirm-copy">${icon("archive")}<p><b>${esc(account.name)}</b><span>Sem referências, a conta será excluída. Com histórico, será arquivada e deixará de aparecer em novos lançamentos.</span></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-light financial-danger-action" type="button" data-confirm-account-archive>Continuar</button></footer>`);
    modal().querySelector("[data-confirm-account-archive]").onclick = async (event) => { event.currentTarget.disabled = true; try { const result = await window.FinancialSpaceService.archiveFinancialAccount(homeSpaceId, account.id, { deleteIfUnused: true }); closeModal(); Utils.toast(result.deleted ? "Conta excluída com segurança." : "Conta arquivada; o histórico foi preservado."); await refresh(); } catch (error) { Utils.toast(error.message, true); event.currentTarget.disabled = false; } };
  }

  function openAdjustFinancialAccount(account, spaceId) {
    const balance = Engine.financialAccountBalance(account);
    sheet(`${sheetHeader("Ajustar saldo", `${account.name} · ${spaceName(spaceId)}`)}<form data-financial-account-adjust><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Saldo real hoje *</span><input name="targetBalance" inputmode="decimal" value="${(balance / 100).toFixed(2).replace(".", ",")}" required></label><label class="financial-field full"><span>Motivo</span><input name="reason" maxlength="160" value="Conciliação manual" placeholder="Ex.: conferência do extrato"></label><article class="financial-wizard-info full">${icon("scale")} A diferença ajusta apenas o saldo. Entradas, saídas e resultado do mês não mudam.</article></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Salvar saldo</button></footer></form>`);
    const form = modal().querySelector("[data-financial-account-adjust]");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form)), submit = form.querySelector("[type=submit]");
      submit.disabled = true;
      try {
        await window.FinancialSpaceService.adjustFinancialAccountBalance(spaceId, account.id, {
          financialAccountHomeSpaceId: accountHomeSpaceId(account, spaceId),
          targetBalanceCents: Engine.balanceInputToCents(values.targetBalance),
          reason: values.reason,
          operationId: `balance_adjustment_${crypto.randomUUID()}`,
        });
        closeModal();
        Utils.toast("Saldo conciliado sem alterar o resultado.");
        await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  async function openCreateCreditCard(onCreated = null, existing = null, defaults = {}) {
    const service = window.FinancialSpaceService, ownerSpaces = spaces().filter((space) => space.ownerUid === (existing?.ownerUid || selectedSpace()?.ownerUid)),
      preferredHomeSpaceId = existing?.cardHomeSpaceId || defaults.spaceId || state.selectedSpaceId || ownerSpaces[0]?.id,
      homeSpace = spaces().find((space) => space.id === preferredHomeSpaceId) || ownerSpaces[0] || selectedSpace(), homeSpaceId = homeSpace?.id;
    if (!homeSpaceId) return Utils.toast("Nenhum espaço financeiro disponível para guardar o cartão.", true);
    const accounts = await service.listFinancialAccounts(homeSpaceId),
      canShare = service.canShareCreditCards(homeSpaceId), availableSpaces = spaces().filter((space) => space.ownerUid === homeSpace?.ownerUid),
      normalized = Engine.normalizeCreditCardAccess(existing || {}, homeSpaceId), draft = {
        step: 1,
        name: existing?.name || defaults.name || "",
        institution: existing?.institution || existing?.issuer || defaults.institution || "",
        last4: existing?.last4 || "",
        notes: existing?.notes || defaults.notes || "",
        limit: existing ? (Number(existing.limitCents || 0) / 100).toFixed(2).replace(".", ",") : "",
        closingDay: existing?.closingDay || "",
        dueDay: existing?.dueDay || "",
        paymentAccountKey: existing?.paymentAccountId ? `${existing.paymentAccountHomeSpaceId || homeSpaceId}::${existing.paymentAccountId}` : "",
        accessMode: existing ? normalized.accessMode : canShare ? "all_spaces" : "single_space",
        allowedFinancialSpaceIds: existing ? [...normalized.allowedFinancialSpaceIds] : [],
        defaultFinancialSpaceId: existing ? normalized.defaultFinancialSpaceId : homeSpaceId,
      };
    sheet(`<div data-credit-card-wizard></div>`, "financial-card-wizard");
    const host = modal().querySelector("[data-credit-card-wizard]"), sync = () => {
      host.querySelectorAll("input,select,textarea").forEach((field) => { if (field.name) draft[field.name] = field.value; });
    }, finishCard = async (card, message) => {
      closeModal();
      Utils.toast(message);
      if (onCreated) await onCreated(card); else await refresh();
    }, openDuplicateCardWarning = (error, payload) => {
      sheet(`${sheetHeader("Cartão parecido encontrado", "Evite cadastrar novamente o mesmo crédito e duplicar a fatura.")}<div class="modal-body"><div class="financial-account-duplicate-list">${error.matches.map((card) => `<article><span>${icon("credit-card")}</span><div><b>${esc(card.name)}</b><small>${esc(card.institution || "Cartão de crédito")}${card.last4 ? ` · ${esc(cardLast4Label(card))}` : ""} · ${esc(cardScopeLabel(card))}</small></div><button class="btn btn-primary" type="button" data-use-card="${esc(card.id)}" data-card-home="${esc(card.cardHomeSpaceId)}">Usar cartão existente</button></article>`).join("")}</div><div class="financial-wizard-info">${icon("info")} Se for outro cartão real, você ainda pode cadastrá-lo sem mesclar faturas.</div></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-light" type="button" data-create-similar-card>Cadastrar outro</button></footer>`);
      modal().querySelectorAll("[data-use-card]").forEach((button) => button.onclick = async () => {
        button.disabled = true;
        try {
          const card = await service.useExistingCreditCard(button.dataset.cardHome, button.dataset.useCard, {
            accessMode: payload.accessMode,
            allowedFinancialSpaceIds: payload.allowedFinancialSpaceIds,
            defaultFinancialSpaceId: payload.defaultFinancialSpaceId,
          });
          await finishCard(card, "Cartão existente reutilizado sem duplicar a fatura.");
        } catch (useError) { Utils.toast(useError.message, true); button.disabled = false; }
      });
      modal().querySelector("[data-create-similar-card]").onclick = async (event) => {
        event.currentTarget.disabled = true;
        try { await finishCard(await service.createCreditCard(homeSpaceId, { ...payload, allowSimilarCard: true }), "Novo cartão criado."); }
        catch (createError) { Utils.toast(createError.message, true); event.currentTarget.disabled = false; }
      };
      window.lucide?.createIcons();
    }, renderCardWizard = () => {
      const accessLabel = draft.accessMode === "all_spaces" ? "Todos os meus espaços" : draft.accessMode === "selected_spaces"
        ? `${draft.allowedFinancialSpaceIds.length} espaços selecionados` : `Somente ${spaces().find((space) => space.id === draft.defaultFinancialSpaceId)?.name || "este espaço"}`;
      const steps = [
        `<div class="modal-body financial-wizard-body"><h3>Qual é o cartão?</h3><p>Esses dados ajudam a identificar uma única fatura real.</p><div class="financial-form-grid"><label class="financial-field full"><span>Nome/apelido *</span><input name="name" maxlength="80" value="${esc(draft.name)}" placeholder="Ex.: C6 Carbon"></label><label class="financial-field"><span>Banco/instituição</span><input name="institution" maxlength="80" value="${esc(draft.institution)}" placeholder="Ex.: C6 Bank"></label><label class="financial-field"><span>Últimos dígitos <small>(opcional)</small></span><input name="last4" inputmode="numeric" maxlength="4" value="${esc(draft.last4)}" placeholder="2429"></label><label class="financial-field full"><span>Observação <small>(opcional)</small></span><textarea name="notes" maxlength="500" placeholder="Ex.: Cartão principal">${esc(draft.notes)}</textarea></label></div></div>`,
        `<div class="modal-body financial-wizard-body"><h3>Como funciona a fatura?</h3><p>A VECONI usará estes dias para escolher a fatura automaticamente.</p><div class="financial-form-grid"><label class="financial-field full"><span>Limite total *</span><input name="limit" inputmode="decimal" value="${esc(draft.limit)}" placeholder="R$ 8.000,00"></label><label class="financial-field"><span>Fecha no dia *</span><input name="closingDay" type="number" min="1" max="31" value="${esc(draft.closingDay)}" placeholder="12"></label><label class="financial-field"><span>Vence no dia *</span><input name="dueDay" type="number" min="1" max="31" value="${esc(draft.dueDay)}" placeholder="20"></label></div><div class="financial-wizard-info">${icon("calendar-check")} Dias 29, 30 e 31 usam o último dia válido nos meses menores.</div></div>`,
        `<div class="modal-body financial-wizard-body"><h3>Em quais espaços este cartão pode ser usado?</h3><p>O cartão continua único; cada compra permanece classificada no espaço correto.</p><div class="financial-card-access-picker">${canShare ? `<button type="button" data-card-access="all_spaces" class="${draft.accessMode === "all_spaces" ? "active" : ""}">${icon("layers-3")}<span><b>Todos os espaços</b><small>Também valerá para novos espaços criados por você.</small></span>${draft.accessMode === "all_spaces" ? icon("circle-check") : ""}</button><button type="button" data-card-access="selected_spaces" class="${draft.accessMode === "selected_spaces" ? "active" : ""}">${icon("list-checks")}<span><b>Alguns espaços</b><small>Escolha exatamente onde ele poderá ser usado.</small></span>${draft.accessMode === "selected_spaces" ? icon("circle-check") : ""}</button>` : ""}<button type="button" data-card-access="single_space" class="${draft.accessMode === "single_space" ? "active" : ""}">${icon("lock-keyhole")}<span><b>Somente um espaço</b><small>Uma restrição de uso, não a identidade do cartão.</small></span>${draft.accessMode === "single_space" ? icon("circle-check") : ""}</button></div>${draft.accessMode === "selected_spaces" ? `<section class="financial-space-checks"><b>Escolha os espaços</b>${availableSpaces.map((space) => `<button type="button" data-card-space="${esc(space.id)}" class="${draft.allowedFinancialSpaceIds.includes(space.id) ? "active" : ""}">${icon(draft.allowedFinancialSpaceIds.includes(space.id) ? "square-check-big" : "square")}<span>${esc(space.name)}<small>${space.type === "business" ? "Negócio" : space.type === "personal" ? "Pessoal" : "Outro"}</small></span></button>`).join("")}</section>` : ""}${draft.accessMode === "single_space" ? `<label class="financial-field financial-card-single-space"><span>Espaço permitido *</span><select name="defaultFinancialSpaceId">${availableSpaces.map((space) => `<option value="${esc(space.id)}" ${space.id === draft.defaultFinancialSpaceId ? "selected" : ""}>${esc(space.name)}</option>`).join("")}</select></label>` : ""}<div class="financial-wizard-info">${icon("shield-check")} ${draft.accessMode === "all_spaces" ? "Você poderá usar este cartão em qualquer espaço, inclusive os criados no futuro. Cada compra continuará sendo classificada no espaço correto." : "Disponibilidade operacional não transfere acesso nem expõe faturas de outros espaços."}</div></div>`,
        `<div class="modal-body financial-wizard-body"><h3>Conferir cartão</h3><p>Compras de espaços diferentes irão para a mesma fatura real.</p><article class="financial-wizard-review"><header><span>${icon("credit-card")}</span><div><b>${esc(draft.name || "Cartão")}</b><strong>${esc(draft.last4 ? cardLast4Label(draft) : "Final não informado")}</strong></div></header><dl><div><dt>Instituição</dt><dd>${esc(draft.institution || "Não informada")}</dd></div><div><dt>Limite</dt><dd>${draft.limit ? money(Engine.moneyInputToCents(draft.limit)) : "—"}</dd></div><div><dt>Fechamento</dt><dd>Dia ${esc(draft.closingDay)}</dd></div><div><dt>Vencimento</dt><dd>Dia ${esc(draft.dueDay)}</dd></div><div><dt>Disponibilidade</dt><dd>${esc(accessLabel)}</dd></div><div><dt>Conta para pagamento</dt><dd>${esc(accountFromChoice(accounts, draft.paymentAccountKey)?.name || "Escolher ao pagar")}</dd></div>${draft.notes ? `<div><dt>Observação</dt><dd>${esc(draft.notes)}</dd></div>` : ""}</dl></article><label class="financial-field"><span>Conta padrão para pagar <small>(opcional)</small></span><select name="paymentAccountKey"><option value="">Escolher ao pagar</option>${accounts.map((account) => `<option value="${esc(accountChoiceValue(account))}" ${accountChoiceValue(account) === draft.paymentAccountKey ? "selected" : ""}>${esc(account.name)} · ${esc(accountScopeLabel(account))}</option>`).join("")}</select></label>${existing ? `<button type="button" class="btn btn-light financial-danger-action financial-card-archive" data-card-archive>${icon("archive")} Remover cartão</button>` : ""}</div>`,
      ];
      host.innerHTML = `<header class="modal-head financial-wizard-head"><div><small>Passo ${draft.step} de 4</small><div class="financial-wizard-progress">${[1, 2, 3, 4].map((step) => `<i class="${step <= draft.step ? "active" : ""}"></i>`).join("")}</div></div><button class="icon-btn" type="button" data-financial-close>${icon("x")}</button></header>${steps[draft.step - 1]}<footer class="modal-foot"><button class="btn btn-light" type="button" data-card-back>${draft.step === 1 ? "Cancelar" : "Voltar"}</button><button class="btn btn-primary" type="button" data-card-next>${draft.step === 4 ? existing ? "Salvar cartão" : "Criar cartão" : "Continuar"}</button></footer>`;
      host.querySelector("[data-financial-close]").onclick = closeModal;
      host.querySelector("[data-card-back]").onclick = () => { sync(); if (draft.step === 1) closeModal(); else { draft.step--; renderCardWizard(); } };
      host.querySelectorAll("[data-card-access]").forEach((button) => button.onclick = () => { sync(); draft.accessMode = button.dataset.cardAccess; if (draft.accessMode === "single_space") { draft.defaultFinancialSpaceId ||= homeSpaceId; draft.allowedFinancialSpaceIds = [draft.defaultFinancialSpaceId]; } renderCardWizard(); });
      host.querySelectorAll("[data-card-space]").forEach((button) => button.onclick = () => { sync(); const id = button.dataset.cardSpace; draft.allowedFinancialSpaceIds = draft.allowedFinancialSpaceIds.includes(id) ? draft.allowedFinancialSpaceIds.filter((value) => value !== id) : [...draft.allowedFinancialSpaceIds, id]; renderCardWizard(); });
      host.querySelector("[data-card-archive]")?.addEventListener("click", () => confirmArchiveCreditCard(existing));
      host.querySelector("[data-card-next]").onclick = async (event) => {
        sync();
        try {
          if (draft.step === 1 && (!draft.name.trim() || (draft.last4 && !/^\d{4}$/.test(draft.last4)))) throw new Error("Informe o nome; use 4 dígitos ou deixe o final vazio.");
          if (draft.step === 2) { Engine.moneyInputToCents(draft.limit); if (!(Number(draft.closingDay) >= 1 && Number(draft.closingDay) <= 31 && Number(draft.dueDay) >= 1 && Number(draft.dueDay) <= 31)) throw new Error("Revise fechamento e vencimento."); }
          if (draft.step === 3 && (!draft.accessMode || (draft.accessMode === "selected_spaces" && !draft.allowedFinancialSpaceIds.length))) throw new Error("Escolha onde o cartão poderá ser usado.");
          if (draft.step < 4) { draft.step++; renderCardWizard(); return; }
          event.currentTarget.disabled = true;
          const paymentAccount = accountFromChoice(accounts, draft.paymentAccountKey), payload = { ...draft, paymentAccountId: paymentAccount?.id || null, paymentAccountHomeSpaceId: paymentAccount ? accountHomeSpaceId(paymentAccount) : null, limitCents: Engine.moneyInputToCents(draft.limit) }, card = existing
            ? await service.updateCreditCard(homeSpaceId, existing.id, payload)
            : await service.createCreditCard(homeSpaceId, payload);
          await finishCard(card, existing ? "Cartão atualizado." : "Cartão criado.");
        } catch (error) {
          if (!existing && error.code === "credit-card-possible-duplicate" && error.matches?.length) {
            const paymentAccount = accountFromChoice(accounts, draft.paymentAccountKey), payload = { ...draft, paymentAccountId: paymentAccount?.id || null, paymentAccountHomeSpaceId: paymentAccount ? accountHomeSpaceId(paymentAccount) : null, limitCents: Engine.moneyInputToCents(draft.limit) };
            return openDuplicateCardWarning(error, payload);
          }
          Utils.toast(error.message, true); event.currentTarget.disabled = false;
        }
      };
      window.lucide?.createIcons();
    };
    renderCardWizard();
  }

  function confirmArchiveCreditCard(card) {
    sheet(`${sheetHeader("Remover cartão?", "Faturas e compras antigas nunca serão apagadas.")}<div class="modal-body financial-confirm-copy">${icon("archive")}<p><b>${esc(cardNameLabel(card))}</b><span>Sem histórico, o cartão será excluído. Com compras, faturas ou pagamentos, será arquivado e deixará de aparecer em novos usos.</span></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-light financial-danger-action" type="button" data-confirm-card-archive>Continuar</button></footer>`);
    modal().querySelector("[data-confirm-card-archive]").onclick = async (event) => {
      event.currentTarget.disabled = true;
      try {
        const result = await window.FinancialSpaceService.archiveCreditCard(card.cardHomeSpaceId, card.id, { deleteIfUnused: true });
        closeModal();
        Utils.toast(result.deleted ? "Cartão excluído com segurança." : "Cartão arquivado; o histórico foi preservado.");
        await refresh();
      } catch (error) { Utils.toast(error.message, true); event.currentTarget.disabled = false; }
    };
  }

  async function ensureCardCycleInvoice(card, targetSpaceId = cardTargetSpaceId(card)) {
    if (card.currentInvoice?.referenceKey === state.period) return { ...card.currentInvoice, interactionSpaceId: targetSpaceId };
    const result = await window.FinancialSpaceService.ensureCreditCardInvoice(targetSpaceId, {
      creditCardId: card.id,
      cardHomeSpaceId: card.cardHomeSpaceId,
      referenceKey: state.period,
    });
    return { ...result.invoice, interactionSpaceId: targetSpaceId };
  }

  function openCreditCardLimitAdjustment(card) {
    sheet(`${sheetHeader("Ajustar limite", cardNameLabel(card))}<form data-financial-card-limit><div class="modal-body financial-form-grid"><article class="financial-payment-balance full"><small>Limite atual</small><strong>${money(card.limitCents)}</strong></article><label class="financial-field full"><span>Novo limite *</span><input name="limit" inputmode="decimal" value="${(Number(card.limitCents || 0) / 100).toFixed(2).replace(".", ",")}" required><small>A alteração afeta somente este cartão.</small></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Salvar limite</button></footer></form>`, "financial-limit-sheet");
    const form = modal().querySelector("[data-financial-card-limit]");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector("[type=submit]"); submit.disabled = true;
      try {
        await window.FinancialSpaceService.updateCreditCard(card.cardHomeSpaceId, card.id, { limitCents: Engine.moneyInputToCents(form.limit.value) });
        closeModal(); Utils.toast("Limite do cartão atualizado."); await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  async function handleCreditCardAction(button) {
    const card = state.dashboard?.creditCards?.find((item) => item.id === button.dataset.cardId && item.cardHomeSpaceId === button.dataset.cardHome), action = button.dataset.financialCardAction;
    if (!card) return Utils.toast("Cartão não encontrado nesta visão.", true);
    if (action === "limit") return openCreditCardLimitAdjustment(card);
    try {
      button.disabled = true;
      const invoice = await ensureCardCycleInvoice(card, button.dataset.targetSpace || cardTargetSpaceId(card));
      if (action === "adjust") return openCreditCardInvoiceAdjustment(invoice);
      return openCreditCardInvoice(invoice.id, invoice.cardHomeSpaceId, invoice.interactionSpaceId);
    } catch (error) { Utils.toast(error.message, true); }
    finally { button.disabled = false; }
  }

  async function openCreditCardInvoice(invoiceId, cardHomeSpaceId = "", targetSpaceId = state.selectedSpaceId) {
    if (!invoiceId) return;
    try {
      const details = await window.FinancialSpaceService.getCreditCardInvoiceDetails(targetSpaceId, invoiceId, { cardHomeSpaceId }), invoice = { ...details.invoice, interactionSpaceId: targetSpaceId },
        currentSpaceAmount = details.spaceBreakdown.find((item) => item.id === targetSpaceId)?.amountCents || 0,
        breakdown = (items, empty) => items.length ? `<div class="financial-breakdown-list">${items.map((item) => `<article><div><b>${esc(item.name)}</b><small>${item.percentage}%</small></div><span><i style="width:${Math.max(4, item.percentage)}%"></i></span><strong>${money(item.amountCents)}</strong></article>`).join("")}</div>` : `<p class="financial-panel-empty">${esc(empty)}</p>`,
        purchaseRows = details.purchases.length ? details.purchases.map((purchase) => `<article data-invoice-purchase data-purchase-id="${esc(purchase.id)}" data-purchase-category="${esc(purchase.categoryId || "")}" tabindex="0"><span><b>${esc(purchase.description)}</b><small>${dateLabel(purchase.purchaseDate)} · ${esc(purchase.financialSpaceName || "Espaço")} · ${esc(purchase.categoryName || "Outros")}${purchase.installmentCount > 1 ? ` · ${purchase.installmentNumber}/${purchase.installmentCount}` : ""}</small></span><strong>${money(purchase.amountCents)}</strong></article>`).join("") : `<p class="financial-panel-empty">Nenhuma compra nesta fatura.</p>`,
        installmentGroups = new Map(), palette = ["#05b98f", "#378be9", "#8b42d9", "#ff9638", "#94a3b8"];
      for (const purchase of details.purchases.filter((item) => Number(item.installmentCount || 1) > 1)) {
        const key = purchase.installmentGroupId || purchase.purchaseOperationId || purchase.id;
        if (!installmentGroups.has(key)) installmentGroups.set(key, purchase);
      }
      let cursor = 0;
      const donut = details.categoryBreakdown.length ? details.categoryBreakdown.map((item, index) => {
        const start = cursor, end = cursor + item.percentage;
        cursor = end;
        return `${palette[index % palette.length]} ${start}% ${end}%`;
      }).join(",") : "#e7eef1 0 100%";
      const adjustmentTotal = details.adjustments.reduce((sum, item) => sum + Number(item.effectCents || 0), 0),
        paidPercentage = invoice.amountDueCents ? Math.min(100, Math.round((Number(invoice.paidTotalCents || 0) / invoice.amountDueCents) * 100)) : 0;
      sheet(`${sheetHeader(`Fatura ${invoice.cardName || "Cartão"}`, `${monthLabel(invoice.referenceKey)} · vence ${fullDateLabel(invoice.dueDate)}`)}<div class="modal-body"><article class="financial-invoice-summary-v3"><div><small>Total da fatura</small><strong>${money(invoice.amountDueCents)}</strong></div><div><small>Pago</small><strong>${money(invoice.paidTotalCents)}</strong></div><div><small>Restante</small><strong class="is-expense">${money(invoice.remainingCents)}</strong></div><span class="financial-status is-${invoice.status === "paid" ? "paid" : invoice.status === "overdue" ? "overdue" : "pending"}">${esc(invoiceStatusLabel[invoice.status] || invoice.status)}</span><div class="financial-invoice-progress"><i style="width:${paidPercentage}%"></i></div><small>${paidPercentage}% pago${currentSpaceAmount && details.spaceBreakdown.length > 1 ? ` · ${money(currentSpaceAmount)} deste espaço` : ""}</small></article><div class="financial-invoice-primary-actions">${invoice.remainingCents > 0 ? `<button class="btn btn-primary" type="button" data-financial-pay-invoice="${esc(invoice.id)}">${invoice.paidTotalCents ? "Pagar valor" : "Pagar total"}</button>` : ""}<button class="btn btn-light" type="button" data-financial-adjust-invoice>${icon("sliders-horizontal")} Ajustar valor</button><button class="btn btn-light" type="button" data-financial-ongoing-for-card>${icon("list-ordered")} Parcelamento em andamento</button></div><article class="financial-invoice-reconciliation"><span><small>Compras registradas</small><b>${money(invoice.purchasesTotalCents)}</b></span><span><small>Saldo inicial/ajustes</small><b class="${adjustmentTotal < 0 ? "is-income" : ""}">${adjustmentTotal < 0 ? "− " : ""}${money(Math.abs(adjustmentTotal))}</b></span><span><small>Total da fatura</small><b>${money(invoice.amountDueCents)}</b></span></article><nav class="financial-invoice-tabs" aria-label="Detalhes da fatura"><button type="button" class="active" data-invoice-tab="purchases">Compras</button><button type="button" data-invoice-tab="spaces">Espaços</button><button type="button" data-invoice-tab="categories">Categorias</button><button type="button" data-invoice-tab="installments">Parcelas</button></nav><section data-invoice-panel="purchases" class="financial-invoice-purchases"><header><h4 data-purchases-title>Compras desta fatura</h4><button type="button" data-clear-category-filter hidden>Limpar filtro</button></header><div data-purchase-list>${purchaseRows}</div></section><section data-invoice-panel="spaces" hidden><h4>Gastos por espaço</h4>${breakdown(details.spaceBreakdown, "Nenhum espaço nesta fatura.")}</section><section data-invoice-panel="categories" hidden><h4>Gastos por categoria</h4><div class="financial-category-analysis"><div class="financial-donut" style="--donut:conic-gradient(${donut})"><span><b>${money(invoice.purchasesTotalCents)}</b><small>categorizado</small></span></div><div class="financial-category-legend">${details.categoryBreakdown.map((item, index) => `<button type="button" data-filter-category="${esc(item.id)}" data-category-name="${esc(item.name)}"><i style="background:${palette[index % palette.length]}"></i><span><b>${esc(item.name)}</b><small>${item.percentage}%</small></span><strong>${money(item.amountCents)}</strong></button>`).join("")}</div></div></section><section data-invoice-panel="installments" hidden><h4>Parcelas e impacto futuro</h4>${installmentGroups.size ? `<div class="financial-installment-list">${[...installmentGroups.values()].map((purchase) => { const remaining = Math.max(0, Number(purchase.installmentCount) - Number(purchase.installmentNumber)); return `<article><span>${icon("calendar-range")}</span><div><b>${esc(String(purchase.description || "").replace(/ · \d+\/\d+$/, ""))}</b><small>Parcela ${purchase.installmentNumber}/${purchase.installmentCount} · restam ${remaining}</small></div><strong>${money(purchase.amountCents)}</strong><em>Futuro: ${money(remaining * Number(purchase.amountCents || 0))}</em></article>`; }).join("")}</div>` : `<p class="financial-panel-empty">Nenhuma compra parcelada nesta fatura.</p>`}</section>${details.payments.length ? `<section class="financial-invoice-purchases financial-payment-history"><h4>Pagamentos</h4>${details.payments.map((payment) => `<article><span><b>${esc(paymentLabel[payment.paymentMethod] || "Pagamento")}</b><small>${fullDateLabel(payment.paidAt)}</small></span><strong>${money(payment.amountCents)}</strong></article>`).join("")}</section>` : ""}</div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Fechar</button></footer>`, "financial-invoice-sheet");
      const adjustButton = modal().querySelector("[data-financial-adjust-invoice]"), payButton = modal().querySelector("[data-financial-pay-invoice]"), installmentsButton = modal().querySelector("[data-financial-ongoing-for-card]"), purchaseTitle = modal().querySelector("[data-purchases-title]");
      if (adjustButton) adjustButton.innerHTML = `${icon("sliders-horizontal")}<span><b>Ajustar esta fatura</b><small>Concilie com o banco, sem criar categorias</small></span>`;
      if (payButton) payButton.innerHTML = `${icon("credit-card")}<span>Registrar pagamento</span>`;
      if (installmentsButton) installmentsButton.innerHTML = `${icon("pie-chart")}<span>Parcelamentos</span>`;
      if (purchaseTitle) purchaseTitle.textContent = "Lançamentos da fatura";
      const invoiceCycles = (state.dashboard?.creditCardInvoices || []).filter((item) => item.creditCardId === invoice.creditCardId && item.cardHomeSpaceId === invoice.cardHomeSpaceId).sort((left, right) => String(right.referenceKey).localeCompare(String(left.referenceKey))), invoiceHead = modal().querySelector(".modal-head");
      invoiceHead?.insertAdjacentHTML("afterend", `<div class="financial-invoice-identity"><span class="financial-card-brand">${esc(String(invoice.cardName || "CC").slice(0, 2).toUpperCase())}</span><div><b>${esc(invoice.cardName || "Cartão")}</b><small>${invoice.cardLast4 ? `•••• ${esc(invoice.cardLast4)}` : ""}</small></div><em class="financial-status is-${invoice.status === "paid" ? "paid" : invoice.status === "overdue" ? "overdue" : "pending"}">${esc(invoiceStatusLabel[invoice.status] || invoice.status)}</em></div><div class="financial-invoice-cycle"><select aria-label="Escolher ciclo da fatura">${invoiceCycles.map((item) => `<option value="${esc(item.id)}" data-home="${esc(item.cardHomeSpaceId)}" ${item.id === invoice.id ? "selected" : ""}>${esc(monthLabel(item.referenceKey))}</option>`).join("")}</select><span>${icon("calendar-days")} Vence em ${fullDateLabel(invoice.dueDate)}</span></div>`);
      const panels = modal().querySelectorAll("[data-invoice-panel]");
      panels.forEach((panel) => { panel.hidden = false; });
      modal().querySelector(".financial-invoice-tabs")?.setAttribute("hidden", "");
      const purchasePanel = modal().querySelector('[data-invoice-panel="purchases"]'), categoryPanel = modal().querySelector('[data-invoice-panel="categories"]'), spacePanel = modal().querySelector('[data-invoice-panel="spaces"]');
      if (purchasePanel && categoryPanel && spacePanel) { purchasePanel.parentElement.insertBefore(spacePanel, purchasePanel); purchasePanel.parentElement.insertBefore(categoryPanel, spacePanel); }
      modal().querySelector(".financial-invoice-cycle select")?.addEventListener("change", (event) => { const option = event.currentTarget.selectedOptions[0]; openCreditCardInvoice(option.value, option.dataset.home, targetSpaceId); });
      modal().querySelectorAll("[data-invoice-tab]").forEach((button) => button.onclick = () => {
        modal().querySelectorAll("[data-invoice-tab]").forEach((item) => item.classList.toggle("active", item === button));
        modal().querySelectorAll("[data-invoice-panel]").forEach((panel) => { panel.hidden = panel.dataset.invoicePanel !== button.dataset.invoiceTab; });
      });
      modal().querySelector("[data-financial-pay-invoice]")?.addEventListener("click", () => openCreditCardInvoicePayment(invoice));
      modal().querySelector("[data-financial-adjust-invoice]")?.addEventListener("click", () => openCreditCardInvoiceAdjustment(invoice));
      modal().querySelector("[data-financial-ongoing-for-card]")?.addEventListener("click", () => openOngoingInstallment({ id: invoice.creditCardId, cardHomeSpaceId: invoice.cardHomeSpaceId, interactionSpaceId: targetSpaceId }));
      modal().querySelectorAll("[data-filter-category]").forEach((button) => button.onclick = () => {
        const id = button.dataset.filterCategory, name = button.dataset.categoryName;
        modal().querySelectorAll("[data-invoice-tab]").forEach((item) => item.classList.toggle("active", item.dataset.invoiceTab === "purchases"));
        modal().querySelectorAll("[data-invoice-panel]").forEach((panel) => { panel.hidden = panel.dataset.invoicePanel !== "purchases"; });
        modal().querySelectorAll("[data-invoice-purchase]").forEach((row) => { row.hidden = row.dataset.purchaseCategory !== id; });
        modal().querySelector("[data-purchases-title]").textContent = `Compras · ${name}`;
        modal().querySelector("[data-clear-category-filter]").hidden = false;
      });
      modal().querySelector("[data-clear-category-filter]")?.addEventListener("click", (event) => {
        modal().querySelectorAll("[data-invoice-purchase]").forEach((row) => { row.hidden = false; });
        modal().querySelector("[data-purchases-title]").textContent = "Lançamentos da fatura";
        event.currentTarget.hidden = true;
      });
      modal().querySelectorAll("[data-invoice-purchase]").forEach((row) => {
        const openPurchase = () => { const purchase = details.purchases.find((item) => item.id === row.dataset.purchaseId); if (purchase) openCreditCardPurchase(purchase, invoice); };
        row.addEventListener("click", openPurchase);
        row.addEventListener("keydown", (event) => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); openPurchase(); } });
      });
    } catch (error) { Utils.toast(error.message, true); }
  }

  function openCreditCardPurchase(purchase, invoice) {
    sheet(`${sheetHeader("Detalhe da compra", `${invoice.cardName || "Cartão"} · ${monthLabel(invoice.referenceKey)}`)}<div class="modal-body"><article class="financial-account-summary"><span>${icon(purchase.categoryIcon || "shopping-cart")}</span><div><h3>${esc(purchase.description)}</h3><strong>${money(purchase.amountCents)}</strong></div></article><div class="financial-account-details"><span>${icon("calendar-days")} Data <b>${fullDateLabel(purchase.purchaseDate)}</b></span><span>${icon("tag")} Categoria <b>${esc(purchase.categoryName || "Outros")}</b></span><span>${icon("tags")} Subcategoria <b>${esc(purchase.subcategoryName || "Sem detalhar")}</b></span><span>${icon("wallet-cards")} Espaço <b>${esc(purchase.financialSpaceName || spaceName(purchase.financialSpaceId))}</b></span><span>${icon("credit-card")} Cartão <b>${esc(invoice.cardName || "Cartão")}${invoice.cardLast4 ? ` · •••• ${esc(invoice.cardLast4)}` : ""}</b></span><span>${icon("receipt-text")} Fatura <b>${esc(monthLabel(invoice.referenceKey))}</b></span><span>${icon("list-ordered")} Parcelamento <b>${Number(purchase.installmentCount || 1) > 1 ? `${purchase.installmentNumber}/${purchase.installmentCount}` : "À vista"}</b></span><span>${icon("file-clock")} Origem <b>${purchase.sourceType === "opening_balance" ? "Ajuste" : purchase.autoGenerated ? "Automática" : "Manual"}</b></span></div></div><footer class="modal-foot"><button class="btn btn-primary" type="button" data-financial-close>Concluir</button></footer>`, "financial-purchase-sheet");
  }

  function openCreditCardInvoiceAdjustment(invoice) {
    const operationId = `invoice_adjustment_${crypto.randomUUID()}`;
    sheet(`${sheetHeader("Ajustar fatura", "Concilie com o banco sem inventar categorias ou compras.")}<form data-financial-invoice-adjustment><div class="modal-body financial-form-grid"><article class="financial-adjustment-calculation full"><span><small>Valor calculado pela VECONI</small><b>${money(invoice.amountDueCents)}</b></span><span><small>Compras registradas</small><b>${money(invoice.purchasesTotalCents)}</b></span><span><small>Saldo inicial/ajustes atuais</small><b>${money(Math.abs(invoice.adjustmentsTotalCents || 0))}</b></span></article><label class="financial-field full"><span>Valor real da fatura *</span><input name="targetTotal" inputmode="decimal" value="${(invoice.amountDueCents / 100).toFixed(2).replace(".", ",")}" required></label><article class="financial-adjustment-difference full"><small>Diferença a conciliar</small><strong data-adjustment-difference>${money(0)}</strong><span>Será registrada como saldo inicial/ajuste, sem categoria de despesa.</span></article><label class="financial-field full"><span>Motivo <small>(opcional)</small></span><input name="reason" maxlength="300" value="Saldo inicial / conciliação com o banco"></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Salvar ajuste</button></footer></form>`);
    const form = modal().querySelector("[data-financial-invoice-adjustment]"), difference = modal().querySelector("[data-adjustment-difference]");
    const updateDifference = () => { try { const value = Engine.moneyInputToCents(form.targetTotal.value) - invoice.amountDueCents; difference.textContent = `${value < 0 ? "− " : "+ "}${money(Math.abs(value))}`; difference.className = value < 0 ? "is-income" : value > 0 ? "is-expense" : ""; } catch { difference.textContent = "—"; } };
    form.targetTotal.addEventListener("input", updateDifference); updateDifference();
    form.onsubmit = async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)), submit = form.querySelector("[type=submit]"), targetSpaceId = invoice.interactionSpaceId || state.selectedSpaceId; submit.disabled = true; try { await window.FinancialSpaceService.adjustCreditCardInvoice(targetSpaceId, invoice.id, { cardHomeSpaceId: invoice.cardHomeSpaceId, operationId, targetTotalCents: Engine.moneyInputToCents(values.targetTotal), reason: values.reason }); closeModal(); Utils.toast("Fatura conciliada."); await refresh(); } catch (error) { Utils.toast(error.message, true); submit.disabled = false; } };
  }

  async function openOngoingInstallment(preferredCard = null) {
    if (state.consolidated && !preferredCard?.interactionSpaceId) return openActionSpacePicker("Em qual espaço registrar as parcelas?", () => openOngoingInstallment());
    const targetSpaceId = preferredCard?.interactionSpaceId || state.selectedSpaceId, service = window.FinancialSpaceService,
      cards = preferredCard?.interactionSpaceId ? await service.listCreditCards(targetSpaceId) : state.dashboard?.creditCards?.length ? state.dashboard.creditCards : await service.listCreditCards(targetSpaceId),
      categories = (await service.listCategories(targetSpaceId)).filter((item) => item.type === "category"), operationId = `ongoing_installment_${crypto.randomUUID()}`;
    if (!cards.length) return openCreateCreditCard(() => openOngoingInstallment());
    const selectedCard = cards.find((card) => card.id === preferredCard?.id && card.cardHomeSpaceId === preferredCard?.cardHomeSpaceId) || cards[0];
    sheet(`${sheetHeader("Parcelamento em andamento", "Cadastre somente a parcela atual e as futuras.")}<form data-financial-ongoing-installment><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Descrição *</span><input name="description" maxlength="160" placeholder="Ex.: Notebook" required></label><label class="financial-field full"><span>Cartão *</span><select name="cardKey">${cards.map((card) => `<option value="${esc(`${card.cardHomeSpaceId}::${card.id}`)}" ${card === selectedCard ? "selected" : ""}>${esc(cardNameLabel(card))}</option>`).join("")}</select></label><label class="financial-field full"><span>Categoria *</span><select name="categoryId">${categories.map((category) => `<option value="${esc(category.id)}" data-name="${esc(category.name)}" data-icon="${esc(category.icon || "shapes")}">${esc(category.name)}</option>`).join("")}</select></label><label class="financial-field"><span>Valor da parcela *</span><input name="installmentAmount" inputmode="decimal" placeholder="R$ 0,00" required></label><label class="financial-field"><span>Parcela atual *</span><input name="currentInstallment" type="number" min="1" max="60" value="1" required></label><label class="financial-field"><span>Total de parcelas *</span><input name="totalInstallments" type="number" min="1" max="60" value="2" required></label><label class="financial-field"><span>Primeira fatura controlada *</span><input name="purchaseDate" type="date" value="${Engine.localIsoDate()}" required></label><label class="financial-field full"><span>Observação <small>(opcional)</small></span><textarea name="notes" maxlength="500"></textarea></label><article class="financial-wizard-info full">${icon("history")} Parcelas anteriores não serão recriadas nem alterarão seu histórico.</article></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Adicionar parcelas futuras</button></footer></form>`, "financial-ongoing-sheet");
    const form = modal().querySelector("[data-financial-ongoing-installment]");
    form.onsubmit = async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)), [cardHomeSpaceId, creditCardId] = values.cardKey.split("::"), option = form.categoryId.selectedOptions[0], submit = form.querySelector("[type=submit]"); submit.disabled = true; try { await service.createOngoingCreditCardInstallment(targetSpaceId, { operationId, description: values.description, creditCardId, cardHomeSpaceId, installmentAmountCents: Engine.moneyInputToCents(values.installmentAmount), currentInstallment: Number(values.currentInstallment), totalInstallments: Number(values.totalInstallments), purchaseDate: new Date(`${values.purchaseDate}T12:00:00`).toISOString(), categoryId: values.categoryId, categoryName: option.dataset.name, categoryIcon: option.dataset.icon, notes: values.notes }); closeModal(); Utils.toast("Parcelas atuais e futuras adicionadas."); await refresh(); } catch (error) { Utils.toast(error.message, true); submit.disabled = false; } };
  }

  async function openCreditCardInvoicePayment(invoice) {
    const targetSpaceId = invoice.interactionSpaceId || state.selectedSpaceId, accounts = await window.FinancialSpaceService.listFinancialAccounts(targetSpaceId);
    if (!accounts.length) return openCreateFinancialAccount(() => openCreditCardInvoicePayment(invoice));
    const operationId = crypto.randomUUID();
    sheet(`${sheetHeader("Pagar fatura", "O pagamento será saída de caixa, sem repetir as despesas.")}<form data-financial-invoice-payment><div class="modal-body financial-form-grid"><article class="financial-payment-balance full"><small>Saldo da fatura</small><strong>${money(invoice.remainingCents)}</strong></article><label class="financial-field full"><span>Conta de origem *</span><select name="financialAccountKey">${accounts.map((account) => `<option value="${esc(accountChoiceValue(account))}">${esc(account.name)} · ${esc(accountScopeLabel(account))}</option>`).join("")}</select></label><label class="financial-field"><span>Valor *</span><input name="amount" inputmode="decimal" value="${(invoice.remainingCents / 100).toFixed(2).replace(".", ",")}" required></label><label class="financial-field"><span>Data *</span><input type="date" name="paidAt" value="${Engine.localIsoDate()}" required></label><label class="financial-field full"><span>Forma *</span><select name="paymentMethod"><option value="pix">Pix</option><option value="automatic_debit">Débito automático</option><option value="transfer">Transferência</option><option value="cash">Dinheiro</option><option value="debit_card">Débito</option><option value="other">Outro</option></select></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Confirmar pagamento</button></footer></form>`);
    const form = modal().querySelector("[data-financial-invoice-payment]");
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = Object.fromEntries(new FormData(form)), amountCents = Engine.moneyInputToCents(values.amount), submit = form.querySelector("[type=submit]"), account = accountFromChoice(accounts, values.financialAccountKey);
      if (amountCents > invoice.remainingCents) return Utils.toast("O pagamento não pode ser maior que o saldo da fatura.", true);
      submit.disabled = true;
      try {
        await window.FinancialSpaceService.payCreditCardInvoice(targetSpaceId, invoice.id, { ...values, financialAccountId: account?.id, financialAccountHomeSpaceId: accountHomeSpaceId(account), cardHomeSpaceId: invoice.cardHomeSpaceId, operationId, amountCents, paidAt: new Date(`${values.paidAt}T12:00:00`).toISOString() });
        closeModal();
        Utils.toast(amountCents === invoice.remainingCents ? "Fatura paga." : "Pagamento parcial registrado.");
        await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  async function openEntryForm(direction = "out") {
    if (state.consolidated) return openActionSpacePicker(direction === "out" ? "Em qual espaço registrar a despesa?" : "Em qual espaço registrar a entrada?", () => openEntryForm(direction));
    const service = window.FinancialSpaceService, categoryItems = await service.listCategories(state.selectedSpaceId), isExpense = direction === "out",
      financialAccounts = await service.listFinancialAccounts(state.selectedSpaceId),
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
        financialAccountKey: financialAccounts[0] ? accountChoiceValue(financialAccounts[0]) : "",
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
      for (const name of ["description", "amount", "customCategoryName", "customSubcategoryName", "frequency", "dueAt", "paymentMethod", "financialAccountKey", "paidAt", "purchaseDate", "creditCardId", "notes", "categorySearch"])
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
        return `<div class="modal-body financial-wizard-body"><h3>Qual cartão?</h3><p>Cartões compartilhados autorizados também aparecem aqui.</p>${cards.length ? `<div class="financial-card-choice">${cards.map((card) => `<button type="button" data-wizard-credit-card="${esc(card.id)}" data-card-home="${esc(card.cardHomeSpaceId)}" class="${draft.creditCardId === card.id && draft.cardHomeSpaceId === card.cardHomeSpaceId ? "active" : ""}">${icon("credit-card")}<span><b>${esc(cardNameLabel(card))}</b><small>${esc(cardScopeLabel(card))} · ${card.currentInvoice ? `${money(card.currentInvoice.currentSpaceAmountCents || 0)} deste espaço` : `fecha dia ${card.closingDay}`}</small></span>${draft.creditCardId === card.id && draft.cardHomeSpaceId === card.cardHomeSpaceId ? icon("circle-check") : ""}</button>`).join("")}</div>` : `<div class="financial-empty-inline">${icon("credit-card")}<div><b>Nenhum cartão disponível</b><span>Cadastre um sem perder os dados já preenchidos.</span></div></div>`}<button type="button" class="btn btn-light financial-inline-create" data-wizard-create-card>${icon("plus")} Cadastrar cartão</button><div class="financial-form-grid"><label class="financial-field"><span>Data da compra *</span><input type="date" name="purchaseDate" value="${esc(draft.purchaseDate)}" required></label><label class="financial-field"><span>Parcelas *</span><input type="number" name="installmentCount" min="1" max="60" value="${draft.installmentCount}"></label></div>${preview ? `<article class="financial-invoice-preview">${icon("calendar-check")}<span><b>Fatura ${monthLabel(preview.referenceKey)}</b><small>Fecha ${dateLabel(preview.closingDate)} · vence ${dateLabel(preview.dueDate)}</small></span><strong>${money(Engine.moneyInputToCents(draft.amount))}</strong></article>` : ""}<label class="financial-field"><span>Observação <small>(opcional)</small></span><textarea name="notes" maxlength="500">${esc(draft.notes)}</textarea></label></div>`;
      }
      if (draft.paymentChoice === "pending") return `<div class="modal-body financial-wizard-body"><h3>Quando e como essa conta funciona?</h3><p>Vencimento só é pedido porque o dinheiro ainda não saiu.</p><div class="financial-schedule-picker"><button type="button" data-wizard-schedule="once" class="${draft.scheduleMode === "once" ? "active" : ""}">${icon("calendar")}<span><b>Uma vez</b><small>Uma única conta.</small></span></button><button type="button" data-wizard-schedule="recurring" class="${draft.scheduleMode === "recurring" ? "active" : ""}">${icon("refresh-cw")}<span><b>Recorrente</b><small>Repete até cancelar.</small></span></button><button type="button" data-wizard-schedule="installments" class="${draft.scheduleMode === "installments" ? "active" : ""}">${icon("list-ordered")}<span><b>Parcelada</b><small>Várias contas mensais.</small></span></button></div><div class="financial-form-grid"><label class="financial-field full"><span>Primeiro vencimento *</span><input type="date" name="dueAt" value="${esc(draft.dueAt)}" required></label>${draft.scheduleMode === "recurring" ? `<label class="financial-field full"><span>Repete *</span><select name="frequency"><option value="weekly" ${draft.frequency === "weekly" ? "selected" : ""}>Semanalmente</option><option value="biweekly" ${draft.frequency === "biweekly" ? "selected" : ""}>Quinzenalmente</option><option value="monthly" ${draft.frequency === "monthly" ? "selected" : ""}>Mensalmente</option><option value="yearly" ${draft.frequency === "yearly" ? "selected" : ""}>Anualmente</option></select></label>` : ""}${draft.scheduleMode === "installments" ? `<label class="financial-field full"><span>Quantidade de parcelas *</span><input type="number" name="installmentCount" min="2" max="60" value="${Math.max(2, draft.installmentCount)}"></label>` : ""}</div><label class="financial-field"><span>Observação <small>(opcional)</small></span><textarea name="notes" maxlength="500">${esc(draft.notes)}</textarea></label></div>`;
      const accountFlowLabel = isExpense ? "De onde saiu o dinheiro?" : "Onde você recebeu?";
      return `<div class="modal-body financial-wizard-body"><h3>${isExpense ? "Quando você pagou?" : "Quando você recebeu?"}</h3><p>Pagamento imediato entra no fluxo de caixa realizado.</p><div class="financial-form-grid">${draft.paymentChoice === "pix" ? `<label class="financial-field full"><span>Forma *</span><select name="paymentMethod"><option value="pix" ${draft.paymentMethod === "pix" ? "selected" : ""}>PIX</option><option value="transfer" ${draft.paymentMethod === "transfer" ? "selected" : ""}>Transferência</option></select></label>` : ""}<label class="financial-field full"><span>${accountFlowLabel} *</span><select name="financialAccountKey"><option value="">Escolher conta ou carteira</option>${financialAccounts.map((account) => `<option value="${esc(accountChoiceValue(account))}" ${accountChoiceValue(account) === draft.financialAccountKey ? "selected" : ""}>${esc(account.name)} · ${money(Engine.financialAccountBalance(account))} · ${esc(accountScopeLabel(account))}</option>`).join("")}</select><small>O saldo mostrado é único e controlado pela VECONI; não consultamos o banco.</small></label><button type="button" class="btn btn-light financial-inline-create full" data-wizard-create-account>${icon("plus")} Cadastrar nova conta</button><label class="financial-field full"><span>Data *</span><input type="date" name="paidAt" value="${esc(draft.paidAt)}" required></label></div><label class="financial-field"><span>Observação <small>(opcional)</small></span><textarea name="notes" maxlength="500">${esc(draft.notes)}</textarea></label><label class="financial-file"><input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf"><span>${icon("paperclip")}<b>${draft.attachment ? esc(draft.attachment.name) : "Anexar comprovante"}</b><small>JPG, PNG, WebP ou PDF · até 10 MB</small></span></label></div>`;
    };
    const stepFour = () => {
      const category = selectedCategory(), subcategory = selectedSubcategory(), categoryName = draft.customCategoryName || category?.name || "—", subcategoryName = draft.customSubcategoryName || subcategory?.name || "Sem detalhar",
        card = cards.find((item) => item.id === draft.creditCardId && item.cardHomeSpaceId === draft.cardHomeSpaceId), paymentDescription = draft.paymentChoice === "credit_card" ? `${card?.name || "Cartão"} · ${draft.installmentCount}x` : draft.paymentChoice === "pending" ? `Pendente · ${scheduleLabel()}` : paymentLabel[draft.paymentMethod] || "Pagamento imediato",
        dateDescription = draft.paymentChoice === "credit_card" ? `Compra em ${dateLabel(`${draft.purchaseDate}T12:00:00`)}` : draft.paymentChoice === "pending" ? `Vence ${dateLabel(`${draft.dueAt}T12:00:00`)}` : `Realizado em ${dateLabel(`${draft.paidAt}T12:00:00`)}`,
        destinationAccount = accountFromChoice(financialAccounts, draft.financialAccountKey);
      return `<div class="modal-body financial-wizard-body"><h3>Conferir e salvar</h3><p>Revise as informações antes de criar.</p><article class="financial-wizard-review"><header><span>${icon(category?.icon || "receipt-text")}</span><div><b>${esc(draft.description)}</b><strong>${money(Engine.moneyInputToCents(draft.amount))}</strong></div></header><dl><div><dt>Categoria</dt><dd>${esc(categoryName)}</dd></div><div><dt>Subcategoria</dt><dd>${esc(subcategoryName)}</dd></div><div><dt>Tipo</dt><dd>${isExpense ? draft.entryType === "investment" ? "Investimento" : "Despesa" : "Entrada"}</dd></div><div><dt>Pagamento</dt><dd>${esc(paymentDescription)}</dd></div>${!["pending", "credit_card"].includes(draft.paymentChoice) ? `<div><dt>${isExpense ? "Origem" : "Destino"}</dt><dd>${esc(destinationAccount?.name || "—")}</dd></div>` : ""}<div><dt>Data</dt><dd>${esc(dateDescription)}</dd></div><div><dt>Efeito no caixa</dt><dd>${draft.paymentChoice === "credit_card" || draft.paymentChoice === "pending" ? "Ainda não" : "Imediato"}</dd></div></dl></article>${draft.paymentChoice === "credit_card" ? `<div class="financial-wizard-success-note">${icon("shield-check")}<span><b>Sem despesa duplicada</b><small>A compra entra nos gastos; o pagamento da fatura entrará somente no caixa.</small></span></div>` : `<div class="financial-wizard-success-note">${icon("circle-check")}<span><b>${isExpense ? "Despesa" : "Entrada"} pronta para ser criada</b><small>Categoria, recorrência e tipo continuarão independentes.</small></span></div>`}</div>`;
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
        if (!["credit_card", "pending"].includes(draft.paymentChoice) && !draft.financialAccountKey) throw new Error(`Escolha a conta ou carteira de ${isExpense ? "origem" : "destino"}.`);
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
      host.querySelector("[data-wizard-create-account]")?.addEventListener("click", () => { syncVisibleFields(); openCreateFinancialAccount(async (account) => { financialAccounts.push(account); draft.financialAccountKey = accountChoiceValue(account); sheet(`<div data-financial-entry-wizard></div>`, "financial-entry-wizard"); host = modal().querySelector("[data-financial-entry-wizard]"); renderWizard(); }); });
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
          const amountCents = Engine.moneyInputToCents(draft.amount), selectedFinancialAccount = accountFromChoice(financialAccounts, draft.financialAccountKey), common = {
            direction, description: draft.description, entryType: draft.entryType,
            categoryId: category.id, categoryName: category.name, categoryIcon: category.icon,
            subcategoryId: subcategory?.id || null, subcategoryName: subcategory?.name || null,
            amountCents, notes: draft.notes,
            financialAccountId: !["credit_card", "pending"].includes(draft.paymentChoice) ? selectedFinancialAccount?.id : null,
            financialAccountHomeSpaceId: !["credit_card", "pending"].includes(draft.paymentChoice) && selectedFinancialAccount ? accountHomeSpaceId(selectedFinancialAccount) : null,
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

  async function openRegisterPayment(selectedEntry = null) {
    if (state.consolidated) return openActionSpacePicker("De qual espaço é a conta?", () => openRegisterPayment());
    const entries = (state.dashboard?.payables || []).filter((entry) => entry.entityType !== "credit_card_invoice");
    if (!entries.length) return Utils.toast("Não existem contas pendentes neste espaço.");
    const service = window.FinancialSpaceService, [cards, accounts] = await Promise.all([
      service.listCreditCards(state.selectedSpaceId),
      service.listFinancialAccounts(state.selectedSpaceId),
    ]), draft = {
      step: 1,
      entryId: selectedEntry?.id || entries[0].id,
      paymentMethod: "",
      paidAt: Engine.localIsoDate(),
      financialAccountKey: accounts[0] ? accountChoiceValue(accounts[0]) : "",
      creditCardId: "",
      cardHomeSpaceId: "",
      feeEnabled: false,
      fee: "",
      notes: "",
      operationId: `bill_payment_${crypto.randomUUID()}`,
      preview: null,
    };
    let host;
    const selected = () => entries.find((item) => item.id === draft.entryId) || entries[0],
      selectedCard = () => cards.find((item) => item.id === draft.creditCardId && item.cardHomeSpaceId === draft.cardHomeSpaceId),
      sync = () => {
        host?.querySelectorAll("input,select,textarea").forEach((field) => {
          if (field.name === "feeEnabled") draft.feeEnabled = field.checked;
          else draft[field.name] = field.value;
        });
      }, restore = () => {
        sheet(`<div data-financial-payment-wizard></div>`, "financial-payment-wizard");
        host = modal().querySelector("[data-financial-payment-wizard]");
        renderWizard();
      }, methodChoices = [
        ["pix", "scan-line", "PIX", "Saída imediata"],
        ["cash", "banknote", "Dinheiro", "Saída imediata"],
        ["debit_card", "credit-card", "Cartão de débito", "Saída imediata"],
        ["credit_card", "calendar-range", "Cartão de crédito", "Vai para uma fatura"],
        ["transfer", "arrow-left-right", "Transferência", "Saída imediata"],
        ["other", "wallet", "Outro", "Saída imediata"],
      ];
    const stepOne = () => `<div class="modal-body financial-wizard-body"><h3>Qual conta você vai pagar?</h3><p>O valor vem da conta original e não será alterado silenciosamente.</p><label class="financial-field"><span>Conta *</span><select name="entryId">${entries.map((item) => `<option value="${esc(item.id)}" ${item.id === draft.entryId ? "selected" : ""}>${esc(item.description)} · ${money(item.amountCents)}</option>`).join("")}</select></label><article class="financial-account-summary"><span>${icon(selected().categoryIcon || "receipt-text")}</span><div><h3>${esc(selected().description)}</h3><strong>${money(selected().amountCents)}</strong></div></article></div>`;
    const stepTwo = () => `<div class="modal-body financial-wizard-body"><h3>Como você pagou?</h3><p>Crédito cria obrigação na fatura; os outros meios saem do caixa agora.</p><div class="financial-payment-method-cards">${methodChoices.map(([id, iconName, title, helper]) => `<button type="button" data-payment-method="${id}" class="${draft.paymentMethod === id ? "active" : ""}">${icon(iconName)}<span><b>${title}</b><small>${helper}</small></span>${draft.paymentMethod === id ? icon("circle-check") : ""}</button>`).join("")}</div></div>`;
    const stepThree = () => {
      if (draft.paymentMethod !== "credit_card") return `<div class="modal-body financial-wizard-body"><h3>Dados do pagamento</h3><p>Esse meio registra uma saída de caixa imediata.</p><div class="financial-form-grid"><label class="financial-field"><span>Data *</span><input type="date" name="paidAt" value="${esc(draft.paidAt)}" required></label><label class="financial-field"><span>De onde saiu o dinheiro? *</span><select name="financialAccountKey"><option value="">Escolher origem</option>${accounts.map((account) => `<option value="${esc(accountChoiceValue(account))}" ${accountChoiceValue(account) === draft.financialAccountKey ? "selected" : ""}>${esc(account.name)} · ${money(Engine.financialAccountBalance(account))} · ${esc(accountScopeLabel(account))}</option>`).join("")}</select><small>A saída será abatida do saldo único desta conta.</small></label><label class="financial-field full"><span>Observação</span><textarea name="notes" maxlength="500">${esc(draft.notes)}</textarea></label></div></div>`;
      return `<div class="modal-body financial-wizard-body"><h3>Qual cartão?</h3><p>Somente cartões autorizados neste espaço são listados.</p>${cards.length ? `<div class="financial-card-choice">${cards.map((card) => `<button type="button" data-payment-card="${esc(card.id)}" data-card-home="${esc(card.cardHomeSpaceId)}" class="${draft.creditCardId === card.id && draft.cardHomeSpaceId === card.cardHomeSpaceId ? "active" : ""}">${icon("credit-card")}<span><b>${esc(cardNameLabel(card))}</b><small>${esc(cardScopeLabel(card))}${card.currentInvoice ? ` · fatura ${money(card.currentInvoice.amountDueCents || 0)}` : ` · fecha dia ${card.closingDay}`}</small></span>${draft.creditCardId === card.id && draft.cardHomeSpaceId === card.cardHomeSpaceId ? icon("circle-check") : ""}</button>`).join("")}</div>` : `<div class="financial-empty-inline">${icon("credit-card")}<div><b>Nenhum cartão disponível</b><span>Cadastre um sem perder os dados deste pagamento.</span></div></div>`}<button class="btn btn-light financial-inline-create" type="button" data-payment-create-card>${icon("plus")} Cadastrar cartão</button><div class="financial-form-grid"><label class="financial-field full"><span>Data de uso do cartão *</span><input type="date" name="paidAt" value="${esc(draft.paidAt)}" required><small>A fatura é calculada pelo fechamento e vencimento do cartão.</small></label><label class="financial-toggle full"><input type="checkbox" name="feeEnabled" ${draft.feeEnabled ? "checked" : ""}><span></span><b>Adicionar taxa/encargo real</b></label>${draft.feeEnabled ? `<label class="financial-field full"><span>Taxa *</span><input name="fee" inputmode="decimal" value="${esc(draft.fee)}" placeholder="R$ 0,00"><small>Será uma despesa separada em Financeiro → Taxas financeiras.</small></label>` : ""}<label class="financial-field full"><span>Observação</span><textarea name="notes" maxlength="500">${esc(draft.notes)}</textarea></label></div></div>`;
    };
    const stepFour = () => {
      const item = selected(), card = selectedCard(), feeCents = draft.feeEnabled ? Engine.moneyInputToCents(draft.fee) : 0,
        totalCents = Number(item.amountCents) + feeCents;
      if (draft.paymentMethod !== "credit_card") return `<div class="modal-body financial-wizard-body"><h3>Conferir pagamento</h3><p>Revise antes de registrar.</p><article class="financial-wizard-review"><header><span>${icon("circle-check-big")}</span><div><b>${esc(item.description)}</b><strong>${money(item.amountCents)}</strong></div></header><dl><div><dt>Forma</dt><dd>${esc(paymentLabel[draft.paymentMethod])}</dd></div><div><dt>Data</dt><dd>${fullDateLabel(`${draft.paidAt}T12:00:00`)}</dd></div><div><dt>Saída do caixa agora</dt><dd>${money(item.amountCents)}</dd></div></dl></article></div>`;
      return `<div class="modal-body financial-wizard-body"><h3>Prévia da fatura</h3><p>O vencimento foi resolvido automaticamente.</p><article class="financial-wizard-review"><header><span>${icon("receipt-text")}</span><div><b>${esc(item.description)}</b><strong>${money(item.amountCents)}</strong></div></header><dl><div><dt>Pago com</dt><dd>${esc(card?.name || "Cartão")} · •••• ${esc(card?.last4 || "")}</dd></div><div><dt>Será lançado em</dt><dd>Fatura ${monthLabel(draft.preview.invoice.referenceKey)}</dd></div><div><dt>Vencimento</dt><dd>${fullDateLabel(draft.preview.invoice.dueDate)}</dd></div><div><dt>Valor da conta</dt><dd>${money(item.amountCents)}</dd></div>${feeCents ? `<div><dt>Taxa financeira</dt><dd>${money(feeCents)}</dd></div>` : ""}<div><dt>Total no cartão</dt><dd>${money(totalCents)}</dd></div><div><dt>Fatura após confirmar</dt><dd>${money(draft.preview.invoiceTotalAfterCents)}</dd></div><div><dt>Saída do caixa agora</dt><dd>R$ 0,00</dd></div></dl></article><div class="financial-wizard-success-note">${icon("shield-check")}<span><b>Sem despesa duplicada</b><small>A conta será liquidada na fatura. O caixa só muda quando a fatura for paga.</small></span></div></div>`;
    };
    const renderWizard = () => {
      host.innerHTML = `<header class="modal-head financial-wizard-head"><div><small>Passo ${draft.step} de 4</small><div class="financial-wizard-progress">${[1,2,3,4].map((step) => `<i class="${step <= draft.step ? "active" : ""}"></i>`).join("")}</div></div><button class="icon-btn" type="button" data-financial-close>${icon("x")}</button></header>${[stepOne, stepTwo, stepThree, stepFour][draft.step - 1]()}<footer class="modal-foot"><button class="btn btn-light" type="button" data-payment-back>${draft.step === 1 ? "Cancelar" : "Voltar"}</button><button class="btn btn-primary" type="button" data-payment-next>${draft.step === 4 ? "Confirmar pagamento" : "Continuar"}</button></footer>`;
      host.querySelector("[data-financial-close]").onclick = closeModal;
      host.querySelector("[data-payment-back]").onclick = () => { sync(); if (draft.step === 1) closeModal(); else { draft.step--; renderWizard(); } };
      host.querySelectorAll("[data-payment-method]").forEach((button) => button.onclick = () => { sync(); draft.paymentMethod = button.dataset.paymentMethod; draft.preview = null; renderWizard(); });
      host.querySelectorAll("[data-payment-card]").forEach((button) => button.onclick = () => { sync(); draft.creditCardId = button.dataset.paymentCard; draft.cardHomeSpaceId = button.dataset.cardHome; draft.preview = null; renderWizard(); });
      host.querySelector('[name="feeEnabled"]')?.addEventListener("change", (event) => { sync(); draft.feeEnabled = event.currentTarget.checked; if (!draft.feeEnabled) draft.fee = ""; draft.preview = null; renderWizard(); });
      host.querySelector("[data-payment-create-card]")?.addEventListener("click", () => { sync(); openCreateCreditCard(async (card) => { cards.push(card); draft.creditCardId = card.id; draft.cardHomeSpaceId = card.cardHomeSpaceId; restore(); }); });
      host.querySelector("[data-payment-next]").onclick = async (event) => {
        try {
          sync();
          if (draft.step === 1 && !selected()) throw new Error("Escolha a conta.");
          if (draft.step === 2 && !draft.paymentMethod) throw new Error("Escolha como você pagou.");
          if (draft.step === 3) {
            if (!draft.paidAt) throw new Error("Informe a data do pagamento.");
            if (draft.paymentMethod === "credit_card") {
              if (!selectedCard()) throw new Error("Escolha o cartão de crédito.");
              const feeCents = draft.feeEnabled ? Engine.moneyInputToCents(draft.fee) : 0;
              draft.preview = await service.resolveCreditCardInvoice(state.selectedSpaceId, { entryId: selected().id, amountCents: selected().amountCents, creditCardId: draft.creditCardId, cardHomeSpaceId: draft.cardHomeSpaceId, purchaseDate: new Date(`${draft.paidAt}T12:00:00`).toISOString(), feeCents });
            } else if (!draft.financialAccountKey) throw new Error("Escolha a conta ou carteira de origem.");
          }
          if (draft.step < 4) { draft.step++; renderWizard(); return; }
          event.currentTarget.disabled = true;
          const common = { operationId: draft.operationId, paidAt: new Date(`${draft.paidAt}T12:00:00`).toISOString(), notes: draft.notes };
          if (draft.paymentMethod === "credit_card") await service.payEntryByCreditCard(state.selectedSpaceId, selected(), { ...common, purchaseDate: common.paidAt, creditCardId: draft.creditCardId, cardHomeSpaceId: draft.cardHomeSpaceId, feeCents: draft.feeEnabled ? Engine.moneyInputToCents(draft.fee) : 0 });
          else {
            const account = accountFromChoice(accounts, draft.financialAccountKey);
            await service.markPaid(state.selectedSpaceId, selected(), { ...common, paymentMethod: draft.paymentMethod, financialAccountId: account?.id, financialAccountHomeSpaceId: accountHomeSpaceId(account) });
          }
          closeModal();
          Utils.toast(draft.paymentMethod === "credit_card" ? "Conta liquidada na fatura, sem saída de caixa agora." : "Pagamento registrado.");
          await refresh();
        } catch (error) { Utils.toast(error.message, true); event.currentTarget.disabled = false; }
      };
      window.lucide?.createIcons();
    };
    restore();
  }

  const frequencyLabel = (frequency) => ({ weekly: "Toda semana", biweekly: "A cada 15 dias", monthly: "Todo mês", yearly: "Todo ano" })[frequency] || "Sem recorrência";
  const entryOriginLabel = (entry) => entry.recurrenceId
    ? "Despesa recorrente"
    : entry.installmentGroupId ? "Despesa parcelada" : ({ sale: "Venda", sale_receipt: "Venda recebida", customer_payment: "Pagamento de cliente", customer_payment_reversal: "Estorno de pagamento", sale_reversal: "Estorno de venda", transfer: "Transferência", reversal: "Estorno", manual_income: "Entrada manual", investment: "Investimento" })[entry.sourceType] || "Despesa avulsa";

  async function openAccount(entry) {
    if (!entry) return;
    const systemControlled = entry.autoGenerated === true, editable = !systemControlled && entry.status === "pending",
      undoable = !systemControlled && entry.status === "paid" && entry.sourceType !== "reversal" && entry.sourceType !== "credit_card_refund";
    sheet(`${sheetHeader(systemControlled ? "Detalhes do lançamento" : "Detalhes da conta", `${money(entry.amountCents)} · ${statusLabel(entry)}`)}<div class="modal-body"><article class="financial-account-summary"><span>${icon(entry.categoryIcon || "receipt-text")}</span><div><h3>${esc(entry.description)}</h3><strong>${money(entry.amountCents)}</strong></div></article><div class="financial-account-details"><span>${icon("tag")} Categoria <b>${esc(entry.categoryName || "Outros")}</b></span><span>${icon("tags")} Subcategoria <b>${esc(entry.subcategoryName || "Sem detalhar")}</b></span><span>${icon("circle-dot")} Status <b>${statusLabel(entry)}</b></span><span>${icon("calendar-days")} ${entry.direction === "in" ? "Recebido em" : "Vencimento"} <b>${fullDateLabel(entry.occurredAt || entry.dueAt)}</b></span>${entry.paymentMethod ? `<span>${icon("wallet-cards")} Forma de pagamento <b>${esc(paymentLabel[entry.paymentMethod] || entry.paymentMethod)}</b></span>` : ""}${entry.paymentMethod === "credit_card" && entry.cardChargedAmountCents ? `<span>${icon("receipt")} Total no cartão <b>${money(entry.cardChargedAmountCents)}</b></span>` : ""}<span>${icon("repeat")} Recorrência <b>${entry.recurrenceId ? frequencyLabel(entry.frequency) : "Não"}</b></span><span>${icon("file-clock")} Origem <b>${entryOriginLabel(entry)}</b></span></div>${systemControlled ? `<div class="financial-automation-note">${icon("shield-check")}<span><b>Lançamento automático</b><small>Para corrigir ou estornar, altere a venda ou o pagamento de origem. O Financeiro preservará o histórico.</small></span></div>` : ""}<div class="financial-account-actions">${editable ? `<button class="btn btn-primary" type="button" data-financial-account-pay>${icon("circle-check-big")} Marcar como paga</button><button class="btn btn-light" type="button" data-financial-account-edit>${icon("pencil")} Editar</button><button class="btn btn-light financial-danger-action" type="button" data-financial-account-cancel>${icon("trash-2")} Excluir</button>` : ""}${entry.creditCardInvoiceId ? `<button class="btn btn-light" type="button" data-financial-account-invoice>${icon("receipt-text")} Ver fatura</button>` : ""}${undoable ? `<button class="btn btn-light financial-danger-action" type="button" data-financial-account-undo>${icon("undo-2")} Desfazer pagamento</button>` : ""}${entry.recurrenceId ? `<button class="btn btn-light" type="button" data-financial-manage-recurrence>${icon("calendar-cog")} Gerenciar recorrência</button>` : ""}${systemControlled ? "" : `<label class="btn btn-light financial-attachment-action">${icon("paperclip")} Anexar comprovante<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden></label>`}</div></div>`);
    modal().querySelector("[data-financial-account-pay]")?.addEventListener("click", () => { closeModal(); openRegisterPayment(entry); });
    modal().querySelector("[data-financial-account-edit]")?.addEventListener("click", () => entry.recurrenceId ? openEditChoice(entry) : openEditAccount(entry, "occurrence"));
    modal().querySelector("[data-financial-account-cancel]")?.addEventListener("click", () => entry.recurrenceId ? openDeleteChoice(entry) : confirmOccurrenceCancellation(entry));
    modal().querySelector("[data-financial-account-invoice]")?.addEventListener("click", () => openCreditCardInvoice(entry.creditCardInvoiceId, entry.cardHomeSpaceId));
    modal().querySelector("[data-financial-account-undo]")?.addEventListener("click", () => confirmPaymentUndo(entry));
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

  function confirmPaymentUndo(entry) {
    const linkedToCard = entry.paymentMethod === "credit_card" && entry.creditCardInvoiceId;
    sheet(`${sheetHeader("Desfazer pagamento?", "Isso corrige o registro; não representa dinheiro recebido.")}<div class="modal-body financial-confirm-copy">${icon("rotate-ccw")}<p><b>${esc(entry.description)}</b><span>${linkedToCard ? "A conta voltará a ficar pendente e a cobrança será creditada na fatura." : "A conta voltará a ficar pendente, sem criar uma entrada positiva."}</span></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Voltar</button><button class="btn btn-light financial-danger-action" type="button" data-financial-confirm-undo>Desfazer pagamento</button></footer>`);
    modal().querySelector("[data-financial-confirm-undo]").onclick = async (event) => { event.currentTarget.disabled = true; try { await window.FinancialSpaceService.undoEntryPayment(state.selectedSpaceId, entry, "Registro desfeito pelo usuário"); closeModal(); Utils.toast("Pagamento desfeito; a conta voltou a ficar pendente."); await refresh(); } catch (error) { Utils.toast(error.message, true); event.currentTarget.disabled = false; } };
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

  async function openTransfer() {
    if (state.consolidated) return openActionSpacePicker("Escolha o espaço de origem", () => openTransfer());
    const service = window.FinancialSpaceService, targets = spaces(), fromAccounts = await service.listFinancialAccounts(state.selectedSpaceId);
    if (!fromAccounts.length) return openCreateFinancialAccount(() => openTransfer());
    sheet(`${sheetHeader("Transferir", "Movimentação interna não altera receita, despesa ou resultado.")}<form data-financial-transfer-form><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Conta de origem *</span><select name="fromFinancialAccountKey">${fromAccounts.map((account) => `<option value="${esc(accountChoiceValue(account))}">${esc(account.name)} · ${esc(accountScopeLabel(account))}</option>`).join("")}</select></label><label class="financial-field full"><span>Espaço de destino *</span><select name="toSpaceId">${targets.map((space) => `<option value="${esc(space.id)}" ${space.id === state.selectedSpaceId ? "selected" : ""}>${esc(space.name)}</option>`).join("")}</select></label><label class="financial-field full"><span>Conta de destino *</span><select name="toFinancialAccountKey"></select><small data-transfer-account-helper></small></label><label class="financial-field"><span>Valor *</span><input name="amount" inputmode="decimal" placeholder="R$ 0,00" required></label><label class="financial-field"><span>Data *</span><input type="date" name="occurredAt" value="${Engine.localIsoDate()}" required></label><label class="financial-field full"><span>Observação</span><input name="description" maxlength="160" placeholder="Ex.: Reserva para despesas da casa"></label><article class="financial-wizard-info full">${icon("scale")} Saída e entrada ficam vinculadas pelo mesmo identificador. No consolidado, o efeito é zero.</article></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Transferir</button></footer></form>`);
    const form = modal().querySelector("[data-financial-transfer-form]"), helper = modal().querySelector("[data-transfer-account-helper]"), transferId = `transfer_${crypto.randomUUID()}`;
    const loadDestinationAccounts = async () => {
      form.toFinancialAccountKey.disabled = true;
      const available = form.toSpaceId.value === state.selectedSpaceId ? fromAccounts : await service.listFinancialAccounts(form.toSpaceId.value),
        accounts = available.filter((account) => accountChoiceValue(account) !== form.fromFinancialAccountKey.value);
      form.toFinancialAccountKey.innerHTML = accounts.length ? accounts.map((account) => `<option value="${esc(accountChoiceValue(account))}">${esc(account.name)} · ${esc(accountScopeLabel(account))}</option>`).join("") : `<option value="">Nenhuma conta cadastrada</option>`;
      helper.textContent = accounts.length ? "Escolha onde o valor ficará registrado." : "Cadastre uma conta no espaço de destino antes de transferir.";
      form.toFinancialAccountKey.disabled = !accounts.length;
    };
    form.toSpaceId.addEventListener("change", () => loadDestinationAccounts().catch((error) => Utils.toast(error.message, true)));
    form.fromFinancialAccountKey.addEventListener("change", () => loadDestinationAccounts().catch((error) => Utils.toast(error.message, true)));
    await loadDestinationAccounts();
    form.onsubmit = async (event) => { event.preventDefault(); const values = Object.fromEntries(new FormData(form)), submit = form.querySelector("[type=submit]"), fromAccount = accountFromChoice(fromAccounts, values.fromFinancialAccountKey), destinationAccounts = await service.listFinancialAccounts(values.toSpaceId), toAccount = accountFromChoice(destinationAccounts, values.toFinancialAccountKey); submit.disabled = true; try { await service.createTransfer(state.selectedSpaceId, values.toSpaceId, { transferId, fromFinancialAccountId: fromAccount?.id, fromFinancialAccountHomeSpaceId: accountHomeSpaceId(fromAccount), toFinancialAccountId: toAccount?.id, toFinancialAccountHomeSpaceId: accountHomeSpaceId(toAccount), amountCents: Engine.moneyInputToCents(values.amount), occurredAt: new Date(`${values.occurredAt}T12:00:00`).toISOString(), description: values.description }); closeModal(); Utils.toast("Transferência registrada sem alterar o resultado."); await refresh(); } catch (error) { Utils.toast(error.message, true); submit.disabled = false; } };
  }

  function bindPage() {
    const page = root();
    if (!page) return;
    page.querySelector("[data-financial-retry]")?.addEventListener("click", () => refresh());
    page.querySelectorAll("[data-financial-retry-cards]").forEach((button) => button.onclick = () => refresh({ silent: true }));
    page.querySelectorAll("[data-financial-open-spaces]").forEach((button) => button.onclick = openSpaces);
    page.querySelectorAll("[data-financial-save-view]").forEach((button) => button.onclick = openSaveView);
    page.querySelectorAll("[data-financial-open-period]").forEach((button) => button.onclick = openPeriod);
    page.querySelectorAll("[data-financial-view]").forEach((button) => button.onclick = () => { state.view = button.dataset.financialView; paint(); });
    page.querySelectorAll("[data-financial-institution]").forEach((element) => element.onclick = (event) => {
      if (event.target.closest("[data-financial-institution-actions]")) return;
      event.stopPropagation();
      state.institutionKey = element.dataset.financialInstitution;
      state.view = "institution";
      paint();
    });
    page.querySelectorAll("[data-financial-institution]").forEach((element) => element.onkeydown = (event) => {
      if (event.target.closest("[data-financial-institution-actions]")) return;
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); element.click(); }
    });
    page.querySelectorAll("[data-financial-institution-actions]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); openInstitutionActions(button.dataset.financialInstitutionActions); });
    page.querySelectorAll("[data-financial-add-product]").forEach((button) => button.onclick = () => openAddFinancialProduct());
    page.querySelectorAll("[data-financial-dismiss-note]").forEach((button) => button.onclick = () => button.closest(".financial-institution-note")?.remove());
    page.querySelectorAll("[data-financial-space-detail]").forEach((button) => button.onclick = async () => {
      state.view = "dashboard";
      await selectFinancialView(`space:${button.dataset.financialSpaceDetail}`);
    });
    page.querySelectorAll("[data-financial-account-id]").forEach((element) => element.onclick = () => {
      const account = state.dashboard?.financialAccounts?.find((item) => item.id === element.dataset.financialAccountId && accountHomeSpaceId(item) === element.dataset.financialAccountHome);
      if (account) openFinancialAccount(account, state.selectedSpaceId);
    });
    page.querySelectorAll("[data-financial-account-id]").forEach((element) => element.onkeydown = (event) => {
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); element.click(); }
    });
    page.querySelectorAll("[data-financial-account-filter]").forEach((button) => button.onclick = () => { state.accountFilter = button.dataset.financialAccountFilter; paint(); });
    page.querySelectorAll("[data-financial-new]").forEach((button) => button.onclick = () => openEntryForm(button.dataset.financialNew === "income" ? "in" : "out"));
    page.querySelectorAll("[data-financial-new-account]").forEach((button) => button.onclick = () => openCreateFinancialAccount());
    page.querySelectorAll("[data-financial-new-card]").forEach((button) => button.onclick = () => openCreateCreditCard());
    page.querySelectorAll("[data-financial-open-invoice]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); openCreditCardInvoice(button.dataset.financialOpenInvoice, button.dataset.financialInvoiceHome, button.dataset.financialTargetSpace || state.selectedSpaceId); });
    page.querySelectorAll("[data-financial-card-action]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); handleCreditCardAction(button); });
    page.querySelectorAll("[data-financial-card-id]").forEach((cardElement) => cardElement.onclick = (event) => {
      if (event.target.closest("button")) return;
      const card = state.dashboard?.creditCards?.find((item) => item.id === cardElement.dataset.financialCardId && item.cardHomeSpaceId === cardElement.dataset.financialCardHome);
      if (card) handleCreditCardAction({ disabled: false, dataset: { financialCardAction: "invoice", cardId: card.id, cardHome: card.cardHomeSpaceId, targetSpace: cardTargetSpaceId(card) } });
    });
    page.querySelectorAll("[data-financial-invoice-id]").forEach((row) => row.onclick = () => openCreditCardInvoice(row.dataset.financialInvoiceId, row.dataset.financialInvoiceHome, row.dataset.financialTargetSpace || state.selectedSpaceId));
    page.querySelectorAll("[data-financial-edit-card]").forEach((button) => button.onclick = (event) => { event.stopPropagation(); const card = state.dashboard?.creditCards?.find((item) => item.id === button.dataset.financialEditCard && item.cardHomeSpaceId === button.dataset.financialCardHome); if (card) openCreateCreditCard(null, card); });
    page.querySelectorAll("[data-financial-register-payment]").forEach((button) => button.onclick = openRegisterPayment);
    page.querySelectorAll("[data-financial-adjust-any-invoice]").forEach((button) => button.onclick = () => { const invoice = nearestOpenInvoice(state.dashboard); if (invoice) openCreditCardInvoiceAdjustment(invoice); });
    page.querySelectorAll("[data-financial-pay-any-invoice]").forEach((button) => button.onclick = () => { const invoice = nearestOpenInvoice(state.dashboard); if (invoice) openCreditCardInvoicePayment(invoice); });
    page.querySelectorAll("[data-financial-ongoing-installment]").forEach((button) => button.onclick = () => openOngoingInstallment());
    page.querySelectorAll("[data-financial-pay]").forEach((button) => button.onclick = () => { const entry = state.dashboard?.payables?.find((item) => item.id === button.dataset.financialPay); if (entry) openRegisterPayment(entry); });
    page.querySelectorAll("[data-financial-entry-id]").forEach((row) => row.onclick = (event) => {
      if (event.target.closest("button")) return;
      const entries = [...(state.dashboard?.accounts || []), ...(state.dashboard?.payables || []), ...(state.dashboard?.entries || []), ...(state.dashboard?.latest || [])], entry = entries.find((item) => item.id === row.dataset.financialEntryId);
      openAccount(entry);
    });
    page.querySelectorAll("[data-financial-new-category]").forEach((button) => button.onclick = openNewCategory);
    page.querySelectorAll("[data-financial-transfer]").forEach((button) => button.onclick = openTransfer);
    page.querySelectorAll("[data-financial-onboard-business]").forEach((button) => button.onclick = async () => { const context = window.BusinessContext?.get?.() || {}, name = context.business?.name || DB.carregar().config?.nome || "Minha empresa"; try { const space = await window.FinancialSpaceService.createSpace({ name, type: "business", linkedBusinessId: context.businessId }); state.selectedSpaceId = space.id; state.activeViewId = `space:${space.id}`; state.activeSpaceIds = [space.id]; await refresh(); } catch (error) { Utils.toast(error.message, true); } });
    page.querySelectorAll("[data-financial-create-space]").forEach((button) => button.onclick = () => openCreateSpace(button.dataset.financialCreateSpace));
  }

  function bind() {
    bindPage();
    refresh();
  }
  function destroy() { state.requestVersion += 1; state.viewInitialized = false; closeModal(); }
  function resume() { if (root()) refresh({ silent: true }); }

  addEventListener("financial-data-changed", () => { if (root() && !state.loading) refresh({ silent: true }); });
  addEventListener("financial-service-ready", () => { if (root() && !state.loading) refresh(); });
  addEventListener("app-resumed", () => { if (window.Router?.atual?.() === "financeiro") resume(); });
  return { render, bind, refresh, destroy, resume, state: () => structuredClone(state), openEntryForm, openSpaces };
})();
