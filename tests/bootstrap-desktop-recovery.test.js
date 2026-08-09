const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const auth = fs.readFileSync("js/firebase/auth.js", "utf8");
const app = fs.readFileSync("js/app.js", "utf8");
const storage = fs.readFileSync("js/storage.js", "utf8");
const sync = fs.readFileSync("js/firebase/sync.js", "utf8");

test("bootstrap é single-flight, tem timeout e encerra o loading", () => {
  assert.match(auth, /if\(bootstrapRun\?\.uid===user\.uid\)return bootstrapRun\.promise/);
  assert.match(auth, /BOOTSTRAP_TIMEOUT_MS=15000/);
  assert.match(auth, /\.finally\(\(\)=>\{/);
  assert.match(auth, /document\.querySelector\('\.auth-loading'\)\?\.classList\.remove/);
});

test("interface pesada é montada depois de liberar a tela de validação", () => {
  const allowed = auth.slice(
    auth.indexOf("function allowed"),
    auth.indexOf("async function updateBusinessDetails"),
  );
  const hideGate = allowed.indexOf("gate.hidden=true");
  const deferredReady = allowed.indexOf("setTimeout(()=>{");
  const readyEvent = allowed.indexOf("new CustomEvent('firebase-auth-ready'");
  assert.ok(hideGate >= 0);
  assert.ok(deferredReady > hideGate);
  assert.ok(readyEvent > deferredReady);
  assert.match(auth, /\[BOOT\] \$\{message\} \+\$\{elapsedMs\}ms/);
  assert.match(auth, /firebase-ui-mounted/);
});

test("falha de montagem oferece retry e logout sem perder a sessão", () => {
  assert.match(app, /function showAppMountError\(error\)/);
  assert.match(app, /data-retry-app-mount/);
  assert.match(app, /data-logout-app-mount/);
  assert.match(app, /FirebaseAuthActions\?\.signOut/);
});

test("leituras locais não migram nem gravam toda a base repetidamente", () => {
  const loadFunction = storage.slice(
    storage.indexOf("const carregar="),
    storage.indexOf("const useBusiness="),
  );
  assert.match(storage, /memoryData&&memoryStorageKey===key/);
  assert.match(storage, /if\(!bruto\|\|versaoAnterior<VERSAO\)localStorage\.setItem/);
  assert.doesNotMatch(loadFunction, /return salvar\(dados\)/);
});

test("pull inicial aplica coleções em um único lote local", () => {
  assert.match(sync, /function applyCloudCollectionBatch\(entries\)/);
  assert.match(sync, /pendingApplications\.push\(/);
  assert.match(sync, /received = applyCloudCollectionBatch\(pendingApplications\)/);
});
