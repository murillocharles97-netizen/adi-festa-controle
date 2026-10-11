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
  return {createProducts};
}
module.exports = {productSpreadsheetService};
