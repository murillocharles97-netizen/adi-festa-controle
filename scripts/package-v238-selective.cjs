'use strict';
// Local artifact preparation only. Inputs are private, previously downloaded active source trees.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex'),read=p=>fs.readFileSync(p,'utf8').replace(/\r\n/g,'\n');
const targets={commitOperationalSync:'commitoperationalsync-00022-jim',readOperationalWorkspace:'readoperationalworkspace-00003-xiw',getPerformancePage:'getperformancepage-00003-dad'};
const allowed={commitOperationalSync:['src/services/operational-commit-service.js','src/services/flexible-service-validation.js','src/services/sale-cost-service.js','src/shared/commercial-commit-engine.js','src/shared/flexible-service.js','src/shared/product-model.js'],readOperationalWorkspace:['src/shared/operational-privacy-policy.js'],getPerformancePage:['src/services/performance-read-service.js','src/shared/flexible-service.js']};
function edit(file,from,to){const s=read(file);assert.ok(s.includes(from),'Patch anchor not found: '+path.basename(file));fs.writeFileSync(file,s.replace(from,to));}
function tree(dir,base=dir,out={}){for(const e of fs.readdirSync(dir,{withFileTypes:true})){assert.ok(!e.isSymbolicLink());if(e.name==='node_modules')continue;const f=path.join(dir,e.name);if(e.isDirectory())tree(f,base,out);else out[path.relative(base,f).replaceAll('\\','/')]=sha(fs.readFileSync(f));}return out;}
function prepare(activeDir,outDir){
 activeDir=path.resolve(activeDir);outDir=path.resolve(outDir);assert.ok(!fs.existsSync(outDir),'Output must be new');
 const results={project:'adi-festa-controle',region:'southamerica-east1',candidate:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),preparedAt:new Date().toISOString(),deployExecuted:false,functions:{}};
 for(const[name,revision]of Object.entries(targets)){
  const before=path.join(activeDir,name),meta=JSON.parse(read(path.join(activeDir,name+'.json')));assert.equal(meta.revision,revision);assert.equal(meta.state,'ACTIVE');assert.equal(meta.runtime,'nodejs22');assert.ok(meta.resource.endsWith('/'+name));
  assert.equal(sha(fs.readFileSync(path.join(activeDir,name+'.zip'))),meta.sourceSha256);
  const dest=path.join(outDir,name),functions=path.join(dest,'forward','functions'),rollback=path.join(dest,'rollback','functions');fs.mkdirSync(functions,{recursive:true});fs.cpSync(before,functions,{recursive:true});
  const dst=p=>path.join(functions,p),repo=p=>path.join(root,'functions',p);
  if(name==='commitOperationalSync'){
   // Stock alias validation remains byte-for-byte the active 00022-jim block.
   edit(dst('src/services/operational-commit-service.js'),"const SaleMoney=require('../shared/sale-money');","const SaleMoney=require('../shared/sale-money');\nconst {validateFlexibleServices}=require('./flexible-service-validation');");
   edit(dst('src/services/operational-commit-service.js'),'   await validate(tx,c,item,attemptWrites,plan,get,writes,historyAccount);','   await validate(tx,c,item,attemptWrites,plan,get,writes,historyAccount);\n   await validateFlexibleServices({c,writes:attemptWrites,plan,get,ref,FieldValue});');
   for(const file of ['src/services/flexible-service-validation.js','src/shared/flexible-service.js'])fs.copyFileSync(repo(file),dst(file));
   const engine='src/shared/commercial-commit-engine.js',reference=cp.execFileSync('git',['show','c94f60a:functions/'+engine],{cwd:root});assert.equal(sha(Buffer.from(read(dst(engine)))),sha(Buffer.from(reference.toString().replace(/\r\n/g,'\n'))),'Active engine has unreviewed differences');fs.copyFileSync(repo(engine),dst(engine));
   const model=read(repo('src/shared/product-model.js')),start=model.indexOf('    if(atual?.serviceConfig&&'),end=model.indexOf('    v.estoque=v.estoqueAtual;');assert.ok(start>0&&end>start);edit(dst('src/shared/product-model.js'),'    v.estoque=v.estoqueAtual;',model.slice(start,end)+'    v.estoque=v.estoqueAtual;');
   edit(dst('src/services/sale-cost-service.js'),'resolved=costs.get(key),','resolved=costs.get(item.serviceExecution?`service:${item.serviceExecution.id}`:key),');
   edit(dst('src/services/sale-cost-service.js'),'custoUnitario,custoTotal:lineCost,lucro:', 'custoUnitario,...(resolved?.serviceCostSnapshot?{serviceCostSnapshot:resolved.serviceCostSnapshot}:{}),custoTotal:lineCost,lucro:');
   const source=read(path.join(before,'src/services/operational-commit-service.js')),a=source.indexOf('   if(!vid){\n    const original=writes.find'),b=source.indexOf('   const held=',a);assert.ok(a>0&&b>a);assert.ok(read(dst('src/services/operational-commit-service.js')).includes(source.slice(a,b)),'Stock alias gate changed');
   assert.ok(!read(dst('src/services/operational-commit-service.js')).includes("kind==='payment_recovery_apply'"),'Unpublished recovery mode must not be introduced');
  }else if(name==='readOperationalWorkspace')edit(dst('src/shared/operational-privacy-policy.js'),"'campaignDiscounts','recurringActivation'","'campaignDiscounts','recurringActivation','serviceExecution'");
  else{
   fs.copyFileSync(repo('src/services/performance-read-service.js'),dst('src/services/performance-read-service.js'));fs.copyFileSync(repo('src/shared/flexible-service.js'),dst('src/shared/flexible-service.js'));
   assert.ok(read(dst('src/services/performance-read-service.js')).includes("!has('reports.view')||!has('performance.history')"),'V224 history permission must stay enforced');
  }
  const old=tree(before),forward=tree(functions),changed=Object.keys(forward).filter(f=>old[f]!==forward[f]);assert.deepEqual(Object.keys(old).filter(f=>!forward[f]),[],'No active source may be deleted');assert.deepEqual([...changed].sort(),[...allowed[name]].sort(),'Unexpected source difference');
  fs.mkdirSync(rollback,{recursive:true});fs.cpSync(name==='commitOperationalSync'?functions:before,rollback,{recursive:true});
  if(name==='commitOperationalSync'){
   const helper=path.join(rollback,'src/services/flexible-service-validation.js');edit(helper,'  const old=async(col,id)=>',"  if(writes.some(w=>w.entityType==='sales'&&w.operation==='create'&&w.data?.itens?.some(i=>i.serviceExecution)||w.entityType==='products'&&w.data?.serviceConfig))throw new HttpsError('failed-precondition','Novas execuções de serviço estão temporariamente pausadas. A operação original foi preservada.');\n  const old=async(col,id)=>");
  }
  for(const mode of ['forward','rollback']){fs.writeFileSync(path.join(dest,mode,'firebase.json'),JSON.stringify({functions:{source:'functions',runtime:'nodejs22',ignore:['node_modules','.git','test','firebase-debug.log']}},null,2)+'\n');fs.writeFileSync(path.join(dest,mode,'.firebaserc'),JSON.stringify({projects:{default:'adi-festa-controle'}},null,2)+'\n');}
  results.functions[name]={previousRevision:revision,activeSourceSha256:meta.sourceSha256,changed,unchangedFiles:Object.keys(old).filter(f=>old[f]===forward[f]).length,forward:tree(functions),rollback:tree(rollback),deployOnly:'functions:'+name,sourceBackup:path.join(activeDir,name+'.zip')};
 }
 // Exact Git/Linux bytes of the stable frontend, no secret files or repository upload.
 const manifest=JSON.parse(cp.execFileSync('git',['show','c94f60a:public-site.manifest.json'],{cwd:root,encoding:'utf8'})),front=path.join(outDir,'frontend-rollback-v237');fs.mkdirSync(front,{recursive:true});
 for(const f of manifest.files){const target=path.join(front,f);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,cp.execFileSync('git',['show','c94f60a:'+f],{cwd:root,maxBuffer:20*1024*1024}));}fs.writeFileSync(path.join(front,'CNAME'),'veconi.app.br\n');results.frontendRollback=tree(front);
 // Prepare the restrictive Rules delta from the active policy, never the root policy.
 const activeRules=path.join(activeDir,'firestore.rules'),rulesDir=path.join(outDir,'rules');fs.mkdirSync(rulesDir,{recursive:true});
 results.rules=require('./prepare-v238-rules.cjs').prepare(activeRules,path.join(rulesDir,'firestore.selective.rules'));
 assert.equal(results.rules.activeSha256,'016d78efa26bc7a248738c28e9912d874f6d819243a6849264ad4af58090540d','Active Rules changed; revalidate before preparing');
 fs.copyFileSync(activeRules,path.join(rulesDir,'firestore.active.rollback-evidence.rules'));
 fs.writeFileSync(path.join(rulesDir,'firebase.json'),JSON.stringify({firestore:{rules:'firestore.selective.rules'}},null,2)+'\n');fs.writeFileSync(path.join(rulesDir,'.firebaserc'),JSON.stringify({projects:{default:results.project}},null,2)+'\n');
 // Export only HEAD public resources in canonical Git/Linux bytes, then run the official allowlist builder.
 const source=path.join(outDir,'frontend-git-source'),pub=JSON.parse(cp.execFileSync('git',['show',results.candidate+':public-site.manifest.json'],{cwd:root,encoding:'utf8'}));fs.mkdirSync(source,{recursive:true});
 for(const f of [...pub.files,'public-site.manifest.json']){const target=path.join(source,f);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,cp.execFileSync('git',['show',results.candidate+':'+f],{cwd:root,maxBuffer:20*1024*1024}));}
 const built=require('./build-public-site.cjs').buildPublicSite({root:source,outDir:path.join(source,'dist-public')});assert.equal(built.fileCount,276);results.frontend={commit:results.candidate,count:built.fileCount,resources:tree(built.outDir),workflowIndexStampOnly:true};
 fs.writeFileSync(path.join(outDir,'MANIFEST.private.json'),JSON.stringify(results,null,2));
 console.log(JSON.stringify({project:results.project,region:results.region,candidate:results.candidate,functions:Object.fromEntries(Object.entries(results.functions).map(([n,v])=>[n,{previousRevision:v.previousRevision,changed:v.changed,unchangedFiles:v.unchangedFiles}])),deployExecuted:false}));return results;
}
if(require.main===module){const[a,b]=process.argv.slice(2);assert.ok(a&&b,'Use ACTIVE_SOURCE_DIR NEW_PRIVATE_OUTPUT');prepare(a,b);}module.exports={prepare,targets};
