'use strict';
// Local-only release evidence. Never calls Firebase, a browser or a deploy tool.
const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process'),{pathToFileURL}=require('node:url');
const root=path.resolve(__dirname,'..'),baseline=path.resolve(process.argv[2]||''),output=path.resolve(process.argv[3]||path.join(root,'docs/preflight/v194-test-comparison.json'));
if(!process.argv[2]||baseline===root)throw Error('Informe um checkout V193 separado e intacto.');
const git=(cwd,args)=>{const r=spawnSync('git',['-c','core.bare=false',...args],{cwd,encoding:'utf8'});if(r.status!==0)throw Error(r.stderr);return r.stdout.trim();};
const baseCommit='3d9ef19f4b5df7a7534647185bf3a32d042ca065';
if(git(baseline,['rev-parse','HEAD'])!==baseCommit||git(baseline,['status','--porcelain','--untracked-files=no']))throw Error('A base V193 precisa estar no commit publicado, sem alterações rastreadas.');
function run(cwd){
 const r=spawnSync(process.execPath,['--test',`--test-reporter=${pathToFileURL(path.join(root,'scripts/release-test-reporter.cjs')).href}`,'tests/*.test.js'],{cwd,encoding:'utf8',maxBuffer:32*1024*1024});
 if(r.error||r.status===null)throw r.error||Error('A execução não terminou.');
 const rows=r.stdout.split(/\r?\n/).filter(Boolean).map(line=>JSON.parse(line)),summary=rows.filter(v=>v.summary&&!v.summary.file).at(-1)?.summary;
 if(!summary)throw Error(`Sem resumo: ${r.stderr.slice(-500)}`);
 const failures=rows.filter(v=>v.name).map(v=>({name:v.name.replaceAll('\\','/'),file:path.relative(cwd,v.file).replaceAll('\\','/'),line:v.line,error:v.error.replaceAll(cwd,'<checkout>').replaceAll(cwd.replaceAll('\\','/'),'<checkout>')})).sort((a,b)=>(a.file+'|'+a.name).localeCompare(b.file+'|'+b.name));
 return {commit:git(cwd,['rev-parse','HEAD']),trackedChanges:Boolean(git(cwd,['status','--porcelain','--untracked-files=no'])),exitCode:r.status,counts:summary.counts,failures};
}
const before=run(baseline),current=run(root),key=v=>`${v.file}|${v.name}`,baseKeys=new Set(before.failures.map(key)),currentKeys=new Set(current.failures.map(key));
const introduced=current.failures.filter(v=>!baseKeys.has(key(v))),resolved=before.failures.filter(v=>!currentKeys.has(key(v))),newExchangeFailures=current.failures.filter(v=>/exchange|troca/i.test(v.file));
const report={generatedAt:new Date().toISOString(),node:process.version,baseline:before,candidate:current,comparison:{exactSameFailureIdentities:introduced.length===0&&resolved.length===0,introduced,resolved,newExchangeFailures},note:'Falhas identificadas por arquivo+nome do teste; mensagens e linhas preservadas para inspeção. Totais do candidato podem mudar com novos testes ou correções explícitas de metadados da release.'};
fs.mkdirSync(path.dirname(output),{recursive:true});fs.writeFileSync(output,JSON.stringify(report,null,2)+'\n');
process.stdout.write(JSON.stringify({baseline:before.counts,candidate:current.counts,...report.comparison,output},null,2)+'\n');
if(introduced.length||newExchangeFailures.length)process.exitCode=1;
