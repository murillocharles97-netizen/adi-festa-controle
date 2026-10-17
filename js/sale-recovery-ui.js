/* Explicit recovery intake and owner decisions; no automatic commercial replay. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const when=value=>value?new Date(value).toLocaleString('pt-BR'):'Horário não registrado';
const notice='Registro preservado para análise. Nenhum efeito comercial foi aplicado por esta recuperação.';
const context=()=>window.BusinessContext?.get?.()||{};
const identity=()=>{const c=context();return `${c.uid||window.FirebaseSession?.user?.uid||''}:${c.businessId||''}:${c.business?.workspaceGeneration??0}`;};
let count=0,busy=false,unsubscribe=null,lastIdentity='',message='',refreshSequence=0,scanError='';
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
  return{identity:initial,sources};
}
const call=(name,data)=>{
  const c=context();
  if(!window.FirebaseCallable||!window.FirebaseSession?.user)throw Error('Entre na sua conta para continuar.');
  return window.FirebaseCallable(name,{...data,businessId:c.businessId,workspaceGeneration:c.business?.workspaceGeneration??0});
};
const sender=window.SaleRecoveryClient.create({snapshot:capture,call,onProgress:({sent,total})=>{message=`Enviando dados… ${sent} de ${total}`;mount();}});
function modal(title,body,footer=''){
  const root=document.querySelector('#modal');if(!root)return null;
  const prior=document.activeElement;
  root.innerHTML=`<div class="modal-bg sale-recovery-modal-bg"><section class="modal-box sale-recovery-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1"><header class="modal-head"><h2>${esc(title)}</h2><button class="btn btn-light" type="button" data-recovery-close aria-label="Fechar">Fechar</button></header><div class="modal-body">${body}</div><footer class="modal-foot">${footer}</footer></section></div>`;
  const panel=root.querySelector('section');
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
  const panel=modal('Enviar dados para recuperação?',`<p>Serão enviados os registros das ${count} vendas retidas ao responsável pela empresa.</p><p><strong>Isso não refaz vendas, não movimenta estoque e não altera o Financeiro.</strong> Os dados originais continuarão preservados neste aparelho.</p><p data-recovery-result role="status" aria-live="polite"></p>`,`<button class="btn btn-light" type="button" data-recovery-close>Cancelar</button><button class="btn btn-primary" type="button" data-recovery-confirm>Confirmar envio</button>`);
  if(!panel)return;
  panel.querySelector('[data-recovery-confirm]').onclick=async()=>{
    if(busy)return;const session=identity();busy=true;message='Enviando dados…';mount();panel.querySelector('[data-recovery-confirm]').disabled=true;
    try{
      const result=await sender.send();
      if(identity()!==session)throw Error('A sessão mudou. Confira o recebimento na conta original.');
      message=`Dados de ${result.sent} vendas confirmados. Consulte a situação para acompanhar a revisão do responsável.`;
      panel.querySelector('[data-recovery-result]').textContent=message;
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
const recoveryStatus=value=>({awaiting_review:'Aguardando revisão',already_recreated:'Já recriada pelo gestor',recovered:'Recuperada'}[value]||'Aguardando revisão');
function confirmDecision(item,action,match,view){
  if(busy||context().role!=='owner')return;
  const titles={link_existing:'Confirmar: já foi registrada',dismiss_match:'Não é a mesma venda',recover_original:'Recuperar venda original'};
  const explanations={
    link_existing:`O registro original será vinculado à venda ${esc(match?.saleId)}. Não haverá nova venda, baixa, receita, estorno ou alteração de metas. A venda do gestor permanecerá intacta. O reenvio da operação original ficará bloqueado.`,
    dismiss_match:'Somente esta sugestão será descartada. A venda original continuará aguardando decisão, sem nenhum efeito comercial.',
    recover_original:'Confirme que esta venda NÃO foi registrada pelo gestor. O estoque e os vínculos serão revalidados. Se tudo conferir, a mesma operação original será executada uma única vez, com os IDs preservados. Ela passará a contar em vendas/metas e na automação financeira do espaço, quando habilitada. Falta de estoque ou conflito bloqueará a recuperação.'
  };
  const panel=modal(titles[action],`<p><strong>${money(item.total)}</strong> · ${esc(when(item.originalSaleAt))}</p><p>${explanations[action]}</p><p>O pacote original e a fila do aparelho serão preservados para auditoria.</p><p data-decision-result role="status" aria-live="polite"></p>`,`<button class="btn btn-light" type="button" data-decision-back>Voltar</button><button class="btn btn-primary" type="button" data-decision-confirm>Confirmar decisão</button>`);
  if(!panel)return;
  panel.querySelector('[data-decision-back]').onclick=()=>{if(!busy)void openReviews(view);};
  panel.querySelector('[data-decision-confirm]').onclick=async()=>{
    if(busy)return;const session=identity();busy=true;
    const button=panel.querySelector('[data-decision-confirm]');button.disabled=true;button.textContent='Validando…';
    try{
      const response=await call('decideSaleRecovery',{saleId:item.saleId,contentHash:item.contentHash,revision:item.revision??0,action,linkedSaleId:match?.saleId,
        confirmation:{link_existing:'VINCULAR',dismiss_match:'NAO_E_A_MESMA',recover_original:'RECUPERAR'}[action]});
      const result=response.data??response;
      if(identity()!==session||!panel.isConnected)return;
      panel.querySelector('[data-decision-result]').textContent=action==='dismiss_match'?'Sugestão descartada. O original continua aguardando decisão.':`${recoveryStatus(result.status)}. Venda vinculada: ${result.linkedSaleId}.`;
      button.remove();panel.querySelector('[data-decision-back]').textContent='Voltar aos registros';
    }catch(error){
      if(identity()===session&&panel.isConnected){
        const code=String(error.code||'').replace(/^functions\//,'');
        panel.querySelector('[data-decision-result]').textContent=['unavailable','deadline-exceeded','internal'].includes(code)?'Não foi possível confirmar a resposta. Reabra os registros para consultar o estado antes de repetir. A mesma decisão é idempotente.':error.message||'A recuperação não pôde ser confirmada. O registro permanece preservado.';
        button.textContent='Confirmar a mesma decisão';button.disabled=false;
      }
    }finally{busy=false;}
  };
}
async function openReviews(view='pending'){
  const session=identity(),spaceId=selectedSpace(),panel=modal('Vendas aguardando revisão',`<p class="sale-recovery-warning">Registros preservados com decisões explícitas. Vincular uma venda existente não aplica efeitos comerciais. Recuperar a original exige confirmação e validação transacional.</p><nav class="sale-recovery-tabs" aria-label="Situação da recuperação"><button class="btn ${view==='pending'?'btn-primary':'btn-light'}" aria-pressed="${view==='pending'}" data-review-pending>Em revisão</button><button class="btn ${view==='resolved'?'btn-primary':'btn-light'}" aria-pressed="${view==='resolved'}" data-review-resolved>Resolvidas</button></nav><div data-recovery-list role="status">Carregando registros…</div>`,`<button class="btn btn-light" type="button" data-recovery-close>Fechar</button>`);
  if(!panel)return;
  panel.querySelector('[data-review-pending]').onclick=()=>{if(!busy)void openReviews('pending');};
  panel.querySelector('[data-review-resolved]').onclick=()=>{if(!busy)void openReviews('resolved');};
  let cursor=null,loading=false;
  async function page(){
    if(loading)return;loading=true;
    try{
      const response=await call('listSaleRecoveryReviews',{spaceId,cursor,view}),result=response.data??response;
      if(identity()!==session||!panel.isConnected)return;
      const list=panel.querySelector('[data-recovery-list]');
      if(!cursor)list.replaceChildren();
      for(const item of result.items){
        const article=document.createElement('article');article.className='sale-recovery-card';
        const pending=item.status==='awaiting_review',owner=context().role==='owner',matches=item.possibleMatches||[];
        article.innerHTML=`<header><strong>${money(item.total)}</strong><span class="sale-recovery-status">${recoveryStatus(item.status)}</span></header><p><time>${esc(when(item.originalSaleAt))}</time> · ${esc(item.actorName)} · ${esc(item.spaceName)}</p><p>Origem: venda retida no aparelho de origem · ${esc(item.paymentMethod||'Pagamento não informado')}</p><ul>${item.items.map(i=>`<li>${esc(i.quantity)} × ${esc(i.name)}${i.variantName?` — ${esc(i.variantName)}`:''}</li>`).join('')}</ul><p class="sale-recovery-warning">${item.status==='recovered'?'Venda original recuperada com os mesmos IDs. Efeitos aplicados uma única vez; automações seguem a configuração do espaço.':notice}</p>${matches.length?`<div class="sale-recovery-warning"><strong>Possível venda semelhante registrada pelo gestor</strong>${matches.map((m,index)=>`<section class="sale-recovery-match"><p>${esc(when(m.at))} · ${money(m.total)} · ${esc(m.paymentMethod)}<br><small>Venda ${esc(m.saleId)} · ${m.sameTotal?'mesmo valor':'valor diferente'} · ${m.samePaymentMethod?'mesmo pagamento':'pagamento diferente'}</small></p>${pending&&owner?`<div class="sale-recovery-actions"><button type="button" class="btn btn-primary" data-link-match="${index}">Confirmar: já foi registrada</button><button type="button" class="btn btn-light" data-dismiss-match="${index}">Não é a mesma venda</button></div>`:''}</section>`).join('')}</div>`:''}${item.comparisonScope?`<small>${esc(item.comparisonScope)}</small>`:''}${pending&&(item.remoteEvidence?.saleExists||item.remoteEvidence?.operationExists||item.remoteEvidence?.movementIdsPresent?.length)?'<p class="sale-recovery-warning">Já existem registros relacionados na nuvem. Conferência manual necessária; nenhum efeito foi aplicado por este envio.</p>':''}${item.conflictCount?'<p class="sale-recovery-warning">Foi recebido conteúdo diferente para estes IDs. O original permanece preservado para análise.</p>':''}${!pending?`<div class="sale-recovery-resolution"><strong>${recoveryStatus(item.status)}</strong><p>Decisão em ${esc(when(item.resolvedAt))}<br>Responsável: ${esc(item.resolvedByName||item.resolvedByUid)}<br>Venda vinculada: <strong>${esc(item.linkedSaleId)}</strong>${item.linkedSale?`<br>${esc(when(item.linkedSale.at))} · ${money(item.linkedSale.total)} · ${esc(item.linkedSale.paymentMethod)}`:''}</p><p>A operação original permanece preservada e bloqueada para reenvio comercial.</p></div>`:''}<details><summary>Identificação do registro</summary><p>Venda original: ${esc(item.saleId)}<br>Operação original: ${esc(item.operationId)}</p></details>${pending&&owner?'<div class="sale-recovery-actions"><button type="button" class="btn btn-primary" data-recover-original>Recuperar venda original</button></div>':''}`;
        article.querySelectorAll('[data-link-match]').forEach(b=>b.onclick=()=>confirmDecision(item,'link_existing',matches[Number(b.dataset.linkMatch)],view));
        article.querySelectorAll('[data-dismiss-match]').forEach(b=>b.onclick=()=>confirmDecision(item,'dismiss_match',matches[Number(b.dataset.dismissMatch)],view));
        article.querySelector('[data-recover-original]')?.addEventListener('click',()=>confirmDecision(item,'recover_original',null,view));
        list.append(article);
      }
      if(!list.children.length)list.textContent=view==='resolved'?'Nenhuma recuperação resolvida nesta página/contexto.':'Nenhuma venda aguardando revisão nesta página/contexto.';
      cursor=result.nextCursor;
      panel.querySelector('[data-recovery-more]')?.remove();
      if(cursor){const more=document.createElement('button');more.type='button';more.className='btn btn-light';more.dataset.recoveryMore='';more.textContent='Carregar mais';more.onclick=page;list.after(more);}
    }catch{if(identity()===session&&panel.isConnected)panel.querySelector('[data-recovery-list]').textContent='Não foi possível consultar os registros. Verifique sua conexão e o espaço selecionado.';}
    finally{loading=false;}
  }
  await page();
}
function mount(){
  // Outside commercial route content: a denied route/readonly plan does not
  // hide the original actor's evidence intake. Auth/membership gates still apply.
  const app=document.querySelector('#app'),root=app?.parentElement;if(!root)return;
  const c=context(),key=identity();
  if(lastIdentity!==key){message='';lastIdentity=key;document.querySelector('.sale-recovery-modal-bg')?.remove();}
  let bar=root.querySelector('[data-sale-recovery-bar]');
  const ownerArea=c.role==='owner'&&['inicio','historico'].includes(location.hash.replace('#/','').split('?')[0]||'inicio');
  if(!recoveryIdentity()||(!count&&!ownerArea&&!scanError)){bar?.remove();return;}
  if(!bar){bar=document.createElement('section');bar.className='sale-recovery-banner';bar.dataset.saleRecoveryBar='';app.before(bar);}
  const html=`<div><strong>${scanError?'Vendas preservadas neste aparelho':count?`Há ${count} vendas preservadas neste aparelho`:'Vendas aguardando revisão'}</strong><p role="status" aria-live="polite">${esc(scanError||message||'O envio preserva os registros sem refazer vendas. Consulte a revisão para acompanhar as decisões do responsável.')}</p></div><div class="sale-recovery-actions">${count&&!scanError?`<button type="button" class="btn btn-primary" data-send-recovery ${busy?'disabled':''}>${busy?'Enviando…':'Enviar dados para recuperação'}</button>`:''}<button type="button" class="btn btn-light" data-view-recovery>${c.role==='owner'?'Vendas aguardando revisão':'Ver situação do envio'}</button></div>`;
  if(bar.recoveryMarkup!==html){bar.recoveryMarkup=html;bar.innerHTML=html;bar.querySelector('[data-send-recovery]')?.addEventListener('click',confirmSend);bar.querySelector('[data-view-recovery]').onclick=()=>openReviews();}
}
async function refresh(){
  const sequence=++refreshSequence,session=identity();
  if(!recoveryIdentity()){count=0;scanError='';mount();return;}
  try{const snapshot=await capture();if(sequence!==refreshSequence||identity()!==session)return;count=window.SaleRecoveryClient.entries(snapshot).length;scanError='';}
  catch(error){if(sequence!==refreshSequence||identity()!==session)return;count=0;scanError=error.message||'Não foi possível consultar os registros preservados. Nenhum dado foi alterado.';}
  mount();
}
function start(){unsubscribe?.();unsubscribe=window.SyncFirebase?.subscribe?.(()=>{void refresh();});void refresh();}
addEventListener('firebase-auth-ready',start);
addEventListener('hashchange',refresh);
addEventListener('business-context-changed',refresh);
addEventListener('firebase-bootstrap-state',refresh);
addEventListener('firebase-session-cleared',refresh);
// Reattach to the existing panel after normal route renders, no cloud listener.
let scheduled=false;
new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;mount();});}).observe(document.querySelector('main')||document.body,{childList:true,subtree:true});
start();
