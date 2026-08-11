(function () {
  "use strict";
  const FORMATS = [
    "ean_13",
    "ean_8",
    "upc_a",
    "upc_e",
    "code_128",
    "code_39",
    "itf",
  ];
  const normalizeBarcode = (value) =>
    String(value ?? "")
      .replace(/[\s\u200B-\u200D\u2060\uFEFF]/g, "")
      .trim();
  const inferType = (value) => {
    const code = normalizeBarcode(value);
    if (/^\d{13}$/.test(code)) return "ean_13";
    if (/^\d{8}$/.test(code)) return "ean_8";
    if (/^\d{12}$/.test(code)) return "upc_a";
    return null;
  };
  let indexBusiness = "",
    indexMap = new Map(),
    indexReady = false;
  const businessId = () =>
    window.DB?.getBusinessId?.() || window.FirebaseSession?.businessId || "";
  function rebuild() {
    const id = businessId();
    if (id === indexBusiness && indexReady) return indexMap;
    const data = window.DB?.carregar?.() || {},
      products = data.produtos || [],
      variants = data.variacoesProdutos || [];
    const next = new Map();
    products.forEach((product) => {
      const code = normalizeBarcode(product.barcode);
      if (code && product.ativo !== false && !next.has(code))
        next.set(code, product);
    });
    variants.forEach((variant) => {
      const code = normalizeBarcode(variant.barcode),
        parent = products.find(
          (product) => product.id === variant.parentProductId,
        );
      if (
        !code ||
        variant.active === false ||
        !parent ||
        parent.ativo === false
      )
        return;
      if (next.has(code)) {
        const current = next.get(code);
        next.set(code, {
          barcodeConflict: true,
          code,
          matches: [
            ...(current.barcodeConflict ? current.matches : [current]),
            {
              ...parent,
              variantId: variant.id,
              variant,
              nome: `${parent.nome} — ${variant.displayName}`,
              preco: variant.price,
              custo: variant.cost,
              estoqueAtual: variant.stock,
              barcode: variant.barcode,
            },
          ],
        });
        return;
      }
      next.set(code, {
        ...parent,
        variantId: variant.id,
        variant,
        nome: `${parent.nome} — ${variant.displayName}`,
        preco: variant.price,
        custo: variant.cost,
        estoqueAtual: variant.stock,
        barcode: variant.barcode,
      });
    });
    indexBusiness = id;
    indexMap = next;
    indexReady = true;
    try {
      localStorage.setItem(
        `adiFesta:${id}:barcodeIndex`,
        JSON.stringify(
          Object.fromEntries(
            [...next].map(([code, product]) => [code, product.id]),
          ),
        ),
      );
    } catch {}
    return next;
  }
  function find(code) {
    return rebuild().get(normalizeBarcode(code)) || null;
  }
  async function findAsync(code) {
    const local = find(code);
    if (local || !navigator.onLine) return local;
    try {
      await window.SyncFirebase?.findProductVariantByBarcode?.(
        normalizeBarcode(code),
      );
      indexReady = false;
      return find(code);
    } catch (error) {
      console.warn("[Barcode] busca remota de variação indisponível", {
        code: error?.code || "unknown",
      });
      return null;
    }
  }
  function conflict(code, productId = "") {
    const product = find(code);
    return product && String(product.id) !== String(productId || "")
      ? product
      : null;
  }
  function assertAvailable(code, productId = "") {
    const normalized = normalizeBarcode(code);
    if (!normalized) return null;
    const duplicate = conflict(normalized, productId);
    if (duplicate) {
      const error = Error(
        duplicate.barcodeConflict
          ? "Este código possui vínculos duplicados e precisa ser corrigido."
          : `Este código já está vinculado ao produto ${duplicate.nome}.`,
      );
      error.code = "barcode-duplicate";
      error.product = duplicate;
      throw error;
    }
    return normalized;
  }
  function invalidate() {
    indexReady = false;
    return rebuild();
  }
  window.normalizeBarcode = normalizeBarcode;
  window.BarcodeIndex = {
    normalize: normalizeBarcode,
    inferType,
    rebuild,
    invalidate,
    find,
    conflict,
    assertAvailable,
    businessId,
  };

  let stream = null,
    video = null,
    detector = null,
    timer = null,
    controls = null,
    paused = false,
    lastDetectedBarcode = "",
    lastDetectedAt = 0,
    currentOptions = null,
    deviceId = "",
    scannerGeneration = 0;
  const stopTracks = () => {
    const active = stream || video?.srcObject;
    if (active?.getTracks) active.getTracks().forEach((track) => track.stop());
    stream = null;
    if (video) {
      video.pause?.();
      video.srcObject = null;
    }
  };
  const clean = () => {
    scannerGeneration++;
    clearTimeout(timer);
    timer = null;
    try {
      controls?.stop?.();
    } catch {}
    controls = null;
    stopTracks();
    detector = null;
    video = null;
    paused = false;
    currentOptions = null;
  };
  const friendlyError = (error) =>
    error?.name === "NotAllowedError"
      ? "Não foi possível acessar a câmera. Permita o uso da câmera nas configurações do navegador."
      : error?.name === "NotReadableError"
        ? "A câmera está sendo usada por outro aplicativo."
        : error?.name === "NotFoundError"
          ? "Nenhuma câmera foi encontrada neste aparelho."
          : !window.isSecureContext
            ? "A câmera exige uma conexão segura HTTPS."
            : "Não foi possível iniciar o leitor. Digite o código manualmente.";
  function emit(rawValue, format = "unknown") {
    const value = normalizeBarcode(rawValue),
      now = Date.now(),
      delay = Number(currentOptions?.duplicateDelay || 1400);
    if (
      !value ||
      paused ||
      (value === lastDetectedBarcode && now - lastDetectedAt < delay)
    )
      return;
    lastDetectedBarcode = value;
    lastDetectedAt = now;
    paused = true;
    currentOptions?.onDetected?.({
      value,
      format: String(format || "unknown").toLowerCase(),
      detectedAt: new Date().toISOString(),
    });
  }
  const analyze = async (generation) => {
    if (generation !== scannerGeneration) return;
    if (!currentOptions || !video || paused || document.hidden) {
      timer = setTimeout(() => analyze(generation), 220);
      return;
    }
    try {
      const codes = await detector.detect(video);
      if (codes?.[0]) emit(codes[0].rawValue, codes[0].format);
    } catch (error) {
      if (error?.name !== "InvalidStateError") currentOptions?.onError?.(error);
    }
    if (generation === scannerGeneration)
      timer = setTimeout(() => analyze(generation), 180);
  };
  const loadZXing = () =>
    new Promise((resolve, reject) => {
      if (window.ZXingBrowser) return resolve(window.ZXingBrowser);
      const existing = document.querySelector("script[data-zxing]");
      if (existing) {
        existing.addEventListener("load", () => resolve(window.ZXingBrowser), {
          once: true,
        });
        existing.addEventListener("error", reject, { once: true });
        return;
      }
      const script = document.createElement("script");
      script.src = "./assets/zxing-browser.min.js";
      script.dataset.zxing = "true";
      script.onload = () => resolve(window.ZXingBrowser);
      script.onerror = () => reject(Error("zxing-load-failed"));
      document.head.append(script);
    });
  async function startScanner(options = {}) {
    clean();
    const generation = scannerGeneration;
    currentOptions = options;
    video = options.videoElement;
    deviceId =
      options.deviceId || localStorage.getItem("adiBarcodeCamera") || "";
    if (!video || !navigator.mediaDevices?.getUserMedia) {
      const error = Object.assign(Error("camera-unsupported"), {
        name: "NotSupportedError",
      });
      options.onError?.(error, friendlyError(error));
      throw error;
    }
    try {
      if ("BarcodeDetector" in window) {
        const supported = await BarcodeDetector.getSupportedFormats(),
          formats = (options.formats || FORMATS).filter((format) =>
            supported.includes(format),
          );
        detector = formats.length
          ? new BarcodeDetector({ formats })
          : new BarcodeDetector();
        const videoConstraint = deviceId
          ? { deviceId: { exact: deviceId } }
          : {
              facingMode: { ideal: "environment" },
              width: { ideal: 1280, max: 1920 },
              height: { ideal: 720, max: 1080 },
            };
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: videoConstraint,
        });
        if (generation !== scannerGeneration) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        video.srcObject = stream;
        video.setAttribute("playsinline", "");
        await video.play();
        analyze(generation);
      } else {
        const zxing = await loadZXing(),
          reader = new zxing.BrowserMultiFormatReader();
        const constraints = {
          audio: false,
          video: deviceId
            ? { deviceId: { exact: deviceId } }
            : {
                facingMode: { ideal: "environment" },
                width: { ideal: 1280 },
                height: { ideal: 720 },
              },
        };
        const startedControls = await reader.decodeFromConstraints(
          constraints,
          video,
          (result) => {
            if (result && generation === scannerGeneration)
              emit(result.getText(), result.getBarcodeFormat?.());
          },
        );
        if (generation !== scannerGeneration) {
          startedControls?.stop?.();
          return;
        }
        controls = startedControls;
        stream = video.srcObject;
      }
      const devices = (await navigator.mediaDevices.enumerateDevices()).filter(
        (item) => item.kind === "videoinput",
      );
      options.onReady?.({
        devices,
        torch: Boolean(
          stream?.getVideoTracks?.()[0]?.getCapabilities?.().torch,
        ),
        engine: detector ? "native" : "zxing",
      });
      return { devices, engine: detector ? "native" : "zxing" };
    } catch (error) {
      clean();
      options.onError?.(error, friendlyError(error));
      throw error;
    }
  }
  const pauseScanner = () => {
    paused = true;
  };
  const resumeScanner = () => {
    paused = false;
  };
  const stopScanner = () => clean();
  async function toggleTorch(enabled) {
    const track = (stream || video?.srcObject)?.getVideoTracks?.()[0];
    if (!track?.getCapabilities?.().torch) return false;
    await track.applyConstraints({ advanced: [{ torch: Boolean(enabled) }] });
    return true;
  }
  async function listCameras() {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    return (await navigator.mediaDevices.enumerateDevices()).filter(
      (item) => item.kind === "videoinput",
    );
  }
  const rememberCamera = (id) => {
    deviceId = id || "";
    if (id) localStorage.setItem("adiBarcodeCamera", id);
  };
  window.BarcodeScannerService = {
    formats: FORMATS,
    startScanner,
    stopScanner,
    pauseScanner,
    resumeScanner,
    toggleTorch,
    listCameras,
    rememberCamera,
    isActive: () => Boolean(stream || controls),
    friendlyError,
  };

  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const esc = (value) =>
    window.Utils?.escapar?.(String(value ?? "")) ?? String(value ?? "");
  const reducedMotion = () =>
    matchMedia?.("(prefers-reduced-motion: reduce)")?.matches === true;
  const preference = (name) =>
    localStorage.getItem(`adiBarcode${name}`) !== "0";
  function sound(kind = "success") {
    if (!preference("Sound")) return;
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const context = new AudioContext(),
        oscillator = context.createOscillator(),
        gain = context.createGain();
      oscillator.type = "sine";
      oscillator.frequency.value = kind === "error" ? 180 : 760;
      gain.gain.setValueAtTime(0.035, context.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, context.currentTime + 0.09);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start();
      oscillator.stop(context.currentTime + 0.1);
      oscillator.onended = () => context.close?.();
    } catch {}
  }
  function haptic(kind = "success") {
    if (!preference("Vibration") || typeof navigator.vibrate !== "function")
      return false;
    try {
      return navigator.vibrate(kind === "error" ? [45, 35, 70] : 50);
    } catch {
      return false;
    }
  }
  function feedback(kind = "success") {
    haptic(kind);
    sound(kind);
  }
  window.BarcodeFeedback = {
    sound,
    haptic,
    feedback,
    isSoundEnabled: () => preference("Sound"),
    isVibrationEnabled: () => preference("Vibration"),
  };
  let closeCurrent = () => {};
  function open(options = {}) {
    closeCurrent();
    const root = document.createElement("div");
    root.id = "barcode-root";
    document.body.append(root);
    let selectedDevice = "",
      torch = false,
      processing = false,
      lastCode = "",
      resumeTimer = null,
      closeTimer = null;
    root.dataset.mode = options.mode || "search";
    root.innerHTML = `<div class="modal-bg barcode-modal-bg"><section class="barcode-sheet" role="dialog" aria-modal="true" aria-labelledby="barcode-title"><header><div><h2 id="barcode-title">${esc(options.title || "Ler código de barras")}</h2><p>A câmera é usada somente para ler o código. Nenhuma imagem é enviada.</p></div><button type="button" data-barcode-close aria-label="Fechar leitor">${icon("x")}</button></header>${options.mode === "sale" ? `<button class="barcode-bag" type="button" data-barcode-bag aria-label="Abrir sacola">${icon("shopping-bag")}<span>Sacola: <b data-barcode-bag-count>0</b> itens</span></button>` : ""}<div class="barcode-camera"><video muted playsinline></video><div class="barcode-frame"><i></i></div><div class="barcode-loading">${icon("camera")}<b>Permitir acesso à câmera</b><span>Posicione o código dentro da área indicada.</span></div></div><div class="barcode-result" aria-live="polite" aria-atomic="true"><b data-barcode-status>Iniciando câmera…</b><strong data-barcode-value></strong></div><div class="barcode-product-result" hidden></div><div class="barcode-actions"><button type="button" data-barcode-torch hidden>${icon("flashlight")} Lanterna</button><button type="button" data-barcode-switch hidden>${icon("switch-camera")} Trocar câmera</button><button type="button" data-barcode-manual>${icon("keyboard")} Digitar manualmente</button></div><form class="barcode-manual" hidden><label>Código de barras<input name="barcode" inputmode="text" autocomplete="off" enterkeyhint="done"></label><button class="btn btn-primary">Usar código</button></form></section></div>`;
    const videoElement = root.querySelector("video"),
      status = root.querySelector("[data-barcode-status]"),
      value = root.querySelector("[data-barcode-value]"),
      loading = root.querySelector(".barcode-loading"),
      manual = root.querySelector(".barcode-manual"),
      resultPanel = root.querySelector(".barcode-product-result");
    root
      .querySelector(".barcode-actions")
      ?.insertAdjacentHTML(
        "beforeend",
        `<button type="button" data-barcode-sound aria-pressed="${preference("Sound")}">${icon(preference("Sound") ? "volume-2" : "volume-x")} Som</button><button type="button" data-barcode-vibration aria-pressed="${preference("Vibration")}">${icon(preference("Vibration") ? "vibrate" : "vibrate-off")} Vibração</button>`,
      );
    const close = () => {
      clearTimeout(resumeTimer);
      clearTimeout(closeTimer);
      BarcodeScannerService.stopScanner();
      root.remove();
      if (closeCurrent === close) closeCurrent = () => {};
      options.onClose?.();
    };
    closeCurrent = close;
    root.querySelector("[data-barcode-close]").onclick = close;
    const showError = (message) => {
      loading.hidden = false;
      loading.innerHTML = `${icon("camera-off")}<b>${esc(message)}</b><span>Use a entrada manual ou tente novamente.</span>`;
      status.textContent = "Leitor indisponível";
      BarcodeScannerService.stopScanner();
      window.lucide?.createIcons();
    };
    const bagCount = () =>
      [...document.querySelectorAll("[data-item-qty]")].reduce(
        (sum, input) => sum + Number(input.value || 0),
        0,
      ) ||
      Number(
        document.querySelector("#open-sale-summary")?.dataset.totalCount || 0,
      );
    const updateBag = () => {
      const count = root.querySelector("[data-barcode-bag-count]");
      if (count) count.textContent = String(bagCount());
    };
    const resume = (message = "Aponte para o próximo código") => {
      clearTimeout(resumeTimer);
      processing = false;
      lastCode = "";
      value.textContent = "";
      status.textContent = message;
      resultPanel.hidden = true;
      resultPanel.innerHTML = "";
      manual.hidden = true;
      BarcodeScannerService.resumeScanner();
    };
    const productDetails = (product) =>
      `<div class="barcode-product-card"><span class="barcode-product-icon">${icon("package-check")}</span><div><b>${esc(product.nome)}</b><small>${Number(product.preco || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })} · Estoque: ${Number(product.estoqueAtual || 0)}</small><small>${esc(product.barcode || lastCode)}</small></div></div>`;
    const showPersistent = (response, result) => {
      BarcodeScannerService.pauseScanner();
      resultPanel.hidden = false;
      if (response.unknown) {
        feedback("error");
        resultPanel.innerHTML = `<div class="barcode-state-icon error">${icon("scan-line")}</div><h3>Produto não encontrado</h3><p>O código <b>${esc(lastCode)}</b> ainda não está cadastrado neste aparelho.</p><div class="barcode-result-actions"><button class="btn btn-primary" data-barcode-register>Registrar produto</button><button class="btn btn-light" data-barcode-again>Ler outro</button><button class="btn btn-light" data-barcode-type>Digitar outro</button><button class="btn btn-light" data-barcode-close-result>Fechar</button></div>`;
      } else if (response.outOfStock) {
        feedback("error");
        resultPanel.innerHTML = `${productDetails(response.product)}<div class="barcode-state-icon warning">${icon("package-x")}</div><h3>Produto sem estoque</h3><p>Escolha como deseja continuar.</p><div class="barcode-result-actions"><button class="btn btn-primary" data-barcode-add-anyway>Adicionar mesmo assim</button><button class="btn btn-light" data-barcode-stock-adjust>Ajustar estoque</button><button class="btn btn-light" data-barcode-again>Cancelar</button></div>`;
      } else {
        feedback();
        resultPanel.innerHTML = `${productDetails(response.product)}<div class="barcode-status-pill">${esc(response.message || "Produto encontrado")}</div><div class="barcode-result-actions"><button class="btn btn-primary" data-barcode-view>Ver produto</button><button class="btn btn-light" data-barcode-stock-entry>Entrada de estoque</button><button class="btn btn-light" data-barcode-edit>Editar</button><button class="btn btn-light" data-barcode-again>Ler outro</button><button class="btn btn-light" data-barcode-close-result>Fechar</button></div>`;
      }
      const register = root.querySelector("[data-barcode-register]");
      if (register)
        register.onclick = () => {
          close();
          options.onRegister
            ? options.onRegister(lastCode, result.format)
            : window.ProductImages?.openForm?.(null, {
                barcode: lastCode,
                barcodeType: result.format,
              });
        };
      root
        .querySelector("[data-barcode-again]")
        ?.addEventListener("click", () => resume());
      root
        .querySelector("[data-barcode-type]")
        ?.addEventListener("click", () => {
          resultPanel.hidden = true;
          manual.hidden = false;
          manual.querySelector("input").value = "";
          manual.querySelector("input").focus();
        });
      root
        .querySelector("[data-barcode-close-result]")
        ?.addEventListener("click", close);
      root
        .querySelector("[data-barcode-add-anyway]")
        ?.addEventListener("click", () => {
          response.onAddAnyway?.();
          updateBag();
          resume("Produto adicionado. Aponte para o próximo código");
        });
      root
        .querySelector("[data-barcode-stock-adjust]")
        ?.addEventListener("click", () => {
          close();
          response.onAdjustStock?.();
        });
      root
        .querySelector("[data-barcode-view]")
        ?.addEventListener("click", () => {
          close();
          response.onView?.();
        });
      root
        .querySelector("[data-barcode-stock-entry]")
        ?.addEventListener("click", () => {
          close();
          response.onStockEntry?.();
        });
      root
        .querySelector("[data-barcode-edit]")
        ?.addEventListener("click", () => {
          close();
          response.onEdit?.();
        });
      window.lucide?.createIcons();
    };
    const animateToBag = () => {
      const bag = root.querySelector("[data-barcode-bag]");
      if (!bag || reducedMotion()) return;
      const dot = document.createElement("span");
      dot.className = "barcode-cart-fly";
      root.append(dot);
      const target = bag.getBoundingClientRect();
      dot.style.setProperty(
        "--barcode-fly-x",
        `${target.left + target.width / 2 - innerWidth / 2}px`,
      );
      dot.style.setProperty(
        "--barcode-fly-y",
        `${target.top + target.height / 2 - innerHeight / 2}px`,
      );
      dot.addEventListener("animationend", () => dot.remove(), { once: true });
      bag.classList.remove("bump");
      requestAnimationFrame(() => bag.classList.add("bump"));
    };
    const process = async (result) => {
      if (processing) return;
      processing = true;
      lastCode = result.value;
      status.textContent = "Código encontrado";
      value.textContent = result.value;
      try {
        const response = (await options.onDetected?.(result)) || {};
        status.textContent = response.message || "Código reconhecido";
        if (response.persistent || response.unknown || response.outOfStock) {
          showPersistent(response, result);
          return;
        }
        feedback(response.error ? "error" : "success");
        if (response.mode === "sale") {
          updateBag();
          animateToBag();
        }
        if (response.keepOpen) {
          resumeTimer = setTimeout(
            () => {
              if (root.isConnected) resume("Aponte para o próximo código");
            },
            Number(response.resumeDelay || 700),
          );
        } else closeTimer = setTimeout(close, 350);
      } catch (error) {
        feedback("error");
        processing = false;
        status.textContent =
          error.message || "Não foi possível processar o código";
        BarcodeScannerService.resumeScanner();
      }
    };
    const start = async () => {
      loading.hidden = false;
      status.textContent = "Iniciando câmera…";
      try {
        await BarcodeScannerService.startScanner({
          videoElement,
          deviceId: selectedDevice,
          duplicateDelay: options.duplicateDelay,
          onDetected: process,
          onReady: (info) => {
            loading.hidden = true;
            root.querySelector("[data-barcode-torch]").hidden = !info.torch;
            root.querySelector("[data-barcode-switch]").hidden =
              info.devices.length < 2;
          },
          onError: (error, message) =>
            showError(message || BarcodeScannerService.friendlyError(error)),
        });
      } catch {}
    };
    root.querySelector("[data-barcode-manual]").onclick = () => {
      BarcodeScannerService.pauseScanner();
      manual.hidden = false;
      manual.querySelector("input").focus();
    };
    manual.onsubmit = (event) => {
      event.preventDefault();
      const code = normalizeBarcode(
        new FormData(event.currentTarget).get("barcode"),
      );
      if (!code) return;
      manual.hidden = true;
      process({
        value: code,
        format: inferType(code) || "manual",
        detectedAt: new Date().toISOString(),
      });
    };
    root.querySelector("[data-barcode-bag]")?.addEventListener("click", () => {
      close();
      setTimeout(
        () => document.querySelector("#open-sale-summary")?.click(),
        60,
      );
    });
    root.querySelector("[data-barcode-torch]").onclick = async (event) => {
      torch = !torch;
      try {
        await BarcodeScannerService.toggleTorch(torch);
        event.currentTarget.classList.toggle("active", torch);
      } catch {
        torch = false;
      }
    };
    root.querySelector("[data-barcode-switch]").onclick = async () => {
      const devices = await BarcodeScannerService.listCameras();
      if (devices.length < 2) return;
      const current = devices.findIndex(
          (item) => item.deviceId === selectedDevice,
        ),
        next = devices[(current + 1) % devices.length];
      selectedDevice = next.deviceId;
      BarcodeScannerService.rememberCamera(selectedDevice);
      start();
    };
    root.querySelector("[data-barcode-sound]").onclick = (event) => {
      const enabled = !preference("Sound");
      localStorage.setItem("adiBarcodeSound", enabled ? "1" : "0");
      event.currentTarget.setAttribute("aria-pressed", String(enabled));
      event.currentTarget.innerHTML = `${icon(enabled ? "volume-2" : "volume-x")} Som`;
      if (enabled) sound();
      window.lucide?.createIcons();
    };
    root.querySelector("[data-barcode-vibration]").onclick = (event) => {
      const enabled = !preference("Vibration");
      localStorage.setItem("adiBarcodeVibration", enabled ? "1" : "0");
      event.currentTarget.setAttribute("aria-pressed", String(enabled));
      event.currentTarget.innerHTML = `${icon(enabled ? "vibrate" : "vibrate-off")} Vibração`;
      if (enabled) haptic();
      window.lucide?.createIcons();
    };
    updateBag();
    window.lucide?.createIcons();
    start();
    setTimeout(() => root.querySelector("[data-barcode-close]")?.focus(), 30);
  }
  const close = () => closeCurrent();
  window.BarcodeUI = { open, close };
  window.BarcodeScanner = {
    close,
    stop: close,
    isActive: BarcodeScannerService.isActive,
  };

  function updatePrimaryFab() {
    const fab = document.querySelector("#mobile-client-fab");
    if (!fab) return;
    const route =
      window.Router?.atual?.() || location.hash.split("/")[1] || "inicio";
    const actions = {
      inicio: { icon: "plus", label: "Ação rápida", action: "quick-action" },
      vender: { icon: "scan-barcode", label: "Escanear", action: "scan-sale" },
      clientes: { icon: "plus", label: "Novo cliente", action: "new-client" },
      produtos: {
        icon: "scan-barcode",
        label: "Ler código",
        action: "scan-product",
      },
      campanhas: {
        icon: "plus",
        label: "Campanhas",
        action: "new-campaign",
      },
    };
    const config = actions[route] || actions.inicio;
    fab.dataset.primaryAction = config.action;
    fab.setAttribute("aria-label", config.label);
    fab.innerHTML = `${icon(config.icon)}<span>${config.label}</span>`;
    window.lucide?.createIcons();
  }
  window.BarcodePrimaryFab = { update: updatePrimaryFab };

  const addSaleProduct = (product) => {
    if (product?.barcodeConflict) {
      Utils.toast(
        "Código duplicado. Corrija o cadastro antes de continuar.",
        true,
      );
      return false;
    }
    if (product?.variantId && product.variant) {
      if (!window.Checkout?.addSaleItem) return false;
      window.Checkout.addSaleItem(
        ProductVariations.saleItem(
          Produtos.obter(product.id),
          product.variant,
          1,
        ),
      );
      Utils.toast(`${product.nome} adicionado.`);
      return true;
    }
    const selector = `[data-add="${CSS.escape(String(product.id))}"]`,
      button = document.querySelector(selector);
    if (!button) return false;
    button.click();
    return true;
  };
  function stockSession(summary = { products: 0, units: 0 }) {
    open({
      mode: "stock",
      title: "Entrada por código de barras",
      onRegister: (barcode, barcodeType) =>
        ProductImages.openForm(null, {
          barcode,
          barcodeType,
          onSaved: (product) =>
            setTimeout(() => openStockQuantity(product, summary), 180),
        }),
      onDetected: async ({ value }) => {
        const product = await findAsync(value);
        if (!product)
          return {
            unknown: true,
            persistent: true,
            message: "Produto não encontrado neste aparelho.",
          };
        return {
          product,
          persistent: true,
          message: "Produto encontrado",
          onView: () => window.ProdutosMobile?.details?.(product.id),
          onStockEntry: () => openStockQuantity(product, summary),
          onEdit: () => window.ProdutosMobile?.productForm?.(product.id),
        };
      },
    });
  }
  function openStockQuantity(product, summary) {
    const root = document.querySelector("#modal"),
      current = Number(product.variant?.stock ?? product.estoqueAtual ?? 0);
    root.innerHTML = `<div class="modal-bg"><section class="modal-box barcode-stock-modal"><header class="modal-head"><h3>Entrada de estoque</h3><button class="icon-btn close">${icon("x")}</button></header><form><div class="modal-body"><p><b>${esc(product.nome)}</b></p><div class="barcode-stock-values"><span>Estoque atual<b>${current}</b></span><span>Novo estoque<b data-new-stock>${current + 1}</b></span></div><div class="field"><label>Quantidade de entrada</label><input name="quantidade" type="number" inputmode="numeric" min="1" step="1" value="1" required></div><div class="field"><label>Custo unitário opcional</label><input name="custo" type="number" inputmode="decimal" min="0" step=".01" value="${product.custo ?? ""}"></div><div class="field"><label>Observação</label><input name="observacao" value="Entrada por código de barras"></div><button type="button" class="btn btn-light barcode-adjust-instead" data-barcode-stock-adjust>${icon("sliders-horizontal")} Ajustar estoque em vez de adicionar</button><label class="check"><input name="continue" type="checkbox" checked> Continuar lendo produtos</label><small>${summary.products} produto(s) · ${summary.units} unidade(s) nesta sessão</small></div><footer class="modal-foot"><button type="button" class="btn btn-light close">Concluir</button><button class="btn btn-primary">Confirmar entrada</button></footer></form></section></div>`;
    const quantity = root.querySelector('[name="quantidade"]');
    quantity.oninput = () =>
      (root.querySelector("[data-new-stock]").textContent = String(
        current + Math.max(0, Number(quantity.value || 0)),
      ));
    root.querySelectorAll(".close").forEach(
      (button) =>
        (button.onclick = () => {
          root.innerHTML = "";
          Utils.toast(
            `${summary.products} produto(s) e ${summary.units} unidade(s) atualizados.`,
          );
        }),
    );
    root.querySelector("[data-barcode-stock-adjust]").onclick = () =>
      openStockAdjust(product, summary);
    root.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget),
        units = Number(data.get("quantidade"));
      product.variantId
        ? ProductVariations.stockChange({
            parentProductId: product.id,
            variantId: product.variantId,
            quantity: units,
            costUnitario: data.get("custo"),
            observation: data.get("observacao"),
            type: "entrada",
          })
        : Produtos.entrada(
            product.id,
            units,
            data.get("custo"),
            data.get("observacao"),
          );
      const next = {
        products: summary.products + 1,
        units: summary.units + units,
      };
      Utils.toast("Estoque atualizado.");
      data.has("continue")
        ? setTimeout(() => stockSession(next), 150)
        : (root.innerHTML = "");
    };
    window.lucide?.createIcons();
    quantity.focus();
  }
  function openStockAdjust(product, summary) {
    const root = document.querySelector("#modal"),
      current = Number(product.estoqueAtual || 0);
    root.innerHTML = `<div class="modal-bg"><section class="modal-box barcode-stock-modal"><header class="modal-head"><h3>Ajustar estoque</h3><button class="icon-btn close">${icon("x")}</button></header><form><div class="modal-body"><p><b>${esc(product.nome)}</b></p><div class="barcode-stock-values"><span>Estoque atual<b>${current}</b></span><span>Novo estoque<b data-adjust-preview>${current}</b></span></div><div class="field"><label>Novo estoque</label><input name="estoque" type="number" inputmode="decimal" step="1" value="${current}" required></div><div class="field"><label>Motivo do ajuste</label><input name="motivo" value="Ajuste por código de barras" required></div></div><footer class="modal-foot"><button type="button" class="btn btn-light close">Cancelar</button><button class="btn btn-primary">Salvar ajuste</button></footer></form></section></div>`;
    const stock = root.querySelector('[name="estoque"]');
    stock.oninput = () =>
      (root.querySelector("[data-adjust-preview]").textContent = String(
        Number(stock.value || 0),
      ));
    root.querySelectorAll(".close").forEach(
      (button) =>
        (button.onclick = () => {
          root.innerHTML = "";
          stockSession(summary);
        }),
    );
    root.querySelector("form").onsubmit = (event) => {
      event.preventDefault();
      const data = new FormData(event.currentTarget);
      Produtos.ajustarEstoque(
        product.id,
        Number(data.get("estoque")),
        data.get("motivo"),
      );
      Utils.toast("Estoque ajustado.");
      root.innerHTML = "";
      setTimeout(() => stockSession(summary), 150);
    };
    window.lucide?.createIcons();
    stock.focus();
    stock.select();
  }
  function sale() {
    open({
      mode: "sale",
      title: "Adicionar produto à venda",
      duplicateDelay: 900,
      onRegister: (barcode, barcodeType) =>
        ProductImages.openForm(null, {
          barcode,
          barcodeType,
          onSaved: (product) => {
            Router.ir("inicio");
            setTimeout(() => {
              Router.ir("vender");
              setTimeout(() => addSaleProduct(product), 180);
            }, 20);
          },
        }),
      onDetected: async ({ value }) => {
        const product = await findAsync(value);
        if (!product)
          return {
            unknown: true,
            persistent: true,
            message: "Produto não cadastrado.",
          };
        const add = () => addSaleProduct(product);
        if (
          !product.semControleEstoque &&
          Number(product.estoqueAtual || 0) <= 0
        )
          return {
            product,
            outOfStock: true,
            persistent: true,
            onAddAnyway: add,
            onAdjustStock: () =>
              openStockAdjust(product, { products: 0, units: 0 }),
          };
        if (!add())
          return {
            keepOpen: true,
            error: true,
            resumeDelay: 1000,
            message: "Abra a tela Vender para adicionar produtos.",
          };
        const quantity = Number(
          document.querySelector(
            `[data-pos-qty="${CSS.escape(String(product.id))}"]`,
          )?.textContent ||
            document.querySelector(
              `[data-item-qty="${CSS.escape(String(product.id))}"]`,
            )?.value ||
            1,
        );
        return {
          mode: "sale",
          keepOpen: true,
          resumeDelay: 650,
          message:
            quantity > 1
              ? `${product.nome} · quantidade atualizada para ${quantity}`
              : `${product.nome} adicionado · quantidade 1`,
        };
      },
    });
  }
  function productLookup() {
    open({
      mode: "products",
      title: "Localizar produto",
      duplicateDelay: 1800,
      onRegister: (barcode, barcodeType) =>
        ProductImages.openForm(null, {
          barcode,
          barcodeType,
          onSaved: (product) =>
            setTimeout(() => window.ProdutosMobile?.details?.(product.id), 100),
        }),
      onDetected: async ({ value }) => {
        const product = await findAsync(value);
        if (!product)
          return {
            unknown: true,
            persistent: true,
            message: "Produto não encontrado neste aparelho.",
          };
        return {
          product,
          persistent: true,
          message: "Produto encontrado",
          onView: () => window.ProdutosMobile?.details?.(product.id),
          onStockEntry: () => window.ProdutosMobile?.stockEntry?.(product.id),
          onEdit: () => window.ProdutosMobile?.productForm?.(product.id),
        };
      },
    });
  }
  function search() {
    open({
      mode: "search",
      title: "Buscar por código",
      onDetected: async ({ value }) => {
        const product = await findAsync(value);
        if (!product) return { unknown: true, persistent: true };
        window.ProdutosMobile?.search?.(value);
        setTimeout(() => window.ProdutosMobile?.details?.(product.id), 100);
        return { message: `${product.nome} encontrado` };
      },
    });
  }
  window.BarcodeWorkflows = {
    sale,
    stock: () => stockSession(),
    productLookup,
    search,
    find,
    findAsync,
    addSaleProduct,
  };

  document.addEventListener("click", (event) => {
    if (event.target.closest("[data-scan-sale],#scan-sale-barcode")) sale();
    if (event.target.closest("[data-scan-product]")) productLookup();
    if (event.target.closest("[data-scan-stock]")) stockSession();
  });
  document.addEventListener("keydown", (event) => {
    if (
      event.key !== "Enter" ||
      !event.target.matches("#product-search,#mobile-product-search,#search")
    )
      return;
    const code = normalizeBarcode(event.target.value),
      product = find(code);
    if (!product) return;
    event.preventDefault();
    if (location.hash.includes("vender")) addSaleProduct(product);
    else {
      window.ProdutosMobile?.applyFilter?.();
      window.ProdutosMobile?.search?.(code);
      window.ProdutosMobile?.details?.(product.id);
    }
  });
  addEventListener("hashchange", () => {
    if (BarcodeScannerService.isActive()) close();
    setTimeout(updatePrimaryFab, 0);
  });
  addEventListener("firebase-session-cleared", () => {
    close();
    indexBusiness = "";
    indexReady = false;
    indexMap.clear();
    lastDetectedBarcode = "";
    lastDetectedAt = 0;
  });
  addEventListener("cloud-data-updated", (event) => {
    if (!event.detail?.collection || event.detail.collection === "products")
      invalidate();
  });
  window.AppLifecycle?.onBackground?.(() => {
    if (BarcodeScannerService.isActive()) close();
  });
  addEventListener("DOMContentLoaded", updatePrimaryFab, { once: true });
})();
