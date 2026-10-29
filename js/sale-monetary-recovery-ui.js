(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.SaleMonetaryRecoveryUI=api;})(typeof window==='undefined'?globalThis:window,function(){
 'use strict';
 function open({document,call,identity,target,onResolved=()=>{}}){
  const origin=JSON.stringify(identity()),focus=document.activeElement;let busy=false,uncertain=false,preview=null,closed=false;
  const current=()=>!closed&&origin===JSON.stringify(identity());
  const bg=document.createElement('div');bg.className='modal-bg monetary-recovery-dialog';
  const dialog=document.createElement('section');dialog.className='modal-box';dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label','Revisar regularização da venda');bg.append(dialog);
  const header=document.createElement('header');header.className='modal-head';const title=document.createElement('h2');title.textContent='Revisar regularização';header.append(title);
  const body=document.createElement('div');body.className='modal-body';const message=document.createElement('p');message.setAttribute('role','status');message.setAttribute('aria-live','polite');body.append(message);
  const footer=document.createElement('footer');footer.className='modal-footer';const close=document.createElement('button'),confirm=document.createElement('button');close.type=confirm.type='button';close.textContent='Voltar às análises';confirm.textContent='Conferindo…';confirm.disabled=true;footer.append(close,confirm);dialog.append(header,body,footer);document.body.append(bg);
  const context=()=>({...identity(),intakeKind:'monetary_analysis_v1',saleId:target.saleId,operationId:target.operationId,contentHash:target.contentHash});
  const currency=c=>(c/100).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const end=()=>{if(busy)return;closed=true;bg.remove();document.removeEventListener('keydown',key);if(focus?.isConnected&&origin===JSON.stringify(identity()))focus.focus();};
  const key=e=>{if(!current()){closed=true;bg.remove();document.removeEventListener('keydown',key);return;}if(e.key==='Escape'){e.preventDefault();end();}if(e.key==='Tab'){const nodes=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled])')],first=nodes[0],last=nodes.at(-1);if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}};
  document.addEventListener('keydown',key);close.onclick=end;
  const post=async(name,data)=>{if(!current())throw Error('A sessão mudou. Nenhuma confirmação local será aplicada.');const response=await call(name,data);if(!current())throw Error('A sessão mudou. Consulte o resultado na conta de origem.');return response.data??response;};
  async function read(){if(busy||!current())return;busy=true;confirm.disabled=close.disabled=true;message.textContent='Conferindo originais e efeitos na nuvem…';
   try{const r=await post('listSaleRecoveryReviews',{...context(),recoveryPreview:true});preview=r;body.querySelectorAll('[data-recovery-detail]').forEach(n=>n.remove());
    if(r.status==='recovered'&&r.commercialReceiptConfirmed===true){message.textContent='Venda e recibo confirmados na nuvem. Não houve nova cobrança.';confirm.hidden=true;onResolved(r);return;}
    const summary=document.createElement('p');summary.dataset.recoveryDetail='';summary.textContent=`Venda ${target.saleId.slice(0,8)} · ${currency(r.totalCents)} · ${r.paymentMethod}. O valor cobrado será preservado. O estoque atual será atualizado somente pelos itens originais.`;body.append(summary);
    const list=document.createElement('ul');list.dataset.recoveryDetail='';for(const line of r.lines||[]){const li=document.createElement('li');const unit=line.unit4===undefined?'':` · preço original ${(line.unit4/10000).toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:4})}`;li.textContent=`${line.quantity} × ${line.name||line.productId}${unit}: ${currency(line.totalCents)}`;list.append(li);}body.append(list);
    const rounding=document.createElement('p');rounding.dataset.recoveryDetail='';rounding.textContent='Os preços originais são preservados com até quatro casas decimais. O arredondamento é distribuído entre os itens para manter exatamente o total cobrado.';body.append(rounding);
    const label=document.createElement('label');label.dataset.recoveryDetail='';const ack=document.createElement('input');ack.type='checkbox';ack.dataset.ownerAttestation='';label.append(ack,document.createTextNode('Confirmo como proprietário: produtos entregues, pagamento já recebido e venda não registrada novamente. Esta ação não cobra o cliente.'));body.append(label);ack.onchange=()=>{confirm.disabled=!ack.checked||!r.recoveryEnabled;};
    uncertain=false;confirm.textContent='Recuperar esta venda';message.textContent=r.recoveryEnabled?'Confira os itens e confirme a declaração para autorizar somente esta venda.':'Execução pausada. A análise está disponível; nenhum efeito será aplicado.';
   }catch(error){if(current()){message.setAttribute('role','alert');message.textContent=error.message||'Não foi possível conferir. Dados preservados.';confirm.textContent='Consultar decisão';uncertain=true;confirm.disabled=false;}}
   finally{busy=false;close.disabled=false;if(current())close.focus();else{closed=true;bg.remove();document.removeEventListener('keydown',key);}}
  }
  confirm.onclick=async()=>{if(busy||!current())return;if(uncertain)return read();const ack=body.querySelector('[data-owner-attestation]');if(!preview?.recoveryEnabled||!ack?.checked)return;
   busy=true;confirm.disabled=close.disabled=true;message.textContent='Confirmando esta decisão. Não repita em outra janela.';
   try{await post('decideSaleRecovery',{...context(),confirmation:'RECUPERAR_VALOR_ORIGINAL',previewHash:preview.previewHash,operationalEvidence:{goodsDelivered:true,paymentReceived:true,notRecreated:true}});uncertain=true;}
   catch(error){if(current()){message.setAttribute('role','alert');message.textContent=(error.message||'Resposta não confirmada.')+' Consulte a decisão; nenhuma retentativa comercial será feita automaticamente.';}uncertain=true;}
   finally{busy=false;close.disabled=false;confirm.disabled=false;confirm.textContent='Consultar decisão';}
   // A lost answer is resolved only by a new read, never an automatic replay.
   if(current())await read();else{closed=true;bg.remove();document.removeEventListener('keydown',key);}
  };
  void read();return{close:end,element:bg};
 }
 return{open};
});
