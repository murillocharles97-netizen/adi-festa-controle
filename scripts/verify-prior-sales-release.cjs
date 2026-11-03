'use strict';
// Local, read-only release gate. This script never deploys, mutates a database,
// signs in a user, writes a queue, or changes a Git reference.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(path.join(root,p),'utf8'),manifest=JSON.parse(read('releases/v226/deploy-manifest.json'));
const source=read('functions/src/index.js'),exportsList=[...source.matchAll(/^exports\.(\w+)\s*=/gm)].map(x=>x[1]),names=[...manifest.functions.update,...manifest.functions.create];
assert.equal(manifest.release,226);assert.equal(manifest.productionReady,false);assert.equal(manifest.deploymentAuthorized,false);
assert.equal(names.length,7);assert.equal(new Set(names).size,7);assert.ok(names.includes('reconcileBusinessActivityEvents'));assert.ok(!names.includes('reconcileActivityEvents'));
assert.ok(names.every(n=>exportsList.includes(n)),'Every deployment target must exist in the canonical source');
const billing=['retryLegacyPlanMigrations','receiveWebhook','getPixCheckoutStatus','getCardCheckoutStatus','syncSubscription','getBillingCheckoutConfig','createSubscription'];assert.ok(!names.some(n=>billing.includes(n)));
const normalized=read(manifest.firestore.baseline).replaceAll('\r\n','\n');assert.equal(crypto.createHash('sha256').update(normalized).digest('hex'),manifest.firestore.baselineNormalizedSha256);
const rules=read(manifest.firestore.candidate),before=normalized,changes=rules.replaceAll('\r\n','\n'),start=before.indexOf('      match /sales/{saleId} {'),end=before.indexOf('      match /clients/',start),nextStart=changes.indexOf('      match /sales/{saleId} {'),nextEnd=changes.indexOf('      match /clients/',nextStart);
assert.ok(start>=0&&end>start&&nextStart>=0&&nextEnd>nextStart);assert.equal(changes.slice(0,nextStart),before.slice(0,start));assert.equal(changes.slice(nextEnd),before.slice(end));assert.match(changes.slice(nextStart,nextEnd),/recordingMode/);
assert.deepEqual(JSON.parse(read('firebase.prior-sales.json')),{firestore:{rules:'firestore.prior-sales.rules'}});
for(const p of manifest.newPublicFiles){assert.ok(JSON.parse(read(manifest.publicManifest)).files.includes(p));assert.ok(read('service-worker.js').includes('./'+p));}
assert.match(source,/PRIOR_SALES_ENABLED!==['"]false['"]/);assert.match(read('js/build-info.js'),/release:\s*"226"/);assert.match(read('js/build-info.js'),/priorSalesPaused:\s*false/);
assert.ok(!read('js/prior-sales.js').includes('processSyncQueue'));assert.ok(!read('js/prior-sales.js').includes('createTerminalPayment'));
const out={release:226,functionUpdates:manifest.functions.update,newFunctions:manifest.functions.create,rulesPatchLimitedToSaleMatch:true,storageRulesChanged:false,indexesChanged:false,billingFunctionsIncluded:false,productionReady:false,requiresV225Integration:true,deployExecuted:false};
const {execFileSync}=require('node:child_process'),git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).replaceAll('\r\n','\n'),base=manifest.requiredIntegrationBase;
assert.equal(base,'e83635c0fee645ffeaf1a4dea9c6480cc153a2f9');assert.equal(manifest.integrationCompletedLocally,true);assert.equal(manifest.integrationSourceCommit,'bcdc215e1f9f33aab459f5c5c62d6dbf6ee56bdb');
assert.equal(git('merge-base',base,'HEAD').trim(),base);assert.equal(git('rev-parse','codex/previous-sales-v1').trim(),manifest.integrationSourceCommit);
const at=p=>git('show',base+':'+p),block=(s,n)=>{const start=s.indexOf('exports.'+n+'='),end=s.indexOf('\n});',start);assert.ok(start>=0&&end>start);return s.slice(start,end+4);};
for(const name of billing)assert.equal(block(source.replaceAll('\r\n','\n'),name),block(at('functions/src/index.js'),name),'V225 handler changed: '+name);
const immutable=['js/plans.js','js/firebase/business-context.js','functions/src/services/mercado-pago-service.js','functions/src/services/legacy-plan-transition-service.js','functions/src/services/pix-billing-service.js','functions/src/services/firestore-subscription-service.js','functions/src/services/legacy-checkout-recovery-service.js','functions/src/services/legacy-source-billing-guard.js','functions/src/services/webhook-service.js','releases/v225/original-hashes.json','releases/v225/corrective-hashes.json','releases/v225/webhook-auth-hashes.json','releases/v225/webhook-canonical-hashes.json'];
for(const p of immutable)assert.equal(read(p).replaceAll('\r\n','\n'),at(p),'V225 source changed: '+p);
assert.match(read('js/build-info.js'),/billingCheckoutPaused:\s*false/);out.requiresV225Integration=false;out.integrationBase=base;out.billingHandlersPreserved=billing.length;out.billingFilesPreserved=immutable.length;
console.log(JSON.stringify(out,null,2));
