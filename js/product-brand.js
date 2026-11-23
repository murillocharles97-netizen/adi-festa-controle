// Marca do produto: atributo próprio (nunca parte do nome), opcional por padrão.
// Regra única POR EMPRESA "Exigir marca no cadastro" (settings/default.productRules.brandRequired).
// Vale só para produtos físicos NOVOS, em todos os espaços; serviços não exigem marca.
// A regra é lida e alterada SOMENTE pelo servidor (commitOperationalSync kind "product_rules"):
// não há gravação local otimista, e um estado ainda não confirmado nunca é tratado como "desligada".
window.ProductBrand = (() => {
  const MAX = 80;
  const text = (value) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const config = () => window.DB?.carregar?.()?.config || {};
  const businessId = () => window.BusinessContext?.get?.()?.businessId || "";
  const online = () => globalThis.navigator?.onLine !== false;
  const snapshotKey = (bid) => `veconi:productRules:v1:${bid}`;
  const MESSAGE = "Esta empresa exige Marca ao cadastrar produtos. Informe a marca.";
  const UNKNOWN = "Não foi possível confirmar se esta empresa exige Marca. Informe a marca ou conecte-se para confirmar a regra.";
  const PENDING = "Confirmação pendente: não foi possível saber se o servidor gravou a alteração. Novos produtos pedem a marca até a confirmação.";
  const SESSION_TTL = 600000;
  const pendingKey = (bid) => `veconi:productRules:pending:v1:${bid}`;
  const userId = () => window.SyncFirebase?.sessionUserId?.() || null;
  const codeOf = (error) => String(error?.code || "").replace(/^functions\//, "");
  // Recusas explícitas do servidor (nada foi gravado). Qualquer outra falha é resultado inconclusivo.
  const DEFINITIVE = new Set(["invalid-argument", "failed-precondition", "permission-denied", "unauthenticated", "already-exists", "not-found", "out-of-range"]);
  // Concorrência: cada consulta recebe um número de sequência. Uma resposta só vale se a consulta começou
  // depois da última barreira (início E fim de cada alteração), depois do último resultado aceito, sem
  // alteração em andamento e na mesma empresa/conta/tentativa pendente. Resposta antiga nunca sobrescreve.
  let session = { bid: "", uid: null, at: 0 }, inflight = null, seq = 0, barrier = 0, accepted = 0, writing = 0;
  const newAttemptId = () => {
    try { if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID().replace(/-/g, ""); } catch {}
    const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
  };
  const resetSession = () => { session = { bid: "", uid: null, at: 0 }; };

  function readSnapshot(bid = businessId()) {
    if (!bid) return null;
    try {
      const value = JSON.parse(globalThis.localStorage?.getItem?.(snapshotKey(bid)) || "null");
      return value?.version === 1 && value.businessId === bid && typeof value.brandRequired === "boolean" ? value : null;
    } catch { return null; }
  }
  function readPending(bid = businessId()) {
    if (!bid) return null;
    try {
      const value = JSON.parse(globalThis.localStorage?.getItem?.(pendingKey(bid)) || "null");
      return value?.version === 2 && value.businessId === bid && typeof value.wanted === "boolean" && /^[A-Za-z0-9_-]{16,64}$/.test(value.attemptId || "") ? value : null;
    } catch { return null; }
  }
  // Pendência vinculada à tentativa: só o recibo DESTA tentativa no servidor a encerra como gravada.
  const writePending = (bid, wanted, attemptId, uid) => { try { globalThis.localStorage?.setItem?.(pendingKey(bid), JSON.stringify({ version: 2, businessId: bid, wanted, attemptId, uid, at: new Date().toISOString() })); } catch {} };
  const clearPending = (bid) => { try { globalThis.localStorage?.removeItem?.(pendingKey(bid)); } catch {} };
  // "Confirmada" só vale para a mesma empresa, a mesma conta autenticada e dentro do prazo da sessão.
  const sessionFresh = (bid) => session.bid === bid && session.at > 0 && Date.now() - session.at < SESSION_TTL && !!session.uid && session.uid === userId();
  // Estado real da regra: pendente, confirmado pelo servidor, recebido pela sincronização ou desconhecido.
  function state() {
    const bid = businessId(), snap = readSnapshot(bid), local = config().productRules, pending = readPending(bid);
    if (pending) return { status: "pending", required: null, wanted: pending.wanted, since: pending.at, attemptId: pending.attemptId, canResend: !!pending.uid && pending.uid === userId() };
    const localKnown = local && typeof local.brandRequired === "boolean";
    if (snap && (!localKnown || String(snap.updatedAt || "") >= String(local.updatedAt || ""))) {
      const fresh = sessionFresh(bid);
      return { status: fresh ? "confirmed" : "cached", required: snap.brandRequired, updatedAt: snap.updatedAt || null, confirmedAt: snap.confirmedAt };
    }
    if (localKnown) return { status: "synced", required: local.brandRequired, updatedAt: local.updatedAt || null };
    return { status: "unknown", required: null };
  }
  const isRequired = () => state().required === true;
  // Conservador: regra ativa OU ainda desconhecida pede a marca.
  const mustAsk = () => state().required !== false;
  const isService = (product) => product?.itemKind === "service";

  // Só nos fluxos de cadastro novo. Retorna a marca normalizada ou lança erro claro.
  function assertNew(product = {}) {
    const marca = text(product.marca);
    if (marca || isService(product)) return marca;
    const current = state();
    if (current.required === true) throw Object.assign(Error(MESSAGE), { code: "brand-required" });
    if (current.required === null) throw Object.assign(Error(UNKNOWN), { code: "brand-rule-unknown" });
    return marca;
  }
  // Planilha sem coluna Marca: com a regra ativa (ou desconhecida), linhas de criação ficam inválidas.
  function applySpreadsheetRule(preview) {
    if (!preview?.rows || !mustAsk()) return preview;
    const reason = isRequired() ? "Esta empresa exige Marca ao cadastrar produtos e a planilha não tem coluna Marca. Cadastre este produto pelo formulário." : UNKNOWN;
    let blocked = 0;
    const rows = preview.rows.map((row) => {
      if (row.status !== "create") return row;
      blocked += 1;
      return { ...row, status: "invalid", errors: [...(row.errors || []), reason] };
    });
    if (!blocked) return preview;
    const counts = { ...(preview.counts || {}) };
    counts.creates = Math.max(0, Number(counts.creates || 0) - blocked);
    counts.invalid = Number(counts.invalid || 0) + blocked;
    counts.errors = Number(counts.errors || 0) + blocked;
    return { ...preview, rows, counts, brandBlocked: blocked };
  }
  const canManage = () => !window.TeamAccess || window.TeamAccess.has("settings.manage");
  const call = (data) => window.FirebaseCallable("commitOperationalSync", { ...data, businessId: businessId(),
    workspaceGeneration: window.DB?.getWorkspaceGeneration?.() ?? 0, syncProtocolVersion: 1, clientRelease: Number(window.AdiFestaBuild?.release || 0) });
  function accept(reply, bid) {
    const value = reply?.data ?? reply;
    if (value?.version !== 1 || value.confirmed !== true || value.businessId !== bid || typeof value.brandRequired !== "boolean")
      throw Object.assign(Error("A resposta do servidor não confirmou a regra. Nada foi considerado salvo."), { code: "brand-rule-unconfirmed" });
    if (businessId() !== bid) throw Object.assign(Error("A empresa ativa mudou. Nada foi considerado salvo."), { code: "brand-rule-unconfirmed" });
    const snap = { version: 1, businessId: bid, brandRequired: value.brandRequired, updatedAt: value.updatedAt || null, confirmedAt: new Date().toISOString() };
    try { globalThis.localStorage?.setItem?.(snapshotKey(bid), JSON.stringify(snap)); } catch {}
    clearPending(bid);
    session = { bid, uid: userId(), at: Date.now() };
    refreshFields();
    return state();
  }
  // Confirma a regra no servidor (leitura autorizada). Com alteração pendente, consulta o recibo DA TENTATIVA:
  // só "applied" encerra a pendência; ler o valor anterior nunca prova que a gravação falhou.
  function refresh({ force = false } = {}) {
    const bid = businessId();
    if (!bid || !online() || typeof window.FirebaseCallable !== "function") { if (!online()) resetSession(); return Promise.resolve(state()); }
    const pending = readPending(bid), attemptId = pending?.attemptId || null, uid = userId();
    if (!force && !pending && sessionFresh(bid) && Date.now() - session.at < 300000) return Promise.resolve(state());
    if (inflight && inflight.seq > barrier && !writing && inflight.bid === bid && inflight.uid === uid && inflight.attemptId === attemptId) return inflight.promise;
    const mine = { seq: ++seq, bid, uid, attemptId };
    const current = () => mine.seq > barrier && mine.seq > accepted && !writing && businessId() === bid && userId() === uid && (readPending(bid)?.attemptId || null) === attemptId;
    mine.promise = call({ kind: "product_rules", ...(attemptId ? { attemptId } : {}) })
      .then((reply) => {
        if (!current()) return state();
        const value = reply?.data ?? reply;
        if (attemptId && (value?.attemptId !== attemptId || value.attempt !== "applied")) return state();
        accepted = mine.seq;
        return accept(reply, bid);
      })
      .catch(() => { if (current()) resetSession(); return state(); })
      .finally(() => { if (inflight === mine) inflight = null; });
    inflight = mine;
    return mine.promise;
  }
  // Alteração só conta como salva com o recibo desta tentativa (attemptId) confirmado pelo servidor.
  // Resposta inconclusiva: fica "pendente" e a configuração travada; a reconciliação consulta o recibo
  // da tentativa e o reenvio usa a MESMA tentativa (o servidor reconhece e não regrava).
  async function setRequired(required) {
    if (!canManage()) throw window.VeconiPermissionPolicy?.denied?.("settings.manage") || Error("Seu perfil não pode alterar as regras de produtos.");
    if (typeof required !== "boolean") throw Error("Valor da regra inválido.");
    if (!online()) throw Object.assign(Error("Sem conexão: a regra não foi alterada. Conecte-se para alterar e confirmar no servidor."), { code: "offline" });
    if (writing) throw Object.assign(Error("Uma alteração já está aguardando o servidor."), { code: "brand-rule-pending" });
    const bid = businessId(), uid = userId(), pending = readPending(bid);
    if (pending && (pending.wanted !== required || pending.uid !== uid))
      throw Object.assign(Error("Há uma alteração pendente de confirmação. Conclua-a antes de mudar a regra."), { code: "brand-rule-pending" });
    const attemptId = pending?.attemptId || newAttemptId(), resend = Boolean(pending);
    barrier = ++seq; writing += 1;
    if (!resend) writePending(bid, required, attemptId, uid);
    let reply;
    try { reply = await call({ kind: "product_rules", brandRequired: required, attemptId }); }
    catch (error) {
      if (DEFINITIVE.has(codeOf(error))) {
        if (codeOf(error) === "unauthenticated") resetSession();
        if (!resend) {
          clearPending(bid); refreshFields();
          throw Object.assign(Error(`${error.message || "O servidor recusou a alteração"}. A regra não foi alterada.`), { code: codeOf(error), definitive: true });
        }
        refreshFields();
        throw Object.assign(Error(`${error.message || "O servidor recusou o reenvio"}. A alteração anterior continua aguardando confirmação.`), { code: "brand-rule-pending" });
      }
    } finally { writing -= 1; barrier = ++seq; }
    const value = reply?.data ?? reply;
    if (value?.attemptId === attemptId && value.attempt === "applied" && businessId() === bid && userId() === uid) {
      try { accepted = barrier; return { ...accept(reply, bid), reconciled: false, replayed: value.replayed === true }; } catch {}
    }
    if (businessId() !== bid) throw Object.assign(Error(PENDING), { code: "brand-rule-pending" });
    const reconciled = await refresh({ force: true });
    if (reconciled.status === "confirmed") return { ...reconciled, reconciled: true };
    refreshFields();
    throw Object.assign(Error(PENDING), { code: "brand-rule-pending" });
  }
  // Reenvio explícito da MESMA tentativa pendente (idempotente no servidor).
  function resendPending() {
    const pending = readPending();
    if (!pending) return Promise.reject(Object.assign(Error("Não há alteração pendente."), { code: "not-pending" }));
    return setRequired(pending.wanted);
  }

  // Cadastros offline recusados por falta de Marca (somente leitura da fila; o original nunca é editado).
  function recoveryCandidates() {
    const items = window.SyncFirebase?.brandRecoveryCandidates?.() || [];
    return items.map((item) => ({ item, products: (item.payload?.writes || []).filter((w) => w?.entityType === "products" && w.operation === "create" && !isService(w.data) && !text(w.data?.marca)).map((w) => ({ id: w.entityId, nome: w.data?.nome || "Produto" })) })).filter((entry) => entry.products.length);
  }
  const LOCAL_PENDING = "Cadastro confirmado na nuvem. Existe uma alteração pendente neste aparelho.";
  // Recuperação explícita: o servidor confere o recibo da MESMA operação antes de aplicar e audita.
  async function recoverOffline(operationId, brands) {
    if (!online()) throw Object.assign(Error("Sem conexão: nada foi enviado. O cadastro original continua preservado."), { code: "offline" });
    // Recibo já confirmado e registrado, conclusão local interrompida: retoma SOMENTE esta operação, sem envio.
    if ((window.SyncFirebase?.brandRecoveryResolved?.() || []).some((row) => row.operationId === operationId)) {
      let resumed;
      try { resumed = await window.SyncFirebase.confirmBrandRecovery(operationId); } catch { resumed = null; }
      return { operationId, status: resumed?.status === "applied" ? "applied" : "pending", resumed: true, localPending: resumed?.localPending || [] };
    }
    const entry = recoveryCandidates().find((row) => row.item.operationId === operationId);
    if (!entry) throw Error("Este cadastro não está mais pendente de Marca. Nada foi enviado.");
    const clean = {};
    for (const product of entry.products) {
      const marca = text(brands?.[product.id]);
      if (!marca) throw Object.assign(Error(`Informe a marca de "${product.nome}". Nada foi enviado.`), { code: "brand-required" });
      clean[product.id] = marca;
    }
    let value = null;
    try { const reply = await call({ kind: "brand_recovery_apply", item: entry.item, brands: clean, confirmed: true }); value = reply?.data ?? reply; }
    catch (error) { if (DEFINITIVE.has(codeOf(error))) throw error; }
    // Confere SOMENTE o recibo desta operação; nenhuma outra operação da fila é enviada ou alterada.
    let check;
    try { check = await window.SyncFirebase?.confirmBrandRecovery?.(operationId); } catch { check = null; }
    if (check?.status === "applied") return { operationId, status: "applied", replayed: value?.replayed === true, localPending: check.localPending || [] };
    return { operationId, status: "pending" };
  }

  // Campo do formulário. data-brand-new marca cadastro novo: só ele acompanha a regra.
  function field(product = {}, { isNew = false } = {}) {
    const required = isNew && !isService(product) && mustAsk();
    return `<div class="field" data-brand-field><label>Marca<span data-brand-star>${required ? " *" : ""}</span></label><input name="marca" maxlength="${MAX}" autocomplete="off" value="${esc(product.marca || "")}" placeholder="Ex.: marca do fabricante"${isNew ? " data-brand-new" : ""}${required ? " required" : ""}></div>`;
  }
  // Formulários abertos acompanham a regra atual e o tipo de item (serviço não exige).
  function refreshFields(root = globalThis.document) {
    const ask = mustAsk();
    root?.querySelectorAll?.("input[name=marca][data-brand-new]").forEach((input) => {
      const required = ask && input.form?.elements?.itemKind?.value !== "service";
      input.required = required;
      const star = input.closest("[data-brand-field]")?.querySelector("[data-brand-star]");
      if (star) star.textContent = required ? " *" : "";
    });
  }
  const summary = () => {
    const current = state();
    if (current.required === null) return "Regra de marca não confirmada";
    return current.required ? "Marca obrigatória em novos produtos" : "Marca opcional";
  };
  function describe(current) {
    const when = (iso) => { try { return new Date(iso).toLocaleString("pt-BR"); } catch { return iso; } };
    if (current.status === "pending") return PENDING;
    if (current.status === "confirmed" && online()) return "Confirmada pelo servidor agora.";
    if (current.status === "confirmed") return "Confirmada pelo servidor nesta sessão. Sem conexão no momento: a regra não pode ser alterada.";
    if (current.status === "cached") return `Última confirmação do servidor: ${when(current.confirmedAt)}.${online() ? "" : " Sem conexão no momento."}`;
    if (current.status === "synced") return "Recebida pela sincronização da empresa.";
    return online() ? "Ainda não confirmada pelo servidor." : "Ainda não confirmada: sem conexão. Novos produtos pedem a marca até a confirmação.";
  }
  function render(root, notice = "") {
    const current = state(), locked = current.required === null || !online() || !canManage();
    const pending = recoveryCandidates(), resumable = window.SyncFirebase?.brandRecoveryResolved?.() || [];
    const resend = current.status === "pending" && current.canResend && online() && canManage() ? `<p><button class="btn" type="button" data-brand-resend>Reenviar a mesma alteração</button> O servidor reconhece esta tentativa e não grava duas vezes.</p>` : "";
    const resume = resumable.length ? `<hr><h4>Cadastros confirmados pelo servidor</h4><p>O recibo já foi conferido; falta concluir a cópia deste aparelho. Nada é reenviado.</p>${resumable.map((row) => `<button class="btn" type="button" data-brand-resume="${esc(row.operationId)}">Concluir neste aparelho</button>`).join(" ")}` : "";
    const recovery = pending.length ? `<hr><h4>Cadastros recusados por falta de Marca</h4><p>Criados sem conexão antes da exigência. O original continua preservado; o servidor confere o recibo antes de concluir.</p>${pending.map(({ item, products }) => `<form data-brand-recover="${esc(item.operationId)}">${products.map((p) => `<div class="field"><label>Marca de ${esc(p.nome)} *</label><input name="${esc(p.id)}" maxlength="${MAX}" required></div>`).join("")}<button class="btn" type="submit">Concluir cadastro com a marca</button></form>`).join("")}` : "";
    root.innerHTML = `<div class="modal-bg"><section class="modal-box product-brand-rules"><header class="modal-head"><div><small>Configurações</small><h3>Produtos</h3></div><button class="icon-btn" type="button" data-brand-close aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="modal-body"><label class="check" style="display:flex;gap:10px;align-items:center;padding:10px 0"><input type="checkbox" data-brand-required ${current.required === true ? "checked" : ""} ${locked ? "disabled" : ""}> <span><b>Exigir marca no cadastro</b></span></label><p data-brand-state>${esc(describe(current))}</p><p>Vale para todos os espaços da empresa. Novos produtos físicos só podem ser cadastrados com a marca preenchida; serviços não exigem marca. Produtos antigos continuam disponíveis e podem ser editados normalmente.</p>${resend}<p data-brand-notice role="status">${esc(notice)}</p>${resume}${recovery}</div><footer class="modal-foot"><button class="btn btn-light" type="button" data-brand-close>Fechar</button></footer></section></div>`;
    window.lucide?.createIcons?.();
    root.querySelectorAll("[data-brand-close]").forEach((b) => (b.onclick = () => { root.innerHTML = ""; if (window.Router?.atual?.() === "configuracoes") window.Router.ir("configuracoes"); }));
    const input = root.querySelector("[data-brand-required]");
    input.onchange = async () => {
      const wanted = input.checked;
      input.disabled = true;
      root.querySelector("[data-brand-notice]").textContent = "Salvando… aguardando confirmação do servidor.";
      try {
        const out = await setRequired(wanted);
        const msg = out.required ? "marca obrigatória para novos produtos" : "marca opcional";
        window.Utils?.toast?.(`Confirmado pelo servidor: ${msg}.`, out.required !== wanted);
        render(root, !out.reconciled ? "Alteração confirmada pelo servidor."
          : out.required === wanted ? "A resposta se perdeu, mas o servidor confirmou a alteração." : `A resposta se perdeu; o servidor informa agora: ${msg}. Abra novamente para conferir.`);
      } catch (error) {
        window.Utils?.toast?.(error.message || "Não foi possível salvar.", true);
        render(root, error.code === "brand-rule-pending" ? PENDING : `Não alterada: ${error.message || "erro ao salvar"}`);
      }
    };
    const resendBtn = root.querySelector("[data-brand-resend]");
    if (resendBtn) resendBtn.onclick = async () => {
      resendBtn.disabled = true;
      try { await resendPending(); render(root, "Alteração confirmada pelo servidor."); }
      catch (error) { render(root, error.code === "brand-rule-pending" ? error.message : `Não alterada: ${error.message || "erro ao salvar"}`); }
    };
    root.querySelectorAll("[data-brand-resume]").forEach((btn) => (btn.onclick = async () => {
      btn.disabled = true;
      const out = await recoverOffline(btn.dataset.brandResume, {}).catch(() => ({ status: "pending" }));
      render(root, out.status === "applied" ? (out.localPending?.length ? LOCAL_PENDING : "Cadastro concluído neste aparelho, conforme o recibo do servidor.") : "Confirmação pendente: o recibo ainda não pôde ser conferido. Nada foi reenviado.");
    }));
    root.querySelectorAll("[data-brand-recover]").forEach((form) => (form.onsubmit = async (event) => {
      event.preventDefault();
      const brands = Object.fromEntries([...form.querySelectorAll("input")].map((i) => [i.name, i.value]));
      if (!globalThis.confirm?.("Concluir este cadastro com a marca informada? O servidor confere o recibo da operação original antes de gravar.")) return;
      form.querySelector("button").disabled = true;
      try {
        const out = await recoverOffline(form.dataset.brandRecover, brands);
        render(root, out.status !== "applied" ? "Confirmação pendente: o recibo desta operação ainda não pôde ser conferido. O original continua preservado; repita quando houver conexão (a mesma operação não é duplicada)."
          : out.localPending?.length ? LOCAL_PENDING : out.replayed ? "A nuvem já registrava esta operação; nada foi reaplicado. Recibo conferido." : "Cadastro concluído e confirmado pelo recibo do servidor.");
      } catch (error) { render(root, `Não concluído: ${error.message}`); }
    }));
  }
  const canOpen = () => canManage() || recoveryCandidates().length > 0;
  function open() {
    if (!canOpen()) return window.Utils?.toast?.("Seu perfil não pode alterar as regras de produtos.", true);
    const root = document.querySelector("#modal");
    if (!root) return;
    render(root, online() ? "Conferindo a regra no servidor…" : "");
    refresh({ force: true }).then(() => { if (root.querySelector(".product-brand-rules")) render(root); });
  }
  if (typeof addEventListener === "function") {
    for (const name of ["operational-remote-invalidation", "firebase-sync-status"]) addEventListener(name, () => { refreshFields(); if (online() && window.SyncFirebase?.isReady?.()) refresh(); });
    globalThis.document?.addEventListener?.("change", (event) => { if (event.target?.name === "itemKind") refreshFields(); });
  }
  return { MAX, text, state, isRequired, mustAsk, assertNew, applySpreadsheetRule, setRequired, resendPending, refresh, recoveryCandidates, recoverOffline, field, refreshFields, summary, open, canManage, canOpen };
})();
