'use strict';
// Read-only guard for a NEW checkout or a reservation repair. Existing payment
// reconciliation/webhooks deliberately do not depend on this intake gate.
const crypto=require('node:crypto');
const cancellationEvidence=require('./legacy-cancellation-evidence');
const PAGE_SIZE=10,MAX_INVOICES=100,MAX_CHECK_AGE_MS=15000;
const messages={
 'legacy-source-billing-unverified':'Não foi possível comprovar a situação da cobrança antiga. A contratação ou reparação foi bloqueada; consulte os pagamentos existentes.',
 'legacy-source-billing-pending':'A cobrança antiga ainda está em processamento. Aguarde a conferência antes de contratar ou liberar a reserva.',
 'legacy-source-retry-scheduled':'Existe uma cobrança ou retentativa agendada no contrato antigo. A contratação e a liberação da reserva foram bloqueadas para evitar cobranças concorrentes.',
 'legacy-source-retry-unverified':'O contrato e a fatura estão cancelados, mas a retentativa informada ainda precisa de comprovação do provedor. Nenhuma nova cobrança ou reparação foi liberada.',
 'legacy-source-contract-review':'O contrato antigo precisa de conferência antes de outra contratação. Nenhuma assinatura será cancelada por esta verificação.',
 'legacy-source-late-payment-review':'Foi identificada uma aprovação recente do contrato antigo. Ela não quita o plano novo; confira a cobrança antes de contratar novamente.',
 'legacy-source-state-changed':'A assinatura ou a conferência mudou. Consulte a situação novamente antes de prosseguir.'
};
const fail=(code='legacy-source-billing-unverified')=>{throw Object.assign(Error(messages[code]),{code});};
const status=v=>typeof v==='string'?v.trim().toLowerCase():'';
const identifier=v=>typeof v==='string'?/^[A-Za-z0-9_-]{1,128}$/.test(v):Number.isSafeInteger(v)&&v>0;
function date(v){return typeof v==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(v)&&Number.isFinite(Date.parse(v))?Date.parse(v):NaN;}
function number(v){return typeof v==='number'?v:typeof v==='string'&&/^\d+$/.test(v)?Number(v):NaN;}
const sourceId=s=>String(s?.mercadoPago?.subscriptionId||s?.mercadoPago?.preapprovalId||'');
const fingerprint=b=>crypto.createHash('sha256').update(JSON.stringify([b.active,b.ownerId,sourceId(b.subscription),b.subscription?.paymentMethodType,b.subscription?.currentPeriodEnd,b.subscription?.expiresAt,b.subscription?.planId,b.subscription?.catalogVersion,b.subscription?.legacyPlan,b.subscription?.legacyMigration?.operationId,b.subscription?.legacyMigration?.activatedAt])).digest('hex');
function assertSourceBillingCheck({check,business,businessId,actorUid,expectedSubscriptionId,now=new Date()}){
 const age=+now-date(check?.checkedAt);
 if(!check||check.version!==2||check.businessId!==businessId||check.actorUid!==actorUid||business?.active!==true||business.ownerId!==actorUid||check.subscriptionId!==sourceId(business.subscription)||expectedSubscriptionId!=null&&check.subscriptionId!==expectedSubscriptionId||check.sourceFingerprint!==fingerprint(business)||!Number.isFinite(age)||age<0||age>MAX_CHECK_AGE_MS)fail('legacy-source-state-changed');
 if((check.residualRetryEvidence||[]).some(item=>!Number.isFinite(date(item.expiresAt))||date(item.expiresAt)<=+now))fail('legacy-source-state-changed');
}
function inspectInvoices({invoices,subscription,contract,now=new Date(),residualChecks=new Map()}){
 const clock=+now,paidThrough=date(subscription.currentPeriodEnd||subscription.expiresAt);
 if(!Number.isFinite(clock)||!Number.isFinite(paidThrough))fail();
 for(const row of invoices){
  if(!row||typeof row!=='object'||!identifier(row.id)||String(row.preapproval_id||'')!==String(contract.id))fail();
  const invoiceState=status(row.status),paymentState=status(row.payment?.status),debit=date(row.debit_date==null?row.date_created:row.debit_date);
  if(!Number.isFinite(debit)||row.retry_attempt!=null&&(!Number.isSafeInteger(number(row.retry_attempt))||number(row.retry_attempt)<0))fail();
  if(row.next_retry_date!=null){
   if(!Number.isFinite(date(row.next_retry_date)))fail();
   if(cancellationEvidence.candidate(row,contract))cancellationEvidence.assertCheck(residualChecks.get(String(row.id)),row,now);
   else fail('legacy-source-retry-scheduled');
  }
  if(['scheduled','recycling'].includes(invoiceState))fail('legacy-source-retry-scheduled');
  if(!['processed','cancelled','canceled'].includes(invoiceState))fail();
  if(!row.payment||!identifier(row.payment.id)||!paymentState)fail();
  if(['pending','in_process','authorized','in_mediation'].includes(paymentState))fail('legacy-source-billing-pending');
  if(!['approved','rejected','cancelled','canceled'].includes(paymentState)||debit>clock)fail();
  if(paymentState==='approved'){
   if(invoiceState!=='processed')fail();
   // A historical debit date alone cannot prove an approval was not late.
   const approvedAt=row.payment.date_approved!=null?date(row.payment.date_approved):date(row.last_modified);
   if(!Number.isFinite(approvedAt)||approvedAt>clock)fail();
   if(approvedAt>=paidThrough)fail('legacy-source-late-payment-review');
  }
 }
 const contractState=status(contract.status);
 if(!['authorized','cancelled','canceled','expired'].includes(contractState))fail('legacy-source-contract-review');
 if(contract.next_payment_date!=null&&!Number.isFinite(date(contract.next_payment_date)))fail();
 if(contractState==='authorized'){
  const next=date(contract.next_payment_date);
  if(!Number.isFinite(next))fail();
  if(next<=clock)fail('legacy-source-billing-pending');
 }
 return{contractStatus:contractState,invoiceCount:invoices.length,nextPaymentDate:contract.next_payment_date||null};
}
async function verifyLegacySourceBilling(db,provider,{businessId,actorUid,expectedSubscriptionId,now=()=>new Date()}={}){
 const business=(await db.doc('businesses/'+businessId).get()).data(),s=business?.subscription||{},id=sourceId(s);
 if(business?.active!==true||business.ownerId!==actorUid)throw Object.assign(Error('Somente o proprietário ativo pode conferir a assinatura.'),{code:'legacy-migration-owner-required'});
 if(expectedSubscriptionId!=null&&id!==expectedSubscriptionId||s.legacyMigration?.activatedAt)fail('legacy-source-state-changed');
 if(!id){if(s.paymentMethodType==='card'||!['pix_monthly','card_monthly'].includes(s.paymentMethodType))fail();return{version:2,businessId,actorUid,recurring:false,subscriptionId:'',sourceFingerprint:fingerprint(business),checkedAt:now().toISOString()};}
 const index=(await db.doc('subscriptionIndex/'+id).get()).data();
 if(!index||index.businessId!==businessId||Number(index.catalogVersion||1)>=2)fail();
 let remote,rows=[],total=null;const residualChecks=new Map();
 try{
  remote=await provider.getSubscription(id);
  const amount=Number(remote?.auto_recurring?.transaction_amount);
  if(String(remote?.id||'')!==id||!index.expectedExternalReference||remote.external_reference!==index.expectedExternalReference||!Number.isFinite(amount)||amount<=0||remote.auto_recurring?.currency_id!=='BRL')fail();
  // Lazy require avoids a module cycle with the existing migration projector.
  require('./firestore-subscription-service').validateProviderSubscription(remote,index,business);
  const ids=new Set();
  for(let offset=0;;offset+=PAGE_SIZE){
   const page=await provider.searchAuthorizedPayments(id,{limit:PAGE_SIZE,offset}),paging=page?.paging,t=number(paging?.total),limit=number(paging?.limit),start=number(paging?.offset);
   if(!Array.isArray(page?.results)||!Number.isSafeInteger(t)||t<0||t>MAX_INVOICES||limit!==PAGE_SIZE||start!==offset||total!=null&&t!==total||page.results.length!==Math.min(PAGE_SIZE,t-offset))fail();
   total=t;
   for(const r of page.results){const key=String(r?.id||'');if(!key||ids.has(key))fail();ids.add(key);rows.push(r);if(cancellationEvidence.candidate(r,remote))residualChecks.set(key,await cancellationEvidence.readEvidence(db,provider,{businessId,ownerUid:actorUid,contract:remote,invoice:r,index,now:now()}));}
   inspectInvoices({invoices:rows,subscription:s,contract:remote,now:now(),residualChecks});
   if(rows.length===total)break;
  }
  const latest=await provider.getSubscription(id);
  const shape=c=>[c?.id,c?.status,c?.external_reference,c?.auto_recurring?.transaction_amount,c?.auto_recurring?.currency_id,c?.auto_recurring?.frequency,c?.auto_recurring?.frequency_type,c?.next_payment_date];
  if(JSON.stringify(shape(latest))!==JSON.stringify(shape(remote)))fail('legacy-source-state-changed');
  remote=latest;
  // Repeat exact invoice/payment/proof reads at the end of the lookup window.
  for(const row of rows)if(residualChecks.has(String(row.id)))residualChecks.set(String(row.id),await cancellationEvidence.readEvidence(db,provider,{businessId,ownerUid:actorUid,contract:remote,invoice:row,index,now:now()}));
 }catch(e){if(String(e.code||'').startsWith('legacy-source-'))throw e;fail();}
 const details=inspectInvoices({invoices:rows,subscription:s,contract:remote,now:now(),residualChecks}),current=(await db.doc('businesses/'+businessId).get()).data();
 if(!current||fingerprint(current)!==fingerprint(business))fail('legacy-source-state-changed');
 return{version:2,businessId,actorUid,recurring:true,subscriptionId:id,sourceFingerprint:fingerprint(current),...details,residualRetryEvidence:[...residualChecks.values()],checkedAt:now().toISOString()};
}
module.exports={verifyLegacySourceBilling,assertSourceBillingCheck,inspectInvoices,MAX_INVOICES,MAX_CHECK_AGE_MS};
