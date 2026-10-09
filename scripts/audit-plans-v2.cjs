'use strict';
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict'),puppeteer=require('puppeteer');
const root=process.cwd(),out=path.resolve('artifacts/plans-v2');fs.mkdirSync(out,{recursive:true});
const server=http.createServer((req,res)=>{const pathname=new URL(req.url,'http://localhost').pathname;
 if(pathname==='/'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="css/style.css"><link rel="stylesheet" href="css/plans.css"><link rel="stylesheet" href="css/design-system/veconi-theme.css"><main id="app" style="padding:16px"></main><div id="modal"></div><script src="assets/lucide.min.js"></script><script src="functions/src/shared/plan-catalog.js"></script><script src="js/plans.js"></script>');}
 const file=path.resolve(root,'.'+pathname);if(!file.startsWith(root+path.sep)||!fs.existsSync(file))return res.writeHead(404).end();res.setHeader('Content-Type',path.extname(file)==='.js'?'text/javascript':path.extname(file)==='.css'?'text/css':'application/octet-stream');fs.createReadStream(file).pipe(res);
});
async function main(){await new Promise(r=>server.listen(0,'127.0.0.1',r));const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe'});try{const page=await browser.newPage();await page.setViewport({width:390,height:844});await page.goto('http://127.0.0.1:'+server.address().port);await page.evaluate(source=>(0,eval)(source),fs.readFileSync('js/firebase/business-context.js','utf8').replace(/^export /gm,''));
 await page.evaluate(()=>{BusinessContext.set({business:{id:'qa',active:true,subscription:{planId:'essential',status:'active'}},userProfile:{uid:'qa',businessId:'qa',role:'owner',active:true}});document.querySelector('#app').innerHTML=PlansUI.render();PlansUI.bind(document.querySelector('#app'));});
 const prices=()=>page.$$eval('[data-price-value]',els=>els.map(e=>e.textContent));assert.deepEqual(await prices(),['29,90','59,90','119,90']);
 await page.click('[data-billing-period=yearly]');await page.waitForFunction(()=>[...document.querySelectorAll('[data-price-value]')].map(e=>e.textContent).join('|')==='23,92|47,92|95,92');assert.deepEqual(await prices(),['23,92','47,92','95,92']);
 assert.match(await page.$eval('[data-plan-card=premium] [data-period-note]',e=>e.textContent),/1.151,04/);
 await page.click('[data-plan-cta=professional]');assert.match(await page.$eval('.plan-payment-summary',e=>e.textContent),/575,04/);await page.click('[data-close-payment]');
 const layoutResults=[];
 const centered=async index=>page.waitForFunction(i=>{const rail=document.querySelector('[data-plans-carousel]').getBoundingClientRect(),card=document.querySelectorAll('[data-plan-card]')[i].getBoundingClientRect();return Math.abs(card.left+card.width/2-rail.left-rail.width/2)<2;},{},index);
 for(const width of [320,360,375,390,412,430,768,820,1024,1440]){
  await page.setViewport({width,height:900});
  await page.evaluate(()=>{window.scrollTo(0,0);document.querySelector('#app').innerHTML=PlansUI.render();PlansUI.bind(document.querySelector('#app'));});
  if(width<768)await centered(1);
  const metrics=await page.evaluate(()=>{
   const rail=document.querySelector('[data-plans-carousel]'),cards=[...rail.children],r=rail.getBoundingClientRect();
   return{pageOverflow:document.documentElement.scrollWidth>innerWidth+1,railOverflow:rail.scrollWidth>rail.clientWidth+1,display:getComputedStyle(rail).display,snap:getComputedStyle(rail).scrollSnapType,tabIndex:rail.tabIndex,windowY:scrollY,ratio:cards[1].getBoundingClientRect().width/r.width,cards:cards.map(c=>{const b=c.getBoundingClientRect();return{top:b.top,width:b.width,height:b.height,snap:getComputedStyle(c).scrollSnapAlign};}),dot:document.querySelector('[data-plan-indicator][aria-current=true]')?.dataset.planIndicator};
  });
  assert.equal(metrics.pageOverflow,false,'No page overflow '+width);
  assert.equal(metrics.windowY,0,'Opening carousel must not jump vertically '+width);
  assert.ok(Math.max(...metrics.cards.map(c=>c.height))-Math.min(...metrics.cards.map(c=>c.height))<2,'Equal card heights '+width);
  if(width<768){
   assert.equal(metrics.display,'flex');assert.equal(metrics.railOverflow,true);assert.equal(metrics.snap,'x mandatory');assert.equal(metrics.tabIndex,0);assert.equal(metrics.dot,'1');
   assert.ok(metrics.ratio>=.85&&metrics.ratio<=.90,'85–90% card '+width);
   assert.ok(metrics.cards.every(c=>c.snap==='center'));
   assert.ok(await page.evaluate(()=>{const rail=document.querySelector('[data-plans-carousel]').getBoundingClientRect(),next=document.querySelector('[data-plan-card=premium]').getBoundingClientRect();return next.left<rail.right-1&&next.right>rail.right;}),'Next card visible '+width);
   await page.focus('[data-plans-carousel]');await page.keyboard.press('ArrowRight');await centered(2);
   await page.keyboard.press('Home');await centered(0);await page.keyboard.press('End');await centered(2);
   await page.click('[data-plan-indicator="1"]');await centered(1);
   // Native scrolling (also used by touch): indicators follow the actual snap position.
   await page.$eval('[data-plans-carousel]',rail=>rail.scrollBy({left:-rail.clientWidth,behavior:'instant'}));await centered(0);
   await page.waitForFunction(()=>document.querySelector('[data-plan-indicator="0"]').getAttribute('aria-current')==='true');
   await page.click('[data-plan-indicator="1"]');await centered(1);
   await page.evaluate(()=>PlansUI.bind(document.querySelector('#app')));
   await page.focus('[data-plans-carousel]');await page.keyboard.press('ArrowRight');await centered(2);
   await page.click('[data-plan-indicator="1"]');await centered(1);
  }else{
   assert.equal(metrics.display,'grid');assert.equal(metrics.railOverflow,false);assert.equal(metrics.tabIndex,-1);
   assert.ok(Math.max(...metrics.cards.map(c=>c.top))-Math.min(...metrics.cards.map(c=>c.top))<2,'Same row '+width);
   assert.ok(Math.max(...metrics.cards.map(c=>c.width))-Math.min(...metrics.cards.map(c=>c.width))<2,'Balanced widths '+width);
   assert.equal(await page.$eval('.plan-indicators',el=>getComputedStyle(el).display),'none');
  }
  layoutResults.push({width,...metrics});
  await page.evaluate(()=>document.querySelector('.plan-billing-switch').scrollIntoView({block:'start'}));
  await page.screenshot({path:path.join(out,width+'-responsive-plans.png')});
 }
 fs.writeFileSync(path.join(out,'responsive-results.json'),JSON.stringify(layoutResults,null,2));
 await page.evaluate(()=>{PlansUI.guardRoute('crm')});assert.match(await page.$eval('.pro-feature-modal h3',e=>e.textContent),/Gestão/);await page.click('[data-close-pro]');
 assert.match(await page.$eval('[data-plan-card=essential]',e=>e.textContent),/Sem acesso ao módulo Financeiro/);
 assert.doesNotMatch(await page.$eval('[data-plan-card=essential]',e=>e.textContent),/Entradas e saídas básicas/);
 await page.click('[data-full-comparison]');assert.match(await page.$eval('.plan-comparison-sheet',e=>e.textContent),/Financeiro completo/);assert.doesNotMatch(await page.$eval('.plan-comparison-sheet',e=>e.textContent),/Entradas e saídas básicas/);await page.click('[data-close-comparison]');
 await page.evaluate(()=>{const link=document.createElement('a');link.dataset.route='financeiro';link.id='qa-finance-link';document.body.append(link);PlansUI.syncNavigation();});
 assert.equal(await page.$eval('#qa-finance-link',e=>e.hidden),true);
 assert.equal(await page.evaluate(()=>PlansUI.guardRoute('financeiro')),false);assert.match(await page.$eval('.pro-feature-modal h3',e=>e.textContent),/Gestão/);await page.click('[data-close-pro]');
 for(const planId of ['professional','premium','essential']){await page.evaluate(planId=>{const s=BusinessContext.get();s.business.subscription={planId,status:'active',catalogVersion:2};BusinessContext.set({business:s.business,userProfile:s.userProfile});PlansUI.syncNavigation();},planId);assert.equal(await page.$eval('#qa-finance-link',e=>e.hidden),planId==='essential');if(planId!=='essential')assert.equal(await page.evaluate(()=>PlansUI.guardRoute('financeiro')),true);}
 await page.evaluate(()=>{PlansUI.guardRoute('equipe')});assert.match(await page.$eval('.pro-feature-modal h3',e=>e.textContent),/Pro/);await page.click('[data-close-pro]');
 await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.click('[data-billing-period=monthly]');await page.waitForFunction(()=>document.querySelector('[data-price-value]').textContent==='29,90');
 await page.evaluate(()=>{for(let i=0;i<6;i++)document.querySelector('[data-billing-period='+(i%2?'monthly':'yearly')+']').click()});await page.waitForFunction(()=>document.querySelector('[data-price-value]').textContent==='29,90');assert.deepEqual(await prices(),['29,90','59,90','119,90']);
 await page.setViewport({width:390,height:844});
 await page.evaluate(()=>{const current=BusinessContext.get();current.business.subscription={planId:'professional',status:'active',hasPaidSubscription:true,legacyPlan:true,currentPeriodEnd:new Date(Date.now()+2*86400000).toISOString(),legacyTransition:{renewalStatus:'disabled'}};BusinessContext.set({business:current.business,userProfile:current.userProfile});document.querySelector('#app').innerHTML=PlansUI.render();PlansUI.bind(document.querySelector('#app'));PlansUI.syncLegacyNotice();});
 assert.match(await page.$eval('#legacy-plan-notice',el=>el.textContent),/Os planos da VECONI mudaram/);
 await page.click('[data-plan-cta=premium]');assert.equal(await page.$('.plan-payment-summary'),null);assert.match(await page.$eval('.modal h3',el=>el.textContent),/Trocar para um novo plano/);await page.click('[data-accept]');await page.waitForSelector('.plan-payment-summary');assert.match(await page.$eval('.plan-payment-summary',el=>el.textContent),/119,90/);await page.click('[data-close-payment]');
 await page.click('[data-full-comparison]');assert.match(await page.$eval('.plan-comparison-sheet',el=>el.textContent),/Seu plano anterior/);await page.click('[data-close-comparison]');
 await page.screenshot({path:path.join(out,'390-legacy-notice.png'),fullPage:true});
 await page.evaluate(()=>{const current=BusinessContext.get();current.business.subscription.currentPeriodEnd=new Date(Date.now()-1000).toISOString();BusinessContext.set({business:current.business,userProfile:current.userProfile});PlansUI.syncLegacyNotice();});
 assert.match(await page.$eval('#legacy-plan-notice',el=>el.textContent),/Escolha seu novo plano/);
 assert.equal(await page.evaluate(()=>PlanLimitService.canUseFeature('basicSales').ok),false);
 // Reduced motion, rebind and a desktop-to-mobile resize retain a valid centered card.
 await page.click('[data-plan-indicator="0"]');await centered(0);
 assert.equal(await page.$eval('[data-plans-carousel]',el=>getComputedStyle(el).scrollBehavior),'auto');
 await page.setViewport({width:1024,height:900});await page.waitForFunction(()=>document.querySelector('[data-plans-carousel]').tabIndex===-1);
 await page.setViewport({width:390,height:844});await centered(0);
 console.log(JSON.stringify({ok:true,legacyNotice:true,legacyComparison:true,legacyExpiredReadOnly:true,annualTotals:true,checkoutPeriod:true,upgradeGestao:true,upgradePro:true,reducedMotion:true,rapidToggle:true,carouselKeyboard:true,nativeSnap:true,gestaoInitiallyCentered:true,widths:layoutResults.map(r=>r.width),productionWrites:0}));
 }finally{await browser.close();server.close();}}
main().catch(error=>{console.error(error);server.close();process.exitCode=1;});
