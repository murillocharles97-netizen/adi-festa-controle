const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails}=require('@firebase/rules-unit-testing');
const {collection,doc,getDoc,getDocs,onSnapshot,runTransaction,setDoc,updateDoc}=require('firebase/firestore');

let env;
const projectId='adi-festa-variations-test';
const businessA='empresa_emulador_a',businessB='empresa_emulador_b',businessExpired='empresa_expirada';

test.before(async()=>{
  env=await initializeTestEnvironment({projectId,firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});
  await env.withSecurityRulesDisabled(async context=>{
    const db=context.firestore(),subscription={planId:'internal',status:'active'};
    await setDoc(doc(db,'businesses',businessA),{id:businessA,ownerId:'owner-a',active:true,subscription});
    await setDoc(doc(db,'businesses',businessB),{id:businessB,ownerId:'owner-b',active:true,subscription});
    await setDoc(doc(db,'businesses',businessExpired),{id:businessExpired,ownerId:'owner-expired',active:true,subscription:{planId:'professional',status:'expired'}});
    await setDoc(doc(db,'users','owner-a'),{uid:'owner-a',businessId:businessA,role:'owner',active:true});
    await setDoc(doc(db,'users','owner-b'),{uid:'owner-b',businessId:businessB,role:'owner',active:true});
    await setDoc(doc(db,'users','owner-expired'),{uid:'owner-expired',businessId:businessExpired,role:'owner',active:true});
    await setDoc(doc(db,'users','manager-crm'),{uid:'manager-crm',businessId:businessA,role:'manager',active:true,permissions:{viewCRM:true,manageCustomerSegments:true}});
    await setDoc(doc(db,'users','cashier-no-crm'),{uid:'cashier-no-crm',businessId:businessA,role:'cashier',active:true,permissions:{}});
    await setDoc(doc(db,'businesses',businessA,'products','parent-1'),{id:'parent-1',businessId:businessA,nome:'Cone',productType:'variable',active:true});
    await setDoc(doc(db,'businesses',businessB,'products','parent-2'),{id:'parent-2',businessId:businessB,nome:'Gloss',productType:'variable',active:true});
    await setDoc(doc(db,'businesses',businessExpired,'clients','existing-client'),{id:'existing-client',businessId:businessExpired,nome:'Cliente existente',active:true});
    await setDoc(doc(db,'businesses',businessA,'clients','financial-client'),{id:'financial-client',businessId:businessA,ownerId:'owner-a',nome:'Cliente financeiro',saldo:-50,active:true});
  });
});

test.after(async()=>env?.cleanup());

const variant=(businessId,parentProductId,id='variant-1')=>({id,businessId,ownerId:businessId===businessA?'owner-a':'owner-b',parentProductId,attributeValues:{sabor:'Ferrero'},displayName:'Ferrero',displayNameNormalized:'ferrero',searchTokens:['ferrero','789'],sku:'FER',barcode:'789',price:14,cost:6,stock:8,minStock:2,active:true,catalogVisible:true,allowNegativeStock:false,imageUrl:null,createdAt:new Date(),updatedAt:new Date(),schemaVersion:10,version:1});

test('proprietário cria e lê variação da própria empresa',async()=>{
  const db=env.authenticatedContext('owner-a').firestore(),ref=doc(db,'businesses',businessA,'productVariants','variant-1');
  await assertSucceeds(setDoc(ref,variant(businessA,'parent-1')));
  await assertSucceeds(getDoc(ref));
});

test('multiempresa bloqueia leitura e gravação cruzadas',async()=>{
  const dbA=env.authenticatedContext('owner-a').firestore(),foreign=doc(dbA,'businesses',businessB,'productVariants','foreign');
  await assertFails(getDoc(foreign));
  await assertFails(setDoc(foreign,variant(businessB,'parent-2','foreign')));
});

