(function(){
  'use strict';
  const $=(s,r=document)=>r.querySelector(s),esc=v=>Utils.escapar(String(v??'')),money=v=>Utils.dinheiro(v);
  function shell(root,title,body,footer){
    root.innerHTML=`<div class="modal-bg viewport-modal"><section class="modal-box viewport-dialog receipt-message-dialog" role="dialog" aria-modal="true" aria-labelledby="receipt-message-title" tabindex="-1"><header class="modal-head"><h2 id="receipt-message-title">${esc(title)}</h2><button class="icon-btn" type="button" data-receipt-close aria-label="Fechar">×</button></header><div class="modal-body viewport-scroll">${body}<p data-receipt-feedback role="status" aria-live="polite" tabindex="-1"></p></div><footer class="modal-foot">${footer}</footer></section></div>`;
    const dialog=$('section',root);window.Modais?.layout?.(dialog);dialog.focus();
    dialog.onkeydown=e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();$('[data-receipt-close]',root).click();}
      if(e.key!=='Tab')return;
      const controls=[...dialog.querySelectorAll('button:not([disabled]),input:not([disabled]),textarea,select,a[href]')].filter(n=>!n.hidden),first=controls[0],last=controls.at(-1);
      if(!first)return;
      if(e.shiftKey&&(document.activeElement===first||document.activeElement===dialog)){e.preventDefault();last.focus();}
      else if(!e.shiftKey&&(document.activeElement===last||document.activeElement===dialog)){e.preventDefault();first.focus();}
    };return dialog;
  }
  function download(local,receipt){
    const confirmed=receipt?.confirmed===true,canvas=document.createElement('canvas'),ctx=canvas.getContext('2d');canvas.width=900;canvas.height=830;
    ctx.fillStyle='#fff';ctx.fillRect(0,0,900,830);ctx.fillStyle='#102e37';ctx.textAlign='center';ctx.font='bold 30px Arial';
    ctx.fillText(confirmed?receipt.businessName:'REGISTRO PROVISÓRIO',450,65);
    ctx.font='bold 24px Arial';ctx.fillStyle=confirmed?'#087c71':'#9a5700';ctx.fillText(confirmed?'RECEBIMENTO CONFIRMADO':'AGUARDANDO CONFIRMAÇÃO',450,115);
    const rows=confirmed?[['Cliente',receipt.clientName],['Valor recebido',money(receipt.amount)],['Data do pagamento',new Date(receipt.paymentDate).toLocaleString('pt-BR')],['Saldo em aberto confirmado',money(Math.max(0,-receipt.balance))],['Saldo consultado em',new Date(receipt.checkedAt).toLocaleString('pt-BR')],['Forma de pagamento',ReceiptMessages.variables(receipt).forma_pagamento],['Identificador',receipt.paymentId]]:
      [['Valor informado',typeof local.valor==='number'&&Number.isFinite(local.valor)?money(local.valor):'Não disponível neste dispositivo'],['Identificador',local.id],['Situação','Confirmação não comprovada; não comprova quitação']];
    ctx.textAlign='left';ctx.fillStyle='#263c44';ctx.font='21px Arial';rows.forEach(([label,value],i)=>{ctx.fillText(label,45,190+i*73);ctx.font='bold 21px Arial';ctx.fillText(String(value).slice(0,65),45,219+i*73);ctx.font='21px Arial';});
    if(!confirmed){ctx.fillStyle='#9a5700';ctx.font='bold 23px Arial';ctx.fillText('NÃO COMPROVA PAGAMENTO OU QUITAÇÃO.',45,600);ctx.font='19px Arial';ctx.fillText('Aguarde o recibo remoto autorizado antes de comunicar ao cliente.',45,640);}
    const a=document.createElement('a');a.download=`${confirmed?'recibo-confirmado':'registro-provisorio'}-${local.id}.png`;a.href=canvas.toDataURL('image/png');a.click();
  }
  function open(local,client,{onClose}={}){
    const token=ReceiptMessages.scope(),root=$('#modal'),identity={paymentId:String(local.id||''),operationId:String(local.operationId||local.id||''),clientId:String(client.id||local.clienteId||'')};
    let receipt=null,dialog=null,busy=false,content='',selected='',draftKind='',pendingPhone='',render=0,closed=false,controller=null,awaiting=true,lateHintUsed=false,stopHints=()=>{},lifecycle=null;
    const current=()=>{try{ReceiptMessages.assertScope(token);return !closed&&root.contains(dialog);}catch{return false;}};
    const stop=()=>{controller?.abort();stopHints();lifecycle?.disconnect();};
    const close=()=>{if(!current()){retired();return;}closed=true;stop();window.Modais?.fechar?.();onClose?.();};
    function retired(){if(closed||!root.contains(dialog))return;stop();closed=true;const neutral=shell(root,'Acesso atualizado','<p>A conta, o espaço ou suas permissões mudaram. Reabra este recebimento pelo Histórico para conferir com segurança.</p>','<button class="btn btn-light" type="button" data-receipt-dismiss>Fechar</button>');const dismiss=()=>{if(root.contains(neutral))Modais.fechar();};$('[data-receipt-close]',root).onclick=dismiss;$('[data-receipt-dismiss]',root).onclick=dismiss;}
    const feedback=(text,error=false)=>{const node=$('[data-receipt-feedback]',root);if(node&&current()){node.textContent=text;node.setAttribute('role',error?'alert':'status');node.classList.toggle('error',error);}};
    function mount(title,body,footer){if(closed)return;ReceiptMessages.assertScope(token);render++;dialog=shell(root,title,body,footer);$('[data-receipt-close]',root).onclick=close;}
    function model(){const kind=ReceiptMessages.kind(receipt),models=ReceiptMessages.list(receipt.templates).filter(t=>t.receiptKind===kind),chosen=models.find(t=>t.id===selected)||ReceiptMessages.defaultTemplate(kind,receipt.templates);if(draftKind!==kind){content='';selected='';}draftKind=kind;selected=chosen.id;if(!content)content=chosen.content;return{models,chosen};}
    function message(){model();return ReceiptMessages.resolve(content,receipt);}
    function pending(note=''){
      mount('Aguardando confirmação',`<div class="receipt-pending-notice" role="status"><span aria-hidden="true">◷</span><p>Estamos conferindo o recibo deste recebimento. Não registre outro pagamento.</p></div><p class="muted">${esc(note)}</p>`,
        '<button class="btn btn-primary" type="button" data-receipt-check>Consultar novamente</button><button class="btn btn-light" type="button" id="whatsapp-payment" disabled>Enviar pelo WhatsApp</button><div class="receipt-secondary-actions"><button class="btn btn-light" type="button" id="download-payment">Baixar provisório</button><button class="btn btn-light" type="button" data-receipt-done>Concluir</button></div>');
      $('[data-receipt-done]',root).onclick=close;$('[data-receipt-check]',root).onclick=check;$('#download-payment',root).onclick=()=>{if(current())download(local,null);};
    }
    function ready(note=''){
      if(!current()||!receipt)return;let text;try{text=message();}catch(error){pending('O recebimento foi localizado, mas o modelo precisa de revisão pelo gestor.');feedback(error.message,true);return;}
      const paymentMethod=ReceiptMessages.variables(receipt).forma_pagamento;
      mount('Pagamento recebido',`<section class="receipt-summary"><span class="receipt-confirmed-check" aria-hidden="true">✓</span><strong class="receipt-amount" data-receipt-amount>${money(receipt.amount)}</strong><h3>${esc(receipt.clientName)}</h3><dl><dt>Forma de pagamento</dt><dd>${esc(paymentMethod==='PIX'?'Pix':paymentMethod)}</dd><dt>Saldo restante</dt><dd data-receipt-balance>${money(Math.max(0,-receipt.balance))}</dd></dl></section><section class="receipt-whatsapp-preview"><small>Mensagem pronta para o cliente</small><p data-receipt-preview>${esc(text)}</p></section><button class="receipt-text-action" type="button" data-receipt-copy>Copiar mensagem</button><p class="muted receipt-read-note">Saldo conferido às ${esc(new Date(receipt.checkedAt).toLocaleTimeString('pt-BR'))}. ${esc(note)}</p>`,
        '<button class="btn btn-whatsapp receipt-primary-action" type="button" id="whatsapp-payment" data-receipt-send>Enviar pelo WhatsApp</button><div class="receipt-secondary-actions"><button class="btn btn-light" type="button" data-receipt-edit>Editar mensagem</button><button class="btn btn-light" type="button" id="download-payment">Baixar recibo</button></div><button class="receipt-text-action" type="button" data-receipt-done>Concluir</button>');
      $('[data-receipt-done]',root).onclick=close;$('[data-receipt-edit]',root).onclick=composer;$('[data-receipt-copy]',root).onclick=()=>share('copy');$('#whatsapp-payment',root).onclick=()=>share('phone');$('#download-payment',root).onclick=()=>share('download');
      if(window.AdiFestaBuild?.receiptSharingPaused===true){$('#whatsapp-payment',root).disabled=true;feedback('O compartilhamento está temporariamente pausado. O pagamento e o recibo foram preservados.');}
    }
    async function check(){
      if(!current()){retired();return false;}if(busy)return false;busy=true;controller?.abort();controller=new AbortController();const stamp=render,signal=controller.signal;
      // A canonical read never holds navigation hostage. Closing only aborts
      // this receipt query; it cannot cancel or resend the original payment.
      $('[data-receipt-check]',root).disabled=true;
      feedback('Confirmando recebimento…');
      try{
        const result=await ReceiptMessages.confirm(identity,{signal,isCurrent:()=>current()&&stamp===render,onAttempt:()=>feedback('Confirmando recebimento…')});
        if(!current()){retired();return false;}if(stamp!==render)return false;receipt=result.confirmed?result:null;awaiting=!receipt&&result.status==='awaiting_confirmation';busy=false;
        if(receipt)ready();else pending(({requires_review:'Este registro precisa de conferência. Consulte o Histórico; não registre outro pagamento.',balance_unconfirmed:'O saldo atualizado ainda não foi confirmado. Consulte novamente mais tarde.',identity_unconfirmed:'Os dados do recibo precisam de conferência pelo gestor.'})[result.status]||'A confirmação ainda não chegou. Você pode consultar novamente mais tarde.');
        return !!receipt;
      }catch(error){if(!current()){retired();return false;}if(stamp===render&&error.code!=='receipt-read-cancelled'){awaiting=['receipt-offline','receipt-read-timeout','unavailable','deadline-exceeded','network-request-failed'].includes(String(error.code||'').replace(/^functions\//,''));busy=false;pending();feedback(error.message||'Não foi possível consultar agora. O registro foi preservado.',true);}return false;}
      finally{busy=false;}
    }
    function composer(){
      if(!current()){retired();return;}if(!receipt)return;try{ReceiptMessages.assertSharing();}catch(error){ready();feedback(error.message,true);return;}
      const {models}=model(),validPhone=()=>window.PhoneUtils?.isValidBrazilianPhone?.(receipt.phone)===true;
      mount('Editar mensagem',`<p><strong>${esc(receipt.clientName)}</strong><br><span class="muted">${esc(receipt.phone||'Cliente sem WhatsApp cadastrado')}</span></p><label class="field">Modelo<select data-receipt-template>${models.map(t=>`<option value="${esc(t.id)}" ${t.id===selected?'selected':''}>${esc(t.name)}${t.isDefault?' · padrão':''}</option>`).join('')}</select></label><label class="field">Mensagem desta vez<textarea data-receipt-text rows="7" maxlength="4000">${esc(content)}</textarea><small>Editar aqui não altera o modelo da empresa.</small></label><div class="receipt-variable-buttons">${ReceiptMessages.VARIABLES.map(v=>`<button type="button" data-receipt-variable="${v}">{{${v}}}</button>`).join('')}</div><section class="receipt-whatsapp-preview"><small>Prévia no WhatsApp</small><p data-receipt-preview></p></section>${!validPhone()?`<p>Cliente sem WhatsApp cadastrado. Escolha o contato no compartilhamento do aparelho.</p><button class="btn btn-light" type="button" data-receipt-phone ${window.TeamAccess?.has?.('customers.edit')===true?'':'disabled'}>Cadastrar telefone</button>`:''}`,
        '<button class="btn btn-whatsapp receipt-primary-action" type="button" data-receipt-send>Enviar pelo WhatsApp</button><div class="receipt-secondary-actions"><button class="btn btn-light" type="button" data-receipt-copy>Copiar mensagem</button><button class="btn btn-light" type="button" data-receipt-return>Voltar</button></div>');
      const textarea=$('[data-receipt-text]',root),preview=()=>{content=textarea.value;try{$('[data-receipt-preview]',root).textContent=ReceiptMessages.resolve(content,receipt);feedback('');return true;}catch(error){$('[data-receipt-preview]',root).textContent='Revise as variáveis antes de compartilhar.';feedback(error.message,true);return false;}};
      textarea.oninput=preview;$('[data-receipt-template]',root).onchange=e=>{selected=e.target.value;content=models.find(t=>t.id===selected).content;textarea.value=content;preview();};
      for(const button of root.querySelectorAll('[data-receipt-variable]'))button.onclick=()=>{textarea.setRangeText('{{'+button.dataset.receiptVariable+'}}',textarea.selectionStart,textarea.selectionEnd,'end');textarea.focus();preview();};
      $('[data-receipt-return]',root).onclick=()=>{if(preview())ready();};$('[data-receipt-send]',root).onclick=()=>{if(preview())share('phone');};if(!validPhone())$('[data-receipt-send]',root).setAttribute('data-receipt-native','');$('[data-receipt-copy]',root).onclick=()=>{if(preview())share('copy');};$('[data-receipt-phone]',root)?.addEventListener('click',phoneForm);preview();
    }
    const fingerprint=r=>JSON.stringify([r.amount,r.balance,r.financialVersion,r.phone,r.clientName,r.businessName,r.paymentMethod,r.paymentDate]);
    async function share(mode){
      if(!current()){retired();return;}if(busy||!receipt)return;try{if(mode!=='download')ReceiptMessages.assertSharing();message();}catch(error){feedback(error.message,true);return;}
      busy=true;controller?.abort();controller=new AbortController();const stamp=render,before=receipt,signal=controller.signal;for(const button of root.querySelectorAll('footer button'))button.disabled=true;feedback('Conferindo os dados do recibo…');
      try{
        const fresh=await ReceiptMessages.confirm(identity,{signal,isCurrent:()=>current()&&stamp===render});if(!current()){retired();return;}if(stamp!==render)return;
        if(!fresh.confirmed){receipt=null;pending('A confirmação precisa ser consultada novamente. Não registre outro pagamento.');return;}
        receipt=fresh;
        if(mode==='download'){download(local,fresh);feedback('Recibo confirmado preparado para download.');return;}
        const localClient=window.Clientes?.obter?.(identity.clientId),normalize=window.PhoneUtils.normalizeBrazilianPhone;
        if(pendingPhone&&normalize(fresh.phone)!==pendingPhone||localClient&&normalize(localClient.telefone)!==normalize(fresh.phone)){feedback('O telefone alterado ainda aguarda confirmação. Aguarde a atualização do cadastro.',true);return;}pendingPhone='';
        if(fingerprint(before)!==fingerprint(fresh)){ready('Os dados mudaram. Revise a mensagem e toque novamente para continuar.');return;}
        const text=message();
        if(mode==='copy'){
          try{await navigator.clipboard.writeText(text);if(current())feedback('Mensagem copiada. Cole na conversa desejada.');}
          catch{if(current())feedback('Não foi possível copiar automaticamente. Selecione a mensagem da prévia para copiar.',true);}
        }else if(window.PhoneUtils.isValidBrazilianPhone(fresh.phone)){
          const url='https://wa.me/'+normalize(fresh.phone)+'?text='+encodeURIComponent(text),opened=window.Mensagens?.openWhatsApp?.(url,{mobile:window.matchMedia?.('(max-width:767px)')?.matches===true});
          if(!window.Mensagens?.openWhatsApp){const popup=window.open(url,'_blank','noopener,noreferrer');if(current()){feedback('Abertura solicitada ao WhatsApp. A VECONI não confirma o envio.');if(!popup)fallbackWeb(url);}}
          else if(current()){feedback('Abertura solicitada ao WhatsApp. A VECONI não confirma o envio.');if(!opened?.opened)fallbackWeb(url);}
        }else if(typeof navigator.share==='function'){
          await navigator.share({title:'Recebimento',text});if(current())feedback('Compartilhamento aberto. Escolha o contato; o envio depende do aplicativo escolhido.');
        }else if(current()){feedback('Copie a mensagem e escolha a conversa no WhatsApp Web.');fallbackWeb('https://web.whatsapp.com/');}
      }catch(error){if(!current()){retired();return;}if(stamp===render)feedback(error.name==='AbortError'?'Compartilhamento cancelado. O recebimento não foi alterado.':error.message||'Não foi possível confirmar agora. Tente novamente.',error.name!=='AbortError');}
      finally{busy=false;if(current()&&stamp===render)for(const button of root.querySelectorAll('footer button'))button.disabled=false;}
    }
    function fallbackWeb(url){const node=$('[data-receipt-feedback]',root),link=document.createElement('a'),created=Date.now();link.className='btn btn-light';link.textContent=url.includes('wa.me')?'Abrir conversa no WhatsApp':'Abrir WhatsApp Web';link.href=url;link.target='_blank';link.rel='noopener noreferrer';link.onclick=e=>{if(!current()||Date.now()-created>15000){e.preventDefault();link.remove();feedback('Consulte novamente antes de abrir a mensagem.');}};node.append(document.createElement('br'),link);}
    function phoneForm(){
      if(!current()||window.TeamAccess?.has?.('customers.edit')!==true)return;
      mount('Cadastrar telefone','<form data-receipt-phone-form><label class="field">Telefone com DDD<input name="phone" type="tel" inputmode="tel" autocomplete="tel" required></label><p>Somente o telefone será alterado. O recebimento permanece intacto.</p><button class="btn btn-primary" type="submit">Salvar telefone</button></form>','<button class="btn btn-light" type="button" data-receipt-return>Voltar</button>');$('[data-receipt-return]',root).onclick=composer;
      $('[data-receipt-phone-form]',root).onsubmit=async e=>{
        e.preventDefault();if(!current()||busy)return;const session=window.TeamAccess.captureSession(),phone=new FormData(e.target).get('phone');
        try{window.TeamAccess.assert('customers.edit');window.TeamAccess.assertSession(session);if(!window.PhoneUtils.isValidBrazilianPhone(phone))throw Error('Informe um telefone válido com DDD.');busy=true;
          DB.alterar(data=>{window.TeamAccess.assertSession(session);const normalizedPhone=window.PhoneUtils.normalizeBrazilianPhone(phone),c=data.clientes.find(x=>x.id===identity.clientId);if(!c)throw Error('Cliente não encontrado.');if(data.clientes.some(x=>x.id!==c.id&&window.PhoneUtils.normalizeBrazilianPhone(x.normalizedPhone||x.telefone)===normalizedPhone))throw Error('Este telefone já pertence a outro cliente.');Object.assign(c,{telefone:phone,normalizedPhone,atualizadoEm:new Date().toISOString()});});pendingPhone=window.PhoneUtils.normalizeBrazilianPhone(phone);
          await DB.flush?.();if(current())feedback('Telefone salvo neste aparelho. Aguarde a confirmação do cadastro antes de compartilhar.');
        }catch(error){if(current())feedback(error.message,true);}finally{busy=false;}
      };
    }
    pending();
    // One late, matching Sync transition can resume reads after the initial
    // bounded window. Repeated/global events cannot create a polling loop.
    if(window.AdiFestaBuild?.receiptSyncHintsPaused!==true)stopHints=ReceiptMessages.observeConfirmation(identity,()=>{if(current()&&!busy&&!receipt&&awaiting&&!lateHintUsed){lateHintUsed=true;check();}});
    lifecycle=new MutationObserver(()=>{if(!root.contains(dialog)){closed=true;stop();}});lifecycle.observe(root,{childList:true,subtree:true});
    check();return{close};
  }
  function editor(id,{onSaved}={}){
    const root=$('#modal'),token=ReceiptMessages.scope(),original=ReceiptMessages.list().find(t=>t.id===id),base=original||{name:'',receiptKind:'partial',content:ReceiptMessages.DEFAULTS[0].content,isDefault:false};
    let dialog,closed=false,busy=false;
    const current=()=>!closed&&token===ReceiptMessages.scope()&&root.contains(dialog)&&ReceiptMessages.canManage();
    const sample=kind=>({confirmed:true,amount:50,balance:kind==='total'?0:-164,clientName:'Ana Exemplo',businessName:'Empresa de exemplo',paymentDate:'2026-10-30T12:00:00Z',paymentMethod:'pix'});
    if(!ReceiptMessages.canManage())throw Error('Somente o gestor autorizado pode editar os modelos corporativos.');
    dialog=shell(root,original?'Editar modelo de recebimento':'Novo modelo de recebimento',`<p>Modelo exclusivo desta empresa. Usado somente após confirmação remota, nunca em disparos em massa.</p><label class="field">Nome do modelo<input data-receipt-model-name maxlength="80" value="${esc(base.name)}"></label><label class="field">Situação<select data-receipt-model-kind><option value="partial">Pagamento parcial / saldo em aberto</option><option value="total">Pagamento total / saldo quitado</option></select></label><label class="field">Mensagem<textarea data-receipt-model-content rows="8" maxlength="4000">${esc(base.content)}</textarea></label><div class="receipt-variable-buttons">${ReceiptMessages.VARIABLES.map(v=>`<button type="button" data-receipt-variable="${v}">{{${v}}}</button>`).join('')}</div><label class="receipt-default-choice"><input type="checkbox" data-receipt-model-default ${base.isDefault?'checked':''}> Modelo padrão para esta situação</label><section class="receipt-whatsapp-preview"><small>Prévia com dados fictícios</small><p data-receipt-model-preview></p></section>`,
      `<button class="btn btn-light" type="button" data-receipt-editor-cancel>Cancelar</button>${original&&ReceiptMessages.DEFAULTS.some(t=>t.id===id)?'<button class="btn btn-light" type="button" data-receipt-restore>Restaurar original</button>':''}<button class="btn btn-primary" type="button" data-receipt-model-save>Salvar modelo</button>`);
    const close=()=>{closed=true;Modais.fechar();};$('[data-receipt-close]',root).onclick=close;$('[data-receipt-editor-cancel]',root).onclick=close;
    const textarea=$('[data-receipt-model-content]',root),kind=$('[data-receipt-model-kind]',root),feedback=text=>{$('[data-receipt-feedback]',root).textContent=text;};kind.value=base.receiptKind;kind.disabled=ReceiptMessages.DEFAULTS.some(t=>t.id===id);
    const preview=()=>{try{$('[data-receipt-model-preview]',root).textContent=ReceiptMessages.resolve(textarea.value,sample(kind.value));feedback('');}catch(e){$('[data-receipt-model-preview]',root).textContent='Revise a mensagem.';feedback(e.message);}};
    textarea.oninput=preview;kind.onchange=preview;
    for(const b of root.querySelectorAll('[data-receipt-variable]'))b.onclick=()=>{textarea.setRangeText('{{'+b.dataset.receiptVariable+'}}',textarea.selectionStart,textarea.selectionEnd,'end');textarea.focus();preview();};
    $('[data-receipt-restore]',root)?.addEventListener('click',()=>{textarea.value=ReceiptMessages.DEFAULTS.find(t=>t.id===id).content;preview();feedback('Original restaurado na prévia. Salve para aplicar à empresa.');});
    $('[data-receipt-model-save]',root).onclick=async()=>{
      if(!current()||busy)return;busy=true;const button=$('[data-receipt-model-save]',root);button.disabled=true;
      try{ReceiptMessages.save({id:original?.id,name:$('[data-receipt-model-name]',root).value,receiptKind:kind.value,content:textarea.value,isDefault:$('[data-receipt-model-default]',root).checked});await DB.flush?.();if(current()){feedback('Modelo salvo neste aparelho. A sincronização das configurações disponibilizará o modelo nos outros dispositivos autorizados.');onSaved?.();}}
      catch(e){if(current())feedback(e.message||'Não foi possível salvar o modelo. O texto foi preservado.');}
      finally{busy=false;button.disabled=false;}
    };preview();return{close};
  }
  function openExisting(paymentId,clientId,{operationId='',onClose}={}){
    if(!ReceiptMessages.canUse())throw Error('Seu acesso não permite consultar recebimentos.');
    const payment=(DB.carregar().pagamentos||[]).find(p=>p.id===paymentId),id=payment?.clienteId||payment?.customerId||payment?.clientId;
    if(!paymentId||!clientId||payment&&(id!==clientId||payment.businessId&&payment.businessId!==DB.getBusinessId()||payment.workspaceGeneration!==undefined&&payment.workspaceGeneration!==(DB.getWorkspaceGeneration?.()??0)||operationId&&payment.operationId&&payment.operationId!==operationId))throw Error('Este recebimento não corresponde à empresa, geração, cliente ou operação deste histórico.');
    // History already carries the identifiers. Missing local hydration is not
    // missing canonical evidence: the unchanged authenticated reader checks all
    // documents and permissions. No cache write or speculative amount/balance.
    const original=payment?{...payment,operationId:payment.operationId||operationId||paymentId}:{id:paymentId,operationId:operationId||paymentId,clienteId:clientId},client=window.Clientes?.obter?.(clientId)||{id:clientId};
    return open(original,client,{onClose:onClose||(()=>window.CRMClienteUI?.open?.(clientId))});
  }
  document.addEventListener('click',event=>{const button=event.target.closest?.('[data-receipt-open]');if(!button)return;event.preventDefault();try{openExisting(button.dataset.receiptOpen,button.dataset.receiptClient,{operationId:button.dataset.receiptOperation||''});}catch(error){Utils.toast(error.message,true);}});
  window.ReceiptMessageUI=Object.freeze({open,openExisting,editor,download});
})();
