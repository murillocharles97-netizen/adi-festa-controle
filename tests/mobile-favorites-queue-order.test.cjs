'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

const sync = fs.readFileSync('js/firebase/sync.js', 'utf8');
const products = fs.readFileSync('js/produtos.js', 'utf8');
const slice = (from, to) => sync.slice(sync.indexOf(from), sync.indexOf(to, sync.indexOf(from) + 1));
const clientCode =
  slice('function classifyQueueOperation(', 'function queueStateFields(') +
  slice('const retryDelay =', 'function paymentQueueRequiresReview(') +
  slice('function migrateScopedQueueCompatibility(', 'function queueWrites(') +
  slice('function saveProductFavorites(', 'async function validateUser(') +
  slice('async function processSyncQueue(', 'function markLocalCreditSaleConfirmed(');

const businessId = 'qa-favorite-business';
const userId = 'qa-favorite-owner';
const update = (entityType, entityId, data, before = null) => ({entityType, entityId, operation:'update', data, before});
const packet = (operationId, source, writes, fields = {}) => ({
  queueId:operationId, operationId, source, businessId, userId, status:'pending', syncProtocolVersion:1,
  payload:{eventKind:'simple',writes}, ...fields,
});
const favorite = (operationId, source, favorito, id = 'a', fields) =>
  packet(operationId, source, [update('products',id,{favorito},{favorito:!favorito,atualizadoEm:'initial'})], fields);
const unavailable = () => Object.assign(Error('Unavailable'), {code:'unavailable',syncDetail:{stage:'server_operational_commit'}});
const denied = () => Object.assign(Error('Denied'), {code:'permission-denied',syncDetail:{stage:'server_operational_commit'}});

