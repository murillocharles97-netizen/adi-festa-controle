'use strict';
// Read-only, explicitly scoped to the business in both supplied exports.
// Uses the existing authenticated Firebase CLI session; never logs credentials.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process');
const [backupPath,diagnosticPath]=process.argv.slice(2);
if(!backupPath||!diagnosticPath)throw Error('Usage: node audit-integrity-readonly-v157.cjs backup.json diagnostic.json');
const backup=JSON.parse(fs.readFileSync(backupPath,'utf8')),diagnostic=JSON.parse(fs.readFileSync(diagnosticPath,'utf8'));
if(backup.businessId!==diagnostic.businessId||backup.projectId!=='adi-festa-controle'||!/^[-\w]+$/.test(backup.businessId))throw Error('Business/project mismatch');
const projectId=backup.projectId,businessId=backup.businessId;
const names={clients:'clientes',products:'produtos',productVariants:'variacoesProdutos',sales:'vendas',payments:'pagamentos',balanceAdjustments:'movimentacoes',productFinancials:'productFinancials',variantFinancials:'variantFinancials',saleFinancials:'saleFinancials'};
function decode(v){if('nullValue'in v)return null;if('timestampValue'in v)return new Date(v.timestampValue).toISOString();if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('doubleValue'in v)return Number(v.doubleValue);if('arrayValue'in v)return(v.arrayValue.values||[]).map(decode);if('mapValue'in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));throw Error('Unsupported Firestore type');}
const stable=x=>Array.isArray(x)?x.map(stable):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,stable(x[k])])):x;
function differences(a,b,p=''){if(JSON.stringify(stable(a))===JSON.stringify(stable(b)))return[];if(a&&b&&typeof a==='object'&&typeof b==='object')return [...new Set([...Object.keys(a),...Object.keys(b)])].sort().flatMap(k=>differences(a[k],b[k],p?`${p}.${k}`:k));return[{field:p,localType:a===undefined?'missing':a===null?'null':typeof a,remoteType:b===undefined?'missing':b===null?'null':typeof b}];}
const source=fs.readFileSync('js/firebase/sync.js','utf8'),utils=fs.readFileSync('js/firebase/firestore-utils.js','utf8').replaceAll('export ','');
const ctx=vm.createContext({Date,WeakSet,console});
vm.runInContext(utils+'\n'+source.slice(source.indexOf('const stableComparable ='),source.indexOf('const containsInvalidFirestoreValue ='))+'\nthis.hash=checksumValue;',ctx);
// Clone into that realm so the sanitizer's Object.prototype test is faithful.
const hash=x=>{ctx.input=JSON.stringify(x);return vm.runInContext('hash(JSON.parse(input))',ctx)};
async function main(){
 const root=(process.platform==='win32'?execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm root -g'],{encoding:'utf8'}):execFileSync('npm',['root','-g'],{encoding:'utf8'})).trim();
 const auth=createRequire(path.join(root,'firebase-tools/package.json'))('./lib/auth'),account=auth.getGlobalDefaultAccount();
 if(!account?.tokens?.refresh_token)throw Error('Firebase CLI is not authenticated');
 const token=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
 const remote={},reads={};
 for(const name of Object.keys(names)){
   const rows=[];let next='';
   do {const url=new URL(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/businesses/${businessId}/${name}`);url.searchParams.set('pageSize','1000');if(next)url.searchParams.set('pageToken',next);
     const response=await fetch(url,{headers:{Authorization:`Bearer ${token}`}});if(!response.ok)throw Error(`Firestore read ${name}: HTTP ${response.status}`);
     const body=await response.json();for(const doc of body.documents||[])rows.push({id:doc.name.split('/').at(-1),...Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,decode(v)]))});next=body.nextPageToken||'';
   }while(next);
   remote[name]=rows;reads[name]=rows.length;
 }
 const audit=require('../js/integrity.js');
 const phoneContext={window:{}};vm.createContext(phoneContext);vm.runInContext(fs.readFileSync('js/phone.js','utf8'),phoneContext);
 const report={mode:'read-only',at:new Date().toISOString(),backupAt:backup.exportedAt,diagnosticAt:diagnostic.generatedAt,businessId,reads,collections:{}};
 for(const[name,key]of Object.entries(names)){
  const local=backup[key].filter(x=>name!=='balanceAdjustments'||x.tipo==='ajuste_saldo'),rm=new Map(remote[name].map(x=>[x.id,x]));
  const diagRows=diagnostic.lastCloudComparison.collections[name]||{divergent:[],equal:[]},dm=new Map([...diagRows.divergent.map(x=>x.remote),...diagRows.equal].map(x=>[x.documentId,x]));
  const histogram={},samples=[],semanticDifferences=[];let different=0,unchangedRemoteHash=0,matchingLocalHash=0;
  for(const item of local){const other=rm.get(item.id);if(!other)continue;const d=dm.get(item.id);if(d&&hash(other)===d.checksum)unchangedRemoteHash++;
   const original=structuredClone(item);
   // Backup export adds operationId to variants; diagnostic proves it was absent.
   if(name==='productVariants'&&original.operationId===original.id&&!d?.operationId)delete original.operationId;
   const protectedName={products:'productFinancials',productVariants:'variantFinancials',sales:'saleFinancials'}[name];
   const semantic=audit.compare(name,original,other,{businessId,normalizePhone:phoneContext.window.PhoneUtils.normalizeBrazilianPhone,localFinancial:backup[protectedName]?.find(x=>x.id===item.id),remoteFinancial:remote[protectedName]?.find(x=>x.id===item.id)});
   if(!semantic.equal)semanticDifferences.push({id:item.id,fields:semantic.fields});
   const lm=diagRows.divergent.find(x=>x.documentId===item.id)?.local||diagRows.equal.find(x=>x.documentId===item.id);if(lm&&hash(item)===lm.checksum)matchingLocalHash++;
   const changes=differences(item,other);if(changes.length)different++;
   for(const change of changes){const f=change.field.replace(/\.\d+(?=\.|$)/g,'.*');histogram[f]=(histogram[f]||0)+1;}
   if(samples.length<5&&changes.length)samples.push({id:item.id,remoteMatchesDiagnostic:!!d&&hash(other)===d.checksum,localMatchesDiagnostic:!!lm&&hash(item)===lm.checksum,fields:changes});
  }
  report.collections[name]={local:local.length,remote:remote[name].length,different,unchangedRemoteHash,matchingLocalHash,fields:histogram,samples,semanticDifferences};
 }
 const lm=new Map(backup.clientes.map(x=>[x.id,x])),rm=new Map(remote.clients.map(x=>[x.id,x]));
 const contributions=[...new Set([...lm.keys(),...rm.keys()])].map(id=>{const l=lm.get(id),r=rm.get(id);return{clientId:id,local:l?Number(l.saldo||0):null,remote:r?Number(r.saldo||0):null,difference:Math.round((Number(l?.saldo||0)-Number(r?.saldo||0))*100)/100,localActive:l?.ativo??l?.active??null,remoteActive:r?.active??r?.ativo??null,localDeleted:!!l?.deletedAt,remoteDeleted:!!r?.deletedAt,origin:!r?'only-local':!l?'only-remote':'common'}}).filter(x=>x.difference!==0);
 report.balance={local:Math.round(backup.clientes.reduce((s,x)=>s+Number(x.saldo||0),0)*100)/100,remote:Math.round(remote.clients.reduce((s,x)=>s+Number(x.saldo||0),0)*100)/100,contributions};
 const suspect=new Set(['c1','c2','p1','p2','p3']);
 report.fixtureReferences=Object.fromEntries(Object.entries(backup).filter(([,v])=>Array.isArray(v)).map(([key,rows])=>[key,rows.filter(x=>!suspect.has(x.id)&&JSON.stringify(x).match(/"(?:c1|c2|p1|p2|p3)"/)).length]).filter(([,n])=>n));
 console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error('[integrity read-only]',e.message);process.exitCode=1});
