'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {automationFor,paymentMethod,cents,iso,entryIdentity}=require('../src/services/financial-income-service');

test('automação exige vínculo explícito ou marco legado',()=>{
  assert.equal(automationFor({type:'personal'}).enabled,false);
  assert.equal(automationFor({type:'business',autoEntryFromSalesSince:'2026-09-01T00:00:00.000Z'}).enabled,true);
  assert.equal(automationFor({automation:{enabled:false},autoEntryFromSalesSince:'2026-09-01T00:00:00.000Z'}).enabled,false);
});

test('normaliza valores, datas, métodos e identidade idempotente',()=>{
  assert.equal(cents(63.5),6350);
  assert.equal(paymentMethod('PIX · recebido'), 'pix');
  assert.equal(paymentMethod('Cartão de débito'), 'debit_card');
  assert.equal(iso('2026-09-07T12:00:00.000Z'),'2026-09-07T12:00:00.000Z');
  assert.equal(entryIdentity('business_a','customer_payment','pay-1'),'business_a:customer_payment:pay-1');
});
