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
    return `<section class="consignment-page"><div data-consignment-space>${window.SpaceContext?.renderBar?.('sales') || ''}</div><div data-consignment-content></div></section>`;
  }

  function catalog(origin) {
    if (DB.getBusinessId?.() !== origin.businessId || DB.getWorkspaceGeneration?.() !== origin.workspaceGeneration) return [];
    const data = DB.readForView();
    const visible = row => row.ativo !== false && row.active !== false && !row.deleted && !row.deletedAt &&
      (!row.businessId || row.businessId === origin.businessId) &&
      (row.workspaceGeneration == null || row.workspaceGeneration === origin.workspaceGeneration) &&
      (!row.spaceId || row.spaceId === origin.spaceId);
    const variantsByProduct = new Map();
    for (const variant of data.variacoesProdutos || []) {
      if (!visible(variant)) continue;
      if (!variantsByProduct.has(variant.parentProductId)) variantsByProduct.set(variant.parentProductId, []);
      variantsByProduct.get(variant.parentProductId).push(variant);
    }
    const products = window.Repositories?.productRepository?.().list() ?? data.produtos ?? [];
    return products.filter(product => {
      if (!visible(product) || !['all_spaces','selected_spaces','single_space'].includes(product.spaceAccessMode) ||
        product.spaceAccessMode === 'single_space' &&
          (product.defaultSpaceId !== origin.spaceId || product.allowedSpaceIds?.length !== 1 || product.allowedSpaceIds[0] !== origin.spaceId) ||
        ['service', 'recurring'].includes(product.productType) ||
        product.itemKind === 'service' || product.semControleEstoque || product.controlaEstoque === false ||
        product.controlarEstoque === false || !window.SpaceEngine.productAllowsSpace(product, origin.spaceId)) return false;
      try {
        const stockOrigin = window.SpaceContext.stockMovementOrigin(product, origin.spaceId);
        return stockOrigin.businessId === origin.businessId && stockOrigin.spaceId === origin.spaceId;
      } catch { return false; }
    }).map(product => {
      const variable = product.productType === 'variable';
      const variants = variable ? variantsByProduct.get(product.id) || [] : [];
      const items = (variable ? variants : [product]).map(row => ({
        productId: product.id, variantId: variable ? row.id : null, name: product.nome,
        variantName: variable ? (window.ProductVariations?.displayName?.(row) || row.displayName || row.name) : '',
        imageUrl: row.imageThumbUrl || row.imageUrl || row.imagem || product.imageThumbUrl || product.imageUrl || product.imagem,
        unitCents: Math.round(Number(variable ? row.price ?? product.preco : product.preco) * 100),
        sku: row.sku || row.codigo || row.codigoInterno || '',
        available: Math.max(0, Number(variable ? row.stock : product.estoqueAtual ?? product.estoque) - Number(row.onlineReservedStock || 0)),
        search: normalize([row.name, row.displayName, row.sku, row.codigo, row.codigoInterno, row.barcode,
          ...(row.alternateBarcodes || []), ...Object.values(row.attributeValues || {})].join(' ')),
      }));
      return { product, variable, variants, items, search: normalize([product.nome, product.categoria,
        product.marca, product.codigo, product.codigoInterno, product.sku, product.barcode,
        ...(product.alternateBarcodes || []), product.palavrasChave, ...(variants.length ? [] : product.variationSearchTokens || []), ...items.map(row => row.search)].join(' ')) };
    });
  }

  const historyLink = (title, outlet = '') => `<a class="btn btn-light" href="#/historico?consignados=1${outlet ? '&amp;ponto=' + encodeURIComponent(outlet) : ''}">${icon('history')} ${title}</a>`;
  let refreshCatalog;

  function mount(container) {
    const host = container.querySelector('[data-consignment-content]');
    if (!host) return;
    refreshCatalog = null;
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
    let outletSearch = '', currentPayment = null, counting = null, paymentAccounts = [], settlement = false;
    let productSearch = '', category = '', filter = '', variantProductId = '', bag = false, logoFile;
    let catalogLimit = 48;
    const deliveryMode = () => tab === 'delivery' && !pending;
    const wide = matchMedia('(min-width: 768px)');
    const query = new URLSearchParams(location.hash.split('?')[1] || '');
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
      const summary = [['store', 'Pontos de venda', dashboard.outlets.length], ['package-open', 'Unidades consignadas', dashboard.units],
        ['tags', 'Valor em consignação', money(dashboard.stockValueCents || 0)], ['wallet', 'A receber', money(dashboard.pendingCents || 0)]];
      return `<div class="consignment-stats">${summary.map(([glyph, name, value]) => `<section class="panel"><span class="consignment-stat-icon">${icon(glyph)}</span><div><small>${name}</small><strong>${value}</strong></div></section>`).join('')}</div>
        <div class="consignment-toolbar"><label aria-label="Buscar estabelecimento">${icon('search')} <input type="search" data-outlet-search placeholder="Buscar loja" value="${esc(outletSearch)}"></label>
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
      const outlet = dashboard.outlets.find(row => row.id === draft.outletId);
      const space = window.SpaceContext.list?.().find(row => row.id === origin.spaceId);
      return `<section class="consignment-flow">
        <header class="consignment-heading">${button(icon('arrow-left'), 'data-delivery-back aria-label="Voltar"')}
          <div><h2>${bag ? 'Sacola da entrega' : 'Nova entrega'} · ${esc(outlet?.name)}</h2><p>${icon('map-pin')} ${esc(space?.name || 'Espaço ativo')}</p></div>
        </header>
        ${bag ? `<section class="panel consignment-panel consignment-bag-panel"><form data-delivery-form>
          <div data-delivery-items></div>
          <div class="consignment-fields consignment-delivery-fields"><label>Data da entrega <input name="deliveredOn" type="date" value="${esc(draft.deliveredOn)}" max="${today()}" required></label>
          <label>Observações <textarea name="notes" maxlength="500" rows="2">${esc(draft.notes)}</textarea></label></div>
          <div class="consignment-summary" aria-live="polite">
            <div><span>Total de peças</span><strong data-delivery-units></strong></div>
            <div><span>Valor total</span><strong data-delivery-total></strong></div>
          </div>
          <button class="btn btn-primary" type="submit" ${draft.items.size ? '' : 'disabled'}>${icon('check')} Confirmar entrega e gerar PDF</button></form></section>` : `
          <div class="consignment-catalog-tools">
            <label class="consignment-search" aria-label="Buscar produto">${icon('search')}<input type="search" data-product-search placeholder="Buscar produto, variação ou código" autocomplete="off" value="${esc(productSearch)}"></label>
            <select data-delivery-category aria-label="Categoria"></select>
            <select data-delivery-filter aria-label="Filtrar produtos">
              ${[['', 'Todos'], ['favorite', 'Favoritos'], ['stock', 'Em estoque'], ['low', 'Estoque baixo']].map(([value, title]) =>
                `<option value="${value}" ${filter === value ? 'selected' : ''}>${title}</option>`).join('')}
            </select>
          </div>
          <div class="mobile-sale-page consignment-catalog"><section data-delivery-grid aria-label="Produtos"></section></div>
          <div data-delivery-more></div>
          <button class="btn btn-primary consignment-bag" type="button" data-open-delivery-bag>${icon('shopping-bag')} Sacola <b data-bag-count></b></button>
          <dialog class="consignment-variants" data-delivery-variants aria-labelledby="consignment-variant-title"></dialog>`}
      </section>`;
    }

    function list(kind) {
      const rows = page.items.map(row =>
        `<div class="consignment-row"><div class="consignment-product">${photo(row)}<div><b>${itemName(row)}</b><small>${money(row.unitCents)} por unidade</small></div></div><strong>${row.quantity} un.</strong></div>`);
      return `<section class="panel consignment-panel"><h3>Estoque no estabelecimento</h3>
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
        const gateway = window.FinancialSpaceService || (await import('./firebase/financial-space-service.js?v=240')).FinancialSpaceService;
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
        ${historyLink('Histórico do ponto', row.id)}</div></section>${list('outlet')}`;
    }
    const deliveryReceipt = () => ['delivery', 'replenishment'].includes(receipt?.kind);

    function deliveryReceiptView() {
      const hasStock = Array.isArray(receipt.stockAfter);
      const readyDocument = file ? (file.name.startsWith('consignado-stock-') ? 'Estoque atualizado' : 'Comprovante da entrega') : '';
      return `<section class="panel consignment-panel consignment-confirmation" data-delivery-confirmation>
        <header class="sale-completion-head">
          <span class="sale-success-icon">${icon('check')}</span>
          <div><h3>${receipt.kind === 'replenishment' ? 'Reposição registrada' : 'Entrega registrada'}</h3><p>${esc(receipt.outlet.name)} · ${date(receipt.deliveredOn)}</p></div>
        </header>
        <div class="consignment-summary">
          <div><span>Peças entregues</span><strong>${receipt.units}</strong></div>
          <div><span>Valor consignado</span><strong>${money(receipt.totalCents)}</strong></div>
        </div>
        <div class="consignment-confirmation-actions">
          ${hasStock ? button(icon('package-check') + ' Gerar PDF do estoque atualizado', 'data-prepare-pdf="stock"', true) : ''}
          ${readyDocument ? `<p class="muted">PDF pronto · ${readyDocument}</p>` : ''}
          ${file ? `<div class="consignment-pdf-actions">${button(icon('download') + ' Baixar PDF', 'data-download')}${button(icon('share-2') + ' Compartilhar PDF', 'data-share')}</div>`
            : button(icon('file-text') + ' Gerar PDF da entrega', 'data-prepare-pdf="delivery"', !hasStock)}
          ${button(icon('arrow-left') + ' Voltar aos consignados', 'data-tab="home"')}
        </div>
        <details><summary>Itens da entrega</summary>
          ${(receipt.items || []).map(row => `<div class="consignment-row"><div><b>${itemName(row)}</b><small>${row.quantity} un. · saldo no ponto ${row.outletBefore} → ${row.outletAfter}</small></div><strong>${money(row.totalCents)}</strong></div>`).join('')}
        </details>
        <details><summary>Opções do comprovante</summary>
          <label>Logo para o PDF (opcional) <input type="file" data-pdf-logo accept="image/png,image/jpeg,image/webp"></label>
          ${button('Gerar PDF da entrega', 'data-prepare-pdf="delivery"')}
        </details>
      </section>`;
    }

    function receiptView() {
      if (deliveryReceipt()) return deliveryReceiptView();
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
      const submit = items.closest('form').querySelector('[type="submit"]');
      submit.disabled = !draft.items.size;
      items.innerHTML = [...draft.items.values()].map(row => `<article class="consignment-bag-item">
        <div class="consignment-product">${photo(row)}<div><b>${itemName(row)}</b>
          <small>${Math.max(0, row.available || 0)} un. disponíveis na última leitura</small></div></div>
        <label>Qtd. <input type="number" inputmode="numeric" min="1" max="100000" required data-quantity="${esc(key(row))}" value="${row.quantity}"></label>
        <label>Preço unitário <input type="number" inputmode="decimal" min="0" max="1000000" step="0.01" required data-price="${esc(key(row))}" value="${row.unitCents / 100}"></label>
        ${button(icon('trash-2'), `data-remove="${esc(key(row))}" aria-label="Remover ${esc(row.variantName ? row.name + ' ' + row.variantName : row.name)}"`)}</article>`)
        .join('') || '<p class="muted">A sacola está vazia.</p>';
      deliveryTotal();
    }
    function deliveryTotal() {
      const total = host.querySelector('[data-delivery-total]');
      if (!total) return;
      const rows = [...draft.items.values()];
      host.querySelector('[data-delivery-units]').textContent = rows.reduce((sum, row) => sum + row.quantity, 0);
      total.textContent = money(rows.reduce((sum, row) => sum + row.quantity * row.unitCents, 0));
    }

    function renderCatalog() {
      const grid = host.querySelector('[data-delivery-grid]');
      if (!grid) return;
      const select = host.querySelector('[data-delivery-category]');
      const categories = [...new Set(products.map(row => row.product.categoria).filter(Boolean))].sort((a,b) => a.localeCompare(b, 'pt-BR'));
      if (!categories.includes(category)) category = '';
      select.innerHTML = '<option value="">Categorias</option>' + categories.map(name =>
        `<option value="${esc(name)}">${esc(name)}</option>`).join('');
      select.value = category;
      const search = normalize(productSearch).split(/\s+/).filter(Boolean);
      const rows = products.filter(row => (!category || row.product.categoria === category) &&
        (filter !== 'favorite' || favorite(row.product)) &&
        (filter !== 'stock' || row.items.some(item => item.available > 0)) &&
        (filter !== 'low' || window.getProductStockStatus?.(row.product) === 'baixo' && row.items.some(item => item.available > 0)) &&
        search.every(token => row.search.includes(token)));
      grid.className = wide.matches ? 'desktop-sales-product-grid' : 'pos-grid';
      grid.innerHTML = rows.slice(0, catalogLimit).map(({product, variants, variable, items}) => {
        const model = { ...product, favorito: favorite(product) };
        if (variable && variants.length) {
          const prices = items.map(item => item.unitCents / 100);
          model.activeVariationCount = items.length;
          model.minPrice = Math.min(...prices);
          model.maxPrice = Math.max(...prices);
          model.totalStock = items.reduce((sum, item) => sum + item.available, 0);
          model.hasAvailableStock = model.totalStock > 0;
        }
        const renderer = wide.matches ? window.DesktopSales.catalogCard : window.Checkout.catalogCard;
        return renderer(model, { consignment:true, variants });
      }).join('') || '<p class="muted">Nenhum produto encontrado neste espaço.</p>';
      if (!wide.matches) {
        const ids = new Map(rows.map(row => [row.product.id, row.product]));
        for (const card of grid.children) {
          const id = card.dataset.deliveryProduct;
          if (!id) continue;
          const active = favorite(ids.get(id));
          card.insertAdjacentHTML('beforeend', `<button class="mobile-sale-favorite mobile-card-favorite ${active ? 'active' : ''}" type="button"
            data-delivery-favorite="${esc(id)}" aria-label="${active ? 'Remover dos' : 'Adicionar aos'} favoritos" aria-pressed="${active}">${icon('star')}</button>`);
        }
      }
      host.querySelector('[data-delivery-more]').innerHTML = rows.length > catalogLimit ? button('Mostrar mais produtos', 'data-delivery-more-button') : '';
      paintBagCount();
      window.lucide?.createIcons();
    }

    const favorite = product => window.Produtos?.mobileFavoriteValue?.(product) ?? Boolean(product.favorito);
    function paintBagCount() {
      const quantities = new Map();
      for (const item of draft.items.values()) quantities.set(item.productId, (quantities.get(item.productId) || 0) + item.quantity);
      for (const badge of host.querySelectorAll('[data-delivery-qty]')) {
        const qty = quantities.get(badge.dataset.deliveryQty) || 0;
        badge.textContent = qty;
        badge.hidden = !qty;
      }
      const count = host.querySelector('[data-bag-count]');
      if (count) count.textContent = [...quantities.values()].reduce((sum, qty) => sum + qty, 0);
    }

    function addItem(item, quantity = 1) {
      const id = key(item), previous = draft.items.get(id);
      const live = products.find(row => row.product.id === item.productId)?.items.find(row => key(row) === id);
      const total = (previous?.quantity || 0) + quantity;
      if (!Number.isSafeInteger(quantity) || quantity < 1 || !live || total > live.available || total > 100000) {
        setFeedback('Quantidade indisponível na última leitura deste espaço.');
        return false;
      }
      if (!previous && draft.items.size >= 40) { setFeedback('Inclua até 40 produtos por entrega.'); return false; }
      draft.items.set(id, { ...live, unitCents: previous?.unitCents ?? live.unitCents, quantity: total });
      setFeedback('');
      paintBagCount();
      return true;
    }

    function showVariants(row) {
      const picker = host.querySelector('[data-delivery-variants]');
      if (!picker) return;
      if (!row) { if (picker.open) picker.close(); return; }
      picker.innerHTML = `<header><h3 id="consignment-variant-title">${esc(row.product.nome)}</h3>
        ${button(icon('x'), 'data-close-variants aria-label="Fechar variações"')}</header>
        ${row.items.map(item => `<div class="consignment-row"><div class="consignment-product">${photo(item)}<div><b>${esc(item.variantName)}</b>
          <small>${item.sku ? esc(item.sku) + ' · ' : ''}${money(item.unitCents)} · ${item.available} un.</small></div></div>
          <label>Qtd. <input type="number" inputmode="numeric" min="1" max="${item.available}" value="1" data-variant-quantity></label>
          ${button(icon('plus'), `data-add-variant="${esc(key(item))}" aria-label="Adicionar ${esc(item.variantName)}" ${item.available > 0 ? '' : 'disabled'}`)}</div>`)
          .join('') || '<p class="muted">Nenhuma variação disponível neste espaço.</p>'}`;
      if (!picker.open) picker.showModal();
      window.lucide?.createIcons();
    }

    function refreshDeliveryCatalog() {
      if (!running() || !deliveryMode() || bag) return;
      products = catalog(origin);
      renderCatalog();
      const picker = host.querySelector('[data-delivery-variants][open]');
      if (picker && !products.some(row => row.product.id === variantProductId)) picker.close();
    }
    refreshCatalog = () => {
      if (!running()) { refreshCatalog = null; return; }
      refreshDeliveryCatalog();
    };

    function paint() {
      if (!running()) return;
      container.querySelector('[data-consignment-space]').hidden = deliveryMode();
      const message = `<p class="consignment-status" role="status">${esc(feedback)}</p>`;
      if (pending) {
        host.innerHTML = message + `<section class="panel consignment-panel"><h3>Operação ainda sem confirmação</h3>
          <p>Confira a tentativa original. O mesmo identificador será reutilizado.</p>${button('Conferir e concluir', 'data-resume', true)}</section>`;
      } else if (!dashboard && tab !== 'receipt') {
        host.innerHTML = message + button('Carregar painel', 'data-refresh');
      } else if (!dashboard?.enabled && tab !== 'receipt') {
        host.innerHTML = message + `<section class="panel consignment-panel"><h3>Ativar Consignados neste espaço</h3><p>Controle o estoque enviado a pontos de venda parceiros.</p>${button('Ativar módulo', 'data-enable', true)}</section>`;
      } else {
        const contents = { home, outlets, delivery, outlet: outletView, conference, inventory: () => list('inventory'), receipt: receiptView };
        const completedDelivery = tab === 'receipt' && deliveryReceipt();
        const nav = deliveryMode() || completedDelivery ? '' : `<nav class="consignment-tabs" aria-label="Consignados">
          ${tab === 'home' ? historyLink('Histórico') : button('Voltar aos consignados', 'data-tab="home"')}</nav>`;
        host.innerHTML = nav + (completedDelivery ? '' : message) + contents[tab]() + (query.has('config') && dashboard?.enabled && !deliveryMode()
          ? button('Desativar neste espaço', 'data-disable') : '');
      }
      renderItems();
      if (deliveryMode() && !bag) refreshDeliveryCatalog();
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
      feedback = payload.action === 'confirm' ? '' :
        result.item ? label(result.item.kind) + ' registrada.' : 'Ponto de venda cadastrado.';
      if (payload.action === 'confirm') await prepareDeliveryPdf();
      if (result.item) {
        try { dashboard = await api('dashboard'); }
        catch { feedback += ' O painel será atualizado ao voltar.'; }
      } else dashboard = await api('dashboard');
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
          tab = 'receipt';
          feedback = 'Operação já registrada. Comprovante recuperado.';
          try { dashboard = await api('dashboard'); }
          catch { feedback += ' O painel será atualizado ao voltar.'; }
          if (['delivery','replenishment'].includes(receipt.kind)) await prepareDeliveryPdf();
          return;
        }
      }
      await register(pending);
    }

    async function loadPage(append = false) {
      if (tab === 'inventory' && !outletId) { page = { items: [] }; return; }
      const action = tab === 'outlet' ? 'inventory' : tab;
      const next = await api(action, { outletId, cursor: append ? page.cursor : null });
      page = { ...next, items: append ? [...page.items, ...next.items] : next.items };
    }

    async function run(task, reRenderOnError = false) {
      if (busy) return;
      busy = true;
      setFeedback('Carregando…');
      const disabled = [...host.querySelectorAll('button:enabled')];
      for (const child of disabled) child.disabled = true;
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
        for (const child of disabled) if (child.isConnected) child.disabled = false;
      }
    }

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
        productSearch = input.value;
        catalogLimit = 48;
        renderCatalog();
      }
      if (input.matches('[data-quantity]')) { draft.items.get(input.dataset.quantity).quantity = +input.value; deliveryTotal(); }
      if (input.matches('[data-price]')) { draft.items.get(input.dataset.price).unitCents = Math.round(+input.value * 100); deliveryTotal(); }
      if (form?.matches('[data-delivery-form]')) {
        draft.deliveredOn = form.elements.deliveredOn.value;
        draft.notes = form.elements.notes.value;
      }
    });
    host.addEventListener('change', event => {
      const input = event.target;
      if (input.matches('[data-delivery-filter],[data-delivery-category]')) {
        if (input.matches('[data-delivery-filter]')) filter = input.value;
        else category = input.value;
        catalogLimit = 48;
        renderCatalog();
      }
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
        host.querySelector('.consignment-confirmation-actions > p.muted')?.remove();
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
        const { outletId } = draft;
        const { deliveredOn, notes } = Object.fromEntries(new FormData(form));
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
      if (busy || !running()) return;
      const d = target?.dataset || {};
      if ('deliveryFavorite' in d) {
        window.Produtos?.toggleMobileFavorite?.(d.deliveryFavorite);
        return;
      }
      const card = event.target.closest('[data-delivery-product]');
      if (card && !target?.disabled) {
        const row = products.find(item => item.product.id === card.dataset.deliveryProduct);
        if (!row) return;
        if (!row.variable) { addItem(row.items[0]); return; }
        variantProductId = row.product.id;
        if (row.items.length) showVariants(row);
        else run(() => window.ProductVariations?.ensure?.(row.product.id)).then(() => {
          if (running() && deliveryMode() && !bag) showVariants(products.find(item => item.product.id === variantProductId));
        });
        return;
      }
      if (!target || target.type === 'submit') return;
      if ('deliveryMoreButton' in d) { catalogLimit += 48; renderCatalog(); return; }
      if ('closeVariants' in d) { host.querySelector('[data-delivery-variants]').close(); return; }
      if (d.addVariant) {
        const item = products.find(row => row.product.id === variantProductId)?.items.find(row => key(row) === d.addVariant);
        const quantity = target.closest('.consignment-row').querySelector('[data-variant-quantity]');
        if (item && quantity.reportValidity() && addItem(item, quantity.valueAsNumber))
          host.querySelector('[data-delivery-variants]').close();
        return;
      }
      if ('openDeliveryBag' in d) { bag = true; paint(); return; }
      if ('deliveryBack' in d) {
        if (bag) bag = false;
        else tab = 'home';
        paint();
        return;
      }
      if (d.remove) { draft.items.delete(d.remove); renderItems(); window.lucide?.createIcons(); return; }
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
        if ('refresh' in d || (d.tab === 'home' && tab === 'receipt')) dashboard = await api('dashboard');
        if ('enable' in d) { await api('enable'); dashboard = await api('dashboard'); }
        if ('disable' in d && window.confirm('Desativar Consignados neste espaço? As entregas e os saldos serão preservados.')) {
          await api('disable'); dashboard = await api('dashboard'); tab = 'home';
        }
        if ('resume' in d) await resume();
        if (d.tab || d.stock || d.outletView) {
          tab = d.outletView ? 'outlet' : d.stock ? 'inventory' : d.tab;
          if (d.stock || d.outletView) outletId = d.stock || d.outletView;
          if (['outlet', 'inventory'].includes(tab)) { page = { items: [] }; await loadPage(); }
        }
        if (d.newDelivery) {
          draft = newDraft();
          draft.outletId = d.newDelivery;
          logoFile = null;
          bag = false; productSearch = ''; category = ''; filter = ''; catalogLimit = 48;
          tab = 'delivery';
        }
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
          const result = await window.ConsignmentPdf.generate(receipt, logoFile, d.preparePdf, BusinessContext.get().business?.name);
          file = result.file;
          feedback = result.logoUnavailable ? 'A logo não pôde ser carregada. Selecione uma imagem para incluir.' :
            deliveryReceipt() ? '' : 'PDF pronto para baixar ou compartilhar.';
        }
      });
    });
    async function prepareDeliveryPdf() {
      try {
        const result = await window.ConsignmentPdf.generate(receipt, logoFile, 'delivery', BusinessContext.get().business?.name);
        file = result.file;
        if (result.logoUnavailable) feedback = [feedback, 'Para incluir a logo, selecione uma imagem e gere o PDF novamente.'].filter(Boolean).join(' ');
      } catch {
        feedback = [feedback, 'Tente gerar o PDF novamente no comprovante.'].filter(Boolean).join(' ');
      }
    }
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
      else if (!pending && dashboard.enabled && query.has('historico')) window.Router.ir('historico?consignados=1');
    }, true);
  }

  const historyTypes = { delivery:'consignment_delivery', replenishment:'consignment_replenishment',
    conference:'consignment_conference', settlement:'consignment_settlement' };
  let activity = null, daily = null;
  function getContext() {
    const { uid, ...context } = scope();
    return owner() && uid && context.businessId && context.spaceId ? context : null;
  }
  const historyOutletId = () => {
    const params = new URLSearchParams(location.hash.split('?')[1] || '');
    return params.has('consignados') ? params.get('ponto') || '' : '';
  };
  const integrationKey = () => getContext() ? JSON.stringify(scope()) : '';
  const historyKey = () => integrationKey() && JSON.stringify([scope(), historyOutletId()]);
  async function historyPage({more = false} = {}) {
    const context = getContext(), current = historyKey(), outletId = historyOutletId();
    if (!current || navigator.onLine === false) return false;
    if (!activity || activity.key !== current) activity = { key:current, rows:[], cursor:null, ready:false, busy:false };
    const view = activity;
    if (view.busy || (!more && view.ready) || more && !view.cursor) return false;
    view.busy = true;
    try {
      const result = (await window.FirebaseCallable('manageConsignment', { ...context, action:'history', outletId, cursor:more ? view.cursor : null })).data;
      if (activity !== view || historyKey() !== current) return false;
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
    if (!activity || activity.key !== historyKey()) return [];
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
  window.addEventListener('hashchange', () => { if (window.Router?.atual?.() !== 'consignados') refreshCatalog = null; });
  window.addEventListener('cloud-data-updated', event => {
    const collection = event.detail?.collection;
    if (!collection || ['products','productVariants'].includes(collection)) refreshCatalog?.();
  });
  window.addEventListener('mobile-product-favorites-updated', () => refreshCatalog?.());
  matchMedia('(min-width: 768px)').addEventListener('change', () => refreshCatalog?.());
  return { entry, shell, mount, owner, openRecord, mountHome, historyPage, historyEvents,
    hasMoreHistory: () => activity?.key === historyKey() && Boolean(activity.cursor) };
})();
