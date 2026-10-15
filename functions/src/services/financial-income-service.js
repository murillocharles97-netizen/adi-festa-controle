'use strict';

const {FieldValue,Timestamp}=require('firebase-admin/firestore');
const {createHash}=require('node:crypto');
const {projectInWorkspace}=require('./workspace-projection');

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
const isTerminalPaymentSale=sale=>lower(sale?.formaPagamento||sale?.paymentMethod)==='cartao_presencial'||sale?.paymentMetadata?.channel==='card_present';
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
const sourceSpaceId=source=>text(source?.spaceId);
const onlineOrderId=sale=>text(sale?.onlineOrderId||sale?.catalogOrderId)||text(sale?.operationId).match(/^(?:catalog-order|online-sale):(.+)$/)?.[1]||null;
function spaceRoutingIssue(businessId,source,space){
  const id=sourceSpaceId(source);
  if(!id||['all','all_spaces'].includes(id)||id.includes('/'))return'source-space-required';
  if(source.businessId&&text(source.businessId)!==text(businessId))return'source-business-mismatch';
  if(source.financialSpaceId&&text(source.financialSpaceId)!==id)return'source-space-conflict';
  if(!space||space.id!==id)return'space-not-found';
  if(space.active===false||(space.status&&space.status!=='active'))return'space-inactive';
  if(!text(space.ownerUid))return'space-owner-missing';
  const bindings=[space.businessId,space.linkedBusinessId].map(text).filter(Boolean);
  if(!bindings.length||bindings.some(value=>value!==text(businessId)))return'space-business-mismatch';
  const legacy=space.type==='business'&&text(space.linkedBusinessId)===text(businessId)&&!space.capabilities;
  if(!legacy&&space.capabilities?.finance!==true)return'finance-disabled';
  if(!legacy&&space.capabilities?.sales!==true)return'sales-disabled';
  return null;
}
const projectionFingerprint=source=>JSON.stringify([
  text(source.businessId),sourceSpaceId(source),text(source.financialSpaceId),source.workspaceGeneration??0,
  lower(source.status||source.saleStatus),lower(source.applicationStatus),
  cents(source.effectiveAmount??source.valorFinal??source.valorTotal??source.total??source.valor??source.amount),
  Boolean(source.deletedAt||source.reversedAt||source.cancelledAt||source.active===false||source.ativo===false),
  iso(firstDate(source,['paidAt','receivedAt','data','createdAt'])),onlineOrderId(source),
  text(source.formaPagamento||source.paymentMethod),isTerminalPaymentSale(source),
  cents(source.reversedAmount??source.reversalAmount??source.effectiveReversalAmount),
  text(source.reversalOperationId||source.reversedByOperationId||source.cancelOperationId),
  iso(firstDate(source,['reversedAt','refundedAt','cancelledAt','canceledAt','deletedAt'])),
]);
const saleIsPaid=source=>PAID_SALE_STATUSES.has(lower(source?.status||source?.saleStatus));
const paymentIsApplied=source=>APPLIED_PAYMENT_STATUSES.has(lower(source?.applicationStatus||source?.status));

