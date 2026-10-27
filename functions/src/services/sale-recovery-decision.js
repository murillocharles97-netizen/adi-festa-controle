'use strict';

const {HttpsError}=require('firebase-functions/v2/https');
const {createHash}=require('node:crypto');
const {Timestamp}=require('firebase-admin/firestore');
const Model=require('../shared/online-store');
const {stockKey}=require('./online-stock-reservation');
const {computeAccess}=require('./subscription-service');
const {belongsToWorkspace}=require('./workspace-reset-policy');
const {paidClientPlan}=require('./sale-recovery-customer');
const fail=message=>{throw new HttpsError('failed-precondition',message);};
const number=value=>typeof value==='number'&&Number.isFinite(value);
const key=i=>`${i.productId||i.produtoId}:${i.variantId||''}`;
const costs=['custo','cost','custoUnitario','costSnapshot','custoTotal','lucro','costUnit'];
const operational=value=>Object.fromEntries(Object.entries(value).filter(([k])=>!costs.includes(k)));

// NOT a generic Admin replay engine. Only the reviewed, paid manual-sale shape
// below is executable. Unknown auxiliary effects must stay held for review.
function recoveryPlan(v){
  const {sale,packet,items,saleId,operationId}=v,writes=packet.payload.writes;
  if(packet.payload.eventKind!=='sale'||sale.status!=='pago'||!['dinheiro','pix','cartao','pago'].includes(sale.formaPagamento)||sale.onlineOrderId||sale.catalogOrderId||sale.paymentIntentId||sale.paymentMetadata||sale.deletedAt||sale.active===false||sale.reversedAt)
    fail('Esta modalidade exige revisão técnica específica. Nenhum efeito foi aplicado.');
  if((sale.appliedCampaignIds||[]).length)fail('Venda com campanha precisa de revisão específica; seus efeitos não serão ignorados.');
  if(items.length>40||new Set(items.map(key)).size!==items.length)fail('Itens repetidos ou limite excedido. O original permanece preservado.');
  const sum=items.reduce((total,i)=>total+i.quantity*i.unitPrice,0);
  if(items.some(i=>i.quantity>999)||Math.abs(sum-v.total)>0.011)fail('O valor e as quantidades não conferem com os itens originais.');
  const clientPlan=paidClientPlan(v);
  const supported=new Set(['sales','stockMovements','products','productVariants',...(clientPlan?['clients']:[])]);
  if(writes.some(w=>!supported.has(w.entityType)))fail('O pacote contém efeitos auxiliares que exigem revisão técnica. Nenhum dado foi alterado.');
  if(new Set(writes.map(w=>`${w.entityType}:${w.entityId}`)).size!==writes.length)fail('O pacote possui gravações repetidas.');
  const movements=writes.filter(w=>w.entityType==='stockMovements');
  for(const w of movements){
    const m=w.data,item=items.find(i=>key(i)===key(m));
    if(w.operation!=='create'||m.id&&m.id!==w.entityId||!item||m.vendaId!==saleId||m.operationId!==operationId||m.quantidade!==-item.quantity||!number(m.estoqueAnterior)||!number(m.estoqueNovo)||m.estoqueAnterior-m.estoqueNovo!==item.quantity||m.tipo&&m.tipo!=='saida_venda')fail('Os movimentos não correspondem integralmente à venda original.');
  }
  if(new Set(movements.map(w=>key(w.data))).size!==movements.length)fail('Movimentos duplicados no original.');
  // Verify the captured stock deltas, but NEVER write its stale absolute values.
  for(const w of writes.filter(w=>['products','productVariants'].includes(w.entityType))){
    if(w.operation!=='update'||!w.before)fail('Snapshot de estoque incompleto.');
    const selected=items.filter(i=>w.entityType==='products'?i.productId===w.entityId:i.variantId===w.entityId);
    if(!selected.length)fail('Produto auxiliar não pertence à venda.');
    const fields=w.entityType==='products'?['estoqueAtual','estoque','totalStock']:['stock'];
    const quantity=selected.reduce((sum,i)=>sum+i.quantity,0);
    // An update is a partial patch, not a replacement snapshot. Omitted fields
    // retain the captured value; explicit null/non-numeric values remain invalid.
    const effective={...w.before,...w.data};let changed=false;
    for(const field of fields){
      if(w.data[field]===undefined&&w.before[field]===undefined)continue;
      if(!number(effective[field])||!number(w.before[field]))fail('Delta de estoque inválido.');
      const delta=effective[field]-w.before[field];
      if(delta!==0&&Math.abs(delta+quantity)>0.000001)fail('Delta de estoque diferente dos itens.');
      if(delta!==0)changed=true;
    }
    if(!changed)fail('Patch sem a baixa de estoque correspondente aos itens.');
  }
  return{movements,clientPlan};
}

