/* Explicit, read-only recovery intake; deliberately no automatic upload. */
const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
const when=value=>value?new Date(value).toLocaleString('pt-BR'):'Horário não registrado';
const notice='Registro preservado para análise. Nenhum efeito comercial foi aplicado por esta recuperação.';
const context=()=>window.BusinessContext?.get?.()||{};
const identity=()=>{const c=context();return `${c.uid||window.FirebaseSession?.user?.uid||''}:${c.businessId||''}:${c.business?.workspaceGeneration??0}`;};
let count=0,busy=false,unsubscribe=null,lastIdentity='',message='';
const call=(name,data)=>{
  const c=context();
  if(!window.FirebaseCallable||!window.FirebaseSession?.user)throw Error('Entre na sua conta para continuar.');
  return window.FirebaseCallable(name,{...data,businessId:c.businessId,workspaceGeneration:c.business?.workspaceGeneration??0});
};
const sender=window.SaleRecoveryClient.create({snapshot:()=>window.SyncFirebase.recoverySnapshot(),call,onProgress:({sent,total})=>{message=`Enviando dados… ${sent} de ${total}`;mount();}});
function modal(title,body,footer=''){
  const root=document.querySelector('#modal');if(!root)return null;
  const prior=document.activeElement;
  root.innerHTML=`<div class="modal-bg"><section class="modal-box sale-recovery-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}" tabindex="-1"><header class="modal-head"><h2>${esc(title)}</h2><button class="btn btn-light" type="button" data-recovery-close aria-label="Fechar">Fechar</button></header><div class="modal-body">${body}</div><footer class="modal-foot">${footer}</footer></section></div>`;
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
  if(busy)return;
  if(!navigator.onLine){message='Conecte-se à internet para enviar. Seus dados continuam preservados.';mount();return;}
  const panel=modal('Enviar dados para recuperação?',`<p>Serão enviados os registros das ${count} vendas retidas ao responsável pela empresa.</p><p><strong>Isso não refaz vendas, não movimenta estoque e não altera o Financeiro.</strong> Os dados originais continuarão preservados neste aparelho.</p><p data-recovery-result role="status" aria-live="polite"></p>`,`<button class="btn btn-light" type="button" data-recovery-close>Cancelar</button><button class="btn btn-primary" type="button" data-recovery-confirm>Confirmar envio</button>`);
  if(!panel)return;
  panel.querySelector('[data-recovery-confirm]').onclick=async()=>{
    if(busy)return;const session=identity();busy=true;message='Enviando dados…';mount();panel.querySelector('[data-recovery-confirm]').disabled=true;
    try{
      const result=await sender.send();
      if(identity()!==session)throw Error('A sessão mudou. Confira o recebimento na conta original.');
      message=`Dados de ${result.sent} vendas enviados. Aguardando revisão do responsável.`;
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
async function openReviews(){
  const session=identity(),spaceId=selectedSpace(),panel=modal('Vendas aguardando revisão',`<p class="sale-recovery-warning">${notice}</p><div data-recovery-list role="status">Carregando registros…</div>`,`<button class="btn btn-light" type="button" data-recovery-close>Fechar</button>`);
  if(!panel)return;
  let cursor=null,loading=false;
  async function page(){
    if(loading)return;loading=true;
    try{
      const response=await call('listSaleRecoveryReviews',{spaceId,cursor}),result=response.data??response;
      if(identity()!==session||!panel.isConnected)return;
      const list=panel.querySelector('[data-recovery-list]');
      if(!cursor)list.replaceChildren();
      for(const item of result.items){
        const article=document.createElement('article');article.className='sale-recovery-card';
        article.innerHTML=`<header><strong>${money(item.total)}</strong><span class="sale-recovery-status">Aguardando revisão</span></header><p><time>${esc(when(item.originalSaleAt))}</time> · ${esc(item.actorName)} · ${esc(item.spaceName)}</p><p>Origem: venda retida no aparelho de origem · ${esc(item.paymentMethod||'Pagamento não informado')}</p><ul>${item.items.map(i=>`<li>${esc(i.quantity)} × ${esc(i.name)}${i.variantName?` — ${esc(i.variantName)}`:''}</li>`).join('')}</ul>${item.possibleMatches.length?`<div class="sale-recovery-warning"><strong>Possível venda semelhante registrada pelo gestor</strong>${item.possibleMatches.map(m=>`<p>${esc(when(m.at))} · ${money(m.total)} · ${esc(m.paymentMethod)}<br><small>Venda ${esc(m.saleId)} · ${m.sameTotal?'mesmo valor':'valor diferente'} · ${m.samePaymentMethod?'mesmo pagamento':'pagamento diferente'}</small></p>`).join('')}</div>`:''}${item.comparisonScope?`<small>${esc(item.comparisonScope)}</small>`:''}${item.remoteEvidence.saleExists||item.remoteEvidence.operationExists||item.remoteEvidence.movementIdsPresent.length?'<p class="sale-recovery-warning">Já existem registros relacionados na nuvem. Conferência manual necessária; nenhum efeito foi aplicado por este envio.</p>':''}${item.conflictCount?'<p class="sale-recovery-warning">Foi recebido conteúdo diferente para estes IDs. O original permanece preservado para análise.</p>':''}<details><summary>Identificação do registro</summary><p>Venda: ${esc(item.saleId)}<br>Operação: ${esc(item.operationId)}</p></details>`;
        list.append(article);
      }
      if(!list.children.length)list.textContent='Nenhuma venda recebida para revisão neste contexto.';
      cursor=result.nextCursor;
      panel.querySelector('[data-recovery-more]')?.remove();
      if(cursor){const more=document.createElement('button');more.type='button';more.className='btn btn-light';more.dataset.recoveryMore='';more.textContent='Carregar mais';more.onclick=page;list.after(more);}
    }catch{if(identity()===session&&panel.isConnected)panel.querySelector('[data-recovery-list]').textContent='Não foi possível consultar os registros. Verifique sua conexão e o espaço selecionado.';}
    finally{loading=false;}
  }
  await page();
}
function mount(){
  const root=document.querySelector('#app');if(!root)return;
  const c=context(),key=identity();
  if(lastIdentity!==key){message='';lastIdentity=key;}
  let bar=root.querySelector('[data-sale-recovery-bar]');
  const ownerArea=c.role==='owner'&&['inicio','historico'].includes(location.hash.replace('#/','').split('?')[0]||'inicio');
  if(!c.businessId||!window.FirebaseSession?.user||(!count&&!ownerArea)){bar?.remove();return;}
  if(!bar){bar=document.createElement('section');bar.className='sale-recovery-banner';bar.dataset.saleRecoveryBar='';root.prepend(bar);}
  const html=`<div><strong>${count?`Há ${count} vendas aguardando análise`:'Vendas aguardando revisão'}</strong><p role="status" aria-live="polite">${esc(message||'O envio preserva os registros, sem refazer vendas ou movimentar estoque.')}</p></div><div class="sale-recovery-actions">${count?`<button type="button" class="btn btn-primary" data-send-recovery ${busy?'disabled':''}>${busy?'Enviando…':'Enviar dados para recuperação'}</button>`:''}<button type="button" class="btn btn-light" data-view-recovery>${c.role==='owner'?'Vendas aguardando revisão':'Ver situação do envio'}</button></div>`;
  if(bar.recoveryMarkup!==html){bar.recoveryMarkup=html;bar.innerHTML=html;bar.querySelector('[data-send-recovery]')?.addEventListener('click',confirmSend);bar.querySelector('[data-view-recovery]').onclick=openReviews;}
}
function refresh(){count=window.SyncFirebase?.getRetainedSaleRecoveryCount?.()||0;mount();}
function start(){unsubscribe?.();unsubscribe=window.SyncFirebase?.subscribe?.(refresh);refresh();}
addEventListener('firebase-auth-ready',start);
addEventListener('hashchange',refresh);
// Reattach to the existing panel after normal route renders, no cloud listener.
let scheduled=false;
new MutationObserver(()=>{if(scheduled)return;scheduled=true;queueMicrotask(()=>{scheduled=false;mount();});}).observe(document.querySelector('main')||document.body,{childList:true,subtree:true});
start();
