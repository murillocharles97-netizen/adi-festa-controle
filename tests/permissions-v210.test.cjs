'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');
const Policy=require('../functions/src/shared/permission-policy'),Mutations=require('../js/permission-mutations'),Model=require('../js/team-permission-model');
const {JSDOM}=require('jsdom');
const grants=(...keys)=>({role:'seller',permissionsVersion:2,permissions:Object.fromEntries(keys.map(k=>[k,true]))});
const access=m=>({has:key=>Policy.has(m,key)});
const write=(entityType,data={},operation='update',before={})=>({entityType,entityId:'qa',operation,data,before});
test('22 real keys; policy/frontend/editor/server vocabulary is identical',()=>{
 const backend=require('../functions/src/services/team-access-service');
 assert.equal(Policy.LEGACY_KEYS.length,20);assert.equal(Policy.KEYS.length,22);
 assert.deepEqual([...Model.KEYS].sort(),[...Policy.KEYS].sort());assert.deepEqual(backend.PERMISSIONS,Policy.KEYS);
});
test('legacy edit preserves previously authorized create/archive only; no role or truthy fallback',()=>{
 for(const permissions of [{'customers.edit':true}]){
  const m={role:'seller',permissions},before=JSON.stringify(m);for(const k of ['customers.create','customers.edit','customers.archive'])assert.equal(Policy.has(m,k),true);
  assert.equal(JSON.stringify(m),before);assert.deepEqual(Model.explicit(m),Policy.effective(m));
 }
 for(const m of [{role:'manager'},{permissions:['customers.edit']},{permissions:{'customers.edit':'true'}},grants('customers.edit')])assert.equal(Policy.has(m,'customers.create'),false);
 assert.equal(Policy.has({permissions:{'customers.edit':true,'customers.create':false}},'customers.create'),false);
});
test('V2 create-only cannot edit or archive; dependencies never grant view automatically',()=>{
 const m=grants('customers.view','customers.create');assert.equal(Policy.has(m,'customers.create'),true);assert.equal(Policy.has(m,'customers.edit'),false);assert.equal(Policy.has(m,'customers.archive'),false);
 assert.equal(Model.change(Model.preset('seller'),'customers.create',true).blocked,false);
 const v=Model.change(Model.explicit(m),'customers.view',false);assert.equal(v.values['customers.create'],false);
 for(const role of ['seller','manager'])for(const key of ['financial.view','cost.view','profit.view','team.manage','settings.manage','customers.archive'])assert.equal(Model.preset(role)[key],false);
});
const cases=[
 ['customer create','customers.create',[write('clients',{nome:'QA',saldo:0},'create')]],
 ['customer edit','customers.edit',[write('clients',{nome:'QA'})]],
 ['customer archive','customers.archive',[write('clients',{ativo:false})]],
 ['products','products.edit',[write('products',{nome:'QA'})]],
 ['stock','inventory.adjust',[write('products',{estoqueAtual:2}),write('stockMovements',{quantidade:1},'create')]],
 ['settings','settings.manage',[write('settings',{nome:'QA'})]],
 ['CRM','customers.edit',[write('clientContacts',{note:'QA'},'create')]],
 ['sale','sales.create',[write('sales',{valorFinal:10},'create'),write('products',{estoqueAtual:2}),write('clients',{totalComprado:10})]],
 ['cancel','sales.cancel',[write('sales',{active:false}),write('products',{estoqueAtual:2})]],
 ['payment','customers.receiveDebt',[write('payments',{valor:10},'create'),write('clients',{saldo:0})]],
 ['balance adjustment','customers.adjustBalance',[write('balanceAdjustments',{saldoNovo:0},'create'),write('clients',{saldo:0})]],
 ['costs','cost.view',[write('productFinancials',{custo:4})]],
];
for(const [name,key,writes]of cases)test(name+' denied before queue/memory and allowed only with the intended grant',()=>{
 const before=JSON.stringify(writes);let queues=0;
 const attempt=m=>{Mutations.assertWrites(writes,access(m),Policy);queues++;};
 assert.throws(()=>attempt(grants()),e=>e.message===Policy.MESSAGE&&e.code==='permission-required');assert.equal(queues,0);
 attempt(grants(key));assert.equal(queues,1);assert.equal(JSON.stringify(writes),before);
 Mutations.assertWrites(writes,access({role:'owner'}),Policy);
});
test('naked balance/counters patch is blocked even for owner: typed event required',()=>{
 for(const d of [{saldo:999},{financialVersion:8},{quantidadeVendas:99}])assert.throws(()=>Mutations.assertWrites([write('clients',d)],access({role:'owner'}),Policy));
});
function domain(keys){
 let rows={clientes:[{id:'existing',nome:'Fictício',saldo:-12,financialVersion:2}],vendas:[]},m=grants(...keys),changes=0;
 const c={console,Date,Utils:{uuid:crypto.randomUUID},PhoneUtils:{normalizeBrazilianPhone:String},VeconiPermissionPolicy:Policy,TeamAccess:{has:p=>Policy.has(m,p)},FirebaseSession:{user:{uid:'qa'}},DB:{carregar:()=>rows,alterar:fn=>{const next=structuredClone(rows);fn(next);rows=next;changes++;}}};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('js/clientes.js','utf8'),c);
 return{c,rows:()=>rows,changes:()=>changes,revoke:()=>m=grants()};
}
test('customer create-only accepts zero-balance creation; editing, importing, archiving denied, draft untouched',()=>{
 const h=domain(['customers.create']);h.c.Clientes.salvar({nome:'Fictício novo'});assert.equal(h.rows().clientes.length,2);assert.equal(h.rows().clientes[1].saldo,0);const before=JSON.stringify(h.rows());
 for(const action of [()=>h.c.Clientes.salvar({id:'existing',nome:'Não autorizado'}),()=>h.c.Clientes.excluir('existing'),()=>h.c.Clientes.importar([{nome:'QA'}])])assert.throws(action);
 assert.equal(JSON.stringify(h.rows()),before);h.revoke();assert.throws(()=>h.c.Clientes.salvar({nome:'Rascunho preservado'}));assert.equal(h.changes(),1);
});
test('archive-only preserves client/balance/history and never removes the document',()=>{
 const h=domain(['customers.archive']);h.c.Clientes.excluir('existing');assert.equal(h.rows().clientes.length,1);assert.equal(h.rows().clientes[0].ativo,false);assert.equal(h.rows().clientes[0].saldo,-12);
 h.rows().clientes[0].deletedAt='2026-01-01T00:00:00Z';h.c.Clientes.setActive('existing',true);assert.equal(h.rows().clientes[0].ativo,true);assert.equal(h.rows().clientes[0].active,true);assert.equal(h.rows().clientes[0].deletedAt,null);assert.equal(h.rows().clientes[0].saldo,-12);
 h.revoke();assert.throws(()=>h.c.Clientes.setActive('existing',false));assert.equal(h.rows().clientes[0].active,true);
});
test('metadata edit never silently reactivates an inactive customer',()=>{
 const h=domain(['customers.edit']);Object.assign(h.rows().clientes[0],{ativo:false,active:false});h.c.Clientes.salvar({id:'existing',nome:'Fictício editado',ativo:true});assert.equal(h.rows().clientes[0].ativo,false);assert.equal(h.rows().clientes[0].active,false);assert.equal(h.rows().clientes[0].saldo,-12);
});

