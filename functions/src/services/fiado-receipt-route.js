'use strict';

const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const Account=require('../shared/fiado-account');
const History=require('../shared/fiado-history-account');
const {prove,provenNeutralReconciliation}=require('../shared/fiado-history-proof');
const Plan=require('../shared/installment-plan');
const {restricted}=require('../shared/operational-privacy-policy');
const {readHistoryInput}=require('./fiado-history-service');
const Opening=require('../shared/fiado-opening-balance');
const CustomerAccount=require('../shared/customer-account');
const Ledger=require('../shared/customer-account-ledger');
const {Filter}=require('firebase-admin/firestore');
// Fase 4c — false: every receipt goes back to the full history route below.
const ACCOUNT_RECEIPT_ENABLED=true;
const RECEIPT_PROOF_VERSION=2;

function modernQuote(scope,uid,mode,bookBalanceCents,account,cutoff){
  const {financialVersion,version,asOf,dueCents,futureCents,totalCents,entries}=account;
  return hash(['fiado-receipt-proof',RECEIPT_PROOF_VERSION,scope,uid,mode,bookBalanceCents,
    financialVersion,version,asOf,dueCents,futureCents,totalCents,cutoff,
    entries.map(row=>[row.spaceId,row.saleId,row.historyEventId,row.number,row.dueDate,row.remainingCents])]);
}
const proofCutoff=client=>client.fiadoOpeningBalance?.hash||
  (client.fiadoHistoryActivation?.originLinksDigest?client.fiadoHistoryActivation.reviewHash:null)||null;

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
       !owns(marker,businessId,generation)||marker.status!=='processed'||(marker.eventKind!==expectedKind&&!(reversal&&marker.eventKind==='sale_cancel'))||sourceSpace!==eventSpace)return 'history_review';
    if(event.type==='payment_received'&&(pending(source)||closed(source)||money(event.balanceDelta)!==money(source.valor??source.amount)))return 'history_review';
    operationIds.add(sourceOperation);
    eventsBySource.set(event.type+':'+source.id,event);
  }
  for(const payment of payments){
    if(Opening.prior(opening,'payments',payment.id))continue;
    if(!closed(payment)&&!eventsBySource.has('payment_received:'+payment.id)||
       payment.status==='confirmed'&&closed(payment)&&!operationIds.has(payment.resolutionOperationId))return 'history_review';
  }
  // Same exception as the account proof: only a proven neutral reconciliation may lack an effect.
  if(balanceAdjustments.some(row=>!Opening.prior(opening,'balanceAdjustments',row.id)&&!eventsBySource.has('balance_adjustment:'+row.id)&&
    !provenNeutralReconciliation(row,{markers,events:balanceEvents,businessId,generation})))return 'history_review';

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

// Fase 4c — what this route checks in a proven history, recorded with each verification
// of the per-Space account (customer-account-service), so a later receipt can rely on
// the account without reading the history again.
function receiptFacts(input,projection,day){
  const sales=input.collections.sales.filter(row=>active(row)&&row.formaPagamento==='fiado'),client=input.client;
  const scheduled=client.hasInstallmentFiado===true||client.fiadoHistoryVersion===1||sales.some(row=>row.installmentPlan);
  let receiptRisk;
  try{receiptRisk=checkEvidence(input,day,scheduled);}catch{receiptRisk='history_review';}
  // Etapa 1: the open items of each Space, in the order the history consumes them, so a
  // receipt through the account allocates to the same sales as the full route.
  const items=(projection?.entries||[]).map(e=>({saleId:e.saleId||null,number:Number.isInteger(e.number)?e.number:null,
    historyEventId:e.historyEventId||null,dueDate:e.dueDate,createdAt:String(e.createdAt||''),remainingCents:e.remainingCents,spaceId:e.spaceId||null}));
  return {receiptRisk,hasInstallments:Boolean(projection?.hasInstallments)||sales.some(row=>row.installmentPlan),
    futureCents:projection?.futureCents??null,receiptCheckedOn:day,items};
}

// Rows the history check would stop on that may appear without a new financial version:
// receipts and sales still pending, in conflict or under review, under any client field.
const PENDING_STATUS=['pending','pending_sync','conflict','error','adjustment_required','not_applied','manual_review','quarantined','rejected','failed'];
const PENDING_APPLICATION=['pending','not_applied','conflict','adjustment_required'];
async function pendingRows(tx,c,ref,clientId){
  const checks=[];
  for(const col of ['payments','sales'])for(const field of ['clienteId','clientId','customerId'])
    checks.push(tx.get(ref(c.bid,col,'__none__').parent.where(field,'==',clientId)
      .where(Filter.or(Filter.where('status','in',PENDING_STATUS),Filter.where('applicationStatus','in',PENDING_APPLICATION))).limit(1)));
  return (await Promise.all(checks)).some(snapshot=>!snapshot.empty);
}

