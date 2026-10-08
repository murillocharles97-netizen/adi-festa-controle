'use strict';
// Local-only upgrade rehearsal using the actual registration/update handler and both SW versions.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const {execFileSync}=require('node:child_process'),puppeteer=require('puppeteer');
const root=process.cwd(),oldWorker=execFileSync('git',['show','c91756b2ede54eb180b914a9e5e6ea25e36b279e:service-worker.js'],{encoding:'utf8'});
const app=fs.readFileSync('js/app.js','utf8').replace(/\r\n/g,'\n'),start=app.indexOf('    navigator.serviceWorker\n'),end=app.indexOf('  let appRouterStarted',start);
assert.ok(start>0&&end>start,'Existing update handler must be found');
const handler=app.slice(start,end),newWorker=fs.readFileSync('service-worker.js','utf8');let phase='163';
const server=http.createServer((req,res)=>{
 const pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);
 res.setHeader('Cache-Control','no-store');
 if(pathname==='/'||pathname==='/index.html'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><meta charset="utf-8"><title>PWA update QA</title><script>'+handler+'</script>');}
 if(pathname==='/service-worker.js'){res.setHeader('Content-Type','text/javascript');return res.end(phase==='163'?oldWorker:newWorker);}
 const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
 res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.html':'text/html','.json':'application/json'})[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'}),page=await browser.newPage(),dialogs=[];
 page.on('dialog',async dialog=>{dialogs.push(dialog.message());await dialog.accept();});
 try{
  await page.goto('http://127.0.0.1:'+server.address().port,{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),{timeout:45000});
  await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.includes('veconi-v163-card-presentation')},{timeout:45000});
  await page.evaluate(async()=>{
   localStorage.setItem('qa-business-preserved','unchanged');await caches.open('other-project-cache');
   await new Promise((resolve,reject)=>{const request=indexedDB.open('qa-preserved-records',1);request.onupgradeneeded=()=>request.result.createObjectStore('records');request.onerror=()=>reject(request.error);request.onsuccess=()=>{const db=request.result,tx=db.transaction('records','readwrite');tx.objectStore('records').put('keep','sentinel');tx.oncomplete=()=>{db.close();resolve();};};});
  });
  phase='164';
  await page.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;await registration.update();});
  await page.waitForFunction(async()=>{const keys=await caches.keys();return keys.includes('veconi-v164-product-spreadsheet')&&!keys.includes('veconi-v163-card-presentation')},{timeout:45000});
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),{timeout:30000});
  const result=await page.evaluate(async()=>{
   const version=await new Promise(resolve=>{const channel=new MessageChannel();channel.port1.onmessage=e=>resolve(e.data);navigator.serviceWorker.controller.postMessage('GET_VERSION',[channel.port2]);});
   const dbValue=await new Promise(resolve=>{const request=indexedDB.open('qa-preserved-records',1);request.onsuccess=()=>{const db=request.result,read=db.transaction('records').objectStore('records').get('sentinel');read.onsuccess=()=>{resolve(read.result);db.close();};};});
   const cache=await caches.open('veconi-v164-product-spreadsheet');return {version,dbValue,localValue:localStorage.getItem('qa-business-preserved'),otherCache:(await caches.keys()).includes('other-project-cache'),xlsxCached:Boolean(await cache.match('./assets/xlsx-0.20.3.full.min.js')),workerCached:Boolean(await cache.match('./js/product-spreadsheet-worker.js'))};
  });
  assert.equal(result.version.release,'164');assert.equal(result.dbValue,'keep');assert.equal(result.localValue,'unchanged');assert.ok(result.otherCache&&result.xlsxCached&&result.workerCached);
  assert.deepEqual(dialogs,['Nova versão disponível. Deseja atualizar agora?']);
  await page.setOfflineMode(true);await page.reload({waitUntil:'domcontentloaded'});assert.equal(await page.title(),'PWA update QA');
  console.log(JSON.stringify({ok:true,from:'163',to:'164',updatePrompt:dialogs[0],offlineReload:true,...result}));
 }finally{await browser.close();server.close();}
}
main().catch(error=>{console.error(error);server.close();process.exitCode=1;});
