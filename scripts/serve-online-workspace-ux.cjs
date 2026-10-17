'use strict';
// Local visual preview only. No credentials, Firebase initialization or cloud writes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),fixture='/tests/fixtures/online-workspace-mobile.html';
const styles=[...fs.readFileSync(path.join(root,'index.html'),'utf8').matchAll(/<link rel="stylesheet" href="\.\/([^"?]+)(?:\?[^" ]*)?">/g)].map(m=>`<link rel="stylesheet" href="/${m[1]}">`).join('\n');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.gif':'image/gif','.webp':'image/webp','.woff2':'font/woff2'};
http.createServer((req,res)=>{
  const pathname=new URL(req.url,'http://127.0.0.1:8196').pathname;
  if(req.method!=='GET'||pathname==='/service-worker.js'||pathname==='/index.html'||pathname==='/'){res.writeHead(403);res.end('Somente prévia visual local.');return;}
  let file;try{file=path.resolve(root,'.'+decodeURIComponent(pathname));}catch{res.writeHead(400);res.end();return;}
  const relative=path.relative(root,file);if(relative.startsWith('..')||path.isAbsolute(relative)||!['css','assets','js','functions/src/shared','tests/fixtures'].some(folder=>relative.startsWith(folder.replaceAll('/',path.sep)+path.sep))){res.writeHead(403);res.end();return;}
  if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
  let content=fs.readFileSync(file);if(pathname===fixture)content=content.toString().replace('<!-- APP_STYLES -->',styles);
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'; font-src 'self' data:; frame-src 'self'; object-src 'none'; base-uri 'self'"});res.end(content);
}).listen(8196,'127.0.0.1',()=>console.log(`Prévia local: http://127.0.0.1:8196${fixture}?page=catalog&width=390`));
