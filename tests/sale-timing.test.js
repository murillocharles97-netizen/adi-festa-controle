'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/sale-timing.js','utf8'),sync=fs.readFileSync('js/firebase/sync.js','utf8');
function runtime(authorized=true){let clock=0;const c={performance:{now:()=>clock},Date,Set,Map,WeakMap,Promise,JSON,Math,Object};c.window=c;vm.createContext(c);vm.runInContext(source.replace('export function','function')+'\nwindow.VeconiSaleTiming=createSaleTiming({isAuthorized:()=>'+authorized+'});',c);return {c,api:c.VeconiSaleTiming,tick:n=>clock+=n};}
const part=(a,b)=>sync.slice(sync.indexOf(a),sync.indexOf(b,sync.indexOf(a)));
test('disabled by default, no trace without opt-in, no storage or outbound transport',()=>{
 const h=runtime();assert.equal(h.api.begin(),null);assert.equal(h.api.report().traces.length,0);
 assert.doesNotMatch(source,/localStorage|sessionStorage|indexedDB|fetch\(|sendBeacon|XMLHttpRequest|console\./);
});
test('monotonic timestamps, processing interval, categories and exclusive partition',()=>{
 const h=runtime();h.api.enable();const t=h.api.begin();h.tick(2);h.api.validated(t);h.api.state('processing');
 const queue=h.api.start('queue.drain','control',t),wait=h.api.start('queue.wait_existing','queue_wait',t);h.tick(10);h.api.end(wait);
 const net=h.api.start('sale.reread','firestore',t);h.tick(20);h.api.end(net);h.api.end(queue);h.api.state('success');h.tick(3);h.api.finish('ok',t);
 const r=h.api.report().traces[0];assert.equal(r.totalMs,35);assert.equal(r.processingMs,30);assert.equal(r.exclusiveMs.firestore,20);assert.equal(r.exclusiveMs.queue_wait,10);assert.ok(r.startedAt);assert.equal(r.outcome,'ok');
});
test('bind keeps operation ID private; stage injection and payload-like fields are rejected',()=>{
 const h=runtime();h.api.enable();const t=h.api.begin();h.api.bind('private-operation@example.test',t);assert.equal(h.api.isTarget('private-operation@example.test',t),true);
 h.api.mark('customer@email.test','local',t);h.api.start('local.validation','SECRET_KIND',t);h.api.finish('ok',t);
 assert.doesNotMatch(JSON.stringify(h.api.report()),/private-operation|customer@email|SECRET_KIND/);
});
test('observing promises never replaces identity/value or swallows original rejection',async()=>{
 const h=runtime();h.api.enable();const t=h.api.begin(),p=Promise.resolve({ok:true});assert.strictEqual(h.api.observe('sale.reread','firestore',p,t),p);assert.deepEqual(await p,{ok:true});
 const error=new Error('secret server payload'),bad=Promise.reject(error);assert.strictEqual(h.api.observe('effect.verify_read','firestore',bad,t),bad);await assert.rejects(bad,e=>e===error);h.api.finish('error',t);
 const report=h.api.report();assert.equal(report.traces[0].rows.find(x=>x.stage==='effect.verify_read').outcome,'error');assert.doesNotMatch(JSON.stringify(report),/secret server payload/);
});
test('local measurement preserves synchronous result and exception identity',()=>{
 const h=runtime();h.api.enable();h.api.begin();const object={};assert.strictEqual(h.api.measureSync('local.sale_create','local',()=>object),object);const error=new Error('do not log');assert.throws(()=>h.api.measureSync('local.sale_create','local',()=>{throw error}),e=>e===error);assert.doesNotMatch(JSON.stringify(h.api.report()),/do not log/);
});
test('bounded collection, disable and interruption do not touch operational state',()=>{
 const h=runtime();h.api.enable();const t=h.api.begin();for(let i=0;i<450;i++)h.api.mark('transaction.attempt','control',t);h.api.finish('ok',t);
 const r=h.api.report();assert.equal(r.traces.length,1);assert.ok(r.traces.every(t=>t.rows.length===400&&t.truncated));assert.equal(h.api.enable().enabled,false);assert.equal(h.api.begin(),null);h.api.disable();assert.equal(h.api.current(),null);assert.equal(h.api.report().enabled,false);
});
test('unauthorized caller cannot arm, and clearing destroys the memory-only trace',()=>{
 const denied=runtime(false);assert.equal(denied.api.enable().enabled,false);assert.equal(denied.api.begin(),null);
 const h=runtime();h.api.enable();h.api.begin();h.api.clear();assert.equal(h.api.report().enabled,false);assert.equal(h.api.report().traces.length,0);
});
test('export is manual, contains timing only and uses the requested filename',async()=>{
 const h=runtime(),blobs=[],anchors=[];Object.assign(h.c,{Blob,URL:{createObjectURL:blob=>{blobs.push(blob);return 'blob:temporary'},revokeObjectURL(){}},document:{createElement:()=>{const a={click(){this.clicked=true}};anchors.push(a);return a}},setTimeout:()=>0});
 h.api.enable();const token=h.api.begin();h.tick(7);h.api.finish('ok',token);assert.equal(blobs.length,0);assert.equal(h.api.download(),true);
 assert.equal(anchors[0].download,'veconi-fiado-timing.json');assert.equal(anchors[0].clicked,true);const json=JSON.parse(await blobs[0].text());assert.equal(json.traces[0].totalMs,7);assert.equal(json.enabled,false);assert.doesNotMatch(JSON.stringify(json),/ownerUid|businessId|clienteId|saldo|valorTotal|operationId/);
});
function syncRuntime(h){const c=h.c;c.saleTimingWait=vm.runInContext('('+part('function saleTimingWait(', 'async function syncStep(').trim()+')',c);return c;}
test('actual confirmation path preserves read order and flags the second sale read explicitly',async()=>{
 const h=runtime();h.api.enable();const t=h.api.begin();h.api.bind('op',t);const c=syncRuntime(h),calls=[];
 Object.assign(c,{currentUser:{uid:'synthetic'},readOnlyMode:false,navigator:{onLine:true},db:{},activeBusinessId:()=> 'synthetic',doc:(_db,...parts)=>parts.join('/'),cleanCloudItem:x=>x,
 getDocFromServer:async path=>{calls.push(path);h.tick(3);return {id:'sale',exists:()=>true,data:()=>({operationId:'op',financialAppliedAt:'yes',clienteId:'client',status:'fiado'})}},
 applyCloudCollection:name=>calls.push('apply:'+name),processSyncQueue:async()=>{calls.push('queue');h.tick(5)}});
 vm.runInContext(part('async function confirmCreditSale(', 'function cleanCloudItem('),c);
 const sale={id:'sale',clienteId:'client',operationId:'op',status:'fiado'};await c.confirmCreditSale(sale);assert.deepEqual(calls,['queue','businesses/synthetic/sales/sale','apply:sales','businesses/synthetic/clients/client','apply:clients']);h.api.finish('ok',t);
 assert.ok(h.api.report().traces[0].rows.some(x=>x.stage==='sale.reread'));assert.doesNotMatch(JSON.stringify(h.api.report()),/synthetic|clienteId|financialAppliedAt|operationId/);
});
test('actual queue wait branch returns the original in-flight outcome without starting a second worker',async()=>{
 const h=runtime();h.api.enable();h.api.begin();const c=syncRuntime(h);let resolve;const pending=new Promise(r=>resolve=r);c.processingPromise=pending;
 const prefix=part('async function processSyncQueue(', '  if (queueCounts().corrupt)');vm.runInContext(prefix+'\n}',c);const observed=c.processSyncQueue();h.tick(13);resolve('original-result');assert.equal(await observed,'original-result');await Promise.resolve();assert.equal(h.api.report().traces[0].rows.find(x=>x.stage==='queue.wait_existing').durationMs,13);
});
test('actual confirmation failure preserves error, performs no extra retry/read/write',async()=>{
 const h=runtime();h.api.enable();h.api.begin();const c=syncRuntime(h),error=new Error('secret backend text');let reads=0,applies=0;
 Object.assign(c,{currentUser:{},readOnlyMode:false,navigator:{onLine:true},db:{},activeBusinessId:()=> 'b',doc:()=> 'private-path',getDocFromServer:()=>{reads++;return Promise.reject(error)},processSyncQueue:async()=>{},applyCloudCollection:()=>applies++});
 vm.runInContext(part('async function confirmCreditSale(', 'function cleanCloudItem('),c);await assert.rejects(c.confirmCreditSale({id:'s',status:'fiado'}),e=>e===error);assert.equal(reads,1);assert.equal(applies,0);assert.doesNotMatch(JSON.stringify(h.api.report()),/secret backend|private-path/);
});
test('SDK call and mutation counts are unchanged; tracing does not introduce additional cloud operations',()=>{
 const commit=part('async function commitQueueItem(', 'async function verifySaleQueueCommit(');assert.equal((commit.match(/runTransaction\(db,/g)||[]).length,1);assert.match(commit,/transaction\.attempt/);assert.match(commit,/transaction\.stage_financial_effect/);assert.match(sync,/sale\.verify_read/);assert.match(sync,/effect\.verify_read/);
 const checkout=fs.readFileSync('js/checkout.js','utf8');assert.match(checkout,/!finishing[\s\S]*VeconiSaleTiming\?\.begin/);assert.match(checkout,/await DB\.flush\?\.\(\)/);assert.match(checkout,/await window\.SyncFirebase\.confirmCreditSale\(sale\)/);assert.match(checkout,/VeconiSaleTiming\?\.state\?\.\(state\)/);
});