// Fase 4c — the receipt from the per-Space account, without rebuilding the history.
// Only for Space-scoped accounts (confirmed opening, regularization or activation), with or
// without installments (Etapa 3), and only when the account's last verification proved it equal to the
// history, Space by Space, at the client's current financial version, with this route's
// evidence checks clear. Then the full route would return these same open items of the
// Space, all due, so the receipt allocates to the same sales (Etapa 1). Anything else
// returns null and the full route decides, as before.
async function accountRoute({tx,c,ref,client,clientId,spaceId,day,scope,generation,bookBalanceCents,version,includeAccount}){
  const scoped=client.fiadoOpeningBalance?.version===1||client.fiadoHistoryActivation?.spaceRegularization?.version===1;
  if(!ACCOUNT_RECEIPT_ENABLED||!scoped||client.fiadoHistoryVersion!==1||bookBalanceCents>=0)return null;
  const stored=(await tx.get(ref(c.bid,'customerAccounts',clientId))).data(),check=stored?.verification,debt=stored?.spaces?.[spaceId];
  if(!stored||stored.schemaVersion!==CustomerAccount.SCHEMA_VERSION||stored.workspaceGeneration!==generation||stored.clientId!==clientId||
     !CustomerAccount.PUBLISHED.has(stored.status)||!stored.baseline||stored.unattributedCents!==0||stored.debtCents!==-bookBalanceCents||
     !Number.isSafeInteger(debt)||debt<=0||check?.receiptRisk)return null;
  // Etapa 5: the account kept in the same transaction as every operation, current with the client;
  // otherwise the last verification, if it proved this very version.
  const ledger=stored.ledgerVersion===Ledger.LEDGER_VERSION&&stored.ledger&&stored.clientFinancialVersion===version?stored.ledger:null;
  const verified=check?.status==='match'&&check.scoped===true&&check.financialVersion===version&&check.receiptRisk===null&&typeof check.hasInstallments==='boolean';
  if(!ledger&&!verified)return null;
  // Same fence as the full route: an installment flag without any installment sale is reviewed.
  const anyPlan=ledger?Object.values(ledger.plans||{}).some(p=>p.active):check.hasInstallments===true;
  if(client.hasInstallmentFiado===true&&!anyPlan&&!client.fiadoOpeningBalance)return null;
  // The items proven by the verification: they must add up to the Space debt. Installments
  // (Etapa 3) keep their due dates and amounts; anything else is already due.
  const entries=(ledger?Ledger.entries(ledger,day):Array.isArray(check.items)?check.items:[]).filter(e=>e.spaceId===spaceId).map(e=>({...e}));
  if(!entries.length||entries.reduce((n,e)=>n+e.remainingCents,0)!==debt||
     entries.some(e=>!Number.isSafeInteger(e.remainingCents)||e.remainingCents<=0||!/^\d{4}-\d{2}-\d{2}$/.test(e.dueDate||'')||
       e.number!==null&&(!Number.isInteger(e.number)||!e.saleId)||e.number===null&&!(e.dueDate<=day)))return null;
  const dueCents=entries.filter(e=>e.dueDate<=day).reduce((n,e)=>n+e.remainingCents,0),futureCents=debt-dueCents;
  const hasInstallments=entries.some(e=>Number.isInteger(e.number));
  try{
    if(await pendingRows(tx,c,ref,clientId))return null;
  }catch(error){
    // If the optional indexed probe is not ready, the original history check still decides.
    if(error.code===9||error.code==='failed-precondition')return null;
    throw error;
  }
  const account={version:2,historyProofVersion:1,clientId,asOf:day,financialVersion:version,dueCents,futureCents,totalCents:debt,creditCents:0,
    hasInstallments,entries,scopedReceiptVersion:1,source:'customer_account'};
  const quoteHash=modernQuote(scope,c.uid,'space',bookBalanceCents,account,proofCutoff(client));
  return {...scope,mode:'space',quoteHash,financialVersion:version,asOf:day,dueCents,futureCents,totalCents:debt,
    scopedReceiptVersion:1,receiptProofVersion:RECEIPT_PROOF_VERSION,scopedAccount:account,source:'customer_account',...(includeAccount?{bookBalanceCents,account}:{})};
}

