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
for(const status of ['pending','error','syncing','local_preparing'])test(`V202 transition holds old ${status} packet before compatibility, auto and forced/manual Sync`,async()=>{
 const p={...legitimate(),status,checksum:'original',attempts:2},h=harness([p]);h.c.AdiFestaBuild={release:'202'};h.c.verifyOperationalProtocol=async()=>{};
 const before=h.raw();h.migrate();await h.run(false);await h.run(true,true);assert.equal(h.raw(),before);assert.deepEqual(h.committed,[]);assert.equal(h.c.queueQuarantineReason(p),'sync_protocol_upgrade_review');assert.match(h.c.preservedQueueMessage(),/versão anterior preservadas para revisão/);
 h.switchTo('owner');h.setQueue([]);await h.run(true);h.switchTo('seller');h.migrate();assert.equal(h.raw(),before);
});
test('V202 new protocol legitimate pending operation still synchronizes normally',async()=>{
 const p={...legitimate(),syncProtocolVersion:1,clientRelease:202},h=harness([p]);h.c.AdiFestaBuild={release:'202'};h.c.verifyOperationalProtocol=async()=>{};await h.run(false);assert.deepEqual(h.committed,['legitimate']);
});
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
 for(const flag of [{status:'manual_review'},{status:'quarantined'},{status:'archived'},{reviewStatus:'archived'},{lastErrorCode:'queue-operation-archived'},{reviewStatus:'manual_review'},{quarantined:true},{reviewRequired:true}]){
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
 const old=execFileSync('git',['show','948a3307eb7cf8074fa34a952da1662420fcc22a:js/firebase/sync.js'],{encoding:'utf8',maxBuffer:2e6}),p=phantom(),h=harness([p],old);
 assert.equal(h.attempt(p),true);
 vm.runInContext(section(old,'const stableComparable =','const containsInvalidFirestoreValue')+'\nthis.reproChecksum=checksumValue;',h.c);
 h.setQueue([{...p,status:'syncing'}]);const before=h.c.reproChecksum(p.payload);h.migrate();assert.equal(h.queue()[0].status,'pending');assert.equal(h.queue()[0].lastErrorCode,null);assert.notEqual(h.c.reproChecksum(h.queue()[0].payload),before);assert.equal(h.queue()[0].payload.writes.find(w=>w.entityType==='sales').data.operationId,p.operationId);
 const withoutInjectedIds=structuredClone(h.queue()[0].payload);for(const write of withoutInjectedIds.writes)delete write.data.operationId;
 assert.equal(h.c.reproChecksum(withoutInjectedIds),before,'the injected operationId, unlike ignored metadata, changes the original diagnostic FNV checksum');
});
function archiveHarness(initial=[phantom()]){
 const h=harness(initial),receipts=new Map(),calls=[];
 h.c.TextEncoder=TextEncoder;h.c.Uint8Array=Uint8Array;
 h.c.FirebaseCallable=async(name,data)=>{
  calls.push({name,data});assert.equal(name,'archiveSyncIncident');
  assert.equal(data.contentHash,crypto.createHash('sha256').update(data.originalPacketJson).digest('hex'));
  const p=JSON.parse(data.originalPacketJson),receipt=receipts.get(p.operationId)||{operationId:p.operationId,businessId:p.businessId,actorUid:p.userId,status:'archived',resolution:'closed_without_replay',archivedAt:'2026-10-19T15:00:00Z',archivedBy:p.userId,method:'explicit_originating_user_confirmation',contentHash:data.contentHash,payloadChecksum:data.payloadChecksum,commercialEffectsApplied:false};receipts.set(p.operationId,receipt);return {data:receipt};
 };
 return {...h,calls,receipts,archive:()=>h.c.archiveQuarantinedOperation(initial[0].operationId)};
}
test('archive preserves original packet/quarantine evidence and IDs byte-for-byte; metadata alone changes',async()=>{
 const h=archiveHarness(),raw=h.raw();h.migrate();const evidence=[...h.values.entries()].find(([k])=>k.includes(':manualReview:'));
 const result=await h.archive();assert.equal(result.status,'archived');assert.equal(h.raw(),raw);assert.equal(h.values.get(evidence[0]),evidence[1]);assert.equal(h.counts().active,0);assert.equal(h.counts().pending,0);assert.equal(h.counts().errors,0);assert.equal(h.counts().quarantined,0);assert.equal(h.counts().archived,1);assert.equal(h.counts().manualReview,0);
 h.migrate();await h.run(true,true);assert.equal(h.raw(),raw);assert.deepEqual(h.committed,[]);assert.throws(()=>h.save([]),{code:'queue-quarantined-immutable'});
});
test('archived incident survives reload + manual/forced Sync + owner/seller changes without retry/checksum changes',async()=>{
 const h=archiveHarness();await h.archive();const persisted=[...h.values.entries()],raw=h.raw(),checksum=hash(h.queue()[0].payload);
 const reloaded=archiveHarness();for(const [k,v]of persisted)reloaded.values.set(k,v);
 for(let i=0;i<3;i++){reloaded.migrate();await reloaded.run(true,true);assert.equal(reloaded.raw(),raw);assert.equal(hash(reloaded.queue()[0].payload),checksum);assert.equal(reloaded.queue()[0].attempts,1);assert.equal(reloaded.counts().archived,1);}
 reloaded.switchTo('owner');reloaded.setQueue([]);await reloaded.run(true);assert.equal(reloaded.counts().archived,0);assert.equal(reloaded.counts().active,0);reloaded.switchTo('seller');reloaded.migrate();await reloaded.run(true);assert.equal(reloaded.raw(),raw);assert.equal(reloaded.counts().archived,1);assert.deepEqual(reloaded.committed,[]);
});
test('archive double click is coalesced; duplicate/lost-response retry is idempotent and never removes original',async()=>{
 const h=archiveHarness(),raw=h.raw();await Promise.all([h.archive(),h.archive()]);assert.equal(h.calls.length,1);const keys=[...h.values.entries()].find(([k])=>k.includes(':incidentArchive:'));await h.archive();assert.equal(h.values.get(keys[0]),keys[1]);assert.equal(h.raw(),raw);
 const lost=archiveHarness(),call=lost.c.FirebaseCallable;let first=true;lost.c.FirebaseCallable=async(...args)=>{const result=await call(...args);if(first){first=false;throw Error('lost response');}return result;};await assert.rejects(lost.archive(),/lost response/);assert.equal(lost.counts().quarantined,1);assert.equal(lost.counts().archived,0);await lost.run(true,true);assert.deepEqual(lost.committed,[]);await lost.archive();assert.equal(lost.counts().archived,1);assert.equal(lost.raw(),raw);assert.equal(lost.receipts.size,1);
});
test('archive receipt from obsolete session cannot enter owner namespace; seller original is preserved',async()=>{
 const h=archiveHarness(),raw=h.raw(),call=h.c.FirebaseCallable;let release;h.c.FirebaseCallable=async(...args)=>{const response=await call(...args);await new Promise(resolve=>{release=resolve;});return response;};
 const pending=h.archive();while(!release)await new Promise(resolve=>setImmediate(resolve));h.switchTo('owner');h.setQueue([]);release();await assert.rejects(pending,{code:'sync-session-obsolete'});assert.deepEqual(h.queue(),[]);assert.equal([...h.values.keys()].some(k=>k.includes('owner')&&k.includes(':incidentArchive:')),false);h.switchTo('seller');assert.equal(h.raw(),raw);assert.equal(h.counts().archived,0);h.c.FirebaseCallable=call;await h.archive();assert.equal(h.counts().archived,1);
});
test('archived occurrence does not block a legitimate sale, nor include a genuine denied sale in the archive',async()=>{
 const h=archiveHarness([phantom(),legitimate()]);await h.archive();const r=await h.run(true,true);assert.equal(r.sent,1);assert.deepEqual(h.committed,['legitimate']);assert.equal(h.counts().active,0);assert.equal(h.counts().archived,1);
 const denied=archiveHarness([{...legitimate(),status:'error',lastErrorCode:'permission-denied'}]),before=denied.raw();await assert.rejects(denied.archive(),/quarentena/);assert.equal(denied.raw(),before);assert.equal(denied.calls.length,0);
});
test('quarantine-only notice is informational, but real pending/error/denied sales and integrity failures still warn',()=>{
 const h=archiveHarness();vm.runInContext(section(source,'function describeSyncResult(','function synchronizeNow('),h.c);
 const q=h.counts();assert.equal(q.errors,0);assert.equal(q.active,0);assert.equal(h.c.preservedQueueMessage(q),'1 ocorrência preservada para análise. Nenhuma sincronização pendente.');
 assert.equal(h.c.describeSyncResult({complete:true,dataSynced:true,quarantined:1,comparison:{ok:true}}),h.c.preservedQueueMessage(q));
 assert.match(h.c.describeSyncResult({errors:1,quarantined:1}),/incompleta/);assert.match(h.c.describeSyncResult({pending:1,quarantined:1}),/incompleta/);
 assert.match(h.c.describeSyncResult({dataSynced:true,complete:true,comparison:{ok:false},quarantined:1}),/diferenças/);
 assert.match(h.c.describeSyncResult({dataSynced:true,complete:true,quarantined:1,integrity:{actionable:true,level:'CRITICO'}}),/crítica/);
 assert.match(h.c.describeSyncResult({dataSynced:true,quarantined:1,integrityStatus:'failed'}),/Não foi possível/);
 assert.match(h.c.describeSyncResult({dataSynced:true,complete:true,quarantined:1,syncFailure:{code:'permission-denied'}}),/falha ativa/);
 const real=harness([{...legitimate(),status:'error',lastErrorCode:'permission-denied'}]);assert.equal(real.counts().errors,0);assert.equal(real.counts().manualReview,1);assert.equal(real.counts().active,1);assert.equal(h.c.preservedQueueMessage(real.counts()),'');
});
test('current incident classifier/checksum agree with backend without special IDs or QA bypass',()=>{
 const backend=require('../functions/src/services/sync-incident-service'),h=archiveHarness();vm.runInContext(section(source,'const stableComparable =','const containsInvalidFirestoreValue')+'\nthis.computeIncidentChecksum=checksumValue;',h.c);
 for(const p of [phantom(),phantom('pending',true),legitimate()]){assert.equal(h.c.isHistoricalProjectionBatch(p),backend.historicalProjection(p));assert.equal(h.c.computeIncidentChecksum(p.payload),backend.payloadChecksum(p.payload));}
 assert.doesNotMatch(fs.readFileSync('functions/src/services/sync-incident-service.js','utf8'),/9b4edfc5|qa_v170|9f2c11b7|ba77ad13/);
});
test('archive receipts and original queue persist atomically in real business-cache lifecycle; second tab cannot overwrite',async()=>{
 const cacheHarness=require('./helpers/cache-lifecycle-harness.cjs').harness(),a=cacheHarness.runtime(),b=cacheHarness.runtime();await a.open('seller');
 const packet={...phantom(),businessId:'qa-business'},h=archiveHarness([packet]),raw=h.raw();h.c.localStorage=a.cache.keyValue;h.c.DB.flush=()=>a.cache.flush();h.c.activeBusinessId=()=> 'qa-business';
 h.c.queueKey=()=>a.queue('seller');a.cache.keyValue.setItem(a.queue('seller'),raw);
 const original=a.cache.keyValue.getItem(a.queue('seller'));await h.archive();
 await assert.rejects(b.open('seller'),{code:'local-cache-in-use'});await a.cache.release();await b.open('seller');
 assert.equal(b.cache.keyValue.getItem(b.queue('seller')),original);
 assert.equal(JSON.parse(b.cache.keyValue.getItem(`${b.queue('seller')}:incidentArchive:phantom`)).status,'archived');
 assert.equal(JSON.parse(b.cache.keyValue.getItem(`${b.queue('seller')}:manualReview:phantom-q`)).originalPacketJson,JSON.stringify(packet));
 await b.cache.release();
});
test('corrupt archive metadata fails closed and remains an actionable diagnostic instead of claiming all synced',async()=>{
 const h=archiveHarness();await h.archive();const [key]=[...h.values.entries()].find(([k])=>k.includes(':incidentArchive:'));h.values.set(key,'corrupt');
 assert.equal(h.counts().errors,1);assert.equal(h.counts().corrupt,true);assert.equal(h.c.preservedQueueMessage(h.counts()),'');await assert.rejects(h.run(true,true),/quar|arquiv|fila/i);assert.equal(h.committed.length,0);
});
test('informational preserved notice never hides bootstrap, active listener failure, orphan or integrity warning',()=>{
 const h=archiveHarness(),events=[];h.c.emit=p=>events.push(p);h.c.saleIntegrityDiagnostics=()=>({count:0});h.c.paymentIntegrityDiagnostics=()=>({count:0});
 vm.runInContext(section(source,'function updateQueueState()','function reportError('),h.c);
 Object.assign(h.c.state,{status:'waiting',testPassed:true,hydrated:true,listenerConnected:true,syncFailure:null});h.c.updateQueueState();assert.match(events.at(-1).message,/preservada para análise/);events.length=0;
 for(const patch of [{syncFailure:{code:'permission-denied'}},{hydrated:false},{listenerConnected:false},{status:'syncing'},{dataAudit:{integrity:{actionable:true}}}]){
  Object.assign(h.c.state,{status:'waiting',testPassed:true,hydrated:true,listenerConnected:true,syncFailure:null,dataAudit:null},patch);h.c.updateQueueState();assert.equal(events.length,0);
 }
 Object.assign(h.c.state,{status:'waiting',hydrated:true,listenerConnected:true,syncFailure:null,dataAudit:null});h.c.saleIntegrityDiagnostics=()=>({count:1});h.c.updateQueueState();assert.equal(events.at(-1).status,'error');assert.match(events.at(-1).message,/pendência comprovada/);
});
