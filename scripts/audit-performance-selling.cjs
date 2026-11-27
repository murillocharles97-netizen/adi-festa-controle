'use strict';
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const { routeFixture } = require('./audit-performance-runtime-c643cc5.cjs');
const { assetServer, launch, setup, metrics, delta, listen, save, out } = require('./performance-lab-helpers.cjs');

const reference = process.argv.includes('--baseline');
const baseline = process.env.PERF_BASE_REF || '65ea4bb';
const legacyReference = reference && baseline === '65ea4bb';
const files = new Map();
if (reference) for (const name of ['js/app.js', 'js/checkout.js', 'js/checkout-mobile.js', 'js/desktop-sales.js', 'js/barcode.js', 'css/checkout-mobile.css'])
  files.set('/'+name, execFileSync('git', ['show', baseline+':'+name], { encoding:'utf8' }));
const functional = process.argv.includes('--functional');
const capturesOnly = process.argv.includes('--captures');
const releaseSmoke = process.argv.includes('--release-smoke');
const publicSite = process.env.VECONI_SELLING_SITE;
const fixture = routeFixture
  .replace('const n = large ? 2000 : 25, salesCount = large ? 5000 : 50, payCount = large ? 1600 : 20;',
    'const medium = new URLSearchParams(location.search).get("volume") === "medium"; const n = large ? 2000 : medium ? 400 : 25, salesCount = large ? 5000 : medium ? 1200 : 50, payCount = large ? 1600 : medium ? 400 : 20;')
  .replace('preco:10+i%80, custo:7, estoque:20, estoqueAtual:20, estoqueMinimo:2,',
    'preco:10+i%80, custo:7, estoque:20, estoqueAtual:20, estoqueMinimo:2, barcode:"7891234"+String(i).padStart(6,"0"), marca:"Marca QA", palavrasChave:"palavra"+i,');
const fixtureRoute = '/tests/performance-selling.html';
const server = assetServer(file => {
  if (file === fixtureRoute) return fixture;
  if (publicSite && !file.startsWith('/qa-sdk/')) {
    const published = path.resolve(publicSite, '.' + file);
    if (!published.startsWith(path.resolve(publicSite) + path.sep) || !fs.existsSync(published)) return null;
    return fs.readFileSync(published);
  }
  return files.get(file) ?? null;
});
const profiles = [
  {mobile:false,theme:'light'}, {mobile:false,theme:'dark'},
  {mobile:true,theme:'light'}, {mobile:true,theme:'dark'},
];
const rounds = Number(process.env.PERF_ROUNDS || 3);
const rows = [];

async function measure(page, cdp, phase, action) {
  const before = await metrics(cdp);
  const started = await page.evaluate(() => performance.now());
  await action();
  const result = await page.evaluate(async started => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const app = document.querySelector('#app'), grid = document.querySelector('#desktop-sale-products') || document.querySelector('#pos-grid');
    return { ms:performance.now()-started,
      nodes:app.querySelectorAll('*').length,
      cards:grid?.querySelectorAll('.pos-product').length || 0,
      visible:grid?.querySelectorAll('.pos-product:not([hidden])').length || 0,
      customerOptions:app.querySelector('#sale-client')?.options.length || 0,
      long:window.__lab.long.filter(entry=>entry.at>=started).map(entry=>entry.ms),
    };
  }, started);
  return { phase, ...result, ...delta(before, await metrics(cdp)) };
}
const navigate = (page, route) => page.evaluate(async route => {
  const app = document.querySelector('#app'), previous = app.dataset.pageInstance;
  const mounted = new Promise((resolve,reject) => {
    const observer = new MutationObserver(() => {
      if(app.dataset.route === route && app.dataset.pageInstance !== previous) {
        observer.disconnect();
        clearTimeout(timer);
        resolve();
      }
    });
    const timer = setTimeout(() => { observer.disconnect(); reject(Error('Rota sem montagem: '+route)); }, 25000);
    observer.observe(app,{attributes:true,childList:true});
  });
  Router.ir(route);
  await mounted;
  if(app.querySelector('.boot-recovery')) throw Error('Montagem falhou: '+route);
}, route);
const search = (page, value) => page.evaluate(value => new Promise((resolve,reject) => {
  const input = document.getElementById('product-search');
  const done = event => {
    if(event.detail.query !== value.toLowerCase()) return;
    clearTimeout(timer);
    removeEventListener('sale-products-filtered', done);
    resolve(event.detail.visible);
  };
  const timer = setTimeout(() => { removeEventListener('sale-products-filtered', done); reject(Error('Busca não concluiu')); }, 23000);
  addEventListener('sale-products-filtered', done);
  input.value=value;
  input.dispatchEvent(new Event('input',{bubbles:true}));
}), value);
const click = (page, selector) => page.$eval(selector, node => node.click());
const wait = (page, selector) => page.waitForSelector(selector, { timeout: 15000 });
const grid = ':is(#desktop-sale-products,.pos-page #pos-grid)';
const card = id => grid+' .pos-product[data-add="'+id+'"]:not([hidden])';

