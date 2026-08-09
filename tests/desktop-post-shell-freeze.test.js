const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const sync = fs.readFileSync("js/firebase/sync.js", "utf8");
const auth = fs.readFileSync("js/firebase/auth.js", "utf8");
const app = fs.readFileSync("js/app.js", "utf8");
const dashboard = fs.readFileSync("js/desktop-dashboard.js", "utf8");
const diagnostics = fs.readFileSync("js/runtime-diagnostics.js", "utf8");
const index = fs.readFileSync("index.html", "utf8");
const worker = fs.readFileSync("service-worker.js", "utf8");

test("bootstrap e renderização publicam os contadores de diagnóstico solicitados", () => {
  assert.match(auth, /count\?\.\('bootstrapCount'/);
  assert.match(sync, /count\?\.\("initialSyncCount"\)/);
  assert.match(sync, /count\?\.\("hydrateCount"/);
  assert.match(dashboard, /count\?\.\("dashboardRenderCount"\)/);
  assert.match(app, /count\?\.\("routeRenderCount"/);
  assert.match(app, /count\?\.\("dataChangedCount"/);
  assert.match(diagnostics, /new PerformanceObserver/);
  assert.match(diagnostics, /type: "longtask"/);
});

test("sync automático não faz varredura completa de todas as coleções", () => {
  const constants = sync.slice(
    sync.indexOf("const DEFAULT_PULL_NAMES"),
    sync.indexOf("const AUDIT_NAMES"),
  );
  assert.match(constants, /"clients"/);
  assert.match(constants, /"sales"/);
  assert.match(constants, /"payments"/);
  assert.doesNotMatch(constants, /CLOUD_NAMES\.filter/);
  assert.match(sync, /full \|\| INITIAL_FULL_NAMES\.has\(name\)/);
  assert.match(sync, /repositories\[name\]\.listRecent\(/);
  assert.match(sync, /INITIAL_RECENT_LIMITS\[name\] \|\| 100/);
  assert.match(sync, /full \? CLOUD_NAMES : DEFAULT_PULL_NAMES/);
  assert.match(sync, /if \(automaticSyncPromise\) return automaticSyncPromise/);
  assert.match(sync, /automaticSyncPromise = runAutomaticSync\(\)\.finally/);
});

test("sincronização completa permanece disponível apenas em ações explícitas", () => {
  assert.match(sync, /pullCloudCollections\(\{ force: true, full: true \}\)/);
  assert.match(sync, /repositories\[name\]\.listAllPaged\(200\)/);
  assert.match(sync, /async function synchronizeNow\(\)/);
});

test("diagnóstico é carregado antes do app e cache PWA publica a correção", () => {
  assert.ok(
    index.indexOf("runtime-diagnostics.js") < index.indexOf("app.js?v=82"),
  );
  assert.match(index, /lifecycle-manager\.js\?v=83/);
  assert.match(worker, /adi-festa-v84-client-filter-all/);
  assert.match(worker, /runtime-diagnostics\.js/);
  assert.match(worker, /lifecycle-manager\.js/);
});
