'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {verifyWebhookSignature:verify,signatureManifest,timestampMillis,eventData}=require('../src/services/webhook-service');
const now=1793712000123,secret='synthetic-webhook-secret-only',dataId='ORD01M28P44G5FG8RJPM579EH56FV',xRequestId='2066ca19-c6f1-498a-be75-1923005edd06';
// Deliberately independent of production signatureManifest: pin field order,
// separators, lowercase alphanumeric resource ID and the ORIGINAL ts text.
const manifest=ts=>`id:ord01m28p44g5fg8rjpm579eh56fv;request-id:${xRequestId};ts:${ts};`;
const signed=(ts,overrides={})=>({secret,dataId,xRequestId,now,xSignature:`ts=${ts},v1=${crypto.createHmac('sha256',secret).update(manifest(ts)).digest('hex')}`,...overrides});

for(const ts of ['1793712000','1793712000123'])test(`valid independent HMAC with ${ts.length}-digit ts preserves original signed token`,()=>{
  assert.equal(signatureManifest({dataId,requestId:xRequestId,timestamp:ts}),manifest(ts));
  assert.equal(verify(signed(ts)),true);
  const other=ts.length===10?'1793712000000':'1793712000';
  assert.equal(verify({...signed(ts),xSignature:signed(ts).xSignature.replace(`ts=${ts},`,`ts=${other},`)}),false,'Equivalent time must not reuse another signed token');
});
test('normalization is only for freshness, retaining millisecond precision',()=>{
  assert.equal(timestampMillis('1793712000'),1793712000000);assert.equal(timestampMillis('1793712000123'),now);
  assert.equal(verify(signed(String(now-300000))),true);assert.equal(verify(signed(String(now-300001))),false);
  assert.equal(verify(signed(String(now+1))),false);assert.equal(verify(signed('1793712001')),false);
});
for(const ts of ['', '0','179371200','17937120000','179371200000','17937120001234','0179371200','0179371200123','+1793712000','-1793712000','1793712000.0','1.793712e9','1793712000 ',' 1793712000','1793712000\n','１７９３７１２０００','NaN','Infinity'])test(`reject unexpected timestamp ${JSON.stringify(ts)}`,()=>{
  assert.equal(timestampMillis(ts),null);assert.equal(verify(signed(ts)),false);
});
for(const ts of ['1793711699','1793711700122','1793712001','1793712000124'])test(`reject expired/future valid HMAC ${ts}`,()=>assert.equal(verify(signed(ts)),false));
for(const [name,change]of Object.entries({
  'wrong secret':{secret:'other'},'missing secret':{secret:''},'missing request ID':{xRequestId:''},'request ID array':{xRequestId:[xRequestId]},'request ID duplicate':{xRequestId:xRequestId+','+xRequestId},'request ID injection':{xRequestId:'bad;ts:1793712000'},'request ID whitespace':{xRequestId:' '+xRequestId},'oversize request ID':{xRequestId:'a'.repeat(201)},'missing data ID':{dataId:''},'data ID array':{dataId:[dataId]},'data ID injection':{dataId:dataId+';ts:0'},'changed request ID':{xRequestId:'other-request'},'changed resource':{dataId:'OTHER'},'missing signature':{xSignature:undefined},'signature array':{xSignature:[]},'non-integral clock':{now:now+0.5},'invalid clock':{now:NaN},'age window extension':{maxAgeMs:300001},'disabled age window':{maxAgeMs:0}
}))test(`reject ${name}`,()=>assert.equal(verify(signed('1793712000123',change)),false));
test('reject duplicate/unknown signature components, invalid digests and newline injection',()=>{
  const good=signed('1793712000123');
  for(const xSignature of [good.xSignature+',ts=1793712000123',good.xSignature+',v1='+'a'.repeat(64),good.xSignature+',v2='+'a'.repeat(64),good.xSignature.replace('ts=','ts ='),good.xSignature.replace('v1=','V1='),good.xSignature+'\n',good.xSignature.replace(/v1=.*/, 'v1='+'g'.repeat(64)),good.xSignature.replace(/v1=.*/, 'v1='+'a'.repeat(63)),good.xSignature.replace(/v1=.*/, 'v1='+'a'.repeat(65)),good.xSignature.replace(/v1=./,'v1=0')])assert.equal(verify({...good,xSignature}),false,xSignature);
  assert.equal(verify({...good,xSignature:good.xSignature.split(',').reverse().join(', ')}),true,'Field order/OWS in header does not change the canonical manifest');
});
test('request extraction rejects arrays/objects without coercion and preserves legacy numeric IDs',()=>{
  const scalar=eventData({query:{'data.id':dataId,type:'order'},body:{data:{id:'other'}},headers:{'x-request-id':xRequestId,'x-signature':'ts=1793712000123,v1=x'}});
  assert.equal(scalar.dataId,dataId);assert.equal(scalar.requestId,xRequestId);
  assert.equal(eventData({body:{data:{id:123456}}}).dataId,'123456');
  assert.equal(eventData({query:{'data.id':[dataId]},headers:{'x-request-id':[xRequestId],'x-signature':{bad:true}}}).dataId,'');
  assert.equal(eventData({headers:{'x-request-id':[xRequestId]}}).requestId,'');
  assert.equal(eventData({headers:{'x-signature':{bad:true}}}).xSignature,'');
});
