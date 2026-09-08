import { auth, db, app } from "./firebase-config.js";
import {
  arrayUnion,
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-storage.js";
import { sanitizeForFirestore, normalizeFirestoreData } from "./firestore-utils.js";

const Engine = window.FinancialEngine;
if (!Engine) throw new Error("FinancialEngine precisa ser carregado antes do serviço.");

const storage = getStorage(app),
  SPACE_CACHE_PREFIX = "adiFesta:financial-spaces:v1:",
  LAST_SPACE_PREFIX = "adiFesta:lastFinancialSpaceId:v1:",
  CONSOLIDATED_PREFIX = "adiFesta:financial-consolidated:v1:",
  MAX_MONTH_ENTRIES = 500,
  MAX_RECURRENCE_OCCURRENCES = 120,
  MAX_FINANCIAL_ACCOUNTS = 50,
  MAX_CREDIT_CARDS = 50,
  MAX_CREDIT_INVOICES = 72,
  state = {
    spaces: [],
    loadedForUid: "",
    selectedId: "",
    loading: false,
    spacesLoadedAt: 0,
    lastReadStats: null,
    reconciliation: new Map(),
  };

const now = () => new Date().toISOString();
const uid = () => {
  if (!auth.currentUser?.uid) throw Object.assign(new Error("Usuário não autenticado."), { code: "unauthenticated" });
  return auth.currentUser.uid;
};
const businessId = () => String(
  window.BusinessContext?.get?.().businessId || window.FirebaseSession?.businessId || "",
).trim();
const clean = (value) => sanitizeForFirestore(value);
const convert = (snapshot) => snapshot.exists()
  ? normalizeFirestoreData({ id: snapshot.id, ...snapshot.data() })
  : null;
const cacheKey = () => `${SPACE_CACHE_PREFIX}${uid()}`;
const lastSpaceKey = () => `${LAST_SPACE_PREFIX}${uid()}`;
const consolidatedKey = () => `${CONSOLIDATED_PREFIX}${uid()}`;
const emit = (name, detail = {}) => dispatchEvent(new CustomEvent(name, { detail }));
const operationId = (prefix = "financial") => `${prefix}_${crypto.randomUUID()}`;
const automationState = (space = {}) => {
  const legacyActivation = space.autoIncomeSince || space.autoEntryFromPaymentsSince || space.autoEntryFromSalesSince || null,
    automation = space.automation || {}, autoIncome = automation.autoIncome || {};
  return {
    enabled: automation.enabled === true || (automation.enabled === undefined && Boolean(legacyActivation)),
    linkedBusinessId: space.type === "business" ? space.linkedBusinessId || null : null,
    activatedAt: automation.activatedAt || legacyActivation,
    autoIncome: {
      sales: autoIncome.sales !== false,
      customerPayments: autoIncome.customerPayments !== false,
      onlineOrders: autoIncome.onlineOrders !== false,
    },
  };
};
const spaceRef = (spaceId) => doc(db, "financialSpaces", String(spaceId));
const childRef = (spaceId, collectionName, id) => doc(
  db,
  "financialSpaces",
  String(spaceId),
  String(collectionName),
  String(id),
);
const childCollection = (spaceId, collectionName) => collection(
  db,
  "financialSpaces",
  String(spaceId),
  String(collectionName),
);
const rememberSpaces = (spaces) => {
  state.spaces = spaces.map((item) => structuredClone(item));
  state.loadedForUid = auth.currentUser?.uid || "";
  try { localStorage.setItem(cacheKey(), JSON.stringify(state.spaces)); } catch {}
  return listCachedSpaces();
};
const listCachedSpaces = () => state.spaces.map((item) => structuredClone(item));
const loadCachedSpaces = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(cacheKey()) || "[]");
    if (Array.isArray(parsed)) state.spaces = parsed;
  } catch {}
  return listCachedSpaces();
};
const assertSpace = (spaceId) => {
  const space = state.spaces.find((item) => item.id === String(spaceId));
  if (!space) throw new Error("Espaço financeiro indisponível para esta conta.");
  return space;
};
const baseMetadata = (space, opId) => ({
  financialSpaceId: space.id,
  spaceType: space.type,
  linkedBusinessId: space.linkedBusinessId || null,
  ownerUid: space.ownerUid,
  createdBy: uid(),
  operationId: opId,
  idempotencyKey: opId,
  schemaVersion: 1,
});
const integerCents = (value, label = "valor") => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) throw new Error(`Informe um ${label} válido em centavos.`);
  return parsed;
};
const requiredText = (value, label, max = 80) => {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Informe ${label}.`);
  return text.slice(0, max);
};

async function listSpaces(options = {}) {
  const currentUid = uid(), currentBusinessId = businessId();
  if (state.loadedForUid !== currentUid) loadCachedSpaces();
  if (!options.force && state.loadedForUid === currentUid && state.spaces.length && Date.now() - state.spacesLoadedAt < 60_000)
    return listCachedSpaces();
  if (options.cacheOnly || !navigator.onLine) return listCachedSpaces();
  state.loading = true;
  try {
    const spacesCollection = collection(db, "financialSpaces"), queries = [
      getDocs(query(
        spacesCollection,
        where("ownerUid", "==", currentUid),
        where("type", "==", "personal"),
        where("active", "==", true),
        limit(100),
      )),
      getDocs(query(
        spacesCollection,
        where("ownerUid", "==", currentUid),
        where("type", "==", "other"),
        where("active", "==", true),
        limit(100),
      )),
    ];
    if (currentBusinessId)
      queries.push(getDocs(query(
        spacesCollection,
        where("linkedBusinessId", "==", currentBusinessId),
        where("type", "==", "business"),
        where("active", "==", true),
        limit(20),
      )));
    const snapshots = await Promise.all(queries), map = new Map();
    for (const snapshot of snapshots)
      for (const item of snapshot.docs) {
        const value = convert(item);
        if (value && value.active !== false) map.set(value.id, value);
      }
    const spaces = [...map.values()].sort((left, right) =>
      Number(right.type === "business") - Number(left.type === "business") || left.name.localeCompare(right.name, "pt-BR"),
    );
    state.lastReadStats = { operation: "listSpaces", documents: snapshots.reduce((sum, item) => sum + item.size, 0), at: now() };
    state.spacesLoadedAt = Date.now();
    return rememberSpaces(spaces);
  } catch (error) {
    if (state.spaces.length) return listCachedSpaces();
    const context = {
      operation: "list",
      path: "financialSpaces",
      uidPresent: Boolean(auth.currentUser?.uid),
      businessId: currentBusinessId || null,
      query: "active space by owner/type or linkedBusinessId/type",
      code: error?.code || "unknown",
    };
    console.error("[FINANCIAL_PERMISSION_ERROR]", context);
    try { error.financialContext = context; } catch {}
    throw error;
  } finally {
    state.loading = false;
  }
}

function selectedSpaceId() {
  const available = new Set(state.spaces.map((item) => item.id)),
    remembered = state.selectedId || localStorage.getItem(lastSpaceKey()) || "";
  if (available.has(remembered)) return remembered;
  return state.spaces[0]?.id || "";
}

function selectSpace(spaceId) {
  const space = assertSpace(spaceId);
  state.selectedId = space.id;
  localStorage.setItem(lastSpaceKey(), space.id);
  emit("financial-space-changed", { space });
  return structuredClone(space);
}

async function createSpace(input = {}) {
  const normalized = Engine.normalizeSpace(input), currentUid = uid(), currentBusinessId = businessId();
  if (normalized.type === "business" && normalized.linkedBusinessId !== currentBusinessId)
    throw new Error("A empresa vinculada não corresponde ao contexto atual.");
  const id = normalized.type === "business"
      ? `business_${normalized.linkedBusinessId}`
      : String(input.id || crypto.randomUUID()),
    existing = state.spaces.find((item) => item.id === id || (
      normalized.type === "business" && item.linkedBusinessId === normalized.linkedBusinessId && item.active !== false
    ));
  if (existing) return selectSpace(existing.id);
  const createdAt = now(), value = {
    id,
    ...normalized,
    ownerUid: currentUid,
    createdBy: currentUid,
    automation: {
      enabled: normalized.type === "business",
      linkedBusinessId: normalized.type === "business" ? normalized.linkedBusinessId : null,
      activatedAt: normalized.type === "business" ? createdAt : null,
      autoIncome: {
        sales: normalized.type === "business",
        customerPayments: normalized.type === "business",
        onlineOrders: normalized.type === "business",
      },
    },
    autoIncomeSince: normalized.type === "business" ? createdAt : null,
    autoEntryFromPaymentsSince: normalized.type === "business" ? createdAt : null,
    autoEntryFromSalesSince: normalized.type === "business" ? createdAt : null,
    currency: "BRL",
    createdAt,
    updatedAt: createdAt,
    schemaVersion: 1,
  };
  await setDoc(spaceRef(id), { ...clean(value), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  rememberSpaces([...state.spaces.filter((item) => item.id !== id), value]);
  selectSpace(id);
  emit("financial-data-changed", { entity: "space", id });
  return structuredClone(value);
}

async function updateAutomation(spaceId, input = {}) {
  const space = assertSpace(spaceId);
  if (space.type !== "business" || !space.linkedBusinessId)
    throw new Error("Somente um espaço vinculado à empresa pode usar automação.");
  const current = automationState(space), enabled = input.enabled !== false,
    activatedAt = current.activatedAt || (enabled ? now() : null), automation = {
      enabled,
      linkedBusinessId: space.linkedBusinessId,
      activatedAt,
      autoIncome: {
        sales: input.sales ?? current.autoIncome.sales,
        customerPayments: input.customerPayments ?? current.autoIncome.customerPayments,
        onlineOrders: input.onlineOrders ?? current.autoIncome.onlineOrders,
      },
    };
  await updateDoc(spaceRef(space.id), { automation: clean(automation), autoIncomeSince: activatedAt, updatedAt: serverTimestamp() });
  rememberSpaces(state.spaces.map((item) => item.id === space.id ? { ...item, automation, autoIncomeSince: activatedAt, updatedAt: now() } : item));
  state.reconciliation.delete(space.id);
  emit("financial-data-changed", { entity: "space", id: space.id, action: "automation-updated" });
  return structuredClone(automation);
}

async function reconcileBusinessIncome(spaceId, options = {}) {
  const space = assertSpace(spaceId), automation = automationState(space);
  if (space.type !== "business" || !space.linkedBusinessId || !automation.enabled)
    return { skipped: "automation-disabled" };
  const previous = state.reconciliation.get(space.id);
  if (!options.force && previous && Date.now() - previous.at < 120_000) return previous.result;
  if (!navigator.onLine || typeof window.FirebaseCallable !== "function") return { skipped: "offline" };
  const promise = window.FirebaseCallable("reconcileBusinessFinancialIncome", {
    businessId: space.linkedBusinessId,
    limit: 100,
  }).then((response) => response.data || {}).catch((error) => {
    console.warn("[FINANCIAL_INCOME_RECONCILIATION_PENDING]", { spaceId: space.id, code: error?.code || "unknown" });
    return { skipped: "temporarily-unavailable" };
  });
  state.reconciliation.set(space.id, { at: Date.now(), result: promise });
  const result = await promise;
  state.reconciliation.set(space.id, { at: Date.now(), result });
  return result;
}

async function archiveSpace(spaceId) {
  const space = assertSpace(spaceId);
  await updateDoc(spaceRef(space.id), { active: false, archivedAt: serverTimestamp(), updatedAt: serverTimestamp() });
  rememberSpaces(state.spaces.filter((item) => item.id !== space.id));
  state.selectedId = selectedSpaceId();
  emit("financial-data-changed", { entity: "space", id: space.id, action: "archived" });
}

async function listCustomCategories(spaceId) {
  assertSpace(spaceId);
  const snapshot = await getDocs(query(childCollection(spaceId, "categories"), where("active", "==", true), limit(100)));
  state.lastReadStats = { operation: "listCategories", documents: snapshot.size, at: now() };
  return snapshot.docs.map(convert);
}

async function listCategories(spaceId) {
  const space = assertSpace(spaceId), custom = await listCustomCategories(spaceId).catch(() => []), map = new Map();
  for (const item of [...Engine.defaultCategoryTree(space.type), ...custom]) map.set(item.id, {
    ...item,
    type: item.type === "subcategory" || item.parentCategoryId ? "subcategory" : "category",
    parentCategoryId: item.parentCategoryId || null,
    financialSpaceId: item.financialSpaceId || null,
    isDefault: item.isDefault === true || item.system === true,
  });
  return [...map.values()].sort((left, right) => {
    if (left.type !== right.type) return left.type === "category" ? -1 : 1;
    if (left.parentCategoryId !== right.parentCategoryId)
      return String(left.parentCategoryId || "").localeCompare(String(right.parentCategoryId || ""), "pt-BR");
    return Number(left.sortOrder ?? 1000) - Number(right.sortOrder ?? 1000)
      || String(left.name).localeCompare(String(right.name), "pt-BR");
  });
}

async function createCategory(spaceId, input = {}) {
  const space = assertSpace(spaceId), name = String(input.name || "").trim(), parentCategoryId = String(input.parentCategoryId || "").trim() || null,
    categories = await listCategories(spaceId), parent = parentCategoryId ? categories.find((item) => item.id === parentCategoryId && item.type === "category") : null;
  if (!name) throw new Error("Informe o nome da categoria.");
  if (parentCategoryId && !parent) throw new Error("Escolha uma categoria principal válida.");
  if (categories.some((item) => item.parentCategoryId === parentCategoryId && String(item.name).localeCompare(name, "pt-BR", { sensitivity: "base" }) === 0))
    throw new Error(parentCategoryId ? "Esta subcategoria já existe." : "Esta categoria já existe.");
  const id = String(input.id || crypto.randomUUID()), opId = operationId("category"), value = {
    id,
    ...baseMetadata(space, opId),
    name: name.slice(0, 60),
    icon: String(input.icon || (parentCategoryId ? "tag" : "shapes")),
    type: parentCategoryId ? "subcategory" : "category",
    parentCategoryId,
    isDefault: false,
    active: true,
    sortOrder: 1000,
    createdAt: now(),
    updatedAt: now(),
  };
  await setDoc(childRef(spaceId, "categories", id), { ...clean(value), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  emit("financial-data-changed", { entity: "category", id, spaceId });
  return value;
}

async function listFinancialAccounts(spaceId) {
  assertSpace(spaceId);
  const snapshot = await getDocs(query(
    childCollection(spaceId, "financialAccounts"),
    where("active", "==", true),
    limit(MAX_FINANCIAL_ACCOUNTS),
  ));
  return snapshot.docs.map(convert).sort((left, right) =>
    String(left.name).localeCompare(String(right.name), "pt-BR"),
  );
}

async function createFinancialAccount(spaceId, input = {}) {
  const space = assertSpace(spaceId), id = String(input.id || crypto.randomUUID()),
    opId = String(input.operationId || `financial_account_${id}`), createdAt = now(),
    allowedTypes = new Set(["cash", "checking", "wallet", "savings", "other"]),
    type = allowedTypes.has(input.type) ? input.type : "checking", value = {
      id,
      ...baseMetadata(space, opId),
      name: requiredText(input.name, "o nome da conta", 80),
      type,
      institution: String(input.institution || "").trim().slice(0, 80) || null,
      initialBalanceCents: integerCents(input.initialBalanceCents || 0, "saldo inicial"),
      balanceMode: "initial_plus_movements",
      active: true,
      createdAt,
      updatedAt: createdAt,
      schemaVersion: 2,
    };
  await setDoc(childRef(space.id, "financialAccounts", id), clean(value));
  emit("financial-data-changed", { entity: "financialAccount", id, spaceId: space.id });
  return value;
}

async function listCreditCards(spaceId) {
  assertSpace(spaceId);
  const snapshot = await getDocs(query(
    childCollection(spaceId, "creditCards"),
    where("active", "==", true),
    limit(MAX_CREDIT_CARDS),
  ));
  return snapshot.docs.map(convert).sort((left, right) =>
    String(left.name).localeCompare(String(right.name), "pt-BR"),
  );
}

async function createCreditCard(spaceId, input = {}) {
  const space = assertSpace(spaceId), id = String(input.id || crypto.randomUUID()),
    opId = String(input.operationId || `credit_card_${id}`), createdAt = now(),
    closingDay = Math.trunc(Number(input.closingDay)), dueDay = Math.trunc(Number(input.dueDay)),
    last4 = String(input.last4 || "").replace(/\D/g, "").slice(-4);
  if (closingDay < 1 || closingDay > 31) throw new Error("O fechamento deve ficar entre os dias 1 e 31.");
  if (dueDay < 1 || dueDay > 31) throw new Error("O vencimento deve ficar entre os dias 1 e 31.");
  if (last4.length !== 4) throw new Error("Informe os 4 últimos dígitos do cartão.");
  const value = {
    id,
    ...baseMetadata(space, opId),
    name: requiredText(input.name, "o nome do cartão", 80),
    issuer: String(input.issuer || input.institution || "").trim().slice(0, 80) || null,
    institution: String(input.institution || input.issuer || "").trim().slice(0, 80) || null,
    last4,
    limitCents: integerCents(input.limitCents || 0, "limite"),
    closingDay,
    dueDay,
    paymentAccountId: input.paymentAccountId ? String(input.paymentAccountId) : null,
    committedCents: 0,
    active: true,
    createdAt,
    updatedAt: createdAt,
    schemaVersion: 2,
  };
  await setDoc(childRef(space.id, "creditCards", id), clean(value));
  emit("financial-data-changed", { entity: "creditCard", id, spaceId: space.id });
  return value;
}

async function listCreditCardInvoices(spaceId, options = {}) {
  assertSpace(spaceId);
  const source = childCollection(spaceId, "creditCardInvoices"), clauses = [];
  if (options.period) {
    const { start, endExclusive } = Engine.monthRange(options.period);
    clauses.push(where("dueDate", ">=", start.toISOString()), where("dueDate", "<", endExclusive.toISOString()), orderBy("dueDate", "asc"));
  } else {
    clauses.push(orderBy("dueDate", "desc"));
  }
  clauses.push(limit(Math.min(MAX_CREDIT_INVOICES, Math.max(1, Number(options.limit || MAX_CREDIT_INVOICES)))));
  const snapshot = await getDocs(query(source, ...clauses));
  return snapshot.docs.map(convert)
    .filter((invoice) => !options.creditCardId || invoice.creditCardId === options.creditCardId)
    .map((invoice) => ({ ...invoice, status: Engine.deriveCreditCardInvoiceStatus(invoice, options.now || new Date()) }));
}

async function listUpcomingCreditCardInvoices(spaceId, selectedPeriod = Engine.periodKey()) {
  assertSpace(spaceId);
  const { start } = Engine.monthRange(selectedPeriod), endExclusive = Engine.addMonths(start, 13), snapshot = await getDocs(query(
    childCollection(spaceId, "creditCardInvoices"),
    where("dueDate", ">=", start.toISOString()),
    where("dueDate", "<", endExclusive.toISOString()),
    orderBy("dueDate", "asc"),
    limit(MAX_CREDIT_INVOICES),
  ));
  return snapshot.docs.map(convert).map((invoice) => ({
    ...invoice,
    status: Engine.deriveCreditCardInvoiceStatus(invoice),
  }));
}

async function getCreditCardInvoiceDetails(spaceId, invoiceId) {
  assertSpace(spaceId);
  const [invoiceSnapshot, purchasesSnapshot, paymentsSnapshot, adjustmentsSnapshot] = await Promise.all([
    getDoc(childRef(spaceId, "creditCardInvoices", invoiceId)),
    getDocs(query(childCollection(spaceId, "creditCardPurchases"), where("creditCardInvoiceId", "==", invoiceId), limit(300))),
    getDocs(query(childCollection(spaceId, "creditCardInvoicePayments"), where("creditCardInvoiceId", "==", invoiceId), limit(100))),
    getDocs(query(childCollection(spaceId, "creditCardAdjustments"), where("creditCardInvoiceId", "==", invoiceId), limit(100))),
  ]), invoice = convert(invoiceSnapshot);
  if (!invoice) throw new Error("Fatura não encontrada.");
  const byDateDesc = (left, right) => (Engine.localDate(right.purchaseDate || right.paidAt || right.createdAt)?.getTime() || 0)
    - (Engine.localDate(left.purchaseDate || left.paidAt || left.createdAt)?.getTime() || 0);
  return {
    invoice: { ...invoice, status: Engine.deriveCreditCardInvoiceStatus(invoice) },
    purchases: purchasesSnapshot.docs.map(convert).sort(byDateDesc),
    payments: paymentsSnapshot.docs.map(convert).sort(byDateDesc),
    adjustments: adjustmentsSnapshot.docs.map(convert).sort(byDateDesc),
  };
}

async function createEntries(space, rawEntries, eventKind = "entry_created") {
  const entries = rawEntries.map((raw) => Engine.normalizeEntry(raw)), refs = entries.map((entry) => ({
    entry,
    entryRef: childRef(space.id, "entries", entry.id),
    eventRef: childRef(space.id, "events", entry.operationId),
  }));
  const result = await runTransaction(db, async (transaction) => {
    const snapshots = [];
    for (const item of refs) snapshots.push(await transaction.get(item.entryRef));
    return refs.map((item, index) => {
      if (snapshots[index].exists()) return convert(snapshots[index]);
      const createdAt = item.entry.createdAt || now(), value = {
        ...baseMetadata(space, item.entry.operationId),
        ...item.entry,
        id: item.entry.id,
        createdAt,
        updatedAt: createdAt,
      };
      transaction.set(item.entryRef, clean(value));
      transaction.set(item.eventRef, clean({
        ...baseMetadata(space, item.entry.operationId),
        id: item.entry.operationId,
        entryId: item.entry.id,
        eventKind,
        transition: "created",
        status: "applied",
        amountCents: item.entry.amountCents,
        createdAt,
      }));
      return value;
    });
  });
  emit("financial-data-changed", { entity: "entries", count: result.length, spaceId: space.id });
  return result;
}

async function createEntry(spaceId, input = {}) {
  const space = assertSpace(spaceId), opId = String(input.operationId || operationId("entry")),
    id = String(input.id || opId), paid = input.paidNow === true || input.status === "paid",
    at = input.paidAt || input.occurredAt || input.dueAt || now(), category = input.category || {},
    base = {
      ...input,
      id,
      operationId: opId,
      direction: input.direction === "in" ? "in" : "out",
      entryType: input.entryType || (input.direction === "in" ? "manual_income" : "expense"),
      amountCents: Number(input.amountCents),
      categoryId: input.categoryId || category.id || "default_other",
      categoryName: input.categoryName || category.name || "Outros",
      categoryIcon: input.categoryIcon || category.icon || "shapes",
      subcategoryId: input.subcategoryId || null,
      subcategoryName: input.subcategoryName || null,
      categorySchemaVersion: 2,
      status: paid ? "paid" : "pending",
      dueAt: input.dueAt || at,
      occurredAt: paid ? at : null,
      paidAt: paid ? at : null,
      paymentMethod: paid ? input.paymentMethod || "other" : null,
      sourceType: input.sourceType || (input.direction === "in" ? "manual_income" : input.entryType === "investment" ? "investment" : "expense"),
      sourceId: input.sourceId || id,
      notes: String(input.notes || "").slice(0, 500),
      attachments: [],
      createdAt: now(),
    };
  let entries;
  if (Number(input.installmentCount || 1) > 1) entries = Engine.buildInstallments({ ...base, installmentCount: input.installmentCount });
  else if (input.frequency && input.frequency !== "none") entries = Engine.buildRecurringInstances({ ...base, frequency: input.frequency }, 2);
  else entries = [Engine.normalizeEntry(base)];
  const created = await createEntries(space, entries);
  if (input.frequency && input.frequency !== "none") {
    const recurrenceId = created[0].recurrenceId, recurrence = {
      id: recurrenceId,
      ...baseMetadata(space, recurrenceId),
      frequency: input.frequency,
      description: base.description,
      amountCents: base.amountCents,
      categoryId: base.categoryId,
      categoryName: base.categoryName,
      categoryIcon: base.categoryIcon,
      subcategoryId: base.subcategoryId,
      subcategoryName: base.subcategoryName,
      categorySchemaVersion: 2,
      direction: base.direction,
      entryType: base.entryType,
      nextDueAt: created[1]?.dueAt || Engine.addFrequency(base.dueAt, input.frequency).toISOString(),
      active: true,
      seriesStartAt: base.dueAt,
      seriesEndAt: null,
      skippedOccurrenceKeys: [],
      overrideOccurrenceKeys: [],
      version: 1,
      generatedThrough: created.at(-1)?.dueAt,
      createdAt: now(),
      updatedAt: now(),
    };
    await setDoc(childRef(space.id, "recurrences", recurrenceId), { ...clean(recurrence), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  }
  return created;
}

async function createCreditCardPurchase(spaceId, input = {}) {
  const space = assertSpace(spaceId), creditCardId = requiredText(input.creditCardId, "o cartão", 120),
    cardRef = childRef(space.id, "creditCards", creditCardId), cardSnapshot = await getDoc(cardRef), card = convert(cardSnapshot);
  if (!card || card.active === false) throw new Error("O cartão escolhido não está disponível neste espaço.");
  const opId = String(input.operationId || operationId("credit_purchase")), purchaseDate = input.purchaseDate || now(),
    installments = Engine.buildCreditCardInstallments({
      amountCents: Number(input.amountCents),
      installmentCount: Number(input.installmentCount || 1),
      operationId: opId,
      purchaseDate,
      closingDay: card.closingDay,
      dueDay: card.dueDay,
    }), invoiceIds = [...new Set(installments.map((item) => `${creditCardId}_${item.invoice.referenceKey}`))],
    invoiceRefs = new Map(invoiceIds.map((id) => [id, childRef(space.id, "creditCardInvoices", id)])),
    purchaseRefs = installments.map((item) => childRef(space.id, "creditCardPurchases", item.id)),
    entryRef = childRef(space.id, "entries", opId), eventRef = childRef(space.id, "events", opId),
    createdAt = now(), category = input.category || {}, description = requiredText(input.description, "a descrição", 160),
    amountCents = Number(input.amountCents);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Informe um valor maior que zero.");
  const entry = Engine.normalizeEntry({
    id: opId,
    operationId: opId,
    direction: "out",
    entryType: input.entryType === "investment" ? "investment" : "expense",
    description,
    amountCents,
    categoryId: input.categoryId || category.id || "default_other",
    categoryName: input.categoryName || category.name || "Outros",
    categoryIcon: input.categoryIcon || category.icon || "shapes",
    subcategoryId: input.subcategoryId || null,
    subcategoryName: input.subcategoryName || null,
    categorySchemaVersion: 2,
    status: "paid",
    occurredAt: purchaseDate,
    paidAt: null,
    dueAt: installments[0].invoice.dueDate,
    paymentMethod: "credit_card",
    paymentType: "credit_card",
    cashFlowEffect: false,
    expenseRecognized: true,
    creditCardId,
    creditCardInvoiceId: invoiceIds[0],
    creditCardInvoiceIds: invoiceIds,
    purchaseDate,
    installmentGroupId: opId,
    installmentCount: installments.length,
    sourceType: "credit_card_purchase",
    sourceId: opId,
    merchant: String(input.merchant || description).slice(0, 120),
    notes: String(input.notes || "").slice(0, 500),
    attachments: [],
    createdAt,
    schemaVersion: 2,
  });
  const result = await runTransaction(db, async (transaction) => {
    const currentCardSnapshot = await transaction.get(cardRef), currentEntrySnapshot = await transaction.get(entryRef),
      invoiceSnapshots = new Map(), purchaseSnapshots = [];
    for (const [invoiceId, refValue] of invoiceRefs) invoiceSnapshots.set(invoiceId, await transaction.get(refValue));
    for (const refValue of purchaseRefs) purchaseSnapshots.push(await transaction.get(refValue));
    if (!currentCardSnapshot.exists()) throw new Error("Cartão não encontrado.");
    if (currentEntrySnapshot.exists()) return {
      entry: convert(currentEntrySnapshot),
      installments: purchaseSnapshots.filter((snapshot) => snapshot.exists()).map(convert),
      retried: true,
    };
    const cardInTransaction = convert(currentCardSnapshot);
    if (cardInTransaction.active === false || cardInTransaction.financialSpaceId !== space.id)
      throw new Error("O cartão não pertence ao espaço selecionado.");
    const invoiceAmounts = new Map();
    installments.forEach((item) => {
      const invoiceId = `${creditCardId}_${item.invoice.referenceKey}`;
      invoiceAmounts.set(invoiceId, (invoiceAmounts.get(invoiceId) || 0) + item.amountCents);
    });
    for (const [invoiceId, addition] of invoiceAmounts) {
      const snapshot = invoiceSnapshots.get(invoiceId), current = snapshot.exists() ? convert(snapshot) : null,
        installment = installments.find((item) => `${creditCardId}_${item.invoice.referenceKey}` === invoiceId),
        totals = Engine.invoiceTotals({
          purchasesTotalCents: Number(current?.purchasesTotalCents || 0) + addition,
          adjustmentsTotalCents: Number(current?.adjustmentsTotalCents || 0),
          paidTotalCents: Number(current?.paidTotalCents || 0),
        }), invoiceValue = {
          ...(current || {}),
          id: invoiceId,
          ...baseMetadata(space, current?.operationId || `invoice_${invoiceId}`),
          creditCardId,
          cardName: cardInTransaction.name,
          cardLast4: cardInTransaction.last4,
          referenceKey: installment.invoice.referenceKey,
          referenceYear: installment.invoice.referenceYear,
          referenceMonth: installment.invoice.referenceMonth,
          openingDate: installment.invoice.openingDate,
          closingDate: installment.invoice.closingDate,
          dueDate: installment.invoice.dueDate,
          ...totals,
          status: Engine.deriveCreditCardInvoiceStatus({ ...(current || {}), ...totals, closingDate: installment.invoice.closingDate, dueDate: installment.invoice.dueDate }),
          createdBy: current?.createdBy || uid(),
          createdAt: current?.createdAt || createdAt,
          updatedAt: createdAt,
          schemaVersion: 2,
        };
      transaction.set(invoiceRefs.get(invoiceId), clean(invoiceValue));
    }
    installments.forEach((installment, index) => {
      const invoiceId = `${creditCardId}_${installment.invoice.referenceKey}`, purchaseValue = {
        id: installment.id,
        ...baseMetadata(space, `${opId}:${index + 1}`),
        purchaseOperationId: opId,
        creditCardId,
        creditCardInvoiceId: invoiceId,
        installmentGroupId: opId,
        installmentNumber: installment.installmentNumber,
        installmentCount: installment.installmentCount,
        amountCents: installment.amountCents,
        originalPurchaseAmountCents: amountCents,
        description: installments.length > 1 ? `${description} · ${index + 1}/${installments.length}` : description,
        merchant: String(input.merchant || description).slice(0, 120),
        categoryId: entry.categoryId,
        categoryName: entry.categoryName,
        subcategoryId: entry.subcategoryId,
        subcategoryName: entry.subcategoryName,
        purchaseDate,
        status: "posted",
        createdAt,
        updatedAt: createdAt,
        schemaVersion: 2,
      };
      transaction.set(purchaseRefs[index], clean(purchaseValue));
    });
    transaction.update(cardRef, clean({
      committedCents: Number(cardInTransaction.committedCents || 0) + amountCents,
      updatedAt: createdAt,
    }));
    const entryValue = { ...baseMetadata(space, opId), ...entry, createdAt, updatedAt: createdAt, schemaVersion: 2 };
    transaction.set(entryRef, clean(entryValue));
    transaction.set(eventRef, clean({
      id: opId,
      ...baseMetadata(space, opId),
      entryId: opId,
      creditCardId,
      creditCardInvoiceIds: invoiceIds,
      eventKind: "credit_card_purchase_created",
      transition: "created",
      status: "applied",
      amountCents,
      createdAt,
      schemaVersion: 2,
    }));
    return { entry: entryValue, installments, invoiceIds, retried: false };
  });
  emit("financial-data-changed", { entity: "creditCardPurchase", id: opId, spaceId: space.id });
  return result;
}

async function payCreditCardInvoice(spaceId, invoiceId, input = {}) {
  const space = assertSpace(spaceId), opId = String(input.operationId || operationId("invoice_payment")),
    amountCents = Number(input.amountCents), paidAt = input.paidAt || now(),
    financialAccountId = requiredText(input.financialAccountId, "a conta de origem", 120),
    method = String(input.paymentMethod || "other"), invoiceRef = childRef(space.id, "creditCardInvoices", invoiceId),
    accountRef = childRef(space.id, "financialAccounts", financialAccountId),
    paymentRef = childRef(space.id, "creditCardInvoicePayments", opId), entryId = `invoice_payment_${opId}`,
    entryRef = childRef(space.id, "entries", entryId), eventRef = childRef(space.id, "events", opId), createdAt = now();
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Informe um pagamento maior que zero.");
  if (!["cash", "pix", "debit_card", "automatic_debit", "transfer", "other"].includes(method))
    throw new Error("Escolha uma forma de pagamento válida para a fatura.");
  const result = await runTransaction(db, async (transaction) => {
    const invoiceSnapshot = await transaction.get(invoiceRef), accountSnapshot = await transaction.get(accountRef),
      paymentSnapshot = await transaction.get(paymentRef), entrySnapshot = await transaction.get(entryRef);
    if (paymentSnapshot.exists()) return { payment: convert(paymentSnapshot), retried: true };
    if (!invoiceSnapshot.exists()) throw new Error("Fatura não encontrada.");
    if (!accountSnapshot.exists() || convert(accountSnapshot).active === false) throw new Error("A conta de origem não está disponível.");
    const invoice = convert(invoiceSnapshot), cardRef = childRef(space.id, "creditCards", invoice.creditCardId),
      cardSnapshot = await transaction.get(cardRef), totalsBefore = Engine.invoiceTotals(invoice);
    if (!cardSnapshot.exists()) throw new Error("Cartão da fatura não encontrado.");
    const card = convert(cardSnapshot);
    if (amountCents > totalsBefore.remainingCents) throw new Error("O pagamento não pode ser maior que o saldo da fatura.");
    const totals = Engine.invoiceTotals({ ...invoice, paidTotalCents: totalsBefore.paidTotalCents + amountCents }),
      status = Engine.deriveCreditCardInvoiceStatus({ ...invoice, ...totals }, paidAt), payment = {
        id: opId,
        ...baseMetadata(space, opId),
        creditCardInvoiceId: invoice.id,
        creditCardId: invoice.creditCardId,
        financialAccountId,
        amountCents,
        paymentMethod: method,
        paidAt,
        status: "confirmed",
        createdAt,
        schemaVersion: 2,
      }, entry = Engine.normalizeEntry({
        id: entryId,
        operationId: opId,
        direction: "out",
        entryType: "credit_card_invoice_payment",
        description: `Pagamento de fatura · ${invoice.cardName || "Cartão"}`,
        amountCents,
        categoryId: "default_personal_debts",
        categoryName: "Financeiro",
        categoryIcon: "credit-card",
        status: "paid",
        dueAt: invoice.dueDate,
        occurredAt: paidAt,
        paidAt,
        paymentMethod: method,
        cashFlowEffect: true,
        expenseRecognized: false,
        financialAccountId,
        creditCardId: invoice.creditCardId,
        creditCardInvoiceId: invoice.id,
        sourceType: "credit_card_invoice_payment",
        sourceId: opId,
        notes: String(input.notes || "").slice(0, 500),
        createdAt,
        schemaVersion: 2,
      });
    transaction.update(invoiceRef, clean({ ...totals, status, paidAt: totals.remainingCents === 0 ? paidAt : invoice.paidAt || null, updatedAt: createdAt }));
    transaction.update(cardRef, clean({ committedCents: Math.max(0, Number(card.committedCents ?? totalsBefore.remainingCents) - amountCents), updatedAt: createdAt }));
    transaction.set(paymentRef, clean(payment));
    if (!entrySnapshot.exists()) transaction.set(entryRef, clean({ ...baseMetadata(space, opId), ...entry, createdAt, updatedAt: createdAt, schemaVersion: 2 }));
    transaction.set(eventRef, clean({ id: opId, ...baseMetadata(space, opId), entryId, creditCardInvoiceId: invoice.id, eventKind: "credit_card_invoice_paid", transition: totals.remainingCents === 0 ? "paid" : "partially_paid", status: "applied", amountCents, createdAt, schemaVersion: 2 }));
    return { payment, invoice: { ...invoice, ...totals, status }, entry, retried: false };
  });
  emit("financial-data-changed", { entity: "creditCardInvoicePayment", id: opId, spaceId: space.id });
  return result;
}

async function refundCreditCardPurchase(spaceId, purchaseId, input = {}) {
  const space = assertSpace(spaceId), opId = `credit_refund_${String(purchaseId).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    amountCents = Number(input.amountCents), refundedAt = input.refundedAt || now(), purchaseRef = childRef(space.id, "creditCardPurchases", purchaseId),
    adjustmentRef = childRef(space.id, "creditCardAdjustments", opId), entryRef = childRef(space.id, "entries", opId),
    eventRef = childRef(space.id, "events", opId), createdAt = now();
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Informe um estorno maior que zero.");
  const result = await runTransaction(db, async (transaction) => {
    const purchaseSnapshot = await transaction.get(purchaseRef), adjustmentSnapshot = await transaction.get(adjustmentRef);
    if (!purchaseSnapshot.exists()) throw new Error("Compra não encontrada.");
    if (adjustmentSnapshot.exists()) return { adjustment: convert(adjustmentSnapshot), retried: true };
    const purchase = convert(purchaseSnapshot), invoiceRef = childRef(space.id, "creditCardInvoices", purchase.creditCardInvoiceId),
      cardRef = childRef(space.id, "creditCards", purchase.creditCardId), invoiceSnapshot = await transaction.get(invoiceRef),
      entrySnapshot = await transaction.get(entryRef), cardSnapshot = await transaction.get(cardRef);
    if (!invoiceSnapshot.exists()) throw new Error("Fatura da compra não encontrada.");
    if (!cardSnapshot.exists()) throw new Error("Cartão da compra não encontrado.");
    if (amountCents > Number(purchase.amountCents || 0)) throw new Error("O estorno não pode exceder o valor da parcela.");
    const invoice = convert(invoiceSnapshot), card = convert(cardSnapshot), adjustmentsTotalCents = Number(invoice.adjustmentsTotalCents || 0) - amountCents,
      totals = Engine.invoiceTotals({ ...invoice, adjustmentsTotalCents }), adjustment = {
        id: opId,
        ...baseMetadata(space, opId),
        creditCardInvoiceId: invoice.id,
        creditCardId: purchase.creditCardId,
        creditCardPurchaseId: purchase.id,
        kind: "refund",
        amountCents,
        effectCents: -amountCents,
        reason: String(input.reason || "Estorno de compra").slice(0, 300),
        occurredAt: refundedAt,
        status: "confirmed",
        createdAt,
        schemaVersion: 2,
      }, entry = Engine.normalizeEntry({
        id: opId,
        operationId: opId,
        direction: "in",
        entryType: "credit_card_refund",
        description: `Estorno · ${purchase.description}`,
        amountCents,
        categoryId: purchase.categoryId,
        categoryName: purchase.categoryName,
        subcategoryId: purchase.subcategoryId || null,
        subcategoryName: purchase.subcategoryName || null,
        status: "paid",
        dueAt: refundedAt,
        occurredAt: refundedAt,
        paidAt: null,
        cashFlowEffect: false,
        expenseRecognized: false,
        expenseAdjustmentCents: -amountCents,
        creditCardId: purchase.creditCardId,
        creditCardInvoiceId: invoice.id,
        sourceType: "credit_card_refund",
        sourceId: opId,
        createdAt,
        schemaVersion: 2,
      });
    transaction.update(invoiceRef, clean({ ...totals, adjustmentsTotalCents, status: Engine.deriveCreditCardInvoiceStatus({ ...invoice, ...totals }), updatedAt: createdAt }));
    transaction.update(cardRef, clean({ committedCents: Math.max(0, Number(card.committedCents ?? Engine.invoiceTotals(invoice).remainingCents) - amountCents), updatedAt: createdAt }));
    transaction.set(adjustmentRef, clean(adjustment));
    if (!entrySnapshot.exists()) transaction.set(entryRef, clean({ ...baseMetadata(space, opId), ...entry, createdAt, updatedAt: createdAt, schemaVersion: 2 }));
    transaction.set(eventRef, clean({
      id: opId,
      ...baseMetadata(space, opId),
      entryId: opId,
      creditCardId: purchase.creditCardId,
      creditCardInvoiceId: invoice.id,
      creditCardPurchaseId: purchase.id,
      eventKind: "credit_card_purchase_refunded",
      transition: "refunded",
      status: "applied",
      amountCents,
      createdAt,
      schemaVersion: 2,
    }));
    return { adjustment, invoice: { ...invoice, ...totals, adjustmentsTotalCents }, retried: false };
  });
  emit("financial-data-changed", { entity: "creditCardAdjustment", id: opId, spaceId: space.id });
  return result;
}

async function markPaid(spaceId, entry, input = {}) {
  const space = assertSpace(spaceId);
  if (!entry?.id) throw new Error("Escolha uma conta para registrar o pagamento.");
  const paidAt = input.paidAt || now(), opId = `payment_${entry.id}`, entryRef = childRef(space.id, "entries", entry.id),
    eventRef = childRef(space.id, "events", opId), result = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(entryRef);
      if (!snapshot.exists()) throw new Error("Conta não encontrada.");
      const current = convert(snapshot);
      if (["cancelled", "reversed"].includes(current.status)) throw new Error("Esta conta não pode ser paga.");
      if (current.status === "paid") return current;
      const patch = {
        status: "paid",
        paidAt,
        occurredAt: paidAt,
        sortAt: paidAt,
        periodKey: Engine.periodKey(paidAt),
        paymentMethod: input.paymentMethod || "other",
        paymentOperationId: opId,
        notes: String(input.notes || current.notes || "").slice(0, 500),
        updatedAt: paidAt,
      };
      transaction.update(entryRef, clean(patch));
      transaction.set(eventRef, clean({
        id: opId,
        ...baseMetadata(space, opId),
        entryId: current.id,
        eventKind: "account_payment",
        transition: "paid",
        status: "applied",
        amountCents: current.amountCents,
        paymentMethod: patch.paymentMethod,
        createdAt: paidAt,
      }));
      return { ...current, ...patch };
    });
  emit("financial-data-changed", { entity: "entry", id: entry.id, action: "paid", spaceId });
  return result;
}

