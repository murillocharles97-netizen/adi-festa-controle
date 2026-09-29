(function () {
  'use strict';
  // Reuse the V154 database/store. Business documents and operational records
  // share a transaction, but never share keys with the WhatsApp sequence engine.
  const DATABASE = 'veconi-local-records', STORE = 'records';
  let session = null;
  const clone = value => structuredClone(value);
  const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
  const fingerprint = value => JSON.stringify(ordered(value));
  const failure = (code, message) => Object.assign(Error(message), {code});
  const ownedKey = key => /^(adiFesta:|adiFestaFirestoreQueue_v1$|adiFestaDeviceId$|adiFestaSyncQueue|veconi:known-only-local-sales:|veconi:reviewed-only-local-sales:)/.test(key);
  const legacyKey = key => /^adiFestaDB_v1(?::[a-z0-9_:-]+)?$/i.test(key);
  function inventory() {
    const result = [];
    for (let n = 0; n < localStorage.length; n++) {
      const key = localStorage.key(n);
      if (!legacyKey(key) && !ownedKey(key) && !/^(adiFesta|adiCatalog)/.test(key)) continue;
      const value = localStorage.getItem(key) || '';
      result.push({prefix: key.split(':')[0].replace(/_\d{10,}$/, '_timestamp'),
        type: legacyKey(key) ? 'legacy-business-cache' : /backup|archive/i.test(key) ? 'preserved-backup' : /^adiCatalogCache:/.test(key) ? 'public-catalog-cache' : 'app-metadata',
        bytes: new Blob([value]).size, utf16Bytes: value.length * 2});
    }
    return result;
  }
  // Collections are records, not JSON blobs. Position preserves legacy ordering,
  // including duplicate/missing IDs; nothing is dropped during migration.
  function encode(scope, data, values) {
    const rows = new Map();
    const put = (area, field, value) => {
      const root = JSON.stringify([scope, area, field]);
      rows.set(root, {key: root, scope, area, field, kind: Array.isArray(value) ? 'array' : 'value',
        ...(Array.isArray(value) ? {} : {value: clone(value)})});
      if (!Array.isArray(value)) return;
      const seen = new Map();
      value.forEach((item, position) => {
        const id = String(item?.id ?? item?.queueId ?? item?.operationId ?? `position:${position}`), occurrence = seen.get(id) || 0;
        seen.set(id, occurrence + 1);
        const key = JSON.stringify([scope, area, field, id, occurrence]);
        rows.set(key, {key, scope, area, field, kind: 'item', position, value: clone(item)});
      });
    };
    for (const [field, value] of Object.entries(data)) put('data', field, value);
    for (const [field, value] of values) {
      let parsed;
      try { parsed = JSON.parse(value); } catch { parsed = value; }
      // Retain the Storage API's string semantics without storing arrays as JSON.
      put('sync', field, parsed);
      rows.get(JSON.stringify([scope, 'sync', field])).json = typeof parsed !== 'string' || value !== parsed;
    }
    return rows;
  }
  function decode(rows) {
    const data = {}, values = new Map(), grouped = new Map();
    for (const row of rows) {
      if (!['data', 'sync'].includes(row.area)) continue;
      const key = JSON.stringify([row.area, row.field]);
      if (!grouped.has(key)) grouped.set(key, {items: []});
      const group = grouped.get(key);
      if (row.kind === 'item') group.items.push(row); else group.root = row;
    }
    for (const {root, items} of grouped.values()) {
      if (!root) throw failure('local-cache-corrupt', 'O cache local precisa de revisão. Nenhum dado foi apagado.');
      const value = root.kind === 'array' ? items.sort((a,b) => a.position-b.position).map(row => row.value) : root.value;
      if (root.area === 'data') data[root.field] = value;
      else values.set(root.field, root.json ? JSON.stringify(value) : String(value));
    }
    return {data, values};
  }
  function report(error) {
    // DOMException.code is a read-only number (22 for quota), not our error code.
    error = Object.assign(new Error(error.code === 'local-cache-conflict' ? error.message : 'Não foi possível atualizar o armazenamento local da VECONI. Os dados já salvos foram preservados.', {cause: error}), {name: error.name, technicalMessage: error.message,
      code: typeof error.code === 'string' ? error.code : error.name === 'QuotaExceededError' ? 'indexeddb-quota' : 'indexeddb-write-failed'});
    error.storageDetail = {backend: 'IndexedDB', database: DATABASE, store: STORE, kind: 'structured-business-records'};
    console.error('[STORAGE]', {code: error.code, exception: error.name, ...error.storageDetail});
    window.dispatchEvent(new CustomEvent('local-persistence-error', {detail: {code: error.code}}));
    window.Utils?.toast?.('Não foi possível atualizar o armazenamento local da VECONI. Não feche o aplicativo; tente salvar novamente.', true);
    return error;
  }
  function requireSession() {
    if (!session) throw failure('local-cache-not-ready', 'O armazenamento local ainda está sendo preparado.');
    if (session.error) throw session.error;
    return session;
  }
  function schedule(current) {
    current.dirty = true;
    if (!current.scheduled) {
      current.scheduled = true;
      queueMicrotask(() => { current.scheduled = false; void flush(current).catch(() => {}); });
    }
  }
  async function commit(current) {
    const next = encode(current.scope, current.data, current.values), changed = [], removed = [];
    for (const [key, row] of next) if (fingerprint(row) !== current.baseline.get(key)) changed.push(row);
    for (const key of current.baseline.keys()) if (!next.has(key)) removed.push(key);
    if (!changed.length && !removed.length && !current.metaDirty) return;
    const revision = current.revision + 1, meta = {key: current.metaKey, scope: current.scope, kind: 'meta',
      revision, updatedAt: new Date().toISOString(), migration: clone(current.migration), records: next.size};
    await DB.localRecords.transaction('readwrite', (store, done, fail) => {
      const request = store.get(current.metaKey);
      request.onsuccess = () => {
        if (Number(request.result?.revision || 0) !== current.revision)
          return fail(failure('local-cache-conflict', 'Os dados locais mudaram em outra aba. Reabra a VECONI antes de continuar.'));
        changed.forEach(row => store.put(row));
        removed.forEach(key => store.delete(key));
        store.put(meta); done(true);
      };
    });
    current.baseline = new Map([...next].map(([key,row]) => [key, fingerprint(row)]));
    current.revision = revision;
    current.metaDirty = false;
    current.lastCommit = {at: meta.updatedAt, written: changed.length, removed: removed.length, records: next.size};
  }
  function flush(current = session) {
    if (!current) return Promise.resolve();
    if (current.running) return current.running.then(() => current.dirty ? flush(current) : undefined);
    if (!current.dirty) return Promise.resolve();
    current.running = (async () => {
      try {
        while (current.dirty) {
          current.dirty = false;
          await commit(current);
        }
        current.error = null;
      } catch (error) {
        current.dirty = true;
        current.error = report(error);
        throw current.error;
      } finally { current.running = null; }
    })();
    return current.running;
  }
  async function digest(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
  }
  async function migrate(current, sourceKey, raw) {
    const sha = await digest(raw);
    if (current.migration && current.migration.sha256 !== sha)
      throw failure('legacy-cache-changed', 'O cache antigo mudou em outra versão da VECONI. Foi preservado para revisão.');
    if (!current.migration) {
      current.migration = {sourceKey, sha256: sha, verified: false, removed: false, bytes: new Blob([raw]).size};
      current.metaDirty = current.dirty = true;
      await flush(current);
    }
    if (!current.migration.verified) {
      const copied = decode(await DB.localRecords.list(current.scope));
      if (fingerprint(copied.data) !== fingerprint(JSON.parse(raw)))
        throw failure('legacy-cache-verification-failed', 'A migração não pôde ser verificada. O cache antigo foi preservado.');
      current.migration.verified = true;
      current.metaDirty = current.dirty = true;
      await flush(current);
    }
    // No broad origin cleanup. Recheck exact source contents after durable proof.
    if (legacyKey(sourceKey) && localStorage.getItem(sourceKey) === raw) {
      localStorage.removeItem(sourceKey);
      current.migration.removed = true;
      current.metaDirty = current.dirty = true;
      await flush(current);
    }
  }
  async function open(key, candidates, empty) {
    if (session?.key === key) { await flush(); return clone(session.data); }
    if (session) await flush();
    session = null;
    const scope = `business-cache:v156:${key}`, metaKey = JSON.stringify([scope, 'meta']);
    const rows = await DB.localRecords.list(scope), meta = rows.find(row => row.key === metaKey), loaded = decode(rows);
    if ((!meta && rows.length) || (meta && meta.records !== rows.length - 1))
      throw failure('local-cache-corrupt', 'A estrutura do cache local precisa de revisão. Nenhum dado foi apagado.');
    const current = {key, scope, metaKey, data: meta ? loaded.data : empty(), values: loaded.values,
      revision: meta?.revision || 0, migration: meta?.migration || null,
      baseline: new Map(rows.filter(row => row.key !== metaKey).map(row => [row.key, fingerprint(row)])),
      dirty: false, metaDirty: false, error: null, running: null, scheduled: false, inventoryBefore: inventory()};
    const sourceKey = (meta?.migration?.sourceKey && localStorage.getItem(meta.migration.sourceKey) !== null)
      ? meta.migration.sourceKey : !meta ? candidates.find(candidate => legacyKey(candidate) && localStorage.getItem(candidate) !== null) : null;
    const raw = sourceKey ? localStorage.getItem(sourceKey) : null;
    if (!meta && raw !== null) {
      try { current.data = JSON.parse(raw); } catch { throw failure('legacy-cache-corrupt', 'O cache antigo não pôde ser lido. Nenhum dado foi apagado.'); }
      if (!current.data || typeof current.data !== 'object' || Array.isArray(current.data)) throw failure('legacy-cache-corrupt', 'Cache antigo inválido; original preservado.');
    }
    if (raw !== null) await migrate(current, sourceKey, raw);
    session = current;
    return clone(current.data);
  }
  const keyValue = {
    getItem(key) {
      if (session?.values.has(key)) return session.values.get(key);
      // Old queue/metadata is imported lazily without deleting its recovery copy.
      const value = localStorage.getItem(key);
      if (value !== null && session && ownedKey(key)) { session.values.set(key, value); schedule(session); }
      return value;
    },
    setItem(key, value) {
      if (!ownedKey(key)) throw failure('unowned-storage-key', 'Chave de armazenamento fora do escopo VECONI.');
      const current = requireSession(); current.values.set(key, String(value)); schedule(current);
    },
    removeItem(key) { const current = requireSession(); if (!ownedKey(key)) throw failure('unowned-storage-key', 'Chave fora do escopo.'); current.values.set(key, 'null'); schedule(current); },
  };
  async function diagnostic() {
    let estimate = null;
    try { const value = await navigator.storage?.estimate?.(); if (value) estimate = {usage: value.usage, quota: value.quota, percent: value.quota ? +(100*value.usage/value.quota).toFixed(2) : null}; } catch { /* optional metadata */ }
    return {backend: 'IndexedDB', database: DATABASE, store: STORE, layout: 'document-records-v1',
      retention: {businessRecords: 'protected; no automatic eviction',snapshots: 'current revision only',messageSequences: 'existing 30-day GC; unsent events retained'},
      records: session?.baseline.size || 0, migration: session?.migration ? {...session.migration, sourceKey: 'adiFestaDB_v1:<scoped>'} : null,
      lastCommit: session?.lastCommit || null, pending: Boolean(session?.dirty || session?.running), errorCode: session?.error?.code || null,
      legacyKeysBefore: session?.inventoryBefore || [], legacyKeysNow: inventory(), estimate};
  }
  DB.businessCache = {open, flush, keyValue, diagnostic, inventory,
    stage(data, key) { const current = requireSession(); if (key && key !== current.key) throw failure('local-cache-scope-changed', 'A empresa mudou durante a gravação. Tente novamente.'); current.data = clone(data); schedule(current); },
    async release() { await flush(); session = null; },
    ready: () => Boolean(session), pending: () => Boolean(session?.dirty || session?.running)};
  DB.flush = () => flush();
  window.addEventListener('beforeunload', event => { if (DB.businessCache.pending()) {event.preventDefault(); event.returnValue = '';} });
})();
