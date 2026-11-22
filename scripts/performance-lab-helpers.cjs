'use strict';
const fs=require('node:fs'),path=require('node:path'),http=require('node:http'),zlib=require('node:zlib');
const puppeteer=require('puppeteer-core');
const root=path.resolve(__dirname,'..'), out=path.join(root,'qa-artifacts','performance');
fs.mkdirSync(out,{recursive:true});
const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.png':'image/png','.woff2':'font/woff2','.webp':'image/webp'};
const sdkPrefix='https://www.gstatic.com/firebasejs/10.13.2/';
const links=html=>[...html.matchAll(/<link[^>]+rel="stylesheet"[^>]*>/g)].map(m=>m[0].replace('href="./','href="/')).join('');
function assetServer(rewrite=()=>null, isOffline=()=>false){
 const packed=new Map();
 return http.createServer((req,res)=>{
  if(isOffline())return res.destroy();
  const url=new URL(req.url,'http://127.0.0.1'), location=url.pathname==='/'?'/index.html':url.pathname;
  const local=location.startsWith('/qa-sdk/')?path.join(out,'sdk',path.basename(location)):path.resolve(root,'.'+location);
  const ext=path.extname(local);let cached=packed.get(location+url.search);
  if(!cached){
   let source=rewrite(location,url);
   if(source===null){
    if(!local.startsWith(root+path.sep)||!fs.existsSync(local)||!fs.statSync(local).isFile())return res.writeHead(404).end();
    source=fs.readFileSync(local);
   }
   if(ext==='.js'||ext==='.html')source=Buffer.from(String(source).replaceAll(sdkPrefix,'/qa-sdk/'));
   const gzip=/^(text\/|application\/json)/.test(mime[ext]||'');
   cached={body:source,gzip:gzip?zlib.gzipSync(source):null};packed.set(location+url.search,cached);
  }
  if(!['GET','HEAD'].includes(req.method))return res.writeHead(405).end();
  res.setHeader('Content-Type',mime[ext]||'application/octet-stream');
  res.setHeader('Cache-Control',location==='/index.html'||location==='/service-worker.js'?'no-cache':'public, max-age=3600');
  if(cached.gzip&&/gzip/.test(req.headers['accept-encoding']||'')){
   res.setHeader('Content-Encoding','gzip');res.setHeader('Content-Length',cached.gzip.length);
   return res.end(cached.gzip);
  }
  res.setHeader('Content-Length',Buffer.byteLength(cached.body));res.end(cached.body);
 });
}
async function launch(){return puppeteer.launch({headless:true,protocolTimeout:15000,args:['--disable-background-networking','--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE 127.0.0.1'],executablePath:process.env.CHROME_PATH||'C:/Program Files/Google/Chrome/Application/chrome.exe'});}
async function setup(page,{mobile,theme,allowed,deny=()=>false,intercept=true}){
 await page.setViewport({width:mobile?390:1440,height:mobile?844:950,isMobile:mobile,hasTouch:mobile});
 await page.emulateMediaFeatures([{name:'prefers-color-scheme',value:theme}]);
 // Deny cloud targets even if an application module constructs an absolute URL.
 if(intercept) {
 await page.setRequestInterception(true);
 page.on('request',r=>{
   let u;try{u=new URL(r.url());}catch{return r.abort();}
   if(['blob:','data:','about:'].includes(u.protocol))return r.continue();
   return allowed.includes(u.origin)&&!deny(u)?r.continue():r.abort();
 });
 }
 await page.evaluateOnNewDocument(()=>{
  window.__lab={long:[],events:[],errors:[]};
  addEventListener('error',event=>{if(event.message)window.__lab.errors.push(event.message);});
  performance.setResourceTimingBufferSize(2000);
  new PerformanceObserver(l=>window.__lab.long.push(...l.getEntries().map(e=>({at:e.startTime,ms:e.duration})))).observe({type:'longtask',buffered:true});
  for(const e of ['firebase-auth-ready','firebase-ui-mounted','firebase-sync-status'])window.addEventListener(e,event=>{
    const s=event.detail;window.__lab.events.push({at:performance.now(),event:e,status:s?.status,hydrated:s?.hydrated,listener:s?.listenerConnected});
  });
 });
 const cdp=await page.createCDPSession();
 await cdp.send('Performance.enable');
 if(mobile){await cdp.send('Emulation.setCPUThrottlingRate',{rate:4});await cdp.send('Network.emulateNetworkConditions',{offline:false,latency:80,downloadThroughput:200000,uploadThroughput:93750});}
 return cdp;
}
async function metrics(cdp){return Object.fromEntries((await cdp.send('Performance.getMetrics')).metrics.map(m=>[m.name,m.value]));}
function delta(a,b,navigation=false){
 return Object.fromEntries(['ScriptDuration','TaskDuration','LayoutDuration','RecalcStyleDuration'].map(k=>[k+'Ms',+((b[k]-(navigation?0:a[k]))*1000).toFixed(2)]).concat([['heapUsedMB',+(b.JSHeapUsedSize/1048576).toFixed(2)],['domNodes',b.Nodes],['domListeners',b.JSEventListeners]]));
}
function profiler(raw){
 const byId=new Map(raw.nodes.map(n=>[n.id,n.callFrame])), cost=new Map();
 raw.samples?.forEach((id,i)=>{
   const f=byId.get(id);if(!f||f.functionName.startsWith('('))return;
   const key=f.functionName+' '+f.url.replace(/^http:\/\/127\.0\.0\.1:\d+/,'')+':'+(f.lineNumber+1);
   cost.set(key,(cost.get(key)||0)+(raw.timeDeltas?.[i]||0)/1000);
 });
 return [...cost].sort((a,b)=>b[1]-a[1]).slice(0,20).map(([symbol,ms])=>({symbol,ms:+ms.toFixed(1)}));
}
async function listen(server){await new Promise(r=>server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+server.address().port;}
function save(name,value){fs.writeFileSync(path.join(out,name),JSON.stringify(value,null,2));}
module.exports={root,out,links,assetServer,launch,setup,metrics,delta,profiler,listen,save};
