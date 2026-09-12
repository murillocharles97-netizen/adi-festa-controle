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
  VIEW_PROFILE_CACHE_PREFIX = "veconi:financial-view-profile:v1:",
  LAST_VIEW_PREFIX = "veconi:last-financial-view:v1:",
  MAX_MONTH_ENTRIES = 500,
  MAX_RECURRENCE_OCCURRENCES = 120,
  MAX_FINANCIAL_ACCOUNTS = 50,
  MAX_CREDIT_CARDS = 50,
  MAX_CREDIT_INVOICES = 72,
  MAX_FINANCIAL_VIEWS = 30,
  state = {
    spaces: [],
    loadedForUid: "",
    selectedId: "",
    loading: false,
    spacesLoadedAt: 0,
    lastReadStats: null,
    reconciliation: new Map(),
    viewProfile: null,
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
const viewProfileCacheKey = () => `${VIEW_PROFILE_CACHE_PREFIX}${uid()}`;
const lastViewKey = () => `${LAST_VIEW_PREFIX}${uid()}`;
const viewProfileRef = () => doc(db, "financialViewProfiles", uid());
const emit = (name, detail = {}) => dispatchEvent(new CustomEvent(name, { detail }));
const operationId = (prefix = "financial") => `${prefix}_${crypto.randomUUID()}`;
const automationState = (space = {}) => {
  const legacyActivation = space.autoIncomeSince || space.autoEntryFromPaymentsSince || space.autoEntryFromSalesSince || null,
    automation = space.automation || {}, autoIncome = automation.autoIncome || {};
  return {
    enabled: automation.enabled === true || (automation.enabled === undefined && Boolean(legacyActivation)),
    linkedBusinessId: space.type === "business" ? space.linkedBusinessId || null : null,
    activatedAt: automation.activatedAt || legacyActivation,
    defaultIncomeFinancialAccountId: String(automation.defaultIncomeFinancialAccountId || "").trim() || null,
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
const ownedSpaces = () => state.spaces.filter((space) => space.ownerUid === uid());
const cardHomeSpaceId = (card = {}, fallback = "") => String(
  card.cardHomeSpaceId || card.financialSpaceId || fallback || "",
).trim();
const normalizeCreditCard = (card = {}, homeSpaceId = "") => Engine.normalizeCreditCardAccess({
  ...card,
  cardHomeSpaceId: cardHomeSpaceId(card, homeSpaceId),
}, homeSpaceId);
const cardCanBeUsedInSpace = (card = {}, space = {}) => {
  const normalized = normalizeCreditCard(card), targetId = String(space.id || "");
  if (!targetId || normalized.ownerUid !== space.ownerUid) return false;
  return Engine.creditCardAllowsSpace(normalized, targetId);
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
const accountBalanceCents = (account = {}) => Engine.financialAccountBalance(account);
const accountBalancePatch = (account, deltaCents, changedAt, operationIdValue) => ({
  currentBalanceCents: accountBalanceCents(account) + Number(deltaCents || 0),
  balanceUpdatedAt: changedAt,
  lastBalanceOperationId: operationIdValue,
  schemaVersion: Math.max(3, Number(account.schemaVersion || 0)),
  updatedAt: changedAt,
});
const cashAccountDelta = (entry = {}) => entry.status === "paid" && entry.cashFlowEffect !== false && entry.financialAccountId
  ? (entry.direction === "in" ? 1 : -1) * Number(entry.amountCents || 0)
  : 0;

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
        where("type", "==", "business"),
        where("active", "==", true),
        limit(100),
      )),
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
      query: "active space by owner/type or current linkedBusinessId/type",
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

const systemFinancialViews = () => {
  const idsFor = (predicate) => state.spaces.filter(predicate).map((space) => space.id);
  return [
    { id: "all_spaces", name: "Todos os espaços", mode: "all_spaces", financialSpaceIds: idsFor(() => true), isSystem: true },
    { id: "personal_spaces", name: "Pessoal", mode: "personal", financialSpaceIds: idsFor((space) => space.type !== "business"), isSystem: true },
    { id: "business_spaces", name: "Empresas", mode: "business", financialSpaceIds: idsFor((space) => space.type === "business"), isSystem: true },
  ].filter((view) => view.financialSpaceIds.length);
};

const normalizeViewProfile = (raw = {}) => {
  const allowed = new Set(state.spaces.map((space) => space.id)), system = systemFinancialViews(), systemIds = new Set(system.map((view) => view.id)),
    customViews = (Array.isArray(raw.customViews) ? raw.customViews : []).slice(0, MAX_FINANCIAL_VIEWS).map((view) => ({
      id: String(view?.id || "").trim(),
      name: String(view?.name || "").trim().slice(0, 60),
      mode: "custom",
      financialSpaceIds: [...new Set((Array.isArray(view?.financialSpaceIds) ? view.financialSpaceIds : []).map(String))].filter((id) => allowed.has(id)),
      createdAt: view?.createdAt || null,
      updatedAt: view?.updatedAt || null,
      isSystem: false,
    })).filter((view) => view.id && view.name && view.financialSpaceIds.length && !systemIds.has(view.id)),
    validIds = new Set([...system.map((view) => view.id), ...customViews.map((view) => view.id), ...state.spaces.map((space) => `space:${space.id}`)]),
    favoriteViewIds = [...new Set((Array.isArray(raw.favoriteViewIds) ? raw.favoriteViewIds : []).map(String))].filter((id) => validIds.has(id)),
    fallback = system.find((view) => view.id === "all_spaces")?.id || (state.spaces[0] ? `space:${state.spaces[0].id}` : ""),
    defaultViewId = validIds.has(String(raw.defaultViewId || "")) ? String(raw.defaultViewId) : "",
    remembered = localStorage.getItem(lastViewKey()) || "",
    lastViewId = validIds.has(String(raw.lastViewId || "")) ? String(raw.lastViewId) : validIds.has(remembered) ? remembered : fallback,
    views = [...system, ...customViews].map((view) => ({
      ...view,
      isFavorite: favoriteViewIds.includes(view.id),
      isDefault: defaultViewId === view.id,
    })).sort((left, right) => Number(right.isFavorite) - Number(left.isFavorite) || Number(right.isSystem) - Number(left.isSystem) || left.name.localeCompare(right.name, "pt-BR"));
  return { customViews, favoriteViewIds, defaultViewId, lastViewId, views };
};

const rememberViewProfile = (profile) => {
  state.viewProfile = normalizeViewProfile(profile);
  try { localStorage.setItem(viewProfileCacheKey(), JSON.stringify(profile)); } catch {}
  return structuredClone(state.viewProfile);
};

async function listFinancialViews(options = {}) {
  if (!options.force && state.viewProfile) return structuredClone(normalizeViewProfile(state.viewProfile));
  let cached = {};
  try { cached = JSON.parse(localStorage.getItem(viewProfileCacheKey()) || "{}"); } catch {}
  if (options.cacheOnly || !navigator.onLine) return rememberViewProfile(cached);
  try {
    const snapshot = await getDoc(viewProfileRef()), raw = snapshot.exists() ? convert(snapshot) : cached;
    return rememberViewProfile(raw || {});
  } catch (error) {
    if (Object.keys(cached).length) return rememberViewProfile(cached);
    throw error;
  }
}

async function mutateFinancialViewProfile(mutator) {
  const reference = viewProfileRef(), currentUid = uid(), result = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(reference), current = normalizeViewProfile(snapshot.exists() ? convert(snapshot) : state.viewProfile || {}),
      next = normalizeViewProfile(mutator(structuredClone(current)) || current), value = {
        ownerUid: currentUid,
        customViews: next.customViews,
        favoriteViewIds: next.favoriteViewIds,
        defaultViewId: next.defaultViewId || null,
        lastViewId: next.lastViewId || null,
        schemaVersion: 1,
        updatedAt: now(),
      };
    transaction.set(reference, clean(value), { merge: true });
    return value;
  });
  return rememberViewProfile(result);
}

async function saveFinancialView(input = {}) {
  const allowed = new Set(state.spaces.map((space) => space.id)), ids = [...new Set((input.financialSpaceIds || []).map(String))].filter((id) => allowed.has(id)),
    name = requiredText(input.name, "o nome da visão", 60), id = String(input.id || `view_${crypto.randomUUID()}`), changedAt = now();
  if (!ids.length) throw new Error("Escolha ao menos um espaço para esta visão.");
  return mutateFinancialViewProfile((profile) => {
    const existing = profile.customViews.find((view) => view.id === id), next = {
      id,
      name,
      mode: "custom",
      financialSpaceIds: ids,
      createdAt: existing?.createdAt || changedAt,
      updatedAt: changedAt,
    };
    profile.customViews = [...profile.customViews.filter((view) => view.id !== id), next].slice(-MAX_FINANCIAL_VIEWS);
    if (input.isFavorite === true && !profile.favoriteViewIds.includes(id)) profile.favoriteViewIds.push(id);
    if (input.isFavorite === false) profile.favoriteViewIds = profile.favoriteViewIds.filter((item) => item !== id);
    if (input.isDefault === true) profile.defaultViewId = id;
    if (input.isDefault === false && profile.defaultViewId === id) profile.defaultViewId = "";
    profile.lastViewId = id;
    return profile;
  });
}

async function deleteFinancialView(viewId) {
  const id = String(viewId || "");
  if (!id.startsWith("view_")) throw new Error("As visões rápidas do sistema não podem ser excluídas.");
  return mutateFinancialViewProfile((profile) => {
    profile.customViews = profile.customViews.filter((view) => view.id !== id);
    profile.favoriteViewIds = profile.favoriteViewIds.filter((item) => item !== id);
    if (profile.defaultViewId === id) profile.defaultViewId = "";
    if (profile.lastViewId === id) profile.lastViewId = "";
    return profile;
  });
}

async function setDefaultFinancialView(viewId) {
  const id = String(viewId || ""), available = normalizeViewProfile(state.viewProfile || {}).views.some((view) => view.id === id)
    || state.spaces.some((space) => `space:${space.id}` === id);
  if (!available) throw new Error("Esta visão não está disponível.");
  return mutateFinancialViewProfile((profile) => ({ ...profile, defaultViewId: profile.defaultViewId === id ? "" : id }));
}

async function toggleFavoriteFinancialView(viewId) {
  const id = String(viewId || ""), available = normalizeViewProfile(state.viewProfile || {}).views.some((view) => view.id === id)
    || state.spaces.some((space) => `space:${space.id}` === id);
  if (!available) throw new Error("Esta visão não está disponível.");
  return mutateFinancialViewProfile((profile) => ({
    ...profile,
    favoriteViewIds: profile.favoriteViewIds.includes(id) ? profile.favoriteViewIds.filter((item) => item !== id) : [...profile.favoriteViewIds, id],
  }));
}

