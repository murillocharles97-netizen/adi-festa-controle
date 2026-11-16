'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { randomUUID } = require('node:crypto');
const { initializeApp, deleteApp } = require('firebase-admin/app');
const { getFirestore, Timestamp } = require('firebase-admin/firestore');
const { consignmentService } = require('../../functions/src/services/consignment-service');
const { stockKey } = require('../../functions/src/services/online-stock-reservation');
const { storeId } = require('../../functions/src/services/online-store-service');

assert.ok(process.env.FIRESTORE_EMULATOR_HOST, 'Run only with Firestore Emulator');
const app = initializeApp({ projectId: 'demo-veconi-consignment' });
const db = getFirestore(app);
const date = new Date('2026-11-16T15:00:00Z');
const service = consignmentService(db, () => date);
const logo = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAABgAAAAYCAIAAABvFaqvAAAAUklEQVR4nGPgjA1FQy///ySIMHUxjBo0oAbhMhS/ylGDBo9BcOMIqiFsEPW9ht8sfAYRmaYJGERS/sBpEDXzGnVcRM0womasoZmFXxkdUzaRCADpFvYtFolYxwAAAABJRU5ErkJggg==';
test.after(() => deleteApp(app));

async function fixture() {
  const suffix = randomUUID().slice(0, 8), businessId = 'biz-' + suffix, spaceId = 'space-' + suffix,
    otherSpace = 'other-' + suffix, uid = 'owner-' + suffix, seller = 'seller-' + suffix;
  const root = db.doc('businesses/' + businessId), scope = { businessId, workspaceGeneration: 0 };
  const s = [spaceId, otherSpace];
  const batch = db.batch();
  batch.create(root, { ...scope, active: true, ownerId: uid, name: 'Ateliê Exemplo',
    subscription: { status: 'internal', isInternal: true, planId: 'internal' } });
  for (const [id, role] of [[uid,'owner'],[seller,'seller']]) {
    batch.create(db.doc('users/' + id), { businessId, active: true, uid: id });
    batch.create(root.collection('members').doc(id), { role, status: 'active' });
  }
  for (const id of s) {
    const ref = db.doc('financialSpaces/' + id);
    batch.create(ref, { businessId, active: true, type:'business', ownerUid:uid, capabilities: { sales: true, finance:true } });
    batch.create(ref.collection('financialAccounts').doc('cash-test'), {ownerUid:uid, active:true, name:'Conta de teste', currentBalanceCents:1000});
  }
  batch.create(root.collection('onlineStores').doc(storeId(spaceId)), {
    ...scope, spaceId, catalogSettings: { logoUrl: logo },
  });
  batch.create(root.collection('settings').doc('default'), { nome: 'Ateliê Exemplo', cnpj: '00.000.000/0001-00' });
  const common = { ...scope, active: true, spaceAccessMode:'single_space', spaceId, defaultSpaceId: spaceId, allowedSpaceIds: [spaceId] };
  const products = root.collection('products'), variants = root.collection('productVariants');
  batch.create(products.doc('anel'), { ...common, nome: 'Anel Lótus', preco: 13.25, estoqueAtual: 8, estoque: 8 });
  batch.create(products.doc('kit'), { ...common, nome: 'Kit miniatura', preco: 20, estoqueAtual: 7, productType: 'variable' });
  batch.create(products.doc('subscription'), { ...common, nome: 'Assinatura', preco: 99, estoqueAtual: 100, productType: 'recurring' });
  batch.create(variants.doc('azul'), { ...scope, spaceId, parentProductId: 'kit', displayName: 'Azul', price: 24.99, stock: 4, sku: 'AZL-02' });
  batch.create(variants.doc('rosa'), { ...scope, spaceId, parentProductId: 'kit', displayName: 'Rosa', price: 20, stock: 3 });
  await batch.commit();
  const call = (action, fields = {}, actor = uid, space = spaceId) => service({ auth: { uid: actor }, data: { businessId, spaceId: space, action, ...fields } });
  const deliver = (outletId, items, fields = {}) => call('confirm', { operationId: randomUUID(), outletId, deliveredOn: '2026-11-11', items, ...fields });
  return { call, deliver, businessId, spaceId, otherSpace, root, products, variants, seller, uid, scope, common };
}

