/* UI-only synthetic fixture. Auth/Rules/transactions are tested in Emulator. */
(()=>{
 const original={operationId:'qa-synthetic-incident',businessId:'qa-business',entityType:'products',action:'update',retryCount:2,payloadChecksum:'fnv1a:12345678',createdAt:'2026-10-18T17:00:00Z',reviewRequired:true,reviewState:'quarantined',status:'quarantined',originalStatus:'pending'};
 let item=structuredClone(original),listener,activeError=false;
 const state=()=>({status:activeError?'error':'success',message:activeError?'Sincronização incompleta: 1 alteração com erro.':item.reviewState==='archived'?'1 ocorrência arquivada. Nenhuma sincronização pendente.':'1 ocorrência preservada para análise. Nenhuma sincronização pendente.',pending:0,errors:activeError?1:0,queueTotal:activeError?1:0,preservedOccurrences:item.reviewState==='quarantined'?1:0,archivedOccurrences:item.reviewState==='archived'?1:0,orphanOperations:0,lastSync:'2026-10-19T15:00:00Z',details:{userBusinessId:'qa-business',userRole:'seller',listenerConnected:true,hydrated:true,pendingOperations:activeError?1:0}});
 const emit=()=>{listener?.(state());document.querySelector('#qa-result').textContent=state().message;};
 window.AdiFestaBuild={shortCommit:'local-qa'};window.Utils={toast:message=>{document.querySelector('#qa-result').textContent=message;}};
 window.SyncFirebase={subscribe(fn){listener=fn;fn(state());return()=>{};},getQueueDiagnostics:()=>[item,...(activeError?[{operationId:'qa-real-error',status:'error',reviewRequired:false,entityType:'sales',action:'create',errorCode:'permission-denied',errorMessage:'Erro sintético legítimo',retryCount:1,origin:'qa'}]:[])],async synchronizeNow(){emit();return{complete:!activeError,pending:0,errors:activeError?1:0};},describeResult:()=>state().message,describeError:error=>error.message,
  async archiveQuarantinedOperation(id){if(id!==item.operationId)throw Error('Ocorrência de outra origem.');item={...item,reviewState:'archived',status:'archived',reviewRequired:false,archive:{archivedAt:'2026-10-19T15:00:00Z',archivedBy:'qa-seller'}};emit();return item.archive;}};
 document.querySelector('#qa-active-error').onclick=()=>{activeError=true;emit();};document.querySelector('#qa-reset').onclick=()=>{activeError=false;item=structuredClone(original);emit();};
 setTimeout(()=>dispatchEvent(new Event('firebase-auth-ready')),100);
})();
