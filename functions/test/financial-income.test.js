'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {automationFor,paymentMethod,cents,signedCents,iso,entryIdentity,isTerminalPaymentSale,spaceRoutingIssue,onlineOrderId}=require('../src/services/financial-income-service');

test('roteamento exige origem explícita e capacidade Financeiro, sem destino global implícito',()=>{
  const source={businessId:'a',spaceId:'qa'},space={id:'qa',type:'business',businessId:'a',linkedBusinessId:'a',ownerUid:'owner',capabilities:{sales:true,finance:false}};
  assert.equal(spaceRoutingIssue('a',source,space),'finance-disabled');
  assert.equal(spaceRoutingIssue('a',{},space),'source-space-required');
  assert.equal(spaceRoutingIssue('a',{...source,spaceId:'all_spaces'},space),'source-space-required');
  assert.equal(spaceRoutingIssue('b',source,space),'source-business-mismatch');
  assert.equal(spaceRoutingIssue('a',source,{...space,linkedBusinessId:'b'}),'space-business-mismatch');
  assert.equal(spaceRoutingIssue('a',{...source,financialSpaceId:'global'},space),'source-space-conflict');
  assert.equal(spaceRoutingIssue('a',source,{...space,capabilities:{sales:true,finance:true}}),null);
  // Legacy schema is supported ONLY with an explicitly named, linked space.
  assert.equal(spaceRoutingIssue('a',source,{...space,capabilities:undefined}),null);
  assert.equal(spaceRoutingIssue('a',source,{...space,capabilities:{finance:false}}),'finance-disabled');
});

test('Loja Online V2 respeita autoIncome.onlineOrders como o fluxo histórico',()=>{
  assert.equal(onlineOrderId({onlineOrderId:'v2'}),'v2');
  assert.equal(onlineOrderId({operationId:'online-sale:v2'}),'v2');
  assert.equal(onlineOrderId({operationId:'catalog-order:old'}),'old');
  assert.equal(onlineOrderId({operationId:'manual-sale'}),null);
});

test('automação exige vínculo explícito ou marco legado',()=>{
  assert.equal(automationFor({type:'personal'}).enabled,false);
  assert.equal(automationFor({type:'business',autoEntryFromSalesSince:'2026-09-01T00:00:00.000Z'}).enabled,true);
  assert.equal(automationFor({automation:{enabled:false},autoEntryFromSalesSince:'2026-09-01T00:00:00.000Z'}).enabled,false);
});

test('cartão presencial permanece como recebível e não saldo bancário',()=>{
  assert.equal(isTerminalPaymentSale({formaPagamento:'cartao_presencial'}),true);
  assert.equal(isTerminalPaymentSale({paymentMetadata:{channel:'card_present'}}),true);
  assert.equal(isTerminalPaymentSale({formaPagamento:'pix'}),false);
});

test('normaliza valores, datas, métodos e identidade idempotente',()=>{
  assert.equal(cents(63.5),6350);
  assert.equal(signedCents(-63.5),-6350);
  assert.equal(paymentMethod('PIX · recebido'), 'pix');
  assert.equal(paymentMethod('Cartão de débito'), 'debit_card');
  assert.equal(iso('2026-09-07T12:00:00.000Z'),'2026-09-07T12:00:00.000Z');
  assert.equal(entryIdentity('business_a','customer_payment','pay-1'),'business_a:customer_payment:pay-1');
});
