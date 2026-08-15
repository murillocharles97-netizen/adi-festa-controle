(function () {
  "use strict";
  const PAGE_SIZE = 20;
  const controllers = new Map();
  let scheduled = false;
  let pagingRequests = 0;
  let activeRequest = 0;
  let pageSequence = 0,
    controllerSequence = 0;
  function current() {
    const mobile = matchMedia("(max-width: 767px)").matches;
    const page = document.querySelector("#app .clients-page");
    if (!page) return null;
    const raw = mobile ? window.ClientesMobile?.getState?.() : window.ClientesPage?.getState?.();
    if (!raw) return null;
    const advanced = !mobile && Object.entries(raw.filters || {}).some(([key, value]) =>
      ["semTelefone", "nunca", "vencida", "inativos"].includes(key)
        ? value === true
        : value !== "todos" && value !== "todas",
    );
    const search = String(raw.query || "").trim();
    page.dataset.clientPageInstance ||= String(++pageSequence);
    return { page, pageInstanceId: page.dataset.clientPageInstance, mobile, advanced, mode: search ? "search" : "default", params: { search, filter: (mobile ? raw.filter : raw.quick) || "todos", sort: raw.sort || "nomeAsc", limit: PAGE_SIZE } };
  }
  const keyOf = (context) => JSON.stringify({ mobile: context.mobile, mode: context.mode, ...context.params });
  function liveContext(key, requestId) {
    const live = current();
    return requestId === activeRequest && live && keyOf(live) === key ? live : null;
  }
  function loading(context, active) {
    context.page.classList.toggle("client-cloud-loading", active);
    context.page.setAttribute("aria-busy", String(active));
  }
  function localMatches(context) {
    if (context.mode !== "search" || !window.ClientFilterRules || !window.Clientes?.listar)
      return [];
    return window.ClientFilterRules.filter(window.Clientes.listar(), {
      query: context.params.search,
      status: context.params.filter,
    });
  }
  function sortItems(items, sort) {
    const time = (value) => value ? new Date(value).getTime() || 0 : 0;
    const debt = (client) => Math.abs(Math.min(0, Number(client.saldo || 0)));
    const compare = {
      maiorDebito: (a, b) => debt(b) - debt(a),
      menorDebito: (a, b) => debt(a) - debt(b),
      nomeAsc: (a, b) => window.ClientFilterRules.normalize(a.nome).localeCompare(window.ClientFilterRules.normalize(b.nome), "pt-BR"),
      nomeDesc: (a, b) => window.ClientFilterRules.normalize(b.nome).localeCompare(window.ClientFilterRules.normalize(a.nome), "pt-BR"),
      compraRecente: (a, b) => time(b.ultimaCompra) - time(a.ultimaCompra),
      ultimaCompra: (a, b) => time(b.ultimaCompra) - time(a.ultimaCompra),
      totalComprado: (a, b) => Number(b.totalComprado || 0) - Number(a.totalComprado || 0),
      quantidade: (a, b) => Number(b.quantidadeVendas || 0) - Number(a.quantidadeVendas || 0),
    }[sort];
    return compare ? items.sort(compare) : items;
  }
  function render(context, controller) {
    if (!document.contains(context.page)) return;
    const renderer = context.mobile ? window.ClientesMobile?.renderCard : window.ClientesPage?.renderCard;
    const list = context.page.querySelector(context.mobile ? "#mobile-client-list" : "#client-list");
    if (!renderer || !list) return;
    list.innerHTML = controller.items.length
      ? controller.items.map((client, index) => renderer(client, index)).join("")
      : `<div class="empty-state"><i data-lucide="users"></i><strong>Nenhum cliente encontrado</strong><span>Tente ajustar a busca ou os filtros.</span></div>`;
    context.page.querySelectorAll("#load-more-clients,#mobile-load-sentinel,[data-client-cloud-more]").forEach((item) => item.remove());
    if (context.mobile) list.querySelectorAll(".mobile-swipe-shell").forEach((card) => window.ClientesMobile?.bindCard?.(card));
    if (controller.hasMore) {
      const more = document.createElement(context.mobile ? "div" : "button");
      more.dataset.clientCloudMore = "";
      if (context.mobile) { more.className = "mobile-load-sentinel"; more.innerHTML = "<span></span>Carregando mais clientes..."; }
      else { more.type = "button"; more.className = "btn btn-light load-clients"; more.textContent = "Carregar mais 20 clientes"; }
      list.insertAdjacentElement("afterend", more);
      if (context.mobile && "IntersectionObserver" in window) {
        const observer = new IntersectionObserver((entries) => { if (entries[0]?.isIntersecting) { observer.disconnect(); load(context, false); } }, { rootMargin: "240px" });
        observer.observe(more);
      } else more.onclick = () => load(context, false);
    }
    window.lucide?.createIcons();
  }
  function renderError(context, error) {
    if (!document.contains(context.page)) return;
    const list = context.page.querySelector(context.mobile ? "#mobile-client-list" : "#client-list");
    if (!list || list.querySelector?.("[data-client-id],[data-mobile-card]")) return;
    const code = String(error?.code || "unknown").replace(/^firestore\//, "");
    const message = code === "permission-denied"
      ? "Sem permissão para consultar os clientes desta empresa."
      : code === "failed-precondition"
        ? "A consulta de clientes precisa de um índice da nuvem."
        : "Não foi possível atualizar os clientes agora.";
    list.innerHTML = `<div class="empty-state client-query-error" role="alert"><i data-lucide="cloud-alert"></i><strong>${message}</strong><span>Os dados locais foram preservados.</span><button class="btn btn-light" type="button" data-client-query-retry>Tentar novamente</button></div>`;
    list.querySelector?.("[data-client-query-retry]")?.addEventListener?.("click", () => {
      delete context.page.dataset.clientCloudBound;
      activate(true, { fresh: true, reason: "manual-retry" });
    });
    window.lucide?.createIcons();
  }
  function diagnostic(label, context = current(), detail = {}) {
    const state = context
      ? {
          searchTerm: context.params.search,
          searchMode: context.mode,
          currentFilter: context.params.filter,
          currentSort: context.params.sort,
          activeSearchVersion: activeRequest,
          controllerId: context.controllerId || "",
          pageInstanceId: context.pageInstanceId,
          renderedResults: context.page.querySelectorAll?.("[data-client-id],[data-mobile-card]")?.length || 0,
        }
      : { activeSearchVersion: activeRequest };
    window.AppBootDiagnostics?.phase?.(`clients ${label}`, { ...state, ...detail });
    return state;
  }
  async function load(context, reset = true, options = {}) {
    if (!navigator.onLine || !window.SyncFirebase?.queryClientsPage) return;
    if (context.advanced || ["nunca", "pagamento", "renovacao"].includes(context.params.filter)) { context.page.dataset.clientCloudMode = "local-filter"; return; }
    const key = keyOf(context);
    let controller = controllers.get(key);
    if (!controller) controller = { id: ++controllerSequence, items: [], cursor: null, hasMore: true, loading: false, at: 0 };
    context.controllerId = controller.id;
    if ((!reset && controller.loading) || (!reset && !controller.hasMore)) return;
    if (reset && !options.fresh && controller.items.length && Date.now() - controller.at < 30000) { render(context, controller); return; }
    if (reset) { controller.items = []; controller.cursor = null; controller.hasMore = true; }
    const requestId = ++activeRequest, expectedKey = key;
    diagnostic("query started", context, { requestId, reason: options.reason || "navigation" });
    controller.loading = true; controller.loadingRequestId = requestId; controllers.set(key, controller); loading(context, true);
    try {
      pagingRequests += 1;
      const result = await window.SyncFirebase.queryClientsPage({ ...context.params, cursor: reset ? null : controller.cursor });
      const live = liveContext(expectedKey, requestId);
      if (!live) return;
      if (result.unsupported) {
        live.page.dataset.clientCloudMode = "local-filter";
        return;
      }
      if (live.mode === "default" && reset && !result.items.length && live.page.querySelector("[data-client-id],[data-mobile-card]")) {
        live.page.dataset.clientCloudMode = "local-schema-fallback";
        return;
      }
      // A busca cloud por prefixo exige campos normalizados. Clientes legados
      // que ainda não possuem esses campos continuam disponíveis no cache
      // local; eles não podem desaparecer do filtro Todos. O dado local fica
      // por último para refletir imediatamente pagamentos ainda em sync.
      const local = localMatches(live);
      const combined = reset
        ? [...result.items, ...local]
        : [...controller.items, ...result.items, ...local];
      controller.items = sortItems(
        [...new Map(combined.map((item) => [item.id, item])).values()],
        live.params.sort,
      );
      controller.cursor = result.cursor; controller.hasMore = result.hasMore; controller.at = Date.now();
      live.page.dataset.clientCloudMode = live.mode;
      live.page.dataset.clientDocumentsRead = String(Number(live.page.dataset.clientDocumentsRead || 0) + Number(result.documentsRead || result.items.length));
      render(live, controller);
      diagnostic("query rendered", live, { requestId, controllerId: controller.id, results: controller.items.length });
    } catch (error) {
      const live = liveContext(expectedKey, requestId);
      if (live) {
        live.page.dataset.clientCloudMode = "error";
        renderError(live, error);
      }
      console.error("[Clients Pagination] query failed", { code: error?.code || "unknown", message: error?.message || "Falha na consulta paginada." });
    } finally {
      pagingRequests = Math.max(0, pagingRequests - 1);
      if (controller.loadingRequestId === requestId) {
        controller.loading = false;
        controller.loadingRequestId = null;
      }
      const live = liveContext(expectedKey, requestId);
      if (live) loading(live, false);
      if (!document.contains(context.page)) loading(context, false);
    }
  }
  function activate(force = false, options = {}) {
    scheduled = false;
    const context = current();
    if (!context || (!force && context.page.dataset.clientCloudBound === "true")) return;
    context.page.dataset.clientCloudBound = "true";
    queueMicrotask(() => load(context, true, options));
  }
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(activate); } }
  new MutationObserver(schedule).observe(document.querySelector("#app"), { childList: true, subtree: false });
  let dataRefreshTimer = null;
  function dataChanged(detail = {}) {
    if (detail.collection && detail.collection !== "clients") return;
    clearTimeout(dataRefreshTimer);
    dataRefreshTimer = setTimeout(() => {
      const context = current();
      if (!context) return;
      controllers.delete(keyOf(context));
      delete context.page.dataset.clientCloudBound;
      activate(true, { fresh: true, reason: detail.source || "clients-data-changed" });
    }, 120);
  }
  addEventListener("cloud-data-updated", (event) => dataChanged(event.detail));
  addEventListener("firebase-sync-status", () => {
    const page = document.querySelector("#app .clients-page");
    if (!page || page.dataset.clientCloudMode || !window.SyncFirebase?.queryClientsPage) return;
    delete page.dataset.clientCloudBound;
    schedule();
  });
  function resume(source = "visibilitychange") {
    const before = current();
    if (!before) return;
    diagnostic("resume before", before, { source });
    activeRequest += 1;
    controllers.delete(keyOf(before));
    if (before.mobile) window.ClientesMobile?.restoreActiveState?.();
    else window.ClientesPage?.refresh?.();
    return new Promise((resolve) => queueMicrotask(() => {
      const live = current();
      if (!live) return resolve(false);
      delete live.page.dataset.clientCloudBound;
      diagnostic("resume restored", live, { source });
      load(live, true, { fresh: true, reason: source }).finally(() => resolve(true));
    }));
  }
  window.AppLifecycle?.onResume?.(({ source }) => resume(source));
  window.ClientCloudPagination = {
    activate,
    refresh: () => activate(true),
    cancel: () => { activeRequest += 1; },
    clear: () => { activeRequest += 1; controllers.clear(); },
    dataChanged,
    mode: () => current()?.mode || "default",
    resume,
    snapshot: () => diagnostic("snapshot"),
  };
  schedule();
})();