async function updatePendingEntry(spaceId, entry, input = {}) {
  const space = assertSpace(spaceId);
  if (!entry?.id || entry.status !== "pending") throw new Error("Somente contas pendentes podem ser editadas diretamente.");
  const dueAt = input.dueAt || entry.dueAt, opId = operationId(`edit_${entry.id}`), patch = {
    description: String(input.description || entry.description).trim().slice(0, 160),
    amountCents: Number(input.amountCents ?? entry.amountCents),
    categoryId: String(input.categoryId || entry.categoryId || "default_other"),
    categoryName: String(input.categoryName || entry.categoryName || "Outros"),
    categoryIcon: String(input.categoryIcon || entry.categoryIcon || "shapes"),
    subcategoryId: input.subcategoryId || null,
    subcategoryName: input.subcategoryName || null,
    categorySchemaVersion: 2,
    dueAt,
    duePeriodKey: Engine.periodKey(dueAt),
    sortAt: dueAt,
    periodKey: Engine.periodKey(dueAt),
    notes: String(input.notes ?? entry.notes ?? "").slice(0, 500),
    updatedAt: serverTimestamp(),
  };
  if (!patch.description || !Number.isInteger(patch.amountCents) || patch.amountCents <= 0) throw new Error("Revise a descrição e o valor da conta.");
  const batch = writeBatch(db);
  batch.update(childRef(space.id, "entries", entry.id), clean(patch));
  if (entry.recurrenceId) batch.update(childRef(space.id, "recurrences", entry.recurrenceId), {
    overrideOccurrenceKeys: arrayUnion(Engine.occurrenceKey(entry)),
    updatedAt: serverTimestamp(),
  });
  batch.set(childRef(space.id, "events", opId), clean({ id: opId, ...baseMetadata(space, opId), entryId: entry.id, eventKind: "pending_entry_edited", transition: "edited", status: "applied", previousAmountCents: entry.amountCents, amountCents: patch.amountCents, createdAt: now() }));
  await batch.commit();
  emit("financial-data-changed", { entity: "entry", id: entry.id, action: "edited", spaceId });
  return { ...entry, ...patch, updatedAt: now() };
}

