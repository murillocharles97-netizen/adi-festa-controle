// Marca do produto e regra POR EMPRESA "Exigir marca no cadastro" (dados fictícios).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = (file) => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');

// rule: true/false = estado recebido da empresa; undefined = ainda desconhecido.
function harness({ rule, perms = null, onLine = true, server = {}, queue = [] } = {}) {
  const config = rule === undefined ? {} : { productRules: { brandRequired: rule, updatedAt: '2026-01-01T00:00:00.000Z' } };
  const data = { produtos: [], movimentacoesEstoque: [], variacoesProdutos: [], config };
  const store = new Map(), calls = [], retries = [];
  const ctx = {
    console, structuredClone, Date, Math, JSON, Object, Array, String, Number, Boolean, Error, Set, Map, Promise,
    navigator: { onLine },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)) },
    DB: { carregar: () => data, alterar: (fn) => { const draft = structuredClone(data); fn(draft); Object.assign(data, draft); }, getWorkspaceGeneration: () => 0 },
    BusinessContext: { get: () => ({ businessId: 'empresa-a' }) },
    AdiFestaBuild: { release: 242 },
    Utils: { uuid: (() => { let n = 0; return () => `id-${++n}`; })(), toast() {} },
    TeamAccess: { has: (p) => (perms ? perms.includes(p) : true) },
    SpaceContext: { list: () => [{ id: 'loja' }, { id: 'feira' }], activeId: () => 'loja' },
    SyncFirebase: { brandRecoveryCandidates: () => structuredClone(queue), processSyncQueue: async (o) => { retries.push(o); return {}; } },
    FirebaseCallable: async (name, payload) => {
      calls.push({ name, payload: structuredClone(payload) });
      if (server.error) throw server.error;
      if (payload.kind === 'product_rules') {
        if (Object.hasOwn(payload, 'brandRequired')) server.rule = payload.brandRequired;
        return { data: server.reply || { version: 1, confirmed: true, businessId: 'empresa-a', workspaceGeneration: 0, brandRequired: server.rule ?? false, updatedAt: '2026-02-01T00:00:00.000Z' } };
      }
      return { data: { replayed: false, operationId: payload.item?.operationId } };
    },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('functions/src/shared/product-model.js'), ctx);
  vm.runInContext(read('js/product-brand.js'), ctx);
  vm.runInContext(read('js/produtos.js'), ctx);
  return { ctx, data, calls, retries, server, Brand: ctx.ProductBrand, Produtos: ctx.Produtos };
}
const novo = (extra = {}) => ({ nome: 'Copo térmico', preco: 20, categoria: 'Utilidades', ...extra });
const inSpace = (id) => ({ spaceAccessMode: 'single_space', allowedSpaceIds: [id], defaultSpaceId: id });

test('regra desligada e conhecida: marca opcional e cadastro idêntico ao modelo compartilhado', () => {
  const h = harness({ rule: false });
  assert.deepEqual([h.Brand.state().status, h.Brand.state().required], ['synced', false]);
  const saved = h.Produtos.salvar(novo());
  assert.equal(Object.hasOwn(saved, 'marca'), false, 'marca vazia não é gravada');
  assert.equal(saved.nome, 'Copo térmico');
});

test('P2: regra desconhecida NÃO é tratada como desligada; pede a marca com mensagem própria', () => {
  const h = harness();
  assert.deepEqual([h.Brand.state().status, h.Brand.state().required], ['unknown', null]);
  assert.throws(() => h.Produtos.salvar(novo()), (e) => e.code === 'brand-rule-unknown' && /confirmar/.test(e.message));
  assert.equal(h.Produtos.salvar(novo({ marca: 'Acme' })).marca, 'Acme');
  assert.match(h.Brand.field({}, { isNew: true }), / required/);
  assert.equal(h.Brand.summary(), 'Regra de marca não confirmada');
});

test('marca é atributo próprio, normalizado, nunca misturado ao nome', () => {
  const saved = harness({ rule: false }).Produtos.salvar(novo({ marca: '  Acme   Utilidades ' }));
  assert.equal(saved.marca, 'Acme Utilidades');
  assert.equal(saved.nome, 'Copo térmico');
});

test('empresa com a regra: produto novo sem marca é recusado em TODOS os espaços; com marca salva', () => {
  const h = harness({ rule: true });
  for (const space of ['loja', 'feira']) assert.throws(() => h.Produtos.salvar(novo(inSpace(space))), (e) => e.code === 'brand-required' && /exige Marca/.test(e.message));
  assert.equal(h.data.produtos.length, 0);
  assert.equal(h.Produtos.salvar(novo({ ...inSpace('feira'), marca: 'Acme' })).marca, 'Acme');
});

test('serviços não exigem marca, mesmo com a regra ativa ou desconhecida', () => {
  for (const rule of [true, undefined]) {
    const h = harness({ rule });
    assert.equal(h.Brand.assertNew({ nome: 'Corrida do Táxi', itemKind: 'service' }), '');
    assert.doesNotMatch(h.Brand.field({ itemKind: 'service' }, { isNew: true }), / required/);
  }
});

