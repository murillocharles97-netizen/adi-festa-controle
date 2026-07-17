import './sync.js';

let unsubscribe=null;
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const escape=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
const notify=(message,error=false)=>window.Utils?.toast?.(message,error);

function backup(){
  const data=window.DB?.criarBackup?.()||window.DB?.carregar?.();
  const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
  const link=document.createElement('a');
  link.href=url;
  link.download=`adi-festa-backup-antes-da-nuvem-${new Date().toISOString().slice(0,10)}.json`;
  link.click();
  setTimeout(()=>URL.revokeObjectURL(url),1000);
}

function panel(){
  const settings=document.querySelector('.settings');
  if(!settings||document.querySelector('#firebase-cloud-panel'))return;
  const session=window.FirebaseSession,profile=session?.profile||{},uid=session?.user?.uid||'';
  settings.insertAdjacentHTML('beforeend',`<section class="setting firebase-account" id="firebase-account-panel"><div><b>Conta</b><div class="firebase-account-grid"><span>Nome</span><strong>${escape(profile.name||'Administrador')}</strong><span>E-mail</span><strong>${escape(session?.user?.email||'')}</strong><span>UID</span><strong>${escape(uid?`${uid.slice(0,8)}…`:'')}</strong><span>Perfil</span><strong>${profile.role==='admin'?'Administrador':escape(profile.role||'')}</strong><span>Negócio</span><strong>Adi Festa</strong><span>Status</span><strong>${profile.active===true?'Ativo':'Inativo'}</strong></div></div><button class="btn btn-danger" id="firebase-logout" type="button">Sair da conta</button></section><section class="setting firebase-setting" id="firebase-cloud-panel">
    <div class="firebase-copy"><b>Nuvem segura</b><small>Faça o teste e envie o backup local para sua conta Firebase.</small>
      <div class="firebase-status" id="firebase-status" role="status">Aguardando teste de conexão</div>
      <div class="firebase-progress" aria-hidden="true"><i id="firebase-progress-bar"></i></div>
      <div class="firebase-counts" id="firebase-counts"></div>
      <button class="firebase-details-toggle" id="firebase-details-toggle" type="button">Ver detalhes</button>
      <dl class="firebase-details" id="firebase-details" hidden></dl>
    </div>
    <div class="actions firebase-actions">
      <button class="btn btn-light" id="firebase-diagnostic" type="button">Executar diagnóstico</button>
      <button class="btn btn-light" id="firebase-test" type="button">Testar conexão com a nuvem</button>
      <button class="btn btn-primary" id="firebase-migrate" type="button" disabled>Enviar dados para a nuvem</button>
      <button class="btn btn-dark" id="firebase-sync" type="button">Sincronizar agora</button>
    </div>
  </section>`);
  bind();
  unsubscribe?.();
  unsubscribe=window.SyncFirebase.subscribe(renderState);
}

function setBusy(busy){
  ['firebase-diagnostic','firebase-test','firebase-migrate','firebase-sync'].forEach(id=>{const button=document.querySelector(`#${id}`);if(button)button.disabled=busy||(id==='firebase-migrate'&&!window.SyncFirebaseState?.testPassed)});
}

async function run(buttonId,label,task){
  const button=document.querySelector(`#${buttonId}`),original=button?.textContent;
  document.querySelector('#firebase-cloud-panel')?.setAttribute('aria-busy','true');
  setBusy(true);
  if(button)button.textContent=label;
  try{return await task()}catch(error){notify(error?.message||'Não foi possível concluir a operação.',true);throw error}finally{
    document.querySelector('#firebase-cloud-panel')?.removeAttribute('aria-busy');
    if(button)button.textContent=original;
    setBusy(false);
  }
}

function bind(){
  document.querySelector('#firebase-diagnostic').onclick=()=>run('firebase-diagnostic','Verificando…',async()=>{await window.SyncFirebase.runFirebaseDiagnostic();document.querySelector('#firebase-details').hidden=false;document.querySelector('#firebase-details-toggle').textContent='Ocultar detalhes';notify('Diagnóstico concluído sem falhas.')}).catch(error=>console.error('[Firebase diagnostic button]',error));
  document.querySelector('#firebase-test').onclick=()=>run('firebase-test','Testando…',async()=>{
    await window.SyncFirebase.testFirestoreConnection();
    notify('Conexão com Firestore funcionando.');
  }).catch(error=>console.error('[Cloud connection button]',error));
  document.querySelector('#firebase-migrate').onclick=()=>run('firebase-migrate','Enviando…',async()=>{
    const summary=window.SyncFirebase.snapshot();
    if(!confirm(`Será criado um backup automático e enviados:\n\n${summary.clientes} clientes\n${summary.produtos} produtos\n${summary.vendas} vendas\n${summary.pagamentos} pagamentos\nTotal em aberto: ${money(summary.fiado)}\n\nContinuar?`))return;
    backup();
    const result=await window.SyncFirebase.startCloudMigration();
    notify(result.check.ok?'Migração concluída e conferida.':'A conferência encontrou diferenças.',!result.check.ok);
  }).catch(error=>console.error('[Cloud migration button]',error));
  document.querySelector('#firebase-sync').onclick=()=>run('firebase-sync','Sincronizando…',async()=>{
    await window.SyncFirebase.synchronizeNow();
    notify('Sincronização concluída.');
  }).catch(error=>console.error('[Cloud synchronization button]',error));
  document.querySelector('#firebase-logout').onclick=async()=>{if(!confirm('Deseja realmente sair desta conta?'))return;await window.FirebaseAuthActions?.signOut?.()};
  document.querySelector('#firebase-details-toggle').onclick=event=>{
    const details=document.querySelector('#firebase-details');
    details.hidden=!details.hidden;
    event.currentTarget.textContent=details.hidden?'Ver detalhes':'Ocultar detalhes';
  };
}

