'use strict';
// New Google identities only. Never reads by email, updates an Auth user,
// links providers, merges credentials or accepts a client-supplied UID.
const {randomBytes,randomUUID,createHash,timingSafeEqual}=require('node:crypto');
const policyRules=require('./policy');
class AccessError extends Error{constructor(code='access-unavailable'){super('Não foi possível concluir o acesso Google. Se já possui conta, entre pelo método usado no cadastro.');this.code=code;}}
const fail=code=>{throw new AccessError(code);};
const hash=value=>createHash('sha256').update(value).digest('hex');
const secret=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{43,86}$/.test(value);
const same=(a,b)=>typeof a==='string'&&typeof b==='string'&&a.length===b.length&&timingSafeEqual(Buffer.from(a),Buffer.from(b));
const email=value=>String(value||'').trim().toLowerCase();
const pids=user=>(user.providerData||[]).map(p=>p.providerId).sort();
const assertNoIdentityInput=d=>{if(['uid','email','businessId','actorUid','providers','password','providerToLink'].some(k=>Object.hasOwn(d,k)))fail();};

function registrationBroker({auth,store,verifyGoogle,readNativeProvider,probeNative,assertNoBusiness=async()=>{},projectId,enabled=false,allowCommercial=false,now=Date.now}){
 async function gate(request){
  if(!enabled||!['adi-festa-controle','demo-veconi-google-only'].includes(projectId))fail('not-enabled');
  const policy=await store.policy();
  if(!policyRules.policyValid(policy,projectId,now(),allowCommercial)||!policy.allowedOrigins.includes(request.origin)||request.auth?.uid)fail();
  const native=await readNativeProvider();
  if(native.authoritative!==true||native.enabled!==false||native.emailUniquenessEnforced!==true)fail('native-provider-open-or-email-uniqueness-unconfirmed');
  return policy;
 }
 async function begin(request){
  const policy=await gate(request),d=request.data||{};
  assertNoIdentityInput(d);
  if(!['signup','signin'].includes(d.intent)||!policyRules.modeAllowed(policy,d.intent,now())||!secret(d.clientKey))fail();
  const id=randomUUID(),nonce=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  const intent={id,intent:d.intent,origin:request.origin,sessionHash:hash(d.clientKey),csrfHash:hash(csrf),nonceHash:hash(nonce),createdAt:now(),expiresAt:now()+180000,status:'pending',policyScope:policyRules.scope(policy)};
  await store.createIntent(intent,{hour:Math.floor(now()/3600000),session:hash(d.clientKey),globalLimit:100,sessionLimit:8});
  return{intentId:id,intent:d.intent,nonce,csrf,expiresAt:intent.expiresAt};
 }
 async function load(request,{proof=true}={}){
  const policy=await gate(request),d=request.data||{};
  assertNoIdentityInput(d);
  if(typeof d.intentId!=='string'||!/^[a-f0-9-]{36}$/.test(d.intentId)||!secret(d.clientKey)||!secret(d.csrf))fail();
  const i=await store.getIntent(d.intentId);
  if(!i||i.origin!==request.origin||i.expiresAt<now()||!same(i.sessionHash,hash(d.clientKey))||!same(i.csrfHash,hash(d.csrf)))fail();
  if(!proof)return{i,policy};
  if(!policyRules.intentAllowed(policy,i,now()))fail('policy-changed');
  const g=await verifyGoogle(d.googleIdToken,{nonceHash:i.nonceHash,issuedAt:i.createdAt});
  if(!policyRules.subjectAllowed(policy,hash(g.sub),hash(email(g.email)))||i.googleSubHash&&hash(g.sub)!==i.googleSubHash)fail();
  return{i,g,policy};
 }
 async function preview(request){
  const{i,g,policy}=await load(request);
  if(i.status!=='pending'&&i.status!=='prepared')fail('intent-consumed');
  if(policy.modes?.[i.intent]!==true)fail();
  const binding=await store.getBinding(hash(g.sub));
  if(i.intent==='signin'&&binding?.status!=='active'||i.intent==='signup'&&binding?.status==='active')fail();
  if(policy.requireNativeProbe===true){if(typeof probeNative!=='function'||(await probeNative(request.data.googleIdToken,request.origin)).blocked!==true)fail('native-block-unconfirmed');}
  // Pins only a signed Google subject, never a pre-existing Firebase account.
  await store.select(i.id,{subHash:hash(g.sub),email:email(g.email),emailHash:hash(email(g.email)),nativeProbePassed:policy.requireNativeProbe===true,nativeProbeAt:policy.requireNativeProbe===true?now():null,at:now()});
  return{intentId:i.id,intent:i.intent,googleEmail:email(g.email),requiresExplicitConfirmation:true,companyCreated:false,accountLinking:false};
 }
 async function googleUser(uid,binding,{authOnly=true}={}){
  if(!/^vg216_[a-f0-9-]{36}$/.test(uid)||binding.origin!=='google-registration-v216'||binding.uid!==uid)fail();
  const user=await auth.getUser(uid);
  if(user.disabled||email(user.email)!==binding.email||user.emailVerified!==true||pids(user).length||Object.keys(user.customClaims||{}).length||user.multiFactor?.enrolledFactors?.length)fail('identity-changed');
  if(authOnly)await assertNoBusiness(uid);
  return user;
 }
 async function complete(request){
  const{i,g,policy}=await load(request),d=request.data||{},subHash=hash(g.sub);
  if(i.status!=='prepared'||policy.modes?.[i.intent]!==true||i.googleSubHash!==subHash||policy.requireNativeProbe===true&&i.nativeProbePassed!==true||d.confirmation!==(i.intent==='signup'?'CREATE_NEW_GOOGLE_ACCOUNT':'SIGN_IN_REGISTERED_GOOGLE'))fail('intent-consumed-or-unconfirmed');
  // Transactional single-use claim. Concurrent/repeated calls cannot sign twice.
  if(!await store.claim(i.id))fail('intent-consumed');
  let binding;
  if(i.intent==='signup'){
   binding=await store.reserve(subHash,{uid:'vg216_'+randomUUID(),email:email(g.email),createdAt:now(),origin:'google-registration-v216'},{intentId:i.id,at:now()});
   if(binding.status==='active'||binding.status==='conflict')fail();
   try{await auth.createUser({uid:binding.uid,email:binding.email,emailVerified:true});}
   catch(error){
    if(error.code==='auth/email-already-exists'){await store.conflict(i.id,subHash);fail('original-method-required');}
    if(error.code!=='auth/uid-already-exists')throw new AccessError('confirmation-pending');
    // Response-lost recovery can only reference the UID reserved for NEW Auth.
    const candidate=await auth.getUser(binding.uid),created=Date.parse(candidate.metadata?.creationTime||'');
    if(!Number.isFinite(created)||created<binding.createdAt-2000)fail('reserved-identity-mismatch');
   }
   await googleUser(binding.uid,binding);
   await store.activate(subHash,{uid:binding.uid,email:binding.email,at:now(),intentId:i.id});
   binding={...binding,status:'active'};
  }else{
   binding=await store.getBinding(subHash);
   if(binding?.status!=='active'||binding.email!==email(g.email))fail();
   await googleUser(binding.uid,binding,{authOnly:!policyRules.commercial(policy)});
  }
  await gate(request); // Recheck configuration before any token grant.
  const receipt={intentId:i.id,uid:binding.uid,subHash,intent:i.intent,at:now(),origin:'google-registration-v216',companyCreated:false};
  // Durable consumed grant precedes signing. A lost result requires a NEW
  // Google challenge; status never returns tokens and never repeats Auth writes.
  await store.completeOnce(i.id,receipt);
  const customToken=await auth.createCustomToken(binding.uid,{veconi_google_v216:true});
  return{uid:binding.uid,customToken,companyCreated:false,accountLinking:false};
 }
 async function status(request){
  const{i}=await load(request,{proof:false}),receipt=await store.receipt(i.id);
  return{intentId:i.id,status:receipt?'completed':i.status,confirmed:!!receipt,companyCreated:false,retryOriginal:false,newGoogleChallengeRequired:!!receipt};
 }
 return{begin,preview,complete,status};
}
module.exports={registrationBroker,AccessError,hash};
