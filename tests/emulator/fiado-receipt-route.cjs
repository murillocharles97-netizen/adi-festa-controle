'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID}=require('node:crypto');
const fs=require('node:fs');
const {createRequire}=require('node:module');
const path=require('node:path');
const {harness}=require('../helpers/owner-receipt-v219.cjs');
const {fixture}=require('../helpers/fiado-history-proof.cjs');
const Plan=require('../../functions/src/shared/installment-plan');
const readerSource=path.resolve(process.env.VECONI_QA_RECEIPT_READER||'functions');
const writerSource=path.resolve(process.env.VECONI_QA_RECEIPT_WRITER||'functions');
const readerService=require(path.join(readerSource,'src/services/operational-commit-service'));
const writerService=require(path.join(writerSource,'src/services/operational-commit-service'));
const {operationalCallable}=require(path.join(writerSource,'src/shared/operational-callable'));
const {financialIncomeService}=require('../../functions/src/services/financial-income-service');

const project='demo-veconi-owner-v219';
assert.equal(process.env.GCLOUD_PROJECT,project);
for(const name of ['FIRESTORE_EMULATOR_HOST','FIREBASE_AUTH_EMULATOR_HOST'])assert.match(process.env[name]||'',/^127\.0\.0\.1:\d+$/);
const dep=createRequire(path.resolve('functions/package.json'));
const {initializeApp,deleteApp}=dep('firebase-admin/app');
const {getFirestore}=dep('firebase-admin/firestore');
const app=initializeApp({projectId:project},'qa-fiad-route-'+randomUUID()),db=getFirestore(app);
const service=readerService.operationalCommitService(db),writer=writerService.operationalCommitService(db);
const callCommit=operationalCallable(writer.commit,{requireProtocol:true});
const cash=financialIncomeService(db);
test.after(()=>deleteApp(app));
const clientId='qa-client',day=Plan.today(),at=day+'T15:00:00.000Z';
const grants={'customers.view':true,'customers.receiveDebt':true};
const cashSettings={enabled:true,activatedAt:'2020-01-01T00:00:00.000Z',autoIncome:{customerPayments:true}};
const normalize=v=>v?.toDate?v.toDate().toISOString():Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;

