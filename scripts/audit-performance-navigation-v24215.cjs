'use strict';
const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {routeFixture} = require('./audit-performance-runtime-c643cc5.cjs');
const path = require('node:path');
const {assetServer, launch, setup, listen, save, metrics, delta, out} = require('./performance-lab-helpers.cjs');

const ref = process.env.PERF_NAV_REF;
const versions = new Map();
if (ref) {
  for (const file of ['js/app.js', 'js/router.js', 'js/mobile-navigation.js', 'js/client-filter-rules.js',
    'js/clientes-mobile.js', 'js/checkout.js', 'js/checkout-mobile.js', 'js/barcode.js',
    'js/produtos-mobile.js', 'js/runtime-diagnostics.js', 'css/style.css']) {
    versions.set('/'+file, execFileSync('git', ['show', ref+':'+file], {encoding:'utf8'}));
  }
}
const routePath = '/tests/performance-navigation.html';
const server = assetServer(file => file === routePath ? routeFixture : versions.get(file) ?? null);
const rounds = Number(process.env.PERF_ROUNDS || 3);
const themes = (process.env.PERF_NAV_THEMES || 'light,dark').split(',');

async function navigation(page, destination) {
  return page.evaluate(async ({destination, frameSource}) => {
    const afterFrame = () => new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve, 0)));
    const root = document.querySelector('#app'), started = performance.now(), oldInstance = root.dataset.pageInstance;
    const title = document.querySelector('#title');
    const oldTitle = title.textContent;
    let shellMs = null, shellPaintMs = null, readyMs = null;
    const ready = new Promise((resolve, reject) => {
      const observer = new MutationObserver(() => {
        if (shellMs === null && title.textContent !== oldTitle) {
          shellMs = performance.now() - started;
          requestAnimationFrame(() => { shellPaintMs = performance.now() - started; });
        }
        if (root.dataset.route === destination && root.dataset.pageInstance !== oldInstance && root.children.length) {
          readyMs = performance.now() - started;
          clearTimeout(timer);observer.disconnect();resolve();
        }
      });
      observer.observe(root,{attributes:true,childList:true});
      observer.observe(title,{childList:true,characterData:true,subtree:true});
      const timer = setTimeout(() => { observer.disconnect();reject(Error('Route unavailable: '+destination)); }, 3000);
    });
    const target = document.querySelector(`[data-mobile-route="${destination}"]`);
    if (frameSource === 'link' && target) target.click();
    else Router.ir(destination);
    await ready;
    await afterFrame();
    const usefulPaintMs = performance.now() - started;
    await afterFrame(); // deliver PerformanceObserver entries for the mount
    const tasks = window.__lab.long.filter(entry => entry.at >= started && entry.at < started + usefulPaintMs);
    return {destination,shellMs,shellPaintMs,readyMs,usefulPaintMs,children:root.children.length,
      longTasks:tasks.length,longMaxMs:Math.max(0,...tasks.map(entry=>entry.ms)),
      longBlockingMs:tasks.reduce((sum,entry)=>sum+Math.max(0,entry.ms-50),0)};
  }, {destination,frameSource:'link'});
}

async function scroll(page, cdp) {
  const start = await page.evaluate(() => {
    scrollTo(0,0);
    window.__qaScrollAt = null;
    function recordScroll() {
      if (scrollY <= 0) return;
      window.__qaScrollAt = performance.now();
      document.removeEventListener('scroll', recordScroll, true);
    }
    document.addEventListener('scroll', recordScroll, {passive:true,capture:true});
    return performance.now();
  });
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:180,y:620}]});
  for(let index=1;index<=10;index++)
    await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:180,y:620-index*35}]});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
  const scrolled = await page.evaluate(() => ({
    y:scrollY,at:window.__qaScrollAt,
    height:document.scrollingElement.scrollHeight, viewport:innerHeight,
  }));
  assert.ok(scrolled.y > 0 && scrolled.at !== null,'The touch gesture must scroll the page');
  return {delayMs:scrolled.at-start,scrollY:scrolled.y};
}

