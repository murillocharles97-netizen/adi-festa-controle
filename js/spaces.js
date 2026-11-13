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
    activeId: "",
    generation: 0,
    sessionReady: false,
    viewEpoch: 0,
    viewIdentity: "",
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
      generation: context.business?.workspaceGeneration ?? window.DB?.getWorkspaceGeneration?.() ?? 0,
      ready: !context.loading && !context.error && context.member?.status !== "inactive" &&
        (!context.member?.status || context.member.status === "active") && context.userProfile?.active !== false && context.business?.active !== false &&
        (!context.userProfile?.uid || !session.user?.uid || context.userProfile.uid === session.user.uid) &&
        (!context.userProfile?.businessId || !context.businessId || context.userProfile.businessId === context.businessId),
      businessName: String(context.business?.name || session.business?.name || window.DB?.carregar?.().config?.nome || "Meu negócio").trim(),
    };
  };
  const canManage = () => window.TeamAccess?.has?.("spaces.manage") ?? MANAGER_ROLES.has(String(
    window.BusinessContext?.get?.().role || window.FirebaseSession?.profile?.role || "viewer",
  ));
  const unrestrictedSpaces = () => {
    const context = window.BusinessContext?.get?.();
    return !context || !("spaceAccess" in context) || context.spaceAccess === "all";
  };
  const allowedSpaceIds = () => new Set(window.BusinessContext?.get?.().allowedSpaceIds || []);
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
    if (!state.sessionReady || !state.uid || !state.businessId) return [];
    return spaces.filter((space) => {
      if (!space.id || RESERVED_SPACE_IDS.has(space.id) || space.status !== "active") return false;
      if (space.businessId === state.businessId && (!space.linkedBusinessId || space.linkedBusinessId === state.businessId)) {
        if (space.legacyFinancialType !== "business" && space.ownerUid !== state.uid) return false;
        return unrestrictedSpaces() || allowedSpaceIds().has(space.id);
      }
       return unrestrictedSpaces() && !space.businessId && Boolean(state.uid) && space.ownerUid === state.uid && (window.TeamAccess?.has?.("financial.view") ?? true);
    });
  }
  const homeSpaces = () => scopedSpaces().sort((left, right) => Number(right.isDefault) - Number(left.isDefault) || left.name.localeCompare(right.name, "pt-BR"));
  const operationalSpaces = () => homeSpaces().filter(space => space.businessId === state.businessId &&
    (space.capabilities.sales || space.capabilities.products));
  const salesSpaces = () => operationalSpaces().filter(space => space.capabilities.sales);
  // Keep the existing Vender key as the single persisted operational preference.
  function reconcileSelection() {
    const spaces = operationalSpaces();
    return spaces.find(space => space.id === state.activeId) || spaces[0] || null;
  }
  function ensureContext() {
    const context = currentContext();
    const localBusiness = window.DB?.getBusinessId?.();
    state.sessionReady = context.ready && (!localBusiness || localBusiness === context.businessId);
    if (context.businessId === state.businessId && context.uid === state.uid && context.generation === state.generation) return;
    state.businessId = context.businessId;
    state.uid = context.uid;
    state.generation = context.generation;
    state.spaces = [];
    state.loaded = false;
    state.migrationReport = null;
    try {
      const cached = JSON.parse(read(spacesKey(), '[]'));
      if (Array.isArray(cached)) state.spaces = cached.map(space => normalizeSpace(space, context));
    } catch {}
    state.activeId = read(contextKey('sales'), read(contextKey('home'), ''));
  }
  function activeId() { ensureContext(); return reconcileSelection()?.id || ''; }
  function viewScope() {
    const id = activeId(), context = window.BusinessContext?.get?.() || {};
    const identity = JSON.stringify([state.uid, state.businessId, state.generation, id, operationalSpaces().map(space => space.id),
      state.sessionReady, context.role, context.permissionSignature, context.spaceAccess, [...allowedSpaceIds()].sort()]);
    if (state.viewIdentity !== identity) { state.viewIdentity = identity; state.viewEpoch++; }
    return JSON.stringify([state.viewEpoch, identity]);
  }
  function scopesCustomers() {
    ensureContext();
    return Boolean(state.uid && state.businessId && (!activeId() || !unrestrictedSpaces() || operationalSpaces().length > 1));
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
    if (state.loaded && state.sessionReady && activeId()) {
      state.activeId = activeId();
      write(contextKey("sales"), state.activeId);
    }
    dispatchEvent(new CustomEvent("veconi-spaces-ready", { detail: snapshot() }));
    return list();
  }
  function list() { ensureContext(); return clone(state.spaces); }
  function snapshot() {
    ensureContext();
    return {
      businessId: state.businessId,
      spaces: list(),
      homeId: activeId(),
      salesId: selectedSales()?.id || "",
      loaded: state.loaded,
      migrationReport: state.migrationReport ? clone(state.migrationReport) : null,
    };
  }
  function selectActive(id) {
    ensureContext();
    const space = operationalSpaces().find(item => item.id === String(id || ''));
    if (!space) throw Error('Escolha um espaço autorizado para operar.');
    if (space.id === activeId()) return clone(space);
    const checkout = window.Checkout?.state?.();
    if (checkout?.finishing || checkout?.activeOperationId || window.Checkout?.cartCount?.() || window.PriorSales?.active?.() || window.ExchangeCreditCheckout?.hasPending?.())
      throw Error('Conclua ou feche o atendimento no espaço atual antes de trocar. A fila de sincronização foi preservada.');
    state.activeId = space.id;
    write(contextKey('sales'), space.id);
    viewScope();
    dispatchEvent(new CustomEvent('veconi-space-context-changed', { detail: { kind: 'global', id: space.id, space: clone(space) } }));
    return clone(space);
  }
  const selectHome = id => selectActive(id).id;
  function selectSales(id) {
    ensureContext();
    if (!salesSpaces().some(space => space.id === id)) throw Error('Escolha um espaço de venda ativo.');
    return selectActive(id);
  }
  function selectedHome() { ensureContext(); return reconcileSelection(); }
  function selectedSales() {
    const space = selectedHome();
    return space?.capabilities.sales ? space : null;
  }
  function requireSalesSpace(requestedId = "") {
    ensureContext();
    const value = String(requestedId || selectedSales()?.id || "").trim();
    if (!value || RESERVED_SPACE_IDS.has(value)) throw Error("Selecione o espaço desta venda.");
    const space = salesSpaces().find((item) => item.id === value);
    if (!space) throw Error("Este espaço não está ativo para vendas.");
    return space.id;
  }
  function setAdapter(adapter) {
    state.adapter = adapter;
    return adapter;
  }
  function stockMovementSpaces(product) {
    ensureContext();
    const businessId = currentContext().businessId;
    if (!businessId || !product || product.businessId && product.businessId !== businessId)
      throw Error('Não foi possível confirmar a empresa do estoque.');
    const source = product.availability || product;
    const scoped = ACCESS_MODES.has(source.spaceAccessMode);
    const role = window.BusinessContext?.get?.().role || window.FirebaseSession?.profile?.role;
    // Rules reserve unscoped legacy products for owner review. Do not turn a
    // restricted operator's only visible space into an inferred product owner.
    if (!scoped && role !== 'owner') return [];
    const legacyIds = !scoped ? uniqueIds([product.spaceId, product.financialSpaceId].filter(Boolean)) : [];
    if (legacyIds.length > 1) return [];
    return homeSpaces().filter(s => s.businessId === businessId &&
      s.capabilities.products && s.capabilities.inventory && productAllowsSpace(product, s.id) &&
      (!legacyIds.length || legacyIds.includes(s.id)));
  }
  function stockMovementOrigin(product, requestedId = '') {
    const eligible = stockMovementSpaces(product), businessId = currentContext().businessId;
    const explicit = String(requestedId || '').trim();
    const selected = explicit || activeId();
    const space = selected ? eligible.find(s => s.id === selected) : eligible.length === 1 ? eligible[0] : null;
    if (!space || RESERVED_SPACE_IDS.has(space.id))
      throw Error('Selecione um espaço autorizado para esta movimentação de estoque.');
    return {businessId, spaceId:space.id};
  }
  function stockMovementFields(product) {
    const eligible = stockMovementSpaces(product);
    let origin = null;
    try { origin = stockMovementOrigin(product); } catch {}
    if (origin) {
      const space = eligible.find(s => s.id === origin.spaceId);
      return `<input type="hidden" name="stockSpaceId" value="${esc(origin.spaceId)}"><p class="muted">Espaço da movimentação: <b>${esc(space.name)}</b></p>`;
    }
    return `<div class="field"><label for="stock-movement-space">Espaço da movimentação *</label><select id="stock-movement-space" name="stockSpaceId" required><option value="">Selecione um espaço</option>${eligible.map(s => `<option value="${esc(s.id)}">${esc(s.name)}</option>`).join('')}</select><small>${eligible.length ? 'Escolha onde esta entrada ou saída aconteceu. O vínculo do produto não será alterado.' : 'Nenhum espaço autorizado disponível. Peça ao proprietário para revisar o vínculo deste produto.'}</small></div>`;
  }
  function selectionLabel() { return selectedHome()?.name || 'Espaço indisponível'; }
  function renderBar(kind = 'home') {
    const selected = activeId(), spaces = operationalSpaces();
    const management = (kind === 'home' || kind === 'sales') && canManage()
      ? '<button type="button" data-space-manage aria-label="Gerenciar espaços"><i data-lucide="settings-2"></i></button>' : '';
    if (kind === 'home' && spaces.length > 1) {
      const current = selectedHome();
      return `<section class="space-context-bar is-home" data-space-context="home"><button class="space-selector-trigger" type="button" data-space-picker="home" aria-haspopup="dialog" aria-label="Escolher espaço. Selecionado: ${esc(current.name)}"><span class="space-selector-icon"><i data-lucide="${esc(spaceIcon(current))}"></i></span><span class="space-selector-copy"><small>Espaço ativo</small><strong>${esc(current.name)}</strong></span><i class="space-selector-chevron" data-lucide="chevron-down"></i></button>${management}</section>`;
    }
    const content = spaces.length > 1
      ? `<label><span><i data-lucide="map-pin"></i>Espaço ativo</span><select aria-label="Espaço ativo" data-space-select="${kind}">${spaces.map(space => `<option value="${esc(space.id)}" ${selected === space.id ? 'selected' : ''}>${esc(space.name)}</option>`).join('')}</select></label>`
      : spaces.length === 1 ? `<span><i data-lucide="map-pin"></i>Espaço</span><strong>${esc(spaces[0].name)}</strong>`
      : '<span role="status">Nenhum espaço operacional disponível.</span>';
    return `<section class="space-context-bar ${spaces.length <= 1 ? 'is-single' : ''}" data-space-context="${kind}">${content}${management}</section>`;
  }
  // A space read may finish while a modal prevents the route from remounting.
  // Refresh only the selectors: never reset the checkout, modal or its drafts.
  function refreshBars() {
    const bars = window.document?.querySelectorAll?.('[data-space-context]');
    if (!bars?.length) return;
    bars.forEach(bar => {
      const kind = bar.dataset.spaceContext;
      if (['home', 'sales', 'clients', 'products'].includes(kind)) bar.outerHTML = renderBar(kind);
    });
    bind(document);
    window.lucide?.createIcons?.();
  }

  function openPicker(kind = "home") {
    ensureContext();
    if (kind !== "home") return;
    const root = document.querySelector("#modal"), selected = activeId(), spaces = operationalSpaces(),
      row = (id, name, description, icon) => {
        const active = selected === id;
        return `<button class="space-picker-option ${active ? "is-selected" : ""}" type="button" data-space-choice="${esc(id)}" role="radio" aria-checked="${active}"><span class="space-picker-option-icon"><i data-lucide="${icon}"></i></span><span><b>${esc(name)}</b><small>${esc(description)}</small></span><i class="space-picker-check" data-lucide="${active ? "check" : "circle"}"></i></button>`;
      };
    root.innerHTML = `<div class="modal-bg space-picker-backdrop"><section class="modal-box space-picker-modal" role="dialog" aria-modal="true" aria-labelledby="space-picker-title"><header class="modal-head"><div><h3 id="space-picker-title">Escolher espaço</h3><p>Veja somente os espaços autorizados para esta conta.</p></div><button class="icon-btn" type="button" data-space-picker-close aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="modal-body space-picker-list" role="radiogroup" aria-label="Espaços disponíveis">${spaces.map((space) => row(space.id, space.name, typeLabel(space.type), spaceIcon(space))).join("")}</div>${canManage() ? '<footer class="modal-foot"><button class="btn btn-light space-picker-manage" type="button" data-space-picker-manage><i data-lucide="building-2"></i> Gerenciar espaços</button></footer>' : ""}</section></div>`;
    const close = () => { root.innerHTML = ""; };
    root.querySelectorAll("[data-space-picker-close]").forEach((button) => button.onclick = close);
    root.querySelector(".space-picker-backdrop").onclick = (event) => { if (event.target === event.currentTarget) close(); };
    root.querySelectorAll("[data-space-choice]").forEach((button) => button.onclick = () => {
      try {
        selectHome(button.dataset.spaceChoice);
        if (root.querySelector(".space-picker-backdrop")) close();
      } catch (error) {
        window.Utils?.toast?.(error.message, true);
      }
    });
    root.querySelector("[data-space-picker-manage]")?.addEventListener("click", openManager);
    window.lucide?.createIcons();
    queueMicrotask(() => root.querySelector('.space-picker-option[aria-checked="true"]')?.focus());
  }
  function ownRow(row) {
    return (!row.businessId || row.businessId === state.businessId) &&
      (row.workspaceGeneration == null || row.workspaceGeneration === state.generation);
  }
  function recordSpace(row) {
    if (!ownRow(row) || row.spaceId && row.financialSpaceId && row.spaceId !== row.financialSpaceId) return '';
    return resolveSaleSpaceId(row);
  }
  function showsRenewal(row) {
    const id = activeId();
    const access = window.BusinessContext?.get?.();
    if (access?.businessId && access.role !== 'owner' &&
        (!row.spaceId || recordSpace(row) !== row.spaceId ||
          !operationalSpaces().some(space => space.id === row.spaceId))) return false;
    return Boolean(id && ownRow(row) && !window.OperationalReadPolicy?.restricted?.() &&
      window.TeamAccess?.canRoute?.('clientes') !== false && (!scopesCustomers() || recordSpace(row) === id));
  }
  function showsUnassignedRenewal(row) {
    return Boolean(activeId() && scopesCustomers() && ownRow(row) && !window.OperationalReadPolicy?.restricted?.() &&
      window.BusinessContext?.get?.().role === 'owner' && window.TeamAccess?.has?.('customers.view') &&
      !row.spaceId && !row.financialSpaceId);
  }
  function productsForView(products = []) {
    const space = selectedHome();
    if (!space?.capabilities.products) return [];
    return products.filter(product => ownRow(product) && productAllowsSpace(product, space.id));
  }
  function customerRelations(db) {
    const relations = new Map();
    function add(clientId, row) {
      const id = recordSpace(row);
      if (!clientId || !id) return;
      if (!relations.has(clientId)) relations.set(clientId, new Set());
      relations.get(clientId).add(id);
    }
    for (const client of db.clientes || []) {
      add(client.id, client);
      if (ownRow(client) && Array.isArray(client.customerSpaceIds))
        for (const id of client.customerSpaceIds) add(client.id, { spaceId: id });
    }
    for (const sale of db.vendas || []) if (isValidSale(sale) && !sale.desfeita && !sale.cancelledAt) add(sale.clienteId || sale.clientId, sale);
    if (!window.OperationalReadPolicy?.restricted?.())
      for (const renewal of db.customerSubscriptions || []) if (renewal.active !== false && !renewal.deletedAt) add(renewal.clientId, renewal);
    return relations;
  }
  function customersForView(db = {}) {
    const selected = activeId();
    if (!selected) return { clients: [], unassigned: [] };
    const own = (db.clientes || []).filter(ownRow);
    if (!scopesCustomers()) return { clients: own.filter(client =>
      !recordSpace(client) || recordSpace(client) === selected || client.customerSpaceIds?.includes?.(selected)), unassigned: [] };
    const relations = customerRelations(db), known = new Set(operationalSpaces().map(space => space.id));
    const mayReview = window.BusinessContext?.get?.().role === 'owner' && window.TeamAccess?.has?.('customers.view');
    return {
      clients: own.filter(client => relations.get(client.id)?.has(selected)),
      unassigned: mayReview ? own.filter(client => client.ativo !== false && client.active !== false && !client.deletedAt &&
        ![...(relations.get(client.id) || [])].some(id => known.has(id))) : [],
    };
  }
  const singleLegacyHome = () => unrestrictedSpaces() && operationalSpaces().length === 1 && homeSpaces().length === 1;
  function contextualData(db = {}, kind = 'home') {
    const selectionId = kind === 'sales' ? selectedSales()?.id : activeId();
    const knownIds = new Set(operationalSpaces().map(space => space.id));
    const allSales = (db?.vendas || []).filter(ownRow);
    const here = row => Boolean(selectionId) && recordSpace(row) === selectionId;
    const legacyHere = row => kind === 'home' && Boolean(selectionId) && singleLegacyHome() && !row.spaceId && !row.financialSpaceId;
    const customers = customersForView(db);
    const sales = allSales.filter(row => here(row) || legacyHere(row));
    const metrics = new Map();
    if (scopesCustomers()) for (const sale of sales) {
      if (!isValidSale(sale) || sale.desfeita || sale.cancelledAt) continue;
      const id = sale.clienteId || sale.clientId, current = metrics.get(id) || { totalComprado: 0, quantidadeVendas: 0, ultimaCompra: null };
      current.totalComprado += Number(sale.valorFinal ?? sale.valorTotal ?? 0) || 0;
      current.quantidadeVendas++;
      if (sale.data && (!current.ultimaCompra || sale.data > current.ultimaCompra)) current.ultimaCompra = sale.data;
      metrics.set(id, current);
    }
    return { ...db, vendas: sales, produtos: productsForView(db?.produtos),
      clientes: scopesCustomers() ? customers.clients.map(client => ({ ...client, totalComprado: 0, quantidadeVendas: 0,
        ultimaCompra: null, lastChargeAt: null, lastChargeMessageId: null, promessaPagamento: null, ...metrics.get(client.id) })) : customers.clients,
      unassignedCustomers: customers.unassigned, pagamentos: (db.pagamentos || []).filter(row => ownRow(row) && (here(row) || legacyHere(row))),
      movimentacoes: (db.movimentacoes || []).filter(here), cobrancas: (db.cobrancas || []).filter(here),
      messageHistory: (db.messageHistory || []).filter(here), contatosCliente: (db.contatosCliente || []).filter(here),
      catalogOrders: (db.catalogOrders || []).filter(here), customerSubscriptions: (db.customerSubscriptions || []).filter(here),
      spaceSelectionId: selectionId || '', unassignedLegacySales: allSales.filter(sale => isValidSale(sale) && !knownIds.has(recordSpace(sale))).length };
  }
  function goalFor(config = {}, selectionId = activeId()) {
    const dashboard = config.dashboard || config || {};
    if (selectionId === ALL_SPACES) return Number(dashboard.dailySalesGoal ?? config.dailySalesGoal ?? 0);
    const goal = dashboard.dailySalesGoalsBySpaceId?.[selectionId];
    return Number(goal ?? (selectionId && singleLegacyHome() ? dashboard.dailySalesGoal ?? config.dailySalesGoal : 0) ?? 0);
  }
  function saveGoal(value, selectionId = activeId()) {
    if (!canManage()) throw Error("Seu perfil não pode alterar metas.");
    const goal = Math.max(0, Number(value) || 0), id = String(selectionId || "");
    if (id !== ALL_SPACES && (!id || id !== activeId())) throw Error("O espaço da meta mudou.");
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
    const id = activeId();
    if (!id) return window.Utils?.toast?.("Aguarde um espaço autorizado para configurar a meta.", true);
    const root = document.querySelector("#modal"), space = selectedHome(), current = goalFor(window.DB.carregar().config, id), title = id === ALL_SPACES ? "Meta geral diária" : `Meta diária · ${space?.name || "Espaço"}`;
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
  function canReviewProductSpaces(product) {
    ensureContext();
    const context = window.BusinessContext?.get?.();
    return Boolean(product?.id && product.active !== false && product.ativo !== false &&
      !product.deletedAt && state.sessionReady && state.uid && state.businessId &&
      context?.role === "owner" && context.business?.ownerId === state.uid &&
      window.TeamAccess?.has?.("products.edit") &&
      product.businessId === state.businessId &&
      (product.workspaceGeneration ?? 0) === state.generation &&
      !product.spaceId && !product.financialSpaceId && !product.availability &&
      !["spaceAccessMode", "allowedSpaceIds", "defaultSpaceId", "spaceScopeVersion"]
        .some(field => Object.hasOwn(product, field)));
  }
  function reviewProductSpaces(id) {
    const product = window.Produtos?.obter?.(id);
    if (!canReviewProductSpaces(product))
      return window.Utils.toast("O acesso ou o cadastro mudou. Abra o produto novamente.", true);
    const spaces = salesSpaces();
    if (!state.loaded || !spaces.length || !window.DB?.__firebaseSyncWrapped)
      return window.Utils.toast("Aguarde o carregamento dos espaços de venda da empresa.", true);
    const session = window.TeamAccess.captureSession(), root = document.querySelector("#modal");
    root.innerHTML = `<div class="modal-bg"><section class="modal-box" role="dialog" aria-modal="true" aria-labelledby="legacy-product-spaces-title"><header class="modal-head"><h3 id="legacy-product-spaces-title">Disponibilidade de ${esc(product.nome)}</h3></header><form><div class="modal-body"><p>Escolha em quais espaços a equipe poderá consultar este item.</p><fieldset class="product-space-availability"><legend>Espaços de venda</legend>${spaces.map(space => `<label><input type="checkbox" name="spaceId" value="${esc(space.id)}"><span>${esc(space.name)}</span></label>`).join("")}</fieldset></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-space-close>Cancelar</button><button class="btn btn-primary" type="submit">Salvar espaços</button></footer></form></section></div>`;
    root.querySelector("[data-space-close]").onclick = () => window.Modais.fechar();
    root.querySelector("form").onsubmit = async event => {
      event.preventDefault();
      const form = event.currentTarget, submit = form.querySelector('[type="submit"]');
      if (submit.disabled || !form.isConnected) return;
      submit.disabled = true;
      try {
        window.TeamAccess.assertSession(session);
        const ids = uniqueIds(new FormData(form).getAll("spaceId")),
          shown = new Set(spaces.map(space => space.id));
        if (!ids.length || ids.length > 30 || ids.some(id => !shown.has(id)))
          throw Error("Escolha de 1 a 30 espaços de venda desta empresa.");
        const remote = await window.FirestoreRepositories?.products?.getProductStatusFromServer?.(product.id);
        window.TeamAccess.assertSession(session);
        if (!form.isConnected) return;
        if (remote?.id !== product.id || !canReviewProductSpaces(remote) || typeof remote.hasInlineCost !== "boolean")
          throw Error("Confirme o cadastro na nuvem antes de definir os espaços.");
        if (remote.hasInlineCost)
          throw Error("Este produto ainda guarda o custo no cadastro antigo. Peça a conferência do suporte antes de liberar para a equipe.");
        const authorized = new Set(salesSpaces().map(space => space.id));
        if (ids.some(id => !authorized.has(id)))
          throw Error("Os espaços de venda mudaram. Abra o produto novamente.");
        window.DB.alterar(db => {
          const current = db.produtos.find(item => item.id === product.id);
          if (!canReviewProductSpaces(current))
            throw Error("O acesso ou o cadastro mudou. Abra o produto novamente.");
          Object.assign(current, normalizeProductAccess({
            spaceAccessMode: ids.length === 1 ? "single_space" : "selected_spaces",
            allowedSpaceIds: ids,
            defaultSpaceId: ids[0],
          }));
        });
        await window.DB.flush();
        window.TeamAccess.assertSession(session);
        if (!form.isConnected) return;
        window.Modais.fechar();
        window.Utils.toast("Espaços salvos neste aparelho. A equipe terá acesso após a sincronização.");
      } catch (error) {
        if (form.isConnected) {
          submit.disabled = false;
          window.Utils.toast(error.message || "Não foi possível salvar os espaços.", true);
        }
      }
    };
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
          try {
          selectActive(select.value);
        } catch (error) {
          select.value = activeId();
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
    customerSpaces: () => { ensureContext(); return operationalSpaces(); },
    selectedHome,
    selectedSales,
    activeId,
    viewScope,
    scopesCustomers,
    showsRenewal,
    showsUnassignedRenewal,
    customersForView,
    productsForView,
    recordSpace: row => { ensureContext(); return recordSpace(row); },
    selectActive,
    homeId: activeId,
    salesId: () => selectedSales()?.id || "",
    selectHome,
    selectSales,
    requireSalesSpace,
    stockMovementOrigin,
    stockMovementSpaces,
    stockMovementFields,
    selectionLabel,
    renderBar,
    refreshBars,
    contextualData,
    goalFor,
    saveGoal,
    openGoalEditor,
    openPicker,
    openManager,
    availabilityFields,
    bindProductAvailability,
    productAccessFromForm,
    canReviewProductSpaces,
    reviewProductSpaces,
    productAllowsSpace,
    resolveSaleSpaceId,
    isValidSale,
    canManage,
    bind,
  };
  window.SpaceEngine = SpaceEngine;
  window.SpaceContext = SpaceContext;
  ['veconi-spaces-ready', 'veconi-space-context-local-ready', 'veconi-space-context-changed']
    .forEach(event => addEventListener(event, refreshBars));
  addEventListener("business-context-changed", () => {
    ensureContext();
    dispatchEvent(new CustomEvent("veconi-space-context-local-ready", { detail: snapshot() }));
  });
  addEventListener("firebase-session-cleared", () => {
    state.viewEpoch++;
    Object.assign(state, { spaces: [], businessId: "", uid: "", activeId: "", generation: 0, sessionReady: false, loaded: false, migrationReport: null });
  });
})();
