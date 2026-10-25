'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),cp=require('node:child_process');
const base='c80da0fffb0106aea4d23cf097ee33896522f07c',read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'),old=p=>cp.execFileSync('git',['show',base+':'+p],{encoding:'utf8'}).replaceAll('\r\n','\n');
test('V203 retains backend, Rules, authorized Sync, permissions and commercial sources exactly',()=>{
 for(const p of ['firestore.rules','storage.rules','js/firebase/sync.js','js/firebase/firebase-config.js','js/firebase/firestore-repository.js','js/workspace-callables.js','js/business-cache.js','js/team-access.js','js/vendas.js','js/fiados.js','js/checkout.js','js/exchange-credit-checkout.js','js/produtos.js','js/product-variations.js','public-site.manifest.json','manifest.json','.github/workflows/deploy-pages.yml'])assert.equal(read(p),old(p),p);
 assert.equal(cp.execFileSync('git',['diff',base,'--','functions'],{encoding:'utf8'}),'');
});
test('PWA change is metadata only: all fetch, activation, containment and cache-preservation code retained',()=>{
 assert.equal(read('service-worker.js').replaceAll('veconi-v203-ux-ui','veconi-v202-authorized-sync').replace("release: '203'","release: '202'"),old('service-worker.js'));
 assert.equal(read('js/build-info.js').replace('release: "203"','release: "202"'),old('js/build-info.js'));
});
test('Trocas and cancellation changes only opt their existing dialog into viewport layout',()=>{
 for(const p of ['js/sale-exchanges.js','js/sale-cancellation.js'])assert.equal(read(p).replace(/^.*window\.Modais\?\.layout\?\.\(modal\.querySelector\('\[role="dialog"\]'\)\);\n/m,''),old(p),p);
 assert.equal(read('js/firebase/firebase-ui.js').replace('../sale-recovery-ui.js?v=203','../sale-recovery-ui.js?v=183'),old('js/firebase/firebase-ui.js'));
});
test('V203 entry points invalidate only approved UI assets; Sync import remains V202',()=>{
 const index=read('index.html');for(const p of ['sale-recovery.css','sale-exchanges.js','sale-cancellation.js','style.css','firebase.css','build-info.js','recibos.js','clientes-page.js','auth.js','firebase-ui.js'])assert.ok(index.includes(p+'?v=203'),p);
 assert.match(read('js/firebase/auth.js'),/sync\.js\?v=202/);assert.match(read('js/firebase/firebase-ui.js'),/sync\.js\?v=202/);
 assert.doesNotMatch(index,/203-login-local/);
});
