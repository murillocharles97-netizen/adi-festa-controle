const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");

const actions = fs.readFileSync("js/client-actions.js", "utf8");
const mobile = fs.readFileSync("js/clientes-mobile.js", "utf8");
const pager = fs.readFileSync("js/client-cloud-pagination.js", "utf8");
const sync = fs.readFileSync("js/firebase/sync.js", "utf8");
const repository = fs.readFileSync("js/firebase/firestore-repository.js", "utf8");
const app = fs.readFileSync("js/app.js", "utf8");

test("bottom sheet mobile compartilha todas as ações operacionais", () => {
  for (const label of ["Ver perfil", "Nova venda", "Registrar contato", "Receber pagamento", "Ajustar saldo", "Registrar cobrança", "Promessa de pagamento", "Histórico", "Editar cliente", "Excluir cliente"])
    assert.match(actions, new RegExp(label));
  assert.match(actions, /CRMClienteUI\?\.contactForm/);
  assert.match(actions, /Modais\.confirmar\("cliente"/);
  assert.match(mobile, /ClientActions\?\.openSheet/);
});

test("clientes usam páginas reais de 20 e busca normalizada", () => {
  assert.match(pager, /PAGE_SIZE = 20/);
  assert.match(pager, /queryClientsPage/);
  assert.match(sync, /nomeNormalizado/);
  assert.match(sync, /telefoneNormalizado/);
  assert.match(repository, /startAfter\(options\.cursor\)/);
  assert.match(repository, /limit\(max\)/);
  assert.doesNotMatch(sync, /registerRealtimeCollection\("clients"\)/);
});

test("paginação separa modo padrão e busca e descarta resposta antiga", () => {
  assert.match(pager, /mode: search \? "search" : "default"/);
  assert.match(pager, /requestId === activeRequest/);
  assert.match(pager, /keyOf\(live\) === key/);
  assert.match(pager, /context\.page\.dataset\.clientCloudMode = context\.mode/);
});

test("busca mobile usa debounce de 300 ms e aciona paginação cloud", () => {
  assert.match(app, /stableSearchTimer = setTimeout[\s\S]*?300,/);
  assert.match(mobile, /setTimeout\(\(\)=>searchClients\(state\.query\),300\)/);
  assert.match(mobile, /ClientCloudPagination\?\.refresh\?\.\(\)/);
  assert.match(app, /ClientCloudPagination\?\.cancel\?\.\(\)/);
  assert.match(sync, /queryAllClientsForAction/);
});
