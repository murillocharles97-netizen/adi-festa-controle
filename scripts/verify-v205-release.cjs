'use strict';
// Read-only, local release gate. Never invokes Firebase, GitHub or a deploy.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const BASE='576d761e0947eef8917dc1d85cd4bd85b3da89d3',CLEAN='3265f375a6bcd6276e202646725ce63e06a8d20c';
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).replaceAll('\r\n','\n'),read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const allowed=[
 'functions/src/services/sale-recovery-customer.js','functions/src/services/sale-recovery-decision.js','functions/src/services/sale-recovery-service.js',
 'index.html','js/app.js','js/build-info.js','js/checkout.js','js/clientes-mobile.js','js/clientes-page.js','js/clientes.js','js/firebase/auth.js','js/firebase/firebase-ui.js','js/firebase/sync.js','js/online-order-finalization.js','js/online-orders-ui.js','js/sale-recovery-client.js','js/sale-recovery-ui.js','js/vendas.js','service-worker.js',
 'tests/customer-permission-v205.test.cjs','tests/emulator/customer-recovery-v205.rules.test.cjs','tests/emulator/customer-recovery-v205-rollback.cjs','tests/helpers/customer-recovery-v205.cjs','tests/emulator/sale-recovery-decision.rules.test.js','tests/online-orders-v2.test.js','tests/public-site-containment.test.cjs','tests/static-containment-worker.test.cjs','tests/cache-session-hotfix.test.js',
 'scripts/verify-v205-release.cjs','scripts/verify-v205-rollback.cjs','scripts/test-v205-critical.cjs','tests/release-v205.test.cjs','docs/release-v205-customer-dependencies.md'
];
function verify(){
 cp.execFileSync('git',['merge-base','--is-ancestor',CLEAN,'HEAD']);cp.execFileSync('git',['merge-base','--is-ancestor',BASE,'HEAD']);
 const changed=git('diff','--name-only',BASE,'--').trim().split('\n').filter(Boolean),untracked=git('ls-files','--others','--exclude-standard').trim().split('\n').filter(Boolean);
 for(const p of [...changed,...untracked])assert.ok(allowed.includes(p),'Unrelated change: '+p);
 // git diff above compares the complete tracked tree (staged AND unstaged)
 // against BASE. No per-file subprocess is needed for the unchanged paths.
 const protectedFiles=git('ls-tree','-r','--name-only',BASE).trim().split('\n').filter(p=>!allowed.includes(p)).length;
 const section=(s,a,b)=>{const i=s.indexOf(a),j=s.indexOf(b,i);assert.ok(i>=0&&j>i,a);return s.slice(i,j);},sync=read('js/firebase/sync.js'),old=git('show',BASE+':js/firebase/sync.js');
 for(const [a,b]of [['function queueWrites(','function migrateOwnerBusinessQueue('],['function diffWrites(','function captureChanges('],['function captureChanges(','function installOfflineFirstStorage('],['async function processSyncQueue(','function pendingIds('],['function captureCloudReadScope(','async function readCanonicalClient('],['function synchronizeNow(','function captureExternalChange(']])assert.equal(section(sync,a,b),section(old,a,b),a);
 const manifest=JSON.parse(read('public-site.manifest.json'));
 assert.ok(!manifest.files.some(p=>/^(?:tests|docs|scripts)\//.test(p)||/diagnostico|recovery-customer|kyteData|kyteBalances|saldoCorrecoes/i.test(p)));
 const build=require('./build-public-site.cjs');const files=new Map(manifest.files.map(p=>[p,fs.readFileSync(p)]));for(const [p,bytes]of files)build.assertSafePublicFile(p,bytes);build.assertReferencesIncluded(files);
 for(const p of ['js/firebase/auth.js','js/firebase/firebase-ui.js'])assert.equal(read(p).replace('./sync.js?v=205','./sync.js?v=204'),git('show',BASE+':'+p),p);
 for(const script of ['generate-commercial-commit-engine','generate-engagement-domain','generate-maintenance-audit'])cp.execFileSync(process.execPath,['scripts/'+script+'.cjs','--check']);
 assert.match(read('js/build-info.js'),/release: "205"/);assert.match(read('service-worker.js'),/release: '205'/);
 assert.match(read('functions/src/services/sale-recovery-customer.js'),/const CUSTOMER_RECOVERY_ENABLED=(?:true|false);/);
 return{base:BASE,protectedFiles,allowedFiles:allowed.length,changedFiles:changed.length,publicFiles:manifest.files.length+1,onlyFunctionsToRedeploy:['submitSaleRecovery','listSaleRecoveryReviews','decideSaleRecovery'],rulesChanged:false,permissionsChanged:false,commercialUploaderUnchanged:true,queueCaptureUnchanged:true,readHydrationV204Unchanged:true,commercialEngineUnchanged:true,deployExecuted:false};
}
if(require.main===module)console.log(JSON.stringify(verify()));module.exports={verify,BASE,allowed};
