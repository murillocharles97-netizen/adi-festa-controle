import { auth, db } from "./firebase-config.js";
import {
  collection,
  doc,
  documentId,
  endAt,
  getCountFromServer,
  getDoc,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  setDoc,
  startAfter,
  startAt,
  Timestamp,
  where,
} from "https://www.gstatic.com/firebasejs/10.13.2/firebase-firestore.js";
import {
  normalizeFirestoreData,
  sanitizeForFirestore,
} from "./firestore-utils.js";
import {
  listenerClosed,
  listenerOpened,
  recordFirestoreOperation,
} from "./usage-monitor.js";

const queryCache = new Map(),
  CACHE_TTL_MS = 60000;
const cacheKey = (businessId, collectionName, variant) =>
  `${businessId}:${collectionName}:${variant}`;
const cached = (key) => {
  const item = queryCache.get(key);
  return item && Date.now() - item.at < CACHE_TTL_MS
    ? structuredClone(item.value)
    : null;
};
const cachePut = (key, value) => {
  queryCache.set(key, { at: Date.now(), value: structuredClone(value) });
  return value;
};
const timed = async (type, collectionName, operation) => {
  const started = performance.now();
  try {
    const result = await operation();
    recordFirestoreOperation(type, {
      collection: collectionName,
      documents: result?.size ?? (result?.exists?.() ? 1 : 0),
      durationMs: performance.now() - started,
    });
    return result;
  } catch (error) {
    recordFirestoreOperation(type, {
      collection: collectionName,
      durationMs: performance.now() - started,
      error,
    });
    throw error;
  }
};

function requireUser() {
  const user = auth.currentUser;
  if (!user)
    throw Object.assign(new Error("Usuário não autenticado."), {
      code: "unauthenticated",
    });
  return user;
}
function requireBusinessId() {
  const businessId = String(
    window.BusinessContext?.getCurrentBusinessId?.() ||
      window.FirebaseSession?.profile?.businessId ||
      "",
  ).trim();
  if (!businessId)
    throw new Error("BusinessId não definido para a conta atual.");
  return businessId;
}
export function getBusinessCollectionRef(collectionName) {
  return collection(
    db,
    "businesses",
    requireBusinessId(),
    String(collectionName),
  );
}
export function getBusinessDocumentRef(collectionName, id) {
  return doc(
    db,
    "businesses",
    requireBusinessId(),
    String(collectionName),
    String(id),
  );
}

