'use strict';

const crypto=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');

const PERMISSIONS=Object.freeze([
  'sales.create','sales.cancel','sales.viewAll',
  'customers.view','customers.edit','customers.receiveDebt','customers.adjustBalance',
  'products.view','products.edit','inventory.view','inventory.adjust',
  'financial.view','reports.view','profit.view','cost.view',
  'team.view','team.manage','settings.manage','billing.manage','spaces.manage',
]);
const ROLE_PRESETS=Object.freeze({
  owner:Object.freeze(Object.fromEntries(PERMISSIONS.map(key=>[key,true]))),
  manager:Object.freeze({
    'sales.create':true,'sales.cancel':true,'sales.viewAll':true,
    'customers.view':true,'customers.edit':true,'customers.receiveDebt':true,'customers.adjustBalance':true,
    'products.view':true,'products.edit':true,'inventory.view':true,'inventory.adjust':true,
    'reports.view':true,'team.view':true,
  }),
  seller:Object.freeze({
    'sales.create':true,'customers.view':true,'products.view':true,'inventory.view':true,
  }),
  stock:Object.freeze({'products.view':true,'inventory.view':true,'inventory.adjust':true}),
});
const VALID_ROLES=new Set(Object.keys(ROLE_PRESETS));
const VALID_STATUSES=new Set(['active','invited','disabled']);
const text=(value,max=160)=>String(value||'').trim().slice(0,max);
const email=value=>text(value,320).toLowerCase();
const tokenHash=value=>crypto.createHash('sha256').update(String(value||'')).digest('hex');
// Kept explicit instead of clever mapping so malformed objects can never
// introduce an unknown permission key.
function normalizedPermissions(role,input={}){
  const preset=ROLE_PRESETS[role]||ROLE_PRESETS.seller,source=input&&typeof input==='object'&&!Array.isArray(input)?input:{};
  return Object.fromEntries(PERMISSIONS.map(key=>[key,Boolean(source[key]??preset[key])]));
}
const hasPermission=(member,key)=>member?.role==='owner'||member?.permissions?.[key]===true;
const publicMember=(id,data={})=>({
  uid:id,name:text(data.name,120),email:email(data.email),role:data.role,status:data.status,
  spaceAccess:data.spaceAccess==='all'?'all':'selected',allowedSpaceIds:Array.isArray(data.allowedSpaceIds)?data.allowedSpaceIds.map(String):[],
  permissions:normalizedPermissions(data.role,data.permissions),terminalId:data.terminalId||null,terminalSpaceId:data.terminalSpaceId||null,
});

