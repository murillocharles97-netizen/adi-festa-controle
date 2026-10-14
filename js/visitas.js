window.Visitas=(()=>{
  const now=()=>new Date().toISOString();
  const salesSpaceId=requested=>{const explicit=String(requested||'').trim();if(!explicit||['all','all_spaces'].includes(explicit))throw Error('Selecione explicitamente um espaço de venda real.');if(window.SpaceContext?.requireSalesSpace)return SpaceContext.requireSalesSpace(explicit);return explicit};
  const token=()=>Array.from(crypto.getRandomValues(new Uint8Array(18)),b=>b.toString(16).padStart(2,'0')).join('');
  const listar=()=>[...DB.carregar().visitas].sort((a,b)=>new Date(b.createdAt)-new Date(a.createdAt));
  const obter=id=>DB.carregar().visitas.find(v=>v.id===id);
  const ativa=()=>listar().find(v=>['recebendo','pedidos_encerrados','separacao','deslocamento'].includes(v.status));
  function canReadOrder(order){const c=window.BusinessContext?.get?.();if(!c)return true;return c.role==='owner'||Boolean(window.TeamAccess?.has?.('sales.viewAll')&&order.spaceId&&window.BusinessContext.canAccessSpace(order.spaceId));}
  const pedidos=visitId=>DB.carregar().catalogOrders.filter(o=>o.visitId===visitId&&!o.deletedAt&&canReadOrder(o));
  const snapshotProduto=(p,old={})=>({id:old.id||Utils.uuid(),productId:p.id,productName:p.nome,productImage:window.getProductDisplayImage?.(p)?.url||p.imageThumbUrl||p.imageUrl||p.imagem||'',productMainImage:window.getProductDisplayImage?.(p,null,{preferMain:true})?.url||p.imageUrl||p.imagem||'',imageUpdatedAt:p.imageUpdatedAt||p.image?.updatedAt||null,category:p.categoria||'Outros',description:p.descricao||p.palavrasChave||'',originalPrice:Number(p.preco||0),salePrice:Number(old.salePrice??p.preco??0),availableQuantity:Number(old.availableQuantity??p.estoqueAtual??0),maxPerCustomer:Number(old.maxPerCustomer||0),featured:Boolean(old.featured),active:old.active!==false,controlaEstoque:old.controlaEstoque??!p.semControleEstoque,displayOrder:Number(old.displayOrder||0)});
  function salvar(data,selected=[]){if(!data.id&&window.PlanLimitService)PlanLimitService.assert(PlanLimitService.canUseOnlineCatalog(),'usar o catálogo online');const spaceId=salesSpaceId(data.spaceId);let saved;DB.alterar(db=>{const index=db.visitas.findIndex(v=>v.id===data.id),old=index>=0?db.visitas[index]:null,oldItems=new Map((old?.catalogItems||[]).map(i=>[i.productId,i])),catalogItems=selected.map(id=>{const p=db.produtos.find(x=>x.id===id);if(!p)throw Error('Produto não encontrado.');if(window.SpaceEngine?.productAllowsSpace&&!SpaceEngine.productAllowsSpace(p,spaceId))throw Error(`${p.nome} não está disponível neste espaço.`);return snapshotProduto(p,oldItems.get(id))});saved={...old,...data,spaceId,id:data.id||Utils.uuid(),publicToken:old?.publicToken||token(),catalogItems,createdAt:old?.createdAt||now(),updatedAt:now()};if(index>=0)db.visitas[index]=saved;else db.visitas.push(saved)});publicar(saved);return saved}
  function publicar(visit){dispatchEvent(new CustomEvent('catalog-publish-request',{detail:{visit}}))}
  function status(id,status){let visit;DB.alterar(db=>{visit=db.visitas.find(v=>v.id===id);if(!visit)throw Error('Visita não encontrada');visit.status=status;visit.updatedAt=now()});publicar(visit);return visit}
  function atualizarPedido(id,orderStatus){let order,changed=false;DB.alterar(db=>{order=db.catalogOrders.find(o=>o.id===id);if(!order)throw Error('Pedido não encontrado');if(order.orderStatus===orderStatus)return;const allowed={recebido:['confirmado','cancelado'],confirmado:['separando','cancelado'],separando:['entregue','cancelado'],deslocamento:['entregue','cancelado'],entregue:[],cancelado:[]};if(!(allowed[order.orderStatus]||[]).includes(orderStatus))throw Error('Esta mudança de status não é permitida. Atualize a tela e tente novamente.');order.orderStatus=orderStatus;order.updatedAt=now();order.statusOperationId=`catalog-order-status:${id}:${orderStatus}`;const field={confirmado:'confirmedAt',separando:'preparingAt',deslocamento:'dispatchedAt',entregue:'deliveredAt',cancelado:'cancelledAt'}[orderStatus];if(field)order[field]=order[field]||now();changed=true});if(changed)dispatchEvent(new CustomEvent('catalog-order-status-request',{detail:{order}}));return order}
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
    const operationId=`catalog-order:${id}`,data=DB.carregar(),visit=data.visitas.find(item=>item.id===existing.visitId),legacySpaceId=existing.spaceId||visit?.spaceId;
    if(!legacySpaceId)throw Error('Este pedido legado não possui espaço. Edite e salve a visita antes de convertê-lo em venda.');
    const spaceId=salesSpaceId(legacySpaceId),sale=Vendas.registrar({operationId,spaceId,financialSpaceId:spaceId,clienteId:cliente?.id||null,status:saleStatus,formaPagamento:existing.paymentPreference,observacao:`Pedido online #${existing.publicOrderNumber}${existing.note?` — ${existing.note}`:''}`,itens:existing.items.map(item=>{const product=data.produtos.find(produto=>produto.id===item.productId),variant=item.variantId?(data.variacoesProdutos||[]).find(entry=>entry.id===item.variantId):null;return{produtoId:item.productId,variantId:item.variantId||null,nome:item.name,productNameSnapshot:item.productNameSnapshot||product?.nome,variantNameSnapshot:item.variantNameSnapshot||variant?.displayName||null,attributesSnapshot:item.attributesSnapshot||variant?.attributeValues||null,sku:item.sku||variant?.sku||'',barcode:item.barcode||variant?.barcode||'',quantidade:item.quantity,precoOriginal:item.unitPrice,precoFinalUnitario:item.unitPrice,custoUnitario:Number(variant?.cost??product?.custo??0)}})});
    DB.alterar(db=>{const order=db.catalogOrders.find(item=>item.id===id);order.clientId=cliente?.id||null;order.convertedSaleId=sale.id;order.orderStatus='entregue';order.deliveredAt=order.deliveredAt||now();order.updatedAt=now()});
    dispatchEvent(new CustomEvent('catalog-order-status-request',{detail:{order:DB.carregar().catalogOrders.find(order=>order.id===id)}}));
    return sale;
  }
  const link=visit=>{const url=new URL('./catalogo.html',location.href.split('#')[0]);url.searchParams.set('v',String(visit.publicToken||''));return url.href};
  const guarded=(fn,readOnly=false)=>(id,...args)=>{const order=DB.carregar().catalogOrders.find(o=>o.id===id);if(window.OnlineOrderModel?.isV2(order))throw Error('Use as ações seguras de Pedidos Online para este pedido.');if(order&&!canReadOrder(order))throw Error('Sem permissão para este pedido.');if(!readOnly)throw Error('Pedidos da loja anterior são históricos somente para consulta.');return fn(id,...args);};
  return{listar,obter,ativa,pedidos,salvar,status,atualizarPedido:guarded(atualizarPedido),clientesCompativeis:guarded(clientesCompativeis,true),vincularCliente:guarded(vincularCliente),criarClienteParaPedido:guarded(criarClienteParaPedido),manterVisitante:guarded(manterVisitante),revisarVinculo:guarded(revisarVinculo),converter:guarded(converter),canReadOrder,publicar,link};
})();

