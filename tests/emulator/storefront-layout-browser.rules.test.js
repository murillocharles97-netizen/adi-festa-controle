'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {lab,shop}=require('../helpers/online-shop-hotfix.cjs');
const kit=require('../../scripts/loja-qa-kit.cjs');
test('merchant UI persists layout through saveOnlineStore and publishes only the approved slides',async()=>{
  const v=await lab('vitrine-viva-browser'),server=await kit.serve(),browser=await kit.launch();
  try{
    const s=await shop(v);await s.item('qa-0001');
    const original=await s.publish(await s.draft({productIds:['qa-0001']}));
    const before=await v.publicCatalog(original);
    const {page}=await kit.openAdmin(browser,server.base,{width:390,theme:'dark'});
    await page.exposeFunction('vivaCall',async(name,input)=>{
      assert.equal(input.businessId,s.businessId);assert.equal(input.spaceId,s.spaceId);
      const service=name==='getOnlineStore'?v.stores.load:v.stores.save;
      return {data:await service(s.request(input))};
    });
    await page.exposeFunction('vivaPublished',()=>v.publicCatalog(original));
    await page.evaluate(async ({businessId,spaceId,uid})=>{
      window.BusinessContext.getCurrentBusinessId=()=>businessId;
      window.FirebaseSession.user.uid=uid;
      window.SpaceContext.salesSpaces=()=>[{id:spaceId,name:'Loja emulador'}];
      window.FirebaseCallable=window.vivaCall;window.FirebasePublicCatalogReader=window.vivaPublished;
      document.querySelector('#app').innerHTML=OnlineStoreUI.render();await OnlineStoreUI.bind();
    },{businessId:s.businessId,spaceId:s.spaceId,uid:s.uid});
    const click=sel=>page.$eval(sel,b=>b.click());
    await click('[data-v="layout"]');await page.waitForSelector('[data-slide-action="save"]');
    await click('[data-slide-action="add"]');await click('[data-slide-model="offers"]');
    await page.$eval('[data-slide-field="title"]',el=>{el.value='Privado no emulador';el.dispatchEvent(new Event('input',{bubbles:true}));});
    await click('[data-slide-field="active"]');await click('[data-slide-action="save"]');
    await page.waitForFunction(()=>document.querySelector('.lo-savebar')?.textContent.includes('Rascunho salvo'));
    const loaded=await v.stores.load(s.request());
    assert.equal(loaded.store.presentation.storefrontLayout.slides[1].title,'Privado no emulador');
    assert.deepEqual(before,await v.publicCatalog(original));
    await click('[data-act="ask-publish"]');await click('[data-act="do-publish"]');
    await page.waitForFunction(()=>document.querySelector('.lo-toast')?.textContent.includes('Loja publicada'));
    const live=await v.publicCatalog(original);
    assert.equal(live.storefrontLayout.slides.length,1);assert.doesNotMatch(JSON.stringify(live),/Privado no emulador/);
    await page.close();
  }finally{await browser.close();server.server.close();await v.close();}
});
