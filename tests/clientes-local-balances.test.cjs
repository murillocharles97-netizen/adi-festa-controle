'use strict';
const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {performance} = require('node:perf_hooks');
const {harness} = require('./helpers/owner-receipt-v219.cjs');
const sleep = () => new Promise(resolve => setTimeout(resolve, 30));
const ADI='business_adi-festa', CARD='ca504a66-0602-434e-bee3-58a274eeb772', IPTV='iptv';
const EXCEPTION='6b382859-6f5f-4c16-a5dd-c5af33cbb42e';
function fixture({mobile=true, single=false, businessId='adi-festa', size=0}={}) {
  const h=harness({businessId}), {w}=h, db=h.rows();
  w.Router={atual:()=> 'clientes'}; w.scrollTo=()=>{};
  w.Utils={...w.Utils,escapar:String,dinheiro:n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'})};
  w.Cobrancas={ultimaCliente:()=>null,historicoCliente:()=>[]};
  w.Modais={fechar:()=>{w.document.querySelector('#modal').innerHTML='';}};
  w.IntersectionObserver=class{observe(){}disconnect(){}};
  w.matchMedia=()=>({matches:mobile,addEventListener(){}});
  w.DB.readForView=w.DB.carregar;
  const space=(id,name)=>({id,name,businessId,linkedBusinessId:businessId,type:'business',active:true});
  const day=w.InstallmentPlan.today(), date='2026-11-09T15:00:00.000Z';
  db.vendas=[];
  db.clientes=size?Array.from({length:size},(_,i)=>({id:'c-'+i,nome:'Cliente '+i,ativo:true,saldo:-10,financialVersion:1})):[
    {id:'mae',nome:'Pessoa sintética M',ativo:true,saldo:-3047,financialVersion:13,legacyBalanceRemaining:22,fiadoHistoryVersion:1,hasInstallmentFiado:true},
    {id:'legacy',nome:'Pessoa sintética L',ativo:true,saldo:-100},
    {id:'two',nome:'Pessoa sintética D',ativo:true,saldo:-80},
    {id:'zero',nome:'Pessoa sintética Z',ativo:true,saldo:0,spaceId:ADI},
  ];
  if(!size) db.vendas=[
    {id:EXCEPTION,clienteId:'mae',businessId,spaceId:CARD,formaPagamento:'fiado',status:'fiado',valorFinal:2800,creditPaidAmount:0,
      data:date,installmentPlan:w.InstallmentPlan.create({total:2800,count:10,downPayment:0,firstDueDate:'2026-11-09',saleDate:'2026-11-09'})},
    ...[[ADI,50],[IPTV,30]].map(([spaceId,total],i)=>({id:'new-'+i,clienteId:'two',businessId,spaceId,formaPagamento:'fiado',status:'fiado',valorFinal:total,
      creditOriginalAmount:total,creditPaidAmount:0,creditRemainingAmount:total,data:day+'T15:00:00.000Z',financialAppliedAt:'2026-11-10T14:00:00.000Z'})),
  ];
  for(const file of ['spaces','clientes','client-filter-rules','mensagens','clientes-page','clientes-mobile'])w.eval(fs.readFileSync('js/'+file+'.js','utf8'));
  w.SpaceContext.setSpaces(single?[space(ADI,'Adi Festa')]:[space(ADI,'Adi Festa'),space(CARD,'Emprestar cartão'),space(IPTV,'IPTV')]);
  w.BusinessContext.canAccessSpace=id=>[ADI,CARD,IPTV].includes(id);
  w.SpaceContext.selectActive(ADI);
  let requests=0,read;
  w.FirebaseCallable=async(name,data)=>{requests++;if(read)return read(name,data);throw Error('Unexpected remote read');};
  const render=()=>{w.document.querySelector('#app').innerHTML=w.ClientesPage.render();};
  const summary=()=>JSON.parse(JSON.stringify(w.Clientes.listSummary()));
  return {h,w,db,render,summary,calls:()=>requests,setRead:fn=>read=fn,close:async()=>{await sleep();h.close();}};
}
for(const mobile of [true,false])test('loaded register balances split legacy and future installments in '+(mobile?'390px layout':'desktop layout'),async()=>{
  const f=fixture({mobile});try{
    f.render();await f.w.InstallmentCredit.hydrateVisible();await sleep();
    assert.equal(f.calls(),0);
    assert.deepEqual(f.summary(),{dueCents:39700,futureCents:0,debtors:3,unknown:0,partial:false});
    assert.equal(f.w.Clientes.listFinancialStatus(f.db.clientes[0]).debt,247);
    assert.equal(f.w.Clientes.financialStatus(f.db.clientes[0]).status,'unverified');
    const list=f.w.Clientes.viewData().clientes;assert.ok(list.some(c=>c.id==='legacy'));assert.equal(new Set(list.map(c=>c.id)).size,list.length);
    assert.match(f.w.document.querySelector('.mobile-client-kpis,.client-kpis').textContent,/397,00/);
    f.w.SpaceContext.selectActive(CARD);f.render();
    assert.deepEqual(f.summary(),{dueCents:28000,futureCents:252000,debtors:1,unknown:0,partial:false});
    assert.equal(f.w.Clientes.listFinancialStatus(f.db.clientes[0]).debt,280);
    assert.match(f.w.document.querySelector('.clients-page').textContent,/2\.520,00/);
    f.db.clientes[0].saldo=-2767;
    f.db.vendas.find(s=>s.id===EXCEPTION).creditPaidAmount=280;
    f.render();
    assert.equal(f.summary().dueCents,0);
    assert.equal(f.summary().futureCents,252000);
    assert.match(f.w.document.querySelector('[data-mobile-card="mae"],[data-client-id="mae"]').textContent,/nada exigível agora/i);
    f.w.SpaceContext.selectActive(IPTV);f.render();
    assert.equal(f.summary().dueCents,3000);assert.equal(f.w.Clientes.viewData().clientes.some(c=>c.id==='legacy'),false);
    assert.equal(f.h.commits(),0);
  }finally{await f.close();}
});
test('a single-space company reads the existing balance even with an outdated legacy projection',async()=>{
  const f=fixture({single:true,businessId:'single-qa',size:1});try{
    Object.assign(f.db.clientes[0],{saldo:-247,legacyBalanceRemaining:22,fiadoHistoryVersion:1});
    f.render();await f.w.InstallmentCredit.hydrateVisible();await sleep();
    assert.equal(f.summary().dueCents,24700);assert.equal(f.calls(),0);
    assert.doesNotMatch(f.w.SpaceContext.renderBar('clients'),/data-space-select=/);
    assert.equal(f.w.Clientes.listFinancialStatus(f.db.clientes[0]).debt,247);
  }finally{await f.close();}
});
test('unknown new origins, incomplete calendars and conflicting snapshots cannot become definitive totals',async()=>{
  const f=fixture();try{
    f.db.clientes.push({id:'unknown',nome:'Origem a conferir',saldo:-20,ativo:true,spaceId:ADI});
    f.db.vendas.push({id:'missing-origin',clienteId:'unknown',formaPagamento:'fiado',status:'fiado',valorFinal:20,financialAppliedAt:'2026-11-10T15:00:00.000Z'});
    f.render();assert.equal(f.summary().dueCents,39700);assert.equal(f.summary().unknown,1);
    assert.match(f.w.document.querySelector('.mobile-client-kpis').textContent,/Parte identificada/);
    assert.equal(f.w.Clientes.listFinancialStatus(f.db.clientes.at(-1)).status,'unverified');
    f.db.vendas.at(-1).spaceId=ADI;f.db.vendas.at(-1).financialSpaceId=IPTV;
    f.db.vendas.at(-1).financialAppliedAt='2026-10-01T15:00:00.000Z';f.render();
    assert.equal(f.summary().dueCents,39700);assert.equal(f.summary().unknown,1);
    f.db.vendas.find(s=>s.id===EXCEPTION).creditPaidAmount=2801;f.render();
    assert.equal(f.w.Clientes.listFinancialStatus(f.db.clientes[0]).status,'unverified');
    f.db.clientes[0].hasInstallmentFiado=true;f.db.vendas=f.db.vendas.filter(s=>s.id!==EXCEPTION);f.render();
    assert.equal(f.w.Clientes.listFinancialStatus(f.db.clientes[0]).status,'unverified');
    assert.equal(f.summary().unknown,2);assert.equal(f.h.commits(),0);
  }finally{await f.close();}
});
test('the original financial proof still gates receipts and a partial synthetic receipt updates the loaded card',async()=>{
  const f=fixture({single:true,size:1});try{
    const client=f.db.clientes[0];client.saldo=-100;client.financialVersion=1;
    f.render();let fail=true;
    f.setRead((name,data)=>{assert.equal(name,'getOperationalSyncReceipt');assert.equal(data.kind,'fiado_account');
      if(fail)throw Error('QA proof unavailable');
      return {data:{businessId:'adi-festa',workspaceGeneration:0,account:{clientId:client.id,version:1,asOf:f.w.InstallmentPlan.today(),financialVersion:1,
        dueCents:10000,futureCents:0,totalCents:10000,creditCents:0,entries:[{spaceId:ADI,saleId:null,number:null,dueDate:'0001-01-01',remainingCents:10000}]}}};});
    const scope=f.w.SpaceContext.viewScope();
    await assert.rejects(f.w.Clientes.confirmSpaceAccount(client.id,scope),/QA proof unavailable/);assert.equal(f.h.commits(),0);
    fail=false;const account=await f.w.Clientes.confirmSpaceAccount(client.id,scope);assert.equal(account.dueCents,10000);
    // Exercise the unchanged receiver, not a presentation-only balance update.
    const attempt=f.w.Fiados.receiptAttempt(client.id,{scoped:true,spaceScope:scope}), options={spaceId:ADI,paymentMethod:'pix',paymentMode:'partial'};
    const payment=await attempt.confirm(25,'QA',options);
    assert.equal((await attempt.confirm(25,'QA',options)).operationId,payment.operationId);
    assert.equal(payment.valor,25);assert.equal(f.h.commits(),1);assert.equal(f.h.rows().clientes[0].saldo,-75);
    f.w.dispatchEvent(new f.w.CustomEvent('financial-state-updated',{detail:{clientId:client.id}}));
    f.render();assert.equal(f.summary().dueCents,7500);
  }finally{await f.close();}
});
test('explicit QA identities keep their exclusively QA-space balance out of commercial legacy totals',async()=>{
  const f=fixture();try{
    f.w.SpaceContext.setSpaces([...f.w.SpaceContext.homeSpaces(),{id:'qa-space',name:'VECONI QA synthetic',businessId:'adi-festa',type:'business',active:true}]);
    f.db.clientes.push({id:'qa_example_client',nome:'Synthetic QA',ativo:true,saldo:-27});
    f.db.vendas.push({id:'qa_example_sale',clienteId:'qa_example_client',spaceId:'qa-space',formaPagamento:'fiado',status:'fiado',valorFinal:20,creditPaidAmount:5,data:'2026-10-01T12:00:00.000Z'});
    f.render();assert.equal(f.summary().dueCents,39700);assert.equal(f.summary().debtors,3);
    f.w.SpaceContext.selectActive('qa-space');f.render();assert.equal(f.summary().dueCents,2700);assert.equal(f.h.commits(),0);
  }finally{await f.close();}
});
test('a restricted employee keeps the previous authorization gates and cannot use the owner fallback',async()=>{
  const f=fixture();try{
    f.h.setContext({role:'seller',spaceAccess:'selected',allowedSpaceIds:[IPTV]});
    f.w.OperationalReadPolicy={restricted:()=>true};f.render();await f.w.InstallmentCredit.hydrateVisible();
    assert.equal(f.w.Clientes.localListBalances(),false);assert.equal(f.w.Clientes.listSummary(),null);assert.equal(f.calls(),0);
    assert.equal(f.w.Clientes.listFinancialStatus(f.db.clientes[0]).status,'unverified');
  }finally{await f.close();}
});
for(const size of [100,1000])test('fast opening of '+size+' loaded clients does not fan out financial reads',async()=>{
  const f=fixture({size});try{
    const start=performance.now();f.render();const renderMs=performance.now()-start;
    await f.w.InstallmentCredit.hydrateVisible();await sleep();
    assert.equal(f.calls(),0);assert.equal(f.summary().dueCents,size*1000);assert.equal(f.summary().debtors,size);
    assert.equal(f.w.document.querySelectorAll('[data-mobile-card]').length,20);
    console.log(JSON.stringify({customers:size,renderMs,financialRequests:f.calls(),visibleCards:20}));
  }finally{await f.close();}
});

test('mobile pagination adds only the next cards and ignores a queued observer after leaving',async()=>{
  const f=fixture({size:70});try{
    let latest,route='clientes';
    f.w.Router.atual=()=>route;
    f.w.IntersectionObserver=class {
      constructor(callback){this.callback=callback;latest=this;}
      observe(){}
      disconnect(){}
      fire(){this.callback([{isIntersecting:true}]);}
    };
    f.render();await sleep();
    const root=f.w.document.querySelector('#mobile-client-list'), first=root.firstElementChild;
    assert.equal(root.children.length,20);assert.ok(latest);
    latest.fire();
    assert.equal(root.children.length,40);assert.equal(root.firstElementChild,first);
    const pending=latest;
    route='produtos';f.w.ClientesMobile.cancelPending();
    const app=f.w.document.querySelector('#app');app.innerHTML='<section id="products-fixture">Produtos</section>';
    pending.fire();f.w.ClientesMobile.search('Cliente');
    assert.equal(root.children.length,40);assert.ok(app.querySelector('#products-fixture'));
    assert.equal(f.calls(),0);
  }finally{await f.close();}
});

test('charge lookup prepared for the list preserves message deduplication and legacy fallback',async()=>{
  const f=fixture();try{
    const data={messageHistory:[
      {id:'one',operationId:'same',clientId:'mae',type:'charge',status:'opened_whatsapp',createdAt:'2026-11-03'},
      {id:'other',clientId:'mae',type:'charge',status:'sent_confirmed',sentAt:'2026-11-04'},
      {id:'draft',clientId:'mae',type:'charge',status:'draft',createdAt:'2026-11-10'},
    ],cobrancas:[{id:'legacy-old',clienteId:'legacy',data:'2026-11-01'},{id:'legacy-new',clienteId:'legacy',data:'2026-11-02'}]};
    f.w.MessageSequence={history:()=>[{id:'updated',operationId:'same',clientId:'mae',type:'charge',status:'sent_confirmed',sentAt:'2026-11-05'}]};
    const lookup=f.w.Mensagens.latestCharges(data);
    for(const client of [...f.db.clientes,{id:'no-history',lastChargeAt:'2026-11-06'}])
      assert.deepEqual(lookup(client),f.w.Mensagens.latestCharge(client,data));
    assert.equal(lookup(f.db.clientes[0]).id,'updated');
    assert.equal(lookup(f.db.clientes[1]).id,'legacy-new');
  }finally{await f.close();}
});
