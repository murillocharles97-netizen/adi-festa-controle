'use strict';

const API='https://api.mercadopago.com';

function mercadoPagoService({accessToken,fetchImpl=global.fetch}){
  if(!accessToken)throw Error('Token do Mercado Pago indisponível no Secret Manager.');
  if(typeof fetchImpl!=='function')throw Error('Cliente HTTP indisponível.');
  async function request(path,{method='GET',body,idempotencyKey}={}){
    const headers={Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'};
    if(idempotencyKey)headers['X-Idempotency-Key']=idempotencyKey;
    const response=await fetchImpl(`${API}${path}`,{method,headers,body:body===undefined?undefined:JSON.stringify(body)});
    const text=await response.text(),payload=text?JSON.parse(text):{};
    if(!response.ok){const error=Object.assign(new Error(payload?.message||`Mercado Pago respondeu ${response.status}.`),{code:'mercado-pago-error',status:response.status,details:payload});throw error}
    return payload;
  }
  return{
    createSubscription({businessId,userId,email,plan,billing,backUrl,operationId,coupon=null,preapprovalPlanId=null,paymentMethodType='card'}){
      const price=Number(billing?.amount??plan.amount),frequency=Number(billing?.frequency??plan.frequency),frequencyType=String(billing?.frequencyType??plan.frequencyType);
      const body={reason:`Adi Festa Controle - ${plan.name}`,external_reference:businessId,payer_email:email,back_url:backUrl,status:'pending',metadata:{business_id:businessId,user_id:userId,plan_id:plan.id,billing_cycle:billing?.billingCycle||'monthly',operation_id:operationId,internal_subscription_id:operationId,payment_method_type:paymentMethodType,coupon_id:coupon?.couponId||null,coupon_redemption_id:coupon?.redemptionId||null,quote_id:coupon?.quoteId||null}};
      if(preapprovalPlanId)body.preapproval_plan_id=String(preapprovalPlanId);
      else body.auto_recurring={frequency,frequency_type:frequencyType,transaction_amount:price,currency_id:plan.currency};
      return request('/preapproval',{method:'POST',idempotencyKey:operationId,body});
    },
    createPixOrder({businessId,email,plan,billing,operationId,expirationTime='PT24H'}){
      const amount=Number(billing?.amount??plan.amount).toFixed(2),externalReference=`billing:${businessId}:${operationId}`;
      return request('/v1/orders',{method:'POST',idempotencyKey:operationId,body:{type:'online',total_amount:amount,external_reference:externalReference,processing_mode:'automatic',transactions:{payments:[{amount,payment_method:{id:'pix',type:'bank_transfer'},expiration_time:expirationTime}]},payer:{email}}});
    },
    getOrder(orderId){return request(`/v1/orders/${encodeURIComponent(orderId)}`)},
    getSubscription(subscriptionId){return request(`/preapproval/${encodeURIComponent(subscriptionId)}`)},
    cancelSubscription(subscriptionId){return request(`/preapproval/${encodeURIComponent(subscriptionId)}`,{method:'PUT',body:{status:'cancelled'}})},
    updateSubscriptionAmount(subscriptionId,amount,currency='BRL'){return request(`/preapproval/${encodeURIComponent(subscriptionId)}`,{method:'PUT',body:{auto_recurring:{transaction_amount:Number(amount),currency_id:String(currency||'BRL')}}})},
    getAuthorizedPayment(paymentId){return request(`/authorized_payments/${encodeURIComponent(paymentId)}`)},
    getPayment(paymentId){return request(`/v1/payments/${encodeURIComponent(paymentId)}`)}
  };
}

module.exports={API,mercadoPagoService};
