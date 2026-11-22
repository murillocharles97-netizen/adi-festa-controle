'use strict';
// Etapa A — exportação somente leitura com histórico retido (dados fictícios).
// Itens da fila no formato de SyncFirebase.getQueueDiagnostics() (classifyQueueOperation em sync.js).
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const M = require('../functions/src/shared/product-spreadsheet.js');

const held = (id, category = 'error', reviewReason = 'monetary_recovery_required') => ({ operationId: id, category, sendable: false, canRetry: false, replayBlocked: true, reviewRequired: category !== 'error', reviewReason });
const codexQueue = () => [held('e1'), held('e2', 'error', 'product_stock_review_required'), held('e3', 'error', 'product_stock_review_required'), held('e4', 'error', 'sync_receipt_review_required'),
  held('r1', 'manual_review', 'sku_review'), held('r2', 'manual_review', 'payment_review'), { operationId: 'ok1', category: 'resolved' }, { operationId: 'ok2', category: 'archived' }];
const retryable = { operationId: 'retry', category: 'error', sendable: false, canRetry: true, replayBlocked: false, reviewReason: null };
const rejectedNoReason = { operationId: 'fav', category: 'error', sendable: false, canRetry: false, replayBlocked: false, reviewReason: null };
const server = (id, extra = {}) => ({ id, businessId: 'b1', nome: `Servidor ${id}`, codigo: `SKU-${id}`, barcode: `789${id}`, categoria: 'Fictícios', preco: 20, estoqueAtual: 7, ativo: true, spaceAccessMode: 'all_spaces', allowedSpaceIds: [], ...extra });

function harness({ queue = codexQueue(), cloud = [server('1'), server('2')], financials = [{ productId: '1', custo: 9 }], perms = null, online = true, uid = 'u1', readFails = null, local = null } = {}) {
  const source = fs.readFileSync('js/firebase/product-spreadsheet-service.js', 'utf8').replace(/^import .*$/gm, '').replace(/^export /gm, '');
  const reads = [], writes = [];
  const repo = (name) => ({ listAllPaged: async () => { reads.push(name); if (readFails) throw readFails; return structuredClone(name === 'products' ? cloud : name === 'productFinancials' ? financials : []); } });
  const ctx = { console, setTimeout, structuredClone, navigator: { onLine: online }, crypto: globalThis.crypto, JSON, Map, Set, Object, Array, Error, String, Number, Promise,
    auth: { currentUser: uid ? { uid } : null }, db: {}, createFirestoreRepository: repo };
  const has = (p) => (perms ? perms.includes(p) : true);
  ctx.window = { ProductSpreadsheet: M, PlanLimitService: null,
    BusinessContext: { get: () => ({ businessId: 'b1', spaceAccess: 'all', allowedSpaceIds: ['s1'], business: { workspaceGeneration: 0 } }) },
    SpaceContext: { list: () => [{ id: 's1', businessId: 'b1', active: true, capabilities: { products: true } }, { id: 's2', businessId: 'b1', active: true, capabilities: { products: true } }], homeId: () => 's1' },
    TeamAccess: { has },
    SyncFirebase: { getQueueDiagnostics: () => queue, processSyncQueue: async () => writes.push('sync'), pullCloudCollections: async () => writes.push('pull') },
    FirebaseCallable: async (name) => { writes.push(name); throw Error('não deveria chamar o servidor'); },
    Produtos: { obter: (id) => (local || []).find((p) => p.id === id), salvar: () => writes.push('salvar'), entrada: () => writes.push('entrada'), ajustarEstoque: () => writes.push('ajuste'), aplicarLote: () => writes.push('lote') } };
  vm.createContext(ctx);
  vm.runInContext(source + '\nthis.api={loadCatalog,applyPreview,applyIdentifierCorrections};', ctx);
  return { api: ctx.api, reads, writes, queue };
}
const exportOnly = { exportOnly: true };

test('cenário do Codex (0 enviáveis, 4 erros retidos, 2 revisões, 2 resolvidas): exporta só dados da nuvem e não toca a fila', async () => {
  const h = harness({ local: [server('1', { nome: 'Local diferente', preco: 99 })] }), before = JSON.stringify(h.queue);
  const catalog = await h.api.loadCatalog(exportOnly);
  assert.equal(catalog.exportOnly, true);
  assert.deepEqual(catalog.products.map((p) => [p.id, p.nome, p.preco]), [['1', 'Servidor 1', 20], ['2', 'Servidor 2', 20]], 'dados do servidor, nunca os locais');
  assert.equal(catalog.products[0].custo, 9);
  assert.deepEqual(h.reads.sort(), ['productFinancials', 'productVariants', 'products']);
  assert.equal(JSON.stringify(h.queue), before, 'fila e status intactos');
  assert.deepEqual(h.writes, []);
});

