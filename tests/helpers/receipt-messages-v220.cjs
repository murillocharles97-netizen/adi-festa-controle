'use strict';
const {JSDOM}=require('jsdom'),fs=require('node:fs'),crypto=require('node:crypto');
function harness({role='owner',grants=['customers.view','customers.receiveDebt'],phone='11999990000',confirmed=false,balance=-164}={}){
  const dom=new JSDOM('<!doctype html><html lang="pt-BR"><body><h1 id="title"></h1><p id="date"></p><div id="app"></div><div id="modal"></div></body></html>',{url:'https://qa.example.invalid',runScripts:'outside-only'}),w=dom.window;
  let businessId='qa-receipts',uid='qa-owner',generation=0,sid='qa-space',ready=true,calls=0,online=true,responder=null;
  const rows={config:{nome:'Empresa fictícia'},clientes:[{id:'qa-client',nome:'Ana Exemplo',telefone:phone,saldo:balance}],pagamentos:[{id:'qa-payment',operationId:'qa-operation',clienteId:'qa-client',valor:50,status:'pending_sync',saldoNovo:-999,data:'2026-10-30T12:00:00Z'}],vendas:[],movimentacoes:[],messageTemplates:[],messageHistory:[]};
  const source={confirmed:true,status:'confirmed',businessId,workspaceGeneration:0,clientId:'qa-client',paymentId:'qa-payment',operationId:'qa-operation',spaceId:sid,amount:50,balance,financialVersion:17,checkedAt:'2026-10-30T18:00:00Z',paymentDate:'2026-10-30T12:00:00Z',paymentMethod:'pix',clientName:'Ana Exemplo',phone,businessName:'Empresa fictícia',templates:[]};
  const effects={writes:[],opens:[],shares:[],copies:[],downloads:[],commercial:0,flushes:0,canvasText:[]};
  const policy=permission=>Object.assign(Error('Você não tem permissão para realizar esta ação.'),{code:'permission-denied',permission});
  const has=p=>ready&&(role==='owner'||grants.includes(p));
  w.FirebaseSession={user:{uid},businessId};
  w.BusinessContext={get:()=>({businessId,role,loading:!ready,access:{canMutate:true,readOnly:false}})};
  w.SpaceContext={homeId:()=>sid};
  const scope=()=>JSON.stringify([businessId,uid,generation,sid,role,ready,grants]);
  w.TeamAccess={has,failure:policy,assert:p=>{if(!has(p))throw policy(p);},captureSession:scope,assertSession:t=>{if(t!==scope())throw Error('Sessão alterada');},operationalReadScopeKey:scope};
  w.DB={carregar:()=>rows,getBusinessId:()=>businessId,getWorkspaceGeneration:()=>generation,alterar:fn=>{fn(rows);effects.writes.push(structuredClone(rows));},flush:async()=>{effects.flushes++;}};
  w.Clientes={obter:id=>rows.clientes.find(x=>x.id===id)};
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  w.Utils={uuid:()=>crypto.randomUUID(),escapar:escape,dinheiro:n=>Number(n).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),toast:()=>{}};
  w.Modais={layout:()=>{},fechar:()=>w.document.querySelector('#modal').replaceChildren()};
  w.lucide={createIcons:()=>{}};w.matchMedia=()=>({matches:false,addEventListener:()=>{}});w.scrollTo=()=>{};
  Object.defineProperty(w.navigator,'onLine',{get:()=>online});
  w.navigator.clipboard={writeText:async text=>effects.copies.push(text)};w.navigator.share=async data=>effects.shares.push(data);
  w.open=(url,...args)=>{effects.opens.push({url,args});return {};};
  w.HTMLCanvasElement.prototype.getContext=()=>({fillStyle:'',font:'',textAlign:'',fillRect(){},fillText(text){effects.canvasText.push(text);}});
  w.HTMLCanvasElement.prototype.toDataURL=()=> 'data:image/png;base64,QA';
  w.HTMLAnchorElement.prototype.click=function(){effects.downloads.push({name:this.download,url:this.href});};
  w.FirebaseCallable=async(name,data)=>{calls++;if(name!=='getOperationalSyncReceipt'||data.kind!=='payment_confirmation')throw Error('Unexpected commercial call');return{data:responder?await responder(data):confirmed?structuredClone(source):{confirmed:false,status:'awaiting_confirmation'}};};
  function load(file){w.eval(fs.readFileSync(file,'utf8'));}
  load('js/phone.js');load('js/receipt-messages.js');load('js/receipt-message-ui.js');
  const originalTimeout=w.setTimeout.bind(w);w.setTimeout=(fn,ms,...args)=>originalTimeout(fn,w.ReceiptMessages.RETRY_DELAYS.includes(ms)?0:ms,...args);
  const tick=async()=>{for(let i=0;i<12;i++)await new Promise(resolve=>setImmediate(resolve));await new Promise(resolve=>setTimeout(resolve,10));},control=s=>{const node=w.document.querySelector(s);if(!node)throw Error('Missing '+s);return node;};
  const click=async s=>{control(s).click();await tick();};
  return{w,rows,source,effects,load,tick,control,click,calls:()=>calls,scope,
    open:async()=>{w.ReceiptMessageUI.open(rows.pagamentos[0],rows.clientes[0]);await tick();for(let i=0;i<20&&w.document.querySelector('[data-receipt-check]')?.disabled;i++)await new Promise(r=>setTimeout(r,5));},
    responder:fn=>responder=fn,confirmed:value=>confirmed=value,online:value=>online=value,ready:value=>ready=value,
    switchCompany:value=>{businessId=value;w.FirebaseSession.businessId=value;},switchUser:value=>{uid=value;w.FirebaseSession.user.uid=value;},switchSpace:value=>sid=value,
    role:value=>role=value,grants:value=>grants=value,close:()=>dom.window.close(),html:()=>w.document.querySelector('#modal').textContent,
  };
}
module.exports={harness};
