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
    if(!business?.active||member?.status!=='active'||ownerOnly&&member.role!=='owner')fail('permission-denied','Somente o proprietário pode migrar lojas antigas.');
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
      // Legacy choice is owner-only and never inferred from customer/product names.
      const legacy=c.member.role==='owner'?await tx.get(db.collection('publicCatalogs').where('businessId','==',c.businessId).limit(101)):null;
      if(legacy?.size>100)fail('resource-exhausted','Revisão paginada do legado necessária.');
      const catalogs=[];for(const snap of legacy?.docs||[]){const v=snap.data();if(v.legacyRedirect)continue;const binding=await tx.get(db.doc(`catalogStoreBindings/${snap.id}`));if(!binding.exists)catalogs.push({token:snap.id,name:v.publicName||v.nome||'Loja antiga',count:(v.items||[]).length,revision:hash(v),acceptingOrders:v.acceptingOrders===true||v.closedBehavior==='accept_for_later'});}
      let orders=[],legacyOrders=[];
      if(store?.publicToken&&(c.member.role==='owner'||c.member.permissions?.['sales.viewAll']===true)){const docs=await tx.get(db.collection(`publicCatalogs/${store.publicToken}/orders`).limit(101));if(docs.size>100)fail('resource-exhausted','Esta loja precisa de paginação de pedidos; nenhum total parcial será apresentado.');orders=docs.docs.map(serial).filter(o=>o.businessId===c.businessId&&o.spaceId===c.spaceId).map(orderSummary);if(c.member.role==='owner')legacyOrders=docs.docs.map(serial).filter(o=>o.businessId===c.businessId&&!o.spaceId).map(orderSummary);}
      if(c.member.role==='owner'||c.member.permissions?.['sales.viewAll']===true){const current=await tx.get(c.root.collection('catalogOrders').where('spaceId','==',c.spaceId).limit(101));if(current.size>100)fail('resource-exhausted','Paginação de pedidos necessária.');orders.push(...current.docs.map(serial).filter(o=>o.source==='online_store').map(orderSummary));}
      return {store,products,legacyCatalogs:catalogs,orders,legacyOrders,owner:c.member.role==='owner',phase:2,checkoutEnabled:store?.checkoutEnabled===true};
    });
  }
  const orderSummary=o=>({id:o.id,publicOrderNumber:o.publicOrderNumber||'',total:Number(o.total||0),orderStatus:o.orderStatus||'',spaceId:o.spaceId||null});
  async function save(request){
    const input=request.data||{},action=input.action||'save';
    if(!['save','migrate','publish','activate','pause_legacy'].includes(action))fail('invalid-argument','Ação inválida.');
    const token=randomBytes(24).toString('hex');
    return db.runTransaction(async tx=>{
      const c=await context(tx,request,{write:true,ownerOnly:['migrate','activate','pause_legacy'].includes(action)}),existing=serial(await tx.get(c.ref));
      if(action==='pause_legacy'){
        if(input.confirmed!==true||!/^[A-Za-z0-9_-]{20,128}$/.test(input.legacyToken||''))fail('failed-precondition','Confirme a pausa da loja antiga selecionada.');
        const ref=db.doc(`publicCatalogs/${input.legacyToken}`),snap=await tx.get(ref),old=snap.data(),bound=await tx.get(db.doc(`catalogStoreBindings/${input.legacyToken}`));
        if(!old||old.businessId!==c.businessId||old.legacyRedirect||bound.exists)fail('permission-denied','Loja antiga não autorizada.');
        if(old.acceptingOrders===false&&old.closedBehavior==='view_only')return {legacyPaused:true,replayed:true};
        if(input.legacyRevision!==hash(old))fail('aborted','A loja antiga mudou. Reabra a revisão.');
        tx.update(ref,{acceptingOrders:false,closedBehavior:'view_only',legacyPause:{actorUid:c.uid,at:new Date().toISOString(),reason:'owner_migration_review'}});
        return {legacyPaused:true,businessId:c.businessId,spaceId:c.spaceId};
      }
      if(action==='activate'&&input.confirmed!==true)fail('failed-precondition','Confirme a ativação da Loja Online V2 neste espaço.');
      if(!existing&&!['activate','migrate'].includes(action))fail('failed-precondition','O proprietário deve ativar a Loja Online V2 explicitamente neste espaço.');
      if(existing&&existing.v2Enabled!==true&&action!=='activate')fail('failed-precondition','Loja Online V2 não ativada neste espaço.');
      let legacy=null,bindingRef=null,aliasRefs=[];
      if(action==='migrate'){
        if(input.confirmed!==true)fail('failed-precondition','Confirme a qual espaço esta loja antiga pertence.');
        if(!/^[A-Za-z0-9_-]{20,128}$/.test(input.legacyToken||''))fail('invalid-argument','Loja antiga inválida.');
        bindingRef=db.doc(`catalogStoreBindings/${input.legacyToken}`);const binding=await tx.get(bindingRef);
        if(binding.exists){if(binding.data().businessId!==c.businessId||binding.data().spaceId!==c.spaceId)fail('already-exists','Esta loja já foi vinculada a outro espaço.');return {store:existing,replayed:true};}
        if(existing)fail('already-exists','Este espaço já possui uma loja. Nada foi sobrescrito.');
        const snap=await tx.get(db.doc(`publicCatalogs/${input.legacyToken}`));legacy=snap.data();
        if(!legacy||legacy.businessId!==c.businessId||legacy.legacyRedirect)fail('permission-denied','Loja antiga não pertence à empresa.');
        if(input.legacyRevision!==hash(legacy))fail('aborted','O catálogo mudou. Reabra a revisão antes de confirmar.');
        if(legacy.acceptingOrders===true||legacy.closedBehavior==='accept_for_later')fail('failed-precondition','Esta loja ainda recebe pedidos pelo fluxo antigo. A migração aguarda o checkout V2 para não interromper sua operação. Nada foi alterado.');
        const legacyOrders=await tx.get(db.collection(`publicCatalogs/${input.legacyToken}/orders`).limit(101));
        if(legacyOrders.size>100)fail('resource-exhausted','Revisão paginada dos pedidos antigos necessária antes da migração.');
        if(legacyOrders.docs.some(d=>!['entregue','cancelado'].includes(d.data().orderStatus)))fail('failed-precondition','Esta loja possui pedidos em atendimento. Conclua-os no fluxo antigo antes de migrar; nenhum pedido foi alterado.');
        const publishedItems=(legacy.items||[]).filter(i=>i.active!==false);
        if(new Set(publishedItems.map(i=>i.productId)).size!==publishedItems.length)fail('failed-precondition','O catálogo tem múltiplas publicações do mesmo produto. Revise antes de migrar; nenhum item será descartado.');
        // Only explicit old redirects are aliases; never infer another catalog by name/products.
        const aliases=await tx.get(db.collection('publicCatalogs').where('businessId','==',c.businessId).limit(101));
        if(aliases.size>100)fail('resource-exhausted','Revisão paginada dos links antigos necessária antes da migração.');
        for(const alias of aliases.docs){if(alias.data().legacyRedirect!==true||alias.data().universalCatalogToken!==input.legacyToken)continue;
          const ref=db.doc(`catalogStoreBindings/${alias.id}`),bound=await tx.get(ref);
          if(bound.exists&&(bound.data().businessId!==c.businessId||bound.data().spaceId!==c.spaceId))fail('failed-precondition','Um link antigo possui vínculo conflitante. Nada foi migrado.');
          aliasRefs.push(ref);
        }
      }else if((existing?.revision||0)!==Number(input.revision||0))fail('aborted','A loja foi alterada em outro aparelho. Recarregue antes de salvar.');
      let settings,slug;
      try{settings=Model.settings(action==='migrate'?{...legacy.publicSettings,...legacy}:input.settings||existing?.catalogSettings);slug=Model.slug(input.slug||existing?.slug);}catch(e){fail('invalid-argument',e.message);}
      if(!settings.publicName)fail('invalid-argument','Informe o nome público da loja.');
      if(settings.checkoutEnabled&&!settings.pickupEnabled&&!settings.deliveryEnabled)fail('invalid-argument','Ative entrega ou retirada antes de receber pedidos.');
      const slugRef=db.doc(`publicCatalogSlugs/${slug}`),slugDoc=await tx.get(slugRef);
      if(slugDoc.exists&&(slugDoc.data().businessId!==c.businessId||slugDoc.data().storeId!==c.ref.id))fail('already-exists','Esse link já pertence a outra loja.');
      let ids=action==='migrate'?[...new Set((legacy.items||[]).filter(i=>i.active!==false).map(i=>i.productId))]:input.productIds||existing?.selectedProductIds||[];
      if(!Array.isArray(ids)||ids.length>400||new Set(ids).size!==ids.length)fail('invalid-argument','Seleção inválida ou acima de 400 itens.');
      const products=[];for(const id of ids){validId(id,'Produto');const p=serial(await tx.get(c.root.collection('products').doc(id)));if(!Model.allows(p,c.spaceId))fail('failed-precondition','Há produto publicado fora do espaço escolhido ou indisponível. Revise sem migrar automaticamente.');products.push(p);}
      const variantDocs=await tx.get(c.root.collection('productVariants').limit(1001));if(variantDocs.size>1000)fail('resource-exhausted','Variações exigem paginação antes de publicar.');
      const variants=variantDocs.docs.map(serial),timestamp=new Date().toISOString();
      const presentation=action==='migrate'?Model.legacyPresentation(legacy):existing?.presentation||{products:{},categories:[],banners:[]};
      if(action!=='migrate'&&input.presentation){for(const id of ids){const p=input.presentation.products?.[id]||{};presentation.products[id]={...presentation.products[id],featured:p.featured===true,bestseller:p.bestseller===true,order:Math.max(0,Number(p.order)||0),category:String(p.category||'').slice(0,100)};}}
      if(action!=='migrate'&&Array.isArray(input.presentation?.categories)){
        const previous=new Map((presentation.categories||[]).map(c=>[c.internalName,c]));
        for(const category of input.presentation.categories.slice(0,100)){const name=String(category.internalName||'').trim().slice(0,100);if(name)previous.set(name,{...previous.get(name),internalName:name,publicName:String(category.publicName||name).slice(0,100),active:category.active!==false,order:Math.max(0,Number(category.order)||0)});}
        presentation.categories=[...previous.values()];
      }
      const store={...existing,v2Enabled:true,activation:existing?.activation||{confirmedBy:c.uid,confirmedAt:timestamp,mode:'manual_space_pilot'},id:c.ref.id,kind:'space_store',schemaVersion:2,businessId:c.businessId,spaceId:c.spaceId,publicToken:existing?.publicToken||(action==='migrate'?input.legacyToken:token),slug,catalogSettings:settings,presentation,selectedProductIds:ids,revision:(existing?.revision||0)+1,workspaceGeneration:c.workspaceGeneration,actorUid:c.uid,createdAt:existing?.createdAt||timestamp,updatedAt:timestamp,published:existing?.published||false,checkoutEnabled:settings.checkoutEnabled};
      if(action==='migrate')store.migration={status:'completed',catalogToken:input.legacyToken,confirmedBy:c.uid,confirmedAt:timestamp,legacyRevision:input.legacyRevision,ordersPolicy:'explicit_assignment_only',originalPublicSettings:legacy.publicSettings||{},originalItems:legacy.items||[],originalConfiguration:legacy};
      if(action==='publish')store.published=input.published!==false;
      if(Buffer.byteLength(JSON.stringify(store),'utf8')>850000)fail('resource-exhausted','O legado excede o limite seguro para esta migração. Nada foi truncado ou alterado; uma migração paginada é necessária.');
      // All reads precede writes; aliases retain the same token forever.
      tx.set(c.ref,store);
      tx.set(slugRef,{businessId:c.businessId,storeId:c.ref.id,catalogToken:store.publicToken,workspaceGeneration:c.workspaceGeneration});
      if(bindingRef)tx.create(bindingRef,{businessId:c.businessId,spaceId:c.spaceId,storeId:c.ref.id,workspaceGeneration:c.workspaceGeneration,confirmedBy:c.uid,confirmedAt:timestamp,status:'completed'});
      for(const ref of aliasRefs)tx.set(ref,{businessId:c.businessId,spaceId:c.spaceId,storeId:c.ref.id,canonicalToken:store.publicToken,workspaceGeneration:c.workspaceGeneration,confirmedBy:c.uid,confirmedAt:timestamp,status:'completed'});
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
