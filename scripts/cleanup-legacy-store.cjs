'use strict';
// Explicit, scoped maintenance command. Default is dry-run. Never recursive-delete
// business data; never output tokens, credentials or deleted document contents.
const {createRequire}=require('node:module'),{execFileSync}=require('node:child_process'),path=require('node:path'),crypto=require('node:crypto');
const P=require('../functions/src/shared/legacy-store-cleanup');
const hash=v=>crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex');
const decode=v=>'nullValue'in v?null:'stringValue'in v?v.stringValue:'booleanValue'in v?v.booleanValue:'integerValue'in v?Number(v.integerValue):'doubleValue'in v?v.doubleValue:'timestampValue'in v?v.timestampValue:'arrayValue'in v?(v.arrayValue.values||[]).map(decode):'mapValue'in v?Object.fromEntries(Object.entries(v.mapValue.fields||{}).map(([k,x])=>[k,decode(x)])):null;
const encode=v=>v===null?{nullValue:null}:typeof v==='boolean'?{booleanValue:v}:typeof v==='number'?{integerValue:String(v)}:{stringValue:v};
async function main(){
 const bid=process.argv[2];if(bid!=='adi-festa')throw Error('Explicit audited business required');
 const apply=process.argv[3]==='--apply',expected=process.argv[4];
 const globalRoot=execFileSync(process.env.ComSpec,['/d','/s','/c','npm root -g'],{encoding:'utf8'}).trim(),auth=createRequire(path.join(globalRoot,'firebase-tools/package.json'))('./lib/auth'),account=auth.getGlobalDefaultAccount();
 const token=(await auth.getAccessToken(account.tokens.refresh_token,[])).access_token,base='https://firestore.googleapis.com/v1/projects/adi-festa-controle/databases/(default)/documents';
 async function request(route,body){const r=await fetch(base+route,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});if(r.status===404)return null;if(!r.ok)throw Error(`Scoped cleanup HTTP ${r.status}`);return r.json();}
 const row=d=>({path:d.name.split('/documents/')[1],name:d.name,id:d.name.split('/').at(-1),updateTime:d.updateTime,data:Object.fromEntries(Object.entries(d.fields||{}).map(([k,v])=>[k,decode(v)]))});
 async function get(p,fields){const q=new URLSearchParams();fields?.forEach(f=>q.append('mask.fieldPaths',f));const d=await request('/'+p+(q.size?'?'+q:''));return d?row(d):null;}
 async function query(parent,collection,fields,where){return(await request(parent+':runQuery',{structuredQuery:{from:[{collectionId:collection}],select:{fields:fields.map(fieldPath=>({fieldPath}))},...(where?{where}: {})}})).filter(x=>x.document).map(x=>row(x.document));}
 const eq=(field,value)=>({fieldFilter:{field:{fieldPath:field},op:'EQUAL',value:{stringValue:value}}});
 async function subcollections(p){let pageToken;const ids=[];do{const b=await request('/'+p+':listCollectionIds',{pageSize:100,...(pageToken?{pageToken}:{})});ids.push(...b.collectionIds||[]);pageToken=b.nextPageToken;}while(pageToken);return ids;}
 const stores=await query(`/businesses/${bid}`,'onlineStores',['businessId','spaceId','publicToken']);
 const bindings=await query('','catalogStoreBindings',['businessId','storeId'],eq('businessId',bid));
 const catalogs=await query('','publicCatalogs',['businessId','spaceId','schemaVersion','catalogType','legacyRedirect','legacyStoreRetired','visitId'],eq('businessId',bid));
 const settings=await get(`businesses/${bid}/settings/default`,['catalogSettings','config.catalogSettings','legacyStoreRetired']);
 const visits=await query(`/businesses/${bid}`,'visits',['businessId','publicToken','catalogItems','catalogSettings']);
 const plan=[],projectionPaths=new Set(),catalogIds=new Set(),visitIds=new Set();
 for(const c of catalogs){const refs=stores.some(s=>s.data.publicToken===c.id),bound=bindings.some(b=>b.id===c.id),initial=P.classify({businessId:bid,catalog:c.data,storeReference:refs,binding:bound});
  if(initial.startsWith('PRESERVE'))continue;
  const subs=[];
  for(const collection of await subcollections(c.path)){const docs=await query('/'+c.path,collection,['businessId']);subs.push({collection,docs,count:docs.length});}
  let decision=P.classify({businessId:bid,catalog:c.data,storeReference:refs,binding:bound,subcollections:subs});
  if(decision.startsWith('PRESERVE'))continue;
  if(decision==='ALREADY_RETIRED')decision=subs.some(s=>!P.removableProjection(s.collection)&&s.count)?'RETIRE_WITH_PROTECTED_RECORDS':'DELETE_EXCLUSIVE_LEGACY';
  if(c.data.legacyStoreRetired&&subs.every(s=>!P.removableProjection(s.collection))&&decision==='RETIRE_WITH_PROTECTED_RECORDS')continue;
  const projections=subs.filter(s=>P.removableProjection(s.collection)).flatMap(s=>s.docs);
  // Exact known leaf projections only. Any nested tree causes the whole catalog
  // to remain untouched, not an inferred recursive delete.
  let nested=false;
  for(let i=0;i<projections.length;i+=8){const checks=await Promise.all(projections.slice(i,i+8).map(p=>subcollections(p.path)));if(checks.some(x=>x.length)){nested=true;break;}}
  if(nested)continue;
  for(const d of projections){if(d.data.businessId&&d.data.businessId!==bid)throw Error('Projection ownership conflict');projectionPaths.add(d.path);}
  catalogIds.add(c.id);plan.push({catalog:c,decision,projections,protectedCounts:subs.filter(s=>!P.removableProjection(s.collection)).map(s=>({collection:s.collection,count:s.count}))});
 }
 const eligibleVisits=visits.filter(v=>!v.data.businessId||v.data.businessId===bid).filter(v=>catalogIds.has(v.data.publicToken));eligibleVisits.forEach(v=>visitIds.add(v.id));
 const fingerprint=hash({catalogs:plan.map(p=>[hash(p.catalog.id),p.catalog.updateTime,p.decision,p.projections.map(d=>[hash(d.path),d.updateTime]),p.protectedCounts]),settings:settings?.updateTime,visits:eligibleVisits.map(v=>[v.id,v.updateTime])});
 const report={mode:apply?'apply':'dry-run',businessId:bid,planHash:fingerprint,catalogs:plan.map(p=>({idHash:hash(p.catalog.id).slice(0,12),decision:p.decision,projectionCount:p.projections.length,preserved:p.protectedCounts})),settingsField:!!settings?.data.catalogSettings,visitCatalogFields:eligibleVisits.length,writes:0};
 if(!apply){console.log(JSON.stringify(report,null,2));return;}
 if(!expected||expected!==fingerprint)throw Error('Inventory changed: repeat dry-run and review before cleanup');
 const protectedCollections=['products','productVariants','clients','sales','payments','balanceAdjustments','stockMovements','catalogOrders','onlineStores','onlineOrderReservations','members','productFinancials','variantFinancials','saleFinancials','stockMovementFinancials'];
 async function protectedFingerprint(){const result={};for(const collection of protectedCollections){const docs=await query(`/businesses/${bid}`,collection,['__name__']);result[collection]={count:docs.length,hash:hash(docs.map(d=>[d.path,d.updateTime]).sort())};}return result;}
 const beforeProtected=await protectedFingerprint(),beforeOrders=plan.flatMap(p=>p.protectedCounts.filter(s=>s.collection==='orders').map(s=>({catalogId:p.catalog.id,count:s.count}))),beforeBusiness=await get(`businesses/${bid}`,['__name__']);
 const allowed={catalogIds,projectionPaths,visitIds};
 async function commit(writes){for(const w of writes){const target=(w.delete||w.update.name).split('/documents/')[1];if(!P.validateWrite(target,bid,allowed))throw Error('Write outside audited store scope');}if(writes.length)await request(':commit',{writes});report.writes+=writes.length;}
 const update=(d,values,mask)=>({update:{name:d.name,fields:Object.fromEntries(Object.entries(values).map(([k,v])=>[k,encode(v)]))},...(mask?{updateMask:{fieldPaths:mask}}:{}),currentDocument:{updateTime:d.updateTime}});
 // Quiesce ALL classified old storefronts first. A stale checkout sees inactive
 // or missing root. Preserve every order/reward subtree, including in-flight ones.
 await commit(plan.map(p=>update(p.catalog,P.retiredParent(p.catalog.data))));
 const deletes=plan.flatMap(p=>p.projections).map(d=>({delete:d.name,currentDocument:{updateTime:d.updateTime}}));
 for(let i=0;i<deletes.length;i+=100)await commit(deletes.slice(i,i+100));
 for(const p of plan){const current=await get(p.catalog.path,['businessId','legacyStoreRetired']);if(!current||current.data.businessId!==bid||!current.data.legacyStoreRetired)throw Error('Retirement changed; stop');
  let keep=false;for(const collection of await subcollections(current.path)){const docs=await query('/'+current.path,collection,['__name__']);if(docs.length)keep=true;}
  if(!keep)await commit([{delete:current.name,currentDocument:{updateTime:current.updateTime}}]);
 }
 if(settings&&(settings.data.catalogSettings||settings.data.config?.catalogSettings||!settings.data.legacyStoreRetired))await commit([update(settings,{legacyStoreRetired:true},['catalogSettings','config.catalogSettings','legacyStoreRetired'])]);
 await commit(eligibleVisits.map(v=>update(v,{},['publicToken','catalogItems','catalogSettings'])));
 const afterProtected=await protectedFingerprint(),afterBusiness=await get(`businesses/${bid}`,['__name__']);
 report.preservedCollections=Object.keys(beforeProtected).filter(k=>hash(beforeProtected[k])===hash(afterProtected[k]));
 report.concurrentChanges=Object.keys(beforeProtected).filter(k=>hash(beforeProtected[k])!==hash(afterProtected[k]));
 report.businessDocumentUnchanged=beforeBusiness.updateTime===afterBusiness.updateTime;
 for(const o of beforeOrders){const rows=await query(`/publicCatalogs/${o.catalogId}`,'orders',['__name__']);if(rows.length<o.count)throw Error('Protected order count changed; stop and review');}
 report.verifiedLegacyOrders=beforeOrders.reduce((n,o)=>n+o.count,0);
 report.completed=true;report.ordersDeleted=0;report.canonicalWrites=0;
 console.log(JSON.stringify(report,null,2));
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
