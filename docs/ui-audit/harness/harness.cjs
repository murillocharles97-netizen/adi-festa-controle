// UI audit harness: serves the real index.html (all production CSS/JS) with a
// synthetic local owner session. Firebase modules are not loaded; every
// non-loopback request is aborted by the caller. Nothing here touches real data.
const http=require('http'),fs=require('fs'),path=require('path');
const SEED=fs.readFileSync(path.join(__dirname,'seed.js'),'utf8');
const STUB=`<script>
window.__auditErrors=[];addEventListener('error',e=>__auditErrors.push(e.message));addEventListener('unhandledrejection',e=>__auditErrors.push(String(e.reason?.message||e.reason)));
window.BusinessContext={get:()=>({businessId:'audit-business',business:{id:'audit-business',ownerId:'audit-owner',active:true},userProfile:{uid:'audit-owner',businessId:'audit-business',active:true,role:'owner'},member:{uid:'audit-owner',role:'owner',status:'active',spaceAccess:'all',permissionsVersion:3,permissions:{}},role:'owner',status:'active',spaceAccess:'all',allowedSpaceIds:[],permissions:['*'],access:{canMutate:true,planId:'internal'},loading:false,error:null}),canAccessSpace:()=>true,subscribe:()=>()=>{}};
window.FirebaseCallable=async()=>{throw Object.assign(Error('offline-audit'),{code:'unavailable'});};
</script>`;
function page(root){
 let html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 html=html.replace(/<script[^>]*src="[^"]*(?:js\/firebase\/|pwa-update|tutorial-engine|app-intro-tutorial)[^"]*"[^>]*><\/script>\s*/g,'');
 html=html.replace(/<script type="module"[\s\S]*?<\/script>/g,'');
 html=html.replace('<head>','<head>'+STUB);
 html=html.replace(/(<script[^>]*src="\.\/js\/app\.js[^"]*"[^>]*><\/script>)/,`<script>${SEED}</script>$1`);
 return html;
}
function serve(root){
 const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.json':'application/json','.webp':'image/webp','.jpg':'image/jpeg','.woff2':'font/woff2'};
 return http.createServer((req,res)=>{
  const url=new URL(req.url,'http://x');
  if(url.pathname==='/audit.html'){res.setHeader('Content-Type','text/html; charset=utf-8');return res.end(page(root));}
  const extra=path.join(__dirname,'..','prototypes',path.basename(url.pathname));
  if(url.pathname.startsWith('/__proto/')&&fs.existsSync(extra)){res.setHeader('Content-Type',(mime[path.extname(extra)]||'text/plain')+'; charset=utf-8');return fs.createReadStream(extra).pipe(res);}
  const file=path.resolve(root,'.'+decodeURIComponent(url.pathname));
  if(!file.startsWith(root)||!fs.existsSync(file)||!fs.statSync(file).isFile())return res.writeHead(404).end();
  res.setHeader('Content-Type',(mime[path.extname(file)]||'application/octet-stream')+'; charset=utf-8');fs.createReadStream(file).pipe(res);
 });
}
module.exports={serve,page};