async function prepareRecoveredSale({db,tx,c,space,v,FieldValue}){
  const plan=recoveryPlan(v),root=db.doc(`businesses/${c.businessId}`),generation=c.business.workspaceGeneration??0;
  if(!computeAccess(c.business.subscription||{}).canMutate||space.capabilities?.sales!==true)fail('O plano ou espaço não permite registrar esta venda agora.');
  const originalActor=(await tx.get(root.collection('members').doc(v.sale.actorUid))).data();
  const profile=(await tx.get(db.doc(`users/${v.sale.actorUid}`))).data();
  if(!originalActor||originalActor.status!=='active'||profile?.active!==true||originalActor.role!=='owner'&&originalActor.permissions?.['sales.create']!==true||originalActor.role!=='owner'&&originalActor.spaceAccess!=='all'&&!originalActor.allowedSpaceIds?.includes(v.spaceId))fail('O ator original não possui vínculo/permissão no espaço.');
  let recoveredClient=null;
  if(plan.clientPlan){
    const cp=plan.clientPlan,clientRef=root.collection('clients').doc(cp.clientId),client=await tx.get(clientRef),data=client.data();
    if(!client.exists)fail('Cliente não confirmado. Na conta de origem atualizada, use Enviar dados para recuperação e confirme; depois o responsável deve aprovar o cadastro antes de recuperar a venda.');
    if(data.businessId!==c.businessId||(data.workspaceGeneration??0)!==generation||data.deletedAt||data.active===false||data.ativo===false)fail('O cliente original não está ativo nesta empresa/geração. Nenhuma venda foi recuperada.');
    if(cp.dependency){
      const ack=(await tx.get(root.collection('saleRecoveryOperations').doc(cp.dependency.operationId))).data();
      if(data.customerRecoveryHash!==cp.dependency.payloadHash||ack?.kind!=='client_dependency'||ack.status!=='client_confirmed'||ack.clientId!==cp.clientId||ack.actorUid!==v.sale.actorUid||ack.payloadHash!==cp.dependency.payloadHash||ack.businessId!==c.businessId||ack.spaceId!==v.spaceId||ack.workspaceGeneration!==generation)fail('Confirme primeiro a dependência de cadastro pelo responsável. Nenhuma venda foi recuperada.');
    }
    if(!number(data.totalComprado)||data.totalComprado<0||!Number.isSafeInteger(data.quantidadeVendas)||data.quantidadeVendas<0)fail('Projeção atual do cliente inconsistente.');
    recoveredClient={ref:clientRef,data};
  }
  const stock=[],parents=new Map();
  for(const productId of new Set(v.items.map(i=>i.productId))){
    const ref=root.collection('products').doc(productId),p=(await tx.get(ref)).data();
    if(!p||p.businessId!==c.businessId||(p.workspaceGeneration??0)!==generation||!Model.allows(p,v.spaceId)||p.spaceId&&p.spaceId!==v.spaceId)fail('Produto indisponível ou de outro espaço/empresa.');
    parents.set(productId,{ref,data:p,delta:0,variant:false});
  }
  for(const item of v.items){
    const parent=parents.get(item.productId),product=parent.data;
    if(product.productType==='recurring')fail('Produto recorrente exige revisão específica.');
    let source=product,ref=parent.ref,field='estoqueAtual';
    if(item.variantId){
      ref=root.collection('productVariants').doc(item.variantId);source=(await tx.get(ref)).data();field='stock';parent.variant=true;
      if(product.productType!=='variable'||!Model.active(source)||source.parentProductId!==item.productId||source.businessId!==c.businessId||(source.workspaceGeneration??0)!==generation||source.spaceId&&source.spaceId!==v.spaceId)fail('Variação não corresponde ao produto/espaço original.');
    }else if(product.productType==='variable')fail('Variação obrigatória ausente.');
    const movement=plan.movements.find(w=>key(w.data)===key(item));
    const controls=product.itemKind!=='service'&&!product.semControleEstoque&&product.controlaEstoque!==false;
    if(!controls){if(movement)fail('O modo de controle de estoque mudou desde a venda. Revise antes de recuperar.');continue;}
    if(!movement)fail('Movimento original ausente. Não serão gerados novos IDs.');
    const stockValue=source[field],held=(await tx.get(root.collection('onlineStockReservations').doc(stockKey(item)))).data();
    const reserved=Number(held?.quantity||0),onSource=Number(source.onlineReservedStock||0);
    if(!number(stockValue)||!number(reserved)||reserved<0||reserved!==onSource||held&&(!belongsToWorkspace(held,c.businessId)||(held.workspaceGeneration??0)!==generation))fail('Estoque/reserva inconsistente. Nenhum efeito foi aplicado.');
    // Recovery never forces negative stock, even when a normal sale permits it.
    if(stockValue-item.quantity<reserved)fail(`Estoque disponível insuficiente para ${item.name}. A reserva existente foi preservada.`);
    stock.push({ref,field,before:stockValue,after:stockValue-item.quantity,item,movement,source});parent.delta+=item.quantity;
  }
  if(stock.length!==plan.movements.length)fail('Os movimentos originais não conferem com o estoque atual.');
  // Include any non-standard receipt under this op/sale, not only expected IDs.
  const [sale,marker,byOp,bySale,financial,...financialEvidence]=await Promise.all([
    tx.get(root.collection('sales').doc(v.saleId)),tx.get(root.collection('processedOperations').doc(v.operationId)),
    tx.get(root.collection('stockMovements').where('operationId','==',v.operationId).limit(351)),
    tx.get(root.collection('stockMovements').where('vendaId','==',v.saleId).limit(351)),
    tx.get(root.collection('saleFinancials').doc(v.saleId)),
    tx.get(db.doc(`financialSpaces/${v.spaceId}/entries/sale_${v.saleId}`)),
    tx.get(root.collection('financialIncomeRoutes').doc(createHash('sha256').update(`sale:${v.saleId}`).digest('hex'))),
    ...plan.movements.map(w=>tx.get(root.collection('stockMovementFinancials').doc(w.entityId))),
  ]);
  const expected=await Promise.all(plan.movements.map(w=>tx.get(root.collection('stockMovements').doc(w.entityId))));
  if(sale.exists||marker.exists||!byOp.empty||!bySale.empty||financial.exists||expected.some(s=>s.exists)||financialEvidence.some(s=>s.exists))fail('Já existem efeitos ou IDs na nuvem. Não será feita recuperação parcial ou segunda baixa.');
  if(recoveredClient)for(const collection of ['payments','balanceEvents','balanceAdjustments']){
    const evidence=await tx.get(root.collection(collection).where('operationId','==',v.operationId).limit(1));
    if(!evidence.empty)fail('Já existe efeito financeiro da operação original. A recuperação foi interrompida.');
  }
  // Parent aggregate must be recomputed from current variants, not old snapshots.
  let variantBudget=500;
  for(const [id,p]of parents)if(p.variant){
    const variants=(await tx.get(root.collection('productVariants').where('parentProductId','==',id).limit(variantBudget+1))).docs;
    if(variants.length>variantBudget)fail('Muitas variações para recuperação segura em uma única transação.');variantBudget-=variants.length;
    p.total=variants.filter(s=>Model.active(s.data())).reduce((sum,s)=>{
      const variant=s.data();
      if(!number(variant.stock)||variant.businessId!==c.businessId||(variant.workspaceGeneration??0)!==generation)fail('Estoque ou origem de variação inválidos.');return sum+variant.stock;
    },0)-p.delta;
    if(p.total<0)fail('Resumo de estoque das variações inconsistente.');
  }
  const at=Timestamp.now(),stamp={businessId:c.businessId,spaceId:v.spaceId,workspaceGeneration:generation,updatedAt:at},canonical={ownerId:v.sale.actorUid,updatedByUid:c.uid,schemaVersion:3,version:1,idempotencyKey:v.operationId,action:'create'},saleData={...operational(v.sale),id:v.saleId,operationId:v.operationId,...stamp,...canonical,entityType:'sales',
    itens:v.sale.itens.map(operational),createdAt:v.sale.createdAt||v.originalSaleAt,
    recoveredFromReview:true,recoveryContentHash:v.contentHash,recoveredAt:at,recoveredByUid:c.uid};
  return{movementIds:plan.movements.map(w=>w.entityId),commit(){
    if(recoveredClient){
      const before=recoveredClient.data,previous=before.ultimaCompra||'',last=String(previous)>v.originalSaleAt?previous:v.originalSaleAt;
      tx.update(recoveredClient.ref,{totalComprado:Math.round((before.totalComprado+v.total)*100)/100,quantidadeVendas:before.quantidadeVendas+1,ultimaCompra:last,updatedAt:at,atualizadoEm:at,version:FieldValue.increment(1)});
    }
    for(const change of stock){
      const update={[change.field]:change.after,updatedAt:at,version:FieldValue.increment(1)};
      if(change.field==='estoqueAtual'&&Object.hasOwn(change.source,'estoque'))update.estoque=change.after;
      if(change.field==='estoqueAtual'&&Object.hasOwn(change.source,'totalStock'))update.totalStock=change.after;
      tx.update(change.ref,update);
      tx.create(root.collection('stockMovements').doc(change.movement.entityId),{...operational(change.movement.data),...stamp,...canonical,entityType:'stockMovements',id:change.movement.entityId,tipo:'saida_venda',actorUid:v.sale.actorUid,
        estoqueAnterior:change.before,estoqueNovo:change.after,data:change.movement.data.data||v.originalSaleAt,recoveredAt:at,recoveredByUid:c.uid});
    }
    for(const p of parents.values())if(p.variant)tx.update(p.ref,{totalStock:p.total,estoqueAtual:p.total,estoque:p.total,updatedAt:at,version:FieldValue.increment(1)});
    tx.create(root.collection('sales').doc(v.saleId),saleData);
    tx.create(root.collection('processedOperations').doc(v.operationId),{id:v.operationId,idempotencyKey:v.operationId,businessId:c.businessId,spaceId:v.spaceId,ownerId:c.uid,actorUid:v.sale.actorUid,status:'processed',eventKind:'sale',schemaVersion:3,workspaceGeneration:generation,processedAt:at,createdAtLocal:v.originalSaleAt,recoveryContentHash:v.contentHash});
    // Same incremental Sync signal as canonical cloud writes; no replay job.
    const names=['sales','products','productVariants','stockMovements',...(recoveredClient?['clients']:[])];
    tx.set(root.collection('syncMetadata').doc('last-sync'),{businessId:c.businessId,publisher:'operational_server',sourceUid:c.uid,actorUid:c.uid,sourceDeviceId:FieldValue.delete(),sourceSessionId:'server:recovery:'+v.operationId,revision:'server:recovery:'+v.operationId,updatedAt:at,changedCollections:names,collectionVersions:Object.fromEntries(names.map(n=>[n,at.toDate().toISOString()]))},{merge:true});
  }};
}
module.exports={recoveryPlan,prepareRecoveredSale};
