(function () {
  "use strict";

  const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]),
    MAX_SOURCE_BYTES = 10 * 1024 * 1024,
    MAIN_MAX_DIMENSION = 1200,
    THUMB_MAX_DIMENSION = 420,
    MAIN_QUALITY = 0.82,
    THUMB_QUALITY = 0.78;
  const $ = (selector, root = document) => root.querySelector(selector),
    esc = (value) =>
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
  const initials = (name) =>
    String(name || "?")
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((part) => part[0])
      .join("")
      .toUpperCase();
  const timestamp = (value) => {
    if (!value) return "";
    if (typeof value?.toDate === "function") return value.toDate().getTime();
    return new Date(value).getTime() || String(value);
  };
  function versionedUrl(url, updatedAt) {
    if (!url || !updatedAt) return url || "";
    if (/^(?:blob:|data:)/i.test(String(url))) return url;
    try {
      const parsed = new URL(url, location.href);
      parsed.searchParams.set("v", String(timestamp(updatedAt)));
      return parsed.href;
    } catch {
      return url;
    }
  }
  function ownImage(subject, preferMain = false) {
    const image = subject?.image && typeof subject.image === "object" ? subject.image : {};
    const url = preferMain
      ? image.url || subject?.imageUrl || subject?.imagem || ""
      : image.thumbnailUrl ||
        subject?.imageThumbUrl ||
        image.url ||
        subject?.imageUrl ||
        subject?.imagem ||
        "";
    return {
      url,
      updatedAt: image.updatedAt || subject?.imageUpdatedAt || null,
      storagePath: preferMain
        ? image.storagePath || subject?.imageStoragePath || null
        : image.thumbnailStoragePath ||
          subject?.imageThumbStoragePath ||
          image.storagePath ||
          subject?.imageStoragePath ||
          null,
      hasOwnImage: Boolean(url),
    };
  }
  function getProductDisplayImage(product, variant = null, options = {}) {
    const preferMain = Boolean(options.preferMain),
      variantImage = variant?.imageMode === "inherit" ? { url: "" } : ownImage(variant, preferMain),
      productImage = ownImage(product, preferMain),
      chosen = variantImage.url ? variantImage : productImage,
      name =
        options.alt ||
        (variant
          ? `${product?.nome || product?.productName || "Produto"} — ${variant.displayName || variant.nome || "Variação"}`
          : product?.nome || product?.productName || "Produto");
    return {
      url: versionedUrl(chosen.url, chosen.updatedAt),
      rawUrl: chosen.url || "",
      storagePath: chosen.storagePath || null,
      updatedAt: chosen.updatedAt || null,
      inherited: Boolean(variant && !variantImage.url && productImage.url),
      own: Boolean(variant ? variantImage.url : productImage.url),
      initials: initials(variant?.displayName || name),
      alt: name,
    };
  }
  const source = (product, variant = null, preferMain = false) =>
    getProductDisplayImage(product, variant, { preferMain }).url;
  function markup(product, options = {}) {
    const display = getProductDisplayImage(product, options.variant || null, options),
      className = options.className || "product-photo";
    return `<span class="${esc(className)} product-photo-shell ${display.url ? "is-loading" : "is-fallback"}">${
      display.url
        ? `<img src="${esc(display.url)}" alt="${esc(display.alt)}" loading="lazy" decoding="async" onload="this.parentElement.classList.remove('is-loading')" onerror="this.hidden=true;this.parentElement.classList.remove('is-loading');this.parentElement.classList.add('is-fallback');this.nextElementSibling.hidden=false">`
        : ""
    }<span class="product-photo-fallback" ${display.url ? "hidden" : ""}>${esc(display.initials)}</span></span>`;
  }
  function validate(file) {
    if (!file) throw Error("Escolha uma imagem para continuar.");
    const type = String(file.type || "").toLowerCase(),
      heic = /heic|heif/i.test(type) || /\.(heic|heif)$/i.test(file.name || "");
    if (heic)
      throw Error(
        "Este aparelho não conseguiu converter a foto HEIC. Escolha JPG, PNG ou WebP.",
      );
    if (!ACCEPTED_TYPES.has(type))
      throw Error("Formato não suportado. Escolha uma imagem JPG, PNG ou WebP.");
    if (Number(file.size || 0) > MAX_SOURCE_BYTES)
      throw Error("A imagem é muito grande. Escolha uma foto menor que 10 MB.");
    return true;
  }
  async function decode(file) {
    validate(file);
    try {
      if ("createImageBitmap" in window)
        return await createImageBitmap(file, { imageOrientation: "from-image" });
    } catch (error) {
      console.info("[Product image] createImageBitmap indisponível", {
        name: error?.name,
      });
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file),
        image = new Image();
      image.onload = () => {
        URL.revokeObjectURL(url);
        resolve(image);
      };
      image.onerror = () => {
        URL.revokeObjectURL(url);
        reject(Error("Não foi possível ler esta imagem neste aparelho."));
      };
      image.src = url;
    });
  }
  const toBlob = (canvas, type, quality) =>
    new Promise((resolve) => canvas.toBlob(resolve, type, quality));
  function dimensions(image, maximum) {
    const width = Number(image.width || image.naturalWidth || 0),
      height = Number(image.height || image.naturalHeight || 0),
      scale = Math.min(1, maximum / Math.max(width, height, 1));
    return {
      width: Math.max(1, Math.round(width * scale)),
      height: Math.max(1, Math.round(height * scale)),
    };
  }
  function render(image, maximum) {
    const size = dimensions(image, maximum),
      canvas = document.createElement("canvas");
    canvas.width = size.width;
    canvas.height = size.height;
    const context = canvas.getContext("2d", { alpha: false });
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, size.width, size.height);
    context.drawImage(image, 0, 0, size.width, size.height);
    return { canvas, ...size };
  }
  async function processImage(file) {
    const image = await decode(file),
      main = render(image, MAIN_MAX_DIMENSION),
      thumb = render(image, THUMB_MAX_DIMENSION);
    let contentType = "image/webp",
      extension = "webp",
      mainBlob = await toBlob(main.canvas, contentType, MAIN_QUALITY),
      thumbBlob = await toBlob(thumb.canvas, contentType, THUMB_QUALITY);
    if (!mainBlob || !thumbBlob || mainBlob.type !== "image/webp") {
      contentType = "image/jpeg";
      extension = "jpg";
      mainBlob = await toBlob(main.canvas, contentType, 0.84);
      thumbBlob = await toBlob(thumb.canvas, contentType, 0.8);
    }
    image.close?.();
    if (!mainBlob || !thumbBlob)
      throw Error("Não foi possível otimizar esta imagem.");
    return {
      mainBlob,
      thumbBlob,
      width: main.width,
      height: main.height,
      thumbWidth: thumb.width,
      thumbHeight: thumb.height,
      size: mainBlob.size,
      thumbSize: thumbBlob.size,
      contentType,
      extension,
      sourceSize: Number(file.size || 0),
    };
  }
  function createDraft(subject = null, options = {}) {
    const current = ownImage(subject),
      allowInherit = Boolean(options.allowInherit);
    return {
      id: `image-${Math.random().toString(36).slice(2, 10)}`,
      subject: subject || {},
      allowInherit,
      inheritedSubject: options.inheritedSubject || null,
      mode: allowInherit
        ? subject?.imageMode === "own" || current.hasOwnImage
          ? "own"
          : "inherit"
        : "own",
      processed: null,
      previewUrl: "",
      remove: false,
      status: "idle",
      error: "",
    };
  }
  function previewForDraft(draft) {
    if (draft.mode === "inherit")
      return getProductDisplayImage(draft.inheritedSubject || {}, null, {
        preferMain: false,
      }).url;
    if (draft.remove) return "";
    return draft.previewUrl || ownImage(draft.subject).url;
  }
  function editorMarkup(draft, options = {}) {
    const preview = previewForDraft(draft),
      label = options.label || "Foto do produto",
      description =
        options.description ||
        "Adicione uma foto para identificar o produto mais rápido.",
      inherited = draft.mode === "inherit";
    return `<section class="product-image-field" data-image-editor="${draft.id}">
      <div class="product-image-heading"><div><b>${esc(label)}</b><small>${esc(description)}</small></div><span>Otimizada</span></div>
      ${
        draft.allowInherit
          ? `<div class="variation-image-mode" role="radiogroup" aria-label="Origem da foto"><label><input type="radio" name="image-mode-${draft.id}" value="inherit" ${inherited ? "checked" : ""}> Usar foto do produto</label><label><input type="radio" name="image-mode-${draft.id}" value="own" ${!inherited ? "checked" : ""}> Usar foto própria</label></div>`
          : ""
      }
      <div class="product-image-preview ${preview ? "has-image" : ""}">${
        preview
          ? `<img src="${esc(versionedUrl(preview, draft.subject?.imageUpdatedAt))}" alt="Prévia da foto" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><div class="product-image-empty" hidden><i data-lucide="image-off"></i><b>Imagem indisponível</b></div>`
          : `<div class="product-image-empty"><i data-lucide="image-plus"></i><b>Sem foto</b><small>O app usará as iniciais como placeholder.</small></div>`
      }</div>
      <div class="product-image-actions" ${inherited ? "hidden" : ""}>
        <button type="button" data-image-camera><i data-lucide="camera"></i> Tirar foto</button>
        <button type="button" data-image-gallery><i data-lucide="images"></i><span class="mobile-image-label">Galeria</span><span class="desktop-image-label">Escolher arquivo</span></button>
        ${preview ? `<button type="button" class="danger" data-image-remove><i data-lucide="trash-2"></i> Remover</button>` : ""}
      </div>
      <p>JPG, PNG ou WebP · até 10 MB · redimensionada automaticamente.</p>
      <div class="product-image-state ${draft.status}" role="status">${
        draft.status === "optimizing"
          ? "Otimizando imagem..."
          : draft.status === "ready"
            ? `Pronta · ${Math.round((draft.processed?.size || 0) / 1024)} KB`
            : draft.error
              ? esc(draft.error)
              : ""
      }</div>
      <input class="visually-hidden" data-image-camera-input type="file" accept="image/*" capture="environment">
      <input class="visually-hidden" data-image-gallery-input type="file" accept="image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp">
    </section>`;
  }
  function refreshEditor(root, draft, options) {
    const current = root.querySelector(`[data-image-editor="${draft.id}"]`);
    if (!current) return;
    const holder = document.createElement("div");
    holder.innerHTML = editorMarkup(draft, options);
    current.replaceWith(holder.firstElementChild);
    bindEditor(root, draft, options);
  }
  function cleanupDraft(draft) {
    if (draft.previewUrl) URL.revokeObjectURL(draft.previewUrl);
    draft.previewUrl = "";
  }
  function bindEditor(root, draft, options = {}) {
    const section = root.querySelector(`[data-image-editor="${draft.id}"]`);
    if (!section || section.dataset.bound === "true") return;
    section.dataset.bound = "true";
    const camera = $("[data-image-camera-input]", section),
      gallery = $("[data-image-gallery-input]", section);
    const choose = async (file) => {
      if (!file) return;
      draft.status = "optimizing";
      draft.error = "";
      refreshEditor(root, draft, options);
      try {
        const processed = await processImage(file);
        cleanupDraft(draft);
        draft.processed = processed;
        draft.previewUrl = URL.createObjectURL(processed.mainBlob);
        draft.remove = false;
        draft.mode = "own";
        draft.status = "ready";
        options.onChange?.(draft);
      } catch (error) {
        draft.status = "error";
        draft.error = error.message || "Não foi possível preparar esta imagem.";
        window.Utils?.toast?.(draft.error, true);
      }
      refreshEditor(root, draft, options);
    };
    $("[data-image-camera]", section)?.addEventListener("click", () => camera.click());
    $("[data-image-gallery]", section)?.addEventListener("click", () => gallery.click());
    camera.onchange = () => choose(camera.files?.[0]);
    gallery.onchange = () => choose(gallery.files?.[0]);
    $("[data-image-remove]", section)?.addEventListener("click", () => {
      cleanupDraft(draft);
      draft.processed = null;
      draft.remove = true;
      draft.status = "idle";
      draft.mode = draft.allowInherit ? "inherit" : "own";
      options.onChange?.(draft);
      refreshEditor(root, draft, options);
    });
    section.querySelectorAll(`input[name="image-mode-${draft.id}"]`).forEach((input) =>
      input.addEventListener("change", () => {
        draft.mode = input.value;
        if (draft.mode === "inherit") draft.remove = true;
        else draft.remove = false;
        options.onChange?.(draft);
        refreshEditor(root, draft, options);
      }),
    );
    window.lucide?.createIcons();
  }
  const emptyImageFields = (imageMode = "own") => ({
    image: null,
    imageMode,
    imagem: "",
    imageUrl: null,
    imageStoragePath: null,
    imageThumbUrl: null,
    imageThumbStoragePath: null,
    imageUpdatedAt: new Date().toISOString(),
    imageUploadStatus: "none",
    imageOperationId: window.Utils?.uuid?.() || null,
  });
  async function commit(draft, options = {}) {
    const oldSubject = options.oldSubject || draft.subject || {},
      hasOldImage = ownImage(oldSubject).hasOwnImage;
    if (draft.allowInherit && draft.mode === "inherit") {
      if (hasOldImage) {
        if (!navigator.onLine)
          throw Error("Conecte-se à internet para remover a foto própria da variação.");
        await window.ProductImageStorage?.remove?.(oldSubject, options);
      }
      return emptyImageFields("inherit");
    }
    if (draft.processed) {
      if (!navigator.onLine)
        throw Error("Sem internet. Conecte-se para enviar a foto e salvar.");
      if (!window.ProductImageStorage)
        throw Error("O serviço de imagens ainda está carregando. Tente novamente.");
      return window.ProductImageStorage.upload(
        options.productId,
        draft.processed,
        {
          variantId: options.variantId || null,
          operationId: window.Utils?.uuid?.(),
          oldSubject,
          onProgress: options.onProgress,
        },
      );
    }
    if (draft.remove && hasOldImage) {
      if (!navigator.onLine)
        throw Error("Conecte-se à internet para remover esta foto.");
      await window.ProductImageStorage?.remove?.(oldSubject, options);
      return emptyImageFields(draft.allowInherit ? draft.mode : "own");
    }
    return draft.allowInherit ? { imageMode: draft.mode } : {};
  }
  function openForm(id, defaults = {}) {
    const existing = id ? window.Produtos?.obter?.(id) : null,
      product = existing || {},
      productId = id || window.Utils.uuid(),
      imageDraft = createDraft(product),
      root = $("#modal"),
      initialBarcode = defaults.barcode ?? product.barcode ?? "";
    root.innerHTML = `<div class="modal-bg"><section class="modal-box product-form-modal"><header class="modal-head"><div><small>Produtos</small><h3>${id ? "Editar produto" : "Novo produto"}</h3></div><button class="icon-btn close" type="button" aria-label="Fechar"><i data-lucide="x"></i></button></header><form><div class="modal-body product-form-sections">
      <section class="product-form-section"><header><i data-lucide="package"></i><div><b>Informações</b><small>Dados usados nas vendas e no catálogo.</small></div></header><div class="form-grid"><div class="field full"><label>Nome *</label><input name="nome" required value="${esc(product.nome || "")}"></div><div class="field"><label>Código interno</label><input name="codigo" value="${esc(product.codigo || "")}"></div><div class="field"><label>Categoria</label><input name="categoria" value="${esc(product.categoria || "")}"></div><div class="field full"><label>Código de barras</label><div class="barcode-field-row"><input name="barcode" inputmode="text" autocomplete="off" value="${esc(initialBarcode)}" placeholder="EAN, UPC ou código interno"><button type="button" data-scan-form-barcode aria-label="Ler código pela câmera"><i data-lucide="scan-barcode"></i></button></div><input type="hidden" name="barcodeType" value="${esc(defaults.barcodeType ?? product.barcodeType ?? "")}"><small class="barcode-field-status">Não informado</small></div><div class="field"><label>Preço de venda *</label><input name="preco" type="number" required inputmode="decimal" min="0" step=".01" value="${esc(product.preco ?? "")}"></div><div class="field"><label>Custo unitário</label><input name="custo" type="number" inputmode="decimal" min="0" step=".01" value="${esc(product.custo ?? "")}"></div><div class="field full"><label>Observação</label><textarea name="observacao">${esc(product.observacao || product.observacoes || "")}</textarea></div></div></section>
      <section class="product-form-section image-section">${editorMarkup(imageDraft)}</section>
      <section class="product-form-section"><header><i data-lucide="boxes"></i><div><b>Estoque</b><small>Defina se este item precisa de movimentação.</small></div></header><label class="product-stock-control"><input type="checkbox" name="controlaEstoque" ${product.semControleEstoque ? "" : "checked"}><span><b>Controlar estoque deste produto</b><small>Desative para serviços e itens sem quantidade física.</small></span></label><div class="form-grid" data-stock-fields><div class="field"><label>Estoque atual</label><input name="estoqueAtual" type="number" inputmode="decimal" step="1" value="${esc(product.estoqueAtual ?? product.estoque ?? 0)}"></div><div class="field"><label>Estoque mínimo</label><input name="estoqueMinimo" type="number" inputmode="decimal" min="0" step="1" value="${esc(product.estoqueMinimo ?? 0)}"></div></div></section>
      </div><div class="product-upload-progress" hidden><span><i></i></span><small>Enviando imagem... <b>0%</b></small></div><footer class="modal-foot"><button type="button" class="btn btn-light cancel">Cancelar</button><button class="btn btn-primary" data-save-product>Salvar produto</button></footer></form></section></div>`;
    const form = $("form", root),
      controlsStock = $("[name='controlaEstoque']", form),
      stockFields = $("[data-stock-fields]", form),
      barcodeInput = $("[name='barcode']", form),
      barcodeType = $("[name='barcodeType']", form),
      barcodeStatus = $(".barcode-field-status", form);
    const updateStockFields = () => {
      stockFields.hidden = !controlsStock.checked;
      stockFields.querySelectorAll("input").forEach((input) => {
        input.disabled = !controlsStock.checked;
      });
    };
    const validateBarcode = () => {
      const code = window.normalizeBarcode?.(barcodeInput.value) || barcodeInput.value.trim();
      barcodeInput.value = code;
      barcodeStatus.className = "barcode-field-status";
      if (!code) {
        barcodeType.value = "";
        barcodeStatus.textContent = "Não informado";
        return true;
      }
      if (code !== String(initialBarcode))
        barcodeType.value = window.BarcodeIndex?.inferType?.(code) || "manual";
      const duplicate = window.BarcodeIndex?.conflict?.(code, id);
      if (duplicate) {
        barcodeStatus.textContent = `Já cadastrado em ${duplicate.nome}`;
        barcodeStatus.classList.add("duplicate");
        return false;
      }
      barcodeStatus.textContent = "Código disponível";
      barcodeStatus.classList.add("available");
      return true;
    };
    const close = () => {
      cleanupDraft(imageDraft);
      window.Modais.fechar();
    };
    root.querySelectorAll(".close,.cancel").forEach((button) => (button.onclick = close));
    controlsStock.onchange = updateStockFields;
    barcodeInput.addEventListener("input", validateBarcode);
    barcodeInput.addEventListener("blur", validateBarcode);
    $("[data-scan-form-barcode]", root).onclick = () =>
      window.BarcodeUI?.open?.({
        title: "Código do produto",
        onDetected: (result) => {
          barcodeInput.value = result.value;
          barcodeType.value = result.format;
          validateBarcode();
          return { message: "Código preenchido no produto" };
        },
      });
    bindEditor(root, imageDraft);
    form.onsubmit = async (event) => {
      event.preventDefault();
      if (!validateBarcode())
        return window.Utils.toast("Este código já pertence a outro produto.", true);
      const button = $("[data-save-product]", root),
        progress = $(".product-upload-progress", root),
        formData = new FormData(form),
        data = Object.fromEntries(formData);
      button.disabled = true;
      try {
        const imageData = await commit(imageDraft, {
          productId,
          oldSubject: product,
          onProgress: (value) => {
            progress.hidden = false;
            progress.querySelector("i").style.width = `${value}%`;
            progress.querySelector("b").textContent = `${value}%`;
          },
        });
        const saved = window.Produtos.salvar({
          id: productId,
          ...data,
          semControleEstoque: !formData.has("controlaEstoque"),
          favorito: product.favorito,
          ativo: true,
          ...imageData,
        });
        cleanupDraft(imageDraft);
        window.Modais.fechar();
        window.Utils.toast("Produto salvo");
        defaults.onSaved?.(saved);
        if (matchMedia("(max-width:767px)").matches && window.Router?.atual?.() === "produtos")
          window.ProdutosMobile?.refresh?.(true);
        else
          dispatchEvent(
            new CustomEvent("cloud-data-updated", {
              detail: { source: "product-form", collection: "products" },
            }),
          );
      } catch (error) {
        window.Utils.toast(error.message || "Não foi possível salvar o produto.", true);
        button.disabled = false;
        progress.hidden = true;
      }
    };
    updateStockFields();
    validateBarcode();
    window.lucide?.createIcons();
    setTimeout(() => $("input[name='nome']", root)?.focus(), 50);
  }
  function enhance(root = document) {
    if (!window.Produtos) return;
    root
      .querySelectorAll(
        ".pick-product,.editable-cart,.product-detail-modal,.product-select-list [data-entry-variant]",
      )
      .forEach((element) => {
        if (element.dataset.photoEnhanced || element.querySelector(".product-photo-shell")) return;
        const productId =
            element.dataset.add ||
            element.querySelector("[data-item-qty]")?.dataset.itemQty ||
            element.querySelector("[data-detail-edit]")?.dataset.detailEdit,
          product = productId && window.Produtos.obter(productId);
        if (!product) return;
        const variantId = element.dataset.entryVariant || null,
          variant = variantId ? window.ProductVariations?.get?.(variantId) : null,
          holder = document.createElement("span");
        holder.innerHTML = markup(product, {
          variant,
          className: element.matches(".editable-cart")
            ? "sale-cart-photo"
            : "sale-product-photo",
        });
        element.prepend(holder.firstElementChild);
        element.dataset.photoEnhanced = "true";
      });
  }
  async function removeProductAssets(product, variants = []) {
    const hasAssets =
      ownImage(product).hasOwnImage ||
      variants.some((variant) => ownImage(variant).hasOwnImage);
    if (!hasAssets) return { removed: 0 };
    if (!window.ProductImageStorage)
      throw Error("O serviço de imagens ainda está carregando. Tente novamente.");
    await window.ProductImageStorage.removeProduct(product, variants);
  }
  async function deleteProduct(productId) {
    const product = window.Produtos?.obter?.(productId);
    if (!product) throw Error("Produto não encontrado.");
    const variants = window.ProductVariations?.list?.(productId) || [];
    await removeProductAssets(product, variants);
    window.Produtos.excluir(productId);
  }

  window.getProductDisplayImage = getProductDisplayImage;
  window.ProductImages = {
    ACCEPTED_TYPES,
    MAX_SOURCE_BYTES,
    MAIN_MAX_DIMENSION,
    THUMB_MAX_DIMENSION,
    MAIN_QUALITY,
    THUMB_QUALITY,
    validate,
    processImage,
    getProductDisplayImage,
    markup,
    source,
    versionedUrl,
    createDraft,
    editorMarkup,
    bindEditor,
    cleanupDraft,
    commit,
    openForm,
    enhance,
    removeProductAssets,
    deleteProduct,
  };
  let queued = false;
  new MutationObserver(() => {
    if (queued) return;
    queued = true;
    queueMicrotask(() => {
      queued = false;
      enhance(document);
    });
  }).observe(document.documentElement, { childList: true, subtree: true });
  addEventListener("DOMContentLoaded", () => enhance());
})();
