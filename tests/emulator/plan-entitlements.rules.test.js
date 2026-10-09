const test=require('node:test'),fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {doc,setDoc,updateDoc,getDoc,getDocs,collection}=require('firebase/firestore');let env;
test.before(async()=>{
 env=await initializeTestEnvironment({projectId:'adi-festa-variations-test',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
 await env.withSecurityRulesDisabled(async context=>{const db=context.firestore();for(const plan of ['essential','professional','premium']){
  const id='plan-'+plan,uid='owner-'+plan;
  await setDoc(doc(db,'businesses',id),{id,ownerId:uid,active:true,subscription:{planId:plan,status:'active'}});
  await setDoc(doc(db,'users',uid),{uid,businessId:id,role:'owner',active:true});
  await setDoc(doc(db,'businesses',id,'members',uid),{uid,role:'owner',status:'active',spaceAccess:'all',permissions:{}});
  await setDoc(doc(db,'financialSpaces',id),{id,type:'business',linkedBusinessId:id,businessId:id,ownerUid:uid,active:true});
  await setDoc(doc(db,'businesses',id,'products','product'),{id:'product',businessId:id,nome:'Produto',preco:10,itemKind:'product',productType:'simple',controlaEstoque:true,spaceAccessMode:'all_spaces',allowedSpaceIds:[],defaultSpaceId:null,spaceScopeVersion:1});
 }});
});
test.after(()=>env?.cleanup());
test('activated replacement uses new matrix while old recurrence cancellation is pending',async()=>{
 const id='migration-pending-cancel',uid='migration-owner',db=env.authenticatedContext(uid).firestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const admin=ctx.firestore();
  await setDoc(doc(admin,'businesses',id),{id,ownerId:uid,active:true,subscription:{planId:'essential',catalogVersion:2,status:'active',hasPaidSubscription:true,legacyPlan:true,legacyTransition:null,legacyMigration:{activatedAt:new Date().toISOString(),status:'cancellation_pending'}}});
  await setDoc(doc(admin,'businesses',id,'members',uid),{uid,role:'owner',status:'active',spaceAccess:'all',permissions:{}});
  await setDoc(doc(admin,'businesses',id,'products','product'),{id:'product',businessId:id,nome:'Produto',preco:10,itemKind:'product',productType:'simple',controlaEstoque:true,spaceAccessMode:'all_spaces',allowedSpaceIds:[],defaultSpaceId:null,spaceScopeVersion:1});
 });
 await assertSucceeds(updateDoc(doc(db,'businesses',id,'products','product'),{preco:12}));
 await assertFails(updateDoc(doc(db,'businesses',id,'products','product'),{preco:15,spreadsheetImportOperationId:'not-in-essential'}));
 await assertFails(updateDoc(doc(db,'businesses',id),{'subscription.legacyMigration.status':'completed'}));
});
test('server-owned legacy rights last until paidThrough, never editable by owner',async()=>{
 const id='legacy-rule',uid='legacy-owner',db=env.authenticatedContext(uid).firestore();
 await env.withSecurityRulesDisabled(async ctx=>{
  const admin=ctx.firestore();
  await setDoc(doc(admin,'businesses',id),{id,ownerId:uid,active:true,subscription:{planId:'essential',status:'active',hasPaidSubscription:true,legacyPlan:true,legacyTransition:{paidThroughAt:new Date(Date.now()+86400000),features:{spreadsheetImport:true}}}});
  await setDoc(doc(admin,'businesses',id,'members',uid),{uid,role:'owner',status:'active',spaceAccess:'all',permissions:{}});
  await setDoc(doc(admin,'businesses',id,'products','product'),{id:'product',businessId:id,nome:'Produto',preco:10,itemKind:'product',productType:'simple',controlaEstoque:true,spaceAccessMode:'all_spaces',allowedSpaceIds:[],defaultSpaceId:null,spaceScopeVersion:1});
 });
 await assertSucceeds(updateDoc(doc(db,'businesses',id,'products','product'),{preco:15,spreadsheetImportOperationId:'legacy-qa'}));
 await assertFails(updateDoc(doc(db,'businesses',id),{'subscription.legacyTransition.paidThroughAt':new Date(Date.now()+864000000)}));
 await assertFails(setDoc(doc(db,'systemConfig','planTransitionV2'),{enabled:true}));
 await assertFails(setDoc(doc(db,'legacyPlanTransitions',id),{status:'completed'}));
 await env.withSecurityRulesDisabled(ctx=>updateDoc(doc(ctx.firestore(),'businesses',id),{'subscription.legacyTransition.paidThroughAt':new Date(Date.now()-1000)}));
 await assertFails(updateDoc(doc(db,'businesses',id,'products','product'),{preco:20}));
});
test('Essencial can persist simple campaign history and basic receipt allocations',async()=>{
 const businessId='plan-essential',db=env.authenticatedContext('owner-essential').firestore();
 await assertSucceeds(setDoc(doc(db,'businesses',businessId,'campaignEvents','simple-event'),{id:'simple-event',businessId,engineVersion:2,campaignId:'simple',clientId:'client',sourceType:'sale',transition:'earned',benefit:{kind:'quantity_discount'}}));
 await assertSucceeds(setDoc(doc(db,'businesses',businessId,'paymentAllocations','allocation'),{id:'allocation',businessId,engineVersion:2,paymentId:'payment',saleId:'sale',clientId:'client',amount:10}));
});
test('Essencial permits message history but denies CRM segments; Gestão permits both',async()=>{
 for(const plan of ['essential','professional']){const id='plan-'+plan,db=env.authenticatedContext('owner-'+plan).firestore();
  await assertSucceeds(setDoc(doc(db,'businesses',id,'messageHistory','message'),{id:'message',businessId:id,operationId:'message',schemaVersion:3}));
  await (plan==='essential'?assertFails:assertSucceeds)(setDoc(doc(db,'businesses',id,'customerSegments','segment'),{id:'segment',businessId:id,operationId:'segment',schemaVersion:3}));
 }
});
test('spreadsheet tagged product updates require Gestão; ordinary product edits remain usable',async()=>{
 for(const plan of ['essential','professional']){const id='plan-'+plan,db=env.authenticatedContext('owner-'+plan).firestore(),ref=doc(db,'businesses',id,'products','product');
  await assertSucceeds(updateDoc(ref,{preco:12}));
  await (plan==='essential'?assertFails:assertSucceeds)(updateDoc(ref,{preco:15,spreadsheetImportOperationId:'spreadsheet-qa'}));
 }
});
test('Finance reads and paid/pending writes require Gestão or Pro; global spaces remain accessible',async()=>{
 for(const plan of ['essential','professional','premium']){const id='plan-'+plan,uid='owner-'+plan,db=env.authenticatedContext(uid).firestore();
  const entry={id:'paid',operationId:'paid',financialSpaceId:id,ownerUid:uid,createdBy:uid,amountCents:1000,currency:'BRL',direction:'in',status:'paid',sourceType:'manual_income',sourceId:'paid',financialAccountId:null,creditCardId:null,paymentMethod:'cash'};
  await (plan==='essential'?assertFails:assertSucceeds)(setDoc(doc(db,'financialSpaces',id,'entries','paid'),entry));
  await (plan==='essential'?assertFails:assertSucceeds)(setDoc(doc(db,'financialSpaces',id,'entries','pending'),{...entry,id:'pending',operationId:'pending',status:'pending'}));
  await assertFails(setDoc(doc(env.authenticatedContext('foreign-owner').firestore(),'financialSpaces',id,'entries','foreign'),{...entry,id:'foreign'}));
  await assertSucceeds(getDoc(doc(db,'financialSpaces',id)));
  await (plan==='essential'?assertFails:assertSucceeds)(getDocs(collection(db,'financialSpaces',id,'entries')));
  await (plan==='essential'?assertFails:assertSucceeds)(getDocs(collection(db,'financialSpaces',id,'financialAccounts')));
  await (plan==='essential'?assertFails:assertSucceeds)(getDocs(collection(db,'financialSpaces',id,'creditCards')));
 }
});

test('Essencial cannot bypass Finance entitlement using personal-space records',async()=>{
 const uid='owner-essential',id='personal-essential';
 await env.withSecurityRulesDisabled(ctx=>setDoc(doc(ctx.firestore(),'financialSpaces',id),{id,type:'personal',ownerUid:uid,active:true,linkedBusinessId:null}));
 const db=env.authenticatedContext(uid).firestore();await assertSucceeds(getDoc(doc(db,'financialSpaces',id)));
 await assertFails(getDocs(collection(db,'financialSpaces',id,'entries')));
});
