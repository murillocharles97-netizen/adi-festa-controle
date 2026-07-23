const DAY=86400000;
export const APP_NAME='Adi Festa Controle';
export const INTERNAL_BUSINESS_ID='adi-festa';

export const PLANS={
  trial:{id:'trial',name:'Teste grátis',monthlyPrice:0,yearlyPrice:0,trialDays:7,features:{clients:true,products:true,sales:true,creditAccounts:true,stock:true,campaigns:true,onlineCatalog:true,multipleUsers:false,advancedReports:true},limits:{users:1,products:300,clients:500,monthlySales:3000}},
  essential:{id:'essential',name:'Essencial',monthlyPrice:39.90,yearlyPrice:399,trialDays:7,features:{clients:true,products:true,sales:true,creditAccounts:true,stock:true,campaigns:false,onlineCatalog:false,multipleUsers:false,advancedReports:false},limits:{users:1,products:300,clients:500,monthlySales:3000}},
  professional:{id:'professional',name:'Profissional',monthlyPrice:69.90,yearlyPrice:699,trialDays:7,recommended:true,features:{clients:true,products:true,sales:true,creditAccounts:true,stock:true,campaigns:true,onlineCatalog:true,multipleUsers:true,advancedReports:true},limits:{users:5,products:1500,clients:3000,monthlySales:15000}},
  premium:{id:'premium',name:'Premium',monthlyPrice:119.90,yearlyPrice:1199,trialDays:7,features:{clients:true,products:true,sales:true,creditAccounts:true,stock:true,campaigns:true,onlineCatalog:true,multipleUsers:true,advancedReports:true},limits:{users:20,products:10000,clients:25000,monthlySales:100000}},
  internal:{id:'internal',name:'Interno',monthlyPrice:0,yearlyPrice:0,trialDays:0,features:{clients:true,products:true,sales:true,creditAccounts:true,stock:true,campaigns:true,onlineCatalog:true,multipleUsers:true,advancedReports:true},limits:{users:999,products:999999,clients:999999,monthlySales:999999}}
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
  const status=String(subscription.status||'trial'),trialEnd=toDate(subscription.trialEndsAt),periodEnd=toDate(subscription.currentPeriodEnd),graceEnd=toDate(subscription.gracePeriodEndsAt);
  const daysRemaining=trialEnd?Math.max(0,Math.ceil((trialEnd-at)/DAY)):periodEnd?Math.max(0,Math.ceil((periodEnd-at)/DAY)):null;
  const trialValid=status==='trial'&&trialEnd&&trialEnd>=at;
  const active=status==='active'||trialValid||status==='grace_period'&&(!graceEnd||graceEnd>=at);
  const expired=status==='expired'||status==='cancelled'||status==='suspended'||status==='trial'&&!trialValid||status==='past_due'&&graceEnd&&graceEnd<at;
  return{
    canAccessApp:active&&!expired,
    canCreateData:active&&!expired,
    canUseCatalog:active&&!expired&&limits.catalogEnabled!==false,
    canUseCampaigns:active&&!expired&&limits.campaignsEnabled!==false,
    showBillingWarning:status==='trial'&&daysRemaining!==null&&daysRemaining<=3||['past_due','grace_period'].includes(status),
    daysRemaining,
    reason:expired?(status==='trial'?'trial_expired':status):null,
    status
  };
}

const state={businessId:'',business:null,userProfile:null,role:'',permissions:[],subscription:null,access:null,loading:true,error:null};
const listeners=new Set();
const snapshot=()=>structuredClone(state);
const emit=()=>{const value=snapshot();listeners.forEach(listener=>listener(value));dispatchEvent(new CustomEvent('business-context-changed',{detail:value}))};

export const BusinessContext={
  set({business,userProfile}){
    if(!business?.id||!userProfile?.uid||business.id!==userProfile.businessId)throw Error('Contexto de empresa inválido.');
    const role=userProfile.role||'viewer',permissions=[...new Set([...(ROLE_PERMISSIONS[role]||[]),...(userProfile.permissions||[])])],plan=PLANS[business.subscription?.planId]||PLANS.trial;
    const limits={...plan.limits,...business.limits,catalogEnabled:business.limits?.catalogEnabled??plan.features.onlineCatalog,campaignsEnabled:business.limits?.campaignsEnabled??plan.features.campaigns};
    Object.assign(state,{businessId:business.id,business:{...business,limits},userProfile,role,permissions,subscription:business.subscription||{},access:getSubscriptionAccess(business.subscription,limits),loading:false,error:null});
    window.FirebaseSession={...(window.FirebaseSession||{}),profile:userProfile,businessId:business.id,business:state.business,subscription:state.subscription,access:state.access};
    emit();
    return snapshot();
  },
  clear(){Object.assign(state,{businessId:'',business:null,userProfile:null,role:'',permissions:[],subscription:null,access:null,loading:false,error:null});emit()},
  fail(error){state.loading=false;state.error=String(error?.message||error);emit()},
  get: snapshot,
  subscribe(listener){listeners.add(listener);listener(snapshot());return()=>listeners.delete(listener)},
  getCurrentBusinessId(){if(!state.businessId)throw Error('Nenhuma empresa ativa no contexto.');return state.businessId},
  hasPermission(permission){return state.permissions.includes('*')||state.permissions.includes(permission)}
};

export const SubscriptionService={
  plans:()=>Object.values(PLANS).filter(plan=>plan.id!=='internal'),
  getAccess:()=>state.access||getSubscriptionAccess({status:'expired'}),
  createCheckoutSession:async planId=>({status:'not_available',planId,message:'Pagamento será disponibilizado em breve.'}),
  openCustomerPortal:async()=>({status:'not_available'}),
  processSubscriptionWebhook:()=>{throw Error('Webhooks só podem ser processados no backend.')},
  syncSubscriptionStatus:()=>{throw Error('Status de assinatura só pode ser atualizado pelo backend.')},
  cancelSubscription:async()=>({status:'requested'}),
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
  assert(result,label='operação'){if(!result.ok)throw Object.assign(new Error(result.limit!==null&&result.current>=result.limit?`Você atingiu o limite de ${result.limit} para ${label} no plano atual.`:`Seu plano não permite ${label} agora.`),{code:'plan-limit',details:result});return true}
};

window.BusinessContext=BusinessContext;
window.SubscriptionService=SubscriptionService;
window.PlanLimitService=PlanLimitService;
window.hasPermission=permission=>BusinessContext.hasPermission(permission);
