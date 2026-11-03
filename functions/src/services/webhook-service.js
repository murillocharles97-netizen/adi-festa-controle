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
  // Match the current official SDK: preserve resource/request ID case and the
  // ORIGINAL timestamp token. Freshness normalization must not affect HMAC.
  if(dataId)manifest+=`id:${String(dataId)};`;
  if(requestId)manifest+=`request-id:${requestId};`;
  if(timestamp)manifest+=`ts:${timestamp};`;
  return manifest;
}
function safeEqual(a,b){
  const left=Buffer.from(String(a||''),'utf8'),right=Buffer.from(String(b||''),'utf8');
  return left.length===right.length&&crypto.timingSafeEqual(left,right);
}
function validateWebhookSignature({secret,xSignature,xRequestId,dataId,identifierIssue=null,headerIssue=null,now=Date.now(),maxAgeMs=MAX_SIGNATURE_AGE_MS}={}){
  // This return value is an explicit log-safe allowlist. Never include input
  // values, signatures, secret fingerprints, payloads or the signed manifest.
  const meta={signaturePresent:typeof xSignature==='string'&&xSignature.trim().length>0,requestIdPresent:typeof xRequestId==='string'&&xRequestId.length>0,identifierPresent:typeof dataId==='string'&&dataId.length>0,timestampDigits:null,timestampState:'unparsed'};
  const result=(valid,reason)=>({valid,reason,...meta});
  if(typeof secret!=='string'||!secret||!Number.isSafeInteger(now)||now<=0||!Number.isSafeInteger(maxAgeMs)||maxAgeMs<=0||maxAgeMs>MAX_SIGNATURE_AGE_MS)return result(false,'verifier_unavailable');
  if(headerIssue)return result(false,['malformed_signature','invalid_request_id'].includes(headerIssue)?headerIssue:'malformed_signature');
  if(xSignature===undefined||xSignature===null||typeof xSignature==='string'&&!xSignature.trim())return result(false,'missing_signature');
  const parsed=parseSignature(xSignature);
  if(!parsed.ts||!/^[a-f0-9]{64}$/.test(parsed.v1||''))return result(false,'malformed_signature');
  if(!meta.requestIdPresent)return result(false,xRequestId===undefined||xRequestId===null||xRequestId===''?'missing_request_id':'invalid_request_id');
  if(!/^[-A-Za-z0-9._:]{1,200}$/.test(xRequestId))return result(false,'invalid_request_id');
  if(identifierIssue)return result(false,['missing_identifier','invalid_identifier','identifier_mismatch'].includes(identifierIssue)?identifierIssue:'invalid_identifier');
  if(!meta.identifierPresent)return result(false,dataId===undefined||dataId===null||dataId===''?'missing_identifier':'invalid_identifier');
  if(dataId.length>200||/[;\s]|[^\x21-\x7e]/.test(dataId))return result(false,'invalid_identifier');
  const ms=timestampMillis(parsed.ts);
  meta.timestampDigits=/^\d{10}$|^\d{13}$/.test(parsed.ts)?parsed.ts.length:null;
  if(ms===null){meta.timestampState='invalid';return result(false,'invalid_timestamp');}
  if(ms>now){meta.timestampState='future';return result(false,'future_timestamp');}
  if(now-ms>maxAgeMs){meta.timestampState='expired';return result(false,'expired_timestamp');}
  meta.timestampState='within_window';
  const digest=crypto.createHmac('sha256',secret).update(signatureManifest({dataId,requestId:xRequestId,timestamp:parsed.ts})).digest('hex');
  return safeEqual(digest,parsed.v1)?result(true,'authenticated'):result(false,'hmac_mismatch');
}
// Keep the boolean API for existing local callers; decisions and diagnostics
// both come from the same verifier, without an alternative signature fallback.
function verifyWebhookSignature(input){return validateWebhookSignature(input).valid;}
function eventId({type,action,dataId,requestId}){return crypto.createHash('sha256').update([type,action,dataId,requestId].join(':')).digest('hex')}
function eventData(req){
  const body=req.body||{},first=(...values)=>values.find(v=>v!==undefined&&v!==null),text=(v,numeric=false)=>typeof v==='string'?v:numeric&&Number.isSafeInteger(v)&&v>0?String(v):'';
  const header=name=>first(req.get?.(name),req.headers?.[name]),signature=header('x-signature'),requestId=header('x-request-id');
  // Arrays/objects must not become comma-joined IDs or header strings. Legacy
  // numeric body IDs remain supported when no query identifier is present.
  // body.id is often the NOTIFICATION ID, not the resource ID. Compare it only
  // for the legacy fallback when body.data.id is absent.
  const queryIds=[req.query?.['data.id'],req.query?.id].filter(v=>v!==undefined&&v!==null),bodyId=first(body.data?.id,queryIds.length?undefined:body.id),candidates=[...queryIds,bodyId].filter(v=>v!==undefined&&v!==null),ids=candidates.map(v=>text(v,true)),dataId=ids[0]||'';
  const identifierIssue=!candidates.length?'missing_identifier':ids.some(v=>!v)?'invalid_identifier':ids.some(v=>v!==dataId)?'identifier_mismatch':null;
  const headerIssue=signature!=null&&typeof signature!=='string'?'malformed_signature':requestId!=null&&typeof requestId!=='string'?'invalid_request_id':null;
  return{type:text(first(req.query?.type,body.type,body.topic)),action:text(first(body.action,req.query?.action)),dataId,identifierIssue,headerIssue,requestId:text(requestId),xSignature:text(signature)};
}

function webhookReplayReason(record={},now=Date.now()){
  if(record.status==='processed')return'replay_processed';
  if(record.status==='ignored')return'replay_ignored';
  if(record.status==='processing'&&record.leaseUntil?.toMillis?.()>now)return'replay_in_flight';
  return null;
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

module.exports={parseSignature,timestampMillis,signatureManifest,validateWebhookSignature,verifyWebhookSignature,eventId,eventData,webhookReplayReason,readWebhookResource,MAX_SIGNATURE_AGE_MS};
