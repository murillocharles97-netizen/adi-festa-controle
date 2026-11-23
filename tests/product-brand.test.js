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
  const store = new Map(), calls = [], retries = [], receipts = [], session = { uid: 'u1' };
  const ctx = {
    console, structuredClone, Date, Math, JSON, Object, Array, String, Number, Boolean, Error, Set, Map, Promise, Uint8Array, crypto: globalThis.crypto,
    navigator: { onLine },
    localStorage: { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) },
    DB: { carregar: () => data, alterar: (fn) => { const draft = structuredClone(data); fn(draft); Object.assign(data, draft); }, getWorkspaceGeneration: () => 0 },
    BusinessContext: { get: () => ({ businessId: 'empresa-a' }) },
    AdiFestaBuild: { release: 242 },
    Utils: { uuid: (() => { let n = 0; return () => `id-${++n}`; })(), toast() {} },
    TeamAccess: { has: (p) => (perms ? perms.includes(p) : true) },
    SpaceContext: { list: () => [{ id: 'loja' }, { id: 'feira' }], activeId: () => 'loja' },
    SyncFirebase: { brandRecoveryCandidates: () => structuredClone(queue.filter((i) => i.status === 'error' && /exige Marca/.test(i.lastErrorMessage || ''))),
      processSyncQueue: async (o) => { retries.push(o); return {}; },
      sessionUserId: () => session.uid,
      brandRecoveryResolved: () => (server.resolved || []).map((operationId) => ({ operationId })),
      // Simula sync.confirmBrandRecovery: consulta SÓ o recibo da operação pedida.
      confirmBrandRecovery: async (operationId) => {
        receipts.push(operationId);
        if (server.receiptError) throw server.receiptError;
        const item = queue.find((i) => i.operationId === operationId);
        if (!item) return { status: 'not_pending', operationId };
        if (!server.applied?.has(operationId)) return { status: 'pending', operationId };
        queue.splice(queue.indexOf(item), 1);
        return { status: 'applied', operationId, localPending: server.localPending || [] };
      } },
    FirebaseCallable: async (name, payload) => {
      calls.push({ name, payload: structuredClone(payload) });
      // Servidor simulado como o real: tentativa (attemptId) com recibo atômico; reenvio não regrava.
      const attempts = (server.attempts ||= new Set());
      const writeRule = () => {
        if (payload.attemptId && attempts.has(payload.attemptId)) return true;
        server.rule = payload.brandRequired; if (payload.attemptId) attempts.add(payload.attemptId); return false;
      };
      // server.plan: roteiro por chamada { apply, error, hold, reply, late (servidor conclui depois; resposta perdida) }
      const step = server.plan?.shift?.() || {};
      if (step.late) { step.late.then(() => { if (Object.hasOwn(payload, 'brandRequired')) writeRule(); }); throw step.error || Object.assign(Error('Resposta perdida'), { code: 'functions/deadline-exceeded' }); }
      if (step.hold) await step.hold;
      if (step.reply) return { data: typeof step.reply === 'function' ? step.reply() : step.reply };
      if (step.apply && Object.hasOwn(payload, 'brandRequired')) writeRule();
      if (step.apply && payload.kind === 'brand_recovery_apply') (server.applied ||= new Set()).add(payload.item.operationId);
      if (step.error) throw step.error;
      if (server.error) throw server.error;
      if (payload.kind === 'brand_recovery_apply') (server.applied ||= new Set()).add(payload.item.operationId);
      if (payload.kind === 'product_rules') {
        const write = Object.hasOwn(payload, 'brandRequired'), replayed = write ? writeRule() : false;
        const id = payload.attemptId ? { attemptId: payload.attemptId, attempt: attempts.has(payload.attemptId) ? 'applied' : 'absent', ...(replayed ? { replayed: true } : {}) } : {};
        return { data: server.reply || { version: 1, confirmed: true, businessId: 'empresa-a', workspaceGeneration: 0, brandRequired: server.rule ?? false, updatedAt: '2026-02-01T00:00:00.000Z', ...id } };
      }
      return { data: { replayed: false, operationId: payload.item?.operationId } };
    },
  };
  ctx.window = ctx; ctx.globalThis = ctx;
  vm.createContext(ctx);
  vm.runInContext(read('functions/src/shared/product-model.js'), ctx);
  vm.runInContext(read('js/product-brand.js'), ctx);
  vm.runInContext(read('js/produtos.js'), ctx);
  return { ctx, data, calls, retries, receipts, session, queue, store, server, Brand: ctx.ProductBrand, Produtos: ctx.Produtos };
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
  await assert.rejects(bad.Brand.setRequired(true), (e) => e.code === 'brand-rule-pending'); assert.equal(bad.Brand.isRequired(), false);
  assert.equal(bad.Brand.state().status, 'pending'); assert.equal(bad.Brand.mustAsk(), true, 'pendente nunca vira desligada');
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
  assert.equal(h.retries.length, 0, 'nenhuma sincronização global da fila');
  assert.deepEqual([out.status, out.replayed], ['applied', false]);
  assert.deepEqual(h.receipts, ['op-offline'], 'só o recibo desta operação foi consultado');
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
  assert.match(read('js/firebase/sync.js'), /brandRecoveryCandidates: \(\) => brandRecoveryQueue\(\)\.map\(item=>structuredClone\(item\)\)/);
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

