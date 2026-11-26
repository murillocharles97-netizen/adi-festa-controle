// Fase 3 — "Ajustar saldo" com o comando único do servidor (manageCustomerAccounts).
// Aumentar, reduzir, definir o total (zerar), estornar um ajuste e conceder crédito,
// sempre num Espaço escolhido, com prévia do servidor antes de confirmar. O valor nunca é
// calculado no aparelho: a prévia e a confirmação vêm do servidor.
// Fase 4: oferecido só quando o saldo por Espaço publicado pelo servidor está ativo neste
// aparelho. Antes disso, o app continua usando "Regularizar saldo".
window.CustomerBalanceAdjustment = (() => {
  'use strict';
  // Fase 4: on, but only offered while the server balances are live on this device
  // (CustomerSpaceAccounts.ready). Before the server side is published, nothing changes.
  let enabled = true;
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
  const money = c => (c / 100).toLocaleString('pt-BR', {style: 'currency', currency: 'BRL'});
  const MODES = [
    ['increase', 'Aumentar a dívida', 'Valor a acrescentar'],
    ['decrease', 'Reduzir a dívida', 'Valor a abater'],
    ['set', 'Definir o total devido', 'Total devido neste Espaço'],
    ['reverse', 'Estornar um ajuste', ''],
    ['credit', 'Conceder crédito', 'Valor do crédito'],
  ];
  const DEFINITIVE = /(?:^|\/)(aborted|invalid-argument|failed-precondition|permission-denied|already-exists)$/;
  const available = () => enabled && window.CustomerSpaceAccounts?.ready?.() === true && window.TeamAccess?.has?.('customers.adjustBalance') === true &&
    typeof window.FirebaseCallable === 'function' && typeof window.SpaceContext?.homeSpaces === 'function';
  const context = () => ({businessId: window.DB?.getBusinessId?.(), workspaceGeneration: window.DB?.getWorkspaceGeneration?.() ?? 0});
  const storeKey = (businessId, clientId) => 'veconi:balance-adjustment:' + JSON.stringify([businessId, clientId]);
  const remember = (key, value) => { try { value ? localStorage.setItem(key, JSON.stringify(value)) : localStorage.removeItem(key); } catch { /* optional */ } };
  const recall = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
  function spacesFor(client) {
    const all = window.SpaceContext.homeSpaces() || [], active = window.SpaceContext.activeId?.();
    if (window.Clientes?.scopedScreen?.() && active) return all.filter(s => s.id === active);
    const linked = new Set(client?.customerSpaceIds?.length ? client.customerSpaceIds : [client?.spaceId].filter(Boolean));
    const own = all.filter(s => linked.has(s.id));
    return own.length ? own : all;
  }
  async function call(kind, data) {
    if (navigator.onLine === false) throw Error('Sem conexão. O ajuste precisa da confirmação do servidor.');
    const reply = await window.FirebaseCallable('manageCustomerAccounts', {...context(), ...data, kind});
    return reply?.data ?? reply;
  }
  function open(clientId) {
    if (!available()) { window.Utils?.toast?.('Seu perfil não pode ajustar saldos. Peça ao responsável.', true); return null; }
    const client = window.Clientes?.obter?.(clientId) || window.Clientes?.viewClient?.(clientId), spaces = spacesFor(client);
    let host = document.getElementById('modal');
    if (!host) { host = document.createElement('div'); host.id = 'modal'; document.body.append(host); }
    host.innerHTML = `<div class="modal-bg"><section class="modal-box balance-adjustment" role="dialog" aria-modal="true" aria-labelledby="balance-adjustment-title" style="width:min(520px,calc(100vw - 24px));max-height:90dvh;display:flex;flex-direction:column">
      <header class="modal-head"><h3 id="balance-adjustment-title">Ajustar saldo</h3><button class="icon-btn" type="button" data-adj-close aria-label="Fechar">×</button></header>
      <form class="modal-body" data-adj-form style="overflow:auto">
        <p><b>${esc(client?.nome || 'Cliente')}</b></p>
        <label class="field">Espaço<select name="spaceId">${spaces.map(s => `<option value="${esc(s.id)}">${esc(s.name || s.nome || s.id)}</option>`).join('')}</select></label>
        <fieldset class="field"><legend>O que fazer</legend>${MODES.map(([id, label], i) => `<label style="display:flex;gap:8px;align-items:center"><input type="radio" name="mode" value="${id}" ${i ? '' : 'checked'}> ${label}</label>`).join('')}</fieldset>
        <label class="field" data-adj-amount><span data-adj-amount-label>${MODES[0][2]}</span> (R$)<input name="amount" type="number" inputmode="decimal" min="0" step="0.01"></label>
        <label class="field" data-adj-original hidden>Ajuste a estornar<select name="reversesOperationId"><option value="">Carregando…</option></select></label>
        <label class="field">Motivo<textarea name="reason" minlength="10" maxlength="500" rows="3" required placeholder="Explique o que está sendo corrigido"></textarea></label>
        <p role="status" data-adj-status aria-live="polite">Escolha o Espaço e o tipo, informe o valor e veja o resultado antes de confirmar.</p>
        <p class="muted">Não registra venda, recebimento, caixa ou estoque. O ajuste fica no histórico do cliente com o motivo e quem fez.</p>
        <div class="modal-actions" style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn-light" type="button" data-adj-preview>Ver resultado</button>
          <button class="btn btn-primary" type="submit" data-adj-confirm disabled>Confirmar ajuste</button>
          <button class="btn btn-light" type="button" data-adj-retry hidden>Tentar de novo</button>
        </div>
      </form></section></div>`;
    const form = host.querySelector('[data-adj-form]'), status = host.querySelector('[data-adj-status]'), confirm = host.querySelector('[data-adj-confirm]');
    const retry = host.querySelector('[data-adj-retry]'), say = text => { status.textContent = text; };
    const {businessId} = context(), key = storeKey(businessId, clientId);
    let quote = null, busy = false;
    const mode = () => form.elements.mode.value;
    function request() {
      const m = mode(), value = Number(form.elements.amount.value), data = {clientId, spaceId: form.elements.spaceId.value, mode: m};
      if (m === 'reverse') { if (!form.elements.reversesOperationId.value) throw Error('Escolha o ajuste a estornar.'); data.reversesOperationId = form.elements.reversesOperationId.value; }
      else {
        const amount = Math.round(value * 100);
        if (form.elements.amount.value === '' || !Number.isFinite(value) || Math.abs(value * 100 - amount) > 0.000001 || amount < 0 || m !== 'set' && amount === 0) throw Error('Informe um valor válido em reais.');
        if (m === 'set') data.targetDebtCents = amount; else data.amountCents = amount;
      }
      return data;
    }
    async function loadHistory() {
      const select = form.elements.reversesOperationId;
      try {
        const r = await call('customer_balance_adjustment_history', {clientId, spaceId: form.elements.spaceId.value});
        const items = (r.items || []).filter(i => i.reversible);
        select.innerHTML = items.length ? items.map(i => `<option value="${esc(i.operationId)}">${esc((i.at || '').slice(0, 10))} · ${i.deltaDebtCents > 0 ? '+' : '−'}${esc(money(Math.abs(i.deltaDebtCents)))} · ${esc(i.reason)}</option>`).join('')
          : '<option value="">Nenhum ajuste a estornar neste Espaço</option>';
      } catch (error) { select.innerHTML = '<option value="">Não foi possível carregar os ajustes</option>'; say(error.message); }
    }
    function invalidate() {
      quote = null; confirm.disabled = true;
      const m = MODES.find(([id]) => id === mode());
      host.querySelector('[data-adj-amount]').hidden = m[0] === 'reverse';
      host.querySelector('[data-adj-original]').hidden = m[0] !== 'reverse';
      host.querySelector('[data-adj-amount-label]').textContent = m[2];
    }
    form.addEventListener('change', event => { if (event.target.name === 'mode' || event.target.name === 'spaceId') { invalidate(); if (mode() === 'reverse') loadHistory(); } });
    form.addEventListener('input', event => { if (event.target.name !== 'reason') invalidate(); });
    host.querySelector('[data-adj-close]').onclick = () => { if (!busy) host.innerHTML = ''; };
    host.querySelector('[data-adj-preview]').onclick = async () => {
      if (busy) return;
      try {
        busy = true; say('Consultando o servidor…');
        const data = request(), r = await call('customer_balance_adjustment_preview', data);
        quote = {data, quote: r};
        say(`Hoje neste Espaço: ${money(r.currentDebtCents)}. Depois do ajuste: ${r.newDebtCents < 0 ? 'crédito de ' + money(-r.newDebtCents) : money(r.newDebtCents)}.`);
        confirm.disabled = false;
      } catch (error) { quote = null; confirm.disabled = true; say(error.message || 'Não foi possível consultar o servidor.'); }
      finally { busy = false; }
    };
    async function send(saved) {
      busy = true; confirm.disabled = true; retry.hidden = true; say('Enviando o ajuste…');
      try {
        const r = await call('customer_balance_adjustment', saved);
        remember(key, null);
        say(`Ajuste confirmado. ${r.newDebtCents < 0 ? 'Crédito no Espaço: ' + money(-r.newDebtCents) : 'Dívida no Espaço: ' + money(r.newDebtCents)}. Nenhuma venda ou recebimento foi registrado.`);
        try { await window.SyncFirebase?.readCanonicalClient?.(clientId, {force: true}); } catch { /* the next sync brings it */ }
        window.dispatchEvent?.(new CustomEvent('financial-state-updated', {detail: {clientId}}));
        return r;
      } catch (error) {
        if (DEFINITIVE.test(error?.code || '')) remember(key, null);
        else { retry.hidden = false; retry.onclick = () => send(saved); }
        say((error.message || 'Não foi possível confirmar.') + (DEFINITIVE.test(error?.code || '') ? '' : ' O pedido ficou guardado e será reenviado igual, sem duplicar.'));
        return null;
      } finally { busy = false; }
    }
    form.addEventListener('submit', async event => {
      event.preventDefault();
      if (busy || !quote) return;
      const reason = form.elements.reason.value.trim();
      if (reason.length < 10) { say('Informe um motivo de pelo menos 10 caracteres.'); return; }
      const saved = {...quote.data, operationId: crypto.randomUUID(), quoteHash: quote.quote.quoteHash, expectedFinancialVersion: quote.quote.financialVersion, reason, confirmed: true};
      remember(key, saved);
      await send(saved);
    });
    const pending = recall(key);
    if (pending?.clientId === clientId) { say('Há um ajuste deste cliente sem confirmação do servidor.'); retry.hidden = false; retry.textContent = 'Reenviar o ajuste guardado'; retry.onclick = () => send(pending); }
    return {host, send};
  }
  return {available, open, spacesFor, disableForTests: () => { enabled = false; }};
})();
