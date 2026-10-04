'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),puppeteer=require('puppeteer');
for(const key of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])if(!/^(127\.0\.0\.1|localhost):/.test(process.env[key]||''))throw Error('Local emulators required; production forbidden.');
const admin=require('../functions/node_modules/firebase-admin');admin.initializeApp({projectId:'adi-festa-variations-test'});
const db=admin.firestore(),bid='qa-analytics-v161',email='analytics-v161@example.test',password='LocalQa123!',output=path.resolve('artifacts/performance-v161');fs.mkdirSync(output,{recursive:true});
const {performanceReadService}=require('../functions/src/services/performance-read-service'),M=require('../js/performance-model');
let diagnosticPage;
const root=process.cwd(),mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.json':'application/json','.png':'image/png'};
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
 if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');
 if(pathname==='/js/firebase/firebase-config.js'){
  let source=fs.readFileSync(file,'utf8').replaceAll('adi-festa-controle','adi-festa-variations-test');
  source=source.replace('getAuth, setPersistence','connectAuthEmulator, getAuth, setPersistence').replace('initializeFirestore, memoryLocalCache','connectFirestoreEmulator, initializeFirestore, memoryLocalCache').replace('getFunctions, httpsCallable','connectFunctionsEmulator, getFunctions, httpsCallable');
  source=source.replace('export const auth=getAuth(app);',"export const auth=getAuth(app);connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});");
  source=source.replace('export const db=initializeFirestore(app,{localCache:memoryLocalCache()});',"export const db=initializeFirestore(app,{localCache:memoryLocalCache()});connectFirestoreEmulator(db,'127.0.0.1',8080);");
  source=source.replace("export const functions=getFunctions(app,'southamerica-east1');","export const functions=getFunctions(app,'southamerica-east1');connectFunctionsEmulator(functions,'127.0.0.1',5001);");return res.end(source);
 }
 if(pathname==='/js/firebase/sync.js')return res.end(fs.readFileSync(file,'utf8').replaceAll('adi-festa-controle','adi-festa-variations-test'));fs.createReadStream(file).pipe(res);
});
async function seed(){
 const user=await admin.auth().createUser({email,password}),uid=user.uid,now=new Date(),at=admin.firestore.Timestamp.now();
 const rows={
 [`users/${uid}`]:{uid,email,name:'Owner Analytics QA',businessId:bid,active:true,role:'owner',tutorialVersions:{appIntro:1}},
 [`businesses/${bid}`]:{id:bid,ownerId:uid,name:'VECONI Analytics QA',active:true,sensitiveDataVersion:1,subscription:{planId:'internal',status:'active'}},
 [`businesses/${bid}/members/${uid}`]:{uid,name:'Owner QA',email,status:'active',role:'owner',spaceAccess:'all',allowedSpaceIds:[],permissions:require('../functions/src/services/team-access-service').ROLE_PRESETS.owner},
 [`users/qa-analytics-seller`]:{uid:'qa-analytics-seller',active:true,businessId:bid,role:'seller'},
 [`businesses/${bid}/members/qa-analytics-seller`]:{uid:'qa-analytics-seller',status:'active',role:'seller',spaceAccess:'selected',allowedSpaceIds:['qa-space-a'],permissions:{'reports.view':true}},
 [`businesses/${bid}/clients/qa-client`]:{id:'qa-client',businessId:bid,nome:'Cliente de QA',saldo:-150,ativo:true,active:true,createdAt:at,updatedAt:at},
 };
 for(const[id,name]of [['qa-space-a','Adi Festa QA'],['qa-space-b','PrimeLine QA'],['qa-space-c','Táxi QA']])rows[`financialSpaces/${id}`]={id,name,businessId:bid,linkedBusinessId:bid,ownerUid:uid,type:'business',active:true,status:'active'};
 const names=['Café especial','Copo térmico','Kit festa','Balões premium','Lanche natural'],cats=['Bebidas','Utilidades','Festas','Festas','Alimentos'];
 for(let i=0;i<270;i++){
  const date=new Date(now.getTime()-(i%60)*86400000);date.setHours(12,0,0,0);
  const id=`qa-sale-${String(i).padStart(4,'0')}`,amount=35+(i%5)*12,spaceId=['qa-space-a','qa-space-b','qa-space-c'][i%3],cost=amount*.4;
  rows[`businesses/${bid}/sales/${id}`]={id,businessId:bid,spaceId,data:date.toISOString(),createdAt:date.toISOString(),updatedAt:date.toISOString(),valorFinal:amount,valorTotal:amount,custoTotal:cost,lucro:amount-cost,status:i%4?'pago':'fiado',formaPagamento:['pix','dinheiro','cartao','fiado'][i%4],itens:[{produtoId:`qa-p-${i%5}`,nome:names[i%5],quantidade:1+i%3,subtotalFinal:amount,categoryNameSnapshot:cats[i%5]}]};
  rows[`businesses/${bid}/saleFinancials/${id}`]={id,saleId:id,custoTotal:cost,lucro:amount-cost,costResolution:'complete',itemCosts:[]};
 }
 rows[`businesses/${bid}/sales/qa-timestamp`]={id:'qa-timestamp',businessId:bid,spaceId:'qa-space-a',data:at,valorFinal:15,status:'pago',custoTotal:5,lucro:10,itens:[]};
 rows[`businesses/${bid}/sales/qa-partial-cost`]={id:'qa-partial-cost',businessId:bid,spaceId:'qa-space-a',data:new Date(now.getTime()+2*86400000).toISOString(),valorFinal:50,custoTotal:0,lucro:50,costResolution:'partial',itens:[]};
 for(const [id,spaceId,financialSpaceId] of [['qa-legacy',null,'qa-space-a'],['qa-alias','qa-space-a','qa-space-a'],['qa-conflict','qa-space-b','qa-space-a']])rows[`businesses/${bid}/sales/${id}`]={id,businessId:bid,...(spaceId?{spaceId}:{}),financialSpaceId,data:now.toISOString().replace(/\.\d{3}Z$/,'Z'),valorFinal:20,status:'pago',custoTotal:8,lucro:12,itens:[]};
 const entries=Object.entries(rows);for(let n=0;n<entries.length;n+=350){const batch=db.batch();for(const[p,v]of entries.slice(n,n+350))batch.set(db.doc(p),v);await batch.commit();}return uid;
}
async function main(){
 const uid=await seed(),range=M.range('30d'),input={businessId:bid,workspaceGeneration:0,from:range.from,to:range.to,spaceId:'all'},service=performanceReadService(db),request={auth:{uid,token:{}},data:input};
 let next=null,rows=[],calls=0;do{const response=await service.page({...request,data:{...input,cursor:next}});rows.push(...response.rows);next=response.next;calls++;assert.ok(calls<6);}while(next);
 assert.ok(rows.length>250);assert.equal(new Set(rows.map(s=>s.id)).size,rows.length);assert.ok(rows.some(s=>s.id==='qa-timestamp'));
 const partial=await service.page({...request,data:{...input,from:new Date(Date.now()+86400000).toISOString(),to:new Date(Date.now()+3*86400000).toISOString()}});assert.equal(partial.rows.find(s=>s.id==='qa-partial-cost')?.costResolution,'partial');
 const restricted=await service.page({auth:{uid:'qa-analytics-seller',token:{}},data:input});assert.ok(restricted.rows.length);assert.ok(restricted.rows.every(s=>s.spaceId==='qa-space-a'&&!('lucro'in s)&&!('custoTotal'in s)));assert.ok(!JSON.stringify(restricted).includes('custoUnitario'));
 let restrictedRows=[...restricted.rows],restrictedNext=restricted.next;
 while(restrictedNext){const result=await service.page({auth:{uid:'qa-analytics-seller',token:{}},data:{...input,cursor:restrictedNext}});restrictedRows.push(...result.rows);restrictedNext=result.next;}
 assert.ok(restrictedRows.some(s=>s.id==='qa-legacy'));assert.equal(restrictedRows.filter(s=>s.id==='qa-alias').length,1);assert.ok(!restrictedRows.some(s=>s.id==='qa-conflict'));assert.equal(new Set(restrictedRows.map(s=>s.id)).size,restrictedRows.length);
 await assert.rejects(()=>service.page({auth:{uid:'qa-analytics-seller',token:{}},data:{...input,spaceId:'qa-space-b'}}),/Espaço não autorizado/);
 await assert.rejects(()=>service.page({...request,data:{...input,businessId:'another-business'}}),/Empresa não encontrada/);
 await assert.rejects(()=>service.page({...request,data:{...input,workspaceGeneration:9}}),/Reabra/);
 await db.doc(`businesses/${bid}/members/qa-analytics-seller`).update({role:'manager',permissions:{'reports.view':true,'profit.view':true}});
 const manager=await service.page({auth:{uid:'qa-analytics-seller',token:{}},data:input});assert.ok(manager.rows.every(s=>'lucro'in s&&!('custoTotal'in s)));
 await db.doc(`businesses/${bid}/members/qa-analytics-seller`).update({permissions:{}});await assert.rejects(()=>service.page({auth:{uid:'qa-analytics-seller',token:{}},data:input}),/Desempenho/);
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),errors=[];
 try{
  const page=await browser.newPage();page.on('pageerror',e=>errors.push(e.message));
  diagnosticPage=page;
  page.on('console',m=>{if(m.type()==='error')console.log('[BROWSER ERROR]',m.text().slice(0,700));});
  await page.setRequestInterception(true);page.on('request',r=>{const u=new URL(r.url());if(/googleapis\.com|cloudfunctions\.net|\.run\.app/.test(u.hostname)&&u.hostname!=='fonts.googleapis.com')return r.abort();r.continue();});
  await page.setViewport({width:1440,height:1000});await page.goto(`http://127.0.0.1:${server.address().port}`,{waitUntil:'domcontentloaded'});await page.waitForSelector('#login-form');await page.type('[name=email]',email);await page.type('[name=password]',password);await page.click('#login-submit');await page.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized',{timeout:60000});
  await page.evaluate(()=>{document.querySelector('#modal').innerHTML='';Router.ir('relatorios');});
  await page.waitForFunction(()=>window.PerformanceDashboard?.state.complete,{timeout:60000});
  await page.waitForFunction(()=>document.querySelector('#auth-gate')?.hidden&&!document.documentElement.classList.contains('auth-pending'),{timeout:60000});
  const current=await page.evaluate(()=>({count:PerformanceDashboard.state.last.current.count,revenue:PerformanceDashboard.state.last.current.revenue,total:PerformanceDashboard.state.last.points.reduce((n,p)=>n+p.revenue,0),rows:PerformanceDashboard.state.rows.length}));assert.equal(current.revenue,current.total);assert.equal(current.rows,rows.length);
  for(const width of [320,360,375,390,412,430,1024,1280,1366,1440,1600,1920]){
   await page.setViewport({width,height:1000,isMobile:width<768,hasTouch:width<768});
   // Puppeteer reloads when changing mobile emulation, so await a real authorized
   // visible page, not stale dashboard state from the previous document.
   await page.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized'&&document.querySelector('#auth-gate')?.hidden&&document.querySelectorAll('.analytics-kpi').length===4&&window.PerformanceDashboard?.state.complete,{timeout:60000});
   await new Promise(r=>setTimeout(r,200));
   const metrics=await page.evaluate(()=>({scroll:document.documentElement.scrollWidth,width:innerWidth,kpis:document.querySelectorAll('.analytics-kpi').length}));assert.ok(metrics.scroll<=width+1,JSON.stringify(metrics));assert.equal(metrics.kpis,4);
   if([390,1366,1440,1920].includes(width))await page.screenshot({path:path.join(output,`${width}-performance.png`),fullPage:true});
  }
  await page.setViewport({width:1440,height:1000});await page.waitForFunction(()=>document.querySelector('#auth-gate')?.hidden,{timeout:60000});let requests=0;page.on('request',r=>{if(r.url().includes('getPerformancePage'))requests++;});
  await page.hover('.analytics-chart');await page.$eval('#analytics-point',input=>{input.value='4';input.dispatchEvent(new Event('input',{bubbles:true}));});assert.ok(await page.$eval('.analytics-tooltip',x=>!x.hidden));assert.equal(requests,0);
  await page.select('#analytics-space','qa-space-a');await page.waitForFunction(()=>PerformanceDashboard.state.complete&&!PerformanceDashboard.state.busy);assert.ok(await page.evaluate(()=>PerformanceDashboard.state.rows.every(s=>s.spaceId==='qa-space-a')));
  await page.select('#analytics-period','year');await page.waitForFunction(()=>PerformanceDashboard.state.complete&&!PerformanceDashboard.state.busy);assert.equal(await page.evaluate(()=>PerformanceDashboard.state.last.range.granularity),'month');
  await page.select('#analytics-period','custom');await page.$eval('#analytics-start',x=>x.value='2001-01-01');await page.$eval('#analytics-end',x=>x.value='2001-01-07');await page.click('[data-analytics-apply]');await page.waitForFunction(()=>PerformanceDashboard.state.complete&&!PerformanceDashboard.state.busy);assert.equal(await page.evaluate(()=>PerformanceDashboard.state.last.current.count),0);assert.ok(await page.$('.analytics-empty'));
  for(const route of ['inicio','vender','clientes','produtos','financeiro','historico','equipe','configuracoes','relatorios']){await page.evaluate(route=>Router.ir(route),route);await page.waitForFunction(route=>document.querySelector('#app')?.dataset.route===route,{},route);assert.equal(await page.$('.boot-recovery'),null);}
  console.log('[QA] filters, 12 widths and module navigation passed; checking reload');
  await page.reload({waitUntil:'domcontentloaded'});
  // Lifecycle/reload can pause animation frames in headless mobile emulation.
  // Poll the actual auth and rendered state on a timer, not requestAnimationFrame.
  await page.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized'&&document.querySelector('#auth-gate')?.hidden,{timeout:60000,polling:100});
  await page.waitForFunction(()=>window.PerformanceDashboard?.state.complete&&document.querySelectorAll('.analytics-kpi').length===4,{timeout:60000,polling:100});
  await page.evaluate(async()=>{await navigator.serviceWorker.register('./service-worker.js');await navigator.serviceWorker.ready;});
  await page.waitForFunction(()=>Boolean(navigator.serviceWorker.controller),{timeout:30000,polling:100});
  const cached=await page.evaluate(async()=>Promise.all(['js/performance-model.js','js/performance-dashboard.js','css/performance-dashboard.css'].map(async file=>Boolean(await caches.match(new URL(file,location.href))))));assert.deepEqual(cached,[true,true,true]);
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.FirebaseBootstrap?.state==='authorized'&&document.querySelector('#auth-gate')?.hidden&&window.PerformanceDashboard?.state.complete,{timeout:60000,polling:100});
  await page.setOfflineMode(true);await page.click('[data-analytics-refresh]');await page.waitForFunction(()=>document.querySelector('.analytics-status')?.textContent.includes('offline'),{polling:100});await page.setOfflineMode(false);
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,model:current,pages:calls,permissions:'owner/seller/manager/other space/other business/generation verified',widths:12,hoverQueries:0,smoke:'login/Home/Vender/Clientes/Produtos/Financeiro/Histórico/Equipe/Configurações/reload',pwa:'service worker controlled reload/assets/offline preview verified',physicalAndroid:'not tested',productionWrites:0}));
 }catch(error){console.log('[QA FAILURE STATE]',{errors,state:await diagnosticPage.evaluate(()=>({bootstrap:window.FirebaseBootstrap,gateHidden:document.querySelector('#auth-gate')?.hidden,visibility:document.visibilityState,route:location.hash,analytics:window.PerformanceDashboard?.state.error,app:document.querySelector('#app')?.innerText?.slice(0,600)})).catch(()=>null)});await diagnosticPage.screenshot({path:path.join(output,'failure.png')}).catch(()=>{});throw error;}finally{await browser.close();server.close();}
}
main().then(()=>process.exit(0)).catch(e=>{console.error(e.stack||e);server.close();process.exit(1);});
