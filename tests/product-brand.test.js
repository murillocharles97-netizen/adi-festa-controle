// Marca do produto e regra POR EMPRESA "Exigir marca no cadastro" (dados fictícios).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

function harness({ config = {}, perms = null, spaces = [{ id: 'loja' }, { id: 'feira' }] } = {}) {
  const data = { produtos: [], movimentacoesEstoque: [], variacoesProdutos: [], config: structuredClone(config) };
  const ctx = {
    console, structuredClone, Date, Math, JSON, Object, Array, String, Number, Boolean, Error, Set, Map, Promise,
    DB: { carregar: () => data, alterar: (fn) => { const draft = structuredClone(data); fn(draft); Object.assign(data, draft); } },
    Utils: { uuid: (() => { let n = 0; return () => `id-${++n}`; })(), toast() {} },
    TeamAccess: { has: (p) => (perms ? perms.includes(p) : true) },
    SpaceContext: { list: () => spaces, activeId: () => 'loja' },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('functions/src/shared/product-model.js'), ctx);
  vm.runInContext(read('js/product-brand.js'), ctx);
  vm.runInContext(read('js/produtos.js'), ctx);
  return { ctx, data, Brand: ctx.ProductBrand, Produtos: ctx.Produtos };
}
const novo = (extra = {}) => ({ nome: 'Copo térmico', preco: 20, categoria: 'Utilidades', ...extra });
const inSpace = (id) => ({ spaceAccessMode: 'single_space', allowedSpaceIds: [id], defaultSpaceId: id });

test('padrão: regra desligada, marca opcional e cadastro idêntico ao modelo compartilhado', () => {
  const h = harness();
  assert.equal(h.Brand.isRequired(), false);
  const saved = h.Produtos.salvar(novo());
  assert.equal(Object.hasOwn(saved, 'marca'), false, 'marca vazia não é gravada');
  assert.equal(saved.nome, 'Copo térmico');
});

test('marca é atributo próprio, normalizado, nunca misturado ao nome', () => {
  const saved = harness().Produtos.salvar(novo({ marca: '  Acme   Utilidades ' }));
  assert.equal(saved.marca, 'Acme Utilidades');
  assert.equal(saved.nome, 'Copo térmico');
});

test('empresa com a regra: produto novo sem marca é recusado em TODOS os espaços; com marca salva', () => {
  const h = harness();
  h.Brand.setRequired(true);
  assert.equal(h.data.config.productRules.brandRequired, true);
  for (const space of ['loja', 'feira']) assert.throws(() => h.Produtos.salvar(novo(inSpace(space))), (e) => e.code === 'brand-required' && /exige Marca/.test(e.message));
  assert.equal(h.data.produtos.length, 0);
  assert.equal(h.Produtos.salvar(novo({ ...inSpace('feira'), marca: 'Acme' })).marca, 'Acme');
});

test('outra empresa (outra configuração) não é afetada', () => {
  const a = harness({ config: { productRules: { brandRequired: true } } }), b = harness();
  assert.throws(() => a.Produtos.salvar(novo()));
  assert.doesNotThrow(() => b.Produtos.salvar(novo()));
});

test('produto antigo sem marca continua editável; a marca pode ser incluída depois e não é apagada por omissão', () => {
  const h = harness();
  const antigo = h.Produtos.salvar(novo({ estoqueAtual: 5 }));
  h.Brand.setRequired(true);
  const editado = h.Produtos.salvar({ ...antigo, preco: 25 });
  assert.equal(editado.preco, 25); assert.equal(editado.marca ?? '', ''); assert.equal(Number(editado.estoqueAtual), 5);
  assert.equal(h.Produtos.salvar({ ...editado, marca: 'Acme' }).marca, 'Acme');
  assert.equal(h.Produtos.salvar({ ...antigo, preco: 26, marca: undefined }).marca, 'Acme');
});

test('somente quem gerencia configurações altera a regra; a regra persiste em config', () => {
  const h = harness({ perms: ['products.edit'] });
  assert.throws(() => h.Brand.setRequired(true));
  assert.equal(h.data.config.productRules, undefined);
  assert.equal(harness({ config: { productRules: { brandRequired: true } } }).Brand.isRequired(), true);
});

