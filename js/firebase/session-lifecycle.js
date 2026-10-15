const cleanups=new Map();

export function runCleanup(key){
  const cleanup=cleanups.get(key);
  cleanups.delete(key); // Invalidate the old owner before invoking reentrant code.
  if(cleanup)try{cleanup()}catch(error){console.warn('[Session cleanup]',{key,code:error?.code||'cleanup-failed'})}
}

export function registerCleanup(key,cleanup){
  if(!key||typeof cleanup!=='function')return()=>{};
  runCleanup(key);
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

window.FirebaseSessionLifecycle={registerCleanup,runCleanup,cleanupCurrentSession,count:sessionCleanupCount};
