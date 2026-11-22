'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const {execFileSync} = require('node:child_process');
const puppeteer = require('puppeteer-core');

const root = path.resolve(__dirname, '..');
const out = path.join(root, 'qa-artifacts/v2421/painel');
fs.mkdirSync(out, {recursive:true});
const baseline = new Map();
function source(file, before) {
  if (!before || !['index.html','js/firebase/firebase-ui.js','css/firebase.css'].includes(file))
    return fs.readFileSync(path.join(root,file),'utf8');
  if (!baseline.has(file))
    baseline.set(file,execFileSync('git',['show','eea6178:'+file],{cwd:root,encoding:'utf8'}));
  return baseline.get(file);
}
const records = [0,1,2].map(n=>({
  operationId:'qa-historical-'+n, entityType:'transaction', action:'sale', status:'error',
  activeError:true, originalStatus:'error', reviewReason:'service_configuration_missing',
  replayBlocked:true, canRetry:false, documentId:'qa-sale-'+n, businessId:'qa-tenant',
  createdAt:'2026-11-19T21:00:00Z', lastAttemptAt:'2026-11-19T21:01:00Z',
  errorCode:'failed-precondition', errorMessage:'Configuração original de custo indisponível.',
  payloadChecksum:'fixture-'+n, paths:['businesses/qa-tenant/sales/qa-sale-'+n], origin:'mobile'
}));
const archived = ['resolved','archived'].map(reviewState=>({
  operationId:'qa-'+reviewState,reviewState,category:reviewState,status:reviewState,
  errorCode:'failed-precondition',errorMessage:'Registro fictício preservado.',payloadChecksum:'qa-checksum',
  resolution:{status:'closed_without_effects'}
}));
const baselineState = {
  status:'error', message:'Sincronização incompleta: 3 alteração(ões) com erro e 0 pendente(s).',
  errors:3, pending:0, queueTotal:3, orphanOperations:0, archivedOccurrences:2,
  lastSync:'2026-11-19T11:13:59Z',
  details:{listenerConnected:true,userBusinessId:'qa-tenant',projectId:'demo-veconi',queueErrors:records}
};
const stub = 'window.items='+JSON.stringify([...records,...archived])+';window.fixture='+JSON.stringify(baselineState)+';'+
  'window.SyncFirebase={refreshQueueStatus:()=>fixture,getQueueDiagnostics:()=>items,exportSyncDiagnostic:()=>{},synchronizeNow:async()=>{throw Error("QA: envio não permitido");}};';
const server = http.createServer((req,res)=>{
  const url = new URL(req.url,'http://127.0.0.1'), before = url.searchParams.get('base')==='1';
  if (url.pathname==='/') {
    const css = source('index.html',before).match(/<link[^>]+rel="stylesheet"[^>]*>/g)
      .join('').replace(/href="\.\/([^"?]+)(?:\?[^"]*)?"/g,(_m,file)=>'href="/'+file+(before?'?base=1':'')+'"');
    res.setHeader('Content-Type','text/html');
    return res.end('<!doctype html><html data-theme="'+(url.searchParams.get('theme')==='dark'?'dark':'light')+
      '"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">'+css+
      '</head><body><main id="app" data-route="configuracoes"></main><div id="modal"></div><script>'+stub+
      '</script><script src="/assets/lucide.min.js"></script><script src="/qa-ui.js'+(before?'?base=1':'')+
      '"></script><script>openHeaderPanel();</script></body></html>');
  }
  if (url.pathname==='/qa-ui.js') {
    res.setHeader('Content-Type','text/javascript');
    return res.end(source('js/firebase/firebase-ui.js',before).replace(/^import .*?;\r?$/gm,''));
  }
  const file = path.resolve(root,'.'+url.pathname);
  if (!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()) return res.writeHead(404).end();
  const extension=path.extname(file);
  res.setHeader('Content-Type',({'.css':'text/css','.js':'text/javascript','.woff2':'font/woff2'})[extension]||'application/octet-stream');
  if (before&&url.pathname==='/css/firebase.css')return res.end(source('css/firebase.css',true));
  fs.createReadStream(file).pipe(res);
});

