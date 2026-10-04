'use strict';
const test=require('node:test'),fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc}=require('firebase/firestore');
const {ref,uploadBytes,getMetadata,updateMetadata,deleteObject}=require('firebase/storage');
let env;const bid='qa-epoch-storage';
const metadata=(generation='5',nonce='generation-five-upload-0001')=>({contentType:'image/webp',customMetadata:{businessId:bid,productId:'product-a',entityType:'product',workspaceGeneration:generation,workspaceWriteId:nonce}});
test.before(async()=>{
  env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')},storage:{rules:fs.readFileSync('storage.rules','utf8')}});
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'businesses',bid),{active:true,ownerId:'epoch-storage-owner',workspaceGeneration:5,legacyAccessDisabled:true});
    for(const uid of ['epoch-storage-owner','epoch-storage-removed'])await setDoc(doc(db,'users',uid),{businessId:bid,active:true,role:'owner'});
    await setDoc(doc(db,'businesses',bid,'members','epoch-storage-owner'),{role:'owner',status:'active'});
  });
});
test.after(()=>env?.cleanup());
const image=uid=>ref(env.authenticatedContext(uid).storage(),`businesses/${bid}/products/product-a/main-epoch.webp`);
test('Storage rejects stale upload, inherited metadata and removed team member',async()=>{
  const target=image('epoch-storage-owner');
  await assertFails(uploadBytes(target,new Uint8Array([1]),metadata('4')));
  await assertFails(uploadBytes(target,new Uint8Array([1]),{contentType:'image/webp',customMetadata:{businessId:bid,productId:'product-a',entityType:'product'}}));
  await assertSucceeds(uploadBytes(target,new Uint8Array([1]),metadata()));
  await assertFails(updateMetadata(target,{cacheControl:'public,max-age=1'}));
  await assertSucceeds(uploadBytes(target,new Uint8Array([2]),metadata('5','generation-five-upload-0002')));
  await assertFails(getMetadata(image('epoch-storage-removed')));
  await assertFails(uploadBytes(image('epoch-storage-removed'),new Uint8Array([3]),metadata('5','generation-five-upload-0003')));
  // Legacy delete requests carry no generation. After reset, deletion needs a
  // generation-aware backend endpoint, not a stale frontend deleteObject call.
  await assertFails(deleteObject(target));
});
test('Storage reset failure keeps uploads locked',async()=>{
  await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),'businesses',bid),{workspaceReset:{status:'FAILED'}}));
  await assertFails(uploadBytes(image('epoch-storage-owner'),new Uint8Array([4]),metadata('5','generation-five-upload-0004')));
});

test('business-bound personal attachment cannot bypass the reset lock',async()=>{
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore();
    await setDoc(doc(db,'financialSpaces','scoped-private-attachment'),{id:'scoped-private-attachment',type:'personal',businessId:bid,linkedBusinessId:null,ownerUid:'epoch-storage-owner',active:true});
    await setDoc(doc(db,'financialSpaces','scoped-private-attachment','entries','entry-a'),{id:'entry-a'});
  });
  const target=ref(env.authenticatedContext('epoch-storage-owner').storage(),'financialSpaces/scoped-private-attachment/entries/entry-a/qa.pdf');
  const metadata={contentType:'application/pdf',customMetadata:{financialSpaceId:'scoped-private-attachment',entryId:'entry-a',ownerUid:'epoch-storage-owner',entityType:'financialAttachment',workspaceGeneration:'5',workspaceWriteId:'personal-attachment-00001'}};
  await assertFails(uploadBytes(target,new Uint8Array([1]),metadata));
  await env.withSecurityRulesDisabled(context=>updateDoc(doc(context.firestore(),'businesses',bid),{workspaceReset:{status:'COMPLETED'}}));
  await assertFails(uploadBytes(target,new Uint8Array([1]),{...metadata,customMetadata:{...metadata.customMetadata,workspaceGeneration:'4'}}));
  await assertSucceeds(uploadBytes(target,new Uint8Array([1]),metadata));
});
