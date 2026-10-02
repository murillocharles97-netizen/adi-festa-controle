(function(){
  'use strict';

  const ACTIVE=new Set(['created','awaiting_terminal','processing','pending_confirmation']);
  const PROVIDER_LABELS={cielo:'Cielo',mercado_pago:'Mercado Pago',pagbank:'PagBank',mock:'Terminal de teste VECONI — SIMULADOR',simulator:'Simulador VECONI'};
  const STATUS_LABELS={connected:'Online',offline:'Offline',archived:'Arquivada',created:'Preparando cobrança',awaiting_terminal:'Aguardando pagamento',processing:'Processando pagamento',pending_confirmation:'Confirmação pendente',approved:'Pagamento aprovado',declined:'Pagamento não aprovado',cancelled:'Cobrança cancelada',expired:'Cobrança expirada',error:'Erro na cobrança',refunded:'Pagamento estornado'};
  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
  const esc=value=>window.Utils?.escapar?.(String(value??''))??String(value??'');
  const icon=name=>`<i data-lucide="${name}"></i>`;
  const formatMoney=cents=>(Number(cents||0)/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const businessId=()=>String(window.FirebaseSession?.businessId||window.DB?.getBusinessId?.()||'');
  let submitting=false,actionBusy=false;
  const attemptKey=()=>`payment-attempt:${businessId()}:${window.FirebaseSession?.user?.uid||window.FirebaseSession?.uid||''}`;
  const storeAttempt=payload=>window.DB.localRecords.transaction('readwrite',(store,done)=>{store.put({key:attemptKey(),scope:attemptKey(),payload,updatedAt:new Date().toISOString()});done();});
  const forgetAttempt=()=>window.DB.localRecords.transaction('readwrite',(store,done)=>{store.delete(attemptKey());done();});
  let unsubscribe=null,current=null,currentBusiness='',recovering=false,finalizing=new Set(),claimTokens=new Map();

  async function call(name,data={}){
    if(typeof window.FirebaseCallable!=='function')throw new Error('Conecte-se à internet e tente novamente.');
    const response=await window.FirebaseCallable(name,{businessId:businessId(),...data});
    return response?.data||{};
  }
  function modal(markup,className='terminal-payment-modal'){
    const root=$('#modal');
    if(!root)return null;
    root.innerHTML=`<div class="modal-bg terminal-payment-bg"><section class="modal-box ${className}" role="dialog" aria-modal="true">${markup}</section></div>`;
    window.lucide?.createIcons();
    return root;
  }
  function close(){
    stopWatching();
    current=null;
    const root=$('#modal');if(root)root.innerHTML='';
  }
  function closeSettings(){close();dispatchEvent(new CustomEvent('terminal-payment-retry-ready'));}
  function stopWatching(){try{unsubscribe?.();}catch{}unsubscribe=null;}
  function safeError(error,fallback='Não foi possível concluir esta ação.'){
    const raw=String(error?.message||fallback).replace(/^FirebaseError:\s*/,'').replace(/^[^:]+:\s*/,'');
    return raw||fallback;
  }
  function providerLabel(id){return PROVIDER_LABELS[id]||id||'Maquininha';}
  const availability=new Map();
  async function refreshAvailability(spaceId){
    const key=`${attemptKey()}:${spaceId}`;
    let pending=availability.get(key);
    if(!pending||pending.expires<Date.now()){
      pending={expires:Date.now()+30000,result:call('getTerminalPaymentSetup',{spaceId})};availability.set(key,pending);
    }
    try{const setup=await pending.result;
      if(key!==`${attemptKey()}:${spaceId}`)return;
      const enabled=(setup.terminals||[]).some(terminal=>terminal.status==='connected'&&terminal.active!==false);
      for(const element of document.querySelectorAll('[data-payment="cartao_presencial"],#sale-payment-method option[value="cartao_presencial"]')){element.hidden=!enabled;element.disabled=!enabled;}
    }catch(error){availability.delete(key);console.warn('[Payment terminals]',{code:error?.code||'unavailable'});}
  }
  function terminalLabel(intent){return intent?.terminalNickname||providerLabel(intent?.provider);}
  function clientIntent(value){
    if(!value)return value;
    return{
      ...value,
      canCancel:value.canCancel??(ACTIVE.has(value.status)&&value.capabilities?.supportsCancellation===true),
      canRefund:value.canRefund??(value.status==='approved'&&value.capabilities?.supportsRefund===true),
    };
  }
  function actorCanManage(){return['owner','admin'].includes(window.FirebaseSession?.profile?.role);}
  function statusBadge(value){
    const labels={connected:'Conectado',available:'Não configurado',not_configured:'Não configurado',coming_soon:'Em breve',restricted:'Indisponível'};
    return`<span class="terminal-provider-status is-${esc(value)}">${esc(labels[value]||value)}</span>`;
  }

  async function openSettings(){
    const root=modal(`<header class="terminal-sheet-head"><div><small>Configurações</small><h3>Integrações e maquininhas</h3><p>Gerencie os terminais usados no caixa.</p></div><button class="icon-btn" data-terminal-close aria-label="Fechar">${icon('x')}</button></header><div class="terminal-loading">${icon('loader-circle')} Carregando maquininhas…</div>`,'terminal-settings-modal');
    root?.querySelector('[data-terminal-close]')?.addEventListener('click',closeSettings);
    try{
      const setup=await call('getTerminalPaymentSetup',{audit:true});
      renderSettings(setup);
    }catch(error){
      renderSettingsError(error);
    }
  }
  function renderSettingsError(error){
    const root=modal(`<header class="terminal-sheet-head"><div><small>Configurações</small><h3>Integrações e maquininhas</h3></div><button class="icon-btn" data-terminal-close>${icon('x')}</button></header><div class="terminal-empty">${icon('wifi-off')}<h4>Não foi possível carregar</h4><p>${esc(safeError(error))}</p><button class="btn btn-primary" data-terminal-settings-retry>Tentar novamente</button></div>`,'terminal-settings-modal');
    root.querySelector('[data-terminal-close]').onclick=closeSettings;
    root.querySelector('[data-terminal-settings-retry]').onclick=openSettings;
  }
  function renderSettings(setup){
    const terminals=setup.terminals||[],providers=setup.providers||[],canManage=actorCanManage(),simulator=terminals.find(item=>item.provider==='simulator');
    const root=modal(`<header class="terminal-sheet-head"><div><small>Configurações</small><h3>Integrações e maquininhas</h3><p>Credenciais e segredos permanecem somente no servidor.</p></div><button class="icon-btn" data-terminal-close aria-label="Fechar">${icon('x')}</button></header>
      <div class="terminal-settings-body">${(setup.integrityIssues||[]).map(issue=>`<aside class="terminal-pending-warning" role="alert"><div><b>${issue.code==='approved_without_sale'?'Pagamento aprovado aguardando conclusão da venda':'Venda sem pagamento aprovado correspondente'}</b><p>${formatMoney(issue.amountCents)} · Revisão necessária. Não cobre novamente nem altere o saldo automaticamente.</p><small>Referência: ${esc(issue.intentId||issue.saleId)}</small></div></aside>`).join('')}
        <section class="terminal-provider-section"><h4>Maquininhas</h4><div class="terminal-provider-grid">${providers.filter(item=>!['simulator','mock'].includes(item.id)).map(item=>`<article><span class="terminal-provider-icon">${icon(item.id==='cielo'?'credit-card':item.id==='mercado_pago'?'badge-dollar-sign':'landmark')}</span><div><b>${esc(item.name)}</b><small>${item.id==='pagbank'?'Integração preparada para uma próxima fase.':'Conexão preparada, ainda sem ativação nesta fase.'}</small></div>${statusBadge(item.availability)}</article>`).join('')}</div></section>
        <section class="terminal-list-section"><div class="terminal-section-title"><div><h4>Terminais</h4><p>${terminals.length?'Escolha qual maquininha será a principal do caixa.':'Nenhuma maquininha conectada.'}</p></div>${setup.simulatorAllowed&&canManage?`<button class="btn btn-primary" data-add-simulator>${icon('flask-conical')} Adicionar terminal</button>`:''}</div>
          <div class="terminal-list">${terminals.map(item=>`<article class="terminal-row"><span class="terminal-row-icon">${icon(['mock','simulator'].includes(item.provider)?'flask-conical':'credit-card')}</span><div><b>${esc(item.nickname)}</b><small>${esc(providerLabel(item.provider))}${item.isDefault?' · Principal':''}</small><small>${item.spaceAccess==='selected_spaces'?`Espaços: ${(item.allowedSpaceIds||[]).map(id=>esc(window.SpaceContext?.list?.().find(space=>space.id===id)?.name||id)).join(', ')}`:'Todos os espaços'}</small></div><span class="terminal-online"><i></i>${esc(STATUS_LABELS[item.status]||item.status)}</span>${canManage?`<div class="terminal-row-actions"><button data-edit-terminal="${esc(item.id)}">Editar</button>${item.isDefault?'':`<button data-default-terminal="${esc(item.id)}">Definir como padrão</button>`}<button class="danger" data-archive-terminal="${esc(item.id)}">Arquivar</button></div>`:''}</article>`).join('')||`<div class="terminal-empty compact">${icon('credit-card')}<p>Nenhuma maquininha conectada.</p></div>`}</div>
          ${setup.simulatorAllowed?`<aside class="terminal-simulator-note">${icon('shield-check')}<span><b>Simulador restrito</b><small>Disponível apenas em ambiente interno ou de testes. Ele usa o mesmo fluxo seguro do caixa.</small></span></aside>`:''}
        </section>
      </div>`,'terminal-settings-modal');
    root.querySelector('[data-terminal-close]').onclick=closeSettings;
    root.querySelector('[data-add-simulator]')?.addEventListener('click',()=>editTerminal());
    $$('[data-edit-terminal]',root).forEach(button=>button.onclick=()=>editTerminal(terminals.find(item=>item.id===button.dataset.editTerminal)));
    $$('[data-default-terminal]',root).forEach(button=>button.onclick=async()=>{
      const terminal=terminals.find(item=>item.id===button.dataset.defaultTerminal);
      try{await call('savePaymentTerminal',{terminal:{id:terminal.id,provider:terminal.provider,nickname:terminal.nickname,makeDefault:true}});await openSettings();}catch(error){window.Utils?.toast?.(safeError(error),true);}
    });
    $$('[data-archive-terminal]',root).forEach(button=>button.onclick=async()=>{
      const terminal=terminals.find(item=>item.id===button.dataset.archiveTerminal);
      if(!confirm(`Arquivar ${terminal?.nickname||'esta maquininha'}?`))return;
      try{await call('archivePaymentTerminal',{terminalId:terminal.id});await openSettings();}catch(error){window.Utils?.toast?.(safeError(error),true);}
    });
    window.lucide?.createIcons();
  }


  function editTerminal(item={}){
    const id=item.id||crypto.randomUUID(),spaces=window.SpaceContext?.homeSpaces?.()||[];
    const root=modal(`<header class="terminal-sheet-head"><div><small>SIMULADOR · sem cobrança real</small><h3>${item.id?'Editar terminal':'Adicionar terminal'}</h3></div></header><form data-terminal-editor><div class="terminal-checkout-body"><label class="terminal-field"><span>Nome</span><input name="nickname" maxlength="60" required value="${esc(item.nickname||'Terminal de teste VECONI')}"></label><label class="terminal-field"><span>Espaços disponíveis</span><select name="spaceAccess"><option value="all_spaces">Todos os espaços</option><option value="selected_spaces" ${item.spaceAccess==='selected_spaces'?'selected':''}>Espaços específicos</option></select></label><div data-terminal-spaces>${spaces.map(space=>`<label class="terminal-space-choice"><input type="checkbox" name="spaces" value="${esc(space.id)}" ${item.allowedSpaceIds?.includes(space.id)?'checked':''}>${esc(space.name)}</label>`).join('')}</div><p role="alert" data-terminal-error></p></div><footer class="terminal-checkout-footer"><button type="button" class="btn btn-light" data-terminal-back>Cancelar</button><button class="btn btn-primary" type="submit">Salvar terminal</button></footer></form>`);
    const form=root.querySelector('form');let saving=false;
    const scope=()=>root.querySelector('[data-terminal-spaces]').hidden=form.elements.spaceAccess.value==='all_spaces';
    form.elements.spaceAccess.onchange=scope;scope();
    root.querySelector('[data-terminal-back]').onclick=openSettings;
    form.onsubmit=async event=>{event.preventDefault();if(saving)return;saving=true;const button=form.querySelector('[type=submit]');button.disabled=true;
      try{const allowedSpaceIds=[...form.querySelectorAll('[name=spaces]:checked')].map(input=>input.value);if(form.elements.spaceAccess.value==='selected_spaces'&&!allowedSpaceIds.length)throw Error('Selecione ao menos um espaço.');
        await call('savePaymentTerminal',{terminal:{id,provider:item.provider||'mock',nickname:form.elements.nickname.value,spaceAccess:form.elements.spaceAccess.value,allowedSpaceIds}});await openSettings();
      }catch(error){root.querySelector('[data-terminal-error]').textContent=safeError(error);}finally{saving=false;button.disabled=false;}
    };
  }

  async function beginCheckout({saleDraft,amountCents}){
    if(!navigator.onLine){showOffline();return false;}
    const root=modal(`<header class="terminal-sheet-head"><div><small>Pagamento presencial</small><h3>Preparando maquininhas</h3></div></header><div class="terminal-loading">${icon('loader-circle')} Verificando terminais…</div>`);
    try{
      const active=await call('getActiveTerminalPayment');
      if(active.intent){current=clientIntent(active.intent);showWaiting(current);watch(current);handleStatus(current);return true;}
      const saved=await window.DB.localRecords.read(attemptKey());
      if(saved?.payload){const replay=await call('createTerminalPayment',saved.payload);current=clientIntent(replay.intent);showWaiting(current);watch(current);handleStatus(current);return true;}
      const setup=await call('getTerminalPaymentSetup',{spaceId:saleDraft.spaceId}),terminals=(setup.terminals||[]).filter(item=>item.status==='connected');
      if(!terminals.length){showNoTerminal();return false;}
      showPaymentOptions({saleDraft:{...saleDraft,id:saleDraft.id||crypto.randomUUID()},amountCents,terminals});
      return true;
    }catch(error){
      const errorRoot=modal(`<div class="terminal-empty">${icon('wifi-off')}<h4>Não foi possível verificar as maquininhas</h4><p>${esc(safeError(error))}</p><button class="btn btn-light" data-terminal-back>Voltar</button></div>`);
      errorRoot.querySelector('[data-terminal-back]').onclick=retryReady;
      window.lucide?.createIcons();
      return false;
    }
  }
  function showOffline(){
    const root=modal(`<div class="terminal-empty">${icon('wifi-off')}<h3>Sem conexão com a internet</h3><p>A cobrança na maquininha não foi criada. Conecte-se e tente novamente.</p><button class="btn btn-primary" data-terminal-back>Voltar</button></div>`);
    root.querySelector('[data-terminal-back]').onclick=retryReady;
  }
  function showNoTerminal(){
    const root=modal(`<div class="terminal-empty">${icon('credit-card')}<h3>Nenhuma maquininha conectada</h3><p>Configure uma maquininha antes de cobrar no cartão presencial.</p><div><button class="btn btn-primary" data-terminal-configure>Configurar maquininha</button><button class="btn btn-light" data-terminal-back>Voltar</button></div></div>`);
    root.querySelector('[data-terminal-configure]').onclick=openSettings;
    root.querySelector('[data-terminal-back]').onclick=retryReady;
  }
  function showPaymentOptions({saleDraft,amountCents,terminals}){
    const defaultTerminal=terminals.find(item=>item.isDefault)||terminals[0],root=modal(`<header class="terminal-sheet-head"><div><small>Cartão na maquininha</small><h3>${formatMoney(amountCents)}</h3><p>Confirme o terminal e o tipo de pagamento.</p></div><button class="icon-btn" data-terminal-back>${icon('x')}</button></header><form data-terminal-checkout-form><div class="terminal-checkout-body">
      <label class="terminal-field"><span>Maquininha</span><select name="terminalId">${terminals.map(item=>`<option value="${esc(item.id)}" ${item.id===defaultTerminal.id?'selected':''}>${esc(item.nickname)}${item.isDefault?' · Principal':''}</option>`).join('')}</select></label>
      <fieldset class="terminal-card-types"><legend>Tipo</legend><label><input type="radio" name="paymentMethod" value="credit" checked><span>${icon('credit-card')}<b>Crédito</b></span></label><label><input type="radio" name="paymentMethod" value="debit"><span>${icon('badge-dollar-sign')}<b>Débito</b></span></label></fieldset>
      <label class="terminal-field" data-installments-field><span>Parcelas</span><select name="installments"></select></label>
      <aside class="terminal-security-note">${icon('shield-check')}<span>A VECONI não captura nem armazena número, senha ou código de segurança do cartão.</span></aside>
    </div><footer class="terminal-checkout-footer"><button type="button" class="btn btn-light" data-terminal-back>Voltar</button><button class="btn btn-primary" type="submit">Enviar para maquininha</button></footer></form>`);
    const form=root.querySelector('form'),terminalSelect=form.elements.terminalId,installments=form.elements.installments,installmentsField=root.querySelector('[data-installments-field]');
    const syncOptions=()=>{
      const terminal=terminals.find(item=>item.id===terminalSelect.value)||terminals[0],method=form.elements.paymentMethod.value,capabilities=terminal.capabilities||{},max=method==='credit'&&capabilities.supportsInstallments?Math.max(1,Number(capabilities.maxInstallments||1)):1;
      form.querySelector('input[value="credit"]').disabled=capabilities.supportsCredit!==true;
      form.querySelector('input[value="debit"]').disabled=capabilities.supportsDebit!==true;
      if(form.elements.paymentMethod.value==='credit'&&capabilities.supportsCredit!==true)form.querySelector('input[value="debit"]').checked=true;
      if(form.elements.paymentMethod.value==='debit'&&capabilities.supportsDebit!==true)form.querySelector('input[value="credit"]').checked=true;
      const effective=form.elements.paymentMethod.value,limit=effective==='credit'?max:1;
      installments.innerHTML=Array.from({length:limit},(_,index)=>`<option value="${index+1}">${index+1}x</option>`).join('');
      installmentsField.hidden=effective!=='credit'||limit===1;
    };
    terminalSelect.onchange=syncOptions;form.querySelectorAll('[name="paymentMethod"]').forEach(input=>input.onchange=syncOptions);syncOptions();
    root.querySelectorAll('[data-terminal-back]').forEach(button=>button.onclick=retryReady);
    form.onsubmit=async event=>{
      event.preventDefault();if(submitting)return;submitting=true;
      const button=event.submitter||form.querySelector('[type=submit]'),terminal=terminals.find(item=>item.id===terminalSelect.value);button.disabled=true;
      try{
        const payload={idempotencyKey:`terminal_${crypto.randomUUID()}`,terminalId:terminal.id,amountCents:Number(amountCents),paymentMethod:form.elements.paymentMethod.value,installments:Number(installments.value||1),simulatorScenario:'manual',saleDraft};
        await storeAttempt(payload);
        const result=await call('createTerminalPayment',payload);
        current=clientIntent(result.intent);showWaiting(current);watch(current);void dispatchCurrent(payload.simulatorScenario);
      }catch(error){window.Utils?.toast?.(safeError(error),true);button.disabled=false;}finally{submitting=false;}
    };
    window.lucide?.createIcons();
  }
  async function dispatchCurrent(simulatorScenario){
    if(!current||actionBusy)return;actionBusy=true;
    document.querySelectorAll('[data-mock-scenario],[data-terminal-cancel]').forEach(button=>button.disabled=true);
    try{
      const result=await call('dispatchTerminalPayment',{intentId:current.id,simulatorScenario});
      if(result.intent)handleStatus(result.intent);
    }catch(error){
      window.Utils?.toast?.(safeError(error),true);
      try{const result=await call('getTerminalPaymentStatus',{intentId:current.id});if(result.intent)handleStatus(result.intent);}catch(statusError){window.Utils?.toast?.('Resultado ainda desconhecido. Verifique novamente; não faça outra cobrança.',true);}
    }finally{actionBusy=false;document.querySelectorAll('[data-mock-scenario],[data-terminal-cancel]').forEach(button=>button.disabled=false);}
  }
  function watch(intent){
    stopWatching();
    if(typeof window.FirebaseDocumentListener!=='function')return;
    const scopedBusiness=intent.businessId;
    unsubscribe=window.FirebaseDocumentListener(['businesses',scopedBusiness,'paymentIntents',intent.id],value=>{
      if(!value||businessId()!==scopedBusiness)return;
      handleStatus(clientIntent(value));
    },error=>{console.warn('[Terminal payment listener]',{code:error?.code||'unknown'});window.Utils?.toast?.('Não foi possível acompanhar o pagamento. Use Verificar status.',true);});
  }
  function showWaiting(intent){
    current=intent;
    const pending=intent.status==='pending_confirmation',processing=['created','awaiting_terminal','processing'].includes(intent.status),root=modal(`<header class="terminal-wait-head"><span class="terminal-status-orb is-${esc(intent.status)}">${processing?icon('loader-circle'):pending?icon('circle-help'):icon('credit-card')}</span><div><small>Cartão na maquininha</small><h3>${esc(STATUS_LABELS[intent.status]||'Aguardando pagamento')}</h3></div></header><div class="terminal-wait-body"><strong>${formatMoney(intent.amountCents)}</strong><span>${icon(intent.provider==='simulator'?'flask-conical':'credit-card')} ${esc(terminalLabel(intent))}</span><p>${pending?'Ainda não recebemos a confirmação. Não tente cobrar novamente até verificar ou cancelar esta cobrança.':'Peça ao cliente para aproximar ou inserir o cartão.'}</p>${pending?`<aside class="terminal-pending-warning">${icon('triangle-alert')} Timeout não significa pagamento recusado.</aside>`:''}</div>${['mock','simulator'].includes(intent.provider)?`<section class="terminal-mock-controls"><b>SIMULADOR — não movimenta dinheiro real</b><div>${[['approved','Simular aprovação'],['declined','Simular recusa'],['cancelled','Simular cancelamento'],['timeout','Simular timeout'],['network_error','Simular falha de conexão']].map(([scenario,label])=>`<button class="btn btn-light" data-mock-scenario="${scenario}">${label}</button>`).join('')}</div></section>`:''}<footer class="terminal-wait-actions"><button class="btn btn-primary" data-terminal-reconcile>${icon('refresh-cw')} Verificar status</button>${intent.canCancel?`<button class="btn btn-light danger" data-terminal-cancel>Cancelar cobrança</button>`:''}</footer>`);
    $$('[data-mock-scenario]',root).forEach(button=>{button.disabled=actionBusy;button.onclick=()=>void dispatchCurrent(button.dataset.mockScenario);});
    root.querySelector('[data-terminal-cancel]')?.addEventListener('click',cancelCurrent);
    root.querySelector('[data-terminal-reconcile]')?.addEventListener('click',reconcileCurrent);
    window.lucide?.createIcons();
  }
  async function cancelCurrent(event){
    if(!current||actionBusy||!confirm('Cancelar esta cobrança na maquininha?'))return;actionBusy=true;
    const button=event.currentTarget;button.disabled=true;
    try{const result=await call('cancelTerminalPayment',{intentId:current.id});handleStatus(result.intent);}catch(error){window.Utils?.toast?.(safeError(error),true);button.disabled=false;}finally{actionBusy=false;}
  }
  async function reconcileCurrent(event){
    if(!current)return;const button=event.currentTarget;button.disabled=true;
    if(!current.id){button.disabled=false;await recover();return;}
    try{const result=await call('getTerminalPaymentStatus',{intentId:current.id});handleStatus(result.intent);}catch(error){window.Utils?.toast?.(safeError(error),true);}finally{button.disabled=false;}
  }
  function resultScreen(intent){
    const declined=intent.status==='declined',cancelled=intent.status==='cancelled',error=intent.status==='error',root=modal(`<div class="terminal-result is-${esc(intent.status)}"><span>${icon(declined?'x-circle':cancelled?'ban':error?'triangle-alert':'clock')}</span><h3>${esc(STATUS_LABELS[intent.status]||'Pagamento não concluído')}</h3><p>${declined?'O cartão não foi aprovado. A venda e o estoque não foram alterados.':cancelled?'A cobrança foi cancelada. A venda continua aberta.':'A venda não foi finalizada. Você pode escolher outra forma de pagamento.'}</p><div><button class="btn btn-primary" data-terminal-retry>${declined?'Tentar novamente':'Voltar à venda'}</button><button class="btn btn-light" data-terminal-other>Outra forma de pagamento</button></div></div>`);
    const retry=async()=>{try{await forgetAttempt();retryReady();}catch(error){window.Utils?.toast?.(safeError(error),true);}};
    root.querySelector('[data-terminal-retry]').onclick=retry;
    root.querySelector('[data-terminal-other]').onclick=retry;
  }
  function retryReady(){close();dispatchEvent(new CustomEvent('terminal-payment-retry-ready'));}
  function handleStatus(intent){
    if(!intent||businessId()!==intent.businessId)return;
    intent=clientIntent(intent);
    const changed=!current||current.status!==intent.status;current=intent;
    if(intent.status==='approved'){void finalizeApproved(intent);return;}
    if(['created','awaiting_terminal','processing','pending_confirmation'].includes(intent.status)){if(changed||!$('.terminal-wait-body'))showWaiting(intent);return;}
    if(['declined','cancelled','expired','error'].includes(intent.status)){stopWatching();resultScreen(intent);}
  }
  function claimToken(intent){
    const key=`${intent.businessId}:${intent.id}`;
    let token=claimTokens.get(key);
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(token||'')){token=crypto.randomUUID();claimTokens.set(key,token);}
    return token;
  }
  async function finalizeApproved(intent){
    if(finalizing.has(intent.id))return;
    finalizing.add(intent.id);showApproved(intent);
    const token=claimToken(intent);
    try{
      const claim=await call('claimTerminalPaymentFinalization',{intentId:intent.id,claimToken:token});
      if(claim.completed){const sale=await window.SyncFirebase.readIntegratedSale(claim.intent);await forgetAttempt();stopWatching();current=null;if(sale)window.Checkout.completeTerminalPayment(sale);else close();return;}
      if(!claim.claimed){showFinalizationBusy(intent);return;}
      if(typeof window.Checkout?.finalizeTerminalPayment!=='function')throw new Error('O checkout ainda não está pronto para finalizar esta venda.');
      const sale=await window.Checkout.finalizeTerminalPayment(claim.intent||intent);
       await call('acknowledgeTerminalPaymentSale',{intentId:intent.id,claimToken:token,saleId:sale.id});
       await forgetAttempt();
       window.Checkout.completeTerminalPayment(sale);
       claimTokens.delete(`${intent.businessId}:${intent.id}`);
      stopWatching();current=null;
    }catch(error){
      console.error('[Terminal payment finalization]',{code:error?.code||'unknown'});
      window.Utils?.toast?.(`Pagamento aprovado. ${safeError(error,'A venda será recuperada ao reabrir o app.')}`,true);
      showFinalizationRecovery(intent);
    }finally{finalizing.delete(intent.id);}
  }
  function showApproved(intent){
    modal(`<div class="terminal-result is-approved"><span>${icon('badge-check')}</span><h3>Pagamento aprovado</h3><strong>${formatMoney(intent.amountCents)}</strong><p>Finalizando a venda com segurança…</p><div class="terminal-finalizing">${icon('loader-circle')} Atualizando estoque e histórico</div></div>`);
  }
  function showFinalizationBusy(intent){
    const root=modal(`<div class="terminal-result is-pending_confirmation"><span>${icon('refresh-cw')}</span><h3>Pagamento aprovado</h3><p>Há uma finalização em andamento. Se o app foi fechado, aguarde até um minuto e verifique novamente. Não cobre novamente.</p><button class="btn btn-primary" data-terminal-reconcile-sale>Verificar novamente</button></div>`);
    root.querySelector('[data-terminal-reconcile-sale]').onclick=()=>{finalizing.delete(intent.id);void finalizeApproved(intent);};
  }
  function showFinalizationRecovery(intent){
    const root=modal(`<div class="terminal-result is-pending_confirmation"><span>${icon('shield-alert')}</span><h3>Pagamento aprovado</h3><p>A confirmação está segura, mas a conclusão da venda precisa ser retomada. Não faça outra cobrança.</p><button class="btn btn-primary" data-terminal-recover-sale>Retomar finalização</button></div>`);
    root.querySelector('[data-terminal-recover-sale]').onclick=()=>{finalizing.delete(intent.id);void finalizeApproved(intent);};
  }
  async function recover(){
    const scoped=businessId();if(!scoped||recovering)return;
    recovering=true;
    try{
      if(!navigator.onLine){
        const saved=await window.DB.localRecords.read(attemptKey());
        if(saved?.payload){current={businessId:scoped,id:null,status:'pending_confirmation',amountCents:saved.payload.amountCents,terminalNickname:'Pagamento salvo neste aparelho',saleDraft:saved.payload.saleDraft,canCancel:false};window.Checkout?.restoreTerminalDraft?.(current);showWaiting(current);window.Utils?.toast?.('Conecte-se para confirmar o pagamento em andamento. Não cobre novamente.',true);}
        return;
      }
      const result=await call('getActiveTerminalPayment');
      if(scoped!==businessId())return;
      if(!result.intent){const saved=await window.DB.localRecords.read(attemptKey());if(!saved?.payload)return;result.intent=(await call('createTerminalPayment',saved.payload)).intent;}
      current=clientIntent(result.intent);window.Checkout?.restoreTerminalDraft?.(current);showWaiting(current);watch(current);handleStatus(current);
      if(['created','awaiting_terminal'].includes(current.status))void dispatchCurrent();
    }catch(error){console.warn('[Terminal payment recovery]',{code:error?.code||'unknown'});window.Utils?.toast?.('Não foi possível verificar pagamentos pendentes. Verifique a conexão antes de cobrar novamente.',true);}finally{recovering=false;}
  }
  function clearBusinessState(){stopWatching();current=null;currentBusiness=businessId();finalizing.clear();claimTokens.clear();availability.clear();}
  addEventListener('firebase-auth-ready',()=>{currentBusiness=businessId();void recover();});
  addEventListener('business-context-changed',event=>{
    const next=String(event.detail?.businessId||'');
    if(currentBusiness&&next!==currentBusiness)clearBusinessState();
    currentBusiness=next;
  });
  addEventListener('firebase-session-cleared',clearBusinessState);
  addEventListener('online',()=>void recover());
  addEventListener('beforeunload',event=>{if(current&&ACTIVE.has(current.status)){event.preventDefault();event.returnValue='Existe um pagamento em andamento.';}});

  window.TerminalPayments=Object.freeze({beginCheckout,openSettings,refreshAvailability,recover,getCurrent:()=>current,providerLabel,ACTIVE_STATUSES:ACTIVE});
})();
