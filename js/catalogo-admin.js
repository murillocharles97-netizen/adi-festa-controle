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
              imageUrl: v.imageUrl || "",
            }))
        : [];
    return {
      id: `catalog-${p.id}`,
      productId: p.id,
      productType: variable ? "variable" : "simple",
      productName: p.nome,
      productImage: p.imageThumbUrl || p.imageUrl || p.imagem || "",
      productMainImage: p.imageUrl || p.imagem || "",
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
  function render() {
    const s = CatalogoUniversal.settings(),
      p = DB.carregar().produtos.filter((x) => x.ativo !== false),
      selected = new Set(s.selectedProductIds || []),
      summary = stats(),
      url = CatalogoUniversal.link(),
      visit = ["scheduled_visit", "itinerant"].includes(s.operationMode);
    return `<section class="catalog-admin">
    <header class="page-head catalog-admin-head"><div><span class="eyebrow">Link permanente</span><h2>Catálogo Online</h2><p>Produtos, pedidos e benefícios em um único link para seus clientes.</p></div><button class="btn btn-primary" data-catalog-preview>${ico("external-link")} Visualizar como cliente</button></header>
    <section class="catalog-status-card status-${esc(s.status)}"><div class="catalog-status-copy"><span class="catalog-live-dot"></span><div><small>Status atual</small><h3>${esc(statusLabel[s.status] || statusLabel.paused)}</h3><p>${CatalogoUniversal.products().length} produtos públicos · ${summary.count} pedidos hoje</p></div></div><label class="catalog-main-switch"><input id="catalog-accepting" type="checkbox" ${s.acceptingOrders ? "checked" : ""}><span></span><b>Aceitar pedidos agora</b></label><div class="catalog-link-row"><input value="${esc(url)}" readonly><button data-catalog-copy>${ico("copy")} Copiar</button><button data-catalog-preview>${ico("eye")} Abrir</button></div><small>Último pedido: ${esc(summary.last)}</small></section>
    <nav class="catalog-admin-tabs" aria-label="Seções do catálogo">${[
      ["overview", "Visão geral"],
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