async function rememberFinancialView(viewId) {
  const id = String(viewId || "");
  localStorage.setItem(lastViewKey(), id);
  const normalized = normalizeViewProfile(state.viewProfile || {}), valid = normalized.views.some((view) => view.id === id)
    || state.spaces.some((space) => `space:${space.id}` === id);
  if (!valid || normalized.lastViewId === id) return normalized;
  return mutateFinancialViewProfile((profile) => ({ ...profile, lastViewId: id }));
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
    requestedAccountId = String(input.defaultIncomeFinancialAccountId ?? current.defaultIncomeFinancialAccountId ?? "").trim(),
    activatedAt = current.activatedAt || (enabled ? now() : null), automation = {
      enabled,
      linkedBusinessId: space.linkedBusinessId,
      activatedAt,
      defaultIncomeFinancialAccountId: requestedAccountId || null,
      autoIncome: {
        sales: input.sales ?? current.autoIncome.sales,
        customerPayments: input.customerPayments ?? current.autoIncome.customerPayments,
        onlineOrders: input.onlineOrders ?? current.autoIncome.onlineOrders,
      },
    };
  if (requestedAccountId) {
    const account = convert(await getDoc(childRef(space.id, "financialAccounts", requestedAccountId)));
    if (!account || account.active === false) throw new Error("A conta padrão de recebimentos não está disponível.");
  }
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
  if (!options.force && previous && Date.now() - previous.at < 120_000) return { ...(await previous.result), cached: true };
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
  return { ...result, cached: false };
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
    type = Engine.normalizeFinancialAccountType(input.type), initialBalanceCents = Number(input.initialBalanceCents || 0),
    includeInAvailableBalance = input.includeInAvailableBalance === true
      || (input.includeInAvailableBalance !== false && type !== "investment_account"), value = {
      id,
      ...baseMetadata(space, opId),
      name: requiredText(input.name, "o nome da conta", 80),
      type,
      institution: String(input.institution || "").trim().slice(0, 80) || null,
      initialBalanceCents,
      currentBalanceCents: initialBalanceCents,
      includeInAvailableBalance,
      balanceMode: "projected_from_opening_balance",
      openingBalanceAt: createdAt,
      balanceUpdatedAt: createdAt,
      active: true,
      createdAt,
      updatedAt: createdAt,
      schemaVersion: 3,
    };
  if (!Number.isSafeInteger(initialBalanceCents)) throw new Error("Informe um saldo inicial válido em centavos.");
  await setDoc(childRef(space.id, "financialAccounts", id), clean(value));
  emit("financial-data-changed", { entity: "financialAccount", id, spaceId: space.id });
  return value;
}

async function adjustFinancialAccountBalance(spaceId, accountId, input = {}) {
  const space = assertSpace(spaceId), id = requiredText(accountId, "a conta", 120), targetBalanceCents = Number(input.targetBalanceCents),
    opId = String(input.operationId || operationId("balance_adjustment")), changedAt = input.occurredAt || now(),
    accountRef = childRef(space.id, "financialAccounts", id), entryRef = childRef(space.id, "entries", opId), eventRef = childRef(space.id, "events", opId);
  if (!Number.isInteger(targetBalanceCents)) throw new Error("Informe o saldo real em centavos.");
  const result = await runTransaction(db, async (transaction) => {
    const [accountSnapshot, entrySnapshot] = await Promise.all([transaction.get(accountRef), transaction.get(entryRef)]);
    if (!accountSnapshot.exists()) throw new Error("Conta ou carteira não encontrada.");
    const account = convert(accountSnapshot);
    if (account.active === false) throw new Error("Esta conta está inativa.");
    if (entrySnapshot.exists()) return { account, entry: convert(entrySnapshot), retried: true };
    const previousBalanceCents = accountBalanceCents(account), differenceCents = targetBalanceCents - previousBalanceCents;
    if (!differenceCents) return { account: { ...account, currentBalanceCents: targetBalanceCents }, entry: null, unchanged: true };
    const entry = Engine.normalizeEntry({
      id: opId,
      operationId: opId,
      direction: differenceCents > 0 ? "in" : "out",
      entryType: "balance_adjustment",
      amountCents: Math.abs(differenceCents),
      description: `Ajuste de saldo · ${account.name}`,
      categoryId: "default_balance_adjustment",
      categoryName: "Conciliação",
      categoryIcon: "scale",
      status: "paid",
      dueAt: changedAt,
      occurredAt: changedAt,
      paidAt: changedAt,
      paymentMethod: "other",
      financialAccountId: id,
      cashFlowEffect: false,
      expenseRecognized: false,
      sourceType: "balance_adjustment",
      sourceId: opId,
      previousBalanceCents,
      targetBalanceCents,
      notes: String(input.reason || "Conciliação manual de saldo").slice(0, 300),
      createdAt: changedAt,
      schemaVersion: 3,
    }), value = { ...baseMetadata(space, opId), ...entry, createdAt: changedAt, updatedAt: changedAt };
    transaction.update(accountRef, clean(accountBalancePatch(account, differenceCents, changedAt, opId)));
    transaction.set(entryRef, clean(value));
    transaction.set(eventRef, clean({ id: opId, ...baseMetadata(space, opId), entryId: opId, financialAccountId: id, eventKind: "financial_account_balance_adjusted", transition: "reconciled", status: "applied", amountCents: Math.abs(differenceCents), previousBalanceCents, targetBalanceCents, createdAt: changedAt, schemaVersion: 3 }));
    return { account: { ...account, ...accountBalancePatch(account, differenceCents, changedAt, opId) }, entry: value, retried: false };
  });
  emit("financial-data-changed", { entity: "financialAccount", id, spaceId: space.id, action: "balance-adjusted" });
  return result;
}

async function readCreditCardsFromHome(homeSpaceId) {
  const snapshot = await getDocs(query(
    childCollection(homeSpaceId, "creditCards"),
    where("active", "==", true),
    limit(MAX_CREDIT_CARDS),
  ));
  return snapshot.docs.map(convert).map((card) => normalizeCreditCard(card, homeSpaceId));
}

async function listCreditCards(spaceId) {
  const targetSpace = assertSpace(spaceId), homes = new Map([[targetSpace.id, targetSpace]]);
  for (const space of ownedSpaces()) homes.set(space.id, space);
  const batches = await Promise.all([...homes.keys()].map(async (homeSpaceId) => {
    try { return await readCreditCardsFromHome(homeSpaceId); }
    catch (error) {
      if (homeSpaceId === targetSpace.id) throw error;
      return [];
    }
  })), cards = batches.flat().filter((card) => cardCanBeUsedInSpace(card, targetSpace)), unique = new Map();
  for (const card of cards) unique.set(`${card.cardHomeSpaceId}:${card.id}`, {
    ...card,
    usageFinancialSpaceId: targetSpace.id,
    sharedAcrossSpaces: card.accessMode !== "single_space",
    canEditScope: card.ownerUid === uid(),
  });
  return [...unique.values()].sort((left, right) =>
    String(left.name).localeCompare(String(right.name), "pt-BR"),
  );
}

function creditCardAccessValue(space, input = {}, current = {}) {
  const requestedMode = String(input.accessMode || current.accessMode || "single_space"),
    accessMode = Engine.CREDIT_CARD_ACCESS_MODES.includes(requestedMode) ? requestedMode : "single_space",
    requestedDefault = String(input.defaultFinancialSpaceId || current.defaultFinancialSpaceId || space.id),
    requestedAllowed = accessMode === "selected_spaces"
      ? (Array.isArray(input.allowedFinancialSpaceIds) ? input.allowedFinancialSpaceIds : current.allowedFinancialSpaceIds || [])
      : accessMode === "single_space" ? [requestedDefault] : [],
    allowedFinancialSpaceIds = [...new Set(requestedAllowed.map(String).map((id) => id.trim()).filter(Boolean))],
    available = new Map(state.spaces.filter((candidate) => candidate.ownerUid === space.ownerUid).map((candidate) => [candidate.id, candidate]));
  available.set(space.id, space);
  if (accessMode !== "single_space" && uid() !== space.ownerUid)
    throw new Error("Somente o proprietário financeiro pode compartilhar este cartão.");
  if (accessMode === "selected_spaces" && !allowedFinancialSpaceIds.length)
    throw new Error("Escolha ao menos um espaço para o cartão.");
  if ([...allowedFinancialSpaceIds, requestedDefault].some((id) => !available.has(id)))
    throw new Error("O cartão só pode ser compartilhado com espaços do mesmo proprietário.");
  return {
    accessMode,
    allowedFinancialSpaceIds,
    defaultFinancialSpaceId: requestedDefault,
  };
}

async function createCreditCard(spaceId, input = {}) {
  const space = assertSpace(spaceId), id = String(input.id || crypto.randomUUID()),
    opId = String(input.operationId || `credit_card_${id}`), createdAt = now(),
    closingDay = Math.trunc(Number(input.closingDay)), dueDay = Math.trunc(Number(input.dueDay)),
    last4 = String(input.last4 || "").replace(/\D/g, "").slice(-4);
  if (closingDay < 1 || closingDay > 31) throw new Error("O fechamento deve ficar entre os dias 1 e 31.");
  if (dueDay < 1 || dueDay > 31) throw new Error("O vencimento deve ficar entre os dias 1 e 31.");
  if (last4.length !== 4) throw new Error("Informe os 4 últimos dígitos do cartão.");
  const access = creditCardAccessValue(space, input), value = {
    id,
    ...baseMetadata(space, opId),
    cardHomeSpaceId: space.id,
    name: requiredText(input.name, "o nome do cartão", 80),
    issuer: String(input.issuer || input.institution || "").trim().slice(0, 80) || null,
    institution: String(input.institution || input.issuer || "").trim().slice(0, 80) || null,
    last4,
    limitCents: integerCents(input.limitCents || 0, "limite"),
    closingDay,
    dueDay,
    paymentAccountId: input.paymentAccountId ? String(input.paymentAccountId) : null,
    ...access,
    committedCents: 0,
    active: true,
    createdAt,
    updatedAt: createdAt,
    schemaVersion: 3,
  };
  await setDoc(childRef(space.id, "creditCards", id), clean(value));
  emit("financial-data-changed", { entity: "creditCard", id, spaceId: space.id });
  return value;
}

async function rebuildCreditCardInvoiceProjections(homeSpaceId, cardId) {
  const home = assertSpace(homeSpaceId), cardSnapshot = await getDoc(childRef(home.id, "creditCards", cardId)), card = convert(cardSnapshot);
  if (!card) throw new Error("Cartão não encontrado.");
  if (card.ownerUid !== uid()) throw new Error("Somente o proprietário pode reconstruir esta visão.");
  const visibleSpaces = state.spaces.filter((space) => space.ownerUid === card.ownerUid), [snapshots, adjustmentsSnapshot] = await Promise.all([
    Promise.all(visibleSpaces.map(async (space) => ({
      space,
      snapshot: await getDocs(query(childCollection(space.id, "creditCardPurchases"), where("creditCardId", "==", card.id), limit(300))),
    }))),
    getDocs(query(childCollection(home.id, "creditCardAdjustments"), where("creditCardId", "==", card.id), limit(300))),
  ]), projections = new Map(), purchaseDimensions = new Map();
  for (const { space, snapshot } of snapshots) for (const item of snapshot.docs) {
    const purchase = convert(item);
    if (!purchase || purchase.status === "cancelled") continue;
    purchaseDimensions.set(`${space.id}:${purchase.id}`, {
      financialSpaceId: purchase.financialSpaceId || space.id,
      categoryId: purchase.categoryId || "default_other",
    });
    const current = projections.get(purchase.creditCardInvoiceId) || { spaceTotals: {}, categoryTotals: {} };
    current.spaceTotals = Engine.adjustDimensionTotal(current.spaceTotals, purchase.financialSpaceId || space.id, purchase.amountCents);
    current.categoryTotals = Engine.adjustDimensionTotal(current.categoryTotals, purchase.categoryId || "default_other", purchase.amountCents);
    projections.set(purchase.creditCardInvoiceId, current);
  }
  for (const item of adjustmentsSnapshot.docs) {
    const adjustment = convert(item), dimensions = purchaseDimensions.get(`${adjustment.purchaseFinancialSpaceId}:${adjustment.creditCardPurchaseId}`);
    if (!dimensions || adjustment.status !== "confirmed" || !adjustment.creditCardInvoiceId) continue;
    const current = projections.get(adjustment.creditCardInvoiceId);
    if (!current) continue;
    const effectCents = Number(adjustment.effectCents || 0);
    current.spaceTotals = Engine.adjustDimensionTotal(current.spaceTotals, dimensions.financialSpaceId, effectCents);
    current.categoryTotals = Engine.adjustDimensionTotal(current.categoryTotals, dimensions.categoryId, effectCents);
  }
  if (!projections.size) return { updated: 0 };
  const batch = writeBatch(db), updatedAt = serverTimestamp();
  for (const [invoiceId, projection] of projections) batch.update(childRef(home.id, "creditCardInvoices", invoiceId), {
    ...projection,
    cardHomeSpaceId: home.id,
    spacesUsedIds: Object.keys(projection.spaceTotals),
    projectionVersion: 1,
    schemaVersion: 3,
    updatedAt,
  });
  await batch.commit();
  return { updated: projections.size };
}

