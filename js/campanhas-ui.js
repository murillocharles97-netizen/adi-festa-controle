(function () {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) => Utils.escapar(value ?? "");
  const icon = (name) => `<i data-lucide="${name}"></i>`;
  const money = (value) => Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  const date = (value) => value ? new Date(`${String(value).slice(0, 10)}T12:00:00`).toLocaleDateString("pt-BR") : "Sem limite";
  const state = { filter: "all", query: "", detailId: null, detailTab: "participants", menuId: null, wizard: null, participantPage: 1, participantPageSize: 4 };

  const typeInfo = (campaign) => Campanhas.TYPES[campaign.type] || Campanhas.TYPES.buy_get;
  const statusInfo = (campaign) => ({
    ativa: { label: "Ativa", class: "active" },
    agendada: { label: "Agendada", class: "scheduled" },
    pausada: { label: "Pausada", class: "paused" },
    encerrada: { label: "Encerrada", class: "ended" },
  }[Campanhas.status(campaign)]);
  const audienceLabel = (campaign) => campaign.eligibility.audienceType === "all"
    ? "Todos os clientes"
    : campaign.eligibility.audienceType === "segment"
      ? "Segmento do CRM"
      : `${campaign.eligibility.clientIds.length} cliente(s)`;

  function takePendingAudience() {
    try {
      const raw = sessionStorage.getItem("adiFestaCampaignAudience");
      if (!raw) return null;
      sessionStorage.removeItem("adiFestaCampaignAudience");
      const payload = JSON.parse(raw);
      const businessId = DB.getBusinessId?.();
      if(payload.businessId&&payload.businessId!==businessId) return null;
      const valid = new Set((DB.carregar().clientes || []).map((client) => client.id));
      const clientIds = [...new Set((payload.clientIds || []).filter((id) => valid.has(id)))];
      return clientIds.length ? {type:'clients',clientIds,source:payload.source || "crm"} : null;
    } catch {
      sessionStorage.removeItem("adiFestaCampaignAudience");
      return null;
    }
  }

  function filtered() {
    return Campanhas.listar()
      .filter((campaign) => state.filter === "all" || Campanhas.status(campaign) === state.filter)
      .filter((campaign) => !state.query || `${campaign.name} ${campaign.description} ${typeInfo(campaign).label}`.toLocaleLowerCase("pt-BR").includes(state.query.toLocaleLowerCase("pt-BR")));
  }

  function cover(campaign, large = false) {
    const info = typeInfo(campaign);
    return `<div class="campaign-cover ${large ? "large" : ""} type-${campaign.type}">${campaign.imageUrl ? `<img src="${esc(campaign.imageUrl)}" alt="">` : `${icon(campaign.imageIcon || info.icon)}<span>${esc(info.label)}</span>`}</div>`;
  }

  function menu(campaign) {
    return `<div class="campaign-menu">
      <button data-campaign-edit="${campaign.id}">${icon("pencil")} Editar</button>
      <button data-campaign-duplicate="${campaign.id}">${icon("copy")} Duplicar</button>
      <button data-campaign-status="${campaign.id}" data-status="${Campanhas.status(campaign) === "pausada" ? "ativa" : "pausada"}">${icon(Campanhas.status(campaign) === "pausada" ? "play" : "pause")} ${Campanhas.status(campaign) === "pausada" ? "Reativar" : "Pausar"}</button>
      <button data-campaign-status="${campaign.id}" data-status="encerrada">${icon("circle-stop")} Encerrar</button>
      <button class="danger" data-campaign-delete="${campaign.id}">${icon("trash-2")} Excluir</button>
    </div>`;
  }

  function card(campaign) {
    const info = typeInfo(campaign), status = statusInfo(campaign), campaignStats = Campanhas.metricasCampanha(campaign.id);
    return `<article class="campaign-admin-card" data-campaign-card="${campaign.id}">
      ${cover(campaign)}
      <div class="campaign-card-main"><div class="campaign-title-line"><div><h3>${esc(campaign.name)}</h3><p>${esc(campaign.description || info.description)}</p></div></div><span class="campaign-type-pill">${esc(info.label)}</span></div>
      <div class="campaign-card-meta"><span>${icon("users")}<small>Público</small><b>${esc(audienceLabel(campaign))}</b></span><span>${icon("calendar-days")}<small>Período</small><b>${date(campaign.startsAt)} · ${date(campaign.endsAt)}</b></span><span>${icon("activity")}<small>Com progresso</small><b>${campaignStats?.withProgress || 0}</b></span><span>${icon("gift")}<small>Resgates</small><b>${campaignStats?.redemptions || 0}</b></span></div>
      <span class="campaign-status ${status.class}" data-mobile-label="${status.class === "scheduled" ? "Programada" : status.label}">${status.label}</span>
      <button class="campaign-details-button" data-campaign-details="${campaign.id}">Ver detalhes</button>
      <button class="campaign-more" data-campaign-menu="${campaign.id}" aria-label="Mais ações">${icon("ellipsis-vertical")}</button>${state.menuId === campaign.id ? menu(campaign) : ""}
    </article>`;
  }

  function metrics() {
    const value = Campanhas.metricas();
    return `<section class="campaign-metrics" aria-label="Indicadores de campanhas"><article data-campaign-metric="0"><span>${icon("users")}</span><div><small>Elegíveis</small><b>${value.eligible}</b><em>Clientes que podem participar</em></div></article><article data-campaign-metric="1"><span>${icon("activity")}</span><div><small>Com progresso</small><b>${value.participants}</b><em>Clientes participando</em></div></article><article data-campaign-metric="2"><span>${icon("sparkles")}</span><div><small>Próximos de ganhar</small><b>${value.nearReward}</b><em>75% ou mais da meta</em></div></article><article data-campaign-metric="3"><span>${icon("gift")}</span><div><small>Pode resgatar</small><b>${value.redeemable}</b><em>Benefícios disponíveis</em></div></article><article data-campaign-metric="4"><span>${icon("badge-check")}</span><div><small>Resgates</small><b>${value.redemptions}</b><em>Total confirmado</em></div></article></section>`;
  }

  function listPage() {
    const campaigns = Campanhas.listar();
    const counts = {
      all: campaigns.length,
      ativa: campaigns.filter((campaign) => Campanhas.status(campaign) === "ativa").length,
      agendada: campaigns.filter((campaign) => Campanhas.status(campaign) === "agendada").length,
      pausada: campaigns.filter((campaign) => Campanhas.status(campaign) === "pausada").length,
      encerrada: campaigns.filter((campaign) => Campanhas.status(campaign) === "encerrada").length,
    };
    const list = filtered();
    return `<section class="campaigns-page campaign-v2-page af-page"><header class="campaign-page-head af-page-header"><div><h2>Campanhas</h2><p>Fidelização, pontos e recompensas.</p></div><button class="btn btn-primary af-button af-button--primary" data-new-campaign>${icon("plus")} Nova campanha</button></header>${metrics()}
      <div class="campaign-metric-dots" aria-label="Navegação dos indicadores">${Array.from({ length: 5 }, (_, index) => `<button class="${index === 0 ? "active" : ""}" data-campaign-metric-dot="${index}" aria-label="Mostrar indicador ${index + 1}"></button>`).join("")}</div>
      <div class="campaign-toolbar"><div class="campaign-filter-chips af-chips">${[["all", "Todas"], ["ativa", "Ativas"], ["agendada", "Programadas"], ["pausada", "Pausadas"], ["encerrada", "Encerradas"]].map(([key, label]) => `<button class="af-chip ${state.filter === key ? "active" : ""}" data-campaign-filter="${key}">${label}<b>${counts[key]}</b></button>`).join("")}</div><div class="campaign-search-row"><label class="af-search">${icon("search")}<input id="campaign-search" value="${esc(state.query)}" placeholder="Buscar campanha..."></label><button class="campaign-filter-button af-button af-button--secondary" data-campaign-filter-shortcut aria-label="Mostrar filtros de status">${icon("list-filter")}<span>Filtros</span></button></div></div>
      <div class="campaign-list">${list.map(card).join("") || `<div class="campaign-empty af-empty">${icon("party-popper")}<h3>Nenhuma campanha criada ainda.</h3><p>Crie sua primeira campanha para incentivar clientes a comprar mais e voltar com mais frequência.</p><button class="btn btn-primary af-button af-button--primary" data-new-campaign>${icon("plus")} Criar campanha</button></div>`}</div>
      <button class="campaign-fab" data-new-campaign aria-label="Nova campanha">${icon("plus")}</button></section>`;
  }

  function participantData(campaign) {
    const db = DB.carregar();
    const query = String(state.participantQuery || "").toLocaleLowerCase("pt-BR"), filter = state.participantFilter || "all";
    const progress = (db.progressosCampanha || []).filter((item) => item.campaignId === campaign.id).filter((item) => {
      const client = db.clientes.find((entry) => entry.id === item.clientId), current = campaign.type === "points" ? Number(item.availablePoints || 0) : Number(item.confirmedProgress || 0);
      const canRedeem = campaign.type === "points" ? campaign.rewards.some((reward) => Number(reward.pointsCost) > 0 && Number(reward.pointsCost) <= current) : Number(item.availableRewards || 0) > 0;
      const redeemed = (db.resgatesCampanha || []).some((entry) => entry.campaignId === campaign.id && entry.clientId === item.clientId);
      const next = campaign.type === "points" ? campaign.rewards.filter((reward) => Number(reward.pointsCost) > current).sort((a, b) => a.pointsCost - b.pointsCost)[0]?.pointsCost : (campaign.type === "nth_product" ? campaign.rule.requiredPurchases : campaign.rule.requiredQuantity);
      const close = !canRedeem && current > 0 && next && current / next >= .75;
      return (!query || `${client?.nome || ""} ${client?.telefone || ""}`.toLocaleLowerCase("pt-BR").includes(query)) && (filter === "all" || filter === "progress" && current > 0 || filter === "close" && close || filter === "redeem" && canRedeem || filter === "redeemed" && redeemed);
    });
    return { db, progress };
  }

  function progressRows(campaign) {
    const { db, progress } = participantData(campaign);
    if (!progress.length) return '<p class="campaign-no-progress">Nenhum cliente iniciou esta campanha ainda.</p>';
    const pages = Math.max(1, Math.ceil(progress.length / state.participantPageSize));
    state.participantPage = Math.min(Math.max(1, state.participantPage), pages);
    const start = (state.participantPage - 1) * state.participantPageSize;
    const rows = progress.slice(start, start + state.participantPageSize).map((item) => {
      const client = db.clientes.find((entry) => entry.id === item.clientId);
      const current = campaign.type === "points" ? Number(item.availablePoints || 0) : Number(item.confirmedProgress || 0);
      const pending = campaign.type === "points" ? Number(item.pendingPoints || 0) : Number(item.pendingProgress || 0);
      const available = Number(item.availableRewards || 0);
      const affordable = campaign.type === "points" ? campaign.rewards.filter((reward) => Number(reward.pointsCost) > 0 && Number(reward.pointsCost) <= current) : available ? campaign.rewards : [];
      const next = campaign.type === "points" ? campaign.rewards.filter((reward) => Number(reward.pointsCost) > current).sort((a, b) => a.pointsCost - b.pointsCost)[0] : campaign.rewards[0];
      const target = campaign.type === "points" ? Number(next?.pointsCost || current || 1) : Number(campaign.type === "nth_product" ? campaign.rule.requiredPurchases : campaign.rule.requiredQuantity), pct = Math.min(100, target ? current / target * 100 : 0);
      return `<div class="campaign-participant"><span class="campaign-avatar">${esc((client?.nome || "?").split(/\s+/).slice(0, 2).map((part) => part[0]).join(""))}</span><div class="campaign-participant-main"><b>${esc(client?.nome || "Cliente")}</b><strong>${current} ${campaign.type === "points" ? "pontos disponíveis" : "de progresso"}</strong>${pending ? `<small>+ ${pending} pendente(s) aguardando quitação</small>` : ""}<small>Próximo prêmio: ${esc(next?.name || "Recompensa")}${next?.pointsCost ? ` · ${next.pointsCost} pts` : ""}</small><i><em style="width:${pct}%"></em></i><small>${affordable.length ? `🎁 ${affordable.length} opção(ões) disponível(is)` : "Em andamento"}</small></div><div class="campaign-participant-actions"><button data-view-progress="${campaign.id}" data-client-id="${item.clientId}">Ver progresso</button>${affordable.length ? `<button class="primary" data-campaign-redeem="${campaign.id}" data-client-id="${item.clientId}">${icon("gift")} Resgatar</button>` : ""}</div></div>`;
    }).join("");
    const pagination = pages > 1 ? `<nav class="campaign-pagination" aria-label="Paginação de participantes"><small>Mostrando ${start + 1} a ${Math.min(start + state.participantPageSize, progress.length)} de ${progress.length}</small><div><button data-participant-page="${state.participantPage - 1}" ${state.participantPage === 1 ? "disabled" : ""} aria-label="Página anterior">${icon("chevron-left")}</button>${Array.from({ length: pages }, (_, index) => index + 1).slice(Math.max(0, state.participantPage - 3), Math.max(3, state.participantPage + 2)).map((page) => `<button data-participant-page="${page}" class="${page === state.participantPage ? "active" : ""}">${page}</button>`).join("")}<button data-participant-page="${state.participantPage + 1}" ${state.participantPage === pages ? "disabled" : ""} aria-label="Próxima página">${icon("chevron-right")}</button></div></nav>` : "";
    return rows + pagination;
  }

  function campaignRuleSummary(campaign) {
    if (campaign.type === "points") return `${campaign.rule.pointsAmount === 1 ? "R$ 1" : `R$ ${campaign.rule.pointsAmount}`} = ${campaign.rule.pointsAward} ponto(s)`;
    if (campaign.type === "quantity_discount") return campaign.rule.thresholds.map((item) => `${item.quantity} un. → ${item.discountPercent}%`).join(" · ");
    if (campaign.type === "combo") return `${campaign.rule.requiredItems.length} itens por ${Number(campaign.rule.comboPrice || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" })}`;
    return campaign.type === "nth_product" ? `${campaign.rule.requiredPurchases} compras para ganhar` : `${campaign.rule.requiredQuantity} unidades para ganhar`;
  }

  function rewardsTab(campaign) {
    return `<section class="campaign-detail-panel campaign-reward-catalog"><header><div><h3>Recompensas</h3><p>Benefícios configurados para esta campanha.</p></div></header>${campaign.rewards.length ? campaign.rewards.map((reward) => `<article>${icon(reward.type === "product" ? "package" : "gift")}<div><b>${esc(reward.name)}</b><small>${reward.pointsCost ? `${reward.pointsCost} pontos · ` : ""}${reward.quantity} unidade(s)</small><em>${reward.type === "product" ? `Produto do estoque · ${rewardStock(reward)} disponível(is)` : "Recompensa externa"}</em></div></article>`).join("") : '<p class="campaign-no-progress">O benefício desta campanha é aplicado diretamente no carrinho.</p>'}</section>`;
  }

  function performanceTab(campaign, progress, redemptions) {
    const events = (DB.carregar().eventosCampanha || []).filter((event) => event.campaignId === campaign.id);
    return `<section class="campaign-detail-panel campaign-performance-panel"><header><div><h3>Desempenho</h3><p>Indicadores confirmados pelo histórico da campanha.</p></div></header><div class="campaign-performance-bars"><article><span><b>Clientes com progresso</b><strong>${progress.length}</strong></span><i><em style="width:${Math.min(100, progress.length / Math.max(1, Campanhas.elegiveis(campaign).length) * 100)}%"></em></i></article><article><span><b>Resgates confirmados</b><strong>${redemptions.length}</strong></span><i><em style="width:${Math.min(100, redemptions.length / Math.max(1, progress.length) * 100)}%"></em></i></article><article><span><b>Eventos registrados</b><strong>${events.length}</strong></span><i><em style="width:${Math.min(100, events.length * 8)}%"></em></i></article></div><p class="campaign-reliable-note">${icon("shield-check")} Somente dados confirmados pelo ledger da campanha são exibidos. Receita influenciada não é estimada sem vínculo confiável.</p></section>`;
  }

  function historyTab(campaign) {
    const db = DB.carregar(), events = (db.eventosCampanha || []).filter((event) => event.campaignId === campaign.id).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    return `<section class="campaign-detail-panel"><header><div><h3>Histórico</h3><p>Registro imutável de progresso, confirmações e resgates.</p></div></header><div class="campaign-event-timeline">${events.slice(0, 50).map((event) => `<article><span>${event.transition === "redeemed" ? "−" : event.status === "pending" ? "⏳" : "+"}</span><div><b>${event.transition === "redeemed" ? "Recompensa resgatada" : event.transition === "reversed" ? "Progresso revertido" : event.status === "pending" ? "Progresso pendente" : "Progresso confirmado"}</b><small>${event.clientName ? `${esc(event.clientName)} · ` : ""}${new Date(event.createdAt).toLocaleString("pt-BR")}</small></div></article>`).join("") || '<p class="campaign-no-progress">Nenhum evento registrado ainda.</p>'}</div></section>`;
  }

  function detailPage(campaign) {
    const db = DB.carregar();
    const progress = (db.progressosCampanha || []).filter((item) => item.campaignId === campaign.id);
    const redemptions = (db.resgatesCampanha || []).filter((item) => item.campaignId === campaign.id);
    const eligible = Campanhas.elegiveis(campaign, db).length;
    const redeemable = progress.filter((item) => campaign.type === "points" ? campaign.rewards.some((reward) => Number(reward.pointsCost) > 0 && Number(reward.pointsCost) <= Number(item.availablePoints || 0)) : Number(item.availableRewards || 0) > 0).length;
    const close = progress.filter((item) => { const current = campaign.type === "points" ? Number(item.availablePoints || 0) : Number(item.confirmedProgress || 0), target = campaign.type === "points" ? campaign.rewards.filter((reward) => Number(reward.pointsCost) > current).sort((a, b) => a.pointsCost - b.pointsCost)[0]?.pointsCost : Number(campaign.type === "nth_product" ? campaign.rule.requiredPurchases : campaign.rule.requiredQuantity); return current > 0 && target && current < target && current / target >= .75; }).length;
    const status = statusInfo(campaign);
    const tabs = [["participants", "Participantes"], ["rewards", "Recompensas"], ["performance", "Desempenho"], ["history", "Histórico"]];
    const panel = state.detailTab === "rewards" ? rewardsTab(campaign) : state.detailTab === "performance" ? performanceTab(campaign, progress, redemptions) : state.detailTab === "history" ? historyTab(campaign) : `<section class="campaign-participants campaign-detail-panel"><header><div><h3>Participantes</h3><p>Acompanhe progresso, pendências e benefícios disponíveis.</p></div><label>${icon("search")}<input id="campaign-client-search" value="${esc(state.participantQuery || "")}" placeholder="Buscar cliente"></label></header><div class="campaign-participant-filters">${[["all", "Todos"], ["progress", "Em progresso"], ["close", "Perto do prêmio"], ["redeem", "Pode resgatar"], ["redeemed", "Resgatou"]].map(([key, label]) => `<button class="${(state.participantFilter || "all") === key ? "active" : ""}" data-participant-filter="${key}">${label}</button>`).join("")}</div>${progressRows(campaign)}</section>`;
    return `<section class="campaign-detail-page campaign-v2-detail"><header class="campaign-detail-head"><button data-campaign-back aria-label="Voltar">${icon("arrow-left")}</button><div><h2>${esc(campaign.name)}</h2><span class="campaign-status ${status.class}">${status.label}</span></div><button data-campaign-menu="${campaign.id}" aria-label="Mais ações">${icon("ellipsis-vertical")}</button>${state.menuId === campaign.id ? menu(campaign) : ""}</header>
      <section class="campaign-detail-hero">${cover(campaign, true)}<div><span class="campaign-type-pill">${esc(typeInfo(campaign).label)}</span><p>${esc(campaign.description)}</p><dl><div><dt>Regra</dt><dd>${esc(campaignRuleSummary(campaign))}</dd></div><div><dt>Período</dt><dd>${date(campaign.startsAt)} até ${date(campaign.endsAt)}</dd></div><div><dt>Público</dt><dd>${esc(audienceLabel(campaign))}${campaign.eligibility.audienceType === "all" ? " (dinâmico)" : ""}</dd></div><div><dt>Acúmulo</dt><dd>${campaign.stacking.allowed ? "Combina com outras campanhas" : "Benefício exclusivo"}</dd></div></dl></div></section>
      <section class="campaign-detail-metrics"><article><small>Elegíveis</small><b>${eligible}</b></article><article><small>Com progresso</small><b>${progress.length}</b></article><article><small>Perto de ganhar</small><b>${close}</b></article><article><small>Pode resgatar</small><b>${redeemable}</b></article><article><small>Resgates</small><b>${redemptions.length}</b></article></section>
      <nav class="campaign-detail-tabs" aria-label="Seções da campanha">${tabs.map(([key, label]) => `<button class="${state.detailTab === key ? "active" : ""}" data-detail-tab="${key}">${label}</button>`).join("")}</nav>${panel}</section>`;
  }

  function render() {
    if (state.detailId) {
      const campaign = Campanhas.obter(state.detailId);
      if (campaign) return detailPage(campaign);
      state.detailId = null;
    }
    return listPage();
  }

  function refresh() {
    const app = $("#app");
    if (!app) return;
    app.innerHTML = render();
    bind();
    window.lucide?.createIcons();
  }

  const products = () => Produtos.listar().filter((product) => product.ativo !== false);
  const productStock = (product) => Number(product.totalStock ?? product.estoqueAtual ?? product.estoque ?? 0);
  const productOptions = (selected = "") => `<option value="">Selecione</option>${products().map((product) => `<option value="${product.id}" ${selected === product.id ? "selected" : ""}>${esc(product.nome)} · estoque ${productStock(product)}</option>`).join("")}`;
  const variantOptions = (productId = "", selected = "") => {
    const variants = (DB.carregar().variacoesProdutos || []).filter((variant) => variant.active !== false && (!productId || variant.parentProductId === productId));
    return variants.map((variant) => `<option value="${variant.id}" data-product-id="${esc(variant.parentProductId)}" ${selected === variant.id ? "selected" : ""}>${esc(variant.displayName || variant.nome || variant.id)} · estoque ${Number(variant.stock || 0)}</option>`).join("");
  };
  const productVariants = (productId) => (DB.carregar().variacoesProdutos || []).filter((variant) => variant.active !== false && variant.parentProductId === productId);
  const rewardStock = (reward = {}) => {
    if (reward.type !== "product") return null;
    if (reward.variantId) return Number(productVariants(reward.productId).find((variant) => variant.id === reward.variantId)?.stock || 0);
    return productStock(products().find((product) => product.id === reward.productId) || {});
  };
  const categoryOptions = (selected = "") => [...new Set(products().map((product) => product.categoria).filter(Boolean))].map((category) => `<option value="${esc(category)}" ${selected === category ? "selected" : ""}>${esc(category)}</option>`).join("");

  function stepType(data) {
    return `<div class="campaign-wizard-pane af-stack" data-wizard-pane="objective"><h3>Qual resultado você quer alcançar?</h3><p>Escolha o tipo de campanha que melhor se encaixa no seu objetivo.</p><div class="campaign-type-grid af-option-grid">${Object.entries(Campanhas.TYPES).map(([key, info]) => `<button type="button" class="campaign-type-choice af-option-card ${data.type === key ? "active is-selected" : ""}" data-wizard-type="${key}">${icon(info.icon)}<b>${esc(info.label)}</b><small>${esc(info.description)}</small><em>Boa para: ${esc(info.goodFor)}</em></button>`).join("")}</div><section class="af-form-section campaign-basics-section"><header><h4>Informações da campanha</h4><p>Use um nome fácil de reconhecer e uma descrição clara para o cliente.</p></header><div class="af-form-grid"><label class="af-field">Nome da campanha<input name="name" maxlength="60" required value="${esc(data.name || "")}" placeholder="Ex.: Compre 5 e ganhe 1"></label><label class="af-field">Descrição para o cliente<textarea name="description" maxlength="180">${esc(data.description || typeInfo(data).description)}</textarea></label></div></section></div>`;
  }

  function targetFields(data) {
    const mode = data.qualification?.categoryIds?.length ? "category" : data.qualification?.productIds?.length ? "product" : "all";
    const productId = data.qualification?.productIds?.[0] || "";
    const variants = productVariants(productId);
    const conditional = mode === "product"
      ? `<label>Produto<select name="productId" data-target-product>${productOptions(productId)}</select></label>${variants.length ? `<label>Variação opcional<select name="targetVariantId" data-target-variant>${variantOptions(productId, data.qualification?.variantIds?.[0] || "")}</select></label>` : ""}`
      : mode === "category"
        ? `<label>Categoria<select name="categoryId" data-target-category><option value="">Selecione</option>${categoryOptions(data.qualification?.categoryIds?.[0] || "")}</select></label>`
        : `<div class="campaign-education">Todas as compras válidas desta campanha poderão gerar progresso.</div>`;
    return `<label>O que conta?<select name="targetMode" data-target-mode><option value="all" ${mode === "all" ? "selected" : ""}>Todas as compras</option><option value="product" ${mode === "product" ? "selected" : ""}>Produto específico</option><option value="category" ${mode === "category" ? "selected" : ""}>Categoria</option></select></label>${conditional}`;
  }

  function comboRows(data) {
    const items = data.rule?.requiredItems || [];
    return [0, 1, 2].map((index) => {
      const item = items[index] || {}, productId = item.productId || "";
      return `<div class="campaign-combo-row" data-combo-row><label>Produto ${index + 1}<select name="comboProductId">${productOptions(productId)}</select></label><label>Variação<select name="comboVariantId">${variantOptions(productId, item.variantId || "")}</select></label><label>Quantidade<input name="comboQuantity" type="number" min="1" value="${item.quantity || 1}"></label></div>`;
    }).join("");
  }

  function stepRule(data) {
    const rule = data.rule || {}, q = data.qualification || {};
    let fields = "";
    if (data.type === "buy_get") fields = `<label>Quantidade necessária<input name="requiredQuantity" type="number" min="1" value="${rule.requiredQuantity || 5}"></label><label class="switch-line"><input name="multipleCycles" type="checkbox" ${rule.multipleCycles !== false ? "checked" : ""}> Permitir vários ciclos e preservar excedente</label>`;
    if (data.type === "points") fields = `<label>Como pontuar?<select name="pointsMode"><option value="value" ${q.pointsMode !== "unit" ? "selected" : ""}>Por valor gasto</option><option value="unit" ${q.pointsMode === "unit" ? "selected" : ""}>Por unidade comprada</option></select></label><label>Base da conversão<input name="pointsAmount" type="number" min=".01" step=".01" value="${rule.pointsAmount || 1}"><small>Ex.: 1 para “R$1”; 10 para “R$10”.</small></label><label>Pontos concedidos<input name="pointsAward" type="number" min="1" value="${rule.pointsAward || 1}"></label><label>Expiração em dias<input name="pointsExpirationDays" type="number" min="1" value="${rule.pointsExpirationDays || ""}" placeholder="Sem expiração"></label>`;
    if (data.type === "quantity_discount") fields = `<label class="full">Faixas progressivas<input name="thresholds" value="${esc((rule.thresholds || []).map((item) => `${item.quantity}:${item.discountPercent}`).join(", ") || "3:5, 5:10, 10:15")}"><small>Formato: quantidade:desconto. Ex.: 3:5, 5:10.</small></label><p class="campaign-education">O benefício será apenas sugerido no carrinho. Nada será aplicado sem tocar em “Aplicar benefício”.</p>`;
    if (data.type === "nth_product") fields = `<label>Contar por<select name="countMode"><option value="purchase" ${q.countMode === "purchase" ? "selected" : ""}>Uma vez por venda</option><option value="quantity" ${q.countMode !== "purchase" ? "selected" : ""}>Unidades compradas</option></select></label><label>Meta<input name="requiredPurchases" type="number" min="1" value="${rule.requiredPurchases || 5}"></label><label class="switch-line"><input name="dailyLimit" type="checkbox" ${q.dailyLimit === 1 ? "checked" : ""}> No máximo uma contagem por dia</label>`;
    if (data.type === "combo") fields = `<div class="full"><b>Itens do combo</b><small>Escolha produtos e quantidades. O estoque continua sendo baixado item a item.</small>${comboRows(data)}</div><label>Preço especial<input name="comboPrice" type="number" min=".01" step=".01" value="${rule.comboPrice || ""}"></label><label class="switch-line"><input name="multipleCycles" type="checkbox" ${rule.multipleCycles !== false ? "checked" : ""}> Permitir vários combos na mesma compra</label>`;
    const title = data.type === "points" ? "Como o cliente vai ganhar pontos?" : data.type === "combo" ? "Como o cliente libera o combo?" : data.type === "quantity_discount" ? "Como o cliente libera o desconto?" : "Como o cliente participa?";
    const preview = data.type === "points" ? `<b>Prévia rápida</b><span>${money(Number(rule.pointsAmount || 1))} = ${Number(rule.pointsAward || 1)} ponto(s)</span><span>Todos os produtos, categoria ou produto escolhido</span><span>Venda paga confirma na hora</span><span>Venda fiado confirma somente após quitação</span>` : `<b>Como funciona?</b><span>A compra é avaliada automaticamente.</span><span>Benefícios manuais só entram após confirmação no carrinho.</span><span>Venda fiado mantém o progresso pendente até a quitação integral.</span>`;
    return `<div class="campaign-wizard-pane" data-wizard-pane="rule"><h3>${title}</h3><p>Defina a regra principal com exemplos simples para o cliente.</p><div class="campaign-rule-layout"><section class="af-form-section campaign-rule-fields"><header><h4>Regra e período</h4><p>Mostramos somente os campos necessários para este tipo de campanha.</p></header><div class="form-grid af-form-grid">${targetFields(data)}${fields}<label>Data de início<input name="startsAt" type="date" value="${String(data.startsAt || new Date().toISOString()).slice(0, 10)}"></label><label>Data de término<input name="endsAt" type="date" value="${String(data.endsAt || "").slice(0, 10)}"></label></div></section><aside class="campaign-rule-preview">${preview}</aside></div><div class="campaign-how-it-works">${icon("info")}<div><b>Como funciona?</b><p>Venda paga confirma imediatamente. Venda fiado fica pendente; pagamento parcial continua pendente e a quitação integral confirma o progresso.</p></div></div></div>`;
  }

  function rewardRow(reward = {}, index = 0, points = false) {
    const type = reward.type === "product" ? "product" : "external", variants = productVariants(reward.productId), stock = rewardStock(reward);
    const name = reward.name || products().find((product) => product.id === reward.productId)?.nome || "Recompensa";
    return `<div class="campaign-reward-row af-card" data-reward-row><header><b>Recompensa ${index + 1}</b>${index ? `<button type="button" data-remove-reward="${index}" aria-label="Remover recompensa" data-tooltip="Remover recompensa">${icon("trash-2")}</button>` : ""}</header><label class="af-field">Origem<select name="rewardType"><option value="product" ${type === "product" ? "selected" : ""}>Produto do estoque</option><option value="external" ${type === "external" ? "selected" : ""}>Recompensa externa</option></select></label>${type === "product" ? `<label class="af-field">Produto<select name="rewardProductId">${productOptions(reward.productId || "")}</select></label>${variants.length ? `<label class="af-field">Variação<select name="rewardVariantId">${variantOptions(reward.productId || "", reward.variantId || variants[0]?.id || "")}</select></label>` : ""}` : `<label class="af-field">Nome da recompensa<input name="rewardName" value="${esc(reward.name || "")}" placeholder="Ex.: Vale R$ 20"></label><label class="af-field">Descrição opcional<input name="rewardDescription" value="${esc(reward.description || "")}" placeholder="Como o cliente recebe"></label>`}<div class="campaign-reward-numbers"><label class="af-field">Quantidade<input name="rewardQuantity" type="number" min="1" value="${reward.quantity || 1}"></label>${points ? `<label class="af-field">Pontos necessários<input name="rewardPointsCost" type="number" min="1" value="${reward.pointsCost || (index + 1) * 100}"></label>` : ""}</div><div class="campaign-reward-preview">${icon("gift")}<span><b>${esc(name)}${reward.variantId ? ` · ${esc(productVariants(reward.productId).find((variant) => variant.id === reward.variantId)?.displayName || "")}` : ""}</b><small>${points ? `${reward.pointsCost || (index + 1) * 100} pontos · ` : ""}${reward.quantity || 1} unidade(s)${type === "product" ? ` · Estoque atual: ${stock}` : " · Recompensa externa"}</small></span></div></div>`;
  }

  function stepReward(data) {
    if (["quantity_discount", "combo"].includes(data.type)) return `<div class="campaign-wizard-pane" data-wizard-pane="reward"><h3>O que ele ganha?</h3><div class="campaign-education">O benefício desta campanha é o preço especial configurado na etapa anterior. Ele será apresentado no carrinho para confirmação.</div></div>`;
    const rewards = data.rewards?.length ? data.rewards : [{ id: "reward-1", type: "external", name: "", quantity: 1, pointsCost: 100 }];
    const rows = rewards.map((reward, index) => rewardRow(reward, index, data.type === "points")).join("");
    return `<div class="campaign-wizard-pane campaign-reward-step" data-wizard-pane="reward"><h3>O que o cliente pode ganhar?</h3><p>Comece com uma recompensa. Adicione outras somente quando a campanha realmente precisar.</p><div class="campaign-rewards-editor">${rows}</div><button type="button" class="btn btn-light af-button af-button--secondary campaign-add-reward" data-add-reward>${icon("plus")} Adicionar outra recompensa</button></div>`;
  }

  function stepAudience(data) {
    const clients = DB.carregar().clientes.filter((client) => client.ativo !== false), segments = DB.carregar().segmentosClientes || [];
    const audience = data.eligibility?.audienceType || "all", selected = new Set(data.eligibility?.clientIds || []);
    const search = String(data._clientSearch || "").toLocaleLowerCase("pt-BR"), matching = clients.filter((client) => !search || `${client.nome} ${client.telefone || ""}`.toLocaleLowerCase("pt-BR").includes(search)).slice(0, 20);
    const segment = segments.find((item) => item.id === data.eligibility?.segmentId), segmentCount = (segment?.clientIds || segment?.clienteIds || []).length;
    const publicConfig = { catalog: true, receipt: true, whatsapp: true, ...(data.publicity || {}) };
    const conditional = audience === "all"
      ? `<div class="campaign-audience-summary">${icon("users")}<span><b>Todos os clientes atuais e novos poderão participar.</b><small>Este público é atualizado dinamicamente.</small></span></div>`
      : audience === "segment"
        ? `<label class="campaign-conditional-field">Qual segmento?<select name="segmentId"><option value="">Selecione um segmento</option>${segments.map((item) => `<option value="${item.id}" ${data.eligibility?.segmentId === item.id ? "selected" : ""}>${esc(item.name || item.nome || item.id)}</option>`).join("")}</select><small>${segment ? `${segmentCount} clientes correspondem a este segmento.` : "Escolha um segmento salvo no CRM."}</small></label>`
        : `<div class="campaign-specific-picker"><label>${icon("search")}<input name="clientSearch" value="${esc(data._clientSearch || "")}" placeholder="Buscar clientes"></label><div class="campaign-selected-clients">${clients.filter((client) => selected.has(client.id)).map((client) => `<span>${esc(client.nome)}<button type="button" data-unselect-client="${client.id}">×</button></span>`).join("") || "<small>Nenhum cliente selecionado.</small>"}</div><small>${selected.size} cliente(s) selecionado(s)</small><div class="campaign-client-results">${matching.map((client) => `<label><input type="checkbox" name="clientIds" value="${client.id}" ${selected.has(client.id) ? "checked" : ""}><span>${esc(client.nome)}</span><small>${esc(client.telefone || "Sem telefone")}</small></label>`).join("")}</div></div>`;
    return `<div class="campaign-wizard-pane campaign-audience-step" data-wizard-pane="audience"><h3>Quem participa e como divulgar?</h3><section class="af-form-section"><h4>Quem pode participar?</h4><div class="campaign-audience-options">${[["all", "users", "Todos os clientes", "Atuais e novos."], ["segment", "filter", "Segmento do CRM", "Público atualizado pelo segmento."], ["clients", "user-check", "Clientes específicos", "Seleção manual."]].map(([key, ico, title, text]) => `<label class="af-option-card ${audience === key ? "active is-selected" : ""}"><input type="radio" name="audienceType" value="${key}" ${audience === key ? "checked" : ""}>${icon(ico)}<span><b>${title}</b><small>${text}</small></span></label>`).join("")}</div>${conditional}</section><section class="af-form-section"><h4>Combina com outras campanhas?</h4><label class="campaign-setting-card af-switch"><span><b>Acumular com campanhas compatíveis</b><small>Quando ativado, uma mesma compra pode gerar progresso em mais de uma campanha compatível.</small></span><input type="checkbox" name="stackingAllowed" ${data.stacking?.allowed ? "checked" : ""}></label></section><section class="af-form-section"><h4>Onde divulgar?</h4>${[["catalog", "Catálogo online"], ["receipt", "Recibo"], ["whatsapp", "WhatsApp"]].map(([key, label]) => `<label class="campaign-setting-card af-switch"><span><b>${label}</b><small>${key === "catalog" ? "Mostra a campanha no portal do cliente." : key === "receipt" ? "Inclui o progresso no comprovante." : "Inclui o resumo na mensagem do recibo."}</small></span><input type="checkbox" name="publicity" value="${key}" ${publicConfig[key] ? "checked" : ""}></label>`).join("")}</section></div>`;
  }

  function stepReview(data) {
    const campaign = Campanhas.normalize(data), info = typeInfo(campaign);
    const qualification = campaign.qualification.productIds.length ? "Produto específico" : campaign.qualification.categoryIds.length ? "Categoria específica" : "Todos os produtos";
    const rule = campaign.type === "points" ? `${campaign.rule.pointsAmount === 1 ? "R$ 1" : `R$ ${campaign.rule.pointsAmount}`} = ${campaign.rule.pointsAward} ponto(s)` : campaign.type === "combo" ? `${campaign.rule.requiredItems.length} itens por preço especial` : `Meta de ${campaign.type === "nth_product" ? campaign.rule.requiredPurchases : campaign.rule.requiredQuantity}`;
    const publicity = { catalog: true, receipt: true, whatsapp: true, ...(campaign.publicity || {}) };
    return `<div class="campaign-wizard-pane campaign-review" data-wizard-pane="review"><h3>Confira antes de ativar</h3><aside class="campaign-review-summary">${cover(campaign, true)}<h2>${esc(campaign.name)}</h2><p>${esc(campaign.description)}</p><span class="af-badge af-badge--success">Pronta para ativar</span></aside><div class="campaign-review-sections"><section><header><h4>Como funciona</h4><button type="button" data-edit-step="2">Editar</button></header><p><b>${esc(rule)}</b><br>${esc(qualification)}</p><p>✓ Pago na hora: confirma imediatamente<br>⏳ Fiado: confirma somente quando quitar a venda</p></section><section><header><h4>Recompensas</h4><button type="button" data-edit-step="3">Editar</button></header>${campaign.rewards.map((reward) => `<div class="campaign-review-reward">${icon("gift")}<span><b>${esc(reward.name)}</b><small>${reward.pointsCost ? `${reward.pointsCost} pontos · ` : ""}${reward.quantity} unidade(s) · ${reward.type === "product" ? "Produto do estoque" : "Recompensa externa"}</small></span></div>`).join("") || "<p>Benefício aplicado no carrinho.</p>"}</section><section><header><h4>Público</h4><button type="button" data-edit-step="4">Editar</button></header><p>${campaign.eligibility.audienceType === "all" ? "Todos os clientes · novos clientes também entram" : campaign.eligibility.audienceType === "segment" ? "Segmento do CRM" : `${campaign.eligibility.clientIds.length} clientes específicos`}<br>Acumulação: ${campaign.stacking.allowed ? "Permitida" : "Não permitida"}</p></section><section><header><h4>Período</h4><button type="button" data-edit-step="2">Editar</button></header><p>${date(campaign.startsAt)} → ${date(campaign.endsAt)}</p></section><section><h4>Divulgação</h4><p>${publicity.catalog ? "✓ Catálogo  " : ""}${publicity.receipt ? "✓ Recibo  " : ""}${publicity.whatsapp ? "✓ WhatsApp" : ""}</p></section></div></div>`;
  }

  function readRewardRows(form, keepEmpty = false) {
    return $$('[data-reward-row]', form).map((row, index) => {
      const get = (name) => row.querySelector(`[name="${name}"]`)?.value || "";
      const type = get("rewardType") || "external", productId = type === "product" ? get("rewardProductId") || null : null;
      const product = products().find((entry) => entry.id === productId), variantId = type === "product" ? get("rewardVariantId") || null : null;
      return {
        id: state.wizard.data.rewards?.[index]?.id || `reward-${index + 1}`,
        type,
        productId,
        variantId,
        name: type === "product" ? (product?.nome || "") : get("rewardName").trim(),
        description: get("rewardDescription").trim(),
        quantity: Number(get("rewardQuantity") || 1),
        pointsCost: state.wizard.data.type === "points" ? Number(get("rewardPointsCost") || 0) : 0,
      };
    }).filter((reward) => keepEmpty || (reward.type === "product" ? reward.productId : reward.name));
  }

  function collect() {
    const wizard = state.wizard, data = wizard.data, form = $("#campaign-wizard-form"), fd = new FormData(form);
    if (wizard.step === 1) {
      data.type = fd.get("type") || data.type;
      data.name = String(fd.get("name") || "").trim();
      data.description = String(fd.get("description") || "").trim();
      if (!data.name) throw new Error("Informe o nome da campanha.");
    }
    if (wizard.step === 2) {
      const targetMode = fd.get("targetMode");
      data.qualification = {
        ...(data.qualification || {}),
        productIds: targetMode === "product" && fd.get("productId") ? [fd.get("productId")] : [],
        categoryIds: targetMode === "category" && fd.get("categoryId") ? [fd.get("categoryId")] : [],
        variantIds: targetMode === "product" && fd.get("targetVariantId") ? [fd.get("targetVariantId")] : [],
        paymentPolicy: "confirm_when_settled",
        pointsMode: fd.get("pointsMode") || data.qualification?.pointsMode || "value",
        countMode: fd.get("countMode") || data.qualification?.countMode || "quantity",
        dailyLimit: fd.has("dailyLimit") ? 1 : null,
      };
      const thresholds = String(fd.get("thresholds") || "").split(",").map((part) => part.trim().split(":")).map(([quantity, discountPercent]) => ({ quantity: Number(quantity), discountPercent: Number(discountPercent) })).filter((item) => item.quantity > 0 && item.discountPercent > 0);
      const requiredItems = $$('[data-combo-row]', form).map((row) => ({
        productId: row.querySelector('[name="comboProductId"]')?.value || "",
        variantId: row.querySelector('[name="comboVariantId"]')?.value || null,
        quantity: Number(row.querySelector('[name="comboQuantity"]')?.value || 1),
      })).filter((item) => item.productId);
      data.rule = {
        ...(data.rule || {}),
        requiredQuantity: Number(fd.get("requiredQuantity") || data.rule?.requiredQuantity || 5),
        requiredPurchases: Number(fd.get("requiredPurchases") || data.rule?.requiredPurchases || 5),
        multipleCycles: fd.has("multipleCycles"),
        pointsAmount: Number(fd.get("pointsAmount") || data.rule?.pointsAmount || 1),
        pointsAward: Number(fd.get("pointsAward") || data.rule?.pointsAward || 1),
        pointsExpirationDays: fd.get("pointsExpirationDays") ? Number(fd.get("pointsExpirationDays")) : null,
        thresholds,
        requiredItems,
        comboPrice: Number(fd.get("comboPrice") || 0),
      };
      data.startsAt = fd.get("startsAt");
      data.endsAt = fd.get("endsAt") || null;
    }
    if (wizard.step === 3 && !["quantity_discount", "combo"].includes(data.type)) {
      data.rewards = readRewardRows(form);
      if (!data.rewards.length) throw new Error("Configure ao menos uma recompensa.");
    }
    if (wizard.step === 4) {
      const audienceType = fd.get("audienceType") || "all";
      data.eligibility = { audienceType, clientIds: audienceType === "clients" ? fd.getAll("clientIds") : [], segmentId: audienceType === "segment" ? fd.get("segmentId") || null : null, tagIds: [] };
      if (audienceType === "segment" && !data.eligibility.segmentId) throw new Error("Selecione um segmento do CRM.");
      if (audienceType === "clients" && !data.eligibility.clientIds.length) throw new Error("Selecione ao menos um cliente.");
      data.stacking = { ...(data.stacking || {}), allowed: fd.has("stackingAllowed") };
      const publicity = fd.getAll("publicity");
      data.publicity = { catalog: publicity.includes("catalog"), receipt: publicity.includes("receipt"), whatsapp: publicity.includes("whatsapp") };
      data.published = data.publicity.catalog;
    }
  }

  function openWizard(id) {
    const old = id ? Campanhas.obter(id) : null, pending = old ? null : takePendingAudience();
    const fresh = CampaignEngineV2.normalizeCampaign({ id: Utils.uuid(), type: "buy_get", name: "", description: "", eligibility: pending ? { audienceType: "clients", clientIds: pending.clientIds } : { audienceType: "all" }, status: "active" });
    fresh.rewards = [{ id: "reward-1", type: "external", name: "", description: "", quantity: 1, pointsCost: 100 }];
    state.wizard = { step: 1, editing: Boolean(old), data: old ? structuredClone(old) : fresh };
    renderWizard();
  }

  function showSuccess(campaign) {
    const root = $("#modal");
    root.innerHTML = `<div class="modal-bg"><section class="modal-box campaign-success"><div class="modal-body">${icon("circle-check-big")}<h2>Campanha criada com sucesso</h2><p>${esc(campaign.name)} está pronta para sincronizar.</p><button class="btn btn-primary" data-see-campaign>Ver campanha</button><button class="btn btn-light" data-close-success>Continuar</button></div></section></div>`;
    $("[data-see-campaign]", root).onclick = () => { state.detailId = campaign.id; Modais.fechar(); refresh(); };
    $("[data-close-success]", root).onclick = () => { Modais.fechar(); refresh(); };
    window.lucide?.createIcons();
  }

  function renderWizard() {
    const root = $("#modal"), wizard = state.wizard, data = wizard.data;
    const panes = [stepType, stepRule, stepReward, stepAudience, stepReview];
    root.innerHTML = `<div class="modal-bg"><section class="modal-box modal-wide af-modal af-modal--xl af-wizard campaign-wizard campaign-wizard-v2" role="dialog" aria-modal="true" aria-labelledby="campaign-wizard-title"><header class="modal-head af-modal__header af-wizard__header"><div><small>${wizard.editing ? "Editar" : "Nova"} campanha</small><h3 id="campaign-wizard-title">${["Resultado", "Participação", "Recompensa", "Público e divulgação", "Revisão"][wizard.step - 1]}</h3></div><button class="icon-btn af-icon-button" type="button" data-wizard-close aria-label="Fechar assistente">${icon("x")}</button></header><div class="campaign-wizard-steps af-wizard__steps">${["Objetivo", "Regra", "Prêmio", "Público", "Revisão"].map((label, index) => `<span class="${wizard.step === index + 1 ? "active" : wizard.step > index + 1 ? "completed" : "future"}" data-wizard-step="${index + 1}"><b>${index + 1}</b>${label}</span>`).join("")}</div><form id="campaign-wizard-form" class="af-wizard__form"><input type="hidden" name="type" value="${data.type}"><div class="modal-body af-modal__body af-wizard__content">${panes[wizard.step - 1](data)}</div><footer class="modal-foot af-modal__footer af-wizard__footer">${wizard.step > 1 ? '<button type="button" class="btn btn-light af-button af-button--secondary" data-wizard-back>Voltar</button>' : "<span></span>"}<button class="btn btn-primary af-button af-button--primary">${wizard.step === 5 ? (wizard.editing ? "Salvar alterações" : "Criar campanha") : "Próximo"}</button></footer></form></section></div>`;
    $("[data-wizard-close]", root).onclick = Modais.fechar;
    $("[data-wizard-back]", root)?.addEventListener("click", () => { wizard.step--; renderWizard(); });
    $$('[data-wizard-type]', root).forEach((button) => button.onclick = () => { data.type = button.dataset.wizardType; data.description = Campanhas.TYPES[data.type].description; renderWizard(); });
    $$('[data-reward-row]', root).forEach((row) => {
      const product = row.querySelector('[name="rewardProductId"]'), variant = row.querySelector('[name="rewardVariantId"]');
      const rerenderRewards = () => { data.rewards = readRewardRows(root, true); renderWizard(); };
      row.querySelector('[name="rewardType"]')?.addEventListener("change", rerenderRewards);
      if (product) product.onchange = rerenderRewards;
      if (variant) variant.onchange = rerenderRewards;
    });
    $('[data-add-reward]', root)?.addEventListener("click", () => { data.rewards = readRewardRows(root, true); data.rewards.push({ id: `reward-${data.rewards.length + 1}`, type: "external", name: "", description: "", quantity: 1, pointsCost: (data.rewards.length + 1) * 100 }); renderWizard(); });
    $$('[data-remove-reward]', root).forEach((button) => button.onclick = () => { data.rewards = readRewardRows(root, true); data.rewards.splice(Number(button.dataset.removeReward), 1); renderWizard(); });
    const targetMode = $('[data-target-mode]', root), targetProduct = $('[data-target-product]', root), targetVariant = $('[data-target-variant]', root), targetCategory = $('[data-target-category]', root);
    if (targetMode) targetMode.onchange = () => {
      data.qualification = { ...(data.qualification || {}), productIds: [], variantIds: [], categoryIds: [] };
      if (targetMode.value === "product") data.qualification.productIds = [""];
      if (targetMode.value === "category") data.qualification.categoryIds = [""];
      renderWizard();
    };
    if (targetProduct) targetProduct.onchange = () => {
      data.qualification = { ...(data.qualification || {}), productIds: targetProduct.value ? [targetProduct.value] : [], variantIds: [], categoryIds: [] };
      renderWizard();
    };
    if (targetVariant) targetVariant.onchange = () => { data.qualification = { ...(data.qualification || {}), variantIds: targetVariant.value ? [targetVariant.value] : [] }; };
    if (targetCategory) targetCategory.onchange = () => { data.qualification = { ...(data.qualification || {}), categoryIds: targetCategory.value ? [targetCategory.value] : [] }; };
    $$('[data-combo-row]', root).forEach((row) => {
      const product = row.querySelector('[name="comboProductId"]'), variant = row.querySelector('[name="comboVariantId"]');
      if (product && variant) product.onchange = () => { variant.innerHTML = variantOptions(product.value, ""); };
    });
    $$('[name="audienceType"]', root).forEach((radio) => radio.onchange = () => {
      const fd = new FormData($("#campaign-wizard-form", root));
      data.eligibility = { ...(data.eligibility || {}), audienceType: radio.value, clientIds: fd.getAll("clientIds") };
      renderWizard();
    });
    $('[name="segmentId"]', root)?.addEventListener("change", (event) => { data.eligibility = { ...(data.eligibility || {}), segmentId: event.target.value }; renderWizard(); });
    $('[name="clientSearch"]', root)?.addEventListener("input", (event) => {
      data.eligibility = { ...(data.eligibility || {}), clientIds: new FormData($("#campaign-wizard-form", root)).getAll("clientIds") };
      data._clientSearch = event.target.value;
      clearTimeout(state.clientSearchTimer);
      state.clientSearchTimer = setTimeout(renderWizard, 180);
    });
    $$('[name="clientIds"]', root).forEach((checkbox) => checkbox.onchange = () => { data.eligibility = { ...(data.eligibility || {}), clientIds: new FormData($("#campaign-wizard-form", root)).getAll("clientIds") }; renderWizard(); });
    $$('[data-unselect-client]', root).forEach((button) => button.onclick = () => { data.eligibility.clientIds = (data.eligibility.clientIds || []).filter((id) => id !== button.dataset.unselectClient); renderWizard(); });
    $$('[data-edit-step]', root).forEach((button) => button.onclick = () => { wizard.step = Number(button.dataset.editStep); renderWizard(); });
    $("#campaign-wizard-form", root).onsubmit = (event) => {
      event.preventDefault();
      try {
        collect();
        if (wizard.step < 5) { wizard.step++; renderWizard(); return; }
        showSuccess(Campanhas.salvar(data));
      } catch (error) { Utils.toast(error.message || "Não foi possível salvar a campanha.", true); }
    };
    window.lucide?.createIcons();
  }

  function redeemableRewards(campaign, progress) {
    const points = Number(progress?.availablePoints || 0);
    if (campaign.type === "points") return campaign.rewards.filter((reward) => Number(reward.pointsCost) > 0 && Number(reward.pointsCost) <= points);
    return Number(progress?.availableRewards || 0) > 0 ? campaign.rewards : [];
  }

  function openRedemption(campaignId, clientId) {
    const campaign = Campanhas.obter(campaignId), client = DB.carregar().clientes.find((item) => item.id === clientId), progress = Campanhas.progresso(campaignId, clientId);
    if (!campaign || !client || !progress) return Utils.toast("Não foi possível localizar o progresso desta campanha.", true);
    const rewards = redeemableRewards(campaign, progress), root = $("#modal");
    if (!rewards.length) return Utils.toast("Nenhuma recompensa está disponível para este saldo.", true);
    root.innerHTML = `<div class="modal-bg"><section class="modal-box campaign-redemption-modal"><header class="modal-head"><div><h3>Escolha uma recompensa</h3><p>${esc(client.nome)} possui <b>${Number(progress.availablePoints || progress.availableRewards || 0)}</b> ${campaign.type === "points" ? "pontos disponíveis" : "recompensa(s)"}.</p></div><button class="icon-btn close">${icon("x")}</button></header><div class="modal-body campaign-redemption-options">${rewards.map((reward) => { const stock = rewardStock(reward), unavailable = reward.type === "product" && stock < Number(reward.quantity || 1); return `<article><div>${icon("gift")}<span><b>${esc(reward.name)}</b><small>${reward.pointsCost ? `${reward.pointsCost} pontos` : "Recompensa disponível"}</small><small>${reward.type === "product" ? `Estoque: ${stock}` : "Recompensa externa"}</small></span></div>${unavailable ? '<em>Recompensa indisponível no momento. O produto está sem estoque.</em>' : `<button data-choose-reward="${reward.id}">Resgatar</button>`}</article>`; }).join("")}</div></section></div>`;
    $(".close", root).onclick = Modais.fechar;
    $$('[data-choose-reward]', root).forEach((button) => button.onclick = () => {
      const reward = rewards.find((item) => item.id === button.dataset.chooseReward), before = Number(progress.availablePoints || 0), after = campaign.type === "points" ? before - Number(reward.pointsCost || 0) : Number(progress.availableRewards || 0) - 1, operationId = Utils.uuid();
      const stockBefore = rewardStock(reward);
      root.innerHTML = `<div class="modal-bg"><section class="modal-box campaign-redemption-confirm"><header class="modal-head"><h3>Confirmar resgate</h3><button class="icon-btn close">${icon("x")}</button></header><div class="modal-body">${icon("gift")}<h2>${esc(reward.name)}</h2><p>${reward.pointsCost ? `${reward.pointsCost} pontos` : "1 recompensa"}</p><div><small>Saldo atual</small><b>${before} ${campaign.type === "points" ? "pontos" : "recompensas"}</b></div><div><small>Saldo após resgate</small><b>${after} ${campaign.type === "points" ? "pontos" : "recompensas"}</b></div>${reward.type === "product" ? `<div class="campaign-stock-delivery">${icon("package-check")}<span><b>Produto do estoque</b><small>Você entregará ${Number(reward.quantity || 1)} unidade(s). Estoque: ${stockBefore} → ${stockBefore - Number(reward.quantity || 1)}.</small></span></div>` : `<div class="campaign-stock-delivery">${icon("gift")}<span><b>Recompensa externa</b><small>Registre a entrega combinada com o cliente.</small></span></div>`}</div><footer class="modal-foot"><button class="btn btn-light cancel">Cancelar</button><button class="btn btn-primary confirm">Confirmar resgate</button></footer></section></div>`;
      $$(".close,.cancel", root).forEach((item) => item.onclick = () => openRedemption(campaignId, clientId));
      $(".confirm", root).onclick = () => {
        try {
          Campanhas.resgatar(campaignId, clientId, reward.id, { operationId, businessId: DB.getBusinessId?.() });
          const updated = Campanhas.progresso(campaignId, clientId), remaining = campaign.type === "points" ? Number(updated?.availablePoints || 0) : Number(updated?.availableRewards || 0), stockAfter = rewardStock(reward);
          root.innerHTML = `<div class="modal-bg"><section class="modal-box campaign-redemption-success"><div class="modal-body">${icon("circle-check-big")}<h2>Resgate realizado!</h2><p>O benefício de ${esc(client.nome)} foi registrado com segurança.</p><article>${icon(reward.type === "product" ? "package" : "gift")}<div><b>${esc(reward.name)}</b><small>${reward.pointsCost ? `${reward.pointsCost} pontos utilizados` : `${Number(reward.quantity || 1)} recompensa utilizada`}</small></div></article>${reward.type === "product" ? `<p class="campaign-success-stock">${icon("package-check")} Estoque atualizado: <b>${stockAfter} unidade(s)</b></p>` : ""}<small>Saldo restante</small><strong>${remaining} ${campaign.type === "points" ? "pontos" : "recompensas"}</strong><button class="btn btn-primary" data-close-redemption>Fechar</button></div></section></div>`;
          $("[data-close-redemption]", root).onclick = () => { Modais.fechar(); refresh(); };
          window.lucide?.createIcons();
        } catch (error) { Utils.toast(error.message, true); }
      };
      window.lucide?.createIcons();
    });
    window.lucide?.createIcons();
  }

  function openProgress(campaignId, clientId) {
    const db = DB.carregar(), campaign = Campanhas.obter(campaignId), client = db.clientes.find((item) => item.id === clientId), progress = Campanhas.progresso(campaignId, clientId);
    if (!campaign || !client || !progress) return Utils.toast("Progresso não encontrado.", true);
    const events = (db.eventosCampanha || []).filter((event) => event.campaignId === campaignId && event.clientId === clientId).sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
    const spent = (db.resgatesCampanha || []).filter((item) => item.campaignId === campaignId && item.clientId === clientId).reduce((sum, item) => sum + Number(item.rewardSnapshot?.pointsCost || 0), 0);
    $("#modal").innerHTML = `<div class="modal-bg"><section class="modal-box campaign-progress-modal"><header class="modal-head"><div><h3>${esc(client.nome)}</h3><p>${esc(campaign.name)}</p></div><button class="icon-btn close">${icon("x")}</button></header><div class="modal-body"><section class="campaign-progress-kpis"><span><small>Disponíveis</small><b>${Number(progress.availablePoints || progress.confirmedProgress || 0)}</b></span><span><small>Pendentes</small><b>${Number(progress.pendingPoints || progress.pendingProgress || 0)}</b></span><span><small>Já utilizados</small><b>${spent}</b></span><span><small>Recompensas</small><b>${redeemableRewards(campaign, progress).length}</b></span></section>${Number(progress.pendingPoints || progress.pendingProgress || 0) ? `<p class="campaign-pending-explanation">${Number(progress.pendingPoints || progress.pendingProgress || 0)} ponto(s) aguardando a quitação de compras fiadas.</p>` : ""}<h4>Histórico</h4><div class="campaign-event-timeline">${events.map((event) => `<article><span>${event.transition === "redeemed" ? "−" : event.status === "pending" ? "⏳" : "+"}</span><div><b>${event.transition === "redeemed" ? "Recompensa resgatada" : event.sourceType === "payment" ? "Progresso confirmado pelo pagamento" : event.status === "pending" ? "Compra fiado — pendente" : "Compra confirmada"}</b><small>${Number(event.delta?.points || event.delta?.progress || 0)} · ${new Date(event.createdAt).toLocaleString("pt-BR")}</small></div></article>`).join("") || "<p>Nenhum evento registrado.</p>"}</div></div></section></div>`;
    $("#modal .close").onclick = Modais.fechar;
    window.lucide?.createIcons();
  }

  function bindMetricCarousel() {
    const rail = $(".campaign-metrics"), dots = $$("[data-campaign-metric-dot]");
    if (!rail || !dots.length || !matchMedia("(max-width: 767px)").matches) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const center = rail.scrollLeft + rail.clientWidth / 2;
      const cards = $$('[data-campaign-metric]', rail);
      const active = cards.reduce((best, card, index) => {
        const distance = Math.abs(card.offsetLeft + card.offsetWidth / 2 - center);
        return distance < best.distance ? { index, distance } : best;
      }, { index: 0, distance: Infinity }).index;
      dots.forEach((dot, index) => dot.classList.toggle("active", index === active));
    };
    rail.addEventListener("scroll", () => { if (!frame) frame = requestAnimationFrame(update); }, { passive: true });
    dots.forEach((dot) => dot.addEventListener("click", () => {
      const target = $(`[data-campaign-metric="${dot.dataset.campaignMetricDot}"]`, rail);
      target?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "start" });
    }));
    update();
  }

  function bindMobilePrimaryAction() {
    const button = $("#mobile-client-fab");
    if (!button || button.dataset.campaignActionBound === "true") return;
    button.dataset.campaignActionBound = "true";
    button.addEventListener("click", (event) => {
      const route = window.Router?.atual?.() || location.hash.split("/")[1];
      if (!matchMedia("(max-width: 767px)").matches || route !== "campanhas" || button.dataset.primaryAction !== "new-campaign") return;
      event.preventDefault();
      openWizard();
    });
  }

  function bind() {
    const search = $("#campaign-search");
    if (search) { let timer; search.oninput = (event) => { clearTimeout(timer); state.query = event.target.value; timer = setTimeout(refresh, 140); }; }
    $$('[data-new-campaign]').forEach((button) => button.onclick = () => openWizard());
    $$('[data-campaign-filter]').forEach((button) => button.onclick = () => { state.filter = button.dataset.campaignFilter; refresh(); });
    $("[data-campaign-filter-shortcut]")?.addEventListener("click", () => {
      $("[data-campaign-filter].active")?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
    });
    $$('[data-campaign-details]').forEach((button) => button.onclick = () => { state.detailId = button.dataset.campaignDetails; state.menuId = null; refresh(); });
    $$('[data-campaign-card]').forEach((cardElement) => {
      cardElement.tabIndex = 0;
      cardElement.setAttribute("role", "button");
      cardElement.onclick = (event) => { if (event.target.closest("button,a,input,select")) return; state.detailId = cardElement.dataset.campaignCard; state.menuId = null; refresh(); };
      cardElement.onkeydown = (event) => { if (event.key !== "Enter" && event.key !== " ") return; event.preventDefault(); state.detailId = cardElement.dataset.campaignCard; refresh(); };
    });
    $("[data-campaign-back]")?.addEventListener("click", () => { state.detailId = null; refresh(); });
    $$('[data-campaign-menu]').forEach((button) => button.onclick = (event) => { event.stopPropagation(); state.menuId = state.menuId === button.dataset.campaignMenu ? null : button.dataset.campaignMenu; refresh(); });
    $$('[data-campaign-edit]').forEach((button) => button.onclick = () => openWizard(button.dataset.campaignEdit));
    $$('[data-campaign-duplicate]').forEach((button) => button.onclick = () => { const saved = Campanhas.duplicar(button.dataset.campaignDuplicate); state.detailId = saved.id; refresh(); });
    $$('[data-campaign-status]').forEach((button) => button.onclick = () => { Campanhas.alterarStatus(button.dataset.campaignStatus, button.dataset.status); refresh(); });
    $$('[data-campaign-delete]').forEach((button) => button.onclick = () => Modais.confirmar("campanha", () => { Campanhas.excluir(button.dataset.campaignDelete); state.detailId = null; refresh(); }));
    $$('[data-campaign-redeem]').forEach((button) => button.onclick = () => openRedemption(button.dataset.campaignRedeem, button.dataset.clientId));
    $$('[data-view-progress]').forEach((button) => button.onclick = () => openProgress(button.dataset.viewProgress, button.dataset.clientId));
    $$('[data-detail-tab]').forEach((button) => button.onclick = () => { state.detailTab = button.dataset.detailTab; state.participantPage = 1; refresh(); });
    $$('[data-participant-filter]').forEach((button) => button.onclick = () => { state.participantFilter = button.dataset.participantFilter; state.participantPage = 1; refresh(); });
    $$('[data-participant-page]').forEach((button) => button.onclick = () => { if (button.disabled) return; state.participantPage = Number(button.dataset.participantPage); refresh(); });
    $("#campaign-client-search")?.addEventListener("input", (event) => { state.participantQuery = event.target.value; state.participantPage = 1; clearTimeout(state.participantSearchTimer); state.participantSearchTimer = setTimeout(refresh, 160); });
    bindMetricCarousel();
    bindMobilePrimaryAction();
    window.lucide?.createIcons();
  }

  function dashboard() {
    const metrics = Campanhas.metricas();
    return `<section class="panel campaign-dashboard-widget"><div class="panel-head"><div><h3>Campanhas de fidelidade</h3><small>Engajamento e recompensas</small></div><button class="btn btn-light btn-sm" data-go="campanhas">Ver campanhas</button></div><div><span>${icon("megaphone")}<b>${metrics.active}</b><small>ativas</small></span><span>${icon("users")}<b>${metrics.participants}</b><small>com progresso</small></span><span>${icon("gift")}<b>${metrics.redemptions}</b><small>resgates</small></span></div></section>`;
  }

  window.CampanhasUI = {
    render,
    bind,
    refresh,
    openWizard,
    dashboard,
    takePendingAudience,
    __test: {
      stepReward, stepAudience, stepReview, rewardRow, redeemableRewards, detailPage, progressRows, participantData,
      setParticipantState(value = {}) { Object.assign(state, value); },
    },
  };
})();
