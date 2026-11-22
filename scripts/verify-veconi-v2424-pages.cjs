'use strict';

const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const origin = 'https://veconi.app.br';
const site = path.resolve(process.env.VECONI_PWA_SITE || 'qa-artifacts/v2424/public');
const output = path.resolve('qa-artifacts/v2424/pages-verified');
const commit = execFileSync('git', ['rev-parse', 'HEAD'], { encoding:'utf8' }).trim();
const normalize = value => value.toString().replace(/\r\n/g,'\n');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const buildMeta = html => html.replace(/(name="adi-festa-build(?:-time)?" content=")[^"]+/g,'$1STAMP');
const publicAssets = [
  '/', '/catalogo.html', '/service-worker.js', '/404.html', '/manifest.json', '/js/build-info.js?v=2424',
  '/css/online-store.css?v=300', '/css/catalogo.css?v=300', '/js/loja/store-kit.js?v=300',
  '/js/online-store-ui.js?v=300', '/js/firebase/catalog-bridge.js?v=300', '/js/catalogo-publico.js?v=300',
  '/js/app.js?v=2423', '/js/desktop-sales.js?v=2423', '/js/checkout.js?v=2423', '/js/checkout-mobile.js?v=2423',
  '/js/clientes-mobile.js?v=2422', '/js/customer-metrics.js?v=2422', '/js/crm-segment-engine-v2.js?v=2422',
  '/js/configuracoes-mobile.js?v=2421', '/js/firebase/sync.js', '/js/online-orders-ui.js?v=205',
];

async function checkAsset(url) {
  const response = await fetch(origin+url,{cache:'no-cache',signal:AbortSignal.timeout(18000)});
  assert.equal(response.status,200,url);
  const content = Buffer.from(await response.arrayBuffer());
  const pathname = url.split('?')[0], file = pathname==='/'?'index.html':pathname.slice(1);
  const expected = fs.readFileSync(path.join(site,file));
  if(file==='index.html'){
    assert.equal(normalize(content).match(/name="adi-festa-build" content="([0-9a-f]+)"/)?.[1],commit);
    assert.equal(buildMeta(normalize(content)),buildMeta(normalize(expected)),file);
  }else{
    assert.equal(sha(Buffer.from(normalize(content))),sha(Buffer.from(normalize(expected))),url);
  }
  const target=path.join(output,file);
  fs.mkdirSync(path.dirname(target),{recursive:true});
  fs.writeFileSync(target,content);
  return {url,status:response.status,bytes:content.length,sha256:sha(content)};
}

async function main(){
  const assets=[];
  for(let i=0;i<publicAssets.length;i+=6) assets.push(...await Promise.all(publicAssets.slice(i,i+6).map(checkAsset)));
  const authOrigin='https://southamerica-east1-adi-festa-controle.cloudfunctions.net';
  const probes=[];
  for(const [name,status,code] of [['getOnlineStore',401,'UNAUTHENTICATED'],['saveOnlineStore',401,'UNAUTHENTICATED'],['submitCatalogOrder',400,'INVALID_ARGUMENT']]){
    const response=await fetch(authOrigin+'/'+name,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"data":{}}',signal:AbortSignal.timeout(18000)});
    const body=await response.json();
    assert.equal(response.status,status,name);assert.equal(body.error?.status,code,name);
    probes.push({name,status,code});
  }
  const report={commit,assets,probes};
  fs.writeFileSync(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({commit,assets:assets.length,probes}));
}
main().catch(error=>{console.error(error);process.exitCode=1;});
