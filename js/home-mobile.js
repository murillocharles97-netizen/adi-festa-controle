(function(){
  'use strict';
  const mq=matchMedia('(max-width: 767px)');
  const $=(selector,root=document)=>root.querySelector(selector);
  const icon=name=>`<i data-lucide="${name}"></i>`;
  const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const dayKey=value=>{const date=value instanceof Date?value:new Date(value);return Number.isNaN(date.getTime())?'':`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`};
  const startOfDay=value=>{const date=new Date(value);date.setHours(0,0,0,0);return date};
  const isValidSale=sale=>sale&&sale.ativo!==false&&!sale.deletedAt&&!['cancelado','cancelada','desfeito','venda_desfeita'].includes(String(sale.status||'').toLowerCase());
  const saleValue=sale=>Number(sale.valorFinal??sale.valorTotal??0);
  const saleCost=sale=>Number.isFinite(Number(sale.custoTotal))?Number(sale.custoTotal):(sale.itens||[]).reduce((sum,item)=>sum+Number(item.custoTotal??Number(item.custoUnitario||0)*Number(item.quantidade||0)),0);
  const percentage=(today,yesterday)=>yesterday>0?(today-yesterday)/yesterday*100:null;
  const renewalCache={value:null,updatedAt:0,promise:null};
  const RENEWAL_CACHE_MS=120000;
  function greeting(){const hour=new Date().getHours();return hour<12?'Bom dia':hour<18?'Boa tarde':'Boa noite'}
  function model(){
    const db=DB.carregar(),now=new Date(),todayKey=dayKey(now),yesterday=new Date(now);yesterday.setDate(yesterday.getDate()-1);
    const sales=(db.vendas||[]).filter(isValidSale),today=sales.filter(sale=>dayKey(sale.data)===todayKey),yesterdaySales=sales.filter(sale=>dayKey(sale.data)===dayKey(yesterday));
    const sold=today.reduce((sum,sale)=>sum+saleValue(sale),0),cost=today.reduce((sum,sale)=>sum+saleCost(sale),0),profit=sold-cost;
    const soldYesterday=yesterdaySales.reduce((sum,sale)=>sum+saleValue(sale),0),profitYesterday=yesterdaySales.reduce((sum,sale)=>sum+saleValue(sale)-saleCost(sale),0);
    const items=today.reduce((sum,sale)=>sum+(sale.itens||[]).reduce((subtotal,item)=>subtotal+Number(item.quantidade||0),0),0);
    const customers=new Set(today.map(sale=>sale.clienteId).filter(Boolean)).size;
    const newCustomers=(db.clientes||[]).filter(client=>dayKey(client.criadoEm)===todayKey).length;
    const debtors=(db.clientes||[]).filter(client=>client.ativo!==false&&Number(client.saldo)<0),debt=debtors.reduce((sum,client)=>sum+Math.abs(Number(client.saldo)),0);
    const products=(db.produtos||[]).filter(product=>product.ativo!==false),out=products.filter(product=>getProductStockStatus(product)==='esgotado'),low=products.filter(product=>getProductStockStatus(product)==='baixo');
    const localRenewals=window.CustomerSubscriptions?.metrics?.(now.toISOString())||{dueToday:0,due7:0,forecastValue:0},renewals=renewalCache.value||localRenewals;
    const pendingOrders=(db.catalogOrders||[]).filter(order=>!order.deletedAt&&['recebido','pendente','novo'].includes(String(order.orderStatus||order.status||'').toLowerCase()));
    const goal=Number(db.config?.dashboard?.dailySalesGoal??db.config?.dailySalesGoal??0),goalPercent=goal>0?sold/goal*100:0;
    const week=[];for(let offset=6;offset>=0;offset--){const date=new Date(now);date.setDate(date.getDate()-offset);const key=dayKey(date);week.push({date,key,label:date.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.',''),value:sales.filter(sale=>dayKey(sale.data)===key).reduce((sum,sale)=>sum+saleValue(sale),0),today:offset===0})}
    const name=String(window.FirebaseSession?.profile?.name||db.config?.responsavel||'').trim().split(/\s+/)[0]||'Murillo';
    return{db,now,sales,today,sold,cost,profit,margin:sold>0?profit/sold*100:0,soldYesterday,profitYesterday,items,customers,newCustomers,debtors,debt,products,out,low,renewals,pendingOrders,goal,goalPercent,week,name};
  }
  function comparison(value,previous){const pct=percentage(value,previous);if(pct===null)return'<small>Sem comparação com ontem</small>';const up=pct>=0;return`<small class="${up?'positive':'negative'}">${icon(up?'trending-up':'trending-down')} ${up?'+':''}${pct.toFixed(0)}% vs. ontem</small>`}
  function smartMessage(data){if(!data.today.length)return'Ainda não houve vendas hoje. Bora começar?';if(data.goal>0&&data.sold>=data.goal)return'Meta atingida! Excelente trabalho hoje.';if(data.goal>0)return`Faltam ${money(Math.max(0,data.goal-data.sold))} para bater sua meta.`;return'Aqui está o resumo do seu dia.'}
  function goalCard(data){
    if(!data.goal)return`<button class="home-goal-card empty-goal" type="button" data-home-goal>${icon('target')}<span><b>Defina sua meta do dia</b><small>Acompanhe o progresso das suas vendas.</small></span><em>Configurar ${icon('chevron-right')}</em></button>`;
    const visual=Math.min(100,Math.max(0,data.goalPercent)),reached=data.goalPercent>=100;
    return`<section class="home-goal-card ${reached?'reached':''}"><header><span>${icon('target')} Meta do dia</span><strong>${data.goalPercent.toFixed(0)}%</strong></header><div class="goal-values"><strong>${money(data.sold)}</strong><span>/ ${money(data.goal)}</span></div><div class="goal-progress" aria-label="${data.goalPercent.toFixed(0)}% da meta"><span style="--goal:${visual}%"></span></div><div class="goal-footer"><p>${reached?`${icon('circle-check')} Meta atingida!`:`${icon('trending-up')} Faltam ${money(Math.max(0,data.goal-data.sold))} para bater a meta.`}</p><button type="button" data-home-goal>${reached?'Detalhes':'Editar'} ${icon('chevron-right')}</button></div></section>`
  }
  function chart(data){
    const width=640,height=150,padX=25,padTop=25,base=112,max=Math.max(...data.week.map(point=>point.value),1),step=(width-padX*2)/6;
    const points=data.week.map((point,index)=>({x:padX+step*index,y:base-(point.value/max)*(base-padTop),...point}));
    const line=points.map((point,index)=>`${index?'L':'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' '),area=`${line} L ${points.at(-1).x} ${base} L ${points[0].x} ${base} Z`;
    return`<section class="home-chart"><header><h3>Vendas dos últimos 7 dias</h3></header><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Vendas dos últimos sete dias"><defs><linearGradient id="home-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#31d0ad" stop-opacity=".32"/><stop offset="1" stop-color="#31d0ad" stop-opacity=".03"/></linearGradient></defs><path class="area" d="${area}"/><path class="line" d="${line}"/>${points.map(point=>`<g class="${point.today?'today':''}"><circle cx="${point.x}" cy="${point.y}" r="6"/><text class="value" x="${point.x}" y="${Math.max(14,point.y-13)}">${point.value?Math.round(point.value):'0'}</text><text class="label" x="${point.x}" y="140">${esc(point.label)}</text></g>`).join('')}</svg></section>`
  }
  function attentionItems(data){
    const list=[];
    if(data.out.length||data.low.length)list.push({priority:data.out.length?1:4,icon:'triangle-alert',tone:data.out.length?'danger':'warning',title:'Estoque',detail:`${data.out.length?`${data.out.length} em falta`:''}${data.out.length&&data.low.length?' · ':''}${data.low.length?`${data.low.length} com estoque baixo`:''}`,action:'Ver estoque',target:'products-attention'});
    if(data.renewals.dueToday||data.renewals.due7)list.push({priority:data.renewals.dueToday?2:4,icon:'refresh-cw',tone:data.renewals.dueToday?'danger':'blue',title:'Renovações',detail:`${data.renewals.dueToday?`${data.renewals.dueToday} vence${data.renewals.dueToday===1?'':'m'} hoje`:''}${data.renewals.dueToday&&data.renewals.due7?' · ':''}${data.renewals.due7?`${data.renewals.due7} nos próximos 7 dias`:''}`,meta:`${money(data.renewals.forecastValue)} previstos`,action:'Ver clientes',target:'clients-renewals'});
    if(data.pendingOrders.length)list.push({priority:3,icon:'clipboard-list',tone:'blue',title:'Pedidos online',detail:`${data.pendingOrders.length} pedido${data.pendingOrders.length===1?'':'s'} aguardando`,action:'Ver pedidos',target:'orders'});
    if(data.debtors.length)list.push({priority:4,icon:'hand-coins',tone:'danger',title:'Clientes devendo',detail:`${money(data.debt)} em aberto · ${data.debtors.length} cliente${data.debtors.length===1?'':'s'}`,action:'Cobrar',target:'clients-debt'});
    return list.sort((a,b)=>a.priority-b.priority).slice(0,4);
  }
  function render(){
    const data=model(),attentionList=attentionItems(data);
    const main=`<div class="home-main-metrics"><article class="sold">${icon('circle-dollar-sign')}<span><small>Vendido hoje</small><strong>${money(data.sold)}</strong>${comparison(data.sold,data.soldYesterday)}</span></article><article class="profit">${icon('trending-up')}<span><small>Lucro hoje</small><strong>${money(data.profit)}</strong><em>${data.margin.toFixed(0)}% de margem</em></span></article></div>`;
    const secondary=`<div class="home-secondary-scroller"><article>${icon('shopping-cart')}<strong>${data.today.length}</strong><span>vendas</span></article><article>${icon('shopping-bag')}<strong>${data.items}</strong><span>itens</span></article><article>${icon('users')}<strong>${data.customers}</strong><span>clientes</span></article><article>${icon('user-plus')}<strong>${data.newCustomers}</strong><span>novos</span></article></div>`;
    const attention=`<section class="home-attention"><header><h3>Atenção agora</h3>${attentionList.length?`<span>${attentionList.length}</span>`:''}</header><div>${attentionList.length?attentionList.map(item=>`<button type="button" data-home-target="${item.target}"><i class="${item.tone}">${icon(item.icon)}</i><span><b>${esc(item.title)}</b><small>${esc(item.detail)}</small>${item.meta?`<em>${esc(item.meta)}</em>`:''}</span><strong>${esc(item.action)} ${icon('chevron-right')}</strong></button>`).join(''):`<p>${icon('circle-check')}<span><b>Tudo em dia por aqui.</b><small>Nenhuma ação urgente no momento.</small></span></p>`}</div></section>`;
    const quick=`<section class="home-quick"><header><h3>Ações rápidas</h3></header><div><button data-home-go="vender">${icon('shopping-bag')}<span>Nova venda</span></button><button data-home-new="client">${icon('user-plus')}<span>Novo cliente</span></button><button data-home-new="product">${icon('package-plus')}<span>Novo produto</span></button><button data-home-target="clients-debt">${icon('wallet-cards')}<span>Cobranças</span></button></div></section>`;
    return`<section class="mobile-home-dashboard"><div class="home-greeting"><h2>👋 ${greeting()}, ${esc(data.name)}!</h2><p>${esc(smartMessage(data))}</p></div>${goalCard(data)}${main}${secondary}${attention}${chart(data)}${quick}</section>`
  }
  function goalModal(){
    const data=model(),root=$('#modal');root.innerHTML=`<div class="modal-bg"><section class="modal-box home-goal-modal"><header class="modal-head"><h3>Meta diária de vendas</h3><button class="icon-btn close" type="button">${icon('x')}</button></header><form><div class="modal-body"><p>Defina um valor padrão para acompanhar seu desempenho todos os dias.</p><div class="field"><label>Meta diária</label><input name="goal" type="number" inputmode="decimal" min="0" step="0.01" value="${data.goal||''}" placeholder="Ex.: 300,00" autofocus></div><small>Use zero para remover a meta.</small></div><footer class="modal-foot"><button class="btn btn-light cancel" type="button">Cancelar</button><button class="btn btn-primary">Salvar meta</button></footer></form></section></div>`;
    root.querySelectorAll('.close,.cancel').forEach(button=>button.onclick=()=>root.innerHTML='');
    root.querySelector('form').onsubmit=event=>{event.preventDefault();const goal=Math.max(0,Number(new FormData(event.currentTarget).get('goal'))||0);DB.alterar(db=>{db.config.dashboard={...(db.config.dashboard||{}),dailySalesGoal:goal,updatedAt:new Date().toISOString(),updatedBy:window.FirebaseSession?.user?.uid||'local'}});root.innerHTML='';refresh();Utils.toast(goal?'Meta diária salva':'Meta diária removida')};
    window.lucide?.createIcons();
  }
  function navigateTarget(target){
    if(target==='goal')return goalModal();
    if(target==='clients-debt'){window.ClientesMobile?.applyFilter('debito','maiorDebito');return Router.ir('clientes')}
    if(target==='clients-renewals'){window.ClientesMobile?.applyRenewalAttention?.();return Router.ir('clientes')}
    if(target==='orders')return Router.ir('pedidos');
    if(target.startsWith('products-')){const filter=target==='products-low'?'baixo':target==='products-out'?'esgotado':model().out.length?'esgotado':'baixo';window.ProdutosMobile?.applyFilter(filter,'menorEstoque');return Router.ir('produtos')}
  }
  async function loadRenewalAttention(){
    if(!mq.matches||Router.atual()!=='inicio'||!window.CustomerSubscriptions?.loadHomeMetrics)return;
    if(renewalCache.promise||Date.now()-renewalCache.updatedAt<RENEWAL_CACHE_MS)return renewalCache.promise;
    renewalCache.promise=window.CustomerSubscriptions.loadHomeMetrics(new Date().toISOString()).then(value=>{renewalCache.value=value;renewalCache.updatedAt=Date.now();if(Router.atual()==='inicio'&&mq.matches)refresh({renewals:false});return value}).catch(error=>{console.warn('[Home] Não foi possível atualizar renovações próximas.',{code:error?.code||'unknown'});return null}).finally(()=>{renewalCache.promise=null});
    return renewalCache.promise;
  }
  function bind(){
    const page=$('.mobile-home-dashboard');if(!page||page.dataset.bound)return;page.dataset.bound='true';
    page.querySelectorAll('[data-home-go]').forEach(button=>button.onclick=()=>Router.ir(button.dataset.homeGo));
    page.querySelectorAll('[data-home-target]').forEach(button=>button.onclick=()=>navigateTarget(button.dataset.homeTarget));
    page.querySelectorAll('[data-home-goal]').forEach(button=>button.onclick=goalModal);
    page.querySelector('[data-home-new="client"]')?.addEventListener('click',()=>window.ClientesPage?.clientForm());
    page.querySelector('[data-home-new="product"]')?.addEventListener('click',()=>window.ProdutosMobile?.productForm());
    loadRenewalAttention();
    window.lucide?.createIcons();
  }
  function refresh(){if(Router.atual()!=='inicio'||!mq.matches)return;const app=$('#app'),scroll=scrollY;app.innerHTML=render();bind();scrollTo({top:scroll});window.lucide?.createIcons()}
  new MutationObserver(()=>queueMicrotask(bind)).observe($('#app'),{childList:true});
  mq.addEventListener('change',()=>{
    if(Router.atual()!=='inicio')return;
    // Trocar apenas o renderer da rota atual. Reiniciar a página inteira aqui
    // refazia auth/bootstrap e podia deixar o shell sem conteúdo na mudança de breakpoint.
    window.AppPageRuntime?.mount?.('inicio');
  });
  window.MobileHome={isMobile:()=>mq.matches,render,bind,refresh,model,attentionItems,loadRenewalAttention};
})();
