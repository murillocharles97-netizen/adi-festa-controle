import { auth, db, PROJECT_ID } from "./firebase-config.js";
import {
  collection,
  deleteField,
  doc,
  getDoc,
  getDocFromServer,
  getDocs,
  increment,
  runTransaction,
  serverTimestamp,
  setDoc,
} from "./workspace-firestore.js";
import { createFirestoreRepository } from "./firestore-repository.js?v=204";
import {
  normalizeFirestoreData,
  sanitizeForFirestore,
} from "./firestore-utils.js";
import { setUsageScreen, usageSnapshot } from "./usage-monitor.js";
import '../integrity.js?v=157';
import {prepareProductImportFence} from './product-import-fence.js';

// Compatibility API for synchronous domain code; backed by structured IDB rows.
// All durable boundaries below await DB.flush before upload/success/cursor advance.
const localStorage = window.DB.businessCache.keyValue;
let lastFullPullForAudit = null;

const LEGACY_QUEUE_KEY = "adiFestaFirestoreQueue_v1",
  PULL_TTL_MS = 300000,
  PROFILE_TTL_MS = 300000,
  CANONICAL_CLIENT_TTL_MS = 120000,
  CLIENT_PROJECTION_EPOCH = 2,
  CLIENT_PROJECTION_CHECK_TTL_MS = 24 * 60 * 60 * 1000,
  MAX_WRITES = 350,
  PAYLOAD_VERSION = 4,
  DEVICE_ID_KEY = "adiFestaDeviceId";
