'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {classify}=require('../scripts/audit-legacy-plans-dry-run.cjs');
const {providerGet}=require('../scripts/lib/billing-readonly.cjs');
test('dry-run distinguishes internal, pending unpaid checkout, paid recurring and expired manual',()=>{
 assert.equal(classify({business:{id:'a',subscription:{planId:'internal',status:'active'}}}).action,'no_action');
 assert.equal(classify({business:{id:'a',subscription:{planId:'essential',status:'pending',mercadoPago:{subscriptionId:'old'}}}}).action,'review_pending_legacy_checkout');
 const business={id:'a',subscription:{planId:'premium',status:'active',hasPaidSubscription:true,paymentMethodType:'card',currentPeriodEnd:'2099-11-01T13:00:00Z',mercadoPago:{subscriptionId:'old'}}};
 assert.equal(classify({business,index:{businessId:'a'},remote:{status:'authorized',next_payment_date:'2099-11-01T13:00:00Z'}}).action,'preserve_recurrence_until_explicit_migration_paid_and_webhook_processed');
 assert.equal(classify({business,index:{businessId:'foreign'}}).review,true);
 assert.equal(classify({business,index:{businessId:'a'},remote:{status:'authorized',next_payment_date:'2099-12-01T13:00:00Z'}}).periodMismatch,true);
 assert.equal(classify({business:{id:'b',subscription:{planId:'professional',hasPaidSubscription:true,status:'expired',paymentMethodType:'pix_monthly',currentPeriodEnd:'2020-01-01T00:00:00Z'}}}).action,'expired_choose_new_plan_no_recurrence');
});
test('provider audit transport permits only GET to approved Mercado Pago read endpoints',async()=>{
 const original=global.fetch,calls=[];global.fetch=async(url,options)=>{calls.push({url,method:options.method});return{ok:true,status:200,json:async()=>({id:'qa',status:'authorized'})};};
 try{
  await providerGet('/preapproval/qa','synthetic-test-secret');
  assert.deepEqual(calls,[{url:'https://api.mercadopago.com/preapproval/qa',method:'GET'}]);
  assert.throws(()=>providerGet('/v1/payments','synthetic-test-secret'),/not allowed/);
  assert.throws(()=>providerGet('https://other.example','synthetic-test-secret'),/not allowed/);
 }finally{global.fetch=original;}
});
