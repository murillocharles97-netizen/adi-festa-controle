'use strict';

const crypto=require('node:crypto');
const {FieldValue,Timestamp}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const {ProviderRegistry}=require('./provider-registry');
const {SIMULATOR_CAPABILITIES}=require('./providers/simulator-provider');

const ACTIVE_STATUSES=new Set(['created','awaiting_terminal','processing','pending_confirmation']);
const FINAL_STATUSES=new Set(['approved','declined','cancelled','expired','error','refunded']);
const PAYMENT_METHODS=new Set(['credit','debit']);
const ROLES=new Set(['owner','admin','manager','cashier']);
const PROVIDERS=Object.freeze([
  {id:'cielo',name:'Cielo',availability:'not_configured'},
  {id:'mercado_pago',name:'Mercado Pago',availability:'not_configured'},
  {id:'pagbank',name:'PagBank',availability:'coming_soon'},
  {id:'simulator',name:'Simulador VECONI',availability:'restricted'},
]);

const text=(value,max=160)=>String(value??'').trim().slice(0,max);
const sha=value=>crypto.createHash('sha256').update(String(value||'')).digest('hex');
const timestampMillis=value=>value?.toMillis?.()||Date.parse(value||0)||0;
const safeDate=value=>value&&typeof value.toDate==='function'?value.toDate().toISOString():value||null;
const actorOf=context=>({uid:context.uid,name:text(context.profile?.name||context.profile?.displayName||'',80)||null,role:text(context.profile?.role,30)||null});
const statusMessage=status=>({created:'Cobrança criada.',awaiting_terminal:'Aguardando o cartão na maquininha.',processing:'Pagamento em processamento.',pending_confirmation:'A confirmação ainda não chegou. Não cobre novamente.',approved:'Pagamento aprovado.',declined:'Pagamento não aprovado.',cancelled:'Cobrança cancelada.',expired:'Cobrança expirada.',error:'Não foi possível concluir a cobrança.',refunded:'Pagamento estornado.'}[status]||'Status do pagamento atualizado.');
const saleStatusForPayment=status=>status==='approved'?'paid':status==='cancelled'?'cancelled':['declined','expired','error'].includes(status)?'payment_failed':'payment_pending';

function normalizeSaleDraft(input={}){
  const id=text(input.id,100),items=Array.isArray(input.itens)?input.itens:Array.isArray(input.items)?input.items:[];
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(id))throw new HttpsError('invalid-argument','Identificador da venda inválido.');
  if(!items.length||items.length>100)throw new HttpsError('invalid-argument','A venda precisa ter entre 1 e 100 itens.');
  const normalizedItems=items.map((item,index)=>{
    const productId=text(item.produtoId||item.productId,100),quantity=Number(item.quantidade??item.quantity),unitPrice=Number(item.precoFinalUnitario??item.precoUnitario??item.unitPriceSnapshot);
    if(!productId||!Number.isFinite(quantity)||quantity<=0||quantity>10000||!Number.isFinite(unitPrice)||unitPrice<0)throw new HttpsError('invalid-argument',`Item ${index+1} da venda é inválido.`);
    return{
      produtoId:productId,
      productId,
      variantId:text(item.variantId,100)||null,
      nome:text(item.nome||item.productNameSnapshot,160)||'Produto',
      productNameSnapshot:text(item.productNameSnapshot||item.nome,160)||'Produto',
      variantNameSnapshot:text(item.variantNameSnapshot,160)||null,
      quantidade:quantity,
      quantity,
      precoOriginal:Number(item.precoOriginal??item.precoUnitario??unitPrice),
      precoFinalUnitario:unitPrice,
      custoUnitario:Number(item.custoUnitario||0),
      productType:text(item.productType,30)||'simple',
      recurringActivation:item.recurringActivation&&typeof item.recurringActivation==='object'?item.recurringActivation:null,
      campaignDiscounts:Array.isArray(item.campaignDiscounts)?item.campaignDiscounts.slice(0,20):[],
    };
  });
  return{
    id,
    clienteId:text(input.clienteId||input.clientId,100)||null,
    observacao:text(input.observacao,500),
    itens:normalizedItems,
    ajusteManual:input.ajusteManual===true,
    descontoTipo:text(input.descontoTipo,40)||null,
    appliedCampaignIds:Array.isArray(input.appliedCampaignIds)?[...new Set(input.appliedCampaignIds.map(value=>text(value,100)).filter(Boolean))].slice(0,30):[],
  };
}

