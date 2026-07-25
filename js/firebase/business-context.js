const DAY=86400000;
export const APP_NAME='Adi Festa Controle';
export const INTERNAL_BUSINESS_ID='adi-festa';

const OPERATION_FEATURES={products:true,clients:true,sales:true,payments:true,creditAccounts:true,stock:true,barcode:true,cloudBackup:true,recentHistory:true,basicDashboard:true,reports:true};
const GROWTH_FEATURES={campaigns:true,onlineCatalog:true,onlineOrders:true,bulkMessages:true,loyalty:true,advancedStock:true,dataImport:true,advancedReports:true};
const PREMIUM_FEATURES={multipleUsers:true,rolesPermissions:true,advancedExports:true,automations:true,prioritySupport:true,multipleStocks:false,multipleUnits:false};
const allFeatures={...OPERATION_FEATURES,...GROWTH_FEATURES,...PREMIUM_FEATURES};

export const PLANS={
  trial:{id:'trial',name:'Teste grátis',summary:'Todos os recursos do Profissional por 7 dias.',monthlyPrice:0,yearlyPrice:0,trialDays:7,features:{...OPERATION_FEATURES,...GROWTH_FEATURES,multipleUsers:true,prioritySupport:true,rolesPermissions:false,advancedExports:false,automations:false,multipleStocks:false,multipleUnits:false},limits:{users:3,products:300,clients:500,monthlySales:1500}},
  essential:{id:'essential',name:'Essencial',summary:'Organize o básico do seu negócio.',monthlyPrice:29.90,yearlyPrice:299,trialDays:7,features:{...OPERATION_FEATURES,campaigns:false,onlineCatalog:false,onlineOrders:false,bulkMessages:false,loyalty:false,advancedStock:false,dataImport:false,advancedReports:false,multipleUsers:false,rolesPermissions:false,advancedExports:false,automations:false,prioritySupport:false,multipleStocks:false,multipleUnits:false},limits:{users:1,products:300,clients:500,monthlySales:1500}},
  professional:{id:'professional',name:'Profissional',summary:'Mais recursos para vender e crescer.',monthlyPrice:49.90,yearlyPrice:499,trialDays:7,recommended:true,features:{...OPERATION_FEATURES,...GROWTH_FEATURES,multipleUsers:true,prioritySupport:true,rolesPermissions:false,advancedExports:false,automations:false,multipleStocks:false,multipleUnits:false},limits:{users:3,products:2000,clients:5000,monthlySales:10000}},
  premium:{id:'premium',name:'Premium',summary:'Para negócios que querem o máximo.',monthlyPrice:79.90,yearlyPrice:799,trialDays:7,features:{...allFeatures},limits:{users:10,products:10000,clients:25000,monthlySales:50000}},
  internal:{id:'internal',name:'Plano interno',summary:'Todos os recursos liberados.',monthlyPrice:0,yearlyPrice:0,trialDays:0,features:{...allFeatures,multipleStocks:true,multipleUnits:true},limits:{users:999,products:999999,clients:999999,monthlySales:999999}}
};

const ROLE_PERMISSIONS={
  platform_admin:['*'],
  owner:['manageBusiness','manageSubscription','manageUsers','manageProducts','manageClients','manageSales','manageStock','manageCampaigns','viewReports'],
  admin:['manageProducts','manageClients','manageSales','manageStock','manageCampaigns','viewReports'],
  manager:['manageProducts','manageClients','manageSales','manageStock','manageCampaigns','viewReports'],
  cashier:['manageClients','manageSales'],
  viewer:['viewReports']
};

const toDate=value=>{
  if(!value)return null;
  if(typeof value.toDate==='function')return value.toDate();
  const date=new Date(value);
  return Number.isNaN(date.getTime())?null:date;
};

export function getSubscriptionAccess(subscription={},limits={},at=new Date()){
  return resolveSubscriptionAccess(subscription,limits,at);
}

