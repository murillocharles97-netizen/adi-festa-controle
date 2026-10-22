(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ExchangeEconomics=api;
})(typeof window==='undefined'?globalThis:window,function(root){
  'use strict';
  let cache={key:'',rows:[],ready:false,busy:false,error:'',asOf:0,mode:'waiting'},request=0,promise=null,history={key:'',spaces:new Set()};
  function readScope({inspectHistory=false}={}){
    const c=root.BusinessContext?.get?.()||{},uid=root.FirebaseSession?.user?.uid;
    if(!uid||!c.businessId)return{key:'',mode:'waiting',spaces:[]};
    const permissions=Array.isArray(c.permissions)?[...c.permissions].sort():Object.keys(c.permissions||{}).filter(key=>c.permissions[key]===true).sort(),
      access=c.access||{},allowed=[...new Set(c.allowedSpaceIds||[])].sort(),
      profileMatches=(!c.userProfile?.uid||c.userProfile.uid===uid)&&(!c.userProfile?.businessId||c.userProfile.businessId===c.businessId),
      canRead=typeof root.TeamAccess?.canReadOperationalSales==='function'?root.TeamAccess.canReadOperationalSales()===true:permissions.some(key=>['*','sales.create','sales.viewAll'].includes(key)),
      snapshot=root.SpaceContext?.snapshot?.(),all=root.SpaceContext?.list?.()||snapshot?.spaces||[],
      source=root.SpaceContext?.salesSpaces?.()||all,
      active=s=>s&&typeof s.id==='string'&&s.id&&!['all','all_spaces'].includes(s.id)&&s.active!==false&&(!s.status||s.status==='active'),
      belongs=s=>{const links=[s.businessId,s.linkedBusinessId].filter(Boolean);return links.length>0&&links.every(id=>id===c.businessId);},
      authorized=s=>c.spaceAccess==='all'||allowed.includes(s.id),
      spaces=[...new Set(source.filter(s=>active(s)&&belongs(s)&&authorized(s)&&s.capabilities?.sales===true).map(s=>s.id))].sort(),
      ambiguous=all.some(s=>active(s)&&belongs(s)&&authorized(s)&&typeof s.capabilities?.sales!=='boolean');
    const historyKey=JSON.stringify([uid,c.businessId,c.business?.workspaceGeneration??0]);
    if(history.key!==historyKey)history={key:historyKey,spaces:new Set(),unverified:false};
    const excluded=new Set(all.filter(s=>s&&belongs(s)&&authorized(s)&&!spaces.includes(s.id)).map(s=>s.id));
    if(inspectHistory&&canRead&&profileMatches&&c.loading!==true&&excluded.size){
      // Read-only hints prevent a formerly commercial space being declared
      // financially empty after its sales capability is removed. Keep IDs only.
      try{
        const data=root.DB?.carregar?.()||{};history.unverified=false;
        if(!data.businessId||data.businessId===c.businessId)for(const rows of [data.vendas||[],data.saleExchangeAdjustments||[]])for(const row of rows){
          if(row&&(!row.businessId||row.businessId===c.businessId)&&(row.workspaceGeneration??0)===(c.business?.workspaceGeneration??0)&&excluded.has(row.spaceId))history.spaces.add(row.spaceId);
        }
      }catch{history.unverified=true;}
    }
    const excludedHistory=[...history.spaces].filter(id=>excluded.has(id)).sort();
    let mode='query';
    if(c.loading===true||snapshot?.loaded===false||!profileMatches||c.error||c.business?.active===false||c.userProfile?.active===false||c.member&&c.member.status!=='active'||access.canAccessApp===false||access.features?.basicSales===undefined)mode='waiting';
    else if(!canRead||access.features.basicSales!==true)mode='unavailable';
    else if(ambiguous||excluded.size&&history.unverified)mode='waiting';
    else if(excludedHistory.length)mode='historical';
    else if(!spaces.length)mode=all.length||snapshot?.loaded===true?'not_applicable':'waiting';
    // A read entitlement is not a mutation gate: an expired/read-only plan or
    // monthly sale limit must not suppress an otherwise authorized history read.
    const key=JSON.stringify([uid,c.businessId,c.business?.workspaceGeneration??0,c.role,c.permissionSignature,permissions,c.spaceAccess,allowed,
      access.features?.basicSales,access.canAccessApp,access.accessMode,access.readOnly,access.entitlementsVersion,access.planId,access.effectivePlanId,access.status,
      Object.keys(access.features||{}).sort().map(key=>[key,access.features[key]===true]),
      c.loading,c.error,c.business?.active,c.member?.status,c.userProfile?.uid,c.userProfile?.businessId,c.userProfile?.active,mode,spaces,excludedHistory,excluded.size&&history.unverified,
      all.map(s=>[s.id,s.businessId,s.linkedBusinessId,s.active,s.status,s.capabilities?.sales]).sort((a,b)=>String(a[0]).localeCompare(String(b[0]))),
      root.SpaceContext?.homeId?.()??snapshot?.homeId,root.SpaceContext?.salesId?.()??snapshot?.salesId]);
    return{key,mode,spaces,c,uid,error:excluded.size&&history.unverified?'Não foi possível verificar o histórico local dos espaços.':''};
  }
  const identity=()=>readScope().key;
  const notify=()=>{if(root.dispatchEvent&&root.CustomEvent)root.dispatchEvent(new root.CustomEvent('sale-exchange-metrics-updated'));};
  const invalidate=()=>{request++;promise=null;cache={key:identity(),rows:[],ready:false,busy:false,error:'',asOf:0,mode:'waiting'};notify();};
  const state=()=>cache.key===identity()?{ready:cache.ready&&!cache.busy&&root.navigator?.onLine!==false,busy:cache.busy,error:cache.error,asOf:cache.asOf,mode:cache.mode}:{ready:false,busy:false,error:'',asOf:0,mode:'waiting'};
  const statusMessage=()=>{const s=state();return s.mode==='not_applicable'&&s.ready?'Nenhum espaço de Vendas habilitado neste escopo.':s.mode==='unavailable'?'Consulta de ajustes de troca indisponível neste perfil ou plano.':s.mode==='historical'?'Histórico de espaço indisponível para consulta. Ajustes de troca não confirmados. Totais provisórios.':s.ready?'Valores de vendas incluem os ajustes de trocas concluídas.':s.error?'Ajustes de troca não confirmados. Totais provisórios.':'Confirmando ajustes de troca. Totais provisórios.';};
  const timestamp=value=>value?.toDate?value.toDate():value?.seconds!==undefined?new Date(value.seconds*1000):new Date(value);
  const whole=value=>Number.isSafeInteger(value)&&value>=0;
  // These are derived reporting adjustments, never additional sales or receipts.
  function select(rows=[],scope={}){
    if(!scope.businessId)return[];
    const seen=new Set(),all=!scope.spaceId||['all','all_spaces'].includes(scope.spaceId);
    return rows.filter(row=>{
      if(!row||typeof row.id!=='string'||!row.id||seen.has(row.id)||row.businessId!==scope.businessId||!row.spaceId||!row.originalSaleId||row.status!=='completed'||row.deletedAt||row.active===false)return false;
      if(!all&&row.spaceId!==scope.spaceId||Array.isArray(scope.allowedSpaceIds)&&!scope.allowedSpaceIds.includes(row.spaceId))return false;
      if(scope.workspaceGeneration!==undefined&&(row.workspaceGeneration??0)!==scope.workspaceGeneration)return false;
      if(!whole(row.returnCents)||!whole(row.newCents)||!Number.isSafeInteger(row.differenceCents)||row.newCents-row.returnCents!==row.differenceCents||row.createdAt==null||!Number.isFinite(timestamp(row.createdAt).getTime()))return false;
      seen.add(row.id);return true;
    });
  }
  function context(data={},extra={}){
    const c=root.BusinessContext?.get?.()||{},role=c.role||root.FirebaseSession?.profile?.role;
    return {businessId:data.businessId||root.DB?.getBusinessId?.()||c.businessId,spaceId:data.spaceSelectionId||'all',
      workspaceGeneration:c.business?.workspaceGeneration??data.workspaceGeneration??0,
      ...(role==='owner'||c.spaceAccess==='all'?{}:Array.isArray(c.allowedSpaceIds)?{allowedSpaceIds:c.allowedSpaceIds}:{}),...extra};
  }
  function forData(data={},extra={}){
    if(root.BusinessContext){
      const scope=readScope();
      if(!scope.key||scope.mode!=='query'||cache.key!==scope.key||!cache.ready||cache.busy||root.navigator?.onLine===false)return[];
      return select(cache.rows,{...context(data,extra),allowedSpaceIds:scope.spaces});
    }
    // Pure model consumers may supply a confirmed snapshot without a session.
    // Authenticated pages never fall back to cached rows from an older scope.
    return select(data.saleExchangeAdjustments||[],context(data,extra));
  }
  function total(data={},options={}){
    const {start,end,key,dayKey,...scope}=options;
    return forData(data,scope).reduce((sum,row)=>{
      const at=timestamp(row.createdAt);
      return start&&at<start||end&&at>end||key!==undefined&&dayKey?.(at)!==key?sum:sum+row.differenceCents;
    },0)/100;
  }
  async function refresh({force=false}={}){
    const scope=readScope({inspectHistory:true}),key=scope.key;if(key!==cache.key)invalidate();
    if(!key||root.navigator?.onLine===false)return state();
    if(scope.mode!=='query'){
      const changed=cache.mode!==scope.mode||cache.error!==scope.error||cache.ready!==(scope.mode==='not_applicable');
      cache={key,rows:[],ready:scope.mode==='not_applicable',busy:false,error:scope.error,asOf:0,mode:scope.mode};
      if(changed)notify();return state();
    }
    if(!root.FirebaseCallable)return state();
    if(promise&&!force)return promise;
    if(promise){request++;promise=null;}
    if(!force&&(cache.ready||cache.error)&&Date.now()-cache.asOf<30000)return state();
    const {c,spaces,uid}=scope,ticket=++request;cache.busy=true;cache.ready=false;cache.rows=[];cache.error='';cache.mode='query';
    const run=async()=>{
      try{
        const rows=[];
        for(const spaceId of spaces){let cursor=null;
          do{
            const response=await root.FirebaseCallable('listSaleExchangeAdjustments',{businessId:c.businessId,workspaceGeneration:c.business?.workspaceGeneration??0,spaceId,cursor});
            if(ticket!==request||key!==identity()||uid!==root.FirebaseSession?.user?.uid)return state();
            const data=response?.data;
            if(data?.businessId!==c.businessId||data.workspaceGeneration!==(c.business?.workspaceGeneration??0)||!Array.isArray(data.items))throw Error('Não foi possível confirmar os ajustes de troca.');
            const valid=select(data.items,{businessId:c.businessId,spaceId,workspaceGeneration:c.business?.workspaceGeneration??0});
            if(valid.length!==data.items.length)throw Error('Há um ajuste de troca que exige revisão.');
            rows.push(...valid);if(rows.length>100000)throw Error('A consulta de trocas excedeu o limite de leitura.');
            const next=data.nextCursor||null;if(next&&JSON.stringify(next)===JSON.stringify(cursor))throw Error('A consulta de trocas não avançou.');cursor=next;
          }while(cursor);
        }
        if(ticket===request&&key===identity()){rows.forEach(row=>history.spaces.add(row.spaceId));cache={key,rows,ready:true,busy:false,error:'',asOf:Date.now(),mode:'confirmed'};notify();}
      }catch(error){if(ticket===request&&key===identity()){cache.busy=false;cache.ready=false;cache.error=error.message||'Não foi possível confirmar os ajustes de troca.';cache.asOf=Date.now();notify();}}
      return state();
    };
    const pending=run();promise=pending;
    const settled=()=>{if(ticket===request&&promise===pending)promise=null;};
    pending.then(settled,settled);notify();return pending;
  }
  if(root.addEventListener){
    for(const event of ['business-context-changed','firebase-auth-ready','veconi-spaces-ready','veconi-space-context-changed','veconi-space-context-local-ready','veconi-space-data-changed'])root.addEventListener(event,()=>{if(cache.key!==identity())invalidate();void refresh();});
    root.addEventListener('firebase-session-cleared',invalidate);
    root.addEventListener('firebase-sync-status',event=>{if(event.detail?.status!=='syncing')void refresh();});
    root.addEventListener('sale-exchange-completed',()=>void refresh({force:true}));
    for(const event of ['sale-exchange-completed','exchange-credit-sale-completed','exchange-credit-sale-cancelled'])root.addEventListener(event,()=>{
      // Read-only hydration uses the Sync session fence. Never create/replay an operation here.
      void root.SyncFirebase?.pullCloudCollections?.({force:true,names:['sales','products','productVariants','stockMovements']})?.catch?.(()=>{
        root.Utils?.toast?.('Operação confirmada na nuvem. A atualização deste aparelho aguarda conexão.',true);
      });
    });
  }
  return {select,context,forData,total,timestamp,refresh,state,invalidate,statusMessage};
});
