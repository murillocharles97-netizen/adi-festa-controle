'use strict';
const {AccessError}=require('./broker');
// A genuine Google proof is tested only AFTER signature/nonce/pilot checks and
// authoritative confirmation that the native provider is disabled. No Auth
// result or returned credential is persisted or exposed.
function disabledNativeProbe({apiKey,fetchImpl=fetch}){
 if(typeof apiKey!=='string'||!apiKey.startsWith('AIza'))throw Error('Pinned Firebase Web key required');
 return async(googleIdToken,origin)=>{
  const response=await fetchImpl('https://identitytoolkit.googleapis.com/v1/accounts:signInWithIdp?key='+encodeURIComponent(apiKey),{
   method:'POST',headers:{'Content-Type':'application/json'},
   body:JSON.stringify({requestUri:origin+'/',postBody:new URLSearchParams({providerId:'google.com',id_token:googleIdToken}).toString(),returnSecureToken:true,returnIdpCredential:false}),
   signal:AbortSignal.timeout(10000),
  });
  const result=await response.json();
  const code=typeof result.error?.message==='string'?result.error.message.split(' : ')[0]:'';
  if(response.status!==400||code!=='OPERATION_NOT_ALLOWED')throw new AccessError('native-block-unconfirmed');
  return{blocked:true};
 };
}
module.exports={disabledNativeProbe};