async function setup({origin='legacy',role='owner',permissions=grants,version=2,history=false,link=false}={}){
  const businessId='qa-'+randomUUID(),uid='qa-'+randomUUID(),spaceId='qa-space-'+randomUUID(),otherId='qa-other-'+randomUUID();
  const auth={uid},root=db.doc('businesses/'+businessId),clientRef=root.collection('clients').doc(clientId);
  const common={businessId,workspaceGeneration:0},linked=link?{spaceId,customerSpaceIds:[spaceId]}:{};
  const client={...common,id:clientId,nome:'Pessoa sintética',ativo:true,saldo:-190,financialVersion:3,...linked};
  const sales=[];
  if(origin==='legacy')Object.assign(client,{legacyBalance:190,legacyBalanceRemaining:190});
  if(['one','mixed','unknown'].includes(origin)){
    sales.push({...common,id:'sale-a',clienteId:clientId,formaPagamento:'fiado',status:'fiado',valorFinal:120,
      ...(origin!=='unknown'?{spaceId}:{}),data:'2026-01-01T12:00:00.000Z'},
      {...common,id:'sale-b',clienteId:clientId,formaPagamento:'fiado',status:'fiado',valorFinal:70,
      ...(origin!=='unknown'?{spaceId:origin==='mixed'?otherId:spaceId}:{}),data:'2026-01-02T12:00:00.000Z'});
    Object.assign(client,{legacyBalance:0,legacyBalanceRemaining:0});
  }
  const batch=db.batch();
  if(history){
    const historyInput=fixture([190]);
    Object.assign(client,{fiadoHistoryVersion:1,hasInstallmentFiado:true,legacyBalanceRemaining:0});
    const plan=Plan.create({total:190,count:2,firstDueDate:day,saleDate:day});
    for(const [collection,rows] of Object.entries(historyInput.collections)){
      for(const row of rows){
        const mapped={...row,...common,spaceId};
        if(collection==='sales'){
          Object.assign(mapped,{status:'fiado',data:at,financialAppliedAt:at,installmentPlan:plan});
          sales.push(mapped);
        }else if(collection==='balanceEvents')mapped.appliedAt=at;
        batch.set(root.collection(collection).doc(row.id),mapped);
      }
    }
  }
  batch.set(root,{id:businessId,active:true,workspaceGeneration:0,ownerId:role==='owner'?uid:'different-owner',
    subscription:{planId:'internal',status:'active'}});
  batch.set(db.doc('users/'+uid),{uid,businessId,active:true,role});
  batch.set(root.collection('members').doc(uid),{uid,role,status:'active',permissionsVersion:version,permissions,
    spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[spaceId]});
  batch.set(clientRef,client);
  batch.set(root.collection('clients').doc('other-client'),{...client,id:'other-client',saldo:-20});
  batch.set(root.collection('products').doc('qa-product'),{...common,id:'qa-product',estoqueAtual:7});
  for(const sale of sales)batch.set(root.collection('sales').doc(sale.id),sale);
  for(const id of [spaceId,otherId])batch.set(db.doc('financialSpaces/'+id),{id,...common,linkedBusinessId:businessId,
    active:true,type:'business',ownerUid:uid,capabilities:{sales:true,finance:true,inventory:true},automation:cashSettings});
  await batch.commit();
  const args={businessId,workspaceGeneration:0,clientId,spaceId};
  const route=(extra={},identity=auth)=>service.receipt({auth:identity,data:{kind:'fiado_receipt_route',...args,...extra}});
  const callable=async(name,data)=>({data:name==='commitOperationalSync'?await callCommit({auth,data}):await service.receipt({auth,data})});
  async function ui(){
    const h=harness({businessId,spaceId,uid,role,grants:permissions}),w=h.w,rows=h.rows();
    w.Router={atual:()=> 'clientes'};
    w.Utils.escapar=String;
    const messages=[];w.Utils.toast=message=>messages.push(message);
    w.BusinessContext.canAccessSpace=id=>id===spaceId||role==='owner'&&id===otherId;
    for(const file of ['js/spaces.js','js/clientes.js'])w.eval(fs.readFileSync(file,'utf8'));
    w.SpaceContext.setSpaces([spaceId,otherId].filter(w.BusinessContext.canAccessSpace).map(id=>({id,businessId,type:'business',name:id,active:true})));
    w.SpaceContext.selectActive(spaceId);
    rows.clientes=[normalize((await clientRef.get()).data())];
    for(const [col,key] of [['sales','vendas'],['payments','pagamentos'],['paymentAllocations','alocacoesPagamento']]){
      rows[key]=(await root.collection(col).get()).docs.map(s=>normalize(s.data()));
    }
    w.FirebaseCallable=callable;
    const capture=w.SyncFirebase.createPaymentOperation;
    let intent;
    w.SyncFirebase.createPaymentOperation=(before,after,payment,value)=>{
      intent=JSON.parse(JSON.stringify(value));
      return capture(before,after,payment);
    };
    w.SyncFirebase.assertFiadoReceiptQueueClear=()=>{};
    w.SyncFirebase.assertFiadoReceiptWriter=(businessId,workspaceGeneration)=>callable('commitOperationalSync',{
      kind:'sync_protocol',businessId,workspaceGeneration,syncProtocolVersion:1,clientRelease:230
    }).then(({data})=>assert.equal(data.fiadoReceiptRouteVersion,1));
    const modal=()=>w.document.querySelector('#modal form');
    const open=()=>w.Fiados.openCardReceive(clientId);
    async function submit(amount,id){
      const form=modal();assert.ok(form);
      if(id!==undefined)form.elements.paymentSpaceId.value=id;
      form.elements.valor.value=String(amount);
      await form.onsubmit({preventDefault(){}});
      return form;
    }
    function request(){
      const writes=h.writes(),p=writes.find(entry=>entry.entityType==='payments').data;
      return {auth,data:{businessId,clientRelease:230,syncProtocolVersion:1,item:{operationId:p.operationId,businessId,
        userId:uid,workspaceGeneration:0,status:'pending',payloadVersion:4,payload:{eventKind:'payment',fiadoHistoryVersion:1,
        fiadoReceiptRoute:intent,writes}}}};
    }
    return {h,w,messages,modal,open,submit,request};
  }
  return {businessId,spaceId,otherId,root,clientRef,route,ui,auth};
}

