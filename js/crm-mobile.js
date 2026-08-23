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

  let scrollRequestId = 0;
  const nextFrame = (callback) => typeof requestAnimationFrame === "function"
    ? requestAnimationFrame(callback)
    : setTimeout(callback, 0);

  function scrollToAnchor(selector) {
    const requestId = ++scrollRequestId;
    nextFrame(() => nextFrame(() => {
      if (requestId !== scrollRequestId) return;
      const target = $(selector);
      if (!target) return;
      const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
      target.scrollIntoView({ behavior: reduced ? "auto" : "smooth", block: "start" });
    }));
  }

  const scrollToResults = () => scrollToAnchor("#crm-results-anchor");
  const scrollToSegments = () => scrollToAnchor("#crm-segments-anchor");

  function applyAutomaticSegment(id, label = "") {
    const current = state();
    current.customConditions = [];
    current.customMatchMode = "all";
    current.resultLabel = label;
    window.CRMDashboard.selectSegment(id);
    scrollToResults();
  }

  function applySavedSegment(saved) {
    if (!saved) return;
    closeSheet();
    window.CRMDashboard.applySavedSegment(saved);
    scrollToResults();
  }

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
    const overview = window.CRMDashboard.segmentOverview?.() || [];
    const showingResults = Boolean(current.resultsVisible || current.segment || current.query || current.customConditions?.length);
    return `<section class="crm-dashboard-page crm-mobile-page mobile-page">
      <header class="crm-action-head mobile-section-header" id="crm-segments-anchor"><div><h2>Quem você quer alcançar?</h2><p>Segmentos prontos para você agir agora.</p></div></header>
      <section class="crm-opportunity-grid" aria-label="Segmentos automáticos">${overview.map((item) => `<button type="button" class="crm-opportunity-card ${current.segment === item.id && !current.customConditions?.length ? "active" : ""}" data-crm-segment="${item.id}" data-crm-segment-label="${esc(item.label)}" aria-pressed="${current.segment === item.id && !current.customConditions?.length}"><span class="crm-opportunity-icon">${icon(item.icon)}</span><span class="crm-opportunity-label">${esc(item.label)}</span><span class="crm-opportunity-count"><strong>${item.count}</strong><small>${item.count === 1 ? "cliente" : "clientes"}</small></span></button>`).join("")}</section>
      <section class="crm-mobile-quick-actions" aria-label="Ações rápidas"><h3>Ações rápidas</h3><div><button type="button" class="mobile-button" data-crm-message>${icon("message-circle")}<span>Enviar mensagem</span></button><button type="button" class="mobile-button" data-crm-campaign>${icon("wand-sparkles")}<span>Criar campanha</span></button><button type="button" class="mobile-button" data-crm-export>${icon("file-down")}<span>Exportar lista</span></button></div></section>
      <section class="crm-mobile-filter-entry" aria-label="Filtros e segmentos"><button type="button" class="crm-mobile-entry-card" data-crm-custom-filter>${icon("list-filter")}<span><b>Criar filtro</b><small>Personalize seu público.</small></span>${icon("chevron-right")}</button><button type="button" class="crm-mobile-entry-card" data-crm-saved>${icon("bookmark")}<span><b>Meus segmentos</b><small>Filtros que você salvou.</small></span>${icon("chevron-right")}</button></section>
      ${showingResults ? `<section class="crm-mobile-result-area" id="crm-results-anchor"><header class="crm-mobile-result-header"><button type="button" class="crm-mobile-result-icon mobile-icon-button" data-crm-back-overview aria-label="Voltar aos segmentos">${icon("arrow-left")}</button><div><h3>${esc(current.resultLabel || overview.find((item) => item.id === current.segment)?.label || "Filtro personalizado")}</h3><p>${snapshot.list.length} ${snapshot.list.length === 1 ? "cliente encontrado" : "clientes encontrados"}</p></div><button type="button" class="crm-mobile-result-icon mobile-icon-button" data-crm-actions aria-label="Ações do segmento">${icon("ellipsis-vertical")}</button></header><section class="crm-mobile-tools"><label class="crm-mobile-search mobile-search">${icon("search")}<input id="crm-mobile-query" value="${esc(current.query)}" placeholder="Buscar cliente..." autocomplete="off"></label><button type="button" class="crm-mobile-filter-button mobile-icon-button" data-crm-more-filters aria-label="Ordenar e filtrar">${icon("sliders-horizontal")}</button></section><section class="crm-mobile-list" id="crm-mobile-list">${rows.map((row, index) => card(row, index, credit)).join("") || (current.loadingSegment ? `<div class="crm-mobile-empty mobile-empty-state" aria-live="polite">${icon("loader-circle")}<b>Buscando clientes…</b></div>` : `<div class="crm-mobile-empty mobile-empty-state">${icon("users-round")}<b>Nenhum cliente neste segmento</b><p>Ajuste os critérios para ampliar o resultado.</p></div>`)}</section>${rows.length < snapshot.list.length ? `<button type="button" class="crm-mobile-load mobile-button" id="crm-more">Carregar mais 20 clientes</button>` : ""}</section>` : ""}
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
    $("#modal").innerHTML = `<div class="modal-bg crm-sheet-bg"><section class="modal-box mobile-modal crm-mobile-sheet crm-summary-sheet" role="dialog" aria-modal="true" aria-label="Indicadores completos">
      <header class="modal-head"><h3>Indicadores dos ${esc(periodLabel[state().period] || "período")}</h3><button class="icon-btn" data-crm-close aria-label="Fechar">${icon("x")}</button></header>
      <div class="crm-summary-sheet-grid">${metrics.map(([label, value, ico, tone]) => `<span class="${tone}">${icon(ico)}<b>${esc(value)}</b><small>${esc(label)}</small></span>`).join("")}</div>
    </section></div>`;
    $("[data-crm-close]").onclick = closeSheet;
    window.lucide?.createIcons();
  }

  function filtersSheet() {
    const credit = OperationMode.enabled("creditSales");
    const current = state();
    $("#modal").innerHTML = `<div class="modal-bg crm-sheet-bg"><section class="modal-box mobile-modal crm-mobile-sheet crm-segment-sheet" role="dialog" aria-modal="true" aria-label="Filtros do CRM">
      <header class="modal-head"><h3>Filtros</h3><button class="icon-btn" data-crm-close aria-label="Fechar">${icon("x")}</button></header>
      <div class="modal-body">
        <fieldset><legend>Segmentos</legend><div class="crm-sheet-chips">${segmentOptions(credit).map(([id, label]) => `<button type="button" class="${current.segment === id ? "active" : ""}" data-sheet-segment="${id}">${esc(label)}</button>`).join("")}</div></fieldset>
        <fieldset><legend>Ordenação</legend><div class="crm-sheet-chips">${Object.entries(sortLabel).filter(([id]) => credit || id !== "debt").map(([id, label]) => `<button type="button" class="${current.sort === id ? "active" : ""}" data-sheet-sort="${id}">${esc(label)}</button>`).join("")}</div></fieldset>
        <fieldset><legend>Outros critérios</legend><div class="crm-sheet-checks">
          <label class="mobile-check"><input type="checkbox" id="crm-phone" ${current.filters.phone ? "checked" : ""}><span class="mobile-check-mark"></span><span>Possui telefone</span></label>
          <label class="mobile-check"><input type="checkbox" id="crm-email" ${current.filters.email ? "checked" : ""}><span class="mobile-check-mark"></span><span>Possui e-mail</span></label>
          <label class="mobile-check"><input type="checkbox" id="crm-marketing" ${current.filters.marketing ? "checked" : ""}><span class="mobile-check-mark"></span><span>Aceita marketing</span></label>
          ${credit ? `<label class="mobile-check"><input type="checkbox" id="crm-debt" ${current.filters.debt ? "checked" : ""}><span class="mobile-check-mark"></span><span>Possui dívida</span></label>` : ""}
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
      applyAutomaticSegment(segment, segmentOptions(credit).find(([id]) => id === segment)?.[1] || "Todos os clientes");
    };
    window.lucide?.createIcons();
  }

  let searchTimer = 0;
  function bind() {
    if (!mobile()) return false;
    const current = state();
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
    $$('[data-crm-segment]').forEach((button) => button.onclick = () => applyAutomaticSegment(button.dataset.crmSegment, button.dataset.crmSegmentLabel));
    $$('[data-crm-more-filters]').forEach((button) => button.onclick = filtersSheet);
    $(`[data-crm-actions]`)?.addEventListener("click", () => window.CRMDashboard.openActions());
    $(`[data-crm-message]`)?.addEventListener("click", () => { current.resultsVisible = true; current.segment = ""; window.CRMDashboard.refresh(); setTimeout(() => window.CRMDashboard.openActions(), 0); });
    $(`[data-crm-campaign]`)?.addEventListener("click", () => { current.resultsVisible = true; current.segment = ""; window.CRMDashboard.refresh(); setTimeout(() => window.CRMDashboard.openActions(), 0); });
    $(`[data-crm-export]`)?.addEventListener("click", () => { current.resultsVisible = true; current.segment = ""; window.CRMDashboard.refresh(); setTimeout(() => window.CRMDashboard.openActions(), 0); });
    $(`[data-crm-custom-filter]`)?.addEventListener("click", () => window.CRMSegmentBuilder?.open?.({ onApply: scrollToResults }));
    $(`[data-crm-saved]`)?.addEventListener("click", () => window.CRMSegmentBuilder?.openSaved?.());
    $(`[data-crm-back-overview]`)?.addEventListener("click", () => { current.segment = ""; current.query = ""; current.customConditions = []; current.resultLabel = ""; current.resultsVisible = false; window.CRMDashboard.refresh(); scrollToSegments(); });
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

  window.CRMMobile = { isMobile: mobile, render, bind, filtersSheet, fullSummary, scrollToResults, scrollToSegments, applyAutomaticSegment, applySavedSegment };
})();
