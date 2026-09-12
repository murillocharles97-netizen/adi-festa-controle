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
    ["finance", "Financeiro", "wallet-cards", [["fees", "Taxas financeiras"]]],
    ["other", "Outros", "shapes", []],
  ];
  const BUSINESS_CATEGORY_TEMPLATES = [
    ["sales", "Vendas", "badge-dollar-sign", [["customer_receipt", "Recebimento de cliente"], ["online_order", "Pedido online"], ["other", "Outros"]]],
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
    ["finance", "Financeiro", "wallet-cards", [["fees", "Taxas financeiras"]]],
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
  const balanceInputToCents = (value) => {
    const normalized = String(value ?? "")
      .trim()
      .replace(/\s/g, "")
      .replace(/^R\$/i, "")
      .replace(/\.(?=\d{3}(?:\D|$))/g, "")
      .replace(",", ".");
    const amount = Number(normalized || 0);
    if (!Number.isFinite(amount)) throw new Error("Informe um saldo válido.");
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
  // `cashFlowEffect` separa competência de caixa. Uma compra no crédito é uma
  // despesa reconhecida hoje, mas só vira saída quando a fatura é paga.
  const isRealized = (entry) => entry?.status === "paid" && entry?.cashFlowEffect !== false && entry?.sourceType !== "transfer";
  const isExpenseRecognized = (entry) => entry?.direction === "out"
    && entry?.status === "paid"
    && entry?.expenseRecognized !== false
    && entry?.sourceType !== "transfer"
    && !entry?.reversedByEntryId;
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
      expenses = entries.filter(isExpenseRecognized),
      expenseAdjustmentsCents = entries.reduce((sum, entry) =>
        sum + (Number.isInteger(entry?.expenseAdjustmentCents) ? entry.expenseAdjustmentCents : 0), 0),
      expensesTotalCents = Math.max(0, expenses.reduce((sum, entry) => sum + cents(entry.amountCents), 0) + expenseAdjustmentsCents),
      pending = entries.filter((entry) =>
        entry.direction === "out" && ["pending", "overdue"].includes(effectiveStatus(entry, today)),
      ),
      dueSoon = pending.filter((entry) => {
        const due = localDay(entry.dueAt);
        return due >= today && due <= inSevenDays;
      }),
      categoryTotals = new Map();
    for (const entry of expenses) {
      const id = String(entry.categoryId || "default_other"),
        current = categoryTotals.get(id) || {
          categoryId: id,
          categoryName: entry.categoryName || "Outros",
          amountCents: 0,
        };
      current.amountCents += cents(entry.amountCents);
      categoryTotals.set(id, current);
    }
    for (const entry of entries.filter((item) => Number.isInteger(item?.expenseAdjustmentCents))) {
      const id = String(entry.categoryId || "default_other"), current = categoryTotals.get(id) || {
        categoryId: id,
        categoryName: entry.categoryName || "Outros",
        amountCents: 0,
      };
      current.amountCents = Math.max(0, current.amountCents + entry.expenseAdjustmentCents);
      categoryTotals.set(id, current);
    }
    const categories = [...categoryTotals.values()]
      .filter((category) => category.amountCents > 0)
      .map((category) => ({
        ...category,
        percentage: expensesTotalCents ? Math.round((category.amountCents / expensesTotalCents) * 100) : 0,
      }))
      .sort((left, right) => right.amountCents - left.amountCents || left.categoryName.localeCompare(right.categoryName, "pt-BR"));
    return {
      totalInCents,
      totalOutCents,
      resultCents: totalInCents - totalOutCents,
      expensesTotalCents,
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
  const dayInMonth = (year, monthIndex, requestedDay) => {
    const lastDay = new Date(year, monthIndex + 1, 0).getDate();
    return new Date(year, monthIndex, Math.min(lastDay, Math.max(1, Math.trunc(Number(requestedDay || 1)))), 12);
  };
  const invoiceReferenceKey = (year, monthIndex) =>
    `${year}-${String(monthIndex + 1).padStart(2, "0")}`;
  const parseReferenceKey = (key) => {
    if (!/^\d{4}-\d{2}$/.test(String(key))) throw new Error("Referência de fatura inválida.");
    const [year, month] = String(key).split("-").map(Number);
    return { year, monthIndex: month - 1 };
  };
  const creditCardInvoiceCycle = (input = {}) => {
    const { year, monthIndex } = parseReferenceKey(input.referenceKey),
      closingDay = Math.min(31, Math.max(1, Math.trunc(Number(input.closingDay)))),
      dueDay = Math.min(31, Math.max(1, Math.trunc(Number(input.dueDay))));
    if (!Number.isInteger(closingDay) || !Number.isInteger(dueDay))
      throw new Error("Informe fechamento e vencimento válidos.");
    const closingDate = dayInMonth(year, monthIndex, closingDay),
      previousReference = new Date(year, monthIndex - 1, 1, 12),
      previousClosing = dayInMonth(previousReference.getFullYear(), previousReference.getMonth(), closingDay),
      openingDate = new Date(previousClosing),
      dueMonthOffset = dueDay > closingDay ? 0 : 1,
      dueBase = new Date(year, monthIndex + dueMonthOffset, 1, 12);
    openingDate.setDate(openingDate.getDate() + 1);
    return {
      referenceKey: invoiceReferenceKey(year, monthIndex),
      referenceYear: year,
      referenceMonth: monthIndex + 1,
      openingDate: openingDate.toISOString(),
      closingDate: closingDate.toISOString(),
      dueDate: dayInMonth(dueBase.getFullYear(), dueBase.getMonth(), dueDay).toISOString(),
    };
  };
  const resolveCreditCardInvoiceForPurchase = (input = {}) => {
    const purchaseDate = localDay(input.purchaseDate || new Date()),
      closingDay = Math.min(31, Math.max(1, Math.trunc(Number(input.closingDay)))),
      dueDay = Math.min(31, Math.max(1, Math.trunc(Number(input.dueDay))));
    if (!Number.isInteger(closingDay) || !Number.isInteger(dueDay))
      throw new Error("Informe fechamento e vencimento válidos.");
    let referenceYear = purchaseDate.getFullYear(), referenceMonthIndex = purchaseDate.getMonth(),
      closingDate = dayInMonth(referenceYear, referenceMonthIndex, closingDay);
    // O dia do fechamento ainda pertence à fatura atual. Somente compras após
    // o fechamento entram no ciclo seguinte.
    if (purchaseDate > closingDate) {
      const next = new Date(referenceYear, referenceMonthIndex + 1, 1, 12);
      referenceYear = next.getFullYear();
      referenceMonthIndex = next.getMonth();
      closingDate = dayInMonth(referenceYear, referenceMonthIndex, closingDay);
    }
    const previousReference = new Date(referenceYear, referenceMonthIndex - 1, 1, 12),
      previousClosing = dayInMonth(previousReference.getFullYear(), previousReference.getMonth(), closingDay),
      openingDate = new Date(previousClosing);
    openingDate.setDate(openingDate.getDate() + 1);
    // Compare os dias configurados, não o dia efetivo após o ajuste de fim de mês.
    // Ex.: fecha 31 e vence 30 continua vencendo no mês seguinte, inclusive em fevereiro.
    const dueMonthOffset = dueDay > closingDay ? 0 : 1,
      dueBase = new Date(referenceYear, referenceMonthIndex + dueMonthOffset, 1, 12),
      dueDate = dayInMonth(dueBase.getFullYear(), dueBase.getMonth(), dueDay),
      referenceKey = invoiceReferenceKey(referenceYear, referenceMonthIndex);
    return {
      referenceKey,
      referenceYear,
      referenceMonth: referenceMonthIndex + 1,
      openingDate: openingDate.toISOString(),
      closingDate: closingDate.toISOString(),
      dueDate: dueDate.toISOString(),
    };
  };
  const buildCreditCardInstallments = (input = {}) => {
    const amountCents = cents(input.amountCents), count = Math.min(60, Math.max(1, Math.trunc(Number(input.installmentCount || 1)))),
      amounts = installmentAmounts(amountCents, count), firstInvoice = resolveCreditCardInvoiceForPurchase(input),
      groupId = String(input.installmentGroupId || input.operationId || "").trim();
    if (!groupId) throw new Error("A compra precisa de um identificador idempotente.");
    return amounts.map((installmentAmountCents, index) => {
      const invoice = index === 0 ? firstInvoice : (() => {
        const { year, monthIndex } = parseReferenceKey(firstInvoice.referenceKey),
          target = new Date(year, monthIndex + index, 1, 12),
          closingDate = dayInMonth(target.getFullYear(), target.getMonth(), input.closingDay),
          previous = new Date(target.getFullYear(), target.getMonth() - 1, 1, 12),
          previousClosing = dayInMonth(previous.getFullYear(), previous.getMonth(), input.closingDay),
          openingDate = new Date(previousClosing);
        openingDate.setDate(openingDate.getDate() + 1);
        const dueOffset = Math.trunc(Number(input.dueDay)) > Math.trunc(Number(input.closingDay)) ? 0 : 1,
          dueBase = new Date(target.getFullYear(), target.getMonth() + dueOffset, 1, 12);
        return {
          referenceKey: invoiceReferenceKey(target.getFullYear(), target.getMonth()),
          referenceYear: target.getFullYear(),
          referenceMonth: target.getMonth() + 1,
          openingDate: openingDate.toISOString(),
          closingDate: closingDate.toISOString(),
          dueDate: dayInMonth(dueBase.getFullYear(), dueBase.getMonth(), input.dueDay).toISOString(),
        };
      })();
      return {
        id: `${groupId}_${String(index + 1).padStart(2, "0")}`,
        installmentGroupId: groupId,
        installmentNumber: index + 1,
        installmentCount: count,
        amountCents: installmentAmountCents,
        invoice,
      };
    });
  };
  const invoiceTotals = (invoice = {}) => {
    const purchasesTotalCents = Math.max(0, cents(invoice.purchasesTotalCents || 0)),
      adjustmentsTotalCents = cents(invoice.adjustmentsTotalCents || 0),
      paidTotalCents = Math.max(0, cents(invoice.paidTotalCents || 0)),
      amountDueCents = Math.max(0, purchasesTotalCents + adjustmentsTotalCents),
      remainingCents = Math.max(0, amountDueCents - paidTotalCents),
      creditBalanceCents = Math.max(0, paidTotalCents - amountDueCents);
    return { purchasesTotalCents, adjustmentsTotalCents, paidTotalCents, amountDueCents, remainingCents, creditBalanceCents };
  };
  const deriveCreditCardInvoiceStatus = (invoice = {}, at = new Date()) => {
    if (invoice.status === "cancelled") return "cancelled";
    const totals = invoiceTotals(invoice);
    if (totals.remainingCents === 0 && (totals.amountDueCents > 0 || totals.paidTotalCents > 0)) return "paid";
    const today = localDay(at), due = localDay(invoice.dueDate), closing = localDay(invoice.closingDate);
    if (today > due) return "overdue";
    if (today > closing) return "closed";
    return "open";
  };
  const creditCardCommitment = (invoices = []) => invoices
    .filter((invoice) => deriveCreditCardInvoiceStatus(invoice) !== "cancelled")
    .reduce((sum, invoice) => sum + invoiceTotals(invoice).remainingCents, 0);
  const creditCardAvailableLimit = (limitCents, invoices = []) =>
    Math.max(0, cents(limitCents || 0) - creditCardCommitment(invoices));
  const creditCardBillFeeCategory = (spaceType = "business") => {
    const type = templateType(spaceType);
    return {
      categoryId: `default_${type}_finance`,
      categoryName: "Financeiro",
      categoryIcon: "wallet-cards",
      subcategoryId: `default_${type}_finance_fees`,
      subcategoryName: "Taxas financeiras",
    };
  };
  const buildCreditCardBillPaymentPlan = ({ entry = {}, card = {}, purchaseDate = new Date(), feeCents = 0 } = {}) => {
    if (!entry.id || entry.direction !== "out" || !["pending", "overdue"].includes(effectiveStatus(entry)))
      throw new Error("Escolha uma conta pendente para pagar.");
    if (!card.id || !card.cardHomeSpaceId)
      throw new Error("Escolha o cartão de crédito usado no pagamento.");
    const billAmountCents = cents(entry.amountCents), explicitFeeCents = cents(feeCents || 0);
    if (billAmountCents <= 0 || explicitFeeCents < 0) throw new Error("Revise o valor da conta e da taxa.");
    const invoice = resolveCreditCardInvoiceForPurchase({
      purchaseDate,
      closingDay: card.closingDay,
      dueDay: card.dueDay,
    });
    return {
      billEntryId: entry.id,
      billAmountCents,
      feeCents: explicitFeeCents,
      totalCardAmountCents: billAmountCents + explicitFeeCents,
      creditCardId: card.id,
      cardHomeSpaceId: card.cardHomeSpaceId,
      creditCardInvoiceId: `${card.id}_${invoice.referenceKey}`,
      purchaseDate: localDate(purchaseDate).toISOString(),
      invoice,
      feeCategory: creditCardBillFeeCategory(entry.spaceType || "business"),
      cashFlowEffectCents: 0,
    };
  };
  const CREDIT_CARD_ACCESS_MODES = Object.freeze(["all_spaces", "selected_spaces", "single_space"]);
  const normalizeCreditCardAccess = (card = {}, homeSpaceId = "") => {
    const cardHomeSpaceId = String(card.cardHomeSpaceId || card.financialSpaceId || homeSpaceId || "").trim(),
      requestedMode = String(card.accessMode || ""),
      accessMode = CREDIT_CARD_ACCESS_MODES.includes(requestedMode) ? requestedMode : "single_space",
      defaultFinancialSpaceId = String(card.defaultFinancialSpaceId || cardHomeSpaceId || "").trim() || null,
      requestedIds = Array.isArray(card.allowedFinancialSpaceIds) ? card.allowedFinancialSpaceIds : [],
      allowedFinancialSpaceIds = [...new Set(requestedIds.map(String).map((id) => id.trim()).filter(Boolean))];
    if (accessMode === "single_space" && defaultFinancialSpaceId && !allowedFinancialSpaceIds.includes(defaultFinancialSpaceId))
      allowedFinancialSpaceIds.push(defaultFinancialSpaceId);
    return {
      ...card,
      cardHomeSpaceId,
      accessMode,
      allowedFinancialSpaceIds: accessMode === "all_spaces" ? [] : allowedFinancialSpaceIds,
      defaultFinancialSpaceId,
    };
  };
  const creditCardAllowsSpace = (card = {}, financialSpaceId = "") => {
    const normalized = normalizeCreditCardAccess(card), targetId = String(financialSpaceId || "").trim();
    if (!targetId || normalized.active === false) return false;
    if (normalized.accessMode === "all_spaces") return true;
    if (normalized.accessMode === "selected_spaces") return normalized.allowedFinancialSpaceIds.includes(targetId);
    return normalized.defaultFinancialSpaceId === targetId;
  };
  const adjustDimensionTotal = (values = {}, key = "", deltaCents = 0) => {
    const next = { ...(values && typeof values === "object" && !Array.isArray(values) ? values : {}) },
      id = String(key || "").trim(), delta = cents(deltaCents || 0);
    if (!id || !delta) return next;
    const total = Math.max(0, cents(next[id] || 0) + delta);
    if (total) next[id] = total;
    else delete next[id];
    return next;
  };
  const breakdownBy = (items = [], keyName = "financialSpaceId") => {
    const totals = new Map();
    for (const item of items) {
      if (item?.status === "cancelled") continue;
      const key = String(item?.[keyName] || "").trim();
      if (!key) continue;
      totals.set(key, (totals.get(key) || 0) + cents(item.amountCents || 0));
    }
    const grandTotalCents = [...totals.values()].reduce((sum, value) => sum + value, 0);
    return [...totals.entries()].map(([id, amountCents]) => ({
      id,
      amountCents,
      percentage: grandTotalCents ? Math.round((amountCents / grandTotalCents) * 100) : 0,
    })).sort((left, right) => right.amountCents - left.amountCents || left.id.localeCompare(right.id));
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
  const FINANCIAL_ACCOUNT_TYPES = Object.freeze([
    "bank_account",
    "digital_wallet",
    "cash_wallet",
    "investment_account",
    "other_account",
  ]);
  const normalizeFinancialAccountType = (value = "") => ({
    checking: "bank_account",
    savings: "bank_account",
    wallet: "digital_wallet",
    cash: "cash_wallet",
    other: "other_account",
  })[String(value)] || (FINANCIAL_ACCOUNT_TYPES.includes(String(value)) ? String(value) : "bank_account");
  const FINANCIAL_ACCOUNT_ACCESS_MODES = Object.freeze(["all_spaces", "selected_spaces", "single_space"]);
  const normalizeInstitutionKey = (value = "") => {
    const normalized = String(value || "")
      .normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase("pt-BR")
      .replace(/\b(banco|bank|instituicao|financeira|s\.?a\.?)\b/g, " ")
      .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "_");
    return ({ inter: "banco_inter", interbank: "banco_inter", c6: "c6_bank", c6bank: "c6_bank" })[normalized.replace(/_/g, "")]
      || normalized || "sem_instituicao";
  };
  const normalizeFinancialAccountAccess = (account = {}, homeSpaceId = "") => {
    const accountHomeSpaceId = String(account.accountHomeSpaceId || account.financialSpaceId || homeSpaceId || "").trim(),
      requestedMode = String(account.accessMode || ""),
      accessMode = FINANCIAL_ACCOUNT_ACCESS_MODES.includes(requestedMode) ? requestedMode : "single_space",
      defaultFinancialSpaceId = String(account.defaultFinancialSpaceId || accountHomeSpaceId || "").trim() || null,
      requestedIds = Array.isArray(account.allowedFinancialSpaceIds) ? account.allowedFinancialSpaceIds : [],
      allowedFinancialSpaceIds = [...new Set(requestedIds.map(String).map((id) => id.trim()).filter(Boolean))];
    if (accessMode === "single_space" && defaultFinancialSpaceId && !allowedFinancialSpaceIds.includes(defaultFinancialSpaceId))
      allowedFinancialSpaceIds.push(defaultFinancialSpaceId);
    return {
      ...account,
      accountHomeSpaceId,
      accessMode,
      allowedFinancialSpaceIds: accessMode === "all_spaces" ? [] : allowedFinancialSpaceIds,
      defaultFinancialSpaceId,
      institutionKey: String(account.institutionKey || normalizeInstitutionKey(account.institution || account.name)),
    };
  };
  const financialAccountAllowsSpace = (account = {}, financialSpaceId = "") => {
    const normalized = normalizeFinancialAccountAccess(account), targetId = String(financialSpaceId || "").trim();
    if (!targetId || normalized.active === false) return false;
    if (normalized.accessMode === "all_spaces") return true;
    if (normalized.accessMode === "selected_spaces") return normalized.allowedFinancialSpaceIds.includes(targetId);
    return normalized.defaultFinancialSpaceId === targetId || normalized.accountHomeSpaceId === targetId;
  };
  const financialAccountKey = (account = {}) => {
    const normalized = normalizeFinancialAccountAccess(account);
    return `${normalized.accountHomeSpaceId || "legacy"}:${String(normalized.id || "")}`;
  };
  const financialAccountBalance = (account = {}) => Number.isInteger(account.currentBalanceCents)
    ? account.currentBalanceCents
    : cents(account.initialBalanceCents || 0);
  const financialAccountIsLiquid = (account = {}) => account.includeInAvailableBalance === true
    || (account.includeInAvailableBalance !== false && normalizeFinancialAccountType(account.type) !== "investment_account");
  const availableBalance = (accounts = []) => {
    const unique = new Map();
    for (const account of accounts || []) {
      if (account?.active === false || !financialAccountIsLiquid(account)) continue;
      const key = financialAccountKey(account);
      if (!unique.has(key)) unique.set(key, account);
    }
    return [...unique.values()].reduce((sum, account) => sum + financialAccountBalance(account), 0);
  };

  return {
    SPACE_TYPES,
    DIRECTIONS,
    ENTRY_STATUSES,
    PAYMENT_METHODS,
    moneyInputToCents,
    balanceInputToCents,
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
    isExpenseRecognized,
    summarize,
    sortPayables,
    installmentAmounts,
    dayInMonth,
    creditCardInvoiceCycle,
    resolveCreditCardInvoiceForPurchase,
    buildCreditCardInstallments,
    invoiceTotals,
    deriveCreditCardInvoiceStatus,
    creditCardCommitment,
    creditCardAvailableLimit,
    creditCardBillFeeCategory,
    buildCreditCardBillPaymentPlan,
    CREDIT_CARD_ACCESS_MODES,
    normalizeCreditCardAccess,
    creditCardAllowsSpace,
    adjustDimensionTotal,
    breakdownBy,
    buildInstallments,
    buildRecurringInstances,
    occurrenceKey,
    shouldGenerateOccurrence,
    rescheduleRecurringInstances,
    consolidate,
    FINANCIAL_ACCOUNT_TYPES,
    FINANCIAL_ACCOUNT_ACCESS_MODES,
    normalizeFinancialAccountType,
    normalizeInstitutionKey,
    normalizeFinancialAccountAccess,
    financialAccountAllowsSpace,
    financialAccountKey,
    financialAccountBalance,
    financialAccountIsLiquid,
    availableBalance,
  };
})();
