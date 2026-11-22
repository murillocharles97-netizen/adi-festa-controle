// Usage: node scripts/bench-vitrine-viva.cjs <V242.4 checkout> [repetitions]
const path=require('node:path'),fs=require('node:fs'),assert=require('node:assert/strict');
const kit=require('./loja-qa-kit.cjs'),model=require('../functions/src/shared/online-store');
const baseline=process.argv[2], rounds=Number(process.argv[3]||5);
if(!baseline)throw Error('Informe o checkout da base V242.4.');
const baseKit=require(path.resolve(baseline,'scripts/loja-qa-kit.cjs'));
const token='qa_performance_public_vitrine_000000';
const settings=model.settings({publicName:'Papelaria QA',contactPhone:'11900000000',pickupEnabled:true});
const doc={...settings,publicSettings:settings,schemaVersion:6,catalogType:'space_store',catalogToken:token,documentId:token,
  businessId:'qa-business',spaceId:'qa-store',visitId:'qa-store-public',active:true,catalogVisible:true,acceptingOrders:false,
  items:Array.from({length:400},(_,i)=>model.product({id:'qa-'+i,nome:'Caderno '+String(i+1).padStart(3,'0'),categoria:'Papelaria',preco:11,estoqueAtual:10}))};
async function sample(browser,server,width){
  const ctx=await browser.createBrowserContext(),p=await ctx.newPage();
  try{
    await kit.interceptImages(p);await p.setViewport({width,height:844});await p.emulateCPUThrottling(width===390?4:1);
    await p.evaluateOnNewDocument((token,doc)=>{
      window.__QA_DOCS__={['publicCatalogs/'+token]:doc};
      const observer=new MutationObserver(()=>{if(document.querySelector('.sf-grid .sf-card')){observer.disconnect();
        requestAnimationFrame(()=>requestAnimationFrame(()=>{window.qaReady=performance.now();}));}});
      observer.observe(document,{childList:true,subtree:true});
    },token,doc);
    await p.goto(server.base+'/catalogo.html?v='+token,{waitUntil:'domcontentloaded'});await p.waitForFunction(()=>window.qaReady);
    const result=await p.evaluate(()=>({paintMs:Math.round(qaReady),cards:document.querySelectorAll('.sf-card').length,nodes:document.querySelectorAll('.sf *').length}));
    result.searchMs=await p.evaluate(()=>new Promise(resolve=>{
      const start=performance.now(),observer=new MutationObserver(()=>{
        if(document.querySelectorAll('.sf-grid .sf-card').length===1){observer.disconnect();requestAnimationFrame(()=>requestAnimationFrame(()=>resolve(Math.round(performance.now()-start))));}
      });observer.observe(document.querySelector('#sf-main'),{childList:true});const input=document.querySelector('#sf-search');input.value='Caderno 400';input.dispatchEvent(new Event('input',{bubbles:true}));
    }));
    return result;
  }finally{await ctx.close();}
}
(async()=>{
  const base=await baseKit.serve(),candidate=await kit.serve(),browser=await kit.launch(),results={};
  try{
    for(const width of [390,1440]){
      const samples={base:[],candidate:[]};
      for(let n=0;n<rounds;n++)for(const key of n%2?['candidate','base']:['base','candidate'])
        samples[key].push(await sample(browser,key==='base'?base:candidate,width));
      const byKey={};
      for(const [key,runs] of Object.entries(samples)){
        const stats={};for(const metric of Object.keys(runs[0])){const values=runs.map(r=>r[metric]).sort((a,b)=>a-b);
          stats[metric]={median:values[Math.floor(values.length/2)],min:values[0],max:values.at(-1)};}
        byKey[key]={stats,runs};
      }
      assert.equal(byKey.candidate.stats.cards.max,36);results[width]=byKey;
    }
    const dir=path.resolve('qa-artifacts/vitrine-viva');fs.mkdirSync(dir,{recursive:true});
    fs.writeFileSync(path.join(dir,'benchmark.json'),JSON.stringify(results,null,2));console.log(JSON.stringify(Object.fromEntries(Object.entries(results).map(([w,r])=>[w,[r.base.stats,r.candidate.stats]]))));
  }finally{await browser.close();base.server.close();candidate.server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