async function enabled() {
  const f = await fixture();
  await f.call('enable');
  const { id } = await f.call('outlet', { name: 'Ponto Centro', contact: 'Pessoa QA', address: 'Rua Exemplo', commissionBps:2000, operationId: randomUUID() });
  return { ...f, outletId: id };
}

test('disabled by default, and owner, company, space and generation are enforced', async () => {
  const a = await fixture(), b = await fixture();
  assert.deepEqual(await a.call('dashboard'), { enabled: false });
  await assert.rejects(a.call('history'), { code: 'failed-precondition' });
  await assert.rejects(a.call('enable', {}, a.seller), { code: 'permission-denied' });
  await assert.rejects(a.call('dashboard', {}, b.uid), { code: 'permission-denied' });
  await assert.rejects(a.call('enable', {}, a.uid, b.spaceId), { code: 'permission-denied' });
  await assert.rejects(a.call('enable', { workspaceGeneration: 1 }), { code: 'failed-precondition' });
  await a.call('enable');
  assert.deepEqual(await a.call('dashboard', {}, a.uid, a.otherSpace), { enabled: false });
});

test('transfer, retroactive date, replenishment, price and logo snapshots without revenue effects', async () => {
  const f = await enabled();
  const id = randomUUID(), items = [{ productId: 'anel', quantity: 1 }, { productId: 'kit', variantId: 'azul', quantity: 2 }];
  const first = await f.deliver(f.outletId, items, { operationId: id });
  assert.equal(first.item.kind, 'delivery');
  assert.equal(first.item.deliveredOn, '2026-11-11');
  assert.equal(first.item.recordedAt, date.toISOString());
  assert.equal(first.item.totalCents, 6323);
  assert.equal(first.item.company.logoUrl, logo);
  assert.equal((await f.products.doc('anel').get()).data().estoqueAtual, 7);
  assert.equal((await f.variants.doc('azul').get()).data().stock, 2);
  assert.equal((await f.products.doc('kit').get()).data().totalStock, 5);
  assert.equal((await f.deliver(f.outletId, items, { operationId: id })).replayed, true);
  await assert.rejects(f.deliver(f.outletId, [{ productId: 'anel', quantity: 4 }], { operationId: id }), { code: 'already-exists' });
  await f.products.doc('anel').update({ preco: 15 });
  const second = await f.deliver(f.outletId, [{ productId: 'anel', quantity: 1 }, { productId: 'anel', quantity: 1 }], { deliveredOn: '2026-11-12' });
  assert.equal(second.item.kind, 'replenishment');
  assert.equal(second.item.items[0].outletBefore, 1);
  assert.equal(second.item.items[0].outletAfter, 3);
  assert.equal(second.item.totalCents, 3000);
  assert.equal((await f.call('receipt', { operationId: id })).item.totalCents, 6323);
  assert.equal((await f.call('inventory',{outletId:f.outletId})).items.reduce((sum,row)=>sum+row.quantity,0),5);
  assert.equal((await f.call('history')).items.length,2);
  assert.equal((await f.call('dashboard')).units,5);
  assert.equal((await f.root.collection('stockMovements').get()).size,3);
  assert.equal((await f.root.collection('sales').get()).size,0);
  assert.equal((await f.root.collection('payments').get()).size,0);
  assert.equal((await f.root.collection('balanceEvents').get()).size,0);
  assert.equal((await f.root.collection('syncMetadata').doc('last-sync').get()).data().changedCollections.join(','),'products,productVariants,stockMovements');
  await f.call('disable');
  assert.equal((await f.call('dashboard')).enabled,false);
  await f.call('enable');
  assert.equal((await f.call('dashboard')).units,5);
});

