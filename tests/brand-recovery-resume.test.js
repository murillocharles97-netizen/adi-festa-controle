'use strict';
// V242.7 Marca: recuperação offline interrompida entre gravar o registro brand_recovery e concluir a cópia local.
// Executa o código real de sync.js (readRecoveryResolution, classifyQueueOperation, confirmBrandRecovery). Dados fictícios.
const test = require('node:test'), assert = require('node:assert/strict'), fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '..', 'js/firebase/sync.js'), 'utf8').replace(/\r\n/g, '\n');
const fn = (start) => { const i = source.indexOf(start); assert.ok(i >= 0, start); return source.slice(i, source.indexOf('\n}\n', i) + 3); };
const span = (a, b) => source.slice(source.indexOf(a), source.indexOf(b, source.indexOf(a)));

const item = (id, extra = {}) => ({ queueId: 'q-' + id, operationId: id, businessId: 'empresa-a', userId: 'u1', workspaceGeneration: 0, status: 'error', syncProtocolVersion: 1,
  lastErrorCode: 'failed-precondition', lastErrorMessage: 'Esta empresa exige Marca ao cadastrar produtos.', lastAttemptAt: '2026-01-01T00:00:00.000Z',
  payload: { writes: [{ entityType: 'products', entityId: 'p-' + id, operation: 'create', data: { nome: 'Fictício ' + id } }] }, ...extra });

function harness({ storage = new Map(), queue, crashOnApply = false, receipt = 'applied', uid = 'u1' } = {}) {
  const log = { receipts: [], commits: 0, saves: 0, applied: [], flush: 0 };
  const products = new Map(queue.flatMap((q) => q.payload.writes.map((w) => [w.entityId, { ...w.data, marca: 'Marca Fictícia' }])));
  const c = {
    JSON, Array, Boolean, Number, String, Error, Object, Promise, encodeURIComponent, structuredClone,
    navigator: { onLine: true }, syncSessionGeneration: 1, currentUser: { uid }, auth: { currentUser: { uid } },
    DB: { getWorkspaceGeneration: () => 0, flush: async () => { log.flush++; } },
    localStorage: { getItem: (k) => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, String(v)), removeItem: (k) => storage.delete(k) },
    queueKey: () => 'fila:empresa-a:u1', activeBusinessId: () => 'empresa-a', readQueue: () => queue, readQueueStrict: () => queue,
    saveQueue: () => { log.saves++; }, updateQueueState: () => {}, validateUser: async () => {}, now: () => '2026-11-23T00:00:00.000Z',
    checksumValue: (x) => JSON.stringify(x), readPaymentRecoveryReceipt: () => null, readQueueArchive: () => null,
    queueManualReviewReason: () => '', queueQuarantineReason: () => '', isHistoricalProjectionBatch: () => false, monetaryRecoveryRequired: () => false, rejectedProductStockUpdate: () => false, favoriteWriteWasRejected: () => false,
    readQueuedOperationStatus: async (q, { held }) => { log.receipts.push(q.operationId); assert.equal(held, true);
      return { status: receipt, payloadHash: 'a'.repeat(64), assertOriginal: () => {} }; },
    db: {}, doc: (_db, ...p) => p.join('/'),
    getDocFromServer: async (p) => { const id = p.split('/').at(-1); return { id, exists: () => products.has(id), data: () => products.get(id) }; },
    applyCloudCollection: (name, docs) => { if (crashOnApply) throw Error('aplicativo interrompido'); log.applied.push(...docs.map((d) => d.id)); },
    window: { FirebaseCallable: async () => { log.commits++; } },
  };
  vm.createContext(c);
  vm.runInContext(span('function recoveryResolutionKey(', 'async function refreshRecoveryResolutions('), c);
  vm.runInContext(fn('function classifyQueueOperation('), c);
  vm.runInContext(fn('function pendingIds('), c);
  vm.runInContext(span('function brandRecoveryQueue(', 'async function archiveQuarantinedOperation('), c);
  return { c, log, storage, queue };
}

