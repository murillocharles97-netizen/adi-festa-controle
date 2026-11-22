'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
if (!/^(localhost|127\.0\.0\.1):\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) {
  throw Error('Local Firestore Emulator required');
}
const { initializeTestEnvironment } = require('@firebase/rules-unit-testing');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');
const sdk = require('firebase/firestore');
const root = path.resolve(process.env.VECONI_HOTFIX_SERVICE_ROOT || '.');
const { onlineStoreService } = require(path.join(root, 'functions/src/services/online-store-service'));
const { onlineOrderService } = require(path.join(root, 'functions/src/services/online-order-service'));
const projectId = process.env.GCLOUD_PROJECT || 'demo-veconi-loja-hotfix';

async function lab(name) {
  const env = await initializeTestEnvironment({ projectId, firestore: { rules: fs.readFileSync('firestore.rules','utf8') } });
  const app = initializeApp({projectId},name);
  const db = getFirestore(app), stores = onlineStoreService(db), orders = onlineOrderService(db);
  const close = async()=>{await env.cleanup();await deleteApp(app);};
  const catalogRef = store=>db.doc('publicCatalogs/'+store.publicToken);
  const publicCatalog = async store=>(await sdk.getDoc(sdk.doc(env.unauthenticatedContext().firestore(),'publicCatalogs',store.publicToken))).data();
  return {db,stores,orders,catalogRef,publicCatalog,close};
}

async function shop(v, options={}) {
  const {db,stores} = v;
  const random = randomUUID().slice(0,12), businessId = options.tenant?.businessId || 'shop-'+random;
  const uid = options.tenant?.uid || 'owner-'+random, spaceId = 'space-'+random;
  const doc = db.doc('businesses/'+businessId), slug = 'vitrine-'+random;
  if (!options.tenant) {
    await doc.set({active:true, ownerId:uid, legacyAccessDisabled:true, workspaceGeneration:0,
      subscription:{planId:'internal',status:'active'}});
    await doc.collection('members').doc(uid).set({status:'active',role:'owner',spaceAccess:'all'});
  }
  await db.doc('financialSpaces/'+spaceId).set({businessId, linkedBusinessId:businessId,active:true,
    capabilities:{products:true,sales:true}});
  const request = (data={},actor=uid)=>({auth:{uid:actor},data:{businessId,spaceId,workspaceGeneration:0,...data}});
  const item = async (id, overrides={})=>{
    const ref=doc.collection('products').doc(id);
    await ref.set({id,businessId,workspaceGeneration:0,nome:id,preco:10,estoqueAtual:10,ativo:true,
      spaceAccessMode:'single_space',allowedSpaceIds:[spaceId],...overrides});
    return ref;
  };
  const variant = async (id,parentProductId,overrides={})=>{
    const ref=doc.collection('productVariants').doc(id);
    await ref.set({id,parentProductId,businessId,workspaceGeneration:0,active:true,catalogVisible:true,
      displayName:id,price:15,stock:4,...overrides});
    return ref;
  };
  const settings={publicName:'Vitrine fictícia',pickupEnabled:true,deliveryEnabled:false,paymentMethods:['pix']};
  const change = async (current, update={})=>(await stores.save(request({revision:current?.revision||0,...update}))).store;
  const publish = (current, update={})=>change(current,{action:'publish',confirmed:true,published:true,...update});
  const pause = (current, update={})=>publish(current,{published:false,...update});
  const draft = update=>change(null,{slug,settings,productIds:[],...update});
  const payload = (store,items,overrides={})=>({id:'order-'+randomUUID(),catalogToken:store.publicToken,workspaceGeneration:0,
    orderAccessToken:randomUUID().replace(/-/g,''),customerName:'Pessoa fictícia',customerPhone:'11900000000',
    serviceModeId:'pickup',paymentPreference:'pix',items,...overrides});
  return {businessId,uid,spaceId,doc,slug,settings,request,item,variant,change,publish,pause,draft,payload};
}

module.exports = { lab, shop };
