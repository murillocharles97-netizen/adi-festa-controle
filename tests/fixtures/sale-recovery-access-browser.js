/* Test-only synthetic identities. CSP forbids all external connections. */
(()=>{
 const businessId='qa-recovery-access',uid='qa-recovery-seller',spaceId='qa-space',oldScope=`business-cache:v156:adiFestaDB_v1:${businessId}:${uid}:beforecancel`,newScope=`business-cache:v156:adiFestaDB_v1:${businessId}:${uid}:aftercancel`;
 let permissions=['sales.create','sales.cancel','customers.view','products.view','inventory.view'],data={config:{}},baseline='',uploads=new Map(),setupWrites=0;
 const ctx=()=>({businessId,role:'seller',userProfile:{uid,active:true},member:{status:'active'},business:{active:true,workspaceGeneration:0},spaceAccess:'selected',allowedSpaceIds:[spaceId],permissions,access:{readOnly:false}});
 window.BusinessContext={get:ctx,hasPermission:p=>permissions.includes(p)};window.FirebaseSession={user:{uid},profile:{uid,active:true,role:'seller',businessId}};window.FirebaseBootstrap={state:'loading_access'};
 window.SpaceContext={homeId:()=>spaceId};window.Utils={toast(){}};
 window.DB={getBusinessId:()=>businessId,getWorkspaceGeneration:()=>0,carregar:()=>data,alterar:fn=>{setupWrites++;fn(data);}};
 const result=document.querySelector('[data-qa-result]'),empty=()=>({config:{},vendas:[],movimentacoesEstoque:[]});
 const samples=Array.from({length:4},(_,n)=>{
  const id=`qa-retained-sale-${n}`,operationId=`qa-retained-op-${n}`,sale={id,operationId,businessId,spaceId,actorUid:uid,data:`2026-10-17T${14+n}:19:54.000Z`,valorFinal:24.9+n,formaPagamento:'dinheiro',itens:[{produtoId:`qa-product-${n}`,nome:`Produto fictício ${n}`,quantidade:1,precoFinalUnitario:24.9+n}]};
  const movements=Array.from({length:[1,5,4,1][n]},(_,i)=>({id:`qa-move-${n}-${i}`,businessId,spaceId,operationId,vendaId:id,quantidade:-1}));
  const packet={operationId,businessId,userId:uid,workspaceGeneration:0,createdAtLocal:sale.data,lastErrorCode:'permission-denied',status:'error',payload:{writes:[{entityType:'sales',entityId:id,operation:'create',data:sale}]}};return{sale,movements,packet};
 });
 window.FirebaseCallable=async(name,input)=>{
  if(name!=='submitSaleRecovery')return{data:{items:[],nextCursor:null}};
  const original=JSON.parse(input.originalJson),id=original.packet.operationId;
  if(uploads.has(id)&&uploads.get(id)!==input.originalJson)throw Error('Conflito QA');uploads.set(id,input.originalJson);
  return{data:{status:'awaiting_review',operationId:id,contentHash:input.contentHash}};
 };
 document.querySelector('[data-qa-block]').onclick=()=>{permissions=[];dispatchEvent(new Event('business-context-changed'));result.textContent='Todos os módulos comerciais bloqueados; recuperação deve permanecer acessível.';};
 document.querySelector('[data-qa-denied]').onclick=()=>{document.querySelector('#app').innerHTML=TeamAccess.deniedMarkup();};
 document.querySelector('[data-qa-onboarding]').onclick=()=>{dispatchEvent(new Event('operation-settings-loaded'));result.textContent=`Assistente indevido: ${Boolean(document.querySelector('.operation-flow'))}; gravações de configuração: ${setupWrites}`;};
 document.querySelector('[data-qa-verify]').onclick=async()=>{
  const current=JSON.stringify(await DB.localRecords.list(oldScope)),sources=await DB.businessCache.recoverySources({businessId,uid,workspaceGeneration:0}),snapshot={identity:{businessId,uid,workspaceGeneration:0},sources};
  result.textContent=`Namespace atual vazio: ${(await DB.localRecords.list(newScope)).filter(r=>r.kind==='item').length===0}\nVendas antigas encontradas: ${SaleRecoveryClient.entries(snapshot).length}\nPacotes enviados: ${uploads.size}\nMovimentos preservados: ${sources.flatMap(s=>s.local.movimentacoesEstoque).length}\nNamespace original byte-equivalente: ${current===baseline}\nEfeitos comerciais: 0\nGravações de configuração: ${setupWrites}`;
 };
 addEventListener('load',async()=>{
  try{
   data=await DB.businessCache.open(`adiFestaDB_v1:${businessId}:${uid}:beforecancel`,[],empty);
   data={config:{},vendas:samples.map(x=>x.sale),movimentacoesEstoque:samples.flatMap(x=>x.movements)};DB.businessCache.stage(data);
   DB.businessCache.keyValue.setItem(`adiFesta:${businessId}:${uid}:beforecancel:syncQueue`,JSON.stringify(samples.map(x=>x.packet)));await DB.flush();
   baseline=JSON.stringify(await DB.localRecords.list(oldScope));
   data=await DB.businessCache.open(`adiFestaDB_v1:${businessId}:${uid}:aftercancel`,[],empty);
   FirebaseBootstrap.state='authorized';document.querySelector('#app').innerHTML='<h2>Início — vendedor QA</h2><p>Permissões de vendedor válidas; cache atual vazio.</p>';
   dispatchEvent(new Event('firebase-auth-ready'));result.textContent='Pronto: quatro operações preservadas no namespace anterior; atual vazio; nenhuma operação comercial executada.';
  }catch(error){result.textContent='FALHA QA: '+error.message;}
 });
})();
