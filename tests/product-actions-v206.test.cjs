'use strict';
const test = require('node:test'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const create = require('../js/product-actions');
const {harness, bridge} = require('./helpers/fiado-cancellation-harness.cjs');
function runtime(options = {}) {
  const h = harness({businessId: 'qa-business', uid: 'qa-owner', spaceId: 'qa-space'}), values = new Map(), queue = [];
  const remote = new Map(h.data().produtos.map(p => [p.id, structuredClone(p)]));
  let scope = 'qa-space', uid = 'qa-owner', permission = true, origin = {uid,businessId:'qa-business',workspaceGeneration:0}, writes = [], flushes = 0, readCount = 0;
  const env = {
    navigator: {onLine: true}, Utils: {uuid: crypto.randomUUID}, setTimeout: fn => setTimeout(fn, 1),
    FirebaseSession: {user: {get uid() { return uid; }}},
    BusinessContext: {get: () => ({businessId: 'qa-business', role: 'owner', access: {canMutate: true}})},
    SpaceContext: {homeId: () => scope, homeSpaces: () => [{id: 'qa-space'}, {id: 'other-space'}]},
    SpaceEngine: {productAllowsSpace: (p, id) => p.spaceAccessMode === 'all_spaces' || p.allowedSpaceIds?.includes(id)},
    TeamAccess: {has: () => permission, operationalReadScopeKey: () => String(permission)},
    WorkspaceRuntime: {capture: () => origin},
    Produtos: {obter: id => h.data().produtos.find(p => p.id === id)},
    DB: {__firebaseSyncWrapped: true, getBusinessId: () => 'qa-business', getPrincipal: () => uid, getWorkspaceGeneration: () => 0,
      businessCache: {keyValue: {getItem: k => values.get(k), setItem: (k,v) => values.set(k,v)}},
      alterar: fn => {
        if (options.stageFail) throw Object.assign(Error('Outra aba escritora'), {code: 'local-cache-conflict'});
        const before = structuredClone(h.data()); h.c.DB.alterar(fn);
        const diff = bridge(h.c.diffWrites(before, h.data())); writes.push(...diff);
        const op = diff[0].data.operationId;
        queue.push({operationId: op, status: 'pending', paths: diff.map(w => `businesses/qa-business/${w.entityType}/${w.entityId}`)});
        if (!options.noCommit) diff.forEach(w => remote.set(w.entityId, {...remote.get(w.entityId), ...w.data}));
      },
      flush: async () => { flushes++; if (options.onFlush) await options.onFlush(env); }},
    SyncFirebase: {getQueueDiagnostics: () => queue},
    FirestoreRepositories: {products: {getProductStatusFromServer: async id => {
      readCount++; if (options.read) return options.read(id, remote, env, readCount);
      return structuredClone(remote.get(id));
    }}},
  };
  return {env, api: create(env), h, remote, values, queue, writes, get readCount() {return readCount;}, get flushes() {return flushes;},
    changeScope: value => scope = value, changeUser: value => {uid = value; origin = {uid,businessId:'qa-business',workspaceGeneration:0};}, deny: () => permission = false};
}
test('single logical deletion uses existing DB/Sync with exactly one metadata patch; history, images, variants and stock retained', async () => {
  const r = runtime(), before = structuredClone(r.h.data());
  const result = await r.api.perform('qa-product');
  assert.equal(result.status, 'confirmed'); assert.equal(r.writes.length, 1);
  const write = r.writes[0];
  assert.equal(write.entityType, 'products'); assert.equal(write.operation, 'update');
  assert.deepEqual(Object.keys(write.data).sort(), ['active','ativo','catalogAction','deletedAt','operationId'].sort());
  assert.equal(r.remote.get('qa-product').estoqueAtual, 3);
  assert.equal(r.h.data().produtos.length, 1); assert.deepEqual(r.h.data().variacoesProdutos, before.variacoesProdutos);
  for (const key of ['vendas','movimentacoesEstoque','clientes','pagamentos']) assert.deepEqual(r.h.data()[key], before[key]);
  assert.equal(r.api.pending().length, 0);
});
test('archive preserves metadata and does not pretend a hard deletion', async () => {
  const r = runtime(); await r.api.perform('qa-product','archive');
  const p = r.remote.get('qa-product'); assert.equal(p.active, false); assert.ok(p.archivedAt); assert.equal(p.deletedAt, undefined);
});
test('seller without products.edit cannot stage, read or delete anything', async () => {
  const r = runtime(); r.deny(); assert.throws(() => r.api.perform('qa-product'), {code:'permission-denied'});
  assert.equal(r.writes.length, 0); assert.equal(r.readCount, 0);
});
test('seller authorized only for QA can archive without financial privileges', async () => {
  const r = runtime(); r.env.BusinessContext.get = () => ({businessId:'qa-business',role:'seller',spaceAccess:'selected',allowedSpaceIds:['qa-space']});
  r.env.TeamAccess.has = p => p === 'products.edit';
  assert.equal((await r.api.perform('qa-product','archive')).status, 'confirmed');
});
test('cross-space, foreign business and generation rejected before local change', async () => {
  for (const field of ['space','business','generation']) {
    const r = runtime(); if (field === 'space') r.changeScope('other-space');
    if (field === 'business') r.remote.get('qa-product').businessId = 'foreign';
    if (field === 'generation') r.remote.get('qa-product').workspaceGeneration = 1;
    await assert.rejects(r.api.perform('qa-product')); assert.equal(r.writes.length, 0);
  }
});
test('all-spaces selection still requires an authorized canonical space', async () => {
  const r = runtime(); r.changeScope('all_spaces'); assert.equal((await r.api.perform('qa-product')).status,'confirmed');
});
test('offline confirmation cannot mutate local data or claim success', async () => {
  const r = runtime(); r.env.navigator.onLine = false;
  await assert.rejects(r.api.perform('qa-product'), {code:'offline'}); assert.equal(r.writes.length, 0); assert.equal(r.api.pending().length, 0);
});
test('double click coalesces the same product intent and operation ID', async () => {
  const r = runtime(), first = r.api.perform('qa-product'), second = r.api.perform('qa-product');
  assert.equal(first, second); await Promise.all([first,second]); assert.equal(r.writes.length, 1);
});
test('lost read response preserves intent; reload and explicit confirmation query never enqueue again', async () => {
  let lost = true;
  const r = runtime({read: (id, remote, env, n) => { if (n > 1 && lost) throw Error('Resposta perdida'); return structuredClone(remote.get(id)); }});
  await assert.rejects(r.api.perform('qa-product'), {pending:true});
  const evidence = JSON.stringify(r.queue), operationId = r.api.pending()[0].operationId;
  lost = false; const reloaded = create(r.env);
  assert.equal((await reloaded.checkPending())[0].status, 'confirmed');
  assert.equal(r.writes.length, 1); assert.equal(JSON.stringify(r.queue), evidence); assert.equal(r.queue[0].operationId, operationId);
});
test('pending or permanent failure does not create a second operation on explicit retry', async () => {
  const r = runtime({noCommit:true});
  await assert.rejects(r.api.perform('qa-product'), {code:'confirmation-pending'});
  r.queue[0].status = 'error'; const saved = JSON.stringify(r.queue);
  await assert.rejects(r.api.perform('qa-product'), {code:'confirmation-pending'});
  assert.equal(r.writes.length, 1); assert.equal(JSON.stringify(r.queue), saved);
  assert.equal(r.api.isPending('qa-product'),true);
  assert.equal(r.api.displayProducts(r.h.data().produtos)[0].ativo,true);
  assert.equal(r.h.data().produtos[0].ativo,false,'presentation does not mutate original queued state');
});
test('conflicting legitimate pending product update blocks action; queue untouched', async () => {
  const r = runtime(); r.queue.push({operationId:'original',status:'pending',paths:['businesses/qa-business/products/qa-product']});
  const saved = JSON.stringify(r.queue); await assert.rejects(r.api.perform('qa-product'), {code:'product-pending'});
  assert.equal(r.writes.length, 0); assert.equal(JSON.stringify(r.queue), saved);
});
test('four historical archives are not touched, retried or removed', async () => {
  const r = runtime(); for (let n = 0; n < 4; n++) r.queue.push({operationId:'old-'+n,status:'archived',checksum:'original',paths:['businesses/qa-business/sales/old-'+n]});
  const saved = JSON.stringify(r.queue); await r.api.perform('qa-product'); assert.equal(JSON.stringify(r.queue.slice(0,4)), saved);
});
test('read returning after account change never stages or acknowledges in new namespace', async () => {
  let r; r = runtime({read: (id, remote) => {r.changeUser('qa-seller'); return remote.get(id);}});
  await assert.rejects(r.api.perform('qa-product'), {code:'session-changed'}); assert.equal(r.writes.length, 0); assert.equal(r.values.size, 0);
});
test('scope change during batch stops subsequent products', async () => {
  const r = runtime(); await assert.rejects(r.api.batch(['qa-product','other'],'delete', () => r.changeScope('other-space')), {code:'session-changed'});
  assert.equal(r.writes.length, 1);
});
test('batch reports individual partial failure and continues only safe independent items', async () => {
  const r = runtime(), results = await r.api.batch(['missing','qa-product'],'delete');
  assert.deepEqual(results.map(x => x.status), ['failed','confirmed']); assert.equal(r.writes.length, 1);
});
test('namespace writer conflict cannot leave a fake pending action', async () => {
  const r = runtime({stageFail:true}); await assert.rejects(r.api.perform('qa-product'), {code:'local-cache-conflict'}); assert.equal(r.api.pending().length,0); assert.equal(r.queue.length,0);
});
test('compatibility wrappers never delete image assets or physically remove products', () => {
  const fs = require('node:fs');
  const src = fs.readFileSync('js/product-images.js','utf8').split('async function deleteProduct(productId)')[1].split('window.getProductDisplayImage')[0];
  assert.doesNotMatch(src, /await removeProductAssets/); assert.match(src, /return window.Produtos.excluir/);
  assert.doesNotMatch(fs.readFileSync('js/produtos.js','utf8'), /db\.produtos=db\.produtos\.filter/);
});
test('bootstrap cannot mix new auth UID with old DB principal or workspace origin', () => {
  for (const source of ['namespace','workspace','profile']) {
    const r=runtime();
    if(source==='namespace')r.env.DB.getPrincipal=()=> 'old-owner:old-permissions';
    if(source==='workspace')r.env.WorkspaceRuntime.capture=()=>({uid:'old-owner',businessId:'qa-business',workspaceGeneration:0});
    if(source==='profile')r.env.BusinessContext.get=()=>({businessId:'qa-business',userProfile:{uid:'old-owner'}});
    assert.throws(()=>r.api.perform('qa-product'),{code:'session-changed'});assert.equal(r.writes.length,0);assert.equal(r.readCount,0);
  }
});
test('inactive membership, read-only plan and bootstrap error cannot stage deletion', () => {
  for(const state of [{member:{status:'inactive'}},{access:{canMutate:false}},{loading:true},{error:'not-ready'}]){
    const r=runtime();r.env.BusinessContext.get=()=>({businessId:'qa-business',...state});
    assert.throws(()=>r.api.perform('qa-product'),{code:'permission-denied'});assert.equal(r.writes.length,0);
  }
});
test('corrupt or foreign sidecar is held without deleting evidence or re-enqueuing any operation', () => {
  const r=runtime();r.values.set('adiFesta:productActions:qa-business:qa-owner:generation:0',JSON.stringify({forged:{uid:'foreign'}}));
  const original=[...r.values];assert.throws(()=>r.api.pending(),{code:'product-action-evidence'});assert.equal(r.queue.length,0);assert.deepEqual([...r.values],original);
});
test('connection restoration confirms the originally queued patch without a fresh operation or forced Sync', async () => {
  const r=runtime({noCommit:true});await assert.rejects(r.api.perform('qa-product'),{pending:true});
  const saved=JSON.stringify(r.queue),patch=r.writes[0].data;
  Object.assign(r.remote.get('qa-product'),structuredClone(patch));
  assert.equal((await create(r.env).checkPending())[0].status,'confirmed');
  assert.equal(JSON.stringify(r.queue),saved);assert.equal(r.writes.length,1);assert.equal(r.api.pending().length,0);
  assert.equal(r.api.displayProducts(r.h.data().produtos)[0].ativo,false,'hide only after server confirmation');
});
