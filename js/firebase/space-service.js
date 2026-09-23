import { auth, db } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  query,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { normalizeFirestoreData, sanitizeForFirestore } from "./firestore-utils.js";

const Engine = window.SpaceEngine;
const Context = window.SpaceContext;
if (!Engine || !Context)
  throw new Error("SpaceEngine e SpaceContext precisam ser carregados antes do serviço de espaços.");

const MAX_QUERY_RESULTS = 150;
const MIGRATION_BATCH_SIZE = 400;
const VALID_OPERATIONAL_TYPES = new Set(["unit", "operation", "personal", "other"]);
const MANAGER_ROLES = new Set(["owner", "admin", "manager"]);
const state = {
  contextKey: "",
  inFlight: null,
  sequence: 0,
  lastReadStats: null,
  lastMigrationReport: null,
};

const now = () => new Date().toISOString();
const clean = (value) => sanitizeForFirestore(value);
const clone = (value) => structuredClone(value);
const online = () => typeof navigator === "undefined" || navigator.onLine !== false;
const emit = (name, detail = {}) => dispatchEvent(new CustomEvent(name, { detail }));
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const contextKey = (context = currentContext()) => `${context.uid}:${context.businessId}`;
const requiredText = (value, label, max = 80) => {
  const text = String(value || "").trim();
  if (!text) throw new Error(`Informe ${label}.`);
  return text.slice(0, max);
};
const firestoreSpace = (snapshot) => normalizeFirestoreData({ id: snapshot.id, ...snapshot.data() });
const spaceRef = (spaceId) => doc(db, "financialSpaces", String(spaceId));

function currentContext() {
  const session = window.FirebaseSession || {}, businessContext = window.BusinessContext?.get?.() || {},
    user = auth.currentUser || session.user || null,
    businessId = String(businessContext.businessId || session.businessId || "").trim(),
    uid = String(user?.uid || session.profile?.uid || "").trim();
  return {
    uid,
    businessId,
    role: String(session.profile?.role || businessContext.role || "viewer"),
    businessName: String(businessContext.business?.name || session.business?.name || "Meu negócio").trim().slice(0, 80),
  };
}

function assertContext() {
  const context = currentContext();
  if (!context.uid) throw Object.assign(new Error("Usuário não autenticado."), { code: "unauthenticated" });
  if (!context.businessId) throw new Error("Nenhuma empresa ativa.");
  return context;
}

function capabilities(input = {}, fallback = {}) {
  const source = input && typeof input === "object" ? input : {}, base = fallback && typeof fallback === "object" ? fallback : {};
  return {
    finance: source.finance !== undefined ? source.finance === true : base.finance === true,
    sales: source.sales !== undefined ? source.sales === true : base.sales === true,
    products: source.products !== undefined ? source.products === true : base.products === true,
    inventory: source.inventory !== undefined ? source.inventory === true : base.inventory === true,
    goals: source.goals !== undefined ? source.goals === true : base.goals === true,
  };
}

function migrationPatch(raw, context) {
  const fields = Engine.globalFields(raw, context), patch = {};
  fields.globalSpaceSchemaVersion = Math.max(Engine.SPACE_SCHEMA_VERSION, Number(raw.globalSpaceSchemaVersion || 0));
  for (const [key, value] of Object.entries(fields))
    if (!same(raw[key], value)) patch[key] = value;
  return patch;
}

async function commitMigrationPatches(rows) {
  for (let offset = 0; offset < rows.length; offset += MIGRATION_BATCH_SIZE) {
    const batch = writeBatch(db);
    for (const row of rows.slice(offset, offset + MIGRATION_BATCH_SIZE))
      batch.update(spaceRef(row.id), clean(row.patch));
    await batch.commit();
  }
}

