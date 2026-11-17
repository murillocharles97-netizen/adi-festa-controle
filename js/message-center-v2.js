window.MessageCenterV2=(()=>{
  'use strict';
  const icons=name=>'<i data-lucide="'+name+'"></i>';
  const esc=value=>Utils.escapar(String(value??''));
  const dayMs=86400000;
  const segments=[
    ['fiado-atrasado','Clientes em atraso','calendar-clock'],
    ['fiado-hoje','Vencimentos de hoje','calendar-days'],
    ['fiado-promessa','Promessas de pagamento','handshake'],
    ['renewal','Renovações próximas','repeat-2'],
    ['charge','Cobranças','message-circle'],
    ['campaign','Campanhas','megaphone'],
    ['notice','Avisos','bell'],
    ['inactive','Clientes inativos','user-minus'],
    ['birthday','Aniversariantes','cake'],
    ['models','Modelos de mensagens','files'],
    ['history','Histórico de comunicações','history']
  ];
  const day=value=>String(value||'').slice(0,10);
  const today=()=>window.InstallmentPlan.today();
  const activeSpace=()=>{const id=window.SpaceContext?.homeId?.();return id&&id!=='all_spaces'?id:null;};
  let saved=null;
  const scope=()=>{
    const id=DB.getBusinessId(), spaceId=activeSpace(), uid=window.FirebaseSession?.user?.uid||window.TeamAccess?.actor?.()?.actorUid;
    return id&&uid&&spaceId
      ?{businessId:id,spaceId,workspaceGeneration:DB.getWorkspaceGeneration?.()??0,uid}:null;
  };
  const key=()=>JSON.stringify(scope());
  const canUse=()=>Boolean(scope())&&Mensagens.canSend()&&!window.OperationalReadPolicy?.restricted?.();
  const canSeeRenewal=()=>Boolean(window.TeamAccess?.has?.('sales.create')||window.TeamAccess?.has?.('reports.view'));
  const inactive=client=>!!client.ultimaCompra&&(Date.parse(today())-Date.parse(day(client.ultimaCompra)))/dayMs>=60;
  const birthday=client=>{
    const value=day(client.dataNascimento||client.aniversario);
    return /^\d{4}-\d{2}-\d{2}$/.test(value)&&value.slice(5,7)===today().slice(5,7);
  };
  function matches(client,segment){
    if(segment==='inactive')return inactive(client);
    if(segment==='birthday')return birthday(client);
    return window.FiadoConditions?.isConditionFilter(segment)?window.FiadoConditions.matches(client.id,segment):true;
  }
  const clients=()=>(Clientes.viewData?.().clientes||[]).filter(client=>client.ativo!==false&&client.active!==false&&!client.deletedAt);
  const templates=type=>saved?.key===key()?saved.rows.filter(row=>!type||row.type===type):[];
  async function call(kind,data={},write=false){
    if(!canUse()||navigator.onLine===false)throw Error('Conecte-se com acesso ao espaço para consultar os modelos.');
    const principal=key(),{uid,...context}=scope();
    const result=await window.FirebaseCallable(write?'commitOperationalSync':'getOperationalSyncReceipt',{
      ...context,...data,kind,syncProtocolVersion:1,clientRelease:235
    });
    if(principal!==key())throw Error('O espaço mudou. Abra os modelos novamente.');
    return result.data;
  }
  async function loadModels(){
    if(!canUse())return;
    const principal=key();
    const result=await call('message_space_templates');
    saved={key:principal,rows:result.templates};
  }
  function enter(){return loadModels().catch(()=>{});}
  function shortcutCount(clientRows,segment){
    if(segment==='renewal'){
      const result=window.CustomerSubscriptions?.view?.metrics?.();
      return result?result.dueToday+result.due7:null;
    }
    if(segment.startsWith('fiado-')&&window.FiadoConditions?.incomplete?.())return '—';
    if(segment==='charge')return clientRows.reduce((total,client)=>{
      const status=Clientes.listFinancialStatus?.(client);
      return total+Number(status?.status==='debt'&&status.saldo<0);
    },0);
    if(['inactive','birthday','fiado-atrasado','fiado-hoje','fiado-promessa'].includes(segment))
      return clientRows.reduce((total,client)=>total+Number(matches(client,segment)),0);
    return null;
  }
  function home(){
    const rows=clients();
    return '<section class="message-v2-dashboard"><div class="message-v2-progress" data-v2-progress></div>'+
      (window.FiadoConditions?.note?.()||'')+
      '<div class="message-v2-grid">'+segments.filter(([id])=>id!=='renewal'||canSeeRenewal()).map(([id,label,icon])=>{
        const count=shortcutCount(rows,id);
        return '<button type="button" data-v2-section="'+id+'">'+icons(icon)+'<span>'+label+'</span>'+
          (count===null?'':'<strong>'+count+'</strong>')+'</button>';
      }).join('')+'</div></section>';
  }
  async function progress(root){
    const target=root.querySelector('[data-v2-progress]');
    if(!target||!canUse())return;
    const principal=key(), seq=await MessageSequence.active().catch(()=>null);
    if(!target.isConnected||key()!==principal||!seq)return;
    if(seq.spaceId!==activeSpace()){
      target.textContent='Há uma sequência em outro espaço. Selecione o espaço de origem para continuar.';
      return;
    }
    target.innerHTML='<article><div><strong>Sequência '+(seq.paused?'pausada':'em andamento')+'</strong><small>'+seq.currentIndex+' de '+
      seq.selectedCustomerIds.length+' contatos processados</small></div><progress aria-label="Progresso da sequência" value="'+seq.currentIndex+
      '" max="'+seq.selectedCustomerIds.length+'"></progress><div><button class="btn btn-primary" data-v2-resume>Continuar</button>'+
      '<button class="btn btn-light" data-v2-end>Encerrar</button></div></article>';
    target.querySelector('[data-v2-resume]').onclick=async event=>{
      const button=event.currentTarget;button.disabled=true;
      try{const next=seq.paused?await MessageSequence.pause(seq,false):seq;if(key()===principal)await MessageSequenceUI.composer(next);}
      catch(error){Utils.toast(MessageSequence.friendly(error),true);}
      finally{button.disabled=false;}
    };
    target.querySelector('[data-v2-end]').onclick=async event=>{
      if(!confirm('Encerrar esta sequência e preservar o progresso já registrado?'))return;
      const button=event.currentTarget;button.disabled=true;
      try{await MessageSequence.cancel(seq);if(key()===principal)target.replaceChildren();}
      catch(error){Utils.toast(MessageSequence.friendly(error),true);}
      finally{button.disabled=false;}
    };
  }
  function history(){
    if(!canUse())return '';
    const {businessId,spaceId}=scope(), data=Clientes.viewData?.()||DB.carregar();
    const ids=new Set(clients().map(client=>client.id));
    const rows=Mensagens.history(null,data).filter(row=>row.businessId===businessId&&row.spaceId===spaceId&&ids.has(row.clientId));
    return '<div class="message-v2-history">'+(rows.length?rows.slice(0,100).map(row=>{
      const status={sent_confirmed:'Envio confirmado pelo operador',opened_whatsapp:'WhatsApp aberto',not_sent:'Não enviado'}[row.status]||'Registro de comunicação';
      const stamp=row.sentAt||row.openedWhatsAppAt||row.createdAt;
      return '<article><b>'+esc(row.clientName||Clientes.obter(row.clientId)?.nome||'Cliente')+'</b><span>'+status+
        '</span><small>'+esc(stamp?new Date(stamp).toLocaleString('pt-BR'):'')+'</small></article>';
    }).join(''):'<p>Nenhuma comunicação registrada neste espaço.</p>')+
      (rows.length>100?'<p>100 comunicações mais recentes.</p>':'')+'</div>';
  }
  async function models(root,refresh){
    const target=root.querySelector('[data-v2-models]'), principal=key();
    if(!target)return;
    try{await loadModels();}
    catch(error){if(target.isConnected&&key()===principal)target.textContent=error.message||'Não foi possível consultar os modelos.';return;}
    if(!target.isConnected||key()!==principal)return;
    target.innerHTML='<button type="button" class="btn btn-primary" data-v2-new>Novo modelo</button><div data-v2-model-form></div>'+
      '<div class="message-v2-history">'+(templates().map(row=>'<article><b>'+esc(row.name)+'</b><small>'+esc(row.content)+'</small>'+
      '<button class="btn btn-light" type="button" data-v2-edit="'+esc(row.id)+'">Editar</button></article>').join('')||'<p>Nenhum modelo personalizado neste espaço.</p>')+'</div>';
    const open=row=>{
      const typeLabels={charge:'Cobrança',campaign:'Campanha',notice:'Aviso',custom:'Mensagem livre',renewal:'Renovação'};
      const targetForm=target.querySelector('[data-v2-model-form]');
      targetForm.innerHTML='<form><label class="field">Nome<input required name="name" maxlength="100" value="'+esc(row?.name)+'"></label>'+
        '<label class="field">Tipo<select name="type">'+Object.entries(typeLabels).map(([id,label])=>'<option value="'+id+'" '+(row?.type===id?'selected':'')+'>'+label+'</option>').join('')+'</select></label>'+
        '<label class="field">Mensagem<textarea name="content" required rows="5" maxlength="4000">'+esc(row?.content)+'</textarea></label>'+
        '<small>Variáveis disponíveis: {{nome}}, {{primeiro_nome}}, {{saldo}}, {{nome_negocio}}, {{ultima_cobranca}}, {{pix}}, {{data_atual}}, {{renovacoes}}.</small>'+
        '<p role="status" data-v2-model-feedback></p><button class="btn btn-primary" type="submit">Salvar neste espaço</button></form>';
      const form=targetForm.querySelector('form'), templateId=row?.id||crypto.randomUUID();
      form.onsubmit=async event=>{
        event.preventDefault();
        if(key()!==principal)return;
        const button=event.submitter;button.disabled=true;
        try{
          await call('message_space_template_save',{...Object.fromEntries(new FormData(form)),templateId,revision:row?.revision??0},true);
          if(form.isConnected&&key()===principal){Utils.toast('Modelo salvo neste espaço.');refresh();}
        }catch(error){if(form.isConnected)form.querySelector('[data-v2-model-feedback]').textContent=error.message||'Não foi possível salvar.';}
        finally{button.disabled=false;}
      };
      form.elements.name.focus();
    };
    target.querySelector('[data-v2-new]').onclick=()=>open();
    target.querySelectorAll('[data-v2-edit]').forEach(button=>button.onclick=()=>open(templates().find(row=>row.id===button.dataset.v2Edit)));
  }
  return Object.freeze({home,history,models,progress,templates,enter,matches,canUse,activeSpace});
})();
