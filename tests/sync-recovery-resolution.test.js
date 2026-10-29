'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const client=require('../js/sale-recovery-client'),fixture=require('./fixtures/retained-sale-recovery.cjs');
const source=fs.readFileSync('js/firebase/sync.js','utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
function harness(mode='resolved',storage=new Map(),monetary=false){
 const packet=fixture.sample().packet;let session=true,scope='seller';
 if(monetary){packet.lastErrorCode='invalid-argument';packet.lastErrorMessage='Total não corresponde aos itens.';}
 const c={window:{SaleRecoveryClient:client,DB:{getWorkspaceGeneration:()=>0}},crypto:crypto.webcrypto,TextEncoder,Date,JSON,Array,Boolean,Number,Error,encodeURIComponent,currentUser:{uid:packet.userId},localStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)},queueKey:()=>scope,activeBusinessId:()=>packet.businessId,readQueue:()=>[packet],readQueueStrict:()=>[packet],checksumValue:x=>client.canonical(x),now:()=>new Date().toISOString(),readQueueArchive:()=>null};
 c.window.FirebaseCallable=async(name,d)=>{assert.equal(name,'listSaleRecoveryReviews');if(mode==='failure')throw Error('offline');if(mode==='switch'){session=false;scope='owner';}const check=d.resolutionChecks[0],sale=packet.payload.writes.find(w=>w.entityType==='sales');return {items:[{...check,...(monetary?{kind:'monetary_recovery_v1',monetaryPolicy:'unit4-total-cent-v1',totalCents:Math.round(sale.data.valorFinal*100),originalTotalCents:Math.round(sale.data.valorFinal*100),commercialReceiptConfirmed:mode!=='unconfirmed-canonical'}:{}),payloadHash:mode==='hash'?'bad':check.payloadHash,status:mode==='pending'?'awaiting_review':'recovered',businessId:packet.businessId,actorUid:packet.userId,spaceId:sale.data.spaceId,workspaceGeneration:0,contentHash:'a'.repeat(64),resolvedAt:'2026-10-18T00:00:00Z',resolvedByUid:'owner'}]};};
 vm.createContext(c);vm.runInContext(section('function saleQueueRequiresReview(','// Quarantine is separate')+section('function recoveryResolutionKey(','function readQueueArchive('),c);
 c.queueQuarantineReason=i=>c.readRecoveryResolution(i)?'recovery_resolved':'';
 c.queueManualReviewReason=i=>c.queueQuarantineReason(i)||(c.saleQueueRequiresReview(i)?'sale_recovery_review_required':'');
 vm.runInContext(section('const queueCounts =','function ',).replace('const queueCounts =','var queueCounts ='),c);
 return {c,packet,storage,refresh:()=>c.refreshRecoveryResolutions(()=>session),scope:v=>{scope=v;}};
}
test('resolved: packet/checksum untouched, separated metadata, 0/0/0/1',async()=>{const h=harness(),before=JSON.stringify(h.packet);await h.refresh();assert.equal(JSON.stringify(h.packet),before);const n=h.c.queueCounts();assert.equal(n.pending,0);assert.equal(n.errors,0);assert.equal(n.manualReview,0);assert.equal(n.archived,1);assert.equal(h.c.queueManualReviewReason(h.packet),'recovery_resolved');});
for(const mode of ['pending','failure','hash','switch'])test(`${mode}: fail closed; no receipt or replay`,async()=>{const h=harness(mode);await h.refresh();assert.equal(h.storage.size,0);assert.equal(h.c.queueCounts().manualReview,1);assert.equal(h.c.queueCounts().pending,0);});
test('reload retains scoped confirmation; owner cannot reuse it',async()=>{const h=harness();await h.refresh();const reloaded=harness('failure',h.storage);assert.ok(reloaded.c.readRecoveryResolution(reloaded.packet));reloaded.scope('owner');assert.equal(reloaded.c.readRecoveryResolution(reloaded.packet),null);});
test('payload change invalidates cached resolution but still blocks replay',async()=>{const h=harness();await h.refresh();h.packet.payload.writes[0].data.valorFinal=999;assert.equal(h.c.readRecoveryResolution(h.packet),null);assert.equal(h.c.queueCounts().manualReview,1);assert.equal(h.c.queueCounts().pending,0);});
test('real error remains active',()=>{const h=harness();h.packet.lastErrorCode='unavailable';assert.equal(h.c.queueCounts().errors,1);});

