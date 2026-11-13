'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{test}=require('node:test');
const {harness}=require('./helpers/owner-receipt-v219.cjs');
const files=['js/spaces.js','js/clientes.js','js/customer-subscriptions.js'];
const makeSpace=(id,businessId='qa-business',extra={})=>({id,businessId,linkedBusinessId:businessId,name:id,type:'business',active:true,...extra});
const ids=rows=>Array.from(rows,row=>row.id);
function fixture({single=false,storage={}}={}){
  const h=harness(),{w}=h;const db=h.rows();
  for(const [key,value] of Object.entries(storage))w.localStorage.setItem(key,value);
  w.Router={atual:()=> 'clientes'};w.Utils.escapar=String;
  const c=db.clientes[0];Object.assign(c,{saldo:-300,financialVersion:13,hasInstallmentFiado:true});
  db.clientes.push({id:'client-b',spaceId:'b',saldo:0},{id:'unassigned',nome:'Cadastro legado',saldo:-80},{id:'foreign-client',businessId:'foreign',spaceId:'a',saldo:0});
  db.vendas=[{id:'sa',spaceId:'a',clienteId:c.id,status:'fiado',valorFinal:80,data:'2026-11-01'},
    {id:'sb',spaceId:'b',clienteId:c.id,status:'pago',valorFinal:220,data:'2026-11-07'},
    {id:'foreign-sale',businessId:'foreign',spaceId:'a',clienteId:'unassigned',valorFinal:900},
    {id:'cancelled',spaceId:'a',clienteId:'unassigned',status:'cancelada'},
    {id:'undated',businessId:'qa-business',clienteId:'unassigned',valorFinal:80}];
  db.produtos=[{id:'only-a',spaceAccessMode:'single_space',defaultSpaceId:'a',estoqueAtual:7},
    {id:'only-b',spaceAccessMode:'single_space',defaultSpaceId:'b',estoqueAtual:3},
    {id:'both',spaceAccessMode:'selected_spaces',allowedSpaceIds:['a','b'],estoqueAtual:11},
    {id:'foreign-product',businessId:'foreign',spaceAccessMode:'all_spaces',estoqueAtual:21}];
  db.customerSubscriptions=[{id:'ra',clientId:c.id,spaceId:'a',expiresAt:'2027-01-01'},
    {id:'rb',clientId:c.id,spaceId:'b',expiresAt:'2027-01-01'},
    {id:'unknown-renewal',clientId:'unassigned',expiresAt:'2027-01-01'}];
  db.pagamentos=[{id:'pa',spaceId:'a',valor:10},{id:'pb',spaceId:'b',valor:20}];
  for(const file of files)w.eval(fs.readFileSync(file,'utf8'));
  const all=[makeSpace('a'),makeSpace('b'),makeSpace('foreign','foreign'),makeSpace('private','qa-business',{type:'personal',ownerUid:'other',capabilities:{sales:true}})];
  w.SpaceContext.setSpaces(single?[all[0]]:all);
  return {h,w,db,c,all,s:w.SpaceContext,close:()=>h.close()};
}

test('one active space hides selectors and retains the existing shared directory for an unrestricted operator',()=>{
  const f=fixture({single:true});try{
    assert.equal(f.s.homeId(),'a');assert.equal(f.s.salesId(),'a');
    for(const kind of ['home','clients','products','sales'])assert.doesNotMatch(f.s.renderBar(kind),/data-space-select=|data-space-picker=/);
    assert(f.w.Clientes.viewData().clientes.some(client=>client.id==='unassigned'));
  }finally{f.close();}
});

test('one customer appears in both explicitly linked spaces and remains a single company record',()=>{
  const f=fixture();
  try{
    const client={id:'qa-multi-link',businessId:'qa-business',spaceId:'a',customerSpaceIds:['a','b'],nome:'QA',saldo:0};
    f.db.clientes.push(client);
    for(const space of ['a','b']){
      f.s.selectActive(space);
      assert.ok(ids(f.w.Clientes.viewData().clientes).includes(client.id));
      assert.ok(!ids(f.w.Clientes.viewData().unassignedCustomers).includes(client.id));
    }
    assert.equal(f.db.clientes.filter(row=>row.id===client.id).length,1);
  }finally{f.close();}
});

