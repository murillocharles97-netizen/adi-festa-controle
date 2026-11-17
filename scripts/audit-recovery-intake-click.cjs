'use strict';
// Isolated HTTP/browser + production evidence service against a loopback demo Emulator.
// No commercial callable is exposed. Originals contain only synthetic data.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),http=require('node:http'),assert=require('node:assert/strict'),cp=require('node:child_process');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Firestore Emulator required');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,FieldValue}=require('firebase-admin/firestore');
const submitSource=process.env.ACTIVE_SUBMIT_SERVICE||require.resolve('../functions/src/services/sale-recovery-service');
const listSource=process.env.ACTIVE_LIST_SERVICE||submitSource;
const f=require('../tests/helpers/customer-recovery-v205.cjs');
const puppeteer=require(process.env.PUPPETEER_MODULE||path.join(os.tmpdir(),'veconi-fiado-mensagens-v2/node_modules/puppeteer-core'));
const root=path.resolve(__dirname,'..'),out=process.env.QA_ARTIFACT_DIR||path.join(os.tmpdir(),'veconi-recovery-intake-click');fs.mkdirSync(out,{recursive:true});
const baseline=cp.execFileSync('git',['show','31d0ccb:js/sale-recovery-ui.js'],{cwd:root,encoding:'utf8'});
const targets=[['f133be0f-a79c-4637-85bb-2c9309359535','26945d55-ee16-406f-b8bf-72c1f36601a5'],['20276356-f0ee-4510-8105-1e81d05af7b9','7345fdcd-a474-43f8-94b9-517c84079edc']];
const samples=targets.map(([operationId,saleId],n)=>JSON.parse(JSON.stringify(f.sample(n)).replaceAll('retained-operation-'+n,operationId).replaceAll('retained-sale-'+n,saleId)));
for(const sample of samples)Object.assign(sample.original.packet,{reviewState:'manual_review',replayBlocked:true,lastErrorMessage:'Alias de estoque divergente.'});
const sources=[{packets:samples.flatMap(s=>[s.original.packet,s.packet]),local:{vendas:samples.map(s=>s.original.localSale),movimentacoesEstoque:samples.flatMap(s=>s.original.localMovements)}}];
const boot=`
const sources=${JSON.stringify(sources)},ctx={uid:'${f.seller}',role:'seller',businessId:'${f.bid}',business:{active:true,workspaceGeneration:0},member:{status:'active'},userProfile:{uid:'${f.seller}',active:true}};
window.BusinessContext={get:()=>ctx};window.FirebaseSession={user:{uid:ctx.uid}};window.FirebaseBootstrap={state:'authorized'};window.SpaceContext={homeId:()=> '${f.spaceId}'};
window.qaCalls=[];window.qaSources=()=>JSON.stringify(sources);window.qaSnapshot=JSON.stringify(sources);window.qaProgress=[];window.qaFailure='';
window.DB={businessCache:{recoverySources:async()=>{if(window.qaFailure==='local')throw Error('Falha sintética de leitura local');return sources;}}};
window.FirebaseCallable=async(name,data)=>{qaCalls.push(name);const r=await fetch('/qa/call',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data})}),result=await r.json();if(result.error)throw Object.assign(Error(result.error.message),{code:result.error.code});return result;};
new MutationObserver(()=>{const s=document.querySelector('[data-recovery-result]')?.textContent;if(s&&!qaProgress.includes(s))qaProgress.push(s);}).observe(document.body,{childList:true,subtree:true});
`;
const css=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<link\b[^>]*rel="stylesheet"[^>]*>/g)].map(m=>m[0]).filter(s=>/href="\.\//.test(s)).join('\n');
const app=initializeApp({projectId:'demo-veconi-intake-click'},'intake-click'),db=getFirestore(app),submitService=require(submitSource).saleRecoveryService(db,{FieldValue}),listService=require(listSource).saleRecoveryService(db,{FieldValue});
const calls=[],report={synthetic:true,project:'demo-veconi-intake-click',backendHashes:[submitSource,listSource].map(file=>require('node:crypto').createHash('sha256').update(fs.readFileSync(file)).digest('hex')),viewports:[],regressions:[],remote:[]};let browser,server;
const commercial=['sales','stockMovements','processedOperations','payments','saleFinancials','balanceEvents','customerSubscriptions','subscriptionEvents','cashMovements','clients'];
async function main(){
 const business=db.doc('businesses/'+f.bid);
 await business.set({active:true,ownerId:f.owner,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}});
 await db.doc('users/'+f.seller).set({uid:f.seller,active:true});await business.collection('members').doc(f.seller).set({uid:f.seller,status:'active',role:'seller',spaceAccess:'selected',allowedSpaceIds:[f.spaceId],permissions:{'sales.create':true,'customers.view':true}});
 await db.doc('financialSpaces/'+f.spaceId).set({active:true,businessId:f.bid,linkedBusinessId:f.bid,ownerUid:f.owner,name:'Espaço fictício'});
 const product=business.collection('products').doc('shared-product');await product.set({estoqueAtual:4,estoque:4,totalStock:6,businessId:f.bid});const before=(await product.get()).data();
 for(const [op,sale]of targets){assert.equal((await business.collection('saleRecoveryOperations').doc(op).get()).exists,false);assert.equal((await business.collection('saleRecoveryReviews').doc(sale).get()).exists,false);}
 const allowed=new Map([['submitSaleRecovery',r=>submitService.submit(r)],['listSaleRecoveryReviews',r=>listService.list(r)]]);
 server=http.createServer(async(req,res)=>{
  try{
   const url=new URL(req.url,'http://127.0.0.1');
   if(url.pathname==='/qa/call'){
    assert.equal(req.method,'POST');let text='';for await(const b of req){text+=b;if(text.length>1024*1024)throw Error('QA payload too large');}const {name,data}=JSON.parse(text);assert.ok(allowed.has(name),'Commercial endpoints forbidden');calls.push(name);
    try{const result=await allowed.get(name)({auth:{uid:f.seller,token:{}},data});res.setHeader('Content-Type','application/json');res.end(JSON.stringify({data:result}));}catch(e){res.statusCode=400;res.end(JSON.stringify({error:{code:e.code,message:e.message}}));}return;
   }
   if(url.pathname==='/qa-worker.js'){res.setHeader('Content-Type','text/javascript');res.end("self.addEventListener('install',()=>self.skipWaiting());self.addEventListener('activate',e=>e.waitUntil(self.clients.claim()));");return;}
   if(url.pathname==='/qa/manifest.json'){res.setHeader('Content-Type','application/manifest+json');res.end(JSON.stringify({name:'VECONI QA fictícia',start_url:'/',display:'standalone',icons:[]}));return;}
   if(url.pathname==='/'){
    res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="manifest" href="/qa/manifest.json">'+css+'</head><body><main><div id="app"><h1>Vendedor QA — dados fictícios</h1></div></main><div id="modal"></div><script>'+boot+'</script><script src="/js/sale-recovery-client.js"></script><script type="module" src="/js/sale-recovery-ui.js'+(url.searchParams.has('baseline')?'?baseline':'')+'"></script><script>navigator.serviceWorker.register("/qa-worker.js")</script></body></html>');return;
   }
   if(url.pathname==='/js/sale-recovery-ui.js'){
    const code=url.searchParams.has('baseline')?baseline:fs.readFileSync(path.join(root,url.pathname),'utf8');res.setHeader('Content-Type','text/javascript');res.end(code+'\nwindow.qaRecovery={mount,change(){message="Conferência atualizada";mount();}};');return;
   }
   const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)){res.statusCode=404;res.end();return;}
   res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'text/javascript':'application/octet-stream');res.end(fs.readFileSync(file));
  }catch(e){res.statusCode=500;res.end(JSON.stringify({error:{message:e.message}}));}
 });await new Promise(r=>server.listen(0,'127.0.0.1',r));const base='http://127.0.0.1:'+server.address().port;
 browser=await puppeteer.launch({executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--no-first-run','--disable-background-networking']});
 for(const width of [390,1366]){
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setViewport({width,height:width===390?844:900,isMobile:width===390,hasTouch:width===390});
  await page.setRequestInterception(true);page.on('request',req=>new URL(req.url()).hostname==='127.0.0.1'||req.url().startsWith('data:')?req.continue():req.abort());
  // A genuine pointer sequence: background render between press/release.
  for(const old of [true,false]){
   await page.goto(base+(old?'/?baseline':'/'));await page.waitForSelector('[data-send-recovery]');await page.waitForFunction(()=>Boolean(window.qaRecovery));
   const box=await (await page.$('[data-send-recovery]')).boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.evaluate(()=>qaRecovery.change());await page.mouse.up();
   await new Promise(r=>setTimeout(r,75));const opened=Boolean(await page.$('[data-recovery-confirm]'));assert.equal(opened,!old);report.regressions.push({width,baseline:old,confirmationOpened:opened});
  }
  await page.screenshot({path:path.join(out,'confirmation-'+width+'.png'),fullPage:true});
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller));
  // Stable V236 reload, session stays seller, two originals stay local.
  await page.reload();await page.waitForSelector('[data-send-recovery]');assert.match(await page.$eval('[data-send-recovery]',e=>e.textContent),/Complementar/);
  if(width===390){await page.tap('[data-send-recovery]');await page.tap('[data-recovery-confirm]');}else{await page.click('[data-send-recovery]');await page.click('[data-recovery-confirm]');}
  await page.waitForFunction(()=>!document.querySelector('[data-recovery-confirm]')&&document.querySelector('[data-recovery-result]')?.textContent.includes('Conferência remota concluída'),{timeout:20000});
  const result=await page.evaluate(()=>({result:document.querySelector('[data-recovery-result]').textContent,unchanged:qaSources()===qaSnapshot,calls:qaCalls,progress:qaProgress,worker:Boolean(navigator.serviceWorker.controller)}));assert.equal(result.unchanged,true);assert.equal(result.worker,true);assert.deepEqual(result.calls,['submitSaleRecovery','submitSaleRecovery','listSaleRecoveryReviews']);assert.ok(result.progress.some(s=>s.includes('1 de 2')));assert.ok(result.progress.some(s=>s.includes('2 de 2')));
  await page.screenshot({path:path.join(out,'received-'+width+'.png'),fullPage:true});assert.deepEqual(errors,[]);report.viewports.push({width,...result,errors});
  // Read status after reload, no repeat submission and no commercial replay.
  await page.reload();await page.waitForSelector('[data-view-recovery]');await page.click('[data-view-recovery]');await page.waitForFunction(()=>document.querySelectorAll('[data-recovery-list] article').length===2);
  assert.deepEqual(await page.evaluate(()=>qaCalls),['listSaleRecoveryReviews']);await page.close();
 }
 for(const [operationId,saleId]of targets){const raw=(await business.collection('saleRecoveryReviews').doc(saleId).collection('original').doc('payload').get()).data(),original=JSON.parse(raw.originalJson),op=(await business.collection('saleRecoveryOperations').doc(operationId).get()).data();assert.equal(original.packet.operationId,operationId);assert.equal(op.saleId,saleId);assert.equal(require('node:crypto').createHash('sha256').update(raw.originalJson).digest('hex'),raw.contentHash);report.remote.push({saleId,operationId,hash:raw.contentHash});}
 for(const name of commercial)assert.equal((await business.collection(name).get()).size,0,name+' must remain untouched');assert.deepEqual((await product.get()).data(),before);report.commercialWrites=0;report.localOriginalsUnchanged=true;report.calls=calls;
 fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({ok:true,viewports:report.viewports.map(x=>x.width),remoteIds:report.remote.map(x=>x.operationId),commercialWrites:0,report:path.join(out,'report.json')}));
}
main().catch(e=>{console.error(e.stack);process.exitCode=1;}).finally(async()=>{await browser?.close();await new Promise(r=>server?server.close(r):r());await deleteApp(app);});
