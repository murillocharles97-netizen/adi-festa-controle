'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const kit = require('./loja-qa-kit.cjs');
const model = require('../functions/src/shared/online-store');
const output = path.resolve('qa-artifacts/loja-v3/independent');
const results = [];
const slug = 'vitrine-ficticia';
const token = 'qa_public_store_audit_000000000000';
const phone = '(11) 90000-0000';
const previewPage = '[data-act="fullpreview"]';
const visibleText = (page,selector) => page.$eval(selector,e=>e.textContent);
const click = (page,selector) => page.evaluate(selector=>{
  const control=document.querySelector(selector);
  if(!control)throw Error('Controle ausente: '+selector);
  control.click();
},selector);
const switchView = (page,view) => click(page,'.lo-tabs [data-v="'+view+'"]');
const log = (name,data={}) => { results.push({name,...data}); console.log(JSON.stringify(results.at(-1))); };

function storeDoc(count=24, overrides={}) {
  const products = Array.from({length:count},(_,i)=>({
    id:'qa-'+i, nome:i===0?'Brigadeiro & café ☕':i===1?'Bolo de pote':`Item QA ${String(i+1).padStart(3,'0')}`,
    descricao:'Descrição da vitrine', categoria:i<2?'Doces':i%2?'Bolos':'Bebidas',
    preco:3.5+i/10, custo:2, estoqueAtual:20, productType:i===1?'variable':'simple',
  }));
  const variants = [
    {id:'morango',parentProductId:'qa-1',displayName:'Morango & Ninho 🍓',attributeValues:{Sabor:'Morango & Ninho 🍓'},price:12.5,stock:8},
    {id:'limao',parentProductId:'qa-1',displayName:'Limão',attributeValues:{Sabor:'Limão'},price:11,stock:0},
  ];
  const settings = model.settings({publicName:'Vitrine fictícia',contactPhone:phone, welcomeText:'Produtos de homologação',
    primaryColor:'#acd6c6',secondaryColor:'#125a47',pickupEnabled:true,deliveryEnabled:true,paymentMethods:['pix']});
  return {schemaVersion:6,catalogType:'space_store',catalogToken:token,businessId:'qa-empresa',spaceId:'qa-espaco',
    visitId:'qa-loja',revision:1,workspaceGeneration:0,publicSettings:settings,...settings,active:true,catalogVisible:true,
    acceptingOrders:false, items:products.map(p=>model.product(p,variants,{products:{'qa-0':{featured:true}}})),...overrides};
}

async function area(page,selector) {
  return page.$eval(selector, el=>{
    const doc=document.documentElement;
    const small=[...el.querySelectorAll('button,a[href]')].filter(node=>{
      const box=node.getBoundingClientRect();
      return box.width&&box.height&&!node.disabled&&(box.width<32||box.height<32);
    }).length;
    return {viewport:innerWidth,scroll:doc.scrollWidth,nodes:el.querySelectorAll('*').length,compactControls:small};
  });
}
async function capture(page,name) {
  await page.screenshot({path:path.join(output,name+'.png')});
}
async function adminLayout(browser,base) {
  for(const width of [360,390,412,1440])for(const theme of ['light','dark']) {
    const context=await browser.createBrowserContext();
    try{
      const {page,errors}=await kit.openAdmin(context,base,{width,theme,count:1000,latency:0});
      const views={};
      for(const view of ['home','products','design']) {
        const started=performance.now();
        await switchView(page,view);
        await page.waitForSelector('#store-v2[data-view="'+view+'"]');
        const detail=await area(page,'#store-v2');
        assert.equal(detail.scroll,detail.viewport,view+' '+width);
        assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme),theme);
        detail.ms=Math.round(performance.now()-started);
        if(view==='products'){
          detail.initial=await page.$$eval('.lo-pcard',n=>n.length);
          assert.equal(detail.initial,36);
          const searchTime=performance.now();
          await page.type('[data-q]','cesta café da manhã 41');
          await page.waitForFunction(()=>[...document.querySelectorAll('.lo-pcard')].some(n=>n.textContent.includes('Cesta café da manhã 41')));
          detail.searchMs=Math.round(performance.now()-searchTime);
          detail.heapMiB=+(Number((await page.metrics()).JSHeapUsedSize)/1048576).toFixed(2);
        }
        if(view==='design'&&width<768)assert.equal(await page.evaluate(()=>{
          const preview=document.querySelector('.lo-fab'),field=document.querySelector('#lo-welcomeText');
          return getComputedStyle(preview).position==='static'&&preview.getBoundingClientRect().bottom<=field.getBoundingClientRect().top;
        }),true);
        if((width===360&&theme==='dark')||(width===412&&theme==='light')||(width===1440&&theme==='dark')) {
          if(view==='products'){
            await page.$eval('[data-q]',el=>{el.value='';el.dispatchEvent(new Event('input',{bubbles:true}));});
            await page.waitForFunction(()=>document.querySelectorAll('.lo-pcard').length===36);
          }
          await capture(page,`admin-${view}-${theme}-${width}`);
        }
        views[view]=detail;
      }
      if(width===390){
        await click(page,previewPage);
        const frameElement=await page.waitForSelector('.lo-sheet iframe');
        const frame=await frameElement.contentFrame();
        await frame.waitForSelector('.sf-card');
        assert.match(await frame.$eval('h1',el=>el.textContent),/Doceria Aurora/);
        assert.ok(!(await frame.evaluate(()=>performance.getEntriesByType('resource').some(e=>e.name.includes('firebasejs')))));
        await page.keyboard.press('Escape');
        await page.waitForSelector('.lo-sheet',{hidden:true});
      }
      assert.deepEqual(errors,[]);
      log('admin-layout',{width,theme,views});
    }finally{await context.close();}
  }
}

