'use strict';
const {createHash}=require('node:crypto');
const {FieldValue}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const {validId}=require('./workspace-reset-policy');
const {operationalId}=require('../shared/operational-id');
const {operationalCommitService}=require('./operational-commit-service');
const {buildFinancialBalanceAudit}=require('../shared/financial-maintenance-audit');
const canonical=x=>JSON.stringify((function sort(v){return Array.isArray(v)?v.map(sort):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,sort(v[k])])):v;})(x));
const hash=x=>createHash('sha256').update(canonical(x)).digest('hex');
const round=n=>Math.round(Number(n)*100)/100;
const fail=(message,code='failed-precondition')=>{throw new HttpsError(code,message);};
const equal=(a,b)=>Number.isFinite(Number(a))&&Number.isFinite(Number(b))&&Math.abs(Number(a)-Number(b))<0.005;
const normalized=x=>x?.toDate?x.toDate().toISOString():Array.isArray(x)?x.map(normalized):x&&typeof x==='object'?Object.fromEntries(Object.entries(x).map(([k,v])=>[k,normalized(v)])):x;
function financialMaintenanceService(db){
 const authorizer=operationalCommitService(db).authorize;
 async function commit(request){
  const d=request.data||{},command=d.command;
  if(!['reconcile_only_local_balance','recover_only_local_sale','reconcile_balances','reverse_duplicate_payment'].includes(command)||d.confirmed!==true)fail('Confirmação administrativa explícita obrigatória.','invalid-argument');
  if(Buffer.byteLength(JSON.stringify(d))>500000)fail('Pacote administrativo excede o limite.','invalid-argument');
  // The effect identity stays the same after a lost response even if a fresh
  // preview now observes its committed balance/version. Preserve both previews
  // in the audit; never reinterpret a different target/source as a replay.
  const {expectedBalance:_balance,expectedFinancialVersion:_version,...identity}=d;
  const operationId=operationalId(d.operationId,'Operação'),requestHash=hash(identity);
  return db.runTransaction(async tx=>{
   const c=await authorizer(tx,request,{businessId:d.businessId,userId:request.auth?.uid,workspaceGeneration:d.workspaceGeneration??0});
   if(!c.owner&&!(c.role==='admin'&&c.has('customers.adjustBalance')&&c.has('settings.manage')))fail('A manutenção exige proprietário ou administrador autorizado.','permission-denied');
   const ref=(col,id)=>db.doc(`businesses/${c.bid}/${col}/${id}`),get=async(col,id)=>(await tx.get(ref(col,id))).data();
   const auditRef=ref('financialMaintenanceAudits',operationId),audit=(await tx.get(auditRef)).data();
   if(audit){if(audit.requestHash!==requestHash||audit.actorUid!==c.uid)fail('Identificador já utilizado com conteúdo diferente.','already-exists');return{...audit.result,idempotent:true};}
   if(command!=='recover_only_local_sale'&&await get('processedOperations',operationId))fail('Marcador anterior sem recibo desta manutenção. Revisão necessária.');
   const cid=command==='recover_only_local_sale'&&!d.clientId?null:validId(d.clientId,'Cliente'),client=cid?await get('clients',cid):null;
   if(cid&&(!client||client.businessId&&client.businessId!==c.bid||(client.workspaceGeneration??0)!==(c.business.workspaceGeneration??0)))fail('Cliente não confirmado nesta empresa/geração.');
   if(client&&(!equal(client.saldo,d.expectedBalance)||Number(client.financialVersion||0)!==Number(d.expectedFinancialVersion)))fail('Saldo ou versão mudou após a prévia. Nenhum efeito foi aplicado.');
   const plan=[],put=(col,id,value,merge=false)=>plan.push({ref:ref(col,id),value:{...value,businessId:c.bid,workspaceGeneration:c.business.workspaceGeneration??0},merge});
   const stamp=FieldValue.serverTimestamp(),base={operationId,actorUid:c.uid,ownerId:c.uid,createdAt:stamp,updatedAt:stamp,schemaVersion:3};
   let after=round(client?.saldo||0),result={operationId,clientId:cid,balanceBefore:after,balanceAfter:after,idempotent:false};
   const event=(id,type,delta,sourceCollection,sourceDocumentId,extra={})=>put('balanceEvents',id,{...base,id,idempotencyKey:id,customerId:cid,clientId:cid,type,amount:Math.abs(delta),balanceDelta:delta,direction:delta<0?'debit':'credit',sourceCollection,sourceDocumentId,status:'applied',appliedAt:stamp,...extra});
   if(command==='reverse_duplicate_payment'){
    const duplicateId=validId(d.duplicatePaymentId,'Pagamento duplicado'),legitimateId=validId(d.legitimatePaymentId,'Pagamento legítimo');
    if(duplicateId===legitimateId||operationId!==`duplicate-payment-reversal:${duplicateId}`||String(d.reason||'').trim().length<5)fail('Reversão deve identificar pagamentos distintos e um motivo.');
    const duplicate=await get('payments',duplicateId),legitimate=await get('payments',legitimateId),effectId='payment_received:'+duplicateId,effect=await get('balanceEvents',effectId),reversalId='payment_reversal:'+duplicateId;
    const [reversal,adjustment,marker,allocations]=await Promise.all([get('balanceEvents',reversalId),get('balanceAdjustments',operationId),get('processedOperations',operationId),tx.get(ref('paymentAllocations','__none__').parent.where('paymentId','==',duplicateId).limit(1))]);
    if(!duplicate||!legitimate||!effect||[duplicate,legitimate].some(p=>String(p.clienteId||p.clientId)!==cid||!['applied','confirmed','paid'].includes(p.status)||p.deletedAt||p.active===false)||effect.type!=='payment_received'||effect.sourceDocumentId!==duplicateId||String(effect.customerId||effect.clientId)!==cid||!['applied','applied_by_reconciliation'].includes(effect.status))fail('Evidência canônica do recebimento não confere.');
    for(const p of [duplicate,legitimate])if(p.spaceId)await c.space(p.spaceId);
    const amount=round(duplicate.valor??duplicate.amount);
    if(!(amount>0)||!equal(legitimate.valor??legitimate.amount,amount)||!equal(effect.balanceDelta,amount)||!equal(effect.amount,amount)||reversal||adjustment||marker||!allocations.empty||(duplicate.allocations||[]).length||(duplicate.campaignConfirmations||[]).length)fail('Recebimento possui dependências ou reversão prévia; revisão necessária.');
    after=round(after-amount);if(!equal(after,d.targetBalance))fail('Valor da reversão diverge da prévia.');
    put('payments',duplicateId,{status:'reversed',applicationStatus:'reversed',reversedAt:stamp,reversedByOperationId:operationId,reversedByUid:c.uid,reversalReason:d.reason,duplicateOf:legitimateId,reversalEffectId:reversalId,updatedAt:stamp},true);
    // The original event is NEVER rewritten. A new event compensates it.
    event(reversalId,'payment_reversal',-amount,'payments',duplicateId,{spaceId:duplicate.spaceId||null,reversesEffectId:effectId,duplicateOf:legitimateId});
    put('balanceAdjustments',operationId,{...base,id:operationId,clienteId:cid,clientId:cid,spaceId:duplicate.spaceId||null,tipo:'ajuste_saldo',subtipo:'pagamento_duplicado_revertido',valor:-amount,saldoAnterior:client.saldo,saldoNovo:after,motivo:d.reason,duplicatePaymentId:duplicateId,duplicateOf:legitimateId,reversesEffectId:effectId});
    Object.assign(result,{amount,duplicatePaymentId:duplicateId,legitimatePaymentId:legitimateId,reversalEffectId:reversalId,adjustmentId:operationId});
   }else if(command==='reconcile_only_local_balance'){
    const sale=d.sale,sid=validId(sale?.id,'Venda'),originalOp=operationalId(sale.operationId,'Operação original');
    if(operationId!=='legacy_reconciliation:'+sid||sale.businessId!==c.bid||(sale.workspaceGeneration??0)!==(c.business.workspaceGeneration??0)||String(sale.clienteId||sale.customerId)!==cid||String(d.reason||'').trim().length<5||!Number.isFinite(d.targetBalance)||d.targetBalance>0||d.targetBalance< -999999999)fail('Intenção de reconciliação inválida.');
    await c.space(sale.spaceId);
    for(const [col,id]of [['sales',sid],['balanceEvents','credit_sale:'+sid],['balanceEvents','balance_adjustment:'+operationId],['processedOperations',operationId],['balanceAdjustments',operationId],['saleRecoveryOperations',originalOp],['syncIncidentArchives',originalOp]])if(await get(col,id))fail('A origem já possui efeito, revisão ou decisão remota. Refaça a análise.');
    after=round(d.targetBalance);
    put('balanceAdjustments',operationId,{...base,id:operationId,clienteId:cid,clientId:cid,spaceId:sale.spaceId,tipo:'ajuste_saldo',subtipo:'reconciliacao_operacao_legada',adjustmentType:'reconciliation',motivo:d.reason,saldoAnterior:client.saldo,saldoNovo:after,valor:round(after-client.saldo),resolutionStatus:'resolved_by_reconciliation',resolvedSaleId:sid,resolvedOperationId:originalOp,resolvedAt:stamp});
    if(!equal(after,client.saldo))event('balance_adjustment:'+operationId,'balance_adjustment',round(after-client.saldo),'balanceAdjustments',operationId,{spaceId:sale.spaceId});
    Object.assign(result,{saleId:sid,originalOperationId:originalOp,adjustmentId:operationId});
   }else if(command==='recover_only_local_sale'){
    const sale=d.sale,sid=validId(sale?.id,'Venda'),op=operationalId(sale.operationId,'Operação original'),space=await c.space(sale.spaceId);
    if(operationId!==op||space.capabilities?.sales!==true||sale.businessId!==c.bid||(sale.workspaceGeneration??0)!==(c.business.workspaceGeneration??0)||sale.active===false||sale.deletedAt||!['pago','fiado'].includes(sale.status)||sale.onlineOrderId||sale.exchangeCreditUsedCents||sale.campaignEvents?.length||sale.itens?.some(i=>i.subscriptionId||i.recurringActivation))fail('Venda exige revisão dedicada; nenhum efeito foi aplicado.');
    const actor=await tx.get(db.doc('users/'+validId(sale.actorUid,'Ator original'))),member=await get('members',sale.actorUid);
    const legacyOwner=!member&&sale.actorUid===c.business.ownerId&&actor.data()?.role==='owner';
    if(actor.data()?.active!==true||actor.data()?.businessId!==c.bid||!legacyOwner&&(!member||member.status!=='active'||member.role!=='owner'&&(!member.permissions?.['sales.create']||member.spaceAccess!=='all'&&!member.allowedSpaceIds?.includes(sale.spaceId))))fail('Ator original não autorizado.','permission-denied');
    const [existing,marker,effect,resolution,review,archive]=await Promise.all([get('sales',sid),get('processedOperations',op),get('balanceEvents','credit_sale:'+sid),get('balanceAdjustments','legacy_reconciliation:'+sid),get('saleRecoveryOperations',op),get('syncIncidentArchives',op)]);
    if(existing||resolution||review||archive)fail('Venda já existe ou possui decisão/revisão remota.');
    const expected=new Map();let amount=0;
    if(!Array.isArray(sale.itens)||!sale.itens.length||sale.itens.length>100)fail('Itens originais inválidos.');
    for(const i of sale.itens){const q=Number(i.quantidade),price=Number(i.precoFinalUnitario??i.precoUnitario),product=await get('products',validId(i.produtoId,'Produto'));if(!(q>0)||!Number.isFinite(price)||price<0||!product||product.businessId!==c.bid||!require('../shared/online-store').allows(product,sale.spaceId))fail('Item/escopo original não confere.');amount+=round(q*price);if(i.variantId){const v=await get('productVariants',validId(i.variantId,'Variação'));if(!v||v.parentProductId!==i.produtoId)fail('Variação divergente.');}if(product.itemKind!=='service'&&!product.semControleEstoque&&product.controlaEstoque!==false){const key=i.produtoId+':'+(i.variantId||'');expected.set(key,(expected.get(key)||0)-q);}}
    amount=round(amount);if(!equal(amount,sale.valorFinal??sale.valorTotal)||(sale.clienteId||sale.customerId||null)!==cid)fail('Total/cliente da venda não confere.');
    const moves=await tx.get(ref('stockMovements','__none__').parent.where('vendaId','==',sid).limit(351)),found=new Map();
    if(moves.size>350)fail('Movimentos excedem o limite.');for(const s of moves.docs){const m=s.data();if(m.operationId!==op||m.spaceId!==sale.spaceId||m.tipo!=='saida_venda')fail('Movimento original divergente.');const k=m.produtoId+':'+(m.variantId||'');found.set(k,(found.get(k)||0)+m.quantidade);}
    if(canonical([...found].sort())!==canonical([...expected].sort()))fail('Baixas originais não comprovadas. Use a revisão de recuperação; não será inventada movimentação.');
    const credit=sale.formaPagamento==='fiado';if(credit!==(sale.status==='fiado')||credit&&!client)fail('Modalidade original inconsistente.');
    if(effect){if(!credit||effect.operationId!==op||effect.sourceDocumentId!==sid||effect.customerId!==cid||!equal(effect.balanceDelta,-amount))fail('Efeito original divergente.');}
    else if(marker)fail('Marcador sem efeito comprovado; revisão necessária.');
    else if(credit){if(!equal(sale.saldoAnterior,client.saldo)||!equal(sale.saldoAtual,Number(client.saldo)-amount)||Number(sale.financialVersionAnterior)!==Number(client.financialVersion||0))fail('Versão/saldo original não permite novo débito.');after=round(after-amount);event('credit_sale:'+sid,'credit_sale',-amount,'sales',sid,{spaceId:sale.spaceId,saleId:sid});put('clients',cid,{totalComprado:round(Number(client.totalComprado||0)+amount),quantidadeVendas:Number(client.quantidadeVendas||0)+1},true);}
    put('sales',sid,{...sale,recoveredAt:stamp,recoveredByUid:c.uid,recoverySource:'reviewed_only_local_sale',maintenanceSourceHash:hash(sale),...(credit?{financialAppliedAt:effect?.appliedAt||stamp,financialOperationId:'credit_sale:'+sid}:{}),updatedAt:stamp});
    Object.assign(result,{saleId:sid,recovered:true});
   }else{
    // Rebuild the existing audit from SERVER documents. No submitted delta or
    // submitted missing-effect body becomes an Admin write.
    const raw={clients:{remoteItems:[{id:cid,...normalized(client)}]}},allSources=[];
    for(const col of ['sales','payments','balanceAdjustments']){
     const docs=new Map();for(const field of ['clienteId','clientId','customerId']){const rows=await tx.get(ref(col,'__none__').parent.where(field,'==',cid).limit(151));if(rows.size>150)fail('Histórico extenso exige revisão individual.');for(const s of rows.docs)docs.set(s.id,{id:s.id,...normalized(s.data())});}
     if([...docs.values()].some(v=>v.businessId&&v.businessId!==c.bid||(v.workspaceGeneration??0)!==(c.business.workspaceGeneration??0)))fail('Origem financeira de outra empresa/geração.');
     raw[col]={remoteItems:[...docs.values()].filter(v=>!['reversed','cancelado','conflict','desfeito'].includes(v.status))};allSources.push(...raw[col].remoteItems.map(v=>[col,v]));
    }
    const effects=new Map();for(const field of ['customerId','clientId']){const rows=await tx.get(ref('balanceEvents','__none__').parent.where(field,'==',cid).limit(301));if(rows.size>300)fail('Ledger extenso exige revisão individual.');for(const s of rows.docs)effects.set(s.id,{id:s.id,...normalized(s.data())});}
    const report=buildFinancialBalanceAudit(raw,[...effects.values()]),repair=[...report.safeRepairs,...report.effectBackfills].find(r=>r.clientId===cid);
    if(!repair||!equal(repair.expectedBalance,d.targetBalance)||canonical(repair.missingEffects.map(e=>e.effectId).sort())!==canonical((d.effectIds||[]).slice().sort()))fail('A evidência remota não confirma a reparação prevista.');
    after=repair.expectedBalance;
    for(const e of repair.missingEffects){const source=allSources.find(([col,v])=>col===e.sourceCollection&&v.id===e.sourceDocumentId)?.[1];if(!source||effects.has(e.effectId)||await get('balanceEvents',e.effectId))fail('Origem/efeito mudou.');if(source.spaceId)await c.space(source.spaceId);if(!equal(e.balanceDelta,e.type==='credit_sale'?-e.amount:e.type==='payment_received'?e.amount:e.balanceDelta))fail('Delta canônico incoerente.');event(e.effectId,e.type,e.balanceDelta,e.sourceCollection,e.sourceDocumentId,{operationId:e.operationId,spaceId:source.spaceId||null,status:'applied_by_reconciliation'});put(e.sourceCollection,e.sourceDocumentId,{financialAppliedAt:stamp,financialOperationId:e.effectId,updatedAt:stamp},true);}
    if(!repair.balanceAlreadyApplied){const sales=repair.missingEffects.filter(e=>e.type==='credit_sale');put('clients',cid,{totalComprado:round(Number(client.totalComprado||0)+sales.reduce((n,e)=>n+e.amount,0)),quantidadeVendas:Number(client.quantidadeVendas||0)+sales.length},true);}
    result.effects=repair.missingEffects.length;
   }
   const version=Number(client?.financialVersion||0)+(!client||equal(after,client.saldo)?0:1);
   if(client&&!equal(after,client.saldo))put('clients',cid,{saldo:after,financialVersion:version,openBalance:Math.abs(Math.min(0,after)),financialRevision:operationId,financialReconciledAt:stamp,updatedAt:stamp},true);
   result={...result,balanceAfter:after,financialVersionAfter:version,auditHash:requestHash,businessId:c.bid,resolvedByUid:c.uid,resolvedAt:new Date().toISOString(),workspaceGeneration:c.business.workspaceGeneration??0};
   const marker=await get('processedOperations',operationId);if(!marker)put('processedOperations',operationId,{...base,id:operationId,idempotencyKey:operationId,status:'processed',eventKind:command==='recover_only_local_sale'?'sale':'balance_reconciliation',maintenanceRequestHash:requestHash,processedAt:stamp});
   for(const p of plan)tx.set(p.ref,p.value,{merge:p.merge});
   tx.create(auditRef,{...base,businessId:c.bid,workspaceGeneration:c.business.workspaceGeneration??0,command,requestHash,request:d,result,status:'processed'});
   tx.set(ref('syncMetadata','last-sync'),{businessId:c.bid,workspaceGeneration:c.business.workspaceGeneration??0,updatedAt:stamp,revision:operationId,changedCollections:[...new Set(plan.map(p=>p.ref.parent.id))]},{merge:true});
   return result;
  });
 }
 return{commit};
}
module.exports={financialMaintenanceService};
