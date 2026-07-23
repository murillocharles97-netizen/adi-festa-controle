export const {normalizeBrazilianPhone,isValidBrazilianPhone,formatBrazilianPhone,maskPhone}=window.PhoneUtils;

export async function sha256(value){
  const bytes=new TextEncoder().encode(String(value||''));
  const hash=await crypto.subtle.digest('SHA-256',bytes);
  return [...new Uint8Array(hash)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

export const phoneIndexId=value=>sha256(normalizeBrazilianPhone(value));
export const sessionDocumentId=token=>sha256(token);
export const randomToken=()=>`${crypto.randomUUID().replaceAll('-','')}${crypto.randomUUID().replaceAll('-','')}`;
export const sessionStorageKey=visitToken=>`adiFesta:portalSession:${visitToken}`;

export function trackPortalEvent(name,data={}){
  try{
    const key='adiFesta:portalAnalytics',events=JSON.parse(localStorage.getItem(key)||'[]');
    events.push({name,data,createdAt:new Date().toISOString()});
    localStorage.setItem(key,JSON.stringify(events.slice(-250)));
  }catch{}
}