function financialIncomeService(db){
  const entryRef=(spaceId,id)=>db.doc(`financialSpaces/${spaceId}/entries/${id}`);
  const eventRef=(spaceId,id)=>db.doc(`financialSpaces/${spaceId}/events/${id}`);
  const routeRef=(businessId,kind,id)=>db.doc(`businesses/${businessId}/financialIncomeRoutes/${createHash('sha256').update(`${kind}:${id}`).digest('hex')}`);
  const balanceEventRef=(businessId,paymentId)=>db.doc(`businesses/${businessId}/balanceEvents/payment_received:${paymentId}`);

  async function linkedSpace(businessId,source={}, {requireEnabled=true}={}){
    const id=sourceSpaceId(source);
    const issue=spaceRoutingIssue(businessId,source,{id});
    if(['source-space-required','source-business-mismatch','source-space-conflict'].includes(issue))return{skipped:issue};
    const ref=db.doc(`financialSpaces/${id}`),snapshot=await ref.get();
    const space=snapshot.exists?{...snapshot.data(),id:snapshot.id}:null;
    const skipped=spaceRoutingIssue(businessId,source,space);
    if(skipped)return{skipped};
    const automation=automationFor(space);
    if(requireEnabled&&!automation.enabled)return{skipped:'automation-disabled'};
    return{space,automation,ref};
  }
  const baseEntry=({space,businessId,id,sourceType,sourceId,amountCents,occurredAt,description,paymentMethodId,customerId=null,relatedSaleIds=[],relatedOrderId=null,direction='in',reversesEntryId=null,legacyAmountCents=0,allocatedAmountCents=0,financialAccountId=null,financialAccountHomeSpaceId=null})=>({
    id,
    financialSpaceId:space.id,
    sourceSpaceId:space.id,
    financialRoutingVersion:2,
    spaceType:space.type,
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
    financialAccountId:text(direction==='out'?financialAccountId:financialAccountId||space.automation?.defaultIncomeFinancialAccountId)||null,
    financialAccountHomeSpaceId:text(direction==='out'?financialAccountHomeSpaceId:financialAccountHomeSpaceId||space.automation?.defaultIncomeFinancialAccountHomeSpaceId)||null,
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

  async function createOnce({space,businessId,eventKind,source={},...input}){
    let value;
    const saleSource=input.sourceType.startsWith('sale_'),kind=saleSource?'sale':'customer_payment',reversal=input.direction==='out';
    const route=routeRef(businessId,kind,input.sourceId),sourceRef=db.doc(`businesses/${businessId}/${saleSource?'sales':'payments'}/${input.sourceId}`);
    // Read-only compatibility guard, NEVER a routing fallback. A historical
    // entry in the former global destination must not be copied or corrected.
    const legacySpaceId=`business_${businessId}`,originalId=saleSource?`sale_${input.sourceId}`:`credit_payment_${input.sourceId}`;
    const legacyRef=legacySpaceId!==space.id?entryRef(legacySpaceId,originalId):null;
    const ref=entryRef(space.id,input.id),event=eventRef(space.id,input.id);
    return projectInWorkspace(db,businessId,source,async transaction=>{
      const [spaceSnapshot,routeSnapshot,currentSource,existing,originalSnapshot,legacySnapshot,businessSnapshot]=await Promise.all([
        transaction.get(db.doc(`financialSpaces/${space.id}`)),transaction.get(route),transaction.get(sourceRef),transaction.get(ref),
        reversal?transaction.get(entryRef(space.id,originalId)):null,legacyRef?transaction.get(legacyRef):null,transaction.get(db.doc(`businesses/${businessId}`)),
      ]);
      const freshSpace=spaceSnapshot.exists?{...spaceSnapshot.data(),id:spaceSnapshot.id}:null,issue=spaceRoutingIssue(businessId,source,freshSpace);
      if(issue)return{skipped:issue};
      if(text(freshSpace.ownerUid)!==text(businessSnapshot.data()?.ownerId))return{skipped:'space-owner-mismatch'};
      if(routeSnapshot.exists&&routeSnapshot.data().financialSpaceId!==space.id)return{skipped:'source-route-conflict'};
      if(legacySnapshot?.exists)return{skipped:'historical-entry-in-other-space'};
      if(existing.exists)return{created:false,entry:{id:existing.id,...existing.data()}};
      if(!currentSource.exists&&!reversal)return{skipped:'source-missing'};
      if(currentSource.exists&&projectionFingerprint(currentSource.data())!==projectionFingerprint(source))return{skipped:'stale-source-event'};
      const automation=automationFor(freshSpace);
      if(!reversal){
        if(routeSnapshot.exists)return{skipped:'projection-receipt-without-entry'};
        if(!automation.enabled)return{skipped:'automation-disabled'};
        if(!(saleSource?automation.sales:automation.customerPayments))return{skipped:'income-kind-disabled'};
        if(saleSource&&onlineOrderId(source)&&!automation.onlineOrders)return{skipped:'online-orders-disabled'};
        if(!afterActivation(automation,input.occurredAt))return{skipped:'before-activation'};
      }
      let original=null,amountCents=input.amountCents;
      if(reversal){
        if(!originalSnapshot?.exists)return{skipped:'original-missing'};
        original=originalSnapshot.data();
        const already=Number(original.reversedAmountCents||(original.reversalStatus==='reversed'?original.amountCents:0));
        amountCents=Math.min(amountCents,Math.max(0,Number(original.amountCents||0)-already));
        if(!amountCents)return{skipped:'already-reversed'};
      }
      value={...baseEntry({space:freshSpace,businessId,...input,amountCents}),workspaceGeneration:source.workspaceGeneration??0};
      const accountHomeSpaceId=value.financialAccountId?text(value.financialAccountHomeSpaceId)||space.id:null,
        accountRef=value.financialAccountId?db.doc(`financialSpaces/${accountHomeSpaceId}/financialAccounts/${value.financialAccountId}`):null,
        accountSnapshot=accountRef?await transaction.get(accountRef):null,
        account=accountSnapshot?.exists?accountSnapshot.data():null;
      const mode=text(account?.accessMode)||'single_space',allowed=Array.isArray(account?.allowedFinancialSpaceIds)?account.allowedFinancialSpaceIds.map(text):[],defaultSpace=text(account?.defaultFinancialSpaceId)||accountHomeSpaceId,
        accountAllowed=account&&account.active!==false&&text(account.ownerUid)===text(freshSpace.ownerUid)&&(mode==='all_spaces'||(mode==='selected_spaces'&&allowed.includes(freshSpace.id))||(mode==='single_space'&&defaultSpace===freshSpace.id));
      if(reversal&&value.financialAccountId&&!accountAllowed)return{skipped:'original-account-requires-review'};
      if(!accountAllowed)value={...value,financialAccountId:null,financialAccountHomeSpaceId:null};
      else if(accountRef){
        value={...value,financialAccountHomeSpaceId:accountHomeSpaceId};
        const currentBalanceCents=Number.isInteger(account.currentBalanceCents)?account.currentBalanceCents:Number(account.initialBalanceCents||0),
          delta=(value.direction==='in'?1:-1)*Number(value.amountCents||0);
        transaction.update(accountRef,{currentBalanceCents:currentBalanceCents+delta,balanceUpdatedAt:value.occurredAt,lastBalanceOperationId:value.operationId,schemaVersion:Math.max(3,Number(account.schemaVersion||0)),updatedAt:FieldValue.serverTimestamp()});
      }
      transaction.create(ref,value);
      if(!routeSnapshot.exists)transaction.create(route,{businessId,sourceSpaceId:space.id,financialSpaceId:space.id,sourceType:kind,sourceId:input.sourceId,entryId:originalId,financialRoutingVersion:2,workspaceGeneration:source.workspaceGeneration??0,createdAt:FieldValue.serverTimestamp()});
      if(reversal){
        const reversedAmountCents=Number(original.reversedAmountCents||0)+amountCents;
        transaction.update(originalSnapshot.ref,{reversedAmountCents,reversalStatus:reversedAmountCents>=original.amountCents?'reversed':'partially_reversed',reversalEntryId:value.id,reversedAt:timestamp(value.occurredAt),updatedAt:FieldValue.serverTimestamp()});
      }
      transaction.create(event,{
        id:value.id,
        financialSpaceId:space.id,
        sourceSpaceId:space.id,
        financialRoutingVersion:2,
        linkedBusinessId:businessId,
        ownerUid:space.ownerUid,
        createdBy:'system',
        generatedBy:'firebase_function',
        operationId:value.id,
        idempotencyKey:value.idempotencyKey,
        schemaVersion:2,
        workspaceGeneration:source.workspaceGeneration??0,
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


  async function projectSale(businessId,saleId,sale={},options={}){
    const linked=await linkedSpace(businessId,sale,{requireEnabled:false});
    if(linked.skipped)return linked;
    const {space,automation}=linked,status=lower(sale.status||sale.saleStatus),occurredAt=iso(firstDate(sale,['paidAt','receivedAt','data','createdAt'])),amountCents=cents(sale.valorFinal??sale.valorTotal??sale.total??sale.amount);
    const orderId=onlineOrderId(sale);
    if(INVALID_STATUSES.has(status)||sale.deletedAt||sale.active===false||sale.ativo===false){
      const reversedAt=firstDate(sale,['reversedAt','refundedAt','cancelledAt','canceledAt','deletedAt','updatedAt'])||new Date();
      return reverseSource(businessId,'sale',saleId,reversedAt,0,'full',sale);
    }
    if(options.before&&saleIsPaid(options.before))return{skipped:'historical-source-update-requires-review'};
    if(!automation.enabled)return{skipped:'automation-disabled'};
    if(!automation.sales)return{skipped:'sales-disabled'};
    if(orderId&&!automation.onlineOrders)return{skipped:'online-orders-disabled'};
    if(!afterActivation(automation,occurredAt))return{skipped:'before-activation'};
    if(!amountCents)return{skipped:'zero-value'};
    if(CREDIT_SALE_STATUSES.has(status))return{skipped:'credit-sale-not-realized'};
    if(!PAID_SALE_STATUSES.has(status))return{skipped:'sale-not-paid'};
    if(isTerminalPaymentSale(sale))return{skipped:'terminal-payment-is-receivable'};
    const customerName=text(sale.clienteNome||sale.customerName)||'Venda avulsa';
    return createOnce({space,businessId,source:sale,id:`sale_${saleId}`,sourceType:'sale_receipt',sourceId:saleId,amountCents,occurredAt,description:`Venda · ${customerName}`,paymentMethodId:paymentMethod(sale.formaPagamento||sale.paymentMethod),customerId:sale.clienteId||sale.clientId||sale.customerId,relatedSaleIds:[saleId],relatedOrderId:orderId,eventKind:'sale_receipt_recorded'});
  }

  async function projectPayment(businessId,paymentId,payment={},options={}){
    const linked=await linkedSpace(businessId,payment,{requireEnabled:false});
    if(linked.skipped)return linked;
    const {space,automation}=linked,status=lower(payment.applicationStatus||payment.status),occurredAt=iso(firstDate(payment,['receivedAt','paidAt','data','createdAt'])),amountCents=cents(payment.effectiveAmount??payment.valor??payment.amount);
    if(INVALID_STATUSES.has(status)||payment.reversedAt||payment.cancelledAt){
      const reversedAmountCents=cents(payment.reversedAmount??payment.reversalAmount??payment.effectiveReversalAmount)||amountCents,
        reversalKey=text(payment.reversalOperationId||payment.reversedByOperationId||payment.cancelOperationId)||'full';
      return reverseSource(businessId,'customer_payment',paymentId,firstDate(payment,['reversedAt','cancelledAt','updatedAt'])||new Date(),reversedAmountCents,reversalKey,payment);
    }
    if(options.before&&paymentIsApplied(options.before))return{skipped:'historical-source-update-requires-review'};
    if(!automation.enabled)return{skipped:'automation-disabled'};
    if(!automation.customerPayments)return{skipped:'customer-payments-disabled'};
    if(!afterActivation(automation,occurredAt))return{skipped:'before-activation'};
    if(!amountCents)return{skipped:'zero-value'};
    if(!APPLIED_PAYMENT_STATUSES.has(status)){
      const evidenceSnapshot=await balanceEventRef(businessId,paymentId).get();
      if(!paymentEvidenceMatches(evidenceSnapshot,paymentId,payment,amountCents)){
        return{skipped:'payment-not-applied',evidence:evidenceSnapshot.exists?'existing-evidence-mismatch':'balance-evidence-missing'};
      }
    }
    const directSaleId=text(payment.saleId||payment.relatedSaleId||payment.sourceSaleId);
    if(directSaleId){
      const directSale=await db.doc(`businesses/${businessId}/sales/${directSaleId}`).get();
      if(directSale.exists&&saleIsPaid(directSale.data()))return{skipped:'sale-receipt-is-canonical'};
      if((await entryRef(space.id,`sale_${directSaleId}`).get()).exists)return{skipped:'sale-receipt-is-canonical'};
    }
    const allocations=Array.isArray(payment.allocations)?payment.allocations:[],saleIds=allocations.map(item=>item?.saleId),customerName=text(payment.clienteNome||payment.customerName)||'Cliente';
    return createOnce({space,businessId,source:payment,id:`credit_payment_${paymentId}`,sourceType:'customer_payment',sourceId:paymentId,amountCents,occurredAt,description:`Pagamento de ${customerName}`,paymentMethodId:paymentMethod(payment.paymentMethod||payment.formaPagamento||payment.observacao),customerId:payment.clienteId||payment.clientId||payment.customerId,relatedSaleIds:saleIds,legacyAmountCents:cents(payment.legacyAmount),allocatedAmountCents:cents(payment.allocatedAmount),eventKind:'customer_payment_recorded'});
  }

  async function reverseSource(businessId,sourceType,sourceId,when=new Date(),requestedAmountCents=0,reversalKey='full',source={}){
    const linked=await linkedSpace(businessId,source,{requireEnabled:false});
    if(linked.skipped)return linked;
    const {space}=linked,originalId=sourceType==='sale'?`sale_${sourceId}`:`credit_payment_${sourceId}`,originalSnapshot=await entryRef(space.id,originalId).get();
    if(!originalSnapshot.exists)return{skipped:'original-missing'};
    const original=originalSnapshot.data(),amountCents=Math.min(Number(original.amountCents||0),Number(requestedAmountCents||original.amountCents||0)),occurredAt=iso(when)||new Date().toISOString();
    if(!amountCents)return{skipped:'zero-value'};
    const reversalType=sourceType==='sale'?'sale_reversal':'customer_payment_reversal',key=text(reversalKey).replace(/[^A-Za-z0-9_-]/g,'_').slice(0,80)||'full',reversalId=`reversal_${sourceType}_${sourceId}_${key}`;
    return createOnce({space,businessId,source,id:reversalId,sourceType:reversalType,sourceId,amountCents,occurredAt,description:`Estorno · ${original.description||'Recebimento'}`,paymentMethodId:original.paymentMethod||'other',customerId:original.customerId,relatedSaleIds:original.relatedSaleIds||[],relatedOrderId:original.relatedOrderId,eventKind:'automatic_income_reversed',direction:'out',reversesEntryId:originalId,financialAccountId:original.financialAccountId||null,financialAccountHomeSpaceId:original.financialAccountHomeSpaceId||null});
  }

  async function reconcileBusiness(){
    // Opening Financeiro is NOT authorization to backfill old financial data.
    // Live Firestore triggers remain retryable and idempotent. Historical repair
    // requires a separate, explicitly approved audit/repair workflow.
    return{skipped:'historical-reconciliation-requires-authorization',checked:0,created:0};
  }

  return{linkedSpace,projectSale,projectPayment,reverseSource,reconcileBusiness};
}

module.exports={financialIncomeService,automationFor,paymentMethod,cents,signedCents,iso,entryIdentity,isTerminalPaymentSale,spaceRoutingIssue,onlineOrderId};
