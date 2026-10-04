'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const protocol=require('../js/workspace-generation');
test('scoped cleanup recognizes only exact business boundaries',()=>{
  for(const key of ['adiFestaDB_v1:biz-a:uid:sig','adiFesta:biz-a:user:syncQueue','veconi:sale-draft:v1:biz-a:space','veconi:spaces:v1:uid:biz-a','veconi:space-context:v1:uid:biz-a:home'])assert.equal(protocol.ownsStorageKey(key,'biz-a'),true,key);
  for(const key of ['adiFestaDB_v1:biz-ab:uid:sig','firebase:authUser:project','PrimeDocs:data','TaxPress:data','veconi:spaces:v1:uid:biz-b'])assert.equal(protocol.ownsStorageKey(key,'biz-a'),false,key);
  assert.equal(protocol.ownsRecord({scope:'business-cache:v156:adiFestaDB_v1:biz-a:uid:sig'},'biz-a'),true);
  assert.equal(protocol.ownsRecord({scope:'business-cache:v156:adiFestaDB_v1:biz-ab:uid:sig'},'biz-a'),false);
  assert.equal(protocol.ownsRecord({scope:'biz-a:uid',key:'message-active:biz-a:uid'},'biz-a'),true);
  assert.equal(protocol.ownsRecord({scope:'biz-b:uid',key:'message-active:biz-b:uid'},'biz-a'),false);
});
test('financial preferences remove only reset-space references, retaining other business/personal views',()=>{
  const source={customViews:[{id:'view-a',name:'A',financialSpaceIds:['space-a']},{id:'view-mixed',name:'Mix',financialSpaceIds:['space-a','personal']}],favoriteViewIds:['view-a','view-mixed','space:space-a','space:personal'],defaultViewId:'view-a',lastViewId:'space:personal'};
  const next=protocol.pruneFinancialView(source,['space-a']);
  assert.deepEqual(next.customViews,[{id:'view-mixed',name:'Mix',financialSpaceIds:['personal']}]);
  assert.deepEqual(next.favoriteViewIds,['view-mixed','space:personal']);assert.equal(next.defaultViewId,null);assert.equal(next.lastViewId,'space:personal');
  assert.equal(source.customViews.length,2);
});
test('generation validation never coerces an invalid identity',()=>{
  for(const generation of [NaN,-1,'1',1.3])assert.throws(()=>protocol.identity('biz-a',generation));
  assert.throws(()=>protocol.identity('../biz-b',1));
  assert.deepEqual(protocol.identity('biz-a',0),{businessId:'biz-a',workspaceGeneration:0});
});
test('mixed local financial preferences preserve personal and other-business spaces',()=>{
  const values=new Map(Object.entries({
    'veconi:spaces:v1:owner:biz-a':JSON.stringify([{id:'shop',businessId:'biz-a'},{id:'personal',type:'personal'}]),
    'adiFesta:financial-spaces:v1:owner':JSON.stringify([{id:'shop',linkedBusinessId:'biz-a'},{id:'another',businessId:'biz-b'}]),
    'veconi:financial-view-profile:v1:owner':JSON.stringify({customViews:[{id:'mix',financialSpaceIds:['shop','personal']}],favoriteViewIds:['space:shop','mix'],defaultViewId:'space:shop'}),
    'adiFesta:lastFinancialSpaceId:v1:owner':'shop',
    'veconi:last-financial-view:v1:owner':'space:shop',
    'adiFesta:financial-consolidated:v1:owner':JSON.stringify(['shop','personal'])
  }));
  const storage={get length(){return values.size;},key:n=>[...values.keys()][n],getItem:key=>values.get(key)||null,setItem:(key,value)=>values.set(key,value),removeItem:key=>values.delete(key)};
  protocol.cleanFinancialPreferences(storage,'biz-a');
  assert.deepEqual(JSON.parse(storage.getItem('adiFesta:financial-spaces:v1:owner')),[{id:'another',businessId:'biz-b'}]);
  const view=JSON.parse(storage.getItem('veconi:financial-view-profile:v1:owner'));
  assert.deepEqual(view.customViews,[{id:'mix',financialSpaceIds:['personal']}]);assert.equal(view.defaultViewId,null);
  assert.equal(storage.getItem('adiFesta:lastFinancialSpaceId:v1:owner'),null);assert.equal(storage.getItem('veconi:last-financial-view:v1:owner'),null);
  assert.deepEqual(JSON.parse(storage.getItem('adiFesta:financial-consolidated:v1:owner')),['personal']);
});
