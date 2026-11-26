// Etapa 4 — "Conta por Espaço": o proprietário migra um cliente do regime simples para a conta
// por Espaço (sem mudar nada financeiro) ou, quando o histórico não permite, abre a conta com
// o saldo de cada Espaço confirmado por ele. Tudo é decidido e gravado pelo servidor
// (manageCustomerAccounts); o aparelho só mostra a prévia e envia a confirmação.
window.CustomerAccountSetup = (() => {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const money = c => (c / 100).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
  const DEFINITIVE = /(?:^|\/)(aborted|invalid-argument|failed-precondition|permission-denied|already-exists)$/;
  const REASONS = {
    installments: 'O cliente tem parcelamento que precisa de conferência.',
    sale_history_mismatch: 'O restante de alguma venda mudaria com a migração.',
    cross_space_allocation: 'Um recebimento antigo foi alocado a venda de outro Espaço.',
    payments_exceed: 'Os recebimentos antigos passam das vendas comprovadas.',
    history_unproven: 'O histórico não comprova o saldo por Espaço.',
    history_review: 'O histórico precisa de revisão.',
    history_unreadable: 'O histórico excede o limite seguro de leitura.',
    origin_unknown: 'Há dívida sem Espaço.',
    balance_mismatch: 'O saldo cadastral não confere com o histórico.',
    credit: 'O cliente tem crédito.',
    pending: 'Há recebimento ou venda pendente. Confira a operação original antes de continuar.',
    archived: 'O cliente está arquivado.',
  };
  const context = () => ({businessId: window.DB?.getBusinessId?.(), workspaceGeneration: window.DB?.getWorkspaceGeneration?.() ?? 0});
  const owner = () => window.BusinessContext?.get?.()?.role === 'owner';
  const available = () => owner() && typeof window.FirebaseCallable === 'function' && window.TeamAccess?.has?.('customers.adjustBalance') === true;
  const perSpace = c => Boolean(c?.fiadoOpeningBalance?.version === 1 || c?.fiadoHistoryActivation?.spaceRegularization?.version === 1);
  // Offered only where it can change something: an active customer outside the per-Space account.
  const needed = client => available() && Boolean(client) && client.ativo !== false && client.active !== false && !client.deletedAt && !perSpace(client);
  const spaceName = id => (window.SpaceContext?.homeSpaces?.() || []).find(s => s.id === id)?.name || 'Espaço';
  const storeKey = (businessId, clientId) => 'veconi:account-setup:' + JSON.stringify([businessId, clientId]);
  const remember = (key, value) => { try { value ? localStorage.setItem(key, JSON.stringify(value)) : localStorage.removeItem(key); } catch { /* optional */ } };
  const recall = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  async function call(kind, data) {
    if (navigator.onLine === false) throw Error('Sem conexão. Esta operação precisa da confirmação do servidor.');
    const reply = await window.FirebaseCallable('manageCustomerAccounts', {...context(), ...data, kind});
    return reply?.data ?? reply;
  }

  function open(clientId) {
    if (!available()) { window.Utils?.toast?.('Somente o proprietário pode configurar a conta por Espaço.', true); return null; }
    const client = window.Clientes?.obter?.(clientId) || window.Clientes?.viewClient?.(clientId);
    let host = document.getElementById('modal');
    if (!host) { host = document.createElement('div'); host.id = 'modal'; document.body.append(host); }
    host.innerHTML = `<div class="modal-bg"><section class="modal-box account-setup" role="dialog" aria-modal="true" aria-labelledby="account-setup-title" style="width:min(520px,calc(100vw - 24px));max-height:90dvh;display:flex;flex-direction:column">
      <header class="modal-head"><h3 id="account-setup-title">Conta por Espaço</h3><button class="icon-btn" type="button" data-setup-close aria-label="Fechar">×</button></header>
      <form class="modal-body" data-setup-form style="overflow:auto">
        <p><b>${esc(client?.nome || 'Cliente')}</b></p>
        <div data-setup-body></div>
        <p role="status" data-setup-status aria-live="polite">Consultando o servidor…</p>
        <div class="modal-actions" style="display:flex;gap:8px;flex-wrap:wrap" data-setup-actions></div>
      </form></section></div>`;
    const form = host.querySelector('[data-setup-form]'), body = host.querySelector('[data-setup-body]'), actions = host.querySelector('[data-setup-actions]');
    const status = host.querySelector('[data-setup-status]'), say = text => { status.textContent = text; };
    const {businessId} = context(), key = storeKey(businessId, clientId);
    let busy = false, review = null;
    const button = (label, attr, primary) => `<button class="btn ${primary ? 'btn-primary' : 'btn-light'}" type="button" ${attr}>${esc(label)}</button>`;
    host.querySelector('[data-setup-close]').onclick = () => { if (!busy) host.innerHTML = ''; };
    form.addEventListener('submit', event => event.preventDefault());
    async function done(message) {
      remember(key, null); say(message); actions.innerHTML = button('Fechar', 'data-setup-done', true);
      actions.querySelector('[data-setup-done]').onclick = () => { host.innerHTML = ''; };
      try { await window.SyncFirebase?.readCanonicalClient?.(clientId, {force: true}); } catch { /* the next sync brings it */ }
      window.dispatchEvent?.(new CustomEvent('financial-state-updated', {detail: {clientId}}));
    }
    // Sends a confirmation kept on this device; a lost answer is resent equal, never duplicated.
    async function send(saved) {
      busy = true; say('Enviando ao servidor…');
      try {
        const r = await call(saved.kind, saved.data);
        await done(saved.kind === 'customer_account_migration' ? 'Cliente migrado. Saldo, vendas e recebimentos ficaram iguais.'
          : `Conta aberta por Espaço com ${money(r.confirmedCents ?? 0)}.`);
        return r;
      } catch (error) {
        const definitive = DEFINITIVE.test(error?.code || '');
        if (definitive) remember(key, null);
        else { actions.innerHTML = button('Tentar de novo', 'data-setup-retry', true); actions.querySelector('[data-setup-retry]').onclick = () => send(saved); }
        say((error.message || 'Não foi possível confirmar.') + (definitive ? '' : ' O pedido ficou guardado e será reenviado igual, sem duplicar.'));
        return null;
      } finally { busy = false; }
    }
    function showMigration(q) {
      body.innerHTML = `<p>O saldo e o histórico de vendas ficam iguais. Daí em diante, os recebimentos usam a conta por Espaço.</p>
        <ul data-setup-spaces>${Object.entries(q.spaces || {}).map(([id, c]) => `<li>${esc(spaceName(id))}: ${esc(money(c))}</li>`).join('')}</ul>`;
      say(`Saldo atual: ${money(q.bookCents)}.`);
      actions.innerHTML = button('Migrar para a conta por Espaço', 'data-setup-migrate', true);
      actions.querySelector('[data-setup-migrate]').onclick = () => {
        if (busy) return;
        const saved = {kind: 'customer_account_migration', data: {clientId, operationId: crypto.randomUUID(), quoteHash: q.quoteHash, confirmed: true}};
        remember(key, saved); send(saved);
      };
    }
    async function showOpening() {
      busy = true; say('Consultando o servidor…'); actions.innerHTML = '';
      try {
        const p = await call('customer_account_opening_preview', {clientId});
        body.innerHTML = `<p>Confirme quanto o cliente deve em cada Espaço. A conta passa a seguir só os lançamentos novos; o histórico anterior fica guardado como evidência.</p>
          ${p.parts.map(part => `<label class="field">${esc(spaceName(part.spaceId))} (R$)<input name="space:${esc(part.spaceId)}" data-space="${esc(part.spaceId)}" type="number" inputmode="decimal" min="0" step="0.01" value="${(part.totalCents / 100).toFixed(2)}"></label>`).join('')}
          <label class="field">Motivo<textarea name="reason" maxlength="300" rows="3" placeholder="Obrigatório quando o total muda em relação ao cadastro"></textarea></label>
          <label style="display:flex;gap:8px;align-items:center"><input type="checkbox" name="queueChecked"> Conferi que os aparelhos não têm operações pendentes deste cliente</label>`;
        say(`Saldo cadastral: ${money(p.bookCents)}. Revise os valores e veja o resumo antes de confirmar.`);
        actions.innerHTML = button('Ver resumo', 'data-setup-review') + button('Confirmar abertura', 'data-setup-open disabled', true);
        const openButton = actions.querySelector('[data-setup-open]');
        const balances = () => [...body.querySelectorAll('[data-space]')].map(input => {
          const value = Number(input.value), cents = Math.round(value * 100);
          if (input.value === '' || !Number.isFinite(value) || value < 0 || Math.abs(value * 100 - cents) > 0.000001) throw Error('Informe um valor válido em reais para cada Espaço.');
          return {spaceId: input.dataset.space, totalCents: cents};
        });
        body.addEventListener('input', () => { review = null; openButton.disabled = true; });
        actions.querySelector('[data-setup-review]').onclick = async () => {
          if (busy) return;
          try {
            busy = true; say('Consultando o servidor…');
            const data = {clientId, balances: balances(), reason: form.elements.reason.value.trim()};
            const r = await call('customer_account_opening_preview', data);
            review = {data, reviewHash: r.reviewHash};
            say(`Saldo cadastral: ${money(r.bookCents)}. Saldo confirmado: ${money(r.confirmedCents)}. Diferença: ${money(r.deltaCents)}.`);
            openButton.disabled = false;
          } catch (error) { review = null; openButton.disabled = true; say(error.message || 'Não foi possível consultar o servidor.'); }
          finally { busy = false; }
        };
        openButton.onclick = () => {
          if (busy || !review) return;
          if (!form.elements.queueChecked.checked) { say('Confira as operações pendentes dos aparelhos antes de confirmar.'); return; }
          const saved = {kind: 'customer_account_opening', data: {...review.data, operationId: crypto.randomUUID(), reviewHash: review.reviewHash, confirmed: true, queueChecked: true}};
          remember(key, saved); send(saved);
        };
      } catch (error) { say(error.message || 'Não foi possível consultar o servidor.'); }
      finally { busy = false; }
    }
    (async () => {
      const pending = recall(key);
      if (pending?.data?.clientId === clientId) {
        say('Há uma confirmação deste cliente sem resposta do servidor.');
        actions.innerHTML = button('Reenviar a confirmação guardada', 'data-setup-retry', true);
        actions.querySelector('[data-setup-retry]').onclick = () => send(pending);
        return;
      }
      try {
        busy = true;
        const q = await call('customer_account_migration_preview', {clientId});
        busy = false;
        if (q.status === 'eligible') return showMigration(q);
        if (q.status === 'already_space') { say('Este cliente já usa a conta por Espaço.'); return; }
        if (q.status === 'nothing_to_migrate') { say('Este cliente ainda não tem movimento. A primeira venda Fiado abre a conta por Espaço.'); return; }
        body.innerHTML = `<p>${esc(REASONS[q.reason] || REASONS.history_review)} A migração não pode manter o histórico igual.</p>`;
        say('Você pode abrir a conta confirmando o saldo de cada Espaço.');
        actions.innerHTML = button('Abrir saldo por Espaço', 'data-setup-opening', true);
        actions.querySelector('[data-setup-opening]').onclick = () => { if (!busy) showOpening(); };
      } catch (error) { busy = false; say(error.message || 'Não foi possível consultar o servidor.'); }
    })();
    return {host, send};
  }
  return {available, needed, open};
})();
