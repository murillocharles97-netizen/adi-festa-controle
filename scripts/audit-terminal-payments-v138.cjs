const fs=require('node:fs');
const http=require('node:http');
const path=require('node:path');
const puppeteer=require('puppeteer');

const ROOT=process.cwd();
const OUTPUT=path.join(ROOT,'docs','screenshots','terminal-payments-v138');
const MIME={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'};
const server=http.createServer((request,response)=>{
  const pathname=decodeURIComponent(new URL(request.url,'http://localhost').pathname);
  const file=path.resolve(ROOT,`.${pathname==='/'?'/tests/terminal-payments.fixture.html':pathname}`);
  if(!file.startsWith(`${ROOT}${path.sep}`)||!fs.existsSync(file)||!fs.statSync(file).isFile())return response.writeHead(404).end('Not found');
  response.writeHead(200,{'Content-Type':MIME[path.extname(file)]||'application/octet-stream'});
  fs.createReadStream(file).pipe(response);
});
const mobileWidths=[360,375,390,412,430];
const cases=[
  ...mobileWidths.map(width=>({width,height:Math.round(width*2.16),state:'options',file:`${width}-checkout-options.png`})),
  {width:390,height:844,state:'settings',file:'390-settings-terminals.png'},
  {width:390,height:844,state:'waiting',file:'390-awaiting-payment.png'},
  {width:390,height:844,state:'timeout',file:'390-timeout-reconciliation.png'},
  {width:390,height:844,state:'declined',file:'390-declined-retry.png'},
  {width:390,height:844,state:'no-terminal',file:'390-no-terminal.png'},
  {width:1366,height:768,state:'settings',file:'1366-settings-terminals.png'},
  {width:1366,height:768,state:'options',file:'1366-checkout-options.png'},
  {width:1366,height:768,state:'waiting',file:'1366-awaiting-payment.png'},
];

async function audit(page,item){
  await page.setViewport({width:item.width,height:item.height,deviceScaleFactor:1,isMobile:item.width<768,hasTouch:item.width<768});
  await page.goto(`http://127.0.0.1:${server.address().port}/tests/terminal-payments.fixture.html?state=${item.state}`,{waitUntil:'domcontentloaded',timeout:30000});
  const selector={settings:'.terminal-settings-modal .terminal-row',options:'[data-terminal-checkout-form]',waiting:'.terminal-status-orb.is-processing',timeout:'.terminal-status-orb.is-pending_confirmation',declined:'.terminal-result.is-declined','no-terminal':'.terminal-empty h3'}[item.state];
  await page.waitForSelector(selector,{timeout:10000});
  const result=await page.evaluate(({width,state})=>{
    const dialog=document.querySelector('#modal .modal-box'),rect=dialog.getBoundingClientRect(),text=dialog.textContent||'';
    const controls=[...dialog.querySelectorAll('button:not(.icon-btn),select')].filter(element=>getComputedStyle(element).display!=='none'&&!element.hidden);
    const undersized=innerWidth<768?controls.map(element=>({text:(element.textContent||element.value||element.tagName).trim().slice(0,35),height:element.getBoundingClientRect().height})).filter(item=>item.height<43.5):[];
    const problems=[];
    if(document.documentElement.scrollWidth>innerWidth+1)problems.push('overflow horizontal');
    if(rect.left<-1||rect.right>width+1||rect.top<-1||rect.bottom>innerHeight+1)problems.push('modal fora da viewport');
    if(undersized.length)problems.push('controle menor que 44px');
    if(/paymentintent|webhook|\bprovider\b|\badapter\b|\bengine\b/i.test(text))problems.push('linguagem técnica exposta');
    if(state==='timeout'&&(!text.includes('Timeout não significa pagamento recusado')||!text.includes('Verificar status')))problems.push('timeout sem reconciliação clara');
    if(state==='declined'&&(!text.includes('Tentar novamente')||!text.includes('Outra forma de pagamento')))problems.push('recusa sem alternativas');
    if(state==='no-terminal'&&!text.includes('Configurar maquininha'))problems.push('terminal ausente sem configuração');
    return{width:innerWidth,state,horizontalOverflow:document.documentElement.scrollWidth-innerWidth,dialog:{left:Math.round(rect.left),right:Math.round(rect.right),top:Math.round(rect.top),bottom:Math.round(rect.bottom)},controls:controls.length,undersized,problems};
  },{width:item.width,state:item.state});
  if(result.problems.length)throw Error(`${item.file}: ${JSON.stringify(result)}`);
  await page.screenshot({path:path.join(OUTPUT,item.file),fullPage:false});
  return result;
}

async function main(){
  fs.mkdirSync(OUTPUT,{recursive:true});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await puppeteer.launch({headless:true});
  try{
    const page=await browser.newPage(),errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    page.on('dialog',dialog=>void dialog.accept());
    const results=[];
    for(const item of cases)results.push(await audit(page,item));
    if(errors.length)throw Error(`Erros de página: ${JSON.stringify(errors)}`);
    const report={ok:true,version:138,mobileWidths,checks:results.length,screenshots:cases.map(item=>item.file),pageErrors:errors,results};
    fs.writeFileSync(path.join(OUTPUT,'browser-results.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({ok:report.ok,checks:report.checks,mobileWidths:report.mobileWidths,pageErrors:report.pageErrors,output:OUTPUT},null,2));
  }finally{await browser.close();server.close();}
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1;});
