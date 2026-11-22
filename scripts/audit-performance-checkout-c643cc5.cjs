'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { launch, setup, metrics, delta, save } = require('./performance-lab-helpers.cjs');
process.env.PUPPETEER_CORE_PATH ||= require.resolve('puppeteer-core');
const { caseServer, cleanup } = require('./homologate-flexible-services-v238.cjs');
const rounds = Number(process.env.PERF_ROUNDS || 3);
const rows = [];
const devices=[false,true].filter(mobile=>!process.env.PERF_CHECKOUT_PROFILE||process.env.PERF_CHECKOUT_PROFILE===(mobile?'mobile':'desktop'));

async function main() {
  const browser = await launch();
  try {
    for (const mobile of devices) for (let run=0;run<rounds;run++) {
      const c = await caseServer(mobile?390:1440), context=await browser.createBrowserContext(), page=await context.newPage();
      const errors=[];
      page.on('pageerror',error=>errors.push(error.message));
      page.setDefaultTimeout(16000);
      const timed = [];
      try {
        const cdp=await setup(page,{mobile,theme:'light',allowed:[c.url]});
        async function time(name,action) {
          const before=await metrics(cdp), start=performance.now();
          await action();
          timed.push({ name,ms:performance.now()-start,...delta(before,await metrics(cdp)) });
        }
        await page.goto(c.url);
        await page.waitForFunction(()=>window.qaHomologReady);
        await page.click('#qa-config');
        await page.type('[name="nome"]','Corrida QA');
        await page.select('[name="servicePricingModel"]','sale');
        await page.select('[name="serviceCostModel"]','km');
        await page.type('[name="custo"]','1.20');
        await page.$eval('[name="serviceFeePercent"]',input=>{input.value='10';});
        await page.click('[data-save-product]');
        await page.waitForFunction(()=>DB.carregar().produtos.some(p=>p.nome==='Corrida QA'));
        await page.evaluate(()=>qaDrain());
        const id=await page.evaluate(()=>DB.carregar().produtos.find(p=>p.nome==='Corrida QA').id);
        await page.click('#qa-selling');
        await time('executar-servico',async()=>{
          await page.click(`[data-add="${id}"]`);
          await page.waitForSelector('.flexible-service-modal');
        });
        for(const [name,value] of [['km','10'],['charge','30']]){
          const selector='[name="'+name+'"]';
          await page.$eval(selector,input=>{input.value='';});
          await page.type(selector,value);
        }
        await time('servico-para-carrinho',async()=>{
          await page.click('.flexible-service-modal .btn-primary');
          await page.click('#open-sale-summary');
          await page.waitForSelector('#pos-summary:not([hidden])');
        });
        const visible=selector=>page.evaluate(selector=>{
          const node=document.querySelector(selector);
          return Boolean(node?.offsetWidth&&node?.offsetHeight);
        },selector);
        if(await visible('[data-payment="dinheiro"]'))await page.$eval('[data-payment="dinheiro"]',node=>node.click());
        else {
          if(await visible('#desktop-continue-sale'))await page.$eval('#desktop-continue-sale',node=>node.click());
          await page.select('#sale-payment-method','dinheiro');
        }
        assert.equal(await page.$eval('#sale-payment-method',node=>node.value),'dinheiro');
        await time('concluir-ate-recibo-local',async()=>{
          await page.waitForSelector('#finish-sale',{visible:true});
          await page.$eval('#finish-sale',node=>node.click());
          await page.waitForSelector('.sale-receipt-paper');
          await page.evaluate(()=>DB.flush());
        });
        const local=await page.evaluate(()=>DB.carregar().vendas.at(-1));
        assert.equal(local.valorFinal,30);
        assert.equal(local.custoTotal,15);
        assert.equal(local.itens[0].serviceExecution.km,10);
        await time('drenar-ate-confirmacao-com-retentativa',async()=>{
          await page.evaluate(()=>qaDrain());
          await page.waitForFunction(()=>!SyncFirebase.isSalePending(DB.carregar().vendas.at(-1)));
        });
        const proof=await c.snapshot();
        assert.equal(proof.sales.length,1);
        assert.equal(proof.entries.length,1);
        assert.equal(proof.movements,0);
        assert.ok(proof.requests.some(r=>r.name==='getOperationalSyncReceipt'));
        await page.click('[data-sale-close]');
        await time('relatorio-ate-resposta-confirmada',async()=>{
          await page.click('#qa-performance');
          await page.waitForFunction(()=>PerformanceDashboard.state.complete&&!PerformanceDashboard.state.busy);
        });
        const reported=await page.evaluate(()=>PerformanceDashboard.state.last.current.revenue);
        assert.equal(reported,30);
        assert.deepEqual(errors,[]);
        rows.push({mobile,run,timed,queries:proof.requests.map(r=>r.name),confirmed:1});
        console.log(JSON.stringify(rows.at(-1)));
      } catch(error) {
        rows.push({mobile,run,timed,errors,fault:error.message});
        console.error(JSON.stringify(rows.at(-1)));
      } finally {
        save(process.env.PERF_CHECKOUT_OUTPUT||'checkout.json',rows);
        await context.close();
        await new Promise(resolve=>c.server.close(resolve));
      }
    }
  } finally { await browser.close();await cleanup(); }
  if(rows.some(r=>r.fault))process.exitCode=1;
}
main().catch(error=>{console.error(error);process.exitCode=1;});
