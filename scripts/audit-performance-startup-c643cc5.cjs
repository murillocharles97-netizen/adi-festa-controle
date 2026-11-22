'use strict';
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {root,out,assetServer,launch,setup,metrics,delta,profiler,listen,save}=require('./performance-lab-helpers.cjs');
const project='demo-veconi-perf', bid='perf-lab-business', uid='perf-lab-owner', space='perf-lab-space';
const email='owner@performance.example.test', password='PerfLabOnly123!';
const products=Number(process.env.PERF_PRODUCTS||25);
assert.ok(Number.isSafeInteger(products)&&products>=25&&products<=2000);
const hosts=['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'].map(k=>process.env[k]);
assert.ok(hosts.every(h=>/^127\.0\.0\.1:\d+$/.test(h||'')),'Loopback Auth and Firestore required');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getAuth}=require('firebase-admin/auth');
const {getFirestore}=require('firebase-admin/firestore');
const app=initializeApp({projectId:project}), db=getFirestore(app);
const member={uid,role:'owner',status:'active',spaceAccess:'all',allowedSpaceIds:[],permissionsVersion:3};
async function seed(){
 await getAuth(app).createUser({uid,email,password});
 const batch=db.batch(), date=new Date().toISOString();
 const add=(p,data)=>batch.set(db.doc(p),data);
 add('users/'+uid,{uid,email,role:'owner',active:true,businessId:bid,name:'QA',tutorialVersionSeen:999,tutorialVersions:{appIntro:100}});
 add('businesses/'+bid,{id:bid,businessId:bid,active:true,ownerId:uid,name:'QA',sensitiveDataVersion:1,legacyAccessDisabled:true,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}});
 add('businesses/'+bid+'/members/'+uid,member);
 add('businesses/'+bid+'/settings/default',{id:'default',businessId:bid,nome:'QA',onboardingCompleted:true,demonstracaoRemovida:true,operation:{operationMode:'physical_store',creditMode:'enabled',operationOnboardingCompleted:true,modules:{inventory:true,crm:true,creditSales:true}}});
 add('financialSpaces/'+space,{id:space,name:'Loja QA',type:'business',businessId:bid,linkedBusinessId:bid,ownerUid:uid,active:true,capabilities:{sales:true,finance:true,inventory:true,products:true,goals:true}});
 for(let i=0;i<25;i++){
  add('businesses/'+bid+'/clients/c'+i,{id:'c'+i,businessId:bid,nome:'Cliente '+i,saldo:0,ativo:true,createdAt:date,updatedAt:date});
 }
 await batch.commit();
 for(let start=0;start<products;start+=400){
  const productBatch=db.batch();
  for(let i=start;i<Math.min(start+400,products);i++){
   productBatch.set(db.doc('businesses/'+bid+'/products/p'+i),{id:'p'+i,businessId:bid,nome:'Produto '+i,preco:25,estoqueAtual:10,estoque:10,ativo:true,spaceAccessMode:'single_space',allowedSpaceIds:[space],defaultSpaceId:space,createdAt:date,updatedAt:date});
  }
  await productBatch.commit();
 }
}
const config=()=>{
 let s=fs.readFileSync(path.join(root,'js/firebase/firebase-config.js'),'utf8');
 s=s.replace(/const firebaseConfig=\{[^\n]+\};/,'const firebaseConfig='+JSON.stringify({apiKey:'perf-lab-key',authDomain:'127.0.0.1',projectId:project,appId:'1:111111:web:111111'})+';')
  .replace("PROJECT_ID='adi-festa-controle'","PROJECT_ID='"+project+"'")
  .replace('getAuth, setPersistence','getAuth, connectAuthEmulator, setPersistence')
  .replace('initializeFirestore, memoryLocalCache, doc','initializeFirestore, connectFirestoreEmulator, memoryLocalCache, doc')
  .replace('export const auth=getAuth(app);','export const auth=getAuth(app); connectAuthEmulator(auth,'+JSON.stringify('http://'+hosts[1])+',{disableWarnings:true});')
  .replace('export const db=initializeFirestore(app,{localCache:memoryLocalCache()});','export const db=initializeFirestore(app,{localCache:memoryLocalCache()}); connectFirestoreEmulator(db,"127.0.0.1",'+Number(hosts[0].split(':')[1])+');')
  .replace(/^window\.FirebaseCallable=.*;$/m,'window.FirebaseCallable=async(name,data)=>{(window.__labCallables??=[]).push(name);'+
   'if(!navigator.onLine)throw Object.assign(Error("QA offline"),{code:"unavailable"});'+
   'if(name==="ensureCurrentMembership")return {data:{member:'+JSON.stringify(member)+'}};'+
   'if(name==="getOperationalSyncReceipt"&&data?.kind==="sync_protocol")return {data:{operationalReadPolicyVersion:1,protocolVersion:1,permissionsVersion:2,fiadoHistoryReadVersion:1,paymentRecoveryReadVersion:1,queueRecoveryVersion:1,minClientRelease:202,channel:"commitOperationalSync",businessId:data.businessId,workspaceGeneration:0}};'+
   'throw Object.assign(Error("Callable not modelled in this benchmark"),{code:"unavailable"});};');
 assert.match(s,/connectFirestoreEmulator\(db/);assert.match(s,/connectAuthEmulator\(auth/);
 return s;
};
let offline=false;
const server=assetServer(location=>{
 if(location==='/js/firebase/firebase-config.js')return config();
 if(location==='/js/firebase/sync.js')return fs.readFileSync(path.join(root,'js/firebase/sync.js'),'utf8')
  .replace('PROJECT_ID !== "adi-festa-controle"', 'PROJECT_ID !== "'+project+'"');
 return null;
},()=>offline);
const rounds=Number(process.env.PERF_ROUNDS||3);
let revision=0;
const entries=[];
const outputName=process.env.PERF_STARTUP_OUTPUT||'startup.json';
const profiles=[{mobile:false,theme:'light'},{mobile:true,theme:'light'},{mobile:true,theme:'dark'}].filter(p=>!process.env.PERF_PROFILE||process.env.PERF_PROFILE===(p.mobile?'mobile-':'desktop-')+p.theme);
const summary=page=>page.evaluate(async()=>{
 const nav=performance.getEntriesByType('navigation')[0], resources=performance.getEntriesByType('resource');
 const bundle=resources.filter(x=>x.name.startsWith(location.origin));
 const usage=window.FirebaseUsageMonitor; const db=window.DB?.carregar?.();
 return {
  navigationMs:nav?.domContentLoadedEventEnd, fcpMs:performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
  nowMs:performance.now(),resources:bundle.length,transferBytes:bundle.reduce((n,r)=>n+r.transferSize,0),
  decodedBytes:bundle.reduce((n,r)=>n+r.decodedBodySize,0),serviceWorkerResources:bundle.filter(r=>r.workerStart>0).length,
  longTasks:window.__lab.long, events:window.__lab.events,usage:usage?.snapshot(),callables:window.__labCallables||[],
  bootstrap:window.FirebaseBootstrap?.state, data:{clients:db?.clientes?.length,products:db?.produtos?.length},
  sync:window.SyncFirebaseState&&{status:SyncFirebaseState.status,hydrated:SyncFirebaseState.hydrated,listenerConnected:SyncFirebaseState.listenerConnected,trace:SyncFirebaseState.syncTrace},
  deltaResult:window.__lab.deltaResult, online:navigator.onLine, controller:Boolean(navigator.serviceWorker.controller),persisted:Boolean(window.FirebaseSession?.user),
  swCacheNames:await caches.keys()
 };
});
async function main(){
 await seed();const base=await listen(server);const browser=await launch();
 try{
 for(const profile of profiles) for(let run=0;run<rounds;run++){
   const ctx=await browser.createBrowserContext(),network=[],failures=[],consoleErrors=[];
   let page=await ctx.newPage(),cdp;
   try{
    const prepare=async target=>{
    target.on('request',r=>{const u=new URL(r.url());if(hosts.includes(u.host))network.push({host:u.host,path:u.pathname});});
    target.on('pageerror',e=>consoleErrors.push(e.message));
    target.on('requestfailed',r=>{if(hosts.includes(new URL(r.url()).host))failures.push(r.failure()?.errorText);});
    return setup(target,{...profile,allowed:[base,...hosts.map(h=>'http://'+h)],deny:url=>offline&&hosts.includes(url.host),intercept:process.env.PERF_BROWSER_INTERCEPT==='1'});
    };
    cdp=await prepare(page);
    const track=async (phase,action)=>{
      const start=await metrics(cdp), t=process.hrtime.bigint(), netStart=network.length, failuresStart=failures.length;
      const profileCpu=run===0&&['cold-login-screen','login-to-dashboard','initial-hydration','products-incremental'].includes(phase);
      if(profileCpu){await cdp.send('Profiler.enable');await cdp.send('Profiler.start');}
      let fault;try{await action();}catch(e){fault=e.message;}
      const elapsedMs=Number(process.hrtime.bigint()-t)/1e6;
      let end=start, details={};
      try{end=await metrics(cdp);}catch(e){fault ||= e.message;}
      try{details=await summary(page);}catch(e){fault ||= e.message;}
      const cpu=profileCpu?profiler((await cdp.send('Profiler.stop')).profile):undefined;
      const sample={...profile,products,run,phase,elapsedMs,...delta(start,end,['cold-login-screen','warm-reload','offline-reload','resume-session'].includes(phase)),network:network.slice(netStart),failedTransport:failures.slice(failuresStart),...details,fault,cpu,consoleErrors:[...consoleErrors]};
      entries.push(sample);save(outputName,entries);
      console.log(JSON.stringify({mobile:profile.mobile,theme:profile.theme,run,phase,elapsedMs:Math.round(elapsedMs),fault,bootstrap:sample.bootstrap,data:sample.data,resources:sample.resources,network:sample.network.length}));
      return sample;
    };
    const shell=()=>page.waitForFunction(()=>!!document.querySelector('#app[data-route="inicio"]')?.children.length && document.querySelector('#auth-gate').hidden,{timeout:12000,polling:100});
    await track('cold-login-screen',async()=>{await page.goto(base,{waitUntil:'domcontentloaded',timeout:45000});await page.waitForSelector('#login-form',{visible:true,timeout:25000});});
    await page.$eval('#login-email',(n,value)=>n.value=value,email);
    await page.$eval('#login-password',(n,value)=>n.value=value,password);
    await track('login-to-dashboard',async()=>{await page.click('#login-submit');await shell();});
    await track('initial-hydration',()=>page.waitForFunction(expected=>SyncFirebaseState?.hydrated&&DB.carregar().produtos.length===expected,{timeout:25000,polling:100},products));
    await track('install-worker',async()=>{
      await page.evaluate(()=>PwaUpdate.register());
      await page.waitForFunction(()=>navigator.serviceWorker.controller,{timeout:35000});
    });
    await page.evaluate(()=>DB.flush());
    await page.close();
    page=await ctx.newPage();
    cdp=await prepare(page);
    const warm=await track('warm-reload',async()=>{
      await page.goto(base+'/?lab=warm',{waitUntil:'domcontentloaded',timeout:15000});await shell();
    });
    if(warm.fault)continue;
    const incremental=async()=>{
      const marker='QA produto revisao '+(++revision);
      await db.doc('businesses/'+bid+'/products/p0').update({nome:marker,updatedAt:new Date().toISOString()});
      const count=await page.evaluate(async expected=>{
        const n=await SyncFirebase.pullCloudCollections({force:true,names:['products']});
        window.__lab.deltaResult={documents:n,visible:DB.carregar().produtos.some(p=>p.id==='p0'&&p.nome===expected)};
        return n;
      },marker);
      assert.ok(count>=0);
      await page.waitForFunction(expected=>DB.carregar().produtos.some(p=>p.id==='p0'&&p.nome===expected),{timeout:9000,polling:100},marker);
      await page.evaluate(()=>window.__lab.deltaResult.visible=true);
    };
    await track('products-incremental',incremental);
    if((profile.mobile||process.env.PERF_INCLUDE_OFFLINE) && !process.env.PERF_SKIP_OFFLINE){
     offline=true;
     await cdp.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
     await track('offline-dashboard-route',()=>page.evaluate(async()=>{
      Router.ir('produtos');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      Router.ir('inicio');await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));
      if(!document.querySelector('#app[data-route="inicio"]')?.children.length)throw Error('Dashboard nao reabriu');
     }));
     offline=false;
     const resumedNetwork={offline:false,latency:profile.mobile?80:0,downloadThroughput:profile.mobile?200000:-1,uploadThroughput:profile.mobile?93750:-1};
     await cdp.send('Network.emulateNetworkConditions',resumedNetwork);
     await track('resume-open-session-products',incremental);
     offline=true;
     await page.close();
     page=await ctx.newPage();
     cdp=await prepare(page);
     await cdp.send('Network.emulateNetworkConditions',{offline:true,latency:0,downloadThroughput:0,uploadThroughput:0});
     await track('offline-reload',async()=>{
      await page.goto(base+'/?lab=offline',{waitUntil:'domcontentloaded',timeout:15000});
      await page.waitForFunction(()=>['authorized','network_unavailable','network_error','temporary_unavailable','fatal_error','unauthenticated','error'].includes(window.FirebaseBootstrap?.state),{timeout:18000,polling:200});
     });
     offline=false;
     await cdp.send('Network.emulateNetworkConditions',resumedNetwork);
     if(await page.evaluate(()=>window.FirebaseBootstrap?.state!=='authorized')){
      await page.close();
      page=await ctx.newPage();
      cdp=await prepare(page);
      await track('resume-session',async()=>{await page.goto(base+'/?lab=resume',{waitUntil:'domcontentloaded',timeout:15000});await shell();});
     }
     if(await page.evaluate(()=>window.FirebaseBootstrap?.state==='authorized')) await track('resume-products',incremental);
    }
   }catch(error){
    console.error('Contexto interrompido',profile,run,error.message);
   }finally{offline=false;await ctx.close().catch(()=>{});}
 }
 }finally{await browser.close();server.close();await db.terminate();await deleteApp(app);}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