async function readRemoteSpaces(context) {
  const access=window.BusinessContext?.get?.()||{},restricted=access.spaceAccess!=="all",allowedIds=[...new Set(access.allowedSpaceIds||[])];
  if(restricted){
    const settled=await Promise.allSettled(allowedIds.map(id=>getDoc(spaceRef(id)))),spaces=[],errors=[];
    settled.forEach((result,index)=>{if(result.status==='rejected'){errors.push({query:`allowed:${allowedIds[index]}`,code:result.reason?.code||'unknown',message:result.reason?.message||String(result.reason)});return}if(result.value.exists()){const value=firestoreSpace(result.value);if(value.active!==false&&String(value.businessId||value.linkedBusinessId||'')===context.businessId)spaces.push(value)}});
    state.lastReadStats={at:now(),operation:'listAuthorizedSpaces',documents:spaces.length,uniqueDocuments:spaces.length,queries:allowedIds.length,querySizes:{authorized:spaces.length},errors:clone(errors)};
    return{spaces,errors,complete:errors.length===0,querySizes:{authorized:spaces.length}};
  }
  const source = collection(db, "financialSpaces"), requests = [
    {
      name: "business",
      promise: getDocs(query(
        source,
        where("linkedBusinessId", "==", context.businessId),
        where("type", "==", "business"),
        where("active", "==", true),
        limit(MAX_QUERY_RESULTS),
      )),
    },
    {
      name: "owner",
      promise: getDocs(query(
        source,
        where("ownerUid", "==", context.uid),
        where("type", "in", ["personal", "other"]),
        where("active", "==", true),
        limit(MAX_QUERY_RESULTS),
      )),
    },
  ], settled = await Promise.allSettled(requests.map((item) => item.promise)), map = new Map(), errors = [];
  let reads = 0;
  const querySizes = {};
  settled.forEach((result, index) => {
    if (result.status === "rejected") {
      errors.push({ query: requests[index].name, code: result.reason?.code || "unknown", message: result.reason?.message || String(result.reason) });
      return;
    }
    querySizes[requests[index].name] = result.value.size;
    if (result.value.metadata?.fromCache === true)
      errors.push({
        query: requests[index].name,
        code: "cache-only-result",
        message: "A consulta retornou somente dados do cache local.",
      });
    if (result.value.size === MAX_QUERY_RESULTS)
      errors.push({ query: requests[index].name, code: "result-limit-reached", message: "A consulta atingiu o limite seguro de documentos." });
    reads += result.value.size;
    for (const snapshot of result.value.docs) {
      const value = firestoreSpace(snapshot);
      if (value.active !== false) map.set(value.id, value);
    }
  });
  const spaces = [...map.values()].filter((raw) => {
    const legacyType = String(raw.legacyFinancialType || raw.type || "other"), linkedBusinessId = String(raw.linkedBusinessId || ""),
      assignedBusinessId = String(raw.businessId || "");
    if (legacyType === "business") return linkedBusinessId === context.businessId || (!linkedBusinessId && assignedBusinessId === context.businessId);
    return raw.ownerUid === context.uid && (!assignedBusinessId || assignedBusinessId === context.businessId);
  });
  state.lastReadStats = {
    at: now(),
    operation: "listGlobalSpaces",
    documents: reads,
    uniqueDocuments: spaces.length,
    queries: requests.length,
    querySizes,
    errors: clone(errors),
  };
  return { spaces, errors, complete: errors.length === 0, querySizes };
}

function defaultSpaceValue(context) {
  const createdAt = now(), id = `business_${context.businessId}`;
  return {
    id,
    ownerUid: context.uid,
    createdBy: context.uid,
    name: context.businessName || "Meu negócio",
    type: "business",
    linkedBusinessId: context.businessId,
    businessId: context.businessId,
    operationalType: "unit",
    active: true,
    status: "active",
    capabilities: { finance: true, sales: true, products: true, inventory: true, goals: true },
    isDefault: true,
    globalSpaceSchemaVersion: Engine.SPACE_SCHEMA_VERSION,
    automation: {
      enabled: true,
      linkedBusinessId: context.businessId,
      activatedAt: createdAt,
      autoIncome: { sales: true, customerPayments: true, onlineOrders: true },
    },
    autoIncomeSince: createdAt,
    autoEntryFromPaymentsSince: createdAt,
    autoEntryFromSalesSince: createdAt,
    currency: "BRL",
    schemaVersion: 1,
    createdAt,
    updatedAt: createdAt,
  };
}

