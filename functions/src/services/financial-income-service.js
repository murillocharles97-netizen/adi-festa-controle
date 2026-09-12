'use strict';

const {FieldValue,Timestamp}=require('firebase-admin/firestore');

const INVALID_STATUSES=new Set(['cancelado','cancelada','cancelled','canceled','desfeito','desfeita','venda_desfeita','estornado','estornada','reversed','refunded','conflict']);
const PAID_SALE_STATUSES=new Set(['pago','paid','confirmed','completed','concluido','concluida','entregue']);
const CREDIT_SALE_STATUSES=new Set(['fiado','credit','on_credit']);
const APPLIED_PAYMENT_STATUSES=new Set(['applied','confirmed','paid','approved','completed']);
const APPLIED_BALANCE_EVENT_STATUSES=new Set(['applied','applied_by_reconciliation']);

const text=value=>String(value??'').trim();
const lower=value=>text(value).toLocaleLowerCase('pt-BR');
const cents=value=>{
  const amount=Number(value);
  return Number.isFinite(amount)?Math.round(Math.abs(amount)*100):0;
};
const signedCents=value=>{
  const amount=Number(value);
  return Number.isFinite(amount)?Math.round(amount*100):null;
};
const iso=value=>{
  if(!value)return null;
  if(typeof value.toDate==='function')return value.toDate().toISOString();
  const date=value instanceof Date?value:new Date(value);
  return Number.isNaN(date.getTime())?null:date.toISOString();
};
const timestamp=value=>{
  const normalized=iso(value);
  return normalized?Timestamp.fromDate(new Date(normalized)):null;
};
const firstDate=(source,fields)=>fields.map(field=>source?.[field]).find(value=>iso(value))||null;
const paymentMethod=value=>{
  const normalized=lower(value).normalize('NFD').replace(/[\u0300-\u036f]/g,'');
  if(normalized.includes('pix'))return'pix';
  if(normalized.includes('dinheiro')||normalized==='cash')return'cash';
  if(normalized.includes('debito')||normalized==='debit_card')return'debit_card';
  if(normalized.includes('cartao')||normalized.includes('credito')||normalized==='credit_card')return'credit_card';
  if(normalized.includes('transfer'))return'transfer';
  return'other';
};
const automationFor=space=>{
  const legacyActivation=space?.autoIncomeSince||space?.autoEntryFromPaymentsSince||space?.autoEntryFromSalesSince||null;
  const automation=space?.automation||{};
  return{
    enabled:automation.enabled===true||(automation.enabled===undefined&&Boolean(legacyActivation)),
    activatedAt:automation.activatedAt||legacyActivation,
    sales:automation.autoIncome?.sales!==false,
    customerPayments:automation.autoIncome?.customerPayments!==false,
    onlineOrders:automation.autoIncome?.onlineOrders!==false,
    defaultIncomeFinancialAccountId:text(automation.defaultIncomeFinancialAccountId)||null,
    defaultIncomeFinancialAccountHomeSpaceId:text(automation.defaultIncomeFinancialAccountHomeSpaceId)||null,
  };
};
const afterActivation=(automation,value)=>{
  const occurred=iso(value),activated=iso(automation.activatedAt);
  return Boolean(occurred&&(!activated||new Date(occurred)>=new Date(activated)));
};
const entryIdentity=(spaceId,sourceType,sourceId)=>`${spaceId}:${sourceType}:${sourceId}`;

