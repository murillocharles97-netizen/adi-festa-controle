const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = { window: null };
context.window = context;
vm.createContext(context);
vm.runInContext(fs.readFileSync("js/client-filter-rules.js", "utf8"), context);
const rules = context.ClientFilterRules;

const clients = [
  { id: "a", nome: "Ana Devedora", saldo: -100, telefone: "17999990001", ativo: true },
  { id: "b", nome: "Jessica Arezzo", saldo: 0, telefone: "17999990002", ativo: true },
  { id: "c", nome: "Carla Crédito", saldo: 50, telefone: "", ativo: true },
];
const ids = (filter, query = "") =>
  rules.filter(clients, { status: filter, query }).map((client) => client.id);

test("Todos não impõe restrição de saldo ou status", () => {
  assert.deepEqual(ids("todos"), ["a", "b", "c"]);
  assert.deepEqual(ids("debito"), ["a"]);
  assert.deepEqual(ids("zero"), ["b"]);
  assert.deepEqual(ids("credito"), ["c"]);
  assert.deepEqual(ids("semTelefone"), ["c"]);
});

test("busca textual e filtro são independentes", () => {
  assert.deepEqual(ids("todos", "Jessic"), ["b"]);
  assert.deepEqual(ids("zero", "Jessic"), ["b"]);
  assert.deepEqual(ids("debito", "Jessic"), []);
});

test("quitação muda segmentos específicos sem remover cliente de Todos", () => {
  clients[0].saldo = 0;
  assert.deepEqual(ids("todos"), ["a", "b", "c"]);
  assert.deepEqual(ids("debito"), []);
  assert.deepEqual(ids("zero"), ["a", "b"]);
});

test("segmentos sobrepostos continuam incluídos em Todos", () => {
  const neverCharged = rules.filter(clients, {
    status: "nunca",
    lastCharge: () => null,
  });
  assert.equal(neverCharged.length, 3);
  assert.deepEqual(ids("todos"), ["a", "b", "c"]);
});