export function resolveSubscriptionAccess(input={},legacyLimits={},legacyNow=new Date()){
  const structuredInput=Boolean(input&&('business' in input||'subscription' in input||'now' in input));
  const business=structuredInput?input.business||{}:{};
  const subscription=structuredInput?input.subscription||business.subscription||{}:input||{};
  const limits=structuredInput?input.limits||business.limits||{}:legacyLimits||{};
  const at=structuredInput?input.now||new Date():legacyNow;
  const internalFallback=business.id===INTERNAL_BUSINESS_ID&&!subscription.planId;
  const subscriptionFallback=structuredInput&&Boolean(business.id)&&business.id!==INTERNAL_BUSINESS_ID&&!subscription.planId;
  const safeSubscription=internalFallback?{planId:'internal',status:'active'}:subscriptionFallback?{planId:'essential',status:'active'}:subscription;
  const unknownPlan=Boolean(safeSubscription.planId&&!PLANS[safeSubscription.planId]);
  const planId=unknownPlan?'essential':PLANS[safeSubscription.planId]?safeSubscription.planId:'trial',basePlan=PLANS[planId],status=String(safeSubscription.status||'trial'),trialEnd=toDate(safeSubscription.trialEndsAt),periodEnd=toDate(safeSubscription.currentPeriodEnd),graceEnd=toDate(safeSubscription.gracePeriodEndsAt),featureTrial=structuredInput?input.featureTrial||safeSubscription.featureTrial||{}:safeSubscription.featureTrial||{},featureTrialEnd=toDate(featureTrial.endsAt);
  const daysRemaining=trialEnd?Math.max(0,Math.ceil((trialEnd-at)/DAY)):periodEnd?Math.max(0,Math.ceil((periodEnd-at)/DAY)):null;
  const trialValid=status==='trial'&&trialEnd&&trialEnd>=at;
  const internal=planId==='internal'&&['active','internal'].includes(status),active=internal||status==='active'||trialValid||status==='grace_period'&&(!graceEnd||graceEnd>=at);
  const expired=status==='expired'||status==='cancelled'||status==='suspended'||status==='trial'&&!trialValid||status==='past_due'&&graceEnd&&graceEnd<at;
  const featureTrialActive=planId==='essential'&&featureTrial.status==='active'&&featureTrial.used===true&&featureTrialEnd&&featureTrialEnd>=at;
  const effectivePlan=internal?PLANS.internal:trialValid||featureTrialActive?PLANS.professional:basePlan;
  const effectiveLimits={...effectivePlan.limits,...limits};
  const features={...effectivePlan.features};
  if(limits.catalogEnabled!==undefined)features.onlineCatalog=limits.catalogEnabled;
  if(limits.campaignsEnabled!==undefined)features.campaigns=limits.campaignsEnabled;
  return{
    canAccessApp:active&&!expired,
    canUseApp:active&&!expired,
    canCreateData:active&&!expired,
    canUseCatalog:active&&!expired&&features.onlineCatalog===true,
    canUseCampaigns:active&&!expired&&features.campaigns===true,
    accessMode:internal?'internal':active&&!expired?'full':'blocked',
    showBillingWarning:status==='trial'&&daysRemaining!==null&&daysRemaining<=3||['past_due','grace_period'].includes(status),
    daysRemaining,
    reason:expired?(status==='trial'?'trial_expired':status):null,
    status,
    planId,
    effectivePlanId:effectivePlan.id,
    effectivePlan,
    features,
    limits:effectiveLimits,
    featureTrialActive,
    featureTrialDaysRemaining:featureTrialActive?Math.max(0,Math.ceil((featureTrialEnd-at)/DAY)):null,
    shouldShowUpgrade:!internal&&effectivePlan.id!=='premium',
    internal,
    warnings:[...(internalFallback||subscriptionFallback?['SUBSCRIPTION_FALLBACK']:[]),...(unknownPlan?['INVALID_PLAN_FALLBACK']:[])]
  };
}

const state={businessId:'',business:null,userProfile:null,role:'',permissions:[],subscription:null,effectivePlan:null,access:null,loading:true,error:null};
const listeners=new Set();
const snapshot=()=>structuredClone(state);
const emit=()=>{const value=snapshot();listeners.forEach(listener=>listener(value));dispatchEvent(new CustomEvent('business-context-changed',{detail:value}))};

export const BusinessContext={
  set({business,userProfile}){
    if(!business?.id||!userProfile?.uid||business.id!==userProfile.businessId)throw Error('Contexto de empresa inválido.');
    const storedSubscription=business.subscription||{};
    const access=resolveSubscriptionAccess({business,subscription:storedSubscription,limits:business.limits||{}});
    const subscription=storedSubscription.planId?storedSubscription:{planId:access.planId,status:access.status,fallback:true};
    const role=userProfile.role||'viewer',permissions=[...new Set([...(ROLE_PERMISSIONS[role]||[]),...(userProfile.permissions||[])])],plan=PLANS[subscription.planId]||PLANS.essential;
    const limits={...plan.limits,...business.limits,catalogEnabled:business.limits?.catalogEnabled??plan.features.onlineCatalog,campaignsEnabled:business.limits?.campaignsEnabled??plan.features.campaigns};
    access.limits={...access.limits,...limits};
    Object.assign(state,{businessId:business.id,business:{...business,subscription,limits:access.limits},userProfile,role,permissions,subscription,effectivePlan:access.effectivePlan,access,loading:false,error:null});
    window.FirebaseSession={...(window.FirebaseSession||{}),profile:userProfile,businessId:business.id,business:state.business,subscription:state.subscription,access:state.access};
    emit();
    return snapshot();
  },
  clear(){Object.assign(state,{businessId:'',business:null,userProfile:null,role:'',permissions:[],subscription:null,effectivePlan:null,access:null,loading:false,error:null});emit()},
  fail(error){state.loading=false;state.error=String(error?.message||error);emit()},
  get: snapshot,
  subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener)},
  getCurrentBusinessId(){if(!state.businessId)throw Error('Nenhuma empresa ativa no contexto.');return state.businessId},
  hasPermission(permission){return state.permissions.includes('*')||state.permissions.includes(permission)}
};

