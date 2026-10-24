import { auth, db } from "./firebase-config.js";
import {
  collection,
  and,
  or,
  doc,
  documentId,
  endAt,
  getCountFromServer,
  getDoc,
  getDocFromServer,
  getDocs,
  getDocsFromServer,
  limit,
  onSnapshot,
  orderBy,
  query as firebaseQuery,
  serverTimestamp,
  setDoc,
  startAfter,
  startAt,
  Timestamp,
  where,
} from "./workspace-firestore.js";
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
const query=(reference,...constraints)=>{
  const filters=constraints.filter(c=>['where','and','or'].includes(c.type)),rest=constraints.filter(c=>!['where','and','or'].includes(c.type));
  return firebaseQuery(reference,...(filters.length>1?[and(...filters)]:filters),...rest);
};
const cacheKey = (businessId, collectionName, variant) => {
  const uid=auth.currentUser?.uid||"anonymous",
    permissionSignature=window.BusinessContext?.get?.().permissionSignature||"none";
  const scope=window.BusinessContext?.get?.()||{};
  return `${businessId}:${uid}:${permissionSignature}:${scope.spaceAccess}:${(scope.allowedSpaceIds||[]).join(',')}:store-sales-v2:${collectionName}:${variant}`;
};
const repositoryScopeKey=()=>cacheKey(requireBusinessId(),'session','visibility');
const visibilityConstraints = (collectionName,spaceIds=null) => {
  if(collectionName==='products'){
    const context=window.BusinessContext?.get?.()||{};
    if(context.role==='owner')return [];
    if(context.spaceAccess==='all')return [where('businessId','==',requireBusinessId()),where('spaceAccessMode','in',['all_spaces','selected_spaces','single_space'])];
    const ids=(spaceIds||context.allowedSpaceIds||[]).slice(0,14);
    return [where('businessId','==',requireBusinessId()),or(where('spaceAccessMode','==','all_spaces'),and(where('spaceAccessMode','in',['selected_spaces','single_space']),where('allowedSpaceIds','array-contains-any',ids.length?ids:['__no_authorized_space__'])))];
  }
  if(['catalogOrders','stockMovements','sales','activityEvents'].includes(collectionName)){
    const context=window.BusinessContext?.get?.()||{};
    if(context.role==='owner')return [];
    const ids=spaceIds||(context.spaceAccess==='all'?(window.SpaceContext?.salesSpaces?.()||[]).map(s=>s.id):context.allowedSpaceIds||[]);
    if(ids.length>30)throw Error('Consulta de pedidos requer paginação por espaço para mais de 30 espaços autorizados.');
    const filters=[where('spaceId','in',ids.length?ids:['__no_authorized_space__'])];
    if(window.TeamAccess?.has?.('sales.viewAll')===false){
      const operational=window.TeamAccess?.canReadOperationalSales?.()===true;
      if(collectionName==='activityEvents')filters.push(operational
        ?or(where('type','==','sale'),where('actorUid','==',requireUser().uid))
        :where('actorUid','==',requireUser().uid));
      else if(collectionName==='sales'&&!operational)filters.push(where('actorUid','==',requireUser().uid));
    }
    return filters;
  }
  if(['payments','balanceAdjustments','balanceEvents','paymentAllocations','charges'].includes(collectionName)){
    const context=window.BusinessContext?.get?.()||{};
    if(context.role==='owner')return [];
    const ids=spaceIds||(context.spaceAccess==='all'?(window.SpaceContext?.salesSpaces?.()||[]).map(s=>s.id):context.allowedSpaceIds||[]);
    if(ids.length>30)throw Error('Consulta financeira requer divisão por espaços autorizados.');
    return [where('spaceId','in',ids.length?ids:['__no_authorized_space__'])];
  }
  return [];
};
// A history OR doubles Firestore's disjunction count. Keep each bounded query
// within 30 alternatives while preserving all authorized spaces and pagination.
const activityGroups=()=>{
  const c=window.BusinessContext?.get?.()||{};
  if(c.role==='owner'||window.TeamAccess?.has?.('sales.viewAll')!==false||window.TeamAccess?.canReadOperationalSales?.()!==true)return null;
  const ids=c.spaceAccess==='all'?(window.SpaceContext?.salesSpaces?.()||[]).map(s=>s.id):c.allowedSpaceIds||[];
  return ids.length>15?Array.from({length:Math.ceil(ids.length/15)},(_,i)=>ids.slice(i*15,(i+1)*15)):null;
};
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
  // Variants inherit the parent's scope. Query per bounded parent group rather
  // than downloading a global variants collection and filtering it in the UI.
  const readVisible = async (constraints,{reader=getDocsFromServer,sort='__name__',direction='asc',max=null}={}) => {
    const context=window.BusinessContext?.get?.()||{};
    const scopeKey=repositoryScopeKey(),assertScope=()=>{if(scopeKey!==repositoryScopeKey())throw Error('A empresa, sessão ou permissão ativa mudou.');};
    const merge=docs=>{
      assertScope();const unique=[...new Map(docs.map(d=>[d.id,d])).values()],val=d=>sort==='__name__'?d.id:d.data()[sort]?.toMillis?.()??d.data()[sort];
      unique.sort((a,b)=>{const x=val(a),y=val(b);return ((x<y?-1:x>y?1:0)*(direction==='desc'?-1:1))||a.id.localeCompare(b.id);});
      const selected=max?unique.slice(0,max):unique;return {docs:selected,size:selected.length,metadata:{fromCache:false,hasPendingWrites:false}};
    };
    const groups=collectionName==='activityEvents'?activityGroups():null;
    if(groups){
      const docs=[],extra=constraints.slice(visibilityConstraints(collectionName).length);
      for(const group of groups){assertScope();docs.push(...(await reader(query(collectionRef(),...visibilityConstraints(collectionName,group),...extra))).docs);}
      return merge(docs);
    }
    if(collectionName==='products'&&context.role!=='owner'&&context.spaceAccess!=='all'&&(context.allowedSpaceIds||[]).length>14){
      const docs=[],extra=constraints.slice(visibilityConstraints(collectionName).length),ids=context.allowedSpaceIds;
      for(let i=0;i<ids.length;i+=14){assertScope();const snap=await reader(query(collectionRef(),...visibilityConstraints(collectionName,ids.slice(i,i+14)),...extra));docs.push(...snap.docs);}
      return merge(docs);
    }
    if(!['productVariants','productFinancials','variantFinancials','saleFinancials','stockMovementFinancials'].includes(collectionName)||context.role==='owner'){const snap=await reader(query(collectionRef(),...constraints));assertScope();return snap;}
    const related={variantFinancials:['productVariants','variantId'],saleFinancials:['sales','saleId'],stockMovementFinancials:['stockMovements','stockMovementId']}[collectionName];
    let ids,field;
    if(related){ids=(await createFirestoreRepository(related[0]).listAllPaged(100)).map(v=>v.id);field=related[1];}
    else {ids=(await createFirestoreRepository('products').listAllPaged(200)).map(p=>p.id);field=collectionName==='productFinancials'?'productId':'parentProductId';}
    const docs=[];
    for(let i=0;i<ids.length;i+=4){const group=ids.slice(i,i+4);const snap=await reader(query(collectionRef(),where(field,'in',group),...constraints));docs.push(...snap.docs);}
    return merge(docs);
  };
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
      if(collectionName==='products'&&window.BusinessContext?.get?.()?.role!=='owner')return (await this.listAllPaged()).length;
      if(['productVariants','productFinancials','variantFinancials','saleFinancials','stockMovementFinancials'].includes(collectionName)&&window.BusinessContext?.get?.()?.role!=='owner')return (await this.listAllPaged()).length;
      const snapshot = await timed("read", `${collectionName}:count`, async () => {
        const aggregate = await getCountFromServer(query(collectionRef(), ...visibilityConstraints(collectionName)));
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
        readVisible(visibilityConstraints(collectionName),{reader:getDocs}),
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
    async getSaleStatusFromServer(id) {
      if (collectionName !== "sales") throw Error("History status requires a sale.");
      const scopeKey = repositoryScopeKey();
      const snapshot = await timed("read", "sales:history-status", () =>
        getDocFromServer(documentRef(id)),
      );
      if (scopeKey !== repositoryScopeKey()) throw Error("A sessão ou permissão mudou durante a leitura.");
      const sale = convert(snapshot);
      if (!sale) return null;
      // UI-only status projection, including logical tombstones; no financial data.
      return Object.fromEntries([
        "id", "businessId", "spaceId", "financialSpaceId", "workspaceGeneration",
        "active", "deletedAt", "cancelledAt", "canceledAt", "status", "applicationStatus",
      ].filter((key) => key in sale).map((key) => [key, sale[key]]));
    },
    async listWhere(field, value, max = 100, options = {}) {
      const variant = `where:${field}:${String(value)}:${max}`;
      const key = cacheKey(requireBusinessId(), collectionName, variant);
      const hit = !options.force && cached(key);
      if (hit) return hit;
      const snapshot = await timed("read", collectionName, () =>
        readVisible([...visibilityConstraints(collectionName),where(field,'==',value),limit(max)],{reader:getDocs,max}),
      );
      return cachePut(
        key,
        snapshot.docs
          .map((item) => convert(item))
          .filter((item) => !item.deletedAt),
      );
    },
    async listWherePaged(field, value, max = 100) {
      const businessId=requireBusinessId(),uid=requireUser().uid,reference=collectionRef(),items=[];
      let cursor=null;
      do {
        if(requireBusinessId()!==businessId||requireUser().uid!==uid)throw Error('A empresa ou sessão ativa mudou.');
        const constraints=[...visibilityConstraints(collectionName),where(field,'==',value),orderBy(documentId()),limit(max)];
        if(cursor)constraints.push(startAfter(cursor));
        const snapshot=rememberMetadata(await timed('read',collectionName,()=>readVisible(constraints,{max})),'server');
        if(requireBusinessId()!==businessId||requireUser().uid!==uid)throw Error('A empresa ou sessão ativa mudou.');
        items.push(...snapshot.docs.map(convert));
        cursor=snapshot.size===max?snapshot.docs.at(-1):null;
      } while(cursor);
      return items;
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
        readVisible([...visibilityConstraints(collectionName),orderBy('createdAt','desc'),limit(max)],{sort:'createdAt',direction:'desc',max}),
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
      const readCursor=value=>readVisible([...visibilityConstraints(collectionName),where('updatedAt','>=',value),orderBy('updatedAt','asc'),limit(max)],{sort:'updatedAt',max});
      const snapshot=rememberMetadata(await timed('read',collectionName,()=>readCursor(Timestamp.fromDate(new Date(since)))),'server');
      // Compatibility read only for legacy order dates, without rewriting old
      // documents or changing the global Timestamp contract. No new listener.
      const legacy=collectionName==='catalogOrders'?await timed('read',collectionName,()=>readCursor(new Date(since).toISOString())):null;
      const unique=new Map([...snapshot.docs,...(legacy?.docs||[])].map(d=>[d.id,convert(d)]));
      if(legacy)lastReadMetadata={...lastReadMetadata,documents:unique.size};
      return [...unique.values()].sort((a,b)=>new Date(a.updatedAt)-new Date(b.updatedAt));
    },
    async listPage(cursor = null, max = 50) {
      const constraints = [...visibilityConstraints(collectionName), orderBy("createdAt", "desc")];
      if (cursor) constraints.push(startAfter(cursor));
      constraints.push(limit(max));
      const snapshot = rememberMetadata(
        await timed("read", collectionName, () =>
          readVisible(constraints,{max,sort:'createdAt',direction:'desc'}),
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
        constraints = [...visibilityConstraints(collectionName),...filters.map((item) =>
          where(String(item.field), String(item.operator || "=="), item.value),
        )];
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
          readVisible(constraints,{max,sort:orders[0].field,direction:orders[0].direction}),
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
      const scopeKey=repositoryScopeKey();
      const items = [];
      let cursor = null,
        hasMore = true;
      while (hasMore) {
        if(scopeKey!==repositoryScopeKey())throw Error('A sessão ou permissão mudou durante a leitura.');
        const constraints = [...visibilityConstraints(collectionName), orderBy(documentId())];
        if (cursor) constraints.push(startAfter(cursor));
        constraints.push(limit(max));
        const snapshot = rememberMetadata(
          await timed("read", collectionName, () =>
            readVisible(constraints,{max}),
          ),
          "server",
        );
        if(scopeKey!==repositoryScopeKey())throw Error('A sessão ou permissão mudou durante a leitura.');
        items.push(...snapshot.docs.map((item) => convert(item)));
        cursor = snapshot.docs.at(-1) || null;
        hasMore = snapshot.docs.length === max;
      }
      return items;
    },
    subscribe(callback, onError) {
      const scope=window.BusinessContext?.get?.()||{},ids=scope.allowedSpaceIds||[];
      if(collectionName==='products'&&scope.role!=='owner'&&scope.spaceAccess!=='all'&&ids.length>14){
        const groups=Array.from({length:Math.ceil(ids.length/14)},(_,i)=>ids.slice(i*14,(i+1)*14)),latest=new Map();
        const stops=groups.map((group,index)=>{listenerOpened(collectionName);return onSnapshot(query(collectionRef(),...visibilityConstraints(collectionName,group)),snap=>{recordFirestoreOperation('listen',{collection:collectionName,documents:latest.has(index)?snap.docChanges().length:snap.size});latest.set(index,snap.docs);if(latest.size===groups.length){const docs=[...new Map([...latest.values()].flat().map(d=>[d.id,d])).values()];lastReadMetadata=snapshotMetadata({size:docs.length,metadata:snap.metadata},'listener');callback(docs.map(convert),lastReadMetadata);}},onError);});
        return ()=>stops.forEach(stop=>{stop();listenerClosed(collectionName);});
      }
      if(['productFinancials','variantFinancials','saleFinancials','stockMovementFinancials'].includes(collectionName)&&window.BusinessContext?.get?.()?.role!=='owner'){
        // Restricted projections use bounded scoped refreshes, not an unsafe
        // collection-wide listener. Reuse existing app change notifications.
        let stopped=false,active=false,again=false;
        const refresh=async()=>{if(stopped)return;if(active){again=true;return;}active=true;try{const docs=await this.listAllPaged();if(!stopped)callback(docs,lastReadMetadata);}catch(error){if(!stopped)onError?.(error);}finally{active=false;if(again){again=false;refresh();}}};
        const changed=e=>{if(['products','productVariants','sales','stockMovements'].includes(e.detail?.collection))refresh();};
        addEventListener('cloud-data-updated',changed);refresh();
        return ()=>{stopped=true;removeEventListener('cloud-data-updated',changed);};
      }
      let first = true,
        opened = true;
      listenerOpened(collectionName);
      const stop = onSnapshot(
        query(collectionRef(), ...visibilityConstraints(collectionName)),
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
      const scopeKey=repositoryScopeKey();
      let stopped=false;
      const current=()=>{try{return !stopped&&scopeKey===repositoryScopeKey();}catch{return false;}};
      const groups=collectionName==='activityEvents'?activityGroups():null;
      if(groups){
        const latest=new Map(),stops=groups.map((group,index)=>{
          listenerOpened(collectionName);
          return onSnapshot(query(collectionRef(),...visibilityConstraints(collectionName,group),orderBy('createdAt','desc'),limit(max)),snapshot=>{
            if(!current())return;
            recordFirestoreOperation('listen',{collection:collectionName,documents:latest.has(index)?snapshot.docChanges().length:snapshot.size});latest.set(index,snapshot.docs);
            if(latest.size!==groups.length)return;
            const time=d=>d.data().createdAt?.toMillis?.()??new Date(d.data().createdAt).getTime(),docs=[...new Map([...latest.values()].flat().map(d=>[d.id,d])).values()].sort((a,b)=>time(b)-time(a)||b.id.localeCompare(a.id)),selected=docs.slice(0,max);
            lastReadMetadata=snapshotMetadata({size:selected.length,metadata:snapshot.metadata},'listener');
            callback(selected.map(convert),lastReadMetadata,{cursor:selected.at(-1)||null,hasMore:docs.length>=max});
          },error=>{if(current())onError?.(error);});
        });
        return()=>{stopped=true;stops.forEach(stop=>{stop();listenerClosed(collectionName);});};
      }
      let first = true,
        opened = true;
      listenerOpened(collectionName);
      const stop = onSnapshot(
        query(collectionRef(), ...visibilityConstraints(collectionName), orderBy("createdAt", "desc"), limit(max)),
        (snapshot) => {
          if(!current())return;
          recordFirestoreOperation("listen", {
            collection: collectionName,
            documents: first ? snapshot.size : snapshot.docChanges().length,
            source: first ? "initial" : "realtime",
          });
          first = false;
          lastReadMetadata = snapshotMetadata(snapshot, "listener");
          callback(snapshot.docs.map((item) => convert(item)), lastReadMetadata, {
            cursor: snapshot.docs.at(-1) || null,
            hasMore: snapshot.size === max,
          });
        },
        (error) => {
          if(!current())return;
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
        stopped=true;
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
