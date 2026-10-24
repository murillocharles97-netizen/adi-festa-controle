'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict'),{execFileSync}=require('node:child_process');
const source=fs.readFileSync('js/firebase/sync.js','utf8');
function harness(call){
 const context={window:{FirebaseCallable:call,WorkspaceRuntime:{capture:()=>{}}},syncSessionGeneration:1,currentUser:{uid:'seller'},auth:{currentUser:{uid:'seller'}},DB:{getWorkspaceGeneration:()=>0},queuePreflight:()=>({ok:true}),canWriteSharedSettings:()=>false,activeBusinessId:()=> 'synthetic-business',stableLegacyOperationId:x=>x.operationId,errorCode:e=>String(e.code||'').replace(/^(?:functions|firestore)\//,''),Error};
 vm.createContext(context);const a=source.indexOf('async function commitQueueItem('),b=source.indexOf('async function verifySaleQueueCommit(',a);vm.runInContext(source.slice(a,b),context);return context;
}
const packet=()=>({operationId:'qa-operation',userId:'seller',businessId:'synthetic-business',checksum:'original-checksum',attempts:1,payload:{eventKind:'sale',writes:[{entityType:'sales',entityId:'qa-sale',operation:'create',data:{valorFinal:10}}]}});
test('auto/manual queue commit use one authenticated channel and do not rewrite original envelope',async()=>{let count=0;const c=harness(async(name,data)=>{assert.equal(name,'commitOperationalSync');assert.equal(data.item.operationId,'qa-operation');count++;return{data:{outcome:null}};}),p=packet(),before=JSON.stringify(p);await c.commitQueueItem(p);await c.commitQueueItem(p);assert.equal(count,2);assert.equal(JSON.stringify(p),before);});
test('network failure never falls back to direct writes or changes queue IDs/checksum',async()=>{const c=harness(async()=>{throw Object.assign(Error('indisponível'),{code:'functions/unavailable'});}),p=packet(),before=JSON.stringify(p);await assert.rejects(c.commitQueueItem(p),{code:'unavailable'});assert.equal(JSON.stringify(p),before);});
test('permanent Function permission error keeps canonical code (no accidental retry loop)',async()=>{const c=harness(async()=>{throw Object.assign(Error('negado'),{code:'functions/permission-denied'});});await assert.rejects(c.commitQueueItem(packet()),e=>e.code==='permission-denied'&&e.syncDetail.stage==='server_operational_commit');});
test('account switch while callable in flight invalidates callback; no next-session acknowledgement',async()=>{let finish;const c=harness(()=>new Promise(resolve=>{finish=resolve;})),work=c.commitQueueItem(packet());c.currentUser={uid:'owner'};c.auth.currentUser={uid:'owner'};c.syncSessionGeneration++;finish({data:{outcome:null}});await assert.rejects(work,{code:'sync-session-retired'});});
test('generated arithmetic engine has exact checked-source provenance and no runtime eval',()=>{execFileSync(process.execPath,['scripts/generate-commercial-commit-engine.cjs','--check']);const engine=fs.readFileSync('functions/src/shared/commercial-commit-engine.js','utf8');assert.doesNotMatch(engine,/\beval\s*\(|new Function\s*\(/);assert.doesNotMatch(engine,/console\.info\("\[PAYMENT_CONCURRENCY_CHECK\]/);});
test('published containment allowlist remains exactly V201; no new evidence/server/test artifact is public',()=>{assert.deepEqual(JSON.parse(fs.readFileSync('public-site.manifest.json','utf8')),JSON.parse(execFileSync('git',['show','66e6969ba3b8cdc16053466ab2ae6c80e286ba78:public-site.manifest.json'],{encoding:'utf8'})));});
test('seller hydration/audit does not query restricted payment allocations',()=>{
 const a=source.indexOf('function canPullSource('),b=source.indexOf('\nconst ',a),c={window:{TeamAccess:{has:p=>['sales.create','products.view','customers.view','inventory.view'].includes(p)}}};vm.createContext(c);vm.runInContext(source.slice(a,b),c);assert.equal(c.canPullSource('paymentAllocations'),false);assert.equal(c.canPullSource('sales'),true);
});
test('initial stock origin is captured at diff/action time and is not inferred again on retry',()=>{
 const h=require('./helpers/fiado-cancellation-harness.cjs').harness(),before=structuredClone(h.data());let selected='qa-origin-a',calls=0;
 h.c.SpaceContext.stockMovementOrigin=()=>{calls++;return{businessId:'qa-fiado',spaceId:selected};};
 h.data().produtos.push({id:'new-initial',businessId:'qa-fiado',nome:'Fictício',productType:'simple',spaceAccessMode:'all_spaces',allowedSpaceIds:[],estoqueAtual:5});
 const writes=h.c.diffWrites(before,h.data()),write=writes.find(w=>w.entityId==='new-initial');assert.equal(write.initialStockSpaceId,'qa-origin-a');const original=JSON.stringify(writes);selected='qa-origin-b';assert.equal(JSON.stringify(writes),original);assert.equal(calls,1);
 h.c.SpaceContext.stockMovementOrigin=()=>{throw Error('Selecione o espaço');};assert.throws(()=>h.c.diffWrites(before,h.data()),/Selecione o espaço/);
});
test('all generated domain/audit adapters have checked-source provenance and no runtime eval',()=>{
 for(const script of ['scripts/generate-engagement-domain.cjs','scripts/generate-maintenance-audit.cjs'])execFileSync(process.execPath,[script,'--check']);
 for(const file of ['functions/src/shared/engagement-domain.js','functions/src/shared/financial-maintenance-audit.js'])assert.doesNotMatch(fs.readFileSync(file,'utf8'),/\beval\s*\(|new Function\s*\(/);
});
test('callable boundary makes business conflicts permanent, without changing transient network failures',async()=>{
 const {operationalCallable}=require('../functions/src/shared/operational-callable');
 await assert.rejects(operationalCallable(async()=>{throw Object.assign(Error('reserved'),{code:'online-stock-reserved'});})({}),e=>e.code==='failed-precondition'&&e.details.reason==='online-stock-reserved');
 await assert.rejects(operationalCallable(async()=>{throw Object.assign(Error('temporarily unavailable'),{code:'unavailable'});})({}),{code:'unavailable'});
});
test('duplicate-payment compensation is matched to its existing reversal ledger, not mistaken for a missing adjustment',()=>{
 const {buildFinancialBalanceAudit}=require('../functions/src/shared/financial-maintenance-audit');
 const report=buildFinancialBalanceAudit({clients:{remoteItems:[{id:'qa-client',saldo:-7}]},payments:{remoteItems:[]},sales:{remoteItems:[]},balanceAdjustments:{remoteItems:[{id:'duplicate-payment-reversal:qa',operationId:'duplicate-payment-reversal:qa',clienteId:'qa-client',subtipo:'pagamento_duplicado_revertido',duplicatePaymentId:'qa-payment',saldoAnterior:-2,saldoNovo:-7,createdAt:'2026-10-24T00:00:00Z'}]}},[{id:'payment_reversal:qa-payment'}]);
 assert.equal(report.safeCount,0);assert.equal(report.divergentCount,0);
});
test('compatible V201 rollback retains commercial services, security containment and the entire new authorization floor',()=>{
 const result=JSON.parse(execFileSync(process.execPath,['scripts/verify-v202-security-floor.cjs'],{encoding:'utf8'}));assert.equal(result.retainedSources,13);assert.equal(typeof result.releaseCommitCreated,'boolean');assert.equal(result.deployExecuted,false);assert.ok(result.floor.some(v=>v.file==='firestore.rules'));assert.ok(result.floor.some(v=>v.file==='js/firebase/sync.js'));
});
