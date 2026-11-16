'use strict';
// Real Auth/Firestore Emulator and candidate callable handlers. MP HTTP is a
// deterministic contract adapter; never real charges or real cancellations.
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto'),fs=require('node:fs');
const project='demo-v224-blockers'; // Auth Emulator configured demo project; all company/UID values below are unique and synthetic.
const path=require('node:path'),runtime=path.resolve(process.env.BILLING_TEST_RUNTIME||'functions'),fromRuntime=p=>require(path.join(runtime,p));
Object.assign(process.env,{GCLOUD_PROJECT:project,GOOGLE_CLOUD_PROJECT:project,FIREBASE_CONFIG:JSON.stringify({projectId:project,storageBucket:project+'.appspot.com'}),FIRESTORE_EMULATOR_HOST:'127.0.0.1:8188',FIREBASE_AUTH_EMULATOR_HOST:'127.0.0.1:9298',MERCADO_PAGO_ENV:'test',MERCADO_PAGO_ACCESS_TOKEN:'qa-not-a-real-token',MERCADO_PAGO_ACCESS_TOKEN_TEST:'qa-not-a-real-token',MERCADO_PAGO_WEBHOOK_SECRET:'qa-hmac-only',MERCADO_PAGO_PUBLIC_KEY:'TEST-'+'a'.repeat(24)});
Object.assign(process.env,{ADI_FESTA_APP_URL:'http://127.0.0.1/qa',MERCADO_PAGO_WEBHOOK_URL:'https://example.invalid/qa-webhook'});
process.env.BILLING_NEW_AUTOMATIC_CHECKOUTS_ENABLED='true';
const req=require('node:module').createRequire(require('node:path').resolve('functions/package.json')),{getFirestore,Timestamp}=req('firebase-admin/firestore'),{getAuth}=req('firebase-admin/auth');
const sdk=require('firebase/firestore'),{initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const {idFor}=fromRuntime('src/services/legacy-checkout-recovery-service'),{billingExternalReference}=fromRuntime('src/services/mercado-pago-service'),{signatureManifest}=fromRuntime('src/services/webhook-service'),{computeAccess}=fromRuntime('src/services/subscription-service');
const orders=new Map(),contracts=new Map(),payments=new Map(),providerCalls=[],originalFetch=global.fetch;let db,env,forceSearchError=false,forceUnsupported=false,loseNextOrderReply=false,loseNextContractReply=false,pauseNextOrder=null,nextCardChallenge=false;
const json=(v,status=200)=>new Response(JSON.stringify(v),{status,headers:{'Content-Type':'application/json'}});
global.fetch=async(input,options={})=>{
 const u=new URL(typeof input==='string'?input:input.url||input.toString());
 if(u.host!=='api.mercadopago.com'){assert.ok(['127.0.0.1','localhost'].includes(u.hostname),'No real external endpoint is permitted in QA');return originalFetch(input,options);}
 const method=options.method||'GET';providerCalls.push({method,path:u.pathname});
 if(u.pathname==='/v1/orders'&&method==='GET'){
  if(forceSearchError)return json({message:'QA unavailable'},503);
  const rows=[...orders.values()].filter(o=>o.external_reference===u.searchParams.get('external_reference'));return json({data:rows,paging:{total:String(rows.length)}});
 }
 if(u.pathname==='/v1/orders'&&method==='POST'){
  if(forceUnsupported)return json({errors:[{code:'unsupported_properties',message:'Properties not supported'}]},400);
  const body=JSON.parse(options.body);assert.equal(body.notification_url,undefined);assert.equal(body.total_amount,'119.90');assert.equal(body.transactions.payments[0].amount,'119.90');
  const id='QA_ORDER_'+crypto.randomBytes(8).toString('hex'),payment=body.transactions.payments[0],order={...body,id,currency:'BRL',created_date:new Date().toISOString(),last_updated_date:new Date().toISOString(),status:'action_required',status_detail:'waiting_transfer',transactions:{payments:[{...payment,id:'pay_'+id,status:'action_required',payment_method:{...payment.payment_method,qr_code:'qa-only-qr',qr_code_base64:'cWE=',ticket_url:'https://example.invalid/qa'}}]}};
  if(payment.payment_method.type==='credit_card'){assert.ok(options.headers['X-meli-session-id'].startsWith('armor.'));assert.deepEqual(body.config.online.transaction_security,{validation:'on_fraud_risk',liability_shift:'required'});if(nextCardChallenge){nextCardChallenge=false;order.status_detail='pending_challenge';order.transactions.payments[0].payment_method.transaction_security={url:'https://www.mercadopago.com.br/challenge/qa',status:'pending'};}else{order.status='processed';order.status_detail='accredited';order.transactions.payments[0].status='processed';}}
  orders.set(id,order);if(pauseNextOrder){const pause=pauseNextOrder;pauseNextOrder=null;await pause();}if(loseNextOrderReply){loseNextOrderReply=false;throw Error('QA timeout after provider persistence');}return json(order,201);
 }
 if(u.pathname.startsWith('/v1/orders/'))return orders.has(u.pathname.split('/').pop())?json(orders.get(u.pathname.split('/').pop())):json({message:'not found'},404);
 if(u.pathname==='/authorized_payments/search'){
  const id=u.searchParams.get('preapproval_id'),entry=contracts.get(id);if(!entry)return json({message:'not found'},404);
  entry.searchCount=(entry.searchCount||0)+1;
  if(entry.scheduleOnSearch===entry.searchCount){entry.invoiceStatus='scheduled';entry.nextRetryDate=new Date(Date.now()+3600000).toISOString();}
  const rows=entry.invoices||[{id:'qa-old-invoice',preapproval_id:id,status:entry.invoiceStatus||'processed',retry_attempt:1,...(entry.nextRetryDate!==undefined?{next_retry_date:entry.nextRetryDate}:{}),debit_date:new Date().toISOString(),payment:{id:'qa-old-rejected-payment',status:entry.paymentStatus||'rejected'}}],offset=Number(u.searchParams.get('offset')||0);
  return json({results:rows.slice(offset,offset+10),...(entry.incompleteInvoices?{}:{paging:{offset,limit:10,total:rows.length}})});
 }
 if(u.pathname.startsWith('/authorized_payments/')){
  const id=u.pathname.split('/').pop(),invoice=[...contracts.values()].flatMap(entry=>entry.invoices||[]).find(row=>row.id===id);
  return invoice?json(invoice):json({message:'not found'},404);
 }
 if(u.pathname==='/v1/payments/search'){
  const reference=u.searchParams.get('external_reference'),limit=Number(u.searchParams.get('limit')),offset=Number(u.searchParams.get('offset'));
  const rows=[...payments.values()].filter(payment=>payment.external_reference===reference);
  return json({results:rows.slice(offset,offset+limit),paging:{limit,offset,total:rows.length}});
 }
 if(u.pathname.startsWith('/v1/payments/')){
  const p=payments.get(u.pathname.split('/').pop());return p?json(p):json({message:'not found'},404);
 }
 if(u.pathname==='/preapproval'&&method==='POST'){
  const body=JSON.parse(options.body),id='QA_CONTRACT_'+crypto.randomBytes(8).toString('hex');
  const value={...body,id,init_point:'https://example.invalid/qa/'+id,last_modified:new Date().toISOString()};
  contracts.set(id,{value,businessId:body.metadata.business_id,invoices:[],cancels:0,modern:true});
  if(loseNextContractReply){loseNextContractReply=false;throw Error('QA response lost after contract creation');}
  return json(value,201);
 }
 if(u.pathname==='/preapproval/search'){
  const rows=[...contracts.values()].map(x=>x.value).filter(x=>x.payer_email===u.searchParams.get('payer_email'));
  const offset=Number(u.searchParams.get('offset'));return json({results:rows.slice(offset,offset+20),paging:{total:rows.length,offset,limit:20}});
 }
 if(u.pathname.startsWith('/preapproval/')){
  const id=u.pathname.split('/').pop(),entry=contracts.get(id);if(!entry)return json({message:'not found'},404);
  if(method==='PUT'){assert.equal(JSON.parse(options.body).status,'cancelled');if(!entry.modern)assert.equal((await db.doc('businesses/'+entry.businessId).get()).data().subscription.catalogVersion,2,'New plan must activate before old cancellation');entry.value.status='cancelled';entry.cancels++;}
  return json(entry.value);
 }
 throw Error('Unmapped MP contract route '+method+' '+u.pathname);
};
const functions={...fromRuntime('src/index.js')};
const runtimeOverrides=JSON.parse(process.env.BILLING_QA_FUNCTION_RUNTIMES||'{}');
for(const [name,folder] of Object.entries(runtimeOverrides)){
  assert.equal(typeof functions[name],'function',name);
  functions[name]=require(path.resolve(folder,'src/index.js'))[name];
  assert.equal(typeof functions[name],'function',name);
}
test.before(async()=>{db=getFirestore();env=await initializeTestEnvironment({projectId:project,firestore:{rules:fs.readFileSync('tests/fixtures/billing-v225-published.rules','utf8')}});});
test.after(async()=>{global.fetch=originalFetch;await env?.cleanup();await Promise.all(req('firebase-admin/app').getApps().map(app=>req('firebase-admin/app').deleteApp(app)));});
async function identity(role,bid){
 const uid='qa-'+role+'-'+crypto.randomBytes(8).toString('hex'),email=uid+'@example.invalid',password=crypto.randomBytes(20).toString('hex')+'Aa1!';await getAuth().createUser({uid,email,password});
 const r=await fetch('http://127.0.0.1:9298/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=qa-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})}),v=await r.json();assert.ok(v.idToken,v.error?.message||'QA sign-in failed');
 await db.doc('users/'+uid).set({uid,email,businessId:bid,role,active:true});return{uid,email,idToken:v.idToken};
}
async function seed({stuck=false,proof=false}={}){
 const bid='qa-billing-'+crypto.randomBytes(8).toString('hex'),owner=await identity('owner',bid),seller=await identity('seller',bid),oldId='qa-old-'+crypto.randomBytes(8).toString('hex'),op=crypto.randomUUID(),root=db.doc('businesses/'+bid),paidThrough=new Date(Date.now()-86400000).toISOString(),graceEnd=new Date(Date.now()+48*3600000).toISOString();
 const sub={planId:'premium',status:'pending',subscriptionStatus:'pending',hasPaidSubscription:true,legacyPlan:true,currentPeriodEnd:paidThrough,lastPaymentStatus:'rejected',paymentMethodType:'card',mercadoPago:{subscriptionId:oldId,preapprovalId:oldId},discount:{couponCodeSnapshot:'QA_OLD',discountValue:37,originalPrice:79.9,discountedPrice:50.34},legacyTransition:{source:'administrative_incident',paidThrough:graceEnd,paidThroughAt:Timestamp.fromDate(new Date(graceEnd))},administrativeAccess:{id:'qa-grace',financialConfirmation:false,startsAt:Timestamp.now(),endsAt:Timestamp.fromDate(new Date(graceEnd))}};
 await root.set({id:bid,name:'QA only',active:true,ownerId:owner.uid,workspaceGeneration:0,subscription:sub});
 for(const [person,role]of [[owner,'owner'],[seller,'seller']])await root.collection('members').doc(person.uid).set({uid:person.uid,role,status:'active',spaceAccess:'all',allowedSpaceIds:[],permissions:role==='owner'?{}:{'sales.create':true}});
 const oldReference=billingExternalReference(bid,'qa-old-original');await db.doc('subscriptionIndex/'+oldId).set({businessId:bid,ownerId:owner.uid,catalogVersion:1,planId:'premium',chargedPrice:50.34,officialPrice:79.9,status:'approved',expectedExternalReference:oldReference});
 contracts.set(oldId,{businessId:bid,cancels:0,value:{id:oldId,status:'cancelled',external_reference:oldReference,next_payment_date:new Date(Date.now()+30*86400000).toISOString(),auto_recurring:{transaction_amount:50.34,currency_id:'BRL',frequency:1,frequency_type:'months'}}});
 if(stuck){const createdAt=Timestamp.fromMillis(Date.now()-86400000),requestHash='qa-original-hash';await db.doc('legacyPlanTransitions/'+bid).set({businessId:bid,mode:'approval_first',operationId:op,requestHash,actorUid:owner.uid,subscriptionId:oldId,recurring:true,paidThrough,targetPlanId:'premium',billingCycle:'monthly',paymentMethodType:'pix_monthly',status:'creating',replacementId:null,activatedAt:null,approvedPaymentId:null,createdAt});await root.collection('billingCheckoutAttempts').doc(op).set({businessId:bid,requestedBy:owner.uid,operationId:op,requestHash,planId:'premium',billingCycle:'monthly',paymentMethodType:'pix_monthly',status:'failed',errorCode:'mercado-pago-error',createdAt});if(proof)await db.doc('billingMigrationRepairAuthorizations/'+idFor(bid,op)).set({businessId:bid,operationId:op,requestHash,expectedExternalReference:billingExternalReference(bid,op),providerHttpStatus:400,outcome:'rejected_before_creation',authority:'platform_admin',verifiedAt:Timestamp.now(),expiresAt:Timestamp.fromMillis(Date.now()+3600000)});}
 return{bid,owner,seller,oldId,op,root,graceEnd,paidThrough,sub};
}
async function invoke(name,c,data={},person=c.owner){const token=await getAuth().verifyIdToken(person.idToken);return functions[name].run({auth:{uid:token.uid,token},data:{companyId:c.bid,...data}});}
const recover=c=>invoke('createSubscription',c,{action:'recover_failed_migration',operationId:c.op,confirmed:true});
async function create(c,method='pix_monthly'){
 const operationId=crypto.randomUUID(),more=method==='card_monthly'?{billingPayerEmail:c.owner.email,deviceSessionId:'armor.'+'a'.repeat(225),cardPayment:{token:'qa_card_token_not_real_12345',payment_method_id:'visa',installments:1}}:{};
 const result=await invoke('createSubscription',c,{catalogVersion:2,legacyMigration:true,planId:'premium',billingCycle:'monthly',operationId,paymentMethodType:method,...more});return{operationId,result,orderId:result.pix?.orderId||result.card?.orderId};
}
async function approved(orderId){const o=orders.get(orderId);o.status='processed';o.status_detail='accredited';o.transactions.payments[0].status='processed';o.last_updated_date=new Date().toISOString();return o;}
async function webhook(orderId,requestId='qa-request-'+crypto.randomUUID(),{timestamp=String(Math.floor(Date.now()/1000)),expectedStatus=200,signatureOverride=null,bodyDataId=orderId,action='order.updated',type='order'}={}){
 const ts=timestamp,signature=crypto.createHmac('sha256','qa-hmac-only').update(`id:${orderId};request-id:${requestId};ts:${ts};`).digest('hex'),headers={'x-request-id':requestId,'x-signature':signatureOverride||`ts=${ts},v1=${signature}`},request={method:'POST',query:{type,'data.id':orderId},body:{type,action,data:{id:bodyDataId}},headers,get:k=>headers[k]};let status,body;const response={status:n=>{status=n;return response},send:v=>{body=v;return response}};await functions.receiveWebhook(request,response);assert.equal(status,expectedStatus,String(body));return body;
}
test('authenticated owner cannot repair a legacy failure without trusted rejection proof',async()=>{const c=await seed({stuck:true});await assert.rejects(recover(c));assert.equal((await db.doc('legacyPlanTransitions/'+c.bid).get()).data().status,'creating');assert.equal(computeAccess((await c.root.get()).data().subscription).canMutate,true);});
test('seller and client-written repair proof cannot elevate to subscription owner',async()=>{const c=await seed({stuck:true,proof:true});await assert.rejects(invoke('createSubscription',c,{action:'recover_failed_migration',operationId:c.op,confirmed:true},c.seller));await assertFails(sdk.setDoc(sdk.doc(env.authenticatedContext(c.owner.uid).firestore(),'billingMigrationRepairAuthorizations',idFor(c.bid,c.op)),{authority:'platform_admin'}));});
test('creating repair is GET-only and idempotent, preserving original operation and grace',async()=>{const c=await seed({stuck:true,proof:true}),before=(await c.root.get()).data().subscription,n=providerCalls.filter(x=>x.method==='POST').length;await recover(c);await recover(c);assert.equal(providerCalls.filter(x=>x.method==='POST').length,n);assert.deepEqual((await c.root.get()).data().subscription,before);assert.equal((await c.root.collection('billingCheckoutAttempts').doc(c.op).get()).data().status,'failed');assert.equal((await db.doc('billingMigrationReservationHistory/'+idFor(c.bid,c.op)).get()).data().closed,true);});
test('provider order or search/network uncertainty keeps creation blocked',async()=>{const c=await seed({stuck:true,proof:true});orders.set('qa-found',{id:'qa-found',external_reference:billingExternalReference(c.bid,c.op)});await assert.rejects(recover(c));assert.equal((await db.doc('legacyPlanTransitions/'+c.bid).get()).data().status,'creating');orders.delete('qa-found');forceSearchError=true;try{await assert.rejects(recover(c));}finally{forceSearchError=false;}assert.equal((await db.doc('legacyPlanTransitions/'+c.bid).get()).data().status,'creating');});
test('new Pro Pix is 119.90, does not reuse old 50.34 or administrative grace as payment',async()=>{const c=await seed({stuck:true,proof:true});await recover(c);const x=await create(c),o=orders.get(x.orderId),b=(await c.root.get()).data();assert.equal(o.total_amount,'119.90');assert.equal(b.subscription.currentPeriodEnd,c.paidThrough);assert.equal(b.subscription.legacyTransition.paidThrough,c.graceEnd);assert.equal((await db.doc('legacyPlanTransitions/'+c.bid).get()).data().paidThrough,c.paidThrough);assert.equal(contracts.get(c.oldId).cancels,0);assert.equal((await db.collection('billingPaymentEvents').where('operationId','==',x.operationId).get()).size,0);});
test('official owner reconciliation activates Pix once after the old recurrence is stopped',async()=>{const c=await seed(),x=await create(c);await approved(x.orderId);await invoke('getPixCheckoutStatus',c,{operationId:x.operationId,reconcileProvider:true});const paid=(await c.root.get()).data().subscription;assert.equal(paid.catalogVersion,2);assert.equal(paid.planId,'premium');assert.equal(paid.latestPayment.amount,119.9);assert.equal(paid.discount,undefined);assert.notEqual(paid.currentPeriodStart,c.graceEnd);assert.equal(paid.administrativeAccess.status,'superseded_by_paid_migration');assert.equal(contracts.get(c.oldId).cancels,0);await invoke('getPixCheckoutStatus',c,{operationId:x.operationId,reconcileProvider:true});assert.equal((await c.root.get()).data().subscription.currentPeriodEnd,paid.currentPeriodEnd);assert.equal((await db.collection('billingPaymentEvents').where('operationId','==',x.operationId).get()).size,1);assert.equal(contracts.get(c.oldId).cancels,0);});
test('signed duplicate Orders across seconds/milliseconds activate one synthetic period',async()=>{const c=await seed(),x=await create(c);await approved(x.orderId);const rid='qa-duplicate-'+crypto.randomUUID();await webhook(x.orderId,rid);const end=(await c.root.get()).data().subscription.currentPeriodEnd;await webhook(x.orderId,rid,{timestamp:String(Date.now())});await webhook(x.orderId,undefined,{timestamp:String(Date.now()),action:'order.processed'});assert.equal((await c.root.get()).data().subscription.currentPeriodEnd,end);assert.equal(contracts.get(c.oldId).cancels,0);assert.equal((await db.collection('billingPaymentEvents').where('operationId','==',x.operationId).get()).size,1);});
test('Orders 10/13-digit signed fixtures authenticate with GET only and zero persistent effects',async()=>{
 const beforeEvents=(await db.collection('webhookEvents').get()).size,beforePayments=(await db.collection('billingPaymentEvents').get()).size,n=providerCalls.filter(x=>x.method!=='GET').length;
 for(const timestamp of [String(Math.floor(Date.now()/1000)),String(Date.now())])assert.equal(await webhook('ORD_QA_MISSING_'+crypto.randomBytes(8).toString('hex'),undefined,{timestamp}),'provider-resource-not-found');
 assert.equal(providerCalls.filter(x=>x.method!=='GET').length,n);assert.equal((await db.collection('webhookEvents').get()).size,beforeEvents);assert.equal((await db.collection('billingPaymentEvents').get()).size,beforePayments);
});
test('Orders expired/future/tampered fixtures are refused before any provider or persistent effects',async()=>{
 const beforeEvents=(await db.collection('webhookEvents').get()).size,n=providerCalls.length;
 for(const opts of [{timestamp:String(Date.now()-600000)},{timestamp:String(Date.now()+60000)},{timestamp:'1793712000.0'},{signatureOverride:`ts=${Date.now()},v1=${'0'.repeat(64)}`}])assert.equal(await webhook('ORD_QA_REJECTED',undefined,{...opts,expectedStatus:401}),'invalid-signature');
 assert.equal(providerCalls.length,n);assert.equal((await db.collection('webhookEvents').get()).size,beforeEvents);
});
test('new monthly card uses real SDK format, preserves 3DS and activates through authorized confirmation',async()=>{const c=await seed(),x=await create(c,'card_monthly');assert.equal(x.result.card.status,'payment_pending');assert.equal(contracts.get(c.oldId).cancels,0);await invoke('getCardCheckoutStatus',c,{operationId:x.operationId,reconcileProvider:true});assert.equal((await c.root.get()).data().subscription.catalogVersion,2);assert.equal(contracts.get(c.oldId).cancels,0);});
test('card without Device ID is blocked before a reservation or provider POST',async()=>{const c=await seed(),n=providerCalls.filter(x=>x.method==='POST').length;await assert.rejects(invoke('createSubscription',c,{catalogVersion:2,legacyMigration:true,planId:'premium',operationId:crypto.randomUUID(),paymentMethodType:'card_monthly',billingPayerEmail:c.owner.email,cardPayment:{token:'qa_card_token_not_real_12345',payment_method_id:'visa',installments:1}}));assert.equal(providerCalls.filter(x=>x.method==='POST').length,n);assert.equal((await db.doc('legacyPlanTransitions/'+c.bid).get()).exists,false);});
test('late approval of closed/superseded attempt becomes review, never a second new period',async()=>{const c=await seed(),x=await create(c),old=orders.get(x.orderId);old.status='failed';old.status_detail='rejected';old.transactions.payments[0].status='rejected';await webhook(x.orderId);assert.equal(computeAccess((await c.root.get()).data().subscription).canMutate,true);const y=await create(c);await approved(y.orderId);await invoke('getPixCheckoutStatus',c,{operationId:y.operationId,reconcileProvider:true});const end=(await c.root.get()).data().subscription.currentPeriodEnd;await approved(x.orderId);await webhook(x.orderId);assert.equal((await c.root.get()).data().subscription.currentPeriodEnd,end);assert.equal((await c.root.collection('billingCheckoutAttempts').doc(x.operationId).get()).data().status,'payment_review_required');assert.equal(contracts.get(c.oldId).cancels,0);});
test('old recurring approved payment cannot settle new Pro migration',async()=>{const c=await seed(),x=await create(c),store=fromRuntime('src/services/firestore-subscription-service').firestoreSubscriptionService(db);const result=await store.applyProviderSubscription(contracts.get(c.oldId).value,{source:'webhook',eventId:'qa-old',activation:{active:true,paymentId:'qa-old-50-34',reason:'initial_payment_approved',currentPeriodStart:new Date().toISOString()}});assert.equal(result.ignored,true);assert.notEqual((await c.root.get()).data().subscription.catalogVersion,2);assert.equal((await db.collection('billingPaymentEvents').where('operationId','==',x.operationId).get()).size,0);});
test('revoked owner or mismatched amount cannot activate or cancel any subscription',async()=>{const c=await seed(),x=await create(c);await approved(x.orderId);orders.get(x.orderId).transactions.payments[0].amount='119.89';await assert.rejects(invoke('getPixCheckoutStatus',c,{operationId:x.operationId,reconcileProvider:true}));orders.get(x.orderId).transactions.payments[0].amount='119.90';await c.root.collection('members').doc(c.owner.uid).update({status:'inactive'});await assert.rejects(invoke('getPixCheckoutStatus',c,{operationId:x.operationId,reconcileProvider:true}));assert.equal(contracts.get(c.oldId).cancels,0);assert.equal((await c.root.get()).data().subscription.currentPeriodEnd,c.paidThrough);});
test('concurrent repair and lost response create one immutable history and no payment',async()=>{const c=await seed({stuck:true,proof:true}),n=providerCalls.filter(x=>x.method==='POST').length,r=await Promise.allSettled([recover(c),recover(c)]);assert.ok(r.some(x=>x.status==='fulfilled'));await recover(c);assert.equal((await db.collection('billingMigrationReservationHistory').where('operationId','==',c.op).get()).size,1);assert.equal(providerCalls.filter(x=>x.method==='POST').length,n);});
test('expired attestation and a mismatched proof cannot release creating',async()=>{const c=await seed({stuck:true,proof:true}),p=db.doc('billingMigrationRepairAuthorizations/'+idFor(c.bid,c.op));await p.update({expiresAt:Timestamp.fromMillis(Date.now()-1000)});await assert.rejects(recover(c));await p.update({expiresAt:Timestamp.fromMillis(Date.now()+3600000),requestHash:'wrong'});await assert.rejects(recover(c));assert.equal((await db.doc('legacyPlanTransitions/'+c.bid).get()).data().status,'creating');});
test('future definitive provider rejection records trusted evidence; owner repair never retries POST',async()=>{const c=await seed();forceUnsupported=true;try{await assert.rejects(create(c));}finally{forceUnsupported=false;}const j=(await db.doc('legacyPlanTransitions/'+c.bid).get()).data(),a=c.root.collection('billingCheckoutAttempts').doc(j.operationId);assert.equal((await a.get()).data().creationOutcome,'rejected_before_creation');await a.update({createdAt:Timestamp.fromMillis(Date.now()-180000)});c.op=j.operationId;const n=providerCalls.filter(x=>x.method==='POST').length;await recover(c);assert.equal(providerCalls.filter(x=>x.method==='POST').length,n);});
test('client cannot forge the official reconciliation receipt',async()=>{const c=await seed();await assertFails(sdk.setDoc(sdk.doc(env.authenticatedContext(c.owner.uid).firestore(),'billingReconciliationProofs','forged'),{type:'official_owner_reconciliation',status:'accepted',businessId:c.bid,ownerUid:c.owner.uid}));await assertFails(sdk.setDoc(sdk.doc(env.authenticatedContext(c.owner.uid).firestore(),'businesses',c.bid,'billingCheckoutAttempts','forged'),{creationOutcome:'rejected_before_creation',providerCreateHttpStatus:400}));});
test('rollback pauses new checkouts while already-created payment can still be reconciled safely',async()=>{const c=await seed(),x=await create(c),n=providerCalls.filter(x=>x.method==='POST').length;process.env.BILLING_NEW_CHECKOUTS_ENABLED='false';try{await assert.rejects(create(c));assert.equal(providerCalls.filter(x=>x.method==='POST').length,n);await approved(x.orderId);await invoke('getPixCheckoutStatus',c,{operationId:x.operationId,reconcileProvider:true});assert.equal((await c.root.get()).data().subscription.catalogVersion,2);assert.equal(contracts.get(c.oldId).cancels,0);}finally{delete process.env.BILLING_NEW_CHECKOUTS_ENABLED;}});
test('repeated checkout after a lost reply reuses the same order without a second POST',async()=>{const c=await seed(),x=await create(c),n=providerCalls.filter(x=>x.method==='POST').length,result=await invoke('createSubscription',c,{catalogVersion:2,legacyMigration:true,planId:'premium',billingCycle:'monthly',operationId:x.operationId,paymentMethodType:'pix_monthly'});assert.equal(result.reused,true);assert.equal(result.pix.orderId,x.orderId);assert.equal(providerCalls.filter(x=>x.method==='POST').length,n);});
test('a late approved or processing old charge blocks a fresh POST without settling the new plan',async()=>{const c=await seed(),n=providerCalls.filter(x=>x.method==='POST').length;for(const status of ['approved','in_process']){contracts.get(c.oldId).paymentStatus=status;await assert.rejects(create(c),e=>e.code==='failed-precondition');assert.equal((await db.doc('legacyPlanTransitions/'+c.bid).get()).exists,false);assert.equal(providerCalls.filter(x=>x.method==='POST').length,n);assert.notEqual((await c.root.get()).data().subscription.catalogVersion,2);}});

for(const scenario of ['scheduled','future_retry','incomplete','unknown_contract','approved','in_process']){
 test(scenario+' blocks both new checkout and creation repair without provider writes',async()=>{
  const c=await seed({stuck:true,proof:true}),entry=contracts.get(c.oldId),before=(await c.root.get()).data(),jobBefore=(await db.doc('legacyPlanTransitions/'+c.bid).get()).data(),n=providerCalls.filter(x=>x.method!=='GET').length;
  if(scenario==='scheduled'){entry.invoiceStatus='scheduled';entry.nextRetryDate=new Date(Date.now()+3600000).toISOString();}
  if(scenario==='future_retry')entry.nextRetryDate=new Date(Date.now()+3600000).toISOString();
  if(scenario==='incomplete')entry.incompleteInvoices=true;
  if(scenario==='unknown_contract')entry.value.status='unknown';
  if(['approved','in_process'].includes(scenario))entry.paymentStatus=scenario;
  await assert.rejects(recover(c),e=>e.code==='failed-precondition');
  await assert.rejects(create(c),e=>e.code==='failed-precondition');
  assert.equal(providerCalls.filter(x=>x.method!=='GET').length,n);
  assert.deepEqual((await c.root.get()).data(),before);
  assert.deepEqual((await db.doc('legacyPlanTransitions/'+c.bid).get()).data(),jobBefore);
  assert.equal((await db.doc('billingMigrationReservationHistory/'+idFor(c.bid,c.op)).get()).exists,false);
  assert.equal((await db.collection('billingPaymentEvents').where('businessId','==',c.bid).get()).size,0);
  assert.equal(entry.cancels,0);
 });
}
test('risk appears after reservation but before POST: second check blocks Pix and monthly card',async()=>{
 for(const method of ['pix_monthly','card_monthly']){const c=await seed(),entry=contracts.get(c.oldId),n=providerCalls.filter(x=>x.method!=='GET').length;entry.scheduleOnSearch=2;await assert.rejects(create(c,method),e=>e.code==='failed-precondition');assert.equal(providerCalls.filter(x=>x.method!=='GET').length,n);assert.equal((await db.doc('legacyPlanTransitions/'+c.bid).get()).data().status,'attempt_closed');assert.equal((await c.root.get()).data().subscription.currentPeriodEnd,c.paidThrough);assert.equal(entry.cancels,0);}
});
test('risk appears during GET-only repair: final check preserves creating and original evidence',async()=>{
 const c=await seed({stuck:true,proof:true}),entry=contracts.get(c.oldId),attemptRef=c.root.collection('billingCheckoutAttempts').doc(c.op),before=(await attemptRef.get()).data(),n=providerCalls.filter(x=>x.method!=='GET').length;entry.scheduleOnSearch=2;
 await assert.rejects(recover(c),e=>e.code==='failed-precondition');assert.equal((await db.doc('legacyPlanTransitions/'+c.bid).get()).data().status,'creating');assert.deepEqual((await attemptRef.get()).data(),before);assert.equal((await db.doc('billingMigrationReservationHistory/'+idFor(c.bid,c.op)).get()).exists,false);assert.equal(providerCalls.filter(x=>x.method!=='GET').length,n);assert.equal(computeAccess((await c.root.get()).data().subscription).canMutate,true);
});
test('a new scheduled invoice does not block official reconciliation of an existing approved order',async()=>{
 const c=await seed(),x=await create(c),entry=contracts.get(c.oldId);entry.invoiceStatus='scheduled';entry.nextRetryDate=new Date(Date.now()+3600000).toISOString();await approved(x.orderId);
 await invoke('getPixCheckoutStatus',c,{operationId:x.operationId,reconcileProvider:true});await webhook(x.orderId);
 assert.equal((await c.root.get()).data().subscription.catalogVersion,2);assert.equal((await db.collection('billingPaymentEvents').where('operationId','==',x.operationId).get()).size,1);assert.equal(entry.cancels,0);
});
test('lost repair response stays a read-only receipt lookup even if an old retry later appears',async()=>{
 const c=await seed({stuck:true,proof:true});await recover(c);const entry=contracts.get(c.oldId),searches=entry.searchCount,n=providerCalls.filter(x=>x.method!=='GET').length;entry.invoiceStatus='scheduled';entry.nextRetryDate=new Date(Date.now()+3600000).toISOString();const r=await recover(c);assert.equal(r.replayed,true);assert.equal(entry.searchCount,searches);assert.equal(providerCalls.filter(x=>x.method!=='GET').length,n);assert.equal((await db.collection('billingMigrationReservationHistory').where('operationId','==',c.op).get()).size,1);
});

test('inconsistent signed query/body IDs are diagnosed before provider lookup or persistence',async()=>{const n=providerCalls.length,before=(await db.collection('webhookEvents').get()).size;assert.equal(await webhook('ORD_QA_CASE',undefined,{bodyDataId:'ord_qa_case',expectedStatus:401}),'invalid-signature');assert.equal(providerCalls.length,n);assert.equal((await db.collection('webhookEvents').get()).size,before);});

test('authenticated owner explicitly reads migration eligibility; V225 default config remains compatible and creates no payment',async()=>{
 const c=await seed(),n=providerCalls.filter(x=>x.method!=='GET').length,before=(await c.root.get()).data();
 const legacy=await invoke('getBillingCheckoutConfig',c,{catalogOnly:true});assert.equal(legacy.catalogVersion,2);assert.equal(legacy.migrationEligibility,undefined);
 const result=await invoke('getBillingCheckoutConfig',c,{catalogOnly:true,checkMigrationEligibility:true});assert.equal(result.migrationEligibility.status,'ready_for_quote');assert.equal(result.migrationEligibility.paymentCreated,false);assert.equal(providerCalls.filter(x=>x.method!=='GET').length,n);assert.deepEqual((await c.root.get()).data(),before);
 await assert.rejects(invoke('getBillingCheckoutConfig',c,{catalogOnly:true,checkMigrationEligibility:true},c.seller),e=>e.code==='permission-denied');
});

test('authenticated consultation of a stuck reservation does not repair it or create an authorization proof',async()=>{
 const c=await seed({stuck:true}),ref=db.doc('legacyPlanTransitions/'+c.bid),before=(await ref.get()).data(),n=providerCalls.filter(x=>x.method!=='GET').length,result=await invoke('getBillingCheckoutConfig',c,{catalogOnly:true,checkMigrationEligibility:true});
 assert.equal(result.migrationEligibility.status,'reservation_review_required');assert.equal(result.migrationEligibility.canStartNewCheckout,false);assert.deepEqual((await ref.get()).data(),before);assert.equal((await db.doc('billingMigrationRepairAuthorizations/'+idFor(c.bid,c.op)).get()).exists,false);assert.equal(providerCalls.filter(x=>x.method!=='GET').length,n);
});

async function trialCompany(){
  const bid='qa-exclusive-'+crypto.randomUUID(),owner=await identity('owner',bid),root=db.doc('businesses/'+bid);
  await root.set({id:bid,ownerId:owner.uid,active:true,legacyAccessDisabled:true,
    subscription:{planId:'trial',status:'trialing',trialEndsAt:new Date(Date.now()+86_400_000).toISOString()}});
  await root.collection('members').doc(owner.uid).set({role:'owner',status:'active'});
  return{bid,owner,root};
}
const checkout=(c,method='pix_monthly',op=crypto.randomUUID(),actor=c.owner)=>invoke('createSubscription',c,{
  catalogVersion:2,planId:'premium',billingCycle:'monthly',operationId:op,paymentMethodType:method,userId:actor.uid,
  ...(method==='pix_monthly'?{}:{billingPayerEmail:actor.email}),
  ...(method==='card_monthly'?{deviceSessionId:'armor.'+'a'.repeat(225),cardPayment:{token:'qa_card_token_not_real_12345',payment_method_id:'visa',installments:1}}:{}),
},actor);
const resumeCheckout=(c,actor=c.owner)=>invoke('createSubscription',c,{action:'resume_checkout',catalogVersion:2},actor);
const writes=()=>providerCalls.filter(x=>x.method==='POST').length;
const reservation=c=>db.doc('billingCheckoutReservations/'+c.bid);

test('two owners, devices and operation IDs share one company gate across all methods',async()=>{
  const c=await trialCompany(),second=await identity('owner',c.bid),n=writes();
  await c.root.collection('members').doc(second.uid).set({role:'owner',status:'active'});
  let sent,release;
  const entered=new Promise(resolve=>{sent=resolve;});
  const deferred=new Promise(resolve=>{release=resolve;});
  pauseNextOrder=async()=>{sent();await deferred;};
  const pending=checkout(c);
  await entered;
  let replay;
  try{
    await assert.rejects(checkout(c,'card_monthly'),e=>e.details?.billingCode==='checkout_in_progress');
    await assert.rejects(checkout(c,'card',crypto.randomUUID(),second),e=>e.details?.billingCode==='checkout_in_progress');
    await assert.rejects(resumeCheckout(c,second),e=>e.details?.billingCode==='checkout_in_progress');
    replay=await checkout(c);
    assert.equal(writes(),n+1);
  }finally{release();}
  const a=await pending,b=await checkout(c);
  assert.equal(replay.pix.orderId,a.pix.orderId);
  assert.equal(a.pix.id,b.pix.id);assert.equal(a.pix.orderId,b.pix.orderId);assert.equal(b.reused,true);
  assert.equal(writes(),n+1);
});

test('timeout after provider acceptance recovers the original order after reopen and calls POST once',async()=>{
  const c=await trialCompany(),n=writes(),op=crypto.randomUUID();
  loseNextOrderReply=true;
  await assert.rejects(checkout(c,'pix_monthly',op),{code:'unavailable'});
  const state=(await reservation(c).get()).data();
  assert.equal(state.stage,'dispatching');assert.equal(state.operationId,op);
  const result=await resumeCheckout(c);
  assert.equal(result.pix.id,op);assert.equal(writes(),n+1);
  assert.equal((await reservation(c).get()).data().stage,'linked');
  assert.equal((await db.doc('billingOrderIndex/'+result.pix.orderId).get()).data().operationId,op);
});

test('Firestore failure linking an accepted order rolls back the index and recovers the same original operation',async()=>{
  const c=await trialCompany(),n=writes(),op=crypto.randomUUID();
  const run=db.runTransaction.bind(db);
  let injected=false;
  db.runTransaction=(update,...options)=>run(tx=>{
    const original=tx.update.bind(tx);
    tx.update=(ref,value,...rest)=>{
      if(ref.path===reservation(c).path&&value.stage==='linked'&&!injected){injected=true;throw Error('QA Firestore interruption');}
      return original(ref,value,...rest);
    };
    return update(tx);
  },...options);
  try{await assert.rejects(checkout(c,'pix_monthly',op),{code:'internal'});}
  finally{db.runTransaction=run;}
  assert.equal(injected,true);assert.equal((await db.collection('billingOrderIndex').where('businessId','==',c.bid).get()).size,0);
  const result=await resumeCheckout(c);
  assert.equal(result.pix.id,op);assert.equal(writes(),n+1);
  assert.equal((await db.collection('billingOrderIndex').where('businessId','==',c.bid).get()).size,1);
});

test('an empty provider search and elapsed preparation lease are insufficient to create another charge',async()=>{
  const c=await trialCompany(),n=writes();loseNextOrderReply=true;
  await assert.rejects(checkout(c),{code:'unavailable'});
  const lock=(await reservation(c).get()).data(),entry=[...orders].find(([,v])=>v.external_reference===lock.dispatchTerms.externalReference);
  orders.delete(entry[0]);
  await reservation(c).update({preparationUntil:Date.now()-86_400_000});
  await assert.rejects(resumeCheckout(c),e=>e.details?.billingCode==='checkout_review_required');
  await assert.rejects(checkout(c,'card_monthly'),e=>e.details?.billingCode==='checkout_in_progress');
  assert.equal(writes(),n+1);orders.set(...entry);
  assert.equal((await resumeCheckout(c)).pix.orderId,entry[0]);
});

test('platform support evidence can release a dispatch with verified absence once; owners cannot write the evidence',async()=>{
  const c=await trialCompany(),n=writes();loseNextOrderReply=true;
  await assert.rejects(checkout(c),{code:'unavailable'});
  const lock=(await reservation(c).get()).data(),reference=lock.dispatchTerms.externalReference;
  const entry=[...orders].find(([,v])=>v.external_reference===reference);orders.delete(entry[0]);
  const owner=env.authenticatedContext(c.owner.uid).firestore();
  await assertFails(sdk.setDoc(sdk.doc(owner,'billingCheckoutProviderResolutions',reference),{authority:'platform_admin'}));
  await assertFails(sdk.getDoc(sdk.doc(owner,'billingCheckoutReservations',c.bid)));
  const ref=db.doc('billingCheckoutProviderResolutions/'+reference);
  await reservation(c).update({dispatchedAt:Timestamp.fromMillis(Date.now()-20*60_000)});
  const evidence={authority:'platform_admin',businessId:c.bid,operationId:lock.operationId,generation:lock.generation,requestHash:lock.requestHash,
    externalReference:reference,outcome:'provider_confirmed_no_resource',providerSupportCaseId:'qa-case-001',providerEvidenceSha256:'b'.repeat(64),
    verifiedAt:Timestamp.fromMillis(Date.now()-6000),expiresAt:Timestamp.fromMillis(Date.now()+60_000)};
  await ref.set({...evidence,generation:'foreign'});
  await assert.rejects(resumeCheckout(c),e=>e.details?.billingCode==='checkout_review_required');
  await ref.set(evidence);
  assert.equal((await resumeCheckout(c)).closed,true);assert.equal(writes(),n+1);
  await assert.rejects(resumeCheckout(c),e=>e.details?.billingCode==='checkout_not_found');
  assert.equal((await c.root.collection('billingCheckoutClosures').doc(lock.operationId).get()).data().providerEvidenceSha256,'b'.repeat(64));
  assert.ok((await checkout(c)).pix.orderId);assert.equal(writes(),n+2);
});

test('expired Pix allows manual card, verified approval is monotonic, and an older late debit goes to review',async()=>{
  const c=await trialCompany(),first=await checkout(c),old=orders.get(first.pix.orderId);
  old.status='expired';old.transactions.payments[0].status='expired';
  await webhook(old.id);
  assert.equal((await reservation(c).get()).data().stage,'closed');
  nextCardChallenge=true;
  const next=await checkout(c,'card_monthly'),id=next.card.orderId;
  assert.equal(next.card.status,'payment_challenge');assert.equal((await resumeCheckout(c)).card.orderId,id);
  await approved(id);await webhook(id);
  const paid=(await c.root.get()).data().subscription;
  await approved(old.id);await webhook(old.id);
  const stale=orders.get(id);stale.status='action_required';stale.status_detail='pending_challenge';await webhook(id);
  assert.equal((await c.root.get()).data().subscription.currentPeriodEnd,paid.currentPeriodEnd);
  assert.equal((await c.root.collection('billingCheckoutAttempts').doc(first.pix.id).get()).data().status,'payment_review_required');
  assert.equal((await c.root.collection('billingCheckoutAttempts').doc(next.card.id).get()).data().status,'payment_approved');
  assert.equal((await db.collection('billingPaymentEvents').where('businessId','==',c.bid).get()).size,1);
});

test('same client-generated operation ID on two companies yields distinct provider identities and references',async()=>{
  const a=await trialCompany(),b=await trialCompany(),op=crypto.randomUUID();
  const [x,y]=await Promise.all([checkout(a,'pix_monthly',op),checkout(b,'pix_monthly',op)]);
  assert.notEqual(x.pix.orderId,y.pix.orderId);
  assert.notEqual(orders.get(x.pix.orderId).external_reference,orders.get(y.pix.orderId).external_reference);
  assert.notEqual(fromRuntime('src/services/billing-checkout-reservation-service').providerKey(a.bid,op),fromRuntime('src/services/billing-checkout-reservation-service').providerKey(b.bid,op));
  await assert.rejects(resumeCheckout(a,b.owner),{code:'permission-denied'});
});

test('an existing automatic renewal prevents a new separately payable order',async()=>{
  const c=await seed(),entry=contracts.get(c.oldId),n=writes();
  entry.value.status='authorized';
  await assert.rejects(create(c),e=>e.details?.billingCode==='recurring_contract_exists');
  assert.equal(writes(),n);assert.equal(entry.cancels,0);
  assert.equal((await c.root.get()).data().subscription.currentPeriodEnd,c.paidThrough);
});

test('automatic card after response loss resumes one contract and permits Pix after verified cancellation',async()=>{
  const c=await trialCompany(),n=writes();loseNextContractReply=true;
  await assert.rejects(checkout(c,'card'),{code:'unavailable'});
  const first=await resumeCheckout(c),contractId=first.checkoutUrl.split('/').at(-1);
  assert.equal(writes(),n+1);assert.equal((await checkout(c,'card')).checkoutUrl,first.checkoutUrl);
  await assert.rejects(checkout(c),e=>e.details?.billingCode==='checkout_in_progress');
  await invoke('cancelPendingBillingAttempt',c);
  assert.equal(contracts.get(contractId).cancels,1);
  assert.equal((await resumeCheckout(c)).closed,true);
  assert.ok((await checkout(c)).pix.orderId);
  assert.equal(writes(),n+2);
});

test('operational recurring renewal remains active while concurrent purchase is blocked',async()=>{
  const c=await trialCompany(),contract=await checkout(c,'card'),id=contract.checkoutUrl.split('/').at(-1),entry=contracts.get(id),n=writes();
  const charge=async date=>{
    const payId='qa-payment-'+crypto.randomUUID();
    entry.value.status='authorized';entry.value.next_payment_date=new Date(Date.parse(date)+30*86_400_000).toISOString();
    entry.invoices=[{id:'qa-invoice-'+crypto.randomUUID(),preapproval_id:id,status:'processed',date_created:date,last_modified:date,payment:{id:payId,status:'approved'}}];
    payments.set(payId,{id:payId,status:'approved',status_detail:'accredited',transaction_amount:119.90,currency_id:'BRL',
      date_approved:date,date_created:date,external_reference:entry.value.external_reference,payment_method_id:'visa',payment_type_id:'credit_card'});
    await c.root.update({'subscription.mercadoPago.lastManualSyncAt':'2026-01-01T00:00:00.000Z'});
    await invoke('syncSubscription',c,{reconcileProvider:true});
  };
  await charge(new Date(Date.now()-86_400_000).toISOString());
  const initial=(await c.root.get()).data().subscription;
  await assert.rejects(checkout(c),e=>e.details?.billingCode==='checkout_in_progress');
  await charge(new Date().toISOString());
  const renewed=(await c.root.get()).data().subscription;
  assert.equal(renewed.status,'active');assert.ok(Date.parse(renewed.currentPeriodEnd)>Date.parse(initial.currentPeriodEnd));
  assert.equal(writes(),n);
});

test('a canceled Orders summary cannot release a payment that is still pending',async()=>{
  const c=await trialCompany(),first=await checkout(c),order=orders.get(first.pix.orderId),n=writes();
  order.status='canceled';
  await webhook(order.id);
  assert.equal((await reservation(c).get()).data().stage,'linked');
  await assert.rejects(checkout(c,'card_monthly'),e=>e.details?.billingCode==='checkout_in_progress');
  order.transactions.payments[0].status='canceled';
  await webhook(order.id);
  assert.equal((await reservation(c).get()).data().stage,'closed');
  assert.equal(writes(),n);
});

test('a historical automatic index without terminal proof blocks new checkouts even when no active pointer exists',async()=>{
  const c=await trialCompany(),n=writes(),id='QA_ORD_NO_POINTER_'+crypto.randomUUID();
  await db.doc('subscriptionIndex/'+id).set({businessId:c.bid,status:'approved',paymentMethodType:'card'});
  await assert.rejects(checkout(c),e=>e.details?.billingCode==='checkout_review_required');
  assert.equal(writes(),n);
});

async function historicalCard(c, { invoice = true, age = 90, paymentStatus = 'rejected', contractStatus = 'cancelled' } = {}) {
  const op = crypto.randomUUID(), id = 'qa-history-' + op, reference = billingExternalReference(c.bid, op);
  const date = new Date(Date.now() - age * 86400_000).toISOString();
  const index = { businessId:c.bid, internalSubscriptionId:op, expectedExternalReference:reference, status:'rejected' };
  const entry = { value:{ id, status:contractStatus, external_reference:reference, last_modified:date }, invoices:[] };
  let charge, payment;
  if (invoice) {
    payment = { id:'qa-pay-'+op, status:paymentStatus, external_reference:reference, date_last_updated:date };
    charge = { id:'qa-invoice-'+op, preapproval_id:id, status:'recycling', debit_date:date, last_modified:date, payment:{id:payment.id,status:paymentStatus} };
    entry.invoices.push(charge);
    payments.set(payment.id,payment);
  }
  contracts.set(id,entry);
  await db.doc('subscriptionIndex/'+id).set(index);
  await c.root.collection('billingCheckoutAttempts').doc(op).set({businessId:c.bid,operationId:op,subscriptionId:id,status:'rejected'});
  return { id, op, charge, payment, closure:c.root.collection('billingCheckoutClosures').doc(op) };
}

test('recontracting by Pix closes 3 Lindas-like history and concurrent clicks produce one order',async()=>{
  const c=await seed(), history=[];
  for(let i=0;i<6;i++)history.push(await historicalCard(c,{invoice:i<4}));
  const before=(await c.root.get()).data().subscription,n=writes();
  const results=await Promise.allSettled([create(c),create(c)]);
  const valid=results.find(result=>result.status==='fulfilled').value;
  assert.equal(writes(),n+1);
  assert.equal(orders.get(valid.orderId).total_amount,'119.90');
  assert.deepEqual((await c.root.get()).data().subscription.administrativeAccess,before.administrativeAccess);
  for(const row of history){
    assert.equal((await row.closure.get()).data().providerId,row.id);
    assert.equal((await db.doc('subscriptionIndex/'+row.id).get()).data().status,'rejected');
  }
  await approved(valid.orderId);
  await webhook(valid.orderId);
  const paid=(await c.root.get()).data().subscription;
  assert.equal(paid.latestPayment.amount,119.9);
  assert.equal(paid.catalogVersion,2);
  const late=history[0];
  late.charge.payment.status=late.payment.status='approved';
  late.charge.payment.date_approved=new Date().toISOString();
  for(let i=0;i<2;i++)await webhook(late.charge.id,undefined,{type:'subscription_authorized_payment',action:'updated'});
  assert.equal((await db.doc('subscriptionPaymentEvents/review_'+late.payment.id).get()).data().reviewRequired,true);
  assert.equal((await db.doc('subscriptionIndex/'+late.id).get()).data().status,'payment_review_required');
  assert.deepEqual((await c.root.get()).data().subscription,paid);
  assert.equal((await db.collection('billingPaymentEvents').where('operationId','==',valid.operationId).get()).size,1);
});

test('recontracting refuses recent retries, charges in process, unlinked payments and active contracts',async()=>{
  const cases=[{age:2},{paymentStatus:'in_process'},{paymentStatus:'approved'},{contractStatus:'authorized'},{}];
  for(const [i,options] of cases.entries()){
    const c=await seed(),row=await historicalCard(c,options),n=writes();
    if(i===4)payments.set('qa-unlinked-'+row.op,{...row.payment,id:'qa-unlinked-'+row.op,status:'pending'});
    await assert.rejects(create(c),{code:'failed-precondition'});
    assert.equal(writes(),n);
    assert.equal((await row.closure.get()).exists,false);
  }
});

test('a late approval on the original migration contract enters review without advancing the new Pix',async()=>{
  const c=await seed(),next=await create(c),before=(await c.root.get()).data().subscription;
  const entry=contracts.get(c.oldId),paymentId='qa-original-pay-'+c.op;
  payments.set(paymentId,{id:paymentId,status:'approved',external_reference:entry.value.external_reference,date_approved:new Date().toISOString()});
  const invoice={id:'qa-original-invoice-'+c.op,preapproval_id:c.oldId,status:'processed',payment:{id:paymentId,status:'approved'}};
  entry.invoices=[invoice];
  await webhook(invoice.id,undefined,{type:'subscription_authorized_payment',action:'updated'});
  assert.equal((await db.doc('subscriptionPaymentEvents/review_'+paymentId).get()).data().reviewRequired,true);
  assert.deepEqual((await c.root.get()).data().subscription,before);
  assert.equal((await db.collection('billingPaymentEvents').where('operationId','==',next.operationId).get()).size,0);
});

test('late auto-card approval cannot replace a newer payment or renew access again',async()=>{
  const c=await trialCompany(),first=await checkout(c,'card'),id=first.checkoutUrl.split('/').at(-1);
  await invoke('cancelPendingBillingAttempt',c);
  assert.equal((await resumeCheckout(c)).closed,true);
  const next=await checkout(c);
  await approved(next.pix.orderId);await webhook(next.pix.orderId);
  const before=(await c.root.get()).data().subscription,provider=contracts.get(id).value;
  const service=fromRuntime('src/services/firestore-subscription-service').firestoreSubscriptionService(db);
  const late=await service.applyProviderSubscription({...provider,status:'authorized'},
    {source:'webhook',eventId:'late-auto-qa',activation:{active:true,paymentId:'qa-late-auto'}});
  assert.equal(late.requiresReview,true);
  assert.equal((await service.recordPaymentEvent(id,'payment_qa-late-auto',{
    status:'approved',successful:true,paymentId:'qa-late-auto',
  })).processed,false);
  assert.deepEqual((await c.root.get()).data().subscription,before);
  assert.equal((await db.doc('subscriptionIndex/'+id).get()).data().status,'payment_review_required');
});

test('release of ambiguous legacy dispatch requires provider evidence and a fresh stopped-source check',async()=>{
  const c=await seed(),n=writes();loseNextOrderReply=true;
  await assert.rejects(create(c),{code:'unavailable'});
  const lock=(await reservation(c).get()).data(),reference=lock.dispatchTerms.externalReference;
  const candidate=[...orders].find(([,o])=>o.external_reference===reference);
  orders.delete(candidate[0]);
  await reservation(c).update({dispatchedAt:Timestamp.fromMillis(Date.now()-20*60_000)});
  await db.doc('billingCheckoutProviderResolutions/'+reference).set({
    authority:'platform_admin',businessId:c.bid,operationId:lock.operationId,generation:lock.generation,requestHash:lock.requestHash,
    externalReference:reference,outcome:'provider_confirmed_no_resource',providerSupportCaseId:'qa-legacy-001',providerEvidenceSha256:'c'.repeat(64),
    verifiedAt:Timestamp.fromMillis(Date.now()-6000),expiresAt:Timestamp.fromMillis(Date.now()+60_000),
  });
  const prior=contracts.get(c.oldId);
  prior.value.status='authorized';
  await assert.rejects(resumeCheckout(c),e=>e.details?.billingCode==='checkout_review_required');
  assert.equal((await reservation(c).get()).data().stage,'dispatching');
  prior.value.status='cancelled';
  assert.equal((await resumeCheckout(c)).closed,true);
  assert.equal((await db.doc('legacyPlanTransitions/'+c.bid).get()).data().status,'attempt_closed');
  assert.ok((await create(c)).orderId);assert.equal(writes(),n+2);assert.equal(prior.cancels,0);
});

test('partial release blocks old PWA automatic intake and preserves an existing contract, renewal and both manual methods',async()=>{
  const recurring=await trialCompany(),open=await checkout(recurring,'card'),n=writes();
  delete process.env.BILLING_NEW_AUTOMATIC_CHECKOUTS_ENABLED;
  try {
    const first=await trialCompany();
    assert.equal((await invoke('getBillingCheckoutConfig',first,{catalogOnly:true})).newAutomaticCheckoutEnabled,false);
    await assert.rejects(checkout(first,'card'),e=>e.details?.billingCode==='automatic_checkout_unavailable');
    assert.equal(writes(),n);
    assert.equal((await reservation(first).get()).exists,false);
    assert.equal((await resumeCheckout(recurring)).checkoutUrl,open.checkoutUrl);
    assert.equal(writes(),n);
    const id=open.checkoutUrl.split('/').at(-1),entry=contracts.get(id),paidAt=new Date().toISOString(),paymentId='qa-partial-renew-'+crypto.randomUUID();
    entry.value.status='authorized';
    entry.value.next_payment_date=new Date(Date.now()+30*86_400_000).toISOString();
    entry.invoices=[{id:'qa-partial-invoice',preapproval_id:id,status:'processed',date_created:paidAt,last_modified:paidAt,payment:{id:paymentId,status:'approved'}}];
    payments.set(paymentId,{id:paymentId,status:'approved',status_detail:'accredited',transaction_amount:119.90,currency_id:'BRL',date_approved:paidAt,date_created:paidAt,external_reference:entry.value.external_reference,payment_method_id:'visa',payment_type_id:'credit_card'});
    await invoke('syncSubscription',recurring,{reconcileProvider:true});
    assert.equal((await recurring.root.get()).data().subscription.status,'active');
    assert.equal(writes(),n);
    assert.ok((await checkout(first,'pix_monthly')).pix.orderId);
    assert.ok((await checkout(await trialCompany(),'card_monthly')).card.orderId);
    assert.equal(writes(),n+2);
  } finally {process.env.BILLING_NEW_AUTOMATIC_CHECKOUTS_ENABLED='true';}
});
