window.CatalogoUniversal = (() => {
  const VERSION = 1,
    now = () => new Date().toISOString();
  const token = () =>
    Array.from(crypto.getRandomValues(new Uint8Array(24)), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
  const defaults = () => ({
    enabled: true,
    visible: true,
    acceptingOrders: true,
    status: "active",
    closedBehavior: "view_only",
    operationMode: "store",
    scheduleMode: "always_open",
    timezone: "America/Sao_Paulo",
    acceptOutsideHours: false,
    hideProductsWhenClosed: false,
    stockBehavior: "show_sold_out",
    productSelectionMode: "all_active",
    selectedProductIds: [],
    selectedCategories: [],
    serviceModes: [
      {
        id: "pickup",
        type: "pickup",
        label: "Retirada",
        active: true,
        fee: 0,
        instructions: "",
      },
    ],
    weeklyHours: {},
    scheduledVisit: {
      local: "",
      date: "",
      arrivalTime: "",
      orderDeadline: "",
      instructions: "",
      meetingPoint: "",
      publicNote: "",
    },
    paymentMethods: ["entrega", "pix", "dinheiro", "cartao"],
    allowCredit: false,
    primaryColor: "#31d0ad",
    welcomeText: "Veja os produtos disponíveis e faça seu pedido.",
    shareMessage:
      "Confira nosso catálogo e faça seu pedido pelo link: {catalogUrl}",
    migrationVersion: 0,
  });
  function ensure() {
    const loaded = DB.carregar(),
      existing = loaded.config.catalogSettings || {};
    if (
      existing.publicToken &&
      Number(existing.migrationVersion || 0) >= VERSION
    )
      return { ...defaults(), ...existing };
    let result;
    DB.alterar((data) => {
      const current = { ...defaults(), ...(data.config.catalogSettings || {}) };
      if (!current.publicToken) {
        const legacy = [...(data.visitas || [])]
          .filter((v) => v.publicToken)
          .sort(
            (a, b) =>
              new Date(b.updatedAt || b.createdAt || 0) -
              new Date(a.updatedAt || a.createdAt || 0),
          )[0];
        current.publicToken = legacy?.publicToken || token();
      }
      if (Number(current.migrationVersion || 0) < VERSION) {
        const legacy = [...(data.visitas || [])].sort(
          (a, b) =>
            new Date(b.updatedAt || b.createdAt || 0) -
            new Date(a.updatedAt || a.createdAt || 0),
        )[0];
        if (legacy) {
          current.operationMode = "scheduled_visit";
          current.scheduledVisit = {
            ...current.scheduledVisit,
            local: legacy.local || "",
            date: legacy.data || "",
            arrivalTime: legacy.horarioChegada || "",
            orderDeadline: legacy.horarioLimite || "",
            publicNote: legacy.descricao || "",
          };
          current.selectedProductIds = (legacy.catalogItems || [])
            .filter((i) => i.active !== false)
            .map((i) => i.productId);
          current.productSelectionMode = current.selectedProductIds.length
            ? "selected"
            : "all_active";
          current.acceptingOrders = legacy.status === "recebendo";
          current.status = current.acceptingOrders ? "active" : "paused";
        }
        current.migrationVersion = VERSION;
        current.migratedAt = now();
      }
      data.config.catalogSettings = current;
      result = current;
    });
    return result;
  }
  const settings = () => ensure();
  const products = () => {
    const data = DB.carregar(),
      s = settings(),
      selected = new Set(s.selectedProductIds || []),
      categories = new Set(s.selectedCategories || []);
    return (data.produtos || [])
      .filter((p) => p.ativo !== false)
      .filter((p) =>
        s.productSelectionMode === "all_active" ||
        s.productSelectionMode === "in_stock"
          ? s.productSelectionMode !== "in_stock" ||
            p.semControleEstoque ||
            Number(
              p.productType === "variable" ? p.totalStock : p.estoqueAtual,
            ) > 0
          : s.productSelectionMode === "categories"
            ? categories.has(p.categoria || "Outros")
            : selected.has(p.id),
      );
  };
  const snapshot = (p, index) => {
    const variable = p.productType === "variable",
      variants = variable
        ? ProductVariations.active(p.id)
            .filter((v) => v.catalogVisible !== false)
            .map((v) => ({
              id: v.id,
              variantId: v.id,
              displayName: v.displayName,
              attributeValues: v.attributeValues,
              sku: v.sku,
              barcode: v.barcode,
              salePrice: Number(v.price),
              availableQuantity: Number(v.stock),
              active: v.active !== false,
              catalogVisible: v.catalogVisible !== false,
              allowNegativeStock: Boolean(v.allowNegativeStock),
              imageUrl:
                window.getProductDisplayImage?.(p, v)?.url || v.imageUrl || "",
            }))
        : [];
    const result = {
      id: `catalog-${p.id}`,
      productId: p.id,
      productType: variable ? "variable" : "simple",
      productName: p.nome,
      productImage:
        window.getProductDisplayImage?.(p)?.url ||
        p.imageThumbUrl ||
        p.imageUrl ||
        p.imagem ||
        "",
      productMainImage:
        window.getProductDisplayImage?.(p, null, { preferMain: true })?.url ||
        p.imageUrl ||
        p.imagem ||
        "",
      imageUpdatedAt: p.imageUpdatedAt || null,
      category: p.catalogCategory || p.categoria || "Outros",
      description: p.catalogDescription || p.descricao || p.palavrasChave || "",
      originalPrice: Number(variable ? p.minPrice : p.preco || 0),
      salePrice: Number(variable ? p.minPrice : p.preco || 0),
      minPrice: Number(variable ? p.minPrice : p.preco || 0),
      maxPrice: Number(variable ? p.maxPrice : p.preco || 0),
      availableQuantity: Number(variable ? p.totalStock : p.estoqueAtual || 0),
      variants,
      maxPerCustomer: 0,
      featured: Boolean(p.catalogFeatured || p.favorito),
      active: p.catalogVisible !== false,
      controlaEstoque: !p.semControleEstoque,
      displayOrder: Number(p.catalogSortOrder ?? index),
    };
    return window.CatalogPresentation?.decorate?.(p, result) || result;
  };
  function entity() {
    const data = DB.carregar(),
      s = settings(),
      business =
        window.BusinessContext?.get?.()?.business ||
        window.FirebaseSession?.business ||
        {};
    return {
      id: "catalog-universal",
      nome:
        s.publicName || business.name || data.config.nome || "Catálogo online",
      local: s.scheduledVisit?.local || "",
      descricao: s.welcomeText || "",
      data: s.scheduledVisit?.date || "",
      horarioChegada: s.scheduledVisit?.arrivalTime || "",
      horarioLimite: s.scheduledVisit?.orderDeadline || "",
      status: s.acceptingOrders ? "recebendo" : "pedidos_encerrados",
      publicToken: s.publicToken,
      catalogItems: products().map(snapshot),
      universal: true,
      catalogSettings: s,
      createdAt: s.migratedAt || now(),
      updatedAt: s.updatedAt || now(),
    };
  }
  async function publish() {
    await Promise.all(
      products()
        .filter((product) => ProductVariations.isVariable(product))
        .map((product) => ProductVariations.ensure(product.id)),
    );
    const catalog = entity();
    dispatchEvent(
      new CustomEvent("catalog-publish-request", {
        detail: { visit: catalog, universal: true },
      }),
    );
    return catalog;
  }
  function update(patch, { publishNow = true } = {}) {
    DB.alterar((data) => {
      data.config.catalogSettings = {
        ...defaults(),
        ...(data.config.catalogSettings || {}),
        ...patch,
        updatedAt: now(),
        migrationVersion: VERSION,
      };
    });
    const result = settings();
    if (publishNow) publish();
    dispatchEvent(
      new CustomEvent("catalog-settings-updated", {
        detail: { settings: result },
      }),
    );
    return result;
  }
  function link() {
    const url = new URL("./catalogo.html", location.href.split("#")[0]);
    url.searchParams.set("v", settings().publicToken);
    return url.href;
  }
  function legacyTokens() {
    const current = settings().publicToken;
    return [
      ...new Set(
        (DB.carregar().visitas || [])
          .map((v) => v.publicToken)
          .filter((value) => value && value !== current),
      ),
    ];
  }
  return {
    VERSION,
    defaults,
    ensure,
    settings,
    products,
    entity,
    publish,
    update,
    link,
    legacyTokens,
  };
})();

window.CatalogoUI = (() => {
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
      ),
    ico = (name) => `<i data-lucide="${name}"></i>`,
    money = (value) =>
      Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });
  const statusLabel = {
    active: "Catálogo recebendo pedidos",
    paused: "Pedidos pausados",
    scheduled: "Catálogo programado",
    closed: "Fora do horário de atendimento",
    maintenance: "Catálogo em manutenção",
  };
  function filePicker(label, name = "image") {
    return `<label class="mobile-file-picker"><span>${esc(label)}</span><input type="file" name="${esc(name)}" accept="image/jpeg,image/png,image/webp"><span class="mobile-file-picker-button">${ico("image-plus")} Escolher imagem</span><small data-file-name>Nenhuma imagem selecionada</small></label>`;
  }
  function bindFilePicker(root) {
    root.querySelectorAll('.mobile-file-picker input[type="file"]').forEach((input) => {
      input.addEventListener("change", () => {
        const status = input.closest(".mobile-file-picker")?.querySelector("[data-file-name]");
        if (status) status.textContent = input.files?.[0]?.name || "Nenhuma imagem selecionada";
      });
    });
  }
  function stats() {
    const today = new Date().toISOString().slice(0, 10),
      orders = (DB.carregar().catalogOrders || []).filter(
        (o) => String(o.createdAt || "").slice(0, 10) === today && !o.deletedAt,
      ),
      last = [...(DB.carregar().catalogOrders || [])].sort(
        (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0),
      )[0];
    return {
      count: orders.length,
      last: last?.createdAt
        ? new Date(last.createdAt).toLocaleString("pt-BR")
        : "Nenhum pedido",
    };
  }
  function bannerCards() {
    return (CatalogPresentation.settings().banners || []).filter((item) => !item.deletedAt).sort((a, b) => Number(a.order) - Number(b.order)).map((item) => `<article class="catalog-banner-row">${item.imageThumbUrl || item.imageUrl ? `<img src="${esc(item.imageThumbUrl || item.imageUrl)}" alt="">` : `<span>${ico("image")}</span>`}<div><b>${esc(item.title || "Banner sem título")}</b><small>${item.active === false ? "Inativo" : "Ativo"}${item.startsAt || item.endsAt ? ` · ${esc(item.startsAt || "agora")} a ${esc(item.endsAt || "sem limite")}` : ""}</small></div><button type="button" data-banner-move="-1" data-banner-id="${item.id}" aria-label="Mover para cima">${ico("arrow-up")}</button><button type="button" data-banner-move="1" data-banner-id="${item.id}" aria-label="Mover para baixo">${ico("arrow-down")}</button><button type="button" data-banner-edit="${item.id}">${ico("pencil")}</button><button type="button" data-banner-delete="${item.id}">${ico("trash-2")}</button></article>`).join("") || '<p class="catalog-note">Nenhum banner configurado. O catálogo continuará funcionando sem banner.</p>';
  }
  function categoryCards() {
    return CatalogPresentation.categories().map((item) => `<article class="catalog-category-row">${item.imageThumbUrl || item.imageUrl ? `<img src="${esc(item.imageThumbUrl || item.imageUrl)}" alt="">` : `<span>${ico("shapes")}</span>`}<div><b>${esc(item.publicName)}</b><small>Interno: ${esc(item.internalName)} · ${item.active === false ? "Oculta" : "Publicada"}</small></div><button type="button" data-category-move="-1" data-category-id="${esc(item.internalName)}">${ico("arrow-up")}</button><button type="button" data-category-move="1" data-category-id="${esc(item.internalName)}">${ico("arrow-down")}</button><button type="button" data-category-edit="${esc(item.internalName)}">${ico("pencil")}</button></article>`).join("");
  }
  function presentationProducts(products) {
    return products.map((product) => { const value = CatalogPresentation.product(product), image = value.imageMode === "catalog" ? value.imageThumbUrl || value.imageUrl : window.getProductDisplayImage?.(product)?.url || product.imageThumbUrl || product.imageUrl; return `<article class="catalog-product-row" data-catalog-product="${product.id}">${image ? `<img src="${esc(image)}" alt="">` : `<span>${esc(product.nome.slice(0, 2).toUpperCase())}</span>`}<div><b>${esc(value.publicName)}</b><small>${esc(value.category)} · ${money(value.price)} · ${value.imageMode === "catalog" ? "Foto exclusiva" : "Foto do produto"}</small></div><label class="catalog-inline-switch"><input type="checkbox" data-product-published="${product.id}" ${value.published !== false ? "checked" : ""}><span></span></label><button type="button" data-product-presentation="${product.id}">${ico("sliders-horizontal")}</button></article>`; }).join("") || '<p class="catalog-note">Nenhum produto cadastrado.</p>';
  }
  function render() {
    const s = CatalogoUniversal.settings(),
      p = DB.carregar().produtos.filter((x) => x.ativo !== false),
      selected = new Set(s.selectedProductIds || []),
      summary = stats(),
      url = CatalogoUniversal.link(),
      visit = ["scheduled_visit", "itinerant"].includes(s.operationMode);
    return `<section class="catalog-admin mobile-page">
    <header class="page-head catalog-admin-head mobile-section-header"><div><span class="eyebrow">Catálogo</span><h2>Seu catálogo online</h2><p>Produtos, categorias e pedidos em um único link.</p></div><button class="btn btn-primary mobile-button primary" data-catalog-preview>${ico("external-link")} Visualizar</button></header>
    <section class="catalog-status-card mobile-card status-${esc(s.status)}"><div class="catalog-status-copy"><span class="catalog-live-dot"></span><div><small>Catálogo</small><h3>${s.visible === false ? "Catálogo oculto" : "Catálogo ativo"}</h3><p>${esc(statusLabel[s.status] || statusLabel.paused)}</p></div></div><label class="catalog-main-switch"><input id="catalog-accepting" type="checkbox" ${s.acceptingOrders ? "checked" : ""}><span></span><b>Aceitando pedidos</b></label><div class="catalog-status-kpis"><span><b>${CatalogoUniversal.products().length}</b><small>Produtos</small></span><span><b>${CatalogPresentation.categories().filter((item) => item.active !== false).length}</b><small>Categorias</small></span><span><b>${summary.count}</b><small>Pedidos hoje</small></span></div><div class="catalog-link-row"><input value="${esc(url)}" readonly><button data-catalog-copy>${ico("copy")} Copiar link</button><button data-catalog-preview>${ico("external-link")} Abrir catálogo</button></div><div class="catalog-status-actions"><button type="button" class="mobile-button" data-catalog-copy>${ico("copy")} Copiar link</button><button type="button" class="mobile-button primary" data-catalog-preview>${ico("external-link")} Abrir catálogo</button></div><small>Último pedido: ${esc(summary.last)}</small></section>
    <nav class="catalog-admin-tabs" aria-label="Seções do catálogo">${[
      ["overview", "Visão geral"],
      ["banners", "Banners"],
      ["categories", "Categorias"],
      ["products", "Produtos"],
      ["availability", "Disponibilidade"],
      ["service", "Atendimento"],
      ["share", "Compartilhar"],
      ["appearance", "Aparência"],
      ["advanced", "Avançado"],
    ]
      .map(
        ([id, label]) =>
          `<button data-catalog-tab="${id}">${esc(label)}</button>`,
      )
      .join("")}</nav>
    <form id="catalog-settings-form"><section class="catalog-admin-grid">
      <article class="catalog-panel catalog-banner-panel mobile-card" data-catalog-section="banners"><header>${ico("gallery-horizontal-end")}<div><h3>Banner do catálogo</h3><p>Apresentação principal da sua vitrine.</p></div><button type="button" class="btn btn-light mobile-button" data-banner-new>${ico("pencil")} Editar</button></header><div class="catalog-editor-list">${bannerCards()}</div></article>
      <article class="catalog-panel catalog-category-panel mobile-card" data-catalog-section="categories"><header>${ico("shapes")}<div><h3>Categorias</h3><p>Ordem, nome público e imagem.</p></div><span class="catalog-see-all">Ver todas</span></header><div class="catalog-editor-list">${categoryCards()}</div></article>
      <article class="catalog-panel catalog-presentation-products mobile-card" data-catalog-section="products"><header>${ico("package-search")}<div><h3>Produtos publicados</h3><p>Controle o que o cliente vê.</p></div></header><label class="catalog-product-search mobile-search">${ico("search")}<input id="catalog-product-search" placeholder="Buscar produto"></label><div class="catalog-editor-list" id="catalog-presentation-product-list">${presentationProducts(p)}</div></article>
      <article class="catalog-panel" data-catalog-section="overview"><header>${ico("store")}<div><h3>Visão geral</h3><p>Como o catálogo aparece para seus clientes.</p></div></header><label>Nome público<input name="publicName" value="${esc(s.publicName || DB.carregar().config.nome || "")}"></label><label>Mensagem principal<textarea name="welcomeText">${esc(s.welcomeText || "")}</textarea></label><label class="toggle-row"><span>Catálogo visível<small>O link continua fixo mesmo quando estiver oculto.</small></span><input name="visible" type="checkbox" ${s.visible ? "checked" : ""}></label></article>
      <article class="catalog-panel" data-catalog-section="products"><header>${ico("package-check")}<div><h3>Produtos disponíveis</h3><p>Escolha o que será publicado.</p></div></header><label>Seleção<select name="productSelectionMode"><option value="all_active">Todos os produtos ativos</option><option value="in_stock">Todos os produtos em estoque</option><option value="selected">Selecionar manualmente</option></select></label><div class="catalog-product-picker">${p.map((product) => `<label><input type="checkbox" name="selectedProducts" value="${esc(product.id)}" ${selected.has(product.id) ? "checked" : ""}><span>${esc(product.nome)}</span><b>${money(product.preco)} · ${Number(product.estoqueAtual || 0)} un.</b></label>`).join("") || "<p>Nenhum produto cadastrado.</p>"}</div><label>Quando acabar o estoque<select name="stockBehavior"><option value="show_sold_out">Mostrar como esgotado</option><option value="hide">Ocultar automaticamente</option><option value="preorder">Aceitar encomenda</option><option value="allow_negative">Permitir pedido</option></select></label></article>
      <article class="catalog-panel" data-catalog-section="availability"><header>${ico("clock-3")}<div><h3>Disponibilidade</h3><p>Controle abertura e comportamento fora do horário.</p></div></header><label>Estado do catálogo<select name="status"><option value="active">Ativo</option><option value="paused">Pausado</option><option value="scheduled">Programado</option><option value="closed">Fechado</option><option value="maintenance">Manutenção</option></select></label><label>Funcionamento<select name="scheduleMode"><option value="always_open">Sempre aberto</option><option value="manual">Abrir e fechar manualmente</option><option value="weekly">Usar horários semanais</option><option value="period">Período específico</option></select></label><label>Quando pedidos estiverem pausados<select name="closedBehavior"><option value="view_only">Mostrar produtos sem finalizar</option><option value="unavailable">Mostrar somente aviso</option><option value="accept_for_later">Aceitar para processar depois</option></select></label><label class="toggle-row"><span>Aceitar fora do horário</span><input name="acceptOutsideHours" type="checkbox" ${s.acceptOutsideHours ? "checked" : ""}></label><label>Fuso horário<input name="timezone" value="${esc(s.timezone)}" readonly></label></article>
      <article class="catalog-panel" data-catalog-section="service"><header>${ico("truck")}<div><h3>Atendimento e entrega</h3><p>Defina como os pedidos serão recebidos.</p></div></header><label>Tipo de operação<select name="operationMode"><option value="store">Loja física</option><option value="pickup">Retirada</option><option value="delivery">Entrega</option><option value="scheduled_visit">Visita programada</option><option value="itinerant">Atendimento itinerante</option><option value="custom">Personalizado</option></select></label><div class="scheduled-fields ${visit ? "show" : ""}"><label>Local<input name="visitLocal" value="${esc(s.scheduledVisit?.local || "")}"></label><label>Data<input name="visitDate" type="date" value="${esc(s.scheduledVisit?.date || "")}"></label><label>Chegada prevista<input name="arrivalTime" type="time" value="${esc(s.scheduledVisit?.arrivalTime || "")}"></label><label>Pedidos até<input name="orderDeadline" type="time" value="${esc(s.scheduledVisit?.orderDeadline || "")}"></label><label>Mensagem pública<textarea name="visitNote">${esc(s.scheduledVisit?.publicNote || "")}</textarea></label></div><fieldset><legend>Formas disponíveis</legend>${[
        ["pickup", "Retirada"],
        ["delivery", "Entrega"],
        ["store", "Loja física"],
        ["onsite", "Atendimento no local"],
      ]
        .map(
          ([type, label]) =>
            `<label class="check-row"><input type="checkbox" name="serviceModes" value="${type}" ${(s.serviceModes || []).some((x) => x.type === type && x.active !== false) ? "checked" : ""}>${label}</label>`,
        )
        .join("")}</fieldset></article>
      <article class="catalog-panel" data-catalog-section="share"><header>${ico("share-2")}<div><h3>Compartilhe seu catálogo</h3><p>O mesmo link funciona todos os dias.</p></div></header><div class="catalog-share-url">${esc(url)}</div><label>Mensagem padrão<textarea name="shareMessage">${esc(s.shareMessage || "")}</textarea></label><div class="catalog-share-actions"><button type="button" class="btn btn-light" data-catalog-copy>${ico("copy")} Copiar link</button><button type="button" class="btn btn-light" data-catalog-whatsapp>${ico("message-circle")} WhatsApp</button><button type="button" class="btn btn-light" data-catalog-qr>${ico("qr-code")} QR Code</button></div></article>
      <article class="catalog-panel" data-catalog-section="appearance"><header>${ico("palette")}<div><h3>Aparência</h3><p>Identidade da empresa no portal.</p></div></header><label>Cor principal<input name="primaryColor" type="color" value="${esc(s.primaryColor || "#31d0ad")}"></label><p class="catalog-note">A logo e o nome utilizam os dados da empresa logada. Nenhuma informação fica fixa como Adi Festa.</p></article>
      <article class="catalog-panel" data-catalog-section="advanced"><header>${ico("settings-2")}<div><h3>Configurações avançadas</h3><p>Compatibilidade e diagnóstico.</p></div></header><dl class="catalog-tech"><dt>Token permanente</dt><dd>${esc(s.publicToken.slice(0, 8))}…</dd><dt>Migração</dt><dd>v${s.migrationVersion}</dd><dt>Links antigos preservados</dt><dd>${CatalogoUniversal.legacyTokens().length}</dd></dl><button type="button" class="btn btn-light" data-catalog-publish>${ico("cloud-upload")} Republicar agora</button></article>
    </section><footer class="catalog-save-bar"><span>Alterações são salvas localmente e sincronizadas.</span><button class="btn btn-primary">Salvar e publicar</button></footer></form></section>`;
  }
  function copyLink() {
    navigator.clipboard
      ?.writeText(CatalogoUniversal.link())
      .then(() => Utils.toast("Link do catálogo copiado."))
      .catch(() => prompt("Copie o link:", CatalogoUniversal.link()));
  }
  function qr() {
    const url = CatalogoUniversal.link(),
      modal = document.querySelector("#modal");
    modal.innerHTML = `<div class="modal-bg"><section class="modal-box catalog-qr-modal"><header class="modal-head"><div><h3>QR Code do catálogo</h3><small>O código aponta para o link permanente.</small></div><button class="icon-btn close">${ico("x")}</button></header><div class="modal-body"><div id="catalog-qr"></div><p>${esc(url)}</p></div><footer class="modal-foot"><button class="btn btn-light close">Fechar</button><button class="btn btn-primary" id="download-catalog-qr">Baixar PNG</button></footer></section></div>`;
    const target = modal.querySelector("#catalog-qr");
    if (window.qrcode) {
      const code = window.qrcode(0, "M");
      code.addData(url);
      code.make();
      target.innerHTML = code.createImgTag(6, 12, "QR Code do catálogo");
    } else
      target.innerHTML =
        "<p>Gerador indisponível. Use o botão Copiar link.</p>";
    modal
      .querySelectorAll(".close")
      .forEach((b) => (b.onclick = () => (modal.innerHTML = "")));
    modal.querySelector("#download-catalog-qr").onclick = () => {
      const image = target.querySelector("img");
      if (!image) return copyLink();
      const a = document.createElement("a");
      a.href = image.src;
      a.download = "qr-code-catalogo.png";
      a.click();
    };
    window.lucide?.createIcons();
  }
  async function uploadCatalogImage(scope, id, file, old) {
    if (!file) return {};
    if (!window.ProductImages?.processImage || !window.CatalogImageStorage) throw Error("O serviço de imagens ainda está carregando.");
    const processed = await ProductImages.processImage(file);
    return window.CatalogImageStorage.upload(scope, id, processed, old);
  }
  async function removeCatalogImage(scope, id, old) {
    if (!window.CatalogImageStorage?.remove) throw Error("O serviço de imagens ainda está carregando.");
    return window.CatalogImageStorage.remove(scope, id, old);
  }
  function bannerEditor(id = "") {
    const old = (CatalogPresentation.settings().banners || []).find((item) => item.id === id) || { id: id || Utils.uuid(), active: true }, modal = document.querySelector("#modal");
    modal.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal catalog-editor-modal"><header class="modal-head"><div><h3>${id ? "Editar" : "Novo"} banner</h3><small>Atualize a imagem e o período de exibição.</small></div><button class="icon-btn mobile-icon-button close" aria-label="Fechar">${ico("x")}</button></header><form id="catalog-banner-form"><div class="modal-body"><label>Título<input name="title" value="${esc(old.title || "")}" required></label><label>Texto curto<input name="subtitle" value="${esc(old.subtitle || "")}"></label><label>Ação ou link opcional<input name="actionUrl" value="${esc(old.actionUrl || "")}" placeholder="https://..."></label><div class="form-grid"><label>Início<input type="date" name="startsAt" value="${esc(old.startsAt || "")}"></label><label>Fim<input type="date" name="endsAt" value="${esc(old.endsAt || "")}"></label></div><label class="mobile-check"><input type="checkbox" name="active" ${old.active !== false ? "checked" : ""}><span class="mobile-check-mark"></span><span>Banner ativo</span></label>${old.imageUrl ? `<img class="catalog-editor-preview" src="${esc(old.imageUrl)}" alt="Prévia do banner">` : ""}${filePicker("Imagem do banner")}</div><footer class="modal-foot"><button type="button" class="btn btn-light mobile-button close">Cancelar</button><button class="btn btn-primary mobile-button primary">Salvar banner</button></footer></form></section></div>`;
    modal.querySelectorAll(".close").forEach((button) => button.onclick = () => modal.innerHTML = "");
    bindFilePicker(modal);
    modal.querySelector("form").onsubmit = async (event) => { event.preventDefault(); const button = event.submitter, fd = new FormData(event.currentTarget); button.disabled = true; try { const image = await uploadCatalogImage("banner", old.id, fd.get("image")?.size ? fd.get("image") : null, old), saved = CatalogPresentation.saveBanner({ ...old, ...image, title: fd.get("title").trim(), subtitle: fd.get("subtitle").trim(), actionUrl: fd.get("actionUrl").trim(), startsAt: fd.get("startsAt") || null, endsAt: fd.get("endsAt") || null, active: fd.has("active") }); modal.innerHTML = ""; Utils.toast("Banner salvo e publicado."); location.hash = "#/catalogo"; dispatchEvent(new HashChangeEvent("hashchange")); return saved; } catch (error) { Utils.toast(error.message, true); button.disabled = false; } };
    window.lucide?.createIcons();
  }
  function categoryEditor(key) {
    const old = CatalogPresentation.categories().find((item) => item.internalName === key), modal = document.querySelector("#modal"); if (!old) return;
    modal.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal catalog-editor-modal"><header class="modal-head"><div><h3>Editar categoria</h3><small>${esc(old.internalName)} · personalização pública</small></div><button class="icon-btn mobile-icon-button close" aria-label="Fechar">${ico("x")}</button></header><form><div class="modal-body"><label>Nome no catálogo<input name="publicName" value="${esc(old.publicName)}" required></label><label class="mobile-check"><input type="checkbox" name="active" ${old.active !== false ? "checked" : ""}><span class="mobile-check-mark"></span><span>Mostrar no catálogo</span></label>${old.imageUrl ? `<img class="catalog-editor-preview" src="${esc(old.imageUrl)}" alt="Prévia da categoria"><label class="mobile-check"><input type="checkbox" name="removeImage"><span class="mobile-check-mark"></span><span>Remover imagem própria</span></label>` : ""}${filePicker("Imagem da categoria")}</div><footer class="modal-foot"><button type="button" class="btn btn-light mobile-button close">Cancelar</button><button class="btn btn-primary mobile-button primary">Salvar categoria</button></footer></form></section></div>`;
    modal.querySelectorAll(".close").forEach((button) => button.onclick = () => modal.innerHTML = "");
    bindFilePicker(modal);
    modal.querySelector("form").onsubmit = async (event) => { event.preventDefault(); const button = event.submitter, fd = new FormData(event.currentTarget); button.disabled = true; try { let image = {}; const entityId = encodeURIComponent(key), file = fd.get("image"); if (file?.size) image = await uploadCatalogImage("category", entityId, file, old); else if (fd.has("removeImage")) { await removeCatalogImage("category", entityId, old); image = { imageUrl: "", imageThumbUrl: "", imageStoragePath: "", imageThumbStoragePath: "", imageUpdatedAt: new Date().toISOString() }; } CatalogPresentation.saveCategory(key, { ...image, publicName: fd.get("publicName").trim(), active: fd.has("active") }); modal.innerHTML = ""; Utils.toast("Categoria atualizada."); dispatchEvent(new HashChangeEvent("hashchange")); } catch (error) { Utils.toast(error.message, true); button.disabled = false; } };
    window.lucide?.createIcons();
  }
  function productEditor(id) {
    const product = DB.carregar().produtos.find((item) => item.id === id); if (!product) return; const old = CatalogPresentation.product(product), modal = document.querySelector("#modal"), categories = CatalogPresentation.categories();
    modal.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal catalog-editor-modal"><header class="modal-head"><div><h3>Editar produto</h3><small>${esc(product.nome)} · apresentação no catálogo</small></div><button class="icon-btn mobile-icon-button close" aria-label="Fechar">${ico("x")}</button></header><form><div class="modal-body"><label class="mobile-check"><input type="checkbox" name="published" ${old.published !== false ? "checked" : ""}><span class="mobile-check-mark"></span><span>Produto publicado</span></label><label>Nome público<input name="publicName" value="${esc(old.publicName)}" required></label><label>Descrição pública<textarea name="description">${esc(old.description)}</textarea></label><div class="form-grid"><label>Preço exibido<input name="price" inputmode="decimal" value="${String(old.price).replace(".", ",")}"></label><label>Categoria pública<select name="category">${categories.map((item) => `<option value="${esc(item.internalName)}" ${item.internalName === old.category ? "selected" : ""}>${esc(item.publicName)}</option>`).join("")}</select></label></div><label>Imagem<select name="imageMode"><option value="product">Usar imagem do produto</option><option value="catalog">Usar imagem exclusiva do catálogo</option></select></label>${old.imageUrl ? `<img class="catalog-editor-preview" src="${esc(old.imageUrl)}" alt="Prévia do produto">` : ""}${filePicker("Nova imagem exclusiva") }<label class="mobile-check"><input type="checkbox" name="featured" ${old.featured ? "checked" : ""}><span class="mobile-check-mark"></span><span>Produto em destaque</span></label></div><footer class="modal-foot"><button type="button" class="btn btn-light mobile-button close">Cancelar</button><button class="btn btn-primary mobile-button primary">Salvar apresentação</button></footer></form></section></div>`;
    modal.querySelector('[name="imageMode"]').value = old.imageMode;
    modal.querySelectorAll(".close").forEach((button) => button.onclick = () => modal.innerHTML = "");
    bindFilePicker(modal);
    modal.querySelector("form").onsubmit = async (event) => { event.preventDefault(); const button = event.submitter, fd = new FormData(event.currentTarget); button.disabled = true; try { const file = fd.get("image"), requestedMode = file?.size ? "catalog" : fd.get("imageMode"); let image = {}; if (file?.size) image = await uploadCatalogImage("product", id, file, old); else if (requestedMode === "product" && (old.imageStoragePath || old.imageThumbStoragePath)) { await removeCatalogImage("product", id, old); image = { imageUrl: "", imageThumbUrl: "", imageStoragePath: "", imageThumbStoragePath: "", imageUpdatedAt: new Date().toISOString() }; } const rawPrice = String(fd.get("price") || "").trim(), price = rawPrice.includes(",") ? Number(rawPrice.replace(/\./g, "").replace(",", ".")) : Number(rawPrice); CatalogPresentation.saveProduct(id, { ...image, published: fd.has("published"), publicName: fd.get("publicName").trim(), description: fd.get("description").trim(), price: Number.isFinite(price) ? price : Number(product.preco || 0), category: fd.get("category"), imageMode: requestedMode, featured: fd.has("featured") }); modal.innerHTML = ""; Utils.toast("Produto atualizado no catálogo."); dispatchEvent(new HashChangeEvent("hashchange")); } catch (error) { Utils.toast(error.message, true); button.disabled = false; } };
    window.lucide?.createIcons();
  }
  function bind() {
    const root = document.querySelector(".catalog-admin"),
      form = document.querySelector("#catalog-settings-form");
    if (!root || !form) return;
    const s = CatalogoUniversal.settings();
    [
      "productSelectionMode",
      "status",
      "scheduleMode",
      "closedBehavior",
      "operationMode",
      "stockBehavior",
    ].forEach((name) => {
      if (form.elements[name]) form.elements[name].value = s[name];
    });
    const syncVisit = () =>
      root
        .querySelector(".scheduled-fields")
        ?.classList.toggle(
          "show",
          ["scheduled_visit", "itinerant"].includes(
            form.elements.operationMode.value,
          ),
        );
    form.elements.operationMode.onchange = syncVisit;
    root.querySelector("#catalog-accepting").onchange = (event) =>
      CatalogoUniversal.update({
        acceptingOrders: event.target.checked,
        status: event.target.checked ? "active" : "paused",
      });
    root
      .querySelectorAll("[data-catalog-copy]")
      .forEach((b) => (b.onclick = copyLink));
    root
      .querySelectorAll("[data-catalog-preview]")
      .forEach(
        (b) =>
          (b.onclick = () =>
            open(CatalogoUniversal.link(), "_blank", "noopener")),
      );
    root.querySelector("[data-catalog-whatsapp]").onclick = () => {
      const message = (
        form.elements.shareMessage.value ||
        "Confira nosso catálogo: {catalogUrl}"
      )
        .replaceAll("{catalogUrl}", CatalogoUniversal.link())
        .replaceAll("{local}", form.elements.visitLocal.value || "")
        .replaceAll("{horario}", form.elements.arrivalTime.value || "");
      open(
        `https://wa.me/?text=${encodeURIComponent(message)}`,
        "_blank",
        "noopener",
      );
    };
    root.querySelector("[data-catalog-qr]").onclick = qr;
    root.querySelector("[data-catalog-publish]").onclick = () => {
      CatalogoUniversal.publish();
      Utils.toast("Publicação enviada para a nuvem.");
    };
    root.querySelector("[data-banner-new]")?.addEventListener("click", () => bannerEditor());
    root.querySelectorAll("[data-banner-edit]").forEach((button) => button.onclick = () => bannerEditor(button.dataset.bannerEdit));
    root.querySelectorAll("[data-banner-move]").forEach((button) => button.onclick = () => { CatalogPresentation.moveBanner(button.dataset.bannerId, Number(button.dataset.bannerMove)); dispatchEvent(new HashChangeEvent("hashchange")); });
    root.querySelectorAll("[data-banner-delete]").forEach((button) => button.onclick = async () => { if (!confirm("Excluir este banner?")) return; const item = CatalogPresentation.settings().banners.find((entry) => entry.id === button.dataset.bannerDelete); try { await window.CatalogImageStorage?.remove?.("banner", item.id, item); CatalogPresentation.removeBanner(item.id); dispatchEvent(new HashChangeEvent("hashchange")); } catch (error) { Utils.toast(error.message, true); } });
    root.querySelectorAll("[data-category-edit]").forEach((button) => button.onclick = () => categoryEditor(button.dataset.categoryEdit));
    root.querySelectorAll("[data-category-move]").forEach((button) => button.onclick = () => { CatalogPresentation.moveCategory(button.dataset.categoryId, Number(button.dataset.categoryMove)); dispatchEvent(new HashChangeEvent("hashchange")); });
    root.querySelectorAll("[data-product-presentation]").forEach((button) => button.onclick = () => productEditor(button.dataset.productPresentation));
    root.querySelectorAll("[data-product-published]").forEach((input) => input.onchange = () => CatalogPresentation.saveProduct(input.dataset.productPublished, { published: input.checked }));
    root.querySelector("#catalog-product-search")?.addEventListener("input", (event) => { const query = event.target.value.trim().toLocaleLowerCase("pt-BR"); root.querySelectorAll("[data-catalog-product]").forEach((row) => row.hidden = query && !row.textContent.toLocaleLowerCase("pt-BR").includes(query)); });
    root
      .querySelectorAll("[data-catalog-tab]")
      .forEach(
        (button) =>
          (button.onclick = () =>
            root
              .querySelector(
                `[data-catalog-section="${button.dataset.catalogTab}"]`,
              )
              ?.scrollIntoView({ behavior: "smooth", block: "start" })),
      );
    form.onsubmit = (event) => {
      event.preventDefault();
      const fd = new FormData(form),
        mode = fd.get("operationMode"),
        serviceModes = fd
          .getAll("serviceModes")
          .map((type) => ({
            id: type,
            type,
            label: {
              pickup: "Retirada",
              delivery: "Entrega",
              store: "Loja física",
              onsite: "Atendimento no local",
            }[type],
            active: true,
            fee: 0,
            instructions: "",
          }));
      CatalogoUniversal.update({
        publicName: String(fd.get("publicName") || "").trim(),
        welcomeText: String(fd.get("welcomeText") || "").trim(),
        visible: fd.has("visible"),
        productSelectionMode: fd.get("productSelectionMode"),
        selectedProductIds: fd.getAll("selectedProducts"),
        stockBehavior: fd.get("stockBehavior"),
        status: fd.get("status"),
        scheduleMode: fd.get("scheduleMode"),
        closedBehavior: fd.get("closedBehavior"),
        acceptOutsideHours: fd.has("acceptOutsideHours"),
        operationMode: mode,
        serviceModes,
        scheduledVisit: {
          ...s.scheduledVisit,
          local: String(fd.get("visitLocal") || "").trim(),
          date: fd.get("visitDate") || "",
          arrivalTime: fd.get("arrivalTime") || "",
          orderDeadline: fd.get("orderDeadline") || "",
          publicNote: String(fd.get("visitNote") || "").trim(),
        },
        shareMessage: String(fd.get("shareMessage") || "").trim(),
        primaryColor: fd.get("primaryColor") || "#31d0ad",
      });
      Utils.toast("Catálogo salvo e publicado.");
      location.hash = "#/catalogo";
    };
    window.lucide?.createIcons();
  }
  return { render, bind };
})();
