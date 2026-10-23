'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
if(!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Local Emulator required');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,getDocFromServer,setDoc}=require('firebase/firestore');
let env;
const bid='qa-history-status',space='qa-history-space',other='qa-history-other';
const ref=(db,c,id)=>doc(db,'businesses',bid,c,id);
function readStatus(db,id){
 const body=fs.readFileSync('js/firebase/firestore-repository.js','utf8').match(/async getSaleStatusFromServer\(id\) \{([\s\S]*?)\n    \},/)[1];
 const c={collectionName:'sales',repositoryScopeKey:()=>bid,documentRef:id=>ref(db,'sales',id),getDocFromServer,timed:(_kind,_name,fn)=>fn(),convert:s=>s.exists()?{id:s.id,...s.data()}:null};
 vm.createContext(c);return vm.runInContext(`(async function(id){${body}\n})`,c)(id);
}
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'businesses',bid),{ownerId:'qa-history-owner',active:true,legacyAccessDisabled:true,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}});
  for(const role of ['owner','seller']){
   const uid='qa-history-'+role,permissions=role==='owner'?{}:{'sales.create':true,'sales.cancel':true};
   await setDoc(doc(db,'users',uid),{uid,businessId:bid,role,active:true});
   await setDoc(ref(db,'members',uid),{uid,role,status:'active',spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[space],permissions});
  }
  for(const id of [space,other])await setDoc(doc(db,'financialSpaces',id),{id,businessId:bid,linkedBusinessId:bid,ownerUid:'qa-history-owner',type:'business',active:true,capabilities:{sales:true,inventory:true,products:true,finance:false}});
  for(const [id,method,sid] of [['credit','fiado',space],['cash','dinheiro',space],['outside','fiado',other]]){
   await setDoc(ref(db,'sales',id),{id,businessId:bid,spaceId:sid,actorUid:'qa-history-owner',formaPagamento:method,status:method==='fiado'?'fiado':'applied',applicationStatus:'applied',active:false,deletedAt:'2026-10-23T08:21:33Z',cancelledAt:'2026-10-23T08:21:33Z'});
  }
  for(const name of ['payments','balanceEvents','saleFinancials'])await setDoc(ref(db,name,'private'),{id:'private',businessId:bid,spaceId:space,saleId:'credit',custoTotal:20,lucro:60});
 });
});
test.after(async()=>env?.cleanup());
for(const role of ['owner','seller'])test(`${role}: existing Rules allow reading canonical cancelled cash/Fiado without financial permissions`,async()=>{
 const db=env.authenticatedContext('qa-history-'+role).firestore();
 for(const id of ['credit','cash']){const status=await assertSucceeds(readStatus(db,id));assert.equal(status.active,false);assert.equal('custoTotal' in status,false);}
});
test('seller cannot read other space or private financial sources; no Rules expansion',async()=>{
 const db=env.authenticatedContext('qa-history-seller').firestore();await assertFails(readStatus(db,'outside'));
 for(const name of ['payments','balanceEvents','saleFinancials'])await assertFails(getDoc(ref(db,name,'private')));
});
