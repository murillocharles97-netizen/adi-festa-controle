'use strict';
// Containment: redeploy the exact pre-cutoff sources (cutoff-release/*-before.zip)
// for the 6 Functions started at 2026-11-12 11:11 BRT. Allowed only while no Fiado
// opening is confirmed (fiadoOpeningBalances empty) — checked before each start.
// Dry run by default. Usage:
//   node rollback-functions.cjs check                 (read-only)
//   node rollback-functions.cjs start <name> --execute
//   node rollback-functions.cjs status <name>         (read-only)
const fs=require('fs'),assert=require('node:assert/strict'),crypto=require('crypto');
const c=require('C:/Users/Murillo/.codex/visualizations/2026/11/07/v227-history-commit-release/common.cjs');
const CR='C:/Users/Murillo/.codex/visualizations/2026/11/11/fiado-central-preflight/cutoff-release';
const OUT=__dirname+'/rollback-state';fs.mkdirSync(OUT,{recursive:true});
const root='projects/adi-festa-controle/locations/southamerica-east1',base='https://cloudfunctions.googleapis.com/v2/';
const NAMES=['commitFinancialMaintenance','confirmSaleCancellation','previewSaleCancellation','confirmPriorSale','commitOperationalSync','getOperationalSyncReceipt'];
// Revisions observed live (read-only check, 2026-11-12) = the candidate uploads.
const CANDIDATE_REVISION={commitOperationalSync:'commitoperationalsync-00014-qew',getOperationalSyncReceipt:'getoperationalsyncreceipt-00008-vav',
 confirmPriorSale:'confirmpriorsale-00002-yul',previewSaleCancellation:'previewsalecancellation-00003-lur',
 confirmSaleCancellation:'confirmsalecancellation-00003-nuj',commitFinancialMaintenance:'commitfinancialmaintenance-00002-tom'};
const before=JSON.parse(fs.readFileSync(CR+'/before-functions.private.json'));
const sha=b=>crypto.createHash('sha256').update(b).digest('hex');
const save=(n,v)=>fs.writeFileSync(OUT+'/'+n,JSON.stringify(v,null,2));
async function api(url,method,body){
 assert.ok(new URL(url).hostname==='cloudfunctions.googleapis.com');
 const r=await fetch(url,{method,headers:{Authorization:'Bearer '+await c.token(),'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});
 const data=await r.json();if(!r.ok)throw Error(method+' HTTP '+r.status+' '+String(data.error?.message||'').slice(0,280));return data;
}
async function noOpenings(){
 const r=await c.get('https://firestore.googleapis.com/v1/projects/adi-festa-controle/databases/(default)/documents/businesses/adi-festa/fiadoOpeningBalances?pageSize=1&mask.fieldPaths=hash',{allow404:true});
 assert.equal((r?.documents||[]).length,0,'A Fiado opening exists: do NOT roll back to a writer unaware of the cutoff.');
}
(async()=>{
 const [action,name]=process.argv.slice(2),execute=process.argv.includes('--execute');
 if(action==='check'){await noOpenings();for(const n of NAMES){const f=await c.get(base+root+'/functions/'+n);console.log(n,f.state,f.serviceConfig.revision,f.serviceConfig.revision===CANDIDATE_REVISION[n]?'candidate-live':'UNEXPECTED');}return;}
 assert.ok(NAMES.includes(name),'Unknown function');
 const previous=before.find(f=>f.name.endsWith('/'+name)),zip=fs.readFileSync(CR+'/'+name+'-before.zip');
 if(action==='start'){
  await noOpenings();
  const current=await c.get(base+root+'/functions/'+name);
  assert.equal(current.state,'ACTIVE');assert.equal(current.serviceConfig.revision,CANDIDATE_REVISION[name],'Live revision changed since the check');
  assert.ok(!fs.existsSync(OUT+'/'+name+'-operation.json'),'Already started');
  if(!execute){console.log(JSON.stringify({function:name,dryRun:true,wouldUpload:sha(zip),bytes:zip.length}));return;}
  const upload=await api(base+root+'/functions:generateUploadUrl','POST',{environment:'GEN_2'});
  assert.equal(new URL(upload.uploadUrl).hostname,'storage.googleapis.com');
  const sent=await fetch(upload.uploadUrl,{method:'PUT',headers:{'Content-Type':'application/zip'},body:zip,signal:AbortSignal.timeout(60000)});assert.ok(sent.ok,'Upload HTTP '+sent.status);
  const op=await api(base+root+'/functions/'+name+'?updateMask=buildConfig.source','PATCH',{name:previous.name,buildConfig:{source:{storageSource:upload.storageSource}}});
  save(name+'-operation.json',{name:op.name,sourceSha256:sha(zip)});console.log(JSON.stringify({function:name,operation:op.name,status:'started'}));return;
 }
 assert.equal(action,'status');const op=JSON.parse(fs.readFileSync(OUT+'/'+name+'-operation.json'));
 const result=await c.get(base+op.name);if(!result.done){console.log(JSON.stringify({function:name,status:'building'}));return;}
 if(result.error)throw Error('Rollback failed '+name+': '+result.error.message);
 const current=await c.get(base+root+'/functions/'+name);assert.equal(current.state,'ACTIVE');
 const config=f=>{const s={...f.serviceConfig};for(const k of ['revision','uri','service'])delete s[k];return s;};
 assert.deepEqual(config(current),config(previous),'Runtime configuration changed');assert.deepEqual(current.eventTrigger,previous.eventTrigger);
 const s=current.buildConfig.source.storageSource,live=await c.get('https://storage.googleapis.com/storage/v1/b/'+encodeURIComponent(s.bucket)+'/o/'+encodeURIComponent(s.object)+'?alt=media&generation='+s.generation,{binary:true});
 assert.equal(sha(live),sha(zip),'Live source is not the pre-cutoff package');
 save(name+'-rolled-back.json',{name,revision:current.serviceConfig.revision,sourceSha256:sha(live)});
 console.log(JSON.stringify({function:name,revision:current.serviceConfig.revision,status:'ACTIVE',source:'pre-cutoff verified'}));
})().catch(e=>{console.error(e.message);process.exitCode=1;});
