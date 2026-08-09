(function () {
  "use strict";

  const DAY = 86400000;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const money = (value) => Utils.dinheiro(Number(value || 0));
  const esc = (value) => Utils.escapar(String(value ?? ""));
  const mobile = () => matchMedia("(max-width:767px)").matches;
  const state = () => window.CRMDashboard.state;

  const segmentOptions = (credit) => [
    ["", "Todos"],
    ["top", "Melhores clientes"],
    ["vip", "VIP"],
    ["new", "Novos clientes"],
    ["inactive30", "Sem comprar há 30 dias"],
    ["inactive60", "Sem comprar há 60 dias"],
    ["birthday", "Aniversariantes"],
    ["no-contact", "Sem contato recente"],
    ["reward", "Recompensas disponíveis"],
    ["inactive", "Clientes inativos"],
    ...(credit ? [["debt", "Clientes devendo"]] : []),
  ];

  const periodLabel = {
    today: "Hoje",
    "7d": "Últimos 7 dias",
    "30d": "Últimos 30 dias",
    month: "Mês atual",
    previous: "Mês anterior",
    year: "Ano atual",
    custom: "Personalizado",
    all: "Todo o histórico",
  };

  const sortLabel = {
    spent: "Maior gasto",
    total: "Maior gasto histórico",
    purchases: "Mais compras",
    recent: "Última compra recente",
    inactive: "Última compra antiga",
    debt: "Maior dívida",
  };

  function status(row) {
    if (row.client.ativo === false || row.metric.daysSinceLastPurchase >= 60)
      return ["Inativo", "inactive"];
    if (row.metric.daysSinceLastPurchase >= 30) return ["Atenção", "risk"];
    return ["Ativo", "active"];
  }

  function date(value) {
    if (!value) return "Nunca";
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? "Nunca" : parsed.toLocaleDateString("pt-BR");
  }

  function initials(name) {
    return String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  }

  function card(row, index, credit) {
    const [label, tone] = status(row);
    const debt = Number(row.metric.openBalance || 0);
    return `<article class="crm-mobile-client" data-profile-client="${row.client.id}" style="--crm-card-delay:${Math.min(index, 10) * 24}ms">
      <div class="crm-mobile-client-main">
        <span class="crm-mobile-avatar">${esc(initials(row.client.nome))}</span>
        <span class="crm-mobile-identity">
          <span><b>${esc(row.client.nome)}</b><em class="crm-status ${tone}">${label}</em></span>
          <small>${esc(row.client.telefone) || "Sem telefone"}${row.client.telefone ? ` ${icon("message-circle")}` : ""}</small>
        </span>
        ${credit && debt > 0 ? `<span class="crm-mobile-debt"><b>${money(debt)}</b><small>Em aberto</small></span>` : ""}
        <button type="button" class="crm-mobile-more" data-crm-client-menu="${row.client.id}" aria-label="Ações de ${esc(row.client.nome)}">${icon("ellipsis-vertical")}</button>
      </div>
      <div class="crm-mobile-client-stats">
        <span>${icon("scale")}<b>${money(row.metric.totalSpent)}</b><small>Total gasto</small></span>
        <span>${icon("shopping-bag")}<b>${row.metric.purchaseCount}</b><small>Compras</small></span>
        <span>${icon("calendar-days")}<b>${date(row.metric.lastPurchaseAt)}</b><small>Última compra</small></span>
      </div>
    </article>`;
  }

  function compactSummary(snapshot) {
    return `<section class="crm-mobile-summary">
      <header><span>${icon("chart-no-axes-combined")}</span><b>Resumo dos ${esc(periodLabel[state().period] || "período")}</b><em>Novo</em></header>
      <div>
        <span>${icon("users")}<b>${snapshot.summary.active}</b><small>Clientes ativos</small></span>
        <span>${icon("circle-dollar-sign")}<b>${money(snapshot.summary.revenue)}</b><small>Receita da base</small></span>
        <span>${icon("chart-spline")}<b>${money(snapshot.summary.ticket)}</b><small>Ticket médio</small></span>
        <span>${icon("user-round-plus")}<b>${snapshot.summary.newClients}</b><small>Novos clientes</small></span>
      </div>
      <button type="button" data-crm-full-summary>Ver indicadores completos ${icon("chevron-down")}</button>
    </section>`;
  }

  function render() {
    const snapshot = window.CRMDashboard.snapshot();
    const current = state();
    const credit = OperationMode.enabled("creditSales");
    const rows = snapshot.list.slice(0, current.limit);
    const quick = [
      ["", "Todos"],
      ["top", "Melhores", "crown"],
      ["vip", "VIP", "star"],
      ["inactive30", "30 dias", "clock-3"],
    ];
    return `<section class="crm-dashboard-page crm-mobile-page">
      ${compactSummary(snapshot)}
      <section class="crm-mobile-tools">
        <label class="crm-mobile-search">${icon("search")}<input id="crm-mobile-query" value="${esc(current.query)}" placeholder="Buscar cliente..." autocomplete="off"></label>
        <label class="crm-mobile-period">${icon("calendar-days")}<span><small>Período</small><select id="crm-period">
          ${Object.entries(periodLabel).map(([value, label]) => `<option value="${value}">${label}</option>`).join("")}
        </select></span>${icon("chevron-down")}</label>
        ${current.period === "custom" ? `<div class="crm-mobile-custom"><input type="date" id="crm-start" value="${current.customStart}"><input type="date" id="crm-end" value="${current.customEnd}"></div>` : ""}
      </section>
      <nav class="crm-mobile-chips" aria-label="Segmentos rápidos">
        ${quick.map(([id, label, ico]) => `<button type="button" class="${current.segment === id ? "active" : ""}" data-crm-segment="${id}">${ico ? icon(ico) : ""}${label}</button>`).join("")}
        <button type="button" data-crm-more-filters>Mais ${icon("chevron-down")}</button>
      </nav>
      <section class="crm-mobile-list-head"><span><b>${snapshot.list.length}</b> clientes encontrados</span><div><button type="button" data-crm-more-filters>Ordenar: <b>${esc(sortLabel[current.sort] || "Maior gasto")}</b> ${icon("arrow-down-up")}</button><button type="button" class="crm-mobile-segment-actions" data-crm-actions aria-label="Abrir ações do segmento">${icon("ellipsis")} Ações</button></div></section>
      <section class="crm-mobile-list" id="crm-mobile-list">
        ${rows.map((row, index) => card(row, index, credit)).join("") || (current.loadingSegment ? `<div class="crm-mobile-empty" aria-live="polite">${icon("loader-circle")}<b>Atualizando segmento…</b><p>Buscando somente os clientes com compra antiga.</p></div>` : `<div class="crm-mobile-empty">${icon("users-round")}<b>Nenhum cliente neste segmento</b><p>Não há clientes com compra registrada que atendam a este limite.</p><button type="button" data-crm-reset>Visualizar todos</button></div>`)}
      </section>
      ${rows.length < snapshot.list.length ? `<button type="button" class="crm-mobile-load" id="crm-more">Carregar mais 20 clientes</button><div class="crm-mobile-sentinel" aria-hidden="true"></div>` : ""}
    </section>`;
  }

  function closeSheet() {
    const root = $("#modal");
    if (root) root.innerHTML = "";
  }

  function fullSummary() {
    const snapshot = window.CRMDashboard.snapshot();
    const credit = OperationMode.enabled("creditSales");
    const metrics = [
      ["Clientes ativos", snapshot.summary.active, "users", "success"],
      ["Novos clientes", snapshot.summary.newClients, "user-plus", "success"],
      ["Clientes recuperados", snapshot.summary.recovered, "rotate-ccw", "success"],
      ["Clientes inativos", snapshot.summary.inactive, "user-x", "danger"],
      ["Receita da base", money(snapshot.summary.revenue), "circle-dollar-sign", "success"],
      ["Ticket médio", money(snapshot.summary.ticket), "chart-spline", "success"],
      ["Compras no período", snapshot.sales.length, "shopping-bag", "success"],
      ...(credit ? [
        ["Clientes devendo", snapshot.summary.debtors, "circle-alert", "danger"],
        ["Em aberto", money(snapshot.summary.open), "hand-coins", "danger"],
      ] : []),
    ];
    $("#modal").innerHTML = `<div class="modal-bg crm-sheet-bg"><section class="modal-box crm-mobile-sheet crm-summary-sheet" role="dialog" aria-modal="true" aria-label="Indicadores completos">
      <header class="modal-head"><h3>Indicadores dos ${esc(periodLabel[state().period] || "período")}</h3><button class="icon-btn" data-crm-close aria-label="Fechar">${icon("x")}</button></header>
      <div class="crm-summary-sheet-grid">${metrics.map(([label, value, ico, tone]) => `<span class="${tone}">${icon(ico)}<b>${esc(value)}</b><small>${esc(label)}</small></span>`).join("")}</div>
    </section></div>`;
    $("[data-crm-close]").onclick = closeSheet;
    window.lucide?.createIcons();
  }

  function filtersSheet() {
    const credit = OperationMode.enabled("creditSales");
    const current = state();
    $("#modal").innerHTML = `<div class="modal-bg crm-sheet-bg"><section class="modal-box crm-mobile-sheet crm-segment-sheet" role="dialog" aria-modal="true" aria-label="Filtros do CRM">
      <header class="modal-head"><h3>Filtros</h3><button class="icon-btn" data-crm-close aria-label="Fechar">${icon("x")}</button></header>
      <div class="modal-body">
        <fieldset><legend>Segmentos</legend><div class="crm-sheet-chips">${segmentOptions(credit).map(([id, label]) => `<button type="button" class="${current.segment === id ? "active" : ""}" data-sheet-segment="${id}">${esc(label)}</button>`).join("")}</div></fieldset>
        <fieldset><legend>Ordenação</legend><div class="crm-sheet-chips">${Object.entries(sortLabel).filter(([id]) => credit || id !== "debt").map(([id, label]) => `<button type="button" class="${current.sort === id ? "active" : ""}" data-sheet-sort="${id}">${esc(label)}</button>`).join("")}</div></fieldset>
        <fieldset><legend>Outros critérios</legend><div class="crm-sheet-checks">
          <label><input type="checkbox" id="crm-phone" ${current.filters.phone ? "checked" : ""}> Possui telefone</label>
          <label><input type="checkbox" id="crm-email" ${current.filters.email ? "checked" : ""}> Possui e-mail</label>
          <label><input type="checkbox" id="crm-marketing" ${current.filters.marketing ? "checked" : ""}> Aceita marketing</label>
          ${credit ? `<label><input type="checkbox" id="crm-debt" ${current.filters.debt ? "checked" : ""}> Possui dívida</label>` : ""}
        </div></fieldset>
      </div>
      <footer class="modal-foot"><button class="btn btn-light" data-crm-clear>Limpar</button><button class="btn btn-primary" data-crm-apply>Aplicar filtros</button></footer>
    </section></div>`;
    let segment = current.segment;
    let sort = current.sort;
    $$('[data-sheet-segment]').forEach((button) => button.onclick = () => {
      segment = button.dataset.sheetSegment;
      $$('[data-sheet-segment]').forEach((item) => item.classList.toggle("active", item === button));
    });
    $$('[data-sheet-sort]').forEach((button) => button.onclick = () => {
      sort = button.dataset.sheetSort;
      $$('[data-sheet-sort]').forEach((item) => item.classList.toggle("active", item === button));
    });
    $("[data-crm-close]").onclick = closeSheet;
    $("[data-crm-clear]").onclick = () => {
      current.segment = "";
      current.sort = "spent";
      current.query = "";
      current.filters.phone = false;
      current.filters.email = false;
      current.filters.marketing = false;
      current.filters.debt = false;
      current.limit = 20;
      closeSheet();
      window.CRMDashboard.refresh();
    };
    $("[data-crm-apply]").onclick = () => {
      current.sort = sort;
      current.filters.phone = Boolean($("#crm-phone")?.checked);
      current.filters.email = Boolean($("#crm-email")?.checked);
      current.filters.marketing = Boolean($("#crm-marketing")?.checked);
      current.filters.debt = Boolean($("#crm-debt")?.checked);
      current.limit = 20;
      closeSheet();
      window.CRMDashboard.selectSegment(segment);
    };
    window.lucide?.createIcons();
  }

  let searchTimer = 0;
  function bind() {
    if (!mobile()) return false;
    const current = state();
    current.resultsVisible = true;
    const period = $("#crm-period");
    if (period) {
      period.value = current.period;
      period.onchange = (event) => {
        current.period = event.target.value;
        current.limit = 20;
        window.CRMDashboard.invalidate();
        window.CRMDashboard.refresh();
      };
    }
    $("#crm-start")?.addEventListener("change", (event) => {
      current.customStart = event.target.value;
      window.CRMDashboard.invalidate();
      window.CRMDashboard.refresh();
    });
    $("#crm-end")?.addEventListener("change", (event) => {
      current.customEnd = event.target.value;
      window.CRMDashboard.invalidate();
      window.CRMDashboard.refresh();
    });
    $("#crm-mobile-query")?.addEventListener("input", (event) => {
      const value = event.target.value;
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => {
        current.query = value;
        current.limit = 20;
        window.CRMDashboard.refresh();
        requestAnimationFrame(() => {
          const input = $("#crm-mobile-query");
          input?.focus({ preventScroll: true });
          input?.setSelectionRange(value.length, value.length);
        });
      }, 300);
    });
    $$('[data-crm-segment]').forEach((button) => button.onclick = () => {
      window.CRMDashboard.selectSegment(button.dataset.crmSegment);
    });
    $$('[data-crm-more-filters]').forEach((button) => button.onclick = filtersSheet);
    $(`[data-crm-actions]`)?.addEventListener("click", () => window.CRMDashboard.openActions());
    $("[data-crm-full-summary]")?.addEventListener("click", fullSummary);
    $("[data-crm-reset]")?.addEventListener("click", () => {
      current.segment = "";
      current.query = "";
      current.limit = 20;
      window.CRMDashboard.refresh();
    });
    $("#crm-more")?.addEventListener("click", () => {
      current.limit += 20;
      window.CRMDashboard.refresh();
    });
    $$('[data-profile-client]').forEach((item) => item.onclick = (event) => {
      if (event.target.closest("button")) return;
      window.CRMClienteUI?.open?.(item.dataset.profileClient);
    });
    $$('[data-crm-client-menu]').forEach((button) => button.onclick = (event) => {
      event.stopPropagation();
      window.ClientActions?.openSheet?.(button.dataset.crmClientMenu);
    });
    const sentinel = $(".crm-mobile-sentinel");
    if (sentinel && "IntersectionObserver" in window) {
      const observer = new IntersectionObserver((entries) => {
        if (!entries[0]?.isIntersecting) return;
        observer.disconnect();
        current.limit += 20;
        window.CRMDashboard.refresh();
      }, { rootMargin: "220px" });
      observer.observe(sentinel);
    }
    window.lucide?.createIcons();
    return true;
  }

  window.CRMMobile = { isMobile: mobile, render, bind, filtersSheet, fullSummary };
})();
