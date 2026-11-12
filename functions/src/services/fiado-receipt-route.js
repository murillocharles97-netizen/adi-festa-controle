'use strict';

const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const Account=require('../shared/fiado-account');
const History=require('../shared/fiado-history-account');
const {prove}=require('../shared/fiado-history-proof');
const Plan=require('../shared/installment-plan');
const {restricted}=require('../shared/operational-privacy-policy');
const {readHistoryInput}=require('./fiado-history-service');
const Opening=require('../shared/fiado-opening-balance');

const active=row=>row.active!==false&&!row.deletedAt&&!row.cancelledAt&&!row.desfeita;
const owns=(row,bid,generation)=>row&&(!row.businessId||row.businessId===bid)&&(row.workspaceGeneration??0)===generation;
const money=value=>{
  if(typeof value!=='number')throw Error('Valor sem prova em centavos.');
  const amount=Plan.cents(Math.abs(value));
  return value<0?-amount:amount;
};
const salesSpace=space=>space.status!=='archived'&&
  (space.capabilities?.sales===undefined?
    ['business','unit','operation'].includes(space.legacyFinancialType||space.financialType||space.type):
    space.capabilities.sales===true);
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const pending=row=>['pending','pending_sync','conflict','error','adjustment_required','not_applied','manual_review','quarantined'].includes(row.status)||
  ['pending','not_applied','conflict','adjustment_required'].includes(row.applicationStatus);
const origin=row=>row.spaceId||row.financialSpaceId||null;
const closed=row=>!row.financialAppliedAt&&(['cancelled','superseded'].includes(row.status)||
  row.status==='confirmed'&&row.applicationStatus==='superseded_by_confirmation'&&!!row.resolutionOperationId);

