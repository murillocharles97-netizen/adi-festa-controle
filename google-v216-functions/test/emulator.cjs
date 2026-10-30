'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),{createRequire}=require('node:module'),crypto=require('node:crypto');
assert.equal(process.env.GCLOUD_PROJECT,'demo-veconi-google-only');
for(const key of ['FIREBASE_AUTH_EMULATOR_HOST','FIRESTORE_EMULATOR_HOST'])assert.match(process.env[key]||'',/^127\.0\.0\.1:\d+$/);
const dep=createRequire(path.resolve('functions/package.json')),{initializeApp,deleteApp}=dep('firebase-admin/app'),{getAuth}=dep('firebase-admin/auth'),{getFirestore}=dep('firebase-admin/firestore'),{OAuth2Client}=dep('google-auth-library');
const {registrationBroker,hash}=require('../src/broker'),{registrationStore}=require('../src/store'),{googleVerifier}=require('../src/google-verifier');
const origin='https://qa.example.test',projectId='demo-veconi-google-only',clientId='google-only-qa.apps.googleusercontent.com',keys=crypto.generateKeyPairSync('rsa',{modulusLength:2048}),oauth=new OAuth2Client(clientId);
const app=initializeApp({projectId},'google-registration-test'),auth=getAuth(app),db=getFirestore(app),store=registrationStore(db);let signs=0;
const verifier=googleVerifier({clientId,verifyIdToken:p=>oauth.verifySignedJwtWithCertsAsync(p.idToken,{'qa-key':keys.publicKey.export({type:'spki',format:'pem'})},p.audience,['https://accounts.google.com','accounts.google.com'])});
const service=(overrides={})=>registrationBroker({projectId,enabled:true,store,auth:{getUser:uid=>auth.getUser(uid),createUser:u=>auth.createUser(u),createCustomToken:async(uid,c)=>{signs++;return auth.createCustomToken(uid,c);}},verifyGoogle:verifier,readNativeProvider:async()=>({authoritative:true,enabled:false,emailUniquenessEnforced:true}),probeNative:async()=>({blocked:true}),assertNoBusiness:async uid=>{assert.equal((await db.doc('users/'+uid).get()).exists,false);},...overrides});
function jwt(email,sub,nonce,patch={}){const now=Math.floor(Date.now()/1000),header=Buffer.from(JSON.stringify({alg:'RS256',kid:'qa-key'})).toString('base64url'),claims=Buffer.from(JSON.stringify({iss:'https://accounts.google.com',aud:clientId,email,email_verified:true,sub,nonce,iat:now,exp:now+300,...patch})).toString('base64url'),signed=header+'.'+claims;return signed+'.'+crypto.sign('RSA-SHA256',Buffer.from(signed),keys.privateKey).toString('base64url');}
const request=data=>({origin,data});
async function policy(email){await db.doc('googleRegistrationControl/active').set({schemaVersion:1,enabled:true,projectId,pilotOnly:true,requireNativeProbe:true,validUntil:Date.now()+3600000,allowedOrigins:[origin],pilotEmailHash:hash(email),modes:{signup:true,signin:true}});}
async function flow(svc,intent,email,sub){const clientKey=crypto.randomBytes(32).toString('base64url'),b=await svc.begin(request({intent,clientKey})),data={intentId:b.intentId,clientKey,csrf:b.csrf,googleIdToken:jwt(email,sub,b.nonce)};await svc.preview(request(data));return{b,data,complete:()=>svc.complete(request({...data,confirmation:intent==='signup'?'CREATE_NEW_GOOGLE_ACCOUNT':'SIGN_IN_REGISTERED_GOOGLE'})),status:()=>svc.status(request(data))};}
async function publicAuth(method,data){const r=await fetch('http://'+process.env.FIREBASE_AUTH_EMULATOR_HOST+'/identitytoolkit.googleapis.com/v1/accounts:'+method+'?key=emulator-only',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)});return{http:r.status,data:await r.json()};}
test.after(async()=>{await deleteApp(app);});
for(const verified of [false,true])test('password conflict is rejected without changing UID/password/profile; verified='+verified,async()=>{
 const email='existing-'+verified+'@example.test',uid='legacy-'+verified,password='Discardable-Password-216!';await policy(email);
 const old=await auth.createUser({uid,email,password,emailVerified:verified});await auth.setCustomUserClaims(uid,{legacy:'keep'});await db.doc('users/'+uid).set({businessId:'fictitious-business',permissions:{'sales.create':true}});
 const before=await auth.getUser(uid),count=(await auth.listUsers()).users.length,issued=signs,f=await flow(service(),'signup',email,'google-sub-'+verified);await assert.rejects(f.complete());
 const after=await auth.getUser(uid);assert.equal(after.uid,old.uid);assert.equal(after.emailVerified,verified);assert.deepEqual(after.providerData.map(p=>p.providerId),['password']);assert.equal(after.passwordHash===before.passwordHash,true);assert.equal(after.tokensValidAfterTime,before.tokensValidAfterTime);assert.deepEqual(after.customClaims,before.customClaims);assert.equal((await auth.listUsers()).users.length,count);assert.equal(signs,issued);
 const login=await publicAuth('signInWithPassword',{email,password,returnSecureToken:true});assert.equal(login.http,200);assert.equal(login.data.localId,uid);assert.equal((await db.doc('users/'+uid).get()).data().businessId,'fictitious-business');
});
test('new Google registration and returning custom-token login preserve one UID, with no company',async()=>{
 const email='new-google@example.test',sub='new-google-sub';await policy(email);const svc=service(),count=(await auth.listUsers()).users.length,f=await flow(svc,'signup',email,sub),r=await f.complete();
 assert.match(r.uid,/^vg216_/);assert.equal(r.companyCreated,false);assert.equal((await auth.listUsers()).users.length,count+1);assert.deepEqual((await auth.getUser(r.uid)).providerData,[]);
 const login=await publicAuth('signInWithCustomToken',{token:r.customToken,returnSecureToken:true});assert.equal(login.http,200);const claims=await auth.verifyIdToken(login.data.idToken);assert.equal(claims.uid,r.uid);assert.equal(claims.veconi_google_v216,true);assert.equal(claims.firebase.sign_in_provider,'custom');
 for(const p of ['users/'+r.uid,'businesses/biz_'+r.uid,'memberships/biz_'+r.uid+'_'+r.uid])assert.equal((await db.doc(p).get()).exists,false);
 const again=await flow(svc,'signin',email,sub),next=await again.complete();assert.equal(next.uid,r.uid);assert.equal((await auth.listUsers()).users.length,count+1);
});
test('same-intent concurrent completion and replay grant at most one token',async()=>{
 const email='concurrency@example.test';await policy(email);const svc=service(),count=(await auth.listUsers()).users.length,issued=signs,f=await flow(svc,'signup',email,'concurrent-sub');
 const settled=await Promise.allSettled([f.complete(),f.complete()]);assert.equal(settled.filter(x=>x.status==='fulfilled').length,1);assert.equal(signs,issued+1);assert.equal((await auth.listUsers()).users.length,count+1);await assert.rejects(f.complete());const status=await f.status();assert.equal(status.confirmed,true);assert.equal(status.customToken,undefined);assert.equal(signs,issued+1);
});
test('separate simultaneous signup requests resolve to one Auth identity',async()=>{
 const email='parallel-intents@example.test';await policy(email);const svc=service(),count=(await auth.listUsers()).users.length;
 const [a,b]=await Promise.all([flow(svc,'signup',email,'parallel-sub'),flow(svc,'signup',email,'parallel-sub')]);
 const results=await Promise.allSettled([a.complete(),b.complete()]);assert.ok(results.some(x=>x.status==='fulfilled'));assert.equal((await auth.listUsers()).users.length,count+1);const ids=results.filter(x=>x.status==='fulfilled').map(x=>x.value.uid);assert.equal(new Set(ids).size,1);
});
test('lost Auth-create response can be resolved only by a fresh explicit signup challenge',async()=>{
 const email='lost-create@example.test';await policy(email);let lost=true;
 const svc=service({auth:{getUser:uid=>auth.getUser(uid),createUser:async u=>{const result=await auth.createUser(u);if(lost){lost=false;throw Error('lost Auth create response');}return result;},createCustomToken:(uid,c)=>auth.createCustomToken(uid,c)}}),count=(await auth.listUsers()).users.length,f=await flow(svc,'signup',email,'lost-create-sub');
 await assert.rejects(f.complete());assert.equal((await auth.listUsers()).users.length,count+1);await assert.rejects(f.complete());assert.equal((await f.status()).confirmed,false);
 const fresh=await flow(svc,'signup',email,'lost-create-sub'),r=await fresh.complete();assert.match(r.uid,/^vg216_/);assert.equal((await auth.listUsers()).users.length,count+1);
});
test('lost signing response leaves immutable receipt; new login never duplicates Auth',async()=>{
 const email='lost-sign@example.test';await policy(email);const svc=service({auth:{getUser:uid=>auth.getUser(uid),createUser:u=>auth.createUser(u),createCustomToken:async(uid,c)=>{await auth.createCustomToken(uid,c);throw Error('lost signed response');}}}),count=(await auth.listUsers()).users.length,f=await flow(svc,'signup',email,'lost-sign-sub');
 await assert.rejects(f.complete());const receipt=await store.receipt(f.b.intentId);assert.ok(receipt);await assert.rejects(f.complete());assert.equal((await f.status()).confirmed,true);assert.deepEqual(await store.receipt(f.b.intentId),receipt);
 const fresh=await flow(service(),'signin',email,'lost-sign-sub');assert.equal((await fresh.complete()).uid,receipt.uid);assert.equal((await auth.listUsers()).users.length,count+1);
});
test('wrong nonce, signatures, audience, expiration and session fail before Auth effects',async()=>{
 const email='negative-claims@example.test';await policy(email);const svc=service(),clientKey=crypto.randomBytes(32).toString('base64url'),b=await svc.begin(request({intent:'signup',clientKey})),count=(await auth.listUsers()).users.length;
 for(const patch of [{aud:'wrong'},{nonce:'wrong'},{iss:'https://evil.test'},{exp:1},{email_verified:false}])await assert.rejects(svc.preview(request({intentId:b.intentId,clientKey,csrf:b.csrf,googleIdToken:jwt(email,'sub',b.nonce,patch)})));
 await assert.rejects(svc.preview(request({intentId:b.intentId,clientKey,csrf:b.csrf,googleIdToken:jwt(email,'sub',b.nonce).replace(/\.[^.]+$/,'.bad-signature')})));
 await assert.rejects(svc.preview(request({intentId:b.intentId,clientKey:'x'.repeat(43),csrf:b.csrf,googleIdToken:jwt(email,'sub',b.nonce)})));
 assert.equal((await auth.listUsers()).users.length,count);
});
test('cancel, expired pilot, wrong identity and native provider open are fail-closed',async()=>{
 const email='gates@example.test';await policy(email);const svc=service(),count=(await auth.listUsers()).users.length;await flow(svc,'signup',email,'cancel-sub');assert.equal((await auth.listUsers()).users.length,count);
 await assert.rejects(flow(service({readNativeProvider:async()=>({authoritative:true,enabled:true,emailUniquenessEnforced:true})}),'signup',email,'sub'));
 await assert.rejects(flow(svc,'signup','not-authorized@example.test','other-sub'));
 await db.doc('googleRegistrationControl/active').update({validUntil:1});await assert.rejects(svc.begin(request({intent:'signin',clientKey:'x'.repeat(43)})));assert.equal((await auth.listUsers()).users.length,count);
});

