const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {initializeTestEnvironment,assertFails,assertSucceeds}=require('@firebase/rules-unit-testing');
const {doc,setDoc}=require('firebase/firestore'),{ref,uploadBytes,getMetadata}=require('firebase/storage');
if(!/^(localhost|127\.0\.0\.1):/.test(process.env.FIRESTORE_EMULATOR_HOST||''))throw Error('Local emulator only');
let env;const business='qa-store-image',space='qa-image-a',other='qa-image-b';
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:process.env.VECONI_EMULATOR_PROJECT_ID||'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')},storage:{rules:fs.readFileSync('storage.rules','utf8')}});
 await env.withSecurityRulesDisabled(async c=>{const db=c.firestore();await setDoc(doc(db,'businesses',business),{active:true,legacyAccessDisabled:true});for(const id of ['qa-img-owner','qa-img-manager'])await setDoc(doc(db,'businesses',business,'members',id),{status:'active',role:id.endsWith('owner')?'owner':'manager',spaceAccess:'selected',allowedSpaceIds:[space],permissions:{'products.edit':true}});for(const id of [space,other])await setDoc(doc(db,'financialSpaces',id),{businessId:business,linkedBusinessId:business,active:true,capabilities:{products:true}});});
});
test.after(async()=>env?.cleanup());
test('store assets require exact business/space, immutable upload and scoped metadata',async()=>{
 const manager=env.authenticatedContext('qa-img-manager').storage(),owner=env.authenticatedContext('qa-img-owner').storage();
 const path=id=>`businesses/${business}/catalog/spaces/${id}/logo/main-${Date.now()}.webp`;
 const meta=id=>({contentType:'image/webp',customMetadata:{businessId:business,spaceId:id,slot:'logo',entityType:'onlineStoreImage'}});
 const asset=ref(manager,path(space));await assertSucceeds(uploadBytes(asset,new Uint8Array([1,2,3]),meta(space)));
 assert.equal((await getMetadata(asset)).customMetadata.spaceId,space);
 await assertFails(uploadBytes(asset,new Uint8Array([4,5,6]),meta(space)));
 await assertFails(uploadBytes(ref(manager,path(other)),new Uint8Array([1]),meta(other)));
 await assertFails(uploadBytes(ref(owner,path(other)),new Uint8Array([1]),meta(space)));
 await assertSucceeds(uploadBytes(ref(owner,path(other)),new Uint8Array([1]),meta(other)));
 await assertFails(getMetadata(ref(env.unauthenticatedContext().storage(),asset.fullPath)));
});
