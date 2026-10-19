(function () {
  "use strict";
  const M = window.TeamPermissionModel;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const labels = {
    "sales.create": "Criar venda", "sales.cancel": "Cancelar venda", "sales.viewAll": "Consultar e administrar vendas / pedidos",
    "customers.view": "Ver clientes", "customers.edit": "Cadastrar e editar clientes", "customers.receiveDebt": "Registrar recebimentos / fiado",
    "customers.adjustBalance": "Ajustar saldo de clientes", "products.view": "Ver produtos", "products.edit": "Cadastrar e editar produtos",
    "inventory.view": "Ver estoque e movimentações", "inventory.adjust": "Ajustar estoque", "financial.view": "Acessar e movimentar Financeiro",
    "reports.view": "Ver relatórios, CRM e campanhas", "cost.view": "Ver e gerenciar custos", "profit.view": "Ver lucro / margem",
    "team.view": "Ver equipe", "team.manage": "Gerenciar funcionários e permissões", "settings.manage": "Acessar configurações",
    "billing.manage": "Acessar planos", "spaces.manage": "Gerenciar espaços"
  };
  const row = (key, kind = "execute", help = "") => ({ key, label: labels[key], kind, help });
  const linked = (id, label, test, help, kind = "execute") => ({ id, label, test, help, kind, linked: true });
  const groups = [
    { id: "sales", name: "Vendas", icon: "shopping-cart", rows: [
      linked("sales-read", "Ver vendas do espaço", p => p["sales.create"] || p["sales.viewAll"], "Incluído em Criar venda ou Consultar e administrar vendas / pedidos. Mostra as vendas do espaço, não apenas as deste funcionário.", "view"),
      row("sales.create", "execute", "Permite registrar vendas e consultar as vendas do espaço autorizado."), row("sales.cancel", "execute", "Para liberar, ative Criar venda. Não é possível conceder somente cancelamento nesta versão."),
      row("sales.viewAll", "view", "Libera a consulta administrativa de vendas e dos pedidos online. Para atender pedidos, também é preciso Criar venda. Não libera o Financeiro."),
      linked("discount", "Aplicar desconto", p => p["sales.create"], "Vinculado a Criar venda. Ainda não há bloqueio independente para descontos."),
      linked("price", "Alterar preço na venda", p => p["sales.create"], "Incluído em Criar venda. Ainda não é possível permitir vendas e bloquear a alteração de preço separadamente.")
    ] },
    { id: "customers", name: "Clientes", icon: "users-round", rows: [row("customers.view", "view", "Permite consultar os clientes autorizados e seus saldos para atendimento."), row("customers.edit", "execute", "Permite cadastrar clientes e alterar seus dados. As duas ações não podem ser separadas. Criar venda também pode registrar dados de clientes durante a venda.")] },
    { id: "products", name: "Produtos e estoque", icon: "box", rows: [row("products.view", "view"), row("products.edit", "execute", "Cadastro e edição não têm permissões separadas no modelo atual."), row("inventory.view", "view"), row("inventory.adjust", "execute", "Não afeta a baixa legítima de estoque gerada por uma venda autorizada.")] },
    { id: "goals", name: "Metas e desempenho", icon: "chart-no-axes-combined", rows: [
      linked("goals", "Ver metas", p => p["sales.create"] || p["sales.viewAll"], "Consulta operacional vinculada ao acesso às vendas do espaço.", "view"),
      linked("performance", "Ver desempenho da loja", p => p["sales.create"] || p["sales.viewAll"], "Consolidado do espaço, não apenas as vendas deste funcionário.", "view"),
      linked("individual", "Ver desempenho individual", () => false, "Indisponível separadamente nesta versão. Esta opção não concede nenhum acesso.", "view"), row("reports.view", "view", "Inclui relatórios, CRM e campanhas. Não controla sozinho os indicadores básicos de vendas no Início.")
    ] },
    { id: "finance", name: "Financeiro", icon: "wallet", notice: "Liberar Financeiro também permite registrar receitas e despesas. Custos e lucro usam registros compartilhados: liberar um pode permitir acesso aos dois. Não é possível separá-los com segurança nesta versão.", rows: [
      row("financial.view", "execute", "Permite consultar e movimentar o Financeiro nos espaços autorizados. Não há uma opção somente de leitura nesta versão."),
      linked("income", "Registrar receitas", p => p["financial.view"], "Vinculado ao acesso ao Financeiro."),
      linked("expense", "Registrar despesas", p => p["financial.view"], "Vinculado ao acesso ao Financeiro."),
      row("customers.receiveDebt", "execute", "Permite receber valores de fiado e consultar os registros relacionados ao recebimento. Não libera todo o módulo Financeiro."), row("customers.adjustBalance", "execute", "Permite corrigir o saldo devedor do cliente. Altera o valor que ele deve; não é apenas editar o cadastro."), row("cost.view", "execute", "Permite consultar e alterar custos. Os registros acessíveis também podem mostrar lucro."), row("profit.view", "view", "Permite consultar lucro e margem. Os registros acessíveis também podem mostrar custos.")
    ] },
    { id: "online", name: "Loja Online", icon: "store", rows: [
      linked("orders", "Ver pedidos online", p => p["sales.viewAll"], "Vinculado à consulta administrativa de vendas / pedidos, na seção Vendas.", "view"),
      linked("orders-status", "Alterar status dos pedidos", p => p["sales.create"] && p["sales.viewAll"], "Exige Criar venda + consulta administrativa. Cancelar também exige Cancelar venda."),
      linked("catalog", "Gerenciar catálogo online", (_p, owner) => owner, "Somente o proprietário pode salvar e publicar a loja online. Liberar edição de produtos não permite publicar a loja."),
      linked("store-settings", "Gerenciar configurações da loja", (_p, owner) => owner, "Somente o proprietário pode salvar as configurações da loja online nesta versão.")
    ] },
    { id: "system", name: "Equipe e sistema", icon: "shield-check", rows: [row("team.view", "view"),
      row("team.manage", "execute", "Permite convidar funcionários, alterar permissões e desativar acessos. São ações administrativas importantes e não vêm liberadas nos modelos Vendedor / Caixa e Gerente."),
      linked("invite", "Adicionar funcionário", p => p["team.manage"], "Vinculado a Gerenciar funcionários e permissões."),
      linked("permissions", "Editar permissões", p => p["team.manage"], "Vinculado a Gerenciar funcionários e permissões."),
      linked("disable", "Desativar funcionário", p => p["team.manage"], "Vinculado a Gerenciar funcionários e permissões."),
      row("settings.manage", "execute", "Permite abrir e alterar as configurações disponíveis para este acesso. Ações exclusivas do proprietário continuam protegidas."), row("spaces.manage", "execute", "Permite gerenciar espaços conforme os acessos e regras atuais da empresa."), row("billing.manage", "view", "Permite abrir a tela de planos. Contratação e cobrança continuam exclusivas do proprietário.")
    ] }
  ];
  let active = null;
  const context = () => window.BusinessContext?.get?.() || {};
  const stamp = () => JSON.stringify([window.FirebaseSession?.user?.uid || context().userProfile?.uid || "", context().businessId,
    context().role, context().permissions, context().allowedSpaceIds, context().spaceAccess]);
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => [...root.querySelectorAll(selector)];
  const roleLabel = role => window.TeamAccess?.ROLE_LABELS?.[role] || role;
  const initials = name => String(name || "?").trim().split(/\s+/).slice(0, 2).map(part => part[0]).join("").toUpperCase();
  function valid(s) { return active === s && stamp() === s.stamp && window.TeamAccess?.has?.("team.manage"); }
  function dirty(s) {
    return JSON.stringify(s.initial) !== JSON.stringify({ role: s.draft.role, permissions: s.draft.permissions,
      spaceAccess: s.draft.spaceAccess, allowedSpaceIds: [...s.draft.allowedSpaceIds].sort() });
  }
  function invalidate() {
    const s = active;
    if (!s || valid(s)) return;
    suspend(s);
  }
  function suspend(s) {
    s.invalid = true; active = null;
    const modal = q("#modal"); if (modal) { modal.innerHTML = ""; modal.onkeydown = null; }
    if (q("[data-permission-editor]")) q("#app").innerHTML = '<section class="tp-page"><div class="tp-alert" role="alert">A sessão ou empresa mudou. O editor anterior foi fechado sem salvar. Abra a Equipe novamente na sessão atual.</div></section>';
  }
  addEventListener("business-context-changed", invalidate);
  addEventListener("firebase-session-cleared", () => {
    if (active) suspend(active);
  });
  addEventListener("firebase-auth-ready", invalidate);
  function permissionRow(r, s) {
    const owner = s.original.role === "owner", enabled = r.linked ? r.test(s.draft.permissions, owner) : s.draft.permissions[r.key];
    const missing = !r.linked && (M.DEPENDENCIES[r.key] || []).filter(key => !s.draft.permissions[key]);
    const forbidden = !r.linked && context().role !== "owner" && !window.TeamAccess.has(r.key);
    const locked = r.linked || owner || s.busy || s.invalid || forbidden || (missing?.length && !enabled);
    const id = `tp-${r.key || r.id}`;
    return `<div class="tp-row ${r.linked ? "tp-linked" : ""}"><div class="tp-row-copy"><label for="${id}">${esc(r.label)}</label>${r.help ? `<details class="tp-row-help"><summary>O que permite?</summary><small id="${id}-help">${esc(r.help)}</small></details>` : ""}${missing?.length ? `<small class="tp-dependency">Para liberar esta opção, ative antes: ${missing.map(key => esc(labels[key])).join(", ")}</small>` : ""}${forbidden ? '<small>Seu acesso não permite conceder esta permissão.</small>' : ""}</div><div class="tp-row-control"><span class="tp-kind">${r.linked ? "Vinculada" : r.kind === "view" ? "Visualizar" : "Executar / Editar"}</span><input class="tp-toggle" id="${id}" type="checkbox" role="switch" ${r.linked ? "" : `data-tp-key="${r.key}"`} ${enabled ? "checked" : ""} ${locked ? "disabled" : ""} ${r.help ? `aria-describedby="${id}-help"` : ""}></div></div>`;
  }
  function render(s, first = false) {
    if (active !== s || (!first && !q("[data-permission-editor]"))) return;
    const root = q("#app"), member = s.original, owner = member.role === "owner";
    const currentName = context().business?.name || context().businessName || context().member?.businessName || "Empresa atual";
    const status = member.status === "active" ? "Ativo" : "Inativo";
    const diff = M.difference(M.explicit(member), s.draft.permissions);
    root.innerHTML = `<section class="tp-page" data-permission-editor aria-labelledby="tp-title"><nav class="tp-breadcrumb" aria-label="Localização"><button type="button" data-tp-back>Equipe</button><span>/</span><span>Permissões</span></nav>
      <header class="tp-heading"><div class="tp-title-icon">${icon("key-round")}</div><div><h1 id="tp-title" tabindex="-1">Permissões da equipe</h1><p>Controle o que cada funcionário pode visualizar e executar.</p></div><button type="button" class="tp-button tp-help" data-tp-help aria-label="Como funcionam as permissões?">${icon("circle-help")}<span>Como funciona?</span></button></header>
      ${s.invalid ? '<div class="tp-alert" role="alert">A sessão ou empresa mudou. Este editor foi bloqueado para proteger os acessos. Volte à Equipe e abra novamente.</div>' : ""}
      <article class="tp-identity"><span class="tp-avatar">${esc(initials(member.name))}</span><div class="tp-person"><div class="tp-name"><h2>${esc(member.name || "Funcionário")}</h2><span class="tp-status ${member.status === "active" ? "" : "is-inactive"}">${status}</span></div><p>${esc(roleLabel(member.role))}</p><div class="tp-contact"><span>${icon("mail")}${esc(member.email || "E-mail não informado")}</span><span>${icon("store")}${esc(currentName)}</span></div></div><button class="tp-button" type="button" data-tp-switch>${icon("arrow-left-right")}Trocar funcionário</button></article>
      <section class="tp-presets" aria-labelledby="tp-profile-title"><h2 id="tp-profile-title">Perfil de permissões</h2><p>Escolha um modelo de acesso ou ajuste as opções abaixo. Nada muda para o funcionário antes de confirmar e salvar.</p><div class="tp-preset-grid" role="group" aria-label="Perfil de permissões">${[["seller", "user-round", "Vendedor / Caixa", "Vendas e consultas básicas"], ["manager", "crown", "Gerente", "Operação ampliada, sem Financeiro"], ["custom", "sliders-horizontal", "Personalizado", "Ajuste as opções, sem mudar o cargo"]].map(([id, symbol, name, help]) => `<button type="button" class="tp-preset" data-tp-preset="${id}" aria-pressed="${s.profile === id}" ${owner || s.invalid || s.busy ? "disabled" : ""}>${icon(symbol)}<span><b>${name}</b><small>${help}</small></span><span class="tp-preset-dot" aria-hidden="true"></span></button>`).join("")}</div>${owner ? '<p class="tp-note">O proprietário possui acesso integral protegido. Esta tela não altera seu cargo.</p>' : `<p class="tp-note">Cargo atual: ${esc(roleLabel(member.role))}. Escolher Vendedor / Caixa ou Gerente substitui as opções desta tela e o cargo ao salvar, mas mantém os espaços. Ao ajustar uma permissão manualmente, o perfil passa a Personalizado e o cargo é mantido.</p>`}</section>
      <section class="tp-spaces" aria-labelledby="tp-spaces-title"><div><h2 id="tp-spaces-title">Espaços autorizados</h2><p>Escolha onde o funcionário poderá trabalhar. As permissões desta tela serão iguais em todos os espaços liberados. Em Espaços específicos, mantenha marcado apenas o que deseja liberar.</p></div><div class="tp-space-mode">${[["selected", "Espaços específicos"], ["all", "Todos os espaços"]].map(([value, label]) => `<label><input type="radio" name="tp-space-mode" value="${value}" ${s.draft.spaceAccess === value ? "checked" : ""} ${owner || s.invalid || s.busy ? "disabled" : ""}>${label}</label>`).join("")}</div>${s.draft.spaceAccess === "all" ? '<p class="tp-note">Atenção: inclui todos os espaços atuais e os que forem criados no futuro nesta empresa.</p>' : `<div class="tp-space-chips">${s.spaces.map(space => `<label><input type="checkbox" data-tp-space="${esc(space.id)}" ${s.draft.allowedSpaceIds.includes(space.id) ? "checked" : ""} ${owner || s.invalid || s.busy ? "disabled" : ""}><span>${icon("store")}${esc(space.name)}</span></label>`).join("") || "<p>Nenhum espaço disponível. Não será possível salvar sem um espaço autorizado.</p>"}</div>`}</section>
      <div class="tp-permission-grid">${groups.map(group => `<details class="tp-section" data-tp-group="${group.id}" ${s.open.has(group.id) ? "open" : ""}><summary><span class="tp-section-icon">${icon(group.icon)}</span><span>${group.name}<small>${group.rows.filter(r => !r.linked && s.draft.permissions[r.key]).length} permissões diretas ativas</small></span>${icon("chevron-down")}</summary><div class="tp-section-content">${group.notice ? `<p class="tp-caution">${icon("info")}${group.notice}</p>` : ""}${group.rows.map(r => permissionRow(r, s)).join("")}</div></details>`).join("")}</div>
      <aside class="tp-safety">${icon("shield-check")}<div><b>Entenda os tipos de acesso</b><p>Visualizar permite consultar. Executar / Editar permite realizar ações ou alterar dados. Uma opção Vinculada já está incluída em outro acesso e não pode ser ligada ou desligada separadamente. Use “O que permite?” para ver os detalhes. As regras de segurança da empresa e dos espaços continuam valendo.</p></div></aside>
      <div class="tp-feedback" data-tp-feedback role="status">${esc(s.message || "")}</div>
      <footer class="tp-savebar"><div><b>${dirty(s) ? "Alterações não salvas" : "Nenhuma alteração"}</b><small>${diff.added.length} acessos a liberar · ${diff.removed.length} a remover</small></div><button class="tp-button" type="button" data-tp-back ${s.busy ? "disabled" : ""}>Cancelar</button><button class="tp-button tp-primary" type="button" data-tp-save ${owner || !dirty(s) || s.busy || s.invalid ? "disabled" : ""}>${icon("check")}${s.busy ? "Salvando…" : "Salvar permissões"}</button></footer></section>`;
    bind(s); window.lucide?.createIcons();
  }
  function dialog(s, title, body, action, run) {
    const root = q("#modal"), previous = document.activeElement;
    root.innerHTML = `<div class="tp-dialog-bg"><section class="tp-dialog" role="dialog" aria-modal="true" aria-labelledby="tp-dialog-title"><h2 id="tp-dialog-title">${esc(title)}</h2><div class="tp-dialog-body">${body}</div><div class="tp-dialog-actions"><button class="tp-button" type="button" data-tp-dialog-cancel>Voltar</button>${action ? `<button type="button" class="tp-button tp-primary" data-tp-dialog-confirm>${esc(action)}</button>` : ""}</div></section></div>`;
    const close = () => { root.innerHTML = ""; root.onkeydown = null; previous?.focus?.(); };
    q("[data-tp-dialog-cancel]", root).onclick = close;
    const confirm = q("[data-tp-dialog-confirm]", root);
    if (confirm) confirm.onclick = () => { if (!valid(s) || s.busy || s.invalid) { close(); invalidate(); return; } close(); run(); };
    root.onkeydown = event => {
      if (event.key === "Escape") { event.preventDefault(); close(); }
      if (event.key === "Tab") { const buttons = qa("button", root), first = buttons[0], last = buttons.at(-1);
        if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); } }
    };
    q("[data-tp-dialog-cancel]", root).focus();
  }
  function leave(s) {
    if (s.busy) return;
    const done = () => { active = null; q("#modal").innerHTML = ""; s.onClose(); };
    if (dirty(s) && !s.invalid) dialog(s, "Sair sem salvar?", "<p>As permissões atuais do funcionário serão mantidas.</p>", "Sair sem salvar", done);
    else done();
  }
  async function save(s) {
    if (!valid(s) || s.invalid || s.busy || !dirty(s)) return;
    let payload;
    try { payload = M.serialize(s.original, s.draft); }
    catch (error) { s.message = error.message; render(s); q("[data-tp-feedback]").scrollIntoView({ block: "center" }); return; }
    const diff = M.difference(M.explicit(s.original), s.draft.permissions);
    const list = keys => keys.length ? `<ul>${keys.map(key => `<li>${esc(labels[key])}</li>`).join("")}</ul>` : "<p>Nenhuma.</p>";
    dialog(s, "Revisar alterações", `<p>Funcionário: <b>${esc(s.original.name)}</b>. Confira tudo abaixo. Nada será alterado até tocar em Confirmar e salvar.</p><h3>Acessos que serão liberados</h3>${list(diff.added)}<h3>Acessos que serão removidos</h3>${list(diff.removed)}<p>Cargo após salvar: <b>${esc(roleLabel(payload.role))}</b></p><p>Espaços liberados após salvar: <b>${payload.spaceAccess === "all" ? "Todos os atuais e futuros" : s.spaces.filter(space => payload.allowedSpaceIds.includes(space.id)).map(space => esc(space.name)).join(", ")}</b></p>${diff.added.some(key => ["financial.view", "cost.view", "profit.view", "team.manage", "settings.manage", "spaces.manage", "billing.manage"].includes(key)) ? '<p class="tp-caution">Atenção: você está liberando acesso financeiro ou administrativo. Liberar Financeiro permite registrar receitas e despesas. Liberar custos ou lucro pode permitir consultar os dois. Confirme somente se deseja conceder esses acessos.</p>' : ""}`, "Confirmar e salvar", async () => {
      s.busy = true; s.message = ""; render(s);
      try {
        await window.TeamService.updateMember(s.original.uid || s.original.id, payload);
        if (!valid(s) || s.invalid) return;
        s.message = "Permissões salvas. Os novos acessos serão aplicados quando a sessão do funcionário atualizar. Se necessário, peça que ele abra o aplicativo novamente.";
        s.original = { ...s.original, ...payload }; delete s.original.expectedAccess;
        s.initial = initial(s.draft);
      } catch (error) {
        if (valid(s) && !s.invalid) s.message = error.message || "Não foi possível salvar. Nenhum acesso foi confirmado por esta tela.";
      } finally { s.busy = false; if (active === s) render(s); }
    });
  }
  function bind(s) {
    qa("[data-tp-back], [data-tp-switch]").forEach(button => { button.onclick = () => leave(s); });
    q("[data-tp-help]").onclick = () => dialog(s, "Como funcionam as permissões?", "<p>Visualizar permite consultar. Executar / Editar permite realizar ações ou alterar dados. Uma opção Vinculada faz parte de outro acesso e não pode ser alterada separadamente nesta versão.</p><p>Vendedor / Caixa e Gerente são modelos prontos. Ao escolher um, as opções desta tela e o cargo serão substituídos somente depois de confirmar e salvar. Os espaços escolhidos serão mantidos. Esses modelos não liberam Financeiro, custos, lucro, gestão de equipe ou configurações.</p><p>Ao ajustar uma permissão manualmente, o perfil passa a Personalizado, sem mudar o cargo escolhido. Desligar uma opção também desliga as que precisam dela nesta tela. Você verá todas as remoções antes de salvar. Abrir ou cancelar esta tela não muda os acessos atuais.</p>", "", null);
    qa("[data-tp-group]").forEach(details => { details.ontoggle = () => { if (details.open) s.open.add(details.dataset.tpGroup); else s.open.delete(details.dataset.tpGroup); }; });
    qa("[data-tp-key]").forEach(input => { input.onchange = () => {
      if (!valid(s) || s.busy || s.invalid) return invalidate();
      const key = input.dataset.tpKey, changed = M.change(s.draft.permissions, key, input.checked);
      s.draft.permissions = changed.values; s.profile = "custom";
      s.message = changed.removed.length ? `Também serão desligadas, pois precisam desta opção: ${changed.removed.map(id => labels[id]).join(", ")}. O perfil passou a Personalizado. Nada muda para o funcionário antes de salvar.` : "Perfil Personalizado: ajuste feito somente nesta tela. O cargo foi mantido. Confirme e salve para aplicar.";
      render(s); document.getElementById(`tp-${key}`)?.focus();
    }; });
    qa("[data-tp-preset]").forEach(button => { button.onclick = () => {
      if (!valid(s) || s.busy || s.invalid) return;
      const profile = button.dataset.tpPreset;
      if (profile === "custom") { s.profile = profile; render(s); return; }
      const values = M.preset(profile);
      if (context().role !== "owner" && M.KEYS.some(key => values[key] && !window.TeamAccess.has(key))) { s.message = "Este modelo inclui acessos que você não tem permissão para liberar. Peça ao proprietário para revisar."; render(s); return; }
      dialog(s, "Usar este modelo de acesso?", `<p>Escolher ${profile === "seller" ? "Vendedor / Caixa" : "Gerente"} substituirá as permissões desta tela e o cargo ao salvar. Isso pode remover acessos liberados anteriormente.</p><p>Não inclui Financeiro, custos, lucro, gestão de equipe ou configurações. Os espaços escolhidos serão mantidos.</p><p>Por enquanto, a mudança fica somente nesta tela. Você ainda revisará tudo e confirmará antes de salvar.</p>`, "Usar este modelo", () => { s.draft.permissions = values; s.draft.role = profile; s.profile = profile; s.message = "Modelo aplicado somente nesta tela. Revise os acessos e o cargo antes de confirmar e salvar."; render(s); });
    }; });
    qa('[name="tp-space-mode"]').forEach(input => { input.onchange = () => { if (!valid(s) || s.busy || s.invalid) return; s.draft.spaceAccess = input.value; render(s); }; });
    qa("[data-tp-space]").forEach(input => { input.onchange = () => { if (!valid(s) || s.busy || s.invalid) return;
      const set = new Set(s.draft.allowedSpaceIds); if (input.checked) set.add(input.dataset.tpSpace); else set.delete(input.dataset.tpSpace);
      s.draft.allowedSpaceIds = [...set].sort(); render(s);
    }; });
    q("[data-tp-save]").onclick = () => save(s);
  }
  function initial(draft) { return { role: draft.role, permissions: { ...draft.permissions }, spaceAccess: draft.spaceAccess, allowedSpaceIds: [...draft.allowedSpaceIds].sort() }; }
  function open(member, { onClose } = {}) {
    if (!window.TeamAccess?.has?.("team.manage") || !member || !q("#app")) return false;
    q("#modal").innerHTML = "";
    const original = JSON.parse(JSON.stringify(member));
    const spaces = M.spaceOptions(window.SpaceContext?.homeSpaces?.() || [], original.allowedSpaceIds || [], context().businessId);
    const draft = { role: original.role, permissions: M.explicit(original), spaceAccess: original.role === "owner" ? "all" : original.spaceAccess || "selected", allowedSpaceIds: [...(original.allowedSpaceIds || [])].sort() };
    const profile = ["seller", "manager"].includes(original.role) && M.KEYS.every(key => draft.permissions[key] === M.preset(original.role)[key]) ? original.role : "custom";
    active = { original, draft, initial: initial(draft), spaces, stamp: stamp(), profile, busy: false, invalid: false,
      open: new Set(window.matchMedia?.("(max-width: 640px)").matches ? ["sales"] : groups.map(group => group.id)), message: M.issues(draft.permissions).length ? "Alguns acessos atuais precisam de outra opção que está desligada. Nada foi alterado. Antes de salvar mudanças, confira os avisos nas seções e escolha o que deseja manter." : "", onClose: onClose || (() => { q("#app").innerHTML = window.TeamPage.render(); window.TeamPage.bind(); }) };
    render(active, true); q("#tp-title").focus(); return true;
  }
  window.TeamPermissionEditor = Object.freeze({ open });
})();
