'use strict';
// Planilha de produtos — fluxos exigidos (3 Lindas Cosméticos, 16/11/2026):
// exportar → editar → reimportar sem duplicar; cadastro em massa; custos/preços;
// entrada em massa; SKU/EAN/variações; prévia; e nunca sobrescrever estoque vendido.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const M = require('../functions/src/shared/product-spreadsheet.js');
const X = require('../assets/xlsx-0.20.3.full.min.js');

const scope = { businessId: 'b1', uid: 'u1', spaceId: 's1', allSpaces: true, allowedSpaceIds: ['s1'], generation: 0 };
const perms = { cost: true, stock: true, edit: true };
const product = (id, extra = {}) => ({ id, businessId: 'b1', nome: `Batom ${id}`, codigo: `SKU-${id}`, barcode: `789${id}`, categoria: 'Batons',
  custo: 10, preco: 25, estoqueAtual: 10, estoque: 10, spaceAccessMode: 'all_spaces', allowedSpaceIds: [], ...extra });
const H9 = M.exportColumns.map((c) => c[0]), H8 = M.columns.map((c) => c[0]);
const line = (p, over = {}, cols = M.exportColumns) => { const v = { ...M.values(p), entrada: null, ...over }; return cols.map(([, k]) => v[k] ?? null); };
const baselineOf = (products) => Object.fromEntries(products.map((p) => [p.id, M.values(p).estoqueAtual]));

test('exportar e reimportar a mesma planilha sem editar: nada muda, nada duplica', () => {
  const catalog = ['1', '2', '3'].map((id) => product(id));
  const r = M.preview([H9, ...catalog.map((p) => line(p))], catalog, scope, perms, 'create_update', { baseline: baselineOf(catalog) });
  assert.equal(r.counts.updates, 0); assert.equal(r.counts.creates, 0); assert.equal(r.counts.unchanged, 3);
});

test('preço/custo atualizados depois de vendas: o estoque vendido NÃO é sobrescrito', () => {
  const exported = [product('1')], baseline = baselineOf(exported);
  const now = [product('1', { estoqueAtual: 7, estoque: 7 })]; // 3 vendidos depois da exportação
  const r = M.preview([H9, line(exported[0], { preco: 29.9, custo: 11 })], now, scope, perms, 'update', { baseline });
  assert.equal(r.counts.updates, 1);
  assert.deepEqual(r.rows[0].changes, { custo: 11, preco: 29.9 });
  assert.deepEqual(r.rows[0].kinds, ['cadastro']);
});

test('ajuste de estoque explícito: aceito se o estoque não mudou; conflito se houve vendas', () => {
  const exported = [product('1')], baseline = baselineOf(exported);
  const ok = M.preview([H9, line(exported[0], { estoqueAtual: 15 })], exported, scope, perms, 'update', { baseline });
  assert.deepEqual(ok.rows[0].changes, { estoqueAtual: 15 }); assert.deepEqual(ok.rows[0].kinds, ['ajuste']); assert.equal(ok.counts.adjustments, 1);
  const sold = M.preview([H9, line(exported[0], { estoqueAtual: 15 })], [product('1', { estoqueAtual: 8 })], scope, perms, 'update', { baseline });
  assert.equal(sold.rows[0].status, 'invalid'); assert.match(sold.rows[0].errors.join(), /estoque mudou desde a exportação/);
});

