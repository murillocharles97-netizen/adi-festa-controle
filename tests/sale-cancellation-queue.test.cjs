'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/firebase/sync.js','utf8');
const section=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
const quote={saleId:'target-sale',paymentMethod:'pix',isCredit:false,stockReturns:[{productId:'target-product'}]};
const write=(entityType,entityId,operation,data={})=>({entityType,entityId,operation,data});
const packet=(writes,extra={})=>({
  businessId:'test-business',userId:'owner',operationId:'rejected-product',status:'error',
  lastErrorStage:'server_operational_commit',lastErrorCode:'permission-denied',
  lastErrorMessage:'Estoque sem movimento autorizado.',payload:{writes},...extra,
});
const product=(id='other-product')=>packet([write('products',id,'update',{estoqueAtual:3})]);
const sale=()=>packet([
  write('sales','other-sale','create',{formaPagamento:'pix',status:'pago',itens:[{produtoId:'another-product'}]}),
  write('products','another-product','update'),
  write('stockMovements','other-movement','create',{produtoId:'another-product',vendaId:'other-sale'}),
],{operationId:'rejected-sale',lastErrorCode:'invalid-argument',lastErrorMessage:'Total não corresponde aos itens.'});
function runtime(items,{serverRead}={}){
  const store=new Map([['queue',JSON.stringify(items)]]),reads=[];
  const context={role:'owner',businessId:'test-business',business:{ownerId:'owner'}};
  const c={currentUser:{uid:'owner'},auth:{currentUser:{uid:'owner'}},DB:{__firebaseSyncWrapped:true},db:{},
    activeBusinessId:()=>context.businessId,queueKey:()=>'queue',LEGACY_QUEUE_KEY:'legacy',
    BusinessContext:{get:()=>context},localStorage:{peekItem:k=>store.get(k),getItem:k=>store.get(k),
      setItem:()=>assert.fail('unexpected write')},
    readPaymentRecoveryReceipt:()=>null,readRecoveryResolution:()=>null,readQueueArchive:()=>null,
    recoveryResolutionKey:()=>'',queueQuarantineReason:()=>null,queueManualReviewReason:()=>null,
    paymentQueueRequiresReview:()=>false,favoriteWriteWasRejected:()=>false,
    doc:(_, ...parts)=>parts.join('/'),
    getDocFromServer:async p=>{reads.push(p);return serverRead?serverRead(p,store):{exists:()=>false};}};
  c.window=c;
  vm.createContext(c);
  vm.runInContext(section('const readQueueStrict =','function queueStateFields('),c);
  return {c,context,reads,store,check:q=>c.assertCancellationQueueClear(q??quote)};
}
test('known independent rejects require server evidence, stay byte-identical and are ineligible for retry',async()=>{
  const items=[product(),sale(),...['second-product','third-product'].map(id=>packet([write('products',id,'update')],{operationId:id}))];
  const h=runtime(items),before=h.store.get('queue');
  await h.check();
  assert.equal(h.reads.length,6);
  assert.equal(h.store.get('queue'),before);
  for(const item of items){
    const status=h.c.classifyQueueOperation(item);
    assert.equal(status.canRetry,false);
    assert.equal(status.replayBlocked,true);
    assert.equal(status.activeError,true);
  }
});
test('pending, in-flight, preparing, wrong scope, dependent or unknown writes fail before server reads',async()=>{
  const mixed=sale();
  mixed.payload.writes.push(write('payments','other-payment','create'));
  for(const item of [
    ...['pending','syncing','local_preparing'].map(status=>({...product(),status})),
    {...product(),businessId:'other-business'},
    {...product(),userId:'other-user'},
    {...product(),workspaceGeneration:2},
    {...product(),lastErrorStage:'queue_preflight'},
    {...product(),lastErrorCode:'unavailable'},
    product('target-product'),
    {...sale(),payload:{writes:[write('sales','target-sale','create',{formaPagamento:'pix',status:'pago',itens:[{produtoId:'other-product'}]})]}},
    mixed,
    null,
  ]){
    const h=runtime([item]);
    await assert.rejects(h.check());
    assert.equal(h.reads.length,0);
  }
});
test('an existing server effect, unavailable proof or new local write invalidates the exception',async()=>{
  for(const serverRead of [
    ()=>({exists:()=>true}),
    ()=>{throw Error('Network unavailable');},
    (_,store)=>{store.set('queue',JSON.stringify([{...product(),status:'pending'}]));return{exists:()=>false};},
  ]){
    const h=runtime([product()],{serverRead});
    await assert.rejects(h.check(),/sem comprovação/);
  }
});
test('corrupt storage, legacy data, manager and non-Pix/dinheiro sale retain the block',async()=>{
  const corrupt=runtime([]);corrupt.store.set('queue','invalid');
  await assert.rejects(corrupt.check(),/corrompida/);
  const legacy=runtime([]);legacy.store.delete('queue');legacy.store.set('adiFesta:test-business:syncQueue','[{}]');
  await assert.rejects(legacy.check(),/sem comprovação/);
  const manager=runtime([product()]);manager.context.role='manager';
  await assert.rejects(manager.check(),/sem comprovação/);
  const fiado=runtime([product()]);
  await assert.rejects(fiado.check({...quote,isCredit:true,paymentMethod:'fiado'}),/sem comprovação/);
});
