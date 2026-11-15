'use strict';
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {randomUUID}=require('node:crypto');
const test=require('node:test');
const {harness,section}=require('./helpers/fiado-cancellation-harness.cjs');
const checkout=fs.readFileSync('js/checkout.js','utf8');
const checkoutSection=(start,end)=>checkout.slice(checkout.indexOf(start),checkout.indexOf(end,checkout.indexOf(start)));

function localWorkspace({blocked=false,mode='normal'}={}){
  const h=harness(),c=h.c,businessId=h.data().produtos[0].businessId;
  const spaceId=h.data().produtos[0].defaultSpaceId,userId=c.currentUser.uid;
  const stockIncident={queueId:'prior-write',operationId:'prior-write',businessId,userId,workspaceGeneration:0,
    status:'error',lastErrorStage:'server_operational_commit',lastErrorCode:'permission-denied',
    lastErrorMessage:'Estoque sem movimento autorizado.',payload:{eventKind:'simple',writes:[
      {entityType:'products',entityId:'qa-product',operation:'update',data:{estoqueAtual:1}}
    ]}};
  let queue=JSON.stringify(blocked?[stockIncident]:[]),heads=0;
  const archives=new Set();
  Object.assign(c,{
    currentUser:{uid:userId},state:{},MAX_WRITES:350,PAYLOAD_VERSION:4,readOnlyMode:false,
    queueKey:()=> 'queue',queueSubtype:()=> 'sale',canWriteSharedSettings:()=>false,
    queueQuarantineReason:()=>'',readQueueReview:()=>null,readRecoveryResolution:()=>null,
    readQueueArchive:item=>archives.has(item.operationId),readPaymentRecoveryReceipt:()=>null,
    paymentQueueRequiresReview:()=>false,paymentQueueDependsOnReview:()=>false,saleQueueRequiresReview:()=>false,
    favoriteWriteWasRejected:()=>false,recoveryResolutionKey:()=> 'resolution',
    updateQueueState(){},scheduleImmediate(){heads++;},dispatchEvent(){},CustomEvent:class {},
    matchMedia:()=>({matches:true}),financialVersionOf:client=>Number(client.financialVersion||0),
    localStorage:{getItem:key=>key==='queue'?queue:null,setItem(_key,value){queue=value;}},
  });
  c.DB.salvar=h.replace;c.DB.__firebaseSyncWrapped=true;
  vm.runInContext(section('const readQueue =','function monetaryRecoveryRequired('),c);
  vm.runInContext(section('function monetaryRecoveryRequired(','async function assertCancellationQueueClear('),c);
  vm.runInContext(section('function queueManualReviewReason(','function preserveQueueQuarantine('),c);
  vm.runInContext(section('function queueWrites(','function changedFields('),c);
  vm.runInContext(section('function assertSaleTracked(','async function prepareCustomerForSale('),c);
  c.SyncFirebase=vm.runInContext('({isReady:()=>true,createSaleOperation,assertSaleTracked})',c);
  if(c.inspectCheckoutSaleAttempt)c.SyncFirebase.inspectCheckoutSaleAttempt=c.inspectCheckoutSaleAttempt;
  const data=h.data(),product=data.produtos[0];
  Object.assign(product,{estoqueAtual:1,estoque:1,totalStock:1,preco:25.90});
  if(mode!=='normal'){
    vm.runInContext(fs.readFileSync('js/customer-subscriptions.js','utf8'),c);
    for(const key of ['customerSubscriptions','customerSubscriptionEvents'])c.SOURCES[key]={key};
    Object.assign(product,{productType:'recurring',itemKind:'product',durationValue:1,durationUnit:'months'});
  }
  const id=randomUUID(),operationId=randomUUID();
  const custom=mode==='custom'?{expiresAt:new Date(Date.now()+40*86400000).toISOString(),timeSet:true}:null;
  const draft={id,operationId,businessId,spaceId,clienteId:'qa-client',formaPagamento:'pix',status:'pago',itens:[
    {produtoId:product.id,quantidade:1,precoOriginal:25.90,precoFinalUnitario:25.90,
      ...(mode!=='normal'?{productType:'recurring',recurringActivation:{durationValue:1,durationUnit:'months',
       renewalPolicyVersion:c.CustomerSubscriptions.renewalPolicyVersion,...(custom?{customExpiry:custom}:{})}}:{})}
  ]};
  return {c,h,draft,stockIncident,custom,archives,queue:()=>JSON.parse(queue),raw:value=>{queue=JSON.stringify(value);},
    attempts:()=>heads,register:()=>c.Vendas.registrar(structuredClone(draft))};
}

