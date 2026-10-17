'use strict';
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml'};
const server=http.createServer((req,res)=>{
 let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);return res.end();}
 const file=path.resolve(root,'.'+pathname);
 if(!file.startsWith(root+path.sep)||!['GET','HEAD'].includes(req.method)){res.writeHead(403);return res.end();}
 // No backend, no proxy, no external connections, local fixture only.
 if(!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);return res.end();}
 res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});if(req.method==='HEAD')return res.end();fs.createReadStream(file).pipe(res);
});
server.listen(0,'127.0.0.1',()=>console.log(`QA local: http://127.0.0.1:${server.address().port}/tests/fixtures/sale-recovery.html`));
