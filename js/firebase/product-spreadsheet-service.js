import { auth, db } from './firebase-config.js';
import { createFirestoreRepository } from './firestore-repository.js';

const Model = window.ProductSpreadsheet;
const requireOnline = () => {
  if(window.PlanLimitService)window.PlanLimitService.assert(window.PlanLimitService.canUseFeature('spreadsheetImport'),'importar/exportar produtos'); if (!navigator.onLine) throw Error('Conecte-se à internet para importar ou exportar produtos atualizados.'); };
function capture() {
  requireOnline();
  const context = window.BusinessContext?.get?.(), uid = auth.currentUser?.uid;
  if (!uid || !context?.businessId || !window.TeamAccess?.has('products.view')) throw Error('Sem acesso aos produtos desta empresa.');
  const spaces = window.SpaceContext.list().filter(s => s.businessId === context.businessId && s.active !== false && s.capabilities?.products
    && (context.spaceAccess === 'all' || (context.allowedSpaceIds || []).includes(s.id)));
  const scope = { businessId: context.businessId, uid, spaceId: window.SpaceContext.homeId(),
    allSpaces: context.spaceAccess === 'all', allowedSpaceIds: spaces.map(s => s.id).sort(),
    generation: Number(context.business?.workspaceGeneration || 0) };
  if (scope.spaceId !== 'all_spaces' && !scope.allowedSpaceIds.includes(scope.spaceId)) throw Error('O espaço selecionado não permite acesso a produtos.');
  return scope;
}
const ACTIVE_IGNORED = new Set(['resolved', 'archived']);
function assertContext(scope, { ownOperations = null } = {}) {
  const live = capture();
  if (JSON.stringify(live) !== JSON.stringify(scope)) throw Error('Empresa, espaço ou acesso mudou. Feche e abra a importação novamente.');
  // Only ACTIVE queue items block; resolved/archived history is kept forever for audit.
  const active = (window.SyncFirebase?.getQueueDiagnostics?.() || []).filter(item => !ACTIVE_IGNORED.has(item.category) &&
    !(ownOperations && ownOperations.has(String(item.operationId))));
  if (active.length) throw Error('Sincronize as operações pendentes antes de importar ou exportar.');
}
export async function loadCatalog() {
  const scope = capture(); assertContext(scope);
  const permissions = { cost: window.TeamAccess.has('cost.view'), stock: window.TeamAccess.has('inventory.adjust'), edit: window.TeamAccess.has('products.edit') };
  const [products, financials, variants] = await Promise.all([
    createFirestoreRepository('products').listAllPaged(200),
    permissions.cost ? createFirestoreRepository('productFinancials').listAllPaged(200) : [],
    createFirestoreRepository('productVariants').listAllPaged(200),
  ]);
  assertContext(scope);
  const costs = new Map(financials.map(f => [f.productId || f.id, f]));
  const visible = products.filter(p => Model.inScope(p, scope)).map(p => ({ ...p,
    custo: permissions.cost ? costs.get(p.id)?.custo ?? p.custo ?? null : null,
  }));
  const inactive = products.filter(p => Model.inScope(p, scope, true) && !Model.inScope(p, scope));
  const byId = new Map([...visible, ...inactive].map(p => [p.id, p]));
  const reservations = variants.filter(v => byId.has(v.parentProductId) && !v.deleted && !v.deletedAt).map(v => ({...byId.get(v.parentProductId), id:`variant:${v.id}`, codigo:v.sku || v.codigo || '', barcode:v.barcode || '', identifierReservation:true}));
  for (const p of byId.values()) for (const barcode of p.alternateBarcodes || []) reservations.push({...p, id:`alternate:${p.id}:${barcode}`, codigo:'', barcode, identifierReservation:true});
  return {scope, permissions, products:visible, matchingProducts:[...visible, ...inactive, ...reservations]};
}

