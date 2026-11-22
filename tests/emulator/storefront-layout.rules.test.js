'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {lab,shop}=require('../helpers/online-shop-hotfix.cjs');
const K=require('../../js/loja/store-kit.js');
let v;
test.before(async()=>{v=await lab('vitrine-viva');});
test.after(async()=>{await v?.close();});
function layout(){
  return {version:1,slides:[K.bannerSlide(),{...K.bannerSlide('offers'),title:'Privado',active:false}],
    featured:true,secondary:{...K.bannerSlide('easy'),title:'Campanha futura',active:false}};
}
test('layout capability is read-only and scoped to the owner',async()=>{
  const s=await shop(v),other=await shop(v);
  const request=s.request({action:'layout_support'});
  assert.deepEqual(await v.stores.save(request),{storefrontLayoutVersion:1});
  assert.ok((await s.doc.collection('onlineStores').get()).empty);
  await assert.rejects(v.stores.save(s.request({action:'layout_support'},other.uid)),{code:'permission-denied'});
});
test('save, publish, pause, resume and old clients keep draft and active banners separate',async()=>{
  const s=await shop(v),first=layout(),d=await s.draft({presentation:{storefrontLayout:first}});
  assert.equal(await v.publicCatalog(d),undefined);
  const pub=await s.publish(d),live=await v.publicCatalog(pub);
  assert.equal(live.storefrontLayout.slides.length,1);
  assert.doesNotMatch(JSON.stringify(live),/Privado|Campanha futura/);
  const changed=layout();changed.slides[0].title='Segunda edição';changed.slides.reverse();
  const saved=await s.change(pub,{presentation:{storefrontLayout:changed}});
  assert.deepEqual((await v.publicCatalog(saved)).storefrontLayout,live.storefrontLayout);
  const resume=await s.publish(await s.pause(saved));
  assert.deepEqual((await v.publicCatalog(resume)).storefrontLayout,live.storefrontLayout);
  const final=await s.publish(resume,{presentation:{products:{},categories:[]}});
  assert.equal((await v.publicCatalog(final)).storefrontLayout.slides[0].title,'Segunda edição');
  assert.deepEqual(final.presentation.storefrontLayout,changed);
});
test('banner media is scoped by bucket, business, space and slot before the revision changes',async()=>{
  const s=await shop(v),other=await shop(v,{tenant:s}),d=await s.draft();
  const asset=(scope,bucket=process.env.GCLOUD_PROJECT+'.appspot.com')=>'https://firebasestorage.googleapis.com/v0/b/'+bucket+'/o/'+encodeURIComponent('businesses/'+s.businessId+'/catalog/spaces/'+scope+'/banner/main-1234.webp')+'?alt=media';
  const value=layout();
  for(const url of [asset(other.spaceId),asset(s.spaceId,'other.appspot.com'),'data:image/png;base64,abc']){
    value.slides[0].imageUrl=url;
    await assert.rejects(s.change(d,{presentation:{storefrontLayout:value}}),{code:'invalid-argument'});
  }
  value.slides[0].imageUrl=asset(s.spaceId);
  value.home={search:false,placeholder:'Busca futura',featuredTitle:'Título privado'};value.featured=false;
  const result=await s.change(d,{presentation:{storefrontLayout:value}});
  assert.equal(result.revision,d.revision+1);
  const published=await s.publish(result), doc=await v.publicCatalog(published);
  assert.deepEqual(doc.storefrontLayout.home,{search:false,placeholder:'',featuredTitle:''});
  assert.equal(doc.storefrontLayout.slides[0].imageUrl,value.slides[0].imageUrl);
  value.slides[0].target='invalid';
  await assert.rejects(s.change(published,{presentation:{storefrontLayout:value}}),{code:'invalid-argument'});
  await assert.rejects(s.change(d,{presentation:{storefrontLayout:layout()}}),{code:'aborted'});
});