((root, factory) => {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.CustomerMetricsService = api;
})(typeof globalThis !== "undefined" ? globalThis : this, () => {
  "use strict";

  const DAY = 86400000;
  const INVALID_SALE_STATUSES = new Set([
    "cancelado",
    "cancelada",
    "cancelled",
    "canceled",
    "desfeito",
    "desfeita",
    "venda_desfeita",
    "estornado",
    "estornada",
    "refunded",
  ]);

  const number = (value) => {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  };
  const text = (value) => String(value ?? "").trim();
  const normalize = (value) =>
    text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const lexical = (left, right) =>
    text(left).localeCompare(text(right), "pt-BR", { sensitivity: "base" });

  function dateValue(value) {
    if (!value) return null;
    if (typeof value?.toDate === "function") value = value.toDate();
    else if (typeof value === "object" && Number.isFinite(value.seconds))
      value = new Date(value.seconds * 1000 + number(value.nanoseconds) / 1000000);
    const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function iso(value) {
    return dateValue(value)?.toISOString() || null;
  }

  function brazilDayNumber(value) {
    const date = dateValue(value);
    if (!date) return null;
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Sao_Paulo",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type) => Number(parts.find((item) => item.type === type)?.value);
    return Date.UTC(part("year"), part("month") - 1, part("day")) / DAY;
  }

  function daysBetween(left, right) {
    const start = brazilDayNumber(left),
      end = brazilDayNumber(right);
    return start == null || end == null ? null : Math.max(0, end - start);
  }

  function saleClientId(sale = {}) {
    return text(sale.clienteId || sale.clientId || sale.customerId);
  }

  function saleDate(sale = {}) {
    return iso(sale.data || sale.createdAt || sale.criadoEm);
  }

  function saleValue(sale = {}) {
    return number(sale.valorFinal ?? sale.valorTotal ?? sale.total ?? sale.amount);
  }

  function isValidSale(sale, options = {}) {
    if (!sale || sale.deletedAt || sale.active === false || sale.ativo === false) return false;
    const status = normalize(sale.status || sale.saleStatus || sale.tipo);
    if (INVALID_SALE_STATUSES.has(status)) return false;
    const clientId = saleClientId(sale);
    if (!clientId || !saleDate(sale)) return false;
    const businessId = text(options.businessId);
    return !businessId || !sale.businessId || text(sale.businessId) === businessId;
  }

  function itemProductId(item = {}) {
    return text(item.produtoId || item.productId);
  }

  function itemQuantity(item = {}) {
    return number(item.quantidade ?? item.quantity);
  }

  function itemValue(item = {}) {
    const explicit = item.subtotalFinal ?? item.subtotal ?? item.total;
    return explicit == null
      ? itemQuantity(item) * number(item.precoFinalUnitario ?? item.precoUnitario ?? item.unitPriceSnapshot)
      : number(explicit);
  }

  function legacyAggregateIsAuthoritative(client = {}) {
    const source = normalize(client.origemCadastro || client.source || client.importSource);
    return /^kyte(?:-|_)/i.test(text(client.id)) || source.includes("kyte") || client.crmAggregateSource === "legacy_import";
  }

  function deterministicRank(left, right) {
    return (
      right.quantidade - left.quantidade ||
      right.valor - left.valor ||
      lexical(left.id || left.nome, right.id || right.nome)
    );
  }

  function build(data = {}, options = {}) {
    const clients = data.clientes || [],
      products = new Map((data.produtos || []).map((item) => [text(item.id), item])),
      cached = new Map((data.metricasClientes || []).map((item) => [text(item.id || item.clientId), item])),
      uniqueSales = new Map();
    for (const sale of data.vendas || []) {
      if (!isValidSale(sale, options)) continue;
      const key = text(sale.operationId || sale.idempotencyKey || sale.sourceOperationId || sale.id);
      if (!key) continue;
      const current = uniqueSales.get(key),
        currentRevision = dateValue(current?.updatedAt || current?.atualizadoEm || saleDate(current || {}))?.getTime() || 0,
        nextRevision = dateValue(sale.updatedAt || sale.atualizadoEm || saleDate(sale))?.getTime() || 0;
      if (!current || nextRevision >= currentRevision) uniqueSales.set(key, sale);
    }
    const sales = [...uniqueSales.values()]
        .sort((left, right) => dateValue(saleDate(left)) - dateValue(saleDate(right)) || lexical(left.id, right.id)),
      salesByClient = new Map();

    for (const sale of sales) {
      const clientId = saleClientId(sale);
      if (!salesByClient.has(clientId)) salesByClient.set(clientId, []);
      salesByClient.get(clientId).push(sale);
    }

    const contactDates = new Map();
    for (const item of [...(data.contatosCliente || []), ...(data.messageHistory || [])]) {
      const clientId = text(item.clienteId || item.clientId || item.customerId),
        value = iso(item.data || item.openedWhatsAppAt || item.createdAt);
      if (clientId && value && (!contactDates.has(clientId) || value > contactDates.get(clientId)))
        contactDates.set(clientId, value);
    }
    const rewards = new Map();
    for (const item of data.progressosCampanha || []) {
      const clientId = text(item.clienteId || item.clientId || item.customerId);
      if (clientId)
        rewards.set(
          clientId,
          number(rewards.get(clientId)) + number(item.availableRewards ?? item.recompensasDisponiveis),
        );
    }

    const byClient = new Map();
    for (const client of clients) {
      const clientId = text(client.id),
        clientSales = salesByClient.get(clientId) || [],
        previous = cached.get(clientId) || {},
        productTotals = new Map(),
        categoryTotals = new Map();

      for (const sale of clientSales)
        for (const item of sale.itens || sale.items || []) {
          const productId = itemProductId(item),
            product = products.get(productId),
            name = text(item.productNameSnapshot || item.nome || item.name || product?.nome) || "Produto",
            categoryId = text(item.categoryId || item.categoriaId || product?.categoryId || product?.categoriaId),
            categoryName = text(item.categoryNameSnapshot || item.categoria || item.category || product?.categoria) || "Sem categoria",
            key = productId || `name:${normalize(name)}`,
            quantity = itemQuantity(item),
            value = itemValue(item),
            current = productTotals.get(key) || {
              id: key,
              produtoId: productId || null,
              nome: name,
              categoria: categoryName,
              categoriaId: categoryId || null,
              quantidade: 0,
              valor: 0,
              ultimaCompra: null,
              variacoes: {},
            };
          current.quantidade += quantity;
          current.valor += value;
          if (saleDate(sale) > (current.ultimaCompra || "")) current.ultimaCompra = saleDate(sale);
          if (item.variantId) {
            const variantId = text(item.variantId),
              variant = current.variacoes[variantId] || {
                variantId,
                nome: text(item.variantNameSnapshot) || "Variação",
                atributos: item.attributesSnapshot || {},
                quantidade: 0,
                valor: 0,
              };
            variant.quantidade += quantity;
            variant.valor += value;
            current.variacoes[variantId] = variant;
          }
          productTotals.set(key, current);
          const categoryKey = categoryId || `name:${normalize(categoryName)}`,
            category = categoryTotals.get(categoryKey) || {
              id: categoryKey,
              categoriaId: categoryId || null,
              nome: categoryName,
              quantidade: 0,
              valor: 0,
            };
          category.quantidade += quantity;
          category.valor += value;
          categoryTotals.set(categoryKey, category);
        }

      const rankedProducts = [...productTotals.values()]
          .map((item) => {
            const variants = Object.values(item.variacoes).sort(deterministicRank);
            return { ...item, variacoes: variants, variacaoFavorita: variants[0] || null };
          })
          .sort(deterministicRank),
        rankedCategories = [...categoryTotals.values()].sort(deterministicRank),
        computedTotal = clientSales.reduce((sum, sale) => sum + saleValue(sale), 0),
        computedCount = clientSales.length,
        legacy = legacyAggregateIsAuthoritative(client),
        storedTotal = number(client.totalComprado ?? previous.totalSpent),
        storedCount = number(client.quantidadeVendas ?? previous.purchaseCount),
        totalSpent = legacy ? Math.max(computedTotal, storedTotal) : computedCount ? computedTotal : storedTotal,
        purchaseCount = legacy ? Math.max(computedCount, storedCount) : computedCount || storedCount,
        dates = clientSales.map(saleDate).filter(Boolean),
        firstCandidates = [dates[0], previous.firstPurchaseAt].filter(Boolean).sort(),
        lastCandidates = [dates.at(-1), client.ultimaCompra, previous.lastPurchaseAt].map(iso).filter(Boolean).sort(),
        intervals = [];
      for (let index = 1; index < dates.length; index++) {
        const interval = daysBetween(dates[index - 1], dates[index]);
        if (interval != null) intervals.push(interval);
      }
      const firstPurchaseAt = firstCandidates[0] || null,
        lastPurchaseAt = lastCandidates.at(-1) || null,
        daysSinceLastPurchase = lastPurchaseAt
          ? daysBetween(lastPurchaseAt, options.now || new Date())
          : null,
        favoriteProduct = rankedProducts[0] || null,
        favoriteCategory = rankedCategories[0] || null;
      byClient.set(clientId, {
        id: clientId,
        client,
        sales: clientSales,
        products: rankedProducts,
        categories: rankedCategories,
        totalSpent,
        purchaseCount,
        averageTicket: purchaseCount ? totalSpent / purchaseCount : 0,
        firstPurchaseAt,
        lastPurchaseAt,
        daysSinceLastPurchase,
        averagePurchaseIntervalDays: intervals.length
          ? intervals.reduce((sum, value) => sum + value, 0) / intervals.length
          : null,
        largestPurchase: Math.max(
          0,
          ...clientSales.map(saleValue),
          number(previous.largestPurchase),
        ),
        favoriteProductId: favoriteProduct?.produtoId || null,
        favoriteProductName: favoriteProduct?.nome || previous.favoriteProductName || "Sem dados",
        favoriteCategoryId: favoriteCategory?.categoriaId || null,
        favoriteCategoryName: favoriteCategory?.nome || previous.favoriteCategoryName || previous.favoriteCategoryId || "Sem dados",
        lastContactAt: contactDates.get(clientId) || previous.lastContactAt || null,
        lastCollectionAt: iso(client.lastChargeAt || previous.lastCollectionAt),
        openBalance: Math.abs(Math.min(0, number(client.saldo))),
        currentPoints: number(previous.currentPoints),
        availableRewards: Math.max(number(previous.availableRewards), number(rewards.get(clientId))),
        source: legacy && storedCount > computedCount ? "legacy-plus-sales" : computedCount ? "valid-sales" : "stored-aggregate",
      });
    }

    function period(start, end) {
      const startTime = dateValue(start)?.getTime() ?? -Infinity,
        endTime = dateValue(end)?.getTime() ?? Infinity,
        rows = new Map();
      for (const [clientId, metric] of byClient) {
        const selected = metric.sales.filter((sale) => {
          const time = dateValue(saleDate(sale))?.getTime();
          return time != null && time >= startTime && time <= endTime;
        });
        const productsInPeriod = new Set(),
          categoriesInPeriod = new Set();
        for (const sale of selected)
          for (const item of sale.itens || sale.items || []) {
            const productId = itemProductId(item),
              product = products.get(productId),
              categoryId = text(item.categoryId || item.categoriaId || product?.categoryId || product?.categoriaId),
              categoryName = text(item.categoryNameSnapshot || item.categoria || item.category || product?.categoria);
            if (productId) productsInPeriod.add(productId);
            if (categoryId) categoriesInPeriod.add(normalize(categoryId));
            if (categoryName) categoriesInPeriod.add(normalize(categoryName));
          }
        const previous = metric.sales.filter((sale) => dateValue(saleDate(sale)).getTime() < startTime).at(-1);
        rows.set(clientId, {
          spent: selected.reduce((sum, sale) => sum + saleValue(sale), 0),
          purchases: selected.length,
          products: productsInPeriod,
          categories: categoriesInPeriod,
          firstPurchase: Boolean(
            metric.firstPurchaseAt &&
              dateValue(metric.firstPurchaseAt).getTime() >= startTime &&
              dateValue(metric.firstPurchaseAt).getTime() <= endTime,
          ),
          previousPurchaseAt: previous ? saleDate(previous) : null,
        });
      }
      return rows;
    }

    return { byClient, sales, period, businessId: text(options.businessId) };
  }

  return Object.freeze({
    DAY,
    INVALID_SALE_STATUSES,
    build,
    dateValue,
    daysBetween,
    isValidSale,
    itemProductId,
    saleClientId,
    saleDate,
    saleValue,
  });
});
