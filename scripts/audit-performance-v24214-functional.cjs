'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { fixture } = require('./audit-performance-v24213.cjs');
const { assetServer, launch, listen, root, setup } = require('./performance-lab-helpers.cjs');

async function checkCharges(browser, base, width, theme) {
  const scope = await browser.createBrowserContext();
  try {
    const page = await scope.newPage(), errors = [];
    const mobile = width < 768;
    await setup(page, {mobile:false, theme, allowed:[base]});
    await page.setViewport({width, height:844, isMobile:mobile, hasTouch:mobile});
    await page.evaluateOnNewDocument(theme => localStorage.setItem('veconi-theme', theme),theme);
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(base + '/tests/charge-performance.html?visual=inicio&volume=large');
    await page.waitForFunction(() => document.body.dataset.visualReady === 'inicio');
    const result = await page.evaluate(async full => {
      const app = document.querySelector('#app');
      const navigate = async query => {
        const next = new Promise(resolve => addEventListener('hashchange',resolve,{once:true}));
        Router.ir('cobrancas?filtro=' + query);
        await next;
      };
      const ids = () => [...app.querySelectorAll('[data-batch-whatsapp]')].map(b=>b.dataset.batchWhatsapp);
      if (full) {
        DB.alterar(data=>{
          const client=data.clientes.find(c=>c.saldo<-10);
          data.cobrancas.push({id:'qa-today',clienteId:client.id,data:new Date().toISOString(),status:'ignorado'});
        });
        await DB.flush();
      }
      const snapshot = DB.carregar();
      const parity = [];
      if (full) for (const filter of ['todos','nunca','naoHoje','acima10','acima50','semTelefone']) {
        const last = c => snapshot.cobrancas.filter(row=>row.clienteId===c.id)
          .sort((a,b)=>new Date(b.data)-new Date(a.data))[0];
        const display = c => Clientes.financialStatus(c,undefined,{display:true}).saldo ?? Number(c.saldo);
        const filters = {
          nunca:c=>!last(c), naoHoje:c=>new Date(last(c)?.data).toDateString()!==new Date().toDateString(),
          acima10:c=>display(c)<-10, acima50:c=>display(c)<-50, semTelefone:c=>Utils.somenteNumeros(c.telefone).length<10,
        };
        const expected = snapshot.clientes.filter(c=>display(c)<0).sort((a,b)=>display(a)-display(b))
          .filter(filters[filter] || (()=>true)).map(c=>c.id);
        parity.push(expected.join(',')===Cobrancas.listar(filter).map(c=>c.id).join(','));
      }
      await navigate('naoHoje');
      const first = ids(), expected = Cobrancas.listar('naoHoje').map(c=>c.id);
      const totals = app.querySelector('.metrics').textContent;
      const money = Utils.dinheiro(expected.reduce((sum,id) => sum +
        Math.abs(Number(snapshot.clientes.find(c=>c.id===id).saldo||0)),0));
      const totalMatches = totals.includes(money) && totals.includes(String(expected.length));
      const next = app.querySelector('#charge-next');
      next.click();
      const second = ids(), label = app.querySelector('#charge-page').textContent;
      const totalsSame = totals === app.querySelector('.metrics').textContent, focus = document.activeElement.id;
      const viewScope = SpaceContext.viewScope;
      SpaceContext.viewScope = () => 'fixture-other-space';
      next.click();
      const scopeBlocked = ids().join(',') === second.join(',');
      SpaceContext.viewScope = viewScope;
      app.querySelector('#charge-previous').click();
      const firstRestored = first.join(',') === ids().join(',');
      const all = [...first];
      if (full) while (!next.disabled) { next.click(); all.push(...ids()); }
      await navigate('acima50');
      const filterOk=ids().join(',')===Cobrancas.listar('acima50').slice(0,24).map(c=>c.id).join(',');
      const pageWidth=document.documentElement.scrollWidth;
      let searchOutsideFirst = true;
      if (full) {
        const id=expected.at(-1), client=snapshot.clientes.find(row=>row.id===id);
        const changed=new Promise(resolve=>addEventListener('hashchange',resolve,{once:true}));
        Router.ir('clientes');
        await changed;
        const input=app.querySelector('#mobile-client-search');
        input.value=client.nome;
        input.dispatchEvent(new Event('input',{bubbles:true}));
        for (let i=0; i<40 && !app.querySelector('[data-mobile-card="'+CSS.escape(id)+'"]'); i++)
          await new Promise(resolve=>setTimeout(resolve,50));
        searchOutsideFirst=!first.includes(id) && !!app.querySelector('[data-mobile-card="'+CSS.escape(id)+'"]');
      }
      return {first:first.length,second:second.length,label,totalsSame,totalMatches,focus,scopeBlocked,firstRestored,parity,
        pageWidth,viewport:innerWidth,theme:document.documentElement.dataset.theme,filterOk,searchOutsideFirst,
        allReachable:!full || all.join(',')===expected.join(',')};
    },width === 390 && theme === 'light');
    assert.equal(result.first,24);
    assert.equal(result.second,24);
    assert.equal(result.focus,'charge-list');
    assert.equal(result.theme,theme);
    assert.match(result.label,/^Página 2 de /);
    for (const key of ['totalsSame','totalMatches','scopeBlocked','firstRestored','filterOk','allReachable','searchOutsideFirst'])
      assert.ok(result[key],[width,theme,key].join(' '));
    assert.ok(result.pageWidth<=result.viewport,[width,theme,result.pageWidth].join(' '));
    assert.ok(result.parity.every(Boolean));
    assert.deepEqual(errors,[]);
  } finally { await scope.close(); }
}

