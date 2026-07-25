'use strict';

const {HttpsError}=require('firebase-functions/v2/https');

function permissionService(db){
  async function authenticatedContext(request,businessId,{ownerOnly=true}={}){
    const uid=request.auth?.uid;if(!uid)throw new HttpsError('unauthenticated','Entre na sua conta para continuar.');
    if(!businessId||typeof businessId!=='string')throw new HttpsError('invalid-argument','Empresa inválida.');
    const [profileSnapshot,businessSnapshot]=await Promise.all([db.doc(`users/${uid}`).get(),db.doc(`businesses/${businessId}`).get()]);
    if(!profileSnapshot.exists)throw new HttpsError('permission-denied','Perfil não encontrado.');
    if(!businessSnapshot.exists)throw new HttpsError('not-found','Empresa não encontrada.');
    const profile=profileSnapshot.data(),business={id:businessSnapshot.id,...businessSnapshot.data()};
    if(profile.active!==true||business.active!==true||profile.businessId!==businessId)throw new HttpsError('permission-denied','Acesso à empresa negado.');
    if(ownerOnly&&(profile.role!=='owner'||business.ownerId!==uid))throw new HttpsError('permission-denied','Somente o proprietário pode gerenciar a assinatura.');
    return{uid,profile,business,businessRef:businessSnapshot.ref,email:String(request.auth.token?.email||profile.email||'').trim().toLowerCase()};
  }
  return{authenticatedContext};
}

module.exports={permissionService};