async function commercialPolicy(patch={}){
 await db.doc('googleRegistrationControl/active').set({schemaVersion:2,enabled:true,projectId,pilotOnly:false,registrationOnly:true,rolloutId:'emulator-commercial',requireNativeProbe:true,signupWindowUntil:Date.now()+3600000,signupDailyLimit:20,subjectHourlyLimit:12,allowedOrigins:[origin],modes:{signup:true,signin:true},...patch});
 await db.doc('googleRegistrationLimits/signup_'+Math.floor(Date.now()/86400000)).set({count:0});
}
test('commercial onboarding is explicit, keeps UID/trial, and returning Google preserves the company',async()=>{
 await commercialPolicy();const svc=service({allowCommercial:true}),email='commercial-onboarding@example.test',sub='commercial-onboarding-sub';
 const r=await(await flow(svc,'signup',email,sub)).complete();
 for(const p of ['users/'+r.uid,'businesses/biz_'+r.uid,'onboarding/'+r.uid])assert.equal((await db.doc(p).get()).exists,false);
 const login=await publicAuth('signInWithCustomToken',{token:r.customToken,returnSecureToken:true});assert.equal(login.http,200);const identity=await auth.verifyIdToken(login.data.idToken);
 const {onboardingService}=require('../../functions/src/services/onboarding-service'),{Timestamp,FieldValue}=dep('firebase-admin/firestore');
 const onboarding=onboardingService(db,{Timestamp,FieldValue,professionalLimits:{users:3,products:20,clients:20,monthlySales:100}}),input={ownerName:'Pessoa QA fictícia',businessName:'Empresa fictícia descartável',city:'Cidade QA',state:'SP'};
 const created=await onboarding.complete({uid:identity.uid,email:identity.email,input});assert.equal(created.created.business,true);
 const before=(await db.doc('businesses/'+created.businessId).get()).data(),memberBefore=(await db.doc('businesses/'+created.businessId+'/members/'+r.uid).get()).data();
 const next=await(await flow(svc,'signin',email,sub)).complete();assert.equal(next.uid,r.uid);
 assert.deepEqual((await db.doc('businesses/'+created.businessId).get()).data(),before);assert.deepEqual((await db.doc('businesses/'+created.businessId+'/members/'+r.uid).get()).data(),memberBefore);
 const repeated=await onboarding.complete({uid:r.uid,email,input});assert.equal(repeated.created.business,false);assert.equal(repeated.trial.preserved,true);assert.deepEqual((await auth.getUser(r.uid)).providerData,[]);
});