test('normal selector changes all operational screens and restores the same selection after restart',()=>{
  const f=fixture();let restart;try{
    const scope=f.s.viewScope();f.w.document.querySelector('#app').innerHTML=f.s.renderBar('clients');f.s.bind(f.w.document);
    const select=f.w.document.querySelector('[data-space-select]');assert.deepEqual(Array.from(select.options,o=>o.value),['a','b']);
    select.value='b';select.dispatchEvent(new f.w.Event('change'));
    assert.notEqual(f.s.viewScope(),scope);assert.equal(f.s.salesId(),'b');assert.equal(f.s.homeId(),'b');
    assert.match(f.s.renderBar('home'),/Selecionado: b/);assert.match(f.s.renderBar('products'),/value="b" selected/);
    assert.throws(()=>f.s.selectActive('all_spaces'),/autorizado/);assert.throws(()=>f.s.selectActive('foreign'),/autorizado/);
    restart=fixture({storage:{...f.w.localStorage}});assert.equal(restart.s.activeId(),'b');
    restart.s.selectSales('a');assert.equal(restart.s.homeId(),'a');
  }finally{f.close();restart?.close();}
});

test('staff selection revalidates all/selected, access revocation, company and permission loading',()=>{
  const f=fixture();try{
    f.s.selectSales('b');const ownerScope=f.s.viewScope(),context=f.h.context();
    f.h.setContext({role:'seller',spaceAccess:'all',allowedSpaceIds:[]});assert.equal(f.s.activeId(),'b');
    assert.notEqual(f.s.viewScope(),ownerScope);
    f.h.setContext({spaceAccess:'selected',allowedSpaceIds:['a']});assert.equal(f.s.activeId(),'a');
    assert.throws(()=>f.s.selectSales('b'),/ativo/);assert.throws(()=>f.s.requireSalesSpace('b'),/ativo/);
    assert.doesNotMatch(f.s.renderBar('clients'),/value="b"/);assert.deepEqual(ids(f.w.Clientes.viewData().unassignedCustomers),[]);
    f.h.setContext({loading:true});assert.equal(f.s.activeId(),'');assert.deepEqual(ids(f.w.Clientes.viewData().clientes),[]);
    f.h.setContext({...context,businessId:'qa-other',userProfile:{...context.userProfile,businessId:'qa-other'}});
    f.s.setSpaces([makeSpace('c','qa-other')]);assert.equal(f.s.activeId(),'c');assert.deepEqual(ids(f.s.contextualData(f.db).vendas),[]);
    f.h.setContext(context);assert.equal(f.s.activeId(),'b');
  }finally{f.close();}
});

test('customer links, historical warnings, products, revenues and renewals use original space evidence',()=>{
  const f=fixture();try{
    const original=JSON.stringify(f.db), first=f.w.Clientes.viewData();
    assert.deepEqual(ids(first.clientes),[f.c.id]);assert.equal(first.clientes[0].totalComprado,80);
    assert.match(f.w.Clientes.unassignedMarkup(),/Cadastro legado/);
    assert.deepEqual(ids(first.vendas.filter(f.s.isValidSale)),['sa']);assert.deepEqual(ids(first.pagamentos),['pa']);
    assert.deepEqual(ids(f.s.productsForView(f.db.produtos)),['only-a','both']);
    assert.deepEqual(ids(f.w.CustomerSubscriptions.view.forClient(f.c.id)),['ra']);assert.equal(f.w.CustomerSubscriptions.view.get('rb'),null);
    f.s.selectHome('b');const second=f.w.Clientes.viewData();
    assert.deepEqual(ids(second.clientes),[f.c.id,'client-b']);assert.equal(second.clientes[0].totalComprado,220);
    assert.deepEqual(ids(second.pagamentos),['pb']);assert.deepEqual(ids(f.s.productsForView(f.db.produtos)),['only-b','both']);
    assert.deepEqual(ids(f.w.CustomerSubscriptions.view.forClient(f.c.id)),['rb']);
    assert.equal(f.w.CustomerSubscriptions.view.get('unknown-renewal'),null);assert(f.w.CustomerSubscriptions.view.hasUnassigned('unassigned'));assert.equal(f.w.Clientes.listar().length,4);
    assert.equal(JSON.stringify(f.db),original);
  }finally{f.close();}
});

test('pending offline operation remains in its original space; a live cart prevents switching from any screen',()=>{
  const f=fixture();try{
    const pending={id:'operation-a',payload:{writes:[{entityType:'sales',data:{spaceId:'a'}}]}};
    f.w.localStorage.setItem('offline-queue-fixture',JSON.stringify(pending));
    f.w.Checkout={state:()=>({finishing:false}),cartCount:()=>1};assert.throws(()=>f.s.selectHome('b'),/atendimento/);
    assert.equal(f.s.activeId(),'a');f.w.Checkout.cartCount=()=>0;
    f.s.selectHome('b');assert.equal(f.s.requireSalesSpace(),'b');
    assert.equal(f.w.localStorage.getItem('offline-queue-fixture'),JSON.stringify(pending));assert.equal(f.h.commits(),0);
  }finally{f.close();}
});

