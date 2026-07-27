(function(){
  'use strict';
  const $=(selector,root=document)=>root.querySelector(selector);
  const $$=(selector,root=document)=>[...root.querySelectorAll(selector)];
  const esc=value=>window.Utils?.escapar?.(String(value??''))??String(value??'');
  const icon=name=>`<i data-lucide="${name}"></i>`;
  const money=value=>Number(value||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  const featureLabels={
    products:'Produtos',stock:'Estoque',sales:'Vendas',clients:'Clientes',creditAccounts:'Fiado',payments:'Pagamentos',barcode:'Código de barras',
    campaigns:'Campanhas',onlineCatalog:'Catálogo online',onlineOrders:'Pedidos online',bulkMessages:'Disparos e cobranças',loyalty:'Fidelidade',
    advancedReports:'Relatórios avançados',dataImport:'Importação de dados',advancedExports:'Exportações avançadas',multipleUsers:'Usuários adicionais',
    rolesPermissions:'Perfis e permissões',multipleStocks:'Múltiplos estoques',multipleUnits:'Múltiplas unidades',automations:'Automações'
  };
  const futureFeatures=new Set(['multipleStocks','multipleUnits']);
  const proDetails={
    campaigns:{title:'Campanhas fazem parte do Plano Profissional',text:'Crie promoções, programas de fidelidade e recompensas para seus clientes.',benefits:['Compre X e ganhe Y','Acúmulo de pontos','Campanhas por produto','Controle de resgates']},
    onlineCatalog:{title:'Catálogo online faz parte do Plano Profissional',text:'Compartilhe seus produtos e receba pedidos de clientes pelo celular.',benefits:['Catálogo público','Produtos disponíveis','Carrinho do cliente','Link único para compartilhar']},
    onlineOrders:{title:'Pedidos online fazem parte do Plano Profissional',text:'Receba, organize e acompanhe pedidos enviados pelo catálogo.',benefits:['Fila de pedidos','Status do pedido','Integração com clientes','Conversão em venda']},
    bulkMessages:{title:'Disparos e cobranças fazem parte do Plano Profissional',text:'Organize mensagens e cobranças pelo WhatsApp com segurança.',benefits:['Central de mensagens','Cobrança em sequência','Modelos personalizados','Histórico de contatos']}
  };
  Object.assign(proDetails,{
    'sales.create':{title:'Novas vendas precisam de uma assinatura ativa',text:'Suas vendas anteriores e todos os dados continuam disponíveis para consulta.',benefits:['Registrar novas vendas','Atualizar estoque automaticamente','Gerar recibos e histórico']},
    'customers.create':{title:'Cadastro de clientes',text:'Seus clientes atuais continuam visíveis. Escolha um plano para cadastrar novos clientes.',benefits:['Novos cadastros','Histórico de relacionamento','Dados sempre preservados']},
    'products.create':{title:'Cadastro de produtos',text:'Seus produtos e estoque continuam visíveis. Escolha um plano para adicionar novos itens.',benefits:['Novos produtos','Variações e estoque','Uso no ponto de venda']},
    'campaigns.create':proDetails.campaigns,'catalog.publish':proDetails.onlineCatalog,'orders.receive':proDetails.onlineOrders,
    'crm.export':{title:'Exportação de CRM',text:'Esse recurso está disponível no Plano Profissional.',benefits:['Exportar segmentos','Criar públicos de marketing','Trabalhar os melhores clientes']}
  });
  const routeFeatures={campanhas:'campaigns',visitas:'onlineCatalog',catalogo:'onlineCatalog',pedidos:'onlineOrders'};
  let options={};

  function context(){
    const state=window.BusinessContext?.get?.()||{},session=window.FirebaseSession||{},subscription=state.subscription||session.subscription||{},access=state.access||session.access||{},business=state.business||session.business||{};
    return{state,session,subscription,access,business,internal:access.internal===true||subscription.planId==='internal'&&['active','internal'].includes(subscription.status)};
  }
  function plans(){return window.SubscriptionService?.getPlans?.()||window.SubscriptionService?.plans?.()||[]}
  function savings(plan){return Math.max(0,Math.round((1-plan.yearlyPrice/(plan.monthlyPrice*12))*100))}
  function statusLabel(status){return({trial:'Em teste',active:'Plano atual',past_due:'Pagamento pendente',grace_period:'Pagamento pendente',cancelled:'Cancelado',expired:'Expirado',suspended:'Suspenso',internal:'Conta interna'})[status]||status}
  function featureLine(label,enabled=true,future=false){return`<li class="${enabled?'included':'blocked'}">${icon(enabled?'circle-check':future?'clock-3':'circle-minus')}<span>${esc(label)}</span>${future?'<em>Em breve</em>':''}</li>`}
  function planFeatures(plan){
    if(plan.id==='essential')return[
      featureLine('Produtos e estoque'),featureLine('Clientes e fiado'),featureLine('Vendas e pagamentos'),featureLine('Dashboard básico'),featureLine('Código de barras'),featureLine('1 usuário'),
      featureLine('Campanhas',false),featureLine('Catálogo online',false),featureLine('Pedidos online',false),featureLine('Relatórios avançados',false),featureLine('Usuários adicionais',false)
    ].join('');
    if(plan.id==='professional')return[
      featureLine('Tudo do plano Essencial'),featureLine('Campanhas e fidelidade'),featureLine('Catálogo online'),featureLine('Pedidos online'),featureLine('Disparos e cobranças'),featureLine('Relatórios completos'),featureLine('Importação de dados'),featureLine('Até 3 usuários'),featureLine('Suporte prioritário básico')
    ].join('');
    return[
      featureLine('Tudo do plano Profissional'),featureLine('Até 10 usuários'),featureLine('Perfis e permissões'),featureLine('Relatórios avançados'),featureLine('Múltiplos estoques',true,true),featureLine('Múltiplas unidades',true,true),featureLine('Automações'),featureLine('Exportações avançadas'),featureLine('Suporte prioritário'),featureLine('Funcionalidades exclusivas')
    ].join('');
  }
  function cta(plan,{publicMode,current,internal}){
    if(internal)return'<button class="plan-cta" type="button" data-plan-preview>Visualizar fluxo</button>';
    if(current)return'<button class="plan-cta current" type="button" data-manage-plan>Gerenciar plano</button>';
    return`<button class="plan-cta" type="button" data-plan-cta="${plan.id}">${publicMode?'Criar minha conta':'Selecionar plano'}</button>`;
  }
  function planCard(plan,view){
    const current=view.currentPlan===plan.id&&!view.publicMode,status=view.subscription.status,currentText=statusLabel(status),limit=plan.id==='premium'?'Até 10 usuários':`Até ${plan.limits.products.toLocaleString('pt-BR')} produtos · ${plan.limits.clients.toLocaleString('pt-BR')} clientes`;
    return`<article class="subscription-plan-card ${plan.id} ${current?'is-current':''}" data-plan-card="${plan.id}" tabindex="0" aria-label="Plano ${esc(plan.name)}">
      ${plan.recommended?'<span class="recommended-ribbon">★ Mais escolhido</span>':''}
      <div class="plan-icon">${icon(plan.id==='essential'?'shopping-bag':plan.id==='professional'?'gem':'crown')}</div>
      <h2>${esc(plan.name)}</h2><p>${esc(plan.summary)}</p>
      <div class="plan-price"><small>R$</small><strong>${plan.monthlyPrice.toFixed(2).replace('.',',')}</strong><em>/mês</em></div>
      <div class="plan-yearly">ou ${money(plan.yearlyPrice)} /ano <span>Economize ${savings(plan)}%</span></div>
      ${current?`<span class="current-plan-badge">${esc(currentText)}</span>`:''}
      <ul>${planFeatures(plan)}</ul>
      <div class="plan-limits">${esc(limit)}<br>${plan.limits.monthlySales.toLocaleString('pt-BR')} vendas mensais</div>
      ${cta(plan,{...view,current})}
    </article>`;
  }
  function trialVisible(view){
    if(view.internal)return false;
    if(!view.subscription.planId)return true;
    if(['professional','premium'].includes(view.subscription.planId)&&view.subscription.status==='active')return false;
    if(view.subscription.featureTrial?.used)return false;
    if(view.subscription.fraudSuspended===true||view.subscription.status==='suspended')return false;
    return true;
  }
  function render(renderOptions={}){
    options=renderOptions;
    const ctx=context(),publicMode=Boolean(renderOptions.publicMode),showBack=publicMode||Boolean(renderOptions.authMode),currentPlan=['trial','trialing'].includes(ctx.subscription.status)?'professional':ctx.subscription.planId,view={...ctx,publicMode,currentPlan},available=plans();
    return`<section class="plans-page ${publicMode?'public-plans-page':''} ${renderOptions.authMode?'auth-plans-page':''}" data-plans-root>
      <header class="plans-heading">${showBack?'<button type="button" data-plans-back aria-label="Voltar">'+icon('arrow-left')+'</button>':''}<div><h1>Planos e assinatura</h1><p>Escolha o plano ideal para o seu negócio.</p></div>${publicMode?'<span class="plans-public-logo">AF</span>':''}</header>
      ${view.internal?`<div class="internal-plan-notice">${icon('shield-check')}<span><b>Conta interna</b> — todos os recursos liberados, sem vencimento ou cobrança.</span></div>`:''}
      ${trialVisible(view)?`<section class="trial-banner">${icon('rocket')}<div><h2>Teste grátis por 7 dias</h2><p>Explore todos os recursos do plano Profissional.<br>Cancele quando quiser, sem taxas.</p></div><span>${icon('circle-check')} Sem cartão de crédito</span>${publicMode?'':`<button type="button" data-start-feature-trial>Experimentar</button>`}</section>`:''}
      <div class="plans-carousel-shell"><button class="carousel-arrow prev" type="button" data-plan-prev aria-label="Plano anterior">${icon('chevron-left')}</button><div class="plans-carousel" data-plans-carousel>${available.map(plan=>planCard(plan,view)).join('')}</div><button class="carousel-arrow next" type="button" data-plan-next aria-label="Próximo plano">${icon('chevron-right')}</button></div>
      <div class="plan-indicators" aria-label="Navegação dos planos">${available.map((plan,index)=>`<button type="button" data-plan-indicator="${index}" aria-label="Mostrar plano ${esc(plan.name)}"></button>`).join('')}</div>
      <section class="plans-compare"><header><h2>Compare os planos</h2><button type="button" data-full-comparison>Ver tabela completa ${icon('chevron-right')}</button></header><div>${[
        ['package-check','Produtos e estoque','Organize, controle e acompanhe tudo.'],['users','Clientes e fiado','Cadastre clientes e controle o fiado.'],['megaphone','Campanhas','Fidelize e promova seus produtos.'],['shopping-cart','Pedidos online','Receba pedidos dos seus clientes.']
      ].map(item=>`<article>${icon(item[0])}<b>${item[1]}</b><p>${item[2]}</p></article>`).join('')}</div><footer><span>${icon('shield-check')}<b>Sem fidelidade</b><small>Cancele ou mude de plano quando quiser.</small></span><span>${icon('headphones')}<b>Suporte humano</b><small>Estamos prontos para ajudar.</small></span></footer></section>
      <section class="plans-security">${icon('shield')}<span>Seus dados estão seguros. Você pode exportar suas informações a qualquer momento.</span></section>
      ${publicMode?'<div class="public-plan-actions"><button class="btn btn-primary" type="button" data-public-register>Começar teste grátis</button><button class="btn btn-light" type="button" data-public-login>Entrar na minha conta</button></div>':''}
      <p class="payment-disclaimer">Pagamento processado com segurança pelo Mercado Pago. O app recebe o status oficial pelo Firebase.</p>
    </section>`;
  }
  function fullComparison(){
    const available=plans(),categories={Operação:['products','stock','sales','clients','creditAccounts','payments','barcode'],Crescimento:['campaigns','onlineCatalog','onlineOrders','bulkMessages','loyalty'],Gestão:['advancedReports','dataImport','advancedExports','multipleUsers','rolesPermissions','multipleStocks','multipleUnits']};
    const root=$('#modal');if(!root)return;
    const limitRows=[
      ['Produtos','products',value=>Number(value).toLocaleString('pt-BR')],
      ['Clientes','clients',value=>Number(value).toLocaleString('pt-BR')],
      ['Vendas mensais','monthlySales',value=>Number(value).toLocaleString('pt-BR')],
      ['Usuários','users',value=>`Até ${Number(value).toLocaleString('pt-BR')}`]
    ];
    root.innerHTML=`<div class="modal-bg"><section class="modal-box plan-comparison-sheet"><header class="modal-head"><h3>Comparação completa</h3><button class="icon-btn" data-close-comparison aria-label="Fechar">${icon('x')}</button></header><div class="modal-body">${Object.entries(categories).map(([category,features])=>`<section><h4>${category}</h4>${features.map(feature=>`<div class="comparison-row"><b>${featureLabels[feature]}</b>${available.map(plan=>`<span class="${plan.features[feature]?'yes':'no'}">${futureFeatures.has(feature)?'<em>Em breve</em>':plan.features[feature]?icon('check'):'—'}<small>${plan.name}</small></span>`).join('')}</div>`).join('')}</section>`).join('')}<section><h4>Limites</h4>${limitRows.map(([label,key,format])=>`<div class="comparison-row comparison-limit-row"><b>${label}</b>${available.map(plan=>`<span class="yes"><strong>${format(plan.limits[key])}</strong><small>${plan.name}</small></span>`).join('')}</div>`).join('')}</section></div></section></div>`;
    $('[data-close-comparison]',root).onclick=()=>root.innerHTML='';window.lucide?.createIcons();
  }
  function openProModal(feature,decision={}){
    const details=proDetails[feature]||{title:'Este recurso faz parte do Plano Profissional',text:'Tenha mais ferramentas para vender e administrar seu negócio.',benefits:['Mais produtividade','Mais controle','Dados preservados','Upgrade quando estiver disponível']},root=$('#modal');
    if(!root)return;
    const limitCopy=decision.kind==='limit'?`<p class="plan-limit-context">Você atingiu o limite de <b>${decision.limit}</b>. Os ${decision.current||0} registros existentes continuam disponíveis.</p>`:'';
    root.innerHTML=`<div class="modal-bg"><section class="modal-box pro-feature-modal" role="dialog" aria-modal="true" aria-labelledby="upgrade-required-title"><header class="modal-head"><div class="pro-modal-icon">${icon(decision.kind==='subscription'?'lock-keyhole':'gem')}</div><h3 id="upgrade-required-title">${esc(details.title)}</h3><button class="icon-btn" data-close-pro aria-label="Fechar">${icon('x')}</button></header><div class="modal-body"><p>${esc(details.text)}</p>${limitCopy}<ul>${details.benefits.map(item=>`<li>${icon('circle-check')} ${esc(item)}</li>`).join('')}</ul><small>Você pode continuar navegando e consultando todos os dados existentes.</small></div><footer class="modal-foot"><button class="btn btn-light" data-close-pro>Agora não</button><button class="btn btn-primary" data-pro-plans>Ver planos</button></footer></section></div>`;
    $$('[data-close-pro]',root).forEach(button=>button.onclick=()=>root.innerHTML='');
    $('[data-pro-plans]',root).onclick=()=>{root.innerHTML='';window.Router?.ir?.('planos')};
    window.lucide?.createIcons();
  }
  function manageSubscription(){
    const root=$('#modal');if(!root)return;
    root.innerHTML=`<div class="modal-bg"><section class="modal-box pro-feature-modal"><header class="modal-head"><div class="pro-modal-icon">${icon('credit-card')}</div><h3>Gerenciar assinatura</h3><button class="icon-btn" data-close-billing aria-label="Fechar">${icon('x')}</button></header><div class="modal-body"><p>O status exibido no aplicativo vem do Firestore e é atualizado pelo webhook do Mercado Pago.</p><div class="actions"><button class="btn btn-light" data-refresh-subscription>${icon('refresh-cw')} Atualizar do Firebase</button><button class="btn btn-light" data-reconcile-subscription>${icon('cloud-cog')} Conferir com Mercado Pago</button></div><small class="muted">A conferência direta é excepcional e pode ser executada a cada 15 minutos.</small></div><footer class="modal-foot"><button class="btn btn-danger" data-cancel-subscription>Cancelar assinatura</button><button class="btn btn-primary" data-close-billing>Concluir</button></footer></section></div>`;
    $$('[data-close-billing]',root).forEach(button=>button.onclick=()=>root.innerHTML='');
    $('[data-refresh-subscription]',root).onclick=async event=>{event.currentTarget.disabled=true;try{await window.SubscriptionService.syncSubscriptionStatus();window.Utils?.toast?.('Assinatura atualizada pelo Firebase.');root.innerHTML='';window.Router?.render?.()}catch(error){window.Utils?.toast?.(error.message||'Não foi possível atualizar.',true)}finally{event.currentTarget.disabled=false}};
    $('[data-reconcile-subscription]',root).onclick=async event=>{event.currentTarget.disabled=true;try{await window.SubscriptionService.syncSubscriptionStatus({reconcileProvider:true});window.Utils?.toast?.('Conferência concluída.');root.innerHTML='';window.Router?.render?.()}catch(error){window.Utils?.toast?.(error.message||'Não foi possível conferir agora.',true)}finally{event.currentTarget.disabled=false}};
    $('[data-cancel-subscription]',root).onclick=async event=>{if(!confirm('Cancelar a assinatura recorrente? O acesso seguirá o status devolvido pelo Mercado Pago.'))return;event.currentTarget.disabled=true;try{const result=await window.SubscriptionService.requestCancellation();window.Utils?.toast?.(result.message);root.innerHTML='';window.Router?.render?.()}catch(error){window.Utils?.toast?.(error.message||'Não foi possível cancelar.',true)}finally{event.currentTarget.disabled=false}};
    window.lucide?.createIcons();
  }
  function scrollToIndex(carousel,index){
    const cards=$$('[data-plan-card]',carousel),card=cards[index];if(!card)return;$$('[data-plan-indicator]',carousel.closest('[data-plans-root]')).forEach((dot,i)=>dot.classList.toggle('active',i===index));carousel.scrollTo({left:card.offsetLeft-(carousel.clientWidth-card.offsetWidth)/2,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});
  }
  function updateIndicators(root){
    const carousel=$('[data-plans-carousel]',root),cards=$$('[data-plan-card]',carousel);if(!carousel||!cards.length)return;
    const center=carousel.scrollLeft+carousel.clientWidth/2,index=cards.reduce((best,card,i)=>Math.abs(card.offsetLeft+card.offsetWidth/2-center)<best.distance?{index:i,distance:Math.abs(card.offsetLeft+card.offsetWidth/2-center)}:best,{index:0,distance:Infinity}).index;
    $$('[data-plan-indicator]',root).forEach((dot,i)=>dot.classList.toggle('active',i===index));
    return index;
  }
  function bind(root=document,bindOptions={}){
    options={...options,...bindOptions};const scope=$('[data-plans-root]',root)||root;if(scope.dataset?.plansBound)return;scope.dataset.plansBound='true';
    const carousel=$('[data-plans-carousel]',scope),cards=$$('[data-plan-card]',scope),ctx=context(),target=['trial','trialing'].includes(ctx.subscription.status)?'professional':ctx.subscription.planId||'professional',targetIndex=Math.max(0,cards.findIndex(card=>card.dataset.planCard===target));
    let selectedIndex=targetIndex;
    const selectPlan=(index)=>{selectedIndex=Math.max(0,Math.min(cards.length-1,index));scrollToIndex(carousel,selectedIndex)};
    requestAnimationFrame(()=>{selectPlan(targetIndex);updateIndicators(scope)});
    let scrollTimer;carousel?.addEventListener('scroll',()=>{clearTimeout(scrollTimer);scrollTimer=setTimeout(()=>{selectedIndex=updateIndicators(scope)},80)},{passive:true});
    $('[data-plan-prev]',scope)?.addEventListener('click',()=>selectPlan(selectedIndex-1));
    $('[data-plan-next]',scope)?.addEventListener('click',()=>selectPlan(selectedIndex+1));
    $$('[data-plan-indicator]',scope).forEach(button=>button.onclick=()=>selectPlan(Number(button.dataset.planIndicator)));
    $('[data-full-comparison]',scope)?.addEventListener('click',fullComparison);
    $$('[data-plan-cta]',scope).forEach(button=>button.onclick=async()=>{if(options.publicMode)return options.onRegister?.();button.disabled=true;try{const result=await window.SubscriptionService?.requestUpgrade?.(button.dataset.planCta);if(result?.checkoutUrl){location.assign(result.checkoutUrl);return}window.Utils?.toast?.(result?.message||'Não foi possível abrir o checkout.',true)}catch(error){window.Utils?.toast?.(error.message||'Não foi possível iniciar a assinatura.',true)}finally{button.disabled=false}});
    $('[data-manage-plan]',scope)?.addEventListener('click',manageSubscription);
    $('[data-plan-preview]',scope)?.addEventListener('click',()=>window.Utils?.toast?.('A conta interna permanece inalterada.'));
    $('[data-start-feature-trial]',scope)?.addEventListener('click',async()=>{const result=await window.SubscriptionService?.startFreeTrial?.();window.Utils?.toast?.(result?.message||'Teste ainda não disponível.',true)});
    $('[data-plans-back]',scope)?.addEventListener('click',()=>options.onBack?.());
    $('[data-public-register]',scope)?.addEventListener('click',()=>options.onRegister?.());
    $('[data-public-login]',scope)?.addEventListener('click',()=>options.onLogin?.());
    window.lucide?.createIcons();
  }
  function canUse(feature){return window.PlanLimitService?.canUseFeature?.(feature)?.ok!==false}
  function syncNavigation(){
    $$('[data-plan-feature]').forEach(link=>{const feature=link.dataset.planFeature,allowed=canUse(feature);link.classList.toggle('plan-locked',!allowed);let badge=$('.plan-pro-badge',link);if(!allowed&&!badge){badge=document.createElement('span');badge.className='plan-pro-badge';badge.textContent='◇ PRO';link.append(badge)}if(allowed)badge?.remove()});
    const plansLink=$('[data-route="planos"]'),ctx=context();if(plansLink){const label=$('[data-plan-link-label]',plansLink);if(label)label.textContent=ctx.subscription.status==='trial'&&ctx.access.daysRemaining!==null?`Planos · ${ctx.access.daysRemaining} dias`:'Planos'}
  }
  function guardRoute(){return true}
  document.addEventListener('click',event=>{const action=event.target.closest('[data-requires-feature-action]');if(!action)return;const feature=action.dataset.requiresFeatureAction,decision=window.PlanLimitService?.canUseAction?.(feature);if(decision?.ok!==false)return;event.preventDefault();event.stopImmediatePropagation();openProModal(feature,decision)},true);
  addEventListener('business-context-changed',syncNavigation);
  addEventListener('firebase-auth-ready',syncNavigation);
  window.PlansUI={render,bind,fullComparison,openProModal,openUpgradeRequiredModal:openProModal,syncNavigation,guardRoute,routeFeatures,canUseFeature:canUse};
})();
