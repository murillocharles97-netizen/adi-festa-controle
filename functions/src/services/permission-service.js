'use strict';

const {HttpsError}=require('firebase-functions/v2/https');

function permissionService(db){
  async function authenticatedContext(request,businessId,{ownerOnly=true}={}){
    const uid=request.auth?.uid;if(!uid)throw new HttpsError('unauthenticated','Entre na sua conta para continuar.');
    if(!businessId||typeof businessId!=='string')throw new HttpsError('invalid-argument','Empresa inválida.');
    const [profileSnapshot,businessSnapshot,memberSnapshot]=await Promise.all([db.doc(`users/${uid}`).get(),db.doc(`businesses/${businessId}`).get(),db.doc(`businesses/${businessId}/members/${uid}`).get()]);
    if(!profileSnapshot.exists)throw new HttpsError('permission-denied','Perfil não encontrado.');
    if(!businessSnapshot.exists)throw new HttpsError('not-found','Empresa não encontrada.');
    const profile=profileSnapshot.data(),business={id:businessSnapshot.id,...businessSnapshot.data()},member=memberSnapshot.exists?memberSnapshot.data():null,
      legacyAccess=!member&&profile.active===true&&profile.businessId===businessId,
      effectiveProfile=member?{...profile,role:member.role,permissions:member.permissions,active:member.status==='active'}:profile;
    if(business.active!==true||(!legacyAccess&&(!member||member.status!=='active')))throw new HttpsError('permission-denied','Acesso à empresa negado.');
    if(ownerOnly&&effectiveProfile.role!=='owner')throw new HttpsError('permission-denied','Somente o proprietário pode gerenciar a assinatura.');
    return{uid,profile:effectiveProfile,member,business,businessRef:businessSnapshot.ref,email:String(request.auth.token?.email||effectiveProfile.email||'').trim().toLowerCase()};
  }
  return{authenticatedContext};
}

module.exports={permissionService};
