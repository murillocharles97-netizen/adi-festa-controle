'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const fs = require('node:fs');
const vm = require('node:vm');

const sync = fs.readFileSync('js/firebase/sync.js','utf8');
const isRejected = sync.slice(sync.indexOf('const isFavoriteProductWrite ='),sync.indexOf('const canAttempt ='));
const helper = sync.slice(sync.indexOf('function saveProductFavorites('),sync.indexOf('async function validateUser('));
const pendingIds = sync.slice(sync.indexOf('function pendingIds('),sync.indexOf('function markLocalCreditSaleConfirmed('));

function fixture(){
  const items=[{id:'a',favorito:false,atualizadoEm:'old',estoqueAtual:14,preco:25}];
  const saved=[],paints=[],notifications=[],queue=[];
  const context={
    currentUser:{uid:'qa'},now:()=> 'new',crypto:{randomUUID:()=> 'qa-op'},
    errorCode:error=>error.code,QUEUE_ENTITY_ALIASES:{produtos:'products'},
    processingPromise:null,manualSyncPromise:null,automaticSyncPromise:null,
    readQueue:()=>queue,readPaymentRecoveryReceipt:()=>null,isHistoricalProjectionBatch:()=>false,
    queueWrites:(writes,id,event,options)=>queue.push({queueId:id,payload:{writes},source:options.source,event}),
    DB:{
      __firebaseSyncWrapped:true,carregar:()=>({produtos:items}),
      stageProductFavorites(updates){
        for(const item of items)if(updates.has(item.id))Object.assign(item,updates.get(item.id));
        saved.push(updates.size);
      },
    },
    window:{
      WorkspaceRuntime:{capture(){}},TeamAccess:{captureSession:()=> 'scope',assertSession:scope=>assert.equal(scope,'scope')},
      Produtos:{renderMobileFavoriteChanges:changes=>paints.push(changes)},
      Utils:{toast:message=>notifications.push(message)},
    },
  };
  vm.createContext(context);vm.runInContext(isRejected+helper+pendingIds,context);
  return {items,saved,paints,notifications,queue,context};
}

test('mobile favorite uses one existing queue packet with only favorite and timestamp',()=>{
  const f=fixture();
  assert.equal(f.context.saveProductFavorites([{id:'a',value:true}]),true);
  assert.equal(f.queue.length,1);
  assert.equal(f.queue[0].source,'mobile-favorite');
  assert.equal(f.queue[0].event,'simple');
  assert.deepEqual(Object.keys(f.queue[0].payload.writes[0].data).sort(),['atualizadoEm','favorito']);
  assert.deepEqual(f.items[0],{id:'a',favorito:true,atualizadoEm:'new',estoqueAtual:14,preco:25});
  f.context.saveProductFavorites([{id:'a',value:true}]);
  assert.equal(f.queue.length,1);
});

test('definitive rejection restores only the matching projection and preserves the failed packet',()=>{
  const f=fixture();f.context.saveProductFavorites([{id:'a',value:true}]);
  // Queued snapshots are serialized by the existing queue before publishing the memory projection.
  const packet={...f.queue[0],status:'error',favoriteRejectedWithoutEffect:true,payload:{writes:[{...f.queue[0].payload.writes[0],before:{id:'a',favorito:false,atualizadoEm:'old'}}]}};
  const original=JSON.stringify(packet);
  f.context.restoreRejectedProductFavorites(packet,[packet]);
  assert.equal(f.items[0].favorito,false);
  assert.equal(f.items[0].preco,25);
  assert.equal(JSON.stringify(packet),original);
  assert.equal(f.paints.length,1);
  assert.equal(f.notifications.length,1);
});

