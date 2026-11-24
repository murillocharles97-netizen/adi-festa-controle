'use strict';
// Força-tarefa de estabilização: classificação das diferenças da Sincronização.
// Fixtures fictícias com a mesma forma da conta auditada: inativos que o aparelho
// não guarda, histórico sem Espaço, testes antigos, serviço recusado antes da V241,
// cliente retido e uma falha temporária.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const {execFileSync} = require('node:child_process');
const F = require('../js/sync-findings.js');

const PUBLISHED = '2c9312602ff58263a0bf55f4aa45b3a890ef82e8';
const rec = (id, extra = {}) => ({documentId: id, operationId: extra.operationId || '', active: extra.active ?? true, deleted: false, createdAt: extra.createdAt || '2026-11-01T10:00:00.000Z', ...extra});
function fixture() {
  const inactive = ['qa-cli-ina-1', 'qa-cli-ina-2', 'qa-cli-ina-3'].map(id => rec(id.replace(/^qa-/, 'c-'), {active: false}));
  const remote = {
    clients: {'c-cli-ina-1': {active: false, ativo: true, saldo: 0}, 'c-cli-ina-2': {active: false, saldo: 0}, 'c-cli-ina-3': {active: false, ativo: true, saldo: -42.75}},
    products: {'p-old-1': {active: false}, 'qa_v170_flow_a': {active: true}},
    sales: {'s-aug-1': {status: 'pago', createdAt: '2026-08-10T10:00:00Z'}, 's-mystery': {status: 'pago', spaceId: 'space-a'}},
  };
  const audit = {generatedAt: '2026-11-24T22:00:00.000Z', collections: {
    clients: {localTotal: 4, remoteTotal: 7, equal: [rec('c-1')], onlyLocal: [], onlyRemote: inactive,
      divergent: [{documentId: 'c-retido', operationId: '', hasPendingLocal: false, fields: ['saldo']}]},
    products: {localTotal: 2, remoteTotal: 4, equal: [rec('p-1'), rec('p-2')], onlyLocal: [], onlyRemote: [rec('p-old-1', {active: false}), rec('qa_v170_flow_a')], divergent: []},
    sales: {localTotal: 5, remoteTotal: 4, equal: [rec('s-1'), rec('s-2')], divergent: [],
      onlyLocal: [{documentId: 'ride-1', operationId: 'op-ride-1', classification: 'A', queueOperationId: 'op-ride-1', category: 'local_only'},
        {documentId: 'ride-2', operationId: 'op-ride-2', classification: 'A', queueOperationId: 'op-ride-2', category: 'local_only'},
        {documentId: 'ride-3', operationId: 'op-ride-3', classification: 'A', queueOperationId: 'op-ride-3', category: 'local_only'}],
      onlyRemote: [rec('s-aug-1'), rec('s-mystery')]},
  }, financial: {balanceScope: {operationalMatches: false}}};
  const queue = [
    {operationId: 'op-ride-1', category: 'resolved', collection: 'sales'},
    {operationId: 'op-ride-2', category: 'error', canRetry: false, replayBlocked: true, reviewReason: 'service_configuration_missing', collection: 'sales', errorCode: 'failed-precondition'},
    {operationId: 'op-ride-3', category: 'error', canRetry: false, replayBlocked: true, reviewReason: 'service_configuration_missing', collection: 'sales', errorCode: 'failed-precondition'},
    {operationId: 'op-pay-1', category: 'pending', collection: 'payments', documentId: 'pay-1'},
    {operationId: 'op-prod-1', category: 'error', canRetry: true, replayBlocked: false, collection: 'products', documentId: 'p-3', errorCode: 'unavailable'},
  ];
  const retained = [{clientId: 'c-retido', clientName: 'Cliente Fictício', localBalance: 0, cloudBalance: -50, difference: -50, blockedOnly: true, operations: [{operationId: 'op-ride-2'}]}];
  const saleReport = [{saleId: 'ride-1', resolved: true, classification: 'E'}, {saleId: 'ride-2', classification: 'A', recoveryMode: 'sale_only', amount: 120, customerId: 'c-x', reason: 'Venda paga'}, {saleId: 'ride-3', classification: 'E', recoveryMode: '', amount: 120}];
  return {audit, queue, retained, saleReport, remoteById: (name, id) => remote[name]?.[id] || null};
}
const byReason = (result, reason) => result.findings.filter(f => f.reason === reason);

test('reprodução: a V242.9 conta como diferença todo registro que só existe na nuvem', () => {
  const source = execFileSync('git', ['show', `${PUBLISHED}:js/firebase/firebase-ui.js`], {encoding: 'utf8', maxBuffer: 64 << 20});
  const a = source.indexOf('const shortTime='), b = source.indexOf('function syncActionRow(', a);
  assert.ok(a > 0 && b > a, 'syncOverview publicado');
  const context = vm.createContext({window: {}, money: v => String(v), Date, Number, String, Object, Boolean});
  vm.runInContext(source.slice(a, b) + ';this.syncOverview=syncOverview;', context);
  const {audit, retained} = fixture();
  const overview = context.syncOverview({integrityStatus: 'completed', dataAudit: audit, details: {comparison: {retainedBalances: retained}}}, [], {pending: 0});
  // 3 clientes inativos + 2 produtos (1 inativo, 1 de teste) + 2 vendas só na nuvem.
  assert.equal(overview.key, 'differences');
  assert.ok(overview.differences >= 7, `V242.9 reporta ${overview.differences} diferenças`);
});

