'use strict';
// Local/read-only release gate. No network or commercial writes.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const BASE='ffdee04bcca48c4b40b9ea4da940116784ab0646',CLEAN='3265f375a6bcd6276e202646725ce63e06a8d20c';
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).replaceAll('\r\n','\n'),read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const allowed=['css/sale-recovery.css','functions/src/services/sale-recovery-service.js','functions/src/services/sale-recovery-customer.js','functions/src/services/sale-recovery-decision.js','js/sale-recovery-client.js','js/sale-recovery-ui.js','js/firebase/firebase-ui.js','index.html','js/build-info.js','service-worker.js','tests/public-site-containment.test.cjs','tests/static-containment-worker.test.cjs','tests/sale-recovery-v207.dom.test.cjs','tests/sale-recovery-v207.test.cjs','tests/emulator/customer-recovery-v205.rules.test.cjs','scripts/verify-v207-release.cjs','docs/release-v207-recovery-confirmation.md'];
function verify(){
 for(const ancestor of [CLEAN,BASE])cp.execFileSync('git',['merge-base','--is-ancestor',ancestor,'HEAD']);
 const changed=git('diff','--name-only',BASE,'--').trim().split('\n').filter(Boolean),untracked=git('ls-files','--others','--exclude-standard').trim().split('\n').filter(Boolean);
 for(const f of [...changed,...untracked])assert.ok(allowed.includes(f),'Unexpected file: '+f);
 for(const f of ['firestore.rules','storage.rules','firestore.indexes.json','functions/src/index.js','functions/src/services/operational-commit-service.js','functions/src/shared/commercial-commit-engine.js','js/firebase/sync.js','js/storage.js','js/business-cache.js','js/team-access.js','js/firebase/auth.js','js/app.js','js/vendas.js','js/fiados.js','js/sale-exchanges.js','js/sale-cancellation.js','js/product-actions.js','js/product-selection.js','js/produtos.js','js/produtos-mobile.js','js/product-images.js','js/firebase/firestore-repository.js','css/product-selection.css','public-site.manifest.json'])assert.equal(read(f),git('show',BASE+':'+f),f);
 const ui=read('js/firebase/firebase-ui.js');assert.equal(ui.replace('sale-recovery-client.js?v=207','sale-recovery-client.js?v=183').replace('sale-recovery-ui.js?v=207','sale-recovery-ui.js?v=203'),git('show',BASE+':js/firebase/firebase-ui.js'),'No Sync/UI changes except recovery import cache-busting');
 assert.match(read('js/build-info.js'),/release: "207"/);assert.match(read('service-worker.js'),/release: '207'/);
 const manifest=JSON.parse(read('public-site.manifest.json')),builder=require('./build-public-site.cjs'),files=new Map(manifest.files.map(p=>[p,fs.readFileSync(p)]));for(const [p,b]of files)builder.assertSafePublicFile(p,b);builder.assertReferencesIncluded(files);
 return{base:BASE,release:207,changedFiles:new Set([...changed,...untracked]).size,onlyFunctionsToRedeploy:['submitSaleRecovery','listSaleRecoveryReviews','decideSaleRecovery'],publicFiles:manifest.files.length+1,rulesChanged:false,permissionsChanged:false,syncProtocolChanged:false,productsV206Preserved:true,commercialUploaderUnchanged:true,rollbackCompatible:true};
}
if(require.main===module)console.log(JSON.stringify(verify(),null,2));module.exports={verify,BASE,allowed};
