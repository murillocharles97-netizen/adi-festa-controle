'use strict';
// Falso aviso de integridade: produto legado normalizado (controlaEstoque:false +
// semControleEstoque:true) × documento remoto antigo (só controlaEstoque:false).
// The comparison must accept PROVEN equivalence and keep every real difference.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const audit = require('../js/integrity.js');
const ProductModel = require('../functions/src/shared/product-model.js');
const base = { id: 'p1', businessId: 'b1', nome: 'Legado', preco: 10, estoqueAtual: 3, estoque: 3, ativo: true };
const compare = (local, remote) => audit.compare('products', { ...base, ...local }, { ...base, ...remote }, { businessId: 'b1' });

test('legado: só controlaEstoque:false na nuvem equivale ao local normalizado', () => {
  const r = compare({ controlaEstoque: false, semControleEstoque: true }, { controlaEstoque: false });
  assert.equal(r.equal, true, r.fields.join(','));
});

test('outras grafias equivalentes pela regra compartilhada', () => {
  for (const [local, remote] of [
    [{ controlaEstoque: true, semControleEstoque: false }, { semControleEstoque: false }],
    [{ controlaEstoque: false, semControleEstoque: true }, { semControleEstoque: true }],
    [{ controlaEstoque: true, semControleEstoque: false }, { controlaEstoque: true }],
  ]) assert.equal(compare(local, remote).equal, true, JSON.stringify([local, remote]));
});

test('diferença real de controle continua aparecendo', () => {
  const r = compare({ controlaEstoque: true, semControleEstoque: false }, { controlaEstoque: false });
  assert.equal(r.equal, false);
  assert.deepEqual(r.fields, ['controlaEstoque']);
  assert.equal(compare({ controlaEstoque: false, semControleEstoque: true }, { semControleEstoque: false }).equal, false);
});

test('diferença real de estoque continua aparecendo, com ou sem controle', () => {
  for (const control of [{ controlaEstoque: false }, { controlaEstoque: true }]) {
    const r = compare({ ...control, semControleEstoque: !control.controlaEstoque, estoqueAtual: 2, estoque: 2 }, control);
    assert.equal(r.equal, false);
    assert.ok(r.fields.includes('estoqueAtual'), r.fields.join(','));
  }
});

test('a equivalência segue exatamente o ProductModel (o mesmo do app e do servidor)', () => {
  const shapes = [{}, { controlaEstoque: true }, { controlaEstoque: false }, { semControleEstoque: true }, { semControleEstoque: false },
    { controlaEstoque: false, semControleEstoque: false }, { controlaEstoque: true, semControleEstoque: true },
    { itemKind: 'service', controlaEstoque: true }, { productType: 'recurring', controlaEstoque: true }, { productType: 'recurring', semControleEstoque: true }];
  for (const a of shapes) for (const b of shapes) {
    const ma = ProductModel.build({ ...base, ...a }), mb = ProductModel.build({ ...base, ...b });
    const fields = compare(a, b).fields.filter((f) => ['controlaEstoque', 'semControleEstoque'].includes(f));
    const hasRaw = (x) => x.controlaEstoque !== undefined || x.semControleEstoque !== undefined;
    if (hasRaw(a) && hasRaw(b)) assert.equal(fields.length === 0, ma.controlaEstoque === mb.controlaEstoque, JSON.stringify([a, b]));
  }
});

test('sem o modelo compartilhado, a comparação continua conservadora (campos crus)', () => {
  const source = fs.readFileSync('js/integrity.js', 'utf8');
  const context = { structuredClone, console }; context.globalThis = context; context.window = undefined;
  vm.createContext(context);
  vm.runInContext(source.replace("typeof require==='function'", 'false'), context);
  const r = context.IntegrityAudit.compare('products', { ...base, controlaEstoque: false, semControleEstoque: true }, { ...base, controlaEstoque: false }, {});
  assert.equal(r.equal, false);
  assert.equal(JSON.stringify(r.fields), JSON.stringify(['semControleEstoque']));
});

test('nenhuma correção de documento: a auditoria só compara', () => {
  const remote = { ...base, controlaEstoque: false }, snapshot = JSON.stringify(remote);
  compare({ controlaEstoque: false, semControleEstoque: true }, remote);
  assert.equal(JSON.stringify(remote), snapshot);
});
