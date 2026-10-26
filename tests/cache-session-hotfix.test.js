'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {harness}=require('./helpers/cache-lifecycle-harness.cjs');
const packet={queueId:'original-queue',operationId:'original-operation',saleId:'original-sale',businessId:'qa-business',userId:'owner',status:'pending',payload:{writes:[{entityType:'sales',entityId:'original-sale',operation:'create',data:{valorFinal:25}}]}};
const data=n=>({config:{},vendas:[{id:'sale-'+n}],movimentacoesEstoque:[]});
test('two tabs same identity: only one writer; second tab never overwrites; release/reload retains exact queue',async()=>{
 const h=harness(),a=h.runtime(),b=h.runtime();await a.open('owner');a.cache.keyValue.setItem(a.queue('owner'),JSON.stringify([packet]));a.cache.stage(data(1),a.key('owner'));await a.cache.flush();
 const before=JSON.stringify([...h.rows]);await assert.rejects(b.open('owner'),{code:'local-cache-in-use'});assert.equal(JSON.stringify([...h.rows]),before);
 await a.cache.release();const loaded=await b.open('owner');assert.equal(loaded.vendas[0].id,'sale-1');assert.deepEqual(JSON.parse(b.cache.keyValue.getItem(b.queue('owner'))),[packet]);await b.cache.release();
});
test('different identities have different locks, records and queues; stale queue keys cannot target the new identity',async()=>{
 const h=harness(),a=h.runtime(),b=h.runtime();await Promise.all([a.open('owner'),b.open('seller')]);
 a.cache.stage(data('owner'),a.key('owner'));b.cache.stage(data('seller'),b.key('seller'));await Promise.all([a.cache.flush(),b.cache.flush()]);
 await a.cache.release();const seller=await a.open('seller').catch(e=>e);assert.equal(seller.code,'local-cache-in-use');await b.cache.release();await a.open('seller');
 assert.throws(()=>a.cache.stage(data('old'),a.key('owner')),{code:'local-cache-scope-changed'});
 assert.throws(()=>a.cache.keyValue.setItem(a.queue('owner'),JSON.stringify([packet])),{code:'local-cache-session-retired'});assert.throws(()=>a.cache.keyValue.removeItem(a.queue('owner')),{code:'local-cache-session-retired'});await a.cache.release();
});
test('fallback browser: legitimate CAS conflict never overwrites durable rows; unsaved data/queue are preserved append-only before account switch',async()=>{
 const h=harness(),a=h.runtime({locking:false}),b=h.runtime({locking:false});await Promise.all([a.open('owner'),b.open('owner')]);
 a.cache.stage(data('new'),a.key('owner'));await a.cache.flush();const current=JSON.stringify([...h.rows]);
 b.cache.keyValue.setItem(b.queue('owner'),JSON.stringify([packet]));b.cache.stage(data('pending'),b.key('owner'));await assert.rejects(b.cache.flush(),{code:'local-cache-conflict'});assert.equal(JSON.stringify([...h.rows]),current);
 await b.cache.release();const archives=[...h.rows.values()].filter(r=>r.reason==='local-cache-conflict');assert.equal(archives.length,1);
 const preserved=[...h.rows.values()].filter(r=>r.scope===archives[0].scope);assert.ok(preserved.some(r=>r.field==='vendas'&&r.value?.id==='sale-pending'));assert.ok(preserved.some(r=>r.field===b.queue('owner')&&r.value?.operationId===packet.operationId));
 assert.deepEqual([...h.rows].filter(([,r])=>!r.scope?.includes(':preserved:')),JSON.parse(current));
 const fresh=await b.open('seller');assert.equal(fresh.vendas.length,0);assert.equal(b.cache.keyValue.getItem(b.queue('seller')),null);await b.cache.release();
});
test('preservation storage failure blocks transition without dropping memory, queues, or overwriting canonical rows',async()=>{
 const h=harness(),a=h.runtime({locking:false}),b=h.runtime({locking:false});await Promise.all([a.open('owner'),b.open('owner')]);a.cache.stage(data('new'));await a.cache.flush();
 b.cache.keyValue.setItem(b.queue('owner'),JSON.stringify([packet]));b.cache.stage(data('pending'));await assert.rejects(b.cache.flush(),{code:'local-cache-conflict'});const before=JSON.stringify([...h.rows]);
 h.failWrites(true);await assert.rejects(b.cache.release());assert.equal(b.cache.pending(),true);assert.equal(JSON.stringify([...h.rows]),before);h.failWrites(false);await b.cache.release();assert.ok([...h.rows.values()].some(r=>r.reason==='local-cache-conflict'));
});
test('BroadcastChannel is advisory: newer revision retires only matching scope, blocks old writes; clean reload reads latest revision',async()=>{
 const h=harness(),a=h.runtime({locking:false,broadcast:true}),b=h.runtime({locking:false,broadcast:true}),c=h.runtime({locking:false,broadcast:true});await Promise.all([a.open('owner'),b.open('owner'),c.open('seller')]);
 a.cache.stage(data('new'));await a.cache.flush();await h.settle();assert.equal(b.cache.ready(),false);assert.equal(c.cache.ready(),true);assert.throws(()=>b.cache.stage(data('old')),{code:'local-cache-conflict'});
 const loaded=await b.open('owner');assert.equal(loaded.vendas[0].id,'sale-new');await Promise.all([a.cache.release(),b.cache.release(),c.cache.release()]);
});
test('serialized lifecycle: superseded opening cannot activate a stale namespace; release fences callbacks immediately',async()=>{
 const h=harness(),a=h.runtime();const first=a.open('owner'),release=a.cache.release(),second=a.open('seller');await assert.rejects(first,{code:'local-cache-session-retired'});await release;await second;
 assert.equal(a.cache.ready(),true);const closing=a.cache.release();assert.equal(a.cache.ready(),false);assert.throws(()=>a.cache.stage(data('late')),{code:'local-cache-session-retired'});await closing;
});
test('bootstrap uses actionable local conflict state, never UID warning; diagnostics before cache readiness are read-only',()=>{
 const auth=fs.readFileSync('js/firebase/auth.js','utf8'),sync=fs.readFileSync('js/firebase/sync.js','utf8'),s={esc:String,abbreviateTechnicalId:String};vm.createContext(s);
 vm.runInContext(auth.slice(auth.indexOf('function bootstrapTechnicalDetails('),auth.indexOf('function suspendRuntimeForAccessCheck(')),s);
 assert.doesNotMatch(s.bootstrapTechnicalDetails({code:'local-cache-conflict'}),/UID divergente|Firebase Authentication/);assert.match(s.bootstrapTechnicalDetails({code:'profile/uid-mismatch',authUid:'test'}),/UID divergente/);
 let writes=0;s.window={DB:{businessCache:{ready:()=>false}}};s.localStorage={getItem(){throw Error('must not read storage');},setItem(){writes++;}};
 vm.runInContext(sync.slice(sync.indexOf('const deviceId ='),sync.indexOf('const stableLegacyOperationId ='))+'\nthis.device=deviceId;',s);assert.equal(s.device({diagnostic:true}),null);assert.equal(writes,0);
 assert.match(auth,/local_cache_conflict/);assert.match(auth,/Atualizar esta aba com segurança/);
});
test('Auth owner -> seller -> owner fences old runtime before awaiting preservation; duplicate callbacks authorize only the latest identity',async()=>{
 const source=fs.readFileSync('js/firebase/auth.js','utf8'),events=[],releases=[];
 const s={authObserverUid:null,authTransitionSequence:0,authRelease:Promise.resolve(),bootstrapSequence:0,bootstrapRun:null,readyUid:'',bootstrapState:'unauthenticated',automaticBootstrapAttempts:new Set(),INVITE_TOKEN:'',
  auth:{currentUser:{uid:'owner'}},document:{querySelector:()=>({innerHTML:''})},screen:()=>events.push('gate'),brandMarkup:()=>'',setBootstrapState:(state)=>{s.bootstrapState=state;},bootstrapLog(){},login:()=>events.push('login'),
  cleanupCurrentSession:()=>events.push('cleanup'),BusinessContext:{clear:()=>events.push('context-clear')},DB:{releaseBusiness:()=>{events.push('release');return new Promise(resolve=>releases.push(resolve));}},WorkspaceRuntime:{endSession:()=>events.push('workspace-end')},
  SyncFirebase:{setAuthReady(){},stop:()=>events.push('sync-stop')},handleBootstrapError:(_,e)=>{throw e;},normalizedCode:e=>e.code,
  startBootstrap:async user=>{events.push('start-'+user.uid);s.readyUid=user.uid;s.bootstrapState='authorized';},console};s.window=s;vm.createContext(s);
 vm.runInContext(source.slice(source.indexOf('function retireAuthRuntime('),source.indexOf("addEventListener('local-cache-obsolete'")),s);
 const owner=s.handleAuthIdentity({uid:'owner'});assert.ok(events.indexOf('sync-stop')<events.indexOf('release'));assert.equal(events.some(e=>e.startsWith('start')),false);
 s.auth.currentUser={uid:'seller'};const seller=s.handleAuthIdentity({uid:'seller'}),duplicate=s.handleAuthIdentity({uid:'seller'});releases[0]();await Promise.resolve();releases[1]();await Promise.all([owner,seller,duplicate]);assert.deepEqual(events.filter(e=>e.startsWith('start')),['start-seller']);
 s.auth.currentUser={uid:'owner'};const back=s.handleAuthIdentity({uid:'owner'});releases[2]();await back;assert.deepEqual(events.filter(e=>e.startsWith('start')),['start-seller','start-owner']);
 await s.handleAuthIdentity({uid:'owner'});assert.equal(events.filter(e=>e==='start-owner').length,1);
});
function queueRuntime(){
 const source=fs.readFileSync('js/firebase/sync.js','utf8'),queues=new Map([['owner',[structuredClone(packet)]],['seller',[{queueId:'seller-queue',operationId:'seller-operation',userId:'seller',businessId:'qa-business',status:'pending',payload:{writes:[]}}]]]);let complete,entered;
 const enteredPromise=new Promise(r=>entered=r),s={console,Date,Map,Set,Math,Error,Object,Promise,structuredClone,processingPromise:null,readOnlyMode:false,cloudPaused:false,syncSessionGeneration:1,currentUser:{uid:'owner'},auth:{currentUser:{uid:'owner'}},state:{userProfile:{businessId:'qa-business'}},navigator:{onLine:true},
  DB:{flush:async()=>{}},queueCounts:()=>({corrupt:false,total:queues.get(s.currentUser?.uid)?.length||0,errors:0}),readQueue:()=>structuredClone(queues.get(s.currentUser.uid)),saveQueue:q=>queues.set(s.currentUser.uid,structuredClone(q)),
  validateUser:async()=>{},updateQueueState(){},activeBusinessId:()=> 'qa-business',saleQueueRequiresReview:()=>false,queueManualReviewReason:()=>'',preserveQueueQuarantine:()=>false,queuePreflight:()=>({ok:true}),canAttempt:()=>true,now:()=> '2026-10-18T00:00:00Z',emit(){},
  commitQueueItem:async()=>{entered();return new Promise(r=>complete=r);},verifySaleQueueCommit:async()=>{throw Error('old verification must not run');},markLocalSaleConfirmed:()=>{throw Error('old ack must not run');},markLocalPaymentConfirmed(){},errorCode:e=>e.code,queueErrorBreakdown:()=>({}),CLOUD_NAMES:[],reportError:()=>{throw Error('old error must not affect new session');}};
 // Current V202+ runner checks the browser session and the read-only recovery
 // acknowledgements before sending. This old harness omitted both globals.
 s.window=s;s.refreshRecoveryResolutions=async()=>{};
 vm.createContext(s);vm.runInContext(source.slice(source.indexOf('async function processSyncQueue('),source.indexOf('function pendingIds(')),s);
 return{s,queues,entered:enteredPromise,finish:()=>complete({})};
}
test('Sync response after account switch cannot acknowledge, remove or change any queue in the new identity',async()=>{
 const h=queueRuntime(),pending=h.s.processSyncQueue();await h.entered;
 const sellerBefore=JSON.stringify(h.queues.get('seller'));h.s.syncSessionGeneration++;h.s.currentUser={uid:'seller'};h.s.auth.currentUser={uid:'seller'};h.finish();
 await assert.rejects(pending,{code:'sync-session-retired'});assert.equal(JSON.stringify(h.queues.get('seller')),sellerBefore);assert.equal(h.queues.get('owner').length,1);assert.equal(h.queues.get('owner')[0].operationId,packet.operationId);
});
test('transaction retry/read completion after session switch cannot enqueue any Firestore writes',async()=>{
 const source=fs.readFileSync('js/firebase/sync.js','utf8'),start=source.indexOf('async function commitQueueItem('),end=source.indexOf('async function verifySaleQueueCommit('),writes=[];let resolveRead,entered;
 const ready=new Promise(r=>entered=r),s={window:{WorkspaceRuntime:{capture(){}}},syncSessionGeneration:1,currentUser:{uid:'owner'},auth:{currentUser:{uid:'owner'}},state:{userProfile:{businessId:'qa-business'}},db:{},queuePreflight:()=>({ok:true}),activeBusinessId:()=> 'qa-business',stableLegacyOperationId:x=>x.operationId,doc:(...a)=>a,financialEffectFromWrites:()=>null,currentPath:'',
  runTransaction:async(db,callback)=>callback({get:async()=>{entered();return new Promise(r=>resolveRead=r);},set:(...a)=>writes.push(a)}),Object,Error,Proxy,Reflect};
 vm.createContext(s);vm.runInContext(source.slice(start,end),s);const pending=s.commitQueueItem({operationId:packet.operationId,payload:{eventKind:'simple',writes:[]}});await ready;
 s.syncSessionGeneration++;s.currentUser={uid:'seller'};s.auth.currentUser={uid:'seller'};resolveRead({exists:()=>false});await assert.rejects(pending,{code:'sync-session-retired'});assert.equal(writes.length,0);
});
