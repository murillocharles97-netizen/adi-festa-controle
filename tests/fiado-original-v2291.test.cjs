'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {harness}=require('./helpers/owner-receipt-v219.cjs');
const sleep=()=>new Promise(resolve=>setTimeout(resolve,25));
function fixture({scheduled=false,mixed=false}={}) {
 const h=harness(),{w}=h,db=h.rows(),client=db.clientes[0];
 w.Router={atual:()=> 'clientes'};w.Modais={fechar:()=>{w.document.querySelector('#modal').innerHTML='';}};
 w.Utils.escapar=String;
 const ids=['adi','iptv','cartao'];
 w.BusinessContext.canAccessSpace=id=>ids.includes(id)&&(h.context().spaceAccess==='all'||h.context().allowedSpaceIds.includes(id));
 for(const file of ['js/spaces.js','js/clientes.js'])w.eval(fs.readFileSync(file,'utf8'));
 w.SpaceContext.setSpaces(ids.map(id=>({id,businessId:'qa-business',name:id,type:'business',active:true})));
 w.SpaceContext.selectActive('iptv');
 Object.assign(client,{saldo:scheduled?-3047:-81,financialVersion:scheduled?13:3,legacyBalance:scheduled?247:81,legacyBalanceRemaining:scheduled?247:81,hasInstallmentFiado:scheduled,fiadoHistoryVersion:scheduled?1:undefined});
 const day=w.InstallmentPlan.today(),next=w.InstallmentPlan.month(day,1);
 db.vendas=[];
 if(scheduled) db.vendas.push({id:'plan',clienteId:client.id,businessId:'qa-business',spaceId:'cartao',formaPagamento:'fiado',status:'fiado',valorFinal:2800,creditOriginalAmount:2800,creditPaidAmount:0,creditRemainingAmount:2800,installmentPlan:w.InstallmentPlan.create({total:2800,count:10,downPayment:0,firstDueDate:day,saleDate:day})});
 const entries=scheduled?[{spaceId:mixed?'adi':null,saleId:null,dueDate:day,remainingCents:24700},
   {spaceId:'cartao',saleId:'plan',number:1,dueDate:day,remainingCents:28000},
   {spaceId:'cartao',saleId:'plan',number:2,dueDate:next,remainingCents:252000}]:[{spaceId:null,saleId:null,dueDate:day,remainingCents:8100}];
 let proofError;
 w.FirebaseCallable=async()=>{if(proofError)throw proofError;return{data:{businessId:'qa-business',workspaceGeneration:0,account:{clientId:client.id,version:scheduled?2:1,historyProofVersion:1,asOf:day,financialVersion:client.financialVersion,dueCents:scheduled?52700:8100,futureCents:scheduled?252000:0,totalCents:scheduled?304700:8100,creditCents:0,entries}}};};
 async function consult() {
  w.Fiados.openOriginalDirectory();const form=w.document.querySelector('#modal form');assert.ok(form);
  form.elements.clientId.value=client.id;form.dispatchEvent(new w.Event('submit',{cancelable:true}));await sleep();
  return w.document.querySelector('#modal form');
 }
 return {h,w,db,client,entries,consult,failProof:e=>proofError=e,scope:()=>w.SpaceContext.viewScope(),close:()=>h.close()};
}

test('owner can consult original legacy account from IPTV, then explicitly record in Adi Festa',async()=>{
 const f=fixture();try{
  assert.equal(f.w.Clientes.viewClient(f.client.id),undefined);assert.match(f.w.Clientes.originalAccountAction(),/Consultar conta original/);
  const form=await f.consult();assert.match(f.w.document.querySelector('#modal h2').textContent,/Conta original/);
  assert.equal(form.elements.paymentSpaceId.value,'');assert.match(form.textContent,/origem de espaço a conferir/);
  form.elements.paymentSpaceId.value='adi';form.elements.valor.value='31';form.elements.valor.dispatchEvent(new f.w.Event('input'));
  form.dispatchEvent(new f.w.Event('submit',{cancelable:true}));await sleep();
  const saved=f.h.rows();assert.equal(f.h.commits(),1);assert.equal(saved.clientes[0].saldo,-50);assert.equal(saved.pagamentos[0].spaceId,'adi');
  assert.equal(saved.pagamentos[0].legacyAmount,31);assert.equal(f.w.SpaceContext.activeId(),'iptv');
  assert.deepEqual(saved.vendas,[]);assert.deepEqual(saved.alocacoesPagamento,[]);
 }finally{f.close();}
});

test('traditional V228 total remains possible when proof history is incomplete, with unchanged operation ID on retry',async()=>{
 const f=fixture();try{
  f.failProof(Object.assign(Error('Histórico incompleto'),{code:'functions/failed-precondition'}));
  const attempt=f.w.Fiados.receiptAttempt(f.client.id,{originalScope:f.scope()}), options={spaceId:'adi',paymentMethod:'pix',paymentMode:'total'};
  await assert.rejects(attempt.confirm(81,'',{...options,spaceId:''}),/explicitamente/);
  const a=await attempt.confirm(81,'',options), b=await attempt.confirm(81,'',options);
  assert.equal(a.operationId,b.operationId);assert.equal(f.h.commits(),1);assert.equal(f.h.rows().clientes[0].saldo,0);
 }finally{f.close();}
});

