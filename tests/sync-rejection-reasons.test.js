'use strict';
// Fase 1 — códigos estáveis de rejeição. Reusable checks: they read the CURRENT
// sources, so a new server rejection without a reason fails here immediately.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm');
const Rejection = require('../functions/src/shared/sync-rejection.js');
const Policy = require('../functions/src/shared/permission-policy.js');
const SERVICE = 'functions/src/services/operational-commit-service.js';

function literalFailures(file) {
  const source = fs.readFileSync(file, 'utf8');
  return [...source.matchAll(/fail\('((?:[^'\\]|\\.)*)'(?:\s*,\s*'([a-z-]+)')?\)/g)].map(([, message, code]) => ({ message, code: code || 'permission-denied' }));
}
function services() {
  const list = [SERVICE];
  if (process.env.VECONI_LIVE_FUNCTIONS_DIR) list.push(`${process.env.VECONI_LIVE_FUNCTIONS_DIR}/src/services/operational-commit-service.js`);
  return list;
}

test('toda rejeição literal do commitOperationalSync tem motivo estável (repositório e, se informado, o pacote publicado)', () => {
  for (const file of services()) {
    const failures = literalFailures(file);
    assert.ok(failures.length >= 140, `${file}: ${failures.length} rejeições encontradas`);
    const missing = failures.filter(({ message }) => Rejection.classify(message).reason === 'unclassified').map(f => f.message);
    assert.deepEqual(missing, [], `${file}: mensagens sem motivo`);
  }
  // Dynamic messages used by the service.
  assert.equal(Rejection.classify(Policy.MESSAGE).reason, 'customer_permission_required');
  assert.equal(Rejection.classify('Coleção/ação não autorizada: products').category, 'permission');
  assert.equal(Rejection.classify('Recebimento não pode reescrever a origem da venda (valorFinal).').reason, 'payment_rewrites_sale_origin');
  assert.equal(Rejection.classify('Total não corresponde aos itens.').reason, 'sale_total_mismatch'); // also thrown by SaleMoney
});

test('motivos são únicos, permanentes no formato e com categoria conhecida', () => {
  const reasons = [...Rejection.MESSAGES, ...Rejection.PREFIXES].map(([, reason]) => reason);
  assert.equal(new Set(reasons).size, reasons.length, 'um motivo não pode ser reutilizado');
  for (const [message, reason, category] of [...Rejection.MESSAGES, ...Rejection.PREFIXES]) {
    assert.match(reason, /^[a-z0-9][a-z0-9_]{0,63}$/, message);
    assert.ok(Rejection.CATEGORIES[category], `${reason}: categoria ${category}`);
  }
  assert.equal(new Set(Rejection.MESSAGES.map(([m]) => m)).size, Rejection.MESSAGES.length);
});

test('o servidor mantém código e texto e só acrescenta details (PWAs antigos inalterados)', () => {
  const source = fs.readFileSync(SERVICE, 'utf8');
  assert.match(source, /const fail=\(message,code='permission-denied'\)=>\{throw new HttpsError\(code,message,Rejection\.details\(message,code\)\);\};/);
  const callable = fs.readFileSync('functions/src/shared/operational-callable.js', 'utf8');
  assert.match(callable, /Rejection\.details\('Atualize a VECONI antes de sincronizar\. A fila original foi preservada\.','failed-precondition',\{reason:'sync-update-required'\}\)/);
  const { HttpsError } = require('node:module').createRequire(require('node:path').resolve('functions/package.json'))('firebase-functions/v2/https');
  const error = new HttpsError('permission-denied', 'Estoque sem movimento autorizado.', Rejection.details('Estoque sem movimento autorizado.', 'permission-denied'));
  assert.deepEqual(error.toJSON(), { status: 'PERMISSION_DENIED', message: 'Estoque sem movimento autorizado.',
    details: { reason: 'stock_without_movement', category: 'stock_conflict', rejectionSchema: 1 } });
  // Existing reasons from the callable boundary are preserved.
  assert.equal(Rejection.details('A operação exige atualização ou revisão antes de continuar.', 'failed-precondition', { reason: 'stock-x' }).reason, 'stock-x');
});

