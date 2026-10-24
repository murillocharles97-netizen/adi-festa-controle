'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const base='5d60e5f5fa159001da39b6b50bcd438129f93fb6',rollback='8e50eab2f7bd841038f5847e5252e00d450b31d4';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).replace(/\r\n/g,'\n'),read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
test('V201 is frontend-only and excludes every backend, permission and commercial implementation change',()=>{
 git('merge-base','--is-ancestor',base,'HEAD');
 const allowed=new Set(['js/sale-cancellation.js','js/build-info.js','index.html','service-worker.js','tests/sale-cancellation-dom.test.cjs','tests/sale-cancellation-v201-release.test.cjs','tests/sale-cancellation-release.test.cjs','tests/public-site-containment.test.cjs','tests/static-containment-worker.test.cjs','docs/release-v201-payment-options.md']);
 for(const p of [...git('diff','--name-only',base).trim().split('\n'),...git('ls-files','--others','--exclude-standard').trim().split('\n')].filter(Boolean))assert.ok(allowed.has(p),'Unexpected V201 file: '+p);
 assert.equal(git('diff','--name-only',base,'--','functions','firestore.rules','firestore.indexes.json','storage.rules','firebase.json','public-site.manifest.json','js/firebase','js/vendas.js','js/fiados.js','js/sale-exchanges.js','js/exchange-credit-checkout.js','js/exchange-economics.js','js/team-access.js','js/checkout.js','scripts/build-public-site.cjs','.github/workflows/deploy-pages.yml'),'');
});
test('cancellation runtime differs ONLY by the three corrected opening option tags',()=>{
 const before=git('show',base+':js/sale-cancellation.js');assert.equal((before.match(/<\/option value=/g)||[]).length,3);
 assert.equal(read('js/sale-cancellation.js'),before.replaceAll('</option value=','</option><option value='));
 assert.doesNotMatch(read('js/sale-cancellation.js'),/<\/option\s+value=/);
});
test('existing compatible rollback retains identical canonical guards, Rules and ledgers',()=>{
 assert.equal(git('rev-parse','rollback/v200-compatible-sale-cancellation^{commit}').trim(),rollback);
 assert.equal(git('diff','--name-only',base,rollback,'--','firestore.rules','functions/src/services','js/firebase/sync.js','js/fiados.js','js/vendas.js','js/sale-exchanges.js','js/exchange-credit-checkout.js'),'');
 assert.match(git('show',rollback+':functions/src/index.js'),/allowNewCancellations:false/);
 assert.doesNotMatch(git('show',rollback+':index.html'),/src="\.\/js\/sale-cancellation\.js/);
});
