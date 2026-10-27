'use strict';
// Local/read-only gate: frontend evidence intake only, no commercial writes.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const BASE='ca4382162353388d550aa436d6c417ffd778bf5b',CLEAN='3265f375a6bcd6276e202646725ce63e06a8d20c';
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).replaceAll('\r\n','\n'),read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const allowed=['js/business-cache.js','js/sale-recovery-client.js','js/sale-recovery-ui.js','js/firebase/firebase-ui.js','index.html','js/build-info.js','service-worker.js','tests/public-site-containment.test.cjs','tests/static-containment-worker.test.cjs','tests/recovery-customer-collection-v208.test.cjs','tests/recovery-customer-intake-v208.dom.test.cjs','tests/helpers/recovery-cache-v208.cjs','tests/emulator/recovery-customer-collection-v208.rules.test.cjs','scripts/verify-v208-release.cjs','docs/release-v208-customer-evidence.md'];
function verify(){
 for(const ancestor of [CLEAN,BASE])cp.execFileSync('git',['merge-base','--is-ancestor',ancestor,'HEAD']);
 const changed=git('diff','--name-only',BASE,'--').trim().split('\n').filter(Boolean),untracked=git('ls-files','--others','--exclude-standard').trim().split('\n').filter(Boolean);
 for(const f of [...changed,...untracked])assert.ok(allowed.includes(f),'Unexpected file: '+f);
 assert.equal(git('diff','--name-only',BASE,'--','functions').trim(),'','All Functions preserved');
 for(const f of ['firestore.rules','storage.rules','firestore.indexes.json','js/firebase/sync.js','js/storage.js','js/team-access.js','js/firebase/auth.js','js/app.js','js/vendas.js','js/fiados.js','js/sale-exchanges.js','js/sale-cancellation.js','js/product-actions.js','js/product-selection.js','js/produtos.js','js/produtos-mobile.js','js/product-images.js','js/firebase/firestore-repository.js','css/product-selection.css','css/sale-recovery.css','public-site.manifest.json','.github/workflows/deploy-pages.yml'])assert.equal(read(f),git('show',BASE+':'+f),f);
 const stripCollector=s=>{const a=s.indexOf('  async function recoverySources'),b=s.indexOf('  DB.businessCache =',a);assert.ok(a>0&&b>a);return s.slice(0,a)+s.slice(b);};
 assert.equal(stripCollector(read('js/business-cache.js')),stripCollector(git('show',BASE+':js/business-cache.js')),'No changes to cache writes, CAS, session or namespace routing');
 assert.equal(read('js/firebase/firebase-ui.js').replaceAll('sale-recovery-client.js?v=208','sale-recovery-client.js?v=207').replaceAll('sale-recovery-ui.js?v=208','sale-recovery-ui.js?v=207'),git('show',BASE+':js/firebase/firebase-ui.js'),'Only evidence imports cache-busted');
 assert.equal(read('index.html').replaceAll('build-info.js?v=208','build-info.js?v=207').replaceAll('business-cache.js?v=208','business-cache.js?v=187').replaceAll('firebase-ui.js?v=208','firebase-ui.js?v=207'),git('show',BASE+':index.html'),'Only changed resources cache-busted');
 assert.equal(read('service-worker.js').replaceAll('veconi-v208-customer-evidence','veconi-v207-recovery-confirmation').replace("release: '208'","release: '207'"),git('show',BASE+':service-worker.js'),'Only public worker version changes');
 assert.match(read('js/build-info.js'),/release: "208"/);assert.match(read('js/sale-recovery-ui.js'),/Complementar dados para recuperação/);
 const manifest=JSON.parse(read('public-site.manifest.json')),builder=require('./build-public-site.cjs'),files=new Map(manifest.files.map(p=>[p,fs.readFileSync(p)]));for(const[p,b]of files)builder.assertSafePublicFile(p,b);builder.assertReferencesIncluded(files);
 return{base:BASE,release:208,changedFiles:new Set([...changed,...untracked]).size,functionsChanged:false,rulesChanged:false,permissionsChanged:false,syncProtocolChanged:false,productsV206Preserved:true,cacheWriterUnchanged:true,originalEvidenceImmutable:true,publicFiles:manifest.files.length+1,rollback:BASE,rollbackCompatible:true};
}
if(require.main===module)console.log(JSON.stringify(verify(),null,2));module.exports={verify,BASE,allowed};
