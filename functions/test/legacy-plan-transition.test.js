'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const Catalog=require('../src/shared/plan-catalog');
const {computeAccess}=require('../src/services/subscription-service');
const {assertLegacyCheckoutReady}=require('../src/services/legacy-plan-transition-service');
const now=new Date('2026-10-08T12:00:00Z'),end='2026-10-12T12:00:00Z';
const legacy={planId:'essential',status:'active',hasPaidSubscription:true,currentPeriodEnd:end,paymentMethodType:'card'};
test('paid legacy rights survive cancellation but expire exactly at paidThrough',()=>{
 for(const status of ['active','cancelled','expired']){
  const s={...legacy,status,legacyPlan:true,legacyTransition:{paidThrough:end,features:Catalog.legacyFeatures('essential'),renewalStatus:'disabled'}};
  assert.equal(computeAccess(s,now).canMutate,true);assert.equal(computeAccess(s,now).features.financeAdvanced,true);assert.equal(computeAccess(s,now).features.spreadsheetImport,true);
  assert.equal(computeAccess(s,new Date(end)).canMutate,false);
 }
});
test('voluntary replacement allowed before expiry, explicit consent and paid period required',()=>{
 assert.throws(()=>assertLegacyCheckoutReady(legacy,now),{code:'legacy-migration-consent-required'});
 assert.equal(assertLegacyCheckoutReady(legacy,now,{explicitMigration:true}),true);
 assert.equal(assertLegacyCheckoutReady(legacy,new Date(end),{explicitMigration:true}),true);
 assert.throws(()=>assertLegacyCheckoutReady({...legacy,currentPeriodEnd:null},now,{explicitMigration:true}),{code:'legacy-paid-period-unverified'});
});
test('notice starts seven days before; v2 and internal never become legacy',()=>{
 assert.equal(Catalog.legacyState(legacy,now).showNotice,true);
 assert.equal(Catalog.legacyState(legacy,new Date('2026-10-01')).showNotice,false);
 assert.equal(Catalog.legacyState({...legacy,catalogVersion:2},now).legacy,false);
 assert.equal(Catalog.legacyState({...legacy,planId:'internal'},now).legacy,false);
 assert.equal(Catalog.legacyState({...legacy,currentPeriodEnd:null},now).needsReview,true);
 assert.equal(Catalog.legacyState({...legacy,currentPeriodEnd:{seconds:Date.parse(end)/1000}},now).paidThrough,end.replace('Z','.000Z'));
});