async function cancelPendingEntry(spaceId, entry, reason = "") {
  const space = assertSpace(spaceId);
  const opId = `cancel_${entry.id}`, entryRef = childRef(space.id, "entries", entry.id), eventRef = childRef(space.id, "events", opId),
    recurrenceRef = entry.recurrenceId ? childRef(space.id, "recurrences", entry.recurrenceId) : null, cancelledAt = now();
  await runTransaction(db, async (transaction) => {
    const [snapshot, recurrenceSnapshot] = await Promise.all([
      transaction.get(entryRef),
      recurrenceRef ? transaction.get(recurrenceRef) : Promise.resolve(null),
    ]);
    if (!snapshot.exists()) throw new Error("Conta não encontrada.");
    const current = convert(snapshot);
    if (current.status === "cancelled") return current;
    if (current.status === "paid") throw new Error("Lançamentos pagos devem ser estornados, não excluídos.");
    transaction.update(entryRef, { status: "cancelled", cancelledAt, cancellationReason: String(reason).slice(0, 300), cancellationScope: "occurrence", updatedAt: cancelledAt });
    if (recurrenceRef && recurrenceSnapshot?.exists()) transaction.update(recurrenceRef, {
      skippedOccurrenceKeys: arrayUnion(Engine.occurrenceKey(current)),
      updatedAt: cancelledAt,
    });
    transaction.set(eventRef, clean({ id: opId, ...baseMetadata(space, opId), entryId: current.id, recurrenceId: current.recurrenceId || null, occurrenceKey: Engine.occurrenceKey(current), eventKind: "entry_cancelled", transition: "cancelled", status: "applied", scope: "occurrence", createdAt: cancelledAt }));
    return { ...current, status: "cancelled", cancelledAt };
  });
  emit("financial-data-changed", { entity: "entry", id: entry.id, action: "cancelled", spaceId });
}

