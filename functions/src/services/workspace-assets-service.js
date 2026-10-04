'use strict';
const {HttpsError}=require('firebase-functions/v2/https');
const {assertWritable,validId}=require('./workspace-reset-policy');
function workspaceAssetsService(db,bucket){
  async function remove(request){
    const uid=request.auth?.uid,businessId=validId(request.data?.businessId,'Empresa'),epoch=request.data?.workspaceGeneration;
    if(!uid)throw new HttpsError('unauthenticated','Entre na sua conta.');
    const path=String(request.data?.path||''),prefix=`businesses/${businessId}/`;
    const relative=path.startsWith(prefix)?path.slice(prefix.length):'';
    if(!/^(?:products\/[A-Za-z0-9_-]+(?:\/variants\/[A-Za-z0-9_-]+)?|catalog\/(?:products|categories|banners)\/[A-Za-z0-9_-]+)\/(?:main|thumb)-[A-Za-z0-9_-]{1,80}\.(?:webp|jpg)$/.test(relative))
      throw new HttpsError('permission-denied','Arquivo fora do escopo permitido.');
    const businessRef=db.doc(`businesses/${businessId}`),memberRef=businessRef.collection('members').doc(uid);
    async function authorize(){
      return db.runTransaction(async tx=>{
        const [business,member]=await Promise.all([tx.get(businessRef),tx.get(memberRef)]);
        assertWritable(business.data(),epoch);
        const access=member.data();
        if(access?.status!=='active'||access.role!=='owner'&&access.permissions?.['products.edit']!==true)
          throw new HttpsError('permission-denied','Sem permissão para gerenciar imagens.');
      });
    }
    await authorize();
    let metadata;
    try{[metadata]=await bucket.file(path).getMetadata();}catch(error){if(Number(error.code)===404)return{removed:false,alreadyAbsent:true};throw error;}
    if(String(metadata.metadata?.workspaceGeneration??'0')!==String(epoch))throw new HttpsError('failed-precondition','A imagem pertence a outra geração.');
    await authorize();
    // Firestore and GCS cannot share a transaction. Exact object-version deletion
    // ensures an old authorized request cannot remove a replacement after reset.
    await bucket.file(path,{generation:metadata.generation,preconditionOpts:{ifGenerationMatch:metadata.generation}}).delete({ignoreNotFound:true});
    return{removed:true};
  }
  return{remove};
}
module.exports={workspaceAssetsService};
