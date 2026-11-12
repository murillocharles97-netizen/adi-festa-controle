'use strict';

const {HttpsError}=require('firebase-functions/v2/https');
const Plan=require('../shared/installment-plan');
const History=require('../shared/fiado-history-account');
const Opening=require('../shared/fiado-opening-balance');
const {validId}=require('./workspace-reset-policy');
const {readHistoryInput}=require('./fiado-history-service');

const deny=()=>new HttpsError('permission-denied','A confirmação de saldo está indisponível para esta conta.');
const invalid=message=>new HttpsError('failed-precondition',message,{reason:'fiado-opening-review-required'});

function openingConfirmationService(db,{policy,now}){
 const ref=(bid,col,id)=>db.doc('businesses/'+bid+'/'+col+'/'+id);
 async function owner(tx,request,readOnly){
  const uid=request.auth?.uid,data=request.data||{};
  if(policy?.openingEnabled!==true||!uid||uid!==policy.ownerUid||data.businessId!==policy.businessId||
     data.workspaceGeneration!==policy.workspaceGeneration)throw deny();
  const {authorize}=require('./operational-commit-service').operationalCommitService(db,{now});
  const scope=await authorize(tx,request,{businessId:data.businessId,userId:uid,workspaceGeneration:data.workspaceGeneration},{readOnly});
  if(!scope.owner||scope.business.ownerId!==uid||scope.member?.status!=='active')throw deny();
  return scope;
 }
 async function plan(tx,scope,id,balances,reason,at){
  const clientRef=ref(scope.bid,'clients',id),client=(await tx.get(clientRef)).data();
  if(!client||(client.workspaceGeneration??0)!==(scope.business.workspaceGeneration??0)||
     client.businessId&&client.businessId!==scope.bid)throw deny();
  const spaces=[policy.adiSpaceId,policy.cardSpaceId];
  if(new Set(spaces).size!==2||spaces.some(id=>!id))throw deny();
  const scoped=await Promise.all(spaces.map(id=>scope.space(id)));
  if(scoped.some(space=>space.status==='archived'||space.capabilities?.sales!==true&&
    !['business','unit','operation'].includes(space.type)||space.capabilities?.sales===false))throw deny();
  const input=await readHistoryInput({tx,c:scope,ref,clientId:id,client,checkRowAccess:false,useActivatedOrigins:false});
  const day=Plan.today(at);
  let proposal;
  try{
   proposal=Opening.createPlan(input,{day,spaceIds:spaces,balances,reason});
   History.project({...input,client:{...client,saldo:saldo(proposal)},opening:{...proposal,at:at.toISOString()}},day,{scoped:true});
  }catch(error){throw invalid(error.message);}
  const evidence=require('./fiado-history-regularization').evidenceDigest(input);
  return {clientRef,proposal,evidence,reviewHash:Opening.digest([proposal,evidence])};
 }
 const saldo=proposal=>proposal.confirmedCents===0?0:-proposal.confirmedCents/100;
 const publicPlan=({proposal,reviewHash})=>{
  const {bookCents,confirmedCents,deltaCents,reason,parts,financialVersion}=proposal;
  return {reviewHash,bookCents,confirmedCents,deltaCents,reason,parts,financialVersion};
 };
 const preview=request=>db.runTransaction(async tx=>{
  const scope=await owner(tx,request,true);
  return publicPlan(await plan(tx,scope,validId(request.data.clientId,'Cliente'),request.data.balances,request.data.reason,now()));
 },{readOnly:true});

 const confirm=request=>db.runTransaction(async tx=>{
  const scope=await owner(tx,request,false),data=request.data,id=validId(data.clientId,'Cliente');
  const requestId=validId(data.requestId,'Operação');
  if(data.confirmed!==true||data.queueChecked!==true||!Array.isArray(data.balances)||!/^[a-f0-9]{64}$/.test(data.reviewHash||''))
   throw invalid('Confira as filas dos aparelhos e confirme o resumo do saldo.');
  const auditRef=ref(scope.bid,Opening.COLLECTION,id),prior=(await tx.get(auditRef)).data();
  const requestHash=Opening.digest([requestId,data.reviewHash,data.balances,data.reason??'']);
  if(prior){
   const client=(await tx.get(ref(scope.bid,'clients',id))).data();
   if(prior.actorUid===scope.uid&&prior.workspaceGeneration===data.workspaceGeneration&&prior.requestHash===requestHash&&
      client?.fiadoOpeningBalance?.hash===prior.hash)return {status:'replayed',writesApplied:0};
   throw invalid('Já existe confirmação de saldo para esta conta.');
  }
  const instant=now(),prepared=await plan(tx,scope,id,data.balances,data.reason,instant);
  if(prepared.reviewHash!==data.reviewHash)throw invalid('O saldo ou o histórico mudou. Revise novamente.');
  const at=instant.toISOString(),details={plan:prepared.proposal,at,actorUid:scope.uid,requestId,reviewHash:prepared.reviewHash};
  const hash=Opening.digest(details);
  tx.create(auditRef,{...details,type:'fiado_confirmed_opening',version:1,hash,requestHash,evidenceDigest:prepared.evidence,
   clientId:id,businessId:scope.bid,workspaceGeneration:data.workspaceGeneration});
  tx.set(prepared.clientRef,{fiadoOpeningBalance:{version:1,hash},fiadoHistoryVersion:1,
   saldo:saldo(prepared.proposal),financialVersion:prepared.proposal.financialVersion+1,updatedAt:at,updatedByUid:scope.uid},{merge:true});
  const revision='server:fiado-opening:'+id+':'+prepared.proposal.financialVersion;
  tx.set(ref(scope.bid,'syncMetadata','last-sync'),{businessId:scope.bid,workspaceGeneration:data.workspaceGeneration,
   publisher:'operational_server',sourceSessionId:revision,sourceOperationId:revision,ownerId:scope.uid,actorUid:scope.uid,
   sourceUid:scope.uid,revision,updatedAt:at,changedCollections:['clients'],collectionVersions:{clients:revision}},{merge:true});
  return {status:'confirmed',writesApplied:3,...publicPlan(prepared)};
 });
 return {preview,confirm};
}

module.exports={openingConfirmationService};
