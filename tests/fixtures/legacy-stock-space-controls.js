addEventListener('DOMContentLoaded',async()=>{
  if(!new URLSearchParams(location.search).has('stock-space-qa'))return;
  await window.__fixtureReady;
  const script=document.createElement('script');script.src='../js/spaces.js';
  await new Promise((resolve,reject)=>{script.onload=resolve;script.onerror=reject;document.head.append(script);});
  SpaceContext.setSpaces(['a','b'].map(id=>({id,businessId:'desktop-shell-fixture',name:'QA '+id.toUpperCase(),type:'business',status:'active',capabilities:{sales:true,inventory:true,products:true}})));
  DB.alterar(data=>{Object.assign(data.produtos.find(p=>p.id==='p6'),{spaceAccessMode:'single_space',allowedSpaceIds:['a'],defaultSpaceId:'a',spaceScopeVersion:1});});
  const controls=document.createElement('div');controls.style.cssText='padding:12px;display:flex;gap:8px;flex-wrap:wrap';
  controls.innerHTML='<button data-stock-qa="all">Legado — Todos os espaços</button><button data-stock-qa="current">Legado — espaço QA A</button><button data-stock-qa="recent">Recente — espaço único</button><button data-stock-qa="variant">Variação legada — QA A</button>';
  document.querySelector('#app').before(controls);
  controls.onclick=e=>{
    const mode=e.target.dataset.stockQa;if(!mode)return;
    SpaceContext.selectHome(['current','variant'].includes(mode)?'a':'all_spaces');
    ProdutosMobile.stockEntry(mode==='recent'?'p6':mode==='variant'?'p2':'p1');
  };
});