// ---- V242.7: bloqueios finais (estado real da configuração e recuperação isolada) ----
const lost = (code = 'deadline-exceeded') => Object.assign(Error('Resposta perdida'), { code: `functions/${code}` });

test('P2 final: confirmação recebida normalmente fica "confirmada" sem reconciliação', async () => {
  const h = harness({ rule: false });
  const out = await h.Brand.setRequired(true);
  assert.deepEqual([out.status, out.required, out.reconciled], ['confirmed', true, false]);
  assert.equal(h.calls.length, 1);
});

test('P2 final: servidor grava e a resposta se perde → reconcilia pela leitura autorizada, sem presumir', async () => {
  const h = harness({ rule: false, server: { plan: [{ apply: true, error: lost() }] } });
  const out = await h.Brand.setRequired(true);
  assert.deepEqual([out.status, out.required, out.reconciled], ['confirmed', true, true], 'o estado vem do servidor, não da suposição');
  assert.deepEqual(h.calls.map((c) => [c.payload.kind, Object.hasOwn(c.payload, 'brandRequired')]), [['product_rules', true], ['product_rules', false]], 'a reconciliação é só leitura');
  assert.equal(h.Brand.isRequired(), true);
});

test('P2 final: falha de rede antes da gravação → a tentativa não aparece no servidor: pendente (nunca "não alterada"); reenvio da mesma tentativa conclui uma vez', async () => {
  const h = harness({ rule: false, server: { plan: [{ apply: false, error: lost('unavailable') }] } });
  await assert.rejects(h.Brand.setRequired(true), (e) => e.code === 'brand-rule-pending');
  assert.deepEqual([h.Brand.state().status, h.Brand.state().required, h.Brand.state().canResend], ['pending', null, true]);
  await assert.rejects(h.Brand.setRequired(false), (e) => e.code === 'brand-rule-pending', 'configuração travada: nova alteração recusada enquanto pendente');
  const out = await h.Brand.resendPending();
  assert.deepEqual([out.status, out.required, out.reconciled], ['confirmed', true, false]);
  const writes = h.calls.filter((c) => Object.hasOwn(c.payload, 'brandRequired'));
  assert.equal(writes.length, 2); assert.equal(writes[0].payload.attemptId, writes[1].payload.attemptId, 'mesma tentativa');
  assert.equal(h.server.attempts.size, 1, 'gravada uma única vez');
});

