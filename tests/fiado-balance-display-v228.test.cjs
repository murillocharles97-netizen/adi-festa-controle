'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {harness}=require('./helpers/owner-receipt-v219.cjs');
const tick=()=>new Promise(resolve=>setTimeout(resolve,15));
function fixture({mobile=false,fail=false}={}){
 const h=harness(),w=h.w;let calls=0,offline=false;
 const errors=[],close=h.close;w.addEventListener('error',e=>{errors.push(e.error?.message||e.message);e.preventDefault();});h.close=()=>{close();assert.deepEqual(errors,[],'no unhandled UI errors');};
 w.InstallmentPlan={...w.InstallmentPlan,today:()=> '2026-11-09'};
 const client=h.rows().clientes[0];Object.assign(client,{saldo:-3047,financialVersion:13,fiadoHistoryVersion:1,hasInstallmentFiado:true,telefone:'11999999999'});
 h.rows().vendas=[];h.rows().movimentacoes=[];h.rows().cobrancas=[];
 const result={version:2,historyProofVersion:1,clientId:client.id,asOf:'2026-11-09',financialVersion:13,dueCents:52700,futureCents:252000,totalCents:304700,creditCents:0,entries:[{dueDate:'2026-12-09',remainingCents:28000}]};
 w.FirebaseCallable=async(name,data)=>{calls++;assert.equal(name,'getOperationalSyncReceipt');assert.equal(data.kind,'fiado_account');assert.equal(data.fiadoHistoryVersion,1);if(fail)throw Error('rede indisponível');return{data:{businessId:w.DB.getBusinessId(),workspaceGeneration:0,account:structuredClone(result)}};};
 Object.defineProperty(w.navigator,'onLine',{get:()=>!offline,configurable:true});
 w.Utils={...w.Utils,escapar:s=>String(s??''),dinheiro:n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),somenteNumeros:s=>String(s).replace(/\D/g,''),telefoneWhatsApp:s=>'55'+s};
 w.PhoneUtils={normalizeBrazilianPhone:s=>'55'+s};w.matchMedia=()=>({matches:mobile,addEventListener(){}});
 w.Cobrancas={ultimaCliente:()=>null,historicoCliente:()=>[]};w.Router={atual:()=> 'clientes'};
 w.CustomerSubscriptions={view:{forClient:()=>[],hasUnassigned:()=>false,loadForClient:async()=>[]},effectiveStatus:()=> 'active'};
 w.Modais={fechar:()=>{w.document.querySelector('#modal').innerHTML='';}};
 w.DB.readForView=w.DB.carregar;w.SyncFirebase.isReady=()=>true;w.SyncFirebase.readCanonicalClient=async()=>({client:structuredClone(client)});
 for(const file of ['js/clientes.js','js/client-filter-rules.js','js/mensagens.js','js/clientes-page.js','js/clientes-mobile.js'])w.eval(fs.readFileSync(file,'utf8'));
 function mount(){const app=w.document.querySelector('#app');app.innerHTML=`<section class="clients-page" data-clients-bound="true"><input id="preserved-search" value="teste"><div id="${mobile?'mobile-client-list':'client-list'}">${(mobile?w.ClientesMobile:w.ClientesPage).renderCard(client,0)}</div></section>`;}
 return{h,w,client,result,mount,calls:()=>calls,setFail:value=>{fail=value;},setOffline:value=>{offline=value;w.dispatchEvent(new w.Event(value?'offline':'online'));}};
}
for(const mobile of [false,true])test(`cold ${mobile?'mobile':'desktop'} list loads proof automatically without losing form/search or writing`,async()=>{
 const f=fixture({mobile}),{w,h}=f;try{
  const original=JSON.stringify(h.rows());f.mount();
  assert.equal(w.Clientes.financialStatus(f.client).status,'unverified');
  w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();
  const balance=w.document.querySelector(mobile?'.mobile-client-balance':'.client-balance');
  assert.match(balance.textContent,/527,00/);assert.match(balance.textContent,/2\.520,00/);assert.doesNotMatch(balance.textContent,/3\.047,00/);
  assert.equal(f.calls(),1);const input=w.document.querySelector('#preserved-search');input.focus();
  await w.InstallmentCredit.hydrateVisible();await tick();assert.equal(f.calls(),1);assert.equal(w.document.activeElement,input);assert.equal(input.value,'teste');
  assert.equal(JSON.stringify(h.rows()),original);assert.equal(h.commits(),0);
 }finally{h.close();}
});
test('restart, automatic space readiness and reconnect rehydrate instead of trusting persisted or stale totals',async()=>{
 for(let boot=0;boot<2;boot++){const f=fixture(),{w,h}=f;try{
  w.SpaceContext.salesId=()=>null;f.mount();w.document.dispatchEvent(new w.Event('DOMContentLoaded'));w.dispatchEvent(new w.Event('veconi-spaces-ready'));await tick();
  assert.equal(w.Clientes.financialStatus(f.client).debt,527);
  f.setOffline(true);assert.equal(w.Clientes.financialStatus(f.client).status,'unverified');await tick();assert.match(w.document.querySelector('.client-balance').textContent,/a conferir/i);
  f.setOffline(false);await tick();assert.equal(w.Clientes.financialStatus(f.client).debt,527);assert.equal(h.commits(),0);
 }finally{h.close();}}
});
test('failed or contradictory proof stays unverified, with bounded retries and no legacy inference',async()=>{
 const f=fixture({fail:true}),{w,h}=f;try{
  f.mount();w.document.dispatchEvent(new w.Event('DOMContentLoaded'));await tick();await w.InstallmentCredit.hydrateVisible();assert.equal(f.calls(),1);
  assert.match(w.document.querySelector('.client-balance').textContent,/a conferir/i);
  f.setFail(false);f.result.totalCents=304600;f.setOffline(false);await tick();assert.equal(w.Clientes.financialStatus(f.client).status,'unverified');assert.equal(h.commits(),0);
 }finally{h.close();}
});
test('financial synchronization updates the card after partial payment, preserving future installments',async()=>{
 const f=fixture(),{w,h}=f;try{
  f.mount();await w.InstallmentCredit.hydrateVisible();await tick();
  f.client.saldo=-2947;f.client.financialVersion=14;Object.assign(f.result,{financialVersion:14,dueCents:42700,totalCents:294700});
  w.dispatchEvent(new w.CustomEvent('financial-state-updated'));await tick();
  assert.match(w.document.querySelector('.client-balance').textContent,/427,00/);assert.match(w.document.querySelector('.client-balance').textContent,/2\.520,00/);assert.equal(h.commits(),0);
 }finally{h.close();}
});
test('CRM scroll detail, fallback profile, receipts and WhatsApp use the same confirmed due amount',async()=>{
 const f=fixture(),{w,h}=f;try{
  w.document.querySelector('#modal').innerHTML='<div class="crm-profile-scroll"><b data-fiado-balance="qa-client"></b></div>';
  w.InstallmentCredit.mountCustomer(f.client.id);await tick();
  assert.match(w.document.querySelector('[data-fiado-account]').textContent,/527,00/);assert.match(w.document.querySelector('[data-fiado-account]').textContent,/3\.047,00/);assert.match(w.document.querySelector('[data-fiado-balance]').textContent,/527,00/);
  w.document.querySelector('#modal').innerHTML='';w.ClientesPage.profile(f.client.id);await tick();assert.match(w.document.querySelector('.profile-hero').textContent,/527,00/);assert(w.document.querySelector('[data-fiado-account]'));
  const canonical=await w.Mensagens.refreshCanonicalClient(f.client.id);assert.equal(canonical.saldo,-527);assert.match(w.Mensagens.resolve('Sua conta: {{saldo}}',canonical),/527,00/);
  await w.ClientesPage.whatsapp(f.client.id);assert.match(w.document.querySelector('#whatsapp-message').value,/527,00/);assert.doesNotMatch(w.document.querySelector('#whatsapp-message').value,/3\.047,00/);
  await w.Fiados.openReceive(f.client.id);assert.match(w.document.querySelector('[data-receive-amount]').textContent,/527,00/);assert.match(w.document.querySelector('[data-receive-future]').textContent,/2\.520,00/);assert.equal(h.commits(),0);
 }finally{h.close();}
});
test('zero-debt client is not confused with incomplete history or future-only debt',async()=>{
 const f=fixture(),{w,h}=f;try{
  Object.assign(f.client,{saldo:0});Object.assign(f.result,{dueCents:0,futureCents:0,totalCents:0});await w.InstallmentCredit.refresh(f.client.id);assert.equal(w.Clientes.financialStatus(f.client).status,'zero');
  f.client.saldo=-280;Object.assign(f.result,{dueCents:0,futureCents:28000,totalCents:28000});await w.InstallmentCredit.refresh(f.client.id);assert.equal(w.Clientes.financialStatus(f.client).debt,0);assert.equal(w.Clientes.financialStatus(f.client).futureCents,28000);
  delete f.client.fiadoHistoryVersion;delete f.client.hasInstallmentFiado;assert.equal(w.Clientes.financialStatus(f.client).debt,280);assert.equal(h.commits(),0);
 }finally{h.close();}
});
test('late response after company/session change cannot hydrate the new tenant',async()=>{
 const f=fixture(),{w,h}=f;try{
  let complete;w.FirebaseCallable=()=>new Promise(resolve=>{complete=resolve;});
  const pending=w.InstallmentCredit.refresh(f.client.id);h.setContext({businessId:'another-company'});
  complete({data:{businessId:'qa-business',workspaceGeneration:0,account:f.result}});
  await assert.rejects(pending,/sessão|alterad/i);assert.equal(w.InstallmentCredit.confirmedAccount(f.client.id),null);assert.equal(h.commits(),0);
 }finally{h.close();}
});
test('expired display proof is not presented as confirmed and a new read is attempted',async()=>{
 const f=fixture(),{w,h}=f;try{
  await w.InstallmentCredit.refresh(f.client.id);const now=w.Date.now;w.Date.now=()=>now()+61000;
  assert.equal(w.Clientes.financialStatus(f.client).status,'unverified');f.mount();await w.InstallmentCredit.hydrateVisible();assert.equal(w.Clientes.financialStatus(f.client).debt,527);assert.equal(h.commits(),0);
 }finally{h.close();}
});