test('cada diferença recebe uma única classificação, com motivo; nada é descartado', () => {
  const result = F.build(fixture());
  const raw = 3 + 2 + 2 + 3 + 1; // onlyRemote clientes+produtos+vendas, onlyLocal vendas, divergente
  const auditKeys = result.findings.filter(f => !['op:op-pay-1', 'op:op-prod-1'].includes(f.key));
  assert.equal(auditKeys.length, raw, 'todo registro da comparação aparece exatamente uma vez');
  assert.equal(new Set(result.findings.map(f => f.key)).size, result.findings.length);
  for (const f of result.findings) assert.ok(f.title && f.text && F.KINDS.includes(f.kind), f.key);
});

test('inativos, testes antigos e vendas sem Espaço são explicados, não escondidos', () => {
  const result = F.build(fixture());
  assert.equal(byReason(result, 'inactive_not_kept').length, 3, '2 clientes + 1 produto inativos');
  assert.deepEqual(byReason(result, 'qa_residue').map(f => f.documentId), ['qa_v170_flow_a']);
  assert.deepEqual(byReason(result, 'legacy_without_space').map(f => f.documentId), ['s-aug-1']);
  assert.ok(result.findings.filter(f => f.kind === 'explained').every(f => f.text.length > 20));
});

test('cliente inativo com saldo exige atenção; venda só na nuvem sem explicação também', () => {
  const result = F.build(fixture());
  assert.deepEqual(byReason(result, 'inactive_client_balance').map(f => [f.documentId, f.cloudBalance]), [['c-cli-ina-3', -42.75]]);
  assert.deepEqual(byReason(result, 'cloud_only').map(f => f.documentId), ['s-mystery']);
  assert.equal(byReason(result, 'balance_total').length, 0, 'o total é explicado pelo cliente retido');
});

test('serviço recusado antes da V241 fica bloqueado; a conciliada aparece como resolvida', () => {
  const result = F.build(fixture());
  const blocked = byReason(result, 'service_configuration_missing');
  assert.deepEqual(blocked.map(f => f.documentId).sort(), ['ride-2', 'ride-3']);
  assert.equal(blocked.find(f => f.documentId === 'ride-2').recoveryMode, 'sale_only', 'a recuperação é oferecida só na linha');
  assert.ok(blocked.every(f => f.kind === 'blocked' && f.action === 'open_sale'));
  assert.deepEqual(byReason(result, 'resolved').map(f => f.documentId), ['ride-1']);
});

test('saldo retido, pendência e falha temporária têm categorias próprias', () => {
  const result = F.build(fixture());
  const retained = byReason(result, 'client_retained');
  assert.equal(retained.length, 1);
  assert.equal(retained[0].kind, 'blocked');
  assert.deepEqual(byReason(result, 'queued').map(f => f.operationId), ['op-pay-1']);
  assert.deepEqual(byReason(result, 'retry_temporary').map(f => [f.operationId, f.action]), [['op-prod-1', 'retry']]);
  assert.deepEqual(result.counts, {attention: 2, blocked: 3, recoverable: 1, pending: 1, explained: 6});
});

test('sem cliente retido, total de saldos diferente vira atenção', () => {
  const input = fixture(); input.retained = []; input.audit.collections.clients.divergent = [];
  assert.equal(byReason(F.build(input), 'balance_total').length, 1);
});

test('sem comparação nesta sessão a fila ainda é classificada', () => {
  const result = F.build({queue: fixture().queue});
  assert.equal(result.compared, false);
  assert.equal(result.counts.blocked, 2);
  assert.equal(result.counts.pending, 1);
});

test('cópias para suporte removem dados pessoais, credenciais e tokens; identificadores ficam', () => {
  const value = F.redact({id: 'cli-1', nome: 'Fulano de Tal', telefone: '17999990000', email: 'x@y.com', portalRefToken: 'abc-123',
    nested: {observacoes: 'texto', note: 'ligar para 17 99999-0000 ou fulano@exemplo.com', jwt: 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk'}, operationId: 'op-1'});
  assert.equal(value.id, 'cli-1'); assert.equal(value.operationId, 'op-1');
  for (const k of ['nome', 'telefone', 'email', 'portalRefToken']) assert.equal(value[k], '[removido]');
  assert.equal(value.nested.observacoes, '[removido]');
  assert.doesNotMatch(value.nested.note, /9999|exemplo/);
  assert.equal(value.nested.jwt, '[token]');
});

test('resumo e relatório de divergências não levam nomes de clientes', () => {
  const result = F.build(fixture());
  const text = F.summaryText(result, {appVersion: '242.10', businessId: 'qa-shop', stateTitle: 'Diferenças encontradas'});
  assert.match(text, /Exigem atenção: 2 · Bloqueadas: 3 · Recuperáveis: 1 · Aguardando envio: 1 · Explicadas: 6/);
  assert.doesNotMatch(text, /Cliente Fictício/);
  const report = F.divergenceReport(result, {businessId: 'qa-shop'});
  assert.equal(report.findings.length, result.findings.length);
  assert.doesNotMatch(JSON.stringify(report), /Cliente Fictício/);
});

test('o classificador é somente leitura: não tem acesso a fila, banco ou rede', () => {
  const source = fs.readFileSync('js/sync-findings.js', 'utf8');
  assert.doesNotMatch(source, /localStorage|indexedDB|fetch\(|FirebaseCallable|saveQueue|DB\.|setItem/);
});
