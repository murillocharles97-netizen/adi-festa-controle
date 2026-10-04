(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WorkspaceRuntimeFactory=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const failure=(code,message)=>Object.assign(Error(message),{code});
  const locked=business=>Boolean(business.workspaceReset?.status&&business.workspaceReset.status!=='COMPLETED');
  // A page never upgrades its origin in place. Pending callbacks belong to the
  // original epoch, even after a new business snapshot reaches the listener.
  function create({protocol,records,localStorage,sessionStorage,stop=()=>{},retire=async()=>{},onBlocked=()=>{}}){
    let origin=null,invalidated=false,retirement=null,preparing=null,sessionSequence=0;
    function suspend(detail){
      invalidated=true;
      guard.block();
      if(!retirement){
        // Stop synchronously, before any await/cache deletion or UI render.
        stop();
        retirement=Promise.resolve().then(retire);
        retirement.catch(error=>onBlocked({...detail,code:error.code||'workspace-retirement-failed'}));
      }
      onBlocked(detail);
    }
    const guard=protocol.create({records,localStorage,sessionStorage,onInvalidate:async()=>{
      stop();await retire();
    }});
    function assertReady(){
      if(invalidated)throw failure('workspace-reload-required','O ambiente da empresa mudou. Reabra a VECONI antes de continuar.');
      if(!origin)throw failure('workspace-not-ready','Aguarde a confirmação do ambiente da empresa.');
      guard.capture();return origin;
    }
    async function prepare({business,uid,confirmedByServer=false}){
      if(invalidated)throw failure('workspace-reload-required','Reabra a VECONI para carregar o novo ambiente.');
      if(!uid)throw failure('workspace-user-required','Uma sessão autenticada é necessária.');
      const next=protocol.identity(business.id,business.workspaceGeneration??0);
      if(origin&&(origin.businessId!==next.businessId||origin.workspaceGeneration!==next.workspaceGeneration||origin.uid!==uid)){
        suspend({businessId:business.id,status:business.workspaceReset?.status||null,code:'workspace-generation-mismatch'});
        throw failure('workspace-reload-required','Reabra a VECONI para carregar o novo ambiente.');
      }
      // Serialize bootstrap retries; never run two cleanup migrations together.
      if(preparing){await preparing;return prepare({business,uid,confirmedByServer});}
      preparing=(async()=>{
        const sequence=sessionSequence;
        const result=await guard.observe({...next,status:business.workspaceReset?.status||null,confirmedByServer});
        if(sequence!==sessionSequence){guard.block();throw failure('workspace-session-ended','A sessão foi encerrada durante a validação.');}
        if(invalidated)throw failure('workspace-reload-required','O ambiente mudou durante a validação.');
        if(result.blocked){
          suspend({businessId:business.id,status:business.workspaceReset.status,operationId:business.workspaceReset.operationId,code:'workspace-reset-locked'});
          throw failure('workspace-reset-locked','A restauração desta empresa ainda não terminou.');
        }
        origin ||= Object.freeze({...next,uid});
        return origin;
      })();
      try{return await preparing;}finally{preparing=null;}
    }
    function inspectRemote(business,metadata={}){
      if(!origin)return !invalidated;
      if(!business||business.id!==origin.businessId)return false;
      let generation;
      try{generation=protocol.identity(business.id,business.workspaceGeneration??0).workspaceGeneration;}
      catch{ suspend({businessId:origin.businessId,code:'invalid-workspace-generation'});return false; }
      // A cached old snapshot must not downgrade the active server-confirmed
      // generation. Cache observations never authorize destructive cleanup.
      if(generation<origin.workspaceGeneration&&metadata.fromCache===true)return false;
      if(generation!==origin.workspaceGeneration||locked(business)||invalidated){
        suspend({businessId:business.id,status:business.workspaceReset?.status||null,operationId:business.workspaceReset?.operationId,code:locked(business)?'workspace-reset-locked':'workspace-reload-required'});
        return false;
      }
      return true;
    }
    function stamp(data,captured){
      const current=assertReady();
      if(captured!==current)throw failure('workspace-origin-mismatch','Operação de outra sessão rejeitada.');
      return guard.stamp(data,captured);
    }
    return Object.freeze({prepare,inspectRemote,capture:assertReady,stamp,isBlocked:()=>invalidated,
      endSession(){sessionSequence++;origin=null;guard.clear();},
      invalidate:()=>suspend({businessId:origin?.businessId||'',code:'workspace-reload-required'})});
  }
  return Object.freeze({create});
});
