(function () {
  "use strict";

  const startedAt = performance.now(),
    enabled =
      new URLSearchParams(location.search).has("boot-diagnostic") ||
      localStorage.getItem("adiFestaDevMetrics") === "1",
    counters = {
      bootstrapCount: 0,
      initialSyncCount: 0,
      hydrateCount: 0,
      dashboardRenderCount: 0,
      routeRenderCount: 0,
      dataChangedCount: 0,
    },
    phases = [],
    longTasks = [];

  function count(name, detail = {}) {
    counters[name] = Number(counters[name] || 0) + 1;
    const entry = {
      type: "counter",
      name,
      value: counters[name],
      elapsedMs: Math.round(performance.now() - startedAt),
      ...detail,
    };
    phases.push(entry);
    if (phases.length > 80) phases.shift();
    if (enabled) console.info(`[BOOT DIAGNOSTIC] ${name}`, entry);
    return counters[name];
  }

  function phase(name, detail = {}) {
    const entry = {
      type: "phase",
      name,
      elapsedMs: Math.round(performance.now() - startedAt),
      ...detail,
    };
    phases.push(entry);
    if (phases.length > 80) phases.shift();
    if (enabled) console.info(`[BOOT DIAGNOSTIC] ${name}`, entry);
    return entry;
  }

  async function measure(name, operation, detail = {}) {
    const start = performance.now();
    try {
      return await operation();
    } finally {
      phase(name, { ...detail, durationMs: Math.round(performance.now() - start) });
    }
  }

  const api = {
    count,
    phase,
    measure,
    snapshot: () => ({
      elapsedMs: Math.round(performance.now() - startedAt),
      counters: { ...counters },
      phases: [...phases],
      longTasks: [...longTasks],
    }),
  };
  window.AppBootDiagnostics = api;

  addEventListener("error", (event) => {
    phase("uncaught error", {
      route: window.Router?.atual?.() || "",
      message: event.error?.message || event.message || "Erro JavaScript",
      source: event.filename || "",
      line: event.lineno || 0,
    });
  });
  addEventListener("unhandledrejection", (event) => {
    phase("unhandled rejection", {
      route: window.Router?.atual?.() || "",
      code: event.reason?.code || "UNHANDLED_REJECTION",
      message: event.reason?.message || String(event.reason || "Promise rejeitada"),
    });
  });

  if (typeof PerformanceObserver === "function") {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const item of list.getEntries()) {
          const entry = {
            name: item.name || "longtask",
            startMs: Math.round(item.startTime),
            durationMs: Math.round(item.duration),
          };
          longTasks.push(entry);
          if (longTasks.length > 20) longTasks.shift();
          if (enabled) console.warn("[BOOT DIAGNOSTIC] Long Task", entry);
        }
      });
      observer.observe({ type: "longtask", buffered: true });
      setTimeout(() => observer.disconnect(), 30000);
    } catch {}
  }
})();
