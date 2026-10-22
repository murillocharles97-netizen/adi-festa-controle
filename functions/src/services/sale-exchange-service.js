'use strict';
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {Timestamp,FieldValue}=require('firebase-admin/firestore');
const {assertWritable,validId,belongsToWorkspace}=require('./workspace-reset-policy');
const {computeAccess}=require('./subscription-service');
const {stockKey}=require('./online-stock-reservation');
const {planExchange}=require('../shared/sale-exchange');
const Model=require('../shared/online-store');
const {allowsExchangeProduct}=require('../shared/exchange-product-scope');
const fail=(code,message)=>{throw new HttpsError(code,message);};
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
function saleExchangeService(db) {
  async function context(tx,request,mode='exchange') {
    const uid=request.auth?.uid;if(!uid)fail('unauthenticated','Entre na sua conta.');
    const d=request.data||{},bid=validId(d.businessId,'Empresa'),sid=validId(d.saleId,'Venda'),root=db.doc(`businesses/${bid}`);
    const [b,m,u,s]=await Promise.all([tx.get(root),tx.get(root.collection('members').doc(uid)),tx.get(db.doc(`users/${uid}`)),tx.get(root.collection('sales').doc(sid))]);
    const business=b.data(),member=m.data(),sale=s.data();
    if(!business||!member||u.data()?.active!==true||u.data()?.businessId!==bid||member.status!=='active')fail('permission-denied','Vínculo ativo obrigatório.');
    assertWritable(business,d.workspaceGeneration??0);
    if(!computeAccess(business.subscription||{}).canMutate)fail('permission-denied','Plano sem acesso operacional.');
    const owner=business.ownerId===uid&&member.role==='owner';
    // Until sales.exchange exists, require BOTH existing commercial grants.
    if(!owner&&!(member.permissions?.['sales.cancel']===true&&(mode==='undo'||member.permissions?.['sales.create']===true)))fail('permission-denied','A troca exige criar e cancelar vendas neste espaço.');
    if(!sale||sale.businessId!==bid||(sale.workspaceGeneration??0)!==(business.workspaceGeneration??0))fail('failed-precondition','Venda não confirmada nesta empresa ou geração.');
    validId(sale.spaceId,'Espaço');
    const space=(await tx.get(db.doc(`financialSpaces/${sale.spaceId}`))).data();
    if(!space||!belongsToWorkspace(space,bid)||space.active===false||space.capabilities?.sales!==true||(!owner&&member.spaceAccess!=='all'&&!member.allowedSpaceIds?.includes(sale.spaceId)))fail('permission-denied','Espaço não autorizado.');
    return {uid,bid,sid,root,business,member,sale,space,actorName:String(member.displayName||member.name||u.data()?.displayName||u.data()?.name||uid).slice(0,120)};
  }
  async function prepare(tx,c,input) {
    const summaryRef=c.root.collection('saleExchangeSummaries').doc(c.sid),summary=(await tx.get(summaryRef)).data()||{returned:{},count:0};
    const keys=new Map(),parents=new Map();
    const add=(id,variantId)=>{validId(id,'Produto');if(variantId)validId(variantId,'Variação');keys.set(`${id}:${variantId||''}`,{productId:id,variantId:variantId||null});};
    if(!Array.isArray(input.returns)||!Array.isArray(input.replacements)||input.returns.length>40||input.replacements.length>40)fail('invalid-argument','Itens inválidos.');
    for(const r of input.returns){const i=c.sale.itens?.[r.line];if(!i)fail('invalid-argument','Linha inválida.');add(i.produtoId,i.variantId);}
    input.replacements.forEach(i=>add(i.productId,i.variantId));
    const rows=[];
    for(const row of keys.values()) {
      let parent=parents.get(row.productId);
      if(!parent){const ref=c.root.collection('products').doc(row.productId),snap=await tx.get(ref);parent={ref,data:snap.data()};parents.set(row.productId,parent);}
      const p=parent.data;
      if(!p||p.businessId!==c.bid||(p.workspaceGeneration??0)!==(c.business.workspaceGeneration??0)||!allowsExchangeProduct(p,c.sale.spaceId)||p.spaceId&&p.spaceId!==c.sale.spaceId)fail('permission-denied','Produto não autorizado no espaço; cadastros legados ambíguos exigem associação explícita.');
      if(p.itemKind==='service'||p.productType==='recurring'||p.semControleEstoque||p.controlaEstoque===false)fail('failed-precondition','A V1 exige produto físico com controle de estoque.');
      const ref=row.variantId?c.root.collection('productVariants').doc(row.variantId):parent.ref,source=row.variantId?(await tx.get(ref)).data():p;
      if(!source||row.variantId&&(source.parentProductId!==row.productId||source.businessId!==c.bid||(source.workspaceGeneration??0)!==(c.business.workspaceGeneration??0)||!Model.active(source)||source.spaceId&&source.spaceId!==c.sale.spaceId)||Boolean(row.variantId)!==(p.productType==='variable'))fail('failed-precondition','Variação inválida.');
      const held=(await tx.get(c.root.collection('onlineStockReservations').doc(stockKey(row)))).data(),reserved=held?held.quantity:0;
      if(held&&(!belongsToWorkspace(held,c.bid)||(held.workspaceGeneration??0)!==(c.business.workspaceGeneration??0)))fail('failed-precondition','Reserva de outro contexto.');
      const stock=Number(row.variantId?source.stock:p.estoqueAtual??p.estoque);
      if(!Number.isSafeInteger(stock)||stock<0||!Number.isSafeInteger(reserved)||reserved<0||Number(source.onlineReservedStock??0)!==reserved)fail('failed-precondition','Estoque ou reserva inconsistente.');
      rows.push({...row,ref,stock,reserved,price:row.variantId?source.price:p.preco,name:p.nome||row.productId,variantName:source.displayName||'',incoming:0,outgoing:0});
    }
    let plan;try{plan=planExchange(c.sale,input,summary.returned,rows);}catch(e){fail('failed-precondition',e.message);}
    for(const r of plan.returns)if(r.restock)rows.find(x=>x.productId===r.productId&&x.variantId===r.variantId).incoming+=r.quantity;
    for(const r of plan.replacements)rows.find(x=>x.productId===r.productId&&x.variantId===r.variantId).outgoing+=r.quantity;
    for(const r of rows)if(!Number.isSafeInteger(r.stock+r.incoming-r.outgoing)||r.stock+r.incoming-r.outgoing<r.reserved)fail('failed-precondition','Estoque disponível insuficiente; reservas existentes foram preservadas.');
    if(plan.creditCents){const client=(await tx.get(c.root.collection('clients').doc(validId(c.sale.clienteId,'Cliente')))).data();if(!client||client.businessId&&client.businessId!==c.bid||(client.workspaceGeneration??0)!==(c.business.workspaceGeneration??0)||!Model.active(client)||client.spaceId&&client.spaceId!==c.sale.spaceId)fail('failed-precondition','Cliente original indisponível para emissão de crédito.');}
    // Recompute parent totals from all current active variants inside the transaction.
    let budget=400;
    for(const [id,p] of parents)if(p.data.productType==='variable'){
      const variants=(await tx.get(c.root.collection('productVariants').where('parentProductId','==',id).limit(budget+1))).docs;
      if(variants.length>budget)fail('failed-precondition','Limite de variações excedido.');budget-=variants.length;
      p.total=variants.filter(s=>Model.active(s.data())).reduce((n,s)=>{const v=s.data();if(!Number.isSafeInteger(v.stock)||v.stock<0||v.businessId!==c.bid||(v.workspaceGeneration??0)!==(c.business.workspaceGeneration??0))fail('failed-precondition','Agregado inválido.');return n+v.stock;},0)+rows.filter(r=>r.productId===id).reduce((n,r)=>n+r.incoming-r.outgoing,0);
    }
    const fingerprint=hash([c.sid,c.sale.spaceId,plan,summary.returned,rows.map(r=>[r.productId,r.variantId,r.stock,r.reserved])]);
    return {plan,rows,parents,summary,summaryRef,fingerprint};
  }
  async function quote(request){return db.runTransaction(async tx=>{const c=await context(tx,request),p=await prepare(tx,c,request.data);return {...p.plan,fingerprint:p.fingerprint,originalSaleId:c.sid,spaceId:c.sale.spaceId};});}
  async function confirm(request){
    const input=request.data||{},id=validId(input.operationId,'Operação'),requestHash=hash([input.saleId,input.returns,input.replacements,input.reason,input.paymentMethod||null,input.fingerprint]);
    return db.runTransaction(async tx=>{
      const c=await context(tx,request),ref=c.root.collection('saleExchanges').doc(id),marker=c.root.collection('processedOperations').doc(id);
      const [existing,processed]=await Promise.all([tx.get(ref),tx.get(marker)]);
      if(existing.exists){const e=existing.data();if(e.requestHash!==requestHash||e.actorUid!==c.uid||e.originalSaleId!==c.sid)fail('already-exists','Identificador utilizado por outra troca.');const receipt=processed.data();if(!receipt||receipt.eventKind!=='sale_exchange'||receipt.checksum!==requestHash||receipt.businessId!==c.bid||receipt.spaceId!==c.sale.spaceId)fail('failed-precondition','Recibo incompleto; revisão necessária.');return {id,replayed:true};}
      if(processed.exists)fail('already-exists','Identificador de outra operação.');
      // Containment build: committed receipts remain readable/idempotent, but
      // preserved or newly submitted attempts must never produce new effects.
      throw new HttpsError('failed-precondition','Novas trocas estão temporariamente pausadas. A tentativa original permanece preservada.',{reason:'exchange_new_commits_paused'});
      const p=await prepare(tx,c,input);
      if(input.fingerprint!==p.fingerprint)fail('failed-precondition','Estoque, preço ou troca anterior mudou. Revise novamente.');
      const now=Timestamp.now(),scope={businessId:c.bid,spaceId:c.sale.spaceId,workspaceGeneration:c.business.workspaceGeneration??0,actorUid:c.uid,operationId:id},event={...scope,id,originalSaleId:c.sid,requestHash,status:'completed',actorNameSnapshot:c.actorName,actorRoleSnapshot:c.member.role,createdAt:now,updatedAt:now,...p.plan};
      // New collections never flow through the sales/payments triggers.
      tx.create(ref,event);
      tx.create(c.root.collection('saleExchangeMetrics').doc(id),{...scope,id,originalSaleId:c.sid,status:'completed',createdAt:now,returnCents:p.plan.returnCents,newCents:p.plan.newCents,differenceCents:p.plan.differenceCents});
      const returned={...p.summary.returned};p.plan.returns.forEach(r=>{returned[r.line]=(returned[r.line]||0)+r.quantity;});
      tx.set(p.summaryRef,{...scope,returned,count:p.summary.count+1,updatedAt:now});
      for(const [index,r]of p.rows.entries()){
        let stock=r.stock;
        for(const [kind,delta]of [['exchange_return',r.incoming],['exchange_issue',-r.outgoing]])if(delta){const next=stock+delta,mid=`${id}_${index}_${kind}`;tx.create(c.root.collection('stockMovements').doc(mid),{...scope,id:mid,source:'sale_exchange',schemaVersion:3,exchangeId:id,vendaId:c.sid,produtoId:r.productId,variantId:r.variantId,tipo:kind,quantidade:delta,estoqueAnterior:stock,estoqueNovo:next,data:now,updatedAt:now});stock=next;}
        if(r.incoming||r.outgoing)tx.update(r.ref,r.variantId?{stock,updatedAt:now,version:FieldValue.increment(1)}:{estoqueAtual:stock,estoque:stock,totalStock:stock,updatedAt:now,version:FieldValue.increment(1)});
      }
      for(const parent of p.parents.values())if(parent.total!==undefined)tx.update(parent.ref,{totalStock:parent.total,estoqueAtual:parent.total,estoque:parent.total,updatedAt:now,version:FieldValue.increment(1)});
      if(p.plan.creditCents){tx.create(c.root.collection('exchangeCredits').doc(id),{...scope,id,exchangeId:id,clientId:c.sale.clienteId,amountCents:p.plan.creditCents,remainingCents:p.plan.creditCents,status:'issued',createdAt:now});tx.create(c.root.collection('exchangeCreditEvents').doc(`${id}_issued`),{...scope,id:`${id}_issued`,exchangeId:id,clientId:c.sale.clienteId,kind:'issued',creditId:id,amountCents:p.plan.creditCents,createdAt:now});}
      tx.create(marker,{...scope,id,idempotencyKey:id,status:'processed',eventKind:'sale_exchange',checksum:requestHash,processedAt:now,schemaVersion:3});
      tx.set(c.root.collection('syncMetadata').doc('last-sync'),{businessId:c.bid,workspaceGeneration:c.business.workspaceGeneration??0,revision:now.toDate().toISOString(),updatedAt:now,changedCollections:['products','productVariants','stockMovements'],collectionVersions:Object.fromEntries(['products','productVariants','stockMovements'].map(n=>[n,now.toDate().toISOString()]))},{merge:true});
      return {id,replayed:false};
    });
  }
  const safeEvent=data=>{const {requestHash,...v}=data;return {...v,createdAt:v.createdAt.toDate().toISOString()};};
  async function list(request){return db.runTransaction(async tx=>{const c=await context(tx,request),q=await tx.get(c.root.collection('saleExchanges').where('originalSaleId','==',c.sid).limit(101)),summary=(await tx.get(c.root.collection('saleExchangeSummaries').doc(c.sid))).data();return {items:q.docs.slice(0,100).map(s=>safeEvent(s.data())),hasMore:q.size>100,remainingQuantities:c.sale.itens.map((i,n)=>Math.max(0,Number(i.quantidade)-(summary?.returned?.[n]||0)))};});}
  async function lookup(request){return db.runTransaction(async tx=>{const c=await context(tx,request),id=validId(request.data.operationId,'Operação');const [event,marker]=await Promise.all([tx.get(c.root.collection('saleExchanges').doc(id)),tx.get(c.root.collection('processedOperations').doc(id))]);if(!event.exists)return{found:false,retryAllowed:!marker.exists};const e=event.data();if(e.actorUid!==c.uid||e.originalSaleId!==c.sid||e.businessId!==c.bid||e.spaceId!==c.sale.spaceId||!marker.exists||marker.data().checksum!==e.requestHash)fail('permission-denied','Recibo de outra origem ou incompleto.');return {found:true,item:safeEvent(e)};});}
  async function adjustments(request){
    const uid=request.auth?.uid;if(!uid)fail('unauthenticated','Entre na sua conta.');const d=request.data||{},bid=validId(d.businessId,'Empresa'),spaceId=validId(d.spaceId,'Espaço');
    return db.runTransaction(async tx=>{const root=db.doc(`businesses/${bid}`),[b,m,u,s]=await Promise.all([tx.get(root),tx.get(root.collection('members').doc(uid)),tx.get(db.doc(`users/${uid}`)),tx.get(db.doc(`financialSpaces/${spaceId}`))]);const business=b.data(),member=m.data(),space=s.data();if(!business||!member||member.status!=='active'||u.data()?.active!==true||u.data()?.businessId!==bid)fail('permission-denied','Vínculo ativo obrigatório.');assertWritable(business,d.workspaceGeneration??0);const owner=business.ownerId===uid&&member.role==='owner';if(!owner&&member.permissions?.['sales.create']!==true&&member.permissions?.['sales.viewAll']!==true)fail('permission-denied','Consulta operacional não autorizada.');if(!space||!belongsToWorkspace(space,bid)||space.active===false||space.capabilities?.sales!==true||!owner&&member.spaceAccess!=='all'&&!member.allowedSpaceIds?.includes(spaceId))fail('permission-denied','Espaço não autorizado.');let q=root.collection('saleExchangeMetrics').where('spaceId','==',spaceId).orderBy('__name__').limit(201);if(d.cursor)q=q.startAfter(validId(d.cursor,'Página'));const rows=await tx.get(q);return {businessId:bid,workspaceGeneration:business.workspaceGeneration??0,items:rows.docs.slice(0,200).filter(r=>(r.data().workspaceGeneration??0)===(business.workspaceGeneration??0)).map(r=>({...r.data(),createdAt:r.data().createdAt.toDate().toISOString()})),nextCursor:rows.size>200?rows.docs[199].id:null};});
  }
  async function checkUndo(request){return db.runTransaction(async tx=>{const c=await context(tx,request,'undo'),summary=await tx.get(c.root.collection('saleExchangeSummaries').doc(c.sid));return {allowed:!summary.exists&&c.sale.source!=='exchange_credit_checkout',reason:summary.exists?'sale-has-exchanges':c.sale.source==='exchange_credit_checkout'?'exchange-credit-tender':null};});}
  return {quote,confirm,list,lookup,adjustments,checkUndo};
}
module.exports={saleExchangeService};
