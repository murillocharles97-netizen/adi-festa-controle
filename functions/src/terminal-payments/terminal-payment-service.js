'use strict';

const crypto=require('node:crypto');
const {FieldValue,Timestamp}=require('firebase-admin/firestore');
const {HttpsError}=require('firebase-functions/v2/https');
const {ProviderRegistry}=require('./provider-registry');
const {SIMULATOR_CAPABILITIES}=require('./providers/simulator-provider');
const {MOCK_CAPABILITIES}=require('./providers/mock-provider');
const {assertTransition}=require('./payment-state-machine');
const {assertWritable}=require('../services/workspace-reset-policy');
const {workspaceWriteFence}=require('../services/workspace-write-fence');
const {computeAccess}=require('../services/subscription-service');
function requireTerminalPlan(value){const access=computeAccess(value.business?.subscription||{});if(!access.canMutate||(!access.unlimited&&!access.features.paymentTerminalIntegration))throw new HttpsError('failed-precondition','Integração com maquininhas está no plano Pro.',{code:'subscription_feature_required',feature:'paymentTerminalIntegration',requiredPlan:'premium'});}
const isMock=provider=>['mock','simulator'].includes(provider);
const allowedSpace=(context,id)=>!context.member||context.member.role==='owner'||context.member.spaceAccess==='all'||context.member.allowedSpaceIds?.includes(id);
const terminalAllows=(terminal,id)=>terminal.active!==false&&terminal.status==='connected'&&(terminal.spaceAccess!=='selected_spaces'||terminal.allowedSpaceIds?.includes(id));