test('full CRM hero and metric never label future principal as exigible, including a cold open',async()=>{
 const f=fixture(),{w,h}=f;try{
  w.CRMCliente={formatActivity:()=> 'Ativo',build:()=>({client:f.client,metrics:{activity:'active',totalSpent:2800,purchaseCount:1,averageTicket:2800,firstPurchase:'2026-11-09',lastPurchase:'2026-11-09',daysWithoutPurchase:0,largestPurchase:2800,openBalance:0},insights:[],monthly:[],products:[],campaigns:{participations:0,redemptions:0,points:0,available:0,progress:[]},timeline:[]})};
  w.eval(fs.readFileSync('js/crm-ui.js','utf8'));w.ClientesPage.profile(f.client.id);
  assert.match(w.document.querySelector('.crm-hero').textContent,/a conferir/i);assert.doesNotMatch(w.document.querySelector('.crm-hero').textContent,/3\.047,00/);
  await tick();assert.match(w.document.querySelector('.crm-hero').textContent,/527,00/);assert.match(w.document.querySelector('[data-fiado-amount-only]').textContent,/527,00/);
  assert.match(w.document.querySelector('[data-fiado-account]').textContent,/2\.520,00/);assert.equal(h.commits(),0);
 }finally{h.close();}
});


for(const mobile of [false,true])test(`financial summary and filter counts follow hydrated ${mobile?'mobile':'desktop'} cards without replacing controls`,async()=>{
 const f=fixture({mobile}),{w,h}=f;try{
  const app=w.document.querySelector('#app');app.innerHTML=w.ClientesPage.render();app.querySelector('.clients-page').dataset.clientsBound='true';
  const selector=mobile?'.mobile-client-kpis':'.client-kpis',icons=[...app.querySelectorAll(selector+' i')],input=app.querySelector(mobile?'#mobile-client-search':'#client-search');
  await tick();assert.match(app.querySelector(selector).textContent,/527,00/);assert.doesNotMatch(app.querySelector(selector).textContent,/NaN/);
  assert.equal(app.querySelector(mobile?'[data-mobile-filter="debito"] b':'[data-client-chip="debito"] b').textContent,'1');
  assert.equal(app.querySelector(mobile?'#mobile-client-search':'#client-search'),input);for(const icon of icons)assert(icon.isConnected);
  f.client.saldo=-2947;f.client.financialVersion++;Object.assign(f.result,{financialVersion:14,dueCents:42700,totalCents:294700});w.dispatchEvent(new w.CustomEvent('financial-state-updated'));await tick();assert.match(app.querySelector(selector).textContent,/427,00/);assert.equal(h.commits(),0);
 }finally{h.close();}
});


test('an unrelated cloud client update does not cancel the authenticated proof in flight',async()=>{
 const f=fixture(),{w,h}=f;try{
  let complete;w.FirebaseCallable=()=>new Promise(resolve=>{complete=resolve;});
  const pending=w.InstallmentCredit.refresh(f.client.id);w.dispatchEvent(new w.CustomEvent('cloud-data-updated',{detail:{collection:'clients'}}));
  complete({data:{businessId:'qa-business',workspaceGeneration:0,account:f.result}});await pending;assert.equal(w.Clientes.financialStatus(f.client).debt,527);assert.equal(h.commits(),0);
 }finally{h.close();}
});