async function updateCreditCard(homeSpaceId, cardId, input = {}) {
  const home = assertSpace(homeSpaceId), refValue = childRef(home.id, "creditCards", cardId), snapshot = await getDoc(refValue), current = convert(snapshot);
  if (!current) throw new Error("Cartão não encontrado.");
  if (current.ownerUid !== uid()) throw new Error("Somente o proprietário pode editar este cartão.");
  const access = creditCardAccessValue(home, input, normalizeCreditCard(current, home.id));
  if (access.accessMode !== "single_space") await rebuildCreditCardInvoiceProjections(home.id, cardId);
  const patch = clean({
    name: input.name === undefined ? current.name : requiredText(input.name, "o nome do cartão", 80),
    institution: input.institution === undefined ? current.institution || null : String(input.institution || "").trim().slice(0, 80) || null,
    issuer: input.institution === undefined ? current.issuer || current.institution || null : String(input.institution || "").trim().slice(0, 80) || null,
    last4: input.last4 === undefined ? current.last4 : String(input.last4 || "").replace(/\D/g, "").slice(-4),
    limitCents: input.limitCents === undefined ? current.limitCents : integerCents(input.limitCents, "limite"),
    closingDay: input.closingDay === undefined ? current.closingDay : Math.trunc(Number(input.closingDay)),
    dueDay: input.dueDay === undefined ? current.dueDay : Math.trunc(Number(input.dueDay)),
    paymentAccountId: input.paymentAccountId === undefined ? current.paymentAccountId || null : input.paymentAccountId ? String(input.paymentAccountId) : null,
    cardHomeSpaceId: home.id,
    ...access,
    schemaVersion: 3,
    updatedAt: now(),
  });
  if (!/^\d{4}$/.test(patch.last4)) throw new Error("Informe os 4 últimos dígitos do cartão.");
  if (patch.closingDay < 1 || patch.closingDay > 31 || patch.dueDay < 1 || patch.dueDay > 31)
    throw new Error("Revise fechamento e vencimento.");
  await updateDoc(refValue, patch);
  emit("financial-data-changed", { entity: "creditCard", id: cardId, spaceId: home.id });
  return normalizeCreditCard({ ...current, ...patch }, home.id);
}

async function listStoredCreditCardInvoices(homeSpaceId, options = {}) {
  const source = childCollection(homeSpaceId, "creditCardInvoices"), clauses = [];
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
    .map((invoice) => ({ ...invoice, cardHomeSpaceId: invoice.cardHomeSpaceId || homeSpaceId, status: Engine.deriveCreditCardInvoiceStatus(invoice, options.now || new Date()) }));
}

async function listCreditCardInvoices(spaceId, options = {}) {
  assertSpace(spaceId);
  const cards = options.cards || await listCreditCards(spaceId), homes = new Map();
  for (const card of cards) {
    const homeSpaceId = card.cardHomeSpaceId || card.financialSpaceId;
    if (!homes.has(homeSpaceId)) homes.set(homeSpaceId, new Set());
    homes.get(homeSpaceId).add(card.id);
  }
  const batches = await Promise.all([...homes].map(async ([homeSpaceId, cardIds]) => ({
    homeSpaceId,
    cardIds,
    invoices: await listStoredCreditCardInvoices(homeSpaceId, options),
  }))), unique = new Map();
  for (const batch of batches) for (const invoice of batch.invoices) {
    if (!batch.cardIds.has(invoice.creditCardId)) continue;
    unique.set(`${batch.homeSpaceId}:${invoice.id}`, {
      ...invoice,
      cardHomeSpaceId: batch.homeSpaceId,
      usageFinancialSpaceId: spaceId,
      spaceAmountCents: Number(invoice.spaceTotals?.[spaceId] || (batch.homeSpaceId === spaceId && !invoice.spaceTotals ? invoice.amountDueCents || invoice.purchasesTotalCents || 0 : 0)),
    });
  }
  return [...unique.values()];
}

async function ensureCreditCardInvoice(spaceId, input = {}) {
  const target = assertSpace(spaceId), cards = await listCreditCards(target.id), card = cards.find((item) =>
    item.id === String(input.creditCardId || "") && item.cardHomeSpaceId === String(input.cardHomeSpaceId || item.cardHomeSpaceId)),
    referenceKey = String(input.referenceKey || Engine.periodKey());
  if (!card) throw new Error("Cartão indisponível para este espaço.");
  const home = assertSpace(card.cardHomeSpaceId), cycle = Engine.creditCardInvoiceCycle({ referenceKey, closingDay: card.closingDay, dueDay: card.dueDay }),
    invoiceId = `${card.id}_${cycle.referenceKey}`, invoiceRef = childRef(home.id, "creditCardInvoices", invoiceId), createdAt = now();
  return runTransaction(db, async (transaction) => {
    const invoiceSnapshot = await transaction.get(invoiceRef);
    if (invoiceSnapshot.exists()) return { invoice: { ...convert(invoiceSnapshot), cardHomeSpaceId: home.id }, created: false };
    const totals = Engine.invoiceTotals({}), invoice = {
      id: invoiceId,
      ...baseMetadata(home, `invoice_${invoiceId}`),
      cardHomeSpaceId: home.id,
      creditCardId: card.id,
      cardName: card.name,
      cardLast4: card.last4,
      ...cycle,
      ...totals,
      spaceTotals: {},
      categoryTotals: {},
      spacesUsedIds: [],
      status: Engine.deriveCreditCardInvoiceStatus({ ...cycle, ...totals }),
      projectionVersion: 1,
      createdAt,
      updatedAt: createdAt,
      schemaVersion: 4,
    };
    transaction.set(invoiceRef, clean(invoice));
    return { invoice, created: true };
  });
}

async function listUpcomingCreditCardInvoices(spaceId, selectedPeriod = Engine.periodKey()) {
  const { start } = Engine.monthRange(selectedPeriod), endExclusive = Engine.addMonths(start, 13), cards = await listCreditCards(spaceId), invoices = await listCreditCardInvoices(spaceId, { cards });
  return invoices.filter((invoice) => {
    const due = Engine.localDate(invoice.dueDate);
    return due && due >= start && due < endExclusive;
  }).sort((left, right) => (Engine.localDate(left.dueDate)?.getTime() || Infinity) - (Engine.localDate(right.dueDate)?.getTime() || Infinity));
}

async function findCreditCardInvoice(spaceId, invoiceId, preferredHomeSpaceId = "") {
  const cards = await listCreditCards(spaceId), homeIds = [...new Set([
    preferredHomeSpaceId,
    ...cards.filter((card) => invoiceId.startsWith(`${card.id}_`)).map((card) => card.cardHomeSpaceId),
    ...cards.map((card) => card.cardHomeSpaceId),
    spaceId,
  ].filter(Boolean))];
  for (const homeSpaceId of homeIds) {
    const snapshot = await getDoc(childRef(homeSpaceId, "creditCardInvoices", invoiceId));
    if (snapshot.exists()) return { invoice: convert(snapshot), homeSpaceId, cards };
  }
  throw new Error("Fatura não encontrada.");
}

