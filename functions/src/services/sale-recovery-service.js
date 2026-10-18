'use strict';

const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {assertWritable,validId,belongsToWorkspace}=require('./workspace-reset-policy');
const {prepareRecoveredSale}=require('./sale-recovery-decision');
const MAX_BYTES=500*1024;
const fail=(code,message)=>{throw new HttpsError(code,message);};
const digest=value=>createHash('sha256').update(value).digest('hex');
const date=value=>{try{const d=typeof value?.toDate==='function'?value.toDate():new Date(value);return Number.isFinite(d.getTime())?d.toISOString():null;}catch{return null;}};
const cleanError=value=>String(value||'').slice(0,500).replace(/https?:\/\/\S+|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g,'[removido]').replace(/\b(Bearer\s+\S+|(?:token|password|senha|secret|authorization)\s*[:=]\s*\S+)/gi,'[removido]');
function validateOriginal(input,uid,businessId){
  if(typeof input.originalJson!=='string'||Buffer.byteLength(input.originalJson,'utf8')>MAX_BYTES)fail('invalid-argument','O pacote excede o limite seguro. Nenhum dado local foi alterado.');
  if(digest(input.originalJson)!==input.contentHash)fail('invalid-argument','A conferência do pacote falhou.');
  let original;try{original=JSON.parse(input.originalJson);}catch{fail('invalid-argument','Pacote inválido.');}
  // Reject credentials, never silently remove fields from an original packet.
  const inspect=(value,depth=0)=>{if(depth>35)fail('invalid-argument','Estrutura do pacote excede o limite seguro.');if(!value||typeof value!=='object')return;for(const [key,child]of Object.entries(value)){if(/^(password|senha|authorization|auth_?token|api_?key|access_?token|refresh_?token|id_?token|secret|credential)$/i.test(key))fail('invalid-argument','O pacote contém campo protegido e não foi enviado.');inspect(child,depth+1);}};
  inspect(original);
  if(!original||typeof original!=='object'||Object.keys(original).some(k=>!['packet','localSale','localMovements'].includes(k)))fail('invalid-argument','Conteúdo de recuperação não suportado.');
  const packet=original.packet,writes=packet?.payload?.writes;
  if(!packet||packet.businessId!==businessId||packet.userId!==uid||!Array.isArray(writes)||!writes.length||writes.length>350)fail('permission-denied','Origem do pacote não autorizada.');
  if(!['permission-denied','sale-recovery-review-required'].includes(packet.lastErrorCode))fail('failed-precondition','Esta operação não está retida para análise.');
  const operationId=validId(packet.operationId,'Operação'),sales=writes.filter(w=>w.entityType==='sales');
  if(sales.length!==1||sales[0].operation!=='create')fail('invalid-argument','É necessário um único registro original de venda.');
  const write=sales[0],sale=write.data||{},saleId=validId(write.entityId,'Venda'),spaceId=validId(sale.spaceId,'Espaço');
  if(sale.businessId!==businessId||sale.actorUid!==uid||sale.operationId!==operationId||(sale.id&&sale.id!==saleId)||(sale.financialSpaceId&&sale.financialSpaceId!==spaceId))fail('permission-denied','Identificação da venda original divergente.');
  if(original.localSale&&(original.localSale.id!==saleId||original.localSale.operationId!==operationId))fail('invalid-argument','A venda local não corresponde à operação.');
  const checkScope=value=>{if(value?.businessId&&value.businessId!==businessId||value?.spaceId&&value.spaceId!==spaceId)fail('permission-denied','Snapshot de outra empresa ou espaço.');};
  checkScope(original.localSale);
  if(!Array.isArray(original.localMovements)||original.localMovements.length>350)fail('invalid-argument','Movimentos originais inválidos.');
  for(const movement of original.localMovements){checkScope(movement);if(movement.operationId!==operationId&&movement.vendaId!==saleId)fail('invalid-argument','Movimento não pertence à venda original.');}
  const allowed=new Set(['sales','products','productVariants','clients','stockMovements','saleFinancials','productFinancials','variantFinancials','stockMovementFinancials','campaigns','campaignProgress','campaignEvents','campaignRedemptions','rewards','customerMetrics','customerMonthlyMetrics','customerSegments']);
  for(const w of writes){
    validId(w.entityId,'Documento');
    if(!allowed.has(w.entityType)||!['create','update'].includes(w.operation)||!w.data||typeof w.data!=='object')fail('invalid-argument','Tipo de gravação original não suportado para revisão.');
    if(w.data.businessId&&w.data.businessId!==businessId||w.data.spaceId&&w.data.spaceId!==spaceId||w.data.actorUid&&w.data.actorUid!==uid||w.data.workspaceGeneration!==undefined&&w.data.workspaceGeneration!==(packet.workspaceGeneration??0))fail('permission-denied','O pacote contém dados de outra origem.');
    checkScope(w.before);
  }
  if(!Array.isArray(sale.itens)||!sale.itens.length||sale.itens.length>200)fail('invalid-argument','Itens da venda original inválidos.');
  const items=sale.itens.map(i=>{
    const quantity=Number(i.quantidade),unit=Number(i.precoFinalUnitario??i.preco??i.precoOriginal??0);
    if(!Number.isFinite(quantity)||quantity<=0||!Number.isFinite(unit)||unit<0)fail('invalid-argument','Quantidade ou preço original inválido.');
    return{productId:validId(i.produtoId,'Produto'),variantId:i.variantId?validId(i.variantId,'Variação'):null,name:String(i.produtoNome||i.nome||i.nomeProduto||i.produtoId).slice(0,200),variantName:String(i.variantName||i.variacaoNome||'').slice(0,120),quantity,unitPrice:unit};
  });
  const total=Number(sale.valorFinal??sale.total),originalSaleAt=date(sale.data||sale.createdAt);
  if(!Number.isFinite(total)||total<0||!originalSaleAt)fail('invalid-argument','Valor ou horário original inválido.');
  return{packet,sale,saleId,operationId,spaceId,items,total,originalSaleAt,original};
}
function similarSales(review,sales){
  const signature=items=>items.map(i=>`${i.productId||i.produtoId}|${i.variantId||''}|${Number(i.quantity??i.quantidade)}`).sort().join(';');
  const expected=signature(review.items);
  return sales.filter(s=>s.id!==review.saleId&&s.spaceId===review.spaceId&&s.actorUid!==review.actorUid&&Array.isArray(s.itens)&&signature(s.itens)===expected)
    .slice(0,5).map(s=>({saleId:s.id,at:date(s.data),total:Number(s.valorFinal??s.total??0),paymentMethod:String(s.formaPagamento||''),sameTotal:Math.abs(Number(s.valorFinal??s.total??0)-review.total)<0.005,samePaymentMethod:String(s.formaPagamento||'')===review.paymentMethod,label:'Possível venda semelhante registrada pelo gestor'}));
}
function saleRecoveryService(db,{FieldValue}){
  const ref=(businessId,name,id)=>db.doc(`businesses/${businessId}/${name}/${id}`);
  async function context(reader,request){
    const uid=request.auth?.uid;if(!uid)fail('unauthenticated','Entre na sua conta para enviar os dados.');
    const businessId=validId(request.data?.businessId,'Empresa');
    const [b,m,p]=await Promise.all([reader.get(db.doc(`businesses/${businessId}`)),reader.get(ref(businessId,'members',uid)),reader.get(db.doc(`users/${uid}`))]);
    const business=b.data(),member=m.data(),profile=p.data();
    if(!b.exists||!m.exists||!p.exists||business.active!==true||profile.active!==true||member.status!=='active')fail('permission-denied','Vínculo empresarial não autorizado.');
    assertWritable(business,request.data.workspaceGeneration??0);
    const owner=business.ownerId===uid&&member.role==='owner';
    // Preserving one's own evidence is not a commercial operation. Membership,
    // tenant, epoch, space and original actor are still checked independently.
    return{uid,businessId,business,member,profile,owner};
  }
  async function space(reader,c,id){
    validId(id,'Espaço');const snapshot=await reader.get(db.doc(`financialSpaces/${id}`));
    if(!snapshot.exists||!belongsToWorkspace(snapshot.data(),c.businessId)||snapshot.data().active===false||(!c.owner&&c.member.spaceAccess!=='all'&&!c.member.allowedSpaceIds?.includes(id)))fail('permission-denied','Espaço não autorizado.');
    return snapshot.data();
  }
  async function submit(request){
    if(!request.auth?.uid)fail('unauthenticated','Entre na sua conta para enviar os dados.');
    const businessId=validId(request.data?.businessId,'Empresa'),v=validateOriginal(request.data,request.auth.uid,businessId);
    return db.runTransaction(async tx=>{
      const c=await context(tx,request),s=await space(tx,c,v.spaceId);
      if((v.packet.workspaceGeneration??0)!==(c.business.workspaceGeneration??0))fail('failed-precondition','O pacote pertence a uma configuração anterior.');
      const reviewRef=ref(businessId,'saleRecoveryReviews',v.saleId),opRef=ref(businessId,'saleRecoveryOperations',v.operationId),rawRef=reviewRef.collection('original').doc('payload');
      const [review,op,raw]=await Promise.all([tx.get(reviewRef),tx.get(opRef),tx.get(rawRef)]);
      if(review.exists||op.exists||raw.exists){
        if(!review.exists||!op.exists||!raw.exists||review.data().contentHash!==request.data.contentHash||op.data().saleId!==v.saleId||op.data().contentHash!==request.data.contentHash||raw.data().originalJson!==request.data.originalJson){
          // Preserve a bounded conflict evidence packet privately; never overwrite
          // the accepted original and never acknowledge it as a successful upload.
          if(review.exists&&review.data().actorUid===c.uid&&review.data().operationId===v.operationId){
            const conflict=reviewRef.collection('conflicts').doc(request.data.contentHash),prior=await tx.get(conflict);
            if(!prior.exists&&(review.data().conflictCount||0)<3){
              tx.create(conflict,{originalJson:request.data.originalJson,contentHash:request.data.contentHash,actorUid:c.uid,receivedAt:FieldValue.serverTimestamp()});
              tx.update(reviewRef,{conflictCount:(review.data().conflictCount||0)+1});
            }
          }
          return{status:'content_conflict',saleId:v.saleId,operationId:v.operationId};
        }
        return{saleId:v.saleId,operationId:v.operationId,contentHash:request.data.contentHash,status:review.data().status,duplicate:true};
      }
      const movementIds=v.packet.payload.writes.filter(w=>w.entityType==='stockMovements').map(w=>w.entityId);
      const [existingSale,marker,...movements]=await Promise.all([tx.get(ref(businessId,'sales',v.saleId)),tx.get(ref(businessId,'processedOperations',v.operationId)),...movementIds.map(id=>tx.get(ref(businessId,'stockMovements',id)))]);
      const data={saleId:v.saleId,operationId:v.operationId,businessId,spaceId:v.spaceId,spaceName:String(s.name||s.nome||v.spaceId).slice(0,160),actorUid:c.uid,actorName:String(v.sale.actorNameSnapshot||c.member.name||c.profile?.name||'Usuário').slice(0,120),actorRole:String(v.sale.actorRoleSnapshot||c.member.role),roleAtSubmission:String(c.member.role),originalSaleAt:v.originalSaleAt,total:v.total,paymentMethod:String(v.sale.formaPagamento||''),items:v.items,status:'awaiting_review',commercialEffectsApplied:false,source:'retained_local_sale',contentHash:request.data.contentHash,workspaceGeneration:c.business.workspaceGeneration??0,receivedAt:FieldValue.serverTimestamp(),errorCode:v.packet.lastErrorCode,errorMessage:cleanError(v.packet.lastErrorMessage),retryCount:Number(v.packet.retryCount??v.packet.attempts??0),remoteEvidence:{saleExists:existingSale.exists,operationExists:marker.exists,movementIdsPresent:movements.filter(d=>d.exists).map(d=>d.id)}};
      // These are the ONLY write targets. Never call commercial services here.
      tx.create(reviewRef,data);
      tx.create(rawRef,{originalJson:request.data.originalJson,contentHash:request.data.contentHash,formatVersion:1});
      tx.create(opRef,{saleId:v.saleId,operationId:v.operationId,contentHash:request.data.contentHash,actorUid:c.uid,spaceId:v.spaceId,workspaceGeneration:data.workspaceGeneration});
      return{saleId:v.saleId,operationId:v.operationId,contentHash:request.data.contentHash,status:'awaiting_review',duplicate:false};
    });
  }
  const reader={get:r=>r.get()};
  async function list(request){
    const c=await context(reader,request),requestedSpace=request.data.spaceId||null;
    if(requestedSpace)await space(reader,c,requestedSpace);
    if(!c.owner&&c.member.spaceAccess!=='all'&&!requestedSpace)fail('invalid-argument','Selecione o espaço autorizado.');
    let query=db.collection(`businesses/${c.businessId}/saleRecoveryReviews`);
    if(!c.owner)query=query.where('actorUid','==',c.uid);
    if(requestedSpace)query=query.where('spaceId','==',requestedSpace);
    query=query.orderBy('__name__');
    if(request.data.cursor)query=query.startAfter(validId(request.data.cursor,'Página'));
    const snapshot=await query.limit(21).get(),docs=snapshot.docs.slice(0,20),candidateCache=new Map();
    const items=[];
    for(const doc of docs){
      const value=doc.data();await space(reader,c,value.spaceId);
      if(value.workspaceGeneration!==(c.business.workspaceGeneration??0))fail('failed-precondition','Registro de uma configuração anterior.');
      let possibleMatches=[];
      if(c.owner&&value.status==='awaiting_review'){
        const cacheKey=`${value.spaceId}:${value.originalSaleAt.slice(0,10)}`;
        if(!candidateCache.has(cacheKey)){
          // Reuse existing spaceId/data index (ascending); hints, never deduplication.
          const day=value.originalSaleAt.slice(0,10),start=`${day}T00:00:00.000Z`,end=`${day}T23:59:59.999Z`;
          try{
            const found=await db.collection(`businesses/${c.businessId}/sales`).where('spaceId','==',value.spaceId).where('data','>=',start).where('data','<=',end).orderBy('data').limit(100).get();
            candidateCache.set(cacheKey,found.docs.map(d=>({id:d.id,...d.data()})));
          }catch{candidateCache.set(cacheKey,null);}
        }
        possibleMatches=similarSales(value,(candidateCache.get(cacheKey)||[]).filter(s=>s.actorUid===c.business.ownerId&&!s.deletedAt&&!['cancelado','desfeito','reversed'].includes(s.status))).filter(s=>!(value.dismissedMatchIds||[]).includes(s.saleId));
      }
      if(request.data.view==='resolved'&&value.status==='awaiting_review'||request.data.view==='pending'&&value.status!=='awaiting_review')continue;
      items.push({...value,receivedAt:date(value.receivedAt),resolvedAt:date(value.resolvedAt),possibleMatches,comparisonScope:c.owner&&value.status==='awaiting_review'?(candidateCache.get(`${value.spaceId}:${value.originalSaleAt.slice(0,10)}`)===null?'Comparação temporariamente indisponível. O registro original permanece preservado.':'Sugestões entre até 100 vendas do gestor no mesmo espaço e dia UTC. Ausência de sugestão não descarta duplicidade.'):null});
    }
    return{items,nextCursor:snapshot.size>20?docs.at(-1).id:null};
  }
  async function original(request){
    const c=await context(reader,request);if(!c.owner)fail('permission-denied','Somente o proprietário pode consultar o pacote original.');
    const r=ref(c.businessId,'saleRecoveryReviews',validId(request.data.saleId,'Venda')),review=await r.get();
    if(!review.exists)fail('not-found','Registro não encontrado.');await space(reader,c,review.data().spaceId);
    if(review.data().workspaceGeneration!==(c.business.workspaceGeneration??0))fail('failed-precondition','Registro de uma configuração anterior.');
    const raw=await r.collection('original').doc('payload').get();return raw.data();
  }
  async function decide(request){
    const input=request.data||{},action=input.action;
    const confirmations={link_existing:'VINCULAR',dismiss_match:'NAO_E_A_MESMA',recover_original:'RECUPERAR',close_without_effects:'ENCERRAR_SEM_EFEITOS'};
    if(!confirmations[action]||input.confirmation!==confirmations[action])fail('invalid-argument','Confirme explicitamente a decisão.');
    return db.runTransaction(async tx=>{
      const c=await context(tx,request);if(!c.owner)fail('permission-denied','Somente o proprietário pode decidir sobre a recuperação.');
      const saleId=validId(input.saleId,'Venda'),reviewRef=ref(c.businessId,'saleRecoveryReviews',saleId),snapshot=await tx.get(reviewRef),review=snapshot.data();
      if(!snapshot.exists)fail('not-found','Registro não encontrado.');
      const s=await space(tx,c,review.spaceId);
      if(review.workspaceGeneration!==(c.business.workspaceGeneration??0)||review.contentHash!==input.contentHash)fail('failed-precondition','O registro mudou ou pertence a outra geração. Reabra a revisão.');
      const target=action==='close_without_effects'?null:action==='recover_original'?saleId:validId(input.linkedSaleId,'Venda do gestor');
      if(review.status!=='awaiting_review'){
        if(review.decision===action&&review.linkedSaleId===target)return{saleId,status:review.status,linkedSaleId:target,idempotent:true};
        fail('failed-precondition','Esta revisão já foi resolvida com outra decisão.');
      }
      const dismissed=review.dismissedMatchIds||[];
      if(action==='dismiss_match'&&dismissed.includes(target))return{saleId,status:review.status,idempotent:true};
      if((review.revision??0)!==input.revision)fail('aborted','A revisão mudou em outro aparelho. Atualize antes de confirmar.');
      if(review.conflictCount)fail('failed-precondition','Há payloads conflitantes preservados. É necessária revisão técnica antes de decidir.');
      const raw=(await tx.get(reviewRef.collection('original').doc('payload'))).data();
      if(!raw||raw.contentHash!==review.contentHash)fail('failed-precondition','O original imutável não pôde ser validado.');
      const v=validateOriginal(raw,review.actorUid,c.businessId);v.contentHash=review.contentHash;
      const opRef=ref(c.businessId,'saleRecoveryOperations',v.operationId),op=(await tx.get(opRef)).data();
      if(v.saleId!==saleId||v.operationId!==review.operationId||v.spaceId!==review.spaceId||(v.packet.workspaceGeneration??0)!==review.workspaceGeneration||op?.contentHash!==review.contentHash||op.saleId!==saleId||op.actorUid!==v.sale.actorUid||op.spaceId!==v.spaceId||op.workspaceGeneration!==review.workspaceGeneration)fail('failed-precondition','Índices e autoria do pacote divergem.');
      let linked=null,prepared=null,candidate=null;
      if(action==='link_existing'||action==='dismiss_match'){
        candidate=(await tx.get(ref(c.businessId,'sales',target))).data();
        if(!candidate||candidate.businessId!==c.businessId||candidate.spaceId!==review.spaceId||candidate.actorUid!==c.business.ownerId||(candidate.workspaceGeneration??0)!==review.workspaceGeneration||candidate.deletedAt||candidate.status!=='pago')fail('failed-precondition','A venda do gestor não está válida neste espaço.');
        linked={saleId:target,at:date(candidate.data),total:Number(candidate.valorFinal??candidate.total),paymentMethod:String(candidate.formaPagamento||''),actorUid:candidate.actorUid};
      }
      if(action==='link_existing'||action==='close_without_effects'){
        if(action==='link_existing'){
          const match=similarSales(review,[{...candidate,id:target}])[0];
          if(!match||!match.sameTotal||!match.samePaymentMethod)fail('failed-precondition','Itens, quantidades, valor ou pagamento diferem. Não é seguro vincular esta venda.');
        }
          const movementIds=v.packet.payload.writes.filter(w=>w.entityType==='stockMovements').map(w=>w.entityId);
          const evidence=await Promise.all([tx.get(ref(c.businessId,'sales',saleId)),tx.get(ref(c.businessId,'processedOperations',v.operationId)),...movementIds.map(id=>tx.get(ref(c.businessId,'stockMovements',id))),...movementIds.map(id=>tx.get(ref(c.businessId,'stockMovementFinancials',id))),tx.get(ref(c.businessId,'saleFinancials',saleId)),tx.get(db.doc(`financialSpaces/${v.spaceId}/entries/sale_${saleId}`)),tx.get(ref(c.businessId,'financialIncomeRoutes',digest(`sale:${saleId}`))),tx.get(db.collection(`businesses/${c.businessId}/stockMovements`).where('operationId','==',v.operationId).limit(1)),tx.get(db.collection(`businesses/${c.businessId}/stockMovements`).where('vendaId','==',saleId).limit(1))]);
          if(evidence.some(s=>s.exists||s.empty===false))fail('failed-precondition','A operação original já possui efeitos na nuvem. É necessária revisão técnica antes de encerrar ou vincular.');
      }else if(action==='recover_original'){
        // Preserve causal order where held operations share a product/variant.
        const earlier=await tx.get(db.collection(`businesses/${c.businessId}/saleRecoveryReviews`).limit(501));
        if(earlier.size>500)fail('failed-precondition','Muitos registros para conferir a ordem causal. Solicite revisão técnica.');
        const pending=earlier.docs.map(d=>d.data()).find(r=>r.status==='awaiting_review'&&r.saleId!==saleId&&r.workspaceGeneration===review.workspaceGeneration&&r.originalSaleAt<review.originalSaleAt&&r.items.some(i=>review.items.some(j=>j.productId===i.productId)));
        if(pending)fail('failed-precondition',`Resolva primeiro a venda anterior ${pending.saleId}, que compartilha produtos com esta operação.`);
        prepared=await prepareRecoveredSale({db,tx,c,space:s,v,FieldValue});
      }
      const at=FieldValue.serverTimestamp(),revision=(review.revision??0)+1;
      const audit=reviewRef.collection('decisions').doc(String(revision));
      tx.create(audit,{action,actorUid:c.uid,actorName:String(c.profile.name||c.profile.nome||'Proprietário').slice(0,120),at,contentHash:review.contentHash,linkedSaleId:target,businessId:c.businessId,spaceId:review.spaceId});
      if(action==='dismiss_match'){
        if(dismissed.length>=100)fail('failed-precondition','Limite de sugestões revisadas atingido.');
        tx.update(reviewRef,{dismissedMatchIds:[...dismissed,target],revision});
        return{saleId,status:'awaiting_review',idempotent:false};
      }
      if(prepared)prepared.commit();
      const status=action==='close_without_effects'?'closed_without_effects':action==='link_existing'?'already_recreated':'recovered';
      tx.update(reviewRef,{status,decision:action,revision,linkedSaleId:target,linkedSale:action==='close_without_effects'?null:linked||{saleId,at:v.originalSaleAt,total:v.total,paymentMethod:review.paymentMethod,actorUid:review.actorUid},resolvedAt:at,resolvedByUid:c.uid,resolvedByName:String(c.profile.name||c.profile.nome||'Proprietário').slice(0,120),commercialEffectsApplied:action==='recover_original',movementIds:prepared?.movementIds||[]});
      tx.update(opRef,{status,decision:action,linkedSaleId:target,resolvedAt:at,resolvedByUid:c.uid});
      // Immutable original and the device's commercial queue are never altered.
      return{saleId,status,linkedSaleId:target,idempotent:false};
    });
  }
  return{submit,list,original,decide};
}
module.exports={saleRecoveryService,validateOriginal,similarSales,MAX_BYTES};
