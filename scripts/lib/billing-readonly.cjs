'use strict';
const {createRequire}=require('node:module'),path=require('node:path'),{execFileSync}=require('node:child_process');
// Uses the same Firebase CLI auth as audit-billing-health. Tokens never leave memory.
let cachedToken;
async function token(){
 if(cachedToken)return cachedToken;
 const root=(process.platform==='win32'?execFileSync(process.env.ComSpec||'cmd.exe',['/d','/s','/c','npm root -g'],{encoding:'utf8'}):execFileSync('npm',['root','-g'],{encoding:'utf8'})).trim();
 const auth=createRequire(path.join(root,'firebase-tools/package.json'))('./lib/auth'),account=auth.getGlobalDefaultAccount();
 if(!account?.tokens?.refresh_token)throw Object.assign(Error('Firebase CLI login required'),{code:'firebase-login-required'});
 cachedToken=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;return cachedToken;
}
async function get(url,bearer){
 const response=await fetch(url,{method:'GET',headers:{Authorization:`Bearer ${bearer}`},signal:AbortSignal.timeout(25000)});
 if(response.status===404)return null;
 if(!response.ok)throw Object.assign(Error(`Read failed: HTTP ${response.status}`),{code:'read-http-'+response.status,status:response.status});
 return response.json();
}
function decode(field){if(!field)return null;for(const type of ['stringValue','timestampValue','booleanValue','nullValue'])if(type in field)return field[type];if('integerValue'in field)return Number(field.integerValue);if('doubleValue'in field)return field.doubleValue;if('arrayValue'in field)return(field.arrayValue.values||[]).map(decode);if('mapValue'in field)return Object.fromEntries(Object.entries(field.mapValue.fields||{}).map(([k,v])=>[k,decode(v)]));return null;}
const decodeDoc=doc=>doc?{...Object.fromEntries(Object.entries(doc.fields||{}).map(([k,v])=>[k,decode(v)])),id:doc.name.split('/').at(-1)}:null;
function firestore(project){
 const base=`https://firestore.googleapis.com/v1/projects/${encodeURIComponent(project)}/databases/(default)/documents/`;
 return{
  async document(collection,id){return decodeDoc(await get(base+encodeURIComponent(collection)+'/'+encodeURIComponent(id),await token()));},
  async list(collection){const rows=[];let cursor='';do{const query=new URLSearchParams({pageSize:'100'});if(cursor)query.set('pageToken',cursor);const page=await get(base+encodeURIComponent(collection)+'?'+query,await token());rows.push(...(page?.documents||[]).map(decodeDoc));cursor=page?.nextPageToken||'';}while(cursor);return rows;}
 };
}
async function secret(project,name){
 if(!['MERCADO_PAGO_ACCESS_TOKEN','MERCADO_PAGO_ACCESS_TOKEN_TEST','MERCADO_PAGO_WEBHOOK_SECRET'].includes(name))throw Error('Secret not allowed in billing audit');
 const data=await get(`https://secretmanager.googleapis.com/v1/projects/${encodeURIComponent(project)}/secrets/${name}/versions/latest:access`,await token());
 return data?.payload?.data?Buffer.from(data.payload.data,'base64').toString('utf8').trim():null;
}
const providerGet=(route,bearer)=>{if(!/^\/(preapproval(?:\/search|\/[\w-]+)?|users\/me)$/.test(route.split('?')[0]))throw Error('Read endpoint not allowed');return get('https://api.mercadopago.com'+route,bearer);};
module.exports={firestore,secret,providerGet};
