'use strict';
// Local, read-only gate. Pass the reviewed V204 candidate commit explicitly.
const fs=require('node:fs'),cp=require('node:child_process'),assert=require('node:assert/strict');
const candidate=process.argv[2];assert.match(candidate||'',/^[a-f0-9]{40}$/);
const git=(...args)=>cp.execFileSync('git',args,{encoding:'utf8'}).replaceAll('\r\n','\n'),read=p=>fs.readFileSync(p,'utf8').replaceAll('\r\n','\n');
const changed=git('diff','--name-only',candidate,'--').trim().split('\n').filter(Boolean);assert.deepEqual(changed.sort(),['js/firebase/sync.js','service-worker.js']);
assert.equal(read('js/firebase/sync.js').replace('backoff=[]','backoff=[1000,3000,10000,30000]'),git('show',candidate+':js/firebase/sync.js'));
assert.equal(read('service-worker.js').replaceAll('veconi-v204-read-hydration-compatible','veconi-v204-read-hydration'),git('show',candidate+':service-worker.js'));
const result=JSON.parse(cp.execFileSync(process.execPath,['scripts/verify-v204-release.cjs'],{encoding:'utf8'}));
console.log(JSON.stringify({...result,candidate,compatibleRollback:true,onlyDegradation:'timer-driven read retries paused; pending read markers preserved; reload/reconnection still read only',commercialReplay:false,destructiveStorageActions:false}));
