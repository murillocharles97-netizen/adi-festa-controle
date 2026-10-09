'use strict';

const crypto=require('node:crypto');

function parseSignature(value=''){
  return Object.fromEntries(String(value).split(',').map(part=>part.trim().split('=')).filter(parts=>parts.length===2));
}
function signatureManifest({dataId,requestId,timestamp}){
  let manifest='';
  if(dataId)manifest+=`id:${String(dataId).toLowerCase()};`;
  if(requestId)manifest+=`request-id:${requestId};`;
  if(timestamp)manifest+=`ts:${timestamp};`;
  return manifest;
}
function safeEqual(a,b){
  const left=Buffer.from(String(a||''),'utf8'),right=Buffer.from(String(b||''),'utf8');
  return left.length===right.length&&crypto.timingSafeEqual(left,right);
}
function verifyWebhookSignature({secret,xSignature,xRequestId,dataId,now=Date.now(),maxAgeMs=5*60*1000}){
  if(!secret||!xSignature||!xRequestId||!dataId)return false;
  const parsed=parseSignature(xSignature),timestamp=Number(parsed.ts);
  if(!timestamp||!parsed.v1||Math.abs(now-timestamp*1000)>maxAgeMs)return false;
  const digest=crypto.createHmac('sha256',secret).update(signatureManifest({dataId,requestId:xRequestId,timestamp:parsed.ts})).digest('hex');
  return safeEqual(digest,parsed.v1);
}
function eventId({type,action,dataId,requestId}){return crypto.createHash('sha256').update([type,action,dataId,requestId].join(':')).digest('hex')}
function eventData(req){
  const body=req.body||{},dataId=String(req.query?.['data.id']||req.query?.id||body.data?.id||body.id||'');
  return{type:String(req.query?.type||body.type||body.topic||''),action:String(body.action||req.query?.action||''),dataId,requestId:String(req.get?.('x-request-id')||req.headers?.['x-request-id']||''),xSignature:String(req.get?.('x-signature')||req.headers?.['x-signature']||'')};
}

// Resolve only the resource named by the signed notification. A missing resource
// is not a subscription cancellation and must never mutate business data.
async function readWebhookResource(event,provider){
  if(!/^[a-zA-Z0-9_-]{1,200}$/.test(event.dataId)||!event.type){
    return{httpStatus:400,reason:'invalid-event'};
  }
  const methods={subscription_preapproval:'getSubscription',subscription_authorized_payment:'getAuthorizedPayment',payment:'getPayment',order:'getOrder',orders:'getOrder'};
  const method=Object.hasOwn(methods,event.type)?methods[event.type]:null;
  if(!method)return{httpStatus:200,reason:event.type==='subscription_preapproval_plan'?'provider-plan-event':'unsupported-event-type'};
  try{return{resource:await provider[method](event.dataId)}}catch(error){
    // Do not acknowledge authentication, throttling, network or backend failures.
    if(error?.code==='mercado-pago-error'&&error?.status===404){
      return{httpStatus:200,reason:'provider-resource-not-found',providerHttpStatus:404,endpoint:error.endpoint||null};
    }
    throw error;
  }
}

module.exports={parseSignature,signatureManifest,verifyWebhookSignature,eventId,eventData,readWebhookResource};
