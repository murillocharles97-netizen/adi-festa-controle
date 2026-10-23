'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const base='d4f9703fc3c3416dbf1256648e55f04337e69c57';
const git=(...args)=>execFileSync('git',['-c','core.bare=false',...args],{encoding:'utf8'}).replace(/\r\n/g,'\n');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
test('V198 runtime is exclusively History presentation + PWA metadata, preserving every V197 financial/Sync guard',()=>{
 const changed=git('diff','--name-only',base,'--','js','functions','firestore.rules','firestore.indexes.json','storage.rules','firebase.json').trim().split('\n').filter(Boolean);
 assert.deepEqual(changed.sort(),['js/activity-center.js','js/build-info.js','js/firebase/firestore-repository.js']);
 for(const p of ['js/vendas.js','js/app.js','js/checkout.js','js/clientes-page.js','js/fiados.js','js/firebase/sync.js','js/firebase/auth.js','js/firebase/firebase-ui.js','js/storage.js','js/sale-exchanges.js','js/exchange-credit-checkout.js','js/exchange-economics.js','js/team-access.js'])assert.equal(read(p),git('show',base+':'+p),p);
 let repository=read('js/firebase/firestore-repository.js').replace('  getDocFromServer,\n','');
 repository=repository.replace(/    async getSaleStatusFromServer\(id\) \{[\s\S]*?\n    \},\n/,'');assert.equal(repository,git('show',base+':js/firebase/firestore-repository.js'));
});
test('History status confirmation cannot write, sync, repair, cancel, or persist data',()=>{
 const src=read('js/activity-center.js'),start=src.indexOf('// Presentation-only confirmation.'),end=src.indexOf('  const TYPE_META');
 const layer=src.slice(start,end);assert.ok(start>0&&end>start);
 assert.doesNotMatch(layer,/DB\.(alterar|salvar)|setDoc|updateDoc|runTransaction|processSyncQueue|localStorage|indexedDB|\.remove\(|\.create\(|\.update\(/);
 assert.match(layer,/repository\.getSaleStatusFromServer\(id\)/);assert.match(layer,/reads\.active < 4/);
});
test('PWA V198 updates only History and build-info URLs while retaining V197 Sync and sale URLs',()=>{
 const html=read('index.html');assert.equal(html,git('show',base+':index.html').replace('./js/activity-center.js?v=194','./js/activity-center.js?v=198').replace('./js/build-info.js?v=197','./js/build-info.js?v=198'));
 assert.equal(read('js/build-info.js'),git('show',base+':js/build-info.js').replace('release: "197"','release: "198"'));
 assert.equal(read('service-worker.js'),git('show',base+':service-worker.js').replace('veconi-v197-fiado-cancellation','veconi-v198-history-cancelled-status').replace("release:'197'","release:'198'"));
});
test('isolated release package excludes unrelated branches and all migrations',()=>{
 const allowed=new Set(['js/activity-center.js','js/firebase/firestore-repository.js','js/build-info.js','index.html','service-worker.js','tests/history-cancelled-status.test.js','tests/history-status-release.test.js','tests/emulator/history-status.rules.test.js','tests/fixtures/history-cancelled-status.html','tests/fiado-cancellation-release.test.js','tests/team-sync-release-v179.test.js','docs/history-cancelled-status-v198.md']);
 for(const p of [...git('diff','--name-only',base).trim().split('\n'),...git('ls-files','--others','--exclude-standard').trim().split('\n')].filter(Boolean))assert.ok(allowed.has(p),p);
});
