'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../js/workspace-runtime');
const identity=require('../js/workspace-generation').identity;
function setup(){
  const events=[];let blocked=true;
  const protocol={identity,create:()=>({block(){blocked=true;},clear(){blocked=true;},capture(){if(blocked)throw Error('blocked');},
    async observe({workspaceGeneration,status,confirmedByServer}){
      assert.equal(confirmedByServer,true);
      events.push('observe');blocked=Boolean(status&&status!=='COMPLETED');return{workspaceGeneration,blocked};
    },stamp:(data,origin)=>({...data,workspaceGeneration:origin.workspaceGeneration})})};
  const runtime=create({protocol,stop:()=>events.push('stop'),retire:async()=>events.push('retire'),onBlocked:detail=>events.push(detail.code)});
  const prepare=(generation=0,status=null)=>runtime.prepare({uid:'owner',business:{id:'biz-a',workspaceGeneration:generation,workspaceReset:{status}},confirmedByServer:true});
  return{runtime,events,prepare};
}
test('server confirmation happens before admitting operations; normal snapshots retain the immutable origin',async()=>{
  const {runtime,prepare}=setup();assert.throws(()=>runtime.capture(),{code:'workspace-not-ready'});
  const origin=await prepare(4);assert.ok(Object.isFrozen(origin));
  assert.equal(runtime.inspectRemote({id:'biz-a',workspaceGeneration:4},{fromCache:false}),true);
  assert.equal(await prepare(4),origin);
  assert.deepEqual(runtime.stamp({amount:25},origin),{amount:25,workspaceGeneration:4});
  assert.throws(()=>runtime.stamp({}, {...origin}),{code:'workspace-origin-mismatch'});
});
test('remote reset stops work synchronously; completion never resumes old callbacks or upgrades their epoch',async()=>{
  const {runtime,events,prepare}=setup(),old=await prepare(4);
  assert.equal(runtime.inspectRemote({id:'biz-a',workspaceGeneration:5,workspaceReset:{status:'DELETING'}},{fromCache:false}),false);
  assert.equal(events[1],'stop');assert.equal(events.includes('retire'),false);
  assert.throws(()=>runtime.stamp({},old),{code:'workspace-reload-required'});
  await Promise.resolve();assert.ok(events.includes('retire'));
  assert.equal(runtime.inspectRemote({id:'biz-a',workspaceGeneration:5,workspaceReset:{status:'COMPLETED'}},{fromCache:false}),false);
  await assert.rejects(prepare(5,'COMPLETED'),{code:'workspace-reload-required'});
  assert.equal(events.filter(value=>value==='stop').length,1);
});
test('cached old snapshots do not downgrade an admitted generation',async()=>{
  const {runtime,prepare}=setup();await prepare(5);
  assert.equal(runtime.inspectRemote({id:'biz-a',workspaceGeneration:4},{fromCache:true}),false);
  assert.equal(runtime.isBlocked(),false);
  assert.equal(runtime.capture().workspaceGeneration,5);
  assert.equal(runtime.inspectRemote({id:'biz-a',workspaceGeneration:4},{fromCache:false}),false);
});
test('FAILED reset at bootstrap never admits operational access',async()=>{
  const {runtime,prepare}=setup();await assert.rejects(prepare(5,'FAILED'),{code:'workspace-reset-locked'});
  assert.throws(()=>runtime.capture(),{code:'workspace-reload-required'});
});
test('another principal or business cannot reuse the same live page origin',async()=>{
  const {runtime,prepare}=setup();await prepare(1);
  await assert.rejects(runtime.prepare({uid:'another-owner',business:{id:'biz-a',workspaceGeneration:1},confirmedByServer:true}),{code:'workspace-reload-required'});
});
test('explicit logout admits a fresh session without authorizing its old captured operations',async()=>{
  const {runtime,prepare}=setup(),old=await prepare(0);
  runtime.endSession();
  assert.throws(()=>runtime.capture(),{code:'workspace-not-ready'});
  await runtime.prepare({uid:'other-user',business:{id:'biz-other'},confirmedByServer:true});
  assert.throws(()=>runtime.stamp({},old),{code:'workspace-origin-mismatch'});
});