test('B3: interrupção exatamente entre gravar brand_recovery e concluir localmente → reabre como resolvida e retoma só esta operação', async () => {
  const queue = [item('op-alvo'), item('op-outra'), item('op-venda', { lastErrorMessage: 'Estoque insuficiente' })];
  const before = JSON.stringify(queue);
  const a = harness({ queue, crashOnApply: true });
  await assert.rejects(a.c.confirmBrandRecovery('op-alvo'), /interrompido/);
  assert.equal(a.log.saves, 0, 'o pacote original não é descartado');
  assert.equal(JSON.stringify(queue), before, 'fila byte a byte intacta');
  const record = JSON.parse(a.storage.get(a.c.recoveryResolutionKey(queue[0])));
  assert.deepEqual([record.channel, record.status, record.receiptStatus, record.operationId, record.businessId, record.actorUid], ['brand_recovery', 'applied', 'applied', 'op-alvo', 'empresa-a', 'u1']);

  // Reabertura: mesmo armazenamento, nova instância.
  const b = harness({ queue, storage: a.storage });
  const cls = b.c.classifyQueueOperation(queue[0]);
  assert.equal(cls.category, 'resolved', 'registro brand_recovery reconhecido (não é "evidência inválida")');
  assert.equal(cls.replayBlocked, true, 'nunca reenviado');
  assert.notEqual(cls.reviewReason, 'recovery_evidence_invalid');
  assert.deepEqual(b.c.brandRecoveryQueue().map((q) => q.operationId), ['op-outra'], 'a operação resolvida sai da lista de recuperação');
  assert.deepEqual(b.c.brandRecoveryResolved().map((q) => q.operationId), ['op-alvo']);
  const out = await b.c.confirmBrandRecovery('op-alvo');
  assert.deepEqual([out.status, out.resumed], ['applied', true]);
  assert.deepEqual(b.log.receipts, ['op-alvo'], 'confere só o recibo desta operação');
  assert.deepEqual(b.log.applied, ['p-op-alvo'], 'conclui só a cópia local deste produto');
  assert.equal(b.log.commits + b.log.saves, 0, 'nenhum envio, nenhuma alteração da fila');
  assert.equal(JSON.stringify(queue), before, 'demais operações (pendentes e bloqueadas) intactas');
  assert.equal(b.storage.get(b.c.recoveryResolutionKey(queue[0])), a.storage.get(a.c.recoveryResolutionKey(queue[0])), 'registro original preservado');

  // Retentativa: idempotente, sem novo registro nem envio.
  const again = await b.c.confirmBrandRecovery('op-alvo');
  assert.equal(again.status, 'applied'); assert.equal(b.log.commits, 0); assert.equal(b.storage.size, 1);
});

test('V242.7 final: recibo confirma o cadastro, mas há edição local pendente do mesmo produto → não anuncia cópia local atualizada', async () => {
  const edit = { queueId: 'q-edit', operationId: 'op-edit', businessId: 'empresa-a', userId: 'u1', workspaceGeneration: 0, status: 'pending', syncProtocolVersion: 1,
    payload: { writes: [{ entityType: 'products', entityId: 'p-op-alvo', operation: 'update', data: { nome: 'Editado neste aparelho' } }] } };
  const queue = [item('op-alvo'), edit, item('op-outra')];
  const before = JSON.stringify(queue);
  const h = harness({ queue });
  const out = await h.c.confirmBrandRecovery('op-alvo');
  assert.equal(out.status, 'applied', 'cadastro confirmado na nuvem pelo recibo');
  assert.equal(out.localUpdated, false, 'a cópia local NÃO foi atualizada');
  assert.deepEqual(out.localPending, ['p-op-alvo']);
  assert.deepEqual(h.log.applied, [], 'produto com edição pendente não é sobrescrito pela nuvem');
  assert.equal(h.log.commits + h.log.saves, 0, 'nada enviado, fila não alterada');
  assert.equal(JSON.stringify(queue), before, 'edição pendente e demais operações preservadas byte a byte');
  const record = JSON.parse(h.storage.get(h.c.recoveryResolutionKey(queue[0])));
  assert.equal(record.channel, 'brand_recovery', 'recibo e histórico preservados');
  const again = await h.c.confirmBrandRecovery('op-alvo');
  assert.deepEqual([again.status, again.resumed, again.localUpdated], ['applied', true, false], 'retomada continua honesta, sem reenvio');
  assert.equal(h.log.commits, 0); assert.equal(h.storage.size, 1);
  const clean = harness({ queue: [item('op-alvo')] });
  const ok = await clean.c.confirmBrandRecovery('op-alvo');
  assert.deepEqual([ok.localUpdated, ok.localPending, clean.log.applied], [true, [], ['p-op-alvo']], 'sem edição pendente: cópia local atualizada');
});

