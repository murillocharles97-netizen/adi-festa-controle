(function(){
  'use strict';
  let sending=false,operationId=null,watchStop=null,watched='',lastJob=null;
  const esc=value=>String(value??'').replace(/[&<>"']/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[char]));
  const owner=()=>window.FirebaseSession?.member?.role==='owner'&&window.FirebaseSession?.member?.status==='active';
  const businessId=()=>window.FirebaseSession?.businessId||window.BusinessContext?.get?.().businessId;
  const online=()=>{if(!navigator.onLine)throw Error('Conecte-se à internet para restaurar os dados da empresa.');};
  const retentionNotice='<p class="workspace-retention-note" data-reset-retention>A VECONI não cria backup nem permite desfazer este reset. Pela política atual do Firebase, arquivos excluídos podem permanecer retidos por até 7 dias.</p>';
  function modal(content){
    const root=document.querySelector('#modal');
    root.innerHTML=`<div class="modal-bg"><section class="modal-box workspace-reset-sheet" role="dialog" aria-modal="true" aria-labelledby="reset-title">${content}</section></div>`;
    root.querySelectorAll('[data-reset-cancel]').forEach(button=>button.onclick=()=>{if(!sending)root.innerHTML='';});
    return root;
  }
  function error(root,value){const output=root.querySelector('[data-reset-error]');if(output)output.textContent=value?.message||'Não foi possível continuar. Tente novamente.';}
  function risk(){
    if(!owner())return;
    const root=modal(`<header class="modal-head"><h2 id="reset-title">Dados e segurança</h2></header><div class="modal-body"><section class="workspace-danger"><small>Zona de risco</small><h3>Restaurar dados da empresa</h3><p>Apague os dados operacionais e recomece a configuração da VECONI.</p><button type="button" class="btn workspace-destructive" data-reset-start>Restaurar dados da empresa</button></section><p role="alert" data-reset-error></p></div><footer class="modal-foot"><button class="btn btn-light" data-reset-cancel>Fechar</button></footer>`);
    root.querySelector('[data-reset-start]').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{online();const response=await window.FirebaseCallable('getBusinessResetCapability',{businessId:businessId()});
        if(!button.isConnected)return; // Cancelled while the capability request was in flight.
        if(!response.data?.enabled)throw Error('Esta função ainda está em validação e não foi liberada neste ambiente.');
        if(response.data.realIntegratedPayments)throw Error('Esta empresa possui pagamentos integrados reais. Use o fluxo de encerramento de dados para continuar.');
        first();
      }catch(cause){error(root,cause);button.disabled=false;}
    };
  }
  function first(){
    if(!owner())return;
    const root=modal(`<header class="modal-head"><h2 id="reset-title">Recomeçar do zero?</h2></header><div class="modal-body"><p>Serão removidos produtos, estoque, clientes, vendas, fiado, financeiro, pedidos, campanhas, espaços, configurações, integrações e demais informações operacionais, incluindo vínculos de funcionários.</p><p><b>Sua conta, assinatura e plano continuarão ativos.</b></p><p class="workspace-danger-copy">Esta ação é irreversível na VECONI.</p>${retentionNotice}</div><footer class="modal-foot"><button class="btn btn-light" data-reset-cancel>Cancelar</button><button class="btn workspace-destructive" data-reset-continue>Continuar</button></footer>`);
    root.querySelector('[data-reset-continue]').onclick=()=>confirmReset();
  }
  function confirmReset(retry=false){
    const id=retry?watched.split('/')[0]:businessId();
    const root=modal(`<header class="modal-head"><h2 id="reset-title">${retry?'Retomar restauração':'Confirmar restauração'}</h2></header><form data-reset-form><div class="modal-body"><p>Confirme sua identidade e digite <b>RESETAR</b> para ${retry?'retomar a mesma operação':'apagar os dados operacionais'}.</p>${retentionNotice}<label>Senha da sua conta<input name="password" type="password" autocomplete="current-password" required></label><label>Digite RESETAR<input name="confirmation" autocomplete="off" spellcheck="false" required></label><p role="alert" data-reset-error></p></div><footer class="modal-foot"><button class="btn btn-light" type="button" data-reset-cancel>Cancelar</button><button class="btn workspace-destructive" data-reset-submit disabled>${retry?'Retomar restauração':'Apagar dados e recomeçar'}</button></footer></form>`);
    const button=root.querySelector('[data-reset-submit]'),form=root.querySelector('form');
    form.oninput=()=>button.disabled=sending||form.elements.confirmation.value!=='RESETAR'||!form.elements.password.value;
    form.onsubmit=async event=>{
      event.preventDefault();if(sending||form.elements.confirmation.value!=='RESETAR')return;
      sending=true;button.disabled=true;root.querySelectorAll('[data-reset-cancel]').forEach(node=>node.disabled=true);
      try{
        online();await window.WorkspaceResetAuth.reauthenticate(form.elements.password.value);form.elements.password.value='';
        operationId ||= crypto.randomUUID();
        const response=await window.FirebaseCallable(retry?'retryBusinessReset':'requestBusinessReset',{businessId:id,resetOperationId:operationId,confirmation:'RESETAR'});
        watch({businessId:id,operationId:response.data.job.id});
      }catch(cause){error(root,cause);}
      finally{sending=false;if(button.isConnected){button.disabled=true;root.querySelectorAll('[data-reset-cancel]').forEach(node=>node.disabled=false);}}
    };
  }
  function renderProgress(job){
    lastJob=job;
    const done=job.status==='COMPLETED',failed=job.status==='FAILED',labels={REQUESTED:'Preparando',LOCKED:'Preparando',DELETING:'Apagando dados e arquivos',VERIFYING:'Verificando',FAILED:'A restauração precisa ser retomada',COMPLETED:'Tudo pronto para recomeçar'};
    const gate=document.querySelector('#auth-gate');
    document.querySelector('#modal').innerHTML='';gate.hidden=false;document.documentElement.classList.add('auth-pending');
    gate.innerHTML=`<section class="auth-card workspace-reset-progress"><h1>${esc(labels[job.status]||'Restaurando dados…')}</h1><p>${done?'Seus dados operacionais foram removidos. Sua conta e assinatura continuam ativas.':failed?'O ambiente permanece bloqueado para proteger seus dados. Retome a mesma operação com segurança.':'Não use a empresa enquanto a restauração está em andamento. Você pode reabrir a VECONI para acompanhar.'}</p><p role="status">${Number(job.counts?.documents||0)} registros removidos · ${Number(job.counts?.files||0)} arquivos removidos</p>${done?'<button class="btn btn-primary" data-reset-setup>Configurar VECONI</button>':failed?'<button class="btn workspace-destructive" data-reset-retry>Retomar restauração</button>':'<progress aria-label="Restaurando dados"></progress>'}<p role="alert" data-reset-error></p></section>`;
    gate.querySelector('[data-reset-setup]')?.addEventListener('click',()=>{location.hash='#/configuracoes';location.reload();});
    gate.querySelector('[data-reset-retry]')?.addEventListener('click',()=>confirmReset(true));
  }
  function watch(detail){
    if(!detail?.businessId||!detail.operationId)return false;
    const key=`${detail.businessId}/${detail.operationId}`;
    if(key===watched&&watchStop){if(lastJob)renderProgress(lastJob);return true;}
    watchStop?.();watched=key;operationId=detail.operationId;lastJob=null;
    watchStop=window.FirebaseDocumentListener(['businesses',detail.businessId,'workspaceResetJobs',detail.operationId],job=>{if(job)renderProgress(job);},cause=>{
      const gate=document.querySelector('#auth-gate');
      // A denied/provisional read is not evidence that the job FAILED. In
      // particular, a removed member must never be offered an owner retry UI.
      if(!gate.querySelector('[data-reset-error]')){
        const output=document.createElement('p');output.dataset.resetError='';output.setAttribute('role','alert');gate.append(output);
      }
      error(gate,Error(cause.code==='permission-denied'?'Somente o proprietário pode acompanhar a restauração.':'Não foi possível atualizar o progresso. Reabra a VECONI para verificar.'));
    });
    return true;
  }
  document.addEventListener('click',event=>{if(event.target.closest('[data-workspace-risk]'))risk();});
  addEventListener('firebase-session-cleared',()=>{watchStop?.();watchStop=null;watched='';operationId=null;lastJob=null;});
  window.WorkspaceResetUI={risk,watch};
})();
