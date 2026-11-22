'use strict';
const { routeFixture } = require('./audit-performance-runtime-c643cc5.cjs');
const { assetServer, launch, setup, metrics, delta, listen, save } = require('./performance-lab-helpers.cjs');
const server=assetServer(file=>file==='/tests/performance-lab-shell.html'?routeFixture:null);
const rows=[];

async function main() {
  const base=await listen(server), browser=await launch();
  try {
    for(const motion of ['no-preference','reduce'])for(let run=0;run<3;run++){
      const context=await browser.createBrowserContext(),page=await context.newPage();
      try {
        const cdp=await setup(page,{mobile:true,theme:'light',allowed:[base]});
        await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:motion}]);
        await page.evaluateOnNewDocument(()=>{
          window.__animationEvents=[];
          addEventListener('animationstart',event=>window.__animationEvents.push({name:event.animationName,at:performance.now()}),true);
        });
        await page.goto(base+'/tests/performance-lab-shell.html?visual=inicio');
        await page.waitForFunction(()=>document.body.dataset.visualReady==='inicio');
        const before=await metrics(cdp);
        const count=await page.evaluate(async()=>{
          await new Promise(resolve=>setTimeout(resolve,1500));
          return {animationEvents:window.__animationEvents.filter(e=>e.name.startsWith('vf-')),adjusted:matchMedia('(prefers-reduced-motion: reduce)').matches};
        });
        rows.push({run,motion,...count,...delta(before,await metrics(cdp))});
        save('motion.json',rows);
      } finally {await context.close();}
    }
  } finally {await browser.close();server.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