test('mesmo cenário: importação, correção de SKU/EAN e entrada de estoque continuam bloqueadas', async () => {
  const h = harness({ local: [server('1'), server('2')] });
  await assert.rejects(h.api.loadCatalog(), (e) => e.code === 'spreadsheet-queue-active', 'carregar para importar continua bloqueado');
  const catalog = await h.api.loadCatalog(exportOnly);
  const preview = M.preview([M.exportColumns.map((c) => c[0]), ['1', 'SKU-1', '7891', 'Servidor 1', 'Fictícios', 9, 30, 7, 5]], catalog.matchingProducts, catalog.scope, catalog.permissions, 'update');
  assert.equal(preview.counts.updates, 1);
  await assert.rejects(h.api.applyPreview(catalog, preview), /Importação indisponível/);
  await assert.rejects(h.api.applyPreview({ ...catalog, exportOnly: undefined }, preview), /Sincronize as operações pendentes/, 'sem a marca, a regra estrita de sempre vale');
  await assert.rejects(h.api.applyIdentifierCorrections(catalog, { mode: 'identifiers', rows: [] }), /Correção de códigos indisponível/);
  await assert.rejects(h.api.applyIdentifierCorrections({ ...catalog, exportOnly: undefined }, { mode: 'identifiers', rows: [] }), /Sincronize as operações pendentes/);
  assert.deepEqual(h.writes, [], 'nenhuma gravação, entrada, ajuste ou chamada ao servidor');
});

test('erros retentáveis bloqueiam a exportação (não são tratados como histórico)', async () => {
  for (const item of [retryable, rejectedNoReason, { ...held('x'), reviewReason: null }, { ...held('y'), canRetry: true }, { ...held('z'), sendable: true }]) {
    const h = harness({ queue: [...codexQueue(), item] });
    await assert.rejects(h.api.loadCatalog(exportOnly), (e) => e.code === 'spreadsheet-export-queue-active', JSON.stringify(item));
    assert.deepEqual(h.reads, [], 'nada é lido nem apresentado');
  }
});

test('operações realmente pendentes, em envio, em preparo ou desconhecidas bloqueiam a exportação', async () => {
  for (const category of ['pending', 'processing', 'preparing', 'desconhecida', undefined]) {
    const h = harness({ queue: [...codexQueue(), { operationId: 'live', category, sendable: category === 'pending' }] });
    await assert.rejects(h.api.loadCatalog(exportOnly), /ainda podem ser enviadas ou reenviadas/, String(category));
  }
});

test('fila que muda durante a leitura: a exportação é recusada sem entregar dados', async () => {
  const h = harness(); const original = h.api.loadCatalog;
  const queue = h.queue;
  const pending = original(exportOnly); queue.push({ operationId: 'nova', category: 'pending', sendable: true });
  await assert.rejects(pending, /ainda podem ser enviadas/);
});

test('produtos de outros espaços e de outra empresa não são exportados', async () => {
  const h = harness({ cloud: [server('1'), server('2', { spaceAccessMode: 'selected_spaces', allowedSpaceIds: ['s2'] }), server('3', { businessId: 'b2' }), server('4', { ativo: false })] });
  const catalog = await h.api.loadCatalog(exportOnly);
  assert.deepEqual(catalog.products.map((p) => p.id), ['1']);
});

test('permissões: sem products.view não exporta; sem cost.view o custo não sai nem é lido', async () => {
  await assert.rejects(harness({ perms: ['products.edit'] }).api.loadCatalog(exportOnly), /Sem acesso aos produtos/);
  const h = harness({ perms: ['products.view'] });
  const catalog = await h.api.loadCatalog(exportOnly);
  assert.equal(catalog.products[0].custo, null);
  assert.ok(!h.reads.includes('productFinancials'));
});

test('falha de rede, offline e sessão ausente: erro verdadeiro, sem dados locais apresentados como confirmados', async () => {
  const local = [server('1', { nome: 'Somente local' })];
  await assert.rejects(harness({ local, readFails: Object.assign(Error('Failed to get documents from server.'), { code: 'unavailable' }) }).api.loadCatalog(exportOnly), /server/);
  await assert.rejects(harness({ local, online: false }).api.loadCatalog(exportOnly), /Conecte-se à internet/);
  await assert.rejects(harness({ local, uid: null }).api.loadCatalog(exportOnly), /Sem acesso aos produtos/);
  await assert.rejects(harness({ local, readFails: Object.assign(Error('Missing or insufficient permissions.'), { code: 'permission-denied' }) }).api.loadCatalog(exportOnly), /permissions/);
});

test('sem histórico na fila, o comportamento de importação da main não muda', async () => {
  const h = harness({ queue: [{ operationId: 'a', category: 'resolved' }] });
  const catalog = await h.api.loadCatalog();
  assert.equal(catalog.exportOnly, undefined);
  await assert.rejects(harness().api.loadCatalog(), /Sincronize as operações pendentes/);
});

test('interface: exportar usa a leitura somente-leitura e o arquivo de importação fica travado no modo exportOnly', () => {
  const ui = fs.readFileSync('js/product-spreadsheet-ui.js', 'utf8');
  assert.match(ui, /const exported = await service\.loadCatalog\(\{ exportOnly: true \}\)/);
  assert.match(ui, /fileInput\.disabled = value \|\| !catalog\?\.permissions\.edit \|\| catalog\?\.exportOnly === true/);
  assert.match(ui, /if \(e\?\.code !== 'spreadsheet-queue-active'\) throw e;/);
});
