'use strict';
const Catalog=require('../functions/src/shared/plan-catalog');
const {recurring}=require('../functions/src/services/legacy-plan-transition-service');
const {firestore,secret,providerGet}=require('./lib/billing-readonly.cjs');
function classify({business,index,remote,providerError=null}){
 const s=business.subscription||{},legacy=Catalog.legacyState(s),id=s.mercadoPago?.subscriptionId||s.mercadoPago?.preapprovalId||null,isRecurring=recurring(s);
 const pendingOldCheckout=Boolean(id)&&!s.hasPaidSubscription&&Number(s.catalogVersion||1)<2;
 const periodMismatch=legacy.legacy&&isRecurring&&remote?.status==='authorized'&&remote.next_payment_date&&Date.parse(remote.next_payment_date)!==Date.parse(legacy.paidThrough);
 const review=legacy.legacy&&(!legacy.paidThrough||(isRecurring&&index?.businessId!==business.id)||periodMismatch||isRecurring&&providerError)||pendingOldCheckout||(s.status==='active'&&['essential','professional','premium'].includes(s.planId)&&!s.hasPaidSubscription&&Number(s.catalogVersion||1)<2);
 let action=!legacy.legacy?'no_action':isRecurring?'preserve_recurrence_until_explicit_migration_paid_and_webhook_processed':legacy.expired?'expired_choose_new_plan_no_recurrence':'preserve_paid_period_no_recurring_charge';
 if(legacy.renewalStopped)action='already_stopped_wait_for_explicit_new_subscription';
 if(review)action=pendingOldCheckout?'review_pending_legacy_checkout':'review_required';
 return{legacy,isRecurring,review:Boolean(review),action,periodMismatch:Boolean(periodMismatch)};
}
async function audit({project='adi-festa-controle',inspectProvider=false}={}){
 const cloud=firestore(project),businesses=await cloud.list('businesses');
 let bearer=null,credentialError=null;
 if(inspectProvider)try{bearer=await secret(project,'MERCADO_PAGO_ACCESS_TOKEN');if(!bearer)credentialError='secret-unavailable';}catch(error){credentialError=error.code||'credential-unavailable';}
 const rows=[];
 for(const business of businesses){
  const s=business.subscription||{},legacy=Catalog.legacyState(s),id=s.mercadoPago?.subscriptionId||s.mercadoPago?.preapprovalId||null;
  const index=id?await cloud.document('subscriptionIndex',id):null;
  let remote=null,providerError=credentialError;
  if(id&&bearer)try{remote=await providerGet('/preapproval/'+encodeURIComponent(id),bearer);providerError=remote?null:'not-found';}catch(error){providerError=error.code||'provider-read-failed';}
  const {isRecurring,review,action,periodMismatch}=classify({business,index,remote,providerError});
  rows.push({businessId:business.id,businessName:business.name||business.nome||business.displayName||null,ownerUid:business.ownerId||business.ownerUid||null,subscriptionStatus:s.status||null,planId:s.planId||null,catalogVersion:s.catalogVersion||1,hasPaidSubscription:s.hasPaidSubscription===true,paymentMethodType:s.paymentMethodType||null,preapprovalId:id,indexBusinessMatches:id?index?.businessId===business.id:null,recurrenceStatus:!isRecurring?'not_recurring':remote?.status||s.mercadoPago?.providerStatus||null,recurrenceStatusSource:!isRecurring?'payment_method':remote?'mercado_pago_get':s.mercadoPago?.providerStatus?'firestore_snapshot':'unknown',providerError:id?providerError:null,currentPeriodStart:s.currentPeriodStart||null,currentPeriodEnd:s.currentPeriodEnd||s.expiresAt||null,paidThrough:legacy.paidThrough,providerNextPaymentDate:remote?.next_payment_date||null,periodMismatch,wouldClassifyLegacy:legacy.legacy,reviewRequired:Boolean(review),proposedAction:action});
 }
 return{mode:'dry-run-read-only',projectId:project,generatedAt:new Date().toISOString(),productionWrites:0,providerMutations:0,providerInspected:inspectProvider,counts:{businesses:rows.length,legacy:rows.filter(r=>r.wouldClassifyLegacy).length,reviewRequired:rows.filter(r=>r.reviewRequired).length},businesses:rows};
}
if(require.main===module)audit({inspectProvider:process.argv.includes('--provider')}).then(report=>console.log(JSON.stringify(report,null,2))).catch(error=>{console.error(JSON.stringify({mode:'dry-run-read-only',errorCode:error.code||'audit-failed',productionWrites:0}));process.exitCode=1;});
module.exports={audit,classify};
