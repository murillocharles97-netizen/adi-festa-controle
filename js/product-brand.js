// Marca do produto: atributo próprio (nunca parte do nome), opcional por padrão.
// Regra única POR EMPRESA "Exigir marca no cadastro" em config.productRules.brandRequired,
// sincronizada com settings/default. Vale só para produtos NOVOS, em todos os espaços;
// o servidor (commitOperationalSync e createSpreadsheetProducts) aplica a mesma regra.
window.ProductBrand = (() => {
  const MAX = 80;
  const text = (value) => String(value ?? "").trim().replace(/\s+/g, " ").slice(0, MAX);
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
  const config = () => window.DB?.carregar?.()?.config || {};
  const isRequired = (cfg = config()) => cfg?.productRules?.brandRequired === true;
  const message = "Esta empresa exige Marca ao cadastrar produtos. Informe a marca.";
  // Só nos fluxos de cadastro novo. Retorna a marca normalizada ou lança erro claro.
  function assertNew(product = {}, cfg) {
    const marca = text(product.marca);
    if (!marca && isRequired(cfg)) throw Object.assign(Error(message), { code: "brand-required" });
    return marca;
  }
  // Planilha sem coluna Marca: com a regra ativa, linhas de criação ficam inválidas (o servidor também recusa).
  function applySpreadsheetRule(preview, cfg) {
    if (!preview?.rows || !isRequired(cfg)) return preview;
    let blocked = 0;
    const rows = preview.rows.map((row) => {
      if (row.status !== "create") return row;
      blocked += 1;
      return { ...row, status: "invalid", errors: [...(row.errors || []), "Esta empresa exige Marca ao cadastrar produtos e a planilha não tem coluna Marca. Cadastre este produto pelo formulário."] };
    });
    if (!blocked) return preview;
    const counts = { ...(preview.counts || {}) };
    counts.creates = Math.max(0, Number(counts.creates || 0) - blocked);
    counts.invalid = Number(counts.invalid || 0) + blocked;
    counts.errors = Number(counts.errors || 0) + blocked;
    return { ...preview, rows, counts, brandBlocked: blocked };
  }
  const canManage = () => !window.TeamAccess || window.TeamAccess.has("settings.manage");
  function setRequired(required) {
    if (!canManage()) throw window.VeconiPermissionPolicy?.denied?.("settings.manage") || Error("Seu perfil não pode alterar as regras de produtos.");
    window.DB.alterar((db) => {
      db.config.productRules = { ...(db.config.productRules || {}), brandRequired: required === true,
        updatedAt: new Date().toISOString(), updatedBy: window.FirebaseSession?.user?.uid || "local" };
    });
    refreshFields();
    return required === true;
  }
  // Campo do formulário. data-brand-new marca cadastro novo: só ele acompanha a regra.
  function field(product = {}, { isNew = false } = {}) {
    const required = isNew && isRequired();
    return `<div class="field" data-brand-field><label>Marca<span data-brand-star>${required ? " *" : ""}</span></label><input name="marca" maxlength="${MAX}" autocomplete="off" value="${esc(product.marca || "")}" placeholder="Ex.: marca do fabricante"${isNew ? " data-brand-new" : ""}${required ? " required" : ""}></div>`;
  }
  // Formulários abertos acompanham a regra atual (mudança local ou vinda de outro aparelho).
  function refreshFields(root = globalThis.document) {
    const required = isRequired();
    root?.querySelectorAll?.("input[name=marca][data-brand-new]").forEach((input) => {
      input.required = required;
      const star = input.closest("[data-brand-field]")?.querySelector("[data-brand-star]");
      if (star) star.textContent = required ? " *" : "";
    });
  }
  const summary = (cfg) => (isRequired(cfg) ? "Marca obrigatória em novos produtos" : "Marca opcional");
  function open() {
    if (!canManage()) return window.Utils?.toast?.("Seu perfil não pode alterar as regras de produtos.", true);
    const root = document.querySelector("#modal");
    if (!root) return;
    root.innerHTML = `<div class="modal-bg"><section class="modal-box product-brand-rules"><header class="modal-head"><div><small>Configurações</small><h3>Produtos</h3></div><button class="icon-btn" type="button" data-brand-close aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="modal-body"><label class="check" style="display:flex;gap:10px;align-items:center;padding:10px 0"><input type="checkbox" data-brand-required ${isRequired() ? "checked" : ""}> <span><b>Exigir marca no cadastro</b></span></label><p>Vale para todos os espaços da empresa. Novos produtos só podem ser cadastrados com a marca preenchida. Produtos antigos continuam disponíveis e podem ser editados normalmente.</p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-brand-close>Fechar</button></footer></section></div>`;
    window.lucide?.createIcons?.();
    root.querySelectorAll("[data-brand-close]").forEach((b) => (b.onclick = () => { root.innerHTML = ""; if (window.Router?.atual?.() === "configuracoes") window.Router.ir("configuracoes"); }));
    const input = root.querySelector("[data-brand-required]");
    input.onchange = () => {
      try { setRequired(input.checked); window.Utils?.toast?.(input.checked ? "Marca agora é obrigatória para novos produtos." : "Marca voltou a ser opcional."); }
      catch (error) { input.checked = !input.checked; window.Utils?.toast?.(error.message || "Não foi possível salvar.", true); }
    };
  }
  if (typeof addEventListener === "function") for (const name of ["operational-remote-invalidation", "firebase-sync-status"]) addEventListener(name, () => refreshFields());
  return { MAX, text, isRequired, assertNew, applySpreadsheetRule, setRequired, field, refreshFields, summary, open, canManage };
})();
