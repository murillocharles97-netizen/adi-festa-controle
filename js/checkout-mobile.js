(function(){
  'use strict';
  const mq=matchMedia('(max-width:767px)');
  const $=(selector,root=document)=>root.querySelector(selector),$$=(selector,root=document)=>[...root.querySelectorAll(selector)];
  const icon=name=>`<i data-lucide="${name}"></i>`;
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  let payment='pix',longPress=null,startX=0,startY=0,enhancing=false,pending=null;
  function product(id){return Produtos.obter(id)}
  function recentProducts(){const ids=[];[...(DB.carregar().vendas||[])].reverse().forEach(sale=>(sale.itens||[]).forEach(item=>{if(item.produtoId&&!ids.includes(item.produtoId))ids.push(item.produtoId)}));return ids.slice(0,5).map(product).filter(item=>item&&item.ativo!==false)}
  function mobileHeader(page){
    if($('.mobile-sale-filters',page))return;
    const tools=$('.pos-tools',page),recent=recentProducts();
    tools?.insertAdjacentHTML('afterend',`<div class="mobile-sale-filters"><button class="active" data-sale-filter="quick">${icon('zap')} Rápidos</button><button data-sale-filter="favorites">${icon('star')} Favoritos</button><button data-sale-filter="sold">${icon('flame')} Mais vendidos</button><button data-sale-filter="low">${icon('triangle-alert')} Baixo estoque</button></div>${recent.length?`<section class="mobile-recent-products"><header><b>Últimos vendidos</b></header><div>${recent.map(item=>`<button data-recent-product="${item.id}"><span>${esc(item.nome.slice(0,2).toUpperCase())}</span><b>${esc(item.nome)}</b><small>${money(item.preco)}</small></button>`).join('')}</div></section>`:''}<div class="mobile-products-title"><b>Produtos</b><small>Toque para adicionar · segure para opções</small></div>`);
  }
  function decorateProducts(page){
    $$('.pos-product',page).forEach(card=>{
      const item=product(card.dataset.add);if(!item)return;
      const status=getProductStockStatus(item);card.classList.add('mobile-sale-product',`stock-${status}`);
      if(!$('.mobile-sale-favorite',card))card.insertAdjacentHTML('beforeend',`<span class="mobile-sale-favorite ${item.favorito?'active':''}" data-fav="${item.id}" role="button" aria-label="${item.favorito?'Remover dos favoritos':'Adicionar aos favoritos'}">${icon('star')}</span>`);
    });
  }
  function paymentChips(summary){
    if($('.mobile-payment-chips',summary))return;
    const select=$('#sale-status',summary),field=select?.closest('.field');
    field?.insertAdjacentHTML('beforebegin',`<section class="mobile-payment"><h4>Forma de pagamento</h4><div class="mobile-payment-chips"><button class="active" data-payment="pix">${icon('diamond')} Pix</button><button data-payment="dinheiro">${icon('banknote')} Dinheiro</button><button data-payment="cartao">${icon('credit-card')} Cartão</button><button data-payment="fiado">${icon('receipt-text')} Fiado</button></div><div class="mobile-payment-note">${icon('circle-check')}<span><b>Pagamento à vista</b><small>Valor será recebido agora.</small></span></div></section>`);
    field?.classList.add('mobile-hidden-payment-select');
  }
  function summaryTools(summary){
    if($('.mobile-summary-tools',summary))return;
    summary.insertAdjacentHTML('afterbegin','<button class="mobile-sheet-handle" type="button" aria-label="Expandir sacola"><span></span></button>');
    const discount=$('.discount-grid',summary);discount?.insertAdjacentHTML('beforebegin',`<button class="mobile-discount-toggle" type="button">${icon('tag')} Adicionar desconto ${icon('chevron-down')}</button>`);
    $('#sale-note',summary)?.closest('.field')?.classList.add('mobile-sale-note');
    $('#finish-sale',summary)?.insertAdjacentHTML('beforebegin',`<div class="mobile-summary-tools"><button data-mobile-tool="discount">${icon('tag')}<span>Desconto</span></button><button data-mobile-tool="client">${icon('user-round')}<span>Cliente</span></button><button data-mobile-tool="product">${icon('package-plus')}<span>Novo produto</span></button><button data-mobile-tool="note">${icon('message-square-plus')}<span>Observação</span></button></div>`);
    paymentChips(summary);
  }
  function enhanceCart(summary){
    $$('.editable-cart',summary).forEach(row=>{
      if($('.mobile-qty-control',row))return;
      const input=$('[data-item-qty]',row),label=input?.closest('label');if(!input||!label)return;
      label.classList.add('mobile-qty-label');label.insertAdjacentHTML('beforeend',`<span class="mobile-qty-control"><button type="button" data-cart-dec="${input.dataset.itemQty}">−</button><b>${input.value}</b><button type="button" data-cart-inc="${input.dataset.itemQty}">+</button></span>`);
      row.insertAdjacentHTML('afterbegin','<span class="mobile-cart-swipe duplicate">Duplicar</span><span class="mobile-cart-swipe remove">Remover</span>');
      bindCartSwipe(row);
    });
    const total=$('.total-row b',summary)?.textContent||money(0),finish=$('#finish-sale',summary);if(finish&&!$('strong',finish))finish.innerHTML=`${icon('check')} Concluir venda <strong>${total}</strong>`;else if(finish&&$('strong',finish)?.textContent!==total)$('strong',finish).textContent=total;
    const bag=$('#open-sale-summary'),items=$$('.editable-cart',summary).reduce((sum,row)=>sum+Number($('[data-item-qty]',row)?.value||0),0),client=$('#sale-client',summary),clientName=client?.value?client.options[client.selectedIndex]?.text:'Venda avulsa';
    const meta=`${clientName} · ${payment==='fiado'?'Fiado':payment[0].toUpperCase()+payment.slice(1)}`;
    if(bag){
      const previous=Number(bag.dataset.totalCount||0),initialized=bag.hasAttribute('data-total-count');
      bag.dataset.meta=meta;bag.dataset.totalCount=String(items);bag.dataset.count=items>99?'99+':String(items);
      bag.classList.toggle('has-items',items>0);bag.classList.toggle('is-empty',items===0);
      bag.setAttribute('aria-label',items?`Abrir sacola com ${items} ${items===1?'item':'itens'}`:'Sacola vazia');
      if(initialized&&previous!==items){bag.classList.remove('bag-bump');requestAnimationFrame(()=>bag.classList.add('bag-bump'));if(items>previous)navigator.vibrate?.(18)}
    }
  }
  function bindCartSwipe(row){
    let x=0,y=0,dx=0;row.addEventListener('pointerdown',event=>{if(event.target.closest('button,input'))return;x=event.clientX;y=event.clientY;dx=0});row.addEventListener('pointermove',event=>{if(!x)return;const mx=event.clientX-x,my=event.clientY-y;if(Math.abs(my)>Math.abs(mx))return;dx=Math.max(-105,Math.min(105,mx));row.style.transform=`translateX(${dx}px)`});row.addEventListener('pointerup',()=>{if(dx<-75)$('[data-remove]',row)?.click();else if(dx>75){const input=$('[data-item-qty]',row);if(input){input.value=Math.max(1,Number(input.value||1)*2);input.dispatchEvent(new Event('change',{bubbles:true}))}}row.style.transform='';x=0;dx=0});row.addEventListener('pointercancel',()=>{row.style.transform='';x=0;dx=0})
  }
  function openSummary(){const summary=$('#pos-summary');if(!summary)return;summary.hidden=false;summary.classList.add('mobile-open');document.body.classList.add('sale-sheet-open');$('.pos-summary-overlay')?.classList.add('open');enhanceCart(summary)}
  function closeSummary(){const summary=$('#pos-summary');summary?.classList.remove('mobile-open','expanded','discount-open','note-open');document.body.classList.remove('sale-sheet-open');$('.pos-summary-overlay')?.classList.remove('open');setTimeout(()=>{if(summary&&!summary.classList.contains('mobile-open'))summary.hidden=true},180)}
  function updatePayment(method){payment=method;window.CheckoutPaymentMethod=method;const summary=$('#pos-summary'),select=$('#sale-status',summary);if(select){select.value=method==='fiado'?'fiado':'pago';select.dispatchEvent(new Event('change',{bubbles:true}))}$$('[data-payment]',summary).forEach(button=>button.classList.toggle('active',button.dataset.payment===method));const note=$('.mobile-payment-note',summary);if(note)note.innerHTML=method==='fiado'?`${icon('hand-coins')}<span><b>Venda fiado</b><small>O valor será somado à conta do cliente.</small></span>`:`${icon('circle-check')}<span><b>${method==='pix'?'Pagamento via Pix':method==='dinheiro'?'Pagamento em dinheiro':'Pagamento no cartão'}</b><small>Valor será recebido agora.</small></span>`;enhanceCart(summary);window.lucide?.createIcons()}
  function menu(item){
    const root=$('#modal');root.innerHTML=`<div class="modal-bg mobile-product-menu-bg"><section class="mobile-product-menu"><span class="sheet-handle"></span><header><span>${esc(item.nome.slice(0,2).toUpperCase())}</span><div><h3>${esc(item.nome)}</h3><p>${money(item.preco)}</p></div><button class="close">${icon('x')}</button></header><button data-menu-add-five>${icon('plus')} Adicionar 5 unidades</button><button data-menu-favorite>${icon('star')} ${item.favorito?'Remover dos favoritos':'Favoritar produto'}</button><button data-menu-edit>${icon('pencil')} Editar produto</button><button data-menu-stock>${icon('package-plus')} Entrada de estoque</button><button data-menu-history>${icon('history')} Histórico de estoque</button></section></div>`;
    const close=()=>root.innerHTML='';$('.close',root).onclick=close;$('[data-menu-add-five]',root).onclick=()=>{close();const card=$(`.pos-product[data-add="${CSS.escape(item.id)}"]`);for(let n=0;n<5;n++)card?.click()};$('[data-menu-favorite]',root).onclick=()=>{close();$(`[data-fav="${CSS.escape(item.id)}"]`)?.click()};$('[data-menu-edit]',root).onclick=()=>{close();window.ProdutosMobile?.productForm(item.id)};$('[data-menu-stock]',root).onclick=()=>{close();window.ProdutosMobile?.stockEntry(item.id)};$('[data-menu-history]',root).onclick=()=>{close();window.ProdutosMobile?.history(item.id)};window.lucide?.createIcons()
  }
  function bindProductGestures(page){
    const grid=$('#pos-grid',page);if(!grid||grid.dataset.mobileGestures)return;grid.dataset.mobileGestures='1';
    grid.addEventListener('pointerdown',event=>{const card=event.target.closest('.pos-product');if(!card||event.target.closest('[data-fav]'))return;startX=event.clientX;startY=event.clientY;clearTimeout(longPress);longPress=setTimeout(()=>{card.dataset.blockClick='1';navigator.vibrate?.(25);menu(product(card.dataset.add))},520)});
    grid.addEventListener('pointermove',event=>{if(Math.abs(event.clientX-startX)>12||Math.abs(event.clientY-startY)>12)clearTimeout(longPress)});
    grid.addEventListener('pointerup',event=>{clearTimeout(longPress);const card=event.target.closest('.pos-product');if(!card)return;const dx=event.clientX-startX;if(dx>60){card.dataset.blockClick='1';card.click();Utils.toast(`${product(card.dataset.add).nome} adicionado`)}});
    grid.addEventListener('pointercancel',()=>clearTimeout(longPress));
    grid.addEventListener('click',event=>{const favorite=event.target.closest('[data-fav]');if(favorite){event.preventDefault();event.stopImmediatePropagation();DB.alterar(db=>{const item=db.produtos.find(entry=>entry.id===favorite.dataset.fav);if(item)item.favorito=!item.favorito});const item=product(favorite.dataset.fav);favorite.classList.toggle('active',Boolean(item?.favorito));favorite.innerHTML=icon('star');favorite.setAttribute('aria-label',item?.favorito?'Remover dos favoritos':'Adicionar aos favoritos');window.lucide?.createIcons();return}const card=event.target.closest('.pos-product');if(card?.dataset.blockClick==='1'&&event.isTrusted){event.preventDefault();event.stopImmediatePropagation();delete card.dataset.blockClick}},true)
  }
  function bindPage(page){
    if(page.dataset.mobileSaleBound)return;page.dataset.mobileSaleBound='1';
    page.insertAdjacentHTML('beforeend','<div class="pos-summary-overlay"></div>');
    page.addEventListener('click',event=>{
      const filter=event.target.closest('[data-sale-filter]');if(filter){$$('[data-sale-filter]',page).forEach(button=>button.classList.toggle('active',button===filter));const map={quick:['todos','favoritos'],favorites:['favoritos','favoritos'],sold:['todos','vendidos'],low:['baixo','favoritos']}[filter.dataset.saleFilter];$('#pos-filter').value=map[0];$('#pos-sort').value=map[1];$('#pos-filter').dispatchEvent(new Event('change'));return}
      const recent=event.target.closest('[data-recent-product]');if(recent){$(`.pos-product[data-add="${CSS.escape(recent.dataset.recentProduct)}"]`)?.click();return}
      const favorite=event.target.closest('[data-fav]');if(favorite)setTimeout(()=>{const item=product(favorite.dataset.fav);favorite.classList.toggle('active',Boolean(item?.favorito));favorite.innerHTML=icon('star');favorite.setAttribute('aria-label',item?.favorito?'Remover dos favoritos':'Adicionar aos favoritos');window.lucide?.createIcons()},0);
      if(event.target.closest('#open-sale-summary'))openSummary();if(event.target.closest('#close-sale-summary')||event.target.closest('.pos-summary-overlay'))closeSummary();
      const pay=event.target.closest('[data-payment]');if(pay)updatePayment(pay.dataset.payment);
      const inc=event.target.closest('[data-cart-inc]'),dec=event.target.closest('[data-cart-dec]');if(inc||dec){const id=(inc||dec).dataset[inc?'cartInc':'cartDec'],input=$(`[data-item-qty="${CSS.escape(id)}"]`);if(input){input.value=Math.max(1,Number(input.value||1)+(inc?1:-1));input.dispatchEvent(new Event('change',{bubbles:true}))}}
      const discount=event.target.closest('.mobile-discount-toggle,[data-mobile-tool="discount"]');if(discount)$('#pos-summary')?.classList.toggle('discount-open');
      const tool=event.target.closest('[data-mobile-tool]');if(tool?.dataset.mobileTool==='client')$('#open-client-picker')?.click();if(tool?.dataset.mobileTool==='product')window.ProdutosMobile?.productForm();if(tool?.dataset.mobileTool==='note'){$('#pos-summary')?.classList.toggle('note-open');$('#sale-note')?.focus()}
      if(event.target.closest('.mobile-sheet-handle'))$('#pos-summary')?.classList.toggle('expanded');
    });
    bindProductGestures(page)
  }
  function applyPending(page){if(!pending)return;const context=pending;pending=null;setTimeout(()=>{if(context.clientId){const select=$('#sale-client');select.value=context.clientId;select.dispatchEvent(new Event('change'))}if(context.repeat)(context.items||[]).forEach(item=>{const card=$(`.pos-product[data-add="${CSS.escape(item.produtoId)}"]`);for(let n=0;n<Number(item.quantidade||0);n++)card?.click()})},40)}
  function enhance(){
    if(enhancing||!mq.matches||Router.atual()!=='vender')return;const page=$('.pos-page');if(!page)return;const first=!page.dataset.mobileSaleInitialized;if(first){payment='pix';window.CheckoutPaymentMethod='pix'}enhancing=true;try{page.classList.add('mobile-sale-page');mobileHeader(page);decorateProducts(page);const summary=$('#pos-summary',page);if(summary){summaryTools(summary);enhanceCart(summary)}bindPage(page);applyPending(page);if(first){page.dataset.mobileSaleInitialized='1';window.lucide?.createIcons()}}finally{enhancing=false}
  }
  function prepareNext(action,sale){pending={clientId:action==='same'?sale?.clienteId:null,repeat:action==='repeat',items:sale?.itens||[]};Router.ir('inicio');setTimeout(()=>Router.ir('vender'),20)}
  document.addEventListener('click',event=>{if(event.target.closest('#finish-sale'))window.CheckoutPaymentMethod=payment;setTimeout(enhance,0)},{capture:true});
  document.addEventListener('change',()=>setTimeout(enhance,0),true);
  let valueTimer=null;document.addEventListener('input',event=>{if(!mq.matches||!['discount-value','discount-percent','manual-total'].includes(event.target.id))return;clearTimeout(valueTimer);valueTimer=setTimeout(()=>event.target.dispatchEvent(new Event('change',{bubbles:true})),180)},true);
  new MutationObserver(()=>queueMicrotask(enhance)).observe($('#app'),{childList:true});
  addEventListener('sale-next-action',event=>prepareNext(event.detail.action,event.detail.sale));
  addEventListener('hashchange',()=>setTimeout(enhance,0));
  addEventListener('firebase-session-cleared',()=>{pending=null;payment='pix';enhancing=false;window.CheckoutPaymentMethod='pix'});
  window.CheckoutMobile={enhance,openSummary,closeSummary,prepareNext};
})();
