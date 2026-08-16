(function () {
  "use strict";
  const now = () => new Date().toISOString();
  const empty = () => ({ banners: [], categories: {}, products: {}, views7d: null, version: 1 });
  function settings() {
    const config = DB.carregar().config.catalogSettings || {};
    return { ...empty(), ...(config.presentation || {}), banners: Array.isArray(config.presentation?.banners) ? config.presentation.banners : [], categories: config.presentation?.categories || {}, products: config.presentation?.products || {} };
  }
  function update(mutator, publish = true) {
    DB.alterar((data) => { const current = { ...empty(), ...(data.config.catalogSettings?.presentation || {}) }; current.banners = [...(current.banners || [])]; current.categories = { ...(current.categories || {}) }; current.products = { ...(current.products || {}) }; mutator(current); current.version = 1; current.updatedAt = now(); data.config.catalogSettings = { ...(data.config.catalogSettings || {}), presentation: current, updatedAt: now() }; });
    if (publish) window.CatalogoUniversal?.publish?.();
    return settings();
  }
  const categoryKey = (value) => String(value || "Outros").trim() || "Outros";
  function categories() {
    const presentation = settings(), names = [...new Set((DB.carregar().produtos || []).filter((p) => p.ativo !== false).map((p) => categoryKey(p.categoria)))];
    return names.map((internalName, index) => ({ internalName, publicName: internalName, active: true, order: index, imageUrl: "", imageThumbUrl: "", imageStoragePath: "", imageThumbStoragePath: "", ...(presentation.categories[internalName] || {}) })).sort((a, b) => Number(a.order) - Number(b.order) || a.publicName.localeCompare(b.publicName, "pt-BR"));
  }
  function product(product) { return { published: product.catalogVisible !== false, publicName: product.nome, description: product.descricao || product.palavrasChave || "", price: Number(product.preco || product.minPrice || 0), category: categoryKey(product.catalogCategory || product.categoria), imageMode: "product", imageUrl: "", imageThumbUrl: "", featured: Boolean(product.catalogFeatured || product.favorito), order: Number(product.catalogSortOrder || 0), availability: "inherit", ...(settings().products[product.id] || {}) }; }
  function decorate(product, snapshot) {
    const value = product && window.CatalogPresentation.product(product), category = value ? categories().find((item) => item.internalName === value.category || item.publicName === value.category) : null;
    if (!value) return snapshot;
    return { ...snapshot, productName: value.publicName || snapshot.productName, description: value.description ?? snapshot.description, salePrice: Number(value.price ?? snapshot.salePrice), category: category?.publicName || value.category || snapshot.category, productImage: value.imageMode === "catalog" && value.imageThumbUrl ? value.imageThumbUrl : snapshot.productImage, productMainImage: value.imageMode === "catalog" && value.imageUrl ? value.imageUrl : snapshot.productMainImage, catalogImageMode: value.imageMode, featured: Boolean(value.featured), active: value.published !== false && category?.active !== false, displayOrder: Number(value.order ?? snapshot.displayOrder) };
  }
  function saveCategory(key, patch) { return update((state) => { state.categories[categoryKey(key)] = { ...(state.categories[categoryKey(key)] || {}), ...patch, internalName: categoryKey(key), updatedAt: now() }; }); }
  function moveCategory(key, direction) { return update((state) => { const list = categories(), index = list.findIndex((item) => item.internalName === key), target = index + direction; if (index < 0 || target < 0 || target >= list.length) return; const first = list[index], second = list[target]; state.categories[first.internalName] = { ...(state.categories[first.internalName] || {}), order: second.order, updatedAt: now() }; state.categories[second.internalName] = { ...(state.categories[second.internalName] || {}), order: first.order, updatedAt: now() }; }); }
  function saveProduct(id, patch) { return update((state) => { state.products[id] = { ...(state.products[id] || {}), ...patch, productId: id, updatedAt: now() }; }); }
  function saveBanner(input) { let stored; update((state) => { const index = state.banners.findIndex((item) => item.id === input.id), old = index >= 0 ? state.banners[index] : {}; stored = { ...old, ...input, id: input.id || Utils.uuid(), active: input.active !== false, order: Number(input.order ?? old.order ?? state.banners.length), createdAt: old.createdAt || now(), updatedAt: now() }; if (index >= 0) state.banners[index] = stored; else state.banners.push(stored); }); return stored; }
  function removeBanner(id) { return update((state) => { const item = state.banners.find((entry) => entry.id === id); if (item) { item.active = false; item.deletedAt = now(); item.updatedAt = now(); } }); }
  function moveBanner(id, direction) { return update((state) => { const list = state.banners.filter((item) => !item.deletedAt).sort((a, b) => Number(a.order) - Number(b.order)), index = list.findIndex((item) => item.id === id), target = index + direction; if (index < 0 || target < 0 || target >= list.length) return; [list[index].order, list[target].order] = [list[target].order, list[index].order]; list[index].updatedAt = list[target].updatedAt = now(); }); }
  window.CatalogPresentation = { empty, settings, update, categories, product, decorate, saveCategory, moveCategory, saveProduct, saveBanner, removeBanner, moveBanner };
})();
