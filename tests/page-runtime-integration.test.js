const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const runtimeSource = fs.readFileSync("js/page-runtime.js", "utf8");
const routerSource = fs.readFileSync("js/router.js", "utf8");
const tick = () => new Promise((resolve) => setImmediate(resolve));

function environment(initialHash = "#/inicio") {
  const listeners = new Map();
  const context = {
    window: null,
    location: { hash: initialHash },
    history: {},
    queueMicrotask,
    addEventListener(name, callback) {
      if (!listeners.has(name)) listeners.set(name, []);
      listeners.get(name).push(callback);
    },
  };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(runtimeSource, context);
  vm.runInContext(routerSource, context);
  return {
    context,
    emit(name) {
      for (const callback of listeners.get(name) || []) callback();
    },
    listenerCount(name) {
      return (listeners.get(name) || []).length;
    },
  };
}

test("shell/router monta home e navega uma vez por hashchange", () => {
  const env = environment();
  const rendered = [];
  const runtime = env.context.PageRuntime.create({
    render: (route) => rendered.push(route),
  });
  env.context.Router.iniciar(runtime.mount);
  assert.deepEqual(rendered, ["inicio"]);
  assert.equal(env.listenerCount("hashchange"), 1);

  env.context.location.hash = "#/clientes";
  env.emit("hashchange");
  env.context.location.hash = "#/produtos";
  env.emit("hashchange");
  assert.deepEqual(rendered, ["inicio", "clientes", "produtos"]);
  assert.equal(runtime.snapshot().mountSequence, 3);
});
test("montagem reentrante enfileira apenas a rota mais recente", async () => {
  const rendered = [];
  let runtime;
  runtime = (() => {
    const context = { window: null, queueMicrotask };
    context.window = context;
    vm.createContext(context);
    vm.runInContext(runtimeSource, context);
    return context.PageRuntime.create({
      render(route) {
        rendered.push(route);
        if (route === "inicio") {
          runtime.mount("clientes");
          runtime.mount("produtos");
        }
      },
    });
  })();
  runtime.mount("inicio");
  await tick();
  assert.deepEqual(rendered, ["inicio", "produtos"]);
  assert.equal(runtime.snapshot().mounting, false);
  assert.equal(runtime.snapshot().queuedRoute, "");
});

test("erro de página fica visível e não mata navegação posterior", () => {
  const failures = [];
  const rendered = [];
  const context = { window: null, queueMicrotask };
  context.window = context;
  vm.createContext(context);
  vm.runInContext(runtimeSource, context);
  const runtime = context.PageRuntime.create({
    render(route) {
      if (route === "inicio") throw Object.assign(new Error("dashboard failed"), { code: "DASHBOARD_FAILED" });
      rendered.push(route);
    },
    onError(error, route) {
      failures.push({ code: error.code, route });
    },
  });
  assert.equal(runtime.mount("inicio"), false);
  assert.deepEqual(failures, [{ code: "DASHBOARD_FAILED", route: "inicio" }]);
  assert.equal(runtime.mount("clientes"), true);
  assert.deepEqual(rendered, ["clientes"]);
  assert.equal(runtime.snapshot().mounting, false);
});