test('a maior parte dos permission-denied padrão NÃO é falta de permissão (o motivo corrige o diagnóstico)', () => {
  const byDefault = literalFailures(SERVICE).filter(f => f.code === 'permission-denied');
  const categories = byDefault.reduce((n, f) => ({ ...n, [Rejection.classify(f.message).category]: (n[Rejection.classify(f.message).category] || 0) + 1 }), {});
  assert.ok(categories.permission < byDefault.length / 3, JSON.stringify(categories));
  assert.ok(categories.stock_conflict >= 10 && categories.data_conflict >= 40, JSON.stringify(categories));
});

test('describe: servidor tipado → cliente → texto legado; nunca presume permissão por código', () => {
  assert.deepEqual(Rejection.describe({ code: 'functions/permission-denied', message: 'x', details: { reason: 'stock_delta_mismatch', category: 'stock_conflict' } }),
    { reason: 'stock_delta_mismatch', category: 'stock_conflict', source: 'server' });
  assert.deepEqual(Rejection.describe({ code: 'permission-denied', message: 'Mensagem futura desconhecida.' }),
    { reason: 'unclassified', category: 'unclassified', source: 'unknown' });
  assert.equal(Rejection.describe({ code: 'unavailable', message: 'Failed to fetch' }).category, 'connection');
  assert.equal(Rejection.describe({ code: 'deadline-exceeded' }).category, 'connection');
  assert.equal(Rejection.describe({ code: 'internal', message: 'internal' }).category, 'unclassified', 'internal não é presumido como conexão');
  assert.equal(Rejection.describe({ code: 'sale-stock-review-required' }).category, 'dependency_pending');
  assert.deepEqual(Rejection.describe({ code: 'permission-denied', message: 'Estoque sem movimento autorizado.' }),
    { reason: 'stock_without_movement', category: 'stock_conflict', source: 'legacy_message' });
  assert.equal(Rejection.describe({ code: 'permission-denied', message: 'Espaço não autorizado.' }).category, 'permission');
  // A malformed reason from the wire is ignored.
  assert.equal(Rejection.describe({ code: 'permission-denied', message: 'Espaço não autorizado.', details: { reason: 'NOT VALID!' } }).source, 'legacy_message');
});

// ── client: the real decisions from js/firebase/sync.js, with and without the shared module ──
function client({ withModule = true } = {}) {
  const source = fs.readFileSync('js/firebase/sync.js', 'utf8').replace(/\r\n/g, '\n');
  const piece = (start, end) => { const a = source.indexOf(start), b = source.indexOf(end, a); assert.ok(a >= 0 && b > a, start); return source.slice(a, b); };
  const c = withModule ? { VeconiSyncRejection: Rejection } : {}; vm.createContext(c);
  vm.runInContext(piece('function monetaryRecoveryRequired(item)', 'async function assertCancellationQueueClear(') +
    '\nthis.api={monetaryRecoveryRequired,rejectedProductStockUpdate};', c);
  return c.api;
}
const stockPacket = (extra) => ({ status: 'error', lastErrorStage: 'server_operational_commit', lastErrorCode: 'permission-denied',
  payload: { writes: [{ entityType: 'products', operation: 'update', entityId: 'p1', data: {} }] }, ...extra });
const salePacket = (extra) => ({ lastErrorCode: 'invalid-argument', payload: { writes: [{ entityType: 'sales', operation: 'create', data: {} }] }, ...extra });

test('cliente: pacotes antigos (sem motivo) continuam reconhecidos pelo texto exato, com e sem o módulo', () => {
  for (const withModule of [true, false]) {
    const api = client({ withModule });
    assert.equal(api.rejectedProductStockUpdate(stockPacket({ lastErrorMessage: 'Estoque sem movimento autorizado.' })), true);
    assert.equal(api.rejectedProductStockUpdate(stockPacket({ lastErrorMessage: 'Estoque sem movimento autorizado' })), false);
    assert.equal(api.monetaryRecoveryRequired(salePacket({ lastErrorMessage: 'Total não corresponde aos itens.' })), true);
    assert.equal(api.monetaryRecoveryRequired(salePacket({ lastErrorMessage: 'Outro erro.' })), false);
    // A packet stored as 'unclassified' still falls back to the legacy text.
    assert.equal(api.rejectedProductStockUpdate(stockPacket({ lastErrorMessage: 'Estoque sem movimento autorizado.', lastErrorReason: 'unclassified' })), true);
  }
});

