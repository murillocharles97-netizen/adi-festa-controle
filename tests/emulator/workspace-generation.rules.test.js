'use strict';
const test=require('node:test'),fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const sdk=require('firebase/firestore'),{doc,setDoc,updateDoc,getDoc}=sdk;
const {create:workspaceWriter}=require('../../js/workspace-writer');
let env;const businessId='qa-generation-rules';
test.before(async()=>{
  env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'businesses',businessId),{id:businessId,ownerId:'epoch-owner',active:true,workspaceGeneration:5,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
    await setDoc(doc(db,'users','epoch-owner'),{uid:'epoch-owner',role:'owner',active:true,businessId});
    await setDoc(doc(db,'users','epoch-removed'),{uid:'epoch-removed',role:'admin',active:true,businessId});
    await setDoc(doc(db,'businesses',businessId,'members','epoch-owner'),{uid:'epoch-owner',role:'owner',status:'active',spaceAccess:'all',permissions:{}});
    await setDoc(doc(db,'businesses',businessId,'workspaceResetJobs','job-a'),{businessId,ownerUid:'epoch-owner',status:'COMPLETED'});
  });
});
test.after(()=>env?.cleanup());
const value=id=>({id,businessId,active:true,revision:1,workspaceGeneration:5,workspaceWriteId:'unique-new-write-0001'});
test('old generation/missing generation cannot resurrect operational data',async()=>{
  const db=env.authenticatedContext('epoch-owner').firestore();
  await assertFails(setDoc(doc(db,'businesses',businessId,'messageTemplates','old-missing'),{id:'old-missing',businessId,active:true,revision:1}));
  await assertFails(setDoc(doc(db,'businesses',businessId,'messageTemplates','old-epoch'),{...value('old-epoch'),workspaceGeneration:4}));
  await assertSucceeds(setDoc(doc(db,'businesses',businessId,'messageTemplates','new-epoch'),value('new-epoch')));
});
test('old merge cannot inherit the new document generation and nonce',async()=>{
  const db=env.authenticatedContext('epoch-owner').firestore(),ref=doc(db,'businesses',businessId,'messageTemplates','merge-test');
  await assertSucceeds(setDoc(ref,value('merge-test')));
  await assertFails(updateDoc(ref,{name:'old cached value',revision:2}));
  await assertSucceeds(updateDoc(ref,{name:'new value',revision:2,workspaceGeneration:5,workspaceWriteId:'unique-new-write-0002'}));
});
test('reset lock blocks even current-generation writes and failed stays locked',async()=>{
  const db=env.authenticatedContext('epoch-owner').firestore();
  for(const status of ['REQUESTED','DELETING','FAILED']){
    await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),'businesses',businessId),{workspaceReset:{status}}));
    await assertFails(setDoc(doc(db,'businesses',businessId,'messageTemplates',`locked-${status}`),value(`locked-${status}`)));
  }
  await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),'businesses',businessId),{workspaceReset:{status:'COMPLETED'}}));
});
test('removed membership cannot regain access through legacy profile',async()=>{
  const db=env.authenticatedContext('epoch-removed').firestore();
  await assertFails(getDoc(doc(db,'businesses',businessId)));
  await assertFails(setDoc(doc(db,'businesses',businessId,'messageTemplates','removed'),value('removed')));
});
test('reset job is owner-readable and never client-writable, generation not owner-editable',async()=>{
  const owner=env.authenticatedContext('epoch-owner').firestore(),other=env.authenticatedContext('other-owner').firestore();
  await assertSucceeds(getDoc(doc(owner,'businesses',businessId,'workspaceResetJobs','job-a')));
  await assertFails(getDoc(doc(other,'businesses',businessId,'workspaceResetJobs','job-a')));
  await assertFails(updateDoc(doc(owner,'businesses',businessId,'workspaceResetJobs','job-a'),{status:'COMPLETED'}));
  await assertFails(updateDoc(doc(owner,'businesses',businessId),{workspaceGeneration:0}));
});

