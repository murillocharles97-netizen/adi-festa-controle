'use strict';
// Read-only replay of the two legacy failures against sanitized V202 blobs.
const fs=require('node:fs'),path=require('node:path'),{execFileSync,spawnSync}=require('node:child_process');
if(process.env.VECONI_LOGIN_BASELINE_CHILD==='1'){
 const original=fs.readFileSync,root=path.resolve(__dirname,'..'),cache=new Map();
 fs.readFileSync=function(file,options){
  if(typeof file==='string'){
   const relative=path.relative(root,path.resolve(file)).replaceAll('\\','/');
   if(['js/firebase/auth.js','js/firebase/sync.js','service-worker.js','index.html','css/firebase.css'].includes(relative)){
    if(!cache.has(relative))cache.set(relative,execFileSync('git',['show','c80da0fffb0106aea4d23cf097ee33896522f07c:'+relative],{cwd:root}));
    const data=cache.get(relative),encoding=typeof options==='string'?options:options?.encoding;return encoding?data.toString(encoding):Buffer.from(data);
   }
  }
  return original.apply(this,arguments);
 };
}else{
 const run=spawnSync(process.execPath,['--require',__filename,'--test','--test-name-pattern=Sync response after account switch|service worker V135','tests/cache-session-hotfix.test.js','tests/veconi-pwa-branding-v133.test.js'],{cwd:path.resolve(__dirname,'..'),env:{...process.env,VECONI_LOGIN_BASELINE_CHILD:'1'},encoding:'utf8'});
 const output=run.stdout+run.stderr;
 console.log(output.split('\n').filter(l=>/^✖|^ℹ|ReferenceError/.test(l)).join('\n'));
 const expected=['Sync response after account switch cannot acknowledge, remove or change any queue in the new identity','service worker V135 migra apenas caches do app e preserva os assets V133'];
 if(run.status!==1||!expected.every(name=>output.includes('✖ '+name))||!output.includes('fail 2')){console.error('Baseline did not reproduce exactly the two legacy failures.');process.exitCode=1;}
 else console.log('Baseline V202: exactly the same two legacy failures reproduced; no files or checkout changed.');
}