function validatePaymentInput(input={},terminal={}){
  const amountCents=Number(input.amountCents),paymentMethod=text(input.paymentMethod,20),installments=Number(input.installments||1),capabilities=terminal.capabilities||{};
  if(!Number.isInteger(amountCents)||amountCents<=0||amountCents>999999999)throw new HttpsError('invalid-argument','Valor da cobrança inválido.');
  if(!PAYMENT_METHODS.has(paymentMethod))throw new HttpsError('invalid-argument','Tipo de cartão inválido.');
  if(paymentMethod==='credit'&&capabilities.supportsCredit!==true)throw new HttpsError('failed-precondition','Esta maquininha não aceita crédito.');
  if(paymentMethod==='debit'&&capabilities.supportsDebit!==true)throw new HttpsError('failed-precondition','Esta maquininha não aceita débito.');
  if(!Number.isInteger(installments)||installments<1)throw new HttpsError('invalid-argument','Parcelamento inválido.');
  if(paymentMethod==='debit'&&installments!==1)throw new HttpsError('invalid-argument','Débito não pode ser parcelado.');
  if(installments>1&&(capabilities.supportsInstallments!==true||installments>Number(capabilities.maxInstallments||1)))throw new HttpsError('failed-precondition','Parcelamento não suportado por esta maquininha.');
  return{amountCents,paymentMethod,installments};
}

function publicIntent(id,data={}){
  return{
    id,
    businessId:data.businessId,
    saleId:data.saleId,
    terminalId:data.terminalId,
    terminalNickname:data.terminalNickname,
    provider:data.provider,
    amountCents:data.amountCents,
    currency:data.currency||'BRL',
    paymentMethod:data.paymentMethod,
    installments:data.installments,
    status:data.status,
    saleStatus:data.saleStatus||saleStatusForPayment(data.status),
    statusMessage:statusMessage(data.status),
    idempotencyKey:data.idempotencyKey,
    providerPaymentId:data.providerPaymentId||null,
    providerOrderId:data.providerOrderId||null,
    createdByUid:data.createdByUid,
    createdAt:safeDate(data.createdAt),
    updatedAt:safeDate(data.updatedAt),
    approvedAt:safeDate(data.approvedAt),
    failureReason:data.failureReason||null,
    capabilities:data.capabilities||{},
    saleDraft:data.saleDraft||null,
    finalizationOperationId:data.finalizationOperationId,
    finalizationStatus:data.finalizationStatus||'pending',
    finalizedSaleId:data.finalizedSaleId||null,
    canCancel:ACTIVE_STATUSES.has(data.status)&&data.capabilities?.supportsCancellation===true,
    canRefund:data.status==='approved'&&data.capabilities?.supportsRefund===true,
  };
}