test('special operation-settings, invite and audit routes cannot bypass generation',async()=>{
  const db=env.authenticatedContext('epoch-owner').firestore();
  for(const [collection,id,data] of [
    ['settings','operation',{businessId,name:'old settings'}],
    ['invites','old-invite',{businessId,createdBy:'epoch-owner',status:'pending'}],
    ['auditLogs','old-audit',{businessId}],
  ]){
    const target=doc(db,'businesses',businessId,collection,id);
    await assertFails(setDoc(target,data));
    await assertSucceeds(setDoc(target,{...data,workspaceGeneration:5,workspaceWriteId:'fresh-scoped-operation-0001'}));
  }
});
test('production writer adapter performs current-generation batch/transaction writes under real Rules',async()=>{
  const db=env.authenticatedContext('epoch-owner').firestore();
  const origin=Object.freeze({businessId,workspaceGeneration:5});
  const guard={capture:()=>origin,stamp:data=>({...data,workspaceGeneration:5,workspaceWriteId:require('node:crypto').randomUUID()})};
  const writer=workspaceWriter({sdk,runtime:()=>guard});
  const template=doc(db,'businesses',businessId,'messageTemplates','adapter-template');
  const batch=writer.writeBatch(db);
  batch.set(template,{id:'adapter-template',businessId,active:true,revision:1});
  batch.set(doc(db,'businesses',businessId,'processedOperations','adapter-op'),{id:'adapter-op',idempotencyKey:'adapter-op',businessId,ownerId:'epoch-owner',status:'processed',eventKind:'qa',processedAt:sdk.serverTimestamp(),createdAtLocal:'2026-10-03T00:00:00.000Z',schemaVersion:3});
  await assertSucceeds(batch.commit());
  await assertSucceeds(writer.runTransaction(db,async tx=>{
    const row=await tx.get(template);
    tx.update(template,{revision:row.data().revision+1,name:'Updated safely'});
  }));
  await assertSucceeds(writer.setDoc(template,{name:'Merge fields safely'},{mergeFields:['name']}));
});

test('an old personal view snapshot cannot resurrect references pruned by reset',async()=>{
  const profile={ownerUid:'epoch-owner',customViews:[],favoriteViewIds:[],defaultViewId:null,lastViewId:null,schemaVersion:1,profileRevision:1};
  await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'financialViewProfiles','epoch-owner'),profile));
  const db=env.authenticatedContext('epoch-owner').firestore(),ref=doc(db,'financialViewProfiles','epoch-owner');
  const {profileRevision,...old}=profile;
  await assertFails(setDoc(ref,{...old,favoriteViewIds:['space:old-deleted-space']}));
  await assertFails(updateDoc(ref,{favoriteViewIds:['space:old-deleted-space']}));
  await assertSucceeds(sdk.runTransaction(db,async tx=>{
    const current=await tx.get(ref);
    tx.update(ref,{profileRevision:current.data().profileRevision+1,lastViewId:'all_spaces'});
  }));
  await assertFails(updateDoc(ref,{profileRevision:2,favoriteViewIds:['space:old-deleted-space']}));
});

test('personal-labelled spaces bound to a business are fenced; truly personal spaces remain independent',async()=>{
  const db=env.authenticatedContext('epoch-owner').firestore();
  const scoped={id:'scoped-personal',name:'Scoped',type:'personal',businessId,linkedBusinessId:null,ownerUid:'epoch-owner',active:true};
  const ref=doc(db,'financialSpaces',scoped.id);
  await assertFails(setDoc(ref,scoped));
  await assertSucceeds(setDoc(ref,{...scoped,workspaceGeneration:5,workspaceWriteId:'current-scope-create-0001'}));
  await assertFails(updateDoc(ref,{name:'Stale change'}));
  await assertFails(updateDoc(ref,{businessId:null,workspaceGeneration:5,workspaceWriteId:'remove-binding-00000001'}));
  await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),'businesses',businessId),{workspaceReset:{status:'FAILED'}}));
  await assertFails(updateDoc(ref,{name:'During reset',workspaceGeneration:5,workspaceWriteId:'locked-update-000000001'}));
  await assertSucceeds(setDoc(doc(db,'financialSpaces','unscoped-personal'),{...scoped,id:'unscoped-personal',businessId:null}));
  await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),'businesses',businessId),{workspaceReset:{status:'COMPLETED'}}));
});
