const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,getDoc,setDoc,writeBatch,Timestamp}=require('firebase/firestore');

let env;
const projectId='adi-festa-variations-test';

test.before(async()=>{
  env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
});

test.after(async()=>env?.cleanup());

function onboardingData(uid,email,{trialDays=7,ownerId=uid,businessId=`biz_${uid}`}={}){
  const now=new Date(),trialEnd=new Date(now.getTime()+trialDays*86400000),createdAt=Timestamp.fromDate(now),updatedAt=Timestamp.fromDate(now);
  const profile={uid,email,name:'Nova proprietária',phone:'17999999999',active:true,businessId,role:'owner',permissions:[],onboardingCompleted:true,createdAt,updatedAt,lastLoginAt:updatedAt};
  const business={id:businessId,slug:`empresa-${uid}`,name:'Empresa de teste',legalName:'',document:'',phone:'17999999999',email,ownerId,active:true,onboardingCompleted:true,businessType:'Doceria',city:'Rio Preto',state:'SP',createdAt,updatedAt,subscription:{planId:'trial',status:'trial',trialStartedAt:createdAt,trialEndsAt:Timestamp.fromDate(trialEnd),currentPeriodStart:null,currentPeriodEnd:null,cancelAtPeriodEnd:false,suspendedAt:null,gracePeriodEndsAt:null},limits:{maxUsers:3,maxProducts:2000,maxClients:5000,maxMonthlySales:10000,users:3,products:2000,clients:5000,monthlySales:10000,catalogEnabled:true,campaignsEnabled:true}};
  return{businessId,profile,business,defaultSettings:{id:'default',businessId,nome:business.name,businessName:business.name,receiptName:business.name,telefone:business.phone,currency:'BRL',timezone:'America/Sao_Paulo',onboardingStep:1,createdAt,updatedAt},operationSettings:{id:'operation',businessId,ownerId:uid,operationMode:'physical_store',creditMode:'disabled',operationOnboardingCompleted:false,modules:{creditSales:false,inventory:true,onlineCatalog:false,onlineOrders:false,delivery:false,pickup:false,physicalStore:true,scheduledVisits:false,campaigns:false,loyalty:false,crm:true,inPersonSales:true},smartCardMode:'automatic',cardMetrics:[],migrationVersion:2,schemaVersion:2,createdAt,updatedAt},audit:{id:`account_created_${uid}`,businessId,type:'account_created',actorId:uid,createdAt}};
}

function onboardingBatch(db,uid,email,options={}){
  const data=onboardingData(uid,email,options),batch=writeBatch(db);
  batch.set(doc(db,'businesses',data.businessId),data.business);
  batch.set(doc(db,'users',uid),data.profile);
  batch.set(doc(db,'businesses',data.businessId,'settings','default'),data.defaultSettings);
  if(options.includeOperation!==false)batch.set(doc(db,'businesses',data.businessId,'settings','operation'),data.operationSettings);
  batch.set(doc(db,'businesses',data.businessId,'auditLogs',data.audit.id),data.audit);
  return{data,commit:()=>batch.commit()};
}

test('diagnóstico: lote inicial sem settings/operation é aceito',async()=>{
  const uid='onboarding-baseline',email='baseline@example.test',db=env.authenticatedContext(uid,{email}).firestore();
  const batch=onboardingBatch(db,uid,email,{includeOperation:false});
  await assertSucceeds(batch.commit());
});

test('onboarding completo cria empresa, perfil, configurações e auditoria atomicamente',async()=>{
  const uid='onboarding-complete',email='complete@example.test',db=env.authenticatedContext(uid,{email}).firestore();
  const {data,commit}=onboardingBatch(db,uid,email);
  await assertSucceeds(commit());
  for(const path of [
    ['users',uid],
    ['businesses',data.businessId],
    ['businesses',data.businessId,'settings','default'],
    ['businesses',data.businessId,'settings','operation'],
    ['businesses',data.businessId,'auditLogs',data.audit.id]
  ])assert.equal((await getDoc(doc(db,...path))).exists(),true,`documento ausente: ${path.join('/')}`);
  const saved=(await getDoc(doc(db,'businesses',data.businessId))).data();
  assert.equal(saved.subscription.planId,'trial');
  assert.equal(saved.subscription.status,'trial');
  assert.ok(saved.subscription.trialEndsAt.toMillis()-saved.subscription.trialStartedAt.toMillis()>=7*86400000);
});

test('onboarding rejeita empresa fora do ID determinístico do usuário',async()=>{
  const uid='wrong-business',email='wrong-business@example.test',db=env.authenticatedContext(uid,{email}).firestore();
  await assertFails(onboardingBatch(db,uid,email,{businessId:'biz_outro'}).commit());
});

test('onboarding rejeita proprietário divergente e trial fora de 7 dias',async()=>{
  const ownerUid='wrong-owner',ownerEmail='wrong-owner@example.test',ownerDb=env.authenticatedContext(ownerUid,{email:ownerEmail}).firestore();
  await assertFails(onboardingBatch(ownerDb,ownerUid,ownerEmail,{ownerId:'attacker'}).commit());
  const trialUid='wrong-trial',trialEmail='wrong-trial@example.test',trialDb=env.authenticatedContext(trialUid,{email:trialEmail}).firestore();
  await assertFails(onboardingBatch(trialDb,trialUid,trialEmail,{trialDays:5}).commit());
});

test('planos são somente leitura e não existem gravações públicas paralelas de assinatura',async()=>{
  await env.withSecurityRulesDisabled(context=>setDoc(doc(context.firestore(),'plans','trial'),{id:'trial',active:true}));
  const uid='protected-collections',email='protected@example.test',db=env.authenticatedContext(uid,{email}).firestore();
  await assertSucceeds(getDoc(doc(db,'plans','trial')));
  await assertFails(setDoc(doc(db,'plans','trial'),{id:'trial',active:false}));
  for(const collection of ['memberships','subscriptions','onboarding','trials']){
    await assertFails(setDoc(doc(db,collection,uid),{uid,businessId:`biz_${uid}`}));
  }
  const {data,commit}=onboardingBatch(db,uid,email);
  await assertSucceeds(commit());
  await assertFails(setDoc(doc(db,'businesses',data.businessId,'subscriptionIntents','client-created'),{businessId:data.businessId,status:'pending'}));
});

test('conta nova autentica, cria a empresa e entra novamente imediatamente',async()=>{
  const suffix=Date.now(),email=`new-company-${suffix}@example.test`,password='Test@123456';
  const signUp=await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=fake-api-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  const signUpBody=await signUp.json();
  assert.equal(signUp.status,200,JSON.stringify(signUpBody));
  const created=signUpBody,uid=created.localId;
  const db=env.authenticatedContext(uid,{email}).firestore(),{data,commit}=onboardingBatch(db,uid,email);
  await assertSucceeds(commit());
  const login=await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake-api-key`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({email,password,returnSecureToken:true})});
  const loginBody=await login.json();
  assert.equal(login.status,200,JSON.stringify(loginBody));
  const authenticated=loginBody;
  assert.equal(authenticated.localId,uid);
  assert.ok(authenticated.idToken);
  assert.equal((await getDoc(doc(db,'businesses',data.businessId))).data().ownerId,uid);
  assert.equal((await getDoc(doc(db,'users',uid))).data().businessId,data.businessId);
});