function terminalPaymentService(db,{permissionService,registry=new ProviderRegistry(),simulatorEnabled=()=>false,now=()=>Date.now()}={}){
  if(!permissionService)throw new Error('permissionService é obrigatório.');
  const permissions=()=>permissionService(db);
  const businessPath=businessId=>`businesses/${businessId}`;
  const intentRef=(businessId,intentId)=>db.doc(`${businessPath(businessId)}/paymentIntents/${intentId}`);
  const terminalRef=(businessId,terminalId)=>db.doc(`${businessPath(businessId)}/paymentTerminals/${terminalId}`);
  async function context(request,{admin=false}={}){
    const businessId=text(request.data?.businessId||request.data?.companyId,100),value=await permissions().authenticatedContext(request,businessId,{ownerOnly:false});
    if(!ROLES.has(value.profile?.role))throw new HttpsError('permission-denied','Seu perfil não pode operar pagamentos.');
    if(admin&&!['owner','admin'].includes(value.profile?.role))throw new HttpsError('permission-denied','Somente proprietário ou administrador pode gerenciar maquininhas.');
    return{...value,businessId};
  }
  const simulatorAllowed=contextValue=>Boolean(simulatorEnabled())||(contextValue.businessId==='adi-festa'&&contextValue.business?.subscription?.planId==='internal')||process.env.FUNCTIONS_EMULATOR==='true';
  async function recordEvent({businessId,intentId,status,actor,source='engine',details={}}){
    const ref=intentRef(businessId,intentId).collection('events').doc();
    await ref.set({id:ref.id,businessId,intentId,type:`payment_${status}`,status,source,actor,details,createdAt:FieldValue.serverTimestamp()});
  }
  async function getIntent(contextValue,id){
    const ref=intentRef(contextValue.businessId,text(id,100)),snapshot=await ref.get();
    if(!snapshot.exists)throw new HttpsError('not-found','Cobrança não encontrada.');
    const data=snapshot.data();
    if(data.businessId!==contextValue.businessId)throw new HttpsError('permission-denied','Cobrança pertence a outra empresa.');
    return{ref,snapshot,data};
  }
  async function getSetup(request){
    const value=await context(request),snapshot=await db.collection(`${businessPath(value.businessId)}/paymentTerminals`).get(),terminals=snapshot.docs.map(doc=>({id:doc.id,...doc.data()})).filter(item=>item.businessId===value.businessId&&item.status!=='archived').sort((a,b)=>Number(b.isDefault)-Number(a.isDefault)||String(a.nickname).localeCompare(String(b.nickname),'pt-BR'));
    return{
      simulatorAllowed:simulatorAllowed(value),
      providers:PROVIDERS.map(provider=>({...provider,availability:provider.id==='simulator'?(simulatorAllowed(value)?(terminals.some(item=>item.provider==='simulator')?'connected':'available'):'restricted'):terminals.some(item=>item.provider===provider.id)?'connected':provider.availability})),
      terminals,
    };
  }
  async function saveTerminal(request){
    const value=await context(request,{admin:true}),input=request.data?.terminal||{},providerId=text(input.provider||'simulator',40);
    if(providerId!=='simulator')throw new HttpsError('failed-precondition','Este provider ainda não está disponível na Fase 1.');
    if(!simulatorAllowed(value))throw new HttpsError('permission-denied','O simulador está restrito ao ambiente interno ou de testes.');
    const provider=registry.get(providerId),nickname=text(input.nickname||'Simulador Caixa 1',60);
    if(nickname.length<2)throw new HttpsError('invalid-argument','Informe um nome para a maquininha.');
    const requestedId=text(input.id,100),ref=requestedId?terminalRef(value.businessId,requestedId):db.collection(`${businessPath(value.businessId)}/paymentTerminals`).doc(),existing=await ref.get();
    if(existing.exists&&existing.data()?.businessId!==value.businessId)throw new HttpsError('permission-denied','Maquininha pertence a outra empresa.');
    const paired=existing.exists?existing.data():await provider.pairTerminal({nickname}),actor=actorOf(value),isDefault=input.isDefault===true||input.makeDefault===true;
    if(isDefault){
      const all=await db.collection(`${businessPath(value.businessId)}/paymentTerminals`).where('isDefault','==',true).get(),batch=db.batch();
      all.docs.forEach(doc=>batch.set(doc.ref,{isDefault:false,updatedAt:FieldValue.serverTimestamp()},{merge:true}));
      batch.set(ref,{id:ref.id,businessId:value.businessId,provider:providerId,nickname,externalTerminalId:paired.externalTerminalId,model:paired.model||null,serial:paired.serial||null,merchantId:null,status:'connected',isDefault:true,capabilities:{...SIMULATOR_CAPABILITIES},createdByUid:existing.data()?.createdByUid||value.uid,updatedBy:actor,createdAt:existing.data()?.createdAt||FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),archivedAt:null},{merge:true});
      await batch.commit();
    }else await ref.set({id:ref.id,businessId:value.businessId,provider:providerId,nickname,externalTerminalId:paired.externalTerminalId,model:paired.model||null,serial:paired.serial||null,merchantId:null,status:'connected',isDefault:existing.data()?.isDefault===true,capabilities:{...SIMULATOR_CAPABILITIES},createdByUid:existing.data()?.createdByUid||value.uid,updatedBy:actor,createdAt:existing.data()?.createdAt||FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),archivedAt:null},{merge:true});
    const saved=await ref.get();return{terminal:{id:saved.id,...saved.data()}};
  }
  async function archiveTerminal(request){
    const value=await context(request,{admin:true}),found=await getIntentOrTerminal(value,request.data?.terminalId,'terminal');
    await found.ref.set({status:'archived',isDefault:false,archivedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),updatedBy:actorOf(value)},{merge:true});
    return{terminalId:found.ref.id,status:'archived'};
  }
  async function getIntentOrTerminal(value,id,type){
    if(type==='intent')return getIntent(value,id);
    const ref=terminalRef(value.businessId,text(id,100)),snapshot=await ref.get();
    if(!snapshot.exists)throw new HttpsError('not-found','Maquininha não encontrada.');
    const data=snapshot.data();if(data.businessId!==value.businessId)throw new HttpsError('permission-denied','Maquininha pertence a outra empresa.');return{ref,snapshot,data};
  }
  async function createPayment(request){
    const value=await context(request),input=request.data||{},idempotencyKey=text(input.idempotencyKey,100),saleDraft=normalizeSaleDraft(input.saleDraft||{});
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey))throw new HttpsError('invalid-argument','Chave idempotente inválida.');
    const terminal=await getIntentOrTerminal(value,input.terminalId,'terminal');
    if(terminal.data.status!=='connected')throw new HttpsError('failed-precondition','A maquininha selecionada não está conectada.');
    if(terminal.data.provider==='simulator'&&!simulatorAllowed(value))throw new HttpsError('permission-denied','Simulador indisponível neste ambiente.');
    const payment=validatePaymentInput(input,terminal.data),simulatorScenario=terminal.data.provider==='simulator'?text(input.simulatorScenario||'approved',30):null,requestHash=sha(JSON.stringify({businessId:value.businessId,saleDraft,terminalId:terminal.ref.id,...payment,simulatorScenario})),intentId=`pi_${sha(`${value.businessId}:${idempotencyKey}`).slice(0,36)}`,ref=intentRef(value.businessId,intentId),actor=actorOf(value),base={
      id:intentId,businessId:value.businessId,saleId:saleDraft.id,terminalId:terminal.ref.id,terminalNickname:terminal.data.nickname,provider:terminal.data.provider,amountCents:payment.amountCents,currency:'BRL',paymentMethod:payment.paymentMethod,installments:payment.installments,status:'created',saleStatus:'payment_pending',active:true,idempotencyKey,requestHash,providerPaymentId:null,providerOrderId:null,createdByUid:value.uid,createdBy:actor,capabilities:terminal.data.capabilities||{},saleDraft,simulatorScenario,finalizationOperationId:`terminal_payment_${intentId}`,finalizationStatus:'pending',failureReason:null,
    };
    const transactionResult=await db.runTransaction(async transaction=>{
      const current=await transaction.get(ref);
      if(current.exists){
        const existing=current.data();
        if(existing.businessId!==value.businessId||existing.requestHash!==requestHash)throw new HttpsError('failed-precondition','Esta tentativa de pagamento já foi usada com outros dados.');
        return{reused:true,data:existing};
      }
      transaction.create(ref,{...base,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
      return{reused:false,data:base};
    });
    if(transactionResult.reused)return{intent:publicIntent(intentId,transactionResult.data),reused:true};
    await recordEvent({businessId:value.businessId,intentId,status:'created',actor});
    const provider=registry.get(terminal.data.provider),created=await provider.createPayment({intent:{...base,id:intentId},terminal:terminal.data}),patch={...created,updatedAt:FieldValue.serverTimestamp()};
    await ref.set(patch,{merge:true});await recordEvent({businessId:value.businessId,intentId,status:created.status,actor,details:{terminalId:terminal.ref.id}});
    return{intent:publicIntent(intentId,{...base,...created}),reused:false};
  }
  async function dispatchPayment(request){
    const value=await context(request),found=await getIntent(value,request.data?.intentId),actor=actorOf(value),leaseUntil=Timestamp.fromMillis(now()+30000);
    const state=await db.runTransaction(async transaction=>{
      const current=await transaction.get(found.ref),data=current.data()||{};
      if(FINAL_STATUSES.has(data.status)||data.status==='pending_confirmation')return{dispatch:false,data};
      if(data.status==='processing'&&timestampMillis(data.processingLeaseUntil)>now())return{dispatch:false,data};
      if(!['created','awaiting_terminal','processing'].includes(data.status))throw new HttpsError('failed-precondition','Cobrança não pode ser enviada neste estado.');
      transaction.set(found.ref,{status:'processing',active:true,processingLeaseUntil:leaseUntil,processingStartedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});return{dispatch:true,data:{...data,status:'processing',active:true}};
    });
    if(!state.dispatch)return{intent:publicIntent(found.ref.id,state.data),reused:true};
    await recordEvent({businessId:value.businessId,intentId:found.ref.id,status:'processing',actor});
    const provider=registry.get(state.data.provider);
    if(typeof provider.dispatchPayment!=='function')throw new HttpsError('failed-precondition','Provider ainda não suporta envio remoto.');
    await new Promise(resolve=>setTimeout(resolve,650));
    let result;
    try{result=await provider.dispatchPayment({intent:state.data,scenario:text(request.data?.simulatorScenario||state.data.simulatorScenario||'approved',30)});}catch(error){result={status:'error',failureReason:text(error.code||'provider_error',100)};}
    const final=await db.runTransaction(async transaction=>{
      const current=await transaction.get(found.ref),data=current.data()||{};
      if(FINAL_STATUSES.has(data.status)||data.status==='pending_confirmation')return data;
      const patch={status:result.status,saleStatus:saleStatusForPayment(result.status),active:ACTIVE_STATUSES.has(result.status)||result.status==='approved',failureReason:result.failureReason||null,approvedAt:result.approvedAt?Timestamp.fromDate(new Date(result.approvedAt)):null,processingLeaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()};
      transaction.set(found.ref,patch,{merge:true});return{...data,...result};
    });
    await recordEvent({businessId:value.businessId,intentId:found.ref.id,status:final.status,actor,source:'provider',details:{reason:final.failureReason||null}});
    return{intent:publicIntent(found.ref.id,final)};
  }
  async function getPaymentStatus(request){const value=await context(request),found=await getIntent(value,request.data?.intentId);return{intent:publicIntent(found.ref.id,found.data),source:'firestore'};}
  async function cancelPayment(request){
    const value=await context(request),found=await getIntent(value,request.data?.intentId),provider=registry.get(found.data.provider),actor=actorOf(value);
    const result=await db.runTransaction(async transaction=>{
      const current=await transaction.get(found.ref),data=current.data()||{};
      if(data.status==='cancelled')return data;
      if(data.status==='approved'||data.finalizationStatus==='completed')throw new HttpsError('failed-precondition','Pagamento aprovado não pode ser cancelado. Use o fluxo de estorno.');
      if(!ACTIVE_STATUSES.has(data.status))throw new HttpsError('failed-precondition','Cobrança não pode ser cancelada neste estado.');
      const cancelled=await provider.cancelPayment({intent:data});
      const patch={status:cancelled.status||'cancelled',saleStatus:'cancelled',active:false,cancelledAt:FieldValue.serverTimestamp(),processingLeaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()};transaction.set(found.ref,patch,{merge:true});return{...data,...patch,status:'cancelled',active:false};
    });
    await recordEvent({businessId:value.businessId,intentId:found.ref.id,status:'cancelled',actor});return{intent:publicIntent(found.ref.id,result)};
  }
  async function refundPayment(request){
    const value=await context(request,{admin:true}),found=await getIntent(value,request.data?.intentId),provider=registry.get(found.data.provider),actor=actorOf(value);
    if(found.data.status!=='approved'||found.data.finalizationStatus!=='completed')throw new HttpsError('failed-precondition','Somente um pagamento aprovado e finalizado pode ser estornado.');
    const result=await provider.refundPayment({intent:found.data}),batch=db.batch();batch.set(found.ref,{...result,active:false,updatedAt:FieldValue.serverTimestamp()},{merge:true});batch.set(db.doc(`${businessPath(value.businessId)}/paymentReceivables/${found.ref.id}`),{status:'refunded',refundedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});await batch.commit();
    await recordEvent({businessId:value.businessId,intentId:found.ref.id,status:'refunded',actor});return{intent:publicIntent(found.ref.id,{...found.data,...result}),saleReversalRequired:true};
  }
  async function claimFinalization(request){
    const value=await context(request),found=await getIntent(value,request.data?.intentId),claimToken=text(request.data?.claimToken,100);
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(claimToken))throw new HttpsError('invalid-argument','Identificador de finalização inválido.');
    return db.runTransaction(async transaction=>{
      const current=await transaction.get(found.ref),data=current.data()||{};
      if(data.status!=='approved')throw new HttpsError('failed-precondition','A venda só pode ser finalizada após a aprovação.');
      if(data.finalizationStatus==='completed')return{claimed:false,completed:true,intent:publicIntent(found.ref.id,data)};
      const leaseActive=timestampMillis(data.finalizationLeaseUntil)>now(),sameClaim=data.finalizationClaimTokenHash===sha(claimToken);
      if(leaseActive&&!sameClaim)return{claimed:false,completed:false,busy:true,intent:publicIntent(found.ref.id,data)};
      transaction.set(found.ref,{finalizationStatus:'claimed',finalizationClaimTokenHash:sha(claimToken),finalizationClaimedByUid:value.uid,finalizationLeaseUntil:Timestamp.fromMillis(now()+60000),updatedAt:FieldValue.serverTimestamp()},{merge:true});return{claimed:true,completed:false,intent:publicIntent(found.ref.id,{...data,finalizationStatus:'claimed'})};
    });
  }
  async function acknowledgeFinalization(request){
    const value=await context(request),found=await getIntent(value,request.data?.intentId),claimToken=text(request.data?.claimToken,100),saleId=text(request.data?.saleId,100),actor=actorOf(value);
    if(!claimToken||sha(claimToken)!==found.data.finalizationClaimTokenHash)throw new HttpsError('permission-denied','Finalização não pertence a esta sessão.');
    if(saleId!==found.data.saleId)throw new HttpsError('failed-precondition','Venda finalizada não corresponde à cobrança.');
    const receivableRef=db.doc(`${businessPath(value.businessId)}/paymentReceivables/${found.ref.id}`),result=await db.runTransaction(async transaction=>{
      const current=await transaction.get(found.ref),data=current.data()||{};
      if(data.finalizationStatus==='completed')return data;
      if(data.status!=='approved'||data.finalizationClaimTokenHash!==sha(claimToken))throw new HttpsError('failed-precondition','A finalização perdeu validade.');
      transaction.set(found.ref,{saleStatus:'paid',active:false,finalizationStatus:'completed',finalizedSaleId:saleId,finalizedAt:FieldValue.serverTimestamp(),finalizationLeaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
      transaction.set(receivableRef,{id:found.ref.id,businessId:value.businessId,paymentIntentId:found.ref.id,saleId,grossAmountCents:data.amountCents,currency:data.currency||'BRL',provider:data.provider,terminalId:data.terminalId,terminalNickname:data.terminalNickname,status:'pending_settlement',feeStatus:'unknown',feeAmountCents:null,netAmountCents:null,expectedSettlement:null,settledAt:null,createdByUid:data.createdByUid,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:false});return{...data,finalizationStatus:'completed',finalizedSaleId:saleId};
    });
    await recordEvent({businessId:value.businessId,intentId:found.ref.id,status:'sale_finalized',actor,source:'sales',details:{saleId}});return{intent:publicIntent(found.ref.id,result),receivableId:found.ref.id};
  }
  async function activePayment(request){
    const value=await context(request),snapshot=await db.collection(`${businessPath(value.businessId)}/paymentIntents`).where('createdByUid','==',value.uid).where('active','==',true).limit(10).get(),rows=snapshot.docs.map(doc=>({id:doc.id,...doc.data()})).filter(item=>item.businessId===value.businessId&&(ACTIVE_STATUSES.has(item.status)||item.status==='approved'&&item.finalizationStatus!=='completed')).sort((a,b)=>timestampMillis(b.updatedAt)-timestampMillis(a.updatedAt));
    return{intent:rows[0]?publicIntent(rows[0].id,rows[0]):null};
  }
  return{getSetup,saveTerminal,archiveTerminal,createPayment,dispatchPayment,getPaymentStatus,cancelPayment,refundPayment,claimFinalization,acknowledgeFinalization,activePayment,publicIntent};
}

module.exports={ACTIVE_STATUSES,FINAL_STATUSES,PAYMENT_METHODS,normalizeSaleDraft,validatePaymentInput,publicIntent,saleStatusForPayment,terminalPaymentService};