async function check(page, cdp, profile, volume, run) {
  const samples = [];
  const take = async (name,perform) => samples.push(await measure(page, cdp, name, perform));
  const size = {small:25,medium:400,large:2000}[volume];
  await take('primeira-abertura', () => navigate(page,'vender'));
  assert.equal(await page.evaluate(()=>document.documentElement.dataset.theme), profile.theme);
  if (releaseSmoke) {
    assert.equal(samples[0].cards, Math.min(36, size+6));
    assert.equal(Boolean(await page.$('[data-sale-catalog-more]')), size+6 > 36);
  }
  await navigate(page,'inicio');
  await take('segunda-abertura', () => navigate(page,'vender'));
  await take('primeira-interacao', () => page.$eval('#product-search',node=>node.focus()));
  await take('busca-com-resultado', async () => {
    assert.equal(await search(page,'produto qa '+String(size-1).padStart(5,'0')),1);
    await wait(page,card('bench-p'+(size-1)));
  });
  await take('busca-sem-resultado',async () => assert.equal(await search(page,'inexistente qa'),0));
  assert.equal(await search(page,''),size+6);
  if (!legacyReference && volume!=='small') {
    await take('rolagem-e-proximo-lote',async()=>{
      const more = '[data-sale-catalog-more]';
      if (releaseSmoke) {
        assert.equal(await page.$eval(more, button => button.textContent.trim()), 'Mostrar mais produtos');
        assert.ok(await page.$eval(more, button => button.getBoundingClientRect().height >= 44 && button.tabIndex === 0));
        await page.focus(more);
        await page.keyboard.press('Enter');
        assert.ok(await page.evaluate(() => {
          const item = document.activeElement.closest('.pos-product');
          return item && [...item.parentElement.querySelectorAll('.pos-product')].indexOf(item) === 36;
        }), 'foco transferido para o primeiro cartão do novo lote');
      } else await page.$eval(more,node=>{node.scrollIntoView({block:'center'});node.click();});
      assert.equal(await page.$$eval(grid+' .pos-product',nodes=>nodes.length),72);
    });
    const scroll = await page.evaluate(()=>window.scrollY);
    await navigate(page,'inicio');
    await navigate(page,'vender');
    assert.equal(await page.$$eval(grid+' .pos-product',nodes=>nodes.length),72);
    const restored = await page.evaluate(async()=>{await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));return scrollY;});
    assert.ok(Math.abs(restored-scroll)<12, 'posição '+scroll+' → '+restored);
  } else {
    await take('rolagem-e-proximo-lote',async()=>{
      await page.evaluate(selector=>{const nodes=document.querySelectorAll(selector);nodes[Math.min(nodes.length-1,71)].scrollIntoView({block:'center'});},grid+' .pos-product');
    });
  }
  const find = size-1;
  await take('busca-codigo-fora-do-lote',async()=>{
    assert.equal(await search(page,'7891234'+String(find).padStart(6,'0')),1);
    await wait(page,card('bench-p'+find));
  });
  await take('selecionar-e-incluir',async()=>{
    await click(page,card('bench-p'+find));
    assert.equal(await page.evaluate(()=>Checkout.cartCount()),1);
  });
  await take('abrir-checkout',async()=>{
    await click(page,'#open-sale-summary');
    await wait(page,'#pos-summary:not([hidden])');
  });
  await take('remover-do-carrinho',async()=>{
    await click(page,'#cart [data-remove]');
    assert.equal(await page.evaluate(()=>Checkout.cartCount()),0);
  });
  await click(page,'#close-sale-summary');
  await search(page,'cone recheado');
  await click(page,card('p1'));
  await click(page,'#open-sale-summary');
  if (!profile.mobile) await click(page,'#desktop-continue-sale');
  const payment = releaseSmoke
    ? profile.theme === 'light' ? 'dinheiro' : profile.mobile ? 'cartao' : 'pix'
    : ['dinheiro','pix','cartao'][run%3];
  await page.evaluate(method=>{
    const chip=document.querySelector('.mobile-payment-chips [data-payment="'+method+'"]');
    if(chip) return chip.click();
    const input=document.querySelector('#sale-payment-method');
    input.value=method;input.dispatchEvent(new Event('change',{bubbles:true}));
  },payment);
  await take('finalizacao-ficticia',async()=>{
    const prior = await page.evaluate(()=>DB.carregar().vendas.length);
    await click(page,'#finish-sale');
    await wait(page,'.sale-receipt-paper');
    const result = await page.evaluate(async()=>{
      await DB.flush();
      const sales=DB.carregar().vendas;
      return { count:sales.length, sale:sales.at(-1), cart:Checkout.cartCount(), stock:Produtos.obter('p1').estoqueAtual };
    });
    assert.equal(result.count,prior+1);
    assert.equal(result.sale.formaPagamento,payment);
    assert.equal(result.sale.valorFinal,12);
    assert.equal(result.sale.financialSpaceId,'fixture-space');
    assert.equal(result.stock,17);
    if(!legacyReference) assert.match(await page.$eval(card('p1'),node=>node.textContent),/Estoque:\s*17/);
    assert.equal(result.cart,0);
  });
  return samples;
}