test('original installments show due and future separately and preserve their recorded origin',async()=>{
 const f=fixture({scheduled:true});try{
  const form=await f.consult();assert.equal(form.elements.paymentSpaceId.value,'');assert.match(form.textContent,/527,00/);
  assert.match(form.querySelector('[data-receive-future]').textContent,/2\.520,00/);assert.match(form.textContent,/Origens registradas: cartao/);
  assert.equal(f.h.commits(),0);assert.equal(f.db.vendas[0].spaceId,'cartao');
 }finally{f.close();}
});

test('confirmed mixed debt can be consulted but cannot enter the old single-cash receiver',async()=>{
 const f=fixture({scheduled:true,mixed:true});try{
  const form=await f.consult();assert.match(form.textContent,/mais de um espaço/);assert.equal(form.querySelector('[data-receive-confirm]').disabled,true);
  const attempt=f.w.Fiados.receiptAttempt(f.client.id,{originalScope:f.scope()});
  await assert.rejects(attempt.confirm(10,'',{spaceId:'adi',paymentMethod:'pix'}),/mais de um espaço/);assert.equal(f.h.commits(),0);
 }finally{f.close();}
});

test('scoped staff, changed owner context and stale preview cannot invoke a legacy receipt',async()=>{
 const f=fixture();try{
  const original=f.h.context(), scope=f.scope(), attempt=f.w.Fiados.receiptAttempt(f.client.id,{originalScope:scope});
  f.client.financialVersion++;
  await assert.rejects(attempt.confirm(10,'',{spaceId:'adi',paymentMethod:'pix'}),/saldo mudou/);
  f.h.setContext({role:'seller',spaceAccess:'selected',allowedSpaceIds:['iptv'],member:{...original.member,role:'seller'}});
  assert.equal(f.w.Fiados.canOpenOriginal(),false);assert.equal(f.w.Clientes.originalAccountAction(),'');
  f.w.Fiados.openOriginalDirectory();assert.equal(f.w.document.querySelector('#modal form'),null);
  assert.equal(f.h.commits(),0);
 }finally{f.close();}
});

test('closed Adi Festa shows the opening account and keeps scoped WhatsApp charging without legacy options',async()=>{
 const f=fixture({scheduled:true});
 try{
  const {w,db,client,h}=f;
  const space='business_adi-festa',openingHash='opening',day=w.InstallmentPlan.today();
  const initial=h.context();
  const profile={...initial.userProfile,businessId:'adi-festa'};
  Object.assign(w.FirebaseSession,{businessId:'adi-festa',profile});
  h.setContext({businessId:'adi-festa',userProfile:profile,business:{...initial.business,id:'adi-festa',
   fiadoLegacyClosed:{version:1,state:'complete'}}});
  Object.assign(client,{businessId:'adi-festa',saldo:-150,fiadoOpeningBalance:{version:1,hash:openingHash},
   customerSpaceIds:[space],hasInstallmentFiado:false});
  db.config={nome:'Negócio de teste'};
  client.telefone='11912345678';
  Object.assign(db.vendas[0],{businessId:'adi-festa'});
  w.SpaceContext={
   activeId:()=>space,
   homeSpaces:()=>[{id:space}],
   scopesCustomers:()=>true,
   viewScope:()=>space,
   contextualData:()=>db
  };
  assert.equal(w.Clientes.originalAccountAction(),'');
  w.Fiados.openOriginalDirectory();
  assert.equal(w.document.querySelector('#modal form'),null);
  assert.equal(w.Clientes.listFinancialStatus(client).debt,150);
  assert.equal(w.Clientes.listFinancialStatus(client).futureCents,0);
  w.SyncFirebase.isReady=()=>true;
  w.SyncFirebase.readCanonicalClient=async()=>({client});
  w.FirebaseCallable=async(name,data)=>{
   assert.equal(name,'getOperationalSyncReceipt');
   assert.equal(data.kind,'fiado_account');
   return {data:{businessId:'adi-festa',workspaceGeneration:0,account:{
    clientId:client.id,version:2,historyProofVersion:1,asOf:day,financialVersion:client.financialVersion,
    dueCents:15000,futureCents:0,totalCents:15000,creditCents:0,
    entries:[{spaceId:space,dueDate:day,remainingCents:15000}]
   }}};
  };
  w.Utils.telefoneWhatsApp=phone=>'55'+phone;
  w.Utils.dinheiro=value=>value.toLocaleString('pt-BR',{style:'currency',currency:'BRL'});
  w.eval(fs.readFileSync('js/mensagens.js','utf8'));
  const canonical=await w.Mensagens.refreshCanonicalClient(client.id);
  const message=w.Mensagens.resolve('Saldo: {{saldo}}',canonical);
  const link=new URL(w.Mensagens.whatsappUrl(canonical,message));
  assert.equal(link.pathname,'/5511912345678');
  assert.match(link.searchParams.get('text'),/150,00/);
  assert.equal(h.commits(),0);
 }finally{f.close();}
});