const SOURCES = {
  clients: { key: "clientes" },
  products: { key: "produtos" },
  productFinancials: { key: "productFinancials" },
  productVariants: { key: "variacoesProdutos" },
  variantFinancials: { key: "variantFinancials" },
  sales: { key: "vendas" },
  saleFinancials: { key: "saleFinancials" },
  payments: { key: "pagamentos" },
  balanceAdjustments: {
    key: "movimentacoes",
    filter: (item) => item.tipo === "ajuste_saldo",
  },
  stockMovements: { key: "movimentacoesEstoque" },
  stockMovementFinancials: { key: "stockMovementFinancials" },
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
const REALTIME_NAMES = new Set(["products", "productFinancials", "settings"]);
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
function canPullSource(name) {
  const has = window.TeamAccess?.has;
  if (typeof has !== "function") return true;
  if (["products", "productVariants"].includes(name)) return has("products.view");
  if (name === "clients") return has("customers.view");
  if (name === "messageHistory" && has("customers.view") && has("customers.edit")) return true;
  if (name === "sales") return window.TeamAccess?.canReadOperationalSales?.() ?? (has("sales.create") || has("sales.viewAll"));
  if (name === "catalogOrders") return has("sales.viewAll");
  if (name === "stockMovements") return has("inventory.view");
  if (["productFinancials", "variantFinancials", "stockMovementFinancials"].includes(name))
    return has("cost.view");
  if (name === "saleFinancials") return has("cost.view") || has("profit.view");
  if (["payments", "balanceAdjustments", "charges", "paymentAllocations"].includes(name))
    return has("financial.view") || has("customers.receiveDebt") || has("customers.adjustBalance");
  if (["campaigns", "campaignProgress", "rewards", "campaignEvents", "campaignRedemptions", "paymentAllocations", "customerSubscriptions", "customerSubscriptionEvents", "messageHistory", "messageTemplates", "messageSequences", "clientContacts", "catalogOrders"].includes(name))
    return has("sales.create") || has("reports.view");
  if (["customerSegments", "visits", "customerMetrics", "customerMonthlyMetrics"].includes(name))
    return has("reports.view");
  return name === "settings";
}
// O boot precisa apenas dos dados que alimentam o dashboard. As demais
// coleções continuam chegando pelo sinal incremental ou por sincronização
// manual, sem varrer todo o histórico de uma conta nova no dispositivo.
const DEFAULT_PULL_NAMES = [
    "catalogOrders",
    "clients",
    "sales",
    "productFinancials",
    "variantFinancials",
    "saleFinancials",
    "stockMovementFinancials",
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
  activityEventsRepository = createFirestoreRepository("activityEvents"),
  syncSignalRepository = createFirestoreRepository("syncMetadata"),
  syncSessionId = crypto.randomUUID();
let currentUser = null,
  syncSessionGeneration = 0,
  originalAlter = null,
  applyingCloud = false,
  processingPromise = null,
  automaticSyncPromise = null,
  manualSyncPromise = null,
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
  cloudReadController = null,
  cloudReadRestartTimer = null,
  signalCollections = new Set(),
  signalVersions = new Map(),
  canonicalClientSnapshots = new Map(),
  listenerRegistry = new Map(),
  lastDataAuditRaw = null,
  activityEventsCursor = null,
  activityEventsHasMore = false,
  activitySubscriptionGeneration = 0;
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
  syncFailure: null,
  syncFailureHistory: [],
  sessionTrace: [],
  syncTrace: [],
  integrityStatus: "not_checked",
  integrityFailure: null,
};

// Bounded diagnostics: never include document payloads, emails or credentials.
function traceSync(stage, detail = {}) {
  const entry = { stage, at: new Date().toISOString(), ...detail };
  state.syncTrace = [...state.syncTrace.slice(-39), entry];
  if (window.__VECONI_DEV__ || ["localhost", "127.0.0.1"].includes(location.hostname)) console.info("[SYNC]", entry);
}
async function syncStep(stage, operation, detail = {}) {
  const readScopeToken=captureCloudReadScope();
  traceSync(stage, detail);
  try {
    const result = await operation();
    assertCloudReadScope(readScopeToken);
    traceSync(`${stage}:completed`, detail);
    return result;
  } catch (error) {
    if(readScopeToken!==captureCloudReadScope())throw Object.assign(Error('A sessão mudou durante a operação. A fila original foi preservada.'),{code:'sync-session-retired'});
    if (!error.syncDetail) error.syncDetail = {
      stage, ...detail, code: error.code || (error.name === "QuotaExceededError" ? (detail.service === "IndexedDB" ? "indexeddb-quota" : "local-storage-quota") : errorCode(error) || error.name || "unknown"),
      message: String(error.technicalMessage || error.message || "Falha sem mensagem").slice(0, 600),
      exception: error.name || "Error", at: new Date().toISOString(),
      ...(error.storageDetail ? {storage: error.storageDetail} : {}),
    };
    throw error;
  }
}
function writeSyncTime(key, value) {
  try { localStorage.setItem(key, value); }
  catch (error) {
    // Status metadata is not business data; don't fail a completed transfer for it.
    traceSync("status_timestamp_not_persisted", { service: "IndexedDB", code: error.code || error.name || "storage-error" });
  }
}
function readSyncTime(key, legacyKey = "") {
  try { return localStorage.getItem(key) || (legacyKey ? localStorage.getItem(legacyKey) : "") || ""; }
  catch { return ""; }
}

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
  String(error?.code || "").replace(/^(?:firestore|functions)\//, "");
const friendlyError = (error) =>
  ({
    "local-storage-quota": "Não foi possível atualizar o armazenamento local da VECONI. Veja os detalhes da sincronização.",
    "indexeddb-quota": "Não foi possível atualizar o armazenamento local da VECONI. Os dados já salvos foram preservados.",
    "indexeddb-write-failed": "Não foi possível atualizar o armazenamento local da VECONI. Tente novamente sem fechar o aplicativo.",
    "local-cache-conflict": "Os dados locais mudaram em outra aba. Feche a outra aba e reabra a VECONI antes de continuar.",
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
  })[error.code || (error?.name === "QuotaExceededError" ? "local-storage-quota" : errorCode(error))] || "Não foi possível sincronizar agora. Veja os detalhes técnicos no painel da nuvem.";
const permissionSignature = () => {
  const context = window.BusinessContext?.get?.() || {}, permissions = [...(context.permissions || [])].sort().join("|");
  let hash = 2166136261;
  for (const char of permissions) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(36);
};
const namespace = () => [
  state.userProfile?.businessId || "__signed_out__",
  currentUser?.uid || "anonymous",
  permissionSignature(),
  ...(window.DB?.getWorkspaceGeneration?.()>0?[`generation:${window.DB.getWorkspaceGeneration()}`]:[]),
].join(":");
const queueKey = () => `adiFesta:${namespace()}:syncQueue`;
const pullStateKey = () => `adiFesta:${namespace()}:incrementalPull`;
const lastSyncKey = () => `adiFesta:${namespace()}:lastSync`;
const lastAttemptKey = () => `adiFesta:${namespace()}:lastSyncAttempt`;
const lastCompleteKey = () => `adiFesta:${namespace()}:lastCompleteSync`;
const signalVersionKey = () => `adiFesta:${namespace()}:syncSignalVersions`;
const deviceId = ({diagnostic = false} = {}) => {
  if (diagnostic && window.DB?.businessCache?.ready?.() === false) return null;
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
  if (names.has("sales")) return kind || "simple";
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
const legacyReconciliationOperationId = (saleId) =>
  `legacy_reconciliation:${String(saleId || "").replaceAll("/", "_")}`;
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
        isCredit = current.formaPagamento === "fiado" || current.status === "fiado";
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
      isCredit = current.formaPagamento === "fiado" || current.status === "fiado";
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
      (type === "credit_sale_reversal" ? source.data?.deletedAt || now() : null) ||
      source.data?.data ||
      source.data?.createdAt ||
      source.before?.data ||
      source.before?.createdAt ||
      now(),
  };
}
function validateCreditSaleReversal(sale, client, debit, effect, clientWrite) {
  const fail = () => { throw Object.assign(Error("O cancelamento Fiado exige conciliação: débito, recebimentos ou saldo atual não conferem. Nenhum efeito foi aplicado na nuvem."), {code:"credit-sale-reversal-conflict"}); };
  const clientId = String(sale?.clienteId || sale?.customerId || "");
  if (!sale || sale.deletedAt || sale.active === false ||
    sale.businessId !== effect.businessId || !sale.spaceId ||
    (sale.formaPagamento !== "fiado" && sale.status !== "fiado") ||
    clientId !== effect.customerId ||
    !sameFinancialMoney(sale.valorFinal ?? sale.valorTotal, effect.amount) ||
    !debit || debit.businessId !== effect.businessId ||
    debit.type !== "credit_sale" || debit.status !== "applied" ||
    debit.sourceDocumentId !== effect.saleId ||
    String(debit.customerId || debit.clientId || "") !== clientId ||
    !sameFinancialMoney(debit.balanceDelta, -effect.amount) ||
    !sameFinancialMoney(debit.amount, effect.amount) ||
    Number(sale.creditPaidAmount || 0) > 0 || sale.creditSettled === true ||
    !client || financialVersionOf(client) !== Number(sale.financialVersionAnterior || 0) + 1 ||
    !sameFinancialMoney(client.saldo, sale.saldoAtual) ||
    !sameFinancialMoney(Number(clientWrite?.data?.saldo) - Number(clientWrite?.before?.saldo), effect.amount)) fail();
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
  const previous = readQueueStrict();
  for (const item of previous) {
    if (!queueQuarantineReason(item)) continue;
    const next = queue.find(entry => entry.queueId === item.queueId &&
      entry.operationId === item.operationId);
    if (!next || JSON.stringify(next) !== JSON.stringify(item))
      throw Object.assign(Error("A operação em quarentena foi preservada sem alterações."),
        {code:"queue-quarantined-immutable"});
  }
  localStorage.setItem(queueKey(), JSON.stringify(queue));
  updateQueueState();
};
const queueCounts = () => {
  try {
  const queue = readQueueStrict();
  const quarantined = queue.filter(item => queueQuarantineReason(item) && !readQueueArchive(item) && !readRecoveryResolution(item)).length,
    archived = queue.filter(item => readQueueArchive(item) || readRecoveryResolution(item)).length;
  return {
    pending: queue.filter((item) => item.status !== "error" && !queueManualReviewReason(item)).length,
    errors: queue.filter((item) => item.status === "error" && !queueManualReviewReason(item)).length,
    manualReview: queue.filter((item) => queueManualReviewReason(item) && !readQueueArchive(item) && !readRecoveryResolution(item)).length,
    quarantined, archived, active: queue.length - quarantined - archived,
    total: queue.length,
  };
  } catch {
    return {pending:0,errors:1,total:1,active:1,quarantined:0,archived:0,manualReview:0,corrupt:true};
  }
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
  if (review && review.operationId === String(sale.operationId || "") &&
    review.checksum === checksumValue(sale) &&
    ["historical_reconciled", "resolved_by_reconciliation"].includes(review.decision))
    return true;
  const resolutionId = legacyReconciliationOperationId(sale?.id),
    resolution = (DB.carregar().movimentacoes || []).find((item) =>
      String(item.id) === resolutionId &&
      item.resolutionStatus === "resolved_by_reconciliation" &&
      String(item.resolvedSaleId || "") === String(sale?.id || "") &&
      String(item.resolvedOperationId || "") === String(sale?.operationId || ""));
  return Boolean(resolution);
}
function diagnosticOperationEvidence(entity, item) {
  const audit=state.dataAudit;
  if(!audit||audit.businessId!==activeBusinessId()||item.businessId&&item.businessId!==activeBusinessId())return 'not_verified';
  return window.IntegrityAudit?.operationEvidence?.(item,audit.collections?.[entity],checksumValue(item))||'not_verified';
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
    candidates = sales.filter((sale) => Number(sale.syncPipelineVersion || 0) >= 2 &&
      !sale.deletedAt && sale.active !== false && !sale.syncConfirmedAt &&
      !sale.financialAppliedAt && !queued.has(String(sale.id))),
    confirmedRemotely = candidates.filter(sale=>['remote_confirmed','remote_present_difference'].includes(diagnosticOperationEvidence('sales',sale)))
      .map(sale=>({saleId:String(sale.id),operationId:String(sale.operationId||''),spaceId:sale.spaceId||null,origin:sale.source||'unknown',category:diagnosticOperationEvidence('sales',sale)==='remote_confirmed'?'synchronized_without_local_marker':'remote_present_difference'})),
    verificationPending = candidates.filter(sale=>diagnosticOperationEvidence('sales',sale)==='not_verified')
      .map(sale=>({saleId:String(sale.id),operationId:String(sale.operationId||''),category:'remote_presence_not_verified'})),
    localWithoutQueue = candidates.filter(sale=>diagnosticOperationEvidence('sales',sale)==='local_only')
      .map((sale) => ({ saleId: String(sale.id), operationId: String(sale.operationId || "") })),
    queueWithoutLocal = queue.flatMap((item) => (item.payload?.writes || [])
      .filter((write) => write.entityType === "sales" && write.operation === "create" &&
        !byId.has(String(write.entityId)))
      .map((write) => ({ saleId: String(write.entityId), operationId: String(item.operationId),
        status: item.status }))),
    onlyLocalAfterComparison = (state.dataAudit?.collections?.sales?.onlyLocal || [])
      .filter((item) => item.classification === "B" &&
        !queued.has(String(item.documentId))&&byId.has(String(item.documentId))&&diagnosticOperationEvidence('sales',byId.get(String(item.documentId)))==='local_only')
      .map((item) => ({ saleId: String(item.documentId), operationId: String(item.operationId || "") })),
    overdue = queue.filter((item) => item.payload?.eventKind === "sale" &&
      Date.now() - (Date.parse(item.createdAtLocal || item.createdAt || "") || Date.now()) > 15 * 60 * 1000)
      .map((item) => ({ operationId: String(item.operationId), status: item.status }));
  return { count: new Set([...localWithoutQueue, ...queueWithoutLocal,
    ...onlyLocalAfterComparison].map((item) => item.saleId)).size,
    localWithoutQueue, queueWithoutLocal, onlyLocalAfterComparison, overdue,confirmedRemotely,verificationPending,
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
    candidates = payments.filter((payment) => Number(payment.syncPipelineVersion || 0) >= 2 &&
      !payment.syncConfirmedAt && payment.applicationStatus !== "applied" &&
      !queued.has(String(payment.id))),
    confirmedRemotely = candidates.filter(payment=>['remote_confirmed','remote_present_difference'].includes(diagnosticOperationEvidence('payments',payment)))
      .map(payment=>({paymentId:String(payment.id),operationId:String(payment.operationId||''),category:diagnosticOperationEvidence('payments',payment)==='remote_confirmed'?'synchronized_without_local_marker':'remote_present_difference'})),
    verificationPending = candidates.filter(payment=>diagnosticOperationEvidence('payments',payment)==='not_verified')
      .map(payment=>({paymentId:String(payment.id),operationId:String(payment.operationId||''),category:'remote_presence_not_verified'})),
    localWithoutQueue = candidates.filter(payment=>diagnosticOperationEvidence('payments',payment)==='local_only')
      .map((payment) => ({ paymentId: String(payment.id), operationId: String(payment.operationId || "") })),
    queueWithoutLocal = queue.flatMap((item) => (item.payload?.writes || [])
      .filter((write) => write.entityType === "payments" && write.operation === "create" &&
        !byId.has(String(write.entityId)))
      .map((write) => ({ paymentId: String(write.entityId), operationId: String(item.operationId),
        status: item.status }))),
    onlyLocalAfterComparison = (state.dataAudit?.collections?.payments?.onlyLocal || [])
      .filter((item) => item.classification === "B" &&
        !queued.has(String(item.documentId))&&payments.some(payment=>String(payment.id)===String(item.documentId)&&diagnosticOperationEvidence('payments',payment)==='local_only'))
      .map((item) => ({ paymentId: String(item.documentId), operationId: String(item.operationId || "") })),
    overdue = queue.filter((item) => item.payload?.eventKind === "payment" &&
      Date.now() - (Date.parse(item.createdAtLocal || item.createdAt || "") || Date.now()) > 15 * 60 * 1000)
      .map((item) => ({ operationId: String(item.operationId), status: item.status }));
  return { count: new Set([...localWithoutQueue, ...queueWithoutLocal,
    ...onlyLocalAfterComparison].map((item) => item.paymentId)).size,
    localWithoutQueue, queueWithoutLocal, onlyLocalAfterComparison, overdue,confirmedRemotely,verificationPending };
}
const queueErrorBreakdown = () => {
  const errors = readQueue().filter((item) => item.status === "error" && !queueQuarantineReason(item));
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
      queueSettingsDiagnostic(item)?.path || item.lastErrorPath ||
      (item.businessId && item.entityType && item.entityId
        ? `businesses/${item.businessId}/${item.entityType}/${item.entityId}`
        : "indefinido"),
    createdAt: item.createdAtLocal || item.createdAt || "",
    lastAttemptAt: item.lastAttemptAt || "",
    retryCount: Number(item.retryCount || item.attempts || 0),
    errorCode: item.lastErrorCode || "",
    errorMessage: item.lastErrorMessage || "",
    diagnostic: queueSettingsDiagnostic(item),
    originalErrorPath: item.lastErrorPath || null,
    reviewRequired: Boolean(queueManualReviewReason(item)) && !readQueueArchive(item) && !readRecoveryResolution(item),
    resolution: readRecoveryResolution(item),
    reviewState: readRecoveryResolution(item) ? "resolved" : readQueueArchive(item) ? "archived" : queueQuarantineReason(item) ? "quarantined" : (saleQueueRequiresReview(item) ? "manual_review" : null),
    reviewReason: queueQuarantineReason(item) || null,
    canArchive: !['settings_permission_required','sync_protocol_upgrade_review','customer_permission_required'].includes(queueQuarantineReason(item)),
    archive: readQueueArchive(item),
    payloadChecksum: checksumValue(item.payload || {}),
    payloadVersion: Number(item.payloadVersion || 1),
    schemaVersion: Number(item.schemaVersion || 1),
    deviceId: item.deviceId ? `${String(item.deviceId).slice(0, 6)}…` : "legado",
    origin: item.origin || item.source || "legado",
    status: readRecoveryResolution(item) ? "resolved" : readQueueArchive(item) ? "archived" : queueQuarantineReason(item) ? "quarantined" : item.status || "pending",
    originalStatus: item.status || "pending",
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
const canAttempt = (item, force = false, manualRetry = false) =>
  !queueManualReviewReason(item) &&
  !(item.payload?.writes?.length===1 && item.payload.writes[0].entityType==='clients' &&
    ['create','update'].includes(item.payload.writes[0].operation) && window.TeamAccess?.has?.(item.payload.writes[0].operation==='create'?'customers.create':window.VeconiPermissionPolicy?.customerPermission(item.payload.writes[0])||'customers.edit')===false) &&
  !(Array.isArray(item.payload?.writes) && item.payload.writes.some(write => write.entityType === "settings") &&
    !canWriteSharedSettings()) &&
  (manualRetry || item.status !== "error") &&
  (force || !item.lastAttemptAt ||
    Date.now() - new Date(item.lastAttemptAt).getTime() >=
      retryDelay(item.attempts || 0, item.lastErrorCode));
function saleQueueRequiresReview(item) {
  // Previously denied sales may have been re-entered by another operator.
  // A permission fix must not silently replay their commercial effects. This
  // is derived from the durable error, not a version/cutoff or customer ID.
  return ["permission-denied", "sale-recovery-review-required"].includes(item.lastErrorCode) &&
    (item.payload?.writes || []).some((write) =>
      write.entityType === "sales" && write.operation === "create");
}
// Quarantine is separate metadata. The queued packet, including its error,
// payload and original IDs, is evidence and must never be rewritten to hold it.
function queueReviewKey(item) {
  return `${queueKey()}:manualReview:${encodeURIComponent(String(item.queueId || item.operationId || "missing"))}`;
}
function queueArchiveKey(item) {
  return `${queueKey()}:incidentArchive:${encodeURIComponent(String(item.operationId || "missing"))}`;
}
function recoveryResolutionKey(item){return `${queueKey()}:recoveryResolution:${encodeURIComponent(item.operationId||'missing')}`;}
function readRecoveryResolution(item){
  let value;try{value=JSON.parse(localStorage.getItem(recoveryResolutionKey(item))||'null');}catch{return null;}
  if(!value||!Array.isArray(item.payload?.writes))return null;
  if(value.channel==='client_dependency'){
    const writes=item.payload.writes;
    return value.status==='client_confirmed'&&writes.length===1&&writes[0].entityType==='clients'&&writes[0].operation==='create'&&writes[0].entityId===value.clientId&&value.operationId===item.operationId&&value.businessId===item.businessId&&value.actorUid===item.userId&&value.workspaceGeneration===(item.workspaceGeneration??0)&&value.payloadChecksum===checksumValue(item.payload)&&/^[a-f0-9]{64}$/.test(value.payloadHash||'')&&/^[a-f0-9]{64}$/.test(value.contentHash||'')&&value.resolvedAt&&value.resolvedByUid?value:null;
  }
  const sale=item.payload.writes.filter(w=>w.entityType==='sales'&&w.operation==='create');
  if(item.lastErrorCode==='invalid-argument'&&item.lastErrorMessage==='Total não corresponde aos itens.'&&
    (value.channel!=='monetary_recovery'||value.kind!=='monetary_recovery_v1'||value.commercialReceiptConfirmed!==true||value.monetaryPolicy!=='unit4-total-cent-v1'||sale.length!==1||value.totalCents!==Math.round(Number(sale[0].data.valorFinal??sale[0].data.valorTotal)*100)||value.originalTotalCents!==value.totalCents))return null;
  if(value.channel==='financial_maintenance')return value.status==='resolved'&&/^[a-f0-9]{64}$/.test(value.auditHash||'')&&value.resolvedAt&&value.resolvedByUid&&value.operationId===item.operationId&&value.businessId===item.businessId&&value.actorUid===item.userId&&value.workspaceGeneration===(item.workspaceGeneration??0)&&value.payloadChecksum===checksumValue(item.payload||{})&&sale.length===1&&value.saleId===sale[0].entityId&&value.spaceId===sale[0].data?.spaceId?value:null;
  return ['already_recreated','recovered','closed_without_effects'].includes(value.status)&&value.resolvedAt&&value.resolvedByUid&&/^[a-f0-9]{64}$/.test(value.contentHash||'')&&/^[a-f0-9]{64}$/.test(value.payloadHash||'')&&sale.length===1&&value.operationId===item.operationId&&value.saleId===sale[0].entityId&&value.spaceId===sale[0].data?.spaceId&&value.businessId===item.businessId&&value.actorUid===item.userId&&value.workspaceGeneration===(item.workspaceGeneration??0)&&value.payloadChecksum===checksumValue(item.payload||{})?value:null;
}
async function refreshRecoveryResolutions(isCurrent){
  if(typeof window.FirebaseCallable!=='function'||!window.SaleRecoveryClient)return;
  const clientDependency=i=>i.lastErrorCode==='permission-denied'&&i.payload?.writes?.length===1&&i.payload.writes[0].entityType==='clients'&&i.payload.writes[0].operation==='create';
  const monetary=i=>i.lastErrorCode==='invalid-argument'&&i.lastErrorMessage==='Total não corresponde aos itens.'&&(i.payload?.writes||[]).some(w=>w.entityType==='sales'&&w.operation==='create');
  const held=readQueue().filter(i=>(saleQueueRequiresReview(i)||clientDependency(i)||monetary(i))&&!readRecoveryResolution(i)&&i.userId===currentUser?.uid&&i.businessId===activeBusinessId());
  for(let offset=0;offset<held.length;offset+=20){
    const batch=held.slice(offset,offset+20),key=queueKey();
    try{
      const checks=await Promise.all(batch.map(async item=>{
        const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(window.SaleRecoveryClient.canonical(item.payload)));
        const payloadHash=Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');
        return clientDependency(item)?{kind:'client_dependency',operationId:item.operationId,clientId:item.payload.writes[0].entityId,payloadHash}:{...(monetary(item)?{kind:'monetary_analysis_v1'}:{}),operationId:item.operationId,saleId:item.payload.writes.find(w=>w.entityType==='sales'&&w.operation==='create').entityId,payloadHash};
      }));
      if(!isCurrent())return;
      const response=await window.FirebaseCallable('listSaleRecoveryReviews',{businessId:activeBusinessId(),workspaceGeneration:window.DB?.getWorkspaceGeneration?.()??0,resolutionChecks:checks});
      if(!isCurrent()||key!==queueKey())return;
      const result=response.data??response;
      for(const item of batch){
        const check=checks.find(c=>c.operationId===item.operationId),r=result.items?.find(r=>r.operationId===item.operationId);
        if(clientDependency(item)){
          if(!r||r.kind!=='client_dependency'||r.status!=='client_confirmed'||r.clientId!==check.clientId||r.payloadHash!==check.payloadHash||r.businessId!==item.businessId||r.actorUid!==item.userId||r.workspaceGeneration!==(item.workspaceGeneration??0)||!r.resolvedAt||!r.resolvedByUid||!/^[a-f0-9]{64}$/.test(r.contentHash||''))continue;
          const live=readQueue().find(q=>q.operationId===item.operationId);if(!live||checksumValue(live.payload)!==checksumValue(item.payload))continue;
          localStorage.setItem(recoveryResolutionKey(item),JSON.stringify({...r,channel:'client_dependency',payloadChecksum:checksumValue(item.payload),verifiedAt:now()}));continue;
        }
        const sale=item.payload.writes.find(w=>w.entityType==='sales'&&w.operation==='create');
        if(monetary(item)&&(!r||r.kind!=='monetary_recovery_v1'||r.commercialReceiptConfirmed!==true||r.monetaryPolicy!=='unit4-total-cent-v1'||r.totalCents!==Math.round(Number(sale.data.valorFinal??sale.data.valorTotal)*100)||r.originalTotalCents!==r.totalCents))continue;
        if(!r||!['already_recreated','recovered','closed_without_effects'].includes(r.status)||r.payloadHash!==check.payloadHash||r.saleId!==check.saleId||r.businessId!==item.businessId||r.actorUid!==item.userId||r.spaceId!==sale.data.spaceId||r.workspaceGeneration!==(item.workspaceGeneration??0)||!r.resolvedAt||!r.resolvedByUid||!/^[a-f0-9]{64}$/.test(r.contentHash||''))continue;
        const live=readQueue().find(q=>q.operationId===item.operationId);
        if(!live||checksumValue(live.payload)!==checksumValue(item.payload))continue;
        localStorage.setItem(recoveryResolutionKey(item),JSON.stringify({...r,...(monetary(item)?{channel:'monetary_recovery'}:{}),payloadChecksum:checksumValue(item.payload),verifiedAt:now()}));
      }
    }catch{/* Failed verification never authorizes replay or changes the original packet. */}
  }
}
function readQueueArchive(item) {
  const raw = localStorage.getItem(queueArchiveKey(item));
  if (!raw) return null;
  let value;try { value = JSON.parse(raw); } catch { /* fail closed */ }
  if (!value || value.status !== "archived" || value.operationId !== item.operationId ||
      value.businessId !== item.businessId || value.actorUid !== item.userId ||
      value.payloadChecksum !== checksumValue(item.payload || {}) || value.commercialEffectsApplied !== false)
    throw Object.assign(Error("O recibo do arquivamento precisa de revisão. Nenhum envio foi permitido."),
      {code:"queue-archive-evidence-invalid"});
  return value;
}
function preservedQueueMessage(counts = queueCounts()) {
  if (counts.active || counts.corrupt) return "";
  if (Number(window.AdiFestaBuild?.release)>=202 && readQueue().some(item=>queueQuarantineReason(item)==='sync_protocol_upgrade_review'))
    return 'Operações de versão anterior preservadas para revisão. Nenhuma será reenviada automaticamente. Não refaça vendas; solicite análise da fila.';
  if (counts.quarantined) return `${counts.quarantined} ocorrência${counts.quarantined === 1 ? " preservada" : "s preservadas"} para análise. Nenhuma sincronização pendente.`;
  if (counts.archived) return `Nenhuma sincronização pendente. ${counts.archived} ocorrência${counts.archived === 1 ? " resolvida preservada" : "s resolvidas preservadas"} para auditoria.`;
  return "";
}
function readQueueReview(item) {
  const raw = localStorage.getItem(queueReviewKey(item));
  if (!raw) return null;
  let value;
  try { value = JSON.parse(raw); } catch { /* fail closed */ }
  if (!value || value.status !== "quarantined" ||
      value.operationId !== String(item.operationId || "") ||
      value.businessId !== String(item.businessId || "") ||
      value.userId !== String(item.userId || ""))
    throw Object.assign(Error("A evidência da quarentena precisa de revisão."),
      {code:"queue-quarantine-evidence-invalid"});
  return value;
}
function isHistoricalProjectionBatch(item) {
  if (!["simple", "legacy"].includes(item.payload?.eventKind || "simple")) return false;
  const writes = item.payload?.writes;
  if (!Array.isArray(writes) || !writes.length || !writes.some(w=>w.entityType === "sales")) return false;
  const metadata = new Set(["operationId","idempotencyKey","businessId","entityType","action","createdAt","schemaVersion"]);
  const privateFields = {products:["custo","cost"],productVariants:["cost","custo"],sales:["custoTotal","lucro"]};
  let privateChanges = false;
  const onlyProjection = writes.every(write => {
    const fields = privateFields[write.entityType];
    if (!fields || write.operation !== "update" || !write.data || typeof write.data !== "object") return false;
    const keys = Object.keys(write.data);
    if (keys.some(key=>fields.includes(key))) privateChanges = true;
    return keys.every(key=>fields.includes(key) || metadata.has(key));
  });
  return onlyProjection && privateChanges;
}
function settingsQueueRequiresPermission(item) {
  // A permission hold is not a judgement about the original config fields.
  // Only this principal's standalone configuration packet is classified here;
  // commercial/mixed packets and unknown sessions retain their existing flow.
  const writes = item.payload?.writes;
  const context = window.BusinessContext?.get?.();
  return typeof window.TeamAccess?.has === "function" && Boolean(currentUser?.uid) &&
    currentUser?.uid === auth.currentUser?.uid && item.userId === currentUser?.uid &&
    item.businessId === activeBusinessId() && state.userProfile?.businessId === item.businessId &&
    context?.loading === false && !context.error &&
    ["owner", "platform_admin", "manager", "seller", "stock"].includes(context.role) &&
    context.businessId === item.businessId && context.userProfile?.uid === currentUser.uid &&
    context.userProfile?.businessId === item.businessId &&
    context.userProfile?.active !== false && Array.isArray(context.permissions) &&
    (!context.member?.status || context.member.status === "active") &&
    (item.workspaceGeneration ?? 0) === (window.DB?.getWorkspaceGeneration?.() ?? 0) &&
    ["simple", "legacy"].includes(item.payload?.eventKind || "simple") &&
    Array.isArray(writes) && writes.length > 0 && writes.every(write =>
      write.entityType === "settings" && write.entityId === "default" &&
      ["create", "update"].includes(write.operation)) && window.TeamAccess.has("settings.manage") === false;
}
function queueSettingsDiagnostic(item) {
  const held = readQueueReview(item)?.reason === "settings_permission_required" ||
    settingsQueueRequiresPermission(item);
  if (!held) return null;
  return {stage:"settings_permission_preflight",collection:"settings",
    path:`businesses/${item.businessId}/settings/default`,requiredPermission:"settings.manage",
    code:"settings-permission-required",replayBlocked:true,
    originalErrorPath:item.lastErrorPath || null,
    message:"Configuração preservada. Este perfil não pode enviá-la; sincronizar novamente não libera essa permissão."};
}
function retireSettingsPermissionFailure(item) {
  // Only retire an active error explicitly attributed to this preserved packet.
  // Listener, network, mixed/commercial errors and all historical evidence stay.
  const failure = state.syncFailure;
  if (queueQuarantineReason(item) !== "settings_permission_required" ||
      failure?.operationId !== item.operationId || failure.businessId !== item.businessId ||
      failure.actorUid !== item.userId || failure.code !== "permission-denied") return;
  state.syncFailure = null;
}
function queueQuarantineReason(item) {
  if(readRecoveryResolution(item))return 'recovery_resolved';
  if (readQueueArchive(item)) return "archived";
  const review = readQueueReview(item);
  if (review) return review.reason || "quarantined";
  if (item.lastErrorCode === "queue-operation-archived") return "remote_archive_fence";
  if (["quarantined","manual_review","archived"].includes(item.status) ||
      ["quarantined","manual_review","archived"].includes(item.reviewStatus) ||
      item.quarantined === true || item.reviewRequired === true)
    return "explicit_manual_review";
  if (isHistoricalProjectionBatch(item)) return "historical_projection_without_user_action";
  if (settingsQueueRequiresPermission(item)) return "settings_permission_required";
  if(item.lastErrorCode==='permission-denied'&&item.payload?.writes?.length===1&&item.payload.writes[0].entityType==='clients'&&item.payload.writes[0].operation==='create')
    return 'customer_permission_required';
  if (Number(window.AdiFestaBuild?.release)>=202 && item.syncProtocolVersion!==1)
    return 'sync_protocol_upgrade_review';
  return "";
}
function queueManualReviewReason(item) {
  return queueQuarantineReason(item) || (saleQueueRequiresReview(item) ? "sale_recovery_review_required" : "");
}
function preserveQueueQuarantine(item) {
  if(readRecoveryResolution(item))return false;
  const reason = queueQuarantineReason(item);
  if (!reason) return false;
  const existing = readQueueReview(item);
  if (existing) {
    if (existing.originalPacketJson !== JSON.stringify(item))
      throw Object.assign(Error("A operação difere da evidência preservada. Nenhum envio foi permitido."),
        {code:"queue-quarantine-evidence-conflict"});
    return true;
  }
  localStorage.setItem(queueReviewKey(item), JSON.stringify({
    version:1,status:"quarantined",reason,recordedAt:now(),
    operationId:String(item.operationId || ""),queueId:String(item.queueId || ""),
    businessId:String(item.businessId || ""),userId:String(item.userId || ""),
    payloadChecksum:checksumValue(item.payload || {}),originalPacketJson:JSON.stringify(item),
  }));
  return true;
}
const incidentArchiveTasks = new Map();
async function archiveQuarantinedOperation(operationId) {
  if (incidentArchiveTasks.has(operationId)) return incidentArchiveTasks.get(operationId);
  const task = (async () => {
    await validateUser();
    const generation = syncSessionGeneration, uid = currentUser?.uid, businessId = activeBusinessId(), key = queueKey();
    const assertOrigin = () => {
      if (generation !== syncSessionGeneration || currentUser?.uid !== uid || activeBusinessId() !== businessId || queueKey() !== key)
        throw Object.assign(Error("A sessão mudou. A evidência foi preservada; abra novamente o diagnóstico na conta de origem."), {code:"sync-session-obsolete"});
    };
    const item = readQueueStrict().find(entry => entry.operationId === operationId);
    if (!item || item.userId !== uid || item.businessId !== businessId || !queueQuarantineReason(item))
      throw Error("Somente uma ocorrência em quarentena da conta atual pode ser arquivada.");
    if (['settings_permission_required','sync_protocol_upgrade_review','customer_permission_required'].includes(queueQuarantineReason(item)))
      throw Error("Esta operação está preservada para análise de autorização ou versão. Não será arquivada nem reenviada por esta ação.");
    preserveQueueQuarantine(item);
    const evidence = readQueueReview(item), originalPacketJson = evidence.originalPacketJson;
    if (JSON.stringify(item) !== originalPacketJson) throw Error("O pacote difere da evidência original. O arquivamento foi interrompido.");
    await DB.flush?.();assertOrigin();
    const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(originalPacketJson));assertOrigin();
    const contentHash = Array.from(new Uint8Array(hash),byte=>byte.toString(16).padStart(2,"0")).join("");
    const response = await window.FirebaseCallable("archiveSyncIncident", {
      businessId,workspaceGeneration:DB.getWorkspaceGeneration(),originalPacketJson,contentHash,
      payloadChecksum:evidence.payloadChecksum,
    });assertOrigin();
    const receipt = response.data ?? response;
    if (receipt.status !== "archived" || receipt.operationId !== operationId || receipt.businessId !== businessId ||
        receipt.actorUid !== uid || receipt.contentHash !== contentHash || receipt.payloadChecksum !== evidence.payloadChecksum ||
        receipt.commercialEffectsApplied !== false || !receipt.archivedBy || !receipt.archivedAt)
      throw Error("O encerramento não foi confirmado. O original continua preservado e sem reenvio.");
    if (JSON.stringify(readQueueStrict().find(entry=>entry.operationId === operationId)) !== originalPacketJson)
      throw Error("A fila mudou. A evidência remota foi preservada; revise antes de continuar.");
    // Append a separate receipt. Neither the original queue nor its quarantine
    // evidence is rewritten/deleted, even after a lost response or account swap.
    localStorage.setItem(queueArchiveKey(item), JSON.stringify(receipt));
    await DB.flush?.();assertOrigin();updateQueueState();
    return receipt;
  })().finally(()=>incidentArchiveTasks.delete(operationId));
  incidentArchiveTasks.set(operationId,task);return task;
}
const queuePreflight = (item) => {
  if (queueQuarantineReason(item))
    return {ok:false,code:"queue-quarantined",message:"Operação em quarentena. O registro original foi preservado para revisão, sem envio."};
  const businessId = activeBusinessId(),
    writes = Array.isArray(item.payload?.writes) ? item.payload.writes : [];
  const generation=window.DB.getWorkspaceGeneration();
  if((item.workspaceGeneration??0)!==generation||writes.some(write=>
    write.data?.workspaceGeneration!==undefined&&write.data.workspaceGeneration!==generation))
    return{ok:false,code:'workspace-generation-mismatch',message:'Operação de um ambiente anterior bloqueada. Ela não será reenviada após a restauração.'};
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
  if (saleQueueRequiresReview(item))
    return { ok: false, code: "sale-recovery-review-required",
      message: "Venda preservada neste aparelho, aguardando revisão. O reenvio automático foi bloqueado para evitar efeitos duplicados." };
  if (!writes.length)
    return { ok: false, code: "empty-transaction", message: "A operação não possui gravações." };
  if(writes.some(write=>{
    const existing=window.DB?.carregar?.()?.[SOURCES[write.entityType]?.key]?.find(record=>String(record.id)===String(write.entityId));
    return window.IntegrityAudit?.legacyFixtureIdentity(write.entityType,{...existing,...write.data,id:write.entityId},businessId);
  }))return{ok:false,code:'legacy-fixture-upload-blocked',message:'Registro de demonstração legado: envio bloqueado. Revise somente o armazenamento local.'};
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
const canonicalClientSnapshotKey = (businessId, clientId) =>
  `${currentUser?.uid || "anonymous"}:${businessId}:${String(clientId || "")}`;
// Presence evidence is session/tenant/generation scoped metadata, never a commercial patch.
const customerPresenceCache=new Map();
const customerPresenceKey = id => `customerPresence:v205:${encodeURIComponent(currentUser?.uid||'')}:${encodeURIComponent(activeBusinessId())}:${DB.getWorkspaceGeneration?.()??0}:${encodeURIComponent(id)}`;
function rememberCustomerPresence(client) {
  if (!client?.id || client.deletedAt || client.active === false || client.ativo === false) return;
  const key=customerPresenceKey(client.id),value={uid:currentUser?.uid,businessId:activeBusinessId(),workspaceGeneration:DB.getWorkspaceGeneration?.()??0,clientId:String(client.id),readAt:now(),source:'server'};
  customerPresenceCache.set(key,value);try{localStorage.setItem(key,JSON.stringify(value));}catch{/* Presence may remain in this session; no business write is lost. */}
}
function assertCustomerForSale(clientId) {
  const id=String(clientId||''),client=(DB.carregar().clientes||[]).find(c=>String(c.id)===id);
  if (!id) return;
  if (!currentUser || !client || client.deletedAt || client.active===false || client.ativo===false || client.businessId&&client.businessId!==activeBusinessId())
    throw Object.assign(Error('Cliente indisponível nesta empresa. Nenhuma venda foi registrada.'),{code:'customer-unconfirmed'});
  const creation=readQueue().find(p=>!readRecoveryResolution(p)&&(p.payload?.writes||[]).some(w=>w.entityType==='clients'&&w.operation==='create'&&String(w.entityId)===id));
  // Preserve the legitimate ordered offline flow for a NEW authorized draft.
  // Previously denied/held or pre-protocol packets never qualify, even after a grant changes.
  if(creation&&window.TeamAccess?.has?.('customers.create')===true&&creation.userId===currentUser.uid&&creation.businessId===activeBusinessId()&&(creation.workspaceGeneration??0)===(DB.getWorkspaceGeneration?.()??0)&&creation.syncProtocolVersion===1&&creation.status==='pending'&&!creation.lastErrorCode&&!queueManualReviewReason(creation))return;
  if(creation)throw Object.assign(Error(window.TeamAccess?.has?.('customers.create')===true
    ? 'O cadastro deste cliente ainda aguarda confirmação na nuvem. Aguarde; o carrinho foi preservado.'
    : 'Este cliente existe apenas no aparelho e seu perfil não pode cadastrá-lo. Peça ao responsável para analisar o registro. Não refaça a venda.'),{code:'customer-dependency-blocked',customerId:id});
  if(readQueue().some(p=>saleQueueRequiresReview(p)&&!readRecoveryResolution(p)&&(p.payload?.writes||[]).some(w=>w.entityType==='sales'&&String(w.data?.clienteId||'')===id)))
    throw Object.assign(Error('Há uma venda deste cliente aguardando revisão. Aguarde a decisão do responsável; nenhuma nova venda foi registrada.'),{code:'customer-dependency-blocked',customerId:id});
  let proof=customerPresenceCache.get(customerPresenceKey(id));try{proof ||= JSON.parse(localStorage.getItem(customerPresenceKey(id))||'null');}catch{}
  if(!proof||proof.source!=='server'||proof.uid!==currentUser.uid||proof.businessId!==activeBusinessId()||proof.workspaceGeneration!==(DB.getWorkspaceGeneration?.()??0)||proof.clientId!==id)
    throw Object.assign(Error('Este cliente ainda não foi confirmado na nuvem nesta conta. Conecte-se e confira o cliente antes de vender. O carrinho foi preservado.'),{code:'customer-unconfirmed',customerId:id});
}
async function prepareSaleCustomer(clientId,options={}) {
  if(!clientId)return {source:'guest'};
  const id=String(clientId),scope=captureCloudReadScope(),spaceId=options.spaceId||window.SpaceContext?.salesId?.();
  if(!currentUser||!canPullSource('clients'))throw Error('A consulta deste cliente não está autorizada.');
  const newDraft=readQueue().find(p=>(p.payload?.writes||[]).some(w=>w.entityType==='clients'&&w.operation==='create'&&String(w.entityId)===id));
  if(newDraft&&window.TeamAccess?.has?.('customers.create')===true){assertCustomerForSale(id);return{source:'authorized-ordered-local-dependency',clientId:id};}
  if(navigator.onLine===false){assertCustomerForSale(id);return{source:'confirmed-local-presence'};}
  // Read only. In particular, do NOT flush or retry any old customer or sale operation here.
  const snapshot=await getDocFromServer(doc(db,'businesses',activeBusinessId(),'clients',id));
  assertCloudReadScope(scope);
  if(spaceId&&window.SpaceContext?.salesId&&window.SpaceContext.salesId()!==spaceId)throw Error('O espaço mudou. Revise o cliente na conta atual.');
  if(!snapshot.exists()||snapshot.metadata?.fromCache||snapshot.metadata?.hasPendingWrites)
    throw Object.assign(Error('Cliente não confirmado na nuvem. Peça ao responsável para analisar o cadastro; nenhuma venda foi registrada.'),{code:'customer-unconfirmed',customerId:id});
  const remote=snapshot.data();
  if(remote.businessId&&remote.businessId!==activeBusinessId()||remote.workspaceGeneration!==undefined&&remote.workspaceGeneration!==(DB.getWorkspaceGeneration?.()??0)||remote.deletedAt||remote.active===false||remote.ativo===false)
    throw Object.assign(Error('Cliente indisponível nesta empresa. Nenhuma venda foi registrada.'),{code:'customer-unconfirmed'});
  rememberCustomerPresence({...remote,id});assertCustomerForSale(id);return{source:'server',clientId:id};
}
function rememberCanonicalClients(documents, metadata = {}) {
  if (metadata.fromCache || metadata.hasPendingWrites || metadata.source !== "server") return;
  const businessId = activeBusinessId(),
    readAt = metadata.readAt || now();
  for (const client of documents || []) {
    rememberCustomerPresence(client);
    const clientId = String(client?.id || "").trim(),
      balance = Number(client?.saldo);
    if (!clientId || !Number.isFinite(balance) || client.deletedAt) continue;
    canonicalClientSnapshots.set(canonicalClientSnapshotKey(businessId, clientId), {
      businessId,
      clientId,
      balance: roundedMoney(balance),
      financialVersion: Math.max(0, Number(client.financialVersion || 0)),
      updatedAt: client.updatedAt || client.atualizadoEm || "",
      readAt,
      source: metadata.source,
    });
  }
}
function recentCanonicalClientSnapshot(businessId, clientId, localClient) {
  const snapshot = canonicalClientSnapshots.get(
    canonicalClientSnapshotKey(businessId, clientId),
  );
  if (!snapshot || Date.now() - new Date(snapshot.readAt).getTime() > CANONICAL_CLIENT_TTL_MS)
    return null;
  if (
    !Number.isFinite(Number(localClient?.saldo)) ||
    !sameFinancialMoney(localClient.saldo, snapshot.balance) ||
    financialVersionOf(localClient) !== snapshot.financialVersion
  )
    return null;
  return snapshot;
}
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
    fiado: window.IntegrityAudit.balanceScope(data.clientes,[]).localActiveDebt,
  };
};
function cloudDebtSummary(clients) {
  const scope=window.IntegrityAudit.balanceScope([],clients);
  return {fiado:scope.remoteActiveDebt,historicalFiado:scope.remoteHistoricalDebt,fiadoIncludingHistory:scope.remoteTotalDebt};
}
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
function classifyCollectionAudit(name, localItems, remoteItems, queue, projection = {}) {
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
    historicalTombstones: [],
    representationOnly: [],
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
        category: window.IntegrityAudit.confirmedLegacyFixture(name,item,metadata.checksum,activeBusinessId()) ? "confirmed_legacy_fixture" : "local_only",
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
    const semantic = window.IntegrityAudit.compare(name,item,remote,{
      businessId: activeBusinessId(),
      normalizePhone: window.PhoneUtils?.normalizeBrazilianPhone,
      normalizeProductAccess: window.SpaceEngine?.normalizeProductAccess,
      localFinancial: projection.localFinancial?.get(String(item.id)),
      remoteFinancial: projection.remoteFinancial?.get(String(remote.id)),
    });
    if (semantic.equal)
      result.equal.push(metadata);
    else
      result.divergent.push({
        classification: "E",
        documentId: metadata.documentId,
        operationId: metadata.operationId || remoteMetadata.operationId,
        local: metadata,
        remote: remoteMetadata,
        hasPendingLocal: Boolean(queueMatch),
        fields: semantic.fields,
      });
    if(semantic.equal&&metadata.checksum!==remoteMetadata.checksum)result.representationOnly.push({documentId:metadata.documentId,category:'representation_only',fields:semantic.representationFields});
  }
  for (const [key, item] of remoteMap)
    if (!localMap.has(key))
      (item.deletedAt ? result.historicalTombstones : result.onlyRemote).push(auditRecord(item, "remote", name));
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
    operationalProtocol: state.operationalProtocol || {status:'not_verified'},
    remoteReadRefresh: state.remoteReadRefresh || {pending:0,status:'idle'},
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
    pendingOperations: q.active,
    preservedOccurrences: q.quarantined,
    archivedOccurrences: q.archived,
    pending: q.pending,
    syncErrors: q.errors,
    queueStorageCorrupt: Boolean(q.corrupt),
    orphanOperations: saleIntegrity.count + paymentIntegrity.count,
    saleIntegrity,
    paymentIntegrity,
    processingOperations: readQueue().filter((item) => item.status === "syncing" && !queueManualReviewReason(item))
      .length,
    lastAttemptAt: state.lastAttempt,
    lastCompleteSyncAt: state.lastCompleteSync,
    lastSyncAt: state.lastSync,
    lastSync: state.lastSync || "nunca",
    currentPath: currentPath || `businesses/${profile.businessId || "—"}`,
    hydrated: state.hydrated,
    listenerConnected: state.listenerConnected,
    schemaVersion: 3,
    deviceId: deviceId({diagnostic: true}),
    lastErrorCode,
    lastErrorMessage: lastError,
    syncFailure: state.syncFailure,
    syncFailureHistory: structuredClone(state.syncFailureHistory),
    sessionTrace: structuredClone(state.sessionTrace),
    syncTrace: state.syncTrace,
    integrityStatus: state.integrityStatus,
    integrityFailure: state.integrityFailure,
    localClients: local.clientes,
    cloudClients: state.cloudCounts.clients ?? "—",
    localProducts: local.produtos,
    cloudFiado: state.cloudFinancial.fiado ?? "—",
    cloudHistoricalFiado: state.cloudFinancial.historicalFiado ?? "—",
    cloudFiadoIncludingHistory: state.cloudFinancial.fiadoIncludingHistory ?? "—",
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
      queueTotal: counts.active,
      preservedOccurrences: counts.quarantined,
      archivedOccurrences: counts.archived,
      manualReviewPending: counts.manualReview-counts.quarantined,
      details: diagnostic(),
    };
  if(state.status==='success'&&state.remoteReadRefresh?.pending&&!counts.errors&&!state.syncFailure){
    snapshot.status=state.status='waiting';
    snapshot.message=state.message='Há dados da loja aguardando atualização de leitura. Nenhuma venda será reenviada por essa atualização.';
  }
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
  const salesDiagnostic=saleIntegrityDiagnostics(),paymentsDiagnostic=paymentIntegrityDiagnostics(),
    orphanCount = salesDiagnostic.count + paymentsDiagnostic.count;
  if (!navigator.onLine)
    emit({
      status: "offline",
      message: orphanCount
        ? `Offline — ${orphanCount} operação(ões) com pendência comprovada para revisão`
        : q.active
        ? `Offline — ${q.active} alteração(ões) pendente(s)`
        : "Offline — salvo no aparelho",
    });
  else if (orphanCount && state.status !== "syncing") {
    const message=`${orphanCount} operação(ões) com pendência comprovada na última análise. Veja os registros no diagnóstico.`;
    emit({ status: "error", message,queueDiagnosticWarning:{businessId:activeBusinessId(),message} });
  }
  else if (q.active && state.status !== "syncing")
    emit({
      status: q.errors ? "error" : "waiting",
      message: q.errors
        ? `Sincronização incompleta: ${q.errors} alteração(ões) com erro e ${q.pending} pendente(s).`
        : !q.pending&&q.manualReview ? `Revisão manual — confirmação pendente. ${q.manualReview} ocorrência(s) preservada(s), sem reenvio automático.`
        : `${q.pending} alteração(ões) aguardando sincronização`,
    });
  else if (preservedQueueMessage(q) && state.status !== "syncing" && !state.syncFailure &&
      state.testPassed && state.hydrated && state.listenerConnected && !state.dataAudit?.integrity?.actionable)
    emit({status:"success",message:preservedQueueMessage(q)});
  else if(state.status==='error'&&!state.syncFailure&&state.dataAudit?.businessId===activeBusinessId()&&
      state.queueDiagnosticWarning?.businessId===activeBusinessId()&&state.message===state.queueDiagnosticWarning.message){
    const unverified=(salesDiagnostic.verificationPending?.length||0)+(paymentsDiagnostic.verificationPending?.length||0),actionable=state.dataAudit.integrity?.actionable;
    emit({status:unverified||actionable?'waiting':'success',queueDiagnosticWarning:null,message:unverified?'Alguns registros precisam de uma nova comparação; ausência na nuvem ainda não comprovada.':actionable?'Comparação concluída. Há diferenças de conteúdo para revisão.':'Comparação concluída. Não há pendências somente locais comprovadas.'});
  }
}
function reportError(error, context = "Firebase", extra = {}) {
  lastError = friendlyError(error);
  lastErrorCode = error.syncDetail?.code || (error.name === "QuotaExceededError" ? "local-storage-quota" : errorCode(error)) || "unknown";
  state.syncFailure = error.syncDetail || {stage: context, code: lastErrorCode,
    message: String(error.message || "Falha sem mensagem").slice(0,600),
    collection: extra.collection || "", path: extra.path || currentPath || "", at: now()};
  if (extra.operationId) state.syncFailure = {...state.syncFailure,operationId:extra.operationId,
    businessId:state.userProfile?.businessId || "",actorUid:currentUser?.uid || ""};
  const failure = {...state.syncFailure, operation: extra.operation || state.syncFailure.request || "",
    businessId: state.userProfile?.businessId || "", authUid: auth.currentUser?.uid || "",
    actorUid: currentUser?.uid || "", subscriptionUid: extra.subscriptionUid || "",
    sessionGeneration: syncSessionGeneration, queue: queueCounts()};
  state.syncFailureHistory = [...(state.syncFailureHistory || []), failure].slice(-10);
  // A later successful pull must not erase the evidence needed to diagnose a
  // rejected listener. Log metadata as text: some clients collapse objects.
  console.error("[SYNC ERROR]", JSON.stringify(failure));
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
  if (name === "clients") {
    if (Object.hasOwn(clean,'nome')) clean.nomeNormalizado=normalizeText(clean.nome);
    if (Object.hasOwn(clean,'telefone')) clean.telefoneNormalizado=String(clean.telefone||'').replace(/\D/g,'');
  }
  if (name === "products") {
    if (Object.hasOwn(clean, 'nome')) clean.nomeNormalizado = normalizeText(clean.nome);
    if (Object.hasOwn(clean, 'semControleEstoque')) clean.controlaEstoque = !clean.semControleEstoque;
  }
  if (name === "productVariants") {
    // Partial stock patches must not overwrite presentation/index fields.
    if (Object.hasOwn(clean, 'displayName')) clean.displayNameNormalized = normalizeText(clean.displayName);
    if (['sku','barcode','attributeValues'].some(key => Object.hasOwn(clean, key)))
      clean.searchTokens = [
        clean.sku,
        clean.barcode,
        ...Object.values(clean.attributeValues || {}),
      ]
        .map(normalizeText)
        .filter(Boolean);
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
      // Operational reservation proof; Rules still validate ownership and amount.
      "onlineReservedStock",
      "onlineOrderFinalizationId",
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
    businessId = activeBusinessId(), actor = window.TeamAccess?.actor?.() || {},
    catalogPatch = !creating && ['products','productVariants'].includes(name);
  delete clean.version;
  if (catalogPatch) {
    delete clean.ownerId;
    delete clean.schemaVersion;
  }
  if (["sales", "payments", "balanceAdjustments", "stockMovements", "clients", "products", "productVariants", "settings"].includes(name)) {
    clean.updatedByUid = actor.actorUid || currentUser.uid;
    if (creating || ["sales", "payments", "balanceAdjustments", "stockMovements"].includes(name)) {
      clean.actorUid ||= actor.actorUid || currentUser.uid;
      clean.actorNameSnapshot ||= actor.actorNameSnapshot || null;
      clean.actorRoleSnapshot ||= actor.actorRoleSnapshot || null;
    }
  }
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
    // A stock-only update must not take ownership or migrate the catalog schema.
    ...(!catalogPatch ? {ownerId: currentUser.uid, schemaVersion: 3} : {}),
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
  // Leave an explicitly retained legacy source untouched for manual review.
  if (legacy.some(item => queueManualReviewReason(item))) return;
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
      if (queueManualReviewReason(item)) return item;
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
    if (preserveQueueQuarantine(item)) return item;
    if (saleQueueRequiresReview(item)) return item;
    // Permission resolution is not permission to enrich/rewrite a config packet.
    if (Array.isArray(item.payload?.writes) && item.payload.writes.some(write => write.entityType === "settings") &&
        !canWriteSharedSettings()) return item;
    // A permanent failure is evidence. Compatibility is not an authorized retry.
    if (item.status === "error") return item;
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
    } else if (copy.status === "syncing") {
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
  window.PermissionMutations?.assertWrites(writes, window.TeamAccess, window.VeconiPermissionPolicy);
  if (window.location || window.AdiFestaBuild) assertSyncProtocolBundle();
  if (writes.some(write => write.entityType === "settings") && !canWriteSharedSettings())
    throw Object.assign(Error("Este perfil não pode alterar configurações da empresa. Nenhuma configuração foi enfileirada."),
      {code:"settings-permission-required",syncDetail:{stage:"settings_permission_preflight",
        service:"Firestore",code:"settings-permission-required",collection:"settings",
        path:`businesses/${activeBusinessId()}/settings/default`,request:"queue_settings_write",
        message:"Configuração empresarial exige settings.manage."}});
  const workspaceOrigin=window.WorkspaceRuntime.capture();
  if(writes.some(write=>window.IntegrityAudit?.legacyFixtureIdentity(write.entityType,write.data,activeBusinessId())))
    throw Object.assign(Error('Registro de demonstração confirmado: envio à nuvem bloqueado.'),{code:'legacy-fixture-upload-blocked'});
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
      syncProtocolVersion: 1,
      clientRelease: 202,
      businessId,
      workspaceGeneration:workspaceOrigin.workspaceGeneration,
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
function migrateOwnerBusinessQueue() {
  if (window.BusinessContext?.get?.().role !== "owner" || localStorage.getItem(queueKey())) return;
  const oldKey = `adiFesta:${activeBusinessId()}:syncQueue`, raw = localStorage.getItem(oldKey);
  if (!raw) return;
  localStorage.setItem(`${queueKey()}:ownerMigrationBackup:${Date.now()}`, raw);
  localStorage.setItem(queueKey(), raw);
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
    if (queueManualReviewReason(item)) continue;
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
  window.PermissionMutations?.assertWrites(writes, window.TeamAccess, window.VeconiPermissionPolicy);
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
  window.PermissionMutations?.assertWrites(writes, window.TeamAccess, window.VeconiPermissionPolicy);
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
  // Queue, sale, balance and stock are staged in the same turn, then committed
  // atomically by IndexedDB. Checkout and the uploader await DB.flush().
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
function canWriteSharedSettings() {
  // Unknown/bootstrap permission state must never grant a configuration write.
  if (window.TeamAccess?.has?.("settings.manage") !== true) return false;
  const context = window.BusinessContext?.get?.();
  return Boolean(currentUser?.uid) && currentUser.uid === auth.currentUser?.uid &&
    context?.loading === false && !context.error &&
    ["owner", "platform_admin", "manager", "seller", "stock"].includes(context.role) &&
    context.businessId === activeBusinessId() && context.userProfile?.uid === currentUser.uid &&
    context.userProfile?.businessId === context.businessId && context.userProfile?.active !== false &&
    Array.isArray(context.permissions) && (!context.member?.status || context.member.status === "active") &&
    window.TeamAccess?.has?.("settings.manage") === true;
}
function sharedSettingsConfig(config) {
  // Compare hydrated defaults symmetrically, without mutating either snapshot.
  const value = structuredClone(config || {});
  const normalized = DB.prepare ? DB.prepare({config:value}).config : value;
  const result = {...normalized};
  for (const key of ["operation", "recentClientIds", "appSchemaVersion"]) delete result[key];
  return result;
}
function diffWrites(before, after) {
  const previousMovements = new Set((before.movimentacoesEstoque || []).map(m => String(m.id)));
  for (const movement of after.movimentacoesEstoque || []) {
    if (previousMovements.has(String(movement.id))) continue; // Never backfill history.
    const sale = (after.vendas || []).find(s => s.id === movement.vendaId);
    const product = (after.produtos || []).find(p => p.id === movement.produtoId);
    const businessId = activeBusinessId();
    if (movement.businessId && movement.businessId !== businessId)
      throw Error('Movimentação de estoque de outra empresa.');
    const requested = movement.spaceId || sale?.spaceId || '';
    if (sale?.spaceId && requested !== sale.spaceId)
      throw Error('A movimentação deve pertencer ao espaço da venda.');
    const origin = window.SpaceContext?.stockMovementOrigin?.(product, requested);
    if (!origin) throw Error('Selecione o espaço desta movimentação de estoque.');
    Object.assign(movement, origin);
  }
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
          // Captured at the USER ACTION, never inferred from the UI at upload
          // or used to rewrite any previously persisted operation.
          ...(!exists&&['products','productVariants'].includes(name)&&Number(name==='products'?item.estoqueAtual:item.stock)>0&&item.productType!=='variable'
            ? {initialStockSpaceId:window.SpaceContext?.stockMovementOrigin?.(name==='products'?item:(after.produtos||[]).find(p=>p.id===item.parentProductId))?.spaceId}
            : {}),
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
  if (canWriteSharedSettings()) {
    const beforeConfig = sharedSettingsConfig(before.config),
      afterConfig = sharedSettingsConfig(after.config);
    if (JSON.stringify(beforeConfig) !== JSON.stringify(afterConfig))
      writes.push({
        entityType: "settings",
        entityId: "default",
        operation: "update",
        before: beforeConfig,
        data: changedFields(beforeConfig, afterConfig),
      });
  }
  return writes;
}
function captureChanges(before, after) {
  if (applyingCloud) return 0;
  const writes = diffWrites(before, after);
  window.PermissionMutations?.assertWrites(writes, window.TeamAccess, window.VeconiPermissionPolicy);
  const eventWrite =
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
    window.WorkspaceRuntime?.capture();
    if (!currentUser) return originalAlter(mutator);
    const permissionScope = window.TeamAccess?.captureSession?.();
    const before = structuredClone(DB.carregar()), next = structuredClone(before);
    mutator(next);
    const after = DB.prepare ? DB.prepare(next) : next;
    if (!canWriteSharedSettings() && JSON.stringify(sharedSettingsConfig(before.config)) !== JSON.stringify(sharedSettingsConfig(after.config)))
      throw window.VeconiPermissionPolicy.denied('settings.manage');
    // Validate/stage the queue before publishing the new memory projection.
    // Both sets of records reach the same IDB transaction at the turn boundary.
    window.TeamAccess?.assertSession?.(permissionScope);
    captureChanges(before, after);
    return DB.salvar(after);
  };
  DB.__firebaseSyncWrapped = true;
}

async function validateUser() {
  const readScopeToken=captureCloudReadScope();
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
  const snapshot = await syncStep("auth_profile", () => getDoc(doc(db, "users", user.uid)), {service: "Firestore", collection: "users", request: "getDoc"});
  assertCloudReadScope(readScopeToken);
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
  const readScopeToken=captureCloudReadScope();
  const { user, businessId } = await validateUser();
  assertCloudReadScope(readScopeToken);
  const
    reference = doc(db, "businesses", businessId),
    snapshot = await syncStep("business_validation", () => getDoc(reference), {service: "Firestore", collection: "businesses", businessId, request: "getDoc"});
  assertCloudReadScope(readScopeToken);
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
  const readScopeToken=captureCloudReadScope();
  emit({ status: "testing", message: "Verificando a nuvem…" });
  try {
    await validateUser();
    assertCloudReadScope(readScopeToken);
    await ensureBusinessDocument();
    assertCloudReadScope(readScopeToken);
    lastError = "";
    lastErrorCode = "";
    currentPath = "";
    emit({ testPassed: true, status: "success", message: "Nuvem verificada" });
    return true;
  } catch (error) {
    if(readScopeToken!==captureCloudReadScope())throw error;
    reportError(error, "Connection test", { path: currentPath });
    throw error;
  }
}
let verifiedProtocolSession='';
function assertSyncProtocolBundle() {
  if(Number(window.AdiFestaBuild?.release)>=210&&(!window.PermissionMutations?.assertWrites||window.VeconiPermissionPolicy?.VERSION!==2))
    throw Object.assign(Error('A atualização das permissões ainda não terminou de carregar. Atualize o aplicativo sem limpar os dados. Nenhuma operação foi gravada.'),{code:'permissions-update-required'});
  if (!Number.isInteger(Number(window.AdiFestaBuild?.release)) || Number(window.AdiFestaBuild.release)<202 || !window.FirebaseCallable)
    throw Object.assign(Error('Atualize a VECONI para continuar com segurança. As filas foram preservadas. Não refaça vendas.'),{code:'sync-update-required'});
}
async function verifyOperationalProtocol() {
  assertSyncProtocolBundle();
  const generation=syncSessionGeneration,uid=currentUser?.uid,businessId=activeBusinessId(),workspaceGeneration=DB.getWorkspaceGeneration?.()??0;
  const key=JSON.stringify([generation,uid,businessId,workspaceGeneration]);
  if(verifiedProtocolSession===key&&state.operationalProtocol?.status==='verified')return state.operationalProtocol;
  const current=()=>generation===syncSessionGeneration&&uid===currentUser?.uid&&uid===auth.currentUser?.uid&&businessId===activeBusinessId()&&workspaceGeneration===(DB.getWorkspaceGeneration?.()??0);
  const result=await window.FirebaseCallable('getOperationalSyncReceipt',{businessId,workspaceGeneration,kind:'sync_protocol'});
  if(!current())throw Object.assign(Error('A sessão foi substituída; a fila original foi preservada.'),{code:'sync-session-retired'});
  const protocol=result.data;
  if(protocol?.protocolVersion!==1||protocol.channel!=='commitOperationalSync'||protocol.businessId!==businessId||protocol.workspaceGeneration!==workspaceGeneration||!Number.isInteger(protocol.minClientRelease)||protocol.minClientRelease<202||Number(window.AdiFestaBuild.release)<protocol.minClientRelease)
    throw Object.assign(Error('Atualize a VECONI. O canal de sincronização ainda não foi confirmado; nenhuma operação foi enviada.'),{code:'sync-update-required'});
  state.operationalProtocol={status:'verified',protocolVersion:1,clientRelease:Number(window.AdiFestaBuild.release),permissionsVersion:protocol.permissionsVersion||1,confirmedAt:now()};
  verifiedProtocolSession=key;
  return protocol;
}
async function commitQueueItem(item) {
  const generation=syncSessionGeneration,uid=currentUser?.uid;
  const assertSession=()=>{if(generation!==syncSessionGeneration||uid!==currentUser?.uid||uid!==auth.currentUser?.uid)throw Object.assign(Error('A sessão da operação foi substituída. A fila original foi preservada.'),{code:'sync-session-retired'});};
  assertSession();
  if(window.location || window.AdiFestaBuild){
    assertSyncProtocolBundle();
    if(item.syncProtocolVersion!==1)throw Object.assign(Error('Operação de versão anterior preservada para revisão. Não será reenviada automaticamente.'),{code:'sync-protocol-upgrade-review'});
    await verifyOperationalProtocol();
    assertSession();
  }
  window.WorkspaceRuntime.capture();
  const preflight=queuePreflight(item);
  if(!preflight.ok)throw Object.assign(Error(preflight.message),{code:preflight.code,
    ...(queueSettingsDiagnostic(item) ? {syncDetail:{...queueSettingsDiagnostic(item),service:"Firestore",request:"queue_preflight"}} : {})});
  const settingsWrite = item.payload?.writes?.find(write => write.entityType === "settings");
  if(item.payload?.writes?.length===1&&item.payload.writes[0].entityType==='clients'&&window.TeamAccess?.has?.(item.payload.writes[0].operation==='create'?'customers.create':window.VeconiPermissionPolicy?.customerPermission(item.payload.writes[0])||'customers.edit')===false)
    throw Object.assign(Error('A ação exige autorização de clientes. O original foi preservado; solicite análise ao responsável.'),{code:'customer-edit-permission-required'});
  if (settingsWrite && !canWriteSharedSettings())
    throw Object.assign(Error("A autorização para alterar configurações não está disponível. Nenhum envio foi permitido."),
      {code:"settings-permission-required",syncDetail:{stage:"settings_permission_preflight",service:"Firestore",
        code:"settings-permission-required",collection:"settings",request:"queue_preflight",
        path:`businesses/${activeBusinessId()}/settings/${settingsWrite.entityId}`,
        message:"A configuração exige autorização explícita de settings.manage."}});
  // No fallback to direct commercial writes on Function/network failure. The
  // durable original envelope, IDs and checksum remain in their UID namespace.
  if (window.FirebaseCallable) {
    let result;
    try { result = await window.FirebaseCallable('commitOperationalSync', {
      businessId: activeBusinessId(),
      syncProtocolVersion:1,clientRelease:202,
      item: {...item, operationId:stableLegacyOperationId(item),
        workspaceGeneration:item.workspaceGeneration??DB.getWorkspaceGeneration?.()??0},
    }); } catch(error) {
      assertSession();
      error.code=errorCode(error);
      error.syncDetail={stage:'server_operational_commit',service:'Cloud Functions',code:error.code,
        request:'authenticated_commit',path:`businesses/${activeBusinessId()}`,
        message:'O servidor não confirmou esta operação. O envelope local original foi preservado.'};
      throw error;
    }
    assertSession();
    return result.data?.outcome || null;
  }
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
  let transactionStage = "transaction_start", transactionPaths = [];
  try {
  await runTransaction(db, async (transaction) => {
    transactionPaths = [];
    // Fence retries and every asynchronous read/write, including helper calls.
    transaction = new Proxy(transaction, {get(target, property) {
      if (property === 'get') return async (...args) => {
        assertSession(); transactionStage = "transaction_read"; currentPath = args[0]?.path || currentPath;
        const value = await target.get(...args); assertSession(); return value;
      };
      if (['set','update','delete'].includes(property)) return (...args) => {
        assertSession(); transactionStage = "transaction_write_prepare";
        currentPath = args[0]?.path || currentPath;
        if (args[0]?.path) transactionPaths.push(args[0].path);
        return target[property](...args);
      };
      return Reflect.get(target, property);
    }});
    assertSession();
    currentPath = `businesses/${businessId}/processedOperations/${operationId}`;
    const processed = await transaction.get(marker);
    if (processed.exists() && processed.data()?.status === "archived_without_effects")
      throw Object.assign(Error("Esta operação foi arquivada sem efeitos e não pode ser reenviada."), {code:"queue-operation-archived"});
    if (processed.exists()) return;
    const onlineSaleWrite = writes.find(w=>w.entityType==='sales'&&w.operation==='create'&&w.data?.onlineOrderId);
    let onlineClaim=null;
    if(onlineSaleWrite){
      const s=await transaction.get(doc(db,'businesses',businessId,'catalogOrders',onlineSaleWrite.data.onlineOrderId));onlineClaim=s.exists()?s.data():null;
      if(!onlineClaim||onlineClaim.finalizationStatus!=='pending'||onlineClaim.finalizationOperationId!==operationId||onlineClaim.saleId!==onlineSaleWrite.entityId||onlineClaim.finalizationActorUid!==currentUser.uid)
        throw Object.assign(Error('A conclusão do pedido não está autorizada. Retome o pedido original.'),{code:'online-order-finalization-invalid'});
    }
    const commitProductImportFence = await prepareProductImportFence({transaction,db,businessId,writes,doc,serverTimestamp});
    for (const write of writes.filter((entry) =>
      entry.entityType === "sales" && entry.operation === "create")) {
      // Online sale IDs/operations are fixed by the backend claim; they are not
      // legacy local-only sales. Sellers must not read private balance adjustments.
      if (onlineClaim && write.entityId === onlineClaim.saleId) continue;
      // The sale-create Rule checks this private tombstone for every actor.
      // Keep the detailed diagnostic for authorized roles, but never require
      // financial read access just to upload an operational sale.
      if (!["financial.view", "customers.receiveDebt", "customers.adjustBalance"]
        .some((permission) => window.TeamAccess?.has?.(permission) === true)) continue;
      currentPath = `businesses/${businessId}/balanceAdjustments/${legacyReconciliationOperationId(write.entityId)}`;
      const resolution = await transaction.get(doc(db, "businesses", businessId,
        "balanceAdjustments", legacyReconciliationOperationId(write.entityId)));
      if (resolution.exists() &&
        resolution.data()?.resolutionStatus === "resolved_by_reconciliation")
        throw Object.assign(new Error("Esta operação já foi conciliada manualmente e não será sincronizada."),
          { code: "sale-resolved-by-reconciliation", saleId: String(write.entityId) });
    }
    const snapshots = new Map();
    for (const write of writes)
      if (
        (transactional && deltaEntities.includes(write.entityType)) ||
        (financialEffect?.type === "credit_sale_reversal" &&
          write.entityType === "sales" && String(write.entityId) === financialEffect.saleId) ||
        (IDEMPOTENT_EVENT_NAMES.has(write.entityType) && write.data?.operationId &&
          !(onlineClaim && write.entityType === 'stockMovements' &&
            write.operation === 'create' && write.data.vendaId === onlineClaim.saleId))
      ) {
          const reference = doc(
            db,
            "businesses",
            businessId,
            write.entityType,
            String(write.entityId),
          );
          currentPath = `businesses/${businessId}/${write.entityType}/${write.entityId}`;
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
      if (financialEffect.type === "credit_sale_reversal") {
        const existing = financialEffectSnapshot.data();
        if (existing.businessId !== businessId || existing.type !== financialEffect.type ||
          existing.saleId !== financialEffect.saleId || existing.customerId !== financialEffect.customerId ||
          !sameFinancialMoney(existing.balanceDelta, financialEffect.balanceDelta))
          throw Object.assign(Error("O recibo de estorno não corresponde à venda. A operação foi preservada."), {code:"credit-sale-reversal-conflict"});
      }
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
    if (financialEffect?.type === "credit_sale_reversal") {
      const saleWrite = writes.find(write => write.entityType === "sales" && String(write.entityId) === financialEffect.saleId),
        remoteSale = snapshots.get(`sales:${financialEffect.saleId}`)?.data(),
        remoteClient = snapshots.get(`clients:${financialEffect.customerId}`)?.data(),
        clientWrite = writes.find(write => write.entityType === "clients" && String(write.entityId) === financialEffect.customerId),
        debit = await transaction.get(doc(db, "businesses", businessId, "balanceEvents", balanceEffectId("credit_sale", financialEffect.saleId)));
      validateCreditSaleReversal(remoteSale, remoteClient, debit.exists() ? debit.data() : null, financialEffect, clientWrite);
      if (String(remoteSale.spaceId) !== String(saleWrite?.before?.spaceId) ||
        String(remoteSale.operationId) !== String(saleWrite?.before?.operationId))
        throw Object.assign(Error("A origem da venda Fiado mudou. Nenhum cancelamento foi aplicado."), {code:"credit-sale-reversal-conflict"});
    }
    const creditClientWrite = financialEffect?.type === "credit_sale"
      ? writes.find((write) => write.entityType === "clients" &&
        String(write.entityId) === String(financialEffect.customerId)) : null,
      creditClientSnapshot = creditClientWrite
        ? snapshots.get(`clients:${creditClientWrite.entityId}`) : null;
    commitProductImportFence();
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
      if (financialEffect?.type === "credit_sale_reversal" && write.entityType === "sales" &&
        String(write.entityId) === financialEffect.saleId) {
        const original = snapshots.get(`sales:${financialEffect.saleId}`).data();
        data = {...data, operationId:original.operationId, idempotencyKey:original.idempotencyKey || original.operationId,
          actorUid:original.actorUid, actorNameSnapshot:original.actorNameSnapshot,
          actorRoleSnapshot:original.actorRoleSnapshot};
      }
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
        if(['products','productVariants'].includes(write.entityType)){
          const quantity=Number(base.onlineReservedStock||0),key=write.entityType==='products'?`p_${write.entityId}`:`v_${write.entityId}`,own=Number(onlineClaim?.reservedQuantities?.[key]||0),field=write.entityType==='products'?'estoqueAtual':'stock';
          if(quantity>0&&!base.allowNegativeStock&&Number(merged[field])<quantity-own)
            throw Object.assign(Error('Este estoque está reservado para pedidos online. Atualize a venda ou conclua o pedido correspondente.'),{code:'online-stock-reserved'});
          // Variant reservations live on the variant, not its parent. Do not
          // invent a new parent reservation field during a stock-only sale.
          if (Object.hasOwn(base, 'onlineReservedStock')) merged.onlineReservedStock=quantity;
          else delete merged.onlineReservedStock;
          merged.onlineOrderFinalizationId=onlineClaim?.id||null;
        }
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
      const creating = write.operation === "create",
        payload = cloudPayload(write.entityType, write.entityId, data, creating),
        canWriteCosts = window.TeamAccess?.has?.("cost.view") === true;
      if (write.entityType === "products") {
        const hasCost = Object.prototype.hasOwnProperty.call(data || {}, "custo") ||
          Object.prototype.hasOwnProperty.call(data || {}, "cost");
        if (hasCost && canWriteCosts) {
          const cost = Number(data.custo ?? data.cost ?? 0);
          transaction.set(doc(db, "businesses", businessId, "productFinancials", String(write.entityId)),
            sanitizeForFirestore({
              id: String(write.entityId), productId: String(write.entityId), businessId,
              custo: Number.isFinite(cost) ? cost : 0, ownerId: currentUser.uid,
              updatedByUid: currentUser.uid, updatedAt: serverTimestamp(), schemaVersion: 1,
            }), { merge: true });
        }
        payload.custo = deleteField();
        payload.cost = deleteField();
      }
      if (write.entityType === "productVariants") {
        const hasCost = Object.prototype.hasOwnProperty.call(data || {}, "cost") ||
          Object.prototype.hasOwnProperty.call(data || {}, "custo");
        if (hasCost && canWriteCosts) {
          const cost = Number(data.cost ?? data.custo ?? 0);
          transaction.set(doc(db, "businesses", businessId, "variantFinancials", String(write.entityId)),
            sanitizeForFirestore({
              id: String(write.entityId), variantId: String(write.entityId), businessId,
              cost: Number.isFinite(cost) ? cost : 0, ownerId: currentUser.uid,
              updatedByUid: currentUser.uid, updatedAt: serverTimestamp(), schemaVersion: 1,
            }), { merge: true });
        }
        payload.cost = deleteField();
        payload.custo = deleteField();
      }
      if (write.entityType === "sales") {
        const items = Array.isArray(data?.itens) ? data.itens : null,
          itemCosts = (items || []).map((saleItem, index) => ({
            index,
            productId: saleItem.produtoId || saleItem.productId || null,
            variantId: saleItem.variantId || null,
            custoUnitario: Number(saleItem.custoUnitario ?? saleItem.costSnapshot ?? 0) || 0,
          })),
          hasItemCosts = (items || []).some((saleItem) =>
            Object.prototype.hasOwnProperty.call(saleItem || {}, "custoUnitario") ||
            Object.prototype.hasOwnProperty.call(saleItem || {}, "costSnapshot") ||
            Object.prototype.hasOwnProperty.call(saleItem || {}, "custo") ||
            Object.prototype.hasOwnProperty.call(saleItem || {}, "cost")),
          hasFinancialData = hasItemCosts ||
            Object.prototype.hasOwnProperty.call(data || {}, "custoTotal") ||
            Object.prototype.hasOwnProperty.call(data || {}, "lucro");
        if (hasFinancialData && canWriteCosts) {
          transaction.set(doc(db, "businesses", businessId, "saleFinancials", String(write.entityId)),
            sanitizeForFirestore({
              id: String(write.entityId), saleId: String(write.entityId), businessId,
              custoTotal: Number(data.custoTotal ?? 0) || 0,
              lucro: Number(data.lucro ?? 0) || 0,
              itemCosts, ownerId: currentUser.uid, updatedByUid: currentUser.uid,
              updatedAt: serverTimestamp(), schemaVersion: 1,
            }), { merge: true });
        }
        if (items) payload.itens = items.map((saleItem) => {
          const operationalItem = { ...saleItem };
          for (const field of ["custoUnitario", "costSnapshot", "custo", "cost", "custoTotal", "lucro"])
            delete operationalItem[field];
          return operationalItem;
        });
        payload.custoTotal = deleteField();
        payload.lucro = deleteField();
      }
      if (write.entityType === "stockMovements") {
        // V170 pending online-sale queues lack spaceId. Recover only from the
        // authenticated server claim already validated above, never today's UI selection.
        if (creating && onlineClaim && data.vendaId === onlineClaim.saleId) {
          if (payload.spaceId && payload.spaceId !== onlineClaim.spaceId ||
              !onlineClaim.items.some(i => i.productId === data.produtoId &&
                (i.variantId || null) === (data.variantId || null)))
            throw Object.assign(Error('A movimentação não corresponde ao espaço e aos itens do pedido.'), {code:'online-stock-scope-mismatch'});
          payload.spaceId = onlineClaim.spaceId;
        }
        const hasCost = Object.prototype.hasOwnProperty.call(data || {}, "custoUnitario") ||
          Object.prototype.hasOwnProperty.call(data || {}, "costUnit");
        if (hasCost && canWriteCosts) {
          const cost = Number(data.custoUnitario ?? data.costUnit ?? 0);
          transaction.set(doc(db, "businesses", businessId, "stockMovementFinancials", String(write.entityId)),
            sanitizeForFirestore({
              id: String(write.entityId), stockMovementId: String(write.entityId), businessId,
              custoUnitario: Number.isFinite(cost) ? cost : 0, ownerId: currentUser.uid,
              updatedByUid: currentUser.uid, updatedAt: serverTimestamp(), schemaVersion: 1,
            }), { merge: true });
        }
        payload.custoUnitario = deleteField();
        payload.costUnit = deleteField();
      }
      transaction.set(reference, payload, { merge: true });
    }
    if (financialEffectReference && !financialEffectSnapshot?.exists()) {
      currentPath = `businesses/${businessId}/balanceEvents/${financialEffect.id}`;
      transaction.set(
        financialEffectReference,
        sanitizeForFirestore({
          ...financialEffect,
          ...(financialEffect.type === "credit_sale_reversal" ? {
            reversesEventId: balanceEffectId("credit_sale", financialEffect.saleId),
            balanceBefore: roundedMoney(snapshots.get(`clients:${financialEffect.customerId}`).data().saldo),
            balanceAfter: roundedMoney(Number(snapshots.get(`clients:${financialEffect.customerId}`).data().saldo) + financialEffect.balanceDelta),
            financialVersionBefore: financialVersionOf(snapshots.get(`clients:${financialEffect.customerId}`).data()),
            financialVersionAfter: financialVersionOf(snapshots.get(`clients:${financialEffect.customerId}`).data()) + 1,
          } : {}),
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
          ...(financialEffect.type === "credit_sale_reversal"
            ? {financialReversedAt:serverTimestamp(), financialReversalEventId:financialEffect.id,
                cancelOperationId:operationId, cancelledAt:serverTimestamp(), cancelledByUid:currentUser.uid}
            : {financialAppliedAt:serverTimestamp(),financialOperationId:financialEffect.id,
                applicationStatus:"applied",
                // The application state is not the business/payment status of a sale.
                ...(financialEffect.sourceCollection !== "sales" ? {status:"applied"} : {})}),
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
    transactionStage = "transaction_commit";
  });
  } catch (error) {
    // Retired-session callbacks are not Firestore failures and must not attach
    // a diagnostic from the previous principal to the replacement session.
    if (error.code === "sync-session-retired") throw error;
    if (!error.syncDetail) {
      const targets = [...new Set(writes.map(write =>
        `businesses/${businessId}/${write.entityType}/${write.entityId}`))];
      const committing = transactionStage === "transaction_commit";
      const settingsOnly = writes.length > 0 && writes.every(write => write.entityType === "settings");
      error.syncDetail = {
        stage: committing && settingsOnly ? "shared_settings_commit" : transactionStage,
        service:"Firestore",code:errorCode(error) || "unknown",
        collection:committing ? settingsOnly ? "settings" : "" : String(currentPath).split("/").at(-2) || "",
        path:committing ? targets.length === 1 ? targets[0] : "" : currentPath,
        pathAttribution:committing ? "payload_target_not_individual_rule_result" : "observed_operation",
        request:committing ? "atomic_commit" : transactionStage,
        transactionPaths:[...new Set(transactionPaths)],lastObservedPath:currentPath,
        message:String(error.message || "Falha na transação Firestore.").slice(0,600),
      };
    }
    throw error;
  }
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
  if (window.FirebaseCallable) {
    const result=await window.FirebaseCallable('getOperationalSyncReceipt',{
      businessId,workspaceGeneration:item.workspaceGeneration??DB.getWorkspaceGeneration?.()??0,
      operationId,saleId,spaceId:remote.spaceId,
    });
    if(result.data?.confirmed!==true)throw Object.assign(Error('Confirmação financeira pendente; operação preservada.'),{code:'sale-financial-ack-missing'});
    return;
  }
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
  const manualRetry = options.manualRetry === true;
  const generation=syncSessionGeneration,uid=currentUser?.uid,businessId=state.userProfile?.businessId;
  const current=()=>generation===syncSessionGeneration&&uid===currentUser?.uid&&uid===auth.currentUser?.uid&&businessId===state.userProfile?.businessId;
  const assertSession=()=>{if(!current())throw Object.assign(Error('A sessão da fila foi substituída. Nenhuma confirmação foi aplicada na nova conta.'),{code:'sync-session-retired'});};
  processingPromise = (async () => {
    await DB.flush?.();
    if (!currentUser)
      return { sent: 0, pending: readQueue().length, errors: 0 };
    assertSession();
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
    assertSession();
    if(window.location || window.AdiFestaBuild)await verifyOperationalProtocol();
    assertSession();
    await refreshRecoveryResolutions(current);
    assertSession();
    let sent = 0,
      reviewHeld = 0,
      financialConflicts = 0,
      financialAdjustments = 0,
      index = 0,
      queue = readQueue(),
      changedCollections = new Set();
    for (const queued of [...queue]) {
      assertSession();
      if (queueManualReviewReason(queued)) {
        preserveQueueQuarantine(queued);
        retireSettingsPermissionFailure(queued);
        reviewHeld++;
        continue;
      }
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
      // Do not edit, retry, reclassify or remove the original failed packet.
      // force/manual sync cannot override this hold; new sales can still sync.
      if (saleQueueRequiresReview(queued)) { reviewHeld++; continue; }
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
      if (!canAttempt(queued, force, manualRetry)) continue;
      const live = readQueue(),
        position = live.findIndex((item) => item.queueId === queued.queueId);
      if (position < 0) continue;
      live[position] = {
        ...live[position],
        status: "syncing",
        lastAttemptAt: now(),
      };
      saveQueue(live);
      await DB.flush?.();
      assertSession();
      emit({
        status: "syncing",
        message: `Sincronizando ${index + 1} de ${queue.length}…`,
        progress: Math.round(((index + 1) / Math.max(1, queue.length)) * 100),
      });
      try {
        const outcome = await commitQueueItem(live[position]);
        assertSession();
        await verifySaleQueueCommit(live[position]);
        assertSession();
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
        if (!current() || error.code === 'sync-session-retired') throw error;
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
            lastErrorPath: error.syncDetail?.path ?? (currentPath || null),
            lastErrorStage: error.syncDetail?.stage || null,
            lastErrorRequest: error.syncDetail?.request || null,
            lastErrorPaths: error.syncDetail?.transactionPaths || [],
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
    await DB.flush?.();
    assertSession();
    const counts = queueCounts();
    return {
      sent,
      reviewHeld,
      financialConflicts,
      financialAdjustments,
      pending: counts.pending,
      manualReview: counts.manualReview,
      quarantined: counts.quarantined,
      archived: counts.archived,
      errors: counts.errors,
      errorBreakdown: queueErrorBreakdown(),
      paused: cloudPaused,
      reason: cloudPaused ? lastErrorCode || "cloud_paused" : "",
      collections: [...changedCollections],
    };
  })();
  const task=processingPromise;
  try {
    return await task;
  } finally {
    if(processingPromise===task)processingPromise = null;
  }
}
function pendingIds(name) {
  const ids = new Set();
  for (const item of readQueue())
    if (!(name==='clients'&&readRecoveryResolution(item)) && !isHistoricalProjectionBatch(item) &&
        !(name === "settings" && queueQuarantineReason(item) === "settings_permission_required"))
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
async function confirmSaleUndo(sale) {
  if (sale?.formaPagamento !== "fiado" && sale?.status !== "fiado") return;
  const generation = syncSessionGeneration, uid = currentUser?.uid, businessId = activeBusinessId(),
    operationId = sale.cancelOperationId, saleId = String(sale.id), customerId = String(sale.clienteId);
  const assertSession = () => {
    if (!uid || uid !== currentUser?.uid || uid !== auth.currentUser?.uid || generation !== syncSessionGeneration || businessId !== activeBusinessId())
      throw Object.assign(Error("A sessão mudou. O cancelamento foi preservado na conta de origem."), {code:"sync-session-retired"});
  };
  assertSession();
  if (!navigator.onLine || !operationId) throw Error("Cancelamento preservado no aparelho, ainda sem confirmação financeira. Não repita a operação.");
  await DB.flush?.();
  await processSyncQueue({force:true});
  assertSession();
  if(window.FirebaseCallable){
    const ack=await window.FirebaseCallable('getOperationalSyncReceipt',{businessId,workspaceGeneration:DB.getWorkspaceGeneration?.()??0,operationId,saleId,spaceId:sale.spaceId,kind:'sale_undo'});
    assertSession();
    if(ack.data?.confirmed!==true)throw Error('Cancelamento preservado; confirmação financeira pendente. Não repita.');
    const [remote,client]=await Promise.all([
      getDocFromServer(doc(db,'businesses',businessId,'sales',saleId)),
      getDocFromServer(doc(db,'businesses',businessId,'clients',customerId)),
    ]);
    assertSession();
    if(remote.exists())applyCloudCollection('sales',[{id:saleId,...remote.data()}],{authoritative:true});
    if(client.exists())applyCloudCollection('clients',[{id:customerId,...client.data()}],{authoritative:true});
    await DB.flush?.();return;
  }
  const [marker, remoteSale, reversal, client] = await Promise.all([
    getDocFromServer(doc(db,"businesses",businessId,"processedOperations",operationId)),
    getDocFromServer(doc(db,"businesses",businessId,"sales",saleId)),
    getDocFromServer(doc(db,"businesses",businessId,"balanceEvents",balanceEffectId("credit_sale_reversal",saleId))),
    getDocFromServer(doc(db,"businesses",businessId,"clients",customerId)),
  ]);
  assertSession();
  const event = reversal.exists() ? reversal.data() : null;
  if (!marker.exists() || !["processed","recovered_existing"].includes(marker.data().status) ||
    !remoteSale.exists() || remoteSale.data().active !== false || !client.exists() ||
    !event || event.businessId !== businessId || event.saleId !== saleId || event.customerId !== customerId ||
    event.type !== "credit_sale_reversal" || event.status !== "applied" || event.operationId !== operationId ||
    !sameFinancialMoney(event.balanceDelta, sale.valorFinal ?? sale.valorTotal))
    throw Error("Cancelamento preservado, mas o estorno Fiado ainda não foi confirmado na nuvem. Não refaça a venda nem o cancelamento; revise a sincronização.");
  applyCloudCollection("sales", [{id:saleId,...remoteSale.data()}], {authoritative:true});
  applyCloudCollection("clients", [{id:customerId,...client.data()}], {authoritative:true});
  await DB.flush?.();
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
  applyProtectedMetadata(data);
  return changed;
}
function applyProtectedMetadata(data) {
  const canCost=window.TeamAccess?.has?.("cost.view")??true,canProfit=window.TeamAccess?.has?.("profit.view")??true;
  window.TeamAccess?.sanitizePrivateCache?.(data);
  if(!canCost&&!canProfit)return;
  const productFinancials=new Map((data.productFinancials||[]).map(item=>[String(item.productId||item.id),item]));
  const variantFinancials=new Map((data.variantFinancials||[]).map(item=>[String(item.variantId||item.id),item]));
  if(canCost)for(const product of data.produtos||[]){const metadata=productFinancials.get(String(product.id));if(metadata&&'custo' in metadata)product.custo=metadata.custo}
  if(canCost)for(const variant of data.variacoesProdutos||[]){const metadata=variantFinancials.get(String(variant.id));if(metadata&&'cost' in metadata)variant.cost=metadata.cost}
  const saleFinancials=new Map((data.saleFinancials||[]).map(item=>[String(item.saleId||item.id),item]));
  for(const sale of data.vendas||[]){const metadata=saleFinancials.get(String(sale.id));if(!metadata)continue;if(canCost&&'custoTotal' in metadata)sale.custoTotal=metadata.custoTotal;if(canProfit&&'lucro' in metadata)sale.lucro=metadata.lucro;const costs=new Map((metadata.itemCosts||[]).map(item=>[Number(item.index),item]));(sale.itens||[]).forEach((item,index)=>{const cost=costs.get(index);if(!cost)return;if(canCost){item.custoUnitario=cost.custoUnitario;item.costSnapshot=cost.custoUnitario;item.custoTotal=cost.custoTotal}if(canProfit)item.lucro=cost.lucro})}
  const stockFinancials=new Map((data.stockMovementFinancials||[]).map(item=>[String(item.stockMovementId||item.id),item]));
  if(canCost)for(const movement of data.movimentacoesEstoque||[]){const metadata=stockFinancials.get(String(movement.id));if(metadata&&'custoUnitario' in metadata)movement.custoUnitario=metadata.custoUnitario}
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
// Downloads have their own identity and retry lifecycle, never a queue owner.
function captureCloudReadScope() {
  const context=window.BusinessContext?.get?.()||{};
  let businessId='';try{businessId=activeBusinessId();}catch{/* signed-out scope is still fenceable */}
  return JSON.stringify([syncSessionGeneration,currentUser?.uid||'',auth.currentUser?.uid||'',businessId,
    DB.getWorkspaceGeneration?.()??0,context.role||'',context.permissionSignature||'',
    [...(context.permissions||[])].sort(),context.spaceAccess||'', [...(context.allowedSpaceIds||[])].sort(),
    window.SpaceContext?.homeId?.()||'',window.SpaceContext?.salesId?.()||'']);
}
function assertCloudReadScope(scope) {
  if(scope!==captureCloudReadScope())throw Object.assign(Error('A sessão ou o espaço mudou durante a leitura. Nenhuma confirmação foi aplicada.'),{code:'sync-session-retired'});
}
function salesReadScope() {
  const scope=window.TeamAccess?.operationalReadScopeKey?.();
  return scope?'read-hydration-v204:'+scope:null;
}
function registerRealtimeCollection(name, mode = "all") {
  const key = `${activeBusinessId()}:${name}:${mode}`;
  if (listenerRegistry.has(key)) return listenerRegistry.get(key);
  const scope = captureCloudReadScope(), subscriptionUid = currentUser?.uid || "",
    path = `businesses/${activeBusinessId()}/${name}${mode === "document" ? "/default" : ""}`,
    isCurrent = () => scope === captureCloudReadScope();
  const onDocuments = (documents, metadata) => {
      if (!isCurrent()) return;
      const list = Array.isArray(documents)
        ? documents
        : documents
          ? [documents]
          : [];
      state.cloudCounts[name] = list.filter((item) => !item?.deletedAt).length;
      state.cloudNewest[name] = newestTimestamp(list);
      rememberSnapshotMetadata(name, metadata);
      if (name === "clients")
        state.cloudFinancial = {...state.cloudFinancial,...cloudDebtSummary(list)};
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
    onError = (error) => {
      if (!isCurrent()) return;
      reportError(error, "Realtime collection listener", {operation: "listen", collection: name, path, subscriptionUid});
    };
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
  const scope=captureCloudReadScope(),uid=currentUser.uid,businessId=activeBusinessId(),
    generation=DB.getWorkspaceGeneration?.()??0,pendingKey='adiFesta:'+namespace()+':pendingReadInvalidations:v204',
    signalPath='businesses/'+businessId+'/syncMetadata/last-sync',backoff=[1000,3000,10000,30000];
  let stopped=false,inFlight=false,attempt=0,lastFailure=null;
  const permanentFailure=()=>lastFailure&&['permission-denied','unauthenticated','invalid-argument','failed-precondition',
    'sync-read-page-limit','local-cache-conflict'].includes(lastFailure.code);
  const isCurrent=()=>{try{return !stopped&&scope===captureCloudReadScope();}catch{return false;}};
  const allowed=name=>SIGNAL_NAMES.includes(name)&&
    (['businessProfile','userProfile'].includes(name)||canPullSource(name));
  const pending=()=>[...signalCollections];
  const publishState=(status,nextRetryAt=null)=>emit({remoteReadRefresh:{
    pending:signalCollections.size,status,attempt,nextRetryAt,lastErrorCode:lastFailure?.code||'',updatedAt:now()}});
  const persist=()=>{
    if(!isCurrent())return;
    localStorage.setItem(pendingKey,JSON.stringify({version:1,businessId,uid,workspaceGeneration:generation,
      versions:Object.fromEntries([...signalVersions].filter(([name])=>allowed(name)))}));
  };
  const schedule=(delay=120)=>{
    if(!isCurrent()||!signalCollections.size||inFlight||!navigator.onLine||permanentFailure()||attempt>backoff.length)return;
    clearTimeout(signalPullTimer);signalPullTimer=setTimeout(download,delay);
  };
  const fail=error=>{
    if(!isCurrent()||error.code==='sync-session-retired')return;
    lastFailure={code:errorCode(error)||'unknown'};attempt++;
    const permanent=permanentFailure();
    const delay=!permanent&&attempt<=backoff.length?backoff[attempt-1]:null;
    publishState(delay===null?'blocked':'retry_wait',delay===null?null:new Date(Date.now()+delay).toISOString());
    if(!state.syncFailure||state.syncFailure.readRefreshKey===pendingKey)
      reportError(Object.assign(Error('Não foi possível atualizar os dados da loja. As operações comerciais não foram reenviadas.'),{
        code:lastFailure.code,syncDetail:{...(error.syncDetail||{}),stage:'remote_read_refresh',
          sourceStage:error.syncDetail?.stage||'',code:lastFailure.code,readRefreshKey:pendingKey,
          path:signalPath,at:now(),message:'Falha na atualização somente de leitura.'}}),'Realtime sync signal',{collections:pending()});
    if(delay!==null)schedule(delay);
  };
  async function download() {
    signalPullTimer=null;
    if(!isCurrent()||inFlight||!signalCollections.size||!navigator.onLine)return;
    inFlight=true;
    const changed=pending(),versions=Object.fromEntries(changed.map(name=>[name,signalVersions.get(name)]));
    try {
      publishState('reading');
      const cloudNames=changed.filter(name=>CLOUD_NAMES.includes(name)&&!REALTIME_NAMES.has(name)&&allowed(name));
      if(cloudNames.length)await pullCloudCollections({force:true,names:cloudNames});
      if(!isCurrent())return;
      if(changed.includes('businessProfile'))await refreshBusinessContext();
      if(!isCurrent())return;
      if(changed.includes('userProfile'))await refreshUserContext();
      if(!isCurrent())return;
      await DB.flush?.();
      if(!isCurrent())return;
      const time=now();
      saveSignalVersions({...readSignalVersions(),...versions});
      writeSyncTime(lastSyncKey(),time);
      await DB.flush?.();
      if(!isCurrent())return;
      for(const name of changed)if(signalVersions.get(name)===versions[name]){
        signalCollections.delete(name);signalVersions.delete(name);
      }
      persist();await DB.flush?.();
      if(!isCurrent())return;
      attempt=0;lastFailure=null;
      if(state.syncFailure?.readRefreshKey===pendingKey)state.syncFailure=null;
      publishState(signalCollections.size?'waiting':'idle');
      const counts=queueCounts();
      if(!counts.active&&!counts.errors&&!state.syncFailure&&!state.dataAudit?.integrity?.actionable)
        emit({status:signalCollections.size?'waiting':'success',
          message:signalCollections.size?'Atualizando dados recebidos da loja…':preservedQueueMessage(counts)||'Dados da loja atualizados.',
          lastSync:time});
      else updateQueueState();
    } catch(error) {
      if(isCurrent())for(const name of changed)if(!signalVersions.has(name)){
        signalCollections.add(name);signalVersions.set(name,versions[name]);
      }
      if(isCurrent())try{persist();}catch{/* write protection remains intact */}
      inFlight=false;fail(error);return;
    } finally {inFlight=false;}
    if(isCurrent()&&signalCollections.size)schedule();
  }
  const enqueue=(name,revision)=>{
    if(!allowed(name))return;
    signalCollections.add(name);signalVersions.set(name,String(revision||'unversioned').slice(0,256));
  };
  const wake=()=>{
    if(!isCurrent())return;
    if(permanentFailure())return;
    attempt=0;
    if(!signalCollections.size&&canPullSource('sales')){
      enqueue('sales',readSignalVersions().sales||'read-catchup-v204');
      try{persist();}catch(error){fail(error);return;}
    }
    schedule();
  };
  const resume=()=>{if(document.visibilityState==='visible')wake();};
  try{
    const saved=JSON.parse(localStorage.getItem(pendingKey)||'null');
    if(saved?.version===1&&saved.businessId===businessId&&saved.uid===uid&&saved.workspaceGeneration===generation)
      for(const [name,revision] of Object.entries(saved.versions||{}))if(typeof revision==='string')enqueue(name,revision);
  }catch{/* malformed read metadata cannot touch commercial storage */}
  // Read-only catch-up once per policy/ACL. Never edit or send the original queue.
  if(canPullSource('sales')&&readPullState()[businessId+':sales:readScope']!==salesReadScope())
    enqueue('sales','read-hydration-v204');
  cloudReadController={scope,wake,stop(){stopped=true;clearTimeout(signalPullTimer);
    removeEventListener('online',wake);removeEventListener('visibilitychange',resume);}};
  addEventListener('online',wake);addEventListener('visibilitychange',resume);
  if(canPullSource("products"))registerRealtimeCollection("products");
  if(canPullSource("productFinancials"))registerRealtimeCollection("productFinancials");
  registerRealtimeCollection("settings","document");
  const unsubscribe=syncSignalRepository.subscribeById('last-sync',(signal,metadata)=>{
    if(!isCurrent())return;
    rememberSnapshotMetadata('syncMetadata',metadata);emit({listenerConnected:true});
    if(!signal||signal.businessId&&signal.businessId!==businessId||
      signal.workspaceGeneration!==undefined&&signal.workspaceGeneration!==generation)return;
    const revision=String(signal.revision||signal.updatedAt||signal.syncedAt||''),
      stored=readSignalVersions(),remote=signal.collectionVersions&&typeof signal.collectionVersions==='object'
        ?signal.collectionVersions:Object.fromEntries((signal.changedCollections||[]).map(name=>[name,revision]));
    // No sourceSessionId shortcut: even old server signals can inherit an
    // arbitrary browser identity. Only a durably read revision is a no-op.
    for(const [name,value] of Object.entries(remote))if(String(stored[name]||'')!==String(value||revision))
      enqueue(name,value||revision);
    if(!Object.keys(remote).length&&revision)
      for(const name of signal.changedCollections||DEFAULT_PULL_NAMES)enqueue(name,revision);
    if(!signalCollections.size)return;
    try{persist();publishState('waiting');schedule();}catch(error){fail(error);}
  },error=>{
    if(!isCurrent())return;
    reportError(error,'Realtime sync signal listener',{collection:'syncMetadata/last-sync',
      operation:'listen',path:signalPath,subscriptionUid:uid});
  });
  unsubscribers.push(unsubscribe);
  try{if(signalCollections.size){persist();publishState('waiting');schedule();}}catch(error){fail(error);}
  emit({activeListeners:usageSnapshot().activeListeners,listenerConnected:false});
}
function stopCloudSubscriptions() {
  cloudReadController?.stop();cloudReadController=null;
  clearTimeout(cloudReadRestartTimer);cloudReadRestartTimer=null;
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
  const readScopeToken=captureCloudReadScope();
  const changedCollections = [
    ...new Set(
      (collections || []).filter((name) => SIGNAL_NAMES.includes(name)),
    ),
  ];
  // A health-only publication must never erase collection versions from a
  // previously committed server notification.
  if (!changedCollections.length) return false;
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
      pendingOperations: queueCounts().active,
      syncedAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    },
    { merge: true },
  );
  assertCloudReadScope(readScopeToken);
  // Publishing is not proof of a completed read. The listener acknowledges
  // only after hydration, including another operator's concurrent changes.
  return true;
}
async function safePublishSyncSignal(collections, status = "ok") {
  const readScopeToken=captureCloudReadScope();
  try {
    return await publishSyncSignal(collections, status);
  } catch (error) {
    if(readScopeToken!==captureCloudReadScope())return false;
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
  const scope=captureCloudReadScope();
  const snapshot = await getDoc(doc(db, "businesses", activeBusinessId()));
  assertCloudReadScope(scope);
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
  const scope=captureCloudReadScope();
  const snapshot = await getDoc(doc(db, "users", currentUser.uid));
  assertCloudReadScope(scope);
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
  const readScopeToken=captureCloudReadScope();
  await validateUser();
  assertCloudReadScope(readScopeToken);
  const sessionGeneration=syncSessionGeneration,sessionUid=currentUser?.uid,sessionBusiness=activeBusinessId(),
    assertPullSession=()=>{assertCloudReadScope(readScopeToken);if(sessionGeneration!==syncSessionGeneration||sessionUid!==currentUser?.uid||sessionBusiness!==activeBusinessId())throw Object.assign(Error('A sessão mudou durante a leitura. Nenhum cursor foi avançado.'),{code:'sync-session-retired'});};
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
        (!crmSources.has(name) || window.OperationMode?.can?.("viewCRM") !== false) &&
        canPullSource(name),
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
      readScope = name==='sales' ? salesReadScope() : null,
      scopeChanged = Boolean(readScope && pullState[`${markerKey}:readScope`]!==readScope),
      completeRead = full || INITIAL_FULL_NAMES.has(name) || scopeChanged,
      since = full || scopeChanged ? "" : pullState[markerKey] || "",
      documents = await syncStep("downloading_changes", async () => since
        ? await repositories[name].listChangedSince(since, 500)
        : completeRead
          ? await repositories[name].listAllPaged(200)
          : await repositories[name].listRecent(
              INITIAL_RECENT_LIMITS[name] || 100,
              { force: true },
            ), { service: "Firestore", collection: name, businessId, request: since ? "listChangedSince" : completeRead ? "listAllPaged" : "listRecent" });
    assertPullSession();
    const metadata = repositories[name].getLastReadMetadata?.();
    rememberSnapshotMetadata(name, metadata);
    if (name === "clients") rememberCanonicalClients(documents, metadata);
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
      state.cloudFinancial = {...state.cloudFinancial,...cloudDebtSummary(documents)};
    pendingApplications.push({
      name,
      documents,
      options: { authoritative: !since },
    });
    if(name==='catalogOrders'&&canPullSource('productVariants')){
      // Resume reservation state only for affected variable products. Never
      // turn bootstrap into a global variants scan or one listener per item.
      const parentIds=new Set(documents.flatMap(o=>(o.items||[]).filter(i=>i.variantId).map(i=>i.productId)));
      const variants=[];
      for(const id of parentIds){variants.push(...await repositories.productVariants.listWherePaged('parentProductId',id));assertPullSession();}
      if(variants.length)pendingApplications.push({name:'productVariants',documents:variants,options:{authoritative:true}});
    }
    // Nunca avance o cursor usando o relógio do aparelho. Um celular com hora
    // adiantada poderia ignorar para sempre documentos gravados pelo servidor.
    pullState[markerKey] = newestTimestamp(documents) || since || "";
    // Read-policy upgrades must fetch older store sales even when the old
    // per-actor cursor is newer. Only the read cursor changes, never the queue.
    if(readScope)pullState[`${markerKey}:readScope`]=readScope;
  }
  assertPullSession();
  received = await syncStep("persisting_cloud_snapshot", async () => { const result = applyCloudCollectionBatch(pendingApplications); await DB.flush?.(); assertPullSession(); return result; }, { service: "IndexedDB", database: "veconi-local-records", store: "records", collections: names, documents: documentsRead });
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
  await syncStep("saving_pull_cursor", async () => { assertPullSession();writePullState(pullState);await DB.flush?.();assertPullSession(); }, { service: "IndexedDB" });
  if (full) lastFullPullForAudit = {businessId, sessionScope:namespace(), entries: pendingApplications};
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
  const readScopeToken=captureCloudReadScope();
  await validateUser();
  assertCloudReadScope(readScopeToken);
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
  assertCloudReadScope(readScopeToken);
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
    assertCloudReadScope(readScopeToken);
    const metadata = repositories.clients.getLastReadMetadata?.();
    rememberSnapshotMetadata("clients", metadata);
    rememberCanonicalClients(documents, metadata);
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
async function readCanonicalClient(clientId, options = {}) {
  const readScopeToken=captureCloudReadScope();
  const id = String(clientId || "").trim();
  if (!id)
    throw Object.assign(new Error("CustomerId não informado."), {
      code: "invalid-argument",
      stage: "customer-id",
    });
  if (!currentUser)
    throw Object.assign(new Error("Usuário não autenticado."), {
      code: "unauthenticated",
      stage: "session",
    });
  if (!canPullSource("clients"))
    throw Object.assign(new Error("Sem permissão para ler clientes."), {
      code: "permission-denied",
      stage: "permission",
    });
  const businessId = activeBusinessId(),
    path = `businesses/${businessId}/clients/${id}`,
    localClient = (DB.carregar().clientes || []).find(
      (item) => String(item.id) === id,
    );
  if (pendingIds("clients").has(id))
    throw Object.assign(
      new Error("O cliente possui uma alteração local aguardando sincronização."),
      { code: "pending-client-write", stage: "pending-write", path, businessId, customerId: id },
    );
  const confirmed = !options.force && recentCanonicalClientSnapshot(businessId, id, localClient);
  if (confirmed) {
    console.info("[CHARGE] cloud path/query", {
      businessId,
      customerId: id,
      path,
      query: "recent-server-snapshot",
    });
    console.info("[CHARGE] response", {
      exists: true,
      source: "recent-server-snapshot",
      fromCache: false,
    });
    return {
      client: localClient,
      confirmation: { ...confirmed, path, fromCache: false },
    };
  }
  if (!navigator.onLine)
    throw Object.assign(
      new Error("Não há snapshot recente confirmado pelo servidor."),
      { code: "offline-unconfirmed", stage: "offline", path, businessId, customerId: id },
    );
  console.info("[CHARGE] cloud path/query", {
    businessId,
    customerId: id,
    path,
    query: "getDocFromServer",
  });
  try {
    await validateUser();
    assertCloudReadScope(readScopeToken);
  } catch (error) {
    error.stage ||= "session-validation";
    error.path ||= path;
    error.businessId ||= businessId;
    error.customerId ||= id;
    throw error;
  }
  let snapshot;
  try {
    snapshot = await getDocFromServer(doc(db, "businesses", businessId, "clients", id));
    assertCloudReadScope(readScopeToken);
  } catch (error) {
    error.stage ||= "client-document-read";
    error.path ||= path;
    error.businessId ||= businessId;
    error.customerId ||= id;
    throw error;
  }
  console.info("[CHARGE] response", {
    exists: snapshot.exists(),
    source: "server-document",
    fromCache: Boolean(snapshot.metadata?.fromCache),
  });
  if (!snapshot.exists())
    throw Object.assign(new Error("Cliente não encontrado na nuvem."), {
      code: "not-found",
      stage: "client-document-read",
      path,
      businessId,
      customerId: id,
    });
  const remote = normalizeFirestoreData({ id: snapshot.id, ...snapshot.data() }),
    balance = Number(remote.saldo);
  if (remote.businessId && String(remote.businessId) !== businessId)
    throw Object.assign(new Error("BusinessId do cliente não corresponde à empresa atual."), {
      code: "business-mismatch",
      stage: "client-document-validate",
      path,
      businessId,
      customerId: id,
    });
  if (!Number.isFinite(balance))
    throw Object.assign(new Error("O cliente não possui saldo canônico válido."), {
      code: "canonical-balance-missing",
      stage: "client-document-validate",
      path,
      businessId,
      customerId: id,
    });
  const metadata = {
    collection: "clients",
    source: "server",
    fromCache: Boolean(snapshot.metadata?.fromCache),
    hasPendingWrites: Boolean(snapshot.metadata?.hasPendingWrites),
    documents: 1,
    readAt: now(),
  };
  if (activeBusinessId() !== businessId || !canPullSource("clients") || pendingIds("clients").has(id))
    throw Object.assign(new Error("A sessão ou o cliente mudou durante a confirmação."), { code: "pending-client-write", stage: "canonical-read-race" });
  if (metadata.fromCache || metadata.hasPendingWrites)
    throw Object.assign(new Error("O servidor não confirmou este saldo."), { code: "offline-unconfirmed", stage: "canonical-metadata" });
  rememberSnapshotMetadata("clients:charge-confirmation", metadata);
  rememberCanonicalClients([remote], metadata);
  if (options.persistProjection !== false) applyCloudCollection("clients", [remote], { authoritative: true });
  const canonical = (DB.carregar().clientes || []).find(
    (item) => String(item.id) === id,
  );
  return {
    client: options.persistProjection === false ? remote : canonical || remote,
    confirmation: {
      businessId,
      clientId: id,
      balance: roundedMoney(balance),
      financialVersion: financialVersionOf(remote),
      updatedAt: remote.updatedAt || remote.atualizadoEm || "",
      readAt: metadata.readAt,
      source: "server-document",
      path,
      fromCache: false,
    },
  };
}
// Operational progress stays in IndexedDB. Only explicit confirmations reach Firestore.
async function publishConfirmedMessage(event) {
  const session = await validateUser(), businessId = activeBusinessId();
  const assertAccess = () => {
    if (event.businessId !== businessId || activeBusinessId() !== businessId ||
        event.actorUid !== session.user.uid || currentUser?.uid !== session.user.uid)
      throw Object.assign(new Error("A conta da sequência mudou."), { code: "permission-denied" });
    if (!window.Mensagens?.canSend?.())
      throw Object.assign(new Error("Seu acesso não permite registrar mensagens."), { code: "permission-denied" });
  };
  assertAccess();
  if (event.status !== "sent_confirmed" || event.confirmedByUser !== true || !event.sequenceId ||
      !event.id || !event.operationId || !event.customerId || !Number.isFinite(Date.parse(event.sentAt)))
    throw Object.assign(new Error("Confirmação de envio inválida."), { code: "invalid-argument" });
  const reference = doc(db, "businesses", businessId, "messageHistory", event.id);
  const clientRef = doc(db, "businesses", businessId, "clients", event.customerId);
  await runTransaction(db, async transaction => {
    assertAccess();
    const prior = await transaction.get(reference);
    if (prior.exists()) {
      if (prior.data().operationId !== event.operationId || prior.data().customerId !== event.customerId)
        throw Object.assign(new Error("Identificador de envio já utilizado."), { code: "already-exists" });
      if (prior.data().status === 'sent_confirmed') return;
      if (event.legacyEventId !== event.id || prior.data().status !== 'opened_whatsapp' || prior.data().sequenceId !== event.sequenceId)
        throw Object.assign(new Error("Este evento não pode ser confirmado pela sequência."), { code: "failed-precondition" });
    }
    const clientSnapshot = event.type === "charge" ? await transaction.get(clientRef) : null;
    assertAccess();
    if (clientSnapshot && !clientSnapshot.exists())
      throw Object.assign(new Error("Cliente não encontrado na nuvem."), { code: "not-found" });
    transaction.set(reference, sanitizeForFirestore(event));
    if (clientSnapshot) {
      // Never write saldo, sales, payments, or updatedAt of the financial projection.
      const previous = normalizeFirestoreData(clientSnapshot.data());
      if (!previous.lastChargeAt || Date.parse(previous.lastChargeAt) <= Date.parse(event.sentAt))
        transaction.update(clientRef, { businessId, lastChargeAt: event.sentAt, lastChargeMessageId: event.id });
      transaction.set(doc(db, "businesses", businessId, "charges", event.legacyChargeId || event.id), sanitizeForFirestore({
        ...event, id: event.legacyChargeId || event.id, messageId: event.id, clienteId: event.customerId, clienteNome: event.clientName,
        valorCobrado: event.amountAtSend, mensagem: event.finalMessage, data: event.sentAt
      }));
    }
  });
  if (activeBusinessId() === businessId && currentUser?.uid === session.user.uid)
    await safePublishSyncSignal(event.type === 'charge' ? ['messageHistory', 'charges', 'clients'] : ['messageHistory']);
  return { id: event.id };
}
async function queryClientsPage(options = {}) {
  const readScopeToken=captureCloudReadScope();
  await validateUser();
  assertCloudReadScope(readScopeToken);
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
    assertCloudReadScope(readScopeToken);
    rememberCanonicalClients(result.items, result.metadata);
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
  assertCloudReadScope(readScopeToken);
  rememberCanonicalClients(result.items, result.metadata);
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
    type = item.subtipo==='pagamento_duplicado_revertido'&&item.duplicatePaymentId
      ? "payment_reversal" : "balance_adjustment";
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
    sourceCollection: type==='payment_reversal'?"payments":name,
    sourceDocumentId: type==='payment_reversal'?String(item.duplicatePaymentId):sourceDocumentId,
    operationId,
    effectId: balanceEffectId(type, type==='payment_reversal'?String(item.duplicatePaymentId):sourceDocumentId),
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
async function compareDeviceWithCloud(options = {}) {
  const generation=syncSessionGeneration,uid=currentUser?.uid,scope=namespace();
  const current=()=>generation===syncSessionGeneration&&uid===currentUser?.uid&&uid===auth.currentUser?.uid&&scope===namespace();
  state.integrityStatus = "checking";
  state.integrityFailure = null;
  try {
    const result = await syncStep("orphan_comparison", () => performDeviceComparison(options), {service: "Firestore"});
    await DB.flush?.();
    if(!current())throw Object.assign(Error('A sessão da auditoria foi substituída.'),{code:'sync-session-retired'});
    emit({integrityStatus: "completed", integrityFailure: null});
    return result;
  } catch (error) {
    if(!current())throw error;
    console.error("[SYNC INTEGRITY ERROR]", error.syncDetail);
    // The optional audit must not rewrite the result/timestamp of data transfer.
    emit({integrityStatus: "failed", integrityFailure: error.syncDetail});
    throw error;
  }
}
async function performDeviceComparison(options = {}) {
  await validateUser();
  if (!navigator.onLine)
    throw Object.assign(new Error("A comparação precisa de conexão com a internet."), {
      code: "network-request-failed",
    });
  const businessId = activeBusinessId(),
    generation=syncSessionGeneration,uid=currentUser?.uid,scope=namespace(),
    assertAuditSession=()=>{if(generation!==syncSessionGeneration||uid!==currentUser?.uid||uid!==auth.currentUser?.uid||businessId!==activeBusinessId()||scope!==namespace())throw Object.assign(Error('A sessão da auditoria foi substituída.'),{code:'sync-session-retired'});},
    allowed=name=>typeof window.TeamAccess?.has==='function'&&canPullSource(name)===true,
    data = DB.carregar(),
    queue = readQueue(),
    collections = {},
    raw = {},skippedCollections=[],
    prefetchedEntries=options.prefetched?.businessId===businessId&&options.prefetched.sessionScope===scope?options.prefetched.entries:[];
  const protectedNames={products:'productFinancials',productVariants:'variantFinancials',sales:'saleFinancials'},projections={};
  for(const [publicName,name] of Object.entries(protectedNames)){
    assertAuditSession();
    if(!allowed(name)){skippedCollections.push({name,reason:'permission_scope'});continue;}
    const prefetched=prefetchedEntries.find(entry=>entry.name===name);
    const remoteItems=prefetched?prefetched.documents:await syncStep('orphan_comparison',()=>repositories[name].listAllPaged(200),{service:'Firestore',collection:name,businessId,request:'listAllPaged'});
    assertAuditSession();
    const localItems=sourceItems(data,name);
    projections[publicName]={localFinancial:new Map(localItems.map(x=>[String(x.id),x])),remoteFinancial:new Map(remoteItems.map(x=>[String(x.id),x]))};
    raw[name]={localItems,remoteItems};
    collections[name]=classifyCollectionAudit(name,localItems,remoteItems,queue);
  }
  for (const name of AUDIT_NAMES) {
    assertAuditSession();
    if(!allowed(name)){skippedCollections.push({name,reason:'permission_scope'});continue;}
    const localItems = sourceItems(data, name),
      remoteItems = prefetchedEntries.some(entry => entry.name === name)
        ? prefetchedEntries.find(entry => entry.name === name).documents
        : await syncStep("orphan_comparison", () => repositories[name].listAllPaged(200), {service: "Firestore", collection: name, businessId, request: "listAllPaged"});
    assertAuditSession();
    raw[name] = { localItems, remoteItems };
    collections[name] = classifyCollectionAudit(
      name,
      localItems,
      remoteItems,
      queue,
      projections[name],
    );
  }
  // A ledger audit needs all its sources. Missing authorization is not an empty
  // ledger, a zero balance, a remote absence, or permission to repair anything.
  const financialCompanyScope=window.BusinessContext?.get?.();
  const fullFinancialScope=financialCompanyScope?.role==='owner'||financialCompanyScope?.spaceAccess==='all';
  const financialAudited=fullFinancialScope&&allowed('payments')&&['clients','sales','payments','balanceAdjustments'].every(name=>Boolean(raw[name]));
  const remoteFinancialEffects = financialAudited
      ? await syncStep("orphan_comparison", () => financialEffectsRepository.listAllPaged(200), {service: "Firestore", collection: "balanceEvents", businessId, request: "listAllPaged"})
      : [];
  assertAuditSession();
  if(!financialAudited)skippedCollections.push({name:'balanceEvents',reason:allowed('payments')?!fullFinancialScope?'partial_space_scope':'incomplete_authorized_sources':'permission_scope'});
  const balanceAudit = financialAudited?buildFinancialBalanceAudit(raw, remoteFinancialEffects):null;
  const balanceScope=financialAudited?window.IntegrityAudit.balanceScope(data.clientes,raw.clients.remoteItems):null,
    localBalance = financialAudited?(data.clientes || []).reduce(
      (total, client) => total + Number(client.saldo || 0),
      0,
    ):null,
    remoteBalance = financialAudited?raw.clients.remoteItems.reduce(
      (total, client) => total + Number(client.saldo || 0),
      0,
    ):null,
    summarize = (names) => {
      names=names.filter(name=>collections[name]);
      return {
      status:names.length?'audited':'not_audited',
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
    };},
    report = {
      generatedAt: now(),
      businessId,
      deviceId: deviceId(),
      collections,
      auditScope:{auditedCollections:Object.keys(collections),skippedCollections,financialAudited},
      products: summarize(["products", "productVariants"]),
      clients: summarize(["clients"]),
      financial: financialAudited?{
        ...summarize(["sales", "payments", "balanceAdjustments"]),
        localBalance:balanceScope.localActiveBalance,
        remoteBalance:balanceScope.remoteActiveBalance,
        balanceDifference: Number((balanceScope.localActiveBalance-balanceScope.remoteActiveBalance).toFixed(2)),
        localBalanceIncludingHistory:localBalance,
        remoteBalanceIncludingHistory:remoteBalance,
        balanceDifferenceIncludingHistory:Number((localBalance-remoteBalance).toFixed(2)),
        balanceScope,
        balanceContributions: window.IntegrityAudit.balanceContributions(data.clientes,raw.clients.remoteItems),
        possibleDuplicates: [
          ...collections.sales.possibleDuplicates.local,
          ...collections.payments.possibleDuplicates.local,
          ...collections.balanceAdjustments.possibleDuplicates.local,
          ...collections.sales.possibleDuplicates.remote,
          ...collections.payments.possibleDuplicates.remote,
          ...collections.balanceAdjustments.possibleDuplicates.remote,
        ],
        balanceAudit,
      }:{status:'not_audited',reason:allowed('payments')&&!fullFinancialScope?'partial_space_scope':allowed('payments')?'incomplete_authorized_sources':'permission_scope',message:allowed('payments')&&!fullFinancialScope?'Reconciliação financeira global não auditada: este perfil acessa apenas alguns espaços.':'Financeiro não auditado neste perfil'},
      queue: queueCounts(),
      integrity: window.IntegrityAudit.severity(collections,balanceAudit),
      fixtureCleanup: data.localFixtureCleanup || null,
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
      (report.collections.sales?.onlyLocal||[]).map((item) => String(item.documentId))));
  } catch (error) { console.warn("[Only-local audit cache]", error?.message || error); }
  emit({ dataAudit: report });
  updateQueueState();
  return report;
}
function queueOperationDiagnostic(item) {
  const sales = (item.payload?.writes || []).filter((write) => write.entityType === "sales"),
    cleanMessage = (value) => String(value || "").slice(0, 800)
      .replace(/https?:\/\/[^\s]+/gi, "[URL removida]")
      .replace(/[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}/g, "[e-mail removido]")
      .replace(/\bBearer\s+[^\s]+/gi, "Bearer [removido]")
      .replace(/\b(token|password|senha|secret|authorization)\s*[:=]\s*[^\s,;]+/gi, "$1=[removido]");
  return {
    businessId: String(item.businessId || ""),
    operationUserId: String(item.userId || ""),
    eventKind: String(item.payload?.eventKind || item.subtype || ""),
    lastAttemptAt: item.lastAttemptAt || null,
    lastErrorPath: item.lastErrorPath || null,
    lastErrorCode: String(item.lastErrorCode || ""),
    lastErrorMessage: cleanMessage(item.lastErrorMessage),
    diagnostic: queueSettingsDiagnostic(item),
    lastErrorStage: item.lastErrorStage || null,
    lastErrorRequest: item.lastErrorRequest || null,
    transactionPaths: item.lastErrorPaths || [],
    reviewRequired: Boolean(queueManualReviewReason(item)) && !readQueueArchive(item) && !readRecoveryResolution(item),
    resolution: readRecoveryResolution(item),
    reviewState: readRecoveryResolution(item) ? "resolved" : readQueueArchive(item) ? "archived" : queueQuarantineReason(item) ? "quarantined" : (saleQueueRequiresReview(item) ? "manual_review" : null),
    reviewReason: queueQuarantineReason(item) || null,
    archive: readQueueArchive(item),
    // Older queues did not persist the first failure. Never label creation or
    // the last attempt as the first failure, nor change the queue to export it.
    firstFailureAt: item.firstFailureAt || item.firstFailedAt || null,
    firstFailureRecorded: Boolean(item.firstFailureAt || item.firstFailedAt),
    sales: sales.map((write) => ({
      saleId: String(write.entityId || ""),
      operationId: String(write.data?.operationId || item.operationId || ""),
      businessId: String(write.data?.businessId || item.businessId || ""),
      spaceId: write.data?.spaceId || null,
      actorUid: write.data?.actorUid || null,
      actorRoleSnapshot: write.data?.actorRoleSnapshot || null,
    })),
  };
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
    diagnosticVersion: 6,
    operationalProtocol: structuredClone(state.operationalProtocol||{status:'not_verified'}),
    remoteReadRefresh: structuredClone(state.remoteReadRefresh||{pending:0,status:'idle'}),
    generatedAt: now(),
    build: window.AdiFestaBuild || null,
    bootstrap: {state: window.FirebaseBootstrap?.state || "unknown",
      authenticated: window.FirebaseBootstrap?.authenticated === true,
      warning: window.FirebaseBootstrap?.details?.warning || null,
      syncWarning: window.FirebaseBootstrap?.details?.syncWarning || null},
    projectId: PROJECT_ID,
    businessId,
    uid: currentUser?.uid
      ? `${currentUser.uid.slice(0, 6)}…${currentUser.uid.slice(-4)}`
      : "—",
    role: profile.role || "",
    auth: {authenticated: Boolean(currentUser), profileActive: profile.active === true},
    schemaVersion: 3,
    deviceId: deviceId(),
    indexedDb: await indexedDbInventory(),
    storage: await DB.businessCache?.diagnostic?.(),
    member: {status: window.BusinessContext?.get?.().member?.status || "unknown", spaceAccess: window.BusinessContext?.get?.().member?.spaceAccess || "unknown"},
    technicalIdentity: {
      uid: currentUser?.uid || "",
      role: window.BusinessContext?.get?.().role || profile.role || "",
      permissions: [...(window.BusinessContext?.get?.().permissions || [])],
      allowedSpaceIds: [...(window.BusinessContext?.get?.().allowedSpaceIds || [])],
      spaceAccess: window.BusinessContext?.get?.().spaceAccess || "unknown",
    },
    localCounts: Object.fromEntries(
      Object.entries(entities).map(([name, items]) => [name, items.length]),
    ),
    queueCounts: queueCounts(),
    syncFailure: state.syncFailure,
    syncFailureHistory: structuredClone(state.syncFailureHistory),
    sessionTrace: structuredClone(state.sessionTrace),
    syncTrace: state.syncTrace,
    integrityStatus: state.integrityStatus,
    integrityFailure: state.integrityFailure,
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
      status: readRecoveryResolution(item) ? "resolved" : readQueueArchive(item) ? "archived" : queueQuarantineReason(item) ? "quarantined" : item.status || "pending",
      originalStatus: item.status || "pending",
      errorCode: item.lastErrorCode || "",
      errorMessage: queueOperationDiagnostic(item).lastErrorMessage,
      technical: queueOperationDiagnostic(item),
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
    remoteResolutions = new Map((audit.raw.balanceAdjustments?.remoteItems || [])
      .filter((item) => item.resolutionStatus === "resolved_by_reconciliation" && item.resolvedSaleId)
      .map((item) => [String(item.resolvedSaleId), item])),
    products = new Map((local.produtos || []).map((product) => [String(product.id), product])),
    ids = audit.report.collections.sales.onlyLocal.map((item) => String(item.documentId));
  return ids.map((saleId) => {
    const sale = (local.vendas || []).find((item) => String(item.id) === saleId);
    if (!sale) return { saleId, classification: "E", recoveryMode: "", reason: "Venda não encontrada no armazenamento local." };
    const operationId = String(sale.operationId || ""),
      clientId = String(sale.clienteId || sale.customerId || ""),
      client = clients.get(clientId), remoteClient = remoteClients.get(clientId),
      review = readOrphanReviews()[saleId],
      resolution = remoteResolutions.get(saleId),
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
    if (resolution && String(resolution.resolvedOperationId || "") !== operationId) {
      classification = "E"; recoveryMode = "";
      reason = "Existe uma reconciliação remota incompatível com a operação local; revisão técnica obrigatória.";
    } else if (resolution) {
      classification = "E"; recoveryMode = "";
      reason = "Operação antiga conciliada manualmente; não será sincronizada nem cobrada novamente.";
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
      classification, recoveryMode, reason, resolved: Boolean(resolution),
      resolutionId: resolution?.id || "", resolutionStatus: resolution?.resolutionStatus || "",
      reconciledBalanceBefore: resolution?.saldoAnterior ?? null,
      reconciledBalanceAfter: resolution?.saldoNovo ?? null,
      reconciledAt: resolution?.resolvedAt || resolution?.createdAt || "",
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
async function invokeFinancialMaintenance(command, payload) {
  await validateUser();
  if (!currentUser || readOnlyMode || !navigator.onLine || !["owner","admin"].includes(String(state.userProfile?.role||"")))
    throw Object.assign(Error("A manutenção exige proprietário/administrador e conexão."),{code:"permission-denied"});
  const generation=syncSessionGeneration,uid=currentUser.uid,businessId=activeBusinessId(),scope=namespace();
  const assertCurrent=()=>{if(generation!==syncSessionGeneration||uid!==currentUser?.uid||uid!==auth.currentUser?.uid||businessId!==activeBusinessId()||scope!==namespace())
    throw Object.assign(Error("A sessão mudou. O resultado pertence ao namespace original."),{code:"sync-session-retired"});};
  const response=await window.FirebaseCallable("commitFinancialMaintenance",{...payload,command,confirmed:true,businessId,workspaceGeneration:DB.getWorkspaceGeneration?.()??0});
  assertCurrent();
  const result=response.data??response,targets=[["clients",result.clientId],["sales",result.saleId],["payments",result.duplicatePaymentId],["balanceAdjustments",result.adjustmentId]],batch=[];
  for(const [name,id]of targets){if(!id)continue;const snap=await getDocFromServer(doc(db,"businesses",businessId,name,id));assertCurrent();if(snap.exists())batch.push({name,documents:[cleanCloudItem({id,...snap.data()})],options:{authoritative:true}});}
  assertCurrent();if(batch.length)applyCloudCollectionBatch(batch);
  if(['reconcile_only_local_balance','recover_only_local_sale'].includes(command)&&result.businessId===businessId&&result.workspaceGeneration===(DB.getWorkspaceGeneration?.()??0)&&/^[a-f0-9]{64}$/.test(result.auditHash||'')&&result.resolvedByUid===uid&&result.resolvedAt){
    for(const item of readQueueStrict()){
      const sales=(item.payload?.writes||[]).filter(w=>w.entityType==='sales'&&w.operation==='create');
      if(item.userId!==uid||item.businessId!==businessId||item.operationId!==(result.originalOperationId||result.operationId)||sales.length!==1||sales[0].entityId!==result.saleId)continue;
      localStorage.setItem(recoveryResolutionKey(item),JSON.stringify({channel:'financial_maintenance',status:'resolved',operationId:item.operationId,saleId:result.saleId,businessId,spaceId:sales[0].data.spaceId,actorUid:item.userId,workspaceGeneration:item.workspaceGeneration??0,payloadChecksum:checksumValue(item.payload),auditHash:result.auditHash,resolutionId:result.operationId,resolvedByUid:uid,resolvedAt:result.resolvedAt}));
    }
  }
  return result;
}
async function reconcileOnlyLocalSaleBalance(saleId, correctOpenDebt, reason) {
  await compareDeviceWithCloud();
  const id=String(saleId||""),preview=onlyLocalSaleReport().find(v=>v.saleId===id),sale=(DB.carregar().vendas||[]).find(v=>String(v.id)===id),debt=Number(correctOpenDebt);
  if(!preview||!sale||!Number.isFinite(debt)||debt<0||String(reason||"").trim().length<5)throw Error("Reveja a venda, o saldo e o motivo antes de confirmar.");
  automaticRecoveryBackup();
  const result=await invokeFinancialMaintenance("reconcile_only_local_balance",{sale,clientId:String(sale.clienteId||sale.customerId||""),operationId:legacyReconciliationOperationId(id),expectedBalance:preview.remoteCurrentBalance,expectedFinancialVersion:preview.remoteFinancialVersion,targetBalance:debt===0?0:-roundedMoney(debt),reason:String(reason).trim()});
  // Original packet, checksum, attempts and namespace stay untouched. The
  // canonical adjustment fences replay, rather than deleting a local queue.
  const reviews=readOrphanReviews();
  reviews[id]={saleId:id,operationId:sale.operationId,checksum:checksumValue(sale),decision:"resolved_by_reconciliation",resolutionId:result.operationId,reason:String(reason).trim(),reviewedAt:now(),reviewedBy:currentUser.uid};
  localStorage.setItem(orphanReviewKey(),JSON.stringify(reviews));
  return {...result,originalOperationId:sale.operationId,correctOpenDebt:Math.abs(Math.min(0,result.balanceAfter))};
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
        .filter((item) => item.classification === "B" && item.category !== "confirmed_legacy_fixture")
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
  await compareDeviceWithCloud();
  const id=String(saleId||""),sale=(DB.carregar().vendas||[]).find(v=>String(v.id)===id),preview=onlyLocalSaleReport().find(v=>v.saleId===id),audit=currentAuditOrThrow();
  if(!sale||!preview||preview.resolved||preview.classification!=="A"||!preview.recoveryMode)throw Error("A recuperação exige evidência individual válida e não resolvida.");
  const client=(audit.raw.clients?.remoteItems||[]).find(c=>String(c.id)===String(sale.clienteId||sale.customerId));
  if(!client&&(sale.clienteId||sale.customerId||sale.formaPagamento==='fiado'))throw Error("Confirme o cliente na nuvem antes da recuperação.");
  automaticRecoveryBackup();
  const result=await invokeFinancialMaintenance("recover_only_local_sale",{sale,operationId:sale.operationId,clientId:client?.id||null,expectedBalance:Number(client?.saldo||0),expectedFinancialVersion:financialVersionOf(client||{})});
  await compareDeviceWithCloud();return result;
}
async function reconcileFinancialBalances() {
  await compareDeviceWithCloud();
  const audit=currentAuditOrThrow(),balanceAudit=audit.report.financial.balanceAudit;
  if(!audit.report.auditScope.financialAudited)throw Error("Reconciliação exige todas as fontes financeiras autorizadas da empresa.");
  if(audit.report.products.onlyLocal||audit.report.clients.onlyLocal)throw Error("Confirme primeiro os cadastros ausentes.");
  const repairs=[...(balanceAudit?.safeRepairs||[]),...(balanceAudit?.effectBackfills||[])],applied=[],blocked=[];
  const backupId=repairs.length?automaticRecoveryBackup():null;
  for(const repair of repairs){
    const client=(audit.raw.clients.remoteItems||[]).find(c=>String(c.id)===repair.clientId);
    const operationId=`balance-reconcile:${checksumValue({businessId:activeBusinessId(),clientId:repair.clientId,latestOperationId:repair.latestOperationId,expectedBalance:repair.expectedBalance}).slice(-8)}`;
    try{const result=await invokeFinancialMaintenance("reconcile_balances",{operationId,clientId:repair.clientId,expectedBalance:repair.actualBalance,expectedFinancialVersion:financialVersionOf(client),targetBalance:repair.expectedBalance,effectIds:repair.missingEffects.map(e=>e.effectId)});
      applied.push({clientId:repair.clientId,reconciliationId:operationId,expectedBalance:result.balanceAfter,effects:result.effects,idempotent:result.idempotent});
    }catch(error){if(error.code==="sync-session-retired")throw error;blocked.push({clientId:repair.clientId,code:errorCode(error),message:String(error.message||"Não confirmado.").slice(0,240)});}
  }
  return{backupCreated:!!backupId,backupId,applied,blocked,comparison:await compareDeviceWithCloud()};
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
async function cleanupConfirmedLegacyFixtures(prefetched) {
  if(window.BusinessContext?.get?.().role!=='owner'||!originalAlter||prefetched?.businessId!==activeBusinessId())return;
  await DB.flush?.();
  const remote=Object.fromEntries(prefetched.entries.map(entry=>[entry.name,entry.documents]));
  const plan=window.IntegrityAudit.fixtureCleanupPlan(DB.carregar(),remote,readQueue(),checksumValue,activeBusinessId());
  if(!plan.rows.length)return;
  // Exact verified legacy demo only; bypass change capture, never queue deletes.
  // Preserve originals and all message selections/history in the same IDB commit.
  originalAlter(data=>{
    data.localFixtureQuarantine ||= [];
    for(const row of plan.rows){
      data.localFixtureQuarantine.push({id:`${row.entityType}:${row.document.id}`,entityType:row.entityType,document:row.document,quarantinedAt:now(),reason:'verified_legacy_demo_v157'});
      data[row.key]=data[row.key].filter(item=>item.id!==row.document.id);
    }
    data.localFixtureCleanup={version:157,at:now(),removed:plan.rows.map(row=>({entityType:row.entityType,documentId:row.document.id})),blocked:plan.blocked,cloudWrites:0,originalsPreserved:true,messageHistoryPreserved:true};
  });
  await DB.flush?.();
  traceSync('legacy_fixture_quarantine',{removed:plan.rows.length,cloudWrites:0,service:'IndexedDB'});
}
async function compareLocalAndCloud() {
  const local = localSummary(),
    remote = {
      clients: state.cloudCounts.clients ?? 0,
      products: state.cloudCounts.products ?? 0,
      sales: state.cloudCounts.sales ?? 0,
      payments: state.cloudCounts.payments ?? 0,
      fiado: Number(state.cloudFinancial.fiado || 0),
      historicalFiado: Number(state.cloudFinancial.historicalFiado || 0),
      fiadoIncludingHistory: Number(state.cloudFinancial.fiadoIncludingHistory ?? state.cloudFinancial.fiado ?? 0),
    };
  const checks={clients:local.clientes===remote.clients,products:local.produtos===remote.products,
      sales:local.vendas===remote.sales,payments:local.pagamentos===remote.payments},
    auditedCollections=Object.keys(checks).filter(name=>canPullSource(name)),
    financialAudited=canPullSource('payments')&&canPullSource('clients'),
    countsMatch=auditedCollections.every(name=>checks[name]),
    balancesMatch = !financialAudited || Math.abs(local.fiado - remote.fiado) < 0.01,
    comparison = {
      local,
      remote,
      scope:{collections:auditedCollections,financialAudited},
      countsMatch,
      balancesMatch,
      ok: queueCounts().active === 0 && countsMatch && balancesMatch,
      newestByCollection: { ...state.cloudNewest },
    };
  emit({ comparison });
  return comparison;
}
function describeSyncResult(result = {}) {
  if (result.offline)
    return "Sem conexão. As alterações continuam salvas neste aparelho.";
  if (result.syncFailure)
    return "Há uma falha ativa de sincronização. Veja os detalhes.";
  const pending = Number(result.pending || 0),
    errors = Number(result.errors || 0),
    sent = Number(result.sent || 0);
  if(result.dataSynced&&result.integrityStatus==='failed')return 'Dados sincronizados. Não foi possível concluir a verificação de integridade; veja os detalhes.';
  if(result.dataSynced&&result.integrity?.actionable)return `Sincronizado com sucesso. ${result.integrity.level==='CRITICO'?'Integridade crítica':'Integridade requer atenção'}: veja os registros e motivos. Nenhum reparo financeiro foi aplicado.`;
  if (!pending && !errors && !result.manualReview && !result.syncFailure &&
      (!result.comparison || result.comparison.ok) && (result.quarantined || result.archived))
    return preservedQueueMessage({active:0,quarantined:result.quarantined,archived:result.archived});
  if (result.dataSynced && result.comparison && !result.comparison.ok)
    return "Dados atualizados. A comparação de integridade identificou diferenças; veja os detalhes antes de qualquer correção.";
  if(result.complete)return result.integrity?.level==='INFORMATIVO'?'Sincronizado com sucesso. Alguns registros históricos foram analisados.':'Todos os dados estão sincronizados.';
  if(!pending&&!errors&&result.manualReview)return `Revisão manual — confirmação pendente. ${result.manualReview} ocorrência(s) preservada(s), sem reenvio automático.`;
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
function synchronizeNow(options = {}) {
  if (manualSyncPromise) return manualSyncPromise;
  const readScopeToken=captureCloudReadScope();
  const task = (async () => {
    if (automaticSyncPromise) await automaticSyncPromise;
    assertCloudReadScope(readScopeToken);
    state.syncFailure = null;
    state.syncTrace = [];
    traceSync("manual_sync_started", {authenticated: Boolean(auth.currentUser), online: navigator.onLine});
    try { return await syncStep("manual_sync", () => runManualSync(options)); }
    catch(error) { if(readScopeToken===captureCloudReadScope())reportError(error, "Manual sync"); throw error; }
  })().finally(() => { if(manualSyncPromise===task)manualSyncPromise = null; });
  manualSyncPromise=task;
  return task;
}
async function runManualSync({manualRetry = false} = {}) {
  const readScopeToken=captureCloudReadScope();
  const attemptTime = now();
  writeSyncTime(lastAttemptKey(), attemptTime);
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
  emit({status: "syncing", message: "Sincronizando dados…"});
  await syncStep("auth_state", validateUser);
  assertCloudReadScope(readScopeToken);
  const context = window.BusinessContext?.get?.() || {};
  traceSync("member_state", {businessId: activeBusinessId(), role: context.role || "unknown", status: context.member?.status || "unknown", spaceAccess: context.member?.spaceAccess || "unknown"});
  if (!state.testPassed) await testFirestoreConnection();
  assertCloudReadScope(readScopeToken);
  await DB.flush?.();
  assertCloudReadScope(readScopeToken);
  const migration = await syncStep("queue_migration", migrateScopedQueueCompatibility, {service: "IndexedDB"});
  assertCloudReadScope(readScopeToken);
  await syncStep("queue_ownership", validateQueueOwnership);
  assertCloudReadScope(readScopeToken);
  traceSync("queue_state", queueCounts());
  const push = await syncStep("uploading_changes", () => processSyncQueue({ force: true, manualRetry }), {service: "Firestore"});
  assertCloudReadScope(readScopeToken);
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
  const received = await syncStep("downloading_changes", () => pullCloudCollections({ force: true, full: true }));
  assertCloudReadScope(readScopeToken);
  await cleanupConfirmedLegacyFixtures(lastFullPullForAudit);
  assertCloudReadScope(readScopeToken);
  const comparison = await compareLocalAndCloud();
  assertCloudReadScope(readScopeToken);
  const
    counts = queueCounts(),
    complete = counts.active === 0 && counts.errors === 0 && !state.syncFailure,
    time = now(),
    result = {
      ...push,
      migration,
      received,
      comparison,
      pending: counts.pending,
      errors: counts.errors,
      queueTotal: counts.active,
      quarantined: counts.quarantined,
      archived: counts.archived,
      manualReview: counts.manualReview - counts.quarantined,
      syncFailure: state.syncFailure || null,
      complete,
      dataSynced: counts.active === 0 && counts.errors === 0,
      attemptedAt: attemptTime,
    };
  if (push.sent || counts.errors)
    await safePublishSyncSignal(push.collections, counts.errors ? "error" : "ok");
  assertCloudReadScope(readScopeToken);
  if (result.dataSynced) writeSyncTime(lastSyncKey(), time);
  if (complete) writeSyncTime(lastCompleteKey(), time);
  await DB.flush?.();
  assertCloudReadScope(readScopeToken);
  lastError = ""; lastErrorCode = "";
  traceSync("data_sync_completed", {dataSynced: result.dataSynced, countSummariesMatch: comparison.ok, sent: push.sent, received});
  emit({
    status: result.syncFailure || counts.errors ? "error" : complete ? "success" : "waiting",
    message: describeSyncResult(result),
    lastSync: result.dataSynced ? time : state.lastSync,
    lastCompleteSync: complete ? time : state.lastCompleteSync,
    lastAttempt: attemptTime,
    progress: 100,
    sent: push.sent,
    received,
  });
  // Manual audit only. Reuse this pull's server documents; never add a listener
  // or an automatic full financial audit on each background sync.
  if (result.dataSynced) {
    try {
      const audit=await compareDeviceWithCloud({prefetched: lastFullPullForAudit});
      assertCloudReadScope(readScopeToken);
      result.integrity=audit.integrity;
      result.integrityStatus = "completed";
    } catch {
      assertCloudReadScope(readScopeToken);
      result.integrityStatus = "failed";
    }
    emit({status:result.syncFailure?'error':result.integrity?.actionable?'waiting':'success',message:describeSyncResult(result)});
    traceSync("completed", {dataSynced: true, integrityStatus: result.integrityStatus,integrityLevel:result.integrity?.level||'unknown',integrityMatches:result.integrity?!result.integrity.actionable:null});
  }
  return result;
}
async function runAutomaticSync() {
  quickTimer = null;
  if (!currentUser || !navigator.onLine || processingPromise || manualSyncPromise || cloudPaused)
    return;
  const readScopeToken=captureCloudReadScope();
  window.AppBootDiagnostics?.count?.("initialSyncCount");
  try {
    if (!state.testPassed) await testFirestoreConnection();
    assertCloudReadScope(readScopeToken);
    const push = await syncStep("automatic_upload", () => processSyncQueue());
    assertCloudReadScope(readScopeToken);
    const projection =
        document.visibilityState === "visible"
          ? await syncStep("client_projection", () => ensureClientProjection())
          : null;
    assertCloudReadScope(readScopeToken);
    const received =
        document.visibilityState === "visible"
          ? await pullCloudCollections({
              names: projection?.repaired
                ? DEFAULT_PULL_NAMES.filter((name) => name !== "clients")
                : undefined,
            })
          : 0;
    assertCloudReadScope(readScopeToken);
    if (push.sent || push.errors)
      await safePublishSyncSignal(push.collections, push.errors ? "error" : "ok");
    assertCloudReadScope(readScopeToken);
    if (push.sent || received || projection?.repaired) {
      const time = now(),
        counts = queueCounts(),
        complete = counts.active === 0 && counts.errors === 0 && !state.syncFailure;
      writeSyncTime(lastAttemptKey(), time);
      if (complete) {
        writeSyncTime(lastSyncKey(), time);
        writeSyncTime(lastCompleteKey(), time);
      }
      await DB.flush?.();
      assertCloudReadScope(readScopeToken);
      emit({
        status: state.syncFailure ? "error" : complete ? "success" : counts.errors ? "error" : "waiting",
        message: state.syncFailure ? describeSyncResult({syncFailure:state.syncFailure}) : complete
          ? preservedQueueMessage(counts) || "Todos os dados estão sincronizados."
          : describeSyncResult({
              sent: push.sent,
              pending: counts.pending,
              errors: counts.errors,
              manualReview: counts.manualReview-counts.quarantined,
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
    if(readScopeToken!==captureCloudReadScope())return;
    if (errorCode(error) === "resource-exhausted") cloudPaused = true;
    reportError(error, "Automatic sync");
  }
}
function automaticSync() {
  if (automaticSyncPromise) return automaticSyncPromise;
  const task = runAutomaticSync().finally(() => {
    if(automaticSyncPromise===task)automaticSyncPromise = null;
  });
  automaticSyncPromise=task;
  return task;
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
  const client=(DB.carregar().clientes||[]).find(c=>String(c.id)===String(options.clientId));
  if(!client)throw Error("Cliente não carregado para revisão.");
  automaticRecoveryBackup();
  return invokeFinancialMaintenance("reverse_duplicate_payment",{operationId:`duplicate-payment-reversal:${options.duplicatePaymentId}`,clientId:String(options.clientId||""),legitimatePaymentId:String(options.legitimatePaymentId||""),duplicatePaymentId:String(options.duplicatePaymentId||""),expectedBalance:Number(options.expectedBalance),targetBalance:Number(options.targetBalance),expectedFinancialVersion:financialVersionOf(client),reason:String(options.reason||"duplicate_payment_from_stale_projection")});
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
function setUser(user, profile = null, business = null, {reason = "session_update"} = {}) {
  const previousUid = currentUser?.uid || "";
  let pendingBefore = null;
  try { pendingBefore = queueCounts().total; } catch { /* Diagnostic only. Never modify the queue. */ }
  syncSessionGeneration++;
  state.operationalProtocol={status:'not_verified'};
  state.remoteReadRefresh={pending:0,status:'idle'};
  processingPromise = null; // The retired promise is fenced; it must not own the next identity's queue.
  automaticSyncPromise=null;manualSyncPromise=null;
  // Diagnostics are memory-only and must not be exposed to the next account.
  if (user && previousUid !== user.uid) {
    state.syncFailureHistory = (state.syncFailureHistory || []).filter(entry => entry.actorUid === user.uid);
    state.sessionTrace = (state.sessionTrace || []).filter(entry => entry.actorUid === user.uid);
  }
  if (user) { lastError = ""; lastErrorCode = ""; currentPath = ""; }
  state.sessionTrace = [...(state.sessionTrace || []), {at: now(),
    event: user ? "session_started" : "session_stopped", reason,
    actorUid: user?.uid || previousUid, authUid: auth.currentUser?.uid || "",
    businessId: profile?.businessId || state.userProfile?.businessId || "",
    sessionGeneration: syncSessionGeneration, pendingBefore}].slice(-10);
  currentUser = user || null;
  state.userProfile = profile || null;
  canonicalClientSnapshots.clear();
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
    status: user ? "waiting" : "idle",
    message: user ? "Preparando sincronização…" : "Sessão encerrada",
    authReady: true,
    userProfile: profile || null,
    businessDocument: trustedBootstrap,
    businessOwnerId: business?.ownerId || "",
    ownerMatches: Boolean(user && business?.ownerId === user.uid),
    testPassed: trustedBootstrap,
    dataAudit: null,
    syncFailure: null,
    syncTrace: [],
    integrityStatus: "not_checked",
    integrityFailure: null,
    snapshotMetadata: {},
    clientProjection: null,
    lastSync: profile?.businessId
      ? readSyncTime(lastSyncKey(), `adiFesta:${profile.businessId}:lastSync`)
      : "",
    lastAttempt: profile?.businessId
      ? readSyncTime(lastAttemptKey(), `adiFesta:${profile.businessId}:lastSyncAttempt`)
      : "",
    lastCompleteSync: profile?.businessId
      ? readSyncTime(lastCompleteKey(), `adiFesta:${profile.businessId}:lastCompleteSync`)
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
  migrateOwnerBusinessQueue();
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

function pendingActivityEvents() {
  const prefixes = {
      sales: "sale",
      payments: "payment",
      balanceAdjustments: "balance",
      stockMovements: "stock",
      campaignEvents: "campaign",
      customerSubscriptionEvents: "renewal",
      catalogOrders: "order",
    },
    events = new Map();
  for (const queued of readQueue()) {
    if (isHistoricalProjectionBatch(queued)) continue;
    for (const write of queued.payload?.writes || []) {
      const prefix = prefixes[write.entityType],
        entityId = String(write.entityId || "");
      if (!prefix || !entityId) continue;
      const eventId = `${prefix}:${entityId}`,
        failed = queued.status === "error";
      events.set(eventId, {
        eventId,
        operationId: String(
          write.data?.operationId || queued.operationId || "",
        ),
        status: failed ? "error" : "pending",
      });
    }
  }
  return [...events.values()];
}

function subscribeRecentActivityEvents(callback, onError, max = 100) {
  const generation=syncSessionGeneration,uid=currentUser?.uid,subscription=++activitySubscriptionGeneration;
  let stopped=false;
  const current=()=>!stopped&&generation===syncSessionGeneration&&uid===currentUser?.uid&&subscription===activitySubscriptionGeneration;
  activityEventsCursor = null;
  activityEventsHasMore = false;
  let additionalPages = 0,
    received = false;
  const stop = activityEventsRepository.subscribeRecent(
    (items, metadata, page) => {
      if(!current())return;
      if (!received || additionalPages === 0) {
        activityEventsCursor = page?.cursor || null;
        activityEventsHasMore = Boolean(page?.hasMore);
      }
      received = true;
      callback?.(items, metadata, {
        hasMore: activityEventsHasMore,
        initialLimit: Math.max(1, Number(max) || 100),
      });
    },
    error=>{if(current())onError?.(error);},
    Math.max(1, Math.min(100, Number(max) || 100)),
  );
  const wrapped = () => {
    const ownsState=current();
    stopped=true;
    stop?.();
    if(ownsState){activityEventsCursor = null;activityEventsHasMore = false;}
  };
  wrapped.loadMore = async (pageSize = 50) => {
    if(!current())return{items:[],hasMore:false};
    if (!activityEventsHasMore || !activityEventsCursor)
      return { items: [], hasMore: false };
    const page = await activityEventsRepository.listPage(
      activityEventsCursor,
      Math.max(1, Math.min(100, Number(pageSize) || 50)),
    );
    if(!current())return{items:[],hasMore:false};
    activityEventsCursor = page.cursor;
    activityEventsHasMore = page.hasMore;
    additionalPages++;
    return { items: page.items, hasMore: page.hasMore };
  };
  return wrapped;
}
function restartCloudReadsIfScopeChanged() {
  if(!currentUser||!cloudReadController)return;
  if(cloudReadController.scope===captureCloudReadScope())return;
  clearTimeout(cloudReadRestartTimer);
  cloudReadRestartTimer=setTimeout(()=>{
    cloudReadRestartTimer=null;
    const context=window.BusinessContext?.get?.()||{};
    if(currentUser&&context.businessId===activeBusinessId()&&auth.currentUser?.uid===currentUser.uid)
      startCloudSubscriptions();
  },0);
}
addEventListener('business-context-changed',restartCloudReadsIfScopeChanged);
addEventListener('veconi-space-context-changed',restartCloudReadsIfScopeChanged);
addEventListener('veconi-spaces-ready',restartCloudReadsIfScopeChanged);
addEventListener("online", () => {
  emit({ status: "waiting", message: "Conexão recuperada. Sincronizando…" });
  scheduleImmediate();
});
addEventListener("offline", updateQueueState);
window.AppLifecycle?.onResume?.(() => scheduleImmediate());

window.FirestoreRepositories = repositories;
window.dataRepository = repositories;
window.getFirebaseDiagnostic = diagnostic;
// A payment recovery checks the server before applying the canonical local sale.
// Never replay stock/campaign effects when that operation already exists remotely.
async function readIntegratedSale(intent, { flush = false } = {}) {
  if (!currentUser || !navigator.onLine || intent.businessId !== activeBusinessId())
    throw Error("Conecte-se à empresa do pagamento para concluir a venda.");
  if (flush) await processSyncQueue({ force: true });
  const snapshot = await getDocFromServer(doc(db, "businesses", activeBusinessId(), "sales", intent.saleId));
  if (intent.businessId !== activeBusinessId()) throw Error("A empresa ativa mudou. Retome o pagamento na empresa original.");
  if (!snapshot.exists()) return null;
  const sale = cleanCloudItem({ id: snapshot.id, ...snapshot.data() });
  if (sale.paymentIntentId !== intent.id || sale.operationId !== intent.finalizationOperationId)
    throw Error("A venda existente não corresponde ao pagamento. Revisão necessária.");
  applyCloudCollection("sales", [sale], { authoritative: true });
  return sale;
}
async function readOnlineOrderSale(order,{flush=false}={}){
  if(!currentUser||!navigator.onLine||order.businessId!==activeBusinessId())throw Error('Conecte-se à empresa do pedido para concluir a venda.');
  if(flush)await processSyncQueue({force:true});
  const snapshot=await getDocFromServer(doc(db,'businesses',activeBusinessId(),'sales',order.saleId));
  if(order.businessId!==activeBusinessId())throw Error('A empresa ativa mudou. Retome o pedido na empresa original.');
  if(!snapshot.exists())return null;
  const sale=cleanCloudItem({id:snapshot.id,...snapshot.data()});
  if(sale.onlineOrderId!==order.id||sale.operationId!==order.finalizationOperationId)throw Error('Venda diferente do pedido. Revisão necessária.');
  applyCloudCollection('sales',[sale],{authoritative:true});return sale;
}
window.SyncFirebase = {
  getPermissionProtocol: () => verifiedProtocolSession===JSON.stringify([syncSessionGeneration,currentUser?.uid,activeBusinessId(),DB.getWorkspaceGeneration?.()??0])&&currentUser?.uid===auth.currentUser?.uid
    ? structuredClone(state.operationalProtocol||{status:'not_verified'}) : {status:'not_verified'},
  applyOnlineOrderResult: order => {
    if (!order || order.businessId !== activeBusinessId() || order.source !== 'online_store') throw Error('Pedido de outra empresa.');
    applyCloudCollection('catalogOrders', [order], {authoritative:true});
  },
  refreshOnlineOrderStock: async order => {
    if (!currentUser || order.businessId !== activeBusinessId() || !navigator.onLine) throw Error('Conecte-se à empresa do pedido.');
    const products = [], variants = [];
    for (const id of new Set(order.items.map(i=>i.productId))) {
      const snap = await getDocFromServer(doc(db,'businesses',order.businessId,'products',id));
      if (snap.exists()) products.push({id:snap.id,...snap.data()});
    }
    // Canonical ProductVariations.recomputeInData needs ALL sibling variations,
    // not just the one ordered; otherwise a partial cache could corrupt the parent total.
    for (const id of new Set(order.items.filter(i=>i.variantId).map(i=>i.productId)))
      variants.push(...await repositories.productVariants.listWherePaged('parentProductId',id));
    if (order.businessId !== activeBusinessId()) throw Error('A empresa ativa mudou.');
    applyCloudCollection('products',products,{authoritative:true});
    if (variants.length) applyCloudCollection('productVariants',variants,{authoritative:true});
  },
  readIntegratedSale,
  readOnlineOrderSale,
  setUser,
  setAuthReady: (value) => emit({ authReady: Boolean(value) }),
  stop: ({reason = "runtime_stop"} = {}) => setUser(null, null, null, {reason}),
  subscribe: (callback) => {
    subscribers.add(callback);
    const details = diagnostic();
    callback({
      ...state,
      ...queueCounts(),
      queueTotal: queueCounts().active,
      preservedOccurrences: queueCounts().quarantined,
      archivedOccurrences: queueCounts().archived,
      manualReviewPending: queueCounts().manualReview-queueCounts().quarantined,
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
  archiveQuarantinedOperation,
  getRetainedSaleRecoveryCount: () => readQueue().filter(item=>saleQueueRequiresReview(item)&&item.userId===currentUser?.uid&&item.businessId===activeBusinessId()&&(item.workspaceGeneration??0)===DB.getWorkspaceGeneration()).length,
  // Read-only recovery source. Never normalize, acknowledge or save this queue.
  recoverySnapshot: () => {
    const packets=readQueue().filter(item=>saleQueueRequiresReview(item)&&item.userId===currentUser?.uid&&item.businessId===activeBusinessId()&&(item.workspaceGeneration??0)===DB.getWorkspaceGeneration()),data=DB.carregar(),ids=new Set(packets.flatMap(p=>p.payload.writes.filter(w=>w.entityType==='sales').map(w=>w.entityId))),operations=new Set(packets.map(p=>p.operationId));
    return structuredClone({identity:{uid:currentUser?.uid||'',businessId:activeBusinessId(),workspaceGeneration:DB.getWorkspaceGeneration()},packets,local:{vendas:(data.vendas||[]).filter(s=>ids.has(s.id)),movimentacoesEstoque:(data.movimentacoesEstoque||[]).filter(m=>operations.has(m.operationId)||ids.has(m.vendaId))}});
  },
  describeResult: describeSyncResult,
  describeError: friendlyError,
  migrateQueueCompatibility: migrateScopedQueueCompatibility,
  processSyncQueue,
  createSaleOperation,
  createPaymentOperation,
  assertSaleTracked,
  prepareSaleCustomer,
  assertCustomerForSale,
  assertPaymentTracked,
  isSalePending,
  prepareCustomerForSale,
  confirmCreditSale,
  confirmSaleUndo,
  synchronizeNow,
  syncAll: synchronizeNow,
  pushPendingOperations: processSyncQueue,
  pullCloudCollections,
  readCanonicalClient,
  publishConfirmedMessage,
  ensureClientProjection,
  queryClientsPage,
  queryAllClientsForAction,
  queryClientsByInactivity,
  queryCustomerSubscriptions,
  loadProductVariants,
  findProductVariantByBarcode,
  pendingActivityEvents,
  subscribeRecentActivityEvents,
  compare: compareLocalAndCloud,
  compareDeviceWithCloud,
  exportLocalDiagnostic,
  downloadJsonFile,
  onlyLocalSaleReport,
  recoverOnlyLocalSale,
  reconcileOnlyLocalSaleBalance,
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
