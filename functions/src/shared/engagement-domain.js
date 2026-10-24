'use strict';
// GENERATED: same pure domain functions as the V2 consumer. No eval/runtime fetch.
module.exports=function engagementDomain(data,{businessId,uid,uuid,at}={}){
 const NativeDate=globalThis.Date;
 const Date=class extends NativeDate{constructor(...args){super(...(args.length?args:[at||NativeDate.now()]));}static now(){return at?new NativeDate(at).getTime():NativeDate.now();}};
 const window={FirebaseSession:{businessId,user:{uid}},crypto:{randomUUID:uuid}},DB={getBusinessId:()=>businessId,carregar:()=>data,alterar:fn=>fn(data)},Utils={uuid};
 const structuredClone=globalThis.structuredClone;
(function () {
  "use strict";
  const loadedParents = new Set();
  const num = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const text = (value) => String(value ?? "").trim();
  const normalize = (value) =>
    text(value)
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();
  const now = () => new Date().toISOString();
  const uuid = () => window.Utils?.uuid?.() || crypto.randomUUID();
  const isVariable = (product) => product?.productType === "variable" || (product?.productType === "recurring" && product?.hasVariations === true);
  const itemKey = (item) =>
    item?.variantId
      ? `${item.produtoId}::${item.variantId}`
      : String(item?.produtoId || "");
  const list = (parentProductId, data = DB.carregar()) =>
    (data.variacoesProdutos || []).filter(
      (item) => !parentProductId || item.parentProductId === parentProductId,
    );
  const active = (parentProductId, data = DB.carregar()) =>
    list(parentProductId, data).filter((item) => item.active !== false);
  async function ensure(parentProductId, options = {}) {
    const parentId = text(parentProductId);
    if (!parentId) return [];
    const force = Boolean(options.force);
    if (!force && loadedParents.has(parentId)) return active(parentId);
    if (!navigator.onLine || !window.SyncFirebase?.loadProductVariants)
      return active(parentId);
    try {
      await window.SyncFirebase.loadProductVariants(parentId, { force });
      loadedParents.add(parentId);
    } catch (error) {
      console.warn("[Product Variations] carga sob demanda indisponível", {
        parentProductId: parentId,
        code: error?.code || "unknown",
      });
    }
    return active(parentId);
  }
  const get = (id, data = DB.carregar()) =>
    (data.variacoesProdutos || []).find((item) => item.id === id) || null;
  const parent = (variant, data = DB.carregar()) =>
    (data.produtos || []).find(
      (item) => item.id === variant?.parentProductId,
    ) || null;
  const displayName = (variant) =>
    text(variant?.displayName) ||
    Object.values(variant?.attributeValues || {})
      .filter(Boolean)
      .join(" / ") ||
    "Variação";
  const recomputeInData = (data, parentProductId, { stockOnly = false } = {}) => {
    const product = (data.produtos || []).find(
      (item) => item.id === parentProductId,
    );
    if (!product || !isVariable(product)) return product || null;
    const variants = active(parentProductId, data),
      prices = variants.map((item) => num(item.price)),
      stock = variants.reduce((sum, item) => sum + num(item.stock), 0);
    product.totalStock = stock;
    product.estoqueAtual = stock;
    product.estoque = stock;
    // Selling/undoing stock must not edit catalog identity, prices or search
    // indexes (variant query order is not stable across reloads).
    if (!stockOnly) {
      product.activeVariationCount = variants.length;
      product.minPrice = prices.length ? Math.min(...prices) : 0;
      product.maxPrice = prices.length ? Math.max(...prices) : 0;
      product.preco = product.minPrice;
      product.variationSearchTokens = [
        ...new Set(
          variants.flatMap((item) => [
            displayName(item),
            item.sku,
            item.barcode,
            ...Object.values(item.attributeValues || {}),
          ]),
        ),
      ].filter(Boolean);
      product.schemaVersion = Math.max(14, num(product.schemaVersion));
    }
    const controlsStock =
      product.itemKind !== "service" &&
      !product.semControleEstoque &&
      product.controlaEstoque !== false;
    product.hasAvailableStock =
      !controlsStock ||
      variants.some((item) => item.allowNegativeStock || num(item.stock) > 0);
    product.updatedAt = now();
    return product;
  };
  const recompute = (parentProductId) => {
    let result;
    DB.alterar((data) => {
      result = recomputeInData(data, parentProductId);
    });
    return result;
  };
  const duplicateBarcode = (data, barcode, ignoreVariantId = "") => {
    const code =
      window.normalizeBarcode?.(barcode) || text(barcode).replace(/\s/g, "");
    if (!code) return null;
    const product = (data.produtos || []).find(
      (item) =>
        item.ativo !== false &&
        (window.normalizeBarcode?.(item.barcode) || text(item.barcode)) ===
          code,
    );
    if (product) return { type: "product", item: product };
    const variant = (data.variacoesProdutos || []).find(
      (item) =>
        item.id !== ignoreVariantId &&
        item.active !== false &&
        (window.normalizeBarcode?.(item.barcode) || text(item.barcode)) ===
          code,
    );
    return variant ? { type: "variant", item: variant } : null;
  };
  const normalizeVariant = (raw, product, existing = null) => {
    const timestamp = now(),
      barcode =
        window.normalizeBarcode?.(raw.barcode ?? existing?.barcode) ||
        text(raw.barcode ?? existing?.barcode).replace(/\s/g, "");
    return {
      ...(existing || {}),
      id: raw.id || existing?.id || uuid(),
      parentProductId: product.id,
      businessId: DB.getBusinessId?.() || "",
      attributeValues:
        raw.attributeValues && typeof raw.attributeValues === "object"
          ? raw.attributeValues
          : existing?.attributeValues || {},
      displayName: displayName(raw) || displayName(existing),
      sku: text(raw.sku ?? existing?.sku),
      barcode,
      price: num(raw.price ?? raw.preco ?? existing?.price),
      cost:
        raw.cost === "" || raw.cost === null
          ? null
          : num(raw.cost ?? raw.custo ?? existing?.cost),
      stock: num(raw.stock ?? raw.estoque ?? existing?.stock),
      minStock: num(raw.minStock ?? raw.estoqueMinimo ?? existing?.minStock),
      active: raw.active !== false,
      catalogVisible: raw.catalogVisible !== false,
      allowNegativeStock: Boolean(
        raw.allowNegativeStock ?? existing?.allowNegativeStock,
      ),
      durationValue: product?.productType === "recurring" ? Math.max(1, num(raw.durationValue ?? existing?.durationValue ?? product.durationValue ?? 30)) : null,
      durationUnit: product?.productType === "recurring" && ["days", "weeks", "months", "years"].includes(raw.durationUnit ?? existing?.durationUnit ?? product.durationUnit) ? (raw.durationUnit ?? existing?.durationUnit ?? product.durationUnit) : (product?.productType === "recurring" ? "days" : null),
      image:
        raw.image !== undefined
          ? raw.image
          : existing?.image && typeof existing.image === "object"
            ? existing.image
            : null,
      imageMode:
        raw.imageMode ||
        existing?.imageMode ||
        (raw.imageUrl || existing?.imageUrl ? "own" : "inherit"),
      imageUrl: raw.imageUrl ?? existing?.imageUrl ?? null,
      imageStoragePath:
        raw.imageStoragePath ?? existing?.imageStoragePath ?? null,
      imageThumbUrl: raw.imageThumbUrl ?? existing?.imageThumbUrl ?? null,
      imageThumbStoragePath:
        raw.imageThumbStoragePath ?? existing?.imageThumbStoragePath ?? null,
      imageUpdatedAt: raw.imageUpdatedAt ?? existing?.imageUpdatedAt ?? null,
      imageUploadStatus:
        raw.imageUploadStatus ?? existing?.imageUploadStatus ?? "none",
      imageOperationId:
        raw.imageOperationId ?? existing?.imageOperationId ?? null,
      createdAt: existing?.createdAt || raw.createdAt || timestamp,
      updatedAt: timestamp,
      schemaVersion: 13,
    };
  };
  function save(raw) {
    let saved;
    DB.alterar((data) => {
      const product = (data.produtos || []).find(
        (item) => item.id === raw.parentProductId,
      );
      if (!product || !isVariable(product))
        throw Error("Produto pai variável não encontrado.");
      const existing =
          (data.variacoesProdutos || []).find((item) => item.id === raw.id) ||
          null,
        next = normalizeVariant(raw, product, existing),
        conflict = duplicateBarcode(data, next.barcode, next.id);
      if (conflict) {
        const error = Error(
          `O código já está vinculado a ${conflict.type === "product" ? "um produto" : "outra variação"}.`,
        );
        error.code = "barcode-duplicate";
        throw error;
      }
      data.variacoesProdutos ??= [];
      const controlsStock = product.itemKind !== "service" &&
          !product.semControleEstoque && product.controlaEstoque !== false,
        stockChanged = controlsStock && existing && num(existing.stock) !== num(next.stock),
        previousStock = existing ? num(existing.stock) : 0;
      if (!controlsStock) {
        next.stock = existing ? num(existing.stock) : 0;
        next.minStock = existing ? num(existing.minStock) : 0;
        next.allowNegativeStock = false;
      }
      if (!existing && controlsStock && num(next.stock)>0)
        window.SpaceContext?.stockMovementOrigin?.(product);
      if (existing) Object.assign(existing, next);
      else data.variacoesProdutos.push(next);
      saved = existing || next;
      if (stockChanged) {
        data.movimentacoesEstoque ??= [];
        data.movimentacoesEstoque.push({
          id: uuid(),
          operationId: uuid(),
          parentProductId: product.id,
          produtoId: product.id,
          variantId: next.id,
          produtoNome: product.nome || "",
          variantName: displayName(next),
          tipo: "ajuste",
          quantidade: num(next.stock) - previousStock,
          estoqueAnterior: previousStock,
          estoqueNovo: num(next.stock),
          custoUnitario: next.cost,
          observacao:
            text(raw.stockAdjustmentReason) || "Edição manual da variação",
          vendaId: null,
          data: now(),
        });
      }
      recomputeInData(data, product.id);
    });
    window.BarcodeIndex?.invalidate?.();
    return saved;
  }
  function createProduct({ product, attributes = [], variants = [] }) {
    const itemKind = product.itemKind === "service" ? "service" : "product",
      controlsStock =
        itemKind !== "service" &&
        !product.semControleEstoque &&
        product.controlaEstoque !== false;
    if(controlsStock&&variants.some(v=>num(v.stock)>0))
      window.SpaceContext?.stockMovementOrigin?.(product);
    let created;
    DB.alterar((data) => {
      const timestamp = now(),
        id = product.id || uuid();
      if ((data.produtos || []).some((item) => item.id === id))
        throw Error("Já existe um produto com este identificador.");
      created = {
        ...product,
        id,
        nome: text(product.nome),
        itemKind,
        productType: product.productType === "recurring" ? "recurring" : "variable",
        hasVariations: true,
        semControleEstoque: !controlsStock,
        controlaEstoque: controlsStock,
        attributes: attributes.map((attribute, index) => ({
          id: text(attribute.id) || `attr_${index + 1}`,
          name: text(attribute.name) || `Atributo ${index + 1}`,
          values: [
            ...new Set((attribute.values || []).map(text).filter(Boolean)),
          ],
        })),
        preco: 0,
        minPrice: 0,
        maxPrice: 0,
        estoque: 0,
        estoqueAtual: 0,
        totalStock: 0,
        activeVariationCount: 0,
        hasAvailableStock: false,
        ativo: product.ativo !== false,
        favorito: Boolean(product.favorito),
        criadoEm: timestamp,
        atualizadoEm: timestamp,
        schemaVersion: 14,
      };
      data.produtos.push(created);
      data.variacoesProdutos ??= [];
      for (const raw of variants) {
        const next = normalizeVariant(raw, created);
        const conflict = duplicateBarcode(data, next.barcode, next.id);
        if (conflict)
          throw Error(`Código duplicado na variação ${displayName(next)}.`);
        data.variacoesProdutos.push(next);
      }
      recomputeInData(data, id);
    });
    window.BarcodeIndex?.invalidate?.();
    return created;
  }
  function combinations(attributes = []) {
    const clean = attributes
      .filter((item) => item?.name && (item.values || []).length)
      .map((item, index) => ({
        id: text(item.id) || `attr_${index + 1}`,
        name: text(item.name),
        values: [...new Set(item.values.map(text).filter(Boolean))],
      }));
    return clean
      .reduce(
        (rows, attribute) =>
          rows.flatMap((row) =>
            attribute.values.map((value) => ({
              ...row,
              [attribute.id]: value,
            })),
          ),
        [{}],
      )
      .map((values) => ({
        attributeValues: values,
        displayName: Object.values(values).join(" / "),
      }));
  }
  function stockChange({
    parentProductId,
    variantId,
    quantity,
    newStock,
    type = "entrada",
    costUnitario = null,
    observation = "",
    saleId = null,
    operationId = uuid(),
    spaceId = '',
  }) {
    let movement;
    DB.alterar((data) => {
      if (
        (data.movimentacoesEstoque || []).some(
          (item) =>
            item.operationId === operationId && item.variantId === variantId,
        )
      ) {
        movement = data.movimentacoesEstoque.find(
          (item) =>
            item.operationId === operationId && item.variantId === variantId,
        );
        return;
      }
      const variant = get(variantId, data);
      if (!variant || variant.parentProductId !== parentProductId)
        throw Error("Variação não encontrada.");
      const product = parent(variant, data);
      const sale = saleId ? (data.vendas || []).find(item => item.id === saleId) : null;
      if (sale?.spaceId && spaceId && sale.spaceId !== spaceId)
        throw Error('A movimentação deve pertencer ao espaço da venda.');
      const origin = window.SpaceContext?.stockMovementOrigin?.(product, spaceId || sale?.spaceId || '');
      if (
        product?.itemKind === "service" ||
        product?.semControleEstoque ||
        product?.controlaEstoque === false
      )
        throw Error("Este produto não usa controle de estoque.");
      const previous = num(variant.stock),
        next =
          newStock === undefined ? previous + num(quantity) : num(newStock);
      if (next < 0 && !variant.allowNegativeStock) {
        const error = Error("Estoque insuficiente para esta variação.");
        error.code = "stock-insufficient";
        throw error;
      }
      variant.stock = next;
      variant.updatedAt = now();
      if (
        costUnitario !== "" &&
        costUnitario !== null &&
        costUnitario !== undefined
      )
        variant.cost = num(costUnitario);
      movement = {
        id: uuid(),
        operationId,
        parentProductId,
        produtoId: parentProductId,
        variantId,
        produtoNome: product?.nome || "",
        variantName: displayName(variant),
        tipo: type,
        quantidade: next - previous,
        estoqueAnterior: previous,
        estoqueNovo: next,
        custoUnitario:
          costUnitario === "" || costUnitario === null
            ? null
            : num(costUnitario),
        observacao: observation || "",
        vendaId: saleId || null,
        data: now(),
        ...(origin || {}),
        ...(window.TeamAccess?.actor?.() || {}),
      };
      data.movimentacoesEstoque.push(movement);
      recomputeInData(data, parentProductId, {stockOnly:true});
    });
    return movement;
  }
  function remove(id) {
    let removed = false;
    DB.alterar((data) => {
      const variant = get(id, data);
      if (!variant) return;
      const sold = (data.vendas || []).some((sale) =>
        (sale.itens || []).some((item) => item.variantId === id),
      );
      if (sold) {
        variant.active = false;
        variant.catalogVisible = false;
        variant.updatedAt = now();
      } else {
        data.variacoesProdutos = data.variacoesProdutos.filter(
          (item) => item.id !== id,
        );
        removed = true;
      }
      recomputeInData(data, variant.parentProductId);
    });
    window.BarcodeIndex?.invalidate?.();
    return { removed, deactivated: !removed };
  }
  function search(query, data = DB.carregar()) {
    const q = normalize(query),
      barcode = window.normalizeBarcode?.(query) || "";
    if (!q && !barcode) return [];
    const matches = new Map();
    for (const variant of data.variacoesProdutos || []) {
      if (variant.active === false) continue;
      const hay = normalize(
        [
          variant.displayName,
          variant.sku,
          variant.barcode,
          ...Object.keys(variant.attributeValues || {}),
          ...Object.values(variant.attributeValues || {}),
        ].join(" "),
      );
      if ((barcode && variant.barcode === barcode) || hay.includes(q)) {
        const product = parent(variant, data);
        if (product && !matches.has(product.id))
          matches.set(product.id, {
            product,
            variant,
            match: `Variação encontrada: ${displayName(variant)}`,
          });
      }
    }
    return [...matches.values()];
  }
  function findBarcode(code, data = DB.carregar()) {
    const normalized =
      window.normalizeBarcode?.(code) || text(code).replace(/\s/g, "");
    if (!normalized) return null;
    const variants = (data.variacoesProdutos || []).filter(
      (item) => item.active !== false && item.barcode === normalized,
    );
    if (variants.length > 1) return { conflict: true, variants };
    if (variants.length === 1)
      return { variant: variants[0], product: parent(variants[0], data) };
    const products = (data.produtos || []).filter(
      (item) => item.ativo !== false && item.barcode === normalized,
    );
    return products.length > 1
      ? { conflict: true, products }
      : products.length
        ? { product: products[0] }
        : null;
  }
  function saleItem(product, variant, quantity = 1) {
    return {
      produtoId: product.id,
      productId: product.id,
      variantId: variant?.id || null,
      nome: variant
        ? `${product.nome} — ${displayName(variant)}`
        : product.nome,
      productNameSnapshot: product.nome,
      itemKind: product.itemKind === "service" ? "service" : "product",
      productType: product.productType || "simple",
      variantNameSnapshot: variant ? displayName(variant) : null,
      attributesSnapshot: variant
        ? structuredClone(variant.attributeValues || {})
        : null,
      sku: variant?.sku || product.codigo || "",
      barcode: variant?.barcode || product.barcode || "",
      quantidade: num(quantity),
      quantity: num(quantity),
      precoOriginal: num(variant?.price ?? product.preco),
      precoFinalUnitario: num(variant?.price ?? product.preco),
      custoUnitario: num(variant?.cost ?? product.custo),
      unitPriceSnapshot: num(variant?.price ?? product.preco),
      costSnapshot: num(variant?.cost ?? product.custo),
      productImage:
        window.getProductDisplayImage?.(product, variant)?.url ||
        variant?.imageThumbUrl ||
        variant?.imageUrl ||
        product.imageThumbUrl ||
        product.imageUrl ||
        product.imagem ||
        "",
    };
  }
  window.ProductVariations = {
    isVariable,
    itemKey,
    list,
    active,
    ensure,
    get,
    parent,
    displayName,
    recompute,
    recomputeInData,
    save,
    createProduct,
    combinations,
    stockChange,
    remove,
    search,
    findBarcode,
    saleItem,
    duplicateBarcode,
  };
})();

(function (root) {
  "use strict";

  const VERSION = 2;
  const TYPES = Object.freeze({
    buy_get: {
      label: "Compre e ganhe",
      icon: "shopping-cart",
      description: "Compre uma quantidade e ganhe uma recompensa.",
      goodFor: "aumentar giro e recorrência",
    },
    points: {
      label: "Programa de pontos",
      icon: "award",
      description: "Transforme compras em pontos e recompensas.",
      goodFor: "fidelizar clientes",
    },
    quantity_discount: {
      label: "Leve mais e pague menos",
      icon: "badge-percent",
      description: "Dê descontos maiores conforme o cliente leva mais.",
      goodFor: "aumentar ticket",
    },
    nth_product: {
      label: "Volte e ganhe",
      icon: "package-check",
      description: "Incentive o cliente a comprar novamente em outras compras ou dias.",
      goodFor: "aumentar recorrência",
    },
    combo: {
      label: "Monte um combo",
      icon: "shopping-basket",
      description: "Junte produtos por um preço especial para aumentar o valor da venda.",
      goodFor: "aumentar ticket e giro",
    },
  });

  const n = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const round = (value, digits = 4) => Number(n(value).toFixed(digits));
  const iso = (value) => {
    const date = value ? new Date(value) : new Date();
    return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
  };
  const dayKey = (value, timezone = "America/Sao_Paulo") =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(value || Date.now()));
  const uuid = () => root.crypto?.randomUUID?.() || `cmp_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const unique = (values) => [...new Set((values || []).filter(Boolean).map(String))];
  const canonicalType = (value) => (Object.hasOwn(TYPES, value) ? value : "buy_get");

  function normalizeCampaign(raw = {}) {
    const type = canonicalType(raw.type || raw.tipo);
    const qualification = raw.qualification || {};
    const oldRules = raw.rules || {};
    const rule = raw.rule || {};
    const rewards = Array.isArray(raw.rewards) && raw.rewards.length
      ? raw.rewards
      : [{
          id: "reward-1",
          type: raw.rewardProductId || raw.produtoPremioId ? "product" : "external",
          productId: raw.rewardProductId || raw.produtoPremioId || null,
          variantId: raw.rewardVariantId || null,
          quantity: Math.max(1, n(oldRules.rewardQuantity || raw.quantidadePremio || 1)),
          name: raw.rewardName || "Recompensa da campanha",
          pointsCost: Math.max(0, n(oldRules.rewardPoints || raw.pontos || 0)),
        }];
    const thresholds = (rule.thresholds || oldRules.thresholds || []).map((item) => ({
      quantity: Math.max(1, n(item.quantity || item.quantidade)),
      discountPercent: Math.min(100, Math.max(0, n(item.discountPercent || item.desconto))),
    })).filter((item) => item.quantity && item.discountPercent);
    if (type === "quantity_discount" && !thresholds.length) {
      thresholds.push({
        quantity: Math.max(1, n(oldRules.requiredQuantity || raw.quantidadeNecessaria || 3)),
        discountPercent: Math.min(100, Math.max(0, n(oldRules.discountPercent || raw.descontoPercentual || 10))),
      });
    }
    const requiredItems = (rule.requiredItems || oldRules.requiredItems || []).map((item) => ({
      productId: String(item.productId || item.produtoId || ""),
      variantId: item.variantId ? String(item.variantId) : null,
      quantity: Math.max(1, n(item.quantity || item.quantidade || 1)),
    })).filter((item) => item.productId);
    const oldCombo = unique(oldRules.comboProductIds || []);
    if (type === "combo" && !requiredItems.length) {
      for (const productId of oldCombo) requiredItems.push({ productId, variantId: null, quantity: 1 });
    }
    const start = raw.startsAt || raw.startDate || raw.dataInicio || dayKey(Date.now());
    const end = raw.endsAt || raw.endDate || raw.dataFim || null;
    return {
      ...raw,
      id: String(raw.id || uuid()),
      operationId: String(raw.operationId || raw.id || uuid()),
      schemaVersion: VERSION,
      engineVersion: VERSION,
      name: String(raw.name || raw.nome || "Campanha sem nome"),
      description: String(raw.description || raw.descricao || TYPES[type].description),
      type,
      status: String(raw.status || "active"),
      active: raw.active ?? raw.ativo ?? true,
      published: raw.published ?? raw.publica ?? true,
      startsAt: start,
      endsAt: end || null,
      imageUrl: raw.imageUrl || raw.imagem || null,
      imageIcon: raw.imageIcon || TYPES[type].icon,
      eligibility: {
        audienceType: raw.eligibility?.audienceType || raw.audience?.type || "all",
        clientIds: unique(raw.eligibility?.clientIds || raw.audience?.clientIds),
        segmentId: raw.eligibility?.segmentId || raw.audience?.segmentId || null,
        tagIds: unique(raw.eligibility?.tagIds || raw.audience?.tags),
      },
      audienceSource: raw.audienceSource ? {
        type: raw.audienceSource.type || "crmSegment",
        segmentId: raw.audienceSource.segmentId || null,
        segmentName: raw.audienceSource.segmentName || "",
        conditionsSnapshot: Array.isArray(raw.audienceSource.conditionsSnapshot) ? raw.audienceSource.conditionsSnapshot.map((item) => ({ ...item })) : [],
        matchMode: raw.audienceSource.matchMode === "any" ? "any" : "all",
      } : null,
      audienceSnapshot: raw.audienceSnapshot ? {
        clientIds: unique(raw.audienceSnapshot.clientIds),
        count: Number(raw.audienceSnapshot.count ?? raw.audienceSnapshot.clientIds?.length ?? 0),
        capturedAt: raw.audienceSnapshot.capturedAt || iso(),
        summaries: Array.isArray(raw.audienceSnapshot.summaries) ? raw.audienceSnapshot.summaries.map(String) : [],
      } : null,
      qualification: {
        productIds: unique(qualification.productIds || raw.productIds || (raw.produtoId ? [raw.produtoId] : [])),
        variantIds: unique(qualification.variantIds || raw.variantIds || raw.variationIds),
        categoryIds: unique(qualification.categoryIds || raw.categoryIds),
        paymentPolicy: qualification.paymentPolicy || "confirm_when_settled",
        countMode: qualification.countMode || rule.countMode || "quantity",
        dailyLimit: qualification.dailyLimit == null ? null : Math.max(1, n(qualification.dailyLimit)),
        pointsMode: qualification.pointsMode || rule.pointsMode || "value",
      },
      rule: {
        requiredQuantity: Math.max(1, n(rule.requiredQuantity || oldRules.requiredQuantity || raw.quantidadeNecessaria || 5)),
        requiredPurchases: Math.max(1, n(rule.requiredPurchases || oldRules.requiredPurchases || raw.quantidadeNecessaria || 5)),
        multipleCycles: rule.multipleCycles ?? true,
        pointsAmount: Math.max(0.01, n(rule.pointsAmount || 1)),
        pointsAward: Math.max(0, n(rule.pointsAward || oldRules.pointsPerReal || raw.pontosPorReal || 1)),
        pointsExpirationDays: rule.pointsExpirationDays == null || rule.pointsExpirationDays === ""
          ? null
          : Math.max(1, n(rule.pointsExpirationDays)),
        thresholds: thresholds.sort((a, b) => a.quantity - b.quantity),
        requiredItems,
        comboPrice: Math.max(0, n(rule.comboPrice || oldRules.comboPrice || raw.precoCombo)),
      },
      rewards: rewards.map((reward, index) => ({
        id: String(reward.id || `reward-${index + 1}`),
        type: ["product", "external", "discount", "points"].includes(reward.type) ? reward.type : "external",
        productId: reward.productId || null,
        variantId: reward.variantId || null,
        quantity: Math.max(1, n(reward.quantity || 1)),
        name: String(reward.name || `Recompensa ${index + 1}`),
        description: String(reward.description || ""),
        pointsCost: Math.max(0, n(reward.pointsCost || 0)),
      })),
      stacking: {
        allowed: Boolean(raw.stacking?.allowed),
        priority: n(raw.stacking?.priority),
        conflictGroup: raw.stacking?.conflictGroup || null,
      },
      createdAt: raw.createdAt || raw.criadoEm || iso(),
      updatedAt: raw.updatedAt || raw.atualizadoEm || iso(),
      createdBy: raw.createdBy || root.FirebaseSession?.user?.uid || "local",
    };
  }

  function campaignStatus(raw, at = Date.now()) {
    const campaign = normalizeCampaign(raw);
    if (!campaign.active || ["ended", "encerrada"].includes(campaign.status)) return "ended";
    if (["paused", "pausada"].includes(campaign.status)) return "paused";
    const today = dayKey(at);
    if (campaign.startsAt && String(campaign.startsAt).slice(0, 10) > today) return "scheduled";
    if (campaign.endsAt && String(campaign.endsAt).slice(0, 10) < today) return "ended";
    return "active";
  }

  function eligible(raw, client, context = {}) {
    const campaign = normalizeCampaign(raw);
    if (!client || client.ativo === false) return false;
    const e = campaign.eligibility;
    if (e.audienceType === "clients") return e.clientIds.includes(String(client.id));
    if (e.audienceType === "segment") {
      return Boolean(
        context.segmentClientIds?.includes?.(String(client.id)) ||
        context.segmentClientIdsById?.[e.segmentId]?.includes?.(String(client.id)),
      );
    }
    return e.audienceType === "all";
  }

  function itemCategory(item, products) {
    const product = (products || []).find((entry) => entry.id === item.produtoId || entry.id === item.productId);
    return String(item.categoryId || item.categoriaId || item.categoryNameSnapshot || item.categoria || product?.categoryId || product?.categoriaId || product?.categoria || "");
  }

  function matchingItems(raw, items, products = []) {
    const campaign = normalizeCampaign(raw);
    const q = campaign.qualification;
    const targeted = q.productIds.length || q.variantIds.length || q.categoryIds.length;
    return (items || []).filter((item) => {
      const productId = String(item.produtoId || item.productId || "");
      const variantId = String(item.variantId || "");
      const category = itemCategory(item, products);
      if (!targeted) return true;
      return q.productIds.includes(productId) || (variantId && q.variantIds.includes(variantId)) || (category && q.categoryIds.includes(category));
    });
  }

  function comboCycles(campaign, items) {
    const requirements = campaign.rule.requiredItems;
    if (!requirements.length) return 0;
    return Math.min(...requirements.map((required) => {
      const quantity = (items || []).filter((item) =>
        String(item.produtoId || item.productId) === required.productId &&
        (!required.variantId || String(item.variantId || "") === required.variantId),
      ).reduce((sum, item) => sum + n(item.quantidade || item.quantity), 0);
      return Math.floor(quantity / required.quantity);
    }));
  }

  function evaluateOne(raw, sale, context = {}) {
    const campaign = normalizeCampaign(raw);
    if (campaignStatus(campaign, sale.data || sale.createdAt) !== "active") return null;
    if (!eligible(campaign, context.client, context)) return null;
    const items = matchingItems(campaign, sale.itens || sale.items, context.products);
    const quantity = items.reduce((sum, item) => sum + n(item.quantidade || item.quantity), 0);
    let progress = 0;
    let points = 0;
    let opportunity = null;

    if (campaign.type === "buy_get") progress = quantity;
    if (campaign.type === "points") {
      if (campaign.qualification.pointsMode === "unit") {
        points = quantity * campaign.rule.pointsAward;
      } else {
        const amount = items.reduce((sum, item) => sum + n(item.subtotalFinal ?? item.subtotal ?? n(item.quantidade || item.quantity) * n(item.precoFinalUnitario || item.unitPriceSnapshot || item.precoOriginal)), 0);
        points = Math.floor((amount / campaign.rule.pointsAmount) * campaign.rule.pointsAward + 1e-8);
      }
    }
    if (campaign.type === "nth_product") {
      if (!quantity) return null;
      if (campaign.qualification.countMode === "quantity") progress = quantity;
      else {
        const day = dayKey(sale.data || sale.createdAt);
        const reversedEventIds = new Set((context.events || [])
          .filter((event) => event.transition === "reversed" && event.reversedEventId)
          .map((event) => event.reversedEventId));
        const usedToday = (context.events || []).some((event) =>
          event.campaignId === campaign.id &&
          event.clientId === context.client.id &&
          event.sourceType === "sale" &&
          event.transition === "earned" &&
          event.dayKey === day &&
          !reversedEventIds.has(event.id),
        );
        progress = campaign.qualification.dailyLimit === 1 && usedToday ? 0 : 1;
      }
    }
    if (campaign.type === "quantity_discount") {
      const threshold = [...campaign.rule.thresholds].reverse().find((entry) => quantity >= entry.quantity);
      const next = campaign.rule.thresholds.find((entry) => quantity < entry.quantity);
      opportunity = {
        kind: "quantity_discount",
        available: Boolean(threshold),
        discountPercent: threshold?.discountPercent || 0,
        missingQuantity: next ? Math.max(0, next.quantity - quantity) : 0,
        nextDiscountPercent: next?.discountPercent || null,
        matchedItemKeys: items.map((item) => `${item.produtoId || item.productId}:${item.variantId || ""}`),
      };
    }
    if (campaign.type === "combo") {
      const cycles = comboCycles(campaign, sale.itens || sale.items);
      opportunity = {
        kind: "combo",
        available: cycles > 0,
        cycles: campaign.rule.multipleCycles ? cycles : Math.min(1, cycles),
        comboPrice: campaign.rule.comboPrice,
        requirements: campaign.rule.requiredItems,
      };
    }
    if (!progress && !points && !opportunity?.available && !opportunity?.missingQuantity) return null;
    return { campaign, progress: round(progress), points: round(points), opportunity };
  }

  function resolveConflicts(evaluations, selectedIds = []) {
    const selected = new Set(selectedIds || []);
    const benefits = evaluations.filter((entry) => entry.opportunity?.available);
    const progressCandidates = evaluations.filter((entry) => entry.progress || entry.points);
    const groups = new Map();
    for (const entry of evaluations) {
      const key = entry.campaign.stacking.conflictGroup || "sale-benefit";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    }
    const conflicts = [];
    const appliedBenefits = [];
    const progress = [];
    for (const entries of groups.values()) {
      const hasExclusive = entries.length > 1 && entries.some((entry) => !entry.campaign.stacking.allowed);
      if (hasExclusive) {
        const chosen = entries.find((entry) => selected.has(entry.campaign.id));
        if (!chosen) conflicts.push({ campaignIds: entries.map((entry) => entry.campaign.id) });
        else {
          if (chosen.progress || chosen.points) progress.push(chosen);
          if (chosen.opportunity?.available) appliedBenefits.push(chosen);
        }
      } else {
        for (const entry of entries) {
          if (entry.progress || entry.points) progress.push(entry);
          if (entry.opportunity?.available && selected.has(entry.campaign.id)) appliedBenefits.push(entry);
        }
      }
    }
    return { progress, progressCandidates, benefits, appliedBenefits, conflicts };
  }

  function eventId(campaignId, clientId, sourceType, sourceId, transition) {
    return [campaignId, clientId, sourceType, sourceId, transition].map((part) => encodeURIComponent(String(part))).join(":");
  }

  function progressId(campaignId, clientId) {
    return `${campaignId}__${clientId}`;
  }

  function progressIdentity({ businessId = null, campaignId, clientId }) {
    return {
      businessId: businessId || null,
      campaignId: String(campaignId),
      clientId: String(clientId),
      id: progressId(String(campaignId), String(clientId)),
    };
  }

  function findProgressIndex(db, campaignId, clientId, businessId = null) {
    const identity = progressIdentity({ businessId, campaignId, clientId });
    return (db.progressosCampanha || []).findIndex((entry) => {
      const sameTenant = !identity.businessId || !entry.businessId || String(entry.businessId) === identity.businessId;
      return sameTenant && (
        entry.id === identity.id ||
        (String(entry.campaignId) === identity.campaignId && String(entry.clientId) === identity.clientId)
      );
    });
  }

  function emptyProgress(campaignId, clientId, at, businessId = null) {
    return {
      id: progressId(campaignId, clientId),
      operationId: progressId(campaignId, clientId),
      schemaVersion: VERSION,
      engineVersion: VERSION,
      businessId,
      campaignId,
      clientId,
      pendingProgress: 0,
      confirmedProgress: 0,
      pendingPoints: 0,
      availablePoints: 0,
      availableRewards: 0,
      redeemedRewards: 0,
      cycleRemainder: 0,
      version: 0,
      createdAt: at,
      updatedAt: at,
    };
  }

  function rewardThreshold(campaign) {
    return campaign.type === "nth_product" ? campaign.rule.requiredPurchases : campaign.rule.requiredQuantity;
  }

  function applyProgressDelta(progress, campaign, event) {
    const next = { ...progress };
    const sign = event.transition === "reversed" ? -1 : 1;
    if (event.status === "pending") {
      next.pendingProgress = Math.max(0, round(next.pendingProgress + sign * n(event.delta.progress)));
      next.pendingPoints = Math.max(0, round(next.pendingPoints + sign * n(event.delta.points)));
    } else if (event.status === "confirmed") {
      next.confirmedProgress = Math.max(0, round(next.confirmedProgress + sign * n(event.delta.progress)));
      next.availablePoints = Math.max(0, round(next.availablePoints + sign * n(event.delta.points)));
      if (["buy_get", "nth_product"].includes(campaign.type)) {
        const threshold = Math.max(1, rewardThreshold(campaign));
        const cycles = Math.floor(next.confirmedProgress / threshold);
        const entitled = campaign.rule.multipleCycles ? cycles : Math.min(1, cycles);
        next.availableRewards = Math.max(0, entitled - n(next.redeemedRewards));
        next.cycleRemainder = next.confirmedProgress % threshold;
      }
    }
    next.lastQualifiedAt = event.createdAt;
    next.updatedAt = event.createdAt;
    next.version = n(next.version) + 1;
    return next;
  }

  function projectionState(db, rawCampaign, clientId, businessId = null, forcedReversedIds = []) {
    const campaign = normalizeCampaign(rawCampaign);
    const tenantMatches = (event) => !businessId || !event.businessId || String(event.businessId) === String(businessId);
    const events = (db.eventosCampanha || []).filter((event) =>
      String(event.campaignId) === String(campaign.id) &&
      String(event.clientId) === String(clientId) &&
      tenantMatches(event),
    );
    const reversed = new Set([
      ...forcedReversedIds.map(String),
      ...events.filter((event) => event.transition === "reversed" && event.reversedEventId).map((event) => String(event.reversedEventId)),
    ]);
    const confirmations = new Map();
    for (const event of events) {
      if (event.transition !== "confirmed" || !event.confirmsEventId) continue;
      if (!confirmations.has(String(event.confirmsEventId))) confirmations.set(String(event.confirmsEventId), event);
    }

    const existingIndex = findProgressIndex(db, campaign.id, clientId, businessId);
    const baseline = existingIndex >= 0 ? db.progressosCampanha[existingIndex].ledgerBaseline || {} : {};
    let pendingProgress = n(baseline.pendingProgress);
    let confirmedProgress = n(baseline.confirmedProgress);
    let pendingPoints = n(baseline.pendingPoints);
    let confirmedPoints = n(baseline.availablePoints);
    let lastQualifiedAt = null;
    const activePointEarningIds = new Set();
    for (const event of events) {
      if (event.transition !== "earned" || reversed.has(String(event.id))) continue;
      const confirmation = confirmations.get(String(event.id));
      const confirmed = event.status === "confirmed" || Boolean(confirmation);
      if (confirmed) {
        confirmedProgress += n(event.delta?.progress);
        confirmedPoints += n(event.delta?.points);
        activePointEarningIds.add(String(confirmation?.id || event.id));
      } else if (event.status === "pending") {
        pendingProgress += n(event.delta?.progress);
        pendingPoints += n(event.delta?.points);
      }
      const qualifiedAt = confirmation?.createdAt || event.createdAt;
      if (qualifiedAt && (!lastQualifiedAt || new Date(qualifiedAt) > new Date(lastQualifiedAt))) lastQualifiedAt = qualifiedAt;
    }

    const redemptions = events.filter((event) => event.transition === "redeemed");
    const redeemedRewards = n(baseline.redeemedRewards) + redemptions.reduce((sum, event) => sum + (Math.max(0, -n(event.delta?.rewards)) || 1), 0);
    const spentPoints = redemptions.reduce((sum, event) => sum + Math.max(0, -n(event.delta?.points)), 0);
    const expiredPoints = events.filter((event) =>
      event.transition === "expired" && activePointEarningIds.has(String(event.expiresEventId || "")),
    ).reduce((sum, event) => sum + Math.max(0, -n(event.delta?.points)), 0);
    const rawAvailablePoints = round(confirmedPoints - spentPoints - expiredPoints);
    const threshold = Math.max(1, rewardThreshold(campaign));
    const cycles = ["buy_get", "nth_product"].includes(campaign.type)
      ? Math.floor(Math.max(0, confirmedProgress) / threshold)
      : 0;
    const entitledRewards = campaign.rule.multipleCycles ? cycles : Math.min(1, cycles);
    const nowAt = events.reduce((latest, event) => {
      if (!event.createdAt) return latest;
      return !latest || new Date(event.createdAt) > new Date(latest) ? event.createdAt : latest;
    }, null) || iso();

    return {
      pendingProgress: round(pendingProgress),
      confirmedProgress: round(confirmedProgress),
      pendingPoints: round(pendingPoints),
      availablePoints: Math.max(0, rawAvailablePoints),
      pointsDebt: Math.max(0, -rawAvailablePoints),
      availableRewards: Math.max(0, entitledRewards - redeemedRewards),
      redeemedRewards,
      rewardDebt: ["buy_get", "nth_product"].includes(campaign.type)
        ? Math.max(0, redeemedRewards - entitledRewards)
        : 0,
      cycleRemainder: ["buy_get", "nth_product"].includes(campaign.type)
        ? round(Math.max(0, confirmedProgress) % threshold)
        : 0,
      lastQualifiedAt,
      updatedAt: nowAt,
    };
  }

  function rebuildProgress(db, campaignId, clientId, businessId = null) {
    db.progressosCampanha ||= [];
    const campaignRaw = (db.campanhas || []).find((entry) => String(entry.id) === String(campaignId));
    if (!campaignRaw) return null;
    const campaign = normalizeCampaign(campaignRaw);
    const index = findProgressIndex(db, campaignId, clientId, businessId);
    const previous = index >= 0
      ? db.progressosCampanha[index]
      : emptyProgress(String(campaignId), String(clientId), iso(), businessId);
    const state = projectionState(db, campaign, clientId, businessId);
    const next = {
      ...previous,
      ...state,
      id: progressId(String(campaignId), String(clientId)),
      operationId: progressId(String(campaignId), String(clientId)),
      schemaVersion: VERSION,
      engineVersion: VERSION,
      businessId: businessId || previous.businessId || null,
      campaignId: String(campaignId),
      clientId: String(clientId),
      createdAt: previous.createdAt || state.updatedAt,
      version: n(previous.version) + 1,
    };
    if (index >= 0) db.progressosCampanha[index] = next;
    else db.progressosCampanha.push(next);
    return next;
  }

  function saleReversalImpact(db, sale) {
    const originals = (db.eventosCampanha || []).filter((event) =>
      event.sourceType === "sale" &&
      String(event.sourceId) === String(sale.id) &&
      event.transition === "earned" &&
      !(db.eventosCampanha || []).some((candidate) => candidate.transition === "reversed" && candidate.reversedEventId === event.id),
    );
    const conflicts = [];
    for (const campaignId of unique(originals.map((event) => event.campaignId))) {
      const campaign = (db.campanhas || []).find((entry) => String(entry.id) === String(campaignId));
      if (!campaign) continue;
      const campaignOriginals = originals.filter((event) => String(event.campaignId) === String(campaignId));
      const state = projectionState(
        db,
        campaign,
        campaignOriginals[0]?.clientId,
        campaignOriginals[0]?.businessId,
        campaignOriginals.map((event) => event.id),
      );
      if (state.pointsDebt > 0 || state.rewardDebt > 0) {
        conflicts.push({
          campaignId,
          campaignName: normalizeCampaign(campaign).name,
          pointsDebt: state.pointsDebt,
          rewardDebt: state.rewardDebt,
        });
      }
    }
    return { originals, conflicts };
  }

  function validateSaleReversal(db, sale) {
    const impact = saleReversalImpact(db, sale);
    if (impact.conflicts.length) {
      const error = new Error("Esta venda gerou uma recompensa que já foi resgatada. Faça uma resolução administrativa antes de cancelar.");
      error.code = "campaign-redemption-conflict";
      error.conflicts = impact.conflicts;
      throw error;
    }
    return impact;
  }

  function applySale(db, sale, options = {}) {
    db.eventosCampanha ||= [];
    db.progressosCampanha ||= [];
    expirePoints(db, sale.data || sale.createdAt || iso());
    if (!sale.clienteId && !sale.clientId) return { events: [], snapshots: [], conflicts: [] };
    const clientId = String(sale.clienteId || sale.clientId);
    const client = (db.clientes || []).find((entry) => String(entry.id) === clientId);
    if (!client) return { events: [], snapshots: [], conflicts: [] };
    const segmentClientIdsById = Object.fromEntries((db.segmentosClientes || []).map((segment) => [
      String(segment.id),
      (segment.clientIds || segment.clienteIds || []).map(String),
    ]));
    const evaluations = (db.campanhas || []).map((campaign) => evaluateOne(campaign, sale, {
      client,
      products: db.produtos,
      events: db.eventosCampanha,
      segmentClientIds: options.segmentClientIds,
      segmentClientIdsById,
    })).filter(Boolean);
    const resolved = resolveConflicts(evaluations, sale.appliedCampaignIds || options.selectedCampaignIds || []);
    const acceptedIds = new Set([
      ...resolved.progress.map((entry) => entry.campaign.id),
      ...resolved.appliedBenefits.map((entry) => entry.campaign.id),
    ]);
    const created = [];
    const snapshots = [];
    for (const evaluation of evaluations.filter((entry) => acceptedIds.has(entry.campaign.id))) {
      const appliedBenefit = resolved.appliedBenefits.includes(evaluation) ? evaluation.opportunity : null;
      if (!evaluation.progress && !evaluation.points && !appliedBenefit) continue;
      const status = (evaluation.progress || evaluation.points) && sale.status === "fiado"
        ? "pending"
        : "confirmed";
      const id = eventId(evaluation.campaign.id, clientId, "sale", sale.id, "earned");
      if (db.eventosCampanha.some((event) => event.id === id)) continue;
      const event = {
        id,
        operationId: sale.operationId || sale.id,
        schemaVersion: VERSION,
        engineVersion: VERSION,
        businessId: sale.businessId || null,
        campaignId: evaluation.campaign.id,
        clientId,
        sourceType: "sale",
        sourceId: sale.id,
        transition: "earned",
        status,
        dayKey: dayKey(sale.data || sale.createdAt),
        delta: { progress: evaluation.progress, points: evaluation.points, rewards: 0 },
        benefit: appliedBenefit ? structuredClone(appliedBenefit) : null,
        expiresAt: evaluation.points && evaluation.campaign.rule.pointsExpirationDays
          ? iso(new Date(sale.data || sale.createdAt || Date.now()).getTime() + evaluation.campaign.rule.pointsExpirationDays * 86400000)
          : null,
        createdAt: sale.data || sale.createdAt || iso(),
      };
      const index = findProgressIndex(db, evaluation.campaign.id, clientId, sale.businessId);
      const before = index >= 0
        ? structuredClone(db.progressosCampanha[index])
        : emptyProgress(evaluation.campaign.id, clientId, event.createdAt, sale.businessId || null);
      db.eventosCampanha.push(event);
      const after = evaluation.progress || evaluation.points
        ? rebuildProgress(db, evaluation.campaign.id, clientId, sale.businessId)
        : before;
      created.push(event);
      snapshots.push({
        campaignId: evaluation.campaign.id,
        campaignName: evaluation.campaign.name,
        campaignType: evaluation.campaign.type,
        type: evaluation.campaign.type,
        status,
        progressEarned: evaluation.progress,
        pointsEarned: evaluation.points,
        progressGenerated: evaluation.progress,
        pointsGenerated: evaluation.points,
        pending: status === "pending",
        confirmed: status === "confirmed",
        progressBefore: before.confirmedProgress,
        progressAfter: after.confirmedProgress,
        pointsBefore: before.availablePoints,
        pointsAfter: after.availablePoints,
        pendingProgressAfter: after.pendingProgress,
        pendingPointsAfter: after.pendingPoints,
        rewardUnlocked: Math.max(0, n(after.availableRewards) - n(before.availableRewards)),
        rewardsAvailable: n(after.availableRewards),
        benefitApplied: appliedBenefit ? structuredClone(appliedBenefit) : null,
      });
    }
    return { events: created, snapshots, conflicts: resolved.conflicts };
  }

  function reverseSale(db, sale, options = {}) {
    db.eventosCampanha ||= [];
    db.progressosCampanha ||= [];
    const impact = saleReversalImpact(db, sale);
    const administrative = options.administrativeResolution || null;
    if (impact.conflicts.length && administrative?.mode !== "record_benefit_debt") {
      const error = new Error("Esta venda gerou uma recompensa que já foi resgatada. Faça uma resolução administrativa antes de cancelar.");
      error.code = "campaign-redemption-conflict";
      error.conflicts = impact.conflicts;
      throw error;
    }
    if (impact.conflicts.length && !String(administrative?.reason || "").trim()) {
      const error = new Error("Informe o motivo da resolução administrativa.");
      error.code = "campaign-resolution-reason-required";
      error.conflicts = impact.conflicts;
      throw error;
    }
    const { originals } = impact;
    const created = [];
    const affected = new Map();
    for (const original of originals) {
      const id = eventId(original.campaignId, original.clientId, "sale", sale.id, "reversed");
      if (db.eventosCampanha.some((event) => event.id === id)) continue;
      const confirmation = db.eventosCampanha.find((candidate) => candidate.confirmsEventId === original.id && candidate.transition === "confirmed");
      const event = {
        ...original,
        id,
        operationId: `reverse:${sale.operationId || sale.id}`,
        sourceType: "cancellation",
        sourceId: sale.id,
        transition: "reversed",
        status: confirmation ? "confirmed" : original.status,
        reversedEventId: original.id,
        reversesConfirmationId: confirmation?.id || null,
        administrativeResolution: impact.conflicts.length ? {
          mode: "record_benefit_debt",
          reason: String(administrative.reason).trim(),
          actorId: administrative.actorId || null,
          resolvedAt: administrative.resolvedAt || iso(),
          conflicts: impact.conflicts.map((conflict) => ({ ...conflict })),
        } : null,
        createdAt: iso(),
      };
      db.eventosCampanha.push(event);
      created.push(event);
      affected.set(`${original.campaignId}:${original.clientId}:${original.businessId || ""}`, original);
    }
    for (const original of affected.values()) rebuildProgress(db, original.campaignId, original.clientId, original.businessId);
    created.events = created;
    created.administrativeResolution = impact.conflicts.length ? {
      mode: "record_benefit_debt",
      conflicts: impact.conflicts,
    } : null;
    return created;
  }

  function allocatePayment(db, clientId, amount, paymentId, at = iso(), options = {}) {
    db.alocacoesPagamento ||= [];
    const existing = db.alocacoesPagamento.filter((allocation) => allocation.paymentId === paymentId);
    if (existing.length) return existing;
    let remaining = Math.max(0, n(amount));
    const sales = (db.vendas || []).filter((sale) =>
      String(sale.clienteId || sale.clientId) === String(clientId) &&
      sale.status === "fiado" &&
      sale.desfeita !== true &&
      (!options.businessId || !sale.businessId || String(sale.businessId) === String(options.businessId)),
    ).sort((a, b) => new Date(a.data || a.createdAt) - new Date(b.data || b.createdAt));
    const allocations = [];
    for (const sale of sales) {
      if (remaining <= 0) break;
      const original = Math.max(0, n(sale.creditOriginalAmount ?? sale.valorFinal ?? sale.valorTotal));
      const paid = Math.max(0, n(sale.creditPaidAmount));
      const due = Math.max(0, round(original - paid, 2));
      if (!due) continue;
      const applied = Math.min(due, remaining);
      sale.creditOriginalAmount = original;
      sale.creditPaidAmount = round(paid + applied, 2);
      sale.creditRemainingAmount = round(original - sale.creditPaidAmount, 2);
      sale.creditSettled = sale.creditRemainingAmount <= 0;
      sale.creditSettledAt = sale.creditSettled ? at : null;
      const allocation = {
        id: `${paymentId}__${sale.id}`,
        operationId: paymentId,
        schemaVersion: VERSION,
        engineVersion: VERSION,
        paymentId,
        saleId: sale.id,
        clientId: String(clientId),
        businessId: sale.businessId || null,
        amount: round(applied, 2),
        settledSale: sale.creditSettled,
        createdAt: at,
      };
      db.alocacoesPagamento.push(allocation);
      allocations.push(allocation);
      remaining = round(remaining - applied, 2);
    }
    return allocations;
  }

  function confirmSettledSales(db, payment, allocations) {
    db.eventosCampanha ||= [];
    db.progressosCampanha ||= [];
    const created = [];
    for (const allocation of allocations.filter((entry) => entry.settledSale)) {
      const pending = db.eventosCampanha.filter((event) => event.sourceType === "sale" && event.sourceId === allocation.saleId && event.transition === "earned" && event.status === "pending");
      for (const original of pending) {
        if (db.eventosCampanha.some((event) => event.confirmsEventId === original.id && event.transition === "confirmed")) continue;
        const id = eventId(original.campaignId, original.clientId, "payment", payment.id, `confirmed-${allocation.saleId}`);
        if (db.eventosCampanha.some((event) => event.id === id)) continue;
        const progressIndex = findProgressIndex(db, original.campaignId, original.clientId, original.businessId);
        if (progressIndex < 0) continue;
        const event = {
          id,
          operationId: payment.operationId || payment.id,
          schemaVersion: VERSION,
          engineVersion: VERSION,
          businessId: payment.businessId || null,
          campaignId: original.campaignId,
          clientId: original.clientId,
          sourceType: "payment",
          sourceId: payment.id,
          transition: "confirmed",
          status: "confirmed",
          confirmsEventId: original.id,
          saleId: allocation.saleId,
          delta: structuredClone(original.delta),
          expiresAt: original.expiresAt || null,
          createdAt: payment.data || payment.createdAt || iso(),
        };
        db.eventosCampanha.push(event);
        rebuildProgress(db, original.campaignId, original.clientId, original.businessId);
        created.push(event);
      }
    }
    return created;
  }

  function redeem(db, campaignId, clientId, rewardId, options = {}) {
    db.resgatesCampanha ||= [];
    db.eventosCampanha ||= [];
    db.movimentacoesEstoque ||= [];
    expirePoints(db, options.at || iso());
    const campaign = normalizeCampaign((db.campanhas || []).find((entry) => entry.id === campaignId));
    if (!campaign?.id) throw new Error("Campanha não encontrada");
    const reward = campaign.rewards.find((entry) => entry.id === rewardId);
    if (!reward) throw new Error("Recompensa não encontrada");
    const operationId = String(options.operationId || uuid());
    const redemptionId = `${campaignId}:${clientId}:redemption:${operationId}`;
    const existing = db.resgatesCampanha.find((entry) => entry.id === redemptionId);
    if (existing) return existing;
    const progressIndex = findProgressIndex(db, campaignId, clientId, options.businessId);
    if (progressIndex < 0) throw new Error("Progresso não encontrado");
    const progress = db.progressosCampanha[progressIndex];

    const hasLedgerAccrual = db.eventosCampanha.some((event) =>
      String(event.campaignId) === String(campaignId) &&
      String(event.clientId) === String(clientId) &&
      ["earned", "confirmed"].includes(event.transition),
    );
    if (!hasLedgerAccrual && !progress.ledgerBaseline) {
      progress.ledgerBaseline = {
        pendingProgress: n(progress.pendingProgress),
        confirmedProgress: n(progress.confirmedProgress),
        pendingPoints: n(progress.pendingPoints),
        availablePoints: n(progress.availablePoints),
        redeemedRewards: n(progress.redeemedRewards),
      };
    }

    // Valida todo o resgate antes de alterar pontos, progresso ou estoque. Assim,
    // qualquer falha mantém a projeção local intacta e o retry usa o mesmo ID.
    let stockPlan = null;
    if (reward.type === "product") {
      const product = (db.produtos || []).find((entry) => entry.id === reward.productId);
      if (!product) throw new Error("Produto da recompensa não encontrado");
      const controlsStock = product.itemKind !== "service" &&
        !product.semControleEstoque && product.controlaEstoque !== false;
      const quantity = Math.max(1, n(reward.quantity));
      if (reward.variantId) {
        const variant = (db.variacoesProdutos || []).find((entry) => entry.id === reward.variantId);
        if (!variant) throw new Error("Variação da recompensa não encontrada");
        if (String(variant.parentProductId) !== String(product.id)) throw new Error("A variação não pertence ao produto da recompensa");
        if (controlsStock) {
          if (!variant.allowNegativeStock && n(variant.stock) < quantity) throw new Error("Estoque insuficiente para o resgate");
          stockPlan = { product, variant, quantity, before: n(variant.stock) };
        }
      } else if (controlsStock) {
        if (n(product.estoqueAtual) < quantity) throw new Error("Estoque insuficiente para o resgate");
        stockPlan = { product, variant: null, quantity, before: n(product.estoqueAtual) };
      }
    }
    if (campaign.type === "points") {
      if (!reward.pointsCost || n(progress.availablePoints) < reward.pointsCost) throw new Error("Pontos insuficientes");
    } else {
      if (n(progress.availableRewards) < 1) throw new Error("Recompensa ainda não disponível");
    }
    const at = iso();
    let stockMovementId = null;
    if (stockPlan) {
      const { product, variant, quantity, before } = stockPlan;
      if (variant) {
        variant.stock = before - quantity;
        stockMovementId = `${redemptionId}:stock`;
        db.movimentacoesEstoque.push({ id: stockMovementId, operationId, produtoId: product.id, variantId: variant.id, tipo: "saida_resgate_campanha", quantidade: -quantity, estoqueAnterior: before, estoqueNovo: variant.stock, campaignId, redemptionId, data: at });
        root.ProductVariations?.recomputeInData?.(db, product.id);
      } else {
        product.estoqueAtual = before - quantity;
        product.estoque = product.estoqueAtual;
        stockMovementId = `${redemptionId}:stock`;
        db.movimentacoesEstoque.push({ id: stockMovementId, operationId, produtoId: product.id, tipo: "saida_resgate_campanha", quantidade: -quantity, estoqueAnterior: before, estoqueNovo: product.estoqueAtual, campaignId, redemptionId, data: at });
      }
    }
    const businessId = options.businessId || root.FirebaseSession?.businessId || null;
    const redemption = { id: redemptionId, operationId, schemaVersion: VERSION, engineVersion: VERSION, businessId, campaignId, clientId, rewardId: reward.id, rewardSnapshot: structuredClone(reward), status: "redeemed", stockMovementId, createdAt: at };
    db.resgatesCampanha.push(redemption);
    db.eventosCampanha.push({ id: eventId(campaignId, clientId, "redemption", redemptionId, "redeemed"), operationId, schemaVersion: VERSION, engineVersion: VERSION, businessId, campaignId, clientId, sourceType: "redemption", sourceId: redemptionId, transition: "redeemed", status: "confirmed", delta: { progress: 0, points: campaign.type === "points" ? -reward.pointsCost : 0, rewards: -1 }, createdAt: at });
    rebuildProgress(db, campaignId, clientId, businessId);
    return redemption;
  }

  function expirePoints(db, at = iso()) {
    db.eventosCampanha ||= [];
    db.progressosCampanha ||= [];
    const cutoff = new Date(at).getTime();
    if (!Number.isFinite(cutoff)) return [];
    const batchOperationId = `campaign-expiry:${dayKey(cutoff)}`;
    const created = [];
    const pointCampaigns = (db.campanhas || []).map(normalizeCampaign).filter((campaign) => campaign.type === "points" && campaign.rule.pointsExpirationDays);
    for (const campaign of pointCampaigns) {
      const clientIds = [...new Set(db.eventosCampanha.filter((event) => event.campaignId === campaign.id).map((event) => event.clientId).filter(Boolean))];
      for (const clientId of clientIds) {
        const events = db.eventosCampanha.filter((event) => event.campaignId === campaign.id && event.clientId === clientId);
        const reversed = new Set(events.filter((event) => event.transition === "reversed").map((event) => event.reversedEventId));
        const expired = new Set(events.filter((event) => event.transition === "expired").map((event) => event.expiresEventId));
        let spent = events.filter((event) => event.transition === "redeemed").reduce((sum, event) => sum + Math.max(0, -n(event.delta?.points)), 0);
        const earnings = events.filter((event) =>
          ["earned", "confirmed"].includes(event.transition) &&
          event.status === "confirmed" &&
          n(event.delta?.points) > 0 &&
          !reversed.has(event.id) &&
          !(event.confirmsEventId && reversed.has(event.confirmsEventId)) &&
          !expired.has(event.id),
        ).sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
        for (const earning of earnings) {
          const earned = n(earning.delta.points), consumed = Math.min(earned, spent), remaining = round(earned - consumed);
          spent = round(spent - consumed);
          if (!remaining || !earning.expiresAt || new Date(earning.expiresAt).getTime() > cutoff) continue;
          const id = eventId(campaign.id, clientId, "expiration", earning.id, "expired");
          if (db.eventosCampanha.some((event) => event.id === id)) continue;
          const event = { id, operationId: batchOperationId, schemaVersion: VERSION, engineVersion: VERSION, businessId: earning.businessId || null, campaignId: campaign.id, clientId, sourceType: "expiration", sourceId: earning.id, transition: "expired", status: "confirmed", expiresEventId: earning.id, delta: { progress: 0, points: -remaining, rewards: 0 }, createdAt: iso(cutoff) };
          db.eventosCampanha.push(event);
          rebuildProgress(db, campaign.id, clientId, earning.businessId);
          created.push(event);
        }
      }
    }
    return created;
  }

  function receiptSummary(snapshots) {
    return (snapshots || []).map((item) => ({
      campaignId: item.campaignId,
      campaignName: item.campaignName,
      type: item.type || item.campaignType,
      status: item.status,
      progressGenerated: n(item.progressGenerated ?? item.progressEarned),
      pointsGenerated: n(item.pointsGenerated ?? item.pointsEarned),
      pending: item.pending ?? item.status === "pending",
      confirmed: item.confirmed ?? item.status === "confirmed",
      progressBefore: n(item.progressBefore),
      progressAfter: n(item.progressAfter),
      pointsBefore: n(item.pointsBefore),
      pointsAfter: n(item.pointsAfter),
      text: item.pointsEarned
        ? `${item.pointsEarned} ponto(s) ${item.status === "pending" ? "pendente(s)" : "adicionado(s)"}`
        : item.progressEarned
          ? `${item.progressEarned} progresso(s) ${item.status === "pending" ? "pendente(s)" : "confirmado(s)"}`
          : item.benefitApplied?.kind === "quantity_discount"
            ? `${item.benefitApplied.discountPercent}% de desconto aplicado`
            : item.benefitApplied?.kind === "combo"
              ? `Combo promocional aplicado (${item.benefitApplied.cycles || 1}x)`
              : "Benefício aplicado",
      rewardUnlocked: item.rewardUnlocked || 0,
      rewardsAvailable: n(item.rewardsAvailable),
      messageHint: item.pointsEarned
        ? `${item.pointsEarned} ponto(s) ${item.status === "pending" ? "pendente(s)" : "adicionado(s)"}`
        : item.progressEarned
          ? `${item.progressEarned} progresso(s) ${item.status === "pending" ? "pendente(s)" : "confirmado(s)"}`
          : item.benefitApplied?.kind === "quantity_discount"
            ? `${item.benefitApplied.discountPercent}% de desconto aplicado`
            : item.benefitApplied?.kind === "combo"
              ? `Combo promocional aplicado (${item.benefitApplied.cycles || 1}x)`
              : "Benefício aplicado",
      benefitApplied: item.benefitApplied ? structuredClone(item.benefitApplied) : null,
    }));
  }

  function campaignMetrics(db, rawCampaign, context = {}) {
    const campaign = normalizeCampaign(rawCampaign);
    const progress = (db.progressosCampanha || []).filter((item) =>
      String(item.campaignId) === String(campaign.id) &&
      (!context.businessId || !item.businessId || String(item.businessId) === String(context.businessId)),
    );
    const redemptions = (db.resgatesCampanha || []).filter((item) =>
      String(item.campaignId) === String(campaign.id) &&
      (!context.businessId || !item.businessId || String(item.businessId) === String(context.businessId)),
    );
    const eligibleClients = (db.clientes || []).filter((client) => eligible(campaign, client, context));
    const participating = progress.filter((item) =>
      n(item.pendingProgress) > 0 || n(item.confirmedProgress) > 0 ||
      n(item.pendingPoints) > 0 || n(item.availablePoints) > 0 ||
      n(item.redeemedRewards) > 0,
    );
    const rewardState = participating.map((item) => {
      if (campaign.type === "points") {
        const points = n(item.availablePoints);
        const ordered = campaign.rewards.filter((reward) => n(reward.pointsCost) > 0).sort((a, b) => n(a.pointsCost) - n(b.pointsCost));
        const redeemable = ordered.some((reward) => n(reward.pointsCost) <= points);
        const next = ordered.find((reward) => n(reward.pointsCost) > points);
        return { redeemable, near: !redeemable && points > 0 && next && points / n(next.pointsCost) >= .75 };
      }
      const redeemable = n(item.availableRewards) > 0;
      const target = Math.max(1, rewardThreshold(campaign));
      const current = n(item.cycleRemainder ?? item.confirmedProgress);
      return { redeemable, near: !redeemable && current > 0 && current / target >= .75 };
    });
    return {
      eligible: eligibleClients.length,
      withProgress: participating.length,
      pending: progress.filter((item) => n(item.pendingProgress) > 0 || n(item.pendingPoints) > 0).length,
      rewardsAvailable: progress.reduce((sum, item) => sum + n(item.availableRewards), 0),
      redemptions: redemptions.length,
      uniqueParticipants: new Set(participating.map((item) => String(item.clientId))).size,
      nearReward: rewardState.filter((item) => item.near).length,
      redeemable: rewardState.filter((item) => item.redeemable).length,
    };
  }

  root.CampaignEngineV2 = {
    VERSION,
    TYPES,
    normalizeCampaign,
    campaignStatus,
    eligible,
    matchingItems,
    evaluateOne,
    resolveConflicts,
    eventId,
    progressId,
    progressIdentity,
    findProgressIndex,
    projectionState,
    rebuildProgress,
    saleReversalImpact,
    validateSaleReversal,
    applySale,
    reverseSale,
    allocatePayment,
    confirmSettledSales,
    expirePoints,
    redeem,
    receiptSummary,
    campaignMetrics,
    dayKey,
  };
})(typeof window !== "undefined" ? window : globalThis);

window.CustomerSubscriptions = (() => {
  const UNITS = new Set(["days", "weeks", "months", "years"]);
  const STATUS = new Set(["active", "expired", "paused", "cancelled"]);
  const now = () => new Date().toISOString();
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const duration = (value, unit) => ({
    value: Math.max(1, Math.round(number(value, 30))),
    unit: UNITS.has(unit) ? unit : "days",
  });
  const addDuration = (dateValue, value, unit) => {
    const start = new Date(dateValue || Date.now()), next = new Date(start), normalized = duration(value, unit);
    if (normalized.unit === "days") next.setDate(next.getDate() + normalized.value);
    if (normalized.unit === "weeks") next.setDate(next.getDate() + normalized.value * 7);
    if (normalized.unit === "months") next.setMonth(next.getMonth() + normalized.value);
    if (normalized.unit === "years") next.setFullYear(next.getFullYear() + normalized.value);
    return next.toISOString();
  };
  const effectiveStatus = (subscription, reference = Date.now()) => {
    if (["paused", "cancelled"].includes(subscription?.status)) return subscription.status;
    return new Date(subscription?.expiresAt || 0).getTime() < new Date(reference).getTime() ? "expired" : "active";
  };
  const list = () => DB.carregar().customerSubscriptions || [];
  const events = () => DB.carregar().customerSubscriptionEvents || [];
  const get = (id) => list().find((item) => item.id === id) || null;
  const forClient = (clientId, options = {}) => list()
    .filter((item) => item.clientId === clientId && (!options.statuses || options.statuses.includes(effectiveStatus(item))))
    .sort((a, b) => new Date(a.expiresAt || 0) - new Date(b.expiresAt || 0));
  const matching = (clientId, productId, variantId = null) => forClient(clientId)
    .filter((item) => item.productId === productId && String(item.variantId || "") === String(variantId || "") && !["cancelled"].includes(item.status));
  const matchingProduct = (clientId, productId) => forClient(clientId)
    .filter((item) => item.productId === productId && !["cancelled"].includes(item.status));
  const preview = ({ subscription, at = now(), durationValue, durationUnit }) => {
    const normalized = duration(durationValue, durationUnit), currentExpiry = subscription?.expiresAt ? new Date(subscription.expiresAt) : null;
    const base = currentExpiry && currentExpiry.getTime() > new Date(at).getTime() ? currentExpiry.toISOString() : at;
    return { startsAt: base, expiresAt: addDuration(base, normalized.value, normalized.unit), ...normalized };
  };
  const event = (db, subscription, transition, sourceId, details = {}) => {
    db.customerSubscriptionEvents ??= [];
    const id = `${subscription.id}:${transition}:${sourceId}`;
    if (db.customerSubscriptionEvents.some((item) => item.id === id)) return;
    db.customerSubscriptionEvents.push({
      id, operationId: id, businessId: DB.getBusinessId?.() || null,
      subscriptionId: subscription.id, clientId: subscription.clientId,
      productId: subscription.productId, variantId: subscription.variantId || null,
      spaceId: subscription.spaceId || null,
      transition, sourceType: details.sourceType || "sale", sourceId,
      previous: details.previous || null, next: details.next || null,
      note: details.note || "", createdAt: details.createdAt || now(), schemaVersion: 13,
    });
  };
  function applySaleInData(db, sale) {
    db.customerSubscriptions ??= [];
    if (!sale?.clientId && !sale?.clienteId) {
      if ((sale?.itens || []).some((item) => item.productType === "recurring" || item.recurringActivation))
        throw Error("Venda com renovação exige um cliente selecionado.");
      return [];
    }
    const updates = [], saleDate = sale.createdAt || sale.data || now(), clientId = sale.clientId || sale.clienteId;
    (sale.itens || []).forEach((item, index) => {
      const product = (db.produtos || []).find((entry) => entry.id === item.produtoId);
      if (product?.productType !== "recurring" && !item.recurringActivation) return;
      const config = item.recurringActivation || {}, normalized = duration(config.durationValue ?? product?.durationValue, config.durationUnit ?? product?.durationUnit);
      const subscriptionId = config.subscriptionId || item.subscriptionId || null;
      const existing = subscriptionId ? db.customerSubscriptions.find((entry) => entry.id === subscriptionId) : null;
      if (existing && existing.clientId !== clientId) throw Error("A vigência selecionada pertence a outro cliente.");
      if (existing?.lastSaleId === sale.id) {
        updates.push({ subscriptionId: existing.id, action: item.subscriptionAction || "unchanged", expiresAt: existing.expiresAt, idempotent: true });
        return;
      }
      const previous = existing ? structuredClone(existing) : null;
      const id = existing?.id || subscriptionId || Utils.uuid();
      const dates = preview({ subscription: existing, at: saleDate, durationValue: normalized.value, durationUnit: normalized.unit });
      const variant = item.variantId ? (db.variacoesProdutos || []).find((entry) => entry.id === item.variantId) : null;
      const next = {
        ...(existing || {}), id, operationId: id, businessId: DB.getBusinessId?.() || null,
        spaceId: sale.spaceId || existing?.spaceId || null,
        clientId, productId: item.produtoId, variantId: item.variantId || null,
        label: String(config.label || existing?.label || product?.renewalLabel || product?.nome || "Renovação").trim(),
        status: "active", startedAt: existing?.startedAt || saleDate, expiresAt: dates.expiresAt,
        durationValue: normalized.value, durationUnit: normalized.unit,
        contractedPrice: number(config.contractedPrice ?? item.precoFinalUnitario ?? item.precoUnitario ?? product?.preco),
        renewalCount: number(existing?.renewalCount) + (existing ? 1 : 0),
        lastRenewedAt: existing ? saleDate : null, createdFromSaleId: existing?.createdFromSaleId || sale.id,
        lastSaleId: sale.id, reminders: Array.isArray(config.reminders) ? config.reminders : (existing?.reminders || product?.renewalReminders || []),
        renewalMessage: config.renewalMessage || existing?.renewalMessage || product?.renewalMessage || "",
        createdAt: existing?.createdAt || saleDate, updatedAt: saleDate, schemaVersion: 14,
      };
      if (existing) Object.assign(existing, next); else db.customerSubscriptions.push(next);
      Object.assign(item, {
        productType: "recurring", subscriptionId: id, subscriptionAction: existing ? "renewal" : "activation",
        renewalLabel: next.label, durationValue: normalized.value, durationUnit: normalized.unit,
        subscriptionStartedAt: dates.startsAt, subscriptionExpiresAt: next.expiresAt,
        subscriptionPrevious: previous,
      });
      event(db, next, existing ? "renewal" : "activation", sale.id, { previous, next: structuredClone(next), createdAt: saleDate });
      if (existing && number(previous?.contractedPrice) !== number(next.contractedPrice))
        event(db, next, "price_changed", sale.id, { previous, next: structuredClone(next), createdAt: saleDate });
      if (existing && String(previous?.variantId || "") !== String(next.variantId || ""))
        event(db, next, "plan_changed", sale.id, { previous, next: structuredClone(next), createdAt: saleDate });
      updates.push({ subscriptionId: id, action: item.subscriptionAction, expiresAt: next.expiresAt });
    });
    return updates;
  }
  function reverseSaleInData(db, sale) {
    const reversed = [];
    (sale?.itens || []).forEach((item) => {
      if (!item.subscriptionId) return;
      const index = (db.customerSubscriptions || []).findIndex((entry) => entry.id === item.subscriptionId), current = index >= 0 ? db.customerSubscriptions[index] : null;
      if (!current || current.lastSaleId !== sale.id) return;
      const previous = item.subscriptionPrevious || null;
      if (previous) db.customerSubscriptions[index] = previous;
      else db.customerSubscriptions.splice(index, 1);
      event(db, current, "sale_reversed", sale.id, { previous: structuredClone(current), next: previous, sourceType: "cancellation" });
      reversed.push(current.id);
    });
    return reversed;
  }
  const changeStatus = (id, requested, note = "") => {
    if (!STATUS.has(requested)) throw Error("Status de renovação inválido.");
    let saved;
    DB.alterar((db) => {
      const subscription = (db.customerSubscriptions || []).find((item) => item.id === id);
      if (!subscription) throw Error("Renovação não encontrada.");
      const previous = structuredClone(subscription), nextStatus = requested === "active" ? effectiveStatus({ ...subscription, status: "active" }) : requested;
      subscription.status = nextStatus; subscription.updatedAt = now(); saved = subscription;
      event(db, subscription, nextStatus === "active" ? "reactivated" : nextStatus, Utils.uuid(), { sourceType: "manual", previous, next: structuredClone(subscription), note });
    });
    return saved;
  };
  const upcoming = ({ from = now(), to, statuses = ["active"], clientId = null } = {}) => list().filter((item) => {
    const status = effectiveStatus(item, from), expiry = new Date(item.expiresAt || 0).getTime();
    return statuses.includes(status) && (!clientId || item.clientId === clientId) && expiry >= new Date(from).getTime() && (!to || expiry <= new Date(to).getTime());
  });
  const metrics = (reference = now()) => {
    const endToday = new Date(reference); endToday.setHours(23, 59, 59, 999);
    const end7 = new Date(endToday); end7.setDate(end7.getDate() + 7);
    const active = list().filter((item) => effectiveStatus(item, reference) === "active");
    const dueToday = active.filter((item) => new Date(item.expiresAt) <= endToday);
    const due7 = active.filter((item) => new Date(item.expiresAt) > endToday && new Date(item.expiresAt) <= end7);
    const expired = list().filter((item) => effectiveStatus(item, reference) === "expired");
    return { dueToday: dueToday.length, due7: due7.length, expired: expired.length, forecastValue: [...dueToday, ...due7].reduce((sum, item) => sum + number(item.contractedPrice), 0) };
  };
  async function loadForClient(clientId) {
    const remote = await window.SyncFirebase?.queryCustomerSubscriptions?.({ clientId, limit: 50 });
    return remote || forClient(clientId);
  }
  async function loadUpcoming({ from = now(), to, status = "active", limit = 50 } = {}) {
    const remote = await window.SyncFirebase?.queryCustomerSubscriptions?.({ status, from, to, direction: "asc", limit });
    return remote || upcoming({ from, to, statuses: [status] });
  }
  async function loadByStatus(status, { from, to, limit = 50, direction = "asc" } = {}) {
    if (!STATUS.has(status)) throw Error("Status de renovação inválido.");
    const remote = await window.SyncFirebase?.queryCustomerSubscriptions?.({ status, from, to, direction, limit });
    return remote || list().filter((item) => effectiveStatus(item) === status);
  }
  async function loadExpiring(days = 7, reference = now(), limit = 50) {
    const end = new Date(reference); end.setDate(end.getDate() + Math.max(0, number(days))); end.setHours(23, 59, 59, 999);
    return loadUpcoming({ from: reference, to: end.toISOString(), status: "active", limit });
  }
  async function loadExpired(reference = now(), limit = 50) {
    if (!window.SyncFirebase?.queryCustomerSubscriptions)
      return list().filter((item) => effectiveStatus(item, reference) === "expired");
    const [staleActive, explicitExpired] = await Promise.all([
      window.SyncFirebase.queryCustomerSubscriptions({ status: "active", to: reference, direction: "desc", limit }),
      window.SyncFirebase.queryCustomerSubscriptions({ status: "expired", to: reference, direction: "desc", limit }),
    ]);
    return [...new Map([...(staleActive || []), ...(explicitExpired || [])]
      .filter((item) => effectiveStatus(item, reference) === "expired")
      .map((item) => [item.id, item])).values()];
  }
  async function loadRecentlyRenewed(days = 30, reference = now(), limit = 50) {
    const start = new Date(reference); start.setDate(start.getDate() - Math.max(1, number(days, 30)));
    const remote = await window.SyncFirebase?.queryCustomerSubscriptions?.({ lastRenewedFrom: start.toISOString(), direction: "desc", limit });
    return remote || list().filter((item) => item.lastRenewedAt && new Date(item.lastRenewedAt) >= start);
  }
  async function loadDashboardMetrics(reference = now()) {
    const [due7, expired] = await Promise.all([loadExpiring(7, reference, 50), loadExpired(reference, 50)]);
    const endToday = new Date(reference); endToday.setHours(23, 59, 59, 999);
    return {
      dueToday: due7.filter((item) => new Date(item.expiresAt) <= endToday).length,
      due7: due7.filter((item) => new Date(item.expiresAt) > endToday).length,
      expired: expired.length,
      forecastValue: due7.reduce((sum, item) => sum + number(item.contractedPrice), 0),
    };
  }
  async function loadHomeMetrics(reference = now()) {
    const due = await loadExpiring(7, reference, 50), endToday = new Date(reference);
    endToday.setHours(23, 59, 59, 999);
    return {
      dueToday: due.filter((item) => new Date(item.expiresAt) <= endToday).length,
      due7: due.filter((item) => new Date(item.expiresAt) > endToday).length,
      forecastValue: due.reduce((sum, item) => sum + number(item.contractedPrice), 0),
      clientIds: [...new Set(due.map((item) => item.clientId).filter(Boolean))],
    };
  }
  return { duration, addDuration, effectiveStatus, list, events, get, forClient, matching, matchingProduct, preview, applySaleInData, reverseSaleInData, changeStatus, upcoming, metrics, loadForClient, loadUpcoming, loadByStatus, loadExpiring, loadExpired, loadRecentlyRenewed, loadDashboardMetrics, loadHomeMetrics };
})();

 return{campaigns:window.CampaignEngineV2,subscriptions:window.CustomerSubscriptions};
};
