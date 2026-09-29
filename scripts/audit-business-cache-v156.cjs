/* Synthetic data only; real Chromium transactions and real origin quota. */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const puppeteer = require('puppeteer');

async function main() {
  const syncSource=fs.readFileSync('js/firebase/sync.js','utf8');
  const section=(start,end)=>syncSource.slice(syncSource.indexOf(start),syncSource.indexOf(end,syncSource.indexOf(start)));
  const syncRuntime=fs.readFileSync('tests/sync-persistence-v156.runtime.js','utf8')+'\n'+
    section('function traceSync(', 'function writeSyncTime(')+
    section('function cleanCloudItem(', 'function registerRealtimeCollection(')+
    section('async function pullCloudCollections(', 'async function ensureClientProjection(');
  const root = process.cwd(), server = http.createServer((req,res) => {
    if(req.url==='/sync-runtime.js'){res.setHeader('Content-Type','text/javascript');return res.end(syncRuntime)}
    const file = path.resolve(root, '.' + new URL(req.url,'http://localhost').pathname);
    if (!file.startsWith(root+path.sep) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.setHeader('Content-Type',file.endsWith('.html')?'text/html; charset=utf-8':'text/javascript');fs.createReadStream(file).pipe(res);
  });
  await new Promise(resolve => server.listen(0,'127.0.0.1',resolve));
  const browser = await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true});
  const url = `http://127.0.0.1:${server.address().port}/tests/business-cache-v156.fixture.html`, results=[];
  const page = await browser.newPage();
  const open = async (business='qa-v156') => page.evaluate(b=>DB.useBusiness(b,{uid:'owner',permissionSignature:'all'}),business);
  try {
    await page.goto(url);
    const seeded = await page.evaluate(() => {
      const at='2026-09-29T12:00:00.000Z', data={versao:14,config:{nome:'QA'},clientes:[],vendas:[],pagamentos:[],movimentacoes:[],produtos:[]};
      for(let i=0;i<126;i++)data.clientes.push({id:`c${i}`,nome:`QA ${i}`,saldo:-100,financialVersion:3,criadoEm:at,atualizadoEm:at});
      for(let i=0;i<338;i++)data.vendas.push({id:`s${i}`,operationId:`op${i}`,clienteId:`c${i%126}`,data:at,valorFinal:14,status:'fiado',itens:[],observacoes:'x'.repeat(6800)});
      for(let i=0;i<108;i++)data.pagamentos.push({id:`p${i}`,operationId:`pay${i}`,clienteId:`c${i%126}`,valor:10,data:at});
      for(let i=0;i<33;i++)data.movimentacoes.push({id:`a${i}`,operationId:`adj${i}`,tipo:'ajuste_saldo',clienteId:`c${i}`,saldoAnterior:-10,saldoNovo:-20,data:at});
      for(let i=0;i<47;i++)data.produtos.push({id:`product${i}`,nome:`Produto ${i}`,preco:14,estoqueAtual:10,criadoEm:at,atualizadoEm:at});
      data.vendas[0].observacoes += 'x'.repeat(2445688-JSON.stringify(data).length);
      data.vendas[0].observacoes = 'é'.repeat(5663)+data.vendas[0].observacoes.slice(5663);
      const raw=JSON.stringify(data);localStorage.setItem('adiFestaDB_v1:qa-v156:owner:all',raw);
      localStorage.setItem('PrimeDocs:keep','unrelated');localStorage.setItem('TaxPress:keep','unrelated');
      localStorage.setItem('adiFesta:qa-v156:owner:all:syncQueue',JSON.stringify([{queueId:'pending-1',operationId:'op-1',status:'pending',payload:{writes:[]}}]));
      return {documents:652,bytes:new Blob([raw]).size,utf16Bytes:raw.length*2};
    });
    await open();
    const migrated=await page.evaluate(async()=>({diagnostic:await DB.businessCache.diagnostic(),legacy:localStorage.getItem('adiFestaDB_v1:qa-v156:owner:all'),counts:[DB.carregar().clientes.length,DB.carregar().vendas.length,DB.carregar().pagamentos.length,DB.carregar().movimentacoes.length],other:localStorage.getItem('PrimeDocs:keep')}));
    assert.equal(migrated.legacy,null);assert.equal(migrated.diagnostic.migration.verified,true);assert.equal(migrated.diagnostic.migration.removed,true);
    assert.deepEqual(migrated.counts,[126,338,108,33]);assert.equal(migrated.other,'unrelated');
    results.push({case:'652-document legacy migration verified before deletion',...seeded,records:migrated.diagnostic.records});
    const full=await page.evaluate(()=>{let n=0;try{while(n<100)localStorage.setItem(`other-app-quota-${n++}`,'x'.repeat(100000))}catch(e){return e.name}});
    assert.equal(full,'QuotaExceededError');
    const delta=await page.evaluate(async()=>{
      DB.alterar(d=>d.clientes[0].saldo=-125);await DB.flush();
      return (await DB.businessCache.diagnostic()).lastCommit;
    });
    assert.equal(delta.written,1);results.push({case:'localStorage full; one changed document writes one row',...delta});
    await page.reload();await open();assert.equal(await page.evaluate(()=>DB.carregar().clientes[0].saldo),-125);
    await page.setOfflineMode(true);await page.evaluate(async()=>{DB.alterar(d=>d.clientes[1].observacoes='offline saved');await DB.flush()});await page.setOfflineMode(false);
    await page.reload();await open();assert.equal(await page.evaluate(()=>DB.carregar().clientes[1].observacoes),'offline saved');
    results.push({case:'reload and offline durability',passed:true});
    const atomic=await page.evaluate(async()=>{
      const original=DB.localRecords;window.__records=original;
      DB.localRecords={...original,transaction:async(mode,action)=>mode!=='readwrite'?original.transaction(mode,action):original.transaction(mode,(store,done,fail)=>{action(store,done,fail);fail(new DOMException('synthetic transaction interruption','QuotaExceededError'))})};
      DB.alterar(d=>{d.vendas.push({id:'uncommitted',operationId:'uncommitted',itens:[],valorFinal:25});d.clientes[0].saldo=-150});
      DB.businessCache.keyValue.setItem('adiFesta:qa-v156:owner:all:syncQueue',JSON.stringify([{queueId:'atomic',operationId:'uncommitted',status:'pending'}]));
      let code;try{await DB.flush()}catch(e){code=e.code}
      const rows=await original.list('business-cache:v156:adiFestaDB_v1:qa-v156:owner:all');
      return {code,sale:rows.some(r=>r.value?.id==='uncommitted'),balance:rows.find(r=>r.area==='data'&&r.field==='clientes'&&r.value?.id==='c0').value.saldo};
    });
    assert.equal(atomic.code,'indexeddb-quota');assert.equal(atomic.sale,false);assert.equal(atomic.balance,-125);
    await page.evaluate(async()=>{DB.localRecords=__records;await DB.flush()});
    await page.reload();await open();assert.equal(await page.evaluate(()=>DB.carregar().vendas.filter(s=>s.id==='uncommitted').length),1);
    assert.equal(await page.evaluate(()=>JSON.parse(DB.businessCache.keyValue.getItem('adiFesta:qa-v156:owner:all:syncQueue'))[0].operationId),'uncommitted');
    results.push({case:'aborted transaction preserves old sale/balance/queue; retry exactly once',...atomic});
    // Stale tab must not overwrite a later durable revision.
    const tab=await browser.newPage();await tab.goto(url);await tab.evaluate(()=>DB.useBusiness('qa-v156',{uid:'owner',permissionSignature:'all'}));
    await page.evaluate(async()=>{DB.alterar(d=>d.clientes[2].saldo=-200);await DB.flush()});
    const conflict=await tab.evaluate(async()=>{DB.alterar(d=>d.clientes[2].saldo=-300);try{await DB.flush();return 'unexpected'}catch(e){return e.code}});
    assert.equal(conflict,'local-cache-conflict');await tab.close();results.push({case:'stale tab rejected without overwriting',code:conflict});
    // Larger data set has no native Storage.setItem business snapshots at all.
    await open('qa-scale');
    const scale=await page.evaluate(async()=>{
      const at='2026-09-29T12:00:00Z';DB.alterar(d=>{
        d.clientes=Array.from({length:1000},(_,i)=>({id:`c${i}`,nome:`QA ${i}`,saldo:0,criadoEm:at,atualizadoEm:at}));
        d.vendas=Array.from({length:5000},(_,i)=>({id:`s${i}`,operationId:`op${i}`,clienteId:`c${i%1000}`,valorFinal:10,status:'pago',data:at,itens:[],observacoes:'x'.repeat(1200)}));
      });await DB.flush();const size=new Blob([JSON.stringify(DB.carregar())]).size;
      DB.alterar(d=>d.vendas[4000].observacoes='one edit');await DB.flush();
      const diag=await DB.businessCache.diagnostic();return {size,records:diag.records,written:diag.lastCommit.written};
    });assert.ok(scale.size>5000000);assert.equal(scale.written,1);results.push({case:'1000 customers / 5000 sales incremental persistence',...scale});
    await page.reload();await open('qa-scale');assert.equal(await page.evaluate(()=>DB.carregar().vendas.length),5000);
    // Migration interrupted after its first commit, before verified cleanup.
    await page.evaluate(()=>{for(const key of Object.keys(localStorage))if(key.startsWith('other-app-quota-'))localStorage.removeItem(key);localStorage.setItem('adiFestaDB_v1:qa-interrupted:owner:all',JSON.stringify({versao:14,config:{nome:'QA interrupted'},clientes:[{id:'safe',saldo:-12}],vendas:[],pagamentos:[],movimentacoes:[],produtos:[]}));const base=DB.localRecords;let lists=0;DB.localRecords={...base,list:async scope=>{if(scope.includes('qa-interrupted')&&++lists===2)throw Error('synthetic suspension');return base.list(scope)}}});
    await assert.rejects(open('qa-interrupted'),/suspension/);
    assert.ok(await page.evaluate(()=>localStorage.getItem('adiFestaDB_v1:qa-interrupted:owner:all')));
    await page.reload();await open('qa-interrupted');assert.equal(await page.evaluate(()=>DB.carregar().clientes[0].saldo),-12);
    assert.equal(await page.evaluate(()=>localStorage.getItem('adiFestaDB_v1:qa-interrupted:owner:all')),null);
    results.push({case:'interrupted migration resumes, verifies and removes only exact legacy key',passed:true});
    await page.addScriptTag({url:'/sync-runtime.js'});
    const pull=await page.evaluate(async()=>{
      remote={clients:[{id:'safe',nome:'QA',saldo:-99,financialVersion:4,updatedAt:'2026-09-29T12:00:00Z'}],sales:[{id:'cloud-sale',operationId:'cloud-op',clienteId:'safe',valorFinal:20,itens:[],data:'2026-09-29T12:00:00Z'}]};
      await pullCloudCollections({force:true,full:true});
      const first={balance:DB.carregar().clientes[0].saldo,cursor:readPullState()['qa-interrupted:clients'],stage:state.syncTrace.find(row=>row.stage==='persisting_cloud_snapshot')};
      remote.clients[0]={...remote.clients[0],saldo:-114,financialVersion:5,updatedAt:'2026-09-29T13:00:00Z'};
      await pullCloudCollections({force:true});
      return {first,after:DB.carregar().clientes[0].saldo,incremental:networkCalls.filter(row=>row[1]==='incremental').length};
    });assert.equal(pull.first.balance,-99);assert.equal(pull.after,-114);assert.equal(pull.first.stage.service,'IndexedDB');assert.ok(pull.incremental>=2);
    results.push({case:'production cloud pull, canonical merge, incremental query and durable cursor',...pull});
    const failedPull=await page.evaluate(async()=>{
      const before=readPullState()['qa-interrupted:clients'],base=DB.localRecords;
      DB.localRecords={...base,transaction:(mode,action)=>mode==='readwrite'?Promise.reject(new DOMException('synthetic quota','QuotaExceededError')):base.transaction(mode,action)};
      remote.clients[0]={...remote.clients[0],saldo:-200,updatedAt:'2026-09-29T14:00:00Z'};
      let detail;try{await pullCloudCollections({force:true})}catch(e){detail=e.syncDetail}
      const result={before,after:readPullState()['qa-interrupted:clients'],detail};DB.localRecords=base;await DB.flush();return result;
    });assert.equal(failedPull.before,failedPull.after);assert.equal(failedPull.detail.stage,'persisting_cloud_snapshot');assert.equal(failedPull.detail.code,'indexeddb-quota');
    results.push({case:'failed persistence never advances incremental cursor',...failedPull});
    console.log(JSON.stringify({passed:results.length,results},null,2));
  } finally { await browser.close();server.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1});
