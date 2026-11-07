'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const puppeteer = require('puppeteer');
test('owner and employee retain IndexedDB and queues through actual worker update, reload and reconnect', async () => {
  let version = 1;
  const server = http.createServer((req,res) => {
    res.setHeader('Cache-Control','no-store');
    if (req.url === '/sw.js') {
      res.setHeader('Content-Type','application/javascript');
      res.end(`const VERSION=${version};self.addEventListener('message',e=>{if(e.data==='SKIP_WAITING')self.skipWaiting()});self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));`);
    } else if (req.url === '/pwa.js') {
      res.setHeader('Content-Type','application/javascript');res.end(fs.readFileSync('js/pwa-update.js'));
    } else res.end('<html><script src="/pwa.js"></script><script>window.confirm=()=>true;window.DB={flush:async()=>{}};navigator.serviceWorker.addEventListener("controllerchange",()=>PwaUpdate.reload());</script></html>');
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser = await puppeteer.launch({headless:true});
  try {
    for (const role of ['owner','seller']) {
      version = 1;
      const context = await browser.createBrowserContext();
      const page = await context.newPage();
      await page.goto('http://127.0.0.1:'+server.address().port);
      await page.evaluate(async()=>{await navigator.serviceWorker.register('/sw.js');await navigator.serviceWorker.ready;});
      await page.waitForFunction(()=>navigator.serviceWorker.controller);
      await page.waitForNetworkIdle();
      const original = JSON.stringify({role,operationId:'pending-'+role,payload:{writes:[{value:100}]}});
      await page.evaluate(async raw=>{
        localStorage.setItem('synthetic-queue',raw);
        const db=await new Promise(resolve=>{const r=indexedDB.open('synthetic-operations',1);r.onupgradeneeded=()=>r.result.createObjectStore('records');r.onsuccess=()=>resolve(r.result);});
        await new Promise(resolve=>{const tx=db.transaction('records','readwrite');tx.objectStore('records').put(raw,'pending');tx.oncomplete=resolve;});db.close();
      },original);
      await page.setOfflineMode(true);
      await page.setOfflineMode(false);
      version = 2;
      await page.evaluate(async()=>{const registration=await navigator.serviceWorker.getRegistration();await registration.update();});
      await page.waitForFunction(async()=>Boolean((await navigator.serviceWorker.getRegistration()).waiting));
      await Promise.all([page.waitForNavigation(),page.evaluate(async()=>{const r=await navigator.serviceWorker.getRegistration();await PwaUpdate.offer(r.waiting);})]);
      const stored = await page.evaluate(async()=>{
        const db=await new Promise(resolve=>{const r=indexedDB.open('synthetic-operations');r.onsuccess=()=>resolve(r.result);});
        try{return {queue:localStorage.getItem('synthetic-queue'),record:await new Promise(resolve=>{const r=db.transaction('records','readonly').objectStore('records').get('pending');r.onsuccess=()=>resolve(r.result);})};}finally{db.close();}
      });
      assert.equal(stored.queue,original);assert.equal(stored.record,original);
      await context.close();
    }
  } finally { await browser.close();await new Promise(resolve=>server.close(resolve)); }
});
