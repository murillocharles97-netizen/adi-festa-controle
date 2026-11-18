'use strict';
// HTTP + real transactional services + original queue runner; synthetic loopback tenant ONLY.
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Emulator required; never production');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore,FieldValue,Timestamp}=require('firebase-admin/firestore');
const functionSource=process.env.VECONI_TEST_FUNCTION_SOURCE||path.resolve(__dirname,'../functions'),performanceSource=process.env.VECONI_TEST_PERFORMANCE_SOURCE||path.resolve(__dirname,'../functions');
const {operationalCommitService}=require(path.resolve(functionSource,'src/services/operational-commit-service'));
const {performanceReadService}=require(path.resolve(performanceSource,'src/services/performance-read-service'));
const {financialIncomeService}=require('../functions/src/services/financial-income-service');
const {activityEventService}=require('../functions/src/services/activity-event-service');
const {queueRuntime}=require('../tests/helpers/sync-queue-runtime.cjs');
const {section}=require('../tests/helpers/fiado-cancellation-harness.cjs');
const fixture=require('./audit-flexible-services-v238.cjs');
const puppeteer=require(process.env.PUPPETEER_CORE_PATH||'C:/Users/Murillo/AppData/Local/Temp/veconi-fiado-mensagens-v2/node_modules/puppeteer-core');
const root=path.resolve(__dirname,'..'),out=path.join(root,'qa-artifacts','v238-homologation');fs.mkdirSync(out,{recursive:true});
const projectId='demo-veconi-v238-homologation',app=initializeApp({projectId},'v238-http'),db=getFirestore(app),gateway=operationalCommitService(db),income=financialIncomeService(db),performance=performanceReadService(db),activity=activityEventService(db,{FieldValue,Timestamp});
// Compatibility proof against the published V237 Git reference; no live deployment is read or changed.
function referenceModule(name){const Module=require('node:module'),filename=path.join(root,'functions/src/services',name),m=new Module(filename,module);m.filename=filename;m.paths=Module._nodeModulePaths(path.dirname(filename));const source=require('node:child_process').execFileSync('git',['show','c94f60a:functions/src/services/'+name],{cwd:root,encoding:'utf8'});m._compile(source,filename);return m.exports;}
const referenceReceipt=referenceModule('operational-commit-service.js').operationalCommitService(db),referenceCosts=referenceModule('sale-cost-service.js').saleCostService(db,{FieldValue});
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const readBody=req=>new Promise((resolve,reject)=>{let text='';req.on('data',x=>{text+=x;if(text.length>2000000)reject(Error('QA packet too large'));});req.on('end',()=>{try{resolve(JSON.parse(text||'{}'));}catch(e){reject(e);}});});
async function caseServer(width,{catalog=false}={}){
 const suffix=crypto.randomUUID().slice(0,8),bid=`qa-v238-http-${width}-${suffix}`,uid=`qa-owner-${suffix}`,space=`qa-space-${suffix}`,token=crypto.randomUUID(),business=db.doc('businesses/'+bid);
 await business.set({businessId:bid,ownerId:uid,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
 await db.doc('users/'+uid).set({uid,businessId:bid,active:true,role:'owner'});
 await business.collection('members').doc(uid).set({uid,role:'owner',status:'active',spaceAccess:'all',permissionsVersion:3});
 const qaSpace={id:space,name:catalog?'Táxi':'Corridas QA',businessId:bid,linkedBusinessId:catalog?null:bid,ownerUid:uid,type:catalog?'other':'business',active:true,automation:{enabled:true,activatedAt:'2026-01-01T00:00:00Z'},capabilities:{sales:true,products:!catalog,inventory:!catalog,finance:true}};
 await db.doc('financialSpaces/'+space).set(qaSpace);
 await business.collection('products').doc('physical-sentinel').set({id:'physical-sentinel',businessId:bid,nome:'Produto físico de controle QA',preco:5,estoqueAtual:5,estoque:5,totalStock:5,ativo:true,spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space});
 let lostResponse=false;const requests=[],drains=[],payloads=new Map();
 const snapshot=async()=>{
  const [sales,financial,markers,movements,entries,sentinel]=await Promise.all(['sales','saleFinancials','processedOperations','stockMovements'].map(n=>business.collection(n).get()).concat([db.collection(`financialSpaces/${space}/entries`).get(),business.collection('products').doc('physical-sentinel').get()]));
  const products=catalog?await business.collection('products').get():null,configs=catalog?await business.collection('productFinancials').get():null;
  return{sales:sales.docs.map(d=>({id:d.id,...d.data()})),financial:financial.docs.map(d=>({id:d.id,...d.data()})),markers:markers.docs.map(d=>({id:d.id,...d.data()})),movements:movements.size,entries:entries.docs.map(d=>({id:d.id,...d.data()})),sentinel:sentinel.data(),requests,drains,...(catalog?{products:products.docs.map(d=>({id:d.id,...d.data()})),configs:configs.docs.map(d=>({id:d.id,...d.data()}))}:{})};
 };
 const diff=section('function changedFields(','function captureChanges(');
 const adapter=String.raw`
const SOURCES={clients:{key:'clientes'},products:{key:'produtos'},productVariants:{key:'variacoesProdutos'},sales:{key:'vendas'},stockMovements:{key:'movimentacoesEstoque'},payments:{key:'pagamentos'}};
const currentUser=FirebaseSession.user,auth={currentUser};
const activeBusinessId=()=>DB.getBusinessId(),sourceItems=(d,n)=>d[SOURCES[n].key]||[];
${diff}
window.qaTapCount=0;document.addEventListener('pointerdown',()=>qaTapCount++,true);
let queue=[],evidence=[],confirmed=[],draining=null;
const persist=()=>{const data=structuredClone(state),q=structuredClone(queue),e=structuredClone(evidence),c=structuredClone(confirmed);pending=new Promise((resolve,reject)=>{const t=qaIdb.transaction('state','readwrite'),s=t.objectStore('state');s.put(data,'data');s.put(q,'queue');s.put(e,'evidence');s.put(c,'confirmed');t.oncomplete=resolve;t.onerror=()=>reject(t.error);});return pending;};
const api=async(name,data={})=>{const r=await fetch('/qa-api/'+name,{method:'POST',headers:{'Content-Type':'application/json','X-QA-Token':${JSON.stringify(token)}},body:JSON.stringify(data)});const value=await r.json();if(!r.ok)throw Object.assign(Error(value.message),{code:value.code});return value;};
const makePacket=(before,next,sale)=>{const writes=diffWrites(before,next);if(!writes.length)return;const operationId=sale?.operationId||crypto.randomUUID(),item={queueId:crypto.randomUUID(),operationId,businessId:${JSON.stringify(bid)},userId:${JSON.stringify(uid)},workspaceGeneration:0,syncProtocolVersion:1,payloadVersion:4,status:'pending',createdAt:new Date().toISOString(),payload:{eventKind:sale?'sale':'simple',writes}};queue.push(item);evidence.push(structuredClone(item));};
window.qaAutoDrain=true;
const publish=(before,next,sale)=>{makePacket(before,next,sale);state=next;persist();if(navigator.onLine&&qaAutoDrain)setTimeout(()=>qaDrain().catch(e=>qaErrors.push(e.message)),60);};
DB.alterar=fn=>{const before=structuredClone(state),next=structuredClone(state);fn(next);publish(before,next);};
SyncFirebase.createSaleOperation=(before,next,sale)=>publish(before,next,sale);
SyncFirebase.isSalePending=s=>!confirmed.includes(s.operationId);
SyncFirebase.inspectCheckoutSaleAttempt=attempt=>{const sale=state.vendas.find(s=>s.operationId===attempt.operationId);return sale?{sale,status:confirmed.includes(sale.operationId)?'confirmed':'pending'}:null;};
window.qaDrain=async()=>{if(!navigator.onLine)return;if(draining)return draining;draining=(async()=>{await DB.flush();if(!queue.length)return;const batch=queue.slice(),ids=new Set(batch.map(x=>x.operationId));dispatchEvent(new Event('firebase-sync-status'));const response=await api('drain',{queue:batch});queue=[...queue.filter(x=>!ids.has(x.operationId)),...response.queue];confirmed=[...new Set([...confirmed,...response.confirmed])];await persist();dispatchEvent(new Event('firebase-sync-status'));})().finally(()=>{draining=null;});return draining;};
addEventListener('online',()=>qaDrain().catch(e=>qaErrors.push(e.message)));
window.FirebaseCallable=async(name,input)=>{if(name!=='getPerformancePage')throw Error('QA callable not allowed');return{data:await api('performance',input)};};
BusinessContext.get=()=>({businessId:${JSON.stringify(bid)},role:'owner',spaceAccess:'all',business:{ownerId:${JSON.stringify(uid)},active:true,workspaceGeneration:0,timezone:'America/Sao_Paulo'},permissionSignature:'qa-owner'});
TeamAccess.current=()=>({role:'owner'});DB.isHydrated=()=>true;
${catalog?`SpaceContext.setSpaces([${JSON.stringify(qaSpace)}]);SpaceContext.selectActive(${JSON.stringify(space)});`:`SpaceContext.contextualData=d=>d;SpaceContext.list=()=>[{id:${JSON.stringify(space)},name:'Corridas QA',businessId:${JSON.stringify(bid)}}];`}
let qaRoute='vender';Router.atual=()=>qaRoute;Router.ir=route=>qaShow(route==='inicio'?'vender':route);
window.qaShow=route=>{qaRoute=route;Modais.fechar();const host=document.querySelector('#app');if(route==='produtos'){host.innerHTML=ProdutosMobile.render();ProdutosMobile.bind();}else if(route==='historico'){host.innerHTML=ActivityCenter.render();ActivityCenter.bind();}else if(route==='desempenho'){host.innerHTML=PerformanceDashboard.render();PerformanceDashboard.bind();}else{qaRoute='vender';host.innerHTML=Checkout.view();Checkout.bind();if(DesktopSales.isDesktop())DesktopSales.bind();else CheckoutMobile.enhance();}lucide.createIcons();};
SyncFirebase.subscribeRecentActivityEvents=(callback,onError)=>{let stopped=false;api('activities').then(items=>{if(!stopped)callback(items,{}, {hasMore:false});}).catch(onError);return()=>{stopped=true;};};
window.FirestoreRepositories={sales:{getSaleStatusFromServer:id=>api('sale',{id})},products:{getProductStatusFromServer:id=>api('product-status',{id})}};
SyncFirebase.getQueueDiagnostics=()=>queue.map(q=>({businessId:q.businessId,originalStatus:q.status,category:q.status==='error'?'manual_review':'pending',errorMessage:q.lastErrorMessage,paths:q.payload.writes.map(w=>'businesses/'+q.businessId+'/'+w.entityType+'/'+w.entityId)}));
window.qaSnapshot=()=>api('snapshot');window.qaOriginals=()=>structuredClone(evidence);
qaReady.then(async()=>{const get=key=>new Promise(resolve=>{const r=qaIdb.transaction('state').objectStore('state').get(key);r.onsuccess=()=>resolve(r.result||[]);});[queue,evidence,confirmed]=await Promise.all(['queue','evidence','confirmed'].map(get));document.querySelector('#qa-history').onclick=()=>qaShow('historico');document.querySelector('#qa-performance').onclick=()=>qaShow('desempenho');document.querySelector('#qa-selling').onclick=()=>qaShow('vender');qaShow('vender');if(navigator.onLine){await qaDrain();if('serviceWorker'in navigator){await navigator.serviceWorker.register('/qa-worker.js');await navigator.serviceWorker.ready;if(!navigator.serviceWorker.controller)await new Promise(resolve=>navigator.serviceWorker.addEventListener('controllerchange',resolve,{once:true}));const resources=['/',...Array.from(document.querySelectorAll('script[src],link[rel="stylesheet"]'),e=>e.src||e.href)];await Promise.all(resources.map(url=>fetch(url).catch(()=>{})));}}window.qaHomologReady=true;});
`;
 let html=fixture.html.replaceAll("'qa-business'",JSON.stringify(bid)).replaceAll("'qa-owner'",JSON.stringify(uid)).replaceAll("'qa-space'",JSON.stringify(space));
 html=html.replace(/const initial=\(\)=>\([\s\S]*?\);\nlet state=initial\(\)/,"const initial=()=>({config:{nome:'Corridas QA'},clientes:[],produtos:[],variacoesProdutos:[],vendas:[],pagamentos:[],movimentacoes:[],movimentacoesEstoque:[]});\nlet state=initial()");
 html=html.replace('</header><p id="qa-status"','</header><nav class="qa-nav"><button id="qa-selling" class="btn btn-light">Vender</button><button id="qa-history" class="btn btn-light">Histórico</button><button id="qa-performance" class="btn btn-light">Desempenho</button></nav><p id="qa-status"');
 const extra=[...(catalog?['js/spaces.js','js/produtos-mobile.js']:[]),'js/recibos.js','js/activity-center.js','js/performance-model.js','js/performance-dashboard.js'].map(x=>`<script src="/${x}"></script>`).join('');
 html=html.replace('<script>qaReady.then(()=>{',extra+`<script>${adapter}</script><script>qaReady.then(()=>{`);
 const worker=`self.addEventListener('install',e=>{self.skipWaiting();});self.addEventListener('activate',e=>e.waitUntil(clients.claim()));self.addEventListener('fetch',e=>{if(e.request.method!=='GET'||new URL(e.request.url).pathname.startsWith('/qa-api/'))return;e.respondWith(fetch(e.request).then(async r=>{if(r.ok)(await caches.open('qa-v238')).put(e.request,r.clone());return r;}).catch(async()=>{const cached=await caches.match(e.request);if(cached)return cached;throw Error('Offline QA cache miss');}));});`;
 const server=http.createServer(async(req,res)=>{try{
  if(req.url==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}
  if(req.url==='/qa-worker.js'){res.setHeader('Content-Type','application/javascript');return res.end(worker);}
  if(req.url.startsWith('/qa-api/')){
   if(req.method!=='POST'||req.headers['x-qa-token']!==token){res.statusCode=403;return res.end('{}');}
   const data=await readBody(req);let result;
   if(req.url==='/qa-api/drain'){
    assert.ok(Array.isArray(data.queue));for(const q of data.queue){assert.equal(q.businessId,bid);assert.equal(q.userId,uid);const digest=hash(q.payload);if(payloads.has(q.operationId))assert.equal(payloads.get(q.operationId),digest);payloads.set(q.operationId,digest);}
    const stores=new Map([[uid+':'+bid,JSON.stringify(data.queue)]]),runtime=queueRuntime(stores,{uid,businessId:bid,server:async(name,input)=>{
     requests.push({name,operationId:input.operationId||input.item?.operationId});
     if(name==='getOperationalSyncReceipt')return{data:await referenceReceipt.receipt({auth:{uid},data:input})};
     assert.equal(name,'commitOperationalSync');const outcome=await gateway.commit({auth:{uid},data:input});
     for(const w of input.item.payload.writes.filter(w=>w.entityType==='sales'&&w.operation==='create')){const after=await business.collection('sales').doc(w.entityId).get(),sale=after.data();await income.projectSale(bid,w.entityId,sale);const projected=await referenceCosts.project(bid,w.entityId,sale);assert.equal(projected.skipped,'financial-snapshot-exists');await activity.project({businessId:bid,sourceCollection:'sales',sourceDocumentId:w.entityId,after});}
     if(!lostResponse&&input.item.payload.eventKind==='sale'){lostResponse=true;throw Object.assign(Error('QA response lost AFTER commit'),{code:'functions/unavailable'});}
     return{data:outcome};
    }});
    await runtime.run();for(let i=0;i<12&&runtime.queue().some(q=>['pending','error'].includes(q.status))&&runtime.timers.size;i++)await runtime.advance();
    result={queue:runtime.queue(),confirmed:runtime.marked};drains.push({received:data.queue.length,remaining:result.queue.length,confirmed:result.confirmed.length,errors:runtime.errors});
   }else if(req.url==='/qa-api/performance'){assert.equal(data.businessId,bid);result=await performance.page({auth:{uid},data});}
   else if(req.url==='/qa-api/activities'){const rows=await business.collection('activityEvents').get();result=rows.docs.map(d=>({...d.data(),createdAt:d.data().createdAt.toDate().toISOString(),updatedAt:d.data().updatedAt.toDate().toISOString(),sourceUpdatedAt:d.data().sourceUpdatedAt.toDate().toISOString()}));}
   else if(req.url==='/qa-api/sale'){assert.ok(/^[a-z0-9-]{36}$/.test(data.id));result={id:data.id,...(await business.collection('sales').doc(data.id).get()).data()};}
   else if(req.url==='/qa-api/product-status'){assert.ok(/^[a-z0-9-]{36}$/.test(data.id));const doc=await business.collection('products').doc(data.id).get(),value=doc.data();result=doc.exists?Object.fromEntries(['businessId','workspaceGeneration','nome','itemKind','productType','preco','atualizadoEm','spaceAccessMode','allowedSpaceIds','defaultSpaceId','serviceConfig','ativo','active'].filter(k=>k in value).map(k=>[k,value[k]])):null;}
   else if(req.url==='/qa-api/snapshot')result=await snapshot();
   else{res.statusCode=404;return res.end('{}');}
   res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));
  }
  const rel=decodeURIComponent(req.url.split('?')[0]).replace(/^\//,''),file=path.resolve(root,rel);
  if(rel.includes('..')||rel.includes('\\')||!file.startsWith(root+path.sep)||!(/^(js\/|css\/|assets\/|functions\/src\/shared\/)/.test(rel))||!fs.existsSync(file)){res.statusCode=404;return res.end();}
  res.setHeader('Content-Type',file.endsWith('.css')?'text/css':file.endsWith('.js')?'application/javascript':file.endsWith('.woff2')?'font/woff2':'application/octet-stream');fs.createReadStream(file).pipe(res);
 }catch(e){res.statusCode=500;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({message:e.message,code:e.code}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));return{server,url:'http://127.0.0.1:'+server.address().port,snapshot,bid,space};
}
async function main(){
 const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-extensions','--no-first-run']});const results=[];
 try{for(const width of [360,390]){
  const c=await caseServer(width),context=await browser.createBrowserContext(),page=await context.newPage();page.setDefaultTimeout(15000);await page.setViewport({width,height:850,isMobile:true,hasTouch:true});page.on('pageerror',e=>console.error('browser',width,e.message));
  try{
   await page.goto(c.url);await page.waitForFunction(()=>window.qaHomologReady);await page.evaluate(async()=>{await navigator.serviceWorker.register('/qa-worker.js');await navigator.serviceWorker.ready;});await page.waitForFunction(()=>!!navigator.serviceWorker.controller);await page.reload();await page.waitForFunction(()=>window.qaHomologReady);
   await page.click('#qa-config');await page.type('[name="nome"]','Corrida livre homologação');await page.select('[name="servicePricingModel"]','sale');await page.select('[name="serviceCostModel"]','km');await page.type('[name="custo"]','1.20');await page.$eval('[name="serviceFeePercent"]',e=>{e.value='10';});await page.click('[data-save-product]');await page.waitForFunction(()=>DB.carregar().produtos.some(p=>p.nome==='Corrida livre homologação'));await page.evaluate(()=>qaDrain());
   const product=await page.evaluate(()=>DB.carregar().produtos.find(p=>p.nome==='Corrida livre homologação'));assert.equal(product.preco,0);assert.equal(product.serviceCostConfig.model,'km');
   const trips=[{charge:30,km:10,cost:15,profit:15,payment:'pix'},{charge:47.5,km:17.5,cost:25.75,profit:21.75,payment:'dinheiro'},{charge:22,km:6,extra:2,cost:11.4,profit:10.6,payment:'cartao',offline:true}],recorded=[];
   for(const trip of trips){await page.click('#qa-selling');if(trip.offline)await page.setOfflineMode(true);await page.evaluate(()=>qaTapCount=0);
    await page.click(`[data-add="${product.id}"]`);await page.waitForSelector('.flexible-service-modal');
    for(const [name,value]of [['km',trip.km],['charge',trip.charge],...(trip.extra?[['extra',trip.extra]]:[])]){await page.click(`[name="${name}"]`);await page.$eval(`[name="${name}"]`,e=>{e.value='';});await page.type(`[name="${name}"]`,String(value));}
    await page.screenshot({path:path.join(out,`execucao-${width}-${trip.charge}.png`)});await page.click('.flexible-service-modal .btn-primary');await page.click('#open-sale-summary');if(trip.payment!=='pix')await page.click(`[data-payment="${trip.payment}"]`);await page.click('#finish-sale');await page.waitForSelector('.sale-receipt-paper');await page.evaluate(()=>DB.flush());
    const sale=await page.evaluate(()=>DB.carregar().vendas.at(-1)),taps=await page.evaluate(()=>qaTapCount);assert.equal(sale.valorFinal,trip.charge);assert.equal(sale.custoTotal,trip.cost);assert.equal(sale.lucro,trip.profit);assert.equal(sale.itens[0].serviceExecution.km,trip.km);assert.match(await page.$eval('.sale-receipt-paper',e=>e.textContent),new RegExp(String(trip.km).replace('.','\\.')));await page.screenshot({path:path.join(out,`recibo-${width}-${trip.charge}.png`)});
    recorded.push({...trip,saleId:sale.id,operationId:sale.operationId,taps});await page.click('[data-sale-close]');
    if(trip.offline){const originals=await page.evaluate(()=>qaOriginals());await page.reload();await page.waitForFunction(()=>window.qaHomologReady);assert.equal((await page.evaluate(()=>DB.carregar().vendas.at(-1))).operationId,sale.operationId);assert.deepEqual(await page.evaluate(()=>qaOriginals()),originals);await page.setOfflineMode(false);await page.waitForFunction(()=>!SyncFirebase.isSalePending(DB.carregar().vendas.at(-1)),{timeout:20000});}
    else await page.evaluate(()=>qaDrain());
   }
   const snapshot=await c.snapshot();assert.equal(snapshot.sales.length,3);assert.equal(snapshot.financial.length,3);assert.equal(snapshot.entries.length,3);assert.equal(snapshot.movements,0);assert.deepEqual([snapshot.sentinel.estoqueAtual,snapshot.sentinel.estoque,snapshot.sentinel.totalStock],[5,5,5]);assert.equal(snapshot.entries.reduce((s,e)=>s+e.amountCents,0),9950);assert.equal(snapshot.financial.reduce((s,f)=>s+Math.round(f.custoTotal*100),0),5215);assert.equal(new Set(snapshot.sales.map(s=>s.operationId)).size,3);assert.ok(snapshot.requests.some(r=>r.name==='getOperationalSyncReceipt'));
   await page.click('#qa-history');await page.waitForFunction(()=>document.querySelectorAll('[data-activity-id]').length===3);assert.equal(await page.evaluate(()=>ActivityCenter.events().filter(e=>e.type==='sale').reduce((s,e)=>s+Math.round(e.value*100),0)),9950);await page.screenshot({path:path.join(out,`historico-${width}.png`)});await page.click(`[data-activity-id="sale:${recorded[2].saleId}"]`);await page.waitForSelector('.activity-detail-modal');assert.match(await page.$eval('.activity-detail-modal',e=>e.textContent),/Corrida livre homologação/);assert.match(await page.$eval('.activity-detail-modal .service-line-summary',e=>e.textContent),/6 km/);await page.click('[data-history-receipt]');await page.waitForSelector('.sale-receipt-paper');assert.match(await page.$eval('.sale-receipt-paper',e=>e.textContent),/22,00/);await page.click('[data-sale-close]');
   await page.click('#qa-performance');await page.waitForFunction(()=>PerformanceDashboard.state.complete&&!PerformanceDashboard.state.busy);const view=await page.evaluate(()=>PerformanceDashboard.state.last);assert.equal(view.current.revenue,99.5);assert.equal(view.current.cost,52.15);assert.equal(view.current.profit,47.35);assert.equal(view.current.services,3);assert.equal(view.current.serviceKm,33.5);assert.equal(view.cash.current.total,99.5);await page.screenshot({path:path.join(out,`desempenho-${width}.png`),fullPage:true});assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);assert.deepEqual(await page.evaluate(()=>qaErrors),[]);
   results.push({width,productId:product.id,trips:recorded,totals:{revenue:99.5,cost:52.15,profit:47.35,km:33.5},stockMovements:0,physicalStock:5,financialEntries:3,serverSales:3,lostResponseRecoveredByReceipt:true,v237ReceiptCompatible:true,v237CostTriggerSkipsSnapshot:true,offlineRestart:true,requests:snapshot.requests,drains:snapshot.drains});console.log('APPROVED',width,JSON.stringify(results.at(-1)));
  }catch(e){try{console.error(await page.evaluate(()=>({errors:qaErrors,status:document.querySelector('#qa-status')?.textContent,formError:document.querySelector('[data-service-error]')?.textContent,feedback:document.querySelector('#sale-submit-feedback')?.textContent,body:document.querySelector('#app')?.textContent?.slice(0,250),draining:!!draining,queue})));await page.screenshot({path:path.join(out,`failure-${width}.png`)});}catch{}throw e;}
  finally{await context.close();await new Promise(r=>c.server.close(r));}
 }}finally{await browser.close();await db.terminate();await deleteApp(app);}
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({synthetic:true,projectId,productionWrites:0,results},null,2));
}
module.exports={caseServer,cleanup:async()=>{await db.terminate();await deleteApp(app);}};
if(require.main===module){if(process.argv.includes('--preview'))caseServer('preview').then(c=>console.log('V238 integração QA — só dados fictícios: '+c.url)).catch(e=>{console.error(e);process.exitCode=1;});else main().catch(e=>{console.error(e);process.exitCode=1;});}
