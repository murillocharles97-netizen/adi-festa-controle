const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/lifecycle-manager.js", "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function fixture() {
  const documentListeners = new Map();
  const windowListeners = new Map();
  const document = {
    visibilityState: "visible",
    addEventListener(type, callback) {
      documentListeners.set(type, callback);
    },
  };
  const context = {
    window: null,
    document,
    location: { hash: "#/clientes" },
    Date,
    Promise,
    Set,
    Object,
    CustomEvent: class {
      constructor(type, options) {
        this.type = type;
        this.detail = options?.detail;
      }
    },
    addEventListener(type, callback) {
      windowListeners.set(type, callback);
    },
    dispatchEvent() {},
    console,
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(source, context);
  return { context, document, documentListeners, windowListeners };
}

test("visibilitychange, focus e pageshow compartilham um único resume", async () => {
  const env = fixture();
  let resumes = 0;
  env.context.AppLifecycle.onResume(async () => {
    resumes += 1;
  });
  env.document.visibilityState = "hidden";
  env.documentListeners.get("visibilitychange")();
  env.document.visibilityState = "visible";
  env.documentListeners.get("visibilitychange")();
  env.windowListeners.get("focus")();
  env.windowListeners.get("pageshow")({ persisted: true });
  await tick();
  assert.equal(resumes, 1);
  assert.equal(env.context.AppLifecycle.snapshot().resumeSequence, 1);
  assert.equal(env.context.AppLifecycle.snapshot().subscriberCount, 1);
});

test("dez ciclos não acumulam listeners nem fluxos concorrentes", async () => {
  const env = fixture();
  let resumes = 0;
  env.context.AppLifecycle.onResume(() => {
    resumes += 1;
  });
  for (let index = 0; index < 10; index += 1) {
    env.document.visibilityState = "hidden";
    env.documentListeners.get("visibilitychange")();
    env.document.visibilityState = "visible";
    await env.documentListeners.get("visibilitychange")();
    await tick();
  }
  assert.equal(resumes, 10);
  assert.equal(env.context.AppLifecycle.snapshot().subscriberCount, 1);
  assert.equal(env.documentListeners.size, 1);
});

test("focus sem passagem real por background não cria resume", async () => {
  const env = fixture();
  let resumes = 0;
  env.context.AppLifecycle.onResume(() => {
    resumes += 1;
  });
  env.windowListeners.get("focus")();
  await tick();
  assert.equal(resumes, 0);
});

test("suspensão e retomada têm um único coordenador global", async () => {
  const env = fixture();
  let backgrounds = 0,
    resumes = 0;
  env.context.AppLifecycle.onBackground(() => { backgrounds += 1; });
  env.context.AppLifecycle.onResume(() => { resumes += 1; });
  env.document.visibilityState = "hidden";
  env.documentListeners.get("visibilitychange")();
  env.windowListeners.get("pagehide")();
  env.document.visibilityState = "visible";
  env.documentListeners.get("visibilitychange")();
  await tick();
  assert.equal(backgrounds, 1);
  assert.equal(resumes, 1);
  assert.equal(env.context.AppLifecycle.snapshot().backgroundSubscriberCount, 1);
});
