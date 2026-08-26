'use strict';

const PAYMENT_METHODS=Object.freeze({
  card:{id:'card',label:'Cartão de crédito',providerMode:'pending_preapproval'},
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
    paymentId:payload?.payment?.id==null?null:String(payload.payment.id)
  };
  if(type==='payment')return{
    successful:paymentSucceeded(payload),
    status:String(payload?.status||'unknown').toLowerCase(),
    paymentId:payload?.id==null?null:String(payload.id)
  };
  return{successful:false,status:'not_a_payment',paymentId:null};
}

module.exports={PAYMENT_METHODS,requirePaymentMethod,authorizedPaymentSucceeded,paymentSucceeded,providerPaymentResult};
