'use strict';

const assert=require('node:assert/strict');
const {test}=require('node:test');
const {randomUUID}=require('node:crypto');
const {execFileSync}=require('node:child_process');
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
const clientId='qa-client',day=Plan.today();
const historicalDay=new Date(Date.parse(day+'T00:00:00.000Z')-86400000).toISOString().slice(0,10);
const at=historicalDay+'T15:00:00.000Z',adjustedAt=historicalDay+'T15:01:00.000Z';
const grants={'customers.view':true,'customers.receiveDebt':true};
const cashSettings={enabled:true,activatedAt:'2020-01-01T00:00:00.000Z',autoIncome:{customerPayments:true}};
const previousPwa='95497d97454228c4b2f3d9728279c9a9bb839f6a';
const browserScript=(file,ref)=>ref?execFileSync('git',['show',ref+':'+file],{encoding:'utf8'}):fs.readFileSync(file,'utf8');
const normalize=v=>v?.toDate?v.toDate().toISOString():Array.isArray(v)?v.map(normalize):v&&typeof v==='object'?Object.fromEntries(Object.entries(v).map(([k,x])=>[k,normalize(x)])):v;

async function setup({origin='legacy',role='owner',permissions=grants,version=2,history=false,link=false,wire=false}={}){
  const businessId='qa-'+randomUUID(),spaceId='qa-space-'+randomUUID(),otherId='qa-other-'+randomUUID();
  let uid='qa-'+randomUUID(),token;
  if(wire){
    const signup=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:signUp?key=qa',{
      method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:uid+'@example.invalid',password:'QA-only-221!',returnSecureToken:true})
    });
    assert.equal(signup.status,200);
    const session=await signup.json();
    uid=session.localId;
    token=session.idToken;
  }
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
    const split=history==='split';
    const historyInput=split?fixture([2800,247]):fixture([190]);
    if(split)client.saldo=historyInput.client.saldo;
    Object.assign(client,{fiadoHistoryVersion:1,hasInstallmentFiado:true,legacyBalanceRemaining:0});
    const plan=Plan.create({total:split?2800:190,count:split?10:2,firstDueDate:day,saleDate:historicalDay});
    for(const [collection,rows] of Object.entries(historyInput.collections)){
      for(const row of rows){
        const card=split&&(row.id==='qa-source-0'||row.sourceDocumentId==='qa-source-0');
        const origin=card?otherId:spaceId;
        const mapped={...row,...common,spaceId:origin};
        if(collection==='sales'){
          Object.assign(mapped,{status:'fiado',data:at,financialAppliedAt:at,installmentPlan:plan});
          sales.push(mapped);
        }else if(collection==='balanceEvents')mapped.appliedAt=split&&!card?adjustedAt:at;
        else if(split&&collection==='balanceAdjustments')Object.assign(mapped,{data:adjustedAt,financialAppliedAt:adjustedAt});
        batch.set(root.collection(collection).doc(row.id),mapped);
      }
    }
  }
  batch.set(root,{id:businessId,name:'Empresa de QA',active:true,workspaceGeneration:0,ownerId:role==='owner'?uid:'different-owner',
    subscription:{planId:'internal',status:'active'}});
  batch.set(db.doc('users/'+uid),{uid,businessId,active:true,role});
  batch.set(root.collection('members').doc(uid),{uid,role,status:'active',permissionsVersion:version,permissions,
    spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[spaceId]});
  batch.set(clientRef,client);
  batch.set(root.collection('clients').doc('other-client'),{...client,id:'other-client',saldo:-20});
  batch.set(root.collection('products').doc('qa-product'),{...common,id:'qa-product',estoqueAtual:7});
  for(const sale of sales)batch.set(root.collection('sales').doc(sale.id),sale);
  for(const id of [spaceId,otherId])batch.set(db.doc('financialSpaces/'+id),{id,name:id===spaceId?'Adi Festa QA':'Emprestar Cartão QA',...common,linkedBusinessId:businessId,
    active:true,type:'business',ownerUid:uid,capabilities:{sales:true,finance:true,inventory:true},automation:cashSettings});
  await batch.commit();
  const args={businessId,workspaceGeneration:0,clientId,spaceId};
  const route=(extra={},identity=auth)=>service.receipt({auth:identity,data:{kind:'fiado_receipt_route',...args,...extra}});
  const callable=async(name,data)=>({data:name==='commitOperationalSync'?await callCommit({auth,data}):await service.receipt({auth,data})});
  async function ui(activeId=spaceId,{pwaRef,transport=callable}={}){
    const h=harness({businessId,spaceId,uid,role,grants:permissions}),w=h.w,rows=h.rows();
    w.Router={atual:()=> 'clientes'};
    w.Utils.escapar=String;
    const messages=[];w.Utils.toast=message=>messages.push(message);
    w.BusinessContext.canAccessSpace=id=>id===spaceId||role==='owner'&&id===otherId;
    for(const file of ['js/fiados.js','js/spaces.js','js/clientes.js','js/receipt-messages.js'])w.eval(browserScript(file,pwaRef));
    w.Utils.dinheiro=value=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
    w.SpaceContext.setSpaces([spaceId,otherId].filter(w.BusinessContext.canAccessSpace).map(id=>({id,businessId,type:'business',name:id,active:true})));
    w.SpaceContext.selectActive(activeId);
    rows.clientes=[normalize((await clientRef.get()).data())];
    for(const [col,key] of [['sales','vendas'],['payments','pagamentos'],['paymentAllocations','alocacoesPagamento']]){
      rows[key]=(await root.collection(col).get()).docs.map(s=>normalize(s.data()));
    }
    w.FirebaseCallable=transport;
    const capture=w.SyncFirebase.createPaymentOperation;
    let intent;
    w.SyncFirebase.createPaymentOperation=(before,after,payment,value)=>{
      intent=JSON.parse(JSON.stringify(value));
      return capture(before,after,payment);
    };
    w.SyncFirebase.assertFiadoReceiptQueueClear=()=>{};
    w.SyncFirebase.assertFiadoReceiptWriter=(businessId,workspaceGeneration,scopedReceiptVersion)=>transport('commitOperationalSync',{
      kind:'sync_protocol',businessId,workspaceGeneration,syncProtocolVersion:1,clientRelease:230
    }).then(({data})=>{
      assert.equal(data.fiadoReceiptRouteVersion,1);
      if(scopedReceiptVersion===1)assert.equal(data.fiadoScopedReceiptVersion,1);
    });
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
  const confirmation=(id,identity=auth,extra={})=>service.receipt({auth:identity,data:{...args,kind:'payment_confirmation',
    paymentId:id,operationId:id,fiadoHistoryVersion:1,...extra}});
  return {businessId,spaceId,otherId,root,clientRef,route,ui,auth,token,confirmation};
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


test('scoped V2 receives partial and full in Adi Festa and Emprestar Cartão independently',async()=>{
  const qa=await setup({origin:'scheduled',history:'split'});
  const scoped=(id=qa.spaceId)=>qa.route({spaceId:id,scopedReceiptVersion:1});
  const payments=qa.root.collection('payments'),saleRef=qa.root.collection('sales').doc('qa-source-0');
  const allocations=qa.root.collection('paymentAllocations');
  const entries=id=>db.collection('financialSpaces').doc(id).collection('entries');
  const original=(await saleRef.get()).data();
  const foreign=await setup({origin:'one'});
  const foreignBefore=(await foreign.clientRef.get()).data();
  assert.equal((await qa.route()).reason,'mixed_origins');
  const adi=await scoped(),card=await scoped(qa.otherId);
  assert.equal(adi.dueCents,24700);
  assert.equal(adi.futureCents,0);
  assert.equal(card.dueCents,28000);
  assert.equal(card.futureCents,252000);
  assert.equal(card.bookBalanceCents,undefined);
  assert.ok(card.scopedAccount.entries.every(row=>row.spaceId===qa.otherId));

  async function receive(space,amount,{checkForged=false}={}){
    const view=await qa.ui(space);
    try{
      await view.open();
      const form=await view.submit(amount);
      assert.equal(view.h.commits(),1,form.querySelector('[role=alert]').textContent);
      const request=view.request(),payload=request.data.item.payload,id=request.data.item.operationId;
      assert.equal(payload.fiadoReceiptRoute.scopedReceiptVersion,1);
      assert.deepEqual(await qa.confirmation(id),{confirmed:false,status:'awaiting_confirmation'});
      if(checkForged){
        const missing=structuredClone(request);
        delete missing.data.item.payload.fiadoReceiptRoute;
        await assert.rejects(callCommit(missing),{code:'failed-precondition'});
        const wrongSpace=structuredClone(request);
        const payment=wrongSpace.data.item.payload.writes.find(w=>w.entityType==='payments');
        payment.data.spaceId=qa.spaceId;
        payment.data.financialSpaceId=qa.spaceId;
        await assert.rejects(callCommit(wrongSpace),{code:'failed-precondition'});
        const wrongAllocation=structuredClone(request);
        const allocation=wrongAllocation.data.item.payload.writes.find(w=>w.entityType==='paymentAllocations');
        allocation.data.saleId='other-sale';
        await assert.rejects(callCommit(wrongAllocation),{code:'failed-precondition'});
        assert.equal((await payments.get()).size,0);
        assert.equal((await qa.root.collection('balanceEvents').get()).size,2);
        assert.equal((await qa.clientRef.get()).data().saldo,-3047);
      }
      assert.equal((await callCommit(request)).replayed,false);
      assert.equal((await callCommit(request)).replayed,true);
      const payment=(await payments.doc(id).get()).data();
      assert.equal(payment.valor,amount);
      assert.equal(payment.spaceId,space);
      const event=(await qa.root.collection('balanceEvents').doc('payment_received:'+id).get()).data();
      assert.equal(event.balanceDelta,amount);
      assert.equal(event.spaceId,space);
      const receipt=(await qa.root.collection('processedOperations').doc(id).get()).data();
      assert.equal(receipt.status,'processed');
      assert.match(receipt.requestHash,/^[a-f0-9]{64}$/);
      assert.deepEqual(receipt.fiadoReceiptScope,{version:1,spaceId:space});
      const confirmed=await view.w.ReceiptMessages.read({paymentId:id,operationId:id,clientId});
      assert.equal(confirmed.balanceScope,'space');
      assert.equal(confirmed.spaceId,space);
      assert.equal(confirmed.amount,amount);
      assert.equal((await cash.projectPayment(qa.businessId,id,payment)).created,true);
      assert.equal((await cash.projectPayment(qa.businessId,id,payment)).created,false);
      assert.equal((await entries(space).doc('credit_payment_'+id).get()).data().amountCents,amount*100);
      assert.equal((await entries(space===qa.spaceId?qa.otherId:qa.spaceId).doc('credit_payment_'+id).get()).exists,false);
      return id;
    }finally{view.h.close();}
  }

  const firstCard=await receive(qa.otherId,100,{checkForged:true});
  assert.equal((await allocations.doc(firstCard+'__qa-source-0').get()).data().amount,100);
  assert.equal((await scoped()).dueCents,24700);
  assert.equal((await scoped(qa.otherId)).dueCents,18000);
  const cardReceipt=await qa.confirmation(firstCard);
  assert.equal(cardReceipt.balance,-180);
  assert.equal(cardReceipt.futureAmount,2520);
  assert.equal(cardReceipt.totalOutstanding,2700);
  assert.equal(cardReceipt.businessName,'Emprestar Cartão QA');
  const beforeAdi=(await saleRef.get()).data();
  const firstAdi=await receive(qa.spaceId,70);
  assert.equal((await payments.doc(firstAdi).get()).data().legacyAmount,70);
  assert.deepEqual((await saleRef.get()).data(),beforeAdi);
  assert.equal((await scoped()).dueCents,17700);
  const fullAdi=await receive(qa.spaceId,177);
  assert.equal((await scoped()).reason,'other_space');
  const previous=await qa.ui(qa.spaceId,{pwaRef:previousPwa});
  try{
    const receipt=await previous.w.ReceiptMessages.read({paymentId:fullAdi,operationId:fullAdi,clientId});
    assert.ok(receipt.balance===0);
    assert.equal(receipt.futureAmount,0);
    assert.equal(receipt.totalOutstanding,0);
    assert.equal(receipt.businessName,'Adi Festa QA');
    const message=previous.w.ReceiptMessages.resolve(previous.w.ReceiptMessages.defaultTemplate('total').content,receipt);
    assert.match(message,/Adi Festa QA/);
    assert.doesNotMatch(message,/Emprestar|2\.520|2\.700/);
  }finally{previous.h.close();}
  await assert.rejects(qa.confirmation(fullAdi,qa.auth,{operationId:firstCard}),{code:'permission-denied'});
  await assert.rejects(qa.confirmation(fullAdi,foreign.auth),{code:'permission-denied'});
  assert.equal((await scoped(qa.otherId)).futureCents,252000);
  assert.deepEqual((await saleRef.get()).data(),beforeAdi);
  const dueCard=await receive(qa.otherId,180);
  assert.equal((await scoped(qa.otherId)).dueCents,0);
  const receiptCard=await qa.confirmation(dueCard);
  assert.ok(receiptCard.balance===0);
  assert.equal(receiptCard.futureAmount,2520);
  assert.equal(receiptCard.totalOutstanding,2520);
  assert.equal((await scoped(qa.otherId)).futureCents,252000);
  const after=(await saleRef.get()).data();
  assert.equal(after.creditPaidAmount,280);
  assert.equal(after.creditRemainingAmount,2520);
  assert.deepEqual(after.installmentPlan,original.installmentPlan);
  assert.equal((await qa.clientRef.get()).data().saldo,-2520);
  assert.equal((await qa.clientRef.get()).data().legacyBalanceRemaining,0);
  assert.equal((await payments.get()).size,4);
  assert.equal((await allocations.get()).size,2);
  assert.equal((await entries(qa.spaceId).get()).size,2);
  assert.equal((await entries(qa.otherId).get()).size,2);
  assert.deepEqual((await foreign.clientRef.get()).data(),foreignBefore);
  assert.equal((await foreign.root.collection('payments').get()).size,0);
  await qa.root.collection('processedOperations').doc(firstCard).update({'fiadoReceiptScope.spaceId':qa.spaceId});
  assert.deepEqual(await qa.confirmation(firstCard),{confirmed:false,status:'requires_review'});
  assert.equal((await payments.get()).size,4);
});

test('scoped V2 denies an unauthorized space, another company and a contradictory history',async()=>{
  const qa=await setup({origin:'scheduled',history:'split',role:'seller'});
  assert.equal((await qa.route({scopedReceiptVersion:1})).dueCents,24700);
  await assert.rejects(qa.route({spaceId:qa.otherId,scopedReceiptVersion:1}),{code:'permission-denied'});
  await assert.rejects(qa.route({businessId:'another-company',scopedReceiptVersion:1}),{code:'permission-denied'});
  await qa.root.collection('balanceEvents').doc('balance_adjustment:qa-source-1').update({spaceId:qa.otherId});
  assert.equal((await qa.route({scopedReceiptVersion:1})).mode,'blocked');
  assert.equal((await qa.root.collection('payments').get()).size,0);
});

test('traditional tracked debts in two spaces receive only the selected sale without rewriting the legacy fields',async()=>{
  const qa=await setup({origin:'mixed'}),view=await qa.ui(qa.otherId);
  const otherSale=qa.root.collection('sales').doc('sale-a'),selectedSale=qa.root.collection('sales').doc('sale-b');
  const before=(await otherSale.get()).data();
  try{
    await view.open();
    const form=await view.submit(70);
    assert.equal(view.h.commits(),1,form.querySelector('[role=alert]').textContent);
    const request=view.request(),id=request.data.item.operationId;
    assert.equal((await callCommit(request)).replayed,false);
    assert.equal((await callCommit(request)).replayed,true);
    assert.deepEqual((await otherSale.get()).data(),before);
    assert.equal((await selectedSale.get()).data().creditRemainingAmount,0);
    assert.equal((await qa.clientRef.get()).data().saldo,-120);
    const payment=(await qa.root.collection('payments').doc(id).get()).data();
    assert.equal(payment.spaceId,qa.otherId);
    assert.equal(payment.legacyAmount,0);
    assert.equal((await qa.root.collection('paymentAllocations').doc(id+'__sale-b').get()).data().amount,70);
  }finally{view.h.close();}
});

test('PWA V231 keeps its single-space receipt contract and blocks a mixed account',async()=>{
  const qa=await setup({history:true}),view=await qa.ui(qa.spaceId,{pwaRef:previousPwa});
  try{
    await view.open();
    const form=await view.submit(35);
    assert.equal(view.h.commits(),1,form.querySelector('[role=alert]').textContent);
    const request=view.request(),id=request.data.item.operationId;
    assert.equal(request.data.item.payload.fiadoReceiptRoute.scopedReceiptVersion,undefined);
    assert.equal((await callCommit(request)).replayed,false);
    assert.equal((await callCommit(request)).replayed,true);
    const receipt=await view.w.ReceiptMessages.read({paymentId:id,operationId:id,clientId});
    assert.equal(receipt.amount,35);
    assert.equal(receipt.balance,-60);
    assert.equal(receipt.futureAmount,95);
    assert.equal(receipt.balanceScope,undefined);
  }finally{view.h.close();}
  const mixed=await setup({history:'split'}),old=await mixed.ui(mixed.otherId,{pwaRef:previousPwa});
  try{
    await old.open();
    assert.equal(old.modal(),null);
    assert.match(old.messages.at(-1),/mais de um espaço/);
    assert.equal((await mixed.root.collection('payments').get()).size,0);
  }finally{old.h.close();}
});


function openingApi(qa,{enabled=true}={}){
 const {createOriginEvidenceHandler}=require('../../functions/src/fiado-origin-evidence-handler');
 const handler=createOriginEvidenceHandler(db,{access:{enabled:true,openingEnabled:enabled,
  ownerUid:qa.auth.uid,businessId:qa.businessId,workspaceGeneration:0,adiSpaceId:qa.spaceId,cardSpaceId:qa.otherId}});
 return (action,extra={},auth=qa.auth)=>handler({auth,data:{action,businessId:qa.businessId,
  workspaceGeneration:0,clientId,...extra}});
}

async function confirmOpening(api,quote,extra={}){
 const draft={requestId:randomUUID(),confirmed:true,queueChecked:true,reviewHash:quote.reviewHash,
  balances:quote.parts.map(({spaceId,totalCents})=>({spaceId,totalCents})),...extra};
 return {draft,result:await api('openingConfirm',draft)};
}

test('owner confirms the traditional closing balance once; old records stay intact and the next receipt starts from the opening',async()=>{
 const qa=await setup({origin:'unknown'}),api=openingApi(qa);
 const payments=qa.root.collection('payments'),old=payments.doc('historic-payment');
 await old.set({id:old.id,businessId:qa.businessId,clienteId:clientId,status:'applied',valor:100,financialAppliedAt:at});
 const before=(await qa.clientRef.get()).data();
 const original=(await old.get()).data();
 const originals=(await qa.root.collection('sales').get()).docs.map(doc=>doc.data());
 await assert.rejects(openingApi(qa,{enabled:false})('openingPreview'),{code:'permission-denied'});
 await assert.rejects(api('openingPreview',{}, {uid:'unauthorized-qa'}),{code:'permission-denied'});
 await assert.rejects(api('openingPreview',{businessId:'wrong-company'}),{code:'permission-denied'});
 const quote=await api('openingPreview');
 assert.deepEqual(quote.parts.map(part=>[part.totalCents,part.futureCents]),[[19000,0],[0,0]]);
 await assert.rejects(confirmOpening(api,quote,{queueChecked:false}),{code:'failed-precondition'});
 await assert.rejects(api('openingPreview',{balances:[{spaceId:qa.spaceId,totalCents:18000},{spaceId:qa.otherId,totalCents:0}]}),
  /soma precisa coincidir/);
 const {draft,result}=await confirmOpening(api,quote);
 assert.equal(result.status,'confirmed');assert.equal(result.writesApplied,3);
 assert.deepEqual(await api('openingConfirm',draft),{status:'replayed',writesApplied:0});
 await assert.rejects(api('openingConfirm',{...draft,requestId:randomUUID()}),{code:'failed-precondition'});
 assert.equal((await qa.clientRef.get()).data().saldo,before.saldo);
 assert.equal((await qa.clientRef.get()).data().financialVersion,before.financialVersion+1);
 assert.equal((await payments.get()).size,1);
 assert.equal((await qa.root.collection('balanceEvents').get()).size,0);
 assert.equal((await db.collection('financialSpaces/'+qa.spaceId+'/entries').get()).size,0);
 assert.equal((await qa.root.collection('fiadoOpeningBalances').get()).size,1);
 const quoteAdi=()=>qa.route({scopedReceiptVersion:1});
 assert.equal((await quoteAdi()).dueCents,19000);
 assert.equal((await qa.route({spaceId:qa.otherId,scopedReceiptVersion:1})).mode,'blocked');
 assert.equal((await qa.route()).mode,'blocked');
 const view=await qa.ui();
 try{
  await view.open();const form=await view.submit(70);
  assert.equal(view.h.commits(),1,form.querySelector('[role=alert]').textContent);
  const request=view.request(),id=request.data.item.operationId;
  const unsafe=structuredClone(request);
  delete unsafe.data.item.payload.fiadoReceiptRoute;
  await assert.rejects(callCommit(unsafe),{code:'failed-precondition'});
  assert.equal((await callCommit(request)).replayed,false);
  assert.equal((await callCommit(request)).replayed,true);
  assert.equal((await quoteAdi()).dueCents,12000);
  assert.equal((await qa.clientRef.get()).data().saldo,-120);
  assert.equal((await payments.get()).size,2);
  const paid=(await payments.doc(id).get()).data();
  assert.equal(paid.legacyAmount,70);
  assert.equal((await cash.projectPayment(qa.businessId,id,paid)).created,true);
  assert.equal((await cash.projectPayment(qa.businessId,id,paid)).created,false);
  assert.deepEqual((await old.get()).data(),original);
  assert.deepEqual((await qa.root.collection('sales').get()).docs.map(doc=>doc.data()),originals);
 }finally{view.h.close();}
 const last=await qa.ui();
 try{
  await last.open();const form=await last.submit(120);
  assert.equal(last.h.commits(),1,form.querySelector('[role=alert]').textContent);
  const request=last.request();
  assert.equal((await callCommit(request)).replayed,false);
  assert.equal((await callCommit(request)).replayed,true);
  assert.equal((await quoteAdi()).reason,'no_debt');
  assert.equal((await qa.clientRef.get()).data().saldo,0);
  assert.equal((await payments.get()).size,3);
 }finally{last.h.close();}
});

test('opening keeps the two spaces separate and preserves the original installment calendar',async()=>{
 const qa=await setup({history:'split'}),api=openingApi(qa);
 const quote=await api('openingPreview');
 assert.deepEqual(quote.parts.map(part=>[part.dueCents,part.futureCents]),[[24700,0],[28000,252000]]);
 await assert.rejects(api('openingPreview',{balances:[{spaceId:qa.spaceId,totalCents:304700},{spaceId:qa.otherId,totalCents:0}]}),
  /cobrir as parcelas/);
 const stale=quote;
 const client=(await qa.clientRef.get()).data();
 await qa.clientRef.update({financialVersion:client.financialVersion+1});
 await assert.rejects(confirmOpening(api,stale),/saldo ou o histórico mudou/);
 const current=await api('openingPreview');
 await confirmOpening(api,current);
 const card=await qa.ui(qa.otherId);
 try{
  await card.open();const form=await card.submit(100);
  assert.equal(card.h.commits(),1,form.querySelector('[role=alert]').textContent);
  const envelope=card.request(),paymentId=envelope.data.item.operationId;
  assert.equal((await callCommit(envelope)).replayed,false);
  assert.equal((await callCommit(envelope)).replayed,true);
  const [adiDue,cardDue,receipt]=await Promise.all([qa.route({scopedReceiptVersion:1}),
   qa.route({spaceId:qa.otherId,scopedReceiptVersion:1}),qa.confirmation(paymentId)]);
  assert.equal(adiDue.dueCents,24700);
  assert.equal(cardDue.dueCents,18000);
  assert.equal(cardDue.futureCents,252000);
  assert.equal(receipt.balanceScope,'space');assert.equal(receipt.spaceId,qa.otherId);
  assert.equal(receipt.balance,-180);assert.equal(receipt.futureAmount,2520);
 }finally{card.h.close();}
 const old=qa.root.collection('sales').doc('qa-source-0');
 const {installmentPlan}= (await old.get()).data();
 await old.update({installmentPlan:{...installmentPlan,firstDueDate:'2029-01-01'}});
 assert.equal((await qa.route({scopedReceiptVersion:1})).reason,'history_review');
});

test('pending payment prevents a checkpoint and a late backdated effect cannot disappear behind an active checkpoint',async()=>{
 const qa=await setup(),api=openingApi(qa),payments=qa.root.collection('payments');
 const pending=payments.doc('pending-qa');
 await pending.set({businessId:qa.businessId,clienteId:clientId,status:'manual_review',valor:10});
 await assert.rejects(api('openingPreview'),/operação financeira pendente/);
 await pending.delete();
 await confirmOpening(api,await api('openingPreview'));
 const route=()=>qa.route({scopedReceiptVersion:1});
 assert.equal((await route()).dueCents,19000);
 await qa.root.collection('balanceEvents').doc('late-backdated-qa').set({businessId:qa.businessId,
  customerId:clientId,type:'payment_received',appliedAt:at,status:'applied',balanceDelta:10,operationId:'not-recorded-qa'});
 assert.equal((await route()).reason,'history_review');
});

const functionsPort=process.env.VECONI_QA_FUNCTIONS_PORT;
test('HTTP callable reaches the real Emulator trigger and confirms a lost-response receipt only once',
  {skip:!functionsPort},async()=>{
  assert.match(functionsPort,/^\d+$/);
  const qa=await setup({history:'split',wire:true});
  const base='http://127.0.0.1:'+functionsPort+'/'+project+'/southamerica-east1/';
  const wire=async(name,data,token=qa.token)=>{
    const headers={'Content-Type':'application/json'};
    if(token)headers.Authorization='Bearer '+token;
    const response=await fetch(base+name,{method:'POST',headers,body:JSON.stringify({data}),signal:AbortSignal.timeout(15000)});
    const body=await response.json();
    if(!response.ok)throw Object.assign(Error(body.error?.message||'Callable HTTP '+response.status),{status:response.status});
    return {data:body.result??body.data};
  };
  const view=await qa.ui(qa.otherId,{transport:wire});
  try{
    await view.open();
    const form=await view.submit(280);
    assert.equal(view.h.commits(),1,form.querySelector('[role=alert]').textContent);
    const request=view.request(),id=request.data.item.operationId;
    const read={businessId:qa.businessId,workspaceGeneration:0,kind:'payment_confirmation',
      paymentId:id,operationId:id,clientId,fiadoHistoryVersion:1};
    await assert.rejects(wire('getOperationalSyncReceipt',read,null),{status:401});
    assert.deepEqual((await wire('getOperationalSyncReceipt',read)).data,{confirmed:false,status:'awaiting_confirmation'});
    await assert.rejects(async()=>{
      const committed=await wire('commitOperationalSync',request.data);
      assert.equal(committed.data.replayed,false);
      throw Object.assign(Error('QA: original response unavailable to the PWA'),{code:'qa-response-lost'});
    },{code:'qa-response-lost'});
    const confirmed=await view.w.ReceiptMessages.read({paymentId:id,operationId:id,clientId});
    assert.equal(confirmed.amount,280);
    assert.equal(confirmed.balance,0);
    assert.equal(confirmed.futureAmount,2520);
    assert.equal(confirmed.totalOutstanding,2520);
    assert.equal(confirmed.spaceId,qa.otherId);
    assert.equal(confirmed.businessName,'Emprestar Cartão QA');
    assert.equal((await wire('commitOperationalSync',request.data)).data.replayed,true);

    const entries=id=>db.collection('financialSpaces').doc(id).collection('entries');
    const cashRef=entries(qa.otherId).doc('credit_payment_'+id);
    let entry;
    const deadline=Date.now()+15000;
    do{
      entry=(await cashRef.get()).data();
      if(!entry)await new Promise(resolve=>setTimeout(resolve,150));
    }while(!entry&&Date.now()<deadline);
    assert.equal(entry?.amountCents,28000,'Missing entry from the Firestore trigger');
    assert.equal(entry.financialSpaceId,qa.otherId);
    assert.equal((await entries(qa.otherId).get()).size,1);
    assert.equal((await entries(qa.spaceId).get()).size,0);
    assert.equal((await qa.root.collection('payments').get()).size,1);
    assert.equal((await qa.root.collection('balanceEvents').get()).size,3);
    assert.equal((await qa.root.collection('paymentAllocations').get()).size,1);
    assert.equal((await qa.clientRef.get()).data().saldo,-2767);
    const adi=await wire('getOperationalSyncReceipt',{...read,kind:'fiado_receipt_route',
      spaceId:qa.spaceId,scopedReceiptVersion:1});
    assert.equal(adi.data.dueCents,24700);
  }finally{view.h.close();}
});
