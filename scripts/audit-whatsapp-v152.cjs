const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chromePath = () => [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","/usr/bin/google-chrome","/usr/bin/chromium"].filter(Boolean).find(fs.existsSync) || (() => { throw Error("Chrome não encontrado."); })();
const server = () => http.createServer((request, response) => { const pathname=decodeURIComponent(new URL(request.url,"http://localhost").pathname),target=path.resolve(ROOT,`.${pathname}`);if(!target.startsWith(ROOT)||!fs.existsSync(target)||fs.statSync(target).isDirectory())return response.writeHead(404).end("Not found");response.setHeader("Content-Type",path.extname(target)===".html"?"text/html; charset=utf-8":path.extname(target)===".css"?"text/css; charset=utf-8":"text/javascript; charset=utf-8");fs.createReadStream(target).pipe(response); });
async function waitForFile(file,timeout=8000){const started=Date.now();while(Date.now()-started<timeout){if(fs.existsSync(file))return;await sleep(50)}throw Error(`Timeout aguardando ${file}`)}
class Cdp{constructor(url){this.id=0;this.pending=new Map();this.socket=new WebSocket(url)}async open(){await new Promise((resolve,reject)=>{this.socket.addEventListener("open",resolve,{once:true});this.socket.addEventListener("error",reject,{once:true})});this.socket.addEventListener("message",event=>{const message=JSON.parse(event.data),pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);message.error?pending.reject(Error(message.error.message)):pending.resolve(message.result)})}send(method,params={}){const id=++this.id;this.socket.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}))}close(){this.socket.close()}}
async function evaluate(cdp,expression){const result=await cdp.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||"Falha na página");return result.result.value}
const assert = (condition,message) => { if(!condition) throw Error(message); };

