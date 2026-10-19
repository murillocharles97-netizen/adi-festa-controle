'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const audit=require('../js/integrity'),source=fs.readFileSync('js/firebase/sync.js','utf8'),ui=fs.readFileSync('js/firebase/firebase-ui.js','utf8');
const section=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));
function runtime(data={vendas:[],pagamentos:[]},collections={},businessId='qa'){
  let queue=[];
  const c={Date,console,Map,Set,JSON,Math,Number,String,currentUser:{uid:'qa-owner'},window:{IntegrityAudit:audit},state:{dataAudit:{businessId,generatedAt:'2026-10-17T04:35:20Z',collections}},activeBusinessId:()=> 'qa',DB:{carregar:()=>data},readQueue:()=>queue,checksumValue:item=>JSON.stringify(item)};
  vm.createContext(c);vm.runInContext(section(source,'function diagnosticOperationEvidence(', 'const queueErrorBreakdown ='),c);
  return {c,setQueue:q=>queue=q,diagnostics:()=>c.saleIntegrityDiagnostics()};
}
const sale=(id='qa-sale')=>({id,operationId:'op-'+id,syncPipelineVersion:2,source:'online_store',spaceId:'qa-space',valorFinal:25});
const metadata=x=>({documentId:x.id,operationId:x.operationId,checksum:JSON.stringify(x)});
test('remote-confirmed QA sale without local marker is informational, never an orphan',()=>{
  const s=sale(),data={vendas:[s],pagamentos:[]},before=JSON.stringify(data),h=runtime(data,{sales:{equal:[metadata(s)],onlyLocal:[]}}),d=h.diagnostics();
  assert.equal(d.count,0);assert.equal(d.localWithoutQueue.length,0);assert.equal(d.confirmedRemotely.length,1);assert.equal(d.confirmedRemotely[0].category,'synchronized_without_local_marker');assert.equal(d.confirmedRemotely[0].spaceId,'qa-space');assert.equal(JSON.stringify(data),before);
});
test('a real local-only sale with no queue remains an orphan even with an old local marker',()=>{
  for(const marked of [false,true]){const s={...sale('real'),...(marked?{syncConfirmedAt:'old'}:{})},h=runtime({vendas:[s],pagamentos:[]},{sales:{onlyLocal:[{...metadata(s),classification:'B',queueStatus:'missing'}]}});assert.equal(h.diagnostics().count,1);assert.equal(audit.severity({sales:{onlyLocal:[{...metadata(s),queueStatus:'missing'}]}}).level,'CRITICO');}
});
test('stale payload/operation/business proof never certifies a sale as synchronized',()=>{
  const s=sale(),old=metadata(s),h=runtime({vendas:[s],pagamentos:[]},{sales:{equal:[old]}});s.valorFinal=26;assert.equal(h.diagnostics().confirmedRemotely.length,0);assert.equal(h.diagnostics().verificationPending.length,1);
  s.valorFinal=25;s.operationId='another';assert.equal(h.diagnostics().confirmedRemotely.length,0);
  const other=runtime({vendas:[sale()],pagamentos:[]},{sales:{equal:[metadata(sale())]}},'other-business');assert.equal(other.diagnostics().confirmedRemotely.length,0);
});
test('no audit is unverified, not an assertion that a record is missing remotely',()=>{
  const h=runtime({vendas:[sale()],pagamentos:[]});h.c.state.dataAudit=null;assert.equal(h.diagnostics().count,0);assert.equal(h.diagnostics().verificationPending.length,1);assert.equal(h.diagnostics().confirmedRemotely.length,0);
});
test('a resolved diagnostic warning clears only itself, never a permission/Sync failure',()=>{
  const s=sale(),h=runtime({vendas:[s],pagamentos:[]},{sales:{onlyLocal:[{...metadata(s),classification:'B'}]}}),c=h.c;
  c.navigator={onLine:true};c.queueCounts=()=>({total:0,active:0,errors:0,pending:0});c.emit=patch=>Object.assign(c.state,patch);c.state.status='success';vm.runInContext(section(source,'function preservedQueueMessage(', 'function readQueueReview(')+section(source,'function updateQueueState()','function reportError('),c);
  c.updateQueueState();assert.equal(c.state.status,'error');assert.ok(c.state.queueDiagnosticWarning);
  c.state.dataAudit={businessId:'qa',collections:{sales:{equal:[metadata(s)]}},integrity:{actionable:false}};c.updateQueueState();assert.equal(c.state.status,'success');assert.equal(c.state.queueDiagnosticWarning,null);
  const permission={code:'permission-denied'};c.state.status='error';c.state.message='Falha de permissão';c.state.syncFailure=permission;c.state.queueDiagnosticWarning={businessId:'qa',message:'Falha de permissão'};c.updateQueueState();assert.equal(c.state.status,'error');assert.equal(c.state.syncFailure,permission);assert.equal(c.state.message,'Falha de permissão');
});
test('remote presence with a genuine difference is not orphanhood but remains critical',()=>{
  const s=sale(),row={documentId:s.id,local:metadata(s),fields:['valorFinal']},h=runtime({vendas:[s],pagamentos:[]},{sales:{divergent:[row]}});assert.equal(h.diagnostics().count,0);assert.equal(h.diagnostics().confirmedRemotely[0].category,'remote_present_difference');assert.equal(audit.severity(h.c.state.dataAudit.collections).level,'CRITICO');
});
test('queue added after comparison is pending, not orphaned; queue without local copy still needs attention',()=>{
  const s=sale(),h=runtime({vendas:[s],pagamentos:[]},{sales:{onlyLocal:[{...metadata(s),classification:'B'}]}});h.setQueue([{operationId:s.operationId,payload:{writes:[{entityType:'sales',entityId:s.id,operation:'create'}]}}]);assert.equal(h.diagnostics().count,0);
  h.c.DB.carregar=()=>({vendas:[],pagamentos:[]});assert.equal(h.diagnostics().count,1);assert.equal(h.diagnostics().queueWithoutLocal.length,1);
});
test('payments use the same current-content proof; no local confirmation marker is written',()=>{
  const p={id:'payment',operationId:'pay',syncPipelineVersion:2,valor:10},data={vendas:[],pagamentos:[p]},h=runtime(data,{payments:{equal:[metadata(p)]}}),before=JSON.stringify(data);assert.equal(h.c.paymentIntegrityDiagnostics().count,0);assert.equal(h.c.paymentIntegrityDiagnostics().confirmedRemotely.length,1);assert.equal(JSON.stringify(data),before);
});
test('evidence accepts canonical legacy sourceOperationId and rejects a foreign business record',()=>{
  const item={id:'legacy',sourceOperationId:'source-op',syncPipelineVersion:2},row={documentId:item.id,operationId:'source-op',checksum:JSON.stringify(item)},h=runtime({vendas:[item],pagamentos:[]},{sales:{equal:[row]}});assert.equal(h.diagnostics().confirmedRemotely.length,1);
  item.businessId='other-business';row.checksum=JSON.stringify(item);assert.equal(h.diagnostics().confirmedRemotely.length,0);
});
test('active debt and remote deleted history have independent exact totals, without mutating clients',()=>{
  const local=[{id:'active',saldo:-7508.5}],remote=[...local,{id:'deleted',saldo:-36.5,active:false,ativo:true,deletedAt:'2026-10-05T19:15:07.593Z'}],before=JSON.stringify({local,remote}),s=audit.balanceScope(local,remote);
  assert.equal(s.localActiveDebt,7508.5);assert.equal(s.remoteActiveDebt,7508.5);assert.equal(s.remoteHistoricalDebt,36.5);assert.equal(s.remoteTotalDebt,7545);assert.equal(s.operationalDifference,0);assert.equal(s.operationalMatches,true);assert.equal(s.historicalContributions.length,1);assert.equal(JSON.stringify({local,remote}),before);
});
test('real active differences remain visible, including offsetting per-client differences',()=>{
  const a=[{id:'a',saldo:-10},{id:'b',saldo:-20}],b=[{id:'a',saldo:-20},{id:'b',saldo:-10}],s=audit.balanceScope(a,b);assert.equal(s.operationalDifference,0);assert.equal(s.operationalMatches,false);assert.equal(s.operationalContributions.length,2);
  const changed=audit.compare('clients',{id:'a',saldo:-10},{id:'a',saldo:-20});assert.equal(changed.equal,false);assert.equal(audit.severity({clients:{divergent:[{documentId:'a',fields:changed.fields}]}}).level,'CRITICO');
});
test('variant minStock missing/null/undefined and zero are equivalent; nonzero is never hidden',()=>{
  for(const remote of [{id:'v'},{id:'v',minStock:null},{id:'v',minStock:undefined},{id:'v',minStock:'0'}])assert.equal(audit.compare('productVariants',{id:'v',minStock:0},remote).equal,true);
  assert.equal(audit.compare('productVariants',{id:'v',minStock:0},{id:'v',minStock:2}).equal,false);
  assert.equal(audit.compare('productVariants',{id:'v',minStock:5,estoqueMinimo:5},{id:'v',estoqueMinimo:5}).equal,true);
  assert.equal(audit.compare('productVariants',{id:'v',minStock:0,stock:1},{id:'v',stock:2}).equal,false);
});
function uiRuntime(){const c={window:{},Date};vm.createContext(c);vm.runInContext(section(ui,'const escape=','function showDuplicates(')+section(ui,'const money=','async function exportDiagnostic('),c);return c;}
test('UI explicitly separates active debt, excluded history and genuine review, without repair controls',()=>{
  const c=uiRuntime(),scope=audit.balanceScope([{id:'a',saldo:-7508.5}],[{id:'a',saldo:-7508.5},{id:'deleted',saldo:-36.5,deletedAt:'date'}]),html=c.fiadoScopeHtml(scope,{divergentCount:0});assert.match(html,/Saldo ativo:/);assert.match(html,/7\.508,50/);assert.match(html,/36,50/);assert.match(html,/Sem divergência operacional/);assert.doesNotMatch(html,/data-repair|data-reconcile|Corrigir tudo/);
  const bad=c.fiadoScopeHtml(audit.balanceScope([{id:'a',saldo:-10}],[{id:'a',saldo:-20}]),{divergentCount:1});assert.match(bad,/requer revisão/);assert.doesNotMatch(bad,/Sem divergência operacional/);
  const info=c.operationConfirmationHtml({saleIntegrity:{confirmedRemotely:[{saleId:'<QA>',category:'synchronized_without_local_marker'}]}});assert.match(info,/Não são órfãos/);assert.match(info,/&lt;QA&gt;/);
});
test('cloud and local diagnostic summaries use active scope only; the raw historical total stays available',()=>{
  const data={clientes:[{id:'active',saldo:-10},{id:'old',saldo:-5,deletedAt:'date'}],produtos:[],vendas:[],pagamentos:[]},c={window:{IntegrityAudit:audit},DB:{carregar:()=>data}};vm.createContext(c);vm.runInContext(section(source,'const localSummary =','const stableComparable =')+'\nthis.summary=localSummary;',c);assert.equal(c.summary().fiado,10);const s=c.cloudDebtSummary(data.clientes);assert.equal(s.fiado,10);assert.equal(s.historicalFiado,5);assert.equal(s.fiadoIncludingHistory,15);
});
test('informative history is successful, while real semantic and ledger differences keep their warnings',()=>{
  const c={};vm.createContext(c);vm.runInContext(section(source,'function describeSyncResult(', 'async function runManualSync('),c);
  assert.match(c.describeSyncResult({dataSynced:true,complete:true,integrity:{level:'INFORMATIVO',actionable:false}}),/Sincronizado com sucesso/);
  assert.match(c.describeSyncResult({dataSynced:true,complete:true,integrity:{level:'CRITICO',actionable:true}}),/Integridade crítica/);
});
