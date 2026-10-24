'use strict';
const {HttpsError}=require('firebase-functions/v2/https');
// Explicit domain rejections must not turn into transient "internal" errors
// at the callable boundary and accidentally re-enter the Sync retry loop.
function operationalCallable(action,{requireProtocol=false}={}){return async request=>{
 if(requireProtocol){
  if(!request.auth?.uid)throw new HttpsError('unauthenticated','Entre na sua conta.');
  if(request.data?.syncProtocolVersion!==1||!Number.isInteger(request.data?.clientRelease)||request.data.clientRelease<202)
   throw new HttpsError('failed-precondition','Atualize a VECONI antes de sincronizar. A fila original foi preservada.',{reason:'sync-update-required'});
 }
 try{return await action(request);}catch(error){
  if(error instanceof HttpsError)throw error;
  const code=String(error?.code||'');
  if(/^(online-|campaign-|financial-|product-import-|stock-)/.test(code))throw new HttpsError('failed-precondition','A operação exige atualização ou revisão antes de continuar.',{reason:code});
  throw error;
 }
};}
module.exports={operationalCallable};
