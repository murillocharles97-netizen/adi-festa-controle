(function () {
  "use strict";
  const PAGE_SIZE = 20;
  const controllers = new Map();
  let scheduled = false;
  let pagingRequests = 0;
  let activeRequest = 0;
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
    return { page, mobile, advanced, mode: search ? "search" : "default", params: { search, filter: (mobile ? raw.filter : raw.quick) || "todos", sort: raw.sort || "nomeAsc", limit: PAGE_SIZE } };
  }
  const keyOf = (context) => JSON.stringify({ mobile: context.mobile, mode: context.mode, ...context.params });
  function isCurrent(context, key, requestId) {
    const live = current();
    return requestId === activeRequest && live?.page === context.page && keyOf(live) === key;
  }
  function loading(context, active) {
    context.page.classList.toggle("client-cloud-loading", active);
    context.page.setAttribute("aria-busy", String(active));
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
  async function load(context, reset = true) {
    if (!navigator.onLine || !window.SyncFirebase?.queryClientsPage) return;
    if (context.advanced || ["nunca", "pagamento"].includes(context.params.filter)) { context.page.dataset.clientCloudMode = "local-filter"; return; }
    const key = keyOf(context);
    let controller = controllers.get(key);
    if (!controller) controller = { items: [], cursor: null, hasMore: true, loading: false, at: 0 };
    if (controller.loading || (!reset && !controller.hasMore)) return;
    if (reset && controller.items.length && Date.now() - controller.at < 30000) { render(context, controller); return; }
    if (reset) { controller.items = []; controller.cursor = null; controller.hasMore = true; }
    const requestId = ++activeRequest, expectedKey = key;
    controller.loading = true; controllers.set(key, controller); loading(context, true);
    try {
      pagingRequests += 1;
      const result = await window.SyncFirebase.queryClientsPage({ ...context.params, cursor: reset ? null : controller.cursor });
      if (!isCurrent(context, expectedKey, requestId)) return;
      if (result.unsupported) return;
      if (context.mode === "default" && reset && !result.items.length && context.page.querySelector("[data-client-id],[data-mobile-card]")) {
        context.page.dataset.clientCloudMode = "local-schema-fallback";
        return;
      }
      const combined = reset ? result.items : [...controller.items, ...result.items];
      controller.items = [...new Map(combined.map((item) => [item.id, item])).values()];
      controller.cursor = result.cursor; controller.hasMore = result.hasMore; controller.at = Date.now();
      context.page.dataset.clientCloudMode = context.mode;
      context.page.dataset.clientDocumentsRead = String(Number(context.page.dataset.clientDocumentsRead || 0) + Number(result.documentsRead || result.items.length));
      render(context, controller);
    } catch (error) {
      context.page.dataset.clientCloudMode = "local-fallback";
      console.warn("[Clients Pagination] mantendo cache local", { code: error?.code || "unknown", message: error?.message || "Falha na consulta paginada." });
    } finally {
      pagingRequests = Math.max(0, pagingRequests - 1);
      controller.loading = false;
      if (isCurrent(context, expectedKey, requestId)) loading(context, false);
    }
  }
  function activate(force = false) {
    scheduled = false;
    const context = current();
    if (!context || (!force && context.page.dataset.clientCloudBound === "true")) return;
    context.page.dataset.clientCloudBound = "true";
    queueMicrotask(() => load(context, true));
  }
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(activate); } }
  new MutationObserver(schedule).observe(document.querySelector("#app"), { childList: true, subtree: false });
  addEventListener("cloud-data-updated", (event) => {
    if (event.detail?.collection !== "clients" || pagingRequests) return;
    controllers.clear();
    const page = document.querySelector("#app .clients-page");
    if (page) { delete page.dataset.clientCloudBound; schedule(); }
  });
  addEventListener("firebase-sync-status", () => {
    const page = document.querySelector("#app .clients-page");
    if (!page || page.dataset.clientCloudMode || !window.SyncFirebase?.queryClientsPage) return;
    delete page.dataset.clientCloudBound;
    schedule();
  });
  window.ClientCloudPagination = {
    activate,
    refresh: () => activate(true),
    cancel: () => { activeRequest += 1; },
    clear: () => { activeRequest += 1; controllers.clear(); },
    mode: () => current()?.mode || "default",
  };
  schedule();
})();