test('público não cria variação nem altera preço ou estoque',async()=>{
  const anonymous=env.unauthenticatedContext().firestore(),ref=doc(anonymous,'businesses',businessA,'productVariants','public');
  await assertFails(setDoc(ref,variant(businessA,'parent-1','public')));
});

test('regra rejeita campo administrativo inesperado e pai de outra empresa',async()=>{
  const db=env.authenticatedContext('owner-a').firestore();
  await assertFails(setDoc(doc(db,'businesses',businessA,'productVariants','invalid-field'),{...variant(businessA,'parent-1','invalid-field'),secretCostOverride:1}));
  await assertFails(setDoc(doc(db,'businesses',businessA,'productVariants','invalid-parent'),variant(businessA,'parent-2','invalid-parent')));
});

test('baixa transacional atualiza a variação e o agregado do produto pai',async()=>{
  const db=env.authenticatedContext('owner-a').firestore();
  const variantRef=doc(db,'businesses',businessA,'productVariants','variant-1');
  const parentRef=doc(db,'businesses',businessA,'products','parent-1');
  await runTransaction(db,async transaction=>{
    const [variantSnapshot,parentSnapshot]=await Promise.all([transaction.get(variantRef),transaction.get(parentRef)]);
    const nextStock=Number(variantSnapshot.data().stock)-2;
    transaction.update(variantRef,{stock:nextStock,updatedAt:new Date()});
    transaction.update(parentRef,{totalStock:nextStock,estoqueAtual:nextStock,hasAvailableStock:nextStock>0,updatedAt:new Date()});
  });
  assert.equal((await getDoc(variantRef)).data().stock,6);
  assert.equal((await getDoc(parentRef)).data().totalStock,6);
});

test('configuração operacional é isolada e gerenciada pelo proprietário',async()=>{
  const owner=env.authenticatedContext('owner-a').firestore(),foreign=env.authenticatedContext('owner-b').firestore(),ref=doc(owner,'businesses',businessA,'settings','operation'),payload={id:'operation',businessId:businessA,ownerId:'owner-a',profile:'physical_store',modules:{creditSales:false,crm:true},smartCardMode:'automatic'};
  await assertSucceeds(setDoc(ref,payload));
  await assertFails(getDoc(doc(foreign,'businesses',businessA,'settings','operation')));
});

test('métricas e segmentos CRM respeitam permissão e empresa',async()=>{
  const owner=env.authenticatedContext('owner-a').firestore(),manager=env.authenticatedContext('manager-crm').firestore(),cashier=env.authenticatedContext('cashier-no-crm').firestore(),metric=doc(owner,'businesses',businessA,'customerMetrics','client-1');
  await assertSucceeds(setDoc(metric,{id:'client-1',businessId:businessA,totalSpent:120,purchaseCount:2}));
  await assertSucceeds(getDoc(doc(manager,'businesses',businessA,'customerMetrics','client-1')));
  await assertFails(getDoc(doc(cashier,'businesses',businessA,'customerMetrics','client-1')));
  await assertSucceeds(setDoc(doc(manager,'businesses',businessA,'customerSegments','vip'),{id:'vip',businessId:businessA,name:'VIP',type:'dynamic'}));
  await assertFails(setDoc(doc(cashier,'businesses',businessA,'customerSegments','blocked'),{id:'blocked',businessId:businessA,name:'Bloqueado',type:'dynamic'}));
});

test('assinatura expirada mantém leitura e bloqueia somente novas operações',async()=>{
  const db=env.authenticatedContext('owner-expired').firestore();
  await assertSucceeds(getDoc(doc(db,'businesses',businessExpired,'clients','existing-client')));
  await assertFails(setDoc(doc(db,'businesses',businessExpired,'sales','new-sale'),{id:'new-sale',businessId:businessExpired,clienteId:'existing-client',valorFinal:20,data:new Date()}));
  await assertSucceeds(setDoc(doc(db,'businesses',businessExpired,'settings','operation'),{id:'operation',businessId:businessExpired,ownerId:'owner-expired',operationMode:'physical_store',creditMode:'disabled',operationOnboardingCompleted:true}));
});