test('monetary recovery confirms metadata only; original invalid-argument/attempts/checksum survive reload',async()=>{const h=harness('resolved',new Map(),true),before=JSON.stringify(h.packet);assert.equal(h.c.queueCounts().errors,1);await h.refresh();assert.equal(JSON.stringify(h.packet),before);assert.equal(h.c.queueCounts().errors,0);assert.equal(h.c.queueCounts().archived,1);assert.equal(h.c.queueManualReviewReason(h.packet),'recovery_resolved');const reloaded=harness('failure',h.storage,true);assert.ok(reloaded.c.readRecoveryResolution(reloaded.packet));reloaded.scope('new-owner');assert.equal(reloaded.c.readRecoveryResolution(reloaded.packet),null);});
for(const mode of ['failure','hash','pending','switch','unconfirmed-canonical'])test(`monetary ${mode}: no false healthy state and no payload mutation`,async()=>{const h=harness(mode,new Map(),true),before=JSON.stringify(h.packet);await h.refresh();assert.equal(h.storage.size,0);assert.equal(h.c.queueCounts().errors,1);assert.equal(JSON.stringify(h.packet),before);});
test('administrative resolution metadata preserves the original packet and holds replay across reload/account switch',()=>{
 const h=harness(),sale=h.packet.payload.writes.find(w=>w.entityType==='sales'),before=JSON.stringify(h.packet);
 h.storage.set(h.c.recoveryResolutionKey(h.packet),JSON.stringify({channel:'financial_maintenance',status:'resolved',auditHash:'b'.repeat(64),operationId:h.packet.operationId,saleId:sale.entityId,spaceId:sale.data.spaceId,businessId:h.packet.businessId,actorUid:h.packet.userId,workspaceGeneration:0,payloadChecksum:h.c.checksumValue(h.packet.payload),resolvedByUid:'qa-owner',resolvedAt:'2026-10-24T00:00:00Z'}));
 assert.ok(h.c.readRecoveryResolution(h.packet));assert.equal(h.c.queueCounts().archived,1);assert.equal(h.c.queueCounts().errors,0);assert.equal(JSON.stringify(h.packet),before);
 const reload=harness('failure',h.storage);assert.ok(reload.c.readRecoveryResolution(reload.packet));reload.scope('owner');assert.equal(reload.c.readRecoveryResolution(reload.packet),null);h.packet.payload.writes[0].data.valorFinal=999;assert.equal(h.c.readRecoveryResolution(h.packet),null);
});
test('auto/manual share verification before loop; held items bypass commit',()=>{const processing=source.slice(source.indexOf('async function processSyncQueue('));assert.ok(processing.indexOf('await refreshRecoveryResolutions(current)')<processing.indexOf('for (const queued'));assert.match(processing,/if \(queueManualReviewReason\(queued\)\)[\s\S]*?continue;/);});
for(const force of [false,true])test(`${force?'manual':'automatic'} Sync executes no commit and preserves evidence after remote confirmation`,async()=>{
 const h=harness(),c=h.c,before=JSON.stringify(h.packet);let commits=0;
 Object.assign(c,{DB:{flush:async()=>{}},processingPromise:null,readOnlyMode:false,cloudPaused:false,navigator:{onLine:true},syncSessionGeneration:1,state:{userProfile:{businessId:h.packet.businessId}},auth:{currentUser:{uid:h.packet.userId}},validateUser:async()=>{},preserveQueueQuarantine:()=>false,retireSettingsPermissionFailure:()=>{},queueErrorBreakdown:()=>({}),commitQueueItem:async()=>{commits++;}});
 vm.runInContext(section('async function processSyncQueue(','function pendingIds('),c);
 const result=await c.processSyncQueue({force,manualRetry:force});assert.equal(result.sent,0);assert.equal(result.errors,0);assert.equal(result.archived,1);assert.equal(commits,0);assert.equal(JSON.stringify(h.packet),before);
 await c.processSyncQueue({force:true,manualRetry:true});assert.equal(commits,0);assert.equal(JSON.stringify(h.packet),before);
});
test('four resolved originals produce exactly 0 sendable / 0 active errors / 0 pending reviews / 4 resolved',async()=>{
 const h=harness(),packets=Array.from({length:4},(_,n)=>fixture.sample(n).packet);h.c.readQueue=h.c.readQueueStrict=()=>packets;
 h.c.window.FirebaseCallable=async(name,d)=>({items:d.resolutionChecks.map(check=>{const p=packets.find(p=>p.operationId===check.operationId),sale=p.payload.writes.find(w=>w.entityType==='sales');return {...check,status:'closed_without_effects',businessId:p.businessId,actorUid:p.userId,spaceId:sale.data.spaceId,workspaceGeneration:0,contentHash:'a'.repeat(64),resolvedAt:'2026-10-18T00:00:00Z',resolvedByUid:'owner'};})});
 await h.refresh();const n=h.c.queueCounts();assert.deepEqual([n.pending,n.errors,n.manualReview,n.archived],[0,0,0,4]);
 vm.runInContext(section('function preservedQueueMessage(','function readQueueReview('),h.c);assert.equal(h.c.preservedQueueMessage(n),'Nenhuma sincronização pendente. 4 ocorrências resolvidas preservadas para auditoria.');
});
