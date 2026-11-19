'use strict';
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Emulator required');
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app'),{getFirestore}=require('firebase-admin/firestore');
const puppeteer=require('C:/Users/Murillo/AppData/Local/Temp/veconi-fiado-mensagens-v2/node_modules/puppeteer-core');
const source=path.resolve(process.env.VECONI_TEST_FUNCTION_SOURCE||'functions'),readerSource=path.resolve(process.env.VECONI_TEST_RECEIPT_SOURCE||source);
const {operationalCommitService}=require(source+'/src/services/operational-commit-service');
const root=path.resolve(__dirname,'..'),out=path.join(root,'qa-artifacts/fiado-space-regularization');fs.mkdirSync(out,{recursive:true});
const app=initializeApp({projectId:'demo-veconi-regularization-browser'},'regularization-browser'),db=getFirestore(app),write=operationalCommitService(db),read=require(readerSource+'/src/services/operational-commit-service').operationalCommitService(db);
const commit=require(source+'/src/shared/operational-callable').operationalCallable(write.commit,{requireProtocol:true});
const css=[...fs.readFileSync('index.html','utf8').matchAll(/<link[^>]+href="\.\/(css\/[^"?]+)[^"]*"[^>]*>/g)].map(m=>'<link rel="stylesheet" href="/'+m[1]+'">').join('');
const html=c=>`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${css}</head><body><main><h2>Clientes · Táxi QA</h2><article class="card" style="padding:20px"><b>Pessoa fictícia</b><p>Saldo do espaço: <strong id="debt">Consultando</strong></p><button class="btn btn-light" onclick="FiadoSpaceRegularization.open('qa-client')">Regularizar saldo</button></article></main><div id="modal"></div><div id="toasts"></div><script>
const session=${JSON.stringify(c)};let client,queueBlocked=false,mode='normal';window.errors=[];
window.addEventListener('error',e=>errors.push(e.message));
window.Utils={escapar:v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),dinheiro:v=>v.toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),toast:m=>{document.getElementById('toasts').textContent=m;}};
window.DB={getBusinessId:()=>session.businessId,getWorkspaceGeneration:()=>0};
window.BusinessContext={get:()=>({businessId:session.businessId,business:{ownerId:session.uid},role:'owner'})};window.FirebaseSession={user:{uid:session.uid}};
window.TeamAccess={has:()=>true};window.SpaceContext={activeId:()=>session.spaceId,homeSpaces:()=>[{id:session.spaceId,name:'Táxi QA'}]};window.AdiFestaBuild={release:238};
window.Clientes={obter:()=>client,prepareList(){}};
window.FirebaseCallable=async(name,data)=>{const r=await fetch('/api',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name,data,uid:session.uid,mode})});let result;try{result=await r.json();}catch{throw Object.assign(Error('Resposta perdida. Consulte a confirmação.'),{code:'unavailable'});}if(!r.ok)throw Object.assign(Error(result.message),{code:result.code});return {data:result};};
window.SyncFirebase={assertFiadoReceiptQueueClear:()=>{if(queueBlocked)throw Error('Há uma operação financeira local pendente deste cliente.');},readCanonicalClient:async()=>{client=await(await fetch('/client')).json();return client;}};
window.InstallmentCredit={refresh:async()=>{const r=await FirebaseCallable('getOperationalSyncReceipt',{...session,clientId:'qa-client',kind:'fiado_receipt_route',scopedReceiptVersion:1});document.getElementById('debt').textContent=Utils.dinheiro((r.data.totalCents||0)/100);return r.data;}};
window.ready=SyncFirebase.readCanonicalClient().then(()=>InstallmentCredit.refresh()).catch(()=>{document.getElementById('debt').textContent='R$ 0,00';});
</script><script src="/js/fiado-space-regularization.js"></script></body></html>`;
(async()=>{let browser,server;const cases=new Map(),results=[];try{
 for(const width of [360,390,1366]){
  const bid='qa-browser-'+crypto.randomUUID(),uid='owner-'+crypto.randomUUID(),spaceId='taxi-'+crypto.randomUUID(),c={businessId:bid,uid,spaceId,workspaceGeneration:0};cases.set(String(width),c);
  await db.doc('businesses/'+bid).set({active:true,ownerId:uid,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
  await db.doc('users/'+uid).set({active:true,businessId:bid,role:'owner'});await db.doc(`businesses/${bid}/members/${uid}`).set({role:'owner',status:'active',spaceAccess:'all'});
  await db.doc('financialSpaces/'+spaceId).set({id:spaceId,businessId:bid,linkedBusinessId:bid,active:true,type:'business',ownerUid:uid,capabilities:{sales:true,finance:true}});
  await db.doc(`businesses/${bid}/clients/qa-client`).set({id:'qa-client',businessId:bid,nome:'Pessoa fictícia',saldo:0,financialVersion:0,active:true,customerSpaceIds:[spaceId]});
 }
 server=http.createServer(async(req,res)=>{try{
  const url=new URL(req.url,'http://localhost');const c=cases.get(url.searchParams.get('width')||req.headers['x-case']||'390');
  if(url.pathname==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');return res.end(html(c));}
  if(url.pathname==='/client'){res.setHeader('Content-Type','application/json');return res.end(JSON.stringify((await db.doc(`businesses/${c.businessId}/clients/qa-client`).get()).data()));}
  if(url.pathname==='/api'){
   const data=JSON.parse(await new Promise(resolve=>{let text='';req.on('data',b=>text+=b);req.on('end',()=>resolve(text));}));
   assert.ok([...cases.values()].some(c=>c.businessId===data.data.businessId&&c.uid===data.uid),'Synthetic fixtures only');
   const result=await (data.name==='commitOperationalSync'?commit:read.receipt)({auth:{uid:data.uid},data:data.data});
   if(data.mode==='lost'&&data.name==='commitOperationalSync'){res.statusCode=503;return res.end('Simulated response lost after commit');}
   res.setHeader('Content-Type','application/json');return res.end(JSON.stringify(result));
  }
  const target=path.resolve(root,'.'+url.pathname);if(!target.startsWith(root+path.sep)||!['.js','.css','.woff2'].includes(path.extname(target)))throw Error('Asset not permitted');
  res.setHeader('Content-Type',target.endsWith('.css')?'text/css':target.endsWith('.woff2')?'font/woff2':'text/javascript');res.end(fs.readFileSync(target));
 }catch(e){res.statusCode=400;res.setHeader('Content-Type','application/json');res.end(JSON.stringify({code:e.code||'failed-precondition',message:e.message}));}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-extensions','--no-first-run']});
 for(const width of [360,390,1366]){
  const c=cases.get(String(width)),context=await browser.createBrowserContext(),page=await context.newPage();await page.setViewport({width,height:850,isMobile:width<768,hasTouch:width<768});await page.setExtraHTTPHeaders({'x-case':String(width)});
  await page.goto('http://127.0.0.1:'+server.address().port+'/?width='+width);await page.evaluate(()=>ready);
  await page.click('main button');await page.waitForFunction(()=>document.querySelector('[data-reg-form]')?.hidden===false);
  await page.$eval('[name=total]',e=>{e.value='150';e.dispatchEvent(new Event('input',{bubbles:true}));});await page.type('[name=reason]','Dívida histórica conferida com anotações próprias');await page.click('[name=confirmed]');
  assert.match(await page.$eval('[data-reg-difference]',e=>e.textContent),/150,00/);
  await page.screenshot({path:path.join(out,'conferir-saldo-'+width+'.png')});
  const rect=await page.$eval('[role=dialog]',e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom};});assert.ok(rect.left>=0&&rect.right<=width+1&&rect.top>=0&&rect.bottom<=851);
  // Lost response: reload must consult the same persisted operation, not create another.
  await page.evaluate(()=>mode='lost');await page.click('[data-reg-submit]');await page.waitForFunction(()=>document.querySelector('[data-reg-retry]')?.hidden===false);
  await page.reload();await page.evaluate(()=>ready);await page.click('main button');await page.waitForFunction(()=>document.querySelector('[data-reg-status]')?.textContent.includes('Saldo confirmado:'));
  const rows=await db.collection(`businesses/${c.businessId}/balanceAdjustments`).get();assert.equal(rows.size,1);assert.equal((await db.doc(`businesses/${c.businessId}/clients/qa-client`).get()).data().saldo,-150);
  assert.equal((await db.collection(`businesses/${c.businessId}/sales`).get()).size,0);assert.equal((await db.collection(`financialSpaces/${c.spaceId}/entries`).get()).size,0);
  await page.waitForFunction(()=>document.getElementById('debt').textContent.includes('150,00'));await page.screenshot({path:path.join(out,'saldo-confirmado-'+width+'.png')});
  await page.click('[data-reg-close]');await page.evaluate(()=>queueBlocked=true);await page.click('main button');await page.waitForFunction(()=>document.querySelector('[data-reg-status]')?.textContent.includes('pendente'));assert.equal(await page.$eval('[data-reg-form]',e=>e.hidden),true);
  assert.deepEqual(await page.evaluate(()=>errors),[]);results.push({width,serverConfirmed:true,responseLostAndRestart:true,singleAdjustment:true,noSaleOrCash:true,localPendingBlocked:true,viewport:true});await context.close();
 }
 fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(results));
 }finally{await browser?.close();if(server)await new Promise(r=>server.close(r));await db.terminate();await deleteApp(app);}})().catch(e=>{console.error(e.stack);process.exitCode=1;});