test('customer status confirmation is explicit, cancel is inert, repeat click/stale session cannot mutate',async()=>{
 const dom=new JSDOM('<main id="app"></main><div id="modal"></div>',{runScripts:'outside-only',url:'https://qa.example.invalid'}),w=dom.window;
 let writes=0,token='original';const client={id:'ficticio',nome:'Cliente fictício',ativo:false,active:false,saldo:-12};
 w.Utils={escapar:s=>s,toast(){}};w.matchMedia=()=>({matches:true});w.TeamAccess={has:()=>true,captureSession:()=>token,assertSession:old=>assert.equal(old,token)};w.Clientes={obter:()=>client,setActive:(_,enabled)=>{writes++;client.ativo=client.active=enabled;}};w.eval(fs.readFileSync('js/client-actions.js','utf8'));
 await w.ClientActions.run('delete',client.id);assert.match(w.document.querySelector('#modal').textContent,/Reativar/);w.document.querySelector('[data-status-close]').click();assert.equal(writes,0);
 await w.ClientActions.run('delete',client.id);token='other';w.document.querySelector('[data-status-confirm]').click();assert.equal(writes,0);assert.ok(w.document.querySelector('[data-status-error]').textContent);
 token='original';w.document.querySelector('[data-status-close]').click();await w.ClientActions.run('delete',client.id);const confirm=w.document.querySelector('[data-status-confirm]');confirm.click();confirm.click();assert.equal(writes,1);assert.equal(client.saldo,-12);assert.equal(client.active,true);
 await new Promise(setImmediate);w.close();
});
function dom(){
 const d=new JSDOM('<button id="new-client">Novo cliente</button><input id="draft" value="QA preenchido">',{runScripts:'outside-only',url:'https://qa.example.invalid'}),w=d.window;
 let member=grants('customers.view'),c={businessId:'qa',userProfile:{uid:'seller',active:true},member:{uid:'seller',status:'active'},role:'seller',permissions:[],access:{canMutate:true}};
 w.BusinessContext={get:()=>c,canAccessSpace:id=>id==='space-qa'};w.FirebaseSession={user:{uid:'seller'}};w.DB={getWorkspaceGeneration:()=>0};w.Utils={toast:()=>{}};
 w.eval(fs.readFileSync('functions/src/shared/permission-policy.js','utf8'));w.eval(fs.readFileSync('js/team-access.js','utf8'));
 const update=m=>{member=m;c={...c,member:{...c.member,...m},permissions:Object.keys(Policy.effective(member)).filter(k=>Policy.has(member,k))};w.dispatchEvent(new w.Event('business-context-changed'));};update(member);
 return{w,close:()=>w.close(),update,context:()=>c};
}
test('live grant/revocation protects direct UI handlers, explains denial and preserves form',async()=>{
 const h=dom();let calls=0;h.w.document.querySelector('#new-client').onclick=()=>calls++;
 h.w.document.querySelector('#new-client').click();assert.equal(calls,0);assert.equal(h.w.document.querySelector('#draft').value,'QA preenchido');
 h.update(grants('customers.view','customers.create'));h.w.document.querySelector('#new-client').click();assert.equal(calls,1);
 const token=h.w.TeamAccess.captureSession();h.update(grants('customers.view'));assert.throws(()=>h.w.TeamAccess.assertSession(token),e=>e.code==='permission-session-retired');
 h.w.document.querySelector('#new-client').click();assert.equal(calls,1);h.close();
});
test('session/space scope cannot admit other business, generation or unauthorized space',()=>{
 const h=dom();for(const d of [{businessId:'foreign'},{workspaceGeneration:99},{spaceId:'foreign-space'}])assert.throws(()=>h.w.TeamAccess.assertWriteScope(write('clients',d)));
 h.w.TeamAccess.assertWriteScope(write('clients',{businessId:'qa',spaceId:'space-qa'}));h.close();
});
test('restricted product editor cannot create all-space scope or modify foreign-space product',async()=>{
 const h=dom();h.update(grants('products.view','products.edit'));Object.assign(h.context(),{spaceAccess:'selected',allowedSpaceIds:['space-qa']});
 const own={businessId:'qa',spaceAccessMode:'single_space',allowedSpaceIds:['space-qa'],defaultSpaceId:'space-qa'};
 h.w.TeamAccess.assertWriteScope(write('products',own,'create'));
 assert.throws(()=>h.w.TeamAccess.assertWriteScope(write('products',{...own,spaceAccessMode:'all_spaces',allowedSpaceIds:[]},'create')));
 assert.throws(()=>h.w.TeamAccess.assertWriteScope(write('products',{nome:'Não permitido'},'update',{...own,allowedSpaceIds:['foreign-space']})));
 await new Promise(setImmediate);h.close();
});
test('create-only offline requires a scoped V2 handshake; never optimistic downgrade',()=>{
 const h=dom();h.update(grants('customers.create','customers.view'));
 assert.throws(()=>h.w.TeamAccess.assertCustomerProtocol(),e=>e.code==='permission-protocol-unconfirmed');
 h.w.SyncFirebase={getPermissionProtocol:()=>({status:'verified',permissionsVersion:2})};h.w.TeamAccess.assertCustomerProtocol();h.close();
});

