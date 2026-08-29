'use strict';

const crypto=require('node:crypto');
const API='https://api.mercadopago.com';
const RETRYABLE_HTTP_STATUSES=new Set([408,425,429,500,502,503,504]);

function pixExternalReference(businessId,operationId){
  const digest=crypto.createHash('sha256').update(`${String(businessId||'')}:${String(operationId||'')}`).digest('hex').slice(0,56);
  return `billing_${digest}`;
}

function validNotificationUrl(value){
  if(!value)return null;
  try{const url=new URL(String(value));return url.protocol==='https:'?url.toString():null}catch{return null}
}

function safeProviderPayload(text){
  if(!text)return{payload:{},format:'empty'};
  try{return{payload:JSON.parse(text),format:'json'}}catch{return{payload:{},format:'non_json'}}
}

function providerErrorDiagnostics(error={}){
  const details=error?.details&&typeof error.details==='object'?error.details:{},payload=details.payload&&typeof details.payload==='object'?details.payload:details,rawCauses=Array.isArray(payload?.cause)?payload.cause:Array.isArray(payload?.errors)?payload.errors:[];
  return{
    provider:'mercado_pago',
    endpoint:String(details.endpoint||error?.endpoint||''),
    httpStatus:error?.status!=null&&Number.isFinite(Number(error.status))?Number(error.status):null,
    providerErrorCode:String(payload?.code??payload?.error??'').slice(0,120)||null,
    providerMessage:String(payload?.message||payload?.error_description||error?.message||'').slice(0,300)||null,
    providerCauses:rawCauses.slice(0,8).map(item=>({code:String(item?.code??item?.type??'').slice(0,120)||null,message:String(item?.description||item?.message||item?.detail||'').slice(0,240)||null})),
    providerStatusDetail:String(payload?.status_detail||'').slice(0,160)||null,
    responseFormat:String(details.responseFormat||'unknown'),
    requestId:String(details.requestId||'').slice(0,160)||null
  };
}

function providerRequestError({code,status=null,message,endpoint,payload={},responseFormat='unknown',requestId=null,cause=null}){
  return Object.assign(new Error(message),{code,status,endpoint,details:{endpoint,payload,responseFormat,requestId},cause});
}

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));

function mercadoPagoService({accessToken,fetchImpl=global.fetch}){
  if(!accessToken)throw Error('Token do Mercado Pago indisponível no Secret Manager.');
  if(typeof fetchImpl!=='function')throw Error('Cliente HTTP indisponível.');
  async function request(path,{method='GET',body,idempotencyKey}={}){
    const headers={Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'};
    if(idempotencyKey)headers['X-Idempotency-Key']=idempotencyKey;
    const options={method,headers,body:body===undefined?undefined:JSON.stringify(body)},mayRetry=method==='GET'||Boolean(idempotencyKey);
    for(let attempt=0;attempt<2;attempt+=1){
      let response;
      try{response=await fetchImpl(`${API}${path}`,options)}catch(cause){
        const error=providerRequestError({code:'mercado-pago-network-error',message:'Falha de rede ao consultar o Mercado Pago.',endpoint:path,cause});
        if(mayRetry&&attempt===0){await wait(120);continue}throw error;
      }
      const requestId=response.headers?.get?.('x-request-id')||null;
      let text;
      try{text=await response.text()}catch(cause){
        const error=providerRequestError({code:'mercado-pago-invalid-response',status:response.status,message:'Não foi possível ler a resposta do Mercado Pago.',endpoint:path,responseFormat:'unreadable',requestId,cause});
        if(mayRetry&&attempt===0){await wait(120);continue}throw error;
      }
      const parsed=safeProviderPayload(text),payload=parsed.payload;
      if(!response.ok){
        const error=providerRequestError({code:'mercado-pago-error',status:response.status,message:payload?.message||`Mercado Pago respondeu ${response.status}.`,endpoint:path,payload,responseFormat:parsed.format,requestId});
        if(mayRetry&&attempt===0&&RETRYABLE_HTTP_STATUSES.has(response.status)){await wait(120);continue}throw error;
      }
      if(parsed.format!=='json'){
        const error=providerRequestError({code:'mercado-pago-invalid-response',status:response.status,message:'O Mercado Pago respondeu sem um JSON válido.',endpoint:path,responseFormat:parsed.format,requestId});
        if(mayRetry&&attempt===0){await wait(120);continue}throw error;
      }
      return payload;
    }
    throw providerRequestError({code:'mercado-pago-invalid-response',message:'O Mercado Pago não devolveu uma resposta válida.',endpoint:path});
  }
  return{
    createSubscription({businessId,userId,email,plan,billing,backUrl,operationId,coupon=null,preapprovalPlanId=null,paymentMethodType='card'}){
      const price=Number(billing?.amount??plan.amount),frequency=Number(billing?.frequency??plan.frequency),frequencyType=String(billing?.frequencyType??plan.frequencyType);
      const body={reason:`Adi Festa Controle - ${plan.name}`,external_reference:businessId,payer_email:email,back_url:backUrl,status:'pending',metadata:{business_id:businessId,user_id:userId,plan_id:plan.id,billing_cycle:billing?.billingCycle||'monthly',operation_id:operationId,internal_subscription_id:operationId,payment_method_type:paymentMethodType,coupon_id:coupon?.couponId||null,coupon_redemption_id:coupon?.redemptionId||null,quote_id:coupon?.quoteId||null}};
      if(preapprovalPlanId)body.preapproval_plan_id=String(preapprovalPlanId);
      else body.auto_recurring={frequency,frequency_type:frequencyType,transaction_amount:price,currency_id:plan.currency};
      return request('/preapproval',{method:'POST',idempotencyKey:operationId,body});
    },
    createPixOrder({businessId,email,plan,billing,operationId,notificationUrl=null}){
      const amount=Number(billing?.amount??plan.amount).toFixed(2),externalReference=pixExternalReference(businessId,operationId);
      const body={type:'online',total_amount:amount,external_reference:externalReference,processing_mode:'automatic',transactions:{payments:[{amount,payment_method:{id:'pix',type:'bank_transfer'}}]},payer:{email}},webhookUrl=validNotificationUrl(notificationUrl);
      if(webhookUrl)body.notification_url=webhookUrl;
      return request('/v1/orders',{method:'POST',idempotencyKey:operationId,body});
    },
    getOrder(orderId){return request(`/v1/orders/${encodeURIComponent(orderId)}`)},
    getSubscription(subscriptionId){return request(`/preapproval/${encodeURIComponent(subscriptionId)}`)},
    cancelSubscription(subscriptionId){return request(`/preapproval/${encodeURIComponent(subscriptionId)}`,{method:'PUT',body:{status:'cancelled'}})},
    updateSubscriptionAmount(subscriptionId,amount,currency='BRL'){return request(`/preapproval/${encodeURIComponent(subscriptionId)}`,{method:'PUT',body:{auto_recurring:{transaction_amount:Number(amount),currency_id:String(currency||'BRL')}}})},
    getAuthorizedPayment(paymentId){return request(`/authorized_payments/${encodeURIComponent(paymentId)}`)},
    getPayment(paymentId){return request(`/v1/payments/${encodeURIComponent(paymentId)}`)}
  };
}

module.exports={API,pixExternalReference,validNotificationUrl,safeProviderPayload,providerErrorDiagnostics,mercadoPagoService};
