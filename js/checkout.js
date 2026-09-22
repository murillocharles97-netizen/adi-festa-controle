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
    saleInCurrentSpace = (sale, spaceId = selectedSalesSpaceId()) => {
      if (
        window.SpaceEngine?.isValidSale &&
        !window.SpaceEngine.isValidSale(sale)
      )
        return false;
      if (!window.SpaceEngine?.saleBelongsTo || !spaceId) return true;
      const knownIds = new Set(
        (window.SpaceContext?.list?.() || []).map((space) => space.id),
      );
      return window.SpaceEngine.saleBelongsTo(sale, spaceId, knownIds);
    };
  let soldByProduct = new Map();
  function rebuildSoldIndex() {
    const next = new Map();
    Repositories.saleRepository().list().filter((sale) => saleInCurrentSpace(sale)).forEach((sale) =>
      (sale.itens || []).forEach((item) =>
        next.set(
          item.produtoId,
          (next.get(item.produtoId) || 0) + Number(item.quantidade || 0),
        ),
      ),
    );
    soldByProduct = next;
  }
  const initials = (n) =>
    String(n || "?")
      .split(/\s+/)
      .slice(0, 2)
      .map((x) => x[0])
      .join("")
      .toUpperCase();
  const cartKey = (item) =>
    item?.productType === "recurring"
      ? `${item.produtoId}::${item.variantId || "base"}::${item.recurringActivation?.subscriptionId || item.recurringActivation?.draftId || "new"}`
      : window.ProductVariations?.itemKey(item) || String(item?.produtoId || "");
  const priceLabel = (p) =>
    window.ProductVariations?.isVariable?.(p)
      ? Number(p.minPrice) === Number(p.maxPrice)
        ? dinheiro(p.minPrice)
        : `${dinheiro(p.minPrice)} – ${dinheiro(p.maxPrice)}`
      : dinheiro(p.preco);
  const balance = (c) => {
    const s = Number(c.saldo || 0);
    return s < 0
      ? `<span class="badge balance-badge debit">Deve ${dinheiro(Math.abs(s))}</span>`
      : s > 0
        ? `<span class="badge balance-badge credit">Crédito ${dinheiro(s)}</span>`
        : '<span class="badge balance-badge zero">Sem saldo</span>';
  };
  const stock = (p) => {
    const current = Number(
      window.ProductVariations?.isVariable?.(p) ? p.totalStock : p.estoqueAtual,
    );
    return getProductStockStatus(p) === "sem-controle"
      ? '<small class="pos-stock-neutral">Sem controle de estoque</small>'
      : getProductStockStatus(p) === "esgotado"
        ? '<small class="pos-stock-out">Sem estoque</small>'
        : getProductStockStatus(p) === "baixo"
          ? `<small class="pos-stock-low">Estoque: ${current} · baixo</small>`
          : `<small class="pos-stock-ok">Estoque: ${current}</small>`;
  };
  const card = (p) => {
    const variants =
        window.ProductVariations?.isVariable?.(p)
          ? window.ProductVariations?.list(p.id) || []
          : [],
      variantSearch = variants
        .map((v) =>
          [
            v.displayName,
            v.sku,
            v.barcode,
            ...Object.values(v.attributeValues || {}),
          ].join(" "),
        )
        .join(" ") || (p.variationSearchTokens || []).join(" ");
    const photo = window.ProductImages?.markup?.(p, { className: "sale-product-photo" }) || `<span class="pos-placeholder">${initials(p.nome)}</span>`;
    const recurring = p.productType === "recurring",
      controlsStock = window.productControlsStock?.(p) ?? (!p.semControleEstoque && p.controlaEstoque !== false),
      detail = window.ProductVariations?.isVariable?.(p) ? `${Number(p.activeVariationCount || 0)} opções` : escapar(p.categoria || p.nome),
      renewal = recurring && !controlsStock
        ? `<small class="pos-renewal-badge"><i data-lucide="calendar-clock"></i>${escapar(window.getProductRenewalPeriod?.(p) || `${Number(p.durationValue || 30)} ${durationUnitLabel(p.durationUnit, Number(p.durationValue || 30))}`)}</small>`
        : stock(p);
    return `<button class="pos-product ${window.ProductVariations?.isVariable?.(p) ? "is-variable" : ""} ${recurring ? "is-recurring" : ""}" data-add="${p.id}" data-search="${escapar(norm([p.nome, p.codigo, p.barcode, p.categoria, p.palavrasChave, variantSearch].join(" ")))}" data-category="${escapar(norm(p.categoria))}" title="${escapar(p.nome)}"><span class="pos-qty" data-pos-qty="${p.id}" hidden>0</span>${p.favorito ? '<span class="pos-favorite" aria-label="Favorito">★</span>' : ""}${photo}<strong>${escapar(p.nome)}</strong><small class="pos-full-name">${detail}</small><b>${priceLabel(p)}</b>${renewal}</button>`;
  };
  const durationUnitLabel = (unit, value = 2) => ({ days: value === 1 ? "dia" : "dias", weeks: value === 1 ? "semana" : "semanas", months: value === 1 ? "mês" : "meses", years: value === 1 ? "ano" : "anos" }[unit] || (value === 1 ? "dia" : "dias"));
  function view() {
    restoreDraft();
    rebuildSoldIndex();
    const ps = products()
        .list()
        .filter((p) => p.ativo !== false && productAvailableHere(p)),
      cs = clients()
        .list()
        .filter((c) => c.ativo !== false),
      cats = [...new Set(ps.map((p) => p.categoria).filter(Boolean))].sort(),
      spaceBar = window.SpaceContext?.renderBar?.("sales") || "";
    if (window.DesktopSales?.isDesktop?.()) {
      const productById = new Map(ps.map((product) => [product.id, product])),
        seen = new Set(),
        recentProducts = [];
      [...Repositories.saleRepository().list().filter((sale) => saleInCurrentSpace(sale))]
        .reverse()
        .some((sale) =>
          [...(sale.itens || [])].reverse().some((item) => {
            const product = productById.get(item.produtoId);
            if (!product || seen.has(product.id)) return false;
            seen.add(product.id);
            recentProducts.push(product);
            return recentProducts.length >= 5;
          }),
        );
      return `${spaceBar}${window.DesktopSales.render({
        products: ps,
        clients: cs,
        cart,
        totals: totals(cart),
        recentProducts,
      })}`;
    }
    return `<div class="pos-page">${spaceBar}<div class="pos-head"><h2>Nova venda</h2><p>Toque nos produtos para adicionar à sacola.</p></div><section class="pos-tools"><div class="pos-search-wrap"><i data-lucide="search"></i><input class="search" id="product-search" autocomplete="off" placeholder="Buscar produto, código ou categoria"><button class="icon-btn" id="clear-product-search"><i data-lucide="x"></i></button><button type="button" data-scan-sale aria-label="Ler código de barras"><i data-lucide="scan-barcode"></i></button></div><select id="pos-category"><option value="">Categorias</option>${cats.map((c) => `<option value="${escapar(norm(c))}">${escapar(c)}</option>`).join("")}</select><select id="pos-filter"><option value="todos">Todos</option><option value="favoritos">Favoritos</option><option value="estoque">Em estoque</option><option value="baixo">Estoque baixo</option></select><select id="pos-sort"><option value="favoritos">Favoritos primeiro</option><option value="nome">Nome</option><option value="vendidos">Mais vendidos</option><option value="categoria">Categoria</option><option value="preco">Preço</option></select></section><section class="pos-grid" id="pos-grid">${ps.map(card).join("") || '<div class="empty">Nenhum produto disponível neste espaço</div>'}</section><div class="pos-summary-overlay" data-sale-cart-overlay hidden></div><section class="pos-summary" id="pos-summary" role="dialog" aria-modal="true" aria-labelledby="sale-summary-title" aria-hidden="true" hidden><div class="pos-summary-head"><div><h3 id="sale-summary-title">Carrinho</h3><p>Revise os itens, cliente e pagamento.</p></div><button class="icon-btn" id="close-sale-summary" aria-label="Fechar carrinho"><i data-lucide="x"></i></button></div><div id="cart"></div><div class="discount-grid"><div class="field"><label>Desconto em R$</label><input id="discount-value" type="number" inputmode="decimal" min="0" step=".01" value="0"></div><div class="field"><label>Desconto em %</label><input id="discount-percent" type="number" inputmode="decimal" min="0" max="100" step=".01" value="0"></div></div><div class="field"><label>Valor final da venda</label><input id="manual-total" type="number" inputmode="decimal" min="0" step=".01" value="0"></div><div id="sale-totals"></div><div class="pos-client-card" id="selected-client-card"></div><select id="sale-client" class="visually-hidden"><option value="">Venda avulsa</option>${cs.map((c) => `<option value="${c.id}">${escapar(c.nome)}</option>`).join("")}</select><button class="btn btn-light pos-client-select" id="open-client-picker"><i data-lucide="users"></i><span>Selecionar cliente ou venda avulsa</span></button><div class="field sale-payment-method-field"><label>Forma de pagamento</label><select id="sale-payment-method"><option value="pix">Pix</option><option value="dinheiro">Dinheiro</option><option value="cartao">Cartão</option><option value="cartao_presencial">Cartão na maquininha</option><option value="fiado">Fiado</option></select></div><select id="sale-status" class="visually-hidden" aria-hidden="true" tabindex="-1"><option value="pago">Pago agora</option><option value="fiado">Fiado</option></select><div id="debt-preview"></div><div class="field"><label>Observação</label><textarea id="sale-note" placeholder="Opcional"></textarea></div><div class="sale-submit-feedback" id="sale-submit-feedback" role="status" aria-live="polite" hidden></div><button class="btn btn-primary" id="finish-sale" data-sale-state="normal"><i data-lucide="check"></i> Concluir venda</button></section><button class="pos-bag is-empty" id="open-sale-summary" aria-controls="pos-summary" aria-expanded="false" aria-label="Sacola vazia"><i data-lucide="shopping-bag"></i><span class="visually-hidden" id="pos-bag-label">Nenhum item selecionado</span><b class="visually-hidden" id="pos-bag-total">${dinheiro(0)}</b></button></div>`;
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
    document.querySelectorAll("[data-pos-qty]").forEach((e) => {
      const q = cart
        .filter((item) => item.produtoId === e.dataset.posQty)
        .reduce((sum, item) => sum + Number(item.quantidade || 0), 0);
      e.hidden = !q;
      e.dataset.quantity = String(q);
      e.textContent = q;
      e.closest(".pos-product")?.classList.toggle("selected", !!q);
    });
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
    if (!c) {
      label.textContent = "Selecionar cliente ou venda avulsa";
      box.innerHTML = '<span class="muted">Venda avulsa selecionada</span>';
      return;
    }
    const total = Number(document.querySelector("#manual-total")?.value || 0),
      fiado = document.querySelector("#sale-status")?.value === "fiado",
      deve = Math.abs(Math.min(0, Number(c.saldo || 0)));
    label.textContent = c.nome;
    box.innerHTML = `<div><small>Cliente</small><b>${escapar(c.nome)}</b><p>${balance(c)}</p>${fiado ? `<p class="pos-fiado-preview">Após esta venda: <b>${dinheiro(deve + total)} em aberto</b></p>` : ""}</div><div><button class="icon-btn" data-change-client><i data-lucide="repeat-2"></i></button>${somenteNumeros(c.telefone).length >= 10 ? `<button class="icon-btn" data-client-wa="${c.id}"><i data-lucide="message-circle"></i></button>` : ""}</div>`;
    window.lucide?.createIcons();
  }
  function filter() {
    const q = norm(document.querySelector("#product-search")?.value),
      cat = document.querySelector("#pos-category")?.value || "",
      brand = document.querySelector("#desktop-sale-brand")?.value || "",
      f = document.querySelector("#pos-filter")?.value || "todos",
      sort = document.querySelector("#pos-sort")?.value || "nome";
    let cards = [...document.querySelectorAll(".pos-product")];
    cards.forEach((el) => {
      const p = products().getById(el.dataset.add),
        n = Number(window.ProductVariations?.isVariable?.(p) ? p.totalStock : p.estoqueAtual),
        controlsStock = window.productControlsStock?.(p) ?? (!p.semControleEstoque && p.controlaEstoque !== false);
      el.hidden = !(
        (!q || el.dataset.search.includes(q)) &&
        (!cat || el.dataset.category === cat) &&
        (!brand || el.dataset.brand === brand) &&
        (f === "todos" ||
          (f === "favoritos" && p.favorito) ||
          (f === "estoque" && controlsStock && n > 0) ||
          (f === "baixo" &&
            controlsStock &&
            n > 0 &&
            n <= Number(p.estoqueMinimo || 0)))
      );
    });
    cards
      .sort((a, b) => {
        const x = products().getById(a.dataset.add),
          y = products().getById(b.dataset.add);
        if (sort === "preco") return x.preco - y.preco;
        if (sort === "categoria")
          return String(x.categoria).localeCompare(String(y.categoria));
        if (sort === "vendidos") return (soldByProduct.get(y.id) || 0) - (soldByProduct.get(x.id) || 0);
        if (sort === "favoritos" && x.favorito !== y.favorito)
          return Number(y.favorito) - Number(x.favorito);
        return x.nome.localeCompare(y.nome);
      })
      .forEach((el) =>
        (document.querySelector("#desktop-sale-products") ||
          document.querySelector("#pos-grid"))?.append(el),
      );
    dispatchEvent(new CustomEvent("sale-products-filtered", { detail: { query: q, visible: cards.filter((card) => !card.hidden).length } }));
  }
  function refreshProducts() {
    const grid = document.querySelector("#pos-grid"),
      category = document.querySelector("#pos-category");
    if (!grid || window.DesktopSales?.isDesktop?.()) return false;
    rebuildSoldIndex();
    const activeProducts = products()
        .list()
        .filter((product) => product.ativo !== false && productAvailableHere(product)),
      categories = [
        ...new Set(activeProducts.map((product) => product.categoria).filter(Boolean)),
      ].sort(),
      selectedCategory = category?.value || "";
    grid.innerHTML =
      activeProducts.map(card).join("") ||
      '<div class="empty">Nenhum produto disponível neste espaço</div>';
    if (category) {
      category.innerHTML = `<option value="">Categorias</option>${categories
        .map((name) => `<option value="${escapar(norm(name))}">${escapar(name)}</option>`)
        .join("")}`;
      if ([...category.options].some((option) => option.value === selectedCategory))
        category.value = selectedCategory;
    }
    window.CheckoutMobile?.enhance?.();
    filter();
    refresh();
    window.lucide?.createIcons();
    return true;
  }
  function refreshClients() {
    const select = document.querySelector("#sale-client");
    if (!select) return false;
    const selected = select.value;
    select.innerHTML = `<option value="">Venda avulsa</option>${clients()
      .list()
      .filter((client) => client.ativo !== false)
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
  function picker(onSelected = null, options = {}) {
    const all = clients()
        .list()
        .filter((c) => c.ativo !== false)
        .sort((a, b) => a.nome.localeCompare(b.nome)),
      recent = (DB.carregar().config.recentClientIds || [])
        .map((id) => all.find((c) => c.id === id))
        .filter(Boolean);
    document.querySelector("#modal").innerHTML =
      `<div class="modal-bg"><section class="modal-box client-picker"><header class="modal-head"><h3>${options.title || "Selecionar cliente"}</h3><button class="icon-btn close"><i data-lucide="x"></i></button></header><div class="client-search"><i data-lucide="search"></i><input id="client-picker-search" autofocus autocomplete="off" placeholder="Buscar por nome ou telefone"></div><div class="client-picker-body">${options.requireClient ? "" : '<button class="client-choice guest" data-choose-client=""><div><b>Venda avulsa</b><small>Sem cliente vinculado</small></div><i data-lucide="user-round"></i></button>'}<button class="btn btn-primary" id="quick-new-client"><i data-lucide="user-plus"></i> Novo cliente</button><div id="client-results">${recent.length ? `<h4>Clientes recentes</h4>${recent.map(row).join("")}` : ""}<h4>Todos os clientes</h4><div id="client-result-list">${all.slice(0, 30).map(row).join("")}</div><p class="muted" id="client-result-more">${all.length > 30 ? "Digite para filtrar a lista completa." : ""}</p></div></div></section></div>`;
    const close = () => (document.querySelector("#modal").innerHTML = "");
    document
      .querySelectorAll("#modal .close")
      .forEach((x) => (x.onclick = close));
    const input = document.querySelector("#client-picker-search");
    let timer;
    input.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
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
        document.querySelector("#client-result-list").innerHTML =
          found.slice(0, 60).map(row).join("") ||
          '<p class="empty">Nenhum cliente encontrado</p>';
        document.querySelector("#client-result-more").textContent =
          found.length > 60 ? "Mostrando 60 resultados. Refine a busca." : "";
        window.lucide?.createIcons();
      }, 130);
    };
    document.querySelector("#modal").onclick = (e) => {
      const b = e.target.closest("[data-choose-client]");
      if (b) {
        const sel = document.querySelector("#sale-client");
        sel.value = b.dataset.chooseClient;
        sel.dispatchEvent(new Event("change"));
        if (sel.value)
          DB.alterar(
            (db) =>
              (db.config.recentClientIds = [
                sel.value,
                ...(db.config.recentClientIds || []).filter(
                  (id) => id !== sel.value,
                ),
              ].slice(0, 5)),
          );
        close();
        refresh();
        if (onSelected && sel.value) onSelected(clients().getById(sel.value));
      }
      if (e.target.closest("#quick-new-client")) quickClient();
    };
    window.lucide?.createIcons();
  }
  const dateLabel = (value) => value ? new Date(value).toLocaleDateString("pt-BR") : "—";
  async function recurringConfiguration(product, variant = null, source = null) {
    const clientId = document.querySelector("#sale-client")?.value;
    if (!clientId) {
      picker(() => recurringConfiguration(product, variant, source), { requireClient: true, title: "Selecione o cliente da renovação" });
      return;
    }
    await window.CustomerSubscriptions?.loadForClient?.(clientId);
    const existing = window.CustomerSubscriptions?.matchingProduct?.(clientId, product.id) || window.CustomerSubscriptions?.matching?.(clientId, product.id, variant?.id || null) || [], modal = document.querySelector("#modal"), defaultDuration = Number(variant?.durationValue || product.durationValue || 30), defaultUnit = variant?.durationUnit || product.durationUnit || "days";
    const render = () => {
      const selectedId = modal.querySelector?.('[name="subscriptionChoice"]:checked')?.value || existing[0]?.id || "new", selected = existing.find((item) => item.id === selectedId) || null, durationValue = Number(modal.querySelector?.('[name="durationValue"]')?.value || defaultDuration), durationUnit = modal.querySelector?.('[name="durationUnit"]')?.value || defaultUnit, price = Number(modal.querySelector?.('[name="contractedPrice"]')?.value || selected?.contractedPrice || variant?.price || product.preco || 0), label = modal.querySelector?.('[name="renewalLabel"]')?.value || selected?.label || product.renewalLabel || product.nome, payment = modal.querySelector?.('[name="renewalPayment"]')?.value || window.CheckoutPaymentMethod || "pix", dates = CustomerSubscriptions.preview({ subscription: selected, durationValue, durationUnit });
      modal.innerHTML = `<div class="modal-bg recurring-sale-bg"><section class="modal-box recurring-sale-sheet" role="dialog" aria-modal="true" aria-labelledby="recurring-sale-title"><header class="modal-head"><div><small>Venda com renovação</small><h3 id="recurring-sale-title">${escapar(product.nome)}${variant ? ` — ${escapar(ProductVariations.displayName(variant))}` : ""}</h3></div><button class="icon-btn close"><i data-lucide="x"></i></button></header><div class="modal-body">${existing.length ? `<section class="recurring-existing"><h4>Este cliente já possui esta renovação</h4>${existing.map((item) => { const currentVariant = item.variantId ? ProductVariations.get(item.variantId) : null; return `<label><input type="radio" name="subscriptionChoice" value="${item.id}" ${item.id === selectedId ? "checked" : ""}><span><b>${escapar(item.label)}</b><small>${CustomerSubscriptions.effectiveStatus(item) === "active" ? "Ativa" : "Vencida"}${currentVariant ? ` · ${escapar(ProductVariations.displayName(currentVariant))}` : ""} · até ${dateLabel(item.expiresAt)}</small></span></label>`; }).join("")}<label><input type="radio" name="subscriptionChoice" value="new" ${selectedId === "new" ? "checked" : ""}><span><b>Criar outra</b><small>Nova vigência separada</small></span></label></section>` : ""}<div class="field"><label>Nome para identificação</label><input name="renewalLabel" value="${escapar(label)}" placeholder="Ex.: Casa, Escritório"></div><div class="recurring-form-grid"><div class="field"><label>Período</label><input name="durationValue" type="number" inputmode="numeric" min="1" value="${durationValue}"></div><div class="field"><label>Unidade</label><select name="durationUnit"><option value="days" ${durationUnit === "days" ? "selected" : ""}>dias</option><option value="weeks" ${durationUnit === "weeks" ? "selected" : ""}>semanas</option><option value="months" ${durationUnit === "months" ? "selected" : ""}>meses</option><option value="years" ${durationUnit === "years" ? "selected" : ""}>anos</option></select></div><div class="field"><label>Valor</label><input name="contractedPrice" type="number" inputmode="decimal" min="0" step=".01" value="${price.toFixed(2)}"></div><div class="field"><label>Pagamento</label><select name="renewalPayment"><option value="pix" ${payment === "pix" ? "selected" : ""}>Pix / pago</option><option value="dinheiro" ${payment === "dinheiro" ? "selected" : ""}>Dinheiro / pago</option><option value="cartao" ${payment === "cartao" ? "selected" : ""}>Cartão / pago</option><option value="fiado" ${payment === "fiado" ? "selected" : ""}>Fiado</option></select></div></div><section class="recurring-preview"><span><small>${selected ? "Vencimento atual" : "Início"}</small><b>${selected ? dateLabel(selected.expiresAt) : dateLabel(dates.startsAt)}</b></span><i data-lucide="arrow-right"></i><span><small>${selected ? "Renovado até" : "Ativo até"}</small><b>${dateLabel(dates.expiresAt)}</b></span></section></div><footer class="modal-foot"><button class="btn btn-light close">Cancelar</button><button class="btn btn-primary" data-confirm-recurring>${selected ? "Adicionar renovação" : "Adicionar ativação"}</button></footer></section></div>`;
      modal.querySelectorAll(".close").forEach((button) => button.onclick = () => modal.innerHTML = "");
      modal.querySelectorAll('input[name="subscriptionChoice"]').forEach((input) => input.onchange = render);
      ["durationValue", "durationUnit"].forEach((name) => modal.querySelector(`[name="${name}"]`).onchange = render);
      modal.querySelector("[data-confirm-recurring]").onclick = () => {
        const choiceId = modal.querySelector('input[name="subscriptionChoice"]:checked')?.value || selectedId,
          chosen = existing.find((entry) => entry.id === choiceId) || null,
          finalDurationValue = Math.max(1, Number(modal.querySelector('[name="durationValue"]')?.value || defaultDuration)),
          finalDurationUnit = modal.querySelector('[name="durationUnit"]')?.value || defaultUnit,
          finalPrice = Math.max(0, Number(modal.querySelector('[name="contractedPrice"]')?.value || 0)),
          finalLabel = String(modal.querySelector('[name="renewalLabel"]')?.value || product.renewalLabel || product.nome).trim(),
          finalPayment = modal.querySelector('[name="renewalPayment"]')?.value || "pix",
          item = ProductVariations.saleItem(product, variant, 1), draftId = Utils.uuid();
        Object.assign(item, { productType: "recurring", precoOriginal: finalPrice, precoFinalUnitario: finalPrice, precoUnitario: finalPrice, recurringActivation: { draftId, subscriptionId: chosen?.id || null, label: finalLabel, durationValue: finalDurationValue, durationUnit: finalDurationUnit, contractedPrice: finalPrice, renewalMessage: product.renewalMessage || "", reminders: product.renewalReminders || [], clientIdSnapshot: clientId } });
        const status = finalPayment === "fiado" ? "fiado" : "pago", statusSelect = document.querySelector("#sale-status"), paymentSelect = document.querySelector("#sale-payment-method");
        statusSelect.value = status; if (paymentSelect) paymentSelect.value = finalPayment; window.CheckoutPaymentMethod = finalPayment; statusSelect.dispatchEvent(new Event("change", { bubbles: true }));
        addSaleItem(item, { source }); modal.innerHTML = ""; toast(chosen ? "Renovação adicionada à sacola" : "Ativação adicionada à sacola");
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
    document.querySelector("#modal").innerHTML =
      `<div class="modal-bg"><section class="modal-box"><header class="modal-head"><h3>Novo cliente</h3></header><form id="quick-client-form"><div class="modal-body"><div class="field"><label>Nome *</label><input name="nome" required autofocus></div><div class="field"><label>Telefone / WhatsApp</label><input name="telefone" inputmode="tel"></div><div class="field"><label>Observação</label><textarea name="observacoes"></textarea></div></div><footer class="modal-foot"><button type="button" class="btn btn-light cancel">Cancelar</button><button class="btn btn-primary">Salvar e selecionar</button></footer></form></section></div>`;
    document.querySelector(".cancel").onclick = () => picker();
    document.querySelector("#quick-client-form").onsubmit = (e) => {
      e.preventDefault();
      clients().create(Object.fromEntries(new FormData(e.currentTarget)));
      const c = clients().list().at(-1),
        sel = document.querySelector("#sale-client");
      sel.innerHTML += `<option value="${c.id}">${escapar(c.nome)}</option>`;
      sel.value = c.id;
      sel.dispatchEvent(new Event("change"));
      document.querySelector("#modal").innerHTML = "";
      refresh();
      toast("Cliente salvo e selecionado");
    };
  }
  function enhance() {
    let t;
    const search = document.querySelector("#product-search");
    search.oninput = () => {
      clearTimeout(t);
      t = setTimeout(filter, 120);
    };
    document.querySelector("#clear-product-search").onclick = () => {
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
    restoredDraftKey = "",
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
      note: document.querySelector("#sale-note")?.value ?? draftDetails.note ?? "",
      discountValue: document.querySelector("#discount-value")?.value ?? draftDetails.discountValue ?? "0",
      discountPercent: document.querySelector("#discount-percent")?.value ?? draftDetails.discountPercent ?? "0",
    };
    return draftDetails;
  }
  function saveDraft() {
    const key = draftKey();
    if (!key) return;
    try {
      if (!cart.length) return sessionStorage.removeItem(key);
      sessionStorage.setItem(key, JSON.stringify({
        version: 1,
        businessId: String(DB.getBusinessId?.() || ""),
        spaceId: selectedSalesSpaceId(),
        cart,
        discountKind,
        manual,
        selectedCampaignIds: [...selectedCampaignIds],
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
  }
  function restoreDraft() {
    const key = draftKey();
    if (!key || restoredDraftKey === key || cart.length) return;
    restoredDraftKey = key;
    try {
      const saved = JSON.parse(sessionStorage.getItem(key) || "null");
      if (!saved || saved.spaceId !== selectedSalesSpaceId() || !Array.isArray(saved.cart)) return;
      cart = saved.cart.filter((item) => {
        const product = products().getById(item?.produtoId || item?.productId);
        return product && productAvailableHere(product) && Number(item.quantidade) > 0;
      });
      discountKind = saved.discountKind || null;
      manual = Boolean(saved.manual);
      selectedCampaignIds = new Set(saved.selectedCampaignIds || []);
      draftDetails = { ...draftDetails, ...(saved.details || {}) };
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
    if (client && [...client.options].some((option) => option.value === draftDetails.clientId)) client.value = draftDetails.clientId;
    if (payment) payment.value = draftDetails.paymentMethod || "pix";
    if (status) status.value = payment?.value === "fiado" ? "fiado" : "pago";
    if (note) note.value = draftDetails.note || "";
    if (discountValue) discountValue.value = draftDetails.discountValue || "0";
    if (discountPercent) discountPercent.value = draftDetails.discountPercent || "0";
    window.CheckoutPaymentMethod = payment?.value || "pix";
  }
  function invalidateAttempt() { if (!finishing) activeAttempt = null; }
  function setSubmissionState(state, message = "") {
    const button = document.querySelector("#finish-sale"), feedback = document.querySelector("#sale-submit-feedback"),
      labels = { normal: '<i data-lucide="check"></i> Concluir venda', processing: '<i data-lucide="loader-circle"></i> Processando…', success: message.startsWith("Venda salva") ? '<i data-lucide="circle-check"></i> Venda salva' : '<i data-lucide="circle-check"></i> Venda concluída', error: '<i data-lucide="rotate-ccw"></i> Tentar novamente' };
    if (button) {
      button.dataset.saleState = state;
      button.disabled = state === "processing" || state === "success";
      button.innerHTML = labels[state] || labels.normal;
    }
    if (feedback) {
      feedback.hidden = !message;
      feedback.textContent = message;
      feedback.classList.toggle("error", state === "error");
      feedback.classList.toggle("success", state === "success");
    }
    window.lucide?.createIcons();
  }
  const totals = (items = cart) => {
    const original = items.reduce(
        (s, i) => s + i.quantidade * i.precoOriginal,
        0,
      ),
      final = items.reduce((s, i) => s + i.quantidade * i.precoFinalUnitario, 0),
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
  function drawCart() {
    const host = document.querySelector("#cart");
    if (!host) return;
    const clientId = document.querySelector("#sale-client")?.value || null;
    const displayItems = !manual && clientId
      ? (window.Campanhas?.aplicarBeneficios?.(cart, clientId, {
          selectedCampaignIds: [...selectedCampaignIds],
          status: document.querySelector("#sale-status")?.value || "pago",
        }) || cart)
      : cart;
    const t = totals(displayItems);
    host.innerHTML = window.DesktopSales?.isDesktop?.()
      ? window.DesktopSales.cartHTML(cart)
      : cart.length
        ? cart
          .map((i) => {
            const key = cartKey(i), product = products().getById(i.produtoId), variant = i.variantId ? window.ProductVariations?.get?.(i.variantId) : null,
              image = window.ProductImages?.markup?.(product, { variant, className: "sale-cart-photo" }) || `<span class="sale-cart-photo placeholder">${initials(i.nome)}</span>`;
            return `<div class="cart-item editable-cart">${image}<div><b>${escapar(i.nome)}</b><br><small>Original: ${dinheiro(i.precoOriginal)} · Custo: ${dinheiro(i.custoUnitario)}</small></div><label>Qtd.<input data-item-qty="${escapar(key)}" type="number" min="1" step="1" value="${i.quantidade}"></label><label>Preço final<input data-item-price="${escapar(key)}" type="number" inputmode="decimal" min="0" step=".01" value="${i.precoFinalUnitario.toFixed(2)}"></label><button class="icon-btn" data-remove="${escapar(key)}" aria-label="Remover ${escapar(i.nome)}"><i data-lucide="trash-2"></i></button></div>`;
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
  }

  function drawCampaignBenefits() {
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
    const product = products().getById(item?.produtoId || item?.productId);
    if (!product || !productAvailableHere(product)) {
      toast("Este item não está disponível no espaço de venda atual.", true);
      dispatchEvent(new CustomEvent("sale-item-rejected", { detail: { productId: item?.produtoId || item?.productId || null, reason: "space-unavailable", source: options.source || null } }));
      return false;
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
  function standalone() {
    window.SpaceContext?.bind?.(document);
    const search = document.querySelector("#product-search");
    if (!search) return;
    let timer;
    search.oninput = () => {
      clearTimeout(timer);
      timer = setTimeout(filter, 120);
    };
    document.querySelector("#clear-product-search").onclick = () => {
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
          filter();
        } else fav.textContent = active ? "★" : "☆";
        return;
      }
      const b = e.target.closest("[data-add]");
      if (!b) return;
      const p = products().getById(b.dataset.add);
      if (p.productType === "recurring") {
        openRecurringProduct(p, b);
        return;
      }
      if (ProductVariations.isVariable(p)) {
        variablePicker(p, null, b);
        return;
      }
      const out = getProductStockStatus(p) === "esgotado" && (window.productControlsStock?.(p) ?? (!p.semControleEstoque && p.controlaEstoque !== false)) && !p.allowNegativeStock;
      if (out) {
        toast("Produto sem estoque.", true);
        dispatchEvent(new CustomEvent("sale-item-rejected", { detail: { productId: p.id, reason: "out-of-stock", source: b } }));
        return;
      }
      addSaleItem(ProductVariations.saleItem(p, null, 1), { source: b });
    };
    const openSummary = document.querySelector("#open-sale-summary"),
      closeSummary = document.querySelector("#close-sale-summary");
    if (openSummary && !openSummary.hidden) openSummary.onclick = openCartSurface;
    if (closeSummary && !closeSummary.hidden) closeSummary.onclick = closeCartSurface;
    document.querySelector("#open-client-picker").onclick = () => picker();
    document.querySelector("#sale-client").onchange = () => {
      selectedCampaignIds.clear();
      invalidateAttempt();
      traceSale("[CART] customer selected", { clientId: document.querySelector("#sale-client").value || null });
      drawCart();
    };
    document.querySelector("#sale-status").onchange = drawCart;
    document.querySelector("#sale-payment-method")?.addEventListener("change", event => {
      window.CheckoutPaymentMethod = event.target.value;
      document.querySelector("#sale-status").value = event.target.value === "fiado" ? "fiado" : "pago";
      invalidateAttempt();
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
        i.quantidade = Math.max(1, Number(q.value) || 1);
      }
      if (price) {
        const i = cart.find((x) => cartKey(x) === price.dataset.itemPrice);
        i.precoFinalUnitario = Math.max(0, Number(price.value) || 0);
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
      if (finishing) return setSubmissionState("processing", "A venda já está sendo processada.");
      const validationError = (message) => {
        setSubmissionState("error", message);
        toast(message, true);
        return false;
      };
      if (!cart.length) return validationError("Adicione ao menos um produto.");
      let spaceId;
      try {
        spaceId = window.SpaceContext?.requireSalesSpace?.() || "";
        if (!spaceId || spaceId === "all_spaces") throw Error("Selecione o espaço desta venda.");
      } catch (error) {
        return validationError(error.message || "Selecione o espaço desta venda.");
      }
      const businessId = String(DB.getBusinessId?.() || window.FirebaseSession?.businessId || "").trim(),
        clienteId = document.querySelector("#sale-client").value || null,
        paymentMethod = document.querySelector("#sale-payment-method")?.value || window.CheckoutPaymentMethod || "pix",
        status = paymentMethod === "fiado" ? "fiado" : document.querySelector("#sale-status").value;
      if (!businessId) return validationError("Não foi possível identificar a empresa desta venda. Entre novamente e tente de novo.");
      if (status === "fiado" && !clienteId)
        return validationError("Selecione um cliente para vender fiado.");
      if (cart.some((item) => item.productType === "recurring") && !clienteId)
        return validationError("Venda com renovação exige um cliente.");
      if (cart.some((item) => item.productType === "recurring" && item.recurringActivation?.clientIdSnapshot !== clienteId))
        return validationError("Revise as renovações: o cliente da sacola foi alterado.");
      traceSale("[SALE] validation passed", { businessId, spaceId, clientId: clienteId, paymentMethod });
      const fingerprint = JSON.stringify({ businessId, spaceId, clienteId, paymentMethod, status, note: document.querySelector("#sale-note").value, cart, manual, discountKind, campaigns: [...selectedCampaignIds] }),
        attempt = activeAttempt?.fingerprint === fingerprint ? activeAttempt : { fingerprint, operationId: crypto.randomUUID(), saleId: crypto.randomUUID() },
        proceed = async () => {
          if (finishing) return setSubmissionState("processing", "A venda já está sendo processada.");
          activeAttempt = attempt;
          finishing = true;
          setSubmissionState("processing", navigator.onLine === false ? "Salvando neste aparelho. A sincronização ocorrerá quando a conexão voltar." : "Concluindo a venda…");
          const saleDraft = {
            id: attempt.saleId,
            businessId,
            spaceId,
            financialSpaceId: spaceId,
            clienteId,
            status,
            operationId: attempt.operationId,
            formaPagamento: paymentMethod,
            observacao: document.querySelector("#sale-note").value,
            itens: cart,
            ajusteManual: manual,
            descontoTipo: discountKind,
            appliedCampaignIds: [...selectedCampaignIds],
          };
          traceSale("[SALE] operation created", { operationId: attempt.operationId, saleId: attempt.saleId });
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
            if (status === "fiado")
              await window.SyncFirebase?.prepareCustomerForSale?.(clienteId);
            traceSale("[SALE] local write started", { operationId: attempt.operationId });
            sale = Repositories.saleRepository().create(saleDraft);
            if (status === "fiado" && navigator.onLine !== false)
              sale = await window.SyncFirebase.confirmCreditSale(sale);
            if (status === "fiado" && sale.status !== "fiado")
              sale = { ...sale, status: "fiado", formaPagamento: "fiado" };
          } catch (error) {
            finishing = false;
            const message = error.message || "Não foi possível concluir a venda. Seu carrinho foi preservado.";
            setSubmissionState("error", `${message} Toque em “Tentar novamente”.`);
            saveDraft();
            traceSale("[SALE] failed", { operationId: attempt.operationId, code: error?.code || error?.name || "unknown" });
            toast(message, true);
            return;
          }
          cart = [];
          selectedCampaignIds.clear();
          manual = false;
          discountKind = null;
          draftDetails = { clientId: "", paymentMethod: "pix", note: "", discountValue: "0", discountPercent: "0" };
          clearDraft();
          activeAttempt = null;
          finishing = false;
          const pendingSync = navigator.onLine === false || window.SyncFirebase?.isSalePending?.(sale);
          setSubmissionState("success", pendingSync
            ? "Venda salva no aparelho e aguardando sincronização."
            : "Venda concluída com sucesso.");
          refreshClients();
          closeCartSurface({ immediate: true });
          traceSale("[SALE] completed", { operationId: sale.operationId, saleId: sale.id, spaceId: sale.spaceId });
          try { Recibos.mostrar(sale, clienteId ? clients().getById(clienteId) : null); }
          catch { toast("Venda concluída. O recibo não pôde ser aberto, mas a venda foi salva.", true); }
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
    applyDraftDetails();
    drawCart();
    if (pendingClient) {
      const select = document.querySelector("#sale-client");
      if (select && clients().getById(pendingClient.clientId)) {
        select.value = pendingClient.clientId;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        document.querySelector("#product-search")?.focus();
      }
      pendingClient = null;
    }
    if (pendingRenewal) {
      const subscription = CustomerSubscriptions.get(pendingRenewal), product = subscription && products().getById(subscription.productId), variant = subscription?.variantId ? ProductVariations.get(subscription.variantId) : null;
      pendingRenewal = null;
      if (subscription && product) setTimeout(() => recurringConfiguration(product, variant), 0);
    }
    window.lucide?.createIcons();
  }
  function prepareClientSale(clientId, source = "client_swipe") {
    const client = clients().getById(clientId);
    if (!client) return (toast("Cliente não encontrado", true), false);
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
      select.value = clientId;
      select.dispatchEvent(new Event("change", { bubbles: true }));
      pendingClient = null;
      document.querySelector("#product-search")?.focus();
    } else Router.ir("vender");
    return true;
  }
  function resetSession() {
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
  function finalizeTerminalPayment(intent) {
    if (!intent?.saleDraft || intent.status !== "approved")
      throw Error("Pagamento ainda não foi aprovado.");
    const existing = Vendas.listar().find(
      (sale) => sale.operationId === intent.finalizationOperationId,
    );
    const sale = existing || Repositories.saleRepository().create({
      ...intent.saleDraft,
      id: intent.saleId,
      status: "pago",
      operationId: intent.finalizationOperationId,
      formaPagamento: "cartao_presencial",
      paymentIntentId: intent.id,
      paymentState: "paid",
      receivableStatus: "pending_settlement",
      paymentMetadata: {
        channel: "card_present",
        provider: intent.provider,
        terminalId: intent.terminalId,
        terminalNickname: intent.terminalNickname,
        method: intent.paymentMethod,
        installments: intent.installments,
        providerPaymentId: intent.providerPaymentId || null,
        providerOrderId: intent.providerOrderId || null,
      },
    });
    cart = [];
    selectedCampaignIds.clear();
    manual = false;
    discountKind = null;
    finishing = false;
    activeAttempt = null;
    draftDetails = { clientId: "", paymentMethod: "pix", note: "", discountValue: "0", discountPercent: "0" };
    clearDraft();
    window.CheckoutPaymentMethod = "cartao_presencial";
    const client = sale.clienteId ? clients().getById(sale.clienteId) : null;
    closeCartSurface({ immediate: true });
    traceSale("[SALE] completed", { operationId: sale.operationId, saleId: sale.id, spaceId: sale.spaceId, terminal: true });
    Recibos.mostrar(sale, client);
    return sale;
  }
  function prepareRenewal(subscriptionId) {
    const subscription = CustomerSubscriptions.get(subscriptionId);
    if (!subscription) return (toast("Renovação não encontrada", true), false);
    pendingRenewal = subscription.id;
    prepareClientSale(subscription.clientId, "customer_profile_renewal");
    if (Router.atual() === "vender" && document.querySelector("#sale-client")) {
      const product = products().getById(subscription.productId), variant = subscription.variantId ? ProductVariations.get(subscription.variantId) : null;
      pendingRenewal = null;
      if (product) recurringConfiguration(product, variant);
    }
    return true;
  }
  function mount() {
    if (Router.atual() !== "vender") return false;
    return window.AppPageRuntime?.mount?.("vender") || false;
  }
  addEventListener("firebase-session-cleared", resetSession);
  addEventListener("terminal-payment-retry-ready", () => {
    finishing = false;
    setSubmissionState("error", "A cobrança não foi concluída. Revise os dados e tente novamente.");
  });
  return {
    view,
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
    finalizeTerminalPayment,
    cartCount,
    state: () => ({ finishing, items: cartCount(), activeOperationId: activeAttempt?.operationId || null, draftKey: draftKey() }),
  };
})();
