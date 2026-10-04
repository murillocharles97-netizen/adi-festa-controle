'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../js/workspace-writer');
function setup(generation=2){
  const calls=[];let origin=Object.freeze({businessId:'biz-a',workspaceGeneration:generation}),blocked=false,nonce=0;
  const guard={capture(){if(blocked)throw Object.assign(Error('locked'),{code:'workspace-reset-locked'});return origin;},stamp(data,at){assert.equal(at,origin);return{...data,workspaceGeneration:at.workspaceGeneration,workspaceWriteId:`nonce-${++nonce}`};}};
  const target={set:(...args)=>calls.push(['set',...args]),update:(...args)=>calls.push(['update',...args]),delete:(...args)=>calls.push(['delete',...args]),get:async ref=>({ref}),commit:async()=>calls.push(['commit'])};
  const sdk={setDoc:target.set,updateDoc:target.update,deleteDoc:target.delete,writeBatch:()=>target,runTransaction:async(_db,action)=>action(target)};
  const writer=create({sdk,runtime:()=>guard});
  return{writer,calls,block(){blocked=true;},replace(){origin={...origin};}};
}
const ref={path:'businesses/biz-a/products/product-a'};
test('current business writes receive generation and a fresh nonce without changing financial content',()=>{
  const {writer,calls}=setup();writer.setDoc(ref,{price:25,workspaceGeneration:2},{merge:true});writer.updateDoc(ref,{price:26});
  assert.equal(calls[0][2].price,25);assert.equal(calls[1][2].price,26);
  assert.equal(calls[0][2].workspaceGeneration,2);assert.notEqual(calls[0][2].workspaceWriteId,calls[1][2].workspaceWriteId);
});
test('business isolation and stale payloads fail before an SDK write',()=>{
  const {writer,calls}=setup();
  assert.throws(()=>writer.setDoc({path:'businesses/biz-b/sales/s1'},{value:25}),{code:'workspace-business-mismatch'});
  assert.throws(()=>writer.setDoc(ref,{workspaceGeneration:1}),{code:'workspace-generation-mismatch'});
  assert.equal(calls.length,0);
});
test('a prepared batch cannot commit after reset or principal change',async()=>{
  const first=setup(),batch=first.writer.writeBatch({});batch.set(ref,{price:25});first.block();
  assert.throws(()=>batch.commit(),{code:'workspace-reset-locked'});
  assert.equal(first.calls.some(row=>row[0]==='commit'),false);
  const second=setup(),other=second.writer.writeBatch({});second.replace();assert.throws(()=>other.set(ref,{}),{code:'workspace-origin-mismatch'});
});
test('transaction callbacks retain their origin across awaits',async()=>{
  const {writer,block,calls}=setup();
  await assert.rejects(writer.runTransaction({},async tx=>{await tx.get(ref);block();tx.set(ref,{price:25});}),{code:'workspace-reset-locked'});
  assert.equal(calls.length,0);
});
test('mergeFields includes nonce and epoch; hard delete after reset is not silently allowed',()=>{
  const {writer,calls}=setup();writer.setDoc(ref,{price:25},{mergeFields:['price']});
  assert.deepEqual(calls[0][3].mergeFields,['price','workspaceGeneration','workspaceWriteId']);
  assert.throws(()=>writer.deleteDoc(ref),{code:'workspace-delete-requires-backend'});
});
test('generation zero and personal profile payloads retain legacy schemas',()=>{
  const zero=setup(0);zero.writer.setDoc(ref,{price:25});assert.deepEqual(zero.calls[0][2],{price:25});
  const current=setup(2);current.writer.updateDoc({path:'users/owner'},{name:'Owner'});assert.deepEqual(current.calls[0][2],{name:'Owner'});
});
test('missing runtime cannot implicitly authorize a post-reset workspace',()=>{
  const writer=create({sdk:{},runtime:()=>null,legacyGeneration:()=>2});
  assert.throws(()=>writer.setDoc(ref,{}),{code:'workspace-not-ready'});
});
test('external parent scope reads finish before transaction writes and personal data stays untagged',async()=>{
  const calls=[],origin={businessId:'biz-a',workspaceGeneration:2},guard={capture:()=>origin,stamp:data=>({...data,workspaceGeneration:2,workspaceWriteId:'test-nonce-long-enough'})};
  const tx={get:async ref=>{calls.push(`read:${ref.path}`);return{};},set:(ref,data)=>calls.push({path:ref.path,data})};
  const writer=create({sdk:{runTransaction:async(_db,action)=>action(tx)},runtime:()=>guard,resolveExternalScope:async(ref,_data,{reader})=>{await reader({path:'parent'});return ref.path.includes('personal')?null:'biz-a';}});
  await writer.runTransaction({},async transaction=>{
    transaction.set({path:'businesses/biz-a/products/p-a'},{price:25});
    transaction.set({path:'financialSpaces/shop/entries/e-a'},{amount:25});
    transaction.set({path:'financialSpaces/personal/entries/e-b'},{amount:10});
  });
  assert.deepEqual(calls.slice(0,2),['read:parent','read:parent']);
  assert.equal(calls[3].data.workspaceGeneration,2);assert.equal(calls[4].data.workspaceGeneration,undefined);
});
