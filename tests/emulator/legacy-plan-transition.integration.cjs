'use strict';
// Provider responses are synthetic. This suite does not claim genuine Sandbox webhooks.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const backendRequire=require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp}=backendRequire('firebase-admin/app'),{getFirestore}=backendRequire('firebase-admin/firestore');
const {legacyPlanTransitionService}=require('../../functions/src/services/legacy-plan-transition-service');
const {firestoreSubscriptionService}=require('../../functions/src/services/firestore-subscription-service');
const {pixBillingService}=require('../../functions/src/services/pix-billing-service');
const {computeAccess}=require('../../functions/src/services/subscription-service');
const {recurringEntitlementDecision}=require('../../functions/src/services/billing-payment-method-service');
if(!/^127\.0\.0\.1:(8080|8180)$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('loopback emulator required');
const app=initializeApp({projectId:'adi-festa-variations-test'},'approval-first-tests'),db=getFirestore(app);
test.after(()=>deleteApp(app));
async function deliverTwiceWithRetry(deliver){
 // A contention-aborted webhook must be retried, not considered an activation.
 // Emulator sometimes reports aborted transaction leases as INVALID_ARGUMENT.
 const deliveries=await Promise.allSettled([deliver(),deliver()]);
 assert.ok(deliveries.some(result=>result.status==='fulfilled'),'at least one delivery must commit');
 for(const result of deliveries)if(result.status==='rejected'){
  const error=result.reason;assert.ok(error.code===10||error.code===3&&/Transaction is invalid or closed/.test(error.message),String(error));
  console.log('Synthetic duplicate delivery transaction aborted; retrying the unchanged event.');
  await deliver();
 }
}
async function setup(method='card'){
 const businessId='sandbox_approval_'+crypto.randomUUID(),oldId='old_'+crypto.randomUUID(),newId='new_'+crypto.randomUUID(),op=crypto.randomUUID();
 const now=new Date(),end=new Date(+now+30*86400000).toISOString(),oldEnd=new Date(+now+5*86400000).toISOString();
 const sub={planId:'professional',status:'active',hasPaidSubscription:true,currentPeriodEnd:oldEnd,expiresAt:oldEnd,paymentMethodType:'card',mercadoPago:{subscriptionId:oldId}};
 await db.doc('businesses/'+businessId).set({id:businessId,ownerId:'qa-owner',active:true,subscription:sub});
 await db.doc('subscriptionIndex/'+oldId).set({businessId,planId:'professional',chargedPrice:49.9,catalogVersion:1});
 await db.doc('webhookEvents/event_'+op).set({businessId,status:'processed',source:'synthetic-emulator-fixture'});
 let calls=0,remoteStatus='authorized',network=false,lost=false;
 const provider={getSubscription:async()=>({id:oldId,status:remoteStatus,auto_recurring:{transaction_amount:49.9}}),cancelSubscription:async()=>{calls++;if(network)throw Object.assign(Error('network'),{code:'network'});remoteStatus='cancelled';if(lost)throw Error('response-lost');}};
 const service=legacyPlanTransitionService(db,provider),store=firestoreSubscriptionService(db);
 const request={businessId,operationId:op,requestHash:'hash',planId:'essential',billingCycle:'monthly',paymentMethodType:method,actorUid:'qa-owner'};
 const get=async()=>(await db.doc('businesses/'+businessId).get()).data().subscription,job=async()=>(await db.doc('legacyPlanTransitions/'+businessId).get()).data();
 async function prepare(){
  await service.reserve(request);
  const writer=db.batch(),index={businessId,planId:'essential',chargedPrice:29.9,catalogVersion:2,billingCycle:'monthly',paymentMethodType:method,legacyMigrationOperationId:op,operationId:op,internalSubscriptionId:op,status:'pending_payment'};
  if(method==='card')writer.set(db.doc('subscriptionIndex/'+newId),index);
  else{
   Object.assign(index,{providerOrderId:newId,expectedExternalReference:'ref'});
   writer.set(db.doc('billingOrderIndex/'+newId),index);
   writer.set(db.doc('businesses/'+businessId+'/billingCheckoutAttempts/'+op),{businessId,operationId:op,providerOrderId:newId,paymentMethodType:method});
  }
  service.bind({businessId,operationId:op,replacementId:newId,sourceSubscriptionId:oldId,writer});await writer.commit();
 }
 const next={id:newId,status:'authorized',next_payment_date:end,auto_recurring:{transaction_amount:29.9}};
 const apply=status=>store.applyProviderSubscription(next,{source:'webhook',eventId:'event_'+op,activation:{...recurringEntitlementDecision({providerStatus:'authorized',paymentStatus:status,dateApproved:now.toISOString()}),paymentId:'payment_'+newId}});
 return{businessId,oldId,newId,op,sub,end,oldEnd,service,store,provider,request,get,job,prepare,apply,next,calls:()=>calls,remote:()=>remoteStatus,network:value=>network=value,lost:value=>lost=value};
}
test('classification alone never cancels old recurrence; historical cancellation-first jobs are fenced',async()=>{
 const x=await setup();await x.service.enroll(x.businessId);assert.equal((await x.service.process(x.businessId)).skipped,true);assert.equal(x.calls(),0);
 await db.doc('legacyPlanTransitions/'+x.businessId).set({businessId:x.businessId,status:'pending',subscriptionId:x.oldId});
 assert.equal((await x.service.process(x.businessId)).skipped,true);assert.equal(x.calls(),0);
});
test('pending and rejected preserve old subscription and access, do not schedule cancellation',async()=>{
 const x=await setup();await x.prepare();await x.apply('pending');await x.apply('rejected');
 const s=await x.get();assert.equal(s.mercadoPago.subscriptionId,x.oldId);assert.equal(s.planId,x.sub.planId);assert.equal(s.currentPeriodEnd,x.oldEnd);assert.equal(computeAccess(s).canMutate,true);assert.equal(computeAccess(s).features.financeAdvanced,true);
 assert.equal((await x.job()).nextAttemptAt,null);await x.service.process(x.businessId);assert.equal(x.calls(),0);
});
test('explicit approved replacement activates new matrix BEFORE old cancellation; duplicates do not cancel twice',async()=>{
 const x=await setup();await x.prepare();await deliverTwiceWithRetry(()=>x.apply('approved'));
 const activated=await x.get(),job=await x.job();assert.equal(activated.planId,'essential');assert.equal(activated.mercadoPago.subscriptionId,x.newId);assert.equal(activated.legacyPlan,true);assert.equal(activated.expiresAt,x.end);assert.equal(computeAccess(activated).canMutate,true);assert.equal(computeAccess(activated).features.financeAdvanced,false);assert.equal(x.calls(),0);assert.equal(job.approvedPaymentId,'payment_'+x.newId);
 await deliverTwiceWithRetry(()=>x.service.process(x.businessId));
 await x.apply('approved');await x.service.process(x.businessId);
 assert.equal(x.calls(),1);assert.equal(x.remote(),'cancelled');assert.equal((await x.get()).legacyPlan,false);assert.equal((await x.get()).expiresAt,x.end);assert.equal((await x.job()).status,'completed');assert.ok((await x.job()).overlapMilliseconds>=0);
});
test('cancel network failure leaves replacement active and legacy marker; retry safe',async()=>{
 const x=await setup();await x.prepare();await x.apply('approved');x.network(true);await assert.rejects(x.service.process(x.businessId));
 assert.equal((await x.job()).status,'retry');assert.equal((await x.get()).legacyPlan,true);assert.equal(computeAccess(await x.get()).canMutate,true);assert.equal(x.remote(),'authorized');
 x.network(false);await x.service.process(x.businessId);assert.equal((await x.get()).legacyPlan,false);assert.equal(x.remote(),'cancelled');
});
test('lost cancel response is recovered with GET; no second cancel or activation',async()=>{
 const x=await setup();await x.prepare();await x.apply('approved');x.lost(true);await assert.rejects(x.service.process(x.businessId));await x.service.process(x.businessId);
 assert.equal(x.calls(),1);assert.equal((await x.job()).status,'completed');
});
test('unbound approved subscription still conflicts, and authorization alone is not payment proof',async()=>{
 const x=await setup();await db.doc('subscriptionIndex/'+x.newId).set({businessId:x.businessId,planId:'essential',chargedPrice:29.9,catalogVersion:2});
 await assert.rejects(x.apply('approved'),{code:'provider-subscription-conflict'});
 await x.prepare();await assert.rejects(x.store.applyProviderSubscription(x.next),{code:'legacy-payment-proof-required'});assert.equal(x.calls(),0);
});
test('cross-tenant, wrong actor, competing operation and changed request are rejected',async()=>{
 const x=await setup();await assert.rejects(x.service.reserve({...x.request,actorUid:'other'}),{code:'legacy-migration-owner-required'});
 await x.service.reserve(x.request);await x.service.reserve(x.request);
 await assert.rejects(x.service.reserve({...x.request,operationId:crypto.randomUUID()}),{code:'legacy-migration-in-progress'});
 await assert.rejects(x.service.reserve({...x.request,requestHash:'other'}),{code:'legacy-migration-request-conflict'});
 assert.equal((await x.get()).mercadoPago.subscriptionId,x.oldId);
});
test('old webhook after activation cannot restore old plan or revoke new access',async()=>{
 const x=await setup();await x.prepare();await x.apply('approved');
 const result=await x.store.applyProviderSubscription({id:x.oldId,status:'cancelled',auto_recurring:{transaction_amount:49.9}},{source:'old-webhook'});
 assert.equal(result.ignored,true);assert.equal((await x.get()).planId,'essential');assert.equal(computeAccess(await x.get()).canMutate,true);
});
test('terminal rejected attempt can be retried; pending uncertainty cannot create another',async()=>{
 const x=await setup();await x.prepare();await x.apply('rejected');
 await assert.rejects(x.service.reserve({...x.request,operationId:crypto.randomUUID()}),{code:'legacy-migration-in-progress'});
 const terminal={...x.next,status:'cancelled'};await x.store.applyProviderSubscription(terminal);await x.store.applyProviderSubscription(terminal);
 await x.service.reserve({...x.request,operationId:crypto.randomUUID()});assert.equal(x.calls(),0);assert.equal(computeAccess(await x.get()).canMutate,true);
});
test('manual Pix replacement shares same activation-first cancellation job and one payment marker',async()=>{
 const x=await setup('pix_monthly');await x.prepare();
 const order={id:x.newId,status:'processed',status_detail:'accredited',external_reference:'ref',date_created:new Date().toISOString(),transactions:{payments:[{id:'pix_'+x.newId,amount:29.9,payment_method:{id:'pix',type:'bank_transfer'}}]}};
 const service=pixBillingService(db);await deliverTwiceWithRetry(()=>service.applyOrder(order,{source:'webhook',eventId:'event_'+x.op}));
 assert.equal((await x.get()).planId,'essential');assert.equal(computeAccess(await x.get()).features.financeAdvanced,false);assert.equal(x.calls(),0);
 await x.service.process(x.businessId);assert.equal(x.calls(),1);assert.equal((await x.job()).status,'completed');
});
test('cancel job refuses missing payment proof even if a stale job says pending',async()=>{
 const x=await setup();await x.prepare();await db.doc('legacyPlanTransitions/'+x.businessId).update({status:'pending'});
 await assert.rejects(x.service.process(x.businessId),{code:'replacement-activation-required'});assert.equal(x.calls(),0);assert.equal(computeAccess(await x.get()).canMutate,true);
});
test('invalid replacement period aborts activation atomically, with no cancellation',async()=>{
 const x=await setup();await x.prepare();x.next.next_payment_date='invalid';
 await assert.rejects(x.apply('approved'),{code:'legacy-replacement-period-unverified'});
 assert.equal((await x.get()).mercadoPago.subscriptionId,x.oldId);assert.equal((await x.job()).status,'awaiting_payment');assert.equal(x.calls(),0);
});
test('old coupon pricing metadata never leaks into the approved replacement',async()=>{
 const x=await setup();await db.doc('businesses/'+x.businessId).update({'subscription.discount':{originalPrice:49.9,remainingBillingCycles:1,durationType:'billing_cycles'}});
 await x.prepare();await x.apply('approved');assert.equal((await x.get()).discount,undefined);assert.equal((await x.get()).billingStrategy,'recurring_card');
});
test('manual card refusal preserves paid legacy access; a subsequent approved attempt shares the migration engine',async()=>{
 const x=await setup('card_monthly');await x.prepare();
 const service=pixBillingService(db),order={id:x.newId,status:'failed',status_detail:'rejected',external_reference:'ref',transactions:{payments:[{id:'card_'+x.newId,amount:29.9,payment_method:{id:'master',type:'credit_card'}}]}};
 await service.applyOrder(order);assert.equal((await x.get()).mercadoPago.subscriptionId,x.oldId);assert.equal(computeAccess(await x.get()).canMutate,true);assert.equal(x.calls(),0);
 const y=await setup('card_monthly');await y.prepare();await service.applyOrder({...order,id:y.newId,status:'processed',status_detail:'accredited',date_created:new Date().toISOString()},{source:'webhook',eventId:'event_'+y.op});
 assert.equal((await y.get()).planId,'essential');assert.equal(y.calls(),0);await y.service.process(y.businessId);assert.equal(y.calls(),1);
});
test('paid migration without validated webhook preserves old subscription and never schedules cancellation',async()=>{
 const x=await setup();await x.prepare();
 for(const source of ['checkout_return','manual_reconciliation','stale_reconciliation']){
  const result=await x.store.applyProviderSubscription(x.next,{source,activation:{...recurringEntitlementDecision({providerStatus:'authorized',paymentStatus:'approved',dateApproved:new Date().toISOString()}),paymentId:'paid'}});
  assert.equal(result.awaitingWebhook,true);assert.equal((await x.get()).mercadoPago.subscriptionId,x.oldId);assert.equal((await x.job()).activatedAt,null);
 }
 await x.service.process(x.businessId);assert.equal(x.calls(),0);assert.equal(computeAccess(await x.get()).canMutate,true);
});
test('failed or processing webhook cannot cancel old recurrence after activation',async()=>{
 const x=await setup();await x.prepare();await x.apply('approved');
 for(const status of ['processing','failed']){await db.doc('webhookEvents/event_'+x.op).update({status});await assert.rejects(x.service.process(x.businessId),{code:'legacy-webhook-not-completed'});assert.equal(x.calls(),0);}
 await db.doc('webhookEvents/event_'+x.op).update({status:'processed'});await x.service.process(x.businessId);assert.equal(x.calls(),1);
});
test('manual order response cannot bypass webhook gate for legacy migration',async()=>{
 const x=await setup('pix_monthly');await x.prepare();const result=await pixBillingService(db).applyOrder({id:x.newId,status:'processed',status_detail:'accredited',external_reference:'ref',date_created:new Date().toISOString(),transactions:{payments:[{id:'pix_'+x.newId,amount:29.9,payment_method:{id:'pix',type:'bank_transfer'}}]}},{source:'provider_response'});
 assert.equal(result.awaitingWebhook,true);assert.equal((await x.get()).mercadoPago.subscriptionId,x.oldId);assert.equal((await x.job()).activatedAt,null);assert.equal(x.calls(),0);
});
