'use strict';
// Read-only release isolation. No credentials, Firebase or Git writes.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const base='66cf5723aaaaa6a31ecef9b91982aa50c0285763',read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'),old=p=>cp.execFileSync('git',['show',base+':'+p],{encoding:'utf8'}).replaceAll('\r\n','\n');
cp.execFileSync('git',['merge-base','--is-ancestor','3265f375a6bcd6276e202646725ce63e06a8d20c','HEAD']);
const exact=['firestore.rules','storage.rules','firestore.indexes.json','functions/src/index.js','functions/src/shared/commercial-commit-engine.js','functions/src/shared/operational-callable.js','functions/src/services/financial-maintenance-service.js','functions/src/services/sale-cancellation-service.js','functions/src/services/sale-exchange-service.js','functions/src/services/exchange-credit-service.js','functions/src/services/sale-recovery-service.js','js/team-access.js','js/business-cache.js','js/storage.js','js/vendas.js','js/checkout.js','js/fiados.js','js/sale-exchanges.js','js/sale-cancellation.js','js/activity-center.js','js/desktop-dashboard.js','js/home-mobile.js','public-site.manifest.json','.github/workflows/deploy-pages.yml','css/firebase.css','css/style.css','css/sale-recovery.css'];
for(const p of exact)assert.equal(read(p),old(p),p);
const block=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
for(const [a,b]of[['function queueWrites(','function migrateOwnerBusinessQueue('],['async function commitQueueItem(','async function verifySaleQueueCommit('],['async function processSyncQueue(','function pendingIds(']])assert.equal(block(read('js/firebase/sync.js'),a,b),block(old('js/firebase/sync.js'),a,b),a);
const server=read('functions/src/services/operational-commit-service.js'),serverOld=old('functions/src/services/operational-commit-service.js'),begin="   const names=[...new Set([...plan.values()]",end='   return{operationId:item.operationId,outcome,replayed:false};';
assert.equal(server.slice(0,server.indexOf(begin)),serverOld.slice(0,serverOld.indexOf(begin)));
assert.equal(server.slice(server.indexOf(end,server.indexOf(begin))),serverOld.slice(serverOld.indexOf(end,serverOld.indexOf(begin))));
for(const p of ['js/firebase/auth.js','js/firebase/firebase-ui.js'])assert.equal(read(p).replace("./sync.js?v=204","./sync.js?v=202"),old(p),p);
assert.equal(read('service-worker.js').replace(/veconi-v204-read-hydration(?:-compatible)?/g,'veconi-v203-ux-ui').replace("release: '204'","release: '203'"),old('service-worker.js'));
assert.equal(read('js/build-info.js').replace('release: "204"','release: "203"'),old('js/build-info.js'));
assert.equal(read('index.html').replace('build-info.js?v=204','build-info.js?v=203').replace('firebase/auth.js?v=204','firebase/auth.js?v=203').replace('firebase/firebase-ui.js?v=204','firebase/firebase-ui.js?v=203'),old('index.html'));
for(const script of ['generate-commercial-commit-engine','generate-engagement-domain','generate-maintenance-audit'])cp.execFileSync(process.execPath,['scripts/'+script+'.cjs','--check']);
console.log(JSON.stringify({base,exactProtectedFiles:exact.length,commercialBlocksUnchanged:3,onlyFunctionToRedeploy:'commitOperationalSync',rulesOrIndexesChanged:false,uiChanged:false,authorizedProtocol:1,queueMutationChanges:false,securityFloorPreserved:true}));