test('campo do formulário: obrigatório só em cadastro novo e acompanha mudança da regra com o formulário aberto', () => {
  const h = harness();
  assert.doesNotMatch(h.Brand.field({}, { isNew: true }), / required/);
  assert.match(h.Brand.field({}, { isNew: true }), /data-brand-new/);
  assert.doesNotMatch(h.Brand.field({ id: 'p1' }), /data-brand-new| required/, 'edição nunca exige');
  assert.match(h.Brand.field({ marca: '<b>' }), /value="&lt;b&gt;"/);
  const star = { textContent: '' }, input = { required: false, closest: () => ({ querySelector: () => star }) };
  const root = { querySelectorAll: (sel) => (sel === 'input[name=marca][data-brand-new]' ? [input] : []) };
  h.Brand.setRequired(true); h.Brand.refreshFields(root);
  assert.equal(input.required, true); assert.equal(star.textContent, ' *');
  h.Brand.setRequired(false); h.Brand.refreshFields(root);
  assert.equal(input.required, false); assert.equal(star.textContent, '');
});

test('planilha sem coluna Marca: com a regra, só linhas de criação ficam bloqueadas; atualizações seguem', () => {
  const preview = { rows: [{ line: 2, status: 'update', errors: [] }, { line: 3, status: 'create', errors: [] }], counts: { creates: 1, updates: 1, invalid: 0, errors: 0 } };
  const off = harness(); assert.equal(off.Brand.applySpreadsheetRule(preview), preview);
  const on = harness({ config: { productRules: { brandRequired: true } } });
  const out = on.Brand.applySpreadsheetRule(preview);
  assert.deepEqual(out.rows.map((r) => r.status), ['update', 'invalid']);
  assert.match(out.rows[1].errors[0], /exige Marca/);
  assert.deepEqual([out.counts.creates, out.counts.updates, out.counts.invalid], [0, 1, 1]);
});

test('integração: formulários, assistente de variantes, configurações, planilha e pacote público', () => {
  assert.match(read('js/product-images.js'), /ProductBrand\?\.field\?\.\(product, \{ isNew: !existing \}\)/);
  assert.match(read('js/produtos-mobile.js'), /marca: window\.ProductBrand/);
  assert.match(read('js/produtos-mobile.js'), /draft\.step === 1\) window\.ProductBrand\?\.assertNew/);
  assert.match(read('js/product-variations.js'), /marca: window\.ProductBrand\.assertNew\(product\)/);
  assert.match(read('js/configuracoes-mobile.js'), /action: "product-rules"/);
  assert.match(read('js/product-spreadsheet-ui.js'), /ProductBrand\.applySpreadsheetRule\(preview\)/);
  const manifest = JSON.parse(read('public-site.manifest.json'));
  assert.ok(manifest.files.includes('js/product-brand.js'), 'arquivo no manifesto público');
  assert.match(read('service-worker.js'), /'\.\/js\/product-brand\.js'/);
  const html = read('index.html');
  assert.ok(html.indexOf('js/product-brand.js') > 0 && html.indexOf('js/product-brand.js') < html.indexOf('js/produtos.js?'), 'carregado antes de produtos.js');
});

test('servidor: regra por empresa depois da consulta ao recibo, sem mexer em venda/estoque', () => {
  const server = read('functions/src/services/operational-commit-service.js');
  const receipt = server.indexOf("if(prior.exists){"), brand = server.indexOf("productRules?.brandRequired===true");
  assert.ok(receipt > 0 && brand > receipt, 'recibo consultado antes da regra');
  assert.match(server, /col==='products'&&!before&&!String\(patch\.marca\?\?''\)\.trim\(\)/);
  const sheet = read('functions/src/services/product-spreadsheet-service.js');
  assert.ok(sheet.indexOf('markers[index]?.exists') < sheet.indexOf('if (brandRequired)'), 'planilha: recibo antes da regra');
});
