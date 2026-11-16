'use strict';
// Regression: products whose stock control was disabled only through the
// legacy flag `controlaEstoque: false` (without `semControleEstoque`) must open
// unchecked in the editor and must never be re-enabled by saving, changing the
// quantity or creating stock movements.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8');
const Model = require('../functions/src/shared/product-model.js');
const flags = (v) => ({ sem: v.semControleEstoque, ctl: v.controlaEstoque });

test('modelo canônico respeita controlaEstoque:false legado em edições parciais', () => {
  const legacy = { id: 'p1', nome: 'Legado', preco: 10, estoqueAtual: 3, controlaEstoque: false };
  assert.deepEqual(flags(Model.build({ nome: 'Legado 2', preco: 10 }, legacy)), { sem: true, ctl: false });
  assert.deepEqual(flags(Model.build({ nome: 'Legado 2', preco: 10, controlaEstoque: false }, legacy)), { sem: true, ctl: false });
  assert.deepEqual(flags(Model.build({ nome: 'Legado', productType: 'recurring' }, { ...legacy, productType: 'recurring' })), { sem: true, ctl: false });
});

test('modelo canônico mantém o comportamento de produtos atuais e da escolha explícita', () => {
  const current = { id: 'p2', nome: 'Atual', preco: 10, estoqueAtual: 5, semControleEstoque: false, controlaEstoque: true };
  assert.deepEqual(flags(Model.build({ nome: 'Atual', preco: 10 }, current)), { sem: false, ctl: true });
  assert.deepEqual(flags(Model.build({ nome: 'Novo', preco: 10 }, null)), { sem: false, ctl: true });
  // The editor checkbox (semControleEstoque) is the user's explicit choice and wins.
  assert.deepEqual(flags(Model.build({ nome: 'Legado', preco: 10, semControleEstoque: false }, { ...current, controlaEstoque: false })), { sem: false, ctl: true });
  assert.deepEqual(flags(Model.build({ nome: 'Atual', preco: 10, semControleEstoque: true }, current)), { sem: true, ctl: false });
  assert.deepEqual(flags(Model.build({ nome: 'Serviço', itemKind: 'service', semControleEstoque: false }, null)), { sem: true, ctl: false });
  assert.deepEqual(flags(Model.build({ nome: 'Rec', productType: 'recurring', controlaEstoque: 'on', semControleEstoque: false }, null)), { sem: false, ctl: true });
  assert.deepEqual(flags(Model.build({ nome: 'Rec', productType: 'recurring', semControleEstoque: true }, null)), { sem: true, ctl: false });
});

function editorWindow(products, { raw = false } = {}) {
  const dom = new JSDOM('<div id="modal"></div>', { runScripts: 'outside-only', url: 'https://app.test/' });
  const w = dom.window;
  w.structuredClone = structuredClone;
  w.Utils = { uuid: () => randomUUID(), toast: (message, error) => { if (error) w.toasts.push(message); } };
  w.toasts = [];
  w.Modais = { fechar() {} };
  w.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  w.lucide = { createIcons() {} };
  w.PhoneUtils = { normalizeBrazilianPhone: (value) => value };
  w.ProductModel = Model;
  if (raw) {
    // A raw legacy document reaching the editor without local normalization.
    w.saved = [];
    w.Produtos = { obter: (id) => products.find((p) => p.id === id), salvar: (d) => { w.saved.push(d); return d; } };
  } else {
    const key = 'adiFestaDB_v1:biz_legacy_stock';
    w.localStorage.setItem('adiFestaActiveBusinessId', 'biz_legacy_stock');
    w.localStorage.setItem(key, JSON.stringify({ versao: 14, config: {}, clientes: [], produtos: products, vendas: [], pagamentos: [], movimentacoes: [], movimentacoesEstoque: [] }));
    w.eval(read('js/storage.js'));
    require('./helpers/memory-business-cache.cjs')(w);
    w.eval(read('js/produtos.js'));
  }
  w.eval(read('js/product-images.js'));
  return w;
}
const checkbox = (w) => w.document.querySelector("[name='controlaEstoque']");
async function submit(w) {
  w.document.querySelector('#modal form').dispatchEvent(new w.Event('submit', { cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));
}

test('editor abre desmarcado e não reativa o controle de um documento legado cru', async () => {
  const legacy = { id: 'p1', nome: 'Legado', preco: 10, estoqueAtual: 3, controlaEstoque: false };
  const w = editorWindow([legacy], { raw: true });
  w.ProductImages.openForm('p1');
  assert.equal(checkbox(w).checked, false);
  await submit(w);
  assert.equal(w.saved.length, 1);
  assert.equal(w.saved[0].semControleEstoque, true);
  assert.equal('estoqueAtual' in w.saved[0], false);
  assert.deepEqual(flags(Model.build(w.saved[0], legacy)), { sem: true, ctl: false });
});

test('salvar produto legado pelo editor preserva quantidade, controle desativado e não cria movimentação', async () => {
  for (const legacy of [
    { id: 'p1', nome: 'Legado', preco: 10, estoqueAtual: 3, controlaEstoque: false },
    { id: 'p1', nome: 'Legado', preco: 10, estoqueAtual: 3, controlaEstoque: false, semControleEstoque: false },
    { id: 'p1', nome: 'Legado', preco: 10, estoqueAtual: 3, productType: 'recurring', controlaEstoque: false },
  ]) {
    const w = editorWindow([legacy]);
    w.ProductImages.openForm('p1', { productType: legacy.productType });
    assert.equal(checkbox(w).checked, false, JSON.stringify(legacy));
    await submit(w);
    assert.deepEqual(w.toasts, []);
    const data = w.DB.carregar(), saved = data.produtos[0];
    assert.deepEqual(flags(saved), { sem: true, ctl: false });
    assert.equal(saved.estoqueAtual, 3);
    assert.equal(data.movimentacoesEstoque.length, 0);
  }
});

test('produto atual continua controlado e o legado pode ser reativado só por escolha explícita', async () => {
  const current = { id: 'p2', nome: 'Atual', preco: 10, estoqueAtual: 5, semControleEstoque: false, controlaEstoque: true };
  let w = editorWindow([current]);
  w.ProductImages.openForm('p2');
  assert.equal(checkbox(w).checked, true);
  await submit(w);
  assert.deepEqual(flags(w.DB.carregar().produtos[0]), { sem: false, ctl: true });
  assert.equal(w.DB.carregar().produtos[0].estoqueAtual, 5);
  assert.equal(w.DB.carregar().movimentacoesEstoque.length, 0);

  w = editorWindow([{ id: 'p1', nome: 'Legado', preco: 10, estoqueAtual: 3, controlaEstoque: false }]);
  w.ProductImages.openForm('p1');
  checkbox(w).checked = true;
  checkbox(w).dispatchEvent(new w.Event('change'));
  await submit(w);
  assert.deepEqual(w.toasts, []);
  assert.deepEqual(flags(w.DB.carregar().produtos[0]), { sem: false, ctl: true });
  assert.equal(w.DB.carregar().produtos[0].estoqueAtual, 3);
  assert.equal(w.DB.carregar().movimentacoesEstoque.length, 0);
});

test('assistente de produto variável usa as duas marcas de controle de estoque', () => {
  assert.match(read('js/produtos-mobile.js'),
    /name="controlaEstoque" type="checkbox" \$\{draft\.product\.semControleEstoque \|\| draft\.product\.controlaEstoque === false \? "" : "checked"\}/);
});
