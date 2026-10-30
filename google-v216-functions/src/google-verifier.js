'use strict';
const {createHash}=require('node:crypto');
const {AccessError}=require('./broker');
function googleVerifier({clientId,verifyIdToken,now=Date.now}){
 if(!clientId?.endsWith('.apps.googleusercontent.com'))throw Error('Dedicated OAuth audience required');
 return async(token,{nonceHash,issuedAt})=>{
  const fail=()=>{throw new AccessError();};
  if(typeof token!=='string'||token.length>16384)fail();let claims;
  try{claims=(await verifyIdToken({idToken:token,audience:clientId})).getPayload();}catch{fail();}
  if(!claims||!['accounts.google.com','https://accounts.google.com'].includes(claims.iss)||claims.aud!==clientId||claims.azp&&claims.azp!==clientId||typeof claims.sub!=='string'||!claims.sub||claims.sub.length>255||claims.email_verified!==true||typeof claims.email!=='string'||!claims.email.includes('@')||typeof claims.nonce!=='string'||createHash('sha256').update(claims.nonce).digest('hex')!==nonceHash||!Number.isSafeInteger(claims.exp)||claims.exp*1000<=now()||!Number.isSafeInteger(claims.iat)||claims.iat*1000<issuedAt-60000||claims.iat*1000>now()+60000||claims.exp-claims.iat>7200)fail();
  return{sub:claims.sub,email:claims.email};
 };
}
module.exports={googleVerifier};
