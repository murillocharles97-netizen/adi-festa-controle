const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');

function context(businessId='biz_new'){
  let data={config:{},clientes:[]};
  const events=[];
  const sandbox={window:{},DB:{getBusinessId:()=>businessId,carregar:()=>structuredClone(data),alterar:fn=>{fn(data);return data}},Utils:{toast(){}},CustomEvent:class{constructor(type,init){this.type=type;this.detail=init?.detail}},dispatchEvent:event=>events.push(event),addEventListener(){},document:{querySelectorAll:()=>[],querySelector:()=>null},Date,structuredClone};
  sandbox.window=sandbox;vm.createContext(sandbox);vm.runInContext(fs.readFileSync('js/operation-mode.js','utf8'),sandbox);return{sandbox,data:()=>data,events};
}

test('empresa nova recebe padrão neutro e CRM ativo',()=>{const {sandbox}=context();const operation=sandbox.OperationMode.ensure();assert.equal(operation.modules.creditSales,false);assert.equal(operation.modules.crm,true);assert.equal(operation.modules.inventory,true)});

test('empresa legada preserva fiado e migração é idempotente',()=>{const {sandbox,events}=context('adi-festa');const first=sandbox.OperationMode.ensure(),second=sandbox.OperationMode.ensure();assert.equal(first.modules.creditSales,true);assert.equal(second.migrationVersion,1);assert.equal(events.filter(e=>e.type==='operation-settings-changed').length,1)});

test('perfil de entrega preenche módulos e continua personalizável',()=>{const {sandbox}=context();sandbox.OperationMode.ensure();const operation=sandbox.OperationMode.save({profile:'delivery_store',modules:{pickup:true}});assert.equal(operation.modules.delivery,true);assert.equal(operation.modules.onlineCatalog,true);assert.equal(operation.modules.pickup,true);assert.equal(operation.modules.creditSales,false)});

test('owner possui permissões CRM e funcionário depende de permissão explícita',()=>{const {sandbox}=context();sandbox.FirebaseSession={profile:{role:'owner'}};assert.equal(sandbox.OperationMode.can('exportCRM'),true);sandbox.FirebaseSession={profile:{role:'cashier',permissions:{viewCRM:true}}};assert.equal(sandbox.OperationMode.can('viewCRM'),true);assert.equal(sandbox.OperationMode.can('exportCRM'),false)});
