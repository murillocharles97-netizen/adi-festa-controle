export const normalizeProfileEmail=value=>String(value||'').trim().toLowerCase();
export const abbreviateTechnicalId=value=>{
  const text=String(value||'ausente');
  return text.length>12?`${text.slice(0,6)}…${text.slice(-4)}`:text;
};

function validationError(code,message,details={},allowManual=false){
  return Object.assign(new Error(message),{code,details,allowManual});
}

export function profileValidationInfo({authUser,profileSnapshotId,profile={}}){
  return{
    authUid:authUser?.uid,
    profileDocumentId:profileSnapshotId,
    profileHasUid:Boolean(profile.uid),
    uidMatches:!profile.uid||profile.uid===authUser?.uid,
    emailMatches:normalizeProfileEmail(profile.email)===normalizeProfileEmail(authUser?.email),
    businessId:profile.businessId,
    role:profile.role,
    active:profile.active
  };
}

export function validateAuthenticatedProfile({authUser,profileSnapshotId,profile={}}){
  const details={authUid:authUser?.uid,profileDocumentId:profileSnapshotId,profileUid:profile.uid||''};
  const uidMissing=profile.uid===undefined||profile.uid===null;
  if(profileSnapshotId!==authUser?.uid){
    throw validationError('profile/document-mismatch','O documento do perfil não corresponde à conta autenticada.',details);
  }
  if(profile.active!==true)throw validationError('profile/inactive','Este usuário está inativo.',details);
  if(!profile.businessId)throw validationError('profile/business-mismatch','O perfil não possui uma empresa válida vinculada.',details);
  if(normalizeProfileEmail(profile.email)!==normalizeProfileEmail(authUser?.email)){
    throw validationError('profile/email-mismatch','O e-mail do perfil não corresponde ao e-mail autenticado.',details);
  }
  if(!uidMissing&&profile.uid!==authUser?.uid){
    throw validationError('profile/uid-mismatch','O campo UID do perfil pertence a outra conta.',details);
  }
  const isLegacyAdiFestaOwnerCandidate=
    profileSnapshotId===authUser?.uid
    && profile.businessId==='adi-festa'
    && profile.active===true
    && ['admin','owner'].includes(profile.role)
    && normalizeProfileEmail(profile.email)===normalizeProfileEmail(authUser?.email);
  if(uidMissing&&!isLegacyAdiFestaOwnerCandidate){
    throw validationError('profile/uid-missing','O campo UID está ausente em um perfil que não é elegível para a migração legada.',details);
  }
  if(profile.businessId==='adi-festa'&&!['admin','owner'].includes(profile.role)){
    throw validationError('profile/role-mismatch','O papel deste usuário não permite administrar a empresa legada.',details);
  }
  return{isLegacyAdiFestaOwnerCandidate,needsLegacyMigration:isLegacyAdiFestaOwnerCandidate&&(uidMissing||profile.role==='admin')};
}

export function validateAuthenticatedBusiness({authUser,profile,businessId,business={}}){
  const details={authUid:authUser?.uid,profileDocumentId:authUser?.uid,profileUid:profile?.uid||'',businessId,ownerId:business.ownerId||''};
  if(businessId!==profile.businessId)throw validationError('business/id-mismatch','A empresa carregada não corresponde à empresa do perfil.',details);
  if(business.active!==true)throw validationError('business/inactive','A empresa vinculada está inativa.',details);
  if(businessId!=='adi-festa')return{isLegacyAdiFestaOwner:false,needsLegacyMigration:false};
  if(business.ownerId!==authUser?.uid){
    throw validationError('business/owner-mismatch','O proprietário registrado na empresa não corresponde à conta autenticada.',details);
  }
  if(business.subscription&&(business.subscription.planId!=='internal'||business.subscription.status!=='active')){
    throw validationError('business/subscription-mismatch','A assinatura interna da empresa legada possui uma configuração divergente.',details);
  }
  const isLegacyAdiFestaOwner=
    business.ownerId===authUser.uid
    && profile.businessId==='adi-festa'
    && profile.active===true
    && ['admin','owner'].includes(profile.role)
    && normalizeProfileEmail(profile.email)===normalizeProfileEmail(authUser.email);
  return{
    isLegacyAdiFestaOwner,
    needsLegacyMigration:isLegacyAdiFestaOwner&&(
      profile.uid===undefined
      || profile.uid===null
      || profile.role==='admin'
      || business.onboardingCompleted!==true
      || !business.subscription
    )
  };
}
