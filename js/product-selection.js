(function () {
  'use strict';
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const selected = new Set();
  let enabled = false, scopeKey = '', layer = '', dialog = null, press = null, suppressClickUntil = 0, scheduled = false, releasing = false, afterRelease = null;
  const onPage = () => window.Router?.atual?.() === 'produtos';
  const allowed = () => window.TeamAccess?.has?.('products.edit') === true;
  const cards = () => $$('[data-product-card]', $('#app')).filter(n => !n.hidden);
  function currentKey() { try { return ProductActions.identity().key; } catch { return ''; } }
  function dismissSheets() {
    window.ProdutosMobile?.dismissSheets?.();
    $$('.desktop-product-more[open]').forEach(n => n.removeAttribute('open'));
  }
  function guardBack() {
    if (layer) return;
    layer = `product-ui-${crypto.randomUUID()}`;
    history.pushState({...history.state, productUi: layer}, '', location.href);
  }
  function releaseBack() {
    const own = layer; layer = '';
    if (own && history.state?.productUi === own) { releasing = true; history.back(); }
  }
  function closeDialog() {
    if (!dialog) return;
    const previous = dialog;
    dialog = null;
    previous.overlay.remove();
    document.body.style.overflow = previous.overflow;
    // Do not remove/override inert flags owned by authentication or plan gates.
    if (previous.focus?.isConnected) previous.focus.focus({preventScroll: true});
    else $('[data-product-select-toggle]')?.focus({preventScroll: true});
    if (!enabled) releaseBack();
  }
  function cancelSelection() {
    enabled = false; selected.clear();
    document.body.classList.remove('product-selection-active');
    if (!dialog) releaseBack();
    schedule();
  }
  function startSelection(id) {
    if (releasing) { const key = currentKey(); afterRelease = () => { if (key && currentKey() === key) startSelection(id); }; return; }
    if (!allowed() || !onPage() || !currentKey()) return;
    dismissSheets();
    scopeKey = currentKey(); enabled = true;
    if (id) selected.add(id);
    guardBack(); schedule();
  }
  function toggle(id) { selected.has(id) ? selected.delete(id) : selected.add(id); schedule(); }
  function refresh() {
    if (!onPage()) return;
    if (window.ProdutosMobile?.isMobile?.()) ProdutosMobile.refresh();
    else window.AppPageRuntime?.mount?.('produtos');
    schedule();
  }
  function update() {
    scheduled = false;
    const app = $('#app'); if (!app) return;
    const key = currentKey();
    if (!onPage() || !key || scopeKey && scopeKey !== key || dialog && dialog.key !== key) {
      afterRelease = null;
      closeDialog(); cancelPress(); enabled = false; selected.clear();
      scopeKey = key; releaseBack();
    }
    document.body.classList.toggle('product-selection-active', enabled);
    $('#product-batch-bar')?.remove();
    if (!onPage() || !key) {
      $('[data-product-selection-tools]')?.remove();
      $$('.product-selection-check', app).forEach(n => n.remove());
      $$('[data-selection-tabindex]', app).forEach(n => {
        const old = n.dataset.selectionTabindex; delete n.dataset.selectionTabindex;
        old === '' ? n.removeAttribute('tabindex') : n.setAttribute('tabindex', old);
      });
      $$('.product-is-selected', app).forEach(n => n.classList.remove('product-is-selected'));
      return;
    }
    scopeKey = key;
    const host = $('.mobile-product-sort-view', app) || $('.desktop-product-toolbar', app);
    if (host && !$('[data-product-selection-tools]', host)) {
      const tools = document.createElement('div');
      tools.dataset.productSelectionTools = '';
      tools.className = 'product-selection-tools';
      tools.innerHTML = '<button type="button" class="btn btn-light" data-product-select-toggle>Selecionar</button><button type="button" class="btn btn-light" data-product-select-all hidden>Selecionar exibidos</button><button type="button" class="btn btn-light" data-product-check-pending hidden></button>';
      host.append(tools);
      $('[data-product-select-toggle]', tools).onclick = () => enabled ? cancelSelection() : startSelection();
      $('[data-product-select-all]', tools).onclick = () => {
        const ids = cards().map(c => c.dataset.productCard), all = ids.every(id => selected.has(id));
        ids.forEach(id => all ? selected.delete(id) : selected.add(id)); schedule();
      };
      $('[data-product-check-pending]', tools).onclick = checkPending;
    }
    const select = $('[data-product-select-toggle]', app), all = $('[data-product-select-all]', app);
    if (select) { select.textContent = enabled ? 'Cancelar seleção' : 'Selecionar'; select.setAttribute('aria-pressed', String(enabled)); }
    if (all) { all.hidden = !enabled; all.textContent = cards().length && cards().every(c => selected.has(c.dataset.productCard)) ? 'Desmarcar exibidos' : 'Selecionar exibidos'; }
    let pending = [], pendingError = '';
    try { pending = ProductActions.pending(); } catch (error) { pendingError = error.message; }
    const pendingButton = $('[data-product-check-pending]', app);
    if (pendingButton) {
      pendingButton.hidden = !pending.length && !pendingError;
      pendingButton.textContent = pendingError ? 'Verificar ocorrências preservadas' : `Verificar confirmação (${pending.length})`;
    }
    cards().forEach(card => {
      const waiting = window.ProductActions?.isPending?.(card.dataset.productCard);
      let badge = $('.product-action-pending-badge', card);
      if (waiting && !badge) {
        badge = document.createElement('small'); badge.className = 'product-action-pending-badge'; badge.textContent = 'Aguardando confirmação';
        ($('.mobile-product-copy', card) || $('.desktop-product-card-title', card) || card).append(badge);
      }
      if (!waiting) badge?.remove();
      let check = $('[data-product-selection-check]', card);
      if (!check && enabled) {
        const label = document.createElement('label'); label.className = 'product-selection-check';
        check = document.createElement('input'); check.type = 'checkbox'; check.dataset.productSelectionCheck = '';
        check.setAttribute('aria-label', `Selecionar ${window.Produtos.obter(card.dataset.productCard)?.nome || 'produto'}`);
        label.append(check); card.prepend(label);
      }
      if (check) { check.closest('label').hidden = !enabled; check.checked = selected.has(card.dataset.productCard); }
      card.classList.toggle('product-is-selected', enabled && selected.has(card.dataset.productCard));
      // Do not replace the existing card role; checkbox conveys selection to AT.
      card.querySelectorAll('button,summary').forEach(button => {
        if (enabled && !button.hasAttribute('data-selection-tabindex')) {
          button.dataset.selectionTabindex = button.getAttribute('tabindex') ?? '';
          button.setAttribute('tabindex', '-1');
        } else if (!enabled && button.hasAttribute('data-selection-tabindex')) {
          const old = button.dataset.selectionTabindex; delete button.dataset.selectionTabindex;
          old === '' ? button.removeAttribute('tabindex') : button.setAttribute('tabindex', old);
        }
      });
    });
    if (enabled && selected.size) {
      const bar = document.createElement('aside'); bar.id = 'product-batch-bar'; bar.className = 'product-batch-bar';
      bar.setAttribute('aria-label', 'Ações dos produtos selecionados');
      bar.innerHTML = `<strong role="status">${selected.size} selecionado${selected.size === 1 ? '' : 's'}</strong><div><button type="button" class="btn btn-light" data-batch-archive>Arquivar</button><button type="button" class="btn btn-danger" data-batch-delete>Excluir selecionados</button><button type="button" class="btn btn-light" data-batch-cancel>Cancelar seleção</button></div>`;
      document.body.append(bar);
      $('[data-batch-delete]', bar).onclick = () => open([...selected], 'delete');
      $('[data-batch-archive]', bar).onclick = () => open([...selected], 'archive');
      $('[data-batch-cancel]', bar).onclick = cancelSelection;
    }
  }
  function schedule() { if (!scheduled) { scheduled = true; queueMicrotask(update); } }
  async function checkPending(event) {
    const button = event?.currentTarget;
    if (button) button.disabled = true;
    const key = currentKey();
    try {
      const results = await ProductActions.checkPending();
      if (key !== currentKey()) return;
      Utils.toast(results.every(r => r.status === 'confirmed') ? 'Alterações confirmadas na nuvem.' : 'Há alterações aguardando confirmação. Confira o Sync.', results.some(r => r.status !== 'confirmed'));
      refresh();
    } catch (error) { if (key === currentKey()) Utils.toast(error.message, true); }
    finally { if (button?.isConnected) button.disabled = false; }
  }
  async function open(ids, kind = 'delete') {
    if (releasing) { const key = currentKey(); afterRelease = () => { if (key && currentKey() === key) open(ids, kind); }; return; }
    if (dialog) return;
    if (!allowed() || !onPage() || !currentKey()) return Utils.toast('Seu perfil não pode alterar produtos.', true);
    const previousFocus = document.activeElement;
    closeDialog(); dismissSheets();
    ids = [...new Set(ids)];
    const products = ids.map(id => Produtos.obter(id));
    if (!ids.length || products.some(p => !p)) return Utils.toast('Atualize a listagem e selecione os produtos novamente.', true);
    guardBack();
    const overlay = document.createElement('div'); overlay.className = 'modal-bg product-action-confirmation';
    const verb = kind === 'archive' ? 'Arquivar' : 'Excluir';
    overlay.innerHTML = `<section class="modal-box product-confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="product-confirm-title" aria-describedby="product-confirm-help" tabindex="-1"><header class="modal-head"><h3 id="product-confirm-title">${verb} ${ids.length === 1 ? 'produto' : `${ids.length} produtos`}?</h3><button class="icon-btn" type="button" data-product-confirm-close aria-label="Fechar confirmação">×</button></header><div class="modal-body"><p id="product-confirm-help">${kind === 'archive' ? 'Os produtos ficarão inativos para novas vendas.' : 'Os produtos sairão da listagem de venda. A exclusão é lógica, sem apagar o histórico.'} Estoque, vendas, movimentações e imagens serão preservados.</p><ul class="product-confirm-list">${products.map(p => `<li><b>${esc(p.nome)}</b>${p.codigo ? `<small>Código: ${esc(p.codigo)}</small>` : ''}</li>`).join('')}</ul><p class="product-confirm-note">Aguarde a confirmação da nuvem. Se houver falha parcial, veja o resultado de cada item antes de continuar.</p><div class="product-action-results" role="status" aria-live="polite"></div></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-product-confirm-close>Cancelar</button><button type="button" class="btn ${kind === 'archive' ? 'btn-primary' : 'btn-danger'}" data-product-confirm-submit>${verb}</button></footer></section>`;
    dialog = {overlay, busy: false, key: currentKey(), focus: previousFocus?.isConnected && previousFocus !== document.body ? previousFocus : cards().find(c => c.dataset.productCard === ids[0]), overflow: document.body.style.overflow};
    $('#modal').replaceChildren(overlay);
    document.body.style.overflow = 'hidden';
    $$('[data-product-confirm-close]', overlay).forEach(button => button.onclick = () => { if (!dialog?.busy) closeDialog(); });
    $('[data-product-confirm-close]', overlay).focus();
    const instance = dialog;
    const submit = $('[data-product-confirm-submit]', overlay), resultBox = $('.product-action-results', overlay);
    submit.disabled = true; submit.textContent = 'Conferindo seleção…';
    overlay.setAttribute('aria-busy', 'true');
    let plan;
    const finished = () => {
      overlay.setAttribute('aria-busy', 'false');
      // Remove, rather than only hide, a terminal action: generic .btn display
      // styles can override the browser's default [hidden] rule on Android.
      submit.textContent = 'Concluído'; submit.disabled = true; submit.remove();
      const close = $$('[data-product-confirm-close]', overlay).at(-1);
      close.textContent = 'Fechar resultados'; close.disabled = false;
    };
    try {
      plan = await ProductActions.preflight(ids, kind);
      if (dialog !== instance || currentKey() !== instance.key) return;
      if (plan.key !== instance.key) throw Error('O acesso mudou durante a conferência. Reabra a seleção.');
      const labels = {ready:'Apto', regularization:'Regularizar espaço', forbidden:'Sem permissão', pending:'Confirmação anterior pendente', inactive:'Já inativo', unavailable:'Conferência indisponível'};
      $('.product-confirm-list', overlay).innerHTML = plan.items.map(p => `<li data-product-eligibility="${esc(p.status)}"><b>${esc(p.name)}</b><small>${esc(labels[p.status] || 'Bloqueado')}: ${esc(p.message)}</small></li>`).join('');
      $('.product-confirm-note', overlay).textContent = `${plan.eligibleIds.length} de ${ids.length} aptos. Somente os aptos serão alterados após sua confirmação. O vínculo de cada produto é conferido na nuvem; o filtro do Início não redefine o catálogo da empresa.`;
      overlay.setAttribute('aria-busy', 'false');
      if (!plan.eligibleIds.length) { finished(); resultBox.textContent = 'Nenhuma alteração iniciada. Resolva os itens indicados antes de tentar novamente.'; return; }
      submit.disabled = false; submit.textContent = `${verb}${plan.eligibleIds.length !== ids.length ? ` ${plan.eligibleIds.length} apto(s)` : ''}`;
    } catch (error) {
      if (dialog !== instance) return;
      resultBox.textContent = error.message; resultBox.setAttribute('role', 'alert'); finished(); return;
    }
    $('[data-product-confirm-submit]', overlay).onclick = async event => {
      if (instance.busy || dialog !== instance) return;
      instance.busy = true;
      overlay.setAttribute('aria-busy', 'true');
      $$('button', overlay).forEach(b => b.disabled = true);
      event.currentTarget.textContent = 'Aguardando confirmação…';
      const names = new Map(products.map(p => [p.id, p.nome]));
      const show = results => {
        if (dialog !== instance || currentKey() !== instance.key) return;
        const done = results.filter(r => r.status === 'confirmed').length;
        $('.product-action-results', overlay).innerHTML = `<b>${done} de ${plan.eligibleIds.length} confirmado${done === 1 ? '' : 's'} na nuvem</b><ul>${results.map(r => `<li class="${esc(r.status)}"><b>${esc(names.get(r.id))}</b><span>${r.status === 'confirmed' ? 'Confirmado' : esc(r.message || 'Confirmação pendente')}</span></li>`).join('')}</ul>`;
      };
      try {
        const results = await ProductActions.batch(plan.eligibleIds, kind, show);
        if (dialog !== instance || currentKey() !== instance.key) return;
        if (!Array.isArray(results) || results.length !== plan.eligibleIds.length || new Set(results.map(r => r.id)).size !== results.length || results.some(r => !plan.eligibleIds.includes(r.id)))
          throw Error('O resultado está incompleto. Confira as confirmações preservadas antes de iniciar outra ação.');
        if (results.every(r => r.status === 'confirmed') && plan.eligibleIds.length === ids.length) {
          closeDialog(); cancelSelection(); refresh();
          Utils.toast(`${results.length === 1 ? 'Produto' : `${results.length} produtos`} ${kind === 'archive' ? 'arquivado' : 'excluído'}${results.length === 1 ? '' : 's'}. Confirmado na nuvem.`);
          return;
        }
        show(results);
        results.filter(r => r.status === 'confirmed').forEach(r => selected.delete(r.id));
        finished();
        refresh();
      } catch (error) {
        if (dialog === instance) { resultBox.textContent = error.message; resultBox.setAttribute('role', 'alert'); finished(); }
      } finally {
        instance.busy = false;
        overlay.setAttribute('aria-busy', 'false');
        $$('[data-product-confirm-close]', overlay).forEach(b => b.disabled = false);
        if (dialog === instance) $$('[data-product-confirm-close]', overlay).at(-1)?.focus();
      }
    };
  }
  function cancelPress() { if (press) clearTimeout(press.timer); press = null; }
  document.addEventListener('pointerdown', event => {
    if (event.isPrimary === false) { cancelPress(); return; }
    if (!onPage() || !allowed() || enabled || event.pointerType === 'mouse' || event.isPrimary === false || event.target.closest('button,input,a,select,summary')) return;
    const card = event.target.closest('[data-product-card]'); if (!card) return;
    cancelPress();
    press = {x: event.clientX, y: event.clientY, id: event.pointerId, card};
    press.timer = setTimeout(() => {
      const target = press?.card; if (!target?.isConnected) return cancelPress();
      suppressClickUntil = Date.now() + 900;
      startSelection(target.dataset.productCard); cancelPress();
    }, 500);
  }, true);
  document.addEventListener('pointermove', event => { if (press && (Math.abs(event.clientX - press.x) > 8 || Math.abs(event.clientY - press.y) > 8)) cancelPress(); }, {capture: true, passive: true});
  ['pointerup', 'pointercancel', 'scroll'].forEach(name => document.addEventListener(name, cancelPress, {capture: true, passive: true}));
  document.addEventListener('contextmenu', event => { if (onPage() && event.target.closest('[data-product-card]') && (enabled || press)) event.preventDefault(); });
  document.addEventListener('click', event => {
    if (!onPage()) return;
    const card = event.target.closest('[data-product-card]'); if (!card) return;
    if (Date.now() < suppressClickUntil) { event.preventDefault(); event.stopImmediatePropagation(); return; }
    if (enabled) { event.preventDefault(); event.stopImmediatePropagation(); toggle(card.dataset.productCard); }
    else if (window.ProductActions?.isPending?.(card.dataset.productCard)) {
      event.preventDefault(); event.stopImmediatePropagation(); Utils.toast('Produto aguardando confirmação. Use Verificar confirmação; a operação original foi preservada.', true);
    }
  }, true);
  document.addEventListener('keydown', event => {
    if (dialog) {
      if (event.key === 'Escape' && !dialog.busy) { event.preventDefault(); closeDialog(); }
      if (event.key === 'Tab') {
        const buttons = $$('button:not([disabled]):not([hidden])', dialog.overlay), first = buttons[0], last = buttons.at(-1);
        if (!dialog.overlay.contains(document.activeElement)) { event.preventDefault(); first?.focus(); }
        else if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last?.focus(); }
        else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first?.focus(); }
      }
      return;
    }
    if (enabled && event.key === 'Escape') { event.preventDefault(); cancelSelection(); }
    if (!enabled && [' ', 'Enter'].includes(event.key) && window.ProductActions?.isPending?.(event.target.closest('[data-product-card]')?.dataset.productCard)) {
      event.preventDefault(); event.stopImmediatePropagation(); Utils.toast('Produto aguardando confirmação. Use Verificar confirmação.', true); return;
    }
    if (enabled && [' ', 'Enter'].includes(event.key) && event.target.closest('[data-product-card]')) {
      event.preventDefault(); event.stopImmediatePropagation(); toggle(event.target.closest('[data-product-card]').dataset.productCard);
    }
  }, true);
  addEventListener('popstate', () => {
    if (releasing) {
      releasing = false;
      const next = afterRelease; afterRelease = null;
      if (onPage()) next?.();
      return;
    }
    if (layer && history.state?.productUi !== layer) { layer = ''; closeDialog(); cancelSelection(); dismissSheets(); }
  });
  ['hashchange', 'firebase-session-cleared', 'firebase-auth-ready', 'business-context-changed', 'veconi-spaces-ready', 'veconi-space-context-changed', 'cloud-data-updated'].forEach(name => addEventListener(name, schedule));
  const app = $('#app');
  if (app) new MutationObserver(() => {
    // Ignore our own decoration; only real route/grid replacement needs rebinding.
    if (!scheduled && (!onPage() || cards().some(c => enabled && !$('[data-product-selection-check]', c)) || !$('[data-product-selection-tools]', app))) schedule();
  }).observe(app, {childList: true, subtree: true});
  window.ProductSelection = Object.freeze({open, active: () => enabled, cancel: cancelSelection, refresh: schedule});
  schedule();
})();
