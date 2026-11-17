window.FiadoConditions = (() => {
  'use strict';
  const modes=[['none','Sem prazo definido'],['weekly','Semanal'],['fortnight','Quinzenal'],['monthly','Mensal'],['custom','Personalizado']];
  const cash=cents=>Utils.dinheiro(cents/100), date=value=>value?value.split('-').reverse().join('/'):'—';
  const today=()=>window.InstallmentPlan.today();
  const isConditionFilter=key=>['fiado-atrasado','fiado-hoje','fiado-promessa'].includes(key);
  const esc=value=>Utils.escapar(String(value??''));
  let view=null,timer,queueChecks=null;
  function scope(){
    const businessId=DB.getBusinessId(),spaceId=window.SpaceContext?.activeId?.();
    const user=window.FirebaseSession?.user?.uid;
    if(!businessId||!spaceId||!user||window.OperationalReadPolicy?.restricted?.()||
      !window.TeamAccess?.has?.('customers.view')||
      !['customers.receiveDebt','sales.create'].some(permission=>window.TeamAccess.has(permission)))return null;
    return {businessId,spaceId,workspaceGeneration:DB.getWorkspaceGeneration?.()??0,uid:user,
      guard:window.SpaceContext.viewScope()};
  }
  const scopeKey=()=>JSON.stringify(scope());
  function state(){
    const key=scopeKey();
    if(view?.key!==key)view={key,rows:new Map(),cursor:null,loaded:false,busy:false,failed:false};
    return view;
  }
  const canEdit=()=>!!scope()&&window.TeamAccess.has('customers.edit')&&window.TeamAccess.has('customers.receiveDebt');
  async function call(kind,input={},write=false){
    const source=scope();
    if(!source||navigator.onLine===false)throw Error('Conecte-se e selecione um espaço autorizado para consultar as condições.');
    const {guard,uid,...context}=source, key=JSON.stringify(source);
    const result=await window.FirebaseCallable(write?'commitOperationalSync':'getOperationalSyncReceipt',{
      ...context,...input,kind,syncProtocolVersion:1,clientRelease:Number(window.AdiFestaBuild?.release||235)
    });
    if(scopeKey()!==key)throw Error('O espaço ou a sessão mudou. Abra a consulta novamente.');
    return result.data;
  }
  function get(id){
    const row=state().rows.get(String(id));
    if(!row)return null;
    const client=window.Clientes?.obter?.(String(id));
    if(!queueChecks){queueChecks=new Map();queueMicrotask(()=>{queueChecks=null;});}
    if(!queueChecks.has(id)){
      let pending=false;
      try{window.SyncFirebase?.assertFiadoReceiptQueueClear?.(String(id));}
      catch{pending=true;}
      queueChecks.set(id,pending);
    }
    if(queueChecks.get(id)||navigator.onLine===false||Number.isInteger(client?.financialVersion)&&
      Number.isInteger(row.financialVersion)&&client.financialVersion!==row.financialVersion)
      return {...row,confirmed:false,dueDate:null,overdueDays:0,usedCents:null,availableCents:null,percent:null};
    const now=today();
    return {...row,
      overdueDays:row.dueDate?Math.max(0,(Date.parse(now)-Date.parse(row.dueDate))/86400000):0,
      promise:row.promise?{...row.promise,state:row.promise.status==='fulfilled'?'fulfilled':row.promise.date<now?'missed':'pending'}:null};
  }
  function notify(){dispatchEvent(new Event('fiado-conditions-updated'));}
  async function refresh({more=false}={}){
    if(!scope()||!window.FirebaseCallable||navigator.onLine===false)return;
    const v=state();
    if(v.busy||v.loaded&&(!more||!v.cursor))return;
    v.busy=true;
    try{
      const result=await call('fiado_conditions_list',{cursor:more?v.cursor:null});
      if(v!==state())return;
      const known=new Set((window.Clientes?.viewData?.().clientes||[]).map(client=>client.id));
      for(let i=0;i<result.rows.length;i+=4){
        await Promise.allSettled(result.rows.slice(i,i+4).filter(row=>known.has(row.clientId)).map(async ({clientId})=>{
          const item=await call('fiado_conditions',{clientId});
          if(v===state())v.rows.set(clientId,item);
        })).then(results=>{if(results.some(item=>item.status==='rejected'))v.failed=true;});
      }
      if(v!==state())return;
      v.loaded=true;
      v.cursor=result.cursor;
    }catch{v.failed=true;}
    finally{v.busy=false;if(v===state()){v.loaded=true;notify();}}
  }
  const anyUnproved=v=>[...v.rows.values()].some(row=>!row.confirmed);
  const incomplete=()=>{const v=state();return !v.loaded||v.busy||Boolean(v.cursor)||v.failed||anyUnproved(v);};
  function note(){
    const v=state();
    if(!scope())return '';
    if(!v.loaded)return '<small class="muted" role="status">'+(navigator.onLine===false?'Condições disponíveis após conectar.':'Conferindo condições de Fiado…')+'</small>';
    return ((v.failed||anyUnproved(v))?'<small class="muted">Algumas condições ainda precisam ser conferidas.</small>':'')+
      (v.cursor?'<button type="button" class="btn btn-light btn-sm" data-fiado-conditions-more>Carregar mais condições</button>':'');
  }
  function matches(id,filter){
    const row=get(id);
    if(filter==='fiado-atrasado')return !!row?.overdueDays;
    if(filter==='fiado-hoje')return row?.dueDate===today();
    if(filter==='fiado-promessa')return Boolean(row?.promise&&row.promise.state!=='fulfilled');
    return true;
  }
  function sort(a,b,kind){
    const x=get(a),y=get(b);
    return kind==='fiado-atraso'?(y?.overdueDays||0)-(x?.overdueDays||0):
      (x?.dueDate||'9999-12-31').localeCompare(y?.dueDate||'9999-12-31');
  }
  function badge(id){
    const row=get(id);
    if(!row?.configured)return '';
    const items=[];
    if(row.confirmed&&row.dueDate)items.push(row.overdueDays?row.overdueDays+'d em atraso · '+date(row.dueDate):'Vence em '+date(row.dueDate));
    if(!row.confirmed)items.push('Condições cadastradas · saldo a conferir');
    if(row.confirmed&&row.limitCents!==null)items.push('Disponível '+cash(row.availableCents)+' · usado '+cash(row.usedCents)+' ('+row.percent+'%)');
    if(row.promise&&row.promise.state!=='fulfilled')items.push((row.promise.state==='missed'?'Promessa não cumprida':'Pagamento combinado')+' · '+date(row.promise.date)+' · '+cash(row.promise.amountCents));
    return items.length?'<p class="fiado-conditions-summary">'+items.map(esc).join('<br>')+'</p>':'';
  }
  async function edit(id){
    if(!canEdit())return Utils.toast('Seu acesso não permite editar as condições de Fiado.',true);
    const root=document.querySelector('#modal'), client=window.Clientes?.obter?.(id), session=scopeKey();
    if(!root||!client)return;
    root.innerHTML='<div class="modal-bg"><section class="modal-box fiado-conditions-dialog"><header class="modal-head"><h3>Condições do Fiado</h3><button type="button" class="icon-btn" data-conditions-close aria-label="Fechar">×</button></header>'+
      '<div class="modal-body" data-conditions-body><p role="status">Consultando condições…</p></div><footer class="modal-foot" data-conditions-footer hidden><button class="btn btn-primary" form="fiado-conditions-form" type="submit">Salvar condições</button></footer></section></div>';
    root.querySelector('[data-conditions-close]').onclick=()=>root.replaceChildren();
    const body=root.querySelector('[data-conditions-body]');
    const current=()=>body.isConnected&&scopeKey()===session;
    try{
      const row=await call('fiado_conditions',{clientId:id});
      if(!current())return;
      const input=(name,label,value,type='text')=>'<label class="field">'+label+'<input name="'+name+'" type="'+type+'" value="'+esc(value)+'" '+(type==='number'?'min="0" step="'+(name==='days'?'1':'0.01')+'"':'')+'></label>';
      const validCycle=row.confirmed&&row.usedCents>0;
      const promise=row.promise||{};
      body.innerHTML='<p><b>'+esc(client.nome)+'</b></p><form id="fiado-conditions-form" class="fiado-conditions-form">'+
        '<label class="field">Prazo para o próximo ciclo<select name="mode">'+modes.map(([key,title])=>'<option value="'+key+'" '+(key===row.mode?'selected':'')+'>'+title+'</option>').join('')+'</select></label>'+
        '<div data-conditions-days '+(row.mode==='custom'?'':'hidden')+'>'+input('days','Dias corridos',row.days??'','number')+'</div>'+
        input('limit','Limite de Fiado (R$)',row.limitCents===null?'':row.limitCents/100,'number')+
        (validCycle?'<p>Vencimento atual '+date(row.dueDate)+'</p>'+input('renegotiatedDueDate','Renegociar vencimento (opcional)','','date'):'')+
        '<fieldset><legend>Promessa de pagamento</legend>'+input('promiseDate','Data combinada',promise.date||'','date')+
        input('promiseValue','Valor prometido (R$)',promise.amountCents?promise.amountCents/100:'','number')+
        '<label class="field">Observação (opcional)<textarea name="note" rows="2" maxlength="500">'+esc(promise.note||'')+'</textarea></label>'+
        '<label><input type="checkbox" name="fulfilled" '+(promise.status==='fulfilled'?'checked':'')+'> Marcar promessa cumprida</label></fieldset>'+
        '<p class="muted">As condições e promessas não movimentam saldo ou caixa.</p>'+
        '<p role="status" data-conditions-feedback></p></form>';
      root.querySelector('[data-conditions-footer]').hidden=false;
      const form=body.querySelector('form'), days=body.querySelector('[data-conditions-days]');
      form.elements.mode.onchange=()=>days.hidden=form.elements.mode.value!=='custom';
      form.onsubmit=async event=>{
        event.preventDefault();
        if(!current()||!canEdit())return;
        const button=event.submitter;
        button.disabled=true;
        const feedback=form.querySelector('[data-conditions-feedback]');
        const f=new FormData(form), toCents=name=>f.get(name)===''?null:window.InstallmentPlan.cents(f.get(name));
        try{
          const promise=f.get('promiseDate')||f.get('promiseValue')?{date:f.get('promiseDate'),amountCents:toCents('promiseValue'),
            note:f.get('note'),status:f.has('fulfilled')?'fulfilled':'pending'}:null;
          const saved=await call('fiado_conditions',{clientId:id,revision:row.revision,mode:f.get('mode'),days:Number(f.get('days')),
            limitCents:toCents('limit'),renegotiatedDueDate:f.get('renegotiatedDueDate'),promise},true);
          if(current()){state().rows.set(id,saved);root.replaceChildren();notify();Utils.toast('Condições salvas para este espaço.');}
        }catch(error){if(current())feedback.textContent=error.message||'Não foi possível salvar.';}
        finally{button.disabled=false;}
      };
    }catch(error){if(current())body.textContent=error.message||'Não foi possível consultar.';}
  }
  async function checkoutWarning(clientId,totalCents,spaceId){
    if(!scope()||navigator.onLine===false||!window.FirebaseCallable)return '';
    let row, timeout;
    try{
      const budget=new Promise(resolve=>{timeout=setTimeout(()=>resolve(null),1800);});
      row=await Promise.race([call('fiado_conditions',{clientId,spaceId}),budget]);
    }catch{return '';}
    finally{clearTimeout(timeout);}
    if(!row?.confirmed||row.limitCents===null||row.usedCents+totalCents<=row.limitCents)return '';
    return 'Limite de Fiado ultrapassado em '+cash(row.usedCents+totalCents-row.limitCents)+'.';
  }
  function invalidate(){
    view=null;
    clearTimeout(timer);
    if(window.Router?.atual?.()==='clientes')timer=setTimeout(()=>refresh(),180);
  }
  window.addEventListener('cloud-data-updated',event=>{
    if(['clients','sales','payments','balanceEvents','paymentAllocations','balanceAdjustments'].includes(event.detail?.collection))invalidate();
  });
  for(const event of ['business-context-changed','veconi-space-context-changed','firebase-session-cleared','financial-state-updated','online'])window.addEventListener(event,invalidate);
  document.addEventListener('click',event=>{
    const control=event.target.closest?.('[data-fiado-terms]');
    if(control){event.preventDefault();void edit(control.dataset.fiadoTerms);return;}
    const more=event.target.closest?.('[data-fiado-conditions-more]');
    if(more){more.disabled=true;void refresh({more:true});}
  });
  window.addEventListener('fiado-conditions-updated',()=>{
    if(document.querySelector('.clients-mobile-page'))window.ClientesMobile?.refresh?.();
    else if(document.querySelector('.clients-page'))window.ClientesPage?.refresh?.();
  });
  const action=id=>canEdit()?'<button class="fiado-conditions-action" type="button" data-fiado-terms="'+esc(id)+'">Condições de Fiado</button>':'';
  return Object.freeze({action,incomplete,canView:()=>!!scope(),edit,get,refresh,note,checkoutWarning,badge,matches,sort,isConditionFilter,canEdit});
})();
