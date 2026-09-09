(() => {
  "use strict";

  const scriptUrl = document.currentScript?.src || location.href;
  const symbolSrc = new URL("../assets/veconi-symbol.svg", scriptUrl).href;

  const esc = (value) => String(value ?? "").replace(/[&<>'"]/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[char]);

  function markup({ mode = "horizontal", tagline = mode !== "symbol", className = "" } = {}) {
    const classes = ["veconi-logo", `veconi-logo--${mode}`, className].filter(Boolean).join(" ");
    const wordmark = mode === "symbol" ? "" : `<span class="veconi-wordmark"><b><span aria-hidden="true">econi</span><span class="sr-only">VECONI</span></b>${tagline ? "<small>Seu negócio mais completo.</small>" : ""}</span>`;
    return `<span class="${esc(classes)}" aria-label="VECONI${tagline ? ". Seu negócio mais completo." : ""}"><img src="${esc(symbolSrc)}" alt="" width="48" height="48">${wordmark}</span>`;
  }

  function hydrate(root = document) {
    root.querySelectorAll("[data-veconi-logo]").forEach((element) => {
      if (element.dataset.veconiReady === "true") return;
      element.dataset.veconiReady = "true";
      element.innerHTML = markup({
        mode: element.dataset.veconiLogo || "horizontal",
        tagline: element.dataset.veconiTagline !== "false",
      });
    });
  }

  window.VeconiBrand = Object.freeze({ markup, hydrate });
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => hydrate(), { once: true });
  else hydrate();
})();
