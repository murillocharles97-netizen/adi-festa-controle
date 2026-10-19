'use strict';

// Evidence custody only. Never invoke sales, inventory, balance or income services.
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {assertWritable,validId,belongsToWorkspace}=require('./workspace-reset-policy');
const fail=(code,message)=>{throw new HttpsError(code,message);};
const digest=s=>createHash('sha256').update(s).digest('hex');
function payloadChecksum(value){
  // Same diagnostic FNV semantics as Sync; SHA-256 additionally binds EVERY
  // byte of the immutable packet, including metadata ignored by this checksum.
  const ignored=new Set(['ownerId','businessId','source','createdAt','criadoEm','updatedAt','atualizadoEm','serverUpdatedAt','localUpdatedAt','version','revision','schemaVersion','idempotencyKey','entityType','action','recoveryChecksum','createdBy','sourceDeviceId','appliedAt','financialAppliedAt','financialOperationId','financialRevision','financialReconciledAt','openBalance']);
  const comparable=v=>Array.isArray(v)?v.map(comparable):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>!ignored.has(k)&&!k.startsWith('__')).map(k=>[k,comparable(v[k])])):v;
  const text=JSON.stringify(comparable(value));let hash=2166136261;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619);}
  return `fnv1a:${(hash>>>0).toString(16).padStart(8,'0')}`;
}
function historicalProjection(packet){
  const fields={products:['custo','cost'],productVariants:['cost','custo'],sales:['custoTotal','lucro']};
  const meta=['operationId','idempotencyKey','businessId','entityType','action','createdAt','schemaVersion'];
  const writes=packet.payload?.writes;
  return ['simple','legacy'].includes(packet.payload?.eventKind||'simple')&&Array.isArray(writes)&&writes.some(w=>w?.entityType==='sales')&&
    writes.some(w=>Object.keys(w?.data||{}).some(k=>fields[w?.entityType]?.includes(k)))&&writes.every(w=>
      w?.operation==='update'&&fields[w.entityType]&&w.data&&Object.keys(w.data).every(k=>fields[w.entityType].includes(k)||meta.includes(k)));
}
function validate(data){
  if(typeof data.originalPacketJson!=='string'||Buffer.byteLength(data.originalPacketJson)>700*1024)fail('invalid-argument','A evidência excede o limite seguro. O original continua preservado.');
  if(!/^[a-f0-9]{64}$/.test(data.contentHash||'')||digest(data.originalPacketJson)!==data.contentHash)fail('invalid-argument','A conferência da evidência falhou.');
  let packet;try{packet=JSON.parse(data.originalPacketJson);}catch{fail('invalid-argument','Evidência inválida.');}
  if(!packet||Array.isArray(packet)||typeof packet!=='object')fail('invalid-argument','Pacote de evidência inválido.');
  if(!packet.payload||Array.isArray(packet.payload)||typeof packet.payload!=='object')fail('invalid-argument','Payload de evidência inválido.');
  const inspect=(v,depth=0)=>{if(depth>35)fail('invalid-argument','Evidência muito complexa.');if(v&&typeof v==='object')for(const [k,x]of Object.entries(v)){if(/^(password|senha|authorization|auth_?token|api_?key|access_?token|refresh_?token|id_?token|secret|credential)$/i.test(k))fail('invalid-argument','A evidência contém um campo protegido.');inspect(x,depth+1);}};inspect(packet);
  const operationId=validId(packet.operationId,'Operação'),businessId=validId(packet.businessId,'Empresa'),userId=validId(packet.userId,'Origem');
  if(data.businessId!==businessId||!/^fnv1a:[a-f0-9]{8}$/.test(data.payloadChecksum||''))fail('invalid-argument','Identificação da evidência divergente.');
  if(payloadChecksum(packet.payload)!==data.payloadChecksum)fail('invalid-argument','O checksum original não confere. A evidência não foi reescrita.');
  const explicit=['quarantined','manual_review'].includes(packet.status)||['quarantined','manual_review'].includes(packet.reviewStatus)||packet.quarantined===true||packet.reviewRequired===true;
  if(!historicalProjection(packet)&&!explicit)fail('failed-precondition','Esta operação não está explicitamente em quarentena. Vendas retidas usam a revisão de vendas.');
  const writes=packet.payload?.writes;
  if(!Array.isArray(writes)||!writes.length||writes.length>350)fail('invalid-argument','Gravações da evidência inválidas.');
  const allowed=new Set(['sales','products','productVariants','clients','stockMovements','payments','balanceAdjustments','balanceEvents','campaigns','campaignProgress','campaignEvents','campaignRedemptions','paymentAllocations','customerSubscriptions','customerSubscriptionEvents','rewards']);
  for(const w of writes){if(!w||typeof w!=='object')fail('invalid-argument','Gravação da evidência inválida.');validId(w.entityId,'Documento');if(!allowed.has(w.entityType)||!['create','update','delete'].includes(w.operation))fail('invalid-argument','Coleção da evidência não suportada.');}
  return {packet,operationId,businessId,userId,writes,reason:historicalProjection(packet)?'historical_projection_without_user_action':'explicit_manual_review'};
}
function syncIncidentService(db,{FieldValue}){
  async function context(reader,request){
    const uid=request.auth?.uid;if(!uid)fail('unauthenticated','Entre na conta de origem.');
    const businessId=validId(request.data?.businessId,'Empresa');
    const [b,m,p]=await Promise.all([reader.get(db.doc(`businesses/${businessId}`)),reader.get(db.doc(`businesses/${businessId}/members/${uid}`)),reader.get(db.doc(`users/${uid}`))]);
    if(!b.exists||!m.exists||!p.exists||b.data().active!==true||m.data().status!=='active'||p.data().active!==true)fail('permission-denied','Vínculo ativo obrigatório.');
    assertWritable(b.data(),request.data.workspaceGeneration??0);
    return {uid,businessId,business:b.data(),member:m.data(),owner:b.data().ownerId===uid&&m.data().role==='owner'};
  }
  async function archive(request){
    if(!request.auth?.uid)fail('unauthenticated','Entre na conta de origem.');
    const v=validate(request.data||{});
    return db.runTransaction(async tx=>{
      const c=await context(tx,request);
      // The originating authenticated account closes its own incident. An owner
      // may inspect the custody record but cannot invent another actor's packet.
      if(c.uid!==v.userId||(v.packet.workspaceGeneration??0)!==(c.business.workspaceGeneration??0))fail('permission-denied','A evidência não pertence à sessão atual.');
      const ids=new Set();
      for(const w of v.writes)for(const value of [w.data,w.before]){
        if(value?.businessId&&value.businessId!==c.businessId||value?.actorUid&&w.operation==='create'&&value.actorUid!==c.uid)fail('permission-denied','Evidência de outra origem.');
        if(value?.spaceId)ids.add(validId(value.spaceId,'Espaço'));
      }
      for(const id of ids){const s=await tx.get(db.doc(`financialSpaces/${id}`));if(!s.exists||!belongsToWorkspace(s.data(),c.businessId)||!c.owner&&c.member.spaceAccess!=='all'&&!c.member.allowedSpaceIds?.includes(id))fail('permission-denied','Espaço da evidência não autorizado.');}
      const ref=db.doc(`businesses/${v.businessId}/syncIncidentArchives/${v.operationId}`),rawRef=ref.collection('original').doc('packet'),marker=db.doc(`businesses/${v.businessId}/processedOperations/${v.operationId}`);
      const [old,raw,processed]=await Promise.all([tx.get(ref),tx.get(rawRef),tx.get(marker)]);
      if(old.exists||raw.exists){
        if(!old.exists||!raw.exists||!processed.exists||old.data().contentHash!==request.data.contentHash||raw.data().originalPacketJson!==request.data.originalPacketJson||processed.data().status!=='archived_without_effects')fail('already-exists','Há evidência diferente para esta operação. Nada foi sobrescrito.');
        return receipt(old.data());
      }
      if(processed.exists)fail('failed-precondition','A operação já possui confirmação remota. Pare e revise antes de arquivar.');
      for(const name of ['sales','stockMovements','balanceEvents','payments']){
        const effects=await tx.get(db.collection(`businesses/${v.businessId}/${name}`).where('operationId','==',v.operationId).limit(1));
        if(!effects.empty)fail('failed-precondition','Existe efeito remoto com este operationId. O incidente exige revisão.');
      }
      // Explicit quarantines may contain commercial creates. Existing effects
      // must never be relabelled as "without effects".
      for(const w of v.writes.filter(w=>w.operation==='create'))if((await tx.get(db.doc(`businesses/${v.businessId}/${w.entityType}/${w.entityId}`))).exists)fail('failed-precondition','Um documento original já existe na nuvem. O incidente exige revisão.');
      const archivedAt=new Date().toISOString(),data={version:1,status:'archived',resolution:'closed_without_replay',businessId:v.businessId,operationId:v.operationId,actorUid:c.uid,archivedBy:c.uid,archivedRole:c.member.role,archivedAt,recordedAt:FieldValue.serverTimestamp(),method:'explicit_originating_user_confirmation',reason:v.reason,contentHash:request.data.contentHash,payloadChecksum:request.data.payloadChecksum,workspaceGeneration:c.business.workspaceGeneration??0,commercialEffectsApplied:false,writeCount:v.writes.length,spaceIds:[...ids]};
      tx.create(ref,data);
      tx.create(rawRef,{originalPacketJson:request.data.originalPacketJson,contentHash:data.contentHash,formatVersion:1});
      // Same immutable idempotency fence read by all published Sync versions.
      // This marker means BLOCKED, never a confirmed sale or financial effect.
      tx.create(marker,{id:v.operationId,idempotencyKey:v.operationId,businessId:v.businessId,ownerId:c.uid,status:'archived_without_effects',eventKind:'sync_incident_archive',archivedAt,contentHash:data.contentHash,schemaVersion:3,workspaceGeneration:data.workspaceGeneration});
      return receipt(data);
    });
  }
  const receipt=data=>({operationId:data.operationId,businessId:data.businessId,actorUid:data.actorUid,status:'archived',resolution:data.resolution,archivedAt:data.archivedAt,archivedBy:data.archivedBy,method:data.method,contentHash:data.contentHash,payloadChecksum:data.payloadChecksum,commercialEffectsApplied:false});
  async function get(request){
    const c=await context({get:ref=>ref.get()},request),id=validId(request.data.operationId,'Operação');
    const snap=await db.doc(`businesses/${c.businessId}/syncIncidentArchives/${id}`).get();
    if(!snap.exists)return {status:'not_found'};
    if(snap.data().actorUid!==c.uid&&!c.owner)fail('permission-denied','Ocorrência de outra conta.');
    // Never return the original packet/private commercial fields to the UI.
    return receipt(snap.data());
  }
  return {archive,get};
}
module.exports={syncIncidentService,validate,historicalProjection,payloadChecksum};
