'use strict';

const TERMINAL_ATTEMPT_STATUSES=new Set(['approved','rejected','cancelled','expired','abandoned','orphaned','provider_not_found','superseded']);
const PENDING_ATTEMPT_STATUSES=new Set(['created','awaiting_provider','processing','pending','pending_payment','payment_pending']);

function canonicalAttemptStatus({providerStatus,paymentStatus,statusDetail,currentStatus,activationApproved}={}){
  const provider=String(providerStatus||'').trim().toLowerCase(),payment=String(paymentStatus||'').trim().toLowerCase(),detail=String(statusDetail||'').trim();
  if(activationApproved===true)return{status:'approved',reason:payment==='approved'?'payment_approved':'provider_authorized'};
  if(activationApproved===false){
    if(payment==='rejected')return{status:'rejected',reason:detail||'payment_rejected'};
    if(['cancelled','canceled'].includes(provider))return{status:'cancelled',reason:'provider_cancelled'};
    if(provider==='expired')return{status:'expired',reason:'provider_expired'};
    if(TERMINAL_ATTEMPT_STATUSES.has(String(currentStatus||'').toLowerCase()))return{status:String(currentStatus).toLowerCase(),reason:'terminal_preserved'};
    return{status:'pending_payment',reason:provider==='authorized'?'awaiting_initial_payment':`provider_${provider||'pending'}`};
  }
  if(payment==='approved'||provider==='authorized')return{status:'approved',reason:payment==='approved'?'payment_approved':'provider_authorized'};
  if(payment==='rejected')return{status:'rejected',reason:detail||'payment_rejected'};
  if(['cancelled','canceled'].includes(provider))return{status:'cancelled',reason:'provider_cancelled'};
  if(provider==='expired')return{status:'expired',reason:'provider_expired'};
  if(['pending','paused'].includes(provider))return{status:'pending_payment',reason:`provider_${provider}`};
  if(TERMINAL_ATTEMPT_STATUSES.has(String(currentStatus||'').toLowerCase()))return{status:String(currentStatus).toLowerCase(),reason:'terminal_preserved'};
  return{status:'pending_payment',reason:'provider_pending'};
}

function transitionAttempt(currentStatus,nextStatus){
  const current=String(currentStatus||'created').toLowerCase(),next=String(nextStatus||'pending_payment').toLowerCase();
  if(TERMINAL_ATTEMPT_STATUSES.has(current)&&current!==next)return{allowed:false,status:current,reason:'terminal_state_is_immutable'};
  return{allowed:true,status:next,reason:current===next?'idempotent':'transitioned'};
}

function attemptStatePatch({currentStatus,providerStatus,paymentStatus,statusDetail,activationApproved,now=new Date().toISOString(),source='provider'}={}){
  const classified=canonicalAttemptStatus({providerStatus,paymentStatus,statusDetail,currentStatus,activationApproved}),approvedAfterProviderRetry=activationApproved===true&&String(currentStatus||'').toLowerCase()==='rejected',transition=approvedAfterProviderRetry?{allowed:true,status:'approved',reason:'provider_retry_approved'}:transitionAttempt(currentStatus,classified.status),status=transition.status,terminal=TERMINAL_ATTEMPT_STATUSES.has(status);
  return{status,providerStatus:String(providerStatus||'')||null,lastPaymentStatus:String(paymentStatus||'')||null,lastPaymentStatusDetail:String(statusDetail||'')||null,lastReconciliationSource:source,reconciledAt:now,updatedAt:now,...(terminal?{closedAt:now,closeReason:classified.reason}:{})};
}

function isPendingAttempt(status){return PENDING_ATTEMPT_STATUSES.has(String(status||'').toLowerCase())}
function isTerminalAttempt(status){return TERMINAL_ATTEMPT_STATUSES.has(String(status||'').toLowerCase())}
function getCurrentBillingAttempt(attempts=[]){return[...attempts].filter(item=>item&&isPendingAttempt(item.status)&&(item.subscriptionId||item.providerOrderId||item.checkoutUrl)).sort((a,b)=>new Date(b.updatedAt||b.createdAt||0)-new Date(a.updatedAt||a.createdAt||0))[0]||null}

module.exports={TERMINAL_ATTEMPT_STATUSES,PENDING_ATTEMPT_STATUSES,canonicalAttemptStatus,transitionAttempt,attemptStatePatch,isPendingAttempt,isTerminalAttempt,getCurrentBillingAttempt};