async function recurrenceDetails(spaceId, recurrenceId) {
  assertSpace(spaceId);
  if (!recurrenceId) return null;
  return convert(await getDoc(childRef(spaceId, "recurrences", recurrenceId)));
}

async function recurrenceOccurrences(spaceId, recurrenceId) {
  assertSpace(spaceId);
  if (!recurrenceId) return [];
  const snapshot = await getDocs(query(
    childCollection(spaceId, "entries"),
    where("recurrenceId", "==", recurrenceId),
    limit(MAX_RECURRENCE_OCCURRENCES),
  ));
  return snapshot.docs.map(convert).sort((left, right) =>
    (Engine.localDate(left.dueAt)?.getTime() || 0) - (Engine.localDate(right.dueAt)?.getTime() || 0),
  );
}

async function updateRecurrenceFrom(spaceId, entry, input = {}) {
  const space = assertSpace(spaceId);
  if (!entry?.recurrenceId) throw new Error("Esta conta não pertence a uma recorrência.");
  if (entry.status !== "pending") throw new Error("Somente ocorrências pendentes podem alterar a série.");
  const [recurrence, occurrences] = await Promise.all([
    recurrenceDetails(space.id, entry.recurrenceId),
    recurrenceOccurrences(space.id, entry.recurrenceId),
  ]);
  if (!recurrence) throw new Error("Recorrência não encontrada.");
  const cutoff = Engine.localDay(entry.dueAt), frequency = String(input.frequency || recurrence.frequency || "monthly"),
    firstDueAt = Engine.localDay(input.dueAt || entry.dueAt), future = occurrences.filter((item) =>
      item.status === "pending" && Engine.localDay(item.dueAt) >= cutoff,
    ), rescheduled = Engine.rescheduleRecurringInstances(future, entry, firstDueAt, frequency);
  if (!future.length) throw new Error("Não existem ocorrências futuras para editar.");
  const opId = operationId(`recurrence_edit_${entry.recurrenceId}`), changedAt = now(), batch = writeBatch(db), affectedEntryIds = [];
  future.forEach((item, index) => {
    const dueAt = rescheduled[index].dueAt, patch = {
      description: String(input.description || item.description).trim().slice(0, 160),
      amountCents: Number(input.amountCents ?? item.amountCents),
      categoryId: String(input.categoryId || item.categoryId || "default_other"),
      categoryName: String(input.categoryName || item.categoryName || "Outros"),
      categoryIcon: String(input.categoryIcon || item.categoryIcon || "shapes"),
      subcategoryId: input.subcategoryId || null,
      subcategoryName: input.subcategoryName || null,
      categorySchemaVersion: 2,
      dueAt,
      duePeriodKey: Engine.periodKey(dueAt),
      sortAt: dueAt,
      periodKey: Engine.periodKey(dueAt),
      notes: String(input.notes ?? item.notes ?? "").slice(0, 500),
      recurrenceSequence: Number(item.recurrenceSequence || index + 1),
      updatedAt: serverTimestamp(),
    };
    if (!patch.description || !Number.isInteger(patch.amountCents) || patch.amountCents <= 0) throw new Error("Revise a descrição e o valor da recorrência.");
    affectedEntryIds.push(item.id);
    batch.update(childRef(space.id, "entries", item.id), clean(patch));
  });
  const lastDueAt = rescheduled.at(-1).dueAt;
  batch.update(childRef(space.id, "recurrences", entry.recurrenceId), clean({
    description: String(input.description || recurrence.description).trim().slice(0, 160),
    amountCents: Number(input.amountCents ?? recurrence.amountCents),
    categoryId: String(input.categoryId || recurrence.categoryId || "default_other"),
    categoryName: String(input.categoryName || recurrence.categoryName || "Outros"),
    categoryIcon: String(input.categoryIcon || recurrence.categoryIcon || "shapes"),
    subcategoryId: input.subcategoryId || null,
    subcategoryName: input.subcategoryName || null,
    frequency,
    effectiveFrom: firstDueAt.toISOString(),
    generatedThrough: lastDueAt,
    nextDueAt: Engine.addFrequency(lastDueAt, frequency).toISOString(),
    version: Number(recurrence.version || 1) + 1,
    updatedAt: serverTimestamp(),
  }));
  batch.set(childRef(space.id, "events", opId), clean({ id: opId, ...baseMetadata(space, opId), recurrenceId: entry.recurrenceId, entryId: entry.id, affectedEntryIds, eventKind: "recurrence_edited", transition: "edited", status: "applied", scope: "this_and_future", createdAt: changedAt }));
  await batch.commit();
  emit("financial-data-changed", { entity: "recurrence", id: entry.recurrenceId, action: "edited", spaceId });
  return { recurrenceId: entry.recurrenceId, affectedEntryIds };
}

