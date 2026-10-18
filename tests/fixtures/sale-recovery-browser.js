/* Standalone visual fixture. Never imports Firebase or opens a cloud connection. */
(()=>{
 const businessId='recovery-business',uid='recovery-seller',spaceId='recovery-space-a';
 let role='seller',lost=false,uploaded=new Map(),notifications=[],effects=0;
 const audit=document.createElement('p');audit.dataset.qaAudit='';document.querySelector('.qa-tools').after(audit);
 const renderAudit=()=>{audit.textContent=`QA: ${uploaded.size} registros preservados · ${effects} vendas/baixas fictícias · fila original ${JSON.stringify(data)===initial?'intacta':'alterada'}`;};
 const data=Array.from({length:4},(_,n)=>{
  const operationId=`retained-operation-${n}`,id=`retained-sale-${n}`,sale={id,operationId,businessId,spaceId,actorUid:uid,data:`2026-10-17T${14+n}:19:54.000Z`,valorFinal:24.9+n,formaPagamento:'dinheiro',itens:[{produtoId:'qa-product',nome:'Produto QA — venda original',quantidade:1,precoFinalUnitario:24.9+n}]};
  return{sale,packet:{operationId,businessId,userId:uid,workspaceGeneration:0,lastErrorCode:'permission-denied',attempts:6-n,payload:{writes:[{entityType:'sales',entityId:id,operation:'create',data:sale}]}}};
 });
 const initial=JSON.stringify(data);
 window.BusinessContext={get:()=>({businessId,role,userProfile:{uid,active:true},member:{status:'active'},spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[spaceId],business:{active:true,workspaceGeneration:0}})};
 window.FirebaseSession={user:{uid}};window.SpaceContext={homeId:()=>spaceId};
 window.SyncFirebase={getRetainedSaleRecoveryCount:()=>role==='seller'?4:0,subscribe:fn=>{notifications.push(fn);fn();return()=>{notifications=notifications.filter(f=>f!==fn);};},recoverySnapshot:()=>structuredClone({identity:{uid,businessId,workspaceGeneration:0},packets:data.map(x=>x.packet),local:{vendas:data.map(x=>x.sale),movimentacoesEstoque:[]}})};
 window.DB={businessCache:{recoverySources:async()=>role==='seller'?[{packets:data.map(x=>x.packet),local:{vendas:data.map(x=>x.sale),movimentacoesEstoque:[]}}]:[]}};
 window.FirebaseCallable=async(name,input)=>{
  if(name==='submitSaleRecovery'){
   const x=JSON.parse(input.originalJson),sale=x.localSale;
   const receipt={status:'awaiting_review',operationId:x.packet.operationId,contentHash:input.contentHash};
   if(!uploaded.has(sale.id))uploaded.set(sale.id,{saleId:sale.id,...receipt,spaceId,spaceName:'VECONI QA',actorUid:uid,actorName:'Vendedor QA',originalSaleAt:sale.data,total:sale.valorFinal,paymentMethod:sale.formaPagamento,items:[{name:sale.itens[0].nome,quantity:1}],remoteEvidence:{saleExists:false,operationExists:false,movementIdsPresent:[]},possibleMatches:[],comparisonScope:null});
   receipt.status=uploaded.get(sale.id).status;renderAudit();
   if(lost){lost=false;throw Object.assign(Error('QA resposta perdida'),{code:'unavailable'});}return{data:receipt};
  }
  if(name==='decideSaleRecovery'){
   if(role!=='owner')throw Error('Somente proprietário');
   const i=uploaded.get(input.saleId);if(!i)throw Error('Registro inexistente');
   if(i.status==='awaiting_review'){
    if(input.action==='dismiss_match'){i.dismissedMatchIds=['owner-example'];i.revision=(i.revision||0)+1;}
    else{i.status=input.action==='close_without_effects'?'closed_without_effects':input.action==='link_existing'?'already_recreated':'recovered';i.linkedSaleId=input.action==='close_without_effects'?null:input.linkedSaleId||i.saleId;i.resolvedAt=new Date().toISOString();i.resolvedByName='Proprietário QA';if(input.action==='recover_original')effects++;}
   }
   renderAudit();if(lost){lost=false;throw Object.assign(Error('QA resposta perdida'),{code:'unavailable'});}return{data:{saleId:i.saleId,status:i.status,linkedSaleId:i.linkedSaleId}};
  }
  return{data:{items:[...uploaded.values()].filter(i=>input.view==='resolved'?i.status!=='awaiting_review':i.status==='awaiting_review').map(i=>({...i,possibleMatches:role==='owner'&&!i.dismissedMatchIds?.length&&i.status==='awaiting_review'?[{saleId:'owner-example',at:'2026-10-17T18:59:26.000Z',total:24.9,paymentMethod:'dinheiro',sameTotal:true,samePaymentMethod:true}]:[]})),nextCursor:null}};
 };
 document.querySelector('[data-qa-seller]').onclick=()=>{role='seller';dispatchEvent(new Event('firebase-auth-ready'));};
 document.querySelector('[data-qa-owner]').onclick=()=>{role='owner';dispatchEvent(new Event('firebase-auth-ready'));};
 document.querySelector('[data-qa-lost]').onclick=()=>{lost=true;};
 document.body.dataset.qaOriginal=initial;
 renderAudit();
 window.addEventListener('click',()=>{document.body.dataset.qaUnchanged=String(JSON.stringify(data)===initial);document.body.dataset.qaUploaded=String(uploaded.size);});
})();
