(function(root){
 'use strict';
 // Presentation-only switch for the compatible visual rollback. Never delays boot.
 const enabled=true;
 function fitViewport(gate){if(!gate)return;const height=Math.floor(root.visualViewport?.height||root.innerHeight||0);if(height>0){const value=height+'px';if(gate.style.getPropertyValue('--auth-viewport-height')!==value)gate.style.setProperty('--auth-viewport-height',value);}}
 function render(gate){
  fitViewport(gate);
  if(!enabled)return;
  const panel=gate.querySelector('.auth-loading');if(!panel)return;
  panel.classList.add('auth-loading--v213');panel.setAttribute('aria-label','Preparação do ambiente');
  const brand=panel.querySelector('.auth-branding');
  if(brand&&root.VeconiBrand)brand.innerHTML=root.VeconiBrand.markup({mode:'horizontal',tagline:false});
  if(!panel.querySelector('.auth-loading-spinner')){const spinner=document.createElement('span');spinner.className='auth-loading-spinner';spinner.setAttribute('aria-hidden','true');brand?.after(spinner);}
 }
 root.VeconiAuthLoading=Object.freeze({render});
 const resize=()=>fitViewport(document.querySelector('#auth-gate'));
 root.visualViewport?.addEventListener('resize',resize,{passive:true});
 root.addEventListener('resize',resize,{passive:true});
 root.addEventListener('pageshow',resize,{passive:true});
})(typeof window==='undefined'?globalThis:window);
