'use strict';
// Fiado opening release. NOTHING runs without --execute. Order (each step verified):
//   1. node deploy-release.cjs check                       (read-only: live == pre-cutoff, no opening)
//   2. node deploy-release.cjs rules --execute             (selective.rules v2)
//   3. node deploy-release.cjs start <fn> --execute ; status <fn>   for FUNCTIONS in order
//   4. web app (central-fiado/fiados/sync/service-worker) via the Pages workflow — after step 3
//   5. node deploy-release.cjs start reviewFiadoOriginEvidence --execute   (enables the Central opening)
// Containment: node deploy-release.cjs rollback <fn> --execute  (pre-cutoff zip; refused once an opening exists)
const fs=require('fs'),path=require('path'),cp=require('child_process'),assert=require('node:assert/strict'),crypto=require('crypto');
const c=require('C:/Users/Murillo/.codex/visualizations/2026/11/07/v227-history-commit-release/common.cjs');
const CR='C:/Users/Murillo/.codex/visualizations/2026/11/11/fiado-central-preflight/cutoff-release';
const PKG=path.resolve(__dirname,'../../../VECONI-Fiado-Cutoff-Packages'),STATE=path.join(__dirname,'release-state');fs.mkdirSync(STATE,{recursive:true});
const root='projects/adi-festa-controle/locations/southamerica-east1',base='https://cloudfunctions.googleapis.com/v2/';
const FUNCTIONS=['commitFinancialMaintenance','previewSaleCancellation','confirmSaleCancellation','confirmPriorSale','commitOperationalSync','getOperationalSyncReceipt'];
const CENTRAL='reviewFiadoOriginEvidence';
// Live after the 2026-11-12 rollback (pre-cutoff sources, verified).
const BASELINE={commitFinancialMaintenance:'commitfinancialmaintenance-00003-lok',confirmSaleCancellation:'confirmsalecancellation-00004-kug',
 previewSaleCancellation:'previewsalecancellation-00004-qif',confirmPriorSale:'confirmpriorsale-00003-tel',commitOperationalSync:'commitoperationalsync-00015-hes',
 getOperationalSyncReceipt:'getoperationalsyncreceipt-00009-vas',reviewFiadoOriginEvidence:'reviewfiadooriginevidence-00001-viz'};
