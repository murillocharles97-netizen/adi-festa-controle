const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/app-intro-tutorial.js", "utf8");
function fixture({ version = 1, online = true, profileDate = "2026-09-15T00:00:00Z", authDate = "2026-09-15T00:00:00Z", uid = "person-1", remote = 0 } = {}) {
  const values = new Map();
  const listeners = new Map();
  const writes = [];
  const session = { user: { uid, metadata: { creationTime: authDate } }, profile: { createdAt: profileDate, tutorialVersions: { appIntro: remote } } };
  let registered;
  let opened = 0;
  const window = {
    FirebaseSession: session,
    FirebaseAuthActions: { updateTutorialVersion: async (id, value) => { writes.push([id, value]); session.profile.tutorialVersions[id] = value; } },
    VeconiTutorialManager: { register: (tutorial) => { registered = tutorial; }, open: () => { opened++; return true; }, close: () => {} },
  };
  const context = {
    window, navigator: { onLine: online }, localStorage: { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value) },
    document: { querySelector: (selector) => selector === "#auth-gate" ? { hidden: true } : selector === "#app" ? { children: [{}] } : selector === "#modal" ? { children: [] } : null },
    addEventListener: (name, callback) => listeners.set(name, callback), setTimeout: (callback) => callback(), matchMedia: () => ({ matches: true }), console,
  };
  vm.runInNewContext(source.replace("const VERSION = 1;", `const VERSION = ${version};`), context);
  return { window, context, session, listeners, writes, values, tutorial: registered, opened: () => opened };
}

test("apresenta automaticamente apenas usuário novo com datas confiáveis", () => {
  const fresh = fixture();
  assert.equal(fresh.window.VeconiAppIntro.eligible(fresh.session), true);
  fresh.listeners.get("firebase-ui-mounted")();
  assert.equal(fresh.opened(), 1);
  for (const options of [{ profileDate: "2026-09-13T00:00:00Z" }, { authDate: "2026-09-13T00:00:00Z" }, { profileDate: null }, { authDate: null }]) {
    const old = fixture(options);
    old.listeners.get("firebase-ui-mounted")();
    assert.equal(old.opened(), 0);
    assert.equal(old.window.VeconiAppIntro.open({ manual: true }), true);
  }
});

test("pular e finalizar persistem por uid, permitem reabertura e respeitam versão", async () => {
  const state = fixture();
  state.tutorial.onSkip();
  await Promise.resolve();
  assert.equal(state.window.VeconiAppIntro.getStoredVersion("person-1"), 1);
  assert.equal(state.writes.length, 1);
  assert.equal(state.window.VeconiAppIntro.eligible(state.session), false);
  assert.equal(state.window.VeconiAppIntro.open({ manual: true }), true);
  const reload = fixture({ remote: 1 });
  assert.equal(reload.window.VeconiAppIntro.eligible(reload.session), false);
  const upgraded = fixture({ version: 2, remote: 1 });
  assert.equal(upgraded.window.VeconiAppIntro.eligible(upgraded.session), true);
  upgraded.tutorial.onComplete();
  assert.equal(upgraded.window.VeconiAppIntro.getStoredVersion("person-1"), 2);
});

test("offline salva localmente e sincroniza no evento online sem nova leitura", async () => {
  const state = fixture({ online: false });
  state.tutorial.onComplete();
  assert.equal(state.window.VeconiAppIntro.getStoredVersion("person-1"), 1);
  assert.equal(state.writes.length, 0);
  state.context.navigator.onLine = true;
  state.listeners.get("online")();
  await Promise.resolve();
  assert.equal(state.writes.length, 1);
  assert.equal(state.writes[0][0], "appIntro");
  assert.doesNotMatch(source, /\b(?:getDoc|getDocs|onSnapshot)\s*\(/);
});

test("definição mantém passos curtos e targets estáveis", () => {
  const state = fixture();
  assert.deepEqual(Array.from(state.tutorial.steps, step => step.id), ["welcome", "main-menu", "daily-navigation", "module-guides", "complete"]);
  assert.deepEqual(Array.from(state.tutorial.steps[1].target()), ["main-menu", "sidebar-navigation"]);
  assert.equal(state.tutorial.steps[2].target, "bottom-navigation");
  const financialMarkup = fs.readFileSync("js/financial-ui.js", "utf8");
  for (const target of ["finance-summary", "financial-spaces", "financial-accounts", "financial-add"]) {
    assert.match(financialMarkup, new RegExp(`data-tour="${target}"`));
  }
});
