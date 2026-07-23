(function () {
  'use strict';

  if (!window.CampanhasUI || !window.Campanhas) return;

  const desktop = { ...window.CampanhasUI };
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const isMobile = () => matchMedia('(max-width: 767px)').matches;
  const icon = name => `<i data-lucide="${name}"></i>`;
  const esc = value => String(value ?? '').replace(/[&<>'"]/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'
  }[char]));
  const formatDate = value => value
    ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString('pt-BR')
    : 'Sem limite';
  const today = () => new Date().toISOString().slice(0, 10);

  const state = {
    filter: 'all',
    query: '',
    detailId: null,
    menuId: null,
    wizard: null
  };

  const typeDescriptions = {
    buy_get: 'O cliente ganha um prêmio ao atingir uma quantidade.',
    points: 'Cada compra acumula pontos para trocar por prêmios.',
    quantity_discount: 'Desconto progressivo conforme a quantidade comprada.',
    nth_product: 'Prêmio ao completar um número de compras.',
    combo: 'Preço especial combinando dois produtos.',
    custom: 'Crie regras personalizadas do seu jeito.'
  };

  function typeInfo(campaign) {
    return Campanhas.TYPES[campaign.type] || Campanhas.TYPES.custom;
  }

  function statusInfo(campaign) {
    return {
      ativa: { label: 'Ativa', className: 'active' },
      agendada: { label: 'Agendada', className: 'scheduled' },
      pausada: { label: 'Pausada', className: 'paused' },
      encerrada: { label: 'Encerrada', className: 'ended' }
    }[Campanhas.status(campaign)];
  }

  function cover(campaign, className = '') {
    const info = typeInfo(campaign);
    return `<div class="mobile-campaign-cover type-${campaign.type} ${className}">
      ${campaign.imageUrl
        ? `<img src="${esc(campaign.imageUrl)}" alt="">`
        : `${icon(campaign.imageIcon || info.icon)}<span>${esc(info.label)}</span>`}
    </div>`;
  }

  function counts(campaigns) {
    return {
      all: campaigns.length,
      ativa: campaigns.filter(item => Campanhas.status(item) === 'ativa').length,
      agendada: campaigns.filter(item => Campanhas.status(item) === 'agendada').length,
      encerrada: campaigns.filter(item => Campanhas.status(item) === 'encerrada').length
    };
  }

  function filteredCampaigns() {
    const query = state.query.trim().toLocaleLowerCase('pt-BR');
    return Campanhas.listar()
      .filter(item => state.filter === 'all' || Campanhas.status(item) === state.filter)
      .filter(item => !query || `${item.name} ${item.description} ${typeInfo(item).label}`
        .toLocaleLowerCase('pt-BR').includes(query));
  }

  function metrics() {
    const value = Campanhas.metricas();
    return `<section class="mobile-campaign-metrics" aria-label="Indicadores de campanhas">
      <article><span>${icon('megaphone')}</span><div><b>${value.active}</b><small>Ativas</small></div></article>
      <article><span>${icon('users')}</span><div><b>${value.participants}</b><small>Participantes</small></div></article>
      <article><span>${icon('gift')}</span><div><b>${value.redemptions}</b><small>Resgates</small></div></article>
      <article><span>${icon('chart-no-axes-combined')}</span><div><b>${value.conversion.toFixed(1)}%</b><small>Taxa de conv.</small></div></article>
    </section>`;
  }

  function menu(campaign) {
    const paused = Campanhas.status(campaign) === 'pausada';
    return `<div class="mobile-campaign-menu" role="menu">
      <button data-mobile-campaign-edit="${campaign.id}">${icon('pencil')} Editar</button>
      <button data-mobile-campaign-duplicate="${campaign.id}">${icon('copy')} Duplicar</button>
      <button data-mobile-campaign-status="${campaign.id}" data-status="${paused ? 'ativa' : 'pausada'}">
        ${icon(paused ? 'play' : 'pause')} ${paused ? 'Reativar' : 'Pausar'}
      </button>
      <button data-mobile-campaign-status="${campaign.id}" data-status="encerrada">${icon('circle-stop')} Encerrar</button>
      <button class="danger" data-mobile-campaign-delete="${campaign.id}">${icon('trash-2')} Excluir</button>
    </div>`;
  }

  function campaignCard(campaign) {
    const type = typeInfo(campaign);
    const status = statusInfo(campaign);
    const participants = Number(campaign.participantsCount || 0);
    const redemptions = Number(campaign.redemptionsCount || 0);
    const rate = participants ? redemptions / participants * 100 : 0;
    return `<article class="mobile-campaign-card" data-mobile-campaign-details="${campaign.id}" tabindex="0" role="button" aria-label="Ver campanha ${esc(campaign.name)}">
      <div class="mobile-campaign-card-top">
        ${cover(campaign)}
        <div class="mobile-campaign-card-copy">
          <h3>${esc(campaign.name)}</h3>
          <span class="mobile-campaign-type type-${campaign.type}">${esc(type.label)}</span>
          <p>${icon('calendar-days')} ${formatDate(campaign.startDate)} até ${formatDate(campaign.endDate)}</p>
        </div>
        <span class="campaign-status ${status.className}">${status.label}</span>
        <button class="mobile-campaign-more" data-mobile-campaign-menu="${campaign.id}" aria-label="Mais ações">${icon('ellipsis-vertical')}</button>
      </div>
      <div class="mobile-campaign-card-stats">
        <span>${icon('users')}<b>${participants}</b><small>Participantes</small></span>
        <span>${icon('gift')}<b>${redemptions}</b><small>Resgates</small></span>
        <span>${icon('chart-no-axes-combined')}<b>${rate.toFixed(1)}%</b><small>Taxa de resgate</small></span>
        ${icon('chevron-right')}
      </div>
      ${state.menuId === campaign.id ? menu(campaign) : ''}
    </article>`;
  }

  function listPage() {
    const campaigns = Campanhas.listar();
    const totals = counts(campaigns);
    const list = filteredCampaigns();
    return `<section class="mobile-campaigns-page">
      ${metrics()}
      <div class="mobile-campaign-search-row">
        <label class="mobile-campaign-search">${icon('search')}
          <input data-mobile-campaign-search value="${esc(state.query)}" placeholder="Buscar campanha..." aria-label="Buscar campanha">
          ${state.query ? `<button type="button" data-clear-campaign-search aria-label="Limpar busca">${icon('x')}</button>` : ''}
        </label>
        <button class="mobile-campaign-filter-button" data-mobile-campaign-filters aria-label="Abrir filtros">${icon('list-filter')}<span>Filtros</span></button>
      </div>
      <nav class="mobile-campaign-chips" aria-label="Filtros rápidos">
        ${[
          ['all', 'Todas'], ['ativa', 'Ativas'], ['agendada', 'Agendadas'], ['encerrada', 'Encerradas']
        ].map(([key, label]) => `<button class="${state.filter === key ? 'active' : ''}" data-mobile-campaign-filter="${key}">
          ${label}<b>${totals[key]}</b>
        </button>`).join('')}
      </nav>
      <div class="mobile-campaign-list">
        ${list.length
          ? list.map(campaignCard).join('')
          : `<div class="mobile-campaign-empty">${icon('party-popper')}<h3>Nenhuma campanha encontrada</h3><p>Tente outro filtro ou use o botão + para criar uma campanha.</p></div>`}
      </div>
      <button class="mobile-campaign-fab" data-mobile-new-campaign aria-label="Nova campanha">${icon('plus')}</button>
    </section>`;
  }

  function detailPage(campaign) {
    const status = statusInfo(campaign);
    const type = typeInfo(campaign);
    const participants = Number(campaign.participantsCount || 0);
    const redemptions = Number(campaign.redemptionsCount || 0);
    return `<section class="mobile-campaign-detail">
      <header>
        <button data-mobile-campaign-back aria-label="Voltar">${icon('arrow-left')}</button>
        <h2>Campanha</h2>
        <button data-mobile-campaign-menu="${campaign.id}" aria-label="Mais ações">${icon('ellipsis-vertical')}</button>
        ${state.menuId === campaign.id ? menu(campaign) : ''}
      </header>
      ${cover(campaign, 'detail')}
      <div class="mobile-campaign-detail-title">
        <div><h2>${esc(campaign.name)}</h2><p>${esc(campaign.description || type.label)}</p></div>
        <span class="campaign-status ${status.className}">${status.label}</span>
      </div>
      <dl>
        <div><dt>Tipo</dt><dd>${esc(type.label)}</dd></div>
        <div><dt>Período</dt><dd>${formatDate(campaign.startDate)} até ${formatDate(campaign.endDate)}</dd></div>
        <div><dt>Participantes</dt><dd>${participants}</dd></div>
        <div><dt>Resgates</dt><dd>${redemptions}</dd></div>
        <div><dt>Taxa de resgate</dt><dd>${participants ? (redemptions / participants * 100).toFixed(1) : '0,0'}%</dd></div>
      </dl>
      <div class="mobile-campaign-detail-actions">
        <button data-mobile-campaign-edit="${campaign.id}">${icon('pencil')} Editar campanha</button>
        <button data-mobile-campaign-duplicate="${campaign.id}">${icon('copy')} Duplicar campanha</button>
      </div>
    </section>`;
  }

  function mobileRender() {
    if (state.detailId) {
      const campaign = Campanhas.obter(state.detailId);
      if (campaign) return detailPage(campaign);
      state.detailId = null;
    }
    return listPage();
  }

  function refresh(options = {}) {
    if (!isMobile()) return desktop.refresh();
    const app = $('#app');
    if (!app) return;
    const scrollY = window.scrollY;
    app.innerHTML = mobileRender();
    bindMobile();
    window.lucide?.createIcons();
    if (options.preserveScroll) window.scrollTo(0, scrollY);
    else window.scrollTo({ top: 0, behavior: 'smooth' });
    if (options.focusSearch) {
      requestAnimationFrame(() => {
        const input = $('[data-mobile-campaign-search]');
        if (!input) return;
        input.focus({ preventScroll: true });
        input.setSelectionRange(input.value.length, input.value.length);
      });
    }
  }

  function openFilters() {
    const root = $('#modal');
    root.innerHTML = `<div class="modal-bg mobile-campaign-sheet-bg">
      <section class="mobile-campaign-filter-sheet" role="dialog" aria-modal="true" aria-labelledby="campaign-filter-title">
        <div class="mobile-sheet-handle"></div>
        <header><h3 id="campaign-filter-title">Filtrar campanhas</h3><button data-close-campaign-filter aria-label="Fechar">${icon('x')}</button></header>
        <div class="mobile-campaign-filter-options">
          ${[
            ['all', 'Todas as campanhas'], ['ativa', 'Campanhas ativas'], ['agendada', 'Campanhas agendadas'], ['encerrada', 'Campanhas encerradas']
          ].map(([key, label]) => `<label><input type="radio" name="campaignStatusFilter" value="${key}" ${state.filter === key ? 'checked' : ''}><span>${label}</span></label>`).join('')}
        </div>
        <footer><button class="btn btn-light" data-clear-campaign-filter>Limpar</button><button class="btn btn-primary" data-apply-campaign-filter>Aplicar filtro</button></footer>
      </section>
    </div>`;
    $('[data-close-campaign-filter]', root).onclick = Modais.fechar;
    $('[data-clear-campaign-filter]', root).onclick = () => {
      state.filter = 'all';
      Modais.fechar();
      refresh();
    };
    $('[data-apply-campaign-filter]', root).onclick = () => {
      state.filter = $('[name="campaignStatusFilter"]:checked', root)?.value || 'all';
      Modais.fechar();
      refresh();
    };
    window.lucide?.createIcons();
  }

  function productOptions(selected = '') {
    return `<option value="">Selecione um produto</option>${Produtos.listar()
      .filter(product => product.ativo !== false)
      .map(product => `<option value="${product.id}" ${selected === product.id ? 'selected' : ''}>${esc(product.nome)}</option>`)
      .join('')}`;
  }

  function stepType(data) {
    return `<div class="mobile-wizard-pane">
      <h2>Escolha o tipo de campanha</h2>
      <p>Selecione o formato que melhor se encaixa no seu objetivo.</p>
      <div class="mobile-campaign-type-grid">
        ${Object.entries(Campanhas.TYPES).map(([key, info]) => `<button type="button" class="${data.type === key ? 'active' : ''}" data-mobile-wizard-type="${key}">
          <span class="type-${key}">${icon(info.icon)}</span>
          <b>${esc(info.label)}</b>
          <small>${esc(typeDescriptions[key])}</small>
        </button>`).join('')}
      </div>
    </div>`;
  }

  function ruleFields(data) {
    const rules = data.rules || {};
    const product = data.productIds?.[0] || '';
    const productField = `<label class="full">Produto relacionado<select name="productId">${productOptions(product)}</select></label>`;
    if (data.type === 'buy_get') return `${productField}
      <div class="mobile-visual-rule">
        <label><span>Compre</span><input inputmode="numeric" type="number" min="1" name="requiredQuantity" value="${rules.requiredQuantity || 5}"><small>quantidade necessária</small></label>
        ${icon('arrow-right')}
        <label><span>Ganhe</span><input inputmode="numeric" type="number" min="1" name="rewardQuantity" value="${rules.rewardQuantity || 1}"><small>quantidade prêmio</small></label>
      </div>
      <label class="full">Produto do prêmio<select name="rewardProductId">${productOptions(data.rewardProductId || product)}</select></label>`;
    if (data.type === 'points') return `<div class="mobile-visual-rule">
      <label><span>A cada R$ 1</span><input inputmode="decimal" type="number" min=".1" step=".1" name="pointsPerReal" value="${rules.pointsPerReal || 1}"><small>pontos ganhos</small></label>
      ${icon('arrow-right')}
      <label><span>Resgate</span><input inputmode="numeric" type="number" min="1" name="rewardPoints" value="${rules.rewardPoints || 100}"><small>pontos necessários</small></label>
    </div>`;
    if (data.type === 'quantity_discount') return `${productField}<div class="mobile-visual-rule">
      <label><span>Compre</span><input inputmode="numeric" type="number" min="2" name="requiredQuantity" value="${rules.requiredQuantity || 3}"><small>unidades</small></label>
      ${icon('arrow-right')}
      <label><span>Ganhe</span><input inputmode="decimal" type="number" min="1" max="100" name="discountPercent" value="${rules.discountPercent || 10}"><small>% de desconto</small></label>
    </div>`;
    if (data.type === 'nth_product') return `${productField}<div class="mobile-visual-rule">
      <label><span>Na compra</span><input inputmode="numeric" type="number" min="2" name="requiredPurchases" value="${rules.requiredPurchases || 5}"><small>vezes necessárias</small></label>
      ${icon('arrow-right')}
      <label><span>Ganhe</span><input inputmode="numeric" type="number" min="1" name="rewardQuantity" value="${rules.rewardQuantity || 1}"><small>produto grátis</small></label>
    </div>`;
    if (data.type === 'combo') return `${productField}
      <label class="full">Segundo produto<select name="secondProductId">${productOptions((rules.comboProductIds || [])[1] || '')}</select></label>
      <label class="full">Preço especial do combo<input inputmode="decimal" type="number" min="0" step=".01" name="comboPrice" value="${rules.comboPrice || ''}" placeholder="R$ 0,00"></label>`;
    return `<label class="full">Regra personalizada<textarea name="customRule" maxlength="300" required placeholder="Explique de forma simples como a campanha funciona.">${esc(rules.customRule || '')}</textarea></label>`;
  }

  function stepConfiguration(data) {
    return `<div class="mobile-wizard-pane">
      <h2>Configurações da campanha</h2>
      <p>Defina as regras, o benefício e o período.</p>
      <div class="mobile-wizard-fields">
        <label class="full">Nome da campanha<input name="name" maxlength="60" required value="${esc(data.name || '')}" placeholder="Ex.: Compre 5 e ganhe 1"><small>${(data.name || '').length}/60</small></label>
        <label class="full">Descrição (opcional)<textarea name="description" maxlength="150" placeholder="Explique rapidamente como funciona a campanha...">${esc(data.description || '')}</textarea><small>${(data.description || '').length}/150</small></label>
        <h3 class="full">Regras da campanha</h3>
        ${ruleFields(data)}
        <h3 class="full">Período da campanha</h3>
        <label>Data de início<input type="date" name="startDate" required value="${data.startDate || today()}"></label>
        <label>Data de fim<input type="date" name="endDate" value="${data.endDate || ''}"></label>
      </div>
    </div>`;
  }

  function audienceCount(data, clients) {
    if (data.audience?.type === 'clients') return (data.audience.clientIds || []).length;
    if (data.audience?.type === 'vip') {
      return clients.filter(client => client.vip || Number(client.totalComprado || 0) >= 500).length;
    }
    return clients.length;
  }

  function stepAudience(data) {
    const clients = DB.carregar().clientes.filter(client => client.ativo !== false);
    const selected = new Set(data.audience?.clientIds || []);
    const total = audienceCount(data, clients);
    return `<div class="mobile-wizard-pane">
      <h2>Participantes</h2>
      <p>Selecione quem poderá participar desta campanha.</p>
      <div class="mobile-audience-options">
        ${[
          ['all', 'users', 'Todos os clientes', 'A campanha será válida para toda sua base.'],
          ['clients', 'user-round-check', 'Grupo específico', 'Selecione clientes individualmente.'],
          ['vip', 'crown', 'Clientes VIP', 'Estrutura preparada para seu grupo VIP.']
        ].map(([key, ico, title, text]) => `<label class="${data.audience?.type === key ? 'active' : ''}">
          <input type="radio" name="audienceType" value="${key}" ${data.audience?.type === key ? 'checked' : ''}>
          ${icon(ico)}<span><b>${title}</b><small>${text}</small></span>
        </label>`).join('')}
      </div>
      ${data.audience?.type === 'clients' ? `<div class="mobile-client-picker">
        ${clients.map(client => `<label><input type="checkbox" name="clientIds" value="${client.id}" ${selected.has(client.id) ? 'checked' : ''}><span>${esc(client.nome)}</span></label>`).join('') || '<p>Nenhum cliente ativo cadastrado.</p>'}
      </div>` : ''}
      <div class="mobile-audience-summary">${icon('users')}<span><b>${total} ${total === 1 ? 'cliente' : 'clientes'}</b> poderão participar desta campanha.</span></div>
      <label class="mobile-publish-toggle"><input type="checkbox" name="published" ${data.published !== false ? 'checked' : ''}><span>Exibir no Catálogo Online</span></label>
    </div>`;
  }

  function ruleSummary(data) {
    const rules = data.rules || {};
    if (data.type === 'buy_get') return `Compre ${rules.requiredQuantity || 0} → Ganhe ${rules.rewardQuantity || 0}`;
    if (data.type === 'points') return `${rules.pointsPerReal || 0} ponto(s) por R$ 1 → Resgate com ${rules.rewardPoints || 0}`;
    if (data.type === 'quantity_discount') return `${rules.requiredQuantity || 0} unidades → ${rules.discountPercent || 0}% de desconto`;
    if (data.type === 'nth_product') return `Na ${rules.requiredPurchases || 0}ª compra → Ganhe ${rules.rewardQuantity || 0}`;
    if (data.type === 'combo') return `Combo por ${Number(rules.comboPrice || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' })}`;
    return rules.customRule || 'Regra personalizada';
  }

  function stepReview(data) {
    const campaign = Campanhas.normalize(data);
    const audience = { all: 'Todos os clientes', vip: 'Clientes VIP', clients: 'Grupo específico' }[campaign.audience.type];
    return `<div class="mobile-wizard-pane mobile-wizard-review">
      <h2>Revisão</h2>
      <p>Confira os detalhes da sua campanha antes de salvar.</p>
      <article class="mobile-review-hero">
        ${cover(campaign)}
        <div><h3>${esc(campaign.name)}</h3><span class="mobile-campaign-type type-${campaign.type}">${esc(typeInfo(campaign).label)}</span></div>
      </article>
      <section><h3>Regras</h3><p>${icon('shopping-cart')}<b>${esc(ruleSummary(campaign))}</b></p></section>
      <section><h3>Período</h3><p>${formatDate(campaign.startDate)} até ${formatDate(campaign.endDate)}</p></section>
      <section><h3>Participantes</h3><p>${esc(audience || 'Todos os clientes')}</p></section>
      <section><h3>Descrição</h3><p>${esc(campaign.description || 'Sem descrição')}</p></section>
    </div>`;
  }

  function stepSuccess(data) {
    const campaign = Campanhas.normalize(data);
    return `<div class="mobile-wizard-success">
      <div class="mobile-success-icon">${icon('party-popper')}</div>
      <h2>Tudo pronto!</h2>
      <p>Campanha criada com sucesso</p>
      <section>
        <div><span>Nome</span><b>${esc(campaign.name)}</b></div>
        <div><span>Tipo</span><b>${esc(typeInfo(campaign).label)}</b></div>
        <div><span>Regras</span><b>${esc(ruleSummary(campaign))}</b></div>
        <div><span>Período</span><b>${formatDate(campaign.startDate)} até ${formatDate(campaign.endDate)}</b></div>
        <div><span>Participantes</span><b>${esc({ all: 'Todos os clientes', vip: 'Clientes VIP', clients: 'Grupo específico' }[campaign.audience.type])}</b></div>
      </section>
    </div>`;
  }

  function captureStep(validate = true) {
    const form = $('#mobile-campaign-wizard-form');
    if (!form) return true;
    const data = state.wizard.data;
    const fd = new FormData(form);
    if (state.wizard.step === 2) {
      data.name = String(fd.get('name') || '').trim();
      data.description = String(fd.get('description') || '').trim();
      data.startDate = String(fd.get('startDate') || today());
      data.endDate = String(fd.get('endDate') || '');
      const productId = String(fd.get('productId') || '');
      const secondProductId = String(fd.get('secondProductId') || '');
      data.productIds = [productId, secondProductId].filter(Boolean);
      data.rewardProductId = String(fd.get('rewardProductId') || productId);
      data.rules = {
        ...data.rules,
        requiredQuantity: Number(fd.get('requiredQuantity') || 0),
        rewardQuantity: Number(fd.get('rewardQuantity') || 0),
        pointsPerReal: Number(fd.get('pointsPerReal') || 0),
        rewardPoints: Number(fd.get('rewardPoints') || 0),
        discountPercent: Number(fd.get('discountPercent') || 0),
        requiredPurchases: Number(fd.get('requiredPurchases') || 0),
        comboProductIds: [productId, secondProductId].filter(Boolean),
        comboPrice: Number(fd.get('comboPrice') || 0),
        customRule: String(fd.get('customRule') || '').trim()
      };
      if (validate && !data.name) throw new Error('Informe o nome da campanha.');
      if (validate && !data.startDate) throw new Error('Informe a data de início.');
    }
    if (state.wizard.step === 3) {
      data.audience = {
        ...data.audience,
        type: String(fd.get('audienceType') || 'all'),
        clientIds: fd.getAll('clientIds')
      };
      data.published = fd.has('published');
      data.publica = data.published;
      if (validate && data.audience.type === 'clients' && !data.audience.clientIds.length) {
        throw new Error('Selecione pelo menos um cliente.');
      }
    }
    return true;
  }

  function openMobileWizard(id) {
    const old = id ? Campanhas.obter(id) : null;
    const blank = Campanhas.normalize({
      id: Utils.uuid(),
      type: 'buy_get',
      name: '',
      description: '',
      startDate: today(),
      audience: { type: 'all', clientIds: [] },
      status: 'ativa',
      published: true
    });
    blank.name = '';
    blank.nome = '';
    state.wizard = {
      step: 1,
      editing: Boolean(old),
      savedId: null,
      data: old ? structuredClone(old) : blank
    };
    renderMobileWizard();
  }

  function wizardContent() {
    const { step, data } = state.wizard;
    if (step === 1) return stepType(data);
    if (step === 2) return stepConfiguration(data);
    if (step === 3) return stepAudience(data);
    if (step === 4) return stepReview(data);
    return stepSuccess(data);
  }

  function renderMobileWizard() {
    const root = $('#modal');
    const wizard = state.wizard;
    const lastStep = wizard.step === 5;
    root.innerHTML = `<div class="modal-bg mobile-campaign-wizard-bg">
      <section class="mobile-campaign-wizard" role="dialog" aria-modal="true" aria-labelledby="mobile-wizard-title">
        <div class="mobile-sheet-handle"></div>
        <header>
          <button ${wizard.step === 1 || lastStep ? 'class="invisible"' : ''} data-mobile-wizard-back aria-label="Voltar">${icon('arrow-left')}</button>
          <h3 id="mobile-wizard-title">${wizard.editing ? 'Editar campanha' : 'Nova campanha'}</h3>
          <button data-mobile-wizard-close aria-label="Fechar">${icon('x')}</button>
        </header>
        <div class="mobile-wizard-stepper" aria-label="Etapa ${wizard.step} de 5">
          ${[1, 2, 3, 4, 5].map(step => `<span class="${wizard.step >= step ? 'active' : ''} ${wizard.step === step ? 'current' : ''}"><b>${step}</b></span>`).join('')}
        </div>
        <form id="mobile-campaign-wizard-form">
          <main>${wizardContent()}</main>
          <footer>
            ${lastStep
              ? `<button type="button" class="btn btn-primary" data-mobile-wizard-view>Ver campanha</button>
                 <button type="button" class="btn btn-light" data-mobile-wizard-continue>Continuar</button>`
              : `<button type="button" class="btn btn-light ${wizard.step === 1 ? 'invisible' : ''}" data-mobile-wizard-back>Voltar</button>
                 <button class="btn btn-primary">${wizard.step === 4 ? (wizard.editing ? 'Salvar alterações' : 'Criar campanha') : 'Próximo'}</button>`}
          </footer>
        </form>
      </section>
    </div>`;

    $('[data-mobile-wizard-close]', root).onclick = Modais.fechar;
    $$('[data-mobile-wizard-type]', root).forEach(button => {
      button.onclick = () => {
        wizard.data.type = button.dataset.mobileWizardType;
        renderMobileWizard();
      };
    });
    $$('[name="audienceType"]', root).forEach(input => {
      input.onchange = () => {
        wizard.data.audience = { ...wizard.data.audience, type: input.value };
        renderMobileWizard();
      };
    });
    $$('[data-mobile-wizard-back]', root).forEach(button => {
      button.onclick = () => {
        try { captureStep(false); } catch (_) {}
        wizard.step = Math.max(1, wizard.step - 1);
        renderMobileWizard();
      };
    });
    $('#mobile-campaign-wizard-form', root).onsubmit = event => {
      event.preventDefault();
      try {
        captureStep(true);
        if (wizard.step < 4) {
          wizard.step += 1;
          renderMobileWizard();
          return;
        }
        const saved = Campanhas.salvar(wizard.data);
        wizard.data = structuredClone(saved);
        wizard.savedId = saved.id;
        wizard.step = 5;
        renderMobileWizard();
        Utils.toast(wizard.editing ? 'Campanha atualizada' : 'Campanha criada com sucesso');
      } catch (error) {
        Utils.toast(error.message || 'Não foi possível salvar a campanha.', true);
      }
    };
    $('[data-mobile-wizard-view]', root)?.addEventListener('click', () => {
      const savedId = wizard.savedId || wizard.data.id;
      Modais.fechar();
      state.detailId = savedId;
      refresh();
    });
    $('[data-mobile-wizard-continue]', root)?.addEventListener('click', () => {
      Modais.fechar();
      state.detailId = null;
      refresh();
    });
    window.lucide?.createIcons();
  }

  function bindMobile() {
    const search = $('[data-mobile-campaign-search]');
    if (search) {
      search.oninput = event => {
        state.query = event.target.value;
        refresh({ preserveScroll: true, focusSearch: true });
      };
    }
    $('[data-clear-campaign-search]')?.addEventListener('click', () => {
      state.query = '';
      refresh({ focusSearch: true });
    });
    $('[data-mobile-campaign-filters]')?.addEventListener('click', openFilters);
    $$('[data-mobile-campaign-filter]').forEach(button => {
      button.onclick = () => {
        state.filter = button.dataset.mobileCampaignFilter;
        refresh();
      };
    });
    $('[data-mobile-new-campaign]')?.addEventListener('click', () => openMobileWizard());
    $$('[data-mobile-campaign-details]').forEach(card => {
      card.onclick = event => {
        if (event.target.closest('button,.mobile-campaign-menu')) return;
        state.detailId = card.dataset.mobileCampaignDetails;
        state.menuId = null;
        refresh();
      };
      card.onkeydown = event => {
        if (event.key === 'Enter' || event.key === ' ') card.click();
      };
    });
    $('[data-mobile-campaign-back]')?.addEventListener('click', () => {
      state.detailId = null;
      state.menuId = null;
      refresh();
    });
    $$('[data-mobile-campaign-menu]').forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        state.menuId = state.menuId === button.dataset.mobileCampaignMenu ? null : button.dataset.mobileCampaignMenu;
        refresh({ preserveScroll: true });
      };
    });
    $$('[data-mobile-campaign-edit]').forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        openMobileWizard(button.dataset.mobileCampaignEdit);
      };
    });
    $$('[data-mobile-campaign-duplicate]').forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        const saved = Campanhas.duplicar(button.dataset.mobileCampaignDuplicate);
        state.detailId = saved.id;
        state.menuId = null;
        Utils.toast('Campanha duplicada');
        refresh();
      };
    });
    $$('[data-mobile-campaign-status]').forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        Campanhas.alterarStatus(button.dataset.mobileCampaignStatus, button.dataset.status);
        state.menuId = null;
        Utils.toast('Status da campanha atualizado');
        refresh({ preserveScroll: true });
      };
    });
    $$('[data-mobile-campaign-delete]').forEach(button => {
      button.onclick = event => {
        event.stopPropagation();
        Modais.confirmar('campanha', () => {
          Campanhas.excluir(button.dataset.mobileCampaignDelete);
          state.detailId = null;
          state.menuId = null;
          Utils.toast('Campanha excluída');
          refresh();
        });
      };
    });
    window.lucide?.createIcons();
  }

  window.CampanhasUI = {
    ...desktop,
    render: () => isMobile() ? mobileRender() : desktop.render(),
    bind: () => isMobile() ? bindMobile() : desktop.bind(),
    refresh: options => isMobile() ? refresh(options) : desktop.refresh(),
    openWizard: id => isMobile() ? openMobileWizard(id) : desktop.openWizard(id)
  };
})();
