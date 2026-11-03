'use strict';
// Produces new local artifacts only. Never uploads, deploys or reads credentials.
const fs=require('node:fs'),path=require('node:path'),cp=require('node:child_process'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),sha=b=>crypto.createHash('sha256').update(b).digest('hex');
function prepare({outDir,publicDir}){
 outDir=path.resolve(outDir);publicDir=path.resolve(publicDir);assert.ok(!fs.existsSync(outDir)&&!fs.existsSync(publicDir),'Use new directories; preserve existing artifacts');
 const git=(...a)=>cp.execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();assert.equal(git('branch','--show-current'),'codex/v225-billing-hotfix');
 const gate=JSON.parse(cp.execFileSync(process.execPath,['scripts/verify-billing-release.cjs'],{cwd:root,encoding:'utf8'}));assert.equal(gate.newFunctions,0);
 const manifest=JSON.parse(fs.readFileSync(path.join(root,'releases/v225/deploy-manifest.json'),'utf8')),build=require('./build-public-site.cjs').buildPublicSite({outDir:publicDir}),backend=path.join(outDir,'backend');
 fs.mkdirSync(path.join(backend,'functions'),{recursive:true});fs.cpSync(path.join(root,'functions/src'),path.join(backend,'functions/src'),{recursive:true});
 for(const p of ['package.json','package-lock.json'])fs.copyFileSync(path.join(root,'functions',p),path.join(backend,'functions',p));
 fs.writeFileSync(path.join(backend,'firebase.json'),JSON.stringify({functions:{source:'functions',runtime:'nodejs22',ignore:['node_modules','.git','test','firebase-debug.log']}},null,2)+'\n');
 const rollback=path.join(outDir,'rollback');fs.cpSync(backend,path.join(rollback,'backend'),{recursive:true});fs.cpSync(publicDir,path.join(rollback,'frontend'),{recursive:true});
 const index=path.join(rollback,'backend/functions/src/index.js'),info=path.join(rollback,'frontend/js/build-info.js'),worker=path.join(rollback,'frontend/service-worker.js');
 let code=fs.readFileSync(index,'utf8');assert.ok(code.includes("if(process.env.BILLING_NEW_CHECKOUTS_ENABLED==='false')throw"));fs.writeFileSync(index,code.replace("if(process.env.BILLING_NEW_CHECKOUTS_ENABLED==='false')throw",'if(true)throw'));
 code=fs.readFileSync(info,'utf8');assert.ok(code.includes('billingCheckoutPaused: false'));fs.writeFileSync(info,code.replace('billingCheckoutPaused: false','billingCheckoutPaused: true'));
 code=fs.readFileSync(worker,'utf8');assert.ok(code.includes('veconi-v225-billing-migration-hotfix'));fs.writeFileSync(worker,code.replace('veconi-v225-billing-migration-hotfix','veconi-v225-billing-hold'));
 const hashes=[];function walk(dir,prefix){for(const e of fs.readdirSync(dir,{withFileTypes:true})){assert.ok(!e.isSymbolicLink(),'Symlink rejected');const p=path.join(dir,e.name),rel=path.posix.join(prefix,e.name);if(e.isDirectory())walk(p,rel);else{assert.ok(!e.name.startsWith('.env')&&!/\.(dpapi|zip|log)$/i.test(e.name),'Private file rejected');hashes.push({path:rel,sha256:sha(fs.readFileSync(p))});}}}
 walk(backend,'backend');walk(publicDir,'frontend');walk(rollback,'rollback');
 const result={preparedAt:new Date().toISOString(),release:225,branch:git('branch','--show-current'),headAtPreparation:git('rev-parse','HEAD'),manifest,backend,build,rollback,hashes,deployExecuted:false};fs.writeFileSync(path.join(outDir,'PACKAGE.json'),JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify({release:225,backend,build,rollback,deployExecuted:false},null,2));return result;
}
if(require.main===module){const [outDir,publicDir]=process.argv.slice(2);assert.ok(outDir&&publicDir,'Provide NEW_PRIVATE_OUTPUT NEW_PUBLIC_OUTPUT_INSIDE_WORKTREE');prepare({outDir,publicDir});}module.exports={prepare};
