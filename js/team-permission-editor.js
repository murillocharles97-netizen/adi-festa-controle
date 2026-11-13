(function () {
  "use strict";
  const M = window.TeamPermissionModel;
  const esc = value => String(value ?? "").replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const labels = {
    "performance.daily": "Visualizar vendas e meta do dia", "performance.history": "Visualizar histórico de faturamento",
    "sales.create": "Criar venda", "sales.cancel": "Cancelar venda", "sales.viewAll": "Consultar e administrar vendas / pedidos",
    "customers.view": "Ver clientes", "customers.create": "Cadastrar clientes", "customers.edit": "Editar clientes existentes", "customers.archive": "Desativar / reativar clientes", "customers.receiveDebt": "Registrar recebimentos / fiado",
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
      linked("sales-read", "Ver vendas do espaço", p => p["sales.create"] || p["sales.viewAll"], "A consulta da loja inclui todos os operadores dos espaços autorizados. As novas opções em Metas e desempenho definem a visualização do dia e do histórico; vender não concede histórico no modelo V3.", "view"),
      row("sales.create", "execute", "Permite registrar vendas. Os indicadores e o histórico têm controles próprios em Metas e desempenho."), row("sales.cancel", "execute", "Para liberar, ative Criar venda. Não é possível conceder somente cancelamento nesta versão."),
      row("sales.viewAll", "view", "Libera a consulta administrativa de vendas e dos pedidos online. Para atender pedidos, também é preciso Criar venda. Não libera o Financeiro."),
      linked("discount", "Aplicar desconto", p => p["sales.create"], "Vinculado a Criar venda. Ainda não há bloqueio independente para descontos."),
      linked("price", "Alterar preço na venda", p => p["sales.create"], "Incluído em Criar venda. Ainda não é possível permitir vendas e bloquear a alteração de preço separadamente.")
    ] },
    { id: "customers", name: "Clientes", icon: "users-round", rows: [row("customers.view", "view", "Permite consultar os clientes autorizados e seus saldos para atendimento."), row("customers.create", "execute", "Cria um cadastro novo com saldo zero. Não permite editar clientes existentes, desativar cadastros ou ajustar dívidas."), row("customers.edit", "execute", "Altera dados de clientes existentes, como nome e telefone. Não permite cadastrar, desativar ou alterar saldos."), row("customers.archive", "execute", "Desativa ou reativa clientes sem apagar o cadastro, as dívidas ou as referências de vendas.")] },
    { id: "products", name: "Produtos e estoque", icon: "box", rows: [row("products.view", "view"), row("products.edit", "execute", "Cadastro e edição não têm permissões separadas no modelo atual."), row("inventory.view", "view"), row("inventory.adjust", "execute", "Não afeta a baixa legítima de estoque gerada por uma venda autorizada.")] },
    { id: "goals", name: "Metas e desempenho", icon: "chart-no-axes-combined", rows: [
      row("performance.daily", "view", "Total e quantidade das vendas de hoje nos espaços autorizados, meta diária, percentual e valor restante. Não libera Financeiro, custos ou lucro."),
      row("performance.history", "view", "Exige visualizar o dia. Libera dias anteriores, comparativos, gráficos, melhor dia, média e análises históricas. Relatórios completos continuam exigindo Ver relatórios."),
      row("reports.view", "view", "Relatórios, CRM e campanhas também exigem histórico de faturamento. Não concede Financeiro, custos ou lucro.")
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
    context().role, context().permissions, context().allowedSpaceIds, context().spaceAccess, window.TeamAccess?.captureSession?.()]);
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
  const descriptions = {
    'sales.create':'Registra vendas nos espaços liberados. O desempenho tem controles próprios.',
    'sales.cancel':'Permite solicitar um cancelamento seguro. Requer Criar venda.',
    'sales.viewAll':'Consulta vendas e administra pedidos nos espaços autorizados. Não libera Financeiro.',
    'customers.view':'Consulta cadastros e saldos necessários ao atendimento.',
    'customers.create':'Cadastros novos com saldo zero. Não permite editar clientes existentes.',
    'customers.edit':'Atualiza dados cadastrais, como nome e telefone. Não altera saldos.',
    'customers.archive':'Desativa ou reativa o cadastro, preservando dívidas e histórico.',
    'customers.receiveDebt':'Registra pagamentos de Fiado sem liberar todo o Financeiro. O recebimento pelo card exige acesso ao histórico e uma conta comprovada no espaço autorizado.',
    'customers.adjustBalance':'Corrige o saldo devedor. Não é uma simples edição de cadastro.',
    'products.view':'Consulta os produtos dos espaços autorizados.',
    'products.edit':'Cadastra, edita e gerencia produtos, preservando seus vínculos históricos.',
    'inventory.view':'Consulta estoque e movimentações nos espaços liberados.',
    'inventory.adjust':'Registra ajustes de estoque. A baixa por venda autorizada continua independente.',
    'performance.daily':'Vendas e quantidade de hoje, meta diária, percentual e valor restante da loja.',
    'performance.history':'Libera dias anteriores, gráficos e comparativos. Requer visualizar o dia.',
    'reports.view':'Libera relatórios, CRM e campanhas. Análises gerenciais exigem histórico autorizado.',
    'financial.view':'Consulta e movimenta receitas e despesas nos espaços autorizados.',
    'cost.view':'Consulta e gerencia custos. Os registros compartilhados também podem mostrar lucro.',
    'profit.view':'Consulta lucro e margem. Os registros compartilhados também podem mostrar custos.',
    'team.view':'Consulta funcionários e seus vínculos com a empresa.',
    'team.manage':'Convida funcionários e administra acessos, dentro das permissões de quem está gerenciando.',
    'settings.manage':'Abre e altera configurações autorizadas. Ações exclusivas do proprietário continuam protegidas.',
    'spaces.manage':'Gerencia espaços conforme o vínculo e as regras da empresa.',
    'billing.manage':'Consulta planos. Contratação e cobrança continuam exclusivas do proprietário.'
  };
  function permissionRow(r, s) {
    const owner=s.original.role==='owner', enabled=r.linked?r.test(s.draft.permissions,owner):s.draft.permissions[r.key];
    if(r.linked)return `<div class="tp-linked"><span class="tp-linked-symbol">${icon('link-2')}</span><div><b>${esc(r.label)}</b><small>${esc(r.help)}</small></div><span class="tp-linked-state ${enabled?'is-enabled':''}">${icon(enabled?'check':'lock-keyhole')}${enabled?'Incluído':'Não liberado'}</span></div>`;
    const missing=(M.DEPENDENCIES[r.key]||[]).filter(key=>!s.draft.permissions[key]);
    const forbidden=context().role!=='owner'&&!window.TeamAccess.has(r.key),locked=owner||s.busy||s.invalid||forbidden||(missing.length&&!enabled),id=`tp-${r.key}`;
    return `<div class="tp-row ${missing.length?'has-dependency':''}"><div class="tp-row-copy"><label for="${id}">${esc(r.label)}</label><small id="${id}-help">${esc(descriptions[r.key]||r.help)}</small>${missing.length?`<small class="tp-dependency" id="${id}-dependency">${icon('link-2')}Ative antes: ${missing.map(k=>esc(labels[k])).join(', ')}</small>`:''}${forbidden?'<small class="tp-dependency">Você não pode conceder um acesso que não possui.</small>':''}</div><input class="tp-toggle" id="${id}" type="checkbox" role="switch" data-tp-key="${r.key}" ${enabled?'checked':''} ${locked?'disabled':''} aria-describedby="${id}-help${missing.length?' '+id+'-dependency':''}"></div>`;
  }
  function dashboardPreview(s){
    const owner=s.original.role==='owner',daily=owner||s.draft.permissions['performance.daily'],history=owner||daily&&s.draft.permissions['performance.history'];
    const title=owner?'Dashboard completo do proprietário':history?'Hoje e histórico':daily?'Somente os números de hoje':'Sem indicadores de desempenho';
    const copy=history?'Vendas do dia, metas, gráficos e comparativos dos espaços autorizados.':daily?'Vendas e quantidade do dia, meta, progresso e quanto falta. Sem gráficos ou comparativos históricos.':'A área de desempenho fica simplificada. As operações autorizadas continuam disponíveis.';
    return `<aside class="tp-dashboard-preview" data-tp-dashboard-preview data-mode="${history?'history':daily?'daily':'none'}">${icon(daily?'chart-no-axes-combined':'shield-check')}<div><span>O QUE O FUNCIONÁRIO VERÁ</span><b>${title}</b><p>${copy}</p><small>Prévia das escolhas desta tela. Nenhum acesso foi alterado.</small></div></aside>`;
  }
  function category(group,s){
    const direct=group.rows.filter(r=>!r.linked),enabled=direct.filter(r=>s.draft.permissions[r.key]).length,linkedRows=group.rows.filter(r=>r.linked);
    const count=direct.length?`${enabled} de ${direct.length}`:`${linkedRows.filter(r=>r.test(s.draft.permissions,s.original.role==='owner')).length} de ${linkedRows.length}`;
    const guidance=group.id==='goals'?'<p class="tp-category-note">Escolha o alcance do Dashboard. Financeiro, custos ou lucro continuam com suas permissões próprias.</p>':'';
    const linkedMarkup=linkedRows.map(r=>permissionRow(r,s)).join('');
    const linkedContent=!linkedRows.length?'':direct.length?`<details class="tp-linked-list" data-tp-extra="${group.id}" ${s.open.has('extras:'+group.id)?'open':''}><summary>${icon('link-2')}Ações incluídas nestes acessos${icon('chevron-down')}</summary>${linkedMarkup}</details>`:`<div class="tp-linked-list">${linkedMarkup}</div>`;
    return `<details class="tp-section ${group.id==='goals'?'tp-section-goals':''}" data-tp-group="${group.id}" ${s.open.has(group.id)?'open':''}><summary><span class="tp-section-icon">${icon(group.icon)}</span><span class="tp-category-name">${group.name}<small>${direct.length?'Permissões ativas':'Ações vinculadas aos acessos existentes'}</small></span><span class="tp-count" aria-label="${count} ${direct.length?'permissões ativas':'ações disponíveis'}">${count}</span>${icon('chevron-down')}</summary><div class="tp-section-content">${guidance}${group.notice?`<details class="tp-category-help"><summary>${icon('info')}Sobre este acesso</summary><p>${esc(group.notice)}</p></details>`:''}${direct.map(r=>permissionRow(r,s)).join('')}${group.id==='goals'?dashboardPreview(s):''}${linkedContent}</div></details>`;
  }
  function readPolicyTransition(s) {
    const privacy = window.OperationalPrivacyPolicy;
    return Boolean(privacy?.restricted({ ...s.draft, permissionsVersion: 3 }) && !privacy.restricted(s.original));
  }
  function readPolicyBlocked(s) {
    return readPolicyTransition(s) && context().business?.operationalReadPolicyVersion !== 1;
  }
  function updateInsets(){
    const page=q('[data-permission-editor]');if(!page)return;
    const viewport=window.visualViewport,keyboard=viewport?Math.max(0,innerHeight-viewport.height-viewport.offsetTop):0;
    const nav=q('#bottom-nav')||q('.qa-mobile-nav'),box=nav?.getBoundingClientRect(),navHeight=box?.width>0?Math.max(0,innerHeight-box.top):0;
    page.style.setProperty('--tp-bottom-offset',Math.max(navHeight,keyboard)+'px');
  }
  addEventListener('resize',updateInsets);window.visualViewport?.addEventListener('resize',updateInsets);window.visualViewport?.addEventListener('scroll',updateInsets);
  function render(s, first=false){
    if(active!==s||(!first&&!q('[data-permission-editor]')))return;
    if(!first)qa('[data-tp-group]').forEach(section=>section.open?s.open.add(section.dataset.tpGroup):s.open.delete(section.dataset.tpGroup));
    if(!first)qa('[data-tp-extra]').forEach(section=>section.open?s.open.add('extras:'+section.dataset.tpExtra):s.open.delete('extras:'+section.dataset.tpExtra));
    const root=q('#app'),member=s.original,owner=member.role==='owner',name=context().business?.name||context().businessName||'Empresa atual';
    const diff=M.difference(M.explicit(member),s.draft.permissions),pending=dirty(s);
    const status=({active:'Ativo',invited:'Convite pendente',disabled:'Inativo'})[member.status]||'Inativo';
    let legacy='';
    if(Number(member.permissionsVersion||1)<3)legacy='As opções refletem os acessos já autorizados. Nenhum funcionário foi alterado automaticamente. Para limitar o histórico, revise as escolhas e confirme antes de salvar. Dados já obtidos em dispositivos não são apagados.';
    if(Number(member.permissionsVersion||1)<2&&M.explicit(member)['customers.edit'])legacy+=' O acesso antigo a editar clientes já incluía cadastrar e desativar. Esses acessos foram preservados nesta revisão e podem ser separados explicitamente.';
    if(Array.isArray(member.permissions))legacy='Este vínculo usa um formato legado que o servidor não autoriza como mapa de permissões. O original foi preservado. Revise e confirme os acessos antes de salvar.';
    const transitionPending=readPolicyBlocked(s);
    root.innerHTML=`<section class="tp-page" data-permission-editor aria-labelledby="tp-title"><nav class="tp-breadcrumb" aria-label="Localização"><button type="button" data-tp-back>${icon('arrow-left')}Equipe</button><span aria-hidden="true">/</span><span>Permissões</span></nav>
      <header class="tp-heading"><div><span class="tp-eyebrow">PESSOAS E ACESSOS</span><h1 id="tp-title" tabindex="-1">Permissões da equipe</h1><p>Defina o que cada pessoa pode ver e fazer na sua empresa.</p></div><button type="button" class="tp-button tp-help" data-tp-help aria-label="Como funcionam as permissões?">${icon('circle-help')}<span>Como funciona</span></button></header>
      <article class="tp-identity"><span class="tp-avatar" aria-hidden="true">${esc(initials(member.name))}</span><div class="tp-person"><div class="tp-name"><h2>${esc(member.name||'Funcionário')}</h2><span class="tp-status ${member.status==='active'?'':'is-inactive'}">${status}</span></div><p>${icon('user-round')}${esc(roleLabel(member.role))}</p><p>${icon('store')}${esc(name)}</p></div><button class="tp-button tp-switch" type="button" data-tp-switch>${icon('arrow-left-right')}<span>Trocar funcionário</span></button></article>
      <section class="tp-presets" aria-labelledby="tp-profile-title"><div class="tp-block-heading"><span>${icon('user-round')}</span><div><h2 id="tp-profile-title">Perfil de acesso</h2><p>Comece com um modelo ou personalize as permissões.</p></div></div><div class="tp-preset-grid" role="group" aria-label="Perfil de acesso">${[['seller','user-round','Vendedor / Caixa','Vendas e meta diária'],['manager','crown','Gerente','Operação ampliada, sem Financeiro'],['custom','sliders-horizontal','Personalizado','Escolha cada acesso']].map(([id,symbol,title,copy])=>`<button type="button" class="tp-preset" data-tp-preset="${id}" aria-pressed="${s.profile===id}" ${owner||s.invalid||s.busy?'disabled':''}>${icon(symbol)}<span><b>${title}</b><small>${copy}</small></span><span class="tp-preset-dot" aria-hidden="true"></span></button>`).join('')}</div><p class="tp-note">${owner?'O proprietário possui acesso integral protegido. Esta tela não altera seu cargo.':'Aplicar um modelo substitui as escolhas e o cargo somente após confirmar e salvar. Personalizado mantém o cargo escolhido e os espaços.'}</p></section>
      <section class="tp-spaces" aria-labelledby="tp-spaces-title"><div class="tp-block-heading"><span>${icon('layers')}</span><div><h2 id="tp-spaces-title">Espaços autorizados</h2><p>Escolha onde esta pessoa poderá trabalhar.</p></div></div><div class="tp-space-mode" role="group" aria-label="Alcance dos espaços">${[['selected','Espaços específicos'],['all','Todos os espaços']].map(([value,label])=>`<label><input type="radio" name="tp-space-mode" value="${value}" ${s.draft.spaceAccess===value?'checked':''} ${owner||s.invalid||s.busy?'disabled':''}><span>${label}</span></label>`).join('')}</div>${s.draft.spaceAccess==='all'?'<p class="tp-note">Inclui os espaços atuais e os que forem criados no futuro nesta empresa.</p>':`<div class="tp-space-chips">${s.spaces.map(space=>`<label><input type="checkbox" data-tp-space="${esc(space.id)}" ${s.draft.allowedSpaceIds.includes(space.id)?'checked':''} ${owner||s.invalid||s.busy?'disabled':''}><span>${icon('store')}${esc(space.name)}</span></label>`).join('')||'<p>Nenhum espaço disponível. Não é possível salvar sem um espaço autorizado.</p>'}</div>`}</section>
      <div class="tp-block-heading tp-permissions-heading"><span>${icon('shield-check')}</span><div><h2>O que esta pessoa pode fazer</h2><p>Abra cada área para revisar os acessos.</p></div></div>
      <div class="tp-permission-grid">${groups.map(group=>category(group,s)).join('')}</div>
      ${transitionPending?'<aside class="tp-rollout-note" role="status">'+icon('shield-check')+'<div><b>Alterações ainda não podem ser salvas</b><p>Para aplicar um perfil sem histórico, a empresa precisa concluir a preparação de segurança. Os acessos atuais continuam em vigor.</p>'+(M.explicit(member)['performance.history']?'<p>Para salvar outras alterações agora, mantenha a opção de histórico já autorizada.</p>':'')+'</div></aside>':''}
      ${legacy?`<details class="tp-compat"><summary>${icon('shield-check')}Acessos atuais preservados${icon('chevron-down')}</summary><p>${esc(legacy)}</p></details>`:''}
      <div class="tp-feedback ${s.feedbackType==='error'?'is-error':''}" data-tp-feedback role="${s.feedbackType==='error'?'alert':'status'}" aria-live="polite">${esc(s.message||'')}</div>
      <footer class="tp-savebar"><div><b>${pending?'Alterações não salvas':'Acessos atuais preservados'}</b><small>${pending?diff.added.length+' a liberar · '+diff.removed.length+' a remover':'Nada muda sem a sua confirmação'}</small></div><button class="tp-button" type="button" data-tp-back ${s.busy?'disabled':''}>Cancelar</button><button class="tp-button tp-primary" type="button" data-tp-save ${owner||!pending||s.busy||s.invalid||transitionPending?'disabled':''}>${icon('check')}${s.busy?'Salvando…':'Salvar permissões'}</button></footer></section>`;
    bind(s);updateInsets();window.lucide?.createIcons();
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
    if(window.AdiFestaBuild?.permissionsV2EditingPaused){s.feedbackType='error';s.message='A edição de permissões está pausada para manutenção. Os acessos atuais foram preservados.';render(s);return;}
    if (!valid(s) || s.invalid || s.busy || !dirty(s) || readPolicyBlocked(s)) return;
    let payload;
    try { payload = M.serialize(s.original, s.draft); }
    catch (error) { s.feedbackType='error'; s.message = error.message; render(s); q("[data-tp-feedback]").scrollIntoView({ block: "center" }); return; }
    const transition=readPolicyTransition(s),conflicts=window.OperationalPrivacyPolicy?.incompatibleGrants(payload)||[];
    if(conflicts.length){s.feedbackType='error';s.message='O perfil sem histórico não pode manter estes acessos gerenciais: '+conflicts.map(k=>labels[k]||k).join(', ')+'. Revise as escolhas; nenhum acesso foi alterado.';render(s);return;}
    if(transition){payload.confirmReadPolicyTransition=true;}
    const diff = M.difference(M.explicit(s.original), s.draft.permissions);
    const list = keys => keys.length ? `<ul>${keys.map(key => `<li>${esc(labels[key])}</li>`).join("")}</ul>` : "<p>Nenhuma.</p>";
    dialog(s, "Revisar alterações", `<p>Funcionário: <b>${esc(s.original.name)}</b>. Confira tudo abaixo. Nada será alterado até tocar em Confirmar e salvar.</p>${transition?'<p class="tp-caution">Confirme que os aparelhos estão atualizados e as filas foram conferidas. A restrição bloqueia novas leituras históricas, mas não apaga dados já obtidos. Atendimentos de vendas antigas exigirão autorização pontual do proprietário.</p>':''}<h3>Acessos que serão liberados</h3>${list(diff.added)}<h3>Acessos que serão removidos</h3>${list(diff.removed)}<p>Cargo após salvar: <b>${esc(roleLabel(payload.role))}</b></p><p>Espaços liberados após salvar: <b>${payload.spaceAccess === "all" ? "Todos os atuais e futuros" : s.spaces.filter(space => payload.allowedSpaceIds.includes(space.id)).map(space => esc(space.name)).join(", ")}</b></p>${diff.added.some(key => ["financial.view", "cost.view", "profit.view", "team.manage", "settings.manage", "spaces.manage", "billing.manage"].includes(key)) ? '<p class="tp-caution">Atenção: você está liberando acesso financeiro ou administrativo. Liberar Financeiro permite registrar receitas e despesas. Liberar custos ou lucro pode permitir consultar os dois. Confirme somente se deseja conceder esses acessos.</p>' : ""}`, "Confirmar e salvar", async () => {
      s.busy = true; s.feedbackType=''; s.message = ""; render(s);
      try {
        await window.TeamService.updateMember(s.original.uid || s.original.id, payload);
        if (!valid(s) || s.invalid) return;
        s.feedbackType = "success";
        s.message = "Permissões salvas. Dispositivos conectados recebem a atualização. Dispositivos offline precisam se conectar para atualizar o acesso.";
        s.original = { ...s.original, ...payload }; delete s.original.expectedAccess;
        s.initial = initial(s.draft);
      } catch (error) {
        if (valid(s) && !s.invalid) { s.feedbackType = "error"; s.message = error.message || "Não foi possível salvar. Nenhum acesso foi confirmado por esta tela."; }
      } finally { s.busy = false; if (active === s) render(s); }
    });
  }
  function bind(s) {
    qa("[data-tp-back], [data-tp-switch]").forEach(button => { button.onclick = () => leave(s); });
    q("[data-tp-help]").onclick = () => dialog(s, "Como funcionam as permissões?", "<p>Visualizar permite consultar. Executar / Editar permite realizar ações ou alterar dados. Uma opção Vinculada faz parte de outro acesso e não pode ser alterada separadamente nesta versão.</p><p>Selecionar o cargo atual mantém as permissões do funcionário. Escolher um modelo de outro cargo substitui as escolhas do rascunho após confirmação. Confira as mudanças antes de salvar. Os espaços escolhidos são preservados.</p><p>Ao ajustar uma permissão manualmente, o perfil passa a Personalizado, sem mudar o cargo escolhido. Desligar uma opção também desliga as que precisam dela nesta tela. Você verá todas as remoções antes de salvar. Abrir ou cancelar esta tela não muda os acessos atuais.</p>", "", null);
    qa("[data-tp-group]").forEach(details => { details.ontoggle = () => { if (details.open) s.open.add(details.dataset.tpGroup); else s.open.delete(details.dataset.tpGroup); }; });
    qa("[data-tp-key]").forEach(input => { input.onchange = () => {
      if (!valid(s) || s.busy || s.invalid) return invalidate();
      s.feedbackType='';
      const key = input.dataset.tpKey, changed = M.change(s.draft.permissions, key, input.checked);
      s.draft.permissions = changed.values; s.profile = "custom";
      s.message = changed.removed.length ? `Também serão desligadas, pois precisam desta opção: ${changed.removed.map(id => labels[id]).join(", ")}. O perfil passou a Personalizado. Nada muda para o funcionário antes de salvar.` : "Perfil Personalizado: ajuste feito somente nesta tela. O cargo foi mantido. Confirme e salve para aplicar.";
      render(s); document.getElementById(`tp-${key}`)?.focus({preventScroll:true});
    }; });
    qa("[data-tp-preset]").forEach(button => { button.onclick = () => {
      if (!valid(s) || s.busy || s.invalid) return;
      s.feedbackType='';
      const profile = button.dataset.tpPreset;
      if (profile === "custom") { s.profile = profile; render(s); q('[data-tp-preset="custom"]').focus(); return; }
      if (profile === s.draft.role) {
        s.message = "Este cargo já está selecionado. Marque somente os acessos que deseja alterar. As escolhas atuais foram mantidas.";
        render(s);
        q(`[data-tp-preset="${profile}"]`)?.focus();
        return;
      }
      const values = M.preset(profile);
      if (context().role !== "owner" && M.KEYS.some(key => values[key] && !window.TeamAccess.has(key))) { s.message = "Este modelo inclui acessos que você não tem permissão para liberar. Peça ao proprietário para revisar."; render(s); return; }
      dialog(s, "Usar este modelo de acesso?", `<p>Escolher ${profile === "seller" ? "Vendedor / Caixa" : "Gerente"} substituirá as permissões desta tela e o cargo ao salvar. Isso pode remover acessos liberados anteriormente.</p><p>Não inclui Financeiro, custos, lucro, gestão de equipe ou configurações. Os espaços escolhidos serão mantidos.</p><p>Por enquanto, a mudança fica somente nesta tela. Você ainda revisará tudo e confirmará antes de salvar.</p>`, "Usar este modelo", () => { s.draft.permissions = values; s.draft.role = profile; s.profile = profile; s.message = "Modelo aplicado somente nesta tela. Revise os acessos e o cargo antes de confirmar e salvar."; render(s); });
    }; });
    qa('[name="tp-space-mode"]').forEach(input => { input.onchange = () => { if (!valid(s) || s.busy || s.invalid) return; s.feedbackType='';s.draft.spaceAccess = input.value; render(s);qa('[name="tp-space-mode"]').find(el=>el.value===s.draft.spaceAccess)?.focus(); }; });
    qa("[data-tp-space]").forEach(input => { input.onchange = () => { if (!valid(s) || s.busy || s.invalid) return;
      const set = new Set(s.draft.allowedSpaceIds); if (input.checked) set.add(input.dataset.tpSpace); else set.delete(input.dataset.tpSpace);
      s.feedbackType='';s.draft.allowedSpaceIds = [...set].sort(); render(s);qa('[data-tp-space]').find(el=>el.dataset.tpSpace===input.dataset.tpSpace)?.focus();
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
      open: new Set(["sales", "goals"]), message: M.issues(draft.permissions).length ? "Alguns acessos atuais precisam de outra opção que está desligada. Nada foi alterado. Antes de salvar mudanças, confira os avisos nas seções e escolha o que deseja manter." : "", onClose: onClose || (() => { q("#app").innerHTML = window.TeamPage.render(); window.TeamPage.bind(); }) };
    render(active, true); q("#tp-title").focus(); return true;
  }
  window.TeamPermissionEditor = Object.freeze({ open });
})();
