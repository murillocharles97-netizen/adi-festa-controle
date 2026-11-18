// Expected integration contract between V238 (flexible services) and the
// consolidated Desempenho. Sale fixtures mirror the V238 shape: items with
// `serviceExecution` {km, minutes, source} and an estimated cost whose basis is
// `estimate_not_cash_expense`. Once V238 lands, the last block also runs the
// real FlexibleService arithmetic.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const M=require('../js/performance-model');
const range=M.range('today',new Date('2026-11-18T15:00:00Z'));
const at='2026-11-18T14:00:00Z';
const ride=(id,{charge,cost,km=10,payment='pix',extra={}})=>({id,businessId:'biz',spaceId:'taxi',data:at,status:payment==='fiado'?'fiado':'pago',formaPagamento:payment,valorFinal:charge,
  ...(cost===undefined?{}:{custoTotal:cost,lucro:charge-cost}),
  itens:[{produtoId:'corrida',nome:'Corrida',itemKind:'service',quantidade:1,subtotalFinal:charge,categoryNameSnapshot:'Transporte',
    serviceExecution:{version:1,id:'exec-'+id+'-0001',configurationId:'cfg-corrida-01',km,minutes:0,source:'particular'},
    ...(cost===undefined?{}:{serviceCostEstimate:{version:1,estimatedCost:cost,basis:'estimate_not_cash_expense'}})}],...extra});
const build=(sales,extra={})=>M.build({sales,range,businessId:'biz',canCost:true,canProfit:true,spaces:[{id:'taxi',name:'Táxi e transportes'},{id:'doces',name:'Venda de doces'}],...extra});

test('V238 variable price: revenue is the final charged value, not the suggested price',()=>{
  const v=build([ride('r1',{charge:47.5,cost:12}),ride('r2',{charge:31.2,cost:8})]);
  assert.equal(v.current.revenue,78.7);assert.equal(v.current.count,2);
  assert.equal(v.products.length,1,'rides of the same service group under one product');
  assert.equal(v.products[0].quantity,2);assert.equal(v.categories[0].revenue,78.7);
});

test('V238 cost per km: estimated cost feeds estimated profit only, never received cash or expenses',()=>{
  const v=build([ride('r1',{charge:50,cost:15,km:25})],{payments:[]});
  assert.equal(v.current.cost,15);assert.equal(v.current.profit,35);assert.equal(v.current.margin,70);
  assert.equal(v.cash.current.total,50,'cost estimate does not reduce received cash');
  assert.ok(!('expenses' in v.current));
});

test('V238 service without cost snapshot is flagged, never filled from current config',()=>{
  const v=build([ride('r1',{charge:40})]);
  assert.equal(v.current.missingCost,1);assert.equal(v.comparison.profit,null);
});

test('V238 upfront vs on-credit rides: fiado counts in revenue now and in received only when paid',()=>{
  const sales=[ride('pix',{charge:60,cost:10}),ride('card',{charge:40,cost:8,payment:'cartao'}),ride('fiado',{charge:90,cost:20,payment:'fiado'}),
    ride('cred',{charge:120,cost:30,payment:'crediario',extra:{installmentPlan:{version:1,downPaymentCents:2000,count:3}}})];
  const payments=[{id:'pg1',businessId:'biz',spaceId:'taxi',tipo:'pagamento',valor:45,data:at},{id:'pg2',businessId:'biz',spaceId:'taxi',tipo:'pagamento',valor:20,installmentSaleId:'cred',data:at}];
  const v=build(sales,{payments});
  assert.equal(v.current.revenue,310);
  assert.deepEqual([v.cash.current.upfront,v.cash.current.credit,v.cash.current.total],[100,65,165]);
  assert.equal(v.payments.find(p=>p.key==='fiado').revenue,90);
});

test('V238 rides and sweets consolidate per space with contribution shares',()=>{
  const sweets={id:'d1',businessId:'biz',spaceId:'doces',data:at,status:'pago',formaPagamento:'pix',valorFinal:25,custoTotal:10,lucro:15,itens:[{produtoId:'brigadeiro',nome:'Brigadeiro',quantidade:5,subtotalFinal:25}]};
  const v=build([ride('r1',{charge:75,cost:20}),sweets]);
  assert.deepEqual(v.spaces.map(s=>[s.name,s.revenue,s.share]),[['Táxi e transportes',75,75],['Venda de doces',25,25]]);
  assert.equal(build([ride('r1',{charge:75,cost:20}),sweets],{spaceId:'doces'}).current.revenue,25);
});

test('V238 cancelled ride leaves revenue, cost and received',()=>{
  const v=build([ride('r1',{charge:50,cost:10,extra:{status:'cancelado'}})],{payments:[]});
  assert.equal(v.current.revenue,0);assert.equal(v.cash.current.total,0);
});

const shared=path.join(__dirname,'..','functions','src','shared','flexible-service.js');
test('after V238 integration: FlexibleService.estimate cost becomes the sale cost snapshot used by Desempenho',{skip:!fs.existsSync(shared)&&'V238 ainda não integrada'},()=>{
  const F=require(shared);
  const e={version:1,id:'exec-0000001',configurationId:'cfg-corrida-01',km:20,minutes:0,source:'aplicativo'};
  const est=F.estimate({model:'km',rate:0.9,feePercent:10},e,60,2);
  assert.equal(est.basis,'estimate_not_cash_expense');
  const v=build([ride('r1',{charge:60,cost:est.estimatedCost,km:20})]);
  assert.equal(v.current.cost,est.estimatedCost);assert.equal(v.current.profit,F.money(60-est.estimatedCost));
  assert.equal(F.metrics([ride('r1',{charge:60,cost:est.estimatedCost,km:20})]).km,20);
});
