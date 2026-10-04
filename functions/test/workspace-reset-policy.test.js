'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const policy=require('../src/services/workspace-reset-policy');
const {workspaceWriteFence}=require('../src/services/workspace-write-fence');
const active={active:true,ownerId:'owner-a',workspaceGeneration:4};
test('reset distinguishes commerce payments/subscriptions/campaigns from SaaS billing',()=>{
  for(const name of ['payments','customerSubscriptions','paymentIntents','campaigns','metricEvents'])assert.equal(policy.classifyCollection(name),'delete-operational');
  for(const name of ['billingCheckoutAttempts','subscriptionIntents'])assert.equal(policy.classifyCollection(name),'preserve-billing');
  assert.equal(policy.classifyCollection('members'),'preserve-owner-only');
  assert.throws(()=>policy.classifyCollection('newBillingCollection'),{code:'failed-precondition'});
});
test('missing generation is legacy zero, never current after reset',()=>{
  policy.assertWritable({active:true});
  policy.assertWritable(active,4);
  assert.throws(()=>policy.assertWritable(active),{code:'failed-precondition'});
  for(const value of [-1,NaN,Infinity,'4',1.5])assert.throws(()=>policy.generation(value));
});
test('all incomplete and failed reset states remain locked',()=>{
  for(const status of ['REQUESTED','LOCKED','DELETING','VERIFYING','FAILED','UNKNOWN'])
    assert.throws(()=>policy.assertWritable({...active,workspaceReset:{status}},4));
  policy.assertWritable({...active,workspaceReset:{status:'COMPLETED'}},4);
});
test('reset requires canonical owner, active membership, exact phrase and recent auth',()=>{
  const input={uid:'owner-a',business:active,member:{role:'owner',status:'active'},confirmation:'RESETAR',authTime:1000,now:1001000};
  policy.assertResetOwner(input);
  for(const role of ['seller','manager','cashier','admin'])assert.throws(()=>policy.assertResetOwner({...input,member:{role,status:'active'}}),{code:'permission-denied'});
  assert.throws(()=>policy.assertResetOwner({...input,uid:'owner-b'}));
  assert.throws(()=>policy.assertResetOwner({...input,confirmation:'resetar'}));
  assert.throws(()=>policy.assertResetOwner({...input,authTime:1}),{code:'unauthenticated'});
  assert.throws(()=>policy.assertResetOwner({...input,business:{...active,workspaceHasRealIntegratedPayments:true}}));
});
test('real and unknown providers cannot be erased even with isTest true',()=>{
  policy.assertMockOnly([{provider:'mock'},{provider:'simulator'}]);
  for(const provider of ['cielo','mercado_pago','pagbank',undefined,''])
    assert.throws(()=>policy.assertMockOnly([{provider,isTest:true}]));
});
test('exact business scope excludes personal, another business and conflicting linkage',()=>{
  assert.equal(policy.belongsToWorkspace({businessId:'biz-a'},'biz-a'),true);
  assert.equal(policy.belongsToWorkspace({ownerUid:'owner-a',type:'personal'},'biz-a'),false);
  assert.equal(policy.belongsToWorkspace({businessId:'biz-b'},'biz-a'),false);
  assert.equal(policy.belongsToWorkspace({businessId:'biz-a',linkedBusinessId:'biz-b'},'biz-a'),false);
  assert.deepEqual(policy.storagePrefixes('biz-a',['space-a']),['businesses/biz-a/','financialSpaces/space-a/']);
  assert.throws(()=>policy.storagePrefixes('../biz-b'));
});
test('failed job retries under same lock, completed job cannot restart',()=>{
  policy.assertTransition('FAILED','LOCKED');
  assert.throws(()=>policy.assertTransition('COMPLETED','LOCKED'));
  assert.throws(()=>policy.assertTransition('DELETING','COMPLETED'));
});
test('backend write fence rechecks generation INSIDE every commit and never relabels stale source',async()=>{
  let business={...active},writes=0,checks=0;
  const db={doc:path=>({path}),runTransaction:async fn=>fn({get:async()=>{checks++;return{data:()=>business}},set:()=>writes++})};
  const fence=workspaceWriteFence(db,{businessId:'biz-a',workspaceGeneration:4});
  await fence.write([{method:'set',ref:db.doc('businesses/biz-a/sales/sale-a'),data:{value:25}}]);
  assert.equal(writes,1);business={...active,workspaceGeneration:5};
  await assert.rejects(fence.write([{method:'set',ref:db.doc('businesses/biz-a/sales/sale-a'),data:{value:25}}]));
  assert.equal(writes,1);assert.equal(checks,2);
  await assert.rejects(fence.write([{method:'set',ref:db.doc('businesses/biz-b/sales/sale-a'),data:{}}]),{code:'permission-denied'});
});