async function getCreditCardInvoiceDetails(spaceId, invoiceId, options = {}) {
  const target = assertSpace(spaceId), found = await findCreditCardInvoice(spaceId, invoiceId, options.cardHomeSpaceId), invoice = found.invoice,
    homeSpaceId = found.homeSpaceId, ownerView = invoice.ownerUid === uid(), purchaseSpaces = ownerView
      ? state.spaces.filter((space) => space.ownerUid === invoice.ownerUid)
      : [target], [purchaseBatches, paymentsSnapshot, adjustmentsSnapshot] = await Promise.all([
        Promise.all(purchaseSpaces.map(async (space) => ({
          space,
          snapshot: await getDocs(query(childCollection(space.id, "creditCardPurchases"), where("creditCardInvoiceId", "==", invoiceId), limit(300))),
        }))),
        getDocs(query(childCollection(homeSpaceId, "creditCardInvoicePayments"), where("creditCardInvoiceId", "==", invoiceId), limit(100))),
        getDocs(query(childCollection(homeSpaceId, "creditCardAdjustments"), where("creditCardInvoiceId", "==", invoiceId), limit(100))),
      ]), purchases = purchaseBatches.flatMap(({ space, snapshot }) => snapshot.docs.map(convert).filter((purchase) => purchase.status !== "voided").map((purchase) => ({
        ...purchase,
        financialSpaceId: purchase.financialSpaceId || space.id,
        financialSpaceName: space.name,
      })));
  const byDateDesc = (left, right) => (Engine.localDate(right.purchaseDate || right.paidAt || right.createdAt)?.getTime() || 0)
    - (Engine.localDate(left.purchaseDate || left.paidAt || left.createdAt)?.getTime() || 0);
  const categoryNames = new Map(), spaceName = (id) => state.spaces.find((space) => space.id === id)?.name || "Espaço",
    projectionBreakdown = (totals, keyName, nameForId) => Engine.breakdownBy(Object.entries(totals || {}).map(([id, amountCents]) => ({ [keyName]: id, amountCents })), keyName)
      .map((item) => ({ ...item, name: nameForId(item.id) }));
  for (const purchase of purchases) if (purchase.categoryId) categoryNames.set(purchase.categoryId, purchase.categoryName || "Outros");
  return {
    invoice: { ...invoice, cardHomeSpaceId: homeSpaceId, status: Engine.deriveCreditCardInvoiceStatus(invoice) },
    purchases: purchases.sort(byDateDesc),
    payments: paymentsSnapshot.docs.map(convert).sort(byDateDesc),
    adjustments: adjustmentsSnapshot.docs.map(convert).sort(byDateDesc),
    ownerView,
    spaceBreakdown: ownerView && invoice.spaceTotals
      ? projectionBreakdown(invoice.spaceTotals, "financialSpaceId", spaceName)
      : Engine.breakdownBy(purchases, "financialSpaceId").map((item) => ({ ...item, name: spaceName(item.id) })),
    categoryBreakdown: ownerView && invoice.categoryTotals
      ? projectionBreakdown(invoice.categoryTotals, "categoryId", (id) => categoryNames.get(id) || "Outros")
      : Engine.breakdownBy(purchases, "categoryId").map((item) => ({ ...item, name: categoryNames.get(item.id) || "Outros" })),
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
    const accountDeltas = new Map();
    refs.forEach((item, index) => {
      if (snapshots[index].exists()) return;
      const delta = cashAccountDelta(item.entry), accountId = String(item.entry.financialAccountId || "");
      if (delta && accountId) accountDeltas.set(accountId, (accountDeltas.get(accountId) || 0) + delta);
    });
    const accountSnapshots = new Map();
    for (const accountId of accountDeltas.keys()) {
      const snapshot = await transaction.get(childRef(space.id, "financialAccounts", accountId));
      if (!snapshot.exists() || convert(snapshot).active === false) throw new Error("A conta de origem ou destino não está disponível.");
      accountSnapshots.set(accountId, snapshot);
    }
    const values = refs.map((item, index) => {
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
    for (const [accountId, delta] of accountDeltas) {
      const snapshot = accountSnapshots.get(accountId), account = convert(snapshot);
      transaction.update(snapshot.ref, clean(accountBalancePatch(account, delta, now(), `entries:${refs.filter((item) => item.entry.financialAccountId === accountId).map((item) => item.entry.operationId).join(",")}`)));
    }
    return values;
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
    availableCards = await listCreditCards(space.id), card = availableCards.find((item) => item.id === creditCardId && (!input.cardHomeSpaceId || item.cardHomeSpaceId === input.cardHomeSpaceId)),
    cardHomeSpaceId = card?.cardHomeSpaceId || "", homeSpace = cardHomeSpaceId ? assertSpace(cardHomeSpaceId) : null,
    cardRef = cardHomeSpaceId ? childRef(cardHomeSpaceId, "creditCards", creditCardId) : null;
  if (!card || card.active === false) throw new Error("O cartão escolhido não está disponível neste espaço.");
  const opId = String(input.operationId || operationId("credit_purchase")), purchaseDate = input.purchaseDate || now(),
    requestedInstallmentCount = Math.min(60, Math.max(1, Math.trunc(Number(input.installmentCount || 1)))),
    installmentStartNumber = Math.max(1, Math.trunc(Number(input.installmentStartNumber || 1))),
    installmentTotalCount = Math.max(requestedInstallmentCount, Math.trunc(Number(input.installmentTotalCount || requestedInstallmentCount)));
  if (installmentStartNumber + requestedInstallmentCount - 1 > installmentTotalCount)
    throw new Error("A parcela atual ultrapassa o total do parcelamento.");
  const installments = Engine.buildCreditCardInstallments({
      amountCents: Number(input.amountCents),
      installmentCount: requestedInstallmentCount,
      operationId: opId,
      purchaseDate,
      closingDay: card.closingDay,
      dueDay: card.dueDay,
    }).map((item, index) => {
      const installmentNumber = installmentStartNumber + index;
      return {
        ...item,
        id: `${opId}_${String(installmentNumber).padStart(2, "0")}`,
        installmentNumber,
        installmentCount: installmentTotalCount,
      };
    }), invoiceIds = [...new Set(installments.map((item) => `${creditCardId}_${item.invoice.referenceKey}`))],
    invoiceRefs = new Map(invoiceIds.map((id) => [id, childRef(cardHomeSpaceId, "creditCardInvoices", id)])),
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
    expenseRecognized: input.expenseRecognized !== false,
    creditCardId,
    cardHomeSpaceId,
    creditCardInvoiceId: invoiceIds[0],
    creditCardInvoiceIds: invoiceIds,
    purchaseDate,
    installmentGroupId: opId,
    installmentCount: installmentTotalCount,
    installmentStartNumber,
    sourceType: input.sourceType || "credit_card_purchase",
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
    if (cardInTransaction.active === false || !cardCanBeUsedInSpace(normalizeCreditCard(cardInTransaction, cardHomeSpaceId), space))
      throw new Error("O cartão não está autorizado neste espaço.");
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
          ...baseMetadata(homeSpace, current?.operationId || `invoice_${invoiceId}`),
          cardHomeSpaceId,
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
          spaceTotals: Engine.adjustDimensionTotal(current?.spaceTotals, space.id, addition),
          categoryTotals: Engine.adjustDimensionTotal(current?.categoryTotals, entry.categoryId, addition),
          spacesUsedIds: [...new Set([...(current?.spacesUsedIds || []), space.id])],
          projectionVersion: 1,
          status: Engine.deriveCreditCardInvoiceStatus({ ...(current || {}), ...totals, closingDate: installment.invoice.closingDate, dueDate: installment.invoice.dueDate }),
          createdBy: current?.createdBy || uid(),
          createdAt: current?.createdAt || createdAt,
          updatedAt: createdAt,
          schemaVersion: 3,
        };
      transaction.set(invoiceRefs.get(invoiceId), clean(invoiceValue));
    }
    installments.forEach((installment, index) => {
      const invoiceId = `${creditCardId}_${installment.invoice.referenceKey}`, purchaseValue = {
        id: installment.id,
        ...baseMetadata(space, `${opId}:${index + 1}`),
        purchaseOperationId: opId,
        cardHomeSpaceId,
        creditCardId,
        creditCardInvoiceId: invoiceId,
        installmentGroupId: opId,
        installmentNumber: installment.installmentNumber,
        installmentCount: installment.installmentCount,
        amountCents: installment.amountCents,
        originalPurchaseAmountCents: Number(input.originalPurchaseAmountCents || amountCents),
        description: installment.installmentCount > 1 ? `${description} · ${installment.installmentNumber}/${installment.installmentCount}` : description,
        merchant: String(input.merchant || description).slice(0, 120),
        categoryId: entry.categoryId,
        categoryName: entry.categoryName,
        subcategoryId: entry.subcategoryId,
        subcategoryName: entry.subcategoryName,
        purchaseDate,
        status: "posted",
        createdAt,
        updatedAt: createdAt,
        schemaVersion: 3,
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
      cardHomeSpaceId,
      creditCardInvoiceIds: invoiceIds,
      eventKind: input.sourceType === "credit_card_ongoing_installment" ? "credit_card_ongoing_installment_created" : "credit_card_purchase_created",
      transition: "created",
      status: "applied",
      amountCents,
      createdAt,
      schemaVersion: 3,
    }));
    return { entry: entryValue, installments, invoiceIds, retried: false };
  });
  emit("financial-data-changed", { entity: "creditCardPurchase", id: opId, spaceId: space.id });
  return result;
}

async function resolveCreditCardInvoice(spaceId, input = {}) {
  const space = assertSpace(spaceId), creditCardId = requiredText(input.creditCardId, "o cartão", 120),
    cards = await listCreditCards(space.id), card = cards.find((item) => item.id === creditCardId
      && (!input.cardHomeSpaceId || item.cardHomeSpaceId === input.cardHomeSpaceId));
  if (!card || card.active === false || !cardCanBeUsedInSpace(card, space))
    throw new Error("O cartão escolhido não está disponível neste espaço.");
  const previewEntry = {
    id: String(input.entryId || "preview"),
    direction: "out",
    status: "pending",
    amountCents: Number(input.amountCents),
    spaceType: space.type,
  }, plan = Engine.buildCreditCardBillPaymentPlan({
    entry: previewEntry,
    card,
    purchaseDate: input.purchaseDate || now(),
    feeCents: Number(input.feeCents || 0),
  }), invoiceSnapshot = await getDoc(childRef(card.cardHomeSpaceId, "creditCardInvoices", plan.creditCardInvoiceId)),
    invoice = convert(invoiceSnapshot);
  return {
    ...plan,
    card,
    currentInvoice: invoice ? { ...invoice, ...Engine.invoiceTotals(invoice) } : null,
    invoiceTotalAfterCents: Number(invoice ? Engine.invoiceTotals(invoice).amountDueCents : 0) + plan.totalCardAmountCents,
  };
}

async function payEntryByCreditCard(spaceId, entry, input = {}) {
  const space = assertSpace(spaceId);
  if (!entry?.id) throw new Error("Escolha uma conta para registrar o pagamento.");
  const opId = requiredText(input.operationId || operationId("bill_card_payment"), "o identificador da operação", 180),
    preview = await resolveCreditCardInvoice(space.id, {
      entryId: entry.id,
      amountCents: entry.amountCents,
      creditCardId: input.creditCardId,
      cardHomeSpaceId: input.cardHomeSpaceId,
      purchaseDate: input.purchaseDate || input.paidAt || now(),
      feeCents: input.feeCents || 0,
    }), card = preview.card, cardHomeSpaceId = preview.cardHomeSpaceId, homeSpace = assertSpace(cardHomeSpaceId),
    invoiceId = preview.creditCardInvoiceId, billPurchaseId = `${opId}_bill`, feePurchaseId = preview.feeCents ? `${opId}_fee` : null,
    feeEntryId = preview.feeCents ? `${opId}_fee_entry` : null, createdAt = now(), purchaseDate = preview.purchaseDate,
    entryRef = childRef(space.id, "entries", entry.id), cardRef = childRef(cardHomeSpaceId, "creditCards", card.id),
    invoiceRef = childRef(cardHomeSpaceId, "creditCardInvoices", invoiceId), billPurchaseRef = childRef(space.id, "creditCardPurchases", billPurchaseId),
    feePurchaseRef = feePurchaseId ? childRef(space.id, "creditCardPurchases", feePurchaseId) : null,
    feeEntryRef = feeEntryId ? childRef(space.id, "entries", feeEntryId) : null, eventRef = childRef(space.id, "events", opId);
  const result = await runTransaction(db, async (transaction) => {
    const entrySnapshot = await transaction.get(entryRef), cardSnapshot = await transaction.get(cardRef),
      invoiceSnapshot = await transaction.get(invoiceRef), billPurchaseSnapshot = await transaction.get(billPurchaseRef),
      feePurchaseSnapshot = feePurchaseRef ? await transaction.get(feePurchaseRef) : null,
      feeEntrySnapshot = feeEntryRef ? await transaction.get(feeEntryRef) : null, eventSnapshot = await transaction.get(eventRef);
    if (!entrySnapshot.exists()) throw new Error("Conta não encontrada.");
    const current = convert(entrySnapshot), currentCard = convert(cardSnapshot);
    if (current.status === "paid" && current.paymentOperationId === opId)
      return { entry: current, invoice: convert(invoiceSnapshot), retried: true };
    if (current.status !== "pending" && Engine.effectiveStatus(current) !== "overdue")
      throw new Error("Somente contas pendentes podem ser pagas no cartão.");
    if (!currentCard || currentCard.active === false || !cardCanBeUsedInSpace(normalizeCreditCard(currentCard, cardHomeSpaceId), space))
      throw new Error("O cartão não está autorizado neste espaço.");
    if (billPurchaseSnapshot.exists() || feePurchaseSnapshot?.exists() || feeEntrySnapshot?.exists() || eventSnapshot.exists())
      throw new Error("A operação já existe, mas a conta não está vinculada a ela. Atualize a tela antes de tentar novamente.");
    const plan = Engine.buildCreditCardBillPaymentPlan({ entry: { ...current, spaceType: space.type }, card: normalizeCreditCard(currentCard, cardHomeSpaceId), purchaseDate, feeCents: preview.feeCents }),
      currentInvoice = convert(invoiceSnapshot), totals = Engine.invoiceTotals({
        purchasesTotalCents: Number(currentInvoice?.purchasesTotalCents || 0) + plan.totalCardAmountCents,
        adjustmentsTotalCents: Number(currentInvoice?.adjustmentsTotalCents || 0),
        paidTotalCents: Number(currentInvoice?.paidTotalCents || 0),
      }), categoryTotalsWithBill = Engine.adjustDimensionTotal(currentInvoice?.categoryTotals, current.categoryId || "default_other", plan.billAmountCents),
      categoryTotals = plan.feeCents ? Engine.adjustDimensionTotal(categoryTotalsWithBill, plan.feeCategory.categoryId, plan.feeCents) : categoryTotalsWithBill,
      invoiceValue = {
        ...(currentInvoice || {}),
        id: invoiceId,
        ...baseMetadata(homeSpace, currentInvoice?.operationId || `invoice_${invoiceId}`),
        cardHomeSpaceId,
        creditCardId: currentCard.id,
        cardName: currentCard.name,
        cardLast4: currentCard.last4,
        referenceKey: plan.invoice.referenceKey,
        referenceYear: plan.invoice.referenceYear,
        referenceMonth: plan.invoice.referenceMonth,
        openingDate: plan.invoice.openingDate,
        closingDate: plan.invoice.closingDate,
        dueDate: plan.invoice.dueDate,
        ...totals,
        spaceTotals: Engine.adjustDimensionTotal(currentInvoice?.spaceTotals, space.id, plan.totalCardAmountCents),
        categoryTotals,
        spacesUsedIds: [...new Set([...(currentInvoice?.spacesUsedIds || []), space.id])],
        projectionVersion: 1,
        status: Engine.deriveCreditCardInvoiceStatus({ ...(currentInvoice || {}), ...totals, closingDate: plan.invoice.closingDate, dueDate: plan.invoice.dueDate }),
        createdBy: currentInvoice?.createdBy || uid(),
        createdAt: currentInvoice?.createdAt || createdAt,
        updatedAt: createdAt,
        schemaVersion: 4,
      }, purchaseBase = {
        cardHomeSpaceId,
        creditCardId: currentCard.id,
        creditCardInvoiceId: invoiceId,
        installmentGroupId: opId,
        installmentNumber: 1,
        installmentCount: 1,
        purchaseDate,
        status: "posted",
        createdAt,
        updatedAt: createdAt,
        schemaVersion: 4,
      }, billPurchase = {
        id: billPurchaseId,
        ...baseMetadata(space, billPurchaseId),
        ...purchaseBase,
        purchaseOperationId: opId,
        amountCents: plan.billAmountCents,
        originalPurchaseAmountCents: plan.billAmountCents,
        description: current.description,
        merchant: String(current.description).slice(0, 120),
        categoryId: current.categoryId || "default_other",
        categoryName: current.categoryName || "Outros",
        subcategoryId: current.subcategoryId || null,
        subcategoryName: current.subcategoryName || null,
        sourceType: "bill_payment",
        sourceId: current.id,
        relatedEntryId: current.id,
        chargeComponent: "principal",
      }, entryPatch = {
        status: "paid",
        paidAt: purchaseDate,
        occurredAt: purchaseDate,
        sortAt: purchaseDate,
        periodKey: Engine.periodKey(purchaseDate),
        paymentMethod: "credit_card",
        paymentType: "credit_card",
        cashFlowEffect: false,
        expenseRecognized: true,
        paymentOperationId: opId,
        creditCardId: currentCard.id,
        cardHomeSpaceId,
        creditCardInvoiceId: invoiceId,
        creditCardPurchaseId: billPurchaseId,
        creditCardFeePurchaseId: feePurchaseId,
        creditCardFeeEntryId: feeEntryId,
        billAmountCents: plan.billAmountCents,
        feeAmountCents: plan.feeCents,
        cardChargedAmountCents: plan.totalCardAmountCents,
        settlementType: "credit_card_bill_payment",
        notes: String(input.notes || current.notes || "").slice(0, 500),
        updatedAt: createdAt,
      };
    transaction.set(invoiceRef, clean(invoiceValue));
    transaction.set(billPurchaseRef, clean(billPurchase));
    if (plan.feeCents) {
      const feePurchase = {
        id: feePurchaseId,
        ...baseMetadata(space, feePurchaseId),
        ...purchaseBase,
        purchaseOperationId: opId,
        amountCents: plan.feeCents,
        originalPurchaseAmountCents: plan.feeCents,
        description: `Taxa do pagamento · ${current.description}`,
        merchant: "Taxa do cartão",
        ...plan.feeCategory,
        sourceType: "bill_payment_fee",
        sourceId: current.id,
        relatedEntryId: feeEntryId,
        sourceBillEntryId: current.id,
        chargeComponent: "fee",
      }, feeEntry = Engine.normalizeEntry({
        id: feeEntryId,
        operationId: feeEntryId,
        direction: "out",
        entryType: "financial_fee",
        description: `Taxa do pagamento · ${current.description}`,
        amountCents: plan.feeCents,
        ...plan.feeCategory,
        categorySchemaVersion: 2,
        status: "paid",
        occurredAt: purchaseDate,
        paidAt: null,
        dueAt: plan.invoice.dueDate,
        paymentMethod: "credit_card",
        paymentType: "credit_card",
        cashFlowEffect: false,
        expenseRecognized: true,
        creditCardId: currentCard.id,
        cardHomeSpaceId,
        creditCardInvoiceId: invoiceId,
        creditCardPurchaseId: feePurchaseId,
        sourceType: "credit_card_bill_fee",
        sourceId: current.id,
        relatedBillEntryId: current.id,
        createdAt,
        schemaVersion: 3,
      });
      transaction.set(feePurchaseRef, clean(feePurchase));
      transaction.set(feeEntryRef, clean({ ...baseMetadata(space, feeEntryId), ...feeEntry, createdAt, updatedAt: createdAt }));
    }
    transaction.update(cardRef, clean({ committedCents: Number(currentCard.committedCents || 0) + plan.totalCardAmountCents, updatedAt: createdAt }));
    transaction.update(entryRef, clean(entryPatch));
    transaction.set(eventRef, clean({
      id: opId,
      ...baseMetadata(space, opId),
      entryId: current.id,
      creditCardId: currentCard.id,
      cardHomeSpaceId,
      creditCardInvoiceId: invoiceId,
      creditCardPurchaseId: billPurchaseId,
      creditCardFeePurchaseId: feePurchaseId,
      creditCardFeeEntryId: feeEntryId,
      eventKind: "bill_paid_by_credit_card",
      transition: "settled_to_invoice",
      status: "applied",
      amountCents: plan.billAmountCents,
      feeAmountCents: plan.feeCents,
      cardChargedAmountCents: plan.totalCardAmountCents,
      paymentMethod: "credit_card",
      cashFlowEffectCents: 0,
      createdAt,
      schemaVersion: 4,
    }));
    return { entry: { ...current, ...entryPatch }, invoice: invoiceValue, billPurchase, feeEntryId, retried: false };
  });
  emit("financial-data-changed", { entity: "entry", id: entry.id, action: "paid_by_credit_card", spaceId });
  return result;
}

