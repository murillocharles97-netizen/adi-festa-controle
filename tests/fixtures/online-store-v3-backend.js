// QA local da Loja Online V3: backend em memória que reproduz o contrato de
// functions/src/services/online-store-service.js (revisão, proprietário, link único,
// limites de 400 itens e 1.000 produtos, rascunho x publicação). Dados 100% fictícios.
(function(){
  'use strict';
  const M=window.OnlineStoreModel,params=new URLSearchParams(location.search),qa=window.__LOJA_QA__||{};
  const scenario=qa.scenario||params.get('loja')||'published',count=Number(qa.count||params.get('count')||24);
  const BUSINESS=qa.businessId||'loja-qa-business',IMG='https://qa-images.veconi.test/';
  const fail=(code,message)=>{throw Object.assign(Error(message),{code:`functions/${code}`});};
  const names=[['Brigadeiro gourmet','Doces',3.5],['Beijinho de coco','Doces',3.5],['Bolo de pote','Bolos',14],['Brownie de chocolate','Doces',9],['Torta de limão (fatia)','Tortas',12],['Cookie com gotas','Biscoitos',7],['Pão de mel','Doces',6.5],['Caixa de brigadeiros','Presentes',28],['Bolo de cenoura','Bolos',45],['Cheesecake de frutas vermelhas','Tortas',16],['Palha italiana','Doces',6],['Cupcake de baunilha','Bolos',8.5],['Café gelado','Bebidas',11],['Limonada suíça','Bebidas',9.5],['Kit festa (50 docinhos)','Presentes',95],['Alfajor artesanal','Biscoitos',7.5],['Pudim de leite','Tortas',10],['Bombom de morango','Doces',6],['Trufa de maracujá','Doces',4.5],['Bolo no pote de ninho','Bolos',15],['Torta holandesa (fatia)','Tortas',13],['Cookie red velvet','Biscoitos',8],['Chocolate quente','Bebidas',9],['Cesta café da manhã','Presentes',129]];
  const raw=[];
  for(let i=0;i<count;i++){
    const [n,cat,price]=names[i%names.length],round=Math.floor(i/names.length),id=`qa-${String(i+1).padStart(4,'0')}`;
    const p={id,nome:round?`${n} ${round+1}`:n,categoria:cat,preco:price+(round%3),estoqueAtual:i%9===4?0:(i*7)%23+2,controlaEstoque:true,ativo:true,spaceAccessMode:'all_spaces',custo:price*.42,itemKind:'product',descricao:'Feito sob encomenda com ingredientes selecionados.'};
    if(i%11!==7){p.imageUrl=`${IMG}${encodeURIComponent(cat)}/${i%6}.svg`;p.imageThumbUrl=p.imageUrl;}
    if(n==='Bolo de pote'||n==='Caixa de brigadeiros')p.productType='variable';
    if(n==='Kit festa (50 docinhos)'){p.controlaEstoque=false;p.semControleEstoque=true;}
    raw.push(p);
  }
  const variants=[];
  for(const p of raw.filter(p=>p.productType==='variable')){
    const opts=p.nome.startsWith('Bolo')?[['Chocolate',14,6],['Ninho com morango',16,3],['Limão',14,0]]:[['4 unidades',16,8],['9 unidades',28,5],['16 unidades',46,2]];
    opts.forEach(([label,price,stock],i)=>variants.push({id:`${p.id}-v${i+1}`,parentProductId:p.id,displayName:label,attributeValues:{[p.nome.startsWith('Bolo')?'Sabor':'Tamanho']:label},price,stock,active:true,catalogVisible:true}));
  }
  const spaces=[{id:'qa-space-a',name:'Doceria Aurora'},{id:'qa-space-b',name:'Quiosque Shopping'}];
  const stores=new Map(),slugs=new Map([['loja-ocupada',{businessId:'outra-empresa',storeId:'store_x'}]]),publicDocs=new Map();
  const select=raw.slice(0,Math.min(raw.length,qa.select??(scenario==='large'?180:14))).map(p=>p.id);
  if(scenario!=='new'){
    const s={id:'store_qa_a',kind:'space_store',schemaVersion:2,businessId:BUSINESS,spaceId:'qa-space-a',publicToken:'qa_public_token_aurora_000000000000',slug:'doceria-aurora',revision:3,workspaceGeneration:0,v2Enabled:scenario!=='draft',
      catalogSettings:M.settings({publicName:'Doceria Aurora',welcomeText:'Doces artesanais feitos por encomenda. Entregamos no bairro Jardim e região.',primaryColor:'#c23b6a',secondaryColor:'#fbe7ee',contactPhone:scenario==='nophone'?'':'(11) 90000-0000',instagram:'@doceria.aurora.qa',openingHours:'Ter. a sáb., das 9h às 19h',pickupEnabled:true,deliveryEnabled:true,pickupAddress:'Rua Fictícia, 100 — Jardim QA',deliveryInstructions:'Entregamos no Jardim QA e bairros vizinhos.',logoUrl:`${IMG}logo/aurora.svg`,coverUrl:`${IMG}cover/aurora.svg`,paymentMethods:['pix','dinheiro','cartao']}),
      presentation:{products:Object.fromEntries(select.slice(0,4).map((id,i)=>[id,{featured:i<3,order:i+1,category:''}])),categories:[{internalName:'Doces',publicName:'Docinhos',active:true,order:0},{internalName:'Bolos',publicName:'Bolos',active:true,order:1}],banners:[]},
      selectedProductIds:select,published:scenario==='published'||scenario==='large'||scenario==='nophone',checkoutEnabled:false,activation:scenario==='draft'?null:{confirmedBy:'qa-owner',confirmedAt:'2026-11-01T12:00:00.000Z',mode:'manual_space_activation'},createdAt:'2026-11-01T12:00:00.000Z',updatedAt:'2026-11-20T12:00:00.000Z'};
    if(scenario==='paused'){s.published=false;}
    s.catalogSettings.checkoutEnabled=false;stores.set('qa-space-a',s);slugs.set(s.slug,{businessId:BUSINESS,storeId:s.id,catalogToken:s.publicToken});
    if(s.activation)publishDoc(s);
  }
  // Espaço B: outra loja do mesmo negócio — o painel nunca deve misturar.
  stores.set('qa-space-b',{id:'store_qa_b',kind:'space_store',schemaVersion:2,businessId:BUSINESS,spaceId:'qa-space-b',publicToken:'qa_public_token_quiosque_00000000000',slug:'quiosque-qa',revision:1,workspaceGeneration:0,v2Enabled:true,catalogSettings:M.settings({publicName:'Quiosque QA'}),presentation:{products:{},categories:[],banners:[]},selectedProductIds:['qa-b-only'],published:true,checkoutEnabled:false,activation:{confirmedAt:'2026-11-01T12:00:00.000Z'}});
  function publishDoc(s){
    const items=s.selectedProductIds.map(id=>raw.find(p=>p.id===id)).filter(Boolean).map(p=>M.product(p,variants,s.presentation)).sort((a,b)=>a.displayOrder-b.displayOrder);
    const settings=s.catalogSettings,pres=M.publicPresentation(s.presentation);
    const doc={catalogToken:s.publicToken,documentId:s.publicToken,schemaVersion:6,catalogType:'space_store',businessId:s.businessId,spaceId:s.spaceId,visitId:s.id,publicName:settings.publicName,...settings,publicSettings:settings,items,...pres,active:s.published,catalogVisible:s.published,acceptingOrders:s.published&&s.checkoutEnabled,serviceModes:[...(settings.pickupEnabled?[{id:'pickup',type:'pickup',label:'Retirada',active:true}]:[]),...(settings.deliveryEnabled?[{id:'delivery',type:'delivery',label:'Entrega',active:true}]:[])],closedBehavior:'view_only',status:s.checkoutEnabled?'active':'paused',workspaceGeneration:0,revision:s.revision,updatedAt:new Date().toISOString()};
    publicDocs.set(s.publicToken,doc);
    try{localStorage.setItem(`loja-qa-public:${s.slug}`,JSON.stringify(doc));}catch{}
    return doc;
  }
  const productsFor=spaceId=>spaceId==='qa-space-b'?[M.product({id:'qa-b-only',nome:'Produto exclusivo do quiosque',preco:5,categoria:'Quiosque',estoqueAtual:3})]:raw.map(p=>M.product(p));
  const reception=s=>{const pub=s?.published===true,settings=s?.catalogSettings||{},delivery=settings.pickupEnabled||settings.deliveryEnabled,pay=(settings.paymentMethods||[]).length>0,enabled=pub&&s.checkoutEnabled===true;return {enabled,canEnable:pub&&delivery&&pay,reason:!pub?'not_published':!delivery?'delivery_required':!pay?'payment_required':enabled?'receiving':'paused'};};
  const latency=()=>new Promise(r=>setTimeout(r,Number(qa.latency??180)));
  window.__lojaQA={stores,publicDocs,calls:[],raw,variants,failNext:null,conflictNext:false};
  window.FirebasePublicCatalogReader=async token=>{await latency();return structuredClone(publicDocs.get(token)||null);};
  window.FirebaseCallable=async(name,data)=>{
    const log={name,action:data.action||null,spaceId:data.spaceId,productIds:data.productIds?.length??null};window.__lojaQA.calls.push(log);
    await latency();
    if(data.businessId!==BUSINESS)fail('permission-denied','Empresa não autorizada.');
    if(!spaces.some(s=>s.id===data.spaceId))fail('permission-denied','Espaço não autorizado para catálogo.');
    if(window.__lojaQA.failNext){const f=window.__lojaQA.failNext;window.__lojaQA.failNext=null;fail(f.code,f.message);}
    const owner=scenario!=='readonly';
    if(name==='getOnlineStore'){
      if(scenario==='overlimit')fail('resource-exhausted','Este catálogo exige paginação antes de editar; nenhum produto foi omitido.');
      const s=stores.get(data.spaceId)||null;
      return {data:structuredClone({store:s,products:productsFor(data.spaceId),orders:[],owner,phase:2,checkoutEnabled:s?.checkoutEnabled===true,orderReception:reception(s)})};
    }
    if(name!=='saveOnlineStore')fail('not-found','Função desconhecida.');
    if(!owner)fail('permission-denied','Somente o proprietário pode configurar esta loja.');
    const existing=stores.get(data.spaceId)||null,action=data.action||'save';
    if(action==='set_order_reception'){
      if((existing.revision||0)!==Number(data.revision))fail('aborted','A loja foi alterada em outro aparelho. Recarregue antes de alterar os pedidos.');
      existing.checkoutEnabled=data.enabled;existing.catalogSettings.checkoutEnabled=data.enabled;existing.revision++;publishDoc(existing);
      return {data:structuredClone({store:existing,orderReception:reception(existing)})};
    }
    if(window.__lojaQA.conflictNext){window.__lojaQA.conflictNext=false;existing.revision++;}
    if((existing?.revision||0)!==Number(data.revision||0))fail('aborted','A loja foi alterada em outro aparelho. Recarregue antes de salvar.');
    let settings,slug;try{settings=M.settings(data.settings);slug=M.slug(data.slug);}catch(e){fail('invalid-argument',e.message);}
    if(!settings.publicName)fail('invalid-argument','Informe o nome público da loja.');
    if(action==='save'&&existing&&settings.checkoutEnabled!==existing.checkoutEnabled)fail('failed-precondition','Use o controle de recebimento de pedidos ou confirme uma nova publicação.');
    const owned=slugs.get(slug);if(owned&&owned.storeId!==(existing?.id||`store_${data.spaceId}`))fail('already-exists','Esse link já pertence a outra loja.');
    const ids=data.productIds||[];if(ids.length>400||new Set(ids).size!==ids.length)fail('invalid-argument','Seleção inválida ou acima de 400 itens.');
    const allowed=new Set(productsFor(data.spaceId).map(p=>p.productId));if(ids.some(id=>!allowed.has(id)))fail('failed-precondition','Há produto publicado fora do espaço escolhido ou indisponível. Revise a seleção deste espaço.');
    const presentation=existing?.presentation||{products:{},categories:[],banners:[]};
    for(const id of ids){const p=data.presentation?.products?.[id]||{};presentation.products[id]={...presentation.products[id],featured:p.featured===true,bestseller:p.bestseller===true,order:Math.max(0,Number(p.order)||0),category:String(p.category||'').slice(0,100)};}
    if(Array.isArray(data.presentation?.categories)){const prev=new Map((presentation.categories||[]).map(c=>[c.internalName,c]));for(const c of data.presentation.categories){const n=String(c.internalName||'').trim();if(n)prev.set(n,{...prev.get(n),internalName:n,publicName:String(c.publicName||n),active:c.active!==false,order:Math.max(0,Number(c.order)||0)});}presentation.categories=[...prev.values()];}
    const now=new Date().toISOString(),store={...existing,id:existing?.id||`store_${data.spaceId}`,kind:'space_store',schemaVersion:2,businessId:BUSINESS,spaceId:data.spaceId,publicToken:existing?.publicToken||`qa_public_token_${data.spaceId.replace(/\W/g,'_')}_000000`,slug,catalogSettings:settings,presentation,selectedProductIds:ids,revision:(existing?.revision||0)+1,workspaceGeneration:0,v2Enabled:existing?.v2Enabled===true||action==='publish',activation:existing?.activation||(action==='publish'?{confirmedBy:'qa-owner',confirmedAt:now}:null),createdAt:existing?.createdAt||now,updatedAt:now,published:existing?.published||false,checkoutEnabled:settings.checkoutEnabled};
    if(action==='publish'){if(data.confirmed!==true)fail('failed-precondition','Confirme a publicação.');store.published=data.published!==false;store.publishedProductIds=ids;}
    stores.set(data.spaceId,store);slugs.set(slug,{businessId:BUSINESS,storeId:store.id,catalogToken:store.publicToken});
    if(action==='publish')publishDoc(store);
    return {data:structuredClone({store,replayed:false})};
  };
  window.__lojaQASpaces=spaces;
})();
