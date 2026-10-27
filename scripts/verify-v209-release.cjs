'use strict';
// Offline isolation/containment gate. No release commit, network or deploy.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const BASE='12f6cc44b04fc104c9c2875ea134fd0c0fec7990',CLEAN='3265f375a6bcd6276e202646725ce63e06a8d20c';
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).replaceAll('\r\n','\n'),read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const allowed=['js/product-actions.js','js/product-selection.js','js/firebase/firestore-repository.js','js/build-info.js','index.html','service-worker.js','tests/public-site-containment.test.cjs','tests/static-containment-worker.test.cjs','tests/product-actions-v206.test.cjs','tests/product-selection-v206.dom.test.cjs','tests/helpers/product-actions-v209.cjs','tests/helpers/product-action-server-v209.cjs','tests/product-batch-v209.test.cjs','tests/product-action-server-v209.test.cjs','tests/product-batch-v209.dom.test.cjs','tests/emulator/product-batch-v209.rules.test.cjs','docs/release-v209-product-batch-scope.md','scripts/verify-v209-release.cjs'];
function verify(){
 for(const a of [BASE,CLEAN])cp.execFileSync('git',['merge-base','--is-ancestor',a,'HEAD']);
 const names=[...git('diff','--name-only',BASE,'--').trim().split('\n'),...git('ls-files','--others','--exclude-standard').trim().split('\n')].filter(Boolean);for(const n of names)assert.ok(allowed.includes(n),'Unexpected file: '+n);
 assert.equal(git('diff','--name-only',BASE,'--','functions').trim(),'');
 for(const f of ['firestore.rules','storage.rules','firestore.indexes.json','public-site.manifest.json','.github/workflows/deploy-pages.yml','js/firebase/sync.js','js/firebase/firebase-ui.js','js/firebase/business-context.js','js/firebase/auth.js','js/team-access.js','js/spaces.js','js/business-cache.js','js/storage.js','js/sale-recovery-client.js','js/sale-recovery-ui.js','js/vendas.js','js/fiados.js','js/sale-exchanges.js','js/sale-cancellation.js','js/product-images.js','js/produtos.js','js/produtos-mobile.js','js/app.js','css/product-selection.css'])assert.equal(read(f),git('show',BASE+':'+f),f);
 // Only product readback projection and the server-only space confirmation
 // helper change in the repository. Hydration/listeners and all writers match.
 const trim=s=>{const a=s.indexOf('    async getProductStatusFromServer(id)'),b=s.indexOf('    async listWhere(',a);assert.ok(a>0&&b>a);return s.slice(0,a)+s.slice(b);};assert.equal(trim(read('js/firebase/firestore-repository.js')),trim(git('show',BASE+':js/firebase/firestore-repository.js')));
 assert.equal(read('index.html').replaceAll('build-info.js?v=209','build-info.js?v=208').replaceAll('product-actions.js?v=209','product-actions.js?v=206').replaceAll('product-selection.js?v=209','product-selection.js?v=206'),git('show',BASE+':index.html'));
 assert.equal(read('service-worker.js').replaceAll('veconi-v209-product-batch-scope','veconi-v208-customer-evidence').replace("release: '209'","release: '208'"),git('show',BASE+':service-worker.js'));
 const manifest=JSON.parse(read('public-site.manifest.json')),builder=require('./build-public-site.cjs'),files=new Map(manifest.files.map(p=>[p,fs.readFileSync(p)]));for(const[p,b]of files)builder.assertSafePublicFile(p,b);builder.assertReferencesIncluded(files);
 return{release:209,base:BASE,changedFiles:new Set(names).size,functionsChanged:false,rulesChanged:false,permissionsChanged:false,syncProtocolChanged:false,recoveryV208Unchanged:true,repositoryWritesAndListenersUnchanged:true,publicFiles:manifest.files.length+1,rollback:BASE,rollbackCompatible:true};
}
if(require.main===module)console.log(JSON.stringify(verify(),null,2));module.exports={verify,BASE,allowed};
