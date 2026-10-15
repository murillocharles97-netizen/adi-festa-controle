'use strict';
const {Timestamp}=require('firebase-admin/firestore');
const Model=require('../shared/online-store');
const {validId,belongsToWorkspace}=require('./workspace-reset-policy');
const {projectInWorkspace}=require('./workspace-projection');

// Stock events never publish a store or copy private product data. Event snapshots
// select the original generation/parent only; the transaction reads CURRENT stock.
function stockChanged(kind,before,after){
  const fingerprint=p=>!p?null:[p.workspaceGeneration??0,p.active!==false,p.ativo!==false,!!p.deleted,!!p.deletedAt,
    p.onlineReservedStock??0,kind==='variant'?p.stock??0:p.estoqueAtual??0,
    !!p.allowNegativeStock,kind==='variant'?p.parentProductId||null:p.productType||'simple',
    kind==='variant'?p.catalogVisible!==false:[p.spaceAccessMode||'all_spaces',[...(p.allowedSpaceIds||[])].sort(),
      p.itemKind||'product',!!p.semControleEstoque,p.controlaEstoque!==false]];
  return JSON.stringify(fingerprint(before))!==JSON.stringify(fingerprint(after));
}
function patchAvailability(item,product,variants,store){
  const eligible=!!Model.allows(product,store.spaceId),ownerPublished=item.ownerPublished??item.active!==false,live=eligible&&ownerPublished;
  const quantity=(p,field)=>{
    const n=Model.availableQuantity(p,field);
    if(!Number.isFinite(n))throw Error('Invalid canonical stock; public projection not written');
    return n;
  };
  const controls=eligible&&product.itemKind!=='service'&&product.productType!=='recurring'&&!product.semControleEstoque&&product.controlaEstoque!==false;
  const next={...item,ownerPublished,active:live,controlaEstoque:controls,allowNegativeStock:eligible&&!!product.allowNegativeStock,
    availableQuantity:live?quantity(product,'estoqueAtual'):0};
  // Only variants already published by the owner are updated. No new catalog items.
  if(item.productType==='variable'){
    next.variants=(item.variants||[]).map(v=>{
      const current=variants.get(v.variantId||v.id),valid=live&&Model.active(current)&&current.parentProductId===item.productId&&current.catalogVisible!==false;
      return {...v,active:!!valid,catalogVisible:!!valid,availableQuantity:valid?quantity(current,'stock'):0,
        allowNegativeStock:!!valid&&!!current.allowNegativeStock};
    });
    next.availableQuantity=next.variants.reduce((sum,v)=>sum+v.availableQuantity,0);
  }
  // availableQuantity is already NET of reservations (the public UI must not subtract twice).
  delete next.reservedStock;
  return next;
}
function onlineStoreStockProjection(db){
  async function projectStore(businessId,storeRef,productId,source){
    return projectInWorkspace(db,businessId,source,async tx=>{
      const store=(await tx.get(storeRef)).data(),generation=source?.workspaceGeneration??0;
      if(!store||store.businessId!==businessId||store.kind!=='space_store'||store.v2Enabled!==true||store.published!==true||
        store.workspaceGeneration!==generation||!(store.publishedProductIds||store.selectedProductIds)?.includes(productId)||!/^[-a-zA-Z0-9_]{3,128}$/.test(store.spaceId||'')||
        !/^[a-f0-9]{48}$/.test(store.publicToken||''))return {skipped:'store-not-published-v2'};
      const publicRef=db.doc(`publicCatalogs/${store.publicToken}`);
      const [publicSnap,bindingSnap,spaceSnap,productSnap]=await tx.getAll(publicRef,db.doc(`catalogStoreBindings/${store.publicToken}`),
        db.doc(`financialSpaces/${store.spaceId}`),db.doc(`businesses/${businessId}/products/${productId}`));
      const catalog=publicSnap.data(),binding=bindingSnap.data(),space=spaceSnap.data(),product=productSnap.data();
      if(!catalog||catalog.legacyStoreRetired||catalog.schemaVersion!==6||catalog.catalogType!=='space_store'||catalog.active!==true||
        catalog.businessId!==businessId||catalog.spaceId!==store.spaceId||catalog.visitId!==storeRef.id||catalog.workspaceGeneration!==generation||
        !Array.isArray(catalog.items)||binding?.status!=='completed'||binding.businessId!==businessId||binding.spaceId!==store.spaceId||
        binding.storeId!==storeRef.id||binding.workspaceGeneration!==generation||!belongsToWorkspace(space,businessId)||
        space.active===false||space.capabilities?.products!==true)return {skipped:'public-scope-mismatch'};
      if(product&&(product.businessId&&product.businessId!==businessId||(product.workspaceGeneration??0)!==generation))return {skipped:'product-generation-mismatch'};
      const matching=catalog.items.filter(item=>item.productId===productId);
      if(!matching.length)return {skipped:'product-not-published'};
      const ids=[...new Set(matching.flatMap(item=>(item.variants||[]).map(v=>v.variantId||v.id)))];
      ids.forEach(id=>validId(id,'Variação'));
      const snapshots=ids.length?await tx.getAll(...ids.map(id=>db.doc(`businesses/${businessId}/productVariants/${id}`))):[];
      const variants=new Map(snapshots.filter(s=>s.exists&&(s.data().workspaceGeneration??0)===generation&&(!s.data().businessId||s.data().businessId===businessId)).map(s=>[s.id,s.data()]));
      const items=catalog.items.map(item=>item.productId===productId?patchAvailability(item,product,variants,store):item);
      if(JSON.stringify(items)===JSON.stringify(catalog.items))return {skipped:'already-current'};
      tx.update(publicRef,{items,availabilityUpdatedAt:Timestamp.now()});
      return {applied:true,spaceId:store.spaceId};
    });
  }
  async function project({businessId,productId,source}){
    validId(businessId,'Empresa');validId(productId,'Produto');
    // Indexed live-selection query plus compatibility query, both paginated.
    // Never scan global catalogs or the product collection.
    let updated=0,checked=0;
    for(const field of ['publishedProductIds','selectedProductIds']){
      const query=db.collection(`businesses/${businessId}/onlineStores`).where(field,'array-contains',productId);
      let cursor=null;
      do{
        const page=await (cursor?query.startAfter(cursor):query).limit(100).get();
        for(const s of page.docs){
          if(field==='selectedProductIds'&&Array.isArray(s.data().publishedProductIds))continue;
          // Cheap candidate check; all authorization/generation checks repeated inside tx.
          if(s.data().v2Enabled!==true||s.data().published!==true)continue;
          const result=await projectStore(businessId,s.ref,productId,source);checked++;if(result.applied)updated++;
        }
        cursor=page.size===100?page.docs.at(-1):null;
      }while(cursor);
    }
    return {updated,checked};
  }
  async function handle({businessId,documentId,kind,before,after}){
    if(!stockChanged(kind,before,after))return {updated:0,checked:0,skipped:'unrelated-change'};
    const targets=new Map();
    if(kind==='variant'){
      if(before?.parentProductId)targets.set(before.parentProductId,before);
      if(after?.parentProductId)targets.set(after.parentProductId,after);
    }else targets.set(documentId,after||before);
    let updated=0,checked=0;
    for(const [productId,source]of targets){const result=await project({businessId,productId,source});updated+=result.updated;checked+=result.checked;}
    return {updated,checked};
  }
  return {handle,project};
}
module.exports={onlineStoreStockProjection,stockChanged,patchAvailability};
