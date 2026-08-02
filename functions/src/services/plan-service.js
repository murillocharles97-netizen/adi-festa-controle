'use strict';

const BASE_FEATURES={products:true,stock:true,sales:true,clients:true,creditAccounts:true,payments:true,barcode:true,receipts:true,recentHistory:true,basicDashboard:true};
const GROWTH_FEATURES={campaigns:true,crm:true,crmExport:true,bulkMessages:true,advancedDashboard:true,onlineCatalog:true,onlineOrders:true,loyalty:true,dataImport:true};
const PREMIUM_FEATURES={multipleUsers:true,rolesPermissions:true,advancedReports:true,advancedExports:true,automations:true,futureApi:true,futureIntegrations:true};

const PLANS=Object.freeze({
  essential:{id:'essential',aliases:['starter'],name:'Essencial',amount:29.90,monthlyPrice:29.90,yearlyPrice:299,currency:'BRL',frequency:1,frequencyType:'months',features:{...BASE_FEATURES},limits:{users:1,products:300,clients:500,monthlySales:1500,catalogEnabled:false,campaignsEnabled:false}},
  professional:{id:'professional',aliases:['pro'],name:'Profissional',amount:49.90,monthlyPrice:49.90,yearlyPrice:499,currency:'BRL',frequency:1,frequencyType:'months',features:{...BASE_FEATURES,...GROWTH_FEATURES},limits:{users:3,products:2000,clients:5000,monthlySales:10000,catalogEnabled:true,campaignsEnabled:true}},
  premium:{id:'premium',aliases:[],name:'Premium',amount:79.90,monthlyPrice:79.90,yearlyPrice:799,currency:'BRL',frequency:1,frequencyType:'months',features:{...BASE_FEATURES,...GROWTH_FEATURES,...PREMIUM_FEATURES},limits:{users:10,products:10000,clients:25000,monthlySales:50000,catalogEnabled:true,campaignsEnabled:true}}
});

function normalizePlanId(value){
  const input=String(value||'').trim().toLowerCase();
  if(PLANS[input])return input;
  return Object.values(PLANS).find(plan=>plan.aliases.includes(input))?.id||'';
}
function getPlan(value){const id=normalizePlanId(value);return id?PLANS[id]:null}
function requirePlan(value){const plan=getPlan(value);if(!plan)throw Object.assign(new Error('Plano inválido.'),{code:'invalid-plan'});return plan}
function publicPlan(plan){return{id:plan.id,name:plan.name,features:{...plan.features},limits:{...plan.limits}}}

function planBilling(plan,billingCycle='monthly'){
  if(!plan)throw Object.assign(new Error('Invalid plan.'),{code:'invalid-plan'});
  if(billingCycle==='monthly')return{billingCycle,amount:Number(plan.monthlyPrice??plan.amount),frequency:1,frequencyType:'months'};
  if(billingCycle==='yearly')return{billingCycle,amount:Number(plan.yearlyPrice),frequency:12,frequencyType:'months'};
  throw Object.assign(new Error('Invalid billing cycle.'),{code:'invalid-billing-cycle'});
}

module.exports={PLANS,normalizePlanId,getPlan,requirePlan,publicPlan,planBilling};
