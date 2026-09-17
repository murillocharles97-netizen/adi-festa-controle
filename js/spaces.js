(function () {
  "use strict";

  const ALL_SPACES = "all_spaces";
  const RESERVED_SPACE_IDS = new Set(["all", ALL_SPACES]);
  const SPACE_SCHEMA_VERSION = 1;
  const ACCESS_MODES = new Set(["all_spaces", "selected_spaces", "single_space"]);
  const OPERATIONAL_TYPES = new Set(["unit", "operation", "personal", "other"]);
  const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
  const state = {
    spaces: [],
    businessId: "",
    uid: "",
    homeId: ALL_SPACES,
    salesId: "",
    adapter: null,
    loaded: false,
    migrationReport: null,
  };

  const esc = (value) =>
    String(value ?? "").replace(/[&<>'"]/g, (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char],
    );
  const clone = (value) => typeof structuredClone === "function"
    ? structuredClone(value)
    : JSON.parse(JSON.stringify(value));
  const uniqueIds = (values = []) =>
    [...new Set((Array.isArray(values) ? values : []).map(String).map((value) => value.trim()).filter((value) => value && !RESERVED_SPACE_IDS.has(value)))];
  const currentContext = () => {
    const session = window.FirebaseSession || {}, context = window.BusinessContext?.get?.() || {};
    return {
      businessId: String(context.businessId || session.businessId || window.DB?.getBusinessId?.() || "").trim(),
      uid: String(session.user?.uid || session.profile?.uid || context.userProfile?.uid || "").trim(),
      businessName: String(context.business?.name || session.business?.name || window.DB?.carregar?.().config?.nome || "Meu negócio").trim(),
    };
  };
  const canManage = () => MANAGER_ROLES.has(String(
    window.BusinessContext?.get?.().role || window.FirebaseSession?.profile?.role || "viewer",
  ));
  const defaultCapabilities = (legacyType, raw = {}) => {
    const business = legacyType === "business",
      source = raw.capabilities && typeof raw.capabilities === "object" ? raw.capabilities : {};
    return {
      finance: source.finance !== undefined ? source.finance === true : true,
      sales: source.sales !== undefined ? source.sales === true : business,
      products: source.products !== undefined ? source.products === true : business,
      inventory: source.inventory !== undefined ? source.inventory === true : business,
      goals: source.goals !== undefined ? source.goals === true : business,
    };
  };
  const legacyFinancialType = (raw = {}) => {
    const value = String(raw.legacyFinancialType || raw.financialType || raw.type || "other");
    if (["business", "personal", "other"].includes(value)) return value;
    if (["unit", "operation"].includes(value)) return "business";
    return "other";
  };
  const operationalType = (raw = {}) => {
    const explicit = String(raw.operationalType || raw.spaceType || "");
    if (OPERATIONAL_TYPES.has(explicit)) return explicit;
    const legacy = legacyFinancialType(raw);
    return legacy === "business" ? "unit" : legacy === "personal" ? "personal" : "other";
  };
  function normalizeSpace(raw = {}, context = currentContext()) {
    const legacyType = legacyFinancialType(raw),
      businessId = String(raw.businessId || raw.linkedBusinessId || "").trim() || null,
      status = raw.status === "archived" || raw.active === false ? "archived" : "active";
    return {
      ...raw,
      id: String(raw.id || "").trim(),
      businessId,
      name: String(raw.name || "Espaço sem nome").trim().slice(0, 80),
      type: operationalType(raw),
      operationalType: operationalType(raw),
      legacyFinancialType: legacyType,
      status,
      active: status === "active",
      capabilities: defaultCapabilities(legacyType, raw),
      isDefault: raw.isDefault === true || (legacyType === "business" && String(raw.id || "") === `business_${businessId || context.businessId}`),
      globalSpaceSchemaVersion: Math.max(SPACE_SCHEMA_VERSION, Number(raw.globalSpaceSchemaVersion || 0)),
    };
  }
  function globalFields(raw = {}, context = currentContext()) {
    const normalized = normalizeSpace(raw, context);
    return {
      businessId: normalized.businessId,
      operationalType: normalized.operationalType,
      status: normalized.status,
      capabilities: normalized.capabilities,
      isDefault: normalized.isDefault,
      globalSpaceSchemaVersion: SPACE_SCHEMA_VERSION,
    };
  }
  function normalizeProductAccess(raw = {}, fallback = {}) {
    const source = raw.availability && typeof raw.availability === "object" ? raw.availability : raw,
      fallbackSource = fallback.availability && typeof fallback.availability === "object" ? fallback.availability : fallback,
      requestedMode = String(source.spaceAccessMode || source.accessMode || fallbackSource.spaceAccessMode || fallbackSource.accessMode || "all_spaces"),
      spaceAccessMode = ACCESS_MODES.has(requestedMode) ? requestedMode : "all_spaces",
      requestedAllowed = uniqueIds(source.allowedSpaceIds || source.spaceIds || fallbackSource.allowedSpaceIds || fallbackSource.spaceIds),
      requestedDefault = String(source.defaultSpaceId || fallbackSource.defaultSpaceId || requestedAllowed[0] || "").trim(),
      allowedSpaceIds = spaceAccessMode === "all_spaces"
        ? []
        : spaceAccessMode === "single_space"
          ? uniqueIds([requestedDefault || requestedAllowed[0]])
          : requestedAllowed,
      defaultSpaceId = spaceAccessMode === "all_spaces"
        ? null
        : spaceAccessMode === "single_space"
          ? allowedSpaceIds[0] || null
          : allowedSpaceIds.includes(requestedDefault) ? requestedDefault : allowedSpaceIds[0] || null;
    return { spaceAccessMode, allowedSpaceIds, defaultSpaceId, spaceScopeVersion: 1 };
  }
  function productAllowsSpace(product = {}, spaceId = "") {
    const targetId = String(spaceId || "").trim();
    if (!targetId || RESERVED_SPACE_IDS.has(targetId)) return false;
    const access = normalizeProductAccess(product);
    if (access.spaceAccessMode === "all_spaces") return true;
    return access.allowedSpaceIds.includes(targetId);
  }
  function resolveSaleSpaceId(sale = {}, knownIds = null) {
    const direct = String(sale.spaceId || "").trim(), legacy = String(sale.financialSpaceId || "").trim(), candidate = direct || legacy;
    if (!candidate || RESERVED_SPACE_IDS.has(candidate)) return "";
    if (knownIds && !knownIds.has(candidate)) return "";
    return candidate;
  }
  const invalidSaleStatuses = new Set(["cancelado", "cancelada", "cancelled", "canceled", "desfeito", "desfeita", "venda_desfeita", "estornado", "estornada", "refunded"]);
  const isValidSale = (sale = {}) => {
    const status = String(sale.status || sale.saleStatus || sale.tipo || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
    return sale.ativo !== false && sale.active !== false && !sale.deletedAt && !invalidSaleStatuses.has(status);
  };
  const saleBelongsTo = (sale, selectionId, knownIds = null) =>
    selectionId === ALL_SPACES || resolveSaleSpaceId(sale, knownIds) === String(selectionId || "");
  const recordBelongsTo = (record, selectionId) =>
    selectionId === ALL_SPACES || resolveSaleSpaceId(record) === String(selectionId || "");
  const typeLabel = (type) => ({ unit: "Unidade / filial", operation: "Espaço / operação", personal: "Pessoal", other: "Outro" })[type] || "Outro";
  const spaceIcon = (space = {}) => ({
    unit: "store",
    operation: "briefcase-business",
    personal: "home",
    other: "wallet-cards",
  })[space.type] || String(space.icon || "map-pin");

  const contextKey = (kind) => `veconi:space-context:v1:${state.uid || "anonymous"}:${state.businessId || "unknown"}:${kind}`;
  const spacesKey = () => `veconi:spaces:v1:${state.uid || "anonymous"}:${state.businessId || "unknown"}`;
  const read = (key, fallback = "") => {
    try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
  };
  const write = (key, value) => {
    try { localStorage.setItem(key, value); } catch {}
  };
  function scopedSpaces(spaces = state.spaces) {
    return spaces.filter((space) => {
      if (!space.id || RESERVED_SPACE_IDS.has(space.id) || space.status !== "active") return false;
      if (space.businessId === state.businessId) return true;
      return !space.businessId && Boolean(state.uid) && space.ownerUid === state.uid;
    });
  }
  const homeSpaces = () => scopedSpaces().sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name, "pt-BR"));
  const salesSpaces = () => scopedSpaces().filter((space) => space.businessId === state.businessId && space.capabilities.sales === true).sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name, "pt-BR"));
  function reconcileSelections() {
    const homeIds = new Set(homeSpaces().map((space) => space.id)), sales = salesSpaces(), salesIds = new Set(sales.map((space) => space.id)),
      rememberedHome = state.homeId || read(contextKey("home"), ALL_SPACES),
      rememberedSales = state.salesId || read(contextKey("sales"), "");
    state.homeId = rememberedHome === ALL_SPACES || homeIds.has(rememberedHome) ? rememberedHome : ALL_SPACES;
    state.salesId = salesIds.has(rememberedSales) ? rememberedSales : sales.find((space) => space.isDefault)?.id || sales[0]?.id || "";
    write(contextKey("home"), state.homeId);
    if (state.salesId) write(contextKey("sales"), state.salesId);
  }
  function ensureContext() {
    const context = currentContext();
    if (context.businessId === state.businessId && context.uid === state.uid) return;
    state.businessId = context.businessId;
    state.uid = context.uid;
    state.spaces = [];
    state.loaded = false;
    state.migrationReport = null;
    try {
      const cached = JSON.parse(read(spacesKey(), "[]"));
      if (Array.isArray(cached)) state.spaces = cached.map((space) => normalizeSpace(space, context));
    } catch {}
    state.homeId = read(contextKey("home"), ALL_SPACES);
    state.salesId = read(contextKey("sales"), "");
    reconcileSelections();
  }
  function setSpaces(rawSpaces = [], options = {}) {
    ensureContext();
    const context = currentContext(), byId = new Map();
    for (const raw of rawSpaces) {
      const space = normalizeSpace(raw, context);
      if (space.id) byId.set(space.id, space);
    }
    state.spaces = [...byId.values()];
    state.loaded = options.loaded !== false;
    state.migrationReport = options.migrationReport || state.migrationReport;
    write(spacesKey(), JSON.stringify(state.spaces));
    reconcileSelections();
    dispatchEvent(new CustomEvent("veconi-spaces-ready", { detail: snapshot() }));
    return list();
  }
  function list() { ensureContext(); return clone(state.spaces); }
  function snapshot() {
    ensureContext();
    return {
      businessId: state.businessId,
      spaces: list(),
      homeId: state.homeId,
      salesId: state.salesId,
      loaded: state.loaded,
      migrationReport: state.migrationReport ? clone(state.migrationReport) : null,
    };
  }
  function selectHome(id) {
    ensureContext();
    const value = String(id || ALL_SPACES), available = new Set(homeSpaces().map((space) => space.id));
    if (value !== ALL_SPACES && !available.has(value)) throw Error("Este espaço não está disponível na Home.");
    state.homeId = value;
    write(contextKey("home"), value);
    dispatchEvent(new CustomEvent("veconi-space-context-changed", { detail: { kind: "home", id: value } }));
    return value;
  }
  function selectSales(id) {
    ensureContext();
    const value = String(id || ""), space = salesSpaces().find((item) => item.id === value);
    if (!space || RESERVED_SPACE_IDS.has(value)) throw Error("Escolha um espaço de venda ativo.");
    state.salesId = value;
    write(contextKey("sales"), value);
    dispatchEvent(new CustomEvent("veconi-space-context-changed", { detail: { kind: "sales", id: value, space: clone(space) } }));
    return clone(space);
  }
  function selectedHome() {
    ensureContext();
    return state.homeId === ALL_SPACES ? null : homeSpaces().find((space) => space.id === state.homeId) || null;
  }
  function selectedSales() {
    ensureContext();
    return salesSpaces().find((space) => space.id === state.salesId) || null;
  }
  function requireSalesSpace(requestedId = "") {
    ensureContext();
    const value = String(requestedId || state.salesId || "").trim();
    if (!value || RESERVED_SPACE_IDS.has(value)) throw Error("Selecione o espaço desta venda.");
    const space = salesSpaces().find((item) => item.id === value);
    if (!space) throw Error("Este espaço não está ativo para vendas.");
    return space.id;
  }
  function setAdapter(adapter) {
    state.adapter = adapter;
    return adapter;
  }
  function selectionLabel(kind = "home") {
    if (kind === "home" && state.homeId === ALL_SPACES) return "Todos os espaços";
    return (kind === "sales" ? selectedSales() : selectedHome())?.name || "Espaço";
  }
  function renderBar(kind = "home") {
    ensureContext();
    const isHome = kind === "home", spaces = isHome ? homeSpaces() : salesSpaces(), selected = isHome ? state.homeId : state.salesId,
      showManagement = canManage(), label = isHome ? "Espaço" : "Espaço atual";
    if (isHome) {
      const current = selectedHome(), icon = current ? spaceIcon(current) : "layers-3";
      return `<section class="space-context-bar is-home" data-space-context="home"><button class="space-selector-trigger" type="button" data-space-picker="home" aria-haspopup="dialog" aria-label="Escolher espaço. Selecionado: ${esc(selectionLabel("home"))}"><span class="space-selector-icon"><i data-lucide="${icon}"></i></span><span class="space-selector-copy"><small>${label}</small><strong>${esc(selectionLabel("home"))}</strong></span><i class="space-selector-chevron" data-lucide="chevron-down"></i></button><button class="space-filter-trigger" type="button" data-space-picker="home" aria-haspopup="dialog" aria-label="Filtrar a Home por espaço"><i data-lucide="sliders-horizontal"></i><span>Filtros</span></button></section>`;
    }
    if (!isHome && spaces.length === 1)
      return `<section class="space-context-bar is-single" data-space-context="sales"><span><i data-lucide="map-pin"></i>${label}</span><strong>${esc(spaces[0].name)}</strong>${showManagement ? '<button type="button" data-space-manage aria-label="Gerenciar espaços"><i data-lucide="settings-2"></i></button>' : ""}</section>`;
    return `<section class="space-context-bar" data-space-context="${kind}"><label><span><i data-lucide="map-pin"></i>${label}</span><select data-space-select="${kind}" ${!spaces.length ? "disabled" : ""}>${spaces.map((space) => `<option value="${esc(space.id)}" ${selected === space.id ? "selected" : ""}>${esc(space.name)}</option>`).join("")}</select></label>${showManagement ? '<button type="button" data-space-manage aria-label="Gerenciar espaços"><i data-lucide="settings-2"></i><span>Gerenciar</span></button>' : ""}</section>`;
  }

  function openPicker(kind = "home") {
    ensureContext();
    if (kind !== "home") return;
    const root = document.querySelector("#modal"), spaces = homeSpaces(), selected = state.homeId,
      row = (id, name, description, icon) => {
        const active = selected === id;
        return `<button class="space-picker-option ${active ? "is-selected" : ""}" type="button" data-space-choice="${esc(id)}" role="radio" aria-checked="${active}"><span class="space-picker-option-icon"><i data-lucide="${icon}"></i></span><span><b>${esc(name)}</b><small>${esc(description)}</small></span><i class="space-picker-check" data-lucide="${active ? "check" : "circle"}"></i></button>`;
      };
    root.innerHTML = `<div class="modal-bg space-picker-backdrop"><section class="modal-box space-picker-modal" role="dialog" aria-modal="true" aria-labelledby="space-picker-title"><header class="modal-head"><div><h3 id="space-picker-title">Escolher espaço</h3><p>Veja os dados de uma operação específica ou de todas juntas.</p></div><button class="icon-btn" type="button" data-space-picker-close aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="modal-body space-picker-list" role="radiogroup" aria-label="Espaços disponíveis">${row(ALL_SPACES, "Todos os espaços", "Visão consolidada", "layers-3")}${spaces.map((space) => row(space.id, space.name, typeLabel(space.type), spaceIcon(space))).join("")}</div>${canManage() ? '<footer class="modal-foot"><button class="btn btn-light space-picker-manage" type="button" data-space-picker-manage><i data-lucide="building-2"></i> Gerenciar espaços</button></footer>' : ""}</section></div>`;
    const close = () => { root.innerHTML = ""; };
    root.querySelectorAll("[data-space-picker-close]").forEach((button) => button.onclick = close);
    root.querySelector(".space-picker-backdrop").onclick = (event) => { if (event.target === event.currentTarget) close(); };
    root.querySelectorAll("[data-space-choice]").forEach((button) => button.onclick = () => {
      try {
        selectHome(button.dataset.spaceChoice);
        close();
        window.AppPageRuntime?.mount?.(window.Router?.atual?.() || "inicio");
      } catch (error) {
        window.Utils?.toast?.(error.message, true);
      }
    });
    root.querySelector("[data-space-picker-manage]")?.addEventListener("click", openManager);
    window.lucide?.createIcons();
    queueMicrotask(() => root.querySelector('.space-picker-option[aria-checked="true"]')?.focus());
  }
  function contextualData(db, kind = "home") {
    ensureContext();
    const selectionId = kind === "sales" ? state.salesId : state.homeId,
      knownIds = new Set(state.spaces.map((space) => space.id)),
      allSales = Array.isArray(db?.vendas) ? db.vendas : [],
      sales = allSales.filter((sale) => saleBelongsTo(sale, selectionId, knownIds)),
      products = (Array.isArray(db?.produtos) ? db.produtos : []).filter((product) => selectionId === ALL_SPACES || productAllowsSpace(product, selectionId)),
      clientIds = new Set(sales.map((sale) => sale.clienteId || sale.clientId).filter(Boolean)),
      clients = (Array.isArray(db?.clientes) ? db.clientes : []).filter((client) => selectionId === ALL_SPACES || clientIds.has(client.id)),
      payments = (Array.isArray(db?.pagamentos) ? db.pagamentos : []).filter((payment) => recordBelongsTo(payment, selectionId)),
      catalogOrders = (Array.isArray(db?.catalogOrders) ? db.catalogOrders : []).filter((order) => recordBelongsTo(order, selectionId)),
      customerSubscriptions = (Array.isArray(db?.customerSubscriptions) ? db.customerSubscriptions : []).filter((subscription) => recordBelongsTo(subscription, selectionId)),
      unassignedLegacySales = allSales.filter((sale) => isValidSale(sale) && !resolveSaleSpaceId(sale, knownIds)).length;
    return { ...db, vendas: sales, produtos: products, clientes: clients, pagamentos: payments, catalogOrders, customerSubscriptions, spaceSelectionId: selectionId, unassignedLegacySales };
  }
  function goalFor(config = {}, selectionId = state.homeId) {
    const dashboard = config.dashboard || config || {};
    if (selectionId === ALL_SPACES) return Number(dashboard.dailySalesGoal ?? config.dailySalesGoal ?? 0);
    return Number(dashboard.dailySalesGoalsBySpaceId?.[selectionId] || 0);
  }
  function saveGoal(value, selectionId = state.homeId) {
    if (!canManage()) throw Error("Seu perfil não pode alterar metas.");
    const goal = Math.max(0, Number(value) || 0), id = String(selectionId || ALL_SPACES);
    window.DB.alterar((db) => {
      const dashboard = { ...(db.config.dashboard || {}) };
      if (id === ALL_SPACES) dashboard.dailySalesGoal = goal;
      else dashboard.dailySalesGoalsBySpaceId = { ...(dashboard.dailySalesGoalsBySpaceId || {}), [id]: goal };
      dashboard.goalAggregationMode = "independent_general_goal";
      dashboard.updatedAt = new Date().toISOString();
      dashboard.updatedBy = window.FirebaseSession?.user?.uid || "local";
      db.config.dashboard = dashboard;
    });
    return goal;
  }
  function openGoalEditor() {
    ensureContext();
    if (!canManage()) {
      window.Utils?.toast?.("Seu perfil não pode alterar metas.", true);
      return;
    }
    const root = document.querySelector("#modal"), id = state.homeId, space = selectedHome(), current = goalFor(window.DB.carregar().config, id), title = id === ALL_SPACES ? "Meta geral diária" : `Meta diária · ${space?.name || "Espaço"}`;
    root.innerHTML = `<div class="modal-bg"><section class="modal-box home-goal-modal"><header class="modal-head"><h3>${esc(title)}</h3><button class="icon-btn" type="button" data-space-close><i data-lucide="x"></i></button></header><form data-space-goal-form><div class="modal-body"><p>${id === ALL_SPACES ? "A meta geral é configurada de forma independente; ela não soma automaticamente as metas dos espaços." : "Esta meta vale somente para o espaço selecionado."}</p><div class="field"><label>Meta diária</label><input name="goal" type="number" inputmode="decimal" min="0" step="0.01" value="${current || ""}" placeholder="Ex.: 300,00" autofocus></div><small>Use zero para remover a meta.</small></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-space-close>Cancelar</button><button class="btn btn-primary">Salvar meta</button></footer></form></section></div>`;
    root.querySelectorAll("[data-space-close]").forEach((button) => button.onclick = () => { root.innerHTML = ""; });
    root.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const goal = saveGoal(new FormData(event.currentTarget).get("goal"), id);
      root.innerHTML = "";
      window.AppPageRuntime?.mount?.("inicio");
      window.Utils?.toast?.(goal ? "Meta diária salva" : "Meta diária removida");
    };
    window.lucide?.createIcons();
  }
  const capabilitySummary = (space) => [
    space.capabilities.finance && "Financeiro",
    space.capabilities.sales && "Vendas",
    space.capabilities.products && "Produtos",
    space.capabilities.goals && "Metas",
  ].filter(Boolean).join(" · ") || "Sem áreas ativas";
  function managerList() {
    const spaces = homeSpaces();
    return `<div class="space-manager-list">${spaces.map((space) => `<article><span class="space-manager-icon"><i data-lucide="${space.type === "unit" ? "store" : space.type === "operation" ? "briefcase-business" : space.type === "personal" ? "home" : "wallet-cards"}"></i></span><div><b>${esc(space.name)}</b><small>${esc(typeLabel(space.type))} · ${esc(capabilitySummary(space))}</small>${!space.businessId ? "<em>Espaço financeiro legado · associe ao ativar uma área operacional</em>" : ""}</div><button type="button" data-space-edit="${esc(space.id)}"><i data-lucide="pencil"></i> Editar</button></article>`).join("")}</div>`;
  }
  function openManager() {
    ensureContext();
    if (!canManage()) {
      window.Utils?.toast?.("Seu perfil não pode gerenciar espaços.", true);
      return;
    }
    const root = document.querySelector("#modal");
    root.innerHTML = `<div class="modal-bg"><section class="modal-box space-manager-modal"><header class="modal-head"><div><small>Estrutura da empresa</small><h3>Espaços VECONI</h3></div><button class="icon-btn" type="button" data-space-close><i data-lucide="x"></i></button></header><div class="modal-body"><p class="space-manager-help">Espaços separam unidades e operações dentro da mesma empresa. Outra empresa ou CNPJ independente não deve ser criado aqui.</p>${managerList()}</div><footer class="modal-foot"><button class="btn btn-light" type="button" data-space-close>Fechar</button><button class="btn btn-primary" type="button" data-space-new><i data-lucide="plus"></i> Criar espaço</button></footer></section></div>`;
    root.querySelectorAll("[data-space-close]").forEach((button) => button.onclick = () => { root.innerHTML = ""; });
    root.querySelector("[data-space-new]").onclick = () => openSpaceForm();
    root.querySelectorAll("[data-space-edit]").forEach((button) => button.onclick = () => openSpaceForm(button.dataset.spaceEdit));
    window.lucide?.createIcons();
  }
  function openSpaceForm(id = "") {
    const existing = id ? state.spaces.find((space) => space.id === id) : null, root = document.querySelector("#modal"),
      defaults = existing?.capabilities || (existing?.type === "personal" ? { finance: true } : { finance: true, sales: true, products: true, inventory: true, goals: true });
    root.innerHTML = `<div class="modal-bg"><section class="modal-box space-form-modal"><header class="modal-head"><div><small>Espaço VECONI</small><h3>${existing ? "Editar espaço" : "Criar espaço"}</h3></div><button class="icon-btn" type="button" data-space-close><i data-lucide="x"></i></button></header><form data-space-form><div class="modal-body"><div class="field"><label>Nome *</label><input name="name" maxlength="80" required value="${esc(existing?.name || "")}" placeholder="Ex.: Loja Centro"></div><div class="field"><label>Tipo</label><select name="type"><option value="unit" ${existing?.type === "unit" ? "selected" : ""}>Unidade / filial</option><option value="operation" ${existing?.type === "operation" ? "selected" : ""}>Espaço / operação</option><option value="personal" ${existing?.type === "personal" ? "selected" : ""}>Pessoal</option><option value="other" ${existing?.type === "other" ? "selected" : ""}>Outro</option></select><small data-space-type-help>Outra loja ou ponto do mesmo negócio.</small></div><fieldset class="space-capabilities"><legend>Como este espaço será usado?</legend><label><input type="checkbox" name="finance" ${defaults.finance ? "checked" : ""}><span><i data-lucide="wallet-cards"></i><b>Financeiro</b><small>Entradas, despesas e contas.</small></span></label><label><input type="checkbox" name="sales" ${defaults.sales ? "checked" : ""}><span><i data-lucide="shopping-bag"></i><b>Vendas</b><small>Disponível na tela Vender.</small></span></label><label><input type="checkbox" name="products" ${defaults.products ? "checked" : ""}><span><i data-lucide="package"></i><b>Produtos / estoque</b><small>Catálogo operacional; estoque ainda é geral.</small></span></label><label><input type="checkbox" name="goals" ${defaults.goals ? "checked" : ""}><span><i data-lucide="target"></i><b>Metas</b><small>Acompanhamento próprio na Home.</small></span></label></fieldset></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-space-back>Voltar</button><button class="btn btn-primary" data-space-save>${existing ? "Salvar alterações" : "Criar espaço"}</button></footer></form></section></div>`;
    const form = root.querySelector("form"), type = form.elements.type, help = root.querySelector("[data-space-type-help]");
    const syncTypeHelp = () => { help.textContent = type.value === "unit" ? "Outra loja ou ponto do mesmo negócio." : type.value === "operation" ? "Separe uma atividade ou operação do seu negócio." : type.value === "personal" ? "Organize um contexto pessoal sem misturá-lo à empresa." : "Use para um contexto que não se encaixa nas opções anteriores."; };
    root.querySelector("[data-space-close]").onclick = () => { root.innerHTML = ""; };
    root.querySelector("[data-space-back]").onclick = openManager;
    type.onchange = () => {
      syncTypeHelp();
      if (!existing) {
        const operational = ["unit", "operation"].includes(type.value);
        for (const name of ["sales", "products", "goals"]) form.elements[name].checked = operational;
        form.elements.finance.checked = true;
      }
    };
    form.onsubmit = async (event) => {
      event.preventDefault();
      const values = new FormData(form), button = root.querySelector("[data-space-save]"), capabilities = {
        finance: values.has("finance"), sales: values.has("sales"), products: values.has("products"), inventory: values.has("products"), goals: values.has("goals"),
      };
      if (!state.adapter) return window.Utils?.toast?.("O serviço de espaços ainda está carregando.", true);
      button.disabled = true;
      button.textContent = "Salvando…";
      try {
        if (existing) await state.adapter.update(existing.id, { name: values.get("name"), operationalType: values.get("type"), capabilities });
        else await state.adapter.create({ name: values.get("name"), operationalType: values.get("type"), capabilities });
        openManager();
        window.Utils?.toast?.(existing ? "Espaço atualizado" : "Espaço criado");
      } catch (error) {
        button.disabled = false;
        button.textContent = existing ? "Salvar alterações" : "Criar espaço";
        window.Utils?.toast?.(error.message || "Não foi possível salvar o espaço.", true);
      }
    };
    syncTypeHelp();
    window.lucide?.createIcons();
  }
  function availabilityFields(product = {}) {
    const spaces = salesSpaces(), access = normalizeProductAccess(product), selected = new Set(access.allowedSpaceIds), single = access.defaultSpaceId || spaces[0]?.id || "";
    return `<fieldset class="product-space-availability" data-product-space-fields><legend>Disponível onde?</legend><label><input type="radio" name="spaceAccessMode" value="all_spaces" ${access.spaceAccessMode === "all_spaces" ? "checked" : ""}><span><b>Todos os espaços de venda</b><small>Também aparecerá nos espaços de venda criados no futuro.</small></span></label><label><input type="radio" name="spaceAccessMode" value="selected_spaces" ${access.spaceAccessMode === "selected_spaces" ? "checked" : ""}><span><b>Alguns espaços</b><small>Escolha exatamente onde este item aparece.</small></span></label><label><input type="radio" name="spaceAccessMode" value="single_space" ${access.spaceAccessMode === "single_space" ? "checked" : ""}><span><b>Somente um espaço</b><small>O produto continua único e mantém o mesmo ID.</small></span></label><div class="product-space-checks" data-product-space-checks>${spaces.map((space) => `<label><input type="checkbox" name="allowedSpaceIds" value="${esc(space.id)}" ${selected.has(space.id) ? "checked" : ""}><span>${esc(space.name)}</span></label>`).join("") || "<small>Nenhum espaço de venda disponível.</small>"}</div><label class="product-space-single" data-product-space-single><span>Espaço</span><select name="defaultSpaceId">${spaces.map((space) => `<option value="${esc(space.id)}" ${single === space.id ? "selected" : ""}>${esc(space.name)}</option>`).join("")}</select></label></fieldset>`;
  }
  function bindProductAvailability(root = document) {
    root.querySelectorAll("[data-product-space-fields]").forEach((fieldset) => {
      if (fieldset.dataset.bound) return;
      fieldset.dataset.bound = "true";
      const sync = () => {
        const mode = fieldset.querySelector('input[name="spaceAccessMode"]:checked')?.value || "all_spaces",
          checks = fieldset.querySelector("[data-product-space-checks]"), single = fieldset.querySelector("[data-product-space-single]");
        checks.hidden = mode !== "selected_spaces";
        single.hidden = mode !== "single_space";
        checks.querySelectorAll("input").forEach((input) => input.disabled = mode !== "selected_spaces");
        single.querySelectorAll("select").forEach((input) => input.disabled = mode !== "single_space");
      };
      fieldset.querySelectorAll('input[name="spaceAccessMode"]').forEach((input) => input.onchange = sync);
      sync();
    });
  }
  function productAccessFromForm(formData, fallback = {}) {
    const mode = formData.get("spaceAccessMode") || fallback.spaceAccessMode,
      allowedSpaceIds = formData.getAll("allowedSpaceIds");
    return normalizeProductAccess({
      spaceAccessMode: mode,
      allowedSpaceIds,
      defaultSpaceId: mode === "selected_spaces"
        ? allowedSpaceIds[0] || fallback.defaultSpaceId
        : formData.get("defaultSpaceId") || fallback.defaultSpaceId,
    }, fallback);
  }
  function bind(root = document) {
    root.querySelectorAll("[data-space-picker]").forEach((button) => {
      if (button.dataset.bound) return;
      button.dataset.bound = "true";
      button.onclick = () => openPicker(button.dataset.spacePicker);
    });
    root.querySelectorAll("[data-space-select]").forEach((select) => {
      if (select.dataset.bound) return;
      select.dataset.bound = "true";
      select.onchange = () => {
        const kind = select.dataset.spaceSelect;
        try {
          if (kind === "sales") {
            if (window.Checkout?.cartCount?.() && !confirm("Você possui itens no carrinho deste espaço. Pressione Cancelar para continuar aqui ou OK para limpar o carrinho e trocar.")) {
              select.value = state.salesId;
              return;
            }
            selectSales(select.value);
            window.Checkout?.resetSession?.();
          } else selectHome(select.value);
          window.AppPageRuntime?.mount?.(window.Router?.atual?.() || (kind === "sales" ? "vender" : "inicio"));
        } catch (error) {
          window.Utils?.toast?.(error.message, true);
        }
      };
    });
    root.querySelectorAll("[data-space-manage]").forEach((button) => {
      if (button.dataset.bound) return;
      button.dataset.bound = "true";
      button.onclick = openManager;
    });
    root.querySelectorAll("[data-home-goal]").forEach((button) => {
      if (!canManage()) {
        button.disabled = true;
        button.setAttribute("aria-disabled", "true");
        button.title = "Seu perfil não pode alterar metas.";
        return;
      }
      button.onclick = openGoalEditor;
    });
    bindProductAvailability(root);
  }

  const SpaceEngine = Object.freeze({
    ALL_SPACES,
    SPACE_SCHEMA_VERSION,
    isReservedSpaceId: (value) => RESERVED_SPACE_IDS.has(String(value || "").trim()),
    normalizeSpace,
    globalFields,
    normalizeProductAccess,
    productAllowsSpace,
    resolveSaleSpaceId,
    isValidSale,
    saleBelongsTo,
    typeLabel,
  });
  const SpaceContext = {
    ALL_SPACES,
    list,
    snapshot,
    setSpaces,
    setAdapter,
    homeSpaces,
    salesSpaces,
    selectedHome,
    selectedSales,
    homeId: () => (ensureContext(), state.homeId),
    salesId: () => (ensureContext(), state.salesId),
    selectHome,
    selectSales,
    requireSalesSpace,
    selectionLabel,
    renderBar,
    contextualData,
    goalFor,
    saveGoal,
    openGoalEditor,
    openPicker,
    openManager,
    availabilityFields,
    bindProductAvailability,
    productAccessFromForm,
    productAllowsSpace,
    resolveSaleSpaceId,
    isValidSale,
    canManage,
    bind,
  };
  window.SpaceEngine = SpaceEngine;
  window.SpaceContext = SpaceContext;
  addEventListener("business-context-changed", () => {
    ensureContext();
    dispatchEvent(new CustomEvent("veconi-space-context-local-ready", { detail: snapshot() }));
  });
  addEventListener("firebase-session-cleared", () => {
    Object.assign(state, { spaces: [], businessId: "", uid: "", homeId: ALL_SPACES, salesId: "", loaded: false, migrationReport: null });
  });
})();
