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

test("snapshot completo torna a nuvem canonica sem apagar pendencias", () => {
  assert.match(sync, /authoritative = false/);
  assert.match(sync, /pending\.has\(id\) \|\| cloudIds\.has\(id\)/);
  assert.match(sync, /authoritative: !since/);
  assert.match(sync, /authoritative: mode === "all"/);
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
