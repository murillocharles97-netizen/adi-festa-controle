window.CustomerSubscriptions = (() => {
  const UNITS = new Set(["days", "weeks", "months", "years"]);
  const STATUS = new Set(["active", "expired", "paused", "cancelled"]);
  const now = () => new Date().toISOString();
  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const duration = (value, unit) => ({
    value: Math.max(1, Math.round(number(value, 30))),
    unit: UNITS.has(unit) ? unit : "days",
  });
  const addDuration = (dateValue, value, unit) => {
    const start = new Date(dateValue || Date.now()), next = new Date(start), normalized = duration(value, unit);
    if (normalized.unit === "days") next.setDate(next.getDate() + normalized.value);
    if (normalized.unit === "weeks") next.setDate(next.getDate() + normalized.value * 7);
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
  const preview = ({ subscription, at = now(), durationValue, durationUnit }) => {
    const normalized = duration(durationValue, durationUnit), currentExpiry = subscription?.expiresAt ? new Date(subscription.expiresAt) : null;
    const base = currentExpiry && currentExpiry.getTime() > new Date(at).getTime() ? currentExpiry.toISOString() : at;
    return { startsAt: base, expiresAt: addDuration(base, normalized.value, normalized.unit), ...normalized };
  };
  const event = (db, subscription, transition, sourceId, details = {}) => {
    db.customerSubscriptionEvents ??= [];
    const id = `${subscription.id}:${transition}:${sourceId}`;
    if (db.customerSubscriptionEvents.some((item) => item.id === id)) return;
    db.customerSubscriptionEvents.push({
      id, operationId: id, businessId: DB.getBusinessId?.() || null,
      subscriptionId: subscription.id, clientId: subscription.clientId,
      productId: subscription.productId, variantId: subscription.variantId || null,
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
      const subscriptionId = config.subscriptionId || item.subscriptionId || null;
      const existing = subscriptionId ? db.customerSubscriptions.find((entry) => entry.id === subscriptionId) : null;
      if (existing && existing.clientId !== clientId) throw Error("A vigência selecionada pertence a outro cliente.");
      if (existing?.lastSaleId === sale.id) {
        updates.push({ subscriptionId: existing.id, action: item.subscriptionAction || "unchanged", expiresAt: existing.expiresAt, idempotent: true });
        return;
      }
      const previous = existing ? structuredClone(existing) : null;
      const id = existing?.id || subscriptionId || Utils.uuid();
      const dates = preview({ subscription: existing, at: saleDate, durationValue: normalized.value, durationUnit: normalized.unit });
      const variant = item.variantId ? (db.variacoesProdutos || []).find((entry) => entry.id === item.variantId) : null;
      const next = {
        ...(existing || {}), id, operationId: id, businessId: DB.getBusinessId?.() || null,
        clientId, productId: item.produtoId, variantId: item.variantId || null,
        label: String(config.label || existing?.label || product?.renewalLabel || product?.nome || "Renovação").trim(),
        status: "active", startedAt: existing?.startedAt || saleDate, expiresAt: dates.expiresAt,
        durationValue: normalized.value, durationUnit: normalized.unit,
        contractedPrice: number(config.contractedPrice ?? item.precoFinalUnitario ?? item.precoUnitario ?? product?.preco),
        renewalCount: number(existing?.renewalCount) + (existing ? 1 : 0),
        lastRenewedAt: existing ? saleDate : null, createdFromSaleId: existing?.createdFromSaleId || sale.id,
        lastSaleId: sale.id, reminders: Array.isArray(config.reminders) ? config.reminders : (existing?.reminders || product?.renewalReminders || []),
        renewalMessage: config.renewalMessage || existing?.renewalMessage || product?.renewalMessage || "",
        createdAt: existing?.createdAt || saleDate, updatedAt: saleDate, schemaVersion: 13,
      };
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
      if (previous) db.customerSubscriptions[index] = previous;
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
  const metrics = (reference = now()) => {
    const endToday = new Date(reference); endToday.setHours(23, 59, 59, 999);
    const end7 = new Date(endToday); end7.setDate(end7.getDate() + 7);
    const active = list().filter((item) => effectiveStatus(item, reference) === "active");
    const dueToday = active.filter((item) => new Date(item.expiresAt) <= endToday);
    const due7 = active.filter((item) => new Date(item.expiresAt) > endToday && new Date(item.expiresAt) <= end7);
    const expired = list().filter((item) => effectiveStatus(item, reference) === "expired");
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
    const end = new Date(reference); end.setDate(end.getDate() + Math.max(0, number(days)));
    return loadUpcoming({ from: reference, to: end.toISOString(), status: "active", limit });
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
    const endToday = new Date(reference); endToday.setHours(23, 59, 59, 999);
    return {
      dueToday: due7.filter((item) => new Date(item.expiresAt) <= endToday).length,
      due7: due7.filter((item) => new Date(item.expiresAt) > endToday).length,
      expired: expired.length,
      forecastValue: due7.reduce((sum, item) => sum + number(item.contractedPrice), 0),
    };
  }
  return { duration, addDuration, effectiveStatus, list, events, get, forClient, matching, matchingProduct, preview, applySaleInData, reverseSaleInData, changeStatus, upcoming, metrics, loadForClient, loadUpcoming, loadByStatus, loadExpiring, loadExpired, loadRecentlyRenewed, loadDashboardMetrics };
})();
