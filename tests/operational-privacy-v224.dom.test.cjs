'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),{JSDOM}=require('jsdom');
function harness(){
 const dom=new JSDOM('<div id="modal"></div>',{runScripts:'outside-only',url:'http://localhost/qa'}),w=dom.window;
 let context={businessId:'qa-company',business:{workspaceGeneration:0},userProfile:{uid:'qa-seller'},member:{role:'seller',status:'active',permissionsVersion:3,permissions:{'sales.create':true,'performance.daily':true,'performance.history':false},spaceAccess:'selected',allowedSpaceIds:['qa-space']},spaceAccess:'selected',allowedSpaceIds:['qa-space'],loading:false,error:null},calls=[];
 w.structuredClone=structuredClone;w.BusinessContext={get:()=>context};w.FirebaseSession={user:{uid:'qa-seller'}};w.SpaceContext={homeId:()=> 'qa-space'};w.FirebaseCallable=async(name,input)=>{calls.push({name,input});return{data:{businessId:context.businessId,uid:context.userProfile.uid,workspaceGeneration:0,readPolicyVersion:1,source:'server',serverNow:'2026-10-31T15:00:00Z',window:{day:'2026-10-31',zone:'America/Sao_Paulo',from:'2026-10-31T03:00:00Z',to:'2026-11-01T03:00:00Z'},items:[],record:null,next:null}};};
 for(const path of ['functions/src/shared/permission-policy.js','functions/src/shared/operational-privacy-policy.js','js/operational-read-policy.js'])w.eval(fs.readFileSync(path,'utf8'));
 return{w,calls,context:()=>context,change:patch=>{context={...context,...patch};w.dispatchEvent(new w.CustomEvent('business-context-changed'));},close:()=>dom.window.close()};
}
const source={clientes:[{id:'c',businessId:'qa-company',spaceId:'qa-space',nome:'Fictício',saldo:-5,totalComprado:99999}],vendas:[{id:'old',businessId:'qa-company',spaceId:'qa-space',data:'2026-10-30T15:00:00Z',valorFinal:99999},{id:'now',businessId:'qa-company',spaceId:'qa-space',data:'2026-10-31T15:00:00Z',valorFinal:10,itens:[]}],pagamentos:[],movimentacoesEstoque:[],movimentacoes:[{id:'old-movement',data:'2026-10-30T15:00:00Z',valor:99999}],eventosCampanha:[{id:'old-benefit',valor:99999}],config:{nome:'Fictício',dashboard:{revenue:99999}},queue:[{operationId:'original',status:'error',checksum:'untouched',payload:{valor:99999}}]};
test('UI projection hides retained old rows and lifetime totals without changing storage, IDs, queue or checksums',async()=>{
 const h=harness();try{const before=JSON.stringify(source);let v=h.w.OperationalReadPolicy.view(source);assert.equal(v.vendas.length,0);await h.w.OperationalReadPolicy.call({collection:'sales'});v=h.w.OperationalReadPolicy.view(source);assert.deepEqual(Array.from(v.vendas,s=>s.id),['now']);assert.equal(v.clientes[0].totalComprado,undefined);assert.equal(v.eventosCampanha.length,0);assert.equal(v.movimentacoes.length,0);assert.equal(v.config.dashboard,undefined);assert.equal(JSON.stringify(source),before);assert.deepEqual(JSON.parse(JSON.stringify(v.queue)),source.queue);}finally{h.close();}
});
test('daily view cannot read another space/company or use unverified device date',async()=>{
 const h=harness();try{await h.w.OperationalReadPolicy.call({collection:'sales'});const v=h.w.OperationalReadPolicy.view({...source,vendas:source.vendas.concat({...source.vendas[1],id:'foreign',businessId:'another'},{...source.vendas[1],id:'space',spaceId:'another'})});assert.deepEqual(Array.from(v.vendas,s=>s.id),['now']);}finally{h.close();}
});
test('retired callable responses, permission revocation and signout never reach the new namespace',async()=>{
 const h=harness();try{let finish;const original=h.w.FirebaseCallable;h.w.FirebaseCallable=async(...args)=>{const r=await original(...args);return new Promise(resolve=>finish=()=>resolve(r));};const task=h.w.OperationalReadPolicy.call({collection:'clients'});await new Promise(setImmediate);h.change({businessId:'qa-other',userProfile:{uid:'qa-new'}});finish();await assert.rejects(task,e=>e.code==='sync-session-retired');assert.equal(h.w.OperationalReadPolicy.currentWindow(),null);}finally{h.close();}
});
test('network retry sends only evidence-free read request, never a commercial operation',async()=>{
 const h=harness();try{const original=h.w.FirebaseCallable;h.w.FirebaseCallable=async()=>{throw Error('QA network unavailable');};await assert.rejects(h.w.OperationalReadPolicy.call({collection:'sales'}));h.w.FirebaseCallable=original;await h.w.OperationalReadPolicy.call({collection:'sales'});assert.equal(h.calls.length,1);assert.equal(h.calls[0].name,'readOperationalWorkspace');assert.equal(h.calls[0].input.item,undefined);assert.equal(h.w.OperationalReadPolicy.handles('sales'),true);}finally{h.close();}
});
test('read-only repository wrapper fences old full-access in-flight list and document listener',async()=>{
 const h=harness();try{h.change({member:{...h.context().member,permissions:{'performance.daily':true,'performance.history':true}}});let resolve,listener;const repository=h.w.OperationalReadPolicy.wrapRepository('sales',{list:()=>new Promise(r=>resolve=r),subscribeById:(id,cb)=>{listener=cb;return()=>{};}});const task=repository.list();let applied=0;repository.subscribeById('old',()=>applied++);h.change({member:{...h.context().member,permissions:{'performance.daily':true,'performance.history':false}}});listener(source.vendas[0]);resolve(source.vendas);await assert.rejects(task,e=>e.code==='sync-session-retired');assert.equal(applied,0);}finally{h.close();}
});
test('hydration notification cannot create a read feedback loop; genuine remote signal triggers bounded refresh',async()=>{
 const h=harness();try{const repo=h.w.OperationalReadPolicy.wrapRepository('clients',{subscribe(){}}),stop=repo.subscribe(()=>h.w.dispatchEvent(new h.w.CustomEvent('cloud-data-updated',{detail:{source:'cloud',collection:'clients'}})));await new Promise(r=>setTimeout(r,500));assert.equal(h.calls.length,1);h.w.dispatchEvent(new h.w.CustomEvent('operational-remote-invalidation'));await new Promise(r=>setTimeout(r,500));assert.equal(h.calls.length,2);stop();}finally{h.close();}
});
test('offline requests preserve originals and require an authorized current customer context',async()=>{
 const h=harness();try{const before=JSON.stringify(source);Object.defineProperty(h.w.navigator,'onLine',{value:false});await assert.rejects(h.w.OperationalReadPolicy.call({mode:'customer_context',customerId:'c',purpose:'payment'}),e=>e.code==='operational-read-offline');assert.equal(h.w.OperationalReadPolicy.paymentPrepared('c'),false);assert.equal(h.calls.length,0);assert.equal(JSON.stringify(source),before);}finally{h.close();}
});
test('retained full campaign ledger is not counted twice against the current operational benefit baseline',async()=>{
 const h=harness(),{w}=h;try{
  const campaign={id:'qa-campaign',businessId:'qa-company',type:'buy_get',name:'QA',status:'active',active:true,startsAt:'2020-01-01',qualification:{productIds:['p']},rule:{requiredQuantity:1,multipleCycles:true},rewards:[{id:'reward',type:'product',productId:'p',quantity:1}]},progress={id:'qa-campaign__c',businessId:'qa-company',campaignId:'qa-campaign',clientId:'c',confirmedProgress:2,pendingProgress:0,pendingPoints:0,availablePoints:0,availableRewards:2,redeemedRewards:0};
  const raw={campanhas:[campaign],clientes:[{id:'c'}],produtos:[{id:'p'}],progressosCampanha:[progress],eventosCampanha:[{id:'past-1',clientId:'c',campaignId:'qa-campaign',transition:'earned',status:'confirmed',delta:{progress:1}},{id:'past-2',clientId:'c',campaignId:'qa-campaign',transition:'earned',status:'confirmed',delta:{progress:1}}],resgatesCampanha:[],recompensas:[],vendas:[]};
  w.DB={carregar:()=>raw};const transport=w.FirebaseCallable;w.FirebaseCallable=async(...args)=>{const r=await transport(...args);r.data.client={id:'c'};r.data.campaignProgress=[{...progress,ledgerBaseline:{confirmedProgress:2,availablePoints:0,redeemedRewards:0}}];r.data.campaignEvents=[];return r;};
  await w.OperationalReadPolicy.customerContext('c');w.eval(fs.readFileSync('js/campaign-engine-v2.js','utf8'));
  const old=JSON.stringify(raw.eventosCampanha);
  for(let n=1;n<=2;n++){const sale={id:'new-'+n,operationId:'op-'+n,businessId:'qa-company',clienteId:'c',status:'pago',formaPagamento:'pix',data:'2026-10-31T15:00:00Z',itens:[{produtoId:'p',quantidade:1,precoFinalUnitario:10}],valorFinal:10};w.OperationalReadPolicy.benefitOperation(raw,'c',d=>w.CampaignEngineV2.applySale(d,sale));}
  assert.equal(raw.progressosCampanha[0].confirmedProgress,4);assert.equal(raw.progressosCampanha[0].ledgerBaseline,undefined);assert.equal(JSON.stringify(raw.eventosCampanha.slice(0,2)),old);assert.equal(raw.eventosCampanha.length,4);
 }finally{h.close();}
});
test('old retained unpaid projection cannot receive another allocation when current server context excludes it',async()=>{
 const h=harness(),{w}=h;try{
  const old={id:'old',clienteId:'c',status:'fiado',formaPagamento:'fiado',creditOriginalAmount:100,creditPaidAmount:0,creditRemainingAmount:100},open={id:'open',clienteId:'c',status:'fiado',formaPagamento:'fiado',creditOriginalAmount:10,creditPaidAmount:0,creditRemainingAmount:10};
  const raw={vendas:[old,{...open}],alocacoesPagamento:[],eventosCampanha:[]};w.DB={carregar:()=>raw};const transport=w.FirebaseCallable;w.FirebaseCallable=async(...args)=>{const r=await transport(...args);Object.assign(r.data,{client:{id:'c'},sales:[open],campaignProgress:[],campaignEvents:[]});return r;};
  await w.OperationalReadPolicy.customerContext('c','payment');w.eval(fs.readFileSync('js/campaign-engine-v2.js','utf8'));const before=JSON.stringify(old);
  const result=w.OperationalReadPolicy.debtOperation(raw,'c',data=>w.CampaignEngineV2.allocatePayment(data,'c',5,'payment-once'));
  assert.equal(result.length,1);assert.equal(result[0].saleId,'open');assert.equal(raw.vendas[1].creditRemainingAmount,5);assert.equal(JSON.stringify(old),before);assert.equal(raw.vendas.length,2);assert.equal(raw.alocacoesPagamento.length,1);
 }finally{h.close();}
});
test('ordinary metadata refresh does not revoke an unchanged customer context; actual policy change does',async()=>{
 const h=harness(),{w}=h;try{const transport=w.FirebaseCallable;w.FirebaseCallable=async(...a)=>{const r=await transport(...a);Object.assign(r.data,{client:{id:'c'},sales:[],campaignProgress:[],campaignEvents:[]});return r;};await w.OperationalReadPolicy.customerContext('c','payment');w.dispatchEvent(new w.CustomEvent('business-context-changed'));assert.equal(w.OperationalReadPolicy.paymentPrepared('c'),true);h.change({member:{...h.context().member,permissions:{'sales.create':false,'performance.daily':true}}});assert.equal(w.OperationalReadPolicy.paymentPrepared('c'),false);}finally{h.close();}
});
test('limited sale capacity is one local admission only and never exposes the monthly sales count',async()=>{
 const h=harness(),{w}=h;try{const transport=w.FirebaseCallable;w.FirebaseCallable=async(...a)=>{const r=await transport(...a);Object.assign(r.data,{canCreate:true,limited:true});return r;};assert.equal(w.OperationalReadPolicy.saleCapacityDecision().ok,false);await w.OperationalReadPolicy.prepareSale();assert.equal(w.OperationalReadPolicy.saleCapacityDecision().ok,true);w.OperationalReadPolicy.consumeSaleCapacity();assert.equal(w.OperationalReadPolicy.saleCapacityDecision().ok,false);assert.equal(h.calls.length,1);assert.equal(h.calls[0].input.mode,'sale_capacity');}finally{h.close();}
});
test('case UI uses one exact grant and retires its result during account change, without accessing commercial mutation APIs',async()=>{
 const h=harness(),{w}=h;try{const transport=w.FirebaseCallable;w.FirebaseCallable=async(name,input)=>{const r=await transport(name,input);if(input.mode==='cases')r.data.items=[{id:'grant-qa',saleId:'old',purpose:'cancel',expiresAt:'2026-10-31T15:15:00Z'}];else r.data.record={id:'old',valorFinal:10};return r;};let opened=0;w.ActivityCenter={openOperationalSale:s=>{assert.equal(s.id,'old');opened++;}};await w.OperationalReadPolicy.openCase();const button=w.document.querySelector('[data-op-case-list] button');assert.ok(button);button.click();await new Promise(setImmediate);assert.equal(opened,1);assert.equal(w.OperationalReadPolicy.grantFor('old','cancel'),'grant-qa');assert.equal(w.OperationalReadPolicy.grantFor('old','exchange'),null);assert.equal(h.calls[1].input.grantId,'grant-qa');assert.equal(h.calls.every(c=>c.name==='readOperationalWorkspace'),true);h.change({businessId:'another'});assert.equal(w.OperationalReadPolicy.grantFor('old','cancel'),null);}finally{h.close();}
});
test('operational DTO retains Online V2 revision, mode and status chronology, never bearer credentials',()=>{
 const P=require('../functions/src/shared/operational-privacy-policy'),O=require('../functions/src/shared/online-order');
 const order={id:'qa-order',businessId:'qa-company',spaceId:'qa-space',schemaVersion:2,source:'online_store',revision:8,orderStatus:'separando',serviceModeType:'pickup',serviceModeLabel:'Retirada',items:[],statusHistory:[{status:'separando',at:'2026-10-31T15:00:00Z',secret:'not-read'}],orderAccessToken:'never-return',accessTokenHash:'never-return'};
 const dto=P.sanitize('catalogOrders',order);assert.equal(dto.revision,8);assert.equal(dto.serviceModeType,'pickup');assert.deepEqual(O.next(dto.orderStatus,dto.serviceModeType),['entregue']);assert.equal(dto.statusHistory[0].status,'separando');assert.equal(dto.statusHistory[0].secret,undefined);assert.equal(dto.orderAccessToken,undefined);assert.equal(dto.accessTokenHash,undefined);
});
test('campaign operational DTO keeps stacking and discount semantics without old audience reports',()=>{
 const P=require('../functions/src/shared/operational-privacy-policy'),c={id:'qa-campaign',name:'QA',type:'quantity_discount',stacking:{allowed:true,priority:2,conflictGroup:'qa'},rule:{thresholds:[{quantity:2,discountPercent:5}]},audienceSnapshot:{summaries:['historical-revenue']},audienceSource:{conditionsSnapshot:[{revenue:999}]}};
 const dto=P.sanitize('campaigns',c);assert.deepEqual(dto.stacking,c.stacking);assert.deepEqual(dto.rule,c.rule);assert.equal(dto.audienceSnapshot,undefined);assert.equal(dto.audienceSource,undefined);
});
test('editing a projected customer never invents a replacement for an undisclosed portal token',()=>{
 const vm=require('node:vm'),data={clientes:[{id:'c',nome:'Fictício',documento:'QA-only',estado:'SP'}]};
 const c={Utils:{uuid:()=> 'new-only-for-creation'},PhoneUtils:{normalizeBrazilianPhone:String},DB:{carregar:()=>data,alterar:f=>f(data)},TeamAccess:{has:()=>true}};c.window=c;vm.createContext(c);vm.runInContext(fs.readFileSync('js/clientes.js','utf8'),c);
 c.Clientes.salvar({id:'c',nome:'Fictício atualizado',documento:'QA-only',estado:'SP'});assert.equal(data.clientes[0].id,'c');assert.equal(data.clientes[0].portalRefToken,undefined);assert.equal(data.clientes[0].documento,'QA-only');
});
