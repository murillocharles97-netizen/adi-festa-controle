'use strict';
const {createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {Timestamp,FieldValue}=require('firebase-admin/firestore');
const {assertWritable,validId,belongsToWorkspace}=require('./workspace-reset-policy');
const {computeAccess}=require('./subscription-service');
const {allowsExchangeProduct}=require('../shared/exchange-product-scope');
const {stockKey}=require('./online-stock-reservation');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const gen=v=>v?.workspaceGeneration??0;
const cents=v=>Math.round(Number(v)*100);
const fail=(message,reason='cancellation-review-required')=>{throw new HttpsError('failed-precondition',message,{reason});};
const invalid=new Set(['cancelado','cancelada','cancelled','canceled','desfeito','desfeita','venda_desfeita','estornado','estornada','refunded','conflict']);
const cancelled=s=>s.active===false||s.ativo===false||s.deletedAt||s.cancelOperationId||s.cancelledAt||s.reversedAt||invalid.has(String(s.status||'').toLowerCase());
const time=v=>v?.toMillis?.()??Date.parse(v||'');
const operationFor=(bid,generation,sid)=>'cancel_sale_'+hash([bid,generation,sid]).slice(0,40);

function saleCancellationService(db,{projectFinancial=null,allowNewCancellations=true}={}){
 async function context(tx,request){
  const uid=request.auth?.uid;if(!uid)throw new HttpsError('unauthenticated','Entre na sua conta.');
  const d=request.data||{},bid=validId(d.businessId,'Empresa'),sid=validId(d.saleId,'Venda'),spaceId=validId(d.spaceId,'Espaço'),root=db.doc(`businesses/${bid}`);
  const [bs,ms,us,ss,ps]=await Promise.all([tx.get(root),tx.get(root.collection('members').doc(uid)),tx.get(db.doc(`users/${uid}`)),tx.get(root.collection('sales').doc(sid)),tx.get(db.doc(`financialSpaces/${spaceId}`))]);
  const business=bs.data(),member=ms.data(),user=us.data(),sale=ss.data(),space=ps.data();
  if(!business||member?.status!=='active'||user?.active!==true||user.businessId!==bid)throw new HttpsError('permission-denied','Vínculo ativo obrigatório.');
  assertWritable(business,d.workspaceGeneration??0);
  if(!computeAccess(business.subscription||{}).canMutate)throw new HttpsError('permission-denied','Plano sem acesso operacional.');
  const owner=business.ownerId===uid&&member.role==='owner';
  if(!owner&&member.permissions?.['sales.cancel']!==true)throw new HttpsError('permission-denied','Sem permissão para cancelar vendas.');
  if(!space||!belongsToWorkspace(space,bid)||space.active===false||space.capabilities?.sales!==true||!owner&&member.spaceAccess!=='all'&&!member.allowedSpaceIds?.includes(spaceId))throw new HttpsError('permission-denied','Espaço não autorizado.');
  if(!sale||sale.businessId!==bid||sale.spaceId!==spaceId||gen(sale)!==gen(business))fail('Venda não confirmada nesta empresa, espaço ou geração.');
  return{uid,bid,sid,spaceId,root,business,member,sale,space,operationId:operationFor(bid,gen(business),sid)};
 }
 const scoped=(value,c)=>value&&value.businessId===c.bid&&gen(value)===gen(c.business)&&(!value.spaceId||value.spaceId===c.spaceId);
 async function prepare(tx,c){
  const s=c.sale;
  if(typeof s.operationId!=='string'||!s.operationId)fail('A origem da venda não pôde ser comprovada. Revisão necessária.');
  if(cancelled(s))fail('Esta venda já foi cancelada. Nenhum novo estorno será aplicado.','sale-already-cancelled');
  if(s.onlineOrderId||s.source==='online_store')fail('Venda de pedido online exige devolução específica; o pedido e suas reservas foram preservados.');
  if(s.paymentIntentId||s.formaPagamento==='cartao_presencial'||s.paymentMetadata?.channel==='card_present')fail('Pagamento integrado exige estorno pelo provedor. Este fluxo não realiza reembolso automático.');
  if(s.source==='exchange_credit_checkout'||Number(s.exchangeCreditUsedCents||0)>0||s.tender?.kind==='exchange_credit')fail('Esta venda consumiu crédito de troca. Use o cancelamento dedicado que restaura exatamente o crédito; não é permitido um segundo estorno por este fluxo.','exchange-credit-tender');
  const [summary,exchange,allocations,campaigns,originalMoves]=await Promise.all([
   tx.get(c.root.collection('saleExchangeSummaries').doc(c.sid)),tx.get(c.root.collection('saleExchanges').where('originalSaleId','==',c.sid).limit(1)),
   tx.get(c.root.collection('paymentAllocations').where('saleId','==',c.sid).limit(1)),tx.get(c.root.collection('campaignEvents').where('sourceId','==',c.sid).limit(1)),
   tx.get(c.root.collection('stockMovements').where('vendaId','==',c.sid).limit(81)),
  ]);
  if(summary.exists||!exchange.empty)fail('Esta venda tem troca registrada. A venda original e os créditos precisam ser preservados.','sale-has-exchanges');
  if((s.campaignUpdates||[]).length||(s.appliedCampaignIds||[]).length||s.itens?.some(i=>(i.campaignDiscounts||[]).length)||!campaigns.empty)fail('Esta venda possui campanha ou benefício vinculado. Use a resolução administrativa específica; nenhum benefício foi alterado.');
  if((s.subscriptionUpdates||[]).length||s.itens?.some(i=>i.productType==='recurring'||i.recurringActivation))fail('Esta venda possui renovação vinculada. A vigência exige revisão específica antes do cancelamento.');
  const amountCents=cents(s.valorFinal??s.valorTotal),isCredit=s.formaPagamento==='fiado'||s.status==='fiado';
  if(!Number.isSafeInteger(amountCents)||amountCents<=0||!['pago','applied','fiado','paid'].includes(String(s.status||'')))fail('Valor ou situação da venda exige conferência antes do cancelamento.');
  if(!isCredit&&!['dinheiro','pix','cartao','pago'].includes(s.formaPagamento))fail('Forma de pagamento não suportada por este cancelamento.');
  if(!allocations.empty||Number(s.creditPaidAmount||0)!==0||s.creditSettled===true)fail('Esta venda possui recebimento vinculado ou inconsistente. É necessária conciliação; nenhum recebimento será estornado.','sale-has-receipts');
  const items=new Map();
  if(!Array.isArray(s.itens)||!s.itens.length||s.itens.length>40)fail('Itens da venda incompletos.');
  for(const i of s.itens){const productId=validId(i.produtoId||i.productId,'Produto'),variantId=i.variantId?validId(i.variantId,'Variação'):null,q=Number(i.quantidade??i.quantity);if(!Number.isSafeInteger(q)||q<=0)fail('Quantidade da venda inválida.');const key=productId+':'+(variantId||''),previous=items.get(key);items.set(key,{productId,variantId,quantity:q+(previous?.quantity||0),itemKind:i.itemKind});}
  if(originalMoves.size>80)fail('Movimentos da venda excedem o limite seguro.');
  const debits=new Map();
  for(const doc of originalMoves.docs){const m=doc.data(),key=m.produtoId+':'+(m.variantId||'');if(!scoped(m,c)||m.spaceId!==c.spaceId||m.operationId!==s.operationId||m.tipo!=='saida_venda'||!Number.isSafeInteger(m.quantidade)||m.quantidade>=0||!items.has(key))fail('Os movimentos originais não conferem ou já existe uma devolução. Nenhum estoque foi alterado.');debits.set(key,(debits.get(key)||0)-m.quantidade);}
  const parents=new Map(),rows=[];
  for(const [key,i]of items){
   let parent=parents.get(i.productId);if(!parent){const ref=c.root.collection('products').doc(i.productId);parent={ref,data:(await tx.get(ref)).data(),delta:0};parents.set(i.productId,parent);}
   const p=parent.data;if(!scoped(p,c)||!allowsExchangeProduct(p,c.spaceId)||p.spaceId&&p.spaceId!==c.spaceId)fail('Produto sem vínculo inequívoco com este espaço. Revise o cadastro, sem alterar o estoque.');
   const nonStock=p.itemKind==='service'||p.semControleEstoque===true||p.controlaEstoque===false;
   if(nonStock){if(debits.has(key))fail('O controle de estoque mudou desde a venda; revisão necessária.');continue;}
   if(debits.get(key)!==i.quantity)fail('Baixa original não comprovada integralmente. Não será criada uma devolução presumida.');
   if(Boolean(i.variantId)!==(p.productType==='variable'))fail('A estrutura de variações mudou desde a venda.');
   const ref=i.variantId?c.root.collection('productVariants').doc(i.variantId):parent.ref,v=i.variantId?(await tx.get(ref)).data():p;
   if(!scoped(v,c)||i.variantId&&(v.parentProductId!==i.productId||v.active===false||v.ativo===false||v.deletedAt))fail('Variação não corresponde à venda ou exige revisão.');
   const held=(await tx.get(c.root.collection('onlineStockReservations').doc(stockKey(i)))).data(),reserved=held?.quantity??0,stock=i.variantId?v.stock:p.estoqueAtual??p.estoque;
   if(!Number.isSafeInteger(stock)||stock<0||!Number.isSafeInteger(reserved)||reserved<0||reserved>stock||Number(v.onlineReservedStock??0)!==reserved||held&&!scoped(held,c)||!Number.isSafeInteger(stock+i.quantity))fail('Estoque ou reserva inconsistente. Nenhum snapshot antigo será restaurado.');
   parent.delta+=i.quantity;rows.push({...i,ref,before:stock,after:stock+i.quantity,reserved});
  }
  let budget=350;
  for(const [id,p]of parents)if(p.data.productType==='variable'&&p.delta){const variants=await tx.get(c.root.collection('productVariants').where('parentProductId','==',id).limit(budget+1));if(variants.size>budget)fail('Limite seguro de variações excedido.');budget-=variants.size;p.total=variants.docs.filter(d=>d.data().active!==false&&!d.data().deletedAt).reduce((n,d)=>{const v=d.data();if(!scoped(v,c)||!Number.isSafeInteger(v.stock)||v.stock<0)fail('Agregado de variações inconsistente.');return n+v.stock;},0)+p.delta;}
  let client=null,debit=null;
  const reversalRef=c.root.collection('balanceEvents').doc('credit_sale_reversal:'+c.sid),oldReversal=await tx.get(reversalRef);
  if(oldReversal.exists||s.financialReversalEventId)fail('Já existe estorno financeiro desta venda. Conferência necessária.');
  if(isCredit){
   const id=validId(s.clienteId||s.customerId,'Cliente'),ref=c.root.collection('clients').doc(id),debitRef=c.root.collection('balanceEvents').doc('credit_sale:'+c.sid);
   const [cs,ds,events]=await Promise.all([tx.get(ref),tx.get(debitRef),tx.get(c.root.collection('balanceEvents').where('customerId','==',id).limit(301))]);
   const value=cs.data();debit=ds.data();
   if(!scoped(value,c)||!scoped(debit,c)||debit.type!=='credit_sale'||debit.status!=='applied'||debit.sourceDocumentId!==c.sid||String(debit.customerId||debit.clientId)!==id||cents(debit.balanceDelta)!==-amountCents||cents(debit.amount)!==amountCents)fail('O débito original do Fiado não pôde ser comprovado.');
   const debitAt=time(debit.appliedAt||debit.createdAt||s.data);if(!Number.isFinite(debitAt)||events.size>300)fail('Histórico financeiro exige conciliação.');
   if(events.docs.some(d=>{const e=d.data(),at=time(e.appliedAt||e.createdAt);return e.type!=='credit_sale'&&(!Number.isFinite(at)||at>=debitAt);} ))fail('Existem recebimentos, ajustes ou estornos posteriores ou sem data comprovada. É necessária conciliação; eles não serão alterados.','later-customer-financial-event');
   const balance=cents(value.saldo),version=value.financialVersion;
   if(!Number.isSafeInteger(balance)||balance+amountCents>0||!Number.isSafeInteger(version)||version<Number(s.financialVersionAnterior||0)+1||s.creditRemainingAmount!=null&&cents(s.creditRemainingAmount)!==amountCents)fail('O saldo ou débito restante exige conciliação.');
   client={id,ref,value,balanceBefore:balance,balanceAfter:balance+amountCents,version};
  }
  const fingerprint=hash([c.bid,c.spaceId,gen(c.business),c.sid,s.operationId,s.status,s.version,time(s.updatedAt)||null,amountCents,rows.map(r=>[r.productId,r.variantId,r.before,r.after,r.reserved]),client&&[client.balanceBefore,client.version]]);
  return{rows,parents,amountCents,isCredit,client,debit,reversalRef,fingerprint};
 }
 async function preview(request){return db.runTransaction(async tx=>{const c=await context(tx,request);if(!allowNewCancellations)fail('Novos cancelamentos estão suspensos. Os comprovantes anteriores foram preservados.','cancellation-paused');const p=await prepare(tx,c);return{saleId:c.sid,operationId:c.operationId,spaceId:c.spaceId,fingerprint:p.fingerprint,amountCents:p.amountCents,paymentMethod:c.sale.formaPagamento,isCredit:p.isCredit,stockReturns:p.rows.map(r=>({productId:r.productId,variantId:r.variantId,quantity:r.quantity})),refundRequired:!p.isCredit,automaticRefund:false};});}
 async function confirm(request){
  const d=request.data||{},reason=String(d.reason||'').trim();if(reason.length<8||reason.length>400)throw new HttpsError('invalid-argument','Informe um motivo entre 8 e 400 caracteres.');
  if(d.confirmed!==true)throw new HttpsError('invalid-argument','Confirme o cancelamento.');
  const checksum=hash([d.businessId,d.workspaceGeneration??0,d.spaceId,d.saleId,d.operationId,d.fingerprint,reason,d.refundHandling]);
  const result=await db.runTransaction(async tx=>{
   const c=await context(tx,request);if(d.operationId!==c.operationId)throw new HttpsError('invalid-argument','Identificador de cancelamento inválido.');
   const markerRef=c.root.collection('processedOperations').doc(c.operationId),marker=await tx.get(markerRef);
   if(marker.exists){const m=marker.data();if(!scoped(m,c)||m.status!=='processed'||m.eventKind!=='sale_cancel'||m.checksum!==checksum||m.saleId!==c.sid||m.actorUid!==c.uid||m.spaceId!==c.spaceId||c.sale.cancelOperationId!==c.operationId||c.sale.status!=='cancelado'||c.sale.active!==false)fail('Este cancelamento já possui outro comprovante. Reabra a venda; não repita a operação.');return{saleId:c.sid,operationId:c.operationId,status:'cancelado',replayed:true,sale:c.sale};}
   if(!allowNewCancellations)fail('Novos cancelamentos estão suspensos. Nenhum efeito foi aplicado.','cancellation-paused');
   const p=await prepare(tx,c);if(d.fingerprint!==p.fingerprint)fail('A venda, saldo ou estoque mudou. Revise novamente antes de confirmar.','cancellation-state-changed');
   const refund=p.isCredit?'not_applicable':d.refundHandling;
   if(!p.isCredit&&!['external_refund_confirmed','not_due'].includes(refund))throw new HttpsError('invalid-argument','Confirme a devolução externa do pagamento ou que não há reembolso devido. A VECONI não devolve dinheiro automaticamente.');
   const now=Timestamp.now(),scope={businessId:c.bid,spaceId:c.spaceId,workspaceGeneration:gen(c.business),actorUid:c.uid,operationId:c.operationId},movementIds=[];
   for(const [index,r]of p.rows.entries()){const id=c.operationId+'_stock_'+index;movementIds.push(id);tx.create(c.root.collection('stockMovements').doc(id),{...scope,id,vendaId:c.sid,source:'sale_cancellation',tipo:'entrada_cancelamento_venda',produtoId:r.productId,variantId:r.variantId,quantidade:r.quantity,estoqueAnterior:r.before,estoqueNovo:r.after,reason,data:now,createdAt:now,updatedAt:now,schemaVersion:3});tx.update(r.ref,{...(r.variantId?{stock:r.after}:{estoqueAtual:r.after,estoque:r.after,totalStock:r.after}),updatedAt:now,version:FieldValue.increment(1)});}
   for(const parent of p.parents.values())if(parent.total!==undefined)tx.update(parent.ref,{totalStock:parent.total,estoqueAtual:parent.total,estoque:parent.total,updatedAt:now,version:FieldValue.increment(1)});
   const patch={status:'cancelado',active:false,cancelledAt:now,reversedAt:now,updatedAt:now,cancelOperationId:c.operationId,reversalOperationId:c.operationId,cancelledByUid:c.uid,cancellationReason:reason,cancellationMode:'canonical_transaction',refundHandling:refund,automaticRefund:false,updatedByUid:c.uid,version:FieldValue.increment(1)};
   if(p.client){const x=p.client,id='credit_sale_reversal:'+c.sid;tx.update(x.ref,{saldo:x.balanceAfter/100,financialVersion:x.version+1,updatedAt:now,atualizadoEm:now});tx.create(p.reversalRef,{...scope,id,idempotencyKey:id,type:'credit_sale_reversal',status:'applied',customerId:x.id,clientId:x.id,saleId:c.sid,sourceCollection:'sales',sourceDocumentId:c.sid,reversesEventId:'credit_sale:'+c.sid,amount:p.amountCents/100,balanceDelta:p.amountCents/100,balanceBefore:x.balanceBefore/100,balanceAfter:x.balanceAfter/100,financialVersionBefore:x.version,financialVersionAfter:x.version+1,reason,appliedAt:now,createdAt:now,schemaVersion:3});patch.financialReversalEventId=id;patch.financialReversedAt=now;}
   tx.update(c.root.collection('sales').doc(c.sid),patch);
   tx.create(markerRef,{...scope,id:c.operationId,eventKind:'sale_cancel',saleId:c.sid,status:'processed',checksum,reason,refundHandling:refund,automaticRefund:false,movementIds,actorRoleSnapshot:c.member.role,createdAt:now,processedAt:now,schemaVersion:3});
   tx.set(c.root.collection('syncMetadata').doc('last-sync'),{businessId:c.bid,workspaceGeneration:gen(c.business),revision:now.toDate().toISOString(),updatedAt:now,changedCollections:['sales','products','productVariants','stockMovements',...(p.isCredit?['clients','balanceEvents']:[])],collectionVersions:Object.fromEntries(['sales','products','productVariants','stockMovements',...(p.isCredit?['clients','balanceEvents']:[])].map(n=>[n,now.toDate().toISOString()]))},{merge:true});
   return{saleId:c.sid,operationId:c.operationId,status:'cancelado',replayed:false,sale:{...c.sale,...patch}};
  });
  let financialProjection='pending';
  if(projectFinancial){try{const r=await projectFinancial(request.data.businessId,result.saleId,result.sale);financialProjection=r?.created?'recorded':r?.entry||['finance-disabled','automation-disabled','original-missing','already-reversed'].includes(r?.skipped)?'not_required_or_recorded':'review_required';}catch{financialProjection='pending';}}
  return{saleId:result.saleId,operationId:result.operationId,status:result.status,replayed:result.replayed,financialProjection,automaticRefund:false};
 }
 return{preview,confirm};
}
module.exports={saleCancellationService,operationFor};
