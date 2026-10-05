'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
const root=process.cwd(),output=path.join(root,'artifacts/accounts-carousel-v162'),pause=ms=>new Promise(r=>setTimeout(r,ms));
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((req,res)=>{const name=new URL(req.url,'http://localhost').pathname,file=path.resolve(root,'.'+(name==='/'?'/tests/financial-module.fixture.html':name));if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();res.setHeader('Content-Type',mime[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);});
async function main(){
 fs.mkdirSync(output,{recursive:true});await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true}),page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 const url=`http://127.0.0.1:${server.address().port}/`,results=[];
 async function load(width){await page.setViewport({width,height:1000,isMobile:width<=780,hasTouch:width<=780});await page.goto(url,{waitUntil:'networkidle0'});await page.waitForSelector('.vac-slide.is-active');await pause(200);}
 async function aligned(){await pause(650);const value=await page.evaluate(()=>{const t=document.querySelector('.vac-track').getBoundingClientRect(),s=document.querySelector('.vac-slide.is-active').getBoundingClientRect();return{delta:Math.abs(s.x+s.width/2-t.x-t.width/2),key:document.querySelector('.vac-slide.is-active').dataset.carouselKey,view:FinanceiroUI.state().view,overflow:document.documentElement.scrollWidth-innerWidth};});assert.ok(value.delta<2,JSON.stringify(value));assert.ok(value.overflow<=1,JSON.stringify(value));return value;}
 try{
  for(const width of [320,360,375,390,412,430,1024,1280,1366,1440,1600,1920]){await load(width);results.push({width,...await aligned()});if(width<781){const peek=await page.evaluate(()=>{const track=document.querySelector('.vac-track').getBoundingClientRect(),next=document.querySelectorAll('.vac-card')[1].getBoundingClientRect();return Math.min(track.right,next.right)-Math.max(track.left,next.left);});assert.ok(peek>=8,`Missing mobile teaser at ${width}: ${peek}`);}}
  await load(1440);
  const summary=await page.$eval('.financial-home-summary',e=>e.innerText);
  await page.evaluate(()=>{window.__carouselReads=0;for(const name of ['loadDashboard','loadConsolidated','listFinancialAccounts','listCreditCards','getCreditCardInvoiceDetails']){const original=FinancialSpaceService[name];FinancialSpaceService[name]=(...args)=>{__carouselReads++;return original(...args);};}});
  await page.$eval('[data-carousel-key="c6"] [data-vac-action="details"]',b=>b.click());let value=await aligned();assert.equal(value.key,'c6');assert.equal(value.view,'dashboard');
  await page.screenshot({path:path.join(output,'1440-c6.png'),fullPage:true});
  await page.$eval('[data-carousel-key="inter"]',b=>b.click());assert.equal((await aligned()).key,'inter');await page.screenshot({path:path.join(output,'1440-inter.png'),fullPage:true});
  // Drag uses real pointer events, not changing scrollLeft directly.
  const box=await page.$eval('.vac-slide.is-active',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width*.8,y:r.y+130};});
  await page.mouse.move(box.x,box.y);await page.mouse.down();await page.mouse.move(box.x-260,box.y,{steps:18});await page.mouse.up();assert.equal((await aligned()).key,'c6');
  await page.focus('.vac-slide.is-active');await page.keyboard.press('ArrowRight');await aligned();await page.keyboard.press('Home');assert.equal((await aligned()).key,'inter');
  await page.hover('.vac-track');await page.mouse.wheel({deltaX:390,deltaY:0});assert.notEqual((await aligned()).key,'inter');
  assert.equal(await page.evaluate(()=>__carouselReads),0);assert.equal(await page.$eval('.financial-home-summary',e=>e.innerText),summary);
  await page.$eval('.vac-slide.is-active [data-vac-action="details"]',b=>b.click());await page.waitForSelector('.financial-institution-detail-head');assert.equal(await page.evaluate(()=>FinanceiroUI.state().view),'institution');
  await page.reload({waitUntil:'networkidle0'});await page.waitForSelector('.vac-slide.is-active');await aligned();
  await page.$eval('.vac-slide.is-active [data-vac-action="menu"]',b=>b.click());await page.waitForSelector('.financial-institution-action-sheet');assert.ok((await page.$eval('.financial-institution-action-sheet',e=>e.innerText)).includes('Atualizar saldo'));
  await load(390);const cdp=await page.createCDPSession(),touch=await page.$eval('.vac-slide.is-active',e=>{const r=e.getBoundingClientRect();return{x:r.x+r.width*.8,y:r.y+130};});
  await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[touch]});for(let n=1;n<=12;n++){await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:touch.x-n*18,y:touch.y}]});await pause(16);}await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});assert.notEqual((await aligned()).key,'inter');
  await page.$eval('[data-vac-page="0"]',b=>b.click());await aligned();await page.screenshot({path:path.join(output,'390-inter.png'),fullPage:true});
  await page.$eval('[data-financial-space-detail="personal"]',b=>b.click());await page.waitForFunction(()=>FinanceiroUI.state().activeViewId==='space:personal'&&!FinanceiroUI.state().loading);await page.waitForSelector('.vac-slide.is-active');await aligned();
  const availableKeys=await page.$$eval('.vac-slide',slides=>slides.map(s=>s.dataset.carouselKey));assert.equal(new Set(availableKeys).size,availableKeys.length);assert.equal(await page.evaluate(()=>FinanceiroUI.state().activeSpaceIds.length),1);
  // Dataset cardinality and UI-only navigation; no database or Firebase seed.
  for(const count of [0,1,2,3,8,12]){
   await page.evaluate(count=>{FinancialAccountsCarousel.destroy();const groups=Array.from({length:count},(_,i)=>({key:'qa-'+i,name:'Instituição QA '+i,accounts:[{type:'bank_account'}],cards:[],availableBalanceCents:i*100,invoiceTotalCents:0}));document.querySelector('.financial-home-institutions').innerHTML=FinancialAccountsCarousel.render(groups,FinancialEngine);FinancialAccountsCarousel.mount(document.querySelector('.veconi-accounts-carousel'),{scope:'qa-'+count});},count);
   if(!count){assert.ok(await page.$('[data-financial-add-product]'));continue;}await aligned();if(count===1){assert.equal(await page.$('.vac-navigation'),null);}else{await page.focus('.vac-slide.is-active');await page.keyboard.press('End');assert.equal((await aligned()).key,'qa-'+(count-1));}
   if(count>5)assert.equal(await page.$$eval('[data-vac-page]',list=>list.length),0);
  }
  await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.keyboard.press('Home');await aligned();assert.ok(await page.$eval('.vac-card',e=>getComputedStyle(e).transitionDuration.split(',').every(value=>parseFloat(value)<=.001)));
  assert.deepEqual(errors,[]);console.log(JSON.stringify({ok:true,widths:results,drag:'mouse and touch',snap:'center error <2px',trackpad:'horizontal wheel',keyboard:'arrows/Home/End',cardCounts:[0,1,2,3,8,12],details:true,actions:true,unchangedSummary:true,slideQueries:0,reducedMotion:true,reload:true,productionWrites:0,physicalAndroid:'not tested'}));
 }catch(e){await page.screenshot({path:path.join(output,'failure.png'),fullPage:true});throw e;}finally{await browser.close();server.close();}
}
main().catch(e=>{console.error(e.stack);server.close();process.exitCode=1;});
