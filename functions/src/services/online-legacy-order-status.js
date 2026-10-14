'use strict';
const {timingSafeEqual}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
// Read-only compatibility: use the existing token/secret, never infer space.
async function legacyOrderStatus(tx,db,data,catalog){
  const deny=()=>{throw new HttpsError('not-found','Pedido não encontrado.');};
  if(!catalog?.businessId)return deny();
  const business=(await tx.get(db.doc(`businesses/${catalog.businessId}`))).data();if(!business?.active)return deny();
  let token=data.catalogToken;
  if(catalog.legacyRedirect){
    token=catalog.universalCatalogToken;
    if(!/^[A-Za-z0-9_-]{20,128}$/.test(token||''))return deny();
    const destination=(await tx.get(db.doc(`publicCatalogs/${token}`))).data();
    if(destination?.businessId!==catalog.businessId)return deny();
  }
  const order=(await tx.get(db.doc(`publicCatalogs/${token}/orders/${data.id}`))).data();
  const expected=Buffer.from(String(order?.orderAccessToken||'')),supplied=Buffer.from(String(data.orderAccessToken||''));
  if(!order||order.businessId&&order.businessId!==catalog.businessId||expected.length<32||expected.length!==supplied.length||!timingSafeEqual(expected,supplied))return deny();
  return {...order,id:data.id};
}
module.exports={legacyOrderStatus};