function harness(initial, remoteCommit) {
  const data={produtos:['a','b'].map(id=>({id,favorito:initial,atualizadoEm:'initial',estoqueAtual:7}))};
  const remote=new Map(data.produtos.map(product=>[product.id,{...product}]));
  const receipts=new Set(), attempts=[], applied=[], wakeups=[], notifications=[], stars=new Map(), frames=[];
  let persisted='[]', clock=Date.now(), nextId=0;
  const queued=()=>JSON.parse(persisted), enqueue=item=>{persisted=JSON.stringify([...queued(),item]);};
  const date=class extends Date { static now() {return clock;} };
  const account={uid:userId};
  const member={captureSession:()=>userId,assertSession:uid=>assert.equal(uid,userId)};
  const readQueueStrict=queued;
  const window={
    WorkspaceRuntime:{capture(){}},TeamAccess:member,Utils:{toast:message=>notifications.push(message)},
    requestAnimationFrame:fn=>frames.push(fn),dispatchEvent(){},
  };
  const DB={
    __firebaseSyncWrapped:true,carregar:()=>data,flush:async()=>{},
    getPrincipal:()=>userId,getBusinessId:()=>businessId,getWorkspaceGeneration:()=>0,
    stageProductFavorites(updates) {
      data.produtos=data.produtos.map(product=>updates.has(product.id)?{...product,...updates.get(product.id)}:product);
    },
  };
  let respond;
  let context;

  async function apply(item) {
    if(receipts.has(item.operationId))return;
    for(const write of item.payload.writes) if(write.entityType==='products')
      Object.assign(remote.get(write.entityId),write.data);
    receipts.add(item.operationId);
    applied.push(item.operationId);
  }

  function start() {
    context=vm.createContext({
      window,DB,Utils:window.Utils,Date:date,crypto:{randomUUID:()=> 'new-'+(++nextId)}, structuredClone,
      CSS:{escape:String},CustomEvent:class {},document:{
        querySelectorAll(selector) {
          const id=selector.match(/data-product-favorite="([^"]+)"/)[1];
          return [{classList:{toggle(){},add(){}},setAttribute(name,value) { if(name==='aria-pressed')stars.set(id,value==='true'); }}];
        },
      },
      setTimeout:()=>1,clearTimeout(){},
      processingPromise:null,manualSyncPromise:null,automaticSyncPromise:null,readOnlyMode:false,cloudPaused:false,
      currentUser:account,auth:{currentUser:account},state:{userProfile:{businessId}},syncSessionGeneration:1,
      activeBusinessId:()=>businessId,navigator:{onLine:true},now:()=>new Date(++clock).toISOString(),currentPath:'',
      captureCloudReadScope:()=>businessId,scheduleImmediate:()=>wakeups.push('sync'),
      readQueue:queued,readQueueStrict,saveQueue:queue=>{persisted=JSON.stringify(queue);},queueKey:()=> 'qa-queue',
      localStorage:{setItem() {},getItem:()=>null},queueCounts:()=>({pending:queued().length}),updateQueueState(){},
      queueWrites:(writes,operationId,eventKind,{source})=>enqueue({...packet(operationId,source,writes),payload:{eventKind,writes}}),
      QUEUE_ENTITY_ALIASES:{produtos:'products'},CLOUD_NAMES:['products','sales','payments','stockMovements'],
      IDEMPOTENT_EVENT_NAMES:new Set(['sales','payments','stockMovements']),PAYLOAD_VERSION:3,deviceId:()=> 'qa-device',
      sanitizeForFirestore:value=>value,stableLegacyOperationId:item=>item.operationId,queueSubtype:()=> 'simple',
      validateUser:async()=>{},refreshRecoveryResolutions:async()=>{},emit(){},reportError(){},
      readPaymentRecoveryReceipt:()=>null,readRecoveryResolution:()=>null,readQueueArchive:()=>null,recoveryResolutionKey:()=> 'qa-resolution',
      queueManualReviewReason:item=>item.reviewRequired?'manual':'',queuePreflight:()=>({ok:true}),
      preserveQueueQuarantine:item=>Boolean(item.reviewRequired),paymentQueueRequiresReview:()=>false,
      paymentQueueDependsOnReview:()=>false,saleQueueRequiresReview:()=>false,queueErrorBreakdown:()=>[],
      isHistoricalProjectionBatch:()=>false,verifySaleQueueCommit:async()=>{},markLocalSaleConfirmed(){},markLocalPaymentConfirmed(){},
      errorCode:error=>error.code,async commitQueueItem(item) {
        attempts.push(item.operationId);
        if(respond)await respond(item,remoteCommit || apply);
        else await (remoteCommit || apply)(item);
      },
    });
    vm.runInContext(clientCode+products,context);
    window.SyncFirebase={saveProductFavorites:context.saveProductFavorites};
    for(const product of data.produtos)stars.set(product.id,window.Produtos.mobileFavoriteValue(product));
    return context;
  }

  start();
  return {
    attempts, applied, remote, data, stars, wakeups, notifications, queued, enqueue,
    seed: item=>{enqueue(item); for(const write of item.payload.writes) if(Object.hasOwn(write.data,'favorito')){
      const product=data.produtos.find(p=>p.id===write.entityId);
      Object.assign(product,write.data);
      stars.set(product.id,product.favorito);
    }},
    setOnline:value=>{context.navigator.onLine=value;},
    retry: (elapsed=0)=>{clock+=elapsed;return context.processSyncQueue();},
    retryManually:()=>context.processSyncQueue({force:true,manualRetry:true}),
    respond:fn=>{respond=fn;},
    restart:()=>start().migrateScopedQueueCompatibility(),
    tap:id=>window.Produtos.toggleMobileFavorite(id),
    flushTap:()=>{while(frames.length)frames.shift()();},
  };
}

for (const initial of [false,true]) {
  test('legacy '+(!initial?'favorite':'unfavorite')+' followed by the inverse survives reconnect and backoff',async()=>{
    const h=harness(initial);
    h.setOnline(false);
    const original=favorite('old','local',!initial);
    h.seed(original);h.tap('a');h.flushTap();
    assert.equal(h.stars.get('a'),initial);
    await h.retry();
    assert.deepEqual(h.attempts,[]);
    h.setOnline(true);
    h.respond(async (item,apply)=>{ if(h.attempts.length<=2)throw unavailable(); await apply(item); });
    await h.retry();
    assert.deepEqual(h.queued()[0].payload,original.payload);
    await h.retry(5000);
    assert.deepEqual(h.attempts,['old','old']);
    await h.retry(15000);
    assert.deepEqual(h.applied,['old','new-1']);
    assert.equal(h.remote.get('a').favorito,initial);
    assert.equal(h.stars.get('a'),initial);
    assert.equal(h.queued().length,0);
  });
}

