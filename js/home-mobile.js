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
    const goal=Number(db.config?.dashboard?.dailySalesGoal??db.config?.dailySalesGoal??0),goalPercent=goal>0?sold/goal*100:0;
    const week=[];for(let offset=6;offset>=0;offset--){const date=new Date(now);date.setDate(date.getDate()-offset);const key=dayKey(date);week.push({date,key,label:date.toLocaleDateString('pt-BR',{weekday:'short'}).replace('.',''),value:sales.filter(sale=>dayKey(sale.data)===key).reduce((sum,sale)=>sum+saleValue(sale),0),today:offset===0})}
    const name=String(window.FirebaseSession?.profile?.name||db.config?.responsavel||'').trim().split(/\s+/)[0]||'Murillo';
    return{db,now,sales,today,sold,cost,profit,margin:sold>0?profit/sold*100:0,soldYesterday,profitYesterday,items,customers,newCustomers,debtors,debt,products,out,low,goal,goalPercent,week,name};
  }
  function comparison(value,previous){const pct=percentage(value,previous);if(pct===null)return'<small>Sem comparação com ontem</small>';const up=pct>=0;return`<small class="${up?'positive':'negative'}">${icon(up?'trending-up':'trending-down')} ${up?'+':''}${pct.toFixed(0)}% vs. ontem</small>`}
  function smartMessage(data){if(!data.today.length)return'Ainda não houve vendas hoje. Bora começar?';if(data.goal>0&&data.sold>=data.goal)return'Meta atingida! Excelente trabalho hoje.';if(data.goal>0)return`Faltam ${money(Math.max(0,data.goal-data.sold))} para bater sua meta.`;return'Aqui está o resumo do seu dia.'}
  function goalCard(data){
    if(!data.goal)return`<button class="home-goal-card empty-goal" type="button" data-home-goal>${icon('target')}<span><b>Defina sua meta do dia</b><small>Acompanhe o progresso das suas vendas.</small></span><em>Configurar ${icon('chevron-right')}</em></button>`;
    const visual=Math.min(100,Math.max(0,data.goalPercent)),reached=data.goalPercent>=100;
    return`<section class="home-goal-card ${reached?'reached':''}"><header><span>${icon('target')} Meta do dia</span><button type="button" data-home-goal>${reached?'Ver detalhes':'Editar'} ${icon('chevron-right')}</button></header><div class="goal-values"><strong>${money(data.sold)}</strong><span>/ ${money(data.goal)}</span></div><div class="goal-progress"><span style="--goal:${visual}%"></span><b>${data.goalPercent.toFixed(0)}%</b></div><p>${reached?`${data.goalPercent.toFixed(0)}% da meta — excelente trabalho!`:`${icon('trending-up')} Faltam ${money(Math.max(0,data.goal-data.sold))} para bater a meta.`}</p></section>`
  }
  function chart(data){
    const width=640,height=150,padX=25,padTop=25,base=112,max=Math.max(...data.week.map(point=>point.value),1),step=(width-padX*2)/6;
    const points=data.week.map((point,index)=>({x:padX+step*index,y:base-(point.value/max)*(base-padTop),...point}));
    const line=points.map((point,index)=>`${index?'L':'M'} ${point.x.toFixed(1)} ${point.y.toFixed(1)}`).join(' '),area=`${line} L ${points.at(-1).x} ${base} L ${points[0].x} ${base} Z`;
    return`<section class="home-chart"><header><h3>Vendas dos últimos 7 dias</h3><button data-home-go="relatorios">Ver mais ${icon('chevron-right')}</button></header><svg viewBox="0 0 ${width} ${height}" role="img" aria-label="Vendas dos últimos sete dias"><defs><linearGradient id="home-chart-fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#31d0ad" stop-opacity=".32"/><stop offset="1" stop-color="#31d0ad" stop-opacity=".03"/></linearGradient></defs><path class="area" d="${area}"/><path class="line" d="${line}"/>${points.map(point=>`<g class="${point.today?'today':''}"><circle cx="${point.x}" cy="${point.y}" r="6"/><text class="value" x="${point.x}" y="${Math.max(14,point.y-13)}">${point.value?Math.round(point.value):'0'}</text><text class="label" x="${point.x}" y="140">${esc(point.label)}</text></g>`).join('')}</svg></section>`
  }
  function alerts(data){
    const list=[];
    if(data.out.length)list.push({icon:'circle-alert',tone:'danger',text:`${data.out.length} produto${data.out.length===1?' está':'s estão'} esgotado${data.out.length===1?'':'s'}.`,target:'products-out'});
    if(data.low.length)list.push({icon:'triangle-alert',tone:'warning',text:`${data.low.length} produto${data.low.length===1?' está':'s estão'} com estoque baixo.`,target:'products-low'});
    const oldest=[...data.debtors].sort((a,b)=>new Date(a.ultimaCompra||a.criadoEm||0)-new Date(b.ultimaCompra||b.criadoEm||0))[0];
    if(oldest){const days=Math.max(0,Math.floor((Date.now()-startOfDay(oldest.ultimaCompra||oldest.criadoEm||Date.now()))/86400000));list.push({icon:'hand-coins',tone:'danger',text:`${oldest.nome} deve ${money(Math.abs(oldest.saldo))}${days?` há ${days} dias`:''}.`,target:'clients-debt'})}
    if(data.goal>0&&data.sold<data.goal)list.push({icon:'target',tone:'green',text:`Sua meta está a ${money(data.goal-data.sold)} de ser atingida.`,target:'goal'});
    return list.slice(0,3);
  }
  function render(){
    const data=model(),alertList=alerts(data);
    const alertHtml=alertList.length?alertList.map(alert=>`<button data-home-target="${alert.target}"><span class="${alert.tone}">${icon(alert.icon)}</span><b>${esc(alert.text)}</b>${icon('chevron-right')}</button>`).join(''):`<p>${icon('circle-check')} Tudo certo por aqui.</p>`;
    const main=`<div class="home-main-metrics"><article class="sold">${icon('circle-dollar-sign')}<span><small>Vendido hoje</small><strong>${money(data.sold)}</strong>${comparison(data.sold,data.soldYesterday)}</span></article><article class="profit">${icon('trending-up')}<span><small>Lucro hoje</small><strong>${money(data.profit)}</strong><em>${data.margin.toFixed(0)}% de margem</em></span></article></div>`;
    const secondary=`<div class="home-secondary-scroller"><article>${icon('shopping-cart')}<strong>${data.today.length}</strong><span>vendas</span></article><article>${icon('shopping-bag')}<strong>${data.items}</strong><span>itens</span></article><article>${icon('users')}<strong>${data.customers}</strong><span>clientes</span></article><article>${icon('user-plus')}<strong>${data.newCustomers}</strong><span>novos</span></article></div>`;
    const attention=`<div class="home-attention-grid"><article class="debt">${icon('credit-card')}<h3>Clientes devendo</h3><strong>${money(data.debt)}</strong><span>${data.debtors.length} cliente${data.debtors.length===1?'':'s'}</span><button data-home-target="clients-debt">Cobrar agora ${icon('chevron-right')}</button></article><article class="stock">${icon('triangle-alert')}<h3>Estoque</h3><p><b>${data.out.length}</b> produto${data.out.length===1?'':'s'} em falta</p><p><b>${data.low.length}</b> com estoque baixo</p><button data-home-target="products-attention">Ver estoque ${icon('chevron-right')}</button></article></div>`;
    const quick=`<section class="home-quick"><header><h3>Ações rápidas</h3></header><div><button data-home-go="vender">${icon('shopping-bag')}<span>Nova venda</span></button><button data-home-new="client">${icon('user-plus')}<span>Novo cliente</span></button><button data-home-new="product">${icon('package-plus')}<span>Novo produto</span></button><button data-home-target="clients-debt">${icon('wallet-cards')}<span>Cobranças</span></button><button data-home-go="relatorios">${icon('chart-no-axes-combined')}<span>Relatórios</span></button></div></section>`;
    return`<section class="mobile-home-dashboard"><div class="home-greeting"><h2>👋 ${greeting()}, ${esc(data.name)}!</h2><p>${esc(smartMessage(data))}</p></div>${goalCard(data)}${main}${secondary}${attention}${chart(data)}${quick}<section class="home-alerts"><header>${icon('bell')}<h3>Alertas inteligentes</h3></header>${alertHtml}</section></section>`
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
    if(target.startsWith('products-')){const filter=target==='products-low'?'baixo':target==='products-out'?'esgotado':model().out.length?'esgotado':'baixo';window.ProdutosMobile?.applyFilter(filter,'menorEstoque');return Router.ir('produtos')}
  }
  function bind(){
    const page=$('.mobile-home-dashboard');if(!page||page.dataset.bound)return;page.dataset.bound='true';
    page.querySelectorAll('[data-home-go]').forEach(button=>button.onclick=()=>Router.ir(button.dataset.homeGo));
    page.querySelectorAll('[data-home-target]').forEach(button=>button.onclick=()=>navigateTarget(button.dataset.homeTarget));
    page.querySelectorAll('[data-home-goal]').forEach(button=>button.onclick=goalModal);
    page.querySelector('[data-home-new="client"]')?.addEventListener('click',()=>window.ClientesPage?.clientForm());
    page.querySelector('[data-home-new="product"]')?.addEventListener('click',()=>window.ProdutosMobile?.productForm());
    window.lucide?.createIcons();
  }
  function refresh(){if(Router.atual()!=='inicio'||!mq.matches)return;const app=$('#app'),scroll=scrollY;app.innerHTML=render();bind();scrollTo({top:scroll});window.lucide?.createIcons()}
  new MutationObserver(()=>queueMicrotask(bind)).observe($('#app'),{childList:true});
  mq.addEventListener('change',()=>{if(Router.atual()==='inicio')location.reload()});
  window.MobileHome={isMobile:()=>mq.matches,render,bind,refresh,model};
})();
