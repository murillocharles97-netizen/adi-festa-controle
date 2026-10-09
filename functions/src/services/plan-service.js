'use strict';

const Catalog=require('../shared/plan-catalog');
const PLANS=Object.freeze(Object.fromEntries(Object.entries(Catalog.plans).map(([id,plan])=>[id,{...plan,amount:plan.monthlyPrice,frequency:1,frequencyType:'months',aliases:id==='essential'?['starter']:id==='professional'?['pro','gestao']:[]}])));

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