test('two old sources and a new tap retain order, while unrelated products and sale packets still pass', async()=>{
  const h=harness(false);
  h.seed(favorite('old-1','legacy_queue',true,'a',{workspaceGeneration:0}));
  h.seed(favorite('old-2','local',false));
  h.tap('a');h.flushTap();
  h.tap('b');h.flushTap();
  h.enqueue(packet('sale','sale-write-ahead',[update('products','a',{estoqueAtual:6},{favorito:true,estoqueAtual:7})]));
  const held=packet('payment','payment-write-ahead',[update('payments','payment',{valor:25})],{reviewRequired:true});
  h.enqueue(held);
  h.respond(async(item,apply)=>{if(item.operationId==='old-1'&&h.attempts.length===1)throw unavailable(); await apply(item);});
  await h.retry();
  assert.deepEqual(h.applied,['new-2','sale']);
  assert.deepEqual(h.queued().map(item=>item.operationId),['old-1','old-2','new-1','payment']);
  await h.retry(5000);
  assert.deepEqual(h.applied,['new-2','sale','old-1','old-2','new-1']);
  assert.deepEqual(h.queued(),[held]);
  assert.equal(h.remote.get('a').estoqueAtual,6);
  assert.equal(h.remote.get('a').favorito,true);
  assert.equal(h.remote.get('b').favorito,true);
  assert.equal(h.stars.get('a'),true);
  assert.equal(h.stars.get('b'),true);
});

test('a tap during an in-flight commit paints immediately and wakes sync after that pass',async()=>{
  const h=harness(false);
  h.seed(favorite('old','local',true));
  let ready, finish;
  const started=new Promise(resolve=>{ready=resolve;});
  const released=new Promise(resolve=>{finish=resolve;});
  h.respond(async(item,apply)=>{if(item.operationId==='old'){ready();await released;} await apply(item);});
  const pass=h.retry();
  await started;
  h.tap('a');
  assert.equal(h.stars.get('a'),false);
  h.flushTap();
  assert.deepEqual(h.attempts,['old']);
  assert.equal(h.queued()[0].status,'syncing');
  assert.equal(h.wakeups.length,0);
  finish();
  await pass;
  assert.deepEqual(h.wakeups,['sync']);
  await h.retry();
  assert.deepEqual(h.applied,['old','new-1']);
  assert.equal(h.remote.get('a').favorito,false);
  assert.equal(h.stars.get('a'),false);
});

test('restart replays an in-flight envelope with its original ID after a lost response',async()=>{
  const h=harness(false);
  const original=favorite('old','local',true,'a',{status:'syncing',lastAttemptAt:'2026-01-01T00:00:00Z'});
  h.seed(original);h.tap('a');h.flushTap();
  h.remote.get('a').favorito=true;
  h.respond(async(item,apply)=>{if(item.operationId!=='old')await apply(item);}); // Old ID is already confirmed.
  h.restart();
  assert.equal(h.queued()[0].status,'pending');
  assert.deepEqual(h.queued()[0].payload,original.payload);
  assert.equal(h.stars.get('a'),false);
  await h.retry();
  assert.deepEqual(h.attempts,['old','new-1']);
  assert.deepEqual(h.applied,['new-1']);
  assert.equal(h.remote.get('a').favorito,false);
  assert.equal(h.stars.get('a'),false);
});

test('consecutive definitive rejections across sources revert the star and never replay the failed packets',async()=>{
  const h=harness(false);
  h.seed(favorite('old','local',true));
  h.tap('a');h.flushTap();
  h.respond(async()=>{throw denied();});
  await h.retry();
  assert.equal(h.remote.get('a').favorito,false);
  assert.equal(h.stars.get('a'),false);
  assert.equal(h.data.produtos[0].atualizadoEm,'initial');
  assert.deepEqual(h.queued().map(item=>[item.operationId,item.favoriteRejectedWithoutEffect]),[['old',true],['new-1',true]]);
  assert.equal(h.notifications.length,1);
  h.restart();
  await h.retryManually();
  assert.deepEqual(h.attempts,['old','new-1']);
});

test('a rejection on retry cannot release a successor while the original outcome is uncertain',async()=>{
  const h=harness(false);
  h.seed(favorite('old','local',true));
  h.tap('a');h.flushTap();
  h.respond(async(item,apply)=>{
    if(h.attempts.length===1){await apply(item);throw unavailable();}
    if(h.attempts.length===2)throw denied();
    await apply(item);
  });
  await h.retry();
  await h.retry(5000);
  assert.deepEqual(h.attempts,['old','old']);
  assert.equal(h.queued()[0].favoriteRejectedWithoutEffect,undefined);
  assert.equal(h.queued()[0].status,'error');
  assert.equal(h.stars.get('a'),false);
  await h.retryManually();
  assert.deepEqual(h.applied,['old','new-1']);
  assert.equal(h.remote.get('a').favorito,false);
  assert.equal(h.stars.get('a'),false);
});

