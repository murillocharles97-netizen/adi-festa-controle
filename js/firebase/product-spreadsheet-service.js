import { auth, db } from './firebase-config.js';
import { doc, runTransaction, serverTimestamp, increment } from './workspace-firestore.js';
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
function assertContext(scope) {
  const live = capture();
  if (JSON.stringify(live) !== JSON.stringify(scope)) throw Error('Empresa, espaço ou acesso mudou. Feche e abra a importação novamente.');
  if ((window.SyncFirebase?.getQueueDiagnostics?.() || []).length) throw Error('Sincronize as operações pendentes antes de importar ou exportar.');
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
  // Small atomic groups stay below Rules document-access limits, even with stock/cost writes.
  for (let offset = 0; offset < selected.length; offset += 5) {
    const batch = selected.slice(offset, offset + 5);
    try {
      assertContext(scope);
      const done = await runTransaction(db, async tx => {
        assertContext(scope);
        const loaded = await Promise.all(batch.map(async row => {
          if (!/^[^/]{1,200}$/.test(row.id)) throw Error('ID inválido.');
          const ref = doc(db, 'businesses', scope.businessId, 'products', row.id), snap = await tx.get(ref);
          const costRef = doc(db, 'businesses', scope.businessId, 'productFinancials', row.id);
          const cost = Object.hasOwn(row.changes, 'custo') ? await tx.get(costRef) : null;
          return { row, ref, costRef, p: snap.exists() ? { ...snap.data(), id: snap.id } : null, cost: cost?.exists() ? cost.data() : null };
        }));
        const outcomes = [];
        for (const { row, ref, costRef, p, cost } of loaded) {
          if (!Model.inScope(p, scope)) { outcomes.push({ id: row.id, line: row.line, ok: false, message: 'Produto removido ou fora do espaço selecionado.' }); continue; }
          const current = Model.values({ ...p, custo: cost?.custo ?? p.custo ?? null });
          if (row.targetIdentity && (current.codigo !== row.targetIdentity.codigo || current.barcode !== row.targetIdentity.barcode)) {
            outcomes.push({id:row.id, line:row.line, ok:false, message:'Os identificadores mudaram desde a prévia. Reimporte para revisar.'}); continue;
          }
          const changes = { ...row.changes }, keys = Object.keys(changes);
          const allowed = ['nome', 'categoria', 'custo', 'preco', 'estoqueAtual'];
          if (keys.some(k => !allowed.includes(k))) throw Error('Campo não permitido nesta importação.');
          for (const key of keys) {
            if (['custo', 'preco', 'estoqueAtual'].includes(key)) {
              changes[key] = Model.number(changes[key]);
              if (changes[key] === null) throw Error('Uma célula vazia não pode substituir um valor existente.');
            } else if (typeof changes[key] !== 'string' || !changes[key].trim() || changes[key].length > (key === 'nome' ? 160 : 100)) throw Error('Nome ou categoria inválidos.');
          }
          if (keys.includes('custo') && !window.TeamAccess.has('cost.view') || keys.includes('estoqueAtual') && !window.TeamAccess.has('inventory.adjust')) throw Error('Permissão de custo/estoque alterada.');
          if ((p.productType === 'variable' || p.hasVariations) && keys.some(k => ['custo', 'preco', 'estoqueAtual'].includes(k))) throw Error('Produto passou a usar variações. Gere outra prévia.');
          if (keys.includes('estoqueAtual') && current.estoqueAtual === null) throw Error('Produto não controla estoque.');
          if (keys.some(k => current[k] !== row.before[k])) {
            outcomes.push({ id: row.id, line: row.line, ok: false, message: 'Dados mudaram desde a prévia. Reimporte para revisar os valores atuais.' }); continue;
          }
          const patch = {}, timestamp = new Date().toISOString(), operationId = `spreadsheet-${crypto.randomUUID()}`;
          for (const key of keys) {
            if (['custo', 'preco', 'estoqueAtual'].includes(key)) Model.number(changes[key]);
            if (key !== 'custo') patch[key] = changes[key];
          }
          if (keys.includes('custo')) tx.set(costRef, { id: row.id, productId: row.id, businessId: scope.businessId, custo: changes.custo,
            ownerId: scope.uid, updatedByUid: scope.uid, schemaVersion: 1, updatedAt: serverTimestamp() }, { merge: true });
          if (keys.includes('estoqueAtual')) {
            patch.estoque = changes.estoqueAtual;
            tx.set(doc(db, 'businesses', scope.businessId, 'stockMovements', operationId), {
              id: operationId, operationId, businessId: scope.businessId, ownerId: scope.uid,
              ...(window.TeamAccess.actor?.() || {}), produtoId: row.id, produtoNome: p.nome, tipo: 'ajuste',
              quantidade: changes.estoqueAtual - current.estoqueAtual, estoqueAnterior: current.estoqueAtual,
              estoqueNovo: changes.estoqueAtual, observacao: 'Importação de planilha VECONI',
              data: timestamp, createdAt: serverTimestamp(), updatedAt: serverTimestamp(), schemaVersion: 3,
            });
          }
          tx.update(ref, { ...patch, spreadsheetImportOperationId:operationId, businessId: scope.businessId, atualizadoEm: timestamp, updatedAt: serverTimestamp(), updatedByUid: scope.uid, version: increment(1) });
          outcomes.push({ id: row.id, line: row.line, ok: true, action:'update' });
        }
        return outcomes;
      });
      results.push(...done);
    } catch (error) {
      // A failed transaction commits none of this group; previously completed groups remain explicit.
      results.push(...batch.map(row => ({ id: row.id, line: row.line, ok: false, message: error.message || 'Falha ao confirmar gravação na nuvem.' })));
      if (!navigator.onLine || ['permission-denied', 'unavailable'].includes(error.code)) {
        results.push(...selected.slice(offset + 5).map(row => ({ id: row.id, line: row.line, ok: false, message: 'Não processado. Verifique conexão/acesso e gere nova prévia.' })));
        onProgress?.(results.length, creates.length + selected.length); break;
      }
    }
    onProgress?.(results.length, creates.length + selected.length);
  }
  let refreshWarning = '';
  if (results.some(r => r.ok)) {
    try {
      assertContext(scope);
      await window.SyncFirebase.pullCloudCollections({ force: true, names: ['products', 'productFinancials', 'stockMovements'] });
      window.BarcodeIndex?.invalidate?.();
      window.SyncFirebase.notifyRemoteChange(['products', 'productFinancials', 'stockMovements']);
    } catch { refreshWarning = 'Gravações confirmadas. Atualize a sincronização para recarregar este aparelho.'; }
  }
  return { results, refreshWarning };
}
