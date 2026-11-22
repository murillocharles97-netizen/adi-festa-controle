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
test('Pedidos Online confirma e cancela pedido fictício no emulador nos dois temas',async()=>{
  const v=await lab('vitrine-orders-browser'),server=await kit.serve(),browser=await kit.launch();
  try{
    for(const theme of ['light','dark']){
      const s=await shop(v);
      const item=await s.item('qa-0001');
      const store=await s.publish(await s.draft({productIds:['qa-0001']}),{settings:{...s.settings,checkoutEnabled:true}});
      const payload=s.payload(store,[{catalogItemId:'catalog-qa-0001',quantity:2}],{expectedTotal:20});
      const {order}=await v.orders.submit({data:payload});
      assert.equal((await item.get()).data().onlineReservedStock,2);
      const {page}=await kit.openAdmin(browser,server.base,{width:390,theme});
      const other=await shop(v);
      await page.exposeFunction('changeFictitiousOrder',async(name,data)=>{
        assert.equal(name,'changeOnlineOrderStatus');
        assert.equal(data.businessId,s.businessId);
        return {data:await v.orders.change(s.request(data))};
      });
      const operationalScripts=['functions/src/shared/online-order.js','js/online-order-finalization.js','js/online-orders-ui.js'];
      await page.evaluate(({s,order,other})=>{
        window.BusinessContext.getCurrentBusinessId=()=>s.businessId;
        window.SpaceContext.salesSpaces=()=>[{id:s.spaceId,name:'Vitrine fictícia'}];
        window.Visitas={canReadOrder:()=>true};
        window.TeamAccess={has:()=>true};
        let current={...order,businessId:s.businessId,spaceId:s.spaceId};
        window.DB.readForView=()=>({clientes:[],catalogOrders:[current,{...current,id:'qa-foreign',businessId:other.businessId}]});
        window.FirebaseCallable=window.changeFictitiousOrder;
        window.SyncFirebase={applyOnlineOrderResult:o=>{current=o;},refreshOnlineOrderStock:async()=>{}};
      },{s:{businessId:s.businessId,spaceId:s.spaceId},order,other:{businessId:other.businessId}});
      for(const script of operationalScripts)await page.addScriptTag({url:server.base+'/'+script});
      await page.evaluate(()=>{
        document.querySelector('#app').innerHTML=OnlineOrdersUI.render();
        OnlineOrdersUI.bind();
      });
      assert.equal(await page.$$eval('[data-order]',rows=>rows.length),1);
      const click=sel=>page.$eval(sel,b=>b.click());
      await click('[data-order]');
      await click('[data-order-status="confirmado"]');
      await page.waitForSelector('[data-status="confirmado"]');
      assert.equal((await item.get()).data().onlineReservedStock,2);
      await click('[data-order]');
      await click('[data-order-status="cancelado"]');
      assert.equal((await item.get()).data().onlineReservedStock,2);
      await click('[data-order-status="cancelado"][data-confirm-cancel]');
      await page.waitForSelector('[data-status="cancelado"]');
      assert.equal((await item.get()).data().onlineReservedStock,0);
      assert.equal((await item.get()).data().estoqueAtual,10);
      assert.equal((await s.doc.collection('sales').get()).size,0);
      await page.close();
    }
  }finally{await browser.close();server.server.close();await v.close();}
});