test('P2 final: resposta e reconciliação inconclusivas → "Confirmação pendente", nunca desligada, até o servidor responder', async () => {
  const h = harness({ rule: false, server: { plan: [{ apply: true, error: lost() }, { error: lost('unavailable') }] } });
  await assert.rejects(h.Brand.setRequired(true), (e) => e.code === 'brand-rule-pending' && /Confirmação pendente/.test(e.message));
  const st = h.Brand.state();
  assert.deepEqual([st.status, st.required, st.wanted], ['pending', null, true]);
  assert.equal(h.Brand.mustAsk(), true);
  assert.equal(h.Brand.summary(), 'Regra de marca não confirmada');
  assert.throws(() => h.Produtos.salvar(novo()), (e) => e.code === 'brand-rule-unknown', 'pendente pede a marca');
  assert.doesNotThrow(() => h.Produtos.salvar(novo({ itemKind: 'service', nome: 'Corrida do Táxi' })), 'serviço segue sem marca');
  const after = await h.Brand.refresh();
  assert.deepEqual([after.status, after.required], ['confirmed', true], 'a leitura autorizada resolve a pendência');
  assert.equal([...h.store.keys()].some((k) => k.includes(':pending:')), false, 'pendência removida após a confirmação');
});

test('P2 final: recusa explícita do servidor não vira pendência nem sucesso', async () => {
  for (const code of ['permission-denied', 'invalid-argument', 'unauthenticated']) {
    const h = harness({ rule: false, server: { plan: [{ error: lost(code) }] } });
    await assert.rejects(h.Brand.setRequired(true), (e) => e.definitive === true && /não foi alterada/.test(e.message));
    assert.equal(h.calls.length, 1, 'sem reconciliação');
    assert.equal(h.Brand.state().status, 'synced'); assert.equal(h.Brand.isRequired(), false);
  }
});

test('P2 final: sessão expirada não mantém o rótulo "confirmada"', async () => {
  const h = harness({ rule: true, server: { rule: true } });
  assert.equal((await h.Brand.refresh({ force: true })).status, 'confirmed');
  h.session.uid = null; // sessão do Firebase encerrada/expirada
  assert.equal(h.Brand.state().status, 'cached');
  assert.equal(h.Brand.isRequired(), true, 'a regra conhecida continua valendo');
  h.session.uid = 'u1';
  h.server.plan = [{ error: lost('unauthenticated') }];
  assert.equal((await h.Brand.refresh({ force: true })).status, 'cached', 'leitura recusada rebaixa a confirmação');
  const other = harness({ rule: true, server: { rule: true } });
  await other.Brand.refresh({ force: true });
  other.session.uid = 'outra-conta';
  assert.equal(other.Brand.state().status, 'cached', 'outra conta não herda a confirmação');
});

const blocked = (id, extra = {}) => ({ operationId: id, businessId: 'empresa-a', userId: 'u1', status: 'error', lastErrorCode: 'failed-precondition',
  lastErrorMessage: 'Esta empresa exige Marca…', payload: { writes: [{ entityType: 'products', entityId: `p-${id}`, operation: 'create', data: { nome: id } }] }, ...extra });

test('P1 final: recuperação com outras operações rejeitadas na fila → nenhuma outra é enviada ou alterada', async () => {
  const queue = [blocked('op-alvo'), blocked('op-outra-marca'),
    blocked('op-venda', { lastErrorMessage: 'Estoque insuficiente', payload: { writes: [{ entityType: 'sales', entityId: 's1', operation: 'create', data: {} }] } }),
    blocked('op-revisao', { status: 'review', lastErrorMessage: 'Recebimento em revisão' })];
  const before = JSON.stringify(queue.filter((i) => i.operationId !== 'op-alvo'));
  const h = harness({ rule: true, queue });
  const out = await h.Brand.recoverOffline('op-alvo', { 'p-op-alvo': 'Acme' });
  assert.equal(out.status, 'applied');
  assert.deepEqual(h.calls.map((c) => [c.payload.kind, c.payload.item?.operationId]), [['brand_recovery_apply', 'op-alvo']], 'um único envio, da operação escolhida');
  assert.deepEqual(h.receipts, ['op-alvo']);
  assert.equal(h.retries.length, 0, 'sem processamento geral da fila');
  assert.equal(JSON.stringify(h.queue), before, 'as demais operações continuam idênticas');
});

