'use strict';

const assert = require('node:assert/strict');
const {execFileSync} = require('node:child_process');
const {fixture} = require('./audit-performance-v24213.cjs');
const {assetServer, launch, setup, metrics, listen, save} = require('./performance-lab-helpers.cjs');

const variants = new Map();
for (const name of ['js/app.js','js/business-cache.js','js/cobrancas.js'])
  variants.set('/'+name, execFileSync('git',['show','f24c386:'+name],{encoding:'utf8'}));
let baseline = true;
const server = assetServer((url,request) => {
  if (url === '/tests/soak.html') {
    // Distinct request keys prevent the server's asset cache mixing versions.
    return baseline ? fixture.replace(/(src="(?:\.\.?\/|\/)?(js\/(?:app|business-cache|cobrancas)\.js))"/g,'$1?qa=base"') : fixture;
  }
  return request.searchParams.get('qa')==='base' ? variants.get(url) ?? null : null;
});

async function scenario(browser,base) {
  const context=await browser.createBrowserContext();
  const samples=[];
  try {
    const page=await context.newPage(), errors=[];
    const cdp=await setup(page,{mobile:false,theme:'light',allowed:[base]});
    await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(base+'/tests/soak.html?visual=inicio&volume=large&variant='+Number(baseline));
    await page.waitForFunction(()=>document.body.dataset.visualReady==='inicio');
    for (let batch=0;batch<=6;batch++) {
      if (batch>0) await page.evaluate(async batch=>{
        const key='adiFesta:desktop-shell-fixture:syncQueue';
        for (let n=0;n<16;n++) {
          const i=(batch-1)*16+n;
          DB.alterar(data=>{
            data.produtos[i].nome='Produto sintético '+i;
            data.clientes[i].observacoes='Cliente sintético '+i;
            data.vendas[i].observacoes='Venda sintética '+i;
          });
          DB.businessCache.keyValue.setItem(key,JSON.stringify([{operationId:'qa-'+i,status:'pending'}]));
          await DB.flush();
        }
        async function go(route) {
          const done=new Promise(resolve=>addEventListener('hashchange',resolve,{once:true}));
          Router.ir(route);
          await done;
          if (document.querySelector('#app')?.dataset.route!==route || document.querySelector('.boot-recovery'))
            throw Error('Falha ao montar '+route);
          await new Promise(requestAnimationFrame);
        }
        for (const route of ['vender','clientes','produtos','cobrancas','inicio']) await go(route);
      },batch);
      const before=await metrics(cdp);
      await cdp.send('HeapProfiler.collectGarbage');
      const after=await metrics(cdp);
      samples.push({writes:batch*16,observedMB:before.JSHeapUsedSize/1048576,
        retainedMB:after.JSHeapUsedSize/1048576,nodes:after.Nodes,listeners:after.JSEventListeners});
      console.log(JSON.stringify({variant:baseline?'V242.13':'V242.14',...samples.at(-1)}));
    }
    const durable=await page.evaluate(async()=>{
      await DB.businessCache.release();
      await DB.useBusiness('desktop-shell-fixture');
      const data=DB.carregar(), queued=DB.businessCache.keyValue.peekItem('adiFesta:desktop-shell-fixture:syncQueue');
      return {products:data.produtos.slice(0,96).filter((row,i)=>row.nome==='Produto sintético '+i).length,
        clients:data.clientes.slice(0,96).filter((row,i)=>row.observacoes==='Cliente sintético '+i).length,
        sales:data.vendas.slice(0,96).filter((row,i)=>row.observacoes==='Venda sintética '+i).length,
        queued:JSON.parse(queued)[0].operationId};
    });
    assert.deepEqual(durable,{products:96,clients:96,sales:96,queued:'qa-95'});
    assert.deepEqual(errors,[]);
    return {samples,durable};
  } finally {await context.close();}
}

(async()=>{
  const base=await listen(server), browser=await launch();
  try {
    const before=await scenario(browser,base);
    baseline=false;
    save('v24214-release-soak.json',{before,after:await scenario(browser,base)});
  } finally {await browser.close();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
