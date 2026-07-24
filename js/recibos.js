window.Modais=(()=>{
  const root=()=>document.querySelector('#modal');
  const fechar=()=>root().innerHTML='';
  const confirmar=(nome,acao)=>{
    root().innerHTML=`<div class="modal-bg"><section class="modal-box"><header class="modal-head"><h3>Excluir ${nome}</h3><button class="icon-btn close"><i data-lucide="x"></i></button></header><div class="modal-body confirm-copy"><div class="confirm-icon"><i data-lucide="triangle-alert"></i></div><h3>Tem certeza que deseja excluir este item?</h3><p class="muted">Essa ação não poderá ser desfeita.</p></div><footer class="modal-foot"><button class="btn btn-light cancel">Cancelar</button><button class="btn btn-danger yes">Excluir</button></footer></section></div>`;
    root().querySelectorAll('.close,.cancel').forEach(button=>button.onclick=fechar);
    root().querySelector('.yes').onclick=()=>{acao();fechar()};
    window.lucide?.createIcons();
  };
  return{fechar,confirmar};
})();

(function(){
  'use strict';
  const {dinheiro,escapar}=Utils;
  const value=sale=>Number(sale?.valorFinal??sale?.valorTotal??0);
  const unitPrice=item=>Number(item?.precoFinalUnitario??item?.precoUnitario??0);
  const debt=balance=>Math.abs(Math.min(0,Number(balance||0)));
  const isMobile=()=>matchMedia('(max-width:767px)').matches;
  const paymentLabels={pix:'Pix',dinheiro:'Dinheiro',cartao:'Cartão',credito:'Cartão de crédito',debito:'Cartão de débito',entrega:'Pago na entrega',pago:'Pago',fiado:'Fiado'};
  let active=null;

  function currentBusiness(){
    const local=DB.carregar().config||{},cloud=window.FirebaseSession?.business||{};
    return{
      name:cloud.receiptName||cloud.name||local.receiptName||local.nome||'Adi Festa',
      receiptName:cloud.receiptName||local.receiptName||'',
      phone:cloud.phone||local.telefone||'',
      primaryColor:cloud.primaryColor||local.primaryColor||'#31d0ad'
    };
  }
  function paymentLabel(sale){
    const method=String(sale?.formaPagamento||'').toLowerCase();
    return sale?.status==='fiado'?'Fiado':paymentLabels[method]||'Pago';
  }
  function publicSaleNumber(sale){
    if(sale?.publicOrderNumber)return String(sale.publicOrderNumber).replace(/^#/,'');
    const compact=String(sale?.id||sale?.operationId||Date.now()).replace(/[^a-z0-9]/gi,'').toUpperCase();
    return compact.slice(-6).padStart(6,'0');
  }
  function normalizeSalePhone(input){
    let digits=String(input||'').replace(/\D/g,'');
    if(digits.startsWith('00'))digits=digits.slice(2);
    if(!digits.startsWith('55')&&(digits.length===10||digits.length===11))digits=`55${digits}`;
    return /^55[1-9]{2}\d{8,9}$/.test(digits)?digits:'';
  }
  function buildSaleShareMessage({business={},customer={},sale={},balanceBefore,balanceAfter}={}){
    const businessName=business.receiptName||business.name||'Adi Festa';
    const customerName=customer.nome||sale.clienteNome||'',guest=!customerName||customerName.toLowerCase()==='venda avulsa';
    const lines=[guest?'Olá! 😊':`Olá, ${customerName}! 😊`,''],amount=dinheiro(value(sale));
    if(sale.status==='fiado'){
      lines.push(`Segue o resumo da sua compra na ${businessName}:`,'','🛒 Valor da compra:',amount,'','💳 Forma de pagamento:','Fiado','','📄 Saldo anterior:',dinheiro(debt(balanceBefore??sale.saldoAnterior)),'','➕ Valor fiado nesta compra:',amount,'','💰 Total em aberto:',dinheiro(debt(balanceAfter??sale.saldoAtual)),'','Obrigado pela preferência! 💚','Qualquer dúvida, é só chamar.');
    }else{
      lines.push(guest?`A compra na ${businessName} foi registrada com sucesso.`:'Sua compra foi registrada com sucesso.','','🛒 Valor da compra:',amount,'','💳 Forma de pagamento:',paymentLabel(sale));
      if(Number(sale.valorRecebido)>0)lines.push('','💵 Valor recebido:',dinheiro(sale.valorRecebido));
      if(Number(sale.troco)>0)lines.push('','↩️ Troco:',dinheiro(sale.troco));
      lines.push('','✅ Pagamento confirmado','','Obrigado pela preferência! 💚','Até a próxima.');
    }
    return lines.join('\n');
  }
  function wrapText(context,text,maxWidth){
    const words=String(text||'').split(/\s+/).filter(Boolean),lines=[];let line='';
    words.forEach(word=>{const candidate=line?`${line} ${word}`:word;if(line&&context.measureText(candidate).width>maxWidth){lines.push(line);line=word}else line=candidate});
    if(line)lines.push(line);return lines.length?lines:[''];
  }
  function createSaleReceiptCanvas({sale,customer,business}){
    const scale=2,width=450,probe=document.createElement('canvas').getContext('2d');probe.font='bold 15px Arial';
    const itemLines=(sale.itens||[]).map(item=>wrapText(probe,item.nome,285));
    const extraLines=itemLines.reduce((sum,lines)=>sum+Math.max(0,lines.length-1),0);
    const height=520+(sale.itens||[]).length*70+extraLines*20+(sale.status==='fiado'?125:0)+(sale.observacao?70:0);
    const canvas=document.createElement('canvas');canvas.width=width*scale;canvas.height=height*scale;
    const context=canvas.getContext('2d');context.scale(scale,scale);context.fillStyle='#fff';context.fillRect(0,0,width,height);context.textBaseline='alphabetic';
    context.fillStyle='#344052';context.textAlign='center';context.font='bold 27px Arial';context.fillText(business.receiptName||business.name,width/2,43);
    context.font='13px Arial';context.fillStyle='#6f7b8d';context.fillText(`RECIBO · PEDIDO #${publicSaleNumber(sale)}`,width/2,68);
    context.textAlign='left';context.fillStyle='#344052';context.font='14px Arial';let y=105;
    context.fillText(`Data: ${new Date(sale.data).toLocaleString('pt-BR')}`,25,y);y+=27;
    wrapText(context,`Cliente: ${customer?.nome||sale.clienteNome||'Venda avulsa'}`,400).forEach(line=>{context.fillText(line,25,y);y+=20});y+=12;
    context.strokeStyle='#cbd1d9';context.setLineDash([5,5]);context.beginPath();context.moveTo(25,y);context.lineTo(width-25,y);context.stroke();y+=28;
    (sale.itens||[]).forEach((item,index)=>{
      context.fillStyle='#344052';context.font='bold 15px Arial';context.textAlign='left';
      itemLines[index].forEach(line=>{context.fillText(line,25,y);y+=19});
      context.font='13px Arial';context.fillStyle='#697586';context.fillText(`${item.quantidade} × ${dinheiro(unitPrice(item))}`,25,y);
      context.textAlign='right';context.fillStyle='#344052';context.fillText(dinheiro(Number(item.quantidade||0)*unitPrice(item)),width-25,y);y+=34;
    });
    context.setLineDash([]);context.textAlign='left';context.font='14px Arial';context.fillStyle='#344052';context.fillText(`Subtotal: ${dinheiro(sale.subtotalOriginal??value(sale))}`,25,y);
    if(Number(sale.descontoTotal)>0){y+=25;context.fillStyle='#bd303b';context.fillText(`Desconto: -${dinheiro(sale.descontoTotal)}`,25,y)}
    y+=36;context.fillStyle='#344052';context.font='bold 19px Arial';context.fillText('VALOR FINAL',25,y);context.textAlign='right';context.fillText(dinheiro(value(sale)),width-25,y);
    y+=38;context.textAlign='center';context.fillStyle=sale.status==='fiado'?'#a86600':'#087d64';context.font='bold 15px Arial';context.fillText(`FORMA DE PAGAMENTO: ${paymentLabel(sale).toUpperCase()}`,width/2,y);
    if(sale.status==='fiado'){y+=36;context.textAlign='left';context.fillStyle='#344052';context.font='14px Arial';context.fillText(`Saldo anterior: ${dinheiro(debt(sale.saldoAnterior))}`,35,y);y+=25;context.fillText(`Valor fiado nesta venda: ${dinheiro(value(sale))}`,35,y);y+=28;context.font='bold 16px Arial';context.fillText(`Total em aberto agora: ${dinheiro(debt(sale.saldoAtual))}`,35,y)}
    if(sale.observacao){y+=38;context.textAlign='left';context.fillStyle='#697586';context.font='13px Arial';wrapText(context,`Observação: ${sale.observacao}`,390).slice(0,3).forEach(line=>{context.fillText(line,25,y);y+=18})}
    return canvas;
  }
  function generateSaleReceiptBlob(saleData){
    const canvas=createSaleReceiptCanvas(saleData);
    return new Promise((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(Error('Não foi possível gerar o recibo.')),'image/png',0.92));
  }
  async function copyText(text){
    try{await navigator.clipboard.writeText(text)}
    catch{const area=document.createElement('textarea');area.value=text;area.setAttribute('readonly','');area.style.position='fixed';area.style.opacity='0';document.body.append(area);area.select();document.execCommand('copy');area.remove()}
    Utils.toast('Mensagem copiada');
  }
  function statusMarkup(sale){
    const pending=!navigator.onLine||Number(window.SyncFirebaseState?.queueTotal||0)>0;
    const checks=[['circle-check','Venda registrada'],['package-check','Estoque atualizado'],sale.status==='fiado'?['wallet-cards','Saldo atualizado']:null,(sale.campaignUpdates||[]).length?['gift','Campanhas processadas']:null].filter(Boolean);
    return`<section class="sale-operation-status">${checks.map(([icon,label])=>`<span><i data-lucide="${icon}"></i>${label}</span>`).join('')}${pending?'<p><i data-lucide="cloud-off"></i> Venda salva neste aparelho e aguardando sincronização.</p>':''}</section>`;
  }
  function itemsMarkup(sale){
    return(sale.itens||[]).map(item=>`<div class="receipt-line sale-receipt-item"><span><b>${escapar(item.nome)}</b><small>${Number(item.quantidade||0)} × ${dinheiro(unitPrice(item))}</small></span><strong>${dinheiro(Number(item.quantidade||0)*unitPrice(item))}</strong></div>`).join('');
  }
  function receiptMarkup(sale,customer,business){
    const discount=Number(sale.descontoTotal)>0?`<div class="receipt-line"><span>Desconto</span><strong>-${dinheiro(sale.descontoTotal)}</strong></div>`:'';
    const financed=sale.status==='fiado'?`<div class="receipt-debt"><div><span>Saldo anterior</span><strong>${dinheiro(debt(sale.saldoAnterior))}</strong></div><div><span>Valor fiado nesta venda</span><strong>${dinheiro(value(sale))}</strong></div><div><span>Total em aberto agora</span><strong>${dinheiro(debt(sale.saldoAtual))}</strong></div></div>`:'';
    const paid=sale.status!=='fiado'?`<div class="sale-payment-confirmed"><i data-lucide="badge-check"></i><span><b>${paymentLabel(sale)}</b><small>Pagamento confirmado</small>${Number(sale.valorRecebido)>0?`<small>Recebido: ${dinheiro(sale.valorRecebido)}</small>`:''}${Number(sale.troco)>0?`<small>Troco: ${dinheiro(sale.troco)}</small>`:''}</span></div>`:'';
    return`<section class="receipt-paper sale-receipt-paper"><header><h2>${escapar(business.receiptName||business.name)}</h2><span>${escapar(customer?.nome||sale.clienteNome||'Venda avulsa')}</span></header><div class="sale-receipt-items">${itemsMarkup(sale)}</div><div class="receipt-line"><span>Subtotal</span><strong>${dinheiro(sale.subtotalOriginal??value(sale))}</strong></div>${discount}<div class="receipt-line total"><span>Valor final</span><strong>${dinheiro(value(sale))}</strong></div>${paid}${financed}${sale.observacao?`<div class="sale-receipt-note"><b>Observação</b><span>${escapar(sale.observacao)}</span></div>`:''}</section>`;
  }
  function closeCompletion(goHome=true){
    document.removeEventListener('keydown',active?.escapeHandler);const trigger=active?.trigger;active=null;Modais.fechar();
    if(goHome)Router.ir('inicio');setTimeout(()=>trigger?.isConnected&&trigger.focus(),0);
  }
  function mobileMarkup(sale,customer,business){
    const date=new Date(sale.data);
    return`<div class="modal-bg sale-completion-bg"><section class="modal-box mobile-sale-completion" role="dialog" aria-modal="true" aria-labelledby="sale-completion-title"><header class="sale-completion-head"><span class="sale-success-icon"><i data-lucide="check"></i></span><div><h2 id="sale-completion-title">Venda concluída</h2><p>Pedido #${publicSaleNumber(sale)} · ${date.toLocaleDateString('pt-BR')} às ${date.toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}</p></div><button class="icon-btn" data-sale-close aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="sale-completion-body"><div class="receipt-preview">${receiptMarkup(sale,customer,business)}</div>${statusMarkup(sale)}<section class="mobile-sale-success" aria-label="Próxima ação"><button data-sale-next="new"><i data-lucide="shopping-bag"></i>Nova venda</button><button data-sale-next="same" ${sale.clienteId?'':'disabled'}><i data-lucide="user-round"></i>Mesmo cliente</button><button data-sale-next="repeat"><i data-lucide="repeat-2"></i>Repetir itens</button></section></div><footer class="sale-completion-actions"><button class="btn btn-primary" data-sale-share><i data-lucide="share-2"></i>Compartilhar venda</button><button class="btn btn-light" data-sale-close>Fechar</button></footer></section></div>`;
  }
  function desktopMarkup(sale,customer,business){
    const phone=normalizeSalePhone(customer?.telefone);
    return`<div class="modal-bg"><section class="modal-box" role="dialog" aria-modal="true" aria-labelledby="sale-completion-title"><header class="modal-head"><div><h3 id="sale-completion-title">Venda concluída</h3><small>Pedido #${publicSaleNumber(sale)}</small></div><button class="icon-btn" data-sale-close aria-label="Fechar"><i data-lucide="x"></i></button></header><div class="receipt-preview">${receiptMarkup(sale,customer,business)}</div><footer class="modal-foot receipt-actions"><button class="btn btn-light" data-sale-download><i data-lucide="download"></i>Baixar recibo</button><button class="btn btn-whatsapp" data-sale-whatsapp ${phone?'':'disabled'}><i data-lucide="message-circle"></i>Enviar pelo WhatsApp</button><button class="btn btn-primary" data-sale-share><i data-lucide="share-2"></i>Compartilhar</button><button class="btn btn-light" data-sale-close>Concluir</button></footer></section></div>`;
  }
  function shareMarkup(){
    const message=buildSaleShareMessage(active);
    return`<div class="modal-bg sale-share-bg"><section class="modal-box sale-share-sheet" role="dialog" aria-modal="true" aria-labelledby="sale-share-title" tabindex="-1"><span class="sale-sheet-handle"></span><header class="modal-head"><div><h3 id="sale-share-title">Compartilhar venda</h3><small>Escolha como deseja compartilhar</small></div><button class="icon-btn" data-share-cancel aria-label="Cancelar compartilhamento"><i data-lucide="x"></i></button></header><div class="sale-share-body"><div class="sale-share-modes"><button class="active" data-share-mode="text"><i data-lucide="message-square-text"></i><span><b>Resumo em texto</b><small>Recomendado para WhatsApp</small></span></button><button data-share-mode="visual"><i data-lucide="image"></i><span><b>Recibo visual</b><small>Imagem sem salvar na galeria</small></span></button></div><label class="sale-share-preview"><span>Prévia da mensagem</span><textarea id="sale-share-message" readonly>${escapar(message)}</textarea></label><div class="sale-share-tools"><button data-share-edit><i data-lucide="pencil"></i>Editar mensagem</button><button data-share-copy><i data-lucide="copy"></i>Copiar mensagem</button><button data-share-system><i data-lucide="share"></i>Compartilhar pelo sistema</button></div><div class="sale-share-feedback" role="status" aria-live="polite"></div><div class="sale-share-fallback" hidden></div></div><footer class="modal-foot sale-share-actions"><button class="btn btn-light" data-share-cancel>Cancelar</button><button class="btn btn-primary" data-share-submit><i data-lucide="send"></i>Compartilhar</button></footer></section></div>`;
  }
  function restoreCompletion(){
    if(!active)return;document.querySelector('#modal').innerHTML=isMobile()?mobileMarkup(active.sale,active.customer,active.business):desktopMarkup(active.sale,active.customer,active.business);bindCompletion();
  }
  function feedback(text,error=false){const node=document.querySelector('.sale-share-feedback');if(node){node.textContent=text;node.classList.toggle('error',error)}}
  async function systemTextShare(message){
    if(navigator.share)try{await navigator.share({title:`Venda #${publicSaleNumber(active.sale)}`,text:message});active.shareStatus='started';active.lastAction='system_text';feedback('Compartilhamento iniciado.');return true}catch(error){if(error.name==='AbortError')return false}
    await copyText(message);feedback('Seu navegador não abriu o compartilhamento. A mensagem foi copiada.');return false;
  }
  function visualFallback(message){
    const fallback=document.querySelector('.sale-share-fallback');if(!fallback)return;fallback.hidden=false;
    fallback.innerHTML='<p>Seu navegador não permite enviar o recibo visual diretamente.</p><button data-fallback-text>Enviar apenas o resumo em texto</button><button data-fallback-copy>Copiar mensagem</button><button data-fallback-download>Baixar recibo manualmente</button>';
    fallback.querySelector('[data-fallback-text]').onclick=()=>shareText(message);fallback.querySelector('[data-fallback-copy]').onclick=()=>copyText(message);fallback.querySelector('[data-fallback-download]').onclick=downloadReceipt;
  }
  async function shareVisual(message){
    active.receiptStatus='preparing';feedback('Preparando recibo…');const blob=await generateSaleReceiptBlob(active);
    if(typeof File!=='function'){visualFallback(message);feedback('Compartilhamento de arquivos indisponível neste navegador.',true);return}
    const file=new File([blob],`recibo-${publicSaleNumber(active.sale)}.png`,{type:'image/png',lastModified:Date.now()});
    if(navigator.share&&navigator.canShare?.({files:[file]}))try{active.receiptStatus='ready';feedback('Abrindo compartilhamento…');await navigator.share({files:[file],title:`Recibo #${publicSaleNumber(active.sale)}`,text:message});active.shareStatus='started';active.lastAction='visual_share';feedback('Compartilhamento iniciado.')}catch(error){if(error.name!=='AbortError'){visualFallback(message);feedback('Não foi possível abrir o compartilhamento visual.',true)}}else{visualFallback(message);feedback('Compartilhamento de arquivos indisponível neste navegador.',true)}
  }
  async function downloadReceipt(){
    if(!active||active.busy)return;active.busy=true;feedback('Preparando recibo…');
    try{const blob=await generateSaleReceiptBlob(active),url=URL.createObjectURL(blob),anchor=document.createElement('a');anchor.href=url;anchor.download=`recibo-${publicSaleNumber(active.sale)}.png`;anchor.click();setTimeout(()=>URL.revokeObjectURL(url),1000);active.receiptStatus='downloaded';active.lastAction='manual_download';feedback('Download manual iniciado.')}catch(error){feedback(error.message||'Não foi possível gerar o recibo.',true)}finally{active.busy=false}
  }
  async function shareText(message){
    const phone=normalizeSalePhone(active.customer?.telefone);
    if(phone){window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`,'_blank','noopener');active.shareStatus='whatsapp_opened';active.lastAction='whatsapp';feedback('WhatsApp aberto.');if(!navigator.onLine)Utils.toast('Você está offline. O WhatsApp poderá enviar quando houver conexão.');return}
    feedback('Este cliente não possui um WhatsApp válido. Abrindo o compartilhamento do aparelho.');await systemTextShare(message);
  }
  function openShare(){
    if(!active||active.busy)return;active.lastAction='open_share';active.shareMode='text';document.querySelector('#modal').innerHTML=shareMarkup();
    const root=document.querySelector('.sale-share-sheet'),message=()=>root.querySelector('#sale-share-message').value;
    root.querySelectorAll('[data-share-cancel]').forEach(button=>button.onclick=restoreCompletion);
    root.querySelectorAll('[data-share-mode]').forEach(button=>button.onclick=()=>{active.shareMode=button.dataset.shareMode;root.querySelectorAll('[data-share-mode]').forEach(item=>item.classList.toggle('active',item===button));root.querySelector('[data-share-submit]').innerHTML=active.shareMode==='visual'?'<i data-lucide="image"></i>Compartilhar recibo':'<i data-lucide="send"></i>Compartilhar';root.querySelector('.sale-share-fallback').hidden=true;window.lucide?.createIcons()});
    root.querySelector('[data-share-edit]').onclick=event=>{const area=root.querySelector('#sale-share-message'),editing=area.hasAttribute('readonly');if(editing){area.removeAttribute('readonly');area.focus();area.setSelectionRange(area.value.length,area.value.length);event.currentTarget.innerHTML='<i data-lucide="check"></i>Concluir edição'}else{area.setAttribute('readonly','');event.currentTarget.innerHTML='<i data-lucide="pencil"></i>Editar mensagem'}window.lucide?.createIcons()};
    root.querySelector('[data-share-copy]').onclick=()=>copyText(message());root.querySelector('[data-share-system]').onclick=()=>systemTextShare(message());
    root.querySelector('[data-share-submit]').onclick=async event=>{if(active.busy)return;const button=event.currentTarget;active.busy=true;button.disabled=true;try{if(active.shareMode==='visual')await shareVisual(message());else await shareText(message())}catch(error){feedback(error.message||'Não foi possível compartilhar.',true)}finally{active.busy=false;button.disabled=false}};
    root.focus();window.lucide?.createIcons();
  }
  function bindCompletion(){
    const root=document.querySelector('#modal');
    root.querySelectorAll('[data-sale-close]').forEach(button=>button.onclick=()=>closeCompletion(true));
    root.querySelectorAll('[data-sale-share]').forEach(button=>button.onclick=openShare);
    root.querySelector('[data-sale-whatsapp]')?.addEventListener('click',()=>shareText(buildSaleShareMessage(active)));
    root.querySelector('[data-sale-download]')?.addEventListener('click',downloadReceipt);
    root.querySelectorAll('[data-sale-next]').forEach(button=>button.onclick=()=>{if(button.disabled)return;const action=button.dataset.saleNext,sale=active.sale;dispatchEvent(new CustomEvent('sale-next-action',{detail:{action,sale}}));closeCompletion(false)});
    window.lucide?.createIcons();
  }
  function show(sale,customer){
    if(!sale?.id)throw Error('A venda precisa estar concluída antes de exibir o recibo.');
    active={saleCompleted:true,saleId:sale.id,sale,customer:customer||null,business:currentBusiness(),balanceBefore:sale.saldoAnterior,balanceAfter:sale.saldoAtual,shareStatus:'idle',receiptStatus:'idle',lastAction:'opened',busy:false,trigger:document.activeElement};
    active.escapeHandler=event=>{if(event.key==='Escape')closeCompletion(true)};document.addEventListener('keydown',active.escapeHandler);restoreCompletion();
  }
  window.Recibos={mostrar:show,criarCanvas:(sale,customer)=>createSaleReceiptCanvas({sale,customer,business:currentBusiness()}),buildSaleShareMessage,generateSaleReceiptBlob,normalizeSalePhone,publicSaleNumber,estado:()=>active?{saleCompleted:active.saleCompleted,saleId:active.saleId,shareStatus:active.shareStatus,receiptStatus:active.receiptStatus,lastAction:active.lastAction,busy:active.busy}:null};
})();
