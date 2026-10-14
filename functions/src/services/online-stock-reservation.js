'use strict';
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {workspaceWriteFence}=require('./workspace-write-fence');
const {validId}=require('./workspace-reset-policy');
const Model=require('../shared/online-store');
const {Timestamp,serialize}=require('../shared/online-time');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const stockKey=row=>hash([row.productId,row.variantId||null]);
function normalizeRows(items){
  if(!Array.isArray(items)||!items.length||items.length>40)throw new HttpsError('invalid-argument','Itens inválidos.');
  const rows=items.map(i=>{validId(i.productId,'Produto');if(i.variantId)validId(i.variantId,'Variação');if(!Number.isInteger(i.quantity)||i.quantity<1||i.quantity>999)throw new HttpsError('invalid-argument','Quantidade inválida.');return {productId:i.productId,variantId:i.variantId||null,quantity:i.quantity};}).sort((a,b)=>`${a.productId}:${a.variantId}`.localeCompare(`${b.productId}:${b.variantId}`));
  if(new Set(rows.map(i=>`${i.productId}:${i.variantId}`)).size!==rows.length)throw new HttpsError('invalid-argument','Itens duplicados.');
  return rows;
}
// Separate reads/writes lets the same transaction create the order and its reservation.
async function prepareReservation(tx,root,store,items,{release=false}={}){
  const rows=normalizeRows(items),changes=[];
  for(const row of rows){
    const productRef=root.collection('products').doc(row.productId),product=(await tx.get(productRef)).data();
    if(!release&&(!Model.allows(product,store.spaceId)||!store.selectedProductIds.includes(row.productId)))throw new HttpsError('permission-denied','Produto não publicado neste espaço.');
    let source=product,sourceRef=productRef;
    if(row.variantId){sourceRef=root.collection('productVariants').doc(row.variantId);source=(await tx.get(sourceRef)).data();if(!release&&(!Model.active(source)||source.parentProductId!==row.productId))throw new HttpsError('invalid-argument','Variação inválida.');}
    else if(!release&&product.productType==='variable')throw new HttpsError('invalid-argument','Selecione uma variação.');
    if(!source)throw new HttpsError('failed-precondition','Item reservado indisponível. Revisão necessária.');
    // Release the items actually held, even if the product's stock mode changed later.
    if(!release&&(product?.itemKind==='service'||product?.productType==='recurring'||product?.semControleEstoque||product?.controlaEstoque===false))continue;
    const ref=root.collection('onlineStockReservations').doc(stockKey(row)),prior=(await tx.get(ref)).data()||{},reserved=Number(prior.quantity||0),stock=Number(row.variantId?source.stock:product.estoqueAtual??product.estoque??0),next=reserved+(release?-row.quantity:row.quantity);
    if(Number(source.onlineReservedStock||0)!==reserved)throw new HttpsError('failed-precondition','Reserva de estoque inconsistente. Revisão necessária; nenhum estoque foi alterado.');
    if(!Number.isFinite(stock)||!Number.isFinite(reserved)||next<0||!release&&!source.allowNegativeStock&&next>stock)throw new HttpsError('failed-precondition','Estoque insuficiente ou reserva inconsistente.');
    changes.push({ref,sourceRef,row,quantity:next});
  }
  return {rows,changes,commit(tx,generation){const updatedAt=Timestamp.now();for(const r of changes){tx.set(r.ref,{businessId:root.id,workspaceGeneration:generation,productId:r.row.productId,variantId:r.row.variantId,quantity:r.quantity,updatedAt});tx.update(r.sourceRef,{onlineReservedStock:r.quantity,updatedAt});}}};
}
function onlineStockReservation(db){
  async function reserve({businessId,spaceId,storeId,operationId,workspaceGeneration=0,items}){
    for(const [label,id]of Object.entries({businessId,spaceId,storeId,operationId}))validId(id,label);
    const rows=normalizeRows(items),root=db.doc(`businesses/${businessId}`),marker=root.collection('onlineOrderReservations').doc(operationId),fingerprint=hash([spaceId,storeId,workspaceGeneration,rows]);
    return workspaceWriteFence(db,{businessId,workspaceGeneration}).runTransaction(async tx=>{
      const [before,storeSnap]=await Promise.all([tx.get(marker),tx.get(root.collection('onlineStores').doc(storeId))]),store=storeSnap.data();
      if(!store||store.spaceId!==spaceId||store.businessId!==businessId||store.workspaceGeneration!==workspaceGeneration)throw new HttpsError('permission-denied','Loja não corresponde ao espaço.');
      if(before.exists){if(before.data().fingerprint!==fingerprint)throw new HttpsError('already-exists','Operação reutilizada com itens diferentes.');return serialize({...before.data(),replayed:true});}
      const prepared=await prepareReservation(tx,root,store,rows),result={businessId,spaceId,storeId,operationId,workspaceGeneration,fingerprint,status:'reserved',items:prepared.changes.map(r=>r.row),createdAt:Timestamp.now()};
      prepared.commit(tx,workspaceGeneration);tx.create(marker,result);return serialize({...result,replayed:false});
    });
  }
  return {reserve};
}
module.exports={onlineStockReservation,prepareReservation,normalizeRows,stockKey};
