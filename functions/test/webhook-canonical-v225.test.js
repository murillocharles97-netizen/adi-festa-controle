'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {validateWebhookSignature:validate,verifyWebhookSignature:verify,signatureManifest,eventData,webhookReplayReason}=require('../src/services/webhook-service');
const now=1793712000123,secret='synthetic-canonical-secret-only',requestId='QA-MixedCase-Request';
const sign=(id,ts,overrides={})=>({secret,dataId:id,xRequestId:requestId,now,xSignature:`ts=${ts},v1=${crypto.createHmac('sha256',secret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex')}`,...overrides});
for(const id of ['ORD01M6G4D8WNBFZV2YZS22GAPZJ9','ord_test_lower','Qa_Order_AbC123','abc123def456','123456','9876543210123'])for(const ts of ['1793712000','1793712000123'])test(`canonical independent HMAC: ${id}, ${ts.length} digits`,()=>{
  assert.equal(signatureManifest({dataId:id,requestId,timestamp:ts}),`id:${id};request-id:${requestId};ts:${ts};`);
  const result=validate(sign(id,ts));assert.equal(result.valid,true);assert.equal(result.reason,'authenticated');assert.equal(result.timestampDigits,ts.length);assert.equal(result.timestampState,'within_window');
  if(id!==id.toLowerCase())assert.equal(validate({...sign(id.toLowerCase(),ts),dataId:id}).reason,'hmac_mismatch','No legacy lowercase-signature fallback');
  assert.equal(validate({...sign(id,ts),xRequestId:requestId.toLowerCase()}).reason,'hmac_mismatch');
});

const base=()=>sign('ORD_QA_ONLY','1793712000123');
for(const [name,overrides,reason]of [
 ['absent signature',{xSignature:''},'missing_signature'],['non-string signature',{xSignature:['bad']},'malformed_signature'],['duplicate header',{xSignature:base().xSignature+',ts=1793712000123'},'malformed_signature'],['invalid digest',{xSignature:'ts=1793712000123,v1=not-a-digest'},'malformed_signature'],['missing request ID',{xRequestId:''},'missing_request_id'],['invalid request ID',{xRequestId:'private@example.invalid;other:value'},'invalid_request_id'],['missing resource',{dataId:''},'missing_identifier'],['invalid resource',{dataId:['ORD_QA_ONLY']},'invalid_identifier'],['resource inconsistency',{identifierIssue:'identifier_mismatch'},'identifier_mismatch'],['tampered ID',{dataId:'ORD_QA_OTHER'},'hmac_mismatch'],['unavailable verifier',{secret:''},'verifier_unavailable'],['invalid time',{...sign('ORD_QA_ONLY','1793712000.1')},'invalid_timestamp'],['expired seconds',{...sign('ORD_QA_ONLY','1793711699')},'expired_timestamp'],['expired milliseconds',{...sign('ORD_QA_ONLY','1793711700122')},'expired_timestamp'],['future seconds',{...sign('ORD_QA_ONLY','1793712001')},'future_timestamp'],['future milliseconds',{...sign('ORD_QA_ONLY','1793712000124')},'future_timestamp']
])test(`structured diagnosis distinguishes ${name}`,()=>{
  const input={...base(),...overrides},result=validate(input);assert.equal(result.valid,false);assert.equal(verify(input),false);assert.equal(result.reason,reason);
  assert.deepEqual(Object.keys(result).sort(),['valid','reason','signaturePresent','requestIdPresent','identifierPresent','timestampDigits','timestampState'].sort());
  const log=JSON.stringify(result);assert.ok(!log.includes(secret));assert.ok(!log.includes('private@example.invalid'));assert.ok(!log.includes('v1='));assert.ok(!log.includes('ORD_QA'));assert.ok(!log.includes(requestId));
});
test('five-minute boundary and strict future rejection in both units',()=>{
  assert.equal(validate(sign('123','1793711700000',{now:1793712000000})).valid,true);
  assert.equal(validate(sign('123','1793711700',{now:1793712000000})).valid,true);
  assert.equal(validate(sign('123','1793711700',{now:1793712000001})).reason,'expired_timestamp');
  assert.equal(validate(sign('123','1793712000001',{now:1793712000000})).reason,'future_timestamp');
  assert.equal(validate(sign('123','1793712001',{now:1793712000000})).reason,'future_timestamp');
});
test('query/body resource identity must match exactly; notification ID is independent',()=>{
  for(const body of [{id:'independent-notification',data:{id:'ORD_AbC'}},{id:'independent-notification'}]){
    const event=eventData({query:{'data.id':'ORD_AbC'},body});assert.equal(event.dataId,'ORD_AbC');assert.equal(event.identifierIssue,null);
  }
  assert.equal(eventData({query:{'data.id':'ORD_AbC',id:'ORD_AbC'},body:{data:{id:'ORD_AbC'}}}).identifierIssue,null);
  assert.equal(eventData({query:{'data.id':'ORD_AbC'},body:{data:{id:'ord_abc'}}}).identifierIssue,'identifier_mismatch');
  assert.equal(eventData({query:{'data.id':'ORD_AbC',id:'ORD_Other'}}).identifierIssue,'identifier_mismatch');
  assert.equal(eventData({query:{'data.id':['ORD_AbC']}}).identifierIssue,'invalid_identifier');
  assert.equal(eventData({body:{data:{id:123456}}}).dataId,'123456');
  assert.equal(eventData({body:{id:123456}}).identifierIssue,null);
  assert.equal(eventData({}).identifierIssue,'missing_identifier');
});
test('malformed header values survive extraction only as safe diagnostic codes',()=>{
  const event=eventData({headers:{'x-signature':['bad'],'x-request-id':requestId},query:{'data.id':'ORD_QA_ONLY'}});
  assert.equal(event.headerIssue,'malformed_signature');assert.equal(validate({...base(),...event,secret,now}).reason,'malformed_signature');
  const event2=eventData({headers:{'x-signature':base().xSignature,'x-request-id':['bad']},query:{'data.id':'ORD_QA_ONLY'}});
  assert.equal(event2.headerIssue,'invalid_request_id');assert.equal(validate({...base(),...event2,secret,now}).reason,'invalid_request_id');
});
test('replay decisions preserve terminal states and live lease while permitting bounded retries',()=>{
  assert.equal(webhookReplayReason({status:'processed'},now),'replay_processed');assert.equal(webhookReplayReason({status:'ignored'},now),'replay_ignored');
  assert.equal(webhookReplayReason({status:'processing',leaseUntil:{toMillis:()=>now+1}},now),'replay_in_flight');
  assert.equal(webhookReplayReason({status:'processing',leaseUntil:{toMillis:()=>now}},now),null);
  assert.equal(webhookReplayReason({status:'failed'},now),null);assert.equal(webhookReplayReason({},now),null);
});