test('online stock holds, scope, services and inconsistent dates reject entire transfers', async () => {
  const f = await enabled();
  const key = stockKey({ productId: 'anel' });
  await f.products.doc('anel').update({ onlineReservedStock: 7 });
  await f.root.collection('onlineStockReservations').doc(key).set({ ...f.scope, quantity: 7 });
  const mixed = [{ productId: 'kit', variantId: 'azul', quantity: 1 }, { productId: 'anel', quantity: 2 }];
  await assert.rejects(f.deliver(f.outletId, mixed), { code: 'failed-precondition' });
  await assert.rejects(f.deliver(f.outletId, [{ productId: 'subscription', quantity: 1 }]), { code: 'failed-precondition' });
  await assert.rejects(f.deliver(f.outletId, mixed, { deliveredOn: '2026-02-30' }), { code: 'invalid-argument' });
  await assert.rejects(f.deliver(f.outletId, mixed, { deliveredOn: '2026-11-17' }), { code: 'invalid-argument' });
  await f.call('enable', {}, f.uid, f.otherSpace);
  await assert.rejects(f.call('inventory', { outletId: f.outletId }, f.uid, f.otherSpace), { code: 'not-found' });
  assert.equal((await f.variants.doc('azul').get()).data().stock,4);
  assert.equal((await f.root.collection('stockMovements').get()).size,0);
});

test('confirmation and concurrent retry reserve stock once, with distinct transfers competing for the same unit', async () => {
  const f = await enabled();
  const op = randomUUID(), lines = [{ productId: 'anel', quantity: 7 }];
  const [first, retry] = await Promise.all([f.deliver(f.outletId, lines, {operationId:op}), f.deliver(f.outletId, lines, {operationId:op})]);
  assert.deepEqual([first.replayed,retry.replayed].sort(),[false,true]);
  const outcomes = await Promise.allSettled([f.deliver(f.outletId,[{productId:'anel',quantity:1}]), f.deliver(f.outletId,[{productId:'anel',quantity:1}])]);
  assert.equal(outcomes.filter(x=>x.status==='fulfilled').length,1);
  assert.equal(outcomes.find(x=>x.status==='rejected').reason.code,'failed-precondition');
  assert.equal((await f.products.doc('anel').get()).data().estoqueAtual,0);
  assert.equal((await f.call('dashboard')).units,8);
});

test('direct Firestore reads and writes to consignments are denied even to the owner', async () => {
  const { initializeTestEnvironment, assertFails } = require('@firebase/rules-unit-testing');
  const { doc, getDoc, setDoc } = require('firebase/firestore');
  const f = await enabled();
  const env = await initializeTestEnvironment({ projectId: 'demo-veconi-consignment', firestore: {
    rules: require('node:fs').readFileSync('firestore.rules','utf8'),
  } });
  try {
    const ownerDb = env.authenticatedContext(f.uid).firestore();
    const record = doc(ownerDb, 'businesses', f.businessId, 'consignmentSpaces', '0_'+f.spaceId, 'outlets', f.outletId);
    await assertFails(getDoc(record));
    await assertFails(setDoc(record, { name: 'Alteração indevida' }, { merge: true }));
  } finally { await env.cleanup(); }
});

