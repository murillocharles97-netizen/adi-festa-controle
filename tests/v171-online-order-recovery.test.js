const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const read=p=>fs.readFileSync(p,'utf8'),sync=read('js/firebase/sync.js'),auth=read('js/firebase/auth.js');
const section=(source,start,end)=>source.slice(source.indexOf(start),source.indexOf(end,source.indexOf(start)));
const plain=x=>structuredClone(x);

function serialization(){
 const c={structuredClone,sanitizeForFirestore:plain,normalizeText:x=>String(x||'').toLowerCase(),IDEMPOTENT_EVENT_NAMES:new Set(),activeBusinessId:()=> 'qa-business',currentUser:{uid:'owner'},serverTimestamp:()=> 'SERVER',increment:n=>n,window:{TeamAccess:{actor:()=>({actorUid:'owner'})}}};
 vm.createContext(c);vm.runInContext(section(sync,'function enrich(','function archiveQueue('),c);return c;
}
test('real Sync serializer retains reservation proof for simple products and variations, strips unrelated variant fields',()=>{
 const c=serialization();for(const type of ['products','productVariants']){
  const result=c.cloudPayload(type,'item',{stock:0,estoqueAtual:0,onlineReservedStock:1,onlineOrderFinalizationId:'order',attributeValues:{Cor:'Vermelho'},isAdmin:true});
  assert.equal(result.onlineReservedStock,1);assert.equal(result.onlineOrderFinalizationId,'order');
  assert.equal(result.businessId,'qa-business');if(type==='productVariants')assert.equal(result.isAdmin,undefined);
 }
});
test('partial stock patches do not invent name/search/default fields outside stock permission',()=>{
 const c=serialization(),v=c.cloudPayload('productVariants','v',{stock:0,onlineReservedStock:1,onlineOrderFinalizationId:'order'}),p=c.cloudPayload('products','p',{estoqueAtual:1});
 for(const key of ['displayNameNormalized','searchTokens'])assert.equal(v[key],undefined);
 for(const key of ['nomeNormalizado','controlaEstoque'])assert.equal(p[key],undefined);
 for(const item of [v,p]){assert.equal(item.ownerId,undefined);assert.equal(item.schemaVersion,undefined);}
 assert.equal(c.cloudPayload('products','p',{nome:'QA'},true).schemaVersion,3);
});

