'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const fs = require('node:fs');
const {initializeTestEnvironment,assertSucceeds,assertFails} = require('@firebase/rules-unit-testing'), sdk = require('firebase/firestore');
const req = require('node:module').createRequire(require('node:path').resolve('functions/package.json'));
const {initializeApp,deleteApp} = req('firebase-admin/app'), {getFirestore} = req('firebase-admin/firestore');
const {operationalCommitService} = require('../../functions/src/services/operational-commit-service');
if (!/^127\.0\.0\.1:\d+$/.test(process.env.FIRESTORE_EMULATOR_HOST || '')) throw Error('Loopback Emulator only');
let app, db, svc, env, seq = 0;
test.before(async () => {env = await initializeTestEnvironment({projectId:'demo-veconi-v206-products',firestore:{rules:fs.readFileSync('firestore.rules','utf8')}});app = initializeApp({projectId:'demo-veconi-v206-products'},'v206-products'); db = getFirestore(app); svc = operationalCommitService(db);});
test.after(async () => {await env?.cleanup();await deleteApp(app);});
async function setup({permission = true, foreign = false, variable = false} = {}) {
  const bid = `qa-products-${++seq}`, uid = `seller-${seq}`, owner = `owner-${seq}`, space = `qa-space-${seq}`, other = `other-${seq}`, root = db.doc('businesses/'+bid);
  await root.set({businessId:bid,ownerId:owner,active:true,workspaceGeneration:0,legacyAccessDisabled:true,subscription:{planId:'internal',status:'active'}});
  for (const [id,role] of [[uid,'seller'],[owner,'owner']]) {
    await db.doc('users/'+id).set({uid:id,businessId:bid,active:true,role});
    await root.collection('members').doc(id).set({status:'active',role,spaceAccess:role === 'owner' ? 'all' : 'selected',allowedSpaceIds:[space],permissions:{'products.edit':permission,'products.view':true}});
  }
  for (const id of [space,other]) await db.doc('financialSpaces/'+id).set({id,businessId:bid,linkedBusinessId:bid,active:true,type:'business',capabilities:{inventory:true,products:true,sales:true}});
  const p = {id:'product',businessId:bid,workspaceGeneration:0,nome:'Produto fictício',spaceAccessMode:'single_space',defaultSpaceId:foreign?other:space,allowedSpaceIds:[foreign?other:space],active:true,ativo:true,productType:variable?'variable':'simple',estoqueAtual:7,estoque:7,totalStock:7,image:{url:'https://example.invalid/qa-image'}};
  await root.collection('products').doc(p.id).set(p);
  if (variable) await root.collection('productVariants').doc('variant').set({id:'variant',businessId:bid,parentProductId:p.id,active:true,stock:7,spaceId:space});
  for (const col of ['sales','stockMovements','payments','balanceEvents','exchangeCredits']) await root.collection(col).doc('historical').set({id:'historical',businessId:bid,spaceId:space,produtoId:'product',immutableQA:true});
  function packet(kind = 'delete', actor = uid) {
    const op = crypto.randomUUID(), at = '2026-10-26T20:00:00Z';
    return {businessId:bid,userId:actor,workspaceGeneration:0,operationId:op,syncProtocolVersion:1,clientRelease:202,payload:{eventKind:'simple',writes:[{entityType:'products',entityId:'product',operation:'update',before:p,data:{active:false,ativo:false,operationId:op,catalogAction:{operationId:op,kind,actorUid:actor,at},...(kind==='delete'?{deletedAt:at}:{archivedAt:at})}}]}};
  }
  const commit = item => svc.commit({auth:{uid:item.userId},data:{businessId:bid,item}});
  const read = async (col,id) => (await root.collection(col).doc(id).get()).data();
  return {root,p,packet,commit,read,uid,owner};
}
for (const role of ['owner','seller']) for (const kind of ['delete','archive']) test(`${role} ${kind}: metadata only, all history/images/stock and financial records preserved`, async () => {
  const c = await setup({variable:true}), originals = {};
  for (const col of ['sales','stockMovements','payments','balanceEvents','exchangeCredits']) originals[col] = await c.read(col,'historical');
  const item = c.packet(kind,role==='owner'?c.owner:c.uid);
  const result = await c.commit(item); assert.equal(result.operationId,item.operationId);
  const p = await c.read('products','product'); assert.equal(p.active,false); assert.equal(p.ativo,false);
  assert.equal(p.estoqueAtual,7); assert.equal(p.totalStock,7); assert.deepEqual(p.image,c.p.image);
  assert.equal((await c.read('productVariants','variant')).stock,7); assert.equal((await c.read('productVariants','variant')).active,true);
  for (const col of Object.keys(originals)) {assert.deepEqual(await c.read(col,'historical'),originals[col]); assert.equal((await c.root.collection(col).get()).size,1);}
  assert.ok(await c.read('processedOperations',item.operationId));
  // UI confirmation is an authenticated SERVER read of this tombstone, not an
  // Admin read and not proof inferred from the local card disappearing.
  const browser = env.authenticatedContext(role==='owner'?c.owner:c.uid).firestore();
  const status = await assertSucceeds(sdk.getDocFromServer(sdk.doc(browser,c.root.path+'/products/product')));
  assert.equal(status.data().catalogAction.operationId,item.operationId);
  if(role==='seller')await assertFails(sdk.getDocs(sdk.collection(browser,c.root.path+'/payments')));
});
test('seller without products.edit denied, even with sales.cancel', async () => {
  const c = await setup({permission:false}); await c.root.collection('members').doc(c.uid).update({'permissions.sales.cancel':true});
  await assert.rejects(c.commit(c.packet()),{code:'permission-denied'}); assert.deepEqual(await c.read('products','product'),c.p); assert.equal((await c.root.collection('processedOperations').get()).size,0);
});
test('foreign space product denied without touching the canonical product', async () => {
  const c = await setup({foreign:true}); await assert.rejects(c.commit(c.packet()),{code:'permission-denied'}); assert.deepEqual(await c.read('products','product'),c.p);
});
test('double click/concurrent retry/new service after lost response: one immutable receipt, no duplicate effects', async () => {
  const c = await setup(), item = c.packet(), original = JSON.stringify(item);
  await Promise.all([c.commit(item),c.commit(item)]); const receipt = await c.read('processedOperations',item.operationId);
  const result = await operationalCommitService(db).commit({auth:{uid:c.uid},data:{businessId:item.businessId,item}});
  assert.equal(result.replayed,true); assert.deepEqual(await c.read('processedOperations',item.operationId),receipt);
  assert.equal((await c.root.collection('processedOperations').get()).size,1); assert.equal(JSON.stringify(item),original); assert.equal((await c.read('products','product')).estoqueAtual,7);
});
test('metadata patch cannot smuggle stock change, finance or another business', async () => {
  for (const attack of ['stock','finance','business']) {
    const c = await setup(), item = c.packet();
    if (attack === 'stock') item.payload.writes[0].data.estoqueAtual = 0;
    if (attack === 'finance') item.payload.writes.push({entityType:'balanceEvents',entityId:'forged',operation:'create',data:{valor:100}});
    if (attack === 'business') item.payload.writes[0].data.businessId = 'another';
    await assert.rejects(c.commit(item)); assert.deepEqual(await c.read('products','product'),c.p);
  }
});