function financialIncomeService(db){
  const spaceIdFor=businessId=>`business_${businessId}`;
  const spaceRefFor=businessId=>db.doc(`financialSpaces/${spaceIdFor(businessId)}`);
  const entryRef=(spaceId,id)=>db.doc(`financialSpaces/${spaceId}/entries/${id}`);
  const eventRef=(spaceId,id)=>db.doc(`financialSpaces/${spaceId}/events/${id}`);
  const balanceEventRef=(businessId,paymentId)=>db.doc(`businesses/${businessId}/balanceEvents/payment_received:${paymentId}`);

  async function linkedSpace(businessId,{requireEnabled=true}={}){
    const ref=spaceRefFor(businessId),snapshot=await ref.get();
    if(!snapshot.exists)return null;
    const space={id:snapshot.id,...snapshot.data()};
    if(space.active===false||space.type!=='business'||text(space.linkedBusinessId)!==text(businessId))return null;
    const automation=automationFor(space);
    if(requireEnabled&&!automation.enabled)return null;
    return{space,automation,ref};
  }

  const baseEntry=({space,businessId,id,sourceType,sourceId,amountCents,occurredAt,description,paymentMethodId,customerId=null,relatedSaleIds=[],relatedOrderId=null,direction='in',reversesEntryId=null,legacyAmountCents=0,allocatedAmountCents=0,financialAccountId=null,financialAccountHomeSpaceId=null})=>({
    id,
    financialSpaceId:space.id,
    spaceType:'business',
    linkedBusinessId:businessId,
    ownerUid:space.ownerUid,
    createdBy:'system',
    generatedBy:'firebase_function',
    operationId:id,
    idempotencyKey:entryIdentity(space.id,sourceType,sourceId),
    schemaVersion:2,
    direction,
    entryType:direction==='out'?'automatic_reversal':'automatic_income',
    amountCents,
    currency:'BRL',
    description,
    categoryId:'default_business_sales',
    categoryName:'Vendas',
    categoryIcon:'badge-dollar-sign',
    subcategoryId:'default_business_sales_customer_receipt',
    subcategoryName:'Recebimento de cliente',
    categorySchemaVersion:2,
    status:'paid',
    dueAt:occurredAt,
    occurredAt,
    paidAt:occurredAt,
    sortAt:occurredAt,
    periodKey:occurredAt.slice(0,7),
    duePeriodKey:occurredAt.slice(0,7),
    paymentMethod:paymentMethodId,
    financialAccountId:text(financialAccountId||space.automation?.defaultIncomeFinancialAccountId)||null,
    financialAccountHomeSpaceId:text(financialAccountHomeSpaceId||space.automation?.defaultIncomeFinancialAccountHomeSpaceId)||null,
    sourceType,
    sourceId:text(sourceId),
    customerId:text(customerId)||null,
    relatedSaleIds:[...new Set(relatedSaleIds.map(text).filter(Boolean))],
    relatedOrderId:text(relatedOrderId)||null,
    legacyAmountCents:Number(legacyAmountCents||0),
    allocatedAmountCents:Number(allocatedAmountCents||0),
    reversesEntryId:text(reversesEntryId)||null,
    autoGenerated:true,
    createdAt:Timestamp.fromDate(new Date(occurredAt)),
    updatedAt:FieldValue.serverTimestamp(),
  });

  async function createOnce({space,businessId,eventKind,...input}){
    let value=baseEntry({space,businessId,...input});
    const ref=entryRef(space.id,value.id),event=eventRef(space.id,value.id);
    return db.runTransaction(async transaction=>{
      const existing=await transaction.get(ref);
      if(existing.exists)return{created:false,entry:{id:existing.id,...existing.data()}};
      const accountHomeSpaceId=value.financialAccountId?text(value.financialAccountHomeSpaceId)||space.id:null,
        accountRef=value.financialAccountId?db.doc(`financialSpaces/${accountHomeSpaceId}/financialAccounts/${value.financialAccountId}`):null,
        accountSnapshot=accountRef?await transaction.get(accountRef):null,
        account=accountSnapshot?.exists?accountSnapshot.data():null;
      const mode=text(account?.accessMode)||'single_space',allowed=Array.isArray(account?.allowedFinancialSpaceIds)?account.allowedFinancialSpaceIds.map(text):[],defaultSpace=text(account?.defaultFinancialSpaceId)||accountHomeSpaceId,
        accountAllowed=account&&account.active!==false&&text(account.ownerUid)===text(space.ownerUid)&&(mode==='all_spaces'||(mode==='selected_spaces'&&allowed.includes(space.id))||(mode==='single_space'&&defaultSpace===space.id));
      if(!accountAllowed)value={...value,financialAccountId:null,financialAccountHomeSpaceId:null};
      else if(accountRef){
        value={...value,financialAccountHomeSpaceId:accountHomeSpaceId};
        const currentBalanceCents=Number.isInteger(account.currentBalanceCents)?account.currentBalanceCents:Number(account.initialBalanceCents||0),
          delta=(value.direction==='in'?1:-1)*Number(value.amountCents||0);
        transaction.update(accountRef,{currentBalanceCents:currentBalanceCents+delta,balanceUpdatedAt:value.occurredAt,lastBalanceOperationId:value.operationId,schemaVersion:Math.max(3,Number(account.schemaVersion||0)),updatedAt:FieldValue.serverTimestamp()});
      }
      transaction.create(ref,value);
      transaction.create(event,{
        id:value.id,
        financialSpaceId:space.id,
        linkedBusinessId:businessId,
        ownerUid:space.ownerUid,
        createdBy:'system',
        generatedBy:'firebase_function',
        operationId:value.id,
        idempotencyKey:value.idempotencyKey,
        schemaVersion:2,
        entryId:value.id,
        eventKind,
        transition:'created',
        status:'applied',
        amountCents:value.amountCents,
        sourceType:value.sourceType,
        sourceId:value.sourceId,
        createdAt:Timestamp.fromDate(new Date(value.occurredAt)),
      });
      return{created:true,entry:value};
    });
  }

  const paymentEvidenceMatches=(snapshot,paymentId,payment,amountCents)=>{
    const evidence=snapshot.data()||{},paymentClientId=text(payment.clienteId||payment.clientId||payment.customerId),evidenceClientId=text(evidence.customerId||evidence.clientId);
    return snapshot.exists&&lower(evidence.type)==='payment_received'&&APPLIED_BALANCE_EVENT_STATUSES.has(lower(evidence.status))&&text(evidence.sourceDocumentId)===text(paymentId)&&cents(evidence.amount)===amountCents&&(!paymentClientId||!evidenceClientId||paymentClientId===evidenceClientId);
  };

  async function backfillProcessedPaymentEvidence(businessId,paymentId,space,expectedAmountCents){
    const paymentRef=db.doc(`businesses/${businessId}/payments/${paymentId}`),evidenceRef=balanceEventRef(businessId,paymentId);
    return db.runTransaction(async transaction=>{
      const paymentSnapshot=await transaction.get(paymentRef);
      if(!paymentSnapshot.exists)return{applied:false,reason:'payment-missing'};
      const payment={id:paymentSnapshot.id,...paymentSnapshot.data()},amountCents=cents(payment.effectiveAmount??payment.valor??payment.amount),clientId=text(payment.clienteId||payment.clientId||payment.customerId),operationId=text(payment.operationId),ownerId=text(payment.ownerId||payment.ownerUid),occurredAt=iso(firstDate(payment,['receivedAt','paidAt','data','createdAt']));
      if(amountCents!==expectedAmountCents||!clientId||!operationId||operationId!==text(paymentId)||text(payment.idempotencyKey)!==operationId)return{applied:false,reason:'payment-identity-mismatch'};
      if(text(payment.businessId)!==text(businessId)||ownerId!==text(space.ownerUid)||payment.financialStateDependent!==true)return{applied:false,reason:'payment-scope-mismatch'};
      if(!['pending','pending_sync'].includes(lower(payment.applicationStatus))||!['pending','pending_sync'].includes(lower(payment.status)))return{applied:false,reason:'payment-status-not-eligible'};
      if(payment.confirmedConflictId||payment.reversedAt||payment.cancelledAt||payment.financialAppliedAt||payment.financialOperationId)return{applied:false,reason:'payment-already-resolved'};
      if(cents(payment.valor)!==amountCents||cents(payment.requestedAmount)!==amountCents||cents(payment.legacyAmount)+cents(payment.allocatedAmount)!==amountCents)return{applied:false,reason:'payment-amount-mismatch'};
      const beforeCents=signedCents(payment.saldoAnterior),afterCents=signedCents(payment.saldoNovo);
      if(beforeCents===null||afterCents===null||beforeCents+amountCents!==afterCents)return{applied:false,reason:'payment-transition-mismatch'};
      const evidenceSnapshot=await transaction.get(evidenceRef);
      if(evidenceSnapshot.exists)return paymentEvidenceMatches(evidenceSnapshot,paymentId,payment,amountCents)?{applied:true,created:false}:{applied:false,reason:'existing-evidence-mismatch'};
      const clientRef=db.doc(`businesses/${businessId}/clients/${clientId}`),markerRef=db.doc(`businesses/${businessId}/processedOperations/${operationId}`),clientSnapshot=await transaction.get(clientRef),markerSnapshot=await transaction.get(markerRef);
      if(!clientSnapshot.exists||!markerSnapshot.exists)return{applied:false,reason:'transaction-proof-missing'};
      const client=clientSnapshot.data()||{},marker=markerSnapshot.data()||{},committedAt=iso(payment.updatedAt);
      if(text(client.businessId)!==text(businessId)||text(marker.businessId)!==text(businessId)||text(client.ownerId||client.ownerUid)!==ownerId||text(marker.ownerId||marker.ownerUid)!==ownerId)return{applied:false,reason:'transaction-scope-mismatch'};
      if(lower(marker.status)!=='processed'||lower(marker.eventKind)!=='sale'||text(marker.id||markerSnapshot.id)!==operationId||text(marker.idempotencyKey)!==operationId)return{applied:false,reason:'processed-marker-mismatch'};
      if(!committedAt||iso(marker.processedAt)!==committedAt||iso(client.updatedAt)!==committedAt||iso(client.atualizadoEm)!==occurredAt||signedCents(client.saldo)!==afterCents)return{applied:false,reason:'atomic-commit-proof-mismatch'};
      const effectId=`payment_received:${paymentId}`;
      transaction.create(evidenceRef,{
        id:effectId,
        operationId,
        idempotencyKey:effectId,
        businessId,
        ownerId,
        customerId:clientId,
        clientId,
        saleId:null,
        sourceCollection:'payments',
        sourceDocumentId:paymentId,
        sourceDeviceId:text(payment.sourceDeviceId)||null,
        type:'payment_received',
        direction:'credit',
        amount:amountCents/100,
        balanceDelta:amountCents/100,
        eventKind:'payment_reconciliation',
        status:'applied_by_reconciliation',
        appliedAt:FieldValue.serverTimestamp(),
        createdAt:timestamp(occurredAt)||FieldValue.serverTimestamp(),
        updatedAt:FieldValue.serverTimestamp(),
        schemaVersion:3,
      });
      transaction.set(paymentRef,{
        financialAppliedAt:FieldValue.serverTimestamp(),
        financialOperationId:effectId,
        status:'applied',
        applicationStatus:'applied',
        reconciliationReason:'processed_payment_missing_balance_event',
        reconciledAt:FieldValue.serverTimestamp(),
        updatedAt:FieldValue.serverTimestamp(),
      },{merge:true});
      return{applied:true,created:true};
    });
  }

  async function projectSale(businessId,saleId,sale={}){
    const linked=await linkedSpace(businessId,{requireEnabled:false});
    if(!linked)return{skipped:'space-not-linked'};
    const {space,automation}=linked,status=lower(sale.status||sale.saleStatus),occurredAt=iso(firstDate(sale,['paidAt','receivedAt','data','createdAt'])),amountCents=cents(sale.valorFinal??sale.valorTotal??sale.total??sale.amount);
    const orderMatch=text(sale.operationId).match(/^catalog-order:(.+)$/);
    if(INVALID_STATUSES.has(status)||sale.deletedAt||sale.active===false||sale.ativo===false){
      const reversedAt=firstDate(sale,['reversedAt','refundedAt','cancelledAt','canceledAt','deletedAt','updatedAt'])||new Date();
      return reverseSource(businessId,'sale',saleId,reversedAt);
    }
    if(!automation.enabled)return{skipped:'automation-disabled'};
    if(!automation.sales)return{skipped:'sales-disabled'};
    if(orderMatch&&!automation.onlineOrders)return{skipped:'online-orders-disabled'};
    if(!afterActivation(automation,occurredAt))return{skipped:'before-activation'};
    if(!amountCents)return{skipped:'zero-value'};
    if(CREDIT_SALE_STATUSES.has(status))return{skipped:'credit-sale-not-realized'};
    if(!PAID_SALE_STATUSES.has(status))return{skipped:'sale-not-paid'};
    const customerName=text(sale.clienteNome||sale.customerName)||'Venda avulsa';
    return createOnce({space,businessId,id:`sale_${saleId}`,sourceType:'sale_receipt',sourceId:saleId,amountCents,occurredAt,description:`Venda · ${customerName}`,paymentMethodId:paymentMethod(sale.formaPagamento||sale.paymentMethod),customerId:sale.clienteId||sale.clientId||sale.customerId,relatedSaleIds:[saleId],relatedOrderId:orderMatch?.[1]||null,eventKind:'sale_receipt_recorded'});
  }

  async function projectPayment(businessId,paymentId,payment={}){
    const linked=await linkedSpace(businessId,{requireEnabled:false});
    if(!linked)return{skipped:'space-not-linked'};
    const {space,automation}=linked,status=lower(payment.applicationStatus||payment.status),occurredAt=iso(firstDate(payment,['receivedAt','paidAt','data','createdAt'])),amountCents=cents(payment.effectiveAmount??payment.valor??payment.amount);
    if(INVALID_STATUSES.has(status)||payment.reversedAt||payment.cancelledAt){
      const reversedAmountCents=cents(payment.reversedAmount??payment.reversalAmount??payment.effectiveReversalAmount)||amountCents,
        reversalKey=text(payment.reversalOperationId||payment.reversedByOperationId||payment.cancelOperationId)||'full';
      return reverseSource(businessId,'customer_payment',paymentId,firstDate(payment,['reversedAt','cancelledAt','updatedAt'])||new Date(),reversedAmountCents,reversalKey);
    }
    if(!automation.enabled)return{skipped:'automation-disabled'};
    if(!automation.customerPayments)return{skipped:'customer-payments-disabled'};
    if(!afterActivation(automation,occurredAt))return{skipped:'before-activation'};
    if(!amountCents)return{skipped:'zero-value'};
    if(!APPLIED_PAYMENT_STATUSES.has(status)){
      const evidenceSnapshot=await balanceEventRef(businessId,paymentId).get();
      if(!paymentEvidenceMatches(evidenceSnapshot,paymentId,payment,amountCents)){
        if(evidenceSnapshot.exists)return{skipped:'payment-not-applied',evidence:'existing-evidence-mismatch'};
        const backfill=await backfillProcessedPaymentEvidence(businessId,paymentId,space,amountCents);
        if(!backfill.applied)return{skipped:'payment-not-applied',evidence:backfill.reason};
      }
    }
    const directSaleId=text(payment.saleId||payment.relatedSaleId||payment.sourceSaleId);
    if(directSaleId&&(await entryRef(space.id,`sale_${directSaleId}`).get()).exists)return{skipped:'sale-receipt-is-canonical'};
    const allocations=Array.isArray(payment.allocations)?payment.allocations:[],saleIds=allocations.map(item=>item?.saleId),customerName=text(payment.clienteNome||payment.customerName)||'Cliente';
    return createOnce({space,businessId,id:`credit_payment_${paymentId}`,sourceType:'customer_payment',sourceId:paymentId,amountCents,occurredAt,description:`Pagamento de ${customerName}`,paymentMethodId:paymentMethod(payment.paymentMethod||payment.formaPagamento||payment.observacao),customerId:payment.clienteId||payment.clientId||payment.customerId,relatedSaleIds:saleIds,legacyAmountCents:cents(payment.legacyAmount),allocatedAmountCents:cents(payment.allocatedAmount),eventKind:'customer_payment_recorded'});
  }

  async function reverseSource(businessId,sourceType,sourceId,when=new Date(),requestedAmountCents=0,reversalKey='full'){
    const linked=await linkedSpace(businessId,{requireEnabled:false});
    if(!linked)return{skipped:'automation-disabled'};
    const {space}=linked,originalId=sourceType==='sale'?`sale_${sourceId}`:`credit_payment_${sourceId}`,originalSnapshot=await entryRef(space.id,originalId).get();
    if(!originalSnapshot.exists)return{skipped:'original-missing'};
    const original=originalSnapshot.data(),amountCents=Math.min(Number(original.amountCents||0),Number(requestedAmountCents||original.amountCents||0)),occurredAt=iso(when)||new Date().toISOString();
    if(!amountCents)return{skipped:'zero-value'};
    const reversalType=sourceType==='sale'?'sale_reversal':'customer_payment_reversal',key=text(reversalKey).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80)||'full',reversalId=`reversal_${sourceType}_${sourceId}_${key}`;
    if(key==='full'&&(original.reversalStatus==='reversed'||original.reversedByEntryId||original.reversalEntryId))return{skipped:'already-reversed'};
    const result=await createOnce({space,businessId,id:reversalId,sourceType:reversalType,sourceId,amountCents,occurredAt,description:`Estorno · ${original.description||'Recebimento'}`,paymentMethodId:original.paymentMethod||'other',customerId:original.customerId,relatedSaleIds:original.relatedSaleIds||[],relatedOrderId:original.relatedOrderId,eventKind:'automatic_income_reversed',direction:'out',reversesEntryId:originalId,financialAccountId:original.financialAccountId||null,financialAccountHomeSpaceId:original.financialAccountHomeSpaceId||null});
    if(result.created)await entryRef(space.id,originalId).set({reversalStatus:'reversed',reversalEntryId:reversalId,reversedAt:timestamp(occurredAt),updatedAt:FieldValue.serverTimestamp()},{merge:true});
    return result;
  }

  async function reconcileBusiness(businessId,{limit=100}={}){
    const linked=await linkedSpace(businessId);
    if(!linked)return{skipped:'automation-disabled',checked:0,created:0};
    const activationIso=iso(linked.automation.activatedAt);
    if(!activationIso)return{skipped:'activation-missing',checked:0,created:0};
    const capped=Math.max(1,Math.min(200,Number(limit)||100)),business=db.collection('businesses').doc(businessId),results=[],sourceStates={};
    const countState=(kind,value)=>{
      const state=lower(value).replace(/[^a-z0-9_-]/g,'_').slice(0,48)||'missing',key=`${kind}:${state}`;
      sourceStates[key]=(sourceStates[key]||0)+1;
    };
    if(linked.automation.sales){
      const sales=await business.collection('sales').where('data','>=',activationIso).orderBy('data','asc').limit(capped).get();
      for(const snapshot of sales.docs){const value=snapshot.data();countState('sale',value.status||value.saleStatus);results.push(await projectSale(businessId,snapshot.id,value));}
    }
    if(linked.automation.customerPayments){
      const payments=await business.collection('payments').where('data','>=',activationIso).orderBy('data','asc').limit(capped).get();
      for(const snapshot of payments.docs){const value=snapshot.data();countState('payment',value.applicationStatus||value.status);results.push(await projectPayment(businessId,snapshot.id,value));}
    }
    const reasons=results.reduce((counts,result)=>{
      const reason=result?.created===true?'created':result?.skipped||'already-created';
      counts[reason]=(counts[reason]||0)+1;
      return counts;
    },{});
    return{checked:results.length,created:results.filter(result=>result?.created).length,skipped:results.filter(result=>result?.skipped).length,activation:activationIso,reasons,sourceStates};
  }

  return{linkedSpace,projectSale,projectPayment,reverseSource,reconcileBusiness,backfillProcessedPaymentEvidence};
}

module.exports={financialIncomeService,automationFor,paymentMethod,cents,signedCents,iso,entryIdentity};
