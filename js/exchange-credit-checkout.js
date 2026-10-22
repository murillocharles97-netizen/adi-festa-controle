/* Scoped exchange tender. All commercial effects are performed by the server transaction. */
window.ExchangeCreditCheckout = (() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = cents => (Number(cents || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const integer = value => Number.isSafeInteger(value) && value >= 0;
  const signature = () => JSON.stringify([window.FirebaseSession?.user?.uid, DB.getBusinessId(), DB.getWorkspaceGeneration(), window.TeamAccess?.operationalReadScopeKey?.() || '']);
  const actor = () => ({ uid: window.FirebaseSession?.user?.uid, businessId: DB.getBusinessId(), workspaceGeneration: DB.getWorkspaceGeneration() });
  const keyFor = (scope, spaceId) => `veconi:exchange-credit:${scope.uid}:${scope.businessId}:${scope.workspaceGeneration}:${spaceId}`;
  const canUse = () => Boolean(window.TeamAccess?.has?.('sales.create') && window.TeamAccess?.has?.('customers.view'));
  function assertCausalQueue(){const d=window.SyncFirebase?.getFirebaseDiagnostic?.();if(d&&(Number(d.pending)>0||Number(d.syncErrors)>0||d.queueStorageCorrupt))throw Error('Sincronize as alterações locais anteriores antes de usar ou restaurar crédito de troca. Este fluxo não reenvia nem descarta pendências.');}
  let state = null, busy = false, dismissActive = null;
  const deterministic = error => ['failed-precondition','invalid-argument','out-of-range'].includes(String(error?.code || '').replace(/^functions\//,''));
  function markRejected(s, envelope, error) {
    if (!deterministic(error)) return;
    localStorage.setItem(`${s.key}:review`, JSON.stringify({operationId:envelope.request.operationId,reason:'rejected_without_commit',verifiedAt:new Date().toISOString()}));
  }
  function read(key) { const value = JSON.parse(localStorage.getItem(key) || 'null'); if (value && (!value.request?.operationId || !value.request?.saleId || !Array.isArray(value.request.items))) throw Error('A confirmação de crédito preservada precisa de conferência.'); return value; }
  function scopeFor(clientId, spaceId) { const a = actor(); if (!a.uid || !a.businessId || !clientId || !spaceId || ['all', 'all_spaces'].includes(spaceId)) throw Error('Selecione cliente e espaço desta venda.'); return { ...a, clientId, spaceId }; }
  const still = s => s.signature === signature() && canUse();
  async function call(name, scope, data, sessionSignature) {
    if (sessionSignature !== signature()) throw Error('A sessão mudou. Consulte a confirmação na conta de origem.');
    if (!navigator.onLine) throw Error('Conecte-se para usar crédito de troca.');
    if(['confirmExchangeCreditSale','cancelExchangeCreditSale'].includes(name))assertCausalQueue();
    const response = await window.FirebaseCallable(name, { ...data, businessId: scope.businessId, workspaceGeneration: scope.workspaceGeneration, spaceId: scope.spaceId, clientId: scope.clientId });
    if (sessionSignature !== signature()) throw Error('A sessão mudou. A tentativa foi preservada na conta de origem.');
    return response.data ?? response;
  }
  async function locked(name, action) {
    if (!navigator.locks?.request) throw Error('Este navegador não oferece a proteção necessária para usar crédito. Abra em um Chrome atualizado.');
    return navigator.locks.request(name, { ifAvailable: true }, lock => { if (!lock) throw Error('Outra aba está confirmando esta operação. Aguarde e consulte o resultado.'); return action(); });
  }
  function requestFor(draft, scope, creditCents, paymentMethod) {
    if (!draft.id || !draft.operationId || draft.spaceId !== scope.spaceId || (draft.clienteId || draft.clientId) !== scope.clientId) throw Error('A venda precisa manter os mesmos IDs, cliente e espaço até a confirmação.');
    if (draft.status === 'fiado' || draft.formaPagamento === 'fiado' || draft.paymentIntentId || draft.paymentMetadata || draft.onlineOrderId || draft.catalogOrderId || draft.ajusteManual || draft.descontoTipo || Number(draft.descontoTotal || 0) || Number(draft.discountCents || 0) || draft.appliedCampaignIds?.length || draft.campaignId) throw Error('Crédito de troca exige venda à vista, com preços atuais, sem desconto, campanha ou pagamento integrado nesta V1.');
    if (!Array.isArray(draft.itens) || !draft.itens.length) throw Error('Adicione os produtos desta venda.');
    const items = draft.itens.map(item => ({ productId: item.produtoId || item.productId, variantId: item.variantId || null, quantity: Number(item.quantidade ?? item.quantity) }));
    const units = draft.itens.map(item => Math.round(Number(item.precoFinalUnitario ?? item.precoUnitario ?? item.preco) * 100));
    if (items.some((item, index) => !item.productId || !Number.isSafeInteger(item.quantity) || item.quantity < 1 || !integer(units[index]) || units[index] < 1)) throw Error('Itens ou preços da venda precisam ser conferidos.');
    const grossCents = items.reduce((sum, item, index) => sum + item.quantity * units[index], 0);
    if (!integer(grossCents) || grossCents < 1 || !integer(creditCents) || creditCents < 1 || creditCents > grossCents) throw Error('Valor de crédito inválido para esta venda.');
    return { request: { items, creditCents, paymentMethod: paymentMethod || null, saleId: draft.id, operationId: draft.operationId }, units, grossCents };
  }
  function validateQuote(plan, prepared, localTotalCents) {
    if (!Array.isArray(plan.items) || plan.items.length !== prepared.request.items.length || !plan.fingerprint || plan.grossCents !== prepared.grossCents || plan.grossCents !== localTotalCents || plan.creditUsedCents !== prepared.request.creditCents || plan.cashReceivedCents !== plan.grossCents - plan.creditUsedCents) throw Error('Os valores mudaram. Confira o carrinho antes de usar o crédito.');
    for (const [index, item] of prepared.request.items.entries()) {
      const row = plan.items.find(p => p.productId === item.productId && (p.variantId || null) === item.variantId);
      if (!row || row.quantity !== item.quantity || row.unitCents !== prepared.units[index]) throw Error('Preço ou variação mudou. Crédito de troca exige os preços atuais nesta V1.');
    }
  }
  function validateCommit(result, scope, request) {
    const sale = result.sale, receipt = result.receipt;
    if (!sale || !receipt || receipt.operationId !== request.operationId || receipt.status !== 'processed' || typeof receipt.checksum !== 'string' || !receipt.checksum || sale.id !== request.saleId || sale.operationId !== request.operationId || sale.businessId !== scope.businessId || sale.spaceId !== scope.spaceId || (sale.workspaceGeneration ?? 0) !== scope.workspaceGeneration || sale.clienteId !== scope.clientId || !['pago', 'cancelado'].includes(sale.status)) throw Error('O comprovante não corresponde à confirmação preservada. Consulte novamente.');
    return sale;
  }
  function archive(key, envelope, receipt) {
    const attempts = JSON.parse(localStorage.getItem(`${key}:attempts`) || '[]');
    if (!Array.isArray(attempts)) throw Error('Não foi possível preservar o comprovante neste aparelho.');
    const previous = attempts.find(x => x.request.operationId === envelope.request.operationId);
    if (!previous) localStorage.setItem(`${key}:attempts`, JSON.stringify([...attempts, { ...envelope, outcome: receipt.status==='rejected_without_commit'?'rejected_without_commit':'committed', receipt, confirmedAt: new Date().toISOString() }]));
    localStorage.removeItem(key);
  }
  function refreshCard(s) {
    if (!s.host || state !== s || !still(s)) return;
    let pending;
    try { pending = read(s.key); } catch (error) { s.error = error.message; }
    if (!s.clientId && !pending) { s.host.innerHTML = ''; return; }
    let rejected = false;
    try { rejected = pending && JSON.parse(localStorage.getItem(`${s.key}:review`) || 'null')?.operationId === pending.request.operationId; } catch { /* A malformed note never authorizes a new attempt. */ }
    const maximum = Math.min(s.availableCents || 0, s.totalCents || 0), blocked = document.querySelector('#sale-status')?.value === 'fiado';
    s.selected = blocked && !pending ? 0 : Math.min(s.selected || 0, maximum);
    s.host.innerHTML = `<section class="exchange-credit-card"><div class="exchange-credit-heading"><span class="exchange-credit-symbol" aria-hidden="true">↔</span><div><h4>Crédito de troca</h4><p>${s.loading ? 'Consultando saldo deste cliente…' : `Disponível neste espaço: <b>${money(s.availableCents)}</b>`}</p></div></div>${pending ? `<div class="exchange-credit-held"><b>Confirmação preservada</b><p>Consulte o resultado antes de registrar outra venda. Os IDs originais serão mantidos.</p><button type="button" data-credit-consult>Consultar confirmação</button><button type="button" data-credit-retry>Repetir mesma confirmação</button></div>` : blocked ? '<p>Crédito de troca não é utilizado em vendas Fiado nesta versão.</p>' : s.availableCents > 0 ? `<div class="exchange-credit-controls"><button type="button" data-credit-all ${s.loading || busy ? 'disabled' : ''}>Usar crédito</button><label>Valor a usar<input type="number" inputmode="decimal" min="0" max="${(maximum / 100).toFixed(2)}" step="0.01" value="${(s.selected / 100).toFixed(2)}" data-credit-amount ${s.loading || busy ? 'disabled' : ''}></label>${s.selected ? '<button type="button" class="exchange-credit-link" data-credit-remove>Não usar</button>' : ''}</div><div class="exchange-credit-breakdown"><span>Crédito nesta venda <b>${money(s.selected)}</b></span><span>Restante a cobrar <b>${money(Math.max(0, s.totalCents - s.selected))}</b></span><span>Saldo após o uso <b>${money(Math.max(0, s.availableCents - s.selected))}</b></span></div><small>Crédito separado do Fiado. Disponibilidade confirmada ao finalizar.</small>` : s.loading ? '' : '<p>Este cliente não possui crédito disponível neste espaço.</p>'}<p class="exchange-credit-error" role="alert">${esc(s.error || '')}</p></section>`;
    const update = amount => { if (busy || !still(s) || pending) return; const n = Math.round(Number(amount) * 100); if (!integer(n) || n > maximum) { s.error = `Informe até ${money(maximum)}.`; refreshCard(s); return; } s.error = ''; s.selected = n; refreshCard(s); s.onChange?.(n); };
    const all = s.host.querySelector('[data-credit-all]'), input = s.host.querySelector('[data-credit-amount]'), remove = s.host.querySelector('[data-credit-remove]');
    if (all) all.onclick = () => update(maximum / 100);
    if (input) input.onchange = () => update(input.value);
    if (remove) remove.onclick = () => update(0);
    if (rejected) s.host.querySelector('.exchange-credit-held')?.insertAdjacentHTML('beforeend','<button type="button" data-credit-revise>Revisar valores novamente</button>');
    const revise = s.host.querySelector('[data-credit-revise]');
    if (revise) revise.onclick = async () => {
      if (busy || !still(s)) return;
      busy = true;
      try { await locked(s.key,async()=>{
        const envelope=read(s.key),note=JSON.parse(localStorage.getItem(`${s.key}:review`)||'null');
        if (!envelope || note?.operationId!==envelope.request.operationId) throw Error('A tentativa precisa ser consultada antes de revisar.');
        const result=await call('getExchangeCreditSaleStatus',{...s,clientId:envelope.clientId},{saleId:envelope.request.saleId,operationId:envelope.request.operationId},s.signature);
        if (result.committed) throw Error('A venda foi confirmada. Consulte a confirmação; não crie outra venda.');
        archive(s.key,envelope,{status:'rejected_without_commit',verifiedAt:note.verifiedAt});
        localStorage.removeItem(`${s.key}:review`);s.selected=0;s.loadedAt=0;s.onChange?.(0);
      }); } catch(error) { if(still(s))s.error=error.message; } finally {busy=false;refreshCard(s);}
    };
    const consult = s.host.querySelector('[data-credit-consult]'), retry = s.host.querySelector('[data-credit-retry]');
    if (consult) consult.onclick = () => resume(s, false);
    if (retry) retry.onclick = () => resume(s, true);
  }
  async function mount(options) {
    const totals = document.querySelector('#sale-totals');
    if (!totals || !canUse()) { reset(); return; }
    const a = actor(), spaceId = String(options.spaceId || ''), clientId = String(options.clientId || ''), sessionSignature = signature();
    if (!a.uid || !a.businessId || !spaceId || ['all', 'all_spaces'].includes(spaceId)) { document.querySelector('#exchange-credit-checkout')?.remove(); state = null; return; }
    let host = document.querySelector('#exchange-credit-checkout');
    if (!host) { host = document.createElement('div'); host.id = 'exchange-credit-checkout'; totals.before(host); }
    const sameScope = state && state.signature === sessionSignature && state.spaceId === spaceId && state.clientId === clientId;
    const s = sameScope ? state : { ...a, clientId, spaceId, signature: sessionSignature, host, key: keyFor(a, spaceId), selected: 0, availableCents: 0, loadedAt: 0 };
    Object.assign(s, { host, totalCents: integer(options.totalCents) ? options.totalCents : 0, onChange: options.onChange, onRecovered: options.onRecovered }); state = s;
    refreshCard(s);
    if (!clientId || sameScope && (s.loading || Date.now() - s.loadedAt < 15000)) return;
    s.loading = true; refreshCard(s);
    try {
      const result = await call('getExchangeCreditBalance', scopeFor(clientId, spaceId), {}, sessionSignature);
      if (state !== s || !still(s)) return;
      if (!integer(result.availableCents)) throw Error('Saldo de crédito não pôde ser confirmado.');
      s.availableCents = result.availableCents; s.loadedAt = Date.now(); s.error = '';
    } catch (error) { if (state === s && still(s)) { s.availableCents = 0; s.selected = 0; s.error = error.message; } }
    finally { if (state === s && still(s)) { s.loading = false; refreshCard(s); } }
  }
  const selectedCents = () => state && still(state) ? state.selected || 0 : 0;
  function hasPending() { if (!state || !still(state)) return false; try { return Boolean(read(state.key)); } catch { return true; } }
  async function resume(s, retry) {
    if (busy || state !== s || !still(s)) return;
    busy = true; s.error = ''; refreshCard(s);
    try {
      await locked(s.key, async () => {
        const envelope = read(s.key); if (!envelope) return;
        const request = envelope.request, scope = { ...s, clientId: envelope.clientId };
        let result = await call('getExchangeCreditSaleStatus', scope, { saleId: request.saleId, operationId: request.operationId }, s.signature);
        if (!result.committed && retry) result = await call('confirmExchangeCreditSale', scope, request, s.signature);
        if (!result.committed && !result.sale) { s.error = 'A confirmação ainda não foi registrada. Repetir usará os mesmos IDs e valores.'; return; }
        const sale = validateCommit(result, scope, request); archive(s.key, envelope, result.receipt);
        if (!still(s)) return;
        s.selected = 0; s.loadedAt = 0; s.onRecovered?.(sale);
        window.dispatchEvent(new CustomEvent('exchange-credit-sale-completed', { detail: { sale, businessId: s.businessId, spaceId: s.spaceId } }));
      });
    } catch (error) {
      if (state === s && still(s)) {
        s.error=error.message;
        if(retry&&deterministic(error))try{
          const envelope=read(s.key);
          if(envelope){const status=await call('getExchangeCreditSaleStatus',{...s,clientId:envelope.clientId},{saleId:envelope.request.saleId,operationId:envelope.request.operationId},s.signature);if(!status.committed)markRejected(s,envelope,error);}
        }catch{/* Uncertain results remain preserved and non-replaceable. */}
      }
    }
    finally { busy = false; if (state === s && still(s)) refreshCard(s); }
  }
  async function finish(draft) {
    assertCausalQueue();
    const s = state;
    if (!s || !still(s) || !s.selected) throw Error('Selecione o crédito de troca antes de finalizar.');
    if (busy) throw Error('Uma confirmação de crédito já está em andamento.');
    const scope = scopeFor(s.clientId, s.spaceId), selected = s.selected, localTotal = s.totalCents;
    requestFor(draft, scope, selected, null);
    if (read(s.key)) throw Error('Há uma confirmação preservada. Use Consultar confirmação antes de uma nova venda.');
    busy = true; refreshCard(s);
    try { return await locked(s.key, async () => {
      if (!still(s) || state !== s || read(s.key)) throw Error('Contexto alterado ou confirmação já preservada. Consulte o resultado antes de continuar.');
      return new Promise((resolve, reject) => {
        const modal = document.querySelector('#modal'); if (!modal) { reject(Error('Não foi possível abrir a revisão.')); return; }
        let quoting = false, committing = false, plan = null, prepared = null, envelope = null, ended = false;
        const token = crypto.randomUUID(); modal.dataset.exchangeCreditToken = token;
        modal.innerHTML = `<div class="modal-bg"><section class="modal-box exchange-credit-dialog" role="dialog" aria-modal="true" aria-labelledby="exchange-credit-title"><header><div><small>Venda com crédito de troca</small><h2 id="exchange-credit-title">Revise o pagamento</h2></div><button type="button" data-credit-close aria-label="Fechar">×</button></header><div class="exchange-credit-review-values"><p>Total da venda <b>${money(localTotal)}</b></p><p>Crédito selecionado <b>${money(selected)}</b></p><p>Complemento <b>${money(localTotal - selected)}</b></p></div>${localTotal > selected ? '<label>Como o complemento foi recebido?<select data-credit-method><option value="">Selecione</option><option value="dinheiro">Dinheiro</option><option value="pix">Pix recebido manualmente</option><option value="cartao">Cartão em máquina externa</option></select></label>' : '<p>O crédito cobre o valor total desta venda.</p>'}<div data-credit-review></div><p class="exchange-credit-error" role="alert" data-credit-error></p><footer><button type="button" class="exchange-credit-secondary" data-credit-close>Voltar</button><button type="button" data-credit-review-button>Conferir valores</button><button type="button" data-credit-confirm hidden>Confirmar venda</button><button type="button" data-credit-status hidden>Consultar resultado</button><button type="button" data-credit-same hidden>Repetir mesma confirmação</button></footer></section></div>`;
        const error = modal.querySelector('[data-credit-error]'), review = modal.querySelector('[data-credit-review]'), confirm = modal.querySelector('[data-credit-confirm]'), reviewButton = modal.querySelector('[data-credit-review-button]'), status = modal.querySelector('[data-credit-status]'), same = modal.querySelector('[data-credit-same]'), method = modal.querySelector('[data-credit-method]');
        const valid = () => !ended && still(s) && state === s && modal.dataset.exchangeCreditToken === token;
        const fail = e => { if (valid()) error.textContent = e.message; };
        const buttons = value => modal.querySelectorAll('button,select,input').forEach(n => { n.disabled = value; });
        const end = (error, sale) => { if (ended) return; ended = true; dismissActive=null; if (modal.dataset.exchangeCreditToken === token) { modal.innerHTML = ''; delete modal.dataset.exchangeCreditToken; } error ? reject(error) : resolve(sale); };
        dismissActive=()=>end(Error('A sessão ou o espaço mudou. A confirmação preservada só pode ser consultada na conta de origem.'));
        const complete = result => { const sale = validateCommit(result, scope, envelope.request); archive(s.key, envelope, result.receipt); if (!valid()) throw Error('A sessão mudou. Consulte a venda na conta de origem.'); s.selected = 0; s.loadedAt = 0; window.dispatchEvent(new CustomEvent('exchange-credit-sale-completed', { detail: { sale, businessId: s.businessId, spaceId: s.spaceId } })); end(null, sale); };
        const preserveView = () => { if (!valid()) return; reviewButton.hidden = true; confirm.hidden = true; status.hidden = false; same.hidden = false; if (method) method.disabled = true; review.innerHTML = '<p class="exchange-credit-held">Confirmação preservada. Consulte o resultado ou repita a mesma confirmação. Não registre esta venda novamente.</p>'; };
        const send = async lookupOnly => {
          if (!valid() || committing || !envelope) return;
          committing = true; buttons(true); error.textContent = '';
          try {
            if (lookupOnly) { const result = await call('getExchangeCreditSaleStatus', scope, { saleId: envelope.request.saleId, operationId: envelope.request.operationId }, s.signature); if (result.committed) complete(result); else { fail(Error('A confirmação ainda não foi encontrada. Os IDs e valores continuam preservados.')); preserveView(); } }
            else complete(await call('confirmExchangeCreditSale', scope, envelope.request, s.signature));
          } catch (e) {
            if (!valid()) { end(e); return; }
            fail(e);
            try { const result = await call('getExchangeCreditSaleStatus', scope, { saleId: envelope.request.saleId, operationId: envelope.request.operationId }, s.signature); if (result.committed) { complete(result); return; } markRejected(s,envelope,e); } catch { /* Keep the original envelope when confirmation cannot be proved. */ }
            preserveView();
          } finally { committing = false; if (valid()) { buttons(false); if (method && envelope) method.disabled = true; } }
        };
        modal.querySelectorAll('[data-credit-close]').forEach(button => { button.onclick = () => { if (!committing && !quoting) end(Error(envelope ? 'Confirmação preservada. Consulte o resultado antes de registrar outra venda.' : 'Confirmação cancelada antes de registrar a venda.')); }; });
        if (method) method.onchange = () => { if (envelope) return; plan = null; confirm.hidden = true; reviewButton.hidden = false; review.innerHTML = ''; };
        reviewButton.onclick = async () => {
          if (!valid() || quoting || envelope) return;
          if (localTotal > selected && !method?.value) { fail(Error('Selecione como recebeu o complemento.')); return; }
          quoting = true; buttons(true); error.textContent = '';
          try {
            prepared = requestFor(draft, scope, selected, method?.value || null);
            plan = await call('quoteExchangeCreditSale', scope, prepared.request, s.signature); if (!valid()) throw Error('A sessão mudou.');
            validateQuote(plan, prepared, localTotal);
            review.innerHTML = `<div class="exchange-credit-reviewed"><h3>Valores conferidos</h3><ul>${plan.items.map(i => `<li><span>${esc(i.quantity)}× ${esc(i.name)} ${esc(i.variantName || '')}</span><b>${money(i.totalCents)}</b></li>`).join('')}</ul><p>Crédito usado <b>${money(plan.creditUsedCents)}</b></p><p>Recebimento adicional <b>${money(plan.cashReceivedCents)}</b></p>${plan.cashReceivedCents ? `<label class="exchange-credit-ack"><input type="checkbox" data-credit-received>Recebi o complemento de ${money(plan.cashReceivedCents)}.</label>` : ''}<small>Apenas o complemento é novo recebimento. O crédito utilizado não gera receita adicional.</small></div>`;
            confirm.hidden = false; reviewButton.hidden = true;
          } catch (e) { plan = null; fail(e); if (!valid()) end(e); }
          finally { quoting = false; if (valid()) buttons(false); }
        };
        confirm.onclick = async () => {
          if (!valid() || committing || !plan || envelope) return;
          if (plan.cashReceivedCents && !modal.querySelector('[data-credit-received]')?.checked) { fail(Error('Confirme o recebimento do complemento.')); return; }
          try {
            if (read(s.key)) throw Error('Outra confirmação já foi preservada. Consulte o resultado.');
            envelope = { version: 1, clientId: s.clientId, createdAt: new Date().toISOString(), request: { ...prepared.request, fingerprint: plan.fingerprint } };
            localStorage.setItem(s.key, JSON.stringify(envelope));
            if (JSON.stringify(read(s.key)) !== JSON.stringify(envelope)) throw Error('Não foi possível preservar a confirmação neste aparelho.');
          } catch (e) { envelope = null; fail(e); return; }
          await send(false);
        };
        status.onclick = () => send(true); same.onclick = () => send(false);
      });
    }); } finally { busy = false; if (state === s && still(s)) refreshCard(s); }
  }
  async function cancel(sale) {
    if (!window.TeamAccess?.has?.('sales.cancel')) throw Error('Sem permissão para cancelar esta venda.');
    const scope = scopeFor(sale.clienteId, sale.spaceId), sessionSignature = signature(), key = `${keyFor(scope, sale.spaceId)}:cancel:${sale.id}`;
    return locked(key, async () => {
      let preserved = JSON.parse(localStorage.getItem(key) || 'null');
      if (!preserved) { preserved = { saleId: sale.id, operationId: crypto.randomUUID(), createdAt: new Date().toISOString() }; localStorage.setItem(key, JSON.stringify(preserved)); }
      if (preserved.saleId !== sale.id || !preserved.operationId) throw Error('Identificador de cancelamento inconsistente.');
      const response = await call('cancelExchangeCreditSale', scope, { saleId: sale.id, operationId: preserved.operationId }, sessionSignature);
      if (response.saleId !== sale.id || response.operationId !== preserved.operationId || response.status !== 'cancelado') throw Error('O comprovante de cancelamento precisa ser conferido.');
      localStorage.setItem(key, JSON.stringify({ ...preserved, status: 'resolved', resolvedAt: new Date().toISOString() }));
      window.dispatchEvent(new CustomEvent('exchange-credit-sale-cancelled', { detail: { ...scope, saleId: sale.id, operationId: preserved.operationId } }));
      return response;
    });
  }
  function reset() { dismissActive?.(); state = null; document.querySelector('#exchange-credit-checkout')?.remove(); }
  window.addEventListener('firebase-session-cleared',reset);
  window.addEventListener('business-context-changed',()=>{if(state&&!still(state))reset();});
  return { mount, selectedCents, hasPending, finish, cancel, reset };
})();
