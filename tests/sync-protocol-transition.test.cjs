'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict');
const src=fs.readFileSync('js/firebase/sync.js','utf8');
function harness(call){
 const c={Error,Number,JSON,state:{},currentUser:{uid:'seller'},auth:{currentUser:{uid:'seller'}},syncSessionGeneration:1,activeBusinessId:()=> 'qa',DB:{getWorkspaceGeneration:()=>0},now:()=> '2026-10-24T00:00:00Z',queuePreflight:()=>({ok:true}),canWriteSharedSettings:()=>false,stableLegacyOperationId:x=>x.operationId,errorCode:e=>String(e.code||'').replace(/^functions\//,'')};
 c.window={AdiFestaBuild:{release:'202'},WorkspaceRuntime:{capture:()=>({workspaceGeneration:0})},FirebaseCallable:call};
 vm.createContext(c);vm.runInContext(src.slice(src.indexOf("let verifiedProtocolSession="),src.indexOf('async function verifySaleQueueCommit(')),c);return c;
}
const response=()=>({data:{protocolVersion:1,minClientRelease:202,channel:'commitOperationalSync',businessId:'qa',workspaceGeneration:0}});
const packet=()=>({operationId:'qa-op',businessId:'qa',userId:'seller',syncProtocolVersion:1,checksum:'original',attempts:0,payload:{eventKind:'simple',writes:[]}});
test('only a new captured operation gets protocol metadata; offline capture does not alter its payload or restamp an existing operation',()=>{
 const c=harness(async()=>{});let queue=[],schedules=0;
 Object.assign(c,{crypto:require('node:crypto'),MAX_WRITES:350,readQueueStrict:()=>queue,saveQueue:next=>{queue=next;},sanitizeForFirestore:x=>x,deviceId:()=> 'qa-device',matchMedia:()=>({matches:true}),PAYLOAD_VERSION:4,queueSubtype:()=> 'simple',scheduleImmediate:()=>schedules++});
 vm.runInContext(src.slice(src.indexOf('function queueWrites('),src.indexOf('function migrateOwnerBusinessQueue(')),c);
 const writes=[{entityType:'clients',entityId:'qa-client',operation:'update',data:{nome:'Fictício'}}],before=JSON.stringify(writes);
 c.queueWrites(writes,'new-op','simple');assert.equal(queue[0].syncProtocolVersion,1);assert.equal(queue[0].clientRelease,202);assert.equal(JSON.stringify(writes),before);
 const original=JSON.stringify(queue);c.queueWrites(writes,'new-op','simple');assert.equal(JSON.stringify(queue),original);assert.equal(schedules,1);
});
for(const uid of ['owner','seller'])test(uid+': authenticated handshake precedes commit, one per session; original envelope stays immutable',async()=>{
 const calls=[],c=harness(async(name,data)=>{calls.push(name);if(name==='getOperationalSyncReceipt'){assert.equal(data.kind,'sync_protocol');return response();}assert.equal(data.syncProtocolVersion,1);assert.equal(data.clientRelease,202);return{data:{}};});c.currentUser.uid=uid;c.auth.currentUser.uid=uid;
 const p=packet(),original=JSON.stringify(p);await c.commitQueueItem(p);await c.commitQueueItem(p);assert.deepEqual(calls,['getOperationalSyncReceipt','commitOperationalSync','commitOperationalSync']);assert.equal(JSON.stringify(p),original);assert.equal(c.state.operationalProtocol.status,'verified');
});
test('mixed/old release and absent callable block writes, without direct fallback',async()=>{
 for(const mode of ['old','missing','missing-build']){let calls=0;const c=harness(async()=>{calls++;return response();});if(mode==='old')c.window.AdiFestaBuild.release='201';else if(mode==='missing')c.window.FirebaseCallable=null;else{delete c.window.AdiFestaBuild;c.window.location={hostname:'veconi.invalid'};}await assert.rejects(c.commitQueueItem(packet()),{code:'sync-update-required'});assert.equal(calls,0);}
});
test('old operation cannot be committed even manually; IDs, checksum and attempts unchanged',async()=>{
 let calls=0;const c=harness(async()=>{calls++;}),p=packet();delete p.syncProtocolVersion;const before=JSON.stringify(p);await assert.rejects(c.commitQueueItem(p),{code:'sync-protocol-upgrade-review'});assert.equal(calls,0);assert.equal(JSON.stringify(p),before);
});
test('failed handshake or wrong company/generation/protocol never reaches commit',async()=>{
 for(const mode of ['network','company','generation','protocol','minRelease']){const calls=[],c=harness(async name=>{calls.push(name);if(mode==='network')throw Object.assign(Error('offline'),{code:'unavailable'});const r=response();if(mode==='company')r.data.businessId='other';if(mode==='generation')r.data.workspaceGeneration=2;if(mode==='protocol')r.data.protocolVersion=0;if(mode==='minRelease')r.data.minClientRelease=203;return r;});await assert.rejects(c.commitQueueItem(packet()));assert.deepEqual(calls,['getOperationalSyncReceipt']);assert.notEqual(c.state.operationalProtocol?.status,'verified');}
});
test('old handshake callback cannot confirm next identity or generation; account switch requires fresh verification',async()=>{
 let finish;const c=harness(()=>new Promise(r=>finish=r)),work=c.verifyOperationalProtocol();c.syncSessionGeneration++;c.currentUser={uid:'owner'};c.auth.currentUser={uid:'owner'};finish(response());await assert.rejects(work,{code:'sync-session-retired'});assert.notEqual(c.state.operationalProtocol?.status,'verified');
 let count=0;c.window.FirebaseCallable=async()=>{count++;return response();};await c.verifyOperationalProtocol();await c.verifyOperationalProtocol();assert.equal(count,1);c.syncSessionGeneration++;await c.verifyOperationalProtocol();assert.equal(count,2);
});
test('actual callable boundary rejects absent/old protocol before invoking any commercial service',async()=>{
 const {operationalCallable}=require('../functions/src/shared/operational-callable');let count=0;const call=operationalCallable(async()=>{count++;return{ok:true};},{requireProtocol:true});
 await assert.rejects(call({}),{code:'unauthenticated'});
 for(const data of [{},{syncProtocolVersion:0,clientRelease:201},{syncProtocolVersion:1,clientRelease:201}])await assert.rejects(call({auth:{uid:'qa'},data}),e=>e.code==='failed-precondition'&&e.details.reason==='sync-update-required');
 assert.equal(count,0);assert.equal((await call({auth:{uid:'qa'},data:{syncProtocolVersion:1,clientRelease:202}})).ok,true);assert.equal(count,1);
});