async function previewServer(f, port = 0) {
  const http = require('node:http'), fs = require('node:fs/promises');
  const products = (await f.products.get()).docs.map(row => ({ id: row.id, ...row.data() }));
  const variants = (await f.variants.get()).docs.map(row => ({ id: row.id, ...row.data() }));
  const context = { businessId: f.businessId, business: { ownerId: f.uid }, userProfile: { uid: f.uid }, role:'owner' };
  const markup = `<!doctype html><html lang="pt-BR"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>VECONI Consignados · QA</title><link rel="stylesheet" href="css/style.css"><link rel="stylesheet" href="css/design-system/tokens.css">
    <link rel="stylesheet" href="css/consignments.css"><script src="assets/lucide.min.js"></script>
    <style>body{display:block;padding:12px;background:#f0f5f8}main{max-width:1050px;margin:auto}</style>
    <main id="app"></main><script src="js/consignment-pdf.js"></script><script src="js/consignment-ui.js"></script>
    <script>
      window.BusinessContext={get:()=>(${JSON.stringify(context)})};
      window.SpaceContext={activeId:()=>${JSON.stringify(f.spaceId)},renderBar:()=>'<p class="muted">Espaço de teste · dados fictícios</p>'};
      window.SpaceEngine={productAllowsSpace:(row,id)=>row.allowedSpaceIds.includes(id)};
      window.DB={readForView:()=>({produtos:${JSON.stringify(products)},variacoesProdutos:${JSON.stringify(variants)}})};
      window.SyncFirebase={getFirebaseDiagnostic:()=>({pending:0,syncErrors:0})};
      window.FinancialSpaceService={listFinancialAccounts:async()=>[{id:'cash-test',name:'Conta de teste',accountHomeSpaceId:${JSON.stringify(f.spaceId)}}]};
      window.FirebaseCallable=async(name,input)=>{
        const response=await fetch('/qa-consignments',{method:'POST',body:JSON.stringify(input)});
        const result=await response.json();
        if (!response.ok) throw Object.assign(Error(result.message),{code:'functions/'+result.code});
        if (window.qaLostReply && input.action==='confirm') {
          window.qaLostReply=false;
          throw Object.assign(Error('Resposta simulada perdida'),{code:'functions/unavailable'});
        }
        return {data:result};
      };
      document.getElementById('app').innerHTML = window.Consignments.shell();
      window.Consignments.mount(document.getElementById('app'));
    </script></html>`;
  const staticFiles = new Set(['/css/style.css','/css/design-system/tokens.css','/css/consignments.css','/assets/lucide.min.js',
    '/js/consignment-pdf.js','/js/consignment-ui.js','/assets/jspdf-4.2.1.umd.min.js']);
  const server = http.createServer(async (req, res) => {
    if (req.method === 'POST' && req.url === '/qa-consignments') {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      try {
        const input = JSON.parse(Buffer.concat(chunks));
        assert.equal(input.businessId, f.businessId);
        assert.equal(input.spaceId, f.spaceId);
        const result = await service({ auth: {uid: f.uid}, data: input });
        res.setHeader('content-type','application/json');
        res.end(JSON.stringify(result));
      } catch (error) {
        res.writeHead(400, {'content-type':'application/json'});
        res.end(JSON.stringify({code:error.code,message:error.message}));
      }
    } else if (req.url === '/') {
      res.setHeader('content-type','text/html; charset=utf-8');
      res.end(markup);
    } else if (staticFiles.has(req.url)) {
      res.setHeader('content-type',req.url.endsWith('.css') ? 'text/css' : 'text/javascript; charset=utf-8');
      res.end(await fs.readFile('.' + req.url));
    } else { res.writeHead(404); res.end(); }
  });
  await new Promise(resolve => server.listen(port, '127.0.0.1', resolve));
  return { server, url: 'http://127.0.0.1:' + server.address().port };
}

