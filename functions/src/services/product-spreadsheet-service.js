'use strict';
const {createHash, randomUUID} = require('node:crypto');
const {HttpsError} = require('firebase-functions/v2/https');
const {computeAccess} = require('./subscription-service');
const {assertWritable, validId} = require('./workspace-reset-policy');
const Model = require('../shared/product-model');
const Sheet = require('../shared/product-spreadsheet');
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const active = p => !p.deleted && !p.deletedAt && p.active !== false && p.ativo !== false;

function productSpreadsheetService(db, {FieldValue}) {
  async function createProducts(request) {
    const uid = request.auth?.uid, {businessId, spaceId, workspaceGeneration = 0, rows} = request.data || {};
    if (!uid) throw new HttpsError('unauthenticated', 'Entre novamente.');
    validId(businessId, 'Empresa'); validId(spaceId, 'Espaço');
    if (spaceId === 'all_spaces') throw new HttpsError('invalid-argument', 'Selecione um espaço específico.');
    if (!Array.isArray(rows) || !rows.length || rows.length > 25) throw new HttpsError('invalid-argument', 'Lote inválido (máximo 25 linhas).');
    const base = db.doc(`businesses/${businessId}`);
    return db.runTransaction(async tx => {
      const revisionRef = base.collection('productImportIdentifiers').doc('catalog-revision');
      const [businessSnap, memberSnap, profileSnap, spaceSnap] = await Promise.all([
        tx.get(base), tx.get(base.collection('members').doc(uid)), tx.get(db.doc(`users/${uid}`)), tx.get(db.doc(`financialSpaces/${spaceId}`)), tx.get(revisionRef),
      ]);
      const business = businessSnap.data(), member = memberSnap.data(), profile = profileSnap.data(), space = spaceSnap.data();
      assertWritable(business, workspaceGeneration);
      const legacy = !member && business.legacyAccessDisabled !== true && profile?.active === true && profile.businessId === businessId;
      const actor = member || (legacy ? {...profile, status:'active', spaceAccess:'all'} : null);
      const permitted = key => actor?.role === 'owner' || actor?.permissions?.[key] === true;
      if (business.active !== true || actor?.status !== 'active' || !permitted('products.edit') || !permitted('products.view')) throw new HttpsError('permission-denied', 'Sem permissão para importar produtos.');
      const access = computeAccess(business.subscription || {});
      if (!access.canMutate || !access.unlimited && !access.features.spreadsheetImport) throw new HttpsError('permission-denied', 'Importação disponível a partir do plano Gestão ativo.');
      if (!space || space.active === false || space.businessId !== businessId || space.linkedBusinessId && space.linkedBusinessId !== businessId || space.capabilities?.products !== true || actor.spaceAccess !== 'all' && !(actor.allowedSpaceIds || []).includes(spaceId)) throw new HttpsError('permission-denied', 'Espaço não autorizado para produtos.');
      const scope = {businessId, spaceId, allowedSpaceIds:[spaceId], allSpaces:actor.spaceAccess === 'all'};
      const permissions = {cost:permitted('cost.view'), stock:permitted('inventory.adjust')};
      // Revalidate identifiers inside the transaction, including products added after preview.
      // A small projected catalog also supplies the authoritative plan-limit count.
      const [catalogSnap, variantsSnap] = await Promise.all([
        tx.get(base.collection('products').select('codigo','barcode','alternateBarcodes','nome','ativo','active','deleted','deletedAt','spaceAccessMode','allowedSpaceIds')),
        tx.get(base.collection('productVariants').select('parentProductId','sku','codigo','barcode','active','deleted','deletedAt')),
      ]);
      const catalog = catalogSnap.docs.map(doc => ({...doc.data(), id:doc.id, businessId}));
      const scoped = catalog.filter(p => Sheet.inScope(p, scope, true)), parents = new Set(scoped.map(p => p.id));
      const variants = variantsSnap.docs.map(doc => ({...doc.data(), id:doc.id})).filter(v => !v.deleted && !v.deletedAt && parents.has(v.parentProductId));
      const table = [Sheet.columns.map(c => c[0]), ...rows.map(row => {
        if (!row || typeof row !== 'object' || !Number.isInteger(row.line) || row.line < 2 || !row.data || Object.keys(row.data).some(key => !['nome','codigo','barcode','categoria','custo','preco','estoqueAtual'].includes(key))) throw new HttpsError('invalid-argument', 'Linha inválida.');
        return Sheet.columns.map(([,key]) => row.data[key] ?? null);
      })];
      const preview = Sheet.preview(table, [], scope, permissions, 'create_update');
      if (preview.rows.length !== rows.length) throw new HttpsError('invalid-argument', 'O lote contém linhas vazias.');
      const prepared = preview.rows.map((row, index) => {
        if (row.status !== 'create') return {row, input:rows[index]};
        const key = digest([workspaceGeneration, spaceId, {...row.create, custo:row.create.custo ?? 0, preco:row.create.preco ?? 0, estoqueAtual:row.create.estoqueAtual ?? 0}]);
        return {row, input:rows[index], key, id:`sheet_${key}`, marker:base.collection('productImportOperations').doc(key)};
      });
      const markers = await Promise.all(prepared.map(item => item.marker ? tx.get(item.marker) : null));
      const claims = new Map();
      for (const {row} of prepared) if (row.status === 'create') for (const [kind,value] of [['sku',row.create.codigo],['ean',row.create.barcode]]) {
        if (!value) continue;
        const key = digest([kind,value]);
        if (!claims.has(key)) { const ref = base.collection('productImportIdentifiers').doc(key); claims.set(key,{ref,productIds:(await tx.get(ref)).data()?.productIds || []}); }
      }
      let count = catalog.filter(active).length;
      const results = [], timestamp = new Date().toISOString();
      for (let index = 0; index < prepared.length; index++) {
        const {row, input, key, id, marker} = prepared[index];
        const fail = message => results.push({line:input.line, ok:false, message});
        if (row.status !== 'create') { fail(row.errors.join(' ')); continue; }
        if (markers[index]?.exists) { results.push({line:input.line, id, ok:true, action:'create', replayed:true}); continue; }
        const data = row.create;
        if (scoped.some(p => data.codigo && String(p.codigo ?? '').trim() === data.codigo || data.barcode && (p.barcode === data.barcode || (p.alternateBarcodes || []).includes(data.barcode))) || variants.some(v => data.codigo && (v.sku || v.codigo) === data.codigo || data.barcode && v.barcode === data.barcode)) {
          fail('SKU/EAN já existe na nuvem. Gere outra prévia; nenhum produto foi criado.'); continue;
        }
        if (catalog.some(p => p.id === id)) { fail('Identificador já utilizado. Confira o cadastro antes de continuar.'); continue; }
        if (!access.unlimited && Number.isFinite(access.limits?.products) && count >= access.limits.products) { fail('Limite de produtos do plano atingido.'); continue; }
        const barcodeType = /^\d{13}$/.test(data.barcode) ? 'ean_13' : /^\d{8}$/.test(data.barcode) ? 'ean_8' : /^\d{12}$/.test(data.barcode) ? 'upc_a' : null;
        const product = Model.build({...data, spaceAccessMode:'single_space', allowedSpaceIds:[spaceId], defaultSpaceId:spaceId}, null, {agora:timestamp, barcode:data.barcode, barcodeType});
        const cost = product.custo; delete product.custo;
        const stamp = {businessId, workspaceGeneration, ownerId:business.ownerId, actorUid:uid, updatedByUid:uid, createdAt:FieldValue.serverTimestamp(), updatedAt:FieldValue.serverTimestamp()};
        tx.create(base.collection('products').doc(id), {...product, ...stamp, id, criadoEm:timestamp, operationId:key, spreadsheetImportOperationId:key, version:1});
        if (permissions.cost) tx.create(base.collection('productFinancials').doc(id), {...stamp, id, productId:id, custo:cost, schemaVersion:1});
        if (product.estoqueAtual !== 0) tx.create(base.collection('stockMovements').doc(key), {...stamp, id:key, operationId:key, produtoId:id, produtoNome:product.nome, tipo:'entrada', quantidade:product.estoqueAtual, estoqueAnterior:0, estoqueNovo:product.estoqueAtual, observacao:'Estoque inicial — importação VECONI', data:timestamp, spaceId, schemaVersion:3});
        tx.create(marker, {businessId, workspaceGeneration, productId:id, actorUid:uid, operationId:key, createdAt:FieldValue.serverTimestamp()});
        for (const [kind,value] of [['sku',data.codigo],['ean',data.barcode]]) if (value) {
          const claim = claims.get(digest([kind,value]));
          claim.productIds = [...new Set([...claim.productIds,id])];
          tx.set(claim.ref,{businessId,workspaceGeneration,productIds:claim.productIds,updatedAt:FieldValue.serverTimestamp()});
        }
        scoped.push({...product, id}); count++;
        results.push({line:input.line, id, ok:true, action:'create', replayed:false});
      }
      // All concurrent import batches share a write fence, including disjoint identifiers/plan limits.
      if (results.some(r => r.ok && !r.replayed)) tx.set(revisionRef, {businessId, workspaceGeneration, revision:FieldValue.increment(1), commitToken:randomUUID(), updatedAt:FieldValue.serverTimestamp()}, {merge:true});
      return {results};
    });
  }
  // "Corrigir SKU/EAN": changes ONLY codigo/barcode of existing products, identified by
  // their immutable ID. Never touches stock, cost, price, sales or movements (so it can
  // not produce stock_alias_mismatch for pending offline sales, which validate only the
  // stock fields). The old code goes to identifierHistory, never to alternateBarcodes.
  // Idempotent per operationId: a lost response replays the stored results.
  async function correctIdentifiers(request) {
    const uid = request.auth?.uid, {businessId, spaceId, workspaceGeneration = 0, operationId, rows} = request.data || {};
    if (!uid) throw new HttpsError('unauthenticated', 'Entre novamente.');
    validId(businessId, 'Empresa');
    if (spaceId !== 'all_spaces') validId(spaceId, 'Espaço');
    if (typeof operationId !== 'string' || !/^[A-Za-z0-9_-]{16,80}$/.test(operationId)) throw new HttpsError('invalid-argument', 'Operação inválida.');
    if (!Array.isArray(rows) || !rows.length || rows.length > 25) throw new HttpsError('invalid-argument', 'Lote inválido (máximo 25 linhas).');
    const code = value => typeof value === 'string' && value.length <= 100;
    for (const row of rows) if (!row || typeof row !== 'object' || !Number.isInteger(row.line) || row.line < 2 || typeof row.id !== 'string' || !/^[^/]{1,200}$/.test(row.id)
      || !row.before || !row.next || !['codigo','barcode'].every(k => code(row.before[k]) && code(row.next[k]) && (row.next[k] !== '' || row.before[k] === ''))) throw new HttpsError('invalid-argument', 'Linha inválida.');
    if (new Set(rows.map(r => r.id)).size !== rows.length) throw new HttpsError('invalid-argument', 'Produto repetido no lote.');
    const base = db.doc(`businesses/${businessId}`), requestDigest = digest(rows.map(r => [r.line, r.id, r.before.codigo, r.before.barcode, r.next.codigo, r.next.barcode]));
    const markerKey = digest(['identifiers', businessId, workspaceGeneration, operationId]), markerRef = base.collection('productImportOperations').doc(markerKey);
    return db.runTransaction(async tx => {
      const revisionRef = base.collection('productImportIdentifiers').doc('catalog-revision');
      const [businessSnap, memberSnap, profileSnap, spaceSnap, , markerSnap] = await Promise.all([
        tx.get(base), tx.get(base.collection('members').doc(uid)), tx.get(db.doc(`users/${uid}`)), spaceId === 'all_spaces' ? null : tx.get(db.doc(`financialSpaces/${spaceId}`)), tx.get(revisionRef), tx.get(markerRef),
      ]);
      const business = businessSnap.data(), member = memberSnap.data(), profile = profileSnap.data(), space = spaceSnap?.data();
      assertWritable(business, workspaceGeneration);
      const legacy = !member && business.legacyAccessDisabled !== true && profile?.active === true && profile.businessId === businessId;
      const actor = member || (legacy ? {...profile, status:'active', spaceAccess:'all'} : null);
      const permitted = key => actor?.role === 'owner' || actor?.permissions?.[key] === true;
      if (business.active !== true || actor?.status !== 'active' || !permitted('products.edit') || !permitted('products.view')) throw new HttpsError('permission-denied', 'Sem permissão para corrigir códigos de produtos.');
      const access = computeAccess(business.subscription || {});
      if (!access.canMutate || !access.unlimited && !access.features.spreadsheetImport) throw new HttpsError('permission-denied', 'Importação disponível a partir do plano Gestão ativo.');
      if (spaceId === 'all_spaces' ? actor.spaceAccess !== 'all' : !space || space.active === false || space.businessId !== businessId || space.linkedBusinessId && space.linkedBusinessId !== businessId || space.capabilities?.products !== true || actor.spaceAccess !== 'all' && !(actor.allowedSpaceIds || []).includes(spaceId)) throw new HttpsError('permission-denied', 'Espaço não autorizado para produtos.');
      if (markerSnap.exists) {
        const marker = markerSnap.data();
        if (marker.requestDigest !== requestDigest || marker.actorUid !== uid) throw new HttpsError('failed-precondition', 'Esta operação já foi usada com outros dados. Gere outra prévia.');
        return {results:(marker.results || []).map(r => ({...r, replayed:true}))};
      }
      const scope = {businessId, spaceId, allowedSpaceIds:spaceId === 'all_spaces' ? [] : [spaceId], allSpaces:actor.spaceAccess === 'all'};
      // Whole company, including inactive products, other spaces, variations and alternates.
      const [catalogSnap, variantsSnap] = await Promise.all([
        tx.get(base.collection('products').select('codigo','barcode','alternateBarcodes','nome','ativo','active','deleted','deletedAt','spaceAccessMode','allowedSpaceIds')),
        tx.get(base.collection('productVariants').select('parentProductId','sku','codigo','barcode','displayName','active','deleted','deletedAt')),
      ]);
      const catalog = {products:catalogSnap.docs.map(doc => ({...doc.data(), id:doc.id, businessId})), variants:variantsSnap.docs.map(doc => ({...doc.data(), id:doc.id}))};
      const table = [Sheet.columns.slice(0, 3).map(c => c[0]), ...rows.map(r => [r.id, r.next.codigo, r.next.barcode])];
      const preview = Sheet.previewIdentifiers(table, catalog, scope);
      const targets = await Promise.all(rows.map(r => tx.get(base.collection('products').doc(r.id))));
      const claimRefs = new Map();
      for (const r of rows) for (const [kind, value] of [['sku', r.next.codigo], ['ean', r.next.barcode]]) if (value) { const key = digest([kind, value.trim()]); if (!claimRefs.has(key)) claimRefs.set(key, base.collection('productImportIdentifiers').doc(key)); }
      const claimSnaps = new Map(await Promise.all([...claimRefs].map(async ([key, ref]) => [key, await tx.get(ref)])));
      const results = [], timestamp = new Date().toISOString(), writes = [];
      rows.forEach((r, index) => {
        const row = preview.rows[index], doc = targets[index].data(), current = {codigo:String(doc?.codigo ?? '').trim(), barcode:String(doc?.barcode ?? '').trim()};
        const result = {line:r.line, id:r.id, before:current, next:r.next};
        if (!doc || row.status === 'invalid') return results.push({...result, ok:false, state:row.conflict ? 'conflict' : 'failed', message:row.errors.join(' ') || 'Produto não encontrado.'});
        if (current.codigo === r.next.codigo && current.barcode === r.next.barcode) return results.push({...result, ok:true, state:'unchanged'});
        if (current.codigo !== r.before.codigo || current.barcode !== r.before.barcode) return results.push({...result, ok:false, state:'conflict', message:'Os códigos deste produto mudaram desde a prévia. Exporte de novo e revise.'});
        const changedBarcode = current.barcode !== r.next.barcode, barcode = r.next.barcode;
        const history = (Array.isArray(doc.identifierHistory) ? doc.identifierHistory : []).slice(-19);
        history.push({at:timestamp, actorUid:uid, operationId:markerKey, source:'spreadsheet_identifier_correction', before:current, after:{codigo:r.next.codigo, barcode}, previousCodesActive:false});
        writes.push({id:r.id, patch:{codigo:r.next.codigo, barcode, ...(changedBarcode ? {barcodeType:/^\d{13}$/.test(barcode) ? 'ean_13' : /^\d{8}$/.test(barcode) ? 'ean_8' : /^\d{12}$/.test(barcode) ? 'upc_a' : null, barcodeUpdatedAt:timestamp} : {}),
          identifierHistory:history, identifierCorrectionOperationId:markerKey, atualizadoEm:timestamp, updatedByUid:uid, actorUid:uid, updatedAt:FieldValue.serverTimestamp(), version:FieldValue.increment(1)}});
        results.push({...result, ok:true, state:'corrected'});
      });
      // All reads are done: write products, identifier claims, the shared fence and the receipt.
      for (const {id, patch} of writes) tx.update(base.collection('products').doc(id), patch);
      for (const {id, patch} of writes) for (const [kind, value] of [['sku', patch.codigo], ['ean', patch.barcode]]) if (value) {
        const key = digest([kind, value.trim()]), snap = claimSnaps.get(key), productIds = [...new Set([...(snap?.data()?.productIds || []), id])];
        claimSnaps.set(key, {data:() => ({productIds})});
        tx.set(claimRefs.get(key), {businessId, workspaceGeneration, productIds, updatedAt:FieldValue.serverTimestamp()});
      }
      if (writes.length) tx.set(revisionRef, {businessId, workspaceGeneration, revision:FieldValue.increment(1), commitToken:randomUUID(), updatedAt:FieldValue.serverTimestamp()}, {merge:true});
      tx.create(markerRef, {businessId, workspaceGeneration, actorUid:uid, operationId:markerKey, kind:'identifier_correction', requestDigest, results, createdAt:FieldValue.serverTimestamp()});
      return {results};
    });
  }
  return {createProducts, correctIdentifiers};
}
module.exports = {productSpreadsheetService};
