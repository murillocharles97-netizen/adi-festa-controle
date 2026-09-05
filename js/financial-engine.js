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
  const PERSONAL_CATEGORY_TEMPLATES = [
    ["home", "Casa", "house", [["rent", "Aluguel"], ["condominium", "Condomínio"], ["energy", "Energia"], ["water", "Água"], ["internet", "Internet"], ["gas", "Gás"], ["maintenance", "Manutenção"], ["furniture", "Móveis"], ["other", "Outros"]]],
    ["food", "Alimentação", "utensils", [["market", "Mercado"], ["restaurant", "Restaurante"], ["delivery", "Delivery"], ["bakery", "Padaria"], ["other", "Outros"]]],
    ["transport", "Transporte", "bus", [["fuel", "Combustível"], ["apps", "Aplicativos"], ["bus", "Ônibus"], ["parking", "Estacionamento"], ["toll", "Pedágio"], ["other", "Outros"]]],
    ["car", "Carro", "car", [["fuel", "Combustível"], ["insurance", "Seguro"], ["maintenance", "Manutenção"], ["wash", "Lavagem"], ["documents", "Documentação"], ["financing", "Financiamento"], ["other", "Outros"]]],
    ["health", "Saúde", "heart-pulse", [["consultations", "Consultas"], ["medicines", "Medicamentos"], ["exams", "Exames"], ["health_plan", "Plano de saúde"], ["other", "Outros"]]],
    ["education", "Educação", "graduation-cap", [["tuition", "Mensalidade"], ["courses", "Cursos"], ["books", "Livros"], ["materials", "Materiais"], ["other", "Outros"]]],
    ["leisure", "Lazer", "party-popper", [["trips", "Viagens"], ["events", "Eventos"], ["games", "Jogos"], ["other", "Outros"]]],
    ["subscriptions", "Assinaturas", "repeat", [["streaming", "Streaming"], ["software", "Software"], ["mobile", "Celular"], ["internet", "Internet"], ["gym", "Academia"], ["other", "Outros"]]],
    ["shopping", "Compras", "shopping-bag", [["clothes", "Roupas"], ["electronics", "Eletrônicos"], ["home", "Casa"], ["other", "Outros"]]],
    ["debts", "Dívidas", "badge-dollar-sign", [["loan", "Empréstimo"], ["financing", "Financiamento"], ["credit_card", "Cartão de crédito"], ["other", "Outros"]]],
    ["taxes", "Impostos", "landmark", [["property", "Imóvel"], ["vehicle", "Veículo"], ["income", "Renda"], ["other", "Outros"]]],
    ["pets", "Pets", "paw-print", [["food", "Alimentação"], ["veterinary", "Veterinário"], ["hygiene", "Higiene"], ["other", "Outros"]]],
    ["family", "Família", "users", [["children", "Filhos"], ["support", "Ajuda familiar"], ["other", "Outros"]]],
    ["other", "Outros", "shapes", []],
  ];
  const BUSINESS_CATEGORY_TEMPLATES = [
    ["structure", "Estrutura", "store", [["rent", "Aluguel"], ["condominium", "Condomínio"], ["energy", "Energia"], ["water", "Água"], ["internet", "Internet"], ["cleaning", "Limpeza"], ["security", "Segurança"], ["maintenance", "Manutenção"]]],
    ["inventory", "Estoque e mercadorias", "package", [["merchandise", "Compra de mercadoria"], ["supplies", "Insumos"], ["packaging", "Embalagens"], ["replacement", "Reposição"], ["freight", "Frete"]]],
    ["suppliers", "Fornecedores", "truck", []],
    ["team", "Equipe", "users", [["salary", "Salários"], ["commission", "Comissões"], ["benefits", "Benefícios"], ["freelancer", "Freelancer"]]],
    ["marketing", "Marketing", "megaphone", [["ads", "Anúncios"], ["social", "Redes sociais"], ["print", "Impressos"], ["influencers", "Influenciadores"], ["promotions", "Promoções"]]],
    ["transport", "Transporte", "car", [["fuel", "Combustível"], ["freight", "Frete"], ["apps", "Aplicativos"], ["parking", "Estacionamento"], ["toll", "Pedágio"]]],
    ["systems", "Sistemas e assinaturas", "monitor-cog", [["erp", "ERP"], ["software", "Software"], ["internet", "Internet"], ["phone", "Telefone"], ["online", "Serviços online"]]],
    ["taxes", "Impostos e taxas", "landmark", [["taxes", "Impostos"], ["bank", "Taxas bancárias"], ["marketplace", "Taxas de marketplace"], ["card", "Taxas de cartão"]]],
    ["maintenance", "Manutenção", "wrench", []],
    ["equipment", "Equipamentos", "monitor", [["computer", "Computador"], ["printer", "Impressora"], ["machine", "Máquina"], ["tools", "Ferramentas"], ["furniture", "Móveis"]]],
    ["services", "Serviços", "briefcase-business", []],
    ["withdrawals", "Retiradas", "hand-coins", []],
    ["finance", "Financeiro", "wallet-cards", []],
    ["other", "Outros", "shapes", []],
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
  const belongsToPeriod = (entry = {}, key = periodKey()) => {
    const { start, endExclusive } = monthRange(key), candidate = localDate(
      entry.status === "paid"
        ? entry.occurredAt || entry.paidAt || entry.dueAt
        : entry.dueAt || entry.sortAt,
    );
    return Boolean(candidate && candidate >= start && candidate < endExclusive);
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
  const templateType = (spaceType = "business") => spaceType === "business" ? "business" : "personal";
  const defaultCategoryTree = (spaceType = "business") => {
    const type = templateType(spaceType), templates = type === "business" ? BUSINESS_CATEGORY_TEMPLATES : PERSONAL_CATEGORY_TEMPLATES;
    return templates.flatMap(([slug, name, icon, children], categoryIndex) => {
      const id = `default_${type}_${slug}`, category = {
        id,
        name,
        icon,
        type: "category",
        parentCategoryId: null,
        financialSpaceId: null,
        isDefault: true,
        system: true,
        active: true,
        sortOrder: categoryIndex,
      };
      return [category, ...children.map(([childSlug, childName], subcategoryIndex) => ({
        id: `${id}_${childSlug}`,
        name: childName,
        icon: "tag",
        type: "subcategory",
        parentCategoryId: id,
        financialSpaceId: null,
        isDefault: true,
        system: true,
        active: true,
        sortOrder: subcategoryIndex,
      }))];
    });
  };
  const defaultCategories = (spaceType = "business") =>
    defaultCategoryTree(spaceType).filter((item) => item.type === "category");
  const subcategoriesFor = (items = [], categoryId = "") => items.filter(
    (item) => item.type === "subcategory" && item.parentCategoryId === categoryId && item.active !== false,
  );
  const LEGACY_CATEGORY_MAP = {
    business: {
      rent: ["structure", "rent"], aluguel: ["structure", "rent"],
      energy: ["structure", "energy"], energia: ["structure", "energy"],
      internet: ["structure", "internet"],
      employees: ["team", null], funcionarios: ["team", null], funcionários: ["team", null],
      suppliers: ["suppliers", null], fornecedores: ["suppliers", null],
      merchandise: ["inventory", "merchandise"], mercadoria: ["inventory", "merchandise"],
      marketing: ["marketing", null], taxes: ["taxes", "taxes"], impostos: ["taxes", "taxes"],
      transport: ["transport", null], transporte: ["transport", null],
      maintenance: ["maintenance", null], manutenção: ["maintenance", null], manutencao: ["maintenance", null],
      equipment: ["equipment", null], equipamentos: ["equipment", null],
      other: ["other", null], outros: ["other", null],
    },
    personal: {
      home: ["home", null], casa: ["home", null],
      rent: ["home", "rent"], aluguel: ["home", "rent"],
      market: ["food", "market"], mercado: ["food", "market"],
      energy: ["home", "energy"], energia: ["home", "energy"],
      internet: ["home", "internet"],
      transport: ["transport", null], transporte: ["transport", null],
      car: ["car", null], carro: ["car", null], health: ["health", null], saúde: ["health", null], saude: ["health", null],
      leisure: ["leisure", null], lazer: ["leisure", null], subscriptions: ["subscriptions", null], assinaturas: ["subscriptions", null],
      shopping: ["shopping", null], compras: ["shopping", null], education: ["education", null], educação: ["education", null], educacao: ["education", null],
      other: ["other", null], outros: ["other", null],
    },
  };
  const normalizedLabel = (value) => String(value || "").trim().toLocaleLowerCase("pt-BR");
  const legacyCategoryUpgrade = (entry = {}, spaceType = "business") => {
    if (entry.categorySchemaVersion >= 2 || entry.subcategoryId || entry.subcategoryName) return null;
    const type = templateType(spaceType), rawId = String(entry.categoryId || "").replace(/^default_/, ""), rawName = normalizedLabel(entry.categoryName), pair = LEGACY_CATEGORY_MAP[type][rawId] || LEGACY_CATEGORY_MAP[type][rawName];
    if (!pair) return null;
    const [categorySlug, subcategorySlug] = pair, tree = defaultCategoryTree(type), categoryId = `default_${type}_${categorySlug}`, category = tree.find((item) => item.id === categoryId), subcategoryId = subcategorySlug ? `${categoryId}_${subcategorySlug}` : null, subcategory = subcategoryId ? tree.find((item) => item.id === subcategoryId) : null;
    if (!category) return null;
    return {
      categoryId: category.id,
      categoryName: category.name,
      categoryIcon: category.icon,
      subcategoryId: subcategory?.id || null,
      subcategoryName: subcategory?.name || null,
      categorySchemaVersion: 2,
      categoryMigrationStatus: "migrated",
    };
  };
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
      duePeriodKey: raw.duePeriodKey || periodKey(raw.dueAt || date),
      sortAt: raw.sortAt || date,
      paymentMethod: raw.paymentMethod && PAYMENT_METHODS.has(raw.paymentMethod)
        ? raw.paymentMethod
        : null,
      subcategoryId: raw.subcategoryId || null,
      subcategoryName: raw.subcategoryName || null,
      categorySchemaVersion: Number(raw.categorySchemaVersion || (raw.subcategoryId || raw.subcategoryName ? 2 : 1)),
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
  const occurrenceKey = (entryOrDate) => localIsoDate(
    entryOrDate && typeof entryOrDate === "object" && !(entryOrDate instanceof Date)
      ? entryOrDate.dueAt
      : entryOrDate,
  );
  const shouldGenerateOccurrence = (recurrence = {}, dueAt) => {
    if (recurrence.active === false) return false;
    const due = localDay(dueAt), start = localDate(recurrence.seriesStartAt), end = localDate(recurrence.seriesEndAt), key = occurrenceKey(due);
    if (start && due < localDay(start)) return false;
    if (end && due >= localDay(end)) return false;
    const exceptions = new Set([
      ...(recurrence.skippedOccurrenceKeys || []),
      ...(recurrence.overrideOccurrenceKeys || []),
    ]);
    return !exceptions.has(key);
  };
  const rescheduleRecurringInstances = (entries = [], anchorEntry = {}, newStart, frequency = "monthly") => {
    const start = localDay(newStart || anchorEntry.dueAt), anchorSequence = Number(anchorEntry.recurrenceSequence || 0);
    return entries.map((entry, index) => {
      const sequence = Number(entry.recurrenceSequence || 0), offset = anchorSequence && sequence >= anchorSequence
        ? sequence - anchorSequence
        : index,
        dueAt = (offset ? addFrequency(start, frequency, offset) : start).toISOString();
      return { ...entry, dueAt, duePeriodKey: periodKey(dueAt), periodKey: periodKey(dueAt), sortAt: dueAt };
    });
  };
  const consolidate = (dashboards = []) => {
    const combined = dashboards.flatMap((item) => item.entries || []),
      combinedAccounts = dashboards.flatMap((item) => item.accounts || item.entries || []),
      summary = summarize(combined),
      latest = [...combined].sort((a, b) => (localDate(b.sortAt)?.getTime() || 0) - (localDate(a.sortAt)?.getTime() || 0));
    return { summary, entries: combined, accounts: combinedAccounts, latest: latest.slice(0, 20), payables: sortPayables(combinedAccounts).slice(0, 20) };
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
    belongsToPeriod,
    addMonths,
    addFrequency,
    defaultCategories,
    defaultCategoryTree,
    subcategoriesFor,
    legacyCategoryUpgrade,
    normalizeSpace,
    normalizeEntry,
    effectiveStatus,
    isRealized,
    summarize,
    sortPayables,
    installmentAmounts,
    buildInstallments,
    buildRecurringInstances,
    occurrenceKey,
    shouldGenerateOccurrence,
    rescheduleRecurringInstances,
    consolidate,
  };
})();
