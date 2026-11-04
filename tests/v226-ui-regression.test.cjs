'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),cp=require('node:child_process');
const {BASE,PUBLISHED,read,runtime}=require('./helpers/v226-ui-regression.cjs');
const mobileCSS=read('css/checkout-mobile.css');
function hiddenByMobileRule(element){
  assert.match(mobileCSS,/\.mobile-sale-page\s+\.pos-head\s*\{\s*display:none\s*\}/);
  return Boolean(element?.closest('.mobile-sale-page .pos-head'));
}
test('published V226 reproduces the hidden mobile previous-sale action with the real enhancer and CSS rule',()=>{
  const h=runtime({ref:PUBLISHED});try{h.render('vender');const action=h.q('[data-prior-start]');assert.ok(action);assert.equal(hiddenByMobileRule(action),true);}finally{h.close();}
});
for(const width of [320,360,390,430])test(`mobile ${width}: standalone action avoids hidden title; date/reason/external payment fields open and mode can be exited`,()=>{
  const h=runtime({width});try{h.render('vender');const action=h.q('[data-prior-start]');assert.ok(action.closest('[data-prior-entry]'));assert.equal(hiddenByMobileRule(action),false);assert.equal(action.hidden,false);action.click();assert.equal(h.w.PriorSales.active(),true);for(const field of ['date','time','reason','paymentDate','paymentTime'])assert.ok(h.q('[data-prior-'+field+']'));assert.equal(h.q('[data-prior-panel]').previousElementSibling,h.q('[data-prior-entry]'));h.q('[data-prior-exit]').click();assert.equal(h.w.PriorSales.active(),false);assert.equal(h.q('[data-prior-panel]'),null);assert.equal(h.w.V226UIQA.effects.calls.length,0);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('published V226 cannot restore an entry rendered before owner validation; corrective entry can',()=>{
  for(const ref of [PUBLISHED,undefined]){const h=runtime({ref});try{h.w.V226UIQA.change({loading:true});h.render('vender');assert.equal(h.q('[data-prior-start]'),null);h.w.V226UIQA.change({loading:false});h.w.dispatchEvent(new h.w.CustomEvent('firebase-auth-ready'));assert.equal(Boolean(h.q('[data-prior-start]')),ref!==PUBLISHED);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}}
});
test('entry refresh preserves the cart, explicit reason and original identifiers across context refresh',()=>{
  const h=runtime();try{h.render('vender');h.q('[data-add="qa-product"]').click();assert.equal(h.w.Checkout.cartCount(),1);h.q('[data-prior-start]').click();const reason=h.q('[data-prior-reason]');reason.value='Indisponibilidade fictícia QA';reason.dispatchEvent(new h.w.Event('input'));const before=Array.from({length:h.w.sessionStorage.length},(_,i)=>[h.w.sessionStorage.key(i),h.w.sessionStorage.getItem(h.w.sessionStorage.key(i))]);h.w.dispatchEvent(new h.w.CustomEvent('firebase-auth-ready'));assert.equal(h.w.Checkout.cartCount(),1);assert.equal(h.q('[data-prior-reason]').value,reason.value);for(const[key,value]of before)assert.equal(h.w.sessionStorage.getItem(key),value);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('revocation and account/business switch remove previous-sale controls without granting a seller access',()=>{
  const h=runtime();try{h.render('vender');h.q('[data-prior-start]').click();h.w.V226UIQA.change({role:'seller',member:{role:'seller',status:'active',permissions:{'sales.create':true}},spaceAccess:'selected',allowedSpaceIds:['qa-a']});assert.equal(h.q('[data-prior-start]'),null);assert.equal(h.q('[data-prior-panel]'),null);h.w.V226UIQA.change({businessId:'qa-other',role:'owner',business:{id:'qa-other',ownerId:'different-owner'},userProfile:{uid:'qa-other-user',businessId:'qa-other'}});assert.equal(h.q('[data-prior-start]'),null);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('paused intake remains inaccessible after context updates',()=>{const h=runtime();try{h.w.AdiFestaBuild.priorSalesPaused=true;h.render('vender');h.w.dispatchEvent(new h.w.CustomEvent('firebase-auth-ready'));assert.equal(h.q('[data-prior-start]'),null);}finally{h.close();}});
test('late space hydration while a modal is open replaces stale single-space text without remounting or clearing the cart',()=>{
  for(const ref of [PUBLISHED,undefined]){const h=runtime({ref});try{h.w.SpaceContext.setSpaces([h.w.V226UIQA.spaces[0]],{loaded:false});h.render('vender');h.q('[data-add="qa-product"]').click();const note=h.q('#sale-note');note.value='Observação fictícia preservada';h.q('#modal').innerHTML='<section role="dialog">Modal fictício em uso</section>';assert.ok(h.q('[data-space-context="sales"].is-single'));h.w.SpaceContext.setSpaces(h.w.V226UIQA.spaces);assert.equal(Boolean(h.q('[data-space-select="sales"]')),ref!==PUBLISHED);assert.equal(h.w.Checkout.cartCount(),1);assert.equal(note.value,'Observação fictícia preservada');assert.match(h.q('#modal').textContent,/Modal fictício/);if(!ref){const select=h.q('[data-space-select="sales"]');assert.equal(select.options.length,2);select.value='qa-b';h.w.confirm=()=>false;select.dispatchEvent(new h.w.Event('change'));assert.equal(h.w.SpaceContext.salesId(),'qa-a');assert.equal(h.w.Checkout.cartCount(),1);}assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}}
});
test('Home exits temporary restricted rendering when owner context finishes loading; profit calculation is preserved',async()=>{
  const h=runtime();try{h.w.V226UIQA.change({loading:true});h.render('inicio');assert.equal(h.q('.profit'),null);h.w.V226UIQA.change({loading:false});await h.flush();assert.ok(h.q('.home-main-metrics .profit'));assert.equal(h.w.MobileHome.model().profit,48);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('space refresh retires names from another business and never promotes stale cached spaces to authorization',()=>{
  const h=runtime();try{h.render('inicio');h.w.V226UIQA.change({businessId:'qa-new-business',business:{id:'qa-new-business',ownerId:'qa-new-owner'},role:'owner',userProfile:{uid:'qa-new-owner',businessId:'qa-new-business'},spaceAccess:'all'});assert.doesNotMatch(h.q('[data-space-context]').textContent,/Matriz QA|Filial QA/);assert.equal(h.w.SpaceContext.homeSpaces().length,0);assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('desktop entry opens the same prior-sale panel and leaves the normal checkout available',()=>{
  const h=runtime({width:1440});try{h.render('vender');assert.ok(h.q('[data-desktop-sales]'));h.q('[data-prior-start]').click();assert.ok(h.q('[data-prior-panel]'));assert.equal(h.w.PriorSales.active(),true);h.q('[data-prior-exit]').click();assert.equal(h.w.PriorSales.active(),false);assert.ok(h.q('#finish-sale'));assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
for(const ref of [BASE,PUBLISHED,undefined])test(`owner multi-space Home/profit and sales selectors, ${ref?ref.slice(0,7):'corrective'}`,async()=>{
  const h=runtime({ref});try{h.render('inicio');assert.ok(h.q('.home-main-metrics .profit'));assert.equal(h.w.MobileHome.model().profit,48);h.q('[data-space-picker="home"]').click();h.q('[data-space-choice="qa-b"]').click();assert.equal(h.w.SpaceContext.homeId(),'qa-b');assert.equal(h.w.MobileHome.model().profit,18);assert.match(h.q('.profit strong').textContent,/18,00/);assert.ok(h.q('.home-goal-card'));assert.ok(h.q('.home-attention'));assert.ok(h.q('.home-quick-summary'));h.render('vender');const select=h.q('[data-space-select="sales"]');assert.equal(select.options.length,2);select.value='qa-b';select.dispatchEvent(new h.w.Event('change'));assert.equal(h.w.SpaceContext.salesId(),'qa-b');assert.equal(h.w.V226UIQA.effects.writes,0);await h.flush();}finally{h.close();}
});
test('multi-space restrictions still exclude foreign, archived and unauthorized spaces; denied profit stays absent',()=>{
  const h=runtime();try{const c=h.w.V226UIQA.context();h.w.V226UIQA.change({role:'seller',member:{uid:c.userProfile.uid,role:'seller',status:'active',permissionsVersion:3,permissions:{'sales.create':true,'performance.history':true,'profit.view':false}},permissions:[],spaceAccess:'selected',allowedSpaceIds:['qa-a']});h.w.SpaceContext.setSpaces([...h.w.V226UIQA.spaces,{...h.w.V226UIQA.spaces[0],id:'qa-foreign',businessId:'other-business'},{...h.w.V226UIQA.spaces[0],id:'qa-archived',active:false}]);h.render('inicio');assert.equal(h.q('.profit'),null);assert.deepEqual(Array.from(h.w.SpaceContext.homeSpaces(),s=>s.id),['qa-a']);assert.throws(()=>h.w.SpaceContext.selectSales('qa-b'));assert.throws(()=>h.w.SpaceContext.selectHome('qa-foreign'));assert.equal(h.w.V226UIQA.effects.writes,0);}finally{h.close();}
});
test('V225→V226 did not edit the Home, profit, spaces, membership/session or performance rendering sources',()=>{
  for(const file of ['js/home-mobile.js','js/desktop-dashboard.js','js/spaces.js','js/team-access.js','js/performance-access.js','js/app.js','js/firebase/business-context.js','js/firebase/space-service.js','css/spaces.css','css/home-mobile.css'])assert.equal(read(file,BASE),read(file,PUBLISHED),file);
});
test('UI hotfix leaves every backend, Rules, billing hash manifest, Auth and Sync source byte-identical',()=>{
  const files=['functions','firestore.prior-sales.rules','firestore.rules','storage.rules','firestore.indexes.json','js/plans.js','js/firebase','js/team-access.js','releases/v225'];
  const changes=cp.execFileSync('git',['diff',PUBLISHED,'--',...files],{encoding:'utf8'});assert.equal(changes,'');
});
test('UI patch has an exact frontend/support allowlist and never authorizes publication or a data migration',()=>{
  const m=JSON.parse(read('releases/v226/ui-hotfix-manifest.json')),allowed=new Set([...m.runtimeFiles,...m.supportFiles]);
  const changes=cp.execFileSync('git',['diff','--name-only',PUBLISHED],{encoding:'utf8'}).trim().split('\n').filter(Boolean);for(const file of changes)assert.ok(allowed.has(file),'Unexpected hotfix file: '+file);
  assert.equal(m.base,PUBLISHED);assert.equal(m.deploymentAuthorized,false);assert.equal(m.productionReady,false);assert.equal(m.dataMutation,false);assert.equal(m.storageMigration,false);assert.equal(m.permissionMigration,false);assert.equal(m.functions.length+m.rules.length+m.indexes.length,0);
});
test('PWA changes only its static cache namespace, leaving activation, fallback and all preserved storage unchanged',()=>{
  const before=read('service-worker.js',PUBLISHED).replaceAll('\r\n','\n'),after=read('service-worker.js').replaceAll('\r\n','\n');assert.equal(after.slice(after.indexOf('\n')),before.slice(before.indexOf('\n')));assert.notEqual(after.split('\n')[0],before.split('\n')[0]);assert.doesNotMatch(after,/caches\.delete|indexedDB\.deleteDatabase|localStorage\.clear/);
});
