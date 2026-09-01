'use strict';

const PAYMENT_METHODS=Object.freeze({
  card:{id:'card',label:'Cartão de crédito',providerMode:'pending_preapproval'},
  card_monthly:{id:'card_monthly',label:'Cartão mensal',providerMode:'card_order_3ds'},
  pix_monthly:{id:'pix_monthly',label:'Pix mensal',providerMode:'guest_pix_order'}
});

function requirePaymentMethod(value){
  const id=String(value||'card').trim().toLowerCase();
  const method=PAYMENT_METHODS[id];
  if(!method)throw Object.assign(new Error('Forma de pagamento inválida.'),{code:'invalid-payment-method'});
  return method;
}

function authorizedPaymentSucceeded(invoice={}){
  return String(invoice?.payment?.status||'').toLowerCase()==='approved';
}

function paymentSucceeded(payment={}){
  return String(payment?.status||'').toLowerCase()==='approved';
}

function providerPaymentResult(type,payload={}){
  if(type==='subscription_authorized_payment')return{
    successful:authorizedPaymentSucceeded(payload),
    status:String(payload?.payment?.status||payload?.summarized||payload?.status||'unknown').toLowerCase(),
    statusDetail:String(payload?.payment?.status_detail||payload?.rejection_code||'').toLowerCase()||null,
    paymentId:payload?.payment?.id==null?null:String(payload.payment.id),
    dateApproved:payload?.payment?.date_approved||null
  };
  if(type==='payment')return{
    successful:paymentSucceeded(payload),
    status:String(payload?.status||'unknown').toLowerCase(),
    statusDetail:String(payload?.status_detail||'').toLowerCase()||null,
    paymentId:payload?.id==null?null:String(payload.id),
    dateApproved:payload?.date_approved||null
  };
  return{successful:false,status:'not_a_payment',paymentId:null};
}

function recurringEntitlementDecision({providerStatus,paymentStatus,activationPolicy='initial_payment_required',dateApproved=null}={}){
  const provider=String(providerStatus||'').trim().toLowerCase(),payment=String(paymentStatus||'').trim().toLowerCase(),policy=String(activationPolicy||'initial_payment_required').trim().toLowerCase();
  if(['cancelled','canceled','expired'].includes(provider))return{active:false,status:provider==='expired'?'expired':'cancelled',reason:`provider_${provider}`};
  if(payment==='rejected')return{active:false,status:'rejected',reason:'initial_payment_rejected'};
  if(provider==='authorized'&&payment==='approved')return{active:true,status:'active',reason:'initial_payment_approved',currentPeriodStart:dateApproved||null};
  if(provider==='authorized'&&policy==='preapproval_authorized')return{active:true,status:'active',reason:'provider_authorized',currentPeriodStart:dateApproved||null};
  return{active:false,status:'pending',reason:provider==='authorized'?'awaiting_initial_payment':`provider_${provider||'pending'}`};
}

module.exports={PAYMENT_METHODS,requirePaymentMethod,authorizedPaymentSucceeded,paymentSucceeded,providerPaymentResult,recurringEntitlementDecision};
