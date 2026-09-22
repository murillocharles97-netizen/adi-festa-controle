'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {eventIdFor,buildActivityEvent,activityEventService}=require('../src/services/activity-event-service');

const Timestamp={
  now:()=>({toMillis:()=>Date.parse('2026-09-22T20:00:00.000Z')}),
  fromDate:date=>({toMillis:()=>date.getTime(),toDate:()=>date}),
};
const FieldValue={serverTimestamp:()=>({serverTimestamp:true})};

test('IDs canônicos são determinísticos e a venda preserva escopo, operação e ator',()=>{
  const source={
    operationId:'operation-1',clienteId:'client-1',clienteNome:'Bruna Silva',
    valorFinal:25,formaPagamento:'fiado',spaceId:'store-1',createdByUid:'cashier-1',
    actorNameSnapshot:'Mariana',actorRoleSnapshot:'cashier',createdAt:'2026-09-22T19:15:00.957Z',
  };
  const event=buildActivityEvent({businessId:'adi-festa',sourceCollection:'sales',sourceDocumentId:'sale-1',data:source,Timestamp});
  assert.equal(eventIdFor('sales','sale-1'),'sale:sale-1');
  assert.equal(event.eventId,'sale:sale-1');
  assert.equal(event.type,'sale');
  assert.equal(event.operationId,'operation-1');
  assert.equal(event.spaceId,'store-1');
  assert.equal(event.actorUid,'cashier-1');
  assert.equal(event.actorNameSnapshot,'Mariana');
  assert.equal(event.summary.customerName,'Bruna Silva');
  assert.equal(event.summary.amount,25);
  assert.equal(event.createdAt.toMillis(),Date.parse(source.createdAt));
});

test('saída de estoque da própria venda não cria uma segunda ação',()=>{
  assert.equal(buildActivityEvent({businessId:'biz',sourceCollection:'stockMovements',sourceDocumentId:'stock-1',data:{tipo:'saida_venda'},Timestamp}),null);
});

test('reentrega do trigger grava por merge no mesmo documento',async()=>{
  const writes=[];
  const db={doc:path=>({set:async(value,options)=>writes.push({path,value,options})})};
  const service=activityEventService(db,{FieldValue,Timestamp});
  const snapshot={exists:true,data:()=>({operationId:'op-1',clienteId:'c1',valor:150,paymentMethod:'pix',createdAt:'2026-09-22T19:15:57.577Z'})};
  await service.project({businessId:'biz',sourceCollection:'payments',sourceDocumentId:'payment-1',after:snapshot});
  await service.project({businessId:'biz',sourceCollection:'payments',sourceDocumentId:'payment-1',after:snapshot});
  assert.equal(writes.length,2);
  assert.equal(writes[0].path,'businesses/biz/activityEvents/payment:payment-1');
  assert.equal(writes[1].path,writes[0].path);
  assert.deepEqual(writes[0].options,{merge:true});
});

test('remoção da origem preserva o evento auditável como source_deleted',()=>{
  const event=buildActivityEvent({businessId:'biz',sourceCollection:'balanceAdjustments',sourceDocumentId:'adjustment-1',data:{clienteId:'c1',saldoAnterior:-10,saldoNovo:-5,createdAt:'2026-09-22T19:00:00Z'},sourceDeleted:true,Timestamp});
  assert.equal(event.status,'source_deleted');
  assert.equal(event.sourceDeleted,true);
  assert.equal(event.summary.balanceAfter,-5);
});
