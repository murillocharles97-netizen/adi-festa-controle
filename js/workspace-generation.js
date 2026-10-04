(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WorkspaceGenerationProtocol=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const error=(message,code)=>Object.assign(Error(message),{code});
  function identity(businessId,generation){
    if(!/^[-A-Za-z0-9_]{3,128}$/.test(businessId)||!Number.isSafeInteger(generation)||generation<0)
      throw error('Identidade operacional inválida.','invalid-workspace-generation');
    return Object.freeze({businessId,workspaceGeneration:generation});
  }
  const scoped=(value,prefix)=>value===prefix||value.startsWith(`${prefix}:`);
  function ownsRecord(record,businessId){
    const scope=String(record.scope||''),key=String(record.key||'');
    return scoped(scope,`business-cache:v156:adiFestaDB_v1:${businessId}`)
      ||(businessId==='adi-festa'&&scope==='business-cache:v156:adiFestaDB_v1')
      ||scoped(scope,`payment-attempt:${businessId}`)
      ||scoped(scope,`fixture-quarantine:${businessId}`)
      ||(scope.startsWith(`${businessId}:`)&&key.startsWith('message-'));
  }
  function ownsStorageKey(key,businessId){
    return scoped(key,`adiFestaDB_v1:${businessId}`)
      ||(businessId==='adi-festa'&&key==='adiFestaDB_v1')
      ||scoped(key,`adiFesta:${businessId}`)
      ||scoped(key,`adiFesta:operation:${businessId}`)
      ||scoped(key,`veconi:sale-draft:v1:${businessId}`)
      ||scoped(key,`veconi:known-only-local-sales:${businessId}`)
      ||scoped(key,`veconi:reviewed-only-local-sales:${businessId}`)
      ||scoped(key,`adiFestaPortalFingerprints:${businessId}`)
      ||scoped(key,`adiFesta:runtime:${businessId}`)
      ||(/^veconi:spaces:v1:[^:]+:/.test(key)&&key.split(':')[4]===businessId)
      ||(/^veconi:space-context:v1:[^:]+:/.test(key)&&key.split(':')[4]===businessId);
  }
  function pruneFinancialView(profile,spaceIds){
    const removed=new Set(spaceIds),removedViews=new Set(spaceIds.map(id=>`space:${id}`));
    const customViews=(profile.customViews||[]).map(view=>({...view,financialSpaceIds:(view.financialSpaceIds||[]).filter(id=>!removed.has(id))})).filter(view=>{if(view.financialSpaceIds.length)return true;removedViews.add(view.id);return false;});
    return{...profile,customViews,favoriteViewIds:(profile.favoriteViewIds||[]).filter(id=>!removedViews.has(id)),defaultViewId:removedViews.has(profile.defaultViewId)?null:profile.defaultViewId||null,lastViewId:removedViews.has(profile.lastViewId)?null:profile.lastViewId||null};
  }
  function cleanFinancialPreferences(storage,businessId){
    const keys=Array.from({length:storage.length},(_,n)=>storage.key(n)),byUid=new Map();
    const read=key=>{try{return JSON.parse(storage.getItem(key)||'null');}catch{return null;}};
    for(const key of keys){
      const isScoped=/^veconi:spaces:v1:[^:]+:/.test(key)&&key.split(':')[4]===businessId;
      const isMixed=key.startsWith('adiFesta:financial-spaces:v1:');
      if(!isScoped&&!isMixed)continue;
      const rows=read(key);if(!Array.isArray(rows))continue;
      const uid=key.split(':')[3],ids=byUid.get(uid)||new Set();
      const belongs=row=>{const links=[row.businessId,row.linkedBusinessId].filter(Boolean);return links.length&&links.every(id=>id===businessId);};
      rows.filter(belongs).forEach(row=>ids.add(row.id));byUid.set(uid,ids);
      if(isMixed&&rows.some(belongs))storage.setItem(key,JSON.stringify(rows.filter(row=>!belongs(row))));
    }
    for(const[uid,ids]of byUid){
      const profileKey=`veconi:financial-view-profile:v1:${uid}`,profile=read(profileKey);
      const next=profile&&pruneFinancialView(profile,[...ids]);
      if(next)storage.setItem(profileKey,JSON.stringify(next));
      const selected=`adiFesta:lastFinancialSpaceId:v1:${uid}`;
      if(ids.has(storage.getItem(selected)))storage.removeItem(selected);
      const consolidated=`adiFesta:financial-consolidated:v1:${uid}`,list=read(consolidated);
      if(Array.isArray(list))storage.setItem(consolidated,JSON.stringify(list.filter(id=>!ids.has(id))));
      const viewKey=`veconi:last-financial-view:v1:${uid}`,view=storage.getItem(viewKey);
      if([...ids].some(id=>view===`space:${id}`)||(profile?.customViews||[]).some(row=>row.id===view)&&!(next?.customViews||[]).some(row=>row.id===view))storage.removeItem(viewKey);
    }
  }
  function create({records,localStorage,sessionStorage,onInvalidate=async()=>{},uuid=()=>crypto.randomUUID()}){
    let current=null,blocked=true;
    const markerKey=businessId=>`workspace-generation:${businessId}`;
    function cleanStorage(storage,businessId){
      if(!storage)return;
      cleanFinancialPreferences(storage,businessId);
      const keys=Array.from({length:storage.length},(_,n)=>storage.key(n));
      for(const key of keys)if(ownsStorageKey(key,businessId))storage.removeItem(key);
      // Legacy queue can contain other businesses: filter rows, never remove wholesale.
      const key='adiFestaFirestoreQueue_v1',raw=storage.getItem(key);
      if(raw){
        let queue;try{queue=JSON.parse(raw);}catch{throw error('Fila legada inválida. Restauração local requer revisão.','invalid-legacy-queue');}
        if(!Array.isArray(queue))throw error('Fila legada inválida.','invalid-legacy-queue');
        const next=queue.filter(row=>row.businessId!==businessId);
        if(next.length!==queue.length){if(next.length)storage.setItem(key,JSON.stringify(next));else storage.removeItem(key);}
      }
    }
    async function observe({businessId,workspaceGeneration=0,status=null,confirmedByServer=false}){
      const next=identity(businessId,workspaceGeneration);
      if(!confirmedByServer)throw error('Confirme o estado da empresa na nuvem antes de restaurar o cache.','server-confirmation-required');
      blocked=true;
      const key=markerKey(businessId),existing=await records.read(key),old=existing?.workspaceGeneration??0;
      if(old>workspaceGeneration)throw error('Resposta de geração antiga descartada.','stale-generation-response');
      const needsInvalidation=old!==workspaceGeneration||existing?.cleanupPending===true;
      if(needsInvalidation){
        // Caller must stop sync/listeners and discard old in-memory work BEFORE deletion.
        await onInvalidate({businessId,previousGeneration:old,workspaceGeneration});
      }
      // Read the epoch again INSIDE the deleting transaction. Another tab may
      // already have migrated and started producing new-generation records.
      const changed=await records.transaction('readwrite',(store,done,fail)=>{
        const check=store.get(key);
        check.onsuccess=()=>{
          const actual=check.result,epoch=actual?.workspaceGeneration??0;
          if(epoch>workspaceGeneration)return fail(error('Outra aba já recebeu uma geração mais recente.','stale-generation-response'));
          const migrate=epoch!==workspaceGeneration||actual?.cleanupPending===true;
          const finish=()=>{
            try{
              // Synchronous web-storage cleanup stays inside the IDB write
              // lock; no new cache commits can interleave with epoch promotion.
              if(migrate)cleanStorage(localStorage,businessId);
              const tabKey=`veconi:workspace-session-generation:${businessId}`;
              if(sessionStorage&&workspaceGeneration>Number(sessionStorage.getItem(tabKey)||0)){
                cleanStorage(sessionStorage,businessId);sessionStorage.setItem(tabKey,String(workspaceGeneration));
              }
              store.put({key,scope:`workspace:${businessId}`,workspaceGeneration,cleanupPending:false});done(migrate);
            }catch(cause){fail(cause);}
          };
          if(!migrate)return finish();
          const request=store.openCursor();
          request.onsuccess=()=>{
            const cursor=request.result;
            if(cursor){if(ownsRecord(cursor.value,businessId))cursor.delete();cursor.continue();return;}
            finish();
          };
        };
      });
      current=next;blocked=status!==null&&status!=='COMPLETED';
      return{...next,changed,blocked};
    }
    function capture(){
      if(!current||blocked)throw error('A empresa está bloqueada durante a restauração.','workspace-reset-locked');
      return current;
    }
    function stamp(data,origin){
      const active=capture();
      if(!origin||origin.businessId!==active.businessId||origin.workspaceGeneration!==active.workspaceGeneration
        ||(data.workspaceGeneration!==undefined&&data.workspaceGeneration!==origin.workspaceGeneration))
        throw error('Operação de uma geração anterior rejeitada.','workspace-generation-mismatch');
      return{...data,workspaceGeneration:origin.workspaceGeneration,workspaceWriteId:`g${origin.workspaceGeneration}_${uuid()}`};
    }
    return Object.freeze({observe,capture,stamp,block:()=>{blocked=true;},clear:()=>{current=null;blocked=true;}});
  }
  return Object.freeze({identity,ownsRecord,ownsStorageKey,pruneFinancialView,cleanFinancialPreferences,create});
});