async function createOngoingCreditCardInstallment(spaceId, input = {}) {
  const installmentAmountCents = Number(input.installmentAmountCents),
    currentInstallment = Math.trunc(Number(input.currentInstallment)),
    totalInstallments = Math.trunc(Number(input.totalInstallments));
  if (!Number.isInteger(installmentAmountCents) || installmentAmountCents <= 0)
    throw new Error("Informe o valor da parcela.");
  if (!Number.isInteger(currentInstallment) || !Number.isInteger(totalInstallments)
    || currentInstallment < 1 || totalInstallments < currentInstallment || totalInstallments > 60)
    throw new Error("Revise a parcela atual e o total de parcelas.");
  const remainingInstallments = totalInstallments - currentInstallment + 1;
  return createCreditCardPurchase(spaceId, {
    ...input,
    amountCents: installmentAmountCents * remainingInstallments,
    installmentCount: remainingInstallments,
    installmentStartNumber: currentInstallment,
    installmentTotalCount: totalInstallments,
    originalPurchaseAmountCents: installmentAmountCents * totalInstallments,
    expenseRecognized: false,
    sourceType: "credit_card_ongoing_installment",
  });
}

async function adjustCreditCardInvoice(spaceId, invoiceId, input = {}) {
  const space = assertSpace(spaceId), found = await findCreditCardInvoice(space.id, invoiceId, input.cardHomeSpaceId),
    homeSpace = assertSpace(found.homeSpaceId), cardHomeSpaceId = homeSpace.id,
    targetTotalCents = Number(input.targetTotalCents), opId = String(input.operationId || operationId("invoice_adjustment")),
    invoiceRef = childRef(cardHomeSpaceId, "creditCardInvoices", invoiceId),
    adjustmentRef = childRef(cardHomeSpaceId, "creditCardAdjustments", opId),
    eventRef = childRef(cardHomeSpaceId, "events", opId), createdAt = now();
  if (!Number.isInteger(targetTotalCents) || targetTotalCents < 0)
    throw new Error("Informe o valor real da fatura.");
  const result = await runTransaction(db, async (transaction) => {
    const invoiceSnapshot = await transaction.get(invoiceRef), adjustmentSnapshot = await transaction.get(adjustmentRef);
    if (adjustmentSnapshot.exists()) return { adjustment: convert(adjustmentSnapshot), retried: true };
    if (!invoiceSnapshot.exists()) throw new Error("Fatura não encontrada.");
    const invoice = convert(invoiceSnapshot), totalsBefore = Engine.invoiceTotals(invoice),
      cardRef = childRef(cardHomeSpaceId, "creditCards", invoice.creditCardId), cardSnapshot = await transaction.get(cardRef);
    if (!cardSnapshot.exists()) throw new Error("Cartão da fatura não encontrado.");
    if (targetTotalCents < totalsBefore.paidTotalCents)
      throw new Error("O valor real não pode ser menor que o total já pago.");
    const effectCents = targetTotalCents - totalsBefore.amountDueCents;
    if (!effectCents) throw new Error("O valor real já corresponde ao calculado pela VECONI.");
    const card = convert(cardSnapshot), adjustmentsTotalCents = Number(invoice.adjustmentsTotalCents || 0) + effectCents,
      totals = Engine.invoiceTotals({ ...invoice, adjustmentsTotalCents }), adjustment = {
        id: opId,
        ...baseMetadata(homeSpace, opId),
        cardHomeSpaceId,
        creditCardInvoiceId: invoice.id,
        creditCardId: invoice.creditCardId,
        kind: "opening_balance",
        amountCents: Math.abs(effectCents),
        effectCents,
        previousTotalCents: totalsBefore.amountDueCents,
        targetTotalCents,
        reason: String(input.reason || "Saldo inicial / conciliação da fatura").slice(0, 300),
        occurredAt: input.occurredAt || createdAt,
        status: "confirmed",
        createdAt,
        schemaVersion: 4,
      };
    transaction.update(invoiceRef, clean({
      ...totals,
      adjustmentsTotalCents,
      status: Engine.deriveCreditCardInvoiceStatus({ ...invoice, ...totals }),
      updatedAt: createdAt,
    }));
    transaction.update(cardRef, clean({
      committedCents: Math.max(0, Number(card.committedCents ?? totalsBefore.remainingCents) + effectCents),
      updatedAt: createdAt,
    }));
    transaction.set(adjustmentRef, clean(adjustment));
    transaction.set(eventRef, clean({
      id: opId,
      ...baseMetadata(homeSpace, opId),
      creditCardInvoiceId: invoice.id,
      creditCardId: invoice.creditCardId,
      eventKind: "credit_card_invoice_adjusted",
      transition: "reconciled",
      status: "applied",
      amountCents: Math.abs(effectCents),
      effectCents,
      createdAt,
      schemaVersion: 4,
    }));
    return { adjustment, invoice: { ...invoice, ...totals, adjustmentsTotalCents }, retried: false };
  });
  emit("financial-data-changed", { entity: "creditCardInvoiceAdjustment", id: opId, spaceId: space.id });
  return result;
}

async function payCreditCardInvoice(spaceId, invoiceId, input = {}) {
  const space = assertSpace(spaceId), found = await findCreditCardInvoice(space.id, invoiceId, input.cardHomeSpaceId),
    homeSpace = assertSpace(found.homeSpaceId), cardHomeSpaceId = homeSpace.id,
    opId = String(input.operationId || operationId("invoice_payment")),
    amountCents = Number(input.amountCents), paidAt = input.paidAt || now(),
    financialAccountId = requiredText(input.financialAccountId, "a conta de origem", 120),
    method = String(input.paymentMethod || "other"), invoiceRef = childRef(cardHomeSpaceId, "creditCardInvoices", invoiceId),
    accountRef = childRef(space.id, "financialAccounts", financialAccountId),
    paymentRef = childRef(cardHomeSpaceId, "creditCardInvoicePayments", opId), entryId = `invoice_payment_${opId}`,
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
    const invoice = convert(invoiceSnapshot), cardRef = childRef(cardHomeSpaceId, "creditCards", invoice.creditCardId),
      cardSnapshot = await transaction.get(cardRef), totalsBefore = Engine.invoiceTotals(invoice);
    if (!cardSnapshot.exists()) throw new Error("Cartão da fatura não encontrado.");
    const card = convert(cardSnapshot);
    if (amountCents > totalsBefore.remainingCents) throw new Error("O pagamento não pode ser maior que o saldo da fatura.");
    const totals = Engine.invoiceTotals({ ...invoice, paidTotalCents: totalsBefore.paidTotalCents + amountCents }),
      status = Engine.deriveCreditCardInvoiceStatus({ ...invoice, ...totals }, paidAt), payment = {
        id: opId,
        ...baseMetadata(homeSpace, opId),
        cardHomeSpaceId,
        paymentFinancialSpaceId: space.id,
        creditCardInvoiceId: invoice.id,
        creditCardId: invoice.creditCardId,
        financialAccountId,
        amountCents,
        paymentMethod: method,
        paidAt,
        status: "confirmed",
        createdAt,
        schemaVersion: 3,
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
        cardHomeSpaceId,
        creditCardInvoiceId: invoice.id,
        sourceType: "credit_card_invoice_payment",
        sourceId: opId,
        notes: String(input.notes || "").slice(0, 500),
        createdAt,
        schemaVersion: 2,
      });
    transaction.update(invoiceRef, clean({ ...totals, status, paidAt: totals.remainingCents === 0 ? paidAt : invoice.paidAt || null, updatedAt: createdAt }));
    transaction.update(cardRef, clean({ committedCents: Math.max(0, Number(card.committedCents ?? totalsBefore.remainingCents) - amountCents), updatedAt: createdAt }));
    transaction.update(accountRef, clean(accountBalancePatch(convert(accountSnapshot), -amountCents, paidAt, opId)));
    transaction.set(paymentRef, clean(payment));
    if (!entrySnapshot.exists()) transaction.set(entryRef, clean({ ...baseMetadata(space, opId), ...entry, createdAt, updatedAt: createdAt, schemaVersion: 2 }));
    transaction.set(eventRef, clean({ id: opId, ...baseMetadata(space, opId), entryId, creditCardInvoiceId: invoice.id, creditCardId: invoice.creditCardId, cardHomeSpaceId, eventKind: "credit_card_invoice_paid", transition: totals.remainingCents === 0 ? "paid" : "partially_paid", status: "applied", amountCents, createdAt, schemaVersion: 3 }));
    return { payment, invoice: { ...invoice, ...totals, status }, entry, retried: false };
  });
  emit("financial-data-changed", { entity: "creditCardInvoicePayment", id: opId, spaceId: space.id });
  return result;
}