test('entrada de mercadorias em massa: soma ao estoque atual, mesmo após vendas', () => {
  const exported = [product('1'), product('2')], baseline = baselineOf(exported);
  const now = [product('1', { estoqueAtual: 4 }), product('2')];
  const r = M.preview([H9, line(exported[0], { entrada: 300 }), line(exported[1], { entrada: 12, preco: 30 })], now, scope, perms, 'update', { baseline });
  assert.equal(r.counts.entries, 2);
  assert.deepEqual(r.rows[0].changes, { entrada: 300 }); assert.deepEqual(r.rows[0].kinds, ['entrada']);
  assert.deepEqual(r.rows[1].kinds, ['cadastro', 'entrada']);
  for (const bad of [-1, 'abc']) assert.equal(M.preview([H9, line(exported[0], { entrada: bad })], now, scope, perms, 'update').rows[0].status, 'invalid');
  const both = M.preview([H9, line(exported[0], { entrada: 5, estoqueAtual: 99 })], exported, scope, perms, 'update', { baseline });
  assert.equal(both.rows[0].status, 'invalid');
  const all = M.preview([H9, line(exported[0], { entrada: 5 })], exported, { ...scope, spaceId: 'all_spaces' }, perms, 'update');
  assert.match(all.rows[0].errors.join(), /espaço específico/);
  assert.match(M.preview([H9, line(exported[0], { entrada: 5 })], exported, scope, { ...perms, stock: false }, 'update').rows[0].errors.join(), /permissão/);
});

test('cadastro em massa: novos produtos criados uma vez; entrada em produto novo vira estoque inicial', () => {
  const rows = [['', 'NOVO-1', '7891111', 'Base nova', 'Bases', 12, 39.9, null, 300], ['', 'NOVO-2', '', 'Pó novo', 'Pós', null, 29.9, 20, null]];
  const r = M.preview([H9, ...rows], [product('1')], scope, perms, 'create_update');
  assert.equal(r.counts.creates, 2);
  assert.equal(r.rows[0].create.estoqueAtual, 300); assert.equal(r.rows[1].create.estoqueAtual, 20);
  assert.equal(M.preview([H9, ['', 'NOVO-1', '', 'Base', 'B', 1, 2, 5, 6]], [], scope, perms, 'create_update').rows[0].status, 'invalid');
});

test('identificação por SKU, EAN e variações; repetidos bloqueados; planilha antiga (8 colunas) continua aceita', () => {
  const catalog = [product('1'), product('2', { productType: 'variable', hasVariations: true }),
    { ...product('2'), id: 'variant:v1', codigo: 'SKU-VAR', barcode: '', identifierReservation: true }];
  const bySku = M.preview([H8, ['', 'SKU-1', '', '', '', null, 27, null]], catalog, scope, perms, 'update');
  assert.equal(bySku.rows[0].id, '1'); assert.deepEqual(bySku.rows[0].changes, { preco: 27 });
  const byEan = M.preview([H8, ['', '', '7891', '', '', null, 28, null]], catalog, scope, perms, 'update');
  assert.equal(byEan.rows[0].id, '1');
  assert.equal(M.preview([H8, ['', 'SKU-VAR', '', '', '', null, 1, null]], catalog, scope, perms, 'update').rows[0].status, 'invalid', 'SKU de variação não é tratado como produto');
  const dup = M.preview([H9, line(catalog[0], { preco: 30 }), line(catalog[0], { preco: 31 })], catalog, scope, perms, 'update');
  assert.equal(dup.rows.every((r) => r.status === 'invalid'), true);
  assert.throws(() => M.preview([[...H9, 'Coluna extra'], line(catalog[0])], catalog, scope, perms), /colunas do modelo/);
});

test('arquivo real (.xlsx): exporta 9 colunas e a linha de estoque exportado; reimporta com a mesma base', () => {
  let result; const ctx = { XLSX: X, importScripts: () => {}, Uint8Array, self: { postMessage: (v) => { result = v; } } };
  vm.runInNewContext(fs.readFileSync('js/product-spreadsheet-worker.js', 'utf8'), ctx);
  const p = product('1');
  ctx.self.onmessage({ data: { action: 'export', table: [H9, line(p)], context: scope, baseline: [['1', 10]] } });
  ctx.self.onmessage({ data: { action: 'import', bytes: result.bytes } });
  assert.equal(result.table[0].length, 9); assert.equal(result.context[0], 'VECONI_PRODUCTS_V1');
  assert.deepEqual({ ...result.baseline }, { 1: 10 });
  assert.equal(M.preview(result.table, [p], scope, perms, 'update', { baseline: result.baseline }).counts.unchanged, 1);
});

