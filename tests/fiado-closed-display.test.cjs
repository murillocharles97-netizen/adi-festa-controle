'use strict';
// Closed legacy Fiado (adi-festa): a client with a valid opening shows its balance
// directly — no "a conferir", origin review, partial count or proof round trip.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {harness}=require('./helpers/owner-receipt-v219.cjs');
function fixture({closed=true,newInstallment=false,foreignSale=false}={}){
 const h=harness({businessId:'adi-festa',spaceId:'business_adi-festa'}),{w}=h,db=h.rows(),client=db.clientes[0];
 w.Router={atual:()=> 'clientes'};w.Utils.escapar=String;
 const ctx=w.BusinessContext.get();ctx.role='owner';if(closed)ctx.business.fiadoLegacyClosed={version:1,state:'complete',legacyDeletion:'pending'};
 const ids=['business_adi-festa','qa-card-space'];
 w.BusinessContext.canAccessSpace=id=>ids.includes(id);
 for(const file of ['js/spaces.js','js/clientes.js'])w.eval(fs.readFileSync(file,'utf8'));
 w.SpaceContext.setSpaces(ids.map(id=>({id,businessId:'adi-festa',name:id,type:'business',active:true})));
 w.SpaceContext.selectActive('business_adi-festa');
 Object.assign(client,{saldo:-472,financialVersion:31,fiadoHistoryVersion:1,hasInstallmentFiado:false,legacyBalance:396,legacyBalanceRemaining:116,
  fiadoOpeningBalance:{version:1,hash:'h1'},customerSpaceIds:['business_adi-festa']});
 // Archived legacy history still cached on the device (unassigned origin, old installment).
 const day=w.InstallmentPlan.today();
 db.vendas=[{id:'legacy-a',clienteId:client.id,businessId:'adi-festa',formaPagamento:'fiado',status:'fiado',valorFinal:999,data:'2026-01-02T12:00:00.000Z'},
  {id:'legacy-plan',clienteId:client.id,businessId:'adi-festa',spaceId:'qa-card-space',formaPagamento:'fiado',status:'fiado',valorFinal:900,
   installmentPlan:w.InstallmentPlan.create({total:900,count:3,firstDueDate:w.InstallmentPlan.month(day,1),saleDate:day}),data:day+'T12:00:00.000Z'}];
 if(newInstallment)db.vendas.push({...db.vendas[1],id:'new-plan',fiadoOpeningHash:'h1'});
 if(foreignSale)db.vendas.push({id:'new-card',clienteId:client.id,businessId:'adi-festa',spaceId:'qa-card-space',formaPagamento:'fiado',status:'fiado',valorFinal:20,fiadoOpeningHash:'h1'});
 let calls=0;w.FirebaseCallable=async()=>{calls++;throw Error('servidor indisponível');};
 return {h,w,client,calls:()=>calls,close:()=>h.close()};
}
test('closed company: opened client shows the exact balance with no proof call and no conference message',()=>{
 const f=fixture();try{
  assert.equal(f.w.InstallmentCredit.has(f.client.id),false,'archived history no longer requires proof');
  const s=f.w.Clientes.financialStatus(f.client),l=f.w.Clientes.listFinancialStatus(f.client);
  for(const x of [s,l]){assert.equal(x.status,'debt');assert.equal(x.debt,472);assert.equal(x.reason,undefined);}
  assert.doesNotMatch(String(f.w.InstallmentCredit.balanceText?.(f.client.id)||''),/conferir/);
  assert.equal(f.calls(),0);
 }finally{f.close();}
});
test('a NEW installment or a NEW sale outside Adi Festa still uses the server proof',()=>{
 for(const opts of [{newInstallment:true},{foreignSale:true}]){
  const f=fixture(opts);try{
   const s=f.w.Clientes.financialStatus(f.client);
   assert.equal(s.status,'unverified',JSON.stringify(opts));
  }finally{f.close();}
 }
});
test('companies without the closure keep the previous proof behaviour',()=>{
 const f=fixture({closed:false});try{
  assert.equal(f.w.InstallmentCredit.has(f.client.id),true);
  assert.equal(f.w.Clientes.financialStatus(f.client).status,'unverified');
 }finally{f.close();}
});
