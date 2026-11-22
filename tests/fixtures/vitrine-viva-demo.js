// Loopback fixture. Only the public snapshot is passed to the public iframe.
(() => {
  const qa=window.__lojaQA, store=qa.stores.get('qa-space-a'), publicDoc=qa.publicDocs.get(store.publicToken);
  const kit=StoreKit, layout={version:1,slides:[kit.bannerSlide(),kit.bannerSlide('arrivals'),kit.bannerSlide('featured')],
    featured:true,secondary:{...kit.bannerSlide('easy'),title:'Escolha os seus favoritos',button:'Montar carrinho',active:true}};
  if(new URLSearchParams(location.search).has('papelaria')){
    store.catalogSettings.publicName='Papelaria Prisma';store.catalogSettings.primaryColor='#3466b7';store.catalogSettings.secondaryColor='#142f4f';
    Object.assign(publicDoc,store.catalogSettings,{welcomeText:'Papéis, cadernos e acessórios de escrita.'});
    publicDoc.items.forEach((p,i)=>Object.assign(p,{productName:['Caderno pontilhado','Estojo de lona','Papel colorido','Marcador'][i%4]+' '+(i+1),productImage:'',category:'Papelaria'}));
  }
  publicDoc.storefrontLayout=structuredClone(layout); store.presentation.storefrontLayout=structuredClone(layout);
  const demoOrders=['recebido','confirmado','entregue','cancelado'].map((status,i)=>({
    schemaVersion:2,source:'online_store',spaceId:store.spaceId,businessId:store.businessId,spaceName:publicDoc.publicName,
    id:'order-qa-'+i,publicOrderNumber:'VC-QA00'+(i+1),orderStatus:status,createdAt:new Date(Date.now()-i*1000000).toISOString(),
    statusHistory:[{status,at:new Date().toISOString()}],customerName:['Beatriz QA','Rafael QA','Ana QA','Clara QA'][i],
    customerPhone:'(11) 90000-0000',serviceModeType:i%2?'delivery':'pickup',serviceModeLabel:i%2?'Entrega':'Retirada',
    paymentPreference:'pix',items:[{name:publicDoc.items[0].productName,quantity:2,unitPrice:3.5,subtotal:7}],total:7,revision:1
  }));
  const data={produtos:qa.raw,variacoesProdutos:qa.variants,clientes:[],catalogOrders:demoOrders};
  window.DB={carregar:()=>data,readForView:()=>data,getWorkspaceGeneration:()=>0};
  window.BusinessContext={getCurrentBusinessId:()=>store.businessId};window.FirebaseSession={user:{uid:'qa-owner'},businessId:store.businessId};
  window.SpaceContext={salesSpaces:()=>window.__lojaQASpaces,salesId:()=>store.spaceId};
  window.Visitas={canReadOrder:()=>true};window.TeamAccess={has:()=>true};
  window.Utils={toast:message=>console.info(message)};window.OnlineStorePreviewUrl='/catalogo.html?preview=1';
  window.ProductImages={processImage:async file=>file};
  window.CatalogImageStorage={upload:async(scope,slot,file)=>({imageUrl:await new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;reader.readAsDataURL(file);
  })})};
  const frame=document.querySelector('#vitrine'),workspace=document.querySelector('#workspace');
  function showLive(){
    const live=qa.publicDocs.get(store.publicToken);
    if(!live.active){frame.hidden=true;workspace.hidden=false;workspace.textContent='A loja fictícia está pausada.';return;}
    frame.contentWindow?.postMessage({type:'veconi-store-preview',catalog:live},location.origin);
  }
  addEventListener('message',e=>{if(e.origin===location.origin&&e.source===frame.contentWindow&&e.data?.type==='veconi-store-preview-ready')showLive();});
  function show(view){
    for(const b of document.querySelectorAll('[data-view]'))b.setAttribute('aria-pressed',String(b.dataset.view===view));
    frame.hidden=view!=='public';workspace.hidden=view==='public';
    if(view==='public'){if(!frame.getAttribute('src'))frame.src='/catalogo.html?preview=1';else showLive();return;}
    if(view==='orders'){workspace.innerHTML=OnlineOrdersUI.render();OnlineOrdersUI.bind();return;}
    workspace.innerHTML=OnlineStoreUI.render();OnlineStoreUI.bind();
  }
  document.querySelector('.demo-nav').onclick=e=>{const b=e.target.closest('button');if(!b)return;
    if(b.dataset.view)show(b.dataset.view);
    else{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';b.textContent=dark?'Tema claro':'Tema escuro';}
  };
  show('public');
})();
