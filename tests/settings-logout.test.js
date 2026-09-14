const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

const root=path.resolve(__dirname,'..');
const read=file=>fs.readFileSync(path.join(root,file),'utf8');
const auth=read('js/firebase/auth.js');
const app=read('js/app.js');
const mobile=read('js/configuracoes-mobile.js');
const css=read('css/configuracoes-mobile.css');
const ui=read('js/firebase/firebase-ui.js');
const worker=read('service-worker.js');

assert.match(auth,/function logoutConfirmation\(\)/);
assert.match(auth,/confirm-account-logout/);
assert.match(auth,/return bootstrapLogout\(\)/);
assert.match(auth,/window\.SyncFirebase\?\.stop\?\.\(\)/);
assert.match(auth,/BusinessContext\.clear\(\);DB\.releaseBusiness\(\)/);
assert.match(auth,/firebase-session-cleared/);
assert.match(auth,/Promise\.race\(\[signOut\(auth\)/);
assert.match(auth,/sessionStorage\.removeItem\('adiFestaMessagePendingReturn_v1'\)/);
assert.doesNotMatch(auth,/\[Sync before logout\]/);
assert.doesNotMatch(auth,/type:'logout'/);

assert.match(app,/else mountRoute\(Router\.atual\(\)\)/);
assert.match(app,/addEventListener\(["']firebase-session-cleared["']/);
assert.match(app,/carrinho\s*=\s*\[\]/);
assert.match(app,/ConfiguracoesMobile\.render\(\)/);

for (const label of ['Conta e operação','Dados da empresa','Plano e assinatura','WhatsApp padrão','Modelo de operação','Conta','Sistema','Sincronização','Backup de dados','Ajuda e tutoriais','Ações','Sair da conta']) assert.ok(mobile.includes(label), label);
for (const redundant of ['Clientes e fiado','Produtos e estoque','Histórico de operações','Catálogo online','Pedidos online','Cupons de desconto']) assert.ok(!mobile.includes(redundant), redundant);
assert.match(mobile,/data-settings-logout/);
assert.match(mobile,/SyncFirebase\.synchronizeNow\(\)/);
assert.match(css,/@media \(max-width:767px\)/);
assert.match(css,/@media \(min-width:768px\)/);
assert.match(ui,/if\(document\.querySelector\('\.mobile-settings-page'\)\)/);
assert.match(worker,/veconi-v\d+-/);
assert.match(worker,/configuracoes-mobile\.js/);
assert.match(worker,/configuracoes-mobile\.css/);
assert.match(read('js/checkout.js'),/addEventListener\(\s*["']firebase-session-cleared["']\s*,\s*resetSession\s*\)/);
assert.match(read('js/checkout-mobile.js'),/addEventListener\('firebase-session-cleared'/);
assert.match(ui,/mobileSettings\.dataset\.firebaseUiBound==='true'/);
assert.match(ui,/mobileSettings\.dataset\.firebaseUiBound='true'/);
assert.match(ui,/if\(element&&element\.textContent!==text\)/);
assert.match(ui,/settingsPanel\(\);ensureDetailsButton\(\);if\(lastState\)renderState\(lastState\)/);
assert.match(ui,/setHtml\(document\.querySelector\('#firebase-details'\),technicalDetails/);
assert.match(ui,/getQueueDiagnostics/);
assert.match(ui,/data-retry-all/);
assert.match(ui,/!result\.complete/);
const mobilePanel=ui.slice(ui.indexOf('function settingsPanel()'),ui.indexOf('async function manualSync'));
assert.ok(
  mobilePanel.indexOf("mobileSettings.dataset.firebaseUiBound='true'")<
  mobilePanel.indexOf('renderState(lastState)'),
  'The settings page must be marked as bound before its first DOM update'
);

console.log('settings-logout.test.js: OK');
