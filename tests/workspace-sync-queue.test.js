'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/firebase/sync.js','utf8');
function preflight(generation,item){
  const context={window:{DB:{getWorkspaceGeneration:()=>generation,carregar:()=>({})}},SOURCES:{clients:{key:'clientes'}},CLOUD_NAMES:['clients'],activeBusinessId:()=> 'business-a',currentUser:{uid:'owner'}};
  vm.createContext(context);
  vm.runInContext(source.slice(source.indexOf('const queuePreflight ='),source.indexOf('const readPullState ='))+'\nthis.check=queuePreflight;',context);
  return context.check(item);
}
const operation=()=>({businessId:'business-a',userId:'owner',operationId:'operation-1',payload:{writes:[{entityType:'clients',entityId:'client-1',operation:'create',data:{nome:'QA'}}]}});
test('unstamped legacy queue belongs only to generation zero',()=>{
  assert.equal(preflight(0,operation()).ok,true);
  assert.equal(preflight(1,operation()).code,'workspace-generation-mismatch');
});
test('old queued operation cannot be retagged during upload after a reset',()=>{
  const item={...operation(),workspaceGeneration:3};
  assert.equal(preflight(3,item).ok,true);
  assert.equal(preflight(4,item).code,'workspace-generation-mismatch');
  assert.equal(item.workspaceGeneration,3);
  item.workspaceGeneration=4;item.payload.writes[0].data.workspaceGeneration=3;
  assert.equal(preflight(4,item).code,'workspace-generation-mismatch');
});
test('business isolation still applies to a correctly stamped queue',()=>{
  const item={...operation(),workspaceGeneration:1,businessId:'business-b'};
  assert.equal(preflight(1,item).code,'business-mismatch');
});