function checkEvidence({businessId,generation,client,collections,opening},day,scheduled){
  const {sales,payments,balanceAdjustments,balanceEvents,paymentAllocations,processedOperations}=collections;
 if(payments.some(opening?Opening.pending:pending))return 'pending_payment';
 const checked=['sales','payments','balanceAdjustments','balanceEvents','paymentAllocations'];
 for(const name of checked)if(collections[name].some(row=>!owns(row,businessId,generation)||
    [row.clienteId,row.clientId,row.customerId].filter(Boolean).some(id=>id!==client.id)||
    !Opening.prior(opening,name,row.id)&&row.spaceId&&row.financialSpaceId&&row.spaceId!==row.financialSpaceId))return 'history_review';
  const sources={sales:new Map(sales.map(row=>[row.id,row])),payments:new Map(payments.map(row=>[row.id,row])),
    balanceAdjustments:new Map(balanceAdjustments.map(row=>[row.id,row]))};
  const markers=new Map(processedOperations.map(row=>[row.id,row]));
  const eventsBySource=new Map(),operationIds=new Set();
  for(const event of balanceEvents){
    if(Opening.prior(opening,'balanceEvents',event.id))continue;
    const source=sources[event.sourceCollection]?.get(event.sourceDocumentId);
    const reversal=event.type==='credit_sale_reversal';
    const sourceOperation=reversal?source?.cancelOperationId:source?.operationId;
    const marker=markers.get(event.operationId);
    const expectedCollection={credit_sale:'sales',credit_sale_reversal:'sales',payment_received:'payments',balance_adjustment:'balanceAdjustments'}[event.type];
    const expectedKind={credit_sale:'sale',credit_sale_reversal:'sale_undo',payment_received:'payment',balance_adjustment:'balance_adjustment'}[event.type];
    const sourceAt=reversal?source?.financialReversedAt:source?.financialAppliedAt;
    const sourceSpace=source?.spaceId||source?.financialSpaceId||null,eventSpace=event.spaceId||event.financialSpaceId||null;
    if(!expectedCollection||event.sourceCollection!==expectedCollection||!source||!sourceOperation||
       sourceOperation!==event.operationId||event.id!==event.type+':'+source.id||operationIds.has(sourceOperation)||
       event.status!=='applied'||!Number.isFinite(Date.parse(sourceAt))||Date.parse(sourceAt)!==Date.parse(event.appliedAt)||
       !owns(marker,businessId,generation)||marker.status!=='processed'||marker.eventKind!==expectedKind||sourceSpace!==eventSpace)return 'history_review';
    if(event.type==='payment_received'&&(pending(source)||closed(source)||money(event.balanceDelta)!==money(source.valor??source.amount)))return 'history_review';
    operationIds.add(sourceOperation);
    eventsBySource.set(event.type+':'+source.id,event);
  }
  for(const payment of payments){
    if(Opening.prior(opening,'payments',payment.id))continue;
    if(!closed(payment)&&!eventsBySource.has('payment_received:'+payment.id)||
       payment.status==='confirmed'&&closed(payment)&&!operationIds.has(payment.resolutionOperationId))return 'history_review';
  }
  if(balanceAdjustments.some(row=>!Opening.prior(opening,'balanceAdjustments',row.id)&&!eventsBySource.has('balance_adjustment:'+row.id)))return 'history_review';

  const byPayment=new Map(),bySale=new Map();
  for(const row of paymentAllocations){
    if(Opening.prior(opening,'paymentAllocations',row.id))continue;
    if(!sources.sales.has(row.saleId)||!eventsBySource.has('payment_received:'+row.paymentId)||
       Opening.prior(opening,'sales',row.saleId)&&!sources.sales.get(row.saleId).installmentPlan||
       row.id!==row.paymentId+'__'+row.saleId||money(row.amount)<=0)return 'history_review';
    byPayment.set(row.paymentId,(byPayment.get(row.paymentId)||0)+money(row.amount));
    bySale.set(row.saleId,(bySale.get(row.saleId)||0)+money(row.amount));
  }
  for(const payment of payments){
    if(Opening.prior(opening,'payments',payment.id))continue;
    const allocated=byPayment.get(payment.id)||0;
    if(closed(payment))continue;
    if(allocated>money(payment.valor??payment.amount)||
      payment.allocatedAmount!==undefined&&allocated!==money(payment.allocatedAmount)||
      payment.legacyAmount!==undefined&&allocated+money(payment.legacyAmount)!==money(payment.valor??payment.amount))return 'history_review';
  }
  for(const sale of sales.filter(row=>active(row)&&row.formaPagamento==='fiado')){
    if(Opening.prior(opening,'sales',sale.id))continue;
    const paid=money(sale.creditPaidAmount??0),remaining=money(sale.creditOriginalAmount??sale.valorFinal??sale.valorTotal)-paid;
    if(pending(sale)||paid<0||paid!==(bySale.get(sale.id)||0)||remaining<0||
       sale.creditRemainingAmount!==undefined&&remaining!==money(sale.creditRemainingAmount)||
       sale.creditSettled===true&&remaining!==0||
       (sale.financialAppliedAt||sale.financialOperationId)&&!eventsBySource.has('credit_sale:'+sale.id)||
       !scheduled&&Account.commercialDay(sale)>day)return 'history_review';
  }
  return null;
}

