'use strict';

const {HttpsError}=require('firebase-functions/v2/https');
const {fiadoRegularizationReviewService}=require('./services/fiado-regularization-review');
const {validId}=require('./services/workspace-reset-policy');
const {openingConfirmationService}=require('./services/fiado-opening-confirmation');
const {COLLECTION:openingCollection}=require('./shared/fiado-opening-balance');

const actions=Object.freeze({
 access:[],list:['limit','cursor','lotOnly'],account:['clientId'],
 prepare:['clientId','mode','revision','items'],
 confirm:['clientId','mode','revision','items','confirmed','requestId','reviewHash'],
 review:['clientId'],reviewLot:[],
 openingPreview:['clientId','balances','reason'],
 openingConfirm:['clientId','balances','reason','confirmed','queueChecked','requestId','reviewHash']
});
const common=['action','businessId','workspaceGeneration'];
const denied=()=>new HttpsError('permission-denied','Central de regularização indisponível para esta conta.');

function scopedFirestore(db,paths){
 return Object.freeze({
  doc:db.doc.bind(db),collection:db.collection.bind(db),
  runTransaction(callback,options){
   if(options?.readOnly===true)return db.runTransaction(tx=>callback(Object.freeze({
    get:tx.get.bind(tx),getAll:tx.getAll.bind(tx)
   })),options);
   if(!paths)throw denied();
   return db.runTransaction(tx=>{
    const write=(ref,value,expected,method,settings)=>{
     if(!expected.includes(ref.path))throw denied();
     if(settings===undefined)tx[method](ref,value);
     else tx[method](ref,value,settings);
    };
    return callback(Object.freeze({
     get:tx.get.bind(tx),getAll:tx.getAll.bind(tx),
     set:(ref,value,settings)=>write(ref,value,[paths.document,paths.signal],'set',settings),
     create:(ref,value)=>write(ref,value,[paths.event],'create')
    }));
   },options);
  }
 });
}

function createOriginEvidenceHandler(db,{access,now}={}){
 const policy=access&&Object.freeze({...access});
 const readonly=scopedFirestore(db);
 const noWrites=fiadoRegularizationReviewService(readonly,{access:policy,now});
 return async request=>{
  const data=request.data,uid=request.auth?.uid;
  if(!uid)throw new HttpsError('unauthenticated','Entre na sua conta.');
  if(policy?.enabled!==true||uid!==policy.ownerUid||data?.businessId!==policy.businessId)throw denied();
  if(data.workspaceGeneration!==policy.workspaceGeneration)throw denied();
  const action=data.action;
  if(!Object.hasOwn(actions,action)||Object.keys(data).some(key=>!common.includes(key)&&!actions[action].includes(key))||
     Buffer.byteLength(JSON.stringify(data))>16000)
   throw new HttpsError('invalid-argument','Ação de conferência inválida.');
  if(action==='openingPreview'||action==='openingConfirm'){
   if(policy.openingEnabled!==true)throw denied();
   if(action==='openingPreview')return openingConfirmationService(readonly,{policy,now:now||(()=>new Date())}).preview(request);
   const id=validId(data.clientId,'Cliente'),base='businesses/'+policy.businessId+'/';
   const opening=scopedFirestore(db,{document:base+'clients/'+id,event:base+openingCollection+'/'+id,signal:base+'syncMetadata/last-sync'});
   return openingConfirmationService(opening,{policy,now:now||(()=>new Date())}).confirm(request);
  }
  if(action!=='confirm')return noWrites[action](request);
  const clientId=validId(data.clientId,'Cliente'),requestId=validId(data.requestId,'Operação');
  const document='businesses/'+policy.businessId+'/fiadoOriginReviews/'+clientId;
  const event=document+'/events/'+policy.workspaceGeneration+'_'+requestId;
  const evidenceOnly=fiadoRegularizationReviewService(scopedFirestore(db,{document,event}),{access:policy,now});
  return evidenceOnly.confirm(request);
 };
}

module.exports={createOriginEvidenceHandler,scopedFirestore};
