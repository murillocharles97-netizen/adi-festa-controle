(function (root) {
  "use strict";
  const Engine = root.CRMSegmentEngineV2;
  if (!Engine) throw new Error("CRM Segment Engine V2 não foi carregado.");
  const definitions = Object.freeze([
    { id: "inactive30", label: "Sumidos há 30 dias", copy: "Não compram há 30 dias ou mais", icon: "clock-3" },
    { id: "renewal7", label: "Renovações em até 7 dias", copy: "Vencem nos próximos 7 dias", icon: "calendar-clock" },
    { id: "vip", label: "Clientes VIP", copy: "Maiores compradores", icon: "star" },
    { id: "nearReward", label: "Perto de ganhar recompensa", copy: "A menos de 20% da meta", icon: "gift" },
    { id: "debt", label: "Devendo", copy: "Com saldo em aberto", icon: "wallet-cards" },
    { id: "new30", label: "Novos clientes", copy: "Primeira compra ou cadastro recente", icon: "user-round-plus" },
  ]);
  const templates = Object.freeze([
    { id: "valuable-lapsed", name: "Clientes valiosos que sumiram", description: "Compraram bastante, mas já passaram do prazo esperado de retorno.", matchMode: "all", conditions: [{ field: "totalSpent", operator: "gt", value: 300, period: { key: "all" } }, { field: "purchaseCount", operator: "gte", value: 3, period: { key: "all" } }, { field: "lastPurchaseDays", operator: "gte", value: 30 }] },
    { id: "frequent-buyers", name: "Compradores frequentes", description: "Clientes com várias compras no período recente.", matchMode: "all", conditions: [{ field: "purchaseCount", operator: "gte", value: 5, period: { key: "90d" } }] },
    { id: "product-repeat", name: "Compradores de um produto", description: "Escolha o produto e a quantidade comprada no período.", matchMode: "all", conditions: [{ field: "productUnits", operator: "gte", subjectId: "", value: 3, period: { key: "60d" } }] },
    { id: "cross-sell", name: "Comprou A, mas nunca B", description: "Encontre oportunidades de venda complementar.", matchMode: "all", conditions: [{ field: "productPurchased", operator: "has", subjectId: "", period: { key: "all" } }, { field: "productNever", operator: "eq", subjectId: "", value: true }] },
    { id: "first-no-return", name: "Primeira compra sem retorno", description: "Fez somente uma compra e ainda não voltou.", matchMode: "all", conditions: [{ field: "firstPurchaseWithoutReturn", operator: "eq", value: true }, { field: "lastPurchaseDays", operator: "gte", value: 30 }] },
    { id: "debt-no-charge", name: "Cobrança necessária", description: "Possui dívida relevante e está há dias sem cobrança.", matchMode: "all", conditions: [{ field: "hasDebt", operator: "eq", value: true }, { field: "debtAmount", operator: "gt", value: 100 }, { field: "noCollectionDays", operator: "gte", value: 15 }] },
    { id: "renewal-soon", name: "Renovação próxima", description: "Renovações que vencem nos próximos sete dias.", matchMode: "all", conditions: [{ field: "renewalDays", operator: "between", value: 0, valueTo: 7 }] },
    { id: "renewal-lost", name: "Renovação perdida", description: "Renovações vencidas que ainda não retornaram.", matchMode: "all", conditions: [{ field: "renewalOverdueDays", operator: "gte", value: 1 }, { field: "renewalMissing", operator: "eq", value: true }] },
    { id: "near-reward", name: "Perto da recompensa", description: "Clientes com pelo menos 80% do progresso.", matchMode: "all", conditions: [{ field: "campaignProgress", operator: "gte", value: 80 }, { field: "availableReward", operator: "eq", value: false }] },
    { id: "reward-waiting", name: "Prêmio esperando", description: "Clientes que já podem resgatar uma recompensa.", matchMode: "all", conditions: [{ field: "availableReward", operator: "eq", value: true }] },
  ]);
  const businessId = () => root.DB?.getBusinessId?.() || "";
  const activeSegments = (data = root.DB.carregar()) => (data.segmentosClientes || []).filter((item) => !item.deletedAt && item.active !== false && (!item.businessId || item.businessId === businessId()));
  const rowsFor = (row) => [{ ...row, metric: { ...(row.metric || {}), openBalance: row.metric?.openBalance ?? Math.abs(Math.min(0, Number(row.client?.saldo || 0))) } }];
  function matchesConditions(row, conditions = [], matchMode = "all", data = root.DB.carregar(), projection = null) {
    return Engine.evaluate(rowsFor(row), conditions, matchMode, data, { businessId: businessId(), projection }).rows.length > 0;
  }
  function contextFor(row, data = root.DB.carregar()) {
    const projection = Engine.project(data, rowsFor(row), { businessId: businessId() });
    return { row, data, projection, bucket: projection.byClient.get(String(row.client.id)) };
  }
  function matchesPreset(id, row, data = root.DB.carregar(), projection = null) {
    const conditions = {
      inactive30: [{ field: "lastPurchaseDays", operator: "gte", value: 30 }],
      renewal7: [{ field: "renewalDays", operator: "between", value: 0, valueTo: 7 }],
      nearReward: [{ field: "nearReward", operator: "eq", value: true }],
      debt: [{ field: "hasDebt", operator: "eq", value: true }],
      new30: [{ field: "createdDays", operator: "lte", value: 30 }],
    }[id];
    if (id === "vip") return (row.classifications || []).includes("VIP") || Number(row.metric?.totalSpent || 0) >= 1000 || Number(row.metric?.purchaseCount || 0) >= 10;
    return conditions ? matchesConditions(row, conditions, "all", data, projection) : true;
  }
  function segmentPayload(input = {}, old = {}) {
    const tenant = businessId();
    if (!tenant) throw new Error("Empresa não identificada.");
    const now = new Date().toISOString();
    return { ...old, id: input.id || old.id || root.Utils.uuid(), businessId: tenant, schemaVersion: Engine.VERSION,
      name: String(input.name || old.name || "Segmento sem nome").trim(), description: String(input.description ?? old.description ?? "").trim(),
      matchMode: (input.matchMode || old.matchMode) === "any" ? "any" : "all", conditions: Engine.validConditions(input.conditions || old.conditions || []),
      type: "dynamic", pinned: input.pinned ?? old.pinned ?? false, active: input.active ?? old.active ?? true, updatedAt: now,
      createdAt: old.createdAt || input.createdAt || now, operationId: old.operationId || input.operationId || root.Utils.uuid() };
  }
  function save(input) {
    let stored;
    root.DB.alterar((data) => { data.segmentosClientes ||= []; const index = data.segmentosClientes.findIndex((item) => item.id === input.id); const old = index >= 0 ? data.segmentosClientes[index] : {}; stored = segmentPayload(input, old); if (index >= 0) data.segmentosClientes[index] = stored; else data.segmentosClientes.push(stored); });
    return stored;
  }
  const get = (id, data = root.DB.carregar()) => activeSegments(data).find((item) => String(item.id) === String(id)) || null;
  const duplicate = (id) => { const source = get(id); return source ? save({ ...source, id: null, operationId: null, pinned: false, name: `${source.name} (cópia)` }) : null; };
  const rename = (id, name) => { const source = get(id); return source && String(name || "").trim() ? save({ ...source, name: String(name).trim() }) : null; };
  const togglePinned = (id, value) => { const source = get(id); return source ? save({ ...source, pinned: value == null ? !source.pinned : Boolean(value) }) : null; };
  function remove(id) { root.DB.alterar((data) => { const item = (data.segmentosClientes || []).find((entry) => entry.id === id && (!entry.businessId || entry.businessId === businessId())); if (item) { item.active = false; item.deletedAt = new Date().toISOString(); item.updatedAt = item.deletedAt; } }); }
  function evaluateSaved(id, rows, data = root.DB.carregar(), projection = null) { const segment = get(id, data); return segment ? Engine.evaluate(rows, segment.conditions, segment.matchMode, data, { businessId: businessId(), projection }) : { rows: [], clientIds: [] }; }
  root.EngagementSegments = { VERSION: Engine.VERSION, DAY: Engine.DAY, definitions, templates, fields: Engine.fields, groups: Engine.groups, periods: Engine.periods, operators: Engine.operators,
    progressRatio: Engine.progressRatio, isNearReward: Engine.isNearReward, isRedeemable: Engine.isRedeemable, isStalled: Engine.isStalled,
    matchesPreset, matchesConditions, contextFor, project: Engine.project, evaluate: Engine.evaluate, describeCondition: Engine.describeCondition,
    audienceSnapshot: Engine.audienceSnapshot, list: activeSegments, get, save, duplicate, rename, togglePinned, remove, evaluateSaved, segmentPayload };
})(typeof globalThis !== "undefined" ? globalThis : window);