test('permission version change retires async tokens even when the explicit grant list is identical',()=>{
 const h=dom();Object.assign(h.context(),{permissions:['customers.view','customers.edit'],member:{role:'seller',status:'active',permissions:{'customers.view':true,'customers.edit':true},permissionsVersion:1}});
 const token=h.w.TeamAccess.captureSession();assert.equal(h.w.TeamAccess.has('customers.create'),true);
 h.context().member.permissionsVersion=2;assert.equal(h.w.TeamAccess.has('customers.create'),false);assert.throws(()=>h.w.TeamAccess.assertSession(token),{code:'permission-session-retired'});h.close();
});
test('actual storage wrapper rejects denied mutation, settings drift and identity changes before queue or memory publication',()=>{
 const source=fs.readFileSync('js/firebase/sync.js','utf8'),cut=(a,b)=>source.slice(source.indexOf(a),source.indexOf(b,source.indexOf(a)));
 let data={config:{nome:'Original'},clientes:[{id:'qa',nome:'Original'}]},queues=0,saves=0,principal='seller';
 const a=access(grants()),c={structuredClone,originalAlter:null,currentUser:{uid:'seller'},window:null,PermissionMutations:Mutations,VeconiPermissionPolicy:Policy,WorkspaceRuntime:{capture(){}},canWriteSharedSettings:()=>false,sharedSettingsConfig:x=>x,
  TeamAccess:{...a,captureSession:()=>principal,assertSession:x=>{if(x!==principal)throw Error('Sessão substituída');}},DB:{carregar:()=>data,alterar:fn=>{fn(data);},salvar:next=>{saves++;data=next;},prepare:x=>x},captureChanges:(before,after)=>{Mutations.assertWrites([{entityType:'clients',entityId:'qa',operation:'update',before:before.clientes[0],data:after.clientes[0]}],a,Policy);queues++;}};
 c.window=c;vm.createContext(c);vm.runInContext(cut('function installOfflineFirstStorage()','async function validateUser()'),c);c.installOfflineFirstStorage();
 const before=JSON.stringify(data);assert.throws(()=>c.DB.alterar(d=>d.clientes[0].nome='Negado'));assert.throws(()=>c.DB.alterar(d=>d.config.nome='Negado'));assert.throws(()=>c.DB.alterar(d=>{d.clientes[0].nome='Antigo';principal='owner';}));
 assert.equal(saves,0);assert.equal(queues,0);assert.equal(JSON.stringify(data),before);
});
test('actual membership watcher freezes access on change and ignores callbacks from the old UID/business',()=>{
 const source=fs.readFileSync('js/firebase/team-service.js','utf8').replace(/^import.*\r?\n/gm,'').replace(/^export.*\r?\n?/gm,'');
 let ctx={businessId:'qa',member:{uid:'seller',role:'seller',status:'active',permissions:{'customers.view':true}}},callbacks=[],changes=0,suspended=0;
 const c={console,auth:{currentUser:{uid:'seller'}},db:{},BusinessContext:{get:()=>ctx,suspendPermissions:()=>suspended++},addEventListener(){},normalizeFirestoreData:x=>x,doc:(_,...p)=>p.join('/'),onSnapshot:(ref,next,error)=>{callbacks.push({next,error});return()=>{};}};c.window=c;vm.createContext(c);vm.runInContext(source,c);
 c.TeamService.watchCurrentMember(()=>changes++);callbacks[0].next({exists:()=>true,data:()=>({...ctx.member,permissions:{'customers.view':true,'customers.create':true},permissionsVersion:2})});assert.equal(changes,1);assert.equal(suspended,1);
 c.auth.currentUser={uid:'owner'};ctx={businessId:'other',member:{uid:'owner'}};c.TeamService.watchCurrentMember(()=>changes++);
 callbacks[0].next({exists:()=>true,data:()=>({status:'disabled'})});callbacks[0].error({code:'permission-denied'});assert.equal(changes,1);assert.equal(suspended,1);
});

