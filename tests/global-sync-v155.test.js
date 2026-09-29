const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('js/firebase/sync.js', 'utf8');
const section = (start, end) => source.slice(source.indexOf(start), source.indexOf(end, source.indexOf(start)));
function runtime(options={}) {
  const writes=[], reports=[], trace=[];
  const context={DB:{flush:async()=>{}},lastFullPullForAudit:null,console:{info(){},error(){}}, location:{hostname:'localhost'}, Date,
    window:{BusinessContext:{get:()=>({role:'owner',member:{status:'active',spaceAccess:'all'}})}},
    navigator:{onLine:options.online!==false}, auth:{currentUser:{uid:'qa-owner'}},
    state:{testPassed:true,syncTrace:[],lastSync:'previous',lastCompleteSync:'previous'},
    errorCode:e=>e.code||'', now:()=>new Date().toISOString(),
    localStorage:{setItem(key,value){if(options.metadataQuota)throw Object.assign(Error('quota'),{name:'QuotaExceededError'});writes.push([key,value]);}},
    lastAttemptKey:()=> 'attempt', lastSyncKey:()=> 'sync', lastCompleteKey:()=> 'complete',
    emit:patch=>Object.assign(context.state,patch),updateQueueState(){},
    queueCounts:()=>({total:0,pending:0,errors:0}), activeBusinessId:()=> 'qa-business',
    validateUser:async()=>{},testFirestoreConnection:async()=>{},migrateScopedQueueCompatibility:()=>({}),validateQueueOwnership(){},
    processSyncQueue:async()=>{trace.push('push');return {sent:0,collections:[]};},
    pullCloudCollections:async()=>{trace.push('pull');if(options.pullError)throw options.pullError;return 3;},
    compareLocalAndCloud:async()=>({ok:!options.divergent}),safePublishSyncSignal:async()=>{},
    reportError:(error)=>{reports.push(error.syncDetail);context.state.syncFailure=error.syncDetail;},
    performDeviceComparison:async()=>{throw Object.assign(Error('Missing permissions'),{code:'permission-denied'});},
    manualSyncPromise:null,automaticSyncPromise:null,cloudPaused:false,lastError:'',lastErrorCode:'',
  };
  vm.createContext(context);
  vm.runInContext(section('function traceSync(', 'const now =')+
    section('function describeSyncResult(', 'async function runAutomaticSync(')+
    section('async function compareDeviceWithCloud(', 'async function performDeviceComparison('), context);
  return {context,writes,reports,trace};
}
test('manual vazio conclui e grava timestamp; duplo toque compartilha uma execução',async()=>{
  const {context:c,trace,writes}=runtime();
  const one=c.synchronizeNow(),two=c.synchronizeNow();assert.equal(one,two);
  const result=await one;assert.equal(result.complete,true);assert.deepEqual(trace,['push','pull']);
  assert.ok(writes.some(([key])=>key==='complete'));assert.notEqual(c.state.lastSync,'previous');
});
test('quota em metadados de horário não invalida transferência confirmada',async()=>{
  const {context:c}=runtime({metadataQuota:true});
  assert.equal((await c.synchronizeNow()).complete,true);
  assert.ok(c.state.syncTrace.some(entry=>entry.stage==='status_timestamp_not_persisted'));
});
test('erro no pull preserva código, estágio e último sucesso com fila zero',async()=>{
  const error=Object.assign(Error('Missing or insufficient permissions'),{code:'permission-denied'});
  const {context:c,reports}=runtime({pullError:error});
  await assert.rejects(c.synchronizeNow(),/permissions/);
  assert.equal(reports[0].stage,'downloading_changes');assert.equal(reports[0].code,'permission-denied');
  assert.equal(c.state.lastSync,'previous');
});
test('erro interno de persistência não é reclassificado como falha de internet',async()=>{
  const {context:c}=runtime();
  await assert.rejects(c.syncStep('manual',()=>c.syncStep('persisting_cloud_snapshot',()=>{throw Object.assign(Error('quota'),{name:'QuotaExceededError'});},{service:'localStorage'})),error=>{
    assert.equal(error.syncDetail.stage,'persisting_cloud_snapshot');assert.equal(error.syncDetail.code,'local-storage-quota');return true;
  });
});
test('auditoria opcional falha sem invalidar sync concluído',async()=>{
  const {context:c}=runtime();await c.synchronizeNow();const time=c.state.lastSync;
  await assert.rejects(c.compareDeviceWithCloud());
  assert.equal(c.state.integrityStatus,'failed');assert.equal(c.state.status,'success');assert.equal(c.state.lastSync,time);
  assert.equal(c.state.syncFailure,null);
});
test('divergência não corrige finanças e separa dados recebidos da integridade',async()=>{
  const {context:c}=runtime({divergent:true});const result=await c.synchronizeNow();
  assert.equal(result.dataSynced,true);assert.equal(result.complete,false);
  assert.match(c.state.message,/integridade/);assert.notEqual(c.state.lastSync,'previous');assert.equal(c.state.lastCompleteSync,'previous');
});
test('offline não inicia requests nem afirma sucesso',async()=>{
  const {context:c,trace}=runtime({online:false});assert.equal((await c.synchronizeNow()).offline,true);assert.deepEqual(trace,[]);
});
test('diagnóstico tem limite e não exige novo listener ou leitura',()=>{
  const {context:c}=runtime();for(let n=0;n<100;n++)c.traceSync('test',{documents:n});assert.equal(c.state.syncTrace.length,40);
  assert.doesNotMatch(section('function traceSync(', 'const now ='),/onSnapshot|getDoc\(/);
});
test('reload lê horário no mesmo namespace usado na escrita, com fallback legado',()=>{
  const {context:c}=runtime();const storage=new Map([['scoped','new'],['legacy','old']]);c.localStorage.getItem=key=>storage.get(key);
  assert.equal(c.readSyncTime('scoped','legacy'),'new');assert.equal(c.readSyncTime('absent','legacy'),'old');
  assert.match(section('function setUser(', 'function pendingActivityEvents('),/readSyncTime\(lastSyncKey\(\)/);
});
