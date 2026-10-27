(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.ProductActions = factory(root);
})(typeof window === 'undefined' ? globalThis : window, function (env) {
  'use strict';
  const flights = new Map();
  const failure = (code, message) => Object.assign(Error(message), {code});
  const context = () => env.BusinessContext?.get?.() || {};
  function identity() {
    const c = context(), uid = env.FirebaseSession?.user?.uid;
    if (!uid || !c.businessId || c.businessId !== env.DB.getBusinessId())
      throw failure('session-required', 'Entre novamente na empresa antes de continuar.');
    if (!env.TeamAccess?.has?.('products.edit'))
      throw failure('permission-denied', 'Seu perfil não pode excluir ou arquivar produtos.');
    if (c.loading === true || c.error || c.business?.active === false || c.userProfile?.active === false ||
      c.member?.status && c.member.status !== 'active' || c.access?.canMutate === false || c.access?.readOnly)
      throw failure('permission-denied', 'Este acesso está disponível apenas para consulta.');
    const origin = env.WorkspaceRuntime.capture();
    if (origin.uid !== uid || origin.businessId !== c.businessId || origin.workspaceGeneration !== env.DB.getWorkspaceGeneration() ||
      env.DB.getPrincipal().split(':')[0] !== uid || c.userProfile?.uid && c.userProfile.uid !== uid)
      throw failure('session-changed', 'Aguarde o carregamento da conta correta. Nenhum produto foi alterado.');
    const scope = {uid, businessId: c.businessId, generation: env.DB.getWorkspaceGeneration(),
      principal: env.DB.getPrincipal(), spaceId: env.SpaceContext.homeId(),
      permissions: env.TeamAccess.operationalReadScopeKey(), origin};
    scope.key = JSON.stringify([scope.uid, scope.businessId, scope.generation, scope.principal, scope.spaceId, scope.permissions]);
    return scope;
  }
  const assertCurrent = scope => {
    if (identity().key !== scope.key || env.WorkspaceRuntime.capture() !== scope.origin)
      throw failure('session-changed', 'A conta ou o espaço mudou. A operação foi preservada na conta de origem.');
  };
  function assertProduct(product, scope) {
    const c = context();
    if (!product || product.businessId !== scope.businessId || (product.workspaceGeneration ?? 0) !== scope.generation)
      throw failure('product-origin', 'Produto não confirmado nesta empresa. Aguarde a sincronização.');
    const ids = c.role === 'owner' || c.spaceAccess === 'all'
      ? (env.SpaceContext.homeSpaces?.() || []).map(s => s.id) : (c.allowedSpaceIds || []);
    const target = ['all', 'all_spaces'].includes(scope.spaceId) ? null : scope.spaceId;
    const allows = id => env.SpaceEngine.productAllowsSpace(product, id);
    if (target ? !ids.includes(target) || !allows(target) : !ids.some(allows))
      throw failure('space-denied', 'O produto não pertence a um espaço autorizado nesta seleção.');
  }
  const journalKey = scope => `adiFesta:productActions:${scope.businessId}:${scope.uid}:generation:${scope.generation}`;
  function journal(scope) {
    assertCurrent(scope);
    const records = JSON.parse(env.DB.businessCache.keyValue.getItem(journalKey(scope)) || '{}');
    if (!records || Array.isArray(records) || typeof records !== 'object' || Object.entries(records).some(([id,r]) =>
      !r || r.operationId !== id || r.businessId !== scope.businessId || r.uid !== scope.uid || r.workspaceGeneration !== scope.generation ||
      !['pending','confirmed'].includes(r.status) || !['archive','delete'].includes(r.kind)))
      throw failure('product-action-evidence', 'A confirmação local precisa de análise. Os registros foram preservados; nenhuma ação foi reenviada.');
    return records;
  }
  async function remember(scope, intent, status, message = '') {
    assertCurrent(scope);
    const records = journal(scope);
    records[intent.operationId] = {...intent, status, message};
    env.DB.businessCache.keyValue.setItem(journalKey(scope), JSON.stringify(records));
    await env.DB.flush();
    assertCurrent(scope);
  }
  const repository = () => env.FirestoreRepositories?.products || env.dataRepository?.products;
  async function read(scope, id) {
    assertCurrent(scope);
    if (env.navigator.onLine === false) throw failure('offline', 'Conecte-se à internet. Nenhuma nova exclusão foi iniciada.');
    if (!repository()?.getProductStatusFromServer) throw failure('not-ready', 'Aguarde o carregamento da conexão com a nuvem.');
    const product = await repository().getProductStatusFromServer(id);
    assertCurrent(scope);
    assertProduct(product, scope);
    return product;
  }
  function conflictingQueue(productId, ownOperationId = '') {
    const path = `businesses/${env.DB.getBusinessId()}/products/${productId}`;
    return env.SyncFirebase.getQueueDiagnostics().find(q => q.operationId !== ownOperationId &&
      !['resolved', 'archived'].includes(q.status) && q.paths?.includes(path));
  }
  async function verify(scope, intent) {
    const product = await read(scope, intent.productId);
    const confirmed = product.catalogAction?.operationId === intent.operationId &&
      product.catalogAction?.kind === intent.kind && product.active === false && product.ativo === false &&
      (intent.kind === 'delete' ? Boolean(product.deletedAt) : Boolean(product.archivedAt));
    if (!confirmed) return false;
    await remember(scope, intent, 'confirmed');
    return true;
  }
  // A retry here is READ ONLY. Only the existing Sync owns sending/retrying its
  // original durable packet; this UI never calls forced Sync or rewrites a queue.
  async function waitForConfirmation(scope, intent) {
    for (let attempt = 0; attempt < 5; attempt++) {
      if (await verify(scope, intent)) return {id: intent.productId, operationId: intent.operationId, status: 'confirmed'};
      const operation = env.SyncFirebase.getQueueDiagnostics().find(q => q.operationId === intent.operationId);
      if (operation && ['error', 'quarantined', 'manual_review'].includes(operation.status))
        throw failure('confirmation-pending', 'A nuvem ainda não confirmou. A operação original foi preservada; confira o Sync.');
      if (attempt < 4) await new Promise(resolve => env.setTimeout(resolve, 700));
      assertCurrent(scope);
    }
    throw failure('confirmation-pending', 'Aguardando confirmação da nuvem. Use Verificar confirmação; não repita a exclusão.');
  }
  function perform(id, kind = 'delete') {
    const scope = identity(), key = `${scope.key}:${id}`;
    if (!['delete', 'archive'].includes(kind)) return Promise.reject(failure('invalid-action', 'Ação inválida.'));
    if (flights.has(key)) return flights.get(key);
    const task = (async () => {
      let intent = Object.values(journal(scope)).find(r => r.productId === id && r.status !== 'confirmed');
      try {
        if (intent) return await waitForConfirmation(scope, intent);
        if (!env.DB.__firebaseSyncWrapped) throw failure('not-ready', 'Aguarde a inicialização do Sync.');
        const product = await read(scope, id);
        if (conflictingQueue(id)) throw failure('product-pending', 'Este produto possui outra alteração não confirmada. Aguarde o Sync antes de continuar.');
        if (product.deletedAt || product.active === false || product.ativo === false)
          throw failure('already-inactive', 'Este produto já está inativo na nuvem. Atualize a listagem.');
        const at = new Date().toISOString(), operationId = env.Utils.uuid();
        intent = {operationId, productId: id, name: env.Produtos.obter(id)?.nome || 'Produto', kind, createdAt: at,
          businessId: scope.businessId, uid: scope.uid, workspaceGeneration: scope.generation};
        // Journal and metadata patch share the existing IDB transaction/namespace.
        // No local removal, image deletion, variation mutation or stock arithmetic.
        const records = journal(scope);
        records[operationId] = {...intent, status: 'pending'};
        try {
          env.DB.businessCache.keyValue.setItem(journalKey(scope), JSON.stringify(records));
          env.DB.alterar(data => {
            assertCurrent(scope);
            const local = data.produtos.find(p => p.id === id);
            assertProduct(local, scope);
            Object.assign(local, {active: false, ativo: false, operationId,
              catalogAction: {operationId, kind, actorUid: scope.uid, at},
              ...(kind === 'delete' ? {deletedAt: at} : {archivedAt: at})});
          });
        } catch (error) {
          // If staging failed (e.g. another writer owns this namespace), don't
          // invent a pending operation. CAS recovery remains the DB's duty.
          delete records[operationId];
          intent = null;
          try {
            assertCurrent(scope);
            env.DB.businessCache.keyValue.setItem(journalKey(scope), JSON.stringify(records));
          } catch { /* The cache conflict mechanism preserves the original namespace. */ }
          throw error;
        }
        await env.DB.flush();
        assertCurrent(scope);
        return await waitForConfirmation(scope, intent);
      } catch (error) {
        if (intent) {
          try { await remember(scope, intent, 'pending', error.message); } catch { /* Never touch a replacement namespace. */ }
          error.operationId = intent.operationId;
          error.pending = true;
        }
        throw error;
      }
    })();
    flights.set(key, task);
    task.finally(() => flights.delete(key)).catch(() => {});
    return task;
  }
  async function batch(ids, kind, progress = () => {}) {
    const scope = identity(), results = [];
    for (const id of new Set(ids)) {
      assertCurrent(scope);
      try { results.push(await perform(id, kind)); }
      catch (error) {
        assertCurrent(scope);
        results.push({id, status: error.pending ? 'pending' : 'failed', message: error.message, operationId: error.operationId || null});
      }
      assertCurrent(scope);
      progress([...results]);
    }
    return results;
  }
  async function checkPending() {
    const scope = identity(), results = [];
    for (const intent of Object.values(journal(scope)).filter(r => r.status !== 'confirmed')) {
      try { results.push({id: intent.productId, status: await verify(scope, intent) ? 'confirmed' : 'pending'}); }
      catch (error) { assertCurrent(scope); results.push({id: intent.productId, status: 'pending', message: error.message}); }
    }
    return results;
  }
  const pending = () => { const scope = identity(); return Object.values(journal(scope)).filter(r => r.status !== 'confirmed'); };
  function isPending(id) {
    try {
      const local = env.Produtos.obter(id);
      return pending().some(r => r.productId === id && r.operationId === local?.catalogAction?.operationId);
    } catch { return false; } // The header reports invalid evidence; no writes here.
  }
  // Presentation only: an unconfirmed tombstone must not disappear as though
  // deletion succeeded. The actual DB record stays inactive/pending for Sync.
  function displayProducts(rows) {
    let held = new Map();
    try { held = new Map(pending().map(r => [r.productId, r.operationId])); } catch { /* Keep the original projection; header reports evidence error. */ }
    return rows.map(p => p.ativo === false && held.has(p.id) && held.get(p.id) === p.catalogAction?.operationId ? {...p, ativo:true} : p);
  }
  return Object.freeze({perform, batch, pending, checkPending, identity, isPending, displayProducts});
});
