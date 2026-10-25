'use strict';
// Read-only compatibility/containment check. No Git write, token, deploy or
// production SDK. An old permissive Rules/Sync rollback is deliberately invalid.
const fs=require('node:fs'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const baseline='66e6969ba3b8cdc16053466ab2ae6c80e286ba78';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).replaceAll('\r\n','\n');
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
execFileSync('git',['merge-base','--is-ancestor','3265f375a6bcd6276e202646725ce63e06a8d20c','HEAD']);
execFileSync('git',['merge-base','--is-ancestor',baseline,'HEAD']);
const retained=['functions/src/services/sale-cancellation-service.js','functions/src/services/sale-exchange-service.js','functions/src/services/exchange-credit-service.js','functions/src/services/financial-income-service.js','functions/src/services/online-order-service.js','functions/src/services/sale-recovery-service.js','functions/src/services/sync-incident-service.js','js/vendas.js','js/fiados.js','js/sale-exchanges.js','js/exchange-credit-checkout.js','public-site.manifest.json','manifest.json'];
// V203 added only the approved viewport layout opt-in to this retained UI.
// Pin its complete reviewed source, rather than treating that earlier UI release as a new V204 mutation.
for(const file of retained){const reference=file==='js/sale-exchanges.js'?'66cf5723aaaaa6a31ecef9b91982aa50c0285763':baseline;if(read(file)!==git('show',reference+':'+file))throw Error('Unrelated operational/release source changed: '+file);}
for(const script of ['generate-commercial-commit-engine','generate-engagement-domain','generate-maintenance-audit'])execFileSync(process.execPath,['scripts/'+script+'.cjs','--check']);
const floor=['firestore.rules','storage.rules','functions/src/index.js','functions/src/services/operational-commit-service.js','functions/src/services/financial-maintenance-service.js','functions/src/services/operational-engagement-validation.js','functions/src/shared/commercial-commit-engine.js','functions/src/shared/engagement-domain.js','functions/src/shared/financial-maintenance-audit.js','functions/src/shared/operational-callable.js','functions/src/shared/operational-id.js','js/firebase/sync.js','js/firebase/auth.js','js/firebase/firebase-ui.js','js/firebase/firestore-repository.js','js/workspace-callables.js','js/produtos.js','js/product-variations.js'];
console.log(JSON.stringify({baseline,retainedSources:retained.length,releaseCommitCreated:git('rev-parse','HEAD').trim()!==baseline,deployExecuted:false,compatibleRollback:'V201 shell with complete V202 authorization floor; never old permissive Rules or old uploader',floor:floor.map(file=>({file,sha256:crypto.createHash('sha256').update(read(file)).digest('hex')}))},null,2));
