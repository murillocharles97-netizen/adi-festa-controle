'use strict';

const test=require('node:test');
const assert=require('node:assert/strict');
const {buildSaleFinancialSnapshot}=require('../src/services/sale-cost-service');

test('backend projeta custo e lucro da venda do seller sem expor metadados ao cliente',()=>{
  const result=buildSaleFinancialSnapshot({
    valorFinal:25,
    itens:[
      {produtoId:'p1',quantidade:2,precoFinalUnitario:10,subtotalFinal:20},
      {produtoId:'p2',variantId:'v2',quantidade:1,precoFinalUnitario:5,subtotalFinal:5},
    ],
  },new Map([['product:p1',{cost:3}],['variant:v2',{cost:2}]]));
  assert.equal(result.custoTotal,8);
  assert.equal(result.lucro,17);
  assert.equal(result.itemCosts[0].custoTotal,6);
  assert.equal(result.itemCosts[1].lucro,3);
  assert.equal(result.costResolution,'complete');
  assert.equal(result.missingCostItems,0);
});

test('projeção marca custo ausente sem confiar em campo financeiro enviado pelo seller',()=>{
  const result=buildSaleFinancialSnapshot({valorFinal:14,custoTotal:999,lucro:-985,itens:[{produtoId:'sem-custo',quantidade:1,subtotalFinal:14,custoUnitario:999}]},new Map());
  assert.equal(result.custoTotal,0);
  assert.equal(result.lucro,14);
  assert.equal(result.costResolution,'partial');
  assert.equal(result.missingCostItems,1);
});