async function rapidSwap(page) {
  return page.evaluate(async () => {
    const root = document.querySelector('#app'), mounted = [];
    const previousInstance = root.dataset.pageInstance;
    let invalidatedBeforeRender = false;
    const observer = new MutationObserver(() => {
      if (root.dataset.route && mounted.at(-1)!==root.dataset.route) mounted.push(root.dataset.route);
      if (root.dataset.loadingRoute === 'clientes') {
        invalidatedBeforeRender = root.dataset.pageInstance !== previousInstance;
        Router.ir('produtos');
        dispatchEvent(new CustomEvent('cloud-data-updated'));
      }
    });
    observer.observe(root,{attributes:true,childList:true});
    Router.ir('clientes');
    const deadline = performance.now()+3000;
    while (root.dataset.route!=='produtos' && performance.now()<deadline) await new Promise(r=>setTimeout(r,20));
    observer.disconnect();
    return {mounted,final:root.dataset.route,invalidatedBeforeRender};
  });
}

async function verifyLoading(page, cdp, theme) {
  await page.evaluate(() => {
    scrollTo(0,0);
    const frame = window.requestAnimationFrame;
    window.requestAnimationFrame = function holdNextFrame(callback) {
      if (document.querySelector('#app').dataset.loadingRoute === 'clientes') {
        window.requestAnimationFrame = frame;
        return frame.call(window, time => setTimeout(() => callback(time), 850));
      }
      return frame.call(window, callback);
    };
    Router.ir('clientes');
  });
  await page.waitForSelector('#app[aria-busy="true"] .route-skeleton');
  assert.equal(await page.$eval('#app', root => root.dataset.loadingRoute), 'clientes');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('drawer-open')), false);
  await page.screenshot({path:path.join(out,`navigation-shell-${theme}.png`)});
  const moved = await scroll(page, cdp);
  assert.equal(await page.$eval('#app', root => root.dataset.loadingRoute), 'clientes');
  await page.waitForSelector('#app[data-route="clientes"] #mobile-client-search');
  await page.$eval('#mobile-client-search', field => {
    field.focus();
    field.value = 'Cliente QA 01999';
    field.dispatchEvent(new Event('input', {bubbles:true}));
  });
  await page.waitForFunction(() => /Cliente QA 01999/.test(document.querySelector('#mobile-client-list').innerText));
  assert.equal(await page.$eval('#mobile-client-search', field => document.activeElement === field), true);
  await page.setOfflineMode(true);
  await navigation(page, 'vender');
  assert.ok(await page.$('#app [data-add], #app .pos-product'));
  await page.setOfflineMode(false);
  return moved;
}

async function main(){
  const base = await listen(server), browser = await launch(), rows = [];
  try {
    for (const theme of themes) for (let run=0;run<rounds;run++){
      const context = await browser.createBrowserContext(), page = await context.newPage(), errors = [];
      try{
        page.on('pageerror',error=>errors.push(error.message));
        const cdp = await setup(page,{mobile:true,theme,allowed:[base]});
        await page.evaluateOnNewDocument(theme=>localStorage.setItem('veconi-theme',theme),theme);
        await page.goto(base+routePath+'?visual=inicio&volume=large',{waitUntil:'domcontentloaded',timeout:55000});
        await page.waitForFunction(()=>document.body.dataset.visualReady==='inicio',{timeout:18000});
        for(const route of ['vender','clientes','produtos','inicio']){
          const before=await metrics(cdp), timings=await navigation(page,route);
          const result={theme,run,...timings,...delta(before,await metrics(cdp))};
          if(route==='clientes')result.touchScroll=await scroll(page,cdp);
          rows.push(result);
        }
        if(!ref){
          const swapped=await rapidSwap(page);
          assert.equal(swapped.final,'produtos');
          assert.ok(!swapped.mounted.includes('clientes'),JSON.stringify(swapped));
          assert.equal(swapped.invalidatedBeforeRender,true);
          if(process.env.PERF_NAV_SMOKE === '1' && run === 0)
            console.log(JSON.stringify({theme,loadingScroll:await verifyLoading(page,cdp,theme)}));
        }
        assert.deepEqual(errors,[]);
        save(process.env.PERF_NAV_OUTPUT || 'navigation-v24215.json',rows);
        console.log(JSON.stringify({theme,run,samples:rows.length}));
      }finally{await context.close();}
    }
  }finally{await browser.close();server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
