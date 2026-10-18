(function () {
  'use strict';
  // Reuse the V154 database/store. Business documents and operational records
  // share a transaction, but never share keys with the WhatsApp sequence engine.
  const DATABASE = 'veconi-local-records', STORE = 'records';
  let session = null, lifecycle = Promise.resolve(), lifecycleEpoch = 0;
  const CONFLICT_MESSAGE = 'A VECONI está aberta em outra aba ou sessão com dados mais recentes. Atualize esta aba para continuar com segurança.';
  const tabId = typeof BroadcastChannel === 'function' ? crypto.randomUUID() : '';
  let channel;
  try { if (typeof BroadcastChannel === 'function') channel = new BroadcastChannel('veconi-local-cache-v1'); } catch { /* CAS remains authoritative. */ }
  const serial = task => { const pending = lifecycle.catch(() => {}).then(task); lifecycle = pending.catch(() => {}); return pending; };
  const retiredError = () => failure('local-cache-session-retired', 'Esta sessão foi substituída. Entre novamente na conta correta.');
  function notify(message) { try { channel?.postMessage({...message, tabId}); } catch { /* Coordination is advisory, never authorization. */ } }
  function invalidate(current, reason) {
    if (!current || current.obsolete || current.suspended) return;
    current.obsolete = true;
    window.dispatchEvent(new CustomEvent('local-cache-obsolete', {detail: {code: 'local-cache-conflict', reason}}));
  }
  if (channel) channel.onmessage = ({data}) => {
    if (data?.type === 'revision' && data.tabId !== tabId && session?.scope === data.scope &&
        Number.isSafeInteger(data.revision) && data.revision > session.revision) invalidate(session, 'newer-revision');
  };
  async function acquireWriter(scope) {
    if (typeof navigator === 'undefined' || !navigator.locks?.request) return () => {}; // Old browsers still use the transactional revision check.
    return new Promise((resolve, reject) => {
      const holding = navigator.locks.request(`veconi-writer:${scope}`, {mode: 'exclusive', ifAvailable: true}, lock => {
        if (!lock) { reject(failure('local-cache-in-use', 'A VECONI já está usando esta conta em outra aba. Use a aba ativa ou feche-a antes de atualizar esta aba.')); return; }
        return new Promise(unlock => resolve(async () => { unlock(); await holding; }));
      });
      holding.catch(reject);
    });
  }
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
    const stale=error.code==='workspace-generation-mismatch';
    // DOMException.code is a read-only number (22 for quota), not our error code.
    error = Object.assign(new Error(stale || error.code === 'local-cache-conflict' ? error.message : 'Não foi possível atualizar o armazenamento local da VECONI. Os dados já salvos foram preservados.', {cause: error}), {name: error.name, technicalMessage: error.message,
      code: typeof error.code === 'string' ? error.code : error.name === 'QuotaExceededError' ? 'indexeddb-quota' : 'indexeddb-write-failed'});
    error.storageDetail = {backend: 'IndexedDB', database: DATABASE, store: STORE, kind: 'structured-business-records'};
    console.error('[STORAGE]', {code: error.code, exception: error.name, ...error.storageDetail});
    window.dispatchEvent(new CustomEvent('local-persistence-error', {detail: {code: error.code}}));
    window.Utils?.toast?.(stale?'O ambiente da empresa foi restaurado. Reabra a VECONI para continuar.':error.code==='local-cache-conflict'?CONFLICT_MESSAGE:'Não foi possível atualizar o armazenamento local da VECONI. Não feche o aplicativo; tente salvar novamente.', true);
    return error;
  }
  function requireSession() {
    if (!session) throw failure('local-cache-not-ready', 'O armazenamento local ainda está sendo preparado.');
    if (session.retired) throw failure('workspace-generation-mismatch', 'O ambiente da empresa mudou. Reabra a VECONI.');
    if (session.suspended) throw retiredError();
    if (session.obsolete) throw failure('local-cache-conflict', CONFLICT_MESSAGE);
    if (session.error) throw session.error;
    return session;
  }
  function schedule(current) {
    if (current.retired) throw failure('workspace-generation-mismatch', 'O ambiente da empresa mudou. Reabra a VECONI.');
    if (current.suspended) throw retiredError();
    if (current.obsolete) throw failure('local-cache-conflict', CONFLICT_MESSAGE);
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
      const epoch = store.get(`workspace-generation:${current.businessId}`);
      epoch.onsuccess = () => {
        if ((epoch.result?.workspaceGeneration ?? 0) !== current.workspaceGeneration || epoch.result?.cleanupPending === true)
          return fail(failure('workspace-generation-mismatch', 'O ambiente da empresa foi restaurado. Operação antiga bloqueada.'));
        const request = store.get(current.metaKey);
        request.onsuccess = () => {
          if (Number(request.result?.revision || 0) !== current.revision)
            return fail(failure('local-cache-conflict', CONFLICT_MESSAGE));
          changed.forEach(row => store.put(row));
          removed.forEach(key => store.delete(key));
          store.put(meta); done(true);
        };
      };
    });
    current.baseline = new Map([...next].map(([key,row]) => [key, fingerprint(row)]));
    current.revision = revision;
    current.metaDirty = false;
    current.lastCommit = {at: meta.updatedAt, written: changed.length, removed: removed.length, records: next.size};
    notify({type: 'revision', scope: current.scope, revision});
  }
  function flush(current = session) {
    if (!current) return Promise.resolve();
    if (current.running) return current.running.then(() => current.dirty ? flush(current) : undefined);
    if (current.retired) return Promise.resolve();
    if (!current.dirty) return Promise.resolve();
    current.running = (async () => {
      try {
        while (current.dirty) {
          current.dirty = false;
          await commit(current);
        }
        current.error = null;
      } catch (error) {
        current.retired = error.code === 'workspace-generation-mismatch';
        current.dirty = !current.retired;
        current.error = report(error);
        if (error.code === 'local-cache-conflict') invalidate(current, 'revision-check');
        throw current.error;
      } finally { current.running = null; }
    })();
    return current.running;
  }
  async function digest(text) {
    const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return Array.from(new Uint8Array(bytes), n => n.toString(16).padStart(2, '0')).join('');
  }
  // A conflicted delta is never merged/replayed or allowed to replace the latest
  // namespace. Preserve it append-only in the SAME structured records store.
  async function preserveConflict(current) {
    current.preservationId ||= crypto.randomUUID();
    const scope = `${current.scope}:preserved:${current.preservationId}`,
      rows = encode(scope, current.data, current.values),
      contentHash = await digest(fingerprint([...rows.values()])),
      meta = {key: JSON.stringify([scope, 'meta']), scope, kind: 'meta', revision: current.revision,
        records: rows.size, sourceScope: current.scope, reason: 'local-cache-conflict', contentHash,
        preservedAt: new Date().toISOString(), commercialEffectsApplied: false};
    await DB.localRecords.transaction('readwrite', (store, done, fail) => {
      const request = store.get(meta.key);
      request.onsuccess = () => {
        if (request.result) {
          if (request.result.contentHash !== contentHash) return fail(failure('local-cache-preservation-conflict', 'A cópia preservada divergiu. Mantenha esta aba aberta para revisão.'));
          return done(true);
        }
        rows.forEach(row => store.add(row)); store.add(meta); done(true);
      };
    });
    current.preserved = true;
  }
  async function closeCurrent() {
    const current = session;
    if (!current) return;
    current.suspended = true; // Fence synchronous callbacks BEFORE any await.
    try {
      if (current.running) await current.running;
      await flush(current);
    } catch (error) {
      if (error.code !== 'local-cache-conflict') throw error;
      await preserveConflict(current); // Failure keeps the old session/delta alive and blocks transition.
    }
    await current.unlock?.(); current.unlock = null;
    if (session === current) session = null;
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
  async function openCache(key, candidates, empty, ticket) {
    if (ticket !== lifecycleEpoch) throw retiredError();
    if (session?.key === key && !session.suspended && !session.obsolete && !session.error) { await flush(); return clone(session.data); }
    await closeCurrent();
    const businessId=key.split(':')[1]||'adi-festa',workspaceGeneration=Number(key.match(/:generation:(\d+)$/)?.[1]||0);
    const epoch=await DB.localRecords.read(`workspace-generation:${businessId}`);
    if((epoch?.workspaceGeneration??0)!==workspaceGeneration||epoch?.cleanupPending===true)
      throw failure('workspace-generation-mismatch','O cache pertence a uma configuração anterior. Reabra a empresa.');
    const scope = `business-cache:v156:${key}`, metaKey = JSON.stringify([scope, 'meta']);
    const unlock = await acquireWriter(scope);
    try {
    const rows = await DB.localRecords.list(scope), meta = rows.find(row => row.key === metaKey), loaded = decode(rows);
    if ((!meta && rows.length) || (meta && meta.records !== rows.length - 1))
      throw failure('local-cache-corrupt', 'A estrutura do cache local precisa de revisão. Nenhum dado foi apagado.');
    const current = {key, scope, metaKey, businessId, workspaceGeneration, data: meta ? loaded.data : empty(), values: loaded.values,
      revision: meta?.revision || 0, migration: meta?.migration || null,
      baseline: new Map(rows.filter(row => row.key !== metaKey).map(row => [row.key, fingerprint(row)])),
      dirty: false, metaDirty: false, error: null, running: null, scheduled: false, unlock, inventoryBefore: inventory()};
    const sourceKey = (meta?.migration?.sourceKey && localStorage.getItem(meta.migration.sourceKey) !== null)
      ? meta.migration.sourceKey : !meta ? candidates.find(candidate => legacyKey(candidate) && localStorage.getItem(candidate) !== null) : null;
    const raw = sourceKey ? localStorage.getItem(sourceKey) : null;
    if (!meta && raw !== null) {
      try { current.data = JSON.parse(raw); } catch { throw failure('legacy-cache-corrupt', 'O cache antigo não pôde ser lido. Nenhum dado foi apagado.'); }
      if (!current.data || typeof current.data !== 'object' || Array.isArray(current.data)) throw failure('legacy-cache-corrupt', 'Cache antigo inválido; original preservado.');
    }
    if (raw !== null) await migrate(current, sourceKey, raw);
    if (ticket !== lifecycleEpoch) throw retiredError();
    session = current;
    return clone(current.data);
    } catch (error) { await unlock(); throw error; }
  }
  function open(key, candidates, empty) {
    const ticket = ++lifecycleEpoch;
    return serial(() => openCache(key, candidates, empty, ticket));
  }
  const keyValue = {
    getItem(key) {
      if(session?.retired)throw failure('workspace-generation-mismatch','O ambiente da empresa mudou.');
      if(session?.suspended)throw retiredError();
      if (session?.values.has(key)) return session.values.get(key);
      if(session?.workspaceGeneration>0&&ownedKey(key)&&key!=='adiFestaDeviceId')return null;
      // Old queue/metadata is imported lazily without deleting its recovery copy.
      const value = localStorage.getItem(key);
      if (value !== null && session && !session.obsolete && ownedKey(key)) { session.values.set(key, value); schedule(session); }
      return value;
    },
    setItem(key, value) {
      if (!ownedKey(key)) throw failure('unowned-storage-key', 'Chave de armazenamento fora do escopo VECONI.');
      const current = requireSession();
      if (String(key).includes(':syncQueue') && !String(key).startsWith(current.key.replace('adiFestaDB_v1:', 'adiFesta:') + ':syncQueue')) throw retiredError();
      current.values.set(key, String(value)); schedule(current);
    },
    removeItem(key) { const current = requireSession(); if (!ownedKey(key)) throw failure('unowned-storage-key', 'Chave fora do escopo.'); if (String(key).includes(':syncQueue') && !String(key).startsWith(current.key.replace('adiFestaDB_v1:', 'adiFesta:') + ':syncQueue')) throw retiredError(); current.values.set(key, 'null'); schedule(current); },
  };
  async function diagnostic() {
    let estimate = null;
    try { const value = await navigator.storage?.estimate?.(); if (value) estimate = {usage: value.usage, quota: value.quota, percent: value.quota ? +(100*value.usage/value.quota).toFixed(2) : null}; } catch { /* optional metadata */ }
    return {backend: 'IndexedDB', database: DATABASE, store: STORE, layout: 'document-records-v1',
      retention: {businessRecords: 'protected; no automatic eviction',snapshots: 'current revision only',messageSequences: 'existing 30-day GC; unsent events retained'},
      records: session?.baseline.size || 0, obsolete: Boolean(session?.obsolete), preserved: Boolean(session?.preserved), migration: session?.migration ? {...session.migration, sourceKey: 'adiFestaDB_v1:<scoped>'} : null,
      lastCommit: session?.lastCommit || null, pending: Boolean(session?.dirty || session?.running), errorCode: session?.error?.code || null,
      legacyKeysBefore: session?.inventoryBefore || [], legacyKeysNow: inventory(), estimate};
  }
  async function recoverySources(identity) {
    const {businessId,uid,workspaceGeneration=0}=identity;
    if(!/^[a-z0-9_-]+$/i.test(businessId||'')||!/^[a-z0-9_-]+$/i.test(uid||'')||!Number.isSafeInteger(workspaceGeneration)||workspaceGeneration<0)
      throw failure('recovery-context-invalid','Entre na conta de origem para consultar as vendas retidas.');
    const context=window.BusinessContext?.get?.();
    if(window.FirebaseSession?.user?.uid!==uid||context?.userProfile?.uid!==uid||context?.businessId!==businessId||(context?.business?.workspaceGeneration??0)!==workspaceGeneration)
      throw failure('recovery-context-invalid','A consulta precisa permanecer na conta e empresa de origem.');
    const epoch=await DB.localRecords.read(`workspace-generation:${businessId}`);
    if((epoch?.workspaceGeneration??0)!==workspaceGeneration||epoch?.cleanupPending===true)
      throw failure('workspace-generation-mismatch','O ambiente da empresa mudou. Nenhum registro antigo será enviado.');
    const keyPrefix=`adiFestaDB_v1:${businessId}:${uid}:`,prefix=`business-cache:v156:${keyPrefix}`;
    const signatureOf=scope=>{
      if(!String(scope).startsWith(prefix))return null;
      const match=scope.slice(prefix.length).match(/^([a-z0-9_-]+)(?::generation:(\d+))?(?::preserved:[a-z0-9-]+)?$/i);
      return match&&Number(match[2]||0)===workspaceGeneration?match[1]:null;
    };
    const queueField=signature=>`adiFesta:${businessId}:${uid}:${signature}${workspaceGeneration>0?`:generation:${workspaceGeneration}`:''}:syncQueue`;
    const parseQueue=raw=>{const value=JSON.parse(raw||'[]');if(value===null)return[];if(!Array.isArray(value))throw Error('invalid queue');return value;};
    const retained=packets=>packets.filter(p=>p&&p.businessId===businessId&&p.userId===uid&&(p.workspaceGeneration??0)===workspaceGeneration&&
      ['permission-denied','sale-recovery-review-required'].includes(p.lastErrorCode)&&p.payload?.writes?.some(w=>w.entityType==='sales'&&w.operation==='create'));
    // Never hydrate another permission cache or import it into the active queue.
    // Key cursors avoid reading old financial/customer/private collections.
    const sources=await DB.localRecords.transaction('readonly',(store,done,fail)=>{
      const rows=[],dataKeys=[],request=store.index('scope').openKeyCursor(IDBKeyRange.bound(prefix,prefix+'\uffff'));
      request.onsuccess=()=>{
        const cursor=request.result;
        if(!cursor){
          const groups=new Map();
          for(const row of rows){if(!groups.has(row.scope))groups.set(row.scope,[]);groups.get(row.scope).push(row);}
          try{const scoped=[...groups].map(([scope,records])=>{
            const decoded=decode(records),packets=parseQueue(decoded.values.get(queueField(signatureOf(scope))));
            return{scope,packets:retained(packets)};
          }).filter(s=>s.packets.length),byScope=new Map(scoped.map(s=>[s.scope,s]));
            // Ordinary sales/history are not read on every Sync status change.
            // Only scopes containing retained evidence need related snapshots.
            const wanted=dataKeys.filter(({scope,key})=>{
              const source=byScope.get(scope);if(!source)return false;
              return key.length===3||key[2]==='movimentacoesEstoque'||source.packets.some(p=>p.payload.writes.some(w=>w.entityType==='sales'&&w.entityId===key[3]));
            });
            const finish=()=>done(scoped.map(source=>{const decoded=decode(rows.filter(r=>r.scope===source.scope));return{...source,local:{vendas:decoded.data.vendas||[],movimentacoesEstoque:decoded.data.movimentacoesEstoque||[]}};}));
            let remaining=wanted.length;
            if(!remaining)finish();
            for(const entry of wanted){
              const item=store.get(entry.primaryKey);
              item.onsuccess=()=>{
                if(item.result)rows.push(item.result);
                if(--remaining===0){try{finish();}catch{fail(failure('recovery-source-invalid','Snapshots preservados precisam de revisão. Nenhum dado foi alterado.'));}}
              };
            }
          }catch{fail(failure('recovery-source-invalid','Um registro preservado precisa de revisão. Nenhum dado foi alterado.'));}
          return;
        }
        const signature=signatureOf(cursor.key);
        let key;try{key=JSON.parse(cursor.primaryKey);}catch{cursor.continue();return;}
        if(signature&&Array.isArray(key)&&key[0]===cursor.key){
          if(key[1]==='sync'&&key[2]===queueField(signature)){const item=store.get(cursor.primaryKey);item.onsuccess=()=>{if(item.result)rows.push(item.result);};}
          else if(key[1]==='data'&&['vendas','movimentacoesEstoque'].includes(key[2]))dataKeys.push({scope:cursor.key,primaryKey:cursor.primaryKey,key});
        }
        cursor.continue();
      };
    });
    const current=session;
    if(current&&signatureOf(current.scope)&&!current.retired){
      const raw=current.values.get(queueField(signatureOf(current.scope)))||'[]';
      let packets;try{packets=retained(parseQueue(raw));}catch{throw failure('recovery-source-invalid','A fila preservada precisa de revisão. Nenhum dado foi alterado.');}
      // Prefer the current in-memory revision over its older durable snapshot.
      // Other namespaces stay read-only; no flush, stage, migration or ack.
      const existing=sources.findIndex(source=>source.scope===current.scope);
      if(existing>=0&&!current.error)sources.splice(existing,1);
      if(packets.length){
        const ids=new Set(packets.flatMap(p=>p.payload.writes.filter(w=>w.entityType==='sales').map(w=>w.entityId))),operations=new Set(packets.map(p=>p.operationId));
        sources.push({packets,local:{vendas:(current.data.vendas||[]).filter(s=>ids.has(s.id)),movimentacoesEstoque:(current.data.movimentacoesEstoque||[]).filter(m=>operations.has(m.operationId)||ids.has(m.vendaId))}});
      }
    }
    // Older scoped queue copies may still live in Storage. Read exact scopes only.
    for(let n=0;n<localStorage.length;n++){
      const key=localStorage.key(n),queuePrefix=`adiFesta:${businessId}:${uid}:`;
      if(!key?.startsWith(queuePrefix)||!key.endsWith(':syncQueue'))continue;
      const signature=signatureOf(prefix+key.slice(queuePrefix.length,-':syncQueue'.length));
      if(!signature)continue;
      let packets;try{packets=parseQueue(localStorage.getItem(key));}catch{throw failure('recovery-source-invalid','Uma cópia preservada precisa de revisão. Nenhum dado foi alterado.');}
      // Same packets may exist in IDB; the client compares their full contents.
      sources.push({packets:retained(packets),local:{vendas:[],movimentacoesEstoque:[]}});
    }
    return clone(sources);
  }
  DB.businessCache = {open, flush, keyValue, diagnostic, inventory, recoverySources,
    stage(data, key) { const current = requireSession(); if (key && key !== current.key) throw failure('local-cache-scope-changed', 'A empresa mudou durante a gravação. Tente novamente.'); current.data = clone(data); schedule(current); },
    release() { ++lifecycleEpoch; if (session) session.suspended = true; return serial(closeCurrent); },
    async retire() {
      const current=session;
      if(!current)return;
      current.retired=true;current.dirty=false;
      try{if(current.running)await current.running;}finally{await current.unlock?.();if(session===current)session=null;}
    },
    ready: () => Boolean(session && !session.suspended && !session.obsolete && !session.error && !session.retired), pending: () => Boolean(session?.dirty || session?.running)};
  DB.flush = () => flush();
  window.addEventListener('beforeunload', event => { if (DB.businessCache.pending()) {event.preventDefault(); event.returnValue = '';} });
})();
