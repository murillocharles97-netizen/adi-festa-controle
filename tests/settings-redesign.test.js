const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const source = fs.readFileSync("js/configuracoes-mobile.js", "utf8");

function fixture(sync = {}, online = true) {
  const listeners = new Map();
  const window = { SyncFirebaseState: sync, Utils: { escapar: value => value } };
  vm.runInNewContext(source, {
    window,
    navigator: { onLine: online },
    document: { querySelector: () => null },
    addEventListener: (name, callback) => listeners.set(name, callback),
  });
  return { html: window.ConfiguracoesMobile.render(), listeners };
}

test("configurações renderiza grupos essenciais a partir do estado já disponível", () => {
  const html = fixture({ status: "success", testPassed: true, hydrated: true, listenerConnected: true }).html;
  assert.equal((html.match(/class="settings-group-list"/g) || []).length, 3);
  assert.equal((html.match(/class="settings-list-row /g) || []).length, 9);
  assert.match(html, /Sincronização pronta/);
  assert.match(html, /data-edit-operation/);
  assert.match(html, /data-settings-route="planos"/);
  assert.match(html, /data-settings-logout/);
  assert.doesNotMatch(html, /Notificações|CRM|Catálogo online|Produtos e estoque/);
  assert.doesNotMatch(source.slice(source.indexOf("function render()"), source.indexOf("function modal(")), /DB\.carregar|\bgetDocs\b|\bonSnapshot\b/);
});

test("status mostra apenas confirmação real; pendências, erro e offline prevalecem", () => {
  assert.match(fixture({ status: "success", testPassed: true, hydrated: false, listenerConnected: true }).html, /Verificando sincronização/);
  assert.match(fixture({ status: "success", queueTotal: 2, testPassed: true, hydrated: true, listenerConnected: true }).html, /Envio pendente/);
  assert.match(fixture({ status: "error", errors: 1 }).html, /Sincronização precisa de atenção/);
  assert.match(fixture({ status: "success", testPassed: true, hydrated: true, listenerConnected: true }, false).html, /Sem conexão/);
  assert.equal(fixture().listeners.has("firebase-sync-status"), true);
});
