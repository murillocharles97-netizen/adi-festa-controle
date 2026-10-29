'use strict';
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const Money=require('../shared/sale-money');
const {prepareRecoveredSale}=require('./sale-recovery-decision');
const fail=message=>{throw new HttpsError('failed-precondition',message);};
const canonical=v=>JSON.stringify((function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;})(v));
const hash=v=>createHash('sha256').update(canonical(v)).digest('hex');
function monetaryRecovery({db,FieldValue,context,space,loadVerified,enabled=false}){
 const root=c=>db.doc('businesses/'+c.businessId),decisionRef=(c,v)=>root(c).collection('saleRecoveryReviews').doc(v.saleId).collection('monetaryAnalysis').doc('decision');
 async function resolved(tx,c,v,decision){
  if(!decision)return null;
  if(decision.kind!=='monetary_recovery_v1'||decision.businessId!==c.businessId||decision.actorUid!==c.uid||decision.saleId!==v.saleId||decision.operationId!==v.operationId||decision.contentHash!==v.contentHash||decision.payloadHash!==v.payloadHash||decision.workspaceGeneration!==(c.business.workspaceGeneration??0)||decision.status!=='recovered'||!decision.resolvedAt||decision.resolvedByUid!==c.uid)fail('A decisão preservada não corresponde a este original.');
  if(!Array.isArray(decision.movementIds)||canonical([...decision.movementIds].sort())!==canonical([...v.target.movementIds].sort()))fail('Os movimentos da decisão não correspondem aos originais.');
  const [s,p,...moves]=await Promise.all([tx.get(root(c).collection('sales').doc(v.saleId)),tx.get(root(c).collection('processedOperations').doc(v.operationId)),...decision.movementIds.map(id=>tx.get(root(c).collection('stockMovements').doc(id)))]);
  const sale=s.data(),marker=p.data();
  if(!sale||sale.recoveryContentHash!==v.contentHash||sale.id!==v.saleId||sale.operationId!==v.operationId||sale.businessId!==c.businessId||sale.spaceId!==v.spaceId||sale.actorUid!==v.sale.actorUid||(sale.workspaceGeneration??0)!==(c.business.workspaceGeneration??0)||sale.data!==v.sale.data||marker?.recoveryContentHash!==v.contentHash||marker?.status!=='processed'||marker?.id!==v.operationId||marker?.businessId!==c.businessId||marker?.spaceId!==v.spaceId||marker?.actorUid!==v.sale.actorUid||(marker?.workspaceGeneration??0)!==(c.business.workspaceGeneration??0)||moves.some(m=>{const data=m.data(),original=v.packet.payload.writes.find(w=>w.entityType==='stockMovements'&&w.entityId===m.id)?.data;return!data||!original||data.businessId!==c.businessId||data.spaceId!==v.spaceId||data.operationId!==v.operationId||data.vendaId!==v.saleId||data.produtoId!==original.produtoId||(data.variantId||null)!==(original.variantId||null)||data.quantidade!==original.quantidade;}))fail('A decisão existe, mas os efeitos canônicos precisam de conferência. Nenhum replay é permitido.');
  try{if(Money.assertSale(sale).totalCents!==v.target.reportedAmountCents)fail('Valor canônico divergente.');}catch{fail('A venda canônica não conserva os valores autorizados. Nenhum replay é permitido.');}
  return{...decision,resolvedAt:decision.resolvedAt.toDate?.().toISOString()||decision.resolvedAt,commercialReceiptConfirmed:true};
 }
 async function prepare(tx,c,v){
  const s=await space(tx,c,v.spaceId),r=root(c),money=Money.canonicalItems(v.sale.itens);
  if(money.totalCents!==Math.round(v.total*100)||money.totalCents!==v.target.reportedAmountCents||v.sale.formaPagamento==='fiado'||v.sale.clienteId||v.sale.clientId||v.sale.customerId)fail('Esta venda exige outra política ou alteração do valor. Nenhum valor será corrigido silenciosamente.');
  // Full business scan, capped and fail-closed: no timestamp/operator blind spot.
  const sales=await tx.get(r.collection('sales').limit(501));if(sales.size>500)fail('A conferência de duplicidade excede o limite seguro. Solicite revisão técnica individual.');
  const signature=items=>canonical(items.map(i=>[i.produtoId||i.productId,i.variantId||null,Number(i.quantidade??i.quantity)]).sort((a,b)=>canonical(a).localeCompare(canonical(b))));
  const expected=signature(v.sale.itens),day=v.originalSaleAt.slice(0,10);
  const matches=sales.docs.filter(d=>{const x=d.data();return d.id!==v.saleId&&x.spaceId===v.spaceId&&Array.isArray(x.itens)&&signature(x.itens)===expected&&(String(x.data||x.createdAt||'').slice(0,10)===day||Math.round(Number(x.valorFinal??x.valorTotal)*100)===money.totalCents);});
  if(matches.length)fail('Existe venda semelhante que precisa ser descartada como duplicata antes da recuperação.');
  for(const collection of ['payments','balanceEvents','balanceAdjustments','paymentIntents','paymentAllocations'])for(const [field,id]of [['operationId',v.operationId],['saleId',v.saleId]]){
   if(!(await tx.get(r.collection(collection).where(field,'==',id).limit(1))).empty)fail('Há efeito financeiro ou pagamento associado. A recuperação não pode continuar automaticamente.');
  }
  // Canonical monetary metadata is explicit; evidence and charged amount stay intact.
  const prepared=await prepareRecoveredSale({db,tx,c,space:s,v:{...v,sale:{...v.sale,monetaryPolicy:Money.POLICY,itens:money.items}},FieldValue});
  const preview={kind:'monetary_recovery_v1',businessId:c.businessId,spaceId:v.spaceId,workspaceGeneration:c.business.workspaceGeneration??0,actorUid:c.uid,saleId:v.saleId,operationId:v.operationId,contentHash:v.contentHash,payloadHash:v.payloadHash,originalSaleAt:v.originalSaleAt,totalCents:money.totalCents,originalTotalCents:Math.round(v.total*100),paymentMethod:v.sale.formaPagamento,monetaryPolicy:Money.POLICY,lines:money.lines.map((l,n)=>({...l,productId:v.items[n].productId,quantity:v.items[n].quantity,name:v.items[n].name})),stock:prepared.stockPreview,movementIds:prepared.movementIds,commercialEffectsApplied:false};
  return{prepared,preview:{...preview,previewHash:hash(preview)}};
 }
 async function transact(request,execute){return db.runTransaction(async tx=>{
  const c=await context(tx,request);if(!c.owner)throw new HttpsError('permission-denied','Somente o proprietário desta empresa pode autorizar cada recuperação.');
  const v=await loadVerified(tx,c,request.data),ref=decisionRef(c,v),decision=(await tx.get(ref)).data(),prior=await resolved(tx,c,v,decision);
  if(prior){if(execute&&request.data.previewHash!==prior.previewHash)fail('A confirmação não corresponde à decisão original.');return{...prior,idempotent:true};}
  const {prepared,preview}=await prepare(tx,c,v);
  if(!execute)return{...preview,recoveryEnabled:enabled};
  if(!enabled)fail('A execução monetária está pausada. Originais e recibos permanecem preservados.');
  const input=request.data;
  if(input.confirmation!=='RECUPERAR_VALOR_ORIGINAL'||input.contentHash!==v.contentHash||input.previewHash!==preview.previewHash||!['goodsDelivered','paymentReceived','notRecreated'].every(k=>input.operationalEvidence?.[k]===true))fail('Confirme individualmente entrega, pagamento já recebido, ausência de recriação e a revisão atual. Não será iniciada cobrança.');
  const result={...preview,status:'recovered',commercialEffectsApplied:true,resolvedAt:FieldValue.serverTimestamp(),resolvedByUid:c.uid,operationalEvidence:{goodsDelivered:true,paymentReceived:true,notRecreated:true},paymentEvidenceSource:'explicit_owner_attestation_no_collection'};
  prepared.commit();tx.create(ref,result);
  // Raw original, immutable intake receipt and analysis-only replay fence remain untouched.
  return{...result,resolvedAt:null,idempotent:false,commercialReceiptConfirmed:false};
 });}
 return{preview:r=>transact(r,false),decide:r=>transact(r,true),resolution:async(reader,c,data)=>{const v=await loadVerified(reader,c,data),d=(await reader.get(decisionRef(c,v))).data();return await resolved(reader,c,v,d)||{saleId:v.saleId,operationId:v.operationId,status:'unconfirmed'};}};
}
module.exports={monetaryRecovery};