function hasOperationalSalesSpace(spaces, context) {
  return spaces.some((raw) => {
    const space = Engine.normalizeSpace(raw, context);
    return space.businessId === context.businessId && space.status === "active" && space.capabilities.sales === true;
  });
}

async function ensureDefaultSpace(spaces, context) {
  if (hasOperationalSalesSpace(spaces, context)) return { spaces, created: false, reason: "sales-space-exists" };
  if (context.role !== "owner") return { spaces, created: false, reason: "owner-provisioning-required" };
  const value = defaultSpaceValue(context), reference = spaceRef(value.id);
  if (spaces.some((space) => space.id === value.id))
    return { spaces, created: false, reason: "deterministic-id-already-in-use" };
  try {
    await setDoc(reference, {
      ...clean(value),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    }, { merge: true });
    const next = new Map(spaces.map((space) => [space.id, space]));
    next.set(value.id, value);
    return { spaces: [...next.values()], created: true, reason: "created" };
  } catch (error) {
    console.error("[SpaceService] default space could not be ensured", { code: error?.code, message: error?.message });
    return { spaces, created: false, reason: "creation-failed", error };
  }
}

async function promoteAccessibleSpaces(spaces, context) {
  const rows = spaces.map((raw) => ({ id: raw.id, raw, patch: migrationPatch(raw, context) }))
    .filter((row) => Object.keys(row.patch).length > 0),
    report = {
      version: Engine.SPACE_SCHEMA_VERSION,
      mode: "runtime-additive",
      at: now(),
      spacesRead: spaces.length,
      spacesChanged: rows.length,
      fieldsChanged: rows.reduce((sum, row) => sum + Object.keys(row.patch).length, 0),
      idsPreserved: true,
      legacyTypesPreserved: true,
      documentsMoved: 0,
      salesBackfilled: 0,
      productsBackfilled: 0,
      status: rows.length ? "pending" : "already-normalized",
      changes: rows.map((row) => ({ id: row.id, fields: Object.keys(row.patch).sort() })),
    };
  if (!rows.length) return { spaces, report };
  if (!MANAGER_ROLES.has(context.role)) {
    report.status = "read-only-deferred-to-admin-migration";
    return { spaces, report };
  }
  try {
    await commitMigrationPatches(rows);
    report.status = "applied";
    const patches = new Map(rows.map((row) => [row.id, row.patch]));
    return { spaces: spaces.map((space) => ({ ...space, ...(patches.get(space.id) || {}) })), report };
  } catch (error) {
    report.status = "deferred-to-admin-migration";
    report.error = { code: error?.code || "unknown", message: error?.message || String(error) };
    console.warn("[SpaceService] additive runtime migration deferred", report.error);
    return { spaces, report };
  }
}

async function load(options = {}) {
  const context = assertContext(), key = contextKey(context);
  if (!options.force && state.contextKey === key && Context.snapshot().loaded)
    return Context.snapshot();
  const requestId = ++state.sequence;
  if (!online()) {
    const report = {
      version: Engine.SPACE_SCHEMA_VERSION,
      mode: "offline-cache",
      at: now(),
      status: "cached",
      spacesRead: Context.list().length,
      idsPreserved: true,
    };
    state.contextKey = key;
    state.lastMigrationReport = report;
    Context.setSpaces(Context.list(), { loaded: false, migrationReport: report });
    return Context.snapshot();
  }
  const remote = await readRemoteSpaces(context);
  if (requestId !== state.sequence || contextKey() !== key)
    return Context.snapshot();
  if (!remote.complete) {
    const report = {
      version: Engine.SPACE_SCHEMA_VERSION,
      mode: "remote-read",
      at: now(),
      status: "cache-preserved-after-query-error",
      errors: remote.errors,
      spacesRead: remote.spaces.length,
      idsPreserved: true,
    };
    state.lastMigrationReport = report;
    if (remote.spaces.length) {
      const preserved = new Map(Context.list().map((space) => [space.id, space]));
      remote.spaces.forEach((space) => preserved.set(space.id, space));
      Context.setSpaces([...preserved.values()], { loaded: false, migrationReport: report });
    }
    emit("veconi-space-service-error", report);
    return Context.snapshot();
  }
  const promoted = await promoteAccessibleSpaces(remote.spaces, context), ensured = await ensureDefaultSpace(promoted.spaces, context),
    report = {
      ...promoted.report,
      defaultSpace: ensured.reason,
      defaultSpaceCreated: ensured.created,
    };
  if (requestId !== state.sequence || contextKey() !== key)
    return Context.snapshot();
  state.contextKey = key;
  state.lastMigrationReport = report;
  Context.setSpaces(ensured.spaces, { loaded: true, migrationReport: report });
  emit("veconi-space-service-ready", { ...Context.snapshot(), readStats: state.lastReadStats });
  return Context.snapshot();
}

