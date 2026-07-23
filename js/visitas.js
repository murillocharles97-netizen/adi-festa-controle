window.Visitas=(()=>{
  const now=()=>new Date().toISOString();
  const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('');
  const listar=()=>[...DB.carregar().visitas].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const obter=id=>DB.carregar().visitas.find(v=>v.id===id);
  const ativa=()=>listar().find(v=>['recebendo','pedidos_encerrados','separacao','deslocamento'].includes(v.status));
  const pedidos=visitId=>DB.carregar().catalogOrders.filter(o=>o.visitId===visitId&&!o.deletedAt);
  const snapshotProduto=(p,old={})=>({id:old.id||Utils.uuid(),productId:p.id,productName:p.nome,productImage:p.imageThumbUrl||p.imageUrl||p.imagem||'',productMainImage:p.imageUrl||p.imagem||'',imageUpdatedAt:p.imageUpdatedAt||null,category:p.categoria||'Outros',description:p.descricao||p.palavrasChave||'',originalPrice:Number(p.preco||0),salePrice:Number(old.salePrice??p.preco??0),availableQuantity:Number(old.availableQuantity??p.estoqueAtual??0),maxPerCustomer:Number(old.maxPerCustomer||0),featured:Boolean(old.featured),active:old.active!==false,controlaEstoque:old.controlaEstoque??!p.semControleEstoque,displayOrder:Number(old.displayOrder||0)});
  function salvar(data,selected=[]){let saved;DB.alterar(db=>{const index=db.visitas.findIndex(v=>v.id===data.id),old=index>=0?db.visitas[index]:null,oldItems=new Map((old?.catalogItems||[]).map(i=>[i.productId,i])),catalogItems=selected.map(id=>{const p=db.produtos.find(x=>x.id===id);return snapshotProduto(p,oldItems.get(id))});saved={...old,...data,id:data.id||Utils.uuid(),publicToken:old?.publicToken||token(),catalogItems,createdAt:old?.createdAt||now(),updatedAt:now()};if(index>=0)db.visitas[index]=saved;else db.visitas.push(saved)});publicar(saved);return saved}
  function publicar(visit){dispatchEvent(new CustomEvent('catalog-publish-request',{detail:{visit}}))}
  function status(id,status){let visit;DB.alterar(db=>{visit=db.visitas.find(v=>v.id===id);if(!visit)throw Error('Visita não encontrada');visit.status=status;visit.updatedAt=now()});publicar(visit);return visit}
  function atualizarPedido(id,orderStatus){let order;DB.alterar(db=>{order=db.catalogOrders.find(o=>o.id===id);if(!order)throw Error('Pedido não encontrado');order.orderStatus=orderStatus;order.updatedAt=now();const field={confirmado:'confirmedAt',separando:'preparingAt',deslocamento:'dispatchedAt',entregue:'deliveredAt',cancelado:'cancelledAt'}[orderStatus];if(field)order[field]=now()});dispatchEvent(new CustomEvent('catalog-order-status-request',{detail:{order}}));return order}
  const normalizedPhone=value=>window.Clientes?.normalizePhone?.(value)||String(value||'').replace(/\D/g,'');
  function clientesCompativeis(id){
    const order=DB.carregar().catalogOrders.find(item=>item.id===id);
    if(!order)return[];
    const phone=normalizedPhone(order.customerPhone);
    return DB.carregar().clientes.filter(client=>client.ativo!==false&&phone&&normalizedPhone(client.normalizedPhone||client.telefone)===phone);
  }
  function vincularCliente(id,clientId){
    let order,client;
    DB.alterar(db=>{
      order=db.catalogOrders.find(item=>item.id===id);
      client=db.clientes.find(item=>item.id===clientId);
      if(!order||!client)throw Error('Pedido ou cliente não encontrado');
      order.clientId=client.id;
      order.clientNameSnapshot=client.nome;
      order.linkedAt=now();
      order.keptAsGuest=false;
      order.updatedAt=now();
    });
    dispatchEvent(new CustomEvent('catalog-order-status-request',{detail:{order}}));
    return client;
  }
  function criarClienteParaPedido(id){
    const order=DB.carregar().catalogOrders.find(item=>item.id===id);
    if(!order)throw Error('Pedido não encontrado');
    const matches=clientesCompativeis(id);
    if(matches.length)throw Error('Já existe cliente com este telefone. Selecione-o para evitar duplicidade.');
    const client=window.Clientes?.salvar?.({nome:order.customerName,telefone:normalizedPhone(order.customerPhone),endereco:order.customerLocation||'',observacoes:'Cadastro criado a partir de pedido do Catálogo Online.',saldo:0,origemCadastro:'catalogo_online',ativo:true});
    if(!client)throw Error('Não foi possível criar o cliente');
    vincularCliente(id,client.id);
    return client;
  }
  function manterVisitante(id){
    let order;
    DB.alterar(db=>{order=db.catalogOrders.find(item=>item.id===id);if(!order)throw Error('Pedido não encontrado');order.clientId=null;order.clientNameSnapshot=order.customerName;order.keptAsGuest=true;order.updatedAt=now()});
    dispatchEvent(new CustomEvent('catalog-order-status-request',{detail:{order}}));
    return order;
  }
  function revisarVinculo(id){
    let order;
    DB.alterar(db=>{order=db.catalogOrders.find(item=>item.id===id);if(!order)throw Error('Pedido não encontrado');order.keptAsGuest=false;order.updatedAt=now()});
    dispatchEvent(new CustomEvent('catalog-order-status-request',{detail:{order}}));
    return order;
  }
  function converter(id,saleStatus='pago'){
    const existing=DB.carregar().catalogOrders.find(order=>order.id===id);
    if(!existing)throw Error('Pedido não encontrado');
    if(existing.convertedSaleId)return DB.carregar().vendas.find(venda=>venda.id===existing.convertedSaleId);
    const cliente=DB.carregar().clientes.find(item=>item.id===existing.clientId);
    if(saleStatus==='fiado'&&!cliente)throw Error('Vincule um cliente antes de registrar este pedido como fiado.');
    const operationId=`catalog-order:${id}`,sale=Vendas.registrar({operationId,clienteId:cliente?.id||null,status:saleStatus,formaPagamento:existing.paymentPreference,observacao:`Pedido online #${existing.publicOrderNumber}${existing.note?` — ${existing.note}`:''}`,itens:existing.items.map(item=>({produtoId:item.productId,nome:item.name,quantidade:item.quantity,precoOriginal:item.unitPrice,precoFinalUnitario:item.unitPrice,custoUnitario:Number(DB.carregar().produtos.find(produto=>produto.id===item.productId)?.custo||0)}))});
    DB.alterar(db=>{const order=db.catalogOrders.find(item=>item.id===id);order.clientId=cliente?.id||null;order.convertedSaleId=sale.id;order.orderStatus='entregue';order.deliveredAt=order.deliveredAt||now();order.updatedAt=now()});
    dispatchEvent(new CustomEvent('catalog-order-status-request',{detail:{order:DB.carregar().catalogOrders.find(order=>order.id===id)}}));
    return sale;
  }
  const link=visit=>{const url=new URL('./catalogo.html',location.href.split('#')[0]);url.searchParams.set('v',String(visit.publicToken||''));return url.href};
  return{listar,obter,ativa,pedidos,salvar,status,atualizarPedido,clientesCompativeis,vincularCliente,criarClienteParaPedido,manterVisitante,revisarVinculo,converter,publicar,link};
})();

