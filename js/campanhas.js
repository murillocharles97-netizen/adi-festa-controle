(function () {
  "use strict";

  const Engine = window.CampaignEngineV2;
  if (!Engine) throw new Error("Campaign Engine V2 não foi carregado.");

  const TYPES = Engine.TYPES;
  const number = (value) => (Number.isFinite(Number(value)) ? Number(value) : 0);
  const now = () => new Date().toISOString();

  function view(raw) {
    const campaign = Engine.normalizeCampaign(raw);
    return {
      ...campaign,
      nome: campaign.name,
      descricao: campaign.description,
      ativo: campaign.active,
      publica: campaign.published,
      startDate: campaign.startsAt,
      endDate: campaign.endsAt || "",
      dataInicio: campaign.startsAt,
      dataFim: campaign.endsAt || "",
      productIds: campaign.qualification.productIds,
      variantIds: campaign.qualification.variantIds,
      categoryIds: campaign.qualification.categoryIds,
      rewardProductId: campaign.rewards.find((reward) => reward.type === "product")?.productId || "",
      audience: {
        type: campaign.eligibility.audienceType,
        clientIds: campaign.eligibility.clientIds,
        segmentId: campaign.eligibility.segmentId,
        tags: campaign.eligibility.tagIds,
      },
      rules: {
        requiredQuantity: campaign.rule.requiredQuantity,
        requiredPurchases: campaign.rule.requiredPurchases,
        multipleCycles: campaign.rule.multipleCycles,
        pointsPerReal: campaign.rule.pointsAward / Math.max(0.01, campaign.rule.pointsAmount),
        pointsAmount: campaign.rule.pointsAmount,
        pointsAward: campaign.rule.pointsAward,
        rewardPoints: campaign.rewards[0]?.pointsCost || 0,
        thresholds: campaign.rule.thresholds,
        requiredItems: campaign.rule.requiredItems,
        comboProductIds: campaign.rule.requiredItems.map((item) => item.productId),
        comboPrice: campaign.rule.comboPrice,
        rewardQuantity: campaign.rewards[0]?.quantity || 1,
      },
    };
  }

  const all = () => (DB.carregar().campanhas || []).map(view);
  const get = (id) => all().find((campaign) => campaign.id === id) || null;
  const active = () => all().filter((campaign) => Engine.campaignStatus(campaign) === "active");
  const status = (campaign) => ({
    active: "ativa",
    scheduled: "agendada",
    paused: "pausada",
    ended: "encerrada",
  }[Engine.campaignStatus(campaign)] || "encerrada");

  function canonical(data) {
    const base = Engine.normalizeCampaign({
      ...data,
      startsAt: data.startsAt || data.startDate || data.dataInicio,
      endsAt: data.endsAt || data.endDate || data.dataFim || null,
      active: data.active ?? data.ativo,
      published: data.published ?? data.publica,
      eligibility: data.eligibility || (data.audience ? {
        audienceType: data.audience.type,
        clientIds: data.audience.clientIds,
        segmentId: data.audience.segmentId,
        tagIds: data.audience.tags,
      } : undefined),
      qualification: data.qualification || {
        productIds: data.productIds || [],
        variantIds: data.variantIds || [],
        categoryIds: data.categoryIds || [],
        paymentPolicy: "confirm_when_settled",
        countMode: data.rules?.countMode || "quantity",
        dailyLimit: data.rules?.dailyLimit ?? null,
        pointsMode: data.rules?.pointsMode || "value",
      },
      rule: data.rule || {
        requiredQuantity: data.rules?.requiredQuantity,
        requiredPurchases: data.rules?.requiredPurchases,
        multipleCycles: data.rules?.multipleCycles ?? true,
        pointsAmount: data.rules?.pointsAmount || 1,
        pointsAward: data.rules?.pointsAward || data.rules?.pointsPerReal,
        pointsMode: data.rules?.pointsMode,
        thresholds: data.rules?.thresholds,
        requiredItems: data.rules?.requiredItems,
        comboPrice: data.rules?.comboPrice,
        countMode: data.rules?.countMode,
      },
    });
    const oldReward = data.rewardProductId || data.produtoPremioId;
    if ((!Array.isArray(data.rewards) || !data.rewards.length) && oldReward) {
      base.rewards = [{
        id: "reward-1",
        type: "product",
        productId: oldReward,
        variantId: data.rewardVariantId || null,
        quantity: Math.max(1, number(data.rules?.rewardQuantity || 1)),
        name: data.rewardName || "Produto grátis",
        description: "",
        pointsCost: Math.max(0, number(data.rules?.rewardPoints || 0)),
      }];
    }
    return base;
  }

  function save(data) {
    if (!data.id && window.PlanLimitService) {
      PlanLimitService.assert(PlanLimitService.canUseCampaigns(), "usar campanhas");
    }
    if (!Object.hasOwn(TYPES, data.type || data.tipo)) throw new Error("Selecione um dos cinco tipos oficiais de campanha.");
    let stored;
    DB.alterar((db) => {
      const campaign = canonical(data);
      const index = (db.campanhas || []).findIndex((item) => item.id === campaign.id);
      const old = index >= 0 ? db.campanhas[index] : null;
      stored = {
        ...campaign,
        id: campaign.id,
        operationId: campaign.operationId || old?.operationId || campaign.id,
        createdAt: old?.createdAt || campaign.createdAt || now(),
        updatedAt: now(),
      };
      db.campanhas ||= [];
      if (index >= 0) db.campanhas[index] = stored;
      else db.campanhas.push(stored);
    });
    return view(stored);
  }

  function setStatus(id, value) {
    const current = get(id);
    if (!current) throw new Error("Campanha não encontrada.");
    const mapped = { ativa: "active", agendada: "active", pausada: "paused", encerrada: "ended" }[value] || value;
    return save({ ...current, status: mapped, active: mapped !== "ended" });
  }

  function duplicate(id) {
    const source = get(id);
    if (!source) throw new Error("Campanha não encontrada.");
    return save({
      ...source,
      id: Utils.uuid(),
      operationId: Utils.uuid(),
      name: `${source.name} (cópia)`,
      status: "paused",
      startsAt: Engine.dayKey(Date.now()),
      endsAt: null,
      createdAt: now(),
    });
  }

  function remove(id) {
    DB.alterar((db) => {
      const campaign = db.campanhas.find((item) => item.id === id);
      if (!campaign) return;
      campaign.active = false;
      campaign.status = "ended";
      campaign.deletedAt = now();
      campaign.updatedAt = campaign.deletedAt;
    });
  }

  function cartEvaluation(items, clientId, options = {}) {
    const db = DB.carregar();
    const client = (db.clientes || []).find((item) => item.id === clientId);
    if (!client) return { evaluations: [], progress: [], benefits: [], appliedBenefits: [], conflicts: [] };
    const segmentClientIdsById = Object.fromEntries((db.segmentosClientes || []).map((segment) => [
      String(segment.id),
      (segment.clientIds || segment.clienteIds || []).map(String),
    ]));
    const sale = { itens: items || [], data: now(), status: options.status || "pago" };
    const evaluations = active().map((campaign) => Engine.evaluateOne(campaign, sale, {
      client,
      products: db.produtos,
      events: db.eventosCampanha || [],
      segmentClientIds: options.segmentClientIds,
      segmentClientIdsById,
    })).filter(Boolean);
    return { evaluations, ...Engine.resolveConflicts(evaluations, options.selectedCampaignIds || []) };
  }

  function cartSummary(items, clientId, selectedCampaignIds = [], status = "pago") {
    const evaluated = cartEvaluation(items, clientId, { selectedCampaignIds });
    const selected = new Set(selectedCampaignIds);
    return evaluated.evaluations.map((entry) => {
      const opportunity = entry.opportunity;
      const conflict = evaluated.conflicts.some((group) => group.campaignIds.includes(entry.campaign.id));
      let message = "Esta compra gera progresso na campanha.";
      if (entry.points) message = `${entry.points} ponto(s) serão ${status === "fiado" ? "mantidos pendentes" : "adicionados"}.`;
      if (opportunity?.kind === "quantity_discount") {
        message = opportunity.available
          ? `${opportunity.discountPercent}% disponível.`
          : `Falta${opportunity.missingQuantity === 1 ? "" : "m"} ${opportunity.missingQuantity} unidade(s) para liberar ${opportunity.nextDiscountPercent}%.`;
      }
      if (opportunity?.kind === "combo") message = opportunity.available ? "Combo disponível." : "Adicione os itens do combo para liberar o preço especial.";
      return {
        campaignId: entry.campaign.id,
        name: entry.campaign.name,
        type: entry.campaign.type,
        message,
        benefit: Boolean(opportunity?.available),
        requiresSelection: Boolean(opportunity?.available || conflict),
        conflict,
        conflictGroup: entry.campaign.stacking.conflictGroup || "sale-benefit",
        selected: selected.has(entry.campaign.id),
        stackingAllowed: entry.campaign.stacking.allowed,
      };
    });
  }

  function applyBenefits(items, clientId, options = {}) {
    const result = (items || []).map((item) => ({ ...item, campaignDiscounts: [] }));
    if (options.manualAdjustment || !clientId) return result;
    const evaluation = cartEvaluation(result, clientId, options);
    for (const entry of evaluation.appliedBenefits) {
      if (entry.campaign.type === "quantity_discount") {
        const matched = Engine.matchingItems(entry.campaign, result, DB.carregar().produtos);
        const factor = Math.max(0, 1 - entry.opportunity.discountPercent / 100);
        for (const item of matched) {
          const base = number(item.precoOriginal ?? item.precoFinalUnitario ?? item.precoUnitario);
          item.precoFinalUnitario = Number((base * factor).toFixed(4));
          item.campaignDiscounts.push({ campaignId: entry.campaign.id, type: "quantity_discount", percent: entry.opportunity.discountPercent });
        }
      }
      if (entry.campaign.type === "combo") {
        const cycles = entry.opportunity.cycles;
        const required = entry.campaign.rule.requiredItems;
        const selected = [];
        for (const requirement of required) {
          let left = requirement.quantity * cycles;
          for (const item of result.filter((candidate) => candidate.produtoId === requirement.productId && (!requirement.variantId || candidate.variantId === requirement.variantId))) {
            const used = Math.min(left, number(item.quantidade));
            if (used) selected.push({ item, used });
            left -= used;
            if (left <= 0) break;
          }
        }
        const original = selected.reduce((sum, entryItem) => sum + entryItem.used * number(entryItem.item.precoOriginal ?? entryItem.item.precoFinalUnitario), 0);
        const target = entry.campaign.rule.comboPrice * cycles;
        const factor = original ? Math.min(1, target / original) : 1;
        for (const { item } of selected) {
          const base = number(item.precoOriginal ?? item.precoFinalUnitario);
          item.precoFinalUnitario = Number((base * factor).toFixed(4));
          item.campaignDiscounts.push({ campaignId: entry.campaign.id, type: "combo", cycles, comboPrice: entry.campaign.rule.comboPrice });
        }
      }
    }
    return result;
  }

  function applySaleInDb(db, sale) {
    const result = Engine.applySale(db, sale);
    sale.campaignEvents = result.events.map((event) => event.id);
    sale.campaignSnapshot = result.snapshots;
    sale.campaignReceiptSummary = Engine.receiptSummary(result.snapshots);
    sale.campaignConflicts = result.conflicts;
    return result.snapshots;
  }

  const validateReverseSaleInDb = (db, sale) => Engine.validateSaleReversal(db, sale);
  const reverseSaleInDb = (db, sale, options) => Engine.reverseSale(db, sale, options);
  const saleReversalImpactInDb = (db, sale) => Engine.saleReversalImpact(db, sale);

  function redeem(campaignId, clientId, rewardId, options = {}) {
    let redemption;
    DB.alterar((db) => {
      const draft = structuredClone(db);
      redemption = Engine.redeem(draft, campaignId, clientId, rewardId, options);
      Object.assign(db, draft);
    });
    return redemption;
  }

  function approveRequest(requestId) {
    const request = (DB.carregar().recompensas || []).find((item) => item.id === requestId && item.tipo === "solicitacao_resgate");
    if (!request || request.status !== "solicitado") throw new Error("Solicitação não encontrada ou já processada.");
    const client = DB.carregar().clientes.find((item) => item.id === (request.clientId || request.clienteId) || item.portalRefToken === request.clientRefToken);
    if (!client) throw new Error("Cliente da solicitação não encontrado.");
    let redemption;
    DB.alterar((db) => {
      const draft = structuredClone(db);
      redemption = Engine.redeem(draft, request.campaignId || request.campanhaId, client.id, request.rewardId, { operationId: `request:${request.id}` });
      const current = draft.recompensas.find((item) => item.id === requestId);
      current.clientId = current.clienteId = client.id;
      current.status = "resgatado";
      current.redemptionId = redemption.id;
      current.updatedAt = now();
      Object.assign(db, draft);
    });
    return redemption;
  }

  function metrics() {
    const db = DB.carregar();
    const campaigns = all();
    const activeCampaigns = campaigns.filter((campaign) => status(campaign) === "ativa");
    const progress = db.progressosCampanha || [];
    const redemptions = db.resgatesCampanha || [];
    const participants = new Set(progress.filter((item) => activeCampaigns.some((campaign) => campaign.id === item.campaignId)).map((item) => item.clientId)).size;
    const campaignStats = activeCampaigns.map((campaign) => campaignMetrics(campaign.id));
    return {
      active: activeCampaigns.length,
      participants,
      redemptions: redemptions.length,
      distributed: redemptions.filter((item) => item.rewardSnapshot?.type === "product").reduce((sum, item) => sum + number(item.rewardSnapshot?.quantity || 1), 0),
      conversion: participants ? (redemptions.length / participants) * 100 : 0,
      eligible: new Set(activeCampaigns.flatMap((campaign) => eligibleClients(campaign, db).map((client) => client.id))).size,
      nearReward: activeCampaigns.reduce((sum, campaign) => sum + progress.filter((item) => item.campaignId === campaign.id && window.EngagementSegments?.isNearReward?.(campaign, item)).length, 0),
      redeemable: campaignStats.reduce((sum, item) => sum + number(item?.redeemable), 0),
      rewardsAvailable: campaignStats.reduce((sum, item) => sum + number(item?.rewardsAvailable), 0),
    };
  }

  function campaignMetrics(id) {
    const db = DB.carregar();
    const campaign = get(id);
    if (!campaign) return null;
    const segmentClientIdsById = Object.fromEntries((db.segmentosClientes || []).map((segment) => [
      String(segment.id),
      (segment.clientIds || segment.clienteIds || []).map(String),
    ]));
    return Engine.campaignMetrics(db, campaign, {
      businessId: DB.getBusinessId?.() || null,
      segmentClientIdsById,
    });
  }

  function eligibleClients(rawCampaign, data = DB.carregar()) {
    const campaign = canonical(rawCampaign);
    const segmentClientIdsById = Object.fromEntries((data.segmentosClientes || []).map((segment) => [
      String(segment.id),
      (segment.clientIds || segment.clienteIds || []).map(String),
    ]));
    return (data.clientes || []).filter((client) => Engine.eligible(campaign, client, { segmentClientIdsById }));
  }

  function getProgress(campaignId, clientId) {
    const db = DB.carregar();
    const index = Engine.findProgressIndex(db, campaignId, clientId, DB.getBusinessId?.());
    return index >= 0 ? db.progressosCampanha[index] : null;
  }

  window.Campanhas = {
    ENGINE_VERSION: Engine.VERSION,
    TYPES,
    normalize: view,
    listar: all,
    obter: get,
    ativas: active,
    status,
    elegivel: (campaign, client, context) => Engine.eligible(campaign, client, context),
    elegiveis: eligibleClients,
    salvar: save,
    alterarStatus: setStatus,
    duplicar: duplicate,
    excluir: remove,
    avaliarCarrinho: cartEvaluation,
    resumoCarrinho: cartSummary,
    aplicarBeneficios: applyBenefits,
    aplicarVendaNoBanco: applySaleInDb,
    validarReversaoVendaNoBanco: validateReverseSaleInDb,
    impactoReversaoVendaNoBanco: saleReversalImpactInDb,
    reverterVendaNoBanco: reverseSaleInDb,
    resgatar: redeem,
    aprovarSolicitacao: approveRequest,
    metricas: metrics,
    metricasCampanha: campaignMetrics,
    progresso: getProgress,
  };
})();
