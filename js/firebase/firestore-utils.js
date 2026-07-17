export function sanitizeForFirestore(value,seen=new WeakSet()){
  if(value===undefined||typeof value==='function'||typeof value==='symbol')return undefined;
  if(value===null||typeof value==='string'||typeof value==='boolean')return value;
  if(typeof value==='number')return Number.isFinite(value)?value:0;
  if(value instanceof Date)return value.toISOString();
  if(typeof Element!=='undefined'&&value instanceof Element)return undefined;
  if(Array.isArray(value))return value.map(item=>sanitizeForFirestore(item,seen)).filter(item=>item!==undefined);
  if(typeof value==='object'){
    if(seen.has(value))return undefined;
    if(typeof value.toDate==='function')return value.toDate().toISOString();
    const prototype=Object.getPrototypeOf(value);
    if(prototype!==Object.prototype&&prototype!==null)return undefined;
    seen.add(value);
    const clean={};
    for(const [key,item] of Object.entries(value)){
      if(key.startsWith('__'))continue;
      const sanitized=sanitizeForFirestore(item,seen);
      if(sanitized!==undefined)clean[key]=sanitized;
    }
    seen.delete(value);
    return clean;
  }
  return undefined;
}

export function normalizeFirestoreData(value){
  if(value===null||value===undefined||typeof value!=='object')return value;
  if(typeof value.toDate==='function')return value.toDate().toISOString();
  if(Array.isArray(value))return value.map(normalizeFirestoreData);
  const clean={};
  for(const [key,item] of Object.entries(value))clean[key]=normalizeFirestoreData(item);
  return clean;
}
