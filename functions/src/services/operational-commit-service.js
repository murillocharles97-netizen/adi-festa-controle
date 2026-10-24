'use strict';

const {createHash}=require('node:crypto');
const {FieldValue}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const {assertWritable,validId,belongsToWorkspace}=require('./workspace-reset-policy');
const {computeAccess}=require('./subscription-service');
const Model=require('../shared/online-store');
const {stockKey}=require('./online-stock-reservation');
const execute=require('../shared/commercial-commit-engine');
const {validateEngagement}=require('./operational-engagement-validation');
const {operationalId}=require('../shared/operational-id');
const fail=(message,code='permission-denied')=>{throw new HttpsError(code,message);};
const cents=n=>{if(typeof n!=='number'||!Number.isFinite(n)||!Number.isSafeInteger(Math.round(n*100)))fail('Valor inválido.','invalid-argument');return Math.round(n*100);};
const canonical=v=>JSON.stringify((function sort(x){return Array.isArray(x)?x.map(sort):x&&typeof x==='object'?Object.fromEntries(Object.keys(x).sort().map(k=>[k,sort(x[k])])):x;})(v));
const digest=v=>createHash('sha256').update(canonical(v)).digest('hex');
const gen=v=>v?.workspaceGeneration??0;
const financialFields=['saldo','financialVersion','openBalance','financialRevision','financialReconciledAt'];
const stockFields=['estoqueAtual','estoque','totalStock','stock','onlineReservedStock','onlineOrderFinalizationId'];
const counterFields=['totalComprado','quantidadeVendas','ultimaCompra','legacyBalance','legacyBalanceRemaining','campaignFinanceVersion'];
const envelope=['id','businessId','ownerId','createdAt','updatedAt','updatedByUid','actorUid','actorNameSnapshot','actorRoleSnapshot','schemaVersion','version','workspaceGeneration','workspaceWriteId','operationId','idempotencyKey','action','entityType'];
const permissions={clients:'customers.edit',products:'products.edit',productVariants:'products.edit',settings:'settings.manage',campaigns:'reports.view',campaignProgress:'sales.create',campaignEvents:'sales.create',campaignRedemptions:'sales.create',rewards:'sales.create',customerSubscriptions:'sales.create',customerSubscriptionEvents:'sales.create',customerMetrics:'reports.view',customerMonthlyMetrics:'reports.view',customerSegments:'reports.view',visits:'reports.view',charges:'customers.edit',messageHistory:'customers.edit',messageTemplates:'customers.edit',messageSequences:'customers.edit',clientContacts:'customers.edit',productFinancials:'cost.view',variantFinancials:'cost.view',saleFinancials:'cost.view',stockMovementFinancials:'cost.view'};
const appendOnly=new Set(['stockMovements','balanceEvents','balanceAdjustments','campaignEvents','campaignRedemptions','paymentAllocations','customerSubscriptionEvents']);
const changed=(patch,before,fields)=>fields.filter(k=>Object.hasOwn(patch,k)&&canonical(patch[k])!==canonical(before?.[k]));
const numeric=(n,positive=false)=>typeof n==='number'&&Number.isFinite(n)&&(!positive||n>0);
const same=(a,b)=>Math.abs(Number(a)-Number(b))<0.000001;

