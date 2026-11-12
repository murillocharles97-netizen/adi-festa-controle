'use strict';
// Cutoff guards on top of the ACTIVE production Rules (selective.rules).
// Based on cutoff-release/rules-test.cjs (Codex); v2 sale-update contract below.
// Run: firebase emulators:exec --only firestore "node --test releases/fiado-cutoff/rules-test.cjs"
const fs=require('fs'),assert=require('node:assert/strict'),{test}=require('node:test');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const s=require('firebase/firestore');
assert.ok(process.env.FIRESTORE_EMULATOR_HOST,'Firestore Emulator required');
const bid='qa-cutoff',space='qa-cut-space',uid='qa-owner',root='businesses/'+bid;
let env;
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'demo-cutoff-selective-rules',firestore:{rules:fs.readFileSync(__dirname+'/selective.rules','utf8')}});
 await env.withSecurityRulesDisabled(async c=>{
  const db=c.firestore(),batch=s.writeBatch(db),put=(p,d)=>batch.set(s.doc(db,p),d);
  put(root,{ownerId:uid,active:true,workspaceGeneration:0,subscription:{planId:'internal',status:'active'}});
  for(const user of [uid,'qa-staff']){put('users/'+user,{uid:user,businessId:bid,role:user===uid?'owner':'cashier',active:true});put(root+'/members/'+user,{uid:user,status:'active',role:user===uid?'owner':'cashier',permissionsVersion:1,spaceAccess:'all',permissions:{'customers.view':true,'customers.edit':true,'customers.receiveDebt':true,'products.view':true}});}
  put('financialSpaces/'+space,{businessId:bid,linkedBusinessId:bid,type:'business',active:true,ownerUid:uid,capabilities:{sales:true,finance:true}});
  for(const id of ['cut','uncut'])put(root+'/clients/'+id,{id,businessId:bid,workspaceGeneration:0,nome:'QA',saldo:-150,financialVersion:4,...(id==='cut'?{fiadoOpeningBalance:{version:1,hash:'qa'},fiadoHistoryVersion:1}:{})});
  put(root+'/fiadoOpeningBalances/cut',{businessId:bid,hash:'qa'});
  for(const col of ['payments','balanceEvents','balanceAdjustments'])put(root+'/'+col+'/old',{id:'old',businessId:bid,workspaceGeneration:0,clienteId:'cut',clientId:'cut',customerId:'cut',spaceId:space,valor:1});
  const sale={businessId:bid,workspaceGeneration:0,clienteId:'cut',spaceId:space,formaPagamento:'fiado',status:'fiado',active:true,actorUid:uid,valorFinal:150};
  put(root+'/sales/old',{id:'old',...sale});
  put(root+'/sales/stamped',{id:'stamped',...sale,fiadoOpeningHash:'qa'});
  await batch.commit();
 });
});
test.after(()=>env?.cleanup());
test('owner cannot change cut balance or forge/remove markers; metadata remains editable',async()=>{
 const db=env.authenticatedContext(uid).firestore(),client=s.doc(db,root+'/clients/cut');
 await assertFails(s.updateDoc(client,{saldo:-80,financialVersion:5}));
 await assertFails(s.updateDoc(client,{fiadoOpeningBalance:s.deleteField()}));
 await assertFails(s.updateDoc(client,{fiadoHistoryVersion:s.deleteField()}));
 await assertFails(s.updateDoc(s.doc(db,root+'/clients/uncut'),{fiadoOpeningBalance:{hash:'forged'}}));
 await assertFails(s.setDoc(s.doc(db,root+'/clients/forged'),{businessId:bid,nome:'QA',fiadoHistoryVersion:1}));
 await assertSucceeds(s.updateDoc(client,{nome:'QA edited'}));
 await assertFails(s.getDoc(s.doc(db,root+'/fiadoOpeningBalances/cut')));
 await assertFails(s.setDoc(s.doc(db,root+'/fiadoOpeningBalances/uncut'),{hash:'forged'}));
});
test('legacy SDK cannot post or reassign financial sources across the cutoff',async()=>{
 const db=env.authenticatedContext(uid).firestore();
 for(const col of ['payments','balanceEvents','balanceAdjustments']){
  await assertFails(s.updateDoc(s.doc(db,root+'/'+col+'/old'),{clienteId:'uncut',clientId:'uncut',customerId:'uncut',valor:99}));
  for(const field of ['clienteId','clientId','customerId'])await assertFails(s.setDoc(s.doc(db,root+'/'+col+'/new-'+field),{businessId:bid,[field]:'cut',valor:70}));
  await assertFails(s.setDoc(s.doc(db,root+'/'+col+'/forged-hash'),{businessId:bid,clientId:'uncut',fiadoOpeningHash:'qa'}));
 }
 await assertFails(s.setDoc(s.doc(db,root+'/paymentAllocations/forged'),{businessId:bid,id:'forged',clientId:'cut',saleId:'old',paymentId:'p',engineVersion:2,amount:70}));
});
test('sales: no browser Fiado on a cut account, and the server stamp cannot be forged, edited or removed',async()=>{
 const db=env.authenticatedContext(uid).firestore();
 const fresh={businessId:bid,workspaceGeneration:0,spaceId:space,active:true,actorUid:uid,valorFinal:20};
 await assertFails(s.setDoc(s.doc(db,root+'/sales/new-fiado-cut'),{id:'new-fiado-cut',...fresh,clienteId:'cut',formaPagamento:'fiado',status:'fiado'}));
 await assertFails(s.setDoc(s.doc(db,root+'/sales/new-forged'),{id:'new-forged',...fresh,clienteId:'uncut',formaPagamento:'pix',status:'pago',fiadoOpeningHash:'qa'}));
 await assertFails(s.updateDoc(s.doc(db,root+'/sales/old'),{fiadoOpeningHash:'qa'}));
 await assertFails(s.updateDoc(s.doc(db,root+'/sales/stamped'),{active:false,status:'cancelado'}));
 await assertFails(s.updateDoc(s.doc(db,root+'/sales/stamped'),{fiadoOpeningHash:s.deleteField()}));
 await assertFails(s.updateDoc(s.doc(db,root+'/sales/stamped'),{observacao:'x'}));
});
test('uncut account legacy balance grants and staff all-spaces metadata remain available',async()=>{
 const db=env.authenticatedContext(uid).firestore();
 await assertSucceeds(s.updateDoc(s.doc(db,root+'/clients/uncut'),{saldo:-120,financialVersion:5}));
 const staff=env.authenticatedContext('qa-staff').firestore();
 await assertSucceeds(s.getDocs(s.query(s.collection(staff,'financialSpaces'),s.where('linkedBusinessId','==',bid),s.where('active','==',true),s.where('type','==','business'))));
 await assertFails(s.getDoc(s.doc(env.authenticatedContext('qa-outsider').firestore(),root+'/clients/cut')));
});
test('the exact production rules are recovered by removing only the cutoff guards',()=>{
 let candidate=fs.readFileSync(__dirname+'/selective.rules','utf8');
 for(const [a,b]of JSON.parse(fs.readFileSync(__dirname+'/rules-edits.json')).reverse())candidate=candidate.replace(b,a);
 assert.equal(candidate,fs.readFileSync(__dirname+'/production-active.rules','utf8').replace(/\r\n/g,'\n'));
});
