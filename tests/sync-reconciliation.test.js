const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const sync = fs.readFileSync("js/firebase/sync.js", "utf8");
const desktop = fs.readFileSync("js/desktop-settings.js", "utf8");
const mobile = fs.readFileSync("js/configuracoes-mobile.js", "utf8");
const ui = fs.readFileSync("js/firebase/firebase-ui.js", "utf8");

test("sucesso só é emitido após fila vazia, pull completo e comparação", () => {
  assert.match(sync, /counts\.total === 0 && counts\.errors === 0 && comparison\.ok/);
  assert.match(sync, /pullCloudCollections\(\{ force: true, full: true \}\)/);
  assert.match(sync, /status: complete \? "success" : "error"/);
  assert.match(sync, /localStorage\.setItem\(lastCompleteKey\(\), time\)/);
  assert.match(desktop, /SyncFirebase\.describeResult/);
  assert.match(mobile, /SyncFirebase\.describeResult/);
  assert.match(ui, /SyncFirebase\.describeResult/);
});

test("fila incompatível é preservada, diagnosticada e nunca descartada", () => {
  assert.match(sync, /legacyBackup/);
  assert.match(sync, /compatBackup/);
  assert.match(sync, /legacy-payload-unsupported/);
  assert.match(sync, /queue-owner-mismatch/);
  assert.doesNotMatch(sync, /archiveQueue\("queue_owner_mismatch"\)/);
  assert.match(ui, /Erros recentes/);
  assert.match(ui, /Reprocessar todos/);
});

test("clientes, produtos e configurações compartilham listeners centrais", () => {
  assert.match(sync, /listenerRegistry\s*=\s*new Map/);
  assert.match(sync, /registerRealtimeCollection\("clients"\)/);
  assert.match(sync, /registerRealtimeCollection\("products"\)/);
  assert.match(sync, /registerRealtimeCollection\("settings", "document"\)/);
  assert.match(sync, /listenerRegistry\.clear\(\)/);
  assert.doesNotMatch(sync, /setInterval\(/);
});

test("variações removem campos legados e saldo usa operação transacional", () => {
  assert.match(sync, /const allowed = new Set\(\[/);
  assert.match(sync, /if \(!allowed\.has\(key\)\) delete clean\[key\]/);
  assert.match(sync, /"balance_adjustment"/);
  assert.match(sync, /processedOperations/);
});

test("snapshot completo preserva registros locais ausentes até auditoria", () => {
  assert.match(sync, /authoritative = false/);
  assert.match(sync, /Ausência na nuvem não é tombstone/);
  assert.doesNotMatch(sync, /if \(!representedByCloud\) byId\.delete\(id\)/);
  assert.match(sync, /authoritative: !since/);
  assert.match(sync, /authoritative: mode === "all"/);
});

test("snapshot oficial atualiza valores remotos sem apagar campos legados", () => {
  assert.match(sync, /if \(authoritative\) \{/);
  assert.match(sync, /byId\.set\(id, \{ \.\.\.existing, \.\.\.item, id \}\)/);
  assert.match(sync, /if \(authoritative \|\| remoteTime >= localTime\)/);
  assert.match(sync, /if \(pending\.has\(id\)\) continue/);
});

test("fila legada recebe operationId estável, metadados e preflight", () => {
  assert.match(sync, /stableLegacyOperationId/);
  assert.match(sync, /copy\.operationId = stableLegacyOperationId\(copy\)/);
  assert.match(sync, /copy\.idempotencyKey = copy\.operationId/);
  assert.match(sync, /clean\.operationId \|\|= copy\.operationId/);
  assert.match(sync, /queuePreflight/);
  assert.match(sync, /IDEMPOTENT_EVENT_NAMES/);
});

test("cloudPayload é sanitizado depois de preencher operationId e idempotência", () => {
  assert.match(sync, /clean\.operationId \|\|= String\(id\)/);
  assert.match(sync, /clean\.idempotencyKey \|\|= clean\.operationId/);
  assert.match(sync, /return sanitizeForFirestore\(\{/);
  assert.match(sync, /status: "recovered_existing"/);
});

test("auditoria compara IDs, checksums e movimentos por operationId", () => {
  assert.match(sync, /compareDeviceWithCloud/);
  assert.match(sync, /checksumValue/);
  assert.match(sync, /FINANCIAL_AUDIT_NAMES\.has\(name\)/);
  assert.match(sync, /classification: "E"/);
  assert.match(sync, /recovery_local_orphan/);
  assert.match(sync, /recoverMissingNonFinancial/);
  assert.match(sync, /recoverMissingFinancialMovements/);
  assert.match(sync, /existingOperationIds\.has\(id\)/);
});

test("venda fiado confirma movimento, saldo e marcador na mesma transação", () => {
  assert.match(sync, /financialEffectFromWrites/);
  assert.match(sync, /"balanceEvents"/);
  assert.match(sync, /type = "credit_sale"/);
  assert.match(sync, /financialAppliedAt: serverTimestamp\(\)/);
  assert.match(sync, /financialOperationId: financialEffect\.id/);
  assert.match(sync, /financial-composite-incomplete/);
  assert.match(sync, /financial-reconciliation-required/);
});

test("reconciliação financeira usa cadeia de movimentos e prévia idempotente", () => {
  assert.match(sync, /buildFinancialBalanceAudit/);
  assert.match(sync, /safe_missing_effects/);
  assert.match(sync, /financial-preview-stale/);
  assert.match(sync, /reconcileFinancialBalances/);
  assert.match(sync, /balance_reconciliation/);
  assert.match(ui, /Reconciliar saldos/);
  assert.match(ui, /Aplicar somente as correções seguras/);
});

test("diagnóstico exportável omite payload e dados pessoais integrais", () => {
  assert.match(sync, /exportLocalDiagnostic/);
  assert.match(sync, /indexedDbInventory/);
  assert.match(sync, /payloadChecksum: checksumValue/);
  assert.match(sync, /invalidPayload: containsInvalidFirestoreValue/);
  assert.doesNotMatch(sync, /queue: queue\.map\(.*payload:/s);
  assert.match(ui, /Exportar diagnóstico/);
  assert.match(ui, /Comparar com a nuvem/);
  assert.match(ui, /Recuperar dados locais ausentes/);
  assert.match(ui, /Atualizar deste servidor/);
});
