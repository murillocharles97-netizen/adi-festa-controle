'use strict';
// Disposable Chromium, shipped V221 CSS, fictitious pre-existing payments only.
// Baseline scripts are pinned to published V221. No commercial Sync runs here.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),http=require('node:http'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
const root=path.resolve(__dirname,'..'),out=process.env.RECEIPT_QA_OUTPUT||path.join(root,'docs/qa/receipt-latency-v222/screenshots'),base='f9770a669d55132e1514cf47a1269c7fead5a4ff';
const extra=`<script src="../../js/activity-center.js"></script><script>
window.qaBegin=({commitAfterMs=0,latencyMs=80,amount=49,balance=0,missingLocal=false,loseFirst=false,history=false}={})=>{
  qaEffects.reads=0;qaEffects.writes=0;qaEffects.opens=0;
  const id='qa-payment',operationId='qa-operation',clientId='qa-client',start=performance.now();
  const payment={id,operationId,clienteId:clientId,businessId:'qa-receipts',workspaceGeneration:0,valor:amount,status:'pending_sync',applicationStatus:'pending',data:'2026-10-30T12:00:00Z'};
  qaData.pagamentos=missingLocal?[]:[payment];qaData.clientes=missingLocal?[]:[{id:clientId,nome:'Ana Exemplo',telefone:'11999990000',saldo:-999}];
  window.qaRun={start,commitAt:null,readyAt:null,reads:[],commercialWrites:0};let applied=commitAfterMs===0;
  const complete=()=>{applied=true;qaRun.commitAt=performance.now()-start;Object.assign(payment,{status:'applied',applicationStatus:'applied',syncConfirmedAt:new Date().toISOString()});dispatchEvent(new CustomEvent('firebase-sync-status',{detail:{status:'success'}}));};
  window.FirebaseCallable=async(name,input)=>{
    if(name!=='getOperationalSyncReceipt'||input.kind!=='payment_confirmation')throw Error('QA refuses commercial calls');
    assertIdentity(input);const index=++qaEffects.reads,wasApplied=applied,row={at:performance.now()-start};qaRun.reads.push(row);
    await new Promise(r=>setTimeout(r,latencyMs));row.returnAt=performance.now()-start;
    if(loseFirst&&index===1)throw Object.assign(Error('QA response lost'),{code:'functions/unavailable'});
    return{data:wasApplied?{confirmed:true,status:'confirmed',businessId:'qa-receipts',workspaceGeneration:0,paymentId:id,operationId,clientId,spaceId:'qa-space',amount,balance,financialVersion:3,checkedAt:new Date().toISOString(),paymentDate:payment.data,paymentMethod:'pix',clientName:'Ana Exemplo',businessName:'Loja Aurora • QA',phone:'11999990000',templates:[]}:{confirmed:false,status:'awaiting_confirmation'}};
  };
  function assertIdentity(d){if(d.paymentId!==id||d.operationId!==operationId||d.clientId!==clientId||d.businessId!=='qa-receipts'||d.workspaceGeneration!==0)throw Error('QA identity mismatch');}
  const observer=new MutationObserver(()=>{if(document.querySelector('#receipt-message-title')?.textContent==='Pagamento recebido'&&qaRun.readyAt===null){qaRun.readyAt=performance.now()-start;observer.disconnect();}});observer.observe(document.getElementById('modal'),{childList:true,subtree:true});
  if(commitAfterMs>0)setTimeout(complete,commitAfterMs);else qaRun.commitAt=0;
  if(history){
    const event={id:'payment:'+id,eventId:'payment:'+id,entityId:id,operationId,type:'payment',status:'confirmed',businessId:'qa-receipts',spaceId:'qa-space',workspaceGeneration:0,createdAt:payment.data,summary:{customerId:clientId,customerName:'Ana Exemplo',amount,paymentMethod:'pix'}};
    window.SyncFirebase={subscribeRecentActivityEvents:callback=>{setTimeout(()=>callback([event],{},{}),0);return()=>{};},pendingActivityEvents:()=>[]};
    document.getElementById('app').innerHTML=ActivityCenter.render();ActivityCenter.bind();
  }else ReceiptMessageUI.open(payment,{id:clientId});
};
</script>`;
async function main(){
 fs.mkdirSync(out,{recursive:true});const errors=[],blocked=[],results=[],timings=[];let browser;
 const snapshots=new Map(['receipt-messages.js','receipt-message-ui.js'].map(name=>[name,cp.execFileSync('git',['show',base+':js/'+name],{cwd:root})]));
 const server=http.createServer((req,res)=>{const url=new URL(req.url,'http://qa.local'),rel=url.pathname;let content,type='text/javascript; charset=utf-8';
  if(rel==='/'){let html=fs.readFileSync(path.join(root,'tests/fixtures/receipt-confirmation-v221.html'),'utf8').replace('Prévia funcional V221','Prévia funcional V222').replace('</body>',extra+'</body>');if(url.searchParams.has('baseline'))html=html.replace(/(src="\.\.\/\.\.\/js\/receipt-(?:messages|message-ui)\.js)(")/g,'$1?baseline=221$2');content=html;type='text/html; charset=utf-8';}
  else {const file=path.resolve(root,'.'+rel);if(!file.startsWith(root+path.sep)||!/^\/(?:js|css|assets)\//.test(rel)||!fs.existsSync(file)){res.writeHead(404).end();return;}content=url.searchParams.has('baseline')?snapshots.get(path.basename(rel)):fs.readFileSync(file);type=({'.js':type,'.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream';}
  res.writeHead(200,{'Content-Type':type}).end(content);
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 try{
  browser=await puppeteer.launch({headless:true});const page=await browser.newPage();await page.setRequestInterception(true);page.on('request',r=>{if(new URL(r.url()).origin===origin&&r.method()==='GET')return r.continue();blocked.push(r.method()+' '+new URL(r.url()).host);r.abort();});page.on('pageerror',e=>errors.push(e.message));
  const visit=async(baseline=false,width=390,height=844)=>{await page.setViewport({width,height,deviceScaleFactor:1,isMobile:width<768,hasTouch:width<768});await page.goto(origin+(baseline?'/?baseline=221':'/'),{waitUntil:'networkidle0'});};
  const ready=()=>page.waitForFunction(()=>document.querySelector('#receipt-message-title')?.textContent==='Pagamento recebido',{timeout:15000});
  const settle=()=>page.evaluate(async()=>Promise.all(document.querySelector('#modal').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));
  for(const commitAfterMs of [250,1500,3600])for(const baseline of [true,false]){
   await visit(baseline);await page.evaluate(args=>qaBegin(args),{commitAfterMs});await ready();const timing=await page.evaluate(()=>({...qaRun,delayAfterCommit:qaRun.readyAt-qaRun.commitAt,queries:qaEffects.reads,writes:qaEffects.writes}));assert.equal(timing.writes,0);assert.ok(timing.queries<=4);if(!baseline)assert.ok(timing.delayAfterCommit<500);timings.push({version:baseline?221:222,commitAfterMs,...timing});
  }
  results.push({scenario:'three-paired-V221-V222-timings',passed:true});
  for(const width of [320,360,390,430,412,768,1366]){
   await visit(false,width,width===320?568:844);await page.evaluate(()=>qaBegin());await ready();await settle();
   const layout=await page.evaluate(()=>{const b=document.querySelector('.receipt-primary-action'),r=b.getBoundingClientRect(),f=b.closest('footer').getBoundingClientRect();return{visible:r.top>=0&&r.bottom<=innerHeight+1,wide:r.width>=f.width-42,overflow:document.documentElement.scrollWidth>innerWidth+1};});assert.equal(layout.visible,true);assert.equal(layout.wide,true);assert.equal(layout.overflow,false);if([390,1366].includes(width))await page.screenshot({path:path.join(out,'confirmed-'+width+'.png')});results.push({scenario:'approved-layout-preserved-'+width,passed:true});
  }
  await visit();await page.evaluate(()=>qaBegin({history:true,missingLocal:true}));await page.waitForSelector('[data-activity-id]');await page.click('[data-activity-id]');await page.waitForSelector('[data-history-payment-receipt]');await settle();await page.screenshot({path:path.join(out,'history-receipt-entry-390.png')});await page.click('[data-history-payment-receipt]');await ready();assert.equal(await page.evaluate(()=>qaData.pagamentos.length),0);assert.equal(await page.evaluate(()=>qaData.clientes.length),0);await page.click('#download-payment');await page.waitForFunction(()=>document.querySelector('[data-receipt-feedback]')?.textContent.includes('preparado para download'));assert.equal(await page.evaluate(()=>qaEffects.writes),0);await page.click('[data-receipt-done]');await page.waitForSelector('[data-history-payment-receipt]');results.push({scenario:'canonical-History-no-local-copy-download-and-return',passed:true});
  await visit();await page.evaluate(()=>qaBegin({amount:250,balance:-247}));await ready();await settle();assert.match(await page.$eval('[data-receipt-preview]',e=>e.textContent),/250,00[\s\S]*247,00/);await page.screenshot({path:path.join(out,'partial-250-390.png')});results.push({scenario:'partial-250-canonical-balance-247',passed:true});
  await visit();await page.evaluate(()=>qaBegin({commitAfterMs:1300,loseFirst:true}));await ready();assert.equal(await page.evaluate(()=>qaEffects.writes),0);results.push({scenario:'lost-read-response-and-original-Sync-commit',passed:true});
  await visit();await page.evaluate(()=>qaBegin({commitAfterMs:7000}));await page.waitForFunction(()=>qaEffects.reads===4);await ready();assert.equal(await page.evaluate(()=>qaEffects.reads),5);assert.equal(await page.evaluate(()=>qaEffects.writes),0);results.push({scenario:'late-confirmation-after-initial-window-without-second-payment',passed:true});
  await visit();await page.evaluate(()=>qaBegin({commitAfterMs:7000,latencyMs:600}));await page.waitForSelector('[data-receipt-done]');assert.equal(await page.$eval('[data-receipt-done]',e=>e.disabled),false);await page.click('[data-receipt-done]');await page.waitForFunction(()=>document.querySelector('#modal').textContent==='');assert.equal(await page.evaluate(()=>qaEffects.writes),0);results.push({scenario:'slow-network-navigation-not-blocked',passed:true});
  assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);const report={at:new Date().toISOString(),passed:results.length,results,timings,errors,externalRequests:0,commercialWrites:0,physicalAndroid:false};fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,timings:timings.map(t=>({version:t.version,commitAfterMs:t.commitAfterMs,readyMs:Math.round(t.readyAt),delayAfterCommitMs:Math.round(t.delayAfterCommit),queries:t.queries}))}));
 }finally{if(browser)await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(e=>{console.error(JSON.stringify({failed:true,error:e.message,commercialWrites:0}));process.exitCode=1;});