async function decideReceiptRoute({tx,c,ref,clientId,spaceId,now,includeAccount=false,scopedReceiptVersion,forConfirmation=false}){
  const generation=c.business.workspaceGeneration??0;
  const scope={receiptRouteVersion:1,businessId:c.bid,workspaceGeneration:generation,clientId,spaceId};
  const owner=c.owner&&c.business.ownerId===c.uid;
  const blocked=reason=>({...scope,mode:'blocked',reason:owner||['access_unavailable','space_unavailable'].includes(reason)?reason:'origin_unverified'});
  if(!c.has('customers.view')||!c.has('customers.receiveDebt')||restricted(c.member)||!forConfirmation&&!c.access.canMutate)
    return blocked('access_unavailable');
  const currentSpace=await c.space(spaceId);
  if(!salesSpace(currentSpace)||currentSpace.workspaceGeneration!==undefined&&currentSpace.workspaceGeneration!==generation)return blocked('space_unavailable');
  const client=(await tx.get(ref(c.bid,'clients',clientId))).data();
  if(!owns(client,c.bid,generation)||!active(client)||client.ativo===false)return blocked('account_unavailable');

  let account,bookBalanceCents,version,mode;
  try{
    bookBalanceCents=money(client.saldo);
    version=client.financialVersion??0;
    if(!Number.isSafeInteger(version)||version<0)return blocked('history_review');
    const day=Plan.today(now);
    // Read evidence internally. Only the result for the authorized route leaves the server.
    const input=await readHistoryInput({tx,c,ref,clientId,client,checkRowAccess:false});
    if(input.opening&&!forConfirmation&&scopedReceiptVersion!==1)return blocked('history_review');
    const sales=input.collections.sales.filter(row=>active(row)&&row.formaPagamento==='fiado');
    const scheduled=client.hasInstallmentFiado===true||client.fiadoHistoryVersion===1||sales.some(row=>row.installmentPlan);
    if(scheduled&&client.hasInstallmentFiado===true&&!input.collections.sales.some(row=>row.installmentPlan))return blocked('history_review');
    const risk=checkEvidence(input,day,scheduled);
    if(risk)return blocked(risk);
    if(bookBalanceCents>=0&&!forConfirmation)return blocked('no_debt');

    // Keep the traditional writer's source and allocation contract. V2 is only
    // used when its existing proof and receipt contract both apply.
    if(client.fiadoHistoryVersion===1){
      account=History.project(input,day);
    }else{
      if(sales.some(row=>row.clienteId!==clientId||!['fiado','applied'].includes(row.status||'fiado')||
        !row.spaceId&&row.financialSpaceId))return blocked('history_review');
      if(input.collections.balanceEvents.length){
        const proof=prove(input,day,scheduled?{}:{checkTraditionalChain:true});
        if(scheduled?!proof.financialProof:!proof.traditionalChainVerified)return blocked('history_review');
      }else if(scheduled)return blocked('history_review');
      account=Account.project(input.client,sales,day);
    }
    if(account.totalCents!==-bookBalanceCents||account.financialVersion!==version||account.creditCents!==0)return blocked('history_review');
    const origins=[...new Set(account.entries.map(row=>row.spaceId).filter(Boolean))].sort();
    const hasUnknown=account.entries.some(row=>!row.spaceId);
    const scoped=!hasUnknown&&(forConfirmation||scopedReceiptVersion===1&&origins.length>0&&
      (origins.length>1||account.version===2));
    if(forConfirmation&&!scoped)return blocked('origin_unverified');
    if(origins.length>1&&!scoped)return blocked('mixed_origins');
    if(scoped){
      if(account.version===2)account=History.project(input,day,{scoped:true});
      else{
        const saleOrigins=new Map(input.collections.sales.map(s=>[s.id,origin(s)]));
        const paymentOrigins=new Map(input.collections.payments.map(p=>[p.id,origin(p)]));
        if(input.collections.paymentAllocations.some(a=>!saleOrigins.get(a.saleId)||
          saleOrigins.get(a.saleId)!==paymentOrigins.get(a.paymentId)||origin(a)&&origin(a)!==saleOrigins.get(a.saleId))||
          input.collections.payments.some(p=>!closed(p)&&p.legacyAmount>0))return blocked('history_review');
      }
      if(account.entries.some(row=>!row.spaceId))return blocked('origin_unverified');
      const entries=account.entries.filter(row=>row.spaceId===spaceId);
      if(!entries.length&&!forConfirmation)return blocked('other_space');
      const dueCents=entries.filter(row=>row.dueDate<=day).reduce((sum,row)=>sum+row.remainingCents,0);
      const totalCents=entries.reduce((sum,row)=>sum+row.remainingCents,0);
      account={...account,entries,dueCents,totalCents,futureCents:totalCents-dueCents,
        hasInstallments:entries.some(row=>Number.isInteger(row.number)),scopedReceiptVersion:1};
      mode='space';
    }else if(origins.length===1&&!hasUnknown){
      if(origins[0]!==spaceId)return blocked('other_space');
      mode='space';
    }else if(owner&&!origins.length&&!scheduled&&!account.futureCents&&account.dueCents===account.totalCents){
      // Unknown origin stays unknown. This route never attributes the debt to the active space.
      mode='original';
    }else return blocked('origin_unverified');

    const {asOf,dueCents,futureCents,totalCents}=account;
    const quoteHash=hash([scope,c.uid,mode,scoped?null:bookBalanceCents,version,account.version,asOf,dueCents,futureCents,totalCents,
      account.entries.map(row=>[row.spaceId,row.saleId,row.historyEventId,row.number,row.dueDate,row.remainingCents]),
      ...(input.opening?[input.opening.hash]:scoped&&client.fiadoHistoryActivation?.originLinksDigest?[client.fiadoHistoryActivation.reviewHash]:[])]);
    return {...scope,mode,quoteHash,financialVersion:version,asOf,dueCents,futureCents,totalCents,
      ...(scoped?{scopedReceiptVersion:1,scopedAccount:account}:{}),
      ...(!scoped||includeAccount?{bookBalanceCents}:{}),
      ...(mode==='original'?{origins,hasUnknown}:{}),...(includeAccount?{account}:{})};
  }catch(error){
    // Preserve service/transport errors; a failed read is never a routing decision.
    if(error instanceof HttpsError&&error.code==='failed-precondition')return blocked('history_review');
    if(error.code||!(error instanceof Error))throw error;
    return blocked('history_review');
  }
}