function teamAccessService(db,{Timestamp,FieldValue,appUrl}){
  const memberRef=(businessId,uid)=>db.doc(`businesses/${businessId}/members/${uid}`);
  const businessRef=businessId=>db.doc(`businesses/${businessId}`);
  async function actorContext(request,businessId,{permission='team.manage'}={}){
    const uid=request.auth?.uid;
    if(!uid)throw new HttpsError('unauthenticated','Entre na sua conta para continuar.');
    const [businessSnapshot,memberSnapshot,profileSnapshot]=await Promise.all([
      businessRef(businessId).get(),memberRef(businessId,uid).get(),db.doc(`users/${uid}`).get(),
    ]);
    if(!businessSnapshot.exists)throw new HttpsError('not-found','Empresa não encontrada.');
    const business={id:businessSnapshot.id,...businessSnapshot.data()},profile=profileSnapshot.data()||{};
    const legacyOwner=!memberSnapshot.exists&&business.ownerId===uid&&profile.active===true&&profile.businessId===businessId&&['owner','admin'].includes(profile.role);
    const member=memberSnapshot.exists?memberSnapshot.data():legacyOwner?{uid,name:profile.name,email:profile.email,role:'owner',status:'active',spaceAccess:'all',allowedSpaceIds:[],permissions:ROLE_PRESETS.owner}:null;
    if(!member||member.status!=='active'||business.active!==true)throw new HttpsError('permission-denied','Seu acesso a esta empresa não está ativo.');
    if(permission&&!hasPermission(member,permission))throw new HttpsError('permission-denied','Você não possui permissão para gerenciar a equipe.');
    return{uid,business,businessRef:businessSnapshot.ref,member,memberRef:memberRef(businessId,uid),profile};
  }
  async function validateSpaces(businessId,spaceAccess,allowedSpaceIds){
    if(spaceAccess==='all')return[];
    const ids=[...new Set((Array.isArray(allowedSpaceIds)?allowedSpaceIds:[]).map(value=>text(value,120)).filter(Boolean))];
    if(!ids.length||ids.length>50)throw new HttpsError('invalid-argument','Selecione ao menos um espaço autorizado.');
    const snapshots=await Promise.all(ids.map(id=>db.doc(`financialSpaces/${id}`).get()));
    if(snapshots.some(snapshot=>!snapshot.exists||snapshot.data()?.active===false||String(snapshot.data()?.businessId||snapshot.data()?.linkedBusinessId||'')!==businessId))
      throw new HttpsError('invalid-argument','Um dos espaços selecionados não pertence a esta empresa.');
    return ids;
  }
  async function ensureCurrentMembership(request){
    const uid=request.auth?.uid,businessId=text(request.data?.businessId,128);
    if(!uid||!businessId)throw new HttpsError('unauthenticated','Entre novamente para validar seu acesso.');
    const ref=memberRef(businessId,uid),profileRef=db.doc(`users/${uid}`),business=businessRef(businessId),auditRef=db.doc(`businesses/${businessId}/auditLogs/owner_membership_evidence_${uid}`),membershipRef=db.doc(`memberships/${businessId}_${uid}`);
    return db.runTransaction(async transaction=>{
      const [memberSnapshot,profileSnapshot,businessSnapshot,auditSnapshot,membershipSnapshot]=await Promise.all([transaction.get(ref),transaction.get(profileRef),transaction.get(business),transaction.get(auditRef),transaction.get(membershipRef)]);
      if(!businessSnapshot.exists||!profileSnapshot.exists)throw new HttpsError('permission-denied','Perfil empresarial não encontrado.',{reason:'business-profile-missing',businessId});
      const profile=profileSnapshot.data(),company=businessSnapshot.data();
      if(company.active!==true)throw new HttpsError('permission-denied','A empresa vinculada está inativa.',{reason:'access-disabled',businessId});
      const ownerRoleCompatible=!profile.role||['owner','admin'].includes(profile.role),strictOwnerEvidence=profile.active===true&&profile.businessId===businessId&&company.ownerId===uid&&ownerRoleCompatible&&email(profile.email)===email(request.auth.token?.email);
      if(memberSnapshot.exists){
        const storedMember=memberSnapshot.data(),legacyOwnerShape=strictOwnerEvidence&&(!storedMember.role||!storedMember.status||!storedMember.spaceAccess||!storedMember.permissions),member=legacyOwnerShape?{...storedMember,uid,role:'owner',status:'active',spaceAccess:'all',allowedSpaceIds:[],permissions:ROLE_PRESETS.owner}:storedMember;
        if(member.status!=='active')throw new HttpsError('permission-denied','Seu acesso foi desativado.',{reason:'access-disabled',businessId});
        const ownerEvidence=member.role==='owner'&&strictOwnerEvidence;
        if(legacyOwnerShape)transaction.set(ref,{uid,role:'owner',status:'active',spaceAccess:'all',allowedSpaceIds:[],permissions:ROLE_PRESETS.owner,updatedAt:FieldValue.serverTimestamp(),schemaVersion:1},{merge:true});
        if(ownerEvidence){
          const now=FieldValue.serverTimestamp(),membership=membershipSnapshot.data()||{};
          if(!membershipSnapshot.exists||membership.role!=='owner'||membership.status!=='active'||membership.active!==true)transaction.set(membershipRef,{id:`${businessId}_${uid}`,businessId,uid,email:email(profile.email||request.auth.token?.email),role:'owner',active:true,status:'active',updatedAt:now},{merge:true});
          if(!auditSnapshot.exists)transaction.set(auditRef,{id:auditRef.id,businessId,type:'owner_membership_evidence_recorded',actorUid:uid,targetUid:uid,memberRole:'owner',memberStatus:'active',evidence:{profileBusinessMatch:true,businessOwnerMatch:true,authEmailMatch:true,legacyRoleCompatible:true},memberCreated:false,createdAt:now,schemaVersion:1},{merge:false});
        }
        return{member:publicMember(uid,member),created:false,ownerEvidenceRecorded:ownerEvidence&&!auditSnapshot.exists};
      }
      if(!strictOwnerEvidence)
        throw new HttpsError('failed-precondition','Nenhum vínculo de equipe ativo foi encontrado para esta conta.',{reason:'membership-missing',businessId});
      const now=FieldValue.serverTimestamp(),value={uid,name:text(profile.name||request.auth.token?.name,120)||email(request.auth.token?.email),email:email(profile.email||request.auth.token?.email),role:'owner',status:'active',spaceAccess:'all',allowedSpaceIds:[],permissions:ROLE_PRESETS.owner,createdAt:profile.createdAt||now,createdBy:uid,updatedAt:now,schemaVersion:1};
      transaction.set(ref,value,{merge:true});
      transaction.set(membershipRef,{id:`${businessId}_${uid}`,businessId,uid,email:value.email,role:'owner',active:true,status:'active',updatedAt:now},{merge:true});
      transaction.set(business,{maxTeamMembers:company.maxTeamMembers??company.limits?.maxTeamMembers??null,teamSchemaVersion:1,updatedAt:now},{merge:true});
      transaction.set(auditRef,{id:auditRef.id,businessId,type:'owner_membership_recovered',actorUid:uid,targetUid:uid,memberRole:'owner',memberStatus:'active',evidence:{profileBusinessMatch:true,businessOwnerMatch:true,authEmailMatch:true,legacyRoleCompatible:true},memberCreated:true,createdAt:now,schemaVersion:1},{merge:false});
      return{member:publicMember(uid,value),created:true,ownerEvidenceRecorded:true};
    });
  }
  async function invitePreview(request){
    const raw=text(request.data?.token,500),hash=tokenHash(raw);
    if(raw.length<32)throw new HttpsError('invalid-argument','Convite inválido.');
    const index=await db.doc(`teamInviteTokens/${hash}`).get();
    if(!index.exists)throw new HttpsError('not-found','Convite não encontrado.');
    const pointer=index.data(),invite=await db.doc(`businesses/${pointer.businessId}/teamInvites/${pointer.inviteId}`).get(),business=await businessRef(pointer.businessId).get();
    if(!invite.exists||!business.exists)throw new HttpsError('not-found','Convite não encontrado.');
    const data=invite.data(),expired=data.expiresAt?.toMillis?.()<=Date.now();
    return{businessName:text(business.data()?.name,120),name:text(data.name,120),email:email(data.email),role:data.role,status:expired?'expired':data.status,expiresAt:data.expiresAt?.toDate?.().toISOString()||null};
  }
  async function createInvite(request){
    const businessId=text(request.data?.businessId,128),context=await actorContext(request,businessId),role=text(request.data?.role,40).toLowerCase(),inviteEmail=email(request.data?.email),name=text(request.data?.name,120),spaceAccess=request.data?.spaceAccess==='all'?'all':'selected';
    if(!VALID_ROLES.has(role)||!inviteEmail||!name)throw new HttpsError('invalid-argument','Preencha nome, e-mail e cargo.');
    if(role==='owner'&&context.member.role!=='owner')throw new HttpsError('permission-denied','Somente um proprietário pode convidar outro proprietário.');
    const allowedSpaceIds=await validateSpaces(businessId,spaceAccess,request.data?.allowedSpaceIds),permissions=normalizedPermissions(role,request.data?.permissions),raw=crypto.randomBytes(32).toString('base64url'),hash=tokenHash(raw),inviteId=hash.slice(0,28),now=Timestamp.now(),expiresAt=Timestamp.fromMillis(now.toMillis()+7*24*60*60*1000),ref=db.doc(`businesses/${businessId}/teamInvites/${inviteId}`);
    if(context.member.role!=='owner'&&PERMISSIONS.some(key=>permissions[key]&&!hasPermission(context.member,key)))throw new HttpsError('permission-denied','Você não pode conceder uma permissão que não possui.');
    const duplicate=await db.collection(`businesses/${businessId}/members`).where('email','==',inviteEmail).where('status','==','active').limit(1).get();
    if(!duplicate.empty)throw new HttpsError('already-exists','Este e-mail já pertence à equipe ativa.');
    const [activeMembers,pendingInvites]=await Promise.all([
      db.collection(`businesses/${businessId}/members`).where('status','==','active').get(),
      db.collection(`businesses/${businessId}/teamInvites`).where('status','==','pending').get(),
    ]),configuredLimit=context.business.maxTeamMembers??context.business.limits?.maxTeamMembers,
      limit=configuredLimit===null||configuredLimit===undefined||configuredLimit===''?null:Number(configuredLimit);
    if(Number.isFinite(limit)&&limit>=0&&activeMembers.size+pendingInvites.size>=limit)throw new HttpsError('resource-exhausted',`Seu plano permite até ${limit} membro(s) de equipe.`);
    const batch=db.batch();
    batch.set(ref,{id:inviteId,businessId,name,email:inviteEmail,role,status:'pending',spaceAccess,allowedSpaceIds,permissions,tokenHash:hash,expiresAt,createdAt:now,createdBy:context.uid,updatedAt:now,schemaVersion:1});
    batch.set(db.doc(`teamInviteTokens/${hash}`),{businessId,inviteId,expiresAt,createdAt:now},{merge:false});
    batch.set(db.doc(`businesses/${businessId}/auditLogs/team_invite_${inviteId}`),{id:`team_invite_${inviteId}`,businessId,type:'team_invite_created',actorUid:context.uid,inviteId,emailHash:tokenHash(inviteEmail).slice(0,16),createdAt:now,schemaVersion:1});
    await batch.commit();
    const base=String(appUrl||'').replace(/\/$/,'');
    return{invite:{id:inviteId,name,email:inviteEmail,role,status:'pending',spaceAccess,allowedSpaceIds,expiresAt:expiresAt.toDate().toISOString()},inviteUrl:`${base}/?teamInvite=${encodeURIComponent(raw)}`};
  }
  async function acceptInvite(request){
    const uid=request.auth?.uid,authEmail=email(request.auth?.token?.email),raw=text(request.data?.token,500),hash=tokenHash(raw);
    if(!uid||!authEmail)throw new HttpsError('unauthenticated','Entre com o e-mail convidado para aceitar.');
    if(raw.length<32)throw new HttpsError('invalid-argument','Convite inválido.');
    const indexRef=db.doc(`teamInviteTokens/${hash}`),index=await indexRef.get();
    if(!index.exists)throw new HttpsError('not-found','Convite inválido ou já utilizado.');
    const pointer=index.data(),inviteRef=db.doc(`businesses/${pointer.businessId}/teamInvites/${pointer.inviteId}`),profileRef=db.doc(`users/${uid}`),targetMemberRef=memberRef(pointer.businessId,uid);
    return db.runTransaction(async transaction=>{
      const [inviteSnapshot,profileSnapshot,businessSnapshot,memberSnapshot]=await Promise.all([transaction.get(inviteRef),transaction.get(profileRef),transaction.get(businessRef(pointer.businessId)),transaction.get(targetMemberRef)]);
      if(!inviteSnapshot.exists||!businessSnapshot.exists)throw new HttpsError('not-found','Convite não encontrado.');
      const invite=inviteSnapshot.data(),profile=profileSnapshot.data()||{};
      if(invite.tokenHash!==hash||invite.status!=='pending'||invite.expiresAt?.toMillis?.()<=Date.now())throw new HttpsError('failed-precondition','Este convite expirou ou já foi utilizado.');
      if(email(invite.email)!==authEmail)throw new HttpsError('permission-denied','Entre usando o mesmo e-mail que recebeu o convite.');
      const now=FieldValue.serverTimestamp(),member={uid,name:text(invite.name||profile.name||request.auth.token?.name,120)||authEmail,email:authEmail,role:invite.role,status:'active',spaceAccess:invite.spaceAccess==='all'?'all':'selected',allowedSpaceIds:Array.isArray(invite.allowedSpaceIds)?invite.allowedSpaceIds:[],permissions:normalizedPermissions(invite.role,invite.permissions),createdAt:memberSnapshot.data()?.createdAt||now,createdBy:invite.createdBy,acceptedAt:now,updatedAt:now,schemaVersion:1};
      transaction.set(targetMemberRef,member,{merge:true});
      transaction.set(profileRef,{uid,email:authEmail,name:member.name,active:true,businessId:pointer.businessId,previousBusinessId:profile.businessId&&profile.businessId!==pointer.businessId?profile.businessId:profile.previousBusinessId||null,role:member.role,permissions:member.permissions,onboardingCompleted:true,createdAt:profile.createdAt||now,updatedAt:now,lastLoginAt:now},{merge:true});
      transaction.set(db.doc(`memberships/${pointer.businessId}_${uid}`),{id:`${pointer.businessId}_${uid}`,businessId:pointer.businessId,uid,email:authEmail,role:member.role,active:true,status:'active',createdAt:profile.createdAt||now,updatedAt:now},{merge:true});
      transaction.set(inviteRef,{status:'accepted',acceptedBy:uid,acceptedAt:now,updatedAt:now},{merge:true});
      transaction.delete(indexRef);
      transaction.set(db.doc(`businesses/${pointer.businessId}/auditLogs/team_invite_accepted_${pointer.inviteId}`),{id:`team_invite_accepted_${pointer.inviteId}`,businessId:pointer.businessId,type:'team_invite_accepted',actorUid:uid,inviteId:pointer.inviteId,createdAt:now,schemaVersion:1});
      return{businessId:pointer.businessId,member:publicMember(uid,member)};
    });
  }
  async function updateMember(request){
    const businessId=text(request.data?.businessId,128),targetUid=text(request.data?.uid,128),context=await actorContext(request,businessId),targetRef=memberRef(businessId,targetUid);
    if(!targetUid)throw new HttpsError('invalid-argument','Funcionário inválido.');
    return db.runTransaction(async transaction=>{
      const targetSnapshot=await transaction.get(targetRef);
      if(!targetSnapshot.exists)throw new HttpsError('not-found','Funcionário não encontrado.');
      const current=targetSnapshot.data(),role=text(request.data?.role??current.role,40).toLowerCase(),status=text(request.data?.status??current.status,40).toLowerCase(),spaceAccess=request.data?.spaceAccess==='all'?'all':request.data?.spaceAccess==='selected'?'selected':current.spaceAccess;
      if(!VALID_ROLES.has(role)||!VALID_STATUSES.has(status))throw new HttpsError('invalid-argument','Cargo ou status inválido.');
      if(context.member.role!=='owner'&&(current.role==='owner'||role==='owner'))throw new HttpsError('permission-denied','Somente um proprietário pode alterar proprietários.');
      if(context.uid===targetUid&&context.member.role!=='owner'&&(role!==current.role||status!==current.status||spaceAccess!==current.spaceAccess||JSON.stringify(request.data?.permissions||current.permissions)!==JSON.stringify(current.permissions)||JSON.stringify(request.data?.allowedSpaceIds||current.allowedSpaceIds)!==JSON.stringify(current.allowedSpaceIds)))throw new HttpsError('permission-denied','Você não pode elevar o próprio acesso.');
      const demotesOwner=current.role==='owner'&&(role!=='owner'||status!=='active');
      if(demotesOwner){const owners=await transaction.get(db.collection(`businesses/${businessId}/members`).where('role','==','owner').where('status','==','active'));if(owners.size<=1)throw new HttpsError('failed-precondition','A empresa precisa manter ao menos um proprietário ativo.');}
      let allowedSpaceIds=current.allowedSpaceIds||[];
      if(spaceAccess==='selected'){
        allowedSpaceIds=[...new Set((Array.isArray(request.data?.allowedSpaceIds)?request.data.allowedSpaceIds:allowedSpaceIds).map(value=>text(value,120)).filter(Boolean))];
        if(!allowedSpaceIds.length||allowedSpaceIds.length>50)throw new HttpsError('invalid-argument','Selecione ao menos um espaço autorizado.');
        const spaces=await Promise.all(allowedSpaceIds.map(id=>transaction.get(db.doc(`financialSpaces/${id}`))));
        if(spaces.some(snapshot=>!snapshot.exists||snapshot.data()?.active===false||String(snapshot.data()?.businessId||snapshot.data()?.linkedBusinessId||'')!==businessId))
          throw new HttpsError('invalid-argument','Um dos espaços selecionados não pertence a esta empresa.');
      }else allowedSpaceIds=[];
      const permissions=normalizedPermissions(role,request.data?.permissions??current.permissions);
      if(context.member.role!=='owner'&&(role==='owner'||PERMISSIONS.some(key=>permissions[key]&&!hasPermission(context.member,key))))throw new HttpsError('permission-denied','Você não pode conceder uma permissão que não possui.');
      const now=FieldValue.serverTimestamp(),patch={name:text(request.data?.name??current.name,120),role,status,spaceAccess,allowedSpaceIds,permissions,updatedAt:now,updatedBy:context.uid};
      transaction.set(targetRef,patch,{merge:true});
      transaction.set(db.doc(`users/${targetUid}`),{name:patch.name,role,permissions,active:status==='active',updatedAt:now},{merge:true});
      transaction.set(db.doc(`memberships/${businessId}_${targetUid}`),{role,status,active:status==='active',updatedAt:now},{merge:true});
      transaction.set(db.doc(`businesses/${businessId}/auditLogs/team_member_${targetUid}_${Date.now()}`),{businessId,type:status==='disabled'?'team_member_disabled':'team_member_updated',actorUid:context.uid,targetUid,role,status,createdAt:now,schemaVersion:1});
      return{member:publicMember(targetUid,{...current,...patch})};
    });
  }
  async function migrateSensitiveData(request){
    const businessId=text(request.data?.businessId,128),context=await actorContext(request,businessId,{permission:null});
    if(context.member.role!=='owner')throw new HttpsError('permission-denied','Somente o proprietário pode executar esta migração.');
    const businessSnapshot=await businessRef(businessId).get();
    if(Number(businessSnapshot.data()?.sensitiveDataVersion||0)>=1)return{alreadyApplied:true,products:0,variants:0,sales:0,stockMovements:0};
    const [products,variants,sales,stockMovements]=await Promise.all([
      db.collection(`businesses/${businessId}/products`).get(),
      db.collection(`businesses/${businessId}/productVariants`).get(),
      db.collection(`businesses/${businessId}/sales`).get(),
      db.collection(`businesses/${businessId}/stockMovements`).get(),
    ]),operations=[];
    for(const snapshot of products.docs){const data=snapshot.data();if(!('custo' in data)&&!('cost' in data))continue;operations.push({source:snapshot.ref,target:db.doc(`businesses/${businessId}/productFinancials/${snapshot.id}`),financial:{id:snapshot.id,businessId,productId:snapshot.id,custo:data.custo??data.cost??null,schemaVersion:1},deletes:['custo','cost']})}
    for(const snapshot of variants.docs){const data=snapshot.data();if(!('cost' in data)&&!('custo' in data))continue;operations.push({source:snapshot.ref,target:db.doc(`businesses/${businessId}/variantFinancials/${snapshot.id}`),financial:{id:snapshot.id,businessId,variantId:snapshot.id,parentProductId:data.parentProductId||null,cost:data.cost??data.custo??null,schemaVersion:1},deletes:['cost','custo']})}
    for(const snapshot of sales.docs){const data=snapshot.data(),items=Array.isArray(data.itens)?data.itens:[];if(!('custoTotal' in data)&&!('lucro' in data)&&!items.some(item=>'custoUnitario' in item||'costSnapshot' in item||'custoTotal' in item||'lucro' in item))continue;const operationalItems=items.map(item=>{const copy={...item};for(const key of ['custoUnitario','costSnapshot','custoTotal','lucro'])delete copy[key];return copy}),itemCosts=items.map((item,index)=>({index,produtoId:item.produtoId||item.productId||null,variantId:item.variantId||null,custoUnitario:item.custoUnitario??item.costSnapshot??null,custoTotal:item.custoTotal??null,lucro:item.lucro??null}));operations.push({source:snapshot.ref,target:db.doc(`businesses/${businessId}/saleFinancials/${snapshot.id}`),financial:{id:snapshot.id,businessId,saleId:snapshot.id,custoTotal:data.custoTotal??null,lucro:data.lucro??null,itemCosts,schemaVersion:1},deletes:['custoTotal','lucro'],patch:{itens:operationalItems}})}
    for(const snapshot of stockMovements.docs){const data=snapshot.data();if(!('custoUnitario' in data)&&!('costUnit' in data))continue;operations.push({source:snapshot.ref,target:db.doc(`businesses/${businessId}/stockMovementFinancials/${snapshot.id}`),financial:{id:snapshot.id,businessId,stockMovementId:snapshot.id,custoUnitario:data.custoUnitario??data.costUnit??null,schemaVersion:1},deletes:['custoUnitario','costUnit']})}
    for(let offset=0;offset<operations.length;offset+=180){const batch=db.batch();for(const operation of operations.slice(offset,offset+180)){batch.set(operation.target,{...operation.financial,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});batch.update(operation.source,{...(operation.patch||{}),...Object.fromEntries(operation.deletes.map(key=>[key,FieldValue.delete()])),updatedAt:FieldValue.serverTimestamp()})}await batch.commit()}
    await businessRef(businessId).set({sensitiveDataVersion:1,sensitiveDataMigratedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
    return{alreadyApplied:false,products:operations.filter(item=>item.financial.productId).length,variants:operations.filter(item=>item.financial.variantId).length,sales:operations.filter(item=>item.financial.saleId).length,stockMovements:operations.filter(item=>item.financial.stockMovementId).length};
  }
  return{ensureCurrentMembership,invitePreview,createInvite,acceptInvite,updateMember,migrateSensitiveData,actorContext};
}

module.exports={PERMISSIONS,ROLE_PRESETS,normalizedPermissions,hasPermission,teamAccessService};