test('rapid taps paint immediately and send a single final intent',async()=>{
  const h=harness(false);
  for(const value of [true,false,true]){
    h.tap('a');
    assert.equal(h.stars.get('a'),value);
  }
  assert.equal(h.queued().length,0);
  h.flushTap();
  assert.equal(h.queued().length,1);
  await h.retry();
  assert.deepEqual(h.applied,['new-1']);
  assert.equal(h.remote.get('a').favorito,true);
  assert.equal(h.stars.get('a'),true);
});


test('Firestore Emulator confirms the last intent, one receipt per operation and safe rejection', {
  skip: !process.env.VECONI_FAVORITES_QUEUE_EMULATOR,
}, async () => {
  assert.match(process.env.FIRESTORE_EMULATOR_HOST || '', /^(127\.0\.0\.1|localhost):\d+$/);
  const {createRequire}=require('node:module');
  const fromFunctions=createRequire(require('node:path').resolve('functions/package.json'));
  const {initializeApp,deleteApp}=fromFunctions('firebase-admin/app');
  const {getFirestore}=fromFunctions('firebase-admin/firestore');
  const {operationalCommitService}=require('../functions/src/services/operational-commit-service');
  const app=initializeApp({projectId:'demo-veconi-favorite-order'},'favorites-queue-qa');
  const db=getFirestore(app);
  const root=db.doc('businesses/'+businessId);
  const product=root.collection('products').doc('a');
  const marker=id=>root.collection('processedOperations').doc(id);
  const service=operationalCommitService(db);
  const commit=item=>service.commit({auth:{uid:userId},data:{businessId,clientRelease:230,syncProtocolVersion:1,item}});
  try {
    await Promise.all([
      root.set({active:true,ownerId:userId,subscription:{planId:'internal',status:'active'}}),
      db.doc('users/'+userId).set({active:true,businessId,role:'owner'}),
      root.collection('members').doc(userId).set({status:'active',role:'owner',spaceAccess:'all'}),
      product.set({id:'a',businessId,favorito:false,estoqueAtual:7,preco:25,spaceAccessMode:'all_spaces',allowedSpaceIds:[]}),
    ]);
    const h=harness(false,commit);
    h.seed(favorite('old','local',true));
    h.tap('a');h.flushTap();
    h.respond(async(item,send)=>{
      if(h.attempts.length===1)throw unavailable();
      const result=await send(item);
      if(h.attempts.length===2){assert.equal(result.replayed,false);throw unavailable();}
      if(item.operationId==='old')assert.equal(result.replayed,true);
    });
    await h.retry();
    assert.equal((await marker('new-1').get()).exists,false);
    await h.retry(5000);
    assert.equal((await product.get()).data().favorito,true);
    assert.equal((await marker('new-1').get()).exists,false);
    h.restart();
    await h.retry(15000);
    const [saved,oldReceipt,newReceipt]=await db.getAll(product,marker('old'),marker('new-1'));
    assert.equal(saved.data().favorito,false);
    assert.equal(saved.data().estoqueAtual,7);
    assert.equal(saved.data().preco,25);
    assert.equal(oldReceipt.exists,true);
    assert.equal(newReceipt.exists,true);
    assert.equal((await root.collection('processedOperations').get()).size,2);
    assert.equal(h.stars.get('a'),false);
    assert.deepEqual(h.attempts,['old','old','old','new-1']);
    assert.equal(h.queued().length,0);

    await root.collection('members').doc(userId).set({status:'active',role:'seller',spaceAccess:'all'});
    h.respond(async (item,send)=>{
      try { await send(item); }
      catch (error) { error.syncDetail={stage:'server_operational_commit'}; throw error; }
    });
    h.tap('a');h.flushTap();
    assert.equal(h.stars.get('a'),true);
    await h.retry();
    assert.equal(h.queued()[0].favoriteRejectedWithoutEffect,true);
    assert.equal(h.stars.get('a'),false);
    assert.equal((await product.get()).data().favorito,false);
    assert.equal((await marker('new-2').get()).exists,false);
    assert.equal((await root.collection('processedOperations').get()).size,2);
  } finally { await deleteApp(app); }
});
