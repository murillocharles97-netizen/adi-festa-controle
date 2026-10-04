'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{payload}=require('../js/workspace-callables');
const origin={businessId:'biz-a',workspaceGeneration:5},runtime={capture:()=>origin};
test('operational callables transmit original epoch, never re-label stale requests',()=>{
  assert.deepEqual(payload('createTerminalPayment',{businessId:'biz-a',amount:25},runtime),{businessId:'biz-a',amount:25,workspaceGeneration:5});
  assert.throws(()=>payload('createTeamInvite',{businessId:'biz-b'},runtime),{code:'workspace-business-mismatch'});
  assert.throws(()=>payload('getTerminalPaymentStatus',{businessId:'biz-a',workspaceGeneration:4},runtime),{code:'workspace-generation-mismatch'});
});
test('Auth, membership reads and VECONI billing remain independent from the operational reset lock',()=>{
  const locked={capture(){throw Error('blocked');}},data={businessId:'biz-a'};
  for(const name of ['ensureCurrentMembership','acceptTeamInvite','getTeamInvitePreview','createSubscription','getBillingCheckoutConfig','cancelSubscription','requestBusinessReset','retryBusinessReset'])
    assert.equal(payload(name,data,locked),data,name);
  assert.throws(()=>payload('createTeamInvite',data,locked),/blocked/);
});
