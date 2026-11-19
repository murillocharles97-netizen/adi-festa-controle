'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
if(!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Loopback Emulator required');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,deleteDoc,getDoc,getDocs,collection}=require('firebase/firestore');
let env;
test.before(async()=>{assert.ok(process.env.VECONI_TEST_RULES,'Use the selective overlay of the verified active Rules');env=await initializeTestEnvironment({projectId:'demo-veconi-regularization-rules',firestore:{rules:fs.readFileSync(process.env.VECONI_TEST_RULES,'utf8')}});});
test.after(async()=>env?.cleanup());
test('active Rules overlay protects administrative ledger, marker and resulting balance; preserves ordinary directory edits and tenant isolation',async()=>{
 const bid='qa-company',uid='qa-owner',seller='qa-seller',other='other-owner';
 const base=`businesses/${bid}/`,marker={spaceRegularization:{version:1,operationId:'qa-confirmed'}};
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();
  await setDoc(doc(db,'businesses/'+bid),{active:true,ownerId:uid,workspaceGeneration:0,legacyAccessDisabled:true,operationalReadPolicyVersion:1,subscription:{planId:'internal',status:'active'}});
  for(const [id,role]of [[uid,'owner'],[seller,'seller']]){
   await setDoc(doc(db,'users/'+id),{active:true,businessId:bid,role});await setDoc(doc(db,base+'members/'+id),{uid:id,status:'active',role,spaceAccess:'all',permissionsVersion:1,permissions:{'customers.view':true,'customers.edit':true,'customers.adjustBalance':true,'customers.receiveDebt':true}});
  }
  await setDoc(doc(db,base+'clients/regularized'),{id:'regularized',businessId:bid,active:true,ativo:true,saldo:-150,financialVersion:1,fiadoHistoryVersion:1,fiadoHistoryActivation:marker});
  await setDoc(doc(db,base+'clients/ordinary'),{id:'ordinary',businessId:bid,active:true,ativo:true,saldo:0,financialVersion:0});
  for(const col of ['balanceAdjustments','balanceEvents'])await setDoc(doc(db,base+col+'/confirmed'),{id:'confirmed',businessId:bid,spaceId:'qa-taxi',status:'applied',spaceRegularizationVersion:1,clienteId:'regularized'});
 });
 const owner=env.authenticatedContext(uid).firestore(),employee=env.authenticatedContext(seller).firestore(),foreign=env.authenticatedContext(other).firestore();
 for(const db of [owner,employee]){
  await assertFails(updateDoc(doc(db,base+'clients/regularized'),{saldo:-1,financialVersion:2}));
  await assertFails(updateDoc(doc(db,base+'clients/regularized'),{fiadoHistoryActivation:{}}));
  for(const col of ['balanceAdjustments','balanceEvents']){
   await assertFails(setDoc(doc(db,base+col+'/forged'),{businessId:bid,clienteId:'regularized',spaceRegularizationVersion:1}));
   await assertFails(updateDoc(doc(db,base+col+'/confirmed'),{status:'cancelled'}));
   await assertFails(updateDoc(doc(db,base+col+'/confirmed'),{spaceRegularizationVersion:0}));
   await assertFails(deleteDoc(doc(db,base+col+'/confirmed')));
  }
 }
 await assertSucceeds(updateDoc(doc(owner,base+'clients/regularized'),{nome:'Nome atualizado QA'}));
 await assertSucceeds(updateDoc(doc(owner,base+'clients/ordinary'),{nome:'Cadastro mantido QA'}));
 await assertFails(getDoc(doc(foreign,base+'clients/regularized')));
 await assertFails(getDocs(collection(foreign,base+'balanceAdjustments')));
 await assertSucceeds(getDoc(doc(owner,base+'balanceAdjustments/confirmed')));
});
