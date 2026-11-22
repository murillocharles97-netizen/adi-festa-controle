// Run locally with node scripts/demo-vitrine-viva.cjs [port].
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const {svgFor} = require('./loja-qa-kit.cjs');
const root = path.resolve(__dirname,'..');
const files = new Set([
  'catalogo.html','js/build-info.js','js/catalogo-publico.js','js/online-store-ui.js','js/online-orders-ui.js',
  'js/loja/store-kit.js','js/local-records.js','js/online-checkout-attempts.js','js/online-order-finalization.js','js/phone.js',
  'functions/src/shared/online-order.js','functions/src/shared/online-store.js','tests/fixtures/online-store-v3-backend.js',
  'tests/vitrine-viva.fixture.html','tests/fixtures/vitrine-viva-demo.js'
]);
const types = {'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.woff2':'font/woff2','.png':'image/png','.ico':'image/x-icon'};
function serve(port=0){
  const server=http.createServer((req,res)=>{
    const url=new URL(req.url,'http://127.0.0.1');
    if(req.method!=='GET' && req.method!=='HEAD')return res.writeHead(405).end();
    const name=url.pathname.slice(1)||'tests/vitrine-viva.fixture.html';
    if(name.startsWith('demo-images/')){res.setHeader('Content-Type','image/svg+xml');return res.end(svgFor(name.slice(11)));}
    const asset=/^(?:assets|css)\/[a-zA-Z0-9_./-]+\.(?:css|woff2|png|svg|ico|js)$/.test(name);
    if(!asset&&!files.has(name))return res.writeHead(404).end();
    const fullPath=path.resolve(root,name);
    if(!fullPath.startsWith(root+path.sep)||!fs.existsSync(fullPath))return res.writeHead(404).end();
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'; connect-src 'none'; frame-ancestors 'self'; form-action 'none'; object-src 'none'; base-uri 'none'");
    res.setHeader('Content-Type',(types[path.extname(name)]||'application/octet-stream')+'; charset=utf-8');
    if(name==='tests/fixtures/online-store-v3-backend.js'){
      return res.end(fs.readFileSync(fullPath,'utf8').replace('`\${IMG}logo/aurora.svg`',"''").replace('`\${IMG}cover/aurora.svg`',"''"));
    }
    fs.createReadStream(fullPath).pipe(res);
  });
  return new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',()=>resolve(server));});
}
if(require.main===module)serve(Number(process.argv[2]||42841)).then(s=>console.log('http://127.0.0.1:'+s.address().port+'/')).catch(e=>{console.error(e);process.exitCode=1;});
module.exports={serve};
