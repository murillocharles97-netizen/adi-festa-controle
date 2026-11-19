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
    archivedFiadoRecord:()=>false,saleQueueRequiresReview:()=>false,
    favoriteWriteWasRejected:()=>false,recoveryResolutionKey:()=> 'resolution',
    updateQueueState(){},scheduleImmediate(){heads++;},dispatchEvent(){},CustomEvent:class {},
    matchMedia:()=>({matches:true}),financialVersionOf:client=>Number(client.financialVersion||0),
    localStorage:{getItem:key=>key==='queue'?queue:null,setItem(_key,value){queue=value;}},
  });
  c.DB.salvar=h.replace;c.DB.__firebaseSyncWrapped=true;
  vm.runInContext(section('const readQueue =','function monetaryRecoveryRequired('),c);
  vm.runInContext(section('function monetaryRecoveryRequired(','async function assertCancellationQueueClear('),c);
  vm.runInContext(section('function paymentQueueRequiresReview(','function assertFiadoReceiptQueueClear('),c);
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
    if(mode==='service')Object.assign(product,{itemKind:'service',controlaEstoque:false,semControleEstoque:true});
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
  assert.throws(()=>w.c.assertSaleQueueDependencies(w.draft),{code:'sale-stock-review-required'});
  assert.throws(w.register,{code:'sale-stock-review-required'});
  assert.equal(JSON.stringify(w.h.data()),before);
  assert.deepEqual(w.queue(),[w.stockIncident]);
  assert.equal(w.attempts(),0);
});

test('an earlier sale with an unresolved receipt blocks the same stock even with a fresh draft',()=>{
  const w=localWorkspace(),previous=localWorkspace(),before=JSON.stringify(w.h.data());
  previous.register();
  const [original]=previous.queue();
  const rejected={...original,status:'error',lastErrorCode:'sync-receipt-review-required'};
  w.raw([rejected]);
  assert.throws(()=>w.c.assertSaleQueueDependencies(w.draft),{code:'sale-dependency-review-required'});
  assert.throws(w.register,{code:'sale-dependency-review-required'});
  assert.equal(JSON.stringify(w.h.data()),before);
  assert.deepEqual(w.queue(),[rejected]);
});

test('a sale with a transient earlier receipt check can still queue offline in order',()=>{
  const w=localWorkspace(),previous=localWorkspace();
  previous.register();
  const [original]=previous.queue();
  const pending={...original,status:'pending',lastErrorCode:'unavailable',syncConfirmationPending:true};
  w.raw([pending]);
  w.register();
  assert.deepEqual(w.queue()[0],pending);
  assert.equal(w.queue()[1].status,'pending');
});

test('a held recurring sale blocks the same renewal without blocking another contract',()=>{
  const w=localWorkspace({mode:'custom'}),previous=localWorkspace({mode:'custom'});
  previous.register();
  const [original]=previous.queue();
  const retained={...original,status:'error',lastErrorCode:'sync-receipt-review-required',
    payload:{...original.payload,writes:original.payload.writes.filter(write=>write.entityType!=='stockMovements')}};
  retained.payload.writes.find(write=>write.entityType==='sales').data.itens[0].recurringActivation.subscriptionId='contract-a';
  w.raw([retained]);
  w.draft.itens[0].recurringActivation.subscriptionId='contract-a';
  assert.throws(()=>w.c.assertSaleQueueDependencies(w.draft),{code:'sale-dependency-review-required'});
  w.draft.itens[0].recurringActivation.subscriptionId='contract-b';
  assert.doesNotThrow(()=>w.c.assertSaleQueueDependencies(w.draft));
  assert.doesNotThrow(()=>w.c.assertSaleQueueDependencies({...w.draft,clienteId:'another-client'}));
  assert.doesNotThrow(()=>w.c.assertSaleQueueDependencies({...w.draft,spaceId:'another-space'}));
});