window.VisitasUI=(()=>{
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const label={rascunho:'Rascunho',recebendo:'Recebendo pedidos',pedidos_encerrados:'Pedidos encerrados',separacao:'Em separação',deslocamento:'Em deslocamento',finalizada:'Finalizada',cancelada:'Cancelada',recebido:'Pendente',confirmado:'Confirmado',separando:'Separando',entregue:'Entregue',cancelado:'Cancelado'};
  const ico=n=>`<i data-lucide="${n}"></i>`;
  function stats(v){const orders=Visitas.pedidos(v.id),valid=orders.filter(o=>o.orderStatus!=='cancelado');return{orders,clientes:new Set(valid.map(o=>o.customerPhone||o.customerName)).size,total:valid.reduce((s,o)=>s+Number(o.total||0),0),itens:valid.reduce((s,o)=>s+o.items.reduce((a,i)=>a+Number(i.quantity||0),0),0)}}
  function visitCard(v){const s=stats(v);return `<article class="visit-card ${v.status==='recebendo'?'active':''}"><div class="visit-card-head"><div><span class="visit-eyebrow">${v.status==='recebendo'?'Visita ativa':'Visita'}</span><h3>${esc(v.nome)}</h3><p>${esc(v.local)} · ${new Date(`${v.data}T12:00:00`).toLocaleDateString('pt-BR')}</p></div><span class="visit-status status-${v.status}">${label[v.status]||v.status}</span></div><div class="visit-times"><span>${ico('clock')} Chegada <b>${esc(v.horarioChegada||'—')}</b></span><span>${ico('timer')} Pedidos até <b>${esc(v.horarioLimite||'—')}</b></span></div><div class="visit-stats"><span><b>${s.orders.length}</b><small>Pedidos</small></span><span><b>${s.clientes}</b><small>Clientes</small></span><span><b>${money(s.total)}</b><small>Total</small></span><span><b>${s.itens}</b><small>Itens</small></span></div><div class="visit-actions"><button data-visit-orders="${v.id}">${ico('clipboard-list')} Pedidos</button><button data-visit-share="${v.id}">${ico('share-2')} Compartilhar</button><button data-visit-edit="${v.id}">${ico('pencil')} Editar</button>${v.status==='recebendo'?`<button data-visit-close="${v.id}">${ico('lock')} Encerrar</button>`:''}${!['finalizada','cancelada'].includes(v.status)?`<button class="primary" data-visit-finish="${v.id}">${ico('check-circle')} Finalizar</button>`:''}</div></article>`}
  function render(){const all=Visitas.listar();return `<section class="page-head visit-page-head"><div><span class="eyebrow">Catálogo online</span><h2>Visitas e pedidos</h2><p>Organize os produtos de cada local e receba pedidos antecipados.</p></div><button class="btn btn-primary" id="new-visit">${ico('plus')} Criar visita</button></section>${all.length?`<section class="visit-grid">${all.map(visitCard).join('')}</section>`:`<section class="visit-empty">${ico('map-pin')}<h3>Crie sua primeira visita</h3><p>Defina o local, o horário e os produtos disponíveis para compartilhar o catálogo.</p><button class="btn btn-primary" id="empty-new-visit">Criar visita</button></section>`}`}
  function form(id){const v=id?Visitas.obter(id):null,p=DB.carregar().produtos.filter(x=>x.ativo!==false),selected=new Set((v?.catalogItems||[]).map(i=>i.productId)),today=new Date().toISOString().slice(0,10);document.querySelector('#modal').innerHTML=`<div class="modal-bg"><section class="modal-box modal-wide visit-form-modal"><header class="modal-head"><div><h3>${v?'Editar':'Nova'} visita</h3><small>Configure o local e o catálogo que o cliente verá.</small></div><button class="icon-btn close">${ico('x')}</button></header><form id="visit-form"><div class="modal-body"><input type="hidden" name="id" value="${v?.id||''}"><div class="form-grid"><label>Nome da visita<input name="nome" required value="${esc(v?.nome||'') }" placeholder="Ex.: Visita de sexta"></label><label>Local<input name="local" required value="${esc(v?.local||'') }" placeholder="Ex.: Shopping Iguatemi"></label><label>Data<input name="data" type="date" required value="${v?.data||today}"></label><label>Chegada prevista<input name="horarioChegada" type="time" required value="${v?.horarioChegada||'14:00'}"></label><label>Pedidos até<input name="horarioLimite" type="time" required value="${v?.horarioLimite||'13:30'}"></label><label>Status<select name="status"><option value="rascunho">Rascunho</option><option value="recebendo">Recebendo pedidos</option><option value="pedidos_encerrados">Pedidos encerrados</option><option value="separacao">Em separação</option><option value="deslocamento">Em deslocamento</option></select></label></div><label>Descrição<textarea name="descricao" placeholder="Informações úteis para os clientes">${esc(v?.descricao||'')}</textarea></label><div class="catalog-picker-head"><div><b>Produtos disponíveis</b><small>Use os produtos já cadastrados no app.</small></div><button type="button" class="btn btn-light btn-sm" id="select-all-products">Selecionar todos</button></div><div class="catalog-picker">${p.map(x=>`<label class="catalog-pick"><input type="checkbox" name="products" value="${x.id}" ${selected.has(x.id)||!v?'checked':''}><span class="product-initial">${esc(x.nome.slice(0,2).toUpperCase())}</span><span><b>${esc(x.nome)}</b><small>${money(x.preco)} · Estoque ${Number(x.estoqueAtual||0)}</small></span></label>`).join('')||'<p>Cadastre produtos antes de criar o catálogo.</p>'}</div></div><footer class="modal-foot"><button type="button" class="btn btn-light cancel">Cancelar</button><button class="btn btn-primary">Salvar e publicar</button></footer></form></section></div>`;const f=document.querySelector('#visit-form');if(v)f.elements.status.value=v.status;document.querySelectorAll('#modal .close,#modal .cancel').forEach(b=>b.onclick=()=>document.querySelector('#modal').innerHTML='');document.querySelector('#select-all-products').onclick=()=>document.querySelectorAll('[name=products]').forEach(x=>x.checked=true);f.onsubmit=e=>{e.preventDefault();const fd=new FormData(f),data=Object.fromEntries(fd);delete data.products;Visitas.salvar(data,fd.getAll('products'));document.querySelector('#modal').innerHTML='';Utils.toast('Visita salva e catálogo publicado');location.hash='#/visitas';dispatchEvent(new HashChangeEvent('hashchange'))};window.lucide?.createIcons()}
  function orders(id){const v=Visitas.obter(id),list=Visitas.pedidos(id).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));document.querySelector('#modal').innerHTML=`<div class="modal-bg"><section class="modal-box modal-wide orders-modal"><header class="modal-head"><div><h3>Pedidos · ${esc(v.nome)}</h3><small>${list.length} pedido(s) recebido(s)</small></div><button class="icon-btn close">${ico('x')}</button></header><div class="modal-body order-list">${list.map(o=>`<article class="order-card"><div class="order-card-head"><div><b>${esc(o.customerName)}</b><small>${esc(o.customerPhone)} · #${esc(o.publicOrderNumber)}</small></div><span class="order-status status-${o.orderStatus}">${label[o.orderStatus]||o.orderStatus}</span></div><ul>${o.items.map(i=>`<li><span>${i.quantity}× ${esc(i.name)}</span><b>${money(i.subtotal)}</b></li>`).join('')}</ul>${o.note?`<p class="order-note">${esc(o.note)}</p>`:''}<div class="order-total"><span>${esc(o.paymentPreference)}</span><b>${money(o.total)}</b></div><div class="order-actions">${o.orderStatus==='recebido'?`<button data-order-status="confirmado" data-order-id="${o.id}">Confirmar</button>`:''}${o.orderStatus==='confirmado'?`<button data-order-status="separando" data-order-id="${o.id}">Separar</button>`:''}${o.orderStatus==='separando'?`<button class="primary" data-order-deliver="${o.id}">Entregar</button>`:''}${!['entregue','cancelado'].includes(o.orderStatus)?`<button data-order-status="cancelado" data-order-id="${o.id}">Cancelar</button>`:''}<a href="https://wa.me/${String(o.customerPhone||'').replace(/\D/g,'')}" target="_blank">WhatsApp</a></div></article>`).join('')||'<div class="visit-empty"><p>Nenhum pedido recebido ainda.</p></div>'}</div><footer class="modal-foot"><button class="btn btn-light close">Fechar</button></footer></section></div>`;document.querySelectorAll('#modal .close').forEach(b=>b.onclick=()=>document.querySelector('#modal').innerHTML='');document.querySelector('.order-list').onclick=e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.orderStatus){Visitas.atualizarPedido(b.dataset.orderId,b.dataset.orderStatus);orders(id)}if(b.dataset.orderDeliver)deliver(b.dataset.orderDeliver,id)};window.lucide?.createIcons()}
  let onlineOrderFilter='todos',onlineOrderQuery='';
  const orderRank=status=>({recebido:0,confirmado:1,separando:2,entregue:3,cancelado:4}[status]??5);
  const onlineOrders=()=>[...(DB.carregar().catalogOrders||[])].filter(order=>!order.deletedAt).filter(order=>onlineOrderFilter==='todos'||order.orderStatus===onlineOrderFilter).filter(order=>!onlineOrderQuery||`${order.publicOrderNumber} ${order.customerName} ${order.customerPhone} ${order.customerLocation}`.toLowerCase().includes(onlineOrderQuery)).sort((a,b)=>orderRank(a.orderStatus)-orderRank(b.orderStatus)||new Date(a.createdAt)-new Date(b.createdAt));
  function clientLinkBlock(order){
    if(order.clientId){
      const client=DB.carregar().clientes.find(item=>item.id===order.clientId);
      return `<div class="order-client-link linked">${ico('circle-check')}<span><b>Cliente vinculado</b><small>${esc(client?.nome||order.clientNameSnapshot||order.customerName)}</small></span></div>`;
    }
    if(order.keptAsGuest)return `<div class="order-client-link guest">${ico('user-round')}<span><b>Visitante</b><small>Pedido mantido sem vínculo de cliente</small></span><button data-review-link="${order.id}">Revisar</button></div>`;
    const matches=Visitas.clientesCompativeis(order.id);
    if(matches.length===1)return `<div class="order-client-link suggested">${ico('user-check')}<span><b>Cliente encontrado</b><small>${esc(matches[0].nome)} · mesmo WhatsApp</small></span><button class="primary" data-link-order="${order.id}" data-client-id="${matches[0].id}">Vincular cliente</button><button data-keep-guest="${order.id}">Manter visitante</button></div>`;
    if(matches.length>1)return `<div class="order-client-link suggested">${ico('users')}<span><b>${matches.length} clientes encontrados</b><small>Escolha o cadastro correto</small></span><select data-client-select="${order.id}">${matches.map(client=>`<option value="${client.id}">${esc(client.nome)}</option>`).join('')}</select><button class="primary" data-link-selected="${order.id}">Vincular cliente</button><button data-keep-guest="${order.id}">Manter visitante</button></div>`;
    return `<div class="order-client-link new-client">${ico('user-plus')}<span><b>Nenhum cliente encontrado</b><small>O WhatsApp não consta no cadastro atual.</small></span><button class="primary" data-create-client="${order.id}">Criar novo cliente</button><button data-keep-guest="${order.id}">Manter visitante</button></div>`;
  }
  function onlineOrderCard(order){
    const visit=Visitas.obter(order.visitId),created=new Date(order.createdAt),time=Number.isNaN(created.getTime())?'—':created.toLocaleString('pt-BR',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
    return `<article class="order-card online-order-card">
      <div class="order-card-head"><div><span class="visit-eyebrow">${esc(visit?.nome||'Catálogo online')}</span><b>#${esc(order.publicOrderNumber||order.id.slice(0,8))} · ${esc(order.customerName)}</b><small>${esc(order.customerPhone)} · ${esc(order.customerLocation||'Local não informado')} · ${time}</small></div><span class="order-status status-${order.orderStatus}">${label[order.orderStatus]||order.orderStatus}</span></div>
      <ul>${(order.items||[]).map(item=>`<li><span>${Number(item.quantity)}× ${esc(item.name)}</span><b>${money(item.subtotal)}</b></li>`).join('')}</ul>
      ${order.note?`<p class="order-note">${esc(order.note)}</p>`:''}
      <div class="order-total"><span>${esc({entrega:'Pagar na entrega',pix:'PIX',dinheiro:'Dinheiro',cartao:'Cartão',fiado:'Adicionar à conta'}[order.paymentPreference]||order.paymentPreference)}</span><b>${money(order.total)}</b></div>
      ${clientLinkBlock(order)}
      <div class="order-actions">${order.orderStatus==='recebido'?`<button class="primary" data-online-status="confirmado" data-order-id="${order.id}">Confirmar</button>`:''}${order.orderStatus==='confirmado'?`<button class="primary" data-online-status="separando" data-order-id="${order.id}">Separar</button>`:''}${order.orderStatus==='separando'?`<button class="primary" data-online-deliver="${order.id}">Entregar</button>`:''}${!['entregue','cancelado'].includes(order.orderStatus)?`<button data-online-status="cancelado" data-order-id="${order.id}">Cancelar</button>`:''}<a href="https://wa.me/${String(order.customerPhone||'').replace(/\D/g,'')}" target="_blank" rel="noopener">WhatsApp</a></div>
    </article>`;
  }
  function renderOrdersPage(){
    const all=DB.carregar().catalogOrders||[],received=all.filter(order=>order.orderStatus==='recebido').length,list=onlineOrders();
    return `<section class="page-head online-orders-head"><div><span class="eyebrow">Catálogo online</span><h2>Pedidos online ${received?`<span class="new-order-badge">${received}</span>`:''}</h2><p>Receba, vincule e acompanhe os pedidos enviados pelos clientes.</p></div></section>
      <section class="online-orders-toolbar"><input class="search" id="online-order-search" value="${esc(onlineOrderQuery)}" placeholder="Buscar pedido, cliente, telefone ou local..."><select id="online-order-filter"><option value="todos">Todos</option><option value="recebido">Recebidos</option><option value="confirmado">Confirmados</option><option value="separando">Separando</option><option value="entregue">Entregues</option><option value="cancelado">Cancelados</option></select></section>
      <section class="online-order-summary"><b>${list.length}</b><span>pedido(s) exibido(s)</span><small>Recebidos aparecem primeiro; dentro de cada status, os mais antigos ficam no topo.</small></section>
      <section class="order-list online-orders-list">${list.map(onlineOrderCard).join('')||'<div class="visit-empty"><p>Nenhum pedido encontrado.</p></div>'}</section>`;
  }
  function bindOrdersPage(){
    const filter=document.querySelector('#online-order-filter');if(filter)filter.value=onlineOrderFilter;
    filter?.addEventListener('change',event=>{onlineOrderFilter=event.target.value;dispatchEvent(new HashChangeEvent('hashchange'))});
    document.querySelector('#online-order-search')?.addEventListener('input',event=>{onlineOrderQuery=event.target.value.trim().toLowerCase();const list=document.querySelector('.online-orders-list');if(list){list.innerHTML=onlineOrders().map(onlineOrderCard).join('')||'<div class="visit-empty"><p>Nenhum pedido encontrado.</p></div>';window.lucide?.createIcons()}});
    document.querySelector('.online-orders-list')?.addEventListener('click',event=>{
      const button=event.target.closest('button');if(!button)return;
      try{
        if(button.dataset.linkOrder){Visitas.vincularCliente(button.dataset.linkOrder,button.dataset.clientId);Utils.toast('Cliente vinculado ao pedido.')}
        if(button.dataset.linkSelected){const select=document.querySelector(`[data-client-select="${button.dataset.linkSelected}"]`);Visitas.vincularCliente(button.dataset.linkSelected,select.value);Utils.toast('Cliente vinculado ao pedido.')}
        if(button.dataset.createClient){Visitas.criarClienteParaPedido(button.dataset.createClient);Utils.toast('Cliente criado e vinculado sem duplicar cadastro.')}
        if(button.dataset.keepGuest){Visitas.manterVisitante(button.dataset.keepGuest);Utils.toast('Pedido mantido como visitante.')}
        if(button.dataset.reviewLink){Visitas.revisarVinculo(button.dataset.reviewLink);Utils.toast('Sugestões de vínculo reabertas.')}
        if(button.dataset.onlineStatus){Visitas.atualizarPedido(button.dataset.orderId,button.dataset.onlineStatus);Utils.toast('Status do pedido atualizado.')}
        if(button.dataset.onlineDeliver)return deliver(button.dataset.onlineDeliver,DB.carregar().catalogOrders.find(item=>item.id===button.dataset.onlineDeliver)?.visitId);
        dispatchEvent(new HashChangeEvent('hashchange'));
      }catch(error){Utils.toast(error.message||'Não foi possível atualizar o pedido.',true)}
    });
  }
  function deliver(orderId,visitId){const o=DB.carregar().catalogOrders.find(x=>x.id===orderId);document.querySelector('#modal').innerHTML=`<div class="modal-bg"><section class="modal-box"><header class="modal-head"><h3>Pedido entregue</h3></header><div class="modal-body"><p>Deseja registrar o pedido <b>#${esc(o.publicOrderNumber)}</b> como venda?</p><p>Total: <b>${money(o.total)}</b></p></div><footer class="modal-foot conversion-actions"><button data-convert="pago" class="btn btn-primary">Venda paga</button><button data-convert="fiado" class="btn btn-light">Venda fiado</button><button data-deliver-only class="btn btn-light">Apenas entregar</button><button data-cancel class="btn btn-light">Cancelar</button></footer></section></div>`;document.querySelector('[data-cancel]').onclick=()=>orders(visitId);document.querySelector('[data-deliver-only]').onclick=()=>{Visitas.atualizarPedido(orderId,'entregue');orders(visitId)};document.querySelectorAll('[data-convert]').forEach(b=>b.onclick=()=>{try{Visitas.converter(orderId,b.dataset.convert);Utils.toast('Pedido entregue e venda registrada');orders(visitId)}catch(e){Utils.toast(e.message,true)}})}
  async function share(id){const v=Visitas.obter(id);Visitas.publicar(v);const url=Visitas.link(v),text=`Olá! Estarei no ${v.local} às ${v.horarioChegada}. 😊\n\nVeja os produtos disponíveis e faça seu pedido antecipadamente:\n${url}\n\nPedidos até ${v.horarioLimite}.`;try{if(navigator.share)await navigator.share({title:`Catálogo ${v.nome}`,text,url});else{await navigator.clipboard.writeText(text);Utils.toast('Link do catálogo copiado')}}catch(e){if(e.name!=='AbortError')Utils.toast('Não foi possível compartilhar',true)}}
  function bind(){document.querySelector('#new-visit')?.addEventListener('click',()=>form());document.querySelector('#empty-new-visit')?.addEventListener('click',()=>form());document.querySelector('.visit-grid')?.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.visitEdit)form(b.dataset.visitEdit);if(b.dataset.visitOrders)orders(b.dataset.visitOrders);if(b.dataset.visitShare)share(b.dataset.visitShare);if(b.dataset.visitClose){Visitas.status(b.dataset.visitClose,'pedidos_encerrados');Utils.toast('Pedidos encerrados');dispatchEvent(new HashChangeEvent('hashchange'))}if(b.dataset.visitFinish&&confirm('Finalizar esta visita e bloquear novos pedidos?')){Visitas.status(b.dataset.visitFinish,'finalizada');Utils.toast('Visita finalizada');dispatchEvent(new HashChangeEvent('hashchange'))}})}
  return{render,bind,renderOrdersPage,bindOrdersPage};
})();
