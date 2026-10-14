'use strict';
// Production audit: read-only metadata; never logs or stores credentials/content.
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const project='adi-festa-controle';
function decode(v){if('nullValue'in v)return null;if('stringValue'in v)return v.stringValue;if('booleanValue'in v)return v.booleanValue;if('integerValue'in v)return Number(v.integerValue);if('timestampValue'in v)return v.timestampValue;if('mapValue'in v)return Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)]));if('arrayValue'in v)return(v.arrayValue.values||[]).map(decode);return null;}
async function main(){
 const globalRoot=execFileSync(process.env.ComSpec,['/d','/s','/c','npm root -g'],{encoding:'utf8'}).trim(),auth=createRequire(path.join(globalRoot,'firebase-tools/package.json'))('./lib/auth'),account=auth.getGlobalDefaultAccount();
 if(!account?.tokens?.refresh_token)throw Error('firebase-cli-session-required');
 const bearer=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token;
 const base=`https://firestore.googleapis.com/v1/projects/${project}/databases/(default)/documents`;
 async function query(collection,filter,fields){const r=await fetch(base+':runQuery',{method:'POST',headers:{Authorization:`Bearer ${bearer}`,'Content-Type':'application/json'},body:JSON.stringify({structuredQuery:{from:[{collectionId:collection}],where:{fieldFilter:filter},...(fields?{select:{fields:fields.map(fieldPath=>({fieldPath}))}}:{})}})});if(!r.ok)throw Error(`read-only-query:${r.status}`);return(await r.json()).filter(x=>x.document).map(x=>({id:x.document.name.split('/').at(-1),...Object.fromEntries(Object.entries(x.document.fields||{}).map(([k,v])=>[k,decode(v)])),_hash:crypto.createHash('sha256').update(JSON.stringify(x.document.fields)).digest('hex')}));}
 const qa=await query('financialSpaces',{field:{fieldPath:'name'},op:'IN',value:{arrayValue:{values:['VECONI QA','QA V168','VECONI QA — isolamento'].map(stringValue=>({stringValue}))}}},['name','businessId','linkedBusinessId','active','type','ownerUid','capabilities']);
 const bid=process.argv[2]||'';if(bid&&!/^[\w-]+$/.test(bid))throw Error('invalid-business');
 const catalogs=bid?await query('publicCatalogs',{field:{fieldPath:'businessId'},op:'EQUAL',value:{stringValue:bid}}):[];
 console.log(JSON.stringify({mode:'read-only',project,qaSpaces:qa.map(({_hash,...q})=>q),legacyCatalogs:catalogs.map(c=>({idHash:crypto.createHash('sha256').update(c.id).digest('hex').slice(0,12),contentHash:c._hash,schemaVersion:c.schemaVersion,spaceId:c.spaceId||null,active:c.active,acceptingOrders:c.acceptingOrders})),writes:0},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