test('outra empresa (outra configuração) não é afetada', () => {
  assert.throws(() => harness({ rule: true }).Produtos.salvar(novo()));
  assert.doesNotThrow(() => harness({ rule: false }).Produtos.salvar(novo()));
});

test('produto antigo sem marca continua editável; a marca pode ser incluída depois e não é apagada por omissão', () => {
  const h = harness({ rule: false });
  const antigo = h.Produtos.salvar(novo({ estoqueAtual: 5 }));
  h.data.config.productRules = { brandRequired: true, updatedAt: '2026-03-01T00:00:00.000Z' };
  const editado = h.Produtos.salvar({ ...antigo, preco: 25 });
  assert.equal(editado.preco, 25); assert.equal(editado.marca ?? '', ''); assert.equal(Number(editado.estoqueAtual), 5);
  assert.equal(h.Produtos.salvar({ ...editado, marca: 'Acme' }).marca, 'Acme');
  assert.equal(h.Produtos.salvar({ ...antigo, preco: 26, marca: undefined }).marca, 'Acme');
});

test('P2: alteração só conta depois da confirmação do servidor; nenhuma gravação local otimista', async () => {
  const h = harness({ rule: false });
  const out = await h.Brand.setRequired(true);
  assert.deepEqual([out.status, out.required], ['confirmed', true]);
  assert.equal(h.calls.at(-1).payload.kind, 'product_rules');
  assert.equal(h.calls.at(-1).payload.brandRequired, true);
  assert.equal(h.data.config.productRules.brandRequired, false, 'config local não é alterada pelo app');
  assert.equal(h.Brand.isRequired(), true, 'estado confirmado mais recente prevalece');
});

test('P2: offline, erro ou resposta não confirmada não anunciam sucesso nem mudam o estado', async () => {
  const off = harness({ rule: false, onLine: false });
  await assert.rejects(off.Brand.setRequired(true), (e) => e.code === 'offline');
  assert.equal(off.calls.length, 0); assert.equal(off.Brand.isRequired(), false);
  const err = harness({ rule: false, server: { error: Object.assign(Error('Sem permissão'), { code: 'permission-denied' }) } });
  await assert.rejects(err.Brand.setRequired(true)); assert.equal(err.Brand.isRequired(), false);
  const bad = harness({ rule: false, server: { reply: { version: 1, confirmed: true, businessId: 'outra', brandRequired: true } } });
  await assert.rejects(bad.Brand.setRequired(true), (e) => e.code === 'brand-rule-unconfirmed'); assert.equal(bad.Brand.isRequired(), false);
  const viewer = harness({ rule: false, perms: ['products.edit'] });
  await assert.rejects(viewer.Brand.setRequired(true)); assert.equal(viewer.calls.length, 0);
});

test('P2: confirmação do servidor resolve o estado desconhecido e fica guardada para uso offline', async () => {
  const h = harness();
  const st = await h.Brand.refresh({ force: true });
  assert.deepEqual([st.status, st.required], ['confirmed', false]);
  h.ctx.navigator.onLine = false;
  assert.doesNotThrow(() => h.Produtos.salvar(novo()), 'desligada confirmada: cadastro offline segue');
  assert.equal((await h.Brand.refresh({ force: true })).required, false, 'offline mantém a última confirmação');
});

test('campo do formulário: obrigatório só em cadastro novo e acompanha a regra e o tipo de item com o formulário aberto', async () => {
  const h = harness({ rule: false });
  assert.doesNotMatch(h.Brand.field({}, { isNew: true }), / required/);
  assert.match(h.Brand.field({}, { isNew: true }), /data-brand-new/);
  assert.doesNotMatch(h.Brand.field({ id: 'p1' }), /data-brand-new| required/, 'edição nunca exige');
  assert.match(h.Brand.field({ marca: '<b>' }), /value="&lt;b&gt;"/);
  const star = { textContent: '' }, form = { elements: { itemKind: { value: 'product' } } };
  const input = { required: false, form, closest: () => ({ querySelector: () => star }) };
  const root = { querySelectorAll: (sel) => (sel === 'input[name=marca][data-brand-new]' ? [input] : []) };
  await h.Brand.setRequired(true); h.Brand.refreshFields(root);
  assert.equal(input.required, true); assert.equal(star.textContent, ' *');
  form.elements.itemKind.value = 'service'; h.Brand.refreshFields(root);
  assert.equal(input.required, false, 'serviço não exige');
  form.elements.itemKind.value = 'product'; await h.Brand.setRequired(false); h.Brand.refreshFields(root);
  assert.equal(input.required, false); assert.equal(star.textContent, '');
});

