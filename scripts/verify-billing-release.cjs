'use strict';
// Local read-only gate: no provider calls, credentials, database writes or deploy.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),cp=require('node:child_process'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),json=p=>JSON.parse(read(p)),norm=s=>s.replaceAll('\r\n','\n'),sha=s=>crypto.createHash('sha256').update(s).digest('hex');
const m=json('releases/v225/deploy-manifest.json'),original=json(m.originalHashes),source=norm(read('functions/src/index.js'));
const expected=['retryLegacyPlanMigrations','receiveWebhook','getPixCheckoutStatus','getCardCheckoutStatus','syncSubscription','getBillingCheckoutConfig','createSubscription'];
assert.deepEqual(m.functions.updateInOrder,expected);assert.deepEqual(m.functions.create,[]);assert.equal(m.deploymentAuthorized,false);assert.equal(m.activateV3,false);
assert.equal(original.files.length,10);assert.equal(m.productionFiles.length,10);
for(const f of original.files){if(f.path==='functions/src/index.js')continue;assert.equal(sha(norm(read(f.path))),f.lfSha256,'Original billing delta changed: '+f.path);}
for(const name of expected){const start=source.indexOf('exports.'+name+'='),end=source.indexOf('\n});',start);assert.ok(start>=0&&end>start,name);assert.equal(sha(source.slice(start,end+4)),m.functions.handlerSha256[name],name+' differs from the audited original handler');}
const baseIndex=cp.execFileSync('git',['show',m.base+':functions/src/index.js'],{cwd:root,encoding:'utf8'}),exportsOf=s=>[...s.matchAll(/^exports\.(\w+)\s*=/gm)].map(x=>x[1]).sort();assert.deepEqual(exportsOf(source),exportsOf(baseIndex));assert.equal(exportsOf(source).length,92);
const paths=cp.execFileSync('git',['diff',m.base,'--name-only'],{cwd:root,encoding:'utf8'}).trim().split('\n').filter(Boolean),production=paths.filter(p=>!p.startsWith('tests/')&&!p.startsWith('scripts/')&&!p.startsWith('releases/')&&!p.startsWith('functions/test/'));assert.ok(production.every(p=>m.productionFiles.includes(p)),'Unexpected production path');
assert.match(read('js/build-info.js'),/release:\s*"225"/);assert.match(read('js/build-info.js'),/billingCheckoutPaused:\s*false/);assert.match(read('service-worker.js'),/release:\s*'225'/);
const flag=process.argv.indexOf('--original-package');let originalFilesVerified=0;if(flag>=0){const p=JSON.parse(fs.readFileSync(path.join(process.argv[flag+1],'PACKAGE.json'),'utf8'));assert.equal(p.files.length,10);for(const f of p.files){assert.equal(sha(fs.readFileSync(f.source)),original.files.find(x=>x.path===f.path).sha256);originalFilesVerified++;}}
console.log(JSON.stringify({release:225,updates:expected,newFunctions:0,exportsPreserved:92,originalFilesVerified,nonIndexFilesMatchOriginal:9,originalHandlersMatch:7,unexpectedProductionFiles:false,deployExecuted:false},null,2));
