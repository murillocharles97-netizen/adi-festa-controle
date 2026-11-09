window.InstallmentCredit = (() => {
  'use strict';
  const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const money=v=>(v/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const labels={open:'Aberta',partial:'Parcial',paid:'Quitada',overdue:'Vencida',cancelled:'Cancelada'};
  const available=()=>window.TeamAccess?.has?.('customers.receiveDebt')===true&&!window.OperationalReadPolicy?.restricted?.();
  const has=(id,data=DB.carregar())=>!!id&&((data.clientes||[]).some(c=>c.id===id&&(c.hasInstallmentFiado||c.fiadoHistoryVersion===1))||
    (data.vendas||[]).some(s=>s.clienteId===id&&s.installmentPlan&&!s.deletedAt&&s.active!==false&&!s.desfeita&&!s.cancelledAt));
  const scope=()=>JSON.stringify([DB.getBusinessId(),DB.getWorkspaceGeneration?.()??0,window.TeamAccess?.captureSession?.(),window.SpaceContext?.viewScope?.()]);
  const clientFor=id=>(DB.carregar().clientes||[]).find(c=>c.id===id);
  const summaries=new Map(), confirmedAt=new Map(), pending=new Map(), failedAt=new Map();
  const DISPLAY_TTL=60000, RETRY_DELAY=15000;
  let summaryScope, previewRequest, proofEpoch=0;
  function assertAccount(client,a){
    const balance=Number(client?.saldo??0);
    if(!client||!a||a.clientId!==client.id||![1,2].includes(a.version)||
      a.version===2&&a.historyProofVersion!==1||client.fiadoHistoryVersion===1&&a.version!==2||
      a.financialVersion!==Number(client.financialVersion??0)||
      ![a.dueCents,a.futureCents,a.totalCents,a.creditCents].every(v=>Number.isSafeInteger(v)&&v>=0)||
      a.totalCents!==a.dueCents+a.futureCents||a.creditCents-a.totalCents!==Math.sign(balance)*InstallmentPlan.cents(Math.abs(balance))||
      !Array.isArray(a.entries)||!InstallmentPlan.date(a.asOf))
      throw Object.assign(Error('Confira o saldo e o calendário do cliente no servidor. A operação foi preservada.'),{code:'installment-history-incompatible'});
    return a;
  }
  function summariesForScope(){
    const current=scope();if(summaryScope!==current){summaries.clear();confirmedAt.clear();summaryScope=current;}return summaries;
  }
  function account(id){
    if(!has(id))return null;
    const client=clientFor(id);
    const cached=summariesForScope().get(id);
    try{if(cached?.asOf===InstallmentPlan.today())return assertAccount(client,cached);}catch{/* cache desatualizado */}
    if(!client||client.fiadoHistoryVersion===1||client.legacyBalanceRemaining===undefined||
      !(DB.carregar().vendas||[]).some(s=>s.clienteId===id&&s.installmentPlan&&!s.deletedAt&&s.active!==false&&!s.desfeita&&!s.cancelledAt))return null;
    try{return window.FiadoAccount.project(client,DB.carregar().vendas||[]);}catch{return null;}
  }
  const needsProof = id => has(id) || (window.Clientes?.scopedScreen?.() && window.TeamAccess?.has?.('customers.receiveDebt') && Number(clientFor(id)?.saldo) !== 0);
  function confirmedAccount(id){
    if(!needsProof(id))return null;
    const cached=summariesForScope().get(id);
    if(navigator.onLine===false||Date.now()-(confirmedAt.get(id)||0)>=DISPLAY_TTL)return null;
    try{return cached?.asOf===InstallmentPlan.today()?assertAccount(clientFor(id),cached):null;}catch{return null;}
  }
  function salePreview(client, total, terms, current) {
    assertAccount(client,current);
    if (current.creditCents) throw Error('Cliente com crédito. Confira a apuração antes de projetar o saldo.');
    const day=current.asOf;
    const plan = InstallmentPlan.create({...terms, total, saleDate: day});
    const rows = InstallmentPlan.rows({installmentPlan: plan, creditPaidAmount: 0}, day);
    const dueCents = rows.filter(r => r.dueDate <= day).reduce((sum,r) => sum + r.remainingCents,0);
    const futureCents = rows.filter(r => r.dueDate > day).reduce((sum,r) => sum + r.remainingCents,0);
    return {current, newDueCents: dueCents, newFutureCents: futureCents,
      dueCents: current.dueCents + dueCents, futureCents: current.futureCents + futureCents,
      totalCents: current.totalCents + plan.totalCents};
  }
  function mountCheckoutPreview(host,client,total){
    if(!host)return;
    const origin=scope(),key=JSON.stringify([origin,client.id,client.financialVersion,client.saldo,InstallmentPlan.today()]);
    const terms=read();
    host.textContent='Consultando o saldo no servidor…';
    if(navigator.onLine===false||previewRequest?.key!==key||Date.now()-previewRequest.at>15000){
      const entry={key,at:Date.now(),promise:refresh(client.id)};
      previewRequest=entry;
      entry.promise.catch(()=>{if(previewRequest===entry)previewRequest=null;});
    }
    previewRequest.promise.then(current=>{
      if(!host.isConnected||scope()!==origin)return;
      const p=salePreview(clientFor(client.id),total,terms,current);
      host.innerHTML=`<section class="pos-fiado-preview" data-installment-debt-preview>
        <p>Fiado exigível atual: <b data-current-due>${money(p.current.dueCents)}</b></p>
        <p>Parcelas futuras atuais: <b>${money(p.current.futureCents)}</b></p>
        <p>Esta venda — exigível hoje: <b>${money(p.newDueCents)}</b></p>
        <p>Esta venda — parcelas futuras: <b data-new-future>${money(p.newFutureCents)}</b></p>
        <p>Exigível após confirmar: <b data-after-due>${money(p.dueCents)}</b></p>
        <p>Parcelas futuras após confirmar: <b data-after-future>${money(p.futureCents)}</b></p>
        <p>Total comprometido após confirmar: <b data-after-total>${money(p.totalCents)}</b></p>
        <small>Conta de Fiado da empresa, apurada no servidor. A entrada combinada permanece a receber.</small>
      </section>`;
    }).catch(error=>{
      if(host.isConnected)host.innerHTML=`<p data-installment-preview-unavailable role="status">Prévia indisponível: ${esc(error.message)}</p>`;
    });
  }
  function refresh(id){
    const ticket=window.TeamAccess?.captureSession?.(),origin=scope(),businessId=DB.getBusinessId(),workspaceGeneration=DB.getWorkspaceGeneration?.()??0;
    const epoch=proofEpoch,client=clientFor(id),key=JSON.stringify([epoch,origin,id,client?.financialVersion,client?.saldo,InstallmentPlan.today()]);
    if(pending.has(key))return pending.get(key);
    const request=(async()=>{
      if(navigator.onLine===false||!window.FirebaseCallable)throw Error('Conecte-se para conferir o saldo no servidor. A operação foi preservada.');
      window.TeamAccess?.assertSession?.(ticket);
      const reply=await window.FirebaseCallable('getOperationalSyncReceipt',{kind:'fiado_account',businessId,workspaceGeneration,clientId:id,fiadoHistoryVersion:1});
      window.TeamAccess?.assertSession?.(ticket);
      const result=reply.data??reply;
      if(proofEpoch!==epoch||scope()!==origin||result.businessId!==businessId||result.workspaceGeneration!==workspaceGeneration||result.account?.clientId!==id)
        throw Error('A sessão mudou ou o servidor não confirmou esta conta. A operação foi preservada.');
      const confirmed=assertAccount(clientFor(id),result.account);
      if(confirmed.asOf!==InstallmentPlan.today())throw Error('Confira a data do aparelho e consulte o saldo novamente.');
      if(needsProof(id)){summariesForScope().set(id,confirmed);confirmedAt.set(id,Date.now());}
      window.dispatchEvent?.(new CustomEvent('fiado-account-updated',{detail:{clientId:id}}));
      return confirmed;
    })().finally(()=>{if(pending.get(key)===request)pending.delete(key);});
    pending.set(key,request);
    return request;
  }
  function customerSummary(id,confirmed){const a=confirmed||confirmedAccount(id);if(!a || window.Clientes?.scopedScreen?.() && !window.Clientes.accountBelongsTo(a,window.SpaceContext.activeId()))return '';return `<section class="receipt-debt" data-fiado-account data-fiado-client="${esc(id)}"><h3>Conta de Fiado</h3><p>Exigível agora: <b>${money(a.dueCents)}</b></p><p>Parcelas futuras: <b>${money(a.futureCents)}</b></p><p>Total ainda devido: <b>${money(a.totalCents)}</b></p><p>Próximos vencimentos: ${a.entries.filter(e=>e.dueDate>a.asOf).slice(0,3).map(e=>esc(e.dueDate)+' · '+money(e.remainingCents)).join('; ')||'nenhum'}</p><small>Apurado no servidor em ${esc(a.asOf)}</small>${button(id)}</section>`;}
  function mountCustomer(id){
    const host=document.querySelector('#modal .modal-body,#modal .viewport-scroll,#modal .crm-profile-scroll');
    if(!host||!needsProof(id))return;
    host.insertAdjacentHTML('afterbegin',customerSummary(id)||`<p data-fiado-account data-fiado-client="${esc(id)}" role="status">Consultando exigível e parcelas futuras…</p>`);
    const section=host.querySelector('[data-fiado-account]');
    refresh(id).catch(()=>{if(section.isConnected&&!confirmedAccount(id))section.textContent='Exigível a conferir. Conecte-se e tente consultar o saldo novamente.';});
  }
  function balanceText(id,amountOnly=false){
    const client=clientFor(id),f=client&&window.Clientes?.financialStatus(client);
    if(!f||f.status==='unverified')return 'Exigível a conferir';
    return amountOnly?money(Math.round(f.debt*100)):f.status==='debt'?'Exigível '+money(Math.round(f.debt*100)):f.status==='credit'?'Crédito '+money(Math.round(f.credit*100)):'Sem saldo exigível';
  }
  // Update only financial fragments: preserve search, swipe handlers and open forms.
  let totalsScheduled=false;
  function updateVisibleTotals(){
    if(totalsScheduled)return;totalsScheduled=true;
    queueMicrotask(()=>{
      totalsScheduled=false;
      const page=document.querySelector('#app .clients-page');if(!page||!window.ClientesPage?.render)return;
      const shell=document.createElement('div');shell.innerHTML=window.ClientesPage.render();
      for(const selector of ['.client-kpis','.mobile-client-kpis']){
        const old=page.querySelector(selector),next=shell.querySelector(selector);
        if(old&&next){const values=next.querySelectorAll('strong,em');old.querySelectorAll('strong,em').forEach((value,index)=>{if(values[index]&&value.textContent!==values[index].textContent)value.textContent=values[index].textContent;});}
      }
      for(const chip of page.querySelectorAll('[data-client-chip],[data-mobile-filter]')){
        const attr=chip.hasAttribute('data-client-chip')?'data-client-chip':'data-mobile-filter',value=chip.getAttribute(attr);
        const next=[...shell.querySelectorAll('['+attr+']')].find(el=>el.getAttribute(attr)===value)?.querySelector('b'),old=chip.querySelector('b');
        if(old&&next&&old.textContent!==next.textContent)old.textContent=next.textContent;
      }
    });
  }
  function paint(id){
    const client=clientFor(id);if(!client)return;
    updateVisibleTotals();
    for(const card of document.querySelectorAll('#app .clients-page [data-client-id],#app .clients-page [data-mobile-card]')){
      if((card.dataset.clientId||card.dataset.mobileCard)!==id)continue;
      const mobile=!!card.dataset.mobileCard,renderer=mobile?window.ClientesMobile?.renderCard:window.ClientesPage?.renderCard;
      if(!renderer)continue;
      const shell=document.createElement('div');shell.innerHTML=renderer(client,0);
      for(const selector of mobile?['.mobile-client-balance']:['.client-balance','.client-status']){
        const old=card.querySelector(selector),next=shell.querySelector(selector);if(old&&next&&old.outerHTML!==next.outerHTML)old.replaceWith(next);
      }
      const selector=mobile?'[data-mobile-receive]':'[data-receive-client]',old=card.querySelector(selector),next=shell.querySelector(selector);
      if(old&&next)old.disabled=next.disabled;
    }
    for(const label of document.querySelectorAll('[data-fiado-balance]'))if(label.dataset.fiadoBalance===id)label.textContent=balanceText(id,label.dataset.fiadoAmountOnly==='true');
    for(const section of document.querySelectorAll('[data-fiado-client]'))if(section.dataset.fiadoClient===id){
      const markup=customerSummary(id),shell=document.createElement('div');
      if(markup){shell.innerHTML=markup;if(section.outerHTML!==shell.firstElementChild.outerHTML)section.replaceWith(shell.firstElementChild);}
      else if(section.textContent!=='Exigível a conferir. Verifique a conexão e a origem do saldo.')section.textContent='Exigível a conferir. Verifique a conexão e a origem do saldo.';
    }
  }
  function visibleIds(){return [...new Set([...(window.document?.querySelectorAll('#app .clients-page [data-client-id],#app .clients-page [data-mobile-card],#modal [data-fiado-client]') || [])].map(el=>el.dataset.clientId||el.dataset.mobileCard||el.dataset.fiadoClient))].filter(id=>needsProof(id));}
  let hydrating=false,scheduled=false,rerun=false;
  async function hydrateVisible(){
    if(hydrating){rerun=true;return;}hydrating=true;
    try{
      const origin=scope(), queue=visibleIds();queue.forEach(paint);
      await Promise.all(Array.from({length:Math.min(4,queue.length)},async()=>{
        while(queue.length&&scope()===origin){const id=queue.shift(),key=JSON.stringify([scope(),id,clientFor(id)?.financialVersion,clientFor(id)?.saldo,InstallmentPlan.today()]);
          if(confirmedAccount(id)||navigator.onLine===false||Date.now()-(failedAt.get(key)||0)<RETRY_DELAY)continue;
          try{await refresh(id);failedAt.delete(key);}catch{failedAt.set(key,Date.now());}
        }
      }));
    }finally{hydrating=false;if(rerun){rerun=false;scheduleHydration();}}
  }
  function scheduleHydration(){if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;hydrateVisible();});}
  function recheck(){proofEpoch++;summariesForScope().clear();confirmedAt.clear();failedAt.clear();visibleIds().forEach(paint);scheduleHydration();}
  if(typeof window.addEventListener==='function'){
  window.addEventListener('fiado-account-updated',event=>paint(event.detail.clientId));
  window.addEventListener('financial-state-updated',recheck);
  window.addEventListener('cloud-data-updated',event=>{
    if(['clients','sales','payments','paymentAllocations','balanceEvents'].includes(event.detail?.collection))failedAt.clear();
    // Balance/version checks retire only stale accounts; an unrelated client update must not cancel a valid read.
    scheduleHydration();
  });
  for(const name of ['online','offline'])window.addEventListener(name,recheck);
  for(const name of ['veconi-spaces-ready','firebase-sync-status'])window.addEventListener(name,()=>{failedAt.clear();scheduleHydration();});
  window.AppLifecycle?.onResume?.(recheck);
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')recheck();});
  function observeList(){const app=document.querySelector('#app');if(app)new MutationObserver(scheduleHydration).observe(app,{childList:true,subtree:true});scheduleHydration();}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',observeList,{once:true});else observeList();
  setInterval(()=>{if(document.visibilityState!=='hidden'&&visibleIds().length)scheduleHydration();},30000);
  }
  function fields(){return `<fieldset id="installment-fields" hidden><legend>Crediário / Parcelado</legend><p>Sem juros ou multa. Registre a entrada e os pagamentos somente após receber Pix ou dinheiro.</p><label class="field">Entrada combinada (R$)<input id="installment-down" type="number" min="0" step="0.01" value="0"></label><label class="field">Forma da entrada<select id="installment-method"><option value="pix">Pix externo</option><option value="cash">Dinheiro</option></select></label><label class="field">Parcelas mensais<input id="installment-count" type="number" min="1" max="60" step="1" value="10"></label><label class="field">Primeiro vencimento<input id="installment-first" type="date" value="${InstallmentPlan.month(InstallmentPlan.today(),1)}"></label><p data-installment-preview role="status"></p></fieldset>`;}
  function read(){return{downPayment:Number(document.querySelector('#installment-down')?.value||0),downPaymentMethod:document.querySelector('#installment-method')?.value||'pix',count:Number(document.querySelector('#installment-count')?.value||10),firstDueDate:document.querySelector('#installment-first')?.value||''};}
  function restore(terms){if(terms)for(const [key,id] of [['downPayment','down'],['downPaymentMethod','method'],['count','count'],['firstDueDate','first']]){const el=document.querySelector('#installment-'+id);if(el)el.value=terms[key];}update();}
  function update(){const el=document.querySelector('#installment-fields');if(!el)return;el.hidden=document.querySelector('#sale-payment-method')?.value!=='crediario';if(el.hidden)return;const label=el.querySelector('[data-installment-preview]');try{const plan=InstallmentPlan.create({...read(),total:Number(document.querySelector('#manual-total')?.value||0)});label.textContent=`Entrada ${money(plan.downPaymentCents)} + ${plan.count} parcelas. Primeira: ${money(plan.installments[0].amountCents)}. Total: ${money(plan.totalCents)}. A entrada ainda não está recebida.`;}catch(e){label.textContent=e.message;}}
  function summary(sale){if(!sale.installmentPlan)return'';const p=sale.installmentPlan;return `<section class="receipt-debt"><h3>Crediário / Parcelado · sem juros</h3><p>Entrada combinada: ${money(p.downPaymentCents)}. Recebimentos são confirmados separadamente.</p>${InstallmentPlan.rows(sale).map(r=>`<div><span>${r.number?'Parcela '+r.number:'Entrada'} · ${r.dueDate.split('-').reverse().join('/')} · ${labels[r.status]}${r.overdue&&r.status==='partial'?' (vencida)':''}</span><strong>${money(r.amountCents)} · resta ${money(r.remainingCents)}</strong></div>`).join('')}</section>`;}
  function text(sale){if(!sale.installmentPlan)return'';return 'Crediário / Parcelado — sem juros ou multa\n'+InstallmentPlan.rows(sale).map(r=>`${r.number?'Parcela '+r.number:'Entrada'} | ${r.dueDate} | ${money(r.amountCents)} | ${labels[r.status]} | saldo ${money(r.remainingCents)}`).join('\n');}
  function sales(clientId){const db=window.Clientes?.scopedScreen?.()?window.Clientes.viewData():DB.carregar();return(db.vendas||[]).filter(s=>s.installmentPlan&&(!clientId||s.clienteId===clientId));}
  function button(clientId){return available()&&sales(clientId).length?`<button type="button" class="btn btn-light" data-installment-client="${esc(clientId)}">Parcelas e recebimentos</button>`:'';}
  function csv(clientId){if(!available())throw Error('Sem acesso às parcelas neste contexto.');const records=[['Venda','Cliente','Parcela','Vencimento','Valor','Recebido','Saldo','Status']];for(const s of sales(clientId))for(const r of InstallmentPlan.rows(s))records.push([s.id,s.clienteNome,r.number||'Entrada',r.dueDate,(r.amountCents/100).toFixed(2),(r.paidCents/100).toFixed(2),(r.remainingCents/100).toFixed(2),labels[r.status]]);return records.map(row=>row.map(v=>'"'+String(v).replace(/^[=+@-]/,"'$&").replaceAll('"','""')+'"').join(';')).join('\r\n');}
  function open(clientId){if(!available())return window.Utils?.toast?.('Crediário indisponível neste contexto de acesso.',true);const ticket=window.TeamAccess?.captureSession?.();const assertSession=()=>window.TeamAccess?.assertSession?.(ticket);const root=document.querySelector('#modal');if(!root)return;const list=sales(clientId);root.innerHTML=`<div class="modal-bg viewport-modal"><section class="modal-box viewport-dialog" role="dialog" aria-modal="true" aria-labelledby="installment-title"><header class="modal-head"><h2 id="installment-title">Crediário: parcelas e recebimentos</h2><button class="btn btn-light" data-installment-close>Fechar</button></header><div class="modal-body viewport-scroll"><p>O Fiado exigível inclui compras tradicionais e parcelas vencidas. Parcelas futuras permanecem separadas. Valores locais aguardando sincronização não são confirmação na nuvem.</p>${list.map(s=>{const history=((window.Clientes?.scopedScreen?.()?window.Clientes.viewData():DB.carregar()).pagamentos||[]).filter(p=>(p.allocations||[]).some(a=>a.saleId===s.id));return `<article>${customerSummary(s.clienteId)}<h3>${esc(s.clienteNome)} · venda ${esc(s.id)}</h3>${summary(s)}${Number(s.creditRemainingAmount)>0&&!s.deletedAt&&s.active!==false&&window.TeamAccess?.has?.('customers.receiveDebt')?`<button class="btn btn-primary" data-installment-receive="${esc(s.id)}">Registrar Pix ou dinheiro recebido</button>`:''}<h4>Histórico de recebimentos</h4>${history.map(p=>`<p>${esc(p.data)} · ${money(InstallmentPlan.cents(p.valor))} · ${esc(p.paymentMethod)} · ${p.financialAppliedAt?'Confirmado':'Aguardando confirmação'} <button class="btn btn-light" data-receipt-open="${esc(p.id)}" data-receipt-client="${esc(s.clienteId)}" data-receipt-operation="${esc(p.operationId)}">Comprovante</button></p>`).join('')||'<p>Nenhum recebimento registrado.</p>'}</article>`;}).join('')||'<p>Nenhuma venda parcelada neste aparelho.</p>'}</div><footer class="modal-foot"><button class="btn btn-light" data-installment-export>Exportar parcelas (CSV)</button></footer></section></div>`;
    root.querySelector('[data-installment-close]').onclick=()=>Modais.fechar();
    root.querySelectorAll('[data-installment-receive]').forEach(b=>b.onclick=()=>{assertSession();const s=list.find(s=>s.id===b.dataset.installmentReceive);Fiados.openReceive(s.clienteId,{scoped:window.Clientes?.scopedScreen?.(),onRecorded:(p,c)=>window.ReceiptMessageUI.open(p,c)});});
    root.querySelector('[data-installment-export]').onclick=()=>{assertSession();const url=URL.createObjectURL(new Blob(['\uFEFF'+csv(clientId)],{type:'text/csv;charset=utf-8'})),a=document.createElement('a');a.href=url;a.download='crediario-parcelas.csv';a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
    if(clientId&&!root.querySelector('[data-fiado-account]'))mountCustomer(clientId);
    window.Modais?.layout?.(root.querySelector('[role=dialog]'));
  }
  document.addEventListener('click',e=>{const b=e.target.closest?.('[data-installment-client]');if(b)open(b.dataset.installmentClient||undefined);});
  const updatePreview = e => {
    if(e.target.closest?.('#installment-fields') || e.target.id === 'manual-total') {
      update();
      window.dispatchEvent(new Event('installment-preview-changed'));
    }
  };
  document.addEventListener('input',updatePreview);
  document.addEventListener('change',updatePreview);
  return {has,account,confirmedAccount,hydrateVisible,balanceText,refresh,assertAccount,customerSummary,mountCustomer,available,fields,read,restore,update,summary,text,button,open,csv,salePreview,mountCheckoutPreview};
})();
