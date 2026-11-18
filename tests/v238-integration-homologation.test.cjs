'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {sanitizeSale}=require(require('node:path').resolve(process.env.VECONI_TEST_PERFORMANCE_SOURCE||'functions','src/services/performance-read-service'));
const M=require('../js/performance-model'),S=require('../functions/src/shared/flexible-service');
const execution={version:1,id:crypto.randomUUID(),configurationId:'config-qa-integration',pricingSnapshot:{model:'sale',rate:0},km:10,minutes:0,source:'particular'};
const sale={businessId:'qa-company',spaceId:'qa-space',status:'pago',formaPagamento:'pix',data:'2026-11-18T15:00:00Z',valorFinal:30,itens:[{produtoId:'qa-service',quantidade:1,precoFinalUnitario:30,serviceExecution:execution,serviceCostSnapshot:{estimatedCost:15},custoUnitario:15}]};
test('getPerformancePage retains the same public service execution, revenue and authorized margin',()=>{
 const projected=sanitizeSale('sale-qa',sale,{custoTotal:15,lucro:15,costResolution:'complete'},{cost:true,profit:true});
 assert.deepEqual(projected.itens[0].serviceExecution,S.execution(execution));assert.equal(projected.custoTotal,15);assert.equal(projected.lucro,15);
 const result=M.build({sales:[projected],range:M.range('today',new Date(sale.data)),businessId:'qa-company',canCost:true,canProfit:true});
 assert.equal(result.current.services,1);assert.equal(result.current.serviceKm,10);assert.equal(result.current.profit,15);
});
test('service projection never exposes cost details or arbitrary fields to denied profiles',()=>{
 const tampered=structuredClone(sale);tampered.itens[0].serviceExecution.privateCost=99;tampered.itens[0].serviceExecution.customerPhone='not-a-real-phone';
 const projected=sanitizeSale('sale-qa',tampered,{custoTotal:15,lucro:15},{cost:false,profit:false});
 assert.equal(projected.custoTotal,undefined);assert.equal(projected.lucro,undefined);assert.equal(projected.itens[0].serviceCostSnapshot,undefined);assert.equal(projected.itens[0].custoUnitario,undefined);
 assert.equal(projected.itens[0].serviceExecution.privateCost,undefined);assert.equal(projected.itens[0].serviceExecution.customerPhone,undefined);
});
test('malformed optional execution never prevents reading the historical sale amount',()=>{
 const old=structuredClone(sale);old.itens[0].serviceExecution.km=-1;
 const projected=sanitizeSale('sale-qa',old,null,{cost:false,profit:false});assert.equal(projected.valorFinal,30);assert.equal(projected.itens[0].serviceExecution,undefined);
});
test('consolidated cash and service estimated margin stay separate; foreign company rows are excluded',()=>{
 const projected=sanitizeSale('sale-qa',sale,{custoTotal:15,lucro:15},{cost:true,profit:true});
 const result=M.build({sales:[projected,{...projected,id:'foreign',businessId:'other-company'}],payments:[],range:M.range('today',new Date(sale.data)),businessId:'qa-company',canCost:true,canProfit:true});
 assert.equal(result.current.revenue,30);assert.equal(result.cash.current.total,30);assert.equal(result.current.profit,15);assert.equal(result.current.services,1);
});
test('projected installment marker prevents upfront cash from being inferred from an installment sale',()=>{
 const projected=sanitizeSale('sale-installment',{...sale,installmentPlan:{version:1,count:3,privateField:'never public'}},null,{cost:false,profit:false});
 assert.deepEqual(projected.installmentPlan,{version:1});
 const result=M.build({sales:[projected],payments:[],range:M.range('today',new Date(sale.data)),businessId:'qa-company'});
 assert.equal(result.current.revenue,30);assert.equal(result.cash.current.upfront,0);
});
