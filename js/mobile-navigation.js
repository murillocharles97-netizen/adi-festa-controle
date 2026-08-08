(() => {
  "use strict";

  const MOBILE_QUERY = "(max-width:767px)";
  const gesture = window.MobileNavigationGesture;
  const GROUP_ROUTES = {
    crm: ["crm", "campanhas"],
    online: ["catalogo", "pedidos"],
    history: ["historico", "relatorios"],
  };
  let initialized = false;
  let pendingRoute = "";
  let pointerState = null;

  const sidebar = () => document.querySelector("#sidebar");
  const overlay = () => document.querySelector("#overlay");
  const isMobile = () => matchMedia(MOBILE_QUERY).matches;
  const currentRoute = () => window.Router?.atual?.() || location.hash.replace("#/", "").split("?")[0] || "inicio";
  const group = (name) => document.querySelector(`[data-mobile-nav-group="${name}"]`);

  function cssPixels(name) {
    const value = getComputedStyle(document.documentElement).getPropertyValue(name);
    return Number.parseFloat(value) || 0;
  }

  function ownsHorizontalGesture(target) {
    if (!(target instanceof Element)) return false;
    if (target.closest("[data-swipe],[data-swipe-client],[data-product-shell],.mobile-swipe-shell,.mobile-product-swipe,[data-sidebar-swipe-ignore],[data-no-sidebar-swipe],[role='slider'],input[type='range']")) return true;
    for (let node = target; node && node !== document.body; node = node.parentElement) {
      const style = getComputedStyle(node);
      if (["auto", "scroll"].includes(style.overflowX) && node.scrollWidth > node.clientWidth) return true;
    }
    return false;
  }

  function resetPointer() {
    pointerState = null;
  }

  function onPointerDown(event) {
    if (!gesture || !isMobile() || event.isPrimary === false || event.pointerType === "mouse") return;
    const openNow = Boolean(sidebar()?.classList.contains("open"));
    if (!openNow && document.querySelector("#modal > *, .product-sheet-overlay.open, .message-overlay")) return;
    if (openNow && !event.target.closest?.("#sidebar")) return;
    const safeLeft = cssPixels("--safe-left");
    const horizontalOwner = !openNow && ownsHorizontalGesture(event.target);
    if (!openNow && (event.clientX > safeLeft + gesture.EDGE_ZONE || horizontalOwner)) return;
    pointerState = {
      pointerId: event.pointerId,
      pointerType: event.pointerType || "touch",
      startX: event.clientX,
      startY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      drawerOpen: openNow,
      safeLeft,
      horizontalOwner,
      vertical: false,
    };
  }

  function onPointerMove(event) {
    if (!pointerState || event.pointerId !== pointerState.pointerId) return;
    pointerState.lastX = event.clientX;
    pointerState.lastY = event.clientY;
    const deltaX = event.clientX - pointerState.startX;
    const deltaY = event.clientY - pointerState.startY;
    if (!pointerState.vertical && Math.abs(deltaY) > Math.abs(deltaX) + 8 && Math.abs(deltaY) > 10) pointerState.vertical = true;
    if (pointerState.vertical) return;
    const correctDirection = pointerState.drawerOpen ? deltaX < 0 : deltaX > 0;
    if (correctDirection && gesture.horizontalIntent(deltaX, deltaY)) event.preventDefault();
  }

  function onPointerEnd(event) {
    if (!pointerState || event.pointerId !== pointerState.pointerId) return;
    const state = pointerState;
    resetPointer();
    if (state.vertical) return;
    const action = gesture.classifySwipe({
      ...state,
      endX: event.clientX ?? state.lastX,
      endY: event.clientY ?? state.lastY,
    });
    if (action === "open") open();
    if (action === "close") close();
  }

  function bindGestures() {
    document.addEventListener("pointerdown", onPointerDown, { passive: true });
    document.addEventListener("pointermove", onPointerMove, { passive: false });
    document.addEventListener("pointerup", onPointerEnd, { passive: true });
    document.addEventListener("pointercancel", resetPointer, { passive: true });
  }

  function setGroup(name, expanded) {
    const root = group(name);
    if (!root) return;
    const trigger = root.querySelector(".mobile-nav-group-trigger");
    const items = root.querySelector(".mobile-nav-group-items");
    trigger?.setAttribute("aria-expanded", String(expanded));
    if (items) items.hidden = !expanded;
  }

  function syncActiveGroup(route = currentRoute()) {
    Object.entries(GROUP_ROUTES).forEach(([name, routes]) => {
      if (routes.includes(route)) setGroup(name, true);
    });
  }

  function removeDrawerState() {
    const state = { ...(history.state || {}) };
    delete state.adiFestaDrawer;
    history.replaceState(state, "", location.href);
  }

  function closeVisual() {
    sidebar()?.classList.remove("open");
    overlay()?.classList.remove("show");
    document.documentElement.classList.remove("drawer-open");
    document.querySelector("#menu")?.setAttribute("aria-expanded", "false");
    document.querySelector("#menu")?.setAttribute("aria-label", "Abrir menu");
  }

  function close({ consumeHistory = true } = {}) {
    closeVisual();
    if (consumeHistory && history.state?.adiFestaDrawer) history.back();
    else if (!consumeHistory && history.state?.adiFestaDrawer) removeDrawerState();
  }

  function open() {
    if (!isMobile()) return;
    sidebar()?.classList.add("open");
    overlay()?.classList.add("show");
    document.documentElement.classList.add("drawer-open");
    document.querySelector("#menu")?.setAttribute("aria-expanded", "true");
    document.querySelector("#menu")?.setAttribute("aria-label", "Fechar menu");
    syncActiveGroup();
    if (!history.state?.adiFestaDrawer) history.pushState({ ...(history.state || {}), adiFestaDrawer: true }, "", location.href);
    requestAnimationFrame(() => document.querySelector("#mobile-drawer-close")?.focus({ preventScroll: true }));
  }

  function toggle() {
    sidebar()?.classList.contains("open") ? close() : open();
  }

  function navigate(link) {
    const feature = link.dataset.planFeature;
    if (feature && window.PlansUI?.canUseFeature?.(feature) === false) {
      window.PlansUI.openProModal?.(feature);
      return;
    }
    const route = link.dataset.route;
    if (!route) return;
    pendingRoute = route;
    if (history.state?.adiFestaDrawer) history.back();
    else {
      closeVisual();
      pendingRoute = "";
      window.Router?.ir?.(route);
    }
  }

  function planName() {
    const context = window.BusinessContext?.get?.() || {};
    const subscription = context.subscription || window.FirebaseSession?.subscription || {};
    const plan = context.effectivePlan || context.access?.effectivePlan || {};
    if (subscription.planId === "internal" || context.access?.internal) return "Plano interno";
    if (subscription.status === "trial" || subscription.status === "trialing") return "Teste grátis";
    return `Plano ${plan.name || subscription.planId || "atual"}`;
  }

  function updateBusiness() {
    const context = window.BusinessContext?.get?.() || {};
    const business = context.business || window.FirebaseSession?.business || {};
    const name = String(business.name || window.DB?.carregar?.().config?.nome || "Sua empresa").trim();
    const initials = name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase() || "AF";
    document.querySelectorAll("[data-mobile-business-name]").forEach((item) => (item.textContent = name));
    document.querySelectorAll("[data-mobile-business-initials]").forEach((item) => (item.textContent = initials));
    document.querySelectorAll("[data-mobile-plan]").forEach((item) => (item.textContent = planName()));
    const internal = context.access?.internal === true || subscriptionInternal(context.subscription);
    document.querySelectorAll("[data-mobile-developer]").forEach((item) => (item.hidden = !internal));
    document.querySelectorAll("[data-mobile-coupons]").forEach((item) => (item.hidden = !internal));
  }

  function subscriptionInternal(subscription = {}) {
    return subscription.planId === "internal" && ["active", "internal"].includes(subscription.status);
  }

  function updateOrders() {
    const orders = window.DB?.carregar?.().catalogOrders || [];
    const count = orders.filter((order) => order.orderStatus === "recebido").length;
    document.querySelectorAll("[data-mobile-orders-count]").forEach((item) => {
      item.hidden = count < 1;
      item.textContent = count > 99 ? "99+" : String(count);
    });
  }

  function updateSync(event) {
    const state = event?.detail || window.SyncFirebaseState || {};
    const label = state.status === "error" ? "Erro na nuvem" : Number(state.queueTotal || state.pending) > 0 ? `${Number(state.queueTotal || state.pending)} pendente(s)` : state.status === "success" ? "Sincronizado" : navigator.onLine ? "Dados no aparelho" : "Offline";
    document.querySelectorAll("[data-mobile-sync-label]").forEach((item) => (item.textContent = label));
  }

  function update(route = currentRoute()) {
    syncActiveGroup(route);
    updateBusiness();
    updateOrders();
    const version = window.AdiFestaBuild?.release || "1.0.0";
    document.querySelectorAll("[data-mobile-app-version]").forEach((item) => (item.textContent = `v${version}`));
    updateSync();
  }

  function init() {
    if (initialized) return;
    initialized = true;
    document.querySelector("#mobile-drawer-close")?.addEventListener("click", () => close());
    bindGestures();
    document.querySelectorAll(".mobile-nav-group-trigger").forEach((trigger) => trigger.addEventListener("click", () => {
      const root = trigger.closest("[data-mobile-nav-group]");
      setGroup(root.dataset.mobileNavGroup, trigger.getAttribute("aria-expanded") !== "true");
    }));
    document.querySelectorAll(".mobile-sidebar-nav a[data-route]").forEach((link) => link.addEventListener("click", (event) => {
      if (!isMobile()) return;
      event.preventDefault();
      navigate(link);
    }));
    addEventListener("popstate", () => {
      if (sidebar()?.classList.contains("open")) closeVisual();
      if (pendingRoute) {
        const route = pendingRoute;
        pendingRoute = "";
        setTimeout(() => window.Router?.ir?.(route), 0);
      }
    });
    addEventListener("business-context-changed", () => update());
    addEventListener("firebase-auth-ready", () => update());
    addEventListener("firebase-sync-status", updateSync);
    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape" && sidebar()?.classList.contains("open")) close();
    });
    matchMedia(MOBILE_QUERY).addEventListener("change", (event) => {
      if (!event.matches) close({ consumeHistory: false });
      update();
    });
    update();
  }

  window.MobileNavigation = { init, open, close, toggle, update, syncActiveGroup };
  init();
})();