async function assertReceiptRoute({intent,payment,writes,tx,c,ref,now}){
  const invalid=()=>{throw new HttpsError('failed-precondition','A conta ou a origem do recebimento mudou. Confira a operaÃ§Ã£o original na SincronizaÃ§Ã£o antes de receber novamente.',{reason:'fiado-receipt-route-changed'});};
  if(!payment||!intent||typeof intent!=='object'||intent.version!==1||
     !['space','original'].includes(intent.mode)||intent.scopedReceiptVersion!==undefined&&intent.scopedReceiptVersion!==1||!/^[a-f0-9]{64}$/.test(intent.quoteHash||'')||
     typeof intent.spaceId!=='string'||typeof payment.clienteId!=='string'||
     payment.clientId!==payment.clienteId||payment.installmentSaleId||payment.confirmedConflictId||
     !payment.spaceId||payment.financialSpaceId!==payment.spaceId||
     !Number.isFinite(payment.expectedBalance)||!Number.isFinite(payment.valor))return invalid();
  const result=await decideReceiptRoute({tx,c,ref,now,clientId:payment.clienteId,spaceId:intent.spaceId,includeAccount:true,scopedReceiptVersion:intent.scopedReceiptVersion});
  if(result.scopedReceiptVersion!==intent.scopedReceiptVersion||result.mode!==intent.mode||result.quoteHash!==intent.quoteHash||payment.expectedFinancialVersion!==result.financialVersion||
     money(payment.expectedBalance)!==result.bookBalanceCents||result.mode==='space'&&payment.spaceId!==result.spaceId||
     result.mode==='original'&&payment.fiadoSchedule)return invalid();
  if(result.scopedReceiptVersion===1){
    const allowed={clients:'update',sales:'update',payments:'create',paymentAllocations:'create',campaignEvents:'create',campaignProgress:null};
    if(!payment.fiadoSchedule||payment.fiadoSchedule.version!==result.account.version||payment.fiadoSchedule.asOf!==result.asOf||
       writes.some(w=>!Object.hasOwn(allowed,w.entityType)||allowed[w.entityType]&&allowed[w.entityType]!==w.operation||
         w.entityType==='clients'&&w.entityId!==payment.clienteId||
         ['spaceId','financialSpaceId'].some(key=>w.data[key]&&w.data[key]!==result.spaceId)))return invalid();
  }
  const amount=money(payment.valor),max=payment.fiadoSchedule?.advance===true?result.totalCents:result.dueCents;
  if(amount<=0||amount>max)return invalid();
  const allocations=writes.filter(w=>w.entityType==='paymentAllocations');
  const openSales=new Map();
  for(const row of result.account.entries){
    if(row.saleId)openSales.set(row.saleId,(openSales.get(row.saleId)||0)+row.remainingCents);
  }
  let allocated=0;
  for(const {data} of allocations){
    const value=money(data.amount);
    if(value<=0||value>(openSales.get(data.saleId)||0))return invalid();
    openSales.set(data.saleId,openSales.get(data.saleId)-value);
    allocated+=value;
  }
  if(allocated+money(payment.legacyAmount)!==amount||allocated!==money(payment.allocatedAmount))return invalid();
  const cash=await c.space(payment.spaceId);
  if(!salesSpace(cash))return invalid();
  return result.scopedReceiptVersion===1?result.account:null;
}

module.exports={decideReceiptRoute,assertReceiptRoute};
