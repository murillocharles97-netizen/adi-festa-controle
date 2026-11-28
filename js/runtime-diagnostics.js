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

  if (new URLSearchParams(location.search).has("perf-nav")) {
    const routes = [], tasks = [], openedAt = performance.now();
    let tap = null, scrollTouch = null, observer;
    const active = () => performance.now() - openedAt <= 60000;
    function collectTouch(event) {
      if (!active()) return;
      const link = event.target.closest?.("[data-mobile-route], [data-route][href]");
      if (link) tap = { route: link.dataset.mobileRoute || link.dataset.route, at: event.timeStamp };
      else if (event.pointerType === "touch") scrollTouch = event.timeStamp;
    }
    function collectScroll() {
      const sample = routes.at(-1);
      if (active() && sample && scrollTouch !== null && performance.now() - scrollTouch < 1500)
        sample.scrollMs ??= Math.round(performance.now() - scrollTouch);
      scrollTouch = null;
    }
    addEventListener("pointerdown", collectTouch, { passive: true, capture: true });
    addEventListener("scroll", collectScroll, { passive: true, capture: true });
    try {
      observer = new PerformanceObserver(list => {
        for (const entry of list.getEntries()) tasks.push(Math.round(entry.duration));
        if (tasks.length > 20) tasks.splice(0, tasks.length - 20);
      });
      observer.observe({ type: "longtask" });
    } catch {}
    setTimeout(() => {
      observer?.disconnect();
      removeEventListener("pointerdown", collectTouch, true);
      removeEventListener("scroll", collectScroll, true);
    }, 60000);
    api.beginNavigation = route => {
      if (!active()) return null;
      const now = performance.now(), start = tap?.route === route && now - tap.at < 800 ? tap.at : now;
      const sample = { route };
      tap = null;
      scrollTouch = null;
      routes.push(sample);
      if (routes.length > 20) routes.shift();
      return {
        shell: () => { sample.shellMs = Math.round(performance.now() - start); },
        useful: () => requestAnimationFrame(() => setTimeout(() => {
          sample.usefulMs = Math.round(performance.now() - start);
        }, 0)),
      };
    };
    addEventListener("DOMContentLoaded", () => {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "performance-report-button";
      button.textContent = "Copiar desempenho";
      button.onclick = async () => {
        const report = JSON.stringify({ routes, longTasksMs: tasks }, null, 2);
        try {
          await navigator.clipboard.writeText(report);
          button.textContent = "Desempenho copiado";
        } catch {
          window.prompt("Copie os tempos de desempenho", report);
        }
      };
      document.body.append(button);
    }, { once: true });
  }

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
