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
  let soldByProduct = new Map();
  function rebuildSoldIndex() {
    const next = new Map();
    Repositories.saleRepository().list().forEach((sale) =>
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
    window.ProductVariations?.itemKey(item) || String(item?.produtoId || "");
  const priceLabel = (p) =>
    p.productType === "variable"
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
      p.productType === "variable" ? p.totalStock : p.estoqueAtual,
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
        p.productType === "variable"
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
    return `<button class="pos-product ${p.productType === "variable" ? "is-variable" : ""}" data-add="${p.id}" data-search="${escapar(norm([p.nome, p.codigo, p.barcode, p.categoria, p.palavrasChave, variantSearch].join(" ")))}" data-category="${escapar(norm(p.categoria))}" title="${escapar(p.nome)}"><span class="pos-qty" data-pos-qty="${p.id}" hidden>0</span>${p.favorito ? '<span class="pos-favorite" aria-label="Favorito">★</span>' : ""}${photo}<strong>${escapar(p.nome)}</strong><small class="pos-full-name">${p.productType === "variable" ? `${Number(p.activeVariationCount || 0)} opções` : escapar(p.categoria || p.nome)}</small><b>${priceLabel(p)}</b>${stock(p)}</button>`;
  };
  function view() {
    rebuildSoldIndex();
    const ps = products()
        .list()
        .filter((p) => p.ativo !== false),
      cs = clients()
        .list()
        .filter((c) => c.ativo !== false),
      cats = [...new Set(ps.map((p) => p.categoria).filter(Boolean))].sort();
    return `<div class="pos-page"><div class="pos-head"><h2>Nova venda</h2><p>Toque nos produtos para adicionar à sacola.</p></div><section class="pos-tools"><div class="pos-search-wrap"><i data-lucide="search"></i><input class="search" id="product-search" autocomplete="off" placeholder="Buscar produto, código ou categoria"><button class="icon-btn" id="clear-product-search"><i data-lucide="x"></i></button><button type="button" data-scan-sale aria-label="Ler código de barras"><i data-lucide="scan-barcode"></i></button></div><select id="pos-category"><option value="">Categorias</option>${cats.map((c) => `<option value="${escapar(norm(c))}">${escapar(c)}</option>`).join("")}</select><select id="pos-filter"><option value="todos">Todos</option><option value="favoritos">Favoritos</option><option value="estoque">Em estoque</option><option value="baixo">Estoque baixo</option></select><select id="pos-sort"><option value="favoritos">Favoritos primeiro</option><option value="nome">Nome</option><option value="vendidos">Mais vendidos</option><option value="categoria">Categoria</option><option value="preco">Preço</option></select></section><section class="pos-grid" id="pos-grid">${ps.map(card).join("") || '<div class="empty">Cadastre um produto primeiro</div>'}</section><section class="pos-summary" id="pos-summary" hidden><div class="pos-summary-head"><div><h3>Resumo da venda</h3><p>Revise os itens, cliente e pagamento.</p></div><button class="icon-btn" id="close-sale-summary"><i data-lucide="x"></i></button></div><div id="cart"></div><div class="discount-grid"><div class="field"><label>Desconto em R$</label><input id="discount-value" type="number" inputmode="decimal" min="0" step=".01" value="0"></div><div class="field"><label>Desconto em %</label><input id="discount-percent" type="number" inputmode="decimal" min="0" max="100" step=".01" value="0"></div></div><div class="field"><label>Valor final da venda</label><input id="manual-total" type="number" inputmode="decimal" min="0" step=".01" value="0"></div><div id="sale-totals"></div><div class="pos-client-card" id="selected-client-card"></div><select id="sale-client" class="visually-hidden"><option value="">Venda avulsa</option>${cs.map((c) => `<option value="${c.id}">${escapar(c.nome)}</option>`).join("")}</select><button class="btn btn-light pos-client-select" id="open-client-picker"><i data-lucide="users"></i><span>Selecionar cliente ou venda avulsa</span></button><div class="field"><label>Forma de pagamento</label><select id="sale-status"><option value="pago">Pago agora</option><option value="fiado">Fiado</option></select></div><div id="debt-preview"></div><div class="field"><label>Observação</label><textarea id="sale-note" placeholder="Opcional"></textarea></div><button class="btn btn-primary" id="finish-sale"><i data-lucide="check"></i> Concluir venda</button></section><button class="pos-bag" id="open-sale-summary"><i data-lucide="shopping-bag"></i><span id="pos-bag-label">Nenhum item selecionado</span><b id="pos-bag-total">${dinheiro(0)}</b><i data-lucide="chevron-up"></i></button></div>`;
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
      const previous = Number(e.dataset.quantity || 0);
      e.hidden = !q;
      e.dataset.quantity = String(q);
      if (previous !== q && window.MobileMotion) window.MobileMotion.counter(e, previous, q);
      else e.textContent = q;
      e.closest(".pos-product").classList.toggle("selected", !!q);
    });
    document.querySelector("#pos-bag-label").textContent = items
      ? `${items} ${items === 1 ? "item" : "itens"} · ${dinheiro(total)}`
      : "Nenhum item selecionado";
    document.querySelector("#pos-bag-total").textContent = dinheiro(total);
    selectedClient();
  }
  function selectedClient() {
    const sel = document.querySelector("#sale-client"),
      box = document.querySelector("#selected-client-card"),
      label = document.querySelector(".pos-client-select span"),
      c = sel.value ? clients().getById(sel.value) : null;
    if (!c) {
      label.textContent = "Selecionar cliente ou venda avulsa";
      box.innerHTML = '<span class="muted">Venda avulsa selecionada</span>';
      return;
    }
    const total = Number(document.querySelector("#manual-total").value || 0),
      fiado = document.querySelector("#sale-status").value === "fiado",
      deve = Math.abs(Math.min(0, Number(c.saldo || 0)));
    label.textContent = c.nome;
    box.innerHTML = `<div><small>Cliente</small><b>${escapar(c.nome)}</b><p>${balance(c)}</p>${fiado ? `<p class="pos-fiado-preview">Após esta venda: <b>${dinheiro(deve + total)} em aberto</b></p>` : ""}</div><div><button class="icon-btn" data-change-client><i data-lucide="repeat-2"></i></button>${somenteNumeros(c.telefone).length >= 10 ? `<button class="icon-btn" data-client-wa="${c.id}"><i data-lucide="message-circle"></i></button>` : ""}</div>`;
    window.lucide?.createIcons();
  }
  function filter() {
    const q = norm(document.querySelector("#product-search").value),
      cat = document.querySelector("#pos-category").value,
      f = document.querySelector("#pos-filter").value,
      sort = document.querySelector("#pos-sort").value;
    let cards = [...document.querySelectorAll(".pos-product")];
    cards.forEach((el) => {
      const p = products().getById(el.dataset.add),
        n = Number(p.estoqueAtual);
      el.hidden = !(
        (!q || el.dataset.search.includes(q)) &&
        (!cat || el.dataset.category === cat) &&
        (f === "todos" ||
          (f === "favoritos" && p.favorito) ||
          (f === "estoque" && (p.semControleEstoque || n > 0)) ||
          (f === "baixo" &&
            !p.semControleEstoque &&
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
      .forEach((el) => document.querySelector("#pos-grid").append(el));
    dispatchEvent(new CustomEvent("sale-products-filtered", { detail: { query: q, visible: cards.filter((card) => !card.hidden).length } }));
  }
  const row = (c) =>
    `<button class="client-choice" data-choose-client="${c.id}"><div><b>${escapar(c.nome)}</b><small>${escapar(c.telefone) || "Sem telefone"}${c.ultimaCompra ? ` · Última compra: ${new Date(c.ultimaCompra).toLocaleDateString("pt-BR")}` : ""}</small></div>${balance(c)}</button>`;
  function picker() {
    const all = clients()
        .list()
        .filter((c) => c.ativo !== false)
        .sort((a, b) => a.nome.localeCompare(b.nome)),
      recent = (DB.carregar().config.recentClientIds || [])
        .map((id) => all.find((c) => c.id === id))
        .filter(Boolean);
    document.querySelector("#modal").innerHTML =
      `<div class="modal-bg"><section class="modal-box client-picker"><header class="modal-head"><h3>Selecionar cliente</h3><button class="icon-btn close"><i data-lucide="x"></i></button></header><div class="client-search"><i data-lucide="search"></i><input id="client-picker-search" autofocus autocomplete="off" placeholder="Buscar por nome ou telefone"></div><div class="client-picker-body"><button class="client-choice guest" data-choose-client=""><div><b>Venda avulsa</b><small>Sem cliente vinculado</small></div><i data-lucide="user-round"></i></button><button class="btn btn-primary" id="quick-new-client"><i data-lucide="user-plus"></i> Novo cliente</button><div id="client-results">${recent.length ? `<h4>Clientes recentes</h4>${recent.map(row).join("")}` : ""}<h4>Todos os clientes</h4><div id="client-result-list">${all.slice(0, 30).map(row).join("")}</div><p class="muted" id="client-result-more">${all.length > 30 ? "Digite para filtrar a lista completa." : ""}</p></div></div></section></div>`;
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
      }
      if (e.target.closest("#quick-new-client")) quickClient();
    };
    window.lucide?.createIcons();
  }
  function quickClient() {
    document.querySelector("#modal").innerHTML =
      `<div class="modal-bg"><section class="modal-box"><header class="modal-head"><h3>Novo cliente</h3></header><form id="quick-client-form"><div class="modal-body"><div class="field"><label>Nome *</label><input name="nome" required autofocus></div><div class="field"><label>Telefone / WhatsApp</label><input name="telefone" inputmode="tel"></div><div class="field"><label>Observação</label><textarea name="observacoes"></textarea></div></div><footer class="modal-foot"><button type="button" class="btn btn-light cancel">Cancelar</button><button class="btn btn-primary">Salvar e selecionar</button></footer></form></section></div>`;
    document.querySelector(".cancel").onclick = picker;
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
    document.querySelector("#open-sale-summary").onclick = () => {
      document.querySelector("#pos-summary").hidden = false;
      document
        .querySelector("#pos-summary")
        .scrollIntoView({ behavior: "smooth" });
    };
    document.querySelector("#close-sale-summary").onclick = () => {
      document.querySelector("#pos-summary").hidden = true;
      scrollTo({ top: 0, behavior: "smooth" });
    };
    document.querySelector("#open-client-picker").onclick = picker;
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
    pendingClient = null,
    selectedCampaignIds = new Set();
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
    host.innerHTML = cart.length
      ? cart
          .map((i) => {
            const key = cartKey(i);
            return `<div class="cart-item editable-cart"><div><b>${escapar(i.nome)}</b><br><small>Original: ${dinheiro(i.precoOriginal)} · Custo: ${dinheiro(i.custoUnitario)}</small></div><label>Qtd.<input data-item-qty="${escapar(key)}" type="number" min="1" step="1" value="${i.quantidade}"></label><label>Preço final<input data-item-price="${escapar(key)}" type="number" inputmode="decimal" min="0" step=".01" value="${i.precoFinalUnitario.toFixed(2)}"></label><button class="icon-btn" data-remove="${escapar(key)}"><i data-lucide="trash-2"></i></button></div>`;
          })
          .join("")
      : '<div class="empty">Adicione produtos</div>';
    document.querySelector("#sale-totals").innerHTML =
      `<div class="summary-row"><span>Subtotal original</span><b>${dinheiro(t.original)}</b></div><div class="summary-row discount"><span>Desconto total</span><b>${dinheiro(t.discount)}</b></div><div class="summary-row total-row"><span>Valor final</span><b>${dinheiro(t.final)}</b></div><div class="summary-row private-value"><span>Custo total</span><b>${dinheiro(t.cost)}</b></div><div class="summary-row private-value"><span>Lucro estimado</span><b>${dinheiro(t.profit)}</b></div>`;
    document.querySelector("#manual-total").value = t.final.toFixed(2);
    drawCampaignBenefits();
    refresh();
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
    const key = cartKey(item),
      current = cart.find((entry) => cartKey(entry) === key),
      before = current ? Number(current.quantidade || 0) : 0;
    if (current) current.quantidade += Number(item.quantidade || 1);
    else cart.push(item);
    drawCart();
    dispatchEvent(new CustomEvent("sale-item-added", { detail: { item, before, after: before + Number(item.quantidade || 1), first: before === 0, source: options.source || null, variable: Boolean(item.variantId) } }));
  }
  async function variablePicker(product, preselectedVariantId = null, source = null) {
    const variants = await ProductVariations.ensure(product.id),
      modal = document.querySelector("#modal");
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
          const out = !variant.allowNegativeStock && Number(variant.stock) <= 0,
            q = quantities[variant.id] || 0;
          return `<article class="variation-picker-row ${out ? "out" : ""}">${window.ProductImages?.markup?.(product,{variant,className:"variation-picker-photo"}) || ""}<div><b>${escapar(ProductVariations.displayName(variant))}</b><small>${Object.entries(
            variant.attributeValues || {},
          )
            .map(([, value]) => escapar(value))
            .join(
              " · ",
            )}</small><strong>${dinheiro(variant.price)}</strong></div><span class="variation-stock">${out ? "Esgotado" : `Estoque: ${Number(variant.stock)} un.`}</span><div class="variation-qty"><button data-variant-dec="${variant.id}" ${q <= 0 ? "disabled" : ""}>−</button><b>${q}</b><button data-variant-inc="${variant.id}" ${out || (!variant.allowNegativeStock && q >= Number(variant.stock)) ? "disabled" : ""}>+</button></div></article>`;
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
    const search = document.querySelector("#product-search");
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
        fav.textContent = products().getById(fav.dataset.fav).favorito
          ? "★"
          : "☆";
        return;
      }
      const b = e.target.closest("[data-add]");
      if (!b) return;
      const p = products().getById(b.dataset.add);
      if (ProductVariations.isVariable(p)) {
        variablePicker(p, null, b);
        return;
      }
      const out = getProductStockStatus(p) === "esgotado" && !p.semControleEstoque && !p.allowNegativeStock;
      if (out) {
        window.MobileMotion?.feedback(b, "error");
        toast("Produto sem estoque.", true);
        dispatchEvent(new CustomEvent("sale-item-rejected", { detail: { productId: p.id, reason: "out-of-stock", source: b } }));
        return;
      }
      addSaleItem(ProductVariations.saleItem(p, null, 1), { source: b });
    };
    document.querySelector("#open-sale-summary").onclick = () => {
      document.querySelector("#pos-summary").hidden = false;
      document
        .querySelector("#pos-summary")
        .scrollIntoView({ behavior: "smooth" });
    };
    document.querySelector("#close-sale-summary").onclick = () => {
      document.querySelector("#pos-summary").hidden = true;
      scrollTo({ top: 0, behavior: "smooth" });
    };
    document.querySelector("#open-client-picker").onclick = picker;
    document.querySelector("#sale-client").onchange = () => {
      selectedCampaignIds.clear();
      drawCart();
    };
    document.querySelector("#sale-status").onchange = drawCart;
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
      drawCart();
    };
    document.querySelector("#cart").onclick = (e) => {
      const b = e.target.closest("[data-remove]");
      if (b) {
        cart = cart.filter((i) => cartKey(i) !== b.dataset.remove);
        drawCart();
      }
    };
    document.querySelector("#discount-value").onchange = (e) => {
      distribute(totals().original - Math.max(0, Number(e.target.value) || 0));
      discountKind = "valor";
      manual = false;
      selectedCampaignIds.clear();
      document.querySelector("#discount-percent").value = "0";
      drawCart();
    };
    document.querySelector("#discount-percent").onchange = (e) => {
      const n = Math.min(100, Math.max(0, Number(e.target.value) || 0));
      distribute(totals().original * (1 - n / 100));
      discountKind = "percentual";
      manual = false;
      selectedCampaignIds.clear();
      document.querySelector("#discount-value").value = "0";
      drawCart();
    };
    document.querySelector("#manual-total").onchange = (e) => {
      distribute(e.target.value);
      discountKind = "valor_final_manual";
      manual = true;
      selectedCampaignIds.clear();
      drawCart();
    };
    document.querySelector("#finish-sale").onclick = () => {
      if (finishing) return;
      if (!cart.length) return toast("Adicione ao menos um produto", true);
      const clienteId = document.querySelector("#sale-client").value || null,
        status = document.querySelector("#sale-status").value;
      if (status === "fiado" && !clienteId)
        return toast("Selecione um cliente para vender fiado", true);
      const client = clienteId ? clients().getById(clienteId) : null,
        operationId = crypto.randomUUID(),
        proceed = () => {
          if (finishing) return;
          finishing = true;
          document.querySelector("#finish-sale").disabled = true;
          const sale = Repositories.saleRepository().create({
            clienteId,
            status,
            operationId,
            observacao: document.querySelector("#sale-note").value,
            itens: cart,
            ajusteManual: manual,
            descontoTipo: discountKind,
            appliedCampaignIds: [...selectedCampaignIds],
          });
          cart = [];
          Recibos.mostrar(sale, client);
        };
      const missing = Vendas.estoqueInsuficiente(cart);
      if (
        missing.length &&
        !confirm(
          `Estoque insuficiente para: ${missing.map((x) => x.produto.nome).join(", ")}. Deseja continuar?`,
        )
      )
        return;
      proceed();
    };
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
    cart = [];
    discountKind = null;
    manual = false;
    finishing = false;
    pendingClient = null;
    selectedCampaignIds.clear();
  }
  function mount() {
    const paint = () => {
      if (Router.atual() !== "vender") return;
      if (window.DesktopSales?.isDesktop?.()) return;
      finishing = false;
      discountKind = null;
      manual = false;
      document.querySelector("#app").innerHTML = view();
      document.querySelector("#title").textContent = "Vender";
      standalone();
    };
    addEventListener("hashchange", () => setTimeout(paint, 0));
    setTimeout(paint, 0);
  }
  addEventListener("firebase-session-cleared", resetSession);
  return {
    view,
    enhance,
    mount,
    prepareClientSale,
    resetSession,
    openVariantPicker: variablePicker,
    addSaleItem,
    cartCount: () =>
      cart.reduce((sum, item) => sum + Number(item.quantidade || 0), 0),
  };
})();
