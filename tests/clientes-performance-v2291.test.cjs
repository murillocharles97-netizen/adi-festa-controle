'use strict';
const assert=require('node:assert/strict'),fs=require('node:fs'),{test}=require('node:test');
const {harness}=require('./helpers/owner-receipt-v219.cjs');
const settled=()=>new Promise(resolve=>setTimeout(resolve,20));
const space=(id)=>({id,businessId:'qa-business',linkedBusinessId:'qa-business',type:'business',active:true,name:id});
function fixture({size=4,mobile=true,role='owner'}={}){
  const h=harness({role,grants:role==='owner'?{}:{'customers.view':true}}),{w}=h,db=h.rows();
  const errors=[], close=h.close;
  w.addEventListener('error',event=>{errors.push(event.error?.message||event.message);event.preventDefault();});
  h.close=()=>{close();assert.deepEqual(errors,[]);};
  w.IntersectionObserver=class{observe(){} disconnect(){}};
  w.scrollTo=()=>{};
  let route='clientes',online=true,read,requests=[];
  w.Router={atual:()=>route};
  w.Utils={...w.Utils,escapar:String,dinheiro:n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),toast:message=>w.lastToast=message};
  w.matchMedia=()=>({matches:mobile,addEventListener(){}});
  w.Cobrancas={ultimaCliente:()=>null,historicoCliente:()=>[]};
  w.Modais={fechar:()=>{w.document.querySelector('#modal').innerHTML='';}};
  w.DB.readForView=w.DB.carregar;
  Object.defineProperty(w.navigator,'onLine',{configurable:true,get:()=>online});
  db.clientes=Array.from({length:size},(_,i)=>({id:'p-'+i,nome:'Cliente '+String(i).padStart(4,'0'),ativo:true,spaceId:i===1?'iptv':'adi',saldo:-3047,financialVersion:13,fiadoHistoryVersion:1,hasInstallmentFiado:true}));
  db.clientes.push({id:'legacy-unassigned',nome:'Origem desconhecida',ativo:true,saldo:-81});
  db.vendas=[];
  if(role!=='owner')h.setContext({spaceAccess:'selected',allowedSpaceIds:['adi']});
  for(const file of ['spaces','clientes','client-filter-rules','mensagens','clientes-page','clientes-mobile'])w.eval(fs.readFileSync('js/'+file+'.js','utf8'));
  w.SpaceContext.setSpaces([space('adi'),space('iptv')]);
  const version=()=>13,day=w.InstallmentPlan.today();
  const proof=(id,{due=52700,future=252000,financialVersion=version(),origins=['adi','adi']}={})=>({clientId:id,version:2,historyProofVersion:1,asOf:day,financialVersion,dueCents:due,futureCents:future,totalCents:due+future,creditCents:0,
    entries:[{spaceId:origins[0],dueDate:day,remainingCents:due},{spaceId:origins[1],dueDate:'2099-01-01',remainingCents:future}].filter(x=>x.remainingCents)});
  const payload=(id,account=proof(id))=>({data:{businessId:'qa-business',workspaceGeneration:0,account}});
  w.FirebaseCallable=async(name,data)=>{
    assert.equal(name,'getOperationalSyncReceipt');assert.equal(data.kind,'fiado_account');assert.equal(data.fiadoHistoryVersion,1);
    requests.push(data.clientId);return read?read(data.clientId):payload(data.clientId);
  };
  const render=()=>{w.document.querySelector('#app').innerHTML=w.ClientesPage.render();};
  const button=(id='p-0')=>w.document.querySelector('[data-fiado-lookup="'+id+'"]');
  const kpis=()=>w.document.querySelector('.client-kpis,.mobile-client-kpis').textContent;
  return {h,w,db,render,button,kpis,proof,payload,requests,setRead:f=>read=f,setRoute:r=>route=r,
    setOnline:v=>{online=v;w.dispatchEvent(new w.Event(v?'online':'offline'));}};
}
for(const size of [100,1000])test('scoped list of '+size+' clients opens without Fiado proof fan-out',async()=>{
  const f=fixture({size});try{
    f.render();await f.w.InstallmentCredit.hydrateVisible();await settled();
    assert.equal(f.requests.length,0);
    assert.match(f.kpis(),/Total por espaço indisponível/);
    assert.doesNotMatch(f.kpis(),/R\$/);
    assert.match(f.w.document.querySelector('.space-unassigned-customers').textContent,/Origem desconhecida/);
    const search=f.w.document.querySelector('#mobile-client-search');search.value='Cliente';search.focus();
    f.button().click();await settled();
    assert.deepEqual(f.requests,['p-0']);
    assert.match(f.w.document.querySelector('[data-mobile-card="p-0"] .mobile-client-balance').textContent,/527,00.*2\.520,00/);
    assert.doesNotMatch(f.kpis(),/R\$/);assert.equal(search.value,'Cliente');
    assert.equal(f.w.document.activeElement,search);
    assert.equal(f.h.commits(),0);
  }finally{f.h.close();}
});
test('same-account pending reads are shared; payment invalidates only the affected display and future remains separate',async()=>{
  const f=fixture({mobile:false});try{
    let resolve;f.setRead(()=>new Promise(r=>{resolve=r;}));
    f.render();
    const button=f.button();button.click();button.click();
    const same=f.w.InstallmentCredit.refresh('p-0');
    assert.equal(f.requests.length,1);
    resolve(f.payload('p-0'));await same;await settled();
    f.setRead(id=>f.payload(id));await f.w.InstallmentCredit.refresh('p-2');
    f.db.clientes[0].saldo=-2947;f.db.clientes[0].financialVersion=14;
    f.setRoute('vender');
    f.w.dispatchEvent(new f.w.CustomEvent('financial-state-updated',{detail:{clientId:'p-0'}}));
    f.setRoute('clientes');f.render();
    assert.equal(f.w.Clientes.financialStatus(f.db.clientes[0]).status,'unverified');
    assert.equal(f.w.Clientes.financialStatus(f.db.clientes[2]).debt,527);
    f.setRead(id=>f.payload(id,f.proof(id,{due:42700,financialVersion:14})));
    f.button().click();await settled();
    assert.equal(f.w.Clientes.financialStatus(f.db.clientes[0]).debt,427);
    assert.equal(f.w.Clientes.financialStatus(f.db.clientes[0]).futureCents,252000);
    f.db.clientes[0].saldo=-2520;f.db.clientes[0].financialVersion=15;
    f.w.dispatchEvent(new f.w.CustomEvent('financial-state-updated',{detail:{clientId:'p-0'}}));
    f.setRead(id=>f.payload(id,f.proof(id,{due:0,financialVersion:15})));
    f.button().click();await settled();
    assert.equal(f.w.Clientes.financialStatus(f.db.clientes[0]).debt,0);
    assert.equal(f.w.Clientes.financialStatus(f.db.clientes[0]).futureCents,252000);
    assert.doesNotMatch(f.kpis(),/R\$/);
  }finally{f.h.close();}
});
test('mixed or unknown origin cannot be shown as the scoped balance; failure can be retried',async()=>{
  const f=fixture();try{
    f.render();f.setRead(()=>Promise.reject(Error('Falha de rede QA')));
    f.button().click();await settled();assert.equal(f.w.lastToast,'Falha de rede QA');assert.ok(!f.button().disabled);
    f.setRead(id=>f.payload(id,f.proof(id,{origins:['adi','iptv']})));
    f.button().click();await settled();
    assert.equal(f.w.Clientes.financialStatus(f.db.clientes[0]).status,'unverified');
    assert.equal(f.button(),null);
    f.setRead(id=>f.payload(id,f.proof(id,{origins:['adi',null]})));
    f.button('p-2').click();await settled();
    assert.equal(f.w.Clientes.financialStatus(f.db.clientes[2]).status,'unverified');
    assert.equal(f.button('p-2'),null);
    assert.doesNotMatch(f.kpis(),/R\$/);
  }finally{f.h.close();}
});
test('rapid navigation, reconnect, tenant change and PWA restart never hydrate other accounts',async()=>{
  const f=fixture();let restart;try{
    f.render();let resolve;f.setRead(()=>new Promise(r=>{resolve=r;}));
    f.button().click();
    f.setRoute('produtos');f.w.SpaceContext.selectActive('iptv');f.setRoute('clientes');f.render();
    resolve(f.payload('p-0'));await settled();
    assert.equal(f.w.InstallmentCredit.confirmedAccount('p-0'),null);
    assert.equal(f.requests.length,1);
    f.setOnline(false);f.setOnline(true);await settled();assert.equal(f.requests.length,1);
    f.w.SpaceContext.selectActive('adi');f.render();
    f.button().click();f.h.setContext({businessId:'other-tenant'});
    resolve(f.payload('p-0'));await settled();assert.equal(f.w.InstallmentCredit.confirmedAccount('p-0'),null);
    restart=fixture();restart.render();await settled();assert.equal(restart.requests.length,0);assert.ok(restart.button());
  }finally{f.h.close();restart?.h.close();}
});
test('restricted operator is not offered proof lookup or company aggregates',async()=>{
  const f=fixture({role:'seller'});try{
    f.w.OperationalReadPolicy={restricted:()=>true};
    f.render();await f.w.InstallmentCredit.hydrateVisible();await settled();
    assert.equal(f.requests.length,0);
    assert.equal(f.button(),null);
    assert.doesNotMatch(f.kpis(),/R\$/);
  }finally{f.h.close();}
});

test('a financial event rejects a late proof even before the new client version arrives',async()=>{
  const f=fixture();try{
    let resolve;f.setRead(()=>new Promise(r=>{resolve=r;}));
    const pending=f.w.InstallmentCredit.refresh('p-0');
    f.w.dispatchEvent(new f.w.CustomEvent('financial-state-updated',{detail:{clientId:'p-0'}}));
    resolve(f.payload('p-0'));
    await assert.rejects(pending,/sessão mudou/);
    assert.equal(f.w.InstallmentCredit.confirmedAccount('p-0'),null);
    assert.equal(f.requests.length,1);
  }finally{f.h.close();}
});