function scheduleLoad(options = {}) {
  if (state.inFlight && !options.force) return state.inFlight;
  const task = load(options).catch((error) => {
    const detail = { code: error?.code || "unknown", message: error?.message || String(error), at: now() };
    console.error("[SpaceService] initialization failed", detail);
    emit("veconi-space-service-error", detail);
    return Context.snapshot();
  }).finally(() => {
    if (state.inFlight === task) state.inFlight = null;
  });
  state.inFlight = task;
  return task;
}

function optimisticReplace(id, next) {
  const current = Context.snapshot(), map = new Map(current.spaces.map((space) => [space.id, space]));
  map.set(id, next);
  Context.setSpaces([...map.values()], { loaded: current.loaded, migrationReport: state.lastMigrationReport });
  return current;
}

function restoreSnapshotForContext(previous, expectedKey) {
  if (contextKey() !== expectedKey) return;
  Context.setSpaces(previous.spaces, {
    loaded: previous.loaded,
    migrationReport: previous.migrationReport || state.lastMigrationReport,
  });
}

async function persistWithOfflineQueue(write, rollback) {
  let pending;
  try { pending = write(); }
  catch (error) {
    rollback();
    throw error;
  }
  if (!online()) {
    pending.catch((error) => {
      rollback();
      console.error("[SpaceService] queued offline write failed", { code: error?.code, message: error?.message });
      emit("veconi-space-service-error", { code: error?.code || "offline-write-failed", message: error?.message || String(error) });
    });
    return;
  }
  try {
    await pending;
  } catch (error) {
    rollback();
    throw error;
  }
}

async function createSpace(input = {}) {
  const context = assertContext();
  if (!MANAGER_ROLES.has(context.role)) throw new Error("Seu perfil não pode gerenciar espaços.");
  const operationalType = VALID_OPERATIONAL_TYPES.has(String(input.operationalType || input.type))
      ? String(input.operationalType || input.type)
      : "operation",
    legacyType = operationalType === "personal" ? "personal" : operationalType === "other" ? "other" : "business",
    id = String(input.id || crypto.randomUUID()).trim(), createdAt = now(), value = {
      id,
      ownerUid: context.uid,
      createdBy: context.uid,
      name: requiredText(input.name, "o nome do espaço"),
      type: legacyType,
      linkedBusinessId: legacyType === "business" ? context.businessId : null,
      businessId: context.businessId,
      operationalType,
      active: true,
      status: "active",
      capabilities: capabilities(input.capabilities, legacyType === "business"
        ? { finance: true, sales: true, products: true, inventory: true, goals: true }
        : { finance: true, sales: false, products: false, inventory: false, goals: false }),
      isDefault: false,
      globalSpaceSchemaVersion: Engine.SPACE_SCHEMA_VERSION,
      automation: {
        enabled: false,
        linkedBusinessId: legacyType === "business" ? context.businessId : null,
        activatedAt: null,
        autoIncome: { sales: false, customerPayments: false, onlineOrders: false },
      },
      currency: "BRL",
      schemaVersion: 1,
      createdAt,
      updatedAt: createdAt,
      pendingSync: !online(),
    };
  if (Engine.isReservedSpaceId?.(id) || id === Engine.ALL_SPACES)
    throw new Error("Todos os espaços é uma visão, não um espaço real.");
  if (Context.list().some((space) => space.id === id)) throw new Error("Já existe um espaço com este ID.");
  const previous = optimisticReplace(id, value), writeContextKey = contextKey(context);
  await persistWithOfflineQueue(
    () => setDoc(spaceRef(id), { ...clean({ ...value, pendingSync: undefined }), createdAt: serverTimestamp(), updatedAt: serverTimestamp() }),
    () => restoreSnapshotForContext(previous, writeContextKey),
  );
  emit("veconi-space-data-changed", { action: "create", id, businessId: context.businessId });
  return Engine.normalizeSpace(value, context);
}

