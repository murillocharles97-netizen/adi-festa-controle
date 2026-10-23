'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const base='ea0d0d9457567442f298e02e84e74f782d9ef144';
const git=(...args)=>execFileSync('git',['-c','core.bare=false',...args],{encoding:'utf8'}).replace(/\r\n/g,'\n');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
test('V197 preserves backend/Rules/permissions and the exact V196 exchange, checkout, payment and storage implementations',()=>{
 assert.equal(git('diff','--name-only',base,'--','functions','firestore.rules','firestore.indexes.json','storage.rules').trim(),'');
 for(const p of ['js/checkout.js','js/fiados.js','js/sale-exchanges.js','js/exchange-credit-checkout.js','js/exchange-economics.js','js/storage.js','js/business-cache.js','js/team-access.js','js/firebase/team-service.js','js/clientes-page.js'])assert.equal(read(p),git('show',base+':'+p),p);
});
test('V197 updates only the Auth/UI import URL, and both resolve the same corrected Sync singleton',()=>{
 for(const p of ['js/firebase/auth.js','js/firebase/firebase-ui.js'])assert.equal(read(p).replace("import './sync.js?v=197';","import './sync.js?v=194';"),git('show',base+':'+p),p);
 const html=read('index.html');for(const p of ['app','vendas','build-info','firebase/auth','firebase/firebase-ui'])assert.equal(html.split(`./js/${p}.js?v=197`).length-1,1,p);
 assert.match(read('js/build-info.js'),/release: "197"/);assert.match(read('service-worker.js'),/veconi-v197-fiado-cancellation/);
});
test('release changes contain only the approved Fiado cancellation hotfix, PWA metadata, regression tests and technical notes',()=>{
 const allowed=new Set(['js/app.js','js/vendas.js','js/firebase/sync.js','js/firebase/auth.js','js/firebase/firebase-ui.js','js/build-info.js','index.html','service-worker.js','docs/fiado-cancellation-v196.md','tests/fiado-cancellation.test.js','tests/fiado-cancellation-release.test.js','tests/helpers/fiado-cancellation-harness.cjs','tests/emulator/fiado-cancellation.rules.test.js','tests/team-sync-release-v179.test.js']);
 for(const p of [...git('diff','--name-only',base).trim().split('\n'),...git('ls-files','--others','--exclude-standard').trim().split('\n')].filter(Boolean))assert.ok(allowed.has(p),p);
});