const before=JSON.parse(fs.readFileSync(CR+'/before-functions.private.json')),manifest=JSON.parse(fs.readFileSync(path.join(__dirname,'package-manifest.json')));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex'),save=(n,v)=>fs.writeFileSync(path.join(STATE,n),JSON.stringify(v,null,2));
const read=n=>fs.existsSync(path.join(STATE,n))?JSON.parse(fs.readFileSync(path.join(STATE,n))):null;
async function api(url,method,body){
 assert.ok(['cloudfunctions.googleapis.com','firebaserules.googleapis.com'].includes(new URL(url).hostname));
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+await c.token(),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const data=await r.json();if(!r.ok)throw Error(method+' HTTP '+r.status+' '+String(data.error?.message||'').slice(0,280));return data;
}
const fn=name=>c.get(base+root+'/functions/'+name);
async function openings(){const r=await c.get('https://firestore.googleapis.com/v1/projects/adi-festa-controle/databases/(default)/documents/businesses/adi-festa/fiadoOpeningBalances?pageSize=1&mask.fieldPaths=hash',{allow404:true});return (r?.documents||[]).length;}
function zipDir(dir){return cp.execFileSync('python',['-c','import pathlib,zipfile,io,sys\np=pathlib.Path(sys.argv[1]);b=io.BytesIO()\nwith zipfile.ZipFile(b,"w",zipfile.ZIP_DEFLATED) as z:\n for f in sorted(p.rglob("*")):\n  if f.is_file(): z.writestr(str(f.relative_to(p)).replace("\\\\","/"),f.read_bytes())\nsys.stdout.buffer.write(b.getvalue())',dir],{maxBuffer:30e6});}
async function upload(name,zip){
 const previous=before.find(f=>f.name.endsWith('/'+name));
 const u=await api(base+root+'/functions:generateUploadUrl','POST',{environment:'GEN_2'});assert.equal(new URL(u.uploadUrl).hostname,'storage.googleapis.com');
 const sent=await fetch(u.uploadUrl,{method:'PUT',headers:{'Content-Type':'application/zip'},body:zip,signal:AbortSignal.timeout(60000)});assert.ok(sent.ok,'Upload HTTP '+sent.status);
 return api(base+root+'/functions/'+name+'?updateMask=buildConfig.source','PATCH',{name:previous.name,buildConfig:{source:{storageSource:u.storageSource}}});
}
async function verify(name,expectedSha){
 const previous=before.find(f=>f.name.endsWith('/'+name)),cur=await fn(name);assert.equal(cur.state,'ACTIVE');
 const cfg=f=>{const s={...f.serviceConfig};for(const k of ['revision','uri','service'])delete s[k];return s;};
 assert.deepEqual(cfg(cur),cfg(previous),'Runtime configuration changed');assert.deepEqual(cur.eventTrigger,previous.eventTrigger);
 const s=cur.buildConfig.source.storageSource,live=await c.get('https://storage.googleapis.com/storage/v1/b/'+encodeURIComponent(s.bucket)+'/o/'+encodeURIComponent(s.object)+'?alt=media&generation='+s.generation,{binary:true});
 assert.equal(sha(live),expectedSha,'Live source differs from the uploaded package');return cur.serviceConfig.revision;
}
(async()=>{
 const [action,name]=process.argv.slice(2),execute=process.argv.includes('--execute');
 if(action==='check'){
  console.log('openings:',await openings());
  for(const n of [...FUNCTIONS,CENTRAL]){const f=await fn(n),st=read(n+'-published.json');console.log(n.padEnd(28),f.state,f.serviceConfig.revision,f.serviceConfig.revision===BASELINE[n]?'pre-cutoff':st?.revision===f.serviceConfig.revision?'release':'UNEXPECTED');}
  const rel=await c.get('https://firebaserules.googleapis.com/v1/projects/adi-festa-controle/releases/cloud.firestore');
  console.log('rules',rel.rulesetName===JSON.parse(fs.readFileSync(CR+'/before-rules-release.json')).rulesetName?'pre-cutoff':read('rules-published.json')?.rulesetName===rel.rulesetName?'release (v2)':'UNEXPECTED');return;
 }
 if(action==='rules'){
  const url='https://firebaserules.googleapis.com/v1/',release=await c.get(url+'projects/adi-festa-controle/releases/cloud.firestore');
  assert.equal(release.rulesetName,JSON.parse(fs.readFileSync(CR+'/before-rules-release.json')).rulesetName,'Live Rules changed since the backup');
  const content=fs.readFileSync(path.join(__dirname,'selective.rules'),'utf8');
  if(!execute){console.log(JSON.stringify({rules:'selective.rules v2',sha256:sha(content),dryRun:true}));return;}
  const created=await api(url+'projects/adi-festa-controle/rulesets','POST',{source:{files:[{name:'firestore.rules',content}]}});
  await api(url+'projects/adi-festa-controle/releases/cloud.firestore?updateMask=rulesetName','PATCH',{release:{name:release.name,rulesetName:created.name}});
  const cur=await c.get(url+'projects/adi-festa-controle/releases/cloud.firestore');assert.equal(cur.rulesetName,created.name);
  save('rules-published.json',{rulesetName:cur.rulesetName,previous:release.rulesetName,sha256:sha(content)});console.log('rules published',cur.rulesetName);return;
 }
 assert.ok([...FUNCTIONS,CENTRAL].includes(name),'Unknown function');
 if(action==='start'){
  if(name===CENTRAL)for(const n of FUNCTIONS)assert.ok(read(n+'-published.json'),'Publish and verify '+n+' before enabling the Central');
  if(name===CENTRAL)assert.ok(read('rules-published.json'),'Publish the Rules before enabling the Central');
  const cur=await fn(name);assert.equal(cur.state,'ACTIVE');assert.equal(cur.serviceConfig.revision,BASELINE[name],'Live revision is not the verified pre-cutoff baseline');
  const dir=path.join(PKG,name);for(const [f,h]of Object.entries(manifest.packages[name].files))assert.equal(sha(fs.readFileSync(path.join(dir,f))),h,f);
  const zip=zipDir(dir);
  if(!execute){console.log(JSON.stringify({function:name,dryRun:true,sha256:sha(zip),bytes:zip.length}));return;}
  const op=await upload(name,zip);save(name+'-operation.json',{name:op.name,sourceSha256:sha(zip)});console.log(JSON.stringify({function:name,status:'started'}));return;
 }
 if(action==='status'){
  const op=read(name+'-operation.json');assert.ok(op,'not started');const r=await c.get(base+op.name);
  if(!r.done){console.log(JSON.stringify({function:name,status:'building'}));return;}if(r.error)throw Error('Deploy failed '+name+': '+r.error.message);
  const revision=await verify(name,op.sourceSha256);save(name+'-published.json',{revision,sourceSha256:op.sourceSha256});console.log(JSON.stringify({function:name,revision,status:'ACTIVE',verified:true}));return;
 }
 if(action==='rollback'){
  assert.equal(await openings(),0,'An opening exists: do not return to a writer unaware of the cutoff. Suspend new confirmations instead.');
  const zip=fs.readFileSync(CR+'/'+name+'-before.zip');
  if(!execute){console.log(JSON.stringify({function:name,rollback:true,dryRun:true}));return;}
  const op=await upload(name,zip);save(name+'-rollback-operation.json',{name:op.name,sourceSha256:sha(zip)});console.log(JSON.stringify({function:name,status:'rollback started'}));return;
 }
 throw Error('Unknown action');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
