(function(root,factory){
  'use strict';
  const api=factory();
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.WorkspaceWriterFactory=api;
})(typeof window==='undefined'?globalThis:window,function(){
  'use strict';
  const fail=(code,message)=>{throw Object.assign(Error(message),{code});};
  // This adapter handles business-tree writes only. External financial/catalog
  // scopes keep their own authorization and must be bound separately.
  function create({sdk,runtime,legacyGeneration=()=>0,resolveExternalScope}){
    function capture(){
      const guard=runtime();
      if(guard)return{guard,origin:guard.capture()};
      if(legacyGeneration()!==0)fail('workspace-not-ready','Confirme o ambiente antes de gravar.');
      return null;
    }
    function check(context){
      if(context&&context.guard.capture()!==context.origin)fail('workspace-origin-mismatch','A sessão desta operação foi encerrada.');
    }
    function payload(ref,data,context,businessId=null){
      check(context);
      const parts=String(ref.path||'').split('/');
      if(parts[0]!=='businesses'&&!businessId)return data;
      if(!context)return data; // Legacy generation 0; server Rules remain authoritative.
      if((businessId||parts[1])!==context.origin.businessId)fail('workspace-business-mismatch','Operação de outra empresa rejeitada.');
      if(data.workspaceGeneration!==undefined&&data.workspaceGeneration!==context.origin.workspaceGeneration)
        fail('workspace-generation-mismatch','Dados de uma geração anterior não podem ser reenviados.');
      // Preserve generation-0 schemas/legacy operations until the first reset.
      return context.origin.workspaceGeneration===0?data:context.guard.stamp(data,context.origin);
    }
    const external=ref=>['financialSpaces','financialTransfers','publicCatalogs'].includes(String(ref.path||'').split('/')[0]);
    async function scopedPayload(ref,data,context,reader,writes){
      const businessId=external(ref)&&resolveExternalScope?await resolveExternalScope(ref,data,{reader,writes,origin:context?.origin}):null;
      return payload(ref,data,context,businessId);
    }
    function options(value,data){
      return value?.mergeFields&&data.workspaceWriteId?{...value,mergeFields:[...new Set([...value.mergeFields,'workspaceGeneration','workspaceWriteId'])]}:value;
    }
    function deletion(ref,context){
      check(context);
      if(String(ref.path||'').startsWith('businesses/')&&context?.origin.workspaceGeneration>0)
        fail('workspace-delete-requires-backend','Exclusão definitiva requer validação no servidor.');
    }
    function wrap(target,context){
      const writes=[];
      const wrapper={
        set(ref,data,opts){payload(ref,data,context);writes.push({method:'set',ref,data,opts});return wrapper;},
        update(ref,data,...args){if(args.length)fail('workspace-update-shape','Use um objeto para atualizar dados operacionais.');payload(ref,data,context);writes.push({method:'update',ref,data});return wrapper;},
        delete(ref){deletion(ref,context);writes.push({method:'delete',ref});return wrapper;}
      };
      if(target.get)wrapper.get=(...args)=>{check(context);return target.get(...args);};
      async function flush(){
        check(context);
        // Resolve all external parents before the first transaction write.
        const prepared=[];
        for(const write of writes)prepared.push({...write,data:write.method==='delete'?null:await scopedPayload(write.ref,write.data,context,target.get?.bind(target),writes)});
        check(context);
        for(const write of prepared){
          if(write.method==='delete'){target.delete(write.ref);continue;}
          target[write.method](write.ref,write.data,...(write.opts===undefined?[]:[options(write.opts,write.data)]));
        }
      }
      if(target.commit)wrapper.commit=()=>{check(context);return flush().then(()=>target.commit());};
      return{wrapper,flush};
    }
    return Object.freeze({
      setDoc(ref,data,opts){const context=capture(),next=payload(ref,data,context);const write=value=>sdk.setDoc(ref,value,...(opts===undefined?[]:[options(opts,value)]));return external(ref)?scopedPayload(ref,data,context).then(write):write(next);},
      updateDoc(ref,data,...args){if(args.length)fail('workspace-update-shape','Use um objeto para atualizar dados operacionais.');const context=capture(),next=payload(ref,data,context);return external(ref)?scopedPayload(ref,data,context).then(value=>sdk.updateDoc(ref,value)):sdk.updateDoc(ref,next);},
      deleteDoc(ref){const context=capture();deletion(ref,context);return sdk.deleteDoc(ref);},
      writeBatch(db){return wrap(sdk.writeBatch(db),capture()).wrapper;},
      runTransaction(db,action,opts){const context=capture();return sdk.runTransaction(db,async tx=>{check(context);const wrapped=wrap(tx,context),result=await action(wrapped.wrapper);await wrapped.flush();return result;},...(opts===undefined?[]:[opts]));}
    });
  }
  return Object.freeze({create});
});
