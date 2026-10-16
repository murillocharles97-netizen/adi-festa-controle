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
};return{dinheiro,dataHora,somenteNumeros,telefoneWhatsApp,escapar,uuid,hoje,mesAtual,toast}})();