async function whatsapp(browser,base,width,instagram=false) {
  const {page,errors}=await kit.openStore(browser,base,{width,slug,doc:storeDoc()});
  try{
    if(instagram)await page.setUserAgent('Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 Chrome/131.0.0.0 Mobile Safari/537.36 Instagram 350.0');
    await page.evaluateOnNewDocument(()=>addEventListener('click',e=>{
      if(e.target.closest('a[href^="https://wa.me/"]'))e.preventDefault();
    },true));
    await page.reload();
    await page.waitForSelector('.sf-card');
    const layout=await area(page,'.sf');
    assert.equal(layout.scroll,layout.viewport);
    await click(page,'.sf-section:not(.sf-featured) [data-open="catalog-qa-1"]');
    await page.waitForSelector('.sf-sheet');
    assert.ok(await page.$eval('[data-value="Limão"]',e=>e.disabled));
    await click(page,'[data-value="Morango & Ninho 🍓"]');
    await click(page,'[data-sheet-qty="1"]');
    await click(page,'[data-sheet-add]');
    await click(page,'.sf-section:not(.sf-featured) [data-add="catalog-qa-0"]');
    await click(page,'.sf-cart-btn');
    await page.type('#sf-note','Sem açúcar & café ☕');
    await click(page,'.sf-actions [data-go="checkout"]');
    await click(page,'#sf-send-wa');
    assert.match(await visibleText(page,'#sf-err-name'),/nome/i);
    await click(page,'[data-mode="delivery"]');
    await page.type('[name="name"]','João & Elisa');
    await page.type('[name="address"]','Rua Fictícia, 44 — Jardim');
    await click(page,'[data-pay="pix"]');
    const href = new URL(await page.$eval('#sf-send-wa',e=>e.href));
    const msg=href.searchParams.get('text');
    assert.equal(href.hostname,'wa.me');
    assert.equal(href.pathname,'/5511900000000');
    for(const part of ['2x Bolo de pote (Morango & Ninho 🍓) — R$ 25,00','1x Brigadeiro & café ☕ — R$ 3,50',
      'Subtotal: R$ 28,50','Rua Fictícia, 44 — Jardim','Pagamento: Pix','Sem açúcar & café ☕','João & Elisa']) assert.ok(msg.includes(part),part);
    assert.equal(msg,await visibleText(page,'[data-msg]'));
    await capture(page,`checkout-whatsapp-${width}`);
    await click(page,'#sf-send-wa');
    await page.waitForSelector('.sf-sent');
    assert.match(await visibleText(page,'.sf-sent'),/ainda não foi confirmado/);
    assert.deepEqual(await page.evaluate(()=>window.__QA_CALLS__||[]),[]);
    await capture(page,`whatsapp-conversa-${width}`);
    assert.deepEqual(errors,[]);
    log('whatsapp',{width,instagramUA:instagram,layout,urlChars:href.href.length});
  }finally{await page.close();}
}

