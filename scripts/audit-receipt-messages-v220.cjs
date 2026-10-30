'use strict';
// Disposable QA browser, memory-only fixtures. No commercial backend requests.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
const root=path.resolve(__dirname,'..'),out=process.env.RECEIPT_MESSAGES_QA_OUTPUT||path.join(root,'docs/qa/receipt-messages-v220/screenshots');
async function main(){
  fs.mkdirSync(out,{recursive:true});
  const server=http.createServer((req,res)=>{
    let rel=new URL(req.url,'http://qa.local').pathname;if(rel==='/')rel='/tests/fixtures/receipt-messages-v220.html';
    const file=path.resolve(root,'.'+rel);if(!file.startsWith(root+path.sep)||!/^\/(?:tests\/fixtures|js|css|assets)\//.test(rel)||!fs.existsSync(file)){res.writeHead(404).end();return;}
    res.writeHead(200,{'Content-Type':({'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream'}).end(fs.readFileSync(file));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
  let browser;const results=[],errors=[],blocked=[];
  try{
    browser=await puppeteer.launch({headless:true});const page=await browser.newPage();await page.setRequestInterception(true);
    page.on('request',r=>{if(new URL(r.url()).origin===origin&&r.method()==='GET')return r.continue();blocked.push({method:r.method(),host:new URL(r.url()).host});r.abort();});page.on('pageerror',e=>errors.push(e.message));
    async function visit(width,height){await page.setViewport({width,height,deviceScaleFactor:1,isMobile:width<768,hasTouch:width<768});await page.goto(origin,{waitUntil:'networkidle0'});}
    async function waitConfirmed(){await page.waitForFunction(()=>document.querySelector('#whatsapp-payment')&&!document.querySelector('#whatsapp-payment').disabled);}
    async function visible(selector){const e=await page.$(selector);await e.scrollIntoView();await page.evaluate(async()=>Promise.all(document.querySelector('#modal').getAnimations({subtree:true}).map(a=>a.finished.catch(()=>{}))));assert.ok(await e.evaluate(el=>{const r=el.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight+1&&el.contains(document.elementFromPoint(r.x+r.width/2,r.y+r.height/2));}),selector);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);}
    for(const [width,height]of [[1366,850],[768,1024],[390,844],[320,568],[390,360]]){
      await visit(width,height);await page.click('#qa-partial');await waitConfirmed();await page.click('[data-receipt-edit]');await page.waitForSelector('[data-receipt-send]');await visible('[data-receipt-send]');
      assert.match(await page.$eval('[data-receipt-preview]',e=>e.textContent),/164,00/);assert.equal(await page.evaluate(()=>qaEffects.writes),0);
      if(width===1366||width===390&&height===844)await page.screenshot({path:path.join(out,'receipt-preview-'+width+'.png')});results.push('preview-'+width+'x'+height);
      await page.click('[data-receipt-close]');
    }
    await visit(390,844);await page.click('#qa-pending');await page.waitForFunction(()=>document.querySelector('[data-receipt-check]')&&!document.querySelector('[data-receipt-check]').disabled);assert.equal(await page.$eval('#whatsapp-payment',e=>e.disabled),true);await page.screenshot({path:path.join(out,'receipt-pending-390.png')});results.push('pending-sharing-blocked');
    for(const [width,height]of [[1366,900],[390,844],[320,568],[390,360]]){
      await visit(width,height);await page.click('#qa-templates');await page.waitForSelector('[data-receipt-edit-model]');assert.equal(await page.$('[data-center-start]'),null);
      if(width===1366||width===390&&height===844)await page.screenshot({path:path.join(out,'message-center-'+width+'.png')});
      await page.click('[data-receipt-edit-model]');await page.waitForSelector('[data-receipt-model-save]');await visible('[data-receipt-model-save]');
      // Scroll body back for a useful composition while keeping sticky actions visible.
      await page.$eval('.viewport-scroll',e=>e.scrollTop=0);
      if(width===1366||width===390&&height===844)await page.screenshot({path:path.join(out,'template-editor-'+width+'.png')});
      await page.click('[data-receipt-model-save]');await page.waitForFunction(()=>document.querySelector('[data-receipt-feedback]').textContent.includes('Modelo salvo'));assert.equal(await page.evaluate(()=>qaData.pagamentos.length),1);assert.equal(await page.evaluate(()=>qaEffects.writes),1);results.push('editor-'+width+'x'+height);
    }
    await visit(1366,850);await page.click('#qa-total');await waitConfirmed();await page.click('[data-receipt-edit]');await page.waitForSelector('[data-receipt-send]');assert.match(await page.$eval('[data-receipt-preview]',e=>e.textContent),/saldo está quitado/);await page.click('[data-receipt-send]');await page.waitForFunction(()=>qaEffects.opens===1);assert.equal(await page.evaluate(()=>qaEffects.writes),0);results.push('total-confirmed-one-open-no-payment');
    assert.deepEqual(errors,[]);assert.deepEqual(blocked,[]);const report={at:new Date().toISOString(),passed:results.length,results,errors,externalRequests:blocked.length,realPaymentCreated:false,productionWrites:0,physicalAndroid:false};fs.writeFileSync(path.join(out,'RESULT.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));
  }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(JSON.stringify({failed:true,message:e.message,productionWrites:0}));process.exitCode=1;});