async function cancelRecurrenceFrom(spaceId, entry, options = {}) {
  const space = assertSpace(spaceId);
  if (!entry?.recurrenceId) throw new Error("Esta conta não pertence a uma recorrência.");
  const [recurrence, occurrences] = await Promise.all([
    recurrenceDetails(space.id, entry.recurrenceId),
    recurrenceOccurrences(space.id, entry.recurrenceId),
  ]);
  if (!recurrence) throw new Error("Recorrência não encontrada.");
  const firstOccurrence = occurrences[0], cutoffSource = options.fromStart
      ? recurrence.seriesStartAt || firstOccurrence?.dueAt || entry.dueAt
      : entry.dueAt,
    cutoff = Engine.localDay(cutoffSource), cancelledAt = now(), scope = options.fromStart ? "series" : "this_and_future",
    opId = `recurrence_cancel_${entry.recurrenceId}_${Engine.occurrenceKey(cutoff)}_${scope}`,
    batch = writeBatch(db), affectedEntryIds = [];
  for (const item of occurrences) {
    if (item.status !== "pending" || Engine.localDay(item.dueAt) < cutoff) continue;
    affectedEntryIds.push(item.id);
    batch.update(childRef(space.id, "entries", item.id), {
      status: "cancelled",
      cancelledAt,
      cancellationReason: String(options.reason || "Recorrência cancelada pelo usuário").slice(0, 300),
      cancellationScope: scope,
      updatedAt: cancelledAt,
    });
  }
  batch.update(childRef(space.id, "recurrences", entry.recurrenceId), clean({
    active: false,
    seriesEndAt: cutoff.toISOString(),
    cancelledAt,
    cancellationScope: scope,
    version: Number(recurrence.version || 1) + 1,
    updatedAt: cancelledAt,
  }));
  batch.set(childRef(space.id, "events", opId), clean({ id: opId, ...baseMetadata(space, opId), recurrenceId: entry.recurrenceId, entryId: entry.id, affectedEntryIds, eventKind: "recurrence_cancelled", transition: "cancelled", status: "applied", scope, createdAt: cancelledAt }));
  await batch.commit();
  emit("financial-data-changed", { entity: "recurrence", id: entry.recurrenceId, action: "cancelled", spaceId });
  return { recurrenceId: entry.recurrenceId, affectedEntryIds };
}

