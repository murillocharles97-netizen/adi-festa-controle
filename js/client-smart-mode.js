(function(){
  'use strict';
  const base=window.ClientesPage;if(!base)return;
  const originalBind=base.bind.bind(base),originalForm=base.clientForm.bind(base),money=v=>Utils.dinheiro(Number(v||0)),icon=n=>`<i data-lucide="${n}"></i>`;
  base.clientForm=function(id){
    originalForm(id);const form=document.querySelector('#modal form'),client=id?Clientes.obter(id):{};
    if(!form||form.querySelector('[name="marketingConsent"]'))return;
    form.querySelector('[name="observacoes"]')?.closest('.field')?.insertAdjacentHTML('afterend',`<div class="field full marketing-consent-field"><label><input type="checkbox" name="marketingConsent" value="true" ${client?.marketingConsent?'checked':''}> Autoriza receber campanhas e comunicações de marketing</label><small>Não marque sem autorização do cliente. Mensagens operacionais continuam separadas.</small><input type="hidden" name="marketingConsentSource" value="manual"></div>`);
  };
  function adapt(){
    const operation=window.OperationMode?.get?.();if(!operation||window.OperationMode?.can?.('viewCRM')===false)return;
    const credit=operation.modules.creditSales,loyalty=operation.modules.loyalty,summary=window.CRMDashboard?.snapshot?.(),db=DB.carregar(),clients=(db.clientes||[]).filter(c=>c.ativo!==false),metrics=new Map((summary?.results||db.metricasClientes||[]).map(x=>[x.client?.id||x.id,x.metric||x])),profiles=clients.map(c=>({client:c,metrics:metrics.get(c.id)||{totalSpent:Number(c.totalComprado||0),purchaseCount:Number(c.quantidadeVendas||0),daysSinceLastPurchase:999,activity:'no_data',availableRewards:0}})),revenue=profiles.reduce((s,p)=>s+p.metrics.totalSpent,0),purchases=profiles.reduce((s,p)=>s+p.metrics.purchaseCount,0);
    const actions=document.querySelector('.client-head .head-actions');
    if(actions&&!actions.querySelector('[data-go="crm"]'))actions.insertAdjacentHTML('afterbegin',`<button class="btn btn-light" data-go="crm">${icon('contact-round')} CRM</button>`);
    document.querySelectorAll('[data-go="crm"]').forEach(b=>b.onclick=()=>Router.ir('crm'));
    if(!credit){
      document.querySelectorAll('[data-go="cobrancas"],.top-debtors,[data-client-chip="debito"],[data-client-chip="credito"],[data-client-chip="nunca"],[data-client-chip="vencida"]').forEach(x=>x.remove());
      const kpis=document.querySelector('.client-kpis');
      if(kpis)kpis.innerHTML=`<article class="client-kpi green"><span>${icon('users')}</span><div><small>Clientes ativos</small><strong>${profiles.filter(p=>p.metrics.daysSinceLastPurchase<=30).length}</strong><em>últimos 30 dias</em></div></article><article class="client-kpi green"><span>${icon('circle-dollar-sign')}</span><div><small>Receita da base</small><strong>${money(revenue)}</strong><em>histórico</em></div></article><article class="client-kpi blue"><span>${icon('calculator')}</span><div><small>Ticket médio</small><strong>${money(purchases?revenue/purchases:0)}</strong><em>por compra</em></div></article><article class="client-kpi orange"><span>${icon('user-x')}</span><div><small>Clientes sem comprar</small><strong>${profiles.filter(p=>p.metrics.daysSinceLastPurchase>60).length}</strong><em>há mais de 60 dias</em></div></article>`;
      document.querySelectorAll('.professional-client-card').forEach(card=>{
        const client=clients.find(c=>c.id===card.dataset.clientId),metric=metrics.get(card.dataset.clientId);if(!client||!metric)return;
        const badge=card.querySelector('.client-status'),balance=card.querySelector('.client-balance'),receive=card.querySelector('[data-receive-client]');
        if(badge){badge.textContent=CRMCliente.formatActivity(metric.activity).replace('Cliente ','');badge.className=`client-status ${metric.activity==='active'?'credit':'zero'}`}
        if(balance)balance.innerHTML=`<strong>${money(metric.totalSpent)}</strong><span>em compras</span>`;
        if(receive){receive.disabled=false;receive.removeAttribute('data-receive-client');receive.dataset.smartSale=client.id;receive.innerHTML=`${icon('shopping-bag')} Nova venda`}
      });
      const mobileKpis=document.querySelector('.mobile-client-kpis');
      if(mobileKpis)mobileKpis.innerHTML=`<article>${icon('users')}<span><small>Clientes ativos</small><strong>${profiles.filter(p=>p.metrics.daysSinceLastPurchase<=30).length}</strong><em>últimos 30 dias</em></span></article><article>${icon('circle-dollar-sign')}<span><small>Receita da base</small><strong class="kpi-money-value">${money(revenue)}</strong><em>histórico</em></span></article><article>${icon('calculator')}<span><small>Ticket médio</small><strong class="kpi-money-value">${money(purchases?revenue/purchases:0)}</strong><em>por compra</em></span></article><article>${icon('user-x')}<span><small>Sem comprar</small><strong>${profiles.filter(p=>p.metrics.daysSinceLastPurchase>60).length}</strong><em>há mais de 60 dias</em></span></article>`;
      document.querySelectorAll('[data-mobile-filter="debito"],[data-mobile-filter="credito"],[data-mobile-filter="nunca"]').forEach(x=>x.hidden=true);
      document.querySelectorAll('[data-swipe-client]').forEach(shell=>{
        const client=clients.find(c=>c.id===shell.dataset.swipeClient),metric=metrics.get(shell.dataset.swipeClient);if(!client||!metric)return;
        const status=shell.querySelector('.mobile-client-status'),balance=shell.querySelector('.mobile-client-balance strong'),caption=shell.querySelector('.mobile-client-balance small'),receive=shell.querySelector('.mobile-receive');
        if(status){status.className=`mobile-client-status ${metric.activity==='active'?'credit':'zero'}`;status.textContent=CRMCliente.formatActivity(metric.activity).replace('Cliente ','')}
        if(balance)balance.textContent=money(metric.totalSpent);if(caption)caption.textContent='em compras';
        const facts=shell.querySelectorAll('.mobile-client-facts>span');if(facts[1]){facts[1].querySelector('small').textContent='Último contato';facts[1].querySelector('b').textContent=metric.lastContactAt?new Date(metric.lastContactAt).toLocaleDateString('pt-BR'):'Nunca'}
        if(receive){receive.disabled=false;receive.dataset.mobileSale=client.id;delete receive.dataset.mobileReceive;receive.innerHTML=`${icon('shopping-bag')} Nova venda`}shell.querySelector('.swipe-charge')?.remove();
      });
    }
    if(loyalty)document.querySelectorAll('.professional-client-card').forEach(card=>{const metric=metrics.get(card.dataset.clientId);if(metric?.availableRewards>0&&!card.querySelector('.smart-reward'))card.querySelector('header')?.insertAdjacentHTML('beforeend',`<span class="smart-reward">${icon('gift')} Recompensa disponível</span>`)});
    document.querySelectorAll('.professional-client-card,.mobile-client-card').forEach(card=>{
      card.tabIndex=0;card.setAttribute('role','button');
      card.addEventListener('click',event=>{if(event.target.closest('button,input,label,a'))return;const id=card.dataset.clientId||card.dataset.mobileCard;if(id)base.profile(id)});
      card.addEventListener('keydown',event=>{if((event.key==='Enter'||event.key===' ')&&!event.target.closest('button,input')){event.preventDefault();base.profile(card.dataset.clientId||card.dataset.mobileCard)}});
    });
    document.querySelectorAll('[data-smart-sale]').forEach(button=>button.onclick=()=>window.ClientesMobile?.startSale?.(button.dataset.smartSale));window.lucide?.createIcons();
  }
  base.bind=function(){const value=originalBind();queueMicrotask(adapt);return value};
  addEventListener('operation-settings-changed',()=>{if(Router.atual()==='clientes')base.refresh()});
})();
