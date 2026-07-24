(function(){
  'use strict';
  const mq=matchMedia('(max-width:767px)');
  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
  const icon=name=>`<i data-lucide="${name}"></i>`;
  const esc=value=>window.Utils?.escapar?.(String(value??''))??String(value??'');
  const planNames={internal:'Plano interno',trial:'Teste grátis',essential:'Essencial',professional:'Profissional',premium:'Premium'};
  const roleNames={owner:'Proprietário',admin:'Administrador',manager:'Gerente',cashier:'Operador',viewer:'Consulta',platform_admin:'Administrador da plataforma'};
  const formatTime=value=>value?new Date(value).toLocaleString('pt-BR'):'Ainda não sincronizado';
  const initials=value=>String(value||'Empresa').trim().split(/\s+/).slice(0,2).map(part=>part[0]).join('').toUpperCase();
  const state=()=>window.SyncFirebaseState||window.SyncFirebase?.snapshot?.()||{};

  function render(){
    const session=window.FirebaseSession||{},business=session.business||{},profile=session.profile||{},subscription=session.subscription||business.subscription||{},sync=window.SyncFirebaseState||{},config=window.DB?.carregar?.().config||{};
    const name=business.name||config.nome||'Meu negócio',phone=business.phone||config.telefone||'Não informado',type=business.businessType||'Não informado',plan=planNames[subscription.planId]||subscription.planId||'Plano atual',accountActive=business.active!==false&&profile.active!==false;
    return `<div class="mobile-settings-page">
      <section class="mobile-settings-card settings-hero">
        <div class="settings-company-row"><span class="settings-logo">${esc(initials(name))}</span><div><h2>${esc(name)}</h2><p><span class="settings-plan">${esc(plan)}</span><span class="settings-account-dot"></span>${accountActive?'Conta ativa':'Conta inativa'}</p></div></div>
        <div class="settings-cloud-summary">
          <span class="settings-summary-icon">${icon('cloud-check')}</span><div><b id="firebase-status">Preparando sincronização…</b><small><span id="firebase-pending">${Number(sync.pending||0)}</span> pendência(s)</small></div>
          <span class="settings-summary-icon">${icon('clock-3')}</span><div><b>Última sincronização</b><small id="firebase-last-sync">${esc(formatTime(sync.lastSync))}</small></div>
        </div>
      </section>

      <section class="mobile-settings-card">
        <header class="settings-section-head"><span>${icon('store')}</span><div><h3>Minha empresa</h3><p>Dados usados em recibos e catálogos.</p></div><button class="settings-chevron" data-edit-business aria-label="Editar empresa">${icon('chevron-right')}</button></header>
        <div class="settings-info-grid company-info">
          <span>${icon('store')}<b>${esc(name)}</b><small>Nome do negócio</small></span>
          <span>${icon('phone')}<b>${esc(phone)}</b><small>Telefone</small></span>
          <span>${icon('tag')}<b>${esc(type)}</b><small>Tipo do comércio</small></span>
        </div>
        <button class="settings-mobile-secondary" data-edit-business>${icon('pencil')} Editar empresa</button>
      </section>

      <section class="mobile-settings-card">
        <header class="settings-section-head"><span>${icon('user-round')}</span><div><h3>Conta e acesso</h3><p>Seus dados pessoais e acesso ao sistema.</p></div></header>
        <div class="settings-account-data"><span><small>Nome</small><b>${esc(profile.name||'Administrador')}</b></span><span><small>E-mail</small><b>${esc(session.user?.email||profile.email||'')}</b></span><span><small>Perfil</small><b>${esc(roleNames[profile.role]||profile.role||'Usuário')}</b></span></div>
        <div class="settings-action-row"><button data-my-data>${icon('user-round')}<span>Meus dados</span></button><button data-reset-password>${icon('lock-keyhole')}<span>Alterar senha</span></button><button class="logout-link" data-settings-logout>${icon('log-out')}<span>Sair da conta</span></button></div>
      </section>

      <section class="mobile-settings-card">
        <header class="settings-section-head"><span>${icon('cloud-upload')}</span><div><h3>Nuvem e sincronização</h3><p>Acompanhe o envio seguro dos seus dados.</p></div></header>
        <div class="settings-sync-grid"><span><i data-lucide="refresh-cw"></i><b id="mobile-sync-pending">${Number(sync.pending||0)}</b><small>Pendentes</small></span><span><i data-lucide="triangle-alert"></i><b id="firebase-errors">${Number(sync.errors||0)}</b><small>Com erro</small></span><span><i data-lucide="clock-3"></i><b id="mobile-sync-last">${esc(formatTime(sync.lastSync))}</b><small>Último sync</small></span></div>
        <button class="settings-sync-button" id="firebase-sync">${icon('refresh-cw')} Sincronizar agora</button>
      </section>

      <section class="mobile-settings-card">
        <header class="settings-section-head"><span>${icon('folder')}</span><div><h3>Backup e dados</h3><p>Exporte, importe ou limpe dados deste aparelho.</p></div></header>
        <div class="settings-backup-actions"><button id="export">${icon('download')}<span><b>Exportar backup</b><small>Salvar uma cópia JSON</small></span></button><label>${icon('upload')}<span><b>Importar backup</b><small>Restaurar uma cópia</small></span><input type="file" id="import" accept="application/json" hidden></label><button class="danger" id="clear-device">${icon('trash-2')}<span><b>Limpar dados</b><small>Somente deste aparelho</small></span></button></div>
      </section>

      <section class="mobile-settings-card settings-collapsible">
        <button class="settings-collapse-toggle" id="firebase-details-toggle" aria-expanded="false"><span class="settings-head-icon">${icon('settings')}</span><span><b>Detalhes técnicos</b><small>Informações avançadas do aplicativo.</small></span><em>Recolhido</em>${icon('chevron-down')}</button>
        <dl class="firebase-details settings-technical-details" id="firebase-details" hidden></dl>
      </section>

      <section class="mobile-settings-card settings-risk">
        <header class="settings-section-head"><span>${icon('triangle-alert')}</span><div><h3>Área de risco</h3><p>Ações que afetam acesso ou dados locais.</p></div></header>
        <div class="settings-risk-actions"><button disabled title="Disponível futuramente">${icon('building-2')} Excluir empresa <small>Futuramente</small></button><button id="risk-clear-device">${icon('trash-2')} Limpar dados deste aparelho</button><button class="logout-safe" data-settings-logout>${icon('log-out')} Sair da conta</button></div>
      </section>
    </div>`;
  }

  function modal(content){
    const root=$('#modal');root.innerHTML=`<div class="modal-bg"><section class="modal-box settings-edit-sheet">${content}</section></div>`;window.lucide?.createIcons();return root;
  }
  function close(){const root=$('#modal');if(root)root.innerHTML=''}
  function editBusiness(){
    const business=window.FirebaseSession?.business||{},config=DB.carregar().config,root=modal(`<header class="modal-head"><h3>Editar empresa</h3><button class="icon-btn" data-close>${icon('x')}</button></header><form id="settings-business-form"><div class="modal-body"><div class="field"><label>Nome do negócio</label><input name="name" required value="${esc(business.name||config.nome||'')}"></div><div class="field"><label>Telefone</label><input name="phone" inputmode="tel" value="${esc(business.phone||config.telefone||'')}"></div><div class="field"><label>Tipo do comércio</label><input name="businessType" value="${esc(business.businessType||'')}"></div></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-close>Cancelar</button><button class="btn btn-primary">Salvar alterações</button></footer></form>`);
    $$('[data-close]',root).forEach(button=>button.onclick=close);
    $('#settings-business-form',root).onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;button.textContent='Salvando…';try{await window.FirebaseAuthActions.updateBusiness(Object.fromEntries(new FormData(event.currentTarget)));close();Utils.toast('Dados da empresa atualizados.');dispatchEvent(new Event('hashchange'))}catch(error){button.disabled=false;button.textContent='Salvar alterações';Utils.toast(error.message||'Não foi possível atualizar a empresa.',true)}};
  }
  function editProfile(){
    const profile=window.FirebaseSession?.profile||{},root=modal(`<header class="modal-head"><h3>Meus dados</h3><button class="icon-btn" data-close>${icon('x')}</button></header><form id="settings-profile-form"><div class="modal-body"><div class="field"><label>Nome</label><input name="name" required value="${esc(profile.name||'')}"></div><div class="field"><label>Telefone</label><input name="phone" inputmode="tel" value="${esc(profile.phone||'')}"></div></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-close>Cancelar</button><button class="btn btn-primary">Salvar alterações</button></footer></form>`);
    $$('[data-close]',root).forEach(button=>button.onclick=close);
    $('#settings-profile-form',root).onsubmit=async event=>{event.preventDefault();const button=event.submitter;button.disabled=true;button.textContent='Salvando…';try{await window.FirebaseAuthActions.updateProfile(Object.fromEntries(new FormData(event.currentTarget)));close();Utils.toast('Seus dados foram atualizados.');dispatchEvent(new Event('hashchange'))}catch(error){button.disabled=false;button.textContent='Salvar alterações';Utils.toast(error.message||'Não foi possível atualizar seus dados.',true)}};
  }
  async function syncNow(button){
    const original=button.innerHTML;button.disabled=true;button.innerHTML=`${icon('loader-circle')} Sincronizando…`;try{const result=await SyncFirebase.synchronizeNow();Utils.toast(result.offline?'Sem conexão. Seus dados continuam salvos neste aparelho.':'Sincronização concluída.',Boolean(result.errors))}catch(error){Utils.toast('Não foi possível sincronizar agora.',true)}finally{button.disabled=false;button.innerHTML=original;window.lucide?.createIcons()}
  }
  function bind(){
    if(!mq.matches)return;
    $$('[data-edit-business]').forEach(button=>button.onclick=editBusiness);
    $('[data-my-data]')?.addEventListener('click',editProfile);
    $('[data-reset-password]')?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{await window.FirebaseAuthActions.sendPasswordReset();Utils.toast('Enviamos as instruções para o seu e-mail.')}catch(error){Utils.toast(error.message||'Não foi possível enviar as instruções.',true)}finally{button.disabled=false}});
    $$('[data-settings-logout]').forEach(button=>button.onclick=()=>window.FirebaseAuthActions?.signOut?.());
    $('#firebase-sync')?.addEventListener('click',event=>syncNow(event.currentTarget));
    $('#firebase-details-toggle')?.addEventListener('click',event=>{const details=$('#firebase-details'),open=details.hidden;details.hidden=!open;event.currentTarget.setAttribute('aria-expanded',String(open));$('em',event.currentTarget).textContent=open?'Expandido':'Recolhido'});
    $('#risk-clear-device')?.addEventListener('click',()=>$('#clear-device')?.click());
  }
  window.ConfiguracoesMobile={isMobile:()=>mq.matches,render,bind};
})();