async function reversePaidEntry(spaceId, entry, reason = "") {
  const space = assertSpace(spaceId);
  const id = `reversal_${entry.id}`, opId = id, reversedAt = now(), reversal = Engine.normalizeEntry({
    id,
    operationId: opId,
    direction: entry.direction === "in" ? "out" : "in",
    entryType: "reversal",
    amountCents: entry.amountCents,
    description: `Estorno · ${entry.description}`,
    categoryId: entry.categoryId,
    categoryName: entry.categoryName,
    categoryIcon: entry.categoryIcon,
    subcategoryId: entry.subcategoryId || null,
    subcategoryName: entry.subcategoryName || null,
    categorySchemaVersion: Number(entry.categorySchemaVersion || 2),
    status: "paid",
    occurredAt: reversedAt,
    paidAt: reversedAt,
    dueAt: reversedAt,
    sourceType: "reversal",
    sourceId: entry.id,
    reversedEntryId: entry.id,
    notes: String(reason).slice(0, 300),
  }), entryRef = childRef(space.id, "entries", entry.id), reversalRef = childRef(space.id, "entries", id), eventRef = childRef(space.id, "events", opId),
    result = await runTransaction(db, async (transaction) => {
      const [currentSnapshot, reversalSnapshot] = await Promise.all([transaction.get(entryRef), transaction.get(reversalRef)]);
      if (reversalSnapshot.exists()) return convert(reversalSnapshot);
      if (!currentSnapshot.exists()) throw new Error("Lançamento não encontrado.");
      const current = convert(currentSnapshot);
      if (current.status !== "paid") throw new Error("Somente lançamentos realizados podem ser estornados.");
      const value = { ...baseMetadata(space, opId), ...reversal, amountCents: current.amountCents, createdAt: reversedAt, updatedAt: reversedAt };
      transaction.set(reversalRef, clean(value));
      transaction.update(entryRef, { reversedByEntryId: id, reversedAt, updatedAt: reversedAt });
      transaction.set(eventRef, clean({ id: opId, ...baseMetadata(space, opId), entryId: current.id, reversalEntryId: id, eventKind: "entry_reversed", transition: "reversed", status: "applied", amountCents: current.amountCents, createdAt: reversedAt }));
      return value;
    });
  emit("financial-data-changed", { entity: "entry", id: entry.id, action: "reversed", spaceId });
  return result;
}

