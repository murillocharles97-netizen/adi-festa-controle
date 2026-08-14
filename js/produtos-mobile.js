(function () {
  "use strict";
  const mq = matchMedia("(max-width: 767px)"),
    $ = (selector, root = document) => root.querySelector(selector),
    $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const saved = (() => {
    try {
      return JSON.parse(localStorage.getItem("adiFestaProductMobile") || "{}");
    } catch {
      return {};
    }
  })();
  const state = {
    query: "",
    filter: "todos",
    sort: localStorage.getItem("productSortMode") || saved.sort || "nomeAsc",
    view: localStorage.getItem("productViewMode") || saved.view || "list",
    category: "todos",
    limit: 50,
    menuId: null,
    filtersOpen: false,
  };
  let dataCache = null,
    observer = null;
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const esc = (value) =>
    String(value ?? "").replace(
      /[&<>'"]/g,
      (char) =>
        ({
          "&": "&amp;",
          "<": "&lt;",
          ">": "&gt;",
          "'": "&#39;",
          '"': "&quot;",
        })[char],
    );
  const norm = (value) =>
    String(value ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/\s+/g, " ")
      .trim();
  const money = (value) =>
    Number(value || 0).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  const initials = (name) =>
    String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((word) => word[0])
      .join("")
      .toUpperCase();
  const products = () => dataCache || (dataCache = DB.carregar());
  const status = (product) => getProductStockStatus(product);
  const statusInfo = (product) =>
    ({
      disponivel: { label: "Em estoque", icon: "circle-check" },
      baixo: { label: "Baixo estoque", icon: "circle-alert" },
      esgotado: { label: "Esgotado", icon: "circle-x" },
      "sem-controle": { label: "Sem controle", icon: "infinity" },
    })[status(product)];
  const productStock = (product) =>
    Number(
      product.productType === "variable"
        ? product.totalStock
        : (product.estoqueAtual ?? product.estoque ?? 0),
    );
  const productPrice = (product) =>
    Number(
      product.productType === "variable" ? product.minPrice : product.preco,
    );
  const priceLabel = (product) =>
    product.productType === "variable" &&
    Number(product.minPrice) !== Number(product.maxPrice)
      ? `${money(product.minPrice)} – ${money(product.maxPrice)}`
      : money(productPrice(product));
  const stockPercent = (product) => {
    if (status(product) === "sem-controle") return 0;
    const current = productStock(product),
      minimum = Number(product.estoqueMinimo || 0),
      reference = Math.max(minimum > 0 ? minimum * 2 : 10, current, 1);
    return Math.min(100, Math.max(0, (current / reference) * 100));
  };
  const saveState = () => {
    localStorage.setItem("productViewMode", state.view);
    localStorage.setItem("productSortMode", state.sort);
    localStorage.setItem(
      "adiFestaProductMobile",
      JSON.stringify({ view: state.view, sort: state.sort }),
    );
  };
  function soldMap(db) {
    const map = new Map();
    (db.vendas || []).forEach((sale) =>
      (sale.itens || []).forEach((item) =>
        map.set(
          item.produtoId,
          (map.get(item.produtoId) || 0) + Number(item.quantidade || 0),
        ),
      ),
    );
    return map;
  }
  function filtered() {
    const db = products(),
      sold = soldMap(db),
      query = norm(state.query),
      barcode = window.normalizeBarcode?.(state.query) || "",
      variantMatches = new Map(
        (window.ProductVariations?.search(state.query, db) || []).map(
          (item) => [item.product.id, item],
        ),
      );
    let list = (db.produtos || [])
      .filter((product) => product.ativo !== false)
      .filter((product) => {
        delete product._variationMatch;
        const direct =
            !query ||
            (barcode && product.barcode === barcode) ||
            norm(
              [
                product.nome,
                product.codigo,
                product.barcode,
                product.categoria,
                product.observacao,
                product.observacoes,
                ...(product.variationSearchTokens || []),
              ].join(" "),
            ).includes(query),
          match = variantMatches.get(product.id);
        if (match) product._variationMatch = match.match;
        return direct || Boolean(match);
      })
      .filter(
        (product) =>
          state.category === "todos" ||
          norm(product.categoria || "Sem categoria") === state.category,
      )
      .filter(
        (product) =>
          state.filter === "todos" ||
          (state.filter === "favoritos" && product.favorito === true) ||
          (state.filter === "disponivel" &&
            (status(product) === "disponivel" ||
              status(product) === "sem-controle")) ||
          (state.filter === "baixo" && status(product) === "baixo") ||
          (state.filter === "esgotado" && status(product) === "esgotado") ||
          (state.filter === "simples" && product.productType !== "variable") ||
          (state.filter === "variacoes" && product.productType === "variable"),
      );
    list.sort((a, b) =>
      state.sort === "favoritos"
        ? Number(Boolean(b.favorito)) - Number(Boolean(a.favorito)) ||
          String(a.nome).localeCompare(String(b.nome), "pt-BR")
        : state.sort === "nomeDesc"
          ? String(b.nome).localeCompare(String(a.nome), "pt-BR")
          : state.sort === "menorEstoque"
            ? productStock(a) - productStock(b)
            : state.sort === "maiorEstoque"
              ? productStock(b) - productStock(a)
              : state.sort === "menorPreco"
                ? productPrice(a) - productPrice(b)
                : state.sort === "maiorPreco"
                  ? productPrice(b) - productPrice(a)
                  : state.sort === "alteracao"
                    ? new Date(b.atualizadoEm || 0) -
                      new Date(a.atualizadoEm || 0)
                    : state.sort === "vendidos"
                      ? (sold.get(b.id) || 0) - (sold.get(a.id) || 0)
                      : String(a.nome).localeCompare(String(b.nome), "pt-BR"),
    );
    return list;
  }
  function counts() {
    const list = (products().produtos || []).filter(
      (product) => product.ativo !== false,
    );
    return {
      all: list.length,
      favorites: list.filter((p) => p.favorito).length,
      available: list.filter((p) =>
        ["disponivel", "sem-controle"].includes(status(p)),
      ).length,
      low: list.filter((p) => status(p) === "baixo").length,
      out: list.filter((p) => status(p) === "esgotado").length,
      simple: list.filter((p) => p.productType !== "variable").length,
      variable: list.filter((p) => p.productType === "variable").length,
    };
  }
  function chip(key, label, count, iconName = "") {
    return `<button class="product-filter-chip ${state.filter === key ? "active" : ""}" type="button" data-product-filter="${key}">${iconName ? icon(iconName) : ""}<span>${label}</span><b>${count}</b></button>`;
  }
  function stock(product) {
    const current = productStock(product),
      info = statusInfo(product),
      type = status(product);
    return `<div class="mobile-product-stock ${type}"><strong>${type === "sem-controle" ? "Estoque livre" : `${current} un.`}</strong>${type !== "sem-controle" ? `<span class="product-stock-track"><i style="width:${stockPercent(product)}%"></i></span>` : ""}<em>${info.label}</em></div>`;
  }
  function card(product, index) {
    const type = status(product),
      color =
        Math.abs(
          [...String(product.nome)].reduce(
            (sum, char) => sum + char.charCodeAt(0),
            0,
          ),
        ) % 6,
      variable = product.productType === "variable",
      controlsStock = !product.semControleEstoque && product.controlaEstoque !== false;
    return `<div class="mobile-product-swipe ${type} ${variable ? "variable" : ""} ${state.view === "grid" ? "grid-mode" : ""}" data-product-shell="${product.id}" data-controls-stock="${controlsStock}" style="--delay:${Math.min(index, 14) * 22}ms;--product-color:${color}">${controlsStock ? `<div class="product-swipe-action entry">${icon("package-plus")}<span>Adicionar entrada</span></div>` : ""}<div class="product-swipe-action edit">${icon("pencil")}<span>Editar produto</span></div><article class="mobile-product-card" data-product-card="${product.id}" tabindex="0" aria-label="${esc(product.nome)}, ${priceLabel(product)}, ${statusInfo(product).label}"><div class="mobile-product-avatar color-${color}">${window.ProductImages?.markup(product,{className:"mobile-product-card-photo"}) || esc(initials(product.nome))}<button class="favorite-dot show ${product.favorito ? "active" : ""}" type="button" data-product-favorite="${product.id}" aria-label="${product.favorito ? "Remover dos favoritos" : "Adicionar aos favoritos"}" aria-pressed="${Boolean(product.favorito)}">${icon("star")}</button></div><div class="mobile-product-copy"><h3 title="${esc(product.nome)}">${esc(product.nome)}</h3>${variable ? `<span class="product-variation-badge">${Number(product.activeVariationCount || 0)} variações</span>` : `<p>${esc(product.categoria) || "Sem categoria"}${product.codigo ? ` <b>·</b> ${esc(product.codigo)}` : ""}</p>`}${product._variationMatch ? `<small class="variation-search-match">${esc(product._variationMatch)}</small>` : ""}<strong>${priceLabel(product)}</strong></div>${stock(product)}<button class="mobile-product-more" type="button" data-product-menu="${product.id}" aria-label="Mais ações de ${esc(product.nome)}">${icon("ellipsis-vertical")}</button></article></div>`;
  }
  function empty(list) {
    if (list.length) return "";
    const total = counts().all;
    if (!total)
      return `<div class="mobile-product-empty">${icon("package-open")}<h3>Nenhum produto cadastrado</h3><button data-product-new>Novo produto</button></div>`;
    if (state.filter === "favoritos")
      return `<div class="mobile-product-empty">${icon("star")}<h3>Nenhum produto favorito</h3><p>Toque na estrela de um produto para adicioná-lo aos favoritos.</p><button data-clear-product-filters>Limpar filtros</button></div>`;
    if (state.filter === "baixo")
      return `<div class="mobile-product-empty success">${icon("circle-check-big")}<h3>Tudo certo!</h3><p>Nenhum produto está com estoque baixo.</p><button data-clear-product-filters>Ver todos</button></div>`;
    return `<div class="mobile-product-empty">${icon("search-x")}<h3>Nenhum produto encontrado</h3><button data-clear-product-filters>Limpar filtros</button></div>`;
  }
  function actions() {
    return `<div class="mobile-product-compact-actions"><button data-product-new>${icon("plus")} Novo produto</button><button data-scan-stock>${icon("package-plus")} Entrada por código</button><button data-product-entry-select hidden></button><button data-product-inventory hidden></button></div>`;
  }
  function filtersSheet() {
    const categories = [
      ...new Set(
        (products().produtos || [])
          .filter((p) => p.ativo !== false)
          .map((p) => p.categoria || "Sem categoria"),
      ),
    ].sort((a, b) => a.localeCompare(b, "pt-BR"));
    return `<div class="product-sheet-overlay ${state.filtersOpen || state.menuId ? "open" : ""}" data-product-sheet-close></div><section class="product-filter-sheet ${state.filtersOpen ? "open" : ""}" ${state.filtersOpen ? "" : "inert"}><div class="sheet-handle"></div><header><div><h3>Filtrar produtos</h3><p>Escolha uma categoria.</p></div><button data-product-sheet-close aria-label="Fechar filtros">${icon("x")}</button></header><div class="product-category-options"><button class="${state.category === "todos" ? "active" : ""}" data-product-category="todos">Todas as categorias</button>${categories.map((category) => `<button class="${state.category === norm(category) ? "active" : ""}" data-product-category="${esc(norm(category))}">${esc(category)}</button>`).join("")}</div></section>`;
  }
  function menuSheet() {
    if (!state.menuId) return "";
    const product = Produtos.obter(state.menuId);
    if (!product) return "";
    const controlsStock = !product.semControleEstoque && product.controlaEstoque !== false;
    return `<section class="product-action-sheet open"><div class="sheet-handle"></div><header><div class="mobile-product-avatar">${window.ProductImages?.markup(product,{className:"mobile-product-card-photo"}) || esc(initials(product.nome))}</div><div><h3>${esc(product.nome)}</h3><p>${money(product.preco)} · ${statusInfo(product).label}</p></div><button data-product-sheet-close aria-label="Fechar menu">${icon("x")}</button></header><div class="product-sheet-actions">${controlsStock?`<button data-product-entry="${product.id}">${icon("package-plus")}<span><b>Adicionar entrada</b><small>Somar unidades ao estoque</small></span></button><button data-product-adjust="${product.id}">${icon("sliders-horizontal")}<span><b>Ajustar estoque</b><small>Corrigir a quantidade atual</small></span></button>`:""}<button data-product-history="${product.id}">${icon("history")}<span><b>Histórico</b><small>Ver entradas, saídas e ajustes</small></span></button><button data-product-edit="${product.id}">${icon("pencil")}<span><b>Editar produto</b><small>Alterar dados e preços</small></span></button><button class="danger" data-product-delete="${product.id}">${icon("trash-2")}<span><b>Excluir produto</b><small>Esta ação exige confirmação</small></span></button></div></section>`;
  }
  function render() {
    dataCache = null;
    const c = counts(),
      list = filtered(),
      shown = list.slice(0, state.limit);
    return `<section class="products-mobile-page"><div class="mobile-product-search"><label>${icon("search")}<input id="mobile-product-search" value="${esc(state.query)}" placeholder="Buscar produto" aria-label="Buscar produto por nome, código de barras ou categoria" autocomplete="off"></label><button id="mobile-product-open-filters" aria-label="Filtrar produtos">${icon("list-filter")}<span>Filtros</span></button></div>${actions()}<div class="product-filter-scroll">${chip("todos", "Todos", c.all)}${chip("favoritos", "Favoritos", c.favorites, "star")}${chip("disponivel", "Em estoque", c.available, "package-check")}${chip("baixo", "Baixo estoque", c.low, "circle-alert")}${chip("esgotado", "Esgotados", c.out, "circle-x")}</div><div class="mobile-product-sort-view"><label><span>Ordenar por</span><select id="mobile-product-sort"><option value="favoritos">Favoritos primeiro</option><option value="nomeAsc">Nome A–Z</option><option value="nomeDesc">Nome Z–A</option><option value="menorEstoque">Menor estoque</option><option value="maiorEstoque">Maior estoque</option><option value="menorPreco">Menor preço</option><option value="maiorPreco">Maior preço</option><option value="alteracao">Última alteração</option><option value="vendidos">Mais vendidos</option></select></label><div class="product-view-toggle"><button class="${state.view === "list" ? "active" : ""}" data-product-view="list">${icon("list")} Lista</button><button class="${state.view === "grid" ? "active" : ""}" data-product-view="grid">${icon("grid-2x2")} Grade</button></div></div><div class="mobile-products ${state.view}" id="mobile-products">${shown.map(card).join("")}${empty(list)}</div>${shown.length < list.length ? `<div class="mobile-product-sentinel" id="mobile-product-sentinel"><i></i>Carregando mais produtos…</div>` : ""}${filtersSheet()}${menuSheet()}<div class="mobile-product-legacy" aria-hidden="true"><button id="new-product"></button><input id="search"><div id="entity-list"></div></div></section>`;
  }
  function refresh(reset = false, motion = "") {
    dataCache = null;
    if (reset) state.limit = 50;
    const app = $("#app");
    if (!app) return;
    const oldList = $("#mobile-products", app),
      oldStock = new Map(
        (oldList ? $$("[data-product-shell]", oldList) : []).map((shell) => [
          shell.dataset.productShell,
          {
            width: $(".product-stock-track i", shell)?.style.width || "",
            status: shell.className,
          },
        ]),
      ),
      previous = motion && window.MobileMotion
        ? window.MobileMotion.capture(oldList, "[data-product-shell]", "data-product-shell")
        : null;
    const scroll = scrollY;
    app.innerHTML = render();
    const page = $(".products-mobile-page", app);
    if (page) page.dataset.productsBound = "true";
    bind();
    scrollTo({ top: scroll });
    window.lucide?.createIcons();
    $$("[data-product-shell]", app).forEach((shell) => {
      const before = oldStock.get(shell.dataset.productShell),
        bar = $(".product-stock-track i", shell),
        badge = $(".mobile-product-stock em", shell);
      if (!before || !bar || before.width === bar.style.width) return;
      const target = bar.style.width;
      bar.style.width = before.width;
      requestAnimationFrame(() => {
        bar.style.width = target;
        window.MobileMotion?.animate(badge, [{ opacity: 0.35, transform: "translateY(3px)" }, { opacity: 1, transform: "translateY(0)" }], { duration: 180 });
      });
    });
    if (previous)
      requestAnimationFrame(() =>
        window.MobileMotion.flip(
          $("#mobile-products", app),
          previous,
          "[data-product-shell]",
          "data-product-shell",
          { name: motion, duration: motion === "layout" ? 235 : 185 },
        ),
      );
  }
  function modal(title, body, onSave, label = "Salvar") {
    const root = $("#modal");
    root.innerHTML = `<div class="modal-bg"><section class="modal-box"><header class="modal-head"><h3>${title}</h3><button class="icon-btn close" type="button">${icon("x")}</button></header><form><div class="modal-body">${body}</div><footer class="modal-foot"><button type="button" class="btn btn-light close">Cancelar</button><button class="btn btn-primary">${label}</button></footer></form></section></div>`;
    $$(".close", root).forEach((button) => (button.onclick = Modais.fechar));
    $("form", root).onsubmit = async (event) => {
      event.preventDefault();
      const submit = event.submitter || $("button[type='submit'],.btn-primary", event.currentTarget),
        original = submit?.textContent;
      if (submit) submit.disabled = true;
      try {
        await onSave(new FormData(event.target));
        Modais.fechar();
        refresh();
      } catch (error) {
        Utils.toast(error.message || "Não foi possível salvar", true);
        if (submit) {
          submit.disabled = false;
          submit.textContent = original;
        }
      }
    };
    window.lucide?.createIcons();
  }
  function chooseProductType() {
    const root = $("#modal");
    root.innerHTML = `<div class="modal-bg"><section class="modal-box product-type-picker"><header class="modal-head"><h3>Que tipo de produto deseja criar?</h3><button class="icon-btn close">${icon("x")}</button></header><div class="modal-body product-type-options"><button data-product-type="simple">${icon("package")}<b>Produto simples</b><small>Um preço e um estoque.</small></button><button data-product-type="variable">${icon("boxes")}<b>Produto com variações</b><small>Sabores, cores, tamanhos ou combinações.</small></button></div></section></div>`;
    $(".close", root).onclick = Modais.fechar;
    $('[data-product-type="simple"]', root).onclick = () =>
      ProductImages.openForm(null);
    $('[data-product-type="variable"]', root).onclick = () => variableWizard();
    window.lucide?.createIcons();
  }
  function variableWizard() {
    const draft = {
        step: 1,
        product: {
          id: Utils.uuid(),
          nome: "",
          categoria: "",
          observacao: "",
          semControleEstoque: false,
          controlaEstoque: true,
          ativo: true,
          favorito: false,
        },
        attributes: [{ id: "sabor", name: "Sabor", values: [] }],
        variants: [],
      },
      root = $("#modal"),
      imageDraft = ProductImages.createDraft(null);
    const syncCombinations = () => {
      const existing = new Map(
        draft.variants.map((item) => [
          JSON.stringify(item.attributeValues),
          item,
        ]),
      );
      draft.variants = ProductVariations.combinations(draft.attributes).map(
        (item) => ({
          ...item,
          ...existing.get(JSON.stringify(item.attributeValues)),
          attributeValues: item.attributeValues,
          displayName: item.displayName,
          price: existing.get(JSON.stringify(item.attributeValues))?.price ?? 0,
          cost: existing.get(JSON.stringify(item.attributeValues))?.cost ?? 0,
          stock: existing.get(JSON.stringify(item.attributeValues))?.stock ?? 0,
          minStock:
            existing.get(JSON.stringify(item.attributeValues))?.minStock ?? 0,
          sku: existing.get(JSON.stringify(item.attributeValues))?.sku || "",
          barcode:
            existing.get(JSON.stringify(item.attributeValues))?.barcode || "",
          active: true,
          catalogVisible: true,
        }),
      );
    };
    const stepBody = () =>
      draft.step === 1
        ? `<div class="field"><label>Nome *</label><input name="nome" value="${esc(draft.product.nome)}" required></div><div class="field"><label>Categoria</label><input name="categoria" value="${esc(draft.product.categoria)}"></div><div class="field"><label>Descrição</label><textarea name="observacao">${esc(draft.product.observacao)}</textarea></div><label class="check"><input name="favorito" type="checkbox" ${draft.product.favorito ? "checked" : ""}> Favorito</label><label class="check"><input name="controlaEstoque" type="checkbox" ${draft.product.semControleEstoque ? "" : "checked"}> Controlar estoque deste produto</label>${ProductImages.editorMarkup(imageDraft)}`
        : draft.step === 2
          ? `<p>Cadastre um ou dois atributos. Separe os valores por vírgula.</p>${draft.attributes.map((attribute, index) => `<section class="wizard-attribute"><div class="field"><label>Atributo ${index + 1}</label><input name="attributeName:${index}" value="${esc(attribute.name)}" placeholder="Ex.: Sabor"></div><div class="field"><label>Valores</label><input name="attributeValues:${index}" value="${esc(attribute.values.join(", "))}" placeholder="Ferrero, Nutella, Prestígio"></div>${index ? `<button type="button" data-remove-attribute="${index}">${icon("trash-2")} Remover atributo</button>` : ""}</section>`).join("")}<button type="button" class="btn btn-light" data-add-attribute ${draft.attributes.length >= 2 ? "disabled" : ""}>${icon("plus")} Adicionar outro atributo</button>`
          : draft.step === 3
            ? `<p><b>${draft.variants.length}</b> combinações geradas.</p><div class="wizard-combinations">${draft.variants.map((variant, index) => `<label><input type="checkbox" name="variantActive:${index}" ${variant.active !== false ? "checked" : ""}><span>${esc(variant.displayName)}</span></label>`).join("") || "<p>Volte e informe pelo menos um valor.</p>"}</div>`
            : draft.step === 4
              ? `<div class="variant-bulk"><b>Aplicar a todas</b><input name="bulkPrice" inputmode="decimal" placeholder="Preço"><input name="bulkCost" inputmode="decimal" placeholder="Custo"><input name="bulkMinStock" inputmode="numeric" placeholder="Estoque mínimo"><button type="button" data-apply-bulk>Aplicar</button></div><div class="wizard-variants">${draft.variants
                  .filter((v) => v.active !== false)
                  .map(
                    (variant, index) =>
                      `<article><h4>${esc(variant.displayName)}</h4><div class="wizard-variant-fields"><label>Preço<input name="price:${index}" inputmode="decimal" value="${variant.price}"></label><label>Custo<input name="cost:${index}" inputmode="decimal" value="${variant.cost ?? ""}"></label><label>Estoque<input name="stock:${index}" inputmode="numeric" value="${variant.stock}"></label><label>Mínimo<input name="minStock:${index}" inputmode="numeric" value="${variant.minStock}"></label><label>SKU<input name="sku:${index}" value="${esc(variant.sku)}"></label><label>Código<input name="barcode:${index}" inputmode="numeric" value="${esc(variant.barcode)}"></label></div></article>`,
                  )
                  .join("")}</div>`
              : `<section class="variable-review"><h3>${esc(draft.product.nome)}</h3><p>${draft.variants.filter((v) => v.active !== false).length} variações</p><div><span>Estoque total<b>${draft.variants.filter((v) => v.active !== false).reduce((sum, v) => sum + Number(v.stock || 0), 0)} un.</b></span><span>Faixa de preço<b>${money(Math.min(...draft.variants.filter((v) => v.active !== false).map((v) => Number(v.price || 0))))} – ${money(Math.max(...draft.variants.filter((v) => v.active !== false).map((v) => Number(v.price || 0))))}</b></span></div>${draft.variants
                  .filter((v) => v.active !== false)
                  .map(
                    (v) =>
                      `<small>${esc(v.displayName)} · ${money(v.price)} · ${Number(v.stock)} un.</small>`,
                  )
                  .join("")}</section>`;
    const collect = () => {
      const form = $("form", root),
        fd = form ? new FormData(form) : new FormData();
      if (draft.step === 1)
        draft.product = {
          ...draft.product,
          nome: String(fd.get("nome") || "").trim(),
          categoria: String(fd.get("categoria") || "").trim(),
          observacao: String(fd.get("observacao") || "").trim(),
          favorito: fd.has("favorito"),
          semControleEstoque: !fd.has("controlaEstoque"),
          controlaEstoque: fd.has("controlaEstoque"),
        };
      if (draft.step === 2) {
        draft.attributes = draft.attributes
          .map((attribute, index) => ({
            ...attribute,
            name: String(fd.get(`attributeName:${index}`) || "").trim(),
            id: norm(
              fd.get(`attributeName:${index}`) || `atributo_${index + 1}`,
            ).replace(/[^a-z0-9]+/g, "_"),
            values: String(fd.get(`attributeValues:${index}`) || "")
              .split(",")
              .map((value) => value.trim())
              .filter(Boolean),
          }))
          .filter((attribute) => attribute.name && attribute.values.length);
        syncCombinations();
      }
      if (draft.step === 3)
        draft.variants.forEach(
          (variant, index) =>
            (variant.active = fd.has(`variantActive:${index}`)),
        );
      if (draft.step === 4)
        draft.variants
          .filter((v) => v.active !== false)
          .forEach((variant, index) => {
            variant.price = Number(
              String(fd.get(`price:${index}`) || 0).replace(",", "."),
            );
            variant.cost = Number(
              String(fd.get(`cost:${index}`) || 0).replace(",", "."),
            );
            variant.stock = Number(fd.get(`stock:${index}`) || 0);
            variant.minStock = Number(fd.get(`minStock:${index}`) || 0);
            variant.sku = String(fd.get(`sku:${index}`) || "").trim();
            variant.barcode = String(fd.get(`barcode:${index}`) || "").trim();
          });
    };
    const paint = () => {
      root.innerHTML = `<div class="modal-bg variable-wizard-bg"><section class="modal-box variable-wizard"><header class="modal-head"><div><small>Novo produto com variações</small><h3>Etapa ${draft.step} de 5</h3></div><button class="icon-btn close">${icon("x")}</button></header><div class="wizard-progress">${[1, 2, 3, 4, 5].map((step) => `<i class="${step <= draft.step ? "active" : ""}">${step}</i>`).join("")}</div><form><div class="modal-body">${stepBody()}</div><footer class="modal-foot">${draft.step > 1 ? '<button type="button" class="btn btn-light" data-wizard-back>Voltar</button>' : '<button type="button" class="btn btn-light close">Cancelar</button>'}<button class="btn btn-primary">${draft.step === 5 ? "Salvar produto" : "Continuar"}</button></footer></form></section></div>`;
      $$(".close", root).forEach((button) =>
        (button.onclick = () => {
          ProductImages.cleanupDraft(imageDraft);
          Modais.fechar();
        }),
      );
      $("[data-wizard-back]", root)?.addEventListener("click", () => {
        draft.step--;
        paint();
      });
      $("[data-add-attribute]", root)?.addEventListener("click", () => {
        collect();
        draft.attributes.push({
          id: `atributo_${draft.attributes.length + 1}`,
          name: "",
          values: [],
        });
        paint();
      });
      $$("[data-remove-attribute]", root).forEach(
        (button) =>
          (button.onclick = () => {
            draft.attributes.splice(Number(button.dataset.removeAttribute), 1);
            paint();
          }),
      );
      $("[data-apply-bulk]", root)?.addEventListener("click", () => {
        const fd = new FormData($("form", root)),
          price = fd.get("bulkPrice"),
          cost = fd.get("bulkCost"),
          min = fd.get("bulkMinStock");
        draft.variants
          .filter((v) => v.active !== false)
          .forEach((v) => {
            if (price !== "") v.price = Number(String(price).replace(",", "."));
            if (cost !== "") v.cost = Number(String(cost).replace(",", "."));
            if (min !== "") v.minStock = Number(min);
          });
        paint();
      });
      ProductImages.bindEditor(root, imageDraft);
      $("form", root).onsubmit = async (event) => {
        event.preventDefault();
        const submit = event.submitter,
          original = submit?.textContent;
        try {
          collect();
          if (draft.step === 1 && !draft.product.nome)
            throw Error("Informe o nome do produto.");
          if (draft.step === 2 && !draft.attributes.length)
            throw Error("Informe pelo menos um atributo e seus valores.");
          if (
            draft.step === 3 &&
            !draft.variants.some((v) => v.active !== false)
          )
            throw Error("Mantenha ao menos uma combinação ativa.");
          if (draft.step < 5) {
            draft.step++;
            paint();
            return;
          }
          if (submit) {
            submit.disabled = true;
            submit.textContent = "Salvando...";
          }
          const imageData = await ProductImages.commit(imageDraft, {
            productId: draft.product.id,
            oldSubject: {},
          });
          ProductVariations.createProduct({
            product: { ...draft.product, ...imageData },
            attributes: draft.attributes,
            variants: draft.variants.filter((v) => v.active !== false),
          });
          Modais.fechar();
          ProductImages.cleanupDraft(imageDraft);
          refresh(true);
          Utils.toast("Produto com variações criado.");
        } catch (error) {
          Utils.toast(error.message || "Não foi possível continuar", true);
          if (submit) {
            submit.disabled = false;
            submit.textContent = original;
          }
        }
      };
      window.lucide?.createIcons();
    };
    paint();
  }
  function editVariant(parentId, variantId = null) {
    const product = Produtos.obter(parentId),
      variant = variantId ? ProductVariations.get(variantId) : null,
      resolvedVariantId = variant?.id || Utils.uuid(),
      imageDraft = ProductImages.createDraft(variant, {
        allowInherit: true,
        inheritedSubject: product,
      });
    modal(
      variant ? "Editar variação" : "Nova variação",
      `<p><b>${esc(product.nome)}</b></p>${ProductImages.editorMarkup(imageDraft,{label:"Foto da variação",description:"Por padrão, a variação usa a foto principal do produto."})}<div class="field"><label>Nome da variação *</label><input name="displayName" value="${esc(variant?.displayName || "")}" required></div><div class="field"><label>Preço *</label><input name="price" inputmode="decimal" value="${variant?.price ?? ""}" required></div><div class="field"><label>Custo</label><input name="cost" inputmode="decimal" value="${variant?.cost ?? ""}"></div><div class="field"><label>Estoque</label><input name="stock" inputmode="numeric" value="${variant?.stock ?? 0}"></div><div class="field"><label>Estoque mínimo</label><input name="minStock" inputmode="numeric" value="${variant?.minStock ?? 0}"></div><div class="field"><label>SKU</label><input name="sku" value="${esc(variant?.sku || "")}"></div><div class="field"><label>Código de barras</label><input name="barcode" inputmode="numeric" value="${esc(variant?.barcode || "")}"></div><label class="check"><input name="catalogVisible" type="checkbox" ${variant?.catalogVisible !== false ? "checked" : ""}> Visível no catálogo</label>`,
      async (form) => {
        const imageData = await ProductImages.commit(imageDraft, {
          productId: parentId,
          variantId: resolvedVariantId,
          oldSubject: variant || {},
        });
        ProductVariations.save({
          id: resolvedVariantId,
          parentProductId: parentId,
          displayName: form.get("displayName"),
          attributeValues: variant?.attributeValues || {
            opcao: form.get("displayName"),
          },
          price: Number(String(form.get("price")).replace(",", ".")),
          cost: form.get("cost"),
          stock: form.get("stock"),
          minStock: form.get("minStock"),
          sku: form.get("sku"),
          barcode: form.get("barcode"),
          active: true,
          catalogVisible: form.has("catalogVisible"),
          ...imageData,
        });
        ProductImages.cleanupDraft(imageDraft);
      },
      variant ? "Salvar variação" : "Adicionar variação",
    );
    ProductImages.bindEditor($("#modal"), imageDraft, {
      label: "Foto da variação",
      description: "Por padrão, a variação usa a foto principal do produto.",
    });
    $$("#modal .close").forEach((button) =>
      button.addEventListener("click", () => ProductImages.cleanupDraft(imageDraft)),
    );
  }
  async function variableDetails(id) {
    const product = Produtos.obter(id),
      variants = await ProductVariations.ensure(id),
      moves = Produtos.historico(id),
      controlsStock = !product.semControleEstoque && product.controlaEstoque !== false;
    $("#modal").innerHTML =
      `<div class="modal-bg"><section class="modal-box modal-wide variable-detail-modal"><header class="modal-head"><div><small>Produto com variações</small><h3>${esc(product.nome)}</h3></div><button class="icon-btn close">${icon("x")}</button></header><div class="modal-body"><section class="variable-summary"><span><small>Variações ativas</small><b>${Number(product.activeVariationCount || 0)}</b></span><span><small>Estoque</small><b>${controlsStock ? `${Number(product.totalStock || 0)} un.` : "Sem controle"}</b></span><span><small>Faixa de preço</small><b>${priceLabel(product)}</b></span></section><div class="variable-detail-actions"><button class="btn btn-light" data-edit-parent>${icon("pencil")} Dados principais</button><button class="btn btn-primary" data-add-variant>${icon("plus")} Nova variação</button></div><div class="variable-detail-list">${variants.map((variant) => `<article class="${variant.active === false ? "inactive" : ""}">${ProductImages.markup(product, { variant, className: "variation-row-photo" })}<div><b>${esc(ProductVariations.displayName(variant))}</b><small>${esc(variant.sku) || "Sem SKU"} · ${esc(variant.barcode) || "Sem código"}</small></div><span><b>${money(variant.price)}</b><small>${controlsStock ? `${Number(variant.stock)} un.` : "Sem controle"}</small></span><button data-edit-variant="${variant.id}" aria-label="Editar variação">${icon("pencil")}</button>${controlsStock ? `<button data-stock-variant="${variant.id}" aria-label="Entrada de estoque">${icon("package-plus")}</button>` : ""}<button data-remove-variant="${variant.id}" aria-label="Excluir ou desativar">${icon("trash-2")}</button></article>`).join("") || '<p class="empty">Nenhuma variação cadastrada.</p>'}</div><p class="muted">${moves.length} movimentação(ões) de estoque no histórico.</p></div></section></div>`;
    $(".close", $("#modal")).onclick = Modais.fechar;
    $("[data-edit-parent]", $("#modal")).onclick = () =>
      ProductImages.openForm(id);
    $("[data-add-variant]", $("#modal")).onclick = () => editVariant(id);
    $$("[data-edit-variant]", $("#modal")).forEach(
      (button) =>
        (button.onclick = () => editVariant(id, button.dataset.editVariant)),
    );
    $$("[data-stock-variant]", $("#modal")).forEach(
      (button) =>
        (button.onclick = () =>
          variantStockEntry(id, button.dataset.stockVariant)),
    );
    $$("[data-remove-variant]", $("#modal")).forEach(
      (button) =>
        (button.onclick = async () => {
          try {
            const variantId = button.dataset.removeVariant,
              variant = ProductVariations.get(variantId),
              sold = DB.carregar().vendas.some((sale) =>
                (sale.itens || []).some((item) => item.variantId === variantId),
              );
            if (!sold && window.getProductDisplayImage(product, variant).own)
              await ProductImageStorage.remove(variant, {
                productId: id,
                variantId,
              });
            const result = ProductVariations.remove(variantId);
            Utils.toast(
              result.deactivated
                ? "Variação desativada porque possui histórico."
                : "Variação e foto excluídas.",
            );
            variableDetails(id);
          } catch (error) {
            Utils.toast(
              error.message || "Não foi possível excluir a variação",
              true,
            );
          }
        }),
    );
    window.lucide?.createIcons();
  }
  function productForm(id) {
    state.menuId = null;
    state.filtersOpen = false;
    const product = id ? Produtos.obter(id) : null;
    if (!id) return chooseProductType();
    if (product?.productType === "variable") return variableDetails(id);
    ProductImages.openForm(id);
  }
  function variantStockEntry(parentId, variantId) {
    const product = Produtos.obter(parentId),
      variant = ProductVariations.get(variantId);
    modal(
      "Adicionar entrada",
      `<p><b>${esc(product.nome)} — ${esc(ProductVariations.displayName(variant))}</b></p><p>Estoque atual: <b>${Number(variant.stock || 0)} un.</b></p><div class="field"><label>Quantidade adicionada *</label><input name="quantidade" type="number" inputmode="numeric" min="1" step="1" required></div><div class="field"><label>Custo unitário</label><input name="custo" inputmode="decimal" value="${variant.cost ?? ""}"></div><div class="field"><label>Observação</label><textarea name="observacao" placeholder="Ex.: compra de mercadoria"></textarea></div>`,
      (form) =>
        ProductVariations.stockChange({
          parentProductId: parentId,
          variantId,
          quantity: Number(form.get("quantidade")),
          costUnitario: form.get("custo"),
          observation: form.get("observacao"),
          type: "entrada",
        }),
      "Salvar entrada",
    );
  }
  function stockEntry(id) {
    const product = Produtos.obter(id);
    if (product?.productType === "variable") {
      const variants = ProductVariations.active(id);
      $("#modal").innerHTML =
        `<div class="modal-bg"><section class="modal-box"><header class="modal-head"><h3>Escolher variação</h3><button class="icon-btn close">${icon("x")}</button></header><div class="modal-body product-select-list">${variants.map((variant) => `<button data-entry-variant="${variant.id}"><span>${esc(initials(variant.displayName))}</span><b>${esc(variant.displayName)}</b><small>${Number(variant.stock)} un.</small></button>`).join("") || '<p class="empty">Nenhuma variação ativa.</p>'}</div></section></div>`;
      $(".close", $("#modal")).onclick = Modais.fechar;
      $$("[data-entry-variant]", $("#modal")).forEach(
        (button) =>
          (button.onclick = () =>
            variantStockEntry(id, button.dataset.entryVariant)),
      );
      window.lucide?.createIcons();
      return;
    }
    modal(
      "Adicionar entrada",
      `<p><b>${esc(product.nome)}</b></p><p>Estoque atual: <b>${Number(product.estoqueAtual || 0)} un.</b></p><div class="field"><label>Quantidade adicionada *</label><input name="quantidade" type="number" inputmode="decimal" min="1" step="1" required></div><div class="field"><label>Custo unitário</label><input name="custo" type="number" inputmode="decimal" min="0" step=".01" value="${product.custo ?? ""}"></div><div class="field"><label>Observação</label><textarea name="observacao" placeholder="Ex.: compra de mercadoria"></textarea></div>`,
      (form) =>
        Produtos.entrada(
          id,
          form.get("quantidade"),
          form.get("custo"),
          form.get("observacao"),
        ),
      "Salvar entrada",
    );
  }
  function stockAdjust(id) {
    const product = Produtos.obter(id);
    if (product?.productType === "variable") return variableDetails(id);
    modal(
      "Ajustar estoque",
      `<p><b>${esc(product.nome)}</b></p><p>Estoque atual: <b>${Number(product.estoqueAtual || 0)} un.</b></p><div class="field"><label>Novo estoque *</label><input name="estoque" type="number" inputmode="decimal" step="1" value="${Number(product.estoqueAtual || 0)}" required></div><div class="field"><label>Motivo *</label><textarea name="motivo" required placeholder="Ex.: conferência manual"></textarea></div>`,
      (form) =>
        Produtos.ajustarEstoque(id, form.get("estoque"), form.get("motivo")),
      "Salvar ajuste",
    );
  }
  function history(id) {
    const product = Produtos.obter(id),
      items = Produtos.historico(id);
    $("#modal").innerHTML =
      `<div class="modal-bg"><section class="modal-box modal-wide product-history-modal"><header class="modal-head"><h3>Histórico · ${esc(product.nome)}</h3><button class="icon-btn close">${icon("x")}</button></header><div class="modal-body">${items.map((item) => `<div class="product-history-row"><span>${new Date(item.data).toLocaleString("pt-BR")}</span><b>${esc(String(item.tipo).replaceAll("_", " "))}</b><em>${Number(item.estoqueAnterior || 0)} → ${Number(item.estoqueNovo || 0)}</em><small>${esc(item.observacao || "")}</small></div>`).join("") || '<p class="empty">Nenhuma movimentação registrada.</p>'}</div><footer class="modal-foot"><button class="btn btn-primary close">Fechar</button></footer></section></div>`;
    $$("#modal .close").forEach((button) => (button.onclick = Modais.fechar));
    window.lucide?.createIcons();
  }
  function details(id) {
    const product = Produtos.obter(id);
    if (window.ProductVariations?.isVariable(product))
      return variableDetails(id);
    const
      moves = Produtos.historico(id),
      entry = moves.find((m) => m.tipo === "entrada"),
      exit = moves.find((m) => m.tipo === "saida_venda");
    $("#modal").innerHTML =
      `<div class="modal-bg"><section class="modal-box product-detail-modal"><header class="modal-head"><div><small>Detalhes do produto</small><h3>${esc(product.nome)}</h3></div><button class="icon-btn close">${icon("x")}</button></header><div class="modal-body"><section><h4>Informações</h4><div class="product-detail-grid"><span><small>Categoria</small><b>${esc(product.categoria) || "Sem categoria"}</b></span><span><small>Código</small><b>${esc(product.codigo) || "—"}</b></span><span><small>Status</small><b>${statusInfo(product).label}</b></span><span><small>Favorito</small><b>${product.favorito ? "Sim" : "Não"}</b></span></div></section><section><h4>Estoque</h4><div class="product-detail-grid"><span><small>Estoque atual</small><b>${Number(product.estoqueAtual || 0)} un.</b></span><span><small>Estoque mínimo</small><b>${Number(product.estoqueMinimo || 0)} un.</b></span><span><small>Última entrada</small><b>${entry ? new Date(entry.data).toLocaleDateString("pt-BR") : "—"}</b></span><span><small>Última saída</small><b>${exit ? new Date(exit.data).toLocaleDateString("pt-BR") : "—"}</b></span></div></section><section><h4>Financeiro</h4><div class="product-detail-grid"><span><small>Preço</small><b>${money(product.preco)}</b></span><span><small>Custo</small><b>${product.custo === null ? "—" : money(product.custo)}</b></span></div></section><section><h4>Histórico</h4><p>${moves.length} movimentação(ões) registrada(s).</p></section></div><footer class="modal-foot"><button class="btn btn-light" data-detail-history="${product.id}">${icon("history")} Histórico</button><button class="btn btn-primary" data-detail-edit="${product.id}">${icon("pencil")} Editar</button></footer></section></div>`;
    $("#modal .close").onclick = Modais.fechar;
    $("[data-detail-history]").onclick = () => history(id);
    $("[data-detail-edit]").onclick = () => productForm(id);
    window.lucide?.createIcons();
  }
  function selectEntry() {
    const list = (products().produtos || []).filter((p) => p.ativo !== false);
    $("#modal").innerHTML =
      `<div class="modal-bg"><section class="modal-box product-select-modal"><header class="modal-head"><h3>Selecionar produto</h3><button class="icon-btn close">${icon("x")}</button></header><div class="modal-body"><label class="product-modal-search">${icon("search")}<input placeholder="Buscar produto…"></label><div class="product-select-list">${list.map((p) => `<button data-select-entry="${p.id}"><span>${esc(initials(p.nome))}</span><b>${esc(p.nome)}</b><small>${Number(p.estoqueAtual || 0)} un.</small></button>`).join("")}</div></div></section></div>`;
    $("#modal .close").onclick = Modais.fechar;
    $("#modal input").oninput = (event) =>
      $$("[data-select-entry]").forEach(
        (button) =>
          (button.hidden = !norm(button.textContent).includes(
            norm(event.target.value),
          )),
      );
    $$("[data-select-entry]").forEach(
      (button) =>
        (button.onclick = () => stockEntry(button.dataset.selectEntry)),
    );
    window.lucide?.createIcons();
  }
  function inventory() {
    const list = (products().produtos || []).filter(
      (p) =>
        p.ativo !== false &&
        !p.semControleEstoque &&
        !window.ProductVariations?.isVariable(p),
    );
    modal(
      "Inventário de estoque",
      `<p>Confira as quantidades e altere somente o que precisar.</p><div class="product-inventory-list">${list.map((p) => `<label><span><b>${esc(p.nome)}</b><small>Atual: ${Number(p.estoqueAtual || 0)} un.</small></span><input name="stock:${p.id}" type="number" inputmode="decimal" step="1" value="${Number(p.estoqueAtual || 0)}"></label>`).join("") || "<p>Nenhum produto com controle de estoque.</p>"}</div>`,
      (form) => {
        list.forEach((p) => {
          const value = Number(form.get(`stock:${p.id}`));
          if (value !== Number(p.estoqueAtual || 0))
            Produtos.ajustarEstoque(p.id, value, "Inventário manual");
        });
      },
      "Salvar inventário",
    );
  }
  function toggleFavorite(id, button) {
    const product = Produtos.obter(id),
      next = !Boolean(product.favorito),
      scroll = scrollY;
    Produtos.favoritar(id, next);
    dataCache = null;
    if (state.filter === "favoritos" || state.sort === "favoritos") {
      refresh();
      scrollTo({ top: scroll });
      return;
    }
    button.classList.toggle("active", next);
    button.setAttribute("aria-pressed", String(next));
    button.setAttribute(
      "aria-label",
      next ? "Remover dos favoritos" : "Adicionar aos favoritos",
    );
    button
      .closest("[data-product-shell]")
      ?.querySelector(".favorite-dot")
      ?.classList.toggle("show", next);
    window.MobileMotion?.pop(button);
    const count = $('[data-product-filter="favoritos"] b');
    if (count) count.textContent = counts().favorites;
    window.lucide?.createIcons();
  }
  function closeSheet() {
    state.menuId = null;
    state.filtersOpen = false;
    refresh();
  }
  function performSwipe(action, id) {
    action === "entry" ? stockEntry(id) : productForm(id);
  }
  function bindSwipe(shell) {
    if (state.view !== "list") return;
    const card = $(".mobile-product-card", shell);
    let startX = 0,
      startY = 0,
      delta = 0,
      dragging = false,
      pointer = null,
      horizontal = false;
    const reset = () => {
      card.style.transition = "transform .24s ease";
      card.style.transform = "translateX(0)";
      shell.classList.remove("swipe-right", "swipe-left", "ready");
      setTimeout(() => (card.style.transition = ""), 250);
    };
    card.addEventListener("pointerdown", (event) => {
      if (event.target.closest("button,input,a,select")) return;
      startX = event.clientX;
      startY = event.clientY;
      pointer = event.pointerId;
      delta = 0;
      horizontal = false;
      dragging = true;
      card.setPointerCapture?.(pointer);
    });
    card.addEventListener("pointermove", (event) => {
      if (!dragging || event.pointerId !== pointer) return;
      const dx = event.clientX - startX,
        dy = event.clientY - startY;
      if (!horizontal && Math.abs(dy) > Math.abs(dx) && Math.abs(dy) > 8) {
        dragging = false;
        return;
      }
      if (Math.abs(dx) > 8) horizontal = true;
      if (!horizontal) return;
      if (dx > 0 && shell.dataset.controlsStock !== "true") return;
      delta = Math.max(
        -card.offsetWidth * 0.62,
        Math.min(card.offsetWidth * 0.62, dx),
      );
      card.style.transform = `translateX(${delta}px)`;
      shell.classList.toggle("swipe-right", delta > 0);
      shell.classList.toggle("swipe-left", delta < 0);
      shell.classList.toggle(
        "ready",
        Math.abs(delta) >= card.offsetWidth * 0.4,
      );
    });
    const end = (event) => {
      if (!dragging || event.pointerId !== pointer) return;
      dragging = false;
      if (horizontal && Math.abs(delta) >= card.offsetWidth * 0.4) {
        const action = delta > 0 ? "entry" : "edit";
        if (action === "entry" && shell.dataset.controlsStock !== "true")
          return reset();
        card.style.transition = "transform .2s ease";
        card.style.transform = `translateX(${delta > 0 ? card.offsetWidth : -card.offsetWidth}px)`;
        navigator.vibrate?.(30);
        setTimeout(() => {
          performSwipe(action, shell.dataset.productShell);
          reset();
        }, 180);
      } else reset();
    };
    card.addEventListener("pointerup", end);
    card.addEventListener("pointercancel", end);
  }
  function bind() {
    const search = $("#mobile-product-search"),
      sort = $("#mobile-product-sort");
    if (!search) return;
    updateFab();
    const filterScroll = $(".product-filter-scroll"),
      filterCounts = counts();
    if (filterScroll && !filterScroll.querySelector('[data-product-filter="simples"]'))
      filterScroll.insertAdjacentHTML(
        "beforeend",
        `${chip("simples", "Simples", filterCounts.simple, "box")}${chip("variacoes", "Com variações", filterCounts.variable, "boxes")}`,
      );
    sort.value = state.sort;
    let timer;
    search.oninput = (event) => {
      clearTimeout(timer);
      state.query = event.target.value;
      timer = setTimeout(() => refresh(true, "search"), 140);
    };
    sort.onchange = (event) => {
      state.sort = event.target.value;
      saveState();
      refresh(true, "filter");
    };
    $$("[data-product-filter]").forEach(
      (button) =>
        (button.onclick = () => {
          state.filter = button.dataset.productFilter;
          if (state.filter === "favoritos" && state.sort === "favoritos")
            state.sort = "nomeAsc";
          refresh(true, "filter");
        }),
    );
    $$("[data-product-view]").forEach(
      (button) =>
        (button.onclick = () => {
          state.view = button.dataset.productView;
          saveState();
          refresh(false, "layout");
        }),
    );
    $("#mobile-product-open-filters").onclick = () => {
      state.filtersOpen = true;
      refresh();
    };
    $$("[data-product-category]").forEach(
      (button) =>
        (button.onclick = () => {
          state.category = button.dataset.productCategory;
          state.filtersOpen = false;
          refresh(true, "filter");
        }),
    );
    $$("[data-product-sheet-close]").forEach(
      (button) => (button.onclick = closeSheet),
    );
    $$("[data-product-new]").forEach(
      (button) => (button.onclick = () => productForm()),
    );
    $("[data-product-entry-select]").onclick = selectEntry;
    $("[data-product-inventory]").onclick = inventory;
    $$("[data-clear-product-filters]").forEach(
      (button) =>
        (button.onclick = () => {
          state.query = "";
          state.filter = "todos";
          state.category = "todos";
          refresh(true);
        }),
    );
    $("#mobile-products").onclick = (event) => {
      const favorite = event.target.closest("[data-product-favorite]"),
        menu = event.target.closest("[data-product-menu]"),
        card = event.target.closest("[data-product-card]");
      if (favorite) {
        event.stopPropagation();
        return toggleFavorite(favorite.dataset.productFavorite, favorite);
      }
      if (menu) {
        event.stopPropagation();
        state.menuId = menu.dataset.productMenu;
        return refresh();
      }
      if (card) details(card.dataset.productCard);
    };
    $("#mobile-products").addEventListener("pointerdown", (event) => {
      const card = event.target.closest("[data-product-card]");
      if (card && !event.target.closest("button")) window.MobileMotion?.press(card);
    });
    $("#mobile-products").onkeydown = (event) => {
      if (
        (event.key === "Enter" || event.key === " ") &&
        event.target.matches("[data-product-card]")
      ) {
        event.preventDefault();
        details(event.target.dataset.productCard);
      }
    };
    $$("[data-product-entry]").forEach(
      (button) =>
        (button.onclick = () => stockEntry(button.dataset.productEntry)),
    );
    $$("[data-product-adjust]").forEach(
      (button) =>
        (button.onclick = () => stockAdjust(button.dataset.productAdjust)),
    );
    $$("[data-product-history]").forEach(
      (button) =>
        (button.onclick = () => history(button.dataset.productHistory)),
    );
    $$("[data-product-edit]").forEach(
      (button) =>
        (button.onclick = () => productForm(button.dataset.productEdit)),
    );
    $$("[data-product-delete]").forEach(
      (button) =>
        (button.onclick = () =>
          Modais.confirmar("produto", () => {
            ProductImages.deleteProduct(button.dataset.productDelete)
              .then(() => {
                state.menuId = null;
                refresh();
                Utils.toast("Produto e imagens excluídos.");
              })
              .catch((error) =>
                Utils.toast(
                  error.message || "Não foi possível excluir o produto",
                  true,
                ),
              );
          })),
    );
    $$("[data-product-shell]").forEach(bindSwipe);
    observer?.disconnect();
    const sentinel = $("#mobile-product-sentinel");
    if (sentinel) {
      observer = new IntersectionObserver(
        (entries) => {
          if (entries[0].isIntersecting) {
            state.limit += 50;
            refresh();
          }
        },
        { rootMargin: "220px" },
      );
      observer.observe(sentinel);
    }
    window.lucide?.createIcons();
  }
  function updateFab() {
    window.BarcodePrimaryFab?.update?.();
  }
  const bindProducts = bind,
    openModal = modal,
    openHistory = history;
  bind = function () {
    bindProducts();
    const favorites = $('[data-product-filter="favoritos"]');
    if (favorites)
      favorites.onclick = () => {
        state.filter = "favoritos";
        state.sort = "nomeAsc";
        saveState();
        refresh(true);
      };
  };
  modal = function (...args) {
    state.menuId = null;
    state.filtersOpen = false;
    $(".product-action-sheet")?.remove();
    $(".product-filter-sheet")?.remove();
    $(".product-sheet-overlay")?.remove();
    return openModal(...args);
  };
  history = function (id) {
    state.menuId = null;
    state.filtersOpen = false;
    $(".product-action-sheet")?.remove();
    $(".product-sheet-overlay")?.remove();
    return openHistory(id);
  };
  $("#mobile-client-fab")?.addEventListener("click", (event) => {
    if (
      Router.atual() === "produtos" &&
      event.currentTarget.dataset.primaryAction === "scan-product"
    )
      window.BarcodeWorkflows?.productLookup?.();
  });
  addEventListener("hashchange", updateFab);
  new MutationObserver(() => {
    const page = $("#app .products-mobile-page");
    if (page && !page.dataset.productsBound) {
      page.dataset.productsBound = "true";
      queueMicrotask(bind);
    }
  }).observe($("#app"), { childList: true });
  function applyFilter(filter = "todos", sort = "nomeAsc") {
    state.filter = filter;
    state.sort = sort;
    state.query = "";
    state.limit = 50;
    state.menuId = null;
    state.filtersOpen = false;
    dataCache = null;
    saveState();
  }
  function search(query) {
    state.query = query;
    state.limit = 50;
    dataCache = null;
    observer?.disconnect();
    $("#mobile-product-sentinel")?.remove();
    const list = filtered(),
      shown = list.slice(0, state.limit),
      root = $("#mobile-products");
    if (!root) return;
    root.innerHTML = shown.map(card).join("") + empty(list);
    $$("[data-product-shell]", root).forEach(bindSwipe);
    window.lucide?.createIcons();
  }
  window.ProdutosMobile = {
    isMobile: () => mq.matches,
    render,
    bind,
    refresh,
    applyFilter,
    search,
    productForm,
    stockEntry,
    stockAdjust,
    history,
    details,
    getProductStockStatus: status,
    stockPercent,
  };
})();
