'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {projectInWorkspace}=require('../src/services/workspace-projection');

test('late/delete projection never adopts current generation and reset lock suppresses work',async()=>{
  let business={active:true,workspaceGeneration:2},writes=0;
  const db={doc:path=>({path}),runTransaction:fn=>fn({get:async()=>({data:()=>business})})};
  const action=async()=>{writes++;return{created:true}};
  assert.equal((await projectInWorkspace(db,'business-a',{workspaceGeneration:1},action)).skipped,'workspace-generation-mismatch');
  assert.equal((await projectInWorkspace(db,'business-a',{},action)).skipped,'workspace-generation-mismatch');
  business.workspaceReset={status:'FAILED'};
  assert.equal((await projectInWorkspace(db,'business-a',{workspaceGeneration:2},action)).skipped,'workspace-reset-locked');
  assert.equal(writes,0);
  business.workspaceReset={status:'COMPLETED'};
  assert.equal((await projectInWorkspace(db,'business-a',{workspaceGeneration:2},action)).created,true);
  assert.equal(writes,1);
});

test('unrelated database errors remain visible and retryable, never silently swallowed',async()=>{
  const db={doc:path=>({path}),runTransaction:async()=>{throw Object.assign(Error('unavailable'),{code:'unavailable'})}};
  await assert.rejects(projectInWorkspace(db,'business-a',{},()=>{}),{code:'unavailable'});
});
