'use strict';
const {randomBytes,createHash}=require('node:crypto');
const {HttpsError}=require('firebase-functions/v2/https');
const {assertWritable,validId}=require('./workspace-reset-policy');
const {computeAccess}=require('./subscription-service');
const Model=require('../shared/online-store');
const hash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
const fail=(code,message)=>{throw new HttpsError(code,message)};
const storeId=spaceId=>`store_${hash(spaceId).slice(0,32)}`;
const serial=s=>s?.exists?{...s.data(),id:s.id}:null;
function onlineStoreService(db){
  async function context(tx,request,{write=false,ownerOnly=false}={}){
    const {businessId,spaceId,workspaceGeneration=0}=request.data||{},uid=request.auth?.uid;
    if(!uid)fail('unauthenticated','Entre na sua conta.');validId(businessId,'Empresa');validId(spaceId,'Espaço');
    if(['all','all_spaces'].includes(spaceId))fail('invalid-argument','Escolha um espaço específico.');
    const root=db.doc(`businesses/${businessId}`),[b,m,p,s]=await Promise.all([tx.get(root),tx.get(root.collection('members').doc(uid)),tx.get(db.doc(`users/${uid}`)),tx.get(db.doc(`financialSpaces/${spaceId}`))]);
    const business=b.data(),space=s.data(),profile=p.data(),member=m.data()||(!business?.legacyAccessDisabled&&profile?.businessId===businessId&&profile?.active?{...profile,status:'active',spaceAccess:'all'}:null);
    if(!business?.active||member?.status!=='active'||ownerOnly&&member.role!=='owner')fail('permission-denied','Somente o proprietário pode configurar esta loja.');
    if(member.role!=='owner'&&(!member.permissions?.['products.edit']||member.spaceAccess!=='all'&&!(member.allowedSpaceIds||[]).includes(spaceId)))fail('permission-denied','Sem acesso à loja deste espaço.');
    if(!space||space.active===false||(space.businessId||space.linkedBusinessId)!==businessId||space.businessId&&space.linkedBusinessId&&space.businessId!==space.linkedBusinessId||space.capabilities?.products!==true)fail('permission-denied','Espaço não autorizado para catálogo.');
    if(write){assertWritable(business,workspaceGeneration);const access=computeAccess(business.subscription||{});if(!access.canMutate||!access.unlimited&&!access.features?.onlineOrders)fail('permission-denied','Loja online exige plano Gestão ativo.');}
    return {businessId,spaceId,uid,root,business,space,member,workspaceGeneration,ref:root.collection('onlineStores').doc(storeId(spaceId))};
  }
  async function load(request){
    return db.runTransaction(async tx=>{
      const c=await context(tx,request),store=serial(await tx.get(c.ref));
      const productDocs=await tx.get(c.root.collection('products').limit(1001));
      if(productDocs.size>1000)fail('resource-exhausted','Este catálogo exige paginação antes de editar; nenhum produto foi omitido.');
      const products=productDocs.docs.map(serial).filter(p=>Model.allows(p,c.spaceId)).map(p=>Model.product(p));
      let orders=[];
      if(c.member.role==='owner'||c.member.permissions?.['sales.viewAll']===true){const current=await tx.get(c.root.collection('catalogOrders').where('spaceId','==',c.spaceId).limit(101));if(current.size>100)fail('resource-exhausted','Paginação de pedidos necessária.');orders.push(...current.docs.map(serial).filter(o=>o.source==='online_store').map(orderSummary));}
      return {store,products,orders,owner:c.member.role==='owner',phase:2,checkoutEnabled:store?.checkoutEnabled===true};
    });
  }
  const orderSummary=o=>({id:o.id,publicOrderNumber:o.publicOrderNumber||'',total:Number(o.total||0),orderStatus:o.orderStatus||'',spaceId:o.spaceId||null});
  async function save(request){
    const input=request.data||{},action=input.action||'save';
    if(!['save','publish','activate'].includes(action))fail('invalid-argument','Ação inválida.');
    const token=randomBytes(24).toString('hex');
    return db.runTransaction(async tx=>{
      const c=await context(tx,request,{write:true,ownerOnly:true}),existing=serial(await tx.get(c.ref));
      if(['activate','publish'].includes(action)&&input.confirmed!==true)fail('failed-precondition','Confirme a ativação da Loja Online V2 neste espaço.');
      if(!existing&&!['save','activate'].includes(action))fail('failed-precondition','O proprietário deve ativar a Loja Online V2 explicitamente neste espaço.');
      if(existing&&existing.v2Enabled!==true&&!['save','activate','publish'].includes(action))fail('failed-precondition','Loja Online V2 não ativada neste espaço.');
      if((existing?.revision||0)!==Number(input.revision||0))fail('aborted','A loja foi alterada em outro aparelho. Recarregue antes de salvar.');
      let settings,slug;
      try{settings=Model.settings(input.settings||existing?.catalogSettings);slug=Model.slug(input.slug||existing?.slug);}catch(e){fail('invalid-argument',e.message);}
      if(!settings.publicName)fail('invalid-argument','Informe o nome público da loja.');
      if(settings.checkoutEnabled&&!settings.pickupEnabled&&!settings.deliveryEnabled)fail('invalid-argument','Ative entrega ou retirada antes de receber pedidos.');
      const slugRef=db.doc(`publicCatalogSlugs/${slug}`),slugDoc=await tx.get(slugRef);
      if(slugDoc.exists&&(slugDoc.data().businessId!==c.businessId||slugDoc.data().storeId!==c.ref.id))fail('already-exists','Esse link já pertence a outra loja.');
      let ids=input.productIds||existing?.selectedProductIds||[];
      if(!Array.isArray(ids)||ids.length>400||new Set(ids).size!==ids.length)fail('invalid-argument','Seleção inválida ou acima de 400 itens.');
      const products=[];for(const id of ids){validId(id,'Produto');const p=serial(await tx.get(c.root.collection('products').doc(id)));if(!Model.allows(p,c.spaceId))fail('failed-precondition','Há produto publicado fora do espaço escolhido ou indisponível. Revise a seleção deste espaço.');products.push(p);}
      const variantDocs=await tx.get(c.root.collection('productVariants').limit(1001));if(variantDocs.size>1000)fail('resource-exhausted','Variações exigem paginação antes de publicar.');
      const variants=variantDocs.docs.map(serial),timestamp=new Date().toISOString();
      const presentation=existing?.presentation||{products:{},categories:[],banners:[]};
      if(input.presentation){for(const id of ids){const p=input.presentation.products?.[id]||{};presentation.products[id]={...presentation.products[id],featured:p.featured===true,bestseller:p.bestseller===true,order:Math.max(0,Number(p.order)||0),category:String(p.category||'').slice(0,100)};}}
      if(Array.isArray(input.presentation?.categories)){
        const previous=new Map((presentation.categories||[]).map(c=>[c.internalName,c]));
        for(const category of input.presentation.categories.slice(0,100)){const name=String(category.internalName||'').trim().slice(0,100);if(name)previous.set(name,{...previous.get(name),internalName:name,publicName:String(category.publicName||name).slice(0,100),active:category.active!==false,order:Math.max(0,Number(category.order)||0)});}
        presentation.categories=[...previous.values()];
      }
      const store={...existing,v2Enabled:existing?.v2Enabled===true||action==='activate'||action==='publish',activation:existing?.activation||((action==='activate'||action==='publish')?{confirmedBy:c.uid,confirmedAt:timestamp,mode:'manual_space_activation'}:null),id:c.ref.id,kind:'space_store',schemaVersion:2,businessId:c.businessId,spaceId:c.spaceId,publicToken:existing?.publicToken||token,slug,catalogSettings:settings,presentation,selectedProductIds:ids,revision:(existing?.revision||0)+1,workspaceGeneration:c.workspaceGeneration,actorUid:c.uid,createdAt:existing?.createdAt||timestamp,updatedAt:timestamp,published:existing?.published||false,checkoutEnabled:settings.checkoutEnabled};
      // Keep the LIVE selection independent of an unpublished draft. Compatibility
      // reads are scoped to this existing V2 public token, never to legacy catalogs.
      if(action==='publish')store.publishedProductIds=ids;
      else if(existing?.published&&!Array.isArray(existing.publishedProductIds)){
        const live=(await tx.get(db.doc(`publicCatalogs/${existing.publicToken}`))).data();
        if(live?.schemaVersion===6&&live.catalogType==='space_store'&&live.businessId===c.businessId&&live.spaceId===c.spaceId&&live.workspaceGeneration===c.workspaceGeneration)
          store.publishedProductIds=[...new Set((live.items||[]).map(item=>item.productId))];
      }
      if(action==='publish')store.published=input.published!==false;
      if(Buffer.byteLength(JSON.stringify(store),'utf8')>850000)fail('resource-exhausted','Esta loja excede o limite seguro de configuração. Nada foi truncado; reduza a publicação ou use paginação.');
      // All reads precede writes. Only V2 aliases are retained.
      tx.set(c.ref,store);
      tx.set(slugRef,{businessId:c.businessId,storeId:c.ref.id,catalogToken:store.publicToken,workspaceGeneration:c.workspaceGeneration});
      if(action==='publish'){
        tx.set(db.doc(`catalogStoreBindings/${store.publicToken}`),{businessId:c.businessId,spaceId:c.spaceId,storeId:c.ref.id,workspaceGeneration:c.workspaceGeneration,status:'completed'},{merge:true});
        const items=products.map(p=>Model.product(p,variants,presentation)).sort((a,b)=>a.displayOrder-b.displayOrder);
        const publicPresentation=Model.publicPresentation(presentation);
        if(settings.bannerUrl)publicPresentation.banners.unshift({id:'store-brand-banner',title:settings.publicName,subtitle:settings.welcomeText,imageUrl:settings.bannerUrl,active:true,order:-1});
        tx.set(db.doc(`publicCatalogs/${store.publicToken}`),{catalogToken:store.publicToken,documentId:store.publicToken,schemaVersion:6,catalogType:'space_store',businessId:c.businessId,spaceId:c.spaceId,visitId:store.id,publicName:settings.publicName,...settings,publicSettings:settings,items,...publicPresentation,active:store.published,catalogVisible:store.published,acceptingOrders:store.published&&store.checkoutEnabled,serviceModes:[...(settings.pickupEnabled?[{id:'pickup',type:'pickup',label:'Retirada',active:true}]:[]),...(settings.deliveryEnabled?[{id:'delivery',type:'delivery',label:'Entrega',active:true}]:[])],closedBehavior:'view_only',status:store.checkoutEnabled?'active':'paused',workspaceGeneration:c.workspaceGeneration,revision:store.revision,updatedAt:timestamp});
      }
      return {store,replayed:false};
    });
  }
  return {load,save};
}
module.exports={onlineStoreService,storeId};
