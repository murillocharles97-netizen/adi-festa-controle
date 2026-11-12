const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

function utils({ online = true } = {}) {
  const context = { navigator: { onLine: online }, document: { querySelector: () => null }, crypto: { randomUUID: () => "id" }, setTimeout };
  context.globalThis = context;
  context.window = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync("js/utils.js", "utf8"), context);
  return context.Utils;
}
const sdk = (message, code) => Object.assign(new Error(message), { name: "FirebaseError", code });

test("raw SDK text becomes a clear sentence chosen by the error code", () => {
  const { friendlyError } = utils();
  assert.equal(friendlyError(sdk("Missing or insufficient permissions.", "permission-denied")), "Seu perfil não tem acesso a esta informação.");
  assert.equal(friendlyError(sdk('Failed to get documents from server. (However, these documents may exist in the local cache.)', "unavailable")), "Sem conexão com a nuvem agora. Confira a internet e tente novamente.");
  assert.equal(friendlyError(sdk("unavailable", "functions/unavailable")), "Sem conexão com a nuvem agora. Confira a internet e tente novamente.");
  assert.equal(friendlyError(sdk("deadline-exceeded", "functions/deadline-exceeded")), "A consulta demorou mais que o esperado. Tente novamente.");
  assert.equal(friendlyError(sdk("unauthenticated", "auth/unauthenticated")), "Sua sessão expirou. Entre novamente para continuar.");
  assert.equal(friendlyError(sdk("internal", "functions/internal"), "Tente novamente."), "Tente novamente.");
  assert.equal(friendlyError(new TypeError("Cannot read properties of undefined (reading 'listMembers')"), "Tente novamente."), "Tente novamente.");
});

test("messages already written for the merchant are never rewritten or hidden", () => {
  const { friendlyError } = utils();
  for (const message of [
    "Ative o catálogo online nas configurações antes de publicar.",
    "Você não tem acesso à equipe.",
    "A edição de permissões está pausada para manutenção. Os acessos atuais e as operações comerciais foram preservados.",
    "Seu perfil não tem acesso a esta análise.",
  ]) assert.equal(friendlyError(sdk(message, "functions/failed-precondition")), message);
  assert.equal(friendlyError(new Error("Tente novamente")), "Tente novamente");
});

test("an unknown SDK failure while offline says the connection is missing", () => {
  const { friendlyError } = utils({ online: false });
  assert.equal(friendlyError(sdk("internal", "functions/internal")), "Sem conexão com a nuvem agora. Confira a internet e tente novamente.");
  assert.equal(friendlyError(undefined, "Tente novamente."), "Sem conexão com a nuvem agora. Confira a internet e tente novamente.");
});
