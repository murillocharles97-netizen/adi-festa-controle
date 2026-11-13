// Renovações: operational view of the recurring plans sold to the business's customers.
// Read-only screen. Renewing goes through Checkout.prepareRenewal (via the existing
// [data-renew-subscription] handler), reminders through the existing WhatsApp link
// ([data-renewal-whatsapp]) or the Central de Mensagens with a pre-selected audience.
window.RenovacoesUI = (() => {
  const $ = (selector, root = document) => root.querySelector(selector);
  const esc = (value) => Utils.escapar(value), money = (value) => Utils.dinheiro(value);
  const icon = (name) => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const PAGE = 40;
  // Order shown to the merchant. `scope` tells how each indicator relates to the others.
  const FILTERS = [
    { key: "dueToday", label: "Vencem hoje", scope: "Inclusas em Ativas", tone: "danger", empty: "Nenhuma assinatura vence hoje." },
    { key: "next7", label: "Próximos 7 dias", scope: "Inclusas em Ativas", tone: "warning", empty: "Nenhuma assinatura vence nos próximos 7 dias." },
    { key: "expired", label: "Vencidas", scope: "Fora de Ativas", tone: "danger", empty: "Nenhuma assinatura vencida." },
    { key: "renewedRecently", label: "Renovadas · 30 dias", scope: "Podem estar em Ativas ou Vencidas", tone: "violet", empty: "Nenhuma renovação nos últimos 30 dias." },
    { key: "active", label: "Ativas", scope: "Total em vigência", tone: "info", empty: "Nenhuma assinatura ativa." },
    { key: "paused", label: "Pausadas", scope: "Fora de Ativas", tone: "muted", empty: "Nenhuma assinatura pausada." },
  ];
  const UNITS = { days: ["dia", "dias"], weeks: ["semana", "semanas"], months: ["mês", "meses"], years: ["ano", "anos"] };
  let state = fresh();
  // Page-level view: "all" (every authorized space) or a space id. Survives re-renders, not businesses.
  let view = { business: null, value: null };
  const ALL = "all";
  function fresh() {
    return { filter: null, query: "", selected: new Set(), limit: PAGE, loaded: null, loading: false, error: null, token: 0 };
  }
  const subscriptions = () => window.CustomerSubscriptions;
  const canRenew = () => window.TeamAccess?.canRoute?.("vender") !== false && window.PriorSales?.active?.() !== true;
  const canMessage = () => Boolean(window.MobileMessages?.openCenter) && window.Mensagens?.canSend?.() !== false;
  const client = (id) => window.Clientes?.viewClient?.(id) || window.Clientes?.obter?.(id) || null;
  const spaces = () => window.SpaceContext?.customerSpaces?.() || [];
  const multiSpace = () => spaces().length > 1 && window.SpaceContext?.scopesCustomers?.() === true;
  const businessId = () => window.SpaceContext?.snapshot?.().businessId || window.DB?.getBusinessId?.() || null;
  function currentView() {
    if (view.business !== businessId()) view = { business: businessId(), value: null };
    return view.value === ALL && multiSpace() ? ALL : window.SpaceContext?.activeId?.() || null;
  }
  const spaceName = (id) => spaces().find((space) => space.id === id)?.name || "Espaço não confirmado";
  const origin = (item) => subscriptions().originSpace?.(item) || null;
  const rowById = (id) => (state.loaded?.rows || []).find((item) => item.id === id) || null;
  const bulkAllowed = () => canMessage() && !["restricted", "no-space"].includes(state.loaded?.source) && currentView() !== ALL;
  function planName(item) {
    const product = window.Produtos?.obter?.(item.productId),
      variant = item.variantId ? window.ProductVariations?.get?.(item.variantId) : null;
    return { label: item.label || product?.nome || "Plano", detail: variant ? window.ProductVariations?.displayName?.(variant) || "" : product?.nome || "" };
  }
  const describe = (item) => {
    const person = client(item.clientId), plan = planName(item);
    return [person?.nome, person?.telefone, plan.label, plan.detail].filter(Boolean).join(" ");
  };
  const period = (item) => {
    const value = Number(item.durationValue || 0), unit = UNITS[item.durationUnit] || UNITS.days;
    return value ? `${value} ${value === 1 ? unit[0] : unit[1]}` : "";
  };
  const civilDate = (value) => value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—";
  function dueBadge(item, filter) {
    const days = item.daysUntil;
    if (filter === "renewedRecently") return ["violet", item.renewedDaysAgo === 0 ? "Renovou hoje" : `Renovou há ${item.renewedDaysAgo} d`];
    if (item.effectiveStatus === "paused") return ["muted", "Pausada"];
    if (item.effectiveStatus === "expired") return ["danger", days === 0 ? "Venceu hoje" : `Venceu há ${Math.abs(days ?? 0)} d`];
    if (days === 0) return ["danger", "Vence hoje"];
    if (days === 1) return ["warning", "Vence amanhã"];
    return [days !== null && days <= 7 ? "warning" : "info", `Em ${days} dias`];
  }
  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  function render() {
    state = fresh();
    return `<section class="renewals-page" data-renewals-page aria-labelledby="renewals-heading">
      <header class="renewals-head"><h2 id="renewals-heading">Renovações</h2><p>Planos mensais e serviços recorrentes dos seus clientes.</p></header>
      <div class="renewals-toolbar"><label class="renewals-search"><span class="sr-only">Buscar cliente, telefone ou plano</span>${icon("search")}<input type="search" data-renewals-search placeholder="Buscar cliente, telefone ou plano" autocomplete="off" enterkeyhint="search"></label>
        <button class="btn btn-light renewals-refresh" type="button" data-renewals-refresh aria-label="Atualizar renovações">${icon("refresh-cw")}<span>Atualizar</span></button></div>
      <div data-renewals-space>${spaceBar()}</div>
      <div data-renewals-notice></div>
      <nav class="renewals-kpis" data-renewals-kpis aria-label="Indicadores e filtros de renovação">${FILTERS.map((item) => `<span class="renewals-kpi is-loading" aria-hidden="true"><small>${esc(item.label)}</small><b>—</b><em>&nbsp;</em></span>`).join("")}</nav>
      <p class="renewals-overlap">${icon("info")}<span><b>Os números não se somam.</b> Vencem hoje e Próximos 7 dias também estão em Ativas; Renovadas podem estar em Ativas ou Vencidas.</span></p>
      <section class="renewals-list-panel" aria-live="polite"><header><div><h3 data-renewals-title>Carregando…</h3><small data-renewals-count></small></div><span data-renewals-select-slot></span></header><div data-renewals-list><div class="renewals-skeleton"></div><div class="renewals-skeleton"></div><div class="renewals-skeleton"></div></div></section>
      <div class="renewals-bulk" data-renewals-bulk hidden role="region" aria-label="Clientes selecionados"></div>
    </section>`;
  }
  function spaceBar() {
    const list = spaces(), selected = currentView();
    if (list.length > 1 && multiSpace())
      return `<label class="renewals-space">${icon("map-pin")}<span>Espaço</span><select data-renewals-space-select aria-label="Espaço das renovações"><option value="${ALL}" ${selected === ALL ? "selected" : ""}>Todos os espaços (${list.length})</option>${list.map((space) => `<option value="${esc(space.id)}" ${selected === space.id ? "selected" : ""}>${esc(space.name)}</option>`).join("")}</select></label>`;
    if (list.length === 1) return `<p class="renewals-space is-single">${icon("map-pin")}<span>Espaço</span><b>${esc(list[0].name)}</b></p>`;
    return "";
  }
  function counts(board) {
    return Object.fromEntries(FILTERS.map(({ key }) => [key, board.counts[key] || 0]));
  }
  // "+" marks a lower bound: shown unless this indicator was proven complete.
  const exactCount = (key) => state.loaded?.complete === true || state.loaded?.exact?.[key] === true;
  const countLabel = (value, key) => `${value}${exactCount(key) ? "" : "+"}`;
  function currentBoard() {
    return subscriptions().board(state.loaded?.rows || [], { query: state.query, describe });
  }
  function notice() {
    const meta = state.loaded;
    if (!meta) return "";
    if (meta.source === "no-space")
      return `<p class="renewals-notice is-warning">${icon("map-pin-off")}<span>Nenhum espaço autorizado foi carregado para este acesso, então não há como mostrar renovações. Toque em Atualizar ou peça ao proprietário para revisar seus espaços em Equipe.</span></p>`;
    if (meta.source === "restricted")
      return `<p class="renewals-notice is-info">${icon("lock")}<span>Seu acesso consulta a vigência pelo perfil de cada cliente. Abra o cliente em Clientes para renovar.</span></p>`;
    if (meta.source === "device")
      return `<p class="renewals-notice is-warning">${icon("wifi-off")}<span>Mostrando o que está salvo neste aparelho. Os números podem estar incompletos até a conexão voltar.</span></p>`;
    const lines = [];
    if (meta.limitReached)
      lines.push(`Esta conta tem mais de ${meta.limit} vigências em alguma situação. Lemos as ${meta.limit} mais urgentes de cada uma; números com “+” são mínimos. Use a busca para encontrar um cliente.`);
    if (meta.localOnly)
      lines.push(`${meta.localOnly} vigência${meta.localOnly === 1 ? "" : "s"} deste aparelho ainda não ${meta.localOnly === 1 ? "foi confirmada" : "foram confirmadas"} na nuvem e não ${meta.localOnly === 1 ? "entra" : "entram"} nos números.`);
    return lines.map((text) => `<p class="renewals-notice is-warning">${icon("triangle-alert")}<span>${esc(text)}</span></p>`).join("");
  }
  function row(item, filter) {
    const person = client(item.clientId), plan = planName(item), [tone, text] = dueBadge(item, filter),
      phone = Utils.somenteNumeros(person?.telefone), checked = state.selected.has(item.id), name = person?.nome || "Cliente sem cadastro neste aparelho",
      reminded = state.reminded?.get(item.id);
    const renew = canRenew() && item.effectiveStatus !== "cancelled"
      ? `<button class="btn btn-primary" type="button" data-renewals-renew="${esc(item.id)}">${icon("refresh-cw")}<span>Renovar</span></button>` : "";
    const remind = phone.length >= 10
      ? `<button class="btn btn-light" type="button" data-renewals-remind="${esc(item.id)}">${icon("message-circle")}<span>Lembrar</span></button>`
      : `<button class="btn btn-light" type="button" disabled title="Cliente sem WhatsApp válido" aria-label="Lembrar indisponível: cliente sem WhatsApp válido">${icon("message-circle-off")}<span>Lembrar</span></button>`;
    return `<article class="renewal-row tone-${tone}">
      ${bulkAllowed() ? `<label class="renewal-select"><input type="checkbox" data-renewals-select="${esc(item.id)}" ${checked ? "checked" : ""} aria-label="Selecionar ${esc(plan.label)} de ${esc(name)}"></label>` : ""}
      <span class="renewal-avatar" aria-hidden="true">${esc(initials(person?.nome))}</span>
      <div class="renewal-who"><b>${esc(name)}</b><small>${esc(person?.telefone || "Sem telefone")}</small></div>
      <div class="renewal-plan"><b>${esc(plan.label)}</b>${currentView() === ALL ? `<span class="renewal-space-chip">${icon("map-pin")}${esc(spaceName(origin(item)))}</span>` : ""}<small>${money(item.contractedPrice)}${period(item) ? ` / ${esc(period(item))}` : ""} · ${item.effectiveStatus === "expired" ? "venceu" : "vence"} ${civilDate(item.expiresAt)}</small></div>
      <span class="renewal-due-cell"><span class="renewal-due tone-${tone}">${esc(text)}</span>${reminded ? `<em class="renewal-reminded" title="Lembrete confirmado hoje às ${esc(window.RenewalMessages?.time?.(reminded.sentAt) || "")}">${icon("circle-check")}Lembrado hoje</em>` : ""}</span>
      <div class="renewal-actions">${renew}${remind}<button class="btn btn-light renewal-profile" type="button" data-renewals-profile="${esc(item.id)}" aria-label="Abrir perfil de ${esc(name)}">${icon("user-round")}<span>Perfil</span></button></div>
    </article>`;
  }
  function emptyState(filter, total) {
    if (state.loaded?.source === "restricted") return `<div class="renewals-empty">${icon("lock")}<p>Consulta disponível pelo perfil do cliente.</p></div>`;
    if (state.loaded?.source === "no-space") return `<div class="renewals-empty">${icon("map-pin-off")}<p>Sem espaço autorizado carregado.</p></div>`;
    if (!total && !state.query)
      return `<div class="renewals-empty">${icon("calendar-plus")}<b>Nenhuma assinatura ainda</b><p>Cadastre um produto do tipo recorrente e venda para um cliente. A vigência aparece aqui.</p><button class="btn btn-light" type="button" data-go-route="produtos">${icon("package")} Ir para Produtos</button></div>`;
    const config = FILTERS.find((item) => item.key === filter);
    return `<div class="renewals-empty">${icon(state.query ? "search-x" : "circle-check")}<p>${state.query ? `Nenhum resultado para “${esc(state.query)}” em ${esc(config.label)}.` : esc(config.empty)}</p></div>`;
  }
  function draw() {
    const page = $("[data-renewals-page]");
    if (!page || !state.loaded) return;
    state.reminded = window.RenewalMessages?.remindedToday?.() || new Map();
    const board = currentBoard(), totals = counts(board);
    if (!state.filter) state.filter = ["dueToday", "next7", "expired"].find((key) => totals[key]) || "active";
    const filter = state.filter, config = FILTERS.find((item) => item.key === filter), rows = board.buckets[filter] || [];
    $("[data-renewals-notice]", page).innerHTML = notice();
    const restricted = state.loaded.source === "restricted" || state.loaded.source === "no-space";
    page.classList.toggle("is-restricted", restricted);
    $("[data-renewals-kpis]", page).innerHTML = FILTERS.map((item) => `<button class="renewals-kpi tone-${item.tone}" type="button" data-renewals-filter="${item.key}" aria-pressed="${item.key === filter}"><small>${esc(item.label)}</small><b>${countLabel(totals[item.key], item.key)}</b><em>${esc(item.scope)}</em></button>`).join("");
    $("[data-renewals-title]", page).textContent = restricted ? (state.loaded.source === "no-space" ? "Espaço indisponível" : "Consulta pelo perfil") : config.label;
    const forecast = filter === "dueToday" || filter === "next7" ? ` · ${money(board.buckets[filter].reduce((sum, item) => sum + Number(item.contractedPrice || 0), 0))} previstos` : "";
    $("[data-renewals-count]", page).textContent = restricted ? "" : `${countLabel(rows.length, filter)} ${rows.length === 1 ? "assinatura" : "assinaturas"}${forecast}`;
    const visible = rows.slice(0, state.limit), allTotal = (state.loaded.rows || []).length;
    $("[data-renewals-list]", page).innerHTML = visible.length
      ? `${visible.map((item) => row(item, filter)).join("")}${rows.length > visible.length ? `<button class="btn btn-light renewals-more" type="button" data-renewals-more>Mostrar mais ${Math.min(PAGE, rows.length - visible.length)} de ${rows.length - visible.length} restantes</button>` : ""}`
      : emptyState(filter, allTotal);
    drawBulk();
    window.lucide?.createIcons?.();
  }
  // Quick selections for reminders (active space only). Already reminded today stay out unless picked one by one.
  const QUICK = [
    ["today", "Hoje"], ["tomorrow", "Amanhã"], ["week", "Até 7 dias"], ["expired", "Vencidas"], ["schedule", "Lembretes do dia"],
  ];
  function quickGroups(board) {
    const active = board.buckets.active || [];
    return {
      today: board.buckets.dueToday || [],
      tomorrow: active.filter((item) => item.daysUntil === 1),
      week: board.buckets.next7 || [],
      expired: board.buckets.expired || [],
      // Product reminder days (7/1/0) copied to each subscription at sale time.
      schedule: active.filter((item) => (Array.isArray(item.reminders) ? item.reminders : []).map(Number).includes(item.daysUntil)),
    };
  }
  function selectedRows() {
    const ids = state.selected;
    return (state.loaded?.rows || []).filter((item) => ids.has(item.id));
  }
  function drawBulk() {
    const bar = $("[data-renewals-bulk]"), slot = $("[data-renewals-select-slot]");
    if (!bar || !slot) return;
    const enabled = bulkAllowed(), size = state.selected.size, board = currentBoard(), groups = quickGroups(board);
    const fresh = (rows) => rows.filter((item) => !state.reminded?.has(item.id));
    slot.innerHTML = enabled && (state.loaded?.rows || []).length
      ? `<div class="renewals-quick" role="group" aria-label="Selecionar para lembrar"><span>Selecionar</span>${QUICK.map(([key, label]) => { const count = fresh(groups[key]).length; return `<button type="button" data-renewals-quick="${key}" ${count ? "" : "disabled"}>${esc(label)} <b>${count}</b></button>`; }).join("")}</div>`
      : canMessage() && currentView() === ALL && (state.loaded?.rows || []).length ? `<small class="renewals-space-hint">Para lembrar em lote, escolha um espaço: a Central trabalha por espaço.</small>` : "";
    bar.closest("[data-renewals-page]")?.classList.toggle("has-selection", Boolean(enabled && size));
    if (!enabled || !size) { bar.hidden = true; bar.innerHTML = ""; return; }
    const rows = selectedRows(), people = new Set(rows.map((item) => item.clientId)).size;
    bar.hidden = false;
    bar.innerHTML = `<div class="renewals-bulk-copy"><b>${size} ${size === 1 ? "assinatura" : "assinaturas"} · ${people} ${people === 1 ? "cliente" : "clientes"}</b><small>Lembrete de renovação na Central: plano, valor e vencimento de cada assinatura, sem saldo de Fiado. Envio manual, um cliente por vez.</small></div>
      <div class="renewals-bulk-actions"><button class="btn btn-light" type="button" data-renewals-clear>Limpar</button>
      <button class="btn btn-primary" type="button" data-renewals-center>${icon("send")}<span>Preparar lembretes</span></button></div>`;
  }
  async function load({ force = false } = {}) {
    const app = $("#app"), instance = app?.dataset.pageInstance, token = ++state.token;
    state.loading = true;
    try {
      if (force) subscriptions()?.view?.invalidateSpace?.();
      const page = $("[data-renewals-page]"), selected = currentView();
      if (page) page.dataset.loadedView = viewKey();
      const loaded = await subscriptions().view.loadBoardRows(selected === ALL ? { spaceIds: spaces().map((space) => space.id) } : {});
      if (token !== state.token || app?.dataset.pageInstance !== instance) return;
      state.loaded = loaded;
      state.error = null;
      // "Lembrado hoje" also covers reminders confirmed on other devices.
      window.RenewalMessages?.loadToday?.().then((fresh) => { if (fresh && token === state.token) draw(); });
    } catch (error) {
      if (token !== state.token || app?.dataset.pageInstance !== instance) return;
      // Keep the screen usable with this device's data, and say so.
      state.loaded = { rows: subscriptions().list().filter((item) => window.SpaceContext?.showsRenewal?.(item) ?? true), source: "device", complete: false, localOnly: 0 };
      console.warn("[Renovações] leitura da nuvem indisponível", { code: error?.code || "unknown" });
    } finally {
      if (token === state.token) state.loading = false;
    }
    draw();
  }
  const viewKey = () => JSON.stringify([window.SpaceContext?.viewScope?.() ?? null, currentView()]);
  // Renewing or opening the profile always happens in the subscription's own space: when the
  // screen shows "Todos os espaços", the active space switches to the origin first.
  function adoptOrigin(item, { required = false } = {}) {
    // Without spaces in use there is nothing to switch; Checkout still validates the origin.
    if (!window.SpaceContext?.scopesCustomers?.()) return true;
    const id = origin(item);
    if (!id) {
      if (required) Utils.toast("O espaço de origem desta assinatura não está confirmado. Confira no perfil do cliente.", true);
      return !required;
    }
    if (window.SpaceContext.activeId?.() === id) return true;
    try {
      window.SpaceContext.selectActive(id);
      Utils.toast(`Espaço ativo: ${spaceName(id)} (origem da assinatura).`);
      return true;
    } catch (error) { Utils.toast(error.message || "Não foi possível trocar de espaço.", true); return false; }
  }
  function act(kind, id) {
    const item = rowById(id);
    if (!item) return Utils.toast("Esta assinatura não está mais na lista. Toque em Atualizar.", true);
    if (kind === "remind") {
      if (window.CRMClienteUI?.renewalWhatsApp) return window.CRMClienteUI.renewalWhatsApp(item);
      return Utils.toast("Lembrete por WhatsApp indisponível nesta versão.", true);
    }
    if (!adoptOrigin(item, { required: kind === "renew" })) return;
    // The checkout keeps a draft per space. Retire the previous space's draft now (no-op when the
    // space did not change), exactly as the app does on a space switch, so the renewal opened next
    // in Vender is not discarded as part of the old draft.
    window.Checkout?.retireSpaceDraft?.();
    if (kind === "renew") return window.Checkout?.prepareRenewal?.(item.id);
    if (kind === "profile") return window.CRMClienteUI?.open?.(item.clientId);
  }
  function openCenter() {
    const rows = selectedRows();
    if (!rows.length) return Utils.toast("Selecione ao menos uma assinatura.", true);
    if (!bulkAllowed()) return Utils.toast("Escolha um espaço para lembrar em lote.", true);
    const spaceId = window.SpaceContext?.scopesCustomers?.() ? currentView() : (origin(rows[0]) ?? null);
    if (rows.some((item) => (origin(item) ?? null) !== spaceId))
      return Utils.toast("A seleção tem assinaturas de outro espaço. Atualize e selecione novamente.", true);
    let renewal;
    try { renewal = window.RenewalMessages.buildContext(rows, { spaceId, spaceName: spaces().find((space) => space.id === spaceId)?.name || "" }); }
    catch (error) { return Utils.toast(error.message, true); }
    // Lembrete de renovação: no Fiado balance; each client's message lists only the selected plans.
    window.MobileMessages.openCenter({ type: "renewal", clientIds: Object.keys(renewal.items), renewal, returnRoute: "renovacoes" });
  }
  function bind() {
    const page = $("[data-renewals-page]");
    if (!page) return;
    if (!subscriptions()?.view?.loadBoardRows) {
      $("[data-renewals-list]", page).innerHTML = `<div class="renewals-empty">${icon("circle-alert")}<p>Renovações indisponíveis nesta versão.</p></div>`;
      return;
    }
    let searchTimer = null;
    $("[data-renewals-search]", page).addEventListener("input", (event) => {
      clearTimeout(searchTimer);
      searchTimer = setTimeout(() => { state.query = event.target.value.trim(); state.limit = PAGE; draw(); }, 120);
    });
    page.addEventListener("click", (event) => {
      const action = event.target.closest?.("[data-renewals-renew],[data-renewals-remind],[data-renewals-profile]");
      if (action) {
        event.preventDefault();
        const kind = action.dataset.renewalsRenew ? "renew" : action.dataset.renewalsRemind ? "remind" : "profile";
        return act(kind, action.dataset.renewalsRenew || action.dataset.renewalsRemind || action.dataset.renewalsProfile);
      }
      const target = event.target.closest?.("[data-renewals-filter],[data-renewals-more],[data-renewals-quick],[data-renewals-clear],[data-renewals-center],[data-renewals-refresh],[data-go-route]");
      if (!target) return;
      if (target.dataset.renewalsFilter) { state.filter = target.dataset.renewalsFilter; state.limit = PAGE; draw(); $(`[data-renewals-filter="${state.filter}"]`)?.focus({ preventScroll: true }); }
      else if (target.matches("[data-renewals-more]")) { state.limit += PAGE; draw(); }
      else if (target.dataset.renewalsQuick) {
        const group = quickGroups(currentBoard())[target.dataset.renewalsQuick] || [];
        const skipped = group.filter((item) => state.reminded?.has(item.id)).length;
        group.filter((item) => !state.reminded?.has(item.id)).forEach((item) => state.selected.add(item.id));
        if (skipped) Utils.toast(`${skipped} já ${skipped === 1 ? "foi lembrada" : "foram lembradas"} hoje e ${skipped === 1 ? "ficou" : "ficaram"} de fora. Marque individualmente para repetir.`);
        draw();
      } else if (target.matches("[data-renewals-clear]")) { state.selected.clear(); draw(); }
      else if (target.matches("[data-renewals-center]")) openCenter();
      else if (target.matches("[data-renewals-refresh]")) { if (!state.loading) load({ force: true }); }
      else if (target.dataset.goRoute) window.Router?.ir?.(target.dataset.goRoute);
    });
    page.addEventListener("change", (event) => {
      const select = event.target.closest?.("[data-renewals-space-select]");
      if (select) {
        const value = select.value, before = currentView();
        state.selected.clear(); state.limit = PAGE; state.filter = null;
        if (value === ALL) { view = { business: businessId(), value: ALL }; return load(); }
        try {
          view = { business: businessId(), value };
          if (window.SpaceContext.activeId() === value) return load();
          window.SpaceContext.selectActive(value); // the space-change listener reloads this screen
        } catch (error) {
          view = { business: businessId(), value: before };
          select.value = before;
          Utils.toast(error.message || "Não foi possível trocar de espaço.", true);
        }
        return;
      }
      const box = event.target.closest?.("[data-renewals-select]");
      if (!box) return;
      box.checked ? state.selected.add(box.dataset.renewalsSelect) : state.selected.delete(box.dataset.renewalsSelect);
      drawBulk();
      window.lucide?.createIcons?.();
    });
    load();
  }
  // The app remounts only some routes on space changes; this screen follows them itself.
  for (const name of ["veconi-space-context-changed", "veconi-spaces-ready", "veconi-space-context-local-ready", "business-context-changed"])
    addEventListener(name, () => {
      const page = document.querySelector("[data-renewals-page]");
      if (!page?.isConnected || page.dataset.loadedView === viewKey()) return;
      if (view.value !== ALL) view = { business: businessId(), value: null };
      const bar = $("[data-renewals-space]", page);
      if (bar) bar.innerHTML = spaceBar();
      state.selected.clear();
      load();
    });
  addEventListener("message-history-updated", () => { if (document.querySelector("[data-renewals-page]")?.isConnected && state.loaded) draw(); });
  return { render, bind, FILTERS, _state: () => state, _view: () => currentView() };
})();
