(() => {
  "use strict";

  const mq = matchMedia("(min-width:768px)"),
    icon = (name) => `<i data-lucide="${name}"></i>`,
    esc = (value) => Utils.escapar(value ?? ""),
    money = (value) => Utils.dinheiro(Number(value || 0)),
    number = (value) => Number(value || 0),
    key = (item) =>
      window.ProductVariations?.itemKey?.(item) ||
      String(item?.produtoId || ""),
    image = (product) =>
      product.imageThumbUrl || product.imageUrl || product.imagem || "";

  const activeProducts = () =>
    Produtos.listar().filter((product) => product.ativo !== false);

  function productCard(product) {
    const stock = number(
        product.productType === "variable"
          ? product.totalStock
          : product.estoqueAtual,
      ),
      picture = image(product),
      brand = product.marca || product.brand || "",
      price =
        product.productType === "variable" &&
        number(product.minPrice) !== number(product.maxPrice)
          ? `${money(product.minPrice)} – ${money(product.maxPrice)}`
          : money(
              product.productType === "variable"
                ? product.minPrice
                : product.preco,
            );
    return `<button class="desktop-sale-product pick-product" type="button" data-add="${esc(product.id)}" data-search="${esc(`${product.nome} ${product.categoria || ""} ${brand} ${product.codigo || ""} ${product.barcode || ""}`.toLowerCase())}" data-category="${esc(product.categoria || "")}" data-brand="${esc(brand)}" data-favorite="${product.favorito ? "true" : "false"}" data-price="${number(product.preco || product.minPrice)}">
      <span class="desktop-sale-product-image">${
        picture
          ? `<img src="${esc(picture)}" alt="">`
          : `<b>${esc(
              String(product.nome || "P")
                .slice(0, 2)
                .toUpperCase(),
            )}</b>`
      }</span>
      <span class="desktop-sale-product-copy"><strong>${esc(product.nome)}</strong><small>${esc(product.categoria || "Sem categoria")}${brand ? ` · ${esc(brand)}` : ""}</small><b>${price}</b><em>Estoque: ${stock} un.</em></span>
      <span class="desktop-sale-add" aria-hidden="true">${icon("plus")}</span>
    </button>`;
  }

  function renderProducts(products = activeProducts()) {
    return products.length
      ? products.map(productCard).join("")
      : `<div class="desktop-sale-empty">${icon("package-open")}<b>Nenhum produto cadastrado</b></div>`;
  }

  function cartHTML(cart) {
    if (!cart.length)
      return `<div class="desktop-sale-empty desktop-cart-empty">${icon("shopping-basket")}<b>Seu carrinho está vazio</b><small>Adicione produtos para iniciar a venda.</small></div>`;
    return `<div class="desktop-cart-head"><span>Produto</span><span>Qtd.</span><span>Unitário</span><span>Total</span><span></span></div>${cart
      .map((item) => {
        const itemKey = key(item),
          picture = item.imageThumbUrl || item.imageUrl || item.imagem || "",
          total = number(item.quantidade) * number(item.precoFinalUnitario);
        return `<article class="desktop-cart-item editable-cart">
          <div class="desktop-cart-product">${
            picture
              ? `<img src="${esc(picture)}" alt="">`
              : `<span>${esc(
                  String(item.nome || "P")
                    .slice(0, 2)
                    .toUpperCase(),
                )}</span>`
          }<div><b>${esc(item.nome)}</b><small>${esc(item.variationName || item.variacaoNome || item.categoria || "")}</small></div></div>
          <div class="desktop-cart-quantity"><button type="button" data-cart-step="-1" data-cart-key="${esc(itemKey)}" aria-label="Diminuir quantidade">−</button><input data-item-qty="${esc(itemKey)}" type="number" min="1" step="1" value="${number(item.quantidade)}" aria-label="Quantidade"><button type="button" data-cart-step="1" data-cart-key="${esc(itemKey)}" aria-label="Aumentar quantidade">+</button></div>
          <label class="desktop-cart-unit"><span>Valor unitário</span><input data-item-price="${esc(itemKey)}" type="number" min="0" step=".01" value="${number(item.precoFinalUnitario).toFixed(2)}"></label>
          <b class="desktop-cart-total">${money(total)}</b>
          <button type="button" class="desktop-cart-remove" data-remove="${esc(itemKey)}" aria-label="Remover ${esc(item.nome)}">${icon("x")}</button>
        </article>`;
      })
      .join("")}`;
  }

  function options(values, label) {
    return `<option value="">${label}</option>${[
      ...new Set(values.filter(Boolean)),
    ]
      .sort((a, b) => a.localeCompare(b, "pt-BR"))
      .map((value) => `<option value="${esc(value)}">${esc(value)}</option>`)
      .join("")}`;
  }

  function render({ products, clients, cart, totals }) {
    const categories = products.map((product) => product.categoria || ""),
      brands = products.map((product) => product.marca || product.brand || "");
    return `<section class="desktop-sales" data-desktop-sales>
      <header class="desktop-sales-title"><h2>Nova venda</h2><p>Adicione produtos ao carrinho para iniciar uma venda.</p></header>
      <div class="desktop-sales-toolbar">
        <label class="desktop-sales-search">${icon("search")}<input id="product-search" placeholder="Buscar produto, código de barras ou categoria..." autocomplete="off"></label>
        <button class="desktop-barcode-button" type="button" data-scan-sale aria-label="Ler código de barras">${icon("scan-barcode")}</button>
        <label><span>Categoria</span><select id="desktop-sale-category">${options(categories, "Todas")}</select></label>
        <label><span>Marca</span><select id="desktop-sale-brand">${options(brands, "Todas")}</select></label>
        <label><span>Ordenar por</span><select id="desktop-sale-sort"><option value="popular">Mais vendidos</option><option value="name">Nome A–Z</option><option value="price-asc">Menor preço</option><option value="price-desc">Maior preço</option><option value="stock">Maior estoque</option></select></label>
        <button class="desktop-sales-favorite" type="button" id="desktop-sale-favorites" aria-pressed="false">${icon("star")} Favoritos</button>
      </div>
      <div class="desktop-sales-layout">
        <section class="desktop-sales-products panel">
          <header><h3>Produtos <span id="desktop-sale-count">(${products.length})</span></h3><span>${icon("layout-grid")} Grade</span></header>
          <div class="desktop-sales-product-grid product-picker" id="desktop-sale-products">${renderProducts(products)}</div>
        </section>
        <aside class="desktop-sales-cart panel sale-summary">
          <header><h3>Carrinho <span id="desktop-cart-count">${cart.reduce((sum, item) => sum + number(item.quantidade), 0)} itens</span></h3><button type="button" id="desktop-clear-cart">${icon("trash-2")} Limpar carrinho</button></header>
          <div id="cart" class="desktop-cart-list">${cartHTML(cart)}</div>
          <section class="desktop-discount-row">
            <span>Desconto</span><label>R$<input id="discount-value" type="number" min="0" step=".01" value="0"></label><label>%<input id="discount-percent" type="number" min="0" max="100" step=".01" value="0"></label><strong id="desktop-discount-preview">${money(totals.descontoTotal)}</strong>
          </section>
          <input id="manual-total" type="number" min="0" step=".01" value="${number(totals.valorFinal).toFixed(2)}" hidden>
          <div id="sale-totals" class="desktop-sale-totals"></div>
          <button type="button" class="desktop-continue-sale" id="desktop-continue-sale"><span>Continuar venda<small>Revisar e finalizar</small></span>${icon("chevron-right")}</button>
          <section class="desktop-checkout-fields" id="desktop-checkout-fields" hidden>
            <div class="field"><label>Cliente</label><select id="sale-client"><option value="">Venda avulsa</option>${clients.map((client) => `<option value="${esc(client.id)}">${esc(client.nome)}${client.saldo < 0 ? ` — deve ${money(Math.abs(client.saldo))}` : client.saldo > 0 ? ` — crédito ${money(client.saldo)}` : ""}</option>`).join("")}</select></div>
            <div class="field"><label>Forma de pagamento</label><select id="sale-status"><option value="pago">Pago</option><option value="fiado">Fiado</option></select></div>
            <div id="debt-preview"></div>
            <div class="field"><label>Observação</label><textarea id="sale-note" placeholder="Opcional"></textarea></div>
            <button class="btn btn-primary" id="finish-sale" type="button">${icon("check")} Concluir venda</button>
          </section>
        </aside>
      </div>
    </section>`;
  }

  function filterProducts() {
    const root = document.querySelector("[data-desktop-sales]");
    if (!root) return;
    const query =
        root.querySelector("#product-search")?.value.trim().toLowerCase() || "",
      category = root.querySelector("#desktop-sale-category")?.value || "",
      brand = root.querySelector("#desktop-sale-brand")?.value || "",
      favorites =
        root
          .querySelector("#desktop-sale-favorites")
          ?.getAttribute("aria-pressed") === "true",
      sort = root.querySelector("#desktop-sale-sort")?.value || "popular",
      cards = [...root.querySelectorAll(".desktop-sale-product")];
    cards.forEach((card) => {
      card.hidden =
        (query && !card.dataset.search.includes(query)) ||
        (category && card.dataset.category !== category) ||
        (brand && card.dataset.brand !== brand) ||
        (favorites && card.dataset.favorite !== "true");
    });
    const visible = cards.filter((card) => !card.hidden);
    visible
      .sort((a, b) => {
        if (sort === "name")
          return a.dataset.search.localeCompare(b.dataset.search, "pt-BR");
        if (sort === "price-asc")
          return number(a.dataset.price) - number(b.dataset.price);
        if (sort === "price-desc")
          return number(b.dataset.price) - number(a.dataset.price);
        if (sort === "stock")
          return (
            number(
              b.textContent
                .match(/Estoque:\s*(-?[\d.,]+)/)?.[1]
                ?.replace(",", "."),
            ) -
            number(
              a.textContent
                .match(/Estoque:\s*(-?[\d.,]+)/)?.[1]
                ?.replace(",", "."),
            )
          );
        return 0;
      })
      .forEach((card) => card.parentElement.append(card));
    const count = root.querySelector("#desktop-sale-count");
    if (count) count.textContent = `(${visible.length})`;
  }

  function bind() {
    const root = document.querySelector("[data-desktop-sales]");
    if (!root) return;
    [
      "#product-search",
      "#desktop-sale-category",
      "#desktop-sale-brand",
      "#desktop-sale-sort",
    ].forEach((selector) =>
      root.querySelector(selector)?.addEventListener("input", filterProducts),
    );
    root
      .querySelector("#desktop-sale-favorites")
      ?.addEventListener("click", (event) => {
        const active =
          event.currentTarget.getAttribute("aria-pressed") !== "true";
        event.currentTarget.setAttribute("aria-pressed", String(active));
        filterProducts();
      });
    root
      .querySelector("#desktop-continue-sale")
      ?.addEventListener("click", () => {
        const checkout = root.querySelector("#desktop-checkout-fields");
        checkout.hidden = false;
        checkout.scrollIntoView({ behavior: "smooth", block: "nearest" });
        root.querySelector("#sale-client")?.focus({ preventScroll: true });
      });
  }

  function refreshProducts() {
    const grid = document.querySelector("#desktop-sale-products");
    if (!grid) return false;
    grid.innerHTML = renderProducts();
    filterProducts();
    window.lucide?.createIcons();
    return true;
  }

  function refreshClients() {
    const select = document.querySelector("#sale-client");
    if (!select) return false;
    const selected = select.value;
    select.innerHTML = `<option value="">Venda avulsa</option>${Clientes.listar()
      .filter((client) => client.ativo !== false)
      .map(
        (client) =>
          `<option value="${esc(client.id)}">${esc(client.nome)}${client.saldo < 0 ? ` — deve ${money(Math.abs(client.saldo))}` : client.saldo > 0 ? ` — crédito ${money(client.saldo)}` : ""}</option>`,
      )
      .join("")}`;
    if ([...select.options].some((option) => option.value === selected))
      select.value = selected;
    return true;
  }

  window.DesktopSales = {
    isDesktop: () => mq.matches,
    render,
    bind,
    cartHTML,
    refreshProducts,
    refreshClients,
    filterProducts,
  };
})();