function proof(f,origins){
  return {clientId:f.c.id,version:2,historyProofVersion:1,asOf:f.w.InstallmentPlan.today(),financialVersion:13,
    dueCents:8000,futureCents:22000,totalCents:30000,creditCents:0,
    entries:origins.map((spaceId,i)=>({spaceId,dueDate:i?f.w.InstallmentPlan.month(f.w.InstallmentPlan.today(),1):f.w.InstallmentPlan.today(),remainingCents:i?22000:8000}))};
}

test('scoped Fiado only shows and allows confirmation of a fully proved account from the active space',async()=>{
  const f=fixture();try{
    let a=proof(f,['a','a']);f.w.FirebaseCallable=async()=>({data:{businessId:'qa-business',workspaceGeneration:0,account:a}});
    assert.equal(f.w.Clientes.listFinancialStatus(f.c).status,'unverified');
    assert.equal((await f.w.Clientes.confirmSpaceAccount(f.c.id)).futureCents,22000);
    assert.equal(f.w.Clientes.listFinancialStatus(f.c).debt,80);assert.equal(f.w.Clientes.listFinancialStatus(f.c).futureCents,22000);
    a=proof(f,['a','b']);await assert.rejects(f.w.Clientes.confirmSpaceAccount(f.c.id),/outro espaço/);
    assert.equal(f.w.Clientes.listFinancialStatus(f.c).debt,80);
    assert.equal(f.w.Clientes.listFinancialStatus(f.c).futureCents,0);
    a=proof(f,['a',null]);await assert.rejects(f.w.Clientes.confirmSpaceAccount(f.c.id),/origem não comprovada/);
    assert.equal(f.h.commits(),0);
  }finally{f.close();}
});

test('an in-flight financial proof cannot return into A after switching A → B → A',async()=>{
  const f=fixture();try{
    let finish;f.w.FirebaseCallable=()=>new Promise(resolve=>{finish=resolve;});
    const read=f.w.Clientes.confirmSpaceAccount(f.c.id);f.s.selectHome('b');f.s.selectHome('a');
    finish({data:{businessId:'qa-business',workspaceGeneration:0,account:proof(f,['a','a'])}});
    await assert.rejects(read,/sessão mudou/);assert.equal(f.w.InstallmentCredit.confirmedAccount(f.c.id),null);
  }finally{f.close();}
});

test('renewals link customers to their own space without changing checkout candidates or attributing legacy vigencies',()=>{
  const f=fixture();let single;try{
    f.db.clientes.push({id:'iptv-only',saldo:0});
    const rows=f.db.customerSubscriptions;
    Object.assign(rows[1],{productId:'service',contractedPrice:29});
    rows.push({id:'iptv-renewal',clientId:'iptv-only',financialSpaceId:'b',expiresAt:'2027-01-01'},
      {id:'unassigned-shared',clientId:f.c.id,productId:'service',expiresAt:'2027-01-01'},
      {id:'foreign-renewal',businessId:'foreign',clientId:f.c.id,spaceId:'a',expiresAt:'2027-01-01'});
    const subs=f.w.CustomerSubscriptions;
    assert(!ids(f.w.Clientes.viewData().clientes).includes('iptv-only'));
    assert.deepEqual(ids(subs.view.forClient(f.c.id)),['ra']);
    assert(subs.view.hasUnassigned(f.c.id));
    assert.deepEqual(ids(subs.matchingProduct(f.c.id,'service')),['rb','unassigned-shared']);
    f.s.selectActive('b');
    assert(ids(f.w.Clientes.viewData().clientes).includes('iptv-only'));
    assert.deepEqual(ids(subs.view.forClient('iptv-only')),['iptv-renewal']);
    assert.deepEqual(ids(subs.view.forClient(f.c.id)),['rb']);
    assert.equal(subs.get('rb').spaceId,'b');

    f.h.setContext({role:'seller',spaceAccess:'selected',allowedSpaceIds:['a']});
    assert.equal(f.s.activeId(),'a');
    assert.equal(subs.view.get('rb'),null);
    assert.equal(subs.view.hasUnassigned(f.c.id),false);
    f.w.OperationalReadPolicy={restricted:()=>true};
    assert.equal(subs.view.get('ra'),null);

    single=fixture({single:true});
    assert.deepEqual(ids(single.w.CustomerSubscriptions.view.forClient('unassigned')),['unknown-renewal']);
    assert.equal(single.w.CustomerSubscriptions.view.hasUnassigned('unassigned'),false);
  }finally{f.close();single?.close();}
});

