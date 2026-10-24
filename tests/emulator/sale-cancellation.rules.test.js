'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore');
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=req('firebase-admin/app'),{getFirestore,Timestamp}=req('firebase-admin/firestore');
const {saleCancellationService}=require('../../functions/src/services/sale-cancellation-service');
const {financialIncomeService}=require('../../functions/src/services/financial-income-service');
if(!/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Local Firestore Emulator required; production prohibited');
let env,app,db,service,n=0;
const at=Timestamp.fromDate(new Date('2026-10-20T12:00:00Z')),later=Timestamp.fromDate(new Date('2026-10-21T12:00:00Z'));
test.before(async()=>{env=await initializeTestEnvironment({projectId:'demo-veconi-cancel',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});app=initializeApp({projectId:'demo-veconi-cancel'},'safe-cancellation-qa');db=getFirestore(app);service=saleCancellationService(db,{projectFinancial:(bid,sid,s)=>financialIncomeService(db).projectSale(bid,sid,s)});});
test.after(async()=>{await env?.cleanup();if(app)await deleteApp(app);});
async function setup({method='dinheiro',finance=false,variable=false}={}){
 const bid=`cancel-qa-${Date.now()}-${++n}`,space='space-'+bid,owner='owner-'+bid,seller='seller-'+bid,root=db.doc('businesses/'+bid),client='client';
 await root.set({ownerId:owner,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'professional',status:'active'}});
 for(const [uid,role]of [[owner,'owner'],[seller,'seller']]){await db.doc('users/'+uid).set({uid,role,businessId:bid,active:true});await root.collection('members').doc(uid).set({uid,role,status:'active',spaceAccess:'selected',allowedSpaceIds:[space],permissions:{'sales.create':true,'sales.cancel':true,'products.view':true,'customers.view':true,'financial.view':false,'reports.viewProfit':false,'products.viewCost':false}});}
 await db.doc('financialSpaces/'+space).set({id:space,ownerUid:owner,businessId:bid,linkedBusinessId:bid,type:'business',active:true,capabilities:{sales:true,products:true,inventory:true,finance},automation:{enabled:true,activatedAt:'2020-01-01T00:00:00Z',defaultIncomeFinancialAccountId:'cash',autoIncome:{sales:true}}});
 await db.doc(`financialSpaces/${space}/financialAccounts/cash`).set({ownerUid:owner,active:true,accessMode:'single_space',defaultFinancialSpaceId:space,currentBalanceCents:0});
 await root.collection('products').doc('product').set({id:'product',businessId:bid,productType:variable?'variable':'simple',nome:'Produto fictício QA',active:true,spaceAccessMode:'single_space',defaultSpaceId:space,allowedSpaceIds:[space],estoqueAtual:4,estoque:4,totalStock:4,preco:10,version:8});
 if(variable)await root.collection('productVariants').doc('variant').set({businessId:bid,parentProductId:'product',active:true,stock:4,price:10,version:8});
 const sale={id:'original',operationId:'original-operation',businessId:bid,spaceId:space,status:method==='fiado'?'fiado':'pago',formaPagamento:method,actorUid:seller,clienteId:client,clienteNome:'Cliente fictício QA',data:at,createdAt:at,updatedAt:at,version:1,valorFinal:20,valorTotal:20,financialVersionAnterior:1,saldoAtual:-32,creditPaidAmount:0,creditRemainingAmount:20,creditSettled:false,itens:[{produtoId:'product',variantId:variable?'variant':null,quantidade:2,nome:'Produto fictício QA',precoUnitario:10}]};
 await root.collection('sales').doc('original').set(sale);
 await root.collection('sales').doc('later').set({...sale,id:'later',operationId:'later-operation',data:later,status:'pago',formaPagamento:'dinheiro',valorFinal:10,itens:[{produtoId:'product',quantidade:1}]});
 await root.collection('stockMovements').doc('original-movement').set({businessId:bid,spaceId:space,operationId:'original-operation',vendaId:'original',produtoId:'product',variantId:variable?'variant':null,tipo:'saida_venda',quantidade:-2,estoqueAnterior:10,estoqueNovo:8,data:at});
 await root.collection('stockMovements').doc('later-movement').set({businessId:bid,spaceId:space,vendaId:'later',produtoId:'product',variantId:variable?'variant':null,tipo:'saida_venda',quantidade:-1,estoqueAnterior:5,estoqueNovo:4,data:later});
 await root.collection('clients').doc(client).set({businessId:bid,saldo:method==='fiado'?-42:-12,financialVersion:3,nome:'Cliente fictício QA'});
 if(method==='fiado')await root.collection('balanceEvents').doc('credit_sale:original').set({businessId:bid,spaceId:space,customerId:client,clientId:client,saleId:'original',sourceDocumentId:'original',type:'credit_sale',status:'applied',amount:20,balanceDelta:-20,appliedAt:at,createdAt:at});
 const request={auth:{uid:owner},data:{businessId:bid,spaceId:space,workspaceGeneration:0,saleId:'original'}};
 return{bid,space,owner,seller,root,sale,request};
}
async function reviewed(c,changes={}){const p=await service.preview(c.request);return{...c.request,data:{...c.request.data,operationId:p.operationId,fingerprint:p.fingerprint,reason:'Correção fictícia de registro QA',confirmed:true,refundHandling:c.sale.formaPagamento==='fiado'?'not_applicable':'external_refund_confirmed',...changes}};}
const read=async(c,col,id)=>(await c.root.collection(col).doc(id).get()).data();
async function returns(c){return(await c.root.collection('stockMovements').where('vendaId','==','original').get()).docs.filter(d=>d.data().tipo==='entrada_cancelamento_venda');}
for(const method of ['pix','dinheiro','cartao'])test(`old ${method} sale: canonical cancellation adds delta to CURRENT stock and preserves later sale`,async()=>{
 const c=await setup({method}),beforeLater=await read(c,'sales','later'),r=await service.confirm(await reviewed(c));
 assert.equal(r.status,'cancelado');assert.equal(r.automaticRefund,false);assert.equal((await read(c,'products','product')).estoqueAtual,6);assert.deepEqual(await read(c,'sales','later'),beforeLater);
 const original=await read(c,'sales','original');assert.equal(original.actorUid,c.seller);assert.equal(original.operationId,'original-operation');assert.equal(original.cancelledByUid,c.owner);assert.equal(original.active,false);assert.ok(original.cancellationReason);
 assert.equal((await returns(c)).length,1);assert.equal((await read(c,'clients','client')).saldo,-12);
});
test('latest sale has no special restriction in the canonical cancellation',async()=>{const c=await setup();await c.root.collection('sales').doc('later').delete();await c.root.collection('sales').doc('original').update({data:Timestamp.now()});await service.confirm(await reviewed(c));assert.equal((await read(c,'products','product')).estoqueAtual,6);});
test('variant return recomputes parent aggregate without restoring an old snapshot',async()=>{const c=await setup({variable:true});await service.confirm(await reviewed(c));assert.equal((await read(c,'productVariants','variant')).stock,6);assert.equal((await read(c,'products','product')).totalStock,6);});
test('same request, lost response and concurrent retry: one cancellation, one movement',async()=>{const c=await setup(),r=await reviewed(c);await Promise.all([service.confirm(r),service.confirm(r)]);const replay=await service.confirm(r);assert.equal(replay.replayed,true);assert.equal((await returns(c)).length,1);assert.equal((await read(c,'products','product')).estoqueAtual,6);assert.equal((await c.root.collection('processedOperations').get()).size,1);});
test('second identity/reason cannot create another reversal',async()=>{const c=await setup(),r=await reviewed(c);await service.confirm(r);await assert.rejects(service.confirm({...r,data:{...r.data,reason:'Motivo diferente depois do commit'}}));await assert.rejects(service.confirm({...r,auth:{uid:c.seller}}));assert.equal((await returns(c)).length,1);});
test('Fiado old/intermediate: restore only original debit while preserving later debit balance',async()=>{const c=await setup({method:'fiado'}),r=await reviewed(c);await service.confirm(r);await service.confirm(r);const client=await read(c,'clients','client'),event=await read(c,'balanceEvents','credit_sale_reversal:original');assert.equal(client.saldo,-22);assert.equal(client.financialVersion,4);assert.equal(event.balanceDelta,20);assert.equal(event.financialVersionBefore,3);assert.equal((await returns(c)).length,1);});
for(const dependency of ['received','later-payment','adjustment','exchange','credit','integrated','online','campaign','renewal','missing-movement','other-space'])test(`dependency ${dependency}: no cancellation, balance or stock effects`,async()=>{
 const c=await setup({method:['received','later-payment','adjustment'].includes(dependency)?'fiado':'dinheiro'});
 if(dependency==='received'){await c.root.collection('sales').doc('original').update({creditPaidAmount:5});await c.root.collection('paymentAllocations').doc('allocation').set({saleId:'original',amount:5});}
 if(dependency==='later-payment'||dependency==='adjustment')await c.root.collection('balanceEvents').doc('later-effect').set({businessId:c.bid,customerId:'client',type:dependency==='adjustment'?'balance_adjustment':'payment_received',appliedAt:later,amount:5});
 if(dependency==='exchange')await c.root.collection('saleExchangeSummaries').doc('original').set({businessId:c.bid,spaceId:c.space,count:1});
 if(dependency==='credit')await c.root.collection('sales').doc('original').update({source:'exchange_credit_checkout',exchangeCreditUsedCents:1000});
 if(dependency==='integrated')await c.root.collection('sales').doc('original').update({paymentIntentId:'payment-intent'});
 if(dependency==='online')await c.root.collection('sales').doc('original').update({onlineOrderId:'online-order'});
 if(dependency==='campaign')await c.root.collection('sales').doc('original').update({campaignUpdates:[{id:'campaign'}]});
 if(dependency==='renewal')await c.root.collection('sales').doc('original').update({subscriptionUpdates:[{id:'subscription'}]});
 if(dependency==='missing-movement')await c.root.collection('stockMovements').doc('original-movement').delete();
 if(dependency==='other-space')await c.root.collection('products').doc('product').update({defaultSpaceId:'other-space',allowedSpaceIds:['other-space']});
 const client=await read(c,'clients','client');await assert.rejects(service.preview(c.request));assert.equal((await read(c,'products','product')).estoqueAtual,4);assert.deepEqual(await read(c,'clients','client'),client);assert.equal((await c.root.collection('processedOperations').get()).size,0);
});
test('stale stock quote rejects atomically; new review uses later stock',async()=>{const c=await setup(),old=await reviewed(c);await c.root.collection('products').doc('product').update({estoqueAtual:3,estoque:3,totalStock:3});await assert.rejects(service.confirm(old),/mudou/);assert.equal((await read(c,'products','product')).estoqueAtual,3);await service.confirm(await reviewed(c));assert.equal((await read(c,'products','product')).estoqueAtual,5);});
test('Pix requires explicit external refund disposition; no automatic refund',async()=>{const c=await setup({method:'pix'}),r=await reviewed(c,{refundHandling:'pending_external'});await assert.rejects(service.confirm(r),/devolução externa/);assert.equal((await returns(c)).length,0);await service.confirm(await reviewed(c,{refundHandling:'not_due'}));assert.equal((await read(c,'sales','original')).refundHandling,'not_due');});
test('seller authorized cancels without reading Financeiro or costs; seller without grant rejected',async()=>{
 const c=await setup({finance:true});c.request.auth.uid=c.seller;await c.root.collection('productFinancials').doc('product').set({businessId:c.bid,custo:1});
 const preview=await service.preview(c.request);assert.doesNotMatch(JSON.stringify(preview),/custo|lucro|saldo|financialVersion/);
 const clientDb=env.authenticatedContext(c.seller).firestore();await assertFails(sdk.getDoc(sdk.doc(clientDb,`businesses/${c.bid}/productFinancials/product`)));await assertFails(sdk.getDocs(sdk.collection(clientDb,`financialSpaces/${c.space}/entries`)));
 await service.confirm(await reviewed(c));assert.equal((await returns(c)).length,1);
 const other=await setup();other.request.auth.uid=other.seller;await other.root.collection('members').doc(other.seller).update({permissions:{'sales.create':true,'sales.cancel':false}});await assert.rejects(service.preview(other.request),{code:'permission-denied'});
});
test('financial automation reverses only existing original income exactly once',async()=>{
 const c=await setup({method:'pix',finance:true}),f=financialIncomeService(db);await f.projectSale(c.bid,'original',c.sale);const r=await reviewed(c);await service.confirm(r);await service.confirm(r);
 const entries=(await db.collection(`financialSpaces/${c.space}/entries`).get()).docs.map(d=>d.data());assert.equal(entries.length,2);assert.equal(entries.filter(e=>e.direction==='in')[0].amountCents,2000);assert.equal(entries.filter(e=>e.direction==='out')[0].amountCents,2000);assert.equal((await db.doc(`financialSpaces/${c.space}/financialAccounts/cash`).get()).data().currentBalanceCents,0);
});
test('note mentioning a troca is NOT proof of a registered exchange',async()=>{const c=await setup();await c.root.collection('sales').doc('original').update({observacao:'Produtos entregues como troca — texto fictício QA'});await service.confirm(await reviewed(c));assert.equal((await returns(c)).length,1);});
test('online reservations survive return; no reserved stock is consumed',async()=>{const c=await setup(),{stockKey}=require('../../functions/src/services/online-stock-reservation');await c.root.collection('products').doc('product').update({onlineReservedStock:2});await c.root.collection('onlineStockReservations').doc(stockKey({productId:'product',variantId:null})).set({businessId:c.bid,spaceId:c.space,quantity:2});await service.confirm(await reviewed(c));assert.equal((await read(c,'products','product')).estoqueAtual,6);assert.equal((await read(c,'products','product')).onlineReservedStock,2);});
test('cross-space and obsolete generation are rejected before effects',async()=>{const c=await setup();await assert.rejects(service.preview({...c.request,data:{...c.request.data,spaceId:'other-space'}}));await assert.rejects(service.preview({...c.request,data:{...c.request.data,workspaceGeneration:1}}));assert.equal((await returns(c)).length,0);});
test('read from another device after reload sees canonical cancelled status; queue never created',async()=>{const c=await setup();await service.confirm(await reviewed(c));const other=env.authenticatedContext(c.owner).firestore(),s=(await sdk.getDocFromServer(sdk.doc(other,`businesses/${c.bid}/sales/original`))).data();assert.equal(s.status,'cancelado');assert.equal(require('../../js/performance-model').validSale(s),false);assert.ok(s.cancelOperationId);assert.equal((await c.root.collection('sales').get()).size,2);});
test('legacy direct writes cannot cancel ordinary sales or overwrite canonical cancellation/replay stock',async()=>{
 const ordinary=await setup(),old=env.authenticatedContext(ordinary.owner).firestore();
 await assertFails(sdk.updateDoc(sdk.doc(old,`businesses/${ordinary.bid}/sales/original`),{status:'cancelado',active:false,updatedByUid:ordinary.owner}));
 const c=await setup();await service.confirm(await reviewed(c));const stale=env.authenticatedContext(c.owner).firestore(),batch=sdk.writeBatch(stale);
 await assertFails(sdk.updateDoc(sdk.doc(stale,`businesses/${c.bid}/sales/original`),{status:'cancelado',cancelOperationId:'stale-legacy-operation',updatedByUid:c.owner}));
 batch.update(sdk.doc(stale,`businesses/${c.bid}/sales/original`),{status:'cancelado',active:false,cancelOperationId:'stale-legacy-operation',updatedByUid:c.owner});
 batch.update(sdk.doc(stale,`businesses/${c.bid}/products/product`),{estoqueAtual:8,estoque:8,totalStock:8});
 await assertFails(batch.commit());assert.equal((await read(c,'products','product')).estoqueAtual,6);assert.equal((await returns(c)).length,1);
});
test('compatible rollback blocks new cancellations but preserves readable idempotent receipts',async()=>{const c=await setup(),request=await reviewed(c);await service.confirm(request);const paused=saleCancellationService(db,{allowNewCancellations:false});assert.equal((await paused.confirm(request)).replayed,true);assert.equal((await returns(c)).length,1);const next=await setup(),notCommitted=await reviewed(next);await assert.rejects(paused.preview(next.request),/suspensos/);await assert.rejects(paused.confirm(notCommitted),/suspensos/);assert.equal((await returns(next)).length,0);});
