'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const webhook=require('../src/services/webhook-service');
const {providerErrorDiagnostics}=require('../src/services/mercado-pago-service');
const source=fs.readFileSync(path.join(__dirname,'../src/index.js'),'utf8');
const handlerSource=source.slice(source.indexOf('exports.receiveWebhook='),source.indexOf('exports.retryLegacyPlanMigrations='));
const secret='unit-test-only-secret';
function request(type='subscription_preapproval',id='123456',overrides={},timestamp=String(Math.floor(Date.now()/1000))){
  const ts=timestamp,requestId='test-request',v1=crypto.createHmac('sha256',secret).update(`id:${id};request-id:${requestId};ts:${ts};`).digest('hex');
  return{method:'POST',body:{type,entity:'preapproval',action:'updated',data:{id}},query:{},headers:{'x-request-id':requestId,'x-signature':`ts=${ts},v1=${v1}`},...overrides};
}
function harness({error=null,leaseError=false,reconcileError=null,failErrorPersistence=false,initialRecord=null}={}){
  const calls={reads:[],writes:[],reconciliations:[],logs:[]};let record=initialRecord||{};
  const ref={update:async patch=>{calls.writes.push(patch);Object.assign(record,patch)},set:async patch=>{if(failErrorPersistence)throw Error('database unavailable');calls.writes.push(patch);Object.assign(record,patch)}};
  const db={doc:()=>ref,runTransaction:async callback=>{if(leaseError)throw Error('lease database unavailable');return callback({get:async()=>({data:()=>record}),set:(_,patch)=>{calls.writes.push(patch);Object.assign(record,patch)}})}};
  const provider=Object.fromEntries(['getSubscription','getAuthorizedPayment','getPayment','getOrder'].map(method=>[method,async id=>{calls.reads.push({method,id});if(error)throw error;return{id,preapproval_id:'sub-test',status:'authorized'}}]));
  const exports={};
  vm.runInNewContext(handlerSource,{exports,onRequest:(_,handler)=>handler,REGION:'test',MP_TOKEN:{},MP_TEST_TOKEN:{},MP_WEBHOOK_SECRET:{value:()=>secret},...webhook,db,mp:()=>provider,
    logger:Object.fromEntries(['info','warn','error'].map(level=>[level,(message,data)=>calls.logs.push({level,message,...data})])),
    Timestamp:{fromMillis:ms=>({toMillis:()=>ms})},FieldValue:{serverTimestamp:()=>0,delete:()=>null},providerErrorDiagnostics,
    finishLegacyMigration:async()=>assert.equal(record.status,'processed'),
    providerPaymentResult:()=>({successful:true}),reconcileCardBillingAttempt:async args=>{calls.reconciliations.push(args);if(reconcileError)throw reconcileError;return{result:{businessId:'test-business',subscription:{status:'active'}}}}
  });
  return{calls,async send(req=request()){const response={status(code){this.code=code;return this},send(body){this.body=body;return this}};await exports.receiveWebhook(req,response);return response}};
}
const missing=()=>Object.assign(Error('Provider resource does not exist'),{code:'mercado-pago-error',status:404,endpoint:'/resource/123456'});

