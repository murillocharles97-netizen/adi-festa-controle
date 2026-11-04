'use strict';
const Catalog=require('../shared/plan-catalog'),{verifyLegacySourceBilling}=require('./legacy-source-billing-guard');
const {requirePlan,planBilling}=require('./plan-service');
// Status is advisory and read-only. createSubscription/recovery revalidate all
// bindings and the provider again; this response never authorizes a payment.
async function billingMigrationStatus(db,provider,{businessId,uid,now=()=>new Date()}={}){
  const [bs,ps,ms,js]=await Promise.all([db.doc('businesses/'+businessId).get(),db.doc('users/'+uid).get(),db.doc(`businesses/${businessId}/members/${uid}`).get(),db.doc('legacyPlanTransitions/'+businessId).get()]),b=bs.data(),p=ps.data(),m=ms.data(),job=js.data();
  if(!uid||!b||b.ownerId!==uid||b.active!==true||p?.active!==true||p.businessId!==businessId||(ms.exists?m?.role!=='owner'||m?.status!=='active':p?.role!=='owner'||b.legacyAccessDisabled===true))throw Object.assign(Error('Somente o proprietário ativo desta empresa pode conferir a migração.'),{code:'permission-denied'});
  if(!Catalog.legacyState(b.subscription,now()).legacy)return{status:'not_required',canStartNewCheckout:false,checkedAt:now().toISOString(),paymentCreated:false};
  const plan=requirePlan('premium'),price=planBilling(plan,'monthly').amount,checkedAt=now().toISOString();
  const offer={catalogVersion:Catalog.version,planId:plan.id,name:plan.name,billingCycle:'monthly',currency:'BRL',amount:price,discountApplied:false,quotedAt:checkedAt,expiresAt:new Date(Date.parse(checkedAt)+300000).toISOString(),requiresCheckoutConfirmation:true};
  if(job&&(job.businessId!==businessId||job.operationId&&job.actorUid!==uid||!['awaiting_selection','creating','checking_creation','awaiting_payment','attempt_closed'].includes(job.status)))return{status:'blocked',billingCode:'legacy-source-state-changed',message:'A reserva anterior precisa de conferência administrativa antes de outra contratação.',canStartNewCheckout:false,checkedAt:now().toISOString(),paymentCreated:false,offer};
  let source;
  try{source=await verifyLegacySourceBilling(db,provider,{businessId,actorUid:uid,now});}
  catch(e){if(!String(e.code||'').startsWith('legacy-source-'))throw e;return{status:'blocked',billingCode:e.code,message:e.message,canStartNewCheckout:false,checkedAt:now().toISOString(),paymentCreated:false,offer};}
  const reservation=job&&job.businessId===businessId&&job.actorUid===uid&&['creating','checking_creation','awaiting_payment'].includes(job.status);
  const status=reservation?(job.status==='awaiting_payment'?'payment_pending':'reservation_review_required'):'ready_for_quote';
  return{status,canStartNewCheckout:!reservation,sourceContractStatus:source.contractStatus||null,residualRetryEvidenceConfirmed:(source.residualRetryEvidence||[]).length>0,checkedAt:now().toISOString(),paymentCreated:false,offer};
}
module.exports={billingMigrationStatus};