test('cliente: pacotes novos decidem pelo motivo, mesmo que o texto do servidor mude', () => {
  const api = client();
  assert.equal(api.rejectedProductStockUpdate(stockPacket({ lastErrorMessage: 'Texto revisado no servidor.', lastErrorReason: 'stock_without_movement' })), true);
  assert.equal(api.rejectedProductStockUpdate(stockPacket({ lastErrorMessage: 'Estoque sem movimento autorizado.', lastErrorReason: 'stock_delta_mismatch' })), false);
  assert.equal(api.monetaryRecoveryRequired(salePacket({ lastErrorMessage: 'Novo texto.', lastErrorReason: 'sale_total_mismatch' })), true);
  assert.equal(api.monetaryRecoveryRequired(salePacket({ lastErrorMessage: 'Total não corresponde aos itens.', lastErrorReason: 'items_invalid' })), false);
  // The code gate is preserved: a reason never widens what the old rule accepted.
  assert.equal(api.rejectedProductStockUpdate(stockPacket({ lastErrorCode: 'failed-precondition', lastErrorReason: 'stock_without_movement' })), false);
});

test('cliente: grava motivo/categoria do servidor, de códigos locais e de pacotes antigos', () => {
  assert.deepEqual(Rejection.queueFields({ code: 'permission-denied', message: 'Estoque sem movimento autorizado.', details: { reason: 'stock_without_movement', category: 'stock_conflict', rejectionSchema: 1 } }),
    { lastErrorReason: 'stock_without_movement', lastErrorCategory: 'stock_conflict', lastErrorReasonSource: 'server' });
  assert.equal(Rejection.queueFields({ code: 'unavailable', message: 'offline' }).lastErrorCategory, 'connection');
  assert.deepEqual(Rejection.queueFields({ code: 'permission-denied', message: 'Algo novo.' }),
    { lastErrorReason: 'unclassified', lastErrorCategory: 'unclassified', lastErrorReasonSource: 'unknown' });
  assert.equal(Rejection.ofItem({ lastErrorCode: 'permission-denied', lastErrorMessage: 'Agregado das variações divergente.' }).category, 'stock_conflict');
  assert.equal(Rejection.ofItem({ status: 'pending' }), null);
  assert.deepEqual(Rejection.diagnosticFields({ lastErrorCode: 'failed-precondition', lastErrorMessage: 'x', lastErrorReason: 'previous_payment_review', lastErrorCategory: 'review_required' }, 'payment_financial_dependency'),
    { rejectionReason: 'previous_payment_review', rejectionCategory: 'dependency_pending', rejectionSource: 'server' });
  assert.deepEqual(Rejection.countByCategory([{ lastErrorCode: 'unavailable' }, { lastErrorCode: 'permission-denied', lastErrorMessage: 'Espaço não autorizado.' }, { lastErrorCode: 'deadline-exceeded' }]),
    { connection: 2, permission: 1 });
});

test('cliente: toda falha gravada na fila limpa o motivo anterior e grava o novo', () => {
  const source = fs.readFileSync('js/firebase/sync.js', 'utf8').replace(/\r\n/g, '\n');
  const sites = [...source.matchAll(/lastErrorReason: undefined, lastErrorCategory: undefined, lastErrorReasonSource: undefined,\n\s*\.\.\.globalThis\.VeconiSyncRejection\?\.queueFields\?\.\(\{code: ([^,]+),/g)].map(m => m[1]);
  assert.deepEqual(sites, ['preflight.code', 'errorCode(error)']);
  assert.match(source, /queueFields\?\.\(\{code: errorCode\(error\), message: error\?\.message, details: error\?\.details\}\)/);
  // Every legacy text comparison is now only the fallback of a reason check.
  const legacy = [...source.matchAll(/(.{0,140})lastErrorMessage==='(Total não corresponde aos itens\.|Estoque sem movimento autorizado\.)'/g)];
  assert.equal(legacy.length, 4);
  for (const [, before] of legacy) assert.match(before, /VeconiSyncRejection\?\.isReason\?\.\([a-z]+,'(sale_total_mismatch|stock_without_movement)','[^']+'\)\?\?[a-z]+\.$/);
});

test('o módulo compartilhado é carregado pelo app, pelo Service Worker e pelo build público', () => {
  assert.match(fs.readFileSync('index.html', 'utf8'), /<script src="\.\/functions\/src\/shared\/sync-rejection\.js\?v=1"><\/script>/);
  assert.match(fs.readFileSync('service-worker.js', 'utf8'), /'\.\/functions\/src\/shared\/sync-rejection\.js'/);
  assert.match(fs.readFileSync('scripts/build-public-site.cjs', 'utf8'), /'sync-rejection\.js'/);
});
