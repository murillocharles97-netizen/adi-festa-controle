'use strict';
// Headless QA with a separate browser profile and local fictitious fixtures only.
// Does not connect to the user's browser, Firebase or production.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process'),puppeteer=require('puppeteer');
const root=path.resolve(__dirname,'..'),out=path.join(root,'docs/qa/ux-v203'),results=[];
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png'};
const fixture=name=>'/tests/fixtures/'+name;
async function main(){
 fs.mkdirSync(path.join(out,'screenshots'),{recursive:true});
 const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://localhost'),name=decodeURIComponent(url.pathname),file=path.resolve(root,'.'+name);
  if(!file.startsWith(root+path.sep)||!/^\/(css|js|assets|tests\/fixtures)\//.test(name)){res.writeHead(403).end();return;}
  try{let body=fs.readFileSync(file);if(url.searchParams.has('baseline')&&['/js/recibos.js','/css/style.css'].includes(name))body=execFileSync('git',['show','c80da0fffb0106aea4d23cf097ee33896522f07c:'+name.slice(1)],{cwd:root});
   if(name.endsWith('receipt-viewport-v203.html')&&url.searchParams.has('baseline'))body=Buffer.from(body.toString().replace('js/recibos.js','js/recibos.js?baseline=1').replace('css/style.css','css/style.css?baseline=1'));
   res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(body);
  }catch{res.writeHead(404).end();}
 });
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await puppeteer.launch({executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',headless:true,args:['--disable-background-networking','--no-first-run']});
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);page.on('request',req=>req.url().startsWith(origin+'/')||req.url().startsWith('data:')?req.continue():req.abort('blockedbyclient'));
  const open=async(url,width=1366,height=768,scale=1)=>{errors.length=0;await page.setViewport({width,height,deviceScaleFactor:scale,isMobile:width<768,hasTouch:width<768});await page.goto(origin+url,{waitUntil:'networkidle0'});await page.evaluate(async()=>{await window.fixtureReady;});assert.deepEqual(errors,[]);};
  async function check(name,fn){try{await fn();results.push({scenario:name,status:'Aprovado'});console.log('PASS '+name);}catch(e){results.push({scenario:name,status:'Reprovado',error:e.message});console.error('FAIL '+name+': '+e.message);}}
  async function bounded(footer='footer'){
   const r=await page.evaluate(selector=>{
    const panel=document.querySelector('#modal [role=dialog]'),foot=panel.querySelector(selector),view=visualViewport||{height:innerHeight,width:innerWidth,offsetTop:0,offsetLeft:0};
    const rect=panel.getBoundingClientRect(),bounds={top:view.offsetTop,left:view.offsetLeft,bottom:view.offsetTop+view.height,right:view.offsetLeft+view.width};
    const buttons=[...foot.querySelectorAll('button')].filter(b=>!b.hidden&&b.getClientRects().length).map(b=>{const r=b.getBoundingClientRect();return{text:b.textContent.trim(),top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height};});
    return{rect:{top:rect.top,bottom:rect.bottom,left:rect.left,right:rect.right},bounds,buttons,overflow:document.documentElement.scrollWidth>innerWidth+1};
   },footer);
   assert.ok(r.rect.top>=r.bounds.top-1&&r.rect.bottom<=r.bounds.bottom+1,JSON.stringify(r));assert.equal(r.overflow,false);
   assert.ok(r.buttons.length>0);for(const b of r.buttons){assert.ok(b.top>=r.bounds.top&&b.bottom<=r.bounds.bottom+1&&b.left>=r.bounds.left&&b.right<=r.bounds.right+1,JSON.stringify(b));assert.ok(b.height>=43);}
  }
  const receipt=fixture('receipt-viewport-v203.html');
  await check('V202 baseline reproduces inaccessible initial receipt footer',async()=>{await open(receipt+'?baseline=1');assert.equal(await page.evaluate(()=>{const r=document.querySelector('.receipt-actions').getBoundingClientRect();return r.bottom>innerHeight;}),true);await page.screenshot({path:path.join(out,'screenshots/receipt-before-desktop.png')});});
  for(const [label,w,h] of [['desktop',1920,1080],['notebook',1366,768],['compact',1024,600],['tablet',768,1024]])for(const zoom of[1,1.25,1.5,2])await check(`receipt ${label} ${zoom*100}% reflow`,async()=>{
   // CSS viewport / zoom with matching pixel density reproduces layout reflow,
   // media queries and physical pixel dimensions; not a claim of physical-device QA.
   await open(receipt,Math.floor(w/zoom),Math.floor(h/zoom),zoom);await bounded();
   const scroll=await page.evaluate(()=>{const box=document.querySelector('.viewport-scroll');box.scrollTop=box.scrollHeight;return{top:box.scrollTop,height:box.clientHeight,total:box.scrollHeight,unchanged:JSON.stringify(sale)===qaOriginal,nested:getComputedStyle(document.querySelector('.sale-receipt-items')).overflowY};});
   assert.ok(scroll.top>0&&scroll.height>0);assert.equal(scroll.unchanged,true);assert.equal(scroll.nested,'visible');await bounded();
  });
  for(const width of[320,360,390,430])await check(`receipt mobile ${width}px`,async()=>{await open(receipt,width,844);await bounded();await page.evaluate(()=>document.querySelector('.viewport-scroll').scrollTop=5000);await bounded();});
  await check('zoom changes while the receipt remains open preserve desktop actions',async()=>{await open(receipt);for(const zoom of[1.25,1.5,2,1]){await page.setViewport({width:Math.floor(1366/zoom),height:Math.floor(768/zoom),deviceScaleFactor:zoom});await page.waitForFunction(()=>parseFloat(document.querySelector('#modal').style.getPropertyValue('--modal-vv-height'))<=visualViewport.height+1);await bounded();assert.ok(await page.$('[data-sale-download]'));}});
  await open(receipt);await page.screenshot({path:path.join(out,'screenshots/receipt-desktop.png')});await open(receipt,390,844);await page.screenshot({path:path.join(out,'screenshots/receipt-mobile.png')});
  await check('receipt print keeps all 45 lines; canvas and WhatsApp content are preserved',async()=>{
   await open(receipt);await page.click('[data-sale-whatsapp]');assert.equal(await page.evaluate(()=>qaOpenUrls.length),1);assert.match(await page.evaluate(()=>qaOpenUrls[0]),/^https:\/\/wa\.me\/5511900000000\?text=/);
   assert.ok(await page.evaluate(()=>Recibos.criarCanvas(sale,{nome:sale.clienteNome}).height>100));
   await page.emulateMediaType('print');assert.ok(await page.evaluate(()=>{const s=document.querySelector('.viewport-scroll');return getComputedStyle(s).overflowY==='visible'&&s.clientHeight>=s.scrollHeight-1&&document.querySelectorAll('.sale-receipt-item').length===45;}));await page.emulateMediaType('screen');
  });
  await open(receipt,390,844);
  await check('receipt keyboard focus is contained; share/edit follows visible viewport',async()=>{
   await page.evaluate(()=>document.querySelector('.sale-completion-actions [data-sale-close]').focus());await page.keyboard.press('Tab');assert.equal(await page.evaluate(()=>Boolean(document.activeElement.closest('#modal'))),true);
   await page.click('[data-sale-share]');await page.click('[data-share-edit]');assert.equal(await page.$eval('#sale-share-message',e=>e.readOnly),false);
   await page.setViewport({width:390,height:390,deviceScaleFactor:1,isMobile:true,hasTouch:true});await page.waitForFunction(()=>parseFloat(document.querySelector('#modal').style.getPropertyValue('--modal-vv-height'))<=visualViewport.height+1);await bounded();await page.screenshot({path:path.join(out,'screenshots/receipt-share-keyboard.png')});
   await page.click('[data-share-cancel]');await bounded();await page.keyboard.press('Escape');assert.equal(await page.$('#modal [role=dialog]'),null);
  });
  for(const kind of['cancel','exchange'])for(const width of[390,1366])await check(`${kind} fixed actions ${width}px; real form retained`,async()=>{
   await open(receipt+'?kind='+kind,width,width===390?844:768);await bounded();assert.equal(await page.evaluate(()=>{const form=document.querySelector('#modal form');return [...form.querySelectorAll('footer button')].every(b=>b.form===form);}),true);
   await page.evaluate(()=>{const s=document.querySelector('#modal .viewport-scroll');s.scrollTop=s.scrollHeight;});await bounded();
   if(width===390)await page.screenshot({path:path.join(out,`screenshots/${kind}-mobile.png`)});
   assert.ok((await page.evaluate(()=>qaCalls)).every(c=>['previewSaleCancellation','listSaleExchanges'].includes(c.name)));
  });
  await check('exchange review/edit preserves form handlers and fixed actions',async()=>{
   await open(fixture('sale-exchanges.html')+'?case=equal',390,844);await page.addStyleTag({url:origin+'/css/style.css'});await page.addScriptTag({content:fs.readFileSync(path.join(root,'js/recibos.js'),'utf8').split('(function(){')[0]});await page.evaluate(()=>Modais.layout(document.querySelector('.exchange-sheet')));
   await page.evaluate(()=>{document.querySelector('[data-return="0"]').value='1';document.querySelector('[name=reasonType]').value='Preferência do cliente';document.querySelector('[data-product]').value='1';document.querySelector('[data-ex-form]').requestSubmit();});
   await page.waitForSelector('[data-ex-confirm]:not([hidden])');await bounded();assert.equal(await page.$eval('.exchange-columns',e=>getComputedStyle(e).display),'none');assert.equal(await page.evaluate(()=>fixtureExchanges.length),0);
   await page.click('[data-ex-edit]');await page.waitForSelector('[data-ex-quote]:not([hidden])');assert.notEqual(await page.$eval('.exchange-columns',e=>getComputedStyle(e).display),'none');await bounded();
  });
  await check('payment receipt and phone form remain reachable with keyboard viewport',async()=>{
   await open(fixture('payment-confirmation-sharing.html'),390,844);
   const modalSource=fs.readFileSync(path.join(root,'js/recibos.js'),'utf8').split('(function(){')[0];await page.addScriptTag({content:modalSource});
   await page.click('#qa-without-phone');await page.waitForSelector('#whatsapp-payment');await bounded('.payment-success .actions');await page.click('#whatsapp-payment');
   await page.click('[data-payment-phone]');await page.waitForSelector('#payment-client-phone');
   assert.equal(await page.evaluate(()=>qaProtected()===qaBefore),true);assert.equal(await page.evaluate(()=>qaData.pagamentos.length),2);
   await page.setViewport({width:390,height:390,isMobile:true,hasTouch:true});await page.waitForFunction(()=>parseFloat(document.querySelector('#modal').style.getPropertyValue('--modal-vv-height'))<=visualViewport.height+1);
   assert.equal(await page.evaluate(()=>{const r=document.querySelector('.payment-confirmation-dialog').getBoundingClientRect();return r.top>=0&&r.bottom<=visualViewport.height+1;}),true);
   await page.$eval('[data-payment-phone-form] button[type=submit]',e=>e.scrollIntoView({block:'center'}));assert.ok(await page.$eval('[data-payment-phone-form] button[type=submit]',e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=visualViewport.height+1;}));assert.equal(await page.evaluate(()=>qaCalls.phoneWrites),0);
  });
  const recovery=fixture('recovery-notice-v203.html');
  for(const state of['clear','resolved','pending','pagination','failure','local','mismatch'])await check(`recovery notice ${state}`,async()=>{
   await open(recovery+'?state='+state+'#/inicio');await page.waitForFunction(()=>!document.querySelector('[data-sale-recovery-bar]')?.textContent.includes('Conferindo revisões'));
   const data=await page.evaluate(()=>({bar:document.querySelector('[data-sale-recovery-bar]')?.textContent||'',calls:qaCalls,unchanged:JSON.stringify(qaSources)===qaOriginal}));
   assert.equal(data.unchanged,true);assert.ok(data.calls.every(c=>c.name==='listSaleRecoveryReviews'));
   if(['clear','resolved'].includes(state))assert.equal(data.bar,'');else if(['local','mismatch'].includes(state))assert.match(data.bar,/1 venda aguardando análise/);else if(state==='failure')assert.match(data.bar,/confirmação pendente/);else assert.match(data.bar,/Há vendas aguardando revisão/);
   if(state==='pagination')assert.equal(data.calls.length,2);
   if(state==='pending')await page.screenshot({path:path.join(out,'screenshots/dashboard-pending-desktop.png')});
  });
  await check('recovery permanent access in History; resolved notice stays hidden after reload',async()=>{await open(recovery+'?state=resolved&route=historico');assert.ok(await page.$('[data-recovery-entry]'));assert.equal(await page.$('[data-sale-recovery-bar]'),null);await page.reload({waitUntil:'networkidle0'});assert.equal(await page.$('[data-sale-recovery-bar]'),null);assert.ok(await page.$('[data-recovery-entry]'));});
  await check('stale owner response cannot contaminate seller/space; no writes',async()=>{
   await open(recovery+'?state=deferred');await page.waitForFunction(()=>qaDeferred.length>0);
   await page.evaluate(()=>{qaUid='qa-other-seller';qaRole='seller';FirebaseSession.user.uid=qaUid;qaState='clear';qaSpace='qa-other-space';dispatchEvent(new Event('business-context-changed'));for(const resolve of qaDeferred)resolve({items:[{status:'awaiting_review'}],nextCursor:null});});
   await page.waitForFunction(()=>!document.querySelector('[data-sale-recovery-bar]'));assert.equal(await page.$('[data-recovery-entry]'),null);
  });
  for(const width of[320,360,390,430,1440])for(const state of['login','recover','loading','error'])await check(`login preview ${state} ${width}px`,async()=>{
   await open(fixture('login-v203.html')+'#'+state,width,width===1440?1000:844);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth+1),false);
   const missing=await page.evaluate(()=>[...document.querySelectorAll('input')].filter(e=>!e.labels.length).map(e=>e.name));assert.deepEqual(missing,[]);
   if(width===390||width===1440)await page.screenshot({path:path.join(out,`screenshots/login-${state}-${width===390?'mobile':'desktop'}.png`),fullPage:true});
  });
  await check('login preview show password, autofill, humanized error, recovery and loading paths',async()=>{
   await open(fixture('login-v203.html')+'#login',390,844);assert.equal(await page.$eval('#email',e=>e.autocomplete),'username');assert.equal(await page.$eval('#password',e=>e.autocomplete),'current-password');
   await page.type('#email','qa@example.invalid');await page.type('#password','erro');await page.click('.password-toggle');assert.equal(await page.$eval('#password',e=>e.type),'text');assert.equal(await page.$eval('.password-toggle',e=>e.getAttribute('aria-pressed')),'true');
   await page.click('button.primary');assert.match(await page.$eval('[data-error]',e=>e.textContent),/recupere seu acesso/);
   await page.click('a[href="#recover"]');await page.type('#email','qa@example.invalid');await page.click('button.primary');await page.waitForFunction(()=>location.hash==='#sent');assert.match(await page.$eval('[role=status]',e=>e.textContent),/Se houver uma conta/);
   await page.evaluate(()=>location.hash='error');await page.waitForSelector('details');await page.click('a[href="#loading"]');await page.waitForSelector('.loading-mark');assert.ok(await page.$('a[href="#login"]'));
  });
  await check('login preview keyboard resize and reduced motion',async()=>{await open(fixture('login-v203.html')+'#login',390,844);await page.focus('#password');await page.setViewport({width:390,height:390,isMobile:true,hasTouch:true});await page.$eval('button.primary',e=>e.scrollIntoView({block:'center'}));assert.ok(await page.$eval('button.primary',e=>{const r=e.getBoundingClientRect();return r.top>=0&&r.bottom<=innerHeight;}));await page.emulateMediaFeatures([{name:'prefers-reduced-motion',value:'reduce'}]);await page.evaluate(()=>location.hash='loading');await page.waitForSelector('.loading-mark');assert.equal(await page.$eval('.loading-mark',e=>getComputedStyle(e,'::before').animationName),'none');});
  await check('login preview AA contrast for form copy, links and primary action',async()=>{await open(fixture('login-v203.html')+'#login',390,844);const ratios=await page.evaluate(()=>{const lum=color=>{const rgb=color.match(/[\d.]+/g).slice(0,3).map(x=>{const s=Number(x)/255;return s<=.04045?s/12.92:((s+.055)/1.055)**2.4;});return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;};const bg=getComputedStyle(document.querySelector('.form-panel')).backgroundColor;return ['.intro','.recover-row a','button.primary'].map(selector=>{const e=document.querySelector(selector),s=getComputedStyle(e),a=lum(s.color),b=lum(selector==='button.primary'?s.backgroundColor:bg);return{selector,ratio:(Math.max(a,b)+.05)/(Math.min(a,b)+.05)};});});for(const r of ratios)assert.ok(r.ratio>=4.5,JSON.stringify(r));});
  const report={generatedAt:new Date().toISOString(),scope:'Local, headless, fictitious data; all external requests blocked',zoomMethod:'CSS viewport divided by zoom + matching device pixel density; mobile keyboard via viewport resize. Physical Android not exercised.',results,passed:results.filter(r=>r.status==='Aprovado').length,failed:results.filter(r=>r.status==='Reprovado').length};
  fs.writeFileSync(path.join(out,'results.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,failed:report.failed,out}));if(report.failed)process.exitCode=1;
 }finally{if(browser)await browser.close();await new Promise(resolve=>server.close(resolve));}
}
main().catch(e=>{console.error(e);process.exitCode=1;});
