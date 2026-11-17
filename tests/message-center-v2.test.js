'use strict';
const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');

test('uma cobrança usa somente o valor confirmado no espaço ativo e seu nome comercial',async()=>{
 const dom=new JSDOM('<!doctype html>',{runScripts:'outside-only'}),w=dom.window;
 const customer={id:'cliente-qa',nome:'Cliente QA',saldo:-527,telefone:'11999990000'};
 const data={config:{nome:'Empresa QA'},clientes:[customer]};
 const statuses=[];
 let space='adi-qa',mode='space';
 w.DB={carregar:()=>data,getBusinessId:()=>'empresa-qa'};
 w.Utils={dinheiro:value=>'R$ '+Number(value).toFixed(2).replace('.',',')};
 w.SpaceContext={homeId:()=>space,viewScope:()=>space,scopesCustomers:()=>true};
 w.Clientes={obter:()=>customer};
 w.SyncFirebase={isReady:()=>true,readCanonicalClient:async()=>({client:customer})};
 w.SpaceBranding={resolve:({spaceId})=>({name:spaceId==='adi-qa'?'Loja Centro QA':'Loja Sul QA'})};
 w.MessageCenterV2={canUse:()=>true};
 w.Fiados={readCardReceiptRoute:async()=>({mode,scopedReceiptVersion:1,dueCents:space==='adi-qa'?24700:28000})};
 w.console={info:()=>{},error:()=>{}};
 try{
  w.eval(fs.readFileSync('js/mensagens.js','utf8'));
  for(const target of ['adi-qa','cartao-qa']){
   space=target;
   const row=await w.Mensagens.refreshCanonicalClient(customer.id);
   statuses.push(w.Mensagens.resolve('Olá, {{nome}}. {{nome_negocio}} · {{saldo}}',row));
  }
  assert.deepEqual(statuses,['Olá, Cliente QA. Loja Centro QA · R$ 247,00','Olá, Cliente QA. Loja Sul QA · R$ 280,00']);
  mode='original';
  await assert.rejects(w.Mensagens.refreshCanonicalClient(customer.id),{code:'fiado-space-unverified'});
  mode='space';
  w.Fiados.readCardReceiptRoute=async()=>{
   space='outro-qa';
   return {mode,scopedReceiptVersion:1,dueCents:28000};
  };
  await assert.rejects(w.Mensagens.refreshCanonicalClient(customer.id),{code:'fiado-space-unverified'});
  assert.equal(customer.saldo,-527);
 }finally{w.close();}
});