function renderState(state){
  window.SyncFirebaseState=state;
  const status=document.querySelector('#firebase-status');
  if(!status)return;
  status.className=`firebase-status is-${state.status}`;
  status.textContent=state.message;
  document.querySelector('#firebase-progress-bar').style.width=`${state.progress||0}%`;
  const sent=Object.entries(state.sent||{}).map(([name,total])=>`${name}: ${total}`).join(' · ');
  const comparison=state.comparison?`Conferência: local ${state.comparison.local.clientes} clientes / nuvem ${state.comparison.remote.clients||0}; fiado local ${money(state.comparison.local.fiado)} / nuvem ${money(state.comparison.remote.fiado||0)}.`:'';
  document.querySelector('#firebase-counts').textContent=[sent,comparison].filter(Boolean).join(' — ')||'Nenhum dado enviado nesta sessão.';
  const d=state.details||{};
  document.querySelector('#firebase-details').innerHTML=`
    <dt>Autenticação pronta</dt><dd>${d.authReady?'sim':'não'}</dd>
    <dt>Usuário</dt><dd>${escape(d.authenticated?`${d.email} (${d.uid})`:'não autenticado')}</dd>
    <dt>Documento do usuário</dt><dd>${d.userDocumentExists?'localizado':'não localizado'}</dd>
    <dt>Perfil</dt><dd>${escape(`${d.userRole||'—'} · ${d.userActive?'ativo':'inativo'}`)}</dd>
    <dt>BusinessId do usuário</dt><dd>${escape(d.userBusinessId||'—')}</dd>
    <dt>Banco</dt><dd>${escape(d.databaseId)}</dd>
    <dt>Conexão</dt><dd>${escape(d.connection)}</dd>
    <dt>Listeners ativos</dt><dd>${escape(d.activeListeners)}</dd>
    <dt>Negócio</dt><dd>${escape(d.targetBusinessId)} · ${d.businessDocumentExists?'localizado':'não localizado'}</dd>
    <dt>Proprietário</dt><dd>${escape(d.businessOwnerId||'—')}</dd>
    <dt>UID confere</dt><dd>${d.ownerMatches?'sim':'não'}</dd>
    <dt>Projeto</dt><dd>${escape(d.projectId)}</dd>
    <dt>Caminho atual</dt><dd>${escape(d.currentPath)}</dd>
    <dt>Clientes</dt><dd>local ${escape(d.localClients)} · nuvem ${escape(d.cloudClients)}</dd>
    <dt>Produtos</dt><dd>local ${escape(d.localProducts)} · nuvem ${escape(d.cloudProducts)}</dd>
    <dt>Operações pendentes</dt><dd>${escape(d.pending)}</dd>
    <dt>Última sincronização</dt><dd>${escape(d.lastSync)}</dd>
    <dt>Último erro</dt><dd>${escape(d.lastErrorCode?`${d.lastErrorCode}: ${d.lastErrorMessage}`:'nenhum')}</dd>`;
  const busy=['testing','validating','syncing'].includes(state.status);
  const diagnostic=document.querySelector('#firebase-diagnostic'),test=document.querySelector('#firebase-test'),sync=document.querySelector('#firebase-sync'),migrate=document.querySelector('#firebase-migrate');
  if(diagnostic)diagnostic.disabled=busy;
  if(test)test.disabled=busy;
  if(sync)sync.disabled=busy;
  if(migrate)migrate.disabled=!state.testPassed||busy;
}

function mount(){if(location.hash.includes('configuracoes'))queueMicrotask(panel)}
addEventListener('hashchange',mount);
addEventListener('firebase-auth-ready',mount);
new MutationObserver(mount).observe(document.querySelector('main')||document.body,{childList:true,subtree:true});
mount();
