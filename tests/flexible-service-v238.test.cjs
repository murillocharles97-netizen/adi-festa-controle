'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const M=require('../functions/src/shared/flexible-service'),Product=require('../functions/src/shared/product-model');
const {buildSaleFinancialSnapshot}=require('../functions/src/services/sale-cost-service');
const {harness,bridge}=require('./helpers/fiado-cancellation-harness.cjs');
const config={version:1,id:'qa-config-0001',pricingModel:'km'},cost={model:'km',rate:.75,feePercent:10};
const run=(changes={})=>M.execution({version:1,id:crypto.randomUUID(),configurationId:config.id,km:12,minutes:30,source:'aplicativo',...changes});

test('four pricing modes and three cost models use minutes consistently and money in cents',()=>{
 const e=run();assert.equal(M.suggestedPrice(config,3,e),36);
 assert.equal(M.suggestedPrice({...config,pricingModel:'hour'},60,e),30);
 assert.equal(M.suggestedPrice({...config,pricingModel:'fixed'},22,e),22);
 assert.equal(M.suggestedPrice({...config,pricingModel:'sale'},0,e),null);
 assert.equal(M.estimate(cost,e,40,2).estimatedCost,15);
 assert.equal(M.estimate({model:'hour',rate:20,feePercent:0},e,40).estimatedCost,10);
 assert.equal(M.estimate({model:'fixed',rate:4,feePercent:5},e,40).estimatedCost,6);
});
test('rejects invalid money, distances, duration, fee and missing required measures',()=>{
 for(const value of [-1,NaN,Infinity,1000001])assert.throws(()=>M.estimate(cost,run(),value));
 assert.throws(()=>run({km:-1}));assert.throws(()=>M.costConfig({...cost,feePercent:101}));
 assert.throws(()=>M.assertUsage(config,cost,run({km:0})),/quilômetros/);
 assert.throws(()=>M.assertUsage({...config,pricingModel:'hour'},null,run({minutes:0})),/duração/);
});
test('catalog uses existing service kind, stock remains disabled, recurring and variants remain unchanged',()=>{
 const p=Product.build({nome:'Corrida QA',itemKind:'service',preco:3,custo:.75,estoqueAtual:5,serviceConfig:config,serviceCostConfig:cost});
 assert.equal(p.controlaEstoque,false);assert.equal(p.semControleEstoque,true);assert.equal(p.serviceConfig.id,config.id);assert.equal(p.serviceConfig.requiresKm,true);
 const repriced=Product.build({...p,preco:4},p);assert.notEqual(repriced.serviceConfig.id,p.serviceConfig.id);assert.equal(repriced.serviceCostConfig.rate,.75);
 const recosted=Product.build({...p,serviceCostConfig:undefined,custo:2},p);assert.notEqual(recosted.serviceConfig.id,p.serviceConfig.id);assert.equal(recosted.serviceCostConfig.rate,2);
 assert.equal(M.enabled(p),true);assert.equal(M.enabled({...p,productType:'recurring'}),false);assert.equal(M.enabled({...p,hasVariations:true}),false);
 const physical=Product.build({nome:'Peça',preco:7,estoqueAtual:5});assert.equal(physical.controlaEstoque,true);assert.equal(physical.serviceConfig,undefined);
 assert.throws(()=>Product.build({...p,itemKind:'product'},p),/Cadastre outro item/);
});
test('each run has its own cart identity; identical product does not merge two rides',()=>{
 const h=harness();vm.runInContext(fs.readFileSync('functions/src/shared/flexible-service.js','utf8'),h.c);
 const a={produtoId:'qa-product',serviceExecution:run()},b={produtoId:'qa-product',serviceExecution:run()};
 assert.notEqual(h.c.ProductVariations.itemKey(a),h.c.ProductVariations.itemKey(b));
 assert.equal(h.c.ProductVariations.itemKey({produtoId:'p',variantId:'v'}),'p::v');
});
test('offline sale freezes execution and estimated cost, changes no stock and no expenses',()=>{
 const h=harness();vm.runInContext(fs.readFileSync('functions/src/shared/flexible-service.js','utf8'),h.c);
 const p=h.data().produtos[0];Object.assign(p,{itemKind:'service',productType:'simple',controlaEstoque:false,serviceConfig:config,serviceCostConfig:cost});
 const e=run(),snapshot=M.estimate(cost,e,40,2),op=crypto.randomUUID();
 const sale=h.c.Vendas.registrar({id:crypto.randomUUID(),operationId:op,spaceId:'qa-space',status:'pago',formaPagamento:'pix',itens:[{produtoId:p.id,nome:p.nome,quantidade:1,precoOriginal:40,precoFinalUnitario:40,serviceExecution:e,serviceCostSnapshot:snapshot,custoUnitario:snapshot.estimatedCost}]});
 assert.equal(sale.valorFinal,40);assert.equal(sale.custoTotal,15);assert.equal(sale.lucro,25);assert.equal(sale.operationId,op);
 assert.deepEqual(bridge(sale.itens[0].serviceExecution),e);assert.equal(h.data().produtos[0].estoqueAtual,3);assert.equal(h.data().movimentacoesEstoque.length,0);assert.equal(h.data().pagamentos.length,0);
 p.preco=300;p.custo=100;cost.rate=.75;assert.equal(sale.itens[0].serviceCostSnapshot.estimatedCost,15);
 const restarted=JSON.parse(JSON.stringify(sale));assert.deepEqual(restarted.itens[0].serviceExecution,e);
 const size=h.data().vendas.length;h.c.Vendas.registrar({id:sale.id,operationId:op,spaceId:'qa-space',status:'pago',formaPagamento:'pix',itens:sale.itens});assert.equal(h.data().vendas.length,size);
});
test('server cost snapshot combines services and physical items without projecting cash expenses',()=>{
 const e=run(),snapshot=M.estimate(cost,e,40,2),sale={valorFinal:50,itens:[{produtoId:'ride',quantidade:1,precoFinalUnitario:40,serviceExecution:e},{produtoId:'bottle',quantidade:2,precoFinalUnitario:5}]};
 const result=buildSaleFinancialSnapshot(sale,new Map([[`service:${e.id}`,{cost:15,serviceCostSnapshot:snapshot}],['product:bottle',{cost:2}]]));
 assert.equal(result.custoTotal,19);assert.equal(result.lucro,31);assert.equal(result.costResolution,'complete');assert.equal(result.itemCosts[0].serviceCostSnapshot.basis,'estimate_not_cash_expense');
});
test('operational reader retains service measures and removes cost snapshots',()=>{
 const privacy=require('../functions/src/shared/operational-privacy-policy');
 const out=privacy.sanitize('sales',{itens:[{produtoId:'ride',serviceExecution:run(),serviceCostSnapshot:{estimatedCost:55},custoUnitario:55}]});
 assert.ok(out.itens[0].serviceExecution);assert.equal(out.itens[0].serviceCostSnapshot,undefined);assert.equal(out.itens[0].custoUnitario,undefined);
});
test('private projection hydration does not invent a sync divergence or hide a real cost difference',()=>{
 const audit=require('../js/integrity'),e=run(),snapshot=M.estimate(cost,e,40,2);
 const product={id:'p',nome:'Corrida',preco:3,itemKind:'service',serviceConfig:config,serviceCostConfig:cost,custo:.75};
 const remote={...product};delete remote.serviceCostConfig;delete remote.custo;
 const fin={custo:.75,serviceCostConfigs:{[config.id]:{...cost,pricingModel:'km'}}};
 assert.equal(audit.compare('products',product,remote,{remoteFinancial:fin}).equal,true);
 const sale={id:'sale',itens:[{produtoId:'p',quantidade:1,serviceExecution:e,serviceCostSnapshot:snapshot,custoUnitario:15,costSnapshot:15,custoTotal:15,lucro:25}]},other=structuredClone(sale);
 for(const k of ['serviceCostSnapshot','custoUnitario','costSnapshot','custoTotal','lucro'])delete other.itens[0][k];
 const financial={itemCosts:[{index:0,custoUnitario:15,custoTotal:15,lucro:25,serviceCostSnapshot:structuredClone(snapshot)}]};
 assert.equal(audit.compare('sales',sale,other,{remoteFinancial:financial}).equal,true);
 financial.itemCosts[0].serviceCostSnapshot.estimatedCost=99;
 assert.equal(audit.compare('sales',sale,other,{remoteFinancial:financial}).equal,false);
});
test('all spaces aggregates only the selected company and authorized spaces',()=>{
 const P=require('../js/performance-model'),now=new Date('2026-11-18T15:00:00Z'),range=P.range('today',now);
 const sale=(id,businessId,spaceId,km)=>({id,businessId,spaceId,data:now.toISOString(),status:'pago',formaPagamento:'pix',valorFinal:40,custoTotal:15,active:true,itens:[{produtoId:'ride',quantidade:1,precoFinalUnitario:40,serviceExecution:run({km})}]});
 const sales=[sale('a','tenant-a','space-a',12),sale('b','tenant-a','space-b',3),sale('c','tenant-b','space-c',99)];
 const all=P.build({sales,range,businessId:'tenant-a'});assert.equal(all.current.services,2);assert.equal(all.current.serviceKm,15);assert.equal(all.current.revenue,80);
 const limited=P.build({sales,range,businessId:'tenant-a',allowedSpaceIds:['space-a']});assert.equal(limited.current.services,1);assert.equal(limited.current.serviceKm,12);
});