async function refundCreditCardPurchase(spaceId, purchaseId, input = {}) {
  const space = assertSpace(spaceId), opId = `credit_refund_${String(purchaseId).replace(/[^a-zA-Z0-9_-]/g, "_")}`,
    amountCents = Number(input.amountCents), refundedAt = input.refundedAt || now(), purchaseRef = childRef(space.id, "creditCardPurchases", purchaseId),
    entryRef = childRef(space.id, "entries", opId), eventRef = childRef(space.id, "events", opId), createdAt = now(), initialPurchase = convert(await getDoc(purchaseRef));
  if (!initialPurchase) throw new Error("Compra não encontrada.");
  const cardHomeSpaceId = initialPurchase.cardHomeSpaceId || space.id, homeSpace = assertSpace(cardHomeSpaceId),
    adjustmentRef = childRef(cardHomeSpaceId, "creditCardAdjustments", opId);
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Informe um estorno maior que zero.");
  const result = await runTransaction(db, async (transaction) => {
    const purchaseSnapshot = await transaction.get(purchaseRef), adjustmentSnapshot = await transaction.get(adjustmentRef);
    if (!purchaseSnapshot.exists()) throw new Error("Compra não encontrada.");
    if (adjustmentSnapshot.exists()) return { adjustment: convert(adjustmentSnapshot), retried: true };
    const purchase = convert(purchaseSnapshot), invoiceRef = childRef(cardHomeSpaceId, "creditCardInvoices", purchase.creditCardInvoiceId),
      cardRef = childRef(cardHomeSpaceId, "creditCards", purchase.creditCardId), invoiceSnapshot = await transaction.get(invoiceRef),
      entrySnapshot = await transaction.get(entryRef), cardSnapshot = await transaction.get(cardRef);
    if (!invoiceSnapshot.exists()) throw new Error("Fatura da compra não encontrada.");
    if (!cardSnapshot.exists()) throw new Error("Cartão da compra não encontrado.");
    if (amountCents > Number(purchase.amountCents || 0)) throw new Error("O estorno não pode exceder o valor da parcela.");
    const invoice = convert(invoiceSnapshot), card = convert(cardSnapshot), adjustmentsTotalCents = Number(invoice.adjustmentsTotalCents || 0) - amountCents,
      totals = Engine.invoiceTotals({ ...invoice, adjustmentsTotalCents }), adjustment = {
        id: opId,
        ...baseMetadata(homeSpace, opId),
        cardHomeSpaceId,
        purchaseFinancialSpaceId: space.id,
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
        schemaVersion: 3,
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
        cardHomeSpaceId,
        creditCardInvoiceId: invoice.id,
        sourceType: "credit_card_refund",
        sourceId: opId,
        createdAt,
        schemaVersion: 2,
      });
    transaction.update(invoiceRef, clean({
      ...totals,
      adjustmentsTotalCents,
      spaceTotals: Engine.adjustDimensionTotal(invoice.spaceTotals, purchase.financialSpaceId || space.id, -amountCents),
      categoryTotals: Engine.adjustDimensionTotal(invoice.categoryTotals, purchase.categoryId || "default_other", -amountCents),
      projectionVersion: 1,
      status: Engine.deriveCreditCardInvoiceStatus({ ...invoice, ...totals }),
      updatedAt: createdAt,
    }));
    transaction.update(cardRef, clean({ committedCents: Math.max(0, Number(card.committedCents ?? Engine.invoiceTotals(invoice).remainingCents) - amountCents), updatedAt: createdAt }));
    transaction.set(adjustmentRef, clean(adjustment));
    if (!entrySnapshot.exists()) transaction.set(entryRef, clean({ ...baseMetadata(space, opId), ...entry, createdAt, updatedAt: createdAt, schemaVersion: 2 }));
    transaction.set(eventRef, clean({
      id: opId,
      ...baseMetadata(space, opId),
      entryId: opId,
      creditCardId: purchase.creditCardId,
      cardHomeSpaceId,
      creditCardInvoiceId: invoice.id,
      creditCardPurchaseId: purchase.id,
      eventKind: "credit_card_purchase_refunded",
      transition: "refunded",
      status: "applied",
      amountCents,
      createdAt,
      schemaVersion: 3,
    }));
    return { adjustment, invoice: { ...invoice, ...totals, adjustmentsTotalCents }, retried: false };
  });
  emit("financial-data-changed", { entity: "creditCardAdjustment", id: opId, spaceId: space.id });
  return result;
}

