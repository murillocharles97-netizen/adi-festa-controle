'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const oldRef = '350d2b8';
const changed = new Set(execFileSync('git', ['diff', '--name-only', oldRef], {cwd:root,encoding:'utf8'}).trim().split(/\r?\n/));
const oldFiles = new Set(execFileSync('git', ['ls-tree','-r','--name-only',oldRef], {cwd:root,encoding:'utf8'}).trim().split(/\r?\n/));
const originals = new Map();
function bytes(file, release) {
  if (release === 241 && !oldFiles.has(file)) return null;
  if (release === 241 && changed.has(file)) {
    if (!originals.has(file)) originals.set(file, execFileSync('git', ['show',oldRef+':'+file], {cwd:root}));
    return originals.get(file);
  }
  const p = path.resolve(root,file);
  return p.startsWith(root+path.sep) && fs.existsSync(p) && fs.statSync(p).isFile() ? fs.readFileSync(p) : null;
}

let release = 241;
const types = {'.html':'text/html','.css':'text/css','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml'};
const server = http.createServer((req,res) => {
  const url = new URL(req.url,'http://127.0.0.1');
  res.setHeader('Cache-Control','no-store');
  if (url.pathname === '/qa-visual') {
    const index = bytes('index.html',release).toString();
    const assets = [...index.matchAll(/<(?:script|link)[^>]*(?:src|href)="(\.\/(?:js\/(?:build-info|veconi-fluxo|desktop-dashboard|home-mobile)\.js|css\/veconi-fluxo\.css)[^"]*)"[^>]*>/g)]
      .map(([,src])=>src.startsWith('./css/')?'<link rel="stylesheet" href="'+src+'">':'<script '+(/desktop-dashboard|home-mobile/.test(src)?'defer ':'')+'src="'+src+'"></script>').join('');
    res.setHeader('Content-Type','text/html');
    return res.end('<!doctype html><html><head>'+assets+'</head><body><button data-theme-toggle>Alternar</button><main id="app" data-route="vender"></main><script>window.DB={};window.confirm=()=>true;</script><script src="./js/local-records.js"></script><script src="./js/business-cache.js"></script><script src="./js/pwa-update.js"></script><script>window.qaRegistration=PwaUpdate.register();</script></body></html>');
  }
  const file = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
  const data = bytes(file,release);
  if (!data) return res.writeHead(404).end();
  res.setHeader('Content-Type', types[path.extname(file)]||'application/octet-stream');
  res.end(data);
});
const scope = 'adiFestaDB_v1:qa-visual:qa-owner:owner';
const queueKey = scope.replace('adiFestaDB_v1:', 'adiFesta:')+':syncQueue';
const queue = JSON.stringify([{operationId:'qa-pending',status:'pending',payload:{writes:[{value:10}]}},{operationId:'qa-review',status:'error',payload:{writes:[{value:20}]}}]);
const original = {vendas:[{id:'qa-sale',valorFinal:10}],pagamentos:[{id:'qa-payment',valor:20}]};
const expectedCache = 'veconi-v242-visual-1c-v1';
const options = {headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'};
async function version(page) {
  return page.evaluate(()=>new Promise(resolve=>{
    const channel=new MessageChannel();
    channel.port1.onmessage=e=>resolve(e.data);
    navigator.serviceWorker.controller.postMessage('GET_VERSION',[channel.port2]);
  }));
}
async function readData(page) {
  return page.evaluate(async ({scope,queueKey})=>{
    const data=await DB.businessCache.open(scope,[],()=>({}));
    const queue=DB.businessCache.keyValue.peekItem(queueKey);
    await DB.businessCache.release();
    return {data,queue,theme:localStorage.getItem('veconi-theme')};
  },{scope,queueKey});
}
async function checkCache(page) {
  const state=await page.evaluate(async cacheName=>{
    const cache=await caches.open(cacheName), html=await (await cache.match('/index.html',{ignoreSearch:true})).text();
    const paths=['js/build-info.js','js/desktop-dashboard.js','js/home-mobile.js','js/veconi-fluxo.js','css/veconi-fluxo.css'];
    const files={};
    for(const file of paths){
      const src=(html.match(new RegExp('(?:src|href)="\\./'+file.replaceAll('.','\\.')+'\\?v=242"'))||[])[0];
      if(!src)throw Error('Missing pinned reference '+file);
      const asset=await cache.match('/'+file,{ignoreSearch:true});
      if(!asset)throw Error('Missing cached asset '+file);
      const digest=await crypto.subtle.digest('SHA-256',await asset.arrayBuffer());
      files[file]=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
    }
    return {files,caches:await caches.keys(),active:window.AdiFestaBuild.appVersion,theme:document.documentElement.dataset.theme};
  },expectedCache);
  for(const [file,hash] of Object.entries(state.files)) assert.equal(hash,require('node:crypto').createHash('sha256').update(bytes(file,242)).digest('hex'),file);
  assert.equal(state.active,'242');
  const loaded=await page.evaluate(()=>({desktop:!!window.DesktopDashboard?.render,mobile:!!window.MobileHome?.render,theme:!!window.VeconiFluxo,css:[...document.styleSheets].some(s=>s.href?.endsWith('/veconi-fluxo.css?v=242')&&s.cssRules.length)}));
  assert.deepEqual(loaded,{desktop:true,mobile:true,theme:true,css:true});
  assert.equal(state.theme,'dark');
  assert.ok(state.caches.includes('veconi-v241-service-sync-v1'));
}
async function main(){
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const base='http://127.0.0.1:'+server.address().port, userDataDir=path.join(root,'qa-artifacts','audit','pwa-v242-'+Date.now());
  let browser;
  try {
    browser=await puppeteer.launch({...options,userDataDir});
    const page=await browser.newPage();
    await page.goto(base+'/qa-visual');
    await page.waitForFunction(()=>navigator.serviceWorker.controller);
    assert.equal((await version(page)).appVersion,'241');
    await page.evaluate(async ({scope,queueKey,queue,original})=>{
      await DB.businessCache.open(scope,[],()=>({}));
      DB.businessCache.stage(original,scope);
      DB.businessCache.keyValue.setItem(queueKey,queue);
      localStorage.setItem('veconi-theme','dark');
      await DB.flush();
    },{scope,queueKey,queue,original});
    release=242;
    const ready=page.waitForNavigation();
    await page.evaluate(async()=>{const reg=await navigator.serviceWorker.getRegistration();await reg.update();});
    await ready;
    await page.waitForFunction(()=>window.AdiFestaBuild?.appVersion==='242'&&navigator.serviceWorker.controller);
    assert.deepEqual(await version(page),{cache:expectedCache,release:'242',appVersion:'242'});
    await checkCache(page);
    assert.deepEqual(await readData(page),{data:original,queue,theme:'dark'});
    await browser.close();
    browser=await puppeteer.launch({...options,userDataDir});
    const reopened=await browser.newPage();
    await reopened.setOfflineMode(true);
    await reopened.goto(base+'/qa-visual');
    await reopened.waitForFunction(()=>navigator.serviceWorker.controller&&window.AdiFestaBuild?.appVersion==='242');
    assert.equal((await version(reopened)).cache,expectedCache);
    await checkCache(reopened);
    assert.deepEqual(await readData(reopened),{data:original,queue,theme:'dark'});
    console.log(JSON.stringify({old:241,new:242,cache:expectedCache,assetHashes:5,operationsPreserved:2,persistedDocuments:2,theme:'dark',offlineAfterBrowserRestart:true}));
  } finally {await browser?.close();server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
