'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {harness}=require('./helpers/owner-receipt-v219.cjs');
function fixture(status='applied'){
 const h=harness(),client=h.rows().clientes[0];
 Object.assign(client,{saldo:-800,financialVersion:6});delete client.legacyBalance;delete client.legacyBalanceRemaining;
 h.rows().vendas=[{id:'qa-historical-sale',businessId:'qa-business',spaceId:'qa-space',clienteId:client.id,formaPagamento:'fiado',status,valorFinal:3.5,creditOriginalAmount:3.5,creditPaidAmount:0,creditRemainingAmount:3.5,data:'2026-08-26T22:12:47Z'}];
 return{h,client,receive:()=>h.w.Fiados.receber(client.id,56,'QA sintético',{operationId:'qa-legacy-payment',paymentMethod:'pix'})};
}
for(const status of ['fiado','applied'])test('legacy initialization excludes the existing tracked debt for '+status,()=>{
 const {h,client,receive}=fixture(status);try{const p=receive(),c=h.rows().clientes[0];
  assert.equal(p.legacyAmount,56);assert.equal(c.saldo,-744);assert.equal(c.legacyBalance,796.5);assert.equal(c.legacyBalanceRemaining,740.5);
  assert.equal(h.rows().vendas[0].creditRemainingAmount,3.5);assert.equal(h.rows().alocacoesPagamento.length,0);
  const before=JSON.stringify(h.rows());assert.equal(receive().id,p.id);assert.equal(JSON.stringify(h.rows()),before);assert.equal(h.commits(),1);
 }finally{h.close();}
});
for(const flags of [{active:false},{deletedAt:'2026-09-01T00:00:00Z'},{desfeita:true},{cancelledAt:'2026-09-01T00:00:00Z'},{formaPagamento:'pix'}])test('inactive or non-credit history is not subtracted: '+JSON.stringify(flags),()=>{
 const {h,receive}=fixture();try{Object.assign(h.rows().vendas[0],flags);receive();assert.equal(h.rows().clientes[0].legacyBalance,800);assert.equal(h.rows().clientes[0].legacyBalanceRemaining,744);}finally{h.close();}
});
test('existing inconsistent legacy stays preserved; no automatic reconciliation or queue replay',()=>{
 const {h,client}=fixture();try{
  Object.assign(client,{saldo:-247,legacyBalance:800,legacyBalanceRemaining:22});
  for(const file of ['functions/src/shared/installment-plan.js','functions/src/shared/fiado-account.js','js/installment-credit.js'])h.w.eval(fs.readFileSync(file,'utf8'));
  h.rows().pagamentos=[{id:'qa-rejected-original',operationId:'qa-rejected-original',clienteId:client.id,status:'pending_sync',valor:10}];
  const before=JSON.stringify(h.rows());
  assert.throws(()=>h.w.InstallmentCredit.salePreview(client,20,{count:10,downPayment:0,firstDueDate:'2026-12-07'},'2026-11-07'),/Histórico incompleto/);
  assert.equal(JSON.stringify(h.rows()),before);assert.equal(h.commits(),0);
 }finally{h.close();}
});
test('recorded chronology explains 247; a hypothetical approved projection repair never changes the accounting balance',()=>{
 const {h,client}=fixture();try{
  const debtDeltas=[3.5,397,109.5,-30,70,250,-56,493,-268,-309,-163,-250];
  assert.equal(debtDeltas.reduce((sum,x)=>sum+Math.round(x*100),0),24700);
  Object.assign(client,{saldo:-247,legacyBalance:800,legacyBalanceRemaining:243.5});
  for(const file of ['functions/src/shared/installment-plan.js','functions/src/shared/fiado-account.js','js/installment-credit.js'])h.w.eval(fs.readFileSync(file,'utf8'));
  const before=JSON.stringify(h.rows()),p=h.w.InstallmentCredit.salePreview(client,20,{count:10,downPayment:0,firstDueDate:'2026-12-07'},'2026-11-07');
  assert.equal(p.current.dueCents,24700);assert.equal(p.futureCents,2000);assert.equal(p.totalCents,26700);
  assert.equal(JSON.stringify(h.rows()),before);assert.equal(h.commits(),0);
 }finally{h.close();}
});
