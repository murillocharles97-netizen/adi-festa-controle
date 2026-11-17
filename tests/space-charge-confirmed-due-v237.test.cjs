'use strict';
// V237: in a space-scoped Clientes page (e.g. "Emprestar cartão"), the desktop WhatsApp button
// must reuse the due amount the server just confirmed (fiado_receipt_route), not re-derive it
// from a local cache that the route path never fills. Fictitious data only.
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {harness}=require('./helpers/owner-receipt-v219.cjs');
function fixture({route}={}){
  const h=harness(),w=h.w,toasts=[],client=h.rows().clientes[0];
  w.InstallmentPlan={...w.InstallmentPlan,today:()=> '2026-11-17'};
  Object.assign(client,{saldo:-2800,financialVersion:3,fiadoHistoryVersion:1,hasInstallmentFiado:true,telefone:'11999999999'});
  h.rows().vendas=[];h.rows().movimentacoes=[];h.rows().cobrancas=[];
  w.Utils={...w.Utils,escapar:s=>String(s??''),dinheiro:n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),
    somenteNumeros:s=>String(s).replace(/\D/g,''),telefoneWhatsApp:s=>'55'+s,toast:(m,e)=>toasts.push({m,e})};
  w.PhoneUtils={normalizeBrazilianPhone:s=>'55'+s};w.matchMedia=()=>({matches:false,addEventListener(){}});
  w.Cobrancas={ultimaCliente:()=>null,historicoCliente:()=>[]};w.Router={atual:()=> 'clientes'};
  w.CustomerSubscriptions={view:{forClient:()=>[],hasUnassigned:()=>false,loadForClient:async()=>[]},effectiveStatus:()=> 'active'};
  w.Modais={fechar:()=>{w.document.querySelector('#modal').innerHTML='';}};w.DB.readForView=w.DB.carregar;w.SyncFirebase.isReady=()=>true;w.SyncFirebase.readCanonicalClient=async()=>({client:structuredClone(client)});
  let accountCalls=0;w.FirebaseCallable=async()=>{accountCalls++;throw Error('fiado_account não deve ser necessário no fluxo do espaço');};
  for(const file of ['js/clientes.js','js/client-filter-rules.js','js/mensagens.js','js/clientes-page.js'])w.eval(fs.readFileSync(file,'utf8'));
  const space=w.SpaceContext.salesId();
  Object.assign(w.SpaceContext,{scopesCustomers:()=>true,viewScope:()=> 'space:'+space,activeId:()=>space,homeId:()=>space});
  w.Clientes.viewData=()=>({clientes:[client]});
  w.MessageCenterV2={canUse:()=>true,activeSpace:()=>space};
  w.Fiados={...(w.Fiados||{}),readCardReceiptRoute:async()=>{if(route instanceof Error)throw route;return route;}};
  return {h,w,client,toasts,accountCalls:()=>accountCalls};
}
const confirmed={mode:'space',scopedReceiptVersion:1,dueCents:28000,futureCents:252000};
test('space WhatsApp opens with the server-confirmed due amount only (R$ 280,00, never the R$ 2.520,00 future)',async()=>{
  const f=fixture({route:confirmed}),{w,h}=f;try{
    const before=JSON.stringify(h.rows());
    await w.ClientesPage.whatsapp(f.client.id);
    assert.deepEqual(f.toasts.filter(t=>t.e),[],'no blocking toast');
    const text=w.document.querySelector('#whatsapp-message')?.value||'';
    assert.match(text,/280,00/);assert.doesNotMatch(text,/2\.520,00|2\.800,00/);
    assert.equal(f.accountCalls(),0);assert.equal(JSON.stringify(h.rows()),before,'opening the composer writes nothing');assert.equal(h.commits(),0);
  }finally{h.close();}
});
test('unconfirmed space balance still blocks, with the specific reason',async()=>{
  const f=fixture({route:Object.assign(Error('Conecte-se e aguarde a fila local carregar para conferir o recebimento.'),{})}),{w,h}=f;try{
    await w.ClientesPage.whatsapp(f.client.id);
    assert.equal(w.document.querySelector('#whatsapp-message'),null);
    assert.match(f.toasts.at(-1).m,/fila local carregar/);assert.equal(h.commits(),0);
  }finally{h.close();}
});
test('pending customer write keeps blocking with the actionable sync message',async()=>{
  const f=fixture({route:confirmed}),{w,h}=f;try{
    w.SyncFirebase.readCanonicalClient=async()=>{throw Object.assign(Error('x'),{code:'pending-client-write'});};
    await w.ClientesPage.whatsapp(f.client.id);
    assert.equal(w.document.querySelector('#whatsapp-message'),null);
    assert.match(f.toasts.at(-1).m,/aguardando sincronização/);assert.equal(h.commits(),0);
  }finally{h.close();}
});
test('a route that is not space-scoped never opens a charge',async()=>{
  const f=fixture({route:{...confirmed,mode:'original'}}),{w,h}=f;try{
    await w.ClientesPage.whatsapp(f.client.id);
    assert.equal(w.document.querySelector('#whatsapp-message'),null);assert.match(f.toasts.at(-1).m,/origem do saldo/);
  }finally{h.close();}
});
