(function () {
  "use strict";

  if (window.AppLifecycle) return;

  const subscribers = new Set(),
    backgroundSubscribers = new Set();
  let backgrounded = document.visibilityState === "hidden";
  let resumeSequence = 0;
  let resumePromise = null;
  let lastResumeAt = 0;
  let lastBackgroundAt = backgrounded ? Date.now() : 0;

  const diagnostic = (name, detail = {}) =>
    window.AppBootDiagnostics?.phase?.(`lifecycle ${name}`, {
      route: window.Router?.atual?.() || "",
      visibilityState: document.visibilityState,
      businessId: window.FirebaseSession?.businessId || "",
      resumeSequence,
      ...detail,
    });

  function background(source) {
    if (backgrounded) return;
    backgrounded = true;
    lastBackgroundAt = Date.now();
    diagnostic("background", { source });
    const detail = Object.freeze({
      source,
      route: window.Router?.atual?.() || "",
      at: lastBackgroundAt,
    });
    for (const subscriber of [...backgroundSubscribers]) {
      try { subscriber(detail); }
      catch (error) {
        console.error("[Lifecycle] background subscriber failed", {
          source,
          code: error?.code || "BACKGROUND_FAILED",
          message: error?.message || "Falha ao suspender o aplicativo.",
        });
      }
    }
  }

  function resume(source) {
    const now = Date.now();
    if (!backgrounded && now - lastResumeAt < 400) return resumePromise;
    if (resumePromise) return resumePromise;
    backgrounded = false;
    lastResumeAt = now;
    const resumeId = ++resumeSequence;
    diagnostic("resume start", { source, resumeId });
    const detail = Object.freeze({
      source,
      resumeId,
      route: window.Router?.atual?.() || "",
      backgroundDurationMs: lastBackgroundAt
        ? Math.max(0, now - lastBackgroundAt)
        : 0,
    });
    resumePromise = Promise.resolve()
      .then(async () => {
        for (const subscriber of [...subscribers]) {
          try {
            await subscriber(detail);
          } catch (error) {
            console.error("[Lifecycle] resume subscriber failed", {
              source,
              resumeId,
              code: error?.code || "RESUME_FAILED",
              message: error?.message || "Falha ao retomar o aplicativo.",
            });
          }
        }
        dispatchEvent(new CustomEvent("app-resumed", { detail }));
        diagnostic("resume complete", { source, resumeId });
        return detail;
      })
      .finally(() => {
        resumePromise = null;
      });
    return resumePromise;
  }

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") background("visibilitychange");
    else resume("visibilitychange");
  });
  addEventListener("pagehide", () => background("pagehide"));
  addEventListener("pageshow", (event) => {
    if (event.persisted) resume("pageshow-bfcache");
  });
  addEventListener("focus", () => {
    if (backgrounded && document.visibilityState !== "hidden") resume("focus");
  });

  window.AppLifecycle = Object.freeze({
    onResume(callback) {
      subscribers.add(callback);
      return () => subscribers.delete(callback);
    },
    onBackground(callback) {
      backgroundSubscribers.add(callback);
      return () => backgroundSubscribers.delete(callback);
    },
    resume,
    snapshot: () => ({
      backgrounded,
      resumeSequence,
      subscriberCount: subscribers.size,
      backgroundSubscriberCount: backgroundSubscribers.size,
      resumeInFlight: Boolean(resumePromise),
      lastResumeAt,
      lastBackgroundAt,
    }),
  });
})();
