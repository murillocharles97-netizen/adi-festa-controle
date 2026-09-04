window.FinancialEngine = (() => {
  const DAY = 86400000;
  const SPACE_TYPES = new Set(["business", "personal", "other"]);
  const DIRECTIONS = new Set(["in", "out"]);
  const ENTRY_STATUSES = new Set(["pending", "paid", "cancelled", "reversed"]);
  const PAYMENT_METHODS = new Set([
    "cash",
    "pix",
    "credit_card",
    "debit_card",
    "automatic_debit",
    "transfer",
    "other",
  ]);
  const BUSINESS_CATEGORIES = [
    ["rent", "Aluguel", "house"],
    ["energy", "Energia", "zap"],
    ["internet", "Internet", "wifi"],
    ["employees", "Funcionários", "users"],
    ["suppliers", "Fornecedores", "truck"],
    ["merchandise", "Mercadoria", "package"],
    ["marketing", "Marketing", "megaphone"],
    ["taxes", "Impostos", "landmark"],
    ["fees", "Taxas", "receipt"],
    ["transport", "Transporte", "car"],
    ["maintenance", "Manutenção", "wrench"],
    ["equipment", "Equipamentos", "monitor"],
    ["other", "Outros", "shapes"],
  ];
  const PERSONAL_CATEGORIES = [
    ["home", "Casa", "house"],
    ["market", "Mercado", "shopping-basket"],
    ["energy", "Energia", "zap"],
    ["internet", "Internet", "wifi"],
    ["transport", "Transporte", "bus"],
    ["car", "Carro", "car"],
    ["health", "Saúde", "heart-pulse"],
    ["leisure", "Lazer", "party-popper"],
    ["subscriptions", "Assinaturas", "repeat"],
    ["shopping", "Compras", "shopping-bag"],
    ["education", "Educação", "graduation-cap"],
    ["other", "Outros", "shapes"],
  ];

  const finite = (value) => Number.isFinite(Number(value));
  const cents = (value) => {
    if (!finite(value)) throw new Error("Informe um valor válido.");
    return Math.round(Number(value));
  };
  const moneyInputToCents = (value) => {
    const normalized = String(value ?? "")
      .trim()
      .replace(/\s/g, "")
      .replace(/^R\$/i, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const amount = Number(normalized);
    if (!Number.isFinite(amount) || amount <= 0)
      throw new Error("Informe um valor maior que zero.");
    return Math.round(amount * 100);
  };
  const formatMoney = (amountCents) =>
    (cents(amountCents) / 100).toLocaleString("pt-BR", {
      style: "currency",
      currency: "BRL",
    });
  const localDate = (value) => {
    if (!value) return null;
    if (typeof value.toDate === "function") return value.toDate();
    const date = value instanceof Date ? new Date(value) : new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const localDay = (value = new Date()) => {
    const date = localDate(value) || new Date();
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
  };
  const localIsoDate = (value = new Date()) => {
    const date = localDay(value);
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  };
  const periodKey = (value = new Date()) => localIsoDate(value).slice(0, 7);
  const monthRange = (key = periodKey()) => {
    if (!/^\d{4}-\d{2}$/.test(String(key)))
      throw new Error("Período mensal inválido.");
    const [year, month] = key.split("-").map(Number),
      start = new Date(year, month - 1, 1),
      endExclusive = new Date(year, month, 1);
    return { key, start, endExclusive, end: new Date(endExclusive.getTime() - 1) };
  };
  const addMonths = (value, count) => {
    const date = localDay(value),
      day = date.getDate(),
      target = new Date(date.getFullYear(), date.getMonth() + Number(count), 1),
      last = new Date(target.getFullYear(), target.getMonth() + 1, 0).getDate();
    target.setDate(Math.min(day, last));
    return target;
  };
  const addFrequency = (value, frequency, count = 1) => {
    const date = localDay(value);
    if (frequency === "weekly") date.setDate(date.getDate() + 7 * count);
    else if (frequency === "biweekly") date.setDate(date.getDate() + 14 * count);
    else if (frequency === "monthly") return addMonths(date, count);
    else if (frequency === "yearly") date.setFullYear(date.getFullYear() + count);
    return date;
  };
  const defaultCategories = (spaceType = "business") =>
    (spaceType === "personal" ? PERSONAL_CATEGORIES : BUSINESS_CATEGORIES).map(
      ([id, name, icon]) => ({ id: `default_${id}`, name, icon, system: true, active: true }),
    );
  const normalizeSpace = (raw = {}) => {
    const type = SPACE_TYPES.has(raw.type) ? raw.type : "other",
      name = String(raw.name || "").trim();
    if (!name) throw new Error("Informe o nome do espaço financeiro.");
    if (type === "business" && !String(raw.linkedBusinessId || "").trim())
      throw new Error("Escolha a empresa vinculada.");
    return {
      ...raw,
      name: name.slice(0, 80),
      type,
      linkedBusinessId: type === "business" ? String(raw.linkedBusinessId) : null,
      icon: String(raw.icon || (type === "business" ? "store" : type === "personal" ? "home" : "wallet")),
      active: raw.active !== false,
    };
  };
  const normalizeEntry = (raw = {}) => {
    const direction = DIRECTIONS.has(raw.direction) ? raw.direction : "out",
      status = ENTRY_STATUSES.has(raw.status) ? raw.status : "pending",
      amountCents = cents(raw.amountCents),
      description = String(raw.description || "").trim(),
      date = raw.occurredAt || raw.paidAt || raw.dueAt || new Date();
    if (!description) throw new Error("Informe a descrição.");
    if (amountCents <= 0) throw new Error("O valor deve ser maior que zero.");
    return {
      ...raw,
      description: description.slice(0, 160),
      direction,
      status,
      amountCents,
      currency: "BRL",
      periodKey: raw.periodKey || periodKey(date),
      sortAt: raw.sortAt || date,
      paymentMethod: raw.paymentMethod && PAYMENT_METHODS.has(raw.paymentMethod)
        ? raw.paymentMethod
        : null,
    };
  };
  const effectiveStatus = (entry, now = new Date()) => {
    if (["paid", "cancelled", "reversed"].includes(entry?.status)) return entry.status;
    const due = localDate(entry?.dueAt);
    return due && localDay(due) < localDay(now) ? "overdue" : "pending";
  };
  // Uma reversão é um contralançamento realizado. O lançamento original
  // permanece no razão para que original + reversão resultem exatamente zero.
  const isRealized = (entry) => entry?.status === "paid";
  const summarize = (entries = [], options = {}) => {
    const today = localDay(options.now || new Date()),
      inSevenDays = new Date(today.getTime() + 7 * DAY),
      realized = entries.filter(isRealized),
      totalInCents = realized
        .filter((entry) => entry.direction === "in")
        .reduce((sum, entry) => sum + cents(entry.amountCents), 0),
      totalOutCents = realized
        .filter((entry) => entry.direction === "out")
        .reduce((sum, entry) => sum + cents(entry.amountCents), 0),
      pending = entries.filter((entry) =>
        entry.direction === "out" && ["pending", "overdue"].includes(effectiveStatus(entry, today)),
      ),
      dueSoon = pending.filter((entry) => {
        const due = localDay(entry.dueAt);
        return due >= today && due <= inSevenDays;
      }),
      categoryTotals = new Map();
    for (const entry of realized.filter((item) => item.direction === "out")) {
      const id = String(entry.categoryId || "default_other"),
        current = categoryTotals.get(id) || {
          categoryId: id,
          categoryName: entry.categoryName || "Outros",
          amountCents: 0,
        };
      current.amountCents += cents(entry.amountCents);
      categoryTotals.set(id, current);
    }
    const categories = [...categoryTotals.values()]
      .map((category) => ({
        ...category,
        percentage: totalOutCents ? Math.round((category.amountCents / totalOutCents) * 100) : 0,
      }))
      .sort((left, right) => right.amountCents - left.amountCents || left.categoryName.localeCompare(right.categoryName, "pt-BR"));
    return {
      totalInCents,
      totalOutCents,
      resultCents: totalInCents - totalOutCents,
      pendingPayablesCents: pending.reduce((sum, entry) => sum + cents(entry.amountCents), 0),
      pendingCount: pending.length,
      dueSoonCount: dueSoon.length,
      categories,
    };
  };
  const sortPayables = (entries = [], now = new Date()) => [...entries]
    .filter((entry) => entry.direction === "out" && ["pending", "overdue"].includes(effectiveStatus(entry, now)))
    .sort((left, right) => {
      const leftOverdue = effectiveStatus(left, now) === "overdue" ? 0 : 1,
        rightOverdue = effectiveStatus(right, now) === "overdue" ? 0 : 1;
      return leftOverdue - rightOverdue || (localDate(left.dueAt)?.getTime() || Infinity) - (localDate(right.dueAt)?.getTime() || Infinity) || String(left.id).localeCompare(String(right.id));
    });
  const installmentAmounts = (totalCents, count) => {
    const total = cents(totalCents),
      quantity = Math.min(60, Math.max(1, Math.trunc(Number(count || 1)))),
      base = Math.floor(total / quantity),
      remainder = total - base * quantity;
    return Array.from({ length: quantity }, (_, index) => base + (index < remainder ? 1 : 0));
  };
  const buildInstallments = (input = {}) => {
    const amounts = installmentAmounts(input.amountCents, input.installmentCount),
      start = localDay(input.dueAt || new Date()),
      groupId = String(input.installmentGroupId || `installments_${input.operationId}`);
    return amounts.map((amountCents, index) => normalizeEntry({
      ...input,
      id: `${groupId}_${String(index + 1).padStart(2, "0")}`,
      operationId: `${input.operationId}:${index + 1}`,
      amountCents,
      dueAt: addMonths(start, index).toISOString(),
      occurredAt: null,
      paidAt: null,
      status: "pending",
      installmentGroupId: groupId,
      installmentNumber: index + 1,
      installmentCount: amounts.length,
      description: `${input.description} · ${index + 1}/${amounts.length}`,
    }));
  };
  const buildRecurringInstances = (input = {}, count = 2) => {
    const frequency = String(input.frequency || "none");
    if (frequency === "none") return [normalizeEntry(input)];
    const start = localDay(input.dueAt || new Date()),
      recurrenceId = String(input.recurrenceId || `recurrence_${input.operationId}`),
      quantity = Math.min(12, Math.max(1, Math.trunc(Number(count || 2))));
    return Array.from({ length: quantity }, (_, index) => {
      const dueAt = index ? addFrequency(start, frequency, index) : start;
      return normalizeEntry({
        ...input,
        id: `${recurrenceId}_${localIsoDate(dueAt)}`,
        operationId: `${input.operationId}:${localIsoDate(dueAt)}`,
        dueAt: dueAt.toISOString(),
        occurredAt: input.status === "paid" && index === 0 ? (input.occurredAt || dueAt.toISOString()) : null,
        paidAt: input.status === "paid" && index === 0 ? (input.paidAt || dueAt.toISOString()) : null,
        status: input.status === "paid" && index === 0 ? "paid" : "pending",
        recurrenceId,
        recurrenceSequence: index + 1,
      });
    });
  };
  const consolidate = (dashboards = []) => {
    const combined = dashboards.flatMap((item) => item.entries || []),
      summary = summarize(combined),
      latest = [...combined].sort((a, b) => (localDate(b.sortAt)?.getTime() || 0) - (localDate(a.sortAt)?.getTime() || 0));
    return { summary, entries: combined, latest: latest.slice(0, 20), payables: sortPayables(combined).slice(0, 20) };
  };

  return {
    SPACE_TYPES,
    DIRECTIONS,
    ENTRY_STATUSES,
    PAYMENT_METHODS,
    moneyInputToCents,
    formatMoney,
    localDate,
    localDay,
    localIsoDate,
    periodKey,
    monthRange,
    addMonths,
    addFrequency,
    defaultCategories,
    normalizeSpace,
    normalizeEntry,
    effectiveStatus,
    isRealized,
    summarize,
    sortPayables,
    installmentAmounts,
    buildInstallments,
    buildRecurringInstances,
    consolidate,
  };
})();
