'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {harness} = require('./helpers/owner-receipt-v219.cjs');
const terms = {count:10,downPayment:0,firstDueDate:'2026-12-07'};
function fixture() {
  const h = harness();
  for (const file of ['functions/src/shared/installment-plan.js','functions/src/shared/fiado-account.js','js/installment-credit.js']) h.w.eval(fs.readFileSync(file,'utf8'));
  const client = h.rows().clientes[0];
  Object.assign(client,{saldo:-247,legacyBalance:247,legacyBalanceRemaining:247});
  h.rows().vendas=[];
  return {h,client,preview:(options=terms,day='2026-11-07')=>h.w.InstallmentCredit.salePreview(client,20,options,day)};
}
test('247 exigible + 20 future = 247 exigible, 20 future, 267 total without any mutation',()=>{
  const {h,client,preview}=fixture();try {
    const before=JSON.stringify(h.rows()),p=preview();
    assert.equal(p.current.dueCents,24700);assert.equal(p.dueCents,24700);
    assert.equal(p.newDueCents,0);assert.equal(p.futureCents,2000);assert.equal(p.totalCents,26700);
    assert.equal(JSON.stringify(h.rows()),before);assert.equal(h.commits(),0);
    const due=preview({...terms,firstDueDate:'2026-11-07'});
    assert.equal(due.dueCents,24900);assert.equal(due.futureCents,1800);
    const entry=preview({...terms,downPayment:5});
    assert.equal(entry.dueCents,25200);assert.equal(entry.futureCents,1500);assert.equal(client.saldo,-247);
  }finally{h.close();}
});
test('previous debt, overdue, future and partial payments use the existing canonical account model',()=>{
  const {h,client,preview}=fixture();try {
    const plan=h.w.InstallmentPlan.create({total:2800,count:10,firstDueDate:'2026-10-07',saleDate:'2026-10-01'});
    Object.assign(client,{saldo:-2750,legacyBalance:0,legacyBalanceRemaining:0});
    h.rows().vendas=[{id:'plan',clienteId:client.id,status:'fiado',formaPagamento:'fiado',valorFinal:2800,creditPaidAmount:100,installmentPlan:plan,data:'2026-10-01T12:00:00Z'},
      {id:'traditional',clienteId:client.id,status:'fiado',formaPagamento:'fiado',valorFinal:50,data:'2026-10-01T12:00:00Z'}];
    const p=preview();assert.equal(p.current.dueCents,51000);assert.equal(p.current.futureCents,224000);
    assert.equal(p.dueCents,51000);assert.equal(p.futureCents,226000);assert.equal(p.totalCents,277000);
  }finally{h.close();}
});
test('incomplete calendar or inconsistent legacy evidence never silently becomes an exigible estimate',()=>{
  const {h,client,preview}=fixture();try {
    client.hasInstallmentFiado=true;assert.throws(()=>preview(),/calendário completo/);
    delete client.hasInstallmentFiado;client.legacyBalanceRemaining=10;
    assert.throws(()=>preview(),/Histórico incompleto/);
  }finally{h.close();}
});
