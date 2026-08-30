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
  let pixUnsubscribe=null;
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
        subscription.status ||
          subscription.subscriptionStatus ||
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
  function billingPayerEmailPrefill() {
    const ctx = context();
    return String(
      ctx.subscription?.pendingBillingPayerEmail ||
        ctx.business?.billingProfile?.billingPayerEmail ||
        ctx.session?.user?.email ||
        ctx.session?.profile?.email ||
        "",
    )
      .trim()
      .toLowerCase();
  }
  const newCheckoutOperationId = () =>
    globalThis.crypto?.randomUUID?.() ||
    `${Date.now()}_${Math.random().toString(36).slice(2)}`;
  const CARD_CHECKOUT_RETURN_KEY = "adiFesta:billing:card-checkout-return";
  let cardReturnReconciling = false;
  function saveCardCheckoutReturn(value) {
    try {
      sessionStorage.setItem(
        CARD_CHECKOUT_RETURN_KEY,
        JSON.stringify({ ...value, startedAt: Date.now() }),
      );
    } catch {}
  }
  function readCardCheckoutReturn() {
    try {
      const value = JSON.parse(
        sessionStorage.getItem(CARD_CHECKOUT_RETURN_KEY) || "null",
      );
      if (!value || Date.now() - Number(value.startedAt || 0) > 2 * 60 * 60 * 1000) {
        sessionStorage.removeItem(CARD_CHECKOUT_RETURN_KEY);
        return null;
      }
      return value;
    } catch {
      return null;
    }
  }
  function clearCardCheckoutReturn() {
    try {
      sessionStorage.removeItem(CARD_CHECKOUT_RETURN_KEY);
    } catch {}
  }
  function pendingCardCheckoutContext() {
    const subscription = context().subscription || {},
      startedAt = new Date(
        subscription.mercadoPago?.checkoutCreatedAt || 0,
      ).getTime();
    if (
      subscription.pendingPaymentMethodType !== "card" ||
      !subscription.pendingPlanId ||
      !subscription.mercadoPago?.subscriptionId ||
      !startedAt ||
      Date.now() - startedAt > 24 * 60 * 60 * 1000
    )
      return null;
    return {
      planId: subscription.pendingPlanId,
      billingCycle: subscription.pendingBillingCycle || "monthly",
      billingPayerEmail: subscription.pendingBillingPayerEmail || null,
      couponCode: subscription.pendingDiscount?.couponCodeSnapshot || null,
      startedAt,
    };
  }
  function consumePayerMismatchReturn() {
    let href;
    try {
      href = decodeURIComponent(location.href).toLowerCase();
    } catch {
      href = String(location.href || "").toLowerCase();
    }
    if (
      !/subscription[-_ ]invalid[-_ ]user|billing_payer_email_mismatch/.test(
        href,
      )
    )
      return false;
    const key = `adiFesta:billing:payer-return:${href}`;
    try {
      if (sessionStorage.getItem(key)) return false;
      sessionStorage.setItem(key, new Date().toISOString());
    } catch {}
    return true;
  }
  function openCardDeclineModal(payment, retryContext = {}, local = {}) {
    const root = $("#modal");
    if (!root) return;
    const planId = retryContext.planId || local.planId,
      billingCycle = retryContext.billingCycle || local.billingCycle || "monthly",
      couponCode = retryContext.couponCode || local.couponCode || null,
      billingPayerEmail =
        retryContext.billingPayerEmail || local.billingPayerEmail || null,
      chargedPrice = Number(
        retryContext.chargedPrice ?? local.quote?.discountedPrice,
      ),
      officialPrice = Number(
        retryContext.officialPrice ?? local.quote?.originalPrice,
      ),
      quote =
        couponCode && Number.isFinite(chargedPrice)
          ? {
              code: couponCode,
              quoteId: null,
              discountedPrice: chargedPrice,
              originalPrice: Number.isFinite(officialPrice)
                ? officialPrice
                : chargedPrice,
            }
          : null;
    root.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal plan-card-decline" aria-labelledby="card-decline-title"><header>${icon("circle-x")}<h3 id="card-decline-title">Pagamento não aprovado</h3><p>${esc(payment?.message || "Seu banco ou o Mercado Pago não aprovou esta cobrança. Tente outro cartão ou pague por Pix.")}</p></header>${couponCode ? `<small>O cupom ${esc(couponCode)} não foi consumido e será validado novamente.</small>` : ""}<div class="plan-card-decline-actions"><button type="button" class="btn btn-primary mobile-button primary" data-retry-card>Tentar outro cartão</button><button type="button" class="btn btn-light mobile-button" data-card-fallback-pix>Pagar por Pix</button><button type="button" class="btn btn-light mobile-button" data-close-card-decline>Agora não</button></div></section></div>`;
    const openRetry = (initialPaymentMethod) => {
      root.innerHTML = "";
      openPaymentMethodModal({
        planId,
        billingCycle,
        quote,
        couponCode,
        initialPaymentMethod,
        initialBillingPayerEmail: billingPayerEmail,
      });
    };
    $("[data-retry-card]", root)?.addEventListener("click", () =>
      openRetry("card"),
    );
    $("[data-card-fallback-pix]", root)?.addEventListener("click", () =>
      openRetry("pix_monthly"),
    );
    $("[data-close-card-decline]", root)?.addEventListener("click", () => {
      root.innerHTML = "";
    });
    window.lucide?.createIcons();
  }
  async function reconcileCardCheckoutReturn() {
    const local = readCardCheckoutReturn() || pendingCardCheckoutContext();
    if (!local || cardReturnReconciling) return;
    cardReturnReconciling = true;
    try {
      const result = await window.SubscriptionService.syncSubscriptionStatus({
        reconcileProvider: true,
        checkoutReturn: true,
      });
      if (result?.payment?.rejected) {
        clearCardCheckoutReturn();
        openCardDeclineModal(result.payment, result.retryContext, local);
      } else if (["active", "authorized"].includes(String(result?.subscription?.status || ""))) {
        clearCardCheckoutReturn();
        window.Utils?.toast?.("Pagamento confirmado. Seu plano está ativo.");
        window.Router?.render?.();
      }
    } catch (error) {
      if (!String(error?.code || "").includes("resource-exhausted"))
        console.warn("[Billing card return]", {
          code: error?.code || "unknown",
        });
    } finally {
      cardReturnReconciling = false;
    }
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
  function verifyPaymentButton(subscription={}) {
    const attemptId=subscription.pendingPaymentMethodType==="pix_monthly"?subscription.pendingCheckoutAttemptId:null;
    return attemptId?`<button type="button" class="plan-manage-button plan-verify-payment" data-verify-pix-payment data-pix-attempt-id="${esc(attemptId)}">${icon("refresh-cw")} Verificar pagamento</button>`:"";
  }
  function changePayerEmailButton(subscription = {}) {
    return subscription.pendingPaymentMethodType === "card" &&
      subscription.pendingPlanId
      ? `<button type="button" class="plan-manage-button plan-change-payer" data-change-payer-email>${icon("mail")} Alterar e-mail do pagador</button>`
      : "";
  }
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
      return `<section class="plan-state-hero state-trial"><span class="plan-state-badge">${icon("star")} Teste grátis ativo</span><div class="plan-state-main"><i>${icon("party-popper")}</i><div><h2>${remaining === 1 ? "Último dia do seu teste" : "Você está no período de teste"}</h2><p>Recursos do plano ${esc(ctx.access.effectivePlan?.name || "Profissional")} liberados até ${dateLabel(end) || "o fim do período"}.</p></div></div><div class="trial-facts"><span>${icon("gift")}<b>${total} dias grátis</b></span><span>${icon("clock-3")}<b>Faltam ${remaining} ${remaining === 1 ? "dia" : "dias"}</b></span></div><div class="trial-progress"><i><u style="--usage:${percent}%"></u></i><small>${used} de ${total} dias utilizados</small></div>${s.pendingPaymentMethodType?`<div class="plan-state-note warning">${icon("clock-3")} ${s.pendingPaymentMethodType==="pix_monthly"?"Aguardando confirmação do pagamento via Pix.":"Aguardando conclusão do checkout no Mercado Pago."}</div>${verifyPaymentButton(s)}${changePayerEmailButton(s)}`:`<div class="plan-state-note">${icon("info")} Após o teste, o app continua em <b>modo leitura</b> até você escolher um plano.</div>`}</section>`;
    const current = plans().find((plan) => plan.id === s.planId),
      period = dateLabel(
        s.currentPeriodEnd || s.nextBillingDate || s.nextPaymentDate,
      ),
      statusLabel =
        {
          active: "Assinatura ativa",
          payment_pending: "Pagamento via Pix pendente",
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
        "payment_pending",
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
    const paymentMethod=s.paymentMethodType||s.pendingPaymentMethodType,
      paymentLabel=paymentMethod==="pix_monthly"?"Pix mensal":paymentMethod==="card"?"Cartão de crédito":"Mercado Pago";
    return `<section class="plan-state-hero ${tone}"><span class="plan-state-badge">${icon(ctx.status === "active" ? "badge-check" : danger ? "circle-alert" : "clock-3")} ${esc(statusLabel)}</span><div class="plan-state-main"><i>${icon(ctx.status === "active" ? "gem" : danger ? "lock-keyhole" : "credit-card")}</i><div><h2>${ctx.status === "active" ? `${esc(current?.name || s.planId || "Plano")} está ativo` : esc(statusLabel)}</h2><p>${ctx.status === "active" ? (period ? `Próximo período em ${period}.` : "O acesso está liberado conforme o status confirmado no Firebase.") : paymentMethod==="pix_monthly"?"Estamos aguardando a confirmação oficial do Mercado Pago.":"Seus dados permanecem preservados e disponíveis para consulta."}</p>${paymentMethod?`<small class="plan-payment-method">Pagamento: <b>${esc(paymentLabel)}</b></small>`:""}</div></div>${s.cancelAtPeriodEnd && period ? `<div class="plan-state-note warning">${icon("calendar-x")} Cancelamento agendado para ${period}.</div>` : ctx.access.readOnly ? `<div class="plan-state-note warning">${icon("eye")} O app está em modo leitura. Regularize ou escolha um plano para voltar a criar dados.</div>` : `<div class="plan-state-note">${icon("circle-check")} Status confirmado pela assinatura da empresa.</div>`}${verifyPaymentButton(s)}${changePayerEmailButton(s)}<button type="button" class="plan-manage-button" data-manage-plan>${icon("settings-2")} Gerenciar assinatura</button></section>`;
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
      subscription=ctx.subscription||{},
      pixActive=subscription.paymentMethodType==="pix_monthly"&&ctx.status==="active",
      pendingPixId=subscription.pendingPaymentMethodType==="pix_monthly"?subscription.pendingCheckoutAttemptId:null,
      root = $("#modal");
    if (!root) return;
    root.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal plan-manage-sheet"><header class="modal-head"><div><h3>Gerenciar assinatura</h3><small>Status: ${esc(ctx.status)}</small></div><button class="icon-btn mobile-icon-button" data-close-billing>${icon("x")}</button></header><div class="modal-body">${pendingPixId?`<button type="button" data-view-pending-pix>${icon("qr-code")} Ver Pix aguardando pagamento</button>`:""}${subscription.pendingPaymentMethodType==="card"&&subscription.pendingPlanId?`<button type="button" data-manage-change-payer>${icon("mail")} Alterar e-mail do pagador</button>`:""}${pixActive?`<button type="button" data-renew-pix>${icon("refresh-cw")} Renovar agora por Pix</button>`:""}<button type="button" data-refresh-subscription>${icon("refresh-cw")} Atualizar do Firebase</button><button type="button" data-reconcile-subscription>${icon("cloud-cog")} Conferir com Mercado Pago</button>${!ctx.internal && ctx.status === "active"&&subscription.paymentMethodType!=="pix_monthly" ? `<button type="button" class="danger" data-cancel-subscription>${icon("calendar-x")} Solicitar cancelamento</button>` : ""}</div></section></div>`;
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
    $('[data-renew-pix]',root)?.addEventListener('click',()=>{root.innerHTML="";openPaymentMethodModal({planId:subscription.planId,billingCycle:subscription.billingCycle||'monthly',quote:null,initialPaymentMethod:'pix_monthly'})});
    $('[data-manage-change-payer]',root)?.addEventListener('click',()=>changePendingPayerEmail());
    $('[data-view-pending-pix]',root)?.addEventListener('click',async event=>{event.currentTarget.disabled=true;try{const result=await window.SubscriptionService.checkPixCheckout(pendingPixId),plan=plans().find(item=>item.id===(subscription.pendingPlanId||subscription.planId));if(!plan)throw Error('Plano da cobrança não encontrado.');openPixModal({pix:result.pix,plan,billingCycle:subscription.pendingBillingCycle||'monthly',quote:null})}catch(error){window.Utils?.toast?.(error.message||'Não foi possível abrir o Pix.',true);event.currentTarget.disabled=false}});
    window.lucide?.createIcons();
  }
  function changePendingPayerEmail(initialPayerError = null) {
    const ctx = context(),
      subscription = ctx.subscription || {},
      planId = subscription.pendingPlanId;
    if (!planId) return;
    const root = $("#modal");
    if (root) root.innerHTML = "";
    openPaymentMethodModal({
      planId,
      billingCycle: subscription.pendingBillingCycle || "monthly",
      quote: null,
      couponCode: subscription.pendingDiscount?.couponCodeSnapshot || null,
      initialPaymentMethod: "card",
      initialBillingPayerEmail:
        subscription.pendingBillingPayerEmail || null,
      initialPayerError,
    });
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
  async function verifyPendingPix(button) {
    const operationId=String(button?.dataset?.pixAttemptId||"");
    if(!operationId)return;
    button.disabled=true;
    try{
      const result=await window.SubscriptionService.checkPixCheckout(operationId,{reconcileProvider:true}),approved=result?.pix?.status==="payment_approved";
      window.Utils?.toast?.(approved?"Pagamento confirmado. Plano atualizado.":"O Mercado Pago ainda não confirmou este Pix.");
      window.Router?.render?.();
      dispatchEvent(new HashChangeEvent("hashchange"));
    }catch(error){window.Utils?.toast?.(error.message||"Não foi possível verificar o pagamento agora.",true)}finally{if(button.isConnected)button.disabled=false}
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
    $$("[data-change-payer-email]", scope).forEach(
      (button) => (button.onclick = () => changePendingPayerEmail()),
    );
    $("[data-verify-pix-payment]",scope)?.addEventListener("click",event=>verifyPendingPix(event.currentTarget));
    $("[data-apply-coupon]", scope)?.addEventListener("click", (event) =>
      applyCoupon(event.currentTarget, scope),
    );
    bindCouponRemoval(scope);
    const payerMismatchReturn = consumePayerMismatchReturn();
    if (payerMismatchReturn)
      queueMicrotask(() =>
        changePendingPayerEmail(
          "O e-mail usado no Mercado Pago é diferente do e-mail informado para cobrança.",
        ),
      );
    else queueMicrotask(() => void reconcileCardCheckoutReturn());
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
    const planId=button.dataset.planCta,
      billingCycle=$("[data-coupon-cycle]",scope)?.value||"monthly",
      quote=couponQuote?.planId===planId&&couponQuote?.billingCycle===billingCycle?couponQuote:null;
    openPaymentMethodModal({planId,billingCycle,quote});
  }
  function closePixWatcher(){pixUnsubscribe?.();pixUnsubscribe=null}
  function pixImage(value){if(!value)return"";return value.startsWith("data:")?value:`data:image/png;base64,${value}`}
  function pixStatusView(pix,plan,billingCycle,quote){
    const status=String(pix?.status||"payment_pending"),approved=status==="payment_approved",expired=status==="expired",failed=["canceled","failed"].includes(status),review=status==="payment_review_required",expires=pix?.expiresAt?new Date(pix.expiresAt):null,expiresLabel=expires&&!Number.isNaN(expires.getTime())?expires.toLocaleString("pt-BR",{dateStyle:"short",timeStyle:"short"}):"",couponCode=quote?.code||pix?.couponSnapshot?.couponCodeSnapshot||"";
    if(approved)return `<div class="modal-bg"><section class="modal-box mobile-modal plan-pix-sheet plan-pix-result success"><header>${icon("circle-check-big")}<h3>Pagamento confirmado</h3><p>Seu plano ${esc(plan.name)} está ativo.</p></header><button class="btn btn-primary mobile-button primary" data-pix-finish>Começar a usar</button></section></div>`;
    if(review)return `<div class="modal-bg"><section class="modal-box mobile-modal plan-pix-sheet plan-pix-result expired"><header>${icon("shield-alert")}<h3>Pagamento em análise</h3><p>Uma cobrança anterior substituída foi paga. Não renovamos duas vezes automaticamente; o suporte fará a conferência segura.</p></header><button class="btn btn-light mobile-button" data-pix-close>Fechar</button></section></div>`;
    if(expired||failed)return `<div class="modal-bg"><section class="modal-box mobile-modal plan-pix-sheet plan-pix-result expired"><header>${icon(expired?"clock-alert":"circle-alert")}<h3>${expired?"Pix expirado":"Não foi possível gerar o Pix"}</h3><p>${expired?"Esta cobrança não pode mais ser paga. Gere um novo Pix seguro.":"A cobrança anterior falhou e não ativou o plano. Você pode tentar novamente com segurança."}</p>${couponCode?`<small>O cupom ${esc(couponCode)} será validado novamente.</small>`:""}</header><button class="btn btn-primary mobile-button primary" data-pix-regenerate>Gerar novo Pix</button><button class="btn btn-light mobile-button" data-pix-close>Agora não</button></section></div>`;
    return `<div class="modal-bg"><section class="modal-box mobile-modal plan-pix-sheet" aria-labelledby="pix-title"><header class="modal-head"><div><h3 id="pix-title">Pagar com Pix</h3><small>${esc(plan.name)} · ${billingCycle==="yearly"?"renovação anual":"pagamento mensal"}</small></div><button class="icon-btn mobile-icon-button" data-pix-close aria-label="Fechar">${icon("x")}</button></header><div class="modal-body"><section class="plan-payment-summary"><span>Preço original</span><b>${money(pix.originalAmount)}</b>${couponCode?`<small>Cupom ${esc(couponCode)} · desconto de ${money(pix.discountAmount)}</small>`:""}<strong>Total ${money(pix.finalAmount)}</strong></section><div class="plan-pix-qr"><img src="${esc(pixImage(pix.qrCodeBase64))}" alt="QR Code Pix gerado pelo Mercado Pago"><p>Escaneie pelo aplicativo do seu banco</p></div><button class="btn btn-primary mobile-button primary plan-pix-copy" data-copy-pix>${icon("copy")} Copiar código Pix</button>${pix.ticketUrl?`<a class="plan-pix-ticket" href="${esc(pix.ticketUrl)}" target="_blank" rel="noopener noreferrer">Abrir página de pagamento ${icon("external-link")}</a>`:""}<div class="plan-pix-waiting"><i></i><span><b>Aguardando pagamento…</b><small>O plano será ativado após a confirmação oficial.</small></span></div>${expiresLabel?`<p class="plan-pix-expiration">Válido até ${esc(expiresLabel)}</p>`:""}<p class="plan-payment-disclaimer">${icon("shield-check")} Você não precisa ter uma conta Mercado Pago. Pague pelo app de qualquer banco compatível com Pix.</p></div><footer class="modal-foot"><button class="btn btn-light mobile-button" data-check-pix>Já paguei · verificar</button></footer></section></div>`;
  }
  function openPixModal({pix,plan,billingCycle,quote}){
    const root=$("#modal");if(!root)return;closePixWatcher();
    let entitlementRefresh=null;
    const render=current=>{
      root.innerHTML=pixStatusView(current,plan,billingCycle,quote);window.lucide?.createIcons();
      $$('[data-pix-close]',root).forEach(button=>button.onclick=()=>{closePixWatcher();root.innerHTML=""});
      $('[data-copy-pix]',root)?.addEventListener('click',async()=>{try{await navigator.clipboard.writeText(current.qrCode);window.Utils?.toast?.('Código Pix copiado.')}catch{window.Utils?.toast?.('Não foi possível copiar o código Pix.',true)}});
      $('[data-check-pix]',root)?.addEventListener('click',async event=>{const button=event.currentTarget;button.disabled=true;try{const result=await window.SubscriptionService.checkPixCheckout(current.id,{reconcileProvider:true});render(result.pix)}catch(error){window.Utils?.toast?.(error.message||'Não foi possível conferir agora.',true)}finally{if(button.isConnected)button.disabled=false}});
      $('[data-pix-finish]',root)?.addEventListener('click',async()=>{closePixWatcher();await window.SubscriptionService.syncSubscriptionStatus().catch(()=>{});root.innerHTML="";window.Router?.render?.()});
      $('[data-pix-regenerate]',root)?.addEventListener('click',()=>{const couponCode=quote?.code||current?.couponSnapshot?.couponCodeSnapshot||null;closePixWatcher();root.innerHTML="";openPaymentMethodModal({planId:plan.id,billingCycle,quote,couponCode,previousCheckoutAttemptId:current.id,initialPaymentMethod:'pix_monthly'})});
      if(current?.status==='payment_approved'&&!entitlementRefresh)entitlementRefresh=window.SubscriptionService.syncSubscriptionStatus().then(()=>window.Router?.render?.()).catch(error=>console.warn('[Billing Pix entitlement refresh]',{code:error?.code||'unknown'}));
    };
    render(pix);
    pixUnsubscribe=window.SubscriptionService.watchPixCheckout(pix.id,data=>{if(data?.status&&data.status!==pix.status){pix={...pix,...data};render(pix)}},error=>console.warn('[Billing Pix listener]',{code:error?.code||'unknown'}));
  }
  function openPaymentMethodModal({
    planId,
    billingCycle,
    quote,
    couponCode = null,
    previousCheckoutAttemptId = null,
    initialPaymentMethod = "card",
    initialBillingPayerEmail = null,
    initialPayerError = null,
  }) {
    const plan = plans().find((item) => item.id === planId),
      root = $("#modal");
    if (!root || !plan) return;
    const finalPrice =
        quote?.discountedPrice ??
        (billingCycle === "yearly" ? plan.yearlyPrice : plan.monthlyPrice),
      cycleLabel = billingCycle === "yearly" ? "anual" : "mensal",
      payerEmail =
        initialBillingPayerEmail || billingPayerEmailPrefill();
    let selected = initialPaymentMethod,
      checkoutOperationId = newCheckoutOperationId(),
      submittedSignature = null;
    root.innerHTML = `<div class="modal-bg"><section class="modal-box mobile-modal plan-payment-sheet" aria-labelledby="payment-method-title"><header class="modal-head"><div><h3 id="payment-method-title">Como deseja pagar?</h3><small>${esc(plan.name)} · cobrança ${cycleLabel}</small></div><button class="icon-btn mobile-icon-button" data-close-payment aria-label="Fechar">${icon("x")}</button></header><div class="modal-body"><section class="plan-payment-summary"><span>Valor no checkout</span><b>${money(finalPrice)}</b>${quote || couponCode ? `<small>Cupom ${esc(quote?.code || couponCode)} aplicado e será validado novamente no servidor.</small>` : ""}</section><div class="plan-payment-options" role="radiogroup" aria-label="Forma de pagamento"><button type="button" class="active" data-payment-option="card" role="radio" aria-checked="true"><i>${icon("credit-card")}</i><span><b>Cartão de crédito</b><small>Cobrança automática ${cycleLabel} pelo Mercado Pago.</small></span><em>${icon("circle-check")}</em></button><button type="button" data-payment-option="pix_monthly" role="radio" aria-checked="false"><i>${icon("qr-code")}</i><span><b>${billingCycle === "yearly" ? "Pix por período" : "Pix mensal"}</b><small>Sem cartão nem conta Mercado Pago. Pagamento manual a cada renovação; uma nova cobrança pode exigir confirmação a cada mês.</small></span><em>${icon("circle")}</em></button></div><section class="plan-payer-email" data-card-payer><label for="billing-payer-email"><b>E-mail do pagador</b><span>Use o e-mail da conta Mercado Pago que fará o pagamento.</span></label><input id="billing-payer-email" data-billing-payer-email type="email" inputmode="email" autocomplete="email" maxlength="254" required value="${esc(payerEmail)}" placeholder="email@exemplo.com"><small>Ele pode ser diferente do e-mail da sua empresa no Adi Festa. Informe o e-mail usado pela pessoa que fará o pagamento no Mercado Pago.</small><div class="plan-payer-error" data-payer-error hidden></div></section><p class="plan-payment-disclaimer">${icon("shield-check")} O pagamento acontece no ambiente seguro do Mercado Pago. O plano só é ativado após confirmação oficial por webhook.</p></div><footer class="modal-foot"><button class="btn btn-light mobile-button" data-close-payment>Cancelar</button><button class="btn btn-primary mobile-button primary" data-start-checkout>Continuar com cartão</button></footer></section></div>`;
    const emailInput = $("[data-billing-payer-email]", root),
      payerSection = $("[data-card-payer]", root),
      payerError = $("[data-payer-error]", root),
      showPayerError = (message) => {
        if (!payerError) return;
        payerError.hidden = false;
        payerError.innerHTML = `<span>${esc(message)}</span><button type="button" data-focus-payer-email>Alterar e-mail do pagador</button>`;
        $("[data-focus-payer-email]", payerError)?.addEventListener(
          "click",
          () => {
            emailInput?.focus();
            emailInput?.select();
          },
        );
      },
      clearPayerError = () => {
        if (!payerError) return;
        payerError.hidden = true;
        payerError.innerHTML = "";
      },
      syncSelection = () => {
        $$("[data-payment-option]", root).forEach((option) => {
          const active = option.dataset.paymentOption === selected;
          option.classList.toggle("active", active);
          option.setAttribute("aria-checked", String(active));
          const marker = $("em", option);
          if (marker)
            marker.innerHTML = icon(active ? "circle-check" : "circle");
        });
        if (payerSection) payerSection.hidden = selected !== "card";
        if (emailInput) emailInput.required = selected === "card";
        const submit = $("[data-start-checkout]", root);
        if (submit)
          submit.textContent =
            selected === "pix_monthly"
              ? "Continuar com Pix"
              : "Continuar com cartão";
        window.lucide?.createIcons();
      };
    syncSelection();
    if (initialPayerError) {
      showPayerError(initialPayerError);
      emailInput?.focus();
    }
    emailInput?.addEventListener("input", clearPayerError);
    $$("[data-payment-option]", root).forEach((option) =>
      option.addEventListener("click", () => {
        selected = option.dataset.paymentOption;
        clearPayerError();
        syncSelection();
      }),
    );
    $$("[data-close-payment]", root).forEach((button) =>
      button.addEventListener("click", () => {
        root.innerHTML = "";
      }),
    );
    $("[data-start-checkout]", root)?.addEventListener(
      "click",
      async (event) => {
        const submit = event.currentTarget,
          billingPayerEmail =
            selected === "card"
              ? String(emailInput?.value || "")
                  .trim()
                  .toLowerCase()
              : null;
        if (
          selected === "card" &&
          (!billingPayerEmail || !emailInput?.checkValidity())
        ) {
          showPayerError(
            "Informe um e-mail válido da pessoa que fará o pagamento.",
          );
          emailInput?.reportValidity();
          emailInput?.focus();
          return;
        }
        const signature = `${selected}:${billingPayerEmail || ""}`;
        if (submittedSignature && submittedSignature !== signature)
          checkoutOperationId = newCheckoutOperationId();
        submittedSignature = signature;
        submit.disabled = true;
        submit.textContent = "Abrindo checkout…";
        clearPayerError();
        try {
          const result = await window.SubscriptionService.requestUpgrade(
            planId,
            {
              billingCycle,
              quoteId: quote?.quoteId || null,
              couponCode: couponCode || quote?.code || null,
              paymentMethodType: selected,
              billingPayerEmail,
              operationId: checkoutOperationId,
              previousCheckoutAttemptId:
                selected === "pix_monthly"
                  ? previousCheckoutAttemptId
                  : null,
            },
          );
          if (result?.pix)
            return openPixModal({ pix: result.pix, plan, billingCycle, quote });
          if (result?.checkoutUrl) {
            if (selected === "card")
              saveCardCheckoutReturn({
                planId,
                billingCycle,
                quote: quote
                  ? {
                      code: quote.code || couponCode || null,
                      originalPrice: quote.originalPrice,
                      discountedPrice: quote.discountedPrice,
                    }
                  : null,
                couponCode: couponCode || quote?.code || null,
                billingPayerEmail,
                operationId: result.operationId || checkoutOperationId,
              });
            return location.assign(result.checkoutUrl);
          }
          throw Error("Não foi possível abrir o checkout.");
        } catch (error) {
          const billingCode = error?.details?.billingCode || null;
          if (selected === "pix_monthly")
            console.warn("[BILLING_PIX_ERROR]", {
              code: error?.code || "unknown",
              billingCode,
            });
          if (
            [
              "invalid_billing_payer_email",
              "billing_payer_email_mismatch",
            ].includes(billingCode)
          ) {
            showPayerError(
              billingCode === "billing_payer_email_mismatch"
                ? "O e-mail usado no Mercado Pago é diferente do e-mail informado para cobrança."
                : error.message ||
                    "Informe um e-mail válido da pessoa que fará o pagamento.",
            );
            emailInput?.focus();
          } else
            window.Utils?.toast?.(
              error.message ||
                `Não foi possível iniciar o pagamento ${selected === "pix_monthly" ? "via Pix" : ""}.`,
              true,
            );
          submit.disabled = false;
          syncSelection();
        }
      },
    );
    window.lucide?.createIcons();
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
