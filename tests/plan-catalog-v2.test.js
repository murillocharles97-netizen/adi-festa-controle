const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const catalog=require('../functions/src/shared/plan-catalog'),backend=require('../functions/src/services/plan-service');
function frontend(planId,status='active'){
 const box={structuredClone,console,dispatchEvent(){},CustomEvent:function(){},setTimeout,clearTimeout};box.window=box;vm.createContext(box);
 vm.runInContext(fs.readFileSync('functions/src/shared/plan-catalog.js','utf8'),box);
 vm.runInContext(fs.readFileSync('js/firebase/business-context.js','utf8').replace(/^export /gm,''),box);
 box.BusinessContext.set({business:{id:'qa-plan',active:true,subscription:{planId,status}},userProfile:{uid:'qa-owner',businessId:'qa-plan',role:'owner',active:true}});return box;
}
test('single catalog: prices in cents, annual 20%, stable billing IDs and aliases',()=>{
 for(const [id,monthly,yearly,equivalent] of [['essential',29.9,287.04,23.92],['professional',59.9,575.04,47.92],['premium',119.9,1151.04,95.92]]){
  const plan=catalog.plans[id];assert.equal(plan.monthlyPrice,monthly);assert.equal(plan.yearlyPrice,yearly);assert.equal(Math.round(plan.yearlyPrice/12*100)/100,equivalent);assert.equal(backend.planBilling(backend.getPlan(id),'yearly').amount,yearly);
 }
 assert.equal(backend.normalizePlanId('pro'),'professional','legacy alias must not silently become premium');
});
test('frontend and backend entitlements agree; expired subscriptions cannot mutate',()=>{
 for(const id of Object.keys(catalog.plans)){
  const box=frontend(id),access=box.BusinessContext.get().access;
  assert.deepEqual(JSON.parse(JSON.stringify(access.features)),backend.getPlan(id).features);
  for(const key of Object.keys(catalog.labels))assert.equal(box.canUseFeature(key),catalog.allows(id,key),id+':'+key);
  assert.equal(frontend(id,'expired').canUseFeature('basicSales'),false);
 }
 assert.equal(frontend('essential').canUseFeature('bulkMessages'),true);
 assert.equal(frontend('essential').canUseFeature('crm'),false);
 assert.equal(frontend('professional').canUseFeature('spreadsheetImport'),true);
 for(const key of ['teamManagement','permissions','paymentTerminalIntegration','fiscalIntegration']){
  assert.equal(catalog.requiredPlan(key),'premium');assert.equal(frontend('professional').canUseFeature(key),false);assert.equal(frontend('premium').canUseFeature(key),true);
 }
 assert.equal(catalog.campaignFeature({type:'quantity_discount',eligibility:{audienceType:'all'}}),'simpleCampaigns');
 assert.equal(catalog.campaignFeature({type:'points'}),'advancedCampaigns');
});
test('server catalog handshake protects checkout and old webhook price snapshot remains authoritative',()=>{
 const source=fs.readFileSync('functions/src/index.js','utf8'),client=fs.readFileSync('js/firebase/business-context.js','utf8');
 assert.match(source,/request\.data\?\.catalogVersion!==2/);assert.match(client,/checkoutConfig\.catalogVersion!==Catalog\.version/);
 const {validateProviderSubscription}=require('../functions/src/services/firestore-subscription-service');
 assert.doesNotThrow(()=>validateProviderSubscription({status:'authorized',auto_recurring:{transaction_amount:49.9}},{chargedPrice:49.9,planId:'professional'}));
 assert.throws(()=>validateProviderSubscription({status:'authorized',auto_recurring:{transaction_amount:59.9}},{chargedPrice:49.9,planId:'professional'}),/Valor/);
});
test('Rules projection corresponds to the catalog for protected feature tiers',()=>{
 const rules=fs.readFileSync('firestore.rules','utf8');
 for(const [key,tier] of Object.entries({simpleCampaigns:1,messageCenter:1,crmAdvanced:2,advancedCampaigns:2,customerSubscriptions:2,onlineOrders:2,financeAdvanced:2,spreadsheetImport:2,teamManagement:3,paymentTerminalIntegration:3,fiscalIntegration:3})){
  assert.ok(rules.includes("'"+key+"':"+tier));assert.equal(['essential','professional','premium'][tier-1],catalog.requiredPlan(key));
 }
});

test('Essencial has no Finance variant; Gestão and Pro inherit full Finance',()=>{
 for(const feature of ['basicFinance','financeAdvanced','financialModule','finance.view','finance.manage']){
  assert.equal(frontend('essential').canUseFeature(feature),false,feature);
  for(const id of ['professional','premium'])assert.equal(frontend(id).canUseFeature(feature),true,id+':'+feature);
  assert.equal(catalog.requiredPlan(feature),'professional');
 }
 assert.equal(catalog.routes.financeiro,'financeAdvanced');
 for(const feature of ['fiado','payments.receive','customers','basicSales','messageCenter','basicStock'])assert.equal(frontend('essential').canUseFeature(feature),true,feature);
 for(const [from,to] of [['essential','professional'],['professional','premium']])for(const [key,enabled] of Object.entries(catalog.plans[from].features))if(enabled)assert.equal(catalog.plans[to].features[key],true,key);
 const seed=JSON.parse(fs.readFileSync('plans.seed.json','utf8'));for(const id of Object.keys(catalog.plans))assert.deepEqual(seed[id].features,catalog.plans[id].features);
});
test('paid legacy Finance rights survive until paidThrough, with no basic Finance fallback UI',()=>{
 const box=frontend('essential'),state=box.BusinessContext.get();state.business.subscription={planId:'essential',status:'active',hasPaidSubscription:true,currentPeriodEnd:new Date(Date.now()+86400000).toISOString()};
 box.BusinessContext.set({business:state.business,userProfile:state.userProfile});assert.equal(box.canUseFeature('financeAdvanced'),true);
 const ui=fs.readFileSync('js/financial-ui.js','utf8'),app=fs.readFileSync('js/app.js','utf8');
 assert.doesNotMatch(ui,/basicFinanceMarkup|data-basic-finance/);
 const mount=app.slice(app.indexOf('  function mountRoute(route)'));
 assert.ok(mount.indexOf('guardRoute(route)')<mount.indexOf('financialModulePromise'));
});
