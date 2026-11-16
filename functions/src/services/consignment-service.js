'use strict';

const { createHash } = require('node:crypto');
const { HttpsError } = require('firebase-functions/v2/https');
const { Timestamp, FieldValue } = require('firebase-admin/firestore');
const { validId, generation, assertWritable, belongsToWorkspace } = require('./workspace-reset-policy');
const { computeAccess } = require('./subscription-service');
const { storeId } = require('./online-store-service');
const { stockKey } = require('./online-stock-reservation');
const { allowsExchangeProduct } = require('../shared/exchange-product-scope');
const Model = require('../shared/online-store');

const fail = (code, message) => { throw new HttpsError(code, message); };
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const checksum = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const eligible = p => Model.active(p) && p.itemKind !== 'service' &&
  !['service', 'recurring'].includes(p.productType) && !p.semControleEstoque && p.controlaEstoque !== false && p.controlarEstoque !== false;
const stockFields = stock => ({ estoqueAtual: stock, estoque: stock, totalStock: stock });
const isoDate = (when, zone) => new Intl.DateTimeFormat('sv-SE', { timeZone: zone, dateStyle: 'short' }).format(when);
const limit = 30;

function consignmentService(db, now = () => new Date()) {
  const scoped = (c, row) => row?.businessId === c.businessId && (row.workspaceGeneration ?? 0) === c.workspaceGeneration;
  const safe = doc => {
    const { hash, actorUid, ...row } = doc.data();
    return { ...row, recordedAt: row.recordedAt?.toDate().toISOString() ?? null };
  };

  async function context(tx, request) {
    const uid = request.auth?.uid;
    if (!uid) fail('unauthenticated', 'Entre na sua conta.');
    const input = request.data || {};
    const businessId = validId(input.businessId, 'Empresa'), spaceId = validId(input.spaceId, 'Espaço');
    const root = db.doc('businesses/' + businessId), workspaceGeneration = generation(input.workspaceGeneration ?? 0);
    const moduleRef = root.collection('consignmentSpaces').doc(workspaceGeneration + '_' + spaceId);
    const [company, user, membership, space, enabled] = await tx.getAll(root, db.doc('users/' + uid),
      root.collection('members').doc(uid), db.doc('financialSpaces/' + spaceId), moduleRef);
    const business = company.data(), profile = user.data(), member = membership.data(), source = space.data();
    if (business?.ownerId !== uid || profile?.active !== true || profile.businessId !== businessId ||
      member?.status !== 'active' || member.role !== 'owner' || !belongsToWorkspace(source, businessId) ||
      source.active === false || source.capabilities?.sales !== true)
      fail('permission-denied', 'Consignados exige um proprietário ativo no espaço autorizado.');
    assertWritable(business, workspaceGeneration);
    const scope = { businessId, spaceId, workspaceGeneration };
    return { ...scope, scope, uid, root, business, input, moduleRef, settings: enabled.data() || {} };
  }

  async function page(tx, query, collection, cursor) {
    if (cursor) {
      const previous = await tx.get(collection.doc(validId(cursor, 'Página')));
      if (!previous.exists) fail('failed-precondition', 'Atualize a lista para continuar.');
      query = query.startAfter(previous);
    }
    const snapshot = await tx.get(query.limit(limit + 1));
    return { items: snapshot.docs.slice(0, limit).map(safe), cursor: snapshot.size > limit ? snapshot.docs[limit - 1].id : null };
  }

  async function outlet(tx, c, id) {
    const ref = c.moduleRef.collection('outlets').doc(validId(id, 'Ponto de venda'));
    if (!(await tx.get(ref)).exists) fail('not-found', 'Ponto de venda indisponível neste espaço.');
    return ref;
  }

  async function read(tx, c, action) {
    if (action === 'dashboard') {
      if (!c.settings.enabled) return { enabled: false };
      const outlets = await tx.get(c.moduleRef.collection('outlets').orderBy('name').limit(200));
      return { enabled: true, outlets: outlets.docs.map(safe), deliveries: c.settings.deliveryCount || 0, units: c.settings.units || 0 };
    }
    const deliveries = c.moduleRef.collection('deliveries');
    if (action === 'receipt') {
      const doc = await tx.get(deliveries.doc(validId(c.input.operationId, 'Entrega')));
      if (!doc.exists) fail('not-found', 'Entrega indisponível.');
      return { item: safe(doc) };
    }
    if (!c.settings.enabled) fail('failed-precondition', 'Ative Consignados neste espaço.');
    if (action === 'history') return page(tx, deliveries.orderBy('deliveredOn', 'desc'), deliveries, c.input.cursor);
    const ref = await outlet(tx, c, c.input.outletId), items = ref.collection('stock');
    return page(tx, items.orderBy('name'), items, c.input.cursor);
  }

  function deliveryInput(input, currentDay) {
    const outletId = validId(input.outletId, 'Ponto de venda'), deliveredOn = input.deliveredOn;
    if (typeof deliveredOn !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(deliveredOn))
      fail('invalid-argument', 'Informe a data da entrega.');
    const date = new Date(deliveredOn + 'T00:00:00Z');
    if (!Number.isFinite(+date) || date.toISOString().slice(0, 10) !== deliveredOn || deliveredOn > currentDay)
      fail('invalid-argument', 'A data de entrega deve ser válida e igual ou anterior a hoje.');
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 40)
      fail('invalid-argument', 'Informe entre 1 e 40 itens por entrega.');
    const items = new Map();
    for (const item of input.items) {
      const row = { productId: validId(item?.productId, 'Produto'), variantId: item?.variantId ? validId(item.variantId, 'Variação') : null };
      const key = stockKey(row), previous = items.get(key);
      if (previous && previous.productId !== row.productId) fail('invalid-argument', 'Variação vinculada a produtos diferentes.');
      const quantity = item?.quantity;
      if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity + (previous?.quantity || 0) > 100000)
        fail('invalid-argument', 'Informe uma quantidade inteira entre 1 e 100.000 por item.');
      items.set(key, { ...row, quantity: quantity + (previous?.quantity || 0) });
    }
    return { outletId, deliveredOn, notes: text(input.notes, 500), items: [...items.values()].sort((a, b) => stockKey(a).localeCompare(stockKey(b))) };
  }

  async function stockPlan(tx, c, items, outletRef) {
    const parents = new Map(), rows = [];
    const products = c.root.collection('products'), variants = c.root.collection('productVariants');
    for (const item of items) {
      const { productId, variantId, quantity } = item, key = stockKey(item), pRef = products.doc(productId);
      if (!parents.has(productId)) parents.set(productId, { ref: pRef, product: (await tx.get(pRef)).data() });
      const p = parents.get(productId).product;
      if (!scoped(c, p) || !eligible(p) || !allowsExchangeProduct(p, c.spaceId) || p.spaceId && p.spaceId !== c.spaceId)
        fail('failed-precondition', 'Produto indisponível ou sem vínculo de estoque comprovado neste espaço.');
      if (Boolean(variantId) !== (p.productType === 'variable')) fail('invalid-argument', 'Selecione a variação exata do produto.');
      const ref = variantId ? variants.doc(variantId) : pRef, slot = outletRef.collection('stock').doc(key);
      const [holds, balance] = await tx.getAll(c.root.collection('onlineStockReservations').doc(key), slot);
      const value = variantId ? (await tx.get(ref)).data() : p, hold = holds.data(), current = balance.data();
      if (!scoped(c, value) || !Model.active(value) || variantId &&
        (value.parentProductId !== productId || value.spaceId && value.spaceId !== c.spaceId))
        fail('failed-precondition', 'Variação indisponível neste espaço.');
      const available = Number(variantId ? value.stock : p.estoqueAtual ?? p.estoque);
      const reserved = hold?.quantity ?? 0, outletBefore = current?.quantity ?? 0;
      if (hold && !scoped(c, hold) || !Number.isSafeInteger(reserved) || reserved < 0 ||
        Number(value.onlineReservedStock ?? 0) !== reserved || !Number.isSafeInteger(available) ||
        !Number.isSafeInteger(outletBefore) || outletBefore < 0 || !Number.isSafeInteger(outletBefore + quantity))
        fail('failed-precondition', 'Não foi possível validar o saldo de estoque. Confira o cadastro.');
      if (available - quantity < reserved) fail('failed-precondition', 'Estoque disponível insuficiente para ' + (p.nome || productId) + '.');
      const unitCents = Math.round(Number(variantId ? value.price ?? p.preco : p.preco) * 100);
      if (!Number.isSafeInteger(unitCents) || unitCents < 0 || !Number.isSafeInteger(unitCents * quantity))
        fail('failed-precondition', 'Preço de referência inválido no cadastro.');
      rows.push({ ref, slot, available, item: { ...item, name: text(p.nome, 140) || productId,
        variantName: variantId ? text(value.displayName || value.name, 140) : '', sku: text(value.sku || value.codigo || value.codigoInterno, 80),
        unitCents, totalCents: unitCents * quantity, outletBefore, outletAfter: outletBefore + quantity } });
    }
    let budget = 400;
    for (const [productId, parent] of parents) if (parent.product.productType === 'variable') {
      const all = await tx.get(variants.where('parentProductId', '==', productId).limit(budget + 1));
      if (all.size > budget) fail('failed-precondition', 'Muitas variações na mesma entrega.');
      budget -= all.size;
      let total = 0;
      for (const snap of all.docs) {
        const v = snap.data();
        if (!Model.active(v)) continue;
        if (!scoped(c, v) || !Number.isSafeInteger(v.stock) || v.stock < 0)
          fail('failed-precondition', 'O saldo das variações precisa ser conferido.');
        total += v.stock;
      }
      const outgoing = rows.filter(row => row.item.productId === productId).reduce((sum, row) => sum + row.item.quantity, 0);
      if (!Number.isSafeInteger(total) || total < outgoing) fail('failed-precondition', 'Saldo agrupado de variações inválido.');
      parent.total = total - outgoing;
    }
    return { parents, rows };
  }

  async function confirm(tx, c) {
    const date = now(), timestamp = Timestamp.fromDate(date), op = validId(c.input.operationId, 'Operação');
    const details = deliveryInput(c.input, isoDate(date, c.business.timezone || 'America/Sao_Paulo'));
    const hash = checksum(details), ref = c.moduleRef.collection('deliveries').doc(op);
    const markerRef = c.root.collection('processedOperations').doc(op);
    const [seen, marker, settings, branding] = await tx.getAll(ref, markerRef, c.root.collection('settings').doc('default'),
      c.root.collection('onlineStores').doc(storeId(c.spaceId)));
    if (seen.exists) {
      if (seen.data().hash !== hash || seen.data().actorUid !== c.uid) fail('already-exists', 'Identificador de outra entrega.');
      const applied = marker.data();
      if (applied?.checksum !== hash || applied?.eventKind !== 'consignment_delivery' || applied.spaceId !== c.spaceId)
        fail('failed-precondition', 'Comprovante incompleto. Confira no histórico.');
      return { item: safe(seen), replayed: true };
    }
    if (marker.exists) fail('already-exists', 'Identificador de outra operação.');
    const outletRef = c.moduleRef.collection('outlets').doc(details.outletId);
    const store = (await tx.get(outletRef)).data();
    if (!scoped(c, store)) fail('not-found', 'Ponto de venda indisponível neste espaço.');
    const { rows, parents } = await stockPlan(tx, c, details.items, outletRef);
    const items = rows.map(row => row.item), units = items.reduce((sum, item) => sum + item.quantity, 0);
    const totalCents = items.reduce((sum, item) => sum + item.totalCents, 0);
    if (!Number.isSafeInteger(totalCents)) fail('invalid-argument', 'Valor de referência acima do limite.');
    const brand = settings.data() || {}, storeBrand = branding.data();
    const catalogBrand = scoped(c, storeBrand) && storeBrand.spaceId === c.spaceId ? storeBrand.catalogSettings || {} : {};
    const company = {
      name: text(brand.nome || c.business.name, 140), document: text(brand.cnpj || c.business.cnpj, 30),
      phone: text(brand.telefone || c.business.phone, 50), address: text(brand.endereco || c.business.address, 200),
      logoUrl: text(brand.logoUrl || c.business.logoUrl || catalogBrand.logoUrl, 1200),
    };
    const delivery = { ...c.scope, id: op, actorUid: c.uid, hash, recordedAt: timestamp, deliveredOn: details.deliveredOn, notes: details.notes,
      kind: store.deliveryCount ? 'replenishment' : 'delivery', outlet: { id: store.id, name: store.name, contact: store.contact, address: store.address, phone: store.phone },
      company, items, units, totalCents };
    tx.create(ref, delivery);
    tx.create(markerRef, { ...c.scope, id: op, actorUid: c.uid, status: 'processed', eventKind: 'consignment_delivery', checksum: hash, processedAt: timestamp, schemaVersion: 3 });
    for (const [i, row] of rows.entries()) {
      const { item, available } = row, after = available - item.quantity, movement = op + '_consignment_' + i;
      const patch = item.variantId ? { stock: after } : stockFields(after);
      tx.update(row.ref, { ...patch, version: FieldValue.increment(1), updatedAt: timestamp });
      tx.set(row.slot, { ...c.scope, id: row.slot.id, productId: item.productId, variantId: item.variantId, name: item.name,
        variantName: item.variantName, sku: item.sku, quantity: item.outletAfter, unitCents: item.unitCents, updatedAt: timestamp });
      tx.create(c.root.collection('stockMovements').doc(movement), { ...c.scope, id: movement, operationId: op,
        source: 'consignment', tipo: 'saida_consignacao', actorUid: c.uid, outletId: store.id,
        produtoId: item.productId, parentProductId: item.productId, variantId: item.variantId,
        produtoNome: item.name, quantidade: -item.quantity, estoqueAnterior: available, estoqueNovo: after,
        businessOccurredOn: details.deliveredOn, data: timestamp, createdAt: timestamp, updatedAt: timestamp, schemaVersion: 3 });
    }
    for (const parent of parents.values()) if (parent.total !== undefined)
      tx.update(parent.ref, { ...stockFields(parent.total), version: FieldValue.increment(1), updatedAt: timestamp });
    tx.update(outletRef, { units: FieldValue.increment(units), deliveryCount: FieldValue.increment(1), updatedAt: timestamp });
    tx.update(c.moduleRef, { units: FieldValue.increment(units), deliveryCount: FieldValue.increment(1) });
    const changedCollections = ['products', 'productVariants', 'stockMovements'];
    tx.set(c.root.collection('syncMetadata').doc('last-sync'), { businessId: c.businessId, workspaceGeneration: c.workspaceGeneration,
      updatedAt: timestamp, revision: date.toISOString(), changedCollections,
      collectionVersions: Object.fromEntries(changedCollections.map(name => [name, date.toISOString()])) }, { merge: true });
    return { item: safe({ data: () => delivery }), replayed: false };
  }

  return request => db.runTransaction(async tx => {
    const c = await context(tx, request), action = c.input.action;
    if (['dashboard', 'inventory', 'history', 'receipt'].includes(action)) return read(tx, c, action);
    if (!computeAccess(c.business.subscription || {}).canMutate) fail('permission-denied', 'Empresa sem acesso operacional para registrar entregas.');
    if (action === 'enable' || action === 'disable') {
      const enabled = action === 'enable';
      if (Boolean(c.settings.enabled) !== enabled) tx.set(c.moduleRef, { ...c.scope, enabled,
        availabilityChangedAt: FieldValue.serverTimestamp(), availabilityChangedBy: c.uid }, { merge: true });
      return { enabled };
    }
    if (action === 'outlet') {
      const id = validId(c.input.operationId, 'Operação'), ref = c.moduleRef.collection('outlets').doc(id);
      const values = { name: text(c.input.name, 120), contact: text(c.input.contact, 120), phone: text(c.input.phone, 40), address: text(c.input.address, 240) };
      if (!values.name) fail('invalid-argument', 'Informe o nome do ponto de venda.');
      const hash = checksum(values), existing = await tx.get(ref);
      if (existing.exists) {
        if (existing.data().hash !== hash || existing.data().actorUid !== c.uid) fail('already-exists', 'Identificador de outro ponto de venda.');
        return { id, replayed: true };
      }
      if (!c.settings.enabled) fail('failed-precondition', 'Ative Consignados neste espaço.');
      if ((c.settings.outletCount || 0) >= 200) fail('resource-exhausted', 'O espaço atingiu 200 pontos de venda.');
      tx.create(ref, { ...c.scope, ...values, id, hash, actorUid: c.uid, units: 0, deliveryCount: 0, recordedAt: Timestamp.fromDate(now()) });
      tx.update(c.moduleRef, { outletCount: FieldValue.increment(1) });
      return { id, replayed: false };
    }
    if (!c.settings.enabled) fail('failed-precondition', 'Ative Consignados neste espaço.');
    if (action === 'confirm') return confirm(tx, c);
    fail('invalid-argument', 'Ação de Consignados inválida.');
  });
}

module.exports = { consignmentService };
