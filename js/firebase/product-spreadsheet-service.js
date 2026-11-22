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
function assertContext(scope, { ownOperations = null, queue = true } = {}) {
  const live = capture();
  if (JSON.stringify(live) !== JSON.stringify(scope)) throw Error('Empresa, espaço ou acesso mudou. Feche e abra a importação novamente.');
  if (!queue) return;
  // Only ACTIVE queue items block; resolved/archived history is kept forever for audit.
  const active = (window.SyncFirebase?.getQueueDiagnostics?.() || []).filter(item => !ACTIVE_IGNORED.has(item.category) &&
    !(ownOperations && ownOperations.has(String(item.operationId))));
  if (active.length) throw Object.assign(Error('Sincronize as operações pendentes antes de importar ou exportar.'), { code: 'spreadsheet-queue-active' });
}
// Read-only export only. An item is tolerated ONLY when Sync will never send it again on its own
// (held for review: not sendable, not retryable, replay blocked). Pending, sending, preparing and
// RETRYABLE errors still block. Nothing in the queue is read beyond its diagnostics or changed.
const neverResent = item => item.sendable === false && item.canRetry === false && item.replayBlocked === true &&
  (item.category === 'manual_review' || item.category === 'quarantined' || item.category === 'error' && Boolean(item.reviewReason));
function assertExportQueue() {
  const blocking = (window.SyncFirebase?.getQueueDiagnostics?.() || []).filter(item => !ACTIVE_IGNORED.has(item.category) && !neverResent(item));
  if (blocking.length) throw Object.assign(Error(`${blocking.length} operação(ões) ainda podem ser enviadas ou reenviadas. Aguarde a sincronização terminar antes de exportar; nada foi alterado.`), { code: 'spreadsheet-export-queue-active' });
}
// exportOnly: same company/space/permission checks and the same SERVER reads (getDocsFromServer,
// memory cache only); the result is marked so it can never feed an import or a code correction.
export async function loadCatalog({ exportOnly = false } = {}) {
  const check = scope => { if (exportOnly) { assertContext(scope, { queue: false }); assertExportQueue(); } else assertContext(scope); };
  const scope = capture(); check(scope);
  const permissions = { cost: window.TeamAccess.has('cost.view'), stock: window.TeamAccess.has('inventory.adjust'), edit: window.TeamAccess.has('products.edit') };
  const [products, financials, variants] = await Promise.all([
    createFirestoreRepository('products').listAllPaged(200),
    permissions.cost ? createFirestoreRepository('productFinancials').listAllPaged(200) : [],
    createFirestoreRepository('productVariants').listAllPaged(200),
  ]);
  check(scope);
  const costs = new Map(financials.map(f => [f.productId || f.id, f]));
  const visible = products.filter(p => Model.inScope(p, scope)).map(p => ({ ...p,
    custo: permissions.cost ? costs.get(p.id)?.custo ?? p.custo ?? null : null,
  }));
  const inactive = products.filter(p => Model.inScope(p, scope, true) && !Model.inScope(p, scope));
  const byId = new Map([...visible, ...inactive].map(p => [p.id, p]));
  const reservations = variants.filter(v => byId.has(v.parentProductId) && !v.deleted && !v.deletedAt).map(v => ({...byId.get(v.parentProductId), id:`variant:${v.id}`, codigo:v.sku || v.codigo || '', barcode:v.barcode || '', identifierReservation:true}));
  for (const p of byId.values()) for (const barcode of p.alternateBarcodes || []) reservations.push({...p, id:`alternate:${p.id}:${barcode}`, codigo:'', barcode, identifierReservation:true});
  // Whole company (all spaces, inactive, variations): codes must be unique across it.
  const identifierCatalog = { products: products.map(p => ({ ...p, businessId: p.businessId || scope.businessId })), variants };
  return {scope, permissions, products:visible, matchingProducts:[...visible, ...inactive, ...reservations], identifierCatalog, ...(exportOnly ? { exportOnly: true } : {})};
}

