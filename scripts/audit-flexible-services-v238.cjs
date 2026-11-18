'use strict';
// Isolated synthetic browser fixture. No Firebase credentials, network SDK or real data.
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict');
const puppeteer=require(process.env.PUPPETEER_CORE_PATH||'C:/Users/Murillo/AppData/Local/Temp/veconi-fiado-mensagens-v2/node_modules/puppeteer-core');
const root=path.resolve(__dirname,'..'),out=path.join(root,'qa-artifacts','v238');fs.mkdirSync(out,{recursive:true});
const styles=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<link[^>]+href="(\.\/css\/[^"?]+)(?:\?[^" ]*)?"/g)].map(m=>`<link rel="stylesheet" href="${m[1]}">`).join('\n');
const scripts=['assets/lucide.min.js','functions/src/shared/flexible-service.js','js/flexible-service-ui.js','functions/src/shared/product-model.js','js/produtos.js','js/product-images.js','js/sale-money.js','js/product-variations.js','js/vendas.js','js/checkout.js','js/desktop-sales.js','js/checkout-mobile.js'];
const fixture=String.raw`
window.qaErrors=[];addEventListener('error',e=>qaErrors.push(e.message));
window.Utils={uuid:()=>crypto.randomUUID(),escapar:v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])),dinheiro:v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),somenteNumeros:v=>String(v||'').replace(/\D/g,''),toast:(message,error)=>{document.querySelector('#qa-status').textContent=message;}};
window.qaSpace='qa-space';window.qaCost=true;window.qaPrincipal='qa-owner';
window.FirebaseSession={user:{uid:'qa-owner'},businessId:'qa-business'};
window.TeamAccess={has:k=>k!=='cost.view'||qaCost,actor:()=>({actorUid:qaPrincipal,actorRoleSnapshot:qaCost?'owner':'seller'}),captureSession:()=>[qaPrincipal,qaCost],assertSession(){}};
window.BusinessContext={get:()=>({businessId:'qa-business',role:qaCost?'owner':'seller',permissionSignature:String(qaCost)})};
window.SpaceContext={salesId:()=>qaSpace,activeId:()=>qaSpace,selectedSales:()=>({id:qaSpace}),requireSalesSpace:()=>qaSpace,viewScope:()=>qaSpace,bind(){},list:()=>[{id:qaSpace,name:'Corridas QA'}]};
window.SpaceEngine={productAllowsSpace:(p,id)=>p.spaceAccessMode==='all_spaces'||p.allowedSpaceIds.includes(id)};
const initial=()=>({config:{},clientes:[],produtos:[{id:'qa-ride',nome:'Corrida particular',categoria:'Serviços',preco:3,custo:.75,itemKind:'service',productType:'simple',serviceConfig:{version:1,id:'qa-config-ride-001',pricingModel:'km',requiresKm:true},serviceCostConfig:{model:'km',rate:.75,feePercent:10},controlaEstoque:false,semControleEstoque:true,estoqueAtual:0,ativo:true,allowedSpaceIds:['qa-space']},{id:'qa-hour',nome:'Entrega por hora',categoria:'Serviços',preco:60,custo:12,itemKind:'service',productType:'simple',serviceConfig:{version:1,id:'qa-config-hour-001',pricingModel:'hour',requiresMinutes:true},serviceCostConfig:{model:'hour',rate:12,feePercent:0},controlaEstoque:false,semControleEstoque:true,estoqueAtual:0,ativo:true,allowedSpaceIds:['qa-space']}],variacoesProdutos:[],vendas:[],pagamentos:[],movimentacoes:[],movimentacoesEstoque:[]});
let state=initial(),pending=Promise.resolve();
const ready=new Promise((resolve,reject)=>{const r=indexedDB.open('veconi-v238-synthetic',1);r.onupgradeneeded=()=>r.result.createObjectStore('state');r.onerror=()=>reject(r.error);r.onsuccess=()=>{window.qaIdb=r.result;const get=qaIdb.transaction('state').objectStore('state').get('data');get.onsuccess=()=>{if(get.result)state=get.result;resolve();};};});
window.DB={__firebaseSyncWrapped:true,getBusinessId:()=> 'qa-business',getPrincipal:()=>qaPrincipal,getWorkspaceGeneration:()=>0,carregar:()=>state,getRecentClientIds:()=>[],rememberRecentClient(){},alterar:fn=>{const d=structuredClone(state);fn(d);state=d;pending=ready.then(()=>new Promise((resolve,reject)=>{const t=qaIdb.transaction('state','readwrite');t.objectStore('state').put(state,'data');t.oncomplete=resolve;t.onerror=()=>reject(t.error);}));},flush:()=>pending};
window.Repositories={productRepository:()=>({list:()=>state.produtos,getById:id=>state.produtos.find(p=>p.id===id)}),clientRepository:()=>({list:()=>[],getById:()=>null}),saleRepository:()=>({list:()=>state.vendas,create:d=>Vendas.registrar(d)})};
window.Router={atual:()=> 'vender'};window.Campanhas={aplicarVendaNoBanco:()=>[],reverterVendaNoBanco(){}};window.CustomerSubscriptions={applySaleInData:()=>[]};
window.Recibos={mostrar:s=>{document.querySelector('#qa-status').textContent='Venda preservada '+Utils.dinheiro(s.valorFinal);}};
window.Modais={fechar:()=>document.querySelector('#modal').replaceChildren()};
window.SyncFirebase={isReady:()=>true,createSaleOperation:(_before,next)=>DB.alterar(d=>Object.assign(d,next)),inspectCheckoutSaleAttempt:attempt=>{const sale=state.vendas.find(s=>s.operationId===attempt.operationId);return sale?{status:'pending',sale}:null;},assertSaleQueueDependencies(){},isSalePending:()=>true,queueSaleTracking:()=>({status:'pending'}),traceSale(){}};
window.qaReady=ready;
`;
const html=`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${styles}<style>body{background:#f6f8fa;margin:0}.qa-header{padding:16px;background:#fff;display:flex;align-items:center;justify-content:space-between}#app{padding:12px;max-width:1200px;margin:auto}.pos-page{padding-bottom:90px}.modal-bg{z-index:9999}</style></head><body><header class="qa-header"><b>VECONI · Serviços QA</b><button class="btn btn-light" id="qa-config">Cadastrar serviço</button></header><p id="qa-status" role="status"></p><main id="app"></main><div id="modal"></div><script>${fixture}</script>${scripts.map(p=>`<script src="/${p}"></script>`).join('')}<script>qaReady.then(()=>{document.querySelector('#app').innerHTML=Checkout.view();Checkout.bind();if(DesktopSales.isDesktop())DesktopSales.bind();else CheckoutMobile.enhance();document.querySelector('#qa-config').onclick=()=>ProductImages.openForm(null,{itemKind:'service'});window.fixtureReady=true;});</script></body></html>`;
async function main(){
 const server=http.createServer((req,res)=>{if(req.url==='/'||req.url?.startsWith('/?')){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(html);}const rel=decodeURIComponent(req.url.split('?')[0]).replace(/^\//,''),f=path.resolve(root,rel);if(!/^(?:js\/|css\/|assets\/|functions\/src\/shared\/(?:flexible-service|product-model)\.js$)/.test(rel)){res.statusCode=403;return res.end();}if(rel.includes('..')||rel.includes('\\')||!f.startsWith(root+path.sep)||!fs.existsSync(f)){res.statusCode=404;return res.end();}res.setHeader('Content-Type',f.endsWith('.css')?'text/css':f.endsWith('.js')?'application/javascript':'application/octet-stream');fs.createReadStream(f).pipe(res);});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const url='http://127.0.0.1:'+server.address().port;
 if(process.argv.includes('--preview')){console.log('V238 QA — somente dados fictícios: '+url);return;}
 const browser=await puppeteer.launch({headless:true,executablePath:'C:/Program Files/Google/Chrome/Application/chrome.exe',args:['--disable-extensions','--no-first-run']});
 const results=[];let activePage;
 try{
  for(const width of [320,360,390,1366]){
   const context=await browser.createBrowserContext(),page=await context.newPage();page.on('pageerror',e=>console.error('QA browser:',e.message));activePage=page;page.setDefaultTimeout(7000);console.log('Viewport',width);await page.setViewport({width,height:900,isMobile:width<768,hasTouch:width<768});await page.goto(url);await page.waitForFunction(()=>window.fixtureReady);
   await page.click('#qa-config');await page.waitForSelector('[data-service-config]:not([hidden])');
   await page.select('select[name="servicePricingModel"]','km');await page.select('select[name="serviceCostModel"]','km');
   await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.product-form-modal')).opacity)>.99);await page.$eval('[data-service-config]',e=>e.scrollIntoView({block:'center'}));await page.screenshot({path:path.join(out,`cadastro-${width}.png`),fullPage:false});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'product form must not overflow');
   await page.click('#modal .close');
   await page.evaluate(()=>Checkout.addSaleItem(ProductVariations.saleItem(Produtos.obter('qa-ride'),null,1)));
   await page.waitForSelector('.flexible-service-modal');
   await page.$eval('input[name="km"]',e=>{e.value='12';e.dispatchEvent(new Event('input'));});
   await page.$eval('input[name="minutes"]',e=>{e.value='30';e.dispatchEvent(new Event('input'));});
   await page.$eval('input[name="charge"]',e=>{e.value='40';e.dispatchEvent(new Event('input'));});
   await page.$eval('input[name="extra"]',e=>{e.value='2';e.dispatchEvent(new Event('input'));});await page.select('select[name="source"]','aplicativo');
   assert.match(await page.$eval('[data-service-cost]',e=>e.textContent),/15,00/);
   await page.waitForFunction(()=>Number(getComputedStyle(document.querySelector('.flexible-service-modal')).opacity)>.99);await page.screenshot({path:path.join(out,`execucao-${width}.png`)});
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true,'service modal must not overflow');
   await page.click('.flexible-service-modal button.btn-primary');await page.waitForFunction(()=>Checkout.cartCount()===1);
   await page.evaluate(()=>Checkout.addSaleItem(ProductVariations.saleItem(Produtos.obter('qa-ride'),null,1)));
   await page.$eval('input[name="km"]',e=>{e.value='5';e.dispatchEvent(new Event('input'));});await page.click('.flexible-service-modal button.btn-primary');
   assert.equal(await page.evaluate(()=>Checkout.cartCount()),2);assert.equal(await page.$$eval('[data-item-qty]',nodes=>new Set(nodes.map(n=>n.dataset.itemQty)).size),2,'two rides must not merge');
   // Open the actual cart then confirm while offline, preserving sale and original IDs in real IndexedDB.
   if(width<768)await page.click('#open-sale-summary');else{await page.evaluate(()=>DesktopSales.openCart());await page.waitForFunction(()=>document.querySelector('.desktop-sales-cart').getBoundingClientRect().right<=innerWidth+1);await page.click('#desktop-continue-sale');}await page.screenshot({path:path.join(out,`sacola-${width}.png`)});await page.setOfflineMode(true);await page.click('#finish-sale');
   await page.waitForFunction(()=>DB.carregar().vendas.length===1);
   await page.evaluate(()=>DB.flush());const before=await page.evaluate(()=>DB.carregar().vendas[0]);
   assert.equal(before.valorFinal,55);assert.equal(before.itens.length,2);assert.equal(before.custoTotal,20.25);
   assert.equal(await page.evaluate(()=>DB.carregar().movimentacoesEstoque.length),0);
   await page.setOfflineMode(false);await page.reload();await page.waitForFunction(()=>window.fixtureReady);
   const after=await page.evaluate(()=>DB.carregar().vendas[0]);assert.equal(after.id,before.id);assert.equal(after.operationId,before.operationId);assert.deepEqual(after.itens,before.itens);
   // A different active space/session cannot submit a modal left open by the first session.
   await page.evaluate(()=>Checkout.addSaleItem(ProductVariations.saleItem(Produtos.obter('qa-ride'),null,1)));
   await page.$eval('input[name="km"]',e=>{e.value='2';e.dispatchEvent(new Event('input'));});await page.evaluate(()=>{qaSpace='another-space';});
   await page.click('.flexible-service-modal button.btn-primary');assert.match(await page.$eval('[data-service-error]',e=>e.textContent),/sessão ou o espaço mudou/);
   const errors=await page.evaluate(()=>qaErrors);assert.deepEqual(errors,[]);
   results.push({width,productForm:true,serviceModal:true,cartTwoExecutions:true,offlineIndexedDbRestart:true,scopeFence:true,errors});await context.close();
  }
  const productContext=await browser.createBrowserContext(),productPage=await productContext.newPage();await productPage.goto(url);await productPage.waitForFunction(()=>window.fixtureReady);await productPage.click('#qa-config');await productPage.type('input[name="nome"]','Corrida livre QA');await productPage.select('select[name="servicePricingModel"]','sale');await productPage.click('[data-save-product]');await productPage.waitForFunction(()=>DB.carregar().produtos.some(p=>p.nome==='Corrida livre QA'));const saved=await productPage.evaluate(()=>DB.carregar().produtos.find(p=>p.nome==='Corrida livre QA'));assert.equal(saved.serviceConfig.pricingModel,'sale');assert.equal(saved.preco,0);assert.equal(saved.controlaEstoque,false);await productContext.close();
  const context=await browser.createBrowserContext(),page=await context.newPage();await page.goto(url);await page.waitForFunction(()=>window.fixtureReady);await page.evaluate(()=>{qaCost=false;const p=Produtos.obter('qa-ride');delete p.custo;delete p.serviceCostConfig;Checkout.addSaleItem(ProductVariations.saleItem(p,null,1));});assert.equal(await page.$('input[name="extra"]'),null);await page.click('.flexible-service-modal button.btn-primary');assert.match(await page.$eval('[data-service-error]',e=>e.textContent),/quilômetros/);await context.close();
  fs.writeFileSync(path.join(out,'browser-results.json'),JSON.stringify({synthetic:true,realFinancialWrites:0,results,sellerCostPrivacy:true,productFormSave:true},null,2));console.log(JSON.stringify(results));
 }catch(e){if(activePage&&!activePage.isClosed()){console.error(await activePage.evaluate(()=>({errors:qaErrors,status:document.querySelector('#qa-status')?.textContent,serviceError:document.querySelector('[data-service-error]')?.textContent,feedback:document.querySelector('#sale-submit-feedback')?.textContent,count:Checkout.state(),invalid:[...document.querySelectorAll(':invalid')].map(x=>[x.name,x.validationMessage])})));await activePage.screenshot({path:path.join(out,'failure.png')});}throw e;}finally{await browser.close();await new Promise(r=>server.close(r));}
}
module.exports={html,fixture,styles,scripts,root};
if(require.main===module)main().catch(e=>{console.error(e);process.exitCode=1;});
