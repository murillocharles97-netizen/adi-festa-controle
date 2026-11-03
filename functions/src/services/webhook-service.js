'use strict';

const crypto=require('node:crypto');
const MAX_SIGNATURE_AGE_MS=5*60*1000;

function parseSignature(value=''){
  // Reject duplicate/merged headers and unexpected versions instead of choosing
  // whichever value happens to be last. Preserve the exact ts token for HMAC.
  if(typeof value!=='string'||value.length>512||!/^[\x09\x20-\x7e]+$/.test(value))return{};
  const parts=value.split(',');if(parts.length!==2)return{};
  const result={};for(const part of parts){const match=/^(ts|v1)=([^\s=,]+)$/.exec(part.trim());if(!match||Object.hasOwn(result,match[1]))return{};result[match[1]]=match[2];}
  return result;
}
function timestampMillis(value){
  if(typeof value!=='string'||!/^([1-9]\d{9}|[1-9]\d{12})$/.test(value))return null;
  const n=Number(value),ms=value.length===10?n*1000:n;
  return Number.isSafeInteger(ms)?ms:null;
}
function signatureManifest({dataId,requestId,timestamp}){
  let manifest='';
  // Keep the existing documented lowercase convention for alphanumeric data.id;
  // do not lowercase request-id or normalize the signed timestamp.
  if(dataId)manifest+=`id:${String(dataId).toLowerCase()};`;
  if(requestId)manifest+=`request-id:${requestId};`;
  if(timestamp)manifest+=`ts:${timestamp};`;
  return manifest;
}
function safeEqual(a,b){
  const left=Buffer.from(String(a||''),'utf8'),right=Buffer.from(String(b||''),'utf8');
  return left.length===right.length&&crypto.timingSafeEqual(left,right);
}
function verifyWebhookSignature({secret,xSignature,xRequestId,dataId,now=Date.now(),maxAgeMs=MAX_SIGNATURE_AGE_MS}){
  if(typeof secret!=='string'||!secret||typeof xRequestId!=='string'||!/^[-A-Za-z0-9._:]{1,200}$/.test(xRequestId)||typeof dataId!=='string'||!dataId||dataId.length>200||/[;\s]|[^\x21-\x7e]/.test(dataId))return false;
  if(!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<=0||maxAgeMs>MAX_SIGNATURE_AGE_MS)return false;
  const parsed=parseSignature(xSignature),ms=timestampMillis(parsed.ts);
  if(ms===null||!/^[a-f0-9]{64}$/.test(parsed.v1||'')||ms>now||now-ms>maxAgeMs)return false;
  // Only freshness uses normalized milliseconds. Changing parsed.ts here would
  // change the signed message and break authentic 10/13-digit notifications.
  const digest=crypto.createHmac('sha256',secret).update(signatureManifest({dataId,requestId:xRequestId,timestamp:parsed.ts})).digest('hex');
  return safeEqual(digest,parsed.v1);
}
function eventId({type,action,dataId,requestId}){return crypto.createHash('sha256').update([type,action,dataId,requestId].join(':')).digest('hex')}
function eventData(req){
  const body=req.body||{},first=(...values)=>values.find(v=>v!==undefined&&v!==null),text=(v,numeric=false)=>typeof v==='string'?v:numeric&&Number.isSafeInteger(v)&&v>0?String(v):'';
  const header=name=>text(first(req.get?.(name),req.headers?.[name]));
  // Arrays/objects must not become comma-joined IDs or header strings. Legacy
  // numeric body IDs remain supported when no query identifier is present.
  return{type:text(first(req.query?.type,body.type,body.topic)),action:text(first(body.action,req.query?.action)),dataId:text(first(req.query?.['data.id'],req.query?.id,body.data?.id,body.id),true),requestId:header('x-request-id'),xSignature:header('x-signature')};
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

module.exports={parseSignature,timestampMillis,signatureManifest,verifyWebhookSignature,eventId,eventData,readWebhookResource,MAX_SIGNATURE_AGE_MS};
