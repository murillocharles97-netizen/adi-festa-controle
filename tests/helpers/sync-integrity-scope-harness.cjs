'use strict';
const fs=require('node:fs'),vm=require('node:vm'),audit=require('../../js/integrity');
const source=fs.readFileSync('js/firebase/sync.js','utf8'),ui=fs.readFileSync('js/firebase/firebase-ui.js','utf8');
const section=(text,start,end)=>text.slice(text.indexOf(start),text.indexOf(end,text.indexOf(start)));
const keys={products:'produtos',productVariants:'variacoesProdutos',clients:'clientes',sales:'vendas',payments:'pagamentos',balanceAdjustments:'movimentacoes',productFinancials:'productFinancials',variantFinancials:'variantFinancials',saleFinancials:'saleFinancials'};
const operational=['sales.create','customers.view','products.view','inventory.view'];
function harness({role='seller',permissions=operational,documents={},localDocuments=documents,read}={}){
  const reads=[],localReads=[],diagnosticCache=new Map(),context={businessId:'qa-audit',role,permissions,spaceAccess:'selected',allowedSpaceIds:['qa-space']};
  let local={};
  const queue=[{operationId:'preserved-incident',status:'pending',payload:{writes:[]},quarantine:{status:'archived'},retryCount:2}],beforeQueue=JSON.stringify(queue);
  const s={console,Date,Promise,Map,Set,JSON,Math,Number,String,Error,Object,structuredClone,navigator:{onLine:true},currentUser:{uid:role},auth:{currentUser:{uid:role}},syncSessionGeneration:1,lastDataAuditRaw:null,
    document:{querySelectorAll:()=>[],documentElement:{dataset:{}}},addEventListener(){},queueMicrotask(){},BusinessContext:{get:()=>context},
    IntegrityAudit:audit,DB:{carregar:()=>local,flush:async()=>{}},activeBusinessId:()=>context.businessId,namespace:()=>[context.businessId,s.currentUser.uid,context.role,...context.permissions].join(':'),
    captureCloudReadScope:()=>s.namespace(),assertCloudReadScope:scope=>{if(scope!==s.namespace())throw Object.assign(Error('Sessão de leitura substituída'),{code:'sync-read-scope-retired'});},
    validateUser:async()=>{},readQueue:()=>queue,queueCounts:()=>({pending:0,errors:0,active:0,total:1,archived:1,quarantined:0,manualReview:0}),updateQueueState(){},
    now:()=> '2026-10-19T12:00:00Z',deviceId:()=> 'qa-device',knownOrphanKey:()=>s.namespace()+':diagnostic-orphans',localStorage:{setItem:(key,value)=>diagnosticCache.set(key,value)},
    sourceItems:(data,name)=>{localReads.push(name);return data[keys[name]]||[];},
    newestTimestamp:rows=>rows.map(x=>x.updatedAt||'').sort().at(-1)||'',sanitizeForFirestore:x=>x,
    roundedMoney:value=>Math.round(Number(value||0)*100)/100,balanceEffectId:(type,id)=>type+':'+id,
    state:{testPassed:true,syncFailure:null,integrityStatus:'not_checked'},emit:patch=>Object.assign(s.state,patch),
    syncStep:async(stage,fn,detail={})=>{try{return await fn();}catch(error){error.syncDetail||={stage,...detail,code:error.code||'unknown',message:error.message};throw error;}},
  };
  s.window=s;vm.createContext(s);vm.runInContext(fs.readFileSync('js/team-access.js','utf8'),s);
  vm.runInContext(section(source,'function canPullSource(', '// O boot precisa'),s);
  vm.runInContext(section(source,'const AUDIT_NAMES =','const repositories ='),s);
  vm.runInContext(section(source,'const stableComparable =','async function indexedDbInventory('),s);
  vm.runInContext(section(source,'function financialLedgerEntry(', 'function queueOperationDiagnostic('),s);
  const readCollection=async name=>{reads.push(name);if(read)return read(name,s);return structuredClone(documents[name]||[]);};
  s.repositories=Object.fromEntries(Object.keys(keys).map(name=>[name,{listAllPaged:()=>readCollection(name)}]));
  s.financialEffectsRepository={listAllPaged:()=>readCollection('balanceEvents')};
  function identity(nextRole,nextPermissions=operational){
    context.role=nextRole;context.permissions=nextPermissions;s.currentUser={uid:nextRole};s.auth.currentUser={uid:nextRole};s.syncSessionGeneration++;
    local=Object.fromEntries(Object.entries(keys).map(([name,key])=>[key,structuredClone(localDocuments[name]||[])]));
    s.TeamAccess.sanitizePrivateCache(local);s.state.dataAudit=null;s.state.integrityStatus='not_checked';s.state.integrityFailure=null;s.lastDataAuditRaw=null;
  }
  identity(role,permissions);
  return {s,context,reads,localReads,diagnosticCache,queue,beforeQueue,identity,get local(){return local;},
    compare:options=>s.compareDeviceWithCloud(options),
    html:report=>{
      const c={window:{},Date};vm.createContext(c);
      vm.runInContext(section(ui,'const escape=','function showDuplicates(')+section(ui,'const money=','async function exportDiagnostic('),c);
      return c.dataAuditHtml(report);
    },
    async manualSync(){
      Object.assign(s,{writeSyncTime(){},lastAttemptKey:()=> 'attempt',lastSyncKey:()=> 'sync',lastCompleteKey:()=> 'complete',traceSync(){},
        migrateScopedQueueCompatibility:()=>({}),validateQueueOwnership(){},processSyncQueue:async()=>({sent:0,collections:[]}),
        pullCloudCollections:async()=>0,cleanupConfirmedLegacyFixtures:async()=>{},lastFullPullForAudit:null,compareLocalAndCloud:async()=>({ok:true}),
        safePublishSyncSignal:async()=>{},lastError:'',lastErrorCode:'',preservedQueueMessage:()=> 'Ocorrência arquivada. Nenhuma sincronização pendente.'});
      vm.runInContext(section(source,'function describeSyncResult(', 'function synchronizeNow(')+section(source,'async function runManualSync(', 'async function runAutomaticSync('),s);
      return s.runManualSync();
    }
  };
}
module.exports={harness,operational};
