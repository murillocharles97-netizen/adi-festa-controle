(function () {
  "use strict";

  const DAY = 86400000;
  const now = () => Date.now();
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const dateValue = (value) => {
    if (!value) return null;
    const parsed = value?.toDate?.() || new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const daysUntil = (value) => {
    const date = dateValue(value);
    return date ? Math.ceil((date.getTime() - now()) / DAY) : null;
  };
  const definitions = Object.freeze([
    { id: "inactive30", label: "Sumidos há 30 dias", copy: "Não compram há 30 dias ou mais", icon: "clock-3" },
    { id: "renewal7", label: "Renovações em até 7 dias", copy: "Vencem nos próximos 7 dias", icon: "calendar-clock" },
    { id: "vip", label: "Clientes VIP", copy: "Maiores compradores", icon: "star" },
    { id: "nearReward", label: "Perto de ganhar recompensa", copy: "A menos de 20% da meta", icon: "gift" },
    { id: "debt", label: "Devendo", copy: "Com saldo em aberto", icon: "wallet-cards" },
    { id: "new30", label: "Novos clientes", copy: "Cadastrados nos últimos 30 dias", icon: "user-round-plus" },
  ]);
  const fields = Object.freeze({
    lastPurchaseDays: { label: "Última compra", type: "days", operators: ["gt", "gte", "lt", "lte", "between"] },
    totalSpent: { label: "Total comprado", type: "money", operators: ["eq", "neq", "gt", "gte", "lt", "lte", "between"] },
    purchaseCount: { label: "Quantidade de compras", type: "number", operators: ["eq", "neq", "gt", "gte", "lt", "lte", "between"] },
    balance: { label: "Saldo atual", type: "money", operators: ["eq", "neq", "gt", "gte", "lt", "lte", "between"] },
    balanceStatus: { label: "Situação da conta", type: "enum", operators: ["eq", "neq"], options: ["debt", "credit", "zero"] },
    product: { label: "Produto comprado", type: "relation", operators: ["has", "not_has"] },
    category: { label: "Categoria comprada", type: "relation", operators: ["has", "not_has"] },
    renewalDays: { label: "Renovação", type: "days", operators: ["gte", "lte", "between"] },
    renewalOverdue: { label: "Renovação vencida", type: "boolean", operators: ["eq"] },
    campaign: { label: "Participa da campanha", type: "relation", operators: ["has", "not_has"] },
    nearReward: { label: "Perto da recompensa", type: "boolean", operators: ["eq"] },
    availableReward: { label: "Prêmio disponível", type: "boolean", operators: ["eq"] },
    createdDays: { label: "Cadastro", type: "days", operators: ["gt", "gte", "lt", "lte", "between"] },
  });
  const operators = Object.freeze({
    eq: "igual a", neq: "diferente de", gt: "maior que", gte: "maior ou igual", lt: "menor que", lte: "menor ou igual", between: "entre", has: "possui", not_has: "não possui",
  });

  function campaignTarget(campaign, progress) {
    if (!campaign) return 0;
    if (campaign.type === "points") {
      const current = number(progress?.availablePoints);
      return (campaign.rewards || [])
        .map((reward) => number(reward.pointsCost))
        .filter((target) => target > current)
        .sort((a, b) => a - b)[0] || 0;
    }
    return number(campaign.type === "nth_product" ? campaign.rule?.requiredPurchases : campaign.rule?.requiredQuantity);
  }
  function progressRatio(campaign, progress) {
    if (!campaign || !progress) return 0;
    if (number(progress.availableRewards) > 0) return 1;
    const current = number(campaign.type === "points" ? progress.availablePoints : progress.cycleRemainder ?? progress.confirmedProgress);
    const target = campaignTarget(campaign, progress);
    return target > 0 ? Math.max(0, Math.min(1, current / target)) : 0;
  }
  function isNearReward(campaign, progress, threshold = 0.8) {
    const ratio = progressRatio(campaign, progress);
    return ratio >= threshold && ratio < 1;
  }
  function isRedeemable(campaign, progress) {
    if (!progress) return false;
    if (number(progress.availableRewards) > 0) return true;
    return campaign?.type === "points" && (campaign.rewards || []).some((reward) => number(reward.pointsCost) > 0 && number(reward.pointsCost) <= number(progress.availablePoints));
  }
  function isStalled(progress, days = 15) {
    const advanced = dateValue(progress?.lastQualifiedAt || progress?.updatedAt);
    const hasProgress = number(progress?.confirmedProgress) > 0 || number(progress?.availablePoints) > 0 || number(progress?.pendingProgress) > 0 || number(progress?.pendingPoints) > 0;
    return Boolean(hasProgress && advanced && now() - advanced.getTime() >= days * DAY);
  }
  function contextFor(row, data = DB.carregar()) {
    const id = String(row.client.id), subscriptions = (data.customerSubscriptions || []).filter((item) => String(item.clientId || item.clienteId) === id && !item.deletedAt), progress = (data.progressosCampanha || []).filter((item) => String(item.clientId || item.clienteId) === id && !item.deletedAt), campaigns = new Map((data.campanhas || []).map((item) => [String(item.id), window.Campanhas?.normalize?.(item) || item]));
    const products = new Set(), categories = new Set();
    for (const sale of data.vendas || []) {
      if (String(sale.clienteId || sale.clientId || sale.customerId) !== id || sale.deletedAt || ["cancelada", "cancelado", "desfeita"].includes(String(sale.status).toLowerCase())) continue;
      for (const item of sale.itens || sale.items || []) {
        if (item.produtoId || item.productId) products.add(String(item.produtoId || item.productId));
        if (item.categoriaId || item.categoryId || item.categoria || item.category) categories.add(String(item.categoriaId || item.categoryId || item.categoria || item.category).toLowerCase());
      }
    }
    return { row, data, subscriptions, progress, campaigns, products, categories };
  }
  function matchesPreset(id, row, data = DB.carregar()) {
    const context = contextFor(row, data), metric = row.metric || {}, client = row.client || {}, classifications = row.classifications || [];
    if (id === "inactive30") return Boolean(metric.lastPurchaseAt && number(metric.daysSinceLastPurchase) >= 30);
    if (id === "renewal7") return context.subscriptions.some((item) => ["active", "ativa", "ativo"].includes(String(item.status || "active").toLowerCase()) && daysUntil(item.expiresAt || item.endDate || item.dataFim) >= 0 && daysUntil(item.expiresAt || item.endDate || item.dataFim) <= 7);
    if (id === "vip") return classifications.includes("VIP") || number(metric.totalSpent) >= 1000 || number(metric.purchaseCount) >= 10;
    if (id === "nearReward") return context.progress.some((item) => isNearReward(context.campaigns.get(String(item.campaignId || item.campanhaId)), item));
    if (id === "debt") return number(metric.openBalance) > 0;
    if (id === "new30") { const created = dateValue(client.criadoEm || client.createdAt); return Boolean(created && now() - created.getTime() <= 30 * DAY); }
    return true;
  }
  function compare(actual, operator, expected, secondary) {
    if (operator === "has") return actual instanceof Set ? actual.has(String(expected).toLowerCase()) || actual.has(String(expected)) : Boolean(actual);
    if (operator === "not_has") return !compare(actual, "has", expected, secondary);
    if (operator === "between") return number(actual) >= number(expected) && number(actual) <= number(secondary);
    if (operator === "eq") return typeof actual === "boolean" ? actual === (expected === true || expected === "true") : String(actual) === String(expected);
    if (operator === "neq") return !compare(actual, "eq", expected, secondary);
    if (operator === "gt") return number(actual) > number(expected);
    if (operator === "gte") return number(actual) >= number(expected);
    if (operator === "lt") return number(actual) < number(expected);
    if (operator === "lte") return number(actual) <= number(expected);
    return false;
  }
  function conditionValue(field, context) {
    const { row, subscriptions, progress, campaigns, products, categories } = context, metric = row.metric || {}, client = row.client || {};
    if (field === "lastPurchaseDays") return metric.daysSinceLastPurchase;
    if (field === "totalSpent") return metric.totalSpent;
    if (field === "purchaseCount") return metric.purchaseCount;
    if (field === "balance") return metric.openBalance;
    if (field === "balanceStatus") return number(metric.openBalance) > 0 ? "debt" : number(client.saldo) > 0 ? "credit" : "zero";
    if (field === "product") return products;
    if (field === "category") return categories;
    if (field === "renewalDays") return subscriptions.map((item) => daysUntil(item.expiresAt || item.endDate || item.dataFim)).filter(Number.isFinite).sort((a, b) => a - b)[0];
    if (field === "renewalOverdue") return subscriptions.some((item) => daysUntil(item.expiresAt || item.endDate || item.dataFim) < 0);
    if (field === "campaign") return new Set(progress.map((item) => String(item.campaignId || item.campanhaId)));
    if (field === "nearReward") return progress.some((item) => isNearReward(campaigns.get(String(item.campaignId || item.campanhaId)), item));
    if (field === "availableReward") return progress.some((item) => isRedeemable(campaigns.get(String(item.campaignId || item.campanhaId)), item));
    if (field === "createdDays") { const created = dateValue(client.criadoEm || client.createdAt); return created ? Math.floor((now() - created.getTime()) / DAY) : null; }
    return null;
  }
  function matchesConditions(row, conditions = [], matchMode = "all", data = DB.carregar()) {
    const safe = conditions.filter((condition) => fields[condition.field]?.operators.includes(condition.operator));
    if (!safe.length) return true;
    const context = contextFor(row, data), checks = safe.map((condition) => compare(conditionValue(condition.field, context), condition.operator, condition.value, condition.valueTo));
    return matchMode === "any" ? checks.some(Boolean) : checks.every(Boolean);
  }
  function segmentPayload(input = {}, old = {}) {
    const businessId = DB.getBusinessId?.() || "";
    if (!businessId) throw Error("Empresa não identificada.");
    const conditions = (input.conditions || old.conditions || []).filter((item) => fields[item.field]?.operators.includes(item.operator)).map((item) => ({ field: item.field, operator: item.operator, value: item.value ?? "", valueTo: item.valueTo ?? "" }));
    return { ...old, id: input.id || old.id || Utils.uuid(), businessId, name: String(input.name || old.name || "Segmento sem nome").trim(), description: String(input.description || old.description || "").trim(), matchMode: input.matchMode === "any" ? "any" : "all", conditions, type: "dynamic", active: input.active !== false, updatedAt: new Date().toISOString(), createdAt: old.createdAt || new Date().toISOString(), operationId: old.operationId || Utils.uuid() };
  }
  function save(input) {
    let stored;
    DB.alterar((data) => { data.segmentosClientes ||= []; const index = data.segmentosClientes.findIndex((item) => item.id === input.id); const old = index >= 0 ? data.segmentosClientes[index] : {}; stored = segmentPayload(input, old); if (index >= 0) data.segmentosClientes[index] = stored; else data.segmentosClientes.push(stored); });
    return stored;
  }
  function duplicate(id) { const source = (DB.carregar().segmentosClientes || []).find((item) => item.id === id && !item.deletedAt); return source ? save({ ...source, id: null, name: `${source.name} (cópia)` }) : null; }
  function remove(id) { DB.alterar((data) => { const item = (data.segmentosClientes || []).find((entry) => entry.id === id); if (item) { item.active = false; item.deletedAt = new Date().toISOString(); item.updatedAt = item.deletedAt; } }); }

  window.EngagementSegments = { DAY, definitions, fields, operators, progressRatio, isNearReward, isRedeemable, isStalled, matchesPreset, matchesConditions, contextFor, save, duplicate, remove, segmentPayload };
})();