test('duas sessoes da mesma empresa compartilham produtos, clientes, vendas e pagamentos',async()=>{
  const sessionA=env.authenticatedContext('owner-a').firestore(),sessionB=env.authenticatedContext('owner-a').firestore(),
    productRef=doc(sessionA,'businesses',businessA,'products','sync-product'),
    clientRef=doc(sessionA,'businesses',businessA,'clients','sync-client'),
    saleRef=doc(sessionA,'businesses',businessA,'sales','sync-sale'),
    paymentRef=doc(sessionA,'businesses',businessA,'payments','sync-payment'),
    signalRef=doc(sessionA,'businesses',businessA,'syncMetadata','last-sync');

  await assertSucceeds(setDoc(productRef,{id:'sync-product',businessId:businessA,ownerId:'owner-a',nome:'Produto sincronizado',preco:10,estoqueAtual:4,ativo:true,updatedAt:new Date()}));
  assert.equal((await assertSucceeds(getDoc(doc(sessionB,'businesses',businessA,'products','sync-product')))).data().nome,'Produto sincronizado');
  await assertSucceeds(updateDoc(doc(sessionB,'businesses',businessA,'products','sync-product'),{preco:12,estoqueAtual:3,updatedAt:new Date()}));
  assert.equal((await assertSucceeds(getDoc(productRef))).data().preco,12);

  await assertSucceeds(setDoc(clientRef,{id:'sync-client',businessId:businessA,ownerId:'owner-a',nome:'Cliente sincronizado',saldo:-20,ativo:true,updatedAt:new Date()}));
  await assertSucceeds(updateDoc(doc(sessionB,'businesses',businessA,'clients','sync-client'),{saldo:-15,updatedAt:new Date()}));
  assert.equal((await assertSucceeds(getDoc(clientRef))).data().saldo,-15);

  await assertSucceeds(setDoc(saleRef,{id:'sync-sale',businessId:businessA,ownerId:'owner-a',clienteId:'sync-client',valorFinal:12,status:'fiado',data:new Date(),updatedAt:new Date()}));
  assert.equal((await assertSucceeds(getDoc(doc(sessionB,'businesses',businessA,'sales','sync-sale')))).data().valorFinal,12);
  await assertSucceeds(setDoc(paymentRef,{id:'sync-payment',businessId:businessA,ownerId:'owner-a',clienteId:'sync-client',valor:5,data:new Date(),updatedAt:new Date()}));
  assert.equal((await assertSucceeds(getDoc(doc(sessionB,'businesses',businessA,'payments','sync-payment')))).data().valor,5);

  await assertSucceeds(setDoc(signalRef,{id:'last-sync',businessId:businessA,ownerId:'owner-a',sourceSessionId:'session-a',changedCollections:['products','clients','sales','payments'],collectionVersions:{products:'r1',clients:'r1',sales:'r1',payments:'r1'},revision:'r1',updatedAt:new Date()}));
  const signal=(await assertSucceeds(getDoc(doc(sessionB,'businesses',businessA,'syncMetadata','last-sync')))).data();
  assert.deepEqual(signal.changedCollections,['products','clients','sales','payments']);
  assert.equal(signal.collectionVersions.clients,'r1');
});

