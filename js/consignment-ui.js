window.Consignments = (() => {
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const normalize = value => String(value || '').normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const icon = name => `<i data-lucide="${name}" aria-hidden="true"></i>`;
  const money = cents => window.ConsignmentPdf.money(cents);
  const label = kind => ({ replenishment: 'Reposição', delivery: 'Consignação', conference: 'Conferência', settlement: 'Acerto' })[kind] || 'Entrega';
  const photo = row => {
    const source = String(row.imageUrl || '');
    return /^https:\/\//i.test(source) ? `<img class="consignment-photo" src="${esc(source)}" loading="lazy" alt="">`
      : `<span class="consignment-photo consignment-photo-empty">${icon('package')}</span>`;
  };
  const today = () => new Intl.DateTimeFormat('sv-SE', { timeZone: BusinessContext.get().business?.timezone || 'America/Sao_Paulo', dateStyle: 'short' }).format(new Date());
  const date = value => window.ConsignmentPdf.displayDate(value);
  const button = (title, data, primary = false) => `<button class="btn ${primary ? 'btn-primary' : 'btn-light'}" type="button" ${data}>${title}</button>`;
  const key = row => row.variantId || row.productId;
  const itemName = row => [row.name, row.variantName, row.sku].filter(Boolean).map(esc).join(' · ');
  const sameScope = (a, b) => JSON.stringify(a) === JSON.stringify(b);

  function owner() {
    const c = window.BusinessContext?.get?.();
    return c?.role === 'owner' && !c.loading && !c.error && c.userProfile?.active !== false &&
      (!c.member || c.member.status === 'active') && c.business?.ownerId === c.userProfile?.uid;
  }

  function scope() {
    const c = window.BusinessContext?.get?.();
    return { uid: c?.userProfile?.uid, businessId: c?.businessId, spaceId: window.SpaceContext?.activeId?.(),
      workspaceGeneration: c?.business?.workspaceGeneration ?? 0 };
  }

  function entry() {
    return owner() ? `<section class="panel consignment-entry"><div><b>Consignados</b><p class="muted">Entregas e estoque em pontos de venda.</p></div><a href="#/consignados?config=1" class="btn btn-light">${icon('package-open')} Configurar</a></section>` : '';
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
          imageUrl: src.imageThumbUrl || src.imageUrl || src.photoUrl || src.imagemUrl || src.image?.url || src.imagem || p.imageThumbUrl || p.imageUrl || p.imagem || '',
          unitCents: Math.round(Number(v ? v.price ?? p.preco : p.preco) * 100),
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
    let outletSearch = '', historyOutlet = '', currentPayment = null, counting = null, paymentAccounts = [], settlement = false;
    const query = new URLSearchParams(location.hash.split('?')[1] || '');
    const tabs = { home: 'Visão geral', history: 'Histórico' };
    const selectOutlets = selected => '<option value="">Selecione</option>' + dashboard.outlets.map(row =>
      `<option value="${esc(row.id)}" ${selected === row.id ? 'selected' : ''}>${esc(row.name)}</option>`).join('');
    const newDraft = () => ({ outletId: '', deliveredOn: today(), notes: '', items: new Map() });
    draft = newDraft();

    const activeOutlet = () => dashboard.outlets.find(row => row.id === outletId);
    const outletCards = () => dashboard.outlets.filter(row => normalize([row.name, row.contact, row.phone].join(' ')).includes(normalize(outletSearch))).map(row =>
      `<article class="panel consignment-store"><button class="consignment-store-title" data-outlet-view="${esc(row.id)}" type="button">
        <span>${icon('store')}</span><b>${esc(row.name)}</b>${icon('chevron-right')}</button>
        <div class="consignment-store-metrics"><div><small>Peças consignadas</small><b>${row.units}</b></div>
        <div><small>Vendas no mês</small><b>${money(row.month?.grossCents || 0)}</b></div>
        <div><small>A receber</small><b>${money(row.pendingCents || 0)}</b></div></div>
        <div class="consignment-actions">${button('Nova entrega', `data-new-delivery="${esc(row.id)}"`, true)}
        ${button('Conferência', `data-count="${esc(row.id)}"`)}</div></article>`).join('') || '<p class="muted">Nenhum estabelecimento encontrado.</p>';
    function home() {
      const summary = [['Pontos de venda', dashboard.outlets.length], ['Unidades consignadas', dashboard.units],
        ['Valor em consignação', money(dashboard.stockValueCents || 0)], ['Valor a receber', money(dashboard.pendingCents || 0)]];
      return `<div class="consignment-stats">${summary.map(([name, value]) => `<section class="panel"><span>${name}</span><strong>${value}</strong></section>`).join('')}</div>
        <div class="consignment-toolbar"><label>Estabelecimentos <input type="search" data-outlet-search placeholder="Buscar estabelecimento" value="${esc(outletSearch)}"></label>
        ${button('Cadastrar loja', 'data-tab="outlets"', true)}</div><div class="consignment-grid" data-outlets>${outletCards()}</div>`;
    }

    function outlets() {
      return `<section class="panel consignment-panel"><h3>Novo ponto de venda</h3><form data-outlet-form class="consignment-fields">
        <label>Nome <input name="name" required maxlength="120"></label><label>Responsável <input name="contact" maxlength="120"></label>
        <label>Telefone <input name="phone" type="tel" maxlength="40"></label><label>Endereço <input name="address" maxlength="240"></label>
        <label>Comissão (%) <input name="commission" type="number" min="0" max="100" step="0.01" value="0" required></label>
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
        <p class="consignment-totals" data-delivery-total></p>
        <button class="btn btn-primary" type="submit">Registrar entrega</button></form></section>`;
    }

    function list(kind) {
      const inventory = kind !== 'history';
      const rows = page.items.map(row => inventory
        ? `<div class="consignment-row"><div class="consignment-product">${photo(row)}<div><b>${itemName(row)}</b><small>${money(row.unitCents)} por unidade</small></div></div><strong>${row.quantity} un.</strong></div>`
        : `<div class="consignment-row"><div><b>${esc(row.outlet.name)}</b><small>${label(row.kind)} · ${date(row.deliveredOn)} · ${row.units} un. · ${money(row.totalCents)}</small></div>${button('Comprovante', `data-receipt="${esc(row.id)}"`)}</div>`);
      return `<section class="panel consignment-panel"><h3>${inventory ? 'Estoque no estabelecimento' : 'Histórico de entregas'}</h3>
        ${kind === 'inventory' ? `<label>Ponto de venda <select data-inventory-outlet>${selectOutlets(outletId)}</select></label>` : ''}
        ${rows.join('') || '<p class="muted">Nenhum registro para exibir.</p>'}
        ${page.cursor ? button('Carregar mais', 'data-more') : ''}</section>`;
    }

    const paymentModes = [['pix', 'Pix'], ['cash', 'Dinheiro'], ['transfer', 'Transferência'], ['debit_card', 'Cartão de débito'], ['other', 'Outro']];
    function paymentControls(allowPending = true) {
      return `<div class="consignment-fields"><label>Situação <select name="paymentMode">
        ${allowPending ? '<option value="pending">Deixar pendente</option>' : ''}<option value="paid">Registrar recebimento</option></select></label>
        <div data-payment-fields ${allowPending ? 'hidden' : ''}><label>Conta de destino <select name="account">
        <option value="">Escolher conta</option>${paymentAccounts.map((row, i) => `<option value="${i}">${esc(row.name)}</option>`).join('')}</select></label>
        <label>Forma de recebimento <select name="method">${paymentModes.map(([key, title]) => `<option value="${key}">${title}</option>`).join('')}</select></label>
        ${paymentAccounts.length ? '' : '<small class="muted">Cadastre ou vincule uma conta em Financeiro para registrar o recebimento.</small>'}</div></div>`;
    }
    function paymentFrom(form) {
      if (form.elements.paymentMode?.value !== 'paid') return { status: 'pending' };
      const index = form.elements.account.value, account = index === '' ? null : paymentAccounts[Number(index)];
      if (!account) throw Error('Selecione a conta de destino.');
      return { status: 'paid', accountId: account.id, homeId: account.homeId, method: form.elements.method.value };
    }
    async function loadAccounts() {
      try {
        const gateway = window.FinancialSpaceService || (await import('./firebase/financial-space-service.js?v=consignados-v2')).FinancialSpaceService;
        const spaces = window.SpaceContext?.list?.() || [];
        paymentAccounts = (await gateway.listFinancialAccounts(origin.spaceId)).map(row => ({ id: row.id, name: row.name,
          homeId: row.accountHomeSpaceId || row.financialAccountHomeSpaceId || row.financialSpaceId || origin.spaceId }))
          .filter(row => row.homeId === origin.spaceId || spaces.some(space => space.id === row.homeId &&
            [space.businessId, space.linkedBusinessId].includes(origin.businessId)));
      } catch { paymentAccounts = []; }
    }
    function countTotals() {
      let units = 0, gross = 0, valid = true;
      for (const row of counting.items) {
        const item = counting.values.get(row.id);
        const fields = [item.found, item.returns, item.loss, item.damaged];
        const sold = row.quantity - fields.reduce((sum, n) => sum + Number(n),0);
        const rowValid = fields.every(n => n !== '' && Number.isSafeInteger(Number(n)) && Number(n) >= 0) && sold >= 0;
        if (!rowValid) valid = false;
        else { units += sold; gross += sold * row.unitCents; }
        const element = host.querySelector(`[data-count-result="${row.id}"]`);
        if (element) element.textContent = rowValid ? sold + ' un. · ' + money(sold * row.unitCents) : 'Confira a contagem';
      }
      const commission = Math.round(gross * counting.commissionBps / 10000);
      return { valid, units, gross, commission, net: gross - commission };
    }
    const totalsMarkup = values => `<div class="consignment-store-metrics"><div><small>Unidades vendidas</small><b>${values.units}</b></div>
        <div><small>Valor bruto</small><b>${money(values.gross)}</b></div><div><small>Comissão</small><b>${money(values.commission)}</b></div>
        <div><small>Líquido a receber</small><b>${money(values.net)}</b></div></div>`;
    function conference() {
      if (!counting.items.length) return '<section class="panel consignment-panel"><p>Este ponto ainda não tem estoque para conferir.</p></section>';
      if (counting.review) {
        const values = countTotals();
        return `<section class="panel consignment-panel"><h3>Revisar conferência</h3><p>${esc(counting.outlet.name)}</p>${totalsMarkup(values)}
          <form data-confirm-count>${values.net ? paymentControls() : '<p class="muted">Sem valor a receber.</p>'}
          <div class="consignment-actions">${button('Editar contagem', 'data-edit-count')}<button class="btn btn-primary" type="submit">Confirmar conferência</button></div></form></section>`;
      }
      return `<section class="panel consignment-panel"><h3>Conferência · ${esc(counting.outlet.name)}</h3>
        <p class="muted">Informe as unidades que ficaram. Devoluções voltam ao estoque da loja. Perdas e avarias ficam fora das vendas.</p><form data-review-count>
        ${counting.items.map(row => `<article class="consignment-count-row"><div class="consignment-product">${photo(row)}<div><b>${itemName(row)}</b>
        <small>${money(row.unitCents)} por unidade · ${row.quantity} un. anteriores</small></div></div>
        <div class="consignment-fields">${[['found','Ficaram na loja'],['returns','Devolvidas'],['loss','Perdidas'],['damaged','Avariadas']].map(([k,t]) =>
          `<label>${t}<input type="number" min="0" step="1" max="${row.quantity}" required data-count-id="${row.id}" data-count-field="${k}" value="${esc(counting.values.get(row.id)[k])}"></label>`).join('')}</div>
        <small>Vendidas <strong data-count-result="${row.id}"></strong></small></article>`).join('')}
        <button class="btn btn-primary" type="submit">Revisar conferência</button></form></section>`;
    }
    function outletView() {
      const row = activeOutlet();
      if (!row) return '';
      return `<section class="panel consignment-panel"><h3>${esc(row.name)}</h3>
        <p>${[row.contact,row.phone,row.address].filter(Boolean).map(esc).join(' · ')}</p><p>Comissão ${row.commissionBps / 100}%</p>
        <div class="consignment-actions">${button('Nova entrega', `data-new-delivery="${esc(row.id)}"`, true)}
        ${button('Conferência', `data-count="${esc(row.id)}"`)}
        ${button('Histórico do ponto', `data-history-outlet="${esc(row.id)}"`)}</div></section>${list('outlet')}`;
    }
    function receiptView() {
      if (!receipt) return '';
      const count = receipt.kind === 'conference', paid = receipt.kind === 'settlement', hasStock = Array.isArray(receipt.stockAfter);
      return `<section class="panel consignment-panel"><h3>${label(receipt.kind)} · ${esc(receipt.outlet.name)}</h3><p>${date(receipt.deliveredOn)}</p>
        ${count ? totalsMarkup({units:receipt.units,gross:receipt.grossCents,commission:receipt.commissionCents,net:receipt.netCents})
          : `<p><b>${paid ? 'Valor recebido' : 'Total de referência'} ${money(receipt.totalCents)}</b></p>`}
        ${(receipt.items || []).map(row => `<div class="consignment-row"><div><b>${itemName(row)}</b><small>${count
          ? `${row.quantity} vendidas · ${row.found} ficaram · ${row.returns} devolvidas · ${row.loss} perdidas · ${row.damaged} avariadas`
          : `${row.quantity} un. · saldo no ponto ${row.outletBefore} → ${row.outletAfter}`}</small></div><strong>${money(row.totalCents)}</strong></div>`).join('')}
        ${count ? `<p>Situação ${{paid:'Recebido',pending:'A receber',none:'Sem valor a receber',unavailable:'A conferir'}[currentPayment || receipt.paymentAtRecording] || 'A conferir'}</p>` : ''}
        ${count && currentPayment === 'pending' ? (settlement ? `<form data-confirm-settlement>${paymentControls(false)}<button class="btn btn-primary" type="submit">Confirmar acerto</button></form>`
          : button('Registrar recebimento', 'data-start-settlement')) : ''}
        <div class="consignment-actions">${count ? button('Repor agora', `data-new-delivery="${esc(receipt.outlet.id)}"`, true) : ''}</div>
        ${paid ? '' : `<label>Logo para o PDF (opcional) <input type="file" data-pdf-logo accept="image/png,image/jpeg,image/webp"></label>
        <div class="consignment-actions">${count ? button('PDF de conferência', 'data-prepare-pdf="conference"', true) : ''}
        ${hasStock ? button('PDF do estoque atualizado', 'data-prepare-pdf="stock"', !count) : count ? '' : button('Gerar comprovante', 'data-prepare-pdf="delivery"', true)}
        ${file ? button('Baixar PDF', 'data-download') + button('Compartilhar PDF', 'data-share') : ''}</div>`}</section>`;
    }

    function renderItems() {
      const items = host.querySelector('[data-delivery-items]');
      if (!items) return;
      items.innerHTML = [...draft.items.values()].map(row => `<div class="consignment-row"><div class="consignment-product">${photo(row)}<div><b>${itemName(row)}</b>
        <small>${Math.max(0, row.available || 0)} un. disponíveis na última leitura</small></div></div>
        <label>Quantidade <input type="number" min="1" max="100000" required data-quantity="${esc(key(row))}" value="${row.quantity}"></label>
        <label>Preço unitário <input type="number" min="0" max="1000000" step="0.01" required data-price="${esc(key(row))}" value="${row.unitCents / 100}"></label>
        ${button('Remover', `data-remove="${esc(key(row))}"`)}</div>`).join('');
      deliveryTotal();
    }
    function deliveryTotal() {
      const total = host.querySelector('[data-delivery-total]');
      if (!total) return;
      const rows = [...draft.items.values()];
      total.textContent = rows.reduce((sum,row)=>sum+row.quantity,0) + ' un. · ' + money(rows.reduce((sum,row)=>sum+row.quantity*row.unitCents,0));
    }

    function paint() {
      if (!running()) return;
      const message = `<p class="consignment-status" role="status">${esc(feedback)}</p>`;
      if (pending) {
        host.innerHTML = message + `<section class="panel consignment-panel"><h3>Operação ainda sem confirmação</h3>
          <p>Confira a tentativa original. O mesmo identificador será reutilizado.</p>${button('Conferir e concluir', 'data-resume', true)}</section>`;
      } else if (!dashboard) {
        host.innerHTML = message + button('Carregar painel', 'data-refresh');
      } else if (!dashboard.enabled && tab !== 'receipt') {
        host.innerHTML = message + `<section class="panel consignment-panel"><h3>Ativar Consignados neste espaço</h3><p>Controle o estoque enviado a pontos de venda parceiros.</p>${button('Ativar módulo', 'data-enable', true)}</section>`;
      } else {
        const contents = { home, outlets, delivery, outlet: outletView, conference, inventory: () => list('inventory'), history: () => list('history'), receipt: receiptView };
        host.innerHTML = `<nav class="consignment-tabs" aria-label="Consignados">${Object.entries(tabs).map(([id,title]) => button(title,
          `data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}`, tab === id)).join('')}</nav>` + message + contents[tab]() + (query.has('config') && dashboard.enabled
          ? button('Desativar neste espaço', 'data-disable') : '');
      }
      renderItems();
      if (tab === 'conference' && counting) countTotals();
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
      if (['confirm', 'conference'].includes(payload.action)) assertOnlineStock();
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
        if (running() && ['invalid-argument','failed-precondition','not-found']
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
        currentPayment = result.currentPayment ?? receipt.paymentAtRecording;
        settlement = false;
        file = null;
        tab = 'receipt';
        outletId = receipt.outlet.id;
        draft = newDraft();
      }
      window.dispatchEvent(new Event('consignment-updated'));
      if (result.item?.kind === 'conference' || result.item?.kind === 'settlement')
        window.dispatchEvent(new CustomEvent('financial-data-changed',{ detail:{entity:'entries',spaceId:origin.spaceId} }));
      dashboard = await api('dashboard');
      feedback = result.item ? label(result.item.kind) + ' registrada.' : 'Ponto de venda cadastrado.';
    }

    async function resume() {
      if (['confirm','conference','settle'].includes(pending.action)) {
        let result;
        try { result = await api('receipt', { operationId: pending.operationId }); }
        catch (error) { if (String(error.code || '').replace('functions/', '') !== 'not-found') throw error; }
        if (result?.item) {
          clearPending(pending);
          pending = null;
          receipt = result.item;
          currentPayment = result.currentPayment ?? receipt.paymentAtRecording;
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
      const action = tab === 'outlet' ? 'inventory' : tab;
      const target = action === 'history' ? historyOutlet : outletId;
      const next = await api(action, { outletId: target, cursor: append ? page.cursor : null });
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
      if (input.matches('[data-outlet-search]')) {
        outletSearch = input.value;
        host.querySelector('[data-outlets]').innerHTML = outletCards();
        window.lucide?.createIcons();
      }
      if (input.dataset.countId) {
        counting.values.get(input.dataset.countId)[input.dataset.countField] = input.value;
        countTotals();
      }
      if (input.matches('[data-product-search]')) {
        products ||= catalog(origin);
        const search = normalize(input.value), matches = search ? products.filter(row => row.search.includes(search)).slice(0,25) : [];
        host.querySelector('[data-matches]').innerHTML = matches.map(row => button(
          `${photo(row)}<span>${itemName(row)} · ${Math.max(0, row.available || 0)} un.</span>`, `data-add="${esc(key(row))}"`)).join('') ||
          (search ? '<p class="muted">Nenhum produto encontrado neste espaço.</p>' : '');
      }
      if (input.matches('[data-quantity]')) { draft.items.get(input.dataset.quantity).quantity = +input.value; deliveryTotal(); }
      if (input.matches('[data-price]')) { draft.items.get(input.dataset.price).unitCents = Math.round(+input.value * 100); deliveryTotal(); }
      if (form?.matches('[data-delivery-form]')) {
        draft.outletId = form.elements.outletId.value;
        draft.deliveredOn = form.elements.deliveredOn.value;
        draft.notes = form.elements.notes.value;
      }
    });
    host.addEventListener('change', event => {
      const input = event.target;
      if (input.name === 'paymentMode') input.form.querySelector('[data-payment-fields]').hidden = input.value !== 'paid';
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
        const { commission, ...fields } = Object.fromEntries(new FormData(form));
        run(() => register({ ...fields, commissionBps: Math.round(Number(commission) * 100), action: 'outlet', operationId: crypto.randomUUID() }));
      }
      if (form.matches('[data-delivery-form]')) {
        if (!draft.items.size) { setFeedback('Inclua pelo menos um produto.'); return; }
        const { outletId, deliveredOn, notes } = Object.fromEntries(new FormData(form));
        const items = [...draft.items.values()].map(({ productId, variantId, quantity, unitCents }) => ({ productId, variantId, quantity, unitCents }));
        run(() => register({ outletId, deliveredOn, notes, items, action: 'confirm', operationId: crypto.randomUUID() }));
      }
      if (form.matches('[data-review-count]')) {
        if (!countTotals().valid) { setFeedback('Confira as quantidades de todos os produtos.'); return; }
        run(async () => { counting.review = true; if (countTotals().net) await loadAccounts(); });
      }
      if (form.matches('[data-confirm-count]')) {
        const items = [...counting.values].map(([id, v]) => ({id, found:+v.found, returns:+v.returns, loss:+v.loss, damaged:+v.damaged}));
        run(() => register({ action:'conference', operationId:crypto.randomUUID(), outletId:counting.outlet.id,
          fingerprint:counting.fingerprint, items, payment:paymentFrom(form) }));
      }
      if (form.matches('[data-confirm-settlement]')) {
        run(() => register({ action:'settle', operationId:crypto.randomUUID(), conferenceId:receipt.id, payment:paymentFrom(form) }));
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
        if (d.tab || d.stock || d.outletView || d.historyOutlet) {
          tab = d.outletView ? 'outlet' : d.stock ? 'inventory' : d.historyOutlet ? 'history' : d.tab;
          if (d.stock || d.outletView) outletId = d.stock || d.outletView;
          historyOutlet = d.historyOutlet || '';
          if (['history', 'outlet', 'inventory'].includes(tab)) { page = { items: [] }; await loadPage(); }
        }
        if (d.newDelivery) { draft = newDraft(); draft.outletId = d.newDelivery; products = null; tab = 'delivery'; }
        if (d.count) {
          const snapshot = await api('conferenceStock', { outletId: d.count });
          counting = { ...snapshot, review:false, values:new Map(snapshot.items.map(row => [row.id,{found:'',returns:0,loss:0,damaged:0}])) };
          tab = 'conference';
        }
        if ('editCount' in d) counting.review = false;
        if ('startSettlement' in d) { await loadAccounts(); settlement = true; }
        if ('more' in d) await loadPage(true);
        if (d.receipt) await openReceipt(d.receipt);
        if ('preparePdf' in d) {
          const result = await window.ConsignmentPdf.generate(receipt, logoFile, d.preparePdf);
          file = result.file;
          feedback = result.logoUnavailable ? 'PDF pronto. A logo não pôde ser carregada. Selecione uma imagem para incluir.' : 'PDF pronto para baixar ou compartilhar.';
        }
      });
    });
    async function openReceipt(id) {
      const result = await api('receipt', { operationId:id });
      receipt = result.item; currentPayment = result.currentPayment; settlement = false;
      file = null; logoFile = null; tab = 'receipt';
    }
    host.innerHTML = '<p class="consignment-status" role="status">Carregando Consignados…</p>';
    run(async () => {
      pending = readPending();
      dashboard = await api('dashboard');
      if (!pending && query.get('recibo')) await openReceipt(query.get('recibo'));
      else if (!pending && dashboard.enabled && query.has('historico')) { tab = 'history'; await loadPage(); }
    }, true);
  }

  const historyTypes = { delivery:'consignment_delivery', replenishment:'consignment_replenishment',
    conference:'consignment_conference', settlement:'consignment_settlement' };
  let activity = null, daily = null;
  function getContext() {
    const { uid, ...context } = scope();
    return owner() && uid && context.businessId && context.spaceId ? context : null;
  }
  const integrationKey = () => getContext() ? JSON.stringify(scope()) : '';
  async function historyPage({more = false} = {}) {
    const context = getContext(), current = integrationKey();
    if (!current || navigator.onLine === false) return false;
    if (!activity || activity.key !== current) activity = { key:current, rows:[], cursor:null, ready:false, busy:false };
    const view = activity;
    if (view.busy || (!more && view.ready) || more && !view.cursor) return false;
    view.busy = true;
    try {
      const result = (await window.FirebaseCallable('manageConsignment', { ...context, action:'history', cursor:more ? view.cursor : null })).data;
      if (activity !== view || integrationKey() !== current) return false;
      const existing = new Map(view.rows.map(row => [row.id,row]));
      for (const row of result.items) existing.set(row.id,row);
      Object.assign(view,{rows:[...existing.values()],ready:true,cursor:result.cursor});
      return Boolean(result.items.length || more);
    } catch {
      view.ready = true;
      return false;
    } finally { view.busy = false; }
  }
  function historyEvents() {
    if (!activity || activity.key !== integrationKey()) return [];
    return activity.rows.map(row => ({
      id:'consignment:' + row.id, operationId:row.id, resourceId:row.id, resource:'consignments',
      type:historyTypes[row.kind], title:label(row.kind) + ' · ' + row.outlet.name,
      subtitle: row.kind === 'settlement' ? 'Recebimento confirmado' : row.units + ' un.',
      date:row.deliveredOn + 'T12:00:00', value:row.kind === 'conference' ? row.grossCents / 100 : row.totalCents / 100,
      status:'Concluído', statusTone:'success', raw:row,
    }));
  }
  function openRecord(spaceId, id) {
    if (!owner()) return;
    if (spaceId !== scope().spaceId) window.SpaceContext?.selectActive?.(spaceId);
    window.Router.ir('consignados?recibo=' + encodeURIComponent(id));
  }
  function mountHome(root) {
    const context = getContext(), current = integrationKey();
    if (!context || !root) return;
    const todayKey = current + ':' + today();
    if (!daily || daily.key !== todayKey || Date.now()-daily.startedAt > 30000) {
      const promise = window.FirebaseCallable('manageConsignment', { ...context, action:'daily' }).then(response => response.data).catch(() => null);
      daily = { key:todayKey, startedAt:Date.now(), promise };
    }
    daily.promise.then(result => {
      if (integrationKey() !== current || !root.isConnected || !result?.units) return;
      root.innerHTML = `<div><b>Vendas consignadas hoje</b><p class="muted">${result.units} un. vendidas em conferências confirmadas</p></div>
        <strong>${money(result.grossCents)}</strong>`;
      root.hidden = false;
    });
  }
  for (const event of ['firebase-session-cleared','consignment-updated','online']) window.addEventListener(event, () => { activity = null; daily = null; });
  return { entry, shell, mount, owner, openRecord, mountHome, historyPage, historyEvents,
    hasMoreHistory: () => activity?.key === integrationKey() && Boolean(activity.cursor) };
})();