test('traditional owner routes directly with explicit cash; lost response and partial/full keep one cash entry each',async()=>{
  const qa=await setup(),view=await qa.ui();
  try{
    const initial=await qa.route();
    assert.equal(initial.mode,'original');
    assert.equal(initial.dueCents,19000);
    assert.match(view.w.Clientes.unassignedMarkup(),/data-receive-unassigned="qa-client">Receber/);
    assert.equal((await qa.root.collection('payments').get()).size,0);
    assert.equal((await qa.root.collection('processedOperations').get()).size,0);
    view.w.document.querySelector('#app').innerHTML=view.w.Clientes.unassignedMarkup();
    view.w.eval(fs.readFileSync('js/clientes-page.js','utf8'));
    view.w.ReceiptMessageUI={open(){}};
    const openCard=view.w.Fiados.openCardReceive;
    let routed;
    view.w.Fiados.openCardReceive=(...args)=>(routed=openCard(...args));
    view.w.document.querySelector('[data-receive-unassigned]').click();
    assert.ok(routed);
    await routed;
    assert.match(view.w.document.querySelector('#modal h2').textContent,/Conta original/);
    assert.equal(view.modal().elements.paymentSpaceId.value,'');
    const blank=await view.submit(70);
    assert.match(blank.querySelector('[role=alert]').textContent,/explicitamente/);
    assert.equal(view.h.commits(),0);
    const submitted=await view.submit(70,qa.otherId);
    assert.equal(view.h.commits(),1,submitted.querySelector('[role=alert]').textContent);
    const request=view.request(),id=request.data.item.operationId;
    await assert.rejects(async()=>{
      assert.equal((await callCommit(request)).replayed,false);
      throw Object.assign(Error('QA lost response'),{code:'unavailable'});
    },{code:'unavailable'});
    assert.equal((await callCommit(request)).replayed,true);
    const payment=(await qa.root.collection('payments').doc(id).get()).data();
    assert.equal(payment.spaceId,qa.otherId);
    assert.equal(payment.valor,70);
    assert.equal((await qa.clientRef.get()).data().saldo,-120);
    assert.equal((await qa.clientRef.get()).data().financialVersion,4);
    assert.equal((await cash.projectPayment(qa.businessId,id,payment)).created,true);
    assert.equal((await cash.projectPayment(qa.businessId,id,payment)).created,false);
    const entries=db.collection('financialSpaces').doc(qa.otherId).collection('entries');
    assert.equal((await entries.doc('credit_payment_'+id).get()).data().amountCents,7000);
    assert.equal((await db.collection('financialSpaces').doc(qa.spaceId).collection('entries').get()).size,0);
    const next=await qa.ui();
    try{
      assert.equal((await qa.route()).mode,'original');
      await next.open();await next.submit(120,qa.otherId);
      const full=next.request(),fullId=full.data.item.operationId;
      await callCommit(full);
      assert.equal((await callCommit(full)).replayed,true);
      assert.equal((await qa.clientRef.get()).data().saldo,0);
      assert.equal((await cash.projectPayment(qa.businessId,fullId,(await qa.root.collection('payments').doc(fullId).get()).data())).created,true);
      assert.equal((await entries.get()).size,2);
      assert.equal((await qa.root.collection('payments').get()).size,2);
      assert.equal((await qa.root.collection('stockMovements').get()).size,0);
      assert.equal((await qa.root.collection('products').doc('qa-product').get()).data().estoqueAtual,7);
      assert.equal((await qa.root.collection('clients').doc('other-client').get()).data().saldo,-20);
    }finally{next.h.close();}
  }finally{view.h.close();}
});

test('confirmed debt is scoped; an authorized employee sees only the permitted route, and a V2 calendar preserves future installments',async()=>{
  const employee=await setup({origin:'one',role:'seller'});
  const result=await employee.route();
  assert.equal(result.mode,'space');assert.equal(result.dueCents,19000);
  assert.equal(result.origins,undefined);assert.equal(result.entries,undefined);
  await assert.rejects(employee.route({spaceId:employee.otherId}),{code:'permission-denied'});
  await assert.rejects(employee.route({businessId:'another-company'}),{code:'permission-denied'});
  await assert.rejects(employee.route({},null),{code:'unauthenticated'});
  const forbidden=await setup({origin:'one',role:'seller',permissions:{'customers.view':true}});
  assert.equal((await forbidden.route()).reason,'access_unavailable');
  const noHistory=await setup({origin:'one',role:'seller',version:3});
  assert.equal((await noHistory.route()).reason,'access_unavailable');
  const legacy=await setup({role:'seller',link:true});
  assert.equal((await legacy.route()).reason,'origin_unverified');
  const scheduled=await setup({origin:'scheduled',history:true}),ui=await scheduled.ui();
  try{
    const route=await scheduled.route();
    assert.equal(route.mode,'space');assert.equal(route.dueCents,9500);assert.equal(route.futureCents,9500);
    await ui.open();
    assert.match(ui.w.document.querySelector('#modal h2').textContent,/Receber pagamento/);
    assert.equal(ui.modal().elements.paymentSpaceId.value,scheduled.spaceId);
    assert.match(ui.modal().querySelector('[data-receive-future]').textContent,/95,00/);
    await ui.submit(70);
    await callCommit(ui.request());
    const current=await scheduled.route();
    assert.equal(current.dueCents,2500);assert.equal(current.futureCents,9500);
  }finally{ui.h.close();}
});

