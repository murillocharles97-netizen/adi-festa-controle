'use strict';
// Paste this file's function into DevTools on the affected device. No app APIs.
async function readPreservedOperation({includeOriginal = false} = {}) {
  const operationId = 'd0611a1a-cd01-4a8a-821d-0bebc8a5207c';
  const businessId = 'adi-festa';
  const matches = [];
  const collect = (value, location) => {
    if (typeof value === 'string') {
      try { value = JSON.parse(value); } catch { return; }
    }
    const items = Array.isArray(value) ? value : [value];
    for (const item of items) {
      if (item?.operationId === operationId && item.businessId === businessId)
        matches.push({location, item});
    }
  };
  const databases = await indexedDB.databases();
  if (databases.some(db => db.name === 'veconi-local-records')) {
    const db = await new Promise((resolve, reject) => {
      let blocked = false;
      const request = indexedDB.open('veconi-local-records');
      request.onupgradeneeded = () => { request.transaction.abort(); reject(Error('Banco ausente; extração interrompida.')); };
      request.onerror = () => reject(request.error);
      request.onblocked = () => { blocked = true; reject(Error('Banco ocupado; nenhuma alteração realizada.')); };
      request.onsuccess = () => { if (blocked) request.result.close(); else resolve(request.result); };
    });
    try {
      if (!db.objectStoreNames.contains('records')) throw Error('Store records ausente.');
      await new Promise((resolve, reject) => {
        const tx = db.transaction('records', 'readonly');
        const cursor = tx.objectStore('records').openCursor();
        cursor.onsuccess = () => {
          const entry = cursor.result;
          if (!entry) return;
          const row = entry.value;
          const scope = 'business-cache:v156:adiFestaDB_v1:' + businessId;
          if (row.area === 'sync' && String(row.field).includes(':syncQueue') &&
              (row.scope === scope || String(row.scope).startsWith(scope + ':')))
            collect(row.value, 'IndexedDB/records/' + row.key);
          entry.continue();
        };
        cursor.onerror = () => reject(cursor.error);
        tx.oncomplete = resolve;
        tx.onabort = tx.onerror = () => reject(tx.error || Error('Leitura interrompida.'));
      });
    } finally { db.close(); }
  }
  for (let n = 0; n < localStorage.length; n++) {
    const key = localStorage.key(n);
    if (key.startsWith('adiFesta:' + businessId + ':') && key.includes(':syncQueue'))
      collect(localStorage.getItem(key), 'localStorage/' + key);
  }
  const fields = new Set(['version','asOf','advance','rows','dueDate','amountCents','remainingCents','id','operationId','businessId','spaceId','workspaceGeneration','clienteId','clientId','paymentId','saleId','entityId','entityType','operation','valor','requestedAmount','effectiveAmount','legacyAmount','allocatedAmount','saldo','saldoAnterior','saldoNovo','expectedBalance','expectedFinancialVersion','financialVersion','financialVersionAfter','legacyBalance','legacyBalanceRemaining','campaignFinanceVersion','paymentMode','paymentMethod','status','data','createdAt','updatedAt','financialAppliedAt','creditOriginalAmount','creditPaidAmount','creditRemainingAmount','creditSettled','creditSettledAt','amount','allocations','scheduleRows','fiadoSchedule','installmentSaleId','hasInstallmentFiado']);
  const project = value => Array.isArray(value) ? value.map(project) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).filter(([key]) => fields.has(key)).map(([key,v]) => [key,project(v)])) : value;
  const result = [];
  for (const {location,item} of matches) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(item)));
    result.push({storage: location.split('/')[0], sha256StoredJson: Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2,'0')).join(''),
      operationId, businessId, payloadVersion:item.payloadVersion, checksum:item.checksum,
      status:item.status, lastErrorCode:item.lastErrorCode,
      writes:(item.payload?.writes || []).map(w => ({entityType:w.entityType,entityId:w.entityId,operation:w.operation,data:project(w.data),before:project(w.before)}))});
  }
  return {operationId,businessId,readOnly:true,matches:result,conflictingCopies:new Set(result.map(r=>r.sha256StoredJson)).size>1,
    ...(includeOriginal ? {privateOriginals:matches.map(({item})=>item)} : {})};
}
if (typeof module !== 'undefined') module.exports = {readPreservedOperation};
