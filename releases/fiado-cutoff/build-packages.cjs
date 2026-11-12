'use strict';
// Rebuilds the Fiado-opening packages from the ACTIVE production sources
// (cutoff-release/<name>-before) plus only the cutoff/opening delta.
//   - files whose ACTIVE copy equals main (8df723a) take the branch version;
//   - files whose ACTIVE copy diverges use the reviewed merge in ./sources;
//   - new modules required by changed files come from the branch;
//   - index.js, package.json, package-lock.json and every other file stay ACTIVE.
// Output (outside git: packages carry .env/private policy): ../../../VECONI-Fiado-Cutoff-Packages
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('node:assert/strict'),crypto=require('crypto');
const REPO=path.resolve(__dirname,'../..'),CR='C:/Users/Murillo/.codex/visualizations/2026/11/11/fiado-central-preflight/cutoff-release';
const OUT=path.resolve(REPO,'../VECONI-Fiado-Cutoff-Packages'),MAIN='8df723a',HEAD=cp.execFileSync('git',['rev-parse','HEAD'],{cwd:REPO,encoding:'utf8'}).trim();
const lf=b=>String(b).replace(/\r\n/g,'\n'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const show=(rev,f)=>{try{return cp.execFileSync('git',['show',rev+':functions/'+f],{cwd:REPO,maxBuffer:9e6});}catch{return null;}};
const changed=new Set(cp.execFileSync('git',['diff','--name-only',MAIN,HEAD,'--','functions/src'],{cwd:REPO,encoding:'utf8'}).trim().split('\n').map(f=>f.replace(/^functions\//,'')));
const src=f=>fs.readFileSync(path.join(__dirname,'sources',f));
const PACKAGES={
 commitOperationalSync:{'src/services/operational-commit-service.js':src('commitOperationalSync/operational-commit-service.js')},
 getOperationalSyncReceipt:{'src/services/operational-commit-service.js':src('getOperationalSyncReceipt/operational-commit-service.js'),'src/services/payment-confirmation-read.js':null},
 // ACTIVE V226 writer + a self-contained cutoff guard: its V226 dependencies stay ACTIVE.
 confirmPriorSale:{'src/services/operational-commit-service.js':src('confirmPriorSale/operational-commit-service.js'),__noWalk:true},
 previewSaleCancellation:{'src/services/sale-cancellation-service.js':src('sale-cancellation/sale-cancellation-service.js')},
 confirmSaleCancellation:{'src/services/sale-cancellation-service.js':src('sale-cancellation/sale-cancellation-service.js')},
 // One self-contained guard line; dependencies stay ACTIVE.
 commitFinancialMaintenance:{'src/services/financial-maintenance-service.js':null,__noWalk:true},
 // Owner-only Central (policy: this company + owner UID). Its ACTIVE copy is the
 // abandoned history-regularization line; the opening Central is taken as a whole
 // from the branch for this entrypoint graph.
 reviewFiadoOriginEvidence:{'src/fiado-origin-evidence-handler.js':null,'src/services/fiado-history-regularization.js':null,
  'src/services/fiado-history-service.js':null,'src/services/fiado-receipt-route.js':null,'src/services/fiado-regularization-review.js':null,
  'src/services/operational-commit-service.js':null,'src/shared/fiado-history-account.js':null,'src/services/fiado-opening-confirmation.js':null,__branchGraph:true}
};
const report={head:HEAD,main:MAIN,packages:{}};
if(fs.existsSync(OUT))fs.rmSync(OUT,{recursive:true});
for(const [name,overrides]of Object.entries(PACKAGES)){
 const before=CR+'/'+name+'-before',root=path.join(OUT,name);fs.cpSync(before,root,{recursive:true});
 const written=new Set(),queue=[];
 const put=(f,bytes)=>{const t=path.join(root,f);fs.mkdirSync(path.dirname(t),{recursive:true});fs.writeFileSync(t,bytes);written.add(f);queue.push(f);};
 const {__noWalk,__branchGraph,...own}=overrides;
 for(const [f,bytes]of Object.entries(own))put(f,bytes??show(HEAD,f));
 if(__noWalk)queue.length=0;
 while(queue.length){
  const f=queue.shift();
  for(const m of lf(fs.readFileSync(path.join(root,f))).matchAll(/\brequire\(\s*['"](\.[^'"]+)['"]\s*\)/g)){
   let r=path.posix.normalize(path.posix.join(path.posix.dirname(f),m[1]));if(!path.posix.extname(r))r+='.js';
   if(written.has(r))continue;
   const active=path.join(root,r),exists=fs.existsSync(active);
   if(!exists){const b=show(HEAD,r);assert.ok(b,name+': missing module '+r);put(r,b);continue;}
   if(__branchGraph){const h=show(HEAD,r);if(h&&lf(h)!==lf(fs.readFileSync(active)))put(r,h);continue;} // whole entry graph = tested branch code
   if(!changed.has(r))continue;                       // untouched by the cutoff: keep ACTIVE
   const a=lf(fs.readFileSync(active)),m0=show(MAIN,r);
   assert.ok(m0&&a===lf(m0),name+': '+r+' diverges from main in ACTIVE and needs a reviewed merge in ./sources');
   put(r,show(HEAD,r));
  }
 }
 if(name==='reviewFiadoOriginEvidence'){
  const f=path.join(root,'private/policy.json'),policy=JSON.parse(fs.readFileSync(f));
  assert.equal(policy.businessId,'adi-festa');assert.ok(policy.ownerUid&&policy.adiSpaceId&&policy.cardSpaceId);
  policy.openingEnabled=true;fs.writeFileSync(f,JSON.stringify(policy));written.add('private/policy.json');
 }
 const files={};(function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())scan(p);else files[path.relative(root,p).replaceAll('\\','/')]=sha(fs.readFileSync(p));}})(root);
 const kept=['src/index.js','package.json','package-lock.json'].filter(f=>fs.existsSync(path.join(before,f)));
 for(const f of kept)assert.equal(files[f],sha(fs.readFileSync(path.join(before,f))),name+': '+f+' must stay ACTIVE');
 const js=dir=>{let t='';(function scan(d){for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory())scan(p);else if(p.endsWith('.js'))t+=fs.readFileSync(p,'utf8');}})(dir);return t;};
 const recovery=/payment_recovery_(review|apply)|recognizePreservedPayment\(/;
 assert.ok(!recovery.test(js(root))||recovery.test(js(before)),name+': recovery/preserved-payment modes must not be introduced');
 report.packages[name]={changed:[...written].sort(),files};
 console.log(name+': '+[...written].sort().join(', '));
}
fs.writeFileSync(path.join(OUT,'package-manifest.json'),JSON.stringify(report,null,2));
fs.writeFileSync(path.join(__dirname,'package-manifest.json'),JSON.stringify(report,null,2));
console.log('out: '+OUT);
