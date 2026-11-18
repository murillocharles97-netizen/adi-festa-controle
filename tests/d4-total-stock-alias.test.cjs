'use strict';
// D4 — totalStock é só um alias de estoqueAtual em produto sem variações.
// Depois de uma venda, o alias local ficava antigo (ex.: estoqueAtual 9, totalStock 10)
// e a auditoria mostrava divergência de estoque.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs');
const { harness } = require('./helpers/fiado-cancellation-harness.cjs');

test('venda e desfazer mantêm totalStock = estoqueAtual e o pacote envia o alias aceito pelo servidor', () => {
  const h = harness({ businessId: 'qa-d4', spaceId: 'qa-space', uid: 'qa-owner' });
  const { sale, packet } = h.sell({ status: 'pago', formaPagamento: 'dinheiro' });
  let product = h.data().produtos.find((p) => p.id === 'qa-product');
  assert.equal(product.estoqueAtual, 2);
  assert.equal(product.totalStock, 2, 'alias atualizado junto');
  const write = packet.payload.writes.find((w) => w.entityType === 'products');
  // Server rule (published 00019 and repository): an alias equal to the new estoqueAtual is accepted.
  assert.equal(write.data.totalStock, write.data.estoqueAtual);
  h.undo(sale.id);
  product = h.data().produtos.find((p) => p.id === 'qa-product');
  assert.equal(product.estoqueAtual, 3); assert.equal(product.totalStock, 3);
});

test('produto sem alias não ganha campo novo; regra do servidor aceita o alias igual ao estoque novo', () => {
  const h = harness({ businessId: 'qa-d4b', spaceId: 'qa-space', uid: 'qa-owner' });
  h.replace({ ...h.data(), produtos: h.data().produtos.map(({ totalStock, ...p }) => p) });
  const { packet } = h.sell({ status: 'pago', formaPagamento: 'dinheiro' });
  assert.equal(Object.hasOwn(h.data().produtos[0], 'totalStock'), false);
  assert.equal(packet.payload.writes.find((w) => w.entityType === 'products').data.totalStock, undefined);
  const server = fs.readFileSync('functions/src/services/operational-commit-service.js', 'utf8');
  assert.ok(server.includes('const original=writes.find(w=>w.entityType===col&&w.entityId===id)'));
  assert.match(server,/if\(!numeric\(declared\)\|\|!same\(declared,unchanged\)&&!same\(declared,localEnd\)\)\s*fail\('Alias de estoque divergente\.'\)/);
});

test('normalização local: alias derivado em produto simples, preservado em produto com variações', () => {
  const line = fs.readFileSync('js/storage.js', 'utf8').split(/\r?\n/).find((l) => l.includes('totalStock:'));
  assert.match(line, /totalStock:productType==='variable'\|\|p\.hasVariations===true\?numero\(p\.totalStock\?\?estoqueAtual\):estoqueAtual,/);
  for (const [file, n] of [['js/vendas.js', 2], ['js/produtos.js', 2], ['js/campaign-engine-v2.js', 1]])
    assert.equal((fs.readFileSync(file, 'utf8').match(/totalStock = |totalStock=novo/g) || []).length >= n, true, file);
});
