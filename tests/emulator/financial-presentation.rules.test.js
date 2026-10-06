const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,writeBatch}=require('firebase/firestore');
let env;const bid='presentation-business',space='presentation-space',owner='presentation-owner';
const presentation={displayName:'Inter Principal',color:'#c64e00',gradientVariant:'gradient',cardNickname:'Inter Pessoal'};
const patch=(extra={})=>({presentation,presentationUpdatedAt:'2026-10-05T12:00:00Z',workspaceGeneration:3,workspaceWriteId:require('node:crypto').randomUUID(),...extra});
const ref=(db,kind='financialAccounts')=>doc(db,'financialSpaces',space,kind,'resource');
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore();
  await setDoc(doc(db,'businesses',bid),{ownerId:owner,active:true,workspaceGeneration:3,subscription:{planId:'internal',status:'active'}});
  await setDoc(doc(db,'financialSpaces',space),{id:space,type:'business',linkedBusinessId:bid,ownerUid:owner,active:true});
  for(const [uid,role,financial,access] of [[owner,'owner',true,'all'],['presentation-manager','manager',true,'all'],['presentation-no-finance','manager',false,'all'],['presentation-seller','seller',true,'all'],['presentation-other-space','manager',true,'selected'],['presentation-other-business','owner',true,'all']]){
   const businessId=uid==='presentation-other-business'?'other-presentation-business':bid;
   await setDoc(doc(db,'users',uid),{uid,role:role==='seller'?'cashier':role,businessId,active:true});
   await setDoc(doc(db,'businesses',businessId,'members',uid),{uid,role,status:'active',spaceAccess:access,allowedSpaceIds:[],permissions:{'financial.view':financial}});
  }
  const common={id:'resource',financialSpaceId:space,ownerUid:owner,createdBy:owner,operationId:'original-operation',name:'Technical name',active:true,workspaceGeneration:3,workspaceWriteId:'original-nonce-000001'};
  await setDoc(ref(db),{...common,type:'bank_account',initialBalanceCents:862,currentBalanceCents:862});
  await setDoc(ref(db,'creditCards'),{...common,last4:'4521',limitCents:500000,committedCents:360000,closingDay:25,dueDay:5});
 });
});
test.after(()=>env?.cleanup());
test('owner saves cloud appearance, second device reads it; financial values and identity unchanged',async()=>{
 const a=env.authenticatedContext(owner).firestore(),b=env.authenticatedContext(owner).firestore();
 const before=(await getDoc(ref(a))).data();await assertSucceeds(updateDoc(ref(a),patch()));
 const after=(await assertSucceeds(getDoc(ref(b)))).data();assert.deepEqual(after.presentation,presentation);
 for(const key of Object.keys(before).filter(k=>!['workspaceWriteId'].includes(k)))assert.deepEqual(after[key],before[key]);
});
test('authorized manager can save; seller with financial.view, unauthorized manager and other company cannot',async()=>{
 await assertSucceeds(updateDoc(ref(env.authenticatedContext('presentation-manager').firestore(),'creditCards'),patch({presentation:{...presentation,displayName:'C6 Black',color:'#242424'}})));
 for(const uid of ['presentation-no-finance','presentation-seller','presentation-other-space','presentation-other-business']){
  for(const kind of ['financialAccounts','creditCards'])await assertFails(updateDoc(ref(env.authenticatedContext(uid).firestore(),kind),patch({presentation:{...presentation,displayName:'Unauthorized '+uid}})));
 }
 await assertFails(getDoc(ref(env.authenticatedContext('presentation-other-business').firestore())));
});
test('metadata save cannot smuggle balance, limit, scope, identity or arbitrary fields',async()=>{
 const db=env.authenticatedContext(owner).firestore();
 for(const extra of [{currentBalanceCents:0},{name:'Renamed real bank'},{financialSpaceId:'another'},{ownerUid:'other'}])await assertFails(updateDoc(ref(db),patch({...extra,presentation:{...presentation,displayName:'Changed with financial fields'}})));
 await assertFails(updateDoc(ref(db,'creditCards'),patch({limitCents:1})));
 for(const bad of [{...presentation,color:'red;position:fixed'},{...presentation,displayName:'a'.repeat(81)},{...presentation,financialBalance:999},{...presentation,gradientVariant:'arbitrary'}])await assertFails(updateDoc(ref(db),patch({presentation:bad})));
});
test('reset appearance preserves data, batch failure is atomic and generation/reset guards remain enforced',async()=>{
 const db=env.authenticatedContext(owner).firestore();await assertSucceeds(updateDoc(ref(db),patch({presentation:{}})));
 assert.equal((await getDoc(ref(db))).data().currentBalanceCents,862);
 const batch=writeBatch(db);batch.update(ref(db),patch());batch.update(ref(db,'creditCards'),patch({limitCents:0}));await assertFails(batch.commit());
 assert.deepEqual((await getDoc(ref(db))).data().presentation,{});
 await assertFails(updateDoc(ref(db),patch({workspaceGeneration:2})));
 await env.withSecurityRulesDisabled(c=>updateDoc(doc(c.firestore(),'businesses',bid),{workspaceReset:{status:'DELETING'}}));
 await assertFails(updateDoc(ref(db),patch()));
});
