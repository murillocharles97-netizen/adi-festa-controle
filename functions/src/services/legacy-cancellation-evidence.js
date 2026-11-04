'use strict';
// Private administrative evidence only. No client-supplied flag can classify a
// retained retry date as harmless; live provider reads are still mandatory.
const crypto=require('node:crypto');
const MAX_EVIDENCE_AGE_MS=86400000,hash=x=>crypto.createHash('sha256').update(JSON.stringify(x)).digest('hex');
const proofId=(bid,sid,iid,pid)=>hash([bid,String(sid),String(iid),String(pid)]);
const millis=x=>typeof x==='string'&&/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(x)?Date.parse(x):x?.toMillis?.()??NaN;
const terminal=x=>['cancelled','canceled'].includes(String(x||'').toLowerCase());
const failed=x=>['rejected','cancelled','canceled'].includes(String(x||'').toLowerCase());
const candidate=(invoice,contract)=>terminal(contract?.status)&&terminal(invoice?.status)&&failed(invoice?.payment?.status)&&invoice.next_retry_date!=null;
const invoiceHash=i=>hash([String(i.id),String(i.preapproval_id),i.status,millis(i.next_retry_date),millis(i.last_modified),i.retry_attempt,millis(i.debit_date||i.date_created),String(i.payment?.id),i.payment?.status]);
function unavailable(){throw Object.assign(Error('O contrato e a fatura estão cancelados, mas a retentativa informada ainda precisa de comprovação do provedor. Nenhuma nova cobrança ou reparação foi liberada.'),{code:'legacy-source-retry-unverified'});}
function validateEvidence({proof,businessId,ownerUid,contract,invoice,payment,externalReference,expectedAmount,now}){
  const clock=+now,verified=millis(proof?.verifiedAt),expires=millis(proof?.expiresAt),confirmed=millis(proof?.providerConfirmedAt),amount=Number(payment?.transaction_amount);
  if(!Number.isFinite(clock)||!candidate(invoice,contract)||!proof||proof.version!==1||proof.status!=='accepted'||proof.authority!=='platform_admin'||proof.source!=='mercado_pago_support'||proof.determination!=='cancelled_retry_non_executable'||proof.businessId!==businessId||proof.ownerUid!==ownerUid||String(proof.subscriptionId)!==String(contract.id)||String(proof.invoiceId)!==String(invoice.id)||String(proof.paymentId)!==String(invoice.payment.id)||proof.expectedExternalReference!==externalReference||!proof.evidenceReference||!/^[A-Za-z0-9_.:/ -]{3,160}$/.test(proof.evidenceReference)||!/^[a-f0-9]{64}$/.test(proof.evidenceSha256||'')||!/^[a-f0-9]{64}$/.test(proof.administratorPrincipalHash||'')||!Number.isFinite(verified)||!Number.isFinite(expires)||!Number.isFinite(confirmed)||verified>clock||confirmed>verified||clock-verified>MAX_EVIDENCE_AGE_MS||clock-confirmed>MAX_EVIDENCE_AGE_MS||expires<=clock||expires>verified+MAX_EVIDENCE_AGE_MS)unavailable();
  if(contract.external_reference!==externalReference||String(invoice.preapproval_id)!==String(contract.id)||String(payment?.id)!==String(invoice.payment.id)||payment.external_reference!==externalReference||!failed(payment.status)||payment.status!==invoice.payment.status||payment.date_approved!=null||payment.currency_id!=='BRL'||!Number.isFinite(amount)||amount<=0||Math.abs(amount-Number(expectedAmount))>0.009||!Number.isFinite(Number(expectedAmount)))unavailable();
  for(const [a,b]of [[proof.contractLastModified,contract.last_modified],[proof.invoiceLastModified,invoice.last_modified],[proof.nextRetryDate,invoice.next_retry_date],[proof.paymentLastUpdated,payment.date_last_updated]])if(!Number.isFinite(millis(a))||millis(a)!==millis(b))unavailable();
  if(proof.invoiceSnapshotHash!==invoiceHash(invoice)||Math.max(millis(contract.last_modified),millis(invoice.last_modified),millis(payment.date_last_updated))>confirmed)unavailable();
  return{version:1,invoiceId:String(invoice.id),invoiceHash:invoiceHash(invoice),expiresAt:new Date(expires).toISOString(),evidenceId:proofId(businessId,contract.id,invoice.id,payment.id)};
}
function assertCheck(check,invoice,now){if(!check||check.version!==1||check.invoiceId!==String(invoice.id)||check.invoiceHash!==invoiceHash(invoice)||!Number.isFinite(+now)||!Number.isFinite(millis(check.expiresAt))||millis(check.expiresAt)<=+now)unavailable();}
async function readEvidence(db,provider,{businessId,ownerUid,contract,invoice,index,now}){
  const ref=db.doc('billingLegacyCancellationProofs/'+proofId(businessId,contract.id,invoice.id,invoice.payment.id)),proof=(await ref.get()).data();if(!proof)unavailable();
  if(typeof provider.getAuthorizedPayment!=='function'||typeof provider.getPayment!=='function')unavailable();
  const [fresh,payment]=await Promise.all([provider.getAuthorizedPayment(invoice.id),provider.getPayment(invoice.payment.id)]);if(invoiceHash(fresh)!==invoiceHash(invoice))unavailable();
  return validateEvidence({proof,businessId,ownerUid,contract,invoice:fresh,payment,externalReference:index.expectedExternalReference,expectedAmount:index.chargedPrice??index.officialPrice,now});
}
module.exports={candidate,proofId,invoiceHash,validateEvidence,assertCheck,readEvidence,MAX_EVIDENCE_AGE_MS};
