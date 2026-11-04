'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {BASE,PUBLISHED,read,runtime}=require('./helpers/v226-ui-regression.cjs');
const page=h=>h.q('.mobile-home-dashboard'),profit=h=>h.q('.home-main-metrics .profit');
for(const ref of [BASE,PUBLISHED,undefined])test(`profit remains in Home primary metrics, before summaries, ${ref?ref.slice(0,7):'hotfix'}`,()=>{
  const h=runtime({ref});try{h.render('inicio');const card=profit(h);assert.ok(card);assert.equal(card.previousElementSibling.className,'sold');assert.ok(page(h).querySelector('.home-secondary-scroller'));assert.equal(card.hidden,false);assert.equal(card.getAttribute('aria-hidden'),null);assert.equal(h.w.MobileHome.model().profit,48);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('all preexisting application stylesheets and Home rendering source are identical in V225 and V226',()=>{
  const css=ref=>[...read('index.html',ref).matchAll(/href="\.\/(css\/[^"?]+\.css)(?:\?[^"\s]*)?"/g)].map(m=>m[1]),before=css(BASE),after=new Set(css(PUBLISHED));
  for(const path of before){assert.ok(after.has(path),path);assert.equal(read(path,BASE),read(path,PUBLISHED),path);}
  for(const path of ['js/home-mobile.js','js/desktop-dashboard.js','js/operation-mode.js','js/exchange-economics.js','js/team-access.js'])assert.equal(read(path,BASE),read(path,PUBLISHED),path);
});
test('canonical active owner is not restricted by an empty or explicit false employee permission map',()=>{
  const h=runtime();try{const c=h.w.V226UIQA.context();for(const permissions of [{},{'profit.view':false,'performance.history':false,'performance.daily':false}]){const member={...c.member,permissions};const before=JSON.stringify(member);h.w.V226UIQA.change({permissions:[],member});h.render('inicio');assert.equal(h.w.TeamAccess.has('profit.view'),true);assert.equal(h.w.PerformanceAccess.restricted(),false);assert.ok(profit(h));assert.equal(JSON.stringify(h.w.V226UIQA.context().member),before);}assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
for(const scenario of ['no-goal','no-sales','empty-space','missing-cost'])test(`owner profit card is not removed by ${scenario}`,()=>{
  const h=runtime();try{const d=h.w.V226UIQA.data;if(scenario==='no-goal')d.config={nome:d.config.nome};if(scenario==='no-sales')d.vendas=[];if(scenario==='empty-space'){d.vendas=d.vendas.filter(s=>s.spaceId!=='qa-b');h.w.SpaceContext.selectHome('qa-b');}if(scenario==='missing-cost')d.vendas.forEach(s=>{delete s.custoTotal;delete s.lucro;});h.render('inicio');assert.ok(profit(h));assert.match(profit(h).textContent,/Lucro hoje/);if(['no-sales','empty-space'].includes(scenario))assert.match(profit(h).textContent,/0,00/);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
for(const ready of [false,true])test(`exchange projection ${ready?'ready':'pending'} changes the number, never removes the profit card`,()=>{
  const h=runtime();try{h.w.ExchangeEconomics={state:()=>({ready}),total:()=>0,forData:()=>[],statusMessage:()=>ready?'Valores confirmados':'Confirmando ajustes',refresh:async()=>{}};h.render('inicio');assert.ok(profit(h));if(ready)assert.match(profit(h).textContent,/48,00/);else{assert.match(profit(h).textContent,/Em revisão/);assert.equal(h.w.MobileHome.model().profit,null);}assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('a completed exchange today preserves the card with a cost-review message',()=>{
  const h=runtime();try{h.w.ExchangeEconomics={state:()=>({ready:true}),total:()=>0,forData:()=>[{createdAt:new Date().toISOString(),differenceCents:0}],statusMessage:()=>'',refresh:async()=>{}};h.render('inicio');assert.ok(profit(h));assert.match(profit(h).textContent,/Em revisão/);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('plan read-only state does not become a profit-visibility permission or alter owner authorization',()=>{
  const h=runtime();try{h.w.V226UIQA.change({access:{canMutate:false,canAccessApp:true,readOnly:true,features:{basicSales:true,financialModule:false}}});h.render('inicio');assert.ok(profit(h));assert.equal(h.w.TeamAccess.has('profit.view'),true);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('daily-only employee stays restricted even with a profit grant; history does not itself grant profit',()=>{
  const h=runtime();try{const c=h.w.V226UIQA.context(),base={...c.member,role:'seller',permissionsVersion:3,permissions:{'sales.create':true,'performance.daily':true,'performance.history':false,'profit.view':true}};h.w.V226UIQA.change({role:'seller',member:base,permissions:[],spaceAccess:'selected',allowedSpaceIds:['qa-a']});h.render('inicio');assert.ok(h.q('[data-daily-performance]'));assert.equal(profit(h),null);h.w.V226UIQA.change({member:{...base,permissions:{...base.permissions,'performance.history':true,'profit.view':false}}});h.render('inicio');assert.ok(page(h));assert.equal(profit(h),null);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('published loading/error fallback mislabels owner as a restricted profile; hotfix provides session status and restores owner Home',async()=>{
  for(const ref of [BASE,PUBLISHED,undefined]){const h=runtime({ref});try{for(const patch of [{loading:true,error:null},{loading:false,error:'synthetic session failure'}]){h.w.V226UIQA.change(patch);h.render('inicio');assert.equal(profit(h),null);if(ref){assert.match(h.q('#app').textContent,/Pronto para atender|não estão disponíveis neste perfil/);}else{assert.doesNotMatch(h.q('#app').textContent,/Pronto para atender|não estão disponíveis neste perfil/);assert.match(h.q('#app').textContent,patch.loading?/Verificando seu acesso/:/Não foi possível verificar seu acesso/);}assert.equal(h.w.V226UIQA.effects.calls.length,0);}h.w.V226UIQA.change({loading:false,error:null});await h.flush();assert.ok(profit(h));assert.equal(h.w.MobileHome.model().profit,48);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}}
});
test('inactive owner profile or membership cannot obtain profit while the same active principal can',()=>{
  const h=runtime();try{const c=h.w.V226UIQA.context();for(const patch of [{userProfile:{...c.userProfile,active:false}},{userProfile:c.userProfile,member:{...c.member,status:'suspended'}}]){h.w.V226UIQA.change(patch);h.render('inicio');assert.equal(profit(h),null);assert.equal(h.w.TeamAccess.has('profit.view'),false);}h.w.V226UIQA.change({member:c.member,userProfile:c.userProfile});h.render('inicio');assert.ok(profit(h));assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('desktop preserves the daily profit KPI while mobile uses Lucro hoje in the primary Home row',()=>{
  const h=runtime({width:1440});try{h.w.eval(read('js/desktop-dashboard.js'));const section=h.w.document.createElement('main');section.innerHTML=h.w.DesktopDashboard.render();assert.match(section.querySelector('.desktop-kpis').textContent,/Lucro estimado/);assert.ok(h.w.MobileHome.render().includes('Lucro hoje'));assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('space hydration and session completion preserve selected space, typed checkout fields and the cart',()=>{
  const h=runtime();try{h.w.SpaceContext.selectHome('qa-b');h.w.SpaceContext.selectSales('qa-b');h.render('vender');h.q('[data-add="qa-product"]').click();h.q('#sale-client').value='qa-client';h.q('#sale-client').dispatchEvent(new h.w.Event('change'));h.q('#sale-payment-method').value='dinheiro';h.q('#sale-note').value='Texto fictício mantido';const selection=h.w.SpaceContext.salesId(),home=h.w.SpaceContext.homeId();h.w.SpaceContext.setSpaces(h.w.V226UIQA.spaces);h.w.dispatchEvent(new h.w.CustomEvent('firebase-auth-ready'));assert.equal(h.w.SpaceContext.salesId(),selection);assert.equal(h.w.SpaceContext.homeId(),home);assert.equal(h.q('[data-space-select="sales"]').value,'qa-b');assert.equal(h.q('#sale-client').value,'qa-client');assert.equal(h.q('#sale-payment-method').value,'dinheiro');assert.equal(h.q('#sale-note').value,'Texto fictício mantido');assert.equal(h.w.Checkout.cartCount(),1);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('prior-sale entry appears after authenticated UID arrives, without toggling a mode or transmitting a sale',()=>{
  const h=runtime();try{const session=h.w.FirebaseSession;h.w.FirebaseSession={businessId:session.businessId};h.render('vender');assert.equal(h.q('[data-prior-start]'),null);h.w.FirebaseSession=session;h.w.dispatchEvent(new h.w.CustomEvent('firebase-auth-ready'));assert.ok(h.q('[data-prior-start]'));assert.equal(h.w.PriorSales.active(),false);assert.equal(h.w.V226UIQA.effects.calls.length,0);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('session feedback patch changes only rendering, preserving every performance reader and authorization function',()=>{
  const outsideRender=source=>{const a=source.indexOf('  function render(){'),b=source.indexOf('  function repaint(){',a);assert.ok(a>=0&&b>a);return source.slice(0,a)+source.slice(b);};assert.equal(outsideRender(read('js/performance-access.js')).replaceAll('\r\n','\n'),outsideRender(read('js/performance-access.js',PUBLISHED)).replaceAll('\r\n','\n'));
});
