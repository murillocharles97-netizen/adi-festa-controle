'use strict';

const {randomUUID,createHash}=require('node:crypto');
const {fixture}=require('./fiado-history-proof.cjs');
const Plan=require('../../functions/src/shared/installment-plan');
const {fiadoRegularizationReviewService}=require('../../functions/src/services/fiado-regularization-review');

const day='2026-11-11';
const now=()=>new Date(day+'T15:00:00.000Z');
const ledgers=['sales','payments','balanceAdjustments','balanceEvents','paymentAllocations','processedOperations'];

async function seedReview(db,{uid='qa-owner-'+randomUUID()}={}){
 const businessId='qa-central-'+randomUUID(),root=db.doc('businesses/'+businessId);
 const adiSpaceId='qa-adi-'+randomUUID(),cardSpaceId='qa-card-'+randomUUID();
 const owner={uid},manager={uid:'qa-manager-'+randomUUID()};
 const access={enabled:true,businessId,ownerUid:uid,adiSpaceId,cardSpaceId,legacyBefore:'2026-11-09'};
 const batch=db.batch();
 batch.set(root,{id:businessId,name:'Empresa de QA',active:true,ownerId:uid,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}});
 for(const [actor,role] of [[owner,'owner'],[manager,'manager']]){
  batch.set(db.doc('users/'+actor.uid),{uid:actor.uid,businessId,active:true,role});
  batch.set(root.collection('members').doc(actor.uid),{uid:actor.uid,role,status:'active',permissionsVersion:2,spaceAccess:'all',
   permissions:{'customers.view':true,'customers.receiveDebt':true,'team.view':true}});
 }
 for(const [id,name] of [[adiSpaceId,'Adi Festa'],[cardSpaceId,'Emprestar Cartão']]){
  batch.set(db.doc('financialSpaces/'+id),{id,name,businessId,linkedBusinessId:businessId,type:'business',active:true,workspaceGeneration:0,
   capabilities:{sales:true,finance:true},ownerUid:uid});
 }
 const make=(clientId,nome,scenario)=>{
  const input=fixture([2800,300,256,-309]),times=['2026-08-01','2026-10-15','2026-10-16','2026-10-22'];
  const key=id=>clientId+'-'+id;
  const client={...input.client,id:clientId,businessId,nome,ativo:true,fiadoHistoryVersion:1,hasInstallmentFiado:true};
  batch.set(root.collection('clients').doc(clientId),client);
  for(const [kind,rows] of Object.entries(input.collections))for(const row of rows){
   const next={...row,businessId,id:key(row.id)};
   for(const prop of ['clienteId','clientId','customerId'])if(next[prop])next[prop]=clientId;
   if(next.operationId)next.operationId=key(next.operationId);
   if(next.sourceDocumentId){next.sourceDocumentId=key(next.sourceDocumentId);next.id=next.type+':'+next.sourceDocumentId;}
   const source=next.sourceDocumentId||next.id;
   const n=Number(source.at(-1));
   const stamp=times[n]+'T15:00:00.000Z';
   if(next.financialAppliedAt)next.financialAppliedAt=stamp;
   if(next.data)next.data=stamp;
   if(next.appliedAt)next.appliedAt=stamp;
   if(kind==='sales'){
    next.spaceId=cardSpaceId;
    next.financialSpaceId=cardSpaceId;
    next.installmentPlan=Plan.create({total:2800,count:10,firstDueDate:'2026-11-09',saleDate:'2026-08-01'});
   }
   if(kind==='payments'){next.spaceId=adiSpaceId;next.legacyAmount=309;next.allocatedAmount=0;}
   if(kind==='balanceEvents'&&next.type==='credit_sale'){next.spaceId=cardSpaceId;next.financialSpaceId=cardSpaceId;}
   if(kind==='balanceEvents'&&n===2&&scenario==='conflict')next.operationId='wrong-qa-op';
   batch.set(root.collection(kind).doc(next.id),next);
  }
  if(scenario!=='missing-cash'){
   const sourceId=key('qa-source-3');
   batch.set(db.doc('financialSpaces/'+adiSpaceId+'/entries/credit_payment_'+sourceId),{sourceId,amountCents:30900,direction:'in',status:'paid'});
  }
 };
 make('qa-main','Mariana Lopes');
 make('qa-conflict','Rafael Moura','conflict');
 make('qa-no-cash','Beatriz Rocha','missing-cash');
 batch.set(root.collection('clients').doc('qa-discarded'),{businessId,saldo:-10000,ativo:false,nome:'Cliente inativo QA'});
 await batch.commit();
 const request=(clientId='qa-main',data={},auth=owner)=>({auth,data:{businessId,workspaceGeneration:0,clientId,...data}});
 const originLinks=[1,2,3].map(i=>{
  const sourceId='qa-main-qa-source-'+i;
  return {sourceCollection:i===3?'payments':'balanceAdjustments',sourceId,
   eventId:(i===3?'payment_received:':'balance_adjustment:')+sourceId,operationId:'qa-main-qa-op-'+i,spaceId:adiSpaceId};
 });
 access.approvedLotBytes=Buffer.from(JSON.stringify({businessId,generation:0,accountCount:1,originLinkCount:3,
  accepted:[{clientId:'qa-main',originLinks}]}));
 access.approvedLotSha256=createHash('sha256').update(access.approvedLotBytes).digest('hex');
 const api=fiadoRegularizationReviewService(db,{access,now});
 return {api,request,root,businessId,owner,manager,access,adiSpaceId,cardSpaceId};
}

module.exports={seedReview,ledgers,day,now};
