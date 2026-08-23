(function (root, factory) {
  const api = factory(root || globalThis);
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CRMSegmentEngineV2 = api;
})(typeof globalThis !== "undefined" ? globalThis : this, (root) => {
  "use strict";

  const VERSION = 2;
  const DAY = 86400000;
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const text = (value) => String(value ?? "").trim();
  const normalize = (value) => text(value).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const dateValue = (value) => {
    if (!value) return null;
    if (typeof value?.toDate === "function") value = value.toDate();
    if (typeof value === "object" && Number.isFinite(value.seconds)) value = new Date(value.seconds * 1000);
    const parsed = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  };
  const clientIdOf = (item = {}) => text(item.clientId || item.clienteId || item.customerId);
  const saleDate = (sale = {}) => dateValue(sale.data || sale.createdAt || sale.criadoEm);
  const saleValue = (sale = {}) => number(sale.valorFinal ?? sale.valorTotal ?? sale.total ?? sale.amount);
  const itemProductId = (item = {}) => text(item.produtoId || item.productId);
  const itemQuantity = (item = {}) => number(item.quantidade ?? item.quantity);
  const itemValue = (item = {}) => number(item.subtotalFinal ?? item.subtotal ?? item.total ?? (itemQuantity(item) * number(item.precoFinalUnitario ?? item.precoUnitario ?? item.unitPriceSnapshot)));
  const belongsToBusiness = (item = {}, businessId = "") => !businessId || !item.businessId || text(item.businessId) === text(businessId);
  const validSale = (sale, businessId) => root.CustomerMetricsService?.isValidSale
    ? root.CustomerMetricsService.isValidSale(sale, { businessId })
    : Boolean(sale && belongsToBusiness(sale, businessId) && !sale.deletedAt && !["cancelada", "cancelado", "cancelled", "desfeita", "venda_desfeita"].includes(normalize(sale.status)) && clientIdOf(sale) && saleDate(sale));

  const operators = Object.freeze({
    eq: "igual a", neq: "diferente de", gt: "maior que", gte: "maior ou igual", lt: "menor que", lte: "menor ou igual", between: "entre",
    has: "possui", not_has: "não possui", contains: "contém", not_contains: "não contém", before: "antes de", after: "depois de",
  });
  const periods = Object.freeze([
    ["all", "Todo o histórico"], ["today", "Hoje"], ["7d", "Últimos 7 dias"], ["30d", "Últimos 30 dias"],
    ["60d", "Últimos 60 dias"], ["90d", "Últimos 90 dias"], ["month", "Este mês"], ["previous", "Mês anterior"],
    ["year", "Este ano"], ["custom", "Período personalizado"],
  ]);
  const groups = Object.freeze({
    purchases: "Compras", product: "Produto", category: "Categoria", relationship: "Frequência e relacionamento",
    finance: "Financeiro", renewal: "Renovações", campaign: "Campanhas e fidelidade", client: "Cliente e cadastro",
  });
  const numeric = ["eq", "neq", "gt", "gte", "lt", "lte", "between"];
  const fields = Object.freeze({
    totalSpent: { group: "purchases", label: "Total gasto", type: "money", operators: numeric, period: true },
    purchaseCount: { group: "purchases", label: "Quantidade de compras", type: "number", operators: numeric, period: true },
    averageTicket: { group: "purchases", label: "Ticket médio", type: "money", operators: numeric, period: true },
    lastPurchaseDays: { group: "purchases", label: "Última compra", type: "days", operators: numeric },
    firstPurchaseDays: { group: "purchases", label: "Primeira compra", type: "days", operators: numeric },
    lastPurchaseValue: { group: "purchases", label: "Valor da última compra", type: "money", operators: numeric },
    productPurchased: { group: "product", label: "Comprou produto", type: "product", operators: ["has", "not_has"], period: true },
    productPurchaseCount: { group: "product", label: "Compras distintas do produto", type: "product-number", operators: numeric, period: true },
    productUnits: { group: "product", label: "Unidades compradas do produto", type: "product-number", operators: numeric, period: true },
    productSpent: { group: "product", label: "Valor gasto no produto", type: "product-money", operators: numeric, period: true },
    productLastPurchaseDays: { group: "product", label: "Última compra do produto", type: "product-days", operators: numeric },
    productNever: { group: "product", label: "Nunca comprou produto", type: "product", operators: ["eq"] },
    categoryPurchased: { group: "category", label: "Comprou categoria", type: "category", operators: ["has", "not_has"], period: true },
    categoryPurchaseCount: { group: "category", label: "Compras distintas da categoria", type: "category-number", operators: numeric, period: true },
    categoryUnits: { group: "category", label: "Unidades compradas da categoria", type: "category-number", operators: numeric, period: true },
    categorySpent: { group: "category", label: "Valor gasto na categoria", type: "category-money", operators: numeric, period: true },
    historicalPurchases: { group: "relationship", label: "Compras no histórico", type: "number", operators: numeric },
    vip: { group: "relationship", label: "Cliente VIP", type: "boolean", operators: ["eq"] },
    firstPurchaseWithoutReturn: { group: "relationship", label: "Primeira compra sem retorno", type: "boolean", operators: ["eq"] },
    recoveredClient: { group: "relationship", label: "Cliente recuperado", type: "boolean", operators: ["eq"] },
    createdDays: { group: "relationship", label: "Dias desde o cadastro", type: "days", operators: numeric },
    hasDebt: { group: "finance", label: "Possui dívida", type: "boolean", operators: ["eq"] },
    debtAmount: { group: "finance", label: "Valor da dívida", type: "money", operators: numeric },
    hasCredit: { group: "finance", label: "Possui crédito", type: "boolean", operators: ["eq"] },
    creditAmount: { group: "finance", label: "Valor do crédito", type: "money", operators: numeric },
    zeroBalance: { group: "finance", label: "Saldo zerado", type: "boolean", operators: ["eq"] },
    lastPaymentDays: { group: "finance", label: "Dias desde o pagamento", type: "days", operators: numeric },
    noPaymentDays: { group: "finance", label: "Sem pagamento há", type: "days", operators: numeric },
    lastCollectionDays: { group: "finance", label: "Dias desde a cobrança", type: "days", operators: numeric },
    noCollectionDays: { group: "finance", label: "Sem cobrança há", type: "days", operators: numeric },
    settledRecently: { group: "finance", label: "Quitou recentemente", type: "boolean", operators: ["eq"], period: true },
    overduePromise: { group: "finance", label: "Promessa de pagamento vencida", type: "boolean", operators: ["eq"] },
    renewalDays: { group: "renewal", label: "Dias até a renovação", type: "days", operators: numeric },
    renewalStatus: { group: "renewal", label: "Status da renovação", type: "enum", operators: ["eq", "neq"], options: [["active", "Ativa"], ["paused", "Pausada"], ["cancelled", "Cancelada"], ["expired", "Vencida"]] },
    renewalOverdue: { group: "renewal", label: "Renovação vencida", type: "boolean", operators: ["eq"] },
    renewalOverdueDays: { group: "renewal", label: "Dias de atraso da renovação", type: "days", operators: numeric },
    renewalMissing: { group: "renewal", label: "Não renovou", type: "boolean", operators: ["eq"] },
    renewedRecently: { group: "renewal", label: "Renovou recentemente", type: "boolean", operators: ["eq"], period: true },
    renewalProduct: { group: "renewal", label: "Produto recorrente", type: "product", operators: ["has", "not_has"] },
    renewalVariant: { group: "renewal", label: "Variação ou plano recorrente", type: "text", operators: ["contains", "not_contains", "eq", "neq"] },
    campaign: { group: "campaign", label: "Participa da campanha", type: "campaign", operators: ["has", "not_has"] },
    campaignProgress: { group: "campaign", label: "Progresso da campanha (%)", type: "campaign-number", operators: numeric },
    nearReward: { group: "campaign", label: "Perto da recompensa", type: "boolean", operators: ["eq"] },
    availableReward: { group: "campaign", label: "Recompensa disponível", type: "boolean", operators: ["eq"] },
    redeemedReward: { group: "campaign", label: "Já resgatou recompensa", type: "boolean", operators: ["eq"] },
    pendingCampaignProgress: { group: "campaign", label: "Progresso pendente por fiado", type: "boolean", operators: ["eq"] },
    stalledCampaign: { group: "campaign", label: "Parado na campanha", type: "boolean", operators: ["eq"] },
    clientName: { group: "client", label: "Nome", type: "text", operators: ["contains", "not_contains", "eq", "neq"] },
    city: { group: "client", label: "Cidade", type: "text", operators: ["contains", "not_contains", "eq", "neq"] },
    neighborhood: { group: "client", label: "Bairro", type: "text", operators: ["contains", "not_contains", "eq", "neq"] },
    tag: { group: "client", label: "Etiqueta", type: "text", operators: ["contains", "not_contains"] },
    hasPhone: { group: "client", label: "Possui telefone", type: "boolean", operators: ["eq"] },
    hasWhatsapp: { group: "client", label: "Possui WhatsApp", type: "boolean", operators: ["eq"] },
    hasEmail: { group: "client", label: "Possui e-mail", type: "boolean", operators: ["eq"] },
    acceptsMarketing: { group: "client", label: "Aceita marketing", type: "boolean", operators: ["eq"] },
    birthdayThisMonth: { group: "client", label: "Aniversário neste mês", type: "boolean", operators: ["eq"] },
    // Compatibilidade com segmentos V1.
    balance: { group: "finance", label: "Saldo atual", type: "money", operators: numeric },
    balanceStatus: { group: "finance", label: "Situação da conta", type: "enum", operators: ["eq", "neq"], options: [["debt", "Com dívida"], ["credit", "Com crédito"], ["zero", "Sem saldo"]] },
    product: { group: "product", label: "Produto comprado", type: "product", operators: ["has", "not_has"], period: true },
    category: { group: "category", label: "Categoria comprada", type: "category", operators: ["has", "not_has"], period: true },
  });

  function dayNumber(value) {
    const date = dateValue(value);
    if (!date) return null;
    try {
      const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
      const part = (name) => Number(parts.find((entry) => entry.type === name)?.value);
      return Date.UTC(part("year"), part("month") - 1, part("day")) / DAY;
    } catch (_) { return Math.floor(date.getTime() / DAY); }
  }
  const daysAgo = (value, now = new Date()) => {
    const then = dayNumber(value), today = dayNumber(now);
    return then == null || today == null ? null : Math.max(0, today - then);
  };
  const daysUntil = (value, now = new Date()) => {
    const future = dayNumber(value), today = dayNumber(now);
    return future == null || today == null ? null : future - today;
  };
  function periodBounds(period = {}, now = new Date()) {
    const key = typeof period === "string" ? period : period.key || period.preset || "all";
    const end = new Date(now), start = new Date(0);
    end.setHours(23, 59, 59, 999);
    const back = (days) => { start.setTime(end.getTime()); start.setDate(start.getDate() - days); start.setHours(0, 0, 0, 0); };
    if (key === "today") back(0);
    else if (/^\d+d$/.test(key)) back(Math.max(0, Number(key.slice(0, -1)) - 1));
    else if (key === "month") start.setTime(new Date(end.getFullYear(), end.getMonth(), 1).getTime());
    else if (key === "previous") { start.setTime(new Date(end.getFullYear(), end.getMonth() - 1, 1).getTime()); end.setTime(new Date(end.getFullYear(), end.getMonth(), 0, 23, 59, 59, 999).getTime()); }
    else if (key === "year") start.setTime(new Date(end.getFullYear(), 0, 1).getTime());
    else if (key === "custom") {
      const customStart = dateValue(period.start), customEnd = dateValue(period.end);
      if (customStart) { start.setTime(customStart.getTime()); start.setHours(0, 0, 0, 0); }
      if (customEnd) { end.setTime(customEnd.getTime()); end.setHours(23, 59, 59, 999); }
    }
    return { key, start: start.getTime(), end: end.getTime() };
  }

  const emptyStat = () => ({ spent: 0, purchases: new Set(), units: 0, lastAt: null });
  const addStat = (map, key, sale, item) => {
    if (!key) return;
    const current = map.get(key) || emptyStat();
    current.spent += itemValue(item);
    current.units += itemQuantity(item);
    current.purchases.add(text(sale.operationId || sale.id));
    const at = saleDate(sale);
    if (at && (!current.lastAt || at > current.lastAt)) current.lastAt = at;
    map.set(key, current);
  };
  const emptyClient = (id) => ({ id, sales: [], products: new Map(), categories: new Map(), payments: [], collections: [], subscriptions: [], progress: [], redemptions: [] });
  let lastProjection = null;

  function project(data = {}, rows = [], options = {}) {
    const businessId = text(options.businessId || root.DB?.getBusinessId?.());
    const signature = options.signature || [businessId, data.clientes?.length, data.vendas?.length, data.pagamentos?.length, data.customerSubscriptions?.length, data.progressosCampanha?.length, data.resgatesCampanha?.length].join(":");
    if (options.signature && lastProjection?.data === data && lastProjection.signature === signature) return lastProjection;
    const products = new Map((data.produtos || []).filter((item) => belongsToBusiness(item, businessId)).map((item) => [text(item.id), item]));
    const campaigns = new Map((data.campanhas || []).filter((item) => belongsToBusiness(item, businessId)).map((item) => [text(item.id), root.Campanhas?.normalize?.(item) || item]));
    const byClient = new Map((data.clientes || []).filter((client) => belongsToBusiness(client, businessId)).map((client) => [text(client.id), emptyClient(text(client.id))]));
    const ensure = (id) => { if (!byClient.has(id)) byClient.set(id, emptyClient(id)); return byClient.get(id); };
    for (const row of rows || []) if (row.client?.id) ensure(text(row.client.id));
    const seenSales = new Set();
    let salesScanned = 0, itemsScanned = 0;
    for (const sale of data.vendas || []) {
      salesScanned++;
      if (!validSale(sale, businessId)) continue;
      const saleKey = text(sale.operationId || sale.idempotencyKey || sale.id);
      if (!saleKey || seenSales.has(saleKey)) continue;
      seenSales.add(saleKey);
      const id = clientIdOf(sale), target = ensure(id);
      target.sales.push(sale);
      for (const item of sale.itens || sale.items || []) {
        itemsScanned++;
        const productId = itemProductId(item), product = products.get(productId);
        const categoryId = text(item.categoryId || item.categoriaId || product?.categoryId || product?.categoriaId);
        const categoryName = normalize(item.categoryNameSnapshot || item.categoria || item.category || product?.categoria);
        addStat(target.products, productId, sale, item);
        if (categoryId) addStat(target.categories, `id:${categoryId}`, sale, item);
        if (categoryName) addStat(target.categories, `name:${categoryName}`, sale, item);
      }
    }
    const attach = (list, key) => { for (const item of list || []) { if (item.deletedAt || !belongsToBusiness(item, businessId)) continue; const id = clientIdOf(item); if (id && byClient.has(id)) ensure(id)[key].push(item); } };
    attach(data.pagamentos, "payments"); attach(data.cobrancas, "collections"); attach(data.customerSubscriptions, "subscriptions"); attach(data.progressosCampanha, "progress"); attach(data.resgatesCampanha, "redemptions");
    for (const bucket of byClient.values()) bucket.sales.sort((a, b) => saleDate(a) - saleDate(b));
    const rowById = new Map((rows || []).map((row) => [text(row.client?.id), row]));
    lastProjection = {
      version: VERSION, data, signature, businessId, byClient, rowById, products, campaigns,
      audit: { firestoreReads: 0, clientsIndexed: byClient.size, salesScanned, uniqueSales: seenSales.size, itemsScanned, strategy: "single-local-projection" },
    };
    return lastProjection;
  }

  function statForPeriod(bucket, condition, kind, subject, projection) {
    const bounds = periodBounds(condition.period || "all");
    const map = new Map();
    for (const sale of bucket.sales) {
      const at = saleDate(sale)?.getTime();
      if (at == null || at < bounds.start || at > bounds.end) continue;
      if (kind === "sales") {
        const current = map.get("all") || emptyStat();
        current.spent += saleValue(sale); current.purchases.add(text(sale.operationId || sale.id)); current.lastAt = saleDate(sale); map.set("all", current);
        continue;
      }
      for (const item of sale.itens || sale.items || []) {
        const product = projection.products.get(itemProductId(item));
        const ids = kind === "product"
          ? [itemProductId(item)]
          : [`id:${text(item.categoryId || item.categoriaId || product?.categoryId || product?.categoriaId)}`, `name:${normalize(item.categoryNameSnapshot || item.categoria || item.category || product?.categoria)}`];
        if (ids.includes(subject)) addStat(map, subject, sale, item);
      }
    }
    return map.get(kind === "sales" ? "all" : subject) || emptyStat();
  }
  function campaignTarget(campaign, progress) {
    if (!campaign) return 0;
    if (campaign.type === "points") return (campaign.rewards || []).map((reward) => number(reward.pointsCost)).filter((target) => target > number(progress?.availablePoints)).sort((a, b) => a - b)[0] || 0;
    return number(campaign.type === "nth_product" ? campaign.rule?.requiredPurchases : campaign.rule?.requiredQuantity);
  }
  function progressRatio(campaign, progress) {
    if (!campaign || !progress) return 0;
    if (number(progress.availableRewards) > 0) return 1;
    const current = number(campaign.type === "points" ? progress.availablePoints : progress.cycleRemainder ?? progress.confirmedProgress), target = campaignTarget(campaign, progress);
    return target ? Math.max(0, Math.min(1, current / target)) : 0;
  }
  const isNearReward = (campaign, progress, threshold = 0.8) => { const ratio = progressRatio(campaign, progress); return ratio >= threshold && ratio < 1; };
  const isRedeemable = (campaign, progress) => number(progress?.availableRewards) > 0 || Boolean(campaign?.type === "points" && (campaign.rewards || []).some((reward) => number(reward.pointsCost) > 0 && number(reward.pointsCost) <= number(progress?.availablePoints)));
  const isStalled = (progress, days = 15) => Boolean((number(progress?.confirmedProgress) || number(progress?.availablePoints) || number(progress?.pendingProgress) || number(progress?.pendingPoints)) && daysAgo(progress?.lastQualifiedAt || progress?.updatedAt) >= days);

  function conditionSubject(condition, type) {
    const raw = text(condition.subjectId || condition.productId || condition.categoryId || condition.campaignId || (type === "product" || type === "category" || type === "campaign" ? condition.value : ""));
    if (type === "category" && raw && !raw.startsWith("id:") && !raw.startsWith("name:")) return `name:${normalize(raw)}`;
    return raw;
  }
  function conditionValue(row, condition, projection) {
    const field = condition.field, meta = fields[field], client = row.client || {}, metric = row.metric || {}, bucket = projection.byClient.get(text(client.id)) || emptyClient(text(client.id));
    const saleStat = meta?.period ? statForPeriod(bucket, condition, "sales", null, projection) : null;
    if (field === "totalSpent") return condition.period && (condition.period.key || condition.period) !== "all" ? saleStat.spent : number(metric.totalSpent);
    if (field === "purchaseCount") return condition.period && (condition.period.key || condition.period) !== "all" ? saleStat.purchases.size : number(metric.purchaseCount);
    if (field === "averageTicket") { const count = saleStat.purchases.size; return count ? saleStat.spent / count : (condition.period && (condition.period.key || condition.period) !== "all" ? 0 : number(metric.averageTicket)); }
    if (field === "historicalPurchases") return number(metric.purchaseCount);
    if (field === "vip") return (row.classifications || []).includes("VIP") || number(metric.totalSpent) >= 1000 || number(metric.purchaseCount) >= 10;
    if (field === "lastPurchaseDays") return metric.lastPurchaseAt ? daysAgo(metric.lastPurchaseAt) : null;
    if (field === "firstPurchaseDays") return metric.firstPurchaseAt ? daysAgo(metric.firstPurchaseAt) : null;
    if (field === "lastPurchaseValue") return bucket.sales.length ? saleValue(bucket.sales.at(-1)) : 0;
    if (field === "firstPurchaseWithoutReturn") return number(metric.purchaseCount) === 1;
    if (field === "recoveredClient") return (row.classifications || []).includes("Recuperado");
    if (field === "createdDays") return daysAgo(client.criadoEm || client.createdAt);
    const productField = field === "product" ? "productPurchased" : field;
    if (productField.startsWith("product")) {
      const subject = conditionSubject(condition, "product"), stat = meta?.period ? statForPeriod(bucket, condition, "product", subject, projection) : bucket.products.get(subject) || emptyStat();
      if (productField === "productPurchased") return new Set(stat.units || stat.purchases.size ? [subject] : []);
      if (productField === "productPurchaseCount") return stat.purchases.size;
      if (productField === "productUnits") return stat.units;
      if (productField === "productSpent") return stat.spent;
      if (productField === "productLastPurchaseDays") return stat.lastAt ? daysAgo(stat.lastAt) : null;
      if (productField === "productNever") return !bucket.products.has(subject);
    }
    const categoryField = field === "category" ? "categoryPurchased" : field;
    if (categoryField.startsWith("category")) {
      const subject = conditionSubject(condition, "category"), stat = meta?.period ? statForPeriod(bucket, condition, "category", subject, projection) : bucket.categories.get(subject) || emptyStat();
      if (categoryField === "categoryPurchased") return new Set(stat.units || stat.purchases.size ? [subject] : []);
      if (categoryField === "categoryPurchaseCount") return stat.purchases.size;
      if (categoryField === "categoryUnits") return stat.units;
      if (categoryField === "categorySpent") return stat.spent;
    }
    const balance = number(client.saldo);
    if (field === "balance") return number(metric.openBalance) || Math.abs(balance);
    if (field === "balanceStatus") return balance < 0 ? "debt" : balance > 0 ? "credit" : "zero";
    if (field === "hasDebt") return balance < 0 || number(metric.openBalance) > 0;
    if (field === "debtAmount") return number(metric.openBalance) || Math.abs(Math.min(0, balance));
    if (field === "hasCredit") return balance > 0;
    if (field === "creditAmount") return Math.max(0, balance);
    if (field === "zeroBalance") return balance === 0;
    const paymentDays = bucket.payments.map((item) => daysAgo(item.data || item.createdAt)).filter(Number.isFinite);
    const collectionDays = bucket.collections.map((item) => daysAgo(item.data || item.createdAt)).filter(Number.isFinite);
    if (field === "lastPaymentDays") return paymentDays.length ? Math.min(...paymentDays) : null;
    if (field === "noPaymentDays") return paymentDays.length ? Math.min(...paymentDays) : Number.MAX_SAFE_INTEGER;
    if (field === "lastCollectionDays") return metric.lastCollectionAt ? daysAgo(metric.lastCollectionAt) : collectionDays.length ? Math.min(...collectionDays) : null;
    if (field === "noCollectionDays") return metric.lastCollectionAt ? daysAgo(metric.lastCollectionAt) : collectionDays.length ? Math.min(...collectionDays) : Number.MAX_SAFE_INTEGER;
    if (field === "settledRecently") { const bounds = periodBounds(condition.period || "30d"); return balance === 0 && bucket.payments.some((item) => { const at = dateValue(item.data || item.createdAt)?.getTime(); return at >= bounds.start && at <= bounds.end; }); }
    if (field === "overduePromise") { const promise = client.promessaPagamento, promisedAt = dateValue(promise?.data || promise?.date); return Boolean(promise && promise.status !== "cumprida" && promisedAt && promisedAt < new Date()); }
    if (field.startsWith("renewal")) {
      const active = bucket.subscriptions.filter((item) => !item.deletedAt), next = active.map((item) => ({ item, days: daysUntil(item.expiresAt || item.endDate || item.dataFim) })).filter((entry) => Number.isFinite(entry.days)).sort((a, b) => a.days - b.days)[0];
      if (field === "renewalDays") return next?.days ?? null;
      if (field === "renewalStatus") return normalize(next?.item?.status || active[0]?.status || "");
      if (field === "renewalOverdue") return active.some((item) => daysUntil(item.expiresAt || item.endDate || item.dataFim) < 0);
      if (field === "renewalOverdueDays") return Math.max(0, ...active.map((item) => -number(daysUntil(item.expiresAt || item.endDate || item.dataFim))).filter((days) => days > 0));
      if (field === "renewalMissing") return active.length === 0 || active.every((item) => ["expired", "cancelled", "canceled", "vencida", "cancelada"].includes(normalize(item.status)));
      if (field === "renewedRecently") { const bounds = periodBounds(condition.period || "30d"); return active.some((item) => { const at = dateValue(item.renewedAt || item.updatedAt || item.startedAt)?.getTime(); return at >= bounds.start && at <= bounds.end; }); }
      if (field === "renewalProduct") return new Set(active.map((item) => text(item.productId || item.produtoId)).filter(Boolean));
      if (field === "renewalVariant") return active.map((item) => text(item.variantName || item.variationName || item.planName || item.variantId || item.variationId)).filter(Boolean).join(" ");
    }
    if (field.startsWith("campaign") || ["nearReward", "availableReward", "redeemedReward", "pendingCampaignProgress", "stalledCampaign"].includes(field)) {
      const subject = ["campaign", "campaignProgress", "redeemedReward"].includes(field) ? conditionSubject(condition, "campaign") : text(condition.subjectId);
      const progress = subject ? bucket.progress.filter((item) => text(item.campaignId || item.campanhaId) === subject) : bucket.progress;
      if (field === "campaign") return new Set(bucket.progress.map((item) => text(item.campaignId || item.campanhaId)));
      if (field === "campaignProgress") return Math.max(0, ...progress.map((item) => progressRatio(projection.campaigns.get(text(item.campaignId || item.campanhaId)), item) * 100));
      if (field === "nearReward") return progress.some((item) => isNearReward(projection.campaigns.get(text(item.campaignId || item.campanhaId)), item));
      if (field === "availableReward") return progress.some((item) => isRedeemable(projection.campaigns.get(text(item.campaignId || item.campanhaId)), item));
      if (field === "redeemedReward") return subject ? bucket.redemptions.some((item) => text(item.campaignId || item.campanhaId) === subject) : bucket.redemptions.length > 0;
      if (field === "pendingCampaignProgress") return progress.some((item) => number(item.pendingProgress) > 0 || number(item.pendingPoints) > 0);
      if (field === "stalledCampaign") return progress.some((item) => isStalled(item, number(condition.value || 15)));
    }
    if (field === "clientName") return client.nome;
    if (field === "city") return client.cidade;
    if (field === "neighborhood") return client.bairro;
    if (field === "tag") return (client.etiquetas || []).join(" ");
    if (field === "hasPhone" || field === "hasWhatsapp") return String(client.telefone || "").replace(/\D/g, "").length >= 10;
    if (field === "hasEmail") return String(client.email || "").includes("@");
    if (field === "acceptsMarketing") return client.marketingConsent === true;
    if (field === "birthdayThisMonth") { const birthday = dateValue(client.dataNascimento || client.aniversario); return Boolean(birthday && birthday.getMonth() === new Date().getMonth()); }
    return null;
  }
  function compare(actual, operator, expected, secondary) {
    if (operator === "has") return actual instanceof Set ? actual.has(text(expected)) || actual.has(normalize(expected)) : Boolean(actual);
    if (operator === "not_has") return !compare(actual, "has", expected, secondary);
    if (operator === "contains") return normalize(actual).includes(normalize(expected));
    if (operator === "not_contains") return !compare(actual, "contains", expected, secondary);
    if (operator === "between") return number(actual) >= number(expected) && number(actual) <= number(secondary);
    if (operator === "eq") return typeof actual === "boolean" ? actual === (expected === true || String(expected) === "true") : String(actual) === String(expected);
    if (operator === "neq") return !compare(actual, "eq", expected, secondary);
    if (operator === "gt") return actual != null && number(actual) > number(expected);
    if (operator === "gte") return actual != null && number(actual) >= number(expected);
    if (operator === "lt") return actual != null && number(actual) < number(expected);
    if (operator === "lte") return actual != null && number(actual) <= number(expected);
    if (operator === "before") return dateValue(actual) < dateValue(expected);
    if (operator === "after") return dateValue(actual) > dateValue(expected);
    return false;
  }
  function normalizeCondition(condition = {}) {
    const field = fields[condition.field] ? condition.field : "lastPurchaseDays", meta = fields[field];
    const operator = meta.operators.includes(condition.operator) ? condition.operator : meta.operators[0];
    const period = meta.period ? (typeof condition.period === "string" ? { key: condition.period } : { key: condition.period?.key || condition.period?.preset || "all", start: condition.period?.start || "", end: condition.period?.end || "" }) : null;
    return { id: text(condition.id) || root.crypto?.randomUUID?.() || `condition-${Date.now()}-${Math.random()}`, field, operator, subjectId: text(condition.subjectId || condition.productId || condition.categoryId || condition.campaignId), value: condition.value ?? (meta.type === "boolean" ? true : ""), valueTo: condition.valueTo ?? "", period };
  }
  const validConditions = (conditions) => (conditions || []).map(normalizeCondition).filter((condition) => fields[condition.field]?.operators.includes(condition.operator));
  function evaluate(rows = [], conditions = [], matchMode = "all", data = {}, options = {}) {
    const businessId = text(options.businessId || root.DB?.getBusinessId?.());
    const scopedRows = (rows || []).filter((row) => belongsToBusiness(row.client || {}, businessId));
    const safe = validConditions(conditions), projection = options.projection || project(data, scopedRows, { ...options, businessId });
    if (!safe.length) return { rows: [...scopedRows], clientIds: scopedRows.map((row) => text(row.client?.id)), projection, conditions: safe, matchMode: matchMode === "any" ? "any" : "all" };
    const mode = matchMode === "any" ? "any" : "all";
    const selected = scopedRows.filter((row) => {
      const checks = safe.map((condition) => {
        const meta = fields[condition.field], relationType = /^(product|category|campaign)/.exec(meta.type)?.[1];
        const expected = ["has", "not_has"].includes(condition.operator) && relationType ? conditionSubject(condition, relationType) : condition.value;
        return compare(conditionValue(row, condition, projection), condition.operator, expected, condition.valueTo);
      });
      return mode === "any" ? checks.some(Boolean) : checks.every(Boolean);
    });
    return { rows: selected, clientIds: selected.map((row) => text(row.client?.id)), projection, conditions: safe, matchMode: mode };
  }
  function describeCondition(condition, data = {}) {
    const safe = normalizeCondition(condition), meta = fields[safe.field], product = (data.produtos || []).find((item) => text(item.id) === safe.subjectId), campaign = (data.campanhas || []).find((item) => text(item.id) === safe.subjectId);
    const subject = product?.nome || campaign?.name || campaign?.nome || safe.subjectId;
    const value = ["product", "category", "campaign"].some((kind) => meta.type.startsWith(kind)) ? subject : safe.value;
    const period = safe.period && safe.period.key !== "all" ? periods.find(([key]) => key === safe.period.key)?.[1] : "";
    return [meta.label, operators[safe.operator], value, safe.operator === "between" ? `e ${safe.valueTo}` : "", period].filter(Boolean).join(" · ");
  }
  function audienceSnapshot(input = {}) {
    const conditions = validConditions(input.conditions || []), now = new Date().toISOString();
    return {
      sourceType: "crmSegment", sourceSegmentId: input.segmentId || null, sourceSegmentName: input.segmentName || input.name || "Filtro do CRM",
      sourceConditionsSnapshot: conditions, sourceMatchMode: input.matchMode === "any" ? "any" : "all",
      audienceCountAtCreation: (input.clientIds || []).length, clientIds: [...new Set((input.clientIds || []).map(String))],
      businessId: input.businessId || root.DB?.getBusinessId?.() || "", capturedAt: input.capturedAt || now,
      summaries: conditions.slice(0, 4).map((condition) => describeCondition(condition, input.data || root.DB?.carregar?.() || {})),
    };
  }

  return Object.freeze({ VERSION, DAY, groups, fields, operators, periods, normalizeCondition, validConditions, periodBounds, project, evaluate, compare, conditionValue, describeCondition, audienceSnapshot, progressRatio, isNearReward, isRedeemable, isStalled, daysAgo, daysUntil });
});
