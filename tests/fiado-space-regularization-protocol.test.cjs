'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto');
const {harness}=require('./helpers/owner-receipt-v219.cjs');
const {operationalCallable}=require('../functions/src/shared/operational-callable');
const Transport=require('../js/workspace-callables');
test('gateway refuses missing protocol before entering the administrative transaction',async()=>{
 let calls=0;const call=operationalCallable(async()=>{calls++;},{requireProtocol:true});
 await assert.rejects(call({auth:{uid:'qa-owner'},data:{kind:'fiado_space_regularization',clientRelease:238}}),e=>e.code==='failed-precondition');
 assert.equal(calls,0);
});
test('actual regularization form passes the real callable protocol boundary through the shared transport',async()=>{
 const h=harness(),w=h.w;try{
  w.Utils.escapar=String;w.Utils.dinheiro=n=>'R$ '+n.toFixed(2);w.AdiFestaBuild={release:238};
  Object.defineProperty(w.crypto,'randomUUID',{value:crypto.randomUUID});
  w.SpaceContext.activeId=()=> 'qa-space';w.SpaceContext.homeSpaces=()=>[{id:'qa-space',name:'Táxi QA'}];
  w.Clientes={obter:()=>({id:'qa-client',nome:'Pessoa fictícia'}),prepareList(){}};
  w.SyncFirebase.assertFiadoReceiptQueueClear=()=>true;w.SyncFirebase.readCanonicalClient=async()=>{};
  w.InstallmentCredit.refresh=async()=>{};
  let writes=0,intent;
  const gateway=operationalCallable(async request=>{writes++;intent=request.data;return {status:'confirmed',clientId:'qa-client',spaceId:'qa-space',newDebtCents:15000};},{requireProtocol:true});
  const runtime={capture:()=>({businessId:'qa-business',workspaceGeneration:0})};
  w.FirebaseCallable=async(name,data)=>{
   const payload=Transport.payload(name,data,runtime);
   if(name==='commitOperationalSync')return {data:await gateway({auth:{uid:'qa-owner'},data:payload})};
   assert.equal(name,'getOperationalSyncReceipt');return {data:{currentDebtCents:0,financialVersion:0,quoteHash:'a'.repeat(64)}};
  };
  w.eval(fs.readFileSync('js/fiado-space-regularization.js','utf8'));
  await w.FiadoSpaceRegularization.open('qa-client');const form=w.document.querySelector('[data-reg-form]');
  form.elements.total.value='150';form.elements.reason.value='Conferência administrativa fictícia';form.elements.confirmed.checked=true;
  await form.onsubmit(new w.Event('submit',{cancelable:true}));
  assert.equal(writes,1,w.document.querySelector('[data-reg-status]').textContent);
  assert.equal(intent.syncProtocolVersion,1);assert.equal(intent.clientRelease,238);
  assert.equal(intent.targetDebtCents,15000);assert.equal(intent.confirmed,true);
  assert.match(w.document.querySelector('[data-reg-status]').textContent,/Saldo confirmado/);
 }finally{h.close();}
});
