'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{execFileSync}=require('node:child_process');
const base='3265f375a6bcd6276e202646725ce63e06a8d20c';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8'}).replace(/\r\n/g,'\n');
const read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const paused=()=>read('functions/src/index.js').includes('allowNewCancellations:false');

test('V200 package descends from sanitized V199 and contains only approved cancellation/release files',()=>{
 git('merge-base','--is-ancestor',base,'HEAD');
 const allowed=new Set(['firestore.rules','functions/src/index.js','functions/src/services/sale-cancellation-service.js','index.html','js/activity-center.js','js/build-info.js','js/sale-cancellation.js','public-site.manifest.json','service-worker.js','tests/emulator/sale-cancellation.rules.test.js','tests/sale-cancellation-ui.test.js','tests/sale-cancellation-release.test.cjs','tests/static-containment-worker.test.cjs','tests/public-site-containment.test.cjs','docs/sale-cancellation-audit.md','docs/release-v200-sale-cancellation.md']);
 for(const file of ['tests/sale-cancellation-dom.test.cjs','tests/sale-cancellation-v201-release.test.cjs','docs/release-v201-payment-options.md'])allowed.add(file);
 const changed=[...git('diff','--name-only',base).trim().split('\n'),...git('ls-files','--others','--exclude-standard').trim().split('\n')].filter(Boolean);
 for(const p of changed)assert.ok(allowed.has(p),'Unexpected release file: '+p);
});

test('existing Sync, Fiado, exchange/credit, financial, Auth, isolation and static-containment implementations are unchanged',()=>{
 for(const p of ['js/vendas.js','js/fiados.js','js/firebase/sync.js','js/firebase/auth.js','js/firebase/session-lifecycle.js','js/storage.js','js/local-records.js','js/business-cache.js','js/workspace-writer.js','js/workspace-runtime.js','js/team-access.js','js/checkout.js','js/sale-exchanges.js','js/exchange-credit-checkout.js','js/exchange-economics.js','js/performance-model.js','functions/src/services/sale-exchange-service.js','functions/src/services/exchange-credit-service.js','functions/src/services/financial-income-service.js','functions/src/services/sale-recovery-service.js','functions/src/services/subscription-service.js','functions/src/shared/exchange-product-scope.js','firestore.indexes.json','storage.rules','firebase.json','scripts/build-public-site.cjs','.github/workflows/deploy-pages.yml','tests/fixtures/client-actions-harness.html','tests/mobile-home-clients-polish.fixture.html'])assert.equal(read(p),git('show',base+':'+p),p);
});

test('only two new callable exports are added; every existing Function is preserved',()=>{
 const source=read('functions/src/index.js');
 assert.match(source,/exports\.previewSaleCancellation=onCall\(RECOVERY_OPTIONS/);
 assert.match(source,/exports\.confirmSaleCancellation=onCall\(RECOVERY_OPTIONS/);
 assert.equal(source.replace(/^const saleCancellations=.*\n/m,'').replace(/^exports\.previewSaleCancellation=.*\n/m,'').replace(/^exports\.confirmSaleCancellation=.*\n/m,''),git('show',base+':functions/src/index.js'));
 assert.match(read('functions/src/services/sale-cancellation-service.js'),/member\.permissions\?\.\['sales\.cancel'\]!==true/);
});

test('Rules only add the restrictive canonical-cancellation fence; no grants or indexes change',()=>{
 const fence="          // A stale legacy undo must not replay stock after canonical cancellation.\n          resource.data.get('cancellationMode','') != 'canonical_transaction'\n          &&\n";
 assert.ok(read('firestore.rules').includes(fence));
 assert.equal(read('firestore.rules').replace(fence,''),git('show',base+':firestore.rules'));
});

test('V201 PWA version is consistent and explicit public allowlist never includes backend or fixtures',()=>{
 assert.match(read('js/build-info.js'),/release: "201"/);
 assert.match(read('service-worker.js'),/veconi-v201-cancellation-payment-options/);
 assert.match(read('service-worker.js'),/release: '201'/);
 assert.match(read('index.html'),/build-info\.js\?v=201/);
 const now=JSON.parse(read('public-site.manifest.json')).files,before=JSON.parse(git('show',base+':public-site.manifest.json')).files;
 assert.deepEqual(now.filter(p=>p!=='js/sale-cancellation.js'),before);
 assert.equal(now.includes('js/sale-cancellation.js'),!paused());
 assert.ok(!now.some(p=>p.startsWith('tests/')||p.startsWith('docs/')||p.startsWith('functions/src/services/')));
});

test('compatible rollback pauses new server effects but keeps original receipts, validation and financial projector',()=>{
 const source=read('functions/src/services/sale-cancellation-service.js');
 assert.ok(source.indexOf('if(marker.exists)')<source.indexOf("if(!allowNewCancellations)fail('Novos cancelamentos estão suspensos. Nenhum efeito"));
 assert.match(source,/m\.checksum!==checksum/);
 assert.match(source,/m\.actorUid!==c\.uid/);
 assert.match(source,/automaticRefund:false/);
 assert.doesNotMatch(source,/refundPayment|refundPix|refundCard|https:\/\//);
 assert.match(read('functions/src/index.js'),/projectFinancial:.*financialIncomeService\(db\)\.projectSale/);
 if(paused()){
  assert.doesNotMatch(read('index.html'),/src="\.\/js\/sale-cancellation\.js/);
  assert.doesNotMatch(read('js/activity-center.js'),/data-history-cancel-sale/);
 }
});