test('P1 final: resposta perdida, rede, recibo inacessível e retentativa da mesma recuperação', async () => {
  const item = blocked('op-x');
  const a = harness({ rule: true, queue: [structuredClone(item)], server: { plan: [{ apply: true, error: lost() }] } });
  assert.equal((await a.Brand.recoverOffline('op-x', { 'p-op-x': 'Acme' })).status, 'applied', 'aplicado + resposta perdida: o recibo confirma');
  const b = harness({ rule: true, queue: [structuredClone(item)], server: { plan: [{ apply: false, error: lost('unavailable') }] } });
  assert.equal((await b.Brand.recoverOffline('op-x', { 'p-op-x': 'Acme' })).status, 'pending', 'sem recibo: pendente, nunca sucesso presumido');
  assert.equal(JSON.stringify(b.queue), JSON.stringify([item]), 'original intacto');
  const c = harness({ rule: true, queue: [structuredClone(item)], server: { receiptError: lost('unavailable') } });
  assert.equal((await c.Brand.recoverOffline('op-x', { 'p-op-x': 'Acme' })).status, 'pending', 'recibo inacessível: pendente');
  assert.equal((await b.Brand.recoverOffline('op-x', { 'p-op-x': 'Acme' })).status, 'applied', 'retentativa reconhecida pelo recibo');
  const sent = b.calls.filter((x) => x.payload.kind === 'brand_recovery_apply');
  assert.equal(sent.length, 2);
  assert.equal(JSON.stringify(sent[0].payload.item), JSON.stringify(sent[1].payload.item), 'retentativa reenvia o mesmo original');
  await assert.rejects(b.Brand.recoverOffline('op-x', { 'p-op-x': 'Acme' }), /não está mais pendente/, 'depois de confirmada, nada é reenviado');
  assert.equal(b.retries.length + a.retries.length + c.retries.length, 0);
  const d = harness({ rule: true, queue: [structuredClone(item)], server: { plan: [{ error: lost('failed-precondition') }] } });
  await assert.rejects(d.Brand.recoverOffline('op-x', { 'p-op-x': 'Acme' }));
  assert.equal(d.receipts.length, 0, 'recusa explícita: sem sucesso nem consulta');
});