async function concurrentDrafts(browser,base) {
  const contexts=await Promise.all([browser.createBrowserContext(),browser.createBrowserContext()]);
  try {
    const a=(await kit.openAdmin(contexts[0],base,{count:24,latency:0})).page;
    const b=(await kit.openAdmin(contexts[1],base,{count:24,latency:0})).page;
    const seed=await a.evaluate(async()=> (await FirebaseCallable('getOnlineStore',{
      businessId:'loja-qa-business',spaceId:'qa-space-a',
    })).data);
    let shared=seed.store, conflictCount=0, saves=0;
    for(const [page,delay] of [[a,420],[b,30]]) {
      await page.exposeFunction('sharedStoreCall',async (name,body)=>{
        if(name==='getOnlineStore')return {data:{...seed,store:shared}};
        await kit.sleep(delay);
        if(body.revision!==shared.revision){conflictCount++;return {error:'aborted'};}
        shared={...shared,revision:shared.revision+1,slug:body.slug,catalogSettings:body.settings,
          selectedProductIds:body.productIds,presentation:body.presentation};
        saves++;
        return {data:{store:shared}};
      });
      await page.evaluate(()=>{window.FirebaseCallable=async (name,body)=>{
        const reply=await window.sharedStoreCall(name,body);
        if(reply.error)throw Object.assign(Error('Outra aba alterou o rascunho.'),{code:'functions/'+reply.error});
        return reply;
      };});
    }
    await switchView(a,'products');
    await switchView(b,'design');
    const item=await a.$eval('.lo-pcard:not(.is-on)',el=>el.dataset.pid);
    await Promise.all([
      click(a,`.lo-pcard[data-pid="${item}"] .lo-pcard-main`),
      b.$eval('#lo-publicName',input=>{
        input.value='Vitrine atualizada na aba B';
        input.dispatchEvent(new Event('change',{bubbles:true}));
      }),
    ]);
    for(const page of [a,b])await page.waitForFunction(()=>/Rascunho salvo/.test(document.querySelector('[data-region="save"]').textContent));
    assert.equal(conflictCount,1);
    assert.equal(saves,2);
    assert.equal(shared.catalogSettings.publicName,'Vitrine atualizada na aba B');
    assert.ok(shared.selectedProductIds.includes(item));
    await a.setOfflineMode(true);
    await click(a,`.lo-pcard[data-pid="${item}"] .lo-pcard-main`);
    await a.waitForFunction(()=>/Não salvo/.test(document.querySelector('[data-region="save"]').textContent));
    assert.equal(saves,2);
    assert.ok(shared.selectedProductIds.includes(item));
    await capture(a,'rascunho-offline-nao-salvo');
    await a.setOfflineMode(false);
    await a.waitForFunction(()=>/Rascunho salvo/.test(document.querySelector('[data-region="save"]').textContent));
    assert.equal(saves,3);
    assert.ok(!shared.selectedProductIds.includes(item));
    log('concurrent-drafts',{tabs:2,conflictCount,saves,offlineRetained:true,publicWrites:0});
  } finally { await Promise.all(contexts.map(context=>context.close())); }
}