async function updateSpace(spaceId, input = {}) {
  const context = assertContext(), id = String(spaceId || "").trim(), current = Context.list().find((space) => space.id === id);
  if (!current) throw new Error("Espaço não encontrado.");
  if (current.businessId && current.businessId !== context.businessId)
    throw new Error("Este espaço pertence a outra empresa.");
  if (!MANAGER_ROLES.has(context.role) && current.ownerUid !== context.uid) throw new Error("Seu perfil não pode gerenciar este espaço.");
  const operationalType = input.operationalType === undefined
      ? current.operationalType
      : VALID_OPERATIONAL_TYPES.has(String(input.operationalType)) ? String(input.operationalType) : current.operationalType,
    nextCapabilities = input.capabilities === undefined
      ? capabilities(current.capabilities, current.capabilities)
      : capabilities(input.capabilities, current.capabilities),
    operationalPromotion = ["unit", "operation"].includes(operationalType)
      || nextCapabilities.sales || nextCapabilities.products || nextCapabilities.inventory || nextCapabilities.goals,
    status = input.status === "archived" ? "archived" : current.status,
    patch = {
      name: input.name === undefined ? current.name : requiredText(input.name, "o nome do espaço"),
      businessId: current.businessId || (operationalPromotion ? context.businessId : null),
      operationalType,
      status,
      active: status === "active",
      capabilities: nextCapabilities,
      isDefault: current.isDefault === true,
      globalSpaceSchemaVersion: Engine.SPACE_SCHEMA_VERSION,
      updatedAt: now(),
    }, next = Engine.normalizeSpace({ ...current, ...patch, pendingSync: !online() }, context), previous = optimisticReplace(id, next),
    writeContextKey = contextKey(context);
  await persistWithOfflineQueue(
    () => updateDoc(spaceRef(id), { ...clean({ ...patch, pendingSync: undefined }), updatedAt: serverTimestamp() }),
    () => restoreSnapshotForContext(previous, writeContextKey),
  );
  emit("veconi-space-data-changed", { action: status === "archived" ? "archive" : "update", id, businessId: context.businessId });
  return next;
}

const adapter = Object.freeze({
  list: () => Context.list(),
  refresh: () => scheduleLoad({ force: true }),
  create: createSpace,
  update: updateSpace,
  archive: (spaceId) => updateSpace(spaceId, { status: "archived" }),
});

const SpaceService = Object.freeze({
  ...adapter,
  load: scheduleLoad,
  getReadStats: () => state.lastReadStats ? clone(state.lastReadStats) : null,
  getMigrationReport: () => state.lastMigrationReport ? clone(state.lastMigrationReport) : null,
});

Context.setAdapter(adapter);
window.SpaceService = SpaceService;
addEventListener("firebase-auth-ready", () => { void scheduleLoad(); });
addEventListener("business-context-changed", () => { void scheduleLoad({ force: true }); });
addEventListener("online", () => { if (auth.currentUser) void scheduleLoad({ force: true }); });
if (auth.currentUser && currentContext().businessId) queueMicrotask(() => { void scheduleLoad(); });

export { SpaceService };
