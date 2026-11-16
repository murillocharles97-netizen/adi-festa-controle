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
const Stock = require('./consignment-model');
const { consignmentFinance, paymentInput } = require('./consignment-finance');

const fail = (code, message) => { throw new HttpsError(code, message); };
const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const checksum = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const eligible = p => Model.active(p) && p.itemKind !== 'service' &&
  !['service', 'recurring'].includes(p.productType) && !p.semControleEstoque && p.controlaEstoque !== false && p.controlarEstoque !== false;
const stockFields = stock => ({ estoqueAtual: stock, estoque: stock, totalStock: stock });
const isoDate = (when, zone) => new Intl.DateTimeFormat('sv-SE', { timeZone: zone, dateStyle: 'short' }).format(when);
const limit = 30;

function consignmentService(db, now = () => new Date()) {
  const finance = consignmentFinance(db);
  const day = c => isoDate(now(), c.business.timezone || 'America/Sao_Paulo');
  const unitTotal = rows => rows.reduce((sum, row) => sum + row.quantity, 0);
  const photo = row => text(row?.imageThumbUrl || row?.imageUrl || row?.photoUrl || row?.imagemUrl || row?.image?.url || row?.imagem, 1500);
  const receiptLines = rows => rows.map(({ imageUrl, ...row }) => row);
  const outletSummary = store => ({ id: store.id, name: store.name, contact: store.contact, address: store.address, phone: store.phone });
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
      source.active === false || (source.status && source.status !== 'active') || source.capabilities?.sales !== true)
      fail('permission-denied', 'Consignados exige um proprietário ativo no espaço autorizado.');
    assertWritable(business, workspaceGeneration);
    const scope = { businessId, spaceId, workspaceGeneration };
    return { ...scope, scope, uid, root, business, space: source, input, moduleRef, settings: enabled.data() || {} };
  }

  async function page(tx, query, collection, cursor, outletId) {
    if (cursor) {
      const previous = await tx.get(collection.doc(validId(cursor, 'Página')));
      if (!previous.exists || (outletId && previous.data().outlet?.id !== outletId))
        fail('failed-precondition', 'Atualize a lista para continuar.');
      query = query.startAfter(previous);
    }
    const snapshot = await tx.get(query.limit(limit + 1));
    return { items: snapshot.docs.slice(0, limit).map(historyRow), cursor: snapshot.size > limit ? snapshot.docs[limit - 1].id : null };
  }

  async function outlet(tx, c, id) {
    const ref = c.moduleRef.collection('outlets').doc(validId(id, 'Ponto de venda'));
    if (!(await tx.get(ref)).exists) fail('not-found', 'Ponto de venda indisponível neste espaço.');
    return ref;
  }

  async function loadStock(tx, ref) {
    const stock = await tx.get(ref.collection('stock').where('quantity', '>', 0).limit(401));
    if (stock.size > 400) fail('resource-exhausted', 'O estoque excede o limite para conferência.');
    return stock.docs.map(doc => ({ ref: doc.ref, ...doc.data() }));
  }

  async function brand(tx, c) {
    const [settings, branding] = await tx.getAll(c.root.collection('settings').doc('default'),
      c.root.collection('onlineStores').doc(storeId(c.spaceId)));
    const fields = settings.data() || {}, online = branding.data();
    const appearance = scoped(c, online) && online.spaceId === c.spaceId ? online.catalogSettings || {} : {};
    return { name: text(fields.nome || c.business.name, 140), document: text(fields.cnpj || c.business.cnpj, 30),
      phone: text(fields.telefone || c.business.phone, 50), address: text(fields.endereco || c.business.address, 200),
      logoUrl: text(fields.logoUrl || c.business.logoUrl || appearance.logoUrl, 1200) };
  }

  const historyRow = doc => {
    const { items, stockAfter, company, ...summary } = safe(doc);
    return summary;
  };

  async function read(tx, c, action) {
    if (action === 'dashboard') {
      if (!c.settings.enabled) return { enabled: false };
      const outlets = await tx.get(c.moduleRef.collection('outlets').orderBy('name').limit(200));
      const rows = await Promise.all(outlets.docs.map(async doc => {
        const value = safe(doc), month = (await tx.get(doc.ref.collection('months').doc(day(c).slice(0, 7)))).data() || {};
        const stockValueCents = value.stockValueCents ?? (value.units ? Stock.total(Stock.flatten(await loadStock(tx, doc.ref))) : 0);
        return { ...value, stockValueCents, month, commissionBps: value.commissionBps ?? 0, pendingCents: value.pendingCents || 0 };
      }));
      return { enabled: true, outlets: rows, deliveries: c.settings.deliveryCount || 0, units: c.settings.units || 0, stockValueCents: rows.reduce((sum, row) => sum + row.stockValueCents, 0),
        pendingCents: c.settings.pendingCents || 0 };
    }
    if (action === 'daily') {
      const row = !c.settings.spaceId ? null : (await tx.get(c.moduleRef.collection('days').doc(day(c)))).data();
      return { grossCents: row?.grossCents || 0, units: row?.units || 0 };
    }
    const deliveries = c.moduleRef.collection('deliveries');
    if (action === 'receipt') {
      const doc = await tx.get(deliveries.doc(validId(c.input.operationId, 'Entrega')));
      if (!doc.exists) fail('not-found', 'Entrega indisponível.');
      const item = safe(doc);
      if (item.kind === 'conference' && item.netCents) {
        const entry = (await tx.get(finance.entry(c, item.id))).data();
        return { item, currentPayment: entry?.status || 'unavailable' };
      }
      return { item };
    }
    if (action === 'history') {
      if (!c.settings.spaceId) fail('failed-precondition', 'Ative Consignados neste espaço.');
      const outletId = c.input.outletId ? (await outlet(tx, c, c.input.outletId)).id : null;
      const query = outletId ? deliveries.where('outlet.id', '==', outletId) : deliveries;
      return page(tx, query.orderBy('deliveredOn', 'desc'), deliveries, c.input.cursor, outletId);
    }
    if (!c.settings.enabled) fail('failed-precondition', 'Ative Consignados neste espaço.');
    const ref = await outlet(tx, c, c.input.outletId);
    if (action === 'conferenceStock') {
      const store = (await tx.get(ref)).data(), items = Stock.flatten(await loadStock(tx, ref));
      return { items, outlet: outletSummary(store), commissionBps: store.commissionBps ?? 0, fingerprint: stockFingerprint(store, items) };
    }
    return { items: Stock.flatten(await loadStock(tx, ref)), cursor: null };
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
      const unitCents = item.unitCents ?? null;
      if (unitCents !== null && (!Stock.count(unitCents) || unitCents > 100_000_000)) fail('invalid-argument', 'Preço unitário inválido.');
      if (previous && (previous.unitCents ?? null) !== unitCents) fail('invalid-argument', 'Use um preço por produto nesta entrega.');
      items.set(key, { ...row, ...(unitCents !== null ? { unitCents } : {}), quantity: quantity + (previous?.quantity || 0) });
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
      if (!Number.isSafeInteger(available - quantity)) fail('failed-precondition', 'Saldo de estoque acima do limite.');
      if (available - quantity < reserved) fail('failed-precondition', 'Estoque disponível insuficiente para ' + (p.nome || productId) + '.');
      const unitCents = item.unitCents ?? Math.round(Number(variantId ? value.price ?? p.preco : p.preco) * 100);
      if (!Number.isSafeInteger(unitCents) || unitCents < 0 || !Number.isSafeInteger(unitCents * quantity))
        fail('failed-precondition', 'Preço de referência inválido no cadastro.');
      rows.push({ ref, slot, available, item: { ...item, name: text(p.nome, 140) || productId,
        imageUrl: photo(value) || photo(p), variantName: variantId ? text(value.displayName || value.name, 140) : '', sku: text(value.sku || value.codigo || value.codigoInterno, 80),
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
    const [seen, marker] = await tx.getAll(ref, markerRef);
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
    const company = await brand(tx, c), inventory = new Map((await loadStock(tx, outletRef)).map(row => [row.id, row]));
    for (const row of rows) {
      const existing = inventory.get(row.slot.id), item = row.item, prices = new Map(Stock.lots(existing).map(x => [x.unitCents, x.quantity]));
      prices.set(item.unitCents, (prices.get(item.unitCents) || 0) + item.quantity);
      row.outletStock = { ...c.scope, id: row.slot.id, productId: item.productId, variantId: item.variantId, name: item.name,
        variantName: item.variantName, sku: item.sku, imageUrl: item.imageUrl, quantity: item.outletAfter, unitCents: item.unitCents,
        priceLots: [...prices].map(([unitCents, quantity]) => ({ unitCents, quantity })), updatedAt: timestamp };
      inventory.set(row.slot.id, row.outletStock);
    }
    const stockAfter = Stock.flatten([...inventory.values()]), stockValueCents = Stock.total(stockAfter);
    const delivery = { ...c.scope, id: op, actorUid: c.uid, hash, recordedAt: timestamp, deliveredOn: details.deliveredOn, notes: details.notes,
      kind: store.deliveryCount ? 'replenishment' : 'delivery', outlet: outletSummary(store),
      company, items: receiptLines(items), units, totalCents, stockAfter: receiptLines(stockAfter) };
    tx.create(ref, delivery);
    tx.create(markerRef, { ...c.scope, id: op, actorUid: c.uid, status: 'processed', eventKind: 'consignment_delivery', checksum: hash, processedAt: timestamp, schemaVersion: 3 });
    for (const [i, row] of rows.entries()) {
      const { item, available } = row, after = available - item.quantity, movement = op + '_consignment_' + i;
      const patch = item.variantId ? { stock: after } : stockFields(after);
      tx.update(row.ref, { ...patch, version: FieldValue.increment(1), updatedAt: timestamp });
      tx.set(row.slot, row.outletStock);
      tx.create(c.root.collection('stockMovements').doc(movement), { ...c.scope, id: movement, operationId: op,
        source: 'consignment', tipo: 'saida_consignacao', actorUid: c.uid, outletId: store.id,
        produtoId: item.productId, parentProductId: item.productId, variantId: item.variantId,
        produtoNome: item.name, quantidade: -item.quantity, estoqueAnterior: available, estoqueNovo: after,
        businessOccurredOn: details.deliveredOn, data: timestamp, createdAt: timestamp, updatedAt: timestamp, schemaVersion: 3 });
    }
    for (const parent of parents.values()) if (parent.total !== undefined)
      tx.update(parent.ref, { ...stockFields(parent.total), version: FieldValue.increment(1), updatedAt: timestamp });
    tx.update(outletRef, { units: FieldValue.increment(units), stockValueCents, deliveryCount: FieldValue.increment(1), updatedAt: timestamp,
      firstDeliveryOn: store.firstDeliveryOn && store.firstDeliveryOn < details.deliveredOn ? store.firstDeliveryOn : details.deliveredOn });
    tx.update(c.moduleRef, { units: FieldValue.increment(units), deliveryCount: FieldValue.increment(1) });
    signalStock(tx, c, timestamp);
    return { item: safe({ data: () => delivery }), replayed: false };
  }

  function signalStock(tx, c, timestamp) {
    const revision = timestamp.toDate().toISOString(), changedCollections = ['products', 'productVariants', 'stockMovements'];
    tx.set(c.root.collection('syncMetadata').doc('last-sync'), { businessId: c.businessId, workspaceGeneration: c.workspaceGeneration,
      updatedAt: timestamp, revision, changedCollections, collectionVersions: Object.fromEntries(changedCollections.map(name => [name, revision])) }, { merge: true });
  }

  const stockFingerprint = (store, rows) => checksum([store.deliveryCount || 0, store.conferenceCount || 0,
    store.commissionBps || 0, rows.map(row => [row.id, row.quantity])]);

  async function existingOperation(tx, c, id, hash, kind) {
    const ref = c.moduleRef.collection('deliveries').doc(id), markerRef = c.root.collection('processedOperations').doc(id);
    const [record, marker] = await tx.getAll(ref, markerRef);
    if (!record.exists && !marker.exists) return { ref, markerRef };
    if (!record.exists || record.data().hash !== hash || record.data().actorUid !== c.uid ||
      !marker.exists || marker.data().checksum !== hash || marker.data().eventKind !== kind || marker.data().spaceId !== c.spaceId)
      fail('already-exists', 'Esta operação já está vinculada a outro registro.');
    return { item: safe(record), replayed: true };
  }

  function recordOperation(tx, c, refs, history, kind) {
    tx.create(refs.ref, history);
    tx.create(refs.markerRef, { ...c.scope, id: history.id, actorUid: c.uid, status: 'processed', eventKind: kind,
      checksum: history.hash, processedAt: history.recordedAt, schemaVersion: 3 });
  }

  async function check(tx, c) {
    const input = c.input, id = validId(input.operationId, 'Operação'), outletId = validId(input.outletId, 'Ponto de venda');
    if (!Array.isArray(input.items) || !input.items.length || input.items.length > 400) fail('invalid-argument', 'Informe a contagem dos produtos.');
    const counted = input.items.map(row => ({ id: validId(row?.id, 'Linha'), found: row.found, returns: row.returns, loss: row.loss, damaged: row.damaged }));
    const payment = paymentInput(input.payment), hash = checksum([outletId, input.fingerprint, counted, payment]), kind = 'consignment_conference';
    const op = await existingOperation(tx, c, id, hash, kind);
    if (op.replayed) return op;
    const ref = await outlet(tx, c, outletId), store = (await tx.get(ref)).data();
    const stock = await loadStock(tx, ref), rows = Stock.flatten(stock), timestamp = Timestamp.fromDate(now()), confirmedOn = day(c);
    if (stockFingerprint(store, rows) !== input.fingerprint) fail('failed-precondition', 'O estoque mudou. Reabra a conferência.');
    const commissionBps = store.commissionBps ?? 0;
    if (!Stock.count(commissionBps) || commissionBps > 10000) fail('failed-precondition', 'Comissão inválida no cadastro do ponto.');
    const result = Stock.conference(rows, counted, commissionBps), returned = new Map(), remaining = new Map();
    for (const row of result.items) {
      const prior = returned.get(row.stockId) || { productId: row.productId, variantId: row.variantId, quantity: 0, unitCents: row.unitCents };
      if (row.returns) { prior.quantity -= row.returns; returned.set(row.stockId, prior); }
      if (!remaining.has(row.stockId)) remaining.set(row.stockId, []);
      if (row.found) remaining.get(row.stockId).push({ unitCents: row.unitCents, quantity: row.found });
    }
    const updated = stock.map(row => {
      const priceLots = remaining.get(row.id);
      return { ...row, priceLots, quantity: priceLots.reduce((sum, lot) => sum + lot.quantity, 0) };
    });
    const stockAfter = Stock.flatten(updated), stockValueCents = Stock.total(stockAfter);
    const restore = await stockPlan(tx, c, [...returned.values()], ref);
    const ledger = await finance.prepare(tx, c, result.netCents, payment, id), company = await brand(tx, c);
    const pending = payment ? 0 : result.netCents, periodFrom = store.lastConferenceOn || store.firstDeliveryOn || confirmedOn;
    const history = { ...c.scope, ...result, items: receiptLines(result.items), id, actorUid: c.uid, hash, kind: 'conference', deliveredOn: confirmedOn,
      recordedAt: timestamp, periodFrom, commissionBps, outlet: outletSummary(store), company, stockAfter: receiptLines(stockAfter),
      totalCents: result.grossCents, paymentAtRecording: result.netCents ? payment ? 'paid' : 'pending' : 'none' };
    recordOperation(tx, c, op, history, kind);
    finance.apply(tx, c, ledger, history, timestamp.toDate().toISOString());
    for (const row of updated) tx.update(row.ref, { priceLots: row.priceLots, quantity: row.quantity, updatedAt: timestamp });
    for (const [i, row] of restore.rows.entries()) {
      const item = row.item, next = row.available - item.quantity, movement = id + '_return_' + i;
      tx.update(row.ref, { ...(item.variantId ? { stock: next } : stockFields(next)), version: FieldValue.increment(1), updatedAt: timestamp });
      tx.create(c.root.collection('stockMovements').doc(movement), { ...c.scope, id: movement, operationId: id, source: 'consignment',
        tipo: 'entrada_consignacao_devolucao', actorUid: c.uid, outletId, produtoId: item.productId, parentProductId: item.productId,
        variantId: item.variantId, produtoNome: item.name, quantidade: -item.quantity, estoqueAnterior: row.available, estoqueNovo: next,
        data: timestamp, createdAt: timestamp, updatedAt: timestamp, schemaVersion: 3 });
    }
    for (const parent of restore.parents.values()) if (parent.total !== undefined)
      tx.update(parent.ref, { ...stockFields(parent.total), version: FieldValue.increment(1), updatedAt: timestamp });
    if (restore.rows.length) signalStock(tx, c, timestamp);
    tx.update(ref, { units: unitTotal(stockAfter), stockValueCents, conferenceCount: FieldValue.increment(1), lastConferenceOn: confirmedOn,
      pendingCents: FieldValue.increment(pending), updatedAt: timestamp });
    tx.update(c.moduleRef, { units: FieldValue.increment(unitTotal(stockAfter) - unitTotal(rows)), pendingCents: FieldValue.increment(pending) });
    if (result.units) for (const metric of [c.moduleRef.collection('days').doc(confirmedOn), ref.collection('months').doc(confirmedOn.slice(0, 7))])
      tx.set(metric, { units: FieldValue.increment(result.units), grossCents: FieldValue.increment(result.grossCents) }, { merge: true });
    return { item: safe({ data: () => history }), currentPayment: history.paymentAtRecording, replayed: false };
  }

  async function settle(tx, c) {
    const id = validId(c.input.operationId, 'Operação'), conferenceId = validId(c.input.conferenceId, 'Conferência');
    const payment = paymentInput(c.input.payment), hash = checksum([conferenceId, payment]), kind = 'consignment_settlement';
    const op = await existingOperation(tx, c, id, hash, kind);
    if (op.replayed) return op;
    const original = (await tx.get(c.moduleRef.collection('deliveries').doc(conferenceId))).data();
    if (original?.kind !== 'conference' || !original.netCents) fail('failed-precondition', 'Conferência sem valor para receber.');
    const ref = await outlet(tx, c, original.outlet.id), ledger = await finance.prepare(tx, c, original.netCents, payment, conferenceId, true);
    const timestamp = Timestamp.fromDate(now()), history = { ...c.scope, id, actorUid: c.uid, hash, kind: 'settlement',
      deliveredOn: day(c), recordedAt: timestamp, outlet: original.outlet, company: original.company, conferenceId,
      units: 0, totalCents: ledger.amount, paymentAtRecording: 'paid' };
    if (ledger.amount !== original.netCents) fail('failed-precondition', 'Valor do acerto divergente.');
    recordOperation(tx, c, op, history, kind);
    finance.apply(tx, c, ledger, history, timestamp.toDate().toISOString());
    tx.update(ref, { pendingCents: FieldValue.increment(-ledger.amount), updatedAt: timestamp });
    tx.update(c.moduleRef, { pendingCents: FieldValue.increment(-ledger.amount) });
    return { item: safe({ data: () => history }), replayed: false, currentPayment: 'paid' };
  }

  const reads = new Set(['dashboard', 'inventory', 'history', 'receipt', 'conferenceStock', 'daily']);
  const handle = request => async tx => {
    const c = await context(tx, request), action = c.input.action;
    if (reads.has(action)) return read(tx, c, action);
    if (!computeAccess(c.business.subscription || {}).canMutate) fail('permission-denied', 'Empresa sem acesso operacional para registrar entregas.');
    if (action === 'enable' || action === 'disable') {
      const enabled = action === 'enable';
      if (Boolean(c.settings.enabled) !== enabled) tx.set(c.moduleRef, { ...c.scope, enabled,
        availabilityChangedAt: FieldValue.serverTimestamp(), availabilityChangedBy: c.uid }, { merge: true });
      return { enabled };
    }
    if (action === 'settle') return settle(tx, c);
    if (action === 'outlet') {
      const id = validId(c.input.operationId, 'Operação'), ref = c.moduleRef.collection('outlets').doc(id);
      const values = { name: text(c.input.name, 120), contact: text(c.input.contact, 120), phone: text(c.input.phone, 40), address: text(c.input.address, 240) };
      values.commissionBps = c.input.commissionBps ?? 0;
      if (!Stock.count(values.commissionBps) || values.commissionBps > 10000) fail('invalid-argument', 'Comissão deve estar entre 0 e 100%.');
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
    if (action === 'conference') return check(tx, c);
    fail('invalid-argument', 'Ação de Consignados inválida.');
  };

  return async request => {
    const options = reads.has(request.data?.action) ? { readOnly: true } : { maxAttempts: 3 };
    for (let attempt = 0; ; attempt++) {
      try { return await db.runTransaction(handle(request), options); }
      catch (error) {
        if (error.code !== 3 || !/Transaction is invalid or closed/i.test(error.details || '')) throw error;
        if (attempt === 2) fail('unavailable', 'Não foi possível confirmar a operação. Confira a tentativa original.');
        await new Promise(resolve => setTimeout(resolve, 150 * (attempt + 1)));
      }
    }
  };
}

module.exports = { consignmentService };
