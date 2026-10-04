'use strict';
// Isolated browser contexts; no Firebase connection and no production URL.
const assert=require('node:assert/strict'),fs=require('node:fs'),http=require('node:http'),path=require('node:path'),puppeteer=require('puppeteer');
const root=process.cwd(),sources=['/js/storage.js','/js/business-cache.js','/js/local-records.js','/js/workspace-generation.js','/js/workspace-runtime.js'];
const server=http.createServer((request,response)=>{
  const pathname=new URL(request.url,'http://localhost').pathname;
  if(pathname==='/'){response.setHeader('Content-Type','text/html');return response.end('<!doctype html><meta charset="utf-8"><title>Workspace generation isolated test</title><script>window.DB={}</script><script src="/js/local-records.js"></script><script src="/js/workspace-generation.js"></script>');}
  if(pathname==='/cache'){response.setHeader('Content-Type','text/html');return response.end('<!doctype html><meta charset="utf-8"><title>Cache epoch race</title><script>window.Utils={uuid:()=>crypto.randomUUID(),toast:()=>{}};window.PhoneUtils={normalizeBrazilianPhone:v=>String(v||"")};</script><script src="/js/storage.js"></script><script src="/js/local-records.js"></script><script src="/js/business-cache.js"></script><script src="/js/workspace-generation.js"></script>');}
  if(!sources.includes(pathname))return response.writeHead(404).end();
  response.setHeader('Content-Type','application/javascript');response.end(fs.readFileSync(path.join(root,pathname.slice(1))));
});
async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  try{
    const mobile=await browser.createBrowserContext(),desktop=await browser.createBrowserContext(),a=await mobile.newPage(),b=await desktop.newPage();
    await a.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    const base=`http://127.0.0.1:${server.address().port}`;
    for(const page of [a,b]){
      await page.goto(base);
      await page.evaluate(async()=>{
        const rows=[
          {key:'a-product',scope:'business-cache:v156:adiFestaDB_v1:biz-a:owner:sig',value:{id:'old-product'}},
          {key:'a-queue',scope:'business-cache:v156:adiFestaDB_v1:biz-a:owner:sig',value:{operationId:'old-sale'}},
          {key:'b-product',scope:'business-cache:v156:adiFestaDB_v1:biz-b:owner:sig',value:{id:'preserved'}},
          {key:'message-active:biz-a:owner',scope:'biz-a:owner',kind:'sequence'},
          {key:'message-active:biz-b:owner',scope:'biz-b:owner',kind:'sequence'},
          {key:'payment-attempt:biz-a:owner',scope:'payment-attempt:biz-a:owner'},
          {key:'workspace-generation:biz-a',scope:'workspace:biz-a',workspaceGeneration:4},
        ];
        await DB.localRecords.transaction('readwrite',(store,done)=>{for(const row of rows)store.put(row);done();});
        for(const [key,value]of Object.entries({'PrimeDocs:data':'preserve','TaxPress:data':'preserve','firebase:authUser:qa':'preserve','adiFesta:biz-a:owner:sig:syncQueue':'old','adiFesta:biz-b:owner:sig:syncQueue':'preserve','veconi:spaces:v1:owner:biz-a':'old','adiFestaFirestoreQueue_v1':JSON.stringify([{businessId:'biz-a',id:'remove'},{businessId:'biz-b',id:'keep'}])}))localStorage.setItem(key,value);
        sessionStorage.setItem('veconi:sale-draft:v1:biz-a:space-a','old cart');sessionStorage.setItem('veconi:sale-draft:v1:biz-b:space-b','preserved cart');
        window.invalidations=0;
        window.manager=WorkspaceGenerationProtocol.create({records:DB.localRecords,localStorage,sessionStorage,onInvalidate:async()=>{invalidations++;}});
        await manager.observe({businessId:'biz-a',workspaceGeneration:4,confirmedByServer:true});
        window.oldOrigin=manager.capture();
      });
    }
    // Desktop receives reset generation while mobile remains with old offline data.
    await b.evaluate(()=>manager.observe({businessId:'biz-a',workspaceGeneration:5,status:'COMPLETED',confirmedByServer:true}));
    assert.equal(await a.evaluate(async()=>!!await DB.localRecords.read('a-product')),true);
    await a.reload();
    await a.evaluate(async()=>{
      window.manager=WorkspaceGenerationProtocol.create({records:DB.localRecords,localStorage,sessionStorage});
      await manager.observe({businessId:'biz-a',workspaceGeneration:5,status:'COMPLETED',confirmedByServer:true});
    });
    for(const page of [a,b]){
      const result=await page.evaluate(async()=>({old:await DB.localRecords.read('a-product'),queue:await DB.localRecords.read('a-queue'),other:await DB.localRecords.read('b-product'),attempt:await DB.localRecords.read('payment-attempt:biz-a:owner'),message:await DB.localRecords.read('message-active:biz-a:owner'),otherMessage:await DB.localRecords.read('message-active:biz-b:owner'),origin:manager.capture(),legacyQueue:JSON.parse(localStorage.getItem('adiFestaFirestoreQueue_v1')),global:[localStorage.getItem('PrimeDocs:data'),localStorage.getItem('TaxPress:data'),localStorage.getItem('firebase:authUser:qa')],oldCart:sessionStorage.getItem('veconi:sale-draft:v1:biz-a:space-a'),otherCart:sessionStorage.getItem('veconi:sale-draft:v1:biz-b:space-b')}));
      assert.equal(result.old,null);assert.equal(result.queue,null);assert.equal(result.attempt,null);assert.equal(result.message,null);assert.ok(result.other&&result.otherMessage);
      assert.equal(result.origin.workspaceGeneration,5);assert.deepEqual(result.legacyQueue,[{businessId:'biz-b',id:'keep'}]);assert.deepEqual(result.global,['preserve','preserve','preserve']);assert.equal(result.oldCart,null);assert.equal(result.otherCart,'preserved cart');
    }
    assert.equal(await b.evaluate(()=>{try{manager.stamp({value:25},oldOrigin);return false;}catch(error){return error.code==='workspace-generation-mismatch';}}),true);
    // A cached/lower cloud generation must never trigger cleanup or roll the epoch back.
    assert.equal(await b.evaluate(async()=>{try{await manager.observe({businessId:'biz-a',workspaceGeneration:4,confirmedByServer:true});return false;}catch(error){return error.code==='stale-generation-response';}}),true);
    await a.evaluate(async()=>{
      await DB.localRecords.transaction('readwrite',(store,done)=>{store.put({key:'new-data',scope:'business-cache:v156:adiFestaDB_v1:biz-a:owner:sig',value:{id:'generation-5'}});done();});
      const records={...DB.localRecords,transaction:(mode,action)=>DB.localRecords.transaction(mode,(store,done,fail)=>{action(store,done,fail);if(mode==='readwrite')fail(Error('QA interrupted migration'));})};
      const interrupted=WorkspaceGenerationProtocol.create({records,localStorage,sessionStorage});
      try{await interrupted.observe({businessId:'biz-a',workspaceGeneration:6,confirmedByServer:true});throw Error('Unexpected success');}catch(error){if(error.message!=='QA interrupted migration')throw error;}
    });
    assert.equal(await a.evaluate(async()=>(await DB.localRecords.read('workspace-generation:biz-a')).workspaceGeneration),5);
    assert.ok(await a.evaluate(()=>DB.localRecords.read('new-data')));
    await a.evaluate(()=>manager.observe({businessId:'biz-a',workspaceGeneration:6,confirmedByServer:true}));
    assert.equal(await a.evaluate(()=>DB.localRecords.read('new-data')),null);
    const cacheContext=await browser.createBrowserContext(),first=await cacheContext.newPage(),stale=await cacheContext.newPage();
    await first.goto(`${base}/cache`);
    await first.evaluate(async()=>{
      await DB.useBusiness('biz-race',{uid:'owner',permissionSignature:'all'});
      DB.alterar(data=>data.produtos.push({id:'old-product',nome:'Old',preco:25}));await DB.flush();
    });
    await stale.goto(`${base}/cache`);
    await stale.evaluate(()=>DB.useBusiness('biz-race',{uid:'owner',permissionSignature:'all'}));
    await first.evaluate(async()=>{
      const manager=WorkspaceGenerationProtocol.create({records:DB.localRecords,localStorage,sessionStorage,onInvalidate:()=>DB.retireBusiness()});
      await manager.observe({businessId:'biz-race',workspaceGeneration:1,confirmedByServer:true});
      // Even if an obsolete version repopulates localStorage later, do not import it.
      localStorage.setItem('adiFestaDB_v1:biz-race',JSON.stringify({produtos:[{id:'resurrected'}]}));
      localStorage.setItem('adiFesta:biz-race:owner:all:syncQueue','[{"id":"old-sale"}]');
      await DB.useBusiness('biz-race',{uid:'owner',permissionSignature:'all',workspaceGeneration:1,migratePrivateCache:true});
    });
    assert.equal(await first.evaluate(()=>DB.carregar().produtos.length),0);
    assert.equal(await first.evaluate(()=>DB.businessCache.keyValue.getItem('adiFesta:biz-race:owner:all:syncQueue')),null);
    assert.equal(await stale.evaluate(async()=>{
      try{DB.alterar(data=>data.produtos.push({id:'late-old-tab'}));await DB.flush();return false;}
      catch(error){return error.code==='workspace-generation-mismatch';}
    }),true);
    assert.equal(await first.evaluate(async()=>(await DB.localRecords.list('business-cache:v156:adiFestaDB_v1:biz-race:owner:all')).length),0);
    // A retired generation cannot be saved again and must not trap reopening
    // behind the ordinary unsaved-work prompt.
    assert.equal(await stale.evaluate(()=>DB.businessCache.pending()),false);
    await stale.reload();
    assert.equal(await stale.evaluate(async()=>{try{await DB.useBusiness('biz-race',{uid:'owner',permissionSignature:'all'});return false;}catch(error){return error.code==='workspace-generation-mismatch';}}),true);
    await stale.evaluate(()=>DB.useBusiness('biz-race',{uid:'owner',permissionSignature:'all',workspaceGeneration:1}));
    assert.equal(await stale.evaluate(()=>DB.carregar().produtos.length),0);
    // Hold one tab after its preflight read while another commits the migration.
    // Repeating the same migration must not delete records from the new epoch.
    await first.evaluate(async()=>{
      window.releaseMigration=null;
      const delayed=WorkspaceGenerationProtocol.create({records:DB.localRecords,localStorage,sessionStorage,onInvalidate:()=>new Promise(resolve=>{window.releaseMigration=resolve;})});
      window.delayedMigration=delayed.observe({businessId:'biz-race',workspaceGeneration:2,confirmedByServer:true});
    });
    await first.waitForFunction(()=>typeof releaseMigration==='function');
    await stale.evaluate(async()=>{
      const other=WorkspaceGenerationProtocol.create({records:DB.localRecords,localStorage,sessionStorage,onInvalidate:()=>DB.retireBusiness()});
      await other.observe({businessId:'biz-race',workspaceGeneration:2,confirmedByServer:true});
      await DB.useBusiness('biz-race',{uid:'owner',permissionSignature:'all',workspaceGeneration:2});
      DB.alterar(data=>data.produtos.push({id:'new-generation-product',nome:'Keep',preco:25}));await DB.flush();
    });
    assert.equal(await first.evaluate(async()=>{releaseMigration();return(await delayedMigration).changed;}),false);
    await first.evaluate(()=>DB.retireBusiness());
    await first.evaluate(()=>DB.useBusiness('biz-race',{uid:'owner',permissionSignature:'all',workspaceGeneration:2}));
    assert.equal(await first.evaluate(()=>DB.carregar().produtos[0]?.id),'new-generation-product');
    // Integrate the page runtime with the real DB, including synchronous block
    // and reload-based recovery. No Firebase or production data is contacted.
    await first.addScriptTag({url:`${base}/js/workspace-runtime.js`});
    await first.evaluate(async()=>{
      window.stops=0;
      window.WorkspaceRuntime=WorkspaceRuntimeFactory.create({protocol:WorkspaceGenerationProtocol,records:DB.localRecords,localStorage,sessionStorage,stop:()=>stops++,retire:()=>DB.retireBusiness()});
      await WorkspaceRuntime.prepare({business:{id:'biz-race',workspaceGeneration:2},uid:'owner',confirmedByServer:true});
      WorkspaceRuntime.inspectRemote({id:'biz-race',workspaceGeneration:3,workspaceReset:{status:'COMPLETED'}},{fromCache:false});
    });
    assert.equal(await first.evaluate(()=>{try{DB.alterar(data=>data.produtos.push({id:'forbidden-late'}));return false;}catch(error){return error.code==='workspace-reload-required';}}),true);
    assert.equal(await first.evaluate(()=>stops),1);
    await first.reload();await first.addScriptTag({url:`${base}/js/workspace-runtime.js`});
    await first.evaluate(async()=>{
      window.WorkspaceRuntime=WorkspaceRuntimeFactory.create({protocol:WorkspaceGenerationProtocol,records:DB.localRecords,localStorage,sessionStorage,retire:()=>DB.retireBusiness()});
      await WorkspaceRuntime.prepare({business:{id:'biz-race',workspaceGeneration:3},uid:'owner',confirmedByServer:true});
      await DB.useBusiness('biz-race',{uid:'owner',permissionSignature:'all',workspaceGeneration:3});
    });
    assert.equal(await first.evaluate(()=>DB.carregar().produtos.length),0);
    console.log(JSON.stringify({ok:true,scope:'generation/IndexedDB/cache/page runtime; not reset UI E2E',isolatedDevices:2,sharedOriginTabs:2,staleCacheCommitRejected:true,legacyReimportBlocked:true,staleOriginRejected:true,otherBusinessesPreserved:true,otherAppsPreserved:true,reload:true,interruptedTransactionRollback:true,concurrentMigrationPreservesNewData:true,runtimeBlockAndReload:true}));
  }finally{await browser.close();server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;server.close();});