test('commercial rollout keeps the original pilot UID/binding/receipt usable',async()=>{
 const email='pilot-transition@example.test',sub='pilot-transition-sub';await policy(email);const first=await flow(service(),'signup',email,sub),r=await first.complete(),original=await store.receipt(first.b.intentId),binding=await store.getBinding(hash(sub));
 await commercialPolicy();const login=await(await flow(service({allowCommercial:true}),'signin',email,sub)).complete();assert.equal(login.uid,r.uid);assert.deepEqual(await store.getBinding(hash(sub)),binding);assert.deepEqual(await store.receipt(first.b.intentId),original);
});

test('commercial multiple subjects cannot adopt old password UID or share a new UID',async()=>{
 await commercialPolicy();const svc=service({allowCommercial:true}),password='QA-Only-Commercial-216!',email='commercial-conflict@example.test';
 const old=await auth.createUser({uid:'old-commercial-conflict',email,password,emailVerified:false});
 const before=await auth.getUser(old.uid);await assert.rejects((await flow(svc,'signup',email,'commercial-conflict-sub')).complete());const after=await auth.getUser(old.uid);assert.deepEqual(after.providerData,before.providerData);assert.equal(after.passwordHash===before.passwordHash,true);assert.equal((await publicAuth('signInWithPassword',{email,password,returnSecureToken:true})).http,200);
 const [a,b]=await Promise.all([flow(svc,'signup','commercial-a@example.test','commercial-a-sub'),flow(svc,'signup','commercial-b@example.test','commercial-b-sub')]);
 const [ra,rb]=await Promise.all([a.complete(),b.complete()]);assert.notEqual(ra.uid,rb.uid);assert.equal((await auth.getUser(old.uid)).uid,old.uid);
});

