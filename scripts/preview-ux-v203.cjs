'use strict';
// Local-only, explicit allowlist. Not a deploy server and never serves repository history.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),prefix='/docs/qa/ux-v203/';
const allowed=new Set([
 '/tests/fixtures/login-v203.html','/tests/fixtures/login-v203.css','/tests/fixtures/login-v203.js',
 '/tests/fixtures/receipt-viewport-v203.html','/tests/fixtures/recovery-notice-v203.html',
 ...['style','receipt','sale-completion','mobile-fixes','sale-exchanges','sale-recovery'].map(n=>'/css/'+n+'.css'),
 ...['recibos','sale-cancellation','sale-exchanges','sale-recovery-client','sale-recovery-ui'].map(n=>'/js/'+n+'.js'),
 '/assets/veconi-symbol.svg','/assets/lucide.min.js',prefix+'index.html',prefix+'results.json',prefix+'README.md'
]);
const types={'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.md':'text/plain; charset=utf-8'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),name=decodeURIComponent(url.pathname);
 if(name==='/'){res.writeHead(302,{Location:prefix+'index.html'}).end();return;}
 if(!allowed.has(name)&&!/^\/docs\/qa\/ux-v203\/screenshots\/[a-z0-9-]+\.png$/.test(name)){res.writeHead(404).end('Recurso fora da prévia.');return;}
 try{const content=fs.readFileSync(path.join(root,name));res.writeHead(200,{'Content-Type':types[path.extname(name)]||'application/octet-stream','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Content-Security-Policy':"default-src 'self'; connect-src 'self'; img-src 'self' data:; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; form-action 'none'; base-uri 'none'; frame-ancestors 'none'"});res.end(content);}catch{res.writeHead(404).end('Prévia não encontrada.');}
});
server.listen(0,'127.0.0.1',()=>console.log('Prévia local: http://127.0.0.1:'+server.address().port+'/'));
