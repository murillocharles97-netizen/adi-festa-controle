(() => {
  "use strict";

  const tutorials = new Map();
  let active = null;
  let previousFocus = null;
  let historyEntry = false;
  const reduceMotion = () => matchMedia("(prefers-reduced-motion: reduce)").matches;
  const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[char]);

  function visibleTarget(names) {
    if (typeof names === "function") names = names();
    for (const name of [names].flat().filter(Boolean)) {
      const element = document.querySelector(`[data-tour="${CSS.escape(name)}"]`);
      if (!element) continue;
      const style = getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      if (style.visibility !== "hidden" && style.display !== "none" && rect.width && rect.height) return element;
    }
    return null;
  }

  function place() {
    if (!active) return;
    const { step, root } = active;
    const card = root.querySelector(".veconi-tour-card");
    const spotlight = root.querySelector(".veconi-tour-spotlight");
    const target = step.target ? visibleTarget(step.target) : null;
    if (!target) {
      root.classList.add("is-centered");
      spotlight.hidden = true;
      card.style.left = "";
      card.style.top = "";
      return;
    }
    root.classList.remove("is-centered");
    const safeTop = 12;
    const safeBottom = 12;
    let rect = target.getBoundingClientRect();
    if (rect.bottom < safeTop || rect.top > innerHeight - safeBottom) {
      target.scrollIntoView({ block: "center", behavior: reduceMotion() ? "instant" : "smooth" });
      rect = target.getBoundingClientRect();
    }
    const pad = 7;
    spotlight.hidden = false;
    spotlight.style.left = `${Math.max(0, rect.left - pad)}px`;
    spotlight.style.top = `${Math.max(0, rect.top - pad)}px`;
    spotlight.style.width = `${Math.min(innerWidth, rect.width + pad * 2)}px`;
    spotlight.style.height = `${Math.min(innerHeight, rect.height + pad * 2)}px`;

    const gap = 16;
    const width = card.offsetWidth;
    const height = card.offsetHeight;
    const bounds = {
      top: rect.top - gap,
      bottom: innerHeight - rect.bottom - gap,
      left: rect.left - gap,
      right: innerWidth - rect.right - gap,
    };
    const preferred = step.position || "bottom";
    const fits = (side) => bounds[side] >= ((side === "top" || side === "bottom") ? height : width);
    const side = [preferred, "bottom", "top", "right", "left"].find(fits)
      || Object.keys(bounds).sort((a, b) => bounds[b] - bounds[a])[0];
    const clamp = (value, maximum) => Math.max(12, Math.min(value, Math.max(12, maximum - 12)));
    let left = rect.left + rect.width / 2 - width / 2;
    let top = rect.bottom + gap;
    if (side === "top") top = rect.top - height - gap;
    if (side === "left") { left = rect.left - width - gap; top = rect.top + rect.height / 2 - height / 2; }
    if (side === "right") { left = rect.right + gap; top = rect.top + rect.height / 2 - height / 2; }
    card.style.left = `${clamp(left, innerWidth - width)}px`;
    card.style.top = `${clamp(top, innerHeight - height)}px`;
    card.dataset.position = side;
  }

  function render() {
    if (!active) return;
    const { tutorial, index, root } = active;
    const step = tutorial.steps[index];
    active.step = step;
    const first = index === 0;
    const last = index === tutorial.steps.length - 1;
    const done = step.kind === "complete";
    root.innerHTML = `<div class="veconi-tour-interceptor"></div><div class="veconi-tour-spotlight" aria-hidden="true"></div>
      <section class="veconi-tour-card" role="dialog" aria-modal="true" aria-labelledby="veconi-tour-title" aria-describedby="veconi-tour-description" tabindex="-1">
        <button class="veconi-tour-close" type="button" data-tour-action="skip" aria-label="Fechar tutorial">×</button>
        ${step.kind === "welcome" ? `<div class="veconi-tour-brand"><img src="./assets/veconi-symbol.svg" alt=""><span>VECONI</span></div>` : ""}
        <span class="veconi-tour-progress">${done ? "Tudo pronto" : `${index + 1} de ${tutorial.steps.filter(item => item.kind !== "complete").length}`}</span>
        <h2 id="veconi-tour-title">${escapeHtml(step.title)}</h2>
        <p id="veconi-tour-description">${escapeHtml(step.description)}</p>
        ${step.note ? `<p class="veconi-tour-note">${escapeHtml(step.note)}</p>` : ""}
        <div class="veconi-tour-actions">
          ${!first && !done ? `<button type="button" class="veconi-tour-secondary" data-tour-action="back">Voltar</button>` : ""}
          ${first ? `<button type="button" class="veconi-tour-secondary" data-tour-action="skip">Pular por enquanto</button>` : ""}
          <button type="button" class="veconi-tour-primary" data-tour-action="${done ? "close" : last || index === tutorial.steps.length - 2 ? "finish" : "next"}">${done ? "Começar a usar" : first ? "Começar" : index === tutorial.steps.length - 2 ? "Finalizar" : "Próximo"}</button>
        </div>
      </section>`;
    root.querySelectorAll("[data-tour-action]").forEach(button => button.addEventListener("click", () => {
      const action = button.dataset.tourAction;
      if (action === "next") next();
      if (action === "back") back();
      if (action === "skip") close("skipped");
      if (action === "finish") finish();
      if (action === "close") close("completed");
    }));
    requestAnimationFrame(() => {
      if (!active || active.root !== root) return;
      place();
      root.querySelector(".veconi-tour-card")?.focus({ preventScroll: true });
    });
  }

  function onKeydown(event) {
    if (!active) return;
    if (event.key === "Escape") { event.preventDefault(); close("skipped"); return; }
    if (event.key !== "Tab") return;
    const controls = [...active.root.querySelectorAll("button:not([disabled])")];
    if (!controls.length) return;
    const first = controls[0], last = controls[controls.length - 1];
    if (event.shiftKey && (document.activeElement === first || document.activeElement === active.root.querySelector(".veconi-tour-card"))) {
      event.preventDefault(); last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault(); first.focus();
    }
  }

  function onPopstate() {
    if (!active) return;
    historyEntry = false;
    close("skipped", true);
  }

  function open(id, options = {}) {
    const tutorial = tutorials.get(id);
    if (!tutorial || active || !tutorial.steps.length) return false;
    previousFocus = document.activeElement;
    const root = document.createElement("div");
    root.className = "veconi-tour-root is-centered";
    root.dataset.tutorial = id;
    document.body.appendChild(root);
    active = { tutorial, index: 0, step: tutorial.steps[0], root, options };
    addEventListener("keydown", onKeydown, true);
    addEventListener("resize", place);
    addEventListener("scroll", place, true);
    addEventListener("popstate", onPopstate);
    try {
      history.pushState({ ...history.state, veconiTutorial: id }, "", location.href);
      historyEntry = true;
    } catch { historyEntry = false; }
    tutorial.onStart?.(options);
    render();
    return true;
  }

  function next() {
    if (!active) return;
    if (active.index < active.tutorial.steps.length - 1) { active.index++; render(); }
    else finish();
  }
  function back() {
    if (active?.index > 0) { active.index--; render(); }
  }
  function finish() {
    if (!active) return;
    active.tutorial.onComplete?.(active.options);
    const completeIndex = active.tutorial.steps.findIndex(step => step.kind === "complete");
    if (completeIndex >= 0 && active.index !== completeIndex) { active.index = completeIndex; render(); }
    else close("completed");
  }
  function close(reason = "skipped", fromHistory = false) {
    if (!active) return;
    const { tutorial, root, options, step } = active;
    active = null;
    root.remove();
    removeEventListener("keydown", onKeydown, true);
    removeEventListener("resize", place);
    removeEventListener("scroll", place, true);
    removeEventListener("popstate", onPopstate);
    if (reason === "skipped") tutorial.onSkip?.(options);
    if (!fromHistory && historyEntry && history.state?.veconiTutorial === tutorial.id) history.back();
    historyEntry = false;
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
    previousFocus = null;
    return step.id;
  }

  function register(tutorial) {
    if (!tutorial?.id || !Number.isInteger(tutorial.version) || !Array.isArray(tutorial.steps)) throw Error("Tutorial inválido.");
    tutorials.set(tutorial.id, tutorial);
  }

  window.VeconiTutorialManager = Object.freeze({ register, open, next, back, finish, close, isOpen: () => Boolean(active), getState: () => active ? { id: active.tutorial.id, stepId: active.step.id, index: active.index } : null });
})();
