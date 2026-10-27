'use strict';
// Offline WHATWG DOM tests. No browser control, network, Firebase or user data.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const {JSDOM, VirtualConsole} = require('jsdom');
const wait = (ms = 5) => new Promise(resolve => setTimeout(resolve, ms));
function setup({mobile = true, allow = true, batch, preflight} = {}) {
  const errors = [], virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', e => errors.push(e.message));
  const dom = new JSDOM('<!doctype html><html lang="pt-BR"><body><main id="app"></main><nav id="bottom-nav"></nav><div id="modal"></div><div id="toasts"></div></body></html>', {
    url:'https://qa.invalid/#/produtos', runScripts:'outside-only', virtualConsole,
  });
  const w = dom.window, data = {produtos:Array.from({length:4},(_,i)=>({id:'p'+i,nome:i===0?'Creme QA <especial>':'Produto QA '+i,preco:10,estoqueAtual:5,estoqueMinimo:1,ativo:true})),vendas:[]};
  let calls = 0, permission = allow, key = 'owner:qa:space1', pending = [], route = 'produtos';
  const toasts = [];
  Object.assign(w, {structuredClone, IntersectionObserver:class {observe() {} disconnect() {}},
    matchMedia: () => ({matches:mobile,addEventListener() {}}), scrollTo() {},
    Utils:{toast:(...args)=>toasts.push(args)}, Router:{atual:()=>route},
    TeamAccess:{has:()=>permission}, DB:{carregar:()=>data},
    Produtos:{obter:id=>data.produtos.find(p=>p.id===id),listar:()=>data.produtos,status:()=> 'disponivel'},
    getProductStockStatus:()=> 'disponivel',ProductVariations:{isVariable:()=>false,search:()=>[]},
    ProductActions:{identity:()=>{if(!permission)throw Error('denied');return{key};},pending:()=>pending,
      isPending:id=>pending.some(r=>r.productId===id),displayProducts:rows=>rows.map(p=>pending.some(r=>r.productId===p.id)?{...p,ativo:true}:p),
      checkPending:async()=>{pending=[];return[{status:'confirmed'}];},
      preflight:async(ids,kind)=>preflight ? preflight(ids,kind,w,data,key) : ({key,kind,eligibleIds:ids,items:ids.map(id=>({id,name:data.produtos.find(p=>p.id===id)?.nome,status:'ready',message:'Confirmado para QA'}))}),
      batch:async(ids,kind,progress)=>{calls++;if(batch)return batch(ids,kind,progress,w,data);data.produtos.forEach(p=>{if(ids.includes(p.id))p.ativo=false;});const r=ids.map(id=>({id,status:'confirmed'}));progress(r);return r;}}});
  const load = file => w.eval(fs.readFileSync(file,'utf8'));
  if (mobile) {
    load('js/produtos-mobile.js');
    w.ProdutosMobile.refresh();
  } else {
    // Exercise the actual production desktop card renderer, not a screenshot or
    // hand-maintained mock card. Other modules are deliberately not bootstrapped.
    w.dinheiro = v=>'R$ '+v; w.escapar=v=>String(v??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');w.icon=()=>'';
    const app = fs.readFileSync('js/app.js','utf8');
    w.eval(app.slice(app.indexOf('  function produtoCard(p)'),app.indexOf('  function desktopProductRows()'))+'\nwindow.qaCard=produtoCard;');
    w.AppPageRuntime={mount:()=>{w.document.querySelector('#app').innerHTML='<section class="desktop-products-page"><div class="desktop-product-toolbar"></div><section id="desktop-product-grid">'+data.produtos.filter(p=>p.ativo!==false).map(w.qaCard).join('')+'</section></section>';}};
    w.AppPageRuntime.mount();
  }
  load('js/product-selection.js');
  const $ = s=>w.document.querySelector(s), $$ = s=>[...w.document.querySelectorAll(s)];
  return {w,dom,data,$,$$,toasts,errors,get calls(){return calls;},load,
    deny:()=>{permission=false;w.dispatchEvent(new w.Event('business-context-changed'));},
    change:()=>{key='seller:qa:space2';w.dispatchEvent(new w.Event('veconi-space-context-changed'));},
    route:value=>{route=value;w.dispatchEvent(new w.Event('hashchange'));},
    pending:rows=>pending=rows,
    dispose:()=>{w.close();assert.deepEqual(errors,[],'no hidden unhandled DOM errors');}};
}
test('real mobile action sheet closes BEFORE delete dialog; cancel changes nothing and never resurrects stale sheet', async () => {
  const r = setup(); try {
    await wait(); const before=JSON.stringify(r.data);
    r.$('[data-product-menu="p0"]').click(); assert.ok(r.$('.product-action-sheet.open'));
    r.$('[data-product-delete="p0"]').click();
    assert.equal(r.$('.product-action-sheet'),null); assert.equal(r.$('.product-sheet-overlay'),null);
    await wait(); assert.equal(r.$('[role="dialog"] h3').textContent,'Excluir produto?');
    assert.match(r.$('.product-confirm-list').textContent,/Creme QA <especial>/);
    assert.equal(r.$('.product-confirm-list especial'),null);
    r.$$('[data-product-confirm-close]').at(-1).click(); await wait(20);
    assert.equal(r.calls,0); assert.equal(JSON.stringify(r.data),before); assert.equal(r.$('[role="dialog"]'),null);
    r.w.ProdutosMobile.refresh(); await wait(); assert.equal(r.$('.product-action-sheet'),null);
    assert.equal(r.$('#app').hasAttribute('inert'),false); assert.equal(r.w.document.body.style.overflow,'');
  } finally {r.dispose();}
});
test('confirmation single flight waits for actual outcome, then closes dialog/selection and updates listing', async () => {
  let resolve, requested;
  const r=setup({batch:(ids,kind,progress,w,data)=>new Promise(done=>{requested={ids,kind};resolve=()=>{data.produtos[0].ativo=false;done([{id:'p0',status:'confirmed'}]);};})});
  try {
    await wait(); await r.w.ProductSelection.open(['p0']); const submit=r.$('[data-product-confirm-submit]');
    submit.click(); submit.click();
    assert.equal(r.calls,1); assert.deepEqual(Array.from(requested.ids),['p0']); assert.equal(requested.kind,'delete');
    assert.equal(r.toasts.length,0); assert.ok(r.$('[role="dialog"]')); assert.equal(submit.disabled,true);
    resolve(); await wait(20);
    assert.equal(r.$('[role="dialog"]'),null); assert.equal(r.$('[data-product-card="p0"]'),null);
    assert.match(r.toasts[0][0],/Confirmado na nuvem/);
  } finally {r.dispose();}
});
test('long press 500ms selects first product; release click suppressed, next tap toggles other card', async () => {
  const r=setup();try{
    await wait();const card=r.$('[data-product-card="p0"]');
    const event=new r.w.MouseEvent('pointerdown',{bubbles:true,clientX:40,clientY:60});Object.defineProperties(event,{pointerType:{value:'touch'},pointerId:{value:1},isPrimary:{value:true}});card.dispatchEvent(event);
    await wait(530);assert.equal(r.w.ProductSelection.active(),true);assert.equal(r.$('[data-product-card="p0"] input').checked,true);
    card.click();await wait();assert.equal(r.$('[data-product-card="p0"] input').checked,true);
    await wait(920);r.$('[data-product-card="p1"] .mobile-product-copy').click();await wait();
    assert.equal(r.$('[data-product-card="p1"] input').checked,true);assert.match(r.$('#product-batch-bar').textContent,/2 selecionados/);
    r.$('[data-product-card="p1"] input').click();await wait();assert.equal(r.$('[data-product-card="p1"] input').checked,false);
    assert.equal(r.$('.product-action-sheet'),null);
  }finally{r.dispose();}
});
for(const reason of ['movement','scroll','pointercancel','pointerup'])test(`normal touch ${reason} cancels long press without selection or action menu`,async()=>{
  const r=setup();try{await wait();const card=r.$('[data-product-card]'),e=new r.w.MouseEvent('pointerdown',{bubbles:true,clientX:10,clientY:10});Object.defineProperty(e,'pointerType',{value:'touch'});card.dispatchEvent(e);
    card.dispatchEvent(reason==='movement'?new r.w.MouseEvent('pointermove',{bubbles:true,clientX:10,clientY:35}):new r.w.Event(reason,{bubbles:true}));await wait(540);
    assert.equal(r.w.ProductSelection.active(),false);assert.equal(r.$('.product-action-sheet'),null);
  }finally{r.dispose();}
});
test('desktop button, select displayed, deselect, batch dialog identification, archive and cancel',async()=>{
  const r=setup({mobile:false});try{await wait();r.$('[data-product-select-toggle]').click();await wait();
    assert.equal(r.$$('input[type="checkbox"]').length,4);r.$('[data-product-select-all]').click();await wait();assert.equal(r.$$('input:checked').length,4);
    r.$('[data-product-card="p1"]').click();await wait();assert.equal(r.$$('input:checked').length,3);
    r.$('[data-batch-archive]').click();assert.equal(r.$('.product-confirm-list').children.length,3);assert.match(r.$('#product-confirm-title').textContent,/Arquivar 3 produtos/);
    r.$$('[data-product-confirm-close]').at(-1).click();r.$('[data-batch-cancel]').click();await wait();assert.equal(r.calls,0);assert.equal(r.$('#product-batch-bar'),null);
  }finally{r.dispose();}
});
test('select all only considers cards displayed after a filter, not every product in the database',async()=>{
  const r=setup();try{await wait();r.w.ProdutosMobile.search('Produto QA 1');await wait();r.$('[data-product-select-toggle]').click();await wait();r.$('[data-product-select-all]').click();await wait();
    assert.equal(r.$$('input:checked').length,1);assert.equal(r.$('[data-product-card]').dataset.productCard,'p1');
  }finally{r.dispose();}
});
test('seller without edit sees no selection controls and cannot open product action confirmation',async()=>{
  const r=setup({allow:false});try{await wait();assert.equal(r.$('[data-product-selection-tools]'),null);await r.w.ProductSelection.open(['p0']);assert.equal(r.$('[role="dialog"]'),null);assert.equal(r.calls,0);}finally{r.dispose();}
});
test('permission/scope change clears old UI and rejects old batch result from replacement session',async()=>{
  let resolve;const r=setup({batch:()=>new Promise(done=>resolve=done)});try{await wait();await r.w.ProductSelection.open(['p0']);r.$('[data-product-confirm-submit]').click();r.change();await wait();assert.equal(r.$('[role="dialog"]'),null);resolve([{id:'p0',status:'confirmed'}]);await wait();assert.equal(r.toasts.length,0);assert.equal(r.$('#app').hasAttribute('inert'),false);}finally{r.dispose();}
});
test('permission removal cleans up checkboxes and inaccessible tab stops',async()=>{
  const r=setup();try{await wait();r.$('[data-product-select-toggle]').click();await wait();r.deny();await wait();assert.equal(r.$('[data-product-selection-check]'),null);assert.equal(r.$('[data-selection-tabindex]'),null);assert.equal(r.$('#product-batch-bar'),null);}finally{r.dispose();}
});
test('partial batch result names successes/failures individually, preserves selection and does not toast full success',async()=>{
  const r=setup({batch:async()=>[{id:'p0',status:'confirmed'},{id:'p1',status:'pending',message:'Rede indisponível; original preservado.'}]});try{await wait();await r.w.ProductSelection.open(['p0','p1']);r.$('[data-product-confirm-submit]').click();await wait();assert.match(r.$('.product-action-results').textContent,/1 de 2 confirmado/);assert.match(r.$('.product-action-results').textContent,/Rede indisponível/);assert.equal(r.toasts.length,0);assert.equal(r.$('[data-product-confirm-submit]'),null);assert.equal(r.$('[data-product-confirm-close]').disabled,false);}finally{r.dispose();}
});
test('Escape, Tab focus trap, Android/browser Back close top layers and restore scrolling',async()=>{
  const r=setup();try{await wait();await r.w.ProductSelection.open(['p0']);const buttons=r.$$('button',r.$('[role="dialog"]'));
    const first=r.$('[data-product-confirm-close]'),last=r.$('[data-product-confirm-submit]');last.focus();last.dispatchEvent(new r.w.KeyboardEvent('keydown',{bubbles:true,key:'Tab',cancelable:true}));assert.equal(r.w.document.activeElement,first);
    first.dispatchEvent(new r.w.KeyboardEvent('keydown',{bubbles:true,key:'Escape',cancelable:true}));await wait(25);assert.equal(r.$('[role="dialog"]'),null);
    r.$('[data-product-select-toggle]').click();await wait();await r.w.ProductSelection.open(['p0']);r.w.history.back();await wait(25);assert.equal(r.$('[role="dialog"]'),null);assert.equal(r.w.ProductSelection.active(),false);assert.equal(r.w.document.body.style.overflow,'');
  }finally{r.dispose();}
});
test('pending confirmation button only reads, explicitly reports pending instead of deleting again',async()=>{
  const r=setup();try{r.pending([{productId:'p0'}]);await wait();assert.match(r.$('[data-product-check-pending]').textContent,/Verificar confirmação \(1\)/);r.$('[data-product-check-pending]').click();await wait();assert.equal(r.calls,0);assert.match(r.toasts[0][0],/confirmadas na nuvem/);}finally{r.dispose();}
});
test('responsive CSS contract: dialog scroller, fixed accessible footer, safe areas, bottom navigation spacing, grid checks absolute',()=>{
  const css=fs.readFileSync('css/product-selection.css','utf8');
  for(const rule of [/height:100dvh/,/overflow-y:auto/,/min-height:0/,/\.modal-foot[^}]*flex:none/,/env\(safe-area-inset-bottom/,/var\(--mobile-bottom-safe-height/,/mobile-product-card>\.product-selection-check\{position:absolute/,/touch-action:pan-y/])assert.match(css,rule);
});
test('repeated open cannot stack confirmation dialogs or resurrect the old sheet',async()=>{
  const r=setup();try{await wait();await r.w.ProductSelection.open(['p0']);await r.w.ProductSelection.open(['p1']);assert.equal(r.$$('[role="dialog"]').length,1);assert.match(r.$('.product-confirm-list').textContent,/Creme QA/);r.$$('[data-product-confirm-close]').at(-1).click();await r.w.ProductSelection.open(['p1']);await wait(30);assert.equal(r.$$('[role="dialog"]').length,1);assert.match(r.$('.product-confirm-list').textContent,/Produto QA 1/);assert.equal(r.calls,0);}finally{r.dispose();}
});
test('unconfirmed product stays visible with an explicit badge; confirmation read removes it without reactivation or another delete',async()=>{
  const r=setup();try{await wait();r.data.produtos[0].ativo=false;r.pending([{productId:'p0'}]);r.w.ProdutosMobile.refresh();await wait();
    assert.ok(r.$('[data-product-card="p0"]'));assert.match(r.$('[data-product-card="p0"]').textContent,/Aguardando confirmação/);assert.equal(r.data.produtos[0].ativo,false);
    r.$('[data-product-menu="p0"]').click();assert.equal(r.$('.product-action-sheet'),null);
    r.$('[data-product-check-pending]').click();await wait();assert.equal(r.$('[data-product-card="p0"]'),null);assert.equal(r.calls,0);
  }finally{r.dispose();}
});
test('closing product confirmation never removes inert gates owned by authentication/plan',async()=>{
  const r=setup();try{await wait();r.$('#app').setAttribute('inert','');r.$('#bottom-nav').setAttribute('inert','');await r.w.ProductSelection.open(['p0']);r.$$('[data-product-confirm-close]').at(-1).click();await wait();assert.equal(r.$('#app').hasAttribute('inert'),true);assert.equal(r.$('#bottom-nav').hasAttribute('inert'),true);}finally{r.dispose();}
});
