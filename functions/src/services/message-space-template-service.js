'use strict';
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {validId}=require('./workspace-reset-policy');
const {restricted}=require('../shared/operational-privacy-policy');

const TYPES=['charge','campaign','notice','custom','renewal'];
const error=(code,message)=>{throw new HttpsError(code,message);};
const trim=(value,max)=>typeof value==='string'&&value.length<=max?value.trim():'';

async function handle({tx,c,ref,d,now,write=false}){
 const spaceId=validId(d.spaceId,'Espaço');
 if(!c.has('customers.view')||!c.has('customers.edit')||restricted(c.member))
  error('permission-denied','Sem acesso aos modelos deste espaço.');
 const space=await c.space(spaceId);
 if(space.active===false||space.status==='archived')error('permission-denied','Espaço indisponível.');
 const workspaceGeneration=c.business.workspaceGeneration??0,scopeKey=workspaceGeneration+':'+spaceId;
 const collection=ref(c.bid,'messageSpaceTemplates','_').parent;
 const belongs=row=>row?.businessId===c.bid&&row.spaceId===spaceId&&row.workspaceGeneration===workspaceGeneration;
 const safe=(id,row)=>({id,name:row.name,content:row.content,type:row.type,revision:row.revision});
 if(!write){
  const rows=(await tx.get(collection.where('scopeKey','==',scopeKey).limit(100))).docs;
  return {templates:rows.filter(row=>belongs(row.data())).map(row=>safe(row.id,row.data())),limitReached:rows.length===100};
 }
 const templateId=validId(d.templateId,'Modelo'),name=trim(d.name,100),content=trim(d.content,4000);
 if(!name||!content||!TYPES.includes(d.type))error('invalid-argument','Confira nome, tipo e mensagem do modelo.');
 const id=createHash('sha256').update(JSON.stringify([scopeKey,templateId])).digest('hex');
 // An existing model ID comes from the scoped reader and the scope is checked again.
 const target=collection.doc(d.revision>0?templateId:id),prior=(await tx.get(target)).data();
 if((prior&&!belongs(prior))||(d.revision>0&&!prior))error('permission-denied','Modelo fora deste espaço.');
 if(d.revision!==(prior?.revision??0))error('aborted','O modelo mudou. Reabra antes de salvar.');
 if(!prior&&(await tx.get(collection.where('scopeKey','==',scopeKey).limit(100))).size>=100)
  error('resource-exhausted','O espaço atingiu o limite de 100 modelos.');
 const next={businessId:c.bid,workspaceGeneration,spaceId,scopeKey,name,content,type:d.type,
  revision:(prior?.revision??0)+1,updatedBy:c.uid,updatedAt:now.toISOString()};
 tx.set(target,next);
 return {template:safe(target.id,next)};
}
module.exports={handle};