test('stock-only variant recomputation preserves catalog metadata despite query order',()=>{
 const product={id:'p',productType:'variable',schemaVersion:3,preco:25,variationSearchTokens:['red','blue']};
 const data={produtos:[product],variacoesProdutos:[{id:'blue',parentProductId:'p',stock:1,price:25,displayName:'blue'},{id:'red',parentProductId:'p',stock:0,price:25,displayName:'red'}]};
 const c={window:{},DB:{carregar:()=>data},Date};c.window=c;vm.createContext(c);vm.runInContext(read('js/product-variations.js'),c);
 c.ProductVariations.recomputeInData(data,'p',{stockOnly:true});assert.equal(product.estoqueAtual,1);assert.equal(product.schemaVersion,3);assert.deepEqual(product.variationSearchTokens,['red','blue']);assert.equal(product.activeVariationCount,undefined);assert.equal(product.atualizadoEm,undefined);
});
function diff(){const c={structuredClone,now:()=> 'now',activeBusinessId:()=> 'qa-business',SOURCES:{stockMovements:{key:'movimentacoesEstoque'}},sourceItems:(d,k)=>d[k==='stockMovements'?'movimentacoesEstoque':k]||[],window:{SpaceContext:{stockMovementOrigin:(p,id)=>{if(!id||id==='all_spaces')throw Error('Selecione espaço');return{businessId:'qa-business',spaceId:id};}}}};vm.createContext(c);vm.runInContext(section(sync,'function changedFields(','function captureChanges('),c);return c;}
test('new stock receipts get explicit origin; legacy history is not rewritten',()=>{
 const c=diff(),before={config:{},movimentacoesEstoque:[{id:'old',quantidade:1}],produtos:[{id:'p'}],vendas:[]},after=plain(before);
 after.vendas.push({id:'sale',businessId:'qa-business',spaceId:'a'});after.movimentacoesEstoque.push({id:'new',vendaId:'sale',produtoId:'p',quantidade:-1});
 c.diffWrites(before,after);assert.equal(after.movimentacoesEstoque[1].spaceId,'a');assert.equal(after.movimentacoesEstoque[1].businessId,'qa-business');assert.equal(after.movimentacoesEstoque[0].spaceId,undefined);assert.equal(before.movimentacoesEstoque.length,1);
 assert.throws(()=>c.diffWrites(before,{...after,movimentacoesEstoque:[{id:'new',vendaId:'sale',produtoId:'p',spaceId:'b'}]}),/espaço da venda/);
 assert.throws(()=>c.diffWrites(before,{...after,movimentacoesEstoque:[{id:'new',produtoId:'p',businessId:'foreign'}]}),/outra empresa/);
 assert.throws(()=>c.diffWrites(before,{...before,movimentacoesEstoque:[{id:'new',produtoId:'p'}]}),/Selecione/);
});
function bootstrap(){
 let active=null,sequence=0,stops=0,closed=0,open=async()=>{};const timers=[],events=[];
 const node={textContent:'',replaceChildren(){}},c={console,structuredClone,bootstrapSequence:1,bootstrapState:'ready',badgeSubscription:null,INTERNAL_BUSINESS_ID:'qa-business',document:{querySelector:()=>node,querySelectorAll:()=>[],createTextNode:x=>x,documentElement:{classList:{remove(){}}}},gate:{},auth:{currentUser:{uid:'owner'}},workspaceRuntime:()=>({capture:()=>({workspaceGeneration:0})}),bootstrapLog(){},syncSubscriptionShell(){},updateCloudBadge(){},normalizedCode:e=>e.code,performance:{now:()=>0},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},dispatchEvent:e=>events.push(e),setTimeout:fn=>timers.push(fn),DB:{useBusiness:()=>open(),carregar:()=>({}),alterar(){}},BusinessContext:{set:({business,userProfile})=>({business,userProfile,permissions:[],role:'owner'})},logout(){},updateBusinessDetails(){},updateProfileDetails(){},updateTutorialVersion(){},sendPasswordReset(){},handleMembershipChange(){},setBootstrapState:s=>c.bootstrapState=s};
 c.window=c;c.SyncFirebase={setUser(user){active=user.uid;sequence++;},stop(){stops++;active=null;},subscribe(){const id=sequence;return()=>{closed++;assert.ok(id<=sequence);};}};
 vm.createContext(c);vm.runInContext(read('js/firebase/session-lifecycle.js').replaceAll('export ',''),c);vm.runInContext(section(auth,'function assertCurrentRun(','function login(')+section(auth,'async function allowed(','async function handleMembershipChange('),c);
 const run=token=>c.allowed({uid:'owner'},{uid:'owner',businessId:'qa-business'},{id:'qa-business',active:true},{},token);
 return{c,run,timers,events,open:fn=>open=fn,status:()=>({active,sequence,stops,closed})};
}
test('actual bootstrap ends old Sync/badge before starting replacements; stale mount cannot fire',async()=>{
 const h=bootstrap();await h.run({sequence:1});h.c.bootstrapSequence=2;await h.run({sequence:2});
 assert.equal(h.status().active,'owner');assert.equal(h.status().stops,1);assert.equal(h.status().closed,1);
 for(const fn of h.timers)fn();assert.equal(h.events.filter(e=>e.type==='firebase-auth-ready').length,1);
 h.c.cleanupCurrentSession();assert.equal(h.status().active,null);assert.equal(h.status().stops,2);assert.equal(h.status().closed,2);
});
test('logout/new bootstrap while IndexedDB opens cannot reactivate an obsolete Sync session',async()=>{
 const h=bootstrap();let release;h.open(()=>new Promise(resolve=>release=resolve));const token={sequence:1},pending=h.run(token);token.cancelled=true;h.c.bootstrapSequence=2;release();
 await assert.rejects(pending,{code:'bootstrap/cancelled'});assert.equal(h.status().sequence,0);assert.equal(h.c.FirebaseSession,undefined);
});
test('cleanup releases its owner before invoking old callback',()=>{
 const h=bootstrap();let runs=0;h.c.registerCleanup('nested',()=>{runs++;h.c.runCleanup('nested');});h.c.runCleanup('nested');assert.equal(runs,1);
});
