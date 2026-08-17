(function () {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector),
    $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const esc = (value) =>
      window.Utils?.escapar?.(String(value ?? "")) ?? String(value ?? ""),
    icon = (name) => `<i data-lucide="${name}"></i>`,
    money = (value) =>
      Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });
  const DAY = 86400000,
    routeFeatures = {
      campanhas: "campaigns",
      visitas: "onlineCatalog",
      catalogo: "onlineCatalog",
      pedidos: "onlineOrders",
    };
  const featureLabels = {
    products: "Produtos e estoque",
    stock: "Controle de estoque",
    sales: "Vendas e pagamentos",
    clients: "Clientes e fiado",
    creditAccounts: "Contas a receber",
    payments: "Pagamentos",
    barcode: "Código de barras",
    cloudBackup: "Sincronização em nuvem",
    recentHistory: "Histórico recente",
    reports: "Relatórios",
    receipts: "Recibos",
    campaigns: "Campanhas e fidelidade",
    crm: "CRM e segmentos",
    crmExport: "Exportação de CRM",
    onlineCatalog: "Catálogo online",
    onlineOrders: "Pedidos online",
    bulkMessages: "Mensagens e cobranças",
    loyalty: "Benefícios de fidelidade",
    advancedStock: "Estoque avançado",
    dataImport: "Importação de dados",
    advancedReports: "Relatórios avançados",
    multipleUsers: "Usuários adicionais",
    rolesPermissions: "Perfis e permissões",
    advancedExports: "Exportações avançadas",
    automations: "Automações",
    prioritySupport: "Suporte prioritário",
  };
  const proDetails = {
    campaigns: {
      title: "Campanhas fazem parte do Plano Profissional",
      text: "Crie promoções, programas de fidelidade e recompensas para seus clientes.",
      benefits: [
        "Compre X e ganhe Y",
        "Acúmulo de pontos",
        "Controle de resgates",
      ],
    },
    onlineCatalog: {
      title: "Catálogo online faz parte do Plano Profissional",
      text: "Compartilhe seus produtos e receba pedidos pelo celular.",
      benefits: [
        "Catálogo público",
        "Carrinho do cliente",
        "Link para compartilhar",
      ],
    },
    onlineOrders: {
      title: "Pedidos online fazem parte do Plano Profissional",
      text: "Receba e acompanhe pedidos enviados pelo catálogo.",
      benefits: ["Fila de pedidos", "Status do pedido", "Conversão em venda"],
    },
    "sales.create": {
      title: "Novas vendas precisam de uma assinatura ativa",
      text: "Suas vendas e os demais dados continuam disponíveis para consulta.",
      benefits: [
        "Registrar novas vendas",
        "Atualizar estoque",
        "Gerar recibos",
      ],
    },
    "customers.create": {
      title: "Cadastro de clientes",
      text: "Seus clientes atuais continuam visíveis. Escolha um plano para cadastrar novos clientes.",
      benefits: [
        "Novos cadastros",
        "Histórico de relacionamento",
        "Dados preservados",
      ],
    },
    "products.create": {
      title: "Cadastro de produtos",
      text: "Seus produtos continuam visíveis. Escolha um plano para adicionar novos itens.",
      benefits: [
        "Novos produtos",
        "Variações e estoque",
        "Uso no ponto de venda",
      ],
    },
  };
  let options = {},
    couponQuote = null;
  function context() {
    const state = window.BusinessContext?.get?.() || {},
      session = window.FirebaseSession || {},
      subscription = state.subscription || session.subscription || {},
      access = state.access || session.access || {},
      business = state.business || session.business || {},
      status = String(
        subscription.subscriptionStatus ||
          subscription.status ||
          access.status ||
          "inactive",
      )
        .toLowerCase()
        .replace("cancelled", "canceled");
    return {
      state,
      session,
      subscription,
      access,
      business,
      status,
      internal:
        access.internal === true ||
        (subscription.planId === "internal" &&
          ["active", "internal"].includes(status)),
    };
  }
  function plans() {
    return (
      window.SubscriptionService?.getPlans?.() ||
      window.SubscriptionService?.plans?.() ||
      []
    ).filter(
      (plan) =>
        plan &&
        plan.active !== false &&
        plan.hidden !== true &&
        !["internal", "trial"].includes(plan.id),
    );
  }
  function toDate(value) {
    if (!value) return null;
    const date =
      typeof value.toDate === "function" ? value.toDate() : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  }
  const dateLabel = (value) =>
    toDate(value)?.toLocaleDateString("pt-BR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }) || "";
  function usage(ctx) {
    const db = window.DB?.carregar?.() || {},
      month = new Date().toISOString().slice(0, 7),
      limits = ctx.access.limits || ctx.business.limits || {};
    return [
      {
        label: "Produtos",
        value: (db.produtos || []).filter((item) => item.ativo !== false)
          .length,
        limit: limits.products,
      },
      {
        label: "Clientes",
        value: (db.clientes || []).filter((item) => item.ativo !== false)
          .length,
        limit: limits.clients,
      },
      {
        label: "Vendas no mês",
        value: (db.vendas || []).filter(
          (item) =>
            String(item.data || item.createdAt || "").slice(0, 7) === month,
        ).length,
        limit: limits.monthlySales,
      },
    ];
  }
  function usageMarkup(ctx) {
    if (!ctx.subscription.planId) return "";
    return `<section class="plan-usage"><h2>Uso atual</h2><div>${usage(ctx)
      .map((item) => {
        const finite = Number.isFinite(Number(item.limit)),
          percent = finite
            ? Math.min(
                100,
                (item.value / Math.max(1, Number(item.limit))) * 100,
              )
            : 0;
        return `<article><span><b>${esc(item.label)}</b><em>${item.value}${finite ? ` de ${Number(item.limit).toLocaleString("pt-BR")}` : " · ilimitado"}</em></span>${finite ? `<i><u style="--usage:${percent}%"></u></i>` : ""}</article>`;
      })
      .join("")}</div></section>`;
  }
  function stateHero(ctx, publicMode) {
    if (publicMode || !ctx.subscription.planId)
      return `<section class="plan-state-hero state-trial"><span class="plan-state-badge">${icon("sparkles")} Teste grátis</span><div class="plan-state-main"><i>${icon("party-popper")}</i><div><h2>Comece com 7 dias para conhecer o app</h2><p>O teste é ativado na criação da empresa e não exige cartão.</p></div></div><div class="plan-state-note">${icon("info")} Depois do teste, seus dados ficam preservados no modo leitura até você escolher um plano.</div></section>`;
    if (ctx.internal)
      return `<section class="plan-state-hero state-internal"><span class="plan-state-badge">${icon("shield-check")} Conta interna</span><div class="plan-state-main"><i>${icon("crown")}</i><div><h2>Todos os recursos estão liberados</h2><p>Conta isenta de cobrança, sem vencimento e sem preço comercial associado.</p></div></div><div class="plan-state-note">${icon("circle-check")} Acesso interno confirmado pelo contexto da empresa.</div></section>`;
    const s = ctx.subscription,
      start = toDate(s.trialStartedAt || s.startedAt),
      end = toDate(s.trialEndsAt),
      trial = ["trial", "trialing"].includes(ctx.status),
      remaining = end
        ? Math.max(0, Math.ceil((end - Date.now()) / DAY))
        : Math.max(0, Number(ctx.access.daysRemaining || 0)),
      total =
        start && end
          ? Math.max(1, Math.ceil((end - start) / DAY))
          : Number(s.trialDays || 7),
      used = Math.max(0, total - remaining),
      percent = Math.min(100, (used / Math.max(1, total)) * 100);
    if (trial && remaining > 0)
      return `<section class="plan-state-hero state-trial"><span class="plan-state-badge">${icon("star")} Teste grátis ativo</span><div class="plan-state-main"><i>${icon("party-popper")}</i><div><h2>${remaining === 1 ? "Último dia do seu teste" : "Você está no período de teste"}</h2><p>Recursos do plano ${esc(ctx.access.effectivePlan?.name || "Profissional")} liberados até ${dateLabel(end) || "o fim do período"}.</p></div></div><div class="trial-facts"><span>${icon("gift")}<b>${total} dias grátis</b></span><span>${icon("clock-3")}<b>Faltam ${remaining} ${remaining === 1 ? "dia" : "dias"}</b></span></div><div class="trial-progress"><i><u style="--usage:${percent}%"></u></i><small>${used} de ${total} dias utilizados</small></div><div class="plan-state-note">${icon("info")} Após o teste, o app continua em <b>modo leitura</b> até você escolher um plano.</div></section>`;
    const current = plans().find((plan) => plan.id === s.planId),
      period = dateLabel(
        s.currentPeriodEnd || s.nextBillingDate || s.nextPaymentDate,
      ),
      statusLabel =
        {
          active: "Assinatura ativa",
          past_due: "Pagamento pendente",
          grace_period: "Período de regularização",
          pending: "Pagamento em processamento",
          canceled: "Assinatura cancelada",
          expired: "Teste ou assinatura expirados",
          inactive: "Assinatura inativa",
          paused: "Assinatura pausada",
          suspended: "Assinatura suspensa",
        }[ctx.status] || "Status da assinatura",
      danger = [
        "past_due",
        "canceled",
        "expired",
        "inactive",
        "paused",
        "suspended",
      ].includes(ctx.status),
      tone =
        ctx.status === "active"
          ? "state-active"
          : danger
            ? "state-expired"
            : "state-pending";
    return `<section class="plan-state-hero ${tone}"><span class="plan-state-badge">${icon(ctx.status === "active" ? "badge-check" : danger ? "circle-alert" : "clock-3")} ${esc(statusLabel)}</span><div class="plan-state-main"><i>${icon(ctx.status === "active" ? "gem" : danger ? "lock-keyhole" : "credit-card")}</i><div><h2>${ctx.status === "active" ? `${esc(current?.name || s.planId || "Plano")} está ativo` : esc(statusLabel)}</h2><p>${ctx.status === "active" ? (period ? `Próximo período em ${period}.` : "O acesso está liberado conforme o status confirmado no Firebase.") : "Seus dados permanecem preservados e disponíveis para consulta."}</p></div></div>${s.cancelAtPeriodEnd && period ? `<div class="plan-state-note warning">${icon("calendar-x")} Cancelamento agendado para ${period}.</div>` : ctx.access.readOnly ? `<div class="plan-state-note warning">${icon("eye")} O app está em modo leitura. Regularize ou escolha um plano para voltar a criar dados.</div>` : `<div class="plan-state-note">${icon("circle-check")} Status confirmado pela assinatura da empresa.</div>`}<button type="button" class="plan-manage-button" data-manage-plan>${icon("settings-2")} Gerenciar assinatura</button></section>`;
  }
  function planFeatures(plan) {
    return Object.entries(plan.features || {})
      .filter(([key, value]) => value === true && featureLabels[key])
      .slice(0, plan.id === "essential" ? 5 : 6)
      .map(
        ([key]) =>
          `<li>${icon("circle-check")} ${esc(featureLabels[key])}</li>`,
      )
      .join("");
  }
  function planCard(plan, ctx, publicMode) {
    const current =
        ctx.status === "active" && ctx.subscription.planId === plan.id,
      limit = plan.limits || {},
      action = ctx.internal
        ? '<button type="button" class="plan-select" disabled>Conta isenta de cobrança</button>'
        : `<button type="button" class="plan-select ${plan.recommended ? "primary" : ""}" ${current ? "data-manage-plan" : `data-plan-cta="${esc(plan.id)}"`}>${publicMode ? "Criar minha conta" : current ? "Gerenciar plano" : "Escolher plano"}</button>`;
    return `<article class="plan-offer ${current ? "is-current" : ""} ${plan.recommended ? "is-popular" : ""}" data-plan-card="${esc(plan.id)}">${plan.recommended ? '<span class="plan-popular">★ Mais popular</span>' : ""}<header><i>${icon(plan.id === "essential" ? "send" : plan.id === "professional" ? "gem" : "crown")}</i><div><h2>${esc(plan.name)}</h2><p>${esc(plan.summary || "")}</p></div></header><div class="plan-offer-price"><small>R$</small><b>${Number(
      plan.monthlyPrice || 0,
    )
      .toFixed(2)
      .replace(
        ".",
        ",",
      )}</b><span>/mês</span></div><small class="plan-year-price">ou ${money(plan.yearlyPrice)} por ano</small>${current ? '<em class="plan-current">Plano atual</em>' : ""}<ul>${planFeatures(plan)}</ul><p class="plan-limit-copy">${Number(limit.users || 1)} usuário${Number(limit.users || 1) === 1 ? "" : "s"} · ${Number(limit.products || 0).toLocaleString("pt-BR")} produtos · ${Number(limit.monthlySales || 0).toLocaleString("pt-BR")} vendas/mês</p>${action}</article>`;
  }
  function couponBox(available, ctx, publicMode) {
    if (publicMode || ctx.internal) return "";
    return `<details class="plan-coupon" ${couponQuote ? "open" : ""}><summary>${icon("ticket-percent")}<span><b>Possui um cupom?</b><small>Validação segura no servidor.</small></span>${icon("chevron-down")}</summary><div><label>Código<input data-coupon-code maxlength="40" autocomplete="off" value="${esc(couponQuote?.code || "")}" placeholder="DIGITE O CÓDIGO"></label><label>Plano<select data-coupon-plan>${available.map((plan) => `<option value="${esc(plan.id)}" ${couponQuote?.planId === plan.id ? "selected" : ""}>${esc(plan.name)}</option>`).join("")}</select></label><label>Periodicidade<select data-coupon-cycle><option value="monthly">Mensal</option><option value="yearly" ${couponQuote?.billingCycle === "yearly" ? "selected" : ""}>Anual</option></select></label><button type="button" data-apply-coupon>Aplicar cupom</button><div data-coupon-feedback>${couponQuote ? couponSummary(couponQuote) : ""}</div></div></details>`;
  }
  function couponSummary(quote) {
    return `<section class="coupon-applied">${icon("badge-check")}<div><b>${esc(quote.code)} aplicado</b><p>De <s>${money(quote.originalPrice)}</s> por <strong>${money(quote.discountedPrice)}</strong></p><small>${esc(quote.durationLabel || "Condição validada")}</small></div><button type="button" data-remove-coupon>Remover</button></section>`;
  }
  function render(renderOptions = {}) {
    options = renderOptions;
    const ctx = context(),
      publicMode = Boolean(renderOptions.publicMode),
      available = plans(),
      showBack = publicMode || renderOptions.authMode;
    return `<section class="plans-page-v2 ${publicMode ? "public-plans-page" : ""}" data-plans-root><header class="plans-page-heading">${showBack ? `<button type="button" data-plans-back aria-label="Voltar">${icon("arrow-left")}</button>` : ""}<div><h1>Planos</h1><p>Escolha o plano ideal para continuar usando o app.</p></div></header>${stateHero(ctx, publicMode)}${usageMarkup(ctx)}<section class="plan-offers" data-plans-carousel>${available.map((plan) => planCard(plan, ctx, publicMode)).join("")}</section><div class="plan-indicators">${available.map((plan, index) => `<button type="button" data-plan-indicator="${index}" aria-label="Mostrar ${esc(plan.name)}"></button>`).join("")}</div><button class="plan-compare-button" type="button" data-full-comparison>${icon("list-checks")} Comparar todos os recursos</button>${couponBox(available, ctx, publicMode)}<section class="plan-faq"><h2>${icon("circle-help")} Dúvidas frequentes</h2>${[
      [
        "O que acontece quando o teste acaba?",
        "Seus dados são preservados e o app passa para modo leitura até a contratação.",
      ],
      [
        "Posso trocar depois?",
        "A mudança depende das opções disponíveis na assinatura e mantém os dados da empresa.",
      ],
      [
        "Como o pagamento é confirmado?",
        "O Mercado Pago processa a cobrança e o Firebase recebe o status oficial pelo backend.",
      ],
    ]
      .map(
        ([q, a]) =>
          `<details><summary>${esc(q)}${icon("chevron-down")}</summary><p>${esc(a)}</p></details>`,
      )
      .join(
        "",
      )}</section><p class="plan-payment-note">${icon("shield-check")} Pagamento processado com segurança pelo Mercado Pago. O aplicativo usa o status oficial do Firebase.</p>${publicMode ? '<div class="public-plan-actions"><button data-public-register>Começar teste grátis</button><button data-public-login>Entrar na minha conta</button></div>' : ""}</section>`;
  }
  function fullComparison() {
    const available = plans(),
      features = [
        "products",
        "clients",
        "sales",
        "campaigns",
        "crm",
        "onlineCatalog",
        "onlineOrders",
        "multipleUsers",
        "advancedReports",
      ],
      root = $("#modal");
    if (!root) return;
    root.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal plan-comparison-sheet"><header class="modal-head"><div><h3>Comparação completa</h3><small>Recursos conforme a configuração atual.</small></div><button class="icon-btn mobile-icon-button" data-close-comparison>${icon("x")}</button></header><div class="modal-body"><div class="plan-comparison-table comparison-limit-row"><header><b>Recurso</b>${available.map((plan) => `<b>${esc(plan.name)}</b>`).join("")}</header>${features.map((feature) => `<p><span>${esc(featureLabels[feature])}</span>${available.map((plan) => `<i>${plan.features?.[feature] ? icon("check") : "—"}</i>`).join("")}</p>`).join("")}</div></div></section></div>`;
    $("[data-close-comparison]", root).onclick = () => (root.innerHTML = "");
    window.lucide?.createIcons();
  }
  function openProModal(feature, decision = {}) {
    const detail = proDetails[feature] || {
        title: "Recurso disponível em outro plano",
        text: "Seus dados existentes continuam preservados.",
        benefits: ["Mais recursos", "Dados preservados", "Consulta liberada"],
      },
      root = $("#modal");
    if (!root) return;
    root.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal pro-feature-modal"><header class="modal-head"><div><h3>${esc(detail.title)}</h3><small>Seu acesso atual não inclui esta ação.</small></div><button class="icon-btn mobile-icon-button" data-close-pro>${icon("x")}</button></header><div class="modal-body"><p>${esc(detail.text)}</p>${decision.kind === "limit" ? `<p>Limite atual: <b>${esc(decision.limit)}</b>. Uso: <b>${esc(decision.current || 0)}</b>.</p>` : ""}<ul>${detail.benefits.map((item) => `<li>${icon("circle-check")} ${esc(item)}</li>`).join("")}</ul></div><footer class="modal-foot"><button class="btn btn-light mobile-button" data-close-pro>Agora não</button><button class="btn btn-primary mobile-button primary" data-pro-plans>Ver planos</button></footer></section></div>`;
    $$("[data-close-pro]", root).forEach(
      (button) => (button.onclick = () => (root.innerHTML = "")),
    );
    $("[data-pro-plans]", root).onclick = () => {
      root.innerHTML = "";
      window.Router?.ir?.("planos");
    };
    window.lucide?.createIcons();
  }
  function manageSubscription() {
    const ctx = context(),
      root = $("#modal");
    if (!root) return;
    root.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal plan-manage-sheet"><header class="modal-head"><div><h3>Gerenciar assinatura</h3><small>Status: ${esc(ctx.status)}</small></div><button class="icon-btn mobile-icon-button" data-close-billing>${icon("x")}</button></header><div class="modal-body"><button type="button" data-refresh-subscription>${icon("refresh-cw")} Atualizar do Firebase</button><button type="button" data-reconcile-subscription>${icon("cloud-cog")} Conferir com Mercado Pago</button>${!ctx.internal && ctx.status === "active" ? `<button type="button" class="danger" data-cancel-subscription>${icon("calendar-x")} Solicitar cancelamento</button>` : ""}</div></section></div>`;
    $$("[data-close-billing]", root).forEach(
      (button) => (button.onclick = () => (root.innerHTML = "")),
    );
    $("[data-refresh-subscription]", root).onclick = (event) =>
      runSubscriptionAction(
        event.currentTarget,
        () => window.SubscriptionService.syncSubscriptionStatus(),
        "Assinatura atualizada pelo Firebase.",
        root,
      );
    $("[data-reconcile-subscription]", root).onclick = (event) =>
      runSubscriptionAction(
        event.currentTarget,
        () =>
          window.SubscriptionService.syncSubscriptionStatus({
            reconcileProvider: true,
          }),
        "Conferência concluída.",
        root,
      );
    $("[data-cancel-subscription]", root)?.addEventListener("click", () =>
      confirmCancellation(root),
    );
    window.lucide?.createIcons();
  }
  async function runSubscriptionAction(button, action, message, root) {
    button.disabled = true;
    try {
      await action();
      window.Utils?.toast?.(message);
      root.innerHTML = "";
      window.Router?.render?.();
      dispatchEvent(new HashChangeEvent("hashchange"));
    } catch (error) {
      window.Utils?.toast?.(
        error.message || "Não foi possível concluir.",
        true,
      );
    } finally {
      button.disabled = false;
    }
  }
  function confirmCancellation(root) {
    root.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal plan-confirm-cancel"><header class="modal-head"><h3>Solicitar cancelamento?</h3></header><div class="modal-body"><p>O acesso seguirá o status devolvido pelo Mercado Pago. Seus dados não serão apagados.</p></div><footer class="modal-foot"><button class="btn btn-light mobile-button" data-cancel-no>Voltar</button><button class="btn btn-danger mobile-button" data-cancel-yes>Confirmar</button></footer></section></div>`;
    $("[data-cancel-no]", root).onclick = manageSubscription;
    $("[data-cancel-yes]", root).onclick = (event) =>
      runSubscriptionAction(
        event.currentTarget,
        () => window.SubscriptionService.requestCancellation(),
        "Cancelamento solicitado.",
        root,
      );
  }
  function bind(root = document, bindOptions = {}) {
    options = { ...options, ...bindOptions };
    const scope = $("[data-plans-root]", root) || root;
    if (scope.dataset?.plansBound) return;
    scope.dataset.plansBound = "true";
    const carousel = $("[data-plans-carousel]", scope),
      cards = $$("[data-plan-card]", scope),
      target = ["trial", "trialing"].includes(context().status)
        ? "professional"
        : context().subscription.planId || "professional",
      targetIndex = Math.max(
        0,
        cards.findIndex((card) => card.dataset.planCard === target),
      );
    const select = (index) => {
      const card = cards[Math.max(0, Math.min(cards.length - 1, index))];
      if (!card || !carousel) return;
      carousel.scrollTo({
        left: Math.max(
          0,
          card.offsetLeft - (carousel.clientWidth - card.offsetWidth) / 2,
        ),
        behavior: "smooth",
      });
    };
    requestAnimationFrame(() => select(targetIndex));
    carousel?.addEventListener(
      "scroll",
      () => {
        const center = carousel.scrollLeft + carousel.clientWidth / 2,
          index = cards.reduce(
            (best, card, i) =>
              Math.abs(card.offsetLeft + card.offsetWidth / 2 - center) <
              best.distance
                ? {
                    i,
                    distance: Math.abs(
                      card.offsetLeft + card.offsetWidth / 2 - center,
                    ),
                  }
                : best,
            { i: 0, distance: Infinity },
          ).i;
        $$("[data-plan-indicator]", scope).forEach((dot, i) =>
          dot.classList.toggle("active", i === index),
        );
      },
      { passive: true },
    );
    $$("[data-plan-indicator]", scope).forEach(
      (button) =>
        (button.onclick = () => select(Number(button.dataset.planIndicator))),
    );
    $("[data-full-comparison]", scope)?.addEventListener(
      "click",
      fullComparison,
    );
    $$("[data-plan-cta]", scope).forEach(
      (button) => (button.onclick = () => selectPlan(button, scope)),
    );
    $$("[data-manage-plan]", scope).forEach(
      (button) => (button.onclick = manageSubscription),
    );
    $("[data-apply-coupon]", scope)?.addEventListener("click", (event) =>
      applyCoupon(event.currentTarget, scope),
    );
    bindCouponRemoval(scope);
    $("[data-plans-back]", scope)?.addEventListener("click", () =>
      options.onBack?.(),
    );
    $("[data-public-register]", scope)?.addEventListener("click", () =>
      options.onRegister?.(),
    );
    $("[data-public-login]", scope)?.addEventListener("click", () =>
      options.onLogin?.(),
    );
    window.lucide?.createIcons();
  }
  async function selectPlan(button, scope) {
    if (options.publicMode) return options.onRegister?.();
    button.disabled = true;
    try {
      const planId = button.dataset.planCta,
        billingCycle = $("[data-coupon-cycle]", scope)?.value || "monthly",
        quote =
          couponQuote?.planId === planId &&
          couponQuote?.billingCycle === billingCycle
            ? couponQuote
            : null,
        result = await window.SubscriptionService.requestUpgrade(planId, {
          billingCycle,
          quoteId: quote?.quoteId || null,
        });
      if (result?.checkoutUrl) return location.assign(result.checkoutUrl);
      window.Utils?.toast?.(
        result?.message || "Não foi possível abrir o checkout.",
        true,
      );
    } catch (error) {
      window.Utils?.toast?.(
        error.message || "Não foi possível iniciar a assinatura.",
        true,
      );
    } finally {
      button.disabled = false;
    }
  }
  function bindCouponRemoval(root) {
    $("[data-remove-coupon]", root)?.addEventListener("click", () => {
      couponQuote = null;
      const feedback = $("[data-coupon-feedback]", root);
      if (feedback) feedback.innerHTML = "";
      const input = $("[data-coupon-code]", root);
      if (input) input.value = "";
    });
  }
  async function applyCoupon(button, scope) {
    const code = $("[data-coupon-code]", scope)?.value.trim().toUpperCase(),
      planId = $("[data-coupon-plan]", scope)?.value,
      billingCycle = $("[data-coupon-cycle]", scope)?.value,
      feedback = $("[data-coupon-feedback]", scope);
    if (!code) {
      feedback.textContent = "Digite um código de cupom.";
      return;
    }
    button.disabled = true;
    button.textContent = "Validando…";
    try {
      couponQuote = await window.SubscriptionService.validateCoupon({
        couponCode: code,
        planId,
        billingCycle,
      });
      feedback.innerHTML = couponSummary(couponQuote);
      bindCouponRemoval(feedback);
    } catch (error) {
      couponQuote = null;
      feedback.innerHTML = `<p class="coupon-error">${icon("circle-alert")} ${esc(error.message || "Não foi possível validar o cupom.")}</p>`;
    } finally {
      button.disabled = false;
      button.textContent = "Aplicar cupom";
      window.lucide?.createIcons();
    }
  }
  function canUse(feature) {
    return window.PlanLimitService?.canUseFeature?.(feature)?.ok !== false;
  }
  function syncNavigation() {
    $$("[data-plan-feature]").forEach((link) => {
      const allowed = canUse(link.dataset.planFeature);
      link.classList.toggle("plan-locked", !allowed);
      let badge = $(".plan-pro-badge", link);
      if (!allowed && !badge) {
        badge = document.createElement("span");
        badge.className = "plan-pro-badge";
        badge.textContent = "◇ PRO";
        link.append(badge);
      }
      if (allowed) badge?.remove();
    });
    const label = $('[data-route="planos"] [data-plan-link-label]'),
      ctx = context();
    if (label)
      label.textContent =
        ["trial", "trialing"].includes(ctx.status) &&
        ctx.access.daysRemaining !== null
          ? `Planos · ${ctx.access.daysRemaining} dias`
          : "Planos";
  }
  function guardRoute() {
    return true;
  }
  document.addEventListener(
    "click",
    (event) => {
      const action = event.target.closest("[data-requires-feature-action]");
      if (!action) return;
      const decision = window.PlanLimitService?.canUseAction?.(
        action.dataset.requiresFeatureAction,
      );
      if (decision?.ok !== false) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      openProModal(action.dataset.requiresFeatureAction, decision);
    },
    true,
  );
  addEventListener("business-context-changed", syncNavigation);
  addEventListener("firebase-auth-ready", syncNavigation);
  window.PlansUI = {
    render,
    bind,
    fullComparison,
    openProModal,
    openUpgradeRequiredModal: openProModal,
    syncNavigation,
    guardRoute,
    routeFeatures,
    canUseFeature: canUse,
  };
})();