test('duas sessoes recebem atualizacoes em tempo real e reconciliam apos retorno',async()=>{
  const sessionA=env.authenticatedContext('owner-a').firestore(),sessionB=env.authenticatedContext('owner-a').firestore();
  const waitForDocument=(db,path,predicate)=>new Promise((resolve,reject)=>{
    const timeout=setTimeout(()=>{unsubscribe();reject(new Error(`timeout aguardando ${path.join('/')}`))},4000);
    const unsubscribe=onSnapshot(doc(db,...path),snapshot=>{
      if(snapshot.exists()&&predicate(snapshot.data())){clearTimeout(timeout);unsubscribe();resolve(snapshot.data())}
    },error=>{clearTimeout(timeout);unsubscribe();reject(error)});
  });
  const productPath=['businesses',businessA,'products','realtime-product'];
  const clientPath=['businesses',businessA,'clients','realtime-client'];

  const productOnB=waitForDocument(sessionB,productPath,data=>data.estoqueAtual===5);
  await assertSucceeds(setDoc(doc(sessionA,...productPath),{id:'realtime-product',businessId:businessA,ownerId:'owner-a',nome:'Produto em tempo real',preco:10,estoqueAtual:5,ativo:true,updatedAt:new Date()}));
  assert.equal((await productOnB).nome,'Produto em tempo real');

  const productOnA=waitForDocument(sessionA,productPath,data=>data.estoqueAtual===4);
  await assertSucceeds(updateDoc(doc(sessionB,...productPath),{estoqueAtual:4,updatedAt:new Date()}));
  assert.equal((await productOnA).estoqueAtual,4);

  const clientOnB=waitForDocument(sessionB,clientPath,data=>data.saldo===-42.5);
  await assertSucceeds(setDoc(doc(sessionA,...clientPath),{id:'realtime-client',businessId:businessA,ownerId:'owner-a',nome:'Cliente em tempo real',saldo:-42.5,ativo:true,updatedAt:new Date()}));
  assert.equal((await clientOnB).saldo,-42.5);

  // Simula o aparelho B fora da tela: a alteração acontece sem listener e é
  // recuperada pela leitura canônica ao retomar.
  await assertSucceeds(updateDoc(doc(sessionA,...productPath),{preco:13,updatedAt:new Date()}));
  const resumed=await assertSucceeds(getDoc(doc(sessionB,...productPath)));
  assert.equal(resumed.data().preco,13);

  const [productsA,productsB,clientsA,clientsB]=await Promise.all([
    assertSucceeds(getDocs(collection(sessionA,'businesses',businessA,'products'))),
    assertSucceeds(getDocs(collection(sessionB,'businesses',businessA,'products'))),
    assertSucceeds(getDocs(collection(sessionA,'businesses',businessA,'clients'))),
    assertSucceeds(getDocs(collection(sessionB,'businesses',businessA,'clients'))),
  ]);
  assert.deepEqual(
    {products:productsA.size,clients:clientsA.size},
    {products:productsB.size,clients:clientsB.size},
  );
});

test('messageHistory e marcador idempotente passam juntos para owner da mesma empresa',async()=>{
  const db=env.authenticatedContext('owner-a').firestore(),operationId='message-op-1',messageId='message-1',
    messageRef=doc(db,'businesses',businessA,'messageHistory',messageId),
    markerRef=doc(db,'businesses',businessA,'processedOperations',operationId);
  await assertSucceeds(runTransaction(db,async transaction=>{
    assert.equal((await transaction.get(markerRef)).exists(),false);
    transaction.set(messageRef,{id:messageId,operationId,idempotencyKey:operationId,businessId:businessA,ownerId:'owner-a',entityType:'messageHistory',action:'create',clientId:'client-1',type:'charge',source:'individual',finalMessage:'Mensagem sanitizada',status:'opened_whatsapp',createdAt:new Date(),updatedAt:new Date(),schemaVersion:3,version:1});
    transaction.set(markerRef,{id:operationId,idempotencyKey:operationId,businessId:businessA,ownerId:'owner-a',status:'processed',eventKind:'message_opened',processedAt:new Date(),createdAtLocal:new Date(),schemaVersion:3});
  }));
  assert.equal((await getDoc(messageRef)).data().operationId,operationId);
});