test('a rejected stock update on the same product is found before any local sale, cash, renewal or stock change',()=>{
  const w=localWorkspace({blocked:true,mode:'custom'}),before=JSON.stringify(w.h.data());
  assert.throws(w.register,{code:'sale-stock-review-required'});
  assert.equal(JSON.stringify(w.h.data()),before);
  assert.deepEqual(w.queue(),[w.stockIncident]);
  assert.equal(w.attempts(),0);
});

test('a rejected update on another product does not block the sale',()=>{
  const w=localWorkspace();
  const unrelated=structuredClone(w.stockIncident);
  unrelated.payload.writes[0].entityId='other-product';
  w.raw([unrelated]);
  w.register();
  assert.deepEqual(w.queue()[0],unrelated);
  assert.equal(w.queue()[1].status,'pending');
});

for(const mode of ['normal','automatic','custom'])test(`the last unit is sold once and the original is reused for ${mode}`,()=>{
  const w=localWorkspace({mode}),sale=w.register();
  assert.equal(w.h.data().produtos[0].estoqueAtual,0);
  assert.equal(w.h.data().movimentacoesEstoque.length,1);
  assert.equal(w.h.data().movimentacoes.length,1);
  const initial=w.queue();
  const previous=w.c.inspectCheckoutSaleAttempt({saleId:sale.id,operationId:sale.operationId,spaceId:sale.spaceId});
  assert.equal(previous.status,'pending');
  assert.equal(previous.sale.operationId,sale.operationId);
  assert.equal(w.register().id,sale.id);
  assert.equal(w.h.data().vendas.length,1);
  assert.equal(w.h.data().movimentacoesEstoque.length,1);
  assert.deepEqual(w.queue(),initial);
  if(mode!=='normal'){
    const [subscription]=w.h.data().customerSubscriptions;
    assert.equal(subscription.lastSaleId,sale.id);
    const events=w.h.data().customerSubscriptionEvents;
    assert.equal(events.filter(e=>e.transition==='activation').length,1);
    assert.equal(events.filter(e=>e.transition==='expiry_customized').length,mode==='custom'?1:0);
    if(w.custom)assert.equal(subscription.expiresAt,w.custom.expiresAt);
  }
});

test('an already recorded original held by an older stock incident stays in review with the same payload',()=>{
  const w=localWorkspace({mode:'custom'}),sale=w.register(),[packet]=w.queue();
  const prepared={...packet,status:'local_preparing'};
  w.raw([w.stockIncident,prepared]);
  const read=()=>w.c.inspectCheckoutSaleAttempt({saleId:sale.id,spaceId:sale.spaceId});
  assert.equal(read().status,'review');
  assert.deepEqual(w.queue(),[w.stockIncident,prepared]);
  assert.equal(w.h.data().produtos[0].estoqueAtual,0);
  assert.equal(w.h.data().vendas.length,1);
  assert.equal(w.h.data().customerSubscriptions.length,1);
  w.archives.add(w.stockIncident.operationId);
  assert.equal(read().status,'pending');
  assert.deepEqual(w.queue()[0],w.stockIncident);
  assert.deepEqual(w.queue()[1],{...prepared,status:'pending'});
  assert.equal(w.h.data().movimentacoesEstoque.length,1);
});

