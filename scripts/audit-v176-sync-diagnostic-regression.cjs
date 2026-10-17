'use strict';
// Offline evidence regression. Reads the supplied export and the previously saved
// read-only audit. Does not import Firebase or execute Sync/bootstrap/persistence.
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),audit=require(path.join(root,'js/integrity.js'));
const supplied=process.argv[2];if(!supplied)throw Error('Informe o caminho do diagnóstico V176.');
const diagnostic=JSON.parse(fs.readFileSync(supplied,'utf8')),cloud=JSON.parse(fs.readFileSync(path.join(root,'artifacts/v176-sync-readonly/cloud-audit.json'),'utf8'));
assert.equal(String(diagnostic.build.release),'176');assert.equal(diagnostic.businessId,cloud.businessId);
const source=fs.readFileSync(path.join(root,'js/firebase/sync.js'),'utf8'),ui=fs.readFileSync(path.join(root,'js/firebase/firebase-ui.js'),'utf8'),slice=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));
const ids=diagnostic.saleIntegrity.localWithoutQueue.map(x=>x.saleId),metadata=new Map(diagnostic.entities.sales.map(x=>[x.documentId,x])),sales=cloud.cloudMarkerCandidates.sales.filter(x=>ids.includes(x.id)).map(x=>({...x,exportedChecksum:metadata.get(x.id).checksum}));
assert.equal(sales.length,6);assert.equal(diagnostic.queueCounts.total,0);
const data={vendas:sales,pagamentos:[],clientes:cloud.documents.clients.filter(x=>!audit.historicalClient(x))},before=JSON.stringify(data),proofBefore=JSON.stringify(diagnostic),c={Date,Map,Set,Math,JSON,Number,String,currentUser:{uid:'offline-regression'},state:{dataAudit:diagnostic.lastCloudComparison},activeBusinessId:()=>diagnostic.businessId,DB:{carregar:()=>data},readQueue:()=>[],checksumValue:x=>x.exportedChecksum,window:{IntegrityAudit:audit}};
vm.createContext(c);vm.runInContext(slice(source,'function diagnosticOperationEvidence(','const queueErrorBreakdown ='),c);
// The export has metadata/hash rather than complete local sale payloads. The
// evidence check uses those exact exported hashes; this is not a new device read.
const operations=c.saleIntegrityDiagnostics();assert.equal(operations.count,0);assert.equal(operations.confirmedRemotely.length,6);assert.equal(operations.verificationPending.length,0);
assert.deepEqual(data.clientes.map(x=>x.id).sort(),diagnostic.entities.clients.map(x=>x.documentId).sort());
const scope=audit.balanceScope(data.clientes,cloud.documents.clients);assert.equal(scope.localActiveDebt,7508.5);assert.equal(scope.remoteActiveDebt,7508.5);assert.equal(scope.remoteHistoricalDebt,36.5);assert.equal(scope.remoteTotalDebt,7545);assert.equal(scope.operationalMatches,true);
const collections=structuredClone(diagnostic.lastCloudComparison.collections),variants=collections.productVariants,normalized=[];
for(const row of variants.divergent){
  assert.deepEqual(row.fields,['minStock']);const remote=cloud.variants.find(x=>x.id===row.documentId);assert.ok(remote);assert.equal(remote.minStock,undefined);assert.equal(remote.estoqueMinimo,undefined);
  // Explicit semantic fixture: absent remote minimum vs local zero produced by
  // storage's default. The source JSON does not export the local field value.
  const localDoc={id:row.documentId,minStock:0},remoteDoc={id:row.documentId},snapshot=JSON.stringify({localDoc,remoteDoc});assert.equal(audit.compare('productVariants',localDoc,remoteDoc).equal,true);assert.equal(JSON.stringify({localDoc,remoteDoc}),snapshot);
  variants.equal.push(row.local);normalized.push(row.documentId);
}
variants.divergent=[];
const integrity=audit.severity(collections,diagnostic.lastCloudComparison.financial.balanceAudit);assert.equal(integrity.level,'INFORMATIVO');assert.equal(integrity.actionable,false);
const view={window:{},Date};vm.createContext(view);vm.runInContext(slice(ui,'const escape=','function showDuplicates(')+slice(ui,'const money=','async function exportDiagnostic('),view);
const reportContext={window:{IntegrityAudit:audit},data,raw:{clients:{remoteItems:cloud.documents.clients}},collections,balanceAudit:diagnostic.lastCloudComparison.financial.balanceAudit,businessId:diagnostic.businessId,deviceId:()=> 'offline-regression',now:()=>diagnostic.generatedAt,queueCounts:()=>diagnostic.queueCounts};
vm.createContext(reportContext);vm.runInContext(slice(source,'  const balanceScope=window.IntegrityAudit.balanceScope(','  lastDataAuditRaw = {')+'\nthis.rebuiltReport=report;',reportContext);
const report=reportContext.rebuiltReport;assert.equal(report.financial.balanceDifference,0);assert.equal(report.financial.balanceDifferenceIncludingHistory,36.5);assert.equal(report.integrity.actionable,false);
const html=view.dataAuditHtml(report);assert.match(html,/Sem divergência operacional/);assert.match(html,/7\.508,50/);assert.match(html,/36,50/);assert.doesNotMatch(html,/semantic_difference/);
assert.equal(JSON.stringify(data),before);assert.equal(JSON.stringify(diagnostic),proofBefore);
const result={mode:'offline-read-only-regression',productionReads:0,productionWrites:0,cacheWrites:0,build:diagnostic.build,exportGeneratedAt:diagnostic.generatedAt,comparisonAt:diagnostic.lastCloudComparison.generatedAt,orphansBefore:diagnostic.orphanOperations,orphansAfter:operations.count,remoteConfirmedWithoutLocalMarker:operations.confirmedRemotely.length,scope,variantSemanticFixtureIds:normalized,variantLocalValuesAvailableInExport:false,integrity,sourceExportUnchanged:true,limitations:['Exported sale hashes validate metadata evidence; no new device snapshot was read.','Variant equality uses the documented zero default; the export omits full local field values.','Saved cloud evidence and device export have different collection timestamps.']};
fs.mkdirSync(path.join(root,'artifacts/v176-sync-diagnostic-fix'),{recursive:true});fs.writeFileSync(path.join(root,'artifacts/v176-sync-diagnostic-fix/regression.json'),JSON.stringify(result,null,2));
console.log(JSON.stringify({mode:result.mode,orphansBefore:result.orphansBefore,orphansAfter:result.orphansAfter,remoteConfirmed:result.remoteConfirmedWithoutLocalMarker,activeDebt:scope.remoteActiveDebt,preservedHistoricalDebt:scope.remoteHistoricalDebt,integrityLevel:integrity.level,actionable:integrity.actionable,productionReads:0,productionWrites:0,cacheWrites:0},null,2));
