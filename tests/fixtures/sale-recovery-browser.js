/* Standalone visual fixture. Never imports Firebase or opens a cloud connection. */
(()=>{
 const businessId='recovery-business',uid='recovery-seller',spaceId='recovery-space-a';
 let role='seller',lost=false,uploaded=new Map(),notifications=[];
 const data=Array.from({length:4},(_,n)=>{
  const operationId=`retained-operation-${n}`,id=`retained-sale-${n}`,sale={id,operationId,businessId,spaceId,actorUid:uid,data:`2026-10-17T${14+n}:19:54.000Z`,valorFinal:24.9+n,formaPagamento:'dinheiro',itens:[{produtoId:'qa-product',nome:'Produto QA — venda original',quantidade:1,precoFinalUnitario:24.9+n}]};
  return{sale,packet:{operationId,businessId,userId:uid,workspaceGeneration:0,lastErrorCode:'permission-denied',attempts:6-n,payload:{writes:[{entityType:'sales',entityId:id,operation:'create',data:sale}]}}};
 });
 const initial=JSON.stringify(data);
 window.BusinessContext={get:()=>({businessId,role,spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[spaceId],business:{workspaceGeneration:0}})};
 window.FirebaseSession={user:{uid}};window.SpaceContext={homeId:()=>spaceId};
 window.SyncFirebase={getRetainedSaleRecoveryCount:()=>role==='seller'?4:0,subscribe:fn=>{notifications.push(fn);fn();return()=>{notifications=notifications.filter(f=>f!==fn);};},recoverySnapshot:()=>structuredClone({identity:{uid,businessId,workspaceGeneration:0},packets:data.map(x=>x.packet),local:{vendas:data.map(x=>x.sale),movimentacoesEstoque:[]}})};
 window.FirebaseCallable=async(name,input)=>{
  if(name==='submitSaleRecovery'){
   const x=JSON.parse(input.originalJson),sale=x.localSale;
   const receipt={status:'awaiting_review',operationId:x.packet.operationId,contentHash:input.contentHash};
   uploaded.set(sale.id,{saleId:sale.id,...receipt,spaceId,spaceName:'VECONI QA',actorUid:uid,actorName:'Vendedor QA',originalSaleAt:sale.data,total:sale.valorFinal,paymentMethod:sale.formaPagamento,items:[{name:sale.itens[0].nome,quantity:1}],remoteEvidence:{saleExists:false,operationExists:false,movementIdsPresent:[]},possibleMatches:role==='owner'?[{saleId:'owner-example',at:'2026-10-17T18:59:26.000Z',total:24.9,paymentMethod:'dinheiro',sameTotal:true,samePaymentMethod:true}]:[],comparisonScope:null});
   if(lost){lost=false;throw Object.assign(Error('QA resposta perdida'),{code:'unavailable'});}return{data:receipt};
  }
  return{data:{items:[...uploaded.values()].map(i=>({...i,possibleMatches:role==='owner'?[{saleId:'owner-example',at:'2026-10-17T18:59:26.000Z',total:24.9,paymentMethod:'dinheiro',sameTotal:true,samePaymentMethod:true}]:[]})),nextCursor:null}};
 };
 document.querySelector('[data-qa-seller]').onclick=()=>{role='seller';dispatchEvent(new Event('firebase-auth-ready'));};
 document.querySelector('[data-qa-owner]').onclick=()=>{role='owner';dispatchEvent(new Event('firebase-auth-ready'));};
 document.querySelector('[data-qa-lost]').onclick=()=>{lost=true;};
 document.body.dataset.qaOriginal=initial;
 window.addEventListener('click',()=>{document.body.dataset.qaUnchanged=String(JSON.stringify(data)===initial);document.body.dataset.qaUploaded=String(uploaded.size);});
})();
