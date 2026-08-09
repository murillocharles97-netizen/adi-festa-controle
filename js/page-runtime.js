(function () {
  "use strict";

  function create(options = {}) {
    if (typeof options.render !== "function")
      throw new TypeError("PageRuntime requer uma função render.");
    let mounting = false,
      queuedRoute = "",
      mountSequence = 0,
      lastRoute = "";

    function snapshot() {
      return {
        mounting,
        queuedRoute,
        mountSequence,
        lastRoute,
        ...(options.snapshot?.() || {}),
      };
    }

    function mount(route) {
      if (mounting) {
        queuedRoute = route;
        options.onQueued?.(route, snapshot());
        return false;
      }
      mounting = true;
      lastRoute = route;
      const mountId = ++mountSequence;
      try {
        options.render(route, { mountId });
        options.onReady?.(route, { mountId, ...snapshot() });
        return true;
      } catch (error) {
        options.onError?.(error, route, { mountId, ...snapshot() });
        return false;
      } finally {
        mounting = false;
        if (queuedRoute) {
          const next = queuedRoute;
          queuedRoute = "";
          queueMicrotask(() => mount(next));
        }
      }
    }

    return Object.freeze({ mount, snapshot });
  }

  window.PageRuntime = Object.freeze({ create });
})();
