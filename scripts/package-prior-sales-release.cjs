'use strict';
// Prepares local artifacts only. No deploy, network, Git mutation, credential
// access, storage cleanup, or production data operation is performed.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),sha=v=>crypto.createHash('sha256').update(v).digest('hex');
function prepare({outDir,publicDir}){
  const branch=cp.execFileSync('git',['branch','--show-current'],{cwd:root,encoding:'utf8'}).trim();assert.equal(branch,JSON.parse(fs.readFileSync(path.join(root,'releases/v226/deploy-manifest.json'),'utf8')).branch);
  outDir=path.resolve(outDir);publicDir=path.resolve(publicDir);assert.ok(!fs.existsSync(outDir)&&!fs.existsSync(publicDir),'Use new output directories; existing artifacts must be preserved');
  const gate=JSON.parse(cp.execFileSync(process.execPath,['scripts/verify-prior-sales-release.cjs'],{cwd:root,encoding:'utf8'}));assert.equal(gate.productionReady,false);
  const manifest=JSON.parse(fs.readFileSync(path.join(root,'releases/v226/deploy-manifest.json'),'utf8'));
  const publicBuild=require('./build-public-site.cjs').buildPublicSite({outDir:publicDir});
  fs.mkdirSync(outDir,{recursive:true});const backend=path.join(outDir,'backend');fs.mkdirSync(path.join(backend,'functions'),{recursive:true});
  fs.cpSync(path.join(root,'functions/src'),path.join(backend,'functions/src'),{recursive:true});
  for(const file of ['package.json','package-lock.json'])fs.copyFileSync(path.join(root,'functions',file),path.join(backend,'functions',file));
  fs.writeFileSync(path.join(backend,'firebase.json'),JSON.stringify({functions:{source:'functions',runtime:'nodejs22',ignore:['node_modules','.git','test','firebase-debug.log']}},null,2)+'\n');
  const rulesDir=path.join(outDir,'rules');fs.mkdirSync(rulesDir);fs.copyFileSync(path.join(root,manifest.firestore.candidate),path.join(rulesDir,'firestore.rules'));fs.writeFileSync(path.join(rulesDir,'firebase.json'),JSON.stringify({firestore:{rules:'firestore.rules'}},null,2)+'\n');
  const rollback=path.join(outDir,'rollback');fs.cpSync(backend,path.join(rollback,'backend'),{recursive:true});fs.cpSync(publicDir,path.join(rollback,'frontend'),{recursive:true});
  const rbIndex=path.join(rollback,'backend/functions/src/index.js'),rbBuild=path.join(rollback,'frontend/js/build-info.js'),rbWorker=path.join(rollback,'frontend/service-worker.js');
  let index=fs.readFileSync(rbIndex,'utf8');assert.ok(index.includes("enabled:process.env.PRIOR_SALES_ENABLED!=='false'"));fs.writeFileSync(rbIndex,index.replace("enabled:process.env.PRIOR_SALES_ENABLED!=='false'",'enabled:false'));
  let build=fs.readFileSync(rbBuild,'utf8');assert.ok(build.includes('priorSalesPaused: false'));fs.writeFileSync(rbBuild,build.replace('priorSalesPaused: false','priorSalesPaused: true'));
  fs.writeFileSync(rbWorker,fs.readFileSync(rbWorker,'utf8').replace('veconi-v226-prior-sales-v1','veconi-v226-prior-sales-hold'));
  const hashes=[];function walk(dir,prefix){for(const entry of fs.readdirSync(dir,{withFileTypes:true})){assert.ok(!entry.isSymbolicLink(),'Symlinks may not be packaged');const rel=path.posix.join(prefix,entry.name),file=path.join(dir,entry.name);if(entry.isDirectory())walk(file,rel);else{assert.ok(!entry.name.startsWith('.env')&&!entry.name.endsWith('.dpapi'),'Private configuration rejected');hashes.push({path:rel,sha256:sha(fs.readFileSync(file))});}}}
  walk(backend,'backend');walk(rulesDir,'rules');walk(rollback,'rollback');walk(publicDir,'frontend');
  const result={preparedAt:new Date().toISOString(),release:226,branch,headAtPreparation:cp.execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),manifest,backend,publicBuild,rollback,hashes,productionReady:false,requiresPublishedV225Integration:!manifest.integrationCompletedLocally,deployExecuted:false};
  fs.writeFileSync(path.join(outDir,'PACKAGE.json'),JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify({release:226,outDir,publicBuild,functions:[...manifest.functions.update,...manifest.functions.create],rollback,productionReady:false,deployExecuted:false},null,2));return result;
}
if(require.main===module){const [outDir,publicDir]=process.argv.slice(2);assert.ok(outDir&&publicDir,'Usage: node scripts/package-prior-sales-release.cjs NEW_PRIVATE_DIR NEW_PUBLIC_DIR_INSIDE_WORKTREE');prepare({outDir,publicDir});}
module.exports={prepare};