async function createTransfer(fromSpaceId, toSpaceId, input = {}) {
  if (fromSpaceId === toSpaceId) throw new Error("Escolha espaços diferentes para a transferência.");
  const from = assertSpace(fromSpaceId), to = assertSpace(toSpaceId), amountCents = Number(input.amountCents),
    transferId = String(input.transferId || operationId("transfer")), at = input.occurredAt || now(), transferRef = doc(db, "financialTransfers", transferId),
    common = { transferId, amountCents, status: "paid", occurredAt: at, paidAt: at, dueAt: at, paymentMethod: "transfer", sourceType: "transfer", sourceId: transferId, categoryId: "default_transfer", categoryName: "Transferência" },
    out = Engine.normalizeEntry({ ...common, id: `${transferId}_out`, operationId: `${transferId}:out`, direction: "out", entryType: "transfer_out", description: input.description || `Transferência para ${to.name}` }),
    incoming = Engine.normalizeEntry({ ...common, id: `${transferId}_in`, operationId: `${transferId}:in`, direction: "in", entryType: "transfer_in", description: input.description || `Transferência de ${from.name}` });
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Informe um valor válido para transferir.");
  const created = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(transferRef);
    if (snapshot.exists()) return false;
    transaction.set(transferRef, clean({ id: transferId, operationId: transferId, fromSpaceId, toSpaceId, amountCents, description: String(input.description || "Transferência"), createdBy: uid(), status: "completed", occurredAt: at, createdAt: at, updatedAt: at, schemaVersion: 1 }));
    transaction.set(childRef(from.id, "entries", out.id), clean({ ...baseMetadata(from, out.operationId), ...out, createdAt: at, updatedAt: at }));
    transaction.set(childRef(to.id, "entries", incoming.id), clean({ ...baseMetadata(to, incoming.operationId), ...incoming, createdAt: at, updatedAt: at }));
    return true;
  });
  if (!created) return { transferId, out, in: incoming, retried: true };
  emit("financial-data-changed", { entity: "transfer", id: transferId, fromSpaceId, toSpaceId });
  return { transferId, out, in: incoming };
}

async function monthEntries(spaceId, selectedPeriod) {
  assertSpace(spaceId);
  const snapshot = await getDocs(query(
    childCollection(spaceId, "entries"),
    where("periodKey", "==", selectedPeriod),
    orderBy("sortAt", "desc"),
    limit(MAX_MONTH_ENTRIES),
  ));
  return snapshot.docs.map(convert).filter((entry) => entry.status !== "cancelled");
}
async function dueMonthEntries(spaceId, selectedPeriod) {
  assertSpace(spaceId);
  const { start, endExclusive } = Engine.monthRange(selectedPeriod), snapshot = await getDocs(query(
    childCollection(spaceId, "entries"),
    where("dueAt", ">=", start.toISOString()),
    where("dueAt", "<", endExclusive.toISOString()),
    orderBy("dueAt", "asc"),
    limit(MAX_MONTH_ENTRIES),
  ));
  return snapshot.docs.map(convert).filter((entry) => entry.status !== "cancelled");
}
async function migrateLegacyCategories(space, entryLists = []) {
  const byId = new Map();
  for (const list of entryLists) for (const entry of list || []) byId.set(entry.id, entry);
  const upgrades = [...byId.values()].map((entry) => {
    if (entry.direction !== "out" || entry.categorySchemaVersion >= 2 || entry.categoryMigrationStatus === "manual_review") return { entry, patch: null };
    return { entry, patch: Engine.legacyCategoryUpgrade(entry, space.type) || { categoryMigrationStatus: "manual_review" } };
  }).filter((item) => item.patch);
  if (!upgrades.length) return { migrated: 0, manualReview: 0 };
  for (let offset = 0; offset < upgrades.length; offset += 400) {
    const batch = writeBatch(db);
    for (const { entry, patch } of upgrades.slice(offset, offset + 400))
      batch.update(childRef(space.id, "entries", entry.id), clean({ ...patch, updatedAt: serverTimestamp() }));
    await batch.commit();
  }
  const patches = new Map(upgrades.map(({ entry, patch }) => [entry.id, patch]));
  for (const list of entryLists) for (const entry of list || []) Object.assign(entry, patches.get(entry.id) || {});
  return {
    migrated: upgrades.filter(({ patch }) => patch.categoryMigrationStatus === "migrated").length,
    manualReview: upgrades.filter(({ patch }) => patch.categoryMigrationStatus === "manual_review").length,
  };
}

async function loadCreditOverview(spaceId, selectedPeriod = Engine.periodKey()) {
  const [financialAccounts, creditCards, invoiceValues] = await Promise.all([
    listFinancialAccounts(spaceId),
    listCreditCards(spaceId),
    listCreditCardInvoices(spaceId),
  ]), invoices = invoiceValues.map((invoice) => ({
    ...invoice,
    ...Engine.invoiceTotals(invoice),
    status: Engine.deriveCreditCardInvoiceStatus(invoice),
  })), selectedInvoices = invoices.filter((invoice) => Engine.periodKey(invoice.dueDate) === selectedPeriod),
    cardSummaries = creditCards.map((card) => {
      const cardInvoices = invoices.filter((invoice) => invoice.creditCardId === card.id && invoice.status !== "cancelled"),
        committedCents = Number.isInteger(card.committedCents) ? card.committedCents : Engine.creditCardCommitment(cardInvoices),
        nextInvoice = cardInvoices.filter((invoice) => invoice.remainingCents > 0)
          .sort((left, right) => (Engine.localDate(left.dueDate)?.getTime() || Infinity) - (Engine.localDate(right.dueDate)?.getTime() || Infinity))[0] || null;
      return {
        ...card,
        committedCents,
        availableCents: Math.max(0, Number(card.limitCents || 0) - committedCents),
        currentInvoice: nextInvoice,
      };
    }), invoicePayables = selectedInvoices.filter((invoice) => invoice.remainingCents > 0 && invoice.status !== "cancelled").map((invoice) => ({
      id: `invoice:${invoice.id}`,
      creditCardInvoiceId: invoice.id,
      creditCardId: invoice.creditCardId,
      entityType: "credit_card_invoice",
      description: `Fatura ${invoice.cardName || "Cartão"}`,
      amountCents: invoice.remainingCents,
      originalAmountCents: invoice.amountDueCents,
      direction: "out",
      status: "pending",
      dueAt: invoice.dueDate,
      sortAt: invoice.dueDate,
      categoryId: "credit_card_invoice",
      categoryName: "Faturas",
      categoryIcon: "credit-card",
      invoiceStatus: invoice.status,
    }));
  return {
    financialAccounts,
    creditCards: cardSummaries,
    creditCardInvoices: invoices,
    selectedCreditCardInvoices: selectedInvoices,
    invoicePayables,
    creditCommittedCents: cardSummaries.reduce((sum, card) => sum + card.committedCents, 0),
    futureInvoices: invoices.filter((invoice) => invoice.remainingCents > 0 && invoice.status !== "cancelled")
      .sort((left, right) => (Engine.localDate(left.dueDate)?.getTime() || Infinity) - (Engine.localDate(right.dueDate)?.getTime() || Infinity)),
  };
}

