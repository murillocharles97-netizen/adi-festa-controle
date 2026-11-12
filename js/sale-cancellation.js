/* Explicit online cancellation. Never replays or rewrites the commercial queue. */
window.SaleCancellation = (() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const identity=()=>({uid:window.FirebaseSession?.user?.uid,businessId:window.DB?.getBusinessId?.(),workspaceGeneration:window.DB?.getWorkspaceGeneration?.()??0,access:window.TeamAccess?.operationalReadScopeKey?.()||'',space:window.SpaceContext?.homeId?.()||''});
  const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
  const allowed=()=>window.TeamAccess?.has?.('sales.cancel')===true;
  const keyFor=(origin,sid)=>`veconi:sale-cancel:${origin.uid}:${origin.businessId}:${origin.workspaceGeneration}:${sid}`;
  function queueBlockMessage(){
    let diagnostic;
    try{diagnostic=window.SyncFirebase?.getFirebaseDiagnostic?.();}catch{}
    if(!diagnostic||diagnostic.queueStorageCorrupt)
      return 'Não foi possível ler a fila local. Abra Sincronização → Ver detalhes e preserve os dados deste aparelho para conferência.';
    const counts=[
      ['Pendências enviáveis',diagnostic.pending],
      ['Erros ativos',diagnostic.syncErrors],
      ['Em processamento',diagnostic.processingOperations],
      ['Aguardando gravação local',diagnostic.preparingOperations],
    ].filter(([,count])=>Number(count)>0);
    if(!counts.length)return '';
    return `Confirmação bloqueada por alterações locais. ${counts.map(([label,count])=>`${label}: ${count}`).join(' · ')}. Confira em Sincronização → Ver detalhes. Este fluxo não reenviará operações.`;
  }
  async function assertQueue(quote){
    if(typeof window.SyncFirebase?.assertCancellationQueueClear==='function')
      return window.SyncFirebase.assertCancellationQueueClear(quote);
    const message=queueBlockMessage();
    if(message)throw Error(message);
  }
  async function open(saleId){
    if(!allowed())throw Error('Você não tem permissão para cancelar vendas.');
    const sale=(DB.readForView?.()||DB.carregar()).vendas.find(s=>String(s.id)===String(saleId)),origin=identity(),modal=document.querySelector('#modal');
    if(!sale||!origin.uid||!origin.businessId||sale.businessId!==origin.businessId||!sale.spaceId)throw Error('Reabra a venda na empresa e espaço corretos.');
    const key=keyFor(origin,saleId),token=crypto.randomUUID();let busy=false,submitting=false,quote=null,preserved=null;
    try{preserved=JSON.parse(localStorage.getItem(key)||'null');}catch{throw Error('A confirmação preservada precisa ser conferida antes de continuar.');}
    if(preserved?.status==='rejected_before_commit')preserved=null;
    const current=()=>same(origin,identity())&&allowed()&&modal.dataset.saleCancellation===token;
    const assertSession=()=>{if(!current())throw Error('A sessão ou espaço mudou. Consulte o cancelamento na conta de origem; nenhuma resposta será aplicada nesta sessão.');};
    const call=async(name,request)=>{assertSession();if(!navigator.onLine||typeof window.FirebaseCallable!=='function')throw Error('Conecte-se para cancelar com segurança.');const r=await window.FirebaseCallable(name,{...request,businessId:origin.businessId,workspaceGeneration:origin.workspaceGeneration,spaceId:sale.spaceId,saleId,operationalGrantId:window.OperationalReadPolicy?.grantFor?.(saleId,'cancel')});assertSession();return r.data??r;};
    modal.dataset.saleCancellation=token;
    modal.innerHTML=`<div class="modal-bg"><section class="modal-box mobile-modal" role="dialog" aria-modal="true" aria-labelledby="cancel-sale-title"><header class="modal-head"><h3 id="cancel-sale-title">Cancelar venda</h3><button class="icon-btn" type="button" data-cancel-close aria-label="Fechar cancelamento">×</button></header><div class="modal-body"><p>Venda #${esc(saleId.slice(0,8))} · ${esc(sale.clienteNome||'Venda avulsa')}</p><p data-cancel-summary role="status">Consultando a venda, estoque e dependências na nuvem…</p><div data-cancel-error role="alert" aria-live="assertive"></div><form data-cancel-form hidden><p>Somente as quantidades desta venda serão somadas ao estoque <b>atual</b>. Vendas posteriores, a venda original e seu histórico serão preservados.</p><div class="field"><label for="cancel-sale-reason">Motivo do cancelamento</label><textarea id="cancel-sale-reason" name="reason" required minlength="8" maxlength="400" rows="3"></textarea></div><div class="field" data-cancel-refund><p><b>Não há reembolso automático.</b> Pix e cartão manual precisam ser tratados no banco ou na máquina externa. Este cancelamento não envia dinheiro ao cliente.</p><label for="cancel-sale-refund">Situação do pagamento</label><select id="cancel-sale-refund" name="refundHandling" required><option value="">Selecione antes de confirmar</option><option value="external_refund_confirmed">Já devolvi o valor fora da VECONI</option><option value="not_due">Não há reembolso devido (explique no motivo)</option><option value="pending_external" disabled>Ainda preciso devolver — resolva antes de confirmar</option></select></div><label class="exchange-check"><input type="checkbox" name="confirmed" required><span>Conferi a venda, o motivo e o tratamento do pagamento.</span></label><footer class="modal-foot"><button class="btn btn-light" type="button" data-cancel-close>Voltar</button><button class="btn btn-danger" type="submit" data-cancel-confirm>Confirmar cancelamento</button></footer></form></div></section></div>`;
    window.Modais?.layout?.(modal.querySelector('[role="dialog"]'));
    const form=modal.querySelector('[data-cancel-form]'),summary=modal.querySelector('[data-cancel-summary]'),error=modal.querySelector('[data-cancel-error]'),button=modal.querySelector('[data-cancel-confirm]');
    const showError=e=>{if(current())error.textContent=e.message||'Não foi possível concluir. Consulte a confirmação preservada antes de tentar outra ação.';};
    modal.querySelectorAll('[data-cancel-close]').forEach(b=>{b.onclick=()=>{if(!busy&&!submitting&&current()){modal.innerHTML='';delete modal.dataset.saleCancellation;}};});
    const lock=value=>{busy=value;if(current()){form.setAttribute('aria-busy',String(value));form.querySelectorAll('button,input,select,textarea').forEach(e=>{e.disabled=value||Boolean(preserved);});button.disabled=value;button.textContent=value?'Confirmando…':preserved?'Retomar mesma confirmação':'Confirmar cancelamento';}};
    async function send(){
      if(busy)return;lock(true);
      try{
        const r=await call('confirmSaleCancellation',preserved.request);
        if(r.saleId!==saleId||r.operationId!==preserved.request.operationId||r.status!=='cancelado')throw Error('Comprovante de cancelamento inconsistente. Não repita com outro identificador.');
        localStorage.setItem(key,JSON.stringify({...preserved,status:'resolved',receipt:r,resolvedAt:new Date().toISOString()}));
        error.textContent='';
        summary.textContent=r.financialProjection==='pending'||r.financialProjection==='review_required'?'Venda cancelada. Conferência contábil pendente; não repita o cancelamento.':'Venda cancelada. Nenhum reembolso bancário automático foi realizado.';
        form.hidden=true;
        try{await window.SyncFirebase?.pullCloudCollections?.({force:true,names:['sales','products','productVariants','stockMovements','clients']});assertSession();await DB.flush?.();}catch(e){showError(Error('Cancelamento confirmado no servidor. A atualização local aguarda conexão/Sync; não refaça a operação.'));return;}
        if(current())window.dispatchEvent(new CustomEvent('cloud-data-updated',{detail:{collection:'sales',source:'sale_cancellation'}}));
      }catch(e){
        if(current()&&e.details?.reason==='cancellation-state-changed'){
          // The backend emits this reason only BEFORE any transaction write.
          // Preserve the rejected request separately; never discard an uncertain commit.
          try{
            const rejected={...preserved,status:'rejected_before_commit',rejectedAt:new Date().toISOString()};
            localStorage.setItem(`${key}:preserved:${crypto.randomUUID()}`,JSON.stringify(rejected));
            localStorage.setItem(key,JSON.stringify(rejected));preserved=null;quote=null;form.hidden=true;
            const revise=document.createElement('button');revise.type='button';revise.className='btn btn-light';revise.textContent='Revisar dados atuais';
            revise.onclick=async()=>{if(busy||!current())return;revise.disabled=true;try{await loadPreview();revise.remove();}catch(failure){showError(failure);revise.disabled=false;}};
            error.after(revise);
          }catch{showError(Error('A solicitação recusada não pôde ser preservada. Reabra o Histórico antes de continuar.'));return;}
        }
        showError(e);
      }finally{lock(false);}
    }
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||submitting||!current())return;
      submitting=true;
      const work=async()=>{
        assertSession();
        const shared=JSON.parse(localStorage.getItem(key)||'null');
        if(shared&&shared.status!=='rejected_before_commit'){
          if(!shared.request?.operationId||!shared.request?.fingerprint)throw Error('A confirmação de outra aba exige revisão.');
          if(shared.status==='resolved')throw Error('O cancelamento já foi confirmado em outra aba. Reabra o Histórico.');
          preserved=shared;
        }
        if(preserved&&!quote&&typeof window.SyncFirebase?.assertCancellationQueueClear==='function'){
          // Try the strict queue check first. Only unresolved errors need a
          // sale footprint; the replay of a confirmed receipt may not.
          try{await assertQueue(null);}
          catch{
            const saved=preserved.queueQuote;
            quote=saved?.saleId===saleId&&saved.spaceId===sale.spaceId&&
              saved.operationId===preserved.request.operationId&&saved.fingerprint===preserved.request.fingerprint
              ?saved:await loadQuote();
          }
        }
        await assertQueue(quote);
        assertSession();
        if(!preserved){
          const reason=form.elements.reason.value.trim();if(reason.length<8)throw Error('Informe um motivo com pelo menos 8 caracteres.');
          if(!form.elements.confirmed.checked)throw Error('Confirme a revisão do cancelamento.');
          const refundHandling=quote.isCredit?'not_applicable':form.elements.refundHandling.value;
          if(!quote.isCredit&&!['external_refund_confirmed','not_due'].includes(refundHandling))throw Error('Confirme o tratamento externo do pagamento.');
          const next={version:1,status:'pending',createdAt:new Date().toISOString(),queueQuote:quote,request:{operationId:quote.operationId,fingerprint:quote.fingerprint,reason,refundHandling,confirmed:true}};
          localStorage.setItem(key,JSON.stringify(next));
          if(localStorage.getItem(key)!==JSON.stringify(next))throw Error('Não foi possível preservar a confirmação neste aparelho.');
          preserved=next;
        }
        await send();
      };
      try{
        if(navigator.locks?.request)await navigator.locks.request(key,{ifAvailable:true},async lock=>{if(!lock)throw Error('Outra aba está confirmando este cancelamento. Aguarde e consulte o Histórico.');await work();});
        else await work(); // Server-side deterministic receipt still serializes devices.
      }catch(e){showError(e);}
      finally{submitting=false;}
    };
    async function loadQuote(){
      const result=await call('previewSaleCancellation',{});
      if(result.saleId!==saleId||result.spaceId!==sale.spaceId||!result.fingerprint||!result.operationId)throw Error('A consulta não corresponde à venda.');
      return result;
    }
    async function loadPreview(){
      quote=await loadQuote();
      summary.textContent=`Total: ${money(quote.amountCents)}. ${quote.isCredit?'Somente o débito comprovado do Fiado será revertido, sem alterar recebimentos.':'O cancelamento é interno; o tratamento do pagamento precisa ser confirmado abaixo.'}`;
      try{await assertQueue(quote);assertSession();error.textContent='';}
      catch(failure){showError(failure);assertSession();}
      modal.querySelector('[data-cancel-refund]').hidden=quote.isCredit;form.elements.refundHandling.required=!quote.isCredit;form.hidden=false;
    }
    modal.querySelector('[data-cancel-close]').focus();
    try{
      if(preserved){
        if(!preserved.request?.operationId||!preserved.request?.fingerprint)throw Error('Confirmação preservada incompleta; revisão necessária.');
        if(preserved.status==='resolved'){summary.textContent='Esta venda já foi cancelada. O comprovante foi preservado; nenhum novo estorno será aplicado.';return;}
        summary.textContent='Existe uma confirmação preservada. Retome a mesma operação para consultar/concluir, sem gerar novos efeitos.';form.hidden=false;lock(false);error.textContent=queueBlockMessage();return;
      }
      await loadPreview();
    }catch(e){showError(e);if(current())summary.textContent='Cancelamento não autorizado ou depende de revisão. Nenhuma alteração foi aplicada.';}
  }
  return{open,keyFor,assertQueue};
})();
