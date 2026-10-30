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
      [['Valor informado',money(local.valor)],['Identificador',local.id],['Situação','Registro local; confirmação não comprovada']];
    ctx.textAlign='left';ctx.fillStyle='#263c44';ctx.font='21px Arial';rows.forEach(([label,value],i)=>{ctx.fillText(label,45,190+i*73);ctx.font='bold 21px Arial';ctx.fillText(String(value).slice(0,65),45,219+i*73);ctx.font='21px Arial';});
    if(!confirmed){ctx.fillStyle='#9a5700';ctx.font='bold 23px Arial';ctx.fillText('NÃO COMPROVA PAGAMENTO OU QUITAÇÃO.',45,600);ctx.font='19px Arial';ctx.fillText('Aguarde o recibo remoto autorizado antes de comunicar ao cliente.',45,640);}
    const a=document.createElement('a');a.download=`${confirmed?'recibo-confirmado':'registro-provisorio'}-${local.id}.png`;a.href=canvas.toDataURL('image/png');a.click();
  }
  function open(local,client,{onClose}={}){
    const token=ReceiptMessages.scope(),root=$('#modal'),identity={paymentId:String(local.id||''),operationId:String(local.operationId||local.id||''),clientId:String(client.id||local.clienteId||'')};
    let receipt=null,dialog=null,busy=false,content='',selected='',pendingPhone='',render=0,closed=false;
    const current=()=>{try{ReceiptMessages.assertScope(token);return !closed&&root.contains(dialog);}catch{return false;}};
    const close=()=>{if(!current())return;closed=true;window.Modais?.fechar?.();onClose?.();};
    const feedback=(text,error=false)=>{const node=$('[data-receipt-feedback]',root);if(node&&current()){node.textContent=text;node.setAttribute('role',error?'alert':'status');node.classList.toggle('error',error);}};
    function mount(title,body,footer){if(closed)return;ReceiptMessages.assertScope(token);render++;dialog=shell(root,title,body,footer);$('[data-receipt-close]',root).onclick=close;}
    function paintStatus(note=''){
      const confirmed=receipt?.confirmed===true;
      mount(confirmed?'Recebimento confirmado':'Aguardando confirmação',`<div class="receipt-confirmation-state ${confirmed?'is-confirmed':'is-pending'}"><span aria-hidden="true">${confirmed?'✓':'◷'}</span><h3>${confirmed?money(receipt.amount)+' confirmado':'O registro foi preservado'}</h3><p>${confirmed?'O recibo autorizado foi verificado. Você pode preparar a mensagem ao cliente.':'O recebimento ainda não foi confirmado nesta consulta. Não registre outro pagamento.'}</p></div>${confirmed?`<dl class="receipt-confirmed-facts"><dt>Cliente</dt><dd>${esc(receipt.clientName)}</dd><dt>Saldo em aberto</dt><dd>${money(Math.max(0,-receipt.balance))}</dd><dt>Conferido em</dt><dd>${esc(new Date(receipt.checkedAt).toLocaleString('pt-BR'))}</dd></dl>`:''}<p class="muted">${esc(note)}</p>`,
        `<button class="btn btn-light" type="button" data-receipt-check>Consultar confirmação</button><button class="btn btn-light" type="button" id="download-payment">${confirmed?'Baixar recibo confirmado':'Baixar registro provisório'}</button><button class="btn btn-whatsapp" type="button" id="whatsapp-payment" ${confirmed?'':'disabled'}>WhatsApp</button><button class="btn btn-light" type="button" data-receipt-done>Concluir</button>`);
      $('[data-receipt-done]',root).onclick=close;
      $('[data-receipt-check]',root).onclick=()=>check();
      $('#whatsapp-payment',root).onclick=async()=>{if(await check(true))composer();};
      $('#download-payment',root).onclick=async()=>{if(!current()||busy)return;if(!receipt)return download(local,null);if(await check(true))download(local,receipt);};
    }
    async function check(quiet=false){
      if(!current()||busy)return false;busy=true;receipt=null;const stamp=render;
      for(const button of root.querySelectorAll('button:not([data-receipt-close])'))button.disabled=true;
      feedback('Consultando o recibo e o saldo na nuvem…');
      try{
        const result=await ReceiptMessages.read(identity);if(!current()||stamp!==render)return false;
        receipt=result.confirmed?result:null;busy=false;
        paintStatus(result.status==='requires_review'?'Este registro exige conferência em Sincronização. Não registre outro pagamento.':!receipt?'A consulta não confirmou o recebimento e o saldo. Você pode consultar novamente, sem reenviar operações.':'');
        return !!receipt;
      }catch(error){if(current()&&stamp===render){busy=false;paintStatus();feedback(error.message||'Não foi possível consultar a confirmação. Tente novamente.',true);}return false;}
      finally{busy=false;}
    }
    function composer(){
      if(!current()||!receipt)return;
      try{ReceiptMessages.assertSharing();}catch(error){paintStatus(error.message);return;}
      const kind=ReceiptMessages.kind(receipt),models=ReceiptMessages.list(receipt.templates).filter(t=>t.receiptKind===kind),chosen=models.find(t=>t.id===selected)||ReceiptMessages.defaultTemplate(kind,receipt.templates);
      selected=chosen.id;if(!content)content=chosen.content;
      const validPhone=()=>window.PhoneUtils?.isValidBrazilianPhone?.(receipt.phone)===true;
      mount('Mensagem de recebimento',`<p><strong>${esc(receipt.clientName)}</strong><br><span class="muted">${esc(receipt.phone||'Cliente sem WhatsApp cadastrado')}</span></p><label class="field">Modelo<select data-receipt-template>${models.map(t=>`<option value="${esc(t.id)}" ${t.id===selected?'selected':''}>${esc(t.name)}${t.isDefault?' · padrão':''}</option>`).join('')}</select></label><label class="field">Mensagem desta vez<textarea data-receipt-text rows="8" maxlength="4000">${esc(content)}</textarea><small>Editar aqui não altera o modelo da empresa.</small></label><div class="receipt-variable-buttons">${ReceiptMessages.VARIABLES.map(v=>`<button type="button" data-receipt-variable="${v}">{{${v}}}</button>`).join('')}</div><section class="receipt-whatsapp-preview" aria-label="Prévia da mensagem"><small>Prévia no WhatsApp</small><p data-receipt-preview></p></section>${!validPhone()?`<p>Cliente sem WhatsApp cadastrado. Escolha um contato no compartilhamento do aparelho ou cadastre o telefone.</p><button class="btn btn-light" type="button" data-receipt-phone ${window.TeamAccess?.has?.('customers.edit')===true?'':'disabled'}>Cadastrar telefone</button>`:''}`,
        `<button class="btn btn-light" type="button" data-receipt-return>Voltar</button>${validPhone()?'<button class="btn btn-whatsapp" type="button" data-receipt-send>Abrir no WhatsApp</button>':'<button class="btn btn-whatsapp" type="button" data-receipt-native>Compartilhar no aparelho</button><button class="btn btn-light" type="button" data-receipt-copy>Copiar mensagem</button>'}`);
      const textarea=$('[data-receipt-text]',root),preview=()=>{
        content=textarea.value;try{$('[data-receipt-preview]',root).textContent=ReceiptMessages.resolve(content,receipt);feedback('');return true;}catch(e){$('[data-receipt-preview]',root).textContent='Revise as variáveis antes de compartilhar.';feedback(e.message,true);return false;}
      };
      textarea.oninput=preview;
      $('[data-receipt-template]',root).onchange=e=>{selected=e.target.value;content=models.find(t=>t.id===selected).content;textarea.value=content;preview();};
      for(const button of root.querySelectorAll('[data-receipt-variable]'))button.onclick=()=>{const start=textarea.selectionStart,end=textarea.selectionEnd;textarea.setRangeText('{{'+button.dataset.receiptVariable+'}}',start,end,'end');textarea.focus();preview();};
      $('[data-receipt-return]',root).onclick=()=>paintStatus();
      const fingerprint=r=>JSON.stringify([r.amount,r.balance,r.financialVersion,r.phone,r.clientName,r.businessName,r.paymentMethod,r.paymentDate]);
      async function share(mode){
        if(!current()||busy||!preview())return;busy=true;const stamp=render,before=receipt;
        for(const button of root.querySelectorAll('footer button'))button.disabled=true;feedback('Conferindo o recibo e o saldo antes de compartilhar…');
        try{
          ReceiptMessages.assertSharing();
          const fresh=await ReceiptMessages.read(identity);if(!current()||stamp!==render)return;
          if(!fresh.confirmed){receipt=null;paintStatus('A confirmação precisa ser consultada novamente antes do compartilhamento.');return;}
          receipt=fresh;
          if(pendingPhone&&window.PhoneUtils.normalizeBrazilianPhone(fresh.phone)!==pendingPhone){feedback('O telefone alterado ainda aguarda confirmação. Consulte novamente antes de compartilhar.',true);return;}
          const localClient=window.Clientes?.obter?.(identity.clientId);
          if(localClient&&window.PhoneUtils.normalizeBrazilianPhone(localClient.telefone)!==window.PhoneUtils.normalizeBrazilianPhone(fresh.phone)){feedback('O telefone do cadastro local difere do confirmado. Aguarde a atualização do cadastro antes de compartilhar.',true);return;}
          pendingPhone='';
          if(fingerprint(before)!==fingerprint(fresh)){
            if(ReceiptMessages.kind(before)!==ReceiptMessages.kind(fresh)){selected='';content='';}
            composer();feedback('O saldo ou os dados do cliente mudaram. Revise a nova prévia e confirme novamente.');return;
          }
          const message=ReceiptMessages.resolve(content,fresh);
          if(mode==='copy'){
            try{await navigator.clipboard.writeText(message);if(current())feedback('Mensagem copiada. Cole na conversa desejada.');}
            catch{if(current()){const p=$('[data-receipt-preview]',root);const range=document.createRange();range.selectNodeContents(p);getSelection().removeAllRanges();getSelection().addRange(range);feedback('Selecione e copie a mensagem da prévia.');}}
          }else if(mode==='native'){
            if(typeof navigator.share==='function'){await navigator.share({title:'Recebimento',text:message});if(current())feedback('Compartilhamento aberto. O envio depende do aplicativo escolhido.');}
            else if(current())fallbackWeb(message);
          }else{
            if(!window.PhoneUtils?.isValidBrazilianPhone?.(fresh.phone))throw Error('O telefone confirmado não é válido. Confira o cadastro.');
            const url='https://wa.me/'+window.PhoneUtils.normalizeBrazilianPhone(fresh.phone)+'?text='+encodeURIComponent(message),opened=window.open(url,'_blank','noopener,noreferrer');
            if(current()){feedback('Abertura solicitada ao WhatsApp. A VECONI não confirma o envio da mensagem.');if(!opened)fallbackWeb(message,url);}
          }
        }catch(e){if(current()&&stamp===render)feedback(e.name==='AbortError'?'Compartilhamento cancelado. O recebimento não foi alterado.':e.message||'Não foi possível confirmar o compartilhamento. Consulte novamente.',e.name!=='AbortError');}
        finally{busy=false;if(current()&&stamp===render)for(const button of root.querySelectorAll('footer button'))button.disabled=false;}
      }
      function fallbackWeb(message,url='https://web.whatsapp.com/'){
        feedback('Se o WhatsApp não abriu, use o link abaixo. O envio é confirmado por você no WhatsApp.');
        const link=document.createElement('a');link.className='btn btn-light';link.textContent=url.includes('wa.me')?'Abrir conversa no WhatsApp':'Abrir WhatsApp Web';link.href=url;link.target='_blank';link.rel='noopener noreferrer';const created=Date.now();
        link.onclick=e=>{if(!current()||Date.now()-created>15000){e.preventDefault();link.remove();feedback('Consulte novamente antes de abrir a mensagem.');}};
        $('[data-receipt-feedback]',root).append(document.createElement('br'),link);
      }
      $('[data-receipt-send]',root)?.addEventListener('click',()=>share('phone'));
      $('[data-receipt-native]',root)?.addEventListener('click',()=>share('native'));
      $('[data-receipt-copy]',root)?.addEventListener('click',()=>share('copy'));
      $('[data-receipt-phone]',root)?.addEventListener('click',phoneForm);preview();
    }
    function phoneForm(){
      if(!current()||window.TeamAccess?.has?.('customers.edit')!==true)return;
      mount('Cadastrar telefone',`<form data-receipt-phone-form><label class="field">Telefone com DDD<input name="phone" type="tel" inputmode="tel" autocomplete="tel" required></label><p>Somente o telefone será alterado. O recebimento permanece intacto.</p><button class="btn btn-primary" type="submit">Salvar telefone</button></form>`,`<button class="btn btn-light" type="button" data-receipt-return>Voltar</button>`);
      $('[data-receipt-return]',root).onclick=composer;
      $('[data-receipt-phone-form]',root).onsubmit=async e=>{
        e.preventDefault();if(!current()||busy)return;const session=window.TeamAccess.captureSession(),phone=new FormData(e.target).get('phone');
        try{
          window.TeamAccess.assert('customers.edit');window.TeamAccess.assertSession(session);
          if(!window.PhoneUtils.isValidBrazilianPhone(phone))throw Error('Informe um telefone válido com DDD.');
          busy=true;DB.alterar(data=>{window.TeamAccess.assertSession(session);const normalizedPhone=window.PhoneUtils.normalizeBrazilianPhone(phone),c=data.clientes.find(x=>x.id===identity.clientId);if(!c)throw Error('Cliente não encontrado.');if(data.clientes.some(x=>x.id!==c.id&&window.PhoneUtils.normalizeBrazilianPhone(x.normalizedPhone||x.telefone)===normalizedPhone))throw Error('Este telefone já pertence a outro cliente.');Object.assign(c,{telefone:phone,normalizedPhone,atualizadoEm:new Date().toISOString()});});pendingPhone=window.PhoneUtils.normalizeBrazilianPhone(phone);
          await DB.flush?.();if(current())feedback('Telefone salvo neste aparelho. Aguarde a confirmação do cadastro e volte à mensagem.');
        }catch(error){if(current())feedback(error.message,true);}finally{busy=false;}
      };
    }
    paintStatus();check();return{close};
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
  function openExisting(paymentId,clientId){
    if(!ReceiptMessages.canUse())throw Error('Seu acesso não permite consultar recebimentos.');
    const payment=(DB.carregar().pagamentos||[]).find(p=>p.id===paymentId),id=payment?.clienteId||payment?.customerId;
    if(!payment||id!==clientId||payment.businessId&&payment.businessId!==DB.getBusinessId())throw Error('Este recebimento não foi encontrado no histórico desta empresa e cliente.');
    const client=window.Clientes?.obter?.(clientId);if(!client)throw Error('Cliente não encontrado neste dispositivo.');
    return open(payment,client,{onClose:()=>window.CRMClienteUI?.open?.(clientId)});
  }
  document.addEventListener('click',event=>{const button=event.target.closest?.('[data-receipt-open]');if(!button)return;event.preventDefault();try{openExisting(button.dataset.receiptOpen,button.dataset.receiptClient);}catch(error){Utils.toast(error.message,true);}});
  window.ReceiptMessageUI=Object.freeze({open,openExisting,editor,download});
})();
