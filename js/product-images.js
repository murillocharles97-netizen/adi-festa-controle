(function () {
  "use strict";

  const ACCEPTED_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]),
    MAX_SOURCE_BYTES = 10 * 1024 * 1024,
    MAIN_MAX_DIMENSION = 1200,
    THUMB_MAX_DIMENSION = 420,
    MAIN_QUALITY = 0.82,
    THUMB_QUALITY = 0.78,
    MIN_ZOOM = 1,
    MAX_ZOOM = 3,
    DEFAULT_PRESENTATION = Object.freeze({
      fit: "cover",
      positionX: 50,
      positionY: 50,
      zoom: 1,
    });
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
  const clamp = (value, minimum, maximum, fallback) => {
    const parsed = Number(value);
    return Number.isFinite(parsed)
      ? Math.min(maximum, Math.max(minimum, parsed))
      : fallback;
  };
  function normalizePresentation(value) {
    const source = value && typeof value === "object" ? value : {};
    return {
      fit: source.fit === "contain" ? "contain" : "cover",
      positionX: clamp(source.positionX, 0, 100, 50),
      positionY: clamp(source.positionY, 0, 100, 50),
      zoom: clamp(source.zoom, MIN_ZOOM, MAX_ZOOM, 1),
    };
  }
  const presentationFrom = (subject) =>
    normalizePresentation(subject?.image?.presentation || subject?.imagePresentation);
  function presentationStyle(value) {
    const presentation = normalizePresentation(value);
    return `--product-image-fit:${presentation.fit};--product-image-position-x:${presentation.positionX}%;--product-image-position-y:${presentation.positionY}%;--product-image-zoom:${presentation.zoom}`;
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
      presentation: presentationFrom(subject),
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
      presentation: normalizePresentation(chosen.presentation),
      initials: initials(variant?.displayName || name),
      alt: name,
    };
  }
  const source = (product, variant = null, preferMain = false) =>
    getProductDisplayImage(product, variant, { preferMain }).url;
  function markup(product, options = {}) {
    const display = getProductDisplayImage(product, options.variant || null, options),
      className = options.className || "product-photo";
    return `<span class="${esc(className)} product-photo-shell ${display.url ? "is-loading" : "is-fallback"}" data-image-fit="${display.presentation.fit}" style="${presentationStyle(display.presentation)}">${
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
      presentation: presentationFrom(subject),
      presentationDirty: false,
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
      <div class="product-image-preview product-photo-shell ${preview ? "has-image" : "is-fallback"}" data-image-fit="${draft.presentation.fit}" style="${presentationStyle(draft.presentation)}">${
        preview
          ? `<img src="${esc(versionedUrl(preview, draft.subject?.imageUpdatedAt))}" alt="Prévia da foto" onerror="this.hidden=true;this.nextElementSibling.hidden=false"><div class="product-image-empty" hidden><i data-lucide="image-off"></i><b>Imagem indisponível</b></div>`
          : `<div class="product-image-empty"><i data-lucide="image-plus"></i><b>Sem foto</b><small>O app usará as iniciais como placeholder.</small></div>`
      }</div>
      <div class="product-image-actions" ${inherited ? "hidden" : ""}>
        <button type="button" data-image-camera><i data-lucide="camera"></i> Tirar foto</button>
        <button type="button" data-image-gallery><i data-lucide="images"></i><span class="mobile-image-label">Galeria</span><span class="desktop-image-label">Escolher arquivo</span></button>
        ${preview ? `<button type="button" class="danger" data-image-remove><i data-lucide="trash-2"></i> Remover</button>` : ""}
        ${preview ? `<button type="button" data-image-adjust><i data-lucide="scan"></i> Ajustar enquadramento</button>` : ""}
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
  function openPresentationEditor({ src, presentation, title = "Ajustar foto" } = {}) {
    if (!src) return Promise.resolve(null);
    const current = normalizePresentation(presentation),
      overlay = document.createElement("div");
    overlay.className = "product-image-adjust-overlay";
    overlay.innerHTML = `<section class="product-image-adjust-modal" role="dialog" aria-modal="true" aria-labelledby="product-image-adjust-title">
      <header><div><small>Foto do produto</small><h3 id="product-image-adjust-title">${esc(title)}</h3></div><button type="button" data-adjust-cancel aria-label="Cancelar ajuste"><i data-lucide="x"></i></button></header>
      <div class="product-image-adjust-body">
        <p class="product-image-adjust-intro">Arraste para escolher a parte mais importante da foto. O quadro tem a mesma proporção usada nos cards.</p>
        <div class="product-image-adjust-stage" data-adjust-stage><img src="${esc(src)}" alt="Prévia do enquadramento"></div>
        <div class="product-image-fit-options" role="radiogroup" aria-label="Modo de exibição">
          <button type="button" data-adjust-fit="cover"><i data-lucide="maximize-2"></i><span><b>Preencher</b><small>Ocupa todo o espaço da foto.</small></span></button>
          <button type="button" data-adjust-fit="contain"><i data-lucide="minimize-2"></i><span><b>Encaixar</b><small>Mostra a imagem inteira.</small></span></button>
        </div>
        <section class="product-image-zoom-control" aria-label="Zoom da foto"><div><b>Zoom</b><output data-adjust-zoom-output>100%</output></div><div><button type="button" data-adjust-zoom-out aria-label="Diminuir zoom"><i data-lucide="minus"></i></button><input data-adjust-zoom type="range" min="${MIN_ZOOM}" max="${MAX_ZOOM}" step="0.05" value="${current.zoom}" aria-label="Zoom"><button type="button" data-adjust-zoom-in aria-label="Aumentar zoom"><i data-lucide="plus"></i></button></div></section>
        <div class="product-image-adjust-secondary"><button type="button" data-adjust-center><i data-lucide="focus"></i> Centralizar</button><button type="button" data-adjust-reset><i data-lucide="rotate-ccw"></i> Redefinir</button></div>
      </div>
      <footer><button type="button" class="btn btn-light" data-adjust-cancel>Cancelar</button><button type="button" class="btn btn-primary" data-adjust-use>Usar foto</button></footer>
    </section>`;
    document.body.append(overlay);
    document.body.classList.add("product-image-adjust-open");
    window.lucide?.createIcons();
    const stage = $("[data-adjust-stage]", overlay),
      image = $("img", stage),
      slider = $("[data-adjust-zoom]", overlay),
      output = $("[data-adjust-zoom-output]", overlay),
      pointers = new Map();
    let dragStart = null,
      pinchStart = null;
    const paint = () => {
      Object.assign(current, normalizePresentation(current));
      stage.dataset.imageFit = current.fit;
      stage.style.cssText = presentationStyle(current);
      slider.value = String(current.zoom);
      output.value = `${Math.round(current.zoom * 100)}%`;
      output.textContent = output.value;
      overlay.querySelectorAll("[data-adjust-fit]").forEach((button) => {
        const active = button.dataset.adjustFit === current.fit;
        button.classList.toggle("active", active);
        button.setAttribute("aria-checked", String(active));
      });
    };
    const setZoom = (value) => {
      current.zoom = clamp(value, MIN_ZOOM, MAX_ZOOM, 1);
      paint();
    };
    const endPointer = (event) => {
      pointers.delete(event.pointerId);
      if (pointers.size < 2) pinchStart = null;
      if (!pointers.size) dragStart = null;
    };
    stage.addEventListener("pointerdown", (event) => {
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      stage.setPointerCapture?.(event.pointerId);
      if (pointers.size === 1)
        dragStart = {
          x: event.clientX,
          y: event.clientY,
          positionX: current.positionX,
          positionY: current.positionY,
        };
      if (pointers.size === 2) {
        const [a, b] = [...pointers.values()];
        pinchStart = {
          distance: Math.hypot(a.x - b.x, a.y - b.y),
          zoom: current.zoom,
        };
      }
    });
    stage.addEventListener("pointermove", (event) => {
      if (!pointers.has(event.pointerId)) return;
      pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (pointers.size >= 2 && pinchStart) {
        const [a, b] = [...pointers.values()],
          distance = Math.hypot(a.x - b.x, a.y - b.y);
        setZoom(pinchStart.zoom * (distance / Math.max(1, pinchStart.distance)));
        return;
      }
      if (!dragStart) return;
      const bounds = stage.getBoundingClientRect();
      current.positionX = clamp(
        dragStart.positionX - ((event.clientX - dragStart.x) / Math.max(1, bounds.width)) * 100,
        0,
        100,
        50,
      );
      current.positionY = clamp(
        dragStart.positionY - ((event.clientY - dragStart.y) / Math.max(1, bounds.height)) * 100,
        0,
        100,
        50,
      );
      paint();
    });
    ["pointerup", "pointercancel", "lostpointercapture"].forEach((name) =>
      stage.addEventListener(name, endPointer),
    );
    slider.addEventListener("input", () => setZoom(slider.value));
    $("[data-adjust-zoom-out]", overlay).onclick = () => setZoom(current.zoom - 0.1);
    $("[data-adjust-zoom-in]", overlay).onclick = () => setZoom(current.zoom + 0.1);
    overlay.querySelectorAll("[data-adjust-fit]").forEach(
      (button) =>
        (button.onclick = () => {
          current.fit = button.dataset.adjustFit;
          paint();
        }),
    );
    $("[data-adjust-center]", overlay).onclick = () => {
      current.positionX = 50;
      current.positionY = 50;
      paint();
    };
    $("[data-adjust-reset]", overlay).onclick = () => {
      Object.assign(current, DEFAULT_PRESENTATION);
      paint();
    };
    paint();
    return new Promise((resolve) => {
      let finished = false;
      const onKeydown = (event) => {
          if (event.key === "Escape") finish(null);
        },
        finish = (value) => {
          if (finished) return;
          finished = true;
          document.removeEventListener("keydown", onKeydown);
          document.body.classList.remove("product-image-adjust-open");
          overlay.remove();
          resolve(value);
        };
      overlay.querySelectorAll("[data-adjust-cancel]").forEach(
        (button) => (button.onclick = () => finish(null)),
      );
      $("[data-adjust-use]", overlay).onclick = () =>
        finish(normalizePresentation(current));
      overlay.addEventListener("click", (event) => {
        if (event.target === overlay) finish(null);
      });
      document.addEventListener("keydown", onKeydown);
      image.addEventListener("error", () => finish(null), { once: true });
    });
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
        const previewUrl = URL.createObjectURL(processed.mainBlob),
          adjusted = await openPresentationEditor({
            src: previewUrl,
            presentation: DEFAULT_PRESENTATION,
          });
        if (!adjusted) {
          URL.revokeObjectURL(previewUrl);
          draft.status = draft.processed ? "ready" : "idle";
          refreshEditor(root, draft, options);
          return;
        }
        cleanupDraft(draft);
        draft.processed = processed;
        draft.previewUrl = previewUrl;
        draft.remove = false;
        draft.mode = "own";
        draft.status = "ready";
        draft.presentation = adjusted;
        draft.presentationDirty = true;
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
    $("[data-image-adjust]", section)?.addEventListener("click", async () => {
      const adjusted = await openPresentationEditor({
        src: previewForDraft(draft),
        presentation: draft.presentation,
      });
      if (!adjusted) return;
      draft.presentation = adjusted;
      draft.presentationDirty = true;
      options.onChange?.(draft);
      refreshEditor(root, draft, options);
    });
    $("[data-image-remove]", section)?.addEventListener("click", () => {
      cleanupDraft(draft);
      draft.processed = null;
      draft.remove = true;
      draft.status = "idle";
      draft.mode = draft.allowInherit ? "inherit" : "own";
      draft.presentation = { ...DEFAULT_PRESENTATION };
      draft.presentationDirty = false;
      options.onChange?.(draft);
      refreshEditor(root, draft, options);
    });
    section.querySelectorAll(`input[name="image-mode-${draft.id}"]`).forEach((input) =>
      input.addEventListener("change", () => {
        draft.mode = input.value;
        if (draft.mode === "inherit") draft.remove = true;
        else draft.remove = false;
        if (draft.mode === "own") draft.presentation = presentationFrom(draft.subject);
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
  function withPresentation(imageData, presentation) {
    if (!imageData?.image || typeof imageData.image !== "object") return imageData;
    return {
      ...imageData,
      image: {
        ...imageData.image,
        presentation: normalizePresentation(presentation),
      },
    };
  }
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
      const uploaded = await window.ProductImageStorage.upload(
        options.productId,
        draft.processed,
        {
          variantId: options.variantId || null,
          operationId: window.Utils?.uuid?.(),
          oldSubject,
          onProgress: options.onProgress,
        },
      );
      return withPresentation(uploaded, draft.presentation);
    }
    if (draft.remove && hasOldImage) {
      if (!navigator.onLine)
        throw Error("Conecte-se à internet para remover esta foto.");
      await window.ProductImageStorage?.remove?.(oldSubject, options);
      return emptyImageFields(draft.allowInherit ? draft.mode : "own");
    }
    if (draft.presentationDirty && hasOldImage) {
      const previousImage =
        oldSubject.image && typeof oldSubject.image === "object"
          ? oldSubject.image
          : {
              url: oldSubject.imageUrl || oldSubject.imagem || "",
              storagePath: oldSubject.imageStoragePath || null,
              thumbnailUrl: oldSubject.imageThumbUrl || "",
              thumbnailStoragePath: oldSubject.imageThumbStoragePath || null,
              updatedAt: oldSubject.imageUpdatedAt || null,
            };
      return {
        ...(draft.allowInherit ? { imageMode: draft.mode } : {}),
        image: {
          ...previousImage,
          presentation: normalizePresentation(draft.presentation),
        },
      };
    }
    return draft.allowInherit ? { imageMode: draft.mode } : {};
  }
  function openForm(id, defaults = {}) {
    const existing = id ? window.Produtos?.obter?.(id) : null,
      product = existing || {},
      productType = defaults.productType || product.productType || "simple",
      recurring = productType === "recurring",
      productId = id || window.Utils.uuid(),
      imageDraft = createDraft(product),
      root = $("#modal"),
      initialBarcode = defaults.barcode ?? product.barcode ?? "";
    root.innerHTML = `<div class="modal-bg"><section class="modal-box product-form-modal"><header class="modal-head"><div><small>Produtos</small><h3>${id ? "Editar produto" : "Novo produto"}</h3></div><button class="icon-btn close" type="button" aria-label="Fechar"><i data-lucide="x"></i></button></header><form><div class="modal-body product-form-sections">
      <section class="product-form-section"><header><i data-lucide="package"></i><div><b>Informações</b><small>Dados usados nas vendas e no catálogo.</small></div></header><div class="form-grid"><div class="field full"><label>Nome *</label><input name="nome" required value="${esc(product.nome || "")}"></div><div class="field"><label>Código interno</label><input name="codigo" value="${esc(product.codigo || "")}"></div><div class="field"><label>Categoria</label><input name="categoria" value="${esc(product.categoria || "")}"></div><div class="field full"><label>Código de barras</label><div class="barcode-field-row"><input name="barcode" inputmode="text" autocomplete="off" value="${esc(initialBarcode)}" placeholder="EAN, UPC ou código interno"><button type="button" data-scan-form-barcode aria-label="Ler código pela câmera"><i data-lucide="scan-barcode"></i></button></div><input type="hidden" name="barcodeType" value="${esc(defaults.barcodeType ?? product.barcodeType ?? "")}"><small class="barcode-field-status">Não informado</small></div><div class="field"><label>Preço de venda *</label><input name="preco" type="number" required inputmode="decimal" min="0" step=".01" value="${esc(product.preco ?? "")}"></div><div class="field"><label>Custo unitário</label><input name="custo" type="number" inputmode="decimal" min="0" step=".01" value="${esc(product.custo ?? "")}"></div><div class="field full"><label>Observação</label><textarea name="observacao">${esc(product.observacao || product.observacoes || "")}</textarea></div></div></section>
      <section class="product-form-section image-section">${editorMarkup(imageDraft)}</section>
      ${recurring ? `<section class="product-form-section recurring-product-fields"><header><i data-lucide="calendar-clock"></i><div><b>Renovação</b><small>Defina a vigência sugerida. Ela poderá ser alterada na venda.</small></div></header><div class="form-grid"><div class="field"><label>Período padrão *</label><input name="durationValue" type="number" inputmode="numeric" min="1" required value="${esc(product.durationValue ?? 30)}"></div><div class="field"><label>Unidade</label><select name="durationUnit"><option value="days" ${product.durationUnit === "days" || !product.durationUnit ? "selected" : ""}>Dias</option><option value="weeks" ${product.durationUnit === "weeks" ? "selected" : ""}>Semanas</option><option value="months" ${product.durationUnit === "months" ? "selected" : ""}>Meses</option><option value="years" ${product.durationUnit === "years" ? "selected" : ""}>Anos</option></select></div><div class="field full"><label>Nome para renovação</label><input name="renewalLabel" value="${esc(product.renewalLabel || product.nome || "")}" placeholder="Ex.: Plano IPTV Premium"></div><div class="field full"><label>Mensagem sugerida</label><textarea name="renewalMessage" placeholder="Mensagem opcional para o WhatsApp">${esc(product.renewalMessage || "")}</textarea></div></div><label class="product-stock-control"><input type="checkbox" name="hasVariations" ${product.hasVariations ? "checked" : ""}><span><b>Este produto possui variações</b><small>Ex.: 1 tela, 2 telas e Premium.</small></span></label></section>` : ""}
      <section class="product-form-section"><header><i data-lucide="boxes"></i><div><b>Estoque</b><small>Defina se este item precisa de movimentação.</small></div></header><label class="product-stock-control"><input type="checkbox" name="controlaEstoque" ${product.semControleEstoque || (recurring && !id && product.controlaEstoque !== true) ? "" : "checked"}><span><b>Controlar estoque deste produto</b><small>${recurring ? "Ative apenas se esta venda também consumir um item físico do seu estoque." : "Desative para serviços e itens sem quantidade física."}</small></span></label><div class="form-grid" data-stock-fields><div class="field"><label>Estoque atual</label><input name="estoqueAtual" type="number" inputmode="decimal" step="1" value="${esc(product.estoqueAtual ?? product.estoque ?? 0)}"></div><div class="field"><label>Estoque mínimo</label><input name="estoqueMinimo" type="number" inputmode="decimal" min="0" step="1" value="${esc(product.estoqueMinimo ?? 0)}"></div></div></section>
      </div><div class="product-upload-progress" hidden><span><i></i></span><small>Enviando imagem... <b>0%</b></small></div><footer class="modal-foot"><button type="button" class="btn btn-light cancel">Cancelar</button><button class="btn btn-primary" data-save-product>Salvar produto</button></footer></form></section></div>`;
    const form = $("form", root),
      modal = $(".product-form-modal", root),
      controlsStock = $("[name='controlaEstoque']", form),
      stockFields = $("[data-stock-fields]", form),
      barcodeInput = $("[name='barcode']", form),
      barcodeType = $("[name='barcodeType']", form),
      barcodeStatus = $(".barcode-field-status", form);
    if (recurring) {
      const selectedReminders = new Set((product.renewalReminders || []).map(Number)),
        reminderMarkup = [30, 7, 3, 1, 0, -1]
          .map((days) => `<label><input type="checkbox" name="renewalReminders" value="${days}" ${selectedReminders.has(days) ? "checked" : ""}><span>${days > 0 ? `${days} dia${days === 1 ? "" : "s"} antes` : days === 0 ? "No dia" : "1 dia depois"}</span></label>`)
          .join(""),
        variationControl = $(".recurring-product-fields .product-stock-control", form);
      variationControl?.insertAdjacentHTML("beforebegin", `<fieldset class="renewal-reminders"><legend>Lembretes sugeridos</legend><p>Escolha quando esta renovação deve aparecer nos próximos avisos.</p><div>${reminderMarkup}</div></fieldset>`);
    }
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
    const visualViewport = window.visualViewport,
      syncViewportHeight = () => {
        const visibleHeight = Math.max(260, Math.round(visualViewport?.height || window.innerHeight)),
          visibleBottom = Math.round((visualViewport?.offsetTop || 0) + visibleHeight),
          keyboardOffset = Math.max(0, window.innerHeight - visibleBottom);
        modal?.style.setProperty("--product-form-viewport-height", `${visibleHeight}px`);
        modal?.style.setProperty("--product-form-keyboard-offset", `${keyboardOffset}px`);
      },
      cleanupViewport = () =>
        visualViewport?.removeEventListener("resize", syncViewportHeight),
      close = () => {
        cleanupViewport();
        cleanupDraft(imageDraft);
        window.Modais.fechar();
      };
    syncViewportHeight();
    visualViewport?.addEventListener("resize", syncViewportHeight, { passive: true });
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
          productType,
          hasVariations: recurring && formData.has("hasVariations"),
          renewalReminders: recurring ? formData.getAll("renewalReminders").map(Number) : [],
          semControleEstoque: !formData.has("controlaEstoque"),
          favorito: product.favorito,
          ativo: true,
          ...imageData,
        });
        cleanupViewport();
        cleanupDraft(imageDraft);
        window.Modais.fechar();
        window.Utils.toast("Produto salvo");
        defaults.onSaved?.(saved);
        if (saved.productType === "recurring" && saved.hasVariations && matchMedia("(max-width:767px)").matches)
          setTimeout(() => window.ProdutosMobile?.variableDetails?.(saved.id), 0);
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
    MIN_ZOOM,
    MAX_ZOOM,
    DEFAULT_PRESENTATION,
    normalizePresentation,
    presentationFrom,
    presentationStyle,
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
    openPresentationEditor,
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
