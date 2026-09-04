import { auth, db, app } from "./firebase-config.js";
import {
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
  MAX_PAYABLES = 100,
  MAX_LATEST = 20,
  state = {
    spaces: [],
    loadedForUid: "",
    selectedId: "",
    loading: false,
    spacesLoadedAt: 0,
    lastReadStats: null,
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

async function listSpaces(options = {}) {
  const currentUid = uid(), currentBusinessId = businessId();
  if (state.loadedForUid !== currentUid) loadCachedSpaces();
  if (!options.force && state.loadedForUid === currentUid && state.spaces.length && Date.now() - state.spacesLoadedAt < 60_000)
    return listCachedSpaces();
  if (options.cacheOnly || !navigator.onLine) return listCachedSpaces();
  state.loading = true;
  try {
    const spaces = collection(db, "financialSpaces"), queries = [
      getDocs(query(
        spaces,
        where("ownerUid", "==", currentUid),
        where("type", "==", "personal"),
        where("active", "==", true),
        limit(100),
      )),
      getDocs(query(
        spaces,
        where("ownerUid", "==", currentUid),
        where("type", "==", "other"),
        where("active", "==", true),
        limit(100),
      )),
    ];
    if (currentBusinessId)
      queries.push(getDocs(query(
        spaces,
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
  for (const item of [...Engine.defaultCategories(space.type), ...custom]) map.set(item.id, item);
  return [...map.values()];
}

async function createCategory(spaceId, input = {}) {
  const space = assertSpace(spaceId), name = String(input.name || "").trim();
  if (!name) throw new Error("Informe o nome da categoria.");
  const id = String(input.id || crypto.randomUUID()), opId = operationId("category"), value = {
    id,
    ...baseMetadata(space, opId),
    name: name.slice(0, 60),
    icon: String(input.icon || "shapes"),
    active: true,
    createdAt: now(),
    updatedAt: now(),
  };
  await setDoc(childRef(spaceId, "categories", id), { ...clean(value), createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
  emit("financial-data-changed", { entity: "category", id, spaceId });
  return value;
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
      direction: base.direction,
      entryType: base.entryType,
      nextDueAt: created[1]?.dueAt || Engine.addFrequency(base.dueAt, input.frequency).toISOString(),
      active: true,
      generatedThrough: created.at(-1)?.dueAt,
      createdAt: now(),
      updatedAt: now(),
    };
    await setDoc(childRef(space.id, "recurrences", recurrenceId), { ...clean(recurrence), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }, { merge: true });
  }
  return created;
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
    dueAt,
    sortAt: dueAt,
    periodKey: Engine.periodKey(dueAt),
    notes: String(input.notes ?? entry.notes ?? "").slice(0, 500),
    updatedAt: serverTimestamp(),
  };
  if (!patch.description || !Number.isInteger(patch.amountCents) || patch.amountCents <= 0) throw new Error("Revise a descrição e o valor da conta.");
  const batch = writeBatch(db);
  batch.update(childRef(space.id, "entries", entry.id), clean(patch));
  batch.set(childRef(space.id, "events", opId), clean({ id: opId, ...baseMetadata(space, opId), entryId: entry.id, eventKind: "pending_entry_edited", transition: "edited", status: "applied", previousAmountCents: entry.amountCents, amountCents: patch.amountCents, createdAt: now() }));
  await batch.commit();
  emit("financial-data-changed", { entity: "entry", id: entry.id, action: "edited", spaceId });
  return { ...entry, ...patch, updatedAt: now() };
}

async function cancelPendingEntry(spaceId, entry, reason = "") {
  const space = assertSpace(spaceId);
  const opId = `cancel_${entry.id}`, entryRef = childRef(space.id, "entries", entry.id), eventRef = childRef(space.id, "events", opId), cancelledAt = now();
  await runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(entryRef);
    if (!snapshot.exists()) throw new Error("Conta não encontrada.");
    const current = convert(snapshot);
    if (current.status === "cancelled") return current;
    if (current.status === "paid") throw new Error("Lançamentos pagos devem ser estornados, não excluídos.");
    transaction.update(entryRef, { status: "cancelled", cancelledAt, cancellationReason: String(reason).slice(0, 300), updatedAt: cancelledAt });
    transaction.set(eventRef, clean({ id: opId, ...baseMetadata(space, opId), entryId: current.id, eventKind: "entry_cancelled", transition: "cancelled", status: "applied", createdAt: cancelledAt }));
    return { ...current, status: "cancelled", cancelledAt };
  });
  emit("financial-data-changed", { entity: "entry", id: entry.id, action: "cancelled", spaceId });
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
async function pendingEntries(spaceId) {
  assertSpace(spaceId);
  const snapshot = await getDocs(query(
    childCollection(spaceId, "entries"),
    where("status", "==", "pending"),
    orderBy("dueAt", "asc"),
    limit(MAX_PAYABLES),
  ));
  return snapshot.docs.map(convert);
}
async function latestEntries(spaceId) {
  assertSpace(spaceId);
  const snapshot = await getDocs(query(
    childCollection(spaceId, "entries"),
    where("status", "==", "paid"),
    orderBy("occurredAt", "desc"),
    limit(MAX_LATEST),
  ));
  return snapshot.docs.map(convert).filter((entry) => !entry.reversedByEntryId);
}

async function loadDashboard(spaceId, selectedPeriod = Engine.periodKey()) {
  const space = assertSpace(spaceId), started = performance.now(), [month, pending, latest, categories] = await Promise.all([
    monthEntries(space.id, selectedPeriod),
    pendingEntries(space.id),
    latestEntries(space.id),
    listCategories(space.id),
  ]), byId = new Map();
  for (const entry of [...month, ...pending, ...latest]) byId.set(entry.id, entry);
  const summary = Engine.summarize(month), payables = Engine.sortPayables(pending), result = {
    space: structuredClone(space),
    periodKey: selectedPeriod,
    entries: month,
    latest: latest.slice(0, 10),
    payables: payables.slice(0, 20),
    categories,
    summary: {
      ...summary,
      pendingPayablesCents: payables.filter((entry) => entry.direction === "out").reduce((sum, entry) => sum + Number(entry.amountCents || 0), 0),
      pendingCount: payables.filter((entry) => entry.direction === "out").length,
      dueSoonCount: Engine.summarize(pending).dueSoonCount,
    },
  };
  state.lastReadStats = {
    operation: "loadDashboard",
    documents: month.length + pending.length + latest.length,
    limits: { month: MAX_MONTH_ENTRIES, payables: MAX_PAYABLES, latest: MAX_LATEST },
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
  const dashboards = await Promise.all(selected.map((id) => loadDashboard(id, selectedPeriod)));
  return { consolidated: true, selectedIds: selected, spaces: dashboards.map((item) => item.space), ...Engine.consolidate(dashboards) };
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

async function businessSpaceFor(sourceBusinessId) {
  let available = state.loadedForUid === auth.currentUser?.uid ? state.spaces : await listSpaces();
  let match = available.find((space) => space.type === "business" && space.linkedBusinessId === sourceBusinessId && space.active !== false) || null;
  if (!match) {
    available = await listSpaces({ force: true });
    match = available.find((space) => space.type === "business" && space.linkedBusinessId === sourceBusinessId && space.active !== false) || null;
  }
  return match;
}
const afterActivation = (space, date) => !space.autoEntryFromSalesSince || new Date(date) >= new Date(space.autoEntryFromSalesSince);
async function recordSale(sale = {}) {
  if (!auth.currentUser || !sale?.id || !sale.businessId) return { skipped: "context-missing" };
  const space = await businessSpaceFor(String(sale.businessId));
  if (!space) return { skipped: "space-missing" };
  if (!afterActivation(space, sale.data || sale.createdAt)) return { skipped: "before-activation" };
  const paid = String(sale.status) !== "fiado", id = `sale_${sale.id}`, amountCents = Math.round(Number(sale.valorFinal ?? sale.valorTotal ?? 0) * 100);
  if (amountCents <= 0) return { skipped: "zero-value" };
  const entry = Engine.normalizeEntry({
    id,
    operationId: id,
    direction: "in",
    entryType: paid ? "sale_income" : "account_receivable",
    amountCents,
    remainingCents: amountCents,
    description: `Venda · ${sale.clienteNome || "Venda avulsa"}`,
    categoryId: "default_sales",
    categoryName: "Vendas",
    status: paid ? "paid" : "pending",
    dueAt: sale.data || sale.createdAt,
    occurredAt: paid ? sale.data || sale.createdAt : null,
    paidAt: paid ? sale.data || sale.createdAt : null,
    sourceType: paid ? "sale" : "credit_sale",
    sourceId: sale.id,
    customerId: sale.clienteId || sale.customerId || null,
    paymentMethod: paid ? String(sale.formaPagamento || "other") : null,
  });
  await createEntries(space, [entry], "sale_recorded");
  return entry;
}
async function recordCreditPayment(payment = {}) {
  if (!auth.currentUser || !payment?.id || !payment.businessId) return { skipped: "context-missing" };
  const space = await businessSpaceFor(String(payment.businessId));
  if (!space) return { skipped: "space-missing" };
  if (!afterActivation(space, payment.data || payment.createdAt)) return { skipped: "before-activation" };
  // O saldo legado não vira receita retroativa. Além disso, uma alocação só
  // entra no caixa se a venda de origem já possui recebível neste espaço.
  const id = `credit_payment_${payment.id}`, paymentRef = childRef(space.id, "entries", id), eventRef = childRef(space.id, "events", id),
    allocations = (payment.allocations || []).filter((allocation) => allocation?.saleId && Number(allocation.amount) > 0), at = payment.data || payment.createdAt || now();
  const result = await runTransaction(db, async (transaction) => {
    const existing = await transaction.get(paymentRef);
    if (existing.exists()) return convert(existing);
    const matchedAllocations = [];
    for (const allocation of allocations) {
      const refEntry = childRef(space.id, "entries", `sale_${allocation.saleId}`), snapshot = await transaction.get(refEntry);
      if (!snapshot.exists()) continue;
      const current = convert(snapshot);
      if (current.status === "cancelled") continue;
      matchedAllocations.push({ allocation, refEntry, current });
    }
    const amountCents = matchedAllocations.reduce((sum, item) => sum + Math.round(Number(item.allocation.amount) * 100), 0);
    if (amountCents <= 0) return { skipped: "zero-value" };
    const entry = Engine.normalizeEntry({
      id,
      operationId: id,
      direction: "in",
      entryType: "credit_payment",
      amountCents,
      description: `Recebimento · ${payment.clienteNome || "Cliente"}`,
      categoryId: "default_receivables",
      categoryName: "Recebimentos",
      status: "paid",
      dueAt: at,
      occurredAt: at,
      paidAt: at,
      sourceType: "credit_payment",
      sourceId: payment.id,
      customerId: payment.clienteId || payment.clientId || null,
      paymentMethod: String(payment.paymentMethod || "other"),
      allocationSaleIds: matchedAllocations.map((item) => item.allocation.saleId),
    }), value = { ...baseMetadata(space, id), ...entry, createdAt: at, updatedAt: at };
    transaction.set(paymentRef, clean(value));
    transaction.set(eventRef, clean({ ...baseMetadata(space, id), id, entryId: id, eventKind: "credit_payment_recorded", transition: "created", status: "applied", amountCents, createdAt: at }));
    for (const { allocation, refEntry, current } of matchedAllocations) {
      const remaining = Math.max(0, Number(current.remainingCents ?? current.amountCents) - Math.round(Number(allocation.amount) * 100));
      transaction.update(refEntry, { remainingCents: remaining, receivableStatus: remaining ? "partial" : "settled", updatedAt: at });
    }
    return value;
  });
  if (!result?.skipped) emit("financial-data-changed", { entity: "entry", id, action: "credit-payment", spaceId: space.id });
  return result;
}
async function reverseSale(sale = {}) {
  if (!auth.currentUser || !sale?.id || !sale.businessId) return { skipped: "context-missing" };
  const space = await businessSpaceFor(String(sale.businessId));
  if (!space) return { skipped: "space-missing" };
  const originalRef = childRef(space.id, "entries", `sale_${sale.id}`), snapshot = await getDoc(originalRef);
  if (!snapshot.exists()) return { skipped: "entry-missing" };
  const original = convert(snapshot);
  if (original.status === "pending") {
    await updateDoc(originalRef, { status: "cancelled", cancelledAt: serverTimestamp(), updatedAt: serverTimestamp() });
    return { ...original, status: "cancelled" };
  }
  return reversePaidEntry(space.id, original, "Venda desfeita");
}

const FinancialSpaceService = {
  listSpaces,
  listCachedSpaces,
  selectedSpaceId,
  selectSpace,
  createSpace,
  archiveSpace,
  listCategories,
  createCategory,
  createEntry,
  updatePendingEntry,
  markPaid,
  cancelPendingEntry,
  reversePaidEntry,
  createTransfer,
  loadDashboard,
  loadConsolidated,
  selectedConsolidatedIds,
  setConsolidatedIds,
  uploadAttachment,
  recordSale,
  recordCreditPayment,
  reverseSale,
  getReadStats: () => state.lastReadStats ? structuredClone(state.lastReadStats) : null,
  limits: Object.freeze({ month: MAX_MONTH_ENTRIES, payables: MAX_PAYABLES, latest: MAX_LATEST }),
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