// "Corrigir SKU/EAN": sent ONLY to the trusted callable (never through the Sync queue),
// in blocks of 25. Each block has a stable operationId: an unanswered call is repeated
// with the SAME id, and the server replays its receipt instead of applying twice.
const UNKNOWN = ['internal', 'unavailable', 'deadline-exceeded', 'unknown', 'aborted'];
const newOperationId = () => (crypto.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');
export async function applyIdentifierCorrections(catalog, preview, onProgress) {
  if (catalog?.exportOnly) throw Error('Correção de códigos indisponível: há operações em revisão em Sincronização.');
  assertContext(catalog.scope);
  if (preview?.mode !== 'identifiers') throw Error('Prévia de correção de códigos inválida.');
  if (!window.TeamAccess.has('products.edit')) throw Error('Você não tem permissão para editar produtos.');
  const scope = catalog.scope, selected = preview.rows.filter(row => row.status === 'update'), results = [];
  for (let offset = 0; offset < selected.length; offset += 25) {
    const block = selected.slice(offset, offset + 25), operationId = newOperationId();
    const payload = { businessId: scope.businessId, spaceId: scope.spaceId, workspaceGeneration: scope.generation, operationId,
      rows: block.map(row => ({ line: row.line, id: row.id, before: row.before, next: row.next })) };
    let response = null, failure = null;
    for (let attempt = 0; attempt < 3 && !response; attempt++) {
      try { assertContext(scope, { queue: false }); response = await window.FirebaseCallable('correctSpreadsheetIdentifiers', payload); }
      catch (error) {
        failure = error;
        const unknown = UNKNOWN.includes(String(error?.code || '').replace(/^functions\//, '')) && !error?.details?.reason;
        if (!unknown || !navigator.onLine) break;
        await new Promise(resolve => setTimeout(resolve, 800 * (attempt + 1)));
      }
    }
    if (response) results.push(...(response.data || response).results);
    else {
      const unknown = UNKNOWN.includes(String(failure?.code || '').replace(/^functions\//, ''));
      results.push(...block.map(row => ({ line: row.line, id: row.id, before: row.before, next: row.next, ok: false, state: unknown ? 'pending' : 'failed',
        message: unknown ? 'Sem confirmação do servidor. Importe a mesma planilha de novo: o que já foi corrigido aparecerá como "sem alteração".' : failure?.message || 'Não foi possível corrigir este bloco. Nada foi alterado nele.' })));
    }
    onProgress?.(Math.min(offset + 25, selected.length), selected.length);
  }
  // The server is the source of truth; refresh this device before reporting success.
  let refreshed = true;
  if (results.some(r => r.ok && r.state === 'corrected')) {
    try {
      await window.SyncFirebase.pullCloudCollections({ force: true, names: ['products'] });
      window.BarcodeIndex?.invalidate?.();
      window.SyncFirebase.notifyRemoteChange?.(['products']);
    } catch { refreshed = false; }
  }
  return { results, refreshed };
}

// Optimistic read/compare/write transactions, not blind full-document overwrites.
// Existing workspace writer supplies reset generation, existing listeners hydrate IndexedDB.
// An entry registered from a sheet carries its id in the movement note; the same
// sheet (same content) can be re-imported after an interruption without adding twice.
const entryNote = sheetId => `Entrada por planilha VECONI #${sheetId}`;
// Entries of a block REJECTED by the server exist only on this device: they do not count
// as registered, so a re-import can apply them again (the rejected original stays in Sync).
let rejectedCache = { at: 0, ids: new Set() };
function rejectedOperations() {
  if (Date.now() - rejectedCache.at > 1000) rejectedCache = { at: Date.now(), ids: new Set((window.SyncFirebase?.getQueueDiagnostics?.() || [])
    .filter(item => item.category === 'error').map(item => String(item.operationId))) };
  return rejectedCache.ids;
}
// Entries confirmed in the CLOUD for this sheet (the device may not keep every movement
// after a restart). Read before the preview and again before applying; if the check
// fails the import does not continue.
const cloudEntries = new Map();
export async function prefetchSheetEntries(sheetId) {
  if (!/^[0-9a-f]{16}$/.test(sheetId || '')) return;
  const rows = await createFirestoreRepository('stockMovements').listWherePaged('observacao', entryNote(sheetId), 200);
  cloudEntries.set(sheetId, new Set(rows.filter(m => m.tipo === 'entrada').map(m => String(m.produtoId))));
}
export function entryApplied(sheetId, productId) {
  if (!/^[0-9a-f]{16}$/.test(sheetId || '')) return false;
  if (cloudEntries.get(sheetId)?.has(String(productId))) return true;
  const rejected = rejectedOperations();
  return (window.DB?.carregar?.().movimentacoesEstoque || []).some(m => m.produtoId === productId && m.tipo === 'entrada' &&
    m.observacao === entryNote(sheetId) && !rejected.has(String(m.operationId)));
}
export async function applyPreview(catalog, preview, onProgress, { sheetId = '' } = {}) {
  if (catalog?.exportOnly) throw Error('Importação indisponível: há operações em revisão em Sincronização.');
  assertContext(catalog.scope);
  if (preview.rows.some(row => row.status === 'update' && Object.hasOwn(row.changes, 'entrada'))) {
    try { await prefetchSheetEntries(sheetId); }
    catch { throw Error('Não foi possível conferir na nuvem as entradas já registradas desta planilha. Nada foi alterado; tente novamente.'); }
  }
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
      const unknown = ['internal', 'unavailable', 'deadline-exceeded', 'unknown'].includes(String(error?.code || '').replace(/^functions\//, '')) && !error?.details?.reason;
      results.push(...creates.slice(offset).map(row => ({line:row.line, ok:false, message:unknown ? 'Sem resposta confirmada do servidor. Importe a mesma planilha de novo: produtos já criados serão reconhecidos pelo SKU/EAN e não serão duplicados.' : error.message || 'Não foi possível confirmar a criação. Gere outra prévia; o reenvio é protegido contra duplicidade.'})));
      onProgress?.(results.length, creates.length + selected.length); break;
    }
    onProgress?.(results.length, creates.length + selected.length);
  }
  // Updates go through the app's own validated, offline-first flows (Sync queue →
  // commitOperationalSync). Direct client writes to stock are forbidden by the Rules.
  // Catalog fields → Produtos.salvar (never touches stock); goods received →
  // Produtos.entrada (relative, safe with concurrent sales); absolute quantity →
  // Produtos.ajustarEstoque (only when the stock is still the one previewed).
  // Pending work from BEFORE the import was refused at the start; inside the loop only
  // business/space/access are re-checked (cheap), so 300 rows stay linear.
  const intents = [], operationIds = new Set();
  // Cost lives in productFinancials (cloud); the local copy may not carry it yet.
  const cloud = new Map((catalog.matchingProducts || catalog.products || []).map(item => [item.id, item]));
  for (const row of selected) {
    try {
      assertContext(scope, { queue: false });
      if (!/^[^/]{1,200}$/.test(row.id)) throw Error('ID inválido.');
      const p = window.Produtos.obter(row.id);
      if (!Model.inScope(p, scope)) { results.push({ id: row.id, line: row.line, ok: false, message: 'Produto removido ou fora do espaço selecionado.' }); continue; }
      const current = Model.values({ ...p, custo: p.custo ?? cloud.get(row.id)?.custo ?? null }, window.TeamAccess.has('cost.view'));
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
      const intent = { row, catalogFields, entrada: null, ajuste: null };
      if (keys.includes('entrada')) {
        if (entryApplied(sheetId, row.id)) { results.push({ id: row.id, line: row.line, ok: true, action: 'update', skipped: 'entrada já registrada por esta planilha' }); continue; }
        intent.entrada = { quantidade: changes.entrada, observacao: /^[0-9a-f]{16}$/.test(sheetId) ? entryNote(sheetId) : 'Entrada por planilha VECONI', spaceId: scope.spaceId };
      }
      if (keys.includes('estoqueAtual')) intent.ajuste = { novoEstoque: changes.estoqueAtual, motivo: 'Ajuste por planilha VECONI', spaceId: scope.spaceId };
      intents.push(intent);
    } catch (error) {
      results.push({ id: row.id, line: row.line, ok: false, message: error.message || 'Não foi possível registrar esta linha. Nada foi alterado nela.' });
    }
  }
  // Blocks of up to 25 products per kind (catalog, entry, adjustment): each block is ONE
  // Sync operation validated by commitOperationalSync, atomic on the device and on the
  // server. A failed block applies none of its rows.
  const blockSize = Math.min(25, window.Produtos.LOTE_MAX || 25), kinds = [
    ['catalog', i => Object.keys(i.catalogFields).length ? { id: i.row.id, catalog: i.catalogFields } : null],
    ['entrada', i => i.entrada ? { id: i.row.id, entrada: i.entrada } : null],
    ['ajuste', i => i.ajuste ? { id: i.row.id, ajuste: i.ajuste } : null]];
  const failed = new Map(), queueIds = () => new Set((window.SyncFirebase?.getQueueDiagnostics?.() || []).map(item => String(item.operationId)));
  for (const [kind, pick] of kinds) {
    const pending = intents.filter(i => !failed.has(i.row.id)).map(i => [i, pick(i)]).filter(([, item]) => item);
    for (let offset = 0; offset < pending.length; offset += blockSize) {
      const block = pending.slice(offset, offset + blockSize);
      onProgress?.(results.length + Math.min(intents.length, offset), creates.length + selected.length);
      await new Promise(resolve => setTimeout(resolve, 0));
      try {
        assertContext(scope, { queue: false });
        const before = queueIds();
        if (typeof window.Produtos.aplicarLote === 'function') window.Produtos.aplicarLote(block.map(([, item]) => item));
        else for (const [, item] of block) { // older cached app: one operation per product
          if (item.catalog) window.Produtos.salvar({ ...window.Produtos.obter(item.id), ...item.catalog });
          if (item.entrada) window.Produtos.entrada(item.id, item.entrada.quantidade, '', item.entrada.observacao, item.entrada.spaceId);
          if (item.ajuste) window.Produtos.ajustarEstoque(item.id, item.ajuste.novoEstoque, item.ajuste.motivo, item.ajuste.spaceId);
        }
        for (const id of queueIds()) if (!before.has(id)) operationIds.add(id);
      } catch (error) {
        for (const [intent] of block) failed.set(intent.row.id, error.message || 'Não foi possível registrar este bloco. Nada foi alterado nele.');
      }
    }
  }
  for (const intent of intents) results.push(failed.has(intent.row.id)
    ? { id: intent.row.id, line: intent.row.line, ok: false, message: failed.get(intent.row.id) }
    : { id: intent.row.id, line: intent.row.line, ok: true, action: 'update', kinds: intent.row.kinds || [] });
  onProgress?.(results.length, creates.length + selected.length);
  // Sending runs in the background through the normal Sync (offline-safe, retried
  // automatically); the import report does not wait for the whole queue.
  if (operationIds.size) window.SyncFirebase?.processSyncQueue?.({ force: true })?.catch?.(() => {});
  let refreshWarning = '';
  if (results.some(r => r.ok && r.action === 'create')) {
    try {
      assertContext(scope, { queue: false });
      await window.SyncFirebase.pullCloudCollections({ force: true, names: ['products', 'productFinancials', 'stockMovements'] });
      window.BarcodeIndex?.invalidate?.();
      window.SyncFirebase.notifyRemoteChange(['products', 'productFinancials', 'stockMovements']);
    } catch { refreshWarning = 'Gravações confirmadas. Atualize a sincronização para recarregar este aparelho.'; }
  }
  if (operationIds.size) refreshWarning = `${refreshWarning} Registrado neste aparelho. Enviando para a nuvem em ${operationIds.size} blocos.`.trim();
  return { results, refreshWarning, queued: operationIds.size, operationIds: [...operationIds] };
}
