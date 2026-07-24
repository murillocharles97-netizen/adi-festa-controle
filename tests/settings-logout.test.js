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

assert.match(app,/else render\(Router\.atual\(\)\)/);
assert.match(app,/addEventListener\('firebase-session-cleared'/);
assert.match(app,/carrinho=\[\]/);
assert.match(app,/ConfiguracoesMobile\.render\(\)/);

assert.match(mobile,/Minha empresa/);
assert.match(mobile,/Conta e acesso/);
assert.match(mobile,/Nuvem e sincronização/);
assert.match(mobile,/Backup e dados/);
assert.match(mobile,/Detalhes técnicos/);
assert.match(mobile,/Área de risco/);
assert.match(mobile,/data-settings-logout/);
assert.match(mobile,/SyncFirebase\.synchronizeNow\(\)/);
assert.match(css,/@media \(max-width:767px\)/);
assert.match(css,/@media \(min-width:768px\)/);
assert.match(ui,/if\(document\.querySelector\('\.mobile-settings-page'\)\)/);
assert.match(worker,/adi-festa-v46-settings-freeze-fix/);
assert.match(worker,/configuracoes-mobile\.js/);
assert.match(worker,/configuracoes-mobile\.css/);
assert.match(read('js/checkout.js'),/addEventListener\('firebase-session-cleared',resetSession\)/);
assert.match(read('js/checkout-mobile.js'),/addEventListener\('firebase-session-cleared'/);
assert.match(ui,/mobileSettings\.dataset\.firebaseUiBound==='true'/);
assert.match(ui,/mobileSettings\.dataset\.firebaseUiBound='true'/);
assert.match(ui,/if\(element&&element\.textContent!==text\)/);
const mobilePanel=ui.slice(ui.indexOf('function settingsPanel()'),ui.indexOf('async function manualSync'));
assert.ok(
  mobilePanel.indexOf("mobileSettings.dataset.firebaseUiBound='true'")<
  mobilePanel.indexOf('renderState(lastState)'),
  'The settings page must be marked as bound before its first DOM update'
);

console.log('settings-logout.test.js: OK');
