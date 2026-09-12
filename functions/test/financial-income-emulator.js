'use strict';

const assert=require('node:assert/strict');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {financialIncomeService}=require('../src/services/financial-income-service');

async function main(){
  const projectId=process.env.GCLOUD_PROJECT||'adi-festa-variations-test',app=initializeApp({projectId},`financial-income-${Date.now()}`),db=getFirestore(app),service=financialIncomeService(db),businessId='financial-income-a',spaceId=`business_${businessId}`,accountHomeSpaceId='personal-income-a',activatedAt='2026-09-07T10:00:00.000Z';
  try{
    await db.doc(`financialSpaces/${accountHomeSpaceId}`).set({id:accountHomeSpaceId,name:'Casa',type:'personal',linkedBusinessId:null,ownerUid:'owner-a',active:true,automation:{enabled:false}});
    await db.doc(`financialSpaces/${accountHomeSpaceId}/financialAccounts/account-inter`).set({id:'account-inter',financialSpaceId:accountHomeSpaceId,accountHomeSpaceId,ownerUid:'owner-a',name:'Inter',type:'bank_account',accessMode:'all_spaces',allowedFinancialSpaceIds:[],defaultFinancialSpaceId:accountHomeSpaceId,initialBalanceCents:10000,currentBalanceCents:10000,includeInAvailableBalance:true,active:true,schemaVersion:4});
    await db.doc(`financialSpaces/${spaceId}`).set({id:spaceId,name:'Adi Festa',type:'business',linkedBusinessId:businessId,ownerUid:'owner-a',active:true,automation:{enabled:true,linkedBusinessId:businessId,activatedAt,defaultIncomeFinancialAccountId:'account-inter',defaultIncomeFinancialAccountHomeSpaceId:accountHomeSpaceId,autoIncome:{sales:true,customerPayments:true,onlineOrders:true}},autoIncomeSince:activatedAt});

    const sale={status:'pago',valorFinal:50,formaPagamento:'pix',clienteNome:'Cliente PIX',clienteId:'client-a',data:'2026-09-07T11:00:00.000Z'};
    const firstSale=await service.projectSale(businessId,'sale-1',sale),retrySale=await service.projectSale(businessId,'sale-1',sale);
    assert.equal(firstSale.created,true);assert.equal(retrySale.created,false);
    assert.equal((await db.doc(`financialSpaces/${spaceId}/entries/sale_sale-1`).get()).data().amountCents,5000);
    assert.equal((await db.doc(`financialSpaces/${spaceId}/entries/sale_sale-1`).get()).data().financialAccountId,'account-inter');
    assert.equal((await db.doc(`financialSpaces/${spaceId}/entries/sale_sale-1`).get()).data().financialAccountHomeSpaceId,accountHomeSpaceId);
    assert.equal((await db.doc(`financialSpaces/${accountHomeSpaceId}/financialAccounts/account-inter`).get()).data().currentBalanceCents,15000);
    const reversedSale=await service.projectSale(businessId,'sale-1',{...sale,status:'cancelado',reversedAt:'2026-09-08T09:00:00.000Z'});
    assert.equal(reversedSale.created,true);
    assert.equal((await db.doc(`financialSpaces/${spaceId}/entries/reversal_sale_sale-1_full`).get()).data().occurredAt,'2026-09-08T09:00:00.000Z');
    assert.equal((await db.doc(`financialSpaces/${accountHomeSpaceId}/financialAccounts/account-inter`).get()).data().currentBalanceCents,10000);

    const credit=await service.projectSale(businessId,'sale-credit',{...sale,status:'fiado'});
    assert.equal(credit.skipped,'credit-sale-not-realized');
    assert.equal((await db.doc(`financialSpaces/${spaceId}/entries/sale_sale-credit`).get()).exists,false);

    const partial=await service.projectPayment(businessId,'payment-20',{status:'applied',applicationStatus:'applied',effectiveAmount:20,legacyAmount:20,allocations:[],clienteNome:'Cliente Fiado',clienteId:'client-a',paymentMethod:'pix',data:'2026-09-07T12:00:00.000Z'});
    const remaining=await service.projectPayment(businessId,'payment-30',{status:'applied',applicationStatus:'applied',effectiveAmount:30,allocations:[{saleId:'sale-credit',amount:30}],clienteNome:'Cliente Fiado',clienteId:'client-a',paymentMethod:'cash',data:'2026-09-07T13:00:00.000Z'});
    assert.equal(partial.entry.amountCents,2000);assert.equal(remaining.entry.amountCents,3000);
    assert.equal((await service.projectPayment(businessId,'payment-20',{status:'applied',applicationStatus:'applied',effectiveAmount:20,data:'2026-09-07T12:00:00.000Z'})).created,false);
    assert.equal((await db.doc(`financialSpaces/${accountHomeSpaceId}/financialAccounts/account-inter`).get()).data().currentBalanceCents,15000);

    const online=await service.projectSale(businessId,'sale-online',{...sale,operationId:'catalog-order:order-1'});
    assert.equal(online.entry.relatedOrderId,'order-1');

    const old=await service.projectPayment(businessId,'payment-old',{status:'applied',applicationStatus:'applied',valor:100,data:'2026-09-01T12:00:00.000Z'});
    assert.equal(old.skipped,'before-activation');

    await db.doc('financialSpaces/business_disabled').set({id:'business_disabled',name:'Desativado',type:'business',linkedBusinessId:'disabled',ownerUid:'owner-a',active:true,automation:{enabled:false,activatedAt}});
    assert.equal((await service.projectPayment('disabled','payment-disabled',{status:'applied',valor:10,data:'2026-09-07T12:00:00.000Z'})).skipped,'automation-disabled');

    const reversed=await service.projectPayment(businessId,'payment-20',{status:'reversed',applicationStatus:'reversed',effectiveAmount:20,reversedAt:'2026-09-07T14:00:00.000Z'});
    assert.equal(reversed.created,true);
    assert.equal((await db.doc(`financialSpaces/${spaceId}/entries/reversal_customer_payment_payment-20_full`).get()).data().direction,'out');

    await db.doc(`financialSpaces/${spaceId}`).update({'automation.enabled':false});
    const reversedWhileDisabled=await service.projectPayment(businessId,'payment-30',{status:'reversed',applicationStatus:'reversed',effectiveAmount:30,reversedAt:'2026-09-07T14:30:00.000Z'});
    assert.equal(reversedWhileDisabled.created,true);
    assert.equal((await db.doc(`financialSpaces/${spaceId}/entries/reversal_customer_payment_payment-30_full`).get()).data().amountCents,3000);
    await db.doc(`financialSpaces/${spaceId}`).update({'automation.enabled':true});

    await db.doc(`businesses/${businessId}/payments/beatriz-6350`).set({id:'beatriz-6350',businessId,status:'applied',applicationStatus:'applied',valor:63.5,effectiveAmount:63.5,clienteNome:'Beatriz Maze',clienteId:'beatriz',observacao:'PIX',data:'2026-09-07T15:00:00.000Z',createdAt:'2026-09-07T15:00:00.000Z'});
    const reconciliation=await service.reconcileBusiness(businessId,{limit:100}),beatriz=(await db.doc(`financialSpaces/${spaceId}/entries/credit_payment_beatriz-6350`).get()).data();
    assert.ok(reconciliation.checked>=1);assert.equal(reconciliation.reasons.created>=1,true);assert.equal(beatriz.amountCents,6350);assert.equal(beatriz.paymentMethod,'pix');assert.equal(beatriz.autoGenerated,true);

    const entries=await db.collection(`financialSpaces/${spaceId}/entries`).get(),beatrizEntries=entries.docs.filter(item=>item.data().sourceId==='beatriz-6350');
    assert.equal(beatrizEntries.length,1);

    await db.doc(`businesses/${businessId}/payments/pending-with-evidence`).set({id:'pending-with-evidence',businessId,status:'pending_sync',applicationStatus:'pending',valor:20,effectiveAmount:20,clienteNome:'Cliente reconciliado',clienteId:'client-evidence',paymentMethod:'pix',data:'2026-09-07T16:00:00.000Z'});
    assert.equal((await service.projectPayment(businessId,'pending-with-evidence',(await db.doc(`businesses/${businessId}/payments/pending-with-evidence`).get()).data())).skipped,'payment-not-applied');
    await db.doc(`businesses/${businessId}/balanceEvents/payment_received:pending-with-evidence`).set({type:'payment_received',status:'applied',sourceDocumentId:'pending-with-evidence',customerId:'client-evidence',amount:20});
    assert.equal((await service.projectPayment(businessId,'pending-with-evidence',(await db.doc(`businesses/${businessId}/payments/pending-with-evidence`).get()).data())).created,true);
    await db.doc(`businesses/${businessId}/payments/pending-wrong-evidence`).set({id:'pending-wrong-evidence',businessId,status:'pending_sync',applicationStatus:'pending',valor:30,effectiveAmount:30,clienteId:'client-evidence',data:'2026-09-07T16:10:00.000Z'});
    await db.doc(`businesses/${businessId}/balanceEvents/payment_received:pending-wrong-evidence`).set({type:'payment_received',status:'applied',sourceDocumentId:'pending-wrong-evidence',customerId:'client-evidence',amount:29});
    assert.equal((await service.projectPayment(businessId,'pending-wrong-evidence',(await db.doc(`businesses/${businessId}/payments/pending-wrong-evidence`).get()).data())).skipped,'payment-not-applied');

    const buggyPaymentId='processed-payment-with-sale-update',buggyClientId='client-processed-payment',buggyOccurredAt='2026-09-07T16:20:00.000Z',buggyCommittedAt=new Date('2026-09-07T16:20:01.000Z');
    await db.doc(`businesses/${businessId}/clients/${buggyClientId}`).set({id:buggyClientId,businessId,ownerId:'owner-a',saldo:0,atualizadoEm:buggyOccurredAt,updatedAt:buggyCommittedAt});
    await db.doc(`businesses/${businessId}/payments/${buggyPaymentId}`).set({id:buggyPaymentId,operationId:buggyPaymentId,idempotencyKey:buggyPaymentId,businessId,ownerId:'owner-a',status:'pending_sync',applicationStatus:'pending',financialStateDependent:true,valor:63.5,requestedAmount:63.5,effectiveAmount:63.5,legacyAmount:45,allocatedAmount:18.5,allocations:[{saleId:'old-credit-sale',amount:18.5}],clienteNome:'Beatriz Maze',clienteId:buggyClientId,observacao:'PIX',saldoAnterior:-63.5,saldoNovo:0,data:buggyOccurredAt,createdAt:buggyOccurredAt,updatedAt:buggyCommittedAt});
    await db.doc(`businesses/${businessId}/processedOperations/${buggyPaymentId}`).set({id:buggyPaymentId,idempotencyKey:buggyPaymentId,businessId,ownerId:'owner-a',status:'processed',eventKind:'sale',processedAt:buggyCommittedAt});
    const buggyFirst=await service.projectPayment(businessId,buggyPaymentId,(await db.doc(`businesses/${businessId}/payments/${buggyPaymentId}`).get()).data()),buggyRetry=await service.projectPayment(businessId,buggyPaymentId,(await db.doc(`businesses/${businessId}/payments/${buggyPaymentId}`).get()).data()),buggyEvidence=(await db.doc(`businesses/${businessId}/balanceEvents/payment_received:${buggyPaymentId}`).get()).data(),buggyApplied=(await db.doc(`businesses/${businessId}/payments/${buggyPaymentId}`).get()).data();
    assert.equal(buggyFirst.created,true);assert.equal(buggyRetry.created,false);assert.equal(buggyEvidence.status,'applied_by_reconciliation');assert.equal(buggyEvidence.amount,63.5);assert.equal(buggyApplied.applicationStatus,'applied');assert.equal(buggyApplied.financialOperationId,`payment_received:${buggyPaymentId}`);
    const unsafePaymentId='processed-payment-unsafe',unsafeCommittedAt=new Date('2026-09-07T16:30:01.000Z');
    await db.doc(`businesses/${businessId}/payments/${unsafePaymentId}`).set({id:unsafePaymentId,operationId:unsafePaymentId,idempotencyKey:unsafePaymentId,businessId,ownerId:'owner-a',status:'pending_sync',applicationStatus:'pending',financialStateDependent:true,valor:10,requestedAmount:10,effectiveAmount:10,legacyAmount:10,allocatedAmount:0,clienteId:buggyClientId,saldoAnterior:-10,saldoNovo:0,data:'2026-09-07T16:30:00.000Z',updatedAt:unsafeCommittedAt});
    await db.doc(`businesses/${businessId}/processedOperations/${unsafePaymentId}`).set({id:unsafePaymentId,idempotencyKey:unsafePaymentId,businessId,ownerId:'owner-a',status:'processed',eventKind:'sale',processedAt:unsafeCommittedAt});
    const unsafe=await service.projectPayment(businessId,unsafePaymentId,(await db.doc(`businesses/${businessId}/payments/${unsafePaymentId}`).get()).data());
    assert.equal(unsafe.skipped,'payment-not-applied');assert.equal(unsafe.evidence,'atomic-commit-proof-mismatch');assert.equal((await db.doc(`businesses/${businessId}/balanceEvents/payment_received:${unsafePaymentId}`).get()).exists,false);
    console.log(JSON.stringify({ok:true,entries:entries.size,beatrizAmountCents:beatriz.amountCents,reconciliation}));
  }finally{await db.recursiveDelete(db.doc(`financialSpaces/${spaceId}`)).catch(()=>{});await db.recursiveDelete(db.doc('financialSpaces/personal-income-a')).catch(()=>{});await db.recursiveDelete(db.doc('financialSpaces/business_disabled')).catch(()=>{});await db.recursiveDelete(db.doc(`businesses/${businessId}`)).catch(()=>{});await deleteApp(app)}
}

main().catch(error=>{console.error(error);process.exitCode=1});
