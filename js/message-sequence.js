(function () {
  'use strict';
  const TERMINAL = new Set(['FINISHED', 'CANCELLED']), RETENTION = 30 * 86400000;
  const tabId = crypto.randomUUID(), histories = new Map(), booting = new Map();
  let flushing = null;
  const stamp = () => new Date().toISOString();
  const fault = (message, code = 'sequence-conflict') => Object.assign(Error(message), { code });
  function context() {
    const businessId = DB.getBusinessId(), actor = window.TeamAccess?.actor?.() || {};
    const actorUid = actor.actorUid || window.FirebaseSession?.user?.uid;
    if (!actorUid || !businessId || businessId === '__signed_out__') throw fault('Entre na sua conta para continuar.', 'unauthenticated');
    return { businessId, actorUid, actor, scope: `${businessId}:${actorUid}` };
  }
  const allowed = () => { if (!Mensagens.canSend()) throw fault('Seu acesso não permite enviar mensagens.', 'permission-denied'); };
  const activeKey = ctx => `message-active:${ctx.scope}`;
  const assertContext = ctx => { if (context().scope !== ctx.scope) throw fault('A conta mudou. Abra a Central novamente.', 'session-changed'); };
  function diagnostic(kind, key, value) {
    if (['localhost', '127.0.0.1'].includes(location.hostname) || window.__VECONI_DEV__)
      console.info('[SEQUENCE STORAGE]', { kind, key, bytes: new Blob([JSON.stringify(value)]).size, storage: 'IndexedDB' });
  }
  function write(store, record) { diagnostic(record.kind, record.key, record); store.put(record); }
  function trim(store, ctx) {
    const request = store.index('scope').openCursor(ctx.scope);
    request.onsuccess = () => {
      const cursor = request.result; if (!cursor) return;
      const record = cursor.value;
      // Unsent business events and unfinished sequences are never collected.
      if ((record.kind === 'summary' || record.kind === 'draft' || ['legacy-sequence', 'sequence'].includes(record.kind) && TERMINAL.has(record.status)) &&
          Date.now() - Date.parse(record.updatedAt) > RETENTION) cursor.delete();
      cursor.continue();
    };
  }
  function summary(store, seq) {
    write(store, { key: `message-summary:${seq.scope}:${seq.id}`, scope: seq.scope, kind: 'summary',
      id: seq.id, status: seq.status, type: seq.type, total: seq.selectedCustomerIds.length,
      confirmedCount: seq.confirmedCount, skippedCount: seq.skippedCount,
      remainingCount: seq.selectedCustomerIds.length - seq.currentIndex, updatedAt: seq.updatedAt });
  }
  async function change(expected, action, strict = false) {
    allowed(); const ctx = context(); await ready();
    const result = await DB.localRecords.transaction('readwrite', (store, done, fail) => {
      const request = store.get(activeKey(ctx));
      request.onsuccess = () => {
        try {
          assertContext(ctx); const seq = request.result;
          if (!seq || seq.id !== expected.id) throw fault('A sequência já foi encerrada. Abra a Central novamente.');
          // The expected customer prevents a second click/tab from advancing a second time.
          if (seq.currentIndex !== expected.currentIndex || seq.revision !== expected.revision) {
            if (strict) throw fault('A sequência foi atualizada em outra aba. Abra a Central para continuar.');
            done(seq); return;
          }
          if (TERMINAL.has(seq.status)) throw fault('Esta sequência já foi encerrada.');
          action(seq, store, ctx);
          seq.updatedAt = stamp(); seq.revision++;
          write(store, seq); if (TERMINAL.has(seq.status)) summary(store, seq);
          done(seq);
        } catch (error) { fail(error); }
      };
    });
    assertContext(ctx); return result;
  }
  async function ready() {
    const ctx = context();
    if (!booting.has(ctx.scope)) booting.set(ctx.scope, (async () => {
      // Import only this actor's old operational state; all financial collections stay intact.
      const legacy = (DB.carregar().messageSequences || []).filter(seq =>
        (!seq.businessId || seq.businessId === ctx.businessId) &&
        (seq.actorUid === ctx.actorUid || !seq.actorUid && ctx.actor.actorRoleSnapshot === 'owner'));
      const active = legacy.filter(seq => !['completed', 'cancelled', 'finished'].includes(seq.status) &&
        Array.isArray(seq.clientIds) && seq.clientIds.length > Math.max(0, Number(seq.currentIndex) || 0))
        .sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt))[0];
      const copiedIds = await DB.localRecords.transaction('readwrite', (store, done, fail) => {
        const request = store.get(`message-migrated:${ctx.scope}`);
        request.onsuccess = () => {
          try {
            if (!request.result) {
              for (const seq of legacy) write(store, { key: `message-legacy:${ctx.scope}:${seq.id}`, scope: ctx.scope,
                kind: 'legacy-sequence', id: seq.id, status: ['completed', 'finished'].includes(seq.status) ? 'FINISHED' : seq.status === 'cancelled' ? 'CANCELLED' : 'PREPARED',
                selectedCustomerIds: [...new Set(seq.clientIds || [])], currentIndex: seq.currentIndex || 0,
                confirmedCount: (seq.completedIds || []).length, skippedCount: (seq.skippedIds || []).length,
                baseMessage: String(seq.baseMessage || '').slice(0, 4000), updatedAt: seq.updatedAt || stamp() });
              const existing = store.get(activeKey(ctx));
              existing.onsuccess = () => {
                try {
                assertContext(ctx);
                if (!existing.result && active) {
                  const seq = makeSequence(ctx, { type: active.type, clientIds: active.clientIds || [], templateId: active.templateId, baseMessage: active.baseMessage });
                  seq.id = active.id; seq.currentIndex = Math.max(0, Math.min(Math.floor(Number(active.currentIndex)) || 0, seq.selectedCustomerIds.length));
                  seq.currentCustomerId = seq.selectedCustomerIds[seq.currentIndex] || null;
                  seq.confirmedCount = (active.completedIds || []).length; seq.skippedCount = (active.skippedIds || []).length;
                  seq.status = seq.currentCustomerId ? 'PREPARED' : 'FINISHED';
                  const opened = (DB.carregar().messageHistory || []).find(event => event.sequenceId === active.id &&
                    event.clientId === seq.currentCustomerId && event.status === 'opened_whatsapp');
                  if (opened && opened.operationId) {
                    // Preserve the original event identity. Only explicit confirmation may update it.
                    seq.current = { clientId: opened.clientId, clientName: opened.clientName, phone: opened.phone,
                      finalMessage: opened.finalMessage, amountAtSend: opened.amountAtSend ?? null,
                      operationId: opened.operationId, legacyEventId: opened.id,
                      legacyChargeId: (DB.carregar().cobrancas || []).find(charge => charge.messageId === opened.id)?.id || null };
                    seq.status = 'AWAITING_CONFIRMATION';
                  }
                  seq.migrated = true; write(store, seq);
                }
                write(store, { key: `message-migrated:${ctx.scope}`, scope: ctx.scope, kind: 'migration', copiedIds: legacy.map(seq => seq.id), updatedAt: stamp() });
                } catch (error) { fail(error); }
              };
            }
            trim(store, ctx); done(request.result ? request.result.copiedIds || [] : legacy.map(seq => seq.id));
          } catch (error) { fail(error); }
        };
      });
      assertContext(ctx);
      if (copiedIds.length) await DB.compactMessageSequences?.(copiedIds);
      // These keys contain only obsolete Central state, never carts or the sync queue.
      for (const storage of [localStorage, sessionStorage]) {
        for (const key of ['adiFestaMessageCenterState_v2', 'adiFestaActiveMessageSequence_v2']) storage.removeItem(key);
        let pending;
        try { pending = JSON.parse(storage.getItem('adiFestaMessagePendingReturn_v1') || 'null'); }
        catch (error) { console.warn('[SEQUENCE] invalid legacy return metadata', error.name); }
        if (pending?.sequenceId && legacy.some(seq => seq.id === pending.sequenceId)) storage.removeItem('adiFestaMessagePendingReturn_v1');
      }
      await refreshHistory(ctx);
    })().catch(error => { booting.delete(ctx.scope); throw error; }));
    return booting.get(ctx.scope);
  }
  function makeSequence(ctx, input) {
    const ids = [...new Set((input.clientIds || []).map(String))];
    if (!ids.length) throw fault('Selecione ao menos um cliente.');
    const spaceId = window.SpaceContext?.homeId?.();
    return { key: activeKey(ctx), scope: ctx.scope, kind: 'sequence', id: crypto.randomUUID(), businessId: ctx.businessId,
      actorUid: ctx.actorUid, actorNameSnapshot: ctx.actor.actorNameSnapshot || null, actorRoleSnapshot: ctx.actor.actorRoleSnapshot || null,
      spaceId: spaceId && spaceId !== 'all_spaces' ? spaceId : null,
      type: Mensagens.TYPES.includes(input.type) ? input.type : 'custom', templateId: input.templateId || null,
      baseMessage: String(input.baseMessage || '').slice(0, 4000), selectedCustomerIds: ids,
      currentIndex: 0, currentCustomerId: ids[0], status: 'PREPARED', current: null, revision: 0,
      confirmedCount: 0, skippedCount: 0, startedAt: stamp(), updatedAt: stamp() };
  }
  async function start(input) {
    allowed(); const ctx = context(); await ready();
    return DB.localRecords.transaction('readwrite', (store, done, fail) => {
      const request = store.get(activeKey(ctx));
      request.onsuccess = () => {
        try {
          assertContext(ctx); const existing = request.result;
          if (existing && !TERMINAL.has(existing.status)) return done({ sequence: existing, resumed: true });
          const seq = makeSequence(ctx, input); write(store, seq); done({ sequence: seq, resumed: false });
        } catch (error) { fail(error); }
      };
    });
  }
  async function active() { const ctx = context(); await ready(); assertContext(ctx); const value = await DB.localRecords.read(activeKey(ctx)); assertContext(ctx); return value && !TERMINAL.has(value.status) ? value : null; }
  async function draft(value) {
    const ctx = context(), key = `message-draft:${ctx.scope}`; await ready(); assertContext(ctx);
    if (value === undefined) return (await DB.localRecords.read(key))?.value || null;
    return DB.localRecords.transaction('readwrite', (store, done) => { assertContext(ctx); write(store, { key, scope: ctx.scope, kind: 'draft', value, updatedAt: stamp() }); done(value); });
  }
  async function prepare(seq, input) {
    return change(seq, current => {
      if (current.status !== 'PREPARED') throw fault('Confirme o contato atual antes de abrir outro.');
      if (input.clientId !== current.currentCustomerId || !Mensagens.validPhone({ telefone: input.phone })) throw fault('Telefone inválido. Revise o cadastro ou pule este cliente.');
      current.baseMessage = String(input.baseMessage || '').slice(0, 4000); current.templateId = input.templateId || null;
      current.current = { clientId: input.clientId, clientName: String(input.clientName || ''), phone: input.phone,
        finalMessage: String(input.finalMessage || '').slice(0, 4000), amountAtSend: current.type === 'charge' ? input.amountAtSend : null,
        operationId: `sequence_${encodeURIComponent(current.id)}_${encodeURIComponent(input.clientId)}`, preparedAt: stamp() };
      current.status = 'AWAITING_CONFIRMATION'; current.openingTabId = tabId;
    }, true);
  }
  const unprepare = seq => change(seq, current => { current.status = 'PREPARED'; current.current = null; }, true);
  const edit = (seq, input) => change(seq, current => {
    if (current.status !== 'PREPARED') throw fault('Confirme o contato atual antes de editar a mensagem.');
    current.baseMessage = String(input.baseMessage || '').slice(0, 4000);
    current.templateId = input.templateId || null;
  }, true);
  async function advance(seq, outcome) {
    const result = await change(seq, (current, store, ctx) => {
      if (outcome === 'CONFIRMED') {
        if (current.status !== 'AWAITING_CONFIRMATION' || !current.current) throw fault('Abra a mensagem antes de confirmar o envio.');
        const item = current.current, event = { id: item.legacyEventId || item.operationId, operationId: item.operationId, idempotencyKey: item.operationId,
          legacyEventId: item.legacyEventId || null, legacyChargeId: item.legacyChargeId || null,
          businessId: ctx.businessId, actorUid: ctx.actorUid, actorNameSnapshot: current.actorNameSnapshot, actorRoleSnapshot: current.actorRoleSnapshot,
          spaceId: current.spaceId, clientId: item.clientId, customerId: item.clientId, clientName: item.clientName,
          phone: item.phone, type: current.type, messageType: current.type, channel: 'whatsapp', source: 'message_center',
          templateId: current.templateId, sequenceId: current.id, finalMessage: item.finalMessage, amountAtSend: item.amountAtSend,
          status: 'sent_confirmed', confirmedByUser: true, sentAt: stamp(), confirmedAt: stamp(), createdAt: stamp(), updatedAt: stamp() };
        // Progress and its business event commit together, including during offline use.
        write(store, { key: `message-event:${ctx.scope}:${event.id}`, scope: ctx.scope, kind: 'event', event, syncedAt: null, updatedAt: event.updatedAt });
        current.confirmedCount++;
      } else if (outcome === 'SKIPPED') current.skippedCount++;
      else throw fault('Ação de sequência inválida.');
      current.lastOutcome = outcome; current.currentIndex++; current.currentCustomerId = current.selectedCustomerIds[current.currentIndex] || null;
      current.current = null; current.status = current.currentCustomerId ? 'PREPARED' : 'FINISHED';
    });
    await refreshHistory(context());
    if (navigator.onLine === false) dispatchEvent(new CustomEvent('message-sequence-sync', { detail: { pending: true } }));
    flush(); return result;
  }
  const cancel = seq => change(seq, current => { current.status = 'CANCELLED'; current.current = null; });
  async function refreshHistory(ctx) {
    const records = await DB.localRecords.list(ctx.scope); assertContext(ctx);
    histories.set(ctx.scope, records.filter(record => record.kind === 'event').map(record => record.event));
    dispatchEvent(new CustomEvent('message-history-updated'));
  }
  function history() { try { return histories.get(context().scope) || []; } catch { return []; } }
  async function flush() {
    if (flushing || navigator.onLine === false || !window.SyncFirebase?.publishConfirmedMessage) return flushing;
    flushing = (async () => {
      const ctx = context(); await ready(); allowed();
      for (const record of await DB.localRecords.list(ctx.scope)) {
        if (record.kind !== 'event' || record.syncedAt) continue;
        assertContext(ctx); allowed();
        await SyncFirebase.publishConfirmedMessage(record.event);
        assertContext(ctx);
        await DB.localRecords.transaction('readwrite', (store, done) => { record.syncedAt = stamp(); write(store, record); done(true); });
      }
      dispatchEvent(new CustomEvent('message-sequence-sync', { detail: { pending: 0 } }));
    })().catch(error => {
      console.error('[SEQUENCE SYNC]', { code: error.code || 'unknown', stage: 'confirmed-event', message: error.message });
      dispatchEvent(new CustomEvent('message-sequence-sync', { detail: { pending: true, code: error.code || 'unknown' } }));
    }).finally(() => { flushing = null; });
    return flushing;
  }
  function friendly(error) {
    console.error('[SEQUENCE ERROR]', { code: error?.code || error?.name, message: error?.message });
    if (['QuotaExceededError', 'UnknownError', 'InvalidStateError', 'AbortError', 'SecurityError', 'DataCloneError', 'VersionError', 'NotFoundError'].includes(error?.name))
      return 'Não foi possível salvar o progresso neste aparelho. Seu último passo foi preservado; libere espaço no aparelho e tente novamente.';
    return error?.message || 'Não foi possível continuar a sequência. Tente novamente.';
  }
  addEventListener('online', flush);
  addEventListener('firebase-auth-ready', () => { if (Mensagens.canSend()) ready().then(flush).catch(error => console.error('[SEQUENCE INIT]', error)); });
  window.MessageSequence = Object.freeze({ ready, active, start, draft, edit, prepare, unprepare, advance, cancel, history, flush, friendly, tabId });
})();
