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

  function render() {
    return `<section class="financial-page" aria-live="polite">
      <div class="financial-loading-card">${icon("loader-circle")}<b>Carregando seu financeiro…</b><span>Somente o período selecionado será consultado.</span></div>
    </section>`;
  }

  const selectorMarkup = () => {
    const space = selectedSpace();
    return `<div class="financial-context-selectors">
      <button class="financial-context-button" type="button" data-financial-open-spaces aria-label="Escolher espaço financeiro">
        <span>${icon(space?.icon || "wallet-cards")}<small>Espaço financeiro</small><b>${esc(state.consolidated ? "Visão consolidada" : space?.name || "Escolher espaço")}</b></span>${icon("chevron-down")}
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
      <article class="financial-list-row" data-financial-entry-id="${esc(entry.id)}">
        <span class="financial-row-icon">${icon(entry.categoryIcon || "receipt-text")}</span>
        <span class="financial-row-main"><b>${esc(entry.description)}</b><small>${money(entry.amountCents)}</small></span>
        <span class="financial-row-date">${Engine.effectiveStatus(entry) === "overdue" ? "venceu" : "vence"} ${dateLabel(entry.dueAt)}</span>
        <span class="financial-status ${statusClass(entry)}">${statusLabel(entry)}</span>
        ${compact || entry.status === "paid" ? "" : `<button class="financial-row-action" type="button" data-financial-pay="${esc(entry.id)}">${icon("circle-check-big")}<span>Pagar</span></button>`}
      </article>`).join("")}</div>`;
  }

  function latestMarkup(entries = [], full = false) {
    if (!entries.length) return `<div class="financial-empty-inline">${icon("arrow-left-right")}<div><b>Nenhum lançamento realizado</b><span>Entradas e pagamentos aparecerão aqui.</span></div></div>`;
    return `<div class="financial-list ${full ? "" : "is-compact"}">${entries.map((entry) => `
      <article class="financial-list-row financial-entry-row">
        <span class="financial-row-icon ${entry.direction === "in" ? "is-income" : "is-expense"}">${icon(entry.direction === "in" ? "arrow-up" : "arrow-down")}</span>
        <span class="financial-row-main"><b>${esc(entry.description)}</b><small>${esc(entry.categoryName || "Outros")} · ${dateLabel(entry.occurredAt)}</small></span>
        <span class="financial-status ${entry.direction === "in" ? "is-paid" : "is-overdue"}">${entry.direction === "in" ? "Entrada" : "Saída"}</span>
        <strong class="financial-row-amount ${entry.direction === "in" ? "is-income" : "is-expense"}">${entry.direction === "in" ? "+ " : "− "}${money(entry.amountCents)}</strong>
      </article>`).join("")}</div>`;
  }

  function categoriesMarkup(categories = [], totalOutCents = 0) {
    if (!categories.length || !totalOutCents) return `<div class="financial-empty-inline">${icon("chart-no-axes-column-increasing")}<div><b>Sem saídas realizadas</b><span>Os percentuais serão calculados depois do primeiro pagamento.</span></div></div>`;
    return `<div class="financial-category-list">${categories.slice(0, 5).map((category, index) => `
      <article>
        <span class="financial-category-icon">${icon(["house", "shopping-bag", "megaphone", "zap", "shapes"][index] || "shapes")}</span>
        <b>${esc(category.categoryName)}</b>
        <span class="financial-category-bar"><i style="width:${Math.max(4, category.percentage)}%"></i></span>
        <strong>${category.percentage}%</strong>
        <em>${money(category.amountCents)}</em>
      </article>`).join("")}</div>`;
  }

  function dashboardMarkup(data) {
    const summary = data.summary || {};
    return `${metricMarkup(summary)}
      <section class="financial-kpis">
        <button type="button" data-financial-view="accounts"><span>${icon("wallet-cards")}</span><small>Contas a pagar</small><b>${money(summary.pendingPayablesCents)}</b></button>
        <button type="button" data-financial-view="accounts"><span>${icon("calendar-clock")}</span><small>Vencem em 7 dias</small><b>${summary.dueSoonCount || 0} conta${summary.dueSoonCount === 1 ? "" : "s"}</b></button>
      </section>
      <section class="financial-section"><header><h2>Próximas contas</h2><button type="button" data-financial-view="accounts">Ver todas</button></header>${payablesMarkup((data.payables || []).slice(0, 3))}</section>
      <section class="financial-section"><header><h2>Ações rápidas</h2></header><div class="financial-quick-actions">
        <button type="button" data-financial-new="expense"><span>${icon("plus")}</span><b>Nova despesa</b></button>
        <button type="button" data-financial-register-payment><span>${icon("credit-card")}</span><b>Registrar pagamento</b></button>
        <button type="button" data-financial-view="cashflow"><span>${icon("chart-no-axes-column-increasing")}</span><b>Ver fluxo de caixa</b></button>
      </div></section>
      <section class="financial-section"><header><h2>Categorias do mês</h2><button type="button" data-financial-view="categories">Ver relatório</button></header>${categoriesMarkup(summary.categories, summary.totalOutCents)}</section>
      <section class="financial-section"><header><h2>Últimos lançamentos</h2><button type="button" data-financial-view="entries">Ver todos</button></header>${latestMarkup((data.latest || []).slice(0, 5))}</section>`;
  }

  function subpageHeader(title, subtitle, action = "") {
    return `<header class="financial-subpage-head"><button type="button" data-financial-view="dashboard" aria-label="Voltar">${icon("arrow-left")}</button><div><h2>${esc(title)}</h2><p>${esc(subtitle)}</p></div>${action}</header>${selectorMarkup()}`;
  }

  function accountsMarkup(data) {
    const byId = new Map(), filter = state.accountFilter;
    for (const entry of [...(data.payables || []), ...(data.entries || []).filter((item) => item.direction === "out")]) byId.set(entry.id, entry);
    const accounts = [...byId.values()].filter((entry) => filter === "all" || (filter === "paid" ? entry.status === "paid" : Engine.effectiveStatus(entry) === filter));
    return `${subpageHeader("Contas a pagar", "Pendentes, vencidas e pagamentos", `<button class="btn btn-primary" type="button" data-financial-new="expense">${icon("plus")} Nova conta</button>`)}
      <section class="financial-section financial-subpage-card"><div class="financial-filter-chips"><button data-financial-account-filter="all" class="${filter === "all" ? "active" : ""}">Todas</button><button data-financial-account-filter="pending" class="${filter === "pending" ? "active" : ""}">Pendentes</button><button data-financial-account-filter="overdue" class="${filter === "overdue" ? "active" : ""}">Vencidas</button><button data-financial-account-filter="paid" class="${filter === "paid" ? "active" : ""}">Pagas</button></div>${payablesMarkup(accounts, false)}</section>`;
  }

  function cashflowMarkup(data) {
    const summary = data.summary || {}, pendingIn = (data.entries || []).filter((entry) => entry.direction === "in" && entry.status === "pending").reduce((sum, entry) => sum + Number(entry.remainingCents ?? entry.amountCents), 0), pendingOut = (data.payables || []).reduce((sum, entry) => sum + Number(entry.amountCents || 0), 0);
    return `${subpageHeader("Fluxo de caixa", "Realizado e previsto sem misturar os números", `<button class="btn btn-primary" type="button" data-financial-transfer>${icon("arrow-left-right")} Transferir</button>`)}
      <section class="financial-flow-grid"><article><span>${icon("circle-check-big")}</span><h3>Realizado</h3><p>Dinheiro que efetivamente entrou ou saiu.</p><dl><div><dt>Entradas</dt><dd class="is-income">${money(summary.totalInCents)}</dd></div><div><dt>Saídas</dt><dd class="is-expense">${money(summary.totalOutCents)}</dd></div><div><dt>Saldo</dt><dd>${money(summary.resultCents)}</dd></div></dl></article>
      <article><span>${icon("calendar-range")}</span><h3>Previsto</h3><p>Contas e recebimentos que ainda não foram realizados.</p><dl><div><dt>Entradas</dt><dd class="is-income">${money(pendingIn)}</dd></div><div><dt>Saídas</dt><dd class="is-expense">${money(pendingOut)}</dd></div><div><dt>Projeção</dt><dd>${money(summary.resultCents + pendingIn - pendingOut)}</dd></div></dl></article></section>
      <section class="financial-section financial-subpage-card"><header><h2>Lançamentos do período</h2><button type="button" data-financial-new="income">Nova entrada</button></header>${latestMarkup(data.entries || [], true)}</section>`;
  }

  function categoriesPageMarkup(data) {
    return `${subpageHeader("Categorias", "Saídas realizadas em ${monthLabel(state.period)}", `<button class="btn btn-primary" type="button" data-financial-new-category>${icon("plus")} Categoria</button>`)}
      <section class="financial-section financial-subpage-card">${categoriesMarkup(data.summary?.categories || [], data.summary?.totalOutCents || 0)}</section>`;
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
      <div class="modal-body"><div class="financial-space-list">${items.map((space) => `<button type="button" data-financial-select-space="${esc(space.id)}" class="${!state.consolidated && space.id === state.selectedSpaceId ? "active" : ""}"><span>${icon(space.icon || "wallet")}</span><b>${esc(space.name)}</b><small>${space.type === "business" ? "Negócio" : space.type === "personal" ? "Pessoal" : "Outro"}</small>${icon("chevron-right")}</button>`).join("")}
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

  async function openEntryForm(direction = "out") {
    if (state.consolidated) return Utils.toast("Escolha um espaço antes de lançar uma movimentação.", true);
    const service = window.FinancialSpaceService, categoryItems = await service.listCategories(state.selectedSpaceId), isExpense = direction === "out";
    sheet(`${sheetHeader(isExpense ? "Nova despesa" : "Nova entrada", isExpense ? "Registre o que saiu ou ainda precisa ser pago." : "Adicione uma entrada que não veio de venda.")}
      <form data-financial-entry-form><div class="modal-body financial-form-grid">
        <label class="financial-field full"><span>Descrição *</span><input name="description" maxlength="160" placeholder="Ex.: Aluguel" required></label>
        ${isExpense ? `<label class="financial-field"><span>Tipo *</span><select name="entryType"><option value="expense">Despesa</option><option value="investment">Investimento</option></select></label>` : `<input type="hidden" name="entryType" value="manual_income">`}
        <label class="financial-field"><span>Categoria *</span><select name="categoryId">${categoryItems.map((category) => `<option value="${esc(category.id)}" data-name="${esc(category.name)}">${esc(category.name)}</option>`).join("")}</select></label>
        <label class="financial-field"><span>Valor *</span><input name="amount" inputmode="decimal" placeholder="R$ 0,00" required></label>
        <label class="financial-field"><span>${isExpense ? "Data / vencimento" : "Data da entrada"} *</span><input type="date" name="dueAt" value="${Engine.localIsoDate()}" required></label>
        <label class="financial-field"><span>Repetição</span><select name="frequency"><option value="none">Sem repetição</option><option value="weekly">Semanal</option><option value="biweekly">Quinzenal</option><option value="monthly">Mensal</option><option value="yearly">Anual</option></select></label>
        <label class="financial-field"><span>Parcelas</span><input type="number" name="installmentCount" min="1" max="60" value="1"></label>
        <label class="financial-toggle full"><input type="checkbox" name="paidNow" ${isExpense ? "" : "checked"}><span></span><b>${isExpense ? "Pago agora?" : "Entrada recebida?"}</b></label>
        <div class="financial-paid-fields full" data-paid-fields><label class="financial-field"><span>Forma de pagamento</span><select name="paymentMethod">${Object.entries(paymentLabel).map(([id, label]) => `<option value="${id}">${label}</option>`).join("")}</select></label><label class="financial-field"><span>Data do pagamento</span><input type="date" name="paidAt" value="${Engine.localIsoDate()}"></label></div>
        <label class="financial-field full"><span>Observação</span><textarea name="notes" maxlength="500" placeholder="Opcional"></textarea></label>
        <label class="financial-file full"><input type="file" name="attachment" accept="image/jpeg,image/png,image/webp,application/pdf"><span>${icon("paperclip")}<b>Anexar comprovante</b><small>JPG, PNG, WebP ou PDF · até 10 MB</small></span></label>
      </div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Salvar ${isExpense ? "despesa" : "entrada"}</button></footer></form>`);
    const form = modal().querySelector("[data-financial-entry-form]"), paid = form.paidNow, paidFields = form.querySelector("[data-paid-fields]"), togglePaid = () => paidFields.hidden = !paid.checked;
    paid.onchange = togglePaid; togglePaid();
    form.onsubmit = async (event) => {
      event.preventDefault();
      const submit = form.querySelector("[type=submit]"), values = new FormData(form), selected = form.categoryId.selectedOptions[0], file = form.attachment.files[0];
      submit.disabled = true;
      try {
        if (Number(values.get("installmentCount") || 1) > 1 && values.get("frequency") !== "none") throw new Error("Escolha parcelamento ou repetição, não os dois ao mesmo tempo.");
        const dueAt = new Date(`${values.get("dueAt")}T12:00:00`).toISOString(), paidAt = new Date(`${values.get("paidAt") || values.get("dueAt")}T12:00:00`).toISOString(), created = await service.createEntry(state.selectedSpaceId, {
          direction,
          description: values.get("description"),
          entryType: values.get("entryType"),
          categoryId: values.get("categoryId"),
          categoryName: selected?.dataset.name || selected?.textContent || "Outros",
          amountCents: Engine.moneyInputToCents(values.get("amount")),
          dueAt,
          paidAt,
          occurredAt: paidAt,
          paidNow: paid.checked,
          paymentMethod: values.get("paymentMethod"),
          frequency: values.get("frequency"),
          installmentCount: Number(values.get("installmentCount") || 1),
          notes: values.get("notes"),
        });
        if (file) await service.uploadAttachment(state.selectedSpaceId, created[0].id, file);
        closeModal();
        Utils.toast(`${isExpense ? "Despesa" : "Entrada"} salva com sucesso.`);
        await refresh();
      } catch (error) { Utils.toast(error.message, true); submit.disabled = false; }
    };
  }

  function openRegisterPayment(selectedEntry = null) {
    if (state.consolidated) return Utils.toast("Escolha um espaço para registrar o pagamento.", true);
    const entries = state.dashboard?.payables || [];
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

  async function openAccount(entry) {
    if (!entry) return;
    const editable = entry.status === "pending";
    sheet(`${sheetHeader(entry.description, `${money(entry.amountCents)} · ${statusLabel(entry)}`)}<div class="modal-body"><div class="financial-account-details"><span>${icon("calendar-days")} Vencimento <b>${dateLabel(entry.dueAt)}</b></span><span>${icon("tag")} Categoria <b>${esc(entry.categoryName || "Outros")}</b></span></div><div class="financial-account-actions">${editable ? `<button class="btn btn-primary" type="button" data-financial-account-pay>${icon("circle-check-big")} Marcar como pago</button><button class="btn btn-light" type="button" data-financial-account-edit>${icon("pencil")} Editar</button><button class="btn btn-light" type="button" data-financial-account-cancel>${icon("ban")} Cancelar conta</button>` : ""}<label class="btn btn-light financial-attachment-action">${icon("paperclip")} Anexar comprovante<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" hidden></label></div></div>`);
    modal().querySelector("[data-financial-account-pay]")?.addEventListener("click", () => { closeModal(); openRegisterPayment(entry); });
    modal().querySelector("[data-financial-account-edit]")?.addEventListener("click", () => openEditAccount(entry));
    modal().querySelector("[data-financial-account-cancel]")?.addEventListener("click", async () => { try { await window.FinancialSpaceService.cancelPendingEntry(state.selectedSpaceId, entry, "Cancelada pelo usuário"); closeModal(); Utils.toast("Conta cancelada com histórico preservado."); await refresh(); } catch (error) { Utils.toast(error.message, true); } });
    const fileInput = modal().querySelector(".financial-attachment-action input");
    if (fileInput) fileInput.onchange = async () => { const file = fileInput.files[0]; if (!file) return; try { await window.FinancialSpaceService.uploadAttachment(state.selectedSpaceId, entry.id, file); closeModal(); Utils.toast("Comprovante anexado."); await refresh(); } catch (error) { Utils.toast(error.message, true); } };
  }

  async function openEditAccount(entry) {
    const categories = await window.FinancialSpaceService.listCategories(state.selectedSpaceId);
    sheet(`${sheetHeader("Editar conta pendente", "O histórico da alteração será preservado.")}<form data-financial-edit-form><div class="modal-body financial-form-grid"><label class="financial-field full"><span>Descrição *</span><input name="description" maxlength="160" value="${esc(entry.description)}" required></label><label class="financial-field"><span>Valor *</span><input name="amount" inputmode="decimal" value="${(Number(entry.amountCents) / 100).toFixed(2).replace(".", ",")}" required></label><label class="financial-field"><span>Vencimento *</span><input type="date" name="dueAt" value="${Engine.localIsoDate(entry.dueAt)}" required></label><label class="financial-field full"><span>Categoria</span><select name="categoryId">${categories.map((category) => `<option value="${esc(category.id)}" data-name="${esc(category.name)}"${category.id === entry.categoryId ? " selected" : ""}>${esc(category.name)}</option>`).join("")}</select></label><label class="financial-field full"><span>Observação</span><textarea name="notes" maxlength="500">${esc(entry.notes || "")}</textarea></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Salvar alterações</button></footer></form>`);
    const form = modal().querySelector("[data-financial-edit-form]");
    form.onsubmit = async (event) => { event.preventDefault(); const data = new FormData(form), option = form.categoryId.selectedOptions[0], submit = form.querySelector("[type=submit]"); submit.disabled = true; try { await window.FinancialSpaceService.updatePendingEntry(state.selectedSpaceId, entry, { description: data.get("description"), amountCents: Engine.moneyInputToCents(data.get("amount")), dueAt: new Date(`${data.get("dueAt")}T12:00:00`).toISOString(), categoryId: data.get("categoryId"), categoryName: option?.dataset.name, notes: data.get("notes") }); closeModal(); Utils.toast("Conta atualizada."); await refresh(); } catch (error) { Utils.toast(error.message, true); submit.disabled = false; } };
  }

  function openNewCategory() {
    if (state.consolidated) return Utils.toast("Escolha um espaço para criar a categoria.", true);
    sheet(`${sheetHeader("Nova categoria", "A categoria ficará disponível somente neste espaço.")}<form data-financial-category-form><div class="modal-body"><label class="financial-field"><span>Nome *</span><input name="name" maxlength="60" placeholder="Ex.: Embalagens" required></label></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-financial-close>Cancelar</button><button class="btn btn-primary" type="submit">Criar categoria</button></footer></form>`);
    const form = modal().querySelector("[data-financial-category-form]");
    form.onsubmit = async (event) => { event.preventDefault(); const submit = form.querySelector("[type=submit]"); submit.disabled = true; try { await window.FinancialSpaceService.createCategory(state.selectedSpaceId, { name: new FormData(form).get("name") }); closeModal(); Utils.toast("Categoria criada."); await refresh(); } catch (error) { Utils.toast(error.message, true); submit.disabled = false; } };
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
    page.querySelectorAll("[data-financial-register-payment]").forEach((button) => button.onclick = openRegisterPayment);
    page.querySelectorAll("[data-financial-pay]").forEach((button) => button.onclick = () => { const entry = state.dashboard?.payables?.find((item) => item.id === button.dataset.financialPay); if (entry) openRegisterPayment(entry); });
    if (state.view === "accounts") page.querySelectorAll("[data-financial-entry-id]").forEach((row) => row.onclick = (event) => { if (event.target.closest("button")) return; const entry = [...(state.dashboard?.payables || []), ...(state.dashboard?.entries || [])].find((item) => item.id === row.dataset.financialEntryId); openAccount(entry); });
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
