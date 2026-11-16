window.Consignments = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalize = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const money = cents => window.ConsignmentPdf.money(cents);
  const label = kind => kind === 'replenishment' ? 'Reposição' : 'Entrega';
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: BusinessContext.get().business?.timezone || 'America/Sao_Paulo', dateStyle: 'short' }).format(new Date());
  const date = value => window.ConsignmentPdf.displayDate(value);
  const button = (title, data, primary = false) => `<button class="btn ${primary ? 'btn-primary' : 'btn-light'}" type="button" ${data}>${title}</button>`;
  const key = row => row.variantId || row.productId;
  const itemName = row => [row.name, row.variantName, row.sku].filter(Boolean).map(esc).join(' · ');
  const sameScope = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function owner() {
    const c = window.BusinessContext?.get?.();
    return c?.role === 'owner' && !c.loading && c.business?.ownerId === c.userProfile?.uid;
  }

  function scope() {
    const c = window.BusinessContext?.get?.();
    return { uid: c?.userProfile?.uid, businessId: c?.businessId, spaceId: window.SpaceContext?.activeId?.(),
      workspaceGeneration: c?.business?.workspaceGeneration ?? 0 };
  }

  function entry() {
    return owner() ? `<section class="panel consignment-entry"><div><b>Consignados</b><p class="muted">Entregas e estoque em pontos de venda.</p></div><a href="#/consignados" class="btn btn-light">${icon('package-open')} Abrir Consignados</a></section>` : '';
  }

  function shell() {
    return `<section class="consignment-page"><header class="consignment-heading"><div><h2>Consignados</h2><p>Entregas, reposições e estoque por ponto de venda.</p></div><a href="#/configuracoes" class="btn btn-light">Configurações</a></header>${window.SpaceContext?.renderBar?.('sales') || ''}<div data-consignment-content></div></section>`;
  }

  function catalog(origin) {
    const d = DB.readForView?.() || DB.carregar();
    const variants = new Map();
    const visible = row => row.ativo !== false && row.active !== false && !row.deleted && !row.deletedAt &&
      row.businessId === origin.businessId && (row.workspaceGeneration ?? 0) === origin.workspaceGeneration &&
      (!row.spaceId || row.spaceId === origin.spaceId);
    for (const row of d.variacoesProdutos || []) if (visible(row)) {
      if (!variants.has(row.parentProductId)) variants.set(row.parentProductId, []);
      variants.get(row.parentProductId).push(row);
    }
    const items = [];
    for (const p of d.produtos || []) {
      if (!visible(p) || !['all_spaces', 'selected_spaces', 'single_space'].includes(p.spaceAccessMode)
        || !window.SpaceEngine.productAllowsSpace(p, origin.spaceId) || ['service', 'recurring'].includes(p.productType)
        || p.itemKind === 'service' || p.semControleEstoque || p.controlaEstoque === false || p.controlarEstoque === false) continue;
      for (const v of p.productType === 'variable' ? variants.get(p.id) || [] : [null]) {
        const src = v || p, name = p.nome || p.id, value = {
          productId: p.id, variantId: v?.id || null, name, variantName: v?.displayName || v?.name || '',
          sku: src.sku || src.codigo || src.codigoInterno || '', available: Number(v ? v.stock : p.estoqueAtual ?? p.estoque) - Number(src.onlineReservedStock || 0),
        };
        value.search = normalize([name, value.variantName, value.sku, p.sku, src.barcode, p.barcode].filter(Boolean).join(' '));
        items.push(value);
      }
    }
    return items;
  }

  function mount(container) {
    const host = container.querySelector('[data-consignment-content]');
    if (!host) return;
    const origin = scope();
    const running = () => host.isConnected && owner() && sameScope(origin, scope());
    if (!owner() || !origin.businessId || !origin.spaceId) {
      host.innerHTML = '<section class="panel consignment-panel">Selecione um espaço operacional com a conta do proprietário.</section>';
      return;
    }
    const pendingKey = 'veconi:consignados:pending:' + [origin.uid, origin.businessId, origin.workspaceGeneration, origin.spaceId].join(':');
    const readPending = () => JSON.parse(localStorage.getItem(pendingKey) || 'null');
    const clearPending = payload => {
      if (readPending()?.operationId === payload.operationId) localStorage.removeItem(pendingKey);
    };
    const api = async (action, fields = {}) => {
      if (!running()) throw Error('O espaço selecionado mudou.');
      const { uid, ...context } = origin;
      const result = await window.FirebaseCallable('manageConsignment', { ...context, ...fields, action });
      if (!running()) throw Error('O espaço selecionado mudou.');
      return result.data;
    };
    let dashboard, tab = 'home', outletId = '', page = { items: [] }, receipt, draft, products, pending, file, feedback = '', busy = false;
    const tabs = { home: 'Visão geral', outlets: 'Pontos de venda', delivery: 'Nova entrega', inventory: 'Estoque', history: 'Histórico' };
    const selectOutlets = selected => '<option value="">Selecione</option>' + dashboard.outlets.map(row =>
      `<option value="${esc(row.id)}" ${selected === row.id ? 'selected' : ''}>${esc(row.name)}</option>`).join('');
    const newDraft = () => ({ outletId: '', deliveredOn: today(), notes: '', items: new Map() });
    draft = newDraft();

    function home() {
      const summary = [['Pontos de venda', dashboard.outlets.length], ['Unidades consignadas', dashboard.units], ['Entregas registradas', dashboard.deliveries]];
      return `<div class="consignment-stats">${summary.map(([name, value]) => `<section class="panel"><span>${name}</span><strong>${value}</strong></section>`).join('')}</div>
        <section class="panel consignment-panel"><h3>Estoque fora da loja</h3>${dashboard.outlets.length ? dashboard.outlets.map(row =>
          `<div class="consignment-row"><div><b>${esc(row.name)}</b><small>${row.units} un. consignadas</small></div>${button('Ver estoque', `data-stock="${esc(row.id)}"`)}</div>`).join('') : '<p class="muted">Cadastre o primeiro ponto de venda para registrar uma entrega.</p>'}<div class="consignment-actions">${button('Desativar módulo neste espaço', 'data-disable')}</div></section>`;
    }

    function outlets() {
      return `<section class="panel consignment-panel"><h3>Novo ponto de venda</h3><form data-outlet-form class="consignment-fields">
        <label>Nome <input name="name" required maxlength="120"></label><label>Responsável <input name="contact" maxlength="120"></label>
        <label>Telefone <input name="phone" type="tel" maxlength="40"></label><label>Endereço <input name="address" maxlength="240"></label>
        <div><button class="btn btn-primary" type="submit">Cadastrar ponto</button></div></form></section>
        <section class="panel consignment-panel"><h3>Pontos cadastrados</h3>${dashboard.outlets.map(row =>
          `<div class="consignment-row"><div><b>${esc(row.name)}</b><small>${[row.contact,row.phone,row.address].filter(Boolean).map(esc).join(' · ')}</small></div>${button('Estoque', `data-stock="${esc(row.id)}"`)}</div>`).join('') || '<p class="muted">Nenhum ponto cadastrado.</p>'}</section>`;
    }

    function delivery() {
      if (!dashboard.outlets.length) return `<section class="panel consignment-panel"><p>Cadastre um ponto de venda antes de registrar uma entrega.</p>${button('Cadastrar ponto', 'data-tab="outlets"', true)}</section>`;
      return `<section class="panel consignment-panel"><h3>Entrega ou reposição</h3><form data-delivery-form>
        <div class="consignment-fields"><label>Ponto de venda <select name="outletId" required>${selectOutlets(draft.outletId)}</select></label>
        <label>Data da entrega <input name="deliveredOn" type="date" value="${esc(draft.deliveredOn)}" max="${today()}" required></label></div>
        <p class="muted">Para entregas retroativas, informe a data real. O estoque disponível é validado no momento do registro.</p>
        <label>Produto ou variação <input type="search" data-product-search placeholder="Buscar por nome, SKU ou código" autocomplete="off"></label>
        <div data-matches class="consignment-results"></div><div data-delivery-items></div>
        <label>Observações <textarea name="notes" maxlength="500">${esc(draft.notes)}</textarea></label>
        <p class="muted">O registro transfere as unidades para o ponto de venda. Nenhuma cobrança é feita.</p>
        <button class="btn btn-primary" type="submit">Registrar entrega</button></form></section>`;
    }

    function list(kind) {
      const inventory = kind === 'inventory';
      const rows = page.items.map(row => inventory
        ? `<div class="consignment-row"><div><b>${itemName(row)}</b><small>${money(row.unitCents)} de referência por unidade</small></div><strong>${row.quantity} un.</strong></div>`
        : `<div class="consignment-row"><div><b>${esc(row.outlet.name)}</b><small>${label(row.kind)} · ${date(row.deliveredOn)} · ${row.units} un. · ${money(row.totalCents)}</small></div>${button('Comprovante', `data-receipt="${esc(row.id)}"`)}</div>`);
      return `<section class="panel consignment-panel"><h3>${inventory ? 'Estoque no estabelecimento' : 'Histórico de entregas'}</h3>
        ${inventory ? `<label>Ponto de venda <select data-inventory-outlet>${selectOutlets(outletId)}</select></label>` : ''}
        ${rows.join('') || '<p class="muted">Nenhum registro para exibir.</p>'}
        ${page.cursor ? button('Carregar mais', 'data-more') : ''}</section>`;
    }

    function receiptView() {
      if (!receipt) return '';
      return `<section class="panel consignment-panel"><h3>${label(receipt.kind)} confirmada</h3><p>${esc(receipt.outlet.name)} · ${date(receipt.deliveredOn)}</p>
        ${receipt.items.map(row => `<div class="consignment-row"><div><b>${itemName(row)}</b><small>${row.quantity} un. · saldo no ponto ${row.outletBefore} → ${row.outletAfter}</small></div><strong>${money(row.totalCents)}</strong></div>`).join('')}
        <p><b>Total de referência ${money(receipt.totalCents)}</b></p>
        <label>Logo para este PDF (opcional) <input type="file" data-pdf-logo accept="image/png,image/jpeg,image/webp"></label>
        <div class="consignment-actions">${button('Gerar PDF', 'data-prepare-pdf', true)}
        ${file ? button('Baixar PDF', 'data-download') + button('Compartilhar PDF', 'data-share') : ''}</div></section>`;
    }

    function renderItems() {
      const items = host.querySelector('[data-delivery-items]');
      if (!items) return;
      items.innerHTML = [...draft.items.values()].map(row => `<div class="consignment-row"><b>${itemName(row)}</b>
        <label>Quantidade <input type="number" min="1" max="100000" required data-quantity="${esc(key(row))}" value="${row.quantity}"></label>
        ${button('Remover', `data-remove="${esc(key(row))}"`)}</div>`).join('');
    }

    function paint() {
      if (!running()) return;
      const message = `<p class="consignment-status" role="status">${esc(feedback)}</p>`;
      if (pending) {
        host.innerHTML = message + `<section class="panel consignment-panel"><h3>Operação ainda sem confirmação</h3>
          <p>Confira a tentativa original. O mesmo identificador será reutilizado.</p>${button('Conferir e concluir', 'data-resume', true)}</section>`;
      } else if (!dashboard) {
        host.innerHTML = message + button('Carregar painel', 'data-refresh');
      } else if (!dashboard.enabled) {
        host.innerHTML = message + `<section class="panel consignment-panel"><h3>Ativar Consignados neste espaço</h3><p>Controle o estoque enviado a pontos de venda parceiros.</p>${button('Ativar módulo', 'data-enable', true)}</section>`;
      } else {
        const contents = { home, outlets, delivery, inventory: () => list('inventory'), history: () => list('history'), receipt: receiptView };
        host.innerHTML = `<nav class="consignment-tabs" aria-label="Consignados">${Object.entries(tabs).map(([id,title]) => button(title,
          `data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}`, tab === id)).join('')}</nav>` + message + contents[tab]();
      }
      renderItems();
      window.lucide?.createIcons();
    }

    function setFeedback(message) {
      feedback = message;
      const status = host.querySelector('.consignment-status');
      if (status) status.textContent = message;
    }

    function assertOnlineStock() {
      const diagnostic = window.SyncFirebase?.getFirebaseDiagnostic?.();
      if (!navigator.onLine || !diagnostic || +diagnostic.pending > 0 || +diagnostic.syncErrors > 0 || diagnostic.queueStorageCorrupt)
        throw Error('Confira as pendências em Sincronização antes de registrar uma entrega. A operação precisa de conexão.');
    }

    async function register(payload) {
      if (payload.action === 'confirm') assertOnlineStock();
      const persist = () => {
        const stored = readPending();
        if (stored && stored.operationId !== payload.operationId) throw Error('Conclua primeiro a operação anterior neste espaço.');
        localStorage.setItem(pendingKey, JSON.stringify(payload));
        pending = payload;
      };
      if (navigator.locks) await navigator.locks.request(pendingKey, persist);
      else persist();
      let result;
      try { result = await api(payload.action, payload); }
      catch (error) {
        if (running() && ['invalid-argument','failed-precondition','not-found','resource-exhausted']
          .includes(String(error.code || '').replace('functions/', ''))) {
          clearPending(payload);
          pending = null;
        }
        throw error;
      }
      clearPending(payload);
      pending = null;
      if (result.item) {
        receipt = result.item;
        file = null;
        tab = 'receipt';
        outletId = receipt.outlet.id;
        draft = newDraft();
      }
      dashboard = await api('dashboard');
      feedback = result.item ? 'Entrega registrada. Você já pode gerar o comprovante.' : 'Ponto de venda cadastrado.';
    }

    async function resume() {
      if (pending.action === 'confirm') {
        let result;
        try { result = await api('receipt', { operationId: pending.operationId }); }
        catch (error) { if (String(error.code || '').replace('functions/', '') !== 'not-found') throw error; }
        if (result?.item) {
          clearPending(pending);
          pending = null;
          receipt = result.item;
          file = null;
          dashboard = await api('dashboard');
          tab = 'receipt';
          feedback = 'Entrega já registrada. Comprovante recuperado.';
          return;
        }
      }
      await register(pending);
    }

    async function loadPage(append = false) {
      if (tab === 'inventory' && !outletId) { page = { items: [] }; return; }
      const next = await api(tab, { outletId, cursor: append ? page.cursor : null });
      page = { ...next, items: append ? [...page.items, ...next.items] : next.items };
    }

    async function run(task, reRenderOnError = false) {
      if (busy) return;
      busy = true;
      setFeedback('Carregando…');
      for (const child of host.querySelectorAll('button')) child.disabled = true;
      try {
        feedback = '';
        await task();
        paint();
      } catch (error) {
        if (error.name === 'AbortError') feedback = '';
        else feedback = error.message || 'Não foi possível concluir.';
        if (pending || reRenderOnError) paint();
        else setFeedback(feedback);
      } finally {
        busy = false;
        for (const child of host.querySelectorAll('button')) child.disabled = false;
      }
    }

    let logoFile;
    host.addEventListener('input', event => {
      const input = event.target, form = input.form;
      if (input.matches('[data-product-search]')) {
        products ||= catalog(origin);
        const search = normalize(input.value), matches = search ? products.filter(row => row.search.includes(search)).slice(0,25) : [];
        host.querySelector('[data-matches]').innerHTML = matches.map(row => button(
          `${itemName(row)} · ${Math.max(0, row.available || 0)} un.`, `data-add="${esc(key(row))}"`)).join('') ||
          (search ? '<p class="muted">Nenhum produto encontrado neste espaço.</p>' : '');
      }
      if (input.matches('[data-quantity]')) draft.items.get(input.dataset.quantity).quantity = +input.value;
      if (form?.matches('[data-delivery-form]')) {
        draft.outletId = form.elements.outletId.value;
        draft.deliveredOn = form.elements.deliveredOn.value;
        draft.notes = form.elements.notes.value;
      }
    });
    host.addEventListener('change', event => {
      const input = event.target;
      if (input.matches('[data-inventory-outlet]')) {
        outletId = input.value;
        page = { items: [] };
        paint();
        run(() => loadPage(), true);
      }
      if (input.matches('[data-pdf-logo]')) {
        const selected = input.files[0];
        if (selected && selected.size > 4_000_000) { input.value = ''; setFeedback('Escolha uma imagem de até 4 MB.'); return; }
        logoFile = selected;
        file = null;
        host.querySelector('[data-download]')?.remove();
        host.querySelector('[data-share]')?.remove();
      }
    });
    host.addEventListener('submit', event => {
      event.preventDefault();
      const form = event.target;
      if (form.matches('[data-outlet-form]')) {
        const fields = Object.fromEntries(new FormData(form));
        run(() => register({ ...fields, action: 'outlet', operationId: crypto.randomUUID() }));
      }
      if (form.matches('[data-delivery-form]')) {
        if (!draft.items.size) { setFeedback('Inclua pelo menos um produto.'); return; }
        const { outletId, deliveredOn, notes } = Object.fromEntries(new FormData(form));
        const items = [...draft.items.values()].map(({ productId, variantId, quantity }) => ({ productId, variantId, quantity }));
        run(() => register({ outletId, deliveredOn, notes, items, action: 'confirm', operationId: crypto.randomUUID() }));
      }
    });
    host.addEventListener('click', event => {
      const target = event.target.closest('button');
      if (!target || target.type === 'submit' || busy || !running()) return;
      const d = target.dataset;
      if (d.add) {
        const item = products.find(row => key(row) === d.add), previous = draft.items.get(d.add);
        if (!previous && draft.items.size >= 40) { setFeedback('Inclua até 40 produtos por entrega.'); return; }
        draft.items.set(d.add, { ...item, quantity: previous ? Math.min(100000, previous.quantity + 1) : 1 });
        renderItems();
        return;
      }
      if (d.remove) { draft.items.delete(d.remove); renderItems(); return; }
      if ('download' in d && file) { window.ConsignmentPdf.download(file); return; }
      if ('share' in d && file) {
        if (!navigator.share || !navigator.canShare?.({ files: [file] })) {
          window.ConsignmentPdf.download(file);
          setFeedback('PDF baixado. Anexe o arquivo no aplicativo de sua escolha.');
          return;
        }
        navigator.share({ files: [file], title: 'Comprovante de consignação' })
          .catch(error => { if (error.name !== 'AbortError') setFeedback('Não foi possível compartilhar. Baixe o PDF para anexar.'); });
        return;
      }
      run(async () => {
        if ('refresh' in d) dashboard = await api('dashboard');
        if ('enable' in d) { await api('enable'); dashboard = await api('dashboard'); }
        if ('disable' in d && window.confirm('Desativar Consignados neste espaço? As entregas e os saldos serão preservados.')) {
          await api('disable'); dashboard = await api('dashboard'); tab = 'home';
        }
        if ('resume' in d) await resume();
        if (d.tab || d.stock) {
          tab = d.stock ? 'inventory' : d.tab;
          if (d.stock) outletId = d.stock;
          if (tab === 'delivery') products = null;
          if (['history', 'inventory'].includes(tab)) { page = { items: [] }; await loadPage(); }
        }
        if ('more' in d) await loadPage(true);
        if (d.receipt) { receipt = (await api('receipt', { operationId: d.receipt })).item; file = null; logoFile = null; tab = 'receipt'; }
        if ('preparePdf' in d) {
          const result = await window.ConsignmentPdf.generate(receipt, logoFile);
          file = result.file;
          feedback = result.logoUnavailable ? 'PDF pronto. A logo não pôde ser carregada. Selecione uma imagem para incluir.' : 'PDF pronto para baixar ou compartilhar.';
        }
      });
    });
    host.innerHTML = '<p class="consignment-status" role="status">Carregando Consignados…</p>';
    run(async () => { pending = readPending(); dashboard = await api('dashboard'); }, true);
  }

  return { entry, shell, mount };
})();