test('offline errors and newer writes retain the latest favorite',()=>{
  const f=fixture();f.context.saveProductFavorites([{id:'a',value:true}]);
  const packet=f.queue[0];
  f.context.restoreRejectedProductFavorites(packet,[packet]);
  const rejected={...packet,status:'error',favoriteRejectedWithoutEffect:true};
  f.context.restoreRejectedProductFavorites(rejected,[rejected,{queueId:'newer',payload:{writes:[{entityType:'products',entityId:'a',data:{favorito:false}}]}}]);
  assert.equal(f.items[0].favorito,true);
  assert.equal(f.paints.length,0);
});

test('permission failure before enqueue changes neither queue nor local favorite',()=>{
  const f=fixture();
  f.context.window.TeamAccess.assertSession=()=>{throw Error('session changed');};
  assert.throws(()=>f.context.saveProductFavorites([{id:'a',value:true}]),/session changed/);
  assert.equal(f.queue.length,0);
  assert.equal(f.items[0].favorito,false);
});


test('consecutive definitive rejections restore the last state before either write',()=>{
  const f=fixture();
  const packet=(queueId,before,data)=>({queueId,source:queueId==='older'?'local':'mobile-favorite',status:'error',lastErrorCode:'permission-denied',favoriteRejectedWithoutEffect:true,
    payload:{writes:[{entityType:'products',entityId:'a',operation:'update',before,data}]}});
  const initial={favorito:false,atualizadoEm:'initial'};
  const first={favorito:true,atualizadoEm:'first'};
  const second={favorito:false,atualizadoEm:'second'};
  const older=packet('older',initial,first),newer=packet('newer',first,second);
  Object.assign(f.items[0],second);
  f.context.restoreRejectedProductFavorites(older,[older,newer]);
  assert.equal(f.items[0].atualizadoEm,'second');
  f.context.restoreRejectedProductFavorites(newer,[older,newer]);
  assert.equal(f.items[0].atualizadoEm,'initial');
  assert.equal(f.items[0].favorito,false);
});

test('an uncertain earlier commit holds only later favorites for the same product and scope',()=>{
  const {context}=fixture();
  const packet=(queueId,entityId,extra={})=>({
    queueId,source:'mobile-favorite',userId:'qa',businessId:'qa',workspaceGeneration:1,
    payload:{writes:[{entityType:'products',entityId,operation:'update',data:{favorito:true}}]},...extra,
  });
  const older=packet('older','a',{source:'local',status:'pending',lastErrorCode:'unavailable'});
  const newer=packet('newer','a');
  assert.equal(context.favoriteWriteHasPredecessor(newer,[older,newer]),true);
  const legacyLater={...newer,source:'local'};
  assert.equal(context.favoriteWriteHasPredecessor(legacyLater,[{...older,source:'mobile-favorite'},legacyLater]),true);
  assert.equal(context.favoriteWriteHasPredecessor(newer,[{...older,businessId:'other-tenant'},newer]),false);
  assert.equal(context.favoriteWriteHasPredecessor(newer,[{...older,userId:'other-member'},newer]),false);
  assert.equal(context.favoriteWriteHasPredecessor(newer,[newer]),false);
  assert.equal(context.favoriteWriteHasPredecessor(newer,[packet('other','b'),newer]),false);
  assert.equal(context.favoriteWriteHasPredecessor(newer,[packet('retired','a',{workspaceGeneration:0}),newer]),false);
  assert.equal(context.favoriteWriteHasPredecessor(newer,[{...older,status:'error',lastErrorCode:'permission-denied',favoriteRejectedWithoutEffect:true},newer]),false);
});

test('a definitively rejected favorite does not pin stock or other product metadata in cache',()=>{
  const f=fixture();
  f.context.saveProductFavorites([{id:'a',value:true}]);
  assert.equal(f.context.pendingIds('products').has('a'),true);
  Object.assign(f.queue[0],{status:'error',lastErrorCode:'permission-denied',favoriteRejectedWithoutEffect:true});
  assert.equal(f.context.pendingIds('products').has('a'),false);
  assert.equal(f.queue.length,1);
});
