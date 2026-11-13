window.CustomerSubscriptions = (() => {
  const UNITS = new Set(["days", "weeks", "months", "years"]);
  const STATUS = new Set(["active", "expired", "paused", "cancelled"]);
  const now = () => new Date().toISOString();
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const duration = (value, unit) => ({
    value: Math.max(1, Math.round(number(value, 30))),
    unit: UNITS.has(unit) ? unit : "days",
  });
  const calendarUnits = new Set(["months", "years"]);
  const renewalPolicyVersion = 1;
  const calendarFormat = new Intl.DateTimeFormat("en-GB", {
    timeZone: "America/Sao_Paulo", year: "numeric", month: "numeric", day: "numeric",
    hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
  });
  const calendarDate = (instant) => {
    const parts = Object.fromEntries(calendarFormat.formatToParts(instant).map(({ type, value }) => [type, Number(value)]));
    return new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, instant.getUTCMilliseconds()));
  };
  const calendarInstant = (value) => {
    const instant = new Date(value);
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return instant;
    // A date without a time denotes the civil date, even when UTC midnight is the previous day in São Paulo.
    const estimate = new Date(instant.getTime() + 12 * 60 * 60 * 1000);
    return new Date(estimate.getTime() + instant.getTime() - calendarDate(estimate).getTime());
  };
  const addDuration = (dateValue, value, unit, { anchorDay, legacy = false } = {}) => {
    const normalized = duration(value, unit), calendar = calendarUnits.has(normalized.unit) && !legacy,
      start = calendar ? calendarInstant(dateValue || Date.now()) : new Date(dateValue || Date.now()), next = new Date(start);
    if (normalized.unit === "days") next.setDate(next.getDate() + normalized.value);
    if (normalized.unit === "weeks") next.setDate(next.getDate() + normalized.value * 7);
    if (calendar) {
      const localStart = calendarDate(start), target = new Date(localStart);
      const months = normalized.value * (normalized.unit === "years" ? 12 : 1);
      target.setUTCMonth(target.getUTCMonth() + months, 1);
      const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
      target.setUTCDate(Math.min(anchorDay || localStart.getUTCDate(), lastDay));
      const candidate = new Date(start.getTime() + target.getTime() - localStart.getTime());
      const offsetChange = target.getTime() - calendarDate(candidate).getTime();
      return new Date(candidate.getTime() + offsetChange).toISOString();
    }
    if (normalized.unit === "months") next.setMonth(next.getMonth() + normalized.value);
    if (normalized.unit === "years") next.setFullYear(next.getFullYear() + normalized.value);
    return next.toISOString();
  };
  const effectiveStatus = (subscription, reference = Date.now()) => {
    if (["paused", "cancelled"].includes(subscription?.status)) return subscription.status;
    return new Date(subscription?.expiresAt || 0).getTime() < new Date(reference).getTime() ? "expired" : "active";
  };
  const list = () => DB.carregar().customerSubscriptions || [];
  const events = () => DB.carregar().customerSubscriptionEvents || [];
  const get = (id) => list().find((item) => item.id === id) || null;
  const forClient = (clientId, options = {}) => list()
    .filter((item) => item.clientId === clientId && (!options.statuses || options.statuses.includes(effectiveStatus(item))))
    .sort((a, b) => new Date(a.expiresAt || 0) - new Date(b.expiresAt || 0));
  const matching = (clientId, productId, variantId = null) => forClient(clientId)
    .filter((item) => item.productId === productId && String(item.variantId || "") === String(variantId || "") && !["cancelled"].includes(item.status));
  const matchingProduct = (clientId, productId) => forClient(clientId)
    .filter((item) => item.productId === productId && !["cancelled"].includes(item.status));
  const originSpace = (subscription) => {
    const { spaceId, financialSpaceId } = subscription || {};
    return spaceId && (!financialSpaceId || spaceId === financialSpaceId) ? spaceId : null;
  };
  const timestampValue = (value) => value?.toDate ? value.toDate().toISOString() : value || null;
  const renewalSnapshot = (subscription) => ({
    id: subscription.id,
    expiresAt: timestampValue(subscription.expiresAt),
    lastSaleId: subscription.lastSaleId || null,
    status: subscription.status || null,
    variantId: subscription.variantId || null,
    durationValue: subscription.durationValue ?? null,
    durationUnit: subscription.durationUnit || null,
    contractedPrice: subscription.contractedPrice ?? null,
    label: subscription.label || null,
    anchorDay: subscription.renewalCalendarAnchor?.day ?? null,
  });
  const requireRenewable = (subscription, { clientId, productId, businessId, spaceId, expected } = {}) => {
    if (!subscription || subscription.active === false || subscription.deletedAt || subscription.status === "cancelled")
      throw Error("A vigência selecionada não está mais disponível. Volte ao perfil do cliente para conferir.");
    if (subscription.clientId !== clientId || subscription.productId !== productId ||
        (subscription.businessId && subscription.businessId !== businessId))
      throw Error("A vigência selecionada não corresponde ao cliente ou produto desta venda.");
    const origin = originSpace(subscription);
    if (!origin) throw Error("O espaço original da vigência não está confirmado. Confira o contrato antes de renovar.");
    if (origin !== spaceId) throw Error("Renove a vigência no seu espaço original.");
    if (expected && Object.entries(renewalSnapshot(subscription)).some(([key, value]) => expected[key] !== value))
      throw Error("A vigência mudou. Volte ao perfil do cliente para conferir a renovação.");
    return subscription;
  };
  const preview = ({ subscription, at = now(), durationValue, durationUnit, legacy = false }) => {
    const normalized = duration(durationValue, durationUnit), expiry = legacy ? subscription?.expiresAt : timestampValue(subscription?.expiresAt),
      calendar = !legacy && calendarUnits.has(normalized.unit),
      currentExpiry = expiry ? (calendar ? calendarInstant(expiry) : new Date(expiry)) : null,
      reference = calendar ? calendarInstant(at) : new Date(at);
    const continuous = currentExpiry && (legacy ? currentExpiry > reference : currentExpiry >= reference);
    const base = continuous ? currentExpiry.toISOString() : at;
    const saved = subscription?.renewalCalendarAnchor;
    const anchorDay = calendar
      ? (continuous && timestampValue(saved?.expiresAt) === expiry && Number.isInteger(saved.day) && saved.day >= 1 && saved.day <= 31
        ? saved.day : calendarDate(calendarInstant(base)).getUTCDate())
      : null;
    return { startsAt: base, expiresAt: addDuration(base, normalized.value, normalized.unit, { anchorDay, legacy }), anchorDay, ...normalized };
  };
  const event = (db, subscription, transition, sourceId, details = {}) => {
    db.customerSubscriptionEvents ??= [];
    const id = `${subscription.id}:${transition}:${sourceId}`;
    if (db.customerSubscriptionEvents.some((item) => item.id === id)) return;
    db.customerSubscriptionEvents.push({
      id, operationId: id, businessId: DB.getBusinessId?.() || null,
      subscriptionId: subscription.id, clientId: subscription.clientId,
      productId: subscription.productId, variantId: subscription.variantId || null,
      spaceId: subscription.spaceId || null,
      transition, sourceType: details.sourceType || "sale", sourceId,
      previous: details.previous || null, next: details.next || null,
      note: details.note || "", createdAt: details.createdAt || now(), schemaVersion: 13,
    });
  };
  function applySaleInData(db, sale) {
    db.customerSubscriptions ??= [];
    if (!sale?.clientId && !sale?.clienteId) {
      if ((sale?.itens || []).some((item) => item.productType === "recurring" || item.recurringActivation))
        throw Error("Venda com renovação exige um cliente selecionado.");
      return [];
    }
    const updates = [], saleDate = sale.createdAt || sale.data || now(), clientId = sale.clientId || sale.clienteId;
    (sale.itens || []).forEach((item, index) => {
      const product = (db.produtos || []).find((entry) => entry.id === item.produtoId);
      if (product?.productType !== "recurring" && !item.recurringActivation) return;
      const config = item.recurringActivation || {}, normalized = duration(config.durationValue ?? product?.durationValue, config.durationUnit ?? product?.durationUnit);
      if ((Object.hasOwn(config, "renewalPolicyVersion") || Object.hasOwn(config, "expectedSubscription")) &&
          config.renewalPolicyVersion !== renewalPolicyVersion)
        throw Error("A política de renovação desta venda não é reconhecida.");
      const versioned = config.renewalPolicyVersion === renewalPolicyVersion;
      if (versioned && config.subscriptionId && item.subscriptionId && config.subscriptionId !== item.subscriptionId)
        throw Error("O identificador da vigência diverge da renovação selecionada.");
      const subscriptionId = config.subscriptionId || item.subscriptionId || null;
      const existing = subscriptionId ? db.customerSubscriptions.find((entry) => entry.id === subscriptionId) : null;
      if (existing && existing.clientId !== clientId) throw Error("A vigência selecionada pertence a outro cliente.");
      if (existing?.lastSaleId === sale.id) {
        updates.push({ subscriptionId: existing.id, action: item.subscriptionAction || "unchanged", expiresAt: existing.expiresAt, idempotent: true });
        return;
      }
      if (versioned && config.subscriptionId) {
        if (!config.expectedSubscription) throw Error("Confira novamente a vigência selecionada.");
        requireRenewable(existing, { clientId, productId: item.produtoId, businessId: DB.getBusinessId?.(),
          spaceId: sale.spaceId, expected: config.expectedSubscription });
      } else if (versioned && (existing || config.expectedSubscription != null)) {
        throw Error("Uma ativação não pode reutilizar uma vigência existente.");
      }
      const previous = existing ? structuredClone(existing) : null;
      const id = existing?.id || subscriptionId || Utils.uuid();
      const dates = preview({ subscription: existing, at: saleDate, durationValue: normalized.value, durationUnit: normalized.unit, legacy: !versioned });
      const variant = item.variantId ? (db.variacoesProdutos || []).find((entry) => entry.id === item.variantId) : null;
      const next = {
        ...(existing || {}), id, operationId: id, businessId: DB.getBusinessId?.() || null,
        ...(versioned && existing ? {} : { spaceId: sale.spaceId || existing?.spaceId || null }),
        clientId, productId: item.produtoId, variantId: item.variantId || null,
        label: String(config.label || existing?.label || product?.renewalLabel || product?.nome || "Renovação").trim(),
        status: "active", startedAt: existing?.startedAt || saleDate, expiresAt: dates.expiresAt,
        durationValue: normalized.value, durationUnit: normalized.unit,
        contractedPrice: number(config.contractedPrice ?? item.precoFinalUnitario ?? item.precoUnitario ?? product?.preco),
        renewalCount: number(existing?.renewalCount) + (existing ? 1 : 0),
        lastRenewedAt: existing ? saleDate : null, createdFromSaleId: existing?.createdFromSaleId || sale.id,
        lastSaleId: sale.id, reminders: Array.isArray(config.reminders) ? config.reminders : (existing?.reminders || product?.renewalReminders || []),
        renewalMessage: config.renewalMessage || existing?.renewalMessage || product?.renewalMessage || "",
        createdAt: existing?.createdAt || saleDate, updatedAt: saleDate, schemaVersion: 14,
      };
      if (versioned) next.renewalCalendarAnchor = dates.anchorDay ? { day: dates.anchorDay, expiresAt: dates.expiresAt } : null;
      if (existing) Object.assign(existing, next); else db.customerSubscriptions.push(next);
      Object.assign(item, {
        productType: "recurring", subscriptionId: id, subscriptionAction: existing ? "renewal" : "activation",
        renewalLabel: next.label, durationValue: normalized.value, durationUnit: normalized.unit,
        subscriptionStartedAt: dates.startsAt, subscriptionExpiresAt: next.expiresAt,
        subscriptionPrevious: previous,
      });
      event(db, next, existing ? "renewal" : "activation", sale.id, { previous, next: structuredClone(next), createdAt: saleDate });
      if (existing && number(previous?.contractedPrice) !== number(next.contractedPrice))
        event(db, next, "price_changed", sale.id, { previous, next: structuredClone(next), createdAt: saleDate });
      if (existing && String(previous?.variantId || "") !== String(next.variantId || ""))
        event(db, next, "plan_changed", sale.id, { previous, next: structuredClone(next), createdAt: saleDate });
      updates.push({ subscriptionId: id, action: item.subscriptionAction, expiresAt: next.expiresAt });
    });
    return updates;
  }
  function reverseSaleInData(db, sale) {
    const reversed = [];
    (sale?.itens || []).forEach((item) => {
      if (!item.subscriptionId) return;
      const index = (db.customerSubscriptions || []).findIndex((entry) => entry.id === item.subscriptionId), current = index >= 0 ? db.customerSubscriptions[index] : null;
      if (!current || current.lastSaleId !== sale.id) return;
      const previous = item.subscriptionPrevious || null;
      if (previous) {
        // Explicit null clears an anchor when the restored record predates it.
        db.customerSubscriptions[index] = item.recurringActivation?.renewalPolicyVersion === renewalPolicyVersion
          ? { ...previous, renewalCalendarAnchor: previous.renewalCalendarAnchor ?? null }
          : previous;
      }
      else db.customerSubscriptions.splice(index, 1);
      event(db, current, "sale_reversed", sale.id, { previous: structuredClone(current), next: previous, sourceType: "cancellation" });
      reversed.push(current.id);
    });
    return reversed;
  }
  const changeStatus = (id, requested, note = "") => {
    if (!STATUS.has(requested)) throw Error("Status de renovação inválido.");
    let saved;
    DB.alterar((db) => {
      const subscription = (db.customerSubscriptions || []).find((item) => item.id === id);
      if (!subscription) throw Error("Renovação não encontrada.");
      const previous = structuredClone(subscription), nextStatus = requested === "active" ? effectiveStatus({ ...subscription, status: "active" }) : requested;
      subscription.status = nextStatus; subscription.updatedAt = now(); saved = subscription;
      event(db, subscription, nextStatus === "active" ? "reactivated" : nextStatus, Utils.uuid(), { sourceType: "manual", previous, next: structuredClone(subscription), note });
    });
    return saved;
  };
  const upcoming = ({ from = now(), to, statuses = ["active"], clientId = null } = {}) => list().filter((item) => {
    const status = effectiveStatus(item, from), expiry = new Date(item.expiresAt || 0).getTime();
    return statuses.includes(status) && (!clientId || item.clientId === clientId) && expiry >= new Date(from).getTime() && (!to || expiry <= new Date(to).getTime());
  });
  // Dashboards count days on the São Paulo civil calendar (the same one used to compute
  // vigências), so "vence hoje" never depends on the device clock zone. Stored instants
  // (expiresAt) and effectiveStatus keep their meaning: only the day grouping is civil.
  const civilDay = (value) => {
    const instant = new Date(value);
    if (value == null || value === "" || !Number.isFinite(instant.getTime())) return null;
    const local = calendarDate(instant);
    return Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  };
  const daysUntil = (value, reference = now()) => {
    const target = civilDay(timestampValue(value)), today = civilDay(reference);
    return target === null || today === null ? null : Math.round((target - today) / 86400000);
  };
  const civilDayEnd = (reference = now(), plusDays = 0) => {
    const day = civilDay(reference);
    if (day === null) return new Date(reference).toISOString();
    const next = new Date(day + (Math.max(0, number(plusDays)) + 1) * 86400000).toISOString().slice(0, 10);
    return new Date(calendarInstant(next).getTime() - 1).toISOString();
  };
  const metrics = (reference = now(), rows = list()) => {
    const active = rows.filter((item) => effectiveStatus(item, reference) === "active");
    const dueToday = active.filter((item) => daysUntil(item.expiresAt, reference) === 0);
    const due7 = active.filter((item) => { const days = daysUntil(item.expiresAt, reference); return days >= 1 && days <= 7; });
    const expired = rows.filter((item) => effectiveStatus(item, reference) === "expired");
    return { dueToday: dueToday.length, due7: due7.length, expired: expired.length, forecastValue: [...dueToday, ...due7].reduce((sum, item) => sum + number(item.contractedPrice), 0) };
  };
  async function loadForClient(clientId) {
    const remote = await window.SyncFirebase?.queryCustomerSubscriptions?.({ clientId, limit: 50 });
    return remote || forClient(clientId);
  }
  async function loadUpcoming({ from = now(), to, status = "active", limit = 50 } = {}) {
    const remote = await window.SyncFirebase?.queryCustomerSubscriptions?.({ status, from, to, direction: "asc", limit });
    return remote || upcoming({ from, to, statuses: [status] });
  }
  async function loadByStatus(status, { from, to, limit = 50, direction = "asc" } = {}) {
    if (!STATUS.has(status)) throw Error("Status de renovação inválido.");
    const remote = await window.SyncFirebase?.queryCustomerSubscriptions?.({ status, from, to, direction, limit });
    return remote || list().filter((item) => effectiveStatus(item) === status);
  }
  async function loadExpiring(days = 7, reference = now(), limit = 50) {
    return loadUpcoming({ from: reference, to: civilDayEnd(reference, days), status: "active", limit });
  }
  async function loadExpired(reference = now(), limit = 50) {
    if (!window.SyncFirebase?.queryCustomerSubscriptions)
      return list().filter((item) => effectiveStatus(item, reference) === "expired");
    const [staleActive, explicitExpired] = await Promise.all([
      window.SyncFirebase.queryCustomerSubscriptions({ status: "active", to: reference, direction: "desc", limit }),
      window.SyncFirebase.queryCustomerSubscriptions({ status: "expired", to: reference, direction: "desc", limit }),
    ]);
    return [...new Map([...(staleActive || []), ...(explicitExpired || [])]
      .filter((item) => effectiveStatus(item, reference) === "expired")
      .map((item) => [item.id, item])).values()];
  }
  async function loadRecentlyRenewed(days = 30, reference = now(), limit = 50) {
    const start = new Date(reference); start.setDate(start.getDate() - Math.max(1, number(days, 30)));
    const remote = await window.SyncFirebase?.queryCustomerSubscriptions?.({ lastRenewedFrom: start.toISOString(), direction: "desc", limit });
    return remote || list().filter((item) => item.lastRenewedAt && new Date(item.lastRenewedAt) >= start);
  }
  async function loadDashboardMetrics(reference = now()) {
    const [due7, expired] = await Promise.all([loadExpiring(7, reference, 50), loadExpired(reference, 50)]);
    return {
      dueToday: due7.filter((item) => daysUntil(item.expiresAt, reference) === 0).length,
      due7: due7.filter((item) => daysUntil(item.expiresAt, reference) >= 1).length,
      expired: expired.length,
      forecastValue: due7.reduce((sum, item) => sum + number(item.contractedPrice), 0),
      // A limited read (50 per query) cannot prove it is a total.
      limited: due7.length >= 50 || expired.length >= 50,
    };
  }
  async function loadHomeMetrics(reference = now()) {
    return homeMetrics(await loadExpiring(7, reference, 50), reference, 50);
  }
  function homeMetrics(due, reference, limit = null) {
    return {
      limited: Number.isFinite(limit) && due.length >= limit,
      dueToday: due.filter((item) => daysUntil(item.expiresAt, reference) === 0).length,
      due7: due.filter((item) => daysUntil(item.expiresAt, reference) >= 1).length,
      forecastValue: due.reduce((sum, item) => sum + number(item.contractedPrice), 0),
      clientIds: [...new Set(due.map((item) => item.clientId).filter(Boolean))],
    };
  }
  // Renewals board (presentation only). It never writes and never renews.
  const searchable = (value) => String(value || "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();
  const BOARD_BUCKETS = ["active", "dueToday", "next7", "expired", "paused", "renewedRecently"];
  function board(rows = list(), { reference = now(), recentDays = 30, query = "", describe = null } = {}) {
    const needle = searchable(query), digits = String(query || "").replace(/\D/g, "");
    const matches = (item) => {
      if (!needle) return true;
      const extra = String(describe?.(item) || "");
      return searchable(`${item.label || ""} ${extra}`).includes(needle) ||
        (digits.length >= 3 && extra.replace(/\D/g, "").includes(digits));
    };
    const buckets = Object.fromEntries(BOARD_BUCKETS.map((key) => [key, []]));
    const recentLimit = Math.max(1, number(recentDays, 30));
    for (const source of rows || []) {
      if (!source || source.deletedAt || source.active === false || !matches(source)) continue;
      const status = effectiveStatus(source, reference), days = daysUntil(source.expiresAt, reference);
      const row = { ...source, effectiveStatus: status, daysUntil: days };
      if (status === "active") {
        buckets.active.push(row);
        if (days === 0) buckets.dueToday.push(row);
        else if (days !== null && days >= 1 && days <= 7) buckets.next7.push(row);
      } else if (status === "expired") buckets.expired.push(row);
      else if (status === "paused") buckets.paused.push(row);
      const renewedAgo = source.lastRenewedAt ? -daysUntil(source.lastRenewedAt, reference) : null;
      if (status !== "cancelled" && Number.isFinite(renewedAgo) && renewedAgo >= 0 && renewedAgo <= recentLimit)
        buckets.renewedRecently.push({ ...row, renewedDaysAgo: renewedAgo });
    }
    const expiry = (item) => new Date(timestampValue(item.expiresAt) || 0).getTime();
    ["active", "dueToday", "next7", "paused"].forEach((key) => buckets[key].sort((a, b) => expiry(a) - expiry(b)));
    buckets.expired.sort((a, b) => expiry(b) - expiry(a));
    buckets.renewedRecently.sort((a, b) => new Date(b.lastRenewedAt) - new Date(a.lastRenewedAt));
    const clientIds = Object.fromEntries(BOARD_BUCKETS.map((key) => [key, [...new Set(buckets[key].map((item) => item.clientId).filter(Boolean))]]));
    const counts = Object.fromEntries(BOARD_BUCKETS.map((key) => [key, buckets[key].length]));
    return {
      reference, buckets, counts, clientIds,
      forecastValue: [...buckets.dueToday, ...buckets.next7].reduce((sum, item) => sum + number(item.contractedPrice), 0),
      expiredValue: buckets.expired.reduce((sum, item) => sum + number(item.contractedPrice), 0),
    };
  }
  // Presentation only. Checkout and sale application use the V228 methods above.
  const visible = (item) => window.SpaceContext?.showsRenewal?.(item) ?? true;
  let spaceRead, spaceLoaded = null;
  const BOARD_PAGE = 50, BOARD_MAX_PAGES = 10, BOARD_STATUSES = ["active", "expired", "paused"];
  // Rows for the Renovações screen plus how much of the business they prove to cover.
  // complete=false means the numbers are a lower bound and the screen must say so.
  // Rows of the given authorized spaces (Renovações "Todos os espaços"), by the record's origin space.
  function inSpaces(spaceIds) {
    const context = window.SpaceContext, allowed = new Set((context?.customerSpaces?.() || []).map((space) => space.id));
    const ids = new Set(spaceIds.filter((id) => allowed.has(id)));
    const access = window.BusinessContext?.get?.();
    return (item) => Boolean(context && !window.OperationalReadPolicy?.restricted?.() && window.TeamAccess?.canRoute?.("clientes") !== false &&
      (!access?.businessId || access.role === "owner" || item.spaceId && context.recordSpace(item) === item.spaceId) &&
      ids.has(context.recordSpace(item)));
  }
  async function loadBoardRows({ maxPages = BOARD_MAX_PAGES, spaceIds = null } = {}) {
    const context = window.SpaceContext, sync = window.SyncFirebase, scope = context?.viewScope?.() ?? null;
    const many = Array.isArray(spaceIds) && spaceIds.length > 0 && context?.scopesCustomers?.();
    const filter = many ? inSpaces(spaceIds) : visible;
    const local = (source, extra = {}) => ({ rows: list().filter(filter), source, complete: false, limitReached: false, localOnly: 0, scope, ...extra });
    if (window.OperationalReadPolicy?.restricted?.()) return { ...local("restricted"), rows: [] };
    // Signed in but no authorized space is loaded: nothing can be scoped, so nothing is counted.
    if (context && context.snapshot?.().businessId && !context.activeId?.()) return { ...local("no-space"), rows: [] };
    if (!navigator.onLine || !sync?.queryCustomerSubscriptions) return local("device");
    if (many) {
      // Each authorized space is read completely (paged by spaceId/financialSpaceId).
      const results = await Promise.allSettled(spaceIds.map((id) => sync.queryRenewalsForSpace(id)));
      if (scope !== context.viewScope()) throw Error("O espaço ativo mudou. Abra Renovações novamente.");
      const ok = results.every((result) => result.status === "fulfilled");
      return local(ok ? "space" : "device", { complete: ok });
    }
    if (context?.activeId?.() && context.scopesCustomers?.()) {
      // Space read is complete (paged by spaceId/financialSpaceId until exhausted).
      await refreshSpace();
      const ok = spaceLoaded === scope && scope === context.viewScope();
      return local(ok ? "space" : "device", { complete: ok });
    }
    const rows = new Map(), reference = now(), complete = {};
    let lastActive = null;
    // Each window is read in the order that keeps its most urgent rows first, so a capped
    // read still has exact "hoje" / "7 dias" when the cap falls after day 7.
    const windows = [
      ["active", { status: "active", from: reference, direction: "asc" }],
      ["staleActive", { status: "active", to: reference, direction: "desc" }],
      ["expired", { status: "expired", direction: "desc" }],
      ["paused", { status: "paused", direction: "asc" }],
    ];
    for (const [name, query] of windows) {
      let cursor = null, pages = 0, hasMore = true;
      while (hasMore && pages < maxPages) {
        const page = await sync.queryCustomerSubscriptions({ ...query, limit: BOARD_PAGE, page: true, cursor, spaceView: true });
        const items = Array.isArray(page) ? page : page?.items || [];
        items.forEach((item) => rows.set(item.id, item));
        if (name === "active" && items.length) lastActive = items.at(-1);
        cursor = Array.isArray(page) ? null : page?.cursor || null;
        hasMore = !Array.isArray(page) && Boolean(page?.hasMore) && Boolean(cursor);
        pages += 1;
      }
      complete[name] = !hasMore;
    }
    const limitReached = Object.values(complete).some((value) => !value);
    const pastWeek = lastActive && daysUntil(lastActive.expiresAt, reference) > 7;
    const exact = {
      active: complete.active, paused: complete.paused,
      dueToday: complete.active || Boolean(pastWeek), next7: complete.active || Boolean(pastWeek),
      expired: complete.staleActive && complete.expired, renewedRecently: !limitReached,
    };
    if (scope !== (context?.viewScope?.() ?? null)) throw Error("O espaço ativo mudou. Abra Renovações novamente.");
    let localOnly = 0;
    for (const item of list()) {
      const cloud = rows.get(item.id);
      // A renewal just made on this device may not be in the cloud read yet; never drop it silently.
      if (cloud && new Date(item.updatedAt || 0) > new Date(cloud.updatedAt || 0)) rows.set(item.id, item);
      else if (!cloud && !item.deletedAt && item.status !== "cancelled" && visible(item)) localOnly += 1;
    }
    return { rows: [...rows.values()].filter(visible), source: "cloud", complete: !limitReached, limitReached, exact,
      limit: BOARD_PAGE * maxPages, localOnly, scope };
  }
  function refreshSpace() {
    const context = window.SpaceContext, sync = window.SyncFirebase;
    if (!navigator.onLine || !context?.activeId?.() || !context.scopesCustomers() ||
        !sync?.queryRenewalsForSpace || window.OperationalReadPolicy?.restricted?.()) return;
    const scope = context.viewScope();
    if (spaceRead?.scope === scope && (spaceRead.promise || Date.now() - spaceRead.updatedAt < 120000))
      return spaceRead.promise;
    const read = spaceRead = { scope, updatedAt: 0, promise: null };
    read.promise = sync.queryRenewalsForSpace().then(() => { read.updatedAt = Date.now(); spaceLoaded = scope; })
      .catch(error => {
        if (spaceLoaded === scope) spaceLoaded = null;
        if (scope === context.viewScope()) console.warn("[Renovações] Não foi possível atualizar este espaço.", { code: error?.code || "offline" });
      }).finally(() => { read.promise = null; });
    return read.promise;
  }
  const view = {
    refreshSpace,
    forClient: (id) => forClient(id).filter(visible),
    get: (id) => list().find((item) => item.id === id && visible(item)) || null,
    hasUnassigned: (id) => forClient(id).some((item) => window.SpaceContext?.showsUnassignedRenewal?.(item)),
    loadForClient: (id) => window.SyncFirebase?.queryCustomerSubscriptions?.({ clientId: id, limit: 50, spaceView: true }),
    metrics: (reference = now()) => metrics(reference, list().filter(visible)),
    board: (options = {}) => board(list().filter(visible), options),
    loadBoardRows,
    // Lets "Atualizar" bypass the 2-minute space read throttle (never cancels a read in flight).
    invalidateSpace() { if (!spaceRead?.promise) spaceRead = null; },
    async loadHomeMetrics(reference = now()) {
      if (window.SpaceContext?.scopesCustomers?.()) {
        await refreshSpace();
        return view.metrics(reference);
      }
      const due = await window.SyncFirebase?.queryCustomerSubscriptions?.({
        status: "active", from: reference, to: civilDayEnd(reference, 7), direction: "asc",
        limit: 50, spaceView: true,
      });
      return due ? homeMetrics(due, reference, 50) : view.metrics(reference);
    },
  };
  return { view, board, daysUntil, civilDayEnd, duration, addDuration, effectiveStatus, list, events, get, forClient, matching, matchingProduct, preview, renewalPolicyVersion, originSpace, renewalSnapshot, requireRenewable, applySaleInData, reverseSaleInData, changeStatus, upcoming, metrics, loadForClient, loadUpcoming, loadByStatus, loadExpiring, loadExpired, loadRecentlyRenewed, loadDashboardMetrics, loadHomeMetrics };
})();