test('B3: recibo da retomada ainda não conferível → pendente, nada alterado', async () => {
  const queue = [item('op-alvo')];
  const a = harness({ queue, crashOnApply: true });
  await assert.rejects(a.c.confirmBrandRecovery('op-alvo'));
  const b = harness({ queue, storage: a.storage, receipt: 'absent' });
  assert.equal((await b.c.confirmBrandRecovery('op-alvo')).status, 'pending');
  assert.equal(b.log.applied.length + b.log.commits + b.log.saves, 0);
});

test('B3: validação estrita do registro brand_recovery (outra conta, empresa, geração, conteúdo ou produtos → inválido, falha fechada)', async () => {
  const queue = [item('op-alvo')];
  const a = harness({ queue, crashOnApply: true });
  await assert.rejects(a.c.confirmBrandRecovery('op-alvo'));
  const key = a.c.recoveryResolutionKey(queue[0]), good = JSON.parse(a.storage.get(key));
  for (const bad of [{ actorUid: 'outra' }, { businessId: 'empresa-b' }, { workspaceGeneration: 1 }, { operationId: 'op-x' }, { payloadChecksum: 'x' },
    { productIds: ['p-outro'] }, { payloadHash: 'curto' }, { receiptStatus: undefined }, { status: 'pending' }, { version: 2 }]) {
    const storage = new Map([[key, JSON.stringify({ ...good, ...bad })]]);
    const h = harness({ queue, storage });
    assert.equal(h.c.readRecoveryResolution(queue[0]), null, JSON.stringify(bad));
    assert.equal(h.c.classifyQueueOperation(queue[0]).reviewReason, 'recovery_evidence_invalid', 'continua bloqueada para revisão');
    assert.equal((await h.c.confirmBrandRecovery('op-alvo')).status, 'not_pending', 'sem retomada nem envio');
    assert.equal(h.log.commits + h.log.receipts.length, 0);
  }
  const changed = [{ ...queue[0], payload: { writes: [{ ...queue[0].payload.writes[0], data: { nome: 'alterado' } }] } }];
  assert.equal(harness({ queue: changed, storage: a.storage }).c.readRecoveryResolution(changed[0]), null, 'pacote alterado invalida o registro');
});

test('B3: os demais tipos de resolução continuam com a validação própria', () => {
  const queue = [item('op-alvo')];
  const h = harness({ queue });
  h.storage.set(h.c.recoveryResolutionKey(queue[0]), JSON.stringify({ channel: 'queued_sale_receipt', status: 'applied', verifiedAt: 'x', payloadHash: 'a'.repeat(64), payloadChecksum: h.c.checksumValue(queue[0].payload), operationId: 'op-alvo', businessId: 'empresa-a', actorUid: 'u1', workspaceGeneration: 0 }));
  assert.equal(h.c.readRecoveryResolution(queue[0]), null, 'canal de venda continua exigindo a venda');
  assert.match(source, /if\(value\.channel==='queued_sale_receipt'\)return value\.status==='applied'/);
  assert.match(source, /resolution\?\.channel!=='brand_recovery'/, 'produto resolvido deixa de proteger a cópia local contra a nuvem');
});
