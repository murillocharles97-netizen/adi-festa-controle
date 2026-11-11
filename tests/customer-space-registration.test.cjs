'use strict';

const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('jsdom');

function screen(spaces=['iptv','festa']){
 const dom=new JSDOM('<main id="app"></main><div id="modal"></div>',{runScripts:'outside-only',url:'http://localhost'});
 const w=dom.window,requests=[],toasts=[];
 let result={status:'created',clientId:'qa-client'},confirm=true,scope='one',canView=true;
 Object.assign(w,{
  Utils:{escapar:String,dinheiro:String,uuid:()=> 'qa-request',toast:message=>toasts.push(message)},
  Clientes:{assertCanCreate(){},assertCanSave(){},canCreate:()=>true,canEdit:()=>false,obter:id=>id==='qa-existing'?{nome:'Cliente existente QA'}:null,normalizePhone:value=>String(value||'').replace(/\D/g,'')},
  TeamAccess:{has:permission=>permission==='customers.view'&&canView},
  SpaceContext:{activeId:()=>spaces[0],customerSpaces:()=>spaces.map(id=>({id,name:id==='iptv'?'IPTV':'Adi Festa'})),viewScope:()=>scope},
  DB:{flush:async()=>{}},Router:{atual:()=> 'clientes'},matchMedia:()=>({matches:true,addEventListener(){}}),
  Modais:{fechar:()=>{w.document.querySelector('#modal').innerHTML='';}},
  SyncFirebase:{saveCustomerDirectory:async request=>{requests.push(JSON.parse(JSON.stringify(request)));return result;}},
  confirm:()=>confirm,
 });
 for(const file of ['js/clientes-page.js','js/clientes-mobile.js'])w.eval(fs.readFileSync(file,'utf8'));
 w.ClientesPage.clientForm();
 const form=w.document.querySelector('#modal form');
 form.elements.nome.value='Cliente de QA';
 return{dom,w,form,requests,toasts,respond:value=>{result=value;},confirm:value=>{confirm=value;},changeScope:()=>{scope='two';},denyView:()=>{canView=false;}};
}

test('mobile registration has one address and complement and preselects the active space',async()=>{
 const h=screen();
 try{
  assert.equal(h.form.querySelectorAll('[name="endereco"]').length,1);
  assert.equal(h.form.querySelectorAll('[name="complemento"]').length,1);
  assert.equal(h.form.querySelectorAll('[name="apelido"]').length,1);
  assert.match(h.form.textContent,/Espaços.*IPTV \(atual\)/s);
  h.form.querySelector('.customer-space-option:has([value="festa"]) span').click();
  await h.form.onsubmit({target:h.form,preventDefault(){}});
  assert.deepEqual(h.requests[0].spaceIds,['iptv','festa']);
  assert.equal(h.requests[0].activeSpaceId,'iptv');
  assert.equal(h.form.isConnected,false);
 }finally{h.dom.window.close();}
});

test('single-space registration binds the only space without rendering controls',async()=>{
 const h=screen(['festa']);
 try{
  assert.equal(h.form.querySelector('fieldset'),null);
  await h.form.onsubmit({target:h.form,preventDefault(){}});
  assert.deepEqual(h.requests[0].spaceIds,['festa']);
 }finally{h.dom.window.close();}
});

test('duplicate flow keeps the form and requires confirmation before linking the same ID',async()=>{
 const h=screen();
 try{
  h.form.elements.telefone.value='11987654321';
  h.respond({status:'duplicate',canLink:true,clientId:'qa-existing'});
  await h.form.onsubmit({target:h.form,preventDefault(){}});
  assert.equal(h.form.isConnected,true);
  const action=h.form.querySelector('[data-customer-duplicate] button');
  assert.equal(action.textContent,'Vincular ao espaço atual');
  assert.match(h.form.querySelector('[data-customer-duplicate]').textContent,/Cliente existente QA/);
  h.confirm(false);
  await action.onclick();
  assert.equal(h.requests.length,1);
  h.confirm(true);
  h.respond({status:'linked',clientId:'qa-existing'});
  await action.onclick();
  assert.deepEqual(h.requests[1],{action:'link',activeSpaceId:'iptv',customerId:'qa-existing',phone:'11987654321',confirmed:true});
  assert.equal(h.form.isConnected,false);
 }finally{h.dom.window.close();}
});

test('a retired space or private duplicate cannot send a link',async()=>{
 const h=screen();
 try{
  h.respond({status:'duplicate-private',clientId:'qa-existing'});
  await h.form.onsubmit({target:h.form,preventDefault(){}});
  assert.equal(h.form.querySelector('[data-customer-duplicate] button'),null);
  assert.doesNotMatch(h.form.querySelector('[data-customer-duplicate]').textContent,/Cliente existente QA/);
  h.changeScope();
  await h.form.onsubmit({target:h.form,preventDefault(){}});
  assert.equal(h.requests.length,1);
  assert.match(h.toasts.at(-1),/espaço ou a sessão mudou/);
 }finally{h.dom.window.close();}
});

test('duplicate notice omits the customer name without view permission',async()=>{
 const h=screen();
 try{
  h.denyView();
  h.respond({status:'already-linked',clientId:'qa-existing'});
  await h.form.onsubmit({target:h.form,preventDefault(){}});
  assert.doesNotMatch(h.form.querySelector('[data-customer-duplicate]').textContent,/Cliente existente QA/);
 }finally{h.dom.window.close();}
});
