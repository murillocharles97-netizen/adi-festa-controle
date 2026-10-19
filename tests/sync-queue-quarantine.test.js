'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto'),{execFileSync}=require('node:child_process');
const source=fs.readFileSync('js/firebase/sync.js','utf8');
const section=(s,a,b)=>s.slice(s.indexOf(a),s.indexOf(b,s.indexOf(a)));
const hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
function phantom(status='error',migrated=false){
 const writes=[...Array.from({length:4},(_,i)=>({entityType:'products',entityId:'p'+i,operation:'update',before:{estoque:6},data:{custo:0}})),...Array.from({length:2},(_,i)=>({entityType:'productVariants',entityId:'v'+i,operation:'update',before:{stock:6},data:{cost:0}})),...Array.from({length:122},(_,i)=>({entityType:'sales',entityId:'s'+i,operation:'update',before:{valorTotal:10,status:'pago'},data:{custoTotal:0,lucro:10}}))];
 if(migrated)for(const w of writes.filter(w=>w.entityType==='sales'))Object.assign(w.data,{operationId:'phantom',idempotencyKey:'phantom',businessId:'qa',entityType:'sales',action:'update',createdAt:'2026-10-18T00:00:00Z',schemaVersion:3});
 return{queueId:'phantom-q',operationId:'phantom',businessId:'qa',userId:'seller',status,attempts:1,retryCount:1,lastErrorCode:status==='error'?'permission-denied':null,lastAttemptAt:'2026-10-18T00:00:00Z',createdAtLocal:'2026-10-18T00:00:00Z',payloadVersion:4,payload:{eventKind:'simple',writes}};
}
const legitimate=()=>({queueId:'new-q',operationId:'legitimate',businessId:'qa',userId:'seller',status:'pending',payloadVersion:4,payload:{eventKind:'sale',writes:[{entityType:'sales',entityId:'new-sale',operation:'create',data:{operationId:'legitimate',businessId:'qa',spaceId:'space',actorUid:'seller',valorFinal:10}}]}});
function harness(initial,implementation=source){
 const values=new Map(),committed=[];let actor='seller',generation=1;
 const c={console,Date,Map,Set,Math,Number,String,Boolean,Array,Object,JSON,Error,Promise,structuredClone,encodeURIComponent,crypto:crypto.webcrypto,now:()=> '2026-10-19T12:00:00Z',activeBusinessId:()=> 'qa',queueKey:()=>`adiFesta:qa:${actor}:permissions:syncQueue`,localStorage:{getItem:k=>values.get(k)||null,setItem:(k,v)=>values.set(k,String(v))},checksumValue:hash,updateQueueState(){},stableLegacyOperationId:x=>x.operationId,deviceId:()=> 'device',PAYLOAD_VERSION:4,QUEUE_ENTITY_ALIASES:{},IDEMPOTENT_EVENT_NAMES:new Set(['sales']),sanitizeForFirestore:x=>structuredClone(x),CLOUD_NAMES:['products','productVariants','sales'],SOURCES:{sales:{key:'vendas'}},state:{userProfile:{businessId:'qa'}},currentUser:{uid:'seller'},auth:{currentUser:{uid:'seller'}},syncSessionGeneration:generation,DB:{flush:async()=>{},getWorkspaceGeneration:()=>0},processingPromise:null,readOnlyMode:false,cloudPaused:false,navigator:{onLine:true},validateUser:async()=>{},emit(){},queueErrorBreakdown:()=>({}),commitQueueItem:async q=>{committed.push(q.operationId);return{}},verifySaleQueueCommit:async()=>{},markLocalSaleConfirmed(){},markLocalPaymentConfirmed(){},saleQueueRequiresReview:()=>false};c.window=c;
 vm.createContext(c);
 vm.runInContext(section(implementation,'const queueSubtype =','const roundedMoney'),c);
 vm.runInContext(section(implementation,'const readQueue =','const knownOrphanKey'),c);
 vm.runInContext(section(implementation,'const retryDelay =','const readPullState'),c);
 vm.runInContext(section(implementation,'function migrateScopedQueueCompatibility(','function queueWrites('),c);
 vm.runInContext(section(implementation,'async function processSyncQueue(','function pendingIds('),c);
 values.set(c.queueKey(),JSON.stringify(initial));
 return{c,values,committed,queue:()=>JSON.parse(values.get(c.queueKey())),raw:()=>values.get(c.queueKey()),counts:()=>vm.runInContext('queueCounts()',c),attempt:(p,force=false,manualRetry=false)=>vm.runInContext('canAttempt',c)(p,force,manualRetry),switchTo:uid=>{actor=uid;c.currentUser={uid};c.auth.currentUser={uid};c.syncSessionGeneration=++generation;},setQueue:q=>values.set(c.queueKey(),JSON.stringify(q)),migrate:()=>c.migrateScopedQueueCompatibility(),run:(force,manualRetry=false)=>c.processSyncQueue({force,manualRetry}),save:q=>vm.runInContext('saveQueue',c)(q)};
}
for(const status of ['error','pending','syncing'])for(const migrated of [false,true])test(`historical projection ${status}, compatibility metadata=${migrated}: packet/hash remain immutable through reload and forced/manual Sync`,async()=>{
 const p=phantom(status,migrated),h=harness([p]),before=h.raw(),payloadHash=hash(p.payload);
 h.migrate();const afterFirstEvidence=[...h.values.entries()].find(([k])=>k.includes(':manualReview:'));
 assert.ok(afterFirstEvidence);assert.equal(JSON.parse(afterFirstEvidence[1]).status,'quarantined');
 for(let i=0;i<3;i++){h.migrate();const r=await h.run(i===2);assert.equal(r.sent,0);assert.equal(r.reviewHeld,1);}
 assert.equal(h.raw(),before);assert.equal(hash(h.queue()[0].payload),payloadHash);assert.deepEqual(h.committed,[]);assert.equal(h.counts().pending,0);assert.equal(h.counts().manualReview,1);
 assert.equal(h.values.get(afterFirstEvidence[0]),afterFirstEvidence[1]);assert.equal(JSON.parse(afterFirstEvidence[1]).originalPacketJson,JSON.stringify(p));
 assert.equal([...h.values.keys()].some(k=>k.includes('compatBackup')),false);
});
test('held incident does not prevent one legitimate pending sale from syncing exactly once',async()=>{
 const p=phantom(),h=harness([p,legitimate()]),original=JSON.stringify(p);h.migrate();const r=await h.run(false);assert.equal(r.sent,1);assert.equal(r.reviewHeld,1);assert.deepEqual(h.committed,['legitimate']);assert.equal(h.queue().length,1);assert.equal(JSON.stringify(h.queue()[0]),original);await h.run(true);assert.deepEqual(h.committed,['legitimate']);
});
test('explicit manual_review/quarantined markers are respected for any kind of operation',async()=>{
 for(const flag of [{status:'manual_review'},{status:'quarantined'},{reviewStatus:'manual_review'},{quarantined:true},{reviewRequired:true}]){
  const p={...legitimate(),...flag},h=harness([p]),before=h.raw();h.migrate();await h.run(true);assert.equal(h.raw(),before);assert.deepEqual(h.committed,[]);
 }
});
test('queue writer rejects mutation or deletion of quarantined evidence; sidecar cannot be overwritten',()=>{
 const p=phantom(),h=harness([p]);h.migrate();const before=h.raw();assert.throws(()=>h.save([]),{code:'queue-quarantined-immutable'});
 assert.throws(()=>h.save([{...p,status:'pending'}]),{code:'queue-quarantined-immutable'});assert.equal(h.raw(),before);
 const modified=structuredClone(p);modified.payload.writes[0].data.custo=99;h.setQueue([modified]);assert.throws(()=>h.migrate(),{code:'queue-quarantine-evidence-conflict'});
 assert.equal(JSON.parse([...h.values.entries()].find(([k])=>k.includes(':manualReview:'))[1]).originalPacketJson,JSON.stringify(p));
});
test('seller -> owner -> seller reload isolates evidence, queues and IDs; both roles retain incidents',async()=>{
 const h=harness([phantom()]);h.migrate();const sellerBefore=h.raw();h.switchTo('owner');h.setQueue([]);h.migrate();await h.run(false);assert.deepEqual(h.queue(),[]);h.setQueue([{...phantom('pending',true),userId:'owner'}]);h.migrate();const ownerBefore=h.raw();await h.run(true);assert.equal(h.raw(),ownerBefore);h.switchTo('seller');h.migrate();await h.run(false);assert.equal(h.raw(),sellerBefore);assert.equal(h.committed.length,0);
});
test('genuine denied sale remains eligible for its recovery channel and keeps original payload, not phantom quarantine',async()=>{
 const p={...legitimate(),status:'error',lastErrorCode:'permission-denied',attempts:1},h=harness([p]),before=h.raw();h.migrate();const r=await h.run(true);assert.equal(r.reviewHeld,1);assert.equal(h.raw(),before);assert.equal(h.c.saleQueueRequiresReview(h.queue()[0]),true);assert.equal([...h.values.keys()].some(k=>k.includes(':manualReview:')),false);assert.deepEqual(h.committed,[]);
});
test('quarantined projection does not hide canonical cloud updates or mark historical sales as pending; real pending sales remain protected',()=>{
 const incident=phantom(),sale=legitimate(),h=harness([incident,sale]);
 vm.runInContext(section(source,'function pendingIds(','function markLocalCreditSaleConfirmed('),h.c);
 vm.runInContext(section(source,'function pendingActivityEvents(','function subscribeRecentActivityEvents('),h.c);
 assert.deepEqual(Array.from(h.c.pendingIds('products')),[]);assert.deepEqual(Array.from(h.c.pendingIds('sales')),['new-sale']);
 assert.deepEqual(Array.from(h.c.pendingActivityEvents(),e=>e.eventId),['sale:new-sale']);assert.equal(h.queue().length,2);
});
test('permanent errors cannot retry from time alone or be rewritten by compatibility; legitimate network pending still runs',async()=>{
 const p={...legitimate(),status:'error',lastErrorCode:'invalid-argument',lastAttemptAt:'2020-01-01'},h=harness([p]),before=h.raw();h.migrate();assert.equal(h.raw(),before);assert.equal(h.attempt(p),false);assert.equal(h.attempt(p,true),false);assert.equal(h.attempt(p,true,true),true);await h.run(false);await h.run(true);assert.deepEqual(h.committed,[]);assert.equal(h.raw(),before);await h.run(true,true);assert.deepEqual(h.committed,['legitimate']);
 const pending={...legitimate(),lastErrorCode:'unavailable',lastAttemptAt:'2020-01-01'},network=harness([pending]);await network.run(false);assert.deepEqual(network.committed,['legitimate']);
});
test('V186 reproducer: elapsed error retries automatically; compatibility adds event metadata and converts syncing to pending',()=>{
 const old=execFileSync('git',['show','53ae5e184c4e166328dc75d92d5de1a6cf29a273:js/firebase/sync.js'],{encoding:'utf8',maxBuffer:2e6}),p=phantom(),h=harness([p],old);
 assert.equal(h.attempt(p),true);
 vm.runInContext(section(old,'const stableComparable =','const containsInvalidFirestoreValue')+'\nthis.reproChecksum=checksumValue;',h.c);
 h.setQueue([{...p,status:'syncing'}]);const before=h.c.reproChecksum(p.payload);h.migrate();assert.equal(h.queue()[0].status,'pending');assert.equal(h.queue()[0].lastErrorCode,null);assert.notEqual(h.c.reproChecksum(h.queue()[0].payload),before);assert.equal(h.queue()[0].payload.writes.find(w=>w.entityType==='sales').data.operationId,p.operationId);
 const withoutInjectedIds=structuredClone(h.queue()[0].payload);for(const write of withoutInjectedIds.writes)delete write.data.operationId;
 assert.equal(h.c.reproChecksum(withoutInjectedIds),before,'the injected operationId, unlike ignored metadata, changes the original diagnostic FNV checksum');
});