// ── aplicação: o serviço real com o app simulado ──
function service({ queue = [], stock = 10 } = {}) {
  const source = fs.readFileSync('js/firebase/product-spreadsheet-service.js', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '');
  const calls = [], products = new Map([['1', product('1', { estoqueAtual: stock, estoque: stock })], ['2', product('2')]]);
  let serial = 0;
  const ctx = { console, setTimeout, navigator: { onLine: true }, crypto: globalThis.crypto, JSON, Map, Set, Object, Array, Error, String, Number, Promise,
    auth: { currentUser: { uid: 'u1' } }, db: {}, createFirestoreRepository: () => ({ listAllPaged: async () => [] }) };
  const enqueue = (op) => { queue.push({ operationId: `op-${++serial}`, category: 'pending' }); calls.push(op); };
  ctx.window = { ProductSpreadsheet: M, PlanLimitService: null,
    BusinessContext: { get: () => ({ businessId: 'b1', spaceAccess: 'all', allowedSpaceIds: ['s1'], business: { workspaceGeneration: 0 } }) },
    SpaceContext: { list: () => [{ id: 's1', businessId: 'b1', active: true, capabilities: { products: true } }], homeId: () => 's1' },
    TeamAccess: { has: () => true },
    SyncFirebase: { getQueueDiagnostics: () => queue, processSyncQueue: async (o) => calls.push(['sync', o]) },
    FirebaseCallable: async () => { throw Error('não deveria criar'); },
    Produtos: { obter: (id) => products.get(id),
      salvar: (d) => { assert.equal(d.estoqueAtual, products.get(d.id).estoqueAtual, 'salvar recebe o estoque atual, sem alteração'); enqueue(['salvar', d.id, { preco: d.preco, custo: d.custo, nome: d.nome }]); },
      entrada: (...a) => enqueue(['entrada', ...a]), ajustarEstoque: (...a) => enqueue(['ajuste', ...a]) } };
  vm.createContext(ctx); vm.runInContext(source + '\nthis.api={applyPreview};', ctx);
  return { apply: (preview) => ctx.api.applyPreview({ scope: { ...scope, allSpaces: true }, permissions: perms }, preview), ctx, applyWith: (catalog, preview) => ctx.api.applyPreview({ ...catalog, scope: { ...scope, allSpaces: true } }, preview), calls, queue, products };
}
const pv = (rows, catalog, options) => M.preview([H9, ...rows], catalog, scope, perms, 'update', options);

test('aplicar: cadastro por salvar (sem estoque), entrada relativa e ajuste absoluto, com espaço, pela fila sincronizada', async () => {
  const s = service(), cat = [...s.products.values()];
  const preview = pv([line(cat[0], { preco: 30, entrada: 5 }), line(cat[1], { estoqueAtual: 4 })], cat, { baseline: baselineOf(cat) });
  const report = await s.apply(preview);
  assert.equal(report.results.every((r) => r.ok), true, JSON.stringify(report.results));
  assert.deepEqual(JSON.parse(JSON.stringify(s.calls)), [
    ['salvar', '1', { preco: 30, custo: 10, nome: 'Batom 1' }],
    ['entrada', '1', 5, '', 'Entrada por planilha VECONI', 's1'],
    ['ajuste', '2', 4, 'Ajuste por planilha VECONI', 's1'],
    ['sync', { force: true }]]);
});

test('histórico resolvido/arquivado não bloqueia; pendência ativa de antes bloqueia; as próprias operações não', async () => {
  const resolved = service({ queue: [{ operationId: 'old', category: 'resolved' }, { operationId: 'old2', category: 'archived' }] });
  const cat = [...resolved.products.values()];
  const report = await resolved.apply(pv([line(cat[0], { preco: 30 }), line(cat[1], { preco: 31 })], cat));
  assert.equal(report.results.filter((r) => r.ok).length, 2, 'a segunda linha não é bloqueada pela operação da primeira');
  const pending = service({ queue: [{ operationId: 'x', category: 'pending' }] });
  await assert.rejects(pending.apply(pv([line(cat[0], { preco: 30 })], cat)), /Sincronize as operações pendentes/);
});

