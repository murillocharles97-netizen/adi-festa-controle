'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {test} = require('node:test');
const {pathToFileURL} = require('node:url');
const {JSDOM} = require('jsdom');
const catalog = require('../functions/src/shared/plan-catalog');

test('subscription checkout loads Firebase Auth as a module and preserves the selected checkout intent', async t => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'veconi-billing-auth-'));
  t.after(() => fs.rm(dir, {recursive:true}));
  await fs.copyFile('js/firebase/business-context.js', path.join(dir, 'business-context.mjs'));
  await fs.writeFile(path.join(dir, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(dir, 'firebase-config.js'), 'export const auth = { currentUser: { uid: "qa-owner" } };');
  const dom = new JSDOM('', {url:'http://localhost/'});
  t.after(() => { dom.window.close(); for(const key of ['window','VeconiPlanCatalog','dispatchEvent']) delete globalThis[key]; });
  globalThis.window = dom.window;
  globalThis.VeconiPlanCatalog = catalog;
  globalThis.dispatchEvent = () => {};
  const {auth} = await import(pathToFileURL(path.join(dir,'firebase-config.js')).href);
  const {BusinessContext,SubscriptionService} = await import(pathToFileURL(path.join(dir,'business-context.mjs')).href);
  const setCompany = businessId => BusinessContext.set({business:{id:businessId,ownerId:'qa-owner',
    subscription:{planId:'trial',status:'trialing'}},userProfile:{uid:'qa-owner',businessId,role:'owner'}});
  setCompany('qa-company');

  for (const method of ['pix_monthly','card_monthly','card']) await t.test(method, async () => {
    const calls = [];
    window.FirebaseCallable = async (name,payload) => {
      calls.push({name,payload});
      return {data:name==='getBillingCheckoutConfig'?{catalogVersion:catalog.version}:{paymentMethodType:method}};
    };
    const operationId = 'qa-original-operation';
    const result = await SubscriptionService.requestUpgrade('premium',{operationId,paymentMethodType:method,billingPayerEmail:'qa@example.invalid'});
    assert.deepEqual(calls.map(call=>call.name),['getBillingCheckoutConfig','createSubscription']);
    assert.equal(calls[1].payload.companyId,'qa-company');
    assert.equal(calls[1].payload.userId,'qa-owner');
    assert.equal(calls[1].payload.paymentMethodType,method);
    assert.equal(calls[1].payload.billingPayerEmail,method==='pix_monthly'?null:'qa@example.invalid');
    assert.equal(calls[1].payload.operationId,operationId);
    assert.equal(result.operationId,operationId);
  });

  await t.test('signed-out or different auth user is stopped before consulting the catalog', async () => {
    window.FirebaseCallable = async () => assert.fail('No request from a stale session');
    for (const user of [null,{uid:'qa-other'}]) {
      auth.currentUser = user;
      await assert.rejects(SubscriptionService.requestUpgrade('premium'), /sessão ou empresa mudou/);
    }
    auth.currentUser = {uid:'qa-owner'};
  });

  await t.test('Firebase UID change during catalog lookup prevents checkout creation', async () => {
    window.FirebaseCallable = async name => {
      assert.equal(name,'getBillingCheckoutConfig');
      auth.currentUser = {uid:'qa-other'};
      return {data:{catalogVersion:catalog.version}};
    };
    await assert.rejects(SubscriptionService.requestUpgrade('premium'), /sessão ou empresa mudou/);
    auth.currentUser = {uid:'qa-owner'};
  });

  await t.test('a mismatched provider catalog prevents checkout creation', async () => {
    window.FirebaseCallable = async name => {
      assert.equal(name,'getBillingCheckoutConfig');
      return {data:{catalogVersion:catalog.version-1}};
    };
    await assert.rejects(SubscriptionService.requestUpgrade('premium'), /catálogo de cobrança/);
  });

  await t.test('a checkout reply from the previous user cannot open a payment in the new session', async () => {
    const calls = [];
    window.FirebaseCallable = async name => {
      calls.push(name);
      if (name === 'getBillingCheckoutConfig') return {data:{catalogVersion:catalog.version}};
      auth.currentUser = {uid:'qa-other'};
      return {data:{pix:{id:'qa-original-operation',qrCode:'qa-only'}}};
    };
    await assert.rejects(SubscriptionService.requestUpgrade('premium',{paymentMethodType:'pix_monthly'}), /consulte o pagamento/);
    assert.deepEqual(calls,['getBillingCheckoutConfig','createSubscription']);
  });
});
