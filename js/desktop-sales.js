(() => {
  "use strict";

  const desktopMedia = matchMedia("(min-width:768px)"),
    icon = (name) => `<i data-lucide="${name}"></i>`,
    esc = (value) => Utils.escapar(value ?? ""),
    money = (value) => Utils.dinheiro(Number(value || 0)),
    number = (value) => Number(value || 0),
    normalize = (value) =>
      String(value || "")
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .toLowerCase()
        .replace(/\s+/g, " ")
        .trim(),
    itemKey = (item) =>
      item?.productType === "recurring"
        ? `${item.produtoId}::${item.variantId || "base"}::${item.recurringActivation?.subscriptionId || item.recurringActivation?.draftId || "new"}`
        : window.ProductVariations?.itemKey?.(item) ||
          String(item?.produtoId || ""),
    controlsStock = (product) =>
      window.productControlsStock?.(product) ??
      (!product?.semControleEstoque && product?.controlaEstoque !== false),
    stockValue = (product) =>
      number(
        window.ProductVariations?.isVariable?.(product)
          ? product.totalStock
          : product.estoqueAtual,
      ),
    productImage = (product, className, variant = null) =>
      window.ProductImages?.markup?.(product, { className, variant }) ||
      `<span class="${className} desktop-product-fallback">${esc(
        String(product?.nome || "P").slice(0, 2).toUpperCase(),
      )}</span>`;

  let shortcutHandler = null,
    filteredListener = null;

  function priceLabel(product) {
    if (window.ProductVariations?.isVariable?.(product)) {
      const minimum = number(product.minPrice),
        maximum = number(product.maxPrice);
      return minimum === maximum
        ? money(minimum)
        : `${money(minimum)} – ${money(maximum)}`;
    }
    return money(product.preco);
  }

  function productMeta(product) {
    const recurring = product.productType === "recurring",
      variable = window.ProductVariations?.isVariable?.(product),
      stock = stockValue(product),
      status = window.getProductStockStatus?.(product) || "disponivel";
    if (recurring && !controlsStock(product))
      return {
        className: "renewal",
        icon: "calendar-clock",
        text:
          window.getProductRenewalPeriod?.(product) ||
          `${number(product.durationValue || 30)} dias`,
        disabled: false,
      };
    if (variable)
      return {
        className: status === "esgotado" ? "out" : "variable",
        icon: status === "esgotado" ? "circle-x" : "layers-3",
        text: `${number(product.activeVariationCount || 0)} opções · ${stock} un.`,
        disabled: status === "esgotado" && !product.allowNegativeStock,
      };
    if (status === "esgotado")
      return {
        className: "out",
        icon: "circle-x",
        text: "Esgotado",
        disabled: !product.allowNegativeStock,
      };
    if (status === "baixo")
      return {
        className: "low",
        icon: "triangle-alert",
        text: `Estoque baixo · ${stock} un.`,
        disabled: false,
      };
    return {
      className: "available",
      icon: "package-check",
      text: `Estoque: ${stock} un.`,
      disabled: false,
    };
  }

  function productCard(product) {
    const meta = productMeta(product),
      brand = product.marca || product.brand || "",
      variants = window.ProductVariations?.list?.(product.id) || [],
      search = normalize(
        [
          product.nome,
          product.codigo,
          product.barcode,
          product.categoria,
          brand,
          product.palavrasChave,
          ...variants.flatMap((variant) => [
            variant.displayName,
            variant.sku,
            variant.barcode,
            ...Object.values(variant.attributeValues || {}),
          ]),
        ].join(" "),
      );
    return `<article class="desktop-sale-product pos-product stock-${esc(meta.className)}" data-add="${esc(product.id)}" data-search="${esc(search)}" data-category="${esc(normalize(product.categoria))}" data-brand="${esc(normalize(brand))}" data-price="${number(product.preco || product.minPrice)}" data-stock="${stockValue(product)}" title="${esc(product.nome)}">
      <button class="desktop-sale-product-main" type="button" data-add="${esc(product.id)}" aria-label="Adicionar ${esc(product.nome)}">
        ${productImage(product, "desktop-sale-product-image")}
        <span class="desktop-sale-product-copy">
          <strong>${esc(product.nome)}</strong>
          <small>${esc(product.categoria || "Sem categoria")}${brand ? ` · ${esc(brand)}` : ""}</small>
          <b>${window.ProductVariations?.isVariable?.(product) ? "A partir de " : ""}${priceLabel(product)}</b>
          <em class="${esc(meta.className)}">${icon(meta.icon)} ${esc(meta.text)}</em>
        </span>
      </button>
      <button class="desktop-sale-favorite-toggle ${product.favorito ? "active" : ""}" type="button" data-fav="${esc(product.id)}" aria-label="${product.favorito ? "Remover dos" : "Adicionar aos"} favoritos" aria-pressed="${product.favorito ? "true" : "false"}">${icon("star")}</button>
      <button class="desktop-sale-add" type="button" data-add="${esc(product.id)}" aria-label="Adicionar ${esc(product.nome)}" ${meta.disabled ? "disabled" : ""}>${icon(meta.disabled ? "ban" : "plus")}</button>
      <span class="desktop-sale-product-qty" data-pos-qty="${esc(product.id)}" hidden>0</span>
    </article>`;
  }

  function recentCard(product) {
    return `<button type="button" class="desktop-recent-product" data-add="${esc(product.id)}" aria-label="Adicionar ${esc(product.nome)}">
      ${productImage(product, "desktop-recent-product-image")}
      <span><strong>${esc(product.nome)}</strong><small>${esc(product.categoria || "Sem categoria")}</small><b>${priceLabel(product)}</b></span>
    </button>`;
  }

  function productsHTML(products) {
    return products.length
      ? products.map(productCard).join("")
      : `<div class="desktop-sale-empty">${icon("package-open")}<b>Nenhum produto cadastrado</b><small>Cadastre um produto para começar a vender.</small></div>`;
  }

  function cartHTML(cart) {
    if (!cart.length)
      return `<div class="desktop-sale-empty desktop-cart-empty">${icon("shopping-bag")}<span><b>Seu carrinho está vazio</b><small>Selecione produtos à esquerda.</small></span></div>`;
    return cart
      .map((item) => {
        const key = itemKey(item),
          product = window.Produtos?.obter?.(item.produtoId) || item,
          variant = item.variantId
            ? window.ProductVariations?.get?.(item.variantId)
            : null,
          total = number(item.quantidade) * number(item.precoFinalUnitario),
          variation =
            item.variationName ||
            item.variacaoNome ||
            (variant && window.ProductVariations?.displayName?.(variant)) ||
            (item.productType === "recurring"
              ? item.recurringActivation?.label || "Venda com renovação"
              : item.categoria || "");
        return `<article class="desktop-cart-item editable-cart">
          <div class="desktop-cart-product">${productImage(product, "desktop-cart-product-image", variant)}<div><b>${esc(item.nome)}</b><small>${esc(variation)}</small></div></div>
          <div class="desktop-cart-quantity" aria-label="Quantidade de ${esc(item.nome)}"><button type="button" data-cart-step="-1" data-cart-key="${esc(key)}" aria-label="Diminuir quantidade">−</button><input data-item-qty="${esc(key)}" type="number" min="1" step="1" value="${number(item.quantidade)}" aria-label="Quantidade"><button type="button" data-cart-step="1" data-cart-key="${esc(key)}" aria-label="Aumentar quantidade">+</button></div>
          <label class="desktop-cart-unit"><span>Valor unitário</span><input data-item-price="${esc(key)}" type="number" inputmode="decimal" min="0" step=".01" value="${number(item.precoFinalUnitario).toFixed(2)}" aria-label="Valor unitário de ${esc(item.nome)}"></label>
          <b class="desktop-cart-total">${money(total)}</b>
          <button type="button" class="desktop-cart-remove" data-remove="${esc(key)}" aria-label="Remover ${esc(item.nome)}">${icon("x")}</button>
        </article>`;
      })
      .join("");
  }

  function options(values, label, normalizeValues = false) {
    return `<option value="">${label}</option>${[
      ...new Set(values.filter(Boolean)),
    ]
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map(
        (value) =>
          `<option value="${esc(normalizeValues ? normalize(value) : value)}">${esc(value)}</option>`,
      )
      .join("")}`;
  }

  function render({ products, clients, cart = [], totals = {}, recentProducts = [] }) {
    const categories = products.map((product) => product.categoria || ""),
      brands = products.map(
        (product) => product.marca || product.brand || "",
      ),
      total = number(totals.final ?? totals.valorFinal),
      itemCount = cart.reduce(
        (sum, item) => sum + number(item.quantidade),
        0,
      );
    return `<section class="desktop-sales" data-desktop-sales>
      <header class="desktop-sales-title"><h2>Nova venda</h2><p>Adicione produtos ao carrinho para iniciar uma venda.</p></header>
      <div class="desktop-sales-toolbar">
        <label class="desktop-sales-search">${icon("search")}<input id="product-search" placeholder="Buscar produto, código de barras ou categoria..." autocomplete="off"><button type="button" id="clear-product-search" aria-label="Limpar busca">${icon("x")}</button></label>
        <button class="desktop-barcode-button" type="button" data-scan-sale aria-label="Ler código de barras" title="Ler código de barras">${icon("scan-barcode")}</button>
        <label class="desktop-sales-select"><span>Categoria</span><select id="pos-category">${options(categories, "Todas", true)}</select></label>
        <label class="desktop-sales-select"><span>Marca</span><select id="desktop-sale-brand">${options(brands, "Todas", true)}</select></label>
        <label class="desktop-sales-select"><span>Ordenar por</span><select id="pos-sort"><option value="vendidos">Mais vendidos</option><option value="nome">Nome A–Z</option><option value="preco">Menor preço</option><option value="categoria">Categoria</option></select></label>
        <input id="pos-filter" value="todos" hidden>
        <button class="desktop-sales-favorite" type="button" id="desktop-sale-favorites" aria-pressed="false">${icon("star")} Favoritos</button>
      </div>
      <div class="desktop-sales-layout">
        <section class="desktop-sales-products" id="pos-grid">
          ${recentProducts.length ? `<section class="desktop-recent-products"><header><h3>Últimos vendidos</h3></header><div>${recentProducts.slice(0, 5).map(recentCard).join("")}</div></section>` : ""}
          <section class="desktop-sales-catalog">
            <header><h3>Produtos <span id="desktop-sale-count">${products.length} itens</span></h3><span>${icon("layout-grid")} Grade</span></header>
            <div class="desktop-sales-product-grid" id="desktop-sale-products">${productsHTML(products)}</div>
          </section>
        </section>
        <aside class="desktop-sales-cart sale-summary" id="pos-summary">
          <header><h3>Venda atual <span id="desktop-cart-count">${itemCount} ${itemCount === 1 ? "item" : "itens"}</span></h3><button type="button" id="desktop-clear-cart">${icon("trash-2")} Limpar carrinho</button></header>
          <section class="desktop-client-area">
            <div class="pos-client-card" id="selected-client-card"></div>
            <select id="sale-client" class="visually-hidden"><option value="">Venda avulsa</option>${clients.map((client) => `<option value="${esc(client.id)}">${esc(client.nome)}</option>`).join("")}</select>
            <button type="button" class="desktop-client-select pos-client-select" id="open-client-picker">${icon("user-round-plus")}<span>Selecionar cliente ou venda avulsa</span>${icon("chevron-right")}</button>
          </section>
          <div id="cart" class="desktop-cart-list">${cartHTML(cart)}</div>
          <section class="desktop-discount">
            <button type="button" class="desktop-discount-trigger" id="desktop-discount-trigger" aria-expanded="false">${icon("tag")}<span>Adicionar desconto</span><b id="desktop-discount-preview">${money(totals.discount ?? totals.descontoTotal)}</b>${icon("chevron-down")}</button>
            <div class="desktop-discount-fields" id="desktop-discount-fields" hidden><label><span>Desconto em R$</span><input id="discount-value" type="number" inputmode="decimal" min="0" step=".01" value="0"></label><label><span>Desconto em %</span><input id="discount-percent" type="number" inputmode="decimal" min="0" max="100" step=".01" value="0"></label></div>
          </section>
          <input id="manual-total" type="number" inputmode="decimal" min="0" step=".01" value="${total.toFixed(2)}" hidden>
          <div id="sale-totals" class="desktop-sale-totals"></div>
          <button type="button" class="desktop-continue-sale" id="desktop-continue-sale"><span>Continuar venda <b id="desktop-cta-total">• ${money(total)}</b></span>${icon("chevron-right")}</button>
          <section class="desktop-checkout-fields" id="desktop-checkout-fields" hidden>
            <button class="desktop-back-to-cart" id="desktop-back-to-cart" type="button">${icon("arrow-left")} Voltar ao carrinho</button>
            <div class="field"><label>Forma de pagamento</label><select id="sale-status"><option value="pago">Pago agora</option><option value="fiado">Fiado</option></select></div>
            <div id="debt-preview"></div>
            <div class="field"><label>Observação</label><textarea id="sale-note" placeholder="Observação opcional"></textarea></div>
            <button class="btn btn-primary" id="finish-sale" type="button">${icon("check")} Concluir venda <span id="desktop-finish-total">• ${money(total)}</span></button>
          </section>
          <button type="button" id="open-sale-summary" hidden></button><button type="button" id="close-sale-summary" hidden></button><span id="pos-bag-label" hidden></span><span id="pos-bag-total" hidden></span>
        </aside>
      </div>
    </section>`;
  }

  function updateCount(event) {
    const count = document.querySelector("#desktop-sale-count"),
      visible = number(event.detail?.visible);
    if (count) count.textContent = `${visible} ${visible === 1 ? "item" : "itens"}`;
  }

  function keyboardShortcut(event) {
    if (!desktopMedia.matches || !document.querySelector("[data-desktop-sales]"))
      return;
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName);
    if (event.key === "Escape") {
      document.querySelector("#modal .close")?.click();
      return;
    }
    if (typing) return;
    if (event.key === "/") {
      event.preventDefault();
      document.querySelector("#product-search")?.focus();
    } else if (event.key === "F2") {
      event.preventDefault();
      document.querySelector("#open-client-picker")?.click();
    } else if (event.key === "F4") {
      event.preventDefault();
      document.querySelector("#desktop-discount-trigger")?.click();
    } else if (event.key === "F8") {
      event.preventDefault();
      const fields = document.querySelector("#desktop-checkout-fields");
      (fields?.hidden
        ? document.querySelector("#desktop-continue-sale")
        : document.querySelector("#finish-sale"))?.click();
    }
  }

  function bind() {
    const root = document.querySelector("[data-desktop-sales]");
    if (!root) return;
    const favorite = root.querySelector("#desktop-sale-favorites"),
      filter = root.querySelector("#pos-filter"),
      brand = root.querySelector("#desktop-sale-brand"),
      discountTrigger = root.querySelector("#desktop-discount-trigger"),
      discountFields = root.querySelector("#desktop-discount-fields"),
      checkoutFields = root.querySelector("#desktop-checkout-fields");
    favorite?.addEventListener("click", () => {
      const active = favorite.getAttribute("aria-pressed") !== "true";
      favorite.setAttribute("aria-pressed", String(active));
      filter.value = active ? "favoritos" : "todos";
      filter.dispatchEvent(new Event("change", { bubbles: true }));
    });
    brand?.addEventListener("change", () => window.Checkout?.filterProducts?.());
    discountTrigger?.addEventListener("click", () => {
      const open = discountTrigger.getAttribute("aria-expanded") === "true";
      discountTrigger.setAttribute("aria-expanded", String(!open));
      discountFields.hidden = open;
      if (!open) discountFields.querySelector("input")?.focus();
    });
    root.querySelector("#desktop-continue-sale")?.addEventListener("click", () => {
      if (!window.Checkout?.cartCount?.()) {
        Utils.toast("Adicione ao menos um produto", true);
        return;
      }
      checkoutFields.hidden = false;
      root.querySelector("#desktop-continue-sale").hidden = true;
      checkoutFields.scrollIntoView({ behavior: "smooth", block: "nearest" });
      checkoutFields.querySelector("#sale-status")?.focus({ preventScroll: true });
    });
    root.querySelector("#desktop-back-to-cart")?.addEventListener("click", () => {
      checkoutFields.hidden = true;
      root.querySelector("#desktop-continue-sale").hidden = false;
    });
    filteredListener && removeEventListener("sale-products-filtered", filteredListener);
    filteredListener = updateCount;
    addEventListener("sale-products-filtered", filteredListener);
    shortcutHandler && removeEventListener("keydown", shortcutHandler);
    shortcutHandler = keyboardShortcut;
    addEventListener("keydown", shortcutHandler);
  }

  function refreshProducts() {
    if (!document.querySelector("[data-desktop-sales]")) return false;
    window.AppPageRuntime?.mount?.("vender");
    return true;
  }

  function refreshClients() {
    if (!document.querySelector("[data-desktop-sales]")) return false;
    const select = document.querySelector("#sale-client"),
      selected = select?.value || "";
    if (!select) return false;
    select.innerHTML = `<option value="">Venda avulsa</option>${Clientes.listar()
      .filter((client) => client.ativo !== false)
      .map(
        (client) =>
          `<option value="${esc(client.id)}">${esc(client.nome)}</option>`,
      )
      .join("")}`;
    if ([...select.options].some((option) => option.value === selected))
      select.value = selected;
    return true;
  }

  window.DesktopSales = {
    isDesktop: () => desktopMedia.matches,
    render,
    bind,
    cartHTML,
    refreshProducts,
    refreshClients,
  };
})();
