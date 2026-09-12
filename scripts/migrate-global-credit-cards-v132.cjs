'use strict';

const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');

const PROJECT_ID='adi-festa-controle';
const OWNER_UID='z3ao8ODMHzbGLIBHgcJbvZtXeDp2';
const MIGRATION_ID='global_credit_cards_v132_2026_09';
const API=`https://firestore.googleapis.com/v1/projects/${PROJECT_ID}/databases/(default)`;
const execute=process.argv.includes('--execute');

async function credential(){
  const candidates=[path.join(os.homedir(),'.config','configstore','firebase-tools.json'),path.join(process.env.APPDATA||'','configstore','firebase-tools.json')];
  for(const candidate of candidates){
    if(!candidate||!fs.existsSync(candidate))continue;
    const config=JSON.parse(fs.readFileSync(candidate,'utf8')),tokens=config.tokens||config.user?.tokens||{},refreshToken=tokens.refresh_token;
    if(refreshToken){
      const body=new URLSearchParams({refresh_token:refreshToken,client_id:'563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com',client_secret:'j9iVZfS8kkCEFUPaAeJV0sAi',grant_type:'refresh_token'}),response=await fetch('https://www.googleapis.com/oauth2/v3/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body});
      if(response.ok){const refreshed=await response.json();if(refreshed.access_token)return refreshed.access_token}
    }
    if(tokens.access_token)return tokens.access_token;
  }
  throw new Error('Credencial do Firebase CLI não encontrada.');
}

const tokenPromise=credential();
async function request(url,options={}){
  const token=await tokenPromise;
  const response=await fetch(url,{...options,headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json',...(options.headers||{})}});
  if(!response.ok){const body=await response.text();throw new Error(`Firestore REST ${response.status}: ${body.slice(0,500)}`)}
  return response.status===204?null:response.json();
}

function decode(value={}){
  if('stringValue'in value)return value.stringValue;
  if('integerValue'in value)return Number(value.integerValue);
  if('doubleValue'in value)return Number(value.doubleValue);
  if('booleanValue'in value)return value.booleanValue;
  if('timestampValue'in value)return value.timestampValue;
  if('nullValue'in value)return null;
  if('arrayValue'in value)return(value.arrayValue.values||[]).map(decode);
  if('mapValue'in value)return decodeFields(value.mapValue.fields||{});
  return null;
}
const decodeFields=(input={})=>Object.fromEntries(Object.entries(input).map(([key,value])=>[key,decode(value)]));
function encode(value){
  if(value===null||value===undefined)return{nullValue:null};
  if(Array.isArray(value))return{arrayValue:{values:value.map(encode)}};
  if(typeof value==='boolean')return{booleanValue:value};
  if(Number.isInteger(value))return{integerValue:String(value)};
  if(typeof value==='number')return{doubleValue:value};
  if(typeof value==='object')return{mapValue:{fields:Object.fromEntries(Object.entries(value).map(([key,item])=>[key,encode(item)]))}};
  return{stringValue:String(value)};
}
async function listDocuments(relativePath){
  const output=[];let pageToken='';
  do{
    const suffix=`${relativePath.includes('?')?'&':'?'}pageSize=500${pageToken?`&pageToken=${encodeURIComponent(pageToken)}`:''}`,response=await request(`${API}/documents/${relativePath}${suffix}`);
    output.push(...(response.documents||[]));pageToken=response.nextPageToken||'';
  }while(pageToken);
  return output;
}
async function optionalDocument(relativePath){
  try{return await request(`${API}/documents/${relativePath}`)}catch(error){if(/Firestore REST 404:/.test(error.message))return null;throw error}
}
const idOf=document=>document.name.split('/').at(-1);
const institutionKey=value=>{
  const raw=String(value||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/\b(s\.?a\.?|banco|bank)\b/g,' ').replace(/[^a-z0-9]+/g,' ').trim();
  if(raw==='inter')return'banco_inter';
  if(raw==='c6')return'c6_bank';
  return raw.replace(/\s+/g,'_')||'sem_instituicao';
};
function patchWrite(document,patch){
  return{update:{name:document.name,fields:Object.fromEntries(Object.entries(patch).map(([key,value])=>[key,encode(value)]))},updateMask:{fieldPaths:Object.keys(patch)},currentDocument:{updateTime:document.updateTime}};
}

async function main(){
  const spaces=(await listDocuments('financialSpaces')).map(document=>({document,id:idOf(document),value:decodeFields(document.fields||{})})).filter(item=>item.value.ownerUid===OWNER_UID),cache=new Map();
  const listCached=async relativePath=>{if(!cache.has(relativePath))cache.set(relativePath,await listDocuments(relativePath));return cache.get(relativePath)};
  const cards=[];
  for(const space of spaces){
    for(const document of await listCached(`financialSpaces/${space.id}/creditCards`)){
      const value=decodeFields(document.fields||{});
      if(value.ownerUid===OWNER_UID)cards.push({document,value,id:idOf(document),homeSpaceId:space.id});
    }
  }
  const inventories=[];
  for(const card of cards){
    const invoices=(await listCached(`financialSpaces/${card.homeSpaceId}/creditCardInvoices`)).filter(document=>decodeFields(document.fields||{}).creditCardId===card.id),purchases=[];
    for(const space of spaces){
      for(const document of await listCached(`financialSpaces/${space.id}/creditCardPurchases`)){
        const value=decodeFields(document.fields||{});
        if(value.creditCardId===card.id&&String(value.cardHomeSpaceId||card.homeSpaceId)===card.homeSpaceId)purchases.push(document);
      }
    }
    inventories.push({
      cardId:card.id,institution:card.value.institution||card.value.issuer||null,name:card.value.name||null,last4:card.value.last4||null,
      owner:card.value.ownerUid,financialSpaceIdLegado:card.value.financialSpaceId||null,cardHomeSpaceId:card.homeSpaceId,
      accessMode:card.value.accessMode||'legacy_single_space',allowedFinancialSpaceIds:Array.isArray(card.value.allowedFinancialSpaceIds)?card.value.allowedFinancialSpaceIds:[],
      invoices:invoices.length,transactions:purchases.length,limitCents:Number(card.value.limitCents||0),status:card.value.active===false?'archived':'active',
    });
  }
  const changedAt=new Date().toISOString(),patches=cards.map(card=>{
    const validMode=['all_spaces','selected_spaces','single_space'].includes(card.value.accessMode),accessMode=validMode?card.value.accessMode:'single_space',defaultFinancialSpaceId=String(card.value.defaultFinancialSpaceId||card.homeSpaceId),allowedFinancialSpaceIds=accessMode==='all_spaces'?[]:accessMode==='selected_spaces'&&Array.isArray(card.value.allowedFinancialSpaceIds)&&card.value.allowedFinancialSpaceIds.length?card.value.allowedFinancialSpaceIds:[defaultFinancialSpaceId],patch={
      cardHomeSpaceId:card.homeSpaceId,accessMode,allowedFinancialSpaceIds,defaultFinancialSpaceId,
      institutionKey:institutionKey(card.value.institution||card.value.issuer||card.value.name),schemaVersion:Math.max(4,Number(card.value.schemaVersion||0)),
    },changed=Object.entries(patch).some(([key,value])=>JSON.stringify(card.value[key])!==JSON.stringify(value));
    return changed?{card,patch:{...patch,updatedAt:changedAt}}:null;
  }).filter(Boolean),existingAudit=await optionalDocument(`financialMigrations/${MIGRATION_ID}`),writes=patches.map(item=>patchWrite(item.card.document,item.patch));
  if(!existingAudit)writes.push({update:{name:`projects/${PROJECT_ID}/databases/(default)/documents/financialMigrations/${MIGRATION_ID}`,fields:Object.fromEntries(Object.entries({migrationVersion:'v132',status:'applied',ownerUid:OWNER_UID,cardsAudited:cards.length,cardsNormalized:patches.length,invoicesPreserved:inventories.reduce((sum,item)=>sum+item.invoices,0),transactionsPreserved:inventories.reduce((sum,item)=>sum+item.transactions,0),migrationAt:changedAt,noFinancialResultCreated:true}).map(([key,value])=>[key,encode(value)]))},currentDocument:{exists:false}});
  const report={mode:execute?'execute':'dry-run',projectId:PROJECT_ID,ownerUid:OWNER_UID,migrationId:MIGRATION_ID,spacesAudited:spaces.length,cards:inventories,cardsNormalized:patches.map(item=>item.card.id),writes:writes.length};
  if(!execute){console.log(JSON.stringify(report,null,2));return}
  if(writes.length)await request(`${API}/documents:commit`,{method:'POST',body:JSON.stringify({writes})});
  const verified=[];
  for(const card of cards){
    const document=await request(`${API}/documents/financialSpaces/${card.homeSpaceId}/creditCards/${card.id}`),value=decodeFields(document.fields||{});
    if(value.cardHomeSpaceId!==card.homeSpaceId||!['all_spaces','selected_spaces','single_space'].includes(value.accessMode)||Number(value.schemaVersion)<4)throw new Error(`Verificação posterior falhou para ${card.id}.`);
    verified.push({cardId:card.id,accessMode:value.accessMode,cardHomeSpaceId:value.cardHomeSpaceId,schemaVersion:value.schemaVersion});
  }
  console.log(JSON.stringify({...report,status:existingAudit&&!patches.length?'already-applied-and-verified':'applied-and-verified',verified},null,2));
}

main().catch(error=>{console.error(error.stack||error);process.exitCode=1});
