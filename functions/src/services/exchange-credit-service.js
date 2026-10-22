'use strict';

const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {Timestamp,FieldValue}=require('firebase-admin/firestore');
const {assertWritable,validId,belongsToWorkspace}=require('./workspace-reset-policy');
const {computeAccess}=require('./subscription-service');
const {stockKey}=require('./online-stock-reservation');
const {salePlan}=require('../shared/exchange-credit');
const Model=require('../shared/online-store');
const {allowsExchangeProduct}=require('../shared/exchange-product-scope');
const fail=(code,message)=>{throw new HttpsError(code,message);};
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const generation=value=>value?.workspaceGeneration??0;
const safeStock=value=>Number.isSafeInteger(value)&&value>=0;
const inputIdentity=d=>[d.businessId,d.workspaceGeneration??0,d.spaceId,d.clientId];
const requestHash=d=>hash([...inputIdentity(d),d.saleId,d.operationId,d.items?.map(i=>[i.productId,i.variantId||null,i.quantity]),d.creditCents,d.paymentMethod||null,d.fingerprint]);

function creditService(db){
  async function context(tx,request,permission='sales.create'){
    const uid=request.auth?.uid;if(!uid)fail('unauthenticated','Entre na sua conta.');
    const d=request.data||{},bid=validId(d.businessId,'Empresa'),spaceId=validId(d.spaceId,'Espaço'),clientId=validId(d.clientId,'Cliente'),root=db.doc(`businesses/${bid}`);
    const [businessSnap,memberSnap,userSnap,spaceSnap,clientSnap]=await Promise.all([
      tx.get(root),tx.get(root.collection('members').doc(uid)),tx.get(db.doc(`users/${uid}`)),tx.get(db.doc(`financialSpaces/${spaceId}`)),tx.get(root.collection('clients').doc(clientId)),
    ]);
    const business=businessSnap.data(),member=memberSnap.data(),profile=userSnap.data(),space=spaceSnap.data(),client=clientSnap.data();
    if(!business||member?.status!=='active'||profile?.active!==true||profile.businessId!==bid)fail('permission-denied','Vínculo ativo obrigatório.');
    assertWritable(business,d.workspaceGeneration??0);
    if(!computeAccess(business.subscription||{}).canMutate)fail('permission-denied','Plano sem acesso operacional.');
    const owner=business.ownerId===uid&&member.role==='owner';
    if(!owner&&(member.permissions?.[permission]!==true||member.permissions?.['customers.view']!==true))fail('permission-denied','Sem permissão para esta venda ou consulta do cliente.');
    if(!space||!belongsToWorkspace(space,bid)||space.active===false||space.capabilities?.sales!==true||!owner&&member.spaceAccess!=='all'&&!member.allowedSpaceIds?.includes(spaceId))fail('permission-denied','Espaço não autorizado.');
    // Legacy clients are already scoped by their business path. A missing link
    // is accepted only in generation zero, never inferred across generations.
    if(!client||client.businessId&&client.businessId!==bid||!client.businessId&&generation(business)!==0||generation(client)!==generation(business)||!Model.active(client)||client.spaceId&&client.spaceId!==spaceId)fail('permission-denied','Cliente não disponível nesta empresa ou espaço.');
    return {uid,bid,spaceId,clientId,root,business,member,client,owner};
  }
  const scope=c=>({businessId:c.bid,spaceId:c.spaceId,workspaceGeneration:generation(c.business)});
  async function creditsFor(tx,c){
    // One equality uses the existing single-field index. Fail closed if truncated.
    const snapshot=await tx.get(c.root.collection('exchangeCredits').where('clientId','==',c.clientId).limit(401));
    if(snapshot.size>400)fail('failed-precondition','Muitos créditos deste cliente; revisão necessária.');
    const credits=[];
    for(const snap of snapshot.docs){
      const value=snap.data();
      if(value.spaceId!==c.spaceId||generation(value)!==generation(c.business))continue;
      if(value.businessId!==c.bid||!safeStock(value.amountCents)||!safeStock(value.remainingCents)||value.remainingCents>value.amountCents||!['issued','exhausted'].includes(value.status)||value.status==='exhausted'&&value.remainingCents!==0)fail('failed-precondition','Saldo de crédito inconsistente.');
      if(value.remainingCents)credits.push({id:snap.id,ref:snap.ref,...value});
    }
    return credits.sort((a,b)=>(a.createdAt?.toMillis?.()||0)-(b.createdAt?.toMillis?.()||0)||a.id.localeCompare(b.id));
  }
  async function stocksFor(tx,c,items,{restore=false}={}){
    if(!Array.isArray(items)||!items.length||items.length>40)fail('invalid-argument','Itens inválidos.');
    const parents=new Map(),rows=[],keys=new Set();
    for(const item of items){
      const productId=validId(item.productId,'Produto'),variantId=item.variantId?validId(item.variantId,'Variação'):null,key=`${productId}:${variantId||''}`;
      if(keys.has(key)||!Number.isSafeInteger(item.quantity)||item.quantity<1||item.quantity>999)fail('invalid-argument','Quantidade ou item repetido inválido.');keys.add(key);
      let parent=parents.get(productId);
      if(!parent){const ref=c.root.collection('products').doc(productId);parent={ref,data:(await tx.get(ref)).data(),delta:0};parents.set(productId,parent);}
      const product=parent.data;
      if(!product||product.businessId!==c.bid||generation(product)!==generation(c.business)||!allowsExchangeProduct(product,c.spaceId)||product.spaceId&&product.spaceId!==c.spaceId)fail('permission-denied','Produto não autorizado no espaço.');
      if(product.itemKind==='service'||product.productType==='recurring'||product.semControleEstoque||product.controlaEstoque===false)fail('failed-precondition','A V1 exige produto físico com controle de estoque.');
      const ref=variantId?c.root.collection('productVariants').doc(variantId):parent.ref,source=variantId?(await tx.get(ref)).data():product;
      if(!source||Boolean(variantId)!==(product.productType==='variable')||variantId&&(source.parentProductId!==productId||source.businessId!==c.bid||generation(source)!==generation(c.business)||!Model.active(source)||source.spaceId&&source.spaceId!==c.spaceId))fail('failed-precondition','Variação indisponível no espaço.');
      const held=(await tx.get(c.root.collection('onlineStockReservations').doc(stockKey({productId,variantId})))).data();
      const reserved=held?held.quantity:0,stock=variantId?source.stock:product.estoqueAtual??product.estoque,delta=(restore?1:-1)*item.quantity;
      if(!safeStock(stock)||!safeStock(reserved)||Number(source.onlineReservedStock??0)!==reserved||held&&(!belongsToWorkspace(held,c.bid)||generation(held)!==generation(c.business)))fail('failed-precondition','Estoque ou reserva inconsistente.');
      if(stock+delta<reserved)fail('failed-precondition','Estoque disponível insuficiente; reserva preservada.');
      const price=Number(variantId?source.price:product.preco),priceCents=Math.round(price*100);
      if(!restore&&(!Number.isFinite(price)||!safeStock(priceCents)||priceCents===0))fail('failed-precondition','Preço inválido.');
      parent.delta+=delta;
      rows.push({productId,variantId,ref,stock,reserved,after:stock+delta,delta,priceCents,name:product.nome||productId,variantName:variantId?source.displayName||'':''});
    }
    let budget=350;
    for(const [id,parent]of parents)if(parent.data.productType==='variable'){
      const variants=(await tx.get(c.root.collection('productVariants').where('parentProductId','==',id).limit(budget+1))).docs;
      if(variants.length>budget)fail('failed-precondition','Limite seguro de variações excedido.');budget-=variants.length;
      parent.total=variants.filter(s=>Model.active(s.data())).reduce((sum,s)=>{const v=s.data();if(!safeStock(v.stock)||v.businessId!==c.bid||generation(v)!==generation(c.business))fail('failed-precondition','Estoque agregado inconsistente.');return sum+v.stock;},0)+parent.delta;
      if(!safeStock(parent.total))fail('failed-precondition','Estoque agregado inválido.');
    }
    return {rows,parents};
  }
  const updateStocks=(tx,c,stock,operationId,saleId,now,restore=false)=>{
    const movementIds=[];
    stock.rows.forEach((row,index)=>{
      const id=`${operationId}_stock_${index}`;movementIds.push(id);
      tx.update(row.ref,{...(row.variantId?{stock:row.after}:{estoqueAtual:row.after,estoque:row.after,totalStock:row.after}),version:FieldValue.increment(1),updatedAt:now});
      tx.create(c.root.collection('stockMovements').doc(id),{...scope(c),id,operationId,vendaId:saleId,source:'exchange_credit_checkout',actorUid:c.uid,produtoId:row.productId,variantId:row.variantId,tipo:restore?'entrada_cancelamento_venda':'saida_venda',quantidade:row.delta,estoqueAnterior:row.stock,estoqueNovo:row.after,data:now,createdAt:now,updatedAt:now,schemaVersion:3});
    });
    for(const parent of stock.parents.values())if(parent.total!==undefined)tx.update(parent.ref,{totalStock:parent.total,estoqueAtual:parent.total,estoque:parent.total,version:FieldValue.increment(1),updatedAt:now});
    return movementIds;
  };
  const signal=(tx,c,now)=>tx.set(c.root.collection('syncMetadata').doc('last-sync'),{...scope(c),revision:now.toDate().toISOString(),updatedAt:now,changedCollections:['sales','products','productVariants','stockMovements'],collectionVersions:Object.fromEntries(['sales','products','productVariants','stockMovements'].map(n=>[n,now.toDate().toISOString()]))},{merge:true});
  const safeSale=s=>({id:s.id,businessId:s.businessId,spaceId:s.spaceId,workspaceGeneration:s.workspaceGeneration,operationId:s.operationId,status:s.status,clienteId:s.clienteId,clienteNome:s.clienteNome,itens:s.itens,valorTotal:s.valorTotal,valorFinal:s.valorFinal,formaPagamento:s.formaPagamento,exchangeCreditUsedCents:s.exchangeCreditUsedCents,cashReceivedCents:s.cashReceivedCents,createdAt:s.createdAt.toDate().toISOString(),data:s.createdAt.toDate().toISOString(),actorUid:s.actorUid,source:s.source});
  async function prepare(tx,c,input){
    const stock=await stocksFor(tx,c,input.items),credits=await creditsFor(tx,c);
    let plan;try{plan=salePlan(input,stock.rows,credits);}catch(error){fail('failed-precondition',error.message);}
    const fingerprint=hash([inputIdentity(input),plan,stock.rows.map(r=>[r.productId,r.variantId,r.stock,r.reserved]),credits.map(r=>[r.id,r.remainingCents])]);
    return {stock,credits,plan,fingerprint};
  }
  async function available(request){return db.runTransaction(async tx=>{const c=await context(tx,request),credits=await creditsFor(tx,c);return {availableCents:credits.reduce((sum,v)=>sum+v.remainingCents,0),creditCount:credits.length};});}
  async function quote(request){return db.runTransaction(async tx=>{const c=await context(tx,request),p=await prepare(tx,c,request.data);const {allocations,...publicPlan}=p.plan;return {...publicPlan,fingerprint:p.fingerprint};});}
  async function confirm(request){
    const d=request.data||{},saleId=validId(d.saleId,'Venda'),operationId=validId(d.operationId,'Operação'),checksum=requestHash(d);
    return db.runTransaction(async tx=>{
      const c=await context(tx,request),saleRef=c.root.collection('sales').doc(saleId),markerRef=c.root.collection('processedOperations').doc(operationId);
      const [existing,marker]=await Promise.all([tx.get(saleRef),tx.get(markerRef)]);
      if(existing.exists||marker.exists){const s=existing.data(),m=marker.data();if(!s||!m||s.operationId!==operationId||s.actorUid!==c.uid||s.exchangeCreditRequestHash!==checksum||m.checksum!==checksum||m.eventKind!=='sale_exchange_credit'||m.saleId!==saleId||m.spaceId!==c.spaceId||m.businessId!==c.bid||generation(m)!==generation(c.business)||s.spaceId!==c.spaceId||s.businessId!==c.bid||generation(s)!==generation(c.business)||s.clienteId!==c.clientId)fail('already-exists','Identificador em uso ou recibo incompleto.');return {saleId,operationId,replayed:true,sale:safeSale(s),receipt:{operationId,checksum,status:'processed'}};}
      const p=await prepare(tx,c,d);
      if(d.fingerprint!==p.fingerprint)fail('failed-precondition','Preço, estoque ou crédito mudou. Revise novamente.');
      const now=Timestamp.now(),stamp={...scope(c),actorUid:c.uid,operationId,createdAt:now,updatedAt:now},sale={...stamp,id:saleId,idempotencyKey:operationId,ownerId:c.uid,updatedByUid:c.uid,entityType:'sales',schemaVersion:3,version:1,source:'exchange_credit_checkout',status:'pago',formaPagamento:p.plan.paymentMethod||'credito_troca',clienteId:c.clientId,clienteNome:c.client.nome||'Cliente',data:now,paidAt:now,
        itens:p.plan.items.map(i=>({produtoId:i.productId,variantId:i.variantId,nome:i.name,variantName:i.variantName,quantidade:i.quantity,precoUnitario:i.unitCents/100,precoFinalUnitario:i.unitCents/100,precoOriginal:i.unitCents/100})),valorTotal:p.plan.grossCents/100,valorFinal:p.plan.grossCents/100,effectiveAmount:p.plan.cashReceivedCents/100,exchangeCreditUsedCents:p.plan.creditUsedCents,cashReceivedCents:p.plan.cashReceivedCents,exchangeCreditAllocations:p.plan.allocations,exchangeCreditRequestHash:checksum,tender:{kind:'exchange_credit',creditCents:p.plan.creditUsedCents,manualReceivedCents:p.plan.cashReceivedCents,manualPaymentMethod:p.plan.paymentMethod}};
      const movementIds=updateStocks(tx,c,p.stock,operationId,saleId,now);
      for(const [index,allocation]of p.plan.allocations.entries()){
        const credit=p.credits.find(v=>v.id===allocation.creditId),remainingCents=credit.remainingCents-allocation.amountCents,id=`${operationId}_consume_${index}`;
        tx.update(credit.ref,{remainingCents,status:remainingCents?'issued':'exhausted',updatedAt:now});
        tx.create(c.root.collection('exchangeCreditEvents').doc(id),{...stamp,id,clientId:c.clientId,creditId:credit.id,saleId,kind:'consumed',amountCents:allocation.amountCents,balanceBeforeCents:credit.remainingCents,balanceAfterCents:remainingCents});
      }
      tx.create(saleRef,sale);tx.create(markerRef,{...stamp,id:operationId,idempotencyKey:operationId,eventKind:'sale_exchange_credit',saleId,status:'processed',checksum,movementIds,processedAt:now,schemaVersion:3});signal(tx,c,now);
      return {saleId,operationId,replayed:false,sale:safeSale(sale),receipt:{operationId,checksum,status:'processed'},stockChanges:p.stock.rows.map(r=>({productId:r.productId,variantId:r.variantId,stock:r.after}))};
    });
  }
  async function status(request){return db.runTransaction(async tx=>{const c=await context(tx,request),d=request.data||{},saleId=validId(d.saleId,'Venda'),operationId=validId(d.operationId,'Operação');const [s,m]=await Promise.all([tx.get(c.root.collection('sales').doc(saleId)),tx.get(c.root.collection('processedOperations').doc(operationId))]);if(!s.exists&&!m.exists)return {committed:false};const sale=s.data(),marker=m.data();if(!sale||!marker||sale.operationId!==operationId||sale.actorUid!==c.uid||sale.businessId!==c.bid||generation(sale)!==generation(c.business)||sale.spaceId!==c.spaceId||sale.clienteId!==c.clientId||marker.eventKind!=='sale_exchange_credit'||marker.checksum!==sale.exchangeCreditRequestHash||marker.saleId!==saleId||marker.businessId!==c.bid||marker.spaceId!==c.spaceId||generation(marker)!==generation(c.business))fail('failed-precondition','Recibo inconsistente.');return {committed:true,saleId,operationId,sale:safeSale(sale),receipt:{operationId,checksum:marker.checksum,status:'processed'}};});}
  async function cancel(request){
    const d=request.data||{},saleId=validId(d.saleId,'Venda'),operationId=validId(d.operationId,'Operação de cancelamento'),checksum=hash(['cancel',...inputIdentity(d),saleId,operationId]);
    return db.runTransaction(async tx=>{
      const c=await context(tx,request,'sales.cancel'),saleRef=c.root.collection('sales').doc(saleId),markerRef=c.root.collection('processedOperations').doc(operationId);
      const [saleSnap,cancelMarker,summary]=await Promise.all([tx.get(saleRef),tx.get(markerRef),tx.get(c.root.collection('saleExchangeSummaries').doc(saleId))]);
      const sale=saleSnap.data(),marker=cancelMarker.data();
      if(!sale||sale.businessId!==c.bid||sale.spaceId!==c.spaceId||generation(sale)!==generation(c.business)||sale.clienteId!==c.clientId||sale.source!=='exchange_credit_checkout')fail('failed-precondition','Venda com crédito de troca não encontrada neste contexto.');
      if(marker){if(marker.checksum!==checksum||marker.eventKind!=='sale_exchange_credit_cancel'||marker.saleId!==saleId||marker.actorUid!==c.uid||marker.businessId!==c.bid||marker.spaceId!==c.spaceId||generation(marker)!==generation(c.business)||sale.cancelOperationId!==operationId)fail('already-exists','Identificador utilizado por outra operação.');return {saleId,operationId,replayed:true,status:'cancelado'};}
      if(sale.status!=='pago'||sale.cancelOperationId||sale.reversedAt||summary.exists)fail('failed-precondition','Venda já cancelada ou vinculada a uma troca.');
      const originalMarker=(await tx.get(c.root.collection('processedOperations').doc(validId(sale.operationId,'Operação original')))).data();
      if(!originalMarker||originalMarker.eventKind!=='sale_exchange_credit'||originalMarker.checksum!==sale.exchangeCreditRequestHash||originalMarker.saleId!==saleId||originalMarker.businessId!==c.bid||originalMarker.spaceId!==c.spaceId||generation(originalMarker)!==generation(c.business))fail('failed-precondition','Recibo da venda original inconsistente.');
      const allocations=sale.exchangeCreditAllocations;
      if(!Array.isArray(allocations)||!allocations.length||allocations.length>100||new Set(allocations.map(a=>a.creditId)).size!==allocations.length||allocations.reduce((sum,a)=>sum+a.amountCents,0)!==sale.exchangeCreditUsedCents)fail('failed-precondition','Alocações de crédito inconsistentes.');
      const originalMovements=await tx.get(c.root.collection('stockMovements').where('operationId','==',sale.operationId).limit(81));
      if(originalMovements.size!==sale.itens.length||!Array.isArray(originalMarker.movementIds)||originalMarker.movementIds.length!==sale.itens.length)fail('failed-precondition','Movimentos originais inconsistentes.');
      const items=sale.itens.map(i=>({productId:i.produtoId,variantId:i.variantId||null,quantity:i.quantidade}));
      for(const [index,item]of items.entries()){const movement=originalMovements.docs.find(s=>s.id===originalMarker.movementIds[index])?.data();if(!movement||movement.vendaId!==saleId||movement.businessId!==c.bid||movement.spaceId!==c.spaceId||movement.produtoId!==item.productId||(movement.variantId||null)!==item.variantId||movement.quantidade!==-item.quantity)fail('failed-precondition','Movimento original não corresponde à venda.');}
      const stock=await stocksFor(tx,c,items,{restore:true}),credits=[];
      for(const [index,allocation]of allocations.entries()){
        validId(allocation.creditId,'Crédito');
        const ref=c.root.collection('exchangeCredits').doc(allocation.creditId),[creditSnap,eventSnap,restoreEvent]=await Promise.all([tx.get(ref),tx.get(c.root.collection('exchangeCreditEvents').doc(`${sale.operationId}_consume_${index}`)),tx.get(c.root.collection('exchangeCreditEvents').doc(`${operationId}_restore_${index}`))]);
        const credit=creditSnap.data(),event=eventSnap.data();
        if(!safeStock(allocation.amountCents)||allocation.amountCents===0||!credit||credit.businessId!==c.bid||credit.spaceId!==c.spaceId||credit.clientId!==c.clientId||generation(credit)!==generation(c.business)||!safeStock(credit.amountCents)||!safeStock(credit.remainingCents)||credit.remainingCents+allocation.amountCents>credit.amountCents||!['issued','exhausted'].includes(credit.status)||!event||event.kind!=='consumed'||event.saleId!==saleId||event.creditId!==allocation.creditId||event.amountCents!==allocation.amountCents||event.businessId!==c.bid||event.spaceId!==c.spaceId||event.clientId!==c.clientId||generation(event)!==generation(c.business)||restoreEvent.exists)fail('failed-precondition','Crédito ou comprovante de consumo inconsistente.');
        credits.push({ref,credit,allocation,index});
      }
      const now=Timestamp.now(),stamp={...scope(c),actorUid:c.uid,operationId,createdAt:now,updatedAt:now};
      const movementIds=updateStocks(tx,c,stock,operationId,saleId,now,true);
      for(const row of credits){const remainingCents=row.credit.remainingCents+row.allocation.amountCents,id=`${operationId}_restore_${row.index}`;tx.update(row.ref,{remainingCents,status:'issued',updatedAt:now});tx.create(c.root.collection('exchangeCreditEvents').doc(id),{...stamp,id,clientId:c.clientId,creditId:row.allocation.creditId,saleId,kind:'restored',amountCents:row.allocation.amountCents,balanceBeforeCents:row.credit.remainingCents,balanceAfterCents:remainingCents});}
      tx.update(saleRef,{status:'cancelado',reversedAt:now,cancelledAt:now,updatedAt:now,cancelOperationId:operationId,reversalOperationId:operationId,reversedAmount:sale.cashReceivedCents/100,updatedByUid:c.uid,exchangeCreditRestoredCents:sale.exchangeCreditUsedCents,version:FieldValue.increment(1)});
      tx.create(markerRef,{...stamp,id:operationId,idempotencyKey:operationId,eventKind:'sale_exchange_credit_cancel',saleId,status:'processed',checksum,movementIds,processedAt:now,schemaVersion:3});signal(tx,c,now);
      return {saleId,operationId,replayed:false,status:'cancelado',restoredCreditCents:sale.exchangeCreditUsedCents,stockChanges:stock.rows.map(r=>({productId:r.productId,variantId:r.variantId,stock:r.after}))};
    });
  }
  return {available,quote,confirm,cancel,status};
}
module.exports={creditService};