test('commercial renewal of linked and unassigned vigencies follows V228 even in a scoped company',()=>{
  const f=fixture();try{
    f.db.produtos.push({id:'service',productType:'recurring',durationValue:1,durationUnit:'months'});
    for(const id of ['rb','unknown-renewal']){
      const row=f.db.customerSubscriptions.find(item=>item.id===id);
      const sale={id:'sale-'+id,spaceId:'a',clientId:row.clientId,createdAt:'2026-11-09T12:00:00Z',
        itens:[{produtoId:'service',precoUnitario:29,recurringActivation:{subscriptionId:id}}]};
      const subs=f.w.CustomerSubscriptions, preview=subs.preview({subscription:row,at:sale.createdAt,durationValue:1,durationUnit:'months',legacy:true});
      const [outcome]=subs.applySaleInData(f.db,sale);
      assert.equal(outcome.action,'renewal');
      assert.equal(outcome.subscriptionId,id);
      assert.equal(sale.itens[0].subscriptionExpiresAt,preview.expiresAt);
      assert.equal(row.contractedPrice,29);
      assert.equal(subs.applySaleInData(f.db,sale)[0].idempotent,true);
      assert.equal(subs.reverseSaleInData(f.db,sale)[0],id);
      assert.equal(subs.get(id).spaceId,id==='rb'?'b':undefined);
    }
  }finally{f.close();}
});

test('scoped receipt cannot post into a different authorized space or allocate a mixed balance',async()=>{
  const f=fixture();try{
    let a=proof(f,['a','a']);f.w.FirebaseCallable=async()=>({data:{businessId:'qa-business',workspaceGeneration:0,account:a}});
    const attempt=f.w.Fiados.receiptAttempt(f.c.id,{spaceScope:f.s.viewScope()});
    await assert.rejects(attempt.confirm(10,'',{spaceId:'b',paymentMethod:'pix'}),/espaço ativo/);
    a=proof(f,['a','b']);await assert.rejects(attempt.confirm(10,'',{spaceId:'a',paymentMethod:'pix'}),/outro espaço/);
    assert.equal(f.h.commits(),0);assert.equal(f.db.pagamentos.length,2);
  }finally{f.close();}
});

test('the renewal overview counts only the active space and preserves legacy metrics in a single space',()=>{
  const f=fixture();let single;try{
    for(const [i,row] of f.db.customerSubscriptions.entries()){
      row.expiresAt='2027-01-01T22:00:00.000Z';row.contractedPrice=(i+1)*10;
    }
    const ref='2027-01-01T13:00:00.000Z',view=f.w.CustomerSubscriptions.view;
    assert.equal(view.metrics(ref).forecastValue,10);
    f.s.selectActive('b');
    assert.equal(view.metrics(ref).forecastValue,20);
    single=fixture({single:true});
    single.db.customerSubscriptions.find(row=>row.id==='unknown-renewal').contractedPrice=30;
    assert.equal(single.w.CustomerSubscriptions.view.metrics('2027-01-01').forecastValue,30);
  }finally{f.close();single?.close();}
});

test('cold renewal link reads use the authorized active space and discard late A → B → A results',async()=>{
  const f=fixture();try{
    const source=fs.readFileSync('js/firebase/sync.js','utf8');
    const start=source.indexOf('async function queryRenewalsForSpace(');
    const end=source.indexOf('async function queryAllClientsForAction',start);
    assert(start>=0&&end>start);
    const {w,s}=f,calls=[],merged=[];
    Object.assign(w,{
      captureCloudReadScope:()=>s.viewScope(),
      assertCloudReadScope:(scope)=>{if(scope!==s.viewScope())throw Error('retired');},
      validateUser:async()=>{},
      canPullSource:()=>true,
      applyCloudCollection:(name,items)=>merged.push([name,ids(items)]),
    });
    let finish,startRead;
    w.repositories={customerSubscriptions:{listWherePaged:async(field,id)=>{
      calls.push([field,id]);
      if(field==='spaceId')return new Promise(resolve=>{finish=resolve;startRead();});
      return [{id:'alias',financialSpaceId:id},{id:'other-space',spaceId:'b',financialSpaceId:id}];
    }}};
    w.eval(source.slice(start,end));
    let started=new Promise(resolve=>{startRead=resolve;});
    const stale=w.queryRenewalsForSpace();
    await started;
    s.selectActive('b');s.selectActive('a');
    finish([{id:'old-response',spaceId:'a'}]);
    await assert.rejects(stale,/retired/);
    assert.deepEqual(merged,[]);
    started=new Promise(resolve=>{startRead=resolve;});
    const current=w.queryRenewalsForSpace();
    await started;
    finish([{id:'local-space',spaceId:'a'},{id:'foreign',businessId:'other',spaceId:'a'}]);
    assert.deepEqual(ids(await current),['local-space','alias']);
    assert.deepEqual(calls,[['spaceId','a'],['financialSpaceId','a'],['spaceId','a'],['financialSpaceId','a']]);
    assert.deepEqual(merged,[['customerSubscriptions',['local-space','alias']]]);
    w.OperationalReadPolicy={restricted:()=>true};
    assert.deepEqual(ids(await w.queryRenewalsForSpace()),[]);
    assert.equal(calls.length,4);
  }finally{f.close();}
});
