const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const css=fs.readFileSync('css/crm-dashboard.css','utf8');

test('onboarding esconde a etapa inativa mesmo com layout em grade',()=>assert.match(css,/operation-flow-body\[hidden\]\{display:none!important\}/));

function context(businessId='biz_new',seed={config:{},clientes:[],produtos:[],vendas:[]}){
  let data=structuredClone(seed);const events=[];
  const sandbox={window:{},DB:{getBusinessId:()=>businessId,carregar:()=>structuredClone(data),alterar:fn=>{fn(data);return data}},Utils:{toast(){},escapar:value=>value},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail}},dispatchEvent:event=>events.push(event),addEventListener(){},document:{querySelectorAll:()=>[],querySelector:()=>null,body:{append(){}}},Date,structuredClone,setTimeout};
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(fs.readFileSync('js/operation-mode.js','utf8'),sandbox);return{sandbox,data:()=>data,events};
}

test('empresa nova recebe padrão neutro e onboarding pendente',()=>{const {sandbox}=context();const operation=sandbox.OperationMode.ensure();assert.equal(operation.operationMode,'physical_store');assert.equal(operation.creditMode,'disabled');assert.equal(operation.operationOnboardingCompleted,false);assert.equal(operation.modules.crm,true)});
test('empresa legada preserva venda externa e fiado com migração idempotente',()=>{const {sandbox,events}=context('adi-festa');const first=sandbox.OperationMode.ensure(),second=sandbox.OperationMode.ensure();assert.equal(first.operationMode,'external_sales');assert.equal(first.creditMode,'enabled');assert.equal(first.modules.creditSales,true);assert.equal(second.migrationVersion,2);assert.equal(events.filter(event=>event.type==='operation-settings-changed').length,1)});
test('empresa existente sem campo não é forçada a refazer onboarding',()=>{const {sandbox}=context('biz_old',{config:{},clientes:[{id:'c1'}],produtos:[],vendas:[]});assert.equal(sandbox.OperationMode.ensure().operationOnboardingCompleted,true)});
test('modelo de entrega deriva módulos e aceita crédito ocasional',()=>{const {sandbox}=context();sandbox.OperationMode.ensure();const operation=sandbox.OperationMode.save({operationMode:'delivery_orders',creditMode:'occasional',operationOnboardingCompleted:true});assert.equal(operation.modules.delivery,true);assert.equal(operation.modules.onlineCatalog,true);assert.equal(operation.modules.pickup,true);assert.equal(operation.modules.creditSales,true);assert.equal(sandbox.OperationMode.enabled('creditSales'),false);assert.equal(sandbox.OperationMode.allowsCredit(),true)});
test('owner possui permissões CRM e funcionário depende de permissão explícita',()=>{const {sandbox}=context();sandbox.FirebaseSession={profile:{role:'owner'}};assert.equal(sandbox.OperationMode.can('exportCRM'),true);sandbox.FirebaseSession={profile:{role:'cashier',permissions:{viewCRM:true}}};assert.equal(sandbox.OperationMode.can('viewCRM'),true);assert.equal(sandbox.OperationMode.can('exportCRM'),false)});
