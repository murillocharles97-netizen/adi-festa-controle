import { auth, db, PROJECT_ID } from "./firebase-config.js";
import {
  collection,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import { createFirestoreRepository } from "./firestore-repository.js?v=100";
import {
  normalizeFirestoreData,
  sanitizeForFirestore,
} from "./firestore-utils.js";
import { setUsageScreen, usageSnapshot } from "./usage-monitor.js";

const LEGACY_QUEUE_KEY = "adiFestaFirestoreQueue_v1",
  PULL_TTL_MS = 300000,
  PROFILE_TTL_MS = 300000,
  CLIENT_PROJECTION_EPOCH = 2,
  CLIENT_PROJECTION_CHECK_TTL_MS = 24 * 60 * 60 * 1000,
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
  campaignEvents: { key: "eventosCampanha" },
  campaignRedemptions: { key: "resgatesCampanha" },
  paymentAllocations: { key: "alocacoesPagamento" },
  customerSubscriptions: { key: "customerSubscriptions" },
  customerSubscriptionEvents: { key: "customerSubscriptionEvents" },
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
  eventosCampanha: "campaignEvents",
  resgatesCampanha: "campaignRedemptions",
  alocacoesPagamento: "paymentAllocations",
  renovacoesCliente: "customerSubscriptions",
  eventosRenovacao: "customerSubscriptionEvents",
  cobrancas: "charges",
  contatosCliente: "clientContacts",
  pedidos: "catalogOrders",
  configuracoes: "settings",
};
// Produtos continuam em tempo real porque participam diretamente do caixa.
// Clientes usam o sinal central e pull incremental por updatedAt, preservando
// a atualização entre aparelhos sem escutar a coleção inteira.
const REALTIME_NAMES = new Set(["products", "settings"]);
const IDEMPOTENT_EVENT_NAMES = new Set([
  "sales",
  "payments",
  "balanceAdjustments",
  "stockMovements",
  "rewards",
  "campaignEvents",
  "campaignRedemptions",
  "paymentAllocations",
  "customerSubscriptionEvents",
  "messageHistory",
  "messageSequences",
  "clientContacts",
]);
const CLOUD_NAMES = [...Object.keys(SOURCES), "settings"];
const SIGNAL_NAMES = [...CLOUD_NAMES, "businessProfile", "userProfile"];
// O boot precisa apenas dos dados que alimentam o dashboard. As demais
// coleções continuam chegando pelo sinal incremental ou por sincronização
// manual, sem varrer todo o histórico de uma conta nova no dispositivo.
const DEFAULT_PULL_NAMES = [
    "clients",
    "sales",
    "payments",
    "campaigns",
    "campaignProgress",
    "rewards",
    "campaignEvents",
    "campaignRedemptions",
    "paymentAllocations",
  ],
  INITIAL_FULL_NAMES = new Set(["clients", "campaigns"]),
  INITIAL_RECENT_LIMITS = {
    sales: 200,
    payments: 200,
    campaignProgress: 100,
    rewards: 100,
    campaignEvents: 200,
    campaignRedemptions: 100,
    paymentAllocations: 200,
    balanceAdjustments: 100,
    stockMovements: 100,
    charges: 100,
    messageHistory: 100,
    messageSequences: 50,
    clientContacts: 100,
    customerSegments: 100,
    visits: 50,
    catalogOrders: 100,
  };
const AUDIT_NAMES = [
    "products",
    "productVariants",
    "clients",
    "sales",
    "payments",
    "balanceAdjustments",
  ],
  FINANCIAL_AUDIT_NAMES = new Set([
    "sales",
    "payments",
    "balanceAdjustments",
  ]);
const repositories = Object.fromEntries(
    CLOUD_NAMES.map((name) => [name, createFirestoreRepository(name)]),
  ),
  financialEffectsRepository = createFirestoreRepository("balanceEvents"),
  syncSignalRepository = createFirestoreRepository("syncMetadata"),
  syncSessionId = crypto.randomUUID();
let currentUser = null,
  originalAlter = null,
  applyingCloud = false,
  processingPromise = null,
  automaticSyncPromise = null,
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
  listenerRegistry = new Map(),
  lastDataAuditRaw = null;
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
  snapshotMetadata: {},
  clientProjection: null,
  dataAudit: null,
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
    "financial-composite-incomplete":
      "Venda sincronizada, mas o saldo do cliente precisa de correção.",
    "financial-reconciliation-required":
      "Venda sincronizada, mas o saldo do cliente precisa de correção.",
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
const stableLegacyOperationId = (item = {}) => {
  if (item.operationId) return String(item.operationId);
  if (item.queueId) return `legacy:${String(item.queueId)}`;
  const source = JSON.stringify({
    businessId: item.businessId || "",
    entityType: item.entityType || "",
    entityId: item.entityId || "",
    createdAt: item.createdAtLocal || item.createdAt || "",
    writes: (item.payload?.writes || []).map((write) => ({
      entityType: write.entityType || write.collection || "",
      entityId: write.entityId || write.id || "",
      operation: write.operation || "update",
    })),
  });
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `legacy:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};
const queueSubtype = (item = {}) => {
  const kind = String(item.payload?.eventKind || "");
  if (kind && !["simple", "legacy"].includes(kind)) return kind;
  const names = new Set(
    (item.payload?.writes || []).map((write) => write.entityType),
  );
  if (names.has("payments")) return "payment_received";
  if (names.has("balanceAdjustments")) return "balance_adjustment";
  if (names.has("sales")) return "credit_sale";
  if (names.has("messageHistory")) return "message_history";
  if (names.has("clientContacts")) return "customer_contact";
  if (names.has("stockMovements")) return "stock_movement";
  return kind || "simple";
};
const roundedMoney = (value) => {
  const number = Number(value);
  return Number.isFinite(number) ? Number(number.toFixed(2)) : Number.NaN;
};
const financialVersionOf = (client = {}) =>
  Math.max(0, Number(client.financialVersion || 0));
function canonicalCreditSaleData(saleData, effect, remoteClient, localClient = {}) {
  const client = remoteClient || localClient,
    balanceBefore = roundedMoney(client.saldo || 0);
  return {
    ...saleData,
    saldoAnterior: balanceBefore,
    saldoAtual: roundedMoney(balanceBefore + Number(effect.balanceDelta)),
    financialVersionAnterior: financialVersionOf(client),
  };
}
const sameFinancialMoney = (left, right) =>
  Math.abs(roundedMoney(left) - roundedMoney(right)) < 0.005;
const evaluatePaymentConcurrency = (input) => {
  const evaluator = window.FinancialConcurrency?.evaluatePaymentConcurrency;
  if (typeof evaluator !== "function")
    throw Object.assign(
      new Error("A validação financeira desta versão não foi carregada."),
      { code: "payment-concurrency-evaluator-unavailable" },
    );
  return evaluator(input);
};
const balanceEffectId = (type, sourceId) =>
  `${type}:${String(sourceId || "").replaceAll("/", "_")}`;
function financialEffectFromWrites(
  writes = [],
  businessId,
  operationId,
  eventKind = "simple",
) {
  const sale = writes.find((write) => {
      if (write.entityType !== "sales") return false;
      const current = { ...(write.before || {}), ...(write.data || {}) },
        isUndo = Boolean(write.data?.deletedAt || write.data?.active === false),
        isCredit = String(current.status || "") === "fiado";
      return isCredit && (write.operation === "create" || isUndo);
    }),
    payment = writes.find(
      (write) =>
        write.entityType === "payments" && write.operation === "create",
    ),
    adjustment = writes.find(
      (write) =>
        write.entityType === "balanceAdjustments" &&
        write.operation === "create",
    );
  let source = null,
    type = "",
    customerId = "",
    amount = 0,
    delta = 0;
  if (sale) {
    const original = sale.before || {},
      current = { ...original, ...(sale.data || {}) },
      isUndo = Boolean(sale.data?.deletedAt || sale.data?.active === false),
      isCredit = String(current.status || "") === "fiado";
    if (isCredit && (sale.operation === "create" || isUndo)) {
      source = sale;
      type = isUndo ? "credit_sale_reversal" : "credit_sale";
      customerId = String(current.clienteId || current.customerId || "");
      amount = Math.abs(
        roundedMoney(current.valorFinal ?? current.valorTotal ?? 0),
      );
      delta = isUndo ? amount : -amount;
    }
  }
  if (!source && payment) {
    source = payment;
    type = "payment_received";
    customerId = String(
      payment.data?.clienteId || payment.data?.customerId || "",
    );
    amount = Math.abs(roundedMoney(payment.data?.valor ?? payment.data?.amount));
    delta = amount;
  }
  if (!source && adjustment) {
    source = adjustment;
    type = "balance_adjustment";
    customerId = String(
      adjustment.data?.clienteId || adjustment.data?.customerId || "",
    );
    delta = roundedMoney(
      Number(adjustment.data?.saldoNovo || 0) -
        Number(adjustment.data?.saldoAnterior || 0),
    );
    amount = Math.abs(delta);
  }
  if (!source || !customerId || !amount || !delta) return null;
  const sourceId = String(source.entityId || ""),
    id = balanceEffectId(type, sourceId);
  return {
    id,
    operationId: String(operationId),
    idempotencyKey: id,
    businessId,
    customerId,
    clientId: customerId,
    saleId: source.entityType === "sales" ? sourceId : null,
    sourceCollection: source.entityType,
    sourceDocumentId: sourceId,
    type,
    direction: delta < 0 ? "debit" : "credit",
    amount,
    balanceDelta: delta,
    eventKind,
    sourceCreatedAt:
      source.data?.data ||
      source.data?.createdAt ||
      source.before?.data ||
      source.before?.createdAt ||
      now(),
  };
}
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
const readQueueStrict = () => {
  const raw = localStorage.getItem(queueKey());
  if (!raw) return [];
  let parsed;
  try { parsed = JSON.parse(raw); } catch { /* keep the original data untouched */ }
  if (!Array.isArray(parsed))
    throw Error("A fila local está corrompida. Exporte o diagnóstico; nenhuma nova venda foi salva.");
  return parsed;
};
const saveQueue = (queue) => {
  readQueueStrict();
  localStorage.setItem(queueKey(), JSON.stringify(queue));
  updateQueueState();
};
const queueCounts = () => {
  try { readQueueStrict(); } catch {
    return { pending: 0, errors: 1, total: 1, corrupt: true };
  }
  const queue = readQueue();
  return {
    pending: queue.filter((item) => item.status !== "error").length,
    errors: queue.filter((item) => item.status === "error").length,
    total: queue.length,
  };
};
const knownOrphanKey = () => `veconi:known-only-local-sales:${activeBusinessId()}:${deviceId()}`;
const orphanReviewKey = () => `veconi:reviewed-only-local-sales:${activeBusinessId()}:${deviceId()}`;
function readKnownOrphanIds() {
  try {
    const parsed = JSON.parse(localStorage.getItem(knownOrphanKey()) || "[]");
    return new Set(Array.isArray(parsed) ? parsed.map(String) : []);
  } catch { return new Set(); }
}
function readOrphanReviews() {
  try {
    const parsed = JSON.parse(localStorage.getItem(orphanReviewKey()) || "{}");
    return parsed && !Array.isArray(parsed) && typeof parsed === "object" ? parsed : {};
  } catch { return {}; }
}
function isOrphanReviewed(sale) {
  const review = readOrphanReviews()[String(sale?.id || "")];
  return Boolean(review && review.operationId === String(sale.operationId || "") &&
    review.checksum === checksumValue(sale) && review.decision === "historical_reconciled");
}
function saleIntegrityDiagnostics() {
  if (!currentUser) return { count: 0, localWithoutQueue: [], queueWithoutLocal: [],
    onlyLocalAfterComparison: [], overdue: [], comparedAt: "" };
  const sales = DB.carregar().vendas || [],
    queue = readQueue(),
    byId = new Map(sales.map((sale) => [String(sale.id), sale])),
    queued = new Set(queue.flatMap((item) => (item.payload?.writes || [])
      .filter((write) => write.entityType === "sales" && write.operation === "create")
      .map((write) => String(write.entityId)))),
    localWithoutQueue = sales.filter((sale) => Number(sale.syncPipelineVersion || 0) >= 2 &&
      !sale.deletedAt && sale.active !== false && !sale.syncConfirmedAt &&
      !sale.financialAppliedAt && !queued.has(String(sale.id)))
      .map((sale) => ({ saleId: String(sale.id), operationId: String(sale.operationId || "") })),
    queueWithoutLocal = queue.flatMap((item) => (item.payload?.writes || [])
      .filter((write) => write.entityType === "sales" && write.operation === "create" &&
        !byId.has(String(write.entityId)))
      .map((write) => ({ saleId: String(write.entityId), operationId: String(item.operationId),
        status: item.status }))),
    onlyLocalAfterComparison = (state.dataAudit?.collections?.sales?.onlyLocal || [])
      .filter((item) => item.classification === "B" &&
        !byId.get(String(item.documentId))?.syncConfirmedAt &&
        !byId.get(String(item.documentId))?.financialAppliedAt)
      .map((item) => ({ saleId: String(item.documentId), operationId: String(item.operationId || "") })),
    overdue = queue.filter((item) => item.payload?.eventKind === "sale" &&
      Date.now() - (Date.parse(item.createdAtLocal || item.createdAt || "") || Date.now()) > 15 * 60 * 1000)
      .map((item) => ({ operationId: String(item.operationId), status: item.status }));
  return { count: new Set([...localWithoutQueue, ...queueWithoutLocal,
    ...onlyLocalAfterComparison].map((item) => item.saleId)).size,
    localWithoutQueue, queueWithoutLocal, onlyLocalAfterComparison, overdue,
    comparedAt: state.dataAudit?.generatedAt || "" };
}
function paymentIntegrityDiagnostics() {
  if (!currentUser) return { count: 0, localWithoutQueue: [], queueWithoutLocal: [],
    onlyLocalAfterComparison: [], overdue: [] };
  const payments = DB.carregar().pagamentos || [],
    queue = readQueue(),
    byId = new Set(payments.map((payment) => String(payment.id))),
    queued = new Set(queue.flatMap((item) => (item.payload?.writes || [])
      .filter((write) => write.entityType === "payments" && write.operation === "create")
      .map((write) => String(write.entityId)))),
    localWithoutQueue = payments.filter((payment) => Number(payment.syncPipelineVersion || 0) >= 2 &&
      !payment.syncConfirmedAt && payment.applicationStatus !== "applied" &&
      !queued.has(String(payment.id)))
      .map((payment) => ({ paymentId: String(payment.id), operationId: String(payment.operationId || "") })),
    queueWithoutLocal = queue.flatMap((item) => (item.payload?.writes || [])
      .filter((write) => write.entityType === "payments" && write.operation === "create" &&
        !byId.has(String(write.entityId)))
      .map((write) => ({ paymentId: String(write.entityId), operationId: String(item.operationId),
        status: item.status }))),
    onlyLocalAfterComparison = (state.dataAudit?.collections?.payments?.onlyLocal || [])
      .filter((item) => item.classification === "B" &&
        !(payments.find((payment) => String(payment.id) === String(item.documentId))?.syncConfirmedAt))
      .map((item) => ({ paymentId: String(item.documentId), operationId: String(item.operationId || "") })),
    overdue = queue.filter((item) => item.payload?.eventKind === "payment" &&
      Date.now() - (Date.parse(item.createdAtLocal || item.createdAt || "") || Date.now()) > 15 * 60 * 1000)
      .map((item) => ({ operationId: String(item.operationId), status: item.status }));
  return { count: new Set([...localWithoutQueue, ...queueWithoutLocal,
    ...onlyLocalAfterComparison].map((item) => item.paymentId)).size,
    localWithoutQueue, queueWithoutLocal, onlyLocalAfterComparison, overdue };
}
const queueErrorBreakdown = () => {
  const errors = readQueue().filter((item) => item.status === "error");
  return {
    permission: errors.filter((item) => item.lastErrorCode === "permission-denied").length,
    invalid: errors.filter((item) => item.lastErrorCode === "invalid-argument").length,
    structural: errors.filter((item) =>
      [
        "queue-owner-mismatch",
        "business-mismatch",
        "user-mismatch",
        "invalid-path",
        "empty-transaction",
        "legacy-payload-unsupported",
      ].includes(item.lastErrorCode),
    ).length,
  };
};
const queueDiagnostics = () =>
  readQueue().map((item) => ({
    operationId: String(item.operationId || item.queueId || ""),
    entityType: String(item.entityType || "unknown"),
    action: String(item.action || item.operation || "unknown"),
    documentId: String(item.entityId || ""),
    businessId: String(item.businessId || ""),
    firestorePath:
      item.lastErrorPath ||
      (item.businessId && item.entityType && item.entityId
        ? `businesses/${item.businessId}/${item.entityType}/${item.entityId}`
        : "indefinido"),
    createdAt: item.createdAtLocal || item.createdAt || "",
    lastAttemptAt: item.lastAttemptAt || "",
    retryCount: Number(item.retryCount || item.attempts || 0),
    errorCode: item.lastErrorCode || "",
    errorMessage: item.lastErrorMessage || "",
    payloadVersion: Number(item.payloadVersion || 1),
    schemaVersion: Number(item.schemaVersion || 1),
    deviceId: item.deviceId ? `${String(item.deviceId).slice(0, 6)}…` : "legado",
    origin: item.origin || item.source || "legado",
    status: item.status || "pending",
    subtype: item.subtype || queueSubtype(item),
    collection: String(item.payload?.writes?.[0]?.entityType || ""),
    paths: (item.payload?.writes || []).map((write) =>
      item.businessId && write.entityType && write.entityId
        ? `businesses/${item.businessId}/${write.entityType}/${write.entityId}`
        : "indefinido",
    ),
    currentBusinessId: String(state.userProfile?.businessId || ""),
    authUid: currentUser?.uid
      ? `${String(currentUser.uid).slice(0, 6)}…${String(currentUser.uid).slice(-4)}`
      : "—",
    role: String(state.userProfile?.role || ""),
    createdBeforeMultiTenant:
      Number(item.payloadVersion || 1) < PAYLOAD_VERSION ||
      ["legacy", "legacy_queue"].includes(item.origin || item.source),
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
const queuePreflight = (item) => {
  const businessId = activeBusinessId(),
    writes = Array.isArray(item.payload?.writes) ? item.payload.writes : [];
  if (!item.operationId)
    return { ok: false, code: "operation-id-missing", message: "OperationId ausente." };
  if (item.businessId !== businessId)
    return {
      ok: false,
      code: "business-mismatch",
      message: "O businessId da operação não corresponde à empresa atual.",
    };
  if (item.userId && item.userId !== currentUser?.uid)
    return {
      ok: false,
      code: "user-mismatch",
      message: "A operação pertence a outra sessão autenticada.",
    };
  if (!writes.length)
    return { ok: false, code: "empty-transaction", message: "A operação não possui gravações." };
  const invalid = writes.find(
    (write) =>
      !CLOUD_NAMES.includes(write.entityType) ||
      !String(write.entityId || "") ||
      !["create", "update"].includes(write.operation),
  );
  if (invalid)
    return {
      ok: false,
      code: "invalid-path",
      message: `Caminho não suportado: ${invalid.entityType || "coleção ausente"}.`,
    };
  return { ok: true };
};
const readPullState = () => {
  try {
    return JSON.parse(localStorage.getItem(pullStateKey())) || {};
  } catch {
    return {};
  }
};
const writePullState = (value) =>
  localStorage.setItem(pullStateKey(), JSON.stringify(value));
const clientProjectionKeys = (businessId = activeBusinessId()) => ({
  epoch: `${businessId}:clients:projectionEpoch`,
  checkedAt: `${businessId}:clients:projectionCheckedAt`,
  remoteCount: `${businessId}:clients:projectionRemoteCount`,
  projectedCount: `${businessId}:clients:projectionExpectedLocalCount`,
});
const projectionCheckDue = (value) => {
  const timestamp = new Date(value || 0).getTime(),
    elapsed = Date.now() - timestamp;
  return !timestamp || elapsed < 0 || elapsed >= CLIENT_PROJECTION_CHECK_TTL_MS;
};
const rememberSnapshotMetadata = (name, metadata) => {
  if (!metadata) return;
  state.snapshotMetadata[name] = {
    collection: metadata.collection || name,
    source: metadata.source || "unknown",
    fromCache: Boolean(metadata.fromCache),
    hasPendingWrites: Boolean(metadata.hasPendingWrites),
    documents: Number(metadata.documents || 0),
    readAt: metadata.readAt || now(),
  };
};
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
const stableComparable = (value) => {
  if (Array.isArray(value)) return value.map(stableComparable);
  if (!value || typeof value !== "object") return value;
  const ignored = new Set([
      "ownerId",
      "businessId",
      "source",
      "createdAt",
      "criadoEm",
      "updatedAt",
      "atualizadoEm",
      "serverUpdatedAt",
      "localUpdatedAt",
      "version",
      "revision",
      "schemaVersion",
      "idempotencyKey",
      "entityType",
      "action",
      "recoveryChecksum",
      "createdBy",
      "sourceDeviceId",
      "appliedAt",
      "financialAppliedAt",
      "financialOperationId",
      "financialRevision",
      "financialReconciledAt",
      "openBalance",
    ]),
    result = {};
  for (const key of Object.keys(value).sort())
    if (!ignored.has(key) && value[key] !== undefined)
      result[key] = stableComparable(value[key]);
  return result;
};
const checksumValue = (value) => {
  const source = JSON.stringify(stableComparable(sanitizeForFirestore(value)));
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, "0")}`;
};
const containsInvalidFirestoreValue = (value, seen = new WeakSet()) => {
  if (["undefined", "function", "symbol"].includes(typeof value)) return true;
  if (!value || typeof value !== "object") return false;
  if (seen.has(value)) return true;
  seen.add(value);
  if (Array.isArray(value))
    return value.some((item) => containsInvalidFirestoreValue(item, seen));
  return Object.values(value).some((item) =>
    containsInvalidFirestoreValue(item, seen),
  );
};
const recordTimestamp = (item = {}) =>
  item.updatedAt ||
  item.atualizadoEm ||
  item.data ||
  item.createdAt ||
  item.criadoEm ||
  "";
