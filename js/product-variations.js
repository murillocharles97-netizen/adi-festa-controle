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
  const isVariable = (product) => product?.productType === "variable";
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
  const recomputeInData = (data, parentProductId) => {
    const product = (data.produtos || []).find(
      (item) => item.id === parentProductId,
    );
    if (!product || !isVariable(product)) return product || null;
    const variants = active(parentProductId, data),
      prices = variants.map((item) => num(item.price)),
      stock = variants.reduce((sum, item) => sum + num(item.stock), 0);
    product.activeVariationCount = variants.length;
    product.totalStock = stock;
    product.estoqueAtual = stock;
    product.estoque = stock;
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
    product.hasAvailableStock = variants.some(
      (item) => item.allowNegativeStock || num(item.stock) > 0,
    );
    product.atualizadoEm = now();
    product.schemaVersion = 10;
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
      schemaVersion: 10,
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
      const stockChanged = existing && num(existing.stock) !== num(next.stock),
        previousStock = existing ? num(existing.stock) : 0;
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
        productType: "variable",
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
        schemaVersion: 10,
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
      if (product?.semControleEstoque || product?.controlaEstoque === false)
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
      };
      data.movimentacoesEstoque.push(movement);
      recomputeInData(data, parentProductId);
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
