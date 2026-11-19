'use strict';
// Local packaging only: preserve each active source, including its operational
// stock, recovery, fuel and beneficiary fixes. This script never deploys.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function tree(dir,base=dir,out={}){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){if(entry.name==='node_modules')continue;assert.ok(!entry.isSymbolicLink());const p=path.join(dir,entry.name);if(entry.isDirectory())tree(p,base,out);else out[path.relative(base,p).replaceAll('\\','/')]=sha(fs.readFileSync(p));}return out;}
function patchGateway(s,writer){
 const replace=(before,after)=>{assert.equal(s.split(before).length,2,'Unique active-source anchor required: '+before);s=s.replace(before,after);};
 if(s.includes("  if(request.data?.kind==='fiado_conditions')"))replace("  if(request.data?.kind==='fiado_conditions')",`  if(request.data?.kind==='fiado_space_regularization')return db.runTransaction(async tx=>{
   const d=request.data,c=await context(tx,request,{businessId:d.businessId,userId:request.auth?.uid,workspaceGeneration:d.workspaceGeneration??0});
   return require('./fiado-space-regularization').handler({tx,c,ref,d,now:now(),write:true});
  });
  if(request.data?.kind==='fiado_conditions')`);
 replace("   if(d.kind==='fiado_account')",`   if(['fiado_space_regularization_preview','fiado_space_regularization_status'].includes(d.kind))
    return require('./fiado-space-regularization').handler({tx,c,ref,d,now:now()});
   if(d.kind==='fiado_account')`);
 replace("  },['fiado_receipt_route'","  },['fiado_space_regularization_preview','fiado_space_regularization_status','fiado_receipt_route'");
 replace("'campaignFinanceVersion','fiadoHistoryVersion'];","'campaignFinanceVersion','fiadoHistoryVersion','fiadoHistoryActivation'];");
 if(writer){
  replace("if(cid){const client=(await tx.get(ref(c.bid,'clients',cid))).data();","if(cid){const client=(await tx.get(ref(c.bid,'clients',cid))).data();\n     if(adjustment&&client?.fiadoHistoryActivation?.spaceRegularization?.version===1)fail('Use Regularizar saldo no espaço. O ajuste antigo foi preservado sem efeito.','failed-precondition');");
  replace("    if(!scopedReceiptAccount&&(await tx.get(ref(c.bid,'clients',id))).data()?.fiadoOpeningBalance)","    const requiresScopedReceipt=(await tx.get(ref(c.bid,'clients',id))).data();\n    if(!scopedReceiptAccount&&(requiresScopedReceipt?.fiadoOpeningBalance||requiresScopedReceipt?.fiadoHistoryActivation?.spaceRegularization?.version===1))");
 }
 return s;
}
function prepare(out){
 out=path.resolve(out);assert.ok(!fs.existsSync(out),'Choose a fresh package directory');fs.mkdirSync(out,{recursive:true});
 const manifest={project:'adi-festa-controle',deployExecuted:false,rulesChanges:0,indexChanges:0,functions:{}};
 for(const [name,sourcePath,revision]of [['commitOperationalSync','qa-artifacts/pdv-beneficiary/published/commitOperationalSync','commitoperationalsync-00025-ked'],['getOperationalSyncReceipt','qa-artifacts/fiado-space-regularization/published/getOperationalSyncReceipt','getoperationalsyncreceipt-00013-xet']]){
  const active=path.join(root,sourcePath),verification=JSON.parse(read(path.join(active,'verification.json')));
  assert.equal(verification.revision,revision);assert.equal(verification.state,'ACTIVE');assert.equal(sha(fs.readFileSync(path.join(active,'source.zip'))),verification.sourceSha256);
  const source=path.join(active,'source'),target=path.join(out,name,'forward/functions');fs.cpSync(source,target,{recursive:true});
  const gateway='src/services/operational-commit-service.js',history='src/shared/fiado-history-account.js',service='src/services/fiado-space-regularization.js';
  fs.writeFileSync(path.join(target,gateway),patchGateway(read(path.join(source,gateway)),name==='commitOperationalSync'));
  const old=read(path.join(source,history)),next=read(path.join(root,'functions',history));
  assert.equal(next,old.replace(' if(opening){'," if(client.fiadoHistoryActivation?.spaceRegularization?.version===1)scoped=true;\n if(opening){"));
  fs.writeFileSync(path.join(target,history),next);fs.copyFileSync(path.join(root,'functions',service),path.join(target,service));
  const before=tree(source),after=tree(target),changed=Object.keys(after).filter(f=>before[f]!==after[f]);
  assert.deepEqual(changed.sort(),[gateway,history,service].sort());assert.ok(Object.keys(before).every(f=>Object.hasOwn(after,f)));
  const rollback=path.join(out,name,'rollback/functions');fs.cpSync(target,rollback,{recursive:true});
  const p=path.join(rollback,service);fs.writeFileSync(p,read(p).replace('const WRITES_ENABLED=true;','const WRITES_ENABLED=false;'));
  for(const mode of ['forward','rollback']){const dir=path.join(out,name,mode);fs.writeFileSync(path.join(dir,'firebase.json'),JSON.stringify({functions:{source:'functions',runtime:'nodejs22',ignore:['node_modules','.git','test','firebase-debug.log']}},null,2));fs.writeFileSync(path.join(dir,'.firebaserc'),JSON.stringify({projects:{default:manifest.project}},null,2));}
  manifest.functions[name]={previousRevision:revision,changed,unchangedFiles:Object.keys(before).length-2,sourceSha256:verification.sourceSha256,forward:tree(target),rollback:tree(rollback)};
 }
 fs.writeFileSync(path.join(out,'MANIFEST.private.json'),JSON.stringify(manifest,null,2));
 console.log(JSON.stringify({project:manifest.project,deployExecuted:false,functions:Object.fromEntries(Object.entries(manifest.functions).map(([n,v])=>[n,{previousRevision:v.previousRevision,changed:v.changed,unchangedFiles:v.unchangedFiles}]))}));return manifest;
}
function prepareFrontend(out){
 out=path.resolve(out);assert.ok(!fs.existsSync(out));fs.mkdirSync(out,{recursive:true});
 const forward=path.join(out,'forward'),rollback=path.join(out,'rollback');
 const built=require('./build-public-site.cjs').buildPublicSite({root,outDir:forward});fs.cpSync(forward,rollback,{recursive:true});
 const module=path.join(rollback,'js/fiado-space-regularization.js'),s=read(module);assert.ok(s.includes('const ENABLED=true;'));
 fs.writeFileSync(module,s.replace('const ENABLED=true;','const ENABLED=false;'));
 const worker=path.join(rollback,'service-worker.js');fs.writeFileSync(worker,read(worker).replace('veconi-v2385-space-regularization-v1','veconi-v2385-space-regularization-paused-v1'));
 const manifest={files:built.fileCount,forward:tree(forward),rollback:tree(rollback),rollbackBehavior:'Hide new regularizations; preserve per-space proof display, receipts and all published features.',deployExecuted:false};
 assert.equal(Object.keys(manifest.forward).length,277);assert.equal(Object.keys(manifest.rollback).length,277);
 fs.writeFileSync(path.join(out,'MANIFEST.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({files:277,forward:true,compatibleRollback:true,deployExecuted:false}));return manifest;
}
if(require.main===module){if(process.argv[2]==='--frontend')prepareFrontend(process.argv[3]);else prepare(process.argv[2]);}module.exports={prepare,prepareFrontend};
