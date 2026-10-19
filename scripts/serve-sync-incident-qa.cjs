'use strict';
// Local UI fixture only. No proxy, credentials or production SDK initialization.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(403).end();return;}
 let content,type;
 if(pathname==='/qa-sync-ui.js'){content=fs.readFileSync(path.join(root,'js/firebase/firebase-ui.js'),'utf8').replace(/^import .*;\r?\n/gm,'');type='text/javascript';}
 else{
  const file=path.resolve(root,'.'+decodeURIComponent(pathname));
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  content=fs.readFileSync(file);type=({'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml'})[path.extname(file)]||'application/octet-stream';
 }
 res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'"});res.end(req.method==='HEAD'?undefined:content);
}).listen(0,'127.0.0.1',function(){console.log(`QA local: http://127.0.0.1:${this.address().port}/tests/fixtures/sync-incident.html`);});
