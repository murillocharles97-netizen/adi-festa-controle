'use strict';
const cp=require('node:child_process'),assert=require('node:assert/strict'),fs=require('node:fs');
const base='f812c583e8336b142799d0735334f5d2ea330889',git=(...a)=>cp.execFileSync('git',a,{encoding:'utf8'}).trim();
git('merge-base','--is-ancestor',base,'HEAD');
const protectedFiles=['js/plans.js','js/prior-sales.js','css/prior-sales.css','js/performance-access.js','js/spaces.js','js/firebase/sync.js','functions/src/index.js','functions/src/shared/commercial-commit-engine.js','functions/src/shared/permission-policy.js','functions/src/shared/operational-privacy-policy.js','js/operational-read-policy.js','firestore.rules','firestore.prior-sales.rules','storage.rules','firestore.indexes.json'];
for(const p of protectedFiles){const prior=cp.execFileSync('git',['show',base+':'+p]);assert.equal(prior.toString().replaceAll('\r\n','\n'),fs.readFileSync(p,'utf8').replaceAll('\r\n','\n'),p+' changed');}
const backend=git('diff','--name-only',base,'--','functions').split('\n').filter(Boolean);assert.ok(backend.every(p=>['functions/src/services/operational-commit-service.js','functions/src/services/payment-confirmation-read.js','functions/src/services/fiado-account-service.js','functions/src/shared/fiado-account.js','functions/src/shared/installment-plan.js'].includes(p)),backend.join(','));
const model=require('../functions/src/shared/installment-plan');assert.equal(model.create({total:2800,count:10,firstDueDate:'2026-12-01',saleDate:'2026-11-05'}).installments.reduce((n,p)=>n+p.amountCents,0),280000);
console.log(JSON.stringify({base,protectedFiles:protectedFiles.length,saasAndV3Preserved:true,destructiveMigration:false,publishAuthorized:false}));