async function merchantFlow(browser,base) {
  const context=await browser.createBrowserContext();
  try{
    const {page,errors}=await kit.openAdmin(context,base,{width:390,theme:'dark',scenario:'new',latency:60});
    const getStore=()=>page.evaluate(()=>window.__lojaQA.stores.get('qa-space-a'));
    await page.evaluate(({slug,phone})=>{
      document.querySelector('[name="createName"]').value='Loja fictícia nova';
      document.querySelector('[name="createSlug"]').value=slug;
      document.querySelector('[name="createPhone"]').value=phone;
      document.querySelector('[name="createAll"]').checked=false;
    },{slug,phone});
    await click(page,'[data-create] button');
    await page.waitForSelector('#store-v2[data-view="products"] .lo-pcard');
    assert.equal((await getStore()).published,false);
    assert.equal(await page.evaluate(()=>window.__lojaQA.publicDocs.size),0);
    await page.focus('.lo-pcard-main');
    await page.keyboard.press('Space');
    assert.ok(await page.evaluate(()=>document.activeElement.matches('.lo-pcard-main[aria-checked="true"]')));
    await click(page,'[data-act="star"]:not([disabled])');
    await click(page,'[data-act="select-mode"]');
    await click(page,'[data-act="pick-all"]');
    await click(page,'[data-act="bulk"][data-op="in"]');
    await page.waitForFunction(()=>window.__lojaQA.stores.get('qa-space-a').selectedProductIds.length===24);
    await click(page,'[data-act="organize"]');
    await page.waitForSelector('[data-sortable="categories"] [data-rename]');
    await page.$eval('[data-sortable="categories"] [data-rename]',input=>{
      input.value='Vitrine QA';
      input.dispatchEvent(new FocusEvent('focusout',{bubbles:true}));
    });
    await click(page,'[data-sortable="categories"] [data-act="move"][data-dir="1"]:not([disabled])');
    await click(page,'.lo-sheet [data-act="close-sheet"]');
    await switchView(page,'design');
    await click(page,'.lo-palette[data-id="folha"]');
    await page.waitForFunction(()=>window.__lojaQA.stores.get('qa-space-a').presentation.categories.some(x=>x.publicName==='Vitrine QA'));
    const saved=await getStore();
    assert.ok(Object.values(saved.presentation.products).some(p=>p.featured));
    assert.ok(saved.catalogSettings.primaryColor);
    await switchView(page,'home');
    await click(page,'.lo-head [data-act="ask-publish"]');
    await page.waitForSelector('[data-act="do-publish"]:not(:disabled)');
    await click(page,'[data-act="do-publish"]');
    await page.waitForFunction(()=>window.__lojaQA.stores.get('qa-space-a').published);
    assert.match(await page.$eval('.lo-head a[target="_blank"]',a=>a.href),/catalogo\.html\?loja=vitrine-ficticia$/);
    await click(page,'.lo-head [data-act="share"]');
    await click(page,'[data-act="qr"]');
    assert.ok(await page.waitForSelector('#store-qr img'));
    await page.keyboard.press('Escape');
    await page.$eval('.lo-more',el=>{el.open=true;});
    await click(page,'[data-act="ask-pause"]');
    await click(page,'[data-act="do-pause"]');
    await page.waitForFunction(()=>document.querySelector('.lo-status-paused')&&window.__lojaQA.stores.get('qa-space-a').published===false);
    await click(page,'.lo-head [data-act="ask-publish"]');
    await page.waitForSelector('[data-act="do-publish"]:not(:disabled)');
    await click(page,'[data-act="do-publish"]');
    await page.waitForFunction(()=>document.querySelector('.lo-status-published')&&window.__lojaQA.stores.get('qa-space-a').published);
    assert.deepEqual(errors,[]);
    log('merchant-flow',{created:true,bulkCount:24,featured:true,category:true,shareQr:true,republication:true});
  } finally { await context.close(); }
}

async function publicStates(browser,base){
  for(const [name,doc,pattern] of [
    ['phone-not-set',storeDoc(24,{contactPhone:'',publicSettings:{}}),/não recebe pedidos pelo site/],
    ['hidden',storeDoc(24,{catalogVisible:false}),/não está disponível/],
    ['paused',storeDoc(24,{active:false}),/está pausada/],
    ['connection',null,/Sem conexão com a loja/],
  ]){
    const {page}=await kit.openStore(browser,base,{width:390,slug,doc,offline:name==='connection'});
    try{
      assert.match(await visibleText(page,'#catalog-app'),pattern);
      assert.equal(await page.$('.sf-add'),null);
      log('public-state',{state:name});
    }finally{await page.close();}
  }
}

