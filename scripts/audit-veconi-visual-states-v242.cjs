'use strict';
// Real application components, XLSX worker and CSS. Backend effects are fixture-only.
const {readFileSync,writeFileSync,mkdirSync,existsSync,statSync}=require('node:fs');
const path=require('node:path'), http=require('node:http'), assert=require('node:assert/strict');
const puppeteer=require('puppeteer-core'), XLSX=require('../assets/xlsx-0.20.3.full.min.js');
const model=require('../functions/src/shared/product-spreadsheet');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||'qa-artifacts/audit/v242-states');
mkdirSync(out,{recursive:true});

const read=file=>readFileSync(path.join(root,file),'utf8');
const slice=(file,start,end)=>{const s=read(file),i=s.indexOf(start),j=s.indexOf(end,i+start.length);assert.ok(i>=0&&j>i);return s.slice(i,j);};
const links=read('index.html').match(/<link[^>]+rel="stylesheet"[^>]*>/g).join('').replaceAll('href="./','href="/');
const products=['qa-1','qa-2'].map((id,i)=>({id,businessId:'qa',nome:'Produto '+i,codigo:'SKU'+i,preco:15,custo:5,estoqueAtual:2,ativo:true,allowedSpaceIds:['qa-space'],spaceAccessMode:'single_space',defaultSpaceId:'qa-space'}));
const scope={businessId:'qa',spaceId:'qa-space',allowedSpaceIds:['qa-space']};
const catalog={scope,permissions:{edit:true,cost:true},products,matchingProducts:products};
const sheet=(name,context)=>{
  const book=XLSX.utils.book_new(), header=model.columns.map(([label])=>label);
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([header,['qa-1',null,null,null,null,null,20],['qa-2',null,null,null,null,null,'inválido']]),'Produtos');
  XLSX.utils.book_append_sheet(book,XLSX.utils.aoa_to_sheet([['VECONI_PRODUCTS_V1',context,'qa-space']]),'Contexto');
  const file=path.join(out,name+'.xlsx');
  writeFileSync(file,XLSX.write(book,{type:'buffer',bookType:'xlsx'}));
  return file;
};
const good=sheet('catalogo','qa'),foreign=sheet('outro-contexto','isolated-other'),broken=path.join(out,'invalido.xlsx');
writeFileSync(broken,'fictício, formato inválido');
const initial={clientes:[{id:'qa-c',nome:'Cliente fictício',saldo:-40,ativo:true}],vendas:[],pagamentos:[],movimentacoes:[],config:{nome:'Empresa fictícia'}};
const setup=[
  'const $=s=>document.querySelector(s), $$=s=>document.querySelectorAll(s), icon=()=>"";',
  'const mountRoute=()=>{}, openQueueDetails=()=>document.querySelector("#modal").replaceChildren();',
  'let data='+JSON.stringify(initial)+',calls=[],queue=[],mode="pending";',
  'window.DB={carregar:()=>data,getBusinessId:()=>"qa",getWorkspaceGeneration:()=>0,flush:async()=>{}};',
  'window.TeamAccess={has:()=>true};window.FirebaseSession={user:{uid:"qa-owner"}};',
  'const space={id:"qa-space",name:"Espaço fictício"}, spaceId=space.id;',
  'window.SpaceContext={selectionLabel:()=>space.name,homeId:()=>spaceId,salesId:()=>spaceId,salesSpaces:()=>[space],requireSalesSpace:id=>{if(id!==spaceId)throw Error("Espaço inválido");return id;}};',
  'window.Clientes={importar:rows=>calls.push({type:"csv",rows})};',
  'const {dinheiro,escapar,toast}=Utils;',
  'window.SyncFirebase={isSalePending:()=>mode==="pending",getQueueDiagnostics:()=>queue,getFirebaseDiagnostic:()=>({pending:0,syncErrors:0}),pullCloudCollections:async()=>{},recognizePreservedPayment:async()=>mode==="error"?Promise.reject(Error("Prova insuficiente")):{confirmed:mode==="confirmed"},createPaymentOperation:(before,next,payment)=>{if(mode==="error")throw Error("Recebimento indisponível. Original preservado.");calls.push({type:"payment",payment});data=next;const local=data.pagamentos.at(-1);if(mode==="review")local.status="conflict";if(mode==="confirmed")local.financialAppliedAt="2026-01-01";}};',
  'const sale={id:"qa-sale",businessId:"qa",spaceId,clienteNome:"Cliente fictício",formaPagamento:"pix",status:"pago",data:"2026-01-01T12:00:00Z",valorFinal:20,itens:[]};',
  'window.FirebaseCallable=async(name,payload)=>{calls.push({type:name,payload});if(name==="previewSaleCancellation")return {data:{saleId:sale.id,spaceId,operationId:"qa-cancel",fingerprint:"qa-fingerprint",amountCents:2000,isCredit:false}};return {data:{saleId:sale.id,operationId:payload.operationId,status:"cancelado",financialProjection:"pending"}}};',
  slice('js/firebase/firebase-ui.js','function openPaymentReview(','function openQueueDetails('),
  slice('js/app.js','  function importarCSV()','  function abrirWhatsCobranca(')
].join('\n');
const server=http.createServer((req,res)=>{
  const url=new URL(req.url,'http://127.0.0.1');
  if(url.pathname==='/'){
    res.setHeader('Content-Type','text/html');
    return res.end('<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width">'+links+'<script src="/js/veconi-fluxo.js"></script></head><body><main id="app" data-route="produtos"></main><div id="modal"></div><div id="toasts"></div><script src="/js/utils.js"></script><script>'+setup+'</script>'+['js/recibos.js','js/fiados.js','js/sale-cancellation.js','js/csvImport.js','functions/src/shared/product-spreadsheet.js','js/product-spreadsheet-ui.js'].map(file=>'<script src="/'+file+'"></script>').join('')+'</body></html>');
  }
  if(url.pathname==='/tests/terminal-payments.fixture.html'){
    res.setHeader('Content-Type','text/html');
    return res.end(read('tests/terminal-payments.fixture.html').replace('</head>',links+'<script src="/js/veconi-fluxo.js"></script></head>').replace('<body>','<body><main id="app" data-route="vender"></main>').replace("waiting:'processing',timeout:","approved:'approved',waiting:'processing',timeout:"));
  }
  if(url.pathname==='/js/firebase/product-spreadsheet-service.js'){
    res.setHeader('Content-Type','text/javascript');
    return res.end('export async function loadCatalog(){return '+JSON.stringify(catalog)+';} export async function applyPreview(c,p){ window.qaWrites=(window.qaWrites||0)+1; return {results:p.rows.filter(r=>r.status==="update").map(r=>({ok:true,line:r.line})),operationIds:["sheet-qa"],refreshWarning:""};}');
  }
  const file=path.resolve(root,'.'+url.pathname);
  if(!file.startsWith(root+path.sep)||!existsSync(file)||!statSync(file).isFile())return res.writeHead(404).end();
  res.setHeader('Content-Type',({'.js':'text/javascript','.css':'text/css','.woff2':'font/woff2','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream');
  res.end(readFileSync(file));
});
const text=(page,selector)=>page.$eval(selector,e=>e.textContent);
const waitText=(page,selector,value)=>page.waitForFunction((s,v)=>document.querySelector(s)?.textContent.includes(v),{},selector,value);
const submit=(page,selector)=>page.$eval(selector,form=>form.requestSubmit());
async function contrast(page,selector){
  return page.$eval(selector,e=>{
    const rgb=s=>{const n=(s.match(/[\d.]+/g)||[]).map(Number);if(s.startsWith('color(srgb'))for(let i=0;i<3;i++)n[i]*=255;return [n[0]||0,n[1]||0,n[2]||0,n[3]??1];};
    const blend=(a,b)=>a.slice(0,3).map((v,i)=>v*a[3]+b[i]*(1-a[3]));
    const lum=c=>c.reduce((a,v,i)=>a+[.2126,.7152,.0722][i]*(v/255<=.04045?v/255/12.92:((v/255+.055)/1.055)**2.4),0);
    const chain=[];for(let n=e;n;n=n.parentElement)chain.push(rgb(getComputedStyle(n).backgroundColor));
    const bg=chain.reverse().reduce((a,b)=>blend(b,a),[255,255,255]),fg=blend(rgb(getComputedStyle(e).color),bg),l=[lum(bg),lum(fg)].sort((a,b)=>b-a);
    return +((l[0]+.05)/(l[1]+.05)).toFixed(2);
  });
}
async function main(){
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await puppeteer.launch({headless:true,executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});
 const results=[];
 try{for(const theme of ['light','dark']) for(const width of [390,1440]){
  const context=await browser.createBrowserContext(),page=await context.newPage(),errors=[];
  page.setDefaultTimeout(10000);page.on('pageerror',e=>errors.push(e.message));
  await page.setRequestInterception(true);page.on('request',r=>r.url().startsWith(base+'/')?r.continue():r.abort());
  await page.setViewport({width,height:850,hasTouch:width===390});
  await page.emulateMediaFeatures([{name:"prefers-reduced-motion",value:"reduce"}]);
  await page.goto(base,{waitUntil:'domcontentloaded',timeout:30000});
  await page.evaluate(theme=>VeconiFluxo.theme.set(theme),theme);
  const route=async name=>page.$eval('#app',(n,r)=>n.dataset.route=r,name);
  const shot=async (state,selector,target=page)=>{
    await new Promise(r=>setTimeout(r,250));
    const value=selector?await contrast(target,selector):null;
    const fit=await target.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1);
    await target.screenshot({path:path.join(out,state+'-'+theme+'-'+width+'.png')});
    results.push({state,theme,width,contrast:value,fit});
    assert.ok(fit,state+' overflow');
  };
  await page.evaluate(()=>{queue=[{operationId:'sheet-qa',category:'pending'}];ProductSpreadsheetUI.open();});
  await page.waitForFunction(()=>!document.querySelector('[data-sheet-file]').disabled);
  assert.match(await text(page,'[data-sheet-context]'),/2 produtos disponíveis/);
  const upload=async file=>(await page.$('[data-sheet-file]')).uploadFile(file);
  await upload(broken);await waitText(page,'[data-sheet-error]','válido');
  assert.ok(await page.$eval('[data-sheet-confirm]',e=>e.disabled));
  await shot('xlsx-invalido','[data-sheet-error]');
  await upload(foreign);await waitText(page,'[data-sheet-error]','outra empresa');
  await upload(good);await page.waitForSelector('.product-sheet-rows .is-update');
  assert.equal(await page.$$eval('.product-sheet-rows .is-invalid',n=>n.length),1);
  assert.equal(await page.evaluate(()=>window.qaWrites||0),0);
  await shot('xlsx-previa','.product-sheet-rows .is-invalid p');
  await page.$eval('[data-sheet-confirm]',e=>{e.click();e.click();});
  await waitText(page,'[data-sheet-status]','Enviando');
  assert.equal(await page.evaluate(()=>window.qaWrites),1);
  await shot('xlsx-pendente','[data-sheet-status]');
  await page.evaluate(()=>queue=[]);
  await waitText(page,'[data-sheet-status]','Concluído na nuvem');
  await shot('xlsx-confirmado','[data-sheet-status]');
  await page.click('footer [data-sheet-close]');
  await page.evaluate(()=>{queue=[{operationId:'sheet-qa',category:'error'}];ProductSpreadsheetUI.open();});
  await page.waitForFunction(()=>!document.querySelector('[data-sheet-file]').disabled);
  await upload(good);await page.waitForSelector('.product-sheet-rows .is-update');
  await page.click('[data-sheet-confirm]');
  await waitText(page,'[data-sheet-status]','com erro');
  await shot('xlsx-erro-fila','[data-sheet-status]');
  await page.click('footer [data-sheet-close]');

  await route('clientes');
  await page.evaluate(()=>{const click=HTMLInputElement.prototype.click;HTMLInputElement.prototype.click=function(){if(this.type!=='file')return click.call(this);const x=new DataTransfer();x.items.add(new File(['Nome,Telefone,Saldo\nCliente QA,,\x22-10,00\x22'],'qa.csv'));this.files=x.files;this.dispatchEvent(new Event('change'));};try{importarCSV();}finally{HTMLInputElement.prototype.click=click;}});
  await page.waitForSelector('.csv-preview');
  assert.equal(await page.evaluate(()=>calls.filter(x=>x.type==='csv').length),0);
  await shot('csv-previa','.csv-summary b');
  await page.click('#modal .confirm');await waitText(page,'#modal','Importação concluída');
  assert.equal(await page.evaluate(()=>calls.find(x=>x.type==='csv').rows[0].saldo),-10);
  await shot('csv-confirmado','.import-result h2');
  await page.evaluate(()=>Modais.fechar());

  for(const state of ['error','review','pending','confirmed']){
    await page.evaluate(({state,initial})=>{data=structuredClone(initial);mode=state;document.querySelector('#toasts').replaceChildren();return Fiados.openReceive('qa-c');},{state,initial});
    await page.waitForSelector('[data-receive-confirm]');
    await page.$eval('[name=valor]',e=>e.value='0');
    const before=await page.evaluate(()=>calls.filter(x=>x.type==='payment').length);
    await submit(page,'#modal form');
    assert.equal(await page.evaluate(()=>calls.filter(x=>x.type==='payment').length),before);
    await page.$eval('[name=valor]',e=>{e.value='20';e.dispatchEvent(new Event('input'));});
    await submit(page,'#modal form');
    const field=state==='error'||state==='review'?'[data-receive-feedback]':'#toasts .toast:last-child';
    await waitText(page,field,({error:'indisponível',review:'exige conferência',pending:'Aguardando confirmação',confirmed:'confirmado na nuvem'})[state]);
    await shot('recebimento-'+state,field);
    assert.equal(await page.evaluate(()=>calls.filter(x=>x.type==='payment').length),before+(state==='error'?0:1));
    await page.evaluate(()=>Modais.fechar());
  }

  await page.evaluate(()=>{mode='pending';openPaymentReview('qa-preservado');});
  assert.equal(await page.$('[data-payment-confirm]'),null);
  await page.click('[data-payment-review]');await waitText(page,'[data-payment-result]','revisão manual');
  await shot('recibo-preservado-revisao','[data-payment-result]');
  await page.evaluate(()=>mode='error');
  await page.click('[data-payment-review]');await waitText(page,'[data-payment-result]','Prova insuficiente');
  await shot('recibo-preservado-erro','[data-payment-result]');
  await page.evaluate(()=>mode='confirmed');
  await page.click('[data-payment-review]');await waitText(page,'[data-payment-result]','confirmado no servidor');
  await shot('recibo-preservado-confirmado','[data-payment-result]');
  await page.evaluate(()=>Modais.fechar());

  await page.evaluate(()=>document.querySelector('#toasts').replaceChildren());
  await route('historico');
  await page.evaluate(()=>{data.vendas=[sale];return SaleCancellation.open(sale.id);});
  await page.waitForSelector('[data-cancel-confirm]',{visible:true});
  const colors=await page.$$eval('[data-cancel-close].btn,[data-cancel-confirm]',e=>e.map(n=>[getComputedStyle(n).backgroundColor,getComputedStyle(n).color]));
  assert.notDeepEqual(colors[0],colors[1]);
  await shot('cancelar-venda-confirmacao','[data-cancel-confirm]');
  await submit(page,'[data-cancel-form]');
  assert.equal(await page.evaluate(()=>calls.filter(x=>x.type==='confirmSaleCancellation').length),0);
  await page.focus('[data-cancel-close].btn');
  await page.keyboard.press('Enter');
  assert.equal(await page.$('[data-cancel-form]'),null);
  await page.evaluate(()=>SaleCancellation.open(sale.id));
  await page.evaluate(()=>{const f=document.querySelector('[data-cancel-form]');f.elements.reason.value='Cancelamento QA';f.elements.refundHandling.value='not_due';f.elements.confirmed.checked=true;});
  await submit(page,'[data-cancel-form]');
  await waitText(page,'[data-cancel-summary]','Conferência contábil pendente');
  assert.equal(await page.evaluate(()=>calls.filter(x=>x.type==='confirmSaleCancellation').length),1);
  await shot('cancelamento-revisao','[data-cancel-summary]');
  await page.evaluate(()=>Modais.fechar());
  await route('produtos');
  await page.evaluate(()=>Modais.confirmar('produto fictício',()=>calls.push({type:'delete'})));
  await page.click('.modal-foot .cancel');
  assert.equal(await page.evaluate(()=>calls.filter(x=>x.type==='delete').length),0);
  await page.evaluate(()=>Modais.confirmar('produto fictício',()=>calls.push({type:'delete'})));
  await shot('excluir-produto-confirmacao','.modal-foot .yes');
  await page.click('.modal-foot .yes');
  assert.equal(await page.evaluate(()=>calls.filter(x=>x.type==='delete').length),1);
  for(const [state,selector] of [['timeout','.terminal-wait-head h3'],['error','.terminal-result.is-error h3'],['approved','.terminal-result.is-pending_confirmation h3']]){
    const terminalPage=await context.newPage();
    try{
      terminalPage.on('pageerror',e=>errors.push(e.message));
      await terminalPage.setRequestInterception(true);
      terminalPage.on('request',r=>r.url().startsWith(base+'/')?r.continue():r.abort());
      await terminalPage.setViewport({width,height:850,hasTouch:width===390});
      await terminalPage.goto(base+'/tests/terminal-payments.fixture.html?state='+state,{waitUntil:'domcontentloaded',timeout:30000});
      await terminalPage.waitForSelector(selector,{visible:true,timeout:10000});
      assert.equal(await terminalPage.$eval('html',e=>e.dataset.theme),theme);
      assert.equal(await terminalPage.evaluate(()=>[...document.styleSheets].some(s=>s.href?.includes('/css/veconi-fluxo.css')&&s.cssRules.length>0)),true);
      await shot('terminal-'+state,state==='timeout'?'.terminal-pending-warning':selector,terminalPage);
    }finally{await terminalPage.close();}
  }
  assert.deepEqual(errors,[]);
  await context.close();
 }}finally{writeFileSync(path.join(out,'report.json'),JSON.stringify(results,null,2));await browser.close();server.close();}
 const lowContrast=results.filter(x=>x.contrast!==null&&x.contrast<4.5);
 assert.deepEqual(lowContrast,[], 'Texto crítico abaixo de 4,5:1');
 console.log(JSON.stringify({ok:true,capturas:results.length,lowContrast}));
}
main().catch(e=>{console.error(e);process.exitCode=1;});
