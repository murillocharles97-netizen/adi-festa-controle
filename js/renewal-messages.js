// Renewal reminders for the Central de Mensagens. No sending engine here: this module only
// (1) freezes WHICH subscriptions a reminder is about (one space, per client), (2) re-checks
// them against the current record right before WhatsApp opens, (3) resolves the reminder
// variables without any Fiado balance and (4) reads the existing history for today's reminders.
window.RenewalMessages = (() => {
  const TYPE = "renewal";
  const VARIABLES = ["primeiro_nome", "nome", "renovacoes", "plano", "valor", "vencimento", "situacao", "espaco", "nome_negocio", "data_atual"];
  const SINGLE_PLAN = ["plano", "valor", "vencimento", "situacao"];
  const FORBIDDEN = ["saldo", "ultima_cobranca"]; // Fiado data never belongs to a renewal reminder.
  const DEFAULT_TEMPLATE = {
    id: "renewal-default", name: "Lembrete de renovação", type: TYPE, isDefault: true,
    content: "Olá, {{primeiro_nome}}! Passando para lembrar da sua renovação na {{nome_negocio}}:\n\n{{renovacoes}}\n\nPosso renovar para você?",
  };
  const UNITS = { days: ["dia", "dias"], weeks: ["semana", "semanas"], months: ["mês", "meses"], years: ["ano", "anos"] };
  const money = (value) => window.Utils?.dinheiro ? Utils.dinheiro(value) : `R$ ${Number(value || 0).toFixed(2)}`;
  const civilDate = (value) => value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
  const subs = () => window.CustomerSubscriptions;
  const period = (item) => {
    const value = Number(item.durationValue || 0), unit = UNITS[item.durationUnit] || UNITS.days;
    return value ? `${value} ${value === 1 ? unit[0] : unit[1]}` : "";
  };
  function situation(item, reference = new Date().toISOString()) {
    const days = subs()?.daysUntil?.(item.expiresAt, reference), status = subs()?.effectiveStatus?.(item, reference);
    if (days === null || days === undefined) return "";
    if (status === "expired") return days === 0 ? "venceu hoje" : `venceu há ${Math.abs(days)} ${Math.abs(days) === 1 ? "dia" : "dias"}`;
    if (days === 0) return "vence hoje";
    if (days === 1) return "vence amanhã";
    return `vence em ${days} dias`;
  }
  // What the operator selected, frozen per client and limited to ONE space.
  function snapshot(row, spaceName = "") {
    const product = window.Produtos?.obter?.(row.productId), variant = row.variantId ? window.ProductVariations?.get?.(row.variantId) : null;
    return {
      id: String(row.id), clientId: String(row.clientId), spaceId: subs()?.originSpace?.(row) ?? row.spaceId ?? null, spaceName: String(spaceName || ""),
      label: String(row.label || product?.nome || "Plano"), detail: variant ? String(window.ProductVariations?.displayName?.(variant) || "") : "",
      contractedPrice: Number(row.contractedPrice || 0), expiresAt: row.expiresAt?.toDate ? row.expiresAt.toDate().toISOString() : row.expiresAt || null,
      durationValue: row.durationValue ?? null, durationUnit: row.durationUnit || null,
      fingerprint: subs()?.renewalSnapshot ? subs().renewalSnapshot(row) : null,
    };
  }
  function buildContext(rows, { spaceId = null, spaceName = "" } = {}) {
    const items = {};
    for (const row of rows || []) {
      const item = snapshot(row, spaceName);
      if (spaceId && item.spaceId !== spaceId) throw Error("Selecione assinaturas de um único espaço para o lembrete.");
      (items[item.clientId] ||= []).push(item);
    }
    for (const list of Object.values(items)) list.sort((a, b) => new Date(a.expiresAt || 0) - new Date(b.expiresAt || 0));
    return { version: 1, spaceId, spaceName: String(spaceName || ""), createdAt: new Date().toISOString(), items };
  }
  // Keeps only the given clients (the Central may deselect someone) and the expected shape.
  function sanitize(context, clientIds) {
    if (!context || typeof context !== "object" || !context.items) return null;
    const allowed = new Set((clientIds || []).map(String)), items = {};
    for (const [clientId, list] of Object.entries(context.items)) {
      if (!allowed.has(clientId) || !Array.isArray(list)) continue;
      const clean = list.filter((item) => item && item.id && String(item.clientId) === clientId && item.spaceId === context.spaceId).slice(0, 20);
      if (clean.length) items[clientId] = clean.map((item) => ({ ...item }));
    }
    return Object.keys(items).length ? { version: 1, spaceId: context.spaceId ?? null, spaceName: String(context.spaceName || ""), createdAt: context.createdAt || null, items } : null;
  }
  const REASONS = {
    space: "o espaço ativo não é o espaço desta assinatura",
    unauthorized: "o espaço desta assinatura não está autorizado para você",
    unverified: "não foi possível conferir os dados agora (verifique a conexão)",
    missing: "a assinatura não foi encontrada",
    cancelled: "a assinatura foi cancelada",
    paused: "a assinatura está pausada",
    renewed: "a assinatura foi renovada ou alterada depois da seleção",
  };
  // Re-reads every selected subscription right before use. Anything that changed, moved space or
  // cannot be read now leaves the message (never sent with stale data).
  async function verify(context, clientId, { online = true } = {}) {
    const list = context?.items?.[String(clientId)] || [], valid = [], dropped = [];
    const space = window.SpaceContext, scoped = space?.scopesCustomers?.() === true, active = space?.activeId?.() || null;
    const authorized = new Set((space?.customerSpaces?.() || []).map((item) => item.id));
    const sync = window.SyncFirebase;
    for (const item of list) {
      const drop = (reason) => dropped.push({ item, reason, message: `${item.label}: ${REASONS[reason]}.` });
      if (scoped && item.spaceId !== context.spaceId) { drop("space"); continue; }
      if (scoped && item.spaceId !== active) { drop("space"); continue; }
      if (scoped && authorized.size && !authorized.has(item.spaceId)) { drop("unauthorized"); continue; }
      let live = null;
      try {
        if (online && navigator.onLine !== false && sync?.queryCustomerSubscriptions) {
          const result = await sync.queryCustomerSubscriptions({ clientId: String(clientId), subscriptionId: item.id, spaceView: true });
          live = Array.isArray(result) ? result.find((row) => row.id === item.id) || null : null;
        } else if (online && navigator.onLine === false) { drop("unverified"); continue; }
        else live = subs()?.get?.(item.id) || null;
      } catch { drop("unverified"); continue; }
      if (!live || live.deletedAt || live.active === false || String(live.clientId) !== String(clientId)) { drop("missing"); continue; }
      if ((subs()?.originSpace?.(live) ?? live.spaceId ?? null) !== item.spaceId) { drop("space"); continue; }
      const status = subs()?.effectiveStatus?.(live) || live.status;
      if (status === "cancelled") { drop("cancelled"); continue; }
      if (status === "paused") { drop("paused"); continue; }
      const current = subs()?.renewalSnapshot ? subs().renewalSnapshot(live) : null;
      if (item.fingerprint && current && Object.keys(item.fingerprint).some((key) => item.fingerprint[key] !== current[key])) { drop("renewed"); continue; }
      valid.push({ ...item, ...snapshot(live, item.spaceName) });
    }
    return { valid, dropped, signature: JSON.stringify(valid.map((item) => [item.id, item.fingerprint])) };
  }
  const tokens = (text) => [...String(text || "").matchAll(/{{\s*([a-z_]+)\s*}}/gi)].map((match) => match[1].toLowerCase());
  function line(item) {
    const value = `${money(item.contractedPrice)}${period(item) ? ` / ${period(item)}` : ""}`;
    return `• ${item.label}${item.detail && item.detail !== item.label ? ` (${item.detail})` : ""} — ${value} — ${situation(item)} (${civilDate(item.expiresAt)})`;
  }
  // Returns the final text and blocking problems. Plan, value and due date stay on the same line.
  function resolve(text, client, items) {
    const used = tokens(text), problems = [], base = window.Mensagens?.variables ? Mensagens.variables(client) : {};
    if (!items.length) problems.push("Nenhuma assinatura conferida para este cliente. Pule este contato.");
    if (used.some((key) => FORBIDDEN.includes(key)))
      problems.push("Lembretes de renovação não incluem saldo nem cobrança de Fiado. Remova {{saldo}} ou {{ultima_cobranca}}.");
    if (items.length > 1 && used.some((key) => SINGLE_PLAN.includes(key)))
      problems.push(`Este cliente tem ${items.length} planos. Use {{renovacoes}} para mostrar plano, valor e vencimento juntos em cada linha.`);
    const single = items.length === 1 ? items[0] : null;
    const values = {
      nome: base.nome ?? client?.nome ?? "", primeiro_nome: base.primeiro_nome ?? "", nome_negocio: base.nome_negocio ?? "",
      data_atual: base.data_atual ?? new Date().toLocaleDateString("pt-BR"),
      renovacoes: items.map(line).join("\n"),
      plano: single ? single.label : "", valor: single ? money(single.contractedPrice) : "",
      vencimento: single ? civilDate(single.expiresAt) : "", situacao: single ? situation(single) : "",
      espaco: items[0]?.spaceName || "",
    };
    const resolved = String(text || "").replace(/{{\s*([a-z_]+)\s*}}/gi, (_, key) => values[key.toLowerCase()] ?? "").replace(/\n{3,}/g, "\n\n").trim();
    return { text: resolved, problems };
  }
  const spDay = (value) => value ? new Date(value).toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" }) : "";
  // subscriptionId → latest reminder confirmed today (existing message history, any device).
  function remindedToday(reference = new Date()) {
    const today = spDay(reference), map = new Map();
    for (const event of window.Mensagens?.history?.() || []) {
      if (event.type !== TYPE || event.status !== "sent_confirmed" || spDay(event.sentAt || event.confirmedAt) !== today) continue;
      for (const id of event.subscriptionIds || []) if (!map.has(id) || event.sentAt > map.get(id).sentAt) map.set(id, event);
    }
    return map;
  }
  // Reminders confirmed today on OTHER devices live only in the cloud history: read them (best effort).
  let todayRead = { day: "", at: 0, promise: null };
  async function loadToday({ force = false } = {}) {
    const sync = window.SyncFirebase, end = subs()?.civilDayEnd?.(new Date().toISOString(), 0);
    if (!sync?.queryMessageHistorySince || !end || navigator.onLine === false) return false;
    const day = spDay(new Date());
    if (!force && todayRead.day === day && (todayRead.promise || Date.now() - todayRead.at < 60000)) return todayRead.promise || true;
    const since = new Date(new Date(end).getTime() - 86400000 + 1).toISOString();
    todayRead = { day, at: 0, promise: sync.queryMessageHistorySince(since).then(() => { todayRead.at = Date.now(); return true; })
      .catch(() => false).finally(() => { todayRead.promise = null; }) };
    return todayRead.promise;
  }
  const time = (value) => value ? new Date(value).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" }) : "";
  return { TYPE, VARIABLES, FORBIDDEN, DEFAULT_TEMPLATE, situation, snapshot, buildContext, sanitize, verify, resolve, remindedToday, loadToday, line, time };
})();
