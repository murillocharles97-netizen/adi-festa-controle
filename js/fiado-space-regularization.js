window.FiadoSpaceRegularization = (() => {
  'use strict';
  const ENABLED=true; // UI containment rollback hides only new regularizations.
  const esc=v=>Utils.escapar(String(v??'')), money=v=>Utils.dinheiro(v/100);
  const registered=c=>c?.fiadoHistoryActivation?.spaceRegularization?.version===1;
  function scope(){
    if(!ENABLED)return null;
    const c=window.BusinessContext?.get?.(),uid=window.FirebaseSession?.user?.uid;
    const businessId=DB.getBusinessId(),spaceId=window.SpaceContext?.activeId?.();
    if(!uid||c?.businessId!==businessId||c.role!=='owner'||c.business?.ownerId!==uid||!spaceId||
      !window.TeamAccess?.has?.('customers.adjustBalance'))return null;
    return {businessId,spaceId,workspaceGeneration:DB.getWorkspaceGeneration?.()??0,uid};
  }
  const key=s=>'veconi:fiado-space-regularization:'+JSON.stringify(s);
  const guard=(s,id)=>{
    if(JSON.stringify(scope())!==JSON.stringify(s))throw Error('A sessão ou o espaço mudou. Reabra a regularização.');
    if(navigator.onLine===false)throw Error('Conecte-se para confirmar o saldo no servidor.');
    if(!window.SyncFirebase?.assertFiadoReceiptQueueClear)throw Error('A verificação da fila não está disponível. Atualize o aplicativo.');
    window.SyncFirebase.assertFiadoReceiptQueueClear(id);
  };
  async function open(clientId){
    const s=scope();
    if(!s){Utils.toast('Somente o proprietário pode regularizar o saldo de um espaço.',true);return;}
    let host=document.getElementById('modal');if(!host){host=document.createElement('div');host.id='modal';document.body.append(host);}
    const client=window.Clientes?.obter?.(clientId),space=(window.SpaceContext?.homeSpaces?.()||[]).find(row=>row.id===s.spaceId);
    host.innerHTML=`<div class="modal-bg"><section class="modal-box fiado-space-regularization" role="dialog" aria-modal="true" aria-labelledby="regularization-title" style="width:min(520px,calc(100vw - 24px));max-height:90dvh;display:flex;flex-direction:column"><header class="modal-head"><h3 id="regularization-title">Regularizar saldo</h3><button class="icon-btn" data-reg-close aria-label="Fechar">×</button></header><div class="modal-body" style="overflow:auto"><p><b>${esc(client?.nome)}</b><br><small>${esc(space?.name||'Espaço selecionado')}</small></p><p role="status" data-reg-status>Consultando saldo confirmado no servidor…</p><form data-reg-form hidden><p>Saldo devedor confirmado: <b data-reg-current></b></p><label class="field">Finalidade<select name="purpose"><option value="historical_debt">Dívida anterior ao uso do sistema</option><option value="correction">Corrigir saldo incorreto</option></select></label><label class="field">Total correto da dívida (R$)<input name="total" type="number" inputmode="decimal" min="0" max="1000000" step="0.01" required></label><p data-reg-difference aria-live="polite"></p><label class="field">Motivo obrigatório<textarea name="reason" minlength="10" maxlength="500" rows="3" required placeholder="Explique a origem ou a correção conferida"></textarea></label><label style="display:flex;gap:10px;align-items:flex-start"><input name="confirmed" type="checkbox" required style="width:18px;height:18px;flex:0 0 18px;margin-top:3px"><span>Conferi o total final, incluindo dívidas já registradas neste espaço.</span></label><p class="muted">Não registra venda, pagamento nem movimento de caixa. Conclua as sincronizações deste cliente nos demais aparelhos antes de confirmar. Parcelas existentes serão preservadas.</p><div class="modal-foot" style="display:flex;gap:8px;flex-wrap:wrap;padding-inline:0"><button type="button" class="btn btn-light" data-reg-cancel>Cancelar</button><button type="submit" class="btn btn-primary" data-reg-submit>Confirmar diferença</button></div></form><button type="button" class="btn btn-light" data-reg-retry hidden>Consultar confirmação</button></div></section></div>`;
    const form=host.querySelector('form'),status=host.querySelector('[data-reg-status]'),submit=host.querySelector('[data-reg-submit]'),retry=host.querySelector('[data-reg-retry]');
    let quote,busy=false,preserved;
    const present=()=>host.querySelector('[data-reg-status]')===status;
    const close=()=>{if(!busy&&present())host.innerHTML='';};
    host.querySelector('[data-reg-close]').onclick=close;host.querySelector('[data-reg-cancel]').onclick=close;
    const report=e=>{if(present())status.textContent=e.message||'Não foi possível obter confirmação. A operação original foi preservada.';};
    const call=async(kind,input={},write=false)=>{
      guard(s,clientId);
      const {uid,...context}=s,result=await window.FirebaseCallable(write?'commitOperationalSync':'getOperationalSyncReceipt',{...context,clientId,...input,kind,syncProtocolVersion:1,clientRelease:Number(window.AdiFestaBuild?.release||238)});
      if(JSON.stringify(scope())!==JSON.stringify(s))throw Error('A sessão mudou. Consulte a confirmação na conta original.');
      return result.data??result;
    };
    async function completed(result){
      if(result.status!=='confirmed'||result.clientId!==clientId||result.spaceId!==s.spaceId)throw Error('O servidor não confirmou esta regularização.');
      localStorage.removeItem(key({...s,clientId}));preserved=null;
      busy=false; // The write is confirmed; refreshing the display must not trap the dialog.
      if(present()){form.hidden=true;retry.hidden=true;status.textContent='Saldo confirmado: '+money(result.newDebtCents)+'. Nenhum pagamento foi registrado.';}
      try{
        await window.SyncFirebase.readCanonicalClient(clientId,{force:true});
        await window.InstallmentCredit.refresh(clientId);
        window.Clientes.prepareList();
        dispatchEvent(new CustomEvent('fiado-account-updated',{detail:{clientId}}));
      }catch(error){
        // A queued operation of this client keeps the local projection. The server
        // value above is final: never suggest a second, compensating adjustment.
        if(present())status.textContent+=error?.code==='pending-client-write'
          ?' Este aparelho tem uma operação deste cliente pendente ou bloqueada na fila e continua mostrando o saldo anterior até ela ser resolvida. O saldo acima já está confirmado no servidor: não registre outro ajuste para compensar. Veja Sincronização dos dados.'
          :' A lista será atualizada após a próxima consulta ao servidor.';
      }
    }
    const difference=()=>{const value=Number(form.elements.total.value),cents=Math.round(value*100),valid=form.elements.total.value!==''&&Number.isFinite(value)&&value>=0&&Math.abs(value*100-cents)<0.000001;
      const delta=cents-(quote?.currentDebtCents||0);
      host.querySelector('[data-reg-difference]').textContent=!valid?'Informe o total correto.':delta>0?'Aumentará a dívida em '+money(delta):delta<0?'Reduzirá a dívida em '+money(-delta):'Nenhuma diferença a aplicar.';
      submit.disabled=busy||!valid||!delta;
    };
    form.elements.total.oninput=difference;
    async function consult(){
      if(busy)return;busy=true;retry.disabled=true;
      try{const result=await call('fiado_space_regularization_status',{operationId:preserved.operationId});
        if(result.status==='confirmed')await completed(result);
        else if(present()){status.textContent='Sem confirmação até agora. A próxima tentativa reutilizará exatamente o mesmo identificador e os mesmos valores.';retry.textContent='Retomar operação original';retry.onclick=send;}}
      catch(e){report(e);}finally{busy=false;retry.disabled=false;}
    }
    async function send(){
      if(busy)return;busy=true;submit.disabled=true;retry.disabled=true;
      try{guard(s,clientId);await completed(await call('fiado_space_regularization',preserved,true));}
      catch(e){
        // A definitive precondition rejection has no effects. A transport failure
        // retains the exact original request, including its idempotency key.
        if(/(?:^|\/)(aborted|invalid-argument|failed-precondition|permission-denied)$/.test(e.code||'')){
          localStorage.removeItem(key({...s,clientId}));preserved=null;
          if(present()){form.hidden=true;retry.hidden=false;retry.textContent='Conferir saldo novamente';retry.onclick=()=>open(clientId);}
        }else if(present()){form.hidden=true;retry.hidden=false;retry.textContent='Consultar confirmação';retry.onclick=consult;}
        report(e);
      }finally{busy=false;retry.disabled=false;}
    }
    form.onsubmit=async event=>{
      event.preventDefault();if(busy||!form.reportValidity())return;
      try{guard(s,clientId);const amount=Number(form.elements.total.value);
        if(!Number.isFinite(amount)||amount<0||Math.abs(amount*100-Math.round(amount*100))>0.000001)throw Error('Informe um valor em centavos.');
        preserved={operationId:crypto.randomUUID(),quoteHash:quote.quoteHash,financialVersion:quote.financialVersion,targetDebtCents:Math.round(amount*100),purpose:form.elements.purpose.value,reason:form.elements.reason.value.trim(),confirmed:true,localQueueChecked:true};
        localStorage.setItem(key({...s,clientId}),JSON.stringify(preserved));
        await send();
      }catch(e){report(e);}
    };
    try{
      guard(s,clientId);const saved=localStorage.getItem(key({...s,clientId}));
      if(saved){preserved=JSON.parse(saved);form.hidden=true;retry.hidden=false;retry.onclick=consult;await consult();return;}
      quote=await call('fiado_space_regularization_preview');if(!present())return;
      host.querySelector('[data-reg-current]').textContent=money(quote.currentDebtCents);
      form.elements.total.value=(quote.currentDebtCents/100).toFixed(2);form.hidden=false;
      status.textContent='Valor confirmado somente para este espaço.';difference();
    }catch(e){report(e);}
  }
  return {open,available:()=>!!scope(),registered};
})();
