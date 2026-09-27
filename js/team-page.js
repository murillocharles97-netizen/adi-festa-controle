(function () {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector),
    $$ = (selector, root = document) => [...root.querySelectorAll(selector)],
    esc = (value) => window.Utils?.escapar?.(String(value ?? "")) ?? String(value ?? ""),
    icon = (name) => `<i data-lucide="${name}"></i>`;
  const state = { members: [], invites: [], loading: false, error: "", filter: "all", search: "", businessId: "" };
  let loadingPromise = null, formBusy = false;
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
    if (names.length) return names.join(", ");
    return `${names.length || ids.length} espaços`;
  }
  function summary() {
    const members = state.members.length, active = state.members.filter((item) => item.status === "active").length,
      pending = state.invites.length;
    return `<div class="team-summary">${[["users",members,"Membros"],["user-check",active,"Ativos"],["mail",pending,"Convites pendentes"]].map(([symbol,count,label])=>`<article>${icon(symbol)}<div><b>${count}</b><small>${label}</small></div></article>`).join("")}</div>`;
  }
  function filters() {
    const counts = { all: state.members.length + state.invites.length, active: state.members.filter(item=>item.status==="active").length, pending: state.invites.length, disabled: state.members.filter(item=>item.status==="disabled").length };
    return `<div class="team-filters" role="group" aria-label="Filtrar equipe">${Object.entries({all:"Todos",active:"Ativos",pending:"Pendentes",disabled:"Inativos"}).map(([key,label])=>`<button type="button" data-team-filter="${key}" aria-pressed="${state.filter===key}">${label} <span>(${counts[key]})</span></button>`).join("")}</div>`;
  }
  function memberCard(item) {
    const manageable = window.TeamAccess?.has?.("team.manage"), currentUid = window.FirebaseSession?.user?.uid;
    return `<article class="team-member-card status-${esc(item.status)}"><span class="team-avatar">${esc(initials(item.name))}</span><div class="team-member-copy"><h3>${esc(item.name || item.email)}</h3><p>${esc(roleLabel(item.role))}</p><small>${icon("map-pin")} ${esc(spacesLabel(item))}</small></div><span class="team-status">${esc(statusLabel(item.status))}</span>${manageable ? `<button class="team-card-action" type="button" data-team-edit="${esc(item.uid)}" aria-label="Editar ${esc(item.name)}">${icon("ellipsis-vertical")}</button>` : ""}${item.uid === currentUid ? '<em class="team-you">Você</em>' : ""}</article>`;
  }
  function inviteCard(item) {
    return `<article class="team-member-card status-invited"><span class="team-avatar">${esc(initials(item.name))}</span><div class="team-member-copy"><h3>${esc(item.name || item.email)}</h3><p>${esc(roleLabel(item.role))}</p><small>${icon("map-pin")} ${esc(spacesLabel(item))}</small><small>${esc(item.email)}</small></div><span class="team-status">Pendente</span>${window.TeamAccess?.has?.("team.manage")?`<button class="team-card-action" type="button" data-team-invite="${esc(item.id)}" aria-label="Opções do convite de ${esc(item.name)}">${icon("ellipsis-vertical")}</button>`:""}</article>`;
  }
  function content() {
    if (state.loading) return `<div class="team-loading">${icon("loader-circle")}<p>Carregando equipe…</p></div>`;
    if (state.error) return `<div class="team-empty">${icon("triangle-alert")}<h2>Não foi possível carregar</h2><p>${esc(state.error)}</p><button class="btn btn-light" data-team-retry>Tentar novamente</button></div>`;
    const normalize = value => String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    const matches = item => normalize(`${item.name} ${item.email}`).includes(normalize(state.search));
    const cards = [...state.members.filter(item=>(state.filter==="all" || item.status===state.filter)&&matches(item)).map(memberCard), ...((state.filter==="all"||state.filter==="pending")?state.invites.filter(matches).map(inviteCard):[])].join("");
    if (!cards && (state.search || state.filter!=="all")) return '<div class="team-empty"><h2>Nenhum resultado</h2><p>Tente outro filtro ou nome.</p></div>';
    return cards || `<div class="team-empty">${icon("users-round")}<h2>Sua equipe começa aqui</h2><p>Convide uma pessoa e defina exatamente onde ela pode trabalhar.</p></div>`;
  }
  function render() {
    if (!window.TeamAccess?.has?.("team.view")) return window.TeamAccess?.deniedMarkup?.() || "";
    resetScope();
    return `<section class="team-page" data-team-page><header class="team-heading"><div><h1>Equipe</h1><p>Funcionários, cargos e acessos.</p></div></header><div data-team-summary>${summary()}</div><div data-team-filters>${filters()}</div><label class="team-search" data-team-search-wrap hidden>${icon("search")}<input type="search" data-team-search placeholder="Buscar por nome ou e-mail" aria-label="Buscar funcionário" value="${esc(state.search)}"></label>${window.TeamAccess.has("team.manage") ? `<button class="btn btn-primary team-add" type="button" data-team-add>${icon("user-plus")}<span>Adicionar funcionário</span>${icon("chevron-right")}</button>` : ""}<section class="team-list" data-team-list aria-live="polite">${content()}</section></section>`;
  }
  function resetScope() {
    const businessId = window.BusinessContext?.get?.().businessId || "";
    if(state.businessId!==businessId)Object.assign(state,{businessId,members:[],invites:[],filter:"all",search:"",error:""});
    return businessId;
  }
  function rerender() {
    const page = $("[data-team-page]");
    if (!page) return;
    $("[data-team-summary]", page).innerHTML = summary();
    $("[data-team-filters]", page).innerHTML = filters();
    $("[data-team-search-wrap]", page).hidden = state.members.length + state.invites.length < 5 && !state.search;
    $("[data-team-list]", page).innerHTML = content();
    bindActions(page); window.lucide?.createIcons();
  }
  async function load() {
    if (loadingPromise) return loadingPromise;
    const businessId = resetScope();
    state.loading = true; state.error = ""; rerender();
    loadingPromise = (async () => {
    try {
      const [members, invites] = await Promise.all([window.TeamService.listMembers(), window.TeamService.listInvites()]);
      if (businessId === window.BusinessContext?.get?.().businessId) Object.assign(state, {members, invites});
    } catch (error) { if(businessId === window.BusinessContext?.get?.().businessId)state.error = error.message || "Tente novamente."; }
    state.loading = false; rerender();
    })().finally(()=>{loadingPromise=null;});
    return loadingPromise;
  }
  const roleOptions = (selected) => Object.entries(window.TeamAccess.ROLE_LABELS).filter(([id]) => id !== "owner" || window.BusinessContext?.get?.().role === "owner").map(([id, label]) => `<option value="${id}" ${selected === id ? "selected" : ""}>${esc(label)}</option>`).join("");
  function spacesFields(item = {}) {
    const spaces = window.SpaceContext?.homeSpaces?.() || [], access = item.spaceAccess || (item.role === "owner" ? "all" : "selected"), selected = new Set(item.allowedSpaceIds || []);
    return `<fieldset class="team-form-section"><legend>Espaços autorizados</legend><label class="team-radio"><input type="radio" name="spaceAccess" value="all" ${access === "all" ? "checked" : ""}><span><b>Todos os espaços</b><small>Acesso aos espaços atuais e futuros.</small></span></label><label class="team-radio"><input type="radio" name="spaceAccess" value="selected" ${access !== "all" ? "checked" : ""}><span><b>Espaços específicos</b><small>Mostra somente os espaços escolhidos.</small></span></label><div class="team-space-options" data-team-space-options>${spaces.map((space) => `<label><input type="checkbox" name="allowedSpaceIds" value="${esc(space.id)}" ${selected.has(space.id) ? "checked" : ""}><span>${esc(space.name)}</span></label>`).join("") || "<small>Nenhum espaço ativo.</small>"}</div></fieldset>`;
  }
  function permissionFields(item = {}) {
    const role = item.role || "seller", values = window.TeamAccess.permissionsFor(role, item.permissions || {});
    return `<section class="team-quick-permissions"><h4>Permissões rápidas</h4><div>${[["sales.create","Vendas","shopping-cart"],["customers.view","Clientes","users"],["products.view","Produtos","tag"]].map(([key,label,symbol])=>`<button type="button" data-team-quick="${key}" aria-pressed="${Boolean(values[key])}">${icon(symbol)}<span>${label}</span>${icon("check-circle")}</button>`).join("")}</div></section><details class="team-permissions"><summary>Personalizar permissões</summary><div data-team-permissions>${Object.entries(permissionLabels).map(([key, label]) => `<label><input type="checkbox" name="permission:${esc(key)}" ${values[key] ? "checked" : ""}><span>${esc(label)}</span></label>`).join("")}</div></details>`;
  }
  function formModal(item = null, focusName = "") {
    if (formBusy || !window.TeamAccess?.has?.("team.manage")) return;
    const editing = Boolean(item), root = $("#modal"), role = item?.role || "seller";
    const formBusinessId = window.BusinessContext?.get?.().businessId;
    root.innerHTML = `<div class="modal-bg team-modal-bg"><section class="modal-box team-modal" role="dialog" aria-modal="true" aria-labelledby="team-modal-title"><header class="modal-head"><div><small>Equipe e acessos</small><h3 id="team-modal-title">${editing ? "Editar funcionário" : "Adicionar funcionário"}</h3></div><button class="icon-btn" type="button" data-team-close aria-label="Fechar">${icon("x")}</button></header><form data-team-form><div class="modal-body team-form"><div class="field"><label for="team-name">Nome *</label><div class="team-input">${icon("user")}<input id="team-name" name="name" placeholder="Nome do funcionário" maxlength="120" required value="${esc(item?.name || "")}" autocomplete="name"></div></div>${editing ? "" : `<div class="field"><label for="team-email">E-mail *</label><div class="team-input">${icon("mail")}<input id="team-email" name="email" type="email" placeholder="email@empresa.com" maxlength="320" required value="${esc(item?.email || "")}" autocomplete="email"></div></div>`}<div class="field"><label for="team-role">Cargo</label><div class="team-input">${icon("briefcase")}<select id="team-role" name="role" required>${roleOptions(role)}</select></div></div>${editing ? `<div class="field"><label for="team-status">Status</label><select id="team-status" name="status"><option value="active" ${item.status === "active" ? "selected" : ""}>Ativo</option><option value="disabled" ${item.status === "disabled" ? "selected" : ""}>Desativado</option></select></div>` : ""}${permissionFields(item || { role })}${spacesFields(item || { role })}<p class="team-form-info">${icon("info")} O funcionário verá apenas os módulos e espaços liberados.</p><p class="team-form-error" data-team-form-error role="alert"></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-team-close>Cancelar</button><button class="btn btn-primary" data-team-submit>${editing ? "Salvar alterações" : "Enviar convite"}</button></footer></form></section></div>`;
    const form = $("[data-team-form]", root), roleInput = form.elements.role, syncSpace = () => {
      const selected = form.elements.spaceAccess.value, box = $("[data-team-space-options]", form);
      box.hidden = selected === "all"; $$('input[type="checkbox"]', box).forEach((input) => input.disabled = selected === "all");
    }, applyPreset = () => {
      const values = window.TeamAccess.permissionsFor(roleInput.value, window.TeamAccess.PRESETS[roleInput.value]);
      Object.entries(values).forEach(([key, enabled]) => { const input = form.elements[`permission:${key}`]; if (input) input.checked = enabled; });
      if (roleInput.value === "owner") { form.elements.spaceAccess.value = "all"; syncSpace(); }
      syncPermissions();
    };
    const syncPermissions = () => {
      $$('[data-team-quick]', form).forEach(button=>{button.setAttribute('aria-pressed', String(form.elements[`permission:${button.dataset.teamQuick}`].checked)); button.disabled=roleInput.value==='owner';});
      $$('[name^="permission:"]', form).forEach(input=>{input.disabled=roleInput.value==='owner';});
      $$('[name="spaceAccess"]', form).forEach(input=>{input.disabled=roleInput.value==='owner';});
    };
    $$('[data-team-quick]', form).forEach(button=>button.onclick=()=>{const input=form.elements[`permission:${button.dataset.teamQuick}`]; input.checked=!input.checked; syncPermissions();});
    $$('[name^="permission:"]', form).forEach(input=>input.onchange=syncPermissions);
    $$('[name="spaceAccess"]', form).forEach((input) => input.onchange = syncSpace);
    roleInput.onchange = applyPreset; syncSpace(); syncPermissions();
    if (item?.uid === window.FirebaseSession?.user?.uid && item.role === "owner") { roleInput.disabled=true; form.elements.status.disabled=true; }
    const previousFocus = document.activeElement;
    const close = () => { if(formBusy)return; root.innerHTML=""; previousFocus?.focus?.(); };
    $$('[data-team-close]', root).forEach((button) => button.onclick = close);
    root.onkeydown = event => {
      if(event.key==='Escape'){event.preventDefault();close();}
      if(event.key==='Tab'){const controls=$$('button:not(:disabled),input:not(:disabled),select:not(:disabled),summary',root).filter(node=>node.getClientRects().length);const first=controls[0],last=controls.at(-1);if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus();}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus();}}
    };
    (form.elements[focusName] || $("[data-team-close]", root)).focus();
    form.onsubmit = async (event) => {
      event.preventDefault(); if(formBusy)return; const fd = new FormData(form), button = $("[data-team-submit]", form), error = $("[data-team-form-error]", form), permissions = {};
      if(formBusinessId!==window.BusinessContext?.get?.().businessId){error.textContent="A empresa ativa mudou. Feche e abra o formulário novamente.";return;}
      window.TeamAccess.PERMISSIONS.forEach((key) => { permissions[key] = fd.has(`permission:${key}`); });
      const input = { name: String(fd.get("name")||"").trim(), role: roleInput.value, status: form.elements.status?.value || "active", spaceAccess: roleInput.value==='owner'?'all':fd.get("spaceAccess"), allowedSpaceIds: fd.getAll("allowedSpaceIds"), permissions: roleInput.value==='owner'?{...window.TeamAccess.PRESETS.owner}:permissions };
      if(!input.name){error.textContent="Informe o nome do funcionário.";return;}
      if(input.spaceAccess==='selected'&&!input.allowedSpaceIds.length){error.textContent="Selecione ao menos um espaço autorizado.";return;}
      if(input.spaceAccess==='all')input.allowedSpaceIds=[];
      formBusy=true;
      button.disabled = true; button.textContent = editing ? "Salvando…" : "Criando convite…"; error.textContent = "";
      try {
        if (editing) await window.TeamService.updateMember(item.uid, input);
        else {
          const result = await window.TeamService.createInvite({ ...input, email: fd.get("email") });
          inviteReady(result, fd.get("email"));
          window.lucide?.createIcons(); await load(); return;
        }
        root.innerHTML = ""; await load(); window.Utils?.toast?.("Acesso atualizado");
      } catch (failure) { button.disabled = false; button.textContent = editing ? "Salvar alterações" : "Enviar convite"; error.textContent = failure.message || "Não foi possível concluir."; }
      finally {formBusy=false;}
    };
    window.lucide?.createIcons();
  }
  function inviteReady(result, email) {
    const root=$("#modal");
    root.onkeydown=null;
    root.innerHTML=`<div class="modal-bg"><section class="modal-box team-invite-ready" role="dialog" aria-modal="true" aria-label="Convite criado"><header class="modal-head"><div><small>Convite criado</small><h3>Envie este link com segurança</h3></div><button class="icon-btn" data-team-close aria-label="Fechar">${icon("x")}</button></header><div class="modal-body"><p>O link expira em 7 dias e só funciona para <b>${esc(email)}</b>.</p><input class="search" value="${esc(result.inviteUrl)}" readonly data-team-invite-url aria-label="Link do convite"><button class="btn btn-primary" type="button" data-team-copy>${icon("copy")} Copiar link do convite</button><small>A senha será definida pela própria pessoa. O convite ainda precisa ser compartilhado.</small><p data-team-copy-error role="alert"></p></div></section></div>`;
    $("[data-team-close]",root).onclick=()=>{root.innerHTML="";};
    $("[data-team-copy]",root).onclick=async()=>{try{await navigator.clipboard.writeText(result.inviteUrl);window.Utils?.toast?.("Link do convite copiado");}catch{$('[data-team-copy-error]',root).textContent="Não foi possível copiar. Selecione e copie o link acima.";}};
    window.lucide?.createIcons();
  }
  function memberMenu(item, invite=false) {
    if(!item||formBusy||!window.TeamAccess?.has?.("team.manage"))return;
    const root=$("#modal"), selfOwner=item.uid===window.FirebaseSession?.user?.uid&&item.role==='owner';
    root.onkeydown=null;
    root.innerHTML=`<div class="modal-bg"><section class="modal-box team-invite-ready" role="dialog" aria-modal="true" aria-label="Opções do funcionário"><header class="modal-head"><h3>${esc(item.name)}</h3><button class="icon-btn" data-team-close aria-label="Fechar">${icon("x")}</button></header><div class="modal-body team-menu">${invite?'<p>Um novo link substituirá o convite anterior, que deixará de funcionar.</p><button class="btn btn-primary" data-team-resend>Reenviar convite</button>':`<button class="btn btn-light" data-team-menu-edit="name">Editar</button>${selfOwner?'':`<button class="btn btn-light" data-team-menu-edit="role">Alterar cargo</button><button class="btn btn-light" data-team-menu-edit="">Alterar espaços</button><button class="btn btn-light" data-team-menu-edit="status">${item.status==='active'?'Desativar acesso':'Reativar'}</button>`}` }<p class="team-form-error" data-team-menu-error role="alert"></p></div></section></div>`;
    $("[data-team-close]",root).onclick=()=>{if(!formBusy)root.innerHTML="";};
    $$('[data-team-menu-edit]',root).forEach(button=>button.onclick=()=>formModal(item,button.dataset.teamMenuEdit));
    const resend=$("[data-team-resend]",root);
    if(resend)resend.onclick=async()=>{if(formBusy)return;formBusy=true;resend.disabled=true;try{const result=await window.TeamService.createInvite({name:item.name,email:item.email,role:item.role,spaceAccess:item.spaceAccess,allowedSpaceIds:item.allowedSpaceIds||[],permissions:item.permissions||{},replaceInviteId:item.id});inviteReady(result,item.email);await load();}catch(error){$('[data-team-menu-error]',root).textContent=error.message||"Não foi possível reenviar.";resend.disabled=false;}finally{formBusy=false;}};
    window.lucide?.createIcons();
  }
  function bindActions(root = document) {
    const add=$("[data-team-add]", root), retry=$("[data-team-retry]", root), search=$("[data-team-search]",root);
    if(add)add.onclick=()=>formModal();
    if(retry)retry.onclick=load;
    if(search)search.oninput=()=>{state.search=search.value;rerender();};
    $$('[data-team-filter]',root).forEach(button=>button.onclick=()=>{state.filter=button.dataset.teamFilter;rerender();});
    $$('[data-team-edit]', root).forEach((button) => button.onclick = () => memberMenu(state.members.find((item) => item.uid === button.dataset.teamEdit)));
    $$('[data-team-invite]',root).forEach(button=>button.onclick=()=>memberMenu(state.invites.find(item=>item.id===button.dataset.teamInvite),true));
  }
  function bind() { bindActions($("[data-team-page]") || document); void load(); }
  window.TeamPage = Object.freeze({ render, bind, load, state });
})();
