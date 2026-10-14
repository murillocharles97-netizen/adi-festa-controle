'use strict';
// Exact-path policy shared by the dry-run, cleanup and emulator tests.
const rebuildable=new Set(['phoneIndex','portalProfiles','portalSessions','campaignProgress']);
function classify({businessId,catalog,storeReference,binding,subcollections=[]}){
 if(!businessId||catalog.businessId!==businessId)return 'PRESERVE_OTHER_BUSINESS';
 if(catalog.schemaVersion>=6||catalog.catalogType==='space_store'||catalog.spaceId||storeReference||binding)return 'PRESERVE_V2';
 if(![4,5].includes(catalog.schemaVersion)||!(!catalog.catalogType||['universal','legacy_visit'].includes(catalog.catalogType)||catalog.legacyRedirect===true||catalog.legacyStoreRetired===true&&catalog.catalogType==='retired_legacy_store'))return 'PRESERVE_UNCLASSIFIED';
 if(subcollections.some(s=>!rebuildable.has(s.collection)&&!['orders','redemptionRequests'].includes(s.collection)))return 'PRESERVE_UNKNOWN_DEPENDENCY';
 if(catalog.legacyStoreRetired===true)return 'ALREADY_RETIRED';
 return subcollections.some(s=>['orders','redemptionRequests'].includes(s.collection)&&s.count>0)?'RETIRE_WITH_PROTECTED_RECORDS':'DELETE_EXCLUSIVE_LEGACY';
}
function retiredParent(data){return {businessId:data.businessId,visitId:data.visitId||null,schemaVersion:data.schemaVersion,catalogType:'retired_legacy_store',legacyStoreRetired:true,active:false,catalogVisible:false,acceptingOrders:false};}
function removableProjection(collection){return rebuildable.has(collection);}
function validateWrite(path,businessId,{catalogIds=new Set(),projectionPaths=new Set(),visitIds=new Set()}={}){
 if(projectionPaths.has(path))return true;
 const parts=path.split('/');
 if(parts.length===2&&parts[0]==='publicCatalogs'&&catalogIds.has(parts[1]))return true;
 if(path===`businesses/${businessId}/settings/default`)return true;
 return parts.length===4&&parts[0]==='businesses'&&parts[1]===businessId&&parts[2]==='visits'&&visitIds.has(parts[3]);
}
module.exports={classify,retiredParent,removableProjection,validateWrite};