window.VisitasUI=(()=>{
  const money=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),esc=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const label={rascunho:'Rascunho',recebendo:'Recebendo pedidos',pedidos_encerrados:'Pedidos encerrados',separacao:'Em separação',deslocamento:'Em deslocamento',finalizada:'Finalizada',cancelada:'Cancelada',recebido:'Pendente',confirmado:'Confirmado',separando:'Separando',entregue:'Entregue',cancelado:'Cancelado'};
  const ico=n=>`<i data-lucide="${n}"></i>`;
  function stats(v){const orders=Visitas.pedidos(v.id),valid=orders.filter(o=>o.orderStatus!=='cancelado');return{orders,clientes:new Set(valid.map(o=>o.customerPhone||o.customerName)).size,total:valid.reduce((s,o)=>s+Number(o.total||0),0),itens:valid.reduce((s,o)=>s+o.items.reduce((a,i)=>a+Number(i.quantity||0),0),0)}}
  function visitCard(v){const s=stats(v);return `<article class="visit-card ${v.status==='recebendo'?'active':''}"><div class="visit-card-head"><div><span class="visit-eyebrow">${v.status==='recebendo'?'Visita ativa':'Visita'}</span><h3>${esc(v.nome)}</h3><p>${esc(v.local)} · ${new Date(`${v.data}T12:00:00`).toLocaleDateString('pt-BR')}</p></div><span class="visit-status status-${v.status}">${label[v.status]||v.status}</span></div><div class="visit-times"><span>${ico('clock')} Chegada <b>${esc(v.horarioChegada||'—')}</b></span><span>${ico('timer')} Pedidos até <b>${esc(v.horarioLimite||'—')}</b></span></div><div class="visit-stats"><span><b>${s.orders.length}</b><small>Pedidos</small></span><span><b>${s.clientes}</b><small>Clientes</small></span><span><b>${money(s.total)}</b><small>Total</small></span><span><b>${s.itens}</b><small>Itens</small></span></div><div class="visit-actions"><button data-visit-orders="${v.id}">${ico('clipboard-list')} Pedidos</button><button data-visit-share="${v.id}">${ico('share-2')} Compartilhar</button><button data-visit-edit="${v.id}">${ico('pencil')} Editar</button>${v.status==='recebendo'?`<button data-visit-close="${v.id}">${ico('lock')} Encerrar</button>`:''}${!['finalizada','cancelada'].includes(v.status)?`<button class="primary" data-visit-finish="${v.id}">${ico('check-circle')} Finalizar</button>`:''}</div></article>`}
  function render(){const all=Visitas.listar();return `<section class="page-head visit-page-head"><div><span class="eyebrow">Catálogo online</span><h2>Visitas e pedidos</h2><p>Organize os produtos de cada local e receba pedidos antecipados.</p></div><button class="btn btn-primary" id="new-visit">${ico('plus')} Criar visita</button></section>${all.length?`<section class="visit-grid">${all.map(visitCard).join('')}</section>`:`<section class="visit-empty">${ico('map-pin')}<h3>Crie sua primeira visita</h3><p>Defina o local, o horário e os produtos disponíveis para compartilhar o catálogo.</p><button class="btn btn-primary" id="empty-new-visit">Criar visita</button></section>`}`}
  function form(id){const v=id?Visitas.obter(id):null,spaceId=String(v?.spaceId||window.SpaceContext?.salesId?.()||''),space=window.SpaceContext?.list?.().find(item=>item.id===spaceId),p=DB.carregar().produtos.filter(x=>x.ativo!==false&&(!window.SpaceEngine?.productAllowsSpace||SpaceEngine.productAllowsSpace(x,spaceId))),selected=new Set((v?.catalogItems||[]).map(i=>i.productId)),today=new Date().toISOString().slice(0,10);document.querySelector('#modal').innerHTML=`<div class="modal-bg"><section class="modal-box modal-wide visit-form-modal"><header class="modal-head"><div><h3>${v?'Editar':'Nova'} visita</h3><small>Configure o local e o catálogo que o cliente verá.</small></div><button class="icon-btn close">${ico('x')}</button></header><form id="visit-form"><div class="modal-body"><input type="hidden" name="id" value="${v?.id||''}"><input type="hidden" name="spaceId" value="${esc(spaceId)}"><div class="form-grid"><label>Nome da visita<input name="nome" required value="${esc(v?.nome||'') }" placeholder="Ex.: Visita de sexta"></label><label>Local<input name="local" required value="${esc(v?.local||'') }" placeholder="Ex.: Shopping Iguatemi"></label><label>Data<input name="data" type="date" required value="${v?.data||today}"></label><label>Chegada prevista<input name="horarioChegada" type="time" required value="${v?.horarioChegada||'14:00'}"></label><label>Pedidos até<input name="horarioLimite" type="time" required value="${v?.horarioLimite||'13:30'}"></label><label>Status<select name="status"><option value="rascunho">Rascunho</option><option value="recebendo">Recebendo pedidos</option><option value="pedidos_encerrados">Pedidos encerrados</option><option value="separacao">Em separação</option><option value="deslocamento">Em deslocamento</option></select></label></div><p class="muted">Espaço de venda: <b>${esc(space?.name||'Espaço atual')}</b>. O catálogo mostra apenas itens disponíveis nele.</p><label>Descrição<textarea name="descricao" placeholder="Informações úteis para os clientes">${esc(v?.descricao||'')}</textarea></label><div class="catalog-picker-head"><div><b>Produtos disponíveis</b><small>Use os produtos já cadastrados no app.</small></div><button type="button" class="btn btn-light btn-sm" id="select-all-products">Selecionar todos</button></div><div class="catalog-picker">${p.map(x=>`<label class="catalog-pick"><input type="checkbox" name="products" value="${x.id}" ${selected.has(x.id)||!v?'checked':''}><span class="product-initial">${esc(x.nome.slice(0,2).toUpperCase())}</span><span><b>${esc(x.nome)}</b><small>${money(x.preco)} · ${x.itemKind==='service'?'Serviço':`Estoque ${Number(x.estoqueAtual||0)}`}</small></span></label>`).join('')||'<p>Nenhum item está disponível neste espaço.</p>'}</div></div><footer class="modal-foot"><button type="button" class="btn btn-light cancel">Cancelar</button><button class="btn btn-primary">Salvar e publicar</button></footer></form></section></div>`;const f=document.querySelector('#visit-form');if(v)f.elements.status.value=v.status;document.querySelectorAll('#modal .close,#modal .cancel').forEach(b=>b.onclick=()=>document.querySelector('#modal').innerHTML='');document.querySelector('#select-all-products').onclick=()=>document.querySelectorAll('[name=products]').forEach(x=>x.checked=true);f.onsubmit=e=>{e.preventDefault();const fd=new FormData(f),data=Object.fromEntries(fd);delete data.products;try{Visitas.salvar(data,fd.getAll('products'));document.querySelector('#modal').innerHTML='';Utils.toast('Visita salva e catálogo publicado');location.hash='#/visitas';dispatchEvent(new HashChangeEvent('hashchange'))}catch(error){Utils.toast(error.message||'Não foi possível salvar a visita.',true)}};window.lucide?.createIcons()}
  function orders(id){window.OnlineOrdersUI?.history(id);}
  async function share(id){const v=Visitas.obter(id);Visitas.publicar(v);const url=Visitas.link(v),text=`Olá! Estarei no ${v.local} às ${v.horarioChegada}. 😊\n\nVeja os produtos disponíveis e faça seu pedido antecipadamente:\n${url}\n\nPedidos até ${v.horarioLimite}.`;try{if(navigator.share)await navigator.share({title:`Catálogo ${v.nome}`,text,url});else{await navigator.clipboard.writeText(text);Utils.toast('Link do catálogo copiado')}}catch(e){if(e.name!=='AbortError')Utils.toast('Não foi possível compartilhar',true)}}
  const renderOrdersPage=()=>window.OnlineOrdersUI?.render()||'<p>Pedidos Online indisponíveis. Recarregue a aplicação.</p>';
  const bindOrdersPage=()=>window.OnlineOrdersUI?.bind();
  function bind(){document.querySelector('#new-visit')?.addEventListener('click',()=>form());document.querySelector('#empty-new-visit')?.addEventListener('click',()=>form());document.querySelector('.visit-grid')?.addEventListener('click',e=>{const b=e.target.closest('button');if(!b)return;if(b.dataset.visitEdit)form(b.dataset.visitEdit);if(b.dataset.visitOrders)orders(b.dataset.visitOrders);if(b.dataset.visitShare)share(b.dataset.visitShare);if(b.dataset.visitClose){Visitas.status(b.dataset.visitClose,'pedidos_encerrados');Utils.toast('Pedidos encerrados');dispatchEvent(new HashChangeEvent('hashchange'))}if(b.dataset.visitFinish&&confirm('Finalizar esta visita e bloquear novos pedidos?')){Visitas.status(b.dataset.visitFinish,'finalizada');Utils.toast('Visita finalizada');dispatchEvent(new HashChangeEvent('hashchange'))}})}
  return{render,bind,renderOrdersPage,bindOrdersPage};
})();