test('daily signup reservation cap is transactional across distinct subjects',async()=>{
 await commercialPolicy({signupDailyLimit:1});const svc=service({allowCommercial:true}),count=(await auth.listUsers()).users.length;
 const [a,b]=await Promise.all([flow(svc,'signup','quota-a@example.test','quota-a-sub'),flow(svc,'signup','quota-b@example.test','quota-b-sub')]);const results=await Promise.allSettled([a.complete(),b.complete()]);assert.equal(results.filter(x=>x.status==='fulfilled').length,1);assert.equal((await auth.listUsers()).users.length,count+1);
 assert.equal((await db.doc('googleRegistrationLimits/signup_'+Math.floor(Date.now()/86400000)).get()).data().count,1);
 const winner=results.find(x=>x.status==='fulfilled').value;await db.doc('googleRegistrationControl/active').update({signupWindowUntil:1,modes:{signup:false,signin:true}});
 const email=winner===results[0].value?'quota-a@example.test':'quota-b@example.test',sub=email==='quota-a@example.test'?'quota-a-sub':'quota-b-sub';assert.equal((await(await flow(svc,'signin',email,sub)).complete()).uid,winner.uid);
});

test('verified-subject challenge limit is durable and does not modify the identity',async()=>{
 await commercialPolicy({subjectHourlyLimit:1});const svc=service({allowCommercial:true}),email='limited-sub@example.test',sub='limited-sub';const r=await(await flow(svc,'signup',email,sub)).complete(),before=await auth.getUser(r.uid),issued=signs;
 await assert.rejects(flow(svc,'signin',email,sub));assert.equal(signs,issued);assert.deepEqual((await auth.getUser(r.uid)).providerData,before.providerData);
});

test('policy change between preview and completion denies stale grant with zero Auth creation',async()=>{
 await commercialPolicy();const svc=service({allowCommercial:true}),f=await flow(svc,'signup','changed-policy@example.test','changed-policy-sub'),count=(await auth.listUsers()).users.length;await db.doc('googleRegistrationControl/active').update({rolloutId:'next-rollout'});await assert.rejects(f.complete());assert.equal((await auth.listUsers()).users.length,count);assert.equal(await store.receipt(f.b.intentId),undefined);
});
test('existing V215 transition Rules deny every new private Google metadata collection',async()=>{
 const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing'),sdk=require('firebase/firestore'),env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('security/v210/firestore.transition.rules','utf8')}});
 try{for(const uid of [null,'legacy-false','foreign']){const db=uid?env.authenticatedContext(uid).firestore():env.unauthenticatedContext().firestore();for(const name of ['googleRegistrationControl','googleRegistrationIntents','googleRegistrationBindings','googleRegistrationReceipts','googleRegistrationLimits']){await assertFails(sdk.getDoc(sdk.doc(db,name,'unknown')));await assertFails(sdk.setDoc(sdk.doc(db,name,'unknown'),{forged:true}));}}}finally{await env.cleanup();}
});
