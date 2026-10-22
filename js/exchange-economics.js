(function(root,factory){
  const api=factory(root);
  if(typeof module==='object'&&module.exports)module.exports=api;else root.ExchangeEconomics=api;
})(typeof window==='undefined'?globalThis:window,function(root){
  'use strict';
  let cache={key:'',rows:[],ready:false,busy:false,error:'',asOf:0},request=0,promise=null;
  const identity=()=>{const c=root.BusinessContext?.get?.()||{},uid=root.FirebaseSession?.user?.uid;return uid&&c.businessId?JSON.stringify([uid,c.businessId,c.business?.workspaceGeneration??0,c.role,c.permissionSignature,c.permissions,c.spaceAccess,[...(c.allowedSpaceIds||[])].sort()]):'';};
  const notify=()=>{if(root.dispatchEvent&&root.CustomEvent)root.dispatchEvent(new root.CustomEvent('sale-exchange-metrics-updated'));};
  const invalidate=()=>{request++;promise=null;cache={key:identity(),rows:[],ready:false,busy:false,error:'',asOf:0};};
  const state=()=>cache.key===identity()?{ready:cache.ready&&!cache.busy&&root.navigator?.onLine!==false,busy:cache.busy,error:cache.error,asOf:cache.asOf}:{ready:false,busy:false,error:'',asOf:0};
  const statusMessage=()=>{const s=state();return s.ready?'Valores de vendas incluem os ajustes de trocas concluídas.':s.error?'Ajustes de troca não confirmados. Totais provisórios.':'Confirmando ajustes de troca. Totais provisórios.';};
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
    const rows=cache.key&&cache.key===identity()&&cache.ready?cache.rows:data.saleExchangeAdjustments||[];
    return select(rows,context(data,extra));
  }
  function total(data={},options={}){
    const {start,end,key,dayKey,...scope}=options;
    return forData(data,scope).reduce((sum,row)=>{
      const at=timestamp(row.createdAt);
      return start&&at<start||end&&at>end||key!==undefined&&dayKey?.(at)!==key?sum:sum+row.differenceCents;
    },0)/100;
  }
  async function refresh({force=false}={}){
    const key=identity();if(key!==cache.key)invalidate();
    if(!key||!root.FirebaseCallable||root.navigator?.onLine===false)return state();
    if(promise)return promise;
    if(!force&&(cache.ready||cache.error)&&Date.now()-cache.asOf<30000)return state();
    const c=root.BusinessContext.get(),owner=c.role==='owner'||c.spaceAccess==='all',uid=root.FirebaseSession?.user?.uid;
    const spaces=[...new Set((root.SpaceContext?.list?.()||[]).filter(s=>s.active!==false&&(!s.businessId||s.businessId===c.businessId)&&(owner||(c.allowedSpaceIds||[]).includes(s.id))).map(s=>s.id))];
    if(!spaces.length)return state();
    const ticket=++request;cache.busy=true;cache.error='';
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
        if(ticket===request&&key===identity()){cache={key,rows,ready:true,busy:false,error:'',asOf:Date.now()};notify();}
      }catch(error){if(ticket===request&&key===identity()){cache.busy=false;cache.ready=false;cache.error=error.message||'Não foi possível confirmar os ajustes de troca.';cache.asOf=Date.now();notify();}}
      finally{if(ticket===request)promise=null;}
      return state();
    };
    promise=run();notify();return promise;
  }
  if(root.addEventListener){
    for(const event of ['business-context-changed','firebase-auth-ready'])root.addEventListener(event,()=>{if(cache.key!==identity())invalidate();void refresh();});
    root.addEventListener('firebase-session-cleared',()=>{invalidate();notify();});
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