test('browser confirms delivery, recovers lost response and builds branded PDF on mobile and desktop', async t => {
  const puppeteer = require('puppeteer'), fs = require('node:fs/promises');
  const f = await fixture(), { server, url } = await previewServer(f);
  const browser = await puppeteer.launch({headless:true});
  t.after(async () => { await browser.close(); await new Promise(resolve => server.close(resolve)); });
  const page = await browser.newPage();
  await page.setViewport({width:390,height:844,isMobile:true,hasTouch:true});
  const browserErrors = [];
  page.setDefaultTimeout(7500);
  page.on('pageerror', error => browserErrors.push(error.message));
  await page.goto(url,{waitUntil:'domcontentloaded'});
  try { await page.waitForSelector('[data-enable]',{timeout:7000}); }
  catch (error) { assert.fail(JSON.stringify({message:error.message, browserErrors, app:await page.$eval('#app',el=>el.textContent)})); }
  await page.click('[data-enable]');
  await page.waitForSelector('[data-tab="outlets"]');
  await page.click('[data-tab="outlets"]');
  await page.waitForSelector('[data-outlet-form]');
  await page.type('[name="name"]','Parceiro Demonstrativo');
  await page.$eval('[name="commission"]', input => { input.value = '20'; });
  await page.click('[data-outlet-form] button[type=submit]');
  try { await page.waitForFunction(() => document.body.innerText.includes('Ponto de venda cadastrado'),{timeout:5500}); }
  catch (error) { assert.fail(JSON.stringify({message:error.message, browserErrors, app:await page.$eval('#app',el=>el.textContent)})); }
  await page.click('[data-tab="home"]');
  await page.waitForSelector('[data-new-delivery]');
  const output = process.env.VECONI_CONSIGNMENT_QA_OUTPUT;
  if (output) await page.screenshot({path:require('node:path').join(output,'consignados-mobile.png'),fullPage:true});
  await page.click('[data-new-delivery]');
  await page.waitForSelector('[data-delivery-form]');
  await page.$eval('[name="deliveredOn"]', input => { input.value = '2026-11-10'; input.dispatchEvent(new Event('input',{bubbles:true})); });
  await page.type('[data-product-search]','AZL');
  await page.waitForSelector('[data-add="azul"]');
  await page.click('[data-add="azul"]');
  await page.click('[data-add="azul"]');
  await page.evaluate(() => { window.qaLostReply = true; });
  await page.click('[data-delivery-form] button[type=submit]');
  await page.waitForSelector('[data-resume]');
  await page.reload({waitUntil:'domcontentloaded'});
  await page.waitForSelector('[data-resume]');
  await page.click('[data-resume]');
  await page.waitForSelector('[data-prepare-pdf]');
  await page.click('[data-prepare-pdf]');
  await page.waitForSelector('[data-download]');
  assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
  const pdf = await page.evaluate(async () => {
    window.ConsignmentPdf.download = file => { window.qaPdf = file; };
    document.querySelector('[data-download]').click();
    const bytes = new Uint8Array(await window.qaPdf.arrayBuffer());
    return btoa(String.fromCharCode(...bytes));
  });
  const bytes = Buffer.from(pdf,'base64');
  assert.equal(bytes.subarray(0,4).toString(),'%PDF');
  assert.match(bytes.toString('latin1'), /\/Subtype \/Image/);
  if (output) await fs.writeFile(require('node:path').join(output,'consignado-estoque.pdf'),bytes);
  const shared = await page.evaluate(async () => {
    Object.defineProperties(navigator,{
      share:{configurable:true,value:async ({files})=>{window.qaShare=files[0].type;}},
      canShare:{configurable:true,value:()=>true},
    });
    document.querySelector('[data-share]').click();
    return window.qaShare;
  });
  assert.equal(shared,'application/pdf');
  assert.equal((await f.call('dashboard')).deliveries,1);
  const desktop = await browser.newPage();
  await desktop.setViewport({width:1366,height:900});
  await desktop.goto(url,{waitUntil:'domcontentloaded'});
  await desktop.waitForSelector('[data-tab="history"]');
  await desktop.click('[data-tab="history"]');
  await desktop.waitForSelector('[data-receipt]');
  assert.match(await desktop.$eval('#app',x=>x.textContent), /10\/11\/2026/);
  await desktop.click('[data-receipt]');
  await desktop.waitForSelector('[data-prepare-pdf]');
  await desktop.click('[data-tab="home"]');
  await desktop.waitForSelector('[data-count]');
  await desktop.click('[data-count]');
  await desktop.waitForSelector('[data-count-field="found"]');
  await desktop.type('[data-count-field="found"]','1');
  assert.match(await desktop.$eval('[data-count-result]',node=>node.textContent),/1 un/);
  await desktop.click('[data-review-count] button[type=submit]');
  await desktop.waitForSelector('[data-confirm-count]');
  if (output) await desktop.screenshot({path:require('node:path').join(output,'consignados-conferencia.png'),fullPage:true});
  await desktop.click('[data-confirm-count] button[type=submit]');
  await desktop.waitForSelector('[data-prepare-pdf="conference"]');
  await desktop.click('[data-prepare-pdf="conference"]');
  await desktop.waitForSelector('[data-download]');
  const report = await desktop.evaluate(async () => {
    window.ConsignmentPdf.download = file => { window.qaPdf = file; };
    document.querySelector('[data-download]').click();
    return btoa(String.fromCharCode(...new Uint8Array(await window.qaPdf.arrayBuffer())));
  });
  const reportBytes = Buffer.from(report,'base64');
  assert.equal(reportBytes.subarray(0,4).toString(),'%PDF');
  assert.match(reportBytes.toString('latin1'), /\/Subtype \/Image/);
  if (output) await fs.writeFile(require('node:path').join(output,'consignado-conferencia.pdf'),reportBytes);
  await desktop.click('[data-start-settlement]');
  await desktop.waitForSelector('[data-confirm-settlement]');
  await desktop.select('[data-confirm-settlement] [name=account]','0');
  await desktop.click('[data-confirm-settlement] button[type=submit]');
  await desktop.waitForFunction(() => document.querySelector('[data-consignment-content] h3')?.textContent.startsWith('Acerto'));
  assert.equal(await desktop.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),true);
});

