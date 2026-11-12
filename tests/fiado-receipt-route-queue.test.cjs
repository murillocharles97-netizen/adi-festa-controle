'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const source=fs.readFileSync('js/firebase/sync.js','utf8');
const section=(start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));

function fixture(){
  const key='qa-scoped-queue',store=new Map(),payments=[],calls=[];
  const s={currentUser:{uid:'owner'},auth:{currentUser:{uid:'owner'}},navigator:{onLine:true},
    DB:{__firebaseSyncWrapped:true,getWorkspaceGeneration:()=>0,carregar:()=>({pagamentos:payments})},
    BusinessContext:{get:()=>({role:'owner'})},activeBusinessId:()=> 'adi-festa',queueKey:()=>key,
    localStorage:{peekItem:k=>store.get(k),getItem:()=>assert.fail('unexpected lazy import')},
    LEGACY_QUEUE_KEY:'qa-legacy-queue',AdiFestaBuild:{release:230},assertSyncProtocolBundle:()=>{},
    classifyQueueOperation:item=>({category:item.resolution==='verified'?'resolved':'pending'}),
    FirebaseCallable:async(name,data)=>{calls.push({name,data});return{data:{...data,fiadoReceiptRouteVersion:1}};}};
  s.window=s;
  vm.createContext(s);
  vm.runInContext(section('const readQueueStrict =','const saveQueue =')+
    section('function assertFiadoReceiptQueueClear(', 'function saleQueueRequiresReview('),s);
  const packet=(writes,other={})=>({operationId:'qa-op',businessId:'adi-festa',userId:'owner',
    workspaceGeneration:0,payload:{writes},...other});
  const queue=items=>store.set(key,JSON.stringify(items));
  return {s,queue,packet,payments,calls,store,key,assertClear:()=>s.assertFiadoReceiptQueueClear('qa-client')};
}
const receive=(clientId='qa-client')=>({entityType:'payments',operation:'create',data:{clientId}});
test('read-only queue check blocks every unresolved financial status and keeps the original bytes',()=>{
  const f=fixture();
  for(const status of ['pending','syncing','local_preparing','error','manual_review','archived']){
    f.queue([f.packet([receive()],{status})]);
    const before=f.store.get(f.key);
    assert.throws(f.assertClear,{code:'fiado-local-pending'});
    assert.equal(f.store.get(f.key),before);
  }
  f.queue([f.packet([receive('someone-else')]),f.packet([receive()],{businessId:'another-company'}),
    f.packet([{entityType:'sales',data:{clienteId:'qa-client',formaPagamento:'pix',status:'pago'}}]),
    f.packet([{entityType:'clients',entityId:'qa-client',before:{saldo:-81},data:{saldo:-81,nome:'QA'}}])]);
  assert.doesNotThrow(f.assertClear);
  f.queue([f.packet([{entityType:'sales',before:{clienteId:'qa-client',formaPagamento:'fiado'},data:{active:false}}])]);
  assert.throws(f.assertClear,{code:'fiado-local-pending'});
});

test('old queue, unmatched local payment and corrupt data cannot pass as checked',()=>{
  const f=fixture(),legacy=[{collection:'payments',id:'old',data:{clienteId:'qa-client'}}];
  f.store.set(f.s.LEGACY_QUEUE_KEY,JSON.stringify(legacy));
  assert.throws(f.assertClear,{code:'fiado-local-pending'});
  f.store.set(f.key+':legacyMigrated','2026-11-11');
  assert.doesNotThrow(f.assertClear);
  f.store.set('adiFesta:adi-festa:syncQueue',JSON.stringify([f.packet([receive()])]));
  assert.throws(f.assertClear,{code:'fiado-local-pending'});
  f.queue([f.packet([receive()],{resolution:'verified'})]);
  f.payments.push({clienteId:'qa-client',operationId:'qa-op',status:'pending_sync'});
  assert.doesNotThrow(f.assertClear);
  f.payments.push({clienteId:'qa-client',operationId:'other-op',status:'pending_sync'});
  assert.throws(f.assertClear,{code:'fiado-local-pending'});
  f.store.set(f.key,'not JSON');
  assert.throws(f.assertClear,/corrompida/);
});

test('writer capability must come from the active company and protected protocol',async()=>{
  const f=fixture();
  await f.s.assertFiadoReceiptWriter('adi-festa',0);
  assert.equal(f.calls[0].data.syncProtocolVersion,1);
  assert.equal(f.calls[0].data.clientRelease,230);
  await assert.rejects(f.s.assertFiadoReceiptWriter('adi-festa',0,1),{code:'fiado-writer-unavailable'});
  f.s.FirebaseCallable=async()=>({data:{businessId:'adi-festa',workspaceGeneration:0,fiadoReceiptRouteVersion:1,fiadoScopedReceiptVersion:1}});
  await f.s.assertFiadoReceiptWriter('adi-festa',0,1);
  f.s.FirebaseCallable=async()=>({data:{businessId:'adi-festa',workspaceGeneration:0,protocolVersion:1}});
  await assert.rejects(f.s.assertFiadoReceiptWriter('adi-festa',0),{code:'fiado-writer-unavailable'});
  f.s.FirebaseCallable=async()=>({data:{businessId:'adi-festa',workspaceGeneration:1,fiadoReceiptRouteVersion:1}});
  await assert.rejects(f.s.assertFiadoReceiptWriter('adi-festa',0),{code:'fiado-writer-unavailable'});
  f.s.navigator.onLine=false;
  await assert.rejects(f.s.assertFiadoReceiptWriter('adi-festa',0),/Conecte-se/);
});
