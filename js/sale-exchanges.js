/* Explicit online exchange transactions never enter the commercial Sync queue. */
window.SaleExchanges = (() => {
  'use strict';
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const money = v => (Number(v || 0) / 100).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
  const identity = () => ({ uid: window.FirebaseSession?.user?.uid, businessId: DB.getBusinessId(), generation: DB.getWorkspaceGeneration(), access: window.TeamAccess?.operationalReadScopeKey?.() || '' });
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const allowed = () => Boolean(window.TeamAccess?.has?.('sales.create') && window.TeamAccess?.has?.('sales.cancel'));
  const scopeKey = (origin, saleId) => `veconi:exchange:${origin.uid}:${origin.businessId}:${origin.generation}:${saleId}`;
  const paymentLabel = method => ({ dinheiro: 'Dinheiro', pix: 'Pix recebido manualmente', cartao: 'Cartão em máquina externa' })[method] || 'Sem cobrança';
  const rejection = error => ['failed-precondition', 'invalid-argument', 'out-of-range'].includes(String(error?.code || '').replace(/^functions\//, ''));
  function assertCausalQueue(){const d=window.SyncFirebase?.getFirebaseDiagnostic?.();if(d&&(Number(d.pending)>0||Number(d.syncErrors)>0||d.queueStorageCorrupt))throw Error('Existem alterações locais anteriores aguardando sincronização. Resolva essas pendências antes de confirmar a troca. Nenhuma operação será reenviada por este fluxo.');}
  let disposeStorage = null;
  function catalogFor(db, sale, origin) {
    return (db.produtos || []).filter(p => p.ativo !== false && p.active !== false && !p.deletedAt && !p.deleted && (!p.businessId || p.businessId === origin.businessId)
      && !['service', 'recurring'].includes(p.productType) && p.controlarEstoque !== false
      && (window.SpaceEngine?.productAllowsSpace ? window.SpaceEngine.productAllowsSpace(p, sale.spaceId)
        : (p.spaceAccessMode || 'all_spaces') === 'all_spaces' || (p.allowedSpaceIds || []).includes(sale.spaceId)))
      .flatMap(p => p.productType === 'variable' ? (db.variacoesProdutos || []).filter(v => v.parentProductId === p.id && v.active !== false && !v.deletedAt && !v.deleted && (!v.businessId || v.businessId === origin.businessId))
        .map(v => ({ productId: p.id, variantId: v.id, name: p.nome, variantName: v.displayName || v.name || v.id }))
        : [{ productId: p.id, variantId: null, name: p.nome, variantName: '' }]);
  }
  function readAttempt(key) {
    const stored = JSON.parse(localStorage.getItem(key) || 'null');
    if (!stored) return null;
    const attempt = stored.request ? stored : { version: 1, createdAt: null, request: stored };
    if (!attempt.request || typeof attempt.request.operationId !== 'string' || !attempt.request.operationId || !Array.isArray(attempt.request.returns) || !Array.isArray(attempt.request.replacements)) throw Error('A tentativa preservada precisa ser conferida antes de continuar.');
    return attempt;
  }
  const itemList = (items = [], returns = false) => `<ul class="exchange-items">${items.map(i => `<li><div><b>${esc(i.quantity)}× ${esc(i.name)}</b>${i.variantName ? `<small>${esc(i.variantName)}</small>` : ''}${returns ? `<small class="${i.restock ? 'exchange-restock' : 'exchange-damaged'}">${i.restock ? 'Volta ao estoque disponível' : 'Avaria / não volta ao estoque'}</small>` : ''}</div><strong>${money(i.totalCents ?? i.unitCents * i.quantity)}</strong></li>`).join('')}</ul>`;
  async function open(sale) {
    if (!sale || !allowed()) return;
    const origin = identity(), modal = document.querySelector('#modal'), token = crypto.randomUUID(), db = DB.carregar();
    if (!origin.uid || !origin.businessId || !modal) return;
    disposeStorage?.();
    const key = scopeKey(origin, sale.id), catalog = catalogFor(db, sale, origin);
    let busy = false, quote = null, pending = null, knownUncommitted = false;
    try { pending = readAttempt(key); } catch { throw Error('Não foi possível ler a tentativa preservada. Reabra a venda antes de continuar.'); }
    const current = () => same(origin, identity()) && allowed() && modal.dataset.exchangeToken === token;
    const call = async (name, data) => {
      if (!current()) throw Error('A sessão mudou. Reabra a venda na conta de origem.');
      if (!navigator.onLine) throw Error('Conecte-se para consultar ou confirmar a troca.');
      if(name==='confirmSaleExchange')assertCausalQueue();
      const r = await window.FirebaseCallable(name, { ...data, businessId: origin.businessId, workspaceGeneration: origin.generation, saleId: sale.id });
      if (!current()) throw Error('A sessão mudou. Consulte a troca na conta de origem.');
      return r.data ?? r;
    };
    const blocked = sale.status === 'fiado' || sale.formaPagamento === 'fiado';
    modal.dataset.exchangeToken = token;
    modal.innerHTML = `<div class="modal-bg"><section class="modal-box exchange-sheet" role="dialog" aria-modal="true" aria-labelledby="exchange-title"><header class="exchange-header"><div><span class="exchange-eyebrow">Histórico · venda #${esc(sale.id.slice(0, 8))}</span><h2 id="exchange-title">Trocar itens</h2><p>Receba, escolha e revise antes de confirmar.</p></div><button type="button" class="exchange-icon-button" data-ex-close aria-label="Fechar troca">×</button></header><div class="exchange-notice">A venda original permanece no histórico. A troca será registrada separadamente.</div><div data-ex-error role="alert" aria-live="assertive"></div>${blocked ? '<section class="exchange-caution"><h3>Troca de venda Fiado indisponível</h3><p>Nesta versão, trocas não alteram débitos de Fiado. Nenhum saldo será modificado.</p></section>' : `<form data-ex-form><div class="exchange-columns"><section><div class="exchange-section-title"><span class="exchange-step">1</span><div><h3>Você recebe</h3><p>Escolha os itens que o cliente está devolvendo.</p></div></div>${(sale.itens || []).map((i, n) => `<article class="exchange-return-row"><div class="exchange-product-info"><b>${esc(i.nome || i.produtoNome || i.produtoId)}</b><small>${esc(i.variantName || '')}</small><small data-return-remaining="${n}">${esc(i.quantidade)} un. comprada(s) · ${money(Math.round(Number(i.precoFinalUnitario ?? i.precoUnitario ?? i.preco ?? 0) * 100))} / un.</small></div><label>Devolver<input type="number" min="0" max="${esc(i.quantidade)}" step="1" value="0" inputmode="numeric" data-return="${n}"></label><label class="exchange-check"><input type="checkbox" data-restock="${n}"><span>Apto para revenda<small>Desmarcado: registrar avaria, sem repor estoque.</small></span></label></article>`).join('')}</section><section><div class="exchange-section-title"><span class="exchange-step">2</span><div><h3>Cliente leva</h3><p>Preços e disponibilidade serão conferidos online.</p></div></div><div data-ex-new></div><button type="button" class="exchange-button-secondary" data-ex-add>+ Adicionar produto</button>${!catalog.length ? '<p class="exchange-caution">Nenhum produto elegível disponível neste espaço.</p>' : ''}</section></div><section><div class="exchange-section-title"><span class="exchange-step">3</span><div><h3>Motivo e diferença</h3><p>Registre o motivo e a forma de receber um eventual complemento.</p></div></div><div class="exchange-fields"><label>Motivo da troca<select name="reasonType" required><option value="">Selecione o motivo</option><option>Tamanho ou variação</option><option>Preferência do cliente</option><option>Defeito ou avaria</option><option>Produto diferente do solicitado</option><option>Outro motivo</option></select></label><label>Complemento, se houver<select name="paymentMethod"><option value="dinheiro">Dinheiro</option><option value="pix">Pix recebido manualmente</option><option value="cartao">Cartão em máquina externa</option></select></label></div><label>Detalhes do motivo <span class="exchange-optional">(opcional)</span><textarea name="reasonDetail" maxlength="400" rows="2" placeholder="Acrescente detalhes úteis para o histórico"></textarea></label><p class="exchange-help">Valor menor gera crédito de troca para o cliente da venda, válido apenas nesta empresa e espaço. O crédito fica separado do Fiado. Não há reembolso automático.</p></section><div data-ex-review aria-live="polite"></div><footer><span data-ex-footer-note>Confira os valores antes de confirmar.</span><button type="submit" data-ex-quote>Revisar troca <span aria-hidden="true">→</span></button><button type="button" data-ex-confirm hidden>Confirmar troca</button></footer></form>`}<section class="exchange-history" data-ex-history><h3>Trocas vinculadas</h3><p>Consultando histórico…</p></section></section></div>`;
    window.Modais?.layout?.(modal.querySelector('[role="dialog"]'));
    const form = modal.querySelector('[data-ex-form]'), error = modal.querySelector('[data-ex-error]'), review = modal.querySelector('[data-ex-review]'), confirm = modal.querySelector('[data-ex-confirm]');
    const showError = e => { if (current()) error.textContent = e.message || 'Não foi possível concluir. Sua tentativa permanece preservada.'; };
    const note = message => { if (current() && form?.querySelector('[data-ex-footer-note]')) form.querySelector('[data-ex-footer-note]').textContent = message; };
    function lock(value) {
      busy = value;
      if (!current() || !form) return;
      form.querySelectorAll('button,input,select,textarea').forEach(e => { e.disabled = value || Boolean(pending) || e.dataset?.returnZero === 'true'; });
      if (confirm) confirm.disabled = value;
      form.querySelectorAll('[data-ex-consult],[data-ex-retry],[data-ex-revise]').forEach(e => { e.disabled = value; });
      form.setAttribute('aria-busy', String(value));
    }
    function invalidate() {
      if (pending || !form) return;
      form.classList?.remove('exchange-reviewing');
      quote = null; confirm.hidden = true; review.innerHTML = ''; form.querySelector('[data-ex-quote]').hidden = false;
      note('Confira os valores antes de confirmar.');
    }
    function add() {
      if (busy || pending || !catalog.length || !current()) return;
      invalidate();
      const row = document.createElement('article'); row.className = 'exchange-new-row';
      row.innerHTML = `<label>Produto / variação<select data-product>${catalog.map((p, n) => `<option value="${n}">${esc(p.name)}${p.variantName ? ` · ${esc(p.variantName)}` : ''}</option>`).join('')}</select></label><label>Quantidade<input data-quantity type="number" min="1" max="999" step="1" value="1" inputmode="numeric"></label><button type="button" class="exchange-remove" data-remove aria-label="Remover produto">Remover</button>`;
      row.querySelector('[data-remove]').onclick = () => { if (!busy && !pending && current()) { row.remove(); invalidate(); } };
      form.querySelector('[data-ex-new]').append(row);
    }
    function showQuote(q) {
      form.classList?.add('exchange-reviewing');
      const positive = q.differenceCents > 0, negative = q.differenceCents < 0;
      review.innerHTML = `<section class="exchange-review"><div class="exchange-section-title"><span class="exchange-step">4</span><div><h3>Revise a troca</h3><p>${esc(quote.data.reason)}</p></div></div><div class="exchange-review-columns"><div><h4>Você recebe</h4>${itemList(q.returns, true)}<p class="exchange-subtotal">Total devolvido <b>${money(q.returnCents)}</b></p></div><div><h4>Cliente leva</h4>${itemList(q.replacements)}<p class="exchange-subtotal">Novos itens <b>${money(q.newCents)}</b></p></div></div><div class="exchange-difference"><span>${positive ? 'Diferença a cobrar' : negative ? 'Crédito de troca para o cliente' : 'Sem diferença'}</span><strong>${money(Math.abs(q.differenceCents))}</strong></div>${positive ? `<p>Recebimento: <b>${esc(paymentLabel(q.paymentMethod || quote.data.paymentMethod))}</b>. Apenas o complemento será registrado como novo recebimento.</p><label class="exchange-check exchange-ack"><input type="checkbox" data-ex-received><span>Confirmei o recebimento de ${money(q.differenceCents)}.</span></label>` : negative ? '<p>O cliente poderá usar este crédito em vendas futuras deste espaço, por inteiro ou parcialmente. Não será criado débito de Fiado nem dinheiro em caixa.</p>' : '<p>Não haverá cobrança adicional nem emissão de crédito.</p>'}<p class="exchange-help">Após confirmar, esta troca não poderá ser cancelada nesta versão.</p></section>`;
      confirm.hidden = false; confirm.textContent = 'Confirmar troca'; form.querySelector('[data-ex-quote]').hidden = true;
      note(positive ? 'Confirme o pagamento antes de concluir.' : 'A confirmação registra estoque e valores uma única vez.');
      review.insertAdjacentHTML?.('beforeend','<button type="button" class="exchange-button-secondary" data-ex-edit>Editar seleção</button>');
      const edit=review.querySelector('[data-ex-edit]');if(edit)edit.onclick=()=>{if(!busy&&!pending)invalidate();};
    }
    function pendingView(message) {
      if (!current() || !form) return;
      quote = null; confirm.hidden = true; form.querySelector('[data-ex-quote]').hidden = true;
      review.innerHTML = `<section class="exchange-caution"><h3>Confirmação preservada</h3><p>${esc(message || 'Uma confirmação anterior ainda precisa ser conferida. Consulte o resultado antes de continuar.')}</p><small>Identificador: ${esc(pending.request.operationId)}</small><div class="exchange-pending-actions"><button type="button" data-ex-consult>Consultar resultado</button><button type="button" class="exchange-button-secondary" data-ex-retry>Repetir a mesma confirmação</button>${knownUncommitted ? '<button type="button" class="exchange-button-secondary" data-ex-revise>Revisar valores novamente</button>' : ''}</div></section>`;
      review.querySelector('[data-ex-consult]').onclick = () => consult();
      review.querySelector('[data-ex-retry]').onclick = () => submitPending();
      const revise = review.querySelector('[data-ex-revise]');
      if (revise) revise.onclick = async () => {
        if (busy || !current()) return;
        lock(true);
        try {
          const status = await call('lookupSaleExchange', { operationId: pending.request.operationId });
          if (status.found) return await completed(status.item);
          if (!status.retryAllowed || !knownUncommitted) throw Error('O resultado ainda não foi confirmado. Mantenha esta tentativa preservada.');
          const previous = JSON.parse(localStorage.getItem(`${key}:attempts`) || '[]');
          if (!Array.isArray(previous)) throw Error('O histórico local da tentativa não pôde ser lido.');
          localStorage.setItem(`${key}:attempts`, JSON.stringify([...previous, { ...pending, outcome: 'rejected_without_commit', reviewedAt: new Date().toISOString() }]));
          localStorage.removeItem(key); pending = null; knownUncommitted = false; error.textContent = ''; invalidate();
          note('Valores liberados para nova revisão. A tentativa anterior foi preservada.');
        } catch (e) { showError(e); } finally { if (current()) lock(false); }
      };
      note('Não crie outra troca enquanto esta confirmação estiver pendente.'); lock(busy);
    }
    async function completed(result) {
      if (!current()) return;
      const id = result.id || result.operationId;
      if (!pending || id !== pending.request.operationId) throw Error('Resposta não corresponde à tentativa preservada. Consulte novamente.');
      localStorage.removeItem(key); pending = null;
      form.classList?.remove('exchange-reviewing');
      window.dispatchEvent(new CustomEvent('sale-exchange-completed', { detail: { businessId: origin.businessId, spaceId: sale.spaceId, saleId: sale.id, operationId: id } }));
      form.innerHTML = `<section class="exchange-success"><div class="exchange-success-icon" aria-hidden="true">✓</div><h3>Troca confirmada</h3><p>Registro #${esc(id.slice(0, 8))}. A venda original foi preservada.</p><p>Estoque e eventual crédito foram registrados juntos. O recebimento complementar segue a automação financeira do espaço.</p><p class="exchange-help">O histórico e os produtos serão atualizados pelo Sync.</p></section>`;
      await history();
    }
    async function consult() {
      if (busy || !pending || !current()) return;
      lock(true); error.textContent = '';
      try {
        const status = await call('lookupSaleExchange', { operationId: pending.request.operationId });
        if (status.found) await completed(status.item);
        else pendingView('Nenhuma troca foi encontrada com este identificador. Você pode repetir a mesma confirmação para obter uma resposta segura.');
      } catch (e) { showError(e); } finally { if (current()) lock(false); }
    }
    async function withTabLock(action) {
      assertCausalQueue();
      if (!navigator.locks?.request) throw Error('Abra em um navegador atualizado para confirmar a troca com proteção entre abas.');
      return navigator.locks.request(key,{ifAvailable:true},held=>{if(!held)throw Error('Outra aba está confirmando esta troca. Consulte o resultado antes de continuar.');return action();});
    }
    async function submitPending() {
      try { await withTabLock(sendPending); } catch(e) { showError(e); }
    }
    async function sendPending() {
      if (busy || !pending || !current()) return;
      lock(true); error.textContent = '';
      try { await completed(await call('confirmSaleExchange', pending.request)); }
      catch (e) {
        if (!current()) return;
        showError(e);
        try {
          const status = await call('lookupSaleExchange', { operationId: pending.request.operationId });
          if (status.found) { await completed(status.item); return; }
          knownUncommitted = rejection(e) && status.retryAllowed === true;
        } catch { knownUncommitted = false; }
        if (pending) pendingView(knownUncommitted ? 'Os dados mudaram e esta tentativa não foi gravada. Revise os valores atuais antes de uma nova confirmação.' : 'A resposta não foi confirmada. Sua tentativa foi preservada; consultar ou repetir usará o mesmo identificador.');
      } finally { if (current()) lock(false); }
    }
    async function history() {
      try {
        const r = await call('listSaleExchanges', {});
        modal.querySelector('[data-ex-history]').innerHTML = `<h3>Trocas vinculadas</h3>${r.items?.length ? r.items.map((x, index) => `<article class="exchange-history-card"><div class="exchange-history-heading"><b>↳ Troca #${index + 1}</b><span>Confirmada</span></div><small>#${esc(x.id.slice(0, 8))} · ${esc(new Date(x.createdAt).toLocaleString('pt-BR'))}</small><p>${esc(x.reason)}</p><h4>Você recebeu</h4>${itemList(x.returns, true)}<h4>Cliente levou</h4>${itemList(x.replacements)}<p class="exchange-history-value">${x.differenceCents > 0 ? `Complemento recebido: ${money(x.receivedCents ?? x.differenceCents)} · ${esc(paymentLabel(x.paymentMethod))}` : x.differenceCents < 0 ? `Crédito de troca emitido: ${money(x.creditCents ?? -x.differenceCents)}` : 'Sem cobrança adicional nem crédito.'}</p><small>Operador: ${esc(x.actorNameSnapshot || x.actorUid)}</small></article>`).join('') : '<p>Nenhuma troca registrada para esta venda.</p>'}`;
        if (form && !pending && Array.isArray(r.remainingQuantities)) r.remainingQuantities.forEach((quantity, index) => {
          const input = form.querySelector(`[data-return="${index}"]`), label = form.querySelector(`[data-return-remaining="${index}"]`);
          if (input && Number.isSafeInteger(quantity) && quantity >= 0) { input.max = String(quantity); input.dataset.returnZero = String(quantity === 0); input.disabled = quantity === 0; if (label) label.textContent = `${quantity} un. disponível(is) para troca`; }
        });
      } catch (e) { showError(e); }
    }
    modal.querySelector('[data-ex-close]').onclick = () => { if (!busy && current()) { modal.innerHTML = ''; delete modal.dataset.exchangeToken; window.removeEventListener('storage', onStorage); } };
    function onStorage(event) {
      if (!current() || busy || event.key !== key || !event.newValue) return;
      try { pending = readAttempt(key); if (pending) pendingView('Outra aba preservou uma confirmação desta venda. Consulte o resultado antes de continuar.'); } catch (e) { showError(e); }
    }
    window.addEventListener('storage', onStorage);
    disposeStorage = () => window.removeEventListener('storage', onStorage);
    if (form) {
      form.querySelector('[data-ex-add]').onclick = add; add();
      form.oninput = e => { if (!e.target.matches('[data-ex-received]')) invalidate(); };
      form.onchange = e => { if (!e.target.matches('[data-ex-received]')) invalidate(); };
      form.onsubmit = async e => {
        e.preventDefault(); if (busy || pending || !current()) return;
        if (!form.reportValidity()) return;
        error.textContent = ''; lock(true);
        try {
          const data = { reason: [form.elements.reasonType.value, form.elements.reasonDetail.value.trim()].filter(Boolean).join(' — '), paymentMethod: form.elements.paymentMethod.value,
            returns: Array.from(form.querySelectorAll('[data-return]')).filter(x => Number(x.value) > 0).map(x => ({ line: Number(x.dataset.return), quantity: Number(x.value), restock: form.querySelector(`[data-restock="${x.dataset.return}"]`).checked })),
            replacements: Array.from(form.querySelectorAll('[data-ex-new] article')).map(x => { const p = catalog[Number(x.querySelector('[data-product]').value)]; return { productId: p?.productId, variantId: p?.variantId, quantity: Number(x.querySelector('[data-quantity]').value) }; }) };
          quote = { data, result: await call('quoteSaleExchange', data) }; showQuote(quote.result);
        } catch (e) { showError(e); } finally { if (current()) lock(false); }
      };
      confirm.onclick = async () => {
        if (busy || !current() || !quote || pending) return;
        if (quote.result.differenceCents > 0 && !form.querySelector('[data-ex-received]')?.checked) { showError(Error('Confirme o recebimento da diferença antes de concluir.')); return; }
        try { await withTabLock(async()=>{
          const other = readAttempt(key);
          if (other) { pending = other; pendingView('Uma confirmação já foi preservada para esta venda. Consulte o resultado.'); return; }
          pending = { version: 2, createdAt: new Date().toISOString(), request: { ...quote.data, fingerprint: quote.result.fingerprint, operationId: crypto.randomUUID() } };
          localStorage.setItem(key, JSON.stringify(pending));
          if (!same(readAttempt(key), pending)) throw Error('Não foi possível preservar a confirmação neste aparelho.');
        await sendPending();
        }); } catch (e) { showError(e); }
      };
      if (pending) pendingView();
    }
    await history();
  }
  function attach(root, sale) {
    if (!sale || !allowed() || root.querySelector('[data-sale-exchange]')) return;
    const button = document.createElement('button'); button.className = 'btn btn-primary'; button.dataset.saleExchange = sale.id; button.textContent = 'Trocar itens / ver trocas'; button.onclick = () => open(sale);
    root.querySelector('.activity-detail-actions')?.append(button);
  }
  return { open, attach };
})();