async function pendingOrder(browser,base) {
  const {page}=await kit.openStore(browser,base,{width:390,slug,doc:storeDoc(24,{acceptingOrders:true})});
  try{
    await page.evaluate(()=>{window.__QA_CALL__=async()=>{throw Object.assign(Error('Resposta perdida'),{code:'functions/unavailable'});};});
    await click(page,'.sf-section:not(.sf-featured) [data-add="catalog-qa-0"]');
    await click(page,'.sf-cart-btn');
    await click(page,'.sf-actions [data-go="checkout"]');
    await page.type('[name="name"]','Comprador fictício');
    await page.type('[name="phone"]','11900000000');
    await click(page,'[type="submit"]');
    assert.match(await visibleText(page,'#sf-err-payment'),/Escolha/);
    assert.deepEqual(await page.evaluate(()=>window.__QA_CALLS__||[]),[]);
    await click(page,'[data-pay="pix"]');
    await click(page,'[type="submit"]');
    await page.waitForFunction(()=>document.querySelector('#sf-checkout button')?.textContent.includes('Verificar envio pendente'));
    const original=await page.evaluate(t=>OnlineCheckoutAttempts.create(DB.localRecords,t).pending(),token);
    assert.equal(original.items.length,1);
    await page.evaluateOnNewDocument(t=>{
      window.__QA_DOCS__['publicCatalogs/'+t].acceptingOrders=false;
      window.__QA_DOCS__['publicCatalogs/'+t].items=[];
      window.__QA_CALL__=async()=>{throw Object.assign(Error('Confirmação temporariamente indisponível'),{code:'functions/unavailable'});};
    },token);
    await page.reload();
    await page.waitForSelector('#sf-checkout [type="submit"]');
    assert.equal(await page.$('#sf-send-wa'),null);
    assert.match(await visibleText(page,'#sf-checkout'),/em confirmação/);
    await capture(page,'pedido-pendente-sem-migrar-whatsapp');
    await page.evaluate(({id,orderAccessToken})=>{
      window.__QA_CALL__=async(name,data)=>{
        if(name!=='getOnlineOrderStatus'||data.id!==id||data.orderAccessToken!==orderAccessToken)throw Error('Mudou a tentativa');
        return {data:{order:{id,orderStatus:'recebido',publicOrderNumber:'QA-1',items:[],total:3.5}}};
      };
    },original);
    await click(page,'[type="submit"]');
    await page.waitForSelector('.sf-ok');
    assert.equal(await page.evaluate(t=>OnlineCheckoutAttempts.create(DB.localRecords,t).pending(),token),null);
    assert.ok((await page.evaluate(()=>window.__QA_CALLS__)).every(x=>x==='getOnlineOrderStatus'));
    log('pending-order',{retainedId:true,modeChanged:true,itemRemoved:true,duplicateSubmit:false});
  }finally{await page.close();}
}

async function largeStore(browser,base) {
  const doc=storeDoc(400), {page}=await kit.openStore(browser,base,{width:390,slug,doc});
  try{
    const stats=await area(page,'.sf');
    const cart=Object.fromEntries(doc.items.map(item=>[item.variants.length?item.id+'::'+item.variants[0].id:item.id,1]));
    const started=performance.now();
    await page.type('#sf-search','item qa 400');
    await page.waitForFunction(()=>document.querySelectorAll('.sf-card').length===1&&document.querySelector('.sf-card').textContent.includes('Item QA 400'));
    const searchMs=Math.round(performance.now()-started);
    await page.evaluate(({token,cart})=>localStorage.setItem('adiFesta:catalogCart:'+token,JSON.stringify(cart)),{token,cart});
    await page.reload();
    await page.waitForSelector('.sf-card');
    await click(page,'.sf-cart-btn');await click(page,'.sf-actions [data-go="checkout"]');
    await page.type('[name="name"]','Pessoa QA');
    const url=new URL(await page.$eval('#sf-send-wa',e=>e.href));
    const text=url.searchParams.get('text');
    assert.equal(text.split('\n').filter(row=>row.startsWith('1x ')).length,400);
    assert.match(text,/Item QA 400/);
    log('public-large',{...stats,searchMs,urlChars:url.href.length,heapMiB:+((await page.metrics()).JSHeapUsedSize/1048576).toFixed(2)});
  }finally{await page.close();}
}

async function main(){
  fs.mkdirSync(output,{recursive:true});
  const {server,base}=await kit.serve(),browser=await kit.launch(), failures=[];
  try{
    for(const [name,run] of [
      ['admin-layout',()=>adminLayout(browser,base)],
      ['concurrent-drafts',()=>concurrentDrafts(browser,base)],
      ['merchant-flow',()=>merchantFlow(browser,base)],
      ['whatsapp-360',()=>whatsapp(browser,base,360)],
      ['whatsapp-390',()=>whatsapp(browser,base,390,true)],
      ['whatsapp-412',()=>whatsapp(browser,base,412)],
      ['whatsapp-desktop',()=>whatsapp(browser,base,1440)],
      ['registered-pending',()=>pendingOrder(browser,base)],
      ['public-states',()=>publicStates(browser,base)],
      ['public-large',()=>largeStore(browser,base)],
    ]){
      if(process.env.VECONI_LOJA_CASE&&!process.env.VECONI_LOJA_CASE.split(',').includes(name))continue;
      try{await run();}catch(error){console.error(name,error.stack);failures.push({name,error:error.message});}
    }
  }finally{
    fs.writeFileSync(path.join(output,'results.json'),JSON.stringify({results,failures},null,2));
    await browser.close();server.close();
  }
  if(failures.length)process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
