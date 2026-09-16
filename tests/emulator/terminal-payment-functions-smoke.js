const assert=require('node:assert/strict');
const adminSdk=require('../../functions/node_modules/firebase-admin');
const {initializeApp}=require('firebase/app');
const {getAuth,connectAuthEmulator,createUserWithEmailAndPassword,signOut}=require('firebase/auth');
const {getFunctions,connectFunctionsEmulator,httpsCallable}=require('firebase/functions');

const projectId='adi-festa-variations-test',password='Secure123!';
adminSdk.initializeApp({projectId});
const admin=adminSdk.firestore(),clientApp=initializeApp({apiKey:'emulator-key',projectId},`terminal-payments-${Date.now()}`),auth=getAuth(clientApp),functions=getFunctions(clientApp,'southamerica-east1');
connectAuthEmulator(auth,'http://127.0.0.1:9099',{disableWarnings:true});
connectFunctionsEmulator(functions,'127.0.0.1',5001);
const invoke=name=>httpsCallable(functions,name);

async function createBusiness(label){
  const email=`terminal-${label}-${Date.now()}@example.test`,credential=await createUserWithEmailAndPassword(auth,email,password),uid=credential.user.uid,businessId=`terminal_${label}_${uid}`;
  await admin.doc(`businesses/${businessId}`).set({id:businessId,ownerId:uid,name:`Empresa ${label}`,active:true,subscription:{planId:'internal',status:'active'}});
  await admin.doc(`users/${uid}`).set({uid,businessId,email,role:'owner',active:true});
  await admin.doc(`financialSpaces/business_${businessId}`).set({id:`business_${businessId}`,businessId,linkedBusinessId:businessId,ownerUid:uid,name:`Empresa ${label}`,type:'business',operationalType:'unit',active:true,status:'active',capabilities:{finance:true,sales:true,products:true,inventory:true,goals:true},isDefault:true,globalSpaceSchemaVersion:1});
  return{uid,businessId,email};
}
const saleDraft=(id,businessId)=>({id,spaceId:`business_${businessId}`,financialSpaceId:`business_${businessId}`,clienteId:null,observacao:'Teste presencial',itens:[{produtoId:'product-1',nome:'Produto teste',quantidade:1,precoOriginal:89.9,precoFinalUnitario:89.9,custoUnitario:20}]});

(async()=>{
  const businessA=await createBusiness('a'),setup=invoke('getTerminalPaymentSetup'),saveTerminal=invoke('savePaymentTerminal'),createPayment=invoke('createTerminalPayment'),dispatchPayment=invoke('dispatchTerminalPayment'),claim=invoke('claimTerminalPaymentFinalization'),ack=invoke('acknowledgeTerminalPaymentSale'),cancel=invoke('cancelTerminalPayment'),active=invoke('getActiveTerminalPayment');
  assert.equal((await setup({businessId:businessA.businessId})).data.simulatorAllowed,true);
  const terminal=(await saveTerminal({businessId:businessA.businessId,terminal:{provider:'simulator',nickname:'Caixa Teste',makeDefault:true}})).data.terminal;
  assert.equal(terminal.businessId,businessA.businessId);assert.equal(terminal.isDefault,true);

  const approvedPayload={businessId:businessA.businessId,idempotencyKey:'approved_attempt_0001',terminalId:terminal.id,amountCents:8990,paymentMethod:'credit',installments:2,simulatorScenario:'approved',saleDraft:saleDraft('sale_approved_0001',businessA.businessId)};
  const [createdA,createdB]=await Promise.all([createPayment(approvedPayload),createPayment(approvedPayload)]),approvedIntent=createdA.data.intent;
  assert.equal(createdA.data.intent.id,createdB.data.intent.id);assert.equal(approvedIntent.status,'awaiting_terminal');
  const [dispatchA,dispatchB]=await Promise.all([dispatchPayment({businessId:businessA.businessId,intentId:approvedIntent.id}),dispatchPayment({businessId:businessA.businessId,intentId:approvedIntent.id})]);
  assert.equal([dispatchA.data.intent.status,dispatchB.data.intent.status].includes('approved'),true);
  const approvedDoc=(await admin.doc(`businesses/${businessA.businessId}/paymentIntents/${approvedIntent.id}`).get()).data();assert.equal(approvedDoc.status,'approved');
  const firstClaim=(await claim({businessId:businessA.businessId,intentId:approvedIntent.id,claimToken:'claim_token_session_a_0001'})).data,secondClaim=(await claim({businessId:businessA.businessId,intentId:approvedIntent.id,claimToken:'claim_token_session_b_0001'})).data;
  assert.equal(firstClaim.claimed,true);assert.equal(secondClaim.busy,true);
  await ack({businessId:businessA.businessId,intentId:approvedIntent.id,claimToken:'claim_token_session_a_0001',saleId:'sale_approved_0001'});
  const receivable=(await admin.doc(`businesses/${businessA.businessId}/paymentReceivables/${approvedIntent.id}`).get()).data();assert.equal(receivable.grossAmountCents,8990);assert.equal(receivable.status,'pending_settlement');assert.equal(receivable.netAmountCents,null);
  assert.equal((await dispatchPayment({businessId:businessA.businessId,intentId:approvedIntent.id})).data.intent.status,'approved');

  const declined=(await createPayment({...approvedPayload,idempotencyKey:'declined_attempt_0001',simulatorScenario:'declined',saleDraft:saleDraft('sale_declined_0001',businessA.businessId)})).data.intent;
  assert.equal((await dispatchPayment({businessId:businessA.businessId,intentId:declined.id})).data.intent.status,'declined');
  assert.equal((await admin.doc(`businesses/${businessA.businessId}/sales/sale_declined_0001`).get()).exists,false);

  const timeoutPayload={...approvedPayload,idempotencyKey:'timeout_attempt_000001',simulatorScenario:'timeout',saleDraft:saleDraft('sale_timeout_00001',businessA.businessId)},timeout=(await createPayment(timeoutPayload)).data.intent;
  assert.equal((await dispatchPayment({businessId:businessA.businessId,intentId:timeout.id})).data.intent.status,'pending_confirmation');
  assert.equal((await createPayment(timeoutPayload)).data.intent.id,timeout.id);
  assert.equal((await active({businessId:businessA.businessId})).data.intent.id,timeout.id);
  assert.equal((await cancel({businessId:businessA.businessId,intentId:timeout.id})).data.intent.status,'cancelled');

  const intentCount=(await admin.collection(`businesses/${businessA.businessId}/paymentIntents`).get()).size;assert.equal(intentCount,3);
  const eventCount=(await admin.collection(`businesses/${businessA.businessId}/paymentIntents/${approvedIntent.id}/events`).get()).size;assert.ok(eventCount>=4);

  await signOut(auth);const businessB=await createBusiness('b');
  await assert.rejects(()=>createPayment({...approvedPayload,businessId:businessB.businessId,idempotencyKey:'cross_business_000001',saleDraft:saleDraft('sale_cross_000001',businessA.businessId)}),error=>['functions/not-found','functions/permission-denied'].includes(error.code));
  assert.equal((await admin.collection(`businesses/${businessB.businessId}/paymentIntents`).get()).empty,true);
  console.log('Terminal Payments Functions: aprovação, replay, timeout, cancelamento, recebível e isolamento validados.');
  process.exit(0);
})().catch(error=>{console.error(error);process.exit(1)});
