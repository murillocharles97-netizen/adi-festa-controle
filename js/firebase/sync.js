import { auth, db, PROJECT_ID } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { createFirestoreRepository } from "./firestore-repository.js?v=61";
import {
  normalizeFirestoreData,
  sanitizeForFirestore,
} from "./firestore-utils.js";
import { setUsageScreen, usageSnapshot } from "./usage-monitor.js";

const LEGACY_QUEUE_KEY = "adiFestaFirestoreQueue_v1",
  PULL_TTL_MS = 300000,
  PROFILE_TTL_MS = 300000,
  MAX_WRITES = 350,
  PAYLOAD_VERSION = 4,
  DEVICE_ID_KEY = "adiFestaDeviceId";
const SOURCES = {
  clients: { key: "clientes" },
  products: { key: "produtos" },
  productVariants: { key: "variacoesProdutos" },
  sales: { key: "vendas" },
  payments: { key: "pagamentos" },
  balanceAdjustments: {
    key: "movimentacoes",
    filter: (item) => item.tipo === "ajuste_saldo",
  },
  stockMovements: { key: "movimentacoesEstoque" },
  campaigns: { key: "campanhas" },
  campaignProgress: { key: "progressosCampanha" },
  rewards: { key: "recompensas" },
  charges: { key: "cobrancas" },
  messageHistory: { key: "messageHistory" },
  messageTemplates: { key: "messageTemplates" },
  messageSequences: { key: "messageSequences" },
  clientContacts: { key: "contatosCliente" },
  customerSegments: { key: "segmentosClientes" },
  visits: { key: "visitas" },
  catalogOrders: { key: "catalogOrders" },
};
const QUEUE_ENTITY_ALIASES = {
  clientes: "clients",
  produtos: "products",
  variacoesProdutos: "productVariants",
  vendas: "sales",
  pagamentos: "payments",
  ajustesSaldo: "balanceAdjustments",
  movimentacoesEstoque: "stockMovements",
  campanhas: "campaigns",
  cobrancas: "charges",
  contatosCliente: "clientContacts",
  pedidos: "catalogOrders",
  configuracoes: "settings",
};
// Clientes e produtos são as duas coleções canônicas que precisam refletir
// imediatamente em todos os caixas. As demais coleções usam o sinal central e
// são reconciliadas no pull, evitando um listener por tela ou por card.
const REALTIME_NAMES = new Set(["clients", "products", "settings"]);
const CLOUD_NAMES = [...Object.keys(SOURCES), "settings"];
const SIGNAL_NAMES = [...CLOUD_NAMES, "businessProfile", "userProfile"];
const DEFAULT_PULL_NAMES = CLOUD_NAMES.filter(
  (name) => name !== "productVariants" && !REALTIME_NAMES.has(name),
);
const repositories = Object.fromEntries(
    CLOUD_NAMES.map((name) => [name, createFirestoreRepository(name)]),
  ),
  syncSignalRepository = createFirestoreRepository("syncMetadata"),
  syncSessionId = crypto.randomUUID();
let currentUser = null,
  originalAlter = null,
  applyingCloud = false,
  processingPromise = null,
  autoTimer = null,
  quickTimer = null,
  unsubscribers = [],
  subscribers = new Set(),
  lastError = "",
  lastErrorCode = "",
  currentPath = "",
  lastUserValidationAt = 0,
  lastPullAt = 0,
  cloudPaused = false,
  readOnlyMode = false,
  signalPullTimer = null,
  signalCollections = new Set(),
  signalVersions = new Map(),
  listenerRegistry = new Map();
const state = {
  authReady: false,
  status: navigator.onLine ? "idle" : "offline",
  message: navigator.onLine
    ? "Sincronização automática pronta"
    : "Offline — salvo no aparelho",
  progress: 0,
  testPassed: false,
  lastSync: "",
  lastAttempt: "",
  lastCompleteSync: "",
  cloudCounts: {},
  activeListeners: 0,
  userProfile: null,
  businessDocument: false,
  businessOwnerId: "",
  ownerMatches: false,
  sent: 0,
  received: 0,
  comparison: null,
  hydrated: false,
  listenerConnected: false,
  cloudNewest: {},
  cloudFinancial: {},
};

const now = () => new Date().toISOString();
const activeBusinessId = () => {
  const id = String(
    state.userProfile?.businessId ||
      window.FirebaseSession?.profile?.businessId ||
      "",
  ).trim();
  if (!id)
    throw Object.assign(new Error("O perfil não possui um negócio válido."), {
      code: "failed-precondition",
    });
  return id;
};
const errorCode = (error) =>
  String(error?.code || "").replace("firestore/", "");
const friendlyError = (error) =>
  ({
    "permission-denied": "Seu usuário não possui permissão.",
    unavailable: "A nuvem está temporariamente indisponível.",
    "deadline-exceeded": "A nuvem demorou demais para responder.",
    "resource-exhausted":
      "O limite temporário do Firebase foi atingido. As alterações continuam na fila.",
    unauthenticated: "Sua sessão expirou.",
    "network-request-failed": "Sem conexão com a internet.",
    "failed-precondition":
      "A sincronização ainda não está pronta neste aparelho.",
    "invalid-argument": "Uma alteração contém dados inválidos.",
  })[errorCode(error)] || "Não foi possível sincronizar agora.";
const namespace = () =>
  String(state.userProfile?.businessId || "__signed_out__");
const queueKey = () => `adiFesta:${namespace()}:syncQueue`;
const pullStateKey = () => `adiFesta:${namespace()}:incrementalPull`;
const lastSyncKey = () => `adiFesta:${namespace()}:lastSync`;
const lastAttemptKey = () => `adiFesta:${namespace()}:lastSyncAttempt`;
const lastCompleteKey = () => `adiFesta:${namespace()}:lastCompleteSync`;
const signalVersionKey = () => `adiFesta:${namespace()}:syncSignalVersions`;
const deviceId = () => {
  let value = localStorage.getItem(DEVICE_ID_KEY);
  if (!value) {
    value = crypto.randomUUID();
    localStorage.setItem(DEVICE_ID_KEY, value);
  }
  return value;
};
const readSignalVersions = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(signalVersionKey()) || "{}");
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
};
const saveSignalVersions = (versions) =>
  localStorage.setItem(signalVersionKey(), JSON.stringify(versions || {}));
