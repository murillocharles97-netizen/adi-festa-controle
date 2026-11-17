'use strict';
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
const {test}=require('node:test');
const {initializeApp,deleteApp}=require('firebase-admin/app');
const {getFirestore}=require('firebase-admin/firestore');
const {initializeTestEnvironment,assertFails}=require('@firebase/rules-unit-testing');
const localFirestore=require('firebase/firestore');
const path=require('node:path');
const writerRoot=path.resolve(process.env.VECONI_QA_RECEIPT_WRITER||'functions');
const readerRoot=path.resolve(process.env.VECONI_QA_RECEIPT_READER||'functions');
const {operationalCommitService:writerService}=require(path.join(writerRoot,'src/services/operational-commit-service'));
const {operationalCommitService:readerService}=require(path.join(readerRoot,'src/services/operational-commit-service'));
const {operationalCallable}=require(path.join(writerRoot,'src/shared/operational-callable'));

const project='demo-veconi-condicoes';
assert.equal(process.env.GCLOUD_PROJECT,project);
assert.match(process.env.FIRESTORE_EMULATOR_HOST||'',/^127\.0\.0\.1:\d+$/);
const app=initializeApp({projectId:project},randomUUID()),db=getFirestore(app);
test.after(()=>deleteApp(app));
let day='2026-01-31';
const clock={now:()=>new Date(day+'T15:00:00Z')};
const service=readerService(db,clock);
const commit=operationalCallable(writerService(db,clock).commit,{requireProtocol:true});