test('history aliases, pending Felipe-like receipt, conflicting projection and mixed origins stay blocked',async()=>{
  const qa=await setup({origin:'unknown',link:true});
  assert.equal((await qa.route()).mode,'original');
  const sale=qa.root.collection('sales').doc('sale-a'),pending=qa.root.collection('payments').doc('older-payment');
  await sale.update({operationId:'sale-a',financialAppliedAt:at});
  await qa.root.collection('balanceEvents').doc('credit_sale:sale-a').set({
    customerId:clientId,sourceCollection:'sales',sourceDocumentId:'sale-a',type:'credit_sale',
    status:'applied',appliedAt:at,operationId:'other-op',balanceDelta:-120
  });
  assert.equal((await qa.route()).reason,'history_review');
  await pending.set({clienteId:clientId,valor:30,status:'pending_sync',applicationStatus:'pending'});
  for(const [id,amount] of [['sale-a',22],['sale-b',8]])await qa.root.collection('paymentAllocations').doc('older-payment__'+id)
    .set({clientId,paymentId:'older-payment',saleId:id,amount});
  const ui=await qa.ui();
  try{
    assert.equal((await qa.route()).reason,'pending_payment');
    await ui.open();
    assert.equal(ui.modal(),null);
    assert.match(ui.messages.at(-1),/pendente/);
    assert.equal((await qa.clientRef.get()).data().saldo,-190);
    assert.equal((await qa.root.collection('payments').get()).size,1);
  }finally{ui.h.close();}
  const mixed=await setup({origin:'mixed'});
  assert.equal((await mixed.route()).reason,'mixed_origins');
  const wrong=await setup({origin:'one'});
  assert.equal((await wrong.route({spaceId:wrong.otherId})).reason,'other_space');
});

test('space change, local queue and network failures block before a write; stale/forged commits fail atomically',async()=>{
  const qa=await setup(),ui=await qa.ui();
  try{
    const call=ui.w.FirebaseCallable;
    ui.w.FirebaseCallable=async()=>{throw Object.assign(Error('wire unavailable'),{code:'functions/unavailable'});};
    await ui.open();
    assert.match(ui.messages.at(-1),/conexão/);
    assert.equal(ui.modal(),null);
    ui.w.FirebaseCallable=call;
    await ui.open();
    ui.w.SpaceContext.selectActive(qa.otherId);
    let form=await ui.submit(70,qa.spaceId);
    assert.match(form.querySelector('[role=alert]').textContent,/espaço ou a tela mudou/);
    assert.equal(ui.h.commits(),0);
    ui.w.SpaceContext.selectActive(qa.spaceId);
    await ui.open();
    ui.w.SyncFirebase.assertFiadoReceiptQueueClear=()=>{throw Error('Fila local pendente');};
    form=await ui.submit(70,qa.spaceId);
    assert.match(form.querySelector('[role=alert]').textContent,/Fila local/);
    assert.equal(ui.h.commits(),0);
    ui.w.SyncFirebase.assertFiadoReceiptQueueClear=()=>{};
    await ui.submit(70,qa.spaceId);
    const request=ui.request();
    const forged=structuredClone(request);forged.data.item.payload.fiadoReceiptRoute.mode='space';
    await assert.rejects(callCommit(forged),{code:'failed-precondition'});
    await qa.clientRef.update({financialVersion:4});
    await assert.rejects(callCommit(request),{code:'failed-precondition'});
    assert.equal((await qa.root.collection('payments').get()).size,0);
    assert.equal((await qa.root.collection('processedOperations').get()).size,0);
    assert.equal((await qa.clientRef.get()).data().saldo,-190);
  }finally{ui.h.close();}
});

test('two routed confirmations against the same verified balance settle tracked sales at most once',async()=>{
  const qa=await setup({origin:'one'}),first=await qa.ui(),second=await qa.ui();
  try{
    await first.open();await second.open();
    assert.equal(first.modal().elements.paymentSpaceId.value,qa.spaceId);
    await first.submit(70);await second.submit(70);
    assert.equal(first.h.commits(),1);assert.equal(second.h.commits(),1);
    const unrelated=structuredClone(first.request());
    unrelated.data.item.payload.writes.find(w=>w.entityType==='paymentAllocations').data.saleId='other-space-sale';
    await assert.rejects(callCommit(unrelated),{code:'failed-precondition'});
    const results=await Promise.allSettled([callCommit(first.request()),callCommit(second.request())]);
    assert.equal(results.filter(result=>result.status==='fulfilled').length,1);
    assert.equal(results.find(result=>result.status==='rejected').reason.code,'failed-precondition');
    assert.equal((await qa.root.collection('payments').get()).size,1);
    assert.equal((await qa.root.collection('paymentAllocations').get()).size,1);
    assert.equal((await qa.root.collection('sales').doc('sale-a').get()).data().creditRemainingAmount,50);
    assert.equal((await qa.root.collection('sales').doc('sale-b').get()).data().creditRemainingAmount,undefined);
    assert.equal((await qa.clientRef.get()).data().saldo,-120);
  }finally{first.h.close();second.h.close();}
});