// Optimistic read/compare/write transactions, not blind full-document overwrites.
// Existing workspace writer supplies reset generation, existing listeners hydrate IndexedDB.
export async function applyPreview(catalog, preview, onProgress) {
  assertContext(catalog.scope);
  if (!window.TeamAccess.has('products.edit')) throw Error('Você não tem permissão para editar produtos.');
  const scope = catalog.scope, selected = preview.rows.filter(r => r.status === 'update'), creates = preview.rows.filter(r => r.status === 'create'), results = [];
  if (creates.length && preview.mode !== 'create_update') throw Error('Confirme o modo de criação antes de importar.');
  if (creates.length && scope.spaceId === 'all_spaces') throw Error('Selecione um espaço específico para criar produtos.');
  for (let offset = 0; offset < creates.length; offset += 25) {
    const batch = creates.slice(offset, offset + 25);
    try {
      assertContext(scope);
      const response = await window.FirebaseCallable('createSpreadsheetProducts', {
        businessId:scope.businessId, spaceId:scope.spaceId, workspaceGeneration:scope.generation,
        rows:batch.map(row => ({line:row.line, data:row.create})),
      });
      results.push(...(response.data || response).results);
    } catch (error) {
      results.push(...creates.slice(offset).map(row => ({line:row.line, ok:false, message:error.message || 'Não foi possível confirmar a criação. Gere outra prévia; o reenvio é protegido contra duplicidade.'})));
      onProgress?.(results.length, creates.length + selected.length); break;
    }
    onProgress?.(results.length, creates.length + selected.length);
  }
  // Updates go through the app's own validated, offline-first flows (Sync queue →
  // commitOperationalSync). Direct client writes to stock are forbidden by the Rules.
  // Catalog fields → Produtos.salvar (never touches stock); goods received →
  // Produtos.entrada (relative, safe with concurrent sales); absolute quantity →
  // Produtos.ajustarEstoque (only when the stock is still the one previewed).
  const own = new Set(), queueIds = () => new Set((window.SyncFirebase?.getQueueDiagnostics?.() || []).map(item => String(item.operationId)));
  const track = action => { const before = queueIds(); const value = action(); for (const id of queueIds()) if (!before.has(id)) own.add(id); return value; };
  for (const row of selected) {
    try {
      assertContext(scope, { ownOperations: own });
      if (!/^[^/]{1,200}$/.test(row.id)) throw Error('ID inválido.');
      const p = window.Produtos.obter(row.id);
      if (!Model.inScope(p, scope)) { results.push({ id: row.id, line: row.line, ok: false, message: 'Produto removido ou fora do espaço selecionado.' }); continue; }
      const current = Model.values(p, window.TeamAccess.has('cost.view'));
      if (row.targetIdentity && (current.codigo !== row.targetIdentity.codigo || current.barcode !== row.targetIdentity.barcode)) {
        results.push({ id: row.id, line: row.line, ok: false, message: 'Os identificadores mudaram desde a prévia. Reimporte para revisar.' }); continue;
      }
      const changes = { ...row.changes }, keys = Object.keys(changes);
      if (keys.some(k => !['nome', 'categoria', 'custo', 'preco', 'estoqueAtual', 'entrada'].includes(k))) throw Error('Campo não permitido nesta importação.');
      for (const key of keys) {
        if (['custo', 'preco', 'estoqueAtual', 'entrada'].includes(key)) {
          changes[key] = Model.number(changes[key]);
          if (changes[key] === null) throw Error('Uma célula vazia não pode substituir um valor existente.');
        } else if (typeof changes[key] !== 'string' || !changes[key].trim() || changes[key].length > (key === 'nome' ? 160 : 100)) throw Error('Nome ou categoria inválidos.');
      }
      if (keys.includes('custo') && !window.TeamAccess.has('cost.view') || (keys.includes('estoqueAtual') || keys.includes('entrada')) && !window.TeamAccess.has('inventory.adjust')) throw Error('Permissão de custo/estoque alterada.');
      if ((p.productType === 'variable' || p.hasVariations) && keys.some(k => ['custo', 'preco', 'estoqueAtual', 'entrada'].includes(k))) throw Error('Produto passou a usar variações. Gere outra prévia.');
      if ((keys.includes('estoqueAtual') || keys.includes('entrada')) && current.estoqueAtual === null) throw Error('Produto não controla estoque.');
      // Every previewed value must still hold; an entry tolerates sales since the preview, an adjustment does not.
      if (Object.keys(row.before).some(k => (k !== 'estoqueAtual' || keys.includes('estoqueAtual')) && current[k] !== row.before[k])) {
        results.push({ id: row.id, line: row.line, ok: false, message: 'Dados mudaram desde a prévia. Reimporte para revisar os valores atuais.' }); continue;
      }
      const catalogFields = Object.fromEntries(keys.filter(k => ['nome', 'categoria', 'custo', 'preco'].includes(k)).map(k => [k, changes[k]]));
      if (Object.keys(catalogFields).length) track(() => window.Produtos.salvar({ ...p, ...catalogFields }));
      if (keys.includes('entrada')) track(() => window.Produtos.entrada(row.id, changes.entrada, '', 'Entrada por planilha VECONI', scope.spaceId));
      if (keys.includes('estoqueAtual')) track(() => window.Produtos.ajustarEstoque(row.id, changes.estoqueAtual, 'Ajuste por planilha VECONI', scope.spaceId));
      results.push({ id: row.id, line: row.line, ok: true, action: 'update', kinds: row.kinds || [] });
    } catch (error) {
      results.push({ id: row.id, line: row.line, ok: false, message: error.message || 'Não foi possível registrar esta linha. Nada foi alterado nela.' });
    }
    onProgress?.(results.length, creates.length + selected.length);
  }
  if (own.size) {
    try { await window.SyncFirebase?.processSyncQueue?.({ force: true }); }
    catch { /* The operations stay in the offline queue and are sent automatically. */ }
  }
  let refreshWarning = '';
  if (results.some(r => r.ok && r.action === 'create')) {
    try {
      assertContext(scope, { ownOperations: own });
      await window.SyncFirebase.pullCloudCollections({ force: true, names: ['products', 'productFinancials', 'stockMovements'] });
      window.BarcodeIndex?.invalidate?.();
      window.SyncFirebase.notifyRemoteChange(['products', 'productFinancials', 'stockMovements']);
    } catch { refreshWarning = 'Gravações confirmadas. Atualize a sincronização para recarregar este aparelho.'; }
  }
  return { results, refreshWarning };
}