async function functionalChecks(page, mobile) {
  await navigate(page,'vender');
  const last=card('bench-p399');
  assert.equal(await page.$(last),null);
  assert.equal(await search(page,'palavra399'),1);
  await wait(page,last);
  await page.select('#pos-category','categoria 0');
  assert.equal(await page.$(last),null);
  await page.select('#pos-category','categoria 3');
  await wait(page,last);
  await navigate(page,'inicio');
  await navigate(page,'vender');
  assert.equal(await page.$eval('#pos-category',input=>input.value),'categoria 3');
  assert.equal(await page.$eval('#product-search',input=>input.value),'palavra399');
  assert.equal(await page.$$eval(grid+' .pos-product',nodes=>nodes.length),1);
  await wait(page,last);
  await page.select('#pos-category','');
  await search(page,'');
  await page.select('#pos-sort','vendidos');
  const bestSellers = await page.$$eval(grid+' .pos-product', nodes => nodes.slice(0,8).map(node=>node.dataset.add));
  assert.equal(bestSellers.length,8);
  await page.select('#pos-sort','nome');
  if(mobile) {
    await click(page,'[data-sale-filter="recent"]');
    assert.ok((await page.$$eval(grid+' .pos-product',nodes=>nodes.length))<=8);
    await click(page,'[data-sale-filter="favorites"]');
    assert.equal(await page.$(card('p2')),null);
    await click(page,'[data-sale-filter="quick"]');
  }else {
    await page.select('#desktop-sale-brand','marca qa');
    assert.equal(await page.$(card('p1')),null);
    await page.select('#desktop-sale-brand','');
  }
  const draft = () => page.evaluate(()=>Checkout.cartCount());
  assert.equal(await page.$(last),null,'item ainda fora do lote antes da leitura');
  await page.evaluate(async()=>{
    const scanner = BarcodeScannerService, original = scanner.startScanner;
    try {
      let read;
      scanner.startScanner = async ({onDetected})=>{read = onDetected;};
      BarcodeWorkflows.sale();
      await read({value:'7891234000399',format:'ean_13'});
    } finally {
      BarcodeUI.close();
      scanner.startScanner = original;
    }
  });
  assert.equal(await draft(),1);
  await click(page,'#open-sale-summary');
  await click(page,'#cart [data-remove]');
  await click(page,'#close-sale-summary');
  assert.equal(await draft(),0);
  await page.evaluate(()=>{
    DB.alterar(db=>{
      const foreign=db.produtos.find(p=>p.id==='bench-p398');
      Object.assign(foreign,{spaceAccessMode:'single_space',defaultSpaceId:'outro-espaco-qa',allowedSpaceIds:['outro-espaco-qa']});
      const out=db.produtos.find(p=>p.id==='bench-p397');
      Object.assign(out,{estoqueAtual:0,estoque:0,totalStock:0});
    });
    Checkout.refreshProducts();
  });
  assert.equal(await search(page,'palavra398'),0);
  assert.equal(await page.evaluate(()=>BarcodeWorkflows.addSaleProduct(Produtos.obter('bench-p398'))),false);
  assert.equal(await search(page,'palavra397'),1);
  await click(page,card('bench-p397'));
  assert.equal(await draft(),0);
  await search(page,'ninho');
  await click(page,card('p2'));
  await wait(page,'[data-variant-inc="v2"]');
  await click(page,'[data-variant-inc="v2"]');
  await click(page,'[data-add-variants]');
  assert.equal(await draft(),1);
  await click(page,'#open-sale-summary');
  if (mobile) {
    await page.setOfflineMode(true);
    await click(page,'#open-client-picker');
    await page.$eval('#client-picker-search', input => {
      input.value='Cliente QA 00399';
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    const result='[data-choose-client="bench-c399"]';
    await wait(page,result);
    await click(page,result);
    assert.equal(await page.$eval('#sale-client',node=>node.value),'bench-c399');
    await navigate(page,'inicio');
    await navigate(page,'vender');
    assert.equal(await page.$eval('#sale-client',node=>node.value),'bench-c399');
    assert.equal(await draft(),1);
    await page.setOfflineMode(false);
    await click(page,'#open-sale-summary');
  }
  await page.evaluate(()=>{
    const customer=document.querySelector('#sale-client');
    customer.focus();
    customer.value='c1';
    customer.dispatchEvent(new Event('change',{bubbles:true}));
    const discount=document.querySelector('#discount-value');
    discount.value='2';
    discount.dispatchEvent(new Event('change',{bubbles:true}));
    window.SyncFirebase.prepareSaleCustomer=async id=>{if(id!=='c1')throw Error('Cliente fora da fixture');};
    window.SyncFirebase.assertCustomerForSale=id=>{if(id!=='c1')throw Error('Cliente fora da fixture');};
    window.SyncFirebase.confirmCreditSale=async sale=>sale;
  });
  if(!mobile) await click(page,'#desktop-continue-sale');
  await page.evaluate(()=>{
    const chip=document.querySelector('.mobile-payment-chips [data-payment="fiado"]');
    if(chip) chip.click();
    else {
      const method=document.querySelector('#sale-payment-method');
      method.value='fiado';
      method.dispatchEvent(new Event('change',{bubbles:true}));
    }
  });
  await click(page,'#finish-sale');
  await wait(page,'.sale-receipt-paper').catch(async error=>{
    const feedback=await page.$eval('#sale-submit-feedback',node=>node.textContent);
    throw Error(feedback || error.message, {cause:error});
  });
  const outcome=await page.evaluate(async()=>{
    await DB.flush();
    const sale=DB.carregar().vendas.at(-1);
    return {total:sale.valorFinal,method:sale.formaPagamento,variant:sale.itens[0].variantId,
      stock:DB.carregar().variacoesProdutos.find(row=>row.id==='v2').stock,
      projectedBalance:DB.carregar().clientes.find(row=>row.id==='c1').saldo};
  });
  assert.deepEqual(outcome,{total:10,method:'fiado',variant:'v2',stock:1,projectedBalance:-30});
  const text=await page.$eval(card('p2'),node=>node.textContent);
  assert.match(text,mobile ? /Estoque:\s*4/ : /opções\s*·\s*4 un/);
  return {variant:true,fiado:true,lateBarcode:true,spaceIsolation:true,stockFence:true,category:true,restoredFilter:true,favoritesOrBrand:true,recent:mobile,bestSellers,clientDraft:mobile,postSaleStock:true};
}

async function capture(page, profile) {
  await navigate(page,'vender');
  await page.waitForFunction(()=>!document.querySelector('#toasts .toast'));
  const device=profile.mobile?'mobile':'desktop';
  const file=path.join(out,'vender-'+device+'-'+profile.theme+'.png');
  await page.screenshot({path:file});
  return {file};
}

async function main() {
  const base=await listen(server), browser=await launch();
  try {
    for(const profile of profiles) for(const volume of ['small','medium','large']) for(let run=0;run<rounds;run++) {
      if (releaseSmoke && volume === 'medium') continue;
      if (process.env.PERF_PROFILE && process.env.PERF_PROFILE!==(profile.mobile?'mobile-':'desktop-')+profile.theme) continue;
      if (process.env.PERF_VOLUME && process.env.PERF_VOLUME!==volume) continue;
      const context=await browser.createBrowserContext(), page=await context.newPage(), errors=[];
      try {
        page.on('pageerror',error=>errors.push(error.message));
        page.on('dialog',dialog=>dialog.dismiss().catch(()=>{}));
        const cdp=await setup(page,{...profile,allowed:[base]});
        // Shell resources are not part of the benchmark for the selling route.
        if(profile.mobile) await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:0,downloadThroughput:-1,uploadThroughput:-1});
        await page.evaluateOnNewDocument(theme=>localStorage.setItem('veconi-theme',theme),profile.theme);
        await page.goto(base+fixtureRoute+'?visual=inicio&volume='+volume,{waitUntil:'domcontentloaded',timeout:55000});
        await page.waitForFunction(()=>document.body.dataset.visualReady==='inicio',{timeout:22000,polling:75});
        if(profile.mobile) await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:200000,uploadThroughput:93750});
        const samples=capturesOnly ? await capture(page,profile) : functional ? await functionalChecks(page,profile.mobile) : await check(page,cdp,profile,volume,run);
        assert.deepEqual(errors,[]);
        rows.push({...profile,volume,run,samples});
        console.log(JSON.stringify({...profile,volume,run,samples:functional||capturesOnly?samples:samples.map(x=>[x.phase,Math.round(x.ms),x.cards,x.nodes])}));
      } catch(error) {
        rows.push({...profile,volume,run,fault:error.message,errors});
        console.error(error.stack, errors);
      } finally {
        save(process.env.PERF_SELLING_OUTPUT || (releaseSmoke?'selling-release-smoke.json':capturesOnly?'selling-captures.json':functional?'selling-functional.json':reference?'selling-before.json':'selling-after.json'),rows);
        await context.close();
      }
    }
  } finally { await browser.close();server.close(); }
  if(rows.some(r=>r.fault))process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
