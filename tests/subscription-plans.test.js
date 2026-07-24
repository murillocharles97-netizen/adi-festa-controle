const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const read=file=>fs.readFileSync(file,'utf8');

const businessSource=read('js/firebase/business-context.js').replace(/^export /gm,'')+'\n;globalThis.__plans={PLANS,resolveSubscriptionAccess,getSubscriptionAccess,SubscriptionService};';
const sandbox={window:null,structuredClone,dispatchEvent(){},CustomEvent:function(){},console,setTimeout,clearTimeout};
sandbox.window=sandbox;
vm.createContext(sandbox);
vm.runInContext(businessSource,sandbox,{filename:'business-context.js'});
const {PLANS,resolveSubscriptionAccess,SubscriptionService}=sandbox.__plans;
const now=new Date('2026-07-24T12:00:00Z');

assert.equal(PLANS.essential.monthlyPrice,29.90);
assert.equal(PLANS.essential.yearlyPrice,299);
assert.equal(PLANS.essential.limits.products,300);
assert.equal(PLANS.essential.limits.clients,500);
assert.equal(PLANS.essential.limits.monthlySales,1500);
assert.equal(PLANS.professional.monthlyPrice,49.90);
assert.equal(PLANS.professional.yearlyPrice,499);
assert.equal(PLANS.professional.limits.users,3);
assert.equal(PLANS.professional.limits.products,2000);
assert.equal(PLANS.professional.limits.clients,5000);
assert.equal(PLANS.professional.limits.monthlySales,10000);
assert.equal(PLANS.premium.monthlyPrice,79.90);
assert.equal(PLANS.premium.yearlyPrice,799);
assert.equal(PLANS.premium.limits.users,10);
assert.equal(PLANS.internal.features.campaigns,true);
assert.equal(PLANS.internal.features.onlineCatalog,true);

const internal=resolveSubscriptionAccess({planId:'internal',status:'active'},{},now);
assert.equal(internal.canAccessApp,true);
assert.equal(internal.canCreateData,true);
assert.equal(internal.internal,true);
assert.equal(internal.shouldShowUpgrade,false);
assert.equal(internal.canUseFeature('automations'),true);

const essential=resolveSubscriptionAccess({planId:'essential',status:'active'},{},now);
assert.equal(essential.canUseFeature('products'),true);
assert.equal(essential.canUseFeature('campaigns'),false);
assert.equal(essential.canUseFeature('onlineCatalog'),false);

const professional=resolveSubscriptionAccess({planId:'professional',status:'active'},{},now);
assert.equal(professional.canUseFeature('campaigns'),true);
assert.equal(professional.canUseFeature('onlineOrders'),true);
assert.equal(professional.canUseFeature('rolesPermissions'),false);

const featureTrial=resolveSubscriptionAccess({planId:'essential',status:'active',featureTrial:{planId:'professional',used:true,status:'active',endsAt:'2026-07-30T12:00:00Z'}},{},now);
assert.equal(featureTrial.featureTrialActive,true);
assert.equal(featureTrial.effectivePlanId,'professional');
assert.equal(featureTrial.canUseFeature('campaigns'),true);

const expiredFeatureTrial=resolveSubscriptionAccess({planId:'essential',status:'active',featureTrial:{planId:'professional',used:true,status:'active',endsAt:'2026-07-23T12:00:00Z'}},{},now);
assert.equal(expiredFeatureTrial.featureTrialActive,false);
assert.equal(expiredFeatureTrial.canUseFeature('campaigns'),false);

assert.equal(SubscriptionService.getPlans().length,3);
assert.equal(typeof SubscriptionService.startFreeTrial().then,'function');

const plansUi=read('js/plans.js');
const auth=read('js/firebase/auth.js');
const index=read('index.html');
const worker=read('service-worker.js');
const rules=read('firestore.rules');
const planSeed=JSON.parse(read('plans.seed.json'));
assert.doesNotMatch(plansUi,/onSnapshot|getDocs|collection\(/);
assert.match(plansUi,/Pagamento recorrente ainda não integrado/);
assert.match(plansUi,/data-full-comparison/);
assert.match(plansUi,/data-plan-indicator/);
assert.match(plansUi,/openProModal/);
assert.match(plansUi,/requestUpgrade/);
assert.match(auth,/data-show-plans>Ver planos/);
assert.match(auth,/window\.PlansUI\.render/);
assert.match(index,/data-route="planos"/);
assert.match(index,/data-plan-feature="campaigns"/);
assert.match(index,/data-plan-feature="onlineCatalog"/);
assert.match(index,/data-plan-feature="onlineOrders"/);
assert.match(worker,/adi-festa-v48-subscription-plans/);
assert.match(worker,/css\/plans\.css/);
assert.match(worker,/js\/plans\.js/);
assert.match(rules,/request\.resource\.data\.subscription == resource\.data\.subscription/);
assert.doesNotMatch(businessSource,/subscription\.status\s*=\s*['"]active/);
assert.equal(planSeed.essential.monthlyPrice,29.9);
assert.equal(planSeed.professional.monthlyPrice,49.9);
assert.equal(planSeed.premium.monthlyPrice,79.9);
assert.equal(planSeed.trial.effectivePlanId,'professional');
assert.equal(planSeed.trial.limits.users,3);
assert.match(plansUi,/comparison-limit-row/);

console.log('subscription-plans.test.js: OK');