export const SubscriptionService={
  plans:()=>Object.values(PLANS).filter(plan=>!['internal','trial'].includes(plan.id)),
  getPlans:()=>Object.values(PLANS).filter(plan=>!['internal','trial'].includes(plan.id)),
  getCurrentSubscription:()=>structuredClone(state.subscription||{}),
  getAccess:()=>state.access||getSubscriptionAccess({status:'expired'}),
  startFreeTrial:async()=>({status:state.subscription?.status||'trial',message:'O teste gratuito é ativado automaticamente ao criar a empresa.'}),
  requestUpgrade:async planId=>{
    if(!state.businessId)throw Error('Nenhuma empresa ativa.');
    const operationId=globalThis.crypto?.randomUUID?.()||`${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const response=await window.FirebaseCallable('createSubscription',{companyId:state.businessId,userId:state.userProfile?.uid,planId,operationId});
    return{status:'checkout_created',planId,checkoutUrl:response.data?.checkoutUrl};
  },
  createCheckout:async planId=>SubscriptionService.requestUpgrade(planId),
  createCheckoutSession:async planId=>SubscriptionService.requestUpgrade(planId),
  openBillingPortal:async()=>({status:'available',message:'Use as opções de assinatura para cancelar ou reconciliar o pagamento.'}),
  requestCancellation:async()=>{
    if(!state.businessId)throw Error('Nenhuma empresa ativa.');
    const response=await window.FirebaseCallable('cancelSubscription',{companyId:state.businessId});
    return{status:response.data?.status||'cancelled',message:'Cancelamento solicitado com sucesso.'};
  },
  requestDowngrade:async planId=>({status:'not_available',planId,message:'Alteração de plano ainda não disponível.'}),
  openCustomerPortal:async()=>({status:'not_available'}),
  processSubscriptionWebhook:()=>{throw Error('Webhooks só podem ser processados no backend.')},
  syncSubscriptionStatus:async({reconcileProvider=false}={})=>{
    if(!state.businessId)throw Error('Nenhuma empresa ativa.');
    if(reconcileProvider){const response=await window.FirebaseCallable('syncSubscription',{companyId:state.businessId,reconcileProvider:true});return response.data}
    const business=await window.FirebaseBusinessReader(state.businessId);if(!business)throw Error('Empresa não encontrada.');BusinessContext.set({business,userProfile:state.userProfile});return{subscription:BusinessContext.get().subscription,source:'firestore'};
  },
  cancelSubscription:async()=>SubscriptionService.requestCancellation(),
  reactivateSubscription:async()=>({status:'requested'})
};

function countMonthSales(data){const month=new Date().toISOString().slice(0,7);return(data.vendas||[]).filter(item=>String(item.data||item.createdAt||'').slice(0,7)===month).length}
function decision(ok,reason='',limit=null,current=null){return{ok,reason,limit,current}}
export const PlanLimitService={
  canCreateProduct(data=window.DB?.carregar?.()||{}){const limit=state.business?.limits?.products??Infinity,current=(data.produtos||[]).filter(item=>item.ativo!==false).length;return decision(Boolean(state.access?.canCreateData)&&current<limit,'products',limit,current)},
  canCreateClient(data=window.DB?.carregar?.()||{}){const limit=state.business?.limits?.clients??Infinity,current=(data.clientes||[]).filter(item=>item.ativo!==false).length;return decision(Boolean(state.access?.canCreateData)&&current<limit,'clients',limit,current)},
  canCreateSale(data=window.DB?.carregar?.()||{}){const limit=state.business?.limits?.monthlySales??Infinity,current=countMonthSales(data);return decision(Boolean(state.access?.canCreateData)&&current<limit,'monthlySales',limit,current)},
  canInviteUser(){const limit=state.business?.limits?.users??1;return decision(BusinessContext.hasPermission('manageUsers')&&limit>1,'users',limit,null)},
  canUseCampaigns(){return decision(Boolean(state.access?.canUseCampaigns)&&BusinessContext.hasPermission('manageCampaigns'),'campaigns')},
  canUseOnlineCatalog(){return decision(Boolean(state.access?.canUseCatalog),'onlineCatalog')},
  canUseFeature(feature){return decision(Boolean(state.access?.canUseApp)&&state.access?.features?.[feature]===true,feature)},
  assert(result,label='operação'){if(!result.ok)throw Object.assign(new Error(result.limit!==null&&result.current>=result.limit?`Você atingiu o limite de ${result.limit} para ${label} no plano atual.`:`Seu plano não permite ${label} agora.`),{code:'plan-limit',details:result});return true}
};

window.BusinessContext=BusinessContext;
window.SubscriptionService=SubscriptionService;
window.PlanLimitService=PlanLimitService;
window.hasPermission=permission=>BusinessContext.hasPermission(permission);
window.resolveSubscriptionAccess=resolveSubscriptionAccess;
window.canUseFeature=feature=>PlanLimitService.canUseFeature(feature).ok;
