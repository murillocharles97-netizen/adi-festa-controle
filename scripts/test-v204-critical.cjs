'use strict';
// Local Node/DOM regressions only. No deploy or production commercial calls.
const fs=require('node:fs'),cp=require('node:child_process');
const tests=['read-hydration-v204.test.cjs','operational-dashboard-access.test.js','sync-session-alert.test.js','sync-recovery-resolution.test.js','sync-protocol-transition.test.cjs','sync-diagnostic-scope.test.js','client-pagination-race.test.js','client-resume-lifecycle.test.js','login-redesign-v203.test.cjs','public-site-containment.test.cjs','static-containment-worker.test.cjs','operational-commit-client.test.cjs','fiado-cancellation.test.js','sale-exchanges.test.js','sale-completion.test.js','payment-confirmation-sharing.test.js','sale-cancellation-ui.test.js','sale-cancellation-dom.test.cjs','history-cancelled-status.test.js','bootstrap-no-commercial-writes.test.js','release-v204.test.cjs'].map(p=>'tests/'+p);
for(const file of tests)if(!fs.existsSync(file))throw Error('Required regression missing: '+file);
const run=cp.spawnSync(process.execPath,['--test','--test-reporter=tap',...tests],{encoding:'utf8',maxBuffer:32*1024*1024});
const output=run.stdout+'\n'+run.stderr,counts=Object.fromEntries([...output.matchAll(/^# (tests|pass|fail|skipped|cancelled) (\d+)$/gm)].map(m=>[m[1],Number(m[2])]));
if(process.env.V204_CRITICAL_REPORT)fs.writeFileSync(process.env.V204_CRITICAL_REPORT,JSON.stringify({at:new Date().toISOString(),tests,counts,exitCode:run.status,productionWrites:0},null,2)+'\n',{flag:'wx'});
if(run.status!==0||!counts.tests){process.stderr.write(output);process.exit(run.status||1);}
console.log(JSON.stringify({files:tests.length,...counts,exitCode:run.status,productionWrites:0}));
