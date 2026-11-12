'use strict';

const {createHash}=require('node:crypto');

const ORIGIN_AUDIT_COLLECTION='fiadoHistoryRegularizations';
const eventKinds={sales:['credit_sale','sale'],payments:['payment_received','payment'],balanceAdjustments:['balance_adjustment','balance_adjustment']};
const id=value=>typeof value==='string'&&/^[\w:-]{1,180}$/.test(value);
const space=row=>row.spaceId||row.financialSpaceId||null;
const fail=()=>{throw Error('Vínculo de origem sem evidência compatível.');};

// Bind only immutable identities and effects. A later, valid payment can
// update a sale's paid/remaining counters without invalidating its origin.
function resolveOrigins(input,links,{stored=false}={}){
 const {collections,businessId,generation,client}=input;
 if(!Array.isArray(links)||links.length>120)fail();
 const sources=Object.fromEntries(Object.keys(eventKinds).map(kind=>[kind,new Map(collections[kind].map(row=>[row.id,row]))]));
 const events=new Map(collections.balanceEvents.map(row=>[row.id,row]));
 const markers=new Map(collections.processedOperations.map(row=>[row.id,row]));
 const sourcesUsed=new Set(),resolved=[];
 const scope=(row,destination)=>[row.spaceId,row.financialSpaceId].every(value=>!value||value===destination);
 for(const link of links){
  if(!link||!Object.hasOwn(eventKinds,link.sourceCollection)||![link.sourceId,link.eventId,link.operationId,link.spaceId].every(id))fail();
  const {sourceCollection,sourceId,eventId,operationId,spaceId}=link;
  const source=sources[sourceCollection].get(sourceId),event=events.get(eventId),marker=markers.get(operationId);
  const [eventType,eventKind]=eventKinds[sourceCollection],key=sourceCollection+':'+sourceId;
  if(!source||!event||!marker||sourcesUsed.has(key)||source.operationId!==operationId||
     event.id!==eventType+':'+sourceId||event.sourceCollection!==sourceCollection||event.sourceDocumentId!==sourceId||
     event.operationId!==operationId||event.type!==eventType||event.status!=='applied'||marker.eventKind!==eventKind||marker.status!=='processed'||
     !Number.isFinite(event.balanceDelta)||!Number.isFinite(Date.parse(event.appliedAt))||Date.parse(source.financialAppliedAt)!==Date.parse(event.appliedAt)||
     [source,event,marker].some(row=>(row.businessId&&row.businessId!==businessId)||(row.workspaceGeneration??0)!==generation||!scope(row,spaceId)))fail();
  for(const row of [source,event]){
   const owners=[row.clienteId,row.clientId,row.customerId].filter(Boolean);
   if(!owners.length||owners.some(value=>value!==client.id))fail();
  }
  if(!stored&&space(source)&&space(event))fail();
  const proofHash=createHash('sha256').update(JSON.stringify([businessId,generation,client.id,sourceCollection,sourceId,
   eventId,operationId,spaceId,event.appliedAt,event.balanceDelta])).digest('hex');
  if(stored&&link.proofHash!==proofHash)fail();
  sourcesUsed.add(key);
  resolved.push({sourceCollection,sourceId,eventId,operationId,spaceId,proofHash});
 }
 return resolved.sort((a,b)=>a.eventId.localeCompare(b.eventId));
}

function withOrigins(input,links){
 if(!links?.length)return input;
 const verified=resolveOrigins(input,links,{stored:true});
 const bySource=new Map(verified.map(row=>[row.sourceCollection+':'+row.sourceId,row.spaceId]));
 const byEvent=new Map(verified.map(row=>[row.eventId,row.spaceId]));
 const fill=(row,id)=>id?{...row,spaceId:row.spaceId||id,financialSpaceId:row.financialSpaceId||id}:row;
 const collections={...input.collections,balanceEvents:input.collections.balanceEvents.map(row=>fill(row,
  byEvent.get(row.id)||(row.type==='credit_sale_reversal'?bySource.get(row.sourceCollection+':'+row.sourceDocumentId):null)))};
 for(const kind of Object.keys(eventKinds))collections[kind]=input.collections[kind].map(row=>fill(row,bySource.get(kind+':'+row.id)));
 if(collections.balanceEvents.some(row=>row.spaceId&&row.financialSpaceId&&row.spaceId!==row.financialSpaceId))fail();
 return {...input,collections};
}

function originLinksDigest(links){
 const keys=['sourceCollection','sourceId','eventId','operationId','spaceId','proofHash','cashPath','cashProof'];
 return createHash('sha256').update(JSON.stringify(links.map(link=>keys.map(key=>link?.[key]??null)))).digest('hex');
}

function activationAuditMatches(activation,audit,input){
 if(!audit||audit.type!=='fiado_history_activation'||audit.businessId!==input.businessId||
    audit.workspaceGeneration!==input.generation||audit.clientId!==input.client.id||
    audit.activationId!==activation.activationId||audit.actorUid!==activation.activatedBy||
    !/^[a-f0-9]{64}$/.test(activation.evidenceDigest)||audit.evidenceDigest!==activation.evidenceDigest||
    !/^[a-f0-9]{64}$/.test(activation.reviewHash)||audit.reviewHash!==activation.reviewHash||
    !Array.isArray(audit.originLinks)||!audit.originLinks.length)return false;
 return activation.originLinksDigest===originLinksDigest(audit.originLinks);
}

module.exports={ORIGIN_AUDIT_COLLECTION,resolveOrigins,withOrigins,originLinksDigest,activationAuditMatches};