test('profile fallback without a trusted membership cannot elevate owner or grant local actions',async()=>{
 const dom=new JSDOM('<main></main>',{runScripts:'outside-only',url:'https://qa.example.invalid'}),w=dom.window;
 w.VeconiPermissionPolicy=Policy;w.VeconiPlanCatalog=require('../functions/src/shared/plan-catalog');w.structuredClone=structuredClone;
 w.eval(fs.readFileSync('js/team-access.js','utf8'));w.eval(fs.readFileSync('js/firebase/business-context.js','utf8').replace(/^export /gm,''));
 const business={id:'qa',ownerId:'canonical-owner',active:true,subscription:{planId:'internal',status:'active'}};
 w.BusinessContext.set({business,userProfile:{uid:'untrusted',businessId:'qa',role:'owner',active:true,permissions:{'team.manage':true}}});
 assert.equal(w.TeamAccess.has('team.manage'),false);assert.equal(w.TeamAccess.has('customers.create'),false);
 w.BusinessContext.set({business,userProfile:{uid:'canonical-owner',businessId:'qa',role:'owner',active:true}});assert.equal(w.TeamAccess.has('team.manage'),true);
 await new Promise(setImmediate);w.close();
});
test('financial API permission gate runs BEFORE entitlement checks, remote call or local state',()=>{
 const source=fs.readFileSync('js/firebase/financial-space-service.js','utf8'),a=source.indexOf('const spaceMetadataMethods='),b=source.indexOf('window.FinancialSpaceService =',a);let effects=0,planChecks=0,allowed=false;
 const c={FinancialSpaceService:{createEntry:()=>effects++,listFinancialAccounts:()=>effects++,listSpaces:()=> 'metadata'},TeamAccess:{has:()=>allowed},VeconiPermissionPolicy:Policy,PlanLimitService:{assert:()=>planChecks++,canUseFeature:()=>true}};c.window=c;vm.createContext(c);vm.runInContext(source.slice(a,b),c);
 assert.throws(()=>c.FinancialSpaceService.createEntry(),{code:'permission-required'});assert.equal(effects,0);assert.equal(planChecks,0);assert.equal(c.FinancialSpaceService.listSpaces(),'metadata');
 allowed=true;c.FinancialSpaceService.createEntry();assert.equal(effects,1);assert.equal(planChecks,1);
});
test('settings/space direct handlers deny before mutators or optimistic space/queue creation',async()=>{
 const op=fs.readFileSync('js/operation-mode.js','utf8'),spaces=fs.readFileSync('js/firebase/space-service.js','utf8');let writes=0;
 const c={TeamAccess:{has:()=>false},VeconiPermissionPolicy:Policy,DB:{alterar:()=>writes++}};c.window=c;vm.createContext(c);
 const start=op.indexOf('  function save('),end=op.indexOf('\n',start);vm.runInContext(op.slice(start,end),c);assert.throws(()=>c.save({}),{code:'permission-required'});
 for(const [from,to]of [['async function createSpace(','async function updateSpace('],['async function updateSpace(','const adapter =']]){vm.runInContext(spaces.slice(spaces.indexOf(from),spaces.indexOf(to,spaces.indexOf(from))),c);}
 await assert.rejects(c.createSpace({}),{code:'permission-required'});await assert.rejects(c.updateSpace('qa',{}),{code:'permission-required'});assert.equal(writes,0);
});
test('direct SDK transaction invalidates stale permission snapshot before flushing any buffered write',async()=>{
 const create=require('../js/workspace-writer').create;let permission='granted',finish,writes=0;
 const origin={businessId:'qa',workspaceGeneration:0},guard={capture:()=>origin},writer=create({runtime:()=>guard,permissionContext:()=>({captureSession:()=>permission,assertSession:old=>assert.equal(old,permission)}),sdk:{runTransaction:async(_,action)=>action({get:async()=>({}),set:()=>writes++})}});
 const p=writer.runTransaction({},async tx=>{await new Promise(resolve=>finish=resolve);tx.set({path:'businesses/qa/settings/default'},{name:'QA'});});permission='revoked';finish();await assert.rejects(p);assert.equal(writes,0);
});