async function checkPersistence(browser, base) {
  const scope = await browser.createBrowserContext();
  try {
    const page = await scope.newPage();
    await setup(page,{mobile:false,theme:'light',allowed:[base]});
    await page.goto(base + '/tests/business-cache-v156.fixture.html?qa=previous');
    await page.evaluate(async () => {
      const key='adiFestaDB_v1:qa-previous:dev:scope';
      const cache=DB.businessCache;
      await cache.open(key,[],()=>({}));
      cache.stage({clientes:[{id:'c',saldo:-45,financialVersion:4,spaceId:'qa-a'}]},key);
      cache.keyValue.setItem('adiFesta:qa-previous:dev:scope:syncQueue','[{"operationId":"prev","status":"pending"}]');
      await DB.flush();
      await cache.release();
    });
    await page.goto(base + '/tests/business-cache-v156.fixture.html');
    await page.setOfflineMode(true);
    assert.deepEqual(await page.evaluate(async () => {
      const cache=DB.businessCache;
      const data=await cache.open('adiFestaDB_v1:qa-previous:dev:scope',[],()=>({}));
      await DB.flush();
      return [data.clientes[0].saldo,data.clientes[0].financialVersion,
        JSON.parse(cache.keyValue.getItem('adiFesta:qa-previous:dev:scope:syncQueue'))[0].operationId];
    }),[-45,4,'prev']);
    const result = await page.evaluate(async () => {
      const account='adiFestaDB_v1:qa-bench:dev:scope', queue='adiFesta:qa-bench:dev:scope:syncQueue';
      const scope='business-cache:v156:' + account, store=DB.localRecords, cache=DB.businessCache;
      const stage = data => cache.stage(data,account);
      const setQueue = ids => cache.keyValue.setItem(queue,JSON.stringify(ids.map(operationId=>({operationId,status:'pending'}))));
      const records = () => store.list(scope);
      const values = async field => (await records()).filter(row=>row.field===field&&row.kind==='item').map(row=>row.value);
      const revision = async () => (await records()).find(row=>row.kind==='meta').revision;
      const original = {clientes:[{id:'qa-client',spaceId:'qa-a',saldo:-40,financialVersion:10}],
        produtos:[{id:'qa-item',estoque:9,cost:{price:20},updatedAt:new Date('2026-01-01')}],
        vendas:[{id:'duplicate',amount:3},{id:'duplicate',amount:7},{amount:4}],pagamentos:[],movimentacoes:[]};
      await cache.open(account,[],()=>({}));
      stage(original);
      setQueue(['qa-sale']);
      original.produtos[0].cost.price=99;
      await DB.flush();
      const price=(await values('produtos'))[0].cost.price;

      let entered, resume;
      const running=new Promise(resolve=>{entered=resolve;});
      const paused=new Promise(resolve=>{resume=resolve;});
      let blocked=false;
      DB.localRecords={...store, async transaction(mode,callback) {
        if (mode==='readwrite'&&!blocked) { blocked=true; entered(); await paused; }
        return store.transaction(mode,callback);
      }};
      original.vendas.push({id:'qa-new',operationId:'qa-sale',spaceId:'qa-a',amount:40});
      original.produtos[0].estoque=8;
      stage(original);
      const first=DB.flush();
      await running;
      original.pagamentos.push({id:'qa-pay',spaceId:'qa-a',amount:5});
      original.movimentacoes.push({id:'qa-adjust',spaceId:'qa-b',tipo:'ajuste_saldo',amount:2});
      original.clientes[0].financialVersion=11;
      original.vendas.reverse();
      stage(original);
      setQueue(['qa-sale','qa-pay','qa-adjust']);
      resume();
      await first;
      DB.localRecords=store;
      await DB.flush();
      await cache.release();
      const saved=await cache.open(account,[],()=>({}));
      const before=await revision();
      stage(saved);
      setQueue(['qa-sale','qa-pay','qa-adjust']);
      await DB.flush();
      const noWrite=(await revision())===before;

      DB.localRecords={...store,transaction(mode,callback) {
        if (mode!=='readwrite') return store.transaction(mode,callback);
        return store.transaction(mode,(records,done,fail)=>{
          callback(records,done,fail);
          fail(new DOMException('fixture abort','QuotaExceededError'));
        });
      }};
      saved.pagamentos[0].amount=7;
      saved.pagamentos[0].details=undefined;
      saved.produtos[0].updatedAt=new Date('2026-02-01');
      stage(saved);
      setQueue(['qa-sale','qa-pay','qa-adjust','qa-retry']);
      let errorCode;
      try { await DB.flush(); } catch (error) { errorCode=error.code; }
      const aborted=[(await values('pagamentos'))[0].amount,(await values(queue)).length];
      DB.localRecords=store;
      await DB.flush();
      await cache.release();
      const restored=await cache.open(account,[],()=>({}));
      const queued=JSON.parse(cache.keyValue.getItem(queue)).map(item=>item.operationId);
      const pruned=structuredClone(restored);
      pruned.vendas.splice(2,1);
      delete pruned.movimentacoes;
      stage(pruned);
      await DB.flush();
      const remaining=(await values('vendas')).map(item=>item.amount).sort((a,b)=>a-b);
      const fieldRemoved=!(await records()).some(row=>row.field==='movimentacoes');
      await cache.open('adiFestaDB_v1:qa-other:dev:scope',[],()=>({}));
      return {price,noWrite,errorCode,aborted,queued,remaining,fieldRemoved,otherScope:cache.keyValue.peekItem(queue)===null,
        order:restored.vendas.map(s=>s.amount),stock:restored.produtos[0].estoque,
        version:restored.clientes[0].financialVersion,adjustmentSpace:restored.movimentacoes[0].spaceId,
        date:restored.produtos[0].updatedAt.toISOString(),receipt:restored.pagamentos[0].amount,
        ownField:Object.hasOwn(restored.pagamentos[0],'details')};
    });
    assert.deepEqual(result,{price:20,noWrite:true,errorCode:'indexeddb-quota',aborted:[5,3],
      queued:['qa-sale','qa-pay','qa-adjust','qa-retry'],otherScope:true,order:[40,4,7,3],stock:8,
      version:11,adjustmentSpace:'qa-b',date:'2026-02-01T00:00:00.000Z',receipt:7,ownField:true,
      remaining:[3,4,40],fieldRemoved:true});
  } finally { await scope.close(); }
}

async function main() {
  const previous=execFileSync('git',['show','f24c386:js/business-cache.js'],{encoding:'utf8'});
  const previousFixture=fs.readFileSync(path.join(root,'tests/business-cache-v156.fixture.html'),'utf8')
    .replace('business-cache.js','business-cache.js?qa=previous');
  const server=assetServer((url,request)=>{
    if (url==='/tests/charge-performance.html') return fixture;
    if (request.searchParams.get('qa')!=='previous') return null;
    if (url==='/js/business-cache.js') return previous;
    if (url==='/tests/business-cache-v156.fixture.html') return previousFixture;
    return null;
  });
  const base=await listen(server), browser=await launch();
  try {
    await checkPersistence(browser,base);
    console.log('IndexedDB: concorrência, retomada, escopo, ordem, recibo e operação sem mudança aprovados.');
    for (const width of [360,390,412,768,1366]) for (const theme of ['light','dark']) {
      await checkCharges(browser,base,width,theme);
      console.log('Cobranças aprovado:',width,theme);
    }
  } finally { await browser.close(); server.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
