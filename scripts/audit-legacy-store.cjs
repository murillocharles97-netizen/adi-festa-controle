'use strict';
// Metadata-only production audit. No credentials, tokens or document contents in output.
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const hash=v=>crypto.createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const decode=v=>'nullValue'in v?null:'stringValue'in v?v.stringValue:'booleanValue'in v?v.booleanValue:'integerValue'in v?Number(v.integerValue):'doubleValue'in v?v.doubleValue:'timestampValue'in v?v.timestampValue:'arrayValue'in v?(v.arrayValue.values||[]).map(decode):'mapValue'in v?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)])):null;
async function main(){
 const bid=process.argv[2];if(bid!=='adi-festa')throw Error('explicit-current-business-required');
 const globalRoot=execFileSync(process.env.ComSpec,['/d','/s','/c','npm root -g'],{encoding:'utf8'}).trim(),auth=createRequire(path.join(globalRoot,'firebase-tools/package.json'))('./lib/auth'),account=auth.getGlobalDefaultAccount();
 const token=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token,base='https://firestore.googleapis.com/v1/projects/adi-festa-controle/databases/(default)/documents';
 async function request(route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(r.status===404)return null;if(!r.ok)throw Error(`metadata-http-${r.status}`);return r.json();}
 const row=d=>({id:d.name.split('/').at(-1),name:d.name,updateTime:d.updateTime,data:Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,decode(v)]))});
 async function query(parent,collection,fields,where){return(await request(parent+':runQuery',{structuredQuery:{from:[{collectionId:collection}],select:{fields:fields.map(fieldPath=>({fieldPath}))},...(where?{where}: {})}})).filter(x=>x.document).map(x=>row(x.document));}
 const eq=(field,value)=>({fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:value}}});
 async function descendants(docPath){const result=[];let pageToken;do{const body=await request(docPath+':listCollectionIds',{pageSize:100,...(pageToken?{pageToken}:{})});for(const collection of body.collectionIds||[]){const docs=await query(docPath,collection,['businessId','spaceId','source','orderStatus','convertedSaleId']);result.push({path:docPath+'/'+collection,collection,docs});}pageToken=body.nextPageToken;}while(pageToken);return result;}
 const stores=await query(`/businesses/${bid}`,'onlineStores',['businessId','spaceId','publicToken','schemaVersion','migration']);
 const catalogs=await query('','publicCatalogs',['businessId','spaceId','schemaVersion','catalogType','legacyRedirect','legacyStoreRetired','universalCatalogToken','visitId'],eq('businessId',bid));
 const slugs=await query('','publicCatalogSlugs',['businessId','spaceId','storeId','catalogToken'],eq('businessId',bid));
 const bindings=await query('','catalogStoreBindings',['businessId','spaceId','storeId','canonicalToken'],eq('businessId',bid));
 const settingsDoc=await request(`/businesses/${bid}/settings/default?mask.fieldPaths=catalogSettings&mask.fieldPaths=config.catalogSettings`);
 const settings=settingsDoc?row(settingsDoc):null;
 const visits=await query(`/businesses/${bid}`,'visits',['businessId','spaceId','kind','universal','publicToken','catalogItems']);
 const decisions=[];
 for(const c of catalogs){const refs=stores.filter(s=>s.data.publicToken===c.id),binding=bindings.find(b=>b.id===c.id),subs=await descendants('/publicCatalogs/'+c.id),unknown=subs.filter(x=>!['orders','phoneIndex','portalProfiles','portalSessions','campaignProgress','redemptionRequests'].includes(x.collection));
  const modern=c.data.schemaVersion>=6||c.data.catalogType==='space_store'||refs.length||binding;
  const provenLegacy=!modern&&!c.data.spaceId&&(c.data.legacyRedirect===true||['universal','legacy_visit'].includes(c.data.catalogType));
  // No recursive deletion: retain every nonempty/unknown subtree for explicit review.
  const dependent=subs.some(x=>x.docs.length)||unknown.length;
  decisions.push({catalogIdHash:hash(c.id).slice(0,12),schema:c.data.schemaVersion,type:c.data.catalogType||null,businessId:c.data.businessId,spaceId:c.data.spaceId||null,storeReferences:refs.length,binding:!!binding,subcollections:subs.map(s=>({collection:s.collection,count:s.docs.length})),decision:modern?'PRESERVE_V2':c.data.legacyStoreRetired?'PRESERVE_ARCHIVED_ORDERS':!provenLegacy?'PRESERVE_UNCLASSIFIED':dependent?'RETIRE_PUBLIC_CONFIGURATION_PRESERVE_DEPENDENCIES':'DELETE_EXCLUSIVE_LEGACY_TREE'});
 }
 console.log(JSON.stringify({mode:'read-only',writes:0,businessId:bid,catalogs:decisions,settingsFields:settings?Object.keys(settings.data):[],legacySettingKeys:Object.keys(settings?.data.catalogSettings||settings?.data.config?.catalogSettings||{}),visits:visits.map(v=>({id:v.id,kind:v.data.kind||null,spaceId:v.data.spaceId||null,hasPublicToken:!!v.data.publicToken,itemCount:v.data.catalogItems?.length||0,decision:'PRESERVE_VISIT_REMOVE_ONLY_CATALOG_FIELDS_AFTER_REVIEW'})),slugs:slugs.map(s=>({slug:s.id,storeId:s.data.storeId,decision:stores.some(x=>x.id===s.data.storeId)?'PRESERVE_V2':'REVIEW_ORPHAN'})),bindings:bindings.map(b=>({idHash:hash(b.id).slice(0,12),storeId:b.data.storeId,decision:stores.some(x=>x.id===b.data.storeId)?'PRESERVE_V2':'REVIEW_ORPHAN'})),inventoryHash:hash(decisions)},null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
