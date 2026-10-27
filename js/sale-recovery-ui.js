/* Explicit recovery intake and owner decisions; no automatic commercial replay. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const when=value=>value?new Date(value).toLocaleString('pt-BR'):'Horário não registrado';
const notice='Registro preservado para análise. Nenhum efeito comercial foi aplicado por esta recuperação.';
const context=()=>window.BusinessContext?.get?.()||{};
const identity=()=>{const c=context();return `${c.uid||window.FirebaseSession?.user?.uid||''}:${c.businessId||''}:${c.business?.workspaceGeneration??0}`;};
let count=0,customerCount=0,busy=false,unsubscribe=null,lastIdentity='',message='',refreshSequence=0,scanError='';
let reviewSummary={key:'',state:'unknown',pending:0,checkedAt:0},summaryFlight=null,summaryTimer=null;
const summaryKey=()=>`${identity()}:${context().role||''}:${selectedSpace()||'all'}`;
function confirmedHistorical(packet,initial,diagnostics){
  const diagnostic=diagnostics.find(item=>item.operationId===packet.operationId&&item.businessId===initial.businessId);
  if(!diagnostic||typeof window.SyncFirebase?.checksumValue!=='function')return false;
  if(diagnostic.payloadChecksum!==window.SyncFirebase.checksumValue(packet.payload||{}))return false;
  const value=diagnostic.resolution||diagnostic.archive;
  if(!value||value.operationId!==packet.operationId||value.businessId!==initial.businessId||value.actorUid!==initial.uid||
    value.workspaceGeneration!==initial.workspaceGeneration||value.payloadChecksum!==diagnostic.payloadChecksum)return false;
  const sale=packet.payload?.writes?.filter(w=>w.entityType==='sales'&&w.operation==='create')||[];
  if(diagnostic.reviewState==='resolved')return sale.length===1&&value.saleId===sale[0].entityId&&value.spaceId===sale[0].data?.spaceId&&
    ['already_recreated','recovered','closed_without_effects'].includes(value.status)&&Boolean(value.resolvedAt&&value.resolvedByUid);
  return diagnostic.reviewState==='archived'&&value.status==='archived'&&value.commercialEffectsApplied===false;
}
async function checkReviews(){
  if(context().role!=='owner'||!recoveryIdentity()||!['inicio','historico'].includes(location.hash.replace('#/','').split('?')[0]||'inicio'))return;
  const key=summaryKey();
  if(reviewSummary.key===key&&Date.now()-reviewSummary.checkedAt<60000)return;
  if(summaryFlight?.key===key)return summaryFlight.promise;
  reviewSummary={key,state:'checking',pending:0,checkedAt:0};mount();
  const flight={key};
  flight.promise=(async()=>{
    try{
      let cursor=null;const cursors=new Set();
      // The existing endpoint filters after pagination. An empty page is NOT an all-clear.
      for(let page=0;page<50;page++){
        const response=await call('listSaleRecoveryReviews',{spaceId:selectedSpace(),view:'pending',cursor}),result=response.data??response;
        if(summaryKey()!==key||!recoveryIdentity())return;
        if(!Array.isArray(result.items))throw Error('Resposta de revisão incompleta.');
        const pending=result.items.filter(item=>item.status==='awaiting_review').length;
        if(pending||!result.nextCursor){reviewSummary={key,state:pending?'pending':'clear',pending,checkedAt:Date.now()};return;}
        if(cursors.has(result.nextCursor))throw Error('Paginação de revisão inconclusiva.');
        cursor=result.nextCursor;cursors.add(cursor);
      }
      throw Error('Consulta de revisão ainda incompleta.');
    }catch{
      if(summaryKey()===key)reviewSummary={key,state:'unknown',pending:0,checkedAt:Date.now()};
    }finally{if(summaryFlight===flight)summaryFlight=null;mount();}
  })();
  summaryFlight=flight;return flight.promise;
}
function recoveryIdentity(){
  const c=context(),uid=window.FirebaseSession?.user?.uid,bootstrap=window.FirebaseBootstrap?.state;
  if(!uid||c.userProfile?.uid!==uid||c.userProfile.active!==true||c.member?.status!=='active'||c.business?.active!==true||!c.businessId||
    bootstrap&&!['authorized','ready','subscription_warning','subscription_blocked'].includes(bootstrap)||window.WorkspaceRuntime?.isBlocked?.())return null;
  return{uid,businessId:c.businessId,workspaceGeneration:c.business.workspaceGeneration??0};
}
async function capture(){
  const initial=recoveryIdentity(),session=identity();
  if(!initial)throw Error('Entre na conta de origem para enviar os dados.');
  const sources=await window.DB.businessCache.recoverySources(initial);
  if(identity()!==session||!recoveryIdentity())throw Error('A sessão mudou. Seus dados continuam preservados.');
  const diagnostics=window.SyncFirebase?.getQueueDiagnostics?.()||[];
  // Read verified metadata only. Original packets, queue and evidence are never modified.
  return{identity:initial,sources:sources.map(source=>({...source,packets:(source.packets||[]).filter(packet=>!confirmedHistorical(packet,initial,diagnostics))}))};
}
const call=(name,data)=>{
  const c=context();
  if(!window.FirebaseCallable||!window.FirebaseSession?.user)throw Error('Entre na sua conta para continuar.');
  return window.FirebaseCallable(name,{...data,businessId:c.businessId,workspaceGeneration:c.business?.workspaceGeneration??0});
};
async function readIntakeReviews({identity:origin,packets}){
  const rows=[];
  for(const spaceId of new Set(packets.map(p=>p.spaceId))){
    let cursor=null;const seen=new Set();
    for(let page=0;page<50;page++){
      const active=recoveryIdentity();if(!active||active.uid!==origin.uid||active.businessId!==origin.businessId||active.workspaceGeneration!==origin.workspaceGeneration)throw Error('A sessão mudou.');
      const response=await call('listSaleRecoveryReviews',{spaceId,cursor}),result=response.data??response;
      if(!Array.isArray(result.items))throw Error('Consulta de recebimento incompleta.');
      rows.push(...result.items.filter(r=>packets.some(p=>p.saleId===r.saleId&&p.spaceId===spaceId)));
      if(!result.nextCursor)break;if(seen.has(result.nextCursor)||page===49)throw Error('Consulta de recebimento incompleta.');seen.add(result.nextCursor);cursor=result.nextCursor;
    }
  }
  return rows;
}
const sender=window.SaleRecoveryClient.create({snapshot:capture,call,readReviews:readIntakeReviews,onProgress:({sent,total})=>{message=`Enviando dados… ${sent} de ${total}`;mount();}});
function modal(title,body,footer=''){
  const root=document.querySelector('#modal');if(!root)return null;
  const prior=document.activeElement;
  root.innerHTML=`<div class="modal-bg sale-recovery-modal-bg viewport-modal"><section class="modal-box sale-recovery-modal viewport-dialog" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1"><header class="modal-head"><h2>${esc(title)}</h2><button class="btn btn-light" type="button" data-recovery-close aria-label="Fechar">Fechar</button></header><div class="modal-body viewport-scroll">${body}</div><footer class="modal-foot">${footer}</footer></section></div>`;
  const panel=root.querySelector('section');
  panel.dataset.recoveryContext=summaryKey();
  const close=()=>{if(busy)return;root.replaceChildren();prior?.isConnected&&prior.focus();};
  root.querySelectorAll('[data-recovery-close]').forEach(b=>b.onclick=close);
  panel.onkeydown=e=>{
    if(e.key==='Escape'){e.preventDefault();close();}
    if(e.key==='Tab'){
      const nodes=[...panel.querySelectorAll('button:not(:disabled),a[href],input,select,[tabindex="0"]')];
      if(!nodes.length){e.preventDefault();return;}
      if(e.shiftKey&&(document.activeElement===nodes[0]||document.activeElement===panel)){e.preventDefault();nodes.at(-1).focus();}
      else if(!e.shiftKey&&document.activeElement===nodes.at(-1)){e.preventDefault();nodes[0].focus();}
    }
  };
  panel.focus();return panel;
}
function confirmSend(){
  if(busy||!recoveryIdentity()||scanError)return;
  if(!navigator.onLine){message='Conecte-se à internet para enviar. Seus dados continuam preservados.';mount();return;}
  const panel=modal(customerCount?'Complementar dados para recuperação?':'Enviar dados para recuperação?',`<p>Serão conferidos ${count} pacotes de vendas e enviados ${customerCount} cadastros originais retidos, quando presentes. Pacotes já recebidos não são novas vendas. O resultado informará separadamente os complementos confirmados e os dados ainda ausentes.</p><p><strong>Isso não refaz vendas, não movimenta estoque e não altera o Financeiro.</strong> Os dados originais continuarão preservados neste aparelho.</p><p data-recovery-result role="status" aria-live="polite"></p>`,`<button class="btn btn-light" type="button" data-recovery-close>Cancelar</button><button class="btn btn-primary" type="button" data-recovery-confirm>${customerCount?'Confirmar complemento':'Confirmar envio'}</button>`);
  if(!panel)return;
  panel.querySelector('[data-recovery-confirm]').onclick=async()=>{
    if(busy)return;const session=identity();busy=true;message='Enviando dados…';mount();panel.querySelector('[data-recovery-confirm]').disabled=true;
    try{
      const result=await sender.send();
      if(identity()!==session)throw Error('A sessão mudou. Confira o recebimento na conta original.');
      message=window.SaleRecoveryClient.describe(result);
      panel.querySelector('[data-recovery-result]').textContent=message;
      panel.querySelector('[data-recovery-result]').setAttribute('role',result.evidence?.verification==='verified'&&!result.evidence.missingCustomers?'status':'alert');
      const feedback=panel.querySelector('[data-recovery-result]');feedback.tabIndex=-1;feedback.focus({preventScroll:true});feedback.scrollIntoView?.({block:'nearest'});
      panel.querySelector('[data-recovery-confirm]').remove();
      panel.querySelectorAll('[data-recovery-close]').forEach(b=>b.textContent='Fechar');
    }catch(error){
      // Backend responses never include raw payload or credentials.
      const code=String(error.code||'').replace(/^functions\//,'');
      message=code==='permission-denied'?'O acesso não permitiu o envio. Avise o responsável. Seus dados continuam preservados.':code==='unavailable'||code==='deadline-exceeded'?'Não foi possível confirmar o envio. Seus dados continuam preservados. Tente novamente.':error.message||'Não foi possível enviar. Seus dados continuam preservados.';
      if(identity()===session){panel.querySelector('[data-recovery-result]').textContent=message;panel.querySelector('[data-recovery-confirm]').disabled=false;}
    }finally{busy=false;mount();}
  };
}
function selectedSpace(){
  const c=context(),id=window.SpaceContext?.homeId?.();
  if(id&&!['all','all_spaces','todos'].includes(id))return id;
  return c.role!=='owner'&&c.spaceAccess!=='all'&&c.allowedSpaceIds?.length===1?c.allowedSpaceIds[0]:null;
}
const recoveryStatus=value=>({awaiting_review:'Aguardando revisão',already_recreated:'Já recriada pelo gestor',recovered:'Recuperada',closed_without_effects:'Encerrada sem efeitos'}[value]||'Aguardando revisão');
function confirmDecision(item,action,match,view,returnState={}){
  if(busy||context().role!=='owner')return;
  const titles={link_existing:'Confirmar: já foi registrada',dismiss_match:'Não é a mesma venda',recover_original:'Recuperar venda original',close_without_effects:'Não recuperar / encerrada sem efeitos',approve_client:'Aprovar cadastro original'};
  const explanations={
    approve_client:`O cadastro preservado ${esc(match?.clientId)} será confirmado com seu ID e operação originais, após conferir possíveis duplicatas. Isso não executa a venda, não cria saldo e não movimenta estoque. Dados semelhantes ou conflito bloqueiam a aprovação.`,
    close_without_effects:'Esta revisão será encerrada sem recuperar a venda. O registro e os IDs originais serão preservados, com responsável e data da decisão. Não haverá venda, baixa de estoque, receita, estorno ou alteração de metas/faturamento. A operação original continuará bloqueada para reenvio comercial.',
    link_existing:`O registro original será vinculado à venda ${esc(match?.saleId)}. Não haverá nova venda, baixa, receita, estorno ou alteração de metas. A venda do gestor permanecerá intacta. O reenvio da operação original ficará bloqueado.`,
    dismiss_match:'Somente esta sugestão será descartada. A venda original continuará aguardando decisão, sem nenhum efeito comercial.',
    recover_original:'Confirme que esta venda NÃO foi registrada pelo gestor. O estoque e os vínculos serão revalidados. Se tudo conferir, a mesma operação original será executada uma única vez, com os IDs preservados. Ela passará a contar em vendas/metas e na automação financeira do espaço, quando habilitada. Falta de estoque ou conflito bloqueará a recuperação.'
  };
  // The server requires these attestations for EVERY customer-linked sale,
  // not just for a newly approved dependency. Ask for all original recoveries
  // as a safe fallback when an older backend does not expose the contract yet.
  const needsEvidence=action==='recover_original';
  const evidence=needsEvidence?'<fieldset class="sale-recovery-evidence"><legend>Conferência operacional obrigatória</legend><label><input type="checkbox" data-evidence="goodsDelivered"> Confirmei que as mercadorias foram entregues.</label><label><input type="checkbox" data-evidence="paymentReceived"> Confirmei que o pagamento indicado já foi recebido fora do aplicativo. Não cobrar novamente.</label><label><input type="checkbox" data-evidence="notRecreated"> Conferi que esta venda não foi registrada novamente com outro ID.</label></fieldset>':'';
  const panel=modal(titles[action],`<p><strong>${money(item.total)}</strong> · ${esc(when(item.originalSaleAt))}</p><p>${explanations[action]}</p>${evidence}<p>O pacote original e a fila do aparelho serão preservados para auditoria.</p><p data-decision-result role="status" aria-live="polite"></p>`,`<button class="btn btn-light" type="button" data-decision-back>Voltar</button><button class="btn btn-primary" type="button" data-decision-confirm>Confirmar decisão</button>`);
  if(!panel)return;
  const showResult=(text,error=false)=>{
    const result=panel.querySelector('[data-decision-result]');result.textContent=text;result.classList.toggle('is-error',error);result.setAttribute('role',error?'alert':'status');result.tabIndex=-1;result.focus({preventScroll:true});result.scrollIntoView?.({block:'nearest'});
  };
  panel.querySelector('[data-decision-back]').onclick=()=>{if(!busy)void openReviews(view,returnState);};
  panel.querySelector('[data-decision-confirm]').onclick=async()=>{
    if(busy)return;
    if(needsEvidence&&[...panel.querySelectorAll('[data-evidence]')].some(input=>!input.checked)){showResult('Confira entrega, recebimento e ausência de venda recriada antes de continuar.',true);return;}
    const session=summaryKey();busy=true;
    const button=panel.querySelector('[data-decision-confirm]');button.disabled=true;button.textContent='Validando…';
    try{
      const response=await call('decideSaleRecovery',{saleId:item.saleId,contentHash:item.contentHash,revision:item.revision??0,action,linkedSaleId:match?.saleId,
        ...(action==='approve_client'?{clientOperationId:match.operationId}:{}),
        ...(needsEvidence?{operationalEvidence:Object.fromEntries([...panel.querySelectorAll('[data-evidence]')].map(input=>[input.dataset.evidence,input.checked]))}:{}),
        confirmation:{link_existing:'VINCULAR',dismiss_match:'NAO_E_A_MESMA',recover_original:'RECUPERAR',close_without_effects:'ENCERRAR_SEM_EFEITOS',approve_client:'APROVAR_CADASTRO'}[action]});
      const result=response.data??response;
      if(summaryKey()!==session||!panel.isConnected)return;
      const expected={approve_client:'awaiting_review',dismiss_match:'awaiting_review',close_without_effects:'closed_without_effects',link_existing:'already_recreated',recover_original:'recovered'}[action];
      if(result.saleId!==item.saleId||result.status!==expected||action==='recover_original'&&result.linkedSaleId!==item.saleId||action==='link_existing'&&result.linkedSaleId!==match.saleId||action==='approve_client'&&(result.clientId!==match.clientId||result.clientOperationId!==match.operationId))throw Error('A resposta não confirmou esta decisão. Volte aos registros e consulte a situação antes de tentar novamente.');
      showResult(action==='approve_client'?'Cadastro confirmado. A venda permanece aguardando decisão, sem estoque ou cobrança aplicada.':action==='dismiss_match'?'Sugestão descartada. O original continua aguardando decisão.':action==='close_without_effects'?'Encerrada sem efeitos. Nenhuma venda, movimento de estoque ou receita foi criada. O original permanece preservado.':`${recoveryStatus(result.status)}. Venda vinculada: ${result.linkedSaleId}.`);
      button.remove();panel.querySelector('[data-decision-back]').textContent='Voltar aos registros';
      reviewSummary.checkedAt=0;void refresh();
    }catch(error){
      if(summaryKey()===session&&panel.isConnected){
        const code=String(error.code||'').replace(/^functions\//,'');
        const uncertain=['unavailable','deadline-exceeded','internal'].includes(code);
        showResult(uncertain?'Não foi possível confirmar a resposta. Volte aos registros e consulte a situação antes de repetir. Nenhuma nova cobrança será iniciada.':error.message||'A recuperação não pôde ser confirmada. O registro permanece preservado.',true);
        button.textContent=uncertain?'Consultar situação nos registros':code==='aborted'?'Atualizar registros':'Confirmar decisão';button.disabled=false;
        if(uncertain||code==='aborted')button.onclick=()=>{if(!busy)void openReviews(view,returnState);};
      }
    }finally{busy=false;}
  };
}
async function openReviews(view='pending',returnState={}){
  const session=identity(),spaceId=selectedSpace(),panel=modal('Vendas aguardando revisão',`<p class="sale-recovery-warning">Registros preservados com decisões explícitas. Vincular uma venda existente não aplica efeitos comerciais. Recuperar a original exige confirmação e validação transacional.</p><nav class="sale-recovery-tabs" aria-label="Situação da recuperação"><button class="btn ${view==='pending'?'btn-primary':'btn-light'}" aria-pressed="${view==='pending'}" data-review-pending>Em revisão</button><button class="btn ${view==='resolved'?'btn-primary':'btn-light'}" aria-pressed="${view==='resolved'}" data-review-resolved>Resolvidas</button></nav><div data-recovery-list role="status">Carregando registros…</div>`,`<button class="btn btn-light" type="button" data-recovery-close>Fechar</button>`);
  if(!panel)return;
  panel.querySelector('[data-review-pending]').onclick=()=>{if(!busy)void openReviews('pending');};
  panel.querySelector('[data-review-resolved]').onclick=()=>{if(!busy)void openReviews('resolved');};
  let cursor=null,loading=false,loadedPages=0;
  const position=()=>({pages:loadedPages,scrollTop:panel.querySelector('.modal-body').scrollTop});
  async function page(){
    if(loading)return;loading=true;
    try{
      const response=await call('listSaleRecoveryReviews',{spaceId,cursor,view}),result=response.data??response;
      if(identity()!==session||panel.dataset.recoveryContext!==summaryKey()||!panel.isConnected)return;
      const list=panel.querySelector('[data-recovery-list]');
      if(!cursor)list.replaceChildren();
      for(const item of [...result.items].sort((a,b)=>String(a.originalSaleAt).localeCompare(String(b.originalSaleAt)))){
        const article=document.createElement('article');article.className='sale-recovery-card';
        article.dataset.saleId=item.saleId;
        const pending=item.status==='awaiting_review',owner=context().role==='owner',matches=item.possibleMatches||[];
        article.innerHTML=`<header><strong>${money(item.total)}</strong><span class="sale-recovery-status">${recoveryStatus(item.status)}</span></header><p><time>${esc(when(item.originalSaleAt))}</time> · ${esc(item.actorName)} · ${esc(item.spaceName)}</p><p>Origem: venda retida no aparelho de origem · ${esc(item.paymentMethod||'Pagamento não informado')}</p><ul>${item.items.map(i=>`<li>${esc(i.quantity)} × ${esc(i.name)}${i.variantName?` — ${esc(i.variantName)}`:''}</li>`).join('')}</ul><p class="sale-recovery-warning">${item.status==='recovered'?'Venda original recuperada com os mesmos IDs. Efeitos aplicados uma única vez; automações seguem a configuração do espaço.':notice}</p>${matches.length?`<div class="sale-recovery-warning"><strong>Possível venda semelhante registrada pelo gestor</strong>${matches.map((m,index)=>`<section class="sale-recovery-match"><p>${esc(when(m.at))} · ${money(m.total)} · ${esc(m.paymentMethod)}<br><small>Venda ${esc(m.saleId)} · ${m.sameTotal?'mesmo valor':'valor diferente'} · ${m.samePaymentMethod?'mesmo pagamento':'pagamento diferente'}</small></p>${pending&&owner?`<div class="sale-recovery-actions"><button type="button" class="btn btn-primary" data-link-match="${index}">Confirmar: já foi registrada</button><button type="button" class="btn btn-light" data-dismiss-match="${index}">Não é a mesma venda</button></div>`:''}</section>`).join('')}</div>`:''}${item.comparisonScope?`<small>${esc(item.comparisonScope)}</small>`:''}${pending&&(item.remoteEvidence?.saleExists||item.remoteEvidence?.operationExists||item.remoteEvidence?.movementIdsPresent?.length)?'<p class="sale-recovery-warning">Já existem registros relacionados na nuvem. Conferência manual necessária; nenhum efeito foi aplicado por este envio.</p>':''}${item.conflictCount?'<p class="sale-recovery-warning">Foi recebido conteúdo diferente para estes IDs. O original permanece preservado para análise.</p>':''}${!pending?`<div class="sale-recovery-resolution"><strong>${recoveryStatus(item.status)}</strong><p>Decisão em ${esc(when(item.resolvedAt))}<br>Responsável: ${esc(item.resolvedByName||item.resolvedByUid)}<br>Venda vinculada: <strong>${esc(item.linkedSaleId)}</strong>${item.linkedSale?`<br>${esc(when(item.linkedSale.at))} · ${money(item.linkedSale.total)} · ${esc(item.linkedSale.paymentMethod)}`:''}</p><p>A operação original permanece preservada e bloqueada para reenvio comercial.</p></div>`:''}<details><summary>Identificação do registro</summary><p>Venda original: ${esc(item.saleId)}<br>Operação original: ${esc(item.operationId)}</p></details>${pending&&owner?'<div class="sale-recovery-actions"><button type="button" class="btn btn-primary" data-recover-original>Recuperar venda original</button></div>':''}`;
        if(pending&&owner){
          for(const dependency of item.clientDependencies||[]){
            const box=document.createElement('section');box.className='sale-recovery-warning';
            const text=document.createElement('p');text.textContent=`Cadastro original ${dependency.clientId} · ${dependency.name||'Cliente preservado'} · ${dependency.related?'vinculado a esta venda':'outro cadastro retido da mesma origem'} · ${dependency.status==='client_confirmed'?'confirmado':'aguardando aprovação'}`;box.append(text);
            if(dependency.status!=='client_confirmed'){
              const approve=document.createElement('button');approve.type='button';approve.className='btn btn-light';approve.textContent='Analisar e aprovar cadastro original';approve.onclick=()=>confirmDecision(item,'approve_client',dependency,view,position());box.append(approve);
            }
            article.querySelector('[data-recover-original]').parentElement.before(box);
          }
          if(item.clientDependencies?.some(d=>d.related&&d.status!=='client_confirmed')){
            const recover=article.querySelector('[data-recover-original]');recover.disabled=true;recover.title='Confirme primeiro o cadastro vinculado. A venda continua preservada.';
            const explanation=document.createElement('p');explanation.className='sale-recovery-warning';explanation.textContent='Antes de recuperar esta venda, analise e aprove o cadastro vinculado acima.';recover.parentElement.before(explanation);
          }
          if(item.customerConfirmation?.state==='awaiting_dependency_evidence'){
            const recover=article.querySelector('[data-recover-original]');recover.disabled=true;recover.title='Falta a evidência original do cadastro.';
            const explanation=document.createElement('p');explanation.className='sale-recovery-warning';explanation.textContent='Cliente ainda não confirmado. No aparelho da funcionária atualizado, toque em Enviar dados para recuperação → Confirmar. Isso apenas complementa as evidências; depois aprove o cadastro aqui antes de recuperar a venda.';recover.parentElement.before(explanation);
          }
          const close=document.createElement('button');close.type='button';close.className='btn btn-light';close.textContent='Não recuperar / encerrada sem efeitos';
          close.onclick=()=>confirmDecision(item,'close_without_effects',null,view,position());
          article.querySelector('[data-recover-original]').parentElement.append(close);
        }
        if(item.status==='closed_without_effects'){
          article.querySelector('.sale-recovery-resolution p').textContent=`Decisão em ${when(item.resolvedAt)} · Responsável: ${item.resolvedByName||item.resolvedByUid}. Nenhuma venda vinculada. Nenhum efeito comercial aplicado.`;
        }
        article.querySelectorAll('[data-link-match]').forEach(b=>b.onclick=()=>confirmDecision(item,'link_existing',matches[Number(b.dataset.linkMatch)],view,position()));
        article.querySelectorAll('[data-dismiss-match]').forEach(b=>b.onclick=()=>confirmDecision(item,'dismiss_match',matches[Number(b.dataset.dismissMatch)],view,position()));
        article.querySelector('[data-recover-original]')?.addEventListener('click',()=>confirmDecision(item,'recover_original',null,view,position()));
        list.append(article);
      }
      if(!list.children.length)list.textContent=view==='resolved'?'Nenhuma recuperação resolvida nesta página/contexto.':'Nenhuma venda aguardando revisão nesta página/contexto.';
      cursor=result.nextCursor;
      loadedPages++;
      panel.querySelector('[data-recovery-more]')?.remove();
      if(cursor){const more=document.createElement('button');more.type='button';more.className='btn btn-light';more.dataset.recoveryMore='';more.textContent='Carregar mais';more.onclick=page;list.after(more);}
    }catch{if(identity()===session&&panel.isConnected)panel.querySelector('[data-recovery-list]').textContent='Não foi possível consultar os registros. Verifique sua conexão e o espaço selecionado.';}
    finally{loading=false;}
  }
  await page();
  while(panel.isConnected&&identity()===session&&cursor&&loadedPages<Math.min(Number(returnState.pages)||1,50)){const before=loadedPages;await page();if(loadedPages===before)break;}
  if(panel.isConnected&&identity()===session)panel.querySelector('.modal-body').scrollTop=Number(returnState.scrollTop)||0;
}
function mount(){
  // Outside commercial content: retained evidence remains accessible when modules are blocked.
  const app=document.querySelector('#app'),root=app?.parentElement;if(!root)return;
  const c=context(),key=identity(),route=location.hash.replace('#/','').split('?')[0]||'inicio';
  const openPanel=document.querySelector('.sale-recovery-modal');if(openPanel&&openPanel.dataset.recoveryContext!==summaryKey())openPanel.parentElement.remove();
  if(lastIdentity!==key){message='';lastIdentity=key;document.querySelector('.sale-recovery-modal-bg')?.remove();}
  let bar=root.querySelector('[data-sale-recovery-bar]'),link=app.querySelector('[data-recovery-entry]');
  const ownerArea=c.role==='owner'&&['inicio','historico'].includes(route),authorized=Boolean(recoveryIdentity());
  // Permanent access belongs in History, not a permanent warning on the Dashboard.
  if(authorized&&c.role==='owner'&&route==='historico'){
    if(!link){link=document.createElement('nav');link.dataset.recoveryEntry='';link.className='sale-recovery-entry';link.setAttribute('aria-label','Revisão de vendas');link.innerHTML='<button type="button" class="btn btn-light">Revisões de vendas · em revisão e resolvidas</button>';link.firstElementChild.onclick=()=>openReviews();app.prepend(link);}
  }else link?.remove();
  const summary=reviewSummary.key===summaryKey()?reviewSummary:{state:'checking',pending:0};
  if(!authorized||(!count&&!scanError&&(!ownerArea||summary.state==='clear'))){bar?.remove();return;}
  if(!bar){bar=document.createElement('section');bar.className='sale-recovery-banner is-compact';bar.dataset.saleRecoveryBar='';bar.setAttribute('aria-label','Situação das revisões de vendas');app.before(bar);}
  const title=scanError?'Conferência dos registros preservados pendente':count?(count===1?'Há 1 venda aguardando análise':`Há ${count} vendas aguardando análise`):summary.state==='pending'?'Há vendas aguardando revisão':summary.state==='unknown'?'Revisões: confirmação pendente':'Conferindo revisões de vendas…';
  const detail=scanError||message||(count?'Envie os dados preservados para análise, sem refazer a venda.':summary.state==='unknown'?'Não foi possível confirmar a situação. Consulte as revisões; nenhum registro foi reenviado.':summary.state==='pending'?'Confira os registros antes de decidir. Nenhuma recuperação é automática.':'Consulta segura, sem alterar vendas ou estoque.');
  const html=`<div><strong>${esc(title)}</strong><p role="status" aria-live="polite">${esc(detail)}</p></div><div class="sale-recovery-actions">${count&&!scanError?`<button type="button" class="btn btn-primary" data-send-recovery ${busy?'disabled':''}>${busy?'Enviando…':customerCount?'Complementar dados para recuperação':'Enviar dados para recuperação'}</button>`:''}<button type="button" class="btn btn-light" data-view-recovery>${c.role==='owner'?'Revisar vendas':'Ver situação do envio'}</button></div>`;
  if(bar.recoveryMarkup!==html){bar.recoveryMarkup=html;bar.innerHTML=html;bar.querySelector('[data-send-recovery]')?.addEventListener('click',confirmSend);bar.querySelector('[data-view-recovery]').onclick=()=>openReviews();}
}
async function refresh(){
  const sequence=++refreshSequence,session=identity();
  clearTimeout(summaryTimer);
  if(!recoveryIdentity()){count=0;customerCount=0;scanError='';reviewSummary={key:'',state:'unknown',pending:0,checkedAt:0};mount();return;}
  // Clear the previous session/space presentation before awaiting any reads.
  if(lastIdentity!==session){count=0;customerCount=0;scanError='';}mount();
  try{const snapshot=await capture();if(sequence!==refreshSequence||identity()!==session)return;const rows=window.SaleRecoveryClient.entries(snapshot);count=rows.length;customerCount=new Set(rows.flatMap(r=>(r.local.clientDependencies||[]).map(d=>d.packet.operationId))).size;scanError='';}
  catch(error){if(sequence!==refreshSequence||identity()!==session)return;count=0;customerCount=0;scanError=error.message||'Não foi possível consultar os registros preservados. Nenhum dado foi alterado.';}
  mount();await checkReviews();
  clearTimeout(summaryTimer);
  if(context().role==='owner'&&recoveryIdentity()&&document.visibilityState!=='hidden'&&['inicio','historico'].includes(location.hash.replace('#/','').split('?')[0]||'inicio'))summaryTimer=setTimeout(()=>{void refresh();},60000);
}
function start(){unsubscribe?.();unsubscribe=window.SyncFirebase?.subscribe?.(()=>{void refresh();});void refresh();}
addEventListener('firebase-auth-ready',start);
addEventListener('hashchange',refresh);
addEventListener('business-context-changed',()=>{reviewSummary.checkedAt=0;void refresh();});
addEventListener('veconi-space-context-changed',refresh);
addEventListener('firebase-bootstrap-state',refresh);
addEventListener('firebase-session-cleared',refresh);
addEventListener('focus',refresh);
addEventListener('online',refresh);
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='hidden')void refresh();else clearTimeout(summaryTimer);});
// Reattach to the existing panel after normal route renders, no cloud listener.
let scheduled=false;
new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;mount();});}).observe(document.querySelector('main')||document.body,{childList:true,subtree:true});
start();
