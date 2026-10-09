'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const {computeAccess}=require('../src/services/subscription-service'),{getPlan}=require('../src/services/plan-service');
const source=fs.readFileSync(path.join(__dirname,'../src/index.js'),'utf8');
// Only execute the existing shared authorization functions, never a live SDK.
const functions=source.split(/\r?\n/).find(line=>line.startsWith('async function requireBusinessFeature('))+'\n'+source.match(/async function requireFinancialSpaceFeature\([\s\S]*?\n\}/)[0];
test('financial server boundary uses effective entitlements and preserves paid legacy rights',async()=>{
 for(const [subscription,allowed] of [
  [{planId:'essential',status:'active',catalogVersion:2},false],
  [{planId:'professional',status:'active',catalogVersion:2},true],
  [{planId:'premium',status:'active',catalogVersion:2},true],
  [{planId:'essential',status:'active',hasPaidSubscription:true,currentPeriodEnd:new Date(Date.now()+86400000).toISOString()},true],
  [{planId:'professional',status:'expired',catalogVersion:2},false]
 ]){
  const context={computeAccess,getPlan,HttpsError:class extends Error{constructor(code,message,details){super(message);this.code=code;this.details=details}},db:{doc:()=>({get:async()=>({exists:true,data:()=>({active:true,subscription,businessId:'qa'})})})}};
  vm.runInNewContext(functions+'\nthis.check=requireFinancialSpaceFeature;',context);
  const call=context.check('qa-owner',{businessId:'qa'});
  if(allowed)await assert.doesNotReject(call);else await assert.rejects(call,e=>e.details?.feature==='finance.view'&&e.details?.requiredPlan==='professional');
 }
});
test('financial callables check the shared entitlement before reconciliation/deletion scans',()=>{
 const reconcile=source.slice(source.indexOf('exports.reconcileBusinessFinancialIncome='),source.indexOf('exports.deleteUnusedFinancialAccount='));
 assert.ok(reconcile.indexOf("requireBusinessFeature(businessId,'financeAdvanced'")<reconcile.indexOf('financialIncome().reconcileBusiness'));
 for(const [name,next] of [['deleteUnusedFinancialAccount','deleteUnusedCreditCard'],['deleteUnusedCreditCard','identifyCatalogCustomer']]){
  const handler=source.slice(source.indexOf('exports.'+name+'='),source.indexOf('exports.'+next+'='));assert.ok(handler.indexOf('requireFinancialSpaceFeature(uid,space)')<handler.indexOf('const ownerSpaces='));
 }
});
