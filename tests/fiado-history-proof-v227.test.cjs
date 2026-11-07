'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{fixture}=require('./helpers/fiado-history-proof.cjs'),{prove}=require('../scripts/lib/fiado-history-proof.cjs');
const Plan=require('../functions/src/shared/installment-plan');
test('confirmed 247 history replaces no real field and remains incompatible with the unmodified backend',()=>{
 const input=fixture(),before=JSON.stringify(input),p=prove(input,'2026-11-07');
 assert(p.financialProof);assert.equal(p.account.dueCents,24700);assert.equal(p.account.futureCents,0);assert.equal(p.account.totalCents,24700);
 assert.equal(p.effectsAfterAnchor,12);assert.equal(p.backendCompatible,false);assert.equal(p.currentBackendEligible,false);assert.equal(input.client.legacyBalanceRemaining,22);assert.equal(JSON.stringify(input),before);
});
test('consistent existing account passes proof and current backend projection',()=>{const input=fixture();input.client.legacyBalanceRemaining=243.5;const p=prove(input,'2026-11-07');assert(p.financialProof);assert(p.backendCompatible);assert(p.currentBackendEligible);});
test('a currently valid account with tracked sales and no legacy snapshot cannot be promised a working first plan',()=>{const input=fixture();delete input.client.legacyBalance;delete input.client.legacyBalanceRemaining;const p=prove(input,'2026-11-07');assert(p.strictEligible);assert(p.financialProof);assert.equal(p.firstPlanCompatible,false);assert.equal(p.currentBackendEligible,false);});
for(const change of ['delta','marker','source','event','unstable','incomplete','foreign','pending','duplicate'])test('no financial compatibility from unproved evidence: '+change,()=>{
 const input=fixture();if(change==='delta')input.collections.balanceEvents.at(-1).balanceDelta+=1;if(change==='marker')input.collections.processedOperations.pop();if(change==='source')input.collections.payments.pop();if(change==='event')input.collections.balanceEvents.pop();if(change==='unstable')input.stable=false;if(change==='incomplete')input.complete=false;if(change==='foreign')input.collections.balanceEvents.at(-1).businessId='other';if(change==='pending')input.collections.payments.at(-1).status='pending_sync';if(change==='duplicate')input.collections.balanceEvents.push({...input.collections.balanceEvents[0]});
 assert.equal(prove(input,'2026-11-07').financialProof,false);
});
test('matching final sum does not hide a broken chain',()=>{const input=fixture();input.collections.payments[0].saldoAnterior-=1;input.collections.payments[0].saldoNovo-=1;assert.equal(prove(input,'2026-11-07').reason,'broken-balance-chain');});
test('restored opening debt without a confirmed zero is not invented as proof',()=>{const input=fixture([10]);input.client.legacyBalanceRemaining=30;input.client.saldo=-40;input.collections.sales[0].saldoAnterior=-30;input.collections.sales[0].saldoAtual=-40;assert.equal(prove(input,'2026-11-07').financialProof,false);});
test('a confirmed later zero fences older unproved history without manufacturing movements',()=>{const input=fixture([10,-10,15]);input.client.legacyBalanceRemaining=15;input.collections.sales[0].operationId='old-unproved-alias';const p=prove(input,'2026-11-07');assert(p.financialProof);assert.equal(p.account.totalCents,1500);assert.equal(p.anchor.kind,'confirmed-zero');});
test('sub-cent historical contracts require review, never silent rounding',()=>{const input=fixture([10]);input.client.legacyBalanceRemaining=0;input.collections.sales[0].valorFinal=9.9999;assert.equal(prove(input,'2026-11-07').financialProof,false);});
test('future, due and partially received installments stay separated with immutable payment evidence',()=>{
 const input=fixture([20,-1]),sale=input.collections.sales[0],p=input.collections.payments[0];
 Object.assign(input.client,{legacyBalance:0,legacyBalanceRemaining:0,hasInstallmentFiado:true});
 sale.installmentPlan=Plan.create({total:20,count:10,downPayment:0,firstDueDate:'2026-12-07',saleDate:'2026-01-01'});sale.creditPaidAmount=1;sale.creditRemainingAmount=19;
 input.collections.paymentAllocations=[{id:p.id+'__'+sale.id,businessId:input.businessId,workspaceGeneration:0,clientId:input.client.id,paymentId:p.id,saleId:sale.id,amount:1}];
 let proof=prove(input,'2026-11-07');assert(proof.financialProof);assert(proof.backendCompatible);assert.equal(proof.account.dueCents,0);assert.equal(proof.account.futureCents,1900);
 proof=prove(input,'2026-12-07');assert.equal(proof.account.dueCents,100);assert.equal(proof.account.futureCents,1800);assert.equal(proof.account.totalCents,1900);
 const savedPaid=sale.creditPaidAmount;sale.creditPaidAmount=21;assert.equal(prove(input,'2026-12-07').reason,'inconsistent-installment-principal');sale.creditPaidAmount=savedPaid;
 input.collections.paymentAllocations=[];assert.equal(prove(input,'2026-12-07').reason,'installment-allocation-mismatch');
});
test('new installment on incompatible history is blocked before sale, stock, ledger or queue mutation',()=>{
 const h=require('./helpers/fiado-cancellation-harness.cjs').harness(),data=h.data();
 Object.assign(data.clientes[0],{saldo:-247,legacyBalance:800,legacyBalanceRemaining:22});data.vendas=[{id:'old',clienteId:'qa-client',formaPagamento:'fiado',status:'applied',valorFinal:3.5,creditPaidAmount:0}];
 const before=JSON.stringify(data),sale={id:'new-plan',operationId:'new-op',businessId:'qa-fiado',spaceId:'qa-space',clienteId:'qa-client',status:'fiado',formaPagamento:'fiado',itens:[{produtoId:'qa-product',quantidade:1,precoFinalUnitario:20}],installmentTerms:{count:10,downPayment:0,firstDueDate:Plan.month(Plan.today(),1)}};
 assert.throws(()=>h.c.Vendas.registrar(sale),e=>e.code==='installment-history-incompatible');assert.equal(JSON.stringify(h.data()),before);
});
test('first-plan initialization cannot double-count tracked traditional sales',()=>{
 const h=require('./helpers/fiado-cancellation-harness.cjs').harness(),data=h.data();Object.assign(data.clientes[0],{saldo:-15});data.vendas=[{id:'old',clienteId:'qa-client',formaPagamento:'fiado',status:'applied',valorFinal:15,creditPaidAmount:0}];
 const sale={id:'new-plan',operationId:'new-op',businessId:'qa-fiado',spaceId:'qa-space',clienteId:'qa-client',status:'fiado',formaPagamento:'fiado',itens:[{produtoId:'qa-product',quantidade:1,precoFinalUnitario:20}],installmentTerms:{count:10,downPayment:0,firstDueDate:Plan.month(Plan.today(),1)}};
 const before=JSON.stringify(data);assert.throws(()=>h.c.Vendas.registrar(sale),e=>e.code==='installment-history-incompatible');assert.equal(JSON.stringify(h.data()),before);
});
test('first-plan initialization cannot overwrite an inconsistent existing remaining field',()=>{
 const h=require('./helpers/fiado-cancellation-harness.cjs').harness(),data=h.data();Object.assign(data.clientes[0],{saldo:-247,legacyBalanceRemaining:22});
 const before=JSON.stringify(data),sale={id:'new-plan',operationId:'new-op',businessId:'qa-fiado',spaceId:'qa-space',clienteId:'qa-client',status:'fiado',formaPagamento:'fiado',itens:[{produtoId:'qa-product',quantidade:1,precoFinalUnitario:20}],installmentTerms:{count:10,downPayment:0,firstDueDate:Plan.month(Plan.today(),1)}};
 assert.throws(()=>h.c.Vendas.registrar(sale),e=>e.code==='installment-history-incompatible');assert.equal(JSON.stringify(h.data()),before);
});