test('Firebase Emulator: condições, lançamentos concorrentes, permissões e modelos',async()=>{
 const businessId=randomUUID(),id='cliente-qa',owner=randomUUID(),seller=randomUUID(),foreign=randomUUID();
 const a='adi-'+businessId,b='cartao-'+businessId;
 const root=db.collection('businesses').doc(businessId),ref=(col,id)=>root.collection(col).doc(id);
 const scope={businessId,workspaceGeneration:0};
 const client=ref('clients',id);
 const setup=db.batch();
 setup.set(root,{...scope,ownerId:owner,active:true,subscription:{planId:'internal',status:'active'}});
 setup.set(client,{...scope,ativo:true,saldo:0,financialVersion:0,customerSpaceIds:[a,b]});
 for(const [uid,role]of [[owner,'owner'],[seller,'seller'],[foreign,'seller']]){
  setup.set(db.collection('users').doc(uid),{businessId:uid===foreign?'outro':businessId,role,active:true});
  setup.set(ref('members',uid),{uid,role,status:'active',permissionsVersion:2,
   spaceAccess:role==='owner'?'all':'selected',allowedSpaceIds:[a],
   permissions:{'customers.view':true,'customers.receiveDebt':true,'customers.edit':uid===owner}});
 }
 for(const spaceId of [a,b])setup.set(db.collection('financialSpaces').doc(spaceId),{id:spaceId,...scope,
   linkedBusinessId:businessId,active:true,type:'business',ownerUid:owner,capabilities:{sales:true}});
 await setup.commit();
 const call=(action,kind,input={},uid=owner)=>action({auth:uid?{uid}:null,data:{...scope,clientId:id,spaceId:a,
   kind,syncProtocolVersion:1,clientRelease:235,...input}});
 const read=(data,uid)=>call(service.receipt,'fiado_conditions',data,uid);
 const save=(data,uid)=>call(commit,'fiado_conditions',{mode:'monthly',days:null,limitCents:17000,promise:null,...data},uid);
 assert.equal((await read()).configured,false);
 await save({revision:0});
 await save({revision:0,spaceId:b,mode:'weekly',limitCents:null});
 const choices=await Promise.allSettled([save({revision:1}),save({revision:1})]);
 assert.equal(choices.filter(x=>x.status==='fulfilled').length,1);
 assert.equal(choices.find(x=>x.status==='rejected').reason.code,'aborted');
 assert.equal((await call(service.receipt,'fiado_conditions_list')).rows[0].clientId,id);
 await assert.rejects(read({spaceId:b},seller),e=>e.code==='permission-denied');
 await assert.rejects(read({},foreign),e=>e.code==='permission-denied');
 await assert.rejects(save({revision:2},seller),e=>e.code==='permission-denied');
 await assert.rejects(read({},null),e=>e.code==='unauthenticated');

 // Build synthetic canonical records atomically. The customer's financial version
 // determines the committed order, including when Firestore retries a transaction.
 async function apply(spaceId,operationId,delta){
  return db.runTransaction(async tx=>{
   const prior=(await tx.get(client)).data();
   if((await tx.get(ref('processedOperations',operationId))).exists)return;
   const v=prior.financialVersion+1, at=day+'T15:00:'+String(v).padStart(2,'0')+'.000Z';
   const after=prior.saldo+delta, isSale=delta<0, type=isSale?'credit_sale':'payment_received', col=isSale?'sales':'payments';
   const eventId=type+':'+operationId, envelope={...scope,spaceId,operationId};
   tx.update(client,{saldo:after,financialVersion:v});
   tx.set(ref(col,operationId),{...envelope,clienteId:id,data:at,financialAppliedAt:at,
    saldoAnterior:prior.saldo,saldoAtual:after,...(isSale?{formaPagamento:'fiado',status:'fiado',valorFinal:-delta}:{valor:delta})});
   tx.set(ref('balanceEvents',eventId),{...envelope,customerId:id,appliedAt:at,status:'applied',sourceCollection:col,
    sourceDocumentId:operationId,type,balanceDelta:delta});
   tx.set(ref('processedOperations',operationId),{...scope,status:'processed',eventKind:isSale?'sale':'payment'});
  });
 }
 await Promise.all([apply(a,'compra-a',-100),apply(a,'compra-b',-50)]);
 assert.equal((await read()).dueDate,'2026-02-28');
 assert.equal((await read()).usedCents,15000);
 day='2026-03-01';
 await apply(b,'compra-cartao',-280);
 assert.equal((await read()).overdueDays,1);
 assert.equal((await read({spaceId:b})).dueDate,'2026-03-08');
 await Promise.all([apply(a,'pix-a',70),apply(a,'pix-a',70)]);
 assert.equal((await read()).usedCents,8000);
 assert.equal((await read()).dueDate,'2026-02-28');
 assert.equal((await read({spaceId:b})).usedCents,28000);
 const renegotiated=await save({revision:2,renegotiatedDueDate:'2026-03-18',promise:{status:'pending',date:'2026-03-03',amountCents:8000,note:'QA'}});
 assert.equal(renegotiated.dueDate,'2026-03-18');
 day='2026-03-04';
 const restartedReader=readerService(db,clock);
 const promise=(await call(restartedReader.receipt,'fiado_conditions')).promise;
 assert.deepEqual(promise,{status:'pending',date:'2026-03-03',amountCents:8000,note:'QA',state:'missed'});
 assert.equal((await read({spaceId:b})).promise,null);
 await apply(a,'pix-final',80);
 assert.equal((await read()).dueDate,null);
 assert.equal((await read()).usedCents,0);
 assert.equal((await read({spaceId:b})).usedCents,28000);
 await apply(a,'novo-ciclo',-20);
 assert.equal((await read()).dueDate,'2026-04-04');
 assert.equal((await root.collection('payments').get()).size,2);
 assert.equal((await root.collection('financialLedger').get()).size,0);

 const template={templateId:'modelo-qa',name:'Cobrança Loja A',type:'charge',content:'Olá, {{nome}}. Aqui é {{nome_negocio}}.',revision:0};
 const {template:saved}=await call(commit,'message_space_template_save',template);
 assert.equal((await call(service.receipt,'message_space_templates')).templates[0].id,saved.id);
 assert.deepEqual((await call(service.receipt,'message_space_templates',{spaceId:b})).templates,[]);
 await assert.rejects(call(commit,'message_space_template_save',{...template,templateId:saved.id,revision:1,spaceId:b}),{code:'permission-denied'});
 await assert.rejects(call(service.receipt,'message_space_templates',{},seller),{code:'permission-denied'});
 const environment=await initializeTestEnvironment({projectId:project});
 try{
  const ownerClient=environment.authenticatedContext(owner).firestore();
  const templates=localFirestore.doc(ownerClient,'businesses',businessId,'messageSpaceTemplates',saved.id);
  const conditionsId=(await root.collection('fiadoConditions').get()).docs[0].id;
  const conditions=localFirestore.doc(ownerClient,'businesses',businessId,'fiadoConditions',conditionsId);
  await assertFails(localFirestore.getDoc(templates));
  await assertFails(localFirestore.setDoc(templates,{content:'Gravação direta'}));
  await assertFails(localFirestore.getDoc(conditions));
  await assertFails(localFirestore.setDoc(conditions,{limitCents:99999}));
 }finally{await environment.cleanup();}

});
