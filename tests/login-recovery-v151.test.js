const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const read = (file) => fs.readFileSync(file, "utf8");
const auth = read("js/firebase/auth.js");
const config = read("js/firebase/firebase-config.js");
const team = read("js/firebase/team-service.js");
const backend = read("functions/src/services/team-access-service.js");
const rules = read("firestore.rules");

test("bootstrap valida o vínculo antes de depender da leitura protegida da empresa", () => {
  const core = auth.slice(auth.indexOf("async function bootstrapCore"), auth.indexOf("function handleBootstrapError"));
  assert.ok(core.indexOf("ensureCurrentMembership") < core.indexOf("businessSnapshot=await getDoc"));
  assert.match(core, /membership validation started/);
  assert.match(core, /membership validated/);
});

test("estados de autenticação, acesso e rede são distintos e preservam a sessão", () => {
  for (const state of ["authenticated", "bootstrapping", "authorized", "network_error", "membership_missing", "access_disabled", "access_denied"])
    assert.match(auth, new RegExp(`['\"]${state}['\"]`));
  assert.match(auth, /Sua sessão continua autenticada/);
  assert.doesNotMatch(team, /bootstrapLogout|signOut\(/);
  assert.match(auth, /handleMembershipChange/);
  assert.match(auth, /explicit sign-out/);
});

test("observador diferencia desativação, ausência, mudança de permissão e falha transitória", () => {
  assert.match(team, /kind: "access-disabled"/);
  assert.match(team, /kind: "membership-missing"/);
  assert.match(team, /kind: "permissions-changed"/);
  assert.match(team, /"network-error"/);
  assert.match(team, /Object\.entries\(value\.permissions \|\| \{\}\)\.sort/);
});

test("observador não revoga owner ativo por ordem diferente do mapa de permissões", () => {
  let next, fail;
  const current = { uid: "owner", role: "owner", status: "active", spaceAccess: "all", allowedSpaceIds: [], permissions: { "team.view": true, "sales.create": true } };
  const sandbox = {
    window: null, auth: { currentUser: { uid: "owner" } }, db: {},
    doc: (...segments) => segments.join("/"), collection: () => ({}), getDocs: async () => ({ docs: [] }), orderBy: () => ({}), query: () => ({}),
    normalizeFirestoreData: (value) => value,
    onSnapshot: (_ref, onNext, onError) => { next = onNext; fail = onError; return () => {}; },
    addEventListener: () => {}, console,
    BusinessContext: { get: () => ({ businessId: "adi-festa", member: current }) },
    FirebaseSession: { businessId: "adi-festa" }, TeamAccess: { has: () => true },
  };
  sandbox.window = sandbox;
  const source = team.replace(/^import .*$/gm, "").replace(/^export \{.*$/gm, "") + "\nwindow.__watch=watchCurrentMember;";
  vm.runInNewContext(source, sandbox);
  const events = [];
  sandbox.__watch((event) => events.push(event));
  next({ exists: () => true, data: () => ({ ...current, permissions: { "sales.create": true, "team.view": true } }), metadata: { fromCache: false } });
  assert.deepEqual(events, []);
  next({ exists: () => true, data: () => ({ ...current, status: "disabled" }), metadata: { fromCache: false } });
  assert.equal(events.at(-1).kind, "access-disabled");
  fail({ code: "unavailable" });
  assert.equal(events.at(-1).kind, "network-error");
});

test("persistência local termina antes de registrar o observador de Auth", () => {
  assert.match(config, /authPersistenceReady=setPersistence\(auth,browserLocalPersistence\)/);
  assert.match(auth, /Promise\.resolve\(window\.FirebaseAuthPersistenceReady\)\.then\(observeAuthState,observeAuthState\)/);
});

test("recuperação do owner exige evidência forte, é idempotente e auditável", () => {
  assert.match(backend, /company\.ownerId===uid/);
  assert.match(backend, /email\(profile\.email\)===email\(request\.auth\.token\?\.email\)/);
  assert.match(backend, /owner_membership_recovered/);
  assert.match(backend, /owner_membership_evidence_recorded/);
  assert.match(backend, /membership-missing/);
  assert.match(backend, /access-disabled/);
  assert.match(rules, /signedIn\(\) && request\.auth\.uid == memberUid/);
});
