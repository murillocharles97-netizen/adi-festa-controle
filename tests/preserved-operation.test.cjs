'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const puppeteer = require('puppeteer');
test('targeted IndexedDB export is readonly, redacted and detects differing preserved copies', async () => {
  const server = http.createServer((req,res) => res.end('<html></html>'));
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  let browser;
  try {
    browser = await puppeteer.launch({headless:true});
    const page = await browser.newPage();
    await page.goto('http://127.0.0.1:' + server.address().port);
    await page.addScriptTag({content:fs.readFileSync('scripts/read-preserved-operation.cjs','utf8')});
    const result = await page.evaluate(async () => {
      const item = {operationId:'d0611a1a-cd01-4a8a-821d-0bebc8a5207c',businessId:'adi-festa',payload:{writes:[{entityType:'payments',entityId:'qa',data:{valor:100,legacyAmount:29,clienteNome:'PRIVATE',email:'PRIVATE',allocations:[{saleId:'s',amount:71}]}}]}};
      const db = await new Promise(resolve => {
        const r = indexedDB.open('veconi-local-records',1);
        r.onupgradeneeded = () => r.result.createObjectStore('records',{keyPath:'key'});
        r.onsuccess = () => resolve(r.result);
      });
      const row = {key:'qa',scope:'business-cache:v156:adiFestaDB_v1:adi-festa:qa-owner',area:'sync',field:'adiFesta:adi-festa:qa-owner:syncQueue',kind:'item',value:item};
      await new Promise(resolve => { const t=db.transaction('records','readwrite');t.objectStore('records').put(row);t.oncomplete=resolve; });
      localStorage.setItem(row.field,JSON.stringify([{...item,status:'failed'}]));
      const before = JSON.stringify(row);
      const exported = await readPreservedOperation();
      const stored = await new Promise(resolve => {const r=db.transaction('records','readonly').objectStore('records').get('qa');r.onsuccess=()=>resolve(r.result);});
      db.close();
      return {exported,unchanged:JSON.stringify(stored)===before};
    });
    assert.equal(result.unchanged,true);
    assert.equal(result.exported.matches.length,2);
    assert.equal(result.exported.conflictingCopies,true);
    assert.equal(JSON.stringify(result.exported).includes('PRIVATE'),false);
    assert.equal(result.exported.matches[0].writes[0].data.legacyAmount,29);
    assert.equal(result.exported.privateOriginals,undefined);
  } finally { await browser?.close();await new Promise(resolve=>server.close(resolve)); }
});