test('preview local', {skip: !process.env.VECONI_CONSIGNMENT_PREVIEW}, async () => {
  const f = await enabled();
  await f.deliver(f.outletId, [{productId:'anel',quantity:4}, {productId:'kit',variantId:'azul',quantity:3}], {deliveredOn:'2026-11-10'});
  const { url } = await previewServer(f, Number(process.env.VECONI_CONSIGNMENT_PREVIEW_PORT || 8791));
  console.log('Prévia de Consignados com Firestore Emulator em ' + url);
  await new Promise(resolve => process.once('SIGINT', resolve));
});

test('conference preserves separate prices, deducts returns, losses and damage from sales, and settles exactly once', async () => {
  const f = await enabled();
  const first = await f.deliver(f.outletId,[{ productId:'anel',quantity:5 }]);
  const restock = await f.deliver(f.outletId,[{ productId:'anel',quantity:2,unitCents:1800 }]);
  assert.deepEqual(restock.item.stockAfter.map(x=>[x.unitCents,x.quantity]),[[1325,5],[1800,2]]);
  const stock = await f.call('conferenceStock',{outletId:f.outletId});
  const items = stock.items.map(row => ({id:row.id, found:1, returns:row.unitCents===1325?1:0,
    loss:row.unitCents===1325?1:0, damaged:row.unitCents===1325?1:0}));
  const input = {outletId:f.outletId,operationId:randomUUID(),items,fingerprint:stock.fingerprint,payment:{status:'pending'}};
  const result = await f.call('conference',input);
  const bill = result.item, space = db.doc('financialSpaces/'+f.spaceId);
  const ledger = space.collection('entries').doc('consignment_'+bill.id);
  const account = space.collection('financialAccounts').doc('cash-test');
  assert.equal(bill.units,2);
  assert.equal(bill.grossCents,3125);
  assert.equal(bill.commissionCents,625);
  assert.equal(bill.netCents,2500);
  assert.equal((await ledger.get()).data().status,'pending');
  assert.equal((await ledger.get()).data().cashFlowEffect,false);
  assert.equal((await account.get()).data().currentBalanceCents,1000);
  assert.equal((await f.products.doc('anel').get()).data().estoqueAtual,2);
  assert.equal((await f.call('dashboard')).pendingCents,2500);
  assert.deepEqual(await f.call('daily'),{units:2,grossCents:3125});
  assert.equal((await f.call('conference',input)).replayed,true);
  await assert.rejects(f.call('conference',{...input,operationId:randomUUID()}),{code:'failed-precondition'});
  assert.equal((await f.call('dashboard')).outlets[0].month.grossCents,3125);
  await f.call('enable',{},f.uid,f.otherSpace);
  assert.deepEqual(await f.call('daily',{},f.uid,f.otherSpace),{units:0,grossCents:0});
  assert.equal((await f.call('history',{},f.uid,f.otherSpace)).items.length,0);
  await assert.rejects(f.call('receipt',{operationId:bill.id},f.uid,f.otherSpace),{code:'not-found'});
  const opts = {conferenceId:bill.id,operationId:randomUUID(),payment:{status:'paid',method:'pix',accountId:'cash-test',homeId:f.otherSpace}};
  await assert.rejects(f.call('settle',opts),{code:'failed-precondition'});
  opts.payment.homeId=f.spaceId;
  const attempt = await Promise.allSettled([f.call('settle',opts),f.call('settle',{...opts,operationId:randomUUID()})]);
  assert.equal(attempt.filter(x=>x.status==='fulfilled').length,1);
  assert.equal((await ledger.get()).data().status,'paid');
  assert.equal((await account.get()).data().currentBalanceCents,3500);
  assert.equal((await space.collection('entries').get()).size,1);
  assert.equal((await f.call('dashboard')).pendingCents,0);
  assert.deepEqual(await f.call('daily'),{units:2,grossCents:3125});
  assert.equal((await f.call('receipt',{operationId:bill.id})).currentPayment,'paid');
  assert.equal((await f.call('receipt',{operationId:bill.id})).item.paymentAtRecording,'pending');
  assert.deepEqual((await f.call('receipt',{operationId:first.item.id})).item.stockAfter,first.item.stockAfter);
  assert.equal((await f.call('history',{outletId:f.outletId})).items.length,4);
  assert.equal((await f.root.collection('sales').get()).size,0);
  assert.equal((await f.root.collection('stockMovements').get()).size,3);
});