// The caller supplies an intent/old offline envelope, NEVER an Admin write plan.
// The existing transaction arithmetic is buffered; these independent guards
// validate every actual read/write before ANY Admin write is flushed.
function operationalCommitService(db){
 const ref=(bid,col,id)=>db.doc(`businesses/${bid}/${col}/${id}`);
 async function context(tx,request,item,{readOnly=false}={}){
  const uid=request.auth?.uid;if(!uid)fail('Entre na sua conta.','unauthenticated');
  const bid=validId(request.data?.businessId,'Empresa');
  if(item.businessId!==bid||item.userId!==uid)fail('Origem da operação não autorizada.');
  const [bs,us,ms]=await Promise.all([tx.get(db.doc(`businesses/${bid}`)),tx.get(db.doc(`users/${uid}`)),tx.get(ref(bid,'members',uid))]);
  const business=bs.data(),user=us.data(),member=ms.data();
  if(business?.active!==true||user?.active!==true||user.businessId!==bid||ms.exists&&member.status!=='active')fail('Vínculo ativo obrigatório.');
  if(!ms.exists&&business.legacyAccessDisabled===true)fail('Vínculo empresarial obrigatório.');
  assertWritable(business,item.workspaceGeneration??0);
  const access=computeAccess(business.subscription||{});
  if(gen(business)!==gen(item)||!readOnly&&!access.canMutate)fail('Plano ou geração sem acesso de escrita.');
  const role=member?.role||user.role,owner=ms.exists?member.role==='owner':business.ownerId===uid&&role==='owner';
  // Legacy grants in editable profile maps are NOT an authorization source.
  // Only the immutable legacy role/canonical owner retains its previous duties.
  const legacyCashier=new Set(['sales.create','customers.view','customers.edit','customers.receiveDebt','products.view','inventory.view']);
  const has=p=>owner||(ms.exists?member.permissions?.[p]===true:role==='cashier'?legacyCashier.has(p):['admin','manager'].includes(role)&&p!=='exportCRM');
  const c={uid,bid,business,user,member,owner,role,has,access};
  c.space=async id=>{
   validId(id,'Espaço');const value=(await tx.get(db.doc(`financialSpaces/${id}`))).data();
   if(!value||!belongsToWorkspace(value,bid)||value.active===false||!owner&&member&&member.spaceAccess!=='all'&&!member.allowedSpaceIds?.includes(id))fail('Espaço não autorizado.');
   return value;
  };
  return c;
 }
 async function commit(request){
  const item=JSON.parse(JSON.stringify(request.data?.item||{}));
  if(Buffer.byteLength(JSON.stringify(item))>750*1024)fail('Operação excede o limite seguro.','invalid-argument');
  operationalId(item.operationId,'Operação');
  if(['quarantined','manual_review','archived','resolved'].includes(item.status)||item.quarantined||item.quarantine||item.resolution)fail('Operação preservada para revisão; replay bloqueado.','failed-precondition');
  const writes=item.payload?.writes;
  if(!Array.isArray(writes)||!writes.length||writes.length>350)fail('Envelope de operação inválido.','invalid-argument');
  const keys=new Set();
  for(const w of writes){
   operationalId(w.entityId,'Documento');
   if(typeof w.entityType!=='string'||!/^[A-Za-z]+$/.test(w.entityType)||!['create','update'].includes(w.operation)||!w.data||typeof w.data!=='object'||Array.isArray(w.data))fail('Gravação inválida.','invalid-argument');
   const key=w.entityType+':'+w.entityId;if(keys.has(key))fail('Documento repetido.','invalid-argument');keys.add(key);
   if(w.data.businessId&&w.data.businessId!==item.businessId||w.before?.businessId&&w.before.businessId!==item.businessId||w.data.workspaceGeneration!==undefined&&w.data.workspaceGeneration!==gen(item))fail('Documento de outra empresa/geração.');
   if(['processedOperations','balanceEvents','syncIncidentArchives','saleRecoveryReviews','saleExchanges','exchangeCredits','exchangeCreditEvents','saleExchangeSummaries','financialIncomeRoutes'].includes(w.entityType))fail('Documento canônico não pode ser fornecido pelo cliente.');
  }
  const originalPayload=JSON.stringify(item.payload),requestHash=digest(item.payload);
  return db.runTransaction(async tx=>{
   // Firestore can retry this callback. Derived canonical/concurrency fields
   // from an earlier attempt must never change the original request hash.
   item.payload=JSON.parse(originalPayload);
   const attemptWrites=item.payload.writes;
   const c=await context(tx,request,item),root=db.doc(`businesses/${c.bid}`),op=ref(c.bid,'processedOperations',item.operationId),hash=requestHash;
   for(const w of attemptWrites)if(w.operation==='create'&&w.data.actorUid&&w.data.actorUid!==c.uid)fail('Autoria de um evento novo deve corresponder à sessão autenticada.');
   const [prior,archive,review]=await Promise.all([tx.get(op),tx.get(ref(c.bid,'syncIncidentArchives',item.operationId)),tx.get(ref(c.bid,'saleRecoveryOperations',item.operationId))]);
   if(archive.exists||review.exists||prior.data()?.status==='archived_without_effects')fail('Operação arquivada/em revisão; replay bloqueado.','failed-precondition');
   if(prior.exists){
    const p=prior.data();
    if(p.ownerId!==c.uid&&p.actorUid!==c.uid||p.businessId!==c.bid||gen(p)!==gen(c.business)||p.requestHash&&p.requestHash!==hash)fail('Recibo de outra origem ou conteúdo.','already-exists');
    // Old receipts have no hash: do not trust them without the actual primary
    // event. No receipt/backfill is created by this check.
    if(!p.requestHash){const primary=writes.find(w=>['sales','payments','stockMovements','balanceAdjustments'].includes(w.entityType)&&w.operation==='create');const event=primary&&(await tx.get(ref(c.bid,primary.entityType,primary.entityId))).data();if(!event||event.operationId!==item.operationId)fail('Recibo legado exige revisão; nenhum efeito foi reaplicado.','failed-precondition');}
    return{replayed:true,operationId:item.operationId,outcome:null};
   }
   const before=new Map(),get=async reference=>{
    if(!reference.path.startsWith(`businesses/${c.bid}/`))fail('Leitura fora da empresa.');
    if(!before.has(reference.path))before.set(reference.path,await tx.get(reference));
    const s=before.get(reference.path);return{exists:()=>s.exists,data:()=>s.data(),id:s.id};
   };
   // Read current versions, including non-delta entities, before preparing writes.
   for(const w of writes){const s=await get(ref(c.bid,w.entityType,w.entityId));if(s.exists()&&(s.data().businessId&&s.data().businessId!==c.bid||gen(s.data())!==gen(c.business)))fail('Documento atual de outra origem.');}
   const plan=new Map(),buffer={get,set(reference,data){
    if(!reference.path.startsWith(`businesses/${c.bid}/`))fail('Gravação fora da empresa.');
    plan.set(reference.path,{ref:reference,data:{...(plan.get(reference.path)?.data||{}),...data}});
   }};
   const outcome=await execute({db,item,transaction:buffer,currentUser:{uid:c.uid},FieldValue,has:c.has,actor:{actorUid:c.uid,actorRoleSnapshot:c.role,actorNameSnapshot:c.member?.name||c.user.name||null}});
   await validate(tx,c,item,attemptWrites,plan,get,writes);
   if(!plan.size)return{operationId:item.operationId,outcome,replayed:false};
   const marker=plan.get(op.path);
   if(marker)Object.assign(marker.data,{requestHash:hash,actorUid:c.uid,workspaceGeneration:gen(c.business),authorizationVersion:1});
   for(const p of plan.values())tx.set(p.ref,{...p.data,workspaceGeneration:gen(c.business)},{merge:true});
   const names=[...new Set([...plan.values()].map(p=>p.ref.parent.id).filter(n=>n!=='processedOperations'))];
   if(names.length)tx.set(root.collection('syncMetadata').doc('last-sync'),{businessId:c.bid,workspaceGeneration:gen(c.business),revision:new Date().toISOString(),updatedAt:FieldValue.serverTimestamp(),changedCollections:names,collectionVersions:Object.fromEntries(names.map(n=>[n,new Date().toISOString()]))},{merge:true});
   return{operationId:item.operationId,outcome,replayed:false};
  });
 }
 async function validate(tx,c,item,writes,plan,get,originalWrites){
  const planned=(col,id)=>plan.get(ref(c.bid,col,id).path)?.data;
  const old=async(col,id)=>(await get(ref(c.bid,col,id))).data();
  const effective=async(col,id)=>({...await old(col,id),...planned(col,id)});
  const variantTotals=new Map();let variantBudget=350;
  async function variantTotal(pid){
   if(variantTotals.has(pid))return variantTotals.get(pid);
   const rows=await tx.get(ref(c.bid,'productVariants','__none__').parent.where('parentProductId','==',pid).limit(variantBudget+1));if(rows.size>variantBudget)fail('Limite seguro de variações excedido.','failed-precondition');variantBudget-=rows.size;
   const values=new Map(rows.docs.map(d=>[d.id,{...d.data(),...planned('productVariants',d.id)}]));
   for(const p of plan.values())if(p.ref.parent.id==='productVariants'&&p.data.parentProductId===pid&&!values.has(p.ref.id))values.set(p.ref.id,p.data);
   let total=0;for(const v of values.values())if(Model.active(v)){if(!numeric(v.stock)||v.stock<0&&!v.allowNegativeStock)fail('Estoque de variação inválido.');total+=v.stock;}
   variantTotals.set(pid,total);return total;
  }
  const events=writes.filter(w=>w.entityType==='sales'),createSales=events.filter(w=>w.operation==='create'),cancels=events.filter(w=>w.operation!=='create'&&(w.data.active===false||w.data.deletedAt));
  const payment=writes.find(w=>w.entityType==='payments'&&w.operation==='create'),adjust=writes.find(w=>w.entityType==='balanceAdjustments'&&w.operation==='create');
  if(events.length&&!createSales.length&&!cancels.length&&!payment)fail('Venda histórica é imutável; não existe ação comercial autorizada.');
  const requiredKind=createSales.length?'sale':cancels.length?'sale_undo':payment?'payment':adjust?'balance_adjustment':null;
  if(requiredKind&&item.payload.eventKind!==requiredKind)fail('Tipo da operação não corresponde ao efeito comercial.');
  if(!requiredKind&&['sale','sale_undo','payment','balance_adjustment','credit_sale'].includes(item.payload.eventKind))fail('Um recibo comercial exige o evento comercial correspondente.');
  if(createSales.length>1||cancels.length>1||[createSales.length>0,cancels.length>0,!!payment,!!adjust].filter(Boolean).length>1)fail('Mais de um efeito primário na operação.');
  let primary=createSales[0]||cancels[0]||payment||adjust,spaceId=primary?.data.spaceId||primary?.before?.spaceId||null;
  const deltas=new Map(),expectedClient=new Map();
  const add=(productId,variantId,delta)=>{const key=productId+':'+(variantId||'');deltas.set(key,(deltas.get(key)||0)+delta);};
  let sale=null,total=0,credit=false,original=null;
  if(createSales.length||cancels.length){
   sale=primary.data;original=cancels.length?await old('sales',primary.entityId):null;
   if(!c.has(cancels.length?'sales.cancel':'sales.create'))fail('Permissão de venda/cancelamento ausente.');
   if(original)sale={...original,...sale};
   spaceId=validId(sale.spaceId,'Espaço');const space=await c.space(spaceId);
   if(space.capabilities?.sales!==true||sale.financialSpaceId&&sale.financialSpaceId!==spaceId)fail('Vendas não habilitadas neste espaço.');
   const [review,summary,resolution]=await Promise.all([tx.get(ref(c.bid,'saleRecoveryReviews',primary.entityId)),tx.get(ref(c.bid,'saleExchangeSummaries',primary.entityId)),tx.get(ref(c.bid,'balanceAdjustments','legacy_reconciliation:'+primary.entityId))]);
   if(review.exists||summary.exists||resolution.data()?.resolutionStatus==='resolved_by_reconciliation'||sale.source==='exchange_credit_checkout'||Number(sale.exchangeCreditUsedCents||0)>0)fail('Venda com revisão/troca/crédito exige fluxo dedicado.','failed-precondition');
   if(cancels.length){
    if(!original||original.active===false||original.deletedAt||original.cancelledAt||original.cancellationMode==='canonical_transaction')fail('Venda já cancelada.','failed-precondition');
    // Exact allowlist: cancel permission is never an edit permission.
    if(changed(primary.data,original,Object.keys(primary.data)).some(k=>!envelope.includes(k)&&!['deletedAt','active','status','desfeita','cancelledAt','cancelOperationId','financialReversedAt','financialReversalEventId'].includes(k)))fail('Cancelamento não pode reescrever a venda.');
    if(sale.active!==false||!sale.deletedAt||sale.onlineOrderId||sale.paymentIntentId)fail('Transição de cancelamento inválida.');
    const occurred=original.data?.toMillis?.()??Date.parse(original.data||original.createdAt||'');
    if(!Number.isFinite(occurred)||Date.now()-occurred>5*60*1000||occurred>Date.now()+30000)fail('Use o cancelamento canônico com motivo para vendas antigas.','failed-precondition');
    const latest=await tx.get(ref(c.bid,'sales','__none__').parent.where('spaceId','==',spaceId).orderBy('data','desc').limit(1));
    if(latest.docs[0]?.id!==primary.entityId)fail('Atalho restrito à última venda. Use o cancelamento canônico.','failed-precondition');
    Object.assign(planned('sales',primary.entityId),{status:'cancelado',active:false,operationId:original.operationId,idempotencyKey:original.idempotencyKey||original.operationId,actorUid:original.actorUid,cancelOperationId:item.operationId,cancelledByUid:c.uid});
    if(original.actorUid!==c.uid&&primary.data.actorUid&&primary.data.actorUid!==original.actorUid)fail('Autoria original deve ser preservada.');
    const alloc=await tx.get(ref(c.bid,'paymentAllocations','__none__').parent.where('saleId','==',primary.entityId).limit(1));
    if(!alloc.empty||Number(original.creditPaidAmount||0)>0||original.creditSettled)fail('Venda já recebeu pagamento; use conciliação.','failed-precondition');
   }else{
    if(await old('sales',primary.entityId))fail('Venda existente não pode ser sobrescrita.','already-exists');
    if(sale.actorUid!==c.uid||sale.operationId!==item.operationId||sale.active===false||sale.deletedAt||!['pago','fiado'].includes(sale.status))fail('Autoria ou status da venda inválidos.');
    if(sale.status==='fiado'&&sale.formaPagamento!=='fiado'||sale.formaPagamento==='fiado'&&sale.status!=='fiado')fail('Modalidade Fiado inconsistente.');
    if(['cancelOperationId','cancelledAt','reversedAt','financialReversalEventId','cancellationMode'].some(k=>sale[k]!=null)||Number(sale.creditPaidAmount||0)!==0||sale.creditSettled===true)fail('Venda nova não pode forjar cancelamento ou recebimento anterior.');
   }
   credit=(original||sale).formaPagamento==='fiado';
   if(!Array.isArray(sale.itens)||!sale.itens.length||sale.itens.length>100)fail('Itens inválidos.','invalid-argument');
   for(const i of sale.itens){
    const productId=validId(i.produtoId||i.productId,'Produto'),variantId=i.variantId?validId(i.variantId,'Variação'):null,q=i.quantidade??i.quantity;
    if(!numeric(q,true)||q>1000000)fail('Quantidade inválida.','invalid-argument');
    const unit=i.precoFinalUnitario??i.precoUnitario??i.unitPriceSnapshot,price=cents(unit);if(price<0)fail('Preço negativo.');total+=Math.round(q*price);
    const p=await old('products',productId);await scopeProduct(c,p,spaceId);
    if(variantId){const v=await old('productVariants',variantId);if(!v||v.parentProductId!==productId||!Model.active(v))fail('Variação inválida.');}
    if(p.productType==='variable'&&!variantId)fail('Variação obrigatória.');
    if(p.itemKind!=='service'&&!p.semControleEstoque&&p.controlaEstoque!==false)add(productId,variantId,(cancels.length?1:-1)*q);
   }
   if(total!==cents(sale.valorFinal??sale.valorTotal)||total<0)fail('Total não corresponde aos itens.','invalid-argument');
   if(sale.onlineOrderId){
    const order=await old('catalogOrders',sale.onlineOrderId);
    const signature=items=>items.map(i=>[i.produtoId||i.productId,i.variantId||null,Number(i.quantidade??i.quantity),cents(i.precoFinalUnitario??i.precoUnitario??i.unitPrice)]).sort((a,b)=>canonical(a).localeCompare(canonical(b)));
    if(!order||order.finalizationActorUid!==c.uid||order.finalizationOperationId!==item.operationId||order.saleId!==primary.entityId||order.spaceId!==spaceId||order.finalizationStatus!=='pending'||cents(order.total??order.valorFinal)!==total||order.saleStatus!==sale.status||order.paymentMethod!==sale.formaPagamento||(order.clientId||null)!==(sale.clienteId||sale.customerId||null)||canonical(signature(order.items))!==canonical(signature(sale.itens)))fail('Pedido online não autorizado ou itens/modalidade diferentes da conclusão canônica.');
   }
   if(sale.paymentIntentId){const intent=await old('paymentIntents',sale.paymentIntentId);if(!intent||intent.status!=='approved'||intent.createdByUid!==c.uid||intent.spaceId!==spaceId||intent.saleId!==primary.entityId||intent.finalizationOperationId!==item.operationId||intent.amountCents!==total)fail('Pagamento integrado não confirmado.');}
   const cid=sale.clienteId||sale.customerId;
   if(cid){const client=await old('clients',cid);if(!client)fail('Cliente não confirmado.');expectedClient.set(cid,{balance:(credit?(cancels.length?1:-1)*total:0)/100,amount:(cancels.length?-1:1)*total/100,count:cancels.length?-1:1});}
   else if(credit)fail('Fiado exige cliente.');
   if(cancels.length){
    const moves=await tx.get(ref(c.bid,'stockMovements','__none__').parent.where('vendaId','==',primary.entityId).limit(351)),originalDeltas=new Map();
    for(const s of moves.docs){const m=s.data();if(m.tipo!=='saida_venda'||m.operationId!==original.operationId)fail('Venda já possui devolução/movimento divergente.');const k=m.produtoId+':'+(m.variantId||'');originalDeltas.set(k,(originalDeltas.get(k)||0)-m.quantidade);}
    if(canonical([...originalDeltas].sort())!==canonical([...deltas].sort()))fail('Baixas originais não comprovadas.');
   }
  }
  if(payment||adjust){
   if(!c.has(payment?'customers.receiveDebt':'customers.adjustBalance'))fail('Permissão financeira operacional ausente.');
   const source=planned(primary.entityType,primary.entityId)||primary.data,cid=validId(source.clienteId||source.customerId,'Cliente'),client=await old('clients',cid);
   if(!client)fail('Cliente não confirmado.');
   if(spaceId)await c.space(spaceId);else if(!c.owner&&c.member?.spaceAccess!=='all')fail('Recebimento sem espaço exige revisão; não presumir o espaço atual.','failed-precondition');
   const delta=payment?Number(source.valor??source.amount):Number(source.saldoNovo)-Number(source.saldoAnterior);
   if(!numeric(delta)||payment&&delta<=0||adjust&&(!String(source.motivo||'').trim()||!same(source.saldoAnterior,client.saldo)||Number(source.expectedFinancialVersion)!==Number(client.financialVersion||0)))fail('Recebimento/ajuste inconsistente.','failed-precondition');
   if(source.status!=='conflict')expectedClient.set(cid,{balance:delta,amount:0,count:0});
   // Payment allocations can only advance real open sales, never rewrite totals,
   // payment method, actor, scope or historical items.
   for(const w of events){
    const s=await old('sales',w.entityId);if(!payment||!s||s.clienteId!==cid||s.formaPagamento!=='fiado'||s.active===false||s.deletedAt)fail('Alocação de recebimento inválida.');
    await c.space(s.spaceId);
    const allowed=['creditOriginalAmount','creditPaidAmount','creditRemainingAmount','creditSettled','creditSettledAt'];
    if(changed(w.data,s,Object.keys(w.data)).some(k=>!envelope.includes(k)&&!allowed.includes(k)))fail('Recebimento não pode editar a venda.');
    const a=writes.find(a=>a.entityType==='paymentAllocations'&&a.data.saleId===w.entityId);if(!a||a.data.paymentId!==payment.entityId||a.data.clientId!==cid||a.entityId!==payment.entityId+'__'+w.entityId||!numeric(a.data.amount,true)||!same(w.data.creditPaidAmount,Number(s.creditPaidAmount||0)+a.data.amount)||!same(w.data.creditRemainingAmount,Number(s.creditOriginalAmount??s.valorFinal)-Number(w.data.creditPaidAmount))||w.data.creditRemainingAmount<0||Object.hasOwn(w.data,'creditOriginalAmount')&&!same(w.data.creditOriginalAmount,s.creditOriginalAmount??s.valorFinal)||w.data.creditSettled!==(w.data.creditRemainingAmount===0))fail('Delta de alocação inválido.');
   }
   if(payment){
    const allocated=writes.filter(w=>w.entityType==='paymentAllocations').reduce((n,w)=>n+cents(w.data.amount),0);if(allocated>cents(delta)||writes.some(w=>w.entityType==='paymentAllocations'&&!events.some(s=>s.entityId===w.data.saleId)))fail('Recebimento aloca mais que o valor confirmado.');
    if(source.status!=='conflict'){
     let legacyRemaining=Number(client.legacyBalanceRemaining);
     if(!Number.isFinite(legacyRemaining)){
      const tracked=await tx.get(ref(c.bid,'sales','__none__').parent.where('clienteId','==',cid).limit(351));if(tracked.size>350)fail('Histórico de Fiado excede limite da transação.','failed-precondition');
      const open=tracked.docs.map(s=>s.data()).filter(s=>s.formaPagamento==='fiado'&&s.active!==false&&!s.deletedAt).reduce((n,s)=>n+Math.max(0,Number(s.creditRemainingAmount??s.valorFinal??0)),0);
      legacyRemaining=Math.max(0,Math.abs(Math.min(0,Number(client.saldo)))-open);
     }
     const legacyAmount=Math.min(delta,legacyRemaining),clientPatch=planned('clients',cid);
     if(source.legacyAmount!==undefined&&!same(source.legacyAmount,legacyAmount))fail('Parcela histórica do recebimento divergente.');
     if(clientPatch){clientPatch.legacyBalance=client.legacyBalance??legacyRemaining;clientPatch.legacyBalanceRemaining=Math.max(0,legacyRemaining-legacyAmount);clientPatch.campaignFinanceVersion=2;}
     source.legacyAmount=legacyAmount;source.allocatedAmount=allocated/100;
    }
   }
  }
  let engagement;
  try{engagement=await validateEngagement({db,tx,c,item,writes,plan,old,effective});}
  catch(error){if(error instanceof HttpsError)throw error;fail('A campanha ou renovação mudou; revise a operação preservada antes de continuar.','failed-precondition');}
  if(engagement.redemption){
   if(requiredKind||item.payload.eventKind!=='campaign_redemption'||writes.filter(w=>w.entityType==='campaignRedemptions').length!==1||engagement.redemption.operationId!==item.operationId)fail('Resgate exige operação própria e identificador original.');
   const reward=engagement.redemption.rewardSnapshot;
   if(engagement.redemption.stockMovementId)add(reward.productId,reward.variantId,-Number(reward.quantity));
  }
  const movements=writes.filter(w=>w.entityType==='stockMovements'),byMovement=new Map();
  for(const w of movements){const m=planned('stockMovements',w.entityId)||w.data,k=m.produtoId+':'+(m.variantId||'');
   if(w.operation!=='create'||await old('stockMovements',w.entityId)||m.operationId!==item.operationId||!numeric(m.quantidade)||m.quantidade===0||!same(m.estoqueNovo-m.estoqueAnterior,m.quantidade))fail('Movimento de estoque inválido.');
   const movementSpace=await c.space(m.spaceId);if(!createSales.length&&!cancels.length&&movementSpace.capabilities?.inventory!==true)fail('Estoque não habilitado neste espaço.');await scopeProduct(c,await old('products',m.produtoId),m.spaceId);
   if(createSales.length||cancels.length){if(m.vendaId!==primary.entityId||m.tipo!==(cancels.length?'venda_desfeita':'saida_venda'))fail('Movimento de outra venda.');}
   else if(engagement.redemption){if(w.entityId!==engagement.redemption.stockMovementId||m.tipo!=='saida_resgate_campanha'||m.redemptionId!==engagement.redemption.id||m.campaignId!==engagement.redemption.campaignId)fail('Movimento não corresponde ao resgate autorizado.');}
   else{if(!c.has('inventory.adjust')||!['entrada','ajuste','saida'].includes(m.tipo))fail('Ajuste de estoque não autorizado.');add(m.produtoId,m.variantId,m.quantidade);}
   byMovement.set(k,(byMovement.get(k)||0)+m.quantidade);
  }
  if(canonical([...byMovement].sort())!==canonical([...deltas].sort()))fail('Movimentos não correspondem integralmente à operação.');
  for(const [key,delta]of deltas){
   const [pid,vid]=key.split(':'),col=vid?'productVariants':'products',id=vid||pid,value=await old(col,id),patch=planned(col,id),field=vid?'stock':'estoqueAtual';
   if(!value||!patch||!numeric(value[field])||!numeric(patch[field])||!same(patch[field]-value[field],delta))fail('Estoque deve ser alterado pelo delta autorizado.');
   if(!vid){for(const alias of ['estoque','totalStock'])if(Object.hasOwn(patch,alias)&&!same(patch[alias],value[alias])&&!same(patch[alias],patch[field]))fail('Alias de estoque divergente.');for(const alias of ['estoque','totalStock'])if(Object.hasOwn(value,alias))patch[alias]=patch[field];}
   const held=(await tx.get(ref(c.bid,'onlineStockReservations',stockKey({productId:pid,variantId:vid||null})))).data(),reserved=Number(held?.quantity||0),claim=sale?.onlineOrderId?await old('catalogOrders',sale.onlineOrderId):null,own=Number(claim?.reservedQuantities?.[vid?'v_'+vid:'p_'+pid]||0);
   if(!same(reserved,Number(value.onlineReservedStock||0))||patch[field]<reserved-own&&!value.allowNegativeStock)fail('Estoque insuficiente ou reservado.','failed-precondition');
   const parent=await old('products',pid);if(vid&&value.parentProductId!==pid)fail('Variação de outro produto.');
   if(parent.productType==='variable'){
    const sum=await variantTotal(pid),parentPatch=planned('products',pid);
    if(!parentPatch||!same(parentPatch.totalStock??parentPatch.estoqueAtual,sum))fail('Agregado das variações divergente.');
   }
  }
  const expectedEvent=credit?'credit_sale'+(cancels.length?'_reversal':''):payment?'payment_received':adjust?'balance_adjustment':null;
  for(const p of plan.values()){
   const col=p.ref.parent.id,id=p.ref.id,before=await old(col,id),patch=p.data;
   if(col==='processedOperations'||col==='productImportIdentifiers')continue;
   if(patch.businessId&&patch.businessId!==c.bid)fail('Destino de outra empresa.');
   if(appendOnly.has(col)&&before)fail('Evento canônico é imutável.');
   if(col==='balanceEvents'){
    if(!expectedEvent||id!==expectedEvent+':'+primary.entityId||patch.type!==expectedEvent||patch.operationId!==item.operationId||patch.sourceCollection!==primary.entityType||patch.sourceDocumentId!==primary.entityId||!expectedClient.has(patch.customerId)||!same(patch.balanceDelta,expectedClient.get(patch.customerId).balance))fail('Evento financeiro não corresponde ao efeito autorizado.');
    patch.spaceId=spaceId;continue;
   }
   if(col==='clients'){
    const expected=expectedClient.get(id),balanceDelta=Number(patch.saldo??before?.saldo??0)-Number(before?.saldo||0);
    if(before&&changed(patch,before,financialFields).length){if(!expected||expected.balance===0||!same(balanceDelta,expected.balance)||Number(patch.financialVersion)!==Number(before?.financialVersion||0)+1)fail('Saldo/versão não correspondem a um efeito financeiro autorizado.');}
    if(expected&&expected.balance!==0){const e=planned('balanceEvents',expectedEvent+':'+primary.entityId);if(!e)fail('Evento financeiro obrigatório ausente.');}
    if(expected&&expected.balance!==0){patch.openBalance=Math.abs(Math.min(0,Number(before.saldo)+expected.balance));patch.financialRevision=item.operationId;}
    if(!expected&&!before&&(Number(patch.saldo||0)!==0||Number(patch.financialVersion||0)!==0))fail('Cadastro não pode criar saldo.');
    if(expected){for(const [field,delta]of [['totalComprado',expected.amount],['quantidadeVendas',expected.count]])if(Object.hasOwn(patch,field)&&!same(Number(patch[field])-Number(before?.[field]||0),delta))fail('Contador não corresponde à venda.');}
    if(expected&&createSales.length&&credit){const legacy=before.legacyBalance??Math.abs(Math.min(0,Number(before.saldo)));if(Object.hasOwn(patch,'legacyBalance')&&!same(patch.legacyBalance,legacy)||Object.hasOwn(patch,'legacyBalanceRemaining')&&!same(patch.legacyBalanceRemaining,before.legacyBalanceRemaining??legacy))fail('Saldo histórico não pode ser reescrito pela venda.');}
    if(!expected&&before&&changed(patch,before,counterFields).length)fail('Cadastro não pode alterar projeções comerciais.');
    const metadata=changed(patch,before,Object.keys(patch)).filter(k=>!envelope.includes(k)&&!financialFields.includes(k)&&!counterFields.includes(k)&&!['atualizadoEm'].includes(k));
    if((metadata.length||!before)&&!c.has('customers.edit'))fail('Sem permissão para editar o cadastro do cliente.');
    continue;
   }
   if(col==='products'||col==='productVariants'){
    const parent=col==='products'?{...before,...patch}:await effective('products',patch.parentProductId||before?.parentProductId);await scopeProduct(c,parent,null);
    const metadata=changed(patch,before,Object.keys(patch)).filter(k=>!envelope.includes(k)&&!stockFields.includes(k)&&!['atualizadoEm','custo','cost'].includes(k));
    if((metadata.length||!before)&&!c.has('products.edit'))fail('Sem permissão para editar produto.');
    if(col==='productVariants'&&before&&patch.parentProductId&&patch.parentProductId!==before.parentProductId)fail('Variação não pode mudar de produto.');
    if(col==='products'&&(!before||changed(patch,before,['spaceAccessMode','allowedSpaceIds','defaultSpaceId']).length)){
     const scoped={...before,...patch},ids=scoped.allowedSpaceIds;
     if(!['single_space','selected_spaces','all_spaces'].includes(scoped.spaceAccessMode)||!Array.isArray(ids)||ids.length>30||scoped.spaceAccessMode!=='all_spaces'&&!ids.length||scoped.spaceAccessMode==='single_space'&&(ids.length!==1||ids[0]!==scoped.defaultSpaceId))fail('Vínculo de espaço inválido.');
     for(const sid of ids)await c.space(sid);
     if(scoped.defaultSpaceId)await c.space(scoped.defaultSpaceId);
    }
    const idKey=col==='products'?id+':':(patch.parentProductId||before?.parentProductId)+':'+id;
    const variableSummary=col==='products'&&parent.productType==='variable';
    if(variableSummary){const total=await variantTotal(id);for(const f of ['estoqueAtual','estoque','totalStock'])if(Object.hasOwn(patch,f)&&!same(patch[f],total))fail('Resumo do produto não corresponde às variações.');}
    if(before&&changed(patch,before,stockFields).length&&!deltas.has(idKey)&&!variableSummary)fail('Estoque sem movimento autorizado.');
    if(!before&&!variableSummary&&stockFields.some(f=>numeric(patch[f])&&patch[f]!==0)){
     if(item.source==='recovery_local_orphan'||patch.source==='recovery_local_orphan')fail('Estoque histórico ausente exige revisão de origem; nenhuma entrada inicial será inventada.','failed-precondition');
     // Catalog creation retains its existing products.edit permission, but its
     // initial stock is now auditable rather than an untracked overwrite.
     const field=col==='products'?'estoqueAtual':'stock',quantity=Number(patch[field]||0);
     if(!numeric(quantity)||quantity<0||Number(patch.onlineReservedStock||0)!==0)fail('Estoque inicial inválido.');
     const initialSpace=writes.find(w=>w.entityType===col&&w.entityId===id)?.initialStockSpaceId||parent.defaultSpaceId||(parent.allowedSpaceIds?.length===1?parent.allowedSpaceIds[0]:null);
     if(!initialSpace)fail('Selecione o espaço para registrar a entrada inicial.','failed-precondition');
     const initialOrigin=await c.space(initialSpace);if(initialOrigin.capabilities?.inventory!==true||initialOrigin.capabilities?.products!==true)fail('Origem inicial sem estoque/produtos habilitados.');await scopeProduct(c,parent,initialSpace);
     if(col==='products'&&['estoque','totalStock'].some(f=>Object.hasOwn(patch,f)&&!same(patch[f],quantity)))fail('Aliases do estoque inicial divergentes.');
     const mid='initial_'+digest([item.operationId,col,id]).slice(0,40),mref=ref(c.bid,'stockMovements',mid);
     if((await get(mref)).exists())fail('Entrada inicial já existe.');
     plan.set(mref.path,{ref:mref,data:{id:mid,businessId:c.bid,spaceId:initialSpace,workspaceGeneration:gen(c.business),operationId:item.operationId,produtoId:col==='products'?id:patch.parentProductId,variantId:col==='productVariants'?id:null,tipo:'entrada_inicial',quantidade:quantity,estoqueAnterior:0,estoqueNovo:quantity,actorUid:c.uid,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()}});
    }
    continue;
   }
   if(col==='sales'){if(!events.some(w=>w.entityId===id))fail('Venda auxiliar não autorizada.');continue;}
   if(col==='payments'&&before&&id!==payment?.entityId){
    const resolving=payment?.data.confirmedConflictId===id;
    const fields=resolving?['status','applicationStatus','resolvedAt','resolutionOperationId','confirmedPaymentId','updatedAt']:['status','applicationStatus','cancelledAt','resolutionOperationId','updatedAt'];
    const supplied=originalWrites.find(w=>w.entityType==='payments'&&w.entityId===id)?.data||{};
    if(['operationId','idempotencyKey','actorUid','spaceId','clienteId','clientId','valor','amount'].some(k=>Object.hasOwn(supplied,k)&&canonical(supplied[k])!==canonical(before[k])))fail('A resolução preserva a origem do recebimento.');
    for(const k of ['operationId','idempotencyKey','actorUid','actorNameSnapshot','actorRoleSnapshot'])if(before[k]!==undefined)patch[k]=before[k];
    if(!c.has('customers.receiveDebt')||before.status!=='conflict'||before.financialAppliedAt||await old('balanceEvents','payment_received:'+id)||changed(patch,before,Object.keys(patch)).some(k=>!fields.includes(k)&&!envelope.includes(k)))fail('Um recebimento aplicado nunca pode ser reescrito por resolução de conflito.');
    if(before.spaceId)await c.space(before.spaceId);
    else if(!c.owner&&c.member?.spaceAccess!=='all')fail('Conflito sem espaço exige revisão administrativa.');
    if(resolving){if(patch.status!=='confirmed'||patch.applicationStatus!=='superseded_by_confirmation'||patch.resolutionOperationId!==item.operationId||patch.confirmedPaymentId!==payment.entityId||String(before.clienteId||before.clientId)!==String(payment.data.clienteId||payment.data.clientId))fail('Confirmação de conflito não corresponde ao novo recebimento.');}
    else if(primary||writes.length!==1||patch.status!=='cancelled'||patch.applicationStatus!=='not_applied'||patch.resolutionOperationId!=='payment-conflict-cancel:'+id)fail('Somente o conflito não aplicado pode ser encerrado sem efeitos.');
    continue;
   }
   if(col==='payments'||col==='balanceAdjustments'){if(!primary||col!==primary.entityType||id!==primary.entityId||before&&before.status!=='conflict')fail('Evento financeiro existente não pode ser reescrito.');patch.spaceId=spaceId;continue;}
   if(col==='stockMovements'||col==='paymentAllocations'){patch.spaceId=spaceId||patch.spaceId;continue;}
   const permission=permissions[col];
   const derivedTransition=['campaignProgress','campaignEvents','customerSubscriptions','customerSubscriptionEvents'].includes(col)&&((cancels.length&&c.has('sales.cancel'))||(payment&&c.has('customers.receiveDebt')));
   if(!permission||!c.has(permission)&&!derivedTransition)fail('Coleção/ação não autorizada: '+col);
   if(['campaignProgress','campaignRedemptions','rewards','customerSubscriptions','customerSubscriptionEvents','customerSegments','visits'].includes(col)&&!['internal','trial','professional','premium'].includes(c.business.subscription?.planId))fail('Recurso não incluído no plano.');
   if(col==='productFinancials')await scopeProduct(c,await effective('products',patch.productId||id),null);
   if(col==='variantFinancials'){const v=await effective('productVariants',patch.variantId||id);await scopeProduct(c,v&&await effective('products',v.parentProductId),null);}
   if(col==='saleFinancials'){const s=planned('sales',patch.saleId||id)||await old('sales',patch.saleId||id);if(!s)fail('Venda financeira ausente.');await c.space(s.spaceId);}
   if(col==='stockMovementFinancials'){const m=planned('stockMovements',patch.stockMovementId||id)||await old('stockMovements',patch.stockMovementId||id);if(!m)fail('Movimento financeiro ausente.');await c.space(m.spaceId);}
  }
 }
 async function scopeProduct(c,p,spaceId){
  if(!p||p.businessId!==c.bid||gen(p)!==gen(c.business))fail('Produto de outra empresa/geração.');
  if(spaceId){if(!Model.allows(p,spaceId)||p.spaceAccessMode==='single_space'&&(p.defaultSpaceId!==spaceId||p.allowedSpaceIds?.length!==1||p.allowedSpaceIds[0]!==spaceId||p.spaceId&&p.spaceId!==spaceId))fail('Produto de outro espaço ou com vínculo ambíguo.');}
  else if(!c.owner&&c.member?.spaceAccess!=='all'&&p.spaceAccessMode!=='all_spaces'&&!(p.allowedSpaceIds||[]).some(id=>c.member?.allowedSpaceIds?.includes(id)))fail('Produto fora dos espaços autorizados.');
 }
 async function receipt(request){
  return db.runTransaction(async tx=>{
   const d=request.data||{},c=await context(tx,request,{businessId:d.businessId,userId:request.auth?.uid,workspaceGeneration:d.workspaceGeneration??0},{readOnly:true});
   // Read-only session handshake. No sale/financial data or persistent marker.
   if(d.kind==='sync_protocol')return{protocolVersion:1,minClientRelease:202,channel:'commitOperationalSync',businessId:c.bid,workspaceGeneration:gen(c.business)};
   if(!c.has('sales.create')&&!c.has('sales.cancel'))fail('Sem acesso operacional.');
   const sid=validId(d.saleId,'Venda'),op=operationalId(d.operationId,'Operação'),s=(await tx.get(ref(c.bid,'sales',sid))).data();
   const reversal=d.kind==='sale_undo';
   if(!s||(reversal?s.cancelOperationId!==op:s.operationId!==op)||s.spaceId!==d.spaceId||gen(s)!==gen(c.business))fail('Venda de outra operação.');
   await c.space(s.spaceId);
   const marker=(await tx.get(ref(c.bid,'processedOperations',op))).data(),e=(await tx.get(ref(c.bid,'balanceEvents',(reversal?'credit_sale_reversal:':'credit_sale:')+sid))).data();
   return{confirmed:!!marker&&!!e&&(reversal?s.active===false&&s.financialReversalEventId:s.financialAppliedAt)!=null&&e.operationId===op&&e.customerId===(s.clienteId||s.customerId)&&e.sourceDocumentId===sid&&cents(e.balanceDelta)===(reversal?1:-1)*cents(s.valorFinal??s.valorTotal)};
  });
 }
 // Internal authorization shared by typed maintenance commands, not a callable.
 return{commit,receipt,authorize:context};
}
module.exports={operationalCommitService};
