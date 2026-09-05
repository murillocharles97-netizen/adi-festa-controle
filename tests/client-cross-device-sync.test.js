const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const syncSource = fs.readFileSync("js/firebase/sync.js", "utf8");
const repositorySource = fs.readFileSync(
  "js/firebase/firestore-repository.js",
  "utf8",
);
const authSource = fs.readFileSync("js/firebase/auth.js", "utf8");
const firebaseUiSource = fs.readFileSync("js/firebase/firebase-ui.js", "utf8");
const indexSource = fs.readFileSync("index.html", "utf8");
const serviceWorkerSource = fs.readFileSync("service-worker.js", "utf8");

function extractFunction(source, name) {
  const start = source.indexOf(`function ${name}(`);
  assert.notEqual(start, -1, `função ${name} não encontrada`);
  const bodyStart = source.indexOf("{", start);
  let depth = 0;
  for (let index = bodyStart; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}") depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`função ${name} sem fechamento`);
}

function reconcile(local, cloud, options = {}) {
  const context = {
    structuredClone,
    Date,
    Map,
    Set,
    normalizeFirestoreData: (value) => structuredClone(value),
    pendingIds: () => new Set(),
  };
  vm.createContext(context);
  vm.runInContext(
    `${extractFunction(syncSource, "cleanCloudItem")};\n` +
      `${extractFunction(syncSource, "reconcileLocalAndCloud")};\n` +
      "globalThis.result = reconcileLocalAndCloud(\"clients\", local, cloud, pending, authoritative);",
    Object.assign(context, {
      local: structuredClone(local),
      cloud: structuredClone(cloud),
      pending: new Set(options.pending || []),
      authoritative: Boolean(options.authoritative),
    }),
  );
  return structuredClone(context.result);
}

test("servidor mais recente vence cache local mais completo para o mesmo ID", () => {
  const id = "553cd4b2-e4c9-4b1a-96f5-fafe162f1213";
  const [client] = reconcile(
    [
      {
        id,
        nome: "Vitor skechers",
        saldo: 0,
        totalComprado: 25,
        quantidadeVendas: 1,
        observacoes: "campo legado preservado",
        atualizadoEm: "2026-08-06T16:33:38.552Z",
      },
    ],
    [
      {
        id,
        nome: "Vitor skechers",
        saldo: -84,
        totalComprado: 109,
        quantidadeVendas: 5,
        updatedAt: "2026-08-17T23:59:00.000Z",
      },
    ],
  );
  assert.equal(client.saldo, -84);
  assert.equal(client.totalComprado, 109);
  assert.equal(client.quantidadeVendas, 5);
  assert.equal(client.observacoes, "campo legado preservado");
});

test("operação local ainda na fila não é sobrescrita pelo pull", () => {
  const [client] = reconcile(
    [
      {
        id: "client-1",
        nome: "Nome editado offline",
        saldo: -30,
        atualizadoEm: "2026-08-18T00:00:00.000Z",
      },
    ],
    [
      {
        id: "client-1",
        nome: "Nome anterior",
        saldo: -50,
        updatedAt: "2026-08-18T00:01:00.000Z",
      },
    ],
    { pending: ["client-1"] },
  );
  assert.equal(client.nome, "Nome editado offline");
  assert.equal(client.saldo, -30);
});

test("leitura do servidor corrige cursor ou relógio local adiantado", () => {
  const [client] = reconcile(
    [
      {
        id: "client-1",
        nome: "Cache antigo",
        saldo: 0,
        atualizadoEm: "2099-01-01T00:00:00.000Z",
      },
    ],
    [
      {
        id: "client-1",
        nome: "Servidor oficial",
        saldo: -84,
        updatedAt: "2026-08-17T23:59:00.000Z",
      },
    ],
  );
  assert.equal(client.nome, "Servidor oficial");
  assert.equal(client.saldo, -84);
});

