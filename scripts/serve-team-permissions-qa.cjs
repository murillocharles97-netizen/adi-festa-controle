'use strict';
// Static QA only: loopback binding, no proxy, no Firebase, no production writes.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..');
http.createServer((req,res)=>{
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405).end();return;}
  let pathname;
  try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400).end();return;}
  if(!/^\/(?:assets\/|css\/|js\/|functions\/src\/shared\/permission-policy\.js$|tests\/team-permissions\.fixture\.html$)/.test(pathname)){res.writeHead(404).end();return;}
  const file=path.resolve(root,'.'+pathname);
  if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404).end();return;}
  const type={'.html':'text/html','.js':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png'}[path.extname(file)]||'application/octet-stream';
  res.writeHead(200,{'Content-Type':type+'; charset=utf-8','Cache-Control':'no-store','Content-Security-Policy':"default-src 'self'; connect-src 'none'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'"});
  res.end(req.method==='HEAD'?undefined:fs.readFileSync(file));
}).listen(0,'127.0.0.1',function(){console.log(`Permissões QA local: http://127.0.0.1:${this.address().port}/tests/team-permissions.fixture.html`);});
