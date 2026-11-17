'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {cycle,project,summarize,dueDate}=require('../functions/src/services/fiado-conditions-service');
const policy={mode:'monthly',limitCents:17000,promise:{date:'2028-02-28',amountCents:7000,status:'pending'}};
test('aplica prazos civis e limita o vencimento mensal ao último dia do mês',()=>{
 assert.equal(dueDate('2026-01-31',{mode:'monthly'}),'2026-02-28');
 assert.equal(dueDate('2028-01-31',policy),'2028-02-29');
 assert.equal(dueDate('2028-02-23',{mode:'weekly'}),'2028-03-01');
 assert.equal(dueDate('2028-02-23',{mode:'fortnight'}),'2028-03-09');
 assert.equal(dueDate('2028-02-28',{mode:'custom',days:3}),'2028-03-02');
 assert.equal(dueDate('2028-02-28',{mode:'none'}),null);
});
test('compras acumulam, parcial mantém vencimento, quitação reinicia o ciclo',()=>{
 const first=[{id:'v1',day:'2028-01-31',debtDelta:10000},{id:'v2',day:'2028-03-03',debtDelta:5000}];
 const opened=cycle({},first);
 assert.equal(summarize(policy,opened,'2028-03-03').overdueDays,3);
 const partial=cycle(opened,[{id:'p1',day:'2028-03-04',debtDelta:-7000}]);
 const fixed={...policy,cycleId:opened.cycleId,dueDate:'2028-03-15'};
 const summary=summarize(fixed,partial,'2028-03-04');
 assert.equal(summary.usedCents,8000);
 assert.equal(summary.availableCents,9000);
 assert.equal(summary.percent,47);
 assert.equal(summary.dueDate,'2028-03-15');
 assert.equal(summary.promise.state,'missed');
 const settled=cycle(partial,[{id:'p2',day:'2028-03-05',debtDelta:-8000}]);
 assert.equal(summarize(fixed,settled,'2028-03-05').dueDate,null);
 const next=cycle(settled,[{id:'v3',day:'2028-03-07',debtDelta:2000}]);
 assert.equal(summarize(fixed,next,'2028-03-07').dueDate,'2028-04-07');
 assert.equal(summarize(fixed,null,'2028-03-07').confirmed,false);
});
test('projeção usa a cadeia comprovada e separa o mesmo cliente em dois espaços',()=>{
 const collections={sales:[],payments:[],balanceAdjustments:[],balanceEvents:[],processedOperations:[],paymentAllocations:[]};
 const client={id:'customer',businessId:'demo',workspaceGeneration:0,saldo:0,financialVersion:0};
 function apply(col,id,spaceId,before,after,sequence){
  const date=sequence<3?'2026-01-31':'2026-03-15', at=date+'T15:00:0'+sequence+'.000Z',sale=col==='sales',type=sale?'credit_sale':'payment_received';
  const scope={businessId:'demo',workspaceGeneration:0,spaceId,operationId:'op-'+id};
  collections[col].push({...scope,id,clienteId:client.id,data:at,financialAppliedAt:at,
   saldoAnterior:before,saldoAtual:after,...(sale?{valorFinal:before-after,formaPagamento:'fiado',status:'fiado'}:{valor:after-before})});
  collections.balanceEvents.push({...scope,id:type+':'+id,type,customerId:client.id,sourceCollection:col,sourceDocumentId:id,
   status:'applied',balanceDelta:after-before,appliedAt:at});
  collections.processedOperations.push({id:scope.operationId,businessId:'demo',workspaceGeneration:0,status:'processed',eventKind:sale?'sale':'payment'});
  client.saldo=after;client.financialVersion++;
 }
 apply('sales','sale-a','adi',0,-100,1);
 apply('sales','sale-b','adi',-100,-150,2);
 apply('sales','sale-c','cartao',-150,-430,3);
 apply('payments','pay-a','adi',-430,-360,4);
 const input={businessId:'demo',generation:0,complete:true,stable:true,collections,client};
 const a=project(input,'adi','2026-03-16'),b=project(input,'cartao','2026-03-16');
 assert.deepEqual(a,{cents:8000,openedOn:'2026-01-31',cycleId:'credit_sale:sale-a'});
 assert.deepEqual(b,{cents:28000,openedOn:'2026-03-15',cycleId:'credit_sale:sale-c'});
 apply('payments','pay-b','adi',-360,-280,5);
 assert.equal(project(input,'adi','2026-03-16').openedOn,null);
 assert.equal(project(input,'cartao','2026-03-16').cents,28000);
 collections.sales[2].financialSpaceId='outro';
 assert.throws(()=>project(input,'cartao','2026-03-16'),/Origem financeira divergente/);
});