for(const type of ['subscription_preapproval','subscription_authorized_payment','payment','order','orders']){
  test(`${type}: signed fictitious resource returns 200 with zero writes`,async()=>{
    const h=harness({error:missing()}),res=await h.send(request(type));
    assert.equal(res.code,200);assert.equal(res.body,'provider-resource-not-found');assert.equal(h.calls.writes.length,0);assert.equal(h.calls.reconciliations.length,0);
    assert.ok(h.calls.logs.some(log=>log.signatureValid===true&&log.providerHttpStatus===404&&log.httpStatus===200));
  });
}
test('signature failure returns 401 before provider lookup or database access',async()=>{
  const h=harness(),res=await h.send(request(undefined,undefined,{headers:{}}));assert.equal(res.code,401);assert.equal(h.calls.reads.length,0);assert.equal(h.calls.writes.length,0);
});
test('safe signature diagnosis distinguishes mismatch and inconsistent identifiers before any effects',async()=>{
  const h=harness(),req=request('order','ORD_AbC');req.query={'data.id':'ORD_AbC'};req.body.data.id='ord_abc';
  assert.equal((await h.send(req)).code,401);assert.equal(h.calls.logs[0].reason,'identifier_mismatch');assert.equal(h.calls.reads.length,0);assert.equal(h.calls.writes.length,0);
  const h2=harness(),req2=request('order','ORD_AbC');req2.headers['x-signature']=req2.headers['x-signature'].replace(/v1=.*/,'v1='+'0'.repeat(64));
  assert.equal((await h2.send(req2)).code,401);assert.equal(h2.calls.logs[0].reason,'hmac_mismatch');
});
test('rejected authentication logs do not echo attacker-controlled values or raw authentication material',async()=>{
  const h=harness(),req=request('private-person@example.invalid','private-resource@example.invalid');req.body.customer={phone:'private-phone-sentinel'};req.headers['x-request-id']='Bearer private-token-sentinel';req.headers['x-signature']='private-signature-sentinel';
  assert.equal((await h.send(req)).code,401);const log=h.calls.logs[0];assert.equal(log.type,'unknown');assert.equal(log.reason,'malformed_signature');
  const all=JSON.stringify(h.calls.logs);for(const value of [secret,'private-person','private-resource','private-phone','private-token','private-signature'])assert.ok(!all.includes(value));
});
for(const [state,reason]of [['processed','replay_processed'],['ignored','replay_ignored'],['processing','replay_in_flight']])test(`structured ${state} replay acknowledgement has zero writes and keeps history`,async()=>{
  const record={status:state,lastErrorCode:'original-history',leaseUntil:{toMillis:()=>Date.now()+60000}},h=harness({initialRecord:record}),req=request();
  const response=await h.send(req);assert.equal(response.code,200);assert.equal(response.body,'already-processing-or-processed');assert.equal(h.calls.writes.length,0);assert.equal(h.calls.reconciliations.length,0);assert.equal(record.status,state);assert.equal(record.lastErrorCode,'original-history');
  const log=h.calls.logs.find(x=>x.message==='[BILLING_WEBHOOK_REPLAY_BLOCKED]');assert.equal(log.reason,reason);assert.equal(log.signatureValid,true);assert.ok(/^[a-f0-9]{64}$/.test(log.eventId));assert.ok(!JSON.stringify(log).includes(req.headers['x-signature']));
});
for(const unit of ['seconds','milliseconds'])test(`Orders ${unit}: authenticated fixture reaches GET only; missing resource has no commercial effects`,async()=>{
  const h=harness({error:missing()}),ts=String(unit==='seconds'?Math.floor(Date.now()/1000):Date.now()),res=await h.send(request('order','ORD_QA_ONLY',{},ts));
  assert.equal(res.code,200);assert.equal(res.body,'provider-resource-not-found');assert.deepEqual(h.calls.reads,[{method:'getOrder',id:'ORD_QA_ONLY'}]);assert.equal(h.calls.writes.length,0);assert.equal(h.calls.reconciliations.length,0);
});
for(const kind of ['expired','future','tampered','duplicate-ts','missing-request-id'])test(`Orders ${kind}: rejected before all provider/database effects`,async()=>{
  const h=harness(),ts=String(Date.now()+(kind==='expired'?-300001:kind==='future'?60000:-10)),req=request('order','ORD_QA_ONLY',{},ts);
  if(kind==='tampered')req.headers['x-signature']=req.headers['x-signature'].replace(/v1=.*/,'v1='+'0'.repeat(64));
  if(kind==='duplicate-ts')req.headers['x-signature']+=`,ts=${ts}`;
  if(kind==='missing-request-id')delete req.headers['x-request-id'];
  assert.equal((await h.send(req)).code,401);assert.equal(h.calls.reads.length,0);assert.equal(h.calls.writes.length,0);assert.equal(h.calls.reconciliations.length,0);
});
test('changing only timestamp unit cannot bypass duplicate event lease',async()=>{
  const h=harness(),ts=Date.now()-10;
  assert.equal((await h.send(request(undefined,undefined,{},String(Math.floor(ts/1000))))).code,200);
  assert.equal((await h.send(request(undefined,undefined,{},String(ts)))).code,200);
  assert.equal(h.calls.reconciliations.length,1);assert.equal(h.calls.writes.length,2);
});
test('unknown signed event and plan event are acknowledged without reads or writes',async()=>{
  for(const type of ['unknown','subscription_preapproval_plan','constructor','__proto__']){const h=harness(),res=await h.send(request(type));assert.equal(res.code,200);assert.equal(h.calls.reads.length,0);assert.equal(h.calls.writes.length,0)}
});
test('malformed signed identifier returns 400 without provider or database writes',async()=>{
  const h=harness(),res=await h.send(request('subscription_preapproval','../bad'));assert.equal(res.code,400);assert.equal(h.calls.reads.length,0);assert.equal(h.calls.writes.length,0);
});
for(const status of [401,403,429,500,503,null])test(`provider ${status||'network failure'} is not swallowed`,async()=>{
  const error=Object.assign(Error('Provider unavailable'),{code:status?'mercado-pago-error':'mercado-pago-network-error',status}),h=harness({error}),res=await h.send();
  assert.equal(res.code,500);assert.equal(h.calls.writes.length,0);assert.equal(h.calls.logs.find(log=>log.level==='error').stage,'provider-resource-lookup');
});
test('valid subscription reuses verified resource and duplicate event does not reconcile twice',async()=>{
  const h=harness();assert.equal((await h.send()).code,200);assert.equal((await h.send()).code,200);
  assert.equal(h.calls.reconciliations.length,1);assert.equal(h.calls.reconciliations[0].verifiedProvider.id,'123456');assert.equal(h.calls.writes.length,2);
});
test('concurrent duplicate preserves existing event lease',async()=>{
  const h=harness();const results=await Promise.all([h.send(),h.send()]);assert.ok(results.every(result=>result.code===200));assert.equal(h.calls.reconciliations.length,1);
});
test('real resource without internal index remains retryable, not silently discarded',async()=>{
  const h=harness({reconcileError:Object.assign(Error('Missing index'),{code:'subscription-index-not-found'})}),res=await h.send();
  assert.equal(res.code,500);assert.equal(h.calls.writes.at(-1).status,'failed');
});
test('transaction failure and failure-persistence failure return controlled HTTP errors',async()=>{
  const h=harness({leaseError:true});assert.equal((await h.send()).code,500);assert.equal(h.calls.writes.length,0);
  const h2=harness({reconcileError:Error('reconcile failure'),failErrorPersistence:true});assert.equal((await h2.send()).code,500);assert.ok(h2.calls.logs.some(log=>log.stage==='failure-persistence'));
});
test('body/query topic discrepancy is visible without logging secrets or full payloads',async()=>{
  const h=harness({error:missing()});await h.send(request('subscription_preapproval','123456',{query:{type:'subscription_authorized_payment'}}));
  const log=h.calls.logs.find(item=>item.message==='[BILLING_WEBHOOK_RECEIVED]');assert.equal(log.bodyType,'subscription_preapproval');assert.equal(log.eventType,'subscription_authorized_payment');
  assert.equal(h.calls.reads[0].method,'getAuthorizedPayment');assert.ok(!JSON.stringify(h.calls.logs).includes(secret));assert.ok(!JSON.stringify(h.calls.logs).includes('x-signature'));
});
test('webhook cannot mark indexed subscription closed when related preapproval returns 404',async()=>{
  const start=source.indexOf('async function reconcileCardBillingAttempt('),end=source.indexOf('\nconst operationId=',start);let writes=0;
  const context={providerStore:()=>({resolveIndex:async()=>({businessId:'test-business'})}),mp:()=>({getSubscription:async()=>{throw missing()}}),db:{batch:()=>{writes++;throw Error('must not write')}}};
  vm.runInNewContext(source.slice(start,end)+'\nthis.reconcile=reconcileCardBillingAttempt;',context);
  await assert.rejects(context.reconcile({subscriptionId:'123456',source:'webhook'}),error=>error.status===404);assert.equal(writes,0);
});