const auditRecord = (item, origin, entityType) => ({
  documentId: String(item?.id || ""),
  operationId: String(item?.operationId || item?.sourceOperationId || ""),
  businessId: String(item?.businessId || activeBusinessId()),
  createdAt: item?.createdAt || item?.criadoEm || item?.data || "",
  updatedAt: recordTimestamp(item),
  revision: item?.revision ?? item?.version ?? null,
  active: item?.active ?? item?.ativo ?? null,
  deleted: Boolean(item?.deletedAt),
  deletedAt: item?.deletedAt || "",
  checksum: checksumValue(item),
  origin,
  entityType,
});
const financialKey = (item = {}) =>
  String(item.operationId || item.sourceOperationId || item.id || "");
const collectionAuditKey = (name, item = {}) =>
  FINANCIAL_AUDIT_NAMES.has(name)
    ? financialKey(item)
    : String(item.id || "");
const duplicateOperationIds = (items = []) => {
  const counts = new Map();
  for (const item of items) {
    const id = financialKey(item);
    if (id) counts.set(id, Number(counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([operationId, count]) => ({ operationId, count }));
};
function classifyCollectionAudit(name, localItems, remoteItems, queue) {
  const localMap = new Map(),
    remoteMap = new Map(),
    queuedWrites = [];
  for (const item of localItems || []) {
    const key = collectionAuditKey(name, item);
    if (key) localMap.set(key, item);
  }
  for (const item of remoteItems || []) {
    const key = collectionAuditKey(name, item);
    if (key) remoteMap.set(key, item);
  }
  for (const queueItem of queue)
    for (const write of queueItem.payload?.writes || [])
      if (write.entityType === name)
        queuedWrites.push({ queueItem, write });
  const result = {
    entityType: name,
    localTotal: localMap.size,
    remoteTotal: remoteMap.size,
    onlyLocal: [],
    onlyRemote: [],
    divergent: [],
    equal: [],
    possibleDuplicates: {
      local: duplicateOperationIds(localItems),
      remote: duplicateOperationIds(remoteItems),
    },
    latestLocal: newestTimestamp(localItems),
    latestRemote: newestTimestamp(remoteItems),
  };
  for (const [key, item] of localMap) {
    const remote = remoteMap.get(key),
      metadata = auditRecord(item, "local", name),
      queueMatch = queuedWrites.find(
        ({ queueItem, write }) =>
          String(write.entityId) === String(item.id) ||
          String(queueItem.operationId || "") === financialKey(item),
      );
    if (!remote) {
      const canonicalPath = `businesses/${activeBusinessId()}/${name}/${item.id}`,
        actualPath = queueMatch
          ? `businesses/${queueMatch.queueItem.businessId}/${queueMatch.write.entityType}/${queueMatch.write.entityId}`
          : "";
      result.onlyLocal.push({
        ...metadata,
        classification: queueMatch
          ? actualPath === canonicalPath
            ? "A"
            : "C"
          : "B",
        queueOperationId: String(queueMatch?.queueItem?.operationId || ""),
        queueStatus: queueMatch?.queueItem?.status || "missing",
        destinationPath: canonicalPath,
        actualPath,
        reason: queueMatch
          ? actualPath === canonicalPath
            ? queueMatch.queueItem.lastErrorMessage || "Aguardando envio da fila."
            : "A operação aponta para um caminho diferente do canônico."
          : "Registro local sem operação correspondente na fila.",
      });
      continue;
    }
    const remoteMetadata = auditRecord(remote, "remote", name);
    if (
      metadata.checksum === remoteMetadata.checksum ||
      String(remote.recoveryChecksum || "") === metadata.checksum
    )
      result.equal.push(metadata);
    else
      result.divergent.push({
        classification: "E",
        documentId: metadata.documentId,
        operationId: metadata.operationId || remoteMetadata.operationId,
        local: metadata,
        remote: remoteMetadata,
        hasPendingLocal: Boolean(queueMatch),
      });
  }
  for (const [key, item] of remoteMap)
    if (!localMap.has(key))
      result.onlyRemote.push(auditRecord(item, "remote", name));
  return result;
}
async function indexedDbInventory() {
  if (!globalThis.indexedDB?.databases) return [];
  const databases = await indexedDB.databases().catch(() => []),
    inventory = [];
  for (const info of databases) {
    if (!info.name) continue;
    const entry = { name: info.name, version: info.version || null, stores: [] };
    try {
      const database = await new Promise((resolve, reject) => {
        const request = indexedDB.open(info.name);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        request.onupgradeneeded = () => request.transaction?.abort();
      });
      for (const storeName of [...database.objectStoreNames]) {
        let count = null;
        try {
          count = await new Promise((resolve, reject) => {
            const request = database
              .transaction(storeName, "readonly")
              .objectStore(storeName)
              .count();
            request.onsuccess = () => resolve(request.result);
            request.onerror = () => reject(request.error);
          });
        } catch {}
        entry.stores.push({ name: storeName, count });
      }
      database.close();
    } catch {
      entry.unavailable = true;
    }
    inventory.push(entry);
  }
  return inventory;
}
const diagnostic = () => {
  const q = queueCounts(),
    saleIntegrity = saleIntegrityDiagnostics(),
    paymentIntegrity = paymentIntegrityDiagnostics(),
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
    queueStorageCorrupt: Boolean(q.corrupt),
    orphanOperations: saleIntegrity.count + paymentIntegrity.count,
    saleIntegrity,
    paymentIntegrity,
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
    deviceId: deviceId(),
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
    dataAudit: state.dataAudit || null,
    snapshotMetadata: structuredClone(state.snapshotMetadata || {}),
    clientProjection: state.clientProjection
      ? structuredClone(state.clientProjection)
      : null,
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
  snapshot.orphanOperations = snapshot.details.orphanOperations ||
    (state.dataAudit ? 0 : "Não verificado");
  subscribers.forEach((callback) => callback(snapshot));
  dispatchEvent(new CustomEvent("firebase-sync-status", { detail: snapshot }));
};
function updateQueueState() {
  const q = queueCounts();
  if (!currentUser) return;
  if (q.corrupt) {
    emit({ status: "error", message: "Fila local ilegível. Exporte o diagnóstico; a sincronização foi bloqueada." });
    return;
  }
  const orphanCount = saleIntegrityDiagnostics().count + paymentIntegrityDiagnostics().count;
  if (!navigator.onLine)
    emit({
      status: "offline",
      message: orphanCount
        ? `Offline — ${orphanCount} operação(ões) somente locais para revisão`
        : q.total
        ? `Offline — ${q.total} alteração(ões) pendente(s)`
        : "Offline — salvo no aparelho",
    });
  else if (orphanCount && state.status !== "syncing")
    emit({ status: "error", message: `${orphanCount} operação(ões) somente locais sem confirmação na última análise. Revise o diagnóstico.` });
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
      "image",
      "imageMode",
      "imageUrl",
      "imageStoragePath",
      "imageThumbUrl",
      "imageThumbStoragePath",
      "imageUpdatedAt",
      "imageUploadStatus",
      "imageOperationId",
      "createdAt",
    ]);
    for (const key of Object.keys(clean)) if (!allowed.has(key)) delete clean[key];
  }
  if (IDEMPOTENT_EVENT_NAMES.has(name) && !clean.operationId && clean.id)
    clean.operationId = clean.id;
  return clean;
}
function cloudPayload(name, id, data, creating = false) {
  const clean = enrich(name, data),
    businessId = activeBusinessId();
  delete clean.version;
  if (IDEMPOTENT_EVENT_NAMES.has(name)) {
    clean.operationId ||= String(id);
    clean.idempotencyKey ||= clean.operationId;
    clean.entityType ||= name;
    clean.action ||= creating ? "create" : "update";
  }
  return sanitizeForFirestore({
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
  });
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
    copy.queueId ||= crypto.randomUUID();
    copy.operationId = stableLegacyOperationId(copy);
    copy.idempotencyKey = copy.operationId;
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
      const entityId = String(write.entityId || write.id || ""),
        clean = sanitizeForFirestore(write.data || {}) || {};
      if (IDEMPOTENT_EVENT_NAMES.has(entityType)) {
        clean.operationId ||= copy.operationId;
        clean.idempotencyKey ||= clean.operationId;
        clean.businessId ||= copy.businessId;
        clean.entityType ||= entityType;
        clean.action ||= write.operation || "update";
        clean.createdAt ||= clean.data || copy.createdAtLocal || copy.createdAt || now();
        clean.schemaVersion ||= 3;
      }
      return {
        ...write,
        entityType,
        entityId,
        operation: write.operation === "create" ? "create" : "update",
        data: clean,
      };
    });
    copy.entityType =
      QUEUE_ENTITY_ALIASES[copy.entityType] || copy.entityType || "unknown";
    copy.subtype = queueSubtype(copy);
    copy.entityId ||= copy.payload.writes.length === 1
      ? copy.payload.writes[0].entityId
      : copy.operationId;
    copy.action ||= copy.payload.writes.length === 1
      ? copy.payload.writes[0].operation
      : "transaction";
    const invalidWrite = copy.payload.writes.find(
      (write) =>
        !CLOUD_NAMES.includes(write.entityType) || !String(write.entityId || ""),
    );
    if (invalidWrite) {
      blocked++;
      copy.status = "error";
      copy.lastErrorCode = "legacy-payload-unsupported";
      copy.lastErrorMessage = `Operação legada preservada: coleção ${invalidWrite.entityType || "indefinida"} não reconhecida.`;
    } else if (
      copy.status === "syncing" ||
      ["invalid-argument", "legacy-payload-unsupported"].includes(
        copy.lastErrorCode,
      )
    ) {
      copy.status = "pending";
      copy.lastErrorCode = null;
      copy.lastErrorMessage = null;
      migrated++;
    }
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
  const queue = readQueueStrict(),
    businessId = activeBusinessId(),
    stableOperationId = String(operationId || crypto.randomUUID()),
    existingOperationIds = new Set(
      queue.map((item) => String(item.operationId || "")),
    );
  let queuedWrites = 0;
  for (let index = 0; index < writes.length; index += MAX_WRITES) {
    const part = writes.slice(index, index + MAX_WRITES).map((write) => ({
        ...write,
        entityId: String(write.entityId || ""),
        operation: write.operation === "create" ? "create" : "update",
        data: sanitizeForFirestore(write.data || {}) || {},
      })),
      id =
        writes.length > MAX_WRITES
          ? `${stableOperationId}:${index / MAX_WRITES}`
          : stableOperationId,
      action = part.length === 1 ? part[0].operation : "transaction",
      createdAt = now();
    if (existingOperationIds.has(id)) continue;
    const queued = {
      queueId: crypto.randomUUID(),
      operationId: id,
      idempotencyKey: id,
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
      status: options.status || "pending",
      lastAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    };
    queued.subtype = queueSubtype(queued);
    queue.push(queued);
    existingOperationIds.add(id);
    queuedWrites += part.length;
  }
  saveQueue(queue);
  if (queuedWrites && options.schedule !== false) scheduleImmediate();
  return queuedWrites;
}
function resumePreparedSales(operationId = "") {
  const queue = readQueueStrict(),
    prepared = queue.filter((item) => item.status === "local_preparing" &&
      ["sale-write-ahead", "payment-write-ahead"].includes(item.source) &&
      (!operationId || String(item.operationId) === String(operationId)));
  if (!prepared.length) return 0;
  const data = DB.carregar();
  let promoted = 0;
  for (const item of prepared) {
    if (item.source === "payment-write-ahead") {
      const paymentWrite = (item.payload?.writes || []).find((entry) =>
          entry.entityType === "payments" && entry.operation === "create"),
        payment = (data.pagamentos || []).find((entry) =>
          String(entry.id) === String(paymentWrite?.entityId) &&
          String(entry.operationId) === String(item.operationId)),
        client = (data.clientes || []).find((entry) =>
          String(entry.id) === String(payment?.clienteId));
      if (payment && client && financialVersionOf(client) >=
        Number(payment.expectedFinancialVersion || 0) + 1) {
        item.status = "pending";
        promoted++;
      } else {
        item.status = "error";
        item.lastErrorCode = "local-operation-missing";
        item.lastErrorMessage = "A fila foi preparada, mas o recebimento local não foi confirmado.";
      }
      continue;
    }
    const write = (item.payload?.writes || []).find((entry) =>
      entry.entityType === "sales" && entry.operation === "create"),
      sale = (data.vendas || []).find((entry) => String(entry.id) === String(write?.entityId) &&
        String(entry.operationId) === String(item.operationId)),
      client = (data.clientes || []).find((entry) => String(entry.id) === String(sale?.clienteId)),
      credit = sale?.formaPagamento === "fiado" || sale?.status === "fiado";
    if (sale && (!credit || (client &&
      financialVersionOf(client) >= Number(sale.financialVersionAnterior || 0) + 1))) {
      item.status = "pending";
      promoted++;
    } else {
      item.status = "error";
      item.lastErrorCode = "local-operation-missing";
      item.lastErrorMessage = "A fila foi preparada, mas a venda local não foi confirmada. Revisão técnica necessária.";
    }
  }
  saveQueue(queue);
  if (promoted) scheduleImmediate();
  return promoted;
}
function createPaymentOperation(before, after, payment) {
  if (!currentUser || readOnlyMode || !DB.__firebaseSyncWrapped)
    throw Error("A sincronização financeira não está pronta. Nenhum pagamento foi salvo.");
  if (!payment?.operationId || !payment?.id || payment.idempotencyKey !== payment.operationId)
    throw Error("O recebimento precisa de identificador idempotente.");
  const writes = diffWrites(before, after),
    paymentWrites = writes.filter((write) => write.entityType === "payments" && write.operation === "create"),
    clientWrite = writes.find((write) => write.entityType === "clients" &&
      String(write.entityId) === String(payment.clienteId));
  if (writes.length > MAX_WRITES || paymentWrites.length !== 1 ||
    String(paymentWrites[0].entityId) !== String(payment.id) ||
    String(paymentWrites[0].data?.operationId) !== String(payment.operationId) ||
    !clientWrite || !Number.isFinite(Number(clientWrite.data?.saldo)) ||
    Number(clientWrite.data.financialVersion) !== Number(payment.expectedFinancialVersion) + 1)
    throw Error("Recebimento e saldo não formam uma operação financeira única. Nenhum pagamento foi salvo.");
  const existing = readQueueStrict().filter((item) => String(item.operationId) === String(payment.operationId));
  if (existing.length) {
    const localPayment = (DB.carregar().pagamentos || []).some((entry) =>
      String(entry.operationId) === String(payment.operationId));
    if (localPayment || existing.some((item) => item.source !== "payment-write-ahead" ||
      !["error", "local_preparing"].includes(item.status)))
      throw Error("Este recebimento já existe na fila. Revise a sincronização antes de repetir.");
    saveQueue(readQueueStrict().filter((item) => String(item.operationId) !== String(payment.operationId)));
  }
  const queued = queueWrites(writes, payment.operationId, "payment",
    { status: "local_preparing", schedule: false, source: "payment-write-ahead" });
  if (queued !== writes.length)
    throw Error("A fila do recebimento não foi criada por completo. Nenhum pagamento foi salvo.");
  DB.salvar(after);
  resumePreparedSales(payment.operationId);
  assertPaymentTracked(payment);
  dispatchEvent(new CustomEvent("financial-state-updated", {
    detail: { collection: "clients", clientId: payment.clienteId, operationId: payment.operationId },
  }));
  return payment;
}
function createSaleOperation(before, after, sale) {
  if (!currentUser || readOnlyMode || !DB.__firebaseSyncWrapped)
    throw Error("A sincronização de vendas não está pronta. Nenhuma venda foi salva.");
  if (!sale?.operationId || !sale?.id || sale.idempotencyKey !== sale.operationId)
    throw Error("A venda precisa de identificador idempotente antes de ser salva.");
  const writes = diffWrites(before, after),
    saleWrites = writes.filter((write) => write.entityType === "sales" && write.operation === "create"),
    credit = sale.status === "fiado" || sale.formaPagamento === "fiado",
    clientWrite = writes.find((write) => write.entityType === "clients" &&
      String(write.entityId) === String(sale.clienteId));
  if (writes.length > MAX_WRITES || saleWrites.length !== 1 ||
    String(saleWrites[0].entityId) !== String(sale.id) ||
    String(saleWrites[0].data?.operationId) !== String(sale.operationId) ||
    (credit && (!clientWrite || !Number.isFinite(Number(clientWrite.data?.saldo)) ||
      Number(clientWrite.data.financialVersion) !== Number(sale.financialVersionAnterior) + 1)))
    throw Error("Venda e saldo não formam uma operação financeira única. Nenhuma venda foi salva.");
  const existing = readQueueStrict().filter((item) => String(item.operationId) === String(sale.operationId));
  if (existing.length) {
    const localSale = (DB.carregar().vendas || []).some((entry) =>
      String(entry.operationId) === String(sale.operationId));
    if (localSale || existing.some((item) => item.source !== "sale-write-ahead" ||
      !["error", "local_preparing"].includes(item.status)))
      throw Error("Esta operação já existe na fila. Revise a sincronização antes de repetir.");
    saveQueue(readQueueStrict().filter((item) => String(item.operationId) !== String(sale.operationId)));
  }
  const queued = queueWrites(writes, sale.operationId, "sale",
    { status: "local_preparing", schedule: false, source: "sale-write-ahead" });
  if (queued !== writes.length)
    throw Error("A fila da venda não foi criada por completo. Nenhuma venda foi salva.");
  // localStorage não oferece transação entre chaves: a entrada write-ahead é
  // durável antes do único write que publica venda, saldo e estoque locais.
  DB.salvar(after);
  resumePreparedSales(sale.operationId);
  assertSaleTracked(sale);
  dispatchEvent(new CustomEvent("financial-state-updated", {
    detail: { collection: "clients", clientId: sale.clienteId, operationId: sale.operationId },
  }));
  return sale;
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
    saleLifecycleWrite = writes.find(
      (write) =>
        write.entityType === "sales" &&
        (write.operation === "create" ||
          write.data?.deletedAt ||
          write.data?.active === false),
    ),
    paymentCreateWrite = writes.find(
      (write) =>
        write.entityType === "payments" && write.operation === "create",
    ),
    eventKind = saleLifecycleWrite
      ? saleLifecycleWrite.data?.deletedAt ||
        saleLifecycleWrite.data?.active === false
        ? "sale_undo"
        : "sale"
      : paymentCreateWrite
        ? "payment"
        : writes.some((write) => write.entityType === "campaignRedemptions")
          ? "campaign_redemption"
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
    operationId = stableLegacyOperationId(item),
    marker = doc(
      db,
      "businesses",
      businessId,
      "processedOperations",
      operationId,
    ),
    writes = item.payload.writes || [],
    transactional = [
      "sale",
      "payment",
      "balance_adjustment",
      "stock_entry",
      "stock_adjustment",
      "sale_undo",
      "campaign_redemption",
    ].includes(item.payload.eventKind),
    deltaEntities = ["clients", "products", "productVariants", "campaignProgress"],
    eventKind = item.payload.eventKind || item.subtype || "simple",
    financialEffect = financialEffectFromWrites(
      writes,
      businessId,
      operationId,
      eventKind,
    ),
    paymentWrite = writes.find(
      (write) =>
        write.entityType === "payments" && write.operation === "create",
    ),
    confirmedConflictId = String(
      paymentWrite?.data?.confirmedConflictId || "",
    ),
    financialEffectReference = financialEffect
      ? doc(
          db,
          "businesses",
          businessId,
          "balanceEvents",
          financialEffect.id,
        )
      : null;
  let transactionOutcome = null;
  if (
    financialEffect &&
    !writes.some(
      (write) =>
        write.entityType === "clients" &&
        String(write.entityId) === financialEffect.customerId,
    )
  )
    throw Object.assign(
      new Error(
        "A operação financeira não contém a atualização do saldo do cliente.",
      ),
      { code: "financial-composite-incomplete" },
    );
  await runTransaction(db, async (transaction) => {
    const processed = await transaction.get(marker);
    if (processed.exists()) return;
    const snapshots = new Map();
    for (const write of writes)
      if (
        (transactional && deltaEntities.includes(write.entityType)) ||
        (IDEMPOTENT_EVENT_NAMES.has(write.entityType) &&
          write.data?.operationId)
      ) {
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
    const campaignIds = [...new Set(writes
      .filter((write) => write.entityType === "campaignProgress")
      .map((write) => String(write.data?.campaignId || write.before?.campaignId || ""))
      .filter(Boolean))];
    for (const campaignId of campaignIds) {
      const reference = doc(db, "businesses", businessId, "campaigns", campaignId);
      snapshots.set(`campaigns:${campaignId}`, await transaction.get(reference));
    }
    const financialEffectSnapshot = financialEffectReference
      ? await transaction.get(financialEffectReference)
      : null;
    const confirmedConflictReference = confirmedConflictId
        ? doc(
            db,
            "businesses",
            businessId,
            "payments",
            confirmedConflictId,
          )
        : null,
      confirmedConflictSnapshot = confirmedConflictReference
        ? await transaction.get(confirmedConflictReference)
        : null;
    const alreadyApplied = writes.some((write) => {
      if (!IDEMPOTENT_EVENT_NAMES.has(write.entityType)) return false;
      const snapshot = snapshots.get(`${write.entityType}:${write.entityId}`);
      return (
        snapshot?.exists() &&
        String(snapshot.data()?.operationId || "") === operationId
      );
    });
    if (financialEffect?.type === "payment_received" && paymentWrite) {
      const paymentSnapshot = snapshots.get(
          `payments:${paymentWrite.entityId}`,
        ),
        existingPayment = paymentSnapshot?.exists()
          ? paymentSnapshot.data() || {}
          : null,
        clientSnapshot = snapshots.get(
          `clients:${financialEffect.customerId}`,
        ),
        remoteClient = clientSnapshot?.exists()
          ? clientSnapshot.data() || {}
          : {},
        expectedBalance = roundedMoney(
          paymentWrite.data?.expectedBalance ??
            paymentWrite.data?.saldoAnterior,
        ),
        expectedFinancialVersion = Math.max(
          0,
          Number(paymentWrite.data?.expectedFinancialVersion || 0),
        ),
        actualBalance = roundedMoney(remoteClient.saldo || 0),
        actualFinancialVersion = financialVersionOf(remoteClient),
        stateDependent =
          paymentWrite.data?.financialStateDependent === true,
        requestedAmount = Math.abs(
          roundedMoney(
            paymentWrite.data?.requestedAmount ?? financialEffect.amount,
          ),
        ),
        paymentMode =
          paymentWrite.data?.paymentMode === "total" ? "total" : "partial",
        concurrency = stateDependent
          ? evaluatePaymentConcurrency({
              expectedBalance,
              currentBalance: actualBalance,
              requestedAmount,
              paymentMode,
              expectedFinancialVersion,
              currentFinancialVersion: actualFinancialVersion,
            })
          : null,
        confirmedOverride = Boolean(confirmedConflictId);
      if (concurrency)
        console.info("[PAYMENT_CONCURRENCY_CHECK]", {
          clientId: financialEffect.customerId,
          expectedBalanceCents: concurrency.expectedBalanceCents,
          currentBalanceCents: concurrency.currentBalanceCents,
          requestedAmountCents: concurrency.requestedAmountCents,
          paymentMode,
          expectedFinancialVersion,
          currentFinancialVersion: actualFinancialVersion,
          decision: confirmedOverride ? "confirmed_override" : concurrency.decision,
          reason: confirmedOverride
            ? "MERCHANT_CONFIRMED_SECOND_REAL_PAYMENT"
            : concurrency.reason,
        });
      if (
        existingPayment?.status === "conflict" &&
        String(existingPayment.operationId || "") === operationId &&
        concurrency?.decision === "conflict" &&
        !confirmedOverride
      ) {
        transactionOutcome = {
          status: "financial_conflict",
          paymentId: String(paymentWrite.entityId),
          clientId: financialEffect.customerId,
          clientName:
            paymentWrite.data?.clienteNome || remoteClient.nome || "",
          amount: financialEffect.amount,
          expectedBalance: roundedMoney(
            existingPayment.expectedBalance ?? expectedBalance,
          ),
          actualBalance: roundedMoney(
            existingPayment.conflictActualBalance ?? actualBalance,
          ),
          expectedFinancialVersion: Number(
            existingPayment.expectedFinancialVersion ??
              expectedFinancialVersion,
          ),
          actualFinancialVersion: Number(
            existingPayment.conflictActualFinancialVersion ??
              actualFinancialVersion,
          ),
          reason:
            existingPayment.conflictReason || concurrency?.reason || "conflict",
          resultingBalance:
            existingPayment.conflictResultingBalance ??
            concurrency?.resultingBalance,
          creditCreated:
            existingPayment.conflictCreditCreated ?? concurrency?.creditCreated,
        };
        return;
      }
      if (confirmedConflictId) {
        const conflict = confirmedConflictSnapshot?.exists()
          ? confirmedConflictSnapshot.data() || {}
          : null;
        if (
          !conflict ||
          conflict.status !== "conflict" ||
          String(conflict.clienteId || conflict.clientId || "") !==
            financialEffect.customerId ||
          !sameFinancialMoney(
            conflict.valor ?? conflict.amount,
            financialEffect.amount,
          )
        )
          throw Object.assign(
            new Error("O conflito de pagamento não está mais disponível."),
            { code: "payment-conflict-resolution-stale" },
          );
      }
      if (concurrency?.decision === "conflict" && !confirmedOverride) {
        currentPath = `businesses/${businessId}/payments/${paymentWrite.entityId}`;
        transaction.set(
          doc(
            db,
            "businesses",
            businessId,
            "payments",
            String(paymentWrite.entityId),
          ),
          sanitizeForFirestore({
            ...paymentWrite.data,
            id: String(paymentWrite.entityId),
            operationId,
            idempotencyKey: operationId,
            businessId,
            ownerId: currentUser.uid,
            status: "conflict",
            applicationStatus: "not_applied",
            conflictReason: concurrency.reason,
            conflictDetectedAt: serverTimestamp(),
            conflictActualBalance: actualBalance,
            conflictActualFinancialVersion: actualFinancialVersion,
            conflictResultingBalance: concurrency.resultingBalance,
            conflictCreditCreated: concurrency.creditCreated,
            allocations: [],
            campaignConfirmations: [],
            allocatedAmount: 0,
            legacyAmount: 0,
            financialAppliedAt: null,
            financialOperationId: null,
            updatedAt: serverTimestamp(),
            createdAt:
              paymentWrite.data?.createdAt ||
              paymentWrite.data?.data ||
              serverTimestamp(),
            schemaVersion: 3,
            version: 1,
          }),
          { merge: true },
        );
        transactionOutcome = {
          status: "financial_conflict",
          paymentId: String(paymentWrite.entityId),
          clientId: financialEffect.customerId,
          clientName:
            paymentWrite.data?.clienteNome || remoteClient.nome || "",
          amount: financialEffect.amount,
          expectedBalance,
          actualBalance,
          expectedFinancialVersion,
          actualFinancialVersion,
          reason: concurrency.reason,
          resultingBalance: concurrency.resultingBalance,
          creditCreated: concurrency.creditCreated,
          paymentMode,
        };
        return;
      }
      const campaignSensitiveWrites = writes.some((write) =>
        [
          "sales",
          "campaignProgress",
          "campaignEvents",
          "paymentAllocations",
        ].includes(write.entityType),
      );
      if (
        concurrency?.decision === "apply_adjusted" &&
        campaignSensitiveWrites &&
        !confirmedOverride
      ) {
        transactionOutcome = {
          status: "financial_payment_adjustment_required",
          paymentId: String(paymentWrite.entityId),
          clientId: financialEffect.customerId,
          clientName:
            paymentWrite.data?.clienteNome || remoteClient.nome || "",
          requestedAmount: concurrency.requestedAmount,
          effectiveAmount: concurrency.effectiveAmount,
          expectedBalance,
          actualBalance,
          resultingBalance: concurrency.resultingBalance,
          expectedFinancialVersion,
          actualFinancialVersion,
          paymentMode,
          reason: concurrency.reason,
        };
        return;
      }
      const effectiveAmount = confirmedOverride
          ? Math.abs(roundedMoney(financialEffect.amount))
          : concurrency?.effectiveAmount ?? financialEffect.amount,
        resultingBalance = roundedMoney(actualBalance + effectiveAmount),
        clientWrite = writes.find(
          (write) =>
            write.entityType === "clients" &&
            String(write.entityId) === String(financialEffect.customerId),
        );
      financialEffect.amount = effectiveAmount;
      financialEffect.balanceDelta = effectiveAmount;
      paymentWrite.data = {
        ...paymentWrite.data,
        valor: effectiveAmount,
        requestedAmount,
        effectiveAmount,
        paymentMode,
        saldoAnterior: actualBalance,
        saldoNovo: resultingBalance,
        financialVersionAfter: actualFinancialVersion + 1,
        concurrencyDecision: confirmedOverride
          ? "confirmed_override"
          : concurrency?.decision || "apply",
        concurrencyReason: confirmedOverride
          ? "MERCHANT_CONFIRMED_SECOND_REAL_PAYMENT"
          : concurrency?.reason || "CURRENT_STATE_MATCH",
      };
      if (clientWrite?.before && clientWrite?.data)
        clientWrite.data = {
          ...clientWrite.data,
          saldo: roundedMoney(
            Number(clientWrite.before.saldo ?? expectedBalance) +
              effectiveAmount,
          ),
        };
      if (concurrency?.decision === "apply_adjusted")
        transactionOutcome = {
          status: "financial_payment_applied_adjusted",
          paymentId: String(paymentWrite.entityId),
          clientId: financialEffect.customerId,
          effectiveAmount,
          requestedAmount,
          resultingBalance,
          reason: concurrency.reason,
        };
    }
    if (eventKind === "campaign_redemption" && !alreadyApplied) {
      const progressWrite = writes.find((write) => write.entityType === "campaignProgress");
      if (!progressWrite?.before) {
        throw Object.assign(new Error("O resgate não contém a projeção anterior da campanha."), {
          code: "campaign-redemption-incomplete",
        });
      }
      const progressSnapshot = snapshots.get(`campaignProgress:${progressWrite.entityId}`);
      if (!progressSnapshot?.exists()) {
        throw Object.assign(new Error("O progresso da campanha não existe mais na nuvem."), {
          code: "campaign-progress-not-found",
        });
      }
      const remoteProgress = progressSnapshot.data() || {};
      for (const field of ["availablePoints", "availableRewards"]) {
        if (!Number.isFinite(Number(progressWrite.data?.[field])) || !Number.isFinite(Number(progressWrite.before?.[field]))) continue;
        const delta = Number(progressWrite.data[field]) - Number(progressWrite.before[field]);
        if (delta < 0 && Number(remoteProgress[field] || 0) + delta < 0) {
          throw Object.assign(new Error(field === "availablePoints" ? "Os pontos já foram utilizados em outro dispositivo." : "A recompensa já foi resgatada em outro dispositivo."), {
            code: "campaign-redemption-conflict",
          });
        }
      }
      for (const write of writes.filter((entry) => ["products", "productVariants"].includes(entry.entityType) && entry.before)) {
        const field = write.entityType === "productVariants" ? "stock" : "estoqueAtual";
        if (!Number.isFinite(Number(write.data?.[field])) || !Number.isFinite(Number(write.before?.[field]))) continue;
        const delta = Number(write.data[field]) - Number(write.before[field]);
        if (delta >= 0) continue;
        const remote = snapshots.get(`${write.entityType}:${write.entityId}`)?.data() || {};
        const allowsNegative = write.entityType === "productVariants" ? remote.allowNegativeStock === true : remote.semControleEstoque === true;
        if (!allowsNegative && Number(remote[field] || 0) + delta < 0) {
          throw Object.assign(new Error("O estoque da recompensa foi alterado em outro dispositivo."), {
            code: "campaign-stock-conflict",
          });
        }
      }
    }
    if (financialEffectSnapshot?.exists() && !alreadyApplied) {
      transaction.set(
        marker,
        sanitizeForFirestore({
          id: operationId,
          idempotencyKey: operationId,
          businessId,
          ownerId: currentUser.uid,
          status: "recovered_existing",
          eventKind,
          processedAt: serverTimestamp(),
          createdAtLocal: item.createdAtLocal || item.createdAt || null,
          schemaVersion: 3,
        }),
      );
      return;
    }
    if (alreadyApplied) {
      if (financialEffect && !financialEffectSnapshot?.exists())
        throw Object.assign(
          new Error(
            "A venda existe na nuvem, mas o movimento financeiro correspondente não foi confirmado.",
          ),
          { code: "financial-reconciliation-required" },
        );
      transaction.set(
        marker,
        sanitizeForFirestore({
          id: operationId,
          idempotencyKey: operationId,
          businessId,
          ownerId: currentUser.uid,
          status: "recovered_existing",
          eventKind,
          processedAt: serverTimestamp(),
          createdAtLocal: item.createdAtLocal || item.createdAt || null,
          schemaVersion: 3,
        }),
      );
      return;
    }
    const creditClientWrite = financialEffect?.type === "credit_sale"
      ? writes.find((write) => write.entityType === "clients" &&
        String(write.entityId) === String(financialEffect.customerId)) : null,
      creditClientSnapshot = creditClientWrite
        ? snapshots.get(`clients:${creditClientWrite.entityId}`) : null;
    for (const write of writes) {
      currentPath = `businesses/${businessId}/${write.entityType}/${write.entityId}`;
      const reference = doc(
        db,
        "businesses",
        businessId,
        write.entityType,
        String(write.entityId),
      );
      let data = write.data;
      if (financialEffect?.type === "credit_sale" &&
        write.entityType === "sales" && write.operation === "create" &&
        String(write.entityId) === String(financialEffect.sourceDocumentId))
        data = canonicalCreditSaleData(data, financialEffect,
          creditClientSnapshot?.exists() ? creditClientSnapshot.data() : null,
          creditClientWrite?.before || {});
      if (
        transactional &&
        (write.before || write.entityType === "campaignProgress") &&
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
              : write.entityType === "campaignProgress"
                ? ["pendingProgress", "confirmedProgress", "pendingPoints", "availablePoints", "redeemedRewards"]
                : ["estoqueAtual", "estoque", "totalStock"];
        for (const field of fields)
          if (
            Number.isFinite(Number(data[field])) &&
            Number.isFinite(Number(write.before?.[field] ?? 0))
          )
            merged[field] =
              Number(base[field] ?? write.before?.[field] ?? 0) +
              (Number(data[field]) - Number(write.before?.[field] ?? 0));
        if (write.entityType === "clients" && Number.isFinite(merged.saldo))
          merged.saldo = roundedMoney(merged.saldo);
        if (
          write.entityType === "clients" &&
          financialEffect &&
          String(write.entityId) === String(financialEffect.customerId)
        )
          merged.financialVersion = financialVersionOf(base) + 1;
        if (write.entityType === "campaignProgress") {
          const campaignId = String(data.campaignId || write.before?.campaignId || ""),
            campaign = snapshots.get(`campaigns:${campaignId}`)?.data() || {},
            rule = campaign.rule || {},
            type = campaign.type || campaign.tipo;
          if (["buy_get", "nth_product"].includes(type)) {
            const threshold = Math.max(1, Number(type === "nth_product" ? rule.requiredPurchases : rule.requiredQuantity) || 1),
              cycles = Math.floor(Math.max(0, Number(merged.confirmedProgress || 0)) / threshold),
              entitled = rule.multipleCycles === false ? Math.min(1, cycles) : cycles;
            merged.availableRewards = Math.max(0, entitled - Math.max(0, Number(merged.redeemedRewards || 0)));
            merged.cycleRemainder = Math.max(0, Number(merged.confirmedProgress || 0)) % threshold;
          }
        }
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
    if (financialEffectReference && !financialEffectSnapshot?.exists()) {
      currentPath = `businesses/${businessId}/balanceEvents/${financialEffect.id}`;
      transaction.set(
        financialEffectReference,
        sanitizeForFirestore({
          ...financialEffect,
          ownerId: currentUser.uid,
          sourceDeviceId: item.deviceId || deviceId(),
          status: "applied",
          appliedAt: serverTimestamp(),
          createdAt: financialEffect.sourceCreatedAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
          schemaVersion: 3,
        }),
      );
      transaction.set(
        doc(
          db,
          "businesses",
          businessId,
          financialEffect.sourceCollection,
          financialEffect.sourceDocumentId,
        ),
        {
          financialAppliedAt: serverTimestamp(),
          financialOperationId: financialEffect.id,
          status: "applied",
          applicationStatus: "applied",
          updatedAt: serverTimestamp(),
        },
        { merge: true },
      );
      if (confirmedConflictReference)
        transaction.set(
          confirmedConflictReference,
          {
            status: "confirmed",
            applicationStatus: "superseded_by_confirmation",
            resolvedAt: serverTimestamp(),
            resolutionOperationId: operationId,
            confirmedPaymentId: financialEffect.sourceDocumentId,
            updatedAt: serverTimestamp(),
          },
          { merge: true },
        );
    }
    currentPath = `businesses/${businessId}/processedOperations/${operationId}`;
    transaction.set(
      marker,
      sanitizeForFirestore({
        id: operationId,
        idempotencyKey: operationId,
        businessId,
        ownerId: currentUser.uid,
        status: "processed",
        eventKind,
        processedAt: serverTimestamp(),
        createdAtLocal: item.createdAtLocal || item.createdAt || null,
        schemaVersion: 3,
      }),
    );
  });
  return transactionOutcome;
}
async function verifySaleQueueCommit(item) {
  const saleWrite = (item.payload?.writes || []).find((write) =>
    write.entityType === "sales" && write.operation === "create");
  if (!saleWrite) return;
  const saleId = String(saleWrite.entityId),
    operationId = String(saleWrite.data?.operationId || item.operationId || ""),
    businessId = activeBusinessId(),
    snapshot = await getDocFromServer(doc(db, "businesses", businessId, "sales", saleId)),
    remote = snapshot.exists() ? snapshot.data() : null;
  if (!remote || String(remote.operationId || "") !== operationId)
    throw Object.assign(new Error("A venda não foi confirmada na nuvem. A fila foi preservada para revisão."),
      { code: "sale-remote-ack-missing", saleId, operationId });
  const credit = saleWrite.data?.status === "fiado" || saleWrite.data?.formaPagamento === "fiado";
  if (!credit) return;
  const effect = await getDocFromServer(doc(db, "businesses", businessId,
    "balanceEvents", balanceEffectId("credit_sale", saleId)));
  const clientId = String(saleWrite.data?.clienteId || saleWrite.data?.customerId || ""),
    amount = roundedMoney(saleWrite.data?.valorFinal ?? saleWrite.data?.valorTotal),
    remoteEffect = effect.exists() ? effect.data() : null;
  if (!remote.financialAppliedAt || !effect.exists() ||
    String(remoteEffect?.operationId || "") !== operationId ||
    String(remoteEffect?.sourceDocumentId || "") !== saleId ||
    String(remoteEffect?.customerId || remoteEffect?.clientId || "") !== clientId ||
    !sameFinancialMoney(remoteEffect?.balanceDelta, -amount))
    throw Object.assign(new Error("A venda fiado está sem confirmação financeira. A fila foi preservada."),
      { code: "sale-financial-ack-missing", saleId, operationId });
}
function rollbackPaymentConflict(item, conflict, options = {}) {
  if (!originalAlter || !conflict?.paymentId) return;
  const paymentStatus = options.status || "conflict",
    applicationStatus = options.applicationStatus || "not_applied";
  applyingCloud = true;
  try {
    originalAlter((data) => {
      for (const write of [...(item.payload?.writes || [])].reverse()) {
        const source = SOURCES[write.entityType];
        if (!source || write.entityType === "settings") continue;
        const list = Array.isArray(data[source.key]) ? data[source.key] : [],
          index = list.findIndex(
            (entry) => String(entry.id) === String(write.entityId),
          );
        if (
          write.entityType === "payments" &&
          write.operation === "create"
        )
          continue;
        if (write.operation === "create") {
          if (index >= 0) list.splice(index, 1);
          continue;
        }
        if (write.before) {
          if (index >= 0) list[index] = structuredClone(write.before);
          else list.push(structuredClone(write.before));
        }
      }
      const client = (data.clientes || []).find(
        (entry) => String(entry.id) === String(conflict.clientId),
      );
      if (client) {
        client.saldo = roundedMoney(conflict.actualBalance);
        client.financialVersion = Math.max(
          0,
          Number(conflict.actualFinancialVersion || 0),
        );
      }
      const payment = (data.pagamentos || []).find(
        (entry) => String(entry.id) === String(conflict.paymentId),
      );
      if (payment)
        Object.assign(payment, {
          status: paymentStatus,
          applicationStatus,
          conflictReason: conflict.reason,
          conflictDetectedAt: now(),
          conflictActualBalance: roundedMoney(conflict.actualBalance),
          conflictActualFinancialVersion: Number(
            conflict.actualFinancialVersion || 0,
          ),
          allocations: [],
          campaignConfirmations: [],
          allocatedAmount: 0,
          legacyAmount: 0,
        });
      const movement = (data.movimentacoes || []).find(
        (entry) => String(entry.id) === String(conflict.paymentId),
      );
      if (movement)
        Object.assign(movement, {
          status: paymentStatus,
          applicationStatus,
          conflictReason: conflict.reason,
          conflictActualBalance: roundedMoney(conflict.actualBalance),
          conflictActualFinancialVersion: Number(
            conflict.actualFinancialVersion || 0,
          ),
          allocations: [],
          campaignConfirmations: [],
          allocatedAmount: 0,
          legacyAmount: 0,
        });
    });
  } finally {
    applyingCloud = false;
  }
}
function applyAdjustedPaymentProjection(outcome) {
  if (!originalAlter || !outcome?.paymentId) return;
  applyingCloud = true;
  try {
    originalAlter((data) => {
      const client = (data.clientes || []).find(
          (entry) => String(entry.id) === String(outcome.clientId),
        ),
        payment = (data.pagamentos || []).find(
          (entry) => String(entry.id) === String(outcome.paymentId),
        ),
        movement = (data.movimentacoes || []).find(
          (entry) => String(entry.id) === String(outcome.paymentId),
        ),
        patch = {
          valor: roundedMoney(outcome.effectiveAmount),
          effectiveAmount: roundedMoney(outcome.effectiveAmount),
          saldoNovo: roundedMoney(outcome.resultingBalance),
          concurrencyDecision: "apply_adjusted",
          concurrencyReason: outcome.reason,
          status: "applied",
          applicationStatus: "applied",
        };
      if (client) client.saldo = roundedMoney(outcome.resultingBalance);
      if (payment) Object.assign(payment, patch);
      if (movement) Object.assign(movement, patch);
    });
  } finally {
    applyingCloud = false;
  }
}
function resolveLocalPaymentAdjustment(
  paymentId,
  status = "cancelled",
  resolutionOperationId = null,
) {
  if (!originalAlter || !paymentId) return null;
  let resolved = null;
  applyingCloud = true;
  try {
    originalAlter((data) => {
      const resolvedAt = now(),
        patch = {
          status,
          applicationStatus:
            status === "superseded"
              ? "superseded_by_adjusted_payment"
              : "not_applied",
          resolvedAt,
          resolutionOperationId,
        };
      for (const key of ["pagamentos", "movimentacoes"]) {
        const entry = (data[key] || []).find(
          (item) => String(item.id) === String(paymentId),
        );
        if (entry) {
          Object.assign(entry, patch);
          if (key === "pagamentos") resolved = entry;
        }
      }
    });
  } finally {
    applyingCloud = false;
  }
  return resolved;
}
async function processSyncQueue(options = {}) {
  if (processingPromise) return processingPromise;
  if (queueCounts().corrupt)
    throw Error("A fila local está corrompida. Exporte o diagnóstico antes de sincronizar.");
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
      financialConflicts = 0,
      financialAdjustments = 0,
      index = 0,
      queue = readQueue(),
      changedCollections = new Set();
    for (const queued of [...queue]) {
      // A preparação nunca pode chegar ao Firestore antes da venda local.
      if (queued.status === "local_preparing") continue;
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
      const preflight = queuePreflight(queued);
      if (!preflight.ok) {
        const blocked = readQueue(),
          blockedIndex = blocked.findIndex(
            (item) => item.queueId === queued.queueId,
          );
        if (blockedIndex >= 0) {
          blocked[blockedIndex] = {
            ...blocked[blockedIndex],
            status: "error",
            lastAttemptAt: now(),
            lastErrorCode: preflight.code,
            lastErrorMessage: preflight.message,
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
        const outcome = await commitQueueItem(live[position]);
        await verifySaleQueueCommit(live[position]);
        markLocalSaleConfirmed(live[position]);
        if (!["financial_conflict", "financial_payment_adjustment_required",
          "financial_payment_applied_adjusted"].includes(outcome?.status))
          markLocalPaymentConfirmed(live[position]);
        const after = readQueue().filter(
          (item) => item.queueId !== queued.queueId,
        );
        saveQueue(after);
        if (outcome?.status === "financial_conflict") {
          rollbackPaymentConflict(live[position], outcome);
          financialConflicts++;
          changedCollections.add("payments");
          dispatchEvent(
            new CustomEvent("financial-payment-conflict", {
              detail: { ...outcome },
            }),
          );
          emit({
            status: "error",
            message:
              "Um pagamento precisa de confirmação porque o saldo mudou em outro dispositivo.",
          });
          break;
        }
        if (outcome?.status === "financial_payment_adjustment_required") {
          rollbackPaymentConflict(live[position], outcome, {
            status: "adjustment_required",
            applicationStatus: "not_applied",
          });
          financialAdjustments++;
          changedCollections.add("payments");
          dispatchEvent(
            new CustomEvent("financial-payment-adjustment-required", {
              detail: { ...outcome },
            }),
          );
          emit({
            status: "idle",
            message:
              "O saldo mudou. Confirme o valor atualizado para concluir a quitação.",
          });
          break;
        }
        if (outcome?.status === "financial_payment_applied_adjusted") {
          applyAdjustedPaymentProjection(outcome);
          financialAdjustments++;
          dispatchEvent(
            new CustomEvent("financial-payment-adjusted", {
              detail: { ...outcome },
            }),
          );
        }
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
            lastErrorMessage: String(error?.message || friendlyError(error)).slice(0,800),
            lastErrorPath: currentPath || null,
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
      financialConflicts,
      financialAdjustments,
      pending: counts.total,
      errors: counts.errors,
      errorBreakdown: queueErrorBreakdown(),
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
function markLocalCreditSaleConfirmed(item, confirmedAt = now()) {
  const write = (item.payload?.writes || []).find((entry) =>
    entry.entityType === "sales" && entry.operation === "create" &&
    (entry.data?.formaPagamento === "fiado" || entry.data?.status === "fiado"));
  if (!write || !originalAlter) return;
  applyingCloud = true;
  try {
    originalAlter((data) => {
      const sale = (data.vendas || []).find((entry) => String(entry.id) === String(write.entityId));
      if (!sale) return;
      sale.syncConfirmedAt = confirmedAt;
      sale.financialAppliedAt = confirmedAt;
      sale.financialOperationId = `credit_sale:${write.entityId}`;
    });
  } finally {
    applyingCloud = false;
  }
}
function markLocalSaleConfirmed(item, confirmedAt = now()) {
  const writes = item.payload?.writes || [],
    credit = writes.some((entry) => entry.entityType === "sales" && entry.operation === "create" &&
      (entry.data?.formaPagamento === "fiado" || entry.data?.status === "fiado"));
  if (credit) return markLocalCreditSaleConfirmed(item, confirmedAt);
  const write = writes.find((entry) => entry.entityType === "sales" && entry.operation === "create");
  if (!write || !originalAlter) return;
  applyingCloud = true;
  try {
    originalAlter((data) => {
      const sale = (data.vendas || []).find((entry) => String(entry.id) === String(write.entityId));
      if (sale) sale.syncConfirmedAt = confirmedAt;
    });
  } finally {
    applyingCloud = false;
  }
}
function markLocalPaymentConfirmed(item, confirmedAt = now()) {
  const write = (item.payload?.writes || []).find((entry) =>
    entry.entityType === "payments" && entry.operation === "create");
  if (!write || !originalAlter) return;
  applyingCloud = true;
  try {
    originalAlter((data) => {
      for (const key of ["pagamentos", "movimentacoes"]) {
        const entry = (data[key] || []).find((value) => String(value.id) === String(write.entityId));
        if (entry) Object.assign(entry, { status: "applied", applicationStatus: "applied",
          syncConfirmedAt: confirmedAt });
      }
    });
  } finally {
    applyingCloud = false;
  }
}
function assertSaleTracked(sale) {
  const credit = sale?.status === "fiado" || sale?.formaPagamento === "fiado";
  if (!credit && Number(sale?.syncPipelineVersion || 0) < 2) return;
  if (sale.financialAppliedAt || sale.syncConfirmedAt) return;
  if (typeof resumePreparedSales === "function") resumePreparedSales(sale.operationId);
  const writes = readQueue().filter((item) =>
    item.status !== "local_preparing" &&
    (String(item.operationId) === String(sale.operationId) ||
      String(item.operationId).startsWith(`${sale.operationId}:`)))
    .flatMap((item) => item.payload?.writes || []);
  const queued = writes.some((write) => write.entityType === "sales" &&
      write.operation === "create" && String(write.entityId) === String(sale.id) &&
      String(write.data?.operationId || "") === String(sale.operationId || "")) &&
    (!credit || writes.some((write) => write.entityType === "clients" &&
      String(write.entityId) === String(sale.clienteId)));
  if (!queued) throw Error("A venda ficou sem confirmação nem fila de sincronização. Ela foi preservada neste aparelho; exporte o diagnóstico antes de repetir.");
}
function assertPaymentTracked(payment) {
  if (payment?.applicationStatus === "applied" || payment?.syncConfirmedAt) return;
  resumePreparedSales(payment.operationId);
  const queued = readQueue().some((item) => item.status !== "local_preparing" &&
    String(item.operationId) === String(payment.operationId) &&
    (item.payload?.writes || []).some((write) => write.entityType === "payments" &&
      write.operation === "create" && String(write.entityId) === String(payment.id)) &&
    (item.payload?.writes || []).some((write) => write.entityType === "clients" &&
      String(write.entityId) === String(payment.clienteId)));
  if (!queued) throw Error("O recebimento ficou sem confirmação nem fila de sincronização. Exporte o diagnóstico antes de repetir.");
}
function isSalePending(sale) {
  return readQueue().some((item) => String(item.operationId) === String(sale?.operationId) &&
    (item.payload?.writes || []).some((write) => write.entityType === "sales" &&
      String(write.entityId) === String(sale?.id)));
}
async function prepareCustomerForSale(customerId) {
  const id = String(customerId || "");
  if (!id || !currentUser || !DB.__firebaseSyncWrapped || readOnlyMode)
    throw Error("A sincronização financeira não está pronta para esta venda.");
  if (typeof resumePreparedSales === "function") resumePreparedSales();
  const localData = DB.carregar(),
    localClient = (localData.clientes || []).find((entry) => String(entry.id) === id),
    queue = readQueue(),
    queuedSaleIds = new Set(queue.flatMap((item) => (item.payload?.writes || [])
      .filter((write) => write.entityType === "sales")
      .map((write) => String(write.entityId)))),
    customerQueue = queue.filter((item) => (item.payload?.writes || []).some(
      (write) => write.entityType === "clients" && String(write.entityId) === id,
    )),
    knownOrphans = readKnownOrphanIds(),
    recentCutoff = Date.now() - 7 * 24 * 60 * 60 * 1000,
    recentSales = (localData.vendas || []).filter((sale) =>
      String(sale.clienteId) === id && !sale.deletedAt && sale.active !== false &&
      (sale.formaPagamento === "fiado" || sale.status === "fiado") &&
      !sale.financialAppliedAt && !queuedSaleIds.has(String(sale.id)) &&
      !isOrphanReviewed(sale) &&
      ((Date.parse(sale.data || sale.createdAt || "") || 0) >= recentCutoff ||
        knownOrphans.has(String(sale.id))))
      .sort((left, right) => String(right.data || right.createdAt || "")
        .localeCompare(String(left.data || left.createdAt || ""))),
    unconfirmed = recentSales;
  const orphanError = (sale) => Object.assign(
    Error(`Existe uma venda fiado ${localClient?.nome ? `de ${localClient.nome}` : "deste cliente"} somente neste aparelho ou ainda não confirmada na nuvem. Resolva a operação antes de outra venda fiado.`),
    { code: "customer-credit-orphan", customerId: id, customerName: localClient?.nome || "",
      saleId: String(sale?.id || ""), operationId: String(sale?.operationId || "") },
  );
  if (customerQueue.some((item) => item.status === "error"))
    throw Error("Há uma venda anterior com erro de sincronização para este cliente. Revise a fila antes de outra venda fiado.");
  if (!navigator.onLine) {
    if (unconfirmed.length)
      throw orphanError(unconfirmed[0]);
    return { source: "local-offline" };
  }
  if (unconfirmed.length > 10)
    throw Error("Há muitas vendas recentes sem confirmação neste aparelho. Exporte o diagnóstico antes de outra venda fiado.");
  for (const localSale of unconfirmed) {
    const remote = await getDocFromServer(doc(db, "businesses", activeBusinessId(), "sales", String(localSale.id)));
    const confirmed = remote.exists() ? cleanCloudItem({ id: remote.id, ...remote.data() }) : null;
    if (!confirmed?.financialAppliedAt ||
      String(confirmed.operationId || "") !== String(localSale.operationId || ""))
      throw orphanError(localSale);
    markLocalCreditSaleConfirmed({ payload: { writes: [{ entityType: "sales", operation: "create",
      entityId: localSale.id, data: { formaPagamento: "fiado" } }] } }, confirmed.financialAppliedAt);
  }
  // Primeiro confirme operações deste aparelho. Enquanto houver pendências,
  // a projeção local já inclui os deltas e não pode ser substituída pela nuvem.
  if (pendingIds("clients").has(id)) await processSyncQueue({ force: true });
  const pending = readQueue().filter((item) => (item.payload?.writes || []).some(
    (write) => write.entityType === "clients" && String(write.entityId) === id,
  ));
  if (pending.some((item) => item.status === "error"))
    throw Error("Há uma venda anterior com erro de sincronização para este cliente. Revise a fila antes de outra venda fiado.");
  if (pending.length)
    throw Error("A operação anterior deste cliente ainda está sincronizando. Aguarde a confirmação ou use o modo offline antes de outra venda fiado.");
  // Leitura pontual do servidor: nunca varre a coleção de clientes no checkout.
  const snapshot = await getDocFromServer(doc(db, "businesses", activeBusinessId(), "clients", id));
  if (!snapshot.exists()) throw Error("Cliente não encontrado na empresa atual da nuvem.");
  applyCloudCollection("clients", [{ id, ...snapshot.data() }], { authoritative: true });
  return { source: "server", financialVersion: financialVersionOf(snapshot.data()) };
}
async function confirmCreditSale(sale) {
  if ((sale?.status !== "fiado" && sale?.formaPagamento !== "fiado") || !navigator.onLine) return sale;
  if (!currentUser || readOnlyMode)
    throw Error("A sincronização financeira não está pronta para confirmar a venda.");
  await processSyncQueue({ force: true });
  const snapshot = await getDocFromServer(doc(db, "businesses", activeBusinessId(), "sales", String(sale.id)));
  const confirmed = snapshot.exists() ? cleanCloudItem({ id: snapshot.id, ...snapshot.data() }) : null;
  if (!confirmed?.financialAppliedAt ||
    String(confirmed.operationId || "") !== String(sale.operationId || ""))
    throw Error("Venda preservada neste aparelho, mas ainda sem confirmação financeira na nuvem. Não repita com outra operação; revise a sincronização.");
  applyCloudCollection("sales", [confirmed], { authoritative: true });
  const clientSnapshot = await getDocFromServer(doc(db, "businesses", activeBusinessId(), "clients", String(sale.clienteId)));
  if (clientSnapshot.exists())
    applyCloudCollection("clients", [{ id: sale.clienteId, ...clientSnapshot.data() }], { authoritative: true });
  return { ...sale, ...confirmed, status: "fiado", formaPagamento: "fiado" };
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
      if (authoritative || remoteTime >= localTime) {
        byId.delete(operationMatch);
        byId.set(id, { ...(existing || {}), ...item, id });
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
    // Um snapshot completo e sem pendência local é a fonte oficial. Preserve
    // campos legados que ainda não existem na nuvem, mas nunca deixe esses
    // campos impedirem que saldo e demais valores remotos sejam atualizados.
    if (authoritative) {
      byId.set(id, { ...existing, ...item, id });
      continue;
    }
    const remoteTime = new Date(
        item.updatedAt || item.atualizadoEm || 0,
      ).getTime(),
      localTime = new Date(
        existing.updatedAt || existing.atualizadoEm || 0,
      ).getTime();
    // Clientes só chegam aqui por leitura explícita do servidor. Sem write
    // pendente para o mesmo ID, o cache local nunca pode vetar o documento
    // oficial por causa de Date.now() ou relógio de aparelho adiantado.
    if (entityType === "clients" || !localTime || remoteTime >= localTime)
      byId.set(id, { ...existing, ...item });
  }
  // Ausência na nuvem não é tombstone. Registros locais sem fila precisam
  // ser auditados e recuperados, nunca apagados silenciosamente por um pull.
  return [...byId.values()];
}
function mergeCloudCollectionIntoData(data, name, documents, options = {}) {
  const pending = pendingIds(name),
    source = SOURCES[name];
  let changed = 0;
  if (name === "settings") {
    const remote = documents.find(
      (item) => item.id === "default" && !item.deletedAt,
    );
    if (!remote || pending.has("default")) return 0;
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
    return changed;
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
  return changed;
}
function notifyCloudCollectionChange(name, changed) {
  if (changed)
    dispatchEvent(
      new CustomEvent("cloud-data-updated", {
        detail: { collection: name, count: changed, source: "cloud" },
      }),
    );
}
function applyCloudCollection(name, documents, options = {}) {
  if (!originalAlter) return 0;
  let changed = 0;
  applyingCloud = true;
  try {
    originalAlter((data) => {
      changed = mergeCloudCollectionIntoData(data, name, documents, options);
    });
  } finally {
    applyingCloud = false;
  }
  if (options.notify !== false) notifyCloudCollectionChange(name, changed);
  return changed;
}
function applyCloudCollectionBatch(entries) {
  if (!originalAlter || !entries.length) return 0;
  const changes = [];
  let total = 0;
  applyingCloud = true;
  try {
    originalAlter((data) => {
      for (const entry of entries) {
        const changed = mergeCloudCollectionIntoData(
          data,
          entry.name,
          entry.documents,
          entry.options,
        );
        changes.push([entry.name, changed]);
        total += changed;
      }
    });
  } finally {
    applyingCloud = false;
  }
  for (const [name, changed] of changes)
    notifyCloudCollectionChange(name, changed);
  return total;
}
function registerRealtimeCollection(name, mode = "all") {
  const key = `${activeBusinessId()}:${name}:${mode}`;
  if (listenerRegistry.has(key)) return listenerRegistry.get(key);
  const onDocuments = (documents, metadata) => {
      const list = Array.isArray(documents)
        ? documents
        : documents
          ? [documents]
          : [];
      state.cloudCounts[name] = list.filter((item) => !item?.deletedAt).length;
      state.cloudNewest[name] = newestTimestamp(list);
      rememberSnapshotMetadata(name, metadata);
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
  registerRealtimeCollection("products");
  registerRealtimeCollection("settings", "document");
  const unsubscribe = syncSignalRepository.subscribeById(
    "last-sync",
    (signal, metadata) => {
      rememberSnapshotMetadata("syncMetadata", metadata);
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
  const hydrateStartedAt = performance.now();
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
    businessId = activeBusinessId(),
    pendingApplications = [];
  let initialCollections = 0,
    documentsRead = 0;
  for (const name of names) {
    const markerKey = `${businessId}:${name}`,
      since = full ? "" : pullState[markerKey] || "",
      documents = since
        ? await repositories[name].listChangedSince(since, 500)
        : full || INITIAL_FULL_NAMES.has(name)
          ? await repositories[name].listAllPaged(200)
          : await repositories[name].listRecent(
              INITIAL_RECENT_LIMITS[name] || 100,
              { force: true },
            );
    rememberSnapshotMetadata(name, repositories[name].getLastReadMetadata?.());
    if (!since) initialCollections++;
    documentsRead += documents.length;
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
    pendingApplications.push({
      name,
      documents,
      options: { authoritative: !since },
    });
    // Nunca avance o cursor usando o relógio do aparelho. Um celular com hora
    // adiantada poderia ignorar para sempre documentos gravados pelo servidor.
    pullState[markerKey] = newestTimestamp(documents) || since || "";
  }
  received = applyCloudCollectionBatch(pendingApplications);
  if (full && names.includes("clients")) {
    const clientDocuments =
        pendingApplications.find((entry) => entry.name === "clients")
          ?.documents || [],
      keys = clientProjectionKeys(businessId);
    pullState[keys.epoch] = CLIENT_PROJECTION_EPOCH;
    pullState[keys.checkedAt] = now();
    pullState[keys.remoteCount] = clientDocuments.length;
    pullState[keys.projectedCount] = clientDocuments.filter(
      (item) => !item.deletedAt && item.active !== false,
    ).length;
    state.clientProjection = {
      checked: true,
      repaired: true,
      reason: "manual-full-sync",
      epoch: CLIENT_PROJECTION_EPOCH,
      remoteCount: clientDocuments.length,
      projectedCount: clientDocuments.filter(
        (item) => !item.deletedAt && item.active !== false,
      ).length,
      documentsRead: clientDocuments.length,
      pendingClientIds: pendingIds("clients").size,
    };
  }
  if (initialCollections)
    window.AppBootDiagnostics?.count?.("hydrateCount", {
      collections: initialCollections,
      documents: documentsRead,
    });
  writePullState(pullState);
  lastPullAt = Date.now();
  emit({
    cloudCounts: { ...state.cloudCounts },
    cloudNewest: { ...state.cloudNewest },
    cloudFinancial: { ...state.cloudFinancial },
    received,
    hydrated: true,
  });
  window.AppBootDiagnostics?.phase?.("cloud hydration completed", {
    durationMs: Math.round(performance.now() - hydrateStartedAt),
    collections: names.length,
    initialCollections,
    documents: documentsRead,
    full,
  });
  return received;
}
async function ensureClientProjection(options = {}) {
  await validateUser();
  if (!navigator.onLine)
    return {
      checked: false,
      repaired: false,
      reason: "offline",
      documentsRead: 0,
    };
  const businessId = activeBusinessId(),
    pullState = readPullState(),
    keys = clientProjectionKeys(businessId),
    localClients = sourceItems(DB.carregar(), "clients").filter(
      (item) => !item.deletedAt && item.active !== false,
    ),
    epochCurrent = Number(pullState[keys.epoch] || 0),
    previousRemoteCount = Number(pullState[keys.remoteCount] ?? -1),
    expectedLocalCount = Number(pullState[keys.projectedCount] ?? -1),
    epochRequired = epochCurrent !== CLIENT_PROJECTION_EPOCH,
    checkDue = projectionCheckDue(pullState[keys.checkedAt]),
    force = Boolean(options.force);
  if (!force && !epochRequired && !checkDue) {
    const result = {
      checked: false,
      repaired: false,
      reason: "ttl",
      epoch: CLIENT_PROJECTION_EPOCH,
      localCount: localClients.length,
      documentsRead: 0,
    };
    state.clientProjection = result;
    return result;
  }
  let remoteCount = null;
  if (!epochRequired || force)
    remoteCount = await repositories.clients.countFromServer();
  rememberSnapshotMetadata(
    "clients:count",
    repositories.clients.getLastReadMetadata?.(),
  );
  const needsRepair =
    force ||
    epochRequired ||
    Number(remoteCount) !== previousRemoteCount ||
    localClients.length < expectedLocalCount;
  let documents = [],
    changed = 0,
    projectedCount = expectedLocalCount;
  if (needsRepair) {
    documents = await repositories.clients.listAllPaged(200);
    rememberSnapshotMetadata(
      "clients",
      repositories.clients.getLastReadMetadata?.(),
    );
    changed = applyCloudCollection("clients", documents, {
      authoritative: true,
    });
    remoteCount = documents.length;
    projectedCount = documents.filter(
      (item) => !item.deletedAt && item.active !== false,
    ).length;
    pullState[`${businessId}:clients`] = newestTimestamp(documents) || "";
  }
  pullState[keys.epoch] = CLIENT_PROJECTION_EPOCH;
  pullState[keys.checkedAt] = now();
  pullState[keys.remoteCount] = Number(remoteCount ?? localClients.length);
  pullState[keys.projectedCount] = Number(
    projectedCount >= 0 ? projectedCount : localClients.length,
  );
  writePullState(pullState);
  state.cloudCounts.clients = Number(
    projectedCount >= 0 ? projectedCount : localClients.length,
  );
  const result = {
    checked: true,
    repaired: needsRepair,
    reason: epochRequired
      ? "projection-epoch"
      : needsRepair
        ? "count-mismatch"
        : "count-match",
    epoch: CLIENT_PROJECTION_EPOCH,
    localCountBefore: localClients.length,
    remoteCount: Number(remoteCount ?? localClients.length),
    projectedCount: Number(
      projectedCount >= 0 ? projectedCount : localClients.length,
    ),
    changed,
    documentsRead: documents.length + (epochRequired && !force ? 0 : 1),
    pendingClientIds: pendingIds("clients").size,
  };
  state.clientProjection = result;
  emit({
    clientProjection: result,
    cloudCounts: { ...state.cloudCounts },
    snapshotMetadata: { ...state.snapshotMetadata },
  });
  return result;
}
async function queryClientsPage(options = {}) {
  await validateUser();
  const max = Math.min(50, Math.max(1, Number(options.limit || 20))),
    filter = String(options.filter || "todos"),
    sort = String(options.sort || "nomeAsc"),
    search = normalizeText(options.search || ""),
    phoneSearch = String(options.search || "").replace(/\D/g, ""),
    unsupported = new Set(["nunca", "pagamento"]);
  if (unsupported.has(filter))
    return { items: [], cursor: null, hasMore: false, unsupported: true };
  const filters = [];
  if (filter === "debito") filters.push({ field: "saldo", operator: "<", value: 0 });
  if (filter === "credito") filters.push({ field: "saldo", operator: ">", value: 0 });
  if (filter === "zero") filters.push({ field: "saldo", operator: "==", value: 0 });
  if (filter === "semTelefone")
    filters.push({ field: "telefoneNormalizado", operator: "==", value: "" });
  let orders;
  if (search || phoneSearch) {
    if (filter !== "todos")
      return { items: [], cursor: null, hasMore: false, unsupported: true };
    const field = phoneSearch ? "telefoneNormalizado" : "nomeNormalizado";
    orders = [{ field, direction: "asc" }];
    const result = await repositories.clients.listQueryPage({
      filters: [],
      orders,
      prefix: phoneSearch || search,
      cursor: options.cursor || null,
      max,
    });
    applyCloudCollection("clients", result.items, {
      authoritative: true,
      notify: false,
    });
    rememberSnapshotMetadata("clients", result.metadata);
    return {
      ...result,
      queryField: field,
      pendingClientIds: [...pendingIds("clients")],
    };
  }
  const sortMap = {
    maiorDebito: [{ field: "saldo", direction: "asc" }],
    menorDebito: [{ field: "saldo", direction: "desc" }],
    nomeAsc: [{ field: "nomeNormalizado", direction: "asc" }],
    nomeDesc: [{ field: "nomeNormalizado", direction: "desc" }],
    compraRecente: [{ field: "ultimaCompra", direction: "desc" }],
    ultimaCompra: [{ field: "ultimaCompra", direction: "desc" }],
    cobrancaAntiga: [{ field: "lastChargeAt", direction: "asc" }],
    ultimaCobranca: [{ field: "lastChargeAt", direction: "desc" }],
    totalComprado: [{ field: "totalComprado", direction: "desc" }],
    quantidade: [{ field: "quantidadeVendas", direction: "desc" }],
  };
  orders = sortMap[sort] || sortMap.nomeAsc;
  if (["debito", "credito"].includes(filter) && orders[0]?.field !== "saldo")
    orders = [{ field: "saldo", direction: filter === "debito" ? "asc" : "desc" }];
  if (filter === "semTelefone")
    orders = [{ field: "telefoneNormalizado", direction: "asc" }];
  const result = await repositories.clients.listQueryPage({
    filters,
    orders,
    cursor: options.cursor || null,
    max,
  });
  applyCloudCollection("clients", result.items, {
    authoritative: true,
    notify: false,
  });
  rememberSnapshotMetadata("clients", result.metadata);
  return { ...result, pendingClientIds: [...pendingIds("clients")] };
}
async function queryCustomerSubscriptions(options = {}) {
  await validateUser();
  const clientId = String(options.clientId || "").trim(),
    productId = String(options.productId || "").trim(),
    status = String(options.status || "").trim(),
    lastRenewedFrom = options.lastRenewedFrom
      ? new Date(options.lastRenewedFrom).toISOString()
      : "",
    max = Math.min(50, Math.max(1, Number(options.limit || 20))),
    filters = [];
  if (!clientId && !status && !lastRenewedFrom)
    throw Error("Informe um cliente, status ou período de renovação.");
  if (clientId) filters.push({ field: "clientId", operator: "==", value: clientId });
  if (productId) filters.push({ field: "productId", operator: "==", value: productId });
  if (status) filters.push({ field: "status", operator: "==", value: status });
  if (lastRenewedFrom) filters.push({ field: "lastRenewedAt", operator: ">=", value: lastRenewedFrom });
  if (options.from) filters.push({ field: "expiresAt", operator: ">=", value: new Date(options.from).toISOString() });
  if (options.to) filters.push({ field: "expiresAt", operator: "<=", value: new Date(options.to).toISOString() });
  const result = await repositories.customerSubscriptions.listQueryPage({
    filters,
    orders: [{ field: lastRenewedFrom ? "lastRenewedAt" : "expiresAt", direction: options.direction === "asc" ? "asc" : "desc" }],
    max,
    includeInactive: true,
  });
  applyCloudCollection("customerSubscriptions", result.items, { authoritative: false });
  return result.items;
}
async function queryAllClientsForAction(options = {}) {
  const items = [];
  let cursor = null,
    hasMore = true,
    documentsRead = 0,
    pages = 0;
  while (hasMore && pages < 200) {
    const result = await queryClientsPage({
      search: options.search || "",
      filter: "todos",
      sort: "nomeAsc",
      limit: 50,
      cursor,
    });
    if (result.unsupported) break;
    items.push(...result.items);
    documentsRead += Number(result.documentsRead || result.items.length);
    hasMore = Boolean(result.hasMore);
    cursor = result.cursor || null;
    pages += 1;
    if (hasMore && !cursor) break;
  }
  return {
    items: [...new Map(items.map((item) => [item.id, item])).values()],
    documentsRead,
    pages,
    complete: !hasMore,
  };
}
async function queryClientsByInactivity(options = {}) {
  await validateUser();
  const days = Math.max(1, Number(options.days || 30)),
    cutoff =
      options.cutoff ||
      window.CustomerMetricsService?.inactivityCutoff?.(days, options.now || new Date());
  if (!cutoff)
    throw Object.assign(new Error("Não foi possível calcular a data-limite do segmento."), {
      code: "invalid-argument",
    });
  const items = [];
  let cursor = null,
    hasMore = true,
    documentsRead = 0,
    pages = 0;
  while (hasMore && pages < 200) {
    const result = await repositories.clients.listQueryPage({
      filters: [{ field: "ultimaCompra", operator: "<=", value: cutoff }],
      orders: [{ field: "ultimaCompra", direction: "desc" }],
      cursor,
      max: 50,
      includeInactive: true,
    });
    items.push(...result.items);
    documentsRead += Number(result.documentsRead || result.items.length);
    hasMore = Boolean(result.hasMore);
    cursor = result.cursor || null;
    pages += 1;
    if (hasMore && !cursor) break;
  }
  const unique = [...new Map(items.map((item) => [item.id, item])).values()];
  applyCloudCollection("clients", unique, { authoritative: false });
  return {
    items: unique,
    cutoff,
    days,
    documentsRead,
    pages,
    complete: !hasMore,
  };
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
function financialLedgerEntry(name, item = {}) {
  if (item.deletedAt || item.active === false) return null;
  const customerId = String(item.clienteId || item.customerId || ""),
    sourceDocumentId = String(item.id || ""),
    operationId = financialKey(item) || sourceDocumentId;
  if (!customerId || !sourceDocumentId || !operationId) return null;
  let type = "",
    amount = 0,
    before = Number.NaN,
    after = Number.NaN;
  if (name === "sales" && (String(item.status || "") === "fiado" ||
    String(item.formaPagamento || "") === "fiado")) {
    type = "credit_sale";
    amount = Math.abs(
      roundedMoney(item.valorFinal ?? item.valorTotal ?? item.amount),
    );
    before = roundedMoney(item.saldoAnterior);
    after = Number.isFinite(Number(item.saldoAtual))
      ? roundedMoney(item.saldoAtual)
      : roundedMoney(before - amount);
  } else if (name === "payments") {
    type = "payment_received";
    amount = Math.abs(roundedMoney(item.valor ?? item.amount));
    before = roundedMoney(item.saldoAnterior);
    after = Number.isFinite(Number(item.saldoNovo))
      ? roundedMoney(item.saldoNovo)
      : roundedMoney(before + amount);
  } else if (name === "balanceAdjustments") {
    type = "balance_adjustment";
    before = roundedMoney(item.saldoAnterior);
    after = roundedMoney(item.saldoNovo);
    amount = Math.abs(roundedMoney(after - before));
  }
  if (
    !type ||
    !amount ||
    !Number.isFinite(before) ||
    !Number.isFinite(after)
  )
    return null;
  return {
    customerId,
    sourceCollection: name,
    sourceDocumentId,
    operationId,
    effectId: balanceEffectId(type, sourceDocumentId),
    type,
    amount,
    balanceDelta: roundedMoney(after - before),
    before,
    after,
    date: item.data || item.createdAt || item.criadoEm || "",
    sourceChecksum: checksumValue(item),
  };
}
const sameMoney = (left, right) =>
  Math.abs(roundedMoney(left) - roundedMoney(right)) < 0.005;
function buildFinancialBalanceAudit(raw, effectItems = []) {
  const clients = new Map(
      (raw.clients?.remoteItems || []).map((item) => [String(item.id), item]),
    ),
    effects = new Set(effectItems.map((item) => String(item.id || ""))),
    eventsByClient = new Map();
  for (const name of ["sales", "payments", "balanceAdjustments"])
    for (const item of raw[name]?.remoteItems || []) {
      const event = financialLedgerEntry(name, item);
      if (!event) continue;
      if (!eventsByClient.has(event.customerId))
        eventsByClient.set(event.customerId, []);
      eventsByClient.get(event.customerId).push(event);
    }
  const divergent = [],
    safeRepairs = [],
    effectBackfills = [],
    unsafe = [];
  let actualOpenDebt = 0,
    expectedOpenDebt = 0,
    ledgerEvents = 0;
  for (const [clientId, client] of clients) {
    const events = (eventsByClient.get(clientId) || []).sort((left, right) =>
        `${left.date}|${left.sourceDocumentId}`.localeCompare(
          `${right.date}|${right.sourceDocumentId}`,
        ),
      ),
      actual = roundedMoney(client.saldo || 0),
      expected = events.length ? events.at(-1).after : actual;
    ledgerEvents += events.length;
    actualOpenDebt += Math.abs(Math.min(0, actual));
    expectedOpenDebt += Math.abs(Math.min(0, expected));
    if (sameMoney(actual, expected)) {
      const latest = events.at(-1);
      if (latest && !effects.has(latest.effectId))
        effectBackfills.push({
          clientId,
          actualBalance: actual,
          expectedBalance: actual,
          difference: 0,
          latestOperationId: latest.operationId,
          latestOperationAt: latest.date,
          clientChecksum: checksumValue(client),
          status: "safe_effect_backfill",
          balanceAlreadyApplied: true,
          missingEffects: [{ ...latest }],
        });
      continue;
    }
    let start = -1;
    for (let index = events.length - 1; index >= 0; index--) {
      if (!sameMoney(events[index].before, actual)) continue;
      const chain = events.slice(index),
        continuous = chain.every(
          (event, position) =>
            position === 0 || sameMoney(event.before, chain[position - 1].after),
        ),
        effectsMissing = chain.every((event) => !effects.has(event.effectId));
      if (continuous && effectsMissing) {
        start = index;
        break;
      }
    }
    const row = {
      clientId,
      actualBalance: actual,
      expectedBalance: expected,
      difference: roundedMoney(expected - actual),
      latestOperationId: events.at(-1)?.operationId || "",
      latestOperationAt: events.at(-1)?.date || "",
      clientChecksum: checksumValue(client),
      status: start >= 0 ? "safe_missing_effects" : "manual_review",
      missingEffects:
        start >= 0
          ? events.slice(start).map((event) => ({ ...event }))
          : [],
    };
    divergent.push(row);
    (start >= 0 ? safeRepairs : unsafe).push(row);
  }
  return {
    generatedAt: now(),
    clientsChecked: clients.size,
    ledgerEvents,
    effectsConfirmed: effects.size,
    divergentCount: divergent.length,
    safeCount: safeRepairs.length + effectBackfills.length,
    safeBalanceCount: safeRepairs.length,
    effectBackfillCount: effectBackfills.length,
    unsafeCount: unsafe.length,
    actualOpenDebt: roundedMoney(actualOpenDebt),
    expectedOpenDebt: roundedMoney(expectedOpenDebt),
    openDebtDifference: roundedMoney(expectedOpenDebt - actualOpenDebt),
    divergent,
    safeRepairs,
    effectBackfills,
    unsafe,
  };
}
async function compareDeviceWithCloud() {
  await validateUser();
  if (!navigator.onLine)
    throw Object.assign(new Error("A comparação precisa de conexão com a internet."), {
      code: "network-request-failed",
    });
  const businessId = activeBusinessId(),
    data = DB.carregar(),
    queue = readQueue(),
    collections = {},
    raw = {};
  for (const name of AUDIT_NAMES) {
    const localItems = sourceItems(data, name),
      remoteItems = await repositories[name].listAllPaged(200);
    raw[name] = { localItems, remoteItems };
    collections[name] = classifyCollectionAudit(
      name,
      localItems,
      remoteItems,
      queue,
    );
  }
  const remoteFinancialEffects =
      await financialEffectsRepository.listAllPaged(200),
    balanceAudit = buildFinancialBalanceAudit(raw, remoteFinancialEffects);
  const localBalance = (data.clientes || []).reduce(
      (total, client) => total + Number(client.saldo || 0),
      0,
    ),
    remoteBalance = raw.clients.remoteItems.reduce(
      (total, client) => total + Number(client.saldo || 0),
      0,
    ),
    summarize = (names) => ({
      local: names.reduce(
        (total, name) => total + collections[name].localTotal,
        0,
      ),
      remote: names.reduce(
        (total, name) => total + collections[name].remoteTotal,
        0,
      ),
      onlyLocal: names.reduce(
        (total, name) => total + collections[name].onlyLocal.length,
        0,
      ),
      onlyRemote: names.reduce(
        (total, name) => total + collections[name].onlyRemote.length,
        0,
      ),
      divergent: names.reduce(
        (total, name) => total + collections[name].divergent.length,
        0,
      ),
      equal: names.reduce(
        (total, name) => total + collections[name].equal.length,
        0,
      ),
    }),
    report = {
      generatedAt: now(),
      businessId,
      deviceId: deviceId(),
      collections,
      products: summarize(["products", "productVariants"]),
      clients: summarize(["clients"]),
      financial: {
        ...summarize(["sales", "payments", "balanceAdjustments"]),
        localBalance,
        remoteBalance,
        balanceDifference: Number((localBalance - remoteBalance).toFixed(2)),
        possibleDuplicates: [
          ...collections.sales.possibleDuplicates.local,
          ...collections.payments.possibleDuplicates.local,
          ...collections.balanceAdjustments.possibleDuplicates.local,
          ...collections.sales.possibleDuplicates.remote,
          ...collections.payments.possibleDuplicates.remote,
          ...collections.balanceAdjustments.possibleDuplicates.remote,
        ],
        balanceAudit,
      },
      queue: queueCounts(),
    };
  lastDataAuditRaw = {
    businessId,
    generatedAt: report.generatedAt,
    raw,
    remoteFinancialEffects,
    report,
  };
  try {
    localStorage.setItem(knownOrphanKey(), JSON.stringify(
      report.collections.sales.onlyLocal.map((item) => String(item.documentId))));
  } catch (error) { console.warn("[Only-local audit cache]", error?.message || error); }
  emit({ dataAudit: report });
  updateQueueState();
  return report;
}
async function exportLocalDiagnostic() {
  await validateUser();
  const businessId = activeBusinessId(),
    data = DB.carregar(),
    queue = readQueue(),
    profile = state.userProfile || {},
    entities = {};
  for (const name of AUDIT_NAMES)
    entities[name] = sourceItems(data, name).map((item) =>
      auditRecord(item, "local", name),
    );
  return {
    diagnosticVersion: 2,
    generatedAt: now(),
    build: window.AdiFestaBuild || null,
    projectId: PROJECT_ID,
    businessId,
    uid: currentUser?.uid
      ? `${currentUser.uid.slice(0, 6)}…${currentUser.uid.slice(-4)}`
      : "—",
    role: profile.role || "",
    schemaVersion: 3,
    deviceId: deviceId(),
    indexedDb: await indexedDbInventory(),
    localCounts: Object.fromEntries(
      Object.entries(entities).map(([name, items]) => [name, items.length]),
    ),
    queueCounts: queueCounts(),
    orphanOperations: saleIntegrityDiagnostics().count + paymentIntegrityDiagnostics().count,
    saleIntegrity: saleIntegrityDiagnostics(),
    paymentIntegrity: paymentIntegrityDiagnostics(),
    queue: queue.map((item) => ({
      operationId: String(item.operationId || item.queueId || ""),
      entityType: item.entityType || "unknown",
      subtype: item.subtype || queueSubtype(item),
      action: item.action || "transaction",
      documentId: item.entityId || "",
      destinationPath:
        item.businessId && item.payload?.writes?.[0]
          ? `businesses/${item.businessId}/${item.payload.writes[0].entityType}/${item.payload.writes[0].entityId}`
          : "indefinido",
      destinationPaths: (item.payload?.writes || []).map((write) =>
        item.businessId && write.entityType && write.entityId
          ? `businesses/${item.businessId}/${write.entityType}/${write.entityId}`
          : "indefinido",
      ),
      createdAt: item.createdAtLocal || item.createdAt || "",
      updatedAt: item.updatedAt || "",
      retryCount: Number(item.retryCount || item.attempts || 0),
      status: item.status || "pending",
      errorCode: item.lastErrorCode || "",
      errorMessage: item.lastErrorMessage || "",
      payloadVersion: Number(item.payloadVersion || 1),
      invalidPayload: containsInvalidFirestoreValue(item.payload),
      payloadChecksum: checksumValue(item.payload || {}),
    })),
    entities,
    lastCloudComparison: state.dataAudit || null,
  };
}
function downloadJsonFile(value, filename) {
  const url = URL.createObjectURL(
      new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }),
    ),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function automaticRecoveryBackup() {
  const backup = DB.criarBackup();
  downloadJsonFile(
    backup,
    `backup-antes-recuperacao-${activeBusinessId()}-${Date.now()}.json`,
  );
  return backup.backupId;
}
const currentAuditOrThrow = () => {
  if (
    !lastDataAuditRaw ||
    lastDataAuditRaw.businessId !== activeBusinessId()
  )
    throw Object.assign(
      new Error("Compare os dados com a nuvem antes de iniciar a recuperação."),
      { code: "audit-required" },
    );
  return lastDataAuditRaw;
};
const orphanSaleSignature = (sale = {}) => JSON.stringify({
  clientId: String(sale.clienteId || sale.customerId || ""),
  amount: roundedMoney(sale.valorFinal ?? sale.valorTotal ?? 0),
  items: (sale.itens || []).map((item) => [String(item.produtoId || item.productId || ""),
    Number(item.quantidade || 0), roundedMoney(item.precoFinalUnitario ?? item.precoUnitario ?? 0)]).sort(),
});
function onlyLocalSaleReport() {
  const audit = currentAuditOrThrow(),
    local = DB.carregar(),
    sales = audit.raw.sales.remoteItems || [],
    clients = new Map((local.clientes || []).map((client) => [String(client.id), client])),
    remoteClients = new Map((audit.raw.clients.remoteItems || []).map((client) => [String(client.id), client])),
    remoteEffects = new Map((audit.remoteFinancialEffects || []).map((effect) => [String(effect.id), effect])),
    products = new Map((local.produtos || []).map((product) => [String(product.id), product])),
    ids = audit.report.collections.sales.onlyLocal.map((item) => String(item.documentId));
  return ids.map((saleId) => {
    const sale = (local.vendas || []).find((item) => String(item.id) === saleId);
    if (!sale) return { saleId, classification: "E", recoveryMode: "", reason: "Venda não encontrada no armazenamento local." };
    const operationId = String(sale.operationId || ""),
      clientId = String(sale.clienteId || sale.customerId || ""),
      client = clients.get(clientId), remoteClient = remoteClients.get(clientId),
      review = readOrphanReviews()[saleId],
      amount = roundedMoney(sale.valorFinal ?? sale.valorTotal),
      credit = sale.formaPagamento === "fiado" || sale.status === "fiado",
      effect = remoteEffects.get(balanceEffectId("credit_sale", saleId)),
      effectMatches = Boolean(effect && String(effect.operationId || "") === operationId &&
        String(effect.sourceDocumentId || "") === saleId &&
        String(effect.customerId || effect.clientId || "") === clientId &&
        sameFinancialMoney(effect.balanceDelta, -amount)),
      alternate = sales.find((item) => String(item.id) !== saleId && operationId &&
        String(item.operationId || "") === operationId),
      duplicate = sales.find((item) => String(item.id) !== saleId &&
        String(item.clienteId || item.customerId || "") === clientId &&
        Math.abs((Date.parse(item.data || item.createdAt || "") || 0) -
          (Date.parse(sale.data || sale.createdAt || "") || 0)) <= 120000 &&
        orphanSaleSignature(item) === orphanSaleSignature(sale)),
      stockMovements = (local.movimentacoesEstoque || []).filter((item) => String(item.vendaId) === saleId),
      stockIndependent = Array.isArray(sale.itens) && sale.itens.length > 0 && sale.itens.every((item) => {
        const product = products.get(String(item.produtoId || ""));
        return item.itemKind === "service" || product?.itemKind === "service" ||
          product?.semControleEstoque === true || product?.controlaEstoque === false;
      }),
      laterFinancialOperations = [...(local.vendas || []), ...(local.pagamentos || []),
        ...(local.movimentacoes || []).filter((item) => item.tipo === "ajuste_saldo")]
        .filter((item) => String(item.id) !== saleId &&
          String(item.clienteId || item.customerId || "") === clientId &&
          (Date.parse(item.data || item.createdAt || "") || 0) >
            (Date.parse(sale.data || sale.createdAt || "") || 0)),
      selfContained = !stockMovements.length && stockIndependent && !laterFinancialOperations.length &&
        !(sale.appliedCampaignIds || []).length &&
        !(sale.campaignUpdates || []).length && !(sale.subscriptionUpdates || []).length,
      snapshotsMatch = Number.isFinite(Number(sale.saldoAnterior)) &&
        Number.isFinite(Number(sale.saldoAtual)) && Number.isFinite(amount) && amount > 0 &&
        sameFinancialMoney(sale.saldoAtual, Number(sale.saldoAnterior) - amount),
      modern = Number(sale.syncPipelineVersion || 0) >= 2;
    let classification = "E", recoveryMode = "", reason = "Impacto financeiro ou estoque sem prova suficiente; revisão manual.";
    if (sale.deletedAt || sale.active === false) {
      classification = "C"; reason = "Venda cancelada ou estornada; revisar antes de qualquer publicação.";
    } else if (alternate) {
      classification = "B"; reason = `Mesmo operationId já representado pela venda ${alternate.id}.`;
    } else if (duplicate) {
      classification = "D"; reason = `Possível duplicata da venda ${duplicate.id}.`;
    } else if (effect && !effectMatches) {
      reason = "Evento financeiro remoto incompatível com esta venda.";
    } else if (operationId && remoteClient && selfContained && snapshotsMatch && effectMatches) {
      classification = "A"; recoveryMode = "publish_only";
      reason = "Efeito financeiro comprovado; publicar somente a venda, sem novo débito.";
    } else if (operationId && selfContained && snapshotsMatch && credit && modern &&
      !effect && remoteClient &&
      sameFinancialMoney(remoteClient.saldo, sale.saldoAnterior) &&
      financialVersionOf(remoteClient) === Number(sale.financialVersionAnterior)) {
      classification = "A"; recoveryMode = "apply_financial";
      reason = "Saldo e versão remotos ainda são exatamente os anteriores; transação idempotente possível.";
    } else if (operationId && selfContained && !credit && modern && !effect) {
      classification = "A"; recoveryMode = "sale_only";
      reason = "Venda paga sem efeitos financeiros ou de estoque pendentes.";
    }
    return { saleId, operationId, customerId: clientId, customer: client?.nome || sale.clienteNome || "",
      amount, date: sale.data || sale.createdAt || "", paymentMethod: sale.formaPagamento || sale.status || "",
      status: sale.status || "", businessId: sale.businessId || "", spaceId: sale.spaceId || "",
      createdAt: sale.createdAt || "", updatedAt: sale.updatedAt || sale.atualizadoEm || "",
      items: (sale.itens || []).map((item) => ({ productId: item.produtoId || "",
        name: item.nome || "", quantity: Number(item.quantidade || 0),
        unitPrice: roundedMoney(item.precoFinalUnitario ?? item.precoUnitario ?? 0) })),
      saldoAnterior: sale.saldoAnterior ?? null, saldoAtual: sale.saldoAtual ?? null,
      financialVersionAnterior: sale.financialVersionAnterior ?? null,
      syncConfirmedAt: sale.syncConfirmedAt || null, financialAppliedAt: sale.financialAppliedAt || null,
      localCurrentBalance: client?.saldo ?? null, remoteCurrentBalance: remoteClient?.saldo ?? null,
      remoteFinancialVersion: remoteClient?.financialVersion ?? null,
      localExists: true, cloudExists: false, financialEffectExists: Boolean(effect),
      financialEffectMatches: effectMatches, localStockMovementCount: stockMovements.length,
      laterFinancialOperationCount: laterFinancialOperations.length,
      alternateRemoteSaleId: alternate?.id || "", possibleDuplicateSaleId: duplicate?.id || "",
      classification, recoveryMode, reason,
      reviewed: isOrphanReviewed(sale), reviewedAt: review?.reviewedAt || "",
      reviewReason: isOrphanReviewed(sale) ? review.reason : "" };
  });
}
async function reviewOnlyLocalSale(saleId, reason) {
  if (!currentUser || !["owner", "admin"].includes(String(state.userProfile?.role || "")) ||
    readOnlyMode || !navigator.onLine)
    throw Error("A revisão exige owner/admin e conexão com a nuvem.");
  const explanation = String(reason || "").trim();
  if (explanation.length < 20)
    throw Error("Descreva a evidência da conciliação em pelo menos 20 caracteres.");
  await compareDeviceWithCloud();
  const preview = onlyLocalSaleReport().find((item) => item.saleId === String(saleId));
  if (!preview || preview.classification === "A")
    throw Error("A venda não está classificada para revisão histórica. Refaça a comparação.");
  if (preview.localCurrentBalance === null || preview.remoteCurrentBalance === null ||
    !Number.isFinite(Number(preview.localCurrentBalance)) ||
    !Number.isFinite(Number(preview.remoteCurrentBalance)) ||
    !sameFinancialMoney(preview.localCurrentBalance, preview.remoteCurrentBalance))
    throw Error("Saldos local e remoto ainda diferem. Não é possível atestar ausência de impacto financeiro.");
  const sale = (DB.carregar().vendas || []).find((item) => String(item.id) === String(saleId));
  if (!sale) throw Error("A venda local não foi encontrada.");
  const reviews = readOrphanReviews();
  reviews[String(saleId)] = {
    saleId: String(saleId), operationId: String(sale.operationId || ""),
    checksum: checksumValue(sale), decision: "historical_reconciled", reason: explanation,
    reviewedAt: now(), reviewedBy: currentUser.uid,
    localBalanceAtReview: preview.localCurrentBalance,
    remoteBalanceAtReview: preview.remoteCurrentBalance,
    remoteFinancialVersionAtReview: preview.remoteFinancialVersion,
  };
  localStorage.setItem(orphanReviewKey(), JSON.stringify(reviews));
  return { saleId: String(saleId), reviewedAt: reviews[String(saleId)].reviewedAt };
}
async function recoverMissingNonFinancial() {
  const audit = currentAuditOrThrow(),
    businessId = activeBusinessId(),
    names = ["products", "productVariants", "clients"],
    queued = [];
  automaticRecoveryBackup();
  for (const name of names) {
    const missing = new Set(
      audit.report.collections[name].onlyLocal
        .filter((item) => item.classification === "B")
        .map((item) => item.documentId),
    );
    for (const item of audit.raw[name].localItems) {
      if (!missing.has(String(item.id))) continue;
      if (item.businessId && item.businessId !== businessId) continue;
      const clean = sanitizeForFirestore({
          ...item,
          businessId,
          source: "recovery_local_orphan",
          recoveryChecksum: checksumValue(item),
        }),
        operationId = `recovery:${businessId}:${name}:${checksumValue({ documentId: item.id, checksum: checksumValue(item) }).slice(-8)}`;
      if (name === "clients") {
        delete clean.saldo;
        clean.financialRecoveryRequired = true;
      }
      queueWrites(
        [
          {
            entityType: name,
            entityId: String(item.id),
            operation: "create",
            before: null,
            data: clean,
          },
        ],
        operationId,
        "recovery_local_orphan",
        { source: "recovery_local_orphan" },
      );
      queued.push({ entityType: name, documentId: String(item.id), operationId });
    }
  }
  const sync = queued.length
    ? await processSyncQueue({ force: true })
    : { sent: 0, pending: queueCounts().total, errors: queueCounts().errors };
  if (sync.sent) await safePublishSyncSignal(names, sync.errors ? "error" : "ok");
  const comparison = await compareDeviceWithCloud();
  return { backupCreated: true, queued: queued.length, sync, comparison };
}
async function recoverMissingFinancialMovements() {
  throw Object.assign(new Error("A recuperação financeira em lote foi desativada. Revise cada venda individualmente."),
    { code: "bulk-financial-recovery-disabled" });
}
async function recoverOnlyLocalSale(saleId) {
  if (!currentUser || readOnlyMode || !navigator.onLine ||
    !["owner", "admin"].includes(String(state.userProfile?.role || "")))
    throw Error("A recuperação individual exige owner/admin, acesso de escrita e conexão com a nuvem.");
  const id = String(saleId || "");
  if (!id) throw Error("Selecione uma venda para recuperar.");
  await compareDeviceWithCloud();
  const audit = currentAuditOrThrow(),
    local = (DB.carregar().vendas || []).find((sale) => String(sale.id) === id),
    remote = (audit.raw.sales.remoteItems || []).find((sale) => String(sale.id) === id);
  if (!local || (local.businessId && String(local.businessId) !== activeBusinessId()))
    throw Error("A venda não pertence a este aparelho/negócio.");
  if (remote) {
    if (String(remote.operationId || "") !== String(local.operationId || ""))
      throw Error("O saleId já pertence a outra operação na nuvem. Revisão manual obrigatória.");
    if (local.formaPagamento === "fiado" || local.status === "fiado") {
      const effect = (audit.remoteFinancialEffects || []).find((item) =>
        String(item.id) === balanceEffectId("credit_sale", id));
      if (!remote.financialAppliedAt || !effect ||
        String(effect.operationId || "") !== String(local.operationId || "") ||
        String(effect.sourceDocumentId || "") !== id)
        throw Error("A venda existe na nuvem, mas a confirmação financeira está incompleta. Revisão manual obrigatória.");
    }
    return { saleId: id, operationId: local.operationId, idempotent: true, recovered: false };
  }
  const preview = onlyLocalSaleReport().find((sale) => sale.saleId === id);
  if (preview?.classification !== "A" || !preview.recoveryMode)
    throw Error(`Esta venda exige revisão manual. ${preview?.reason || "Não há evidência suficiente."}`);
  const businessId = activeBusinessId(), operationId = String(local.operationId),
    clientId = String(local.clienteId || local.customerId || ""),
    credit = local.formaPagamento === "fiado" || local.status === "fiado",
    amount = roundedMoney(local.valorFinal ?? local.valorTotal),
    saleRef = doc(db, "businesses", businessId, "sales", id),
    effectId = balanceEffectId("credit_sale", id),
    effectRef = doc(db, "businesses", businessId, "balanceEvents", effectId),
    markerRef = doc(db, "businesses", businessId, "processedOperations", operationId),
    clientRef = clientId ? doc(db, "businesses", businessId, "clients", clientId) : null;
  automaticRecoveryBackup();
  const transactionResult = await runTransaction(db, async (transaction) => {
    const saleSnapshot = await transaction.get(saleRef),
      markerSnapshot = await transaction.get(markerRef),
      effectSnapshot = credit ? await transaction.get(effectRef) : null,
      clientSnapshot = credit && clientRef ? await transaction.get(clientRef) : null,
      effect = effectSnapshot?.exists() ? effectSnapshot.data() : null,
      client = clientSnapshot?.exists() ? clientSnapshot.data() : null;
    if (saleSnapshot.exists()) {
      if (String(saleSnapshot.data()?.operationId || "") !== operationId)
        throw Error("O saleId foi usado por outra operação durante a recuperação.");
      return { idempotent: true };
    }
    if (preview.recoveryMode === "publish_only") {
      if (!effect || String(effect.operationId || "") !== operationId ||
        String(effect.sourceDocumentId || "") !== id ||
        String(effect.customerId || effect.clientId || "") !== clientId ||
        !sameFinancialMoney(effect.balanceDelta, -amount))
        throw Error("O efeito financeiro mudou. Refaça a auditoria antes de recuperar.");
    } else {
      if (markerSnapshot.exists() || effect)
        throw Error("A operação já tem marcador ou efeito remoto. Revisão manual obrigatória.");
      if (preview.recoveryMode === "apply_financial" && (!client ||
        !sameFinancialMoney(client.saldo, local.saldoAnterior) ||
        financialVersionOf(client) !== Number(local.financialVersionAnterior) ||
        !sameFinancialMoney(local.saldoAtual, Number(local.saldoAnterior) - amount)))
        throw Error("O saldo ou a versão do cliente mudou. Nenhum débito foi aplicado.");
    }
    const appliedAt = preview.recoveryMode === "publish_only"
      ? effect.appliedAt || serverTimestamp() : serverTimestamp(),
      saleData = { ...local, operationId, idempotencyKey: operationId,
        recoverySource: "reviewed_only_local_sale", recoveryMode: preview.recoveryMode,
        recoveryChecksum: checksumValue(local), recoveredAt: serverTimestamp(),
        syncConfirmedAt: serverTimestamp(),
        ...(credit ? { status: "applied", applicationStatus: "applied",
          financialAppliedAt: appliedAt, financialOperationId: effectId } : {}) };
    transaction.set(saleRef, cloudPayload("sales", id, saleData, true));
    if (preview.recoveryMode === "apply_financial") {
      transaction.set(clientRef, {
        saldo: roundedMoney(Number(client.saldo) - amount),
        financialVersion: financialVersionOf(client) + 1,
        totalComprado: roundedMoney(Number(client.totalComprado || 0) + amount),
        quantidadeVendas: Number(client.quantidadeVendas || 0) + 1,
        updatedAt: serverTimestamp(),
      }, { merge: true });
      transaction.set(effectRef, sanitizeForFirestore({
        id: effectId, operationId, idempotencyKey: effectId, businessId,
        ownerId: currentUser.uid, sourceDeviceId: deviceId(),
        customerId: clientId, clientId, saleId: id,
        sourceCollection: "sales", sourceDocumentId: id,
        type: "credit_sale", direction: "debit", amount, balanceDelta: -amount,
        eventKind: "sale", status: "applied", appliedAt: serverTimestamp(),
        sourceCreatedAt: local.data || local.createdAt || now(),
        createdAt: local.data || local.createdAt || serverTimestamp(),
        updatedAt: serverTimestamp(), schemaVersion: 3,
      }));
    }
    if (!markerSnapshot.exists()) transaction.set(markerRef, sanitizeForFirestore({
      id: operationId, idempotencyKey: operationId, businessId, ownerId: currentUser.uid,
      eventKind: "sale", status: "processed", createdAtLocal: local.data || local.createdAt || now(),
      processedAt: serverTimestamp(), schemaVersion: 3,
    }));
    return { idempotent: false };
  });
  const confirmedSaleSnapshot = await getDocFromServer(saleRef),
    confirmedSale = confirmedSaleSnapshot.exists()
      ? cleanCloudItem({ id, ...confirmedSaleSnapshot.data() }) : null;
  if (!confirmedSale || String(confirmedSale.operationId || "") !== operationId ||
    (credit && !confirmedSale.financialAppliedAt))
    throw Error("A transação foi enviada, mas a confirmação remota não foi verificada. Não repita com outro ID.");
  applyCloudCollection("sales", [confirmedSale], { authoritative: true });
  if (credit && clientRef) {
    const confirmedClient = await getDocFromServer(clientRef);
    if (confirmedClient.exists())
      applyCloudCollection("clients", [{ id: clientId, ...confirmedClient.data() }], { authoritative: true });
  }
  await compareDeviceWithCloud();
  return { saleId: id, operationId, idempotent: transactionResult.idempotent,
    recovered: !transactionResult.idempotent, recoveryMode: preview.recoveryMode };
}
async function reconcileFinancialBalances() {
  await compareDeviceWithCloud();
  const audit = currentAuditOrThrow(),
    businessId = activeBusinessId(),
    balanceAudit = audit.report.financial.balanceAudit,
    repairs = [
      ...(balanceAudit?.safeRepairs || []),
      ...(balanceAudit?.effectBackfills || []),
    ],
    applied = [],
    blocked = [];
  if (audit.report.products.onlyLocal || audit.report.clients.onlyLocal)
    throw Object.assign(
      new Error(
        "Confirme primeiro os produtos e clientes ausentes antes de reconciliar saldos.",
      ),
      { code: "non-financial-recovery-required" },
    );
  if (!repairs.length)
    return {
      backupCreated: false,
      applied,
      blocked: balanceAudit?.unsafe || [],
      audit: balanceAudit,
      estimatedReads: 0,
    };
  const backupId = automaticRecoveryBackup();
  let estimatedReads = 0;
  for (const repair of repairs) {
    const reconciliationId = `balance-reconcile:${checksumValue({
        businessId,
        clientId: repair.clientId,
        latestOperationId: repair.latestOperationId,
        expectedBalance: repair.expectedBalance,
      }).slice(-8)}`,
      marker = doc(
        db,
        "businesses",
        businessId,
        "processedOperations",
        reconciliationId,
      ),
      clientReference = doc(
        db,
        "businesses",
        businessId,
        "clients",
        repair.clientId,
      );
    try {
      const result = await runTransaction(db, async (transaction) => {
        const markerSnapshot = await transaction.get(marker),
          clientSnapshot = await transaction.get(clientReference);
        estimatedReads += 2;
        if (markerSnapshot.exists()) return { idempotent: true };
        if (!clientSnapshot.exists())
          throw Object.assign(new Error("Cliente não encontrado na nuvem."), {
            code: "financial-client-missing",
          });
        const currentClient = normalizeFirestoreData(clientSnapshot.data());
        if (!sameMoney(currentClient.saldo || 0, repair.actualBalance))
          throw Object.assign(
            new Error(
              "O saldo mudou depois da prévia. Execute uma nova auditoria.",
            ),
            { code: "financial-preview-stale" },
          );
        const confirmations = [];
        for (const event of repair.missingEffects) {
          const effectReference = doc(
              db,
              "businesses",
              businessId,
              "balanceEvents",
              event.effectId,
            ),
            sourceReference = doc(
              db,
              "businesses",
              businessId,
              event.sourceCollection,
              event.sourceDocumentId,
            ),
            effectSnapshot = await transaction.get(effectReference),
            sourceSnapshot = await transaction.get(sourceReference);
          estimatedReads += 2;
          if (effectSnapshot.exists())
            throw Object.assign(
              new Error(
                "Um movimento já foi aplicado depois da prévia. Execute novamente.",
              ),
              { code: "financial-preview-stale" },
            );
          if (
            !sourceSnapshot.exists() ||
            checksumValue(normalizeFirestoreData(sourceSnapshot.data())) !==
              event.sourceChecksum
          )
            throw Object.assign(
              new Error(
                "A operação de origem mudou depois da prévia. Nenhum saldo foi alterado.",
              ),
              { code: "financial-preview-stale" },
            );
          confirmations.push({ event, effectReference, sourceReference });
        }
        for (const { event, effectReference, sourceReference } of confirmations) {
          transaction.set(
            effectReference,
            sanitizeForFirestore({
              id: event.effectId,
              operationId: event.operationId,
              idempotencyKey: event.effectId,
              businessId,
              ownerId: currentUser.uid,
              customerId: event.customerId,
              clientId: event.customerId,
              saleId:
                event.sourceCollection === "sales"
                  ? event.sourceDocumentId
                  : null,
              sourceCollection: event.sourceCollection,
              sourceDocumentId: event.sourceDocumentId,
              type: event.type,
              direction: event.balanceDelta < 0 ? "debit" : "credit",
              amount: event.amount,
              balanceDelta: event.balanceDelta,
              sourceDeviceId: deviceId(),
              status: "applied_by_reconciliation",
              sourceCreatedAt: event.date,
              appliedAt: serverTimestamp(),
              createdAt: serverTimestamp(),
              updatedAt: serverTimestamp(),
              schemaVersion: 3,
            }),
          );
          transaction.set(
            sourceReference,
            {
              financialAppliedAt: serverTimestamp(),
              financialOperationId: event.effectId,
              updatedAt: serverTimestamp(),
            },
            { merge: true },
          );
        }
        const missingSales = repair.missingEffects.filter(
            (event) => event.type === "credit_sale",
          ),
          reversedSales = repair.missingEffects.filter(
            (event) => event.type === "credit_sale_reversal",
          ),
          purchaseValueDelta = roundedMoney(
            missingSales.reduce((sum, event) => sum + event.amount, 0) -
              reversedSales.reduce((sum, event) => sum + event.amount, 0),
          ),
          purchaseCountDelta = missingSales.length - reversedSales.length,
          latestPurchaseAt = missingSales
            .map((event) => event.date)
            .filter(Boolean)
            .sort()
            .at(-1),
          clientPatch = {
            saldo: roundedMoney(repair.expectedBalance),
            openBalance: Math.abs(
              Math.min(0, roundedMoney(repair.expectedBalance)),
            ),
            financialRevision: repair.latestOperationId,
            financialReconciledAt: serverTimestamp(),
            updatedAt: serverTimestamp(),
            revision: increment(1),
          };
        if (purchaseValueDelta && !repair.balanceAlreadyApplied)
          clientPatch.totalComprado = increment(purchaseValueDelta);
        if (purchaseCountDelta && !repair.balanceAlreadyApplied)
          clientPatch.quantidadeVendas = increment(purchaseCountDelta);
        if (latestPurchaseAt && !repair.balanceAlreadyApplied)
          clientPatch.ultimaCompra = latestPurchaseAt;
        transaction.set(clientReference, clientPatch, { merge: true });
        transaction.set(
          marker,
          sanitizeForFirestore({
            id: reconciliationId,
            idempotencyKey: reconciliationId,
            businessId,
            ownerId: currentUser.uid,
            status: "processed",
            eventKind: "balance_reconciliation",
            processedAt: serverTimestamp(),
            createdAtLocal: now(),
            schemaVersion: 3,
          }),
        );
        return { idempotent: false };
      });
      applied.push({
        clientId: repair.clientId,
        reconciliationId,
        expectedBalance: repair.expectedBalance,
        effects: repair.missingEffects.length,
        idempotent: Boolean(result?.idempotent),
      });
    } catch (error) {
      blocked.push({
        clientId: repair.clientId,
        code: errorCode(error) || error.code || "unknown",
        message: String(error.message || "Falha na reconciliação.").slice(0, 240),
      });
    }
  }
  if (applied.length)
    await safePublishSyncSignal(
      ["clients", "sales", "payments", "balanceAdjustments"],
      blocked.length ? "error" : "ok",
    );
  const comparison = await compareDeviceWithCloud();
  return {
    backupCreated: true,
    backupId,
    applied,
    blocked,
    estimatedReads,
    comparison,
  };
}
async function refreshSafelyFromServer() {
  const audit = currentAuditOrThrow(),
    hasRisk =
      queueCounts().total > 0 ||
      Object.values(audit.report.collections).some(
        (item) => item.onlyLocal.length || item.divergent.length,
      );
  if (hasRisk)
    throw Object.assign(
      new Error("Existem dados locais que poderiam ser perdidos. Resolva a auditoria primeiro."),
      { code: "local-data-at-risk" },
    );
  const received = await pullCloudCollections({ force: true, full: true });
  return { received, comparison: await compareDeviceWithCloud() };
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
  if (sent && result.errorBreakdown?.permission)
    return `${sent} operação(ões) sincronizada(s). ${result.errorBreakdown.permission} continuam bloqueadas por permissão.`;
  if (!sent && result.errorBreakdown?.invalid)
    return `Não foi possível sincronizar: ${result.errorBreakdown.invalid} operação(ões) ainda contêm dados inválidos.`;
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
  const migration = migrateScopedQueueCompatibility();
  validateQueueOwnership();
  const push = await processSyncQueue({ force: true });
  if (push.paused && push.reason !== "subscription_read_only") {
      const counts = queueCounts(),
      result = {
        ...push,
        migration,
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
      migration,
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
async function runAutomaticSync() {
  quickTimer = null;
  if (!currentUser || !navigator.onLine || processingPromise || cloudPaused)
    return;
  window.AppBootDiagnostics?.count?.("initialSyncCount");
  try {
    if (!state.testPassed) await testFirestoreConnection();
    const push = await processSyncQueue(),
      projection =
        document.visibilityState === "visible"
          ? await ensureClientProjection()
          : null,
      received =
        document.visibilityState === "visible"
          ? await pullCloudCollections({
              names: projection?.repaired
                ? DEFAULT_PULL_NAMES.filter((name) => name !== "clients")
                : undefined,
            })
          : 0;
    if (push.sent || push.errors)
      await safePublishSyncSignal(push.collections, push.errors ? "error" : "ok");
    if (push.sent || received || projection?.repaired) {
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
        clientProjection: projection,
      });
    } else updateQueueState();
  } catch (error) {
    if (errorCode(error) === "resource-exhausted") cloudPaused = true;
    if (state.status !== "error") reportError(error, "Automatic sync");
  }
}
function automaticSync() {
  if (automaticSyncPromise) return automaticSyncPromise;
  automaticSyncPromise = runAutomaticSync().finally(() => {
    automaticSyncPromise = null;
  });
  return automaticSyncPromise;
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
async function auditSuspiciousPayments(options = {}) {
  await validateUser();
  const businessId = activeBusinessId(),
    [payments, effects, clients] = await Promise.all([
      repositories.payments.listAllPaged(200),
      financialEffectsRepository.listAllPaged(200),
      repositories.clients.listAllPaged(200),
    ]),
    suspects =
      window.FinancialConcurrency?.suspiciousPayments?.(
        payments,
        effects,
        clients,
        { hours: options.hours || 48 },
      ) || [],
    signedBalance = roundedMoney(
      clients.reduce((sum, client) => sum + Number(client.saldo || 0), 0),
    ),
    openDebt = roundedMoney(
      clients.reduce(
        (sum, client) =>
          sum + Math.abs(Math.min(0, Number(client.saldo || 0))),
        0,
      ),
    );
  return {
    generatedAt: now(),
    businessId,
    windowHours: Math.max(1, Number(options.hours || 48)),
    paymentsChecked: payments.length,
    effectsChecked: effects.length,
    clientsChecked: clients.length,
    firestoreReads: payments.length + effects.length + clients.length,
    signedBalance,
    openDebt,
    suspects: suspects.filter((item) => !item.resolved),
    resolved: suspects.filter((item) => item.resolved),
  };
}
async function reverseDuplicatePayment(options = {}) {
  const session = await validateUser();
  if (!["owner", "admin"].includes(String(session.profile?.role || "")))
    throw Object.assign(
      new Error("Somente proprietário ou administrador pode executar a reversão."),
      { code: "permission-denied" },
    );
  const businessId = activeBusinessId(),
    clientId = String(options.clientId || ""),
    legitimatePaymentId = String(options.legitimatePaymentId || ""),
    duplicatePaymentId = String(options.duplicatePaymentId || ""),
    expectedBalance = roundedMoney(options.expectedBalance),
    targetBalance = roundedMoney(options.targetBalance),
    reason =
      String(options.reason || "").trim() ||
      "duplicate_payment_from_stale_projection",
    operationId = String(
      options.operationId ||
        `duplicate-payment-reversal:${duplicatePaymentId}`,
    ),
    effectId = `payment_received:${duplicatePaymentId}`,
    reversalEffectId = `payment_reversal:${duplicatePaymentId}`,
    requestedAt = now();
  if (!clientId || !legitimatePaymentId || !duplicatePaymentId)
    throw Object.assign(
      new Error("Informe cliente, pagamento legítimo e pagamento duplicado."),
      { code: "invalid-argument" },
    );
  const markerReference = doc(
      db,
      "businesses",
      businessId,
      "processedOperations",
      operationId,
    ),
    clientReference = doc(
      db,
      "businesses",
      businessId,
      "clients",
      clientId,
    ),
    legitimateReference = doc(
      db,
      "businesses",
      businessId,
      "payments",
      legitimatePaymentId,
    ),
    duplicateReference = doc(
      db,
      "businesses",
      businessId,
      "payments",
      duplicatePaymentId,
    ),
    effectReference = doc(
      db,
      "businesses",
      businessId,
      "balanceEvents",
      effectId,
    ),
    reversalEffectReference = doc(
      db,
      "businesses",
      businessId,
      "balanceEvents",
      reversalEffectId,
    ),
    adjustmentReference = doc(
      db,
      "businesses",
      businessId,
      "balanceAdjustments",
      operationId,
    );
  let outcome = null;
  await runTransaction(db, async (transaction) => {
    const markerSnapshot = await transaction.get(markerReference);
    if (markerSnapshot.exists()) {
      outcome = {
        idempotent: true,
        operationId,
        clientId,
        duplicatePaymentId,
        legitimatePaymentId,
        balanceBefore: expectedBalance,
        balanceAfter: targetBalance,
        amount: roundedMoney(expectedBalance - targetBalance),
        reversalEffectId,
      };
      return;
    }
    const [
        clientSnapshot,
        legitimateSnapshot,
        duplicateSnapshot,
        effectSnapshot,
        reversalEffectSnapshot,
        adjustmentSnapshot,
      ] = await Promise.all([
        transaction.get(clientReference),
        transaction.get(legitimateReference),
        transaction.get(duplicateReference),
        transaction.get(effectReference),
        transaction.get(reversalEffectReference),
        transaction.get(adjustmentReference),
      ]),
      client = clientSnapshot.exists() ? clientSnapshot.data() || {} : null,
      legitimate = legitimateSnapshot.exists()
        ? legitimateSnapshot.data() || {}
        : null,
      duplicate = duplicateSnapshot.exists()
        ? duplicateSnapshot.data() || {}
        : null,
      effect = effectSnapshot.exists() ? effectSnapshot.data() || {} : null;
    if (!client || !legitimate || !duplicate || !effect)
      throw Object.assign(
        new Error("Os documentos financeiros necessários não foram encontrados."),
        { code: "not-found" },
      );
    const amount = roundedMoney(duplicate.valor ?? duplicate.amount),
      currentBalance = roundedMoney(client.saldo || 0),
      correctedBalance = roundedMoney(currentBalance - amount),
      financialVersionBefore = financialVersionOf(client);
    if (
      amount <= 0 ||
      effect.type !== "payment_received" ||
      String(effect.sourceDocumentId || "") !== duplicatePaymentId ||
      effect.status !== "applied" ||
      !sameFinancialMoney(effect.amount, amount) ||
      String(effect.customerId || effect.clientId || "") !== clientId
    )
      throw Object.assign(
        new Error("O efeito aplicado não corresponde ao pagamento duplicado."),
        { code: "financial-effect-mismatch" },
      );
    if (
      String(legitimate.clienteId || legitimate.clientId || "") !== clientId ||
      String(duplicate.clienteId || duplicate.clientId || "") !== clientId ||
      !sameFinancialMoney(
        legitimate.valor ?? legitimate.amount,
        amount,
      )
    )
      throw Object.assign(
        new Error("Os pagamentos não correspondem ao cliente e valor auditados."),
        { code: "failed-precondition" },
      );
    if (
      !sameFinancialMoney(currentBalance, expectedBalance) ||
      !sameFinancialMoney(correctedBalance, targetBalance)
    )
      throw Object.assign(
        new Error("O saldo mudou depois da prévia da reversão."),
        {
          code: "financial-preview-stale",
          currentBalance,
          expectedBalance,
        },
      );
    if (
      duplicate.status === "reversed" ||
      reversalEffectSnapshot.exists() ||
      adjustmentSnapshot.exists()
    )
      throw Object.assign(
        new Error("A reversão já existe sem o marcador idempotente esperado."),
        { code: "financial-reversal-state-conflict" },
      );
    if (
      (duplicate.allocations || []).length ||
      (duplicate.campaignConfirmations || []).length
    )
      throw Object.assign(
        new Error("O pagamento possui efeitos de campanha e exige revisão manual."),
        { code: "payment-campaign-reversal-required" },
      );
    const adjustment = sanitizeForFirestore({
        id: operationId,
        operationId,
        idempotencyKey: operationId,
        businessId,
        ownerId: currentUser.uid,
        clienteId: clientId,
        clientId,
        clienteNome: client.nome || duplicate.clienteNome || "",
        tipo: "ajuste_saldo",
        subtipo: "pagamento_duplicado_revertido",
        valor: -amount,
        saldoAnterior: currentBalance,
        saldoNovo: correctedBalance,
        motivo: "Pagamento registrado duas vezes em dispositivos diferentes.",
        reversalReason: reason,
        duplicatePaymentId,
        duplicateOf: legitimatePaymentId,
        reversesEffectId: effectId,
        data: requestedAt,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        schemaVersion: 3,
        version: 1,
      }),
      reversalEffect = sanitizeForFirestore({
        id: reversalEffectId,
        operationId,
        idempotencyKey: reversalEffectId,
        businessId,
        ownerId: currentUser.uid,
        customerId: clientId,
        clientId,
        sourceCollection: "payments",
        sourceDocumentId: duplicatePaymentId,
        type: "payment_reversal",
        direction: "debit",
        amount,
        balanceDelta: -amount,
        eventKind: "duplicate_payment_reversal",
        reversesEffectId: effectId,
        duplicateOf: legitimatePaymentId,
        status: "applied",
        sourceCreatedAt: requestedAt,
        appliedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        schemaVersion: 3,
      });
    transaction.set(
      clientReference,
      {
        businessId,
        ownerId: currentUser.uid,
        saldo: correctedBalance,
        openBalance: Math.abs(Math.min(0, correctedBalance)),
        financialVersion: financialVersionBefore + 1,
        financialRevision: operationId,
        financialReconciledAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
        version: increment(1),
      },
      { merge: true },
    );
    transaction.set(
      duplicateReference,
      {
        businessId,
        ownerId: currentUser.uid,
        status: "reversed",
        applicationStatus: "reversed",
        reversalReason: reason,
        reversedAt: serverTimestamp(),
        reversedByOperationId: operationId,
        duplicateOf: legitimatePaymentId,
        reversalEffectId,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    transaction.set(
      effectReference,
      {
        businessId,
        ownerId: currentUser.uid,
        status: "reversed",
        reversalReason: reason,
        reversedAt: serverTimestamp(),
        reversedByOperationId: operationId,
        reversalEffectId,
        updatedAt: serverTimestamp(),
      },
      { merge: true },
    );
    transaction.set(reversalEffectReference, reversalEffect);
    transaction.set(adjustmentReference, adjustment);
    transaction.set(
      markerReference,
      sanitizeForFirestore({
        id: operationId,
        idempotencyKey: operationId,
        businessId,
        ownerId: currentUser.uid,
        status: "processed",
        eventKind: "duplicate_payment_reversal",
        processedAt: serverTimestamp(),
        createdAtLocal: requestedAt,
        schemaVersion: 3,
      }),
    );
    outcome = {
      idempotent: false,
      operationId,
      clientId,
      clientName: client.nome || duplicate.clienteNome || "",
      duplicatePaymentId,
      legitimatePaymentId,
      balanceBefore: currentBalance,
      balanceAfter: correctedBalance,
      amount,
      financialVersionBefore,
      financialVersionAfter: financialVersionBefore + 1,
      reversalEffectId,
      adjustmentId: operationId,
      totalComprado: Number(client.totalComprado || 0),
      quantidadeVendas: Number(client.quantidadeVendas || 0),
      ultimaCompra: client.ultimaCompra || null,
    };
  });
  if (outcome && originalAlter) {
    applyingCloud = true;
    try {
      originalAlter((data) => {
        const client = (data.clientes || []).find(
            (entry) => String(entry.id) === clientId,
          ),
          duplicate = (data.pagamentos || []).find(
            (entry) => String(entry.id) === duplicatePaymentId,
          );
        if (client) {
          client.saldo = outcome.balanceAfter;
          if (Number.isFinite(Number(outcome.financialVersionAfter)))
            client.financialVersion = Number(outcome.financialVersionAfter);
          client.openBalance = Math.abs(
            Math.min(0, Number(outcome.balanceAfter || 0)),
          );
          client.financialRevision = operationId;
        }
        if (duplicate)
          Object.assign(duplicate, {
            status: "reversed",
            applicationStatus: "reversed",
            reversalReason: reason,
            reversedAt: requestedAt,
            reversedByOperationId: operationId,
            duplicateOf: legitimatePaymentId,
            reversalEffectId,
          });
        const duplicateMovement = (data.movimentacoes || []).find(
          (entry) => String(entry.id) === duplicatePaymentId,
        );
        if (duplicateMovement)
          Object.assign(duplicateMovement, {
            status: "reversed",
            applicationStatus: "reversed",
            reversalReason: reason,
            reversedAt: requestedAt,
            reversedByOperationId: operationId,
            duplicateOf: legitimatePaymentId,
          });
        if (
          !outcome.idempotent &&
          !(data.movimentacoes || []).some(
            (entry) => String(entry.id) === operationId,
          )
        )
          data.movimentacoes.push({
            id: operationId,
            operationId,
            businessId,
            clienteId: clientId,
            clientId,
            clienteNome: outcome.clientName,
            tipo: "ajuste_saldo",
            subtipo: "pagamento_duplicado_revertido",
            valor: -outcome.amount,
            saldoAnterior: outcome.balanceBefore,
            saldoNovo: outcome.balanceAfter,
            motivo: "Pagamento registrado duas vezes em dispositivos diferentes.",
            reversalReason: reason,
            duplicatePaymentId,
            duplicateOf: legitimatePaymentId,
            data: requestedAt,
            schemaVersion: 3,
          });
      });
    } finally {
      applyingCloud = false;
    }
    notifyCloudCollectionChange("clients", 1);
    notifyCloudCollectionChange("payments", 1);
    notifyCloudCollectionChange("balanceAdjustments", 1);
  }
  return outcome;
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
  lastDataAuditRaw = null;
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
    dataAudit: null,
    snapshotMetadata: {},
    clientProjection: null,
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
  try { resumePreparedSales(); }
  catch (error) { reportError(error, "Prepared financial queue"); }
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
window.AppLifecycle?.onResume?.(() => scheduleImmediate());

window.FirestoreRepositories = repositories;
window.dataRepository = repositories;
window.getFirebaseDiagnostic = diagnostic;
window.SyncFirebase = {
  setUser,
  setAuthReady: (value) => emit({ authReady: Boolean(value) }),
  stop: () => setUser(null),
  subscribe: (callback) => {
    subscribers.add(callback);
    const details = diagnostic();
    callback({
      ...state,
      ...queueCounts(),
      queueTotal: queueCounts().total,
      orphanOperations: details.orphanOperations || (state.dataAudit ? 0 : "Não verificado"),
      details,
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
  createSaleOperation,
  createPaymentOperation,
  assertSaleTracked,
  assertPaymentTracked,
  isSalePending,
  prepareCustomerForSale,
  confirmCreditSale,
  synchronizeNow,
  syncAll: synchronizeNow,
  pushPendingOperations: processSyncQueue,
  pullCloudCollections,
  ensureClientProjection,
  queryClientsPage,
  queryAllClientsForAction,
  queryClientsByInactivity,
  queryCustomerSubscriptions,
  loadProductVariants,
  findProductVariantByBarcode,
  compare: compareLocalAndCloud,
  compareDeviceWithCloud,
  exportLocalDiagnostic,
  downloadJsonFile,
  onlyLocalSaleReport,
  recoverOnlyLocalSale,
  reviewOnlyLocalSale,
  recoverMissingNonFinancial,
  recoverMissingFinancialMovements,
  reconcileFinancialBalances,
  refreshSafelyFromServer,
  checksumValue,
  reconcileLocalAndCloud,
  startCloudSubscriptions,
  stopCloudSubscriptions,
  startAutoSync,
  stopAutoSync,
  schedule: scheduleImmediate,
  notifyRemoteChange: (collections) => publishSyncSignal(collections),
  captureExternalChange,
  restoreBackupData: safeRestoreBackupData,
  auditSuspiciousPayments,
  reverseDuplicatePayment,
  resolveLocalPaymentAdjustment,
  deviceId,
  clearLocalDevice,
  archiveQueue,
  snapshot: localSummary,
  diagnostics: diagnostic,
  isReady: () => Boolean(currentUser),
  setScreen: setUsageScreen,
};