async function markPaid(spaceId, entry, input = {}) {
  const space = assertSpace(spaceId);
  if (!entry?.id) throw new Error("Escolha uma conta para registrar o pagamento.");
  const method = String(input.paymentMethod || "other");
  if (method === "credit_card") throw new Error("Selecione o cartão de crédito e a fatura antes de confirmar.");
  if (!["cash", "pix", "debit_card", "automatic_debit", "transfer", "other"].includes(method))
    throw new Error("Escolha uma forma de pagamento válida.");
  const paidAt = input.paidAt || now(), opId = String(input.operationId || operationId(`payment_${entry.id}`)), entryRef = childRef(space.id, "entries", entry.id),
    eventRef = childRef(space.id, "events", opId), result = await runTransaction(db, async (transaction) => {
      const snapshot = await transaction.get(entryRef);
      if (!snapshot.exists()) throw new Error("Conta não encontrada.");
      const current = convert(snapshot);
      if (["cancelled", "reversed"].includes(current.status)) throw new Error("Esta conta não pode ser paga.");
      if (current.status === "paid") return current;
      const financialAccountId = requiredText(input.financialAccountId || current.financialAccountId, "a conta ou carteira de origem", 120),
        accountRef = childRef(space.id, "financialAccounts", financialAccountId), accountSnapshot = await transaction.get(accountRef);
      if (!accountSnapshot.exists() || convert(accountSnapshot).active === false) throw new Error("A conta de origem não está disponível.");
      const patch = {
        status: "paid",
        paidAt,
        occurredAt: paidAt,
        sortAt: paidAt,
        periodKey: Engine.periodKey(paidAt),
        paymentMethod: method,
        paymentType: method,
        cashFlowEffect: true,
        expenseRecognized: true,
        financialAccountId,
        paymentOperationId: opId,
        notes: String(input.notes || current.notes || "").slice(0, 500),
        updatedAt: paidAt,
      };
      transaction.update(entryRef, clean(patch));
      transaction.update(accountRef, clean(accountBalancePatch(convert(accountSnapshot), current.direction === "in" ? current.amountCents : -current.amountCents, paidAt, opId)));
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

async function undoEntryPayment(spaceId, entry, reason = "Registro de pagamento desfeito") {
  const space = assertSpace(spaceId);
  if (!entry?.id) throw new Error("Escolha o pagamento que deseja desfazer.");
  const entryRef = childRef(space.id, "entries", entry.id), initial = convert(await getDoc(entryRef));
  if (!initial) throw new Error("Conta não encontrada.");
  const previousOperationId = String(initial.paymentOperationId || ""), opId = `undo_${previousOperationId || initial.id}`,
    eventRef = childRef(space.id, "events", opId), undoneAt = now(), isCanonicalCardPayment = initial.paymentMethod === "credit_card"
      && initial.creditCardId && initial.cardHomeSpaceId && initial.creditCardInvoiceId && initial.creditCardPurchaseId;
  const reopenPatch = {
    status: "pending",
    paidAt: null,
    occurredAt: null,
    sortAt: initial.dueAt,
    periodKey: initial.duePeriodKey || Engine.periodKey(initial.dueAt),
    paymentMethod: null,
    paymentType: null,
    financialAccountId: null,
    cashFlowEffect: true,
    expenseRecognized: true,
    paymentOperationId: null,
    creditCardId: null,
    cardHomeSpaceId: null,
    creditCardInvoiceId: null,
    creditCardPurchaseId: null,
    creditCardFeePurchaseId: null,
    creditCardFeeEntryId: null,
    billAmountCents: null,
    feeAmountCents: null,
    cardChargedAmountCents: null,
    settlementType: null,
    paymentUndoneAt: undoneAt,
    paymentUndoReason: String(reason || "Registro de pagamento desfeito").slice(0, 300),
    updatedAt: undoneAt,
  };
  if (!isCanonicalCardPayment) {
    const result = await runTransaction(db, async (transaction) => {
      const currentSnapshot = await transaction.get(entryRef), eventSnapshot = await transaction.get(eventRef);
      if (!currentSnapshot.exists()) throw new Error("Conta não encontrada.");
      const current = convert(currentSnapshot);
      if (eventSnapshot.exists() && current.status === "pending") return { entry: current, retried: true, legacy: current.paymentMethod === "credit_card" };
      if (current.status !== "paid") throw new Error("Somente pagamentos realizados podem ser desfeitos.");
      const accountRef = current.financialAccountId ? childRef(space.id, "financialAccounts", current.financialAccountId) : null,
        accountSnapshot = accountRef ? await transaction.get(accountRef) : null;
      if (accountRef && (!accountSnapshot.exists() || convert(accountSnapshot).active === false)) throw new Error("A conta vinculada ao pagamento não está disponível.");
      transaction.update(entryRef, clean(reopenPatch));
      if (accountRef) transaction.update(accountRef, clean(accountBalancePatch(convert(accountSnapshot), current.direction === "in" ? -current.amountCents : current.amountCents, undoneAt, opId)));
      transaction.set(eventRef, clean({
        id: opId,
        ...baseMetadata(space, opId),
        entryId: current.id,
        previousPaymentOperationId: previousOperationId || null,
        previousPaymentMethod: current.paymentMethod || null,
        eventKind: "account_payment_undone",
        transition: "reopened",
        status: "applied",
        amountCents: current.amountCents,
        reason: reopenPatch.paymentUndoReason,
        createdAt: undoneAt,
        schemaVersion: 4,
      }));
      return { entry: { ...current, ...reopenPatch }, retried: false, legacy: current.paymentMethod === "credit_card" };
    });
    emit("financial-data-changed", { entity: "entry", id: entry.id, action: "payment_undone", spaceId });
    return result;
  }
  const cardHomeSpaceId = initial.cardHomeSpaceId, homeSpace = assertSpace(cardHomeSpaceId),
    invoiceRef = childRef(cardHomeSpaceId, "creditCardInvoices", initial.creditCardInvoiceId), cardRef = childRef(cardHomeSpaceId, "creditCards", initial.creditCardId),
    billPurchaseRef = childRef(space.id, "creditCardPurchases", initial.creditCardPurchaseId),
    feePurchaseRef = initial.creditCardFeePurchaseId ? childRef(space.id, "creditCardPurchases", initial.creditCardFeePurchaseId) : null,
    feeEntryRef = initial.creditCardFeeEntryId ? childRef(space.id, "entries", initial.creditCardFeeEntryId) : null,
    adjustmentRef = childRef(cardHomeSpaceId, "creditCardAdjustments", opId);
  const result = await runTransaction(db, async (transaction) => {
    const currentSnapshot = await transaction.get(entryRef), invoiceSnapshot = await transaction.get(invoiceRef), cardSnapshot = await transaction.get(cardRef),
      billPurchaseSnapshot = await transaction.get(billPurchaseRef), feePurchaseSnapshot = feePurchaseRef ? await transaction.get(feePurchaseRef) : null,
      feeEntrySnapshot = feeEntryRef ? await transaction.get(feeEntryRef) : null, adjustmentSnapshot = await transaction.get(adjustmentRef),
      eventSnapshot = await transaction.get(eventRef);
    if (!currentSnapshot.exists() || !invoiceSnapshot.exists() || !cardSnapshot.exists() || !billPurchaseSnapshot.exists())
      throw new Error("Não foi possível localizar todos os vínculos do pagamento no cartão.");
    const current = convert(currentSnapshot), invoice = convert(invoiceSnapshot), card = convert(cardSnapshot);
    if (eventSnapshot.exists() && current.status === "pending") return { entry: current, invoice, retried: true };
    if (current.status !== "paid" || current.paymentOperationId !== previousOperationId)
      throw new Error("Este pagamento já foi alterado. Atualize a tela.");
    if (Number(invoice.paidTotalCents || 0) > 0)
      throw new Error("A fatura já recebeu pagamento. Registre um estorno real ou ajuste a fatura antes de reabrir esta conta.");
    const billAmountCents = Number(current.billAmountCents || current.amountCents), feeAmountCents = Number(current.feeAmountCents || 0),
      totalCardAmountCents = billAmountCents + feeAmountCents, adjustmentsTotalCents = Number(invoice.adjustmentsTotalCents || 0) - totalCardAmountCents,
      totals = Engine.invoiceTotals({ ...invoice, adjustmentsTotalCents }), feeCategory = Engine.creditCardBillFeeCategory(space.type),
      categoryTotalsWithBill = Engine.adjustDimensionTotal(invoice.categoryTotals, current.categoryId || "default_other", -billAmountCents),
      categoryTotals = feeAmountCents ? Engine.adjustDimensionTotal(categoryTotalsWithBill, feeCategory.categoryId, -feeAmountCents) : categoryTotalsWithBill,
      adjustment = {
        id: opId,
        ...baseMetadata(homeSpace, opId),
        cardHomeSpaceId,
        purchaseFinancialSpaceId: space.id,
        creditCardInvoiceId: invoice.id,
        creditCardId: current.creditCardId,
        creditCardPurchaseId: current.creditCardPurchaseId,
        relatedBillEntryId: current.id,
        kind: "bill_payment_void",
        amountCents: totalCardAmountCents,
        effectCents: -totalCardAmountCents,
        reason: reopenPatch.paymentUndoReason,
        occurredAt: undoneAt,
        status: "confirmed",
        createdAt: undoneAt,
        schemaVersion: 4,
      };
    transaction.update(invoiceRef, clean({
      ...totals,
      adjustmentsTotalCents,
      spaceTotals: Engine.adjustDimensionTotal(invoice.spaceTotals, space.id, -totalCardAmountCents),
      categoryTotals,
      status: Engine.deriveCreditCardInvoiceStatus({ ...invoice, ...totals }),
      updatedAt: undoneAt,
    }));
    transaction.update(cardRef, clean({ committedCents: Math.max(0, Number(card.committedCents || 0) - totalCardAmountCents), updatedAt: undoneAt }));
    transaction.update(billPurchaseRef, clean({ status: "voided", voidedAt: undoneAt, voidedByOperationId: opId, updatedAt: undoneAt }));
    if (feePurchaseSnapshot?.exists()) transaction.update(feePurchaseRef, clean({ status: "voided", voidedAt: undoneAt, voidedByOperationId: opId, updatedAt: undoneAt }));
    if (feeEntrySnapshot?.exists()) transaction.update(feeEntryRef, clean({ status: "reversed", expenseRecognized: false, reversedAt: undoneAt, reversedByOperationId: opId, updatedAt: undoneAt }));
    if (!adjustmentSnapshot.exists()) transaction.set(adjustmentRef, clean(adjustment));
    transaction.update(entryRef, clean(reopenPatch));
    transaction.set(eventRef, clean({
      id: opId,
      ...baseMetadata(space, opId),
      entryId: current.id,
      previousPaymentOperationId,
      creditCardId: current.creditCardId,
      cardHomeSpaceId,
      creditCardInvoiceId: invoice.id,
      creditCardPurchaseId: current.creditCardPurchaseId,
      eventKind: "credit_card_bill_payment_undone",
      transition: "reopened_and_invoice_credited",
      status: "applied",
      amountCents: billAmountCents,
      feeAmountCents,
      cardCreditCents: totalCardAmountCents,
      cashFlowEffectCents: 0,
      reason: reopenPatch.paymentUndoReason,
      createdAt: undoneAt,
      schemaVersion: 4,
    }));
    return { entry: { ...current, ...reopenPatch }, invoice: { ...invoice, ...totals, adjustmentsTotalCents }, adjustment, retried: false };
  });
  emit("financial-data-changed", { entity: "entry", id: entry.id, action: "credit_card_payment_undone", spaceId });
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
  // A correção de uma conta paga não é uma entrada financeira. Contas e despesas
  // voltam a ficar pendentes; estornos econômicos reais (recebimentos/compras)
  // continuam nos fluxos específicos que geram contrapartida auditável.
  if (entry?.direction === "out" && (entry?.sourceType === "expense" || entry?.recurrenceId || entry?.entryType === "expense"))
    return undoEntryPayment(spaceId, entry, reason || "Registro de pagamento desfeito");
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
    financialAccountId: entry.financialAccountId || null,
    notes: String(reason).slice(0, 300),
  }), entryRef = childRef(space.id, "entries", entry.id), reversalRef = childRef(space.id, "entries", id), eventRef = childRef(space.id, "events", opId),
    result = await runTransaction(db, async (transaction) => {
      const [currentSnapshot, reversalSnapshot] = await Promise.all([transaction.get(entryRef), transaction.get(reversalRef)]);
      if (reversalSnapshot.exists()) return convert(reversalSnapshot);
      if (!currentSnapshot.exists()) throw new Error("Lançamento não encontrado.");
      const current = convert(currentSnapshot);
      if (current.status !== "paid") throw new Error("Somente lançamentos realizados podem ser estornados.");
      const accountRef = current.financialAccountId ? childRef(space.id, "financialAccounts", current.financialAccountId) : null,
        accountSnapshot = accountRef ? await transaction.get(accountRef) : null;
      if (accountRef && (!accountSnapshot.exists() || convert(accountSnapshot).active === false)) throw new Error("A conta vinculada ao lançamento não está disponível.");
      const value = { ...baseMetadata(space, opId), ...reversal, amountCents: current.amountCents, financialAccountId: current.financialAccountId || null, createdAt: reversedAt, updatedAt: reversedAt };
      transaction.set(reversalRef, clean(value));
      transaction.update(entryRef, { reversedByEntryId: id, reversedAt, updatedAt: reversedAt });
      if (accountRef) transaction.update(accountRef, clean(accountBalancePatch(convert(accountSnapshot), current.direction === "in" ? -current.amountCents : current.amountCents, reversedAt, opId)));
      transaction.set(eventRef, clean({ id: opId, ...baseMetadata(space, opId), entryId: current.id, reversalEntryId: id, eventKind: "entry_reversed", transition: "reversed", status: "applied", amountCents: current.amountCents, createdAt: reversedAt }));
      return value;
    });
  emit("financial-data-changed", { entity: "entry", id: entry.id, action: "reversed", spaceId });
  return result;
}

async function createTransfer(fromSpaceId, toSpaceId, input = {}) {
  const from = assertSpace(fromSpaceId), to = assertSpace(toSpaceId), amountCents = Number(input.amountCents),
    transferId = String(input.transferId || operationId("transfer")), at = input.occurredAt || now(), transferRef = doc(db, "financialTransfers", transferId),
    fromFinancialAccountId = String(input.fromFinancialAccountId || "").trim(), toFinancialAccountId = String(input.toFinancialAccountId || "").trim(),
    common = { transferId, amountCents, status: "paid", occurredAt: at, paidAt: at, dueAt: at, paymentMethod: "transfer", sourceType: "transfer", sourceId: transferId, categoryId: "default_transfer", categoryName: "Transferência", cashFlowEffect: false, expenseRecognized: false },
    out = Engine.normalizeEntry({ ...common, id: `${transferId}_out`, operationId: `${transferId}:out`, direction: "out", entryType: "transfer_out", description: input.description || `Transferência para ${to.name}` }),
    incoming = Engine.normalizeEntry({ ...common, id: `${transferId}_in`, operationId: `${transferId}:in`, direction: "in", entryType: "transfer_in", description: input.description || `Transferência de ${from.name}` });
  if (!Number.isInteger(amountCents) || amountCents <= 0) throw new Error("Informe um valor válido para transferir.");
  if (!fromFinancialAccountId || !toFinancialAccountId) throw new Error("Escolha as contas de origem e destino.");
  if (fromSpaceId === toSpaceId && (!fromFinancialAccountId || !toFinancialAccountId || fromFinancialAccountId === toFinancialAccountId))
    throw new Error("Escolha contas diferentes para a transferência.");
  const created = await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(transferRef), fromAccountSnapshot = fromFinancialAccountId
      ? await transaction.get(childRef(from.id, "financialAccounts", fromFinancialAccountId)) : null,
      toAccountSnapshot = toFinancialAccountId ? await transaction.get(childRef(to.id, "financialAccounts", toFinancialAccountId)) : null;
    if (snapshot.exists()) return false;
    if (fromAccountSnapshot && (!fromAccountSnapshot.exists() || convert(fromAccountSnapshot).active === false)) throw new Error("A conta de origem não está disponível.");
    if (toAccountSnapshot && (!toAccountSnapshot.exists() || convert(toAccountSnapshot).active === false)) throw new Error("A conta de destino não está disponível.");
    transaction.set(transferRef, clean({ id: transferId, operationId: transferId, fromSpaceId, toSpaceId, fromFinancialAccountId: fromFinancialAccountId || null, toFinancialAccountId: toFinancialAccountId || null, amountCents, description: String(input.description || "Transferência"), createdBy: uid(), status: "completed", occurredAt: at, createdAt: at, updatedAt: at, schemaVersion: 2 }));
    transaction.set(childRef(from.id, "entries", out.id), clean({ ...baseMetadata(from, out.operationId), ...out, financialAccountId: fromFinancialAccountId || null, transferCounterpartyAccountId: toFinancialAccountId || null, createdAt: at, updatedAt: at }));
    transaction.set(childRef(to.id, "entries", incoming.id), clean({ ...baseMetadata(to, incoming.operationId), ...incoming, financialAccountId: toFinancialAccountId || null, transferCounterpartyAccountId: fromFinancialAccountId || null, createdAt: at, updatedAt: at }));
    if (fromAccountSnapshot) transaction.update(fromAccountSnapshot.ref, clean(accountBalancePatch(convert(fromAccountSnapshot), -amountCents, at, `${transferId}:out`)));
    if (toAccountSnapshot) transaction.update(toAccountSnapshot.ref, clean(accountBalancePatch(convert(toAccountSnapshot), amountCents, at, `${transferId}:in`)));
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

async function loadCreditOverview(spaceId, selectedPeriod = Engine.periodKey(), options = {}) {
  const trace = typeof options.trace === "function" ? options.trace : () => {}, financialAccounts = options.financialAccounts || [];
  trace("FINANCE_CARDS_START");
  const creditCards = await listCreditCards(spaceId);
  trace("FINANCE_CARDS_DONE", { count: creditCards.length });
  trace("FINANCE_INVOICES_START");
  const invoiceValues = await listCreditCardInvoices(spaceId, { cards: creditCards }), invoices = invoiceValues.map((invoice) => ({
    ...invoice,
    ...Engine.invoiceTotals(invoice),
    status: Engine.deriveCreditCardInvoiceStatus(invoice),
  })), selectedInvoices = invoices.filter((invoice) => invoice.referenceKey === selectedPeriod),
    duePeriodInvoices = invoices.filter((invoice) => Engine.periodKey(invoice.dueDate) === selectedPeriod),
    cardSummaries = creditCards.map((card) => {
      const cardInvoices = invoices.filter((invoice) => invoice.creditCardId === card.id && invoice.cardHomeSpaceId === card.cardHomeSpaceId && invoice.status !== "cancelled"),
        committedCents = Number.isInteger(card.committedCents) ? card.committedCents : Engine.creditCardCommitment(cardInvoices),
        spaceCommittedCents = cardInvoices.reduce((sum, invoice) => sum + Number(invoice.spaceTotals?.[spaceId] || (card.cardHomeSpaceId === spaceId && !invoice.spaceTotals ? Engine.invoiceTotals(invoice).remainingCents : 0)), 0),
        cycleInvoice = cardInvoices.find((invoice) => invoice.referenceKey === selectedPeriod) || null;
      return {
        ...card,
        committedCents,
        spaceCommittedCents,
        availableCents: Math.max(0, Number(card.limitCents || 0) - committedCents),
        currentInvoice: cycleInvoice ? { ...cycleInvoice, currentSpaceAmountCents: Number(cycleInvoice.spaceTotals?.[spaceId] || (card.cardHomeSpaceId === spaceId && !cycleInvoice.spaceTotals ? cycleInvoice.remainingCents : 0)) } : null,
      };
    }), invoicePayables = duePeriodInvoices.filter((invoice) => invoice.cardHomeSpaceId === spaceId && invoice.remainingCents > 0 && invoice.status !== "cancelled").map((invoice) => ({
      id: `invoice:${invoice.id}`,
      creditCardInvoiceId: invoice.id,
      creditCardId: invoice.creditCardId,
      cardHomeSpaceId: invoice.cardHomeSpaceId,
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
  trace("FINANCE_INVOICES_DONE", { count: invoices.length });
  return {
    financialAccounts,
    creditCards: cardSummaries,
    creditCardInvoices: invoices,
    selectedCreditCardInvoices: selectedInvoices,
    invoicePayables,
    creditCommittedCents: cardSummaries.reduce((sum, card) => sum + card.spaceCommittedCents, 0),
    futureInvoices: invoices.filter((invoice) => invoice.remainingCents > 0 && invoice.status !== "cancelled")
      .sort((left, right) => (Engine.localDate(left.dueDate)?.getTime() || Infinity) - (Engine.localDate(right.dueDate)?.getTime() || Infinity)),
  };
}

const emptyCreditOverview = (financialAccounts = [], error = "") => ({
  financialAccounts,
  creditCards: [],
  creditCardInvoices: [],
  selectedCreditCardInvoices: [],
  invoicePayables: [],
  creditCommittedCents: 0,
  futureInvoices: [],
  creditLoadError: error,
});

function composeDashboard(space, selectedPeriod, month, accounts, categories, categoryMigration, credit) {
  const allAccounts = [...accounts, ...credit.invoicePayables], payables = Engine.sortPayables(allAccounts), latest = month.filter((entry) => entry.status === "paid" && !entry.reversedByEntryId)
    .sort((left, right) => (Engine.localDate(right.occurredAt)?.getTime() || 0) - (Engine.localDate(left.occurredAt)?.getTime() || 0)),
    summary = Engine.summarize(month), accountSummary = Engine.summarize(allAccounts),
    selectedInvoices = credit.selectedCreditCardInvoices || [], pendingAccounts = payables.filter((entry) => entry.entityType !== "credit_card_invoice");
  return {
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
      pendingAccountsCents: pendingAccounts.reduce((sum, entry) => sum + Number(entry.amountCents || 0), 0),
      availableBalanceCents: Engine.availableBalance(credit.financialAccounts || []),
      invoiceTotalCents: selectedInvoices.reduce((sum, invoice) => sum + Number(invoice.amountDueCents || 0), 0),
      pendingCount: payables.filter((entry) => entry.direction === "out").length,
      dueSoonCount: accountSummary.dueSoonCount,
      migratedCategories: categoryMigration.migrated,
      manualReviewCategories: categoryMigration.manualReview,
    },
    ...credit,
  };
}

async function loadDashboard(spaceId, selectedPeriod = Engine.periodKey(), options = {}) {
  const space = assertSpace(spaceId), started = performance.now(), trace = typeof options.trace === "function" ? options.trace : () => {};
  trace("FINANCE_ENTRIES_START");
  const monthPromise = monthEntries(space.id, selectedPeriod).then((items) => {
    trace("FINANCE_ENTRIES_DONE", { count: items.length });
    return items;
  });
  trace("FINANCE_ACCOUNTS_START");
  const accountsPromise = Promise.all([
    dueMonthEntries(space.id, selectedPeriod),
    listFinancialAccounts(space.id),
  ]).then(([items, financialAccounts]) => {
    trace("FINANCE_ACCOUNTS_DONE", { count: items.length, financialAccountCount: financialAccounts.length });
    return { items, financialAccounts };
  });
  const [month, accountData, categories] = await Promise.all([
    monthPromise,
    accountsPromise,
    listCategories(space.id),
  ]), accounts = accountData.items, categoryMigration = await migrateLegacyCategories(space, [month, accounts]);
  trace("FINANCE_RECURRING_START", { deferred: true });
  trace("FINANCE_RECURRING_DONE", { deferred: true });
  trace("FINANCE_SUMMARY_START");
  const core = composeDashboard(space, selectedPeriod, month, accounts, categories, categoryMigration, emptyCreditOverview(accountData.financialAccounts));
  trace("FINANCE_SUMMARY_DONE", { entryCount: month.length, payableCount: core.payables.length });
  options.onCore?.(core);
  let credit;
  try {
    credit = await Promise.race([
      loadCreditOverview(space.id, selectedPeriod, { financialAccounts: accountData.financialAccounts, trace }),
      new Promise((_, reject) => setTimeout(() => reject(Object.assign(new Error("Tempo limite ao carregar cartões."), { code: "deadline-exceeded" })), 12_000)),
    ]);
  } catch (error) {
    console.error("[FINANCE_CREDIT_ERROR]", { code: error?.code || "unknown", message: error?.message || "credit-load-failed" });
    credit = emptyCreditOverview(accountData.financialAccounts, error?.code || "unknown");
  }
  const result = composeDashboard(space, selectedPeriod, month, accounts, categories, categoryMigration, credit);
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
    withSpace = (items, dashboard) => (items || []).map((item) => ({ ...item, financialSpaceId: item.financialSpaceId || dashboard.space.id, financialSpaceName: dashboard.space.name })),
    uniqueBy = (items, keyOf) => [...new Map(items.map((item) => [keyOf(item), item])).values()],
    creditCards = uniqueBy(dashboards.flatMap((dashboard) => withSpace(dashboard.creditCards, dashboard)), (card) => `${card.cardHomeSpaceId}:${card.id}`)
      .map((card) => ({ ...card, spaceCommittedCents: card.committedCents })),
    creditCardInvoices = uniqueBy(dashboards.flatMap((dashboard) => withSpace(dashboard.creditCardInvoices, dashboard)), (invoice) => `${invoice.cardHomeSpaceId}:${invoice.id}`),
    futureInvoices = uniqueBy(dashboards.flatMap((dashboard) => withSpace(dashboard.futureInvoices, dashboard)), (invoice) => `${invoice.cardHomeSpaceId}:${invoice.id}`)
      .sort((left, right) => (Engine.localDate(left.dueDate)?.getTime() || Infinity) - (Engine.localDate(right.dueDate)?.getTime() || Infinity)),
    selectedCreditCardInvoices = uniqueBy(dashboards.flatMap((dashboard) => withSpace(dashboard.selectedCreditCardInvoices, dashboard)), (invoice) => `${invoice.cardHomeSpaceId}:${invoice.id}`),
    financialAccounts = dashboards.flatMap((dashboard) => withSpace(dashboard.financialAccounts, dashboard));
  const consolidated = Engine.consolidate(dashboards), pendingAccounts = (consolidated.payables || []).filter((entry) => entry.entityType !== "credit_card_invoice"),
    result = {
    consolidated: true,
    selectedIds: selected,
    spaces: dashboards.map((item) => item.space),
    ...consolidated,
    financialAccounts,
    creditCards,
    creditCardInvoices,
    selectedCreditCardInvoices,
    futureInvoices,
    creditCommittedCents: creditCards.reduce((sum, card) => sum + Number(card.committedCents || 0), 0),
    spaceSummaries: dashboards.map((dashboard) => ({ financialSpaceId: dashboard.space.id, financialSpaceName: dashboard.space.name, financialSpaceIcon: dashboard.space.icon || "wallet", financialSpaceType: dashboard.space.type, ...dashboard.summary })),
    summary: {
      ...consolidated.summary,
      availableBalanceCents: Engine.availableBalance(financialAccounts),
      invoiceTotalCents: selectedCreditCardInvoices.reduce((sum, invoice) => sum + Number(invoice.amountDueCents || 0), 0),
      pendingAccountsCents: pendingAccounts.reduce((sum, entry) => sum + Number(entry.amountCents || 0), 0),
      pendingPayablesCents: (consolidated.payables || []).reduce((sum, entry) => sum + Number(entry.amountCents || 0), 0),
    },
  };
  state.lastReadStats = {
    operation: "loadConsolidated",
    spaces: selected.length,
    documents: result.entries.length + result.accounts.length + financialAccounts.length + creditCardInvoices.length + creditCards.length,
    limits: { spaces: selected.length, monthPerSpace: MAX_MONTH_ENTRIES, accountsPerSpace: MAX_MONTH_ENTRIES, financialAccountsPerSpace: MAX_FINANCIAL_ACCOUNTS, cardsPerSpace: MAX_CREDIT_CARDS, invoicesPerSpace: MAX_CREDIT_INVOICES },
    at: now(),
  };
  return result;
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
  listFinancialViews,
  saveFinancialView,
  deleteFinancialView,
  setDefaultFinancialView,
  toggleFavoriteFinancialView,
  rememberFinancialView,
  createSpace,
  updateAutomation,
  automationState,
  reconcileBusinessIncome,
  archiveSpace,
  listCategories,
  createCategory,
  listFinancialAccounts,
  createFinancialAccount,
  adjustFinancialAccountBalance,
  listCreditCards,
  createCreditCard,
  updateCreditCard,
  rebuildCreditCardInvoiceProjections,
  canShareCreditCards: (spaceId) => assertSpace(spaceId).ownerUid === uid(),
  listCreditCardInvoices,
  ensureCreditCardInvoice,
  loadCreditOverview,
  getCreditCardInvoiceDetails,
  createCreditCardPurchase,
  resolveCreditCardInvoice,
  payEntryByCreditCard,
  createOngoingCreditCardInstallment,
  adjustCreditCardInvoice,
  payCreditCardInvoice,
  refundCreditCardPurchase,
  migrateLegacyCategories,
  createEntry,
  updatePendingEntry,
  markPaid,
  undoEntryPayment,
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