test('venda entre a prévia e a confirmação: entrada continua valendo; ajuste é recusado', async () => {
  const entry = service(), cat = [...entry.products.values()];
  const preview = pv([line(cat[0], { entrada: 5 })], cat);
  entry.products.set('1', product('1', { estoqueAtual: 9, estoque: 9 }));
  assert.equal((await entry.apply(preview)).results[0].ok, true);
  const adjust = service();
  const p2 = pv([line(cat[0], { estoqueAtual: 20 })], cat);
  adjust.products.set('1', product('1', { estoqueAtual: 9, estoque: 9 }));
  const r = (await adjust.apply(p2)).results[0];
  assert.equal(r.ok, false); assert.match(r.message, /mudaram desde a prévia/);
  assert.equal(adjust.calls.filter((c) => c[0] === 'ajuste').length, 0);
});

test('nenhuma escrita direta no Firestore no caminho de atualização', () => {
  const source = fs.readFileSync('js/firebase/product-spreadsheet-service.js', 'utf8');
  assert.doesNotMatch(source, /runTransaction|tx\.(set|update)|doc\(db/);
});

test('interrupção e retomada: a mesma planilha não soma a entrada duas vezes', async () => {
  const cat = [product('1'), product('2')], sheetId = 'a1b2c3d4e5f60718';
  const first = service(), rows = [line(cat[0], { entrada: 10 }), line(cat[1], { entrada: 20 })];
  await first.apply(pv(rows, cat), );
  const entries = [];
  const s = service();
  s.calls.length = 0;
  // movement already registered for product 1 by this same sheet (before the interruption)
  const moves = [{ produtoId: '1', tipo: 'entrada', observacao: `Entrada por planilha VECONI #${sheetId}` }];
  const preview = M.preview([H9, ...rows], cat, scope, perms, 'update', { entryApplied: (id) => moves.some((m) => m.produtoId === id) });
  assert.equal(preview.rows[0].status, 'unchanged'); assert.match(preview.rows[0].notes.join(), /já registrada/);
  assert.deepEqual(preview.rows[1].changes, { entrada: 20 });
  entries.push(...preview.rows.filter((r) => r.status === 'update').map((r) => r.id));
  assert.deepEqual(entries, ['2']);
  // and at apply time (row previewed before the interruption):
  const ctxSource = fs.readFileSync('js/firebase/product-spreadsheet-service.js', 'utf8');
  assert.match(ctxSource, /if \(entryApplied\(sheetId, row\.id\)\)/);
  assert.match(ctxSource, /Entrada por planilha VECONI #\$\{sheetId\}/);
});

test('custo só na nuvem (cópia local ainda sem custo): a linha é aplicada, não descartada como "dados mudaram"', async () => {
  const s = service(), cloudCatalog = [...s.products.values()];
  s.products.set('1', { ...product('1'), custo: undefined }); // local copy without productFinancials yet
  const preview = M.preview([H9, line(cloudCatalog[0], { preco: 30, custo: 11 })], cloudCatalog, scope, perms, 'update');
  const source = fs.readFileSync('js/firebase/product-spreadsheet-service.js', 'utf8');
  assert.match(source, /custo: p\.custo \?\? cloud\.get\(row\.id\)\?\.custo \?\? null/);
  const report = await s.applyWith({ scope, permissions: perms, matchingProducts: cloudCatalog }, preview);
  assert.equal(report.results[0].ok, true, JSON.stringify(report.results));
  assert.equal(s.calls[0][0], 'salvar');
});

test('blocos: até 25 produtos por operação, por tipo; bloco recusado não aplica nenhuma linha dele', async () => {
  const many = Array.from({ length: 60 }, (_, i) => product(String(i + 1)));
  const s = service(); for (const p of many) s.products.set(p.id, p);
  const blocks = []; let call = 0;
  s.ctx.window.Produtos.LOTE_MAX = 25;
  s.ctx.window.Produtos.aplicarLote = (items) => { call++; if (call === 2) throw Error('recusado no bloco'); blocks.push(items.map((i) => Object.keys(i).filter((k) => k !== 'id')[0])); s.queue.push({ operationId: `blk-${call}`, category: 'pending' }); };
  const rows = many.map((p, i) => line(p, i < 50 ? { preco: 40, entrada: 2 } : { preco: 41 }));
  const report = await s.apply(pv(rows, many, { baseline: baselineOf(many) }));
  assert.deepEqual(blocks.map((b) => b.length), [25, 10, 25], 'catálogo 25+(25 recusado)+10; entradas só das 25 linhas cujo bloco de catálogo foi aceito');
  assert.equal(new Set(blocks[2]).size, 1); assert.equal(blocks[2][0], 'entrada');
  assert.equal(report.results.filter((r) => !r.ok).length, 25);
  assert.deepEqual(JSON.parse(JSON.stringify(report.operationIds)), ['blk-1', 'blk-3', 'blk-4']);
});

test('Produtos.aplicarLote: um único DB.alterar por bloco, catálogo sem tocar estoque, entradas com movimento', () => {
  const src = fs.readFileSync('js/produtos.js', 'utf8');
  const data = { produtos: [product('1'), product('2')], movimentacoesEstoque: [] }; let alters = 0;
  const c = { console, structuredClone, window: {}, Utils: { uuid: (() => { let n = 0; return () => `mov-${++n}`; })() },
    DB: { carregar: () => data, alterar: (fn) => { alters++; fn(data); } }, document: { addEventListener() {} } };
  c.window = c; c.ProductModel = { build: (d) => ({ ...d }) }; c.window.ProductModel = c.ProductModel;
  vm.createContext(c); vm.runInContext(src, c);
  const movs = c.Produtos.aplicarLote([{ id: '1', catalog: { preco: 50 } }, { id: '2', entrada: { quantidade: 4, observacao: 'Entrada por planilha VECONI #aaaaaaaaaaaaaaaa', spaceId: 's1' } }]);
  assert.equal(alters, 1);
  assert.equal(data.produtos[0].preco, 50); assert.equal(data.produtos[0].estoqueAtual, 10);
  assert.equal(data.produtos[1].estoqueAtual, 14); assert.equal(movs.length, 1); assert.equal(movs[0].tipo, 'entrada');
  assert.throws(() => c.Produtos.aplicarLote(Array.from({ length: 26 }, (_, i) => ({ id: String(i) }))), /1 a 25/);
  assert.throws(() => c.Produtos.aplicarLote([{ id: '1', catalog: { estoqueAtual: 1 } }]), /Campo não permitido/);
});

test('bloco de entradas: todos os movimentos com o operationId do bloco (regra do servidor) e ids únicos', () => {
  const src = fs.readFileSync('js/produtos.js', 'utf8');
  const data = { produtos: [product('1'), product('2'), product('3')], movimentacoesEstoque: [] };
  const c = { console, structuredClone, window: {}, Utils: { uuid: (() => { let n = 0; return () => `u-${++n}`; })() }, DB: { carregar: () => data, alterar: (fn) => fn(data) }, document: { addEventListener() {} } };
  c.window = c; c.ProductModel = { build: (d) => ({ ...d }) }; vm.createContext(c); vm.runInContext(src, c);
  const movs = c.Produtos.aplicarLote(['1', '2', '3'].map((id) => ({ id, entrada: { quantidade: 2, observacao: 'x', spaceId: 's1' } })));
  assert.equal(new Set(movs.map((m) => m.operationId)).size, 1);
  assert.equal(new Set(movs.map((m) => m.id)).size, 3);
  assert.ok(movs.every((m) => m.id !== m.operationId));
  const server = fs.readFileSync('functions/src/services/operational-commit-service.js', 'utf8');
  assert.ok(server.includes("m.operationId!==item.operationId"), 'regra do servidor que exige o mesmo operationId');
  const single = c.Produtos.entrada('1', 1, '', 'y', 's1');
  assert.equal(single.id, single.operationId, 'entrada individual continua igual');
});
