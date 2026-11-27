window.Checkout = (() => {
  const { escapar, dinheiro, somenteNumeros, toast } = Utils;
  const norm = (v) =>
    String(v || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const products = () => Repositories.productRepository(),
    clients = () => Repositories.clientRepository();
  const selectedSalesSpaceId = () =>
      String(window.SpaceContext?.salesId?.() || "").trim(),
    productAvailableHere = (product, spaceId = selectedSalesSpaceId()) =>
      window.SpaceEngine?.productAllowsSpace
        ? Boolean(spaceId) && window.SpaceEngine.productAllowsSpace(product, spaceId)
        : true,
    saleInCurrentSpace = (sale, spaceId, knownIds) => {
      if (
        window.SpaceEngine?.isValidSale &&
        !window.SpaceEngine.isValidSale(sale)
      )
        return false;
      if (!window.SpaceEngine?.saleBelongsTo || !spaceId) return true;
      return window.SpaceEngine.saleBelongsTo(sale, spaceId, knownIds);
    };
  function availableCustomers() {
    const data = DB.carregar(), businessId = DB.getBusinessId?.();
    const scoped = window.SpaceContext?.customersForView?.(data);
    return (scoped ? scoped.clients : clients().list()).filter(client =>
      client.ativo !== false && client.active !== false && !client.deletedAt &&
      (!client.businessId || client.businessId === businessId));
  }
  function soldIndex() {
    if (catalog.sold) return catalog.sold;
    const next = new Map();
    catalogSales().forEach((sale) =>
      (sale.itens || []).forEach((item) =>
        next.set(
          item.produtoId,
          (next.get(item.produtoId) || 0) + Number(item.quantidade || 0),
        ),
      ),
    );
    return catalog.sold = next;
  }
  const initials = (n) =>
    String(n || "?")
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0])
      .join("")
      .toUpperCase();
  const cartKey = (item) =>
    window.FlexibleService?.itemKey(item) || (item?.productType === "recurring"
      ? `${item.produtoId}::${item.variantId || "base"}::${item.recurringActivation?.subscriptionId || item.recurringActivation?.draftId || "new"}`
      : window.ProductVariations?.itemKey(item) || String(item?.produtoId || ""));
  const priceLabel = (p) => window.FlexibleServiceUI?.priceLabel(p) || (
    window.ProductVariations?.isVariable?.(p)
      ? Number(p.minPrice) === Number(p.maxPrice)
        ? dinheiro(p.minPrice)
        : `${dinheiro(p.minPrice)} – ${dinheiro(p.maxPrice)}`
      : dinheiro(p.preco));
  const balance = (c) => {
    if (window.SpaceContext?.scopesCustomers?.()) return '<span class="badge balance-badge zero">Saldo por espaço</span>';
    const s = Number(c.saldo || 0);
    return s < 0
      ? `<span class="badge balance-badge debit">Deve ${dinheiro(Math.abs(s))}</span>`
      : s > 0
        ? `<span class="badge balance-badge credit">Crédito ${dinheiro(s)}</span>`
        : '<span class="badge balance-badge zero">Sem saldo</span>';
  };
  const stock = (p, mobile) => {
    const icon = mobile ? '<i data-lucide="box"></i>' : "";
    const current = Number(
      window.ProductVariations?.isVariable?.(p) ? p.totalStock : (p.estoqueAtual ?? p.estoque ?? 0),
    );
    const status = getProductStockStatus(p);
    return status === "sem-controle"
      ? '<small class="pos-stock-neutral">Sem controle de estoque</small>'
      : status === "esgotado"
        ? `<small class="pos-stock-out">${icon}Sem estoque</small>`
        : status === "baixo"
          ? `<small class="pos-stock-low">${icon}Estoque: ${current} · baixo</small>`
          : `<small class="pos-stock-ok">${icon}Estoque: ${current}</small>`;
  };
  function mobileSearch(p, variants) {
    const variation = variants.map(v =>
      [v.displayName, v.sku, v.barcode, ...Object.values(v.attributeValues || {})].join(" ")
    ).join(" ") || (p.variationSearchTokens || []).join(" ");
    return norm([p.nome, p.codigo, p.barcode, p.categoria, p.palavrasChave, variation].join(" "));
  }
  const card = (p, options = {}) => {
    const variants = options.variants ?? (
      window.ProductVariations?.isVariable?.(p) ? window.ProductVariations.list(p.id) : []
    );
    const mobile = window.matchMedia?.("(max-width:767px)").matches === true;
    const variable = window.ProductVariations?.isVariable?.(p);
    const photo = window.ProductImages?.markup?.(p, { className: "sale-product-photo" }) || `<span class="pos-placeholder">${initials(p.nome)}</span>`;
    const recurring = p.productType === "recurring",
      controlsStock = window.productControlsStock?.(p) ?? (!p.semControleEstoque && p.controlaEstoque !== false),
      category = escapar(p.categoria || (mobile ? "Sem categoria" : p.nome)),
      detail = variable ? `${mobile ? category + " · " : ""}${Number(p.activeVariationCount || 0)} opções` : category,
      renewal = recurring && !controlsStock
        ? `<small class="pos-renewal-badge"><i data-lucide="calendar-clock"></i>${escapar(window.getProductRenewalPeriod?.(p) || `${Number(p.durationValue || 30)} ${durationUnitLabel(p.durationUnit, Number(p.durationValue || 30))}`)}</small>`
        : stock(p, mobile);
    const copy = `<strong class="${mobile ? "mobile-card-name" : ""}">${escapar(p.nome)}</strong><small class="pos-full-name">${detail}</small><b class="${mobile ? "mobile-card-price" : ""}">${priceLabel(p)}</b>`;
    const content = mobile
      ? `<div class="mobile-card-media">${photo}</div><div class="mobile-card-copy">${copy}</div><div class="mobile-card-stock">${renewal}</div>`
      : `${photo}${copy}${renewal}`;
    const addAttribute = options.consignment ? 'data-delivery-product' : 'data-add';
    const stockAttribute = options.consignment ? 'data-delivery-qty' : 'data-pos-qty';
    return `<article class="pos-product ${mobile ? "mobile-catalog-card" : ""} ${variable ? "is-variable" : ""} ${recurring ? "is-recurring" : ""}" ${addAttribute}="${p.id}" data-search="${escapar(mobileSearch(p, variants))}" data-category="${escapar(norm(p.categoria))}" title="${escapar(p.nome)}"><span class="pos-qty" ${stockAttribute}="${p.id}" hidden>0</span>${!mobile && p.favorito ? '<span class="pos-favorite" aria-label="Favorito">★</span>' : ""}${content}<button class="pos-product-hit" type="button" aria-label="Adicionar ${escapar(p.nome)}"></button>${mobile || options.consignment ? "" : `<button class="sale-product-actions" type="button" data-sale-product-menu aria-haspopup="dialog" aria-label="Opções de ${escapar(p.nome)}"><i data-lucide="ellipsis-vertical"></i></button>`}</article>`;
  };
  const durationUnitLabel = (unit, value = 2) => ({ days: value === 1 ? "dia" : "dias", weeks: value === 1 ? "semana" : "semanas", months: value === 1 ? "mês" : "meses", years: value === 1 ? "ano" : "anos" }[unit] || (value === 1 ? "dia" : "dias"));
  function view() {
    retireSpaceDraft();
    restoreDraft();
    loadCatalog();
    const ps = catalog.products,
      cats = [...new Set(ps.map(p => p.categoria).filter(Boolean))].sort(),
      spaceBar = window.SpaceContext?.renderBar?.("sales") || "";
    if (catalog.desktop) {
      return `${spaceBar}${window.DesktopSales.render({
        products: ps,
        clients: availableCustomers(),
        cart,
        totals: totals(cart),
        recentProducts: desktopRecentProducts(),
        gridHTML: initialCatalog(),
      })}`;
    }
    return `<div class="pos-page">${spaceBar}<div class="pos-head"><h2>Nova venda</h2><p>Toque nos produtos para adicionar à sacola.</p></div><div class="prior-sale-entry" data-prior-entry>${window.PriorSales?.actionMarkup?.()||''}</div><section class="pos-tools"><div class="pos-search-wrap"><i data-lucide="search"></i><input class="search" id="product-search" autocomplete="off" placeholder="Buscar produto, código ou categoria"><button class="icon-btn" id="clear-product-search"><i data-lucide="x"></i></button><button type="button" data-scan-sale aria-label="Ler código de barras"><i data-lucide="scan-barcode"></i></button></div><select id="pos-category"><option value="">Categorias</option>${cats.map((c) => `<option value="${escapar(norm(c))}">${escapar(c)}</option>`).join("")}</select><select id="pos-filter"><option value="todos">Todos</option><option value="favoritos">Favoritos</option><option value="estoque">Em estoque</option><option value="baixo">Estoque baixo</option></select><select id="pos-sort"><option value="favoritos">Favoritos primeiro</option><option value="nome">Nome</option><option value="vendidos">Mais vendidos</option><option value="categoria">Categoria</option><option value="preco">Preço</option></select></section><section class="pos-grid" id="pos-grid">${initialCatalog()}</section><div class="pos-summary-overlay" data-sale-cart-overlay hidden></div><section class="pos-summary" id="pos-summary" role="dialog" aria-modal="true" aria-labelledby="sale-summary-title" aria-hidden="true" hidden><div class="pos-summary-head"><div><h3 id="sale-summary-title">Carrinho</h3><p>Revise os itens, cliente e pagamento.</p></div><button class="icon-btn" id="close-sale-summary" aria-label="Fechar carrinho"><i data-lucide="x"></i></button></div><div id="cart"></div><div class="discount-grid"><div class="field"><label>Desconto em R$</label><input id="discount-value" type="number" inputmode="decimal" min="0" step=".01" value="0"></div><div class="field"><label>Desconto em %</label><input id="discount-percent" type="number" inputmode="decimal" min="0" max="100" step=".01" value="0"></div></div><div class="field"><label>Valor final da venda</label><input id="manual-total" type="number" inputmode="decimal" min="0" step=".01" value="0"></div><div id="sale-totals"></div><div class="pos-client-card" id="selected-client-card"></div><select id="sale-client" class="visually-hidden" data-deferred-customers="true"><option value="">Venda avulsa</option></select><button class="btn btn-light pos-client-select" id="open-client-picker"><i data-lucide="users"></i><span>Selecionar cliente ou venda avulsa</span></button><div class="field sale-payment-method-field"><label>Forma de pagamento</label><select id="sale-payment-method"><option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option><option value="cartao_presencial" hidden disabled>Maquininha integrada</option><option value="fiado">Fiado</option>${window.AdiFestaBuild?.installmentCreationPaused||window.OperationalReadPolicy?.restricted?.()?'':'<option value="crediario">Parcelado</option>'}</select></div>${window.InstallmentCredit?.fields()||''}<select id="sale-status" class="visually-hidden" aria-hidden="true" tabindex="-1"><option value="pago">Pago agora</option><option value="fiado">Fiado</option></select><div id="debt-preview"></div><div class="field"><label>Observação</label><textarea id="sale-note" placeholder="Opcional"></textarea></div><div class="sale-submit-feedback" id="sale-submit-feedback" role="status" aria-live="polite" hidden></div><button class="btn btn-primary" id="finish-sale" data-sale-state="normal"><i data-lucide="check"></i> Concluir venda</button></section><button class="pos-bag is-empty" id="open-sale-summary" aria-controls="pos-summary" aria-expanded="false" aria-label="Sacola vazia"><i data-lucide="shopping-bag"></i><span class="visually-hidden" id="pos-bag-label">Nenhum item selecionado</span><b class="visually-hidden" id="pos-bag-total">${dinheiro(0)}</b></button></div>`;
  }
  const state = () =>
    [...document.querySelectorAll("[data-item-qty]")].reduce(
      (a, x) => ((a[x.dataset.itemQty] = Number(x.value || 0)), a),
      {},
    );
  function refresh() {
    const st = state(),
      items = Object.values(st).reduce((a, b) => a + b, 0),
      rawTotal = [...document.querySelectorAll(".editable-cart")].reduce(
        (s, row) =>
          s +
          Number(row.querySelector("[data-item-qty]")?.value || 0) *
            Number(row.querySelector("[data-item-price]")?.value || 0),
        0,
      ),
      total = Number(document.querySelector("#manual-total")?.value || rawTotal);
    paintCatalogQuantities(document);
    const bagLabel = document.querySelector("#pos-bag-label"),
      bagTotal = document.querySelector("#pos-bag-total"),
      cartCount = document.querySelector("#desktop-cart-count"),
      ctaTotal = document.querySelector("#desktop-cta-total"),
      finishTotal = document.querySelector("#desktop-finish-total"),
      cartBadge = document.querySelector("[data-desktop-cart-badge]"),
      discountPreview = document.querySelector("#desktop-discount-preview"),
      currentTotals = totals();
    if (bagLabel)
      bagLabel.textContent = items
        ? `${items} ${items === 1 ? "item" : "itens"} · ${dinheiro(total)}`
        : "Nenhum item selecionado";
    if (bagTotal) bagTotal.textContent = dinheiro(total);
    if (cartBadge) cartBadge.textContent = items > 99 ? "99+" : String(items);
    if (cartCount)
      cartCount.textContent = `${items} ${items === 1 ? "item" : "itens"}`;
    if (ctaTotal) ctaTotal.textContent = `• ${dinheiro(currentTotals.final)}`;
    if (finishTotal)
      finishTotal.textContent = `• ${dinheiro(currentTotals.final)}`;
    if (discountPreview)
      discountPreview.textContent = dinheiro(currentTotals.discount);
    selectedClient();
  }
  function selectedClient() {
    const sel = document.querySelector("#sale-client"),
      box = document.querySelector("#selected-client-card"),
      label = document.querySelector(".pos-client-select span"),
      c = sel?.value ? clients().getById(sel.value) : null;
    if (!sel || !box || !label) return;
    box.classList.toggle('has-service-beneficiary', Boolean(document.querySelector('#sale-beneficiary')?.value.trim()));
    if (!c) {
      label.textContent = "Selecionar cliente ou venda avulsa";
      box.innerHTML = '<span class="muted">Venda avulsa selecionada</span>';
      return;
    }
    const total = Number(document.querySelector("#manual-total")?.value || 0),
      fiado = document.querySelector("#sale-status")?.value === "fiado",
      parcelado = document.querySelector("#sale-payment-method")?.value === "crediario",
      deve = Math.abs(Math.min(0, Number(c.saldo || 0)));
    const preview = parcelado
      ? '<div data-installment-checkout-preview aria-live="polite">Consultando o saldo no servidor…</div>'
      : `<p>${balance(c)}</p>${fiado ? `<p class="pos-fiado-preview">${window.SpaceContext?.scopesCustomers?.() ? `Fiado desta venda: <b>${dinheiro(total)}</b>. Consulte o saldo na conta deste espaço.` : `Após esta venda: <b>${dinheiro(deve + total)} em aberto</b>`}</p>` : ""}`;
    label.textContent = c.nome;
    box.innerHTML = `<div><small>${document.querySelector('#sale-beneficiary')?.value.trim() ? 'Responsável pelo pagamento' : 'Cliente'}</small><b>${escapar(c.nome)}</b>${preview}</div><div><button class="icon-btn" data-change-client><i data-lucide="repeat-2"></i></button>${somenteNumeros(c.telefone).length >= 10 ? `<button class="icon-btn" data-client-wa="${c.id}"><i data-lucide="message-circle"></i></button>` : ""}</div>`;
    if(parcelado)window.InstallmentCredit.mountCheckoutPreview(box.querySelector('[data-installment-checkout-preview]'),c,total);
    window.lucide?.createIcons();
  }
  const CATALOG_BATCH = 36;
  let catalog, savedCatalogView;
  const catalogGrid = () => control("desktop-sale-products") || control("pos-grid");
  const catalogPage = () => document.querySelector("[data-desktop-sales],.pos-page");
  const catalogControls = ["product-search", "pos-category", "desktop-sale-brand", "pos-filter", "pos-sort"];
  const control = id => document.getElementById(id);

  function loadCatalog() {
    const space = selectedSalesSpaceId();
    const list = products().list().filter(product => product.ativo !== false && productAvailableHere(product, space));
    const variants = new Map();
    for (const variant of DB.carregar().variacoesProdutos || []) {
      if (!variants.has(variant.parentProductId)) variants.set(variant.parentProductId, []);
      variants.get(variant.parentProductId).push(variant);
    }
    catalog = {
      products: list, matches: list, variants, search: new Map(), shown: 0,
      byId: new Map(list.map(product => [String(product.id), product])),
      space, scope: catalogViewScope(), desktop: Boolean(window.DesktopSales?.isDesktop?.()),
    };
  }

  function catalogSales() {
    if (catalog.spaceSales) return catalog.spaceSales;
    const knownIds = new Set((window.SpaceContext?.list?.() || []).map(row => row.id));
    return catalog.spaceSales = Repositories.saleRepository().list()
      .filter(sale => saleInCurrentSpace(sale, catalog.space, knownIds));
  }

  function desktopRecentProducts() {
    const seen = new Set(), recent = [];
    [...catalogSales()].reverse().some(sale => [...(sale.itens || [])].reverse().some(item => {
      const product = catalog.byId.get(String(item.produtoId));
      if (!product || seen.has(product.id)) return false;
      seen.add(product.id);
      recent.push(product);
      return recent.length === 5;
    }));
    return recent;
  }

  function mobileRecentRanks() {
    const ordered = catalogSales().map((sale, index) => ({
      sale, index, at: Date.parse(sale.data || sale.occurredAt || sale.createdAt) || 0,
    })).sort((a, b) => b.at - a.at || b.index - a.index);
    const ranks = new Map();
    for (const { sale } of ordered) for (const item of sale.itens || []) {
      const id = String(item.produtoId);
      if (!catalog.byId.has(id) || ranks.has(id)) continue;
      ranks.set(id, ranks.size);
      if (ranks.size === 8) return ranks;
    }
    return ranks;
  }

  function catalogVariants(product) {
    return catalog.desktop || window.ProductVariations?.isVariable?.(product)
      ? catalog.variants.get(product.id) || [] : [];
  }

  function catalogCards(from, to) {
    return catalog.matches.slice(from, to).map(product => {
      const options = { variants: catalogVariants(product) };
      return catalog.desktop ? window.DesktopSales.catalogCard(product, options) : card(product, options);
    }).join("");
  }

  const moreCatalog = () => catalog.shown < catalog.matches.length
    ? '<button class="btn btn-light sale-catalog-more" type="button" data-sale-catalog-more>Mostrar mais produtos</button>'
    : "";

  function initialCatalog() {
    catalog.shown = Math.min(CATALOG_BATCH, catalog.matches.length);
    return catalogCards(0, catalog.shown) + moreCatalog() || catalogEmpty(false);
  }

  function catalogEmpty(filtered, recent = false) {
    if (catalog.desktop) return window.DesktopSales.emptyCatalog(filtered);
    if (recent) return '<div class="mobile-sale-empty">Nenhuma venda recente neste espaço.</div>';
    return filtered
      ? '<div class="mobile-sale-empty">Nenhum produto encontrado.</div>'
      : '<div class="empty">Nenhum produto disponível neste espaço</div>';
  }

  function paintCatalogQuantities(root) {
    const quantities = new Map();
    for (const item of cart) quantities.set(String(item.produtoId),
      (quantities.get(String(item.produtoId)) || 0) + Number(item.quantidade || 0));
    root.querySelectorAll("[data-pos-qty]").forEach(badge => {
      const quantity = quantities.get(badge.dataset.posQty) || 0;
      if (badge.dataset.quantity === String(quantity)) return;
      badge.hidden = !quantity;
      badge.dataset.quantity = String(quantity);
      badge.textContent = quantity;
      badge.closest(".pos-product")?.classList.toggle("selected", Boolean(quantity));
    });
  }

  function loadMoreCatalog(button) {
    const grid = catalogGrid(), from = catalog.shown;
    catalog.shown = Math.min(from + CATALOG_BATCH, catalog.matches.length);
    const fragment = document.createElement("template");
    fragment.innerHTML = catalogCards(from, catalog.shown) + moreCatalog();
    const first = fragment.content.firstElementChild;
    const keyboard = document.activeElement === button;
    button.replaceWith(fragment.content);
    paintCatalogQuantities(grid);
    window.CheckoutMobile?.decorateProducts?.(grid, catalog.byId);
    window.lucide?.createIcons();
    if (keyboard) first?.querySelector("button")?.focus();
  }

  function renderCatalog(grid, filtered, recent = false) {
    grid.innerHTML = catalogCards(0, catalog.shown) + moreCatalog() || catalogEmpty(filtered, recent);
    paintCatalogQuantities(grid);
    window.CheckoutMobile?.decorateProducts?.(grid, catalog.byId);
    window.lucide?.createIcons();
  }

  function filter(event, { keepLimit = false } = {}) {
    const grid = catalogGrid();
    if (!grid || !catalog) return;
    const q = norm(control("product-search")?.value),
      category = control("pos-category")?.value || "",
      brand = control("desktop-sale-brand")?.value || "",
      mode = control("pos-filter")?.value || "todos",
      sort = control("pos-sort")?.value || "nome";
    const onlyRecent = !catalog.desktop && catalogPage()?.dataset.saleView === "recent";
    const recent = onlyRecent ? mobileRecentRanks() : null;
    const sold = sort === "vendidos" && !recent ? soldIndex() : null;
    const favorites = new Set();
    if (mode === "favoritos" || sort === "favoritos") for (const product of catalog.products) {
      const active = catalog.desktop ? product.favorito : (window.Produtos?.mobileFavoriteValue?.(product) ?? product.favorito);
      if (active) favorites.add(product.id);
    }
    const matches = catalog.products.filter(p => {
      if (recent && !recent.has(String(p.id))) return false;
      if (category && norm(p.categoria) !== category) return false;
      if (brand && norm(p.marca || p.brand) !== brand) return false;
      if (q) {
        if (!catalog.search.has(p.id)) {
          const variants = catalogVariants(p);
          catalog.search.set(p.id, catalog.desktop ? window.DesktopSales.productSearch(p, variants) : mobileSearch(p, variants));
        }
        if (!catalog.search.get(p.id).includes(q)) return false;
      }
      if (mode === "todos") return true;
      if (mode === "favoritos") return favorites.has(p.id);
      const stock = Number(window.ProductVariations?.isVariable?.(p) ? p.totalStock : p.estoqueAtual);
      const controlsStock = window.productControlsStock?.(p) ?? (!p.semControleEstoque && p.controlaEstoque !== false);
      return controlsStock && stock > 0 && (mode === "estoque" || (mode === "baixo" && stock <= Number(p.estoqueMinimo || 0)));
    });
    matches.sort((a, b) => {
      if (recent) return recent.get(String(a.id)) - recent.get(String(b.id));
      if (sort === "preco") return a.preco - b.preco;
      if (sort === "categoria") return String(a.categoria).localeCompare(String(b.categoria));
      if (sold) return (sold.get(b.id) || 0) - (sold.get(a.id) || 0);
      if (sort === "favoritos" && favorites.has(a.id) !== favorites.has(b.id)) return favorites.has(b.id) ? 1 : -1;
      return a.nome.localeCompare(b.nome);
    });
    catalog.filtered = true;
    const focusedFavorite = grid.contains(document.activeElement) && document.activeElement.dataset.fav;
    const preserve = keepLimit || event?.detail?.favoriteIds;
    const limit = preserve ? Math.max(CATALOG_BATCH, catalog.shown) : CATALOG_BATCH;
    catalog.matches = matches;
    catalog.shown = Math.min(limit, matches.length);
    renderCatalog(grid, true, onlyRecent && !q);
    if (focusedFavorite) grid.querySelector(`[data-fav="${CSS.escape(focusedFavorite)}"]`)?.focus({ preventScroll: true });
    dispatchEvent(new CustomEvent("sale-products-filtered", { detail: { query: q, visible: matches.length } }));
  }

  const catalogViewScope = () => JSON.stringify([draftKey(), draftPrincipal()]);

  function captureCatalogView() {
    if (!catalog || !catalogPage()) return;
    savedCatalogView = {
      scope: catalog.scope, scroll: window.scrollY, shown: catalog.shown,
      controls: catalogControls.map(id => control(id)?.value),
      mobileView: catalogPage().dataset.saleView, filtered: catalog.filtered,
    };
  }

  function restoreCatalogView() {
    const saved = savedCatalogView, page = catalogPage();
    if (!saved || !page || saved.scope !== catalogViewScope()) return;
    catalogControls.forEach((id, index) => {
      const node = control(id), value = saved.controls[index];
      if (node && value !== undefined && (!node.options || [...node.options].some(option => option.value === value))) node.value = value;
    });
    if (saved.mobileView && !catalog.desktop) page.dataset.saleView = saved.mobileView;
    const favorite = control("desktop-sale-favorites");
    if (favorite) favorite.setAttribute("aria-pressed", String(control("pos-filter").value === "favoritos"));
    if (saved.filtered || saved.shown > catalog.shown) {
      catalog.shown = saved.shown;
      if (saved.filtered) filter(null, { keepLimit: true });
      else {
        catalog.shown = Math.min(catalog.shown, catalog.matches.length);
        renderCatalog(catalogGrid(), false);
      }
    }
    if (saved.scroll) requestAnimationFrame(() => {
      if (page.isConnected && catalogPage() === page) window.scrollTo({ top: saved.scroll, behavior: "instant" });
    });
  }

  function refreshProducts(event) {
    const grid = catalogGrid();
    if (!grid || !catalog) return false;
    const { shown, filtered, desktop } = catalog;
    loadCatalog();
    catalog.desktop = desktop;
    catalog.shown = shown;
    const category = control("pos-category"), selected = category?.value;
    if (catalog.desktop) {
      window.DesktopSales.refreshCatalogControls(catalog.products, desktopRecentProducts());
    } else if (category) {
      const categories = [...new Set(catalog.products.map(p => p.categoria).filter(Boolean))].sort();
      category.innerHTML = `<option value="">Categorias</option>${categories.map(name =>
        `<option value="${escapar(norm(name))}">${escapar(name)}</option>`).join("")}`;
      if ([...category.options].some(option => option.value === selected)) category.value = selected;
    }
    if (filtered || event?.detail?.favoriteIds) filter(event, { keepLimit: true });
    else {
      catalog.shown = Math.min(Math.max(CATALOG_BATCH, shown), catalog.matches.length);
      renderCatalog(grid, false);
      dispatchEvent(new CustomEvent("sale-products-filtered", { detail: { query: "", visible: catalog.matches.length } }));
    }
    return true;
  }
  function refreshClients() {
    const select = document.querySelector("#sale-client");
    if (!select) return false;
    const selected = select.value;
    if (select.dataset?.deferredCustomers) {
      if (selected) {
        const client = availableCustomers().find(c => String(c.id) === selected);
        if (client) select.options[select.selectedIndex].textContent = client.nome;
        else select.value = "";
      }
      selectedClient();
      return true;
    }
    select.innerHTML = `<option value="">Venda avulsa</option>${availableCustomers()
      .map(
        (client) =>
          `<option value="${escapar(client.id)}">${escapar(client.nome)}</option>`,
      )
      .join("")}`;
    if ([...select.options].some((option) => option.value === selected))
      select.value = selected;
    selectedClient();
    return true;
  }
  const row = (c) =>
    `<button class="client-choice" data-choose-client="${c.id}"><div><b>${escapar(c.nome)}</b><small>${escapar(c.telefone) || "Sem telefone"}${c.ultimaCompra ? ` · Última compra: ${new Date(c.ultimaCompra).toLocaleDateString("pt-BR")}` : ""}</small></div>${balance(c)}</button>`;
  function setSaleCustomer(id, select = document.querySelector("#sale-client")) {
    if (!select) return false;
    if (id && select.dataset?.deferredCustomers) {
      const client = availableCustomers().find(c => String(c.id) === String(id));
      if (!client) { select.value = ""; return false; }
      if (![...select.options].some(option => option.value === String(id)))
        select.add(new Option(client.nome, String(id)));
    }
    select.value = id || "";
    return select.value === String(id || "");
  }
  function picker(onSelected = null, options = {}) {
    const pickerOrigin = {
      businessId: DB.getBusinessId(),
      principal: DB.getPrincipal(),
      generation: DB.getWorkspaceGeneration(),
      spaceId: selectedSalesSpaceId(),
    };
    const all = availableCustomers()
        .sort((a, b) => a.nome.localeCompare(b.nome)),
      recent = DB.getRecentClientIds()
        .map((id) => all.find((c) => c.id === id))
        .filter(Boolean);
    const modal = document.querySelector("#modal");
    const customerAction = window.Clientes?.canCreate?.() === false
      ? '<p class="muted" role="note">Seu perfil pode selecionar clientes existentes. Novos cadastros precisam do responsável.</p>'
      : '<button class="btn btn-primary" id="quick-new-client"><i data-lucide="user-plus"></i> Novo cliente</button>';
    modal.innerHTML =
      `<div class="modal-bg checkout-customer-bg"><section class="modal-box client-picker" role="dialog" aria-modal="true" aria-label="Selecionar cliente"><header class="modal-head"><h3>${escapar(options.title || "Selecionar cliente")}</h3><button class="icon-btn close" aria-label="Fechar seleção"><i data-lucide="x"></i></button></header><div class="client-search"><i data-lucide="search"></i><input id="client-picker-search" autofocus autocomplete="off" placeholder="Buscar por nome ou telefone"></div><div class="client-picker-body">${options.requireClient ? "" : '<button class="client-choice guest" data-choose-client=""><div><b>Venda avulsa</b><small>Sem cliente vinculado</small></div><i data-lucide="user-round"></i></button>'}${customerAction}<div id="client-results">${recent.length ? `<h4>Clientes recentes deste espaço</h4>${recent.map(row).join("")}` : ""}<h4>Clientes deste espaço</h4><div id="client-result-list">${all.slice(0, 30).map(row).join("") || '<p class="empty">Nenhum cliente vinculado a este espaço.</p>'}</div><p class="muted" id="client-result-more">${all.length > 30 ? "Digite para filtrar a lista completa." : ""}</p></div></div></section></div>`;
    const input = document.querySelector("#client-picker-search"),
      results = document.querySelector("#client-result-list"),
      more = document.querySelector("#client-result-more");
    let timer, closed = false;
    const currentPicker = () => !closed &&
      pickerOrigin.businessId === DB.getBusinessId() &&
      pickerOrigin.principal === DB.getPrincipal() &&
      pickerOrigin.generation === DB.getWorkspaceGeneration() &&
      pickerOrigin.spaceId === selectedSalesSpaceId() &&
      document.querySelector("#modal") === modal &&
      document.querySelector("#client-picker-search") === input &&
      document.querySelector("#client-result-list") === results &&
      document.querySelector("#client-result-more") === more;
    const close = () => {
      const ownsModal = modal.querySelector('#client-picker-search') === input;
      closed = true;
      clearTimeout(timer);
      window.removeEventListener('veconi-space-context-changed', close);
      window.removeEventListener('business-context-changed', close);
      window.removeEventListener('firebase-session-cleared', close);
      if (ownsModal) modal.innerHTML = "";
      if (ownsModal) document.querySelector('#open-client-picker')?.focus({preventScroll:true});
    };
    ['veconi-space-context-changed','business-context-changed','firebase-session-cleared'].forEach(event => window.addEventListener(event, close));
    modal.querySelector('.checkout-customer-bg').onclick = event => { if (event.target === event.currentTarget) close(); };
    modal.querySelector('.client-picker').onkeydown = event => { if (event.key === 'Escape') { event.stopPropagation(); close(); } };
    document
      .querySelectorAll("#modal .close")
      .forEach((x) => (x.onclick = close));
    input.oninput = () => {
      if (!currentPicker()) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (!currentPicker()) return;
        const q = norm(input.value),
          d = somenteNumeros(input.value),
          found = all.filter(
            (c) =>
              !q ||
              norm(
                `${c.nome} ${c.telefone} ${c.telefone2} ${c.observacoes}`,
              ).includes(q) ||
              (d && somenteNumeros(`${c.telefone}${c.telefone2}`).includes(d)),
          );
        results.innerHTML =
          found.slice(0, 60).map(row).join("") ||
          '<p class="empty">Nenhum cliente encontrado</p>';
        more.textContent =
          found.length > 60 ? "Mostrando 60 resultados. Refine a busca." : "";
        window.lucide?.createIcons();
      }, 130);
    };
    modal.onclick = (e) => {
      if (!currentPicker()) return;
      const b = e.target.closest("[data-choose-client]");
      if (b) {
        const sel = document.querySelector("#sale-client"), id = b.dataset.chooseClient;
        if ((id && !sel?.dataset?.deferredCustomers && !availableCustomers().some(c => c.id === id)) ||
            !setSaleCustomer(id, sel)) {
          toast('O cliente não está mais disponível neste espaço.', true);
          close();
          return;
        }
        sel.dispatchEvent(new Event("change"));
        if (sel.value) DB.rememberRecentClient(sel.value);
        close();
        refresh();
        if (onSelected && sel.value) onSelected(clients().getById(sel.value));
      }
      if (e.target.closest("#quick-new-client")) { close(); quickClient(); }
    };
    window.lucide?.createIcons();
    input.focus({preventScroll:true});
  }
  const dateLabel = (value) => {
    if (!value) return "—";
    if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value)) return value.split("-").reverse().join("/");
    return new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
  };
  const renewalContext = (clientId, productId) => ({
    clientId, productId, businessId: DB.getBusinessId?.(), spaceId: selectedSalesSpaceId(),
  });
  const renewalScope = () => JSON.stringify([window.SpaceContext?.viewScope?.(), selectedSalesSpaceId()]);
  let recurringRead;
  function selectedRenewal(request) {
    if (request.scope !== renewalScope()) throw Error("O espaço ou a sessão mudou. Volte ao perfil para renovar.");
    const subscription = CustomerSubscriptions.requireRenewable(CustomerSubscriptions.view.get(request.id),
      renewalContext(request.clientId, request.productId));
    if (String(subscription.variantId || "") !== request.variantId)
      throw Error("A variação da vigência mudou. Volte ao perfil do cliente para conferir.");
    return subscription;
  }
  async function recurringConfiguration(product, variant = null, source = null, request = null) {
    const clientId = document.querySelector("#sale-client")?.value;
    if (!clientId && !request) {
      picker(() => recurringConfiguration(product, variant, source), { requireClient: true, title: "Selecione o cliente da renovação" });
      return;
    }
    const read = recurringRead = {},
      scope = renewalScope(), context = renewalContext(clientId, product.id),
      modal = document.querySelector("#modal"), previousModal = modal.firstChild;
    let existing;
    try {
      const remote = request && window.SyncFirebase?.queryCustomerSubscriptions
        ? await window.SyncFirebase.queryCustomerSubscriptions({ clientId, subscriptionId: request.id, spaceView: true })
        : await CustomerSubscriptions.loadForClient(clientId);
      if (recurringRead !== read || modal.firstChild !== previousModal) return;
      if (Router.atual() !== "vender" || scope !== renewalScope() || document.querySelector("#sale-client")?.value !== clientId)
        throw Error("O cliente ou o espaço mudou. Abra a renovação novamente.");
      if (request) {
        if (clientId !== request.clientId)
          throw Error("A vigência selecionada não está mais disponível. Volte ao perfil do cliente para conferir.");
        const remoteRenewal = CustomerSubscriptions.requireRenewable(remote.find(item => item.id === request.id), context);
        existing = [CustomerSubscriptions.requireRenewable(selectedRenewal(request), {
          ...context, expected: CustomerSubscriptions.renewalSnapshot(remoteRenewal),
        })];
      } else {
        existing = CustomerSubscriptions.matchingProduct(clientId, product.id).filter(item =>
          CustomerSubscriptions.originSpace(item) === context.spaceId &&
          (!item.businessId || item.businessId === context.businessId) && item.active !== false && !item.deletedAt);
      }
    } catch (error) {
      if (recurringRead === read) toast(error.message || "Não foi possível consultar a vigência selecionada.", true);
      return;
    }
    const snapshots = new Map(existing.map(item => [item.id, CustomerSubscriptions.renewalSnapshot(item)])),
      defaultDuration = Number((request && existing[0].durationValue) || variant?.durationValue || product.durationValue || 30),
      defaultUnit = (request && existing[0].durationUnit) || variant?.durationUnit || product.durationUnit || "days",
      spaceName = window.SpaceContext?.selectedSales?.()?.name || context.spaceId;
    // Reads the "Personalizar vencimento" fields (kept across re-renders) against the automatic date.
    const customExpiryState = (automatic) => {
      const helpers = CustomerSubscriptions.customExpiryHelpers, on = Boolean(modal.querySelector?.('[name="customExpiryOn"]')?.checked);
      const date = modal.querySelector?.('[name="customExpiryDate"]')?.value || helpers.civilInputDate(automatic),
        time = modal.querySelector?.('[name="customExpiryTime"]')?.value || "";
      const max = helpers.civilInputDate(new Date(new Date(automatic).getTime() + 366 * 86400000).toISOString()),
        min = helpers.civilInputDate(new Date().toISOString());
      if (!on) return { on, date, time, min, max, value: null, error: null, note: "" };
      const value = helpers.customExpiryInstant(date, time, automatic), error = helpers.checkCustomExpiry(value, { automatic });
      const delta = value ? helpers.daysBetween(automatic, value) : 0;
      const note = value ? `Vence em ${helpers.expiryLabel(value).replace(" ", " às ")} · cálculo automático: ${helpers.expiryLabel(automatic).split(" ")[0]}${delta ? ` (${delta > 0 ? "+" : ""}${delta} ${Math.abs(delta) === 1 ? "dia" : "dias"})` : " (mesmo dia)"}` : "";
      return { on, date, time, min, max, value, error, note };
    };
    const render = () => {
      const selectedId = request?.id || modal.querySelector?.('[name="subscriptionChoice"]:checked')?.value || existing[0]?.id || "new", selected = existing.find((item) => item.id === selectedId) || null, durationValue = Number(modal.querySelector?.('[name="durationValue"]')?.value || defaultDuration), durationUnit = modal.querySelector?.('[name="durationUnit"]')?.value || defaultUnit, price = Number(modal.querySelector?.('[name="contractedPrice"]')?.value || (selected?.contractedPrice ?? variant?.price ?? product.preco ?? 0)), label = modal.querySelector?.('[name="renewalLabel"]')?.value || selected?.label || product.renewalLabel || product.nome, payment = modal.querySelector?.('[name="renewalPayment"]')?.value || window.CheckoutPaymentMethod || "pix", dates = CustomerSubscriptions.preview({ subscription: selected, durationValue, durationUnit }), custom = customExpiryState(dates.expiresAt);
      modal.innerHTML = `<div class="modal-bg recurring-sale-bg"><section class="modal-box recurring-sale-sheet" role="dialog" aria-modal="true" aria-labelledby="recurring-sale-title"><header class="modal-head"><div><small>Venda com renovação</small><h3 id="recurring-sale-title">${escapar(product.nome)}${variant ? ` — ${escapar(ProductVariations.displayName(variant))}` : ""}</h3></div><button class="icon-btn close"><i data-lucide="x"></i></button></header><div class="modal-body">${request ? `<section class="recurring-existing"><h4>${escapar(selected.label || product.nome)}</h4><p><b>Cliente</b> ${escapar(clients().getById(clientId)?.nome || "")}</p><p><b>Espaço</b> ${escapar(spaceName)}</p><p><b>Variação</b> ${variant ? escapar(ProductVariations.displayName(variant)) : "Sem variação"}</p></section>` : existing.length ? `<section class="recurring-existing"><h4>Este cliente já possui esta renovação</h4>${existing.map((item) => { const currentVariant = item.variantId ? ProductVariations.get(item.variantId) : null; return `<label><input type="radio" name="subscriptionChoice" value="${item.id}" ${item.id === selectedId ? "checked" : ""}><span><b>${escapar(item.label)}</b><small>${CustomerSubscriptions.effectiveStatus(item) === "active" ? "Ativa" : "Vencida"}${currentVariant ? ` · ${escapar(ProductVariations.displayName(currentVariant))}` : ""} · até ${dateLabel(item.expiresAt)}</small></span></label>`; }).join("")}<label><input type="radio" name="subscriptionChoice" value="new" ${selectedId === "new" ? "checked" : ""}><span><b>Criar outra</b><small>Nova vigência separada</small></span></label></section>` : ""}<div class="field"><label>Nome para identificação</label><input name="renewalLabel" value="${escapar(label)}" placeholder="Ex.: Casa, Escritório"></div><div class="recurring-form-grid"><div class="field"><label>Período</label><input name="durationValue" type="number" inputmode="numeric" min="1" value="${durationValue}"></div><div class="field"><label>Unidade</label><select name="durationUnit"><option value="days" ${durationUnit === "days" ? "selected" : ""}>dias</option><option value="weeks" ${durationUnit === "weeks" ? "selected" : ""}>semanas</option><option value="months" ${durationUnit === "months" ? "selected" : ""}>meses</option><option value="years" ${durationUnit === "years" ? "selected" : ""}>anos</option></select></div><div class="field"><label>Valor</label><input name="contractedPrice" type="number" inputmode="decimal" min="0" step=".01" value="${price.toFixed(2)}"></div><div class="field"><label>Pagamento</label><select name="renewalPayment"><option value="pix" ${payment === "pix" ? "selected" : ""}>Pix / pago</option><option value="dinheiro" ${payment === "dinheiro" ? "selected" : ""}>Dinheiro / pago</option><option value="cartao" ${payment === "cartao" ? "selected" : ""}>Cartão / pago</option><option value="fiado" ${payment === "fiado" ? "selected" : ""}>Fiado</option></select></div></div><section class="recurring-preview"><span><small>${selected ? "Vencimento atual" : "Início"}</small><b>${selected ? dateLabel(selected.expiresAt) : dateLabel(dates.startsAt)}</b></span><i data-lucide="arrow-right"></i><span><small>${selected ? "Renovado até" : "Ativo até"}${custom.value && !custom.error ? " · personalizado" : ""}</small><b>${dateLabel(custom.value && !custom.error ? custom.value : dates.expiresAt)}</b></span></section><section class="recurring-custom-expiry" data-custom-expiry><label class="recurring-custom-toggle"><input type="checkbox" name="customExpiryOn" ${custom.on ? "checked" : ""}><span><b>Personalizar vencimento</b><small>Use quando o painel do serviço informar outra data. Desligado, vale o cálculo automático.</small></span></label>${custom.on ? `<div class="recurring-custom-fields"><div class="field"><label for="custom-expiry-date">Data de vencimento</label><input id="custom-expiry-date" type="date" name="customExpiryDate" value="${escapar(custom.date)}" min="${escapar(custom.min)}" max="${escapar(custom.max)}" required></div><div class="field"><label for="custom-expiry-time">Horário <small>(opcional)</small></label><input id="custom-expiry-time" type="time" name="customExpiryTime" value="${escapar(custom.time)}"></div></div><p class="recurring-custom-note ${custom.error ? "is-error" : ""}" role="status">${escapar(custom.error || custom.note)}</p>` : ""}</section></div><footer class="modal-foot"><button class="btn btn-light close">Cancelar</button><button class="btn btn-primary" data-confirm-recurring>${selected ? "Adicionar renovação" : "Adicionar ativação"}</button></footer></section></div>`;
      modal.querySelectorAll(".close").forEach((button) => button.onclick = () => modal.innerHTML = "");
      modal.querySelectorAll('input[name="subscriptionChoice"]').forEach((input) => input.onchange = render);
      ["durationValue", "durationUnit", "customExpiryOn", "customExpiryDate", "customExpiryTime"].forEach((name) => { const field = modal.querySelector(`[name="${name}"]`); if (field) field.onchange = render; });
      const confirmButton = modal.querySelector("[data-confirm-recurring]");
      confirmButton.onclick = () => {
        if (!modal.contains(confirmButton) || confirmButton.disabled) return;
        const choiceId = request?.id || modal.querySelector('input[name="subscriptionChoice"]:checked')?.value || selectedId,
          chosen = existing.find((entry) => entry.id === choiceId) || null,
          expectedSubscription = snapshots.get(choiceId) || null;
        try {
          if (scope !== renewalScope() || document.querySelector("#sale-client")?.value !== clientId)
            throw Error("O cliente ou o espaço mudou. Abra a renovação novamente.");
          if (choiceId !== "new") {
            const current = request ? selectedRenewal(request) : CustomerSubscriptions.get(choiceId);
            CustomerSubscriptions.requireRenewable(current, { ...context, expected: expectedSubscription });
          }
          if (chosen && cart.some(item => item.recurringActivation?.subscriptionId === chosen.id))
            throw Error("Esta vigência já está na sacola.");
        } catch (error) {
          return toast(error.message, true);
        }
        // Personalized due date: the exact instant goes in the sale; the server re-validates it.
        const customNow = customExpiryState(CustomerSubscriptions.preview({ subscription: chosen,
          durationValue: Math.max(1, Number(modal.querySelector('[name="durationValue"]')?.value || defaultDuration)),
          durationUnit: modal.querySelector('[name="durationUnit"]')?.value || defaultUnit }).expiresAt);
        if (customNow.on && (customNow.error || !customNow.value)) return toast(customNow.error || "Escolha a data de vencimento.", true);
        const finalDurationValue = Math.max(1, Number(modal.querySelector('[name="durationValue"]')?.value || defaultDuration)),
          finalDurationUnit = modal.querySelector('[name="durationUnit"]')?.value || defaultUnit,
          finalPrice = Math.max(0, Number(modal.querySelector('[name="contractedPrice"]')?.value || 0)),
          finalLabel = String(modal.querySelector('[name="renewalLabel"]')?.value || product.renewalLabel || product.nome).trim(),
          finalPayment = modal.querySelector('[name="renewalPayment"]')?.value || "pix",
          item = ProductVariations.saleItem(product, variant, 1), draftId = Utils.uuid();
        Object.assign(item, { productType: "recurring", precoOriginal: finalPrice, precoFinalUnitario: finalPrice, precoUnitario: finalPrice, recurringActivation: { draftId, subscriptionId: chosen?.id || null, label: finalLabel, durationValue: finalDurationValue, durationUnit: finalDurationUnit, contractedPrice: finalPrice, renewalPolicyVersion: CustomerSubscriptions.renewalPolicyVersion, expectedSubscription, renewalMessage: product.renewalMessage || "", reminders: product.renewalReminders || [], clientIdSnapshot: clientId,
          ...(customNow.on ? { customExpiry: { expiresAt: customNow.value, timeSet: Boolean(customNow.time) } } : {}) } });
        const status = finalPayment === "fiado" ? "fiado" : "pago", statusSelect = document.querySelector("#sale-status"), paymentSelect = document.querySelector("#sale-payment-method");
        statusSelect.value = status; if (paymentSelect) paymentSelect.value = finalPayment; window.CheckoutPaymentMethod = finalPayment; statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
        confirmButton.disabled = true;
        if (!addSaleItem(item, { source })) { confirmButton.disabled = false; return; }
        modal.innerHTML = "";
        toast(chosen ? "Renovação adicionada à sacola" : "Ativação adicionada à sacola");
      };
      window.lucide?.createIcons();
    };
    render();
  }
  async function openRecurringProduct(product, source = null) {
    const controlsStock = window.productControlsStock?.(product) ?? (!product.semControleEstoque && product.controlaEstoque !== false);
    if (controlsStock && getProductStockStatus(product) === "esgotado" && !product.allowNegativeStock)
      return toast("Produto sem estoque.", true);
    if (ProductVariations.isVariable(product)) {
      const variants = await ProductVariations.ensure(product.id);
      if (!variants.length) return toast("Cadastre ao menos uma variação ativa.", true);
      const modal = document.querySelector("#modal");
      modal.innerHTML = `<div class="modal-bg variation-picker-bg"><section class="variation-picker recurring-variant-picker"><header><div><h3>${escapar(product.nome)}</h3><p>Escolha o plano ou variação</p></div><button class="icon-btn close"><i data-lucide="x"></i></button></header><div class="variation-picker-list">${variants.map((item) => `<button type="button" class="recurring-variant-choice" data-recurring-variant="${item.id}">${window.ProductImages?.markup?.(product, { variant: item, className: "variation-picker-photo" }) || ""}<span><b>${escapar(ProductVariations.displayName(item))}</b><small>${dinheiro(item.price)} · ${Number(item.durationValue || product.durationValue || 30)} ${durationUnitLabel(item.durationUnit || product.durationUnit, Number(item.durationValue || product.durationValue || 30))}</small></span><i data-lucide="chevron-right"></i></button>`).join("")}</div></section></div>`;
      modal.querySelector(".close").onclick = () => modal.innerHTML = "";
      modal.querySelectorAll("[data-recurring-variant]").forEach((button) => button.onclick = () => {
        const variant = variants.find((item) => item.id === button.dataset.recurringVariant);
        if (controlsStock && Number(variant?.stock || 0) <= 0 && !variant?.allowNegativeStock)
          return toast("Variação sem estoque.", true);
        modal.innerHTML = "";
        recurringConfiguration(product, variant, source);
      });
      window.lucide?.createIcons(); return;
    }
    return recurringConfiguration(product, null, source);
  }
  function quickClient() {
    const directory=window.ClientesPage;
    let context;
    try { context=directory.registrationContext(); }
    catch (error) { toast(error.message, true); return; }
    document.querySelector("#modal").innerHTML =
      `<div class="modal-bg checkout-customer-bg"><section class="modal-box"><header class="modal-head"><h3>Novo cliente</h3></header><form id="quick-client-form"><div class="modal-body"><div class="field"><label>Nome *</label><input name="nome" required autofocus></div><div class="field"><label>Telefone / WhatsApp</label><input name="telefone" inputmode="tel"></div><div class="field"><label>Observação</label><textarea name="observacoes"></textarea></div>${directory.registrationFields(context)}</div><footer class="modal-foot"><button type="button" class="btn btn-light cancel">Cancelar</button><button class="btn btn-primary">Salvar e selecionar</button></footer></form></section></div>`;
    document.querySelector(".cancel").onclick = () => picker();
    document.querySelector("#quick-client-form").onsubmit = async (event) => {
      event.preventDefault();
      const form=event.currentTarget;
      if(form.dataset.saving)return;
      form.dataset.saving='1';
      try {
        await directory.registerFromForm(form,context,id=>{
          const client=clients().getById(id),select=document.querySelector("#sale-client");
          if(!client||!select||!availableCustomers().some(c=>c.id===id))return;
          if(![...select.options].some(option=>option.value===id))select.add(new Option(client.nome,id));
          select.value=id;
          select.dispatchEvent(new Event("change",{bubbles:true}));
          refresh();
        });
      } catch(error){toast(error.message||'Não foi possível cadastrar o cliente.',true);}
      finally{delete form.dataset.saving;}
    };
  }
  function enhance() {
    let t;
    const search = document.querySelector("#product-search");
    search.oninput = () => {
      clearTimeout(t);
      t = setTimeout(() => { if (search.isConnected) filter(); }, 120);
    };
    document.querySelector("#clear-product-search").onclick = () => {
      clearTimeout(t);
      search.value = "";
      filter();
      search.focus();
    };
    ["#pos-category", "#pos-filter", "#pos-sort"].forEach(
      (s) => (document.querySelector(s).onchange = filter),
    );
    document.querySelector("#pos-grid").onclick = (e) => {
      const fav = e.target.closest("[data-fav]");
      if (fav) {
        e.preventDefault();
        e.stopPropagation();
        DB.alterar((db) => {
          const p = db.produtos.find((x) => x.id === fav.dataset.fav);
          p.favorito = !p.favorito;
        });
        fav.textContent = products().getById(fav.dataset.fav).favorito
          ? "★"
          : "☆";
      }
      setTimeout(refresh, 0);
    };
    document.querySelector("#open-sale-summary").onclick = openCartSurface;
    document.querySelector("#close-sale-summary").onclick = closeCartSurface;
    document.querySelector("#open-client-picker").onclick = () => picker();
    document.querySelector("#sale-client").onchange = refresh;
    document.querySelector("#sale-status").addEventListener("change", refresh);
    document
      .querySelector("#pos-summary")
      .addEventListener("change", () => setTimeout(refresh, 0));
    document.querySelector("#selected-client-card").onclick = (e) => {
      if (e.target.closest("[data-change-client]")) picker();
      const b = e.target.closest("[data-client-wa]");
      if (b) {
        const c = clients().getById(b.dataset.clientWa);
        open(
          `https://wa.me/55${somenteNumeros(c.telefone).replace(/^55/, "")}?text=${encodeURIComponent(`Olá, ${c.nome}!`)}`,
          "_blank",
        );
      }
    };
    refresh();
    window.lucide?.createIcons();
  }
  let cart = [],
    discountKind = null,
    manual = false,
    finishing = false,
    activeAttempt = null,
    activeConflict = null,
    restoredDraftKey = "",
    restoredDraftPrincipal = "",
    draftDetails = { clientId: "", paymentMethod: "pix", note: "", discountValue: "0", discountPercent: "0" },
    pendingClient = null,
    pendingRenewal = null,
    selectedCampaignIds = new Set();
  const DRAFT_PREFIX = "veconi:sale-draft:v1";
  function traceSale(stage, detail = {}) {
    if (window.__VECONI_DEV__ !== true) return;
    console.debug(stage, detail);
    dispatchEvent(new CustomEvent("veconi-sale-debug", { detail: { stage, ...detail } }));
  }
  function draftKey() {
    const businessId = String(DB.getBusinessId?.() || window.FirebaseSession?.businessId || "").trim(),
      spaceId = selectedSalesSpaceId();
    return businessId && spaceId ? `${DRAFT_PREFIX}:${businessId}:${spaceId}` : "";
  }
  function captureDraftDetails() {
    draftDetails = {
      clientId: document.querySelector("#sale-client")?.value || draftDetails.clientId || "",
      paymentMethod: document.querySelector("#sale-payment-method")?.value || draftDetails.paymentMethod || "pix",
      installmentTerms: window.InstallmentCredit?.read(),
      note: document.querySelector("#sale-note")?.value ?? draftDetails.note ?? "",
      beneficiaryName: document.querySelector('#sale-beneficiary')?.value ?? draftDetails.beneficiaryName ?? '',
      discountValue: document.querySelector("#discount-value")?.value ?? draftDetails.discountValue ?? "0",
      discountPercent: document.querySelector("#discount-percent")?.value ?? draftDetails.discountPercent ?? "0",
    };
    return draftDetails;
  }
  const draftPrincipal = () => JSON.stringify([window.FirebaseSession?.user?.uid || "", DB.getWorkspaceGeneration?.() ?? 0]);
  function saveDraft() {
    const key = draftKey();
    if (!key || restoredDraftKey && (key !== restoredDraftKey || restoredDraftPrincipal !== draftPrincipal())) return;
    try {
      if (!cart.length&&!activeAttempt?.locked&&!hasSavedSaleAttempt()) return sessionStorage.removeItem(key);
      sessionStorage.setItem(key, JSON.stringify({
        version: 1,
        principal: draftPrincipal(),
        businessId: String(DB.getBusinessId?.() || ""),
        spaceId: selectedSalesSpaceId(),
        cart,
        discountKind,
        manual,
        selectedCampaignIds: [...selectedCampaignIds],
        paymentAttemptId: activeAttempt?.saleId || null,
        operationId: activeAttempt?.operationId || null,
        details: captureDraftDetails(),
        savedAt: new Date().toISOString(),
      }));
    } catch (error) {
      traceSale("[CART] draft persistence unavailable", { code: error?.name || "unknown" });
    }
  }
  function clearDraft() {
    const key = draftKey(), keys = new Set([key, restoredDraftKey].filter(Boolean));
    for (const candidate of keys) try { sessionStorage.removeItem(candidate); } catch {}
    restoredDraftKey = key;
    restoredDraftPrincipal = draftPrincipal();
  }
  function retireSpaceDraft() {
    if (!restoredDraftKey || restoredDraftKey === draftKey() && restoredDraftPrincipal === draftPrincipal()) return;
    // The prior cart was already persisted under its original key. Never move it or the sync queue.
    cart = [];
    discountKind = null;
    manual = false;
    activeAttempt = null;
    activeConflict = null;
    pendingClient = null;
    pendingRenewal = null;
    selectedCampaignIds.clear();
    draftDetails = {clientId:'',paymentMethod:'pix',note:'',discountValue:'0',discountPercent:'0'};
    restoredDraftKey = '';
    restoredDraftPrincipal = '';
  }
  function restoreDraft() {
    const key = draftKey();
    if (!key || restoredDraftKey === key || cart.length) return;
    restoredDraftKey = key;
    restoredDraftPrincipal = draftPrincipal();
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (!saved || saved.spaceId !== selectedSalesSpaceId() || saved.businessId !== DB.getBusinessId?.() ||
        saved.principal && saved.principal !== restoredDraftPrincipal || !Array.isArray(saved.cart)) return;
      cart = saved.cart.filter((item) => {
        const product = products().getById(item?.produtoId || item?.productId);
        return product && productAvailableHere(product) && Number(item.quantidade) > 0;
      });
      discountKind = saved.discountKind || null;
      manual = Boolean(saved.manual);
      selectedCampaignIds = new Set(saved.selectedCampaignIds || []);
      draftDetails = { ...draftDetails, ...(saved.details || {}) };
      if (saved.paymentAttemptId) activeAttempt = { saleId: saved.paymentAttemptId, operationId: saved.operationId || null, restored: true };
      if (cart.length) traceSale("[CART] draft restored", { items: cart.reduce((sum, item) => sum + Number(item.quantidade || 0), 0) });
    } catch (error) {
      try { sessionStorage.removeItem(key); } catch {}
      traceSale("[CART] invalid draft discarded", { code: error?.name || "unknown" });
    }
  }
  function applyDraftDetails() {
    const client = document.querySelector("#sale-client"), payment = document.querySelector("#sale-payment-method"),
      status = document.querySelector("#sale-status"), note = document.querySelector("#sale-note"),
      discountValue = document.querySelector("#discount-value"), discountPercent = document.querySelector("#discount-percent");
    if (client && (client.dataset?.deferredCustomers || [...client.options].some(option => option.value === draftDetails.clientId)))
      setSaleCustomer(draftDetails.clientId, client);
    if (payment) payment.value = draftDetails.paymentMethod || "pix";
    if (status) status.value = ["fiado","crediario"].includes(payment?.value) ? "fiado" : "pago";
    window.InstallmentCredit?.restore(draftDetails.installmentTerms);
    if (note) note.value = draftDetails.note || "";
    const beneficiary = document.querySelector('#sale-beneficiary');
    if (beneficiary) { beneficiary.value = draftDetails.beneficiaryName || ''; beneficiary.closest('details').open = Boolean(beneficiary.value); }
    if (discountValue) discountValue.value = draftDetails.discountValue || "0";
    if (discountPercent) discountPercent.value = draftDetails.discountPercent || "0";
    window.CheckoutPaymentMethod = payment?.value || "pix";
  }
  function hasSavedSaleAttempt() {
    return Boolean(activeAttempt?.saleId && (DB.carregar().vendas || [])
      .some(sale=>sale.id===activeAttempt.saleId||activeAttempt.operationId&&sale.operationId===activeAttempt.operationId));
  }
  function invalidateAttempt() { if (!finishing&&!activeAttempt?.locked&&!hasSavedSaleAttempt()) activeAttempt = null; }
  function setSubmissionState(state, message = "") {
    const button = document.querySelector("#finish-sale"), feedback = document.querySelector("#sale-submit-feedback"),
      labels = { normal: '<i data-lucide="check"></i> Concluir venda', processing: '<i data-lucide="loader-circle"></i> Processando…', success: message.startsWith("Venda salva") ? '<i data-lucide="circle-check"></i> Venda salva' : '<i data-lucide="circle-check"></i> Venda concluída', error: '<i data-lucide="rotate-ccw"></i> Tentar novamente', conflict: '<i data-lucide="cloud-search"></i> Comparar com a nuvem', review: '<i data-lucide="cloud-search"></i> Conferir venda original' };
    if (button) {
      button.dataset.saleState = state;
      button.disabled = state === "processing" || state === "success";
      button.innerHTML = labels[state] || labels.normal;
    }
    if (feedback) {
      feedback.hidden = !message;
      if (state === "conflict") {
        feedback.innerHTML = `<span>${escapar(message)}</span><div class="sale-conflict-actions"><button type="button" data-resolve-sale>Resolver agora</button><button type="button" data-close-sale-conflict>Fechar</button></div>`;
        feedback.querySelector("[data-resolve-sale]").onclick = () =>
          dispatchEvent(new CustomEvent("resolve-sale-conflict", { detail: activeConflict || {} }));
        feedback.querySelector("[data-close-sale-conflict]").onclick = () => {
          activeConflict = null;
          setSubmissionState("normal");
        };
      } else feedback.textContent = message;
      feedback.classList.toggle("error", ["error","conflict","review"].includes(state));
      feedback.classList.toggle("success", state === "success");
    }
    window.lucide?.createIcons();
  }
  function holdOriginalSale(message='A venda original continua neste aparelho. Abra Sincronização → Ver detalhes para conferir a pendência antes de repetir.', preservedSale=null) {
    if(activeAttempt)activeAttempt.locked=true;
    setSubmissionState('review',message);
    saveDraft();
    const feedback=document.querySelector('#sale-submit-feedback');
    if(!feedback||!preservedSale||preservedSale.paymentIntentId)return;
    const attempt=activeAttempt,scope=draftKey(),principal=draftPrincipal();
    const button=document.createElement('button');
    button.type='button';
    button.className='btn btn-light';
    button.textContent='Iniciar outra venda';
    button.onclick=async()=>{
      if(finishing||attempt!==activeAttempt||scope!==draftKey()||principal!==draftPrincipal())return;
      finishing=true;
      try{
        await DB.flush?.();
        if(attempt!==activeAttempt||scope!==draftKey()||principal!==draftPrincipal())return;
        const current=window.SyncFirebase?.inspectCheckoutSaleAttempt?.({...attempt,spaceId:selectedSalesSpaceId()});
        if(!current||current.status!=='review'||current.sale.id!==preservedSale.id||current.sale.operationId!==preservedSale.operationId)return;
        // The original sale and its queue live in IndexedDB. Only reset this checkout draft.
        cart=[];
        selectedCampaignIds.clear();
        manual=false;
        discountKind=null;
        activeAttempt=null;
        activeConflict=null;
        draftDetails={clientId:'',paymentMethod:'pix',note:'',discountValue:'0',discountPercent:'0'};
        clearDraft();
        applyDraftDetails();
        setSubmissionState('normal');
        drawCart();
      }catch{
        toast('Não foi possível conferir a venda original neste aparelho. Abra Sincronização → Ver detalhes.',true);
      }finally{finishing=false;}
    };
    feedback.append(' ',button);
  }
  function finishSavedSale(sale,{usingExchangeCredit=false,tracking}={}) {
    if(tracking==='review')return holdOriginalSale(undefined,sale);
    activeConflict=null;
    cart=[];
    selectedCampaignIds.clear();
    manual=false;
    discountKind=null;
    draftDetails={clientId:'',paymentMethod:'pix',note:'',discountValue:'0',discountPercent:'0'};
    clearDraft();
    activeAttempt=null;
    finishing=false;
    if(usingExchangeCredit)window.ExchangeCreditCheckout?.reset?.();
    const pending=!usingExchangeCredit&&(tracking?tracking==='pending':navigator.onLine===false||window.SyncFirebase?.isSalePending?.(sale));
    setSubmissionState('success',pending?'Venda salva no aparelho e aguardando sincronização.':'Venda concluída com sucesso.');
    refreshClients();
    closeCartSurface({immediate:true});
    traceSale('[SALE] completed',{operationId:sale.operationId,saleId:sale.id,spaceId:sale.spaceId});
    queueMicrotask(() => {
      if (window.Router?.atual?.() === "vender") window.Checkout?.refreshProducts?.();
    });
    try{Recibos.mostrar(sale,sale.clienteId?clients().getById(sale.clienteId):null);}
    catch{toast('Venda concluída. O recibo não pôde ser aberto, mas a venda foi salva.',true);}
  }
  async function resumeCheckoutSale() {
    if(!activeAttempt?.saleId)return false;
    const spaceId=selectedSalesSpaceId(),scope=draftKey(),principal=draftPrincipal();
    const attempt=activeAttempt;
    try{
      const original=window.SyncFirebase?.inspectCheckoutSaleAttempt?.({...attempt,spaceId});
      if(!original){
        if(!hasSavedSaleAttempt()&&!attempt.locked)return false;
        holdOriginalSale();
        return true;
      }
      if(original.status==='review'){
        holdOriginalSale(original.reason==='product_stock_dependency'
          ?'A venda está salva neste aparelho e aguarda revisão do estoque. Abra Sincronização → Ver detalhes para conferir a pendência.'
          :undefined,original.sale);
        return true;
      }
      finishing=true;
      setSubmissionState('processing','Conferindo a venda original…');
      await DB.flush?.();
      if(scope===draftKey()&&principal===draftPrincipal()&&attempt===activeAttempt)
        finishSavedSale(original.sale,{tracking:original.status});
    }catch(error){
      if(scope===draftKey()&&principal===draftPrincipal()&&attempt===activeAttempt)
        holdOriginalSale(error.code==='sale-original-review-required'?error.message:undefined);
    }finally{finishing=false;}
    return true;
  }
  const totals = (items = cart) => {
    const original = items.reduce(
        (s, i) => s + i.quantidade * i.precoOriginal,
        0,
      ),
      final = items.length ? (window.SaleMoney ? window.SaleMoney.summarize(items).totalCents / 100 : items.reduce((s,i)=>s+i.quantidade*i.precoFinalUnitario,0)) : 0,
      cost = items.reduce((s, i) => s + i.quantidade * i.custoUnitario, 0);
    return {
      original,
      final,
      cost,
      discount: original - final,
      profit: final - cost,
    };
  };
  const cartCount = () => cart.reduce((sum, item) => sum + Number(item.quantidade || 0), 0);
  function updateBeneficiaryField() {
    let field = document.querySelector('.service-beneficiary-field');
    if (!field) {
      const anchor = document.querySelector('#sale-note')?.closest('.field');
      if (!anchor) return;
      anchor.insertAdjacentHTML('beforebegin', '<div class="field service-beneficiary-field" hidden><details><summary>Atendido diferente do pagador</summary><label for="sale-beneficiary">Cliente atendido (opcional)</label><input id="sale-beneficiary" maxlength="160" autocomplete="off" placeholder="Ex.: Restaurante Maremont"><small>Somente identificação do atendimento. O cliente selecionado é o responsável pelo pagamento e pelo Fiado.</small></details></div>');
      field = document.querySelector('.service-beneficiary-field');
      field.querySelector('input').addEventListener('input', () => { invalidateAttempt(); selectedClient(); saveDraft(); });
    }
    field.hidden = Boolean(window.PriorSales?.active?.()) || !cart.some(item => item.serviceExecution);
    if (field.hidden) { field.querySelector('input').value = ''; field.querySelector('details').open = false; }
  }
  function drawCart() {
    const host = document.querySelector("#cart");
    if (!host) return;
    updateBeneficiaryField();
    const clientId = document.querySelector("#sale-client")?.value || null;
    const displayItems = !window.PriorSales?.active?.() && !manual && clientId
      ? (window.Campanhas?.aplicarBeneficios?.(cart, clientId, {
          selectedCampaignIds: [...selectedCampaignIds],
          status: document.querySelector("#sale-status")?.value || "pago",
        }) || cart)
      : cart;
    for(const item of cart)if(item.serviceCostSnapshot&&item.serviceExecution){const snapshot=item.serviceCostSnapshot;item.serviceCostSnapshot=FlexibleService.estimate(snapshot.configuration,item.serviceExecution,item.precoFinalUnitario,snapshot.additionalCosts);item.custoUnitario=item.serviceCostSnapshot.estimatedCost;}
    const t = totals(displayItems);
    host.innerHTML = window.DesktopSales?.isDesktop?.()
      ? window.DesktopSales.cartHTML(cart)
      : cart.length
        ? cart
          .map((i) => {
            const key = cartKey(i), product = products().getById(i.produtoId), variant = i.variantId ? window.ProductVariations?.get?.(i.variantId) : null,
              image = window.ProductImages?.markup?.(product, { variant, className: "sale-cart-photo" }) || `<span class="sale-cart-photo placeholder">${initials(i.nome)}</span>`;
            return `<div class="cart-item editable-cart ${i.serviceExecution?"service-cart-item":""}">${image}<div><b>${escapar(i.nome)}</b>${window.FlexibleServiceUI?.summary(i)||""}<br><small>Original: ${dinheiro(i.precoOriginal)} · Custo: ${dinheiro(i.custoUnitario)}</small></div><label>Qtd.<input data-item-qty="${escapar(key)}" type="number" min="1" step="1" value="${i.quantidade}"></label><label>Preço final<input data-item-price="${escapar(key)}" type="number" inputmode="decimal" min="0" step=".0001" value="${Number(i.precoFinalUnitario.toFixed(4))}"></label><button class="icon-btn" data-remove="${escapar(key)}" aria-label="Remover ${escapar(i.nome)}"><i data-lucide="trash-2"></i></button></div>`;
          })
          .join("")
        : '<div class="empty">Adicione produtos</div>';
    document.querySelector("#sale-totals").innerHTML =
      `<div class="summary-row"><span>Subtotal original</span><b>${dinheiro(t.original)}</b></div><div class="summary-row discount"><span>Desconto total</span><b>${dinheiro(t.discount)}</b></div><div class="summary-row total-row"><span>Valor final</span><b>${dinheiro(t.final)}</b></div><div class="summary-row private-value"><span>Custo total</span><b>${dinheiro(t.cost)}</b></div><div class="summary-row private-value"><span>Lucro estimado</span><b>${dinheiro(t.profit)}</b></div>`;
    document.querySelector("#manual-total").value = t.final.toFixed(2);
    drawCampaignBenefits();
    refresh();
    saveDraft();
    window.lucide?.createIcons();
    if(!window.PriorSales?.active?.())void window.ExchangeCreditCheckout?.mount?.({
      clientId, spaceId: selectedSalesSpaceId(), totalCents: Math.round(t.final * 100),
      onChange: () => { invalidateAttempt(); saveDraft(); },
      onRecovered: completeRecoveredCreditSale,
    });
  }

  function completeRecoveredCreditSale(sale) {
    cart = [];
    selectedCampaignIds.clear();
    manual = false; discountKind = null; activeAttempt = null; activeConflict = null;
    draftDetails = { clientId: "", paymentMethod: "pix", note: "", discountValue: "0", discountPercent: "0" };
    clearDraft(); finishing = false;
    window.ExchangeCreditCheckout?.reset?.();
    setSubmissionState("success", "Venda confirmada na nuvem com crédito de troca.");
    refreshClients(); closeCartSurface({ immediate: true });
    try { Recibos.mostrar(sale, sale.clienteId ? clients().getById(sale.clienteId) : null); }
    catch { toast("Venda confirmada. O recibo continua disponível no Histórico."); }
  }

  function drawCampaignBenefits() {
    if(window.PriorSales?.active?.()){const node=document.querySelector('#campaign-benefits');if(node)node.innerHTML='';return;}
    const totalsHost = document.querySelector("#sale-totals");
    if (!totalsHost) return;
    let host = document.querySelector("#campaign-benefits");
    if (!host) {
      totalsHost.insertAdjacentHTML("beforebegin", '<section id="campaign-benefits" class="campaign-cart-benefits"></section>');
      host = document.querySelector("#campaign-benefits");
    }
    const clientId = document.querySelector("#sale-client")?.value || null;
    const status = document.querySelector("#sale-status")?.value || "pago";
    const summaries = window.Campanhas?.resumoCarrinho?.(cart, clientId, [...selectedCampaignIds], status) || [];
    const visible = summaries;
    host.innerHTML = !clientId || !visible.length
      ? ""
      : `<h4>Benefícios desta compra</h4>${visible.map((item) => `<article class="${item.selected ? "selected" : ""}"><div><b>${escapar(item.name)}</b><small>${escapar(item.message)}</small></div>${item.requiresSelection ? `<button type="button" data-apply-campaign="${escapar(item.campaignId)}">${item.selected ? "Campanha escolhida" : item.benefit ? "Aplicar benefício" : "Escolher campanha"}</button>` : '<span>Automático</span>'}</article>`).join("")}`;
    host.onclick = (event) => {
      const button = event.target.closest("[data-apply-campaign]");
      if (!button) return;
      const id = button.dataset.applyCampaign;
      if (selectedCampaignIds.has(id)) selectedCampaignIds.delete(id);
      else {
        const selectedSummary = summaries.find((item) => item.campaignId === id);
        if (selectedSummary?.conflict) {
          summaries.filter((item) => item.conflictGroup === selectedSummary.conflictGroup).forEach((item) => selectedCampaignIds.delete(item.campaignId));
        }
        selectedCampaignIds.add(id);
      }
      invalidateAttempt();
      drawCart();
    };
  }
  const distribute = (value) => {
    const t = totals(),
      factor = t.original ? Math.max(0, Number(value) || 0) / t.original : 0;
    cart.forEach(
      (i) =>
        (i.precoFinalUnitario = Number((i.precoOriginal * factor).toFixed(4))),
    );
  };
  function addSaleItem(item, options = {}) {
    if(window.PriorSales?.locked?.()){toast('Consulte o registro preservado antes de alterar o carrinho.',true);return false;}
    if(window.PriorSales?.active?.()&&item.productType==='recurring'){toast('Renovações não estão disponíveis no modo venda anterior.',true);return false;}
    const product = products().getById(item?.produtoId || item?.productId);
    if (!product || !productAvailableHere(product)) {
      toast("Este item não está disponível no espaço de venda atual.", true);
      dispatchEvent(new CustomEvent("sale-item-rejected", { detail: { productId: item?.produtoId || item?.productId || null, reason: "space-unavailable", source: options.source || null } }));
      return false;
    }
    if(window.FlexibleService?.enabled(product)&&!item.serviceExecution){
      if(window.PriorSales?.active?.()){toast('Registre execuções de serviço na venda atual.',true);return false;}
      window.FlexibleServiceUI.open(product,item,next=>addSaleItem(next,options));return false;
    }
    const key = cartKey(item),
      current = cart.find((entry) => cartKey(entry) === key),
      before = current ? Number(current.quantidade || 0) : 0;
    if (current) current.quantidade += Number(item.quantidade || 1);
    else cart.push(item);
    invalidateAttempt();
    drawCart();
    dispatchEvent(new CustomEvent("sale-item-added", { detail: { item, before, after: before + Number(item.quantidade || 1), first: before === 0, source: options.source || null, variable: Boolean(item.variantId) } }));
    return true;
  }
  async function variablePicker(product, preselectedVariantId = null, source = null) {
    const variants = await ProductVariations.ensure(product.id),
      modal = document.querySelector("#modal"),
      controlsStock = window.productControlsStock?.(product) ??
        (product.itemKind !== "service" &&
          !product.semControleEstoque &&
          product.controlaEstoque !== false);
    if (!variants.length)
      return toast("Este produto não possui variações disponíveis", true);
    const quantities = Object.fromEntries(
      variants.map((variant) => [
        variant.id,
        variant.id === preselectedVariantId ? 1 : 0,
      ]),
    );
    const render = () => {
      const selected = Object.values(quantities).reduce(
        (sum, value) => sum + Number(value || 0),
        0,
      );
      modal.innerHTML = `<div class="modal-bg variation-picker-bg"><section class="variation-picker" role="dialog" aria-modal="true" aria-labelledby="variation-picker-title"><span class="sheet-handle"></span><header><div><h3 id="variation-picker-title">${escapar(product.nome)}</h3><p>Escolha uma opção</p></div><button class="icon-btn close" aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="variation-picker-list">${variants
        .map((variant) => {
          const out = controlsStock && !variant.allowNegativeStock && Number(variant.stock) <= 0,
            q = quantities[variant.id] || 0;
          return `<article class="variation-picker-row ${out ? "out" : ""}">${window.ProductImages?.markup?.(product,{variant,className:"variation-picker-photo"}) || ""}<div><b>${escapar(ProductVariations.displayName(variant))}</b><small>${Object.entries(
            variant.attributeValues || {},
          )
            .map(([, value]) => escapar(value))
            .join(
              " · ",
            )}</small><strong>${dinheiro(variant.price)}</strong></div><span class="variation-stock">${!controlsStock ? "Sem controle de estoque" : out ? "Esgotado" : `Estoque: ${Number(variant.stock)} un.`}</span><div class="variation-qty"><button data-variant-dec="${variant.id}" ${q <= 0 ? "disabled" : ""}>−</button><b>${q}</b><button data-variant-inc="${variant.id}" ${out || (controlsStock && !variant.allowNegativeStock && q >= Number(variant.stock)) ? "disabled" : ""}>+</button></div></article>`;
        })
        .join(
          "",
        )}</div><footer><button class="btn btn-primary" data-add-variants ${selected ? "" : "disabled"}>Adicionar${selected ? ` ${selected} ${selected === 1 ? "item" : "itens"}` : ""} à sacola</button></footer></section></div>`;
      modal
        .querySelectorAll(".close")
        .forEach((button) => (button.onclick = () => (modal.innerHTML = "")));
      modal.querySelector(".variation-picker-bg")?.addEventListener("click", (event) => {
        if (event.target === event.currentTarget) modal.innerHTML = "";
      });
      modal.querySelectorAll("[data-variant-inc]").forEach(
        (button) =>
          (button.onclick = () => {
            quantities[button.dataset.variantInc]++;
            render();
          }),
      );
      modal.querySelectorAll("[data-variant-dec]").forEach(
        (button) =>
          (button.onclick = () => {
            quantities[button.dataset.variantDec] = Math.max(
              0,
              quantities[button.dataset.variantDec] - 1,
            );
            render();
          }),
      );
      modal
        .querySelector("[data-add-variants]")
        ?.addEventListener("click", () => {
          variants.forEach((variant) => {
            const quantity = Number(quantities[variant.id] || 0);
            if (quantity)
              addSaleItem(ProductVariations.saleItem(product, variant, quantity), { source });
          });
          modal.innerHTML = "";
          toast(
            `${selected} ${selected === 1 ? "item adicionado" : "itens adicionados"}`,
          );
        });
      window.lucide?.createIcons();
    };
    render();
  }
  function selectCatalogProduct(id, source = null) {
    if (Router.atual() !== "vender" || !catalogPage()) return false;
    const p = products().getById(id);
    if (!p || p.ativo === false || !productAvailableHere(p)) return false;
    if (p.productType === "recurring") {
      openRecurringProduct(p, source);
      return true;
    }
    if (ProductVariations.isVariable(p)) {
      variablePicker(p, null, source);
      return true;
    }
    const out = getProductStockStatus(p) === "esgotado" && (window.productControlsStock?.(p) ?? (!p.semControleEstoque && p.controlaEstoque !== false)) && !p.allowNegativeStock;
    if (out) {
      toast("Produto sem estoque.", true);
      dispatchEvent(new CustomEvent("sale-item-rejected", { detail: { productId: p.id, reason: "out-of-stock", source } }));
      return true;
    }
    addSaleItem(ProductVariations.saleItem(p, null, 1), { source });
    return true;
  }
  function standalone() {
    const customer = document.querySelector("#sale-client");
    if (customer?.dataset?.deferredCustomers) customer.addEventListener("focus", () => {
      delete customer.dataset.deferredCustomers;
      refreshClients();
    }, { once: true });
    window.PriorSales?.mount?.(()=>{selectedCampaignIds.clear();manual=window.PriorSales.active();discountKind=manual?'historical_manual':null;window.ExchangeCreditCheckout?.reset?.();drawCart();});
    window.SpaceContext?.bind?.(document);
    const search = document.querySelector("#product-search");
    if (!search) return;
    let timer;
    search.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { if (search.isConnected) filter(); }, 120);
    };
    document.querySelector("#clear-product-search").onclick = () => {
      clearTimeout(timer);
      search.value = "";
      filter();
      search.focus();
    };
    ["#pos-category", "#pos-filter", "#pos-sort"].forEach(
      (s) => (document.querySelector(s).onchange = filter),
    );
    document.querySelector("#pos-grid").onclick = (e) => {
      const more = e.target.closest("[data-sale-catalog-more]");
      if (more) return loadMoreCatalog(more);
      const fav = e.target.closest("[data-fav]");
      if (fav) {
        e.stopPropagation();
        DB.alterar((db) => {
          const p = db.produtos.find((x) => x.id === fav.dataset.fav);
          p.favorito = !p.favorito;
        });
        const active = products().getById(fav.dataset.fav).favorito;
        if (window.DesktopSales?.isDesktop?.()) {
          fav.classList.toggle("active", active);
          fav.setAttribute("aria-pressed", String(active));
          fav.setAttribute(
            "aria-label",
            `${active ? "Remover dos" : "Adicionar aos"} favoritos`,
          );
          fav.innerHTML = '<i data-lucide="star"></i>';
          window.lucide?.createIcons();
          refreshProducts({ detail: { favoriteIds: [fav.dataset.fav] } });
        } else fav.textContent = active ? "★" : "☆";
        return;
      }
      const b = e.target.closest("[data-add]");
      if (!b) return;
      selectCatalogProduct(b.dataset.add, b);
    };
    const openSummary = document.querySelector("#open-sale-summary"),
      closeSummary = document.querySelector("#close-sale-summary");
    if (openSummary && !openSummary.hidden) openSummary.onclick = openCartSurface;
    if (closeSummary && !closeSummary.hidden) closeSummary.onclick = closeCartSurface;
    document.querySelector("#open-client-picker").onclick = () => picker();
    document.querySelector("#sale-client").onchange = () => {
      selectedCampaignIds.clear();
      invalidateAttempt();
      if (activeConflict) { activeConflict = null; setSubmissionState("normal"); }
      traceSale("[CART] customer selected", { clientId: document.querySelector("#sale-client").value || null });
      drawCart();
    };
    document.querySelector("#sale-status").onchange = drawCart;
    document.querySelector("#sale-payment-method")?.addEventListener("change", event => {
      window.CheckoutPaymentMethod = event.target.value;
      document.querySelector("#sale-status").value = ["fiado","crediario"].includes(event.target.value) ? "fiado" : "pago";
      invalidateAttempt();
      window.InstallmentCredit?.update();
      if (activeConflict && event.target.value !== "fiado") { activeConflict = null; setSubmissionState("normal"); }
      drawCart();
    });
    document.querySelector("#selected-client-card").onclick = (e) => {
      if (e.target.closest("[data-change-client]")) picker();
      const b = e.target.closest("[data-client-wa]");
      if (b) {
        const c = clients().getById(b.dataset.clientWa);
        open(
          `https://wa.me/55${somenteNumeros(c.telefone).replace(/^55/, "")}?text=${encodeURIComponent(`Olá, ${c.nome}!`)}`,
          "_blank",
        );
      }
    };
    document.querySelector("#cart").onchange = (e) => {
      const q = e.target.closest("[data-item-qty]"),
        price = e.target.closest("[data-item-price]");
      if (q) {
        const i = cart.find((x) => cartKey(x) === q.dataset.itemQty);
        i.quantidade = i.serviceExecution?1:Math.max(1, Number(q.value) || 1);
      }
      if (price) {
        const i = cart.find((x) => cartKey(x) === price.dataset.itemPrice);
        i.precoFinalUnitario = Number(Math.max(0, Number(price.value) || 0).toFixed(4));
        manual = true;
        selectedCampaignIds.clear();
        discountKind = "item";
      }
      invalidateAttempt();
      drawCart();
    };
    document.querySelector("#cart").onclick = (e) => {
      const step = e.target.closest("[data-cart-step]"),
        b = e.target.closest("[data-remove]");
      if (step) {
        const item = cart.find(
          (entry) => cartKey(entry) === step.dataset.cartKey,
        );
        if (item) {
          if(item.serviceExecution&&Number(step.dataset.cartStep)>0){toast("Adicione outra execução pelo catálogo.");return;}
          item.quantidade += Number(step.dataset.cartStep || 0);
          if (item.quantidade <= 0)
            cart = cart.filter((entry) => entry !== item);
          invalidateAttempt();
          drawCart();
        }
        return;
      }
      if (b) {
        cart = cart.filter((i) => cartKey(i) !== b.dataset.remove);
        invalidateAttempt();
        drawCart();
      }
    };
    document.querySelector("#discount-value").onchange = (e) => {
      distribute(totals().original - Math.max(0, Number(e.target.value) || 0));
      discountKind = "valor";
      manual = false;
      selectedCampaignIds.clear();
      document.querySelector("#discount-percent").value = "0";
      invalidateAttempt();
      drawCart();
    };
    document.querySelector("#discount-percent").onchange = (e) => {
      const n = Math.min(100, Math.max(0, Number(e.target.value) || 0));
      distribute(totals().original * (1 - n / 100));
      discountKind = "percentual";
      manual = false;
      selectedCampaignIds.clear();
      document.querySelector("#discount-value").value = "0";
      invalidateAttempt();
      drawCart();
    };
    document.querySelector("#manual-total").onchange = (e) => {
      distribute(e.target.value);
      discountKind = "valor_final_manual";
      manual = true;
      selectedCampaignIds.clear();
      invalidateAttempt();
      drawCart();
    };
    document.querySelector("#sale-note")?.addEventListener("input", () => { invalidateAttempt(); saveDraft(); });
    document.querySelector("#finish-sale").onclick = async () => {
      traceSale("[SALE] submit clicked", { finishing, items: cartCount() });
      if (activeConflict && document.querySelector("#sale-payment-method")?.value === "fiado" &&
        document.querySelector("#sale-client")?.value === activeConflict.customerId) {
        dispatchEvent(new CustomEvent("resolve-sale-conflict", { detail: activeConflict }));
        return;
      }
      if (finishing) return setSubmissionState("processing", "A venda já está sendo processada.");
      if(window.PriorSales?.active?.()){
        if(!cart.length&&!window.PriorSales.locked())return toast('Adicione ao menos um produto.',true);
        const priorScope=window.TeamAccess?.captureSession?.();finishing=true;setSubmissionState('processing','Preparando a revisão online…');
        if(document.querySelector('#sale-payment-method')?.value==='crediario')return validationError('Crediário está disponível apenas para novas vendas nesta versão.');
        try{await window.PriorSales.submit({itens:structuredClone(cart),clienteId:document.querySelector('#sale-client')?.value||null,formaPagamento:document.querySelector('#sale-payment-method')?.value||'pix',observacao:document.querySelector('#sale-note')?.value||''},async sale=>{
          cart=[];selectedCampaignIds.clear();manual=true;discountKind='historical_manual';activeAttempt=null;clearDraft();draftDetails={clientId:'',paymentMethod:'pix',note:'',discountValue:'0',discountPercent:'0'};
          closeCartSurface({immediate:true});Recibos.mostrar(sale,sale.clienteId?clients().getById(sale.clienteId):null);window.PriorSales.afterConfirmed();
          void window.SyncFirebase?.pullCloudCollections?.({force:true,names:['sales','products','productVariants','clients','stockMovements','balanceEvents']}).catch(()=>{});
        });}
        catch(error){if(priorScope===window.TeamAccess?.captureSession?.()){setSubmissionState('error',error.message);toast(error.message,true);}}
        finally{if(priorScope===window.TeamAccess?.captureSession?.()){finishing=false;setSubmissionState('normal');window.PriorSales.mount();}}
        return;
      }
      const validationError = (message) => {
        setSubmissionState("error", message);
        toast(message, true);
        return false;
      };
      if (window.ExchangeCreditCheckout?.hasPending?.()) return validationError("Há uma confirmação com crédito preservada. Use Consultar confirmação no cartão de crédito de troca. Não registre outra venda.");
      if (restoredDraftKey && (restoredDraftKey !== draftKey() || restoredDraftPrincipal !== draftPrincipal())) return validationError('O espaço do carrinho mudou. Reabra a venda no espaço de origem.');
      const pendingTerminal = window.TerminalPayments?.getCurrent?.();
      if (pendingTerminal && (window.TerminalPayments.ACTIVE_STATUSES.has(pendingTerminal.status) || pendingTerminal.status === "approved")) {
        void window.TerminalPayments.recover();
        return validationError("Existe um pagamento em andamento. Confirme o resultado antes de concluir outra venda.");
      }
      if(await resumeCheckoutSale()) return;
      if (!cart.length) return validationError("Adicione ao menos um produto.");
      let spaceId;
      try {
        spaceId = window.SpaceContext?.requireSalesSpace?.() || "";
        if (!spaceId || spaceId === "all_spaces") throw Error("Selecione o espaço desta venda.");
      } catch (error) {
        return validationError(error.message || "Selecione o espaço desta venda.");
      }
      let serviceBeneficiaryName;
      try { const name = document.querySelector('#sale-beneficiary')?.value || ''; serviceBeneficiaryName = name ? window.FlexibleService.beneficiaryName(name) : ''; }
      catch (error) { return validationError(error.message); }
      const businessId = String(DB.getBusinessId?.() || window.FirebaseSession?.businessId || "").trim(),
        clienteId = document.querySelector("#sale-client").value || null,
        paymentMethod = document.querySelector("#sale-payment-method")?.value || window.CheckoutPaymentMethod || "pix",
        status = ["fiado","crediario"].includes(paymentMethod) ? "fiado" : document.querySelector("#sale-status").value;
      if (!businessId) return validationError("Não foi possível identificar a empresa desta venda. Entre novamente e tente de novo.");
      if (clienteId && !availableCustomers().some(client => client.id === clienteId))
        return validationError('Vincule o cliente ao espaço desta venda antes de selecioná-lo. O carrinho foi preservado.');
      if (status === "fiado" && !clienteId)
        return validationError("Selecione um cliente para vender fiado.");
      if (cart.some((item) => item.productType === "recurring") && !clienteId)
        return validationError("Venda com renovação exige um cliente.");
      if (cart.some((item) => item.productType === "recurring" && item.recurringActivation?.clientIdSnapshot !== clienteId))
        return validationError("Revise as renovações: o cliente da sacola foi alterado.");
      if(clienteId&&Number(window.AdiFestaBuild?.release)>=205&&!window.SyncFirebase?.prepareSaleCustomer)
        return validationError('Atualize o aplicativo para conferir o cliente antes de iniciar a venda ou cobrança. O carrinho foi preservado.');
      if (clienteId && window.SyncFirebase?.prepareSaleCustomer) {
        const customerCheckOrigin = () => JSON.stringify([
          DB.getPrincipal?.(), DB.getBusinessId?.() || window.FirebaseSession?.businessId,
          DB.getWorkspaceGeneration?.(), selectedSalesSpaceId(),
          document.querySelector('#sale-client')?.value || null,
          document.querySelector('#sale-payment-method')?.value || window.CheckoutPaymentMethod || 'pix',
          document.querySelector('#sale-status')?.value, cart,
          document.querySelector('#sale-beneficiary')?.value || '',
        ]);
        const origin = customerCheckOrigin();
        finishing=true;setSubmissionState('processing','Conferindo o cliente na nuvem…');
        try {
          await window.SyncFirebase.prepareSaleCustomer(clienteId, {spaceId,paymentMethod,affectsDebt:status==="fiado"});
          if (origin!==customerCheckOrigin())
            return validationError('O carrinho mudou durante a conferência. Revise a venda antes de confirmar.');
        } catch (error) { return validationError(error.message || 'O cliente ainda não foi confirmado. O carrinho foi preservado.'); }
        finally{finishing=false;}
      }
      if(cart.some(item=>item.serviceExecution)){
        const serviceScope=()=>JSON.stringify([DB.getBusinessId(),DB.getPrincipal?.(),selectedSalesSpaceId(),cart,document.querySelector('#sale-client')?.value,document.querySelector('#sale-payment-method')?.value]);
        const original=serviceScope();finishing=true;setSubmissionState('processing','Conferindo a configuração do serviço…');
        try{
          if(!window.SyncFirebase?.prepareServiceConfigurations)throw Error('Atualize o aplicativo para conferir o serviço. O carrinho foi preservado.');
          await window.SyncFirebase.prepareServiceConfigurations({spaceId,itens:cart});
          if(original!==serviceScope())return validationError('O carrinho mudou durante a conferência. Revise antes de confirmar.');
        }catch(error){return validationError(error.message||'Não foi possível conferir o serviço. O carrinho foi preservado.');}
        finally{finishing=false;}
      }
      if(window.OperationalReadPolicy?.restricted?.()){
        finishing=true;setSubmissionState('processing','Conferindo disponibilidade da venda…');
        try{await window.OperationalReadPolicy.prepareSale();if(businessId!==DB.getBusinessId()||spaceId!==selectedSalesSpaceId())return validationError('O espaço mudou. Revise o carrinho antes de confirmar.');}
        catch(error){return validationError(error.message||'Não foi possível conferir a venda. O carrinho foi preservado.');}
        finally{finishing=false;}
      }
      try {
        window.SyncFirebase?.assertSaleQueueDependencies?.({clienteId,spaceId,status,formaPagamento:paymentMethod,itens:cart});
      } catch (error) { return validationError(error.message); }
      if(paymentMethod==='fiado'&&clienteId&&!activeAttempt?.locked&&window.FiadoConditions?.canView()){
        const advisoryScope=window.SpaceContext?.viewScope?.();
        const advisoryFields=()=>JSON.stringify([DB.getBusinessId(),selectedSalesSpaceId(),cart,
          document.querySelector('#sale-client')?.value,document.querySelector('#manual-total')?.value,
          document.querySelector('#sale-payment-method')?.value]);
        const expected=advisoryFields();
        finishing=true;
        try{
          const limitWarning=await window.FiadoConditions.checkoutWarning(clienteId,
            Math.round(Number(document.querySelector('#manual-total')?.value||0)*100),spaceId);
          if(advisoryScope!==window.SpaceContext?.viewScope?.()||expected!==advisoryFields())
            return validationError('O carrinho ou espaço mudou. Revise antes de concluir.');
          if(limitWarning)Utils.toast(limitWarning,true);
        }finally{finishing=false;}
      }
      traceSale("[SALE] validation passed", { businessId, spaceId, clientId: clienteId, paymentMethod });
      const spaceScope = window.SpaceContext?.viewScope?.();
      const fingerprint = JSON.stringify({ businessId, spaceId, clienteId, serviceBeneficiaryName, paymentMethod, status, installmentTerms:paymentMethod==='crediario'?window.InstallmentCredit.read():null, note: document.querySelector("#sale-note").value, cart, manual, discountKind, campaigns: [...selectedCampaignIds] }),
        attempt = activeAttempt?.fingerprint === fingerprint || activeAttempt?.restored ? { ...activeAttempt, fingerprint, operationId: activeAttempt.operationId || crypto.randomUUID() } : { fingerprint, operationId: crypto.randomUUID(), saleId: crypto.randomUUID() },
        proceed = async () => {
          if (spaceScope !== window.SpaceContext?.viewScope?.() || spaceId !== selectedSalesSpaceId())
            return validationError('O espaço da venda mudou. Revise o carrinho antes de confirmar.');
          if (serviceBeneficiaryName !== (document.querySelector('#sale-beneficiary')?.value ? window.FlexibleService.beneficiaryName(document.querySelector('#sale-beneficiary').value) : ''))
            return validationError('O cliente atendido mudou. Revise a venda antes de confirmar.');
          if (finishing) return setSubmissionState("processing", "A venda já está sendo processada.");
          if(activeAttempt?.operationId&&activeAttempt.operationId!==attempt.operationId&&(DB.carregar().vendas||[]).some(s=>s.operationId===activeAttempt.operationId))return validationError("A tentativa anterior já gerou uma venda. Consulte sua confirmação antes de alterar ou repetir o carrinho.");
          try {
            for (const item of cart) {
              const renewal = item.recurringActivation;
              if (!renewal?.renewalPolicyVersion || !renewal.subscriptionId) continue;
              const current = CustomerSubscriptions.get(renewal.subscriptionId);
              if (current?.lastSaleId !== attempt.saleId)
                CustomerSubscriptions.requireRenewable(current, {
                  clientId: clienteId, productId: item.produtoId, businessId, spaceId, expected: renewal.expectedSubscription,
                });
            }
          } catch (error) {
            return validationError(error.message);
          }
          activeAttempt = attempt;
          saveDraft();
          finishing = true;
          setSubmissionState("processing", navigator.onLine === false ? "Salvando neste aparelho. A sincronização ocorrerá quando a conexão voltar." : "Concluindo a venda…");
          const saleDraft = {
            id: attempt.saleId,
            businessId,
            spaceId,
            financialSpaceId: spaceId,
            clienteId,
            ...(serviceBeneficiaryName ? {serviceBeneficiaryName} : {}),
            status,
            operationId: attempt.operationId,
            formaPagamento: paymentMethod === "crediario" ? "fiado" : paymentMethod,
            ...(paymentMethod === "crediario" ? {installmentTerms:window.InstallmentCredit.read()} : {}),
            observacao: document.querySelector("#sale-note").value,
            itens: cart,
            ajusteManual: manual,
            descontoTipo: discountKind,
            appliedCampaignIds: [...selectedCampaignIds],
          };
          traceSale("[SALE] operation created", { operationId: attempt.operationId, saleId: attempt.saleId });
          const usingExchangeCredit = Number(window.ExchangeCreditCheckout?.selectedCents?.() || 0) > 0;
          if (usingExchangeCredit && (status === 'fiado' || paymentMethod === 'cartao_presencial')) {
            finishing = false; return validationError('Crédito de troca exige venda à vista, sem pagamento integrado nesta V1.');
          }
          if (paymentMethod === "cartao_presencial") {
            try {
              const started = await window.TerminalPayments.beginCheckout({
                saleDraft,
                amountCents: Math.round(Number(document.querySelector("#manual-total")?.value || 0) * 100),
              });
              if (started === false) {
                finishing = false;
                setSubmissionState("error", navigator.onLine === false ? "Sem conexão. O carrinho foi preservado; conecte-se e tente novamente." : "A cobrança não foi iniciada. O carrinho permanece pronto para tentar novamente.");
              }
            } catch (error) {
              finishing = false;
              const message = error.message || "Não foi possível iniciar a cobrança. Tente novamente.";
              setSubmissionState("error", message);
              toast(message, true);
            }
            return;
          }
          let sale;
          try {
            if (usingExchangeCredit) {
              sale = await window.ExchangeCreditCheckout.finish(saleDraft);
            } else {
            if (status === "fiado")
              await window.SyncFirebase?.prepareCustomerForSale?.(clienteId);
            if(saleDraft.installmentTerms){
              const session=window.TeamAccess?.captureSession?.();
              const items=JSON.stringify(cart);
              saleDraft.installmentAccount=await window.InstallmentCredit.refresh(clienteId);
              window.TeamAccess?.assertSession?.(session);
              if(DB.getBusinessId()!==businessId||selectedSalesSpaceId()!==spaceId||
                 document.querySelector('#sale-client')?.value!==clienteId||document.querySelector('#sale-payment-method')?.value!==paymentMethod||
                 JSON.stringify(cart)!==items||
                 JSON.stringify(saleDraft.installmentTerms)!==JSON.stringify(window.InstallmentCredit.read()))
                throw Error('A venda mudou durante a conferência. Revise o carrinho.');
            }
            traceSale("[SALE] local write started", { operationId: attempt.operationId });
            sale = Repositories.saleRepository().create(saleDraft);
            await DB.flush?.();
            if (status === "fiado" && navigator.onLine !== false)
              sale = await window.SyncFirebase.confirmCreditSale(sale);
            if (status === "fiado" && sale.status !== "fiado")
              sale = { ...sale, status: "fiado", formaPagamento: "fiado" };
            }
          } catch (error) {
            finishing = false;
            const message = error.message || "Não foi possível concluir a venda. Seu carrinho foi preservado.";
            if (error.code === "customer-credit-orphan") {
              activeConflict = { customerId: error.customerId || clienteId,
                saleId: error.saleId || "", operationId: error.operationId || "" };
              setSubmissionState("conflict", message);
            } else if(hasSavedSaleAttempt()||error.code==='sale-original-review-required') holdOriginalSale();
            else setSubmissionState("error", message);
            saveDraft();
            traceSale("[SALE] failed", { operationId: attempt.operationId, code: error?.code || error?.name || "unknown" });
            if (error.code !== "customer-credit-orphan") toast(message, true);
            return;
          }
          if (spaceScope !== window.SpaceContext?.viewScope?.()) { finishing=false; return; }
          finishSavedSale(sale,{usingExchangeCredit});
        };
      const missing = Vendas.estoqueInsuficiente(cart);
      if (
        missing.length &&
        !confirm(
          `Estoque insuficiente para: ${missing.map((x) => x.produto.nome).join(", ")}. Deseja continuar?`,
        )
      )
        return;
      await proceed();
    };
    document.querySelector("#desktop-clear-cart")?.addEventListener(
      "click",
      () => {
        if (!cart.length) return;
        if (!confirm("Limpar todos os itens do carrinho?")) return;
        cart = [];
        selectedCampaignIds.clear();
        activeAttempt = null;
        clearDraft();
        drawCart();
      },
    );
    updateBeneficiaryField();
    applyDraftDetails();
    drawCart();
    restoreCatalogView();
    if (pendingClient) {
      const select = document.querySelector("#sale-client");
      if (select && clients().getById(pendingClient.clientId)) {
        setSaleCustomer(pendingClient.clientId, select);
        select.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector("#product-search")?.focus();
      }
      pendingClient = null;
    }
    if (pendingRenewal) {
      const request = pendingRenewal;
      pendingRenewal = null;
      setTimeout(() => openSelectedRenewal(request), 0);
    }
    window.lucide?.createIcons();
  }
  function prepareClientSale(clientId, source = "client_swipe") {
    const client = availableCustomers().find(client => client.id === clientId);
    if (!client) return (toast("Cliente não disponível neste espaço. Confira o vínculo no cadastro.", true), false);
    if (
      cart.length &&
      !confirm(
        "Existe uma sacola em andamento. Deseja usar este cliente na venda atual?",
      )
    )
      return false;
    pendingClient = { clientId, source };
    if (Router.atual() === "vender" && document.querySelector("#sale-client")) {
      const select = document.querySelector("#sale-client");
      setSaleCustomer(clientId, select);
      select.dispatchEvent(new Event("change", { bubbles: true }));
      pendingClient = null;
      document.querySelector("#product-search")?.focus();
    } else Router.ir("vender");
    return true;
  }
  function resetSession() {
    catalog = null;
    savedCatalogView = null;
    clearDraft();
    cart = [];
    discountKind = null;
    manual = false;
    finishing = false;
    activeAttempt = null;
    draftDetails = { clientId: "", paymentMethod: "pix", note: "", discountValue: "0", discountPercent: "0" };
    pendingClient = null;
    pendingRenewal = null;
    selectedCampaignIds.clear();
  }

  function openCartSurface() {
    if(!window.PriorSales?.active?.())void window.TerminalPayments?.refreshAvailability?.(selectedSalesSpaceId());
    traceSale("[CART] checkout opened", { items: cartCount(), spaceId: selectedSalesSpaceId() });
    if (window.DesktopSales?.isDesktop?.())
      return window.DesktopSales.openCart?.();
    if (window.CheckoutMobile?.openSummary)
      return window.CheckoutMobile.openSummary();
    const summary = document.querySelector("#pos-summary"),
      overlay = document.querySelector("[data-sale-cart-overlay]"),
      trigger = document.querySelector("#open-sale-summary");
    if (!summary) return false;
    summary.hidden = false;
    summary.classList.add("mobile-open");
    summary.setAttribute("aria-hidden", "false");
    if (overlay) {
      overlay.hidden = false;
      overlay.classList.add("open");
    }
    trigger?.setAttribute("aria-expanded", "true");
    document.body.classList.add("sale-sheet-open");
    return true;
  }

  function closeCartSurface(options = {}) {
    if (window.DesktopSales?.isDesktop?.())
      return window.DesktopSales.closeCart?.();
    if (window.CheckoutMobile?.closeSummary)
      return window.CheckoutMobile.closeSummary(options);
    const summary = document.querySelector("#pos-summary"),
      overlay = document.querySelector("[data-sale-cart-overlay]"),
      trigger = document.querySelector("#open-sale-summary");
    if (!summary) return false;
    summary.classList.remove("mobile-open");
    summary.hidden = true;
    summary.setAttribute("aria-hidden", "true");
    overlay?.classList.remove("open");
    if (overlay) overlay.hidden = true;
    trigger?.setAttribute("aria-expanded", "false");
    document.body.classList.remove("sale-sheet-open");
    return true;
  }
  async function finalizeTerminalPayment(intent) {
    const verified = await window.FirebaseCallable("getTerminalPaymentStatus", { businessId: intent.businessId, intentId: intent.id });
    intent = verified?.data?.intent;
    if (!intent?.saleDraft || intent.status !== "approved")
      throw Error("Pagamento ainda não foi aprovado.");
    const remote = await window.SyncFirebase.readIntegratedSale(intent);
    if (intent.businessId !== DB.getBusinessId() || intent.createdByUid !== window.FirebaseSession?.user?.uid)
      throw Error("Retorne à empresa e ao usuário desta cobrança para finalizar.");
    const existing = remote || Vendas.listar().find(
      (sale) => sale.operationId === intent.finalizationOperationId,
    );
    const sale = existing || Repositories.saleRepository().create({
      ...intent.saleDraft,
      businessId: intent.businessId,
      id: intent.saleId,
      status: "pago",
      operationId: intent.finalizationOperationId,
      formaPagamento: "cartao_presencial",
      paymentIntentId: intent.id,
      terminalId: intent.terminalId,
      paymentState: "paid",
      receivableStatus: "pending_settlement",
      paymentMetadata: {
        channel: "card_present",
        isTest: intent.isTest === true,
        provider: intent.provider,
        terminalId: intent.terminalId,
        terminalNickname: intent.terminalNickname,
        method: intent.paymentMethod,
        installments: intent.installments,
        providerPaymentId: intent.providerPaymentId || null,
        providerOrderId: intent.providerOrderId || null,
      },
    });
    await DB.flush?.();
    const confirmed = await window.SyncFirebase.readIntegratedSale(intent, { flush: true });
    if (!confirmed) throw Error("Venda aguardando confirmação na nuvem. Não cobre novamente.");
    return confirmed;
  }
  function completeTerminalPayment(sale) {
    // Clear only the cart that produced this attempt; recovery must not discard
    // another cart assembled while a previous approved payment was pending.
    if (activeAttempt?.saleId === sale.id || !cart.length) {
    cart = [];
    selectedCampaignIds.clear();
    manual = false;
    discountKind = null;
    finishing = false;
    activeAttempt = null;
    draftDetails = { clientId: "", paymentMethod: "pix", note: "", discountValue: "0", discountPercent: "0" };
    clearDraft();
    }
    window.CheckoutPaymentMethod = "cartao_presencial";
    setSubmissionState("success", "Venda concluída com sucesso.");
    refreshClients();
    const client = sale.clienteId ? clients().getById(sale.clienteId) : null;
    closeCartSurface({ immediate: true });
    traceSale("[SALE] completed", { operationId: sale.operationId, saleId: sale.id, spaceId: sale.spaceId, terminal: true });
    Recibos.mostrar(sale, client);
    return sale;
  }
  function restoreTerminalDraft(intent) {
    const draft = intent?.saleDraft;
    if (!draft || cart.length || !draft.itens?.length) return;
    cart = structuredClone(draft.itens);
    manual = Boolean(draft.ajusteManual);
    discountKind = draft.descontoTipo || null;
    selectedCampaignIds = new Set(draft.appliedCampaignIds || []);
    activeAttempt = { saleId: intent.saleId || draft.id, operationId: intent.finalizationOperationId, restored: true };
    draftDetails = { ...draftDetails, clientId: draft.clienteId || "", paymentMethod: "cartao_presencial", note: draft.observacao || "", beneficiaryName: draft.serviceBeneficiaryName || '' };
    saveDraft();
  }
  function openSelectedRenewal(request) {
    try {
      if (Router.atual() !== "vender" || document.querySelector("#sale-client")?.value !== request.clientId)
        throw Error("O cliente da renovação não está selecionado. Volte ao perfil para conferir.");
      const subscription = selectedRenewal(request),
        product = products().getById(subscription.productId),
        variant = subscription.variantId ? ProductVariations.get(subscription.variantId) : null;
      if (product?.productType !== "recurring" || !productAvailableHere(product) ||
          (subscription.variantId && (!variant || variant.parentProductId !== product.id || variant.active === false || variant.deletedAt)))
        throw Error("O produto ou a variação desta vigência está indisponível neste espaço.");
      void recurringConfiguration(product, variant, null, request);
    } catch (error) {
      toast(error.message, true);
    }
  }
  function prepareRenewal(subscriptionId) {
    const subscription = CustomerSubscriptions.get(subscriptionId);
    const request = { id: subscriptionId, clientId: subscription?.clientId, productId: subscription?.productId,
      variantId: String(subscription?.variantId || ""), scope: renewalScope() };
    try { selectedRenewal(request); }
    catch (error) { return (toast(error.message, true), false); }
    pendingRenewal = request;
    if (!prepareClientSale(request.clientId, "customer_profile_renewal")) {
      pendingRenewal = null;
      return false;
    }
    if (pendingRenewal === request && Router.atual() === "vender" && document.querySelector("#sale-client")) {
      pendingRenewal = null;
      openSelectedRenewal(request);
    }
    return true;
  }
  function resumeAfterReconciliation(customerId) {
    const selectedId = String(document.querySelector("#sale-client")?.value || "");
    if (!selectedId || selectedId !== String(customerId || "")) return false;
    activeConflict = null;
    finishing = false;
    activeAttempt = null;
    refreshClients();
    setSubmissionState("normal");
    drawCart();
    saveDraft();
    return true;
  }
  function mount() {
    if (Router.atual() !== "vender") return false;
    return window.AppPageRuntime?.mount?.("vender") || false;
  }
  addEventListener("firebase-session-cleared", resetSession);
  addEventListener("installment-preview-changed", selectedClient);
  addEventListener("online", selectedClient);
  addEventListener("terminal-payment-retry-ready", () => {
    finishing = false;
    setSubmissionState("error", "A cobrança não foi concluída. Revise os dados e tente novamente.");
  });
  return {
    view,
    catalogCard: card,
    selectCatalogProduct,
    captureCatalogView,
    enhance,
    mount,
    prepareClientSale,
    prepareRenewal,
    resetSession,
    openVariantPicker: variablePicker,
    openRecurringProduct,
    addSaleItem,
    bind: standalone,
    bindDesktop: standalone,
    filterProducts: filter,
    refreshProducts,
    refreshClients,
    setSaleCustomer,
    availableCustomers,
    retireSpaceDraft,
    resumeAfterReconciliation,
    finalizeTerminalPayment,
    completeTerminalPayment,
    restoreTerminalDraft,
    cartCount,
    state: () => ({ finishing, items: cartCount(), activeOperationId: activeAttempt?.operationId || null, draftKey: draftKey() }),
  };
})();