const readQueue = () => {
  try {
    const parsed = JSON.parse(localStorage.getItem(queueKey()));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
};
const saveQueue = (queue) => {
  localStorage.setItem(queueKey(), JSON.stringify(queue));
  updateQueueState();
};
const queueCounts = () => {
  const queue = readQueue();
  return {
    pending: queue.filter((item) => item.status !== "error").length,
    errors: queue.filter((item) => item.status === "error").length,
    total: queue.length,
  };
};
const queueDiagnostics = () =>
  readQueue().map((item) => ({
    operationId: String(item.operationId || item.queueId || ""),
    entityType: String(item.entityType || "unknown"),
    action: String(item.action || item.operation || "unknown"),
    documentId: String(item.entityId || ""),
    businessId: String(item.businessId || ""),
    firestorePath: item.businessId && item.entityType && item.entityId
      ? `businesses/${item.businessId}/${item.entityType}/${item.entityId}`
      : "indefinido",
    createdAt: item.createdAtLocal || item.createdAt || "",
    retryCount: Number(item.retryCount || item.attempts || 0),
    errorCode: item.lastErrorCode || "",
    errorMessage: item.lastErrorMessage || "",
    payloadVersion: Number(item.payloadVersion || 1),
    schemaVersion: Number(item.schemaVersion || 1),
    deviceId: item.deviceId ? `${String(item.deviceId).slice(0, 6)}…` : "legado",
    origin: item.origin || item.source || "legado",
    status: item.status || "pending",
  }));
const retryDelay = (attempts, code = "") =>
  code === "resource-exhausted"
    ? ([300000, 900000, 1800000][Math.max(0, attempts - 1)] ?? 3600000)
    : ([5000, 15000, 30000, 60000][Math.max(0, attempts - 1)] ?? 300000);
const canAttempt = (item, force = false) =>
  force ||
  !item.lastAttemptAt ||
  Date.now() - new Date(item.lastAttemptAt).getTime() >=
    retryDelay(item.attempts || 0, item.lastErrorCode);
const readPullState = () => {
  try {
    return JSON.parse(localStorage.getItem(pullStateKey())) || {};
  } catch {
    return {};
  }
};
const writePullState = (value) =>
  localStorage.setItem(pullStateKey(), JSON.stringify(value));
const newestTimestamp = (documents) =>
  documents.reduce((latest, item) => {
    const value =
      item.updatedAt ||
      item.atualizadoEm ||
      item.createdAt ||
      item.criadoEm ||
      "";
    return value && new Date(value) > new Date(latest || 0) ? value : latest;
  }, "");
const normalizeText = (value) =>
  String(value || "")
    .trim()
    .toLocaleLowerCase("pt-BR")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
const sourceItems = (data, name) => {
  const source = SOURCES[name],
    items = Array.isArray(data[source.key]) ? data[source.key] : [];
  return source.filter ? items.filter(source.filter) : items;
};
const localSummary = () => {
  const data = DB.carregar();
  return {
    clientes: data.clientes.length,
    produtos: data.produtos.length,
    vendas: data.vendas.length,
    pagamentos: data.pagamentos.length,
    fiado: data.clientes.reduce(
      (total, item) => total + Math.abs(Math.min(0, Number(item.saldo || 0))),
      0,
    ),
  };
};
const diagnostic = () => {
  const q = queueCounts(),
    local = localSummary(),
    profile = state.userProfile || {},
    usage = usageSnapshot();
  return {
    projectId: PROJECT_ID,
    databaseId: "(default)",
    authReady: state.authReady,
    authenticated: Boolean(auth.currentUser),
    uid: auth.currentUser?.uid || "",
    email: auth.currentUser?.email || "",
    userDocumentExists: Boolean(profile.uid),
    userActive: profile.active === true,
    userRole: profile.role || "",
    userBusinessId: profile.businessId || "",
    businessDocumentExists: state.businessDocument,
    businessOwnerId: state.businessOwnerId,
    ownerMatches: state.ownerMatches,
    targetBusinessId: profile.businessId || "",
    connection: state.testPassed ? "funcionando" : "não comprovada",
    activeAuthObservers: Number(
      window.FirebaseRuntimeMetrics?.activeAuthObservers || 0,
    ),
    activeListeners: usage.activeListeners,
    peakListeners: usage.peakListeners,
    activeSyncTimers: Number(Boolean(autoTimer)) + Number(Boolean(quickTimer)),
    cloudPaused,
    sessionReads: usage.reads,
    sessionWrites: usage.writes,
    sessionQueries: usage.queries,
    averageLatencyMs: usage.averageLatencyMs,
    pendingOperations: q.total,
    pending: q.pending,
    syncErrors: q.errors,
    processingOperations: readQueue().filter((item) => item.status === "syncing")
      .length,
    lastAttemptAt: state.lastAttempt,
    lastCompleteSyncAt: state.lastCompleteSync,
    lastSyncAt: state.lastSync,
    lastSync: state.lastSync || "nunca",
    currentPath: currentPath || `businesses/${profile.businessId || "—"}`,
    hydrated: state.hydrated,
    listenerConnected: state.listenerConnected,
    schemaVersion: 3,
    lastErrorCode,
    lastErrorMessage: lastError,
    localClients: local.clientes,
    cloudClients: state.cloudCounts.clients ?? "—",
    localProducts: local.produtos,
    cloudFiado: state.cloudFinancial.fiado ?? "—",
    cloudNewest: state.cloudNewest,
    queueErrors: queueDiagnostics().filter((item) => item.status === "error"),
    cloudProducts: state.cloudCounts.products ?? "—",
    localSales: local.vendas,
    cloudSales: state.cloudCounts.sales ?? "—",
    localPayments: local.pagamentos,
    cloudPayments: state.cloudCounts.payments ?? "—",
    localFiado: local.fiado,
    comparison: state.comparison,
  };
};
const emit = (patch) => {
  Object.assign(state, patch);
  const counts = queueCounts(),
    snapshot = {
      ...state,
      pending: counts.pending,
      errors: counts.errors,
      queueTotal: counts.total,
      details: diagnostic(),
    };
  subscribers.forEach((callback) => callback(snapshot));
  dispatchEvent(new CustomEvent("firebase-sync-status", { detail: snapshot }));
};
function updateQueueState() {
  const q = queueCounts();
  if (!currentUser) return;
  if (!navigator.onLine)
    emit({
      status: "offline",
      message: q.total
        ? `Offline — ${q.total} alteração(ões) pendente(s)`
        : "Offline — salvo no aparelho",
    });
  else if (q.total && state.status !== "syncing")
    emit({
      status: q.errors ? "error" : "waiting",
      message: q.errors
        ? `Sincronização incompleta: ${q.errors} alteração(ões) com erro e ${q.pending} pendente(s).`
        : `${q.total} alteração(ões) aguardando sincronização`,
    });
}
function reportError(error, context = "Firebase", extra = {}) {
  lastError = friendlyError(error);
  lastErrorCode = errorCode(error) || "unknown";
  console.error(`[${context}]`, {
    ...extra,
    code: error?.code,
    message: error?.message,
  });
  emit({ status: "error", message: lastError });
  return lastError;
}
function enrich(name, item) {
  const clean = sanitizeForFirestore(item) || {};
  if (name === "clients")
    Object.assign(clean, {
      nomeNormalizado: normalizeText(clean.nome),
      telefoneNormalizado: String(clean.telefone || "").replace(/\D/g, ""),
    });
  if (name === "products")
    Object.assign(clean, {
      nomeNormalizado: normalizeText(clean.nome),
      controlaEstoque: !clean.semControleEstoque,
    });
  if (name === "productVariants") {
    Object.assign(clean, {
      displayNameNormalized: normalizeText(clean.displayName),
      searchTokens: [
        clean.sku,
        clean.barcode,
        ...Object.values(clean.attributeValues || {}),
      ]
        .map(normalizeText)
        .filter(Boolean),
    });
    const allowed = new Set([
      "parentProductId",
      "attributeValues",
      "displayName",
      "displayNameNormalized",
      "searchTokens",
      "sku",
      "barcode",
      "price",
      "cost",
      "stock",
      "minStock",
      "active",
      "catalogVisible",
      "allowNegativeStock",
      "imageUrl",
      "createdAt",
    ]);
    for (const key of Object.keys(clean)) if (!allowed.has(key)) delete clean[key];
  }
  if (
    [
      "sales",
      "payments",
      "balanceAdjustments",
      "stockMovements",
      "rewards",
      "messageHistory",
      "messageSequences",
      "clientContacts",
    ].includes(name)
  )
    clean.operationId = clean.operationId || clean.id;
  return clean;
}
function cloudPayload(name, id, data, creating = false) {
  const clean = enrich(name, data),
    businessId = activeBusinessId();
  delete clean.version;
  return {
    ...clean,
    id: String(id),
    businessId,
    ownerId: currentUser.uid,
    schemaVersion: 3,
    ...(creating
      ? {
          createdAt:
            clean.createdAt ||
            clean.criadoEm ||
            clean.data ||
            serverTimestamp(),
        }
      : {}),
    updatedAt: serverTimestamp(),
    version: increment(1),
  };
}
function archiveQueue(reason) {
  const queue = readQueue();
  if (queue.length)
    localStorage.setItem(
      `adiFestaSyncQueueArchive_${Date.now()}`,
      JSON.stringify({
        reason,
        archivedAt: now(),
        businessId: state.userProfile?.businessId || "",
        userId: currentUser?.uid || "",
        queue,
      }),
    );
  return queue.length;
}
function migrateLegacyQueue() {
  const migratedKey = `${queueKey()}:legacyMigrated`;
  if (
    activeBusinessId() !== "adi-festa" ||
    localStorage.getItem(queueKey()) ||
    localStorage.getItem(migratedKey)
  )
    return;
  let legacy = [];
  try {
    legacy = JSON.parse(localStorage.getItem(LEGACY_QUEUE_KEY)) || [];
  } catch {}
  if (!legacy.length) return;
  localStorage.setItem(
    `${queueKey()}:legacyBackup:${Date.now()}`,
    JSON.stringify(legacy),
  );
  const groups = new Map(),
    businessId = activeBusinessId();
  for (const item of legacy) {
    const groupId = item.groupId || item.key || crypto.randomUUID();
    if (!groups.has(groupId)) groups.set(groupId, []);
    groups.get(groupId).push(item);
  }
  const migrated = [];
  for (const [groupId, items] of groups)
    for (let index = 0; index < items.length; index += MAX_WRITES) {
      const part = items.slice(index, index + MAX_WRITES),
        operationId =
          items.length > MAX_WRITES
            ? `${groupId}:${index / MAX_WRITES}`
            : groupId,
        writes = part.map((item) => ({
          entityType: item.collection,
          entityId: String(item.id),
          operation: "update",
          before: null,
          data: item.data,
        })),
        action = writes.length === 1 ? "update" : "transaction",
        createdAt = part[0]?.queuedAt || now();
      migrated.push({
        queueId: crypto.randomUUID(),
        operationId,
        entityType: writes.length === 1 ? writes[0].entityType : "transaction",
        entityId: writes.length === 1 ? writes[0].entityId : operationId,
        operation: action,
        action,
        payload: { writes, eventKind: "legacy" },
        payloadVersion: PAYLOAD_VERSION,
        businessId,
        userId: currentUser.uid,
        deviceId: deviceId(),
        origin: "legacy",
        schemaVersion: 3,
        source: "legacy_queue",
        createdAt,
        createdAtLocal: createdAt,
        retryCount: 0,
        attempts: 0,
        status: "pending",
        lastAttemptAt: null,
        lastErrorCode: null,
        lastErrorMessage: null,
      });
    }
  localStorage.setItem(queueKey(), JSON.stringify(migrated));
  localStorage.setItem(migratedKey, now());
}
function validateQueueOwnership() {
  const businessId = activeBusinessId(),
    queue = readQueue(),
    next = queue.map((item) => {
      const mismatch =
        (item.businessId && item.businessId !== businessId) ||
        (item.userId && item.userId !== currentUser.uid);
      return mismatch
        ? {
            ...item,
            status: "error",
            lastErrorCode: "queue-owner-mismatch",
            lastErrorMessage:
              "Esta alteração pertence a outra empresa ou sessão e foi preservada para revisão.",
          }
        : item;
    });
  if (JSON.stringify(next) !== JSON.stringify(queue)) saveQueue(next);
}
function migrateScopedQueueCompatibility() {
  const queue = readQueue();
  if (!queue.length) return { migrated: 0, blocked: 0 };
  const businessId = activeBusinessId(),
    backupKey = `${queueKey()}:compatBackup:${Date.now()}`;
  let migrated = 0,
    blocked = 0;
  const next = queue.map((item) => {
    const copy = structuredClone(item),
      writes = Array.isArray(copy.payload?.writes) ? copy.payload.writes : [];
    copy.businessId ||= businessId;
    copy.userId ||= currentUser.uid;
    copy.deviceId ||= deviceId();
    copy.origin ||= copy.source || "legacy";
    copy.payloadVersion = PAYLOAD_VERSION;
    copy.schemaVersion = 3;
    copy.payload ||= { writes: [], eventKind: "legacy" };
    copy.payload.writes = writes.map((write) => {
      const entityType = QUEUE_ENTITY_ALIASES[write.entityType] || write.entityType;
      if (entityType !== write.entityType) migrated++;
      return {
        ...write,
        entityType,
        entityId: String(write.entityId || write.id || ""),
        data: sanitizeForFirestore(write.data || {}) || {},
      };
    });
    copy.entityType =
      QUEUE_ENTITY_ALIASES[copy.entityType] || copy.entityType || "unknown";
    const invalidWrite = copy.payload.writes.find(
      (write) =>
        !CLOUD_NAMES.includes(write.entityType) || !String(write.entityId || ""),
    );
    if (invalidWrite) {
      blocked++;
      copy.status = "error";
      copy.lastErrorCode = "legacy-payload-unsupported";
      copy.lastErrorMessage = `Operação legada preservada: coleção ${invalidWrite.entityType || "indefinida"} não reconhecida.`;
    } else if (copy.status === "syncing") copy.status = "pending";
    return copy;
  });
  if (JSON.stringify(next) !== JSON.stringify(queue)) {
    localStorage.setItem(backupKey, JSON.stringify(queue));
    saveQueue(next);
  }
  return { migrated, blocked };
}
function queueWrites(
  writes,
  operationId = crypto.randomUUID(),
  eventKind = "simple",
  options = {},
) {
  if (!writes.length) return 0;
  const queue = readQueue(),
    businessId = activeBusinessId();
  for (let index = 0; index < writes.length; index += MAX_WRITES) {
    const part = writes.slice(index, index + MAX_WRITES),
      id =
        writes.length > MAX_WRITES
          ? `${operationId}:${index / MAX_WRITES}`
          : operationId,
      action = part.length === 1 ? part[0].operation : "transaction",
      createdAt = now();
    queue.push({
      queueId: crypto.randomUUID(),
      operationId: id,
      entityType: part.length === 1 ? part[0].entityType : "transaction",
      entityId: part.length === 1 ? part[0].entityId : id,
      operation: action,
      action,
      payload: { writes: part, eventKind },
      payloadVersion: PAYLOAD_VERSION,
      businessId,
      userId: currentUser.uid,
      deviceId: deviceId(),
      origin: matchMedia("(max-width:767px)").matches ? "mobile" : "desktop",
      schemaVersion: 3,
      baseBackupId: options.baseBackupId || null,
      source: options.source || "local",
      createdAt,
      createdAtLocal: createdAt,
      retryCount: 0,
      attempts: 0,
      status: "pending",
      lastAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    });
  }
  saveQueue(queue);
  scheduleImmediate();
  return writes.length;
}
function changedFields(previous, item) {
  const patch = {};
  for (const key of new Set([
    ...Object.keys(previous || {}),
    ...Object.keys(item || {}),
  ]))
    if (JSON.stringify(previous?.[key]) !== JSON.stringify(item?.[key]))
      patch[key] = item?.[key];
  return patch;
}
function diffWrites(before, after) {
  const writes = [];
  for (const name of Object.keys(SOURCES)) {
    const previous = new Map(
        sourceItems(before, name).map((item) => [String(item.id), item]),
      ),
      next = new Map(
        sourceItems(after, name).map((item) => [String(item.id), item]),
      );
    for (const [id, item] of next)
      if (JSON.stringify(item) !== JSON.stringify(previous.get(id))) {
        const exists = previous.has(id);
        writes.push({
          entityType: name,
          entityId: id,
          operation: exists ? "update" : "create",
          before: previous.get(id) || null,
          data: exists ? changedFields(previous.get(id), item) : item,
        });
      }
    for (const [id, item] of previous)
      if (!next.has(id))
        writes.push({
          entityType: name,
          entityId: id,
          operation: "update",
          before: item,
          data: { active: false, deletedAt: now() },
        });
  }
  const beforeConfig = { ...(before.config || {}) },
    afterConfig = { ...(after.config || {}) };
  delete beforeConfig.operation;
  delete afterConfig.operation;
  if (JSON.stringify(beforeConfig) !== JSON.stringify(afterConfig))
    writes.push({
      entityType: "settings",
      entityId: "default",
      operation: "update",
      before: beforeConfig,
      data: changedFields(beforeConfig, afterConfig),
    });
  return writes;
}
function captureChanges(before, after) {
  if (applyingCloud) return 0;
  const writes = diffWrites(before, after),
    eventWrite =
      writes.find(
        (write) => write.operation === "create" && write.data?.operationId,
      ) || writes.find((write) => write.data?.operationId),
    stockEvent = writes.find(
      (write) =>
        write.entityType === "stockMovements" && write.operation === "create",
    ),
    operationId = eventWrite?.data?.operationId || crypto.randomUUID(),
    eventKind = writes.some((write) => write.entityType === "sales")
      ? "sale"
      : writes.some((write) => write.entityType === "payments")
        ? "payment"
        : writes.some((write) => write.entityType === "clientContacts")
          ? "client_contact"
          : writes.some((write) => write.entityType === "messageHistory")
            ? "message_opened"
            : writes.some((write) => write.entityType === "messageSequences")
              ? "message_sequence"
              : writes.some(
                    (write) => write.entityType === "balanceAdjustments",
                  )
                ? "balance_adjustment"
                : stockEvent?.data?.tipo === "entrada"
                  ? "stock_entry"
                  : stockEvent
                    ? "stock_adjustment"
                    : "simple";
  return queueWrites(writes, operationId, eventKind);
}
function installOfflineFirstStorage() {
  if (originalAlter) return;
  originalAlter = DB.alterar.bind(DB);
  DB.alterar = function (mutator) {
    const before = structuredClone(DB.carregar()),
      result = originalAlter(mutator),
      after = structuredClone(result);
    captureChanges(before, after);
    return result;
  };
  DB.__firebaseSyncWrapped = true;
}

async function validateUser() {
  if (PROJECT_ID !== "adi-festa-controle")
    throw Object.assign(new Error("Projeto Firebase incorreto."), {
      code: "failed-precondition",
    });
  const user = auth.currentUser || currentUser;
  if (!user)
    throw Object.assign(new Error("Usuário não autenticado."), {
      code: "unauthenticated",
    });
  if (
    currentUser?.uid === user.uid &&
    state.userProfile?.uid === user.uid &&
    Date.now() - lastUserValidationAt < PROFILE_TTL_MS
  )
    return {
      user,
      profile: state.userProfile,
      businessId: state.userProfile.businessId,
    };
  const snapshot = await getDoc(doc(db, "users", user.uid));
  if (!snapshot.exists())
    throw Object.assign(new Error("Perfil não encontrado."), {
      code: "permission-denied",
    });
  const profile = normalizeFirestoreData(snapshot.data());
  if (
    (profile.uid && profile.uid !== user.uid) ||
    profile.active !== true ||
    !profile.businessId
  )
    throw Object.assign(new Error("Perfil sem acesso válido."), {
      code: "permission-denied",
    });
  profile.uid ??= user.uid;
  currentUser = user;
  state.userProfile = profile;
  lastUserValidationAt = Date.now();
  return { user, profile, businessId: profile.businessId };
}
async function ensureBusinessDocument() {
  const { user, businessId } = await validateUser(),
    reference = doc(db, "businesses", businessId),
    snapshot = await getDoc(reference);
  if (!snapshot.exists())
    throw Object.assign(
      new Error("O negócio vinculado ao perfil não existe."),
      { code: "permission-denied" },
    );
  const business = snapshot.data() || {},
    ownerMatches = business.ownerId === user.uid;
  emit({
    businessDocument: true,
    businessOwnerId: business.ownerId || "",
    ownerMatches,
  });
  if (business.active === false)
    throw Object.assign(new Error("Negócio indisponível."), {
      code: "permission-denied",
    });
  return reference;
}
async function testFirestoreConnection() {
  emit({ status: "testing", message: "Verificando a nuvem…" });
  try {
    await validateUser();
    await ensureBusinessDocument();
    lastError = "";
    lastErrorCode = "";
    currentPath = "";
    emit({ testPassed: true, status: "success", message: "Nuvem verificada" });
    return true;
  } catch (error) {
    reportError(error, "Connection test", { path: currentPath });
    throw error;
  }
}
async function commitQueueItem(item) {
  const businessId = activeBusinessId(),
    marker = doc(
      db,
      "businesses",
      businessId,
      "processedOperations",
      item.operationId,
    ),
    writes = item.payload.writes || [],
    transactional = [
      "sale",
      "payment",
      "balance_adjustment",
      "stock_entry",
      "stock_adjustment",
      "sale_undo",
    ].includes(item.payload.eventKind),
    deltaEntities = ["clients", "products", "productVariants"];
  await runTransaction(db, async (transaction) => {
    const processed = await transaction.get(marker);
    if (processed.exists()) return;
    const snapshots = new Map();
    if (transactional)
      for (const write of writes)
        if (deltaEntities.includes(write.entityType)) {
          const reference = doc(
            db,
            "businesses",
            businessId,
            write.entityType,
            String(write.entityId),
          );
          snapshots.set(
            `${write.entityType}:${write.entityId}`,
            await transaction.get(reference),
          );
        }
    for (const write of writes) {
      const reference = doc(
        db,
        "businesses",
        businessId,
        write.entityType,
        String(write.entityId),
      );
      let data = write.data;
      if (
        transactional &&
        write.before &&
        deltaEntities.includes(write.entityType)
      ) {
        const remote = snapshots.get(`${write.entityType}:${write.entityId}`),
          base = remote?.exists() ? remote.data() : {},
          merged = { ...data };
        const fields =
          write.entityType === "clients"
            ? ["saldo", "totalComprado", "quantidadeVendas"]
            : write.entityType === "productVariants"
              ? ["stock"]
              : ["estoqueAtual", "estoque", "totalStock"];
        for (const field of fields)
          if (
            Number.isFinite(Number(data[field])) &&
            Number.isFinite(Number(write.before[field]))
          )
            merged[field] =
              Number(base[field] ?? write.before[field] ?? 0) +
              (Number(data[field]) - Number(write.before[field]));
        data = merged;
      }
      transaction.set(
        reference,
        cloudPayload(
          write.entityType,
          write.entityId,
          data,
          write.operation === "create",
        ),
        { merge: true },
      );
    }
    transaction.set(marker, {
      id: item.operationId,
      businessId,
      ownerId: currentUser.uid,
      status: "processed",
      eventKind: item.payload.eventKind || "simple",
      processedAt: serverTimestamp(),
      createdAtLocal: item.createdAtLocal,
    });
  });
}
async function processSyncQueue(options = {}) {
  if (processingPromise) return processingPromise;
  if (readOnlyMode)
    return {
      sent: 0,
      pending: readQueue().length,
      errors: queueCounts().errors,
      paused: true,
      reason: "subscription_read_only",
      collections: [],
    };
  const force = Boolean(options.force);
  processingPromise = (async () => {
    if (!currentUser)
      return { sent: 0, pending: readQueue().length, errors: 0 };
    if (!navigator.onLine) {
      updateQueueState();
      return {
        sent: 0,
        pending: readQueue().length,
        errors: queueCounts().errors,
      };
    }
    if (cloudPaused && !force)
      return {
        sent: 0,
        pending: readQueue().length,
        errors: queueCounts().errors,
        paused: true,
      };
    await validateUser();
    let sent = 0,
      index = 0,
      queue = readQueue(),
      changedCollections = new Set();
    for (const queued of [...queue]) {
      if (
        queued.businessId !== activeBusinessId() ||
        queued.userId !== currentUser.uid
      ) {
        const blocked = readQueue(),
          blockedIndex = blocked.findIndex(
            (item) => item.queueId === queued.queueId,
          );
        if (blockedIndex >= 0) {
          blocked[blockedIndex] = {
            ...blocked[blockedIndex],
            status: "error",
            lastErrorCode: "queue-owner-mismatch",
            lastErrorMessage:
              "Empresa ou usuário da operação não corresponde à sessão atual.",
          };
          saveQueue(blocked);
        }
        continue;
      }
      if (!canAttempt(queued, force)) continue;
      const live = readQueue(),
        position = live.findIndex((item) => item.queueId === queued.queueId);
      if (position < 0) continue;
      live[position] = {
        ...live[position],
        status: "syncing",
        lastAttemptAt: now(),
      };
      saveQueue(live);
      emit({
        status: "syncing",
        message: `Sincronizando ${index + 1} de ${queue.length}…`,
        progress: Math.round(((index + 1) / Math.max(1, queue.length)) * 100),
      });
      try {
        await commitQueueItem(live[position]);
        const after = readQueue().filter(
          (item) => item.queueId !== queued.queueId,
        );
        saveQueue(after);
        for (const write of live[position].payload?.writes || [])
          if (CLOUD_NAMES.includes(write.entityType))
            changedCollections.add(write.entityType);
        sent++;
      } catch (error) {
        const failed = readQueue(),
          failedIndex = failed.findIndex(
            (item) => item.queueId === queued.queueId,
          );
        if (failedIndex >= 0) {
          const attempts = Number(failed[failedIndex].attempts || 0) + 1,
            temporary = [
              "unavailable",
              "deadline-exceeded",
              "resource-exhausted",
              "network-request-failed",
              "aborted",
            ].includes(errorCode(error)),
            retryable = temporary && attempts < 6;
          failed[failedIndex] = {
            ...failed[failedIndex],
            attempts,
            retryCount: attempts,
            status: retryable ? "pending" : "error",
            lastAttemptAt: now(),
            lastErrorCode: errorCode(error) || "unknown",
            lastErrorMessage: String(error?.message || friendlyError(error)).slice(
              0,
              240,
            ),
          };
          saveQueue(failed);
        }
        reportError(error, "Queue operation", {
          queueId: queued.queueId,
          operationId: queued.operationId,
        });
        if (errorCode(error) === "resource-exhausted") cloudPaused = true;
        if (
          [
            "permission-denied",
            "unauthenticated",
            "resource-exhausted",
            "failed-precondition",
          ].includes(errorCode(error))
        )
          break;
      }
      index++;
    }
    const counts = queueCounts();
    return {
      sent,
      pending: counts.total,
      errors: counts.errors,
      paused: cloudPaused,
      reason: cloudPaused ? lastErrorCode || "cloud_paused" : "",
      collections: [...changedCollections],
    };
  })();
  try {
    return await processingPromise;
  } finally {
    processingPromise = null;
  }
}
function pendingIds(name) {
  const ids = new Set();
  for (const item of readQueue())
    for (const write of item.payload?.writes || [])
      if (write.entityType === name) ids.add(String(write.entityId));
  return ids;
}
function cleanCloudItem(item) {
  const clean = normalizeFirestoreData(item);
  clean.criadoEm ??= clean.createdAt || clean.data;
  clean.atualizadoEm ??= clean.updatedAt || clean.data;
  return clean;
}
function reconcileLocalAndCloud(
  entityType,
  local,
  cloud,
  pending = pendingIds(entityType),
  authoritative = false,
) {
  const byId = new Map(),
    operations = new Map();
  for (const raw of local || []) {
    if (!raw?.id) continue;
    const item = cleanCloudItem(raw),
      id = String(item.id);
    if (byId.has(id)) byId.set(id, { ...byId.get(id), ...item });
    else byId.set(id, item);
    if (item.operationId) operations.set(String(item.operationId), id);
  }
  for (const raw of cloud || []) {
    const item = cleanCloudItem(raw),
      id = String(item.id);
    if (pending.has(id)) continue;
    const operationId = item.operationId ? String(item.operationId) : "",
      operationMatch = operationId ? operations.get(operationId) : null;
    if (item.deletedAt) {
      byId.delete(id);
      if (operationMatch) byId.delete(operationMatch);
      continue;
    }
    if (
      operationMatch &&
      operationMatch !== id &&
      !pending.has(operationMatch)
    ) {
      const existing = byId.get(operationMatch),
        remoteTime = new Date(
          item.updatedAt || item.atualizadoEm || 0,
        ).getTime(),
        localTime = new Date(
          existing?.updatedAt || existing?.atualizadoEm || 0,
        ).getTime();
      if (remoteTime >= localTime) {
        byId.delete(operationMatch);
        byId.set(id, item);
        operations.set(operationId, id);
      }
      continue;
    }
    const existing = byId.get(id);
    if (!existing) {
      byId.set(id, item);
      if (operationId) operations.set(operationId, id);
      continue;
    }
    const remoteTime = new Date(
        item.updatedAt || item.atualizadoEm || 0,
      ).getTime(),
      localTime = new Date(
        existing.updatedAt || existing.atualizadoEm || 0,
      ).getTime();
    if (!localTime || remoteTime >= localTime)
      byId.set(id, { ...existing, ...item });
  }
  if (authoritative) {
    const cloudIds = new Set(
      (cloud || [])
        .filter((item) => item?.id && !item.deletedAt)
        .map((item) => String(item.id)),
    );
    for (const [id, item] of [...byId.entries()]) {
      if (pending.has(id) || cloudIds.has(id)) continue;
      const operationId = item?.operationId ? String(item.operationId) : "";
      const representedByCloud = operationId
        ? (cloud || []).some(
            (remote) =>
              !remote?.deletedAt &&
              String(remote?.operationId || "") === operationId,
          )
        : false;
      if (!representedByCloud) byId.delete(id);
    }
  }
  return [...byId.values()];
}
function applyCloudCollection(name, documents, options = {}) {
  if (!originalAlter) return 0;
  const pending = pendingIds(name),
    source = SOURCES[name];
  let changed = 0;
  applyingCloud = true;
  try {
    originalAlter((data) => {
      if (name === "settings") {
        const remote = documents.find(
          (item) => item.id === "default" && !item.deletedAt,
        );
        if (!remote || pending.has("default")) return;
        const {
            id,
            businessId,
            ownerId,
            schemaVersion,
            createdAt,
            updatedAt,
            version,
            ...config
          } = cleanCloudItem(remote),
          next = { ...data.config, ...config };
        if (JSON.stringify(next) !== JSON.stringify(data.config)) {
          data.config = next;
          changed++;
        }
        return;
      }
      const current = Array.isArray(data[source.key]) ? data[source.key] : [],
        next = reconcileLocalAndCloud(
          name,
          current,
          documents,
          pending,
          Boolean(options.authoritative),
        );
      if (JSON.stringify(current) !== JSON.stringify(next)) {
        data[source.key] = next;
        changed = Math.max(1, Math.abs(next.length - current.length));
      }
    });
  } finally {
    applyingCloud = false;
  }
  if (changed)
    dispatchEvent(
      new CustomEvent("cloud-data-updated", {
        detail: { collection: name, count: changed, source: "cloud" },
      }),
    );
  return changed;
}
function registerRealtimeCollection(name, mode = "all") {
  const key = `${activeBusinessId()}:${name}:${mode}`;
  if (listenerRegistry.has(key)) return listenerRegistry.get(key);
  const onDocuments = (documents) => {
      const list = Array.isArray(documents)
        ? documents
        : documents
          ? [documents]
          : [];
      state.cloudCounts[name] = list.filter((item) => !item?.deletedAt).length;
      state.cloudNewest[name] = newestTimestamp(list);
      if (name === "clients")
        state.cloudFinancial.fiado = list.reduce(
          (total, item) =>
            total + Math.abs(Math.min(0, Number(item?.saldo || 0))),
          0,
        );
      const received = applyCloudCollection(name, list, {
        authoritative: mode === "all",
      });
      emit({
        cloudCounts: { ...state.cloudCounts },
        cloudNewest: { ...state.cloudNewest },
        cloudFinancial: { ...state.cloudFinancial },
        received,
        hydrated: true,
        listenerConnected: true,
      });
    },
    onError = (error) =>
      reportError(error, "Realtime collection listener", { collection: name });
  const unsubscribe =
    mode === "document"
      ? repositories[name].subscribeById("default", onDocuments, onError)
      : repositories[name].subscribe(onDocuments, onError);
  listenerRegistry.set(key, unsubscribe);
  return unsubscribe;
}
function startCloudSubscriptions() {
  stopCloudSubscriptions();
  if (!currentUser) return;
  registerRealtimeCollection("clients");
  registerRealtimeCollection("products");
  registerRealtimeCollection("settings", "document");
  const unsubscribe = syncSignalRepository.subscribeById(
    "last-sync",
    (signal) => {
      const revision = String(
        signal?.revision || signal?.updatedAt || signal?.syncedAt || "",
      ),
        storedVersions = readSignalVersions(),
        remoteVersions =
          signal?.collectionVersions &&
          typeof signal.collectionVersions === "object"
            ? signal.collectionVersions
            : Object.fromEntries(
                (signal?.changedCollections || []).map((name) => [
                  name,
                  revision,
                ]),
              );
      emit({ listenerConnected: true });
      if (!signal) return;
      if (signal.sourceSessionId === syncSessionId) {
        const ownVersions = Object.fromEntries(
          (signal.changedCollections || [])
            .filter((name) => SIGNAL_NAMES.includes(name))
            .map((name) => [name, remoteVersions[name] || revision]),
        );
        saveSignalVersions({ ...storedVersions, ...ownVersions });
        return;
      }
      const names = Object.entries(remoteVersions)
          .filter(
            ([name, version]) =>
              SIGNAL_NAMES.includes(name) &&
              String(storedVersions[name] || "") !==
                String(version || revision),
          )
          .map(([name]) => name),
        pendingNames = names.length
          ? names
          : !Object.keys(remoteVersions).length && revision
            ? (signal.changedCollections || DEFAULT_PULL_NAMES).filter((name) =>
                SIGNAL_NAMES.includes(name),
              )
            : [];
      pendingNames.forEach((name) => {
        signalCollections.add(name);
        signalVersions.set(name, remoteVersions[name] || revision);
      });
      if (!pendingNames.length) return;
      clearTimeout(signalPullTimer);
      signalPullTimer = setTimeout(async () => {
        const changed = [...signalCollections],
          cloudNames = changed.filter(
            (name) => CLOUD_NAMES.includes(name) && !REALTIME_NAMES.has(name),
          ),
          versions = Object.fromEntries(
            changed.map((name) => [name, signalVersions.get(name) || revision]),
          );
        signalCollections.clear();
        changed.forEach((name) => signalVersions.delete(name));
        if (!changed.length || !currentUser || !navigator.onLine) return;
        try {
          if (cloudNames.length)
            await pullCloudCollections({ force: true, names: cloudNames });
          if (changed.includes("businessProfile"))
            await refreshBusinessContext();
          if (changed.includes("userProfile")) await refreshUserContext();
          const time = now();
          localStorage.setItem(lastSyncKey(), time);
          saveSignalVersions({ ...readSignalVersions(), ...versions });
          emit({
            status: "success",
            message: "Alterações recebidas de outro dispositivo.",
            lastSync: time,
          });
        } catch (error) {
          reportError(error, "Realtime sync signal", {
            collections: changed,
          });
        }
      }, 120);
    },
    (error) =>
      reportError(error, "Realtime sync signal listener", {
        collection: "syncMetadata/last-sync",
      }),
  );
  unsubscribers.push(unsubscribe);
  emit({
    activeListeners: usageSnapshot().activeListeners,
    listenerConnected: false,
  });
}
function stopCloudSubscriptions() {
  clearTimeout(signalPullTimer);
  signalPullTimer = null;
  signalCollections.clear();
  signalVersions.clear();
  for (const unsubscribe of listenerRegistry.values())
    try {
      unsubscribe();
    } catch {}
  listenerRegistry.clear();
  for (const unsubscribe of unsubscribers)
    try {
      unsubscribe();
    } catch {}
  unsubscribers = [];
  emit({ activeListeners: 0, listenerConnected: false });
}

async function publishSyncSignal(collections, status = "ok") {
  const changedCollections = [
    ...new Set(
      (collections || []).filter((name) => SIGNAL_NAMES.includes(name)),
    ),
  ];
  if (!changedCollections.length && status === "ok") return false;
  const businessId = activeBusinessId(),
    revision = crypto.randomUUID(),
    collectionVersions = Object.fromEntries(
      changedCollections.map((name) => [name, revision]),
    );
  await setDoc(
    doc(db, "businesses", businessId, "syncMetadata", "last-sync"),
    {
      id: "last-sync",
      businessId,
      ownerId: currentUser.uid,
      status,
      changedCollections,
      sourceSessionId: syncSessionId,
      revision,
      collectionVersions,
      pendingOperations: queueCounts().total,
      syncedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  saveSignalVersions({ ...readSignalVersions(), ...collectionVersions });
  return true;
}
async function safePublishSyncSignal(collections, status = "ok") {
  try {
    return await publishSyncSignal(collections, status);
  } catch (error) {
    lastErrorCode = errorCode(error) || "signal-publish-failed";
    lastError = friendlyError(error);
    console.error("[Sync signal publish]", {
      code: error?.code,
      message: error?.message,
    });
    return false;
  }
}

async function refreshBusinessContext() {
  const snapshot = await getDoc(doc(db, "businesses", activeBusinessId()));
  if (!snapshot.exists()) return false;
  const business = normalizeFirestoreData({
      id: snapshot.id,
      ...snapshot.data(),
    }),
    session = window.FirebaseSession;
  if (!session || business.active === false) return false;
  const context = window.BusinessContext?.set?.({
    business,
    userProfile: session.profile,
  });
  session.business = context?.business || business;
  session.subscription = context?.subscription || business.subscription;
  session.access = context?.access || session.access;
  dispatchEvent(
    new CustomEvent("cloud-data-updated", {
      detail: { collection: "businessProfile", count: 1, source: "cloud" },
    }),
  );
  return true;
}

async function refreshUserContext() {
  if (!currentUser?.uid) return false;
  const snapshot = await getDoc(doc(db, "users", currentUser.uid));
  if (!snapshot.exists()) return false;
  const profile = normalizeFirestoreData({
      id: snapshot.id,
      ...snapshot.data(),
    }),
    session = window.FirebaseSession;
  if (!session || (profile.uid && profile.uid !== currentUser.uid))
    return false;
  profile.uid ??= currentUser.uid;
  state.userProfile = profile;
  session.profile = profile;
  window.BusinessContext?.set?.({
    business: session.business,
    userProfile: profile,
  });
  dispatchEvent(
    new CustomEvent("cloud-data-updated", {
      detail: { collection: "userProfile", count: 1, source: "cloud" },
    }),
  );
  return true;
}
async function pullCloudCollections(options = {}) {
  await validateUser();
  const force = Boolean(options.force),
    full = Boolean(options.full),
    crmSources = new Set([
      "customerMetrics",
      "customerMonthlyMetrics",
      "customerSegments",
    ]),
    names = (options.names || (full ? CLOUD_NAMES : DEFAULT_PULL_NAMES)).filter(
      (name) =>
        !crmSources.has(name) ||
        window.OperationMode?.can?.("viewCRM") !== false,
    );
  if (!force && !full && Date.now() - lastPullAt < PULL_TTL_MS) return 0;
  let received = 0;
  const pullState = readPullState(),
    businessId = activeBusinessId();
  for (const name of names) {
    const markerKey = `${businessId}:${name}`,
      since = full ? "" : pullState[markerKey] || "",
      documents = since
        ? await repositories[name].listChangedSince(since, 500)
        : await repositories[name].listAllPaged(200);
    if (!since)
      state.cloudCounts[name] = documents.filter(
        (item) => !item.deletedAt,
      ).length;
    else if (documents.length)
      state.cloudCounts[name] = Math.max(
        0,
        Number(
          state.cloudCounts[name] ||
            (name === "settings" ? 1 : sourceItems(DB.carregar(), name).length),
        ),
      );
    state.cloudNewest[name] = newestTimestamp(documents);
    if (name === "clients" && !since)
      state.cloudFinancial.fiado = documents.reduce(
        (total, item) =>
          total + Math.abs(Math.min(0, Number(item?.saldo || 0))),
        0,
      );
    received += applyCloudCollection(name, documents, {
      authoritative: !since,
    });
    // Nunca avance o cursor usando o relógio do aparelho. Um celular com hora
    // adiantada poderia ignorar para sempre documentos gravados pelo servidor.
    pullState[markerKey] = newestTimestamp(documents) || since || "";
  }
  writePullState(pullState);
  lastPullAt = Date.now();
  emit({
    cloudCounts: { ...state.cloudCounts },
    cloudNewest: { ...state.cloudNewest },
    cloudFinancial: { ...state.cloudFinancial },
    received,
    hydrated: true,
  });
  return received;
}
async function loadProductVariants(parentProductId, options = {}) {
  const parentId = String(parentProductId || "").trim();
  if (!parentId) return [];
  await validateUser();
  const documents = await repositories.productVariants.listWhere(
    "parentProductId",
    parentId,
    Math.min(100, Math.max(1, Number(options.limit || 50))),
    { force: Boolean(options.force) },
  );
  applyCloudCollection("productVariants", documents);
  return documents;
}
async function findProductVariantByBarcode(barcode) {
  const normalized = String(barcode || "").replace(/\s/g, "");
  if (!normalized) return [];
  await validateUser();
  const documents = await repositories.productVariants.listWhere(
    "barcode",
    normalized,
    3,
    { force: true },
  );
  applyCloudCollection("productVariants", documents);
  return documents;
}
async function compareLocalAndCloud() {
  const local = localSummary(),
    remote = {
      clients: state.cloudCounts.clients ?? 0,
      products: state.cloudCounts.products ?? 0,
      sales: state.cloudCounts.sales ?? 0,
      payments: state.cloudCounts.payments ?? 0,
      fiado: Number(state.cloudFinancial.fiado || 0),
    };
  const countsMatch =
      local.clientes === remote.clients &&
      local.produtos === remote.products &&
      local.vendas === remote.sales &&
      local.pagamentos === remote.payments,
    balancesMatch = Math.abs(local.fiado - remote.fiado) < 0.01,
    comparison = {
      local,
      remote,
      countsMatch,
      balancesMatch,
      ok: queueCounts().total === 0 && countsMatch && balancesMatch,
      newestByCollection: { ...state.cloudNewest },
    };
  emit({ comparison });
  return comparison;
}
function describeSyncResult(result = {}) {
  if (result.offline)
    return "Sem conexão. As alterações continuam salvas neste aparelho.";
  const pending = Number(result.pending || 0),
    errors = Number(result.errors || 0),
    sent = Number(result.sent || 0);
  if (result.complete) return "Todos os dados estão sincronizados.";
  if (sent && (errors || pending))
    return `${sent} alteração(ões) sincronizada(s). ${errors || pending} ainda precisam de atenção.`;
  if (errors || pending)
    return `Sincronização incompleta: ${errors} alteração(ões) com erro e ${pending} pendente(s).`;
  if (result.comparison && !result.comparison.ok)
    return "Sincronização incompleta: os dados locais e da nuvem ainda divergem.";
  return "Sincronização incompleta. Tente novamente ou veja os detalhes.";
}
async function synchronizeNow() {
  const attemptTime = now();
  localStorage.setItem(lastAttemptKey(), attemptTime);
  emit({ lastAttempt: attemptTime });
  if (!navigator.onLine) {
    updateQueueState();
    const counts = queueCounts();
    return {
      offline: true,
      sent: 0,
      received: 0,
      pending: counts.pending,
      errors: counts.errors,
      queueTotal: counts.total,
      complete: false,
    };
  }
  cloudPaused = false;
  await validateUser();
  if (!state.testPassed) await testFirestoreConnection();
  migrateScopedQueueCompatibility();
  validateQueueOwnership();
  const push = await processSyncQueue({ force: true });
  if (push.paused && push.reason !== "subscription_read_only") {
    const counts = queueCounts(),
      result = {
        ...push,
        received: 0,
        comparison: null,
        pending: counts.pending,
        errors: counts.errors,
        queueTotal: counts.total,
        complete: false,
      };
    emit({ status: "error", message: describeSyncResult(result) });
    return result;
  }
  const received = await pullCloudCollections({ force: true, full: true }),
    comparison = await compareLocalAndCloud(),
    counts = queueCounts(),
    complete = counts.total === 0 && counts.errors === 0 && comparison.ok,
    time = now(),
    result = {
      ...push,
      received,
      comparison,
      pending: counts.pending,
      errors: counts.errors,
      queueTotal: counts.total,
      complete,
      attemptedAt: attemptTime,
    };
  if (push.sent || counts.errors)
    await safePublishSyncSignal(push.collections, counts.errors ? "error" : "ok");
  if (complete) {
    localStorage.setItem(lastSyncKey(), time);
    localStorage.setItem(lastCompleteKey(), time);
  }
  emit({
    status: complete ? "success" : "error",
    message: describeSyncResult(result),
    lastSync: complete ? time : state.lastSync,
    lastCompleteSync: complete ? time : state.lastCompleteSync,
    lastAttempt: attemptTime,
    progress: 100,
    sent: push.sent,
    received,
  });
  return result;
}
async function automaticSync() {
  quickTimer = null;
  if (!currentUser || !navigator.onLine || processingPromise || cloudPaused)
    return;
  try {
    if (!state.testPassed) await testFirestoreConnection();
    const push = await processSyncQueue(),
      received =
        document.visibilityState === "visible"
          ? await pullCloudCollections()
          : 0;
    if (push.sent || push.errors)
      await safePublishSyncSignal(push.collections, push.errors ? "error" : "ok");
    if (push.sent || received) {
      const time = now(),
        counts = queueCounts(),
        complete = counts.total === 0 && counts.errors === 0;
      localStorage.setItem(lastAttemptKey(), time);
      if (complete) {
        localStorage.setItem(lastSyncKey(), time);
        localStorage.setItem(lastCompleteKey(), time);
      }
      emit({
        status: complete ? "success" : counts.errors ? "error" : "waiting",
        message: complete
          ? "Todos os dados estão sincronizados."
          : describeSyncResult({
              sent: push.sent,
              pending: counts.pending,
              errors: counts.errors,
              complete: false,
            }),
        lastSync: complete ? time : state.lastSync,
        lastCompleteSync: complete ? time : state.lastCompleteSync,
        lastAttempt: time,
        sent: push.sent,
        received,
      });
    } else updateQueueState();
  } catch (error) {
    if (errorCode(error) === "resource-exhausted") cloudPaused = true;
    if (state.status !== "error") reportError(error, "Automatic sync");
  }
}
function scheduleImmediate() {
  clearTimeout(quickTimer);
  quickTimer = null;
  if (!currentUser || cloudPaused) return;
  quickTimer = setTimeout(automaticSync, 500);
}
function startAutoSync() {
  scheduleImmediate();
}
function stopAutoSync() {
  clearInterval(autoTimer);
  clearTimeout(quickTimer);
  autoTimer = null;
  quickTimer = null;
}
async function runFirebaseDiagnostic() {
  await validateUser();
  await ensureBusinessDocument();
  await testFirestoreConnection();
  return diagnostic();
}
function captureExternalChange(before, after) {
  return captureChanges(structuredClone(before), structuredClone(after));
}
function restoreWrites(data) {
  const writes = [];
  for (const name of Object.keys(SOURCES))
    for (const item of sourceItems(data, name))
      writes.push({
        entityType: name,
        entityId: String(item.id),
        operation: "create",
        before: null,
        data: { ...item, source: "backup_restore" },
      });
  writes.push({
    entityType: "settings",
    entityId: "default",
    operation: "create",
    before: null,
    data: { ...(data.config || {}), source: "backup_restore" },
  });
  return writes;
}
async function cloudRestoreSummary() {
  const data = {
    clientes: [],
    produtos: [],
    vendas: [],
    pagamentos: [],
    movimentacoes: [],
    movimentacoesEstoque: [],
    cobrancas: [],
    campanhas: [],
    progressosCampanha: [],
    recompensas: [],
    messageHistory: [],
    messageTemplates: [],
    messageSequences: [],
    contatosCliente: [],
    config: {},
  };
  for (const [name, source] of Object.entries(SOURCES))
    data[source.key] = await repositories[name].list();
  return {
    counts: window.BackupManager.counts(data),
    totals: window.BackupManager.totals(data),
  };
}
async function restoreBackupData(prepared, mode = "merge") {
  await validateUser();
  if (prepared.businessId !== activeBusinessId())
    throw Error("Este backup pertence a outro negócio.");
  if (mode === "replace" && state.userProfile?.role !== "admin")
    throw Object.assign(
      new Error("Somente o administrador pode substituir os dados do negócio."),
      { code: "permission-denied" },
    );
  stopAutoSync();
  stopCloudSubscriptions();
  if (processingPromise) await processingPromise;
  archiveQueue(`backup_restore_${mode}`);
  saveQueue([]);
  const current = structuredClone(DB.carregar()),
    merged = window.BackupManager.mergeData(current, prepared, mode),
    writes = restoreWrites(merged.data);
  if (mode === "replace" && navigator.onLine) {
    for (const name of CLOUD_NAMES) {
      const remote = await repositories[name].list(),
        targetIds = new Set(
          name === "settings"
            ? ["default"]
            : sourceItems(merged.data, name).map((item) => String(item.id)),
        );
      for (const item of remote)
        if (!targetIds.has(String(item.id)))
          writes.push({
            entityType: name,
            entityId: String(item.id),
            operation: "update",
            before: item,
            data: { active: false, deletedAt: now(), source: "backup_restore" },
          });
    }
  }
  applyingCloud = true;
  try {
    DB.salvar(merged.data);
  } finally {
    applyingCloud = false;
  }
  queueWrites(
    writes,
    `restore:${mode}:${prepared.backupId}`,
    `backup_restore_${mode}`,
    { source: "backup_restore", baseBackupId: prepared.backupId },
  );
  startCloudSubscriptions();
  startAutoSync();
  let sync = { sent: 0, pending: queueCounts().total, errors: 0, received: 0 };
  if (navigator.onLine) sync = await synchronizeNow();
  const finalData = DB.carregar(),
    duplicates = window.BackupManager.findDuplicates(finalData),
    localCounts = window.BackupManager.counts(finalData),
    localTotals = window.BackupManager.totals(finalData),
    cloud = navigator.onLine ? await cloudRestoreSummary() : null,
    matches = Boolean(
      cloud &&
      JSON.stringify(localCounts) === JSON.stringify(cloud.counts) &&
      Math.abs(localTotals.fiado - cloud.totals.fiado) < 0.01 &&
      Math.abs(localTotals.estoque - cloud.totals.estoque) < 0.01 &&
      Math.abs(localTotals.vendido - cloud.totals.vendido) < 0.01,
    ),
    report = {
      mode,
      backupId: prepared.backupId,
      added: merged.added,
      updated: merged.updated,
      duplicates: duplicates.length,
      counts: localCounts,
      totals: localTotals,
      cloudCounts: cloud?.counts || null,
      cloudTotals: cloud?.totals || null,
      matches,
      pending: queueCounts().total,
      sent: sync.sent || 0,
    };
  if (navigator.onLine)
    await setDoc(
      doc(
        db,
        "businesses",
        activeBusinessId(),
        "syncMetadata",
        `restore-${mode}-${prepared.backupId}`,
      ),
      {
        id: `restore-${mode}-${prepared.backupId}`,
        businessId: activeBusinessId(),
        ownerId: currentUser.uid,
        mode,
        source: "backup_restore",
        report: sanitizeForFirestore(report),
        restoredAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
  return report;
}
async function safeRestoreBackupData(prepared, mode = "merge") {
  try {
    return await restoreBackupData(prepared, mode);
  } finally {
    if (currentUser) {
      startCloudSubscriptions();
      startAutoSync();
    }
  }
}
async function clearLocalDevice(options = {}) {
  const pending = queueCounts().total;
  if (pending && !options.discard)
    throw Object.assign(
      new Error(`Existem ${pending} alterações ainda não sincronizadas.`),
      { code: "pending-operations", pending },
    );
  stopAutoSync();
  stopCloudSubscriptions();
  if (processingPromise) await processingPromise;
  if (pending) archiveQueue("local_device_clear_discarded");
  saveQueue([]);
  applyingCloud = true;
  try {
    DB.limpar();
  } finally {
    applyingCloud = false;
  }
  startCloudSubscriptions();
  startAutoSync();
  if (navigator.onLine) await pullCloudCollections();
  emit({
    status: navigator.onLine ? "success" : "offline",
    message: navigator.onLine
      ? "Dados da nuvem recarregados neste aparelho."
      : "Dados locais limpos. A nuvem será carregada quando houver conexão.",
  });
  return { discarded: pending, reloaded: navigator.onLine };
}
function setUser(user, profile = null, business = null) {
  currentUser = user || null;
  cloudPaused = false;
  readOnlyMode = Boolean(
    user && window.BusinessContext?.get?.().access?.readOnly,
  );
  const trustedBootstrap = Boolean(
    user &&
    profile?.uid === user.uid &&
    business?.id === profile.businessId &&
    business.active !== false,
  );
  lastUserValidationAt = trustedBootstrap ? Date.now() : 0;
  emit({
    authReady: true,
    userProfile: profile || null,
    businessDocument: trustedBootstrap,
    businessOwnerId: business?.ownerId || "",
    ownerMatches: Boolean(user && business?.ownerId === user.uid),
    testPassed: trustedBootstrap,
    lastSync: profile?.businessId
      ? localStorage.getItem(`adiFesta:${profile.businessId}:lastSync`) || ""
      : "",
    lastAttempt: profile?.businessId
      ? localStorage.getItem(`adiFesta:${profile.businessId}:lastSyncAttempt`) ||
        ""
      : "",
    lastCompleteSync: profile?.businessId
      ? localStorage.getItem(`adiFesta:${profile.businessId}:lastCompleteSync`) ||
        localStorage.getItem(`adiFesta:${profile.businessId}:lastSync`) ||
        ""
      : "",
  });
  if (!user) {
    readOnlyMode = false;
    stopAutoSync();
    stopCloudSubscriptions();
    emit({
      testPassed: false,
      businessDocument: false,
      status: "idle",
      message: "Sessão encerrada",
      cloudCounts: {},
      hydrated: false,
      listenerConnected: false,
    });
    return;
  }
  migrateLegacyQueue();
  migrateScopedQueueCompatibility();
  validateQueueOwnership();
  installOfflineFirstStorage();
  emit({ hydrated: false, listenerConnected: false });
  startCloudSubscriptions();
  startAutoSync();
  updateQueueState();
}
addEventListener("online", () => {
  emit({ status: "waiting", message: "Conexão recuperada. Sincronizando…" });
  scheduleImmediate();
});
addEventListener("offline", updateQueueState);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleImmediate();
});

window.FirestoreRepositories = repositories;
window.dataRepository = repositories;
window.getFirebaseDiagnostic = diagnostic;
window.SyncFirebase = {
  setUser,
  setAuthReady: (value) => emit({ authReady: Boolean(value) }),
  stop: () => setUser(null),
  subscribe: (callback) => {
    subscribers.add(callback);
    callback({
      ...state,
      ...queueCounts(),
      queueTotal: queueCounts().total,
      details: diagnostic(),
    });
    return () => subscribers.delete(callback);
  },
  sanitizeForFirestore,
  ensureBusinessDocument,
  testFirestoreConnection,
  runFirebaseDiagnostic,
  getFirebaseDiagnostic: diagnostic,
  getQueueDiagnostics: queueDiagnostics,
  describeResult: describeSyncResult,
  migrateQueueCompatibility: migrateScopedQueueCompatibility,
  processSyncQueue,
  synchronizeNow,
  syncAll: synchronizeNow,
  pushPendingOperations: processSyncQueue,
  pullCloudCollections,
  loadProductVariants,
  findProductVariantByBarcode,
  compare: compareLocalAndCloud,
  reconcileLocalAndCloud,
  startCloudSubscriptions,
  stopCloudSubscriptions,
  startAutoSync,
  stopAutoSync,
  schedule: scheduleImmediate,
  notifyRemoteChange: (collections) => publishSyncSignal(collections),
  captureExternalChange,
  restoreBackupData: safeRestoreBackupData,
  clearLocalDevice,
  archiveQueue,
  snapshot: localSummary,
  diagnostics: diagnostic,
  isReady: () => Boolean(currentUser),
  setScreen: setUsageScreen,
};
