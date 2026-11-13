(function(){
  'use strict';
  const base=window.ClientesPage;
  if(!base)return;
  const desktopRender=base.render.bind(base),desktopBind=base.bind.bind(base);
  const mq=matchMedia('(max-width: 767px)');
  const state={query:'',filter:'todos',sort:'maiorDebito',limit:20,sheet:false,scrollPosition:0};
  let observer=null, searchTimer=null, scrollFrame=null;
  const activePage = () => Router.atual() === 'clientes' && document.querySelector('#app .clients-mobile-page');
  function cancelPending() {
    observer?.disconnect();observer=null;
    clearTimeout(searchTimer);searchTimer=null;
    if(scrollFrame!==null)cancelAnimationFrame(scrollFrame);
    scrollFrame=null;
  }
  const icon=name=>`<i data-lucide="${name}"></i>`;
  const esc=value=>String(value??'').replace(/[&<>'"]/g,char=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[char]));
  const norm=value=>String(value??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase();
  const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const localDate=value=>{if(!value)return null;const text=String(value),date=/^\d{4}-\d{2}-\d{2}$/.test(text)?new Date(`${text}T12:00:00`):new Date(value);return Number.isNaN(date.getTime())?null:date};
  const dateValue=value=>localDate(value)?.getTime()||0;
  const dateLabel=value=>localDate(value)?.toLocaleDateString('pt-BR')||'Nunca';
  const initials=name=>String(name||'?').trim().split(/\s+/).slice(0,2).map(x=>x[0]).join('').toUpperCase();
  let viewPass;
  function withClientView(render) {
    if (viewPass) return render();
    viewPass = {balances:new Map(), charges:new Map(), renewals:new Map()};
    try { return render(); } finally { viewPass = null; }
  }
  function listStatus(client) {
    if (viewPass?.balances.has(client)) return viewPass.balances.get(client);
    const value = Clientes.listFinancialStatus?.(client) || Clientes.financialStatus(client);
    viewPass?.balances.set(client, value);
    return value;
  }
  const debt=client=>listStatus(client).debt;
  const readData=()=>Clientes.viewData?.()||DB.readForView?.()||DB.carregar();
  const allData=()=>viewPass?(viewPass.data??=readData()):readData();
  function lastCharge(client,db=allData()) {
    if (!viewPass || !Mensagens.latestCharges) return Mensagens.latestCharge(client,db);
    if (!viewPass.charges.has(client)) {
      const lookup = viewPass.chargeLookup ??= Mensagens.latestCharges(db);
      viewPass.charges.set(client, lookup(client));
    }
    return viewPass.charges.get(client);
  }
  function chargeBand(client) {
    if (!viewPass || !Mensagens.latestCharges) return Mensagens.chargeBand(client);
    const lookup = viewPass.chargeBandLookup ??= Mensagens.latestCharges();
    return Mensagens.chargeBand(client,null,lookup(client));
  }
  const relative=value=>Mensagens.formatLastChargeDate(value);
  const dayDistance=(value,reference=new Date())=>{const target=localDate(value),today=localDate(reference);if(!target||!today)return null;target.setHours(0,0,0,0);today.setHours(0,0,0,0);return Math.round((target-today)/86400000)};
  function renewalGroups() {
    const groups = new Map();
    for (const item of window.CustomerSubscriptions.list()) {
      if (window.SpaceContext?.showsRenewal?.(item) === false) continue;
      const group = groups.get(item.clientId) || [];
      group.push(item);
      groups.set(item.clientId, group);
    }
    return groups;
  }
  // Same São Paulo civil day used by the renewal metrics and the Renovações screen.
  const renewalDays=value=>window.CustomerSubscriptions?.daysUntil?window.CustomerSubscriptions.daysUntil(value):dayDistance(value);
  function readRenewalAttention(clientId){const view=window.CustomerSubscriptions?.view, groups=viewPass&&window.CustomerSubscriptions?.list?(viewPass.renewalGroups??=renewalGroups()):null;const items=(groups?(groups.get(clientId)||[]):(view?.forClient?.(clientId)||[])).filter(item=>{const status=window.CustomerSubscriptions?.effectiveStatus?.(item)||item.status,days=renewalDays(item.expiresAt);return status==='expired'||(status==='active'&&days!==null&&days>=0&&days<=7)}).sort((a,b)=>dateValue(a.expiresAt)-dateValue(b.expiresAt));if(!items.length)return null;if(items.length>1){const expired=items.some(item=>(window.CustomerSubscriptions?.effectiveStatus?.(item)||item.status)==='expired');return{count:items.length,tone:expired?'overdue':'soon',label:`${items.length} renovações ${expired?'precisam de atenção':'próximas'}`,expiresAt:items[0].expiresAt}}const item=items[0],status=window.CustomerSubscriptions?.effectiveStatus?.(item)||item.status,days=renewalDays(item.expiresAt),name=item.label||'Renovação',overdueDays=Math.max(1,Math.abs(days||0));return{count:1,tone:status==='expired'?'overdue':days===0?'today':'soon',label:status==='expired'?`${name} vencido há ${overdueDays} dia${overdueDays===1?'':'s'}`:days===0?`${name} vence hoje`:`${name} vence em ${days} dia${days===1?'':'s'}`,expiresAt:item.expiresAt}}
  function renewalAttention(id){
    if (!viewPass) return readRenewalAttention(id);
    if (!viewPass.renewals.has(id)) viewPass.renewals.set(id,readRenewalAttention(id));
    return viewPass.renewals.get(id);
  }
  function promiseAttention(client){const promise=client?.promessaPagamento;if(!promise||promise.status&&promise.status!=='pendente'||!promise.data)return'';const days=dayDistance(`${promise.data}T12:00:00`),overdue=days!==null&&days<0;return`<div class="mobile-client-context promise ${overdue?'overdue':''}">${icon(overdue?'calendar-x':'calendar-check')}<b>${overdue?'Promessa vencida':`Prometeu pagar em ${dateLabel(promise.data)}`}</b></div>`}
  function recentPayment(client,db) {
    const cutoff=Date.now()-7*86400000;
    if (!viewPass) return (db.pagamentos||[]).some(p=>p.clienteId===client.id&&dateValue(p.data)>=cutoff);
    const recent=viewPass.recentPayments??=new Set((db.pagamentos||[]).filter(p=>dateValue(p.data)>=cutoff).map(p=>p.clienteId));
    return recent.has(client.id);
  }
  function stats(){
    const db=allData(),clients=(db.clientes||[]).filter(c=>c.ativo!==false);
    const scoped=Clientes.scopedScreen?.()&&!Clientes.localListBalances?.(),debtors=scoped?[]:clients.filter(c=>listStatus(c).saldo<0);
    const today=Mensagens.dayKey?.(new Date());
    const charges=clients.filter(c=>today ? Mensagens.dayKey(lastCharge(c,db)?.date)===today : Mensagens.wasChargedToday(c,db)).length;
    return{clients,debtors,total:debtors.reduce((sum,c)=>sum+debt(c),0),charges};
  }
  function filtered(){const db=allData(),clients=(db.clientes||[]).filter(c=>c.ativo!==false),baseFilter=state.filter==='renovacao'?'todos':state.filter;let list=ClientFilterRules.filter(clients,{query:state.query,status:baseFilter,lastCharge:c=>lastCharge(c,db),recentPayment:c=>recentPayment(c,db),balance:c=>listStatus(c).saldo});if(state.filter==='renovacao')list=list.filter(client=>renewalAttention(client.id));const chargeTime=c=>dateValue(lastCharge(c,db)?.date);list.sort((a,b)=>state.sort==='maiorDebito'?debt(b)-debt(a):state.sort==='menorDebito'?debt(a)-debt(b):state.sort==='nomeAsc'?String(a.nome).localeCompare(String(b.nome),'pt-BR'):state.sort==='nomeDesc'?String(b.nome).localeCompare(String(a.nome),'pt-BR'):state.sort==='ultimaCompra'?dateValue(b.ultimaCompra)-dateValue(a.ultimaCompra):state.sort==='ultimaCobranca'?chargeTime(b)-chargeTime(a):state.sort==='renovacao'?dateValue(renewalAttention(a.id)?.expiresAt)-dateValue(renewalAttention(b.id)?.expiresAt):Number(b.totalComprado||0)-Number(a.totalComprado||0));return list}
  function badge(financial){const status=financial.status==='debt'?'debit':financial.status,label=financial.status==='debt'?'Débito':financial.status==='credit'?'Crédito':financial.status==='unverified'?(Clientes.scopedScreen?.()?'A conferir':'Consultar saldo'):financial.futureCents?'Parcelas futuras':'Sem saldo';return`<span class="mobile-client-status ${status}">${label}</span>`}
  function chip(key,label,count=''){return`<button class="mobile-filter-chip ${state.filter===key?'active':''}" type="button" data-mobile-filter="${key}"><span>${label}</span>${count!==''?`<b>${count}</b>`:''}</button>`}
  function card(client,index){const financial=listStatus(client),saldo=financial.saldo,type=financial.status==='debt'?'debit':financial.status,charge=lastCharge(client),phone=String(client.telefone||'').replace(/\D/g,''),balance=financial.status==='debt'?money(financial.debt):financial.status==='credit'?money(financial.credit):financial.status==='unverified'?'—':money(0),chargeTone=chargeBand(client),renewal=renewalAttention(client.id),renewalMarkup=renewal?`<button class="mobile-client-context renewal ${renewal.tone}" type="button" data-mobile-renewals="${client.id}">${icon('refresh-cw')}<b>${esc(renewal.label)}</b>${icon('chevron-right')}</button>`:'';return`<div class="mobile-swipe-shell ${type} ${chargeTone}" data-swipe-client="${client.id}" style="--delay:${Math.min(index,12)*28}ms"><div class="swipe-action swipe-sale">${icon('shopping-bag')}<span>Nova venda para<br>este cliente</span></div><div class="swipe-action swipe-charge">${icon('message-circle')}<span>Cobrar via<br>WhatsApp</span></div><article class="mobile-client-card" data-mobile-card="${client.id}" aria-label="${esc(client.nome)}. Arraste para a direita para vender ou para a esquerda para cobrar."><div class="mobile-client-main"><span class="mobile-client-avatar">${esc(initials(client.nome))}</span><div class="mobile-client-identity"><h3>${esc(client.nome)}</h3><p>${esc(client.telefone)||'Sem telefone'}${phone.length>=10?` <button class="mobile-phone-whatsapp" type="button" data-mobile-whatsapp="${client.id}" aria-label="Cobrar ${esc(client.nome)} pelo WhatsApp">${icon('message-circle')}</button>`:''}</p></div><div class="mobile-client-balance">${badge(financial)}<strong class="kpi-money-value">${balance}</strong><small>${financial.status==='debt'?(financial.partial?'em aberto identificado':financial.displayOnly?'em aberto · cadastro':'em aberto'):financial.status==='credit'?'em crédito':financial.status==='unverified'?(financial.reason?'origem do saldo a conferir':'exigível a conferir'):financial.futureCents?'nada exigível agora':'conta zerada'}</small>${financial.futureCents?`<small>Futuras: ${money(financial.futureCents/100)}</small>`:''}${window.InstallmentCredit?.lookupButton?.(client.id,financial)||''}</div><button class="mobile-card-menu-trigger" type="button" data-mobile-menu="${client.id}" aria-label="Mais ações para ${esc(client.nome)}">${icon('ellipsis-vertical')}</button></div><div class="mobile-client-facts"><span>${icon('calendar-days')}<span><small>Última compra</small><b>${window.OperationalReadPolicy?.restricted?.()?'Histórico restrito':dateLabel(client.ultimaCompra)}</b></span></span><span>${icon('clock-3')}<span><small>Última cobrança</small><b>${relative(charge?.date)}</b></span></span></div>${renewalMarkup}${promiseAttention(client)}<div class="mobile-client-actions"><button class="mobile-receive" type="button" data-mobile-receive="${client.id}" ${!['debt','unverified'].includes(financial.status)?'disabled':''}>${icon('circle-dollar-sign')} Receber</button><button class="mobile-whatsapp" type="button" data-mobile-whatsapp="${client.id}" ${phone.length<10?'disabled':''}>${icon('message-circle')} WhatsApp</button><button class="mobile-more" type="button" data-mobile-menu="${client.id}" aria-label="Mais ações">${icon('ellipsis')}</button></div></article></div>`}
  function sheet(){return`<div class="mobile-filter-overlay ${state.sheet?'open':''}" data-close-mobile-sheet></div><section class="mobile-filter-sheet ${state.sheet?'open':''}" aria-hidden="${!state.sheet}"><div class="sheet-handle"></div><header><div><h3>Filtros de clientes</h3><p>Encontre rapidamente quem você procura.</p></div><button type="button" data-close-mobile-sheet>${icon('x')}</button></header><div class="mobile-sheet-options"><button data-sheet-filter="debito">${icon('circle-dollar-sign')} Clientes devendo</button><button data-sheet-filter="credito">${icon('badge-dollar-sign')} Clientes com crédito</button><button data-sheet-filter="semTelefone">${icon('phone-off')} Sem telefone</button><button data-sheet-filter="nunca">${icon('bell-off')} Nunca cobrados</button><button data-sheet-filter="pagamento">${icon('circle-check')} Pagamento recente</button></div><button class="mobile-sheet-clear" type="button" data-sheet-filter="todos">Limpar filtros</button></section>`}
  function renderMobile(){Clientes.prepareList?.();return withClientView(renderClientList)}
  function renderClientList(){const {clients,debtors,total,charges}=stats(),local=Clientes.listSummary?.(),scoped=Clientes.scopedScreen?.()&&!local,unverified=!scoped&&!local&&clients.some(c=>listStatus(c).status==='unverified'),counts={credito:scoped?'—':clients.filter(c=>listStatus(c).saldo>0).length,zero:scoped?'—':clients.filter(c=>listStatus(c).saldo===0).length,nunca:clients.filter(c=>!lastCharge(c)).length,semTelefone:clients.filter(c=>String(c.telefone||'').replace(/\D/g,'').length<10).length,pagamento:clients.filter(c=>recentPayment(c,allData())).length,renovacao:clients.filter(c=>renewalAttention(c.id)).length},list=filtered(),shown=list.slice(0,state.limit),showHint=localStorage.getItem('adiFestaClientSwipeHint_v1')!=='1',hasFilter=Boolean(state.query)||state.filter!=='todos';return`<section class="clients-page clients-mobile-page">${window.SpaceContext?.renderBar?.("clients")||""}${Clientes.originalAccountAction?.()||""}<div class="mobile-client-kpis"><article class="danger">${icon('circle-dollar-sign')}<span><small>Em aberto</small><strong class="kpi-money-value">${local?money(local.dueCents/100):scoped||unverified?'—':money(total)}</strong><em>${local?(local.partial?'Parte identificada · '+local.unknown+' conta(s) a conferir':'Saldo cadastral · conferir antes de receber'):scoped?'Total por espaço indisponível · consulte cada conta':unverified?'Há saldos a conferir':'exigível dos cadastros carregados'}</em></span></article><article class="danger">${icon('user-round')}<span><small>Clientes devendo</small><strong>${local?local.debtors:scoped||unverified?'—':debtors.length}</strong><em>${local?.partial?'Contagem parcial · há contas a conferir':scoped?'Total por espaço indisponível':unverified?'Há saldos a conferir':`${clients.length?Math.round(debtors.length/clients.length*100):0}% dos cadastros carregados`}</em></span></article><article class="warning">${icon('bell-ring')}<span><small>Cobranças hoje</small><strong>${charges}</strong><em>registradas</em></span></article></div>${local?.futureCents?`<p class="muted" data-local-future>Parcelas futuras: ${money(local.futureCents/100)} · fora do exigível</p>`:''}<div class="mobile-client-search-row"><label>${icon('search')}<input id="mobile-client-search" value="${esc(state.query)}" autocomplete="off" placeholder="Buscar cliente" aria-label="Buscar cliente por nome, telefone, apelido ou observação">${state.query?`<button class="mobile-search-clear" type="button" aria-label="Limpar busca">${icon('x')}</button>`:''}</label><button id="mobile-open-filters" type="button" aria-label="Abrir filtros">${icon('list-filter')}</button><button id="mobile-message-center" type="button" aria-label="Abrir Central de mensagens">${icon('megaphone')}</button></div><div class="mobile-client-search-status" role="status" aria-live="polite" hidden>Buscando...</div><div class="mobile-filter-scroller">${chip('todos','Todos',clients.length)}${chip('debito',scoped?'Débitos consultados':'Devendo',scoped?'—':debtors.length)}${chip('credito','Crédito',counts.credito)}${chip('zero','Sem saldo',counts.zero)}${counts.renovacao||state.filter==='renovacao'?chip('renovacao','Renovações',counts.renovacao):''}${chip('nunca','Nunca cobrados',counts.nunca)}${chip('semTelefone','Sem telefone',counts.semTelefone)}${chip('pagamento','Pagamento recente',counts.pagamento)}</div><div class="mobile-sort-row"><label>${icon('arrow-up-down')}<span>Ordenar por</span><select id="mobile-client-sort"><option value="maiorDebito">Maior dívida</option><option value="menorDebito">Menor dívida</option><option value="nomeAsc">Nome A-Z</option><option value="nomeDesc">Nome Z-A</option><option value="ultimaCompra">Última compra</option><option value="ultimaCobranca">Última cobrança</option><option value="renovacao">Próxima renovação</option><option value="totalComprado">Maior total comprado</option></select></label><small>${list.length} cliente${list.length===1?'':'s'}</small></div>${showHint?`<div class="mobile-swipe-hint">${icon('move-horizontal')}<span>Arraste para a direita para vender ou para a esquerda para cobrar.</span><button type="button" data-dismiss-swipe-hint aria-label="Dispensar dica">${icon('x')}</button></div>`:''}<div class="mobile-client-list" id="mobile-client-list">${shown.map(card).join('')||`<div class="mobile-client-empty">${icon(hasFilter?'search-x':'user-round-plus')}<h3>${(Clientes.scopedScreen?.()&&!Clientes.localListBalances?.())&&state.filter==='debito'?'Nenhum débito confirmado neste filtro':'Nenhum cliente encontrado'}</h3><p>${hasFilter?'Tente alterar a busca ou os filtros.':'Cadastre seu primeiro cliente para começar.'}</p></div>`}</div>${shown.length<list.length?`<div class="mobile-load-sentinel" id="mobile-load-sentinel"><span></span>Carregando mais clientes...</div>`:''}${Clientes.unassignedMarkup?.()||""}${sheet()}<div class="mobile-legacy-hooks" aria-hidden="true"><button id="new-client"></button><button id="import-csv"></button><input id="search"><div id="entity-list"></div></div></section>`}
  function render(){return mq.matches?renderMobile():desktopRender()}
  function restoreScroll(page){
    if(!page)return;
    if(scrollFrame!==null)cancelAnimationFrame(scrollFrame);
    scrollFrame=requestAnimationFrame(()=>{scrollFrame=null;if(activePage()===page)scrollTo({top:state.scrollPosition})});
  }
  function refreshMobile(reset=false){
    if(!activePage())return;
    cancelPending();if(reset)state.limit=20;const app=document.querySelector('#app');
    state.scrollPosition=scrollY;app.innerHTML=renderMobile();
    app.querySelector('.clients-page').dataset.clientsBound='true';bindMobile();restoreScroll(activePage());
  }
  function perform(action,id){
    if(action==='sale')return window.Checkout?.prepareClientSale?.(id,'client_swipe');
    if(action==='charge')return window.MobileMessages?.openComposer?.(id,{type:'charge',source:'individual'});
  }
  function bindSwipe(shell){
    const card=shell.querySelector('.mobile-client-card');let startX=0,startY=0,delta=0,dragging=false,axis='',pointer=null,thresholdHit=false;
    const reset=()=>{card.style.transition='transform .32s cubic-bezier(.22,.8,.25,1)';card.style.transform='translateX(0)';shell.classList.remove('drag-right','drag-left','ready','dragging');setTimeout(()=>card.style.transition='',330)};
    card.addEventListener('pointerdown',event=>{if(event.target.closest('button,input,select,a,textarea'))return;document.querySelectorAll('.mobile-swipe-shell.drag-right,.mobile-swipe-shell.drag-left').forEach(other=>{if(other!==shell){const item=other.querySelector('.mobile-client-card');if(item)item.style.transform='translateX(0)';other.classList.remove('drag-right','drag-left','ready')}});startX=event.clientX;startY=event.clientY;pointer=event.pointerId;delta=0;axis='';dragging=true;thresholdHit=false;card.setPointerCapture?.(pointer)});
    card.addEventListener('pointermove',event=>{if(!dragging||event.pointerId!==pointer)return;const dx=event.clientX-startX,dy=event.clientY-startY;if(!axis&&Math.max(Math.abs(dx),Math.abs(dy))>9)axis=Math.abs(dx)>Math.abs(dy)*1.15?'x':'y';if(axis==='y'){dragging=false;reset();return}if(axis!=='x')return;event.preventDefault();shell.classList.add('dragging');delta=Math.max(-card.offsetWidth*.72,Math.min(card.offsetWidth*.72,dx));card.style.transform=`translateX(${delta}px)`;shell.classList.toggle('drag-right',delta>0);shell.classList.toggle('drag-left',delta<0);const ready=Math.abs(delta)>=card.offsetWidth*.4;shell.classList.toggle('ready',ready);if(ready&&!thresholdHit){thresholdHit=true;navigator.vibrate?.(18)}else if(!ready)thresholdHit=false});
    const end=event=>{if(!dragging||event.pointerId!==pointer)return;dragging=false;const action=delta>0?'sale':'charge',execute=axis==='x'&&Math.abs(delta)>=card.offsetWidth*.4;if(execute){card.style.transition='transform .2s ease';card.style.transform=`translateX(${delta>0?card.offsetWidth:-card.offsetWidth}px)`;setTimeout(()=>{if(shell.isConnected&&activePage()){perform(action,shell.dataset.swipeClient);reset()}},170)}else reset()};
    card.addEventListener('pointerup',end);card.addEventListener('pointercancel',end);
  }
  function applySmartMode(){if(window.OperationalReadPolicy?.restricted?.())return;if(window.OperationMode?.enabled?.('creditSales'))return;const db=allData(),kpis=document.querySelector('.mobile-client-kpis'),profiles=(db.clientes||[]).filter(c=>c.ativo!==false).map(c=>CRMCliente.build(c.id,{data:db})).filter(Boolean);if(kpis){const active=profiles.filter(p=>(p.metrics.daysWithoutPurchase??999)<=30).length,revenue=profiles.reduce((sum,p)=>sum+p.metrics.totalSpent,0),purchases=profiles.reduce((sum,p)=>sum+p.metrics.purchaseCount,0),inactive=profiles.filter(p=>(p.metrics.daysWithoutPurchase??999)>60).length;kpis.innerHTML=`<article>${icon('users')}<span><small>Clientes ativos</small><strong>${active}</strong><em>últimos 30 dias</em></span></article><article>${icon('circle-dollar-sign')}<span><small>Receita da base</small><strong class="kpi-money-value">${money(revenue)}</strong><em>histórico</em></span></article><article>${icon('calculator')}<span><small>Ticket médio</small><strong class="kpi-money-value">${money(purchases?revenue/purchases:0)}</strong><em>por compra</em></span></article><article>${icon('user-x')}<span><small>Sem comprar</small><strong>${inactive}</strong><em>há mais de 60 dias</em></span></article>`}document.querySelectorAll('[data-mobile-filter="debito"],[data-mobile-filter="credito"],[data-mobile-filter="nunca"]').forEach(x=>x.hidden=true);document.querySelectorAll('[data-swipe-client]').forEach(shell=>{const client=db.clientes.find(c=>c.id===shell.dataset.swipeClient),profile=client&&CRMCliente.build(client.id,{data:db});if(!profile)return;const status=shell.querySelector('.mobile-client-status'),balance=shell.querySelector('.mobile-client-balance strong'),caption=shell.querySelector('.mobile-client-balance small'),receive=shell.querySelector('.mobile-receive');status.className=`mobile-client-status ${profile.metrics.activity==='active'?'credit':'zero'}`;status.textContent=CRMCliente.formatActivity(profile.metrics.activity).replace('Cliente ','');balance.textContent=money(profile.metrics.totalSpent);caption.textContent='em compras';const facts=shell.querySelectorAll('.mobile-client-facts>span');if(facts[1]){facts[1].querySelector('small').textContent='Último contato';facts[1].querySelector('b').textContent=profile.metrics.lastContact?relative(profile.metrics.lastContact):'Nunca'}if(receive){receive.disabled=false;receive.dataset.mobileSale=client.id;delete receive.dataset.mobileReceive;receive.innerHTML=`${icon('shopping-bag')} Nova venda`}shell.querySelector('.swipe-charge')?.remove()})}
  function bindMobile(){window.SpaceContext?.bind?.(document.querySelector("#app"));
    const search=document.querySelector('#mobile-client-search'),sort=document.querySelector('#mobile-client-sort');if(!search)return;const center=document.querySelector('#mobile-message-center');if(center&&!document.querySelector('#mobile-open-crm'))center.insertAdjacentHTML('afterend',`<button id="mobile-open-crm" type="button" aria-label="Abrir CRM e Relacionamento">${icon('contact-round')}</button>`);document.querySelector('#mobile-open-crm').onclick=()=>Router.ir('crm');sort.value=state.sort;
    const clearSearch=event=>{event?.preventDefault?.();clearTimeout(searchTimer);state.query='';search.value='';document.querySelector('.mobile-search-clear')?.remove();searchClients('');search.focus()};
    const syncClearButton=()=>{const label=search.closest('label'),current=label?.querySelector('.mobile-search-clear');if(state.query&&!current){label?.insertAdjacentHTML('beforeend',`<button class="mobile-search-clear" type="button" aria-label="Limpar busca">${icon('x')}</button>`);label?.querySelector('.mobile-search-clear')?.addEventListener('click',clearSearch)}else if(!state.query)current?.remove()};
    search.addEventListener('input',event=>{clearTimeout(searchTimer);state.query=event.target.value;syncClearButton();const status=document.querySelector('.mobile-client-search-status');if(status){status.hidden=!state.query;status.textContent='Buscando...'}searchTimer=setTimeout(()=>{searchTimer=null;if(search.isConnected&&activePage())searchClients(state.query)},300)});
    document.querySelector('.mobile-search-clear')?.addEventListener('click',clearSearch);
    sort.addEventListener('change',event=>{state.sort=event.target.value;refreshMobile(true)});
    document.querySelectorAll('[data-mobile-filter]').forEach(button=>button.onclick=()=>{state.filter=button.dataset.mobileFilter;state.sort=state.filter==='debito'?'maiorDebito':state.sort;refreshMobile(true)});
    document.querySelector('#mobile-open-filters').onclick=()=>{state.sheet=true;refreshMobile()};
    document.querySelector('#mobile-message-center').onclick=()=>window.MobileMessages?.openCenter?.();
    document.querySelector('[data-dismiss-swipe-hint]')?.addEventListener('click',()=>{localStorage.setItem('adiFestaClientSwipeHint_v1','1');document.querySelector('.mobile-swipe-hint')?.remove()});
    document.querySelectorAll('[data-close-mobile-sheet]').forEach(button=>button.onclick=()=>{state.sheet=false;refreshMobile()});
    document.querySelectorAll('[data-sheet-filter]').forEach(button=>button.onclick=()=>{state.filter=button.dataset.sheetFilter;state.sheet=false;refreshMobile(true)});
    document.querySelector('#mobile-client-list').onclick=event=>{
      const button=event.target.closest('button');if(!button){const card=event.target.closest('[data-mobile-card]');if(card&&!event.target.closest('input,a'))base.profile(card.dataset.mobileCard);return}
      const id=button.dataset.mobileReceive||button.dataset.mobileWhatsapp||button.dataset.mobileMenu||button.dataset.mobileEdit||button.dataset.mobileProfile||button.dataset.mobileHistory||button.dataset.mobileCharges||button.dataset.mobileAdjust||button.dataset.mobileDelete||button.dataset.mobileSale||button.dataset.mobileCharge||button.dataset.mobileRenewals;
      if(button.dataset.mobileReceive)base.receive(id);
      else if(button.dataset.mobileWhatsapp||button.dataset.mobileCharge)perform('charge',id);
      else if(button.dataset.mobileSale)perform('sale',id);
      else if(button.dataset.mobileMenu)window.ClientActions?.openSheet?.(id);
      else if(button.dataset.mobileRenewals)base.profile(id);
      else if(button.dataset.mobileEdit)base.clientForm(id);
      else if(button.dataset.mobileProfile||button.dataset.mobileHistory||button.dataset.mobileCharges)base.profile(id);
      else if(button.dataset.mobileAdjust)base.adjust(id);
      else if(button.dataset.mobileDelete)Modais.confirmar('cliente',()=>{Clientes.excluir(id);refreshMobile()});
    };
    document.querySelectorAll('.mobile-swipe-shell').forEach(bindSwipe);observeMore();window.lucide?.createIcons()
  }
  function observeMore(){
    observer?.disconnect();observer=null;
    const page=activePage(), sentinel=page?.querySelector('#mobile-load-sentinel');
    if(!sentinel||!window.IntersectionObserver)return;
    const pending=new IntersectionObserver(entries=>{
      if(pending!==observer||!entries[0]?.isIntersecting||!sentinel.isConnected||activePage()!==page)return;
      pending.disconnect();
      withClientView(()=>{
        const list=filtered(), root=page.querySelector('#mobile-client-list'), start=root.children.length;
        const next=list.slice(start,start+20);
        state.limit=start+next.length;
        root.insertAdjacentHTML('beforeend',next.map((client,i)=>card(client,start+i)).join(''));
        Array.from(root.children).slice(start).forEach(bindSwipe);
        if(state.limit>=list.length)sentinel.remove();
        window.lucide?.createIcons();
      });
      observeMore();
    },{rootMargin:'240px'});
    observer=pending;pending.observe(sentinel);
  }
  function bind(){return mq.matches?bindMobile():desktopBind()}
  base.render=render;base.bind=bind;
  const originalClientForm=base.clientForm.bind(base);
  base.clientForm=id=>{if((id?window.Clientes?.canEdit?.():window.Clientes?.canCreate?.())===false){Utils.toast('Seu perfil não tem permissão para esta ação de cadastro.',true);return;}originalClientForm(id);if(!mq.matches||document.querySelector('#modal input[name="apelido"]'))return;const nameField=document.querySelector('#modal input[name="nome"]')?.closest('.field'),client=id?Clientes.obter(id):{};nameField?.insertAdjacentHTML('afterend',`<div class="field full"><label>Apelido</label><input name="apelido" value="${esc(client?.apelido||'')}" placeholder="Como você conhece este cliente"></div>`)};
  document.querySelector('#mobile-client-fab')?.addEventListener('click',event=>{if(['new-client','quick-action'].includes(event.currentTarget.dataset.primaryAction))base.clientForm()});
  function searchClients(query,options={}){if(!activePage())return;return withClientView(()=>renderSearch(query,options))}
  function renderSearch(query,options){state.query=query;state.limit=20;observer?.disconnect();document.querySelector('#mobile-load-sentinel')?.remove();const list=filtered(),shown=list.slice(0,state.limit),root=document.querySelector('#mobile-client-list'),hasFilter=Boolean(state.query)||state.filter!=='todos',cloudPending=Boolean(state.query)&&options.cloud!==false&&navigator.onLine&&window.SyncFirebase?.queryClientsPage;if(!root)return;root.innerHTML=shown.map(card).join('')||(cloudPending?`<div class="mobile-client-searching"><span></span><b>Buscando...</b></div>`:`<div class="mobile-client-empty">${icon(hasFilter?'search-x':'user-round-plus')}<h3>${scoped&&state.filter==='debito'?'Nenhum débito confirmado neste filtro':'Nenhum cliente encontrado'}</h3><p>${hasFilter?'Tente alterar a busca ou os filtros.':'Cadastre seu primeiro cliente para começar.'}</p></div>`);const status=document.querySelector('.mobile-client-search-status');if(status)status.hidden=true;const count=document.querySelector('.mobile-sort-row>small');if(count)count.textContent=`${list.length} cliente${list.length===1?'':'s'}`;document.querySelectorAll('.mobile-swipe-shell',root).forEach(bindSwipe);if(options.cloud!==false)window.ClientCloudPagination?.refresh?.();window.lucide?.createIcons()}
  function restoreActiveState(){searchClients(state.query,{cloud:false});restoreScroll(activePage());return{...state}}
  window.ClientesMobile={cancelPending,renderCards:clients=>withClientView(()=>clients.map(card).join('')),applyFilter(filter='todos',sort='maiorDebito'){state.filter=filter;state.sort=sort;state.query='';state.limit=20;state.sheet=false;state.scrollPosition=0},applyRenewalAttention(){state.filter='renovacao';state.sort='renovacao';state.query='';state.limit=20;state.sheet=false;state.scrollPosition=0},setSearchTerm(query){state.query=String(query??'');state.limit=20},search:searchClients,restoreActiveState,refresh:refreshMobile,startSale:id=>perform('sale',id),charge:id=>perform('charge',id),renewalAttention,renderCard:card,bindCard:bindSwipe,getState:()=>({...state})};
  window.AppLifecycle?.onBackground?.(()=>{if(mq.matches&&Router.atual()==='clientes')state.scrollPosition=scrollY});
  addEventListener('message-history-updated',()=>{if(mq.matches&&Router.atual()==='clientes'&&!document.querySelector('.message-center-page'))refreshMobile()});
  mq.addEventListener('change',()=>{if(location.hash.includes('/clientes'))base.refresh()});
})();