export function createFirestoreRepository(collectionName) {
  let lastReadMetadata = null;
  const collectionRef = () => getBusinessCollectionRef(collectionName);
  const documentRef = (id) => getBusinessDocumentRef(collectionName, id);
  const snapshotMetadata = (snapshot, source = "default") => ({
    collection: collectionName,
    source,
    fromCache: Boolean(snapshot?.metadata?.fromCache),
    hasPendingWrites: Boolean(snapshot?.metadata?.hasPendingWrites),
    documents: Number(snapshot?.size ?? (snapshot?.exists?.() ? 1 : 0)),
    readAt: new Date().toISOString(),
  });
  const rememberMetadata = (snapshot, source) => {
    lastReadMetadata = snapshotMetadata(snapshot, source);
    return snapshot;
  };
  const convert = (snapshot) =>
    snapshot.exists()
      ? normalizeFirestoreData({ id: snapshot.id, ...snapshot.data() })
      : null;
  const payload = (id, data, creating = false) => {
    const user = requireUser(),
      clean = sanitizeForFirestore(data) || {};
    return {
      ...clean,
      id: String(id),
      businessId: requireBusinessId(),
      ownerId: user.uid,
      schemaVersion: 3,
      ...(creating ? { createdAt: serverTimestamp() } : {}),
      updatedAt: serverTimestamp(),
      version: Number(clean.version || 0) + 1,
    };
  };
  return {
    get path() {
      return `businesses/${requireBusinessId()}/${collectionName}`;
    },
    getLastReadMetadata() {
      return lastReadMetadata ? structuredClone(lastReadMetadata) : null;
    },
    async countFromServer() {
      const snapshot = await timed("read", `${collectionName}:count`, async () => {
        const aggregate = await getCountFromServer(collectionRef());
        return { size: 1, data: () => aggregate.data() };
      });
      lastReadMetadata = {
        collection: collectionName,
        source: "server-count",
        fromCache: false,
        hasPendingWrites: false,
        documents: 1,
        readAt: new Date().toISOString(),
      };
      return Number(snapshot.data().count || 0);
    },
    async list(options = {}) {
      const key = cacheKey(requireBusinessId(), collectionName, "all"),
        hit = !options.force && cached(key);
      if (hit) return hit;
      const snapshot = await timed("read", collectionName, () =>
        getDocs(collectionRef()),
      );
      return cachePut(
        key,
        snapshot.docs
          .map((item) => convert(item))
          .filter((item) => !item.deletedAt),
      );
    },
    async getById(id) {
      return convert(
        await timed("read", collectionName, () => getDoc(documentRef(id))),
      );
    },
    async listWhere(field, value, max = 100, options = {}) {
      const variant = `where:${field}:${String(value)}:${max}`;
      const key = cacheKey(requireBusinessId(), collectionName, variant);
      const hit = !options.force && cached(key);
      if (hit) return hit;
      const snapshot = await timed("read", collectionName, () =>
        getDocs(query(collectionRef(), where(field, "==", value), limit(max))),
      );
      return cachePut(
        key,
        snapshot.docs
          .map((item) => convert(item))
          .filter((item) => !item.deletedAt),
      );
    },
    async create(data) {
      const id = String(data.id || crypto.randomUUID());
      await timed("write", collectionName, () =>
        setDoc(documentRef(id), payload(id, data, true), { merge: true }),
      );
      queryCache.clear();
      return id;
    },
    async update(id, patch) {
      await timed("write", collectionName, () =>
        setDoc(documentRef(id), payload(id, patch), { merge: true }),
      );
      queryCache.clear();
      return id;
    },
    async set(id, data) {
      const exists = (
        await timed("read", collectionName, () => getDoc(documentRef(id)))
      ).exists();
      await timed("write", collectionName, () =>
        setDoc(documentRef(id), payload(id, data, !exists), { merge: true }),
      );
      queryCache.clear();
      return id;
    },
    async remove(id) {
      await timed("write", collectionName, () =>
        setDoc(
          documentRef(id),
          payload(id, { active: false, deletedAt: new Date().toISOString() }),
          { merge: true },
        ),
      );
      queryCache.clear();
      return id;
    },
    async listRecent(max = 100, options = {}) {
      const key = cacheKey(
          requireBusinessId(),
          collectionName,
          `recent:${max}`,
        ),
        hit = !options.force && cached(key);
      if (hit) return hit;
      const snapshot = rememberMetadata(await timed("read", collectionName, () =>
        getDocsFromServer(
          query(collectionRef(), orderBy("createdAt", "desc"), limit(max)),
        ),
      ), "server");
      return cachePut(
        key,
        snapshot.docs
          .map((item) => convert(item))
          .filter((item) => !item.deletedAt),
      );
    },
    async listChangedSince(since, max = 200) {
      if (!since) return this.list({ force: true });
      const snapshot = rememberMetadata(await timed("read", collectionName, () =>
        getDocsFromServer(
          query(
            collectionRef(),
            where("updatedAt", ">", Timestamp.fromDate(new Date(since))),
            orderBy("updatedAt", "asc"),
            limit(max),
          ),
        ),
      ), "server");
      return snapshot.docs.map((item) => convert(item));
    },
    async listPage(cursor = null, max = 50) {
      const constraints = [orderBy("createdAt", "desc")];
      if (cursor) constraints.push(startAfter(cursor));
      constraints.push(limit(max));
      const snapshot = rememberMetadata(
        await timed("read", collectionName, () =>
          getDocsFromServer(query(collectionRef(), ...constraints)),
        ),
        "server",
      );
      return {
        items: snapshot.docs
          .map((item) => convert(item))
          .filter((item) => !item.deletedAt),
        cursor: snapshot.docs.at(-1) || null,
        hasMore: snapshot.docs.length === max,
      };
    },
    async listQueryPage(options = {}) {
      const max = Math.min(50, Math.max(1, Number(options.max || 20))),
        filters = Array.isArray(options.filters) ? options.filters : [],
        orders = Array.isArray(options.orders) && options.orders.length
          ? options.orders
          : [{ field: "nomeNormalizado", direction: "asc" }],
        constraints = filters.map((item) =>
          where(String(item.field), String(item.operator || "=="), item.value),
        );
      orders.forEach((item) =>
        constraints.push(
          orderBy(String(item.field), item.direction === "desc" ? "desc" : "asc"),
        ),
      );
      if (options.prefix !== undefined && options.prefix !== null) {
        const prefix = String(options.prefix);
        if (options.cursor) constraints.push(startAfter(options.cursor));
        else constraints.push(startAt(prefix));
        constraints.push(endAt(`${prefix}\uf8ff`));
      } else if (options.cursor) constraints.push(startAfter(options.cursor));
      constraints.push(limit(max));
      const snapshot = rememberMetadata(
        await timed("read", collectionName, () =>
          getDocsFromServer(query(collectionRef(), ...constraints)),
        ),
        "server",
      );
      return {
        items: snapshot.docs
          .map((item) => convert(item))
          .filter(
            (item) =>
              !item.deletedAt && (options.includeInactive || item.active !== false),
          ),
        cursor: snapshot.docs.at(-1) || null,
        hasMore: snapshot.docs.length === max,
        documentsRead: snapshot.size,
        metadata: snapshotMetadata(snapshot, "server"),
      };
    },
    async listAllPaged(max = 200) {
      const items = [];
      let cursor = null,
        hasMore = true;
      while (hasMore) {
        const constraints = [orderBy(documentId())];
        if (cursor) constraints.push(startAfter(cursor));
        constraints.push(limit(max));
        const snapshot = rememberMetadata(
          await timed("read", collectionName, () =>
            getDocsFromServer(query(collectionRef(), ...constraints)),
          ),
          "server",
        );
        items.push(...snapshot.docs.map((item) => convert(item)));
        cursor = snapshot.docs.at(-1) || null;
        hasMore = snapshot.docs.length === max;
      }
      return items;
    },
    subscribe(callback, onError) {
      let first = true,
        opened = true;
      listenerOpened(collectionName);
      const stop = onSnapshot(
        collectionRef(),
        (snapshot) => {
          recordFirestoreOperation("listen", {
            collection: collectionName,
            documents: first ? snapshot.size : snapshot.docChanges().length,
            source: first ? "initial" : "realtime",
          });
          first = false;
          lastReadMetadata = snapshotMetadata(snapshot, "listener");
          callback(snapshot.docs.map((item) => convert(item)), lastReadMetadata);
        },
        (error) => {
          recordFirestoreOperation("listen", {
            collection: collectionName,
            error,
          });
          console.error("[Firestore listener failed]", {
            collection: collectionName,
            code: error.code,
            message: error.message,
          });
          onError?.(error);
        },
      );
      return () => {
        if (opened) {
          opened = false;
          listenerClosed(collectionName);
        }
        stop();
      };
    },
    subscribeById(id, callback, onError) {
      let first = true,
        opened = true;
      const listenerName = `${collectionName}/${String(id)}`;
      listenerOpened(listenerName);
      const stop = onSnapshot(
        documentRef(id),
        (snapshot) => {
          recordFirestoreOperation("listen", {
            collection: listenerName,
            documents: snapshot.exists() ? 1 : 0,
            source: first ? "initial" : "realtime",
          });
          first = false;
          lastReadMetadata = snapshotMetadata(snapshot, "listener");
          callback(convert(snapshot), lastReadMetadata);
        },
        (error) => {
          recordFirestoreOperation("listen", {
            collection: listenerName,
            error,
          });
          console.error("[Firestore document listener failed]", {
            collection: listenerName,
            code: error.code,
            message: error.message,
          });
          onError?.(error);
        },
      );
      return () => {
        if (opened) {
          opened = false;
          listenerClosed(listenerName);
        }
        stop();
      };
    },
    subscribeRecent(callback, onError, max = 100) {
      let first = true,
        opened = true;
      listenerOpened(collectionName);
      const stop = onSnapshot(
        query(collectionRef(), orderBy("createdAt", "desc"), limit(max)),
        (snapshot) => {
          recordFirestoreOperation("listen", {
            collection: collectionName,
            documents: first ? snapshot.size : snapshot.docChanges().length,
            source: first ? "initial" : "realtime",
          });
          first = false;
          lastReadMetadata = snapshotMetadata(snapshot, "listener");
          callback(snapshot.docs.map((item) => convert(item)), lastReadMetadata);
        },
        (error) => {
          recordFirestoreOperation("listen", {
            collection: collectionName,
            error,
          });
          console.error("[Firestore recent listener failed]", {
            collection: collectionName,
            code: error.code,
            message: error.message,
          });
          onError?.(error);
        },
      );
      return () => {
        if (opened) {
          opened = false;
          listenerClosed(collectionName);
        }
        stop();
      };
    },
    invalidate() {
      for (const key of [...queryCache.keys()])
        if (key.includes(`:${collectionName}:`)) queryCache.delete(key);
    },
  };
}