test('cash received with a conference credits only the correct space and retries once', async () => {
  const f = await enabled();
  await f.deliver(f.outletId,[{productId:'anel',quantity:2}]);
  const stock = await f.call('conferenceStock',{outletId:f.outletId}), op = randomUUID();
  const input = {outletId:f.outletId,operationId:op,fingerprint:stock.fingerprint,
    items:stock.items.map(row=>({id:row.id,found:0,returns:0,loss:0,damaged:0})),
    payment:{status:'paid',method:'cash',accountId:'cash-test',homeId:f.spaceId}};
  const results = await Promise.all([f.call('conference',input),f.call('conference',input)]);
  assert.equal(results.filter(x=>x.replayed).length,1);
  assert.equal((await f.products.doc('anel').get()).data().estoqueAtual,6);
  const accountOf = id => db.doc('financialSpaces/'+id+'/financialAccounts/cash-test');
  assert.equal((await accountOf(f.spaceId).get()).data().currentBalanceCents,3120);
  assert.equal((await accountOf(f.otherSpace).get()).data().currentBalanceCents,1000);
  await assert.rejects(f.call('settle',{conferenceId:op,operationId:randomUUID(),payment:input.payment}),{code:'failed-precondition'});
  assert.equal((await f.call('dashboard')).pendingCents,0);
});


test('a newer replenishment invalidates a count before any financial or stock write', async () => {
  const f = await enabled();
  await f.deliver(f.outletId,[{productId:'anel',quantity:2}]);
  const stale = await f.call('conferenceStock',{outletId:f.outletId});
  const updated = await f.deliver(f.outletId,[{productId:'anel',quantity:1}]);
  assert.equal(updated.item.stockAfter[0].quantity,3);
  await assert.rejects(f.call('conference',{outletId:f.outletId,operationId:randomUUID(),fingerprint:stale.fingerprint,
    items:stale.items.map(row=>({id:row.id,found:0,returns:0,loss:0,damaged:0}))}),{code:'failed-precondition'});
  assert.equal((await f.call('inventory',{outletId:f.outletId})).items[0].quantity,3);
  assert.equal((await db.doc('financialSpaces/'+f.spaceId).collection('entries').get()).size,0);
});