test('planilha sem coluna Marca: com a regra, só linhas de criação ficam bloqueadas; atualizações seguem', () => {
  const preview = { rows: [{ line: 2, status: 'update', errors: [] }, { line: 3, status: 'create', errors: [] }], counts: { creates: 1, updates: 1, invalid: 0, errors: 0 } };
  assert.equal(harness({ rule: false }).Brand.applySpreadsheetRule(preview), preview);
  const out = harness({ rule: true }).Brand.applySpreadsheetRule(preview);
  assert.deepEqual(out.rows.map((r) => r.status), ['update', 'invalid']);
  assert.match(out.rows[1].errors[0], /exige Marca/);
  assert.deepEqual([out.counts.creates, out.counts.updates, out.counts.invalid], [0, 1, 1]);
  assert.match(harness().Brand.applySpreadsheetRule(preview).rows[1].errors[0], /confirmar/, 'desconhecida também bloqueia');
});

test('P1 recuperação offline: envia a MESMA operação ao servidor com a marca, depois só o reenvio manual reconhece o recibo', async () => {
  const original = { operationId: 'op-offline', businessId: 'empresa-a', userId: 'u1', status: 'error', lastErrorCode: 'failed-precondition', lastErrorMessage: 'Esta empresa exige Marca…',
    payload: { writes: [{ entityType: 'products', entityId: 'p1', operation: 'create', data: { nome: 'Copo' } }, { entityType: 'products', entityId: 's1', operation: 'create', data: { nome: 'Corrida', itemKind: 'service' } }] } };
  const h = harness({ rule: true, queue: [original] });
  const [entry] = h.Brand.recoveryCandidates();
  assert.deepEqual(entry.products.map((p) => p.id), ['p1'], 'serviço não precisa de marca');
  await assert.rejects(h.Brand.recoverOffline('op-offline', { p1: '  ' }), (e) => e.code === 'brand-required');
  assert.equal(h.calls.length, 0, 'nada enviado sem marca');
  const out = await h.Brand.recoverOffline('op-offline', { p1: ' Acme ' });
  const sent = h.calls.at(-1).payload;
  assert.deepEqual([sent.kind, sent.confirmed, sent.item.operationId, sent.brands], ['brand_recovery_apply', true, 'op-offline', { p1: 'Acme' }]);
  assert.deepEqual(sent.item.payload, original.payload, 'o original é enviado sem alteração; o servidor acrescenta a marca');
  assert.equal(JSON.stringify(h.retries), JSON.stringify([{ force: true, manualRetry: true }]));
  assert.equal(out.replayed, false);
  const offline = harness({ rule: true, queue: [original], onLine: false });
  await assert.rejects(offline.Brand.recoverOffline('op-offline', { p1: 'Acme' }), (e) => e.code === 'offline');
});

test('integração: formulários, assistente de variantes, configurações, planilha, fila somente leitura e pacote público', () => {
  assert.match(read('js/product-images.js'), /ProductBrand\?\.field\?\.\(\{ \.\.\.product, itemKind \}, \{ isNew: !existing \}\)/);
  assert.match(read('js/produtos-mobile.js'), /marca: window\.ProductBrand/);
  assert.match(read('js/produtos-mobile.js'), /draft\.step === 1\) window\.ProductBrand\?\.assertNew/);
  assert.match(read('js/product-variations.js'), /marca: window\.ProductBrand\.assertNew\(product\)/);
  assert.match(read('js/configuracoes-mobile.js'), /action: "product-rules"/);
  assert.match(read('js/product-spreadsheet-ui.js'), /ProductBrand\.applySpreadsheetRule\(preview\)/);
  assert.match(read('js/firebase/sync.js'), /brandRecoveryCandidates: \(\) => readQueue\(\)\.filter\([^]*?\.map\(item=>structuredClone\(item\)\)/);
  assert.doesNotMatch(read('js/product-brand.js'), /DB\.alterar/, 'a regra nunca é gravada localmente');
  const manifest = JSON.parse(read('public-site.manifest.json'));
  assert.ok(manifest.files.includes('js/product-brand.js'), 'arquivo no manifesto público');
  assert.match(read('service-worker.js'), /'\.\/js\/product-brand\.js'/);
  const html = read('index.html');
  assert.ok(html.indexOf('js/product-brand.js') > 0 && html.indexOf('js/product-brand.js') < html.indexOf('js/produtos.js?'), 'carregado antes de produtos.js');
});

test('servidor: regra depois do recibo, serviços isentos, Rules com a mesma regra', () => {
  const server = read('functions/src/services/operational-commit-service.js');
  const receipt = server.indexOf("if(prior.exists){"), brand = server.indexOf("productRules?.brandRequired===true");
  assert.ok(receipt > 0 && brand > receipt, 'recibo consultado antes da regra');
  assert.match(server, /col==='products'&&!before&&\(patch\.itemKind\?\?'product'\)!=='service'&&!String\(patch\.marca\?\?''\)\.trim\(\)/);
  assert.ok(server.indexOf('if(brandRecovery){if(!c.has') > receipt, 'recuperação aplica a marca só depois do recibo');
  const sheet = read('functions/src/services/product-spreadsheet-service.js');
  assert.ok(sheet.indexOf('markers[index]?.exists') < sheet.indexOf('if (brandRequired)'), 'planilha: recibo antes da regra');
  const rules = read('firestore.rules');
  assert.match(rules, /&& satisfiesCompanyBrandRule\(businessId, request\.resource\.data\);/);
});
