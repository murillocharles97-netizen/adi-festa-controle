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
    createSubscription({businessId,userId,email,plan,backUrl,operationId}){
      return request('/preapproval',{method:'POST',idempotencyKey:operationId,body:{reason:`Adi Festa Controle - ${plan.name}`,external_reference:businessId,payer_email:email,back_url:backUrl,status:'pending',auto_recurring:{frequency:plan.frequency,frequency_type:plan.frequencyType,transaction_amount:plan.amount,currency_id:plan.currency},metadata:{business_id:businessId,user_id:userId,plan_id:plan.id,operation_id:operationId}}});
    },
    getSubscription(subscriptionId){return request(`/preapproval/${encodeURIComponent(subscriptionId)}`)},
    cancelSubscription(subscriptionId){return request(`/preapproval/${encodeURIComponent(subscriptionId)}`,{method:'PUT',body:{status:'canceled'}})},
    getAuthorizedPayment(paymentId){return request(`/authorized_payments/${encodeURIComponent(paymentId)}`)},
    getPayment(paymentId){return request(`/v1/payments/${encodeURIComponent(paymentId)}`)}
  };
}

module.exports={API,mercadoPagoService};
