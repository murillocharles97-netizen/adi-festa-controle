'use strict';
// All service tests in this script are local unit tests. Emulator is separate.
const fs=require('node:fs'),assert=require('node:assert/strict'),{spawnSync}=require('node:child_process');
const files=[
 'tests/customer-permission-v205.test.cjs','tests/release-v205.test.cjs','tests/sale-recovery.test.js','tests/sale-recovery-decision.test.js','tests/sync-recovery-resolution.test.js',
 'tests/checkout-local-preferences.test.js','tests/online-orders-v2.test.js','tests/sale-recovery-access.test.js','tests/sync-protocol-transition.test.cjs','tests/public-site-containment.test.cjs','tests/static-containment-worker.test.cjs',
 'tests/read-hydration-v204.test.cjs','tests/cache-session-hotfix.test.js','tests/sync-queue-quarantine.test.js','tests/fiado-cancellation.test.js','tests/sale-exchanges.test.js','tests/exchange-credit.test.js'
];
for(const p of files)assert.ok(fs.existsSync(p),'Missing test: '+p);
let result=spawnSync(process.execPath,['--test',...files],{stdio:'inherit'});if(result.status!==0)process.exit(result.status||1);
// This older suite also pins the complete V201 release artifact. That historic
// artifact gate cannot validate a new V205; only it is replaced by the V205 gate.
// The 11 substantive protocol/authorization tests remain unchanged and executed.
result=spawnSync(process.execPath,['--test','--test-skip-pattern=compatible V201 rollback','tests/operational-commit-client.test.cjs'],{stdio:'inherit'});process.exit(result.status||0);
