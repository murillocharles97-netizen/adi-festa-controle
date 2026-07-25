const cleanups=new Map();

export function registerCleanup(key,cleanup){
  if(!key||typeof cleanup!=='function')return()=>{};
  const previous=cleanups.get(key);
  if(previous)try{previous()}catch(error){console.warn('[Session cleanup]',{key,code:error?.code||'cleanup-failed'})}
  cleanups.set(key,cleanup);
  return()=>{if(cleanups.get(key)===cleanup)cleanups.delete(key)};
}

export function cleanupCurrentSession(){
  const pending=[...cleanups.entries()];
  cleanups.clear();
  for(const[key,cleanup]of pending)try{cleanup()}catch(error){console.warn('[Session cleanup]',{key,code:error?.code||'cleanup-failed'})}
}

export function sessionCleanupCount(){
  return cleanups.size;
}

window.FirebaseSessionLifecycle={registerCleanup,cleanupCurrentSession,count:sessionCleanupCount};