async function main(){
  const staticServer=server();await new Promise(resolve=>staticServer.listen(0,"127.0.0.1",resolve));
  const port=staticServer.address().port,profile=fs.mkdtempSync(path.join(os.tmpdir(),"veconi-whatsapp-v152-")),chrome=spawn(chromePath(),["--headless=new","--disable-gpu","--no-first-run","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});let cdp;
  try{
    const portFile=path.join(profile,"DevToolsActivePort");await waitForFile(portFile);const [debugPort]=fs.readFileSync(portFile,"utf8").trim().split(/\r?\n/),target=await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`,{method:"PUT"}).then(response=>response.json());cdp=new Cdp(target.webSocketDebuggerUrl);await cdp.open();await cdp.send("Page.enable");await cdp.send("Runtime.enable");await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true,screenWidth:390,screenHeight:844});await cdp.send("Page.navigate",{url:`http://127.0.0.1:${port}/tests/whatsapp-v152.fixture.html`});
    for(let i=0;i<100;i++){if(await evaluate(cdp,"Boolean(window.MobileMessages&&window.Mensagens)"))break;await sleep(50)}

    await evaluate(cdp,"MobileMessages.openComposer('c1')");
    await evaluate(cdp,"document.querySelector('#message-send').click()");
    let snapshot=await evaluate(cdp,"({confirm:Boolean(document.querySelector('[data-charge-confirm-layer]')),opened:__whatsappAudit.opened.length,history:__whatsappAudit.data.messageHistory.length,nativeConfirm:__whatsappAudit.confirmCalls})");
    assert(snapshot.confirm&&snapshot.opened===0&&snapshot.history===0&&snapshot.nativeConfirm===0,`confirmação individual inválida ${JSON.stringify(snapshot)}`);
    await evaluate(cdp,"document.querySelector('[data-charge-send-cancel]').click()");
    snapshot=await evaluate(cdp,"({confirm:Boolean(document.querySelector('[data-charge-confirm-layer]')),opened:__whatsappAudit.opened.length,history:__whatsappAudit.data.messageHistory.length})");
    assert(!snapshot.confirm&&snapshot.opened===0&&snapshot.history===0,`cancelamento registrou cobrança ${JSON.stringify(snapshot)}`);
    await evaluate(cdp,"document.querySelector('#message-send').click();const button=document.querySelector('[data-charge-send-continue]');button.click();button.click()");
    snapshot=await evaluate(cdp,"({opened:__whatsappAudit.opened.length,history:__whatsappAudit.data.messageHistory.length,charges:__whatsappAudit.data.cobrancas.length,amount:__whatsappAudit.data.messageHistory[0]?.amountAtSend,role:__whatsappAudit.data.messageHistory[0]?.actorRoleSnapshot,url:__whatsappAudit.opened[0],logs:__whatsappAudit.logs})");
    assert(snapshot.opened===1&&snapshot.history===1&&snapshot.charges===1,`duplo toque duplicou ação ${JSON.stringify(snapshot)}`);
    assert(snapshot.amount===351.84&&snapshot.role==="owner"&&/wa\.me\/5517999991111/.test(snapshot.url),`dados individuais incorretos ${JSON.stringify(snapshot)}`);
    await evaluate(cdp,"MobileMessages.showReturn();document.querySelector('[data-return-next]')?.click()");

    await cdp.send("Page.navigate",{url:`http://127.0.0.1:${port}/tests/whatsapp-v152.fixture.html?sequence=1`});for(let i=0;i<100;i++){if(await evaluate(cdp,"Boolean(window.MobileMessages&&window.Mensagens)"))break;await sleep(50)}
    await evaluate(cdp,"__resetWhatsappAudit()");
    await evaluate(cdp,"MobileMessages.openCenter();document.querySelector('[data-center-start]').click()");await sleep(40);
    snapshot=await evaluate(cdp,"({position:document.querySelector('.individual-message-sheet header small')?.textContent,toast:__whatsappAudit.toasts.at(-1)?.message,sequenceCount:__whatsappAudit.data.messageSequences.length})");
    assert(snapshot.position==="Enviando para 1 de 3"&&/1 de 3/.test(snapshot.toast)&&snapshot.sequenceCount===1,`sequência não iniciou ${JSON.stringify(snapshot)}`);
    for(let index=1;index<=3;index++){
      await evaluate(cdp,"document.querySelector('#message-send').click();document.querySelector('[data-charge-send-continue]').click();MobileMessages.showReturn()");
      snapshot=await evaluate(cdp,"({returnVisible:Boolean(document.querySelector('[data-return-next]')),opened:__whatsappAudit.opened.length,history:__whatsappAudit.data.messageHistory.length})");
      assert(snapshot.returnVisible&&snapshot.opened===index&&snapshot.history===index,`retorno ${index} inválido ${JSON.stringify(snapshot)}`);
      await evaluate(cdp,"document.querySelector('[data-return-next]').click()");await sleep(30);
      if(index<3){const position=await evaluate(cdp,"document.querySelector('.individual-message-sheet header small')?.textContent");assert(position===`Enviando para ${index+1} de 3`,`posição ${index+1} perdida: ${position}`)}
    }
    snapshot=await evaluate(cdp,"({finished:Boolean(document.querySelector('.message-finish-sheet')),sequence:__whatsappAudit.data.messageSequences[0],logs:__whatsappAudit.logs})");
    assert(snapshot.finished&&snapshot.sequence.status==="completed"&&snapshot.sequence.completedIds.length===3,`sequência incompleta ${JSON.stringify(snapshot)}`);

    await evaluate(cdp,"__resetWhatsappAudit();MobileMessages.openComposer('c4')");await sleep(20);
    snapshot=await evaluate(cdp,"({disabled:document.querySelector('#message-send')?.disabled,error:document.querySelector('.message-phone-error')?.textContent})");
    assert(snapshot.disabled&&/telefone válido/i.test(snapshot.error),`telefone inválido não foi isolado ${JSON.stringify(snapshot)}`);

    await evaluate(cdp,"__resetWhatsappAudit();MobileMessages.openCenter();__whatsappAudit.throwAlter=true;document.querySelector('[data-center-start]').click()");
    snapshot=await evaluate(cdp,"({toast:__whatsappAudit.toasts.at(-1),composer:Boolean(document.querySelector('.individual-message-sheet')),logs:__whatsappAudit.logs})");
    assert(snapshot.toast?.error&&!snapshot.composer&&snapshot.logs.some(item=>item.includes('[SEQUENCE] start failed')),`erro silencioso na sequência ${JSON.stringify(snapshot)}`);

    await cdp.send("Emulation.setDeviceMetricsOverride",{width:1280,height:900,deviceScaleFactor:1,mobile:false,screenWidth:1280,screenHeight:900});
    await cdp.send("Page.navigate",{url:`http://127.0.0.1:${port}/tests/whatsapp-v152.fixture.html?desktop=1`});for(let i=0;i<100;i++){if(await evaluate(cdp,"Boolean(window.ClientActions&&window.Mensagens)"))break;await sleep(50)}
    await evaluate(cdp,"ClientActions.run('charge','c1')");
    snapshot=await evaluate(cdp,"({fallback:__whatsappAudit.desktopFallback})");
    assert(snapshot.fallback==="c1",`entry point desktop não chegou ao compositor ${JSON.stringify(snapshot)}`);
    snapshot=await evaluate(cdp,"(()=>{const c=Clientes.obter('c1'),message=Mensagens.resolve(Mensagens.defaultTemplate('charge').content,c),url=Mensagens.whatsappUrl(c,message),opened=Mensagens.openWhatsApp(url,{mobile:false});const record=opened.opened?Mensagens.registerOpened({clientId:c.id,type:'charge',source:'desktop_test',finalMessage:message,operationId:'desktop:1'}):null;return{opened:opened.opened,method:opened.method,url:__whatsappAudit.opened.at(-1),history:__whatsappAudit.data.messageHistory.length,record:Boolean(record)}})()");
    assert(snapshot.opened&&snapshot.method==="popup"&&/wa\.me\/5517999991111/.test(snapshot.url)&&snapshot.history===1&&snapshot.record,`WhatsApp Web desktop inválido ${JSON.stringify(snapshot)}`);
    await cdp.send("Emulation.setDeviceMetricsOverride",{width:390,height:844,deviceScaleFactor:1,mobile:true,screenWidth:390,screenHeight:844});
    await cdp.send("Page.navigate",{url:`http://127.0.0.1:${port}/tests/whatsapp-v152.fixture.html?canonical=1`});for(let i=0;i<100;i++){if(await evaluate(cdp,"Boolean(window.MobileMessages&&window.Mensagens)"))break;await sleep(50)}
    const canonicalCases=[['mae','Mãe',550],['joao','João Adidas',125.5],['kami','Kami Adidas',89.9]];
    const canonicalResults=[];
    for(const [id,name,amount] of canonicalCases){
      await evaluate(cdp,"__resetWhatsappAudit()");
      await evaluate(cdp,`MobileMessages.openComposer(${JSON.stringify(id)})`);
      snapshot=await evaluate(cdp,"({name:document.querySelector('.message-client-summary h3')?.textContent,shown:document.querySelector('.message-client-summary strong')?.textContent,preview:document.querySelector('#message-preview')?.textContent,reads:__whatsappAudit.canonicalReads.slice(),balance:__whatsappAudit.data.clientes.find(item=>item.id==='"+id+"')?.saldo,logs:__whatsappAudit.logs.slice()})");
      assert(snapshot.name===name&&snapshot.reads.length===1&&snapshot.reads[0]===id&&Math.abs(snapshot.balance)===amount,`saldo canônico de ${name} inválido ${JSON.stringify(snapshot)}`);
      assert(snapshot.preview.includes(name.split(' ')[0])&&snapshot.preview.replace(/\s/g,' ').includes(amount.toLocaleString('pt-BR',{minimumFractionDigits:2,maximumFractionDigits:2})),`mensagem canônica de ${name} inválida ${JSON.stringify(snapshot)}`);
      assert(snapshot.logs.some(item=>item.includes('[CHARGE] requesting canonical balance'))&&snapshot.logs.some(item=>item.includes('[CHARGE] confirmed balance')),`instrumentação de ${name} ausente ${JSON.stringify(snapshot)}`);
      await evaluate(cdp,"document.querySelector('#message-send').click();document.querySelector('[data-charge-send-continue]').click()");
      snapshot=await evaluate(cdp,"({opened:__whatsappAudit.opened.length,history:__whatsappAudit.data.messageHistory.length,amount:__whatsappAudit.data.messageHistory[0]?.amountAtSend,balance:__whatsappAudit.data.clientes.find(item=>item.id==='"+id+"')?.saldo,url:__whatsappAudit.opened[0]})");
      assert(snapshot.opened===1&&snapshot.history===1&&snapshot.amount===amount&&snapshot.balance===-amount,`envio canônico de ${name} inválido ${JSON.stringify(snapshot)}`);
      canonicalResults.push({name,cardBalance:amount,confirmedBalance:amount,messageBalance:amount});
    }

    await evaluate(cdp,"__resetWhatsappAudit();MobileMessages.openComposer('zero')");
    snapshot=await evaluate(cdp,"({composer:Boolean(document.querySelector('.individual-message-sheet')),toast:__whatsappAudit.toasts.at(-1)?.message,opened:__whatsappAudit.opened.length,history:__whatsappAudit.data.messageHistory.length})");
    assert(!snapshot.composer&&/não possui saldo em aberto/i.test(snapshot.toast)&&snapshot.opened===0&&snapshot.history===0,`cliente sem débito gerou cobrança ${JSON.stringify(snapshot)}`);

    await evaluate(cdp,"__resetWhatsappAudit();__whatsappAudit.canonicalError=Object.assign(Error('Missing or insufficient permissions'),{code:'permission-denied',stage:'client-document-read'});MobileMessages.openComposer('mae')");await sleep(20);
    snapshot=await evaluate(cdp,"({toast:__whatsappAudit.toasts.at(-1)?.message,logs:__whatsappAudit.logs,opened:__whatsappAudit.opened.length})");
    assert(/acesso não permite confirmar/i.test(snapshot.toast)&&snapshot.logs.some(item=>item.includes('[CHARGE ERROR]')&&item.includes('permission-denied')&&item.includes('client-document-read'))&&snapshot.opened===0,`permission-denied foi mascarado ${JSON.stringify(snapshot)}`);

    await evaluate(cdp,"__resetWhatsappAudit();__whatsappAudit.canonicalError=Object.assign(Error('Sem snapshot confirmado'),{code:'offline-unconfirmed',stage:'offline'});MobileMessages.openComposer('mae')");await sleep(20);
    snapshot=await evaluate(cdp,"({toast:__whatsappAudit.toasts.at(-1)?.message,opened:__whatsappAudit.opened.length})");
    assert(/Conecte-se à internet para enviar a cobrança/i.test(snapshot.toast)&&snapshot.opened===0,`offline permitiu cobrança ${JSON.stringify(snapshot)}`);

    await evaluate(cdp,"__resetWhatsappAudit();__setWhatsappRole('seller');MobileMessages.openComposer('mae')");
    snapshot=await evaluate(cdp,"({toast:__whatsappAudit.toasts.at(-1)?.message,reads:__whatsappAudit.canonicalReads.length,composer:Boolean(document.querySelector('.individual-message-sheet'))})");
    assert(/acesso não permite enviar cobranças/i.test(snapshot.toast)&&snapshot.reads===0&&!snapshot.composer,`seller sem permissão não foi bloqueado ${JSON.stringify(snapshot)}`);
    await evaluate(cdp,"__resetWhatsappAudit();__setWhatsappRole('manager');MobileMessages.openComposer('mae')");
    snapshot=await evaluate(cdp,"({composer:Boolean(document.querySelector('.individual-message-sheet')),reads:__whatsappAudit.canonicalReads.length,role:__whatsappAudit.role})");
    assert(snapshot.composer&&snapshot.reads===1&&snapshot.role==='manager',`manager permitido foi bloqueado ${JSON.stringify(snapshot)}`);

    console.log(JSON.stringify({ok:true,individual:{opened:1,idempotent:true,cancelledWithoutRecord:true,amountAtSend:351.84},canonical:{clients:canonicalResults,zeroDebtBlocked:true,offlineBlocked:true,permissionErrorExposed:true,noFinancialMutation:true},sequence:{customers:3,status:"completed",preservedPosition:true},invalidPhone:true,permissions:{owner:true,manager:true,sellerWithoutCharge:false},instrumentation:true,mobilePwaEquivalent:true,desktop:{entryPoint:true,whatsappWeb:true}},null,2));
  }finally{cdp?.close();chrome.kill();staticServer.close();await sleep(150);try{fs.rmSync(profile,{recursive:true,force:true})}catch{}}
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1});
