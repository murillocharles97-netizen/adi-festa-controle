'use strict';
const fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'..'),source=fs.readFileSync(path.join(root,'js/firebase/sync.js'),'utf8').replaceAll('\r\n','\n');
const start=source.indexOf('function financialLedgerEntry('),end=source.indexOf('async function compareDeviceWithCloud(',start);
if(start<0||end<start)throw Error('Maintenance audit extraction boundary missing');
const output=`'use strict';\n// GENERATED from the existing read-only audit. Server supplies canonical sources only.\nconst roundedMoney=n=>Math.round(Number(n)*100)/100,financialKey=x=>x.operationId||x.idempotencyKey||x.id;\nconst balanceEffectId=(type,id)=>type+':'+id,now=()=>new Date().toISOString(),checksumValue=x=>require('node:crypto').createHash('sha256').update(JSON.stringify(x)).digest('hex');\n${source.slice(start,end)}\nmodule.exports={buildFinancialBalanceAudit};\n`;
const target=path.join(root,'functions/src/shared/financial-maintenance-audit.js');
if(process.argv.includes('--check')){if(fs.readFileSync(target,'utf8')!==output)throw Error('Regenerate maintenance audit');}else fs.writeFileSync(target,output);