test('payment in review blocks credit for its customer and leaves unrelated payments and cash sales available',()=>{
  const w=localWorkspace(),{businessId,userId,workspaceGeneration}=w.stockIncident;
  const blocked={businessId,userId,workspaceGeneration,status:'error',lastErrorCode:'permission-denied',payload:{
    writes:[{entityType:'payments',operation:'create',entityId:'payment-one',data:{clienteId:w.draft.clienteId}}]
  }};
  const credit={...w.draft,status:'fiado',formaPagamento:'fiado'};
  w.raw([blocked]);
  assert.throws(()=>w.c.assertSaleQueueDependencies(credit),{code:'payment-review-required'});
  assert.doesNotThrow(()=>w.c.assertSaleQueueDependencies(w.draft));
  assert.doesNotThrow(()=>w.c.assertSaleQueueDependencies({...credit,clienteId:'another-client'}));
  w.raw([{...blocked,businessId:'another-business'}]);
  assert.doesNotThrow(()=>w.c.assertSaleQueueDependencies(credit));
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

test('a rejected quantity edit does not block a proven non-stock recurring item, but an unconfirmed mode change does',()=>{
  const w=localWorkspace({mode:'service'}),previous=structuredClone(w.stockIncident);
  previous.payload.writes[0].before=structuredClone(w.h.data().produtos[0]);
  w.raw([previous]);
  const uncertain=structuredClone(previous);
  uncertain.payload.writes[0].data.controlaEstoque=false;
  w.raw([uncertain]);
  assert.throws(()=>w.c.assertSaleQueueDependencies(w.draft),{code:'sale-stock-review-required'});
  w.raw([previous]);
  w.register();
  assert.equal(w.h.data().movimentacoesEstoque.length,0);
  assert.equal(w.h.data().customerSubscriptions.length,1);
  assert.deepEqual(w.queue()[0],previous);
  assert.equal(w.queue()[1].status,'pending');
});

test('leaving a verified review starts an empty checkout without removing the original sale or queue',async()=>{
  const w=localWorkspace({mode:'custom'}),sale=w.register(),c=w.c;
  const original=w.queue()[0],productHold=w.stockIncident;
  w.raw([productHold,original]);
  const initial=JSON.stringify(w.h.data()),feedback={append(_gap,button){this.button=button;}};
  Object.assign(c,{activeAttempt:{saleId:sale.id,operationId:sale.operationId},cart:structuredClone(w.draft.itens),
    document:{querySelector:()=>feedback,createElement:()=>({})},manual:true,discountKind:'valor',finishing:false,
    selectedCampaignIds:new Set(['qa']),draftDetails:{},draftKey:()=> 'qa-cart',draftPrincipal:()=> 'qa-owner',
    selectedSalesSpaceId:()=>sale.spaceId,saveDraft(){},clearDraft(){},applyDraftDetails(){},drawCart(){},
    setSubmissionState(){},toast(){}});
  vm.runInContext(checkoutSection('  function holdOriginalSale(', '  const totals ='),c);
  assert.equal(await c.resumeCheckoutSale(),true);
  assert.equal(feedback.button.textContent,'Iniciar outra venda');
  await feedback.button.onclick();
  assert.equal(c.activeAttempt,null);
  assert.equal(c.cart.length,0);
  assert.equal(JSON.stringify(w.h.data()),initial);
  assert.deepEqual(w.queue(),[productHold,original]);
  assert.doesNotThrow(()=>c.assertSaleQueueDependencies({...w.draft,itens:[{produtoId:'another-item'}]}));
  assert.throws(()=>c.assertSaleQueueDependencies(w.draft),{code:'sale-stock-review-required'});
});

test('checkout displays the stock conflict before confirmation or charging on a terminal',async()=>{
  const w=localWorkspace({blocked:true}),c=w.c,feedback=[],button={onclick:null};
  let confirmations=0,charges=0;
  const fields={'#finish-sale':button,'#sale-client':{value:w.draft.clienteId},
    '#sale-payment-method':{value:'cartao_presencial'},'#sale-status':{value:'pago'}};
  Object.assign(c,{document:{querySelector:id=>fields[id]},cart:w.draft.itens,cartCount:()=>1,activeConflict:null,finishing:false,
    traceSale(){},resumeCheckoutSale:async()=>false,restoredDraftKey:'',availableCustomers:()=>c.DB.carregar().clientes,
    setSubmissionState:(state,message)=>feedback.push({state,message}),toast(){},
    confirm:()=>{confirmations++;return true;},TerminalPayments:{getCurrent:()=>null,beginCheckout:()=>{charges++;}}});
  c.SyncFirebase.assertSaleQueueDependencies=c.assertSaleQueueDependencies;
  const click=checkoutSection('    document.querySelector("#finish-sale").onclick','    document.querySelector("#desktop-clear-cart")');
  vm.runInContext(click,c);
  await button.onclick();
  assert.match(feedback.at(-1).message,/pendência de estoque/);
  assert.equal(feedback.at(-1).state,'error');
  assert.equal(confirmations,0);
  assert.equal(charges,0);
  assert.equal(w.h.data().vendas.length,0);
  assert.deepEqual(w.queue(),[w.stockIncident]);
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
  assert.equal(read().reason,'product_stock_dependency');
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
  assert.match(states.at(-1).message,/aguarda revisão do estoque/);
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
  assert.ok(click.indexOf('assertSaleQueueDependencies')<click.indexOf('window.TerminalPayments.beginCheckout'));
  assert.ok(click.indexOf('assertSaleQueueDependencies')<click.indexOf('Vendas.estoqueInsuficiente(cart)'));
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
