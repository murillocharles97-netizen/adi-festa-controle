(function () {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector),
    $$ = (selector, root = document) => [...root.querySelectorAll(selector)],
    esc = (value) => window.Utils?.escapar?.(String(value ?? "")) ?? String(value ?? ""),
    icon = (name) => `<i data-lucide="${name}"></i>`;
  const state = { members: [], invites: [], loading: false, error: "" };
  const permissionLabels = {
    "sales.create": "Criar vendas", "sales.cancel": "Cancelar vendas", "sales.viewAll": "Ver vendas da equipe",
    "customers.view": "Ver clientes", "customers.edit": "Editar clientes", "customers.receiveDebt": "Receber fiado",
    "customers.adjustBalance": "Ajustar saldo", "products.view": "Ver produtos", "products.edit": "Editar produtos",
    "inventory.view": "Ver estoque", "inventory.adjust": "Ajustar estoque", "financial.view": "Ver Financeiro",
    "reports.view": "Ver desempenho", "profit.view": "Ver lucro", "cost.view": "Ver custos",
    "team.view": "Ver equipe", "team.manage": "Gerenciar equipe", "settings.manage": "Gerenciar configurações",
    "billing.manage": "Gerenciar plano", "spaces.manage": "Gerenciar espaços",
  };
  const initials = (name) => String(name || "?").trim().split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
  const roleLabel = (role) => window.TeamAccess?.ROLE_LABELS?.[role] || role || "Funcionário";
  const statusLabel = (status) => ({ active: "Ativo", invited: "Convite pendente", pending: "Convite pendente", disabled: "Desativado" })[status] || status;
  function spacesLabel(item) {
    if (item.spaceAccess === "all" || item.role === "owner") return "Todos os espaços";
    const ids = item.allowedSpaceIds || [], spaces = window.SpaceContext?.list?.() || [], names = ids.map((id) => spaces.find((space) => space.id === id)?.name).filter(Boolean);
    if (names.length === 1) return names[0];
    return `${names.length || ids.length} espaços`;
  }
  function summary() {
    const members = state.members.length, active = state.members.filter((item) => item.status === "active").length,
      pending = state.invites.length;
    return `<div class="team-summary"><span><b>${members}</b><small>membro${members === 1 ? "" : "s"}</small></span><span><b>${active}</b><small>ativo${active === 1 ? "" : "s"}</small></span><span><b>${pending}</b><small>convite${pending === 1 ? " pendente" : "s pendentes"}</small></span></div>`;
  }
  function memberCard(item) {
    const manageable = window.TeamAccess?.has?.("team.manage"), currentUid = window.FirebaseSession?.user?.uid;
    return `<article class="team-member-card status-${esc(item.status)}"><span class="team-avatar">${esc(initials(item.name))}</span><div class="team-member-copy"><h3>${esc(item.name || item.email)}</h3><p>${esc(roleLabel(item.role))}</p><small>${icon("map-pin")} ${esc(spacesLabel(item))}</small></div><span class="team-status">${esc(statusLabel(item.status))}</span>${manageable ? `<button class="team-card-action" type="button" data-team-edit="${esc(item.uid)}" aria-label="Editar ${esc(item.name)}">${icon("ellipsis-vertical")}</button>` : ""}${item.uid === currentUid ? '<em class="team-you">Você</em>' : ""}</article>`;
  }
  function inviteCard(item) {
    return `<article class="team-member-card status-invited"><span class="team-avatar">${esc(initials(item.name))}</span><div class="team-member-copy"><h3>${esc(item.name || item.email)}</h3><p>${esc(roleLabel(item.role))}</p><small>${icon("mail")} ${esc(item.email)}</small></div><span class="team-status">Convite pendente</span></article>`;
  }
  function content() {
    if (state.loading) return `<div class="team-loading">${icon("loader-circle")}<p>Carregando equipe…</p></div>`;
    if (state.error) return `<div class="team-empty">${icon("triangle-alert")}<h2>Não foi possível carregar</h2><p>${esc(state.error)}</p><button class="btn btn-light" data-team-retry>Tentar novamente</button></div>`;
    const cards = [...state.members.map(memberCard), ...state.invites.map(inviteCard)].join("");
    return cards || `<div class="team-empty">${icon("users-round")}<h2>Sua equipe começa aqui</h2><p>Convide uma pessoa e defina exatamente onde ela pode trabalhar.</p></div>`;
  }
  function render() {
    if (!window.TeamAccess?.has?.("team.view")) return window.TeamAccess?.deniedMarkup?.() || "";
    return `<section class="team-page" data-team-page><header class="team-heading"><div><h1>Equipe</h1><p>Funcionários, cargos e acessos.</p></div>${window.TeamAccess.has("team.manage") ? `<button class="btn btn-primary" type="button" data-team-add>${icon("user-plus")}<span>Adicionar funcionário</span></button>` : ""}</header><div data-team-summary>${summary()}</div><section class="team-list" data-team-list>${content()}</section></section>`;
  }
  function rerender() {
    const page = $("[data-team-page]");
    if (!page) return;
    $("[data-team-summary]", page).innerHTML = summary();
    $("[data-team-list]", page).innerHTML = content();
    bindActions(page); window.lucide?.createIcons();
  }
  async function load() {
    state.loading = true; state.error = ""; rerender();
    try {
      [state.members, state.invites] = await Promise.all([window.TeamService.listMembers(), window.TeamService.listInvites()]);
    } catch (error) { state.error = error.message || "Tente novamente."; }
    state.loading = false; rerender();
  }
  const roleOptions = (selected) => Object.entries(window.TeamAccess.ROLE_LABELS).filter(([id]) => id !== "owner" || window.BusinessContext?.get?.().role === "owner").map(([id, label]) => `<option value="${id}" ${selected === id ? "selected" : ""}>${esc(label)}</option>`).join("");
  function spacesFields(item = {}) {
    const spaces = window.SpaceContext?.homeSpaces?.() || [], access = item.spaceAccess || (item.role === "owner" ? "all" : "selected"), selected = new Set(item.allowedSpaceIds || []);
    return `<fieldset class="team-form-section"><legend>Espaços autorizados</legend><label class="team-radio"><input type="radio" name="spaceAccess" value="all" ${access === "all" ? "checked" : ""}><span><b>Todos os espaços</b><small>Acesso aos espaços atuais e futuros.</small></span></label><label class="team-radio"><input type="radio" name="spaceAccess" value="selected" ${access !== "all" ? "checked" : ""}><span><b>Espaços específicos</b><small>Mostra somente os espaços escolhidos.</small></span></label><div class="team-space-options" data-team-space-options>${spaces.map((space) => `<label><input type="checkbox" name="allowedSpaceIds" value="${esc(space.id)}" ${selected.has(space.id) ? "checked" : ""}><span>${esc(space.name)}</span></label>`).join("") || "<small>Nenhum espaço ativo.</small>"}</div></fieldset>`;
  }
  function permissionFields(item = {}) {
    const role = item.role || "seller", values = window.TeamAccess.permissionsFor(role, item.permissions || {});
    return `<details class="team-permissions" ${item.uid ? "" : "open"}><summary>Permissões deste cargo <small>Personalizar</small></summary><div data-team-permissions>${Object.entries(permissionLabels).map(([key, label]) => `<label><input type="checkbox" name="permission:${esc(key)}" ${values[key] ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div></details>`;
  }
  function formModal(item = null) {
    const editing = Boolean(item), root = $("#modal"), role = item?.role || "seller";
    root.innerHTML = `<div class="modal-bg team-modal-bg"><section class="modal-box team-modal" role="dialog" aria-modal="true"><header class="modal-head"><div><small>Equipe e acessos</small><h3>${editing ? "Editar funcionário" : "Adicionar funcionário"}</h3></div><button class="icon-btn" type="button" data-team-close>${icon("x")}</button></header><form data-team-form><div class="modal-body team-form"><div class="field"><label>Nome *</label><input name="name" maxlength="120" required value="${esc(item?.name || "")}" autocomplete="name"></div>${editing ? "" : `<div class="field"><label>E-mail *</label><input name="email" type="email" maxlength="320" required value="${esc(item?.email || "")}" autocomplete="email"></div>`}<div class="field"><label>Cargo</label><select name="role">${roleOptions(role)}</select></div>${editing ? `<div class="field"><label>Status</label><select name="status"><option value="active" ${item.status === "active" ? "selected" : ""}>Ativo</option><option value="disabled" ${item.status === "disabled" ? "selected" : ""}>Desativado</option></select></div>` : ""}${spacesFields(item || { role })}${permissionFields(item || { role })}<p class="team-form-error" data-team-form-error></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-team-close>Cancelar</button><button class="btn btn-primary" data-team-submit>${editing ? "Salvar alterações" : "Enviar convite"}</button></footer></form></section></div>`;
    const form = $("[data-team-form]", root), roleInput = form.elements.role, syncSpace = () => {
      const selected = form.elements.spaceAccess.value, box = $("[data-team-space-options]", form);
      box.hidden = selected === "all"; $$('input[type="checkbox"]', box).forEach((input) => input.disabled = selected === "all");
    }, applyPreset = () => {
      const values = window.TeamAccess.permissionsFor(roleInput.value, window.TeamAccess.PRESETS[roleInput.value]);
      Object.entries(values).forEach(([key, enabled]) => { const input = form.elements[`permission:${key}`]; if (input) input.checked = enabled; });
      if (roleInput.value === "owner") { form.elements.spaceAccess.value = "all"; syncSpace(); }
    };
    $$('[name="spaceAccess"]', form).forEach((input) => input.onchange = syncSpace);
    roleInput.onchange = applyPreset; syncSpace();
    $$('[data-team-close]', root).forEach((button) => button.onclick = () => { root.innerHTML = ""; });
    form.onsubmit = async (event) => {
      event.preventDefault(); const fd = new FormData(form), button = $("[data-team-submit]", form), error = $("[data-team-form-error]", form), permissions = {};
      window.TeamAccess.PERMISSIONS.forEach((key) => { permissions[key] = fd.has(`permission:${key}`); });
      const input = { name: fd.get("name"), role: fd.get("role"), status: fd.get("status") || "active", spaceAccess: fd.get("spaceAccess"), allowedSpaceIds: fd.getAll("allowedSpaceIds"), permissions };
      button.disabled = true; button.textContent = editing ? "Salvando…" : "Criando convite…"; error.textContent = "";
      try {
        if (editing) await window.TeamService.updateMember(item.uid, input);
        else {
          const result = await window.TeamService.createInvite({ ...input, email: fd.get("email") });
          root.innerHTML = `<div class="modal-bg"><section class="modal-box team-invite-ready"><header class="modal-head"><div><small>Convite criado</small><h3>Envie este link com segurança</h3></div><button class="icon-btn" data-team-close>${icon("x")}</button></header><div class="modal-body"><p>O link expira em 7 dias e só funciona para <b>${esc(fd.get("email"))}</b>.</p><input class="search" value="${esc(result.inviteUrl)}" readonly data-team-invite-url><button class="btn btn-primary" type="button" data-team-copy>${icon("copy")} Copiar link do convite</button><small>A senha será definida pela própria pessoa no Firebase Auth. Nenhuma senha é salva no Firestore.</small></div></section></div>`;
          $("[data-team-close]", root).onclick = () => { root.innerHTML = ""; };
          $("[data-team-copy]", root).onclick = async () => { await navigator.clipboard.writeText(result.inviteUrl); window.Utils?.toast?.("Link do convite copiado"); };
          window.lucide?.createIcons(); await load(); return;
        }
        root.innerHTML = ""; await load(); window.Utils?.toast?.("Acesso atualizado");
      } catch (failure) { button.disabled = false; button.textContent = editing ? "Salvar alterações" : "Enviar convite"; error.textContent = failure.message || "Não foi possível concluir."; }
    };
    window.lucide?.createIcons();
  }
  function bindActions(root = document) {
    $("[data-team-add]", root)?.addEventListener("click", () => formModal());
    $("[data-team-retry]", root)?.addEventListener("click", load);
    $$('[data-team-edit]', root).forEach((button) => button.onclick = () => formModal(state.members.find((item) => item.uid === button.dataset.teamEdit)));
  }
  function bind() { bindActions($("[data-team-page]") || document); void load(); }
  window.TeamPage = Object.freeze({ render, bind, load, state });
})();
