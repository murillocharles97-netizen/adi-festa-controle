'use strict';
// Local/read-only gate: does not contact GitHub/Firebase and never deploys.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const BASE='9b0702a7e56bc20685450520f2a384e092d3301f',CLEAN='3265f375a6bcd6276e202646725ce63e06a8d20c';
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).replaceAll('\r\n','\n');
const read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const allowed=[
 'index.html','js/app.js','js/build-info.js','js/firebase/firestore-repository.js','js/product-images.js','js/produtos-mobile.js','js/produtos.js','public-site.manifest.json','service-worker.js',
 'js/product-actions.js','js/product-selection.js','css/product-selection.css','package.json','package-lock.json',
 'tests/product-actions-v206.test.cjs','tests/product-selection-v206.dom.test.cjs','tests/emulator/product-actions-v206.rules.test.cjs','tests/product-selection-v206.fixture.html','tests/fixtures/product-selection-v206.js',
 'tests/public-site-containment.test.cjs','tests/static-containment-worker.test.cjs','scripts/verify-v206-release.cjs','docs/release-v206-product-selection.md',
];
function verify(){
 cp.execFileSync('git',['merge-base','--is-ancestor',CLEAN,'HEAD']);cp.execFileSync('git',['merge-base','--is-ancestor',BASE,'HEAD']);
 const changed=git('diff','--name-only',BASE,'--').trim().split('\n').filter(Boolean),untracked=git('ls-files','--others','--exclude-standard').trim().split('\n').filter(Boolean);
 for(const file of [...changed,...untracked])assert.ok(allowed.includes(file),'Unexpected file: '+file);
 for(const file of ['js/firebase/sync.js','js/storage.js','js/business-cache.js','js/team-access.js','js/firebase/auth.js','js/firebase/firebase-ui.js','js/vendas.js','js/fiados.js','js/sale-recovery-client.js','js/sale-recovery-ui.js','js/sale-exchanges.js','firestore.rules','storage.rules','firestore.indexes.json'])assert.equal(read(file),git('show',BASE+':'+file),file);
 assert.equal(git('diff','--name-only',BASE,'--','functions').trim(),'','No Function changes');
 const repo=read('js/firebase/firestore-repository.js'),begin=repo.indexOf('    async getProductStatusFromServer(id)'),end=repo.indexOf('    async listWhere(',begin);
 assert.ok(begin>0&&end>begin);assert.equal(repo.slice(0,begin)+repo.slice(end),git('show',BASE+':js/firebase/firestore-repository.js'));
 assert.match(read('js/product-actions.js'),/getProductStatusFromServer/);assert.doesNotMatch(read('js/product-actions.js'),/processSyncQueue|synchronizeNow|syncAll|pushPendingOperations|FirebaseCallable|setDoc|deleteDoc/);
 assert.match(read('js/product-actions.js'),/env\.DB\.alterar/);assert.match(read('js/product-actions.js'),/waitForConfirmation/);
 assert.match(read('js/build-info.js'),/release: "206"/);assert.match(read('service-worker.js'),/release: '206'/);
 const manifest=JSON.parse(read('public-site.manifest.json')),base=JSON.parse(git('show',BASE+':public-site.manifest.json'));
 assert.deepEqual(manifest.files.filter(p=>!base.files.includes(p)).sort(),['css/product-selection.css','js/product-actions.js','js/product-selection.js']);
 assert.ok(base.files.every(p=>manifest.files.includes(p)));assert.ok(!manifest.files.some(p=>/^(tests|docs|scripts)\//.test(p)));
 const build=require('./build-public-site.cjs'),files=new Map(manifest.files.map(p=>[p,fs.readFileSync(p)]));for(const [p,b]of files)build.assertSafePublicFile(p,b);build.assertReferencesIncluded(files);
 assert.equal(git('rev-parse','rollback/v206-compatible-products').trim(),BASE,'Rollback must remain V205 published');
 return{base:BASE,localRelease:'206',changedFiles:changed.length+untracked.length,publicFiles:manifest.files.length+1,functionsChanged:false,rulesChanged:false,syncProtocolChanged:false,recoveryV205Changed:false,rollbackCompatible:true,visualBrowserValidation:'pending: saved security policy denied localhost; no bypass',deployExecuted:false};
}
if(require.main===module)console.log(JSON.stringify(verify(),null,2));module.exports={verify,BASE,allowed};
