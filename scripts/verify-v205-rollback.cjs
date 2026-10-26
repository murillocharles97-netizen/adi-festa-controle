'use strict';
// Compare a checked-out compatible rollback with its explicit V205 candidate.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const candidate=process.argv[2];assert.match(candidate||'',/^[a-f0-9]{40}$/);
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).replaceAll('\r\n','\n'),read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const changed=git('diff','--name-only',candidate,'--').trim().split('\n').filter(Boolean).sort();
assert.deepEqual(changed,['functions/src/services/sale-recovery-customer.js','service-worker.js']);
assert.equal(read('functions/src/services/sale-recovery-customer.js').replace('const CUSTOMER_RECOVERY_ENABLED=false;','const CUSTOMER_RECOVERY_ENABLED=true;'),git('show',candidate+':functions/src/services/sale-recovery-customer.js'));
assert.equal(read('service-worker.js').replaceAll('veconi-v205-customer-dependencies-compatible','veconi-v205-customer-dependencies'),git('show',candidate+':service-worker.js'));
console.log(JSON.stringify({...require('./verify-v205-release.cjs').verify(),candidate,compatibleRollback:true,newCustomerDecisionsPaused:true,existingEvidenceAndReceiptsPreserved:true,commercialReplay:false,dataMigration:false}));
