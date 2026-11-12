'use strict';
const fs=require('node:fs'),vm=require('node:vm'),test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
function harness({store=new Map(),canCancel=true,confirm,preview,storageFails=false,queue={pending:0,syncErrors:0},queueGuard}={}){
 const fields={reason:{value:'Cancelamento fictício QA'},confirmed:{checked:true},refundHandling:{value:'external_refund_confirmed',required:true}},nodes={},calls=[],events=[];
 const created=[],button={disabled:false,textContent:''},form={hidden:true,elements:fields,setAttribute(){},querySelectorAll:()=>[button]},close={focus(){}};
 const modal={innerHTML:'',dataset:{},querySelector:s=>s==='[data-cancel-form]'?form:s==='[data-cancel-confirm]'?button:s==='[data-cancel-close]'?close:(nodes[s]??={textContent:'',hidden:false,after:e=>created.push(e)}),querySelectorAll:()=>[close]};
 const session={user:{uid:'qa-seller'}},sale={id:'qa-sale',businessId:'qa-business',spaceId:'qa-space',clienteNome:'Cliente fictício QA',data:'2026-01-01T12:00:00Z',formaPagamento:'pix'};
 const c={console,crypto,Date,JSON,Map,Set,navigator:{onLine:true},document:{querySelector:()=>modal,createElement:()=>({remove(){}})},CustomEvent:function(name,o){this.type=name;this.detail=o?.detail;},dispatchEvent:e=>events.push(e),FirebaseSession:session,
  DB:{carregar:()=>({vendas:[sale]}),getBusinessId:()=>sale.businessId,getWorkspaceGeneration:()=>0,flush:async()=>{},alterar:()=>{throw Error('Commercial capture forbidden');}},
  TeamAccess:{has:()=>canCancel,operationalReadScopeKey:()=>session.user.uid},SpaceContext:{homeId:()=>sale.spaceId},
  SyncFirebase:{getFirebaseDiagnostic:()=>queue,assertCancellationQueueClear:queueGuard,pullCloudCollections:async opts=>{calls.push({pull:opts});}},
  localStorage:{getItem:k=>store.get(k)??null,setItem:(k,v)=>{if(storageFails)throw Error('Storage unavailable');store.set(k,v);}},
  FirebaseCallable:async(name,data)=>{calls.push({name,data});if(name==='previewSaleCancellation')return preview?preview(data):{saleId:sale.id,spaceId:sale.spaceId,operationId:'qa-cancel-operation',fingerprint:'qa-fingerprint',isCredit:false,amountCents:2000};return confirm?confirm(data):{saleId:sale.id,operationId:data.operationId,status:'cancelado',financialProjection:'not_required_or_recorded'};},
 };c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('js/sale-cancellation.js','utf8'),c);
 return{c,store,calls,events,modal,nodes,form,button,session,fields,created,open:()=>c.SaleCancellation.open(sale.id),submit:()=>form.onsubmit({preventDefault(){}})};
}
test('old Pix sale has explicit refund/motive UI; no old snapshot or queue mutation',async()=>{const h=harness();await h.open();assert.equal(h.form.hidden,false);assert.match(h.modal.innerHTML,/Não há reembolso automático/);await h.submit();assert.equal(h.calls.filter(c=>c.name==='confirmSaleCancellation').length,1);assert.equal(h.calls.filter(c=>c.pull).length,1);assert.equal(JSON.parse([...h.store.values()][0]).status,'resolved');});
test('double click emits one confirmation',async()=>{let resolve;const h=harness({confirm:()=>new Promise(r=>{resolve=r;})});await h.open();const first=h.submit();await h.submit();assert.equal(h.calls.filter(c=>c.name==='confirmSaleCancellation').length,1);resolve({saleId:'qa-sale',operationId:'qa-cancel-operation',status:'cancelado'});await first;});
test('reload preserves the SAME explicit request and does not auto replay',async()=>{const store=new Map(),first=harness({store,confirm:async()=>{throw Error('Network response lost');}});await first.open();await first.submit();const before=JSON.parse([...store.values()][0]),second=harness({store});await second.open();assert.equal(second.calls.length,0);assert.equal(second.button.textContent,'Retomar mesma confirmação');await second.submit();const sent=second.calls.find(c=>c.name==='confirmSaleCancellation');assert.equal(sent.data.operationId,before.request.operationId);assert.equal(sent.data.fingerprint,before.request.fingerprint);});
test('resolved receipt after reload never retries a cancelled sale',async()=>{const h=harness();await h.open();await h.submit();const second=harness({store:h.store});await second.open();assert.equal(second.calls.length,0);assert.match(second.nodes['[data-cancel-summary]'].textContent,/já foi cancelada/);});
test('seller without cancellation permission has no call or local write',async()=>{const h=harness({canCancel:false});await assert.rejects(h.open(),/permissão/);assert.equal(h.calls.length,0);assert.equal(h.store.size,0);});
test('missing reason/refund confirmation blocks before sending',async()=>{const h=harness();await h.open();h.fields.refundHandling.value='';await h.submit();assert.equal(h.calls.filter(c=>c.name==='confirmSaleCancellation').length,0);h.fields.refundHandling.value='not_due';h.fields.reason.value='';await h.submit();assert.equal(h.calls.filter(c=>c.name==='confirmSaleCancellation').length,0);});
test('unavailable durable local storage cannot be bypassed by clicking again',async()=>{const h=harness({storageFails:true});await h.open();await h.submit();await h.submit();assert.equal(h.calls.filter(c=>c.name==='confirmSaleCancellation').length,0);});
test('switch seller → owner invalidates an old preview callback',async()=>{let resolve;const h=harness({preview:()=>new Promise(r=>{resolve=r;})}),opened=h.open();h.session.user.uid='qa-owner';resolve({saleId:'qa-sale',spaceId:'qa-space',operationId:'qa-op',fingerprint:'qa-fp',amountCents:2000});await opened;assert.equal(h.form.hidden,true);assert.equal(h.store.size,0);});
for(const [queue,message] of [
 [{pending:2},/Pendências enviáveis: 2/],
 [{syncErrors:1},/Erros ativos: 1/],
 [{syncErrors:1,queueStorageCorrupt:true},/Não foi possível ler a fila local/],
 [{processingOperations:1},/Em processamento: 1/],
 [{preparingOperations:1},/Aguardando gravação local: 1/],
 [null,/Não foi possível ler a fila local/],
])test(`queue condition allows only the read-only preview: ${message}`,async()=>{
 const h=harness({queue});
 await h.open();
 assert.equal(h.form.hidden,false);
 assert.match(h.nodes['[data-cancel-error]'].textContent,message);
 await h.submit();
 assert.deepEqual(h.calls.map(call=>call.name),['previewSaleCancellation']);
 assert.equal(h.store.size,0);
});
test('queue is checked again after preview; confirmation works after it clears',async()=>{
 const queue={pending:0,syncErrors:0},h=harness({queue});
 await h.open();
 queue.processingOperations=1;
 await h.submit();
 assert.equal(h.calls.length,1);
 assert.equal(h.store.size,0);
 queue.processingOperations=0;
 await h.submit();
 assert.equal(h.calls.filter(c=>c.name==='confirmSaleCancellation').length,1);
 assert.equal(h.nodes['[data-cancel-error]'].textContent,'');
});
test('queue blocks resumption without changing the preserved confirmation',async()=>{
 const first=harness({confirm:async()=>{throw Error('Response lost');}});
 await first.open();
 await first.submit();
 const before=[...first.store],second=harness({store:first.store,queue:{syncErrors:1}});
 await second.open();
 await second.submit();
 assert.deepEqual(second.calls,[]);
 assert.deepEqual([...second.store],before);
 assert.match(second.nodes['[data-cancel-error]'].textContent,/Erros ativos: 1/);
});
test('the scoped queue guard uses the same server preview for confirmation and lost-response retry',async()=>{
 const checks=[],queueGuard=async quote=>{checks.push(quote);if(!quote)throw Error('A venda precisa ser consultada.');};
 const first=harness({queue:{syncErrors:4},queueGuard,confirm:async()=>{throw Error('Response lost');}});
 await first.open();
 await first.submit();
 const second=harness({store:first.store,queue:{syncErrors:4},queueGuard});
 await second.open();
 await second.submit();
 const sent=second.calls.filter(c=>c.name);
 assert.deepEqual(sent.map(c=>c.name),['confirmSaleCancellation']);
 assert.equal(sent[0].data.operationId,'qa-cancel-operation');
 assert.equal(checks.length,4);
 assert.equal(checks[2],null);
 assert.equal(checks[3].fingerprint,'qa-fingerprint');
});
test('a second tab adopts an already preserved request instead of overwriting its reason/ID',async()=>{const store=new Map(),a=harness({store,confirm:async()=>{throw Error('Response lost');}}),b=harness({store});await a.open();await b.open();await a.submit();const original=[...store.values()][0];b.fields.reason.value='Outro motivo que não deve substituir o primeiro';await b.submit();const sent=b.calls.find(c=>c.name==='confirmSaleCancellation');assert.equal(sent.data.reason,JSON.parse(original).request.reason);assert.equal(sent.data.operationId,JSON.parse(original).request.operationId);});
test('a rejected stale quote can be reviewed again, preserving the old request as evidence',async()=>{let attempt=0,reads=0;const h=harness({preview:async()=>({saleId:'qa-sale',spaceId:'qa-space',operationId:'qa-cancel-operation',fingerprint:'fp-'+(++reads),isCredit:false,amountCents:2000}),confirm:async data=>{if(!attempt++)throw Object.assign(Error('Estoque mudou'),{details:{reason:'cancellation-state-changed'}});return{saleId:'qa-sale',operationId:data.operationId,status:'cancelado'};}});await h.open();await h.submit();assert.equal(h.created.length,1);assert.ok([...h.store.keys()].some(k=>k.includes(':preserved:')));await h.created[0].onclick();await h.submit();const calls=h.calls.filter(c=>c.name==='confirmSaleCancellation');assert.equal(calls[0].data.fingerprint,'fp-1');assert.equal(calls[1].data.fingerprint,'fp-2');assert.equal(calls[0].data.operationId,calls[1].data.operationId);});
test('History separates fast undo from permissioned cancellation, without changing the 5-minute shortcut',()=>{const history=fs.readFileSync('js/activity-center.js','utf8'),sales=fs.readFileSync('js/vendas.js','utf8');assert.match(history,/data-history-undo-sale/);assert.match(history,/data-history-cancel-sale/);assert.match(history,/Cancelar venda não tem limite de 5 minutos/);assert.match(sales,/5 \* 60 \* 1000/);});