async function loadDashboard(spaceId, selectedPeriod = Engine.periodKey()) {
  const space = assertSpace(spaceId), started = performance.now(), [month, accounts, categories, credit] = await Promise.all([
    monthEntries(space.id, selectedPeriod),
    dueMonthEntries(space.id, selectedPeriod),
    listCategories(space.id),
    loadCreditOverview(space.id, selectedPeriod),
  ]), categoryMigration = await migrateLegacyCategories(space, [month, accounts]),
    allAccounts = [...accounts, ...credit.invoicePayables], payables = Engine.sortPayables(allAccounts), latest = month.filter((entry) => entry.status === "paid" && !entry.reversedByEntryId)
      .sort((left, right) => (Engine.localDate(right.occurredAt)?.getTime() || 0) - (Engine.localDate(left.occurredAt)?.getTime() || 0)),
    summary = Engine.summarize(month), accountSummary = Engine.summarize(allAccounts), result = {
    space: structuredClone(space),
    periodKey: selectedPeriod,
    entries: month,
    accounts: allAccounts,
    latest: latest.slice(0, 10),
    payables: payables.slice(0, 20),
    categories,
    summary: {
      ...summary,
      pendingPayablesCents: payables.filter((entry) => entry.direction === "out").reduce((sum, entry) => sum + Number(entry.amountCents || 0), 0),
      pendingCount: payables.filter((entry) => entry.direction === "out").length,
      dueSoonCount: accountSummary.dueSoonCount,
      migratedCategories: categoryMigration.migrated,
      manualReviewCategories: categoryMigration.manualReview,
    },
    ...credit,
  };
  state.lastReadStats = {
    operation: "loadDashboard",
    documents: month.length + accounts.length + credit.creditCardInvoices.length + credit.creditCards.length + credit.financialAccounts.length,
    limits: { month: MAX_MONTH_ENTRIES, accounts: MAX_MONTH_ENTRIES, invoices: MAX_CREDIT_INVOICES },
    durationMs: Math.round(performance.now() - started),
    at: now(),
  };
  return result;
}

function selectedConsolidatedIds() {
  try {
    const ids = JSON.parse(localStorage.getItem(consolidatedKey()) || "[]");
    return Array.isArray(ids) ? ids.filter((id) => state.spaces.some((space) => space.id === id)) : [];
  } catch { return []; }
}
function setConsolidatedIds(ids = []) {
  const allowed = new Set(state.spaces.map((space) => space.id)), unique = [...new Set(ids.map(String))].filter((id) => allowed.has(id));
  localStorage.setItem(consolidatedKey(), JSON.stringify(unique));
  return unique;
}
async function loadConsolidated(ids = selectedConsolidatedIds(), selectedPeriod = Engine.periodKey()) {
  const selected = setConsolidatedIds(ids);
  if (!selected.length) return { consolidated: true, selectedIds: [], ...Engine.consolidate([]), spaces: [] };
  const dashboards = await Promise.all(selected.map((id) => loadDashboard(id, selectedPeriod))),
    withSpace = (items, dashboard) => (items || []).map((item) => ({ ...item, financialSpaceName: dashboard.space.name })),
    creditCards = dashboards.flatMap((dashboard) => withSpace(dashboard.creditCards, dashboard)),
    creditCardInvoices = dashboards.flatMap((dashboard) => withSpace(dashboard.creditCardInvoices, dashboard)),
    futureInvoices = dashboards.flatMap((dashboard) => withSpace(dashboard.futureInvoices, dashboard))
      .sort((left, right) => (Engine.localDate(left.dueDate)?.getTime() || Infinity) - (Engine.localDate(right.dueDate)?.getTime() || Infinity));
  return {
    consolidated: true,
    selectedIds: selected,
    spaces: dashboards.map((item) => item.space),
    ...Engine.consolidate(dashboards),
    financialAccounts: dashboards.flatMap((dashboard) => withSpace(dashboard.financialAccounts, dashboard)),
    creditCards,
    creditCardInvoices,
    futureInvoices,
    creditCommittedCents: creditCards.reduce((sum, card) => sum + Number(card.committedCents || 0), 0),
  };
}

async function uploadAttachment(spaceId, entryId, file, options = {}) {
  const space = assertSpace(spaceId);
  if (!(file instanceof File)) throw new Error("Escolha um arquivo.");
  const allowed = new Set(["image/jpeg", "image/png", "image/webp", "application/pdf"]);
  if (!allowed.has(file.type)) throw new Error("Use JPG, PNG, WebP ou PDF.");
  if (file.size > 10 * 1024 * 1024) throw new Error("O comprovante deve ter até 10 MB.");
  let uploadBody = file, uploadType = file.type, extension = file.type === "application/pdf" ? "pdf" : file.type.split("/")[1].replace("jpeg", "jpg"), optimized = false;
  if (file.type.startsWith("image/") && window.ProductImages?.processImage) {
    const processed = await window.ProductImages.processImage(file);
    uploadBody = processed.mainBlob;
    uploadType = processed.contentType;
    extension = processed.extension;
    optimized = true;
  }
  const opId = String(options.operationId || operationId("attachment")),
    path = `financialSpaces/${space.id}/entries/${entryId}/${opId}.${extension}`,
    storageRef = ref(storage, path), metadata = {
      contentType: uploadType,
      customMetadata: {
        financialSpaceId: space.id,
        entryId: String(entryId),
        ownerUid: uid(),
        operationId: opId,
        entityType: "financialAttachment",
      },
    };
  await uploadBytes(storageRef, uploadBody, metadata);
  const url = await getDownloadURL(storageRef), attachment = { id: opId, operationId: opId, path, url, name: String(file.name || `comprovante.${extension}`).slice(0, 160), contentType: uploadType, size: uploadBody.size, sourceSize: file.size, optimized, createdAt: now(), createdBy: uid() }, entrySnapshot = await getDoc(childRef(space.id, "entries", entryId)), entry = convert(entrySnapshot);
  if (!entry) throw new Error("Lançamento não encontrado para anexar o comprovante.");
  await updateDoc(childRef(space.id, "entries", entryId), { attachments: [...(entry.attachments || []), clean(attachment)].slice(-10), updatedAt: serverTimestamp() });
  emit("financial-data-changed", { entity: "attachment", id: opId, entryId, spaceId });
  return attachment;
}

const FinancialSpaceService = {
  listSpaces,
  listCachedSpaces,
  selectedSpaceId,
  selectSpace,
  createSpace,
  updateAutomation,
  automationState,
  reconcileBusinessIncome,
  archiveSpace,
  listCategories,
  createCategory,
  listFinancialAccounts,
  createFinancialAccount,
  listCreditCards,
  createCreditCard,
  listCreditCardInvoices,
  getCreditCardInvoiceDetails,
  createCreditCardPurchase,
  payCreditCardInvoice,
  refundCreditCardPurchase,
  migrateLegacyCategories,
  createEntry,
  updatePendingEntry,
  markPaid,
  cancelPendingEntry,
  recurrenceDetails,
  updateRecurrenceFrom,
  cancelRecurrenceFrom,
  reversePaidEntry,
  createTransfer,
  loadDashboard,
  loadConsolidated,
  selectedConsolidatedIds,
  setConsolidatedIds,
  uploadAttachment,
  getReadStats: () => state.lastReadStats ? structuredClone(state.lastReadStats) : null,
  limits: Object.freeze({ month: MAX_MONTH_ENTRIES, recurrenceOccurrences: MAX_RECURRENCE_OCCURRENCES, cards: MAX_CREDIT_CARDS, invoices: MAX_CREDIT_INVOICES }),
};

window.FinancialSpaceService = FinancialSpaceService;
addEventListener("firebase-auth-ready", async () => {
  try {
    await listSpaces();
    emit("financial-service-ready", { spaces: listCachedSpaces() });
  } catch (error) {
    console.error("[FinancialSpaceService] initialization failed", { code: error.code, message: error.message });
    emit("financial-service-error", { code: error.code || "unknown", message: error.message });
  }
});

export { FinancialSpaceService };
