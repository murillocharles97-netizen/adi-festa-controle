const enabled=()=>localStorage.getItem('adiFestaDevMetrics')==='1'||location.hostname==='localhost'||location.hostname==='127.0.0.1';
const startedAt=new Date().toISOString();
const state={startedAt,screen:'bootstrap',reads:0,writes:0,queries:0,errors:0,activeListeners:0,peakListeners:0,totalLatencyMs:0,operations:[],byScreen:{}};

function bucket(screen=state.screen){
  return state.byScreen[screen]||=( {reads:0,writes:0,queries:0,errors:0,latencyMs:0,operations:0} );
}
function remember(entry){
  state.operations.push({...entry,screen:state.screen,at:new Date().toISOString()});
  if(state.operations.length>250)state.operations.splice(0,state.operations.length-250);
}
export function setUsageScreen(screen){state.screen=String(screen||'unknown')}
export function recordFirestoreOperation(type,{collection='unknown',documents=0,durationMs=0,source='server',error=null}={}){
  const target=bucket(),count=Math.max(0,Number(documents)||0),latency=Math.max(0,Number(durationMs)||0);
  state.queries++;target.queries++;target.operations++;state.totalLatencyMs+=latency;target.latencyMs+=latency;
  if(type==='read'||type==='listen'){state.reads+=count;target.reads+=count}
  if(type==='write'){state.writes+=Math.max(1,count);target.writes+=Math.max(1,count)}
  if(error){state.errors++;target.errors++}
  remember({type,collection,documents:count,durationMs:Math.round(latency),source,error:error?String(error.code||error.message||error):null});
  if(enabled())console.debug('[Firebase usage]',state.operations.at(-1));
}
export function listenerOpened(collection){
  state.activeListeners++;state.peakListeners=Math.max(state.peakListeners,state.activeListeners);remember({type:'listener_open',collection,documents:0,durationMs:0,source:'realtime'});
}
export function listenerClosed(collection){
  state.activeListeners=Math.max(0,state.activeListeners-1);remember({type:'listener_close',collection,documents:0,durationMs:0,source:'realtime'});
}
export function usageSnapshot(){
  return structuredClone({...state,averageLatencyMs:state.queries?Math.round(state.totalLatencyMs/state.queries):0,enabled:enabled()});
}
export function resetUsageMetrics(){
  Object.assign(state,{startedAt:new Date().toISOString(),reads:0,writes:0,queries:0,errors:0,activeListeners:0,peakListeners:0,totalLatencyMs:0,operations:[],byScreen:{}});
}

window.FirebaseUsageMonitor={snapshot:usageSnapshot,reset:resetUsageMetrics,setEnabled(value){localStorage.setItem('adiFestaDevMetrics',value?'1':'0')},isEnabled:enabled};
