'use strict';
// Read-only proof. This does not repair projections or authorize a commercial write.
const Account=require('./fiado-account');
const Plan=require('./installment-plan');
const cents=value=>{if(typeof value!=='number'||!Number.isFinite(value))throw Error('invalid-money');const n=Math.round(value*100);if(!Number.isSafeInteger(n)||Math.abs(value*100-n)>0.00001)throw Error('non-cent-snapshot');return n;};
const clientId=r=>r.clienteId||r.clientId||r.customerId;
const time=value=>{const ms=Date.parse(value);if(!Number.isFinite(ms))throw Error('invalid-application-time');return ms;};
function prove(input,day=Plan.today(),{checkTraditionalChain=false}={}){
 const {client,businessId,generation=0,collections,complete,stable}=input;
 const reasons=[],issues=[];let strict=null,strictError=null,firstPlan=null,firstPlanError=null;
 const own=r=>[r.clienteId,r.clientId,r.customerId].includes(client.id);
 const sales=collections.sales.filter(own),payments=collections.payments.filter(own),adjustments=collections.balanceAdjustments.filter(own),events=collections.balanceEvents.filter(own);
 try{strict=Account.project(client,sales,day);}catch(e){strictError=e.message;}
 try{firstPlan=Account.project(client.legacyBalance===undefined?{...client,legacyBalanceRemaining:Math.abs(Math.min(0,Number(client.saldo||0)))}:client,sales,day);}catch(e){firstPlanError=e.message;}
 const result={clientId:client.id,strictEligible:!!strict,strictError,firstPlanCompatible:!!firstPlan,firstPlanError,financialProof:false,backendCompatible:false,currentBackendEligible:false};
 try{
  if(!complete||!stable)throw Error('incomplete-or-unstable-snapshot');
  for(const row of [...sales,...payments,...adjustments,...events])if([row.clienteId,row.clientId,row.customerId].filter(Boolean).some(id=>id!==client.id))throw Error('contradictory-client-scope');
  for(const name of ['sales','payments','balanceAdjustments','balanceEvents','paymentAllocations','processedOperations']){
   if(new Set(collections[name].map(row=>row.id)).size!==collections[name].length)throw Error('duplicate-document-identity');
  }
  if(client.businessId&&client.businessId!==businessId||(client.workspaceGeneration??0)!==generation)throw Error('foreign-scope');
  Plan.date(day);const balance=cents(client.saldo||0);
  if(balance>0)throw Error('positive-credit-requires-specific-proof');
  const markers=new Map(collections.processedOperations.map(m=>[m.id,m]));
  const sourceMaps={sales:new Map(sales.map(s=>[s.id,s])),payments:new Map(payments.map(p=>[p.id,p])),balanceAdjustments:new Map(adjustments.map(a=>[a.id,a]))};
  const validated=[],invalid=[];
  for(const event of events){
   let at;try{at=time(event.appliedAt);}catch{invalid.push({at:null,reason:'event-without-application-time',id:event.id});continue;}
   try{
    if(event.businessId&&event.businessId!==businessId||(event.workspaceGeneration??0)!==generation||event.status!=='applied')throw Error('unconfirmed-or-foreign-event');
    const types={credit_sale:'sales',credit_sale_reversal:'sales',payment_received:'payments',balance_adjustment:'balanceAdjustments'},col=types[event.type],reversal=event.type==='credit_sale_reversal';
    if(!col||col!==event.sourceCollection)throw Error('unsupported-effect-requires-review');
    const source=sourceMaps[col].get(event.sourceDocumentId);if(!source)throw Error('missing-source');
    if(source.businessId&&source.businessId!==businessId||(source.workspaceGeneration??0)!==generation)throw Error('foreign-source');
    const applied=reversal?source.financialReversedAt:source.financialAppliedAt;
    if(!applied||time(applied)!==at||source.applicationStatus&&source.applicationStatus!=='applied'||['conflict','cancelled','superseded','pending_sync'].includes(source.status))throw Error('unconfirmed-source');
    if(reversal&&(source.active!==false||source.financialReversalEventId!==event.id||source.cancelOperationId!==event.operationId||event.reversesEventId!=='credit_sale:'+source.id))throw Error('unproved-sale-reversal');
    const before=cents(reversal?event.balanceBefore:source.saldoAnterior),after=cents(reversal?event.balanceAfter:source.saldoAtual??source.saldoNovo),delta=cents(event.balanceDelta);
    if(after-before!==delta)throw Error('source-event-delta-mismatch');
    if(event.id!==event.type+':'+source.id)throw Error('noncanonical-effect-id');
    if((reversal?source.cancelOperationId:source.operationId)!==event.operationId)throw Error('operation-alias-requires-review');
    const marker=markers.get(event.operationId);
    if(!marker||marker.status!=='processed'||marker.businessId&&marker.businessId!==businessId||(marker.workspaceGeneration??0)!==generation)throw Error('missing-or-foreign-processed-marker');
    if(marker.eventKind!==(reversal?'sale_undo':{sales:'sale',payments:'payment',balanceAdjustments:'balance_adjustment'}[col]))throw Error('marker-kind-mismatch');
    if(col==='sales'){
     const cancelled=source.status==='cancelado'&&source.active===false&&source.financialReversalEventId==='credit_sale_reversal:'+source.id&&events.some(e=>e.id===source.financialReversalEventId&&e.operationId===source.cancelOperationId&&e.status==='applied');
     if(source.formaPagamento!=='fiado'||!['fiado','applied'].includes(source.status||'fiado')&&!cancelled)throw Error('not-a-confirmed-credit-sale');
     // Historical 4-decimal prices are NOT silently normalized for compatibility.
     if(delta!==(reversal?1:-1)*cents(source.valorFinal??source.valorTotal))throw Error('sale-effect-mismatch');
    }
    if(col==='payments'&&delta!==cents(source.valor??source.amount))throw Error('receipt-effect-mismatch');
    validated.push({id:event.id,sourceId:source.id,col,at,before,after,delta});
   }catch(error){invalid.push({id:event.id,at,reason:error.message});}
  }
  validated.sort((a,b)=>a.at-b.at||a.id.localeCompare(b.id));
  // An immutable confirmed zero is an explicit anchor; no restored opening debt is invented.
  const zeros=validated.filter(e=>e.after===0),anchor=zeros.at(-1);
  const start=anchor?anchor.at:validated[0]?.at;
  if(start===undefined)throw Error('no-confirmed-zero-or-origin');
  const relevantInvalid=invalid.filter(e=>e.at===null||e.at>=start);
  if(relevantInvalid.length){reasons.push(...relevantInvalid.map(e=>e.reason));issues.push(...relevantInvalid);throw Error('unproved-financial-effect');}
  const chain=validated.filter(e=>e.at>=start);
  if(anchor&&chain.filter(e=>e.at===start).length!==1)throw Error('ambiguous-zero-anchor');
  let running=anchor?anchor.before:checkTraditionalChain?chain[0].before:0;
  for(let i=0;i<chain.length;i++){
   const row=chain[i];if(i&&row.at===chain[i-1].at)throw Error('ambiguous-effect-order');
   if(row.before!==running){issues.push({eventId:row.id,declaredBeforeCents:row.before,expectedBeforeCents:running});throw Error('broken-balance-chain');}running=row.after;
  }
  if(running!==balance){issues.push({ledgerBalanceCents:running,currentBalanceCents:balance});throw Error('ledger-current-balance-mismatch');}
  // A missing event for a later declared source cannot disappear behind a matching sum.
  for(const [col,map]of Object.entries(sourceMaps))for(const source of map.values()){
   const at=source.financialAppliedAt||source.data||source.createdAt;
   if(!at||time(at)<start)continue;
   if(col==='sales'&&source.formaPagamento!=='fiado')continue;
   if(!validated.some(e=>e.col===col&&e.sourceId===source.id))throw Error('source-without-confirmed-effect');
  }
  let future=0;const activeSales=sales.filter(s=>s.active!==false&&!s.deletedAt&&!s.cancelledAt&&!s.desfeita&&s.formaPagamento==='fiado');
  if(client.hasInstallmentFiado&&!sales.some(s=>s.installmentPlan))throw Error('missing-installment-calendar');
  for(const sale of activeSales){
   if(sale.installmentPlan){
    Plan.assertSale({...sale,status:'fiado'});
    const principal=Plan.cents(sale.creditOriginalAmount??sale.valorFinal),paidSnapshot=Plan.cents(sale.creditPaidAmount||0);
    if(principal!==sale.installmentPlan.totalCents||paidSnapshot>principal||sale.creditRemainingAmount!==undefined&&Plan.cents(sale.creditRemainingAmount)!==principal-paidSnapshot)throw Error('inconsistent-installment-principal');
    const allocations=collections.paymentAllocations.filter(a=>a.clientId===client.id&&a.saleId===sale.id);
    const paid=allocations.reduce((n,a)=>{const p=payments.find(p=>p.id===a.paymentId);if(a.id!==a.paymentId+'__'+sale.id||a.businessId&&a.businessId!==businessId||(a.workspaceGeneration??0)!==generation||!p||!validated.some(e=>e.col==='payments'&&e.sourceId===p.id))throw Error('unproved-installment-allocation');const allocated=collections.paymentAllocations.filter(row=>row.paymentId===p.id).reduce((sum,row)=>sum+Plan.cents(row.amount),0);if(allocated>Plan.cents(p.valor??p.amount))throw Error('overallocated-receipt');return n+Plan.cents(a.amount);},0);
    if(paid!==Plan.cents(sale.creditPaidAmount||0))throw Error('installment-allocation-mismatch');
    future+=Plan.rows(sale,day).filter(row=>row.dueDate>day).reduce((n,row)=>n+row.remainingCents,0);
   }else if(Account.commercialDay(sale)>day)throw Error('future-traditional-sale-requires-review');
  }
  const total=-balance;if(future>total)throw Error('future-principal-exceeds-confirmed-debt');
  const account={asOf:day,dueCents:total-future,futureCents:future,totalCents:total};
  // Traditional routing verifies continuity against the existing opening balance.
  // It never grants V2 proof or derives a new opening balance.
  if(checkTraditionalChain)return{...result,traditionalChainVerified:true};
  const backendCompatible=!!strict&&!!firstPlan&&strict.dueCents===account.dueCents&&strict.futureCents===account.futureCents&&strict.totalCents===account.totalCents;
  return{...result,financialProof:true,backendCompatible,currentBackendEligible:backendCompatible,account,confirmedEffects:chain,anchor:anchor?{eventId:anchor.id,at:new Date(anchor.at).toISOString(),kind:'confirmed-zero'}:{eventId:chain[0].id,at:new Date(start).toISOString(),kind:'confirmed-zero-origin'},effectsAfterAnchor:chain.length,reason:backendCompatible?'confirmed-compatible':'confirmed-aggregate-but-current-backend-incompatible'};
 }catch(error){return{...result,reason:error.message,details:[...new Set(reasons)],issues};}
}
module.exports={prove};