test("dois dispositivos convergem após edição, venda, pagamento, ajuste e cancelamento", () => {
  let server = {
    id: "client-1",
    nome: "Vitor Kings",
    saldo: 0,
    updatedAt: "2026-08-17T20:00:00.000Z",
  };
  let mobile = reconcile([], [server], { authoritative: true });
  let desktop = reconcile([], [server], { authoritative: true });

  server = {
    ...server,
    nome: "Vitor Skechers",
    updatedAt: "2026-08-17T20:01:00.000Z",
  };
  desktop = reconcile(desktop, [server]);
  assert.equal(desktop[0].nome, "Vitor Skechers");

  server = { ...server, saldo: -50, updatedAt: "2026-08-17T20:02:00.000Z" };
  mobile = reconcile(mobile, [server]);
  assert.equal(mobile[0].saldo, -50);

  server = { ...server, saldo: -30, updatedAt: "2026-08-17T20:03:00.000Z" };
  desktop = reconcile(desktop, [server]);
  assert.equal(desktop[0].saldo, -30);

  server = { ...server, saldo: -40, updatedAt: "2026-08-17T20:04:00.000Z" };
  mobile = reconcile(mobile, [server]);
  server = { ...server, saldo: -30, updatedAt: "2026-08-17T20:05:00.000Z" };
  mobile = reconcile(mobile, [server]);
  desktop = reconcile(desktop, [server]);

  assert.deepEqual(
    { nome: mobile[0].nome, saldo: mobile[0].saldo },
    { nome: "Vitor Skechers", saldo: -30 },
  );
  assert.deepEqual(
    { nome: desktop[0].nome, saldo: desktop[0].saldo },
    { nome: "Vitor Skechers", saldo: -30 },
  );
});

test("cadeia financeira real de Vitor reconstrói dívida de R$ 84", () => {
  const events = [111.5, -26, -12, -34, -12];
  const result = events.reduce(
    (balance, amount) => Number((balance + amount).toFixed(2)),
    -111.5,
  );
  assert.equal(result, -84);
});

test("leituras de projeção são do servidor, verificadas e limitadas por época/TTL", () => {
  assert.match(repositorySource, /getDocsFromServer/);
  assert.match(repositorySource, /getCountFromServer/);
  assert.match(repositorySource, /fromCache: false/);
  assert.match(syncSource, /CLIENT_PROJECTION_EPOCH = 2/);
  assert.match(syncSource, /CLIENT_PROJECTION_CHECK_TTL_MS = 24 \* 60 \* 60 \* 1000/);
  assert.match(syncSource, /projectionExpectedLocalCount/);
  assert.match(syncSource, /localClients\.length < expectedLocalCount/);
  assert.match(syncSource, /document\.visibilityState === "visible"[\s\S]*ensureClientProjection/);
  assert.doesNotMatch(syncSource, /setInterval\([^)]*ensureClientProjection/);
});

test("a cadeia de módulos mantém versões explícitas na release 119", () => {
  assert.match(authSource, /import ['"]\.\/sync\.js\?v=108['"]/);
  assert.match(authSource, /from ['"]\.\/business-context\.js\?v=115['"]/);
  assert.match(firebaseUiSource, /import ['"]\.\/sync\.js\?v=108['"]/);
  assert.match(
    syncSource,
    /from ['"]\.\/firestore-repository\.js\?v=100['"]/,
  );
  assert.match(
    indexSource,
    /js\/firebase\/auth\.js\?v=115[\s\S]*js\/firebase\/firebase-ui\.js\?v=108/,
  );
  assert.match(indexSource, /financial-concurrency\.js\?v=108/);
  assert.match(serviceWorkerSource, /adi-festa-v119-financial-account-actions-period/);
  assert.doesNotMatch(
    `${authSource}\n${firebaseUiSource}\n${syncSource}`,
    /(?:sync|firestore-repository)\.js\?v=(?:62|83)/,
  );
});