test('P1 final: sync.js confirma UMA operação pelo recibo e não processa a fila', () => {
  const src = read('js/firebase/sync.js');
  const fn = src.slice(src.indexOf('async function confirmBrandRecovery('), src.indexOf('async function archiveQuarantinedOperation('));
  assert.ok(fn.length > 100);
  assert.match(fn, /readQueuedOperationStatus\(item,\{held:true\}\)/, 'consulta somente o recibo desta operação');
  assert.match(fn, /if\(receipt\.status!=='applied'\|\|[^\n]*\)return\{status:'pending'/, 'sem recibo aplicado: pendente');
  assert.doesNotMatch(fn, /saveQueue\(/, 'o original não é descartado: fica preservado como ocorrência resolvida');
  assert.match(fn, /channel:'brand_recovery'/, 'registro rastreável');
  assert.doesNotMatch(fn, /processSyncQueue|commitQueueItem|'commitOperationalSync'/, 'nada é enviado');
  assert.doesNotMatch(read('js/product-brand.js'), /processSyncQueue/, 'a recuperação não sincroniza a fila');
});

test('P2 final: leitura antiga em andamento não reconcilia uma alteração com resposta perdida', async () => {
  let release;
  const hold = new Promise((r) => { release = r; });
  const stale = { version: 1, confirmed: true, businessId: 'empresa-a', workspaceGeneration: 0, brandRequired: false, updatedAt: '2026-01-15T00:00:00.000Z' };
  const h = harness({ rule: false, server: { plan: [{ hold, reply: stale }, { apply: true, error: lost() }] } });
  const old = h.Brand.refresh({ force: true }); // leitura iniciada ANTES da alteração
  const change = h.Brand.setRequired(true);
  await new Promise((r) => setTimeout(r, 0));
  release();
  const [oldState, out] = await Promise.all([old, change]);
  assert.equal(oldState.required, true, 'o valor antigo (desligada) da leitura anterior é descartado');
  assert.deepEqual([out.status, out.required, out.reconciled], ['confirmed', true, true], 'reconciliado por leitura nova, posterior à tentativa');
  assert.equal(h.calls.length, 3);
  assert.equal(h.Brand.isRequired(), true);
});

// ---- V242.7: três últimos bloqueios (gravação em andamento, consultas fora de ordem, retomada) ----
const gate = () => { let open; const p = new Promise((r) => { open = r; }); return { p, open }; };
const tick = () => new Promise((r) => setTimeout(r, 0));

test('B1: gravação lenta com resposta perdida → a consulta lê o valor ANTERIOR: continua pendente, sem sucesso nem falha', async () => {
  const server = gate();
  const h = harness({ rule: false, server: { rule: false, plan: [{ late: server.p }] } });
  await assert.rejects(h.Brand.setRequired(true), (e) => e.code === 'brand-rule-pending' && /Confirmação pendente/.test(e.message));
  const read = h.calls[1].payload;
  assert.equal(read.attemptId, h.calls[0].payload.attemptId, 'a reconciliação consulta a MESMA tentativa');
  assert.equal(h.server.rule, false, 'o servidor ainda informa o valor anterior');
  const st = h.Brand.state();
  assert.deepEqual([st.status, st.required], ['pending', null], 'valor anterior não prova falha: pendente');
  assert.equal(h.Brand.mustAsk(), true); assert.equal(h.Brand.isRequired(), false);
  assert.equal((await h.Brand.refresh({ force: true })).status, 'pending', 'nova consulta antes da conclusão continua pendente');
  server.open(); await tick(); // o servidor conclui a gravação
  const after = await h.Brand.refresh({ force: true });
  assert.deepEqual([after.status, after.required], ['confirmed', true], 'recibo da tentativa encerra a pendência');
  assert.equal(h.calls.filter((c) => Object.hasOwn(c.payload, 'brandRequired')).length, 1, 'nenhum reenvio automático');
});

test('B1: gravação concluída por outro aparelho depois NÃO encerra a pendência desta tentativa', async () => {
  const h = harness({ rule: false, server: { plan: [{ apply: false, error: lost('unavailable') }] } });
  await assert.rejects(h.Brand.setRequired(true));
  h.server.rule = true; // outra tentativa (outro aparelho) deixou o mesmo valor
  assert.equal((await h.Brand.refresh({ force: true })).status, 'pending', 'só o recibo desta tentativa confirma');
});

test('B2: consultas resolvidas fora de ordem nunca sobrescrevem um estado mais recente', async () => {
  const g1 = gate(), g2 = gate();
  const old = { version: 1, confirmed: true, businessId: 'empresa-a', workspaceGeneration: 0, brandRequired: false, updatedAt: '2026-01-01T00:00:00.000Z' };
  // 1) leitura antes da alteração (segura), 2) alteração confirmada, 3) leitura durante a alteração (segura)
  const h = harness({ rule: false, server: { plan: [{ hold: g1.p, reply: old }, { hold: g2.p }, { reply: old }] } });
  const before = h.Brand.refresh({ force: true });
  const change = h.Brand.setRequired(true);
  await tick();
  const during = h.Brand.refresh({ force: true }); // iniciada durante a gravação
  await tick();
  g2.open(); const out = await change; // alteração confirmada primeiro
  assert.deepEqual([out.status, out.required, out.reconciled], ['confirmed', true, false]);
  g1.open(); await Promise.all([before, during]); // respostas antigas chegam depois
  assert.deepEqual([h.Brand.state().status, h.Brand.isRequired()], ['confirmed', true], 'respostas antigas descartadas');
  // 4) duas leituras novas fora de ordem: a mais antiga chega por último e é descartada
  const g3 = gate();
  h.server.plan = [{ hold: g3.p, reply: old }];
  const slow = h.Brand.refresh({ force: true });
  h.ctx.BusinessContext.get = () => ({ businessId: 'empresa-b' });
  h.server.plan = [{ reply: { ...old, businessId: 'empresa-b', brandRequired: true } }];
  assert.equal((await h.Brand.refresh({ force: true })).required, true, 'empresa B confirmada');
  h.ctx.BusinessContext.get = () => ({ businessId: 'empresa-a' });
  g3.open(); await slow;
  assert.equal(h.Brand.isRequired(), true, 'resposta antiga da empresa A (desligada) não sobrescreve a confirmação mais recente');
});

test('B2: troca de conta durante a consulta descarta a resposta', async () => {
  const g = gate();
  const h = harness({ rule: undefined, server: { rule: true, plan: [{ hold: g.p }] } });
  const pending = h.Brand.refresh({ force: true });
  h.session.uid = 'outra-conta';
  g.open(); await pending;
  assert.deepEqual([h.Brand.state().status, h.Brand.state().required], ['unknown', null], 'nada confirmado para a outra conta');
});

test('B1/B2: sessão expirada durante a reconciliação → continua pendente, nunca "confirmada"', async () => {
  const g = gate();
  const h = harness({ rule: false, server: { plan: [{ apply: true, error: lost() }, { hold: g.p }] } });
  const change = h.Brand.setRequired(true);
  await tick(); await tick();
  h.session.uid = null; // sessão expirou enquanto a leitura de reconciliação estava em andamento
  g.open();
  await assert.rejects(change, (e) => e.code === 'brand-rule-pending');
  assert.equal(h.Brand.state().status, 'pending');
  const e2 = harness({ rule: false, server: { plan: [{ apply: true, error: lost() }, { error: lost('unauthenticated') }] } });
  await assert.rejects(e2.Brand.setRequired(true), (e) => e.code === 'brand-rule-pending');
  assert.equal(e2.Brand.state().status, 'pending', 'leitura recusada (sessão expirada) não confirma nem desfaz');
  const other = harness({ rule: false, server: { plan: [{ apply: false, error: lost('unavailable') }] } });
  await assert.rejects(other.Brand.setRequired(true));
  other.session.uid = 'outra-conta';
  assert.equal(other.Brand.state().canResend, false, 'outra conta não reenvia a tentativa de outra pessoa');
  await assert.rejects(other.Brand.resendPending(), (e) => e.code === 'brand-rule-pending');
});

test('V242.7 final: cadastro confirmado na nuvem com edição local pendente → mensagem distinta, sem anunciar atualização local', async () => {
  const src = read('js/product-brand.js');
  assert.match(src, /"Cadastro confirmado na nuvem\. Existe uma alteração pendente neste aparelho\."/);
  assert.match(src, /out\.localPending\?\.length \? LOCAL_PENDING : "Cadastro concluído neste aparelho/, 'retomada: não diz "concluído neste aparelho"');
  assert.match(src, /out\.localPending\?\.length \? LOCAL_PENDING : out\.replayed/, 'recuperação: não diz "concluído"');
  for (const resolved of [['op-alvo'], []]) {
    const queue = [blocked('op-alvo'), blocked('op-outra')];
    const h = harness({ rule: true, queue, server: { resolved, applied: new Set(['op-alvo']), localPending: ['p-op-alvo'] } });
    const out = await h.Brand.recoverOffline('op-alvo', { 'p-op-alvo': 'Marca Fictícia' });
    assert.deepEqual([out.status, out.localPending], ['applied', ['p-op-alvo']]);
    assert.equal(h.retries.length, 0, 'sem sincronização geral');
    assert.equal(h.calls.length, resolved.length ? 0 : 1, 'retomada não envia; recuperação envia só esta operação');
    assert.deepEqual(h.receipts, ['op-alvo']);
  }
});

test('B3: recuperação já confirmada e interrompida → retoma só esta operação, sem envio', async () => {
  const queue = [blocked('op-alvo'), blocked('op-outra')];
  const h = harness({ rule: true, queue, server: { resolved: ['op-alvo'], applied: new Set(['op-alvo']) } });
  const before = JSON.stringify(queue);
  const out = await h.Brand.recoverOffline('op-alvo', {});
  assert.deepEqual([out.status, out.resumed], ['applied', true]);
  assert.equal(h.calls.length, 0, 'nenhum envio ao servidor');
  assert.deepEqual(h.receipts, ['op-alvo'], 'confere só esta operação');
  assert.equal(h.retries.length, 0);
  assert.equal(JSON.stringify(queue.filter((i) => i.operationId !== 'op-alvo')), JSON.stringify(JSON.parse(before).filter((i) => i.operationId !== 'op-alvo')));
});
