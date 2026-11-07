'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),{fixture}=require('./helpers/fiado-history-proof.cjs'),History=require('../functions/src/shared/fiado-history-account'),Account=require('../functions/src/shared/fiado-account'),Plan=require('../functions/src/shared/installment-plan');
function add(input,type,amount,at,{plan=false,rows=[]}={}){
 const col={credit_sale:'sales',payment_received:'payments',balance_adjustment:'balanceAdjustments'}[type],id='new-'+input.collections.balanceEvents.length,before=input.client.saldo,delta=type==='credit_sale'?-amount:amount,after=Math.round((before+delta)*100)/100,source={id,operationId:id,businessId:input.businessId,workspaceGeneration:0,clienteId:input.client.id,status:'applied',applicationStatus:'applied',data:at,financialAppliedAt:at,saldoAnterior:before,saldoNovo:after};
 if(type==='credit_sale')Object.assign(source,{formaPagamento:'fiado',valorFinal:amount,creditOriginalAmount:amount,creditPaidAmount:0,creditRemainingAmount:amount,saldoAtual:after,...(plan?{installmentPlan:Plan.create({total:amount,count:10,firstDueDate:'2026-12-07',saleDate:at.slice(0,10)})}:{})});
 if(type==='payment_received'){
  source.valor=amount;source.fiadoSchedule={version:2,asOf:at.slice(0,10),advance:rows.some(r=>r.anticipated),rows};source.legacyAmount=rows.filter(r=>!r.saleId).reduce((n,r)=>n+r.amountCents,0)/100;
  for(const saleId of new Set(rows.map(r=>r.saleId).filter(Boolean))){const allocated=rows.filter(r=>r.saleId===saleId).reduce((n,r)=>n+r.amountCents,0)/100,sale=input.collections.sales.find(s=>s.id===saleId);sale.creditPaidAmount+=allocated;sale.creditRemainingAmount-=allocated;input.collections.paymentAllocations.push({id:id+'__'+saleId,businessId:input.businessId,clientId:input.client.id,saleId,paymentId:id,amount:allocated});}
 }
 input.collections[col].push(source);input.collections.balanceEvents.push({id:type+':'+id,businessId:input.businessId,workspaceGeneration:0,customerId:input.client.id,status:'applied',type,sourceCollection:col,sourceDocumentId:id,operationId:id,appliedAt:at,balanceDelta:delta});input.collections.processedOperations.push({id,businessId:input.businessId,workspaceGeneration:0,status:'processed',eventKind:{sales:'sale',payments:'payment',balanceAdjustments:'balance_adjustment'}[col]});input.client.saldo=after;input.client.financialVersion++;return source;
}
test('oldest due is deterministic across historical obligations, matured plans and a newer traditional purchase',()=>{
 const input=fixture(),before=JSON.stringify(input),a=History.project(input,'2026-11-07');assert.equal(a.dueCents,24700);assert.equal(JSON.stringify(input),before);
 add(input,'credit_sale',20,'2026-11-07T12:00:00Z',{plan:true});let account=History.project(input,'2026-11-07');add(input,'payment_received',100,'2026-11-07T13:00:00Z',{rows:Account.allocate(account,10000)});
 add(input,'credit_sale',50,'2026-12-08T12:00:00Z');account=History.project(input,'2026-12-08');assert.equal(account.dueCents,19900);assert.equal(account.futureCents,1800);
 const rows=Account.allocate(account,14800);assert.equal(rows.filter(r=>!r.saleId).reduce((n,r)=>n+r.amountCents,0),14700);assert.equal(rows.filter(r=>r.saleId).reduce((n,r)=>n+r.amountCents,0),100);assert(rows.every(r=>!r.anticipated));
 add(input,'payment_received',148,'2026-12-08T13:00:00Z',{rows});account=History.project(input,'2026-12-08');assert.equal(account.dueCents,5100);assert.equal(account.futureCents,1800);assert.equal(account.totalCents,6900);assert.equal(input.client.legacyBalanceRemaining,22);
 const reversed=structuredClone(input);for(const col of Object.keys(reversed.collections))reversed.collections[col].reverse();assert.deepEqual(History.project(reversed,'2026-12-08'),account);
});
test('no proven debt can be inferred from missing origins, foreign aliases or forged markers',()=>{
 for(const change of ['origin','alias','marker']){const input=fixture();if(change==='origin')input.collections.sales=[];if(change==='alias')input.collections.payments[0].customerId='foreign';if(change==='marker')input.collections.processedOperations[0].businessId='foreign';assert.throws(()=>History.project(input,'2026-11-07'));}
});