async function decideReceiptRoute({tx,c,ref,clientId,spaceId,now,includeAccount=false,scopedReceiptVersion,forConfirmation=false,useAccount=false,receiptProofVersion=1}){
  const generation=c.business.workspaceGeneration??0;
  const scope={receiptRouteVersion:1,businessId:c.bid,workspaceGeneration:generation,clientId,spaceId};
  const owner=c.owner&&c.business.ownerId===c.uid;
  const blocked=reason=>({...scope,mode:'blocked',reason:owner||['access_unavailable','space_unavailable'].includes(reason)?reason:'origin_unverified'});
  if(![1,RECEIPT_PROOF_VERSION].includes(receiptProofVersion))return blocked('history_review');
  const modern=receiptProofVersion===RECEIPT_PROOF_VERSION;
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
    if(modern&&useAccount&&!forConfirmation&&scopedReceiptVersion===1){
      const fromAccount=await accountRoute({tx,c,ref,client,clientId,spaceId,day,scope,generation,bookBalanceCents,version,includeAccount});
      if(fromAccount)return fromAccount;
    }
    // Read evidence internally. Only the result for the authorized route leaves the server.
    const input=await readHistoryInput({tx,c,ref,clientId,client,checkRowAccess:false});
    if(input.opening&&!forConfirmation&&scopedReceiptVersion!==1)return blocked('history_review');
    const sales=input.collections.sales.filter(row=>active(row)&&row.formaPagamento==='fiado');
    const scheduled=client.hasInstallmentFiado===true||client.fiadoHistoryVersion===1||sales.some(row=>row.installmentPlan);
    if(!input.opening&&scheduled&&client.hasInstallmentFiado===true&&!input.collections.sales.some(row=>row.installmentPlan))return blocked('history_review');
    const risk=checkEvidence(input,day,scheduled);
    if(risk)return blocked(risk);
    if(bookBalanceCents>=0&&!forConfirmation)return blocked('no_debt');

    // Keep the traditional writer's source and allocation contract. V2 is only
    // used when its existing proof and receipt contract both apply.
    if(client.fiadoHistoryVersion===1){
      account=History.project(input,day,{legacyReceipt:!modern&&!forConfirmation});
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
      if(account.version===2)account=History.project(input,day,{scoped:true,legacyReceipt:!modern&&!forConfirmation});
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
    }else if(owner&&!scheduled&&!account.futureCents&&account.dueCents===account.totalCents){
      // Unknown origin stays unknown. This route never attributes the debt to the active space.
      // Unchanged pre-cutoff contract for accounts without a confirmed opening.
      if(origins.length){
        try{const origin=await c.space(origins[0]);if(!salesSpace(origin))return blocked('space_unavailable');}
        catch(error){if(error.code==='permission-denied')return blocked('space_unavailable');throw error;}
      }
      mode='original';
    }else return blocked('origin_unverified');

    const {asOf,dueCents,futureCents,totalCents}=account;
    const quoteHash=modern?modernQuote(scope,c.uid,mode,bookBalanceCents,account,proofCutoff(client)):hash([scope,c.uid,mode,scoped?null:bookBalanceCents,version,account.version,asOf,dueCents,futureCents,totalCents,
      account.entries.map(row=>[row.spaceId,row.saleId,row.historyEventId,row.number,row.dueDate,row.remainingCents]),
      ...(input.opening?[input.opening.hash]:scoped&&client.fiadoHistoryActivation?.originLinksDigest?[client.fiadoHistoryActivation.reviewHash]:[])]);
    return {...scope,mode,quoteHash,financialVersion:version,asOf,dueCents,futureCents,totalCents,
      ...(modern?{receiptProofVersion:RECEIPT_PROOF_VERSION}:{}),
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
     intent.receiptProofVersion!==undefined&&intent.receiptProofVersion!==RECEIPT_PROOF_VERSION||
     !['space','original'].includes(intent.mode)||intent.scopedReceiptVersion!==undefined&&intent.scopedReceiptVersion!==1||!/^[a-f0-9]{64}$/.test(intent.quoteHash||'')||
     typeof intent.spaceId!=='string'||typeof payment.clienteId!=='string'||
     payment.clientId!==payment.clienteId||payment.installmentSaleId||payment.confirmedConflictId||
     !payment.spaceId||payment.financialSpaceId!==payment.spaceId||
     !Number.isFinite(payment.expectedBalance)||!Number.isFinite(payment.valor))return invalid();
  const route=useAccount=>decideReceiptRoute({tx,c,ref,now,clientId:payment.clienteId,spaceId:intent.spaceId,includeAccount:true,scopedReceiptVersion:intent.scopedReceiptVersion,receiptProofVersion:intent.receiptProofVersion,useAccount});
  // Revalidate the negotiated proof, using history if the projection no longer matches.
  let result=await route(true);
  if(result.source==='customer_account'&&result.quoteHash!==intent.quoteHash)result=await route(false);
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

module.exports={decideReceiptRoute,assertReceiptRoute,receiptFacts,pendingRows,ACCOUNT_RECEIPT_ENABLED,RECEIPT_PROOF_VERSION};
