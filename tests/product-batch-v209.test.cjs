'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{runtime}=require('./helpers/product-actions-v209.cjs');
const ids=Array.from({length:9},(_,n)=>'p'+n);
test('V208 exact failure: unrelated Home filter rejects all nine valid products BEFORE any journal, queue or catalog mutation',async()=>{
 const r=runtime({baseline:true}),original=JSON.stringify(r.data),results=await r.api.batch(ids,'delete');
 assert.equal(results.length,9);assert.ok(results.every(r=>r.status==='failed'&&r.message==='O produto não pertence a um espaço autorizado nesta seleção.'));
 assert.equal(r.writes.length,0);assert.equal(r.queue.length,0);assert.equal(r.values.size,0);assert.equal(JSON.stringify(r.data),original);
});
for(const home of ['all_spaces','qa-space','main-space'])test(`owner catalog authorization is canonical, independent of Home selection ${home} or missing Home cache`,async()=>{
 const r=runtime();r.home(home);const original=JSON.stringify(r.data),plan=await r.api.preflight(ids);
 assert.equal(plan.eligibleIds.length,9);assert.equal(r.writes.length,0);assert.equal(r.values.size,0);assert.equal(JSON.stringify(r.data),original);
 const result=await r.api.batch(plan.eligibleIds,'delete');assert.ok(result.every(r=>r.status==='confirmed'));assert.equal(r.writes.length,9);assert.equal(r.queue.length,9);assert.equal(r.api.pending().length,0);assert.ok([...r.remote.values()].every(p=>p.estoqueAtual===7));
});
test('preflight distinguishes ready, ambiguous legacy, denied, previous pending, inactive and unavailable without writes',async()=>{
 const r=runtime();r.set('p1',{spaceAccessMode:undefined,allowedSpaceIds:undefined,defaultSpaceId:undefined});r.set('p2',{businessId:'other'});r.queue.push({operationId:'existing',status:'pending',paths:['businesses/qa-business/products/p3']});r.set('p4',{active:false,ativo:false});r.remote.delete('p5');
 const plan=await r.api.preflight(ids);assert.deepEqual(plan.items.map(r=>r.status),['ready','regularization','forbidden','pending','inactive','forbidden','ready','ready','ready']);assert.equal(r.writes.length,0);assert.equal(r.values.size,0);
});
test('owner may logically retire a proven archived own space or unambiguous legacy space; missing/foreign/conflicting space stays blocked',async()=>{
 const r=runtime();r.set('p0',{spaceAccessMode:undefined,allowedSpaceIds:undefined,defaultSpaceId:undefined,spaceId:'archived-space'});r.set('p1',{allowedSpaceIds:['archived-space'],defaultSpaceId:'archived-space'});r.set('p2',{allowedSpaceIds:['missing'],defaultSpaceId:'missing'});r.set('p3',{spaceId:'conflict'});r.spaces.set('foreign',{id:'foreign',businessId:'other',active:true});r.set('p4',{allowedSpaceIds:['foreign'],defaultSpaceId:'foreign'});
 const plan=await r.api.preflight(['p0','p1','p2','p3','p4']);assert.deepEqual(plan.items.map(r=>r.status),['ready','ready','regularization','regularization','regularization']);assert.equal(r.writes.length,0);assert.equal((await r.api.batch(['p0','p1'],'archive')).filter(r=>r.status==='confirmed').length,2);
});
test('restricted seller respects canonical spaces and never reads another space or Financeiro',async()=>{
 const r=runtime();r.seller(['qa-space']);r.set('p0',{spaceAccessMode:'selected_spaces',allowedSpaceIds:['qa-space','other-private'],defaultSpaceId:'qa-space'});r.set('p1',{allowedSpaceIds:['main-space'],defaultSpaceId:'main-space'});r.set('p2',{allowedSpaceIds:['archived-space'],defaultSpaceId:'archived-space'});r.set('p3',{spaceAccessMode:undefined});r.set('p4',{spaceAccessMode:'all_spaces',allowedSpaceIds:[],defaultSpaceId:null});
 const plan=await r.api.preflight(['p0','p1','p2','p3','p4']);assert.deepEqual(plan.items.map(r=>r.status),['ready','forbidden','forbidden','regularization','ready']);assert.ok(r.reads.filter(p=>p.startsWith('spaces/')).every(p=>p==='spaces/qa-space'));assert.ok(r.reads.every(p=>!/payments|financial|cost|profit/.test(p)));
});
test('products.edit, business and generation cannot be bypassed; stale permission response cannot stage',async()=>{
 const r=runtime();r.deny();await assert.rejects(r.api.preflight(ids),{code:'permission-denied'});assert.equal(r.reads.length,0);
 const b=runtime();b.set('p0',{workspaceGeneration:1});assert.equal((await b.api.preflight(['p0'])).items[0].status,'forbidden');assert.equal(b.writes.length,0);
 const c=runtime();c.env.FirestoreRepositories.products.getProductActionSpacesFromServer=async()=>{c.change();return[c.spaces.get('qa-space')];};await assert.rejects(c.api.preflight(ids),{code:'session-changed'});assert.equal(c.writes.length,0);
});
test('network failure during preflight is unavailable, not an intent; mixed execution reports partial failure and preserves originals',async()=>{
 const r=runtime(),repo=r.env.FirestoreRepositories.products,read=repo.getProductStatusFromServer;
 repo.getProductStatusFromServer=async id=>{if(id==='p0')throw Error('Rede indisponível');return read(id);};const p=await r.api.preflight(ids);assert.equal(p.items[0].status,'unavailable');assert.equal(p.eligibleIds.length,8);assert.equal(r.queue.length,0);
 const result=await r.api.batch(['p0','p1'],'delete');assert.deepEqual(result.map(r=>r.status),['failed','confirmed']);assert.equal(r.queue.length,1);assert.equal(r.writes.length,1);
});
test('lost response, duplicate click, reload and explicit confirmation never create a second intent',async()=>{
 const r=runtime({noCommit:true}),first=r.api.perform('p0');assert.equal(r.api.perform('p0'),first);await assert.rejects(first,{pending:true});const queue=JSON.stringify(r.queue),op=r.writes[0].operationId;
 assert.equal((await r.api.preflight(['p0'])).items[0].status,'pending');assert.equal(r.writes.length,1);assert.equal(JSON.stringify(r.queue),queue);
 r.remote.set('p0',structuredClone(r.data.produtos[0]));const reload=require('../js/product-actions')(r.env);assert.equal((await reload.checkPending())[0].status,'confirmed');assert.equal(r.writes.length,1);assert.equal(r.remote.get('p0').catalogAction.operationId,op);assert.equal(JSON.stringify(r.queue),queue);
});
test('binding changed locally or after preflight is revalidated before staging',async()=>{
 const r=runtime();const plan=await r.api.preflight(['p0']);assert.equal(plan.eligibleIds.length,1);r.remote.get('p0').defaultSpaceId='conflict';await assert.rejects(r.api.perform('p0'),{code:'space-regularization'});assert.equal(r.queue.length,0);
 const b=runtime();b.data.produtos[0].allowedSpaceIds=['main-space'];await assert.rejects(b.api.perform('p0'),{code:'product-origin'});assert.equal(b.queue.length,0);assert.equal(b.api.pending().length,0);
});
