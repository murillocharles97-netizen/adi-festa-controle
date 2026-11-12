window.Utils=(()=>{const dinheiro=v=>Number(v||0).toLocaleString('pt-BR',{style:'currency',currency:'BRL'}),dataHora=v=>v?new Date(v).toLocaleString('pt-BR',{dateStyle:'short',timeStyle:'short'}):'—',somenteNumeros=v=>String(v||'').replace(/\D/g,''),telefoneWhatsApp=v=>{const n=somenteNumeros(v);return n.startsWith('55')?n:`55${n}`},escapar=v=>String(v??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c])),uuid=()=>crypto.randomUUID?crypto.randomUUID():`id-${Date.now()}-${Math.random().toString(36).slice(2)}`,hoje=v=>new Date(v).toDateString()===new Date().toDateString(),mesAtual=v=>{const a=new Date(v),b=new Date();return a.getMonth()===b.getMonth()&&a.getFullYear()===b.getFullYear()},toast=(t,e=false)=>{
  const host=document.querySelector('#toasts');
  const mobileSale=window.matchMedia?.('(max-width:767px)').matches && document.querySelector('.mobile-sale-page');
  if(mobileSale&&!e)host.querySelectorAll('.toast:not(.toast-error)').forEach(node=>node.remove());
  const x=document.createElement('div');
  x.className=`toast ${e?'toast-error':''}`;
  x.textContent=t;
  x.setAttribute('role',e?'alert':'status');
  host.append(x);
  setTimeout(()=>x.remove(),mobileSale&&!e?1400:3000);
};
// Messages written for the merchant (server HttpsError and app errors, in Portuguese) are kept.
// Raw SDK/runtime text (English or a bare code such as "internal") becomes a clear sentence;
// the technical code stays available to callers for diagnostics.
const friendlyError=(error,fallback='Não foi possível concluir agora. Tente novamente.')=>{
  const code=String(error?.code||'').replace(/^(functions|firestore|auth)\//,'');
  const message=String(error?.message||'').trim();
  const byCode={'permission-denied':'Seu perfil não tem acesso a esta informação.','unauthenticated':'Sua sessão expirou. Entre novamente para continuar.','unavailable':'Sem conexão com a nuvem agora. Confira a internet e tente novamente.','deadline-exceeded':'A consulta demorou mais que o esperado. Tente novamente.','resource-exhausted':'Muitas consultas em pouco tempo. Aguarde um instante e tente novamente.'};
  if(error instanceof TypeError||error instanceof ReferenceError)return fallback;
  const accented=/[áéíóúâêôãõçÁÉÍÓÚÂÊÔÃÕÇ]/.test(message);
  const sdkText=!message||message===code||/^[a-z-]+$/.test(message)||!accented&&/\b(the|to|of|from|or|not|be|is|cannot|failed|missing|insufficient)\b/i.test(message);
  if(!sdkText)return message;
  return byCode[code]||(globalThis.navigator?.onLine===false?byCode.unavailable:fallback);
};return{dinheiro,dataHora,somenteNumeros,telefoneWhatsApp,escapar,uuid,hoje,mesAtual,toast,friendlyError}})();
