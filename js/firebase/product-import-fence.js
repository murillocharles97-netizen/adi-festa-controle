// Participates only in catalog identity writes, never in stock/sale arithmetic.
export async function prepareProductImportFence({transaction, db, businessId, writes, doc, serverTimestamp}) {
  const identityWrites = writes.filter(w => ['products','productVariants'].includes(w.entityType) &&
    (w.operation === 'create' || ['codigo','sku','barcode','alternateBarcodes','spaceAccessMode','allowedSpaceIds','active','ativo','deleted','deletedAt'].some(k => Object.hasOwn(w.data || {},k) && JSON.stringify(w.data[k]) !== JSON.stringify(w.before?.[k]))));
  if (!identityWrites.length) return () => {};
  const guard = doc(db,'businesses',businessId,'productImportIdentifiers','catalog-revision');
  const previous = await transaction.get(guard);
  for (const write of identityWrites) {
    const current = write.operation === 'create' ? null : (await transaction.get(doc(db,'businesses',businessId,write.entityType,write.entityId))).data();
    const data = {...write.before, ...current, ...write.data};
    // Deleting cannot claim a new identifier; it still joins the write fence.
    if (data.deleted || data.deletedAt) continue;
    const parentWrite = writes.find(w => w.entityType === 'products' && w.entityId === data.parentProductId);
    const scope = write.entityType === 'products' ? data : parentWrite
      ? {...parentWrite.before, ...parentWrite.data}
      : (await transaction.get(doc(db,'businesses',businessId,'products',data.parentProductId))).data();
    if (!scope) throw Error('Não foi possível confirmar o espaço do produto.');
    for (const [kind, value] of [['sku',data.codigo || data.sku],['ean',data.barcode],...(data.alternateBarcodes || []).map(value=>['ean',value])]) {
      if (!value) continue;
      const bytes = await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([kind,String(value).trim()])));
      const key = Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
      const claim = await transaction.get(doc(db,'businesses',businessId,'productImportIdentifiers',key));
      for (const productId of claim.data()?.productIds || []) {
        if (write.entityType === 'products' && productId === write.entityId) continue;
        const p = (await transaction.get(doc(db,'businesses',businessId,'products',productId))).data();
        if (!p || p.deleted || p.deletedAt) continue;
        const overlap = (p.spaceAccessMode || 'all_spaces') === 'all_spaces' || (scope.spaceAccessMode || 'all_spaces') === 'all_spaces' || (p.allowedSpaceIds || []).some(id => (scope.allowedSpaceIds || []).includes(id));
        if (overlap && String(kind === 'sku' ? p.codigo || '' : p.barcode || '').trim() === String(value).trim()) throw Object.assign(Error('SKU/EAN já foi cadastrado por importação neste espaço. Revise o produto antes de sincronizar.'),{code:'product-identifier-conflict'});
      }
    }
  }
  // Caller invokes this only after completing ALL transaction reads.
  const commitToken = crypto.randomUUID();
  return () => transaction.set(guard,{businessId,revision:Number(previous.data()?.revision || 0)+1,commitToken,updatedAt:serverTimestamp()},{merge:true});
}