async function main(){
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
  const results=[];
  try{
    for(const [before,theme,width] of [true,false].flatMap(before=>['light','dark'].flatMap(theme=>[360,390,412].map(width=>[before,theme,width])))){
      const page=await browser.newPage();
      const errors=[];
      page.on('pageerror',e=>errors.push(e.message));
      await page.setRequestInterception(true);
      page.on('request',r=>r.url().startsWith(base+'/')?r.continue():r.abort());
      await page.setViewport({width,height:800,isMobile:true,hasTouch:true});
      await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);
      await page.goto(base+'/?theme='+theme+(before?'&base=1':''),{waitUntil:'domcontentloaded'});
      await page.waitForSelector('#cloud-panel-details');
      const prefix=(before?'antes':'depois')+'-'+theme+'-'+width;
      if(!before){
        assert.match(await page.$eval('[data-cloud-status]',n=>n.textContent),/3 operações históricas/);
        assert.equal(await page.$eval('[data-cloud-errors]',n=>n.textContent),'0');
        assert.equal(await page.$eval('[data-cloud-pending]',n=>n.textContent),'0');
        assert.equal(await page.$eval('[data-cloud-resolved]',n=>n.textContent),'2');
        assert.equal(await page.$eval('.cloud-panel-icon',n=>n.classList.contains('is-error')),false);
      }
      await page.screenshot({path:path.join(out,prefix+'-resumo.png')});
      await page.click('#cloud-panel-details');
      await page.waitForSelector('.sync-diagnostics-modal');
      if(!before){
        await page.click('.sync-blocked-history summary');
        assert.equal(await page.$$eval('.sync-blocked-history article',v=>v.length),3);
        assert.equal(await page.$$eval('.sync-active-errors article',v=>v.length),0);
        assert.equal(await page.$eval('[data-retry-all]',el=>el.disabled),true);
      }else await page.$eval('.sync-diagnostics-modal',m=>m.scrollTop=0);
      await page.screenshot({path:path.join(out,prefix+'-detalhes.png')});
      const measured=await page.evaluate(candidate=>{
        const modal=document.querySelector('.sync-diagnostics-modal'), body=modal.querySelector('.modal-body'), footer=modal.querySelector('.modal-foot');
        const children=[...footer.querySelectorAll('button')],m=modal.getBoundingClientRect();
        const outside=children.some(button=>{
          const r=button.getBoundingClientRect();
          if(!candidate)return r.left<m.left||r.right>m.right||button.scrollWidth>button.clientWidth+1;
          return r.left<m.left||r.right>m.right||r.bottom>innerHeight||
            r.height<44||button.scrollWidth>button.clientWidth+1;
        });
        const rects=children.map(b=>b.getBoundingClientRect()),overlap=rects.some((a,i)=>rects.slice(i+1).some(b=>
          Math.min(a.right,b.right)-Math.max(a.left,b.left)>1&&Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)>1));
        const y=footer.getBoundingClientRect().top;
        body.scrollTop=body.scrollHeight;
        const verticallyScrollable=body.scrollTop>0;
        const footerFixed=Math.abs(footer.getBoundingClientRect().top-y)<1;
        const clickable=children.filter(b=>!b.disabled).every(b=>{
          const r=b.getBoundingClientRect();return b.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));
        });
        const bottom=innerHeight-m.bottom;
        const safePadding=getComputedStyle(modal.parentElement).paddingBottom;
        return {outside,overlap,verticallyScrollable,footerFixed,clickable,bottom,safePadding};
      },!before);
      results.push({before,theme,width,...measured});
      if(!before){
        assert.deepEqual(measured,{outside:false,overlap:false,verticallyScrollable:true,footerFixed:true,clickable:true,bottom:measured.bottom,safePadding:measured.safePadding},prefix);
        assert.ok(measured.bottom>=8);
        await page.screenshot({path:path.join(out,prefix+'-rolagem.png')});
        await page.click('[data-open-technical]');
        assert.ok(await page.$('[data-sync-technical]'));
        const extra=await page.evaluate(()=>{
          const snapshot=JSON.stringify(items);
          const show=state=>VeconiSyncPanelView(state);
          const recent={...items[0],operationId:'qa-recent',createdAt:'2026-11-21T15:00:00Z'};
          const unknown={...items[0],operationId:'qa-unknown',createdAt:''};
          const mixed={...fixture,errors:5,pending:1,details:{queueErrors:[...fixture.details.queueErrors,recent,unknown]}};
          const sameFailure={stage:'server_operational_commit',operationId:items[0].operationId,businessId:items[0].businessId,code:'functions/failed-precondition'};
          return {
            mixed:show(mixed),corrupt:show({...fixture,message:'Fila local ilegível',details:{queueErrors:[]}}),
            offline:show({...fixture,status:'offline',message:'Offline'}).status,
            network:show({...fixture,syncFailure:{stage:'listener',message:'Conexão interrompida'}}).status,
            known:show({...fixture,syncFailure:sameFailure}).historicalStatus,
            pending:show({...fixture,pending:1}).message,
            intact:snapshot===JSON.stringify(items)
          };
        });
        assert.equal(extra.mixed.errors,2);
        assert.equal(extra.mixed.pending,1);
        assert.equal(extra.mixed.status,'error');
        assert.match(extra.pending,/aguardando envio/);
        assert.equal(extra.corrupt.status,'error');
        assert.equal(extra.offline,'offline');
        assert.equal(extra.network,'error');
        assert.ok(extra.known&&extra.intact);
        await page.click('.sync-diagnostics-modal footer .close');
        assert.equal(await page.$('.sync-diagnostics-modal'),null);
        await page.evaluate(()=>{
          const newError={...items[0],operationId:'qa-novo',createdAt:'2026-11-21T15:00:00Z'};
          items.push(newError,{operationId:'qa-sendable',status:'pending',canRetry:true});
          fixture.errors=4;fixture.pending=1;fixture.details.queueErrors.push(newError);
          openQueueDetails();
        });
        assert.equal(await page.$$eval('.sync-active-errors article',v=>v.length),1);
        assert.equal(await page.$eval('[data-retry-all]',el=>el.disabled),false);
        assert.match(await page.$eval('[data-retry-all]',el=>el.textContent),/Sincronizar pendentes/);
      }
      assert.deepEqual(errors,[]);
      await page.close();
    }
    assert.ok(results.some(r=>r.before&&r.outside),'baseline overflowing actions should reproduce');
    console.log(JSON.stringify(results));
  }finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(results,null,2));await browser.close();server.close();}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