test('caixa pode registrar mensagem e marcador restrito na mesma transação',async()=>{
  const db=env.authenticatedContext('cashier-no-crm').firestore(),operationId='cashier-message-op',messageId='cashier-message',
    messageRef=doc(db,'businesses',businessA,'messageHistory',messageId),markerRef=doc(db,'businesses',businessA,'processedOperations',operationId);
  await assertSucceeds(runTransaction(db,async transaction=>{
    await transaction.get(markerRef);
    transaction.set(messageRef,{id:messageId,operationId,idempotencyKey:operationId,businessId:businessA,ownerId:'cashier-no-crm',entityType:'messageHistory',action:'create',clientId:'client-1',type:'custom',source:'individual',finalMessage:'Contato',status:'opened_whatsapp',createdAt:new Date(),updatedAt:new Date(),schemaVersion:3});
    transaction.set(markerRef,{id:operationId,idempotencyKey:operationId,businessId:businessA,ownerId:'cashier-no-crm',status:'processed',eventKind:'message_opened',processedAt:new Date(),createdAtLocal:new Date(),schemaVersion:3});
  }));
  assert.equal((await getDoc(messageRef)).data().operationId,operationId);
});

test('pagamento e ajuste de saldo são idempotentes e não duplicam em retry',async()=>{
  const db=env.authenticatedContext('owner-a').firestore(),operationId='payment-op-1',
    markerRef=doc(db,'businesses',businessA,'processedOperations',operationId),
    clientRef=doc(db,'businesses',businessA,'clients','financial-client'),
    paymentRef=doc(db,'businesses',businessA,'payments','payment-1'),
    adjustmentRef=doc(db,'businesses',businessA,'balanceAdjustments','adjustment-1');
  const apply=()=>runTransaction(db,async transaction=>{
    const marker=await transaction.get(markerRef);if(marker.exists())return;
    const client=await transaction.get(clientRef),next=Number(client.data().saldo)+10;
    transaction.set(clientRef,{saldo:next,updatedAt:new Date()},{merge:true});
    transaction.set(paymentRef,{id:'payment-1',operationId,idempotencyKey:operationId,businessId:businessA,ownerId:'owner-a',entityType:'payments',action:'create',clienteId:'financial-client',valor:10,createdAt:new Date(),updatedAt:new Date(),schemaVersion:3});
    transaction.set(adjustmentRef,{id:'adjustment-1',operationId,idempotencyKey:operationId,businessId:businessA,ownerId:'owner-a',entityType:'balanceAdjustments',action:'create',clienteId:'financial-client',saldoAnterior:-50,saldoNovo:next,createdAt:new Date(),updatedAt:new Date(),schemaVersion:3});
    transaction.set(markerRef,{id:operationId,idempotencyKey:operationId,businessId:businessA,ownerId:'owner-a',status:'processed',eventKind:'payment',processedAt:new Date(),createdAtLocal:new Date(),schemaVersion:3});
  });
  await assertSucceeds(apply());await assertSucceeds(apply());
  assert.equal((await getDoc(clientRef)).data().saldo,-40);
  assert.equal((await getDocs(collection(db,'businesses',businessA,'payments'))).docs.filter(item=>item.id==='payment-1').length,1);
});

test('Rules negam marcador inválido, outra empresa, businessId ausente e path legado',async()=>{
  const owner=env.authenticatedContext('owner-a').firestore(),base={id:'blocked-op',idempotencyKey:'blocked-op',businessId:businessA,ownerId:'owner-a',status:'processed',eventKind:'payment',processedAt:new Date(),createdAtLocal:new Date(),schemaVersion:3};
  const missingIdempotency={...base};delete missingIdempotency.idempotencyKey;
  await assertFails(setDoc(doc(owner,'businesses',businessA,'processedOperations','blocked-op'),missingIdempotency));
  await assertFails(setDoc(doc(owner,'businesses',businessB,'processedOperations','blocked-op'),{...base,businessId:businessB}));
  await assertFails(setDoc(doc(owner,'businesses',businessA,'payments','missing-business'),{id:'missing-business',ownerId:'owner-a',valor:1}));
  await assertFails(setDoc(doc(owner,'businesses',businessA,'payments','wrong-business'),{id:'wrong-business',businessId:businessB,ownerId:'owner-a',valor:1}));
  await assertFails(setDoc(doc(owner,'transactions','legacy-op'),{...base}));
});
