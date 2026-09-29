// Loaded ONLY by audit-business-cache-v156.cjs, before extracted production code.
// Network responses are synthetic; merge, batching, persistence and cursor code
// are the unmodified functions extracted from js/firebase/sync.js by the test.
var SOURCES={clients:{key:'clientes'},products:{key:'produtos'},sales:{key:'vendas'},payments:{key:'pagamentos'},balanceAdjustments:{key:'movimentacoes'}};
var CLOUD_NAMES=Object.keys(SOURCES),DEFAULT_PULL_NAMES=CLOUD_NAMES,INITIAL_FULL_NAMES=new Set(CLOUD_NAMES),INITIAL_RECENT_LIMITS={},PULL_TTL_MS=0,CLIENT_PROJECTION_EPOCH=2;
var originalAlter=DB.alterar.bind(DB),applyingCloud=false,lastPullAt=0,lastFullPullForAudit=null;
var state={syncTrace:[],cloudCounts:{},cloudNewest:{},cloudFinancial:{}},remote={},networkCalls=[];
var repositories=Object.fromEntries(CLOUD_NAMES.map(name=>[name,{
  listAllPaged:async()=>{networkCalls.push([name,'full']);return structuredClone(remote[name]||[])},
  listChangedSince:async since=>{networkCalls.push([name,'incremental',since]);return structuredClone((remote[name]||[]).filter(row=>(row.updatedAt||row.data||'')>since))},
  getLastReadMetadata:()=>({fromCache:false,hasPendingWrites:false})
}]));
var validateUser=async()=>{},canPullSource=()=>true,activeBusinessId=()=>DB.getBusinessId(),errorCode=e=>e.code||'',pendingIds=()=>new Set();
var normalizeFirestoreData=x=>structuredClone(x),now=()=>new Date().toISOString(),emit=patch=>Object.assign(state,patch);
var rememberSnapshotMetadata=()=>{},rememberCanonicalClients=()=>{},clientProjectionKeys=()=>({epoch:'epoch',checkedAt:'checkedAt',remoteCount:'remoteCount',projectedCount:'projectedCount'});
var newestTimestamp=rows=>rows.map(row=>row.updatedAt||row.data||'').sort().at(-1)||'';
var sourceItems=(data,name)=>data[SOURCES[name].key]||[];
var cursorKey=()=>`adiFesta:${DB.getBusinessId()}:qa:cursor`;
var readPullState=()=>JSON.parse(DB.businessCache.keyValue.getItem(cursorKey())||'{}');
var writePullState=value=>DB.businessCache.keyValue.setItem(cursorKey(),JSON.stringify(value));