const ACTIVE_STATUSES=new Set(['created','awaiting_terminal','processing','pending_confirmation']);
const FINAL_STATUSES=new Set(['approved','declined','cancelled','expired','error','refunded']);
const PAYMENT_METHODS=new Set(['credit','debit']);
const RESERVED_SPACE_IDS=new Set(['all','all_spaces']);
const ROLES=new Set(['owner','admin','manager','cashier','seller']);
const PROVIDERS=Object.freeze([
  {id:'mock',name:'Terminal de teste VECONI',availability:'restricted'},
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
  const id=text(input.id,100),spaceId=text(input.spaceId,120),financialSpaceId=text(input.financialSpaceId,120)||spaceId,items=Array.isArray(input.itens)?input.itens:Array.isArray(input.items)?input.items:[];
  if(!/^[A-Za-z0-9_-]{8,100}$/.test(id))throw new HttpsError('invalid-argument','Identificador da venda inválido.');
  if(RESERVED_SPACE_IDS.has(spaceId)||!/^[A-Za-z0-9_-]{3,120}$/.test(spaceId))throw new HttpsError('invalid-argument','Espaço de venda inválido.');
  if(RESERVED_SPACE_IDS.has(financialSpaceId)||!/^[A-Za-z0-9_-]{3,120}$/.test(financialSpaceId))throw new HttpsError('invalid-argument','Espaço financeiro legado inválido.');
  if(financialSpaceId!==spaceId)throw new HttpsError('invalid-argument','O espaço financeiro legado deve corresponder ao espaço da venda.');
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
      itemKind:text(item.itemKind,30)==='service'?'service':'product',
      productType:text(item.productType,30)||'simple',
      recurringActivation:item.recurringActivation&&typeof item.recurringActivation==='object'?item.recurringActivation:null,
      campaignDiscounts:Array.isArray(item.campaignDiscounts)?item.campaignDiscounts.slice(0,20):[],
    };
  });
  return{
    id,
    spaceId,
    financialSpaceId,
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
    workspaceGeneration:data.workspaceGeneration??0,
    spaceId:data.spaceId||data.saleDraft?.spaceId||null,
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
    actorUid:data.actorUid||data.createdByUid,
    actor:data.createdBy||null,
    cartFingerprint:data.cartFingerprint||data.requestHash,
    operationId:data.finalizationOperationId,
    isTest:isMock(data.provider),
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
  function inWorkspace(value,action){
    return workspaceWriteFence(db,value).runTransaction(transaction=>action(new Proxy(transaction,{
      get(target,key){
        if(['set','create','update'].includes(key))return(ref,data,...options)=>{
          if(!ref.path.startsWith(`${businessPath(value.businessId)}/`))throw new HttpsError('permission-denied','Destino de pagamento fora da empresa.');
          return target[key](ref,{...data,workspaceGeneration:value.workspaceGeneration},...options);
        };
        return typeof target[key]==='function'?target[key].bind(target):target[key];
      },
    })));
  }
  async function context(request,{admin=false}={}){
    const businessId=text(request.data?.businessId||request.data?.companyId,100),value=await permissions().authenticatedContext(request,businessId,{ownerOnly:false});
    if(!ROLES.has(value.profile?.role))throw new HttpsError('permission-denied','Seu perfil não pode operar pagamentos.');
    if(value.member&&value.profile.role!=='owner'&&value.member.permissions?.['sales.create']!==true)throw new HttpsError('permission-denied','Seu acesso não permite realizar vendas.');
    if(admin&&!['owner','admin'].includes(value.profile?.role))throw new HttpsError('permission-denied','Somente proprietário ou administrador pode gerenciar maquininhas.');
    const workspaceGeneration=request.data?.workspaceGeneration??0;
    assertWritable(value.business,workspaceGeneration);
    return{...value,businessId,workspaceGeneration};
  }
  const simulatorAllowed=value=>process.env.FUNCTIONS_EMULATOR==='true'||(value.businessId==='adi-festa'&&value.business?.subscription?.planId==='internal')||(value.business?.paymentFeatures?.integratedPaymentsV1===true&&value.business?.paymentFeatures?.mock===true);
  function persistTransitionEvent(transaction,ref,status,actor,source='engine'){
    const event=ref.collection('events').doc(`${source}_${status}`);
    transaction.set(event,{id:event.id,businessId:ref.parent.parent.id,intentId:ref.id,type:`payment_${status}`,status,source,actor,createdAt:FieldValue.serverTimestamp()});
  }
  async function recordEvent({businessId,workspaceGeneration=0,intentId,status,actor,source='engine',details={}}){
    const ref=intentRef(businessId,intentId).collection('events').doc(`${source}_${status}`);
    try{await inWorkspace({businessId,workspaceGeneration},transaction=>transaction.create(ref,{id:ref.id,businessId,intentId,type:`payment_${status}`,status,source,actor,details,createdAt:FieldValue.serverTimestamp()}));}catch(error){if(error.code!==6&&error.code!=='already-exists')throw error;}
  }
  async function getIntent(contextValue,id){
    const ref=intentRef(contextValue.businessId,text(id,100)),snapshot=await ref.get();
    if(!snapshot.exists)throw new HttpsError('not-found','Cobrança não encontrada.');
    const data=snapshot.data();
    if(data.businessId!==contextValue.businessId)throw new HttpsError('permission-denied','Cobrança pertence a outra empresa.');
    if((data.workspaceGeneration??0)!==contextValue.workspaceGeneration)throw new HttpsError('failed-precondition','Cobrança de uma configuração anterior.');
    if(!allowedSpace(contextValue,data.spaceId)||data.createdByUid!==contextValue.uid&&contextValue.profile.role!=='owner')throw new HttpsError('permission-denied','Você não tem acesso a este pagamento.');
    return{ref,snapshot,data};
  }
  async function getSetup(request){
    const value=await context(request),snapshot=await db.collection(`${businessPath(value.businessId)}/paymentTerminals`).get(),terminals=snapshot.docs.map(doc=>({id:doc.id,...doc.data()})).filter(item=>item.businessId===value.businessId&&item.status!=='archived').sort((a,b)=>Number(b.isDefault)-Number(a.isDefault)||String(a.nickname).localeCompare(String(b.nickname),'pt-BR'));
    const integrityIssues=[];
    if(request.data?.audit===true&&['owner','admin'].includes(value.profile.role)){
      const pending=await db.collection(`${businessPath(value.businessId)}/paymentIntents`).where('status','==','approved').where('active','==',true).limit(10).get();
      for(const intent of pending.docs){const data=intent.data(),sale=await db.doc(`${businessPath(value.businessId)}/sales/${data.saleId}`).get();if(!sale.exists)integrityIssues.push({level:'critical',code:'approved_without_sale',intentId:intent.id,amountCents:data.amountCents,terminalNickname:data.terminalNickname,actorUid:data.createdByUid});}
      const recent=await db.collection(`${businessPath(value.businessId)}/sales`).orderBy('createdAt','desc').limit(25).get();
      for(const sale of recent.docs){const data=sale.data();if(data.formaPagamento!=='cartao_presencial'&&!data.paymentIntentId)continue;const payment=data.paymentIntentId?(await intentRef(value.businessId,text(data.paymentIntentId,100)).get()).data():null;if(!payment||payment.status!=='approved'||payment.saleId!==sale.id||payment.amountCents!==Math.round(Number(data.valorFinal)*100))integrityIssues.push({level:'critical',code:'sale_without_matching_approved_payment',saleId:sale.id,intentId:data.paymentIntentId||null,amountCents:Math.round(Number(data.valorFinal)*100)});}
    }
    return{
      integrityIssues,
      integrityCoverage:request.data?.audit===true?'recent_25_sales_and_10_pending_approvals':'not_requested',
      simulatorAllowed:simulatorAllowed(value),
      providers:PROVIDERS.map(provider=>({...provider,availability:provider.id==='simulator'?(simulatorAllowed(value)?(terminals.some(item=>item.provider==='simulator')?'connected':'available'):'restricted'):terminals.some(item=>item.provider===provider.id)?'connected':provider.availability})),
      integratedPaymentsEnabled:simulatorAllowed(value),
      terminals:terminals.filter(item=>!isMock(item.provider)||simulatorAllowed(value)).filter(item=>request.data?.spaceId?allowedSpace(value,request.data.spaceId)&&terminalAllows(item,request.data.spaceId):!value.member||value.member.role==='owner'||value.member.spaceAccess==='all'||(value.member.allowedSpaceIds||[]).some(id=>terminalAllows(item,id))),
    };
  }
  async function saveTerminal(request){
    const value=await context(request,{admin:true}),input=request.data?.terminal||{},providerId=text(input.provider||'mock',40);
    requireTerminalPlan(value);
    if(!isMock(providerId))throw new HttpsError('failed-precondition','Este provider ainda não está disponível na Fase 1.');
    if(!simulatorAllowed(value))throw new HttpsError('permission-denied','O simulador está restrito ao ambiente interno ou de testes.');
    const provider=registry.get(providerId),nickname=text(input.nickname||'Simulador Caixa 1',60);
    if(nickname.length<2)throw new HttpsError('invalid-argument','Informe um nome para a maquininha.');
    const requestedId=text(input.id,100),ref=requestedId?terminalRef(value.businessId,requestedId):db.collection(`${businessPath(value.businessId)}/paymentTerminals`).doc(),existing=await ref.get();
    if(existing.exists&&existing.data()?.businessId!==value.businessId)throw new HttpsError('permission-denied','Maquininha pertence a outra empresa.');
    const scope={spaceAccess:input.spaceAccess||existing.data()?.spaceAccess||'all_spaces',allowedSpaceIds:[...new Set(input.allowedSpaceIds||existing.data()?.allowedSpaceIds||[])],active:input.active!==false};
    if(!['all_spaces','selected_spaces'].includes(scope.spaceAccess)||scope.spaceAccess==='selected_spaces'&&!scope.allowedSpaceIds.length)throw new HttpsError('invalid-argument','Selecione ao menos um espaço autorizado.');
    for(const id of scope.allowedSpaceIds){if(!/^[\w-]{3,120}$/.test(id))throw new HttpsError('invalid-argument','Espaço inválido.');const space=(await db.doc(`financialSpaces/${id}`).get()).data();if(!space||(space.businessId||space.linkedBusinessId)!==value.businessId||!allowedSpace(value,id))throw new HttpsError('permission-denied','Espaço não autorizado.');}
    const paired=existing.exists?existing.data():await provider.pairTerminal({nickname}),actor=actorOf(value),isDefault=input.isDefault===true||input.makeDefault===true;
    if(isDefault){
      await inWorkspace(value,async batch=>{
      const all=await batch.get(db.collection(`${businessPath(value.businessId)}/paymentTerminals`).where('isDefault','==',true));
      all.docs.forEach(doc=>batch.set(doc.ref,{isDefault:false,updatedAt:FieldValue.serverTimestamp()},{merge:true}));
      batch.set(ref,{id:ref.id,businessId:value.businessId,provider:providerId,nickname,externalTerminalId:paired.externalTerminalId,model:paired.model||null,serial:paired.serial||null,merchantId:null,status:'connected',isDefault:true,...scope,capabilities:providerId==='mock'?{...MOCK_CAPABILITIES}:{...SIMULATOR_CAPABILITIES},createdByUid:existing.data()?.createdByUid||value.uid,updatedBy:actor,createdAt:existing.data()?.createdAt||FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),archivedAt:null},{merge:true});
      });
    }else await inWorkspace(value,transaction=>transaction.set(ref,{id:ref.id,businessId:value.businessId,provider:providerId,nickname,externalTerminalId:paired.externalTerminalId,model:paired.model||null,serial:paired.serial||null,merchantId:null,status:'connected',isDefault:existing.data()?.isDefault===true,...scope,capabilities:providerId==='mock'?{...MOCK_CAPABILITIES}:{...SIMULATOR_CAPABILITIES},createdByUid:existing.data()?.createdByUid||value.uid,updatedBy:actor,createdAt:existing.data()?.createdAt||FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),archivedAt:null},{merge:true}));
    const saved=await ref.get();return{terminal:{id:saved.id,...saved.data()}};
  }
  async function archiveTerminal(request){
    const value=await context(request,{admin:true}),found=await getIntentOrTerminal(value,request.data?.terminalId,'terminal');
    await inWorkspace(value,transaction=>transaction.set(found.ref,{status:'archived',isDefault:false,archivedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp(),updatedBy:actorOf(value)},{merge:true}));
    return{terminalId:found.ref.id,status:'archived'};
  }
  async function getIntentOrTerminal(value,id,type){
    if(type==='intent')return getIntent(value,id);
    const ref=terminalRef(value.businessId,text(id,100)),snapshot=await ref.get();
    if(!snapshot.exists)throw new HttpsError('not-found','Maquininha não encontrada.');
    const data=snapshot.data();if(data.businessId!==value.businessId)throw new HttpsError('permission-denied','Maquininha pertence a outra empresa.');return{ref,snapshot,data};
  }
  async function createPayment(request){
    const value=await context(request);
    requireTerminalPlan(value);
    const input=request.data||{},idempotencyKey=text(input.idempotencyKey,100),saleDraft=normalizeSaleDraft(input.saleDraft||{});
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(idempotencyKey))throw new HttpsError('invalid-argument','Chave idempotente inválida.');
    const saleSpaceSnapshot=await db.doc(`financialSpaces/${saleDraft.spaceId}`).get(),saleSpace=saleSpaceSnapshot.data()||{},saleSpaceBusinessId=text(saleSpace.businessId||saleSpace.linkedBusinessId,100);
    if(!saleSpaceSnapshot.exists)throw new HttpsError('not-found','Espaço de venda não encontrado.');
    if(saleSpaceBusinessId!==value.businessId)throw new HttpsError('permission-denied','Espaço de venda pertence a outra empresa.');
    if(!allowedSpace(value,saleDraft.spaceId))throw new HttpsError('permission-denied','Seu acesso não permite vender neste espaço.');
    const legacyBusinessSalesSpace=!saleSpace.capabilities&&saleSpace.type==='business';
    if(saleSpace.active===false||saleSpace.status==='archived'||(saleSpace.capabilities?.sales!==true&&!legacyBusinessSalesSpace))throw new HttpsError('failed-precondition','Este espaço não está ativo para vendas.');
    const terminal=await getIntentOrTerminal(value,input.terminalId,'terminal');
    if(terminal.data.status!=='connected')throw new HttpsError('failed-precondition','A maquininha selecionada não está conectada.');
    if(!terminalAllows(terminal.data,saleDraft.spaceId))throw new HttpsError('permission-denied','Terminal não autorizado para este espaço.');
    if(isMock(terminal.data.provider)&&!simulatorAllowed(value))throw new HttpsError('permission-denied','Simulador indisponível neste ambiente.');
    const cartAmount=Math.round(saleDraft.itens.reduce((sum,item)=>sum+item.quantidade*item.precoFinalUnitario,0)*100);
    if(cartAmount!==Number(input.amountCents))throw new HttpsError('failed-precondition','Total da cobrança não corresponde aos itens do carrinho.');
    const productIds=[...new Set(saleDraft.itens.map(item=>item.produtoId))];
    if(productIds.some(id=>!/^[\w-]{1,100}$/.test(id)))throw new HttpsError('invalid-argument','Produto inválido.');
    const products=await db.getAll(...productIds.map(id=>db.doc(`${businessPath(value.businessId)}/products/${id}`)));
    for(const snapshot of products){const product=snapshot.data();if(!product||product.businessId!==value.businessId||product.deleted===true||product.active===false||product.ativo===false)throw new HttpsError('failed-precondition','Produto indisponível. Atualize o carrinho.');if(['selected_spaces','single_space'].includes(product.spaceAccessMode)&&!product.allowedSpaceIds?.includes(saleDraft.spaceId))throw new HttpsError('permission-denied','Produto não disponível neste espaço.');}
    const payment=validatePaymentInput(input,terminal.data),simulatorScenario='manual',requestHash=sha(JSON.stringify({businessId:value.businessId,saleDraft,terminalId:terminal.ref.id,...payment,simulatorScenario})),intentId=`pi_${sha(`${value.businessId}:${idempotencyKey}`).slice(0,36)}`,ref=intentRef(value.businessId,intentId),actor=actorOf(value),base={
      id:intentId,actorUid:value.uid,cartFingerprint:requestHash,checkoutId:saleDraft.id,isTest:isMock(terminal.data.provider),businessId:value.businessId,spaceId:saleDraft.spaceId,saleId:saleDraft.id,terminalId:terminal.ref.id,terminalNickname:terminal.data.nickname,provider:terminal.data.provider,amountCents:payment.amountCents,currency:'BRL',paymentMethod:payment.paymentMethod,installments:payment.installments,status:'created',saleStatus:'payment_pending',active:true,idempotencyKey,requestHash,providerPaymentId:null,providerOrderId:null,createdByUid:value.uid,createdBy:actor,capabilities:terminal.data.capabilities||{},saleDraft,simulatorScenario,finalizationOperationId:`terminal_payment_${intentId}`,finalizationStatus:'pending',failureReason:null,
    };
    const transactionResult=await inWorkspace(value,async transaction=>{
      const lockRef=db.doc(`${businessPath(value.businessId)}/paymentCheckoutLocks/${value.uid}`),lock=await transaction.get(lockRef),previous=lock.data()?.intentId?await transaction.get(intentRef(value.businessId,lock.data().intentId)):null;
      const current=await transaction.get(ref),sale=await transaction.get(db.doc(`${businessPath(value.businessId)}/sales/${saleDraft.id}`));
      if(current.exists){
        const existing=current.data();
        if(existing.businessId!==value.businessId||existing.createdByUid!==value.uid||existing.requestHash!==requestHash)throw new HttpsError('failed-precondition','Esta tentativa de pagamento já foi usada com outros dados.');
        return{reused:true,data:existing};
      }
      if(sale.exists)throw new HttpsError('failed-precondition','Este checkout já possui uma venda concluída. Não cobre novamente.');
      if(previous?.exists&&previous.data().active===true)throw new HttpsError('failed-precondition','Existe um pagamento em andamento. Verifique o resultado antes de iniciar outra cobrança.');
      transaction.set(lockRef,{intentId,businessId:value.businessId,actorUid:value.uid,updatedAt:FieldValue.serverTimestamp()});
      transaction.create(ref,{...base,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()});
      persistTransitionEvent(transaction,ref,'created',actor);
      return{reused:false,data:base};
    });
    if(transactionResult.reused){const data=transactionResult.data.status==='created'?await prepareProviderIntent(value,ref):transactionResult.data;return{intent:publicIntent(intentId,data),reused:true};}
    await recordEvent({businessId:value.businessId,workspaceGeneration:value.workspaceGeneration,intentId,status:'created',actor});
    const prepared=await prepareProviderIntent(value,ref);
    return{intent:publicIntent(intentId,prepared),reused:false};
  }
  async function prepareProviderIntent(value,ref){
    const snapshot=await ref.get(),intent=snapshot.data();
    if(intent.status!=='created')return intent;
    const terminal=await getIntentOrTerminal(value,intent.terminalId,'terminal'),provider=registry.get(intent.provider);
    let created;
    try{created=await provider.createPayment({intent,terminal:terminal.data});}
    catch(error){created={status:'pending_confirmation',failureReason:text(error.code||'provider_network_error',100)};}
    const result=await inWorkspace(value,async transaction=>{
      const current=(await transaction.get(ref)).data();
      if(current.status!=='created')return current;
      assertTransition(current.status,created.status);
      transaction.set(ref,{...created,updatedAt:FieldValue.serverTimestamp()},{merge:true});
      persistTransitionEvent(transaction,ref,created.status,actorOf(value));
      return{...current,...created};
    });
    await recordEvent({businessId:value.businessId,workspaceGeneration:value.workspaceGeneration,intentId:ref.id,status:result.status,actor:actorOf(value)});
    return result;
  }
  async function dispatchPayment(request){
    const value=await context(request),found=await getIntent(value,request.data?.intentId),actor=actorOf(value),leaseUntil=Timestamp.fromMillis(now()+30000);
    if(found.data.status==='created')found.data=await prepareProviderIntent(value,found.ref);
    const scenario=text(request.data?.simulatorScenario||'manual',30),simulate=scenario!=='manual';
    if(simulate&&(!isMock(found.data.provider)||!simulatorAllowed(value)))throw new HttpsError('permission-denied','Controles de teste não autorizados.');
    const state=await inWorkspace(value,async transaction=>{
      const current=await transaction.get(found.ref),data=current.data()||{};
      if(FINAL_STATUSES.has(data.status)||data.status==='pending_confirmation'&&!simulate)return{dispatch:false,data};
      if(data.status==='processing'&&timestampMillis(data.processingLeaseUntil)>now()&&!simulate)return{dispatch:false,data};
      if(!ACTIVE_STATUSES.has(data.status))throw new HttpsError('failed-precondition','Cobrança não pode ser enviada neste estado.');
      assertTransition(data.status,'processing');
      transaction.set(found.ref,{status:'processing',active:true,processingLeaseUntil:leaseUntil,processingStartedAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:true});persistTransitionEvent(transaction,found.ref,'processing',actor);return{dispatch:true,data:{...data,status:'processing',active:true}};
    });
    if(!state.dispatch)return{intent:publicIntent(found.ref.id,state.data),reused:true};
    await recordEvent({businessId:value.businessId,workspaceGeneration:value.workspaceGeneration,intentId:found.ref.id,status:'processing',actor});
    const provider=registry.get(state.data.provider);
    if(typeof provider.dispatchPayment!=='function')throw new HttpsError('failed-precondition','Provider ainda não suporta envio remoto.');
    await new Promise(resolve=>setTimeout(resolve,650));
    let result;
    try{result=scenario==='manual'?{status:'processing'}:await provider.dispatchPayment({intent:state.data,scenario});}catch(error){result={status:'pending_confirmation',failureReason:text(error.code||'provider_network_error',100)};}
    const final=await inWorkspace(value,async transaction=>{
      const current=await transaction.get(found.ref),data=current.data()||{};
      if(FINAL_STATUSES.has(data.status)||data.status==='pending_confirmation')return data;
      assertTransition(data.status,result.status);
      const patch={status:result.status,saleStatus:saleStatusForPayment(result.status),active:ACTIVE_STATUSES.has(result.status)||result.status==='approved',failureReason:result.failureReason||null,approvedAt:result.approvedAt?Timestamp.fromDate(new Date(result.approvedAt)):null,...(result.status==='declined'?{declinedAt:FieldValue.serverTimestamp()}:{}),...(result.status==='expired'?{expiredAt:FieldValue.serverTimestamp()}:{}),...(result.status==='cancelled'?{cancelledAt:FieldValue.serverTimestamp()}:{}),processingLeaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()};
      transaction.set(found.ref,patch,{merge:true});persistTransitionEvent(transaction,found.ref,result.status,actor,'provider');return{...data,...result};
    });
    await recordEvent({businessId:value.businessId,workspaceGeneration:value.workspaceGeneration,intentId:found.ref.id,status:final.status,actor,source:'provider',details:{reason:final.failureReason||null}});
    return{intent:publicIntent(found.ref.id,final)};
  }
  async function getPaymentStatus(request){const value=await context(request),found=await getIntent(value,request.data?.intentId),provider=registry.get(found.data.provider);const outcome=await provider.getPaymentStatus({intent:found.data});if(outcome.status!==found.data.status)throw new HttpsError('failed-precondition','Resultado diferente exige reconciliação auditável do provider.');return{intent:publicIntent(found.ref.id,found.data),source:'provider'};}
  async function cancelPayment(request){
    const value=await context(request),found=await getIntent(value,request.data?.intentId),provider=registry.get(found.data.provider),actor=actorOf(value);
    if(found.data.status==='cancelled')return{intent:publicIntent(found.ref.id,found.data)};
    if(!ACTIVE_STATUSES.has(found.data.status))throw new HttpsError('failed-precondition','Pagamento não pode ser cancelado neste estado.');
    const cancellation=await provider.cancelPayment({intent:found.data});
    if(cancellation.status!=='cancelled')throw new HttpsError('failed-precondition','Cancelamento não confirmado. Verifique o pagamento; não cobre novamente.');
    const result=await inWorkspace(value,async transaction=>{
      const current=await transaction.get(found.ref),data=current.data()||{};
      if(data.status==='cancelled')return data;
      if(data.status==='approved'||data.finalizationStatus==='completed')throw new HttpsError('failed-precondition','Pagamento aprovado não pode ser cancelado. Use o fluxo de estorno.');
      if(!ACTIVE_STATUSES.has(data.status))throw new HttpsError('failed-precondition','Cobrança não pode ser cancelada neste estado.');
      assertTransition(data.status,'cancelled');
      const patch={status:'cancelled',saleStatus:'cancelled',active:false,cancelledAt:FieldValue.serverTimestamp(),processingLeaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()};transaction.set(found.ref,patch,{merge:true});persistTransitionEvent(transaction,found.ref,'cancelled',actor);return{...data,...patch,status:'cancelled',active:false};
    });
    await recordEvent({businessId:value.businessId,workspaceGeneration:value.workspaceGeneration,intentId:found.ref.id,status:'cancelled',actor});return{intent:publicIntent(found.ref.id,result)};
  }
  async function refundPayment(request){
    throw new HttpsError('failed-precondition','Pagamento integrado requer estorno. Estorno não implementado nesta V1.');

  }
  async function claimFinalization(request){
    const value=await context(request),found=await getIntent(value,request.data?.intentId),claimToken=text(request.data?.claimToken,100);
    if(!/^[A-Za-z0-9_-]{16,100}$/.test(claimToken))throw new HttpsError('invalid-argument','Identificador de finalização inválido.');
    return inWorkspace(value,async transaction=>{
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
    const receivableRef=db.doc(`${businessPath(value.businessId)}/paymentReceivables/${found.ref.id}`),result=await inWorkspace(value,async transaction=>{
      const current=await transaction.get(found.ref),data=current.data()||{};
      if(data.finalizationStatus==='completed')return data;
      if(data.status!=='approved'||data.finalizationClaimTokenHash!==sha(claimToken))throw new HttpsError('failed-precondition','A finalização perdeu validade.');
      const saleSnapshot=await transaction.get(db.doc(`${businessPath(value.businessId)}/sales/${saleId}`)),sale=saleSnapshot.data();
      if(!sale||sale.paymentIntentId!==found.ref.id||sale.operationId!==data.finalizationOperationId||sale.spaceId!==data.spaceId||sale.actorUid!==data.createdByUid||Math.round(Number(sale.valorFinal)*100)!==data.amountCents)throw new HttpsError('failed-precondition','Pagamento aprovado aguardando conclusão da venda na nuvem. Não cobre novamente.');
      transaction.set(found.ref,{saleStatus:'paid',active:false,finalizationStatus:'completed',finalizedSaleId:saleId,finalizedAt:FieldValue.serverTimestamp(),finalizationLeaseUntil:FieldValue.delete(),updatedAt:FieldValue.serverTimestamp()},{merge:true});
      persistTransitionEvent(transaction,found.ref,'sale_finalized',actor,'sales');
      transaction.set(receivableRef,{id:found.ref.id,businessId:value.businessId,paymentIntentId:found.ref.id,saleId,actorUid:data.createdByUid,spaceId:data.spaceId,isTest:isMock(data.provider),grossAmountCents:data.amountCents,currency:data.currency||'BRL',provider:data.provider,terminalId:data.terminalId,terminalNickname:data.terminalNickname,status:'pending_settlement',feeStatus:'unknown',feeAmountCents:null,netAmountCents:null,expectedSettlement:null,settledAt:null,createdByUid:data.createdByUid,createdAt:FieldValue.serverTimestamp(),updatedAt:FieldValue.serverTimestamp()},{merge:false});return{...data,finalizationStatus:'completed',finalizedSaleId:saleId};
    });
    await recordEvent({businessId:value.businessId,workspaceGeneration:value.workspaceGeneration,intentId:found.ref.id,status:'sale_finalized',actor,source:'sales',details:{saleId}});return{intent:publicIntent(found.ref.id,result),receivableId:found.ref.id};
  }
  async function activePayment(request){
    const value=await context(request),snapshot=await db.collection(`${businessPath(value.businessId)}/paymentIntents`).where('createdByUid','==',value.uid).where('active','==',true).limit(10).get(),rows=snapshot.docs.map(doc=>({id:doc.id,...doc.data()})).filter(item=>item.businessId===value.businessId&&(ACTIVE_STATUSES.has(item.status)||item.status==='approved'&&item.finalizationStatus!=='completed')).sort((a,b)=>timestampMillis(b.updatedAt)-timestampMillis(a.updatedAt));
    return{intent:rows[0]?publicIntent(rows[0].id,rows[0]):null};
  }
  return{getSetup,saveTerminal,archiveTerminal,createPayment,dispatchPayment,getPaymentStatus,cancelPayment,refundPayment,claimFinalization,acknowledgeFinalization,activePayment,publicIntent};
}

module.exports={ACTIVE_STATUSES,FINAL_STATUSES,PAYMENT_METHODS,RESERVED_SPACE_IDS,normalizeSaleDraft,validatePaymentInput,publicIntent,saleStatusForPayment,terminalPaymentService};