test('checkout finds the existing sale before checking stock and retains its IDs through reopening',async()=>{
  const w=localWorkspace({mode:'custom'}),sale=w.register(),[packet]=w.queue(),saved=new Map(),states=[],receipts=[];
  const c=w.c;
  Object.assign(c,{activeAttempt:{saleId:sale.id,operationId:sale.operationId},cart:structuredClone(w.draft.itens),
    restoredDraftKey:'',restoredDraftPrincipal:'',draftDetails:{},manual:false,discountKind:null,finishing:false,
    activeConflict:null,selectedCampaignIds:new Set(),DRAFT_PREFIX:'draft',
    selectedSalesSpaceId:()=>sale.spaceId,products:()=>({getById:c.Produtos.obter}),productAvailableHere:()=>true,
    document:{querySelector:()=>null},sessionStorage:{getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value),removeItem:key=>saved.delete(key)},
    setSubmissionState:(kind,message)=>states.push({kind,message}),refreshClients(){},closeCartSurface(){},traceSale(){},
    clients:()=>({getById:()=>null}),Recibos:{mostrar:row=>receipts.push(row.id)},
    FirebaseSession:{user:{uid:c.currentUser.uid}},
  });
  w.raw([w.stockIncident,{...packet,status:'local_preparing'}]);
  vm.runInContext(checkoutSection('  function draftKey()', '  function applyDraftDetails()'),c);
  vm.runInContext(checkoutSection('  function hasSavedSaleAttempt()', '  function setSubmissionState('),c);
  vm.runInContext(checkoutSection('  function holdOriginalSale(', '  const totals ='),c);
  assert.ok(await c.resumeCheckoutSale());
  assert.equal(states.at(-1).kind,'review');
  assert.deepEqual(receipts,[]);
  c.cart=[];c.invalidateAttempt();
  assert.equal(c.activeAttempt.saleId,sale.id);
  c.activeAttempt=null;c.restoredDraftKey='';
  c.restoreDraft();
  assert.equal(c.activeAttempt.saleId,sale.id);
  assert.equal(c.activeAttempt.operationId,sale.operationId);
  w.archives.add(w.stockIncident.operationId);
  assert.ok(await c.resumeCheckoutSale());
  assert.deepEqual(receipts,[sale.id]);
  assert.match(states.at(-1).message,/aguardando sincronização/);
  assert.equal(w.h.data().produtos[0].estoqueAtual,0);
  assert.equal(w.h.data().vendas.length,1);
  assert.equal(w.h.data().movimentacoesEstoque.length,1);
  assert.deepEqual(w.queue()[1].payload,packet.payload);
  const click=checkoutSection('    document.querySelector("#finish-sale").onclick', '    document.querySelector("#desktop-clear-cart")');
  assert.ok(click.indexOf('await resumeCheckoutSale()')<click.indexOf('Vendas.estoqueInsuficiente(cart)'));
});

test('checkout refuses attempts with incomplete, mismatched or foreign identity',()=>{
  const w=localWorkspace(),sale=w.register(),base={saleId:sale.id,operationId:sale.operationId,spaceId:sale.spaceId};
  assert.throws(()=>w.c.inspectCheckoutSaleAttempt({...base,operationId:randomUUID()}),{code:'sale-original-review-required'});
  assert.throws(()=>w.c.inspectCheckoutSaleAttempt({...base,spaceId:'space-other'}),{code:'sale-original-review-required'});
  const originalJson=JSON.stringify(w.queue()),state={...w.h.data(),vendas:[]};
  w.h.replace(state);
  assert.throws(()=>w.c.inspectCheckoutSaleAttempt(base),{code:'sale-original-review-required'});
  assert.equal(JSON.stringify(w.queue()),originalJson);
});
