const fs = require("node:fs");
const http = require("node:http");
const os = require("node:os");
const path = require("node:path");
const { spawn } = require("node:child_process");

const ROOT = process.cwd();
const VIEWPORTS = [[320,568],[360,800],[375,812],[390,844],[412,915],[430,932]];
const mime = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png" };
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const chromePath = () => [process.env.CHROME_PATH,"C:/Program Files/Google/Chrome/Application/chrome.exe","C:/Program Files (x86)/Google/Chrome/Application/chrome.exe","/usr/bin/google-chrome","/usr/bin/chromium"].filter(Boolean).find(fs.existsSync) || (() => { throw Error("Chrome não encontrado."); })();
const server = () => http.createServer((request, response) => { const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname), target = path.resolve(ROOT, `.${pathname === "/" ? "/index.html" : pathname}`); if (!target.startsWith(ROOT) || !fs.existsSync(target) || fs.statSync(target).isDirectory()) return response.writeHead(404).end("Not found"); response.setHeader("Content-Type", `${mime[path.extname(target)] || "application/octet-stream"}; charset=utf-8`); fs.createReadStream(target).pipe(response); });
async function waitForFile(file, timeout = 8000) { const started = Date.now(); while (Date.now() - started < timeout) { if (fs.existsSync(file)) return; await sleep(50); } throw Error(`Timeout aguardando ${file}`); }
class Cdp { constructor(url) { this.id=0;this.pending=new Map();this.socket=new WebSocket(url); } async open(){await new Promise((resolve,reject)=>{this.socket.addEventListener("open",resolve,{once:true});this.socket.addEventListener("error",reject,{once:true})});this.socket.addEventListener("message",event=>{const message=JSON.parse(event.data),pending=this.pending.get(message.id);if(!pending)return;this.pending.delete(message.id);message.error?pending.reject(Error(message.error.message)):pending.resolve(message.result)})} send(method,params={}){const id=++this.id;this.socket.send(JSON.stringify({id,method,params}));return new Promise((resolve,reject)=>this.pending.set(id,{resolve,reject}))} close(){this.socket.close()} }
async function evaluate(cdp, expression){const result=await cdp.send("Runtime.evaluate",{expression,awaitPromise:true,returnByValue:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.exception?.description||result.exceptionDetails.text||"Falha na página");return result.result.value}
async function navigate(cdp,url){await cdp.send("Page.navigate",{url});const started=Date.now();while(Date.now()-started<5000){if(await evaluate(cdp,"document.readyState==='complete'&&Boolean(window.__mobileHomeClientsAudit)")){await sleep(180);return}await sleep(40)}throw Error(`Página não carregou: ${url}`)}
async function screenshot(cdp,name){const {data}=await cdp.send("Page.captureScreenshot",{format:"png",fromSurface:true});const folder=path.join(ROOT,"artifacts","mobile-home-clients-polish");fs.mkdirSync(folder,{recursive:true});fs.writeFileSync(path.join(folder,name),Buffer.from(data,"base64"))}

async function main(){
  const staticServer=server();await new Promise(resolve=>staticServer.listen(0,"127.0.0.1",resolve));
  const port=staticServer.address().port,profile=fs.mkdtempSync(path.join(os.tmpdir(),"adi-home-clients-")),chrome=spawn(chromePath(),["--headless=new","--disable-gpu","--no-first-run","--remote-debugging-port=0",`--user-data-dir=${profile}`,"about:blank"],{stdio:"ignore"});let cdp;
  try{
    const portFile=path.join(profile,"DevToolsActivePort");await waitForFile(portFile);const [debugPort]=fs.readFileSync(portFile,"utf8").trim().split(/\r?\n/),target=await fetch(`http://127.0.0.1:${debugPort}/json/new?${encodeURIComponent("about:blank")}`,{method:"PUT"}).then(response=>response.json());cdp=new Cdp(target.webSocketDebuggerUrl);await cdp.open();await cdp.send("Page.enable");await cdp.send("Runtime.enable");
    const report=[];
    for(const [width,height] of VIEWPORTS){
      await cdp.send("Emulation.setDeviceMetricsOverride",{width,height,deviceScaleFactor:1,mobile:true,screenWidth:width,screenHeight:height});
      await navigate(cdp,`http://127.0.0.1:${port}/tests/mobile-home-clients-polish.fixture.html?view=inicio`);
      for(const goal of [0,225,450,1250,12450,125000]){await evaluate(cdp,`window.__setGoal(${goal})`);await sleep(60);const current=await evaluate(cdp,"window.__collectAudit()");if(current.horizontalOverflow||current.goalOverlap||current.goalWidth>current.goalClientWidth+1)throw Error(`${width}x${height}: meta inválida ${JSON.stringify({goal,...current})}`)}
      const home=await evaluate(cdp,"window.__collectAudit()");if(home.attentionCount<1||home.attentionCount>4)throw Error(`${width}x${height}: Atenção agora inválida ${JSON.stringify(home)}`);
      const emptyAttention=await evaluate(cdp,`MobileHome.attentionItems({out:[],low:[],renewals:{dueToday:0,due7:0,forecastValue:0},pendingOrders:[],debtors:[],debt:0}).length`);if(emptyAttention!==0)throw Error(`${width}x${height}: estado vazio de atenção ausente`);
      await navigate(cdp,`http://127.0.0.1:${port}/tests/mobile-home-clients-polish.fixture.html?view=clientes`);const clients=await evaluate(cdp,"window.__collectAudit()");if(clients.horizontalOverflow||clients.clientCards!==5||clients.kpiHeights.some(value=>value>94))throw Error(`${width}x${height}: Clientes inválido ${JSON.stringify(clients)}`);
      await evaluate(cdp,`(()=>{const input=document.querySelector('#mobile-client-search');input.value='Jessica';input.dispatchEvent(new Event('input',{bubbles:true}));return true})()`);await sleep(360);const search=await evaluate(cdp,`({cards:document.querySelectorAll('.mobile-client-card').length,text:document.querySelector('#mobile-client-list').textContent,clear:Boolean(document.querySelector('.mobile-search-clear')),renewal:Boolean(document.querySelector('.mobile-client-context.renewal'))})`);if(search.cards!==1||!/Jessica Arezzo/.test(search.text)||!search.clear||search.renewal)throw Error(`${width}x${height}: busca inválida ${JSON.stringify(search)}`);
      await navigate(cdp,`http://127.0.0.1:${port}/tests/mobile-home-clients-polish.fixture.html?view=renewal`);const renewal=await evaluate(cdp,"window.__collectAudit()");if(renewal.horizontalOverflow||!renewal.hasRenewal||!/renovaç|vence/i.test(renewal.renewalText))throw Error(`${width}x${height}: renovação inválida ${JSON.stringify(renewal)}`);
      report.push({viewport:`${width}x${height}`,home,clients,search,renewal});
      if(width===390){await navigate(cdp,`http://127.0.0.1:${port}/tests/mobile-home-clients-polish.fixture.html?view=inicio`);await screenshot(cdp,"home-390x844.png");await navigate(cdp,`http://127.0.0.1:${port}/tests/mobile-home-clients-polish.fixture.html?view=clientes`);await screenshot(cdp,"clientes-390x844.png");await navigate(cdp,`http://127.0.0.1:${port}/tests/mobile-home-clients-polish.fixture.html?view=renewal`);await screenshot(cdp,"cliente-renovacao-390x844.png")}
    }
    console.log(JSON.stringify({ok:true,report,screenshots:"artifacts/mobile-home-clients-polish"},null,2));
  }finally{cdp?.close();chrome.kill();staticServer.close();await sleep(150);try{fs.rmSync(profile,{recursive:true,force:true})}catch{}}
}
main().catch(error=>{console.error(error.stack||error.message);process.exitCode=1});
