(() => {
  "use strict";
  const $ = (selector, root = document) => root.querySelector(selector),
    $$ = (selector, root = document) => [...root.querySelectorAll(selector)],
    icon = (name) => `<i data-lucide="${name}"></i>`,
    esc = (value) =>
      window.Utils?.escapar?.(String(value ?? "")) ?? String(value ?? ""),
    money = (value) =>
      Number(value || 0).toLocaleString("pt-BR", {
        style: "currency",
        currency: "BRL",
      });
  const state = {
    items: [],
    nextCursor: null,
    filter: "all",
    search: "",
    loading: false,
  };
  const statusLabel = {
    active: "Ativo",
    scheduled: "Agendado",
    expired: "Expirado",
    ended: "Encerrado",
    paused: "Pausado",
    draft: "Rascunho",
  };
  const typeLabel = {
    percentage: "Percentual",
    fixed_amount: "Valor fixo",
    final_price: "Preço final",
  };
  const durationLabel = {
    first_payment: "Primeiro pagamento",
    billing_cycles: "Quantidade de cobranças",
    while_subscription_active: "Enquanto a assinatura estiver ativa",
    until_date: "Até uma data",
  };
  function context() {
    const session = window.FirebaseSession || {},
      business = session.business || {},
      profile = session.profile || {},
      subscription = session.subscription || business.subscription || {};
    return {
      session,
      business,
      profile,
      subscription,
      internal:
        business.id === "adi-festa" &&
        subscription.planId === "internal" &&
        ["active", "internal"].includes(subscription.status) &&
        profile.role === "owner",
    };
  }
  function call(name, data = {}) {
    return window
      .FirebaseCallable(name, { businessId: "adi-festa", ...data })
      .then((result) => result.data);
  }
  function discount(item) {
    if (item.discountType === "percentage") return `${item.discountValue}%`;
    if (item.discountType === "fixed_amount") return money(item.discountValue);
    return `Preço ${money(item.discountValue)}`;
  }
  function dates(item) {
    const fmt = (value) =>
      value ? new Date(value).toLocaleDateString("pt-BR") : "Sem limite";
    return `${fmt(item.validFrom)} — ${fmt(item.validUntil)}`;
  }
  function visibleItems() {
    const term = state.search.trim().toUpperCase();
    return state.items.filter(
      (item) =>
        (state.filter === "all" ||
          item.status === state.filter ||
          (state.filter === "private" && item.category === "private") ||
          (state.filter === "promotional" &&
            item.category === "promotional")) &&
        (!term ||
          [item.code, item.name, item.campaign].some((value) =>
            String(value || "")
              .toUpperCase()
              .includes(term),
          )),
    );
  }
  function render() {
    if (!context().internal)
      return `<section class="panel empty-state"><h2>Acesso restrito</h2><p>Somente a conta interna autorizada pode administrar cupons.</p></section>`;
    return `<section class="coupons-admin" data-coupons-admin><header class="coupons-heading"><div><h1>Cupons de desconto</h1><p>Crie, acompanhe e encerre promoções dos seus planos.</p></div><button class="btn btn-primary" data-new-coupon>${icon("plus")} Criar cupom</button></header><section class="coupon-kpis" data-coupon-kpis>${kpis([])}</section><div class="coupon-toolbar"><label>${icon("search")}<input data-coupon-search placeholder="Buscar código, nome ou campanha…"></label><button class="btn btn-light" data-refresh-coupons>${icon("refresh-cw")} Atualizar</button></div><nav class="coupon-filters" aria-label="Filtros">${[
      ["all", "Todos"],
      ["active", "Ativos"],
      ["scheduled", "Agendados"],
      ["ended", "Encerrados"],
      ["private", "Privados"],
      ["promotional", "Promocionais"],
    ]
      .map(
        ([key, label]) =>
          `<button type="button" data-coupon-filter="${key}" class="${key === "all" ? "active" : ""}">${label}</button>`,
      )
      .join(
        "",
      )}</nav><section class="coupon-list" data-coupon-list><div class="coupon-loading">${icon("loader-circle")} Carregando cupons…</div></section><button class="coupon-fab" type="button" data-new-coupon aria-label="Criar cupom">${icon("plus")}</button></section>`;
  }
  function kpis(items) {
    const count = (status) =>
        items.filter((item) => item.status === status).length,
      uses = items.reduce(
        (sum, item) => sum + Number(item.redemptionCount || 0),
        0,
      ),
      activeSubscriptions = items.reduce(
        (sum, item) => sum + Number(item.activeSubscriptions || 0),
        0,
      );
    return [
      ["circle-check", count("active"), "Ativos"],
      ["calendar-clock", count("scheduled"), "Agendados"],
      ["circle-stop", count("ended") + count("expired"), "Encerrados"],
      ["ticket-check", uses, "Utilizações"],
      ["badge-dollar-sign", activeSubscriptions, "Assinaturas com cupom"],
    ]
      .map(
        (item) =>
          `<article>${icon(item[0])}<b>${item[1]}</b><span>${item[2]}</span></article>`,
      )
      .join("");
  }
  function card(item) {
    return `<article class="coupon-card" data-coupon-id="${item.id}"><header><div><code>${esc(item.code)}</code><h3>${esc(item.name)}</h3><small>${esc(item.campaign || (item.category === "private" ? "Privado" : "Promocional"))}</small></div><span class="coupon-status ${item.status}">${statusLabel[item.status] || item.status}</span></header><dl><div><dt>Desconto</dt><dd>${esc(discount(item))}</dd></div><div><dt>Planos</dt><dd>${item.allowedPlanIds.map(esc).join(", ")}</dd></div><div><dt>Validade</dt><dd>${esc(dates(item))}</dd></div><div><dt>Usos</dt><dd>${Number(item.redemptionCount || 0)} de ${item.maxRedemptions ?? "∞"}</dd></div></dl><footer><button data-coupon-details>Ver detalhes</button><button data-coupon-edit>Editar</button>${item.status === "paused" ? '<button data-coupon-action="reactivate">Reativar</button>' : item.status === "active" ? '<button data-coupon-action="pause">Pausar</button>' : ""}<button data-coupon-duplicate>Duplicar</button>${!["ended", "expired"].includes(item.status) ? '<button class="danger" data-coupon-action="end">Encerrar</button>' : ""}</footer></article>`;
  }
  function paint() {
    const list = $("[data-coupon-list]"),
      items = visibleItems();
    if (list)
      list.innerHTML =
        (items.map(card).join("") ||
          '<div class="coupon-empty">Nenhum cupom encontrado.</div>') +
        (state.nextCursor
          ? '<button class="btn btn-light coupon-load-more" type="button" data-load-more-coupons>Carregar mais</button>'
          : "");
    const kpi = $("[data-coupon-kpis]");
    if (kpi) kpi.innerHTML = kpis(state.items);
    bindCards();
    $("[data-load-more-coupons]")?.addEventListener("click", () => load(true));
    window.lucide?.createIcons();
  }
  async function load(append = false) {
    if (state.loading) return;
    state.loading = true;
    try {
      const result = await call("listAdminCoupons", {
        limit: 50,
        cursor: append ? state.nextCursor : null,
      });
      state.items = append
        ? [...state.items, ...(result.items || [])]
        : result.items || [];
      state.nextCursor = result.nextCursor || null;
      const cachedSummary = {
        active: state.items.filter((item) => item.status === "active").length,
        redemptions: state.items.reduce(
          (sum, item) => sum + Number(item.redemptionCount || 0),
          0,
        ),
        activeSubscriptions: state.items.reduce(
          (sum, item) => sum + Number(item.activeSubscriptions || 0),
          0,
        ),
        discountGrantedTotal: state.items.reduce(
          (sum, item) => sum + Number(item.discountGrantedTotal || 0),
          0,
        ),
        updatedAt: new Date().toISOString(),
      };
      try {
        localStorage.setItem(
          "adi_coupon_admin_summary",
          JSON.stringify(cachedSummary),
        );
      } catch {}
      paint();
    } catch (error) {
      const list = $("[data-coupon-list]");
      if (list)
        list.innerHTML = `<div class="coupon-empty error">${esc(error.message || "Não foi possível carregar os cupons.")}</div>`;
    } finally {
      state.loading = false;
    }
  }
  const lines = (value) =>
      String(value || "")
        .split(/[\n,;]+/)
        .map((item) => item.trim())
        .filter(Boolean),
    checked = (form, name) =>
      [...form.querySelectorAll(`[name="${name}"]:checked`)].map(
        (input) => input.value,
      ),
    dateValue = (value) => (value ? new Date(value).toISOString() : null);
  function formTemplate(coupon = {}) {
    const planChecked = (id) =>
        coupon.allowedPlanIds?.includes(id) ||
        (!coupon.id && id === "professional"),
      cycleChecked = (id) =>
        coupon.allowedBillingCycles?.includes(id) ||
        (!coupon.id && id === "monthly");
    return `<header class="modal-head"><h3>${coupon.id ? "Editar cupom" : "Criar cupom"}</h3><button class="icon-btn" data-close-coupon aria-label="Fechar">${icon("x")}</button></header><form data-coupon-form><div class="modal-body coupon-form-grid"><div class="field"><label>Nome interno *</label><input name="name" required maxlength="120" value="${esc(coupon.name || "")}"></div><div class="field"><label>Código *</label><input name="code" required maxlength="40" value="${esc(coupon.code || "")}"></div><div class="field"><label>Categoria</label><select name="category"><option value="private" ${coupon.category === "private" ? "selected" : ""}>Privado</option><option value="promotional" ${coupon.category !== "private" ? "selected" : ""}>Promocional</option></select></div><div class="field"><label>Campanha</label><input name="campaign" value="${esc(coupon.campaign || "")}"></div><div class="field full"><label>Descrição interna</label><textarea name="description">${esc(coupon.description || "")}</textarea></div><div class="field"><label>Tipo de desconto</label><select name="discountType"><option value="percentage" ${coupon.discountType === "percentage" ? "selected" : ""}>Percentual</option><option value="fixed_amount" ${coupon.discountType === "fixed_amount" ? "selected" : ""}>Valor fixo</option><option value="final_price" ${coupon.discountType === "final_price" ? "selected" : ""}>Preço final</option></select></div><div class="field"><label>Valor</label><input name="discountValue" type="number" inputmode="decimal" min="0" step="0.01" value="${coupon.discountValue ?? ""}" required></div><div class="field"><label>Duração</label><select name="durationType"><option value="first_payment" ${coupon.durationType === "first_payment" ? "selected" : ""}>Primeiro pagamento</option><option value="billing_cycles" ${coupon.durationType === "billing_cycles" ? "selected" : ""}>Quantidade de cobranças</option><option value="while_subscription_active" ${coupon.durationType === "while_subscription_active" ? "selected" : ""}>Enquanto a assinatura estiver ativa</option><option value="until_date" ${coupon.durationType === "until_date" ? "selected" : ""}>Até uma data</option></select></div><div class="field"><label>Quantidade de cobranças</label><input name="billingCycles" type="number" min="1" max="120" value="${coupon.billingCycles ?? ""}"></div><fieldset><legend>Planos aceitos</legend>${["essential", "professional", "premium"].map((id) => `<label><input type="checkbox" name="allowedPlanIds" value="${id}" ${planChecked(id) ? "checked" : ""}> ${id}</label>`).join("")}</fieldset><fieldset><legend>Periodicidade</legend>${["monthly", "yearly"].map((id) => `<label><input type="checkbox" name="allowedBillingCycles" value="${id}" ${cycleChecked(id) ? "checked" : ""}> ${id === "monthly" ? "Mensal" : "Anual"}</label>`).join("")}</fieldset><div class="field"><label>Válido a partir de</label><input name="validFrom" type="datetime-local" value="${coupon.validFrom ? new Date(coupon.validFrom).toISOString().slice(0, 16) : ""}"></div><div class="field"><label>Válido até</label><input name="validUntil" type="datetime-local" value="${coupon.validUntil ? new Date(coupon.validUntil).toISOString().slice(0, 16) : ""}"></div><div class="field"><label>Fim do desconto</label><input name="discountEndsAt" type="datetime-local" value="${coupon.discountEndsAt ? new Date(coupon.discountEndsAt).toISOString().slice(0, 16) : ""}"></div><div class="field"><label>Limite total</label><input name="maxRedemptions" type="number" min="1" value="${coupon.maxRedemptions ?? ""}" placeholder="Sem limite"></div><div class="field"><label>Limite por empresa</label><input name="maxUsesPerBusiness" type="number" min="1" value="${coupon.maxUsesPerBusiness ?? 1}"></div><div class="field"><label>Limite por usuário</label><input name="maxUsesPerUser" type="number" min="1" value="${coupon.maxUsesPerUser ?? ""}" placeholder="Sem limite"></div><div class="field full"><label>E-mails autorizados</label><textarea name="authorizedEmails" placeholder="Um por linha">${esc((coupon.authorizedEmails || []).join("\n"))}</textarea></div><div class="field full"><label>UIDs, empresas e domínios autorizados</label><div class="coupon-restriction-grid"><textarea name="authorizedUids" placeholder="UIDs, um por linha">${esc((coupon.authorizedUids || []).join("\n"))}</textarea><textarea name="authorizedBusinessIds" placeholder="Business IDs">${esc((coupon.authorizedBusinessIds || []).join("\n"))}</textarea><textarea name="authorizedEmailDomains" placeholder="Domínios de e-mail">${esc((coupon.authorizedEmailDomains || []).join("\n"))}</textarea></div></div><fieldset class="full"><legend>Regras comerciais</legend><label><input type="checkbox" name="newSubscribersOnly" ${coupon.newSubscribersOnly ? "checked" : ""}> Somente novos assinantes</label><label><input type="checkbox" name="firstPaidSubscriptionOnly" ${coupon.firstPaidSubscriptionOnly ? "checked" : ""}> Somente primeiro plano pago</label><label><input type="checkbox" name="allowUpgrade" ${coupon.allowUpgrade !== false ? "checked" : ""}> Permitir upgrade</label><label><input type="checkbox" name="allowDowngrade" ${coupon.allowDowngrade ? "checked" : ""}> Permitir downgrade</label></fieldset></div><footer class="modal-foot"><button type="button" class="btn btn-light" data-close-coupon>Cancelar</button><button class="btn btn-primary">Salvar cupom</button></footer></form>`;
  }
  function openForm(coupon = {}) {
    const modal = $("#modal");
    modal.innerHTML = `<div class="modal-bg"><section class="modal-box coupon-editor">${formTemplate(coupon)}</section></div>`;
    const categoryField = $('select[name="category"]', modal)?.closest(
      ".field",
    );
    if (categoryField) {
      const statusField = document.createElement("div");
      statusField.className = "field";
      statusField.innerHTML = `<label>Status inicial</label><select name="status"><option value="draft">Rascunho</option><option value="active">Ativo</option><option value="paused">Pausado</option></select>`;
      categoryField.after(statusField);
      $('select[name="status"]', statusField).value = coupon.status || "draft";
    }
    const commercialRules = $$("fieldset", modal).at(-1);
    if (commercialRules) {
      const inactiveOnly = document.createElement("label");
      inactiveOnly.innerHTML = `<input type="checkbox" name="inactiveSubscriptionsOnly"> Somente empresas sem assinatura ativa`;
      commercialRules.insertBefore(
        inactiveOnly,
        commercialRules.querySelector("label:nth-of-type(2)"),
      );
      inactiveOnly.querySelector("input").checked = Boolean(
        coupon.inactiveSubscriptionsOnly,
      );
    }
    $$("[data-close-coupon]", modal).forEach(
      (button) => (button.onclick = () => (modal.innerHTML = "")),
    );
    $("[data-coupon-form]", modal).onsubmit = async (event) => {
      event.preventDefault();
      const form = event.currentTarget,
        button = event.submitter,
        data = Object.fromEntries(new FormData(form));
      data.allowedPlanIds = checked(form, "allowedPlanIds");
      data.allowedBillingCycles = checked(form, "allowedBillingCycles");
      for (const key of [
        "authorizedEmails",
        "authorizedUids",
        "authorizedBusinessIds",
        "authorizedEmailDomains",
      ])
        data[key] = lines(data[key]);
      for (const key of [
        "newSubscribersOnly",
        "inactiveSubscriptionsOnly",
        "firstPaidSubscriptionOnly",
        "allowUpgrade",
        "allowDowngrade",
      ])
        data[key] = form.elements[key].checked;
      for (const key of ["validFrom", "validUntil", "discountEndsAt"])
        data[key] = dateValue(data[key]);
      for (const key of [
        "maxRedemptions",
        "maxUsesPerBusiness",
        "maxUsesPerUser",
        "billingCycles",
      ])
        data[key] = data[key] === "" ? null : Number(data[key]);
      data.discountValue = Number(data.discountValue);
      data.status = data.status || coupon.status || "draft";
      button.disabled = true;
      try {
        await call("saveAdminCoupon", {
          couponId: coupon.id || null,
          coupon: data,
        });
        modal.innerHTML = "";
        Utils.toast("Cupom salvo com segurança.");
        await load();
      } catch (error) {
        button.disabled = false;
        Utils.toast(error.message || "Não foi possível salvar o cupom.", true);
      }
    };
    window.lucide?.createIcons();
  }
  async function details(id) {
    const modal = $("#modal");
    modal.innerHTML =
      '<div class="modal-bg"><section class="modal-box coupon-details"><div class="coupon-loading">Carregando detalhes…</div></section></div>';
    try {
      const result = await call("getAdminCoupon", { couponId: id }),
        coupon = result.coupon,
        uses = result.uses || [],
        activeUses = uses.filter((use) => use.status === "active").length,
        pendingUses = uses.filter((use) =>
          ["reserved", "pending_payment"].includes(use.status),
        ).length,
        failedUses = uses.filter((use) =>
          ["failed", "canceled", "refunded", "expired"].includes(use.status),
        ).length,
        generatedRevenue = uses
          .filter((use) => use.status === "active")
          .reduce((sum, use) => sum + Number(use.discountedPrice || 0), 0),
        grantedDiscount = uses
          .filter((use) => use.status === "active")
          .reduce(
            (sum, use) =>
              sum +
              Math.max(
                0,
                Number(use.originalPrice || 0) -
                  Number(use.discountedPrice || 0),
              ),
            0,
          );
      $(".coupon-details", modal).innerHTML =
        `<header class="modal-head"><div><code>${esc(coupon.code)}</code><h3>${esc(coupon.name)}</h3></div><button class="icon-btn" data-close-coupon>${icon("x")}</button></header><div class="modal-body"><div class="coupon-detail-summary"><span><small>Status</small><b>${statusLabel[coupon.status] || coupon.status}</b></span><span><small>Desconto</small><b>${esc(discount(coupon))}</b></span><span><small>Usos</small><b>${coupon.redemptionCount || 0} / ${coupon.maxRedemptions ?? "∞"}</b></span><span><small>Validade</small><b>${esc(dates(coupon))}</b></span><span><small>Pendentes</small><b>${pendingUses}</b></span><span><small>Ativas</small><b>${activeUses}</b></span><span><small>Falhas</small><b>${failedUses}</b></span><span><small>Receita da página</small><b>${money(generatedRevenue)}</b></span><span><small>Desconto da página</small><b>${money(grantedDiscount)}</b></span></div><h4>Utilizações recentes</h4><div class="coupon-uses">${uses.map((use) => `<article><b>${esc(use.businessId)}</b><span>${esc(use.planId)} · ${money(use.discountedPrice)}</span><em>${esc(use.status)}</em></article>`).join("") || "<p>Nenhuma utilização.</p>"}</div></div>`;
      $("[data-close-coupon]", modal).onclick = () => (modal.innerHTML = "");
    } catch (error) {
      modal.innerHTML = "";
      Utils.toast(error.message || "Não foi possível abrir o cupom.", true);
    }
    window.lucide?.createIcons();
  }
  function bindCards() {
    $$("[data-coupon-id]").forEach((card) => {
      const id = card.dataset.couponId;
      $("[data-coupon-details]", card).onclick = () => details(id);
      $("[data-coupon-edit]", card).onclick = async () => {
        try {
          const result = await call("getAdminCoupon", { couponId: id });
          openForm(result.coupon);
        } catch (error) {
          Utils.toast(error.message, true);
        }
      };
      $("[data-coupon-duplicate]", card).onclick = () => {
        const code = prompt("Novo código para a cópia:");
        if (!code) return;
        call("duplicateAdminCoupon", { couponId: id, code })
          .then(() => {
            Utils.toast("Cupom duplicado.");
            load();
          })
          .catch((error) => Utils.toast(error.message, true));
      };
      $$("[data-coupon-action]", card).forEach(
        (button) =>
          (button.onclick = () => {
            const action = button.dataset.couponAction;
            if (
              !confirm(
                action === "end"
                  ? "Encerrar este cupom permanentemente?"
                  : "Confirmar esta alteração?",
              )
            )
              return;
            call("actionAdminCoupon", { couponId: id, action })
              .then(() => {
                Utils.toast("Cupom atualizado.");
                load();
              })
              .catch((error) => Utils.toast(error.message, true));
          }),
      );
    });
  }
  function bind() {
    if (!context().internal) return;
    $$("[data-new-coupon]").forEach(
      (button) => (button.onclick = () => openForm()),
    );
    $("[data-refresh-coupons]")?.addEventListener("click", () => load(false));
    $("[data-coupon-search]")?.addEventListener("input", (event) => {
      state.search = event.target.value;
      paint();
    });
    $$("[data-coupon-filter]").forEach(
      (button) =>
        (button.onclick = () => {
          state.filter = button.dataset.couponFilter;
          $$("[data-coupon-filter]").forEach((item) =>
            item.classList.toggle("active", item === button),
          );
          paint();
        }),
    );
    load();
  }
  function syncAccess() {
    $$('[data-route="cupons"]').forEach((link) => (link.hidden = !context().internal));
    $$('[data-mobile-developer]').forEach((section) => (section.hidden = !context().internal));
  }
  addEventListener("business-context-changed", syncAccess);
  addEventListener("firebase-auth-ready", syncAccess);
  window.CouponsAdmin = {
    render,
    bind,
    isInternal: () => context().internal,
    syncAccess,
  };
})();
